// The setup check behind the `voice-check` command: is voice configured, does ElevenLabs answer, does
// the key work, is there a voice to use and credit to use it with. It reads two endpoints and never
// synthesises, so it costs nothing.
import { fail, VOICE_MESSAGES, worst, type Failure, type VoiceCode } from './codes';
import { secretOf, voiceEnvProblems, type VoiceConfig, type VoiceEnv, type VoiceEnvProblem } from './config';
import { call, DEFAULT_BACKOFF_MS, readJsonObject, type CallContext, type CallResult, type FetchLike } from './http';
import { resolveOrigin, type TestBaseUrl } from './origin';
import { listVoices, pickVoice, type Voice } from './voices';

export interface VoiceCheckOptions {
  /** A replacement for the global `fetch`, for tests. */
  fetch?: FetchLike;
  /** Tests only: a token from `loopbackBaseUrl` in `src/tts/testing`. */
  baseUrl?: TestBaseUrl;
  /** Total time allowed, in milliseconds. Default 15000. */
  timeoutMs?: number;
  /** Pass `process.env` to have malformed settings listed under `problems`. */
  env?: VoiceEnv;
  /** Knobs for tests. */
  tuning?: { requestTimeoutMs?: number; backoffMs?: readonly number[] };
}

export interface VoiceEndpointCheck {
  /** `VOICE_OK`, or why this endpoint could not be read. `VOICE_OFF` when nothing was asked. */
  code: VoiceCode;
  httpStatus?: number;
}

export interface VoiceCheckReport {
  /**
   * `VOICE_OFF`: not configured. `VOICE_OK`: the key works and a voice is available. Otherwise the
   * reason voice would fail. A key limited to text-to-speech may fail both reads and still work, so
   * anything but `VOICE_AUTH` on a 401 is a strong hint, not proof.
   */
  code: VoiceCode;
  message: string;
  configured: boolean;
  /** True when ElevenLabs answered at least one request, whatever it said. */
  reachable: boolean;
  model: string | null;
  /** `LEARNING_TOOL_VOICE_MAX_CHARS`, or null when voice is off. */
  maxChars: number | null;
  /** The voice a publish would use. `listed` is false when a configured voice is not on the first page of the account's voices, which does not prove it is unusable. */
  voice: { id: string; source: 'configured' | 'account'; listed: boolean } | null;
  /** `GET /v1/user/subscription`. Numbers are characters; `resetsOn` is YYYY-MM-DD. */
  subscription: VoiceEndpointCheck & { tier?: string; charactersUsed?: number; charactersLimit?: number; charactersLeft?: number; resetsOn?: string };
  /** `GET /v2/voices`. */
  voices: VoiceEndpointCheck & { count?: number };
  /** Settings that are present but malformed. Filled only when `opts.env` is given. */
  problems: VoiceEnvProblem[];
}

const CHECK_OK = 'ElevenLabs is reachable, the key works, and a voice is available.';
const DEFAULT_TIMEOUT_MS = 15_000;

interface Subscription {
  tier?: string;
  used?: number;
  limit?: number;
  canExtend: boolean;
  resetsOn?: string;
}

const count = (v: unknown): number | undefined => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined);

function readSubscription(ctx: CallContext): Promise<CallResult<Subscription>> {
  return call<Subscription>(ctx, {
    method: 'GET',
    path: '/v1/user/subscription',
    accept: 'application/json',
    async read(res) {
      const body = await readJsonObject(res, 256 * 1024);
      if (!body) return fail('VOICE_NETWORK', { stop: true, status: 200 });
      // A tier is shown to the learner, so only a plain identifier that does not resemble the key is kept.
      const tier = typeof body.tier === 'string' && /^[a-z][a-z0-9_]{0,23}$/.test(body.tier) && !ctx.secret.mentions(body.tier) ? body.tier : undefined;
      const reset = count(body.next_character_count_reset_unix);
      const resetsOn = reset !== undefined && reset > 0 && reset < 4_102_444_800 ? new Date(reset * 1000).toISOString().slice(0, 10) : undefined;
      return {
        ok: true,
        value: { tier, used: count(body.character_count), limit: count(body.character_limit), canExtend: body.can_extend_character_limit === true, resetsOn },
      };
    },
  });
}

const endpoint = (r: CallResult<unknown>): VoiceEndpointCheck => (r.ok ? { code: 'VOICE_OK' } : { code: r.code, ...(r.status === undefined ? {} : { httpStatus: r.status }) });

/**
 * Checks the voice setup without synthesising anything. `config` is the object from
 * `voiceConfigFromEnv`, or null (the result is then `VOICE_OFF` and nothing is requested).
 *
 * Reads `GET /v1/user/subscription` and `GET /v2/voices` with the same retry rules and the same
 * fixed codes as `synthesizeLesson`. Always resolves for a well-formed call; like `synthesizeLesson`
 * it rejects with a `TypeError` only for a `baseUrl` not made by `loopbackBaseUrl` or a copied
 * `config`. The report never contains the key, a response body or a header.
 */
export async function voiceCheck(config: VoiceConfig | null, opts: VoiceCheckOptions = {}): Promise<VoiceCheckReport> {
  resolveOrigin(opts.baseUrl);
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new TypeError('voiceCheck: opts.fetch must be a function.');
  const problems = opts.env ? voiceEnvProblems(opts.env) : [];
  if (config === null || config === undefined) {
    return {
      code: 'VOICE_OFF',
      message: VOICE_MESSAGES.VOICE_OFF,
      configured: false,
      reachable: false,
      model: null,
      maxChars: null,
      voice: null,
      subscription: { code: 'VOICE_OFF' },
      voices: { code: 'VOICE_OFF' },
      problems,
    };
  }
  const secret = secretOf(config);
  if (!secret) throw new TypeError('voiceCheck: config must be the object voiceConfigFromEnv returned; a copy does not carry the key.');

  const timeoutMs = typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? Math.min(opts.timeoutMs, 120_000) : DEFAULT_TIMEOUT_MS;
  const run = new AbortController();
  const timer = setTimeout(() => run.abort(), timeoutMs);
  const ctx: CallContext = {
    secret,
    baseUrl: opts.baseUrl,
    fetch: fetchImpl,
    run: run.signal,
    deadlineAt: Date.now() + timeoutMs,
    requestTimeoutMs: opts.tuning?.requestTimeoutMs ?? 10_000,
    backoffMs: opts.tuning?.backoffMs ?? DEFAULT_BACKOFF_MS,
    halted: () => false,
    counters: { requests: 0 },
  };
  let sub: CallResult<Subscription>;
  let listed: CallResult<Voice[]>;
  try {
    [sub, listed] = await Promise.all([readSubscription(ctx), listVoices(ctx)]);
  } finally {
    clearTimeout(timer);
  }

  const picked = listed.ok ? pickVoice(listed.value) : null;
  const voice: VoiceCheckReport['voice'] =
    config.voiceId !== null
      ? { id: config.voiceId, source: 'configured', listed: listed.ok && listed.value.some((v) => v.id === config.voiceId) }
      : picked
        ? { id: picked.id, source: 'account', listed: true }
        : null;

  const left = sub.ok && sub.value.used !== undefined && sub.value.limit !== undefined ? Math.max(0, sub.value.limit - sub.value.used) : undefined;
  const failures: Failure[] = [sub, listed].flatMap((r) => (r.ok ? [] : [r]));
  let code: VoiceCode;
  if (listed.ok && voice === null) code = 'VOICE_AUTH';
  else if (sub.ok && left === 0 && !sub.value.canExtend) code = 'VOICE_QUOTA';
  // One read succeeding proves the key. With a voice in hand that is enough: a key may be scoped so
  // that the other read is refused while text-to-speech still works.
  else if (voice !== null && (listed.ok || sub.ok)) code = 'VOICE_OK';
  else code = worst(failures)?.code ?? 'VOICE_NETWORK';

  return {
    code,
    message: code === 'VOICE_OK' ? CHECK_OK : VOICE_MESSAGES[code],
    configured: true,
    reachable: sub.ok || listed.ok || failures.some((f) => f.status !== undefined),
    model: config.model,
    maxChars: config.maxChars,
    voice,
    subscription: {
      ...endpoint(sub),
      ...(sub.ok && sub.value.tier !== undefined ? { tier: sub.value.tier } : {}),
      ...(sub.ok && sub.value.used !== undefined ? { charactersUsed: sub.value.used } : {}),
      ...(sub.ok && sub.value.limit !== undefined ? { charactersLimit: sub.value.limit } : {}),
      ...(left !== undefined ? { charactersLeft: left } : {}),
      ...(sub.ok && sub.value.resetsOn !== undefined ? { resetsOn: sub.value.resetsOn } : {}),
    },
    voices: { ...endpoint(listed), ...(listed.ok ? { count: listed.value.length } : {}) },
    problems,
  };
}

/** The check as a few plain lines for a terminal. Contains only what the report contains. */
export function formatVoiceCheck(check: VoiceCheckReport): string {
  const lines: string[] = [`${check.code}: ${check.message}`];
  if (check.configured) {
    lines.push('Key: set (never shown).');
    lines.push(`Model: ${check.model ?? 'none'}. Character budget per publish: ${check.maxChars ?? 0}.`);
    const v = check.voice;
    if (v === null) lines.push('Voice: none available.');
    else if (v.source === 'account') lines.push(`Voice: ${v.id}, picked from the account's voices.`);
    else lines.push(`Voice: ${v.id}, from LEARNING_TOOL_ELEVENLABS_VOICE_ID${v.listed ? '' : ' (not on the first page of the account\'s voices; it may still work)'}.`);
    const s = check.subscription;
    if (s.code !== 'VOICE_OK') lines.push(`Subscription: could not be read (${s.code}${s.httpStatus === undefined ? '' : `, HTTP ${s.httpStatus}`}).`);
    else {
      const usage = s.charactersUsed !== undefined && s.charactersLimit !== undefined ? `${s.charactersUsed} of ${s.charactersLimit} characters used, ${s.charactersLeft ?? 0} left` : 'usage not reported';
      lines.push(`Subscription: ${s.tier ?? 'tier not reported'}, ${usage}${s.resetsOn ? `, resets ${s.resetsOn}` : ''}.`);
    }
    const l = check.voices;
    if (l.code !== 'VOICE_OK') lines.push(`Voices: could not be listed (${l.code}${l.httpStatus === undefined ? '' : `, HTTP ${l.httpStatus}`}).`);
    else lines.push(`Voices: ${l.count ?? 0} listed.`);
  }
  for (const p of check.problems) lines.push(`Setting ${p.variable} ${p.problem}`);
  return lines.join('\n');
}
