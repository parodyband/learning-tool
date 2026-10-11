// The whole path, the way an agent walks it: start, evidence, plan, scenes, publish. Then the
// promises that path makes: nothing invalid is published, what is published is exactly what was
// validated, parallel calls lose nothing, and a restart loses nothing.
//
// The lessons in this file are in the scene kinds of lessons made before clips, with their plan
// put into the draft as an older server stored it (see the kit). They show that such a lesson is
// still read, checked, published and verified, and they carry the promises above, none of which
// depends on what kind of scene a lesson holds. The same path for a lesson of clips, planned
// through plan_lesson, is in clips.test.ts.
import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLE_EVIDENCE, EXAMPLE_PLAN, EXAMPLE_SCENES, EXAMPLE_START } from '../../src/core/examples';
import { canonicalJson, hashLesson } from '../../src/core/hash';
import { RULES_VERSION } from '../../src/core/limits';
import { Lesson } from '../../src/core/schema';
import type { Published } from '../../src/core/types';
import { readEmbeddedData, renderLesson } from '../../src/render';
import { stampedVersion } from '../../src/server/build-id';
import { runVerify, verifyFile } from '../../src/server/cli';
import { localDate } from '../../src/server/paths';
import { buildLesson } from '../validate/build';
import { APOLLO_LESSON } from '../validate/fixtures/apollo';
import { HTTP_LESSON } from '../validate/fixtures/http';
import { EXAMPLE_PARTS, isLegacyPlan, NOON, planned, plantPlan, startWorld, written, type LessonParts, type World } from './helpers/kit';

let w: World;
beforeEach(async () => {
  w = await startWorld({ deps: { now: () => NOON } });
});
afterEach(async () => {
  await w.close();
});

const clone = <T>(value: T): T => structuredClone(value);
const DATA_OPEN = '<script type="application/json" id="lt-data">';

async function verify(file: string, ...flags: string[]): Promise<{ code: number; text: string }> {
  const lines: string[] = [];
  const code = await runVerify([file, ...flags], { out: (l) => lines.push(l), err: (l) => lines.push(l) });
  return { code, text: lines.join('\n') };
}

/** Rewrite the embedded data of a published file, leaving the rest of the page alone. */
async function tamper(file: string, edit: (data: string) => string): Promise<void> {
  const html = await readFile(file, 'utf8');
  const start = html.indexOf(DATA_OPEN) + DATA_OPEN.length;
  const end = html.indexOf('</script', start);
  expect(start).toBeGreaterThan(DATA_OPEN.length);
  const data = html.slice(start, end);
  const edited = edit(data);
  expect(edited).not.toBe(data);
  await writeFile(file, html.slice(0, start) + edited + html.slice(end));
}

describe('the example lesson, from start to a published file', () => {
  it('goes through every stage, publishes, verifies, and fails verification once the data is touched', async () => {
    // start
    const started = await w.call('start_lesson', EXAMPLE_START);
    const lessonId = started.lessonId as string;
    expect(started).toMatchObject({ ok: true, stage: 'started', next: { tool: 'save_evidence' } });

    // evidence
    const saved = await w.call('save_evidence', { lessonId, items: EXAMPLE_EVIDENCE });
    expect(saved).toMatchObject({ ok: true, stage: 'researching', saved: 5, next: { tool: 'plan_lesson' } });

    // plan: this lesson's plan is in the older kinds, which plan_lesson refuses, so it is already in the draft
    expect((await w.call('plan_lesson', { lessonId, ...EXAMPLE_PLAN })).errors.every((e) => e.code === 'PLAN_LEGACY_KIND')).toBe(true);
    await plantPlan(w.home, lessonId, EXAMPLE_PLAN);
    expect(await w.call('get_lesson', { lessonId })).toMatchObject({ ok: true, stage: 'planned', next: { tool: 'submit_scene' } });

    // scenes: the first alone, the rest together
    const first = await w.call('submit_scene', { lessonId, scene: EXAMPLE_SCENES[0] });
    expect(first).toMatchObject({ ok: true, stage: 'writing', next: { tool: 'submit_scene' } });
    const rest = await Promise.all(EXAMPLE_SCENES.slice(1).map((scene) => w.call('submit_scene', { lessonId, scene })));
    expect(rest.every((r) => r.ok && r.accepted)).toBe(true);
    const last = rest.find((r) => r.pending.length === 0)!;
    expect(last).toMatchObject({ stage: 'ready', next: { tool: 'publish_lesson' }, lessonReport: { ok: true, errors: [] } });

    // publish
    const published = await w.call('publish_lesson', { lessonId });
    expect(published).toMatchObject({ ok: true, stage: 'published', published: true, republished: false, next: { tool: 'reply' }, errors: [], warnings: [] });

    // the file exists, where it should, named as it should be
    const file = published.file.path as string;
    expect(existsSync(file)).toBe(true);
    expect(path.dirname(file)).toBe(path.join(w.home, 'lessons'));
    expect(path.basename(file)).toBe(`binary-search-find-anything-in-a-sorted-list-fast-${lessonId.slice(0, 6)}.html`);
    expect(fileURLToPath(published.file.url)).toBe(file);
    expect(await readdir(path.join(w.home, 'lessons'))).toEqual([path.basename(file)]);

    // it contains the embedded JSON: the lesson that was validated, and its receipt
    const html = await readFile(file, 'utf8');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain(DATA_OPEN);
    const data = readEmbeddedData(html)!;
    expect(data).not.toBeNull();
    const lesson = Lesson.parse(data.lesson);
    expect(lesson).toMatchObject({ id: lessonId, title: EXAMPLE_PLAN.title, topic: EXAMPLE_START.topic, language: 'en', depth: 'standard', level: 'new' });
    expect(lesson.scenes.map((s) => s.id)).toEqual(EXAMPLE_PLAN.outline.map((e) => e.id));
    expect(lesson.evidence.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    // The version carries the build, so that verify compares the page only with the renderer that made it.
    expect(data.receipt).toMatchObject({ generator: 'learning-tool', version: stampedVersion(w.deps.version), rules: RULES_VERSION, validatedOn: localDate(NOON), warnings: {}, weakClaims: [] });
    expect(data.receipt.version).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{8}$/);
    expect(data.receipt.hash).toBe(hashLesson(lesson));
    expect(published.receipt).toMatchObject({ hash: data.receipt.hash, stats: data.receipt.stats, warnings: {} });
    // and the page is exactly what the renderer makes of that data
    expect(renderLesson({ lesson: data.lesson, receipt: data.receipt }).html).toBe(html);

    // the learner's profile stays in the draft: only the level is published
    expect(html).not.toContain(EXAMPLE_START.learner.goal);
    expect(html).not.toContain('Start at the top and check each one');
    expect(html).not.toContain(w.home);

    // the reply tells the agent what to say, and what not to
    const reply = published.reply as string;
    expect(reply).toContain(published.local.url);
    expect(reply).toContain(file);
    expect(reply).toContain(EXAMPLE_PLAN.title);
    expect(reply).toMatch(/Do not summarise the lesson/);
    expect(reply).toMatch(/Do not call it verified/);
    expect(reply).not.toMatch(/warning/);
    // The file comes first, path and file:// link: it always works. The local link is second, and marked as temporary.
    expect(reply.startsWith(`Tell the learner the lesson is ready and give them the file first: ${file} (${published.file.url}). It always works, offline too.`)).toBe(true);
    expect(reply).toContain(`Then give the local link as a second way in: ${published.local.url} (it works only while this app stays open).`);
    expect(reply.indexOf(file)).toBeLessThan(reply.indexOf(published.local.url));
    // Passages, pages and sites are three different numbers, and passages are not called sources.
    expect(published.receipt.stats).toMatchObject({ sources: 5, pages: 5, hosts: 3 });
    expect(reply).toContain(`"${EXAMPLE_PLAN.title}", about ${published.receipt.stats.minutes} minutes, 9 scenes, 5 passages from 5 pages on 3 sites.`);
    expect(reply).not.toMatch(/\d+ sources/);
    expect(published.local.note).toMatch(/only while the host app stays open/);

    // verify passes on it
    const good = await verify(file);
    expect(good.text).toMatch(/^OK {2}"Binary search/);
    expect(good.text).toContain('matches the receipt');
    expect(good.text).toContain('identical to what this build renders');
    expect(good.code).toBe(0);
    expect((await verify(file, '--strict')).code).toBe(0);

    // corrupt the embedded lesson: change the answer of the numeric checkpoint
    await tamper(file, (json) => json.replace('"answer":20', '"answer":21'));
    const bad = await verify(file);
    expect(bad.code).toBe(1);
    expect(bad.text).toMatch(/^FAILED/);
    expect(bad.text).toContain('does not match the receipt');
  });

  it.each([
    ['a claim that no longer passes validation', (json: string) => json.replace('A linear search may have to check every one of the n elements.', 'A linear search may have to check all 4096 of the n elements.'), /does not pass validation/],
    ['a claim reworded so that it still passes', (json: string) => json.replace('Binary search is only reliable when the data is sorted.', 'Binary search is reliable only when the data is sorted.'), /does not match the receipt/],
    ['a receipt whose hash was replaced', (json: string) => json.replace(/"hash":"[0-9a-f]{64}"/, `"hash":"${'0'.repeat(64)}"`), /does not match the receipt/],
    ['a receipt whose counts were improved', (json: string) => json.replace(/"claims":\d+/, '"claims":99'), /counts or warnings in the receipt/],
    ['a lesson with an unknown field slipped in', (json: string) => json.replace('"format":"learning-tool/lesson@1"', '"format":"learning-tool/lesson@1","note":"added"'), /does not pass validation/],
    ['data that is no longer JSON', (json: string) => json.slice(0, -20), /No Learning Tool lesson data/],
  ])('verify fails on %s', async (_name, edit, message) => {
    const lessonId = await written(w);
    const file = (await w.call('publish_lesson', { lessonId })).file.path as string;
    expect((await verify(file)).code).toBe(0);
    await tamper(file, edit);
    const result = await verify(file);
    expect(result.text).toMatch(message);
    expect(result.code).toBe(1);
  });

  it('verify fails a page whose visible text was edited while its data was left alone', async () => {
    const lessonId = await written(w);
    const file = (await w.call('publish_lesson', { lessonId })).file.path as string;
    const html = await readFile(file, 'utf8');
    const edited = html.replace('<h1 class="lt-title"', '<p>Everything below is false.</p><h1 class="lt-title"');
    expect(edited).not.toBe(html);
    await writeFile(file, edited);
    // The learner reads the page, not the data: this used to print OK and exit 0.
    const plain = await verify(file);
    expect(plain.text).toMatch(/^DATA OK, PAGE DIFFERS/);
    expect(plain.text).toContain('page     DIFFERS');
    expect(plain.text).toContain('not what its own data renders to');
    expect(plain.text).not.toContain('This shows the lesson is the one that was validated');
    expect(plain.code).toBe(1);
    expect((await verify(file, '--strict')).code).toBe(1);
    // The data alone still holds, and can be checked alone.
    const dataOnly = await verify(file, '--data-only');
    expect(dataOnly.code).toBe(0);
    expect(dataOnly.text).toMatch(/^DATA OK, PAGE NOT COMPARED/);
  });

  it('verify fails on a file that is not a lesson, and on no file at all', async () => {
    const other = path.join(w.home, 'page.html');
    await writeFile(other, '<!doctype html><title>Not a lesson</title>');
    expect((await verify(other)).code).toBe(1);
    expect((await verify(path.join(w.home, 'missing.html'))).text).toContain('no file at that path');
    expect((await verifyFile(w.home)).problems).toEqual(['That path is not a file.']);
  });
});

describe.each<[string, () => LessonParts]>([
  ['HTTP status codes (standard)', () => clone(HTTP_LESSON)],
  ['Apollo 11 (quick)', () => clone(APOLLO_LESSON)],
  ['the largest deep lesson the rules allow', () => buildLesson({ depth: 'deep', size: 'max' })],
  ['the smallest quick lesson the rules allow', () => buildLesson({ depth: 'quick', size: 'min' })],
])('another lesson through the tools: %s', (_name, make) => {
  it('is accepted, published and verified, and no result is too long for a host', async () => {
    const parts = make();
    const lessonId = await planned(w, parts);
    // The plan result carries a template per scene: the longest result in the flow. (A plan in the older kinds did not go through plan_lesson.)
    if (!isLegacyPlan(parts.plan)) expect(w.last!.text.length).toBeLessThan(45_000);
    const results = await Promise.all(parts.scenes.map((scene) => w.call('submit_scene', { lessonId, scene })));
    expect(results.flatMap((r) => r.errors)).toEqual([]);
    const published = await w.call('publish_lesson', { lessonId });
    expect(published.ok).toBe(true);
    expect(w.last!.text.length).toBeLessThan(45_000);
    const checked = await verifyFile(published.file.path);
    expect(checked.problems).toEqual([]);
    expect(checked).toMatchObject({ ok: true, receiptMatches: true, page: { result: 'identical' } });
    // What the agent is told about warnings is what the receipt in the page says: every one counted, at most 20 listed.
    const total = Object.values(published.receipt.warnings as Record<string, number>).reduce((a, b) => a + b, 0);
    const listed = published.warnings.filter((x) => x.code !== 'MORE_ISSUES');
    const more = published.warnings.find((x) => x.code === 'MORE_ISSUES');
    expect(listed.length).toBe(Math.min(total, 20));
    expect(more === undefined ? listed.length : Number(more.got)).toBe(total);
    if (total > 0) expect(published.reply).toContain(`${total} warning`);
    // The counts in the reply are the receipt's.
    const stats = published.receipt.stats as { sources: number; pages: number; hosts: number; minutes: number };
    expect(published.reply).toMatch(new RegExp(`about ${stats.minutes} minutes?, ${parts.scenes.length} scenes, ${stats.sources} passages? from ${stats.pages} pages? on ${stats.hosts} sites?\\.`));
    expect((await w.call('get_lesson', { lessonId, include: ['evidence'] })).ok).toBe(true);
    expect(w.last!.text.length).toBeLessThan(48_000);
  });
});

describe('publish_lesson refuses anything that does not pass, and then writes nothing', () => {
  const nothingWritten = async (): Promise<void> => {
    expect(await readdir(path.join(w.home, 'lessons')).catch(() => [])).toEqual([]);
    // The listener starts on the first publish, so a refusal leaves it closed.
    expect(w.deps.listener.port).toBeNull();
  };

  it('a lesson with scenes still pending', async () => {
    const lessonId = await planned(w);
    await w.call('submit_scene', { lessonId, scene: EXAMPLE_SCENES[0] });
    const r = await w.call('publish_lesson', { lessonId });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ published: false, complete: false, stage: 'writing', next: { tool: 'submit_scene' } });
    expect(r.errors.map((e) => e.code)).toEqual(['LESSON_INCOMPLETE']);
    expect(r.pending).toHaveLength(8);
    expect(r.file).toBeUndefined();
    await nothingWritten();
  });

  it('a lesson with no plan', async () => {
    const lessonId = (await w.call('start_lesson', EXAMPLE_START)).lessonId;
    const r = await w.call('publish_lesson', { lessonId });
    expect(r.errors.map((e) => e.code)).toEqual(['NO_PLAN']);
    expect(r.next.tool).toBe('save_evidence');
    await nothingWritten();
  });

  it('a complete lesson that breaks a lesson-wide rule', async () => {
    const lessonId = await written(w);
    await w.call('submit_scene', { lessonId, scene: { ...clone(EXAMPLE_SCENES[3]), level: 'recall' } });
    const r = await w.call('publish_lesson', { lessonId });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toEqual(['NO_APPLY_CHECKPOINT']);
    expect(r).toMatchObject({ published: false, complete: true, stage: 'writing', next: { tool: 'submit_scene' } });
    await nothingWritten();
  });

  it('a scene that was accepted once is checked again: a draft changed behind the tools is still refused', async () => {
    const lessonId = await written(w);
    const file = path.join(w.home, '.state', 'drafts', `${lessonId}.json`);
    const draft = JSON.parse(await readFile(file, 'utf8'));
    const s7 = draft.scenes.find((s: { id: string }) => s.id === 's7');
    s7.blocks[0].text = 'Binary search is only reliable when the data is sorted, which holds for 93 percent of real lists.';
    await writeFile(file, JSON.stringify(draft));
    const r = await w.call('publish_lesson', { lessonId });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ code: 'NUMBER_NOT_IN_SOURCE', sceneId: 's7' });
    expect(r.next.why).toContain('s7');
    await nothingWritten();
  });

  it('rejects arguments it does not have, without publishing', async () => {
    const lessonId = await written(w);
    const r = await w.call('publish_lesson', { lessonId, voice: 'yes', path: '/tmp/out.html' });
    expect(r.errors.map((e) => `${e.code} ${e.path}`)).toEqual(['UNKNOWN_FIELD path']);
    const flags = await w.call('publish_lesson', { lessonId, voice: 'yes', open: 1 });
    expect(flags.errors.map((e) => `${e.code} ${e.path}`)).toEqual(['WRONG_TYPE voice', 'WRONG_TYPE open']);
    expect(flags.next.tool).toBe('publish_lesson');
    await nothingWritten();
  });

  it('a failure while rendering is an error with a code, not a stack trace, and leaves no file', async () => {
    await w.restart({
      now: () => NOON,
      render: () => {
        throw new Error('boom at /secret/path/renderer.ts:12:3');
      },
    });
    const lessonId = await written(w);
    const r = await w.call('publish_lesson', { lessonId });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toEqual(['INTERNAL_ERROR']);
    expect(r.next.tool).toBe('reply');
    expect(w.last!.text).not.toContain('boom');
    expect(w.last!.text).not.toContain('/secret/path');
    expect(w.logs.join('\n')).not.toContain('/secret/path');
    await nothingWritten();
  });
});

describe('what is published is what was validated', () => {
  it('renders from the validated lesson object, and reads the draft once', async () => {
    const lessonId = await written(w);
    const rendered: Published[] = [];
    let loads = 0;
    const load = w.deps.store.load.bind(w.deps.store);
    w.deps.store.load = async (id) => {
      loads++;
      return load(id);
    };
    const render = w.deps.render;
    w.deps.render = (published) => {
      rendered.push(published);
      return render(published);
    };
    const validated = await w.call('validate_lesson', { lessonId });
    loads = 0;
    const r = await w.call('publish_lesson', { lessonId });
    expect(loads).toBe(1);
    expect(rendered).toHaveLength(1);
    expect(hashLesson(rendered[0]!.lesson)).toBe(validated.hash);
    expect(rendered[0]!.receipt.hash).toBe(validated.hash);
    expect(r.receipt.hash).toBe(validated.hash);
    const embedded = readEmbeddedData(await readFile(r.file.path, 'utf8'))!;
    expect(canonicalJson(embedded.lesson)).toBe(canonicalJson(rendered[0]!.lesson));
  });

  it('publishes only the evidence the lesson cites', async () => {
    const lessonId = await planned(w);
    const extra = { url: 'https://example.org/algorithms/unused', title: 'Unused (synthetic test source)', excerpt: 'Interpolation search estimates the position of the target from the values at the ends of the interval.', via: 'page' };
    expect((await w.call('save_evidence', { lessonId, items: [extra] })).items[0].id).toBe('e6');
    for (const scene of EXAMPLE_SCENES) await w.call('submit_scene', { lessonId, scene });
    const r = await w.call('publish_lesson', { lessonId });
    const html = await readFile(r.file.path, 'utf8');
    expect(readEmbeddedData(html)!.lesson.evidence.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(html).not.toContain('Interpolation search');
  });
});

describe('republishing', () => {
  it('is idempotent: the same lesson gives the same file, hash and link', async () => {
    const lessonId = await written(w);
    const one = await w.call('publish_lesson', { lessonId });
    const before = await readFile(one.file.path);
    const two = await w.call('publish_lesson', { lessonId });
    expect(two).toMatchObject({ ok: true, republished: true, stage: 'published' });
    expect(two.file).toEqual(one.file);
    expect(two.local.url).toBe(one.local.url);
    expect(two.receipt.hash).toBe(one.receipt.hash);
    expect((await readFile(two.file.path)).equals(before)).toBe(true);
    expect(await readdir(path.join(w.home, 'lessons'))).toHaveLength(1);
  });

  it('after a change the stage goes back to ready, and the new page replaces the old under the same name', async () => {
    const lessonId = await written(w);
    const one = await w.call('publish_lesson', { lessonId });
    const edited = { ...clone(EXAMPLE_SCENES[0]), title: 'One name among a million' };
    const resubmitted = await w.call('submit_scene', { lessonId, scene: edited });
    expect(resubmitted).toMatchObject({ stage: 'ready', next: { tool: 'publish_lesson' } });
    expect(resubmitted.next.why).toContain('changed since it was published');
    const shown = await w.call('get_lesson', { lessonId });
    expect(shown.published).toMatchObject({ current: false, file: { path: one.file.path, exists: true } });

    // A new title does not move the file: the link the learner already has keeps working.
    await plantPlan(w.home, lessonId, { ...EXAMPLE_PLAN, title: 'Binary search, second edition' });
    const two = await w.call('publish_lesson', { lessonId });
    expect(two.file.path).toBe(one.file.path);
    expect(two.receipt.hash).not.toBe(one.receipt.hash);
    // Nor does the local link change: within one server process a lesson has one address, however often it is published.
    expect(two.local.url).toBe(one.local.url);
    expect(two.reply).toContain(one.local.url);
    expect(await (await fetch(one.local.url)).text()).toContain('Binary search, second edition');
    const html = await readFile(two.file.path, 'utf8');
    expect(html).toContain('One name among a million');
    expect(html).toContain('Binary search, second edition');
    expect(await readdir(path.join(w.home, 'lessons'))).toHaveLength(1);
    expect((await w.call('get_lesson', { lessonId })).published).toMatchObject({ current: true });
    expect((await verifyFile(two.file.path)).ok).toBe(true);
  });

  it('counts warnings in the receipt and tells the agent to state them', async () => {
    const lessonId = await written(w);
    const scene = clone(EXAMPLE_SCENES[0]) as any;
    scene.blocks.push({ type: 'framing', text: 'Keep that picture of the dictionary in mind as we go, because every later step is the same move made again on a smaller part.' });
    expect((await w.call('submit_scene', { lessonId, scene })).warnings.map((x) => x.code)).toEqual(['WORDS_NEAR_BUDGET']);
    const r = await w.call('publish_lesson', { lessonId });
    expect(r.ok).toBe(true);
    expect(r.warnings.map((x) => x.code)).toEqual(['WORDS_NEAR_BUDGET']);
    expect(r.receipt.warnings).toEqual({ WORDS_NEAR_BUDGET: 1 });
    expect(r.reply).toContain('validation recorded 1 warning (WORDS_NEAR_BUDGET)');
    expect(readEmbeddedData(await readFile(r.file.path, 'utf8'))!.receipt.warnings).toEqual({ WORDS_NEAR_BUDGET: 1 });
    expect((await verifyFile(r.file.path)).ok).toBe(true);
  });
});

describe('the local link of a lesson within one server process', () => {
  it('is the same after every publish, changed or not, and after the connection that opened it has gone', async () => {
    // A trial agent republished and was handed a link that differed from the one it had already given.
    const lessonId = await written(w);
    const first = (await w.call('publish_lesson', { lessonId })).local.url as string;
    expect(first).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/l\/[0-9a-f]{32}\/$/);
    for (let i = 0; i < 3; i++) {
      await w.call('submit_scene', { lessonId, scene: { ...clone(EXAMPLE_SCENES[0]), title: `One name among a million, take ${['one', 'two', 'three'][i]}` } });
      expect((await w.call('publish_lesson', { lessonId })).local.url).toBe(first);
    }
    expect((await w.call('get_lesson', { lessonId })).published.local.url).toBe(first);
    // The listener closes with the connection. The same process, serving again, comes back at the same address.
    await w.deps.listener.close();
    expect((await w.call('get_lesson', { lessonId })).published.local).toBeUndefined();
    expect((await w.call('publish_lesson', { lessonId })).local.url).toBe(first);
    expect((await fetch(first)).status).toBe(200);
  });
});

describe('the reply when no local port could be opened', () => {
  it('gives the file, says there is no local link, and still says what the lesson is', async () => {
    const lessonId = await written(w);
    w.deps.listener.serve = async () => null;
    const r = await w.call('publish_lesson', { lessonId });
    expect(r).toMatchObject({ ok: true, published: true, local: { url: null } });
    expect(r.reply.startsWith(`Tell the learner the lesson is ready and give them the file first: ${r.file.path} (${r.file.url}). It always works, offline too. There is no local link this time: the file is the way in.`)).toBe(true);
    expect(r.reply).not.toContain('127.0.0.1');
    expect(r.reply).toContain('5 passages from 5 pages on 3 sites');
  });
});

describe('open', () => {
  it('opens the published file only when asked, through the injected opener', async () => {
    const lessonId = await written(w);
    const quiet = await w.call('publish_lesson', { lessonId });
    expect(w.opened).toEqual([]);
    expect(quiet.opened).toBeUndefined();
    const asked = await w.call('publish_lesson', { lessonId, open: true });
    expect(w.opened).toEqual([asked.file.path]);
    expect(asked.opened).toBe(true);
    await w.call('publish_lesson', { lessonId, open: false });
    expect(w.opened).toHaveLength(1);
  });

  it('a failed open does not fail the publish', async () => {
    await w.restart({
      now: () => NOON,
      open: async () => {
        throw new Error('no browser here');
      },
    });
    const lessonId = await written(w);
    const r = await w.call('publish_lesson', { lessonId, open: true });
    expect(r).toMatchObject({ ok: true, published: true, opened: false });
    expect(w.last!.text).not.toContain('no browser here');
  });
});

describe('parallel calls', () => {
  it('nine submit_scene calls at once are all stored, one after another', async () => {
    const lessonId = await planned(w);
    const results = await Promise.all(EXAMPLE_SCENES.map((scene) => w.call('submit_scene', { lessonId, scene })));
    expect(results.every((r) => r.ok && r.accepted)).toBe(true);
    // Each call saw the lesson with one more scene than the one before it: no write was lost or overlapped.
    expect(results.map((r) => r.totals.scenesAccepted).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(results.filter((r) => r.lessonReport !== undefined)).toHaveLength(1);
    const shown = await w.call('get_lesson', { lessonId });
    expect(shown.plan.pending).toEqual([]);
    expect(shown.stage).toBe('ready');
    expect(shown.activity.calls.submit_scene).toBe(9);
    expect((await w.call('publish_lesson', { lessonId })).ok).toBe(true);
  });

  it('the same scene submitted many times at once is stored once', async () => {
    const lessonId = await planned(w);
    const results = await Promise.all(Array.from({ length: 12 }, () => w.call('submit_scene', { lessonId, scene: EXAMPLE_SCENES[0] })));
    expect(results.filter((r) => r.replaced === false)).toHaveLength(1);
    expect(results.every((r) => r.totals.scenesAccepted === 1)).toBe(true);
    const draft = JSON.parse(await readFile(path.join(w.home, '.state', 'drafts', `${lessonId}.json`), 'utf8'));
    expect(draft.scenes).toHaveLength(1);
  });

  it('evidence saved in parallel gets distinct ids, and duplicates collapse', async () => {
    const lessonId = (await w.call('start_lesson', EXAMPLE_START)).lessonId;
    const results = await Promise.all([...EXAMPLE_EVIDENCE, ...EXAMPLE_EVIDENCE].map((item) => w.call('save_evidence', { lessonId, items: [item] })));
    const ids = results.map((r) => r.items[0].id as string);
    expect(new Set(ids)).toEqual(new Set(['e1', 'e2', 'e3', 'e4', 'e5']));
    expect(results.filter((r) => r.items[0].duplicate)).toHaveLength(5);
    expect((await w.call('get_lesson', { lessonId })).evidence).toHaveLength(5);
  });

  it('accepted and rejected scenes interleaved: the rejected ones change nothing', async () => {
    const lessonId = await planned(w);
    const broken = EXAMPLE_SCENES.map((scene, i) => (i % 2 === 1 ? { ...clone(scene), title: '' } : scene));
    const results = await Promise.all(broken.map((scene) => w.call('submit_scene', { lessonId, scene })));
    expect(results.map((r) => r.ok)).toEqual([true, false, true, false, true, false, true, false, true]);
    expect((await w.call('get_lesson', { lessonId })).plan.accepted).toEqual(['s1', 's3', 's5', 's7', 's9']);
  });

  it('two lessons at once do not touch each other', async () => {
    const [a, b] = await Promise.all([written(w, EXAMPLE_PARTS), written(w, clone(APOLLO_LESSON))]);
    const [pa, pb] = await Promise.all([w.call('publish_lesson', { lessonId: a }), w.call('publish_lesson', { lessonId: b })]);
    expect(pa.title).toBe(EXAMPLE_PLAN.title);
    expect(pb.title).toBe(APOLLO_LESSON.plan.title);
    expect(pa.file.path).not.toBe(pb.file.path);
    expect(pa.local.url).not.toBe(pb.local.url);
    expect((await verifyFile(pa.file.path)).ok && (await verifyFile(pb.file.path)).ok).toBe(true);
  });
});

describe('restart', () => {
  it('a new server over the same home finds the lesson and carries on to a published file', async () => {
    const lessonId = await planned(w);
    for (const scene of EXAMPLE_SCENES.slice(0, 4)) await w.call('submit_scene', { lessonId, scene });

    await w.restart({ now: () => NOON });

    const listed = await w.call('get_lesson');
    expect(listed.lessons).toHaveLength(1);
    expect(listed.lessons[0]).toMatchObject({ lessonId, stage: 'writing', scenes: { planned: 9, accepted: 4 } });
    const shown = await w.call('get_lesson', { lessonId });
    expect(shown).toMatchObject({ stage: 'writing', next: { tool: 'submit_scene' } });
    expect(shown.next.why).toContain('s5, s6, s7, s8, s9');
    expect(shown.evidence).toHaveLength(5);

    for (const scene of EXAMPLE_SCENES.slice(4)) expect((await w.call('submit_scene', { lessonId, scene })).ok).toBe(true);
    const published = await w.call('publish_lesson', { lessonId });
    expect(published.ok).toBe(true);
    expect((await verifyFile(published.file.path)).ok).toBe(true);
  });

  it('after a restart a published lesson is still published, and republishing gives a fresh local link', async () => {
    const lessonId = await written(w);
    const one = await w.call('publish_lesson', { lessonId });
    await w.restart({ now: () => NOON });
    const shown = await w.call('get_lesson', { lessonId });
    expect(shown).toMatchObject({ stage: 'published', next: { tool: 'reply' } });
    expect(shown.published).toMatchObject({ current: true, file: { path: one.file.path, exists: true } });
    // This process has not served it yet, so it offers no local link until it publishes.
    expect(shown.published.local).toBeUndefined();
    const two = await w.call('publish_lesson', { lessonId });
    expect(two.file.path).toBe(one.file.path);
    expect(two.local.url).not.toBe(one.local.url);
    expect((await fetch(two.local.url)).status).toBe(200);
  });
});

describe('files', () => {
  it.skipIf(process.platform === 'win32')('the state folder is private and every file is owner-only', async () => {
    const lessonId = await written(w);
    const r = await w.call('publish_lesson', { lessonId });
    const mode = async (p: string): Promise<number> => (await stat(p)).mode & 0o777;
    expect(await mode(path.join(w.home, '.state'))).toBe(0o700);
    expect(await mode(path.join(w.home, '.state', 'drafts'))).toBe(0o700);
    expect(await mode(path.join(w.home, '.state', 'drafts', `${lessonId}.json`))).toBe(0o600);
    expect(await mode(r.file.path)).toBe(0o600);
  });

  it('writes only inside the home, and leaves no temporary file behind', async () => {
    const lessonId = await written(w);
    await w.call('publish_lesson', { lessonId });
    const { filesUnder } = await import('./helpers/kit');
    const names = (await filesUnder(w.home)).map((f) => f.name);
    expect(names).toEqual([`.state/drafts/${lessonId}.json`, expect.stringMatching(/^lessons\/binary-search-[a-z0-9-]+\.html$/)]);
  });
});
