// Turns narration segments into MP3 clips, one request per distinct text, and reports what happened
// in fixed codes. Every failure that depends on the lesson, the network or ElevenLabs is a report,
// never an exception, so the caller can always leave the text lesson published.
import path from 'node:path';
import type { AudioBundle, AudioClip, NarrationSegment } from '../core/types';
import { ClipCache, clipKey, DEFAULT_CACHE_MAX_BYTES, MAX_CLIP_BYTES } from './cache';
import { fail, VOICE_MESSAGES, worst, type Failure, type VoiceCode, type VoiceFailureCode } from './codes';
import { DEFAULT_MODEL, FALLBACK_MODEL, ID_PATTERN, secretOf, type VoiceConfig } from './config';
import { call, DEFAULT_BACKOFF_MS, DEFAULT_REQUEST_TIMEOUT_MS, readCapped, type CallContext, type CallResult, type FetchLike, type Secret } from './http';
import { looksLikeMp3 } from './mp3';
import { resolveOrigin, type TestBaseUrl } from './origin';
import { countCharacters, MAX_REQUEST_CHARS, prepareText } from './text';
import { displayName, knownVoiceName, listVoices, pickVoice } from './voices';

/** About 480 kB per minute, which every plan may request. */
export const OUTPUT_FORMAT = 'mp3_44100_64';
export const DEFAULT_DEADLINE_MS = 45_000;
const MAX_DEADLINE_MS = 10 * 60 * 1000;
/**
 * Clips are requested in parallel so that a lesson's audio is complete in seconds. A run starts
 * with a few requests at once and, as soon as a response says how many the account allows
 * (`maximum-concurrent-requests`), runs that many, up to the ceiling here.
 */
const CONCURRENCY = 4;
const MAX_CONCURRENCY = 20;
// `seed` is best effort on ElevenLabs' side; fixing it removes one source of variation between runs
// and it is part of the cache key, so changing it is a new set of clips.
const SEED = 20261010;
const MAX_SEGMENTS = 400;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;
/** A remembered voice is re-checked against the account this often, so a withdrawn voice is noticed before it fails a publish. */
const VOICE_RECHECK_MS = 24 * 60 * 60 * 1000;
/** After this many segments have failed for good, the rest are not attempted: the network or the service is down. */
const FAILED_SEGMENTS_BEFORE_STOP = 2;
const SEGMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export interface SynthesizeOptions {
  /** Absolute path of the clip cache (the server passes `<home>/.state/voice-cache`). Created 0700 when missing. */
  cacheDir: string;
  /** Total time allowed, in milliseconds. Default 45000. When it runs out, what is finished is returned. */
  deadlineMs?: number;
  /** A replacement for the global `fetch`, for tests. It is given the key in a request header. */
  fetch?: FetchLike;
  /** Tests only: a token from `loopbackBaseUrl` in `src/tts/testing`. A string is rejected. Leave out in production. */
  baseUrl?: TestBaseUrl;
  /** Abort to stop early, for example when the MCP connection closes. */
  signal?: AbortSignal;
  /** Knobs for tests. Production leaves them alone. */
  tuning?: { requestTimeoutMs?: number; backoffMs?: readonly number[]; cacheMaxBytes?: number; concurrency?: number; maxConcurrency?: number };
}

export type VoiceSegmentStatus = 'ok' | 'cached' | 'failed' | 'skipped' | 'empty';

export interface VoiceSegmentReport {
  /** The `NarrationSegment.id`. */
  id: string;
  /**
   * `ok`: synthesised in this run. `cached`: served from disk, no request. `failed`: ElevenLabs was
   * asked and no usable audio came back. `skipped`: not attempted. `empty`: nothing speakable in it.
   */
  status: VoiceSegmentStatus;
  /** Characters in the text as it is sent (after brackets are removed). */
  characters: number;
  /** Characters sent to ElevenLabs for this segment in this run: 0 or `characters`. */
  sent: number;
  /** Requests made for this segment in this run. */
  attempts: number;
  /** Why a failed or skipped segment has no audio. */
  code?: VoiceFailureCode;
}

/** What a synthesis run did. Built only from fixed codes and sentences, counts, and ids we validated. */
export interface VoiceReport {
  /**
   * `VOICE_OK`: every speakable segment has a clip. `VOICE_PARTIAL`: some do, see `cause`.
   * `VOICE_OFF`: no configuration. Any other code: no clip at all, for that reason.
   */
  code: VoiceCode;
  /** `VOICE_MESSAGES[code]`. */
  message: string;
  /** With `VOICE_PARTIAL`: why the rest is missing. */
  cause?: VoiceFailureCode;
  /** The HTTP status behind a failure, when ElevenLabs answered. */
  httpStatus?: number;
  model: string | null;
  format: typeof OUTPUT_FORMAT;
  /** The voice used. `account` means it was picked from the voices the key can list. */
  voice: { id: string; source: 'configured' | 'account' } | null;
  characters: {
    /** `LEARNING_TOOL_VOICE_MAX_CHARS`. */
    budget: number;
    /** All distinct segment text. */
    total: number;
    /** Of `total`, already in the cache. */
    cached: number;
    /** The estimate checked against the budget before any request: `total - cached`. */
    estimated: number;
    /** Actually sent in this run. */
    sent: number;
  };
  segments: VoiceSegmentReport[];
  counts: Record<VoiceSegmentStatus, number>;
  cache: { usable: boolean; hits: number; writes: number };
  /** HTTP requests made, retries and the voice listing included. */
  requests: number;
  /** Total size of the clips, before base64. */
  bytes: number;
}

export interface SynthesisResult {
  /** One clip per segment that has audio, in segment order. May be a subset: check `report.code`. */
  clips: AudioClip[];
  report: VoiceReport;
  /** The bundle for `Published.audio`, or null when there is no clip. */
  audio: AudioBundle | null;
}

type JobState = 'pending' | 'cached' | 'ok' | 'failed' | 'skipped';

/** One distinct text. Segments that say the same thing share a job, so it is paid for once. */
interface Job {
  text: string;
  characters: number;
  key: string;
  state: JobState;
  bytes: Uint8Array | null;
  attempts: number;
  failure: Failure | null;
}

interface Item {
  id: string;
  job: Job | null;
  /** The first segment of a job carries its request counts. */
  leads: boolean;
}

interface ChosenVoice {
  id: string;
  name: string;
  source: 'configured' | 'account';
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function plan(segments: readonly unknown[]): { items: Item[]; jobs: Job[] } {
  const items: Item[] = [];
  const byText = new Map<string, Job>();
  const seen = new Set<string>();
  for (const seg of segments) {
    // Segments come from core/narration over a validated lesson. Anything else is not ours to speak.
    if (!isRecord(seg) || typeof seg.id !== 'string' || !SEGMENT_ID.test(seg.id) || seen.has(seg.id)) continue;
    seen.add(seg.id);
    const text = prepareText(typeof seg.text === 'string' ? seg.text : '');
    if (text === '') {
      items.push({ id: seg.id, job: null, leads: false });
      continue;
    }
    let job = byText.get(text);
    const leads = job === undefined;
    if (!job) {
      job = { text, characters: countCharacters(text), key: '', state: 'pending', bytes: null, attempts: 0, failure: null };
      byText.set(text, job);
    }
    items.push({ id: seg.id, job, leads });
  }
  return { items, jobs: [...byText.values()] };
}

const BAD_AUDIO = fail('VOICE_BAD_AUDIO', { stop: true, status: 200 });
const OUT_OF_TIME = fail('VOICE_TIMEOUT', { stop: true });

async function readAudio(res: Response): Promise<CallResult<Uint8Array>> {
  const type = (res.headers.get('content-type') ?? '').trim().toLowerCase();
  if (!type.startsWith('audio/')) return BAD_AUDIO;
  const bytes = await readCapped(res, MAX_CLIP_BYTES);
  if (!bytes || !looksLikeMp3(bytes)) return BAD_AUDIO;
  return { ok: true, value: bytes };
}

interface Outcome {
  off?: boolean;
  /** A reason that applies to the whole run, decided before or instead of per-segment work. */
  verdict?: Failure;
  config: VoiceConfig | null;
  voice: ChosenVoice | null;
  cache: { usable: boolean; writes: number };
  requests: number;
  /** The default model was refused and the run went on with the older one. */
  modelFallback?: boolean;
}

function conclude(items: readonly Item[], jobs: readonly Job[], o: Outcome): SynthesisResult {
  for (const job of jobs) if (job.state === 'pending') job.state = 'skipped';
  const failures = jobs.flatMap((j) => (j.failure ? [j.failure] : []));
  const unvoiced = jobs.some((j) => !j.bytes);
  // Skipped segments with no failure anywhere can only mean the clock ran out between requests.
  const cause = o.off || !unvoiced ? undefined : (o.verdict ?? worst(failures) ?? OUT_OF_TIME);
  const voiced = jobs.filter((j) => j.bytes).length;
  const code: VoiceCode = o.off ? 'VOICE_OFF' : !cause ? 'VOICE_OK' : voiced === 0 ? cause.code : 'VOICE_PARTIAL';

  const counts: Record<VoiceSegmentStatus, number> = { ok: 0, cached: 0, failed: 0, skipped: 0, empty: 0 };
  const segments: VoiceSegmentReport[] = [];
  const clips: AudioClip[] = [];
  for (const item of items) {
    const job = item.job;
    const status: VoiceSegmentStatus = !job ? 'empty' : job.state === 'pending' ? 'skipped' : job.state;
    counts[status] += 1;
    const sent = job && item.leads && job.attempts > 0 ? job.characters : 0;
    const why = status === 'failed' ? job?.failure?.code : status === 'skipped' ? cause?.code : undefined;
    segments.push({
      id: item.id,
      status,
      characters: job?.characters ?? 0,
      sent,
      attempts: job && item.leads ? job.attempts : 0,
      ...(why ? { code: why } : {}),
    });
    if (job?.bytes) {
      const b = job.bytes;
      clips.push({ segmentId: item.id, mime: 'audio/mpeg', base64: Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64') });
    }
  }

  const sum = (pick: (j: Job) => boolean): number => jobs.reduce((n, j) => n + (pick(j) ? j.characters : 0), 0);
  const total = sum(() => true);
  const cached = sum((j) => j.state === 'cached');
  const report: VoiceReport = {
    code,
    message: VOICE_MESSAGES[code],
    ...(code === 'VOICE_PARTIAL' && cause ? { cause: cause.code } : {}),
    ...(cause?.status === undefined ? {} : { httpStatus: cause.status }),
    model: o.config?.model ?? null,
    format: OUTPUT_FORMAT,
    voice: o.voice ? { id: o.voice.id, source: o.voice.source } : null,
    characters: { budget: o.config?.maxChars ?? 0, total, cached, estimated: total - cached, sent: sum((j) => j.attempts > 0) },
    segments,
    counts,
    cache: { usable: o.cache.usable, hits: jobs.filter((j) => j.state === 'cached').length, writes: o.cache.writes },
    requests: o.requests,
    bytes: jobs.reduce((n, j) => n + (j.bytes?.byteLength ?? 0), 0),
  };
  const audio: AudioBundle | null = clips.length > 0 && o.voice ? { provider: 'elevenlabs', voice: o.voice.name, clips } : null;
  return { clips, report, audio };
}

async function recall(cache: ClipCache, secret: Secret): Promise<{ id: string; name: string; at: number } | null> {
  const stored = await cache.readVoice();
  if (!stored || !ID_PATTERN.test(stored.id) || secret.mentions(stored.id)) return null;
  return { id: stored.id, name: displayName(stored.name, secret), at: stored.at };
}

/**
 * Synthesises the narration of one lesson.
 *
 * - `config` is the object from `voiceConfigFromEnv`, or null, in which case the result is
 *   `VOICE_OFF` with no clips and nothing is requested.
 * - Each segment's text is sent with square and angle brackets removed. Segments with identical
 *   text are synthesised once. A segment with nothing speakable gets no clip and no request. An
 *   entry that is not a segment, or repeats an earlier id, is ignored.
 * - The character budget (`config.maxChars`) is checked against what the cache does not already
 *   hold, before any text is sent. Over budget means `VOICE_BUDGET` and no request.
 * - Clips are cached in `opts.cacheDir` under a SHA-256 of model, voice, format, preprocessor
 *   version and text. A republish of unchanged text makes no request, and a publish cut short by
 *   the deadline is finished by the next one.
 * - Two requests at a time; up to three attempts each on network errors, 408, 429 and 5xx; 401,
 *   402, 403 and 404 are never retried and end the run.
 * - The key is sent to `https://api.elevenlabs.io` only, and redirects are refused.
 *
 * Always resolves for a well-formed call. It rejects with a `TypeError` only when the call itself
 * is wrong in the code: `opts.cacheDir` not an absolute path, `opts.baseUrl` not made by
 * `loopbackBaseUrl`, or a `config` that is a copy rather than the object `voiceConfigFromEnv`
 * returned. Neither the result nor that error ever contains the key, a response body or a header.
 */
export async function synthesizeLesson(
  segments: readonly NarrationSegment[],
  config: VoiceConfig | null,
  opts: SynthesizeOptions,
): Promise<SynthesisResult> {
  const started = Date.now();
  if (!isRecord(opts) || typeof opts.cacheDir !== 'string' || !path.isAbsolute(opts.cacheDir)) {
    throw new TypeError('synthesizeLesson: opts.cacheDir must be an absolute path.');
  }
  resolveOrigin(opts.baseUrl);
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('synthesizeLesson: opts.fetch must be a function.');
  if (!Array.isArray(segments)) throw new TypeError('synthesizeLesson: segments must be an array.');

  const { items, jobs } = plan(segments);
  const outcome: Outcome = { config, voice: null, cache: { usable: false, writes: 0 }, requests: 0 };
  if (config === null || config === undefined) return conclude(items, jobs, { ...outcome, config: null, off: true });
  const secret = secretOf(config);
  if (!secret) throw new TypeError('synthesizeLesson: config must be the object voiceConfigFromEnv returned; a copy does not carry the key.');
  if (jobs.length === 0) return conclude(items, jobs, outcome);

  const cache = await ClipCache.open(opts.cacheDir);
  outcome.cache.usable = cache.usable;
  const remembered = config.voiceId === null ? await recall(cache, secret) : null;
  let voice: ChosenVoice | null =
    config.voiceId !== null
      ? { id: config.voiceId, name: knownVoiceName(config.voiceId), source: 'configured' }
      : remembered
        ? { id: remembered.id, name: remembered.name, source: 'account' }
        : null;
  outcome.voice = voice;

  // The cache key includes the voice, so hits can only be looked up once a voice is known.
  const lookUp = async (voiceId: string): Promise<void> => {
    for (const job of jobs) {
      job.key = clipKey({ model: config.model, voiceId, format: OUTPUT_FORMAT, seed: SEED, text: job.text });
      job.bytes = await cache.read(job.key);
      job.state = job.bytes ? 'cached' : 'pending';
    }
  };
  const overBudget = (): boolean =>
    items.length > MAX_SEGMENTS ||
    jobs.some((j) => j.characters > MAX_REQUEST_CHARS) ||
    jobs.reduce((n, j) => n + (j.state === 'pending' ? j.characters : 0), 0) > config.maxChars;

  if (voice) await lookUp(voice.id);
  if (overBudget()) return conclude(items, jobs, { ...outcome, verdict: fail('VOICE_BUDGET') });
  if (jobs.every((j) => j.bytes)) return conclude(items, jobs, outcome);

  const deadlineMs = typeof opts.deadlineMs === 'number' && opts.deadlineMs > 0 ? Math.min(opts.deadlineMs, MAX_DEADLINE_MS) : DEFAULT_DEADLINE_MS;
  const deadlineAt = started + deadlineMs;
  const run = new AbortController();
  const stopRun = (): void => run.abort();
  // Every request already measures itself against `deadlineAt`; this timer is the backstop that
  // ends the run even if some wait is ever added that does not.
  const deadlineTimer = setTimeout(stopRun, Math.max(0, deadlineAt - Date.now()));
  if (opts.signal?.aborted) run.abort();
  else opts.signal?.addEventListener('abort', stopRun, { once: true });

  let halted = false;
  const counters = { requests: 0 };
  const ctx: CallContext = {
    secret,
    baseUrl: opts.baseUrl,
    fetch: fetchImpl,
    run: run.signal,
    deadlineAt,
    requestTimeoutMs: opts.tuning?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    backoffMs: opts.tuning?.backoffMs ?? DEFAULT_BACKOFF_MS,
    halted: () => halted,
    counters,
  };
  const done = (verdict?: Failure): SynthesisResult => conclude(items, jobs, { ...outcome, voice, verdict, requests: counters.requests });

  try {
    if (config.voiceId === null && (!remembered || Date.now() - remembered.at > VOICE_RECHECK_MS || Date.now() < remembered.at)) {
      const listed = await listVoices(ctx);
      if (listed.ok) {
        const picked = pickVoice(listed.value, remembered?.id);
        // The key works but can use no voice at all: the learner has to name one.
        if (!picked) return done(fail('VOICE_AUTH', { stop: true }));
        const changed = picked.id !== voice?.id;
        voice = { ...picked, source: 'account' };
        await cache.writeVoice({ id: picked.id, name: picked.name, at: Date.now() });
        if (changed) {
          await lookUp(picked.id);
          if (overBudget()) return done(fail('VOICE_BUDGET'));
        }
      } else if (!voice) {
        return done(listed);
      }
      // Otherwise the listing failed but a voice is remembered: carry on with it.
    }
    if (!voice) return done(fail('VOICE_AUTH', { stop: true }));
    const chosen = voice;

    const queue = jobs.filter((j) => j.state === 'pending');
    let cursor = 0;
    const ceiling = Math.max(1, opts.tuning?.maxConcurrency ?? MAX_CONCURRENCY);
    let limit = Math.min(Math.max(1, opts.tuning?.concurrency ?? CONCURRENCY), ceiling, queue.length);
    // The model for this run. If the fast default is refused, the run carries on with the older one.
    let model = config.model;
    // Set by the first request the default model fails in a way that may be the model's doing:
    // that request is tried once on the older model, and every worker waits to hear how it went.
    let probe: Promise<boolean> | null = null;
    const running: Promise<void>[] = [];
    let failedForGood = 0;
    let totalBytes = jobs.reduce((n, j) => n + (j.bytes?.byteLength ?? 0), 0);

    const worker = async (slot: number): Promise<void> => {
      // Jobs are taken in lesson order, so a run that stops early leaves the first scenes voiced.
      while (!halted && !run.signal.aborted && slot < limit) {
        const job = queue[cursor];
        if (!job) return;
        cursor += 1;
        const speak = (withModel: string): Promise<CallResult<Uint8Array>> =>
          call<Uint8Array>(ctx, {
            method: 'POST',
            path: `/v1/text-to-speech/${chosen.id}`,
            query: { output_format: OUTPUT_FORMAT },
            json: { text: job.text, model_id: withModel, seed: SEED },
            accept: 'audio/mpeg',
            read: readAudio,
            onAttempt: () => {
              job.attempts += 1;
            },
            onHeaders: (headers) => {
              // The account's own ceiling: fewer workers when it is lower than ours, more when it allows more.
              const max = Number.parseInt(headers.get('maximum-concurrent-requests') ?? '', 10);
              if (!Number.isInteger(max) || max < 1) return;
              const next = Math.min(max, ceiling, queue.length);
              if (next < limit) limit = next;
              else if (next > limit) {
                const from = limit;
                limit = next;
                for (let extra = from; extra < next; extra++) running.push(worker(extra));
              }
            },
          });
        const used = model;
        const onFallback = async (): Promise<CallResult<Uint8Array>> => {
          job.key = clipKey({ model: FALLBACK_MODEL, voiceId: chosen.id, format: OUTPUT_FORMAT, seed: SEED, text: job.text });
          const cached = await cache.read(job.key);
          return cached ? { ok: true, value: cached } : speak(FALLBACK_MODEL);
        };
        let out = await speak(used);
        if (!out.ok && out.modelSuspect && used === DEFAULT_MODEL && !halted) {
          if (probe === null) {
            // This request finds out: if the older model takes the same text, the model was the problem.
            let mine: CallResult<Uint8Array> = out;
            probe = (async () => {
              mine = await onFallback();
              if (mine.ok) {
                model = FALLBACK_MODEL;
                outcome.modelFallback = true;
              }
              return mine.ok;
            })();
            await probe;
            out = mine;
          } else if (await probe) {
            out = await onFallback();
          }
        }
        const result: CallResult<Uint8Array> = out.ok && totalBytes + out.value.byteLength > MAX_TOTAL_BYTES ? BAD_AUDIO : out;
        if (result.ok) {
          job.bytes = result.value;
          job.state = 'ok';
          totalBytes += result.value.byteLength;
          if (await cache.write(job.key, result.value)) outcome.cache.writes += 1;
          continue;
        }
        if (job.attempts === 0) {
          // Time ran out before anything was sent for it: not a failure of this segment.
          job.state = 'skipped';
          halted = true;
          return;
        }
        job.state = 'failed';
        job.failure = result;
        failedForGood += 1;
        if (result.stop || failedForGood >= FAILED_SEGMENTS_BEFORE_STOP) halted = true;
      }
    };
    for (let slot = 0; slot < limit; slot++) running.push(worker(slot));
    // Workers may be added while the run is under way, so wait for the list as it grows.
    for (let i = 0; i < running.length; i++) await running[i];

    // A refused voice that we picked ourselves is forgotten, so the next publish chooses again.
    if (chosen.source === 'account' && jobs.some((j) => j.failure?.voiceRefused)) await cache.forgetVoice();
    await cache.prune(new Set(jobs.map((j) => j.key)), opts.tuning?.cacheMaxBytes ?? DEFAULT_CACHE_MAX_BYTES);
    return done();
  } finally {
    clearTimeout(deadlineTimer);
    opts.signal?.removeEventListener('abort', stopRun);
  }
}

/**
 * How many characters these segments would send to ElevenLabs with an empty cache: the figure to
 * compare with the budget, or with what is left of a monthly quota.
 */
export function voiceCharacters(segments: readonly NarrationSegment[]): number {
  return plan(Array.isArray(segments) ? segments : []).jobs.reduce((n, j) => n + j.characters, 0);
}
