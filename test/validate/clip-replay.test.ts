// A replay of what agents get wrong when they write clips: each mistake as it would be sent, and
// what the validator answers. The answer has to be something to act on without re-reading the
// format: the right code, the path of the field, and a fix that names the ids, the verbs or the
// values that would have worked.
import { describe, expect, it } from 'vitest';
import { ISSUES, MAX_ISSUES_PER_CALL, type IssueCode } from '../../src/core/issues';
import type { Issue } from '../../src/core/types';
import { changedHonest, type Loose } from './clip-kit';
import { expectActionable, expectNoExcerptText } from './helpers';

type Kind = Parameters<typeof changedHonest>[0];
type Expected = [code: IssueCode, path: string, says: RegExp];
const brief = (issues: readonly Issue[]): [string, string][] => issues.map((i) => [i.code, i.path]);

const REPLAY: Array<[what: string, kind: Kind, change: (s: Loose) => void, expected: Expected[]]> = [
  // ----- the six the round was asked to replay
  ['an action on a part id the stage does not have', 'flow', (s) => (s.beats[0].do[1].target = 'found'), [['ACTION_UNKNOWN_PART', 'beats[0].do[1].target', /Name a node or a read-out: sorted, search, good, unsorted, bad\./]]],
  ['a verb that is not allowed on that part', 'flow', (s) => (s.beats[0].do[1] = { verb: 'show', target: 'out' }), [['ACTION_VERB_NOT_ALLOWED', 'beats[0].do[1].target', /"out", which is an edge; on a flow stage it takes a node or a read-out\..*An edge takes: draw, send, focus\./]]],
  [
    'a caption that is a paragraph',
    'flow',
    (s) => (s.beats[2].caption.text = 'On unsorted data the result is unreliable, because the half that the search throws away at any step may well be the half that held the target all along.'),
    [['WORDS_OVER_BUDGET', 'beats[2].caption', /has 29 words; the limit is 22\. Cut at least 7 words\./]],
  ],
  ['a number on a sourced stage that the cited excerpt lacks', 'flow', (s) => (s.stage.nodes[2].label = 'Found in 12 steps'), [['NUMBER_NOT_IN_SOURCE', 'stage.nodes[2].label', /The number 12 in this node label is not in the excerpt the stage cites \(e3\)\..*set "provenance" to "worked"/]]],
  ['a frame with a syntax error', 'frame', (s) => (s.stage.code = s.stage.code.replace('for (let k = 0; k < HALVINGS; k++)', 'for (let k = 0; k < HALVINGS; k++')), [['FRAME_SYNTAX', 'stage.code', /^Syntax error: .*every bracket and comment closed\.$/]]],
  [
    'beats on a frame with `do`',
    'frame',
    (s) => s.beats.forEach((b: Loose) => (b.do = [{ verb: 'show', target: 'bar' }])),
    [
      ['BEAT_FIELD_NOT_ALLOWED', 'beats[0].do', /the stage of this clip is a frame.*Remove "do" from the beats of a frame clip/],
      ['BEAT_FIELD_NOT_ALLOWED', 'beats[1].do', /Beat 2 has an action/],
      ['BEAT_FIELD_NOT_ALLOWED', 'beats[2].do', /Beat 3 has an action/],
    ],
  ],

  // ----- the caption is one block
  ['a caption sent as a sentence', 'flow', (s) => (s.beats[0].caption = 'Binary search only works when the data is sorted.'), [['WRONG_TYPE', 'beats[0].caption', /A caption is one block, an object: \{"type": "claim", "text": "\.\.\.", "cites": \["e1"\]\}/]]],
  ['a caption sent as a list of blocks', 'flow', (s) => (s.beats[0].caption = [s.beats[0].caption]), [['WRONG_TYPE', 'beats[0].caption', /A caption is ONE block, not a list/]]],
  ['`text` where `caption` belongs', 'flow', (s) => { s.beats[0].text = s.beats[0].caption; delete s.beats[0].caption; }, [['MISSING_FIELD', 'beats[0].caption', /Add it/], ['UNKNOWN_FIELD', 'beats[0].text', /Valid fields here: caption, say, do, gate, at\./]]],
  ['`cite` on a claim caption', 'flow', (s) => { s.beats[0].caption.cite = 'e3'; delete s.beats[0].caption.cites; }, [['UNKNOWN_FIELD', 'beats[0].caption.cite', /Rename "cite" to "cites"/]]],

  // ----- names carried over from the older format, or guessed
  ['`steps` for `beats`', 'flow', (s) => { s.steps = s.beats; delete s.beats; }, [['UNKNOWN_FIELD', 'steps', /Rename "steps" to "beats"/]]],
  ['`figure` for `stage`', 'flow', (s) => { s.figure = { type: 'flow', ...s.stage }; delete s.stage; }, [['UNKNOWN_FIELD', 'figure', /Rename "figure" to "stage"/]]],
  ['`type` for `kind`, on the scene', 'flow', (s) => { s.type = 'clip'; delete s.kind; }, [['UNKNOWN_FIELD', 'type', /Rename "type" to "kind"\. Valid values for "kind": .*"clip"\./]]],
  ['`type` for `kind`, on the stage', 'flow', (s) => { s.stage.type = 'flow'; delete s.stage.kind; }, [['UNKNOWN_FIELD', 'stage.type', /Rename "type" to "kind"\. Valid values for "kind": "sequence", "cells", "dots", "chart", "flow", "words", "lines", "timeline", "frame"\./]]],
  ['a highlight on a beat', 'flow', (s) => (s.beats[0].highlight = ['sorted']), [['UNKNOWN_FIELD', 'beats[0].highlight', /Remove "highlight"\. Valid fields here: caption, say, do, gate, at\./]]],
  ['the fields of a question on a gate', 'cells', (s) => (s.beats[2].gate = { question: s.beats[2].gate.prompt, choices: s.beats[2].gate.options }), [['UNKNOWN_FIELD', 'beats[2].gate.question', /Rename "question" to "prompt"/], ['UNKNOWN_FIELD', 'beats[2].gate.choices', /Rename "choices" to "options"/]]],
  ['a misconception on an option of a gate', 'cells', (s) => (s.beats[2].gate.options[1].misconception = 'Thinks the larger half goes'), [['UNKNOWN_FIELD', 'beats[2].gate.options[1].misconception', /Valid fields here: text, correct, feedback\./]]],
  ['the fields of a chart figure on a chart stage', 'line', (s) => Object.assign(s.stage, { data: 'illustrative', xLabel: 'Items' }), [['UNKNOWN_FIELD', 'stage.data', /Valid fields here: kind, unit, max, yLabel, mark, xs, series, stats, cites, provenance\./], ['UNKNOWN_FIELD', 'stage.xLabel', /Remove "xLabel"/]]],
  ['x positions as objects, as a chart figure had them', 'line', (s) => (s.stage.xs = s.stage.xs.map((label: string, i: number) => ({ id: `x${i}`, label }))), [['WRONG_TYPE', 'stage.xs[0]', /a string of 1 to 10 characters/], ['WRONG_TYPE', 'stage.xs[1]', /./], ['WRONG_TYPE', 'stage.xs[2]', /./]]],

  // ----- timing, geometry and colour: there is no field for them
  ['a duration and an easing on an action', 'flow', (s) => Object.assign(s.beats[0].do[0], { duration: 600, easing: 'ease-out' }), [['UNKNOWN_FIELD', 'beats[0].do[0].duration', /Remove "duration"\. Valid fields here: verb, target, targets, upto, with, on\./], ['UNKNOWN_FIELD', 'beats[0].do[0].easing', /Remove "easing"/]]],
  ['a colour on a node', 'flow', (s) => (s.stage.nodes[0].color = '#22c55e'), [['UNKNOWN_FIELD', 'stage.nodes[0].color', /Remove "color"\. Valid fields here: id, label\./]]],
  ['a position on a node', 'flow', (s) => Object.assign(s.stage.nodes[0], { x: 120, y: 80 }), [['UNKNOWN_FIELD', 'stage.nodes[0].x', /Remove "x"/], ['UNKNOWN_FIELD', 'stage.nodes[0].y', /Remove "y"/]]],
  ['a colour for a tone', 'flow', (s) => (s.beats[0].do[1].tone = 'green'), [['BAD_VALUE', 'beats[0].do[1].tone', /Use one of: "neutral", "accent", "good", "bad", "warn", "muted"\./]]],
  ['a time written as text on a frame beat', 'frame', (s) => (s.beats[1].at = '0:01'), [['WRONG_TYPE', 'beats[1].at', /a number/]]],

  // ----- how a part is named
  ['several parts in `target`', 'flow', (s) => (s.beats[0].do[0] = { verb: 'draw', target: ['in', 'out'] }), [['WRONG_TYPE', 'beats[0].do[0].target', /"target" names one part\. For several, rename it to "targets" and keep the list\./]]],
  ['a line named "L1"', 'lines', (s) => (s.beats[0].do[0].to = 'L1'), [['BAD_ID', 'beats[0].do[0].to', /Use "l1"\..*l1 to l3 \(one per line\), pc, pair, why, sum\./]]],
  ['a line named by the number 1', 'lines', (s) => (s.beats[0].do[0].to = 1), [['BAD_VALUE', 'beats[0].do[0].to', /Use "l1"\./]]],
  ['a line named "Line 1"', 'lines', (s) => (s.beats[0].do[2].target = 'Line 1'), [['BAD_ID', 'beats[0].do[2].target', /Use "l1"\./]]],
  ['a node named by its label', 'flow', (s) => (s.beats[0].do[1].target = 'The target is found'), [['BAD_ID', 'beats[0].do[1].target', /The part ids of this stage are: sorted, search, good, unsorted, bad, in, out, wrong\./]]],
  ['cells named by their positions', 'cells', (s) => (s.beats[2].do[1].between = [3, 4]), [['WRONG_TYPE', 'beats[2].do[1].between[0]', /Use "c3"\./], ['WRONG_TYPE', 'beats[2].do[1].between[1]', /Use "c4"\./]]],
  ['bars named with capitals', 'chart', (s) => (s.beats[1].do[2].order = ['Steps', 'Items']), [['BAD_ID', 'beats[1].do[2].order[0]', /Use "steps"\./], ['BAD_ID', 'beats[1].do[2].order[1]', /Use "items"\./]]],
  ['a token sent with `target` on a flow', 'flow', (s) => (s.beats[2].do[1] = { verb: 'send', target: 'wrong', outcome: 'lost' }), [['ACTION_PARAMETER', 'beats[2].do[1].target', /Use "along": "wrong" in place of "target"\./]]],

  // ----- values
  ['a provenance that is nearly one', 'flow', (s) => (s.stage.provenance = 'source'), [['BAD_VALUE', 'stage.provenance', /Use "sourced"\. Allowed values: "sourced", "worked", "illustrative"\./]]],
  ['a sourced stage with no cites', 'flow', (s) => delete s.stage.cites, [['STAGE_NO_CITES', 'stage.cites', /Stored ids: e1, e2, e3, e4, e5\./]]],
  ['the value of a bar as text', 'chart', (s) => (s.stage.bars[0].value = '1,000,000'), [['WRONG_TYPE', 'stage.bars[0].value', /a number/]]],
  ['`with` as text', 'cells', (s) => (s.beats[1].do[1].with = 'true'), [['WRONG_TYPE', 'beats[1].do[1].with', /Send true without quotation marks\./]]],
  ['an outcome that does not exist', 'flow', (s) => (s.beats[2].do[1].outcome = 'dropped'), [['BAD_VALUE', 'beats[2].do[1].outcome', /Use one of: "lost"\./]]],
  ['a split that is one dot out', 'dots', (s) => (s.beats[0].do[0].into[0].count = 9), [['SPLIT_COUNT_MISMATCH', 'beats[0].do[0].into', /add up to 17 dots, but "all" has 16/], ['SPLIT_COUNT_MISMATCH', 'beats[1].do[0].into', /add up to 8 dots, but "keep" has 9/]]],
  ['no description', 'flow', (s) => delete s.description, [['MISSING_FIELD', 'description', /a string of 30 to 400 characters/]]],
  ['nine beats', 'words', (s) => (s.beats = [...s.beats, ...Array.from({ length: 7 }, () => ({ caption: { type: 'framing', text: 'One more look at it.' }, do: [{ verb: 'pulse', target: 'ask' }] }))]), [['TOO_MANY', 'beats', /at most 8 are allowed\. Remove 1 of them\./]]],
  ['one beat', 'words', (s) => s.beats.pop(), [['TOO_FEW', 'beats', /at least 2 are needed/]]],
];

describe('realistic mistakes in a clip are refused with a fix that names what to change', () => {
  it.each(REPLAY)('%s', (_what, kind, change, expected) => {
    const check = changedHonest(kind, change);
    expect(check.ok).toBe(false);
    expect(brief(check.errors)).toEqual(expected.map(([code, path]) => [code, path]));
    check.errors.forEach((e, i) => {
      expect(`${e.message} ${e.fix}`, `${e.code} ${e.path}`).toMatch((expected[i] as Expected)[2]);
      expect(ISSUES[e.code as IssueCode], e.code).toBeDefined();
      expect(e.severity).toBe('error');
    });
    expectActionable(check.errors);
    expectNoExcerptText(check.errors, check.draft);
    expect(check.scene).toBeUndefined();
    // The size of the clip is reported whether or not it was accepted, when its beats can be read.
    if (check.metrics?.steps) expect(check.metrics.budget).toMatchObject({ per: 'beat' });
  });

  it('covers the mistakes the round named', () => {
    const codes = new Set(REPLAY.flatMap(([, , , expected]) => expected.map(([code]) => code)));
    for (const code of ['ACTION_UNKNOWN_PART', 'ACTION_VERB_NOT_ALLOWED', 'WORDS_OVER_BUDGET', 'NUMBER_NOT_IN_SOURCE', 'FRAME_SYNTAX', 'BEAT_FIELD_NOT_ALLOWED']) expect(codes.has(code as IssueCode), code).toBe(true);
    expect(REPLAY.length).toBeGreaterThanOrEqual(40);
  });
});

describe('what a careful agent might send differently is accepted', () => {
  const lenient: Array<[what: string, kind: Kind, change: (s: Loose) => void]> = [
    ['`do` as a string of JSON', 'flow', (s) => (s.beats[0].do = JSON.stringify(s.beats[0].do))],
    ['the beats as a string of JSON', 'flow', (s) => (s.beats = JSON.stringify(s.beats))],
    ['a single cite as a string, on a caption and on the stage', 'flow', (s) => { s.beats[0].caption.cites = 'e3'; s.stage.cites = 'e3'; }],
    ['a quote\'s cite as a list of one', 'flow', (s) => (s.beats[1].caption.cite = ['e3'])],
    ['optional fields sent as null', 'cells', (s) => Object.assign(s, { pace: null }) && Object.assign(s.beats[0], { gate: null, at: null })],
    ['an empty `do` on a still beat', 'cells', (s) => (s.beats[0].do = [])],
    ['no `do` at all on a still beat', 'cells', (s) => delete s.beats[0].do],
    ['a pace', 'flow', (s) => (s.pace = 'calm')],
    ['a quote caption typed with other capitals and spacing than the source', 'flow', (s) => (s.beats[1].caption.text = 'The half that is  discarded may contain the target')],
  ];

  it.each(lenient)('%s', (_what, kind, change) => {
    const check = changedHonest(kind, change);
    expect(check.errors.map((e) => `${e.code} ${e.path}: ${e.message}`)).toEqual([]);
    expect(check.ok).toBe(true);
  });
});

describe('many mistakes at once', () => {
  it('are all reported in one pass, in a stable order', () => {
    const change = (s: Loose): void => {
      s.stage.nodes[2].label = 'Found in 12 steps';
      s.stage.edges[0].to = 'searching';
      s.beats[0].do[1].target = 'begin';
      s.beats[1].do = [];
      s.beats[2].do = [];
    };
    const check = changedHonest('flow', change);
    expect(brief(check.errors)).toEqual([
      ['NUMBER_NOT_IN_SOURCE', 'stage.nodes[2].label'],
      ['STAGE_UNKNOWN_REF', 'stage.edges[0].to'],
      ['ACTION_UNKNOWN_PART', 'beats[0].do[1].target'],
      ['CLIP_TOO_STATIC', 'beats'],
    ]);
    expect(JSON.stringify(changedHonest('flow', change).errors)).toBe(JSON.stringify(check.errors));
  });

  it('are capped, with a count of the rest', () => {
    const check = changedHonest('cells', (s) => {
      s.beats = Array.from({ length: 8 }, (_, i) => ({
        caption: i === 0 ? s.beats[1].caption : { type: 'framing', text: 'One more look at the same row.' },
        do: [{ verb: 'pulse', target: `x${i}a` }, { verb: 'pulse', target: `x${i}b` }, { verb: 'pulse', target: `x${i}c` }],
      }));
    });
    expect(check.errors).toHaveLength(MAX_ISSUES_PER_CALL + 1);
    expect(check.errors[MAX_ISSUES_PER_CALL]).toMatchObject({ code: 'MORE_ISSUES', got: '24', sceneId: 'h-cells' });
    expect(check.errors.slice(0, MAX_ISSUES_PER_CALL).every((e) => e.code === 'ACTION_UNKNOWN_PART')).toBe(true);
  });
});
