// Numbers. A number in a lesson is a fact, so it has to rest on a source; but a lesson about
// "Python 3.13" or "the 80/20 rule" must be able to say its own name. Both directions are tested:
// honest text passes, and a number nobody sourced is refused wherever it is put.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_FIGURES } from '../../src/core/examples';
import { LIMITS as L } from '../../src/core/limits';
import type { FigureType } from '../../src/core/schema';
import { sourceNumberTokens } from '../../src/core/text';
import type { Draft } from '../../src/core/types';
import { checkLesson, checkScene } from '../../src/core/validate';
import { buildEvidence, buildLesson, evidenceNumber } from './build';
import { assemble, errorCodes, exampleDraft, exampleScene, saveEvidence, submit } from './helpers';

/** Topics whose names contain digits. Each must be teachable without any source stating its number. */
const DIGIT_TOPICS = [
  'Web3',
  'COVID-19',
  'Python 3.13',
  'ES2015',
  '9/11',
  '401(k)',
  'Catch-22',
  'K-12',
  'Area 51',
  'HTTP/2',
  'the 80/20 rule',
  'Windows 2000',
  'RFC 2119',
  '1984 the novel',
  'HTTP 404 errors',
  'SHA-256',
  'UTF-16',
  'base64 encoding',
  'x86-64 assembly',
  'IPv6 addressing',
  'ISO 8601 dates',
  'the Y2K38 problem',
  'IEEE 754 floating point',
  'Why 0.1 + 0.2 is not 0.3',
  'C++20 concepts',
  'OAuth 2.0',
  'TLS 1.3',
  'WCAG 2.2',
  'USB 3.2',
  '802.11ax Wi-Fi',
  'the 1920s',
  'the 2008 financial crisis',
  'World War 2',
  'Apollo 13',
  'the 100 Years War',
  'Route 66',
  'Fahrenheit 451',
  'Section 230',
  'the Boeing 747',
  'Formula 1 tyres',
  'Type 2 diabetes',
  'Vitamin B12',
  'CO2 and the greenhouse effect',
  'the G20',
  'Agenda 2030',
  '24/7 services',
  'a 360-degree review',
  '4K and 8K video',
  '5G networks',
  'the 12-bar blues',
  'the 4-7-8 breathing method',
  '1,000,000 digits of pi',
  'the 1 000 000 dollar question',
  'the 13th Amendment',
  '21st century skills',
  'Ed25519 signatures',
  'Level 3 heading styles in CSS 2.1',
  'the 3-2-1 backup rule',
  'Top 10 lists and the number 10',
  '٣٦٥ days: why a year has 365 days',
];

function minimal(topic: string, framing: string, title?: string): Draft {
  return assemble(buildLesson({ depth: 'quick', size: 'min', topic, framing, ...(title ? { title } : {}) }));
}

describe('a lesson may say the numbers in its own topic', () => {
  it('lists at least 50 digit-bearing topics, each really containing a number that would need a source', () => {
    expect(DIGIT_TOPICS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(DIGIT_TOPICS).size).toBe(DIGIT_TOPICS.length);
    // The reading a topic is given: every number a lesson may repeat from it.
    for (const topic of DIGIT_TOPICS) expect(sourceNumberTokens(topic).length, topic).toBeGreaterThan(0);
    // Most of them carry a number of two digits or more, which is what the exemption is for.
    expect(DIGIT_TOPICS.filter((t) => sourceNumberTokens(t).some((n) => n.length > 1)).length).toBeGreaterThanOrEqual(45);
  });

  it.each(DIGIT_TOPICS)('"%s" as the topic, named in a framing block', (topic) => {
    const draft = minimal(topic, `Today you meet ${topic}.`);
    const report = checkLesson(draft);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.lesson!.topic).toBe(draft.topic);
  });

  it.each(DIGIT_TOPICS.filter((t) => t.length <= 44))('"%s" in the lesson title only, named in a scene title and an analogy', (topic) => {
    const parts = buildLesson({ depth: 'quick', size: 'min', title: `${topic}, from the start` });
    const scene = parts.scenes[0] as any;
    scene.title = `Meet ${topic}`;
    scene.blocks.push({ type: 'analogy', text: `Think of ${topic} as a familiar tool with a new name.`, limits: `Unlike a tool, ${topic} cannot be put down.` });
    const report = checkLesson(assemble(parts));
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('exempts the topic\'s numbers and no others', () => {
    const cases: Array<[topic: string, framing: string, missing: string | null]> = [
      ['Python 3.13', 'Python 3.13 is the version we use.', null],
      ['Python 3.13', 'Python 3.14 is the version we use.', '3.14'],
      ['Python 3.13', 'It has 313 new features.', '313'],
      ['COVID-19', 'COVID-19 spread quickly.', null],
      ['COVID-19', 'COVID-19 reached 190 countries.', '190'],
      ['the 80/20 rule', 'The 80/20 rule says 80 percent comes from 20 percent.', null],
      ['the 80/20 rule', 'The 80/20 rule says 90 percent is wasted.', '90'],
      ['1,000,000 digits of pi', 'How would you store 1 000 000 digits?', null],
      ['1,000,000 digits of pi', 'How would you store 1000000 digits?', null],
      ['1,000,000 digits of pi', 'How would you store 2,000,000 digits?', '2000000'],
      ['Windows 2000', 'Windows 2000 came after Windows 98.', '98'],
    ];
    for (const [topic, framing, missing] of cases) {
      const parts = buildLesson({ depth: 'quick', size: 'min', topic, framing });
      const draft = assemble({ ...parts, scenes: [] });
      const check = checkScene(parts.scenes[0], draft);
      if (missing === null) {
        expect(check.errors, `${topic}: ${framing}`).toEqual([]);
      } else {
        expect(errorCodes(check), `${topic}: ${framing}`).toEqual(['NUMBER_UNGROUNDED']);
        expect(check.errors[0]!.got).toBe(missing);
        expect(check.errors[0]!.path).toBe('blocks[0].text');
      }
    }
  });
});

describe('where a number needs a source, and where it does not', () => {
  const figureScene = (type: FigureType, change: (figure: any) => void, prepare?: (draft: Draft) => void) => {
    const draft = exampleDraft();
    draft.outline[1]!.figure = type;
    prepare?.(draft);
    const scene = exampleScene('s2');
    scene.figure = structuredClone(EXAMPLE_FIGURES[type]);
    change(scene.figure);
    return checkScene(scene, draft);
  };
  const one = (id: string, change: (s: any) => void) => {
    const s = exampleScene(id);
    change(s);
    return checkScene(s, exampleDraft());
  };

  // 777 is in no example excerpt; 20 and 1,000,000 are in e2, which s1 and s3 do not cite.
  const UNCITED: Array<[what: string, path: string, run: (n: string) => ReturnType<typeof checkScene>]> = [
    ['framing', 'blocks[0].text', (n) => one('s1', (s) => (s.blocks[0].text = `Why would ${n} names be easy to search?`))],
    ['analogy text', 'blocks[2].text', (n) => one('s1', (s) => (s.blocks[2].text = `A dictionary of ${n} pages is searched the same way.`))],
    ['analogy limits', 'blocks[2].limits', (n) => one('s1', (s) => (s.blocks[2].limits = `A reader opens near page ${n} by feel, not by rule.`))],
    ['scene title', 'title', (n) => one('s1', (s) => (s.title = `One name in ${n}`))],
    ['step title', 'steps[0].title', (n) => one('s3', (s) => (s.steps[0].title = `Start with ${n} items`))],
    ['intro', 'intro', (n) => one('s3', (s) => (s.intro = `Watch the ${n} positions shrink.`))],
    ['recap title', 'title', (n) => one('s9', (s) => (s.title = `${n} things you can do now`))],
  ];

  it.each(UNCITED)('%s: a number in no excerpt is refused at %s', (_what, path, run) => {
    const check = run('777');
    expect(errorCodes(check)).toEqual(['NUMBER_UNGROUNDED']);
    expect(check.errors[0]).toMatchObject({ path, got: '777' });
    expect(check.errors[0]!.fix).toMatch(/State it in a claim that cites its source, or remove it/);
  });

  it.each(UNCITED)('%s: a number that some stored excerpt states is accepted', (_what, _path, run) => {
    expect(run('1,000,000').errors).toEqual([]);
    expect(run('20').errors).toEqual([]);
  });

  it.each(UNCITED)('%s: single digits and ordinals need no source', (_what, _path, run) => {
    expect(run('7').errors).toEqual([]);
    expect(run('3rd').errors).toEqual([]);
  });

  // A figure is read as fact, and every part of it is held to the passages the figure itself cites.
  const FIGURE: Array<[what: string, path: string, type: FigureType, change: (f: any, n: string) => void]> = [
    ['figure caption', 'figure.caption', 'flow', (f, n) => (f.caption = `The loop runs ${n} times at most.`)],
    ['figure description', 'figure.description', 'flow', (f, n) => (f.description = `${f.description} It repeats up to ${n} times.`)],
    ['node label', 'figure.nodes[0].label', 'flow', (f, n) => (f.nodes[0].label = `A list of ${n} names`)],
    ['node detail', 'figure.nodes[0].detail', 'flow', (f, n) => (f.nodes[0].detail = `${n} items to begin with`)],
    ['edge label', 'figure.edges[0].label', 'flow', (f, n) => (f.edges[0].label = `up to ${n} times`)],
    ['actor label', 'figure.actors[0].label', 'sequence', (f, n) => (f.actors[0].label = `${n} callers`)],
    ['message label', 'figure.messages[0].label', 'sequence', (f, n) => (f.messages[0].label = `find one of ${n}`)],
    ['layer label', 'figure.layers[0].label', 'layers', (f, n) => (f.layers[0].label = `All ${n} elements`)],
    ['layer detail', 'figure.layers[0].detail', 'layers', (f, n) => (f.layers[0].detail = `${n} elements at the start`)],
    ['timeline when', 'figure.events[0].when', 'timeline', (f, n) => (f.events[0].when = `after ${n} ms`)],
    ['timeline label', 'figure.events[1].label', 'timeline', (f, n) => (f.events[1].label = `${n} items are left`)],
    ['timeline detail', 'figure.events[2].detail', 'timeline', (f, n) => (f.events[2].detail = `Only ${n} items remain to be searched.`)],
    ['compare cell', 'figure.rows[1].cells[0]', 'compare', (f, n) => (f.rows[1].cells[0] = `Up to ${n} comparisons`)],
    ['compare row label', 'figure.rows[0].label', 'compare', (f, n) => (f.rows[0].label = `Works for ${n} items?`)],
    ['compare column label', 'figure.columns[1].label', 'compare', (f, n) => (f.columns[1].label = `Binary, ${n} items`)],
    ['compare row heading', 'figure.rowHeading', 'compare', (f, n) => (f.rowHeading = `For ${n} items`)],
  ];
  const withCites = (type: FigureType, change: (f: any, n: string) => void, n: string, cites: string[]) =>
    figureScene(type, (f) => {
      change(f, n);
      f.cites = cites;
    });

  it.each(FIGURE)('%s: a number in no excerpt is refused at %s', (_what, path, type, change) => {
    const check = withCites(type, change, '777', ['e1']);
    expect(errorCodes(check)).toEqual(['NUMBER_NOT_IN_SOURCE']);
    expect(check.errors[0]).toMatchObject({ path, got: '777' });
    expect(check.errors[0]!.message).toContain('not in the excerpt the figure cites (e1)');
    // The way out is the sourced passage, cited from the figure, or a symbol in place of the number.
    expect(check.errors[0]!.fix).toMatch(/save that passage with save_evidence and add its id to the figure's "cites".*write a symbol such as n or x, or a single digit/);
  });

  it.each(FIGURE)('%s: a number that a stored excerpt states is refused while the figure does not cite that excerpt', (_what, path, type, change) => {
    // The trials: a table showed two numbers whose only source was a passage the figure did not cite.
    const check = withCites(type, change, '1,000,000', ['e1']);
    expect(errorCodes(check)).toEqual(['NUMBER_NOT_IN_SOURCE']);
    expect(check.errors[0]).toMatchObject({ path, got: '1000000' });
    expect(check.errors[0]!.fix).toContain(`1000000 is in e2: add that id to the figure's "cites"`);
    expect(check.errors[0]!.fix).toContain(`a figure may cite up to ${L.citesPerFigure} passages`);
  });

  it.each(FIGURE)('%s: the same number is accepted once the figure cites the excerpt that states it', (_what, _path, type, change) => {
    expect(withCites(type, change, '1,000,000', ['e1', 'e2']).errors).toEqual([]);
    expect(withCites(type, change, '20', ['e2']).errors).toEqual([]);
  });

  it.each(FIGURE)('%s: single digits and ordinals need no source', (_what, _path, type, change) => {
    expect(withCites(type, change, '7', ['e1']).errors).toEqual([]);
    expect(withCites(type, change, '3rd', ['e1']).errors).toEqual([]);
  });

  it('a figure may cite up to six passages, and is told when it has no room for another', () => {
    const draft = exampleDraft();
    for (let i = 0; i < 2; i++) saveEvidence(draft, buildEvidence(i));
    draft.outline[1]!.figure = 'compare';
    const scene = exampleScene('s2');
    scene.figure = structuredClone(EXAMPLE_FIGURES.compare);
    scene.figure.rows[1].cells[0] = `Up to ${evidenceNumber(1)} comparisons`;
    scene.figure.cites = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'];
    const full = checkScene(scene, draft);
    expect(errorCodes(full)).toEqual(['NUMBER_NOT_IN_SOURCE']);
    expect(full.errors[0]!.fix).toContain('e7');
    expect(full.errors[0]!.fix).toContain('this one already does, so take out one it does not draw on');
    scene.figure.cites = ['e1', 'e2', 'e3', 'e4', 'e5', 'e7'];
    expect(checkScene(scene, draft).errors).toEqual([]);
    scene.figure.cites = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'];
    expect(errorCodes(checkScene(scene, draft))).toEqual(['TOO_MANY']);
  });

  it('a number of the lesson\'s topic or title may stand in a figure without a source', () => {
    const draft = exampleDraft();
    draft.topic = 'Binary search over 4,096 items';
    draft.outline[1]!.figure = 'flow';
    const scene = exampleScene('s2');
    scene.figure.nodes[0].label = 'A sorted list of 4,096 items';
    expect(checkScene(scene, draft).errors).toEqual([]);
  });

  const EXEMPT: Array<[what: string, run: () => ReturnType<typeof checkScene>]> = [
    ['an example block', () => one('s5', (s) => (s.blocks[2].text = 'Doubling from 5,120 to 10,240 items adds one comparison; 777 more would add none.'))],
    ['a lines figure', () => one('s3', (s) => (s.figure.lines[1] = '    low, high = 0, 99999'))],
    ['the description of a lines figure', () => one('s3', (s) => (s.figure.description = `${s.figure.description} It is 11 lines long and handles 777 items.`))],
    ['an illustrative chart', () => one('s5', (s) => (s.figure.series[0].values = [8, 64, 512, 77777]))],
    ['the caption of an illustrative chart', () => one('s5', (s) => (s.figure.caption = 'From 8 to 4,096 items, a difference of 777 times.'))],
    // The text alternative of an illustrative chart has to be able to say what the shape does.
    ['the description of an illustrative chart', () => one('s5', (s) => (s.figure.description = 'A line chart of the window size over time: it doubles to 16, then is cut to 8, and climbs by 1 to 24.'))],
    ['the axes, x labels and series labels of an illustrative chart', () => one('s5', (s) => {
      s.figure.xLabel = 'Items in the list (8 to 16,384)';
      s.figure.xs[3].label = '16,384';
      s.figure.series[1].label = 'Binary (at most 15)';
    })],
    ['a step state', () => one('s3', (s) => (s.steps[0].state[0].value = '77777'))],
    ['a predict prompt and its options', () => one('s3', (s) => {
      s.steps[2].predict.prompt = '23 is less than 42. Out of 777 positions, which can go?';
      s.steps[2].predict.options[1].feedback = 'Those 388 values are 23 or larger, so 42 must be among them.';
    })],
    ['a checkpoint, from title to explanation', () => one('s4', (s) => {
      s.title = 'Check: which half of 777?';
      s.question.prompt = 'You search a sorted list of 777 items for 70. The middle element is 50. What next?';
      s.question.options[0].feedback = 'Right: 70 is greater than 50, so only the later 388 can hold it.';
      s.question.hint = 'There are 777 items. Where do values larger than 50 live?';
    })],
    ['a numeric question', () => one('s6', (s) => {
      s.question.prompt = 'A sorted list has 4,096 items. At most how many comparisons does binary search need?';
      s.question.answer = 13;
    })],
    ['the practice task and next topics of a recap', () => one('s9', (s) => {
      s.practice.task = 'Write binary search from memory and test it on a list of 1,024 items and a list of 777.';
      s.next[0].topic = 'Big-O notation in 15 minutes';
      s.next[0].why = 'To say precisely why 4,096 items need only 13 comparisons.';
    })],
    ['a code span', () => one('s1', (s) => (s.blocks[0].text = 'What does `range(0, 777)` have to do with finding a name?'))],
    ['a math span', () => one('s1', (s) => (s.blocks[0].text = 'Why is $2^{20}$ just over $1000000$?'))],
    ['a quote, whose numbers are the source\'s own', () => {
      const draft = exampleDraft();
      const s = exampleScene('s5');
      s.blocks[1] = { type: 'quote', text: 'A sorted list of 1,000,000 items is searched in at most 20 steps.', cite: 'e2' };
      return checkScene(s, draft);
    }],
  ];

  it.each(EXEMPT)('%s is the agent\'s own working or an interaction, and is not checked', (_what, run) => {
    const check = run();
    expect(check.errors).toEqual([]);
    expect(check.ok).toBe(true);
  });
});

describe('numbers in cited statements must be in the cited excerpts', () => {
  const claim = (text: string, cites: string[] = ['e2']) => {
    const s = exampleScene('s5');
    s.blocks[1] = { type: 'claim', text, cites };
    return checkScene(s, exampleDraft());
  };

  it.each([
    ['as the source writes it', 'A sorted list of 1,000,000 items is searched within 20 comparisons at the very most.'],
    ['without separators', 'A sorted list of 1000000 items is searched within 20 comparisons at the very most.'],
    ['with spaces as separators', 'A sorted list of 1 000 000 items is searched within 20 comparisons at the very most.'],
    ['with dots as separators', 'A sorted list of 1.000.000 items is searched within 20 comparisons at the very most.'],
    ['as part of a formula in the source', 'The remaining interval is halved, so about log2(n) + 1 comparisons are needed.'],
    ['spelled out, with no digits at all', 'A sorted list of a million items is searched within twenty comparisons at the very most.'],
  ])('accepted: %s', (_what, text) => {
    expect(claim(text).errors).toEqual([]);
  });

  it.each([
    ['a number the excerpt does not have', 'A sorted list of a billion items needs at most 30 comparisons, since each comparison halves the interval.', '30'],
    ['the right digits at another scale', 'A sorted list of 10,000,000 items is searched in a few comparisons, as each halves the interval.', '10000000'],
    ['a decimal the source does not write', 'Each comparison leaves 0.50 of the remaining search interval for the next comparison.', '0.50'],
    ['a year', 'Since 1946 each comparison of a binary search halves the remaining search interval.', '1946'],
    ['a percentage', 'Each comparison removes 50% of the remaining search interval of the sorted list.', '50'],
  ])('refused: %s', (_what, text, missing) => {
    const check = claim(text);
    expect(errorCodes(check)).toEqual(['NUMBER_NOT_IN_SOURCE']);
    expect(check.errors[0]).toMatchObject({ path: 'blocks[1].text', got: missing });
  });

  it('a number found in another stored excerpt is pointed to, without saying to cite it blindly', () => {
    // 20 and 1,000,000 are in e2; the claim cites e5 only.
    const check = claim('Linear search needs up to n comparisons, so 1,000,000 elements may take far more than 20.', ['e5']);
    expect(errorCodes(check)).toEqual(['NUMBER_NOT_IN_SOURCE']);
    expect(check.errors[0]!.got).toBe('1000000, 20');
    expect(check.errors[0]!.fix).toContain('1000000 is in e2');
    expect(check.errors[0]!.fix).toContain('only if that passage is what supports this statement');
    // Citing both makes it pass, because then the number is in a cited excerpt.
    expect(claim('Linear search needs up to n comparisons, so 1,000,000 elements may take far more than 20.', ['e5', 'e2']).errors).toEqual([]);
  });

  it('a recap takeaway is held to the same rule', () => {
    const s = exampleScene('s9');
    s.takeaways[1].text = 'Each comparison halves the interval, so 1,000,000 items need at most 20 steps, or 40 for a list twice as big.';
    const check = checkScene(s, exampleDraft());
    expect(errorCodes(check)).toEqual(['NUMBER_NOT_IN_SOURCE']);
    expect(check.errors[0]).toMatchObject({ path: 'takeaways[1].text', got: '40' });
  });

  it('a sourced chart may only draw what its excerpts state', () => {
    const chart = (change: (f: any) => void) => {
      const s = exampleScene('s5');
      s.figure = { ...s.figure, data: 'sourced', xs: [{ id: 'small', label: 'Small list' }, { id: 'big', label: '1,000,000 items' }], series: [{ id: 'binary', label: 'Binary search', values: [5, 20] }], cites: ['e2'], description: 'A bar chart of the comparisons that binary search needs for a small list and for a large one.' };
      delete s.figure.caption;
      change(s.figure);
      return checkScene(s, exampleDraft());
    };
    expect(chart(() => undefined).errors).toEqual([]);

    const values = chart((f) => (f.series[0].values = [5, 21]));
    expect(errorCodes(values)).toEqual(['NUMBER_NOT_IN_SOURCE']);
    expect(values.errors[0]).toMatchObject({ path: 'figure.series[0].values', got: '21' });
    expect(values.errors[0]!.fix).toContain('"illustrative"');

    const label = chart((f) => (f.xs[1].label = '2,000,000 items'));
    expect(errorCodes(label)).toEqual(['NUMBER_NOT_IN_SOURCE']);
    expect(label.errors[0]).toMatchObject({ path: 'figure.xs[1].label', got: '2000000' });

    // Every other part of a sourced chart is held to the same passages: axes, series, caption, description.
    for (const [path, change] of [
      ['figure.xLabel', (f: any) => (f.xLabel = 'Items (up to 2,000,000)')],
      ['figure.yLabel', (f: any) => (f.yLabel = 'Comparisons out of 2,000,000')],
      ['figure.series[0].label', (f: any) => (f.series[0].label = 'Binary, 2,000,000 items')],
      ['figure.caption', (f: any) => (f.caption = 'Even 2,000,000 items need few comparisons.')],
      ['figure.description', (f: any) => (f.description = `${f.description} It stops at 2,000,000 items.`)],
    ] as const) {
      const part = chart(change);
      expect(errorCodes(part), path).toEqual(['NUMBER_NOT_IN_SOURCE']);
      expect(part.errors[0], path).toMatchObject({ path, got: '2000000' });
      expect(part.errors[0]!.fix, path).toContain('set "data" to "illustrative"');
    }
    expect(chart((f) => (f.caption = 'Even 1,000,000 items need at most 20 comparisons.')).errors).toEqual([]);

    // A value is matched by what it is worth: 1000000 finds "1,000,000", and a sign is not part of it.
    expect(chart((f) => (f.series[0].values = [-20, 1000000])).errors).toEqual([]);
    // The same chart marked illustrative may draw anything, and is labelled as such for the learner.
    expect(chart((f) => Object.assign(f, { data: 'illustrative', series: [{ id: 'binary', label: 'Binary search', values: [5, 21.5] }] })).errors).toEqual([]);
  });

  it('a decimal value in a sourced chart finds the same amount written with trailing zeros', () => {
    const draft = exampleDraft();
    draft.evidence[1] = { ...draft.evidence[1]!, excerpt: 'The median response took 2.50 seconds in the first trial and 1,200 milliseconds in the second.' };
    const s = exampleScene('s5');
    s.blocks = [{ type: 'claim', text: 'The median response fell between the first trial and the second trial.', cites: ['e2'] }];
    s.figure = { type: 'chart', mark: 'bar', data: 'sourced', xLabel: 'Trial', yLabel: 'Median response', xs: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }], series: [{ id: 'median', label: 'Median', values: [2.5, 1200] }], cites: ['e2'], description: 'Two bars: the median response in the first trial and in the second trial.' };
    expect(checkScene(s, draft).errors).toEqual([]);
  });
});

describe('what the lesson publishes is what its numbers rest on', () => {
  it('a number grounded only in an excerpt the lesson never cites is refused once the lesson is whole', () => {
    const draft = exampleDraft();
    // e6 is stored but nothing cites it.
    draft.evidence.push({ ...draft.evidence[0]!, id: 'e6', url: 'https://example.org/history', excerpt: 'The method was first described in 1946, though a correct version took much longer to appear.' });
    const s = exampleScene('s1');
    s.blocks[0].text = 'How has one idea from 1946 kept its place for so long?';
    const accepted = submit(draft, s);
    // While scenes are still being written, any stored excerpt will do.
    expect(accepted.errors).toEqual([]);

    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['NUMBER_UNGROUNDED']);
    expect(report.errors[0]).toMatchObject({ sceneId: 's1', path: 'blocks[0].text', got: '1946' });
    expect(report.errors[0]!.fix).toContain('1946 is in e6, which the lesson never cites');

    // Citing it where it supports a statement resolves it, and e6 is then published.
    const s7 = exampleScene('s7');
    s7.blocks.push({ type: 'claim', text: 'The method was first described long before a correct version appeared.', cites: ['e6'] });
    expect(submit(draft, s7).errors).toEqual([]);
    const fixed = checkLesson(draft);
    expect(fixed.errors).toEqual([]);
    expect(fixed.lesson!.evidence.map((e) => e.id)).toContain('e6');
  });
});
