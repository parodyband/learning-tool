// Review finding V12. An objective is printed in the lesson ("After this lesson you can ...") and
// carries no citation, so a number in it is held to the rule for all uncited text: some passage the
// lesson cites has to state it. That can only be judged when the lesson is whole, so plan_lesson
// says it early as a warning and checkLesson refuses the finished lesson.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_PLAN } from '../../src/core/examples';
import { ISSUES } from '../../src/core/issues';
import type { Draft } from '../../src/core/types';
import { checkLesson, checkPlan } from '../../src/core/validate';
import { applyPlan, codes, errorCodes, exampleDraft, exampleScene, expectActionable, saveEvidence, submit, warningCodes } from './helpers';

const DATED = 'Recall that John Mauchly first described binary search in 1946';

function withObjective(text: string, index = 0, prepare?: (draft: Draft) => void): { draft: Draft; plan: typeof EXAMPLE_PLAN } {
  const draft = exampleDraft();
  prepare?.(draft);
  const plan = structuredClone(EXAMPLE_PLAN);
  plan.objectives[index] = { ...plan.objectives[index]!, text };
  return { draft, plan };
}

describe('a number in an objective that no cited passage states', () => {
  it('plan_lesson accepts the plan and warns, so the agent hears of it before any scene is written', () => {
    const { draft, plan } = withObjective(DATED);
    const check = checkPlan(plan, draft);
    expect(check.ok).toBe(true);
    expect(check.errors).toEqual([]);
    expect(check.warnings.map((w) => [w.code, w.severity, w.path, w.got])).toEqual([['NUMBER_UNGROUNDED', 'warning', 'objectives[0].text', '1946']]);
    expect(check.warnings[0]!.message).toBe('The number 1946 in this objective (o1) is in no stored excerpt.');
    expect(check.warnings[0]!.fix).toContain('the finished lesson is refused unless a passage it cites states this one');
    expectActionable(check.warnings);
    // The catalog says the code has this second severity.
    expect((ISSUES.NUMBER_UNGROUNDED as { also?: string }).also).toContain('plan_lesson');
  });

  it('the finished lesson is refused, at the objective, with the way out', () => {
    const { draft, plan } = withObjective(DATED);
    applyPlan(draft, plan);
    const report = checkLesson(draft);
    expect(report.ok).toBe(false);
    expect(report.errors.map((e) => [e.code, e.severity, e.path, e.got, e.sceneId])).toEqual([['NUMBER_UNGROUNDED', 'error', 'objectives[0].text', '1946', undefined]]);
    expect(report.errors[0]!.message).toBe('The number 1946 in this objective (o1) is in no excerpt the lesson cites.');
    expect(report.errors[0]!.fix).toContain('Call plan_lesson again with the same outline and the objective reworded');
    expect(report.errors[0]!.fix).toContain('the accepted scenes are kept');
    expectActionable(report.errors);
  });

  it('planning again with the objective reworded keeps every scene and clears it', () => {
    const { draft, plan } = withObjective(DATED);
    applyPlan(draft, plan);
    expect(errorCodes(checkLesson(draft))).toEqual(['NUMBER_UNGROUNDED']);
    const again = checkPlan(EXAMPLE_PLAN, draft);
    expect(again).toMatchObject({ ok: true, orphans: [], warnings: [] });
    applyPlan(draft, EXAMPLE_PLAN);
    expect(draft.scenes).toHaveLength(9);
    expect(checkLesson(draft).ok).toBe(true);
  });

  it('while scenes are still missing, nothing is said yet: the passage may still be saved and cited', () => {
    const { draft, plan } = withObjective(DATED);
    applyPlan(draft, plan);
    draft.scenes = draft.scenes.filter((s) => s.id !== 's7');
    expect(errorCodes(checkLesson(draft))).toEqual(['LESSON_INCOMPLETE']);
  });

  it('a number in a stored passage that the lesson never cites is named, with where it is', () => {
    const history = { url: 'https://example.org/history', title: 'History (synthetic test source)', via: 'page', excerpt: 'The method was first described in 1946, though a correct version took much longer to appear.' };
    const { draft, plan } = withObjective(DATED, 0, (d) => saveEvidence(d, history));
    // Stored, so plan_lesson has nothing to warn about.
    expect(checkPlan(plan, draft).warnings).toEqual([]);
    applyPlan(draft, plan);
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['NUMBER_UNGROUNDED']);
    expect(report.errors[0]!.fix).toContain('1946 is in e6, which the lesson never cites');
    // Cited where it supports a statement, it grounds the objective.
    const s7 = exampleScene('s7');
    s7.blocks.push({ type: 'claim', text: 'The method was first described long before a correct version appeared.', cites: ['e6'] });
    expect(submit(draft, s7).errors).toEqual([]);
    expect(checkLesson(draft).errors).toEqual([]);
  });
});

describe('objectives an honest plan writes', () => {
  it.each([
    ['a number a cited passage states', 'Explain why a sorted list of 1,000,000 items needs at most 20 comparisons'],
    ['a single digit', 'Trace binary search on a list of 7 items in 3 comparisons'],
    ['an ordinal and a number in words', 'Say what the 2nd comparison of a million-item search rules out'],
    ['no number at all', 'Trace binary search on a sorted list, one comparison at a time'],
  ])('%s: no warning at plan time and no error at the end', (_what, text) => {
    const { draft, plan } = withObjective(text, 1);
    expect(codes(checkPlan(plan, draft))).toEqual([]);
    applyPlan(draft, plan);
    const report = checkLesson(draft);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('a number of the lesson\'s own title or topic needs no source', () => {
    const { draft, plan } = withObjective('Explain what makes HTTP/2 and the 80/20 rule worth knowing in 2026');
    plan.title = 'HTTP/2 and the 80/20 rule in 2026';
    expect(codes(checkPlan(plan, draft))).toEqual([]);
    applyPlan(draft, plan);
    expect(checkLesson(draft).errors).toEqual([]);
  });

  it('a plan made before any research is told about its numbers once, beside the research warning', () => {
    const { draft, plan } = withObjective('Estimate the comparisons for a list of 1,000 items', 1, (d) => (d.evidence = []));
    const check = checkPlan(plan, draft);
    expect(check.ok).toBe(true);
    expect(warningCodes(check)).toEqual(['PLAN_BEFORE_RESEARCH', 'NUMBER_UNGROUNDED']);
    expect(check.warnings[1]).toMatchObject({ path: 'objectives[1].text', got: '1000', severity: 'warning' });
  });

  it('a plan that is refused for another reason reports that reason alone', () => {
    const { draft, plan } = withObjective(DATED);
    plan.outline[0] = { id: 's1', kind: 'checkpoint', purpose: 'Open with a question', question: 'single', objective: 'o1' };
    const check = checkPlan(plan, draft);
    expect(check.ok).toBe(false);
    expect(check.warnings).toEqual([]);
  });
});
