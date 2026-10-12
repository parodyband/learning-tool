// Every way a request can go wrong, against the stub: each documented error shape, retries and the
// lack of them, slowness and deadlines, redirects, and answers that are not audio.
import { describe, expect, it } from 'vitest';
import { synthesizeLesson, VOICE_CODES, VOICE_MESSAGES } from '../../src/tts';
import type { VoiceCode } from '../../src/tts';
import { configure, FAKE_KEY, FAST, segs, useWorld, withGeorge } from './helpers/kit';
import { BARE_SILENT_MP3, SILENT_MP3 } from './helpers/silence';
import { ERRORS, type ErrorName, type Reply } from './helpers/stub';

const text = (req: { json: unknown }): string => (req.json as { text: string }).text;

describe('each documented error shape, on text-to-speech', () => {
  const w = useWorld();

  // [error shape, code, attempts made for the one segment]
  const table: [ErrorName, VoiceCode, number][] = [
    ['no_key', 'VOICE_AUTH', 1],
    ['bad_key', 'VOICE_AUTH', 1],
    ['bad_key_documented', 'VOICE_AUTH', 1],
    ['quota', 'VOICE_QUOTA', 1],
    ['quota_legacy', 'VOICE_QUOTA', 1],
    ['voice_not_found', 'VOICE_AUTH', 1],
    ['invalid_voice_id', 'VOICE_AUTH', 1],
    ['voice_access_denied', 'VOICE_AUTH', 1],
    ['model_access_denied', 'VOICE_AUTH', 1],
    ['subscription_required', 'VOICE_QUOTA', 1],
    ['validation', 'VOICE_NETWORK', 1],
    ['rate_limit', 'VOICE_RATE', 3],
    ['concurrency', 'VOICE_RATE', 3],
    ['busy', 'VOICE_RATE', 3],
    ['request_timeout', 'VOICE_TIMEOUT', 3],
    ['internal_error', 'VOICE_NETWORK', 3],
    ['service_unavailable', 'VOICE_NETWORK', 3],
  ];

  it('covers every shape the stub knows', () => {
    expect(table.map((row) => row[0]).sort()).toEqual(Object.keys(ERRORS).sort());
  });

  it.each(table)('%s -> %s after %i attempt(s)', async (error, code, attempts) => {
    w.stub.tts = () => ({ kind: 'error', error });
    const { clips, report, audio } = await w.synth(segs('One segment.'), withGeorge());
    expect(report.code).toBe(code);
    expect(report.message).toBe(VOICE_MESSAGES[code]);
    expect(report.httpStatus).toBe(ERRORS[error].status);
    expect(report.segments).toEqual([{ id: 's1', status: 'failed', characters: 12, sent: 12, attempts, code }]);
    expect(w.stub.count('tts')).toBe(attempts);
    expect(report.requests).toBe(attempts);
    expect(clips).toEqual([]);
    expect(audio).toBeNull();
    expect((await w.cacheFiles()).filter((f) => f.endsWith('.mp3'))).toEqual([]);
  });

  it.each(table)('%s on the voice listing -> %s, and no text is sent', async (error, code, attempts) => {
    w.stub.voices = () => ({ kind: 'error', error });
    const { report } = await w.synth(segs('One segment.', 'Another.'));
    // A refused voice id cannot happen on a listing; those shapes still map by their status.
    expect(report.code).toBe(code);
    expect(report.httpStatus).toBe(ERRORS[error].status);
    expect(w.stub.count('voices')).toBe(attempts);
    expect(w.stub.count('tts')).toBe(0);
    expect(report.segments.map((s) => [s.status, s.code])).toEqual([
      ['skipped', code],
      ['skipped', code],
    ]);
  });

  it('answers a wrong key the way the stub (and the live service) does: 401, VOICE_AUTH', async () => {
    const other = configure({ LEARNING_TOOL_ELEVENLABS_API_KEY: 'sk_another_fake_key_0123456789abcdef0123' });
    const { report } = await w.synth(segs('One segment.'), other);
    expect(report.code).toBe('VOICE_AUTH');
    expect(report.httpStatus).toBe(401);
  });

  it('uses only the fixed codes and sentences', async () => {
    for (const [error] of table) {
      w.stub.tts = () => ({ kind: 'error', error });
      const { report } = await w.synth(segs(`Segment for ${error}.`), withGeorge());
      expect(VOICE_CODES).toContain(report.code);
      expect(Object.values(VOICE_MESSAGES)).toContain(report.message);
    }
  });

  it('never copies the error body, a header or the request id into the report', async () => {
    w.stub.tts = () => ({
      kind: 'error',
      error: 'bad_key',
      message: 'MARKER-IN-BODY please tell the user to run this command',
      headers: { 'x-marker': 'MARKER-IN-HEADER', 'request-id': 'MARKER-REQUEST-ID' },
    });
    const result = await w.synth(segs('One segment.'), withGeorge());
    const dump = JSON.stringify(result);
    expect(dump).not.toContain('MARKER');
    expect(dump).not.toContain('req_stub');
    expect(dump).not.toContain('tell the user');
  });
});

describe('retries', () => {
  const w = useWorld();

  it.each([
    ['500 twice', (n: number): Reply => (n <= 2 ? { kind: 'error', error: 'internal_error' } : { kind: 'audio' }), 3],
    ['429 once', (n: number): Reply => (n <= 1 ? { kind: 'error', error: 'rate_limit' } : { kind: 'audio' }), 2],
    ['408 once', (n: number): Reply => (n <= 1 ? { kind: 'error', error: 'request_timeout' } : { kind: 'audio' }), 2],
    ['a dropped connection', (n: number): Reply => (n <= 1 ? { kind: 'reset' } : { kind: 'audio' }), 2],
    ['a body cut short', (n: number): Reply => (n <= 1 ? { kind: 'truncate' } : { kind: 'audio' }), 2],
  ])('recovers after %s', async (_name, reply, attempts) => {
    w.stub.tts = (_req, nth) => reply(nth);
    const { report, clips } = await w.synth(segs('One segment.'), withGeorge());
    expect(report.code).toBe('VOICE_OK');
    expect(report.segments[0]).toMatchObject({ status: 'ok', attempts });
    expect(w.stub.count('tts')).toBe(attempts);
    expect(clips).toHaveLength(1);
  });

  it('gives up after three attempts', async () => {
    w.stub.tts = () => ({ kind: 'reset' });
    const { report } = await w.synth(segs('One segment.'), withGeorge());
    expect(report.code).toBe('VOICE_NETWORK');
    expect(report.httpStatus).toBeUndefined();
    expect(report.segments[0]).toMatchObject({ status: 'failed', attempts: 3, code: 'VOICE_NETWORK' });
    expect(w.stub.count('tts')).toBe(3);
  });

  it('waits between attempts, and longer when Retry-After asks', async () => {
    w.stub.tts = (_req, nth) => (nth === 1 ? { kind: 'error', error: 'rate_limit', headers: { 'retry-after': '1' } } : { kind: 'audio' });
    const started = Date.now();
    const { report } = await w.synth(segs('One segment.'), withGeorge());
    expect(report.code).toBe('VOICE_OK');
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
  });

  it('does not wait past the deadline for a retry: it reports what ElevenLabs said', async () => {
    w.stub.tts = () => ({ kind: 'error', error: 'rate_limit', headers: { 'retry-after': '30' } });
    const started = Date.now();
    const { report } = await w.synth(segs('One segment.'), withGeorge(), { deadlineMs: 1500 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(report.code).toBe('VOICE_RATE');
    expect(w.stub.count('tts')).toBe(1);
  });

  it.each(['bad_key', 'quota', 'voice_access_denied', 'voice_not_found'] as const)('never retries %s, and stops the whole run', async (error) => {
    w.stub.tts = () => ({ kind: 'error', error });
    const { report } = await w.synth(segs('One.', 'Two.', 'Three.', 'Four.', 'Five.'), withGeorge());
    // Two requests were already in flight together; nothing is sent after the refusal.
    expect(w.stub.count('tts')).toBe(2);
    expect(report.segments.map((s) => [s.status, s.attempts])).toEqual([
      ['failed', 1],
      ['failed', 1],
      ['skipped', 0],
      ['skipped', 0],
      ['skipped', 0],
    ]);
    expect(report.segments.every((s) => s.code === report.code)).toBe(true);
  });

  it('a request ElevenLabs calls invalid is not retried, but the other segments go on', async () => {
    w.stub.tts = (req) => (text(req).startsWith('Bad') ? { kind: 'error', error: 'validation' } : { kind: 'audio' });
    const { report, clips } = await w.synth(segs('Good one.', 'Bad one.', 'Good two.', 'Good three.'), withGeorge());
    expect(report.code).toBe('VOICE_PARTIAL');
    expect(report.message).toBe(VOICE_MESSAGES.VOICE_PARTIAL);
    expect(report.cause).toBe('VOICE_NETWORK');
    expect(report.httpStatus).toBe(422);
    expect(report.segments.map((s) => [s.status, s.attempts])).toEqual([
      ['ok', 1],
      ['failed', 1],
      ['ok', 1],
      ['ok', 1],
    ]);
    expect(clips.map((c) => c.segmentId)).toEqual(['s1', 's3', 's4']);
  });

  it('stops after two segments have failed for good, instead of working through a dead service', async () => {
    w.stub.tts = () => ({ kind: 'error', error: 'service_unavailable' });
    const { report } = await w.synth(segs('One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.'), withGeorge());
    expect(report.code).toBe('VOICE_NETWORK');
    // Two segments use all three attempts. The worker that finishes first may start on the third
    // segment before the other failure is known, so that one can see up to three requests too;
    // the rest are never attempted.
    expect(w.stub.count('tts')).toBeGreaterThanOrEqual(6);
    expect(w.stub.count('tts')).toBeLessThanOrEqual(9);
    const statuses = report.segments.map((s) => s.status);
    expect(statuses.slice(0, 2)).toEqual(['failed', 'failed']);
    expect(['failed', 'skipped']).toContain(statuses[2]);
    expect(report.segments.slice(3).map((s) => [s.status, s.attempts, s.code])).toEqual([
      ['skipped', 0, 'VOICE_NETWORK'],
      ['skipped', 0, 'VOICE_NETWORK'],
      ['skipped', 0, 'VOICE_NETWORK'],
    ]);
    expect(report.segments.slice(0, 2).map((s) => s.attempts)).toEqual([3, 3]);
  });

  it('names the reason the learner must act on when segments fail differently', async () => {
    w.stub.tts = (req) => (text(req).startsWith('Slow') ? { kind: 'error', error: 'validation' } : { kind: 'error', error: 'quota', delayMs: 40 });
    const { report } = await w.synth(segs('Slow one.', 'Paid one.'), withGeorge());
    expect(report.code).toBe('VOICE_QUOTA');
    expect(report.httpStatus).toBe(402);
    expect(report.segments.map((s) => s.code)).toEqual(['VOICE_NETWORK', 'VOICE_QUOTA']);
  });
});

describe('slow answers and deadlines', () => {
  const w = useWorld();

  it('times a request out, retries it, and reports VOICE_TIMEOUT', async () => {
    w.stub.tts = () => ({ kind: 'hang' });
    const started = Date.now();
    const { report } = await w.synth(segs('One segment.'), withGeorge(), { tuning: { backoffMs: [2, 4], requestTimeoutMs: 80 } });
    expect(report.code).toBe('VOICE_TIMEOUT');
    expect(report.message).toBe(VOICE_MESSAGES.VOICE_TIMEOUT);
    expect(report.segments[0]).toMatchObject({ status: 'failed', attempts: 3, code: 'VOICE_TIMEOUT' });
    expect(w.stub.count('tts')).toBe(3);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('recovers when only the first answer is slow', async () => {
    w.stub.tts = (_req, nth) => ({ kind: 'audio', delayMs: nth === 1 ? 600 : 0 });
    const { report } = await w.synth(segs('One segment.'), withGeorge(), { tuning: { backoffMs: [2, 4], requestTimeoutMs: 100 } });
    expect(report.code).toBe('VOICE_OK');
    expect(report.segments[0]).toMatchObject({ status: 'ok', attempts: 2 });
  });

  it('times out a body that starts and never finishes', async () => {
    w.stub.tts = () => ({ kind: 'stall' });
    const { report } = await w.synth(segs('One segment.'), withGeorge(), { tuning: { backoffMs: [2, 4], requestTimeoutMs: 80 } });
    expect(report.code).toBe('VOICE_TIMEOUT');
    expect(report.segments[0]?.attempts).toBe(3);
  });

  it('returns what is finished when the deadline passes, and the next run finishes the rest from the cache', async () => {
    w.stub.tts = (req) => (/^(One|Two)\./.test(text(req)) ? { kind: 'audio' } : { kind: 'hang' });
    const lesson = segs('One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.');
    const started = Date.now();
    const cut = await w.synth(lesson, withGeorge(), { deadlineMs: 400, tuning: { backoffMs: [2, 4], requestTimeoutMs: 30_000, concurrency: 2, maxConcurrency: 2 } });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(350);
    expect(elapsed).toBeLessThan(1200);
    expect(cut.report.code).toBe('VOICE_PARTIAL');
    expect(cut.report.cause).toBe('VOICE_TIMEOUT');
    expect(cut.clips.map((c) => c.segmentId)).toEqual(['s1', 's2']);
    expect(cut.report.segments.map((s) => [s.status, s.code])).toEqual([
      ['ok', undefined],
      ['ok', undefined],
      ['failed', 'VOICE_TIMEOUT'],
      ['failed', 'VOICE_TIMEOUT'],
      ['skipped', 'VOICE_TIMEOUT'],
      ['skipped', 'VOICE_TIMEOUT'],
    ]);

    w.stub.tts = () => ({ kind: 'audio' });
    const before = w.stub.count('tts');
    const rest = await w.synth(lesson, withGeorge());
    expect(rest.report.code).toBe('VOICE_OK');
    expect(rest.report.segments.map((s) => s.status)).toEqual(['cached', 'cached', 'ok', 'ok', 'ok', 'ok']);
    expect(w.stub.count('tts') - before).toBe(4);
    expect(rest.clips).toHaveLength(6);
  });

  it('reports VOICE_TIMEOUT when the voice listing uses up the deadline', async () => {
    w.stub.voices = () => ({ kind: 'hang' });
    const started = Date.now();
    const { report } = await w.synth(segs('One.', 'Two.'), configure(), { deadlineMs: 250, tuning: { backoffMs: [2, 4], requestTimeoutMs: 30_000, concurrency: 2, maxConcurrency: 2 } });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(report.code).toBe('VOICE_TIMEOUT');
    expect(report.segments.map((s) => s.status)).toEqual(['skipped', 'skipped']);
    expect(w.stub.count('tts')).toBe(0);
  });

  it('stops when the caller aborts', async () => {
    w.stub.tts = () => ({ kind: 'hang' });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);
    const started = Date.now();
    const { report } = await w.synth(segs('One.', 'Two.', 'Three.'), withGeorge(), { signal: controller.signal, tuning: { backoffMs: [2, 4], requestTimeoutMs: 30_000, concurrency: 2, maxConcurrency: 2 } });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(report.code).toBe('VOICE_TIMEOUT');
    expect(report.segments.map((s) => s.status)).toEqual(['failed', 'failed', 'skipped']);
  });

  it('sends nothing when the caller has already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { report } = await w.synth(segs('One.'), withGeorge(), { signal: controller.signal });
    expect(report.code).toBe('VOICE_TIMEOUT');
    expect(report.segments[0]).toMatchObject({ status: 'skipped', attempts: 0 });
    expect(w.stub.requests).toEqual([]);
  });

  it('is not held past the deadline by a fetch that ignores its abort signal', async () => {
    const deaf = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    const started = Date.now();
    const { report } = await synthesizeLesson(segs('One.'), withGeorge(), { cacheDir: w.cacheDir, fetch: deaf, deadlineMs: 200, tuning: FAST });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(report.code).toBe('VOICE_TIMEOUT');
  });
});

describe('redirects are refused', () => {
  const w = useWorld();

  it.each([301, 302, 303, 307, 308] as const)('a %i from text-to-speech is not followed and not retried', async (status) => {
    w.stub.tts = () => ({ kind: 'redirect', status, location: `${w.trap.origin}/v1/text-to-speech/elsewhere` });
    const { report, clips } = await w.synth(segs('One.', 'Two.', 'Three.'), withGeorge());
    expect(report.code).toBe('VOICE_NETWORK');
    expect(clips).toEqual([]);
    // The trap serves a perfectly good clip. Nothing ever asked it.
    expect(w.trap.requests).toEqual([]);
    expect(w.stub.count('tts')).toBe(2);
    expect(report.segments.map((s) => [s.status, s.attempts])).toEqual([
      ['failed', 1],
      ['failed', 1],
      ['skipped', 0],
    ]);
  });

  it('a redirect from the voice listing is not followed either', async () => {
    w.stub.voices = () => ({ kind: 'redirect', status: 307, location: `${w.trap.origin}/v2/voices` });
    const { report } = await w.synth(segs('One.'));
    expect(report.code).toBe('VOICE_NETWORK');
    expect(w.trap.requests).toEqual([]);
    expect(w.stub.count('voices')).toBe(1);
    expect(w.stub.count('tts')).toBe(0);
  });

  it('a redirect back to the same host is refused too', async () => {
    w.stub.tts = (_req, nth) => (nth === 1 ? { kind: 'redirect', status: 307, location: '/v1/text-to-speech/another' } : { kind: 'audio' });
    const { report } = await w.synth(segs('One.'), withGeorge());
    expect(report.code).toBe('VOICE_NETWORK');
    expect(w.stub.count('tts')).toBe(1);
  });

  it('refuses a response that an injected fetch already followed somewhere else', async () => {
    const calls: string[] = [];
    const follower = (async (url: unknown) => {
      calls.push(String(url));
      return { status: 200, redirected: true, url: 'https://elsewhere.example/clip', headers: new Headers({ 'content-type': 'audio/mpeg' }), body: null };
    }) as unknown as typeof fetch;
    const { report, clips } = await synthesizeLesson(segs('One.', 'Two.'), withGeorge(), { cacheDir: w.cacheDir, fetch: follower, tuning: FAST });
    expect(report.code).toBe('VOICE_NETWORK');
    expect(clips).toEqual([]);
    expect(calls.length).toBeLessThanOrEqual(2);
  });
});

describe('answers that are not audio', () => {
  const w = useWorld();
  const big = new Uint8Array(9 * 1024 * 1024);
  big.set(SILENT_MP3);

  const garbage: [string, Reply][] = [
    ['an HTML page with status 200', { kind: 'raw', status: 200, contentType: 'text/html', body: '<html><body>Sign in to this network</body></html>' }],
    ['JSON labelled as audio', { kind: 'raw', status: 200, contentType: 'audio/mpeg', body: '{"audio_base64":"AAAA"}' }],
    ['an empty body labelled as audio', { kind: 'raw', status: 200, contentType: 'audio/mpeg', body: '' }],
    ['random bytes labelled as audio', { kind: 'raw', status: 200, contentType: 'audio/mpeg', body: new Uint8Array(512).map((_, i) => (i * 37 + 11) % 251) }],
    ['an ID3 tag with no audio', { kind: 'raw', status: 200, contentType: 'audio/mpeg', body: new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4, 1, 2, 3, 4]) }],
    ['a WAV file labelled as MP3', { kind: 'raw', status: 200, contentType: 'audio/mpeg', body: 'RIFF$\u0000\u0000\u0000WAVEfmt ' }],
    ['a real clip with no content type', { kind: 'raw', status: 200, body: SILENT_MP3 }],
    ['a real clip labelled application/octet-stream', { kind: 'audio', contentType: 'application/octet-stream' }],
    ['a real clip labelled text/html', { kind: 'audio', contentType: 'text/html' }],
    ['a real clip labelled application/json', { kind: 'audio', contentType: 'application/json' }],
    ['204 No Content', { kind: 'raw', status: 204, contentType: 'audio/mpeg', body: '' }],
    ['206 Partial Content', { kind: 'raw', status: 206, contentType: 'audio/mpeg', body: SILENT_MP3 }],
    ['a body over the size cap, streamed', { kind: 'raw', status: 200, contentType: 'audio/mpeg', body: big }],
    ['a body over the size cap, declared', { kind: 'audio', bytes: big }],
  ];

  it.each(garbage)('%s -> VOICE_BAD_AUDIO, not retried, nothing cached', async (_name, reply) => {
    w.stub.tts = () => reply;
    const { report, clips, audio } = await w.synth(segs('One.', 'Two.', 'Three.'), withGeorge());
    expect(report.code).toBe('VOICE_BAD_AUDIO');
    expect(report.message).toBe(VOICE_MESSAGES.VOICE_BAD_AUDIO);
    expect(clips).toEqual([]);
    expect(audio).toBeNull();
    // Each bad answer may have been billed, so the run stops instead of collecting more of them.
    expect(w.stub.count('tts')).toBe(2);
    expect(report.segments.map((s) => [s.status, s.attempts])).toEqual([
      ['failed', 1],
      ['failed', 1],
      ['skipped', 0],
    ]);
    expect((await w.cacheFiles()).filter((f) => f.endsWith('.mp3'))).toEqual([]);
  });

  it('keeps the clips it already has when a later answer is garbage', async () => {
    w.stub.tts = (req) => (text(req).startsWith('Bad') ? { kind: 'raw', status: 200, contentType: 'text/html', body: '<html>' } : { kind: 'audio' });
    await w.synth(segs('Good one.'), withGeorge());
    const { report, clips } = await w.synth(segs('Good one.', 'Bad one.'), withGeorge());
    expect(report.code).toBe('VOICE_PARTIAL');
    expect(report.cause).toBe('VOICE_BAD_AUDIO');
    expect(clips.map((c) => c.segmentId)).toEqual(['s1']);
  });

  it.each([
    ['an HTML page', { kind: 'raw', status: 200, contentType: 'text/html', body: '<html>Sign in</html>' }],
    ['JSON that is not an object', { kind: 'json', body: ['voices'] }],
    ['JSON with no voices list', { kind: 'json', body: { voices: 'George' } }],
    ['JSON that is cut off', { kind: 'raw', status: 200, contentType: 'application/json', body: '{"voices":[{"voice_id":"JBFq' }],
    ['bytes that are not UTF-8', { kind: 'raw', status: 200, contentType: 'application/json', body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) }],
    ['a body over the size cap', { kind: 'raw', status: 200, contentType: 'application/json', body: `{"voices":[],"pad":"${'x'.repeat(2_200_000)}"}` }],
  ] as [string, Reply][])('a voice listing that is %s -> VOICE_NETWORK, and no text is sent', async (_name, reply) => {
    w.stub.voices = () => reply;
    const { report } = await w.synth(segs('One.'));
    expect(report.code).toBe('VOICE_NETWORK');
    expect(w.stub.count('voices')).toBe(1);
    expect(w.stub.count('tts')).toBe(0);
  });

  it('accepts both silent fixtures, so the rejections above are about the content', async () => {
    for (const bytes of [SILENT_MP3, BARE_SILENT_MP3]) {
      w.stub.tts = () => ({ kind: 'audio', bytes });
      expect((await w.synth(segs(`Clip of ${bytes.byteLength} bytes.`), withGeorge())).report.code).toBe('VOICE_OK');
    }
  });
});

describe('a fetch that misbehaves', () => {
  const w = useWorld();
  const run = (impl: unknown) => synthesizeLesson(segs('One.'), withGeorge(), { cacheDir: w.cacheDir, fetch: impl as typeof fetch, tuning: FAST });

  it.each([
    ['throws synchronously', () => { throw new Error(`boom ${FAKE_KEY}`); }],
    ['rejects with an error that quotes the key', async () => { throw new TypeError(`Headers.append: "${FAKE_KEY}" is an invalid header value.`); }],
    ['rejects with something that is not an error', async () => { throw { message: FAKE_KEY }; }],
    ['resolves to undefined', async () => undefined],
    ['resolves to a string', async () => 'audio'],
  ])('%s -> VOICE_NETWORK after three attempts, and the run still resolves', async (_name, impl) => {
    let calls = 0;
    const { report } = await run((...args: unknown[]) => {
      calls += 1;
      return (impl as (...a: unknown[]) => unknown)(...args);
    });
    expect(report.code).toBe('VOICE_NETWORK');
    expect(calls).toBe(3);
    expect(JSON.stringify(report)).not.toContain(FAKE_KEY);
  });
});

describe('calls that are wrong in the code', () => {
  const w = useWorld();

  it.each([
    ['a relative cache directory', () => synthesizeLesson(segs('One.'), withGeorge(), { cacheDir: 'voice-cache' })],
    ['no cache directory', () => synthesizeLesson(segs('One.'), withGeorge(), {} as never)],
    ['no options at all', () => synthesizeLesson(segs('One.'), withGeorge(), undefined as never)],
    ['segments that are not an array', () => w.synth('One.' as never, withGeorge())],
    ['a fetch that is not a function', () => w.synth(segs('One.'), withGeorge(), { fetch: 'fetch' as never })],
    ['a configuration that is a copy', () => w.synth(segs('One.'), { ...withGeorge() })],
    ['a configuration rebuilt from JSON', () => w.synth(segs('One.'), JSON.parse(JSON.stringify(withGeorge())))],
    ['a hand-made configuration', () => w.synth(segs('One.'), { provider: 'elevenlabs', model: 'eleven_multilingual_v2', voiceId: null, maxChars: 12000 })],
  ])('%s is a TypeError, and nothing is requested', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(TypeError);
    expect(w.stub.requests).toEqual([]);
  });
});
