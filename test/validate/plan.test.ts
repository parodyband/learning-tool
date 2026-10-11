// checkPlan: the outline rules in both directions, the budgets it returns, and which accepted
// scenes a new plan orphans.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_PLAN } from '../../src/core/examples';
import { DEPTHS, LIMITS as L, type Depth } from '../../src/core/limits';
import type { OutlineEntry, PlanInput, SceneKind } from '../../src/core/schema';
import type { Draft } from '../../src/core/types';
import { budgetFor, checkPlan } from '../../src/core/validate';
import { codes, errorCodes, exampleDraft, expectActionable, newDraft, saveEvidence } from './helpers';
import { buildEvidence } from './build';

/** An outline from a string of kinds: n narration, f narration with a figure, s step_through, c checkpoint, x reflect checkpoint, r recap. */
function outlineOf(pattern: string, objectives = 2): OutlineEntry[] {
  let checkpoint = 0;
  return [...pattern].map((ch, i) => {
    const id = `s${i + 1}`;
    const purpose = 'What this scene is for';
    switch (ch) {
      case 'n':
        return { id, kind: 'narration' as SceneKind, purpose };
      case 'f':
        return { id, kind: 'narration' as SceneKind, purpose, figure: 'flow' as const };
      case 's':
        return { id, kind: 'step_through' as SceneKind, purpose, figure: 'lines' as const };
      case 'c':
      case 'x':
        return { id, kind: 'checkpoint' as SceneKind, purpose, question: ch === 'x' ? ('reflect' as const) : ('single' as const), objective: `o${(checkpoint++ % objectives) + 1}` };
      default:
        return { id, kind: 'recap' as SceneKind, purpose };
    }
  });
}

function planOf(pattern: string, objectives = 2): PlanInput {
  return {
    title: 'A lesson about searching',
    objectives: Array.from({ length: objectives }, (_, i) => ({ id: `o${i + 1}`, text: `Explain part ${'abcdefghi'[i]} of the search` })),
    outline: outlineOf(pattern, objectives),
  };
}

function draftAt(depth: Depth): Draft {
  const draft = newDraft({ topic: 'Searching', depth, learner: { level: 'new', knows: 'Nothing yet', goal: 'Explain it' } });
  saveEvidence(draft, buildEvidence(0));
  return draft;
}

const check = (pattern: string, depth: Depth = 'standard', objectives = 2) => checkPlan(planOf(pattern, objectives), draftAt(depth));

describe('outlines that are accepted', () => {
  it.each([
    ['quick', 'nccr', 1],
    ['quick', 'ncnr', 1],
    ['quick', 'nscr', 1],
    ['quick', 'nncnnr', 1],
    ['quick', 'nscncr', 2],
    ['standard', 'fcncnr', 2],
    ['standard', 'nscncr', 2],
    ['standard', 'nnsnncnncr', 2],
    ['standard', 'nscnscnccr', 4],
    ['standard', 'fxcnxcr', 2],
    ['deep', 'nscnscnscr', 3],
    ['deep', 'nnsnncnnsnncnccr', 3],
    ['deep', 'nscnscnscnscnscr', 5],
  ] as Array<[Depth, string, number]>)('%s: %s with %i objectives', (depth, pattern, objectives) => {
    const result = check(pattern, depth, objectives);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(Object.keys(result.budgets!)).toEqual(outlineOf(pattern).map((e) => e.id));
    expect(result.orphans).toEqual([]);
  });

  it('gives each scene the budget it will be held to', () => {
    const result = check('nfscr');
    expect(result.errors.map((e) => e.code)).toEqual(['PLAN_SCENE_COUNT', 'PLAN_OBJECTIVE_UNASSESSED']);
    const ok = check('nfscncr');
    expect(ok.budgets).toEqual({
      s1: { ...L.narrationWords, per: 'scene' },
      s2: { ...L.narrationWithFigureWords, per: 'scene' },
      s3: { ...L.stepWords, per: 'step' },
      s4: null,
      s5: { ...L.narrationWords, per: 'scene' },
      s6: null,
      s7: null,
    });
    expect(budgetFor({ kind: 'narration' })).toEqual({ warn: 90, max: 150, per: 'scene' });
    expect(budgetFor({ kind: 'narration', figure: 'chart' })).toEqual({ warn: 60, max: 120, per: 'scene' });
    expect(budgetFor({ kind: 'step_through', figure: 'lines' })).toEqual({ warn: 45, max: 70, per: 'step' });
    expect(budgetFor({ kind: 'checkpoint' })).toBeNull();
    expect(budgetFor({ kind: 'recap' })).toBeNull();
    // A returned budget is a copy: changing it does not change the limits.
    ok.budgets!.s1!.max = 1;
    expect(L.narrationWords.max).toBe(150);
  });

  it('returns the plan in normal form', () => {
    const plan = planOf('fcncnr');
    const result = checkPlan({ ...plan, title: `  ${plan.title}\u200b ` }, draftAt('standard'));
    expect(result.plan).toEqual(plan);
  });
});

describe('scene and objective counts follow the depth', () => {
  it.each(['quick', 'standard', 'deep'] as Depth[])('%s', (depth) => {
    const profile = DEPTHS[depth];
    // n scenes: narration, step-through and checkpoint in turn, a checkpoint before the recap.
    const pattern = (n: number) => `${'nsc'.repeat(6).slice(0, n - 2)}cr`;
    const scenes = (n: number) => checkPlan(planOf(pattern(n), profile.objectives.min), draftAt(depth));
    expect(errorCodes(scenes(profile.scenes.min))).not.toContain('PLAN_SCENE_COUNT');
    expect(errorCodes(scenes(profile.scenes.max))).not.toContain('PLAN_SCENE_COUNT');
    const few = scenes(profile.scenes.min - 1);
    expect(errorCodes(few)).toContain('PLAN_SCENE_COUNT');
    expect(few.errors.find((e) => e.code === 'PLAN_SCENE_COUNT')).toMatchObject({ got: String(profile.scenes.min - 1), expected: `${profile.scenes.min} to ${profile.scenes.max}` });
    const many = scenes(profile.scenes.max + 1);
    expect(errorCodes(many)).toContain('PLAN_SCENE_COUNT');
    expect(many.errors.find((e) => e.code === 'PLAN_SCENE_COUNT')!.fix).toContain(`Merge or remove 1 scene`);

    // m objectives, each with its own checkpoint, in an outline long enough for the depth.
    const objectives = (m: number) => checkPlan(planOf(`n${'c'.repeat(Math.max(m, profile.scenes.min - 2))}r`, m), draftAt(depth));
    const tooMany = objectives(profile.objectives.max + 1);
    expect(errorCodes(tooMany)).toContain('PLAN_OBJECTIVE_COUNT');
    expect(tooMany.errors.find((e) => e.code === 'PLAN_OBJECTIVE_COUNT')).toMatchObject({ got: String(profile.objectives.max + 1), expected: `${profile.objectives.min} to ${profile.objectives.max}` });
    expect(errorCodes(objectives(profile.objectives.max))).not.toContain('PLAN_OBJECTIVE_COUNT');
    expect(errorCodes(objectives(profile.objectives.min))).not.toContain('PLAN_OBJECTIVE_COUNT');
  });
});

describe('structure rules, at their thresholds', () => {
  it('two narrations in a row are fine, three are not', () => {
    expect(L.narrationRun).toBe(2);
    expect(check('fncnncr').errors).toEqual([]);
    const three = check('fnncncr');
    expect(errorCodes(three)).toEqual(['PLAN_NARRATION_RUN']);
    expect(three.errors[0]).toMatchObject({ path: 'outline[2]', got: '3' });
    expect(three.errors[0]!.message).toContain('s1, s2, s3');
    expect(three.errors[0]!.fix).toContain('Make "s3" a step_through or a checkpoint');
  });

  it('three scenes with nothing to do are fine, four are not, and the recap counts', () => {
    expect(L.passiveRun).toBe(3);
    // Two narrations and the recap: three.
    expect(check('fcscnnr').errors).toEqual([]);
    // Three narrations and the recap: four, reported once as the wider problem.
    const four = check('fccnnnr');
    expect(errorCodes(four)).toEqual(['PLAN_PASSIVE_RUN']);
    expect(four.errors[0]!.message).toContain('s4, s5, s6, s7');
    // A step_through breaks the stretch at plan time.
    expect(check('fcnnsnncr').errors).toEqual([]);
  });

  it('two separate runs are two issues', () => {
    const result = checkPlan(planOf('nnncnnncfr'), draftAt('standard'));
    expect(errorCodes(result)).toEqual(['PLAN_NARRATION_RUN', 'PLAN_NARRATION_RUN']);
    expect(result.errors.map((e) => e.path)).toEqual(['outline[2]', 'outline[6]']);
  });

  it('at least half the checkpoints are graded', () => {
    expect(check('fxcnxcr').errors).toEqual([]);
    expect(check('fcfxcr').errors).toEqual([]);
    const result = check('fxxncr');
    expect(errorCodes(result)).toEqual(['PLAN_GRADED_SHARE']);
    expect(result.errors[0]).toMatchObject({ got: '1 of 3', expected: 'at least 2 of 3' });
    expect(check('fxncxr').errors.map((e) => e.code)).toEqual(['PLAN_GRADED_SHARE']);
    // One reflect and one graded is exactly half.
    expect(check('fxncnr').errors).toEqual([]);
  });

  it('a figure is required at standard and deep depth, on a narration or through a step-through', () => {
    expect(errorCodes(check('ncncnr'))).toEqual(['PLAN_NO_FIGURE']);
    expect(check('ncncnr').errors[0]!.fix).toContain('for example "s1"');
    expect(check('ncfcnr').errors).toEqual([]);
    expect(check('ncscnr').errors).toEqual([]);
    expect(check('nccr', 'quick', 1).errors).toEqual([]);
    expect(errorCodes(checkPlan(planOf('ncncncncnr', 3), draftAt('deep')))).toEqual(['PLAN_NO_FIGURE']);
  });

  it('every objective needs a checkpoint, and every checkpoint an objective of the plan', () => {
    const plan = planOf('fcncnr', 2);
    plan.outline[3]!.objective = 'o1';
    const unassessed = checkPlan(plan, draftAt('standard'));
    expect(errorCodes(unassessed)).toEqual(['PLAN_OBJECTIVE_UNASSESSED']);
    expect(unassessed.errors[0]).toMatchObject({ got: 'o2' });

    plan.outline[3]!.objective = 'o5';
    const unknown = checkPlan(plan, draftAt('standard'));
    expect(errorCodes(unknown)).toEqual(['PLAN_CHECKPOINT_FIELDS', 'PLAN_OBJECTIVE_UNASSESSED']);
    expect(unknown.errors[0]).toMatchObject({ path: 'outline[3].objective', got: 'o5', expected: 'one of o1, o2' });
  });

  it('a checkpoint needs both a question type and an objective', () => {
    const plan = planOf('fcncnr', 2);
    delete plan.outline[1]!.question;
    delete plan.outline[1]!.objective;
    plan.outline.splice(4, 0, { id: 'x1', kind: 'checkpoint', purpose: 'Another check', question: 'order', objective: 'o1' });
    const result = checkPlan(plan, draftAt('standard'));
    expect(errorCodes(result)).toEqual(['PLAN_CHECKPOINT_FIELDS']);
    expect(result.errors[0]!.message).toBe('The checkpoint "s2" has no question and no objective.');
    expect(result.errors[0]!.fix).toBe('Add "question" (single, order, numeric or reflect) and "objective" (one of o1, o2).');
  });

  it('fields that belong to another kind of scene are refused, each where it stands', () => {
    const plan = planOf('fcncnr', 2);
    plan.outline[0]!.objective = 'o1';
    plan.outline[1]!.figure = 'flow';
    plan.outline[5]!.figure = 'chart';
    plan.outline[5]!.question = 'reflect';
    const result = checkPlan(plan, draftAt('standard'));
    expect(result.errors.map((e) => [e.code, e.path])).toEqual([
      ['PLAN_FIELD_NOT_ALLOWED', 'outline[0].objective'],
      ['PLAN_FIELD_NOT_ALLOWED', 'outline[1].figure'],
      ['PLAN_FIELD_NOT_ALLOWED', 'outline[5].question'],
      ['PLAN_FIELD_NOT_ALLOWED', 'outline[5].figure'],
    ]);
    expectActionable(result.errors);
  });

  it('the first scene is a narration and the one recap is last', () => {
    expect(errorCodes(check('cfncnr'))).toEqual(['PLAN_FIRST_SCENE']);
    expect(errorCodes(check('fcncnc'))).toEqual(['PLAN_LAST_SCENE']);
    expect(check('fcncnc').errors[0]!.message).toBe('The outline has no recap scene.');
    const two = check('fcrcnr');
    expect(errorCodes(two)).toEqual(['PLAN_LAST_SCENE']);
    expect(two.errors[0]!.message).toContain('2 recap scenes');
    const early = check('fcrcnc');
    expect(errorCodes(early)).toEqual(['PLAN_LAST_SCENE']);
    expect(early.errors[0]!.message).toBe('The recap is outline[2], but 3 scenes come after it.');
  });

  it('objective ids run o1, o2, ... in order, without gaps or repeats', () => {
    const ids = (list: string[]) => {
      const plan = planOf('fcncnr', list.length);
      plan.objectives.forEach((o, i) => (o.id = list[i]!));
      plan.outline.filter((e) => e.objective).forEach((e, i) => (e.objective = list[i % list.length]!));
      return checkPlan(plan, draftAt('standard'));
    };
    expect(ids(['o1', 'o2']).errors).toEqual([]);
    expect(errorCodes(ids(['o2', 'o1']))).toEqual(['PLAN_OBJECTIVE_IDS']);
    expect(errorCodes(ids(['o1', 'o3']))).toEqual(['PLAN_OBJECTIVE_IDS']);
    expect(errorCodes(ids(['o2', 'o3']))).toEqual(['PLAN_OBJECTIVE_IDS']);
    expect(ids(['o1', 'o1']).errors.map((e) => e.code)).toContain('PLAN_OBJECTIVE_IDS');
    expect(ids(['o1', 'o3']).errors[0]).toMatchObject({ got: 'o1, o3', expected: 'o1, o2' });
  });

  it('scene ids must be distinct', () => {
    const plan = planOf('fcncnr');
    plan.outline[4]!.id = 's1';
    plan.outline[3]!.id = 's2';
    const result = checkPlan(plan, draftAt('standard'));
    expect(result.errors.map((e) => [e.code, e.path, e.got])).toEqual([
      ['PLAN_DUPLICATE_ID', 'outline[3].id', 's2'],
      ['PLAN_DUPLICATE_ID', 'outline[4].id', 's1'],
    ]);
  });
});

describe('the shape of a plan', () => {
  const draft = exampleDraft();
  const broken = (edit: (p: any) => void) => {
    const plan: any = structuredClone(EXAMPLE_PLAN);
    edit(plan);
    const result = checkPlan(plan, draft);
    expect(result.ok).toBe(false);
    expect(result.plan).toBeUndefined();
    expect(result.budgets).toBeUndefined();
    expectActionable(result.errors);
    return result.errors.map((e) => [e.code, e.path]);
  };

  it.each([
    ['objectives as plain sentences', (p: any) => (p.objectives = ['Trace binary search', 'Explain why it is fast']), [['WRONG_TYPE', 'objectives[0]'], ['WRONG_TYPE', 'objectives[1]']]],
    ['no title', (p: any) => delete p.title, [['MISSING_FIELD', 'title']]],
    ['an objective that is one word', (p: any) => (p.objectives[0].text = 'Search'), [['TOO_SHORT', 'objectives[0].text']]],
    ['"type" for "kind" in the outline', (p: any) => ((p.outline[0].type = 'narration'), delete p.outline[0].kind), [['UNKNOWN_FIELD', 'outline[0].type']]],
    ['an unknown kind', (p: any) => (p.outline[2].kind = 'walkthrough'), [['BAD_VALUE', 'outline[2].kind']]],
    ['an unknown figure type', (p: any) => (p.outline[1].figure = 'diagram'), [['BAD_VALUE', 'outline[1].figure']]],
    ['an unknown question type', (p: any) => (p.outline[3].question = 'multiple-choice'), [['BAD_VALUE', 'outline[3].question']]],
    ['an objective named by number', (p: any) => (p.outline[3].objective = 1), [['WRONG_TYPE', 'outline[3].objective']]],
    ['a scene id with a space', (p: any) => (p.outline[0].id = 'scene 1'), [['BAD_ID', 'outline[0].id']]],
    ['no purpose', (p: any) => delete p.outline[4].purpose, [['MISSING_FIELD', 'outline[4].purpose']]],
    ['"scenes" for "outline"', (p: any) => ((p.scenes = p.outline), delete p.outline), [['UNKNOWN_FIELD', 'scenes']]],
    ['the depth sent with the plan', (p: any) => (p.depth = 'deep'), [['UNKNOWN_FIELD', 'depth']]],
  ])('%s', (_what, edit, expected) => {
    expect(broken(edit)).toEqual(expected);
  });

  it('suggests the nearest kind, figure and question type', () => {
    const plan: any = structuredClone(EXAMPLE_PLAN);
    plan.outline[2].kind = 'step-through';
    plan.outline[1].figure = 'flowchart';
    plan.outline[3].question = 'singl';
    const result = checkPlan(plan, draft);
    expect(result.errors.map((e) => e.fix)).toEqual([
      'Use "flow". Allowed values: "flow", "sequence", "layers", "timeline", "compare", "chart", "lines".',
      'Use "step_through". Allowed values: "narration", "step_through", "checkpoint", "recap", "clip".',
      'Use "single". Allowed values: "single", "order", "numeric", "reflect".',
    ]);
  });
});

describe('planning before research, and planning again', () => {
  it('warns when no evidence is stored, and still accepts the plan', () => {
    const draft = newDraft();
    const result = checkPlan(EXAMPLE_PLAN, draft);
    expect(result.ok).toBe(true);
    expect(codes(result)).toEqual(['PLAN_BEFORE_RESEARCH']);
    expect(result.warnings[0]!.fix).toContain('save_evidence');
    // The warning is also given beside errors, so the agent hears both at once.
    const bad = checkPlan({ ...EXAMPLE_PLAN, outline: EXAMPLE_PLAN.outline.slice(0, 3) }, draft);
    expect(bad.ok).toBe(false);
    expect(bad.warnings.map((w) => w.code)).toEqual(['PLAN_BEFORE_RESEARCH']);
  });

  it('the same plan again orphans nothing', () => {
    expect(checkPlan(EXAMPLE_PLAN, exampleDraft()).orphans).toEqual([]);
  });

  it('accepted scenes that no longer fit the new plan are named as orphans', () => {
    const draft = exampleDraft();
    const plan: PlanInput = structuredClone(EXAMPLE_PLAN);
    plan.outline[1] = { ...plan.outline[1]!, figure: 'sequence' }; // s2: another figure type
    plan.outline[3] = { ...plan.outline[3]!, question: 'order' }; // s4: another question type
    plan.outline[5] = { ...plan.outline[5]!, objective: 'o1' }; // s6: another objective
    delete plan.outline[4]!.figure; // s5: its figure is no longer planned
    plan.outline[6] = { id: 's7', kind: 'step_through', purpose: 'Trace the failure', figure: 'lines' }; // s7: another kind
    plan.outline[7] = { ...plan.outline[7]!, id: 's8b', objective: 'o2' }; // s8: its id is gone
    const result = checkPlan(plan, draft);
    expect(result.errors).toEqual([]);
    expect(result.orphans).toEqual(['s2', 's4', 's5', 's6', 's7', 's8']);
  });

  it('a change of purpose, title or order alone orphans nothing', () => {
    const draft = exampleDraft();
    const plan: PlanInput = structuredClone(EXAMPLE_PLAN);
    plan.title = 'Binary search, start to finish';
    plan.outline.forEach((e) => (e.purpose = `${e.purpose}, revised`));
    [plan.outline[4], plan.outline[6]] = [plan.outline[6]!, plan.outline[4]!];
    const result = checkPlan(plan, draft);
    expect(result.errors).toEqual([]);
    expect(result.orphans).toEqual([]);
  });

  it('checking never changes the draft', () => {
    const draft = exampleDraft();
    const before = JSON.stringify(draft);
    checkPlan(planOf('fcncnr'), draft);
    expect(JSON.stringify(draft)).toBe(before);
  });
});
