// The contract files must agree with each other before anything is built on them.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_EVIDENCE, EXAMPLE_FIGURES, EXAMPLE_PLAN, EXAMPLE_QUESTIONS, EXAMPLE_SCENES, EXAMPLE_START } from '../../src/core/examples';
import { DEPTHS } from '../../src/core/limits';
import { ANY_SCENE_KINDS, AnyScene, ChartStage, ClipScene, Explore, Gate, LessonV2, PickGate, STAGE_KINDS } from '../../src/core/clip';
import { EXAMPLE_CLIPS, EXAMPLE_V2_SCENES } from '../../src/core/clip-examples';
import { EvidenceInput, Figure, FIGURE_TYPES, OutlineEntry, PLAN_CHART_MARKS, PLAN_SCENE_KINDS, PLAN_STAGE_KINDS, PlanInput, Question, QUESTION_TYPES, Scene, SCENE_KINDS, StartInput } from '../../src/core/schema';
import { templateFor } from '../../src/core/templates';
import type { Draft, LessonReport, Published, SceneCheck, SceneMetrics } from '../../src/core/types';

const problems = (r: { success: boolean; error?: { issues: unknown[] } }) => (r.success ? [] : r.error!.issues);

describe('example lesson parses under the schema', () => {
  it('start input', () => expect(problems(StartInput.safeParse(EXAMPLE_START))).toEqual([]));
  it('plan', () => expect(problems(PlanInput.safeParse(EXAMPLE_PLAN))).toEqual([]));
  it.each(EXAMPLE_EVIDENCE.map((e, i) => [i + 1, e] as const))('evidence e%i', (_i, e) => expect(problems(EvidenceInput.safeParse(e))).toEqual([]));
  it.each(EXAMPLE_SCENES.map((s) => [s.id, s] as const))('scene %s', (_id, s) => expect(problems(Scene.safeParse(s))).toEqual([]));
  it.each(FIGURE_TYPES.map((t) => [t] as const))('figure %s', (t) => expect(problems(Figure.safeParse(EXAMPLE_FIGURES[t]))).toEqual([]));
  it.each(QUESTION_TYPES.map((t) => [t] as const))('question %s', (t) => expect(problems(Question.safeParse(EXAMPLE_QUESTIONS[t]))).toEqual([]));

  it('scenes match the plan, in order', () => {
    expect(EXAMPLE_SCENES.map((s) => [s.id, s.kind])).toEqual(EXAMPLE_PLAN.outline.map((o) => [o.id, o.kind]));
  });
  it('fits the standard depth profile', () => {
    const d = DEPTHS.standard;
    expect(EXAMPLE_SCENES.length).toBeGreaterThanOrEqual(d.scenes.min);
    expect(EXAMPLE_SCENES.length).toBeLessThanOrEqual(d.scenes.max);
    expect(EXAMPLE_EVIDENCE.length).toBeGreaterThanOrEqual(d.evidenceMin);
  });
});

describe('every template parses under the schema', () => {
  const combos: Array<Parameters<typeof templateFor>[0]> = [
    { id: 't1', kind: 'narration' },
    ...FIGURE_TYPES.map((figure) => ({ id: 't1', kind: 'narration' as const, figure })),
    ...FIGURE_TYPES.map((figure) => ({ id: 't1', kind: 'step_through' as const, figure })),
    ...QUESTION_TYPES.map((question) => ({ id: 't1', kind: 'checkpoint' as const, question, objective: 'o1' })),
    { id: 't1', kind: 'recap' },
  ];
  it.each(combos.map((c) => [`${c.kind}/${c.figure ?? c.question ?? '-'}`, c] as const))('%s', (_name, c) => {
    expect(problems(Scene.safeParse(templateFor(c)))).toEqual([]);
  });
  it('covers every scene kind', () => expect(new Set(combos.map((c) => c.kind))).toEqual(new Set(SCENE_KINDS)));
});

describe('clips in the contract files', () => {
  it('the plan names the kinds and the stage kinds that core/clip has', () => {
    // schema.ts cannot import core/clip (which imports it), so the two lists are written twice and held equal here.
    expect([...PLAN_SCENE_KINDS]).toEqual([...SCENE_KINDS, 'clip']);
    expect([...PLAN_SCENE_KINDS].sort()).toEqual([...ANY_SCENE_KINDS].sort());
    expect([...PLAN_STAGE_KINDS]).toEqual([...STAGE_KINDS]);
    // The kinds of the older format are what they were.
    expect([...SCENE_KINDS]).toEqual(['narration', 'step_through', 'checkpoint', 'recap']);
  });

  it('an outline entry carries a clip with its stage kind', () => {
    expect(problems(OutlineEntry.safeParse({ id: 'c1', kind: 'clip', purpose: 'Open on the question', stage: 'words' }))).toEqual([]);
    expect(OutlineEntry.safeParse({ id: 'c1', kind: 'clip', purpose: 'Open on the question', stage: 'movie' }).success).toBe(false);
    expect(OutlineEntry.safeParse({ id: 'c1', kind: 'film', purpose: 'Open on the question' }).success).toBe(false);
    const plan = { title: 'A lesson of clips', objectives: [{ id: 'o1', text: 'Explain how the search halves the list' }], outline: [{ id: 'c1', kind: 'clip', purpose: 'Open', stage: 'words' }, { id: 'end', kind: 'recap', purpose: 'Close' }] };
    expect(problems(PlanInput.safeParse(plan))).toEqual([]);
  });

  it.each(PLAN_STAGE_KINDS.map((stage) => [stage] as const))('the %s clip template parses under the schema', (stage) => {
    const template = templateFor({ id: 't1', kind: 'clip', stage });
    expect(problems(ClipScene.safeParse(template))).toEqual([]);
    expect(problems(AnyScene.safeParse(template))).toEqual([]);
    expect((template.stage as { kind: string }).kind).toBe(stage);
  });

  it('a chart entry may name its mark, and each of the three charts has a template that parses', () => {
    // schema.ts cannot import core/clip, so the marks are written twice and held equal here.
    const marks = (ChartStage as unknown as { options: { shape: { mark: { value: string } } }[] }).options.map((option) => option.shape.mark.value);
    expect([...PLAN_CHART_MARKS]).toEqual(marks);
    for (const mark of PLAN_CHART_MARKS) {
      expect(problems(OutlineEntry.safeParse({ id: 'c1', kind: 'clip', purpose: 'Show how the cost grows', stage: 'chart', mark }))).toEqual([]);
      const template = templateFor({ id: 't1', kind: 'clip', stage: 'chart', mark });
      expect(problems(ClipScene.safeParse(template)), mark).toEqual([]);
      expect((template.stage as { mark: string }).mark).toBe(mark);
    }
    expect(OutlineEntry.safeParse({ id: 'c1', kind: 'clip', purpose: 'Show how the cost grows', stage: 'chart', mark: 'pie' }).success).toBe(false);
  });

  it('the templates that hand the picture over parse with their explore, and the cells template with its tap gate', () => {
    for (const entry of [{ stage: 'dots' as const }, { stage: 'chart' as const }, { stage: 'chart' as const, mark: 'curve' as const }]) {
      const template = templateFor({ id: 't1', kind: 'clip', ...entry });
      expect(problems(Explore.safeParse(template.explore)), JSON.stringify(entry)).toEqual([]);
    }
    const cells = templateFor({ id: 't1', kind: 'clip', stage: 'cells' }) as { beats: { gate?: unknown }[] };
    expect(problems(PickGate.safeParse(cells.beats[1]!.gate))).toEqual([]);
    // A gate is one of the two shapes: the others keep theirs.
    const flow = templateFor({ id: 't1', kind: 'clip', stage: 'flow' }) as { beats: { gate?: unknown }[] };
    expect(problems(Gate.safeParse(flow.beats[1]!.gate))).toEqual([]);
    expect(PickGate.safeParse(flow.beats[1]!.gate).success).toBe(false);
  });

  it('the clip examples parse, and a lesson may hold them', () => {
    for (const scene of EXAMPLE_V2_SCENES) expect(problems(AnyScene.safeParse(scene)), scene.id).toEqual([]);
    for (const kind of STAGE_KINDS) expect(problems(ClipScene.safeParse(EXAMPLE_CLIPS[kind])), kind).toEqual([]);
  });

  it('the shared types carry clips: a draft, a checked scene, a report and a published lesson', async () => {
    const { exampleLessonV2 } = await import('../helpers/clip-example');
    const lesson: LessonV2 = exampleLessonV2();
    const clip = lesson.scenes.find((s) => s.kind === 'clip')!;
    // These assignments are the test: they are checked when this file is type-checked.
    const draft: Pick<Draft, 'scenes'> = { scenes: lesson.scenes };
    const check: Pick<SceneCheck, 'scene'> = { scene: clip };
    const report: Pick<LessonReport, 'lesson'> = { lesson };
    const published: Pick<Published, 'lesson'> = { lesson };
    const metrics: SceneMetrics = { sceneId: clip.id, words: 30, budget: { warn: 16, max: 22, per: 'beat' }, steps: [10, 10, 10], citedBlocks: 1, uncitedBlocks: 2 };
    expect([draft.scenes.length, check.scene?.kind, report.lesson?.scenes.length, published.lesson.scenes.length, metrics.budget?.per]).toEqual([10, 'clip', 10, 10, 'beat']);
  });
});

describe('strictness', () => {
  it('rejects an unknown key instead of dropping it', () => {
    const r = Scene.safeParse({ id: 's1', kind: 'narration', title: 'T', blocks: [{ type: 'claim', text: 'A fact.', cite: ['e1'] }] });
    expect(r.success).toBe(false);
  });
});

describe('test helpers', () => {
  it('assemble the example lesson', async () => {
    const { exampleLesson, exampleDraft } = await import('../helpers/example');
    expect(exampleLesson().scenes).toHaveLength(9);
    expect(exampleDraft().evidence.map((e) => e.host)).toContain('example.org');
  });
});
