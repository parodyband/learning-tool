// The store: where files go, what they are called, how they are written, and what it refuses.
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLE_PLAN, EXAMPLE_SCENES, EXAMPLE_START } from '../../src/core/examples';
import { StartInput } from '../../src/core/schema';
import { DEFAULT_PORT, homeFromEnv, isLessonFileName, lessonFileName, localDate, portFromEnv, slugify } from '../../src/server/paths';
import { Store, StoreError } from '../../src/server/store';
import { CLIP_PARTS, filesUnder, startWorld, written } from './helpers/kit';

const posix = process.platform !== 'win32';
const start = StartInput.parse(EXAMPLE_START);
const ID = 'abc123def456';

let home: string;
let store: Store;
beforeEach(async () => {
  home = path.join(await mkdtemp(path.join(os.tmpdir(), 'lt-store-')), 'home');
  store = new Store(home, () => new Date('2026-10-10T12:00:00.000Z'));
});
afterEach(async () => {
  await rm(path.dirname(home), { recursive: true, force: true });
});

const mode = async (p: string): Promise<number> => (await stat(p)).mode & 0o777;
const caught = async (work: Promise<unknown>): Promise<StoreError> => {
  try {
    await work;
  } catch (e) {
    expect(e).toBeInstanceOf(StoreError);
    return e as StoreError;
  }
  throw new Error('expected the store to refuse');
};

describe('where things go', () => {
  it('uses LEARNING_TOOL_HOME when set, and ~/LearningTool otherwise', () => {
    expect(homeFromEnv({ LEARNING_TOOL_HOME: '/data/lt' })).toBe(path.resolve('/data/lt'));
    expect(homeFromEnv({})).toBe(path.join(os.homedir(), 'LearningTool'));
    expect(homeFromEnv({ LEARNING_TOOL_HOME: '   ' })).toBe(path.join(os.homedir(), 'LearningTool'));
    expect(path.isAbsolute(homeFromEnv({ LEARNING_TOOL_HOME: 'relative/dir' }))).toBe(true);
  });

  it('reads the port, falling back to the default for anything that is not a port', () => {
    expect(portFromEnv({})).toBe(DEFAULT_PORT);
    expect(DEFAULT_PORT).toBe(47821);
    expect(portFromEnv({ LEARNING_TOOL_PORT: '0' })).toBe(0);
    expect(portFromEnv({ LEARNING_TOOL_PORT: '8123' })).toBe(8123);
    for (const bad of ['', 'abc', '-1', '65536', '99999', '80; rm -rf /', '1e3']) expect(portFromEnv({ LEARNING_TOOL_PORT: bad })).toBe(DEFAULT_PORT);
  });

  it('constructing a store creates nothing', async () => {
    expect(existsSync(home)).toBe(false);
    expect(await store.load(ID)).toBeNull();
    expect(await store.recent(10)).toEqual([]);
    expect(existsSync(home)).toBe(false);
  });

  it('refuses a home that is not absolute', () => {
    expect(() => new Store('relative')).toThrow(TypeError);
  });

  it('lays out drafts, lessons and the voice cache under the home', () => {
    expect(store.draftsDir).toBe(path.join(home, '.state', 'drafts'));
    expect(store.lessonsDir).toBe(path.join(home, 'lessons'));
    expect(store.voiceCacheDir).toBe(path.join(home, '.state', 'voice-cache'));
  });
});

describe('file names', () => {
  it.each([
    ['Binary search: find anything in a sorted list, fast', 'binary-search-find-anything-in-a-sorted-list-fast'],
    ['  HTTP/2 & HTTP/3 — what changed?  ', 'http-2-http-3-what-changed'],
    ['Señor Müller’s café', 'senor-muller-s-cafe'],
    ['../../etc/passwd', 'etc-passwd'],
    ['C:\\Windows\\System32', 'c-windows-system32'],
    ['<script>alert(1)</script>', 'script-alert-1-script'],
    ['日本語のタイトル', 'lesson'],
    ['...', 'lesson'],
    ['', 'lesson'],
    ['CON', 'con'],
    ['a'.repeat(200), 'a'.repeat(60)],
    [`${'word '.repeat(11)}tail-end`, 'word-word-word-word-word-word-word-word-word-word-word-tail'],
  ])('slug of %j is %j', (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it('a slug is only ever a-z, 0-9 and single hyphens, at most 60 characters, whatever the title', () => {
    const nasty = ['\u0000\u0001\u202e', 'a/b\\c:d*e?f"g<h>i|j', '%2e%2e%2f', '🙂 emoji title 🙂', '-----', 'ＡＢＣ fullwidth', 'x'.repeat(59) + '--y', 'İstanbul ǅ ß', '\n\r\t'];
    for (const title of nasty) {
      const slug = slugify(title);
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(slug.length).toBeLessThanOrEqual(60);
    }
  });

  it('a lesson file is slug, the first six characters of the id, and .html', () => {
    expect(lessonFileName('Binary search', ID)).toBe('binary-search-abc123.html');
    expect(() => lessonFileName('x', '../../etc')).toThrow(TypeError);
    expect(isLessonFileName('binary-search-abc123.html', ID)).toBe(true);
  });

  it.each(['binary-search-zzz999.html', '../binary-search-abc123.html', 'binary-search-abc123.html/', 'Binary-Search-abc123.html', 'binary search-abc123.html', '-abc123.html', 'abc123.html', 'x-abc123.htm', `${'a'.repeat(61)}-abc123.html`, 42, null])(
    'a stored file name of %j is not reused',
    (name) => {
      expect(isLessonFileName(name, ID)).toBe(false);
    },
  );

  it('the local date is the calendar date where the learner is', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDate(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
});

describe('drafts', () => {
  it('creates a draft with a minted id and reads it back', async () => {
    const draft = await store.create(start, { start_lesson: 1 });
    expect(draft.id).toMatch(/^[a-z0-9]{12}$/);
    expect(draft).toMatchObject({ format: 'learning-tool/draft@1', topic: start.topic, depth: 'standard', objectives: [], outline: [], evidence: [], scenes: [], activity: { calls: { start_lesson: 1 }, rejects: {} } });
    expect(draft.createdAt).toBe('2026-10-10T12:00:00.000Z');
    expect(await store.load(draft.id)).toEqual(draft);
  });

  it.skipIf(!posix)('makes the state folders 0700 and the draft 0600, and tightens a folder that was left open', async () => {
    await mkdir(path.join(home, '.state'), { recursive: true, mode: 0o755 });
    await chmod(path.join(home, '.state'), 0o755);
    const draft = await store.create(start);
    expect(await mode(path.join(home, '.state'))).toBe(0o700);
    expect(await mode(store.draftsDir)).toBe(0o700);
    expect(await mode(path.join(store.draftsDir, `${draft.id}.json`))).toBe(0o600);
  });

  it('saves atomically: a reader never sees half a file, and no temporary file is left', async () => {
    const draft = await store.create(start);
    const file = path.join(store.draftsDir, `${draft.id}.json`);
    let reading = true;
    let reads = 0;
    const reader = (async () => {
      while (reading) {
        const text = await readFile(file, 'utf8');
        expect(() => JSON.parse(text)).not.toThrow();
        reads++;
      }
    })();
    for (let i = 0; i < 60; i++) {
      draft.title = `Title number ${i} ${'x'.repeat(i * 300)}`;
      await store.save(draft);
    }
    reading = false;
    await reader;
    expect(reads).toBeGreaterThan(10);
    expect(await readdir(store.draftsDir)).toEqual([`${draft.id}.json`]);
    expect((await store.load(draft.id))!.title).toMatch(/^Title number 59 /);
  });

  it('touch: false keeps updatedAt, for bookkeeping that is not a change to the lesson', async () => {
    let now = new Date('2026-10-10T12:00:00.000Z');
    store = new Store(home, () => now);
    const draft = await store.create(start);
    now = new Date('2026-10-10T13:00:00.000Z');
    await store.save(draft, { touch: false });
    expect((await store.load(draft.id))!.updatedAt).toBe('2026-10-10T12:00:00.000Z');
    await store.save(draft);
    expect((await store.load(draft.id))!.updatedAt).toBe('2026-10-10T13:00:00.000Z');
  });

  it('runs work on one lesson strictly in order, and work on different lessons independently', async () => {
    const order: string[] = [];
    const slow = (label: string, ms: number) => async () => {
      order.push(`${label} start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${label} end`);
      return label;
    };
    const results = await Promise.all([store.serial('a', slow('a1', 30)), store.serial('a', slow('a2', 1)), store.serial('b', slow('b1', 1))]);
    expect(results).toEqual(['a1', 'a2', 'b1']);
    expect(order.indexOf('a1 end')).toBeLessThan(order.indexOf('a2 start'));
    expect(order.indexOf('b1 end')).toBeLessThan(order.indexOf('a1 end'));
  });

  it('a failure in the queue does not block what comes after it', async () => {
    const failed = store.serial('a', async () => {
      throw new Error('first');
    });
    const next = store.serial('a', async () => 'second');
    await expect(failed).rejects.toThrow('first');
    await expect(next).resolves.toBe('second');
  });

  it('refuses anything that is not a lesson id, before building a path', async () => {
    for (const bad of ['../x', 'ABC123DEF456', 'abc', '', 'abc123def456.json']) {
      await expect(store.load(bad)).rejects.toThrow(TypeError);
    }
    expect(existsSync(home)).toBe(false);
  });

  it.each([
    ['not JSON', '{"format":"learning-tool/draft@1", SECRET-CONTENT-IN-FILE'],
    ['JSON that is not a draft', '{"hello":"SECRET-CONTENT-IN-FILE"}'],
    ['a draft of another lesson', JSON.stringify({ format: 'learning-tool/draft@1', id: 'zzzzzzzzzzzz', topic: 'SECRET-CONTENT-IN-FILE' })],
    ['a draft that lost its header', JSON.stringify({ format: 'learning-tool/draft@1', id: ID, topic: 'SECRET-CONTENT-IN-FILE' })],
  ])('reports a draft file that is %s as unreadable, without quoting it', async (_name, content) => {
    await mkdir(store.draftsDir, { recursive: true });
    await writeFile(path.join(store.draftsDir, `${ID}.json`), content);
    const error = await caught(store.load(ID));
    expect(error.code).toBe('DRAFT_UNREADABLE');
    expect(error.message).not.toContain('SECRET');
    // A listing leaves it out instead of failing.
    expect(await store.recent(10)).toEqual([]);
  });

  it('repairs missing lists and counters on load, so nothing downstream meets undefined', async () => {
    await mkdir(store.draftsDir, { recursive: true });
    await writeFile(path.join(store.draftsDir, `${ID}.json`), JSON.stringify({ format: 'learning-tool/draft@1', id: ID, topic: 'T', language: 'en', depth: 'quick', learner: {}, scenes: 'x', activity: { calls: { a: 'b', ok: 2 } } }));
    const draft = (await store.load(ID))!;
    expect(draft).toMatchObject({ objectives: [], outline: [], evidence: [], scenes: [], activity: { calls: { ok: 2 }, rejects: {} } });
  });

  it('lists the most recently written drafts first, up to the limit', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push((await store.create({ ...start, topic: `Topic ${i}` })).id);
      await new Promise((r) => setTimeout(r, 15));
    }
    await writeFile(path.join(store.draftsDir, 'notes.txt'), 'not a draft');
    await writeFile(path.join(store.draftsDir, 'TOOLONGNAME00.json'), '{}');
    expect((await store.recent(3)).map((d) => d.id)).toEqual([ids[3], ids[2], ids[1]]);
  });
});

describe.skipIf(!posix)('symbolic links', () => {
  let elsewhere: string;
  beforeEach(async () => {
    elsewhere = path.join(path.dirname(home), 'elsewhere');
    await mkdir(elsewhere, { recursive: true });
  });

  it('refuses a .state that is a link, and writes nothing through it', async () => {
    await mkdir(home, { recursive: true });
    await symlink(elsewhere, path.join(home, '.state'));
    const error = await caught(store.create(start));
    expect(error.code).toBe('STORE_UNSAFE');
    expect(error.message).not.toContain(elsewhere);
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it('refuses a drafts folder that is a link', async () => {
    await mkdir(path.join(home, '.state'), { recursive: true });
    await symlink(elsewhere, path.join(home, '.state', 'drafts'));
    expect((await caught(store.create(start))).code).toBe('STORE_UNSAFE');
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it('refuses a lessons folder that is a link, so no lesson is written outside the home', async () => {
    await mkdir(home, { recursive: true });
    await symlink(elsewhere, path.join(home, 'lessons'));
    expect((await caught(store.writeLesson('x-abc123.html', ID, '<p>lesson</p>'))).code).toBe('STORE_UNSAFE');
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it('replaces a link standing where the lesson file goes, instead of writing through it', async () => {
    const target = path.join(elsewhere, 'victim.txt');
    await writeFile(target, 'untouched');
    await mkdir(store.lessonsDir, { recursive: true });
    await symlink(target, path.join(store.lessonsDir, 'x-abc123.html'));
    const written = await store.writeLesson('x-abc123.html', ID, '<p>lesson</p>');
    expect(await readFile(target, 'utf8')).toBe('untouched');
    expect((await stat(written)).isFile()).toBe(true);
    expect(await readFile(written, 'utf8')).toBe('<p>lesson</p>');
  });

  it('does not read a draft through a link', async () => {
    const real = path.join(elsewhere, 'real.json');
    await writeFile(real, JSON.stringify({ format: 'learning-tool/draft@1', id: ID, topic: 'T', language: 'en', depth: 'quick', learner: {} }));
    await mkdir(store.draftsDir, { recursive: true });
    await symlink(real, path.join(store.draftsDir, `${ID}.json`));
    expect((await caught(store.load(ID))).code).toBe('STORE_UNSAFE');
    expect(await store.lessonExists('x-abc123.html', ID)).toBe(false);
  });

  it('a home that is itself a link the learner made is fine', async () => {
    const real = path.join(path.dirname(home), 'real-home');
    await mkdir(real);
    await symlink(real, home);
    const draft = await store.create(start);
    expect(await store.load(draft.id)).not.toBeNull();
    expect(await readdir(path.join(real, '.state', 'drafts'))).toEqual([`${draft.id}.json`]);
  });

  it('through the tools: the refusal has a code, names no outside path, and tells the agent to stop', async () => {
    const w = await startWorld();
    try {
      await mkdir(w.home, { recursive: true });
      await symlink(elsewhere, path.join(w.home, '.state'));
      const r = await w.call('start_lesson', EXAMPLE_START);
      expect(r.ok).toBe(false);
      expect(r.errors.map((e) => e.code)).toEqual(['STORE_UNSAFE']);
      expect(r.next.tool).toBe('reply');
      expect(w.last!.text).not.toContain(elsewhere);
      expect(await readdir(elsewhere)).toEqual([]);
    } finally {
      await w.close();
    }
  });
});

describe('failures of the disk, through the tools', () => {
  it('a home that cannot be created is STORE_FAILED with the system code, and next is to tell the learner', async () => {
    const blocker = path.join(path.dirname(home), 'a-file');
    await writeFile(blocker, 'x');
    const w = await startWorld({ home: path.join(blocker, 'home') });
    try {
      const r = await w.call('start_lesson', EXAMPLE_START);
      expect(r.ok).toBe(false);
      expect(r.errors.map((e) => e.code)).toEqual(['STORE_FAILED']);
      expect(r.errors[0]!.message).toMatch(/\((ENOTDIR|EEXIST)\)/);
      expect(r.next.tool).toBe('reply');
      expect(w.logs.join('\n')).toMatch(/start_lesson: STORE_FAILED/);
    } finally {
      await w.close();
    }
  });

  it('a damaged draft is DRAFT_UNREADABLE for every tool, without its content', async () => {
    const w = await startWorld();
    try {
      const lessonId = await written(w);
      await writeFile(path.join(w.home, '.state', 'drafts', `${lessonId}.json`), '{"topic":"PRIVATE-NOTES-ABOUT-THE-LEARNER", broken');
      for (const tool of ['get_lesson', 'validate_lesson', 'publish_lesson'] as const) {
        const r = await w.call(tool, { lessonId });
        expect(r.errors.map((e) => e.code)).toEqual(['DRAFT_UNREADABLE']);
        expect(r.lessonId).toBe(lessonId);
        expect(r.next.tool).toBe('get_lesson');
        expect(w.last!.text).not.toContain('PRIVATE-NOTES');
      }
      expect(w.logs.join('\n')).not.toContain('PRIVATE-NOTES');
      expect((await filesUnder(path.join(w.home, 'lessons'))).length).toBe(0);
    } finally {
      await w.close();
    }
  });

  it('a draft with rubbish among its entries never makes a tool fail internally, and planning again repairs it', async () => {
    const w = await startWorld();
    try {
      const lessonId = await written(w);
      const file = path.join(w.home, '.state', 'drafts', `${lessonId}.json`);
      const draft = JSON.parse(await readFile(file, 'utf8'));
      draft.outline.push(null, 5, 'x', { kind: 'narration' });
      draft.scenes.push(null, 7, { id: 42 }, 'scene');
      draft.evidence.push(null, 'e9', { id: 'e77' });
      draft.objectives.push(null);
      draft.published = 'yes';
      draft.activity = null;
      await writeFile(file, JSON.stringify(draft));

      const calls: [Parameters<typeof w.call>[0], Record<string, unknown>][] = [
        ['validate_lesson', {}],
        ['get_lesson', { include: ['evidence', 'scene:s1'] }],
        ['get_lesson', {}],
        ['publish_lesson', {}],
        ['submit_scene', { scene: EXAMPLE_SCENES[0] }],
        ['submit_scene', { scene: { id: 's1', kind: 'recap' } }],
        ['save_evidence', { items: [{ url: 'https://example.org/extra', title: 'Extra (synthetic test source)', excerpt: 'Exponential search finds a range by doubling an index and then runs a binary search inside it.', via: 'page' }] }],
      ];
      for (const [tool, args] of calls) {
        const r = await w.call(tool, { lessonId, ...args });
        expect(r.errors.map((e) => e.code), tool).not.toContain('INTERNAL_ERROR');
        expect(r.lessonId).toBe(lessonId);
      }
      expect((await w.call('get_lesson')).lessons[0].lessonId).toBe(lessonId);
      // The stored plan is what is damaged, and that is what next says to redo.
      const before = await w.call('validate_lesson', { lessonId });
      expect(before.ok).toBe(false);
      expect(before.next.tool).toBe('plan_lesson');
      // The new evidence id follows the highest that exists, rubbish included: ids are never reused.
      expect((await w.call('get_lesson', { lessonId })).evidence.map((e: { id: string | null }) => e.id)).toContain('e78');

      // This lesson is in the scene kinds of lessons made before clips. Sending its plan again is
      // refused for that, with a code and not a failure, and the damaged draft is left as it was.
      const again = await w.call('plan_lesson', { lessonId, ...EXAMPLE_PLAN });
      expect(again.ok).toBe(false);
      expect(new Set(again.errors.map((e) => e.code))).toEqual(new Set(['PLAN_LEGACY_KIND']));
      expect(again.next.tool).toBe('plan_lesson');
      // Planning it again as clips is the repair: the rubbish among the stored scenes goes with the scenes the new plan has no place for.
      const replanned = await w.call('plan_lesson', { lessonId, ...CLIP_PARTS.plan });
      expect(replanned.errors).toEqual([]);
      expect(replanned.kept).toEqual([]);
      expect([...replanned.dropped].sort()).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']);
      expect(JSON.parse(await readFile(file, 'utf8')).scenes).toEqual([]);
      for (const scene of CLIP_PARTS.scenes) expect((await w.call('submit_scene', { lessonId, scene })).errors).toEqual([]);
      const published = await w.call('publish_lesson', { lessonId });
      expect(published).toMatchObject({ ok: true, stage: 'published' });
      expect(w.logs.join('\n')).not.toMatch(/unexpected/);
    } finally {
      await w.close();
    }
  });

  it.skipIf(!posix || process.getuid?.() === 0)('a lessons folder that cannot be written fails the publish cleanly', async () => {
    const w = await startWorld();
    try {
      const lessonId = await written(w);
      await chmod(path.join(w.home, 'lessons'), 0o500);
      const r = await w.call('publish_lesson', { lessonId });
      await chmod(path.join(w.home, 'lessons'), 0o700);
      expect(r.ok).toBe(false);
      expect(r.errors.map((e) => e.code)).toEqual(['STORE_FAILED']);
      expect(r.errors[0]!.message).toContain('EACCES');
      expect(r.next.tool).toBe('reply');
      expect(await readdir(path.join(w.home, 'lessons'))).toEqual([]);
    } finally {
      await w.close();
    }
  });
});
