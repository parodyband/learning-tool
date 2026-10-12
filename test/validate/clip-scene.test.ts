// checkScene on clips: honest clips of every stage kind pass, and each rule is tried in both
// directions on a clip that is otherwise accepted. The captions of a clip are blocks, so the block
// rules are shown to apply to them unchanged, at the path of the beat.
import { describe, expect, it } from 'vitest';
import { CLIP_LIMITS as C, STAGE_KINDS } from '../../src/core/clip';
import { EXAMPLE_EVIDENCE } from '../../src/core/examples';
import { ISSUES, type IssueCode } from '../../src/core/issues';
import { LIMITS as L } from '../../src/core/limits';
import { countWords } from '../../src/core/text';
import type { Issue } from '../../src/core/types';
import { checkScene } from '../../src/core/validate';
import { HONEST_CLIPS, changedClip, changedHonest, checkAlone, draftAround, honest, plannedClipDraft, clipScene, type Loose } from './clip-kit';
import { errorCodes, expectActionable, expectNoExcerptText, warningCodes } from './helpers';

type Kind = Parameters<typeof changedHonest>[0];
const brief = (issues: readonly Issue[]): [string, string][] => issues.map((i) => [i.code, i.path]);
const words = (n: number, word = 'halves'): string => `${Array.from({ length: n }, () => word).join(' ')}.`;

describe('honest clips', () => {
  it.each(HONEST_CLIPS.map((clip) => [clip.id, clip] as const))('%s is accepted with no error and no warning', (_id, clip) => {
    const check = checkAlone(structuredClone(clip));
    expect([...check.errors, ...check.warnings].map((i) => `${i.code} ${i.path}: ${i.message}`)).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('there is one for every stage kind, and for both chart marks and a math stage', () => {
    expect(new Set(HONEST_CLIPS.map((clip) => clip.stage.kind))).toEqual(new Set(STAGE_KINDS));
    expect(HONEST_CLIPS.filter((clip) => clip.stage.kind === 'chart').map((clip) => (clip.stage as Loose).mark).sort()).toEqual(['bars', 'line']);
    expect(HONEST_CLIPS.filter((clip) => clip.stage.kind === 'lines').map((clip) => (clip.stage as Loose).format).sort()).toEqual(['code', 'math']);
  });

  it('what is stored has the defaults applied: `do` on every beat, `cites` on every stage', () => {
    const stored = checkAlone(honest('words')).scene as Loose;
    expect(stored.stage.cites).toEqual([]);
    const frame = checkAlone(honest('frame')).scene as Loose;
    expect(frame.beats.every((beat: Loose) => Array.isArray(beat.do) && beat.do.length === 0)).toBe(true);
    expect(frame.stage).toMatchObject({ aspect: '16:9', params: [] });
  });

  it('text is tidied as it arrives: the lines of a words stage as prose, the lines of code with their indentation', () => {
    const wordsClip = changedHonest('words', (s) => {
      s.title = '  The\n question ';
      s.stage.lines[1].text = '   Look   in the\tmiddle  ';
    });
    expect(wordsClip.errors).toEqual([]);
    expect((wordsClip.scene as Loose).title).toBe('The question');
    expect((wordsClip.scene as Loose).stage.lines[1].text).toBe('Look in the middle');
    const code = changedHonest('lines', (s) => (s.stage.lines[2] = '    int mid = low + (high - low) / 2;   '));
    expect(code.errors).toEqual([]);
    expect((code.scene as Loose).stage.lines[2]).toBe('    int mid = low + (high - low) / 2;');
  });

  it('metrics give the words of each caption, against a budget per beat', () => {
    const check = checkAlone(honest('cells'));
    expect(check.metrics).toEqual({ sceneId: 'h-cells', words: 36, budget: { warn: L.captionWords.warn, max: L.captionWords.max, per: 'beat' }, steps: [7, 9, 10, 10], citedBlocks: 2, uncitedBlocks: 2 });
    // A rejected clip reports its size too, and so does one that does not parse.
    const refused = changedHonest('cells', (s) => (s.beats[1].do[0].target = 'nowhere'));
    expect(refused.ok).toBe(false);
    expect(refused.metrics).toEqual(check.metrics);
    const broken = changedHonest('cells', (s) => (s.colour = 'red'));
    expect(errorCodes(broken)).toEqual(['UNKNOWN_FIELD']);
    expect(broken.metrics).toEqual(check.metrics);
  });
});

describe('a caption is a block: every block rule applies, at the path of the beat', () => {
  const cases: Array<[what: string, kind: Kind, change: (s: Loose) => void, expected: [string, string][]]> = [
    ['a citation that is not stored', 'flow', (s) => (s.beats[0].caption.cites = ['e9']), [['CITE_UNKNOWN', 'beats[0].caption.cites[0]']]],
    ['a quote that is not in its excerpt', 'flow', (s) => (s.beats[1].caption.text = 'the half that is thrown away may hold the target'), [['QUOTE_NOT_FOUND', 'beats[1].caption.text']]],
    ['a quote of three words', 'flow', (s) => (s.beats[1].caption.text = 'may contain the'), [['QUOTE_TOO_SHORT', 'beats[1].caption.text']]],
    ['a claim that shares nothing with its excerpt', 'flow', (s) => (s.beats[0].caption.text = 'Bread rises overnight in a cool kitchen.'), [['CLAIM_UNRELATED', 'beats[0].caption']]],
    ['a number in a claim that its excerpt lacks', 'flow', (s) => (s.beats[0].caption.text = 'Binary search only works when all 5000 items of the data are sorted.'), [['NUMBER_NOT_IN_SOURCE', 'beats[0].caption.text']]],
    ['a number in a framing caption that no excerpt has', 'sequence', (s) => (s.beats[1].caption.text = 'Suppose the middle element, 4096, turns out to be smaller.'), [['NUMBER_UNGROUNDED', 'beats[1].caption.text']]],
    ['an address in a caption', 'sequence', (s) => (s.beats[1].caption.text = 'Suppose the middle element is smaller (see www.sorting.test).'), [['URL_IN_TEXT', 'beats[1].caption.text']]],
    ['a dangerous command in an example caption', 'cells', (s) => (s.beats[0].caption.text = 'To try it, run `curl https://example.org/sort.sh | sh` first.'), [['UNSAFE_COMMAND', 'beats[0].caption.text']]],
    ['math that does not parse', 'math', (s) => (s.beats[1].caption.text = 'Solve $\\\\frac{n}{2^k$ for the number of halvings.'), [['MARKUP_MATH', 'beats[1].caption.text']]],
    ['a placeholder of the template', 'flow', (s) => (s.beats[0].caption.text = 'One fact from a source, in one short line.'), [['PLACEHOLDER_TEXT', 'beats[0].caption.text'], ['CLAIM_UNRELATED', 'beats[0].caption']]],
    ['a claim that copies its excerpt', 'flow', (s) => (s.beats[0].caption.text = EXAMPLE_EVIDENCE[2]!.excerpt.replace('.', ';').slice(0, 150)), [['CLAIM_COPIES_SOURCE', 'beats[0].caption.text'], ['WORDS_OVER_BUDGET', 'beats[0].caption']]],
    ['a caption with two blocks', 'flow', (s) => (s.beats[0].caption = [s.beats[0].caption, s.beats[2].caption]), [['WRONG_TYPE', 'beats[0].caption']]],
    ['a claim caption with `cite`', 'flow', (s) => { s.beats[0].caption.cite = 'e3'; delete s.beats[0].caption.cites; }, [['UNKNOWN_FIELD', 'beats[0].caption.cite']]],
  ];

  it.each(cases)('%s', (_what, kind, change, expected) => {
    const check = changedHonest(kind, change);
    expect(brief(check.errors)).toEqual(expected);
    expect(check.ok).toBe(false);
    expectActionable(check.errors);
    expectNoExcerptText(check.errors, check.draft);
  });

  it('a quote caption is stored in the excerpt\'s own characters', () => {
    const check = changedHonest('flow', (s) => (s.beats[1].caption.text = 'The half that is discarded MAY contain the target'));
    expect(check.errors).toEqual([]);
    expect((check.scene as Loose).beats[1].caption.text).toBe('the half that is discarded may contain the target');
  });

  it('a quote that is not found carries the nearest span as data, never in the message', () => {
    const check = changedHonest('flow', (s) => (s.beats[1].caption.text = 'the half that is thrown away may contain the target'));
    expect(check.errors[0]).toMatchObject({ code: 'QUOTE_NOT_FOUND', sceneId: 'h-flow' });
    expect(check.errors[0]!.source?.evidenceId).toBe('e3');
  });

  it('a name the cited excerpt never mentions is a warning on a claim caption', () => {
    const check = changedHonest('flow', (s) => (s.beats[0].caption.text = 'Binary search only works when the data is sorted, as Knuth wrote.'));
    expect(check.errors).toEqual([]);
    expect(brief(check.warnings)).toEqual([['NAME_NOT_IN_SOURCE', 'beats[0].caption.text']]);
    expect(check.ok).toBe(true);
  });

  it('a claim that barely matches is recorded as weak, under the path the page uses for the caption', () => {
    const draft = draftAround(honest('flow'));
    const clip = honest('flow');
    clip.beats[2].caption.text = 'A result like that sends everybody hunting for mistakes elsewhere.';
    const check = checkScene(clip, draft);
    expect(brief(check.warnings)).toEqual([['CLAIM_WEAK_MATCH', 'beats[2].caption']]);
  });

  it('a clip needs a caption that is a claim or a quote, whatever its stage cites', () => {
    const none = changedHonest('flow', (s) => {
      for (const beat of s.beats) beat.caption = { type: 'framing', text: 'Data goes in and a result comes out.' };
    });
    expect(brief(none.errors)).toEqual([['SCENE_NO_CITED_BLOCK', 'beats']]);
    expect(none.errors[0]!.fix).toContain('whatever its stage cites');
    // One quote is enough.
    const quote = changedHonest('flow', (s) => {
      s.beats[0].caption = { type: 'framing', text: 'Sorted data goes in and a result comes out.' };
      s.beats[2].caption = { type: 'example', text: 'Unsorted data goes in and the answer cannot be trusted.' };
    });
    expect(quote.errors).toEqual([]);
  });
});

describe('caption words', () => {
  const withWords = (n: number): ReturnType<typeof changedHonest> => changedHonest('math', (s) => (s.beats[1].caption.text = words(n)));

  it('is fine at the target, warned above it, refused above the limit', () => {
    expect(L.captionWords).toEqual({ warn: 16, max: 22 });
    expect(countWords(words(16), 'en')).toBe(16);
    expect([...withWords(16).errors, ...withWords(16).warnings]).toEqual([]);
    expect(brief(withWords(17).warnings)).toEqual([['WORDS_NEAR_BUDGET', 'beats[1].caption']]);
    expect(withWords(17).ok).toBe(true);
    expect(brief(withWords(22).warnings)).toEqual([['WORDS_NEAR_BUDGET', 'beats[1].caption']]);
    expect(withWords(22).errors).toEqual([]);
    const over = withWords(23);
    expect(brief(over.errors)).toEqual([['WORDS_OVER_BUDGET', 'beats[1].caption']]);
    expect(over.errors[0]).toMatchObject({ got: '23', expected: 'at most 22 words' });
    expect(over.errors[0]!.message).toBe('This caption (beat 2) has 23 words; the limit is 22.');
    expect(over.errors[0]!.fix).toBe('Cut at least 1 words. A caption is one short line, read while the picture moves: say only what the picture cannot or split the beat in two (a clip may have up to 8).');
    expect(over.metrics?.steps).toEqual([7, 23]);
  });

  it('counts an analogy with its limits, as it is read', () => {
    const check = changedHonest('math', (s) => (s.beats[1].caption = { type: 'analogy', text: words(12, 'folding').replace('.', ' paper.'), limits: words(6, 'paper') }));
    expect(brief(check.warnings)).toEqual([['WORDS_NEAR_BUDGET', 'beats[1].caption']]);
    expect(check.warnings[0]!.message).toBe('This caption (beat 2) (an analogy is counted with its limits) has 19 words; the target is 16 or fewer (limit 22).');
    expect(check.metrics?.steps).toEqual([7, 19]);
  });

  it('the schema bounds the beats of a clip', () => {
    expect(C.beats).toEqual({ min: 2, max: 8 });
    const one = changedHonest('math', (s) => s.beats.pop());
    expect(brief(one.errors)).toEqual([['TOO_FEW', 'beats']]);
    const nine = changedHonest('words', (s) => (s.beats = Array.from({ length: 9 }, () => s.beats[1])));
    expect(brief(nine.errors)).toEqual([['TOO_MANY', 'beats']]);
    const five = changedHonest('words', (s) => (s.beats[1].do = Array.from({ length: 5 }, () => ({ verb: 'pulse', target: 'ask' }))));
    expect(brief(five.errors)).toEqual([['TOO_MANY', 'beats[1].do']]);
  });
});

describe('a clip moves: at least two thirds of its beats change the picture', () => {
  /** A words clip of `n` beats of which the first `moving` have an action. */
  const clipOf = (n: number, moving: number): ReturnType<typeof changedHonest> =>
    changedHonest('words', (s) => {
      s.beats = Array.from({ length: n }, (_, i) => ({
        caption: i === 0 ? s.beats[0].caption : { type: 'framing', text: 'One more look at the same question.' },
        do: i < moving ? [{ verb: 'pulse', target: 'ask' }] : [],
      }));
    });

  it.each([
    [2, 2], [3, 2], [4, 3], [5, 4], [6, 4], [7, 5], [8, 6],
  ])('of %i beats, %i must', (n, need) => {
    expect(clipOf(n, need).errors).toEqual([]);
    const short = clipOf(n, need - 1);
    expect(brief(short.errors)).toEqual([['CLIP_TOO_STATIC', 'beats']]);
    expect(short.errors[0]).toMatchObject({ got: String(need - 1), expected: `at least ${need}` });
  });

  it('names the still beats and the verbs of the stage', () => {
    const check = clipOf(4, 2);
    expect(check.errors[0]!.message).toBe('2 of the 4 beats of this clip change the picture; at least 3 must (beats 3, 4 have no action).');
    expect(check.errors[0]!.fix).toContain('show, hide, focus, set, pulse');
  });

  it('every beat of a frame clip counts: its picture is its code', () => {
    expect(checkAlone(honest('frame')).errors).toEqual([]);
  });
});

describe('the stage on its own', () => {
  const cases: Array<[what: string, kind: Kind, change: (s: Loose) => void, expected: [string, string][], fix: RegExp]> = [
    ['two parts with one id', 'flow', (s) => (s.stage.edges[2].id = 'in'), [['STAGE_DUPLICATE_ID', 'stage.edges[2].id'], ['ACTION_UNKNOWN_PART', 'beats[2].do[1].along']], /Rename one of them/],
    ['a read-out with the id of a part', 'sequence', (s) => s.stage.stats.push({ id: 'ask', label: 'Asked', value: 0 }), [['STAGE_DUPLICATE_ID', 'stage.stats[1].id']], /read-outs included/],
    ['a part called l2 on a lines stage', 'lines', (s) => s.stage.pointers.push({ id: 'l2', label: 'two' }), [['STAGE_DUPLICATE_ID', 'stage.pointers[1].id']], /Rename the part/],
    ['a part called track on a timeline', 'timeline', (s) => s.stage.markers.push({ id: 'track', label: 'then' }), [['STAGE_DUPLICATE_ID', 'stage.markers[1].id']], /Rename the part/],
    ['a message from an actor that is not there', 'sequence', (s) => (s.stage.messages[1].from = 'arrays'), [['STAGE_UNKNOWN_REF', 'stage.messages[1].from']], /Use "array"\. The actor ids are: search, array\./],
    ['a message from an actor to itself', 'sequence', (s) => (s.stage.messages[1].to = 'array'), [['STAGE_INCONSISTENT', 'stage.messages[1].to']], /Set "to" to another actor \(search\)/],
    ['an edge to a node that is not there', 'flow', (s) => (s.stage.edges[0].to = 'searching'), [['STAGE_UNKNOWN_REF', 'stage.edges[0].to']], /Use "search"\. The node ids are: sorted, search, good, unsorted, bad\./],
    ['a read-out beside an actor that is not there', 'sequence', (s) => (s.stage.stats[0].at = 'list'), [['STAGE_UNKNOWN_REF', 'stage.stats[0].at']], /The actor ids are: search, array/],
    ['`at` on a read-out of another stage', 'cells', (s) => (s.stage.stats[0].at = 'c0'), [['STAGE_INCONSISTENT', 'stage.stats[0].at']], /Remove "at"/],
    ['a series with one value too many', 'line', (s) => s.stage.series[0].values.push(4096), [['STAGE_INCONSISTENT', 'stage.series[0].values']], /exactly 3 values/],
    ['two x positions with one label', 'line', (s) => (s.stage.xs[1] = '8'), [['STAGE_INCONSISTENT', 'stage.xs[1]'], ['ACTION_UNKNOWN_PART', 'beats[0].do[0].upto']], /its own label/],
    ['an axis top below a value', 'chart', (s) => (s.stage.max = 100), [['STAGE_INCONSISTENT', 'stage.max']], /Raise "max" to at least 1000000/],
    ['an axis top below a value a `set` gives', 'chart', (s) => { s.stage.max = 1000000; s.beats[0].do[0].value = 2000000; s.stage.provenance = 'worked'; }, [['STAGE_INCONSISTENT', 'stage.max']], /beats\[0\]\.do\[0\]\.value|at least 2000000/],
    ['an annotation on a line that is not there', 'lines', (s) => (s.stage.annotations[0].at = 'l7'), [['STAGE_UNKNOWN_REF', 'stage.annotations[0].at']], /l1 to l3/],
    ['a value beside a line that is not there', 'lines', (s) => (s.stage.values[0].at = 'l4'), [['STAGE_UNKNOWN_REF', 'stage.values[0].at']], /l1 to l3/],
    ['more rows than a lines stage holds', 'lines', (s) => { s.stage.lines = Array.from({ length: 12 }, (_, i) => `x${i} = low + ${i}`); s.stage.annotations.push({ id: 'two', at: 'l2', text: 'A second remark.' }); }, [['STAGE_INCONSISTENT', 'stage.lines']], /fewer lines or annotations/],
    ['a language on a stage that is not code', 'math', (s) => (s.stage.language = 'LaTeX'), [['STAGE_INCONSISTENT', 'stage.language']], /Remove "language"/],
    ['an event in a lane the stage does not declare', 'timeline', (s) => (s.stage.events[0].lane = 'main'), [['STAGE_UNKNOWN_REF', 'stage.events[0].lane']], /declare the lanes/],
    ['a lane with no event', 'timeline', (s) => { s.stage.lanes = [{ id: 'up', label: 'Up' }, { id: 'down', label: 'Down' }]; for (const e of s.stage.events) e.lane = 'up'; }, [['STAGE_INCONSISTENT', 'stage.lanes']], /Give the lane an event/],
    ['a span that ends where no event is', 'timeline', (s) => (s.stage.spans[0].to = 'end'), [['STAGE_UNKNOWN_REF', 'stage.spans[0].to']], /The event ids are: start, first, done/],
    ['a span that runs backwards', 'timeline', (s) => Object.assign(s.stage.spans[0], { from: 'done', to: 'start' }), [['STAGE_INCONSISTENT', 'stage.spans[0]']], /Swap "from" and "to"/],
    ['a math line that does not parse', 'math', (s) => (s.stage.lines[1] = 'n = 2^{k'), [['MARKUP_MATH', 'stage.lines[1]']], /without "\$" delimiters/],
  ];

  it.each(cases)('%s', (_what, kind, change, expected, fix) => {
    const check = changedHonest(kind, change);
    expect(brief(check.errors)).toEqual(expected);
    expect(check.errors[0]!.fix).toMatch(fix);
    expectActionable(check.errors);
  });
});

describe('actions against the stage', () => {
  const cases: Array<[what: string, kind: Kind, change: (s: Loose) => void, expected: [string, string][], says?: RegExp]> = [
    // ----- parts that do not exist, listed with the ones that do
    ['a target that is not a part', 'cells', (s) => (s.beats[1].do[0].target = 'middle'), [['ACTION_UNKNOWN_PART', 'beats[1].do[0].target']], /Use "mid"\. Name a pointer or a bracket: mid, range\./],
    ['one of several targets', 'words', (s) => (s.beats[0].do[0].targets = ['given', 'moves']), [['ACTION_UNKNOWN_PART', 'beats[0].do[0].targets[1]']], /Use "move"\. Name a line: given, move, ask\./],
    ['a line named by its number', 'lines', (s) => (s.beats[0].do[0].to = 'line1'), [['ACTION_UNKNOWN_PART', 'beats[0].do[0].to']], /Use "l1"\. A pointer goes to a line: l1 to l3 \(one per line\)/],
    ['a cell that a pointer is sent to', 'cells', (s) => (s.beats[1].do[0].to = 'c7'), [['ACTION_UNKNOWN_PART', 'beats[1].do[0].to']], /A pointer goes to a cell: c0, c1, c2, c3, c4\./],
    ['an end of a range', 'cells', (s) => (s.beats[2].do[1].between = ['c3', 'c9']), [['ACTION_UNKNOWN_PART', 'beats[2].do[1].between[1]']], /A range runs from one cell to another/],
    ['a cell in a swap', 'cells', (s) => (s.beats[3].do[2].b = 'c5'), [['ACTION_UNKNOWN_PART', 'beats[3].do[2].b']], /Name a cell/],
    ['an edge a token travels along', 'flow', (s) => (s.beats[2].do[1].along = 'wrongly'), [['ACTION_UNKNOWN_PART', 'beats[2].do[1].along']], /Use "wrong"\. Name an edge: in, out, wrong\./],
    ['an x position a line is drawn up to', 'line', (s) => (s.beats[0].do[0].upto = '65'), [['ACTION_UNKNOWN_PART', 'beats[0].do[0].upto']], /one of the labels in "xs", written exactly as it is there: "8", "64", "512"/],
    ['an event the track is drawn up to', 'timeline', (s) => (s.beats[0].do[0].upto = 'second'), [['ACTION_UNKNOWN_PART', 'beats[0].do[0].upto']], /the event the track runs on to: start, first, done/],
    ['a bar in a reorder', 'chart', (s) => (s.beats[1].do[2].order = ['steps', 'item']), [['ACTION_UNKNOWN_PART', 'beats[1].do[2].order[1]']], /Use "items"/],
    // ----- verbs
    ['a verb the stage kind does not have', 'dots', (s) => s.beats[0].do.push({ verb: 'draw', target: 'all' }), [['ACTION_VERB_NOT_ALLOWED', 'beats[0].do[2].verb']], /split \(group\); merge \(group\); focus \(group, read-out\); set \(group, read-out\)/],
    ['any action on a words stage that it has no verb for', 'words', (s) => s.beats[0].do.push({ verb: 'send', target: 'given' }), [['ACTION_VERB_NOT_ALLOWED', 'beats[0].do[1].verb']], /show \(line\)/],
    ['a move of a cell', 'cells', (s) => (s.beats[1].do[0].target = 'c1'), [['ACTION_VERB_NOT_ALLOWED', 'beats[1].do[0].target']], /A cell takes: show, hide, swap, reorder, focus, set, pulse\./],
    ['a show of a message', 'sequence', (s) => s.beats[0].do.push({ verb: 'show', target: 'answer' }), [['ACTION_VERB_NOT_ALLOWED', 'beats[0].do[1].target']], /A message takes: send, focus\./],
    ['a pulse of a group of dots', 'dots', (s) => s.beats[0].do.push({ verb: 'pulse', target: 'keep' }), [['ACTION_VERB_NOT_ALLOWED', 'beats[0].do[2].target']], /Name a read-out: looks\./],
    ['a set on a series', 'line', (s) => s.beats[1].do.push({ verb: 'set', target: 'binary', tone: 'good' }), [['ACTION_VERB_NOT_ALLOWED', 'beats[1].do[3].target']], /A series takes: draw, focus\./],
    ['a draw of an event', 'timeline', (s) => (s.beats[0].do[0].target = 'first'), [['ACTION_VERB_NOT_ALLOWED', 'beats[0].do[0].target']], /Name the track or a lane: track\./],
    ['a move of an annotation', 'lines', (s) => (s.beats[0].do[0].target = 'why'), [['ACTION_VERB_NOT_ALLOWED', 'beats[0].do[0].target']], /Name a pointer or a bracket: pc, pair\./],
    ['a focus on a pointer of a lines stage', 'lines', (s) => s.beats[1].do.push({ verb: 'focus', targets: ['pc'] }), [['ACTION_VERB_NOT_ALLOWED', 'beats[1].do[2].targets[0]']], /A pointer takes: show, hide, move, set, pulse\./],
    // ----- which parts an action names
    ['no target at all', 'cells', (s) => (s.beats[1].do[1] = { verb: 'pulse' }), [['ACTION_TARGET', 'beats[1].do[1]']], /Add "target" \(one id\) or "targets" \(a list\)/],
    ['target and targets together', 'words', (s) => (s.beats[0].do[0].target = 'given'), [['ACTION_TARGET', 'beats[0].do[0]']], /Keep one/],
    ['a range and a target together', 'cells', (s) => (s.beats[2].do[1].target = 'c3'), [['ACTION_TARGET', 'beats[2].do[1]']], /"between" for a range/],
    ['a set that names nothing', 'cells', (s) => (s.beats[1].do[1] = { verb: 'set', tone: 'warn' }), [['ACTION_TARGET', 'beats[1].do[1]']], /Here "set" works on/],
    ['a send on a sequence with no message', 'sequence', (s) => delete s.beats[0].do[0].target, [['ACTION_TARGET', 'beats[0].do[0]']], /The messages are: ask, answer, drop\./],
    ['a send on a flow with only `from`', 'flow', (s) => delete s.beats[1].do[1].to, [['ACTION_TARGET', 'beats[1].do[1]']], /both "from" and "to"/],
    ['a send on a flow with `along` and `from`', 'flow', (s) => (s.beats[2].do[1].from = 'search'), [['ACTION_TARGET', 'beats[2].do[1]']], /Keep "along"/],
    // ----- parameters
    ['a set with nothing to set', 'cells', (s) => (s.beats[1].do[1] = { verb: 'set', target: 'c2' }), [['ACTION_PARAMETER', 'beats[1].do[1]']], /Give what changes/],
    ['new words for a line of a words stage', 'words', (s) => (s.beats[1].do[2].label = 'Another question'), [['ACTION_PARAMETER', 'beats[1].do[2].label']], /On a line a "set" takes "tone"\./],
    ['a label for a read-out', 'cells', (s) => (s.beats[1].do[2] = { verb: 'set', target: 'looks', label: 'one' }), [['ACTION_PARAMETER', 'beats[1].do[2].label']], /Rename "label" to "value"\./],
    ['a value for a group of dots', 'dots', (s) => (s.beats[1].do[2] = { verb: 'set', target: 'four', value: 4 }), [['ACTION_PARAMETER', 'beats[1].do[2].value']], /On a group of dots a "set" takes "tone"\./],
    ['text as the value of a bar', 'chart', (s) => (s.beats[0].do[0].value = 'twenty'), [['ACTION_PARAMETER', 'beats[0].do[0].value']], /without quotation marks/],
    ['a negative value for a bar', 'chart', (s) => (s.beats[0].do[0].value = -20), [['ACTION_PARAMETER', 'beats[0].do[0].value']], /zero or more/],
    ['a size on something that is not a flow node', 'cells', (s) => (s.beats[1].do[1].size = 'large'), [['ACTION_PARAMETER', 'beats[1].do[1].size']], /only a node of a flow stage has a size/],
    ['a label for a value beside a line', 'lines', (s) => (s.beats[1].do[0] = { verb: 'set', target: 'sum', label: 'too large' }), [['ACTION_PARAMETER', 'beats[1].do[0].label']], /Rename "label" to "value"\./],
    ['a range on a stage that has none', 'flow', (s) => (s.beats[0].do[1] = { verb: 'set', between: ['sorted', 'good'], tone: 'good' }), [['ACTION_PARAMETER', 'beats[0].do[1].between']], /Name the parts with "targets"/],
    ['a range of events in a set on a timeline', 'timeline', (s) => (s.beats[1].do[3] = { verb: 'set', between: ['first', 'done'], tone: 'good' }), [['ACTION_PARAMETER', 'beats[1].do[3].between']], /a "set" on a timeline takes none/],
    ['a range that names a pointer', 'cells', (s) => (s.beats[2].do[1].between = ['mid', 'c4']), [['ACTION_PARAMETER', 'beats[2].do[1].between[0]']], /Use two cell ids/],
    ['a pointer sent to a range', 'cells', (s) => (s.beats[1].do[0].to = ['c1', 'c2']), [['ACTION_PARAMETER', 'beats[1].do[0].to']], /one cell id/],
    ['a pointer sent to another pointer', 'lines', (s) => (s.beats[0].do[0].to = 'pair'), [['ACTION_PARAMETER', 'beats[0].do[0].to']], /Set "to" to a line/],
    ['a marker sent to a range of events', 'timeline', (s) => (s.beats[0].do[1].to = ['start', 'first']), [['ACTION_PARAMETER', 'beats[0].do[1].to']], /one event id/],
    ['a span sent to one event', 'timeline', (s) => (s.beats[1].do[2] = { verb: 'move', target: 'run', to: 'first' }), [['ACTION_PARAMETER', 'beats[1].do[2].to']], /\[first, last\], two event ids/],
    ['a cell swapped with itself', 'cells', (s) => (s.beats[3].do[2].b = 'c3'), [['ACTION_PARAMETER', 'beats[3].do[2].b']], /two different cells/],
    ['`upto` on the draw of a flow', 'flow', (s) => (s.beats[0].do[0].upto = 'good'), [['ACTION_PARAMETER', 'beats[0].do[0].upto']], /Remove "upto"/],
    ['`target` on the send of a flow, naming an edge', 'flow', (s) => (s.beats[2].do[1] = { verb: 'send', target: 'wrong' }), [['ACTION_PARAMETER', 'beats[2].do[1].target']], /Use "along": "wrong" in place of "target"\./],
    ['the fields of a flow send on a sequence', 'sequence', (s) => Object.assign(s.beats[0].do[0], { from: 'search', label: 'ask' }), [['ACTION_PARAMETER', 'beats[0].do[0].from'], ['ACTION_PARAMETER', 'beats[0].do[0].label']], /name the message with "target"/],
    ['a send from a node to itself', 'flow', (s) => (s.beats[1].do[1].to = 'unsorted'), [['ACTION_PARAMETER', 'beats[1].do[1].to']], /another node/],
    ['a group merged with itself', 'dots', (s) => (s.beats[1].do[1].targets = ['more', 'more']), [['ACTION_PARAMETER', 'beats[1].do[1].targets[1]']], /Name each group once/],
    // ----- the cue
    ['a cue that is not in the caption', 'sequence', (s) => (s.beats[2].do[2].on = 'throws away'), [['ACTION_CUE_NOT_IN_CAPTION', 'beats[2].do[2].on']], /copied from this beat's caption/],
    // ----- dots: what is on stage changes
    ['a split that does not add up', 'dots', (s) => (s.beats[0].do[0].into[1].count = 6), [['SPLIT_COUNT_MISMATCH', 'beats[0].do[0].into']], /add up to 16/],
    ['a split of a group that was split away', 'dots', (s) => (s.beats[1].do[0].target = 'all'), [['GROUP_NOT_ON_STAGE', 'beats[1].do[0].target']], /on stage at this point: keep, gone\./],
    ['a focus on a group that is created later', 'dots', (s) => s.beats[0].do.push({ verb: 'focus', targets: ['four'] }), [['GROUP_NOT_ON_STAGE', 'beats[0].do[2].targets[0]']], /created in beat 2/],
    ['a merge of a group that is gone', 'dots', (s) => (s.beats[1].do[1].targets = ['more', 'keep']), [['GROUP_NOT_ON_STAGE', 'beats[1].do[1].targets[1]']], /on stage at this point: gone, four, more\./],
    // (The merge that follows then names "more", which no longer exists under that name.)
    ['a split into an id that is taken', 'dots', (s) => (s.beats[1].do[0].into[1].id = 'gone'), [['STAGE_DUPLICATE_ID', 'beats[1].do[0].into[1].id'], ['ACTION_UNKNOWN_PART', 'beats[1].do[1].targets[0]']], /an id of its own/],
    ['a merge into the id of a group it merges', 'dots', (s) => (s.beats[1].do[1].into.id = 'gone'), [['STAGE_DUPLICATE_ID', 'beats[1].do[1].into.id']], /the groups being merged included/],
    // ----- cells and bars: every one, once
    ['a reorder that leaves a cell out', 'cells', (s) => (s.beats[3].do[2] = { verb: 'reorder', order: ['c4', 'c3', 'c1', 'c0'] }), [['REORDER_INCOMPLETE', 'beats[3].do[2].order']], /List all 5 cells once/],
    ['a reorder that names a bar twice', 'chart', (s) => (s.beats[1].do[2].order = ['steps', 'steps']), [['REORDER_INCOMPLETE', 'beats[1].do[2].order']], /leaves out items and names steps more than once|List all 2 bars once/],
    // ----- a sequence sends each message once
    ['a message sent twice', 'sequence', (s) => (s.beats[2].do[0].target = 'ask'), [['MESSAGE_SENT_TWICE', 'beats[2].do[0].target']], /Not yet sent: drop\./],
  ];

  it.each(cases)('%s', (_what, kind, change, expected, says) => {
    const check = changedHonest(kind, change);
    expect(brief(check.errors)).toEqual(expected);
    expect(check.ok).toBe(false);
    if (says) expect(`${check.errors[0]!.message} ${check.errors[0]!.fix}`).toMatch(says);
    expectActionable(check.errors);
    for (const e of check.errors) expect(e.sceneId).toBe(honest(kind).id);
  });

  it('accepts what each verb is for', () => {
    const fine: Array<[Kind, (s: Loose) => void]> = [
      ['cells', (s) => s.beats[0].do.push({ verb: 'show', targets: ['mid', 'range', 'looks'] }, { verb: 'hide', target: 'c0' }, { verb: 'focus' })],
      ['cells', (s) => s.beats[3].do.push({ verb: 'reorder', order: ['c4', 'c3', 'c2', 'c1', 'c0'] })],
      ['cells', (s) => (s.beats[1].do[0] = { verb: 'move', target: 'range', to: 'c2' })],
      ['dots', (s) => s.beats[1].do.push({ verb: 'set', target: 'four', tone: 'warn' })],
      ['dots', (s) => s.beats[0].do.push({ verb: 'pulse', target: 'looks' }, { verb: 'focus', targets: ['keep', 'looks'] })],
      ['flow', (s) => s.beats[2].do.push({ verb: 'focus', targets: ['wrong', 'bad'], zoom: true })],
      ['flow', (s) => (s.beats[0].do[1] = { verb: 'send', from: 'sorted', to: 'good' })],
      ['line', (s) => s.beats[0].do.push({ verb: 'set', target: 'gap', value: 'none yet' }, { verb: 'hide', target: 'gap' })],
      ['lines', (s) => (s.beats[1].do = [{ verb: 'set', between: ['l1', 'l2'], tone: 'bad' }, { verb: 'set', target: 'l2', label: '// it overflows' }, { verb: 'move', target: 'pair', to: 'l1' }])],
      ['timeline', (s) => (s.beats[0].do = [{ verb: 'draw' }, { verb: 'set', target: 'first', label: 'Half is left', tone: 'accent' }, { verb: 'move', target: 'run', to: ['first', 'done'] }, { verb: 'pulse', targets: ['now', 'run'] }])],
      ['sequence', (s) => (s.beats[1].do = [{ verb: 'send', target: 'answer', outcome: 'lost', tone: 'warn' }, { verb: 'focus', targets: ['answer', 'left'] }, { verb: 'hide', target: 'left' }])],
      ['chart', (s) => s.beats[0].do.push({ verb: 'show', target: 'items' }, { verb: 'hide', target: 'items' })],
      ['words', (s) => s.beats[1].do.pop()],
    ];
    for (const [kind, change] of fine) {
      const check = changedHonest(kind, change);
      expect(check.errors.map((e) => `${kind}: ${e.code} ${e.path} ${e.message}`)).toEqual([]);
    }
  });

  it('a cue is looked for as the player looks for it: in the caption, whatever the case', () => {
    expect(changedHonest('sequence', (s) => (s.beats[2].do[2].on = 'DISCARDS the half')).errors).toEqual([]);
    // An analogy is read with its limits, so a cue may come from them.
    const analogy = changedHonest('sequence', (s) => {
      s.beats[1].caption = { type: 'analogy', text: 'It is like opening a dictionary in the middle.', limits: 'A reader guesses; the search does not.' };
      s.beats[1].do[1].on = 'the search does not';
    });
    expect(analogy.errors).toEqual([]);
  });

  it('a prediction may not stand on the first beat', () => {
    const check = changedHonest('cells', (s) => {
      s.beats[0].gate = s.beats[2].gate;
      delete s.beats[2].gate;
    });
    expect(brief(check.errors)).toEqual([['GATE_ON_FIRST_BEAT', 'beats[0].gate']]);
    expect(check.errors[0]!.fix).toContain('after a beat that sets the scene');
  });

  it('only a frame clip times its captions', () => {
    const check = changedHonest('flow', (s) => s.beats.forEach((beat: Loose, i: number) => (beat.at = i * 2)));
    expect(brief(check.errors)).toEqual([['BEAT_FIELD_NOT_ALLOWED', 'beats[0].at'], ['BEAT_FIELD_NOT_ALLOWED', 'beats[1].at'], ['BEAT_FIELD_NOT_ALLOWED', 'beats[2].at']]);
    expect(check.errors[0]!.fix).toBe('Remove "at". You never write a time on a typed stage.');
  });
});

describe('the prediction of a beat follows the predict rules', () => {
  const cases: Array<[what: string, change: (gate: Loose) => void, code: IssueCode, path: string]> = [
    ['two correct options', (g) => (g.options[1].correct = true), 'OPTION_CORRECT_COUNT', 'beats[2].gate.options'],
    ['no correct option', (g) => (g.options[0].correct = false), 'OPTION_CORRECT_COUNT', 'beats[2].gate.options'],
    ['the same option twice', (g) => (g.options[1].text = g.options[0].text), 'OPTION_DUPLICATE', 'beats[2].gate.options[1].text'],
    ['feedback that only says wrong', (g) => (g.options[1].feedback = 'No, that is not right.'), 'FEEDBACK_GENERIC', 'beats[2].gate.options[1].feedback'],
    ['a correct option far longer than the other', (g) => (g.options[0].text = 'The half before the middle, together with the middle element itself, because the data is sorted'), 'CORRECT_OPTION_LONGEST', 'beats[2].gate.options[0].text'],
    ['an option that points at the others', (g) => g.options.push({ text: 'None of the above', correct: false, feedback: 'One of the halves can always be thrown away.' }), 'OPTION_ALL_NONE', 'beats[2].gate.options[2].text'],
  ];

  it.each(cases)('%s', (_what, change, code, path) => {
    const check = changedHonest('cells', (s) => change(s.beats[2].gate));
    expect(brief(check.errors)).toEqual([[code, path]]);
  });

  it('a prediction needs feedback on each option, by the schema', () => {
    const check = changedHonest('cells', (s) => delete s.beats[2].gate.options[1].feedback);
    expect(brief(check.errors)).toEqual([['MISSING_FIELD', 'beats[2].gate.options[1].feedback']]);
  });

  it('numbers in a prediction are the learner\'s to work with, and need no source', () => {
    const check = changedHonest('cells', (s) => (s.beats[2].gate.prompt = 'The middle is 6 and the target is 8, with 1024 cells in all. What can go?'));
    expect(check.errors).toEqual([]);
  });
});

describe('the scene against the plan', () => {
  it('a clip where the plan has a checkpoint, and the other way round', () => {
    const draft = plannedClipDraft();
    const clip = { ...clipScene('c2'), id: 'q1' };
    expect(brief(checkScene(clip, draft).errors)).toEqual([['SCENE_KIND_MISMATCH', 'kind']]);
    expect(checkScene(clip, draft).errors[0]).toMatchObject({ got: 'clip', expected: 'checkpoint' });
    const checkpoint = { ...clipScene('q1'), id: 'c2' };
    expect(checkScene(checkpoint, draft).errors[0]).toMatchObject({ code: 'SCENE_KIND_MISMATCH', got: 'checkpoint', expected: 'clip' });
  });

  it('a stage of another kind than the plan names', () => {
    const draft = plannedClipDraft();
    const check = checkScene({ ...clipScene('c3'), id: 'c2' }, draft);
    expect(brief(check.errors)).toEqual([['SCENE_SHAPE_MISMATCH', 'stage.kind']]);
    expect(check.errors[0]).toMatchObject({ got: 'cells', expected: 'flow', sceneId: 'c2' });
    expect(check.errors[0]!.fix).toBe('Send a flow stage (the template from plan_lesson shows its fields), or call plan_lesson again with "stage": "cells" for "c2".');
  });

  it('a clip the plan does not have', () => {
    const check = checkScene({ ...clipScene('c2'), id: 'c9' }, plannedClipDraft());
    expect(brief(check.errors)).toEqual([['SCENE_NOT_PLANNED', 'id']]);
    expect(check.errors[0]!.fix).toContain('c1 (clip), c2 (clip), c3 (clip), q1 (checkpoint)');
  });
});

describe('the shape of a clip, said so that it can be fixed', () => {
  const fixOf = (kind: Kind, change: (s: Loose) => void): Issue => changedHonest(kind, change).errors[0]!;

  it('names the nearest key and the valid ones', () => {
    expect(fixOf('flow', (s) => { s.beats[0].actions = s.beats[0].do; delete s.beats[0].do; })).toMatchObject({ code: 'UNKNOWN_FIELD', path: 'beats[0].actions', fix: 'Rename "actions" to "do". Valid fields here: caption, say, do, gate, at.' });
    expect(fixOf('cells', (s) => { s.beats[2].predict = s.beats[2].gate; delete s.beats[2].gate; })).toMatchObject({ code: 'UNKNOWN_FIELD', path: 'beats[2].predict', expected: 'gate' });
    expect(fixOf('flow', (s) => (s.beats[0].do[0].duration = 400))).toMatchObject({ code: 'UNKNOWN_FIELD', path: 'beats[0].do[0].duration', fix: 'Remove "duration". Valid fields here: verb, target, targets, upto, with, on.' });
    expect(fixOf('chart', (s) => (s.stage.colour = 'red'))).toMatchObject({ code: 'UNKNOWN_FIELD', path: 'stage.colour', fix: 'Remove "colour". Valid fields here: kind, unit, max, yLabel, mark, bars, stats, cites, provenance.' });
    expect(fixOf('flow', (s) => { s.figure = s.stage; delete s.stage; })).toMatchObject({ code: 'UNKNOWN_FIELD', path: 'figure', expected: 'stage' });
  });

  it('lists the verbs, the stage kinds, the marks and the provenances', () => {
    expect(fixOf('flow', (s) => (s.beats[0].do[0].verb = 'reveal'))).toMatchObject({
      code: 'BAD_VALUE',
      path: 'beats[0].do[0].verb',
      fix: 'Use one of the valid values for "verb": "show", "hide", "draw", "send", "focus", "set", "move", "swap", "split", "merge", "reorder", "pulse".',
    });
    expect(fixOf('flow', (s) => (s.stage.kind = 'flowchart'))).toMatchObject({ code: 'BAD_VALUE', path: 'stage.kind', fix: 'Use "flow". Valid values for "kind": "sequence", "cells", "dots", "chart", "flow", "words", "lines", "timeline", "frame".' });
    expect(fixOf('chart', (s) => (s.stage.mark = 'bar'))).toMatchObject({ code: 'BAD_VALUE', path: 'stage.mark', fix: 'Use "bars". Valid values for "mark": "bars", "line", "curve".' });
    expect(fixOf('chart', (s) => delete s.stage.mark)).toMatchObject({ code: 'MISSING_FIELD', path: 'stage.mark' });
    expect(fixOf('flow', (s) => (s.stage.provenance = 'source'))).toMatchObject({ code: 'BAD_VALUE', path: 'stage.provenance', fix: 'Use "sourced". Allowed values: "sourced", "worked", "illustrative".' });
    expect(fixOf('flow', (s) => delete s.stage.provenance)).toMatchObject({ code: 'MISSING_FIELD', path: 'stage.provenance' });
  });

  it('takes a clip sent as a JSON string, and a single cite sent as a string', () => {
    const clip = honest('flow');
    clip.stage.cites = 'e3';
    const check = checkScene(JSON.stringify(clip), draftAround(clip));
    expect(check.errors).toEqual([]);
    expect((check.scene as Loose).stage.cites).toEqual(['e3']);
  });

  it('every issue of every refusal above carries a catalog code', () => {
    const check = changedHonest('cells', (s) => {
      s.beats[1].do[0].target = 'middle';
      s.stage.cites = [];
      s.beats[3].do = [];
      s.beats[0].do = [];
    });
    expect(errorCodes(check).sort()).toEqual(['ACTION_UNKNOWN_PART', 'CLIP_TOO_STATIC', 'STAGE_NO_CITES']);
    for (const e of check.errors) expect(ISSUES[e.code as IssueCode].severity).toBe('error');
    expect(warningCodes(check)).toEqual([]);
  });
});
