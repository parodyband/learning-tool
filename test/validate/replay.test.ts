// A replay corpus: submissions the way agents actually get them wrong. Tool arguments arrive
// stringified, keys are near misses, ids are in the wrong form, quotes carry the wrong punctuation,
// scenes run long. Each entry says what must happen: either the submission is accepted as it was
// meant (the small, fixed leniency), or it is refused with a fix specific enough to act on without
// reading the format again.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_EVIDENCE, EXAMPLE_PLAN, EXAMPLE_SCENES } from '../../src/core/examples';
import { MAX_ISSUES_PER_CALL } from '../../src/core/issues';
import { templateFor } from '../../src/core/templates';
import type { Draft, Issue } from '../../src/core/types';
import { checkEvidence, checkPlan, checkScene } from '../../src/core/validate';
import { errorCodes, exampleDraft, exampleScene, expectActionable, expectNoExcerptText, newDraft } from './helpers';

type Check = { ok: boolean; errors: Issue[]; warnings: Issue[]; scene?: unknown };

const accepted = (check: Check): void => {
  expect(check.errors).toEqual([]);
  expect(check.ok).toBe(true);
};

describe('accepted as meant: the three leniency rules', () => {
  const draft = exampleDraft();
  const reference = (id: string): unknown => checkScene(exampleScene(id), draft).scene;

  it.each(EXAMPLE_SCENES.map((s) => [s.id] as const))('scene %s sent as one JSON string', (id) => {
    const check = checkScene(JSON.stringify(exampleScene(id)), draft);
    accepted(check);
    expect(check.scene).toEqual(reference(id));
  });

  it('a scene sent as pretty-printed JSON, with a byte order mark in front', () => {
    const check = checkScene(`\ufeff${JSON.stringify(exampleScene('s3'), null, 2)}\n`, draft);
    accepted(check);
    expect(check.scene).toEqual(reference('s3'));
  });

  it('code indentation survives being sent inside a string', () => {
    const asString = checkScene(JSON.stringify(exampleScene('s3')), draft).scene as any;
    expect(asString.figure.lines[1]).toBe('    low, high = 0, len(items) - 1');
    expect(asString.figure.lines[3]).toBe('        mid = low + (high - low) // 2');
    const nested = exampleScene('s3');
    nested.figure = JSON.stringify(nested.figure);
    expect((checkScene(nested, draft).scene as any).figure.lines[5]).toBe('            return mid');
    const lines = exampleScene('s3');
    lines.figure.lines = JSON.stringify(lines.figure.lines);
    expect((checkScene(lines, draft).scene as any).figure.lines[7]).toBe('            low = mid + 1');
  });

  it.each([
    ['blocks', 's1', (s: any) => (s.blocks = JSON.stringify(s.blocks))],
    ['one block', 's1', (s: any) => (s.blocks[1] = JSON.stringify(s.blocks[1]))],
    ['a cites array', 's1', (s: any) => (s.blocks[1].cites = '["e1"]')],
    ['the figure', 's2', (s: any) => (s.figure = JSON.stringify(s.figure))],
    ['nodes and edges', 's2', (s: any) => ((s.figure.nodes = JSON.stringify(s.figure.nodes)), (s.figure.edges = JSON.stringify(s.figure.edges)))],
    ['steps', 's3', (s: any) => (s.steps = JSON.stringify(s.steps))],
    ['a step, its highlight and its state', 's3', (s: any) => ((s.steps[1].highlight = '["l4"]'), (s.steps[1].state = JSON.stringify(s.steps[1].state)), (s.steps[0] = JSON.stringify(s.steps[0])))],
    ['a predict', 's3', (s: any) => (s.steps[2].predict = JSON.stringify(s.steps[2].predict))],
    ['the question', 's4', (s: any) => (s.question = JSON.stringify(s.question))],
    ['options and explanation', 's4', (s: any) => ((s.question.options = JSON.stringify(s.question.options)), (s.question.explanation = JSON.stringify(s.question.explanation)))],
    ['chart series and values', 's5', (s: any) => ((s.figure.series[0].values = '[8, 64, 512, 4096]'), (s.figure.xs = JSON.stringify(s.figure.xs)))],
    ['order items', 's8', (s: any) => (s.question.items = JSON.stringify(s.question.items))],
    ['takeaways, practice and next', 's9', (s: any) => ((s.takeaways = JSON.stringify(s.takeaways)), (s.practice = JSON.stringify(s.practice)), (s.next = JSON.stringify(s.next)))],
  ])('%s sent as a JSON string inside the scene', (_what, id, edit) => {
    const s = exampleScene(id);
    edit(s);
    const check = checkScene(s, draft);
    accepted(check);
    expect(check.scene).toEqual(reference(id));
  });

  it.each([
    ['cites as a bare id on a claim', 's1', (s: any) => (s.blocks[1].cites = 'e1')],
    ['cites as a bare id on a figure', 's2', (s: any) => (s.figure.cites = 'e1')],
    ['cites as a bare id on an explanation', 's4', (s: any) => (s.question.explanation.cites = 'e1')],
    ['cites as a bare id on a takeaway', 's9', (s: any) => (s.takeaways[0].cites = 'e1')],
    ['cite as a one-element array on a quote', 's7', (s: any) => (s.blocks[1].cite = ['e3'])],
    ['null for an absent figure and caption', 's1', (s: any) => (s.figure = null)],
    ['invisible characters and stray white space', 's1', (s: any) => ((s.id = ' s1\u200b'), (s.title = '  One name\u00a0in a   million \n'), (s.blocks[1].cites = ['e1\u200b']))],
  ])('%s', (_what, id, edit) => {
    const s = exampleScene(id);
    edit(s);
    const check = checkScene(s, draft);
    accepted(check);
    expect(check.scene).toEqual(reference(id));
  });

  it('null for an optional field is the same as leaving it out', () => {
    const withNull = exampleScene('s4');
    withNull.question.hint = null;
    withNull.question.fixedOrder = null;
    const without = exampleScene('s4');
    delete without.question.hint;
    const check = checkScene(withNull, draft);
    accepted(check);
    expect(check.scene).toEqual(checkScene(without, draft).scene);
    expect(check.scene).not.toHaveProperty('question.hint');
  });

  it('a plan and an evidence item sent as JSON strings', () => {
    const plan = checkPlan(JSON.stringify(EXAMPLE_PLAN), draft);
    expect(plan.errors).toEqual([]);
    expect(plan.plan).toEqual(EXAMPLE_PLAN);
    const nested = checkPlan({ ...EXAMPLE_PLAN, objectives: JSON.stringify(EXAMPLE_PLAN.objectives), outline: JSON.stringify(EXAMPLE_PLAN.outline) }, draft);
    expect(nested.plan).toEqual(EXAMPLE_PLAN);
    const evidence = checkEvidence(JSON.stringify(EXAMPLE_EVIDENCE[0]), newDraft());
    expect(evidence.errors).toEqual([]);
    expect(evidence.evidence?.excerpt).toBe(EXAMPLE_EVIDENCE[0]!.excerpt);
  });

  it('a quote typed with other punctuation is stored in the source\'s own', () => {
    const local = exampleDraft();
    local.evidence.push({ ...local.evidence[2]!, id: 'e6', url: 'https://example.com/notes/quote', excerpt: 'As the notes put it, “a search that isn’t sure of its order can’t be trusted” — and that is the whole point.' });
    const s = exampleScene('s7');
    s.blocks[1] = { type: 'quote', text: "a search that isn't sure of its order can't be trusted", cite: 'e6' };
    const check = checkScene(s, local);
    accepted(check);
    expect((check.scene as any).blocks[1].text).toBe('a search that isn’t sure of its order can’t be trusted');
  });
});

describe('leniency goes no further', () => {
  const draft = exampleDraft();
  const refused = (id: string, edit: (s: any) => void): Issue[] => {
    const s = exampleScene(id);
    edit(s);
    const check = checkScene(s, draft);
    expect(check.ok).toBe(false);
    expectActionable(check.errors);
    return check.errors;
  };

  it('a string that is JSON twice over is not unwrapped twice', () => {
    const errors = (() => {
      const check = checkScene(JSON.stringify(JSON.stringify(exampleScene('s1'))), draft);
      return check.errors;
    })();
    expect(errors.map((e) => e.code)).toEqual(['WRONG_TYPE']);
    expect(errors[0]!.fix).toContain('as JSON and not as a string');
  });

  it('a string that is not JSON stays a string, and the fix says what to send', () => {
    const errors = refused('s1', (s) => (s.blocks = 'a claim about binary search, citing e1'));
    expect(errors.map((e) => [e.code, e.path])).toEqual([['WRONG_TYPE', 'blocks']]);
    expect(errors[0]).toMatchObject({ got: 'string' });
    expect(errors[0]!.fix).toContain('an array of 1 to 6 items');
  });

  it('several ids in one string are not split', () => {
    expect(refused('s1', (s) => (s.blocks[1].cites = 'e1, e2')).map((e) => [e.code, e.path])).toEqual([['BAD_ID', 'blocks[1].cites[0]']]);
  });

  it('a quote may cite one excerpt only', () => {
    const errors = refused('s7', (s) => (s.blocks[1].cite = ['e3', 'e4']));
    expect(errors.map((e) => [e.code, e.path])).toEqual([['WRONG_TYPE', 'blocks[1].cite']]);
    expect(errors[0]!.fix).toContain('Send one string, not an array');
  });

  it('numbers and booleans sent as text are named for what they should be', () => {
    const number = refused('s6', (s) => (s.question.answer = '20'));
    expect(number.map((e) => [e.code, e.path, e.fix])).toEqual([['WRONG_TYPE', 'question.answer', 'Send the number 20 without quotation marks.']]);
    const boolean = refused('s4', (s) => (s.question.options[0].correct = 'true'));
    expect(boolean.map((e) => [e.code, e.path, e.fix])).toEqual([['WRONG_TYPE', 'question.options[0].correct', 'Send true without quotation marks.']]);
    const values = refused('s5', (s) => (s.figure.series[0].values = ['8', '64', '512', '4,096']));
    expect(values.map((e) => e.code)).toEqual(['WRONG_TYPE', 'WRONG_TYPE', 'WRONG_TYPE', 'WRONG_TYPE']);
    expect(values[0]!.fix).toBe('Send the number 8 without quotation marks.');
    expect(values[3]!.fix).toBe('Send a number.');
  });

  it('an array of scenes is not a scene', () => {
    const check = checkScene([exampleScene('s1'), exampleScene('s2')], draft);
    expect(errorCodes(check)).toEqual(['WRONG_TYPE']);
    expect(check.errors[0]!.message).toContain('but an array was sent');
    expect(check.errors[0]!.fix).toBe('Send one scene per call, as an object and not inside an array.');
  });

  it.each([[undefined], [null], [42], [true], ['not json at all'], ['']])('%j is not a scene', (input) => {
    const check = checkScene(input, draft);
    expect(errorCodes(check)).toEqual(['WRONG_TYPE']);
    expect(check.errors[0]!.path).toBe('');
    expectActionable(check.errors);
  });
});

describe('refused with a fix that names what to change', () => {
  const draft = exampleDraft();
  const run = (id: string, edit: (s: any) => void, on: Draft = draft): Issue[] => {
    const s = exampleScene(id);
    edit(s);
    const check = checkScene(s, on);
    expect(check.ok).toBe(false);
    expect(check.scene).toBeUndefined();
    expectActionable([...check.errors, ...check.warnings]);
    expectNoExcerptText([...check.errors, ...check.warnings], on);
    return check.errors;
  };
  const brief = (issues: Issue[]): Array<[string, string]> => issues.map((i) => [i.code, i.path]);

  it('"cite" on a claim: one issue, a rename, and the valid keys', () => {
    const errors = run('s1', (s) => {
      s.blocks[1].cite = s.blocks[1].cites;
      delete s.blocks[1].cites;
    });
    expect(brief(errors)).toEqual([['UNKNOWN_FIELD', 'blocks[1].cite']]);
    expect(errors[0]!.fix).toBe('Rename "cite" to "cites". Valid fields here: type, text, cites.');
    // Doing exactly that, with the one-element value it had, is accepted.
    const fixed = exampleScene('s1');
    fixed.blocks[1].cites = 'e1';
    expect(checkScene(fixed, draft).ok).toBe(true);
  });

  it('"cites" on a quote', () => {
    const errors = run('s7', (s) => {
      s.blocks[1].cites = ['e3'];
      delete s.blocks[1].cite;
    });
    expect(brief(errors)).toEqual([['UNKNOWN_FIELD', 'blocks[1].cites']]);
    expect(errors[0]!.fix).toBe('Rename "cites" to "cite". Valid fields here: type, text, cite.');
  });

  it('both "cite" and "cites" on a claim: the extra one is removed, not renamed', () => {
    const errors = run('s1', (s) => (s.blocks[1].cite = 'e1'));
    expect(brief(errors)).toEqual([['UNKNOWN_FIELD', 'blocks[1].cite']]);
    expect(errors[0]!.fix).toBe('Remove "cite". Valid fields here: type, text, cites.');
  });

  it.each([
    ['citations', 's1', (s: any) => ((s.blocks[1].citations = s.blocks[1].cites), delete s.blocks[1].cites), 'blocks[1].citations', 'cites'],
    ['sources', 's2', (s: any) => ((s.figure.sources = s.figure.cites), delete s.figure.cites), 'figure.sources', 'cites'],
    ['source on a quote', 's7', (s: any) => ((s.blocks[1].source = s.blocks[1].cite), delete s.blocks[1].cite), 'blocks[1].source', 'cite'],
    ['content', 's1', (s: any) => ((s.blocks[0].content = s.blocks[0].text), delete s.blocks[0].text), 'blocks[0].content', 'text'],
    ['based_on', 's5', (s: any) => ((s.blocks[2].based_on = s.blocks[2].basedOn), delete s.blocks[2].basedOn), 'blocks[2].based_on', 'basedOn'],
    ['highlights', 's3', (s: any) => ((s.steps[0].highlights = s.steps[0].highlight), delete s.steps[0].highlight), 'steps[0].highlights', 'highlight'],
    ['x_label', 's5', (s: any) => ((s.figure.x_label = s.figure.xLabel), delete s.figure.xLabel), 'figure.x_label', 'xLabel'],
    ['choices', 's4', (s: any) => ((s.question.choices = s.question.options), delete s.question.options), 'question.choices', 'options'],
    ['isCorrect', 's4', (s: any) => ((s.question.options[0].isCorrect = true), delete s.question.options[0].correct), 'question.options[0].isCorrect', 'correct'],
    ['Title', 's1', (s: any) => ((s.Title = s.title), delete s.title), 'Title', 'title'],
    ['take_aways', 's9', (s: any) => ((s.take_aways = s.takeaways), delete s.takeaways), 'take_aways', 'takeaways'],
    ['type on a scene', 's1', (s: any) => ((s.type = s.kind), delete s.kind), 'type', 'kind'],
    ['kind on a block', 's1', (s: any) => ((s.blocks[0].kind = s.blocks[0].type), delete s.blocks[0].type), 'blocks[0].kind', 'type'],
  ])('the near miss "%s" is renamed, not just refused', (_what, id, edit, path, rename) => {
    const errors = run(id, edit);
    const unknown = errors.filter((e) => e.code === 'UNKNOWN_FIELD');
    expect(unknown.map((e) => e.path)).toEqual([path]);
    expect(unknown[0]!.fix).toContain(`to "${rename}"`);
    expect(unknown[0]!.fix).toMatch(/Valid (fields here|values for "(kind|type)"):/);
    // One mistake, one issue: the field the key was meant to be is not also reported as missing.
    expect(errors.filter((e) => e.code !== 'UNKNOWN_FIELD')).toEqual([]);
  });

  it('a field that belongs to nothing is removed, with the valid keys listed', () => {
    const errors = run('s4', (s) => ((s.difficulty = 'medium'), (s.question.points = 5)));
    expect(brief(errors)).toEqual([
      ['UNKNOWN_FIELD', 'question.points'],
      ['UNKNOWN_FIELD', 'difficulty'],
    ]);
    expect(errors[0]!.fix).toBe('Remove "points". Valid fields here: type, prompt, options, explanation, hint, fixedOrder.');
    expect(errors[1]!.fix).toBe('Remove "difficulty". Valid fields here: id, title, kind, objective, level, question.');
  });

  it('a wrong or missing discriminator lists the valid ones', () => {
    const kind = run('s1', (s) => (s.kind = 'narrative'));
    expect(brief(kind)).toEqual([['BAD_VALUE', 'kind']]);
    expect(kind[0]!.fix).toBe('Use "narration". Valid values for "kind": "narration", "step_through", "checkpoint", "recap", "clip".');

    const none = run('s1', (s) => delete s.kind);
    expect(brief(none)).toEqual([['MISSING_FIELD', 'kind']]);
    expect(none[0]!.fix).toBe('Add "kind" with one of: "narration", "step_through", "checkpoint", "recap", "clip".');

    const block = run('s1', (s) => (s.blocks[0].type = 'paragraph'));
    expect(brief(block)).toEqual([['BAD_VALUE', 'blocks[0].type']]);
    expect(block[0]!.fix).toBe('Use one of the valid values for "type": "claim", "quote", "analogy", "example", "framing".');

    const figure = run('s2', (s) => (s.figure.type = 'flowchart'));
    expect(brief(figure)).toEqual([['BAD_VALUE', 'figure.type']]);
    expect(figure[0]!.fix).toContain('Use "flow".');

    const question = run('s4', (s) => (s.question.type = 'multiple_choice'));
    expect(question[0]!.fix).toContain('"single", "order", "numeric", "reflect"');
  });

  it.each([
    ['a number', (s: any) => (s.blocks[1].cites = [1]), 'WRONG_TYPE', 'an evidence id such as "e1"'],
    ['a bare digit', (s: any) => (s.blocks[1].cites = ['1']), 'BAD_ID', 'Stored ids: e1, e2, e3, e4, e5.'],
    ['a capital letter', (s: any) => (s.blocks[1].cites = ['E1']), 'BAD_ID', 'Stored ids: e1, e2, e3, e4, e5.'],
    ['a leading zero', (s: any) => (s.blocks[1].cites = ['e01']), 'BAD_ID', 'Evidence ids look like "e1".'],
    ['brackets', (s: any) => (s.blocks[1].cites = ['[e1]']), 'BAD_ID', 'Use an id returned by save_evidence.'],
    ['a made-up name', (s: any) => (s.blocks[1].cites = ['source-1']), 'BAD_ID', 'Stored ids'],
    ['a URL', (s: any) => (s.blocks[1].cites = ['https://example.org/algorithms/binary-search']), 'BAD_ID', 'Stored ids'],
    ['an id that was never saved', (s: any) => (s.blocks[1].cites = ['e6']), 'CITE_UNKNOWN', 'Stored ids: e1, e2, e3, e4, e5.'],
  ])('a citation given as %s', (_what, edit, code, fix) => {
    const errors = run('s1', edit);
    expect(brief(errors)).toEqual([[code, 'blocks[1].cites[0]']]);
    expect(`${errors[0]!.fix} ${errors[0]!.expected ?? ''}`).toContain(fix);
  });

  it('too many citations on one claim', () => {
    const errors = run('s1', (s) => (s.blocks[1].cites = ['e1', 'e2', 'e3', 'e4']));
    expect(brief(errors)).toEqual([['TOO_MANY', 'blocks[1].cites']]);
    expect(errors[0]).toMatchObject({ got: '4', expected: 'at most 3 items', fix: 'Remove 1 of them.' });
  });

  it('wrong objective ids', () => {
    for (const bad of ['1', 'O1', 'objective-1', 'o10']) {
      const errors = run('s4', (s) => (s.objective = bad));
      expect(brief(errors)).toEqual([['BAD_ID', 'objective']]);
      expect(errors[0]!.fix).toBe('Objective ids are "o1" to "o9". Planned objectives: o1, o2.');
    }
  });

  it('wrong scene and part ids', () => {
    const scene = run('s1', (s) => (s.id = 'Scene 1'));
    expect(brief(scene)).toEqual([['SCENE_NOT_PLANNED', 'id']]);
    const upper = run('s1', (s) => (s.id = 'S1'));
    expect(brief(upper)).toEqual([['SCENE_NOT_PLANNED', 'id']]);
    expect(upper[0]!.fix).toContain('Did you mean "s1"?');
    const part = run('s2', (s) => (s.figure.nodes[0].id = 'Start Node'));
    expect(part.map((e) => e.code)).toContain('BAD_ID');
    expect(part.find((e) => e.code === 'BAD_ID')!.fix).toContain('a-z, 0-9, "-" or "_"');
    const highlight = run('s3', (s) => (s.steps[0].highlight = [2]));
    expect(brief(highlight)).toEqual([['WRONG_TYPE', 'steps[0].highlight[0]']]);
  });

  it('a markdown link, raw HTML and an image in prose', () => {
    const link = run('s1', (s) => (s.blocks[0].text = 'See [the handbook](https://example.org/algorithms/binary-search) first.'));
    expect(brief(link)).toEqual([['URL_IN_TEXT', 'blocks[0].text']]);
    const image = run('s1', (s) => (s.blocks[0].text = 'Look: ![diagram](https://example.org/d.png)'));
    expect(brief(image)).toEqual([['URL_IN_TEXT', 'blocks[0].text']]);
    // Tags without an address are only text: the renderer shows them as typed, so there is nothing to refuse.
    const s = exampleScene('s1');
    s.blocks[0].text = 'How do you find <b>one</b> name among a million?';
    expect(checkScene(s, draft).ok).toBe(true);
  });

  it('a scene that runs long says by how much', () => {
    const errors = run('s1', (s) => {
      for (let i = 0; i < 3; i++) s.blocks.push({ type: 'example', text: `${Array.from({ length: 40 }, () => 'word').join(' ')}.` });
    });
    expect(brief(errors)).toEqual([['WORDS_OVER_BUDGET', 'blocks']]);
    expect(errors[0]).toMatchObject({ got: '196', expected: 'at most 150 words' });
    expect(errors[0]!.fix).toContain('Cut at least 46 words.');
  });

  it('text that runs long says by how much', () => {
    const errors = run('s1', (s) => (s.blocks[0].text = `${'A long question about names. '.repeat(6)}`));
    expect(brief(errors)).toEqual([['TOO_LONG', 'blocks[0].text']]);
    expect(errors[0]).toMatchObject({ got: '173', expected: 'at most 160 characters', fix: 'Shorten it by at least 13 characters.' });
  });

  it('an explanation or a takeaway given as plain text', () => {
    const explanation = run('s4', (s) => (s.question.explanation = 'Because the list is sorted.'));
    expect(brief(explanation)).toEqual([['WRONG_TYPE', 'question.explanation']]);
    expect(explanation[0]!.fix).toContain('an object with the fields "text", "cites"');
    const takeaways = run('s9', (s) => (s.takeaways = ['Compare with the middle element.', 'It needs sorted data.']));
    expect(brief(takeaways)).toEqual([
      ['WRONG_TYPE', 'takeaways[0]'],
      ['WRONG_TYPE', 'takeaways[1]'],
    ]);
    expect(takeaways[0]!.fix).toContain('"objective", "text", "cites"');
  });

  it('a claim with no citation at all', () => {
    const errors = run('s1', (s) => delete s.blocks[1].cites);
    expect(brief(errors)).toEqual([['MISSING_FIELD', 'blocks[1].cites']]);
    expect(errors[0]!.message).toBe('The required field "cites" is missing from "blocks[1]".');
    expect(errors[0]!.fix).toBe('Add it: an array of 1 to 3 items, each an evidence id such as "e1".');
    const empty = run('s1', (s) => (s.blocks[1].cites = []));
    expect(brief(empty)).toEqual([['TOO_FEW', 'blocks[1].cites']]);
  });

  it('a template sent back unfilled is refused on its placeholders, whatever the scene kind', () => {
    for (const entry of draft.outline) {
      const check = checkScene(templateFor(entry), draft);
      expect(check.ok, entry.id).toBe(false);
      expect(check.errors.map((e) => e.code), entry.id).toContain('PLACEHOLDER_TEXT');
      expectActionable(check.errors);
    }
  });

  it('a scene that is written but still carries one optional placeholder is refused for that field alone', () => {
    const cases: Array<[string, string, (s: any) => void]> = [
      ['s2', 'figure.caption', (s) => (s.figure.caption = 'Optional one-line caption.')],
      ['s2', 'figure.nodes[1].detail', (s) => (s.figure.nodes[1].detail = 'Optional short detail')],
      ['s3', 'intro', (s) => (s.intro = 'Optional one line shown before the first step.')],
      ['s4', 'question.hint', (s) => (s.question.hint = 'Optional nudge that does not give the answer away.')],
      ['s4', 'question.options[1].misconception', (s) => (s.question.options[1].misconception = 'The mistaken belief that leads here')],
      ['s9', 'practice.task', (s) => (s.practice.task = 'Optional: something to try away from the screen.')],
    ];
    for (const [id, path, edit] of cases) {
      const errors = run(id, edit);
      expect(brief(errors), path).toEqual([['PLACEHOLDER_TEXT', path]]);
      expect(errors[0]!.fix).toContain('delete the field');
    }
  });

  it('short template words that a lesson may really say are not placeholders', () => {
    const order = exampleScene('s8');
    order.question.prompt = 'Put these in order.';
    order.question.items[1] = 'Second';
    expect(checkScene(order, draft).errors).toEqual([]);
    const local = exampleDraft();
    local.outline[1]!.figure = 'layers';
    const layers = exampleScene('s2');
    layers.figure = { type: 'layers', layers: [{ id: 'top', label: 'Top layer' }, { id: 'bottom', label: 'Bottom layer' }], cites: ['e1'], description: 'Two layers: the sorted array on top, the middle element below it.' };
    expect(checkScene(layers, local).errors).toEqual([]);
    // A sentence that contains a placeholder among other words is the agent's own sentence.
    const hint = exampleScene('s4');
    hint.question.hint = 'Here is a nudge that does not give the answer away: think about sorted order.';
    expect(checkScene(hint, draft).errors).toEqual([]);
  });

  it('many problems at once are reported together, in a stable order, and capped', () => {
    const edit = (s: any): void => {
      s.title = '';
      s.blocks[0].text = 'See https://tracker.invalid/x and the 9,999 names.';
      s.blocks[1].cites = ['e9'];
      s.blocks[2].limits = 'short';
      s.blocks.push({ type: 'quote', text: 'not in the source at all', cite: 'e1' });
    };
    const shape = run('s1', edit);
    // The schema speaks first; the rules cannot run on a scene that does not parse.
    expect(brief(shape)).toEqual([
      ['TOO_SHORT', 'title'],
      ['TOO_SHORT', 'blocks[2].limits'],
    ]);
    const rules = run('s1', (s) => {
      edit(s);
      s.title = 'One name in a million';
      s.blocks[2].limits = 'A reader guesses where to open.';
    });
    expect(brief(rules)).toEqual([
      ['CITE_UNKNOWN', 'blocks[1].cites[0]'],
      ['QUOTE_NOT_FOUND', 'blocks[3].text'],
      ['NUMBER_UNGROUNDED', 'blocks[0].text'],
      ['URL_IN_TEXT', 'blocks[0].text'],
    ]);

    const many = run('s2', (s) => {
      s.figure.nodes = Array.from({ length: 12 }, (_, i) => ({ id: 'dup', label: `Node ${'abcdefghijkl'[i]}` }));
      s.figure.edges = Array.from({ length: 16 }, (_, i) => ({ id: `edge-${'abcdefghijklmnop'[i]}`, from: 'nowhere', to: 'dup' }));
    });
    expect(many).toHaveLength(MAX_ISSUES_PER_CALL + 1);
    const last = many[many.length - 1]!;
    expect(last.code).toBe('MORE_ISSUES');
    expect(last.message).toBe('7 more errors not listed (27 in total).');
    expect(last.fix).toContain('call the tool again');
  });
});

describe('the whole corpus is deterministic', () => {
  it('each bad submission gives the same report twice', () => {
    const draft = exampleDraft();
    const inputs: unknown[] = [
      JSON.stringify(exampleScene('s3')),
      { ...exampleScene('s1'), kind: 'narrative' },
      { ...exampleScene('s4'), objective: 'O1', level: 'hard', extra: 1 },
      [exampleScene('s1')],
      'not json',
      templateFor(draft.outline[2]!),
    ];
    for (const input of inputs) expect(JSON.stringify(checkScene(structuredClone(input), draft))).toBe(JSON.stringify(checkScene(input, exampleDraft())));
  });
});
