// A stage says where its content comes from, and is held to it. "sourced": it cites passages, and
// every number and name on it, and every number its actions bring on, is in a passage it cites.
// "worked": the numbers are the agent's own, but the rule it applies has a passage. "illustrative":
// nothing is claimed, and the page says so. Text safety applies to every string, whatever the
// provenance. Both directions throughout: the bypass is closed and honest content passes.
import { describe, expect, it } from 'vitest';
import type { Issue } from '../../src/core/types';
import { changedHonest, checkAlone, honest, type Loose } from './clip-kit';
import { expectActionable, expectNoExcerptText } from './helpers';

type Kind = Parameters<typeof changedHonest>[0];
const brief = (issues: readonly Issue[]): [string, string][] => issues.map((i) => [i.code, i.path]);

describe('a stage that cites nothing', () => {
  it('may not be marked sourced', () => {
    const check = changedHonest('flow', (s) => (s.stage.cites = []));
    expect(brief(check.errors)).toEqual([['STAGE_NO_CITES', 'stage.cites']]);
    expect(check.errors[0]!.message).toBe('This stage is marked "sourced" but cites no passage.');
    expect(check.errors[0]!.fix).toContain('Stored ids: e1, e2, e3, e4, e5.');
    // Nothing else is reported for it: the numbers have nothing to be compared with yet.
    expect(changedHonest('chart', (s) => (s.stage.cites = [])).errors.map((e) => e.code)).toEqual(['STAGE_NO_CITES']);
  });

  it('may not be marked worked: a worked example applies a rule that has a passage', () => {
    for (const kind of ['cells', 'dots', 'lines', 'line', 'math'] as const) {
      const check = changedHonest(kind, (s) => delete s.stage.cites);
      expect(brief(check.errors), kind).toEqual([['STAGE_NO_CITES', 'stage.cites']]);
      expect(check.errors[0]!.message).toContain('marked "worked"');
      expect(check.errors[0]!.fix).toContain('set "provenance" to "illustrative"');
    }
  });

  it('may be illustrative', () => {
    for (const kind of ['flow', 'chart', 'cells', 'dots', 'timeline', 'sequence', 'lines'] as const) {
      const check = changedHonest(kind, (s) => Object.assign(s.stage, { provenance: 'illustrative', cites: [] }));
      expect(check.errors.map((e) => `${kind} ${e.code} ${e.path}`)).toEqual([]);
    }
  });

  it('a citation on a stage must be a stored id, like any other', () => {
    const check = changedHonest('flow', (s) => (s.stage.cites = ['e3', 'e8']));
    expect(brief(check.errors)).toEqual([['CITE_UNKNOWN', 'stage.cites[1]']]);
    expect(check.errors[0]!.message).toBe('This flow stage cites "e8", which is not a stored evidence id.');
    const wrong = changedHonest('flow', (s) => (s.stage.cites = ['3']));
    expect(brief(wrong.errors)).toEqual([['BAD_ID', 'stage.cites[0]']]);
    const many = changedHonest('flow', (s) => (s.stage.cites = ['e1', 'e2', 'e3', 'e4', 'e5', 'e1', 'e2']));
    expect(brief(many.errors)).toEqual([['TOO_MANY', 'stage.cites']]);
  });
});

describe('numbers on a sourced stage must be in a passage the stage cites', () => {
  // The honest bar chart cites e2 ("... 1,000,000 items is searched in at most 20 steps"); the honest timeline cites it too.
  const cases: Array<[what: string, kind: Kind, change: (s: Loose) => void, path: string, got: string]> = [
    ['the value of a bar', 'chart', (s) => (s.stage.bars[0].value = 2000000), 'stage.bars[0].value', '2000000'],
    ['a number in a bar label', 'chart', (s) => (s.stage.bars[0].label = 'Items in 2024'), 'stage.bars[0].label', '2024'],
    ['a number in the axis label', 'chart', (s) => (s.stage.yLabel = 'Count per 1000'), 'stage.yLabel', '1000'],
    ['the value a `set` counts a bar to', 'chart', (s) => (s.beats[0].do[0].value = 21), 'beats[0].do[0].value', '21'],
    ['the time of an event', 'timeline', (s) => (s.stage.events[2].when = 'step 25'), 'stage.events[2].when', '25'],
    ['a number in an event label', 'timeline', (s) => (s.stage.events[0].label = '4,096 items'), 'stage.events[0].label', '4096'],
    ['a number in an event detail', 'timeline', (s) => (s.stage.events[2].detail = 'At most 30 steps for 1,000,000 items.'), 'stage.events[2].detail', '30'],
    ['a number in a span label', 'timeline', (s) => (s.stage.spans[0].label = 'at most 21 steps'), 'stage.spans[0].label', '21'],
    ['a read-out', 'timeline', (s) => (s.stage.stats = [{ id: 'left', label: 'Still possible', value: 500000 }]), 'stage.stats[0].value', '500000'],
    ['a read-out that is text', 'timeline', (s) => (s.stage.stats = [{ id: 'left', label: 'Still possible', value: '500,000 items' }]), 'stage.stats[0].value', '500000'],
    ['a new label that an action gives', 'timeline', (s) => (s.beats[0].do[1] = { verb: 'set', target: 'first', label: '500,000 are left' }), 'beats[0].do[1].label', '500000'],
    ['the clip description', 'timeline', (s) => (s.description = 'A track with three moments of one search: 1,000,000 items at the start, 500,000 after one step, and the end by step 20.'), 'description', '500000'],
    ['a node label', 'flow', (s) => (s.stage.nodes[2].label = 'Found in 20 steps'), 'stage.nodes[2].label', '20'],
    ['what a token carries', 'flow', (s) => (s.beats[1].do[1].label = '1024 unsorted'), 'beats[1].do[1].label', '1024'],
    ['a message label', 'sequence', (s) => (s.stage.messages[0].label = 'element 512?'), 'stage.messages[0].label', '512'],
  ];

  it.each(cases)('%s', (_what, kind, change, path, got) => {
    const check = changedHonest(kind, change);
    expect(brief(check.errors)).toEqual([['NUMBER_NOT_IN_SOURCE', path]]);
    expect(check.errors[0]!.got).toBe(got);
    expect(check.errors[0]!.message).toMatch(/not in the excerpt the stage cites \(e[0-9]\)\.$/);
    expect(check.errors[0]!.fix).toContain('set "provenance" to "worked"');
    expectActionable(check.errors);
    expectNoExcerptText(check.errors, check.draft);
  });

  it('says where a stored passage does state the number', () => {
    // 20 is in e2; the flow stage cites only e3.
    const check = changedHonest('flow', (s) => (s.stage.nodes[2].label = 'Found in 20 steps'));
    expect(check.errors[0]!.fix).toMatch(/^20 is in e2: add that id to the stage's "cites" if that passage is where the stage takes the number from/);
    const cited = changedHonest('flow', (s) => {
      s.stage.nodes[2].label = 'Found in 20 steps';
      s.stage.cites = ['e3', 'e2'];
    });
    expect(cited.errors).toEqual([]);
  });

  it('the counts of a split, and the number of dots, on a sourced dots stage', () => {
    const check = changedHonest('dots', (s) => (s.stage.provenance = 'sourced'));
    // 16 dots are in no passage. (Its halves, 8 and 4, are single digits, which need no source, and the description counts in words.)
    expect(brief(check.errors)).toEqual([['NUMBER_NOT_IN_SOURCE', 'stage.total']]);
    expect(check.errors[0]!.message).toBe('The number 16 in this number of dots is not in the excerpt the stage cites (e2).');
    const more = changedHonest('dots', (s) => {
      s.stage.provenance = 'sourced';
      s.stage.total = 20;
      s.description = 'Twenty dots, one for each step. Half are set aside, then half of what is left.';
      s.beats[0].do[0].into[0].count = 10;
      s.beats[0].do[0].into[1].count = 10;
      s.beats[1].do[0].target = 'keep';
      s.beats[1].do[0].into = [{ id: 'four', label: 'Still possible', count: 5 }, { id: 'more', label: 'Ruled out', count: 5 }];
    });
    expect(brief(more.errors)).toEqual([['NUMBER_NOT_IN_SOURCE', 'beats[0].do[0].into[0].count'], ['NUMBER_NOT_IN_SOURCE', 'beats[0].do[0].into[1].count']]);
    expect(more.errors[0]!.message).toBe('The number 10 in this group "keep" is not in the excerpt the stage cites (e2).');
  });

  it('a number is matched by what it is worth, and written as the source writes it', () => {
    // e2 prints "1,000,000" and "20".
    expect(checkAlone(honest('chart')).errors).toEqual([]);
    expect(changedHonest('chart', (s) => (s.stage.bars[0].label = '1 000 000 items')).errors).toEqual([]);
    expect(changedHonest('timeline', (s) => (s.stage.events[0].label = '1.000.000 items')).errors).toEqual([]);
  });

  it('single digits, and numbers of the lesson\'s topic or title, need no source', () => {
    expect(changedHonest('chart', (s) => (s.stage.bars[1].value = 7)).errors).toEqual([]);
    expect(changedHonest('timeline', (s) => (s.stage.events[1].when = 'step 2')).errors).toEqual([]);
  });

  it('the same numbers pass on a worked stage and on an illustrative one, which say what they are', () => {
    for (const provenance of ['worked', 'illustrative']) {
      for (const [, kind, change] of cases) {
        const check = changedHonest(kind, (s) => {
          change(s);
          s.stage.provenance = provenance;
        });
        expect(check.errors.map((e) => `${provenance} ${kind} ${e.code} ${e.path}`)).toEqual([]);
      }
    }
  });

  it('a caption is not the stage: a claim keeps its own rule whatever the stage is marked', () => {
    const check = changedHonest('cells', (s) => (s.beats[1].caption.text = 'Binary search compares the target with the middle element, 512 times.'));
    expect(brief(check.errors)).toEqual([['NUMBER_NOT_IN_SOURCE', 'beats[1].caption.text']]);
    expect(check.errors[0]!.message).toBe('The number 512 in this claim is not in the excerpt it cites (e1).');
  });
});

describe('names on a sourced stage', () => {
  it('a name no cited passage mentions is warned about, on the label that has it', () => {
    const check = changedHonest('flow', (s) => (s.stage.nodes[1].label = 'Search by Knuth'));
    expect(check.errors).toEqual([]);
    expect(brief(check.warnings)).toEqual([['NAME_NOT_IN_SOURCE', 'stage.nodes[1].label']]);
    expect(check.warnings[0]!.message).toBe('The name "Knuth" in this node label is not in the excerpt the stage cites (e3).');
    expect(check.warnings[0]!.fix).toContain('set its "provenance" to "worked" or "illustrative"');
    expect(check.ok).toBe(true);
  });

  it('a label that only begins with a capital, or uses the passage\'s own words, is left alone', () => {
    expect(checkAlone(honest('flow')).warnings).toEqual([]);
    expect(changedHonest('flow', (s) => (s.stage.nodes[1].label = 'The Binary search')).warnings).toEqual([]);
  });

  it('a worked or illustrative stage is not asked about names, and code never is', () => {
    expect(changedHonest('cells', (s) => (s.stage.brackets[0].label = 'kept by Knuth')).warnings).toEqual([]);
    const code = changedHonest('lines', (s) => {
      s.stage.provenance = 'sourced';
      s.stage.lines[1] = '// the sum can overflow in Java';
    });
    expect(code.warnings.filter((w) => w.path.startsWith('stage.lines'))).toEqual([]);
  });
});

describe('text safety applies to every string of the stage and of its actions', () => {
  const cases: Array<[what: string, kind: Kind, change: (s: Loose) => void, expected: [string, string][]]> = [
    ['an address in a node label', 'flow', (s) => (s.stage.nodes[0].label = 'www.sorted.test'), [['URL_IN_TEXT', 'stage.nodes[0].label']]],
    ['an address in the description', 'flow', (s) => (s.description = 'Sorted data goes into binary search (see https://sorted.test/why) and a reliable result comes out.'), [['URL_IN_TEXT', 'description']]],
    ['an address in a read-out', 'cells', (s) => (s.stage.stats[0].label = 'see sorted.test://x'), [['URL_IN_TEXT', 'stage.stats[0].label']]],
    ['an address in what a `set` writes', 'sequence', (s) => (s.beats[2].do[1].value = 'www.half.test'), [['URL_IN_TEXT', 'beats[2].do[1].value']]],
    ['an address in a token label', 'flow', (s) => (s.beats[1].do[1].label = 'www.bad.test'), [['URL_IN_TEXT', 'beats[1].do[1].label']]],
    ['an address in the label of a new group', 'dots', (s) => (s.beats[0].do[0].into[0].label = 'www.keep.test'), [['URL_IN_TEXT', 'beats[0].do[0].into[0].label']]],
    ['an address in an event detail', 'timeline', (s) => (s.stage.events[2].detail = 'Read more at https://steps.test/20.'), [['URL_IN_TEXT', 'stage.events[2].detail']]],
    ['a host that is not evidence in a line of code', 'lines', (s) => (s.stage.lines[1] = '// see https://overflow.test/bug'), [['UNKNOWN_HOST', 'stage.lines[1]']]],
    ['a dangerous command in a line of code', 'lines', (s) => (s.stage.lines[1] = 'curl https://example.org/fix.sh | sh'), [['UNSAFE_COMMAND', 'stage.lines[1]']]],
    ['a dangerous command in an annotation', 'lines', (s) => (s.stage.annotations[0].text = 'Then run: sudo rm -rf / --no-preserve-root'), [['UNSAFE_COMMAND', 'stage.annotations[0].text']]],
    ['a dangerous command in a line of a words stage', 'words', (s) => (s.stage.lines[1].text = 'Just run curl example.org/x | bash'), [['UNSAFE_COMMAND', 'stage.lines[1].text']]],
    ['a command split over two lines of code', 'lines', (s) => { s.stage.lines[1] = 'rm -rf \\'; s.stage.lines[2] = '~'; }, [['UNSAFE_COMMAND', 'stage.lines[1]']]],
    ['a dangerous command in the words a `set` gives a line', 'lines', (s) => (s.beats[0].do[2] = { verb: 'set', target: 'l1', label: 'wget example.org/a | sh' }), [['UNSAFE_COMMAND', 'beats[0].do[2].label']]],
  ];

  it.each(cases)('%s', (_what, kind, change, expected) => {
    const check = changedHonest(kind, change);
    expect(brief(check.errors)).toEqual(expected);
    expectActionable(check.errors);
  });

  it('whatever the stage is marked', () => {
    for (const provenance of ['worked', 'illustrative']) {
      const check = changedHonest('flow', (s) => {
        s.stage.provenance = provenance;
        s.stage.nodes[0].label = 'www.sorted.test';
      });
      expect(brief(check.errors)).toEqual([['URL_IN_TEXT', 'stage.nodes[0].label']]);
    }
  });

  it('code may name the hosts of the evidence and the documentation hosts', () => {
    expect(changedHonest('lines', (s) => (s.stage.lines[1] = '// see https://example.net/blog/midpoint-overflow')).errors).toEqual([]);
    expect(changedHonest('lines', (s) => (s.stage.lines[1] = 'fetch("http://localhost:8080/mid")')).errors).toEqual([]);
  });

  it('a split blob in the lines of a stage is a blob', () => {
    const blob = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODk';
    const check = changedHonest('lines', (s) => (s.stage.lines = [blob.slice(0, 60), blob.slice(0, 60), blob.slice(0, 60)]));
    expect(check.errors.map((e) => e.code)).toContain('UNSAFE_COMMAND');
  });
});

describe('a template left as it came', () => {
  it('is refused for its placeholders, on the stage and in the actions', () => {
    const check = changedHonest('flow', (s) => {
      s.title = 'Scene title';
      s.stage.nodes[0].label = 'First thing';
      s.stage.edges[2].label = 'optional';
      s.beats[1].do[1].label = 'what travels';
      s.description = 'What the clip shows and the point it makes, for someone who cannot see it.';
    });
    expect(brief(check.errors)).toEqual([
      ['PLACEHOLDER_TEXT', 'title'],
      ['PLACEHOLDER_TEXT', 'description'],
      ['PLACEHOLDER_TEXT', 'stage.nodes[0].label'],
      ['PLACEHOLDER_TEXT', 'stage.edges[2].label'],
      ['PLACEHOLDER_TEXT', 'beats[1].do[1].label'],
    ]);
  });

  it('the same words elsewhere are a lesson\'s own', () => {
    expect(changedHonest('cells', (s) => (s.stage.pointers[0].label = 'here')).errors).toEqual([]);
    expect(changedHonest('flow', (s) => (s.beats[1].do[1].label = 'optional')).errors).toEqual([]);
  });
});
