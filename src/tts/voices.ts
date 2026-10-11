// Choosing a voice. No voice id is safe to hard-code: the premade voices exist only on accounts
// created before March 2026 and are withdrawn at the end of 2026. So unless the learner names one,
// the choice is made from the voices the account itself lists.
import { ID_PATTERN } from './config';
import { fail } from './codes';
import { call, readJsonObject, type CallContext, type CallResult, type Secret } from './http';

export interface Voice {
  id: string;
  /** Display name for the attribution line. Sanitised; never raw response text. */
  name: string;
}

export const FALLBACK_VOICE_NAME = 'ElevenLabs voice';

// Tried in this order when the account lists them; each is a clear narration voice.
const PREFERRED: readonly Voice[] = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel' },
];

const VOICES_BODY_CAP = 2 * 1024 * 1024;
const MAX_LISTED = 200;

/**
 * A voice name fit to show a learner: letters, digits and plain punctuation, at most 40 characters.
 * The name is the one piece of response text that is displayed, so it is cut down hard, and dropped
 * entirely if it resembles the key.
 */
export function displayName(raw: unknown, secret: Secret): string {
  if (typeof raw !== 'string' || secret.mentions(raw)) return FALLBACK_VOICE_NAME;
  const clean = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N} .,'&()-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const short = [...clean].slice(0, 40).join('').trim();
  return short === '' ? FALLBACK_VOICE_NAME : short;
}

/** The name to show for a voice id the learner configured: ours for the voices we know, generic otherwise. */
export function knownVoiceName(id: string): string {
  return PREFERRED.find((v) => v.id === id)?.name ?? FALLBACK_VOICE_NAME;
}

/** Lists the voices this key can use: `GET /v2/voices`, first page. Entries with an unusable id are skipped. */
export function listVoices(ctx: CallContext): Promise<CallResult<Voice[]>> {
  return call<Voice[]>(ctx, {
    method: 'GET',
    path: '/v2/voices',
    query: { page_size: '100' },
    accept: 'application/json',
    async read(res) {
      const body = await readJsonObject(res, VOICES_BODY_CAP);
      if (!body || !Array.isArray(body.voices)) return fail('VOICE_NETWORK', { stop: true, status: 200 });
      const voices: Voice[] = [];
      for (const entry of body.voices.slice(0, MAX_LISTED) as unknown[]) {
        if (typeof entry !== 'object' || entry === null) continue;
        const { voice_id: id, name } = entry as Record<string, unknown>;
        if (typeof id !== 'string' || !ID_PATTERN.test(id) || ctx.secret.mentions(id)) continue;
        if (voices.some((v) => v.id === id)) continue;
        voices.push({ id, name: displayName(name, ctx.secret) });
      }
      return { ok: true, value: voices };
    },
  });
}

/**
 * Picks a voice from the account's list: the one used last time if it is still there (a different
 * voice would invalidate every cached clip), else the first preferred voice, else the first listed.
 */
export function pickVoice(listed: readonly Voice[], previousId?: string): Voice | null {
  const previous = previousId === undefined ? undefined : listed.find((v) => v.id === previousId);
  if (previous) return previous;
  for (const preferred of PREFERRED) {
    const found = listed.find((v) => v.id === preferred.id);
    if (found) return found;
  }
  return listed[0] ?? null;
}
