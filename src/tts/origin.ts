// Where the key may be sent. There are exactly two answers: the production origin below, which is a
// constant, or a loopback address that a test minted in code.
//
// The override is an opaque object, not a string, on purpose. Tool arguments and drafts are JSON, and
// no JSON value is a member of the registry below, so nothing an agent or a stored lesson supplies
// can ever redirect the key. Even code that calls `loopbackBaseUrl` can only name this machine.

/** The only place the ElevenLabs key is sent outside tests. */
export const ELEVENLABS_ORIGIN = 'https://api.elevenlabs.io';

declare const loopback: unique symbol;

/** A stand-in origin for tests, made by `loopbackBaseUrl` (exported from `src/tts/testing`). It has no readable properties. */
export interface TestBaseUrl {
  readonly [loopback]: true;
}

const REGISTRY = new WeakMap<object, string>();

/**
 * Tests only. Returns a token that makes the voice module talk to a local stub instead of
 * ElevenLabs. Accepts `http://127.0.0.1:<port>` or `http://[::1]:<port>` and nothing else.
 */
export function loopbackBaseUrl(url: string): TestBaseUrl {
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  const local =
    parsed !== undefined &&
    parsed.protocol === 'http:' &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]') &&
    parsed.port !== '' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.pathname === '/' &&
    parsed.search === '' &&
    parsed.hash === '';
  if (!parsed || !local) throw new TypeError('loopbackBaseUrl: only http://127.0.0.1:<port> or http://[::1]:<port> can stand in for ElevenLabs.');
  const token = Object.freeze(Object.create(null) as object);
  REGISTRY.set(token, parsed.origin);
  return token as TestBaseUrl;
}

/** The origin a request goes to. Throws on anything that is neither absent nor a token from `loopbackBaseUrl`. */
export function resolveOrigin(baseUrl: unknown): string {
  if (baseUrl === undefined) return ELEVENLABS_ORIGIN;
  const origin = typeof baseUrl === 'object' && baseUrl !== null ? REGISTRY.get(baseUrl) : undefined;
  if (origin === undefined) throw new TypeError('baseUrl is for tests and must be a value made by loopbackBaseUrl(); leave it out to use ElevenLabs.');
  return origin;
}
