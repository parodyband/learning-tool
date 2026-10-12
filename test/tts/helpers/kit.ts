// Shared setup for the voice tests: a fake key, a stub ElevenLabs, a trap server that must never be
// contacted, and a temp directory for the clip cache. Everything is torn down after each test.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import type { NarrationSegment } from '../../../src/core/types';
import { synthesizeLesson, voiceCheck, voiceConfigFromEnv } from '../../../src/tts';
import type { SynthesisResult, SynthesizeOptions, VoiceCheckOptions, VoiceCheckReport, VoiceConfig } from '../../../src/tts';
import { GEORGE, startStub, startTrap, type Stub } from './stub';

/** Not a real key. Recognisable on purpose, so the canary test can search for it anywhere. */
export const FAKE_KEY = 'sk_ZZFAKEKEYZZ_learning_tool_q7w8e9r0t1y2u3i4o5p6';
/**
 * The word inside the fake key, lower-cased. It occurs in no source string, file name or path of
 * this project, so finding it in any output means part of the key got there.
 */
export const FAKE_KEY_MARKER = 'zzfakekeyzz';

export const KEY_VAR = 'LEARNING_TOOL_ELEVENLABS_API_KEY';
export const VOICE_VAR = 'LEARNING_TOOL_ELEVENLABS_VOICE_ID';
export const MODEL_VAR = 'LEARNING_TOOL_ELEVENLABS_MODEL';
export const MAX_VAR = 'LEARNING_TOOL_VOICE_MAX_CHARS';

/** Backoff in milliseconds instead of seconds, so retry tests take no time. */
/** Two requests at a time and no growth: what the tests of retries, limits and deadlines were written against. */
export const FAST = { backoffMs: [2, 4], requestTimeoutMs: 2000, concurrency: 2, maxConcurrency: 2 } as const;
/** The model the general tests name, so that the default model's fallback is tested where it is the subject. */
export const OLDER_MODEL = 'eleven_multilingual_v2';

export function configure(extra: Record<string, string> = {}): VoiceConfig {
  const config = voiceConfigFromEnv({ [KEY_VAR]: FAKE_KEY, [MODEL_VAR]: OLDER_MODEL, ...extra });
  if (!config) throw new Error('test setup: voice configuration came back off');
  return config;
}

/** A configuration with the voice named, so no test request goes to the voices endpoint. */
export const withGeorge = (extra: Record<string, string> = {}): VoiceConfig => configure({ [VOICE_VAR]: GEORGE, ...extra });

/** Segments s1, s2, ... one per text. */
export function segs(...texts: string[]): NarrationSegment[] {
  return texts.map((text, i) => ({ id: `s${i + 1}`, sceneId: `s${i + 1}`, text }));
}

export interface World {
  stub: Stub;
  trap: Awaited<ReturnType<typeof startTrap>>;
  /** A fresh directory that stands in for the Learning Tool home. */
  home: string;
  cacheDir: string;
  synth(segments: NarrationSegment[], config?: VoiceConfig | null, opts?: Partial<SynthesizeOptions>): Promise<SynthesisResult>;
  check(config?: VoiceConfig | null, opts?: VoiceCheckOptions): Promise<VoiceCheckReport>;
  /** Names of the files in the cache directory, sorted. */
  cacheFiles(): Promise<string[]>;
}

/** Registers the per-test setup and returns the object it fills in. Call at the top of a describe block. */
export function useWorld(): World {
  const w = {} as World;
  beforeEach(async () => {
    w.stub = await startStub({ key: FAKE_KEY });
    w.trap = await startTrap();
    w.home = await mkdtemp(path.join(os.tmpdir(), 'lt-voice-'));
    w.cacheDir = path.join(w.home, '.state', 'voice-cache');
  });
  afterEach(async () => {
    await w.stub.close();
    await w.trap.close();
    await rm(w.home, { recursive: true, force: true });
  });
  w.synth = (segments, config, opts = {}) =>
    synthesizeLesson(segments, config === undefined ? configure() : config, { cacheDir: w.cacheDir, baseUrl: w.stub.baseUrl, tuning: FAST, ...opts });
  w.check = (config, opts = {}) => voiceCheck(config === undefined ? configure() : config, { baseUrl: w.stub.baseUrl, tuning: FAST, ...opts });
  w.cacheFiles = async () => (await readdir(w.cacheDir).catch(() => [])).sort();
  return w;
}

/** Every file under `dir`, with its path relative to `dir` and its bytes. */
export async function filesUnder(dir: string): Promise<{ name: string; bytes: Buffer }[]> {
  const out: { name: string; bytes: Buffer }[] = [];
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push({ name: path.relative(dir, full), bytes: entry.isFile() ? await readFile(full) : Buffer.alloc(0) });
    }
  };
  await walk(dir);
  return out;
}
