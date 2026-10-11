// Voice at publish time, against a local stand-in for ElevenLabs (no key exists on this machine, and
// no test may reach the real service or play a sound: the stub answers with a silent clip that is
// only ever embedded, never played).
//
// The second half is the canary: a recognisable fake key is configured, publishing is run through
// success and every failure the stub can produce, and then the key is looked for in everything the
// server gave back, logged, wrote or served.
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_START } from '../../src/core/examples';
import { narrationSegments } from '../../src/core/narration';
import { readEmbeddedData } from '../../src/render';
import { runVoiceCheck, verifyFile } from '../../src/server/cli';
import { createDeps } from '../../src/server/deps';
import { voiceConfigFromEnv } from '../../src/tts';
import { exampleLesson } from '../helpers/example';
import { FAKE_KEY, FAKE_KEY_MARKER, FAST, KEY_VAR, VOICE_VAR } from '../tts/helpers/kit';
import { SILENT_MP3 } from '../tts/helpers/silence';
import { GEORGE, startStub, type ErrorName, type Reply, type Stub } from '../tts/helpers/stub';
import { CLIP_PARTS, filesUnder, startWorld, written, type World } from './helpers/kit';

const SEGMENTS = narrationSegments(exampleLesson()).length;
let stub: Stub;
let w: World;
let stderr: string[];

/** A world whose voice is configured with the fake key and pointed at the stub. */
async function voiceWorld(extraEnv: Record<string, string> = {}, deadlineMs = 10_000): Promise<World> {
  const env = { [KEY_VAR]: FAKE_KEY, [VOICE_VAR]: GEORGE, ...extraEnv };
  const real = createDeps({ LEARNING_TOOL_HOME: '/nonexistent/never-used', ...env });
  return startWorld({
    env,
    deps: { voice: { ...real.voice, deadlineMs, options: { baseUrl: stub.baseUrl, tuning: FAST } } },
  });
}

beforeEach(async () => {
  stub = await startStub({ key: FAKE_KEY });
  stderr = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void stderr.push(args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ')));
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void stderr.push(args.map(String).join(' ')));
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void stderr.push(args.map(String).join(' ')));
});
afterEach(async () => {
  await w?.close();
  await stub.close();
  vi.restoreAllMocks();
});

const clipsIn = (html: string): string[] => [...html.matchAll(/<script type="application\/octet-stream" data-seg="([^"]+)">/g)].map((m) => m[1]!);

describe('publish_lesson with voice configured', () => {
  it('says so at start_lesson, and marks publish_lesson as reaching the outside world', async () => {
    w = await voiceWorld();
    const started = await w.call('start_lesson', EXAMPLE_START);
    expect(started.voice.enabled).toBe(true);
    expect(started.voice.note).toMatch(/ElevenLabs/);
    const { tools } = await w.client.listTools();
    expect(tools.find((t) => t.name === 'publish_lesson')!.annotations!.openWorldHint).toBe(true);
    // Nothing is sent before a publish.
    expect(stub.requests).toEqual([]);
  });

  it('embeds a clip for every narration segment and reports VOICE_OK', async () => {
    w = await voiceWorld();
    const lessonId = await written(w);
    expect(stub.requests).toEqual([]);
    const r = await w.call('publish_lesson', { lessonId });
    expect(r.ok).toBe(true);
    expect(r.voice).toMatchObject({ enabled: true, code: 'VOICE_OK', audio: true });
    expect(r.voice.segments.ok).toBe(SEGMENTS);
    expect(r.voice.characters.sent).toBeGreaterThan(500);
    expect(r.reply).toContain('Say that the lesson is read aloud as it plays: audio is included.');

    const html = await readFile(r.file.path, 'utf8');
    expect(clipsIn(html)).toEqual(narrationSegments(exampleLesson()).map((s) => s.id));
    expect(html).toContain('Machine narration by ElevenLabs');
    expect(html).toContain(Buffer.from(SILENT_MP3).toString('base64').slice(0, 64));
    // The data, the hash and the receipt are those of the text lesson: audio is carried beside them.
    const data = readEmbeddedData(html)!;
    expect(data.receipt.hash).toBe(r.receipt.hash);
    // A page with audio cannot be drawn again by verify. That is said, not passed over: the data holds,
    // the page is "not compared", and --strict, which passes only a page proven identical, fails.
    const checked = await verifyFile(r.file.path);
    expect(checked).toMatchObject({ ok: true, dataOk: true, page: { result: 'not-checked', why: expect.stringContaining('narration audio') } });
    expect(await verifyFile(r.file.path, { strict: true })).toMatchObject({ ok: false, dataOk: true, page: { result: 'not-checked' } });
    // The local link serves the version with audio, under the same policy.
    const served = await fetch(r.local.url);
    expect(await served.text()).toBe(html);
    expect(served.headers.get('content-security-policy')).toContain('media-src blob:');

    // Only narration went out: block text, prompts and takeaways. Never an excerpt, feedback or the learner's profile.
    const sent = stub.ttsRequests().map((q) => (q.json as { text: string }).text);
    expect(sent).toHaveLength(SEGMENTS);
    const all = sent.join('\n');
    expect(all).toContain('Binary search looks at the middle of a sorted array');
    expect(all).not.toContain('Example Algorithms Handbook');
    expect(all).not.toContain('That is linear search.');
    expect(all).not.toContain(EXAMPLE_START.learner.goal);
    expect(all).not.toContain('example.org');
  });

  it('republishing unchanged text costs nothing: every clip comes from the cache', async () => {
    w = await voiceWorld();
    const lessonId = await written(w);
    await w.call('publish_lesson', { lessonId });
    const before = stub.count('tts');
    const again = await w.call('publish_lesson', { lessonId });
    expect(stub.count('tts')).toBe(before);
    expect(again.voice).toMatchObject({ code: 'VOICE_OK', audio: true, characters: { sent: 0 } });
    expect(again.voice.segments.cached).toBe(SEGMENTS);
  });

  it('"voice": false publishes text only and sends nothing', async () => {
    w = await voiceWorld();
    const lessonId = await written(w);
    const r = await w.call('publish_lesson', { lessonId, voice: false });
    expect(r.voice).toMatchObject({ enabled: true, code: 'VOICE_OFF', skipped: true, audio: false });
    expect(stub.requests).toEqual([]);
    expect(clipsIn(await readFile(r.file.path, 'utf8'))).toEqual([]);
    expect(r.reply).not.toMatch(/audio|aloud/);
    expect((await verifyFile(r.file.path)).page).toEqual({ result: 'identical' });
  });

  it.each<[string, Reply, string]>([
    ['a refused key', { kind: 'error', error: 'bad_key' }, 'VOICE_AUTH'],
    ['no credits left', { kind: 'error', error: 'quota' }, 'VOICE_QUOTA'],
    ['rate limiting', { kind: 'error', error: 'rate_limit' }, 'VOICE_RATE'],
    ['a server error', { kind: 'error', error: 'internal_error' }, 'VOICE_NETWORK'],
    ['something that is not audio', { kind: 'raw', status: 200, contentType: 'audio/mpeg', body: '<html>not audio</html>' }, 'VOICE_BAD_AUDIO'],
    ['a dropped connection', { kind: 'reset' }, 'VOICE_NETWORK'],
  ])('with %s the text lesson is still published, and the code says why there is no audio', async (_name, reply, code) => {
    stub.tts = () => reply;
    w = await voiceWorld();
    const lessonId = await written(w);
    const r = await w.call('publish_lesson', { lessonId });
    expect(r).toMatchObject({ ok: true, published: true, stage: 'published', next: { tool: 'reply' } });
    expect(r.voice).toMatchObject({ enabled: true, code, audio: false });
    expect(r.reply).toContain('audio could not be added this time; the lesson itself is complete');
    const html = await readFile(r.file.path, 'utf8');
    expect(clipsIn(html)).toEqual([]);
    expect((await verifyFile(r.file.path, { strict: true })).ok).toBe(true);
  });

  it('a service that never answers is cut off at the deadline, and the text lesson stands', async () => {
    stub.tts = () => ({ kind: 'hang' });
    w = await voiceWorld({}, 400);
    const lessonId = await written(w);
    const started = Date.now();
    const r = await w.call('publish_lesson', { lessonId });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r).toMatchObject({ ok: true, published: true });
    expect(r.voice).toMatchObject({ code: 'VOICE_TIMEOUT', audio: false });
    expect(clipsIn(await readFile(r.file.path, 'utf8'))).toEqual([]);
  });

  it('a publish cut short is finished by the next one: partial audio first, the rest from a second run', async () => {
    let allowed = 3;
    stub.tts = () => (allowed-- > 0 ? { kind: 'audio' } : { kind: 'error', error: 'quota' });
    w = await voiceWorld();
    const lessonId = await written(w);
    const first = await w.call('publish_lesson', { lessonId });
    expect(first.voice).toMatchObject({ code: 'VOICE_PARTIAL', cause: 'VOICE_QUOTA', audio: true });
    const some = clipsIn(await readFile(first.file.path, 'utf8')).length;
    expect(some).toBeGreaterThan(0);
    expect(some).toBeLessThan(SEGMENTS);
    expect(first.reply).toContain('for part of the lesson');

    stub.tts = () => ({ kind: 'audio' });
    const second = await w.call('publish_lesson', { lessonId });
    expect(second.voice).toMatchObject({ code: 'VOICE_OK', audio: true });
    expect(second.voice.segments.cached).toBe(some);
    expect(clipsIn(await readFile(second.file.path, 'utf8'))).toHaveLength(SEGMENTS);
  });

  it('a failed synthesis replaces an earlier audio page with the text page, as the contract orders the writes', async () => {
    w = await voiceWorld();
    const lessonId = await written(w);
    const withAudio = await w.call('publish_lesson', { lessonId });
    expect(clipsIn(await readFile(withAudio.file.path, 'utf8')).length).toBe(SEGMENTS);
    const skipped = await w.call('publish_lesson', { lessonId, voice: false });
    expect(clipsIn(await readFile(skipped.file.path, 'utf8'))).toEqual([]);
  });

  it('a voice module that throws does not fail the publish or leak its message', async () => {
    w = await voiceWorld();
    w.deps.voice.synthesize = async () => {
      throw new TypeError(`config leak ${FAKE_KEY}`);
    };
    const lessonId = await written(w);
    const r = await w.call('publish_lesson', { lessonId });
    expect(r).toMatchObject({ ok: true, published: true, voice: { code: 'VOICE_NETWORK', audio: false } });
    expect(w.last!.text).not.toContain('config leak');
    expect(w.logs.join('\n')).not.toContain('config leak');
    expect(w.logs.join('\n')).toContain('voice failed (TypeError)');
  });

  /** Resolves when the publish handler has finished, which it records in the draft as its last act. */
  const handlerDone = async (lessonId: string, withinMs: number): Promise<boolean> => {
    const until = Date.now() + withinMs;
    while (Date.now() < until) {
      const draft = JSON.parse(await readFile(`${w.home}/.state/drafts/${lessonId}.json`, 'utf8'));
      if (draft.activity.calls.publish_lesson === 1) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  };

  it('stops synthesising when the connection closes, long before the deadline', async () => {
    stub.tts = () => ({ kind: 'hang' });
    w = await voiceWorld({}, 20_000);
    const lessonId = await written(w);
    const pending = w.call('publish_lesson', { lessonId }).catch(() => null);
    while (stub.count('tts') === 0) await new Promise((r) => setTimeout(r, 10));
    await w.client.close();
    await pending;
    expect(await handlerDone(lessonId, 4000)).toBe(true);
    // The text lesson was published before voice began, and is still there.
    const draft = JSON.parse(await readFile(`${w.home}/.state/drafts/${lessonId}.json`, 'utf8'));
    expect(clipsIn(await readFile(`${w.home}/lessons/${draft.published.fileName}`, 'utf8'))).toEqual([]);
  });

  it('a publish that outlives its connection writes what it has and does not open the listener again', async () => {
    let asked = 0;
    stub.tts = () => (++asked <= 2 ? { kind: 'audio' } : { kind: 'hang' });
    w = await voiceWorld({}, 20_000);
    const lessonId = await written(w);
    const pending = w.call('publish_lesson', { lessonId }).catch(() => null);
    while (stub.count('tts') < 3) await new Promise((r) => setTimeout(r, 10));
    expect(w.deps.listener.port).not.toBeNull();
    await w.client.close();
    await pending;
    expect(await handlerDone(lessonId, 4000)).toBe(true);
    const draft = JSON.parse(await readFile(`${w.home}/.state/drafts/${lessonId}.json`, 'utf8'));
    expect(clipsIn(await readFile(`${w.home}/lessons/${draft.published.fileName}`, 'utf8'))).toHaveLength(2);
    // Closed with the connection, and still closed: nobody is left to close it a second time.
    expect(w.deps.listener.port).toBeNull();
  });
});

describe('publish_lesson with voice configured, for a lesson of clips', () => {
  type Spoken = { id: string; sceneId: string; text: string };
  /** The beats of every clip of a published lesson, as segment ids: "<sceneId>.beat<N>", N from 1. */
  const beatIds = (lesson: { scenes: { id: string; kind: string; beats?: unknown[] }[] }): string[] =>
    lesson.scenes.flatMap((scene) => (scene.kind === 'clip' ? (scene.beats ?? []).map((_, i) => `${scene.id}.beat${i + 1}`) : []));

  it('synthesises one clip per beat, and the audio reaches the page keyed by the same segment ids', async () => {
    w = await voiceWorld();
    const lessonId = await written(w, CLIP_PARTS);
    expect(stub.requests).toEqual([]);
    const r = await w.call('publish_lesson', { lessonId });
    expect(r.ok).toBe(true);

    const html = await readFile(r.file.path, 'utf8');
    const lesson = readEmbeddedData(html)!.lesson;
    const segments: Spoken[] = narrationSegments(lesson);
    const beats = beatIds(lesson as never);
    // The example has six clips; every beat of every one of them is a segment of its own, in order.
    expect(beats.length).toBeGreaterThan(20);
    expect(segments.map((s) => s.id).filter((id) => id.includes('.beat'))).toEqual(beats);
    for (const scene of lesson.scenes) {
      if (scene.kind !== 'clip') continue;
      scene.beats.forEach((beat, i) => {
        const segment = segments.find((s) => s.id === `${scene.id}.beat${i + 1}`)!;
        expect(segment.sceneId).toBe(scene.id);
        // What is spoken is the caption, and nothing of the prediction that may stand before it.
        expect(segment.text.length).toBeGreaterThan(10);
        // A gate by options has feedback on each option; a gate by a tap has two replies. None of it is spoken.
        const unspoken = !beat.gate ? [] : 'pick' in beat.gate ? [beat.gate.prompt, beat.gate.right, beat.gate.wrong] : [beat.gate.prompt, ...beat.gate.options.map((option) => option.feedback)];
        for (const text of unspoken) expect(segment.text).not.toContain(text);
      });
      // Nor is anything of an explore: the clip's segments are its beats, and that is all.
      if (scene.explore) {
        const spoken = segments.filter((s) => s.sceneId === scene.id).map((s) => s.text).join(' | ');
        expect(segments.filter((s) => s.sceneId === scene.id)).toHaveLength(scene.beats.length);
        expect(spoken).not.toContain(scene.explore.prompt);
      }
    }
    // The lesson these tests publish asks by a tap once and hands a picture over once: both were held to the rule above.
    const clips = lesson.scenes.flatMap((scene) => (scene.kind === 'clip' ? [scene] : []));
    expect(clips.some((scene) => scene.explore !== undefined)).toBe(true);
    expect(clips.some((scene) => scene.beats.some((beat) => beat.gate !== undefined && 'pick' in beat.gate))).toBe(true);

    // One request per segment, each with the text of its segment.
    const sent = stub.ttsRequests().map((q) => (q.json as { text: string }).text);
    expect(sent).toHaveLength(segments.length);
    expect([...sent].sort()).toEqual(segments.map((s) => s.text).sort());
    expect(sent).toContain('A million names, in order. You want exactly one of them.');

    // The page carries one audio clip per segment, under the segment's own id, and tells the player so.
    expect(clipsIn(html)).toEqual(segments.map((s) => s.id));
    const listed = /data-segments="([^"]*)"/.exec(html)![1]!.split(' ');
    expect(listed).toEqual(segments.map((s) => s.id));
    expect(html.match(/<script type="application\/octet-stream"/g)).toHaveLength(segments.length);
    expect(html).toContain(Buffer.from(SILENT_MP3).toString('base64').slice(0, 64));

    // The report: every segment made, the characters sent are those of the captions, prompts and takeaways, within the budget.
    expect(r.voice).toMatchObject({ enabled: true, code: 'VOICE_OK', audio: true });
    expect(r.voice.segments.ok).toBe(segments.length);
    expect(r.voice.characters.sent).toBe(segments.reduce((sum, s) => sum + s.text.length, 0));
    expect(r.voice.characters.sent).toBeLessThanOrEqual(r.voice.characters.budget);
    expect(r.reply).toContain('audio is included');

    // Only what the lesson says aloud went out: never an excerpt, a prediction's feedback, a checkpoint's answer or the learner's profile.
    const all = sent.join('\n');
    expect(all).not.toContain('Example Algorithms Handbook');
    expect(all).not.toContain('Yes. The list is sorted, so nothing at or before 23 can be 42.');
    expect(all).not.toContain(EXAMPLE_START.learner.goal);
    expect(all).not.toContain('example.org');
    // The data, the hash and the receipt are those of the silent lesson: audio is carried beside them.
    expect(readEmbeddedData(html)!.receipt.hash).toBe(r.receipt.hash);
    expect(await verifyFile(r.file.path)).toMatchObject({ ok: true, dataOk: true, page: { result: 'not-checked' } });
    expect(await (await fetch(r.local.url)).text()).toBe(html);
  });

  it('a caption changed in one beat costs one clip: the others come from the cache under their own ids', async () => {
    w = await voiceWorld();
    const lessonId = await written(w, CLIP_PARTS);
    const first = await w.call('publish_lesson', { lessonId });
    const total = first.voice.segments.ok as number;
    const before = stub.count('tts');
    expect(before).toBe(total);
    // Publishing again costs nothing.
    const again = await w.call('publish_lesson', { lessonId });
    expect(stub.count('tts')).toBe(before);
    expect(again.voice).toMatchObject({ code: 'VOICE_OK', audio: true, characters: { sent: 0 } });
    expect(again.voice.segments.cached).toBe(total);
    // One caption of the first clip is reworded.
    const c1 = structuredClone(CLIP_PARTS.scenes[0]) as { beats: { caption: { text: string } }[] };
    c1.beats[0]!.caption.text = 'A million names, sorted. You want just one of them.';
    expect((await w.call('submit_scene', { lessonId, scene: c1 })).errors).toEqual([]);
    const third = await w.call('publish_lesson', { lessonId });
    expect(stub.count('tts')).toBe(before + 1);
    expect(third.voice).toMatchObject({ code: 'VOICE_OK', audio: true, characters: { sent: 'A million names, sorted. You want just one of them.'.length } });
    expect(third.voice.segments.cached).toBe(total - 1);
    expect(clipsIn(await readFile(third.file.path, 'utf8'))).toHaveLength(total);
  });

  it('a character budget smaller than the captions sends nothing, says VOICE_BUDGET, and the silent lesson stands', async () => {
    w = await voiceWorld({ LEARNING_TOOL_VOICE_MAX_CHARS: '200' });
    const lessonId = await written(w, CLIP_PARTS);
    const r = await w.call('publish_lesson', { lessonId });
    expect(r).toMatchObject({ ok: true, published: true, stage: 'published' });
    expect(r.voice).toMatchObject({ enabled: true, code: 'VOICE_BUDGET', audio: false, characters: { sent: 0, budget: 200 } });
    expect(stub.count('tts')).toBe(0);
    expect(clipsIn(await readFile(r.file.path, 'utf8'))).toEqual([]);
    expect(r.reply).toContain('audio could not be added this time');
    expect((await verifyFile(r.file.path, { strict: true })).ok).toBe(true);
  });

  it('audio cut short covers some beats and not others; the next publish finishes the rest', async () => {
    let allowed = 7;
    stub.tts = () => (allowed-- > 0 ? { kind: 'audio' } : { kind: 'error', error: 'quota' });
    w = await voiceWorld();
    const lessonId = await written(w, CLIP_PARTS);
    const first = await w.call('publish_lesson', { lessonId });
    expect(first.voice).toMatchObject({ code: 'VOICE_PARTIAL', cause: 'VOICE_QUOTA', audio: true });
    const some = clipsIn(await readFile(first.file.path, 'utf8'));
    expect(some.length).toBeGreaterThan(0);
    // Each clip that was made is under the id of the beat it reads.
    for (const id of some) expect(id).toMatch(/^(c[1-6]\.beat[1-8]|q[1-3]|end)$/);
    expect(first.reply).toContain('for part of the lesson');
    stub.tts = () => ({ kind: 'audio' });
    const second = await w.call('publish_lesson', { lessonId });
    expect(second.voice).toMatchObject({ code: 'VOICE_OK', audio: true });
    expect(second.voice.segments.cached).toBe(some.length);
  });

  it('says at start_lesson what will be sent: the caption of every beat, and nothing of the older scene kinds', async () => {
    w = await voiceWorld();
    const started = await w.call('start_lesson', EXAMPLE_START);
    expect(started.voice.note).toMatch(/the caption of every beat, question prompts and takeaways/);
    expect(started.voice.note).toMatch(/one clip per caption/);
    expect(started.voice.note).not.toMatch(/narration|step/i);
    await w.close();
    w = await startWorld();
    const off = await w.call('start_lesson', EXAMPLE_START);
    expect(off.voice.note).toMatch(/Voice is off: the clips play silently, with their captions on screen\./);
    expect(off.voice.note).not.toMatch(/narration|step/i);
  });
});

describe('voice that is not configured', () => {
  it('is off, sends nothing, and the tool is not marked open-world', async () => {
    w = await startWorld();
    const { tools } = await w.client.listTools();
    expect(tools.find((t) => t.name === 'publish_lesson')!.annotations!.openWorldHint).toBe(false);
    const lessonId = await written(w);
    const r = await w.call('publish_lesson', { lessonId, voice: true });
    expect(r.voice).toEqual({ enabled: false, code: 'VOICE_OFF', message: expect.stringContaining('Voice is off'), audio: false });
    expect(stub.requests).toEqual([]);
  });

  it.each([
    ['the generic ElevenLabs variable', { ELEVENLABS_API_KEY: FAKE_KEY }],
    ['an empty value', { [KEY_VAR]: '' }],
    ['an unfilled plugin placeholder', { [KEY_VAR]: '${user_config.elevenlabs_api_key}' }],
  ])('%s does not turn voice on', (_name, env) => {
    expect(createDeps({ LEARNING_TOOL_HOME: '/nonexistent', ...env }).voice.config).toBeNull();
  });

  it('a malformed setting keeps voice off and is named, without its value', async () => {
    w = await startWorld({ env: { [KEY_VAR]: FAKE_KEY, [VOICE_VAR]: 'not a voice id!' } });
    const started = await w.call('start_lesson', EXAMPLE_START);
    expect(started.voice.enabled).toBe(false);
    expect(started.voice.note).toContain(VOICE_VAR);
    expect(started.voice.note).not.toContain('not a voice id');
    expect(w.last!.text.toLowerCase()).not.toContain(FAKE_KEY_MARKER);
  });
});

// ---------------------------------------------------------------------------------------------
// The canary
// ---------------------------------------------------------------------------------------------

const NEEDLES = [
  FAKE_KEY.toLowerCase(),
  FAKE_KEY.slice(0, 16).toLowerCase(),
  FAKE_KEY_MARKER,
  FAKE_KEY.slice(-16).toLowerCase(),
  Buffer.from(FAKE_KEY).toString('hex'),
  Buffer.from(FAKE_KEY).toString('base64').replace(/=+$/, '').toLowerCase(),
];

function expectNoKey(label: string, text: string): void {
  const lower = text.toLowerCase();
  for (const needle of NEEDLES) expect(lower.includes(needle), `${label} contains part of the key`).toBe(false);
}

/** Everything the server produced that someone or something could read. */
async function everything(world: World, results: string[], served: string[]): Promise<[string, string][]> {
  const out: [string, string][] = [];
  results.forEach((text, i) => out.push([`tool result ${i}`, text]));
  out.push(['server log', world.logs.join('\n')]);
  out.push(['console', stderr.join('\n')]);
  served.forEach((text, i) => out.push([`served page ${i}`, text]));
  for (const file of await filesUnder(world.home)) {
    const text = file.bytes.toString('latin1');
    out.push([`file ${file.name}`, text]);
    // A clip is stored as base64 inside the page: look inside it as well.
    for (const m of text.matchAll(/data-seg="[^"]+">([A-Za-z0-9+/=]+)</g)) out.push([`clip in ${file.name}`, Buffer.from(m[1]!, 'base64').toString('latin1')]);
  }
  out.push(['deps', inspect(world.deps, { depth: 8, showHidden: true, getters: true })]);
  return out;
}

describe('canary: the ElevenLabs key never leaves the request header', () => {
  /** A service that echoes the key back wherever it can: the body, the message, a header. */
  const echo = (error: ErrorName): Reply => ({ kind: 'error', error, message: `key ${FAKE_KEY} was refused`, headers: { 'x-echo': FAKE_KEY, 'request-id': FAKE_KEY } });
  const scenarios: [string, (n: number) => Reply][] = [
    ['success', () => ({ kind: 'audio' })],
    ['success, with the key echoed in response headers', () => ({ kind: 'audio', headers: { 'x-echo': FAKE_KEY, 'request-id': FAKE_KEY } })],
    ['a refused key, echoed', () => echo('bad_key')],
    ['quota, echoed', () => echo('quota')],
    ['legacy quota', () => ({ kind: 'error', error: 'quota_legacy', message: FAKE_KEY })],
    ['rate limit, echoed', () => echo('rate_limit')],
    ['server error, echoed', () => echo('internal_error')],
    ['voice not found, echoed', () => echo('voice_not_found')],
    ['validation error', () => ({ kind: 'error', error: 'validation' })],
    ['a JSON body that is only the key', () => ({ kind: 'json', status: 500, body: { detail: { message: FAKE_KEY, status: FAKE_KEY, code: FAKE_KEY } } })],
    ['the key served as if it were audio', () => ({ kind: 'raw', status: 200, contentType: 'audio/mpeg', body: `ID3${FAKE_KEY}` })],
    ['a redirect that carries the key', () => ({ kind: 'redirect', location: `http://127.0.0.1:1/?key=${FAKE_KEY}` })],
    ['a dropped connection', () => ({ kind: 'reset' })],
    ['a truncated clip', () => ({ kind: 'truncate' })],
    ['half the segments, then a refusal', (n) => (n <= 4 ? { kind: 'audio' } : echo('quota'))],
  ];

  it.each(scenarios)('%s', async (_name, reply) => {
    stub.tts = (_req, nth) => reply(nth);
    w = await voiceWorld();
    const results: string[] = [];
    const call = async (tool: Parameters<World['call']>[0], args?: unknown) => {
      const r = await w.call(tool, args);
      results.push(w.last!.text);
      return r;
    };
    await call('start_lesson', { ...EXAMPLE_START, topic: 'Something else entirely' });
    const id = await written(w);
    const published = await call('publish_lesson', { lessonId: id });
    expect(published.ok).toBe(true);
    await call('publish_lesson', { lessonId: id, open: true });
    await call('get_lesson', { lessonId: id, include: ['evidence'] });
    await call('get_lesson');
    await call('validate_lesson', { lessonId: id });
    // And the failures a tool can answer with: a lesson that is not there, arguments that are wrong.
    await call('publish_lesson', { lessonId: 'zzzzzzzzzzzz' });
    await call('publish_lesson', { lessonId: id, voice: FAKE_KEY, key: FAKE_KEY });
    // An agent must never put a key in an argument. If one does, the answer still does not repeat it.
    await call('publish_lesson', { lessonId: id, voice: FAKE_KEY });
    await call('save_evidence', { lessonId: id, items: FAKE_KEY });
    await call('get_lesson', { lessonId: id, include: FAKE_KEY });
    await call('get_guide', { section: FAKE_KEY });
    await call('get_lesson', { lessonId: FAKE_KEY });
    const served = [await (await fetch(published.local.url)).text()];

    // The key did go out, in the one header, to the stub and nowhere else.
    for (const q of stub.requests) expect(q.headers['xi-api-key']).toBe(FAKE_KEY);
    for (const q of stub.requests) {
      expect(q.path.toLowerCase()).not.toContain(FAKE_KEY_MARKER);
      expect(JSON.stringify(q.query).toLowerCase()).not.toContain(FAKE_KEY_MARKER);
      expect(q.body.toLowerCase()).not.toContain(FAKE_KEY_MARKER);
    }
    for (const [label, text] of await everything(w, results, served)) expectNoKey(label, text);
    // The opener was handed a path, not a key.
    for (const opened of w.opened) expectNoKey('opened path', opened);
  });

  it('the voice-check command, through success and failure, prints no part of the key', async () => {
    const lines: string[] = [];
    const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
    const env = { [KEY_VAR]: FAKE_KEY };
    const options = { baseUrl: stub.baseUrl, tuning: FAST };

    expect(await runVoiceCheck([], io, env, options)).toBe(0);
    expect(lines.join('\n')).toMatch(/^VOICE_OK/);
    expect(lines.join('\n')).toContain('Key: set (never shown).');
    expect(await runVoiceCheck(['--json'], io, env, options)).toBe(0);

    stub.subscription = () => ({ kind: 'error', error: 'bad_key', message: `key ${FAKE_KEY} refused`, headers: { 'x-echo': FAKE_KEY } });
    stub.voices = () => ({ kind: 'error', error: 'bad_key', message: FAKE_KEY });
    expect(await runVoiceCheck([], io, env, options)).toBe(1);
    expect(lines.join('\n')).toContain('VOICE_AUTH');

    stub.subscription = () => ({ kind: 'reset' });
    stub.voices = () => ({ kind: 'reset' });
    expect(await runVoiceCheck(['--json'], io, env, options)).toBe(1);

    // Off, and off because a setting is malformed: the first is not a failure, the second is.
    expect(await runVoiceCheck([], io, {}, options)).toBe(0);
    expect(await runVoiceCheck([], io, { [KEY_VAR]: FAKE_KEY, [VOICE_VAR]: FAKE_KEY }, options)).toBe(1);
    expect(await runVoiceCheck(['--frobnicate'], io, env, options)).toBe(1);

    expectNoKey('voice-check output', lines.join('\n'));
    expectNoKey('console', stderr.join('\n'));
  });

  it('the configuration object the server holds cannot be made to show the key', () => {
    const config = voiceConfigFromEnv({ [KEY_VAR]: FAKE_KEY })!;
    const deps = createDeps({ LEARNING_TOOL_HOME: '/nonexistent', [KEY_VAR]: FAKE_KEY });
    for (const value of [config, deps, deps.voice]) {
      expectNoKey('inspect', inspect(value, { depth: 10, showHidden: true, getters: true }));
      expectNoKey('JSON', JSON.stringify(value, (_k, v) => (typeof v === 'function' ? String(v) : v)) ?? '');
      expectNoKey('clone', inspect(structuredClone({ ...deps.voice, synthesize: undefined, options: undefined })));
    }
  });
});
