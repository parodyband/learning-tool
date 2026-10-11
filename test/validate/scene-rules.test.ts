// The remaining scene rules, each in both directions: plan fit, figures, steps, word budgets and
// questions. The refused case shows the rule works; the accepted case beside it shows the rule
// does not reject what an honest agent would write.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_FIGURES, EXAMPLE_QUESTIONS } from '../../src/core/examples';
import { LIMITS as L } from '../../src/core/limits';
import type { Draft } from '../../src/core/types';
import { checkScene } from '../../src/core/validate';
import { codes, errorCodes, exampleDraft, exampleScene, warningCodes } from './helpers';

function change(id: string, edit: (s: any) => void, prepare?: (draft: Draft) => void): ReturnType<typeof checkScene> {
  const draft = exampleDraft();
  prepare?.(draft);
  const s = exampleScene(id);
  edit(s);
  return checkScene(s, draft);
}
const words = (n: number, word = 'tap'): string => `${Array.from({ length: n }, () => word).join(' ')}.`;

describe('plan fit', () => {
  it('without a plan nothing else is reported, however broken the scene', () => {
    const check = change('s1', (s) => ((s.blocks = 'nonsense'), (s.title = 5)), (draft) => ((draft.outline = []), (draft.title = undefined)));
    expect(errorCodes(check)).toEqual(['NO_PLAN']);
    expect(check.errors[0]!.fix).toContain('plan_lesson');
  });

  it('an unplanned id lists the planned ones and guesses the nearest', () => {
    const check = change('s1', (s) => (s.id = 'scene1'));
    expect(errorCodes(check)).toEqual(['SCENE_NOT_PLANNED']);
    expect(check.errors[0]!.fix).toContain('s1 (narration), s2 (narration), s3 (step_through)');
    expect(check.errors[0]!.fix).toContain('Did you mean "s1"?');
  });

  it('a wrong kind is one issue, not a cascade', () => {
    const check = change('s3', (s) => (s.id = 's5'));
    expect(errorCodes(check)).toEqual(['SCENE_KIND_MISMATCH']);
    expect(check.errors[0]).toMatchObject({ got: 'step_through', expected: 'narration' });
  });

  it('plan fit is reported together with shape problems of the same scene', () => {
    const check = change('s1', (s) => ((s.id = 's4'), (s.blocks[0].tone = 'warm')));
    expect(errorCodes(check)).toEqual(['SCENE_KIND_MISMATCH', 'UNKNOWN_FIELD']);
  });

  it.each([
    ['a figure the plan does not have', 's1', (s: any) => (s.figure = structuredClone(EXAMPLE_FIGURES.layers)), 'figure'],
    ['no figure where one is planned', 's5', (s: any) => delete s.figure, 'figure'],
    ['another figure type', 's2', (s: any) => (s.figure = structuredClone(EXAMPLE_FIGURES.layers)), 'figure.type'],
    ['another figure type in a step-through', 's3', (s: any) => ((s.figure = structuredClone(EXAMPLE_FIGURES.flow)), s.steps.forEach((step: any) => (step.highlight = ['start']))), 'figure.type'],
    ['another question type', 's4', (s: any) => (s.question = structuredClone(EXAMPLE_QUESTIONS.reflect)), 'question.type'],
    ['another planned objective', 's4', (s: any) => (s.objective = 'o2'), 'objective'],
  ])('SCENE_SHAPE_MISMATCH: %s', (_what, id, edit, path) => {
    const check = change(id, edit);
    expect(errorCodes(check)).toEqual(['SCENE_SHAPE_MISMATCH']);
    expect(check.errors[0]!.path).toBe(path);
    expect(check.errors[0]!.fix).toContain('plan_lesson');
  });

  it('a scene that matches a changed plan is accepted', () => {
    const check = change('s2', (s) => (s.figure = structuredClone(EXAMPLE_FIGURES.layers)), (draft) => (draft.outline[1]!.figure = 'layers'));
    expect(check.errors).toEqual([]);
  });

  it('the recap needs exactly one takeaway per planned objective', () => {
    const missing = change('s9', (s) => s.takeaways.shift());
    expect(errorCodes(missing)).toEqual(['RECAP_OBJECTIVES']);
    expect(missing.errors[0]!.message).toContain('no takeaway for o1');

    const twice = change('s9', (s) => s.takeaways.push({ ...s.takeaways[0] }));
    expect(errorCodes(twice)).toEqual(['RECAP_OBJECTIVES']);
    expect(twice.errors[0]!.message).toContain('more than one for o1');

    const unknown = change('s9', (s) => s.takeaways.push({ ...s.takeaways[0], objective: 'o5' }));
    expect(errorCodes(unknown)).toEqual(['OBJECTIVE_UNKNOWN']);
    expect(unknown.errors[0]).toMatchObject({ path: 'takeaways[2].objective', got: 'o5' });

    // In any order is fine.
    expect(change('s9', (s) => s.takeaways.reverse()).errors).toEqual([]);
  });
});

describe('figures', () => {
  const figure = (type: keyof typeof EXAMPLE_FIGURES, edit: (f: any) => void) =>
    change(
      's2',
      (s) => {
        s.figure = structuredClone(EXAMPLE_FIGURES[type]);
        edit(s.figure);
      },
      (draft) => (draft.outline[1]!.figure = type),
    );

  it.each([
    ['flow: a node and an edge', 'flow', (f: any) => (f.edges[1].id = 'middle'), 'figure.edges[1].id'],
    ['flow: two nodes', 'flow', (f: any) => f.nodes.push({ id: 'start', label: 'Start again' }), 'figure.nodes[5].id'],
    ['sequence: an actor and a message', 'sequence', (f: any) => (f.messages[0].id = 'caller'), 'figure.messages[0].id'],
    ['layers', 'layers', (f: any) => (f.layers[2].id = 'whole'), 'figure.layers[2].id'],
    ['timeline', 'timeline', (f: any) => (f.events[1].id = 'c1'), 'figure.events[1].id'],
    ['compare: a column and a row', 'compare', (f: any) => (f.rows[1].id = 'linear'), 'figure.rows[1].id'],
    ['chart: an x position and a series', 'chart', (f: any) => (f.series[0].id = 'n8'), 'figure.series[0].id'],
  ])('FIGURE_DUPLICATE_ID in %s', (_what, type, edit, path) => {
    const check = figure(type as keyof typeof EXAMPLE_FIGURES, edit);
    expect(errorCodes(check)).toEqual(['FIGURE_DUPLICATE_ID']);
    expect(check.errors[0]!.path).toBe(path);
  });

  it('references must resolve to nodes or actors, not to edges or messages', () => {
    const edge = figure('flow', (f) => (f.edges[0].from = 'check'));
    expect(errorCodes(edge)).toEqual(['FIGURE_UNKNOWN_REF']);
    expect(edge.errors[0]).toMatchObject({ path: 'figure.edges[0].from', got: 'check' });
    expect(edge.errors[0]!.fix).toContain('start, middle, compare, found, discard');

    const message = figure('sequence', (f) => (f.messages[2].to = 'searcher'));
    expect(errorCodes(message)).toEqual(['FIGURE_UNKNOWN_REF']);
    expect(message.errors[0]!.fix).toContain('Use "search".');
  });

  it('a message from an actor to itself and a cycle in a flow are fine', () => {
    expect(codes(figure('sequence', () => undefined))).toEqual([]);
    expect(codes(figure('flow', (f) => f.edges.push({ id: 'loop', from: 'found', to: 'start' })))).toEqual([]);
  });

  it('rows and series must be as long as their columns and x positions', () => {
    const short = figure('compare', (f) => f.rows[1].cells.pop());
    expect(errorCodes(short)).toEqual(['TOO_FEW']);
    const three = figure('compare', (f) => {
      f.columns.push({ id: 'hash', label: 'Hash table' });
      f.rows[0].cells.push('No');
    });
    expect(errorCodes(three)).toEqual(['FIGURE_CELL_COUNT']);
    expect(three.errors[0]).toMatchObject({ path: 'figure.rows[1].cells', got: '2', expected: '3' });

    const series = figure('chart', (f) => f.series[0].values.push(8192));
    expect(errorCodes(series)).toEqual(['FIGURE_VALUE_COUNT']);
    expect(series.errors[0]).toMatchObject({ path: 'figure.series[0].values', got: '5', expected: '4' });
  });

  it('a math figure must parse line by line; a text figure is free', () => {
    const lines = (format: string, list: string[]) =>
      change(
        's2',
        (s) => (s.figure = { type: 'lines', format, lines: list, description: 'A short derivation of how many times a list of n items can be halved.' }),
        (draft) => (draft.outline[1]!.figure = 'lines'),
      );
    expect(lines('math', ['\\frac{n}{2^k} = 1', '2^k = n', 'k = \\log_2 n']).errors).toEqual([]);
    const bad = lines('math', ['\\frac{n}{2^k} = 1', 'so 2^k = n \\implies k', '']);
    expect(errorCodes(bad)).toEqual(['MARKUP_MATH', 'MARKUP_MATH']);
    expect(bad.errors.map((e) => e.path)).toEqual(['figure.lines[1]', 'figure.lines[2]']);
    expect(bad.errors[0]!.message).toContain('\\implies');
    expect(lines('text', ['so 2^k = n \\implies k', '']).errors).toEqual([]);
    expect(lines('code', ['x = "$\\bogus$"']).errors).toEqual([]);
  });

  it('math spans in prose must parse; things that only look like math are left alone', () => {
    const framing = (text: string) => change('s1', (s) => (s.blocks[0].text = text));
    expect(framing('How many times can $n$ be halved before $\\frac{n}{2^k} = 1$?').errors).toEqual([]);
    expect(framing('Would you pay $5 or $9 for a faster search?').errors).toEqual([]);
    expect(framing('Is `$HOME` sorted? Is \\$x\\$ a price?').errors).toEqual([]);
    const bad = framing('How many times is $\\dfrac{n}{2}$ taken before $n \\rightsquigarrow 1$?');
    expect(errorCodes(bad)).toEqual(['MARKUP_MATH', 'MARKUP_MATH']);
    expect(bad.errors[0]!.message).toContain('\\dfrac');
    expect(bad.errors[0]!.fix).toContain('\\frac{}{}');
    // Titles are plain text: nothing in them is parsed as math.
    expect(change('s1', (s) => (s.title = 'When $\\bogus$ is fine')).errors).toEqual([]);
    // The labels, caption and description of a figure are drawn with markup, so they are held to it.
    expect(change('s2', (s) => (s.figure.nodes[1].label = 'Look at element $\\frac{n}{2}$')).errors).toEqual([]);
    const label = change('s2', (s) => (s.figure.nodes[1].label = 'Look at element $\\half{n}$'));
    expect(label.errors.map((e) => [e.code, e.path])).toEqual([['MARKUP_MATH', 'figure.nodes[1].label']]);
    expect(errorCodes(change('s2', (s) => (s.figure.caption = 'The loop: $\\loop$')))).toEqual(['MARKUP_MATH']);
    // A timeline's "when" and a chart's labels are shown as typed.
    expect(change('s5', (s) => (s.figure.xLabel = 'Items $\\bogus$')).errors).toEqual([]);
  });
});

describe('steps', () => {
  it('a highlight must be a part of the figure, and the fix lists the parts', () => {
    const lines = change('s3', (s) => (s.steps[1].highlight = ['l4', 'l12']));
    expect(errorCodes(lines)).toEqual(['STEP_HIGHLIGHT_UNKNOWN']);
    expect(lines.errors[0]).toMatchObject({ path: 'steps[1].highlight[1]', got: 'l12' });
    expect(lines.errors[0]!.fix).toBe('The part ids of this figure are: l1 to l11 (one per line).');

    const flow = change(
      's3',
      (s) => {
        s.figure = structuredClone(EXAMPLE_FIGURES.flow);
        s.steps.forEach((step: any, i: number) => (step.highlight = [i === 0 ? 'begining' : 'middle']));
      },
      (draft) => (draft.outline[2]!.figure = 'flow'),
    );
    expect(errorCodes(flow)).toEqual(['STEP_HIGHLIGHT_UNKNOWN']);
    expect(flow.errors[0]!.fix).toBe('Use "begin". The part ids of this figure are: start, middle, compare, found, discard, begin, check, yes, no, again.');
  });

  it('every kind of part can be highlighted, and a step may highlight nothing', () => {
    const cases: Array<[keyof typeof EXAMPLE_FIGURES, string[]]> = [
      ['flow', ['start', 'again']],
      ['sequence', ['caller', 'read']],
      ['layers', ['mid']],
      ['timeline', ['c2']],
      ['compare', ['binary', 'cost']],
      ['chart', ['n64', 'linear']],
      ['lines', ['l1', 'l11']],
    ];
    for (const [type, ids] of cases) {
      const check = change(
        's3',
        (s) => {
          s.figure = structuredClone(EXAMPLE_FIGURES[type]);
          s.steps.forEach((step: any, i: number) => (step.highlight = i === 0 ? [] : ids));
        },
        (draft) => (draft.outline[2]!.figure = type),
      );
      expect(check.errors, type).toEqual([]);
    }
  });
});

describe('word budgets', () => {
  it('a narration scene is measured as a whole, with its figure counted against it', () => {
    // An example block holds at most 480 characters, so a long scene takes several.
    const fill = (n: number) => [Math.ceil(n / 2), Math.floor(n / 2)].filter((k) => k > 0).map((k) => ({ type: 'example', text: words(k) }));
    const plain = (n: number) => change('s7', (s) => (s.blocks = [s.blocks[0], ...fill(n - 10)]));
    expect(plain(L.narrationWords.warn).metrics).toMatchObject({ words: 90, budget: { warn: 90, max: 150, per: 'scene' } });
    expect(codes(plain(L.narrationWords.warn))).toEqual([]);
    expect(codes(plain(L.narrationWords.warn + 1))).toEqual(['WORDS_NEAR_BUDGET']);
    expect(codes(plain(L.narrationWords.max))).toEqual(['WORDS_NEAR_BUDGET']);
    const over = plain(L.narrationWords.max + 1);
    expect(codes(over)).toEqual(['WORDS_OVER_BUDGET']);
    expect(over.ok).toBe(false);
    expect(over.metrics!.words).toBe(151);

    const beside = (n: number) => change('s2', (s) => (s.blocks = [s.blocks[0], ...fill(n - 20)]));
    expect(codes(beside(L.narrationWithFigureWords.warn))).toEqual([]);
    expect(codes(beside(L.narrationWithFigureWords.max))).toEqual(['WORDS_NEAR_BUDGET']);
    const tight = beside(L.narrationWithFigureWords.max + 1);
    expect(codes(tight)).toEqual(['WORDS_OVER_BUDGET']);
    expect(tight.errors[0]).toMatchObject({ got: '121', expected: 'at most 120 words' });
    expect(tight.errors[0]!.message).toContain('narration scene with a figure');
  });

  it('a step-through is measured step by step', () => {
    const step = (n: number) => change('s3', (s) => (s.steps[3].blocks = [{ type: 'example', text: words(n) }]));
    expect(codes(step(L.stepWords.warn))).toEqual([]);
    expect(codes(step(L.stepWords.warn + 1))).toEqual(['WORDS_NEAR_BUDGET']);
    const over = step(L.stepWords.max + 1);
    expect(codes(over)).toEqual(['WORDS_OVER_BUDGET']);
    expect(over.errors[0]).toMatchObject({ path: 'steps[3].blocks', got: '71' });
    // The scene as a whole may hold far more than one step's budget.
    expect(step(L.stepWords.warn).metrics!.words).toBeGreaterThan(L.stepWords.max);
    expect(step(L.stepWords.warn).metrics!.budget).toEqual({ warn: 45, max: 70, per: 'step' });
  });

  it('counts an analogy with its limits, and does not count titles, labels, state or questions', () => {
    const base = change('s1', () => undefined).metrics!.words;
    expect(change('s1', (s) => (s.blocks[2].limits = `${s.blocks[2].limits} One more short sentence here.`)).metrics!.words).toBe(base + 5);
    expect(change('s1', (s) => (s.title = 'A much longer title for the very same scene')).metrics!.words).toBe(base);
    expect(change('s4', () => undefined).metrics).toMatchObject({ words: 0, budget: null, citedBlocks: 0, uncitedBlocks: 0 });
    expect(change('s9', () => undefined).metrics).toMatchObject({ words: 39, budget: null });
  });

  it('counts words in languages written without spaces', () => {
    const draft = exampleDraft();
    draft.language = 'ja';
    draft.evidence = draft.evidence.map((e) => ({ ...e, lang: 'en' }));
    const s = exampleScene('s7');
    s.blocks = [s.blocks[0], { type: 'example', text: '二分探索は整列済みの配列の中央の要素と目標の値を比較します。'.repeat(4) }];
    const check = checkScene(s, draft);
    expect(check.errors).toEqual([]);
    // A count by spaces would see one word in the example; the budget sees every word of it.
    expect(check.metrics!.words).toBeGreaterThan(40);
    expect(check.metrics!.words).toBeLessThanOrEqual(150);
  });

  it('reports metrics for a rejected scene too, even one that does not parse', () => {
    const rejected = change('s1', (s) => (s.blocks[1].cites = ['e9']));
    expect(rejected.ok).toBe(false);
    expect(rejected.metrics).toMatchObject({ sceneId: 's1', words: 76, citedBlocks: 1, uncitedBlocks: 2 });
    const unparsed = change('s1', (s) => (s.blocks[1].cite = 'e1'));
    expect(unparsed.ok).toBe(false);
    expect(unparsed.metrics).toMatchObject({ sceneId: 's1', words: 76, citedBlocks: 1, uncitedBlocks: 2, budget: { warn: 90, max: 150 } });
  });
});

describe('questions', () => {
  const single = (edit: (q: any) => void) => change('s4', (s) => edit(s.question));
  const predict = (edit: (p: any) => void) => change('s3', (s) => edit(s.steps[2].predict));

  it('exactly one option is correct, in a question and in a predict', () => {
    const none = single((q) => ((q.options[0].correct = false), (q.options[0].misconception = 'Believes the later half is never searched')));
    expect(errorCodes(none)).toEqual(['OPTION_CORRECT_COUNT']);
    expect(none.errors[0]!.fix).toBe('Set "correct": true on the one option that is right.');
    expect(errorCodes(predict((p) => (p.options[1].correct = true)))).toEqual(['OPTION_CORRECT_COUNT']);
    expect(predict((p) => (p.options[1].correct = true)).errors[0]!.path).toBe('steps[2].predict.options');
  });

  it('options that say the same thing are duplicates, whatever the case or punctuation', () => {
    const check = single((q) => (q.options[2].text = 'search only the half BEFORE the middle element.'));
    expect(errorCodes(check)).toEqual(['OPTION_DUPLICATE']);
    expect(check.errors[0]!.message).toBe('Options 2 and 3 say the same thing.');
    expect(errorCodes(predict((p) => (p.options[2].text = p.options[1].text)))).toEqual(['OPTION_DUPLICATE']);
  });

  it.each([
    'All of the above',
    'None of the above.',
    'Both of the above',
    'Both A and B',
    'A and C',
    'Options A and B',
    'Neither of these',
    'All of these are correct',
    'None of the other options',
    'Both',
    'All of the above are true for a sorted list',
    'Either of the above, depending on the list',
  ])('OPTION_ALL_NONE: "%s"', (text) => {
    const check = single((q) => ((q.options[2].text = text), (q.fixedOrder = true)));
    expect(errorCodes(check)).toEqual(['OPTION_ALL_NONE']);
    expect(check.errors[0]!.path).toBe('question.options[2].text');
  });

  it.each([
    'None',
    'Both halves are searched again',
    'All of the items are compared one by one',
    'Neither half can be discarded yet',
    'Points A and B are on the same side of the middle',
    'Search A and B in parallel, then merge',
    'Either half, chosen at random',
    'All three comparisons are repeated',
    'Start above the middle element and move up',
  ])('an option that merely uses such words is fine: "%s"', (text) => {
    expect(single((q) => (q.options[2].text = text)).errors).toEqual([]);
  });

  it('every wrong option of a single-choice question names its misconception; a predict needs none', () => {
    const check = single((q) => delete q.options[2].misconception);
    expect(errorCodes(check)).toEqual(['MISCONCEPTION_MISSING']);
    expect(check.errors[0]!.path).toBe('question.options[2]');
    // The correct option has none, and that is right.
    expect(single(() => undefined).errors).toEqual([]);
    expect(predict(() => undefined).errors).toEqual([]);
  });

  it.each([
    'Correct, well done!',
    'That is incorrect.',
    'No, that is not right.',
    'Not quite. Try again.',
    'Yes, exactly right!',
    'Unfortunately this is wrong.',
    'Good job, that is the right answer.',
    'Sorry, wrong answer. Please try again.',
  ])('FEEDBACK_GENERIC: "%s"', (feedback) => {
    const check = single((q) => (q.options[1].feedback = feedback));
    expect(errorCodes(check)).toEqual(['FEEDBACK_GENERIC']);
    expect(check.errors[0]!.path).toBe('question.options[1].feedback');
    expect(errorCodes(predict((p) => (p.options[1].feedback = feedback)))).toEqual(['FEEDBACK_GENERIC']);
  });

  it.each([
    'No: that half holds values smaller than 50.',
    'Right, because the list is sorted.',
    'Not quite: that would be linear search.',
    'Yes. Sorted order tells you which side it is on.',
  ])('feedback that gives a reason is fine: "%s"', (feedback) => {
    expect(single((q) => (q.options[1].feedback = feedback)).errors).toEqual([]);
  });

  it('two options may not share one piece of feedback', () => {
    const check = single((q) => (q.options[2].feedback = q.options[1].feedback));
    expect(errorCodes(check)).toEqual(['FEEDBACK_GENERIC']);
    expect(check.errors[0]!.message).toBe('Options 2 and 3 have the same feedback.');
  });

  it('the correct option may not stand out by length', () => {
    const lengths = (correct: number, wrong: number[]) =>
      single((q) => {
        q.options[0].text = 'x'.repeat(correct);
        q.options[1].text = 'y'.repeat(wrong[0]!);
        q.options[2].text = 'z'.repeat(wrong[1]!);
      });
    expect(L.correctLengthRatio).toEqual({ warn: 1.25, warnMinCharDiff: 5, error: 1.6, minCharDiff: 20 });
    expect(codes(lengths(40, [40, 30]))).toEqual([]);
    expect(codes(lengths(49, [40, 30]))).toEqual([]);
    expect(warningCodes(lengths(50, [40, 30]))).toEqual(['CORRECT_OPTION_LONGEST']);
    expect(warningCodes(lengths(63, [40, 30]))).toEqual(['CORRECT_OPTION_LONGEST']);
    expect(errorCodes(lengths(64, [40, 30]))).toEqual(['CORRECT_OPTION_LONGEST']);
    // Extreme in proportion but not in characters: a warning at most.
    expect(errorCodes(lengths(30, [12, 12]))).toEqual([]);
    expect(warningCodes(lengths(30, [12, 12]))).toEqual(['CORRECT_OPTION_LONGEST']);
    // Short answers differ in length by chance: "20" against "8" is not a cue.
    expect(codes(lengths(2, [1, 1]))).toEqual([]);
    expect(codes(lengths(6, [3, 2]))).toEqual([]);
    // The cue starts at the limit's own number of characters, not one before it.
    expect(codes(lengths(10 + L.correctLengthRatio.warnMinCharDiff - 1, [10, 10]))).toEqual([]);
    expect(warningCodes(lengths(10 + L.correctLengthRatio.warnMinCharDiff, [10, 10]))).toEqual(['CORRECT_OPTION_LONGEST']);
    // A correct option that is the shortest is no cue either.
    expect(codes(lengths(10, [40, 30]))).toEqual([]);
  });

  it('order items must differ', () => {
    const check = change('s8', (s) => (s.question.items[2] = `  ${s.question.items[0].toUpperCase()}.`));
    expect(errorCodes(check)).toEqual(['ORDER_DUPLICATE']);
    expect(check.errors[0]!.path).toBe('question.items[2]');
  });

  it.each([
    'Which of these is NOT a step of binary search?',
    'All of these happen in one pass EXCEPT:',
    'Which of the following is not true of binary search?',
    'Which statement about binary search is false?',
    "Which of these doesn't binary search need?",
    'Binary search does all of the following except',
  ])('NEGATIVE_STEM: "%s"', (prompt) => {
    const check = single((q) => (q.prompt = prompt));
    expect(check.errors).toEqual([]);
    expect(warningCodes(check)).toEqual(['NEGATIVE_STEM']);
    expect(check.ok).toBe(true);
  });

  it.each([
    'Why can binary search not be trusted on a list that is not sorted?',
    'The list is not sorted. What does binary search do next?',
    'Which half does binary search keep when the middle element is too small?',
    'What happens when the target is not in the list?',
    'No element equals the target. Which value is returned?',
  ])('a prompt that merely contains "not" is fine: "%s"', (prompt) => {
    expect(codes(single((q) => (q.prompt = prompt)))).toEqual([]);
  });

  it('numeric and reflect questions have no option rules to trip over', () => {
    expect(codes(change('s6', (s) => ((s.question.answer = -3.5), (s.question.tolerance = 0.25))))).toEqual([]);
    const draft = exampleDraft();
    draft.outline[3]!.question = 'reflect';
    const s = exampleScene('s4');
    s.question = structuredClone(EXAMPLE_QUESTIONS.reflect);
    expect(codes(checkScene(s, draft))).toEqual([]);
  });
});
