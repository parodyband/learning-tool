// A lesson of clips through the real tools, in memory: what an agent meets when it builds the
// lesson a learner is meant to watch.
//
//   - the clip example goes from start_lesson to a published file that verifies, with `next`
//     right at every stage;
//   - a plan in the older scene kinds is refused, with the code for it;
//   - the template plan_lesson returns for each of the nine stage kinds can be filled in and is
//     then accepted by submit_scene;
//   - a rejected clip gets its own fix, the right `next`, and its template back;
//   - the code of a custom frame reaches the validator, the draft and the published file exactly
//     as it was sent;
//   - no result of the largest lesson of clips is too long for a host.
//
// The same path through the spawned bundle is in stdio.test.ts, audio in voice.test.ts, and the
// table of `next` for every stage and rejection in next.test.ts.
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnyScene, LessonV2 } from '../../src/core/clip';
import { EXAMPLE_PLAN, EXAMPLE_START } from '../../src/core/examples';
import { FRAME_LIMITS } from '../../src/core/frame';
import { canonicalJson, hashLesson } from '../../src/core/hash';
import { ISSUES } from '../../src/core/issues';
import { LIMITS } from '../../src/core/limits';
import { PLAN_STAGE_KINDS } from '../../src/core/schema';
import { TEMPLATE_NOTES, templateFor } from '../../src/core/templates';
import type { Issue, SceneMetrics } from '../../src/core/types';
import { FRAME_ISSUES } from '../../src/frame/check';
import { readEmbeddedData, renderLesson } from '../../src/render';
import { runVerify, verifyFile } from '../../src/server/cli';
import { envelope, ERROR_RESULT_MAX_CHARS, fitErrorEnvelope, TEMPLATE_LEFT_OUT } from '../../src/server/envelope';
import { Store } from '../../src/server/store';
import { CHECKPOINT_LEVEL_NOTE, legacyKindErrors, notesFor } from '../../src/server/tools/plan';
import { metricsPayload, sentFrameCode, wantsTemplate } from '../../src/server/tools/scene';
import { asPublished, lessonOf } from '../helpers/clip-example';
import { AWKWARD_CODE, everyStageLesson, fillTemplate, FRAME_CODE, largeClipLesson, passage, type ClipLesson, type Json } from './helpers/clips';
import { CLIP_PARTS, NOON, planned, startWorld, written, type Envelope, type World } from './helpers/kit';

let w: World;
beforeEach(async () => {
  w = await startWorld({ deps: { now: () => NOON } });
});
afterEach(async () => {
  await w.close();
});

const clone = <T>(value: T): T => structuredClone(value);
const codes = (list: readonly Issue[]): string[] => list.map((e) => e.code);
const DATA_OPEN = '<script type="application/json" id="lt-data">';
const PLAN = CLIP_PARTS.plan as { title: string; objectives: unknown; outline: { id: string; kind: string; stage?: string; question?: string }[] };
const SCENES = CLIP_PARTS.scenes as Json[];
const scene = (id: string): Json => clone(SCENES.find((s) => s.id === id) as Json);

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
  const data = html.slice(start, end);
  const edited = edit(data);
  expect(edited).not.toBe(data);
  await writeFile(file, html.slice(0, start) + edited + html.slice(end));
}

/** start_lesson, save_evidence and plan_lesson for a generated lesson, then its scenes made from the templates that came back. */
async function plannedFromTemplates(lesson: ClipLesson): Promise<{ lessonId: string; plan: Envelope; scenes: Json[] }> {
  const lessonId = (await w.call('start_lesson', lesson.start)).lessonId as string;
  for (let i = 0; i < lesson.evidence.length; i += 10) expect((await w.call('save_evidence', { lessonId, items: lesson.evidence.slice(i, i + 10) })).errors).toEqual([]);
  const plan = await w.call('plan_lesson', { lessonId, ...lesson.plan });
  expect(plan.errors).toEqual([]);
  return { lessonId, plan, scenes: lesson.scenesFrom(plan.templates as Json[]) };
}

describe('the clip example lesson, from start to a published file', () => {
  it('goes through every stage with next right at each, publishes, verifies, and fails verification once it is touched', async () => {
    // start: the contract comes back, and says what kind of lesson this is
    const started = await w.call('start_lesson', CLIP_PARTS.start);
    const lessonId = started.lessonId as string;
    expect(started).toMatchObject({ ok: true, stage: 'started', next: { tool: 'save_evidence' } });
    expect(started.contract).toMatch(/VISUAL FIRST\. The picture carries the idea; the words only point at it\./);
    expect(started.limits.clip.stageKinds).toEqual(PLAN_STAGE_KINDS.filter((kind) => kind !== 'frame'));

    // evidence
    const saved = await w.call('save_evidence', { lessonId, items: CLIP_PARTS.evidence });
    expect(saved).toMatchObject({ ok: true, stage: 'researching', saved: 5, next: { tool: 'plan_lesson' } });

    // plan: a plan in the older kinds is refused; the plan of clips is stored
    const old = await w.call('plan_lesson', { lessonId, ...EXAMPLE_PLAN });
    expect(old).toMatchObject({ ok: false, stage: 'researching', next: { tool: 'plan_lesson' } });
    expect(new Set(codes(old.errors))).toEqual(new Set(['PLAN_LEGACY_KIND']));
    const plan = await w.call('plan_lesson', { lessonId, ...PLAN });
    expect(plan.errors).toEqual([]);
    expect(plan).toMatchObject({ ok: true, stage: 'planned', scenes: 10, next: { tool: 'submit_scene' } });
    expect(plan.next.why).toBe('The plan is stored. Submit the first scene ("c1") alone and read the result before you write the others.');
    expect(plan.templates.map((t: Json) => [t.id, t.kind, t.stage?.kind])).toEqual(PLAN.outline.map((e) => [e.id, e.kind, e.stage]));

    // scenes: the first alone, the rest together
    const first = await w.call('submit_scene', { lessonId, scene: SCENES[0] });
    expect(first.errors).toEqual([]);
    expect(first).toMatchObject({ ok: true, accepted: true, sceneId: 'c1', stage: 'writing', next: { tool: 'submit_scene' } });
    expect(first.next.why).toBe('1 of 10 scenes are accepted. Still to submit: c2, c3, q1, c4, c5, q2, c6, q3 and 1 more (in parallel if your host allows).');
    expect(first.pending).toEqual(['c2', 'c3', 'q1', 'c4', 'c5', 'q2', 'c6', 'q3', 'end']);
    const rest = await Promise.all(SCENES.slice(1).map((s) => w.call('submit_scene', { lessonId, scene: s })));
    expect(rest.flatMap((r) => r.errors)).toEqual([]);
    expect(rest.every((r) => r.ok && r.accepted)).toBe(true);
    const last = rest.find((r) => r.pending.length === 0)!;
    expect(last).toMatchObject({ stage: 'ready', next: { tool: 'publish_lesson' }, lessonReport: { ok: true, complete: true, errors: [] } });
    expect(last.lessonReport.stats).toMatchObject({ scenes: 10, checkpoints: 3, figures: 6, sources: 5, pages: 5, hosts: 3 });
    expect(await w.call('validate_lesson', { lessonId })).toMatchObject({ ok: true, stage: 'ready', next: { tool: 'publish_lesson' } });
    const shown = await w.call('get_lesson', { lessonId, include: ['scene:c3'] });
    expect(shown).toMatchObject({ stage: 'ready', next: { tool: 'publish_lesson' }, plan: { pending: [] } });
    expect(shown.plan.outline[2]).toMatchObject({ id: 'c3', kind: 'clip', stage: 'cells', status: 'accepted' });
    expect(shown.scenes[0].scene).toMatchObject({ id: 'c3', kind: 'clip', stage: { kind: 'cells' } });

    // publish
    const published = await w.call('publish_lesson', { lessonId });
    expect(published).toMatchObject({ ok: true, stage: 'published', published: true, republished: false, next: { tool: 'reply' }, errors: [] });
    expect(published.next.why).toMatch(/Give the learner the file, which always works, then the local link/);
    const file = published.file.path as string;
    expect(existsSync(file)).toBe(true);
    expect(await readdir(path.join(w.home, 'lessons'))).toEqual([path.basename(file)]);
    expect(published.reply).toContain(`"${PLAN.title}", about ${published.receipt.stats.minutes} minutes, 10 scenes, 5 passages from 5 pages on 3 sites.`);
    expect((await fetch(published.local.url)).status).toBe(200);

    // the file holds the lesson that was validated: its clips, stage and beats, and the receipt
    const html = await readFile(file, 'utf8');
    const data = readEmbeddedData(html)!;
    const lesson = LessonV2.parse(data.lesson);
    expect(lesson.scenes.map((s) => [s.id, s.kind])).toEqual(PLAN.outline.map((e) => [e.id, e.kind]));
    expect(lesson.scenes.filter((s) => s.kind === 'clip').map((s) => (s.kind === 'clip' ? s.stage.kind : ''))).toEqual(['words', 'flow', 'cells', 'chart', 'dots', 'cells']);
    expect(data.receipt.hash).toBe(hashLesson(lesson));
    expect(published.receipt.hash).toBe(data.receipt.hash);
    expect(renderLesson({ lesson: data.lesson, receipt: data.receipt }).html).toBe(html);
    // The learner's profile stays in the draft.
    expect(html).not.toContain(EXAMPLE_START.learner.goal);

    // verify passes
    const good = await verify(file);
    expect(good.text).toMatch(/^OK {2}"Binary search/);
    expect(good.text).toContain('matches the receipt');
    expect(good.text).toContain('identical to what this build renders');
    expect(good.code).toBe(0);
    expect((await verify(file, '--strict')).code).toBe(0);
    expect(await w.call('get_lesson', { lessonId })).toMatchObject({ stage: 'published', next: { tool: 'reply' } });

    // the page text edited, the data left alone: as decided, DATA OK, PAGE DIFFERS, exit 1
    const at = html.indexOf(DATA_OPEN);
    const caption = 'You want exactly one of them.';
    expect(html.slice(0, at)).toContain(caption);
    await writeFile(file, html.slice(0, at).replace(caption, 'You want every one of them.') + html.slice(at));
    const differs = await verify(file);
    expect(differs.code).toBe(1);
    expect(differs.text).toMatch(/^DATA OK, PAGE DIFFERS/);
    expect(differs.text).toContain('page     DIFFERS');
    expect(differs.text).not.toContain('This shows the lesson is the one that was validated');
    expect((await verify(file, '--strict')).code).toBe(1);
    const dataOnly = await verify(file, '--data-only');
    expect(dataOnly.code).toBe(0);
    expect(dataOnly.text).toMatch(/^DATA OK, PAGE NOT COMPARED/);

    // the data edited: one verb of one beat. The lesson is no longer the one that was validated.
    await writeFile(file, html);
    expect((await verify(file)).code).toBe(0);
    await tamper(file, (json) => json.replace('"verb":"pulse","target":"ask"', '"verb":"pulse","target":"middle"'));
    const bad = await verify(file);
    expect(bad.code).toBe(1);
    expect(bad.text).toMatch(/^FAILED/);
    expect(bad.text).toContain('does not match the receipt');
    expect((await verify(file, '--data-only')).code).toBe(1);
  });

  it.each([
    ['a caption reworded so that it still passes', (json: string) => json.replace('It compares the target with the middle element.', 'It compares the target value with the middle element.'), /does not match the receipt/],
    ['an action that names a part the stage does not have', (json: string) => json.replace('"verb":"pulse","target":"ask"', '"verb":"pulse","target":"nowhere"'), /does not pass validation/],
    ['a duration slipped into a beat', (json: string) => json.replace('"verb":"pulse","target":"ask"', '"verb":"pulse","target":"ask","duration":900'), /does not pass validation/],
    ['a prediction whose right answer was moved', (json: string) => json.replace('"text":"Nothing yet","correct":false', '"text":"Nothing yet","correct":true'), /does not pass validation/],
    ['a stage marked as sourced that was a worked example', (json: string) => json.replace('"provenance":"worked"', '"provenance":"sourced"'), /does not pass validation|does not match the receipt/],
  ])('verify fails on %s', async (_name, edit, message) => {
    const lessonId = await written(w, CLIP_PARTS);
    const file = (await w.call('publish_lesson', { lessonId })).file.path as string;
    expect((await verify(file)).code).toBe(0);
    await tamper(file, edit);
    const result = await verify(file);
    expect(result.text).toMatch(message);
    expect(result.code).toBe(1);
  });

  it('republishing a clip lesson after a change keeps the file and the link, and the stage goes back to ready in between', async () => {
    const lessonId = await written(w, CLIP_PARTS);
    const one = await w.call('publish_lesson', { lessonId });
    const edited = scene('c1');
    edited.title = 'One name among a million';
    const resubmitted = await w.call('submit_scene', { lessonId, scene: edited });
    expect(resubmitted).toMatchObject({ ok: true, replaced: true, stage: 'ready', next: { tool: 'publish_lesson' } });
    expect(resubmitted.next.why).toContain('changed since it was published');
    const two = await w.call('publish_lesson', { lessonId });
    expect(two).toMatchObject({ ok: true, republished: true, stage: 'published' });
    expect(two.file.path).toBe(one.file.path);
    expect(two.local.url).toBe(one.local.url);
    expect(two.receipt.hash).not.toBe(one.receipt.hash);
    expect((await verifyFile(two.file.path)).ok).toBe(true);
  });

  it('a new server over the same home finds the clip lesson and carries on', async () => {
    const lessonId = await planned(w, CLIP_PARTS);
    for (const s of SCENES.slice(0, 4)) await w.call('submit_scene', { lessonId, scene: s });
    await w.restart({ now: () => NOON });
    const shown = await w.call('get_lesson', { lessonId });
    expect(shown).toMatchObject({ stage: 'writing', next: { tool: 'submit_scene' } });
    expect(shown.next.why).toContain('c4, c5, q2, c6, q3, end');
    for (const s of SCENES.slice(4)) expect((await w.call('submit_scene', { lessonId, scene: s })).errors).toEqual([]);
    expect((await w.call('publish_lesson', { lessonId })).ok).toBe(true);
  });
});

describe('plan_lesson for a lesson of clips', () => {
  it('returns the clip templates and the notes that go with them, and none about the older scene kinds', async () => {
    const lessonId = (await w.call('start_lesson', CLIP_PARTS.start)).lessonId as string;
    await w.call('save_evidence', { lessonId, items: CLIP_PARTS.evidence });
    const r = await w.call('plan_lesson', { lessonId, ...PLAN });
    // The templates are the validator's own, one per scene, for the planned stage kinds.
    expect(r.templates).toEqual(PLAN.outline.map((entry) => templateFor(entry as never)));
    for (const template of r.templates) expect(AnyScene.safeParse(template).success, template.id).toBe(true);
    // The notes are the validator's, without those that describe templates this plan does not hold.
    expect(r.templateNotes.length).toBeGreaterThan(5);
    for (const note of r.templateNotes) expect(note === CHECKPOINT_LEVEL_NOTE || TEMPLATE_NOTES.includes(note), note.slice(0, 60)).toBe(true);
    expect(r.templateNotes.join('\n')).not.toMatch(/narration|step-through|step_through/i);
    // What a clip is, said where the templates are: one caption, verbs, a gate, the frame.
    const notes = r.templateNotes.join('\n');
    expect(notes).toMatch(/A clip is a stage/);
    expect(notes).toMatch(/You never write a time, a position, a size or a colour/);
    expect(notes).toMatch(/`gate` on a beat is a prediction/);
    expect(notes).toMatch(/A frame clip \(stage kind "frame"\) has no actions/);
    // The one choice of a checkpoint template is still explained.
    expect(notes).toMatch(/"recall" or "apply"/);
    // The budget of a clip is for one caption.
    for (const entry of PLAN.outline) expect(r.budgets[entry.id]).toEqual(entry.kind === 'clip' ? { ...LIMITS.captionWords, per: 'beat' } : null);
  });

  it('the notes for a plan are chosen by what the plan holds', () => {
    const forClips = notesFor(['clip', 'checkpoint', 'recap']);
    expect(forClips.length).toBeLessThan(TEMPLATE_NOTES.length + 1);
    expect(forClips.join('\n')).not.toMatch(/narration|step-through/i);
    // A lesson stored before clips still has its own notes, whole.
    expect(notesFor(['narration', 'step_through', 'checkpoint', 'recap'])).toEqual([...TEMPLATE_NOTES]);
    // Without a checkpoint there is nothing to say about its level.
    expect(notesFor(['clip', 'recap'])).not.toContain(CHECKPOINT_LEVEL_NOTE);
  });

  it('refuses the older kinds whatever shape the outline arrives in, and looks at nothing but the kind', () => {
    expect(legacyKindErrors(undefined)).toEqual([]);
    expect(legacyKindErrors('not json')).toEqual([]);
    expect(legacyKindErrors([null, 7, 'narration', { kind: 7 }, { id: 'a', kind: 'clip' }, { kind: 'checkpoint' }, { kind: 'recap' }])).toEqual([]);
    const found = legacyKindErrors([{ id: 'a', kind: 'clip', stage: 'flow' }, { id: 'b', kind: 'narration', figure: 'compare' }, { id: 'c', kind: ' STEP_THROUGH ', figure: 'not a figure' }, { kind: 'step through' }]);
    expect(found.map((e) => `${e.code} ${e.path} ${e.got}`)).toEqual(['PLAN_LEGACY_KIND outline[1].kind narration', 'PLAN_LEGACY_KIND outline[2].kind step_through', 'PLAN_LEGACY_KIND outline[3].kind step_through']);
    expect(found[0]!.fix).toMatch(/For what was a "compare" figure, start from stage "chart"\./);
    // A figure type that is not one is never repeated back.
    expect(found[1]!.fix).not.toContain('not a figure');
    expect(found[2]!.message).toContain('Scene outline[3] is planned as "step_through"');
    expect(legacyKindErrors(JSON.stringify([{ id: 'b', kind: 'narration' }]))).toHaveLength(1);
    // An id is echoed only as far as it is safe to.
    const hostile = legacyKindErrors([{ id: `x${'y'.repeat(500)}\u202e`, kind: 'narration' }]);
    expect(hostile[0]!.message.length).toBeLessThan(400);
    expect(hostile[0]!.message).not.toContain('\u202e');
  });
});

describe('a filled template for each of the nine stage kinds', () => {
  it('there are nine', () => {
    expect([...PLAN_STAGE_KINDS]).toEqual(['sequence', 'cells', 'dots', 'chart', 'flow', 'words', 'lines', 'timeline', 'frame']);
    expect(Object.values(everyStageLesson().stages)).toEqual([...PLAN_STAGE_KINDS]);
  });

  it('is accepted by submit_scene: the template plan_lesson returned, with its placeholders replaced and nothing else changed', async () => {
    const lesson = everyStageLesson();
    const { lessonId, plan, scenes } = await plannedFromTemplates(lesson);
    const seen: string[] = [];
    for (const [i, filled] of scenes.entries()) {
      const template = plan.templates[i] as Json;
      if (template.kind !== 'clip') continue;
      const kind = template.stage.kind as string;
      seen.push(kind);
      expect(kind).toBe(lesson.stages[template.id as string]);

      // The template as it came is not a scene: every placeholder it holds is refused, and it comes back with the refusal.
      const raw = await w.call('submit_scene', { lessonId, scene: template });
      expect(raw.ok, kind).toBe(false);
      expect(codes(raw.errors), kind).toContain('PLACEHOLDER_TEXT');

      // Filled in, it is accepted, with the words of each caption.
      const r = await w.call('submit_scene', { lessonId, scene: filled });
      expect(r.errors, kind).toEqual([]);
      expect(r, kind).toMatchObject({ ok: true, accepted: true, sceneId: template.id, replaced: false });
      expect(r.metrics.beats, kind).toHaveLength(filled.beats.length);

      // What is stored has the template's shape: the same parts under the same ids, the same verbs in the same beats.
      const stored = (await w.call('get_lesson', { lessonId, include: [`scene:${template.id}`] })).scenes[0].scene as Json;
      const ids = (value: unknown, out: string[] = []): string[] => {
        if (Array.isArray(value)) value.forEach((item) => ids(item, out));
        else if (typeof value === 'object' && value !== null) for (const [k, v] of Object.entries(value)) k === 'id' && typeof v === 'string' ? out.push(v) : ids(v, out);
        return out;
      };
      expect(stored.stage.kind, kind).toBe(kind);
      expect(ids(stored.stage), kind).toEqual(ids(template.stage));
      expect(stored.beats.map((beat: Json) => (beat.do ?? []).map((action: Json) => action.verb)), kind).toEqual(template.beats.map((beat: Json) => (beat.do ?? []).map((action: Json) => action.verb)));
      expect(stored.beats.map((beat: Json) => beat.gate !== undefined), kind).toEqual(template.beats.map((beat: Json) => beat.gate !== undefined));
    }
    expect(seen).toEqual([...PLAN_STAGE_KINDS]);
  });

  it('the whole lesson of nine filled templates passes, is published and verifies', async () => {
    const { lessonId, scenes } = await plannedFromTemplates(everyStageLesson());
    const results = await Promise.all(scenes.map((s) => w.call('submit_scene', { lessonId, scene: s })));
    expect(results.flatMap((r) => r.errors)).toEqual([]);
    const published = await w.call('publish_lesson', { lessonId });
    expect(published.errors).toEqual([]);
    expect(published).toMatchObject({ ok: true, stage: 'published' });
    expect(await verifyFile(published.file.path, { strict: true })).toMatchObject({ ok: true, dataOk: true, receiptMatches: true, page: { result: 'identical' } });
  });
});

describe('submit_scene for a clip', () => {
  let lessonId: string;
  beforeEach(async () => {
    lessonId = await planned(w, CLIP_PARTS);
  });

  it('returns the words of each caption in metrics, as "beats": the budget is per beat, not for the scene', async () => {
    const c3 = scene('c3');
    const r = await w.call('submit_scene', { lessonId, scene: c3 });
    expect(r).toMatchObject({ ok: true, accepted: true, sceneId: 'c3' });
    expect(r.metrics.budget).toEqual({ ...LIMITS.captionWords, per: 'beat' });
    expect(r.metrics.beats).toHaveLength(c3.beats.length);
    for (const words of r.metrics.beats) {
      expect(words).toBeGreaterThan(0);
      expect(words).toBeLessThanOrEqual(LIMITS.captionWords.max);
    }
    expect(r.metrics.words).toBe(r.metrics.beats.reduce((a: number, b: number) => a + b, 0));
    // A clip has beats, not steps: the list is under one name only.
    expect(r.metrics.steps).toBeUndefined();
    // A checkpoint has neither.
    const q1 = await w.call('submit_scene', { lessonId, scene: scene('q1') });
    expect(q1.metrics.beats).toBeUndefined();
    expect(q1.metrics.steps).toBeUndefined();
  });

  it('a caption that is too long is refused by the beat it is in, and the metrics show which', async () => {
    const c2 = scene('c2');
    c2.beats[1].caption.text = 'It compares the target with the middle element, and then, depending on what that comparison of the two values shows, it goes on to do one of two quite different things next.';
    const r = await w.call('submit_scene', { lessonId, scene: c2 });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => `${e.code} ${e.path}`)).toContain('WORDS_OVER_BUDGET beats[1].caption');
    expect(r.metrics.beats[1]).toBeGreaterThan(LIMITS.captionWords.max);
    expect(r.metrics.beats).toHaveLength(c2.beats.length);
    expect(r.next).toEqual({ tool: 'submit_scene', why: '"c2" was not stored. Change only what each error\'s "fix" says and submit it again under the same id.' });
    // A caption that runs long is not a matter of shape: no template.
    expect(r.template).toBeUndefined();
  });

  it('the names the validator and the tool use for the same list', () => {
    const metrics: SceneMetrics = { sceneId: 'c1', words: 30, budget: { warn: 16, max: 22, per: 'beat' }, steps: [10, 12, 8], citedBlocks: 1, uncitedBlocks: 2 };
    expect(metricsPayload(metrics)).toEqual({ sceneId: 'c1', words: 30, budget: { warn: 16, max: 22, per: 'beat' }, beats: [10, 12, 8], citedBlocks: 1, uncitedBlocks: 2 });
    // The steps of an older step-through, and scenes measured whole, are passed on as they are.
    const stepper: SceneMetrics = { ...metrics, budget: { warn: 45, max: 70, per: 'step' } };
    expect(metricsPayload(stepper)).toEqual(stepper);
    const whole: SceneMetrics = { sceneId: 's1', words: 76, budget: { warn: 90, max: 150, per: 'scene' }, citedBlocks: 1, uncitedBlocks: 2 };
    expect(metricsPayload(whole)).toEqual(whole);
    expect(metricsPayload({ ...whole, budget: null })).toEqual({ ...whole, budget: null });
  });

  describe('a rejected clip gets its template back when its shape, its stage or its actions are at fault', () => {
    const template = (id: string): Json => templateFor(PLAN.outline.find((e) => e.id === id) as never);

    it.each([
      ['an action on a part the stage does not have', 'c2', (s: Json) => (s.beats[1].do[1].target = 'nowhere'), 'ACTION_UNKNOWN_PART', 'beats[1].do[1].target'],
      ['a verb the stage kind does not have', 'c2', (s: Json) => (s.beats[1].do[1] = { verb: 'swap', a: 'list', b: 'middle' }), 'ACTION_VERB_NOT_ALLOWED', 'beats[1].do[1].verb'],
      ['a prediction on the first beat', 'c3', (s: Json) => ((s.beats[0].gate = s.beats[2].gate), delete s.beats[2].gate), 'GATE_ON_FIRST_BEAT', 'beats[0].gate'],
      ['a duration, which no field takes', 'c2', (s: Json) => (s.beats[0].do[0].duration = 900), 'UNKNOWN_FIELD', 'beats[0].do[0].duration'],
      ['a colour on a part', 'c2', (s: Json) => (s.stage.nodes[0].color = '#ff0000'), 'UNKNOWN_FIELD', 'stage.nodes[0].color'],
      ['`at` on a beat of a stage that is not a frame', 'c2', (s: Json) => (s.beats[1].at = 2), 'BEAT_FIELD_NOT_ALLOWED', 'beats[1].at'],
      ['a stage of another kind than the plan names', 'c2', (s: Json) => Object.assign(s, { stage: scene('c1').stage, beats: scene('c1').beats }), 'SCENE_SHAPE_MISMATCH', 'stage.kind'],
    ])('%s', async (_name, id, edit, code, at) => {
      const bad = scene(id);
      edit(bad);
      const r = await w.call('submit_scene', { lessonId, scene: bad });
      expect(r.ok).toBe(false);
      expect(r.errors.map((e) => `${e.code} ${e.path}`)).toContain(`${code} ${at}`);
      expect(r).toMatchObject({ accepted: false, sceneId: id, stage: 'planned' });
      // The template for that scene, as plan_lesson returned it: the planned stage kind, its parts and its verbs.
      expect(r.template).toEqual(template(id));
      expect(r.template.stage.kind).toBe(PLAN.outline.find((e) => e.id === id)!.stage);
      expect(r.next).toEqual({ tool: 'submit_scene', why: `"${id}" was not stored. Change only what each error's "fix" says and submit it again under the same id.` });
      // Nothing was stored, and the same scene put right is accepted.
      expect((await w.call('get_lesson', { lessonId })).plan.accepted).toEqual([]);
      expect((await w.call('submit_scene', { lessonId, scene: scene(id) })).ok).toBe(true);
    });

    it.each([
      ['a caption that cites a passage that is not stored', (s: Json) => (s.beats[0].caption.cites = ['e9']), 'CITE_UNKNOWN'],
      ['a number in a caption that its passage does not have', (s: Json) => (s.beats[0].caption.text = 'Binary search works on a sorted array of 73 elements, and it repeats one move.'), 'NUMBER_NOT_IN_SOURCE'],
    ])('but not for %s: the template says nothing about that', async (_name, edit, code) => {
      const bad = scene('c2');
      edit(bad);
      const r = await w.call('submit_scene', { lessonId, scene: bad });
      expect(codes(r.errors)).toEqual([code]);
      expect(r.template).toBeUndefined();
      expect(r.templateNote).toBeUndefined();
    });

    it('which codes bring the template: the shape codes, every code about a stage or its actions, every frame code', () => {
      const error = (code: string): Issue => ({ code, severity: 'error', path: '', message: 'm', fix: 'f' });
      const catalog = ISSUES as Record<string, { group: string; severity: string }>;
      const byGroup = (group: string): string[] => Object.keys(catalog).filter((code) => catalog[code]!.group === group);
      expect(byGroup('clips').length).toBeGreaterThan(10);
      expect(byGroup('frame').sort()).toEqual(Object.keys(FRAME_ISSUES).sort());
      for (const code of [...byGroup('clips'), ...byGroup('frame'), 'UNKNOWN_FIELD', 'MISSING_FIELD', 'WRONG_TYPE', 'BAD_VALUE', 'SCENE_KIND_MISMATCH', 'SCENE_SHAPE_MISMATCH', 'FRAME_SOMETHING_NEW']) expect(wantsTemplate([error(code)]), code).toBe(true);
      for (const code of ['CITE_UNKNOWN', 'QUOTE_NOT_FOUND', 'CLAIM_UNRELATED', 'NUMBER_NOT_IN_SOURCE', 'WORDS_OVER_BUDGET', 'OPTION_CORRECT_COUNT', 'PLACEHOLDER_TEXT', 'URL_IN_TEXT', 'NOT_A_CODE']) expect(wantsTemplate([error(code)]), code).toBe(false);
      expect(wantsTemplate([error('CITE_UNKNOWN'), error('ACTION_TARGET')])).toBe(true);
      expect(wantsTemplate([])).toBe(false);
    });

    it('a clip with twenty things wrong with it is still answered in one result a host shows whole, with every error or with the template, never with neither', async () => {
      // Every action of every beat is given a duration, an easing and a coordinate: three unknown fields each.
      const bad = scene('c3');
      for (const beat of bad.beats) for (const action of beat.do) Object.assign(action, { duration: 900, easing: 'ease-in-out', x: 12 });
      const r = await w.call('submit_scene', { lessonId, scene: bad });
      expect(r.ok).toBe(false);
      expect(new Set(codes(r.errors.filter((e) => e.code !== 'MORE_ISSUES')))).toEqual(new Set(['UNKNOWN_FIELD']));
      expect(r.errors.find((e) => e.code === 'MORE_ISSUES')).toBeDefined();
      expect(w.last!.text.length).toBeLessThanOrEqual(ERROR_RESULT_MAX_CHARS);
      // The template is there, or the result says why it is not; the errors are never the ones to go first.
      expect(r.template !== undefined || r.templateNote === TEMPLATE_LEFT_OUT).toBe(true);
      if (r.template === undefined) expect(r.errors.filter((e) => e.code !== 'MORE_ISSUES')).toHaveLength(20);
      expect(r.next.tool).toBe('submit_scene');
    });

    it('the envelope drops the template before it drops an error, and only when it has to', () => {
      const errors = (n: number): Issue[] => Array.from({ length: n }, (_, i) => ({ code: 'ACTION_UNKNOWN_PART', severity: 'error', path: `beats[${i}].do[0].target`, message: `The action names "part-${i}", which is not a part of this stage. ${'x'.repeat(200)}`, fix: 'Use one of the part ids listed in the message.' }) as Issue);
      const small = envelope({ draft: null, errors: errors(3), outcome: {}, payload: { template: { id: 'c2', filler: 'y'.repeat(2000) } } });
      expect(fitErrorEnvelope(small)).toBe(small);
      const big = envelope({ draft: null, errors: errors(20), outcome: {}, payload: { template: { id: 'c2', filler: 'y'.repeat(4000) } } });
      expect(JSON.stringify(big).length).toBeGreaterThan(ERROR_RESULT_MAX_CHARS);
      const fitted = fitErrorEnvelope(big);
      expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(ERROR_RESULT_MAX_CHARS);
      expect(fitted.template).toBeUndefined();
      expect(fitted.templateNote).toBe(TEMPLATE_LEFT_OUT);
      expect(fitted.errors).toEqual(big.errors);
      // The original is not changed, and a result with no template is cut as before.
      expect(big.template).toBeDefined();
      expect(fitErrorEnvelope(envelope({ draft: null, errors: errors(40), outcome: {} })).templateNote).toBeUndefined();
    });
  });
});

describe('a custom frame', () => {
  /** The clip example with its fifth clip (the dots) planned and written as a frame instead. */
  const outline = PLAN.outline.map((entry) => (entry.id === 'c5' ? { ...entry, stage: 'frame' } : entry));
  const frameTemplate = (): Json => templateFor({ id: 'c5', kind: 'clip', purpose: 'p', stage: 'frame' } as never);
  /** A frame clip that passes: the template filled in, resting on the example's first two passages. */
  const frame = (code: string = FRAME_CODE): Json => {
    const filled = fillTemplate(frameTemplate(), { title: 'A thousand items, ten looks', a: { id: 'e1', words: ['binary', 'search', 'finds', 'target', 'value', 'sorted', 'array', 'comparing', 'middle', 'element'] }, code });
    // The quote of the generated passages does not exist in this one; a frame template has none, so nothing else needs changing.
    // The frame stands where the lesson had its explore (c5), so it asks a question of its own: two clips in three must.
    filled.beats[1].gate = {
      prompt: 'The bars grow. Which one ends up the tallest?',
      options: [
        { text: 'The last one', correct: true, feedback: 'Yes: each bar is drawn taller than the one before it.' },
        { text: 'The first one', correct: false, feedback: 'No: the first bar is the shortest of the row.' },
      ],
    };
    return filled;
  };

  let lessonId: string;
  beforeEach(async () => {
    lessonId = (await w.call('start_lesson', CLIP_PARTS.start)).lessonId as string;
    await w.call('save_evidence', { lessonId, items: CLIP_PARTS.evidence });
    const plan = await w.call('plan_lesson', { lessonId, title: PLAN.title, objectives: PLAN.objectives, outline });
    expect(plan.errors).toEqual([]);
    expect(plan.templates[5]).toEqual(frameTemplate());
  });

  it('is accepted when it passes the checks, with its captions timed by "at"', async () => {
    const r = await w.call('submit_scene', { lessonId, scene: frame() });
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({ ok: true, accepted: true, sceneId: 'c5' });
    expect(r.metrics.beats).toHaveLength(2);
  });

  describe('is rejected with the code of the check that failed, that check\'s own fix, the template, and next pointing back at the same scene', () => {
    const NEXT = { tool: 'submit_scene', why: '"c5" was not stored. Change only what each error\'s "fix" says and submit it again under the same id. For the code of a frame, get_guide section "frame-api" lists what it may use.' };

    it.each([
      ['a syntax error', (s: Json) => (s.stage.code = `${FRAME_CODE}\nfunction broken( {\n`), 'FRAME_SYNTAX', 'stage.code', FRAME_ISSUES.FRAME_SYNTAX.fix],
      ['a banned call: a timer', (s: Json) => (s.stage.code = FRAME_CODE.replace('S.clear();', 'S.clear();\n  setTimeout(() => S.clear(), 100);')), 'FRAME_BANNED', 'stage.code', 'The player owns time. Compute everything from the t passed to render.'],
      ['a banned call: the network', (s: Json) => (s.stage.code = FRAME_CODE.replace('S.clear();', 'S.clear();\n  fetch("data.json");')), 'FRAME_BANNED', 'stage.code', 'Put the data in the code as literals.'],
      ['beats out of range: a caption after the animation has ended', (s: Json) => (s.beats[1].at = s.stage.duration + 5), 'FRAME_BEAT_TIME', 'beats[1].at', FRAME_ISSUES.FRAME_BEAT_TIME.fix],
      ['beats out of order', (s: Json) => ((s.beats[0].at = 3), (s.beats[1].at = 0)), 'FRAME_BEAT_TIME', 'beats[0].at', FRAME_ISSUES.FRAME_BEAT_TIME.fix],
      ['no render function', (s: Json) => (s.stage.code = FRAME_CODE.replace('function render(ctx, t)', 'function draw(ctx, t)')), 'FRAME_NO_RENDER', 'stage.code', FRAME_ISSUES.FRAME_NO_RENDER.fix],
      ['a poster outside the animation', (s: Json) => (s.stage.poster = s.stage.duration + 1), 'FRAME_POSTER_RANGE', 'stage.poster', FRAME_ISSUES.FRAME_POSTER_RANGE.fix],
      ['a slider the code reads and the stage does not declare', (s: Json) => (s.stage.params = []), 'FRAME_PARAM_UNDECLARED', 'stage.code', FRAME_ISSUES.FRAME_PARAM_UNDECLARED.fix],
    ])('%s', async (_name, edit, code, at, fix) => {
      const bad = frame();
      edit(bad);
      const r = await w.call('submit_scene', { lessonId, scene: bad });
      expect(r.ok).toBe(false);
      const found = r.errors.find((e) => e.code === code && e.path === at);
      expect(found, `${code} ${at} among ${r.errors.map((e) => `${e.code} ${e.path}`).join(', ')}`).toBeDefined();
      expect(found).toMatchObject({ severity: 'error', sceneId: 'c5' });
      // The fix is the frame check's own, not a general one.
      expect(found!.fix).toBe(fix);
      // Rejected, not stored, with the frame template to work from.
      expect(r).toMatchObject({ accepted: false, sceneId: 'c5', stage: 'planned' });
      expect(r.template).toEqual(frameTemplate());
      expect(r.template.stage).toMatchObject({ kind: 'frame', duration: expect.any(Number), poster: expect.any(Number) });
      expect(r.next).toEqual(NEXT);
      expect((await w.call('get_lesson', { lessonId })).plan.accepted).toEqual([]);
    });

    it('code larger than the limit is refused for its length, and is not echoed back', async () => {
      const bad = frame(`${FRAME_CODE}${'// padding to make the code too large\n'.repeat(700)}`);
      expect(Buffer.byteLength(bad.stage.code)).toBeGreaterThan(FRAME_LIMITS.codeBytes);
      const r = await w.call('submit_scene', { lessonId, scene: bad });
      expect(r.ok).toBe(false);
      expect(r.errors.map((e) => `${e.code} ${e.path}`)).toEqual(['TOO_LONG stage.code']);
      expect(w.last!.text).not.toContain('padding to make the code too large');
      expect(w.last!.text.length).toBeLessThan(3000);
      expect(r.next).toMatchObject({ tool: 'submit_scene' });
    });

    it('several things wrong at once: every one is reported, each with its own fix', async () => {
      const bad = frame(FRAME_CODE.replace('S.clear();', 'S.clear();\n  const now = Date.now();\n  fetch("x");'));
      bad.beats[1].at = 99;
      bad.stage.poster = 99;
      const r = await w.call('submit_scene', { lessonId, scene: bad });
      const found = r.errors.map((e) => `${e.code} ${e.path}`);
      expect(found).toEqual(expect.arrayContaining(['FRAME_BANNED stage.code', 'FRAME_BEAT_TIME beats[1].at', 'FRAME_POSTER_RANGE stage.poster']));
      expect(r.errors.filter((e) => e.code === 'FRAME_BANNED')).toHaveLength(2);
      expect(new Set(r.errors.filter((e) => e.code === 'FRAME_BANNED').map((e) => e.fix)).size).toBe(2);
      expect(r.template).toEqual(frameTemplate());
      expect((await w.call('get_lesson', { lessonId })).activity.rejects).toMatchObject({ FRAME_BANNED: 2, FRAME_BEAT_TIME: 1, FRAME_POSTER_RANGE: 1 });
    });

    it('a warning from the frame check does not reject the scene, and is passed on', async () => {
      const r = await w.call('submit_scene', { lessonId, scene: frame(FRAME_CODE.replace('const grow', 'const jitter = Math.random();\n  const grow')) });
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.warnings.map((x) => `${x.code} ${x.path}`)).toContain('FRAME_RANDOM stage.code');
      expect(r.warnings.find((x) => x.code === 'FRAME_RANDOM')!.fix).toBe(FRAME_ISSUES.FRAME_RANDOM.fix);
    });

    it('after a rejection the same frame put right is accepted', async () => {
      const bad = frame(`${FRAME_CODE}\n}`);
      expect((await w.call('submit_scene', { lessonId, scene: bad })).ok).toBe(false);
      expect(await w.call('submit_scene', { lessonId, scene: frame() })).toMatchObject({ ok: true, accepted: true, stage: 'writing', next: { tool: 'submit_scene' } });
    });
  });

  describe('its code is kept exactly as it was sent', () => {
    const bytes = (s: string): string => Buffer.from(s, 'utf8').toString('hex');

    it('the code used here is the kind that tidying would change', () => {
      expect(AWKWARD_CODE).toContain('\r\n');
      expect(AWKWARD_CODE).toContain('\t');
      expect(AWKWARD_CODE).toMatch(/ {2,}\n/);
      expect(AWKWARD_CODE.startsWith('\n')).toBe(true);
      expect(AWKWARD_CODE.endsWith('   \n\n')).toBe(true);
      expect(AWKWARD_CODE).toContain('</script>');
      expect(AWKWARD_CODE).toContain('<!--');
      expect(AWKWARD_CODE).toContain('\u00a0');
      expect(AWKWARD_CODE).toContain('\u{1F9EA}');
      // A letter and its accent as two code points: normalising would join them.
      expect(AWKWARD_CODE).toContain('e\u0301');
      expect(AWKWARD_CODE.normalize('NFC')).not.toBe(AWKWARD_CODE);
      expect(AWKWARD_CODE.trim()).not.toBe(AWKWARD_CODE);
      expect(AWKWARD_CODE.replace(/\s+/g, ' ')).not.toBe(AWKWARD_CODE);
      expect(Buffer.byteLength(AWKWARD_CODE)).toBeLessThan(FRAME_LIMITS.codeBytes);
    });

    it.each([
      ['as an object', (s: Json): unknown => s],
      ['as a string of JSON', (s: Json): unknown => JSON.stringify(s)],
      ['with its stage as a string of JSON', (s: Json): unknown => ({ ...s, stage: JSON.stringify(s.stage) })],
    ])('byte for byte, from submit_scene (sent %s) to the draft, to get_lesson, to the published file, and back out of it', async (_name, send) => {
      const sent = frame(AWKWARD_CODE);
      const accepted = await w.call('submit_scene', { lessonId, scene: send(sent) });
      expect(accepted.errors).toEqual([]);
      expect(accepted.ok).toBe(true);

      // In the draft on disk.
      const draft = JSON.parse(await readFile(path.join(w.home, '.state', 'drafts', `${lessonId}.json`), 'utf8'));
      const stored = draft.scenes.find((s: Json) => s.id === 'c5');
      expect(bytes(stored.stage.code)).toBe(bytes(AWKWARD_CODE));
      // As get_lesson shows it.
      const shown = await w.call('get_lesson', { lessonId, include: ['scene:c5'] });
      expect(bytes(shown.scenes[0].scene.stage.code)).toBe(bytes(AWKWARD_CODE));

      // In the published file, after the whole lesson was validated once more.
      for (const s of SCENES) if (s.id !== 'c5') expect((await w.call('submit_scene', { lessonId, scene: s })).errors).toEqual([]);
      const published = await w.call('publish_lesson', { lessonId });
      expect(published.errors).toEqual([]);
      expect(published.ok).toBe(true);
      const html = await readFile(published.file.path, 'utf8');
      const embedded = readEmbeddedData(html)!.lesson.scenes.find((s) => s.id === 'c5') as unknown as Json;
      expect(embedded.stage.kind).toBe('frame');
      expect(bytes(embedded.stage.code)).toBe(bytes(AWKWARD_CODE));
      expect(embedded.stage.code).toBe(AWKWARD_CODE);
      // The text of the page cannot be ended from inside the code: the closing tag in it is escaped where it is embedded.
      const at = html.indexOf(DATA_OPEN) + DATA_OPEN.length;
      expect(html.slice(at, html.indexOf('</script', at))).not.toContain('<');

      // The hash in the receipt is over that very code: verify passes, and one changed character fails it.
      expect(await verifyFile(published.file.path, { strict: true })).toMatchObject({ ok: true, dataOk: true, receiptMatches: true, page: { result: 'identical' } });
      // Publishing again changes nothing: the code is the same after every pass through the validator.
      const again = await w.call('publish_lesson', { lessonId });
      expect(again.receipt.hash).toBe(published.receipt.hash);
      expect(await readFile(again.file.path, 'utf8')).toBe(html);
      await tamper(published.file.path, (json) => json.replace('const size = 12 + S.params.amount', 'const size = 13 + S.params.amount'));
      const checked = await verifyFile(published.file.path);
      expect(checked).toMatchObject({ ok: false, dataOk: false });
      expect(checked.problems.join(' ')).toMatch(/does not match the receipt/);
    });

    it('nothing on the way in changes it: what the validator is given is what was sent', async () => {
      // The code is checked as written: a tab or a line break lost on the way would make this two statements on one line, or none.
      const code = '// one\n\tconst a = 1 // two\n\tconst b = 2\nfunction render(ctx, t) {\n\tS.clear()\n\tS.text(String(a + b + S.params.amount), 10, 10)\n}';
      const r = await w.call('submit_scene', { lessonId, scene: frame(code) });
      expect(r.errors).toEqual([]);
      const shown = await w.call('get_lesson', { lessonId, include: ['scene:c5'] });
      expect(shown.scenes[0].scene.stage.code).toBe(code);
    });

    describe('when the stage is sent untidily, so that the validator would tidy the code like prose', () => {
      // Code that survives such tidying: no line comment, every statement closed. Tidied, its string loses a space and its tab.
      const code = 'const label = "two  spaces";\nfunction render(ctx, t) {\n\tS.clear();\n\tS.text(label + S.params.amount, 10, 10);\n}\n';
      const rename = (record: Json, from: string, to: string): void => {
        record[to] = record[from];
        delete record[from];
      };

      it.each([
        ['a space after the kind', (s: Json) => (s.stage.kind = 'frame ')],
        ['a space before the kind', (s: Json) => (s.stage.kind = ' frame')],
        ['a hidden character inside the kind', (s: Json) => (s.stage.kind = 'fra\u200bme')],
        ['the code under a name with a space after it', (s: Json) => rename(s.stage, 'code', 'code ')],
        ['the kind under a name with a hidden character in it', (s: Json) => rename(s.stage, 'kind', 'ki\u200bnd')],
        ['all of that, in a scene sent as a string of JSON', (s: Json) => (rename(s.stage, 'code', ' code'), (s.stage.kind = 'frame '))],
      ])('%s: the scene is refused, or its code is kept; it is never stored changed', async (name, edit) => {
        const sent = frame(code);
        edit(sent);
        const r = await w.call('submit_scene', { lessonId, scene: name.includes('string of JSON') ? JSON.stringify(sent) : sent });
        const stored = (await w.call('get_lesson', { lessonId, include: ['scene:c5'] })).scenes[0] as Json;
        if (r.ok) {
          expect(stored.scene.stage.code).toBe(code);
          return;
        }
        expect(stored).toEqual({ id: 'c5', status: 'pending' });
        // As the validator stands, it reads these as a frame and tidies the code; the tool sees the difference and refuses.
        const altered = r.errors.find((e) => e.code === 'FRAME_CODE_ALTERED');
        if (altered) {
          expect(altered).toMatchObject({ severity: 'error', path: 'stage.code', sceneId: 'c5' });
          expect(altered.message).toMatch(/would have been stored differently from how it was sent \(\d+ characters sent, \d+ after reading\)/);
          expect(altered.fix).toMatch(/the names "kind" and "code" and the value "frame" spelt exactly so/);
          // The code itself is not echoed.
          expect(w.last!.text).not.toContain('two  spaces');
          expect(r).toMatchObject({ accepted: false, sceneId: 'c5', template: frameTemplate(), next: { tool: 'submit_scene' } });
          expect(r.next.why).toContain('"c5" was not stored');
        }
      });

      it('sent tidily, the same code is accepted and kept', async () => {
        expect((await w.call('submit_scene', { lessonId, scene: frame(code) })).errors).toEqual([]);
        expect((await w.call('get_lesson', { lessonId, include: ['scene:c5'] })).scenes[0].scene.stage.code).toBe(code);
      });

      it('the code is found in whatever form the scene arrived', () => {
        const stage = { kind: 'frame', code };
        expect(sentFrameCode({ id: 'c5', stage })).toBe(code);
        expect(sentFrameCode(JSON.stringify({ id: 'c5', stage }))).toBe(code);
        expect(sentFrameCode({ id: 'c5', stage: JSON.stringify(stage) })).toBe(code);
        expect(sentFrameCode({ id: 'c5', ' stage': { 'code ': code } })).toBe(code);
        // An exact name wins over an untidy one beside it.
        expect(sentFrameCode({ stage: { 'code ': 'other', code } })).toBe(code);
        for (const nothing of [undefined, null, 7, 'not json', '[]', {}, { stage: 7 }, { stage: 'nope' }, { stage: {} }, { stage: { code: 7 } }]) expect(sentFrameCode(nothing)).toBeUndefined();
      });
    });

    it('what the code must not hold is refused, never removed', async () => {
      // A direction override hidden in a comment: the frame check names it. Stored text is never "repaired".
      const hidden = FRAME_CODE.replace('// Five bars', '// Five \u202ebars');
      const r = await w.call('submit_scene', { lessonId, scene: frame(hidden) });
      expect(r.ok).toBe(false);
      expect(r.errors.map((e) => `${e.code} ${e.path}`)).toContain('FRAME_HIDDEN_CHARACTERS stage.code');
      expect((await w.call('get_lesson', { lessonId })).plan.accepted).toEqual([]);
    });

    it('the store and the page keep any string whole, with no validator involved', async () => {
      // Storage: a draft written and read back.
      const store = new Store(path.join(w.home, 'elsewhere'), () => NOON);
      const hard = `${AWKWARD_CODE}\u2028\u2029\u0000\ud800 \ufeff\u200b`;
      const draft = await store.create({ topic: 'A topic', language: 'en', depth: 'quick', learner: { level: 'new', knows: 'k', goal: 'g', calibration: [] } });
      draft.scenes = [{ id: 'c5', kind: 'clip', stage: { kind: 'frame', code: hard } } as never];
      await store.save(draft);
      const loaded = await store.load(draft.id);
      expect(bytes((loaded!.scenes[0] as unknown as Json).stage.code)).toBe(bytes(hard));
      expect((loaded!.scenes[0] as unknown as Json).stage.code).toBe(hard);

      // Embedding: a lesson rendered and read back out of the page.
      const lesson = lessonOf([frame(AWKWARD_CODE) as never, ...(SCENES.slice(-1) as never[])]);
      const page = renderLesson(asPublished(lesson));
      const back = readEmbeddedData(page.html)!.lesson.scenes[0] as unknown as Json;
      expect(back.stage.code).toBe(AWKWARD_CODE);
      expect(canonicalJson(readEmbeddedData(page.html)!.lesson)).toBe(canonicalJson(lesson));
    });
  });

  it('a lesson containing a frame is published and verified like any other', async () => {
    for (const s of SCENES) expect((await w.call('submit_scene', { lessonId, scene: s.id === 'c5' ? frame() : s })).errors).toEqual([]);
    const published = await w.call('publish_lesson', { lessonId });
    expect(published.errors).toEqual([]);
    expect(published).toMatchObject({ ok: true, stage: 'published', next: { tool: 'reply' } });
    const file = published.file.path as string;
    const good = await verify(file, '--strict');
    expect(good.text).toMatch(/^OK {2}"Binary search/);
    expect(good.code).toBe(0);
    // The page is drawn again from its data, frame and all, and is the same.
    const html = await readFile(file, 'utf8');
    const data = readEmbeddedData(html)!;
    expect(renderLesson({ lesson: data.lesson, receipt: data.receipt }).html).toBe(html);

    // Its code edited in the data: the embedded lesson is not the one that was validated.
    await tamper(file, (json) => json.replace('const BARS = 5;', 'const BARS = 6;'));
    const bad = await verify(file);
    expect(bad.code).toBe(1);
    expect(bad.text).toMatch(/^FAILED/);
    expect(bad.text).toContain('does not match the receipt');

    // Code that the frame check refuses, put in by hand, with the hash recomputed to match: still refused, by code.
    await writeFile(file, html);
    const forged = structuredClone(data) as unknown as { lesson: Json; receipt: Json };
    const c5 = forged.lesson.scenes.find((s: Json) => s.id === 'c5');
    c5.stage.code = c5.stage.code.replace('S.clear();', 'S.clear();\n  fetch("https://example.org/");');
    forged.receipt.hash = hashLesson(forged.lesson as never);
    await tamper(file, () => JSON.stringify(forged).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));
    const checked = await verifyFile(file);
    expect(checked).toMatchObject({ ok: false, dataOk: false });
    expect(checked.errors.map((e) => `${e.code} ${e.sceneId}`)).toContain('FRAME_BANNED c5');
    expect((await verify(file)).text).toMatch(/FRAME_BANNED c5 stage\.code/);

    // The page text edited, the data left alone.
    await writeFile(file, html.replace('<h1 class="lt-title"', '<p>Everything below is false.</p><h1 class="lt-title"'));
    const differs = await verify(file);
    expect(differs.code).toBe(1);
    expect(differs.text).toMatch(/^DATA OK, PAGE DIFFERS/);
  });

  it('more frames than a lesson may have are refused at the plan', async () => {
    const tooMany = PLAN.outline.map((entry) => (['c2', 'c4', 'c5'].includes(entry.id) ? { ...entry, stage: 'frame' } : entry));
    const r = await w.call('plan_lesson', { lessonId, title: PLAN.title, objectives: PLAN.objectives, outline: tooMany });
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toContain('PLAN_TOO_MANY_FRAMES');
    expect(r.next).toMatchObject({ tool: 'plan_lesson' });
    expect(r.next.why).toContain('the earlier plan still stands');
  });
});

describe('clips with nothing for the learner to do', () => {
  // The clip lesson with its first checkpoint moved behind the fourth clip: c1, c2, c3 and c4 come
  // in a row. plan_lesson accepts it, because an outline cannot say whether a clip will carry a
  // gate or an explore. The lesson rules need one in that stretch, and in two clips of every three.
  const order = ['c1', 'c2', 'c3', 'c4', 'q1', 'c5', 'q2', 'c6', 'q3', 'end'];
  const plan = (): Json => ({ title: PLAN.title, objectives: PLAN.objectives, outline: order.map((id) => PLAN.outline.find((e) => e.id === id)) });
  /** A clip with its gates and its explore taken away: nothing left for the learner to do. */
  const idle = (id: string): Json => {
    const s = scene(id);
    for (const beat of s.beats) delete beat.gate;
    delete s.explore;
    return s;
  };
  const acts = (id: string): boolean => scene(id).explore !== undefined || (scene(id).beats as Json[]).some((beat) => beat.gate !== undefined);
  const notes = (r: Envelope, code: string): Issue[] => r.warnings.filter((x) => x.code === code);

  let lessonId: string;
  beforeEach(async () => {
    lessonId = (await w.call('start_lesson', CLIP_PARTS.start)).lessonId as string;
    await w.call('save_evidence', { lessonId, items: CLIP_PARTS.evidence });
    expect(await w.call('plan_lesson', { lessonId, ...plan() })).toMatchObject({ ok: true, warnings: [] });
  });

  it('the lesson has its learner actions where this test expects them: four clips of six', () => {
    expect(order.filter((id) => id.startsWith('c')).map((id) => [id, acts(id)])).toEqual([['c1', false], ['c2', true], ['c3', true], ['c4', true], ['c5', true], ['c6', false]]);
    expect(scene('c5').explore).toBeDefined();
  });

  it('a clip is accepted with a warning as soon as it is certain that the lesson will fail for it, not only when the last scene is in', async () => {
    // c1 has nothing to do, and nothing is certain: five clips are still to come.
    const first = await w.call('submit_scene', { lessonId, scene: scene('c1') });
    expect([...notes(first, 'PREDICT_NEEDED'), ...notes(first, 'ACTION_NEEDED')]).toEqual([]);
    const second = await w.call('submit_scene', { lessonId, scene: idle('c2') });
    expect([...notes(second, 'PREDICT_NEEDED'), ...notes(second, 'ACTION_NEEDED')]).toEqual([]);
    // With c3 in as well, three of the six clips have nothing to do: even if the other three all ask something, four must.
    const third = await w.call('submit_scene', { lessonId, scene: idle('c3') });
    expect(third).toMatchObject({ ok: true, accepted: true });
    expect(notes(third, 'PREDICT_NEEDED')).toEqual([]);
    const share = notes(third, 'ACTION_NEEDED');
    expect(share.map((x) => `${x.code} ${x.sceneId} ${x.path}`)).toEqual(['ACTION_NEEDED c3 beats']);
    expect(share[0]!.message).toBe('"c3" has no gate and no explore, and with it 3 of the 6 planned clips have nothing for the learner to do (c1, c2, c3): at least 4 of the 6 must. As it stands the lesson will fail INTERACTIVE_SHARE when the last scene is in.');
    expect(share[0]!.fix).toMatch(/^The learner acts before being told\. Add a "gate" to the beat of "c3" that shows an outcome/);
    // With c4 in too, also with nothing to do, the stretch is four scenes long: the passive run is certain as well.
    const fourth = await w.call('submit_scene', { lessonId, scene: idle('c4') });
    expect(fourth).toMatchObject({ ok: true, accepted: true });
    const run = notes(fourth, 'PREDICT_NEEDED');
    expect(run.map((x) => `${x.code} ${x.sceneId} ${x.path}`)).toEqual(['PREDICT_NEEDED c4 beats']);
    expect(run[0]!.message).toBe(`"c4" has no beat with a "gate" and no "explore", and it sits among more than ${LIMITS.passiveRun} scenes in a row with no checkpoint and no prediction. As it stands the lesson will fail PASSIVE_RUN when the last scene is in.`);
    expect(run[0]!.fix).toMatch(/^Add a "gate" to the beat of "c4" that shows an outcome and submit it again \(the template plan_lesson returned shows one\), or an "explore" after its last beat/);
    expect(notes(fourth, 'ACTION_NEEDED').map((x) => x.sceneId)).toEqual(['c4']);
    // With its gate there is nothing to say about the stretch, and c4 is no longer one of the clips with nothing to do.
    const again = await w.call('submit_scene', { lessonId, scene: scene('c4') });
    expect([...notes(again, 'PREDICT_NEEDED'), ...notes(again, 'ACTION_NEEDED')]).toEqual([]);
  });

  it('neither note is a rejection, and neither is recorded in the lesson', async () => {
    for (const id of ['c1', 'c2', 'c3']) await w.call('submit_scene', { lessonId, scene: idle(id) });
    const shown = await w.call('get_lesson', { lessonId });
    expect(shown.plan.accepted).toEqual(['c1', 'c2', 'c3']);
    expect(JSON.stringify(shown.outstanding)).not.toContain('ACTION_NEEDED');
  });

  describe('once every scene is in', () => {
    let last: Envelope;
    beforeEach(async () => {
      for (const id of order) last = await w.call('submit_scene', { lessonId, scene: ['c2', 'c3', 'c4'].includes(id) ? idle(id) : scene(id) });
    });

    it('next asks for a gate or an explore in the clips, not for another plan', async () => {
      expect(last).toMatchObject({ ok: true, errors: [], stage: 'writing' });
      expect(codes(last.lessonReport.errors)).toEqual(['PASSIVE_RUN', 'INTERACTIVE_SHARE']);
      expect(last.next).toEqual({
        tool: 'submit_scene',
        why: 'Every scene is accepted, but 2 errors block publishing: "lessonReport.errors" has each error with its "fix". PASSIVE_RUN needs a "gate" on a beat that shows an outcome (or an "explore"), in one of "c1", "c2", "c3", "c4"; the plan can stay as it is. INTERACTIVE_SHARE needs a "gate" on a beat that shows an outcome (options, or a part of the picture to tap) or an "explore" after the last beat, in 3 of "c1", "c2", "c3", "c4", "c6"; the plan can stay as it is.',
      });
      // The same answer from every tool that can be asked, each pointing at where it shows the error.
      const validated = await w.call('validate_lesson', { lessonId });
      expect(validated.next).toMatchObject({ tool: 'submit_scene' });
      expect(validated.next.why).toContain('"errors" has each error');
      const shown = await w.call('get_lesson', { lessonId });
      expect(shown.next.why).toContain('"outstanding.errors" has each error');
      const refused = await w.call('publish_lesson', { lessonId });
      expect(refused).toMatchObject({ ok: false, published: false, next: { tool: 'submit_scene' } });
      expect(refused.next.why).toContain('in one of "c1", "c2", "c3", "c4"');
      expect(refused.next.why).toContain('in 3 of "c1", "c2", "c3", "c4", "c6"');
    });

    it('sending the same plan again does not loop: the result shows the errors and still points at the clips', async () => {
      const replanned = await w.call('plan_lesson', { lessonId, ...plan() });
      expect(replanned).toMatchObject({ ok: true, errors: [], stage: 'writing', next: { tool: 'submit_scene' } });
      expect(codes(replanned.lessonErrors)).toEqual(['PASSIVE_RUN', 'INTERACTIVE_SHARE']);
      expect(replanned.next.why).toContain('"lessonErrors" has each error');
      expect(replanned.next.why).toContain('"c3"');
    });

    it('the repair next names is the one that works: one gate ends the passive run, and a gate or an explore in three clips makes the share', async () => {
      const one = await w.call('submit_scene', { lessonId, scene: scene('c3') });
      expect(one).toMatchObject({ ok: true, stage: 'writing', next: { tool: 'submit_scene' } });
      expect(codes(one.lessonReport.errors)).toEqual(['INTERACTIVE_SHARE']);
      expect(one.next.why).toContain('INTERACTIVE_SHARE needs a "gate" on a beat that shows an outcome (options, or a part of the picture to tap) or an "explore" after the last beat, in 2 of "c1", "c2", "c4", "c6"; the plan can stay as it is.');
      const two = await w.call('submit_scene', { lessonId, scene: scene('c2') });
      expect(two.next.why).toContain('in one of "c1", "c4", "c6"');
      const fixed = await w.call('submit_scene', { lessonId, scene: scene('c4') });
      expect(fixed).toMatchObject({ ok: true, stage: 'ready', next: { tool: 'publish_lesson' } });
      expect(fixed.lessonErrors).toBeUndefined();
      expect(fixed.lessonReport.errors).toEqual([]);
    });
  });
});

describe('result sizes for the largest lesson of clips', () => {
  // The limits the fix round settled on, which hold for a lesson of any kind: a host moves a result
  // to a file near 50,000 characters, and cuts the middle out of an error near 11,000.
  const RESULT_MAX = 45_000;
  const SHOWN_MAX = 48_000;

  it('is the largest: deep, sixteen scenes, twelve clips of eight beats over every stage kind, two frames, forty passages', () => {
    const lesson = largeClipLesson();
    const outline = lesson.plan.outline as Json[];
    expect(outline).toHaveLength(16);
    expect(outline.filter((e) => e.kind === 'clip')).toHaveLength(12);
    expect(new Set(outline.filter((e) => e.kind === 'clip').map((e) => e.stage))).toEqual(new Set(PLAN_STAGE_KINDS));
    expect(outline.filter((e) => e.stage === 'frame')).toHaveLength(LIMITS.framesPerLesson);
    expect(lesson.evidence).toHaveLength(LIMITS.evidencePerLesson);
  });

  it('every result on the way to a published lesson stays under them, and so does every refusal', async () => {
    const sizes: Record<string, number> = {};
    const lesson = largeClipLesson();
    const { lessonId, plan, scenes } = await plannedFromTemplates(lesson);
    // The plan result carries a template per scene and the notes: the longest result in the flow.
    sizes.plan = w.last!.text.length;
    expect(sizes.plan).toBeLessThan(RESULT_MAX);
    expect(plan.templates).toHaveLength(16);
    for (const s of scenes.filter((x) => x.kind === 'clip')) expect(s.beats).toHaveLength(8);

    // A refusal of the largest clip with everything wrong with it: under the size a host shows whole, with or without its template.
    const worst = clone(scenes.find((s) => s.stage?.kind === 'cells') as Json);
    for (const beat of worst.beats) {
      beat.caption.text = `${beat.caption.text} ${'and more words than one caption may ever hold '.repeat(4)}`.trim();
      for (const action of beat.do) Object.assign(action, { duration: 900 });
    }
    const refused = await w.call('submit_scene', { lessonId, scene: worst });
    expect(refused.ok).toBe(false);
    sizes.refusal = w.last!.text.length;
    expect(sizes.refusal).toBeLessThanOrEqual(ERROR_RESULT_MAX_CHARS);
    expect(refused.errors.length).toBeGreaterThan(10);
    const brokenFrame = clone(scenes.find((s) => s.stage?.kind === 'frame') as Json);
    brokenFrame.stage.code = `${'// a long comment that makes the code long without making it wrong\n'.repeat(300)}${brokenFrame.stage.code}\n}`;
    const refusedFrame = await w.call('submit_scene', { lessonId, scene: brokenFrame });
    expect(codes(refusedFrame.errors)).toContain('FRAME_SYNTAX');
    sizes.frameRefusal = w.last!.text.length;
    expect(sizes.frameRefusal).toBeLessThanOrEqual(ERROR_RESULT_MAX_CHARS);
    // The code that was sent, tens of thousands of characters of it, is never echoed back.
    expect(w.last!.text).not.toContain('a long comment that makes the code long');

    // Every accepted scene: its metrics, the totals and what is pending.
    let largest = 0;
    let last: Envelope | undefined;
    for (const s of scenes) {
      last = await w.call('submit_scene', { lessonId, scene: s });
      expect(last.errors).toEqual([]);
      largest = Math.max(largest, w.last!.text.length);
    }
    sizes.submit = largest;
    expect(sizes.submit).toBeLessThan(9_000);
    expect(last!.lessonReport).toMatchObject({ ok: true, complete: true });
    expect(last!.lessonReport.stats).toMatchObject({ scenes: 16, figures: 12, checkpoints: 3 });

    await w.call('validate_lesson', { lessonId });
    sizes.validate = w.last!.text.length;
    expect(sizes.validate).toBeLessThan(9_000);
    await w.call('get_lesson', { lessonId });
    sizes.get = w.last!.text.length;
    expect(sizes.get).toBeLessThan(22_000);
    expect((await w.call('get_lesson', { lessonId, include: ['evidence'] })).ok).toBe(true);
    sizes.getWithEvidence = w.last!.text.length;
    expect(sizes.getWithEvidence).toBeLessThan(SHOWN_MAX);
    // One stored clip in full, the largest of them and a frame with its code.
    for (const id of scenes.filter((s) => s.kind === 'clip').map((s) => s.id as string)) {
      await w.call('get_lesson', { lessonId, include: [`scene:${id}`] });
      expect(w.last!.text.length, id).toBeLessThan(SHOWN_MAX);
      sizes.getWithScene = Math.max(sizes.getWithScene ?? 0, w.last!.text.length);
    }

    const published = await w.call('publish_lesson', { lessonId });
    expect(published.errors).toEqual([]);
    expect(published.ok).toBe(true);
    sizes.publish = w.last!.text.length;
    expect(sizes.publish).toBeLessThan(RESULT_MAX);
    expect(published.reply).toMatch(/16 scenes, 24 passages from 24 pages on 3 sites\./);
    const checked = await verifyFile(published.file.path, { strict: true });
    expect(checked.problems).toEqual([]);
    expect(checked).toMatchObject({ ok: true, receiptMatches: true, page: { result: 'identical' } });
    // The numbers, for the record of this run: the plan is the long one, and it is about half of what a host shows whole.
    expect(sizes.plan).toBeGreaterThan(sizes.publish as number);
    expect(sizes).toMatchObject({ plan: expect.any(Number), refusal: expect.any(Number), submit: expect.any(Number), publish: expect.any(Number) });
  });

  it('with all forty passages at their full length, the lesson shown with every excerpt still fits', async () => {
    // The generated passages are a sentence long. Padded to the 800 characters an excerpt may have, they are the most a lesson can store.
    const lesson = largeClipLesson();
    const filler = ' The rest of this passage is padding that says nothing more about the machine and only makes the excerpt as long as an excerpt may be.';
    lesson.evidence = (lesson.evidence as { excerpt: string }[]).map((item) => ({ ...item, excerpt: `${item.excerpt}${filler.repeat(6)}`.slice(0, LIMITS.excerptChars.max).trim() }));
    const { lessonId, scenes } = await plannedFromTemplates(lesson);
    for (const s of scenes) expect((await w.call('submit_scene', { lessonId, scene: s })).errors).toEqual([]);
    const shown = await w.call('get_lesson', { lessonId, include: ['evidence'] });
    expect(shown).toMatchObject({ ok: true, stage: 'ready' });
    expect(shown.evidence).toHaveLength(LIMITS.evidencePerLesson);
    for (const item of shown.evidence) expect(item.untrusted_source_text.length).toBeGreaterThan(LIMITS.excerptChars.max - 10);
    expect(w.last!.text.length).toBeLessThan(SHOWN_MAX);
    expect((await w.call('publish_lesson', { lessonId })).ok).toBe(true);
    expect(w.last!.text.length).toBeLessThan(RESULT_MAX);
  });

  it('a plan of sixteen frames\' worth of templates would still fit: no template is large', () => {
    const sizesByKind = Object.fromEntries(PLAN_STAGE_KINDS.map((stage) => [stage, JSON.stringify(templateFor({ id: 'x', kind: 'clip', purpose: 'p', stage } as never)).length]));
    for (const [kind, size] of Object.entries(sizesByKind)) expect(size, kind).toBeLessThan(2_500);
    // Sixteen of the largest, with the notes, is still under what a host shows whole.
    expect(16 * Math.max(...Object.values(sizesByKind)) + JSON.stringify(notesFor(['clip', 'checkpoint', 'recap'])).length).toBeLessThan(45_000);
  });
});

describe('the passages used by the generated lessons', () => {
  it('are the stored ones: a caption made from a passage is grounded in it', () => {
    const lesson = everyStageLesson();
    const p = passage(0);
    expect(p.id).toBe('e1');
    for (const word of p.words) expect((lesson.evidence[0] as { excerpt: string }).excerpt.toLowerCase()).toContain(word);
  });
});
