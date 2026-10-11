// Review finding A7. A highlight that is not id-shaped (the number 2, "4", "L2" for a line of code)
// is stopped by the schema, which answered with general advice about ids and a scene id as its
// example. It now says what a highlight is, lists the parts of this figure and offers the one meant.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_FIGURES } from '../../src/core/examples';
import { checkPlan, checkScene } from '../../src/core/validate';
import { errorCodes, exampleDraft, exampleScene } from './helpers';

function lines(edit: (s: any) => void): ReturnType<typeof checkScene> {
  const s = exampleScene('s3');
  edit(s);
  return checkScene(s, exampleDraft());
}

describe('a highlight that does not have the form of an id', () => {
  it.each<[what: string, value: unknown, code: string, guess: string]>([
    ['the number of the line', 2, 'WRONG_TYPE', 'l2'],
    ['the number as text', '4', 'BAD_ID', 'l4'],
    ['a capital L', 'L2', 'BAD_ID', 'l2'],
    ['"Line 11"', 'Line 11', 'BAD_ID', 'l11'],
    ['a leading zero', '03', 'BAD_ID', 'l3'],
  ])('%s: the fix names the line that was meant and the parts the figure has', (_what, value, code, guess) => {
    const check = lines((s) => (s.steps[0].highlight = [value]));
    expect(errorCodes(check)).toEqual([code]);
    const e = check.errors[0]!;
    expect(e.path).toBe('steps[0].highlight[0]');
    expect(e.message).toContain('Step 1 highlights');
    expect(e.message).toContain('lines figure');
    expect(e.fix).toContain(`Use "${guess}".`);
    expect(e.fix).toContain('l1 to l11 (one per line)');
    // The general advice named a scene id; a highlight is never one.
    expect(e.fix).not.toContain('"s1"');
    expect(e.expected).toBe('the id of a part of the figure');
  });

  it('a line the figure does not have gets the list, and no guess', () => {
    const check = lines((s) => (s.steps[0].highlight = ['99']));
    expect(errorCodes(check)).toEqual(['BAD_ID']);
    expect(check.errors[0]!.fix).not.toContain('Use "');
    expect(check.errors[0]!.fix).toContain('l1 to l11 (one per line)');
  });

  it('the other highlights that name no part are listed in the same answer, so one correction is enough', () => {
    const check = lines((s) => ((s.steps[0].highlight = ['line2']), (s.steps[1].highlight = ['4', 'l3']), (s.steps[2].highlight = ['row9'])));
    expect(check.errors.map((e) => [e.code, e.path])).toEqual([['BAD_ID', 'steps[1].highlight[0]']]);
    expect(check.errors[0]!.fix).toContain('Use "l4".');
    expect(check.errors[0]!.fix).toContain('Also not a part of this figure: "line2" (step 1), "row9" (step 3).');
    // Corrected as told, the scene is accepted.
    expect(lines((s) => ((s.steps[0].highlight = ['l2']), (s.steps[1].highlight = ['l4', 'l3']), (s.steps[2].highlight = ['l9']))).errors).toEqual([]);
  });

  it('in another figure the parts are named by their own ids, and a near miss is matched', () => {
    const draft = exampleDraft();
    const plan = { title: draft.title, objectives: draft.objectives, outline: draft.outline.map((e) => (e.id === 's3' ? { ...e, figure: 'flow' } : e)) };
    const check = checkPlan(plan, draft);
    expect(check.ok).toBe(true);
    draft.outline = check.plan!.outline;
    const s = exampleScene('s3');
    s.figure = structuredClone(EXAMPLE_FIGURES.flow);
    const ids: string[] = [...s.figure.nodes.map((n: any) => n.id), ...s.figure.edges.map((e: any) => e.id)];
    s.steps.forEach((step: any) => (step.highlight = [ids[0]]));
    s.steps[0].highlight = [`${ids[1]!.charAt(0).toUpperCase()}${ids[1]!.slice(1)}`];
    const result = checkScene(s, draft);
    const e = result.errors.find((x) => x.path === 'steps[0].highlight[0]')!;
    expect(e.code).toBe('BAD_ID');
    expect(e.message).toContain('flow figure');
    expect(e.fix).toContain(`Use "${ids[1]}".`);
    expect(e.fix).toContain(ids.join(', '));
  });

  it('when the figure itself cannot be read, the fix still says what a highlight is', () => {
    const check = lines((s) => ((s.figure = 'see above'), (s.steps[0].highlight = [2])));
    const e = check.errors.find((x) => x.path === 'steps[0].highlight[0]')!;
    expect(e.code).toBe('WRONG_TYPE');
    expect(e.fix).toContain('"l1", "l2", ... for the lines of a lines figure');
  });
});

describe('every other id keeps the advice it had', () => {
  it('a scene id in the wrong form is still told what a scene id looks like', () => {
    const s = exampleScene('s3');
    s.id = 'Scene 3';
    const check = checkScene(s, exampleDraft());
    expect(check.errors.some((e) => e.path === 'steps[0].highlight[0]')).toBe(false);
    expect(check.errors.map((e) => e.code)).toContain('SCENE_NOT_PLANNED');
  });

  it('a part id of the figure in the wrong form is not treated as a highlight', () => {
    const s = exampleScene('s2');
    s.figure.nodes[0].id = 'Start Node';
    const check = checkScene(s, exampleDraft());
    const e = check.errors.find((x) => x.path === 'figure.nodes[0].id')!;
    expect(e.code).toBe('BAD_ID');
    expect(e.message).toContain('is not a valid id');
  });

  it('a highlight that is id-shaped but unknown is still STEP_HIGHLIGHT_UNKNOWN', () => {
    const check = lines((s) => (s.steps[0].highlight = ['line2']));
    expect(errorCodes(check)).toEqual(['STEP_HIGHLIGHT_UNKNOWN']);
    expect(check.errors[0]!.fix).toContain('Use "l2".');
  });
});
