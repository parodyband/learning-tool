// checkPlan for lessons made of clips: the outline carries kind "clip" with a stage kind, a clip
// opens the lesson, counts as the lesson's figure and as something to do, and at most two of the
// clips may be custom frames. The rules for the older kinds are unchanged (plan.test.ts).
import { describe, expect, it } from 'vitest';
import { ANY_SCENE_KINDS, ChartStage, STAGE_KINDS, VERBS_BY_STAGE } from '../../src/core/clip';
import { DEPTHS, LIMITS as L, type Depth } from '../../src/core/limits';
import { OutlineEntry, PLAN_CHART_MARKS, PLAN_SCENE_KINDS, PLAN_STAGE_KINDS, SCENE_KINDS, type PlanInput, type PlanStageKind } from '../../src/core/schema';
import { templateFor } from '../../src/core/templates';
import type { Draft } from '../../src/core/types';
import { checkPlan } from '../../src/core/validate';
import { buildEvidence } from './build';
import { CLIP_PLAN, changedPlan, clipDraft, clipScene, evidenceDraft } from './clip-kit';
import { errorCodes, expectActionable, newDraft, saveEvidence, submit } from './helpers';

/** An outline from a string: a letter for a clip of a stage kind (see STAGES), c a graded checkpoint, x a reflect checkpoint, r the recap, n a narration, s a step_through. */
const STAGES: Record<string, PlanStageKind> = { w: 'words', f: 'flow', e: 'cells', d: 'dots', h: 'chart', q: 'sequence', l: 'lines', t: 'timeline', F: 'frame' };
function planOf(pattern: string, objectives = 2): PlanInput {
  let checkpoint = 0;
  return {
    title: 'A lesson about searching',
    objectives: Array.from({ length: objectives }, (_, i) => ({ id: `o${i + 1}`, text: `Explain part ${'abcdefghi'[i]} of the search` })),
    outline: [...pattern].map((ch, i) => {
      const base = { id: `s${i + 1}`, purpose: 'What this scene is for' };
      if (STAGES[ch]) return { ...base, kind: 'clip' as const, stage: STAGES[ch] };
      if (ch === 'c' || ch === 'x') return { ...base, kind: 'checkpoint' as const, question: ch === 'x' ? ('reflect' as const) : ('single' as const), objective: `o${(checkpoint++ % objectives) + 1}` };
      if (ch === 'n') return { ...base, kind: 'narration' as const };
      if (ch === 's') return { ...base, kind: 'step_through' as const, figure: 'lines' as const };
      return { ...base, kind: 'recap' as const };
    }),
  };
}
function draftAt(depth: Depth): Draft {
  const draft = newDraft({ topic: 'Binary search', depth, learner: { level: 'new', knows: 'Nothing yet.', goal: 'Explain it.' } });
  saveEvidence(draft, buildEvidence(0));
  return draft;
}
const check = (pattern: string, depth: Depth = 'standard', objectives = 2): ReturnType<typeof checkPlan> => checkPlan(planOf(pattern, objectives), draftAt(depth));

describe('the outline of a lesson of clips', () => {
  it('names the kinds a plan may hold, and the stage kinds, as core/clip has them', () => {
    expect([...PLAN_SCENE_KINDS].sort()).toEqual([...ANY_SCENE_KINDS].sort());
    expect(PLAN_SCENE_KINDS).toEqual([...SCENE_KINDS, 'clip']);
    expect(PLAN_STAGE_KINDS).toEqual(STAGE_KINDS);
  });

  it('an entry for a clip is { id, kind: "clip", purpose, stage }', () => {
    expect(OutlineEntry.parse({ id: 'c1', kind: 'clip', purpose: 'Open on the question', stage: 'words' })).toEqual({ id: 'c1', kind: 'clip', purpose: 'Open on the question', stage: 'words' });
    expect(OutlineEntry.safeParse({ id: 'c1', kind: 'clip', purpose: 'Open on the question', stage: 'video' }).success).toBe(false);
  });

  it('accepts the example lesson\'s plan, and plans of clips at every depth', () => {
    expect(checkPlan(structuredClone(CLIP_PLAN), evidenceDraft()).errors).toEqual([]);
    expect(check('wecr', 'quick', 1).errors).toEqual([]);
    expect(check('wfcecr').errors).toEqual([]);
    expect(check('wfcedctqcr', 'deep', 3).errors).toEqual([]);
  });

  it('gives a budget per beat for every clip', () => {
    expect(check('wfcecr').budgets).toEqual({ s1: { warn: 16, max: 22, per: 'beat' }, s2: { warn: 16, max: 22, per: 'beat' }, s3: null, s4: { warn: 16, max: 22, per: 'beat' }, s5: null, s6: null });
  });

  it('a clip needs its stage kind', () => {
    const out = changedPlan((p) => delete p.outline[1].stage);
    expect(out.errors.map((e) => [e.code, e.path])).toEqual([['PLAN_CLIP_STAGE', 'outline[1]']]);
    expect(out.errors[0]!.message).toBe('The clip "c2" names no stage kind.');
    expect(out.errors[0]!.fix).toBe('Add "stage" with the kind of stage the clip plays on: sequence, cells, dots, chart, flow, words, lines, timeline, frame.');
    expectActionable(out.errors);
  });

  it('a stage kind that does not exist is a bad value, with the nearest one', () => {
    const out = changedPlan((p) => (p.outline[1].stage = 'flowchart'));
    expect(out.errors.map((e) => [e.code, e.path])).toEqual([['BAD_VALUE', 'outline[1].stage']]);
    expect(out.errors[0]!.fix).toBe('Use "flow". Allowed values: "sequence", "cells", "dots", "chart", "flow", "words", "lines", "timeline", "frame".');
  });

  it('`stage` belongs to a clip only, and a clip takes no figure, question or objective', () => {
    const onCheckpoint = changedPlan((p) => (p.outline[3].stage = 'cells'));
    expect(onCheckpoint.errors.map((e) => [e.code, e.path])).toEqual([['PLAN_FIELD_NOT_ALLOWED', 'outline[3].stage']]);
    expect(onCheckpoint.errors[0]!.message).toBe('The checkpoint scene "q1" plans a stage; only a clip has one.');
    const onRecap = changedPlan((p) => (p.outline[9].stage = 'words'));
    expect(onRecap.errors.map((e) => [e.code, e.path])).toEqual([['PLAN_FIELD_NOT_ALLOWED', 'outline[9].stage']]);
    const legacy = checkPlan({ ...planOf('nscscr'), outline: planOf('nscscr').outline.map((e, i) => (i === 0 ? { ...e, stage: 'words' as const } : e)) }, draftAt('standard'));
    expect(legacy.errors.map((e) => [e.code, e.path])).toEqual([['PLAN_FIELD_NOT_ALLOWED', 'outline[0].stage']]);

    const figure = changedPlan((p) => (p.outline[1].figure = 'flow'));
    expect(figure.errors.map((e) => [e.code, e.path])).toEqual([['PLAN_FIELD_NOT_ALLOWED', 'outline[1].figure']]);
    expect(figure.errors[0]!.fix).toBe('Remove "figure" from this entry: "stage" already says what the clip shows.');
    const both = changedPlan((p) => Object.assign(p.outline[1], { question: 'single', objective: 'o1' }));
    expect(both.errors.map((e) => [e.code, e.path])).toEqual([['PLAN_FIELD_NOT_ALLOWED', 'outline[1].question'], ['PLAN_FIELD_NOT_ALLOWED', 'outline[1].objective']]);
    const figureOnly = changedPlan((p) => { p.outline[1].figure = 'flow'; delete p.outline[1].stage; });
    expect(figureOnly.errors.map((e) => e.code)).toEqual(['PLAN_CLIP_STAGE', 'PLAN_FIELD_NOT_ALLOWED']);
  });

  it('the first scene is a clip (or, in a lesson of the older kinds, a narration)', () => {
    expect(check('wfcecr').errors).toEqual([]);
    expect(check('nscscr').errors).toEqual([]);
    const out = check('cwfecr');
    expect(out.errors.map((e) => [e.code, e.path])).toEqual([['PLAN_FIRST_SCENE', 'outline[0].kind']]);
    expect(out.errors[0]).toMatchObject({ got: 'checkpoint', expected: 'clip' });
    expect(out.errors[0]!.fix).toContain('Put a clip first');
  });

  it('a clip is the lesson\'s figure', () => {
    for (const depth of ['standard', 'deep'] as const) expect(DEPTHS[depth].requireFigure).toBe(true);
    expect(errorCodes(check('ncncnr'))).toEqual(['PLAN_NO_FIGURE']);
    expect(check('wcncnr').errors).toEqual([]);
    expect(check('ncwcnr').errors).toEqual([]);
  });

  it('a clip counts as something to do when planning; three narrations and a recap in a row still do not', () => {
    expect(L.passiveRun).toBe(3);
    // Five clips in a row: each can carry a prediction, and the finished lesson is held to it.
    expect(check('wfedtccr').errors).toEqual([]);
    expect(errorCodes(check('wccnnnr'))).toEqual(['PLAN_PASSIVE_RUN']);
    expect(check('wccnnnr').errors[0]!.message).toBe('Scenes s4, s5, s6, s7 come in a row with no checkpoint, no clip and no step_through (4; at most 3 are allowed).');
    expect(check('wccnnnr').errors[0]!.fix).toBe('Put a checkpoint or a clip among them, no later than position 7 of the outline.');
    expect(check('wccnnwr').errors).toEqual([]);
  });

  it('every objective needs its checkpoint, whatever the teaching scenes are', () => {
    expect(errorCodes(check('wfcedr'))).toEqual(['PLAN_OBJECTIVE_UNASSESSED']);
    expect(errorCodes(check('wfxexr'))).toEqual(['PLAN_GRADED_SHARE']);
  });

  it('at most two clips may be custom frames', () => {
    expect(L.framesPerLesson).toBe(2);
    expect(check('wFcFcr').errors).toEqual([]);
    const out = check('wFcFcFcr');
    expect(out.errors.map((e) => [e.code, e.path])).toEqual([['PLAN_TOO_MANY_FRAMES', 'outline[5].stage']]);
    expect(out.errors[0]).toMatchObject({ got: '3', expected: 'at most 2' });
    expect(out.errors[0]!.message).toBe('3 clips have a custom frame for a stage (s2, s4, s6); a lesson may have at most 2.');
    expect(out.errors[0]!.fix).toMatch(/^Give 1 of them a typed stage \(sequence, cells, dots, chart, flow, words, lines or timeline\)/);
    expectActionable(out.errors);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(check('wFcFcFcr'))).toBe(JSON.stringify(check('wFcFcFcr')));
  });
});

describe('a chart is one of three, and the plan may say which', () => {
  const withMark = (change: (p: PlanInput) => void): ReturnType<typeof checkPlan> => {
    const plan = planOf('whchecr');
    change(plan);
    return checkPlan(plan, draftAt('standard'));
  };

  it('the marks are the three a chart stage can have, held equal to core/clip', () => {
    expect([...PLAN_CHART_MARKS]).toEqual(['bars', 'line', 'curve']);
    // The options of the chart stage's own union, read from the schema.
    const marks = (ChartStage as unknown as { options: { shape: { mark: { value: string } } }[] }).options.map((option) => option.shape.mark.value);
    expect(marks).toEqual([...PLAN_CHART_MARKS]);
    expect(Object.keys(VERBS_BY_STAGE).filter((key) => key.startsWith('chart.')).map((key) => key.slice(6))).toEqual([...PLAN_CHART_MARKS]);
  });

  it.each(PLAN_CHART_MARKS.map((mark) => [mark] as const))('a clip on a chart stage may name the mark "%s": the plan is accepted, and the template is that chart', (mark) => {
    const out = withMark((p) => (p.outline[1]!.mark = mark));
    expect(out.errors).toEqual([]);
    expect(out.plan!.outline[1]).toMatchObject({ kind: 'clip', stage: 'chart', mark });
    expect(templateFor(out.plan!.outline[1]!).stage).toMatchObject({ kind: 'chart', mark });
  });

  it('without a mark the plan is as it was, and the template is bars', () => {
    const out = withMark(() => undefined);
    expect(out.errors).toEqual([]);
    expect(out.plan!.outline[1]!.mark).toBeUndefined();
    expect(templateFor(out.plan!.outline[1]!).stage).toMatchObject({ kind: 'chart', mark: 'bars' });
  });

  it('a mark that is not one of the three is a bad value, with the nearest', () => {
    const out = withMark((p) => ((p.outline[1] as { mark?: string }).mark = 'curves'));
    expect(out.errors.map((e) => `${e.code} ${e.path}`)).toEqual(['BAD_VALUE outline[1].mark']);
    expect(out.errors[0]!.fix).toBe('Use "curve". Allowed values: "bars", "line", "curve".');
  });

  it('`mark` belongs to a clip on a chart stage only', () => {
    const onFlow = withMark((p) => (p.outline[4]!.mark = 'curve'));
    expect(onFlow.errors.map((e) => `${e.code} ${e.path}`)).toEqual(['PLAN_FIELD_NOT_ALLOWED outline[4].mark']);
    expect(onFlow.errors[0]!.message).toBe('The clip "s5" plans a mark, but its stage is "cells"; only a chart has one.');
    expect(onFlow.errors[0]!.fix).toBe('Remove "mark" from this entry, or set "stage" to "chart": "mark" says which chart (bars, line or curve) the template shows.');
    const onCheckpoint = withMark((p) => (p.outline[2]!.mark = 'bars'));
    expect(onCheckpoint.errors.map((e) => `${e.code} ${e.path}`)).toEqual(['PLAN_FIELD_NOT_ALLOWED outline[2].mark']);
    expect(onCheckpoint.errors[0]!.message).toBe('The checkpoint scene "s3" plans a mark; only a clip on a chart stage has one.');
    expectActionable([...onFlow.errors, ...onCheckpoint.errors]);
  });

  it('the mark chooses a template and promises nothing: a clip of another mark still fits the plan', () => {
    // Planned as a curve chart, written as bars: the stage kind is what the plan holds a clip to.
    const draft = evidenceDraft();
    const outline = [...CLIP_PLAN.outline.map((entry) => (entry.id === 'c4' ? { ...entry, mark: 'curve' as const } : entry))];
    const planned = checkPlan({ ...CLIP_PLAN, outline }, draft);
    expect(planned.errors).toEqual([]);
    Object.assign(draft, { title: planned.plan!.title, objectives: planned.plan!.objectives, outline: planned.plan!.outline });
    expect((clipScene('c4').stage as { mark: string }).mark).toBe('line');
    expect(submit(draft, clipScene('c4')).errors).toEqual([]);
  });
});

describe('a new plan and the scenes already accepted', () => {
  it('keeps a clip whose stage kind is still planned, and orphans one whose kind changed', () => {
    const draft = clipDraft();
    const same = checkPlan(structuredClone(CLIP_PLAN), draft);
    expect(same.orphans).toEqual([]);
    const changed = structuredClone(CLIP_PLAN);
    changed.outline[1] = { ...changed.outline[1]!, stage: 'sequence' };
    expect(checkPlan(changed, draft).orphans).toEqual(['c2']);
    const dropped = structuredClone(CLIP_PLAN);
    dropped.outline.splice(4, 1);
    expect(checkPlan(dropped, draft).orphans).toEqual(['c4']);
  });

  it('a scene accepted for one plan is refused for a stage it no longer fits', () => {
    const draft = clipDraft();
    draft.outline = draft.outline.map((e) => (e.id === 'c2' ? { ...e, stage: 'sequence' as const } : e));
    const again = submit(draft, clipScene('c2'));
    expect(errorCodes(again)).toEqual(['SCENE_SHAPE_MISMATCH']);
  });
});
