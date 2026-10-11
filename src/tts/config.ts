// Voice configuration comes from the environment and from nowhere else: not from a tool argument,
// not from the draft, not from a file.
//
// The object handed back describes the configuration and deliberately does not contain the key. The
// key goes straight into `sealKey` and is reachable only through a module-private WeakMap, so
// logging, serialising, cloning or spreading a VoiceConfig cannot reveal it.
import { sealKey, type Secret } from './http';

export const KEY_VAR = 'LEARNING_TOOL_ELEVENLABS_API_KEY';
export const VOICE_VAR = 'LEARNING_TOOL_ELEVENLABS_VOICE_ID';
export const MODEL_VAR = 'LEARNING_TOOL_ELEVENLABS_MODEL';
export const MAX_CHARS_VAR = 'LEARNING_TOOL_VOICE_MAX_CHARS';

export const DEFAULT_MODEL = 'eleven_multilingual_v2';
export const DEFAULT_MAX_CHARS = 12_000;
const MAX_CHARS_CEILING = 1_000_000;

/** Voice and model ids: also the only shape ever interpolated into a request path. */
export const ID_PATTERN = /^[A-Za-z0-9_]{4,64}$/;
// Visible ASCII only. Anything else is not an ElevenLabs key, and `fetch` rejects such a header value
// with an error that quotes it.
const KEY_PATTERN = /^[\x21-\x7e]{16,256}$/;

/** What voice is configured to do. Frozen, plain data, safe to log. The key is not in here. */
export interface VoiceConfig {
  readonly provider: 'elevenlabs';
  /** ElevenLabs `model_id`. */
  readonly model: string;
  /** The configured voice, or null to pick one from the account's own voices. */
  readonly voiceId: string | null;
  /** Most characters one publish may send to ElevenLabs. Cached segments do not count. */
  readonly maxChars: number;
}

/** A setting that is present but unusable. `problem` is a fixed sentence and never quotes the value. */
export interface VoiceEnvProblem {
  variable: string;
  problem: string;
}

export type VoiceEnv = Readonly<Record<string, string | undefined>>;

const SECRETS = new WeakMap<VoiceConfig, Secret>();

/** Internal: the sealed key for a config made by `voiceConfigFromEnv`, or undefined for any other object. */
export function secretOf(config: VoiceConfig): Secret | undefined {
  return SECRETS.get(config);
}

interface Reading {
  key: string | null;
  model: string;
  voiceId: string | null;
  maxChars: number;
  problems: VoiceEnvProblem[];
}

// A host that passes an unset option through leaves either an empty string or the placeholder itself
// ("${user_config.elevenlabs_api_key}"). Both mean "not set".
const setting = (env: VoiceEnv, name: string): string => {
  const value = env[name];
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.includes('${') ? '' : trimmed;
};

function read(env: VoiceEnv): Reading {
  const problems: VoiceEnvProblem[] = [];
  const rawKey = typeof env[KEY_VAR] === 'string' ? (env[KEY_VAR] as string).trim() : '';
  let key: string | null = null;
  if (rawKey.includes('${')) {
    problems.push({ variable: KEY_VAR, problem: 'holds an unfilled placeholder, so it counts as not set.' });
  } else if (rawKey !== '' && !KEY_PATTERN.test(rawKey)) {
    problems.push({ variable: KEY_VAR, problem: 'is not a usable key: expected 16 to 256 visible ASCII characters with no spaces.' });
  } else if (rawKey !== '') {
    key = rawKey;
  }

  // A key pasted into the wrong variable would otherwise travel in a URL path and land in reports.
  const keyLike = (value: string): boolean =>
    /^sk_/i.test(value) || (key !== null && (value.includes(key) || (value.length >= 12 && key.includes(value))));
  const id = (name: string): string | null => {
    const value = setting(env, name);
    if (value === '') return null;
    if (keyLike(value)) {
      problems.push({ variable: name, problem: `looks like an API key. The key belongs in ${KEY_VAR} only.` });
      return null;
    }
    if (!ID_PATTERN.test(value)) {
      problems.push({ variable: name, problem: 'must be 4 to 64 letters, digits or underscores.' });
      return null;
    }
    return value;
  };
  const voiceId = id(VOICE_VAR);
  const model = id(MODEL_VAR) ?? DEFAULT_MODEL;

  let maxChars = DEFAULT_MAX_CHARS;
  const rawMax = setting(env, MAX_CHARS_VAR);
  if (rawMax !== '') {
    if (/^\d{1,7}$/.test(rawMax) && Number(rawMax) <= MAX_CHARS_CEILING) maxChars = Number(rawMax);
    else problems.push({ variable: MAX_CHARS_VAR, problem: `must be a whole number from 0 to ${MAX_CHARS_CEILING}.` });
  }
  return { key, model, voiceId, maxChars, problems };
}

/**
 * Reads the voice configuration. Returns null, meaning voice is off, unless
 * `LEARNING_TOOL_ELEVENLABS_API_KEY` holds a real key: an empty value and an unfilled `${...}`
 * placeholder both count as not set. The generic `ELEVENLABS_API_KEY` is never read.
 *
 * Optional settings: `LEARNING_TOOL_ELEVENLABS_VOICE_ID`, `LEARNING_TOOL_ELEVENLABS_MODEL` (default
 * `eleven_multilingual_v2`), both `^[A-Za-z0-9_]{4,64}$`, and `LEARNING_TOOL_VOICE_MAX_CHARS`
 * (default 12000). A setting that is present but malformed turns voice off rather than being
 * replaced by a default, because a silently ignored model or budget could spend credits the learner
 * did not agree to; `voiceEnvProblems` says which one.
 *
 * The returned object does not contain the key and cannot be rebuilt from a copy of itself: pass
 * this exact object to `synthesizeLesson` and `voiceCheck`.
 */
export function voiceConfigFromEnv(env: VoiceEnv): VoiceConfig | null {
  const r = read(env);
  if (r.key === null || r.problems.length > 0) return null;
  const config: VoiceConfig = Object.freeze({ provider: 'elevenlabs' as const, model: r.model, voiceId: r.voiceId, maxChars: r.maxChars });
  SECRETS.set(config, sealKey(r.key));
  return config;
}

/**
 * Lists settings that are present but unusable, for a setup hint or the `voice-check` command.
 * Empty when voice is simply not configured or correctly configured.
 */
export function voiceEnvProblems(env: VoiceEnv): VoiceEnvProblem[] {
  return read(env).problems;
}
