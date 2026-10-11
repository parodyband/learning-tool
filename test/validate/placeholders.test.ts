// Review finding A1. A template's short placeholders ("Scene title", "Optional step title", "unit",
// "optional", "A follow-up topic") passed validation and were published, because only the long,
// sentence-like placeholders were known. They are now refused in the field the template has them in.
// Both directions: a leftover is refused, and a real lesson that happens to use the same words
// somewhere else, or one of the template's plausible values in its own place, is not.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_SCENES } from '../../src/core/examples';
import { FIGURE_TYPES, QUESTION_TYPES, Scene } from '../../src/core/schema';
import { templateFor } from '../../src/core/templates';
import { checkScene } from '../../src/core/validate';
import { sceneFields } from '../../src/core/validate/fields';
import { LEFT_IN_PLACE, PLACEHOLDERS, placeholderIssues } from '../../src/core/validate/placeholders';
import { codes, errorCodes, exampleDraft, exampleScene } from './helpers';

function change(id: string, edit: (s: any) => void): ReturnType<typeof checkScene> {
  const s = exampleScene(id);
  edit(s);
  return checkScene(s, exampleDraft());
}
const placeholderPaths = (check: ReturnType<typeof checkScene>): string[] => check.errors.filter((e) => e.code === 'PLACEHOLDER_TEXT').map((e) => e.path);

describe('a short placeholder left in the field the template has it in', () => {
  const leftovers: Array<[what: string, id: string, edit: (s: any) => void, paths: string[]]> = [
    ['the scene title', 's1', (s) => (s.title = 'Scene title'), ['title']],
    ['an edge label', 's2', (s) => (s.figure.edges[0].label = 'optional'), ['figure.edges[0].label']],
    ['a node label', 's2', (s) => (s.figure.nodes[0].label = 'First thing'), ['figure.nodes[0].label']],
    ['a step title', 's3', (s) => (s.steps[1].title = 'Optional step title'), ['steps[1].title']],
    ['a state value', 's3', (s) => (s.steps[0].state = [{ label: 'low', value: 'value now' }]), ['steps[0].state[0].value']],
    ['the chart unit and axis labels', 's5', (s) => Object.assign(s.figure, { unit: 'unit', xLabel: 'What the x axis is', yLabel: 'What the y axis is' }), ['figure.xLabel', 'figure.yLabel', 'figure.unit']],
    ['a series label', 's5', (s) => (s.figure.series[0].label = 'What is measured'), ['figure.series[0].label']],
    ['the unit of a numeric question', 's6', (s) => (s.question.unit = 'unit'), ['question.unit']],
    ['the text of an option', 's4', (s) => (s.question.options[1].text = 'The correct answer'), ['question.options[1].text']],
    ['a next topic', 's9', (s) => (s.next[0].topic = 'A follow-up topic'), ['next[0].topic']],
  ];

  it.each(leftovers)('PLACEHOLDER_TEXT: %s', (_what, id, edit, paths) => {
    const check = change(id, edit);
    expect(check.ok).toBe(false);
    expect(placeholderPaths(check)).toEqual(paths);
    for (const e of check.errors.filter((x) => x.code === 'PLACEHOLDER_TEXT')) {
      expect(e.message).toContain('placeholder text of the template');
      expect(e.fix).toContain('delete the field');
    }
  });

  it('the reviewer\'s lesson: every scene that kept a template decoration is refused', () => {
    // The edits of .scratch/review-agent/t10-placeholders.mts, scene by scene.
    const edits: Record<string, (s: any) => void> = {
      s1: (s) => (s.title = 'Scene title'),
      s2: (s) => (s.figure.edges[0].label = 'optional'),
      s3: (s) => { for (const step of s.steps) Object.assign(step, { title: 'Optional step title', state: [{ label: 'name', value: 'value now' }] }); },
      s5: (s) => { Object.assign(s.figure, { unit: 'unit', xLabel: 'What the x axis is', yLabel: 'What the y axis is' }); s.figure.series[0].label = 'What is measured'; },
      s6: (s) => (s.question.unit = 'unit'),
      s9: (s) => (s.next = [{ topic: 'A follow-up topic', why: 'To say precisely how the cost of binary search grows.' }]),
    };
    for (const [id, edit] of Object.entries(edits)) {
      const check = change(id, edit);
      expect(errorCodes(check).includes('PLACEHOLDER_TEXT'), id).toBe(true);
      expect(check.scene, id).toBeUndefined();
    }
    const s3 = change('s3', edits.s3!);
    // One for each step's title and one for each step's state value; the state label "name" is a word a lesson may use.
    expect(placeholderPaths(s3)).toHaveLength(2 * exampleScene('s3').steps.length);
  });

  it('every template, submitted as it came, is refused for every placeholder it holds', () => {
    const entries = [
      { id: 't', kind: 'narration' as const },
      ...FIGURE_TYPES.flatMap((figure) => [{ id: 't', kind: 'narration' as const, figure }, { id: 't', kind: 'step_through' as const, figure }]),
      ...QUESTION_TYPES.map((question) => ({ id: 't', kind: 'checkpoint' as const, question, objective: 'o1' })),
      { id: 't', kind: 'recap' as const },
    ];
    // What a real lesson may say in the very field the template says it in.
    const real = new Set(['Python', 'Put these in order.', 'Second', 'Third', 'Later', 'Option A', 'Option B', 'First', 'Top layer', 'Bottom layer', 'second line', 'name']);
    let short = 0;
    for (const entry of entries) {
      const fields = sceneFields(Scene.parse(templateFor(entry))).fields;
      const flagged = new Set(placeholderIssues(fields).map((i) => i.path));
      for (const field of fields) {
        expect(flagged.has(field.path), `${entry.kind} ${'figure' in entry ? entry.figure : ''}: ${field.path} = "${field.text}"`).toBe(!real.has(field.text));
        if (flagged.has(field.path) && !PLACEHOLDERS.has(field.text)) short++;
      }
    }
    expect(short).toBeGreaterThan(40);
    // 23 from the templates of the older kinds; the rest are the short placeholders of the clip templates (clip-templates.test.ts).
    const older = [...LEFT_IN_PLACE].filter(([kind]) => !kind.startsWith('stage.') && !kind.startsWith('beats[')).reduce((n, [, texts]) => n + texts.size, 0);
    expect(older).toBe(23);
  });
});

describe('the same words where they are real', () => {
  it.each<[what: string, id: string, edit: (s: any) => void]>([
    ['"unit" as a table heading', 's7', (s) => (s.figure = { type: 'compare', columns: [{ id: 'c1', label: 'unit' }, { id: 'c2', label: 'What is measured' }], rows: [{ id: 'r1', label: 'Sorted input', cells: ['item', 'Comparisons'] }], cites: ['e1'], description: 'A table with one row, naming what is counted when a search is measured.' })],
    ['"optional" as a node label', 's2', (s) => (s.figure.nodes[0].label = 'optional')],
    ['"Scene title" inside a longer title', 's1', (s) => (s.title = 'Scene title cards in film')],
    ['"The correct answer" as feedback', 's4', (s) => (s.question.options[0].feedback = 'The correct answer: the later half is the only place it can be.')],
    ['"A follow-up topic" in the reason for a next topic', 's9', (s) => (s.next[0].why = 'A follow-up topic that says how the cost grows.')],
    ['"value now" as a state label', 's3', (s) => (s.steps[0].state = [{ label: 'value now', value: '7' }])],
    ['a state row called "name"', 's3', (s) => (s.steps[0].state = [{ label: 'name', value: 'Ada' }])],
    ['an order question that says "Put these in order."', 's8', (s) => (s.question.prompt = 'Put these in order.')],
  ])('accepted: %s', (_what, id, edit) => {
    const check = change(id, edit);
    expect(check.errors.filter((e) => e.code === 'PLACEHOLDER_TEXT')).toEqual([]);
  });

  it('a compare figure with the template\'s plausible headings, and a lines figure in Python, are not placeholders', () => {
    const fields = [
      { path: 'figure.columns[0].label', text: 'Option A' },
      { path: 'figure.columns[1].label', text: 'Option B' },
      { path: 'figure.events[1].when', text: 'Later' },
      { path: 'figure.xs[0].label', text: 'First' },
      { path: 'figure.language', text: 'Python' },
      { path: 'question.items[1]', text: 'Second' },
    ].map((f) => ({ ...f, markup: false, code: false, numbers: { kind: 'exempt' as const }, what: 'field' }));
    expect(placeholderIssues(fields)).toEqual([]);
  });

  it('the example lesson holds no placeholder at all', () => {
    const draft = exampleDraft();
    for (const scene of EXAMPLE_SCENES) expect(codes(checkScene(structuredClone(scene), draft))).toEqual([]);
  });
});
