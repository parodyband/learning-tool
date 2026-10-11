// The key may be sent to one origin. The only override is a token minted in test code, which no JSON
// value (a tool argument, a draft) can be or become.
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../../src/tts';
import { synthesizeLesson, voiceCheck } from '../../src/tts';
import { ELEVENLABS_ORIGIN, resolveOrigin } from '../../src/tts/origin';
import { loopbackBaseUrl } from '../../src/tts/testing';
import { FAST, segs, useWorld, withGeorge } from './helpers/kit';

describe('loopbackBaseUrl', () => {
  it.each(['http://127.0.0.1:8080', 'http://127.0.0.1:1/', 'http://[::1]:9000'])('accepts %s', (url) => {
    expect(resolveOrigin(loopbackBaseUrl(url))).toBe(new URL(url).origin);
  });

  it.each([
    ['another host', 'http://example.com:8080'],
    ['the real API over http', 'http://api.elevenlabs.io:80'],
    ['a look-alike of the real API', 'https://api.elevenlabs.io.example.com'],
    ['https on loopback', 'https://127.0.0.1:8443'],
    ['a name that usually means loopback', 'http://localhost:8080'],
    ['a LAN address', 'http://192.168.1.10:8080'],
    ['all interfaces', 'http://0.0.0.0:8080'],
    ['another loopback address', 'http://127.0.0.2:8080'],
    ['loopback with credentials', 'http://user:pass@127.0.0.1:8080'],
    ['loopback as a username', 'http://127.0.0.1:8080@example.com'],
    ['loopback with a path', 'http://127.0.0.1:8080/proxy'],
    ['loopback with a query', 'http://127.0.0.1:8080/?next=https://example.com'],
    ['loopback with a fragment', 'http://127.0.0.1:8080/#x'],
    ['loopback with no port', 'http://127.0.0.1'],
    ['a decimal spelling of another address', 'http://3232235786:8080'],
    ['a file URL', 'file:///etc/passwd'],
    ['not a URL', 'stub'],
    ['an empty string', ''],
  ])('refuses %s', (_name, url) => {
    expect(() => loopbackBaseUrl(url)).toThrow(TypeError);
  });

  it('returns a frozen token with nothing readable on it', () => {
    const token = loopbackBaseUrl('http://127.0.0.1:8080');
    expect(Object.isFrozen(token)).toBe(true);
    expect(Reflect.ownKeys(token)).toEqual([]);
    expect(JSON.stringify(token)).toBe('{}');
  });
});

describe('resolveOrigin', () => {
  it('is the production origin when nothing is given', () => {
    expect(resolveOrigin(undefined)).toBe('https://api.elevenlabs.io');
    expect(ELEVENLABS_ORIGIN).toBe('https://api.elevenlabs.io');
  });

  const token = loopbackBaseUrl('http://127.0.0.1:8080');
  it.each([
    ['a string, as a tool argument would carry', 'http://127.0.0.1:8080'],
    ['the production origin as a string', 'https://api.elevenlabs.io'],
    ['a URL object', new URL('http://127.0.0.1:8080')],
    ['an empty object', {}],
    ['a token after a JSON round trip, as a draft would store it', JSON.parse(JSON.stringify(token))],
    ['a spread copy of a token', { ...token }],
    ['a structured clone of a token', structuredClone(token)],
    ['an object shaped like a config', { origin: 'http://127.0.0.1:8080', href: 'http://127.0.0.1:8080/' }],
    ['null', null],
    ['a number', 8080],
    ['a function', () => 'http://127.0.0.1:8080'],
  ])('refuses %s', (_name, value) => {
    expect(() => resolveOrigin(value)).toThrow(TypeError);
  });
});

describe('a base URL that did not come from loopbackBaseUrl', () => {
  const w = useWorld();
  const forged = (w0: { stub: { origin: string } }): unknown[] => [
    w0.stub.origin,
    new URL(w0.stub.origin),
    { origin: w0.stub.origin },
    JSON.parse(JSON.stringify(loopbackBaseUrl(w0.stub.origin))),
  ];

  it('is refused by synthesizeLesson before anything is sent, even when it names the stub itself', async () => {
    for (const baseUrl of forged(w)) {
      await expect(synthesizeLesson(segs('One.'), withGeorge(), { cacheDir: w.cacheDir, baseUrl: baseUrl as never, tuning: FAST })).rejects.toBeInstanceOf(TypeError);
    }
    expect(w.stub.requests).toEqual([]);
    expect(w.trap.requests).toEqual([]);
  });

  it('is refused by voiceCheck before anything is sent', async () => {
    for (const baseUrl of forged(w)) {
      await expect(voiceCheck(withGeorge(), { baseUrl: baseUrl as never })).rejects.toBeInstanceOf(TypeError);
    }
    expect(w.stub.requests).toEqual([]);
  });

  it('is refused even with voice off, so a mistake shows up in any test', async () => {
    await expect(synthesizeLesson(segs('One.'), null, { cacheDir: w.cacheDir, baseUrl: w.stub.origin as never })).rejects.toBeInstanceOf(TypeError);
  });
});

describe('the public module', () => {
  it('does not export a way to mint a base URL', () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      'DEFAULT_DEADLINE_MS',
      'ELEVENLABS_ORIGIN',
      'OUTPUT_FORMAT',
      'VOICE_CODES',
      'VOICE_MESSAGES',
      'formatVoiceCheck',
      'synthesizeLesson',
      'voiceCharacters',
      'voiceCheck',
      'voiceConfigFromEnv',
      'voiceEnvProblems',
    ]);
  });

  it('bundled the way the server is bundled, contains no way to send the key anywhere but ElevenLabs', async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL('../../src/tts/index.ts', import.meta.url))],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      write: false,
      legalComments: 'none',
      logLevel: 'silent',
    });
    const code = result.outputFiles[0]!.text;
    expect(code).toContain('https://api.elevenlabs.io');
    // The loopback factory is tree-shaken away: nothing in the bundle ever adds to the registry.
    expect(code).not.toMatch(/function loopbackBaseUrl|loopbackBaseUrl\s*[=:]/);
    expect(code).not.toContain('can stand in for ElevenLabs');
    expect(code).not.toMatch(/REGISTRY\w*\.set\(/);
    expect(code).toMatch(/REGISTRY\w*\.get\(/);
    // Every absolute URL in the bundle is the production origin.
    const urls = code.match(/\bhttps?:\/\/[A-Za-z0-9.[\]:-]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    expect([...new Set(urls)]).toEqual(['https://api.elevenlabs.io']);
    // The environment is handed in, never reached for, and the only variable names in the bundle
    // as strings are our four: the generic ELEVENLABS_API_KEY is not among them.
    expect(code).not.toMatch(/process\.env/);
    const names = [...code.matchAll(/["'`]([A-Z][A-Z0-9_]{7,})["'`]/g)].map((m) => m[1]!).filter((n) => /ELEVEN|LEARNING_TOOL|API_KEY/.test(n));
    expect([...new Set(names)].sort()).toEqual([
      'LEARNING_TOOL_ELEVENLABS_API_KEY',
      'LEARNING_TOOL_ELEVENLABS_MODEL',
      'LEARNING_TOOL_ELEVENLABS_VOICE_ID',
      'LEARNING_TOOL_VOICE_MAX_CHARS',
    ]);
    expect(code).not.toMatch(/\bconsole\./);
    expect(code).not.toMatch(/process\.(stdout|stderr)/);
  });
});
