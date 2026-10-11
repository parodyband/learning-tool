// Results that have to stay true when something has gone wrong: a lesson that fails at the end, a
// published file that has gone, a report with more findings than one result lists, a call with
// thousands of wrong entries. Each case here was a defect found by review or in the agent trials;
// the comment on each says what used to happen.
//
// The lessons here are in the scene kinds of lessons made before clips, with their plan put into
// the draft (see the kit): these are the cases as they were found. The same repairs for a lesson
// of clips, where the prediction is a `gate` on a beat, are in clips.test.ts.
import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLE_EVIDENCE, EXAMPLE_PLAN, EXAMPLE_SCENES, EXAMPLE_START } from '../../src/core/examples';
import { MAX_ISSUES_PER_CALL } from '../../src/core/issues';
import { LIMITS } from '../../src/core/limits';
import type { Issue } from '../../src/core/types';
import { verifyFile } from '../../src/server/cli';
import { buildLesson } from '../validate/build';
import { planned, plantPlan, startWorld, written, type Envelope, type World } from './helpers/kit';

let w: World;
beforeEach(async () => {
  w = await startWorld();
});
afterEach(async () => {
  await w.close();
});

const clone = <T>(value: T): T => structuredClone(value);
const codes = (list: readonly Issue[]): string[] => list.map((e) => e.code);
const scene = (id: string): any => clone(EXAMPLE_SCENES.find((s) => s.id === id));

describe('a step-through without a predict, in a stretch that needs one', () => {
  // The example outline with the first checkpoint moved back, so s1, s2, s3 (the step-through) and s7
  // come in a row. The plan rule accepts it: an outline cannot say whether a step-through will carry a
  // predict. The lesson rule needs the predict.
  const plan = (): any => {
    const out: any = clone(EXAMPLE_PLAN);
    const o = out.outline;
    out.outline = [o[0], o[1], o[2], o[6], o[3], o[4], o[5], o[7], o[8]];
    return out;
  };
  const order = ['s1', 's2', 's3', 's7', 's4', 's5', 's6', 's8', 's9'];
  const withoutPredict = (): any => {
    const s3 = scene('s3');
    for (const step of s3.steps) delete step.predict;
    return s3;
  };

  let lessonId: string;
  beforeEach(async () => {
    lessonId = (await w.call('start_lesson', EXAMPLE_START)).lessonId as string;
    await w.call('save_evidence', { lessonId, items: EXAMPLE_EVIDENCE });
    await plantPlan(w.home, lessonId, plan());
    expect(await w.call('get_lesson', { lessonId })).toMatchObject({ ok: true, stage: 'planned', outstanding: { errors: [], warnings: [] } });
  });

  it('is accepted with a warning that says so at once, not only when the last scene is in', async () => {
    await w.call('submit_scene', { lessonId, scene: scene('s1') });
    const r = await w.call('submit_scene', { lessonId, scene: withoutPredict() });
    expect(r).toMatchObject({ ok: true, accepted: true });
    expect(r.warnings.map((x) => `${x.code} ${x.sceneId} ${x.path}`)).toEqual(['PREDICT_NEEDED s3 steps']);
    expect(r.warnings[0]!.message).toContain(`more than ${LIMITS.passiveRun} scenes in a row with no checkpoint`);
    expect(r.warnings[0]!.fix).toContain('Add a "predict" to one step of "s3"');
    // With its predict there is nothing to say.
    expect((await w.call('submit_scene', { lessonId, scene: scene('s3') })).warnings).toEqual([]);
  });

  it('is not warned about where a checkpoint is near enough anyway', async () => {
    const example = (await w.call('start_lesson', { ...EXAMPLE_START, topic: 'Binary search, the example outline' })).lessonId as string;
    await w.call('save_evidence', { lessonId: example, items: EXAMPLE_EVIDENCE });
    await plantPlan(w.home, example, EXAMPLE_PLAN);
    // In the example outline s3 is followed by a checkpoint: s1, s2, s3 is a stretch of three, which is allowed.
    const r = await w.call('submit_scene', { lessonId: example, scene: withoutPredict() });
    expect(r).toMatchObject({ ok: true, warnings: [] });
  });

  describe('once every scene is in', () => {
    let last: Envelope;
    beforeEach(async () => {
      for (const id of order) last = await w.call('submit_scene', { lessonId, scene: id === 's3' ? withoutPredict() : scene(id) });
    });

    it('next names the scene to resubmit and the predict, not the plan that was just accepted', async () => {
      // Before: next was plan_lesson, 'Follow its "fix" in errors', with "errors" empty.
      expect(last).toMatchObject({ ok: true, errors: [], stage: 'writing' });
      expect(codes(last.lessonReport.errors)).toEqual(['PASSIVE_RUN']);
      expect(last.next.tool).toBe('submit_scene');
      expect(last.next.why).toBe('Every scene is accepted, but 1 error blocks publishing: "lessonReport.errors" has each error with its "fix". Fix and resubmit s3. PASSIVE_RUN needs a "predict" on one step of "s3"; the plan can stay as it is.');
      // The same answer from every tool that can be asked, each pointing at where it shows the error.
      const validated = await w.call('validate_lesson', { lessonId });
      expect(validated.next).toMatchObject({ tool: 'submit_scene' });
      expect(validated.next.why).toContain('"errors" has each error');
      expect(codes(validated.errors)).toEqual(['PASSIVE_RUN']);
      const shown = await w.call('get_lesson', { lessonId });
      expect(shown.next.why).toContain('"outstanding.errors" has each error');
      expect(codes(shown.outstanding.errors)).toEqual(['PASSIVE_RUN']);
      const refused = await w.call('publish_lesson', { lessonId });
      expect(refused).toMatchObject({ ok: false, published: false, next: { tool: 'submit_scene' } });
      expect(refused.next.why).toContain('"errors" has each error');
    });

    it('whatever tool answers, the error next points at is in the result, and next still points at the scene', async () => {
      // Before: a tool that does not show the report answered ok with no error anywhere, and next pointed at one all the same.
      const saved = await w.call('save_evidence', { lessonId, items: [EXAMPLE_EVIDENCE[0]] });
      expect(saved).toMatchObject({ ok: true, errors: [], stage: 'writing', next: { tool: 'submit_scene' } });
      expect(codes(saved.lessonErrors)).toEqual(['PASSIVE_RUN']);
      expect(saved.next.why).toContain('"lessonErrors" has each error');
      expect(saved.next.why).toContain('"s3"');
      // Sending this plan again is no way out: its kinds are no longer planned. The plan stands, and so does the answer.
      const replanned = await w.call('plan_lesson', { lessonId, ...plan() });
      expect(replanned.ok).toBe(false);
      expect(new Set(codes(replanned.errors))).toEqual(new Set(['PLAN_LEGACY_KIND']));
      expect(replanned.next.why).toContain('the earlier plan still stands');
      expect((await w.call('get_lesson', { lessonId })).next).toMatchObject({ tool: 'submit_scene' });
    });

    it('the repair next names is the one that works', async () => {
      const fixed = await w.call('submit_scene', { lessonId, scene: scene('s3') });
      expect(fixed).toMatchObject({ ok: true, stage: 'ready', next: { tool: 'publish_lesson' } });
      expect(fixed.lessonErrors).toBeUndefined();
    });
  });

  it('a result that carries no lesson errors has no "lessonErrors" field', async () => {
    const lesson = await written(w);
    expect((await w.call('save_evidence', { lessonId: lesson, items: [EXAMPLE_EVIDENCE[0]] })).lessonErrors).toBeUndefined();
    expect((await w.call('validate_lesson', { lessonId: lesson })).lessonErrors).toBeUndefined();
  });

  it('an error that only another outline resolves still points at plan_lesson, and says where the error is', async () => {
    const lesson = await written(w);
    const draftFile = `${w.home}/.state/drafts/${lesson}.json`;
    const { readFile, writeFile } = await import('node:fs/promises');
    const draft = JSON.parse(await readFile(draftFile, 'utf8'));
    // Behind the tools, the step-through becomes a third narration in a row: a plan plan_lesson itself would refuse.
    draft.outline = draft.outline.map((entry: { id: string }) => (entry.id === 's3' ? { id: 's3', kind: 'narration', purpose: 'A third narration in a row' } : entry));
    draft.scenes = draft.scenes.map((s: { id: string }) => (s.id === 's3' ? { ...scene('s7'), id: 's3' } : s));
    await writeFile(draftFile, JSON.stringify(draft));
    const r = await w.call('validate_lesson', { lessonId: lesson });
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toContain('NARRATION_RUN');
    expect(r.next.tool).toBe('plan_lesson');
    expect(r.next.why).toMatch(/NARRATION_RUN is about the outline: "errors" has each error with its "fix"/);
    // Sent as it is, the stored plan is refused (its kinds are no longer planned), and then that refusal is what the result is about.
    const same = await w.call('plan_lesson', { lessonId: lesson, title: draft.title, objectives: draft.objectives, outline: draft.outline });
    expect(same.ok).toBe(false);
    expect(same.next.why).toContain('the earlier plan still stands');
  });
});

describe('a published lesson whose file has gone', () => {
  // Before: get_lesson and validate_lesson answered stage "published", next "reply: give the learner
  // the link", and still listed a local link that answered 404.
  let lessonId: string;
  let published: Envelope;
  beforeEach(async () => {
    lessonId = await written(w);
    published = await w.call('publish_lesson', { lessonId });
    expect((await w.call('get_lesson', { lessonId })).published).toMatchObject({ file: { exists: true }, local: { url: published.local.url } });
    await rm(published.file.path);
  });

  it.each(['get_lesson', 'validate_lesson'] as const)('%s says it is ready to publish again, not published', async (tool) => {
    const r = await w.call(tool, { lessonId });
    expect(r.ok).toBe(true);
    expect(r.stage).toBe('ready');
    expect(r.next.tool).toBe('publish_lesson');
    expect(r.next.why).toBe('The lesson was published, but its file is no longer in the Learning Tool folder (deleted or moved). Call publish_lesson: it writes the same file again.');
  });

  it('get_lesson shows the file as missing and offers no local link to it', async () => {
    const r = await w.call('get_lesson', { lessonId });
    expect(r.published).toMatchObject({ file: { path: published.file.path, exists: false }, current: true, note: expect.stringContaining('publish_lesson writes it again') });
    expect(r.published.local).toBeUndefined();
    expect((await fetch(published.local.url)).status).toBe(404);
    const listed = await w.call('get_lesson');
    expect(listed.lessons[0]).toMatchObject({ lessonId, stage: 'ready', fileMissing: true });
  });

  it('publishing again writes the same file under the same link, and everything says published', async () => {
    const again = await w.call('publish_lesson', { lessonId });
    expect(again).toMatchObject({ ok: true, stage: 'published', next: { tool: 'reply' } });
    expect(again.file.path).toBe(published.file.path);
    expect(again.local.url).toBe(published.local.url);
    expect((await fetch(again.local.url)).status).toBe(200);
    const shown = await w.call('get_lesson', { lessonId });
    expect(shown).toMatchObject({ stage: 'published', next: { tool: 'reply' } });
    expect(shown.published).toMatchObject({ file: { exists: true }, local: { url: published.local.url } });
    expect(shown.published.note).toBeUndefined();
    expect((await w.call('get_lesson')).lessons[0]).toMatchObject({ stage: 'published' });
    expect((await w.call('get_lesson')).lessons[0].fileMissing).toBeUndefined();
  });
});

describe('a lesson with more warnings than one result lists', () => {
  // The largest lesson the rules allow has a warning on almost every scene and step: 51 of them.
  // Before, every lesson-level result listed all of them, with no count, though the guide says 20.
  let lessonId: string;
  let total: number;
  let last: Envelope;
  const real = (list: readonly Issue[]): Issue[] => list.filter((x) => x.code !== 'MORE_ISSUES');
  const more = (list: readonly Issue[]): Issue | undefined => list.find((x) => x.code === 'MORE_ISSUES');

  beforeEach(async () => {
    const parts = buildLesson({ depth: 'deep', size: 'max', fill: 'max', evidence: 40 });
    lessonId = await planned(w, parts);
    for (const s of parts.scenes) last = await w.call('submit_scene', { lessonId, scene: s });
    expect(last.pending).toEqual([]);
    total = Object.values(last.lessonReport.warningCounts as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(40);
  });

  it('every result lists at most 20, counts the rest, and gives the whole count by code', async () => {
    const validated = await w.call('validate_lesson', { lessonId });
    const shown = await w.call('get_lesson', { lessonId });
    const published = await w.call('publish_lesson', { lessonId });
    expect(published.ok).toBe(true);
    const lists: [string, Issue[], Record<string, number>][] = [
      ['submit_scene lessonReport', last.lessonReport.warnings, last.lessonReport.warningCounts],
      ['validate_lesson', validated.warnings, validated.warningCounts],
      ['get_lesson outstanding', shown.outstanding.warnings, shown.outstanding.warningCounts],
      ['publish_lesson', published.warnings, published.receipt.warnings],
    ];
    for (const [name, list, counts] of lists) {
      expect(real(list), name).toHaveLength(MAX_ISSUES_PER_CALL);
      expect(more(list), name).toMatchObject({ severity: 'warning', got: String(total) });
      expect(more(list)!.message, name).toContain(`${total - MAX_ISSUES_PER_CALL} more warnings not listed (${total} in total: `);
      expect(Object.values(counts).reduce((a, b) => a + b, 0), name).toBe(total);
      // One very common warning does not hide the only instance of another.
      expect(new Set(codes(real(list))), name).toEqual(new Set(Object.keys(counts)));
    }
    expect(validated.warningCounts).toEqual(published.receipt.warnings);
    expect(published.reply).toContain(`validation recorded ${total} warnings`);
  });

  it('the receipt still records every warning, and the published file verifies', async () => {
    // The cut is made where a result is sent. The report itself, which the receipt is built from, is whole.
    const published = await w.call('publish_lesson', { lessonId });
    const checked = await verifyFile(published.file.path);
    expect(checked).toMatchObject({ ok: true, receiptMatches: true, warnings: total, page: { result: 'identical' } });
  });

  it('the results are a fraction of the size they were', async () => {
    await w.call('validate_lesson', { lessonId });
    expect(w.last!.text.length).toBeLessThan(9_000);
    await w.call('get_lesson', { lessonId });
    expect(w.last!.text.length).toBeLessThan(22_000);
  });
});

describe('a call with thousands of wrong entries', () => {
  // Before: every wrong entry became an error, and cutting the list to size serialised the whole
  // envelope once per dropped error. 8,000 entries took 4.7 seconds, 100,000 many minutes, and for
  // that long the process answered nothing: no tool call and no request for a lesson.
  const timed = async (tool: 'get_lesson' | 'publish_lesson' | 'get_guide', args: Record<string, unknown>): Promise<{ ms: number; result: Envelope }> => {
    const from = performance.now();
    const result = await w.call(tool, args);
    return { ms: performance.now() - from, result };
  };

  it('is answered at once, with 20 errors and a count of the rest', async () => {
    const lessonId = await written(w);
    const cases: [string, 'get_lesson' | 'publish_lesson' | 'get_guide', Record<string, unknown>, number][] = [
      ['100,000 unknown scenes in include', 'get_lesson', { lessonId, include: Array.from({ length: 100_000 }, (_, i) => `scene:z${i}`) }, 100_000],
      ['100,000 numbers in include', 'get_lesson', { lessonId, include: Array.from({ length: 100_000 }, (_, i) => i) }, 100_000],
      ['20,000 unknown arguments to publish_lesson', 'publish_lesson', { lessonId, ...Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`x${i}`, 1])) }, 20_000],
      ['20,000 unknown arguments to get_guide', 'get_guide', Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`x${i}`, 1])), 20_000],
    ];
    for (const [name, tool, args, sent] of cases) {
      const { ms, result } = await timed(tool, args);
      expect(result.ok, name).toBe(false);
      expect(result.errors.filter((e) => e.code !== 'MORE_ISSUES').length, name).toBeLessThanOrEqual(MAX_ISSUES_PER_CALL);
      expect(result.errors.at(-1), name).toMatchObject({ code: 'MORE_ISSUES', got: String(sent) });
      expect(w.last!.text.length, name).toBeLessThanOrEqual(10_000);
      // Generous for a loaded machine, and still two orders of magnitude under what it took.
      expect(ms, `${name} took ${Math.round(ms)} ms`).toBeLessThan(1500);
    }
    // Nothing was published by the refused publish.
    expect(w.deps.listener.port).toBeNull();
  });

  it('a call with 50 wrong entries lists 20 of them, not all 50', async () => {
    const lessonId = await written(w);
    const r = await w.call('get_lesson', { lessonId, include: Array.from({ length: 50 }, (_, i) => `scene:z${i}`) });
    expect(r.errors).toHaveLength(MAX_ISSUES_PER_CALL + 1);
    expect(r.errors.at(-1)).toMatchObject({ code: 'MORE_ISSUES', got: '50' });
    expect(r.errors.at(-1)!.message).toBe('30 more errors not listed (50 in total: 50 BAD_VALUE).');
  });
});
