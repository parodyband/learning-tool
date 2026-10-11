// The canary test. The ElevenLabs key is the one secret this product handles, so this file runs
// synthesis and the setup check with a recognisable fake key through success and every failure the
// stub can produce (including a server that echoes the key back in every place it can) and then
// looks for the key in everything that came out: the resolved value, anything thrown, every log
// line, and every file on disk. It also checks where the key went on the wire: to the stub, in the
// one header, and nowhere else.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { synthesizeLesson, voiceCheck, voiceConfigFromEnv, voiceEnvProblems } from '../../src/tts';
import { loopbackBaseUrl } from '../../src/tts/testing';
import { configure, FAKE_KEY, FAKE_KEY_MARKER, FAST, filesUnder, KEY_VAR, MAX_VAR, MODEL_VAR, segs, useWorld, VOICE_VAR, withGeorge, type World } from './helpers/kit';
import { SILENT_MP3 } from './helpers/silence';
import { ERRORS, GEORGE, STUB_SUBSCRIPTION, STUB_VOICES, type ErrorName, type Reply } from './helpers/stub';

// ---------------------------------------------------------------------------------------------
// The detector
// ---------------------------------------------------------------------------------------------

const NEEDLES = [
  FAKE_KEY.toLowerCase(),
  // The word inside the fake key: finding it anywhere means part of the key got there, however it
  // was cut or re-cased.
  FAKE_KEY_MARKER,
  FAKE_KEY.slice(-16).toLowerCase(),
  Buffer.from(FAKE_KEY).toString('hex'),
  Buffer.from(FAKE_KEY).toString('base64').replace(/=+$/, '').toLowerCase(),
];

/** Every string reachable from `value`: own and hidden properties, error fields, bytes, and decoded base64. */
function strings(value: unknown, out: string[] = [], seen = new Set<unknown>(), depth = 0): string[] {
  if (typeof value === 'string') {
    out.push(value);
    // A long base64 run (a clip) is decoded too, in case the key rode along inside the bytes.
    if (value.length >= 24 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) out.push(Buffer.from(value, 'base64').toString('latin1'));
    return out;
  }
  if (value === null || value === undefined) return out;
  if (typeof value !== 'object' && typeof value !== 'function') {
    out.push(String(value));
    return out;
  }
  if (seen.has(value) || depth > 16) return out;
  seen.add(value);
  if (value instanceof Uint8Array) {
    out.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('latin1'));
    return out;
  }
  if (typeof value === 'function') out.push(value.toString());
  if (value instanceof Error) out.push(value.name, value.message, value.stack ?? '', String(value));
  try {
    out.push(inspect(value, { showHidden: true, depth: 12, getters: true, maxStringLength: Infinity, maxArrayLength: Infinity, breakLength: Infinity }));
  } catch {
    // an object that cannot be inspected is still walked below
  }
  try {
    out.push(JSON.stringify(value) ?? '');
  } catch {
    // circular
  }
  for (const key of Reflect.ownKeys(value)) {
    out.push(String(key));
    try {
      strings((value as Record<PropertyKey, unknown>)[key], out, seen, depth + 1);
    } catch {
      // a getter that throws has nothing to show
    }
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto && ![Object.prototype, Array.prototype, Function.prototype, Error.prototype, TypeError.prototype].includes(proto as object)) strings(proto, out, seen, depth + 1);
  return out;
}

/** The needles found anywhere in `value`. Empty means clean. */
function leaks(value: unknown): string[] {
  const haystack = strings(value).join('\n').toLowerCase();
  return NEEDLES.filter((needle) => haystack.includes(needle));
}

// ---------------------------------------------------------------------------------------------
// Capturing everything the process prints
// ---------------------------------------------------------------------------------------------

const logged: string[] = [];

beforeAll(() => {
  const record = (...args: unknown[]): void => {
    logged.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 8 }))).join(' '));
  };
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table'] as const) vi.spyOn(console, method).mockImplementation(record);
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
      logged.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('latin1'));
      return true;
    });
  }
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------
// A server that hands the key back wherever it can
// ---------------------------------------------------------------------------------------------

const ECHO_HEADERS = { 'x-echo': FAKE_KEY, 'request-id': FAKE_KEY, 'x-your-key': `key=${FAKE_KEY}` };
const echoError = (error: ErrorName): Reply => ({ kind: 'error', error, message: `Invalid API key: ${FAKE_KEY}`, headers: ECHO_HEADERS });
const SPELLINGS = [FAKE_KEY, FAKE_KEY.toUpperCase(), FAKE_KEY.replace(/_/g, '-'), FAKE_KEY.replace(/_/g, ' '), FAKE_KEY.slice(0, 24), FAKE_KEY.slice(20)];

const lesson = segs('Binary search halves the list.', 'It needs sorted data.', 'That is the whole idea.');

type Scenario = [string, (w: World) => Promise<unknown>];

const ttsScenarios: Scenario[] = [
  ['success, voice picked from the account', (w) => w.synth(lesson)],
  ['success, voice configured', (w) => w.synth(lesson, withGeorge())],
  [
    'success, then the same lesson from the cache',
    async (w) => {
      const first = await w.synth(lesson);
      return [first, await w.synth(lesson)];
    },
  ],
  [
    'success, with the key echoed in every response header',
    (w) => {
      w.stub.tts = () => ({ kind: 'audio', headers: ECHO_HEADERS });
      w.stub.voices = () => ({ kind: 'json', body: { voices: STUB_VOICES }, headers: ECHO_HEADERS });
      return w.synth(lesson);
    },
  ],
  ...(Object.keys(ERRORS) as ErrorName[]).map<Scenario>((error) => [
    `text-to-speech answers ${error}, echoing the key`,
    (w) => {
      w.stub.tts = () => echoError(error);
      return w.synth(lesson, withGeorge());
    },
  ]),
  ...(Object.keys(ERRORS) as ErrorName[]).map<Scenario>((error) => [
    `the voice listing answers ${error}, echoing the key`,
    (w) => {
      w.stub.voices = () => echoError(error);
      return w.synth(lesson);
    },
  ]),
  [
    'an error whose machine-readable fields are the key',
    (w) => {
      w.stub.tts = () => ({ kind: 'json', status: 401, body: { detail: { type: FAKE_KEY, code: FAKE_KEY, status: FAKE_KEY, message: FAKE_KEY, request_id: FAKE_KEY } }, headers: ECHO_HEADERS });
      return w.synth(lesson, withGeorge());
    },
  ],
  [
    'the voice listing names voices after the key, in several spellings',
    (w) => {
      w.stub.voices = () => ({ kind: 'json', body: { voices: SPELLINGS.map((name, i) => ({ voice_id: `echoVoice00000000${i}`, name })) } });
      return w.synth(lesson);
    },
  ],
  [
    'the voice listing uses the key as a voice id',
    (w) => {
      w.stub.voices = () => ({
        kind: 'json',
        body: { voices: [{ voice_id: FAKE_KEY, name: 'Key' }, { voice_id: FAKE_KEY.slice(0, 24), name: 'Half' }, { voice_id: FAKE_KEY.slice(-20), name: 'Tail' }, STUB_VOICES[1]] },
      });
      return w.synth(lesson);
    },
  ],
  [
    'the voice listing offers only the key as a voice id',
    (w) => {
      w.stub.voices = () => ({ kind: 'json', body: { voices: [{ voice_id: FAKE_KEY, name: FAKE_KEY }] } });
      return w.synth(lesson);
    },
  ],
  [
    'a remembered voice file that someone filled with the key',
    async (w) => {
      await mkdir(w.cacheDir, { recursive: true });
      await writeFile(path.join(w.cacheDir, 'voice.json'), JSON.stringify({ id: FAKE_KEY, name: FAKE_KEY, at: Date.now() }));
      return w.synth(lesson);
    },
  ],
  [
    'a redirect whose Location carries the key',
    (w) => {
      w.stub.tts = () => ({ kind: 'redirect', status: 307, location: `${w.trap.origin}/collect?xi-api-key=${FAKE_KEY}` });
      return w.synth(lesson, withGeorge());
    },
  ],
  [
    'a redirect from the voice listing',
    (w) => {
      w.stub.voices = () => ({ kind: 'redirect', status: 302, location: `${w.trap.origin}/v2/voices?k=${FAKE_KEY}` });
      return w.synth(lesson);
    },
  ],
  [
    'an HTML page that quotes the key',
    (w) => {
      w.stub.tts = () => ({ kind: 'raw', status: 200, contentType: 'text/html', body: `<html>Your key ${FAKE_KEY} is blocked</html>`, headers: ECHO_HEADERS });
      return w.synth(lesson, withGeorge());
    },
  ],
  [
    'text labelled as audio that quotes the key',
    (w) => {
      w.stub.tts = () => ({ kind: 'raw', status: 200, contentType: 'audio/mpeg', body: `ID3 ${FAKE_KEY}` });
      return w.synth(lesson, withGeorge());
    },
  ],
  [
    'a voice listing that is not JSON and quotes the key',
    (w) => {
      w.stub.voices = () => ({ kind: 'raw', status: 200, contentType: 'application/json', body: `{"voices": [${FAKE_KEY}` });
      return w.synth(lesson);
    },
  ],
  [
    'a dropped connection',
    (w) => {
      w.stub.tts = () => ({ kind: 'reset' });
      return w.synth(lesson, withGeorge());
    },
  ],
  [
    'a body cut short',
    (w) => {
      w.stub.tts = () => ({ kind: 'truncate' });
      return w.synth(lesson, withGeorge());
    },
  ],
  [
    'requests that time out',
    (w) => {
      w.stub.tts = () => ({ kind: 'hang' });
      return w.synth(lesson, withGeorge(), { tuning: { backoffMs: [2, 4], requestTimeoutMs: 60 } });
    },
  ],
  [
    'a body that stalls',
    (w) => {
      w.stub.tts = () => ({ kind: 'stall' });
      return w.synth(lesson, withGeorge(), { tuning: { backoffMs: [2, 4], requestTimeoutMs: 60 } });
    },
  ],
  [
    'the deadline cutting a run short, then a second run finishing it',
    async (w) => {
      w.stub.tts = (req) => ((req.json as { text: string }).text.startsWith('Binary') ? { kind: 'audio' } : { kind: 'hang' });
      const cut = await w.synth(lesson, withGeorge(), { deadlineMs: 200, tuning: { backoffMs: [2, 4], requestTimeoutMs: 30_000 } });
      w.stub.tts = () => ({ kind: 'audio' });
      return [cut, await w.synth(lesson, withGeorge())];
    },
  ],
  [
    'the caller aborting',
    (w) => {
      w.stub.tts = () => ({ kind: 'hang' });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 40);
      return w.synth(lesson, withGeorge(), { signal: controller.signal });
    },
  ],
  ['over the character budget', (w) => w.synth(lesson, configure({ [MAX_VAR]: '10' }))],
  ['voice off', (w) => w.synth(lesson, null)],
  [
    'a cache directory that cannot be used',
    async (w) => {
      await mkdir(path.dirname(w.cacheDir), { recursive: true });
      await writeFile(w.cacheDir, 'not a directory');
      return w.synth(lesson);
    },
  ],
  [
    'a fetch that throws an error quoting the key, as undici does for a bad header',
    (w) => {
      const thrower = (async () => {
        throw new TypeError(`Headers.append: "${FAKE_KEY}" is an invalid header value.`, { cause: new Error(`xi-api-key: ${FAKE_KEY}`) });
      }) as unknown as typeof fetch;
      return synthesizeLesson(lesson, withGeorge(), { cacheDir: w.cacheDir, fetch: thrower, tuning: FAST });
    },
  ],
  [
    'a fetch that answers with an object carrying the key',
    (w) => {
      const odd = (async () => ({ status: 500, key: FAKE_KEY, headers: new Headers(ECHO_HEADERS), body: null })) as unknown as typeof fetch;
      return synthesizeLesson(lesson, withGeorge(), { cacheDir: w.cacheDir, fetch: odd, tuning: FAST });
    },
  ],
  ['a call with a copied configuration (throws)', (w) => w.synth(lesson, { ...withGeorge() })],
  ['a call with a string base URL (throws)', (w) => synthesizeLesson(lesson, withGeorge(), { cacheDir: w.cacheDir, baseUrl: `${w.stub.origin}/?k=${FAKE_KEY}` as never })],
  ['a call with a relative cache directory (throws)', () => synthesizeLesson(lesson, withGeorge(), { cacheDir: `cache-${FAKE_KEY}` })],
];

const checkScenarios: Scenario[] = [
  ['check: everything fine', (w) => w.check()],
  ['check: voice off, with the environment', (w) => w.check(null, { env: { [KEY_VAR]: FAKE_KEY, [MODEL_VAR]: FAKE_KEY, [VOICE_VAR]: FAKE_KEY } })],
  ...(Object.keys(ERRORS) as ErrorName[]).map<Scenario>((error) => [
    `check: both reads answer ${error}, echoing the key`,
    (w) => {
      w.stub.subscription = () => echoError(error);
      w.stub.voices = () => echoError(error);
      return w.check();
    },
  ]),
  [
    'check: a subscription that reports the key as its tier',
    async (w) => {
      const out: unknown[] = [];
      for (const tier of [...SPELLINGS, FAKE_KEY.toLowerCase().slice(10, 34)]) {
        w.stub.subscription = () => ({ kind: 'json', body: { ...STUB_SUBSCRIPTION, tier, status: tier }, headers: ECHO_HEADERS });
        out.push(await w.check());
      }
      return out;
    },
  ],
  [
    'check: voices named after the key',
    (w) => {
      w.stub.voices = () => ({ kind: 'json', body: { voices: [{ voice_id: FAKE_KEY, name: FAKE_KEY }, ...STUB_VOICES] }, headers: ECHO_HEADERS });
      return w.check();
    },
  ],
  [
    'check: redirects carrying the key',
    (w) => {
      w.stub.subscription = () => ({ kind: 'redirect', status: 307, location: `${w.trap.origin}/s?k=${FAKE_KEY}` });
      w.stub.voices = () => ({ kind: 'redirect', status: 301, location: `${w.trap.origin}/v?k=${FAKE_KEY}` });
      return w.check();
    },
  ],
  [
    'check: nothing answers',
    (w) => {
      w.stub.subscription = () => ({ kind: 'hang' });
      w.stub.voices = () => ({ kind: 'reset' });
      return w.check(undefined, { timeoutMs: 200 });
    },
  ],
  [
    'check: garbage that quotes the key',
    (w) => {
      w.stub.subscription = () => ({ kind: 'raw', status: 200, contentType: 'text/html', body: `<html>${FAKE_KEY}</html>` });
      w.stub.voices = () => ({ kind: 'raw', status: 200, contentType: 'application/json', body: `"${FAKE_KEY}"` });
      return w.check();
    },
  ],
  ['check: a string base URL (throws)', (w) => voiceCheck(configure(), { baseUrl: `${w.stub.origin}/?k=${FAKE_KEY}` as never })],
];

// ---------------------------------------------------------------------------------------------

describe('the detector itself', () => {
  it('finds the key however it is carried', () => {
    const hidden = {};
    Object.defineProperty(hidden, 'secret', { value: FAKE_KEY, enumerable: false });
    const viaGetter = {
      get key() {
        return FAKE_KEY;
      },
    };
    const carriers: unknown[] = [
      FAKE_KEY,
      `prefix ${FAKE_KEY} suffix`,
      FAKE_KEY.toUpperCase(),
      FAKE_KEY.slice(3, 30),
      Buffer.from(FAKE_KEY).toString('base64'),
      Buffer.from(FAKE_KEY).toString('hex'),
      { report: { segments: [{ note: FAKE_KEY }] } },
      [new Error(`failed with ${FAKE_KEY}`)],
      new Error('outer', { cause: new Error(FAKE_KEY) }),
      hidden,
      viaGetter,
      { [FAKE_KEY]: 1 },
      { [Symbol(FAKE_KEY)]: 1 },
      new Map([['k', FAKE_KEY]]),
      new Uint8Array(Buffer.from(`ID3 ${FAKE_KEY}`)),
      { clip: Buffer.from(`\u0000\u0001 audio ${FAKE_KEY} more`).toString('base64') },
      { headers: new Headers({ 'xi-api-key': FAKE_KEY }) },
      () => 'sk_ZZFAKEKEYZZ'.length,
    ];
    for (const carrier of carriers) expect(leaks(carrier), inspect(carrier).slice(0, 60)).not.toEqual([]);
  });

  it('finds nothing in an ordinary result', async () => {
    expect(leaks({ code: 'VOICE_OK', clips: [{ segmentId: 's1', mime: 'audio/mpeg', base64: Buffer.from(SILENT_MP3).toString('base64') }] })).toEqual([]);
  });

  it('sees what is printed', () => {
    console.log(`debug: ${FAKE_KEY}`);
    console.error(new Error(FAKE_KEY));
    process.stdout.write(`${FAKE_KEY}\n`);
    process.stderr.write(Buffer.from(FAKE_KEY));
    expect(logged).toHaveLength(4);
    for (const line of logged) expect(leaks(line)).not.toEqual([]);
    logged.length = 0;
  });
});

describe('the key appears in nothing the voice module produces', () => {
  const w = useWorld();

  it.each([...ttsScenarios, ...checkScenarios])('%s', async (_name, scenario) => {
    logged.length = 0;
    let produced: unknown;
    try {
      produced = { resolved: await scenario(w) };
    } catch (err) {
      produced = { thrown: err };
    }
    // Let anything still settling (an aborted request, a late timer) finish and have its say.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(leaks(produced), 'in the value returned or the error thrown').toEqual([]);
    expect(leaks(logged), 'in a log line').toEqual([]);
    expect(logged, 'the module prints nothing at all').toEqual([]);
    const files = await filesUnder(w.home);
    expect(leaks(files.map((f) => f.name)), 'in a file name').toEqual([]);
    for (const file of files) expect(leaks(file.bytes), `in the contents of ${file.name}`).toEqual([]);

    // On the wire: the key is in the one header of requests to the stub, and nowhere else at all.
    expect(w.trap.requests, 'the other server heard nothing').toEqual([]);
    for (const req of w.stub.requests) {
      expect(req.headers['xi-api-key']).toBe(FAKE_KEY);
      const { 'xi-api-key': _key, ...otherHeaders } = req.headers;
      expect(leaks([req.method, req.path, req.query, req.body, otherHeaders]), `elsewhere in ${req.method} ${req.path}`).toEqual([]);
    }
  });

  it('covered both success and failure with real requests', async () => {
    // Guards the table above against a setup mistake that would make every scenario a no-op.
    const ok = await w.synth(lesson);
    expect(ok.report.code).toBe('VOICE_OK');
    expect(ok.clips).toHaveLength(3);
    expect(w.stub.requests.length).toBe(4);
    expect(w.stub.requests.every((r) => r.headers['xi-api-key'] === FAKE_KEY)).toBe(true);
    w.stub.tts = () => echoError('bad_key');
    expect((await w.synth(segs('Something new.'))).report.code).toBe('VOICE_AUTH');
  });
});

describe('the key appears in nothing else the module hands out', () => {
  it('the configuration object, however it is looked at', () => {
    const config = voiceConfigFromEnv({ [KEY_VAR]: FAKE_KEY, [VOICE_VAR]: GEORGE, [MODEL_VAR]: 'eleven_flash_v2_5', [MAX_VAR]: '500' });
    expect(config).not.toBeNull();
    expect(leaks(config)).toEqual([]);
    expect(leaks(structuredClone(config))).toEqual([]);
    expect(leaks(Object.getOwnPropertyDescriptors(config))).toEqual([]);
  });

  it('the list of setting problems, even when the key was pasted into every variable', () => {
    const everywhere = { [KEY_VAR]: FAKE_KEY, [VOICE_VAR]: FAKE_KEY, [MODEL_VAR]: FAKE_KEY, [MAX_VAR]: FAKE_KEY };
    expect(voiceConfigFromEnv(everywhere)).toBeNull();
    const problems = voiceEnvProblems(everywhere);
    expect(problems.map((p) => p.variable)).toEqual([VOICE_VAR, MODEL_VAR, MAX_VAR]);
    expect(leaks(problems)).toEqual([]);
    expect(leaks(voiceEnvProblems({ [KEY_VAR]: `${FAKE_KEY} with spaces` }))).toEqual([]);
  });

  it('a base URL token, and the error for a refused one', () => {
    expect(leaks(loopbackBaseUrl('http://127.0.0.1:9'))).toEqual([]);
    let thrown: unknown;
    try {
      loopbackBaseUrl(`http://example.com/?k=${FAKE_KEY}`);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(leaks(thrown)).toEqual([]);
  });

  it('the process environment is not written to', () => {
    expect(leaks(Object.entries(process.env))).toEqual([]);
  });
});
