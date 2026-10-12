// The whole vocabulary the voice module uses to describe an outcome. A report is built from these
// codes, their fixed sentences, counts, ids we validated ourselves, and HTTP status numbers. Nothing
// ElevenLabs sends back as text (an error message, a header, a voice name) is ever copied into one,
// so a report is safe to hand to the agent and can never echo the key.

export const VOICE_CODES = [
  'VOICE_OFF',
  'VOICE_OK',
  'VOICE_PARTIAL',
  'VOICE_AUTH',
  'VOICE_QUOTA',
  'VOICE_RATE',
  'VOICE_TIMEOUT',
  'VOICE_BAD_AUDIO',
  'VOICE_BUDGET',
  'VOICE_NETWORK',
] as const;

export type VoiceCode = (typeof VOICE_CODES)[number];

/** The codes that name a reason audio is missing. */
export type VoiceFailureCode = Exclude<VoiceCode, 'VOICE_OFF' | 'VOICE_OK' | 'VOICE_PARTIAL'>;

/** One fixed sentence per code. `VoiceReport.message` is always one of these, verbatim. */
export const VOICE_MESSAGES: Readonly<Record<VoiceCode, string>> = Object.freeze({
  VOICE_OFF: 'Voice is off. Set LEARNING_TOOL_ELEVENLABS_API_KEY to an ElevenLabs API key to turn it on.',
  VOICE_OK: 'Every narration segment has audio.',
  VOICE_PARTIAL:
    'Only some narration segments have audio. Publish again to finish the rest: segments already voiced come from the cache and cost nothing.',
  VOICE_AUTH:
    'ElevenLabs refused the request: the key is wrong, or it has no access to a usable voice or to the model. Check the key, and set LEARNING_TOOL_ELEVENLABS_VOICE_ID to a voice the account can use.',
  VOICE_QUOTA: 'The ElevenLabs account is out of credits, or its plan does not cover this request.',
  VOICE_RATE: 'ElevenLabs is rate limiting this account. Publish again in a minute.',
  VOICE_TIMEOUT: 'ElevenLabs did not answer in the time allowed. Publish again to continue: finished segments are cached.',
  VOICE_BAD_AUDIO: 'ElevenLabs answered with something that is not usable MP3 audio, so it was discarded.',
  VOICE_BUDGET: 'The narration is longer than the character budget (LEARNING_TOOL_VOICE_MAX_CHARS), so nothing was sent.',
  VOICE_NETWORK: 'ElevenLabs could not be reached, or answered in a way this tool does not handle.',
});

/** Why one request, or one whole run, produced no audio. Internal: reports carry only `code` and `status`. */
export interface Failure {
  ok: false;
  code: VoiceFailureCode;
  /** The HTTP status that decided it, when there was a response. */
  status?: number;
  /** The same request is worth another attempt. */
  retry: boolean;
  /** Every further request in this run would fail the same way or cost credits for nothing. */
  stop: boolean;
  /** ElevenLabs refused the voice or the model, so a remembered voice choice may be stale. */
  voiceRefused?: boolean;
  /** The refusal may be about the model and not this text: worth one try with the fallback model. */
  modelSuspect?: boolean;
  retryAfterMs?: number;
}

export const fail = (code: VoiceFailureCode, how: { retry?: boolean; stop?: boolean; status?: number; voiceRefused?: boolean; modelSuspect?: boolean } = {}): Failure => ({
  ok: false,
  code,
  retry: how.retry ?? false,
  stop: how.stop ?? false,
  ...(how.status === undefined ? {} : { status: how.status }),
  ...(how.voiceRefused ? { voiceRefused: true } : {}),
  ...(how.modelSuspect ? { modelSuspect: true } : {}),
});

// Error bodies look like {"detail": {type, code, status, message}} with `status` a legacy alias of
// `code`. Only these known tokens are ever compared; the body itself is dropped. The legacy
// `quota_exceeded` arrives with HTTP 401, which is why a token can override the status.
const QUOTA_TOKENS = new Set(['quota_exceeded', 'insufficient_credits', 'payment_required', 'subscription_required']);
const VOICE_TOKENS = new Set(['voice_not_found', 'invalid_voice_id', 'voice_access_denied', 'model_access_denied', 'model_not_found']);
// Named refusals of the model itself. An unnamed 400 or 422 is also treated as possibly the model.
const MODEL_TOKENS = new Set(['model_access_denied', 'model_not_found', 'invalid_model', 'unsupported_model', 'model_not_supported', 'model_can_not_do_text_to_speech']);

/**
 * Maps a non-200 response to a failure. Retried: 408, 429 and 5xx. Never retried, and they end the
 * run: 401, 402, 403, 404, because the next segment would be refused for the same reason.
 */
export function classifyStatus(status: number, tokens: readonly string[]): Failure {
  const quota = tokens.some((t) => QUOTA_TOKENS.has(t));
  const voice = tokens.some((t) => VOICE_TOKENS.has(t));
  const named = tokens.some((t) => MODEL_TOKENS.has(t));
  const out = classify(status, quota, voice);
  const unnamed = (status === 400 || status === 422) && !quota && !tokens.some((t) => VOICE_TOKENS.has(t) && !MODEL_TOKENS.has(t));
  return named || unnamed ? { ...out, modelSuspect: true } : out;
}

function classify(status: number, quota: boolean, voice: boolean): Failure {
  switch (status) {
    case 401:
      return fail(quota ? 'VOICE_QUOTA' : 'VOICE_AUTH', { stop: true, status });
    case 402:
      return fail('VOICE_QUOTA', { stop: true, status });
    case 403:
      return fail(quota ? 'VOICE_QUOTA' : 'VOICE_AUTH', { stop: true, status, voiceRefused: !quota });
    case 404:
      return fail('VOICE_AUTH', { stop: true, status, voiceRefused: true });
    case 408:
      return fail('VOICE_TIMEOUT', { retry: true, status });
    case 429:
      return fail('VOICE_RATE', { retry: true, status });
    default:
      break;
  }
  if (status >= 500 && status <= 599) return fail('VOICE_NETWORK', { retry: true, status });
  if (status >= 300 && status <= 399) return fail('VOICE_NETWORK', { stop: true, status });
  // A 2xx that is not 200 (204, 206...) is not the audio we asked for.
  if (status >= 200 && status <= 299) return fail('VOICE_BAD_AUDIO', { stop: true, status });
  if (status === 400 && voice) return fail('VOICE_AUTH', { stop: true, status, voiceRefused: true });
  if (status === 400 && quota) return fail('VOICE_QUOTA', { stop: true, status });
  // 400, 409, 413, 422 and the rest: this request is wrong in a way a retry cannot fix, but another
  // segment may still go through.
  return fail('VOICE_NETWORK', { status });
}

// When several segments fail for different reasons, the report names the one the learner has to act
// on first: a bad key matters more than a slow connection.
const SEVERITY: readonly VoiceFailureCode[] = ['VOICE_AUTH', 'VOICE_QUOTA', 'VOICE_BAD_AUDIO', 'VOICE_BUDGET', 'VOICE_RATE', 'VOICE_TIMEOUT', 'VOICE_NETWORK'];

export function worst(failures: readonly Failure[]): Failure | undefined {
  let best: Failure | undefined;
  for (const f of failures) {
    if (!best || SEVERITY.indexOf(f.code) < SEVERITY.indexOf(best.code)) best = f;
  }
  return best;
}
