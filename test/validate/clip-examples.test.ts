// Every example clip that is presented as a complete scene passes the validator with no error and
// no warning: an agent imitates the examples before it reads a rule, so an example that draws a
// warning teaches the warning. Here: the v2 example lesson (as scenes, and as a whole lesson), the
// one-per-kind clips, the clips of the two extra kits, and the three frame examples as clips.
//
// (The clips the skill writes by hand in its references are held to the same in test/skill.)
//
// The example lesson and its demonstration clips are written on the player's side. Two things are
// said about them here that are not "passes clean": what the lesson as written still owes the
// interactivity rules (the tests of a whole lesson run on `LESSON_SCENES`, which makes it up), and
// that the three clips that end in an explore pass every rule about explores, formulas and gates
// answered by a tap, whatever else a demonstration clip leaves out.
import { describe, expect, it } from 'vitest';
import { LessonV2, STAGE_KINDS, type StageKind } from '../../src/core/clip';
import { EXAMPLE_CLIPS, EXAMPLE_V2_SCENES, EXPLORE_EXAMPLE_CLIPS, EXPLORE_EXAMPLE_EVIDENCE } from '../../src/core/clip-examples';
import { EXTRA_EXAMPLE_CLIPS } from '../../src/core/clip-kits-extra-examples';
import { EXAMPLE_PLAN, EXAMPLE_START } from '../../src/core/examples';
import { FRAME_EXAMPLES, FRAME_EXAMPLE_SORT, frameExampleClip, type FrameExample } from '../../src/core/frame-examples';
import { canonicalJson, hashLesson } from '../../src/core/hash';
import { ISSUES } from '../../src/core/issues';
import { LIMITS as L } from '../../src/core/limits';
import type { Draft, Issue, SceneCheck } from '../../src/core/types';
import { checkLesson, checkPlan, checkScene, estimateMinutes, evidenceUses, verifyLesson } from '../../src/core/validate';
import { CLIP_PLAN, EXAMPLE_IS_INTERACTIVE, LESSON_SCENES, checkAlone, clipDraft, draftAround, entryFor, evidenceDraft, plannedClipDraft, type Loose } from './clip-kit';
import { expectNoExcerptText, newDraft, saveEvidence, setPlan, submit } from './helpers';

const said = (check: { errors: Issue[]; warnings: Issue[] }): string[] => [...check.errors, ...check.warnings].map((i) => `${i.severity} ${i.code} ${i.path}: ${i.message}`);

/** A frame example as a clip, checked in a lesson that stored the example's own passages. */
function checkFrameExample(example: FrameExample, id = example.id): SceneCheck {
  const clip = { ...frameExampleClip(example), id };
  const draft: Draft = newDraft(EXAMPLE_START);
  for (const item of example.evidence) saveEvidence(draft, item);
  setPlan(draft, { title: EXAMPLE_PLAN.title, objectives: EXAMPLE_PLAN.objectives, outline: [entryFor(clip)] });
  return checkScene(clip, draft);
}

describe('the v2 example lesson (src/core/clip-examples.ts)', () => {
  it('has a plan the plan rules accept: a clip first, a stage kind on every clip', () => {
    const check = checkPlan(structuredClone(CLIP_PLAN), evidenceDraft());
    expect(said(check)).toEqual([]);
    expect(check.ok).toBe(true);
    expect(CLIP_PLAN.outline.map((e) => (e.kind === 'clip' ? `${e.id}:${e.stage}` : `${e.id}:${e.kind}`))).toEqual([
      'c1:words', 'c2:flow', 'c3:cells', 'q1:checkpoint', 'c4:chart', 'c5:dots', 'q2:checkpoint', 'c6:cells', 'q3:checkpoint', 'end:recap',
    ]);
    // A clip is budgeted caption by caption; a checkpoint and the recap have no prose budget.
    expect(check.budgets).toEqual({ c1: { ...L.captionWords, per: 'beat' }, c2: { ...L.captionWords, per: 'beat' }, c3: { ...L.captionWords, per: 'beat' }, q1: null, c4: { ...L.captionWords, per: 'beat' }, c5: { ...L.captionWords, per: 'beat' }, q2: null, c6: { ...L.captionWords, per: 'beat' }, q3: null, end: null });
  });

  it.each(EXAMPLE_V2_SCENES.map((s) => [s.id, s] as const))('scene %s is accepted with no error and no warning', (_id, scene) => {
    const check = checkScene(structuredClone(scene), plannedClipDraft());
    expect(said(check)).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.scene?.id).toBe(scene.id);
  });

  it('as it is written, the lesson owes nothing but the interactivity rules; once it meets them it passes clean', () => {
    const draft = plannedClipDraft();
    for (const scene of EXAMPLE_V2_SCENES) expect(submit(draft, structuredClone(scene)).ok, scene.id).toBe(true);
    const report = checkLesson(draft);
    const found = [...report.errors, ...report.warnings].map((i) => i.code);
    if (EXAMPLE_IS_INTERACTIVE) expect(said(report)).toEqual([]);
    // Two clips in three give the learner something to do, and a standard lesson has an explore.
    else for (const code of found) expect(['INTERACTIVE_SHARE', 'NO_EXPLORE'], said(report).join('\n')).toContain(code);
    expect(report.complete).toBe(true);
  });

  it.each(LESSON_SCENES.map((s) => [s.id, s] as const))('scene %s, with the learner actions the lesson tests add, is accepted with no error and no warning', (_id, scene) => {
    const check = checkScene(structuredClone(scene), plannedClipDraft());
    expect(said(check)).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('passes as a complete lesson: zero errors, zero warnings', () => {
    const draft = clipDraft();
    const report = checkLesson(draft);
    expect(said(report)).toEqual([]);
    expect(report).toMatchObject({ ok: true, complete: true, pending: [] });
    expect(report.lesson?.scenes.map((s) => s.kind)).toEqual(['clip', 'clip', 'clip', 'checkpoint', 'clip', 'clip', 'checkpoint', 'clip', 'checkpoint', 'recap']);
    expect(LessonV2.safeParse(report.lesson).success).toBe(true);
    expect(report.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.hash).toBe(hashLesson(report.lesson!));
  });

  it('reports what the lesson adds up to', () => {
    const report = checkLesson(clipDraft());
    // Six clips: the stage of a clip is its figure. 27 beats, 3 graded checkpoints.
    expect(report.stats).toMatchObject({ scenes: 10, checkpoints: 3, figures: 6, claims: 14, quotes: 1, sources: 5, pages: 5, hosts: 3, weakClaims: 0 });
    const clips = report.lesson!.scenes.flatMap((s) => (s.kind === 'clip' ? [s] : []));
    const beats = clips.flatMap((s) => s.beats);
    expect(beats).toHaveLength(27);
    // Two clips in three ask something of the learner, by a gate or by an explore.
    const gates = beats.filter((b) => b.gate).length;
    const explores = clips.filter((s) => s.explore !== undefined).length;
    expect(clips.filter((s) => s.explore !== undefined || s.beats.some((b) => b.gate !== undefined)).length).toBeGreaterThanOrEqual(4);
    expect(gates).toBeGreaterThanOrEqual(3);
    expect(explores).toBeGreaterThanOrEqual(1);
    // The estimate: prose at 200 words a minute, a minute for each checkpoint, a quarter for each beat, a half for each gate, three quarters for an explore.
    expect(report.stats.minutes).toBe(Math.round(report.stats.words / 200 + 3 * 1 + 27 * 0.25 + gates * 0.5 + explores * 0.75));
    expect(report.stats.minutes).toBe(estimateMinutes({ words: report.stats.words, gradedCheckpoints: 3, reflectCheckpoints: 0, predicts: 0, steps: 0, figures: 0, beats: 27, gates, explores }));
  });

  it('cites no passage from more than six items, a clip being one item', () => {
    const uses = evidenceUses(clipDraft());
    // e1: the clips c2, c3 and c5, the explanations of q1 and q3, and a takeaway. Counted caption by caption it would be ten.
    expect(uses).toEqual({ e1: 6, e2: 5, e3: 3, e4: 1, e5: 2 });
    for (const n of Object.values(uses)) expect(n).toBeLessThanOrEqual(L.usesPerEvidence);
  });

  it('can be validated again from its own published data, to the same hash', () => {
    const report = checkLesson(clipDraft());
    const published = JSON.parse(JSON.stringify(report.lesson)) as unknown;
    const again = verifyLesson(published);
    expect(said(again)).toEqual([]);
    expect(again.hash).toBe(report.hash);
    expect(canonicalJson(again.lesson)).toBe(canonicalJson(report.lesson));
    // And a lesson changed after publishing is not the lesson that was validated.
    const edited = JSON.parse(JSON.stringify(report.lesson)) as Loose;
    edited.scenes[1].beats[0].caption.text = 'Binary search works on a sorted array. It repeats one move.';
    const changed = verifyLesson(edited);
    expect(changed.hash === report.hash && changed.ok).toBe(false);
  });

  it('is the same report and the same hash on every run', () => {
    const a = checkLesson(clipDraft());
    const b = checkLesson(clipDraft());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.hash).toBe(b.hash);
  });

  it('never repeats excerpt text in what it says', () => {
    const draft = clipDraft();
    const report = checkLesson(draft);
    expectNoExcerptText([...report.errors, ...report.warnings], draft);
  });
});

describe('the three clips that end in an explore (EXPLORE_EXAMPLE_CLIPS)', () => {
  const clips = Object.entries(EXPLORE_EXAMPLE_CLIPS);
  /** The rules of this round: explore, formulas, curve charts and gates answered by a tap. */
  const interactive = (code: string): boolean => (ISSUES as Record<string, { group: string }>)[code]?.group === 'interactive';
  /** One of them checked on its own, in a lesson that holds the example's passages and, after them, the ones these clips bring (e6 to e9). */
  const checkExplore = (clip: Loose): SceneCheck => {
    const draft = draftAround(clip);
    for (const item of EXPLORE_EXAMPLE_EVIDENCE) saveEvidence(draft, item);
    return checkScene(structuredClone(clip), draft);
  };

  it('are one on dots, one on a curve chart and one on bars, each with a control, bindings and a goal', () => {
    expect(clips.map(([kind, clip]) => `${kind}:${clip.stage.kind}${clip.stage.kind === 'chart' ? `.${clip.stage.mark}` : ''}`)).toEqual(['dots:dots', 'curve:chart.curve', 'bars:chart.bars']);
    for (const [kind, clip] of clips) {
      expect(clip.explore?.controls.length, kind).toBeGreaterThanOrEqual(1);
      expect(clip.explore?.bind?.length, kind).toBeGreaterThanOrEqual(1);
      expect(clip.explore?.goal, kind).toBeDefined();
      expect(clip.stage.provenance, kind).not.toBe('sourced');
    }
  });

  it.each(clips)('%s: is accepted: nothing about its explore, its formulas, its gates, its stage or its captions is refused', (_kind, clip) => {
    const check = checkExplore(clip);
    expect(said({ errors: check.errors, warnings: [] })).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it.each(clips)('%s: what it is warned about is at most that an end of its slider reaches its goal', (_kind, clip) => {
    // A goal met by dragging to the end is a warning, not a refusal: the clips are the player's to reword.
    const check = checkExplore(clip);
    for (const found of check.warnings) expect(['GOAL_AT_END'], said(check).join('\n')).toContain(found.code);
    expect(check.warnings.filter((w) => interactive(w.code) && w.code !== 'GOAL_AT_END')).toEqual([]);
  });
});

describe('one clip of every stage kind (EXAMPLE_CLIPS)', () => {
  it('covers the nine stage kinds', () => {
    expect(Object.keys(EXAMPLE_CLIPS).sort()).toEqual([...STAGE_KINDS].sort());
    for (const kind of STAGE_KINDS) expect(EXAMPLE_CLIPS[kind].stage.kind).toBe(kind);
  });

  it.each(STAGE_KINDS.filter((kind) => kind !== 'frame').map((kind) => [kind] as const))('%s: no error and no warning, against the example lesson\'s evidence', (kind: StageKind) => {
    const check = checkAlone(structuredClone(EXAMPLE_CLIPS[kind]));
    expect(said(check)).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('frame: no error and no warning, against the passage the bubble sort example carries', () => {
    expect(EXAMPLE_CLIPS.frame.stage).toEqual(FRAME_EXAMPLE_SORT.stage);
    const check = checkFrameExample(FRAME_EXAMPLE_SORT, EXAMPLE_CLIPS.frame.id);
    expect(said(check)).toEqual([]);
    expect(check.ok).toBe(true);
  });
});

describe('the clips of the lines and timeline kits (EXTRA_EXAMPLE_CLIPS)', () => {
  it.each(EXTRA_EXAMPLE_CLIPS.map((clip) => [clip.id, clip] as const))('%s: no error and no warning', (_id, clip) => {
    const check = checkAlone(structuredClone(clip));
    expect(said(check)).toEqual([]);
    expect(check.ok).toBe(true);
  });
});

describe('the frame examples as clips (frameExampleClip)', () => {
  it.each(FRAME_EXAMPLES.map((example) => [example.id, example] as const))('%s: no error and no warning, in a lesson that stored its passage', (_id, example) => {
    const check = checkFrameExample(example);
    expect(said(check)).toEqual([]);
    expect(check.ok).toBe(true);
    // The code is stored as it was written.
    expect(check.scene?.kind === 'clip' && check.scene.stage.kind === 'frame' ? check.scene.stage.code : null).toBe(example.stage.code);
  });

  it('each has a caption that is a claim, and a worked stage cites the passage it applies', () => {
    for (const example of FRAME_EXAMPLES) {
      const clip = frameExampleClip(example);
      expect(clip.beats.some((b) => b.caption.type === 'claim'), example.id).toBe(true);
      if (example.stage.provenance !== 'illustrative') expect(example.stage.cites.length, example.id).toBeGreaterThan(0);
      expect(example.evidence.length, example.id).toBeGreaterThan(0);
    }
  });
});
