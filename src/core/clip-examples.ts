// The example lesson (core/examples.ts, binary search) written as a v2 lesson: clips where v1 had
// narration and a step-through, and the same three checkpoints and recap. It cites the same
// SYNTHETIC evidence (e1..e5). Tests parse, render and play it; the skill's format reference shows it.
//
// There is not one duration, easing, coordinate or colour in this file. That is the format.
//
// How the lesson is shaped, for anyone writing one:
//   - it opens cold, on a question, before anything is explained (`words`);
//   - each clip is one stage and a handful of beats; a caption says what the picture cannot;
//   - a prediction (`gate`) sits on the beat that shows the outcome, so the learner commits first;
//     when the answer IS a part of the picture, the learner taps it (`gate.pick`) instead of
//     choosing from options;
//   - where the idea is a relationship between quantities, the clip ends by handing the stage over
//     (`explore`): a slider, formulas that tie parts to it, and a goal to reach by dragging
//     (EXPLORE_EXAMPLE_CLIPS at the bottom of this file);
//   - facts are `claim` captions with `cites`; a worked case is an `example`; a link or a question
//     is `framing`. The stage says where its own content comes from (`provenance`, `cites`).
import type { z } from 'zod';
import type { ClipScene, StageKind } from './clip';
import { LINES_CODE_TRACE } from './clip-kits-extra-examples';
import { EXAMPLE_SCENES } from './examples';
import { FRAME_EXAMPLE_SORT, frameExampleClip } from './frame-examples';
import type { EvidenceInput } from './schema';
import type { SceneInput } from './types';

/** A clip as an agent writes it: defaults (`do`, `cites`) may be left out. */
export type ClipSceneInput = z.input<typeof ClipScene>;
/** Any scene of a v2 lesson, as written. */
export type AnySceneInput = SceneInput | ClipSceneInput;

/** The v1 example's scene with this id, under a new id. The checkpoints and the recap are reused as they are. */
function reuse(v1Id: string, id: string): SceneInput {
  const scene = EXAMPLE_SCENES.find((s) => s.id === v1Id);
  if (!scene) throw new Error(`The example lesson has no scene "${v1Id}".`);
  return { ...scene, id };
}

/** Cold open: the problem, and the question the lesson answers. Kinetic type, nothing else. */
const COLD_OPEN: ClipSceneInput = {
  id: 'c1',
  kind: 'clip',
  title: 'One name in a million',
  description:
    'Large words on an empty stage. First "1,000,000 names". Then "One look at a time?", marked as a warning. Then both recede and the clip ends on the question "How few looks are enough?".',
  stage: {
    kind: 'words',
    lines: [
      { id: 'many', text: '1,000,000 names', size: 'xl' },
      { id: 'slow', text: 'One look at a time?', size: 'l' },
      { id: 'ask', text: 'How few looks are enough?', size: 'xl' },
    ],
    cites: ['e5'],
    provenance: 'illustrative',
  },
  beats: [
    { caption: { type: 'framing', text: 'A million names, in order. You want exactly one of them.' }, do: [{ verb: 'show', target: 'many' }] },
    {
      caption: { type: 'claim', text: 'Checking every element in turn can take as many looks as there are names.', cites: ['e5'] },
      do: [{ verb: 'show', target: 'slow' }, { verb: 'set', target: 'slow', tone: 'warn' }],
    },
    {
      caption: { type: 'framing', text: 'Before you read on, guess: how few looks could be enough, every time?' },
      do: [{ verb: 'show', target: 'ask' }, { verb: 'focus', targets: ['ask'], with: true }, { verb: 'set', target: 'ask', tone: 'accent' }],
    },
  ],
};

/** The loop as boxes and arrows. `found` is named by a `show`, so the others make room for it when it arrives. */
const THE_LOOP: ClipSceneInput = {
  id: 'c2',
  kind: 'clip',
  title: 'The loop, as a picture',
  description:
    'Four boxes in a row: a sorted list, look at the middle, is it the target, discard a half. Arrows join them in order, and one arrow runs back from "discard a half" to "look at the middle". At the end a fifth box, "found", appears, reached from the question by an arrow marked "yes".',
  stage: {
    kind: 'flow',
    nodes: [
      { id: 'list', label: 'Sorted list' },
      { id: 'middle', label: 'Look at the middle' },
      { id: 'ask', label: 'Is it the target?' },
      { id: 'discard', label: 'Discard a half' },
      { id: 'found', label: 'Found' },
    ],
    edges: [
      { id: 'begin', from: 'list', to: 'middle' },
      { id: 'check', from: 'middle', to: 'ask' },
      { id: 'no', from: 'ask', to: 'discard', label: 'no' },
      { id: 'again', from: 'discard', to: 'middle', label: 'repeat' },
      { id: 'yes', from: 'ask', to: 'found', label: 'yes' },
    ],
    cites: ['e1'],
    provenance: 'sourced',
  },
  beats: [
    { caption: { type: 'claim', text: 'Binary search works on a sorted array, and it repeats one move.', cites: ['e1'] }, do: [{ verb: 'draw', target: 'begin' }] },
    {
      caption: { type: 'claim', text: 'It compares the target with the middle element.', cites: ['e1'] },
      do: [{ verb: 'draw', target: 'check' }, { verb: 'pulse', target: 'ask' }],
    },
    {
      caption: { type: 'claim', text: 'If they differ, it discards the half that cannot contain the target.', cites: ['e1'] },
      do: [{ verb: 'draw', target: 'no' }, { verb: 'set', target: 'discard', tone: 'accent' }],
    },
    {
      caption: { type: 'framing', text: 'Then the same move again, on the half that is left.' },
      do: [{ verb: 'set', target: 'discard', tone: 'neutral' }, { verb: 'send', along: 'again', label: 'half left' }],
    },
    {
      caption: { type: 'framing', text: 'The loop ends when the middle element is the target.' },
      gate: {
        prompt: 'The middle element turns out to be the target. What does the search do?',
        options: [
          { text: 'It stops', correct: true, feedback: 'Yes. The comparison with the middle element is how the target is found.' },
          { text: 'It discards a half', correct: false, feedback: 'A half is discarded only when the middle element is not the target.' },
        ],
      },
      do: [{ verb: 'show', target: 'found' }, { verb: 'draw', target: 'yes' }, { verb: 'set', target: 'found', tone: 'good' }],
    },
  ],
};

/** The trace: seven cells, three pointers, the range that is still possible, and two predictions: one from options, one tapped on the row. */
const THE_TRACE: ClipSceneInput = {
  id: 'c3',
  kind: 'clip',
  title: 'Trace it: one search, start to finish',
  description:
    'Seven sorted numbers in a row: 3, 8, 15, 23, 42, 57, 91, with pointers low, mid and high. The search is for 42. The middle, 23, is too small, so the first four cells are ruled out. The middle of the rest, 57, is too big, so it and 91 are ruled out. One cell is left: 42, found on the third comparison.',
  stage: {
    kind: 'cells',
    indices: true,
    cells: [
      { id: 'c0', label: '3' },
      { id: 'c1', label: '8' },
      { id: 'c2', label: '15' },
      { id: 'c3', label: '23' },
      { id: 'c4', label: '42' },
      { id: 'c5', label: '57' },
      { id: 'c6', label: '91' },
    ],
    pointers: [
      { id: 'low', label: 'low' },
      { id: 'high', label: 'high' },
      { id: 'mid', label: 'mid', side: 'above' },
    ],
    brackets: [{ id: 'range', label: 'still possible' }],
    stats: [
      { id: 'want', label: 'Looking for', value: '42' },
      { id: 'count', label: 'Comparisons', value: 0 },
    ],
    cites: ['e1', 'e3'],
    provenance: 'worked',
  },
  beats: [
    {
      caption: { type: 'example', text: 'Search for 42. Every position from 0 to 6 is still possible.', basedOn: ['e1'] },
      do: [
        { verb: 'move', target: 'range', to: ['c0', 'c6'] },
        { verb: 'move', target: 'low', to: 'c0' },
        { verb: 'move', target: 'high', to: 'c6', with: true },
      ],
    },
    {
      caption: { type: 'example', text: 'The middle is position 3. It holds 23, which is less than 42.' },
      do: [
        { verb: 'move', target: 'mid', to: 'c3' },
        { verb: 'pulse', target: 'c3' },
        { verb: 'set', target: 'c3', tone: 'warn', with: true },
        { verb: 'set', target: 'count', value: 1, with: true },
      ],
    },
    {
      gate: {
        prompt: '23 is less than 42. Which part of the list can be thrown away?',
        options: [
          { text: 'Everything up to and including position 3', correct: true, feedback: 'Yes. The list is sorted, so nothing at or before 23 can be 42.' },
          { text: 'Everything from position 3 onwards', correct: false, feedback: 'Those values are 23 or larger, and 42 is larger than 23, so it must be among them.' },
          { text: 'Nothing yet', correct: false, feedback: 'One comparison is enough: sorted order tells you which side 42 is on.' },
        ],
      },
      caption: { type: 'claim', text: 'Because the list is sorted, the half that is discarded cannot contain the target.', cites: ['e3'] },
      do: [
        { verb: 'focus', between: ['c4', 'c6'] },
        { verb: 'move', target: 'low', to: 'c4', with: true },
        { verb: 'move', target: 'range', to: ['c4', 'c6'], with: true },
      ],
    },
    {
      // The answer is a cell, so the learner answers on the row itself.
      gate: {
        prompt: 'Three cells are still possible. Tap the one the search looks at next.',
        pick: ['c5'],
        right: 'Yes. The middle of positions 4 to 6 is position 5, the cell that holds 57.',
        wrong: 'The search always looks at the middle of what is still possible. Find the middle of the three cells in the bracket.',
      },
      caption: { type: 'example', text: 'Middle of what is left: position 5 holds 57. Too big.' },
      do: [
        { verb: 'move', target: 'mid', to: 'c5' },
        { verb: 'set', target: 'c5', tone: 'warn' },
        { verb: 'set', target: 'count', value: 2, with: true },
      ],
    },
    {
      caption: { type: 'example', text: 'So 57 and everything after it goes. One cell is left.' },
      do: [
        { verb: 'focus', between: ['c4', 'c4'] },
        { verb: 'move', target: 'high', to: 'c4', with: true },
        { verb: 'move', target: 'range', to: ['c4', 'c4'], with: true },
      ],
    },
    {
      caption: { type: 'claim', text: 'Found on the third comparison. Each comparison halved the interval that was left.', cites: ['e2'] },
      do: [
        { verb: 'move', target: 'mid', to: 'c4' },
        { verb: 'set', target: 'c4', tone: 'good' },
        { verb: 'set', target: 'count', value: 3, with: true },
        { verb: 'focus', targets: ['c4'], zoom: true },
      ],
    },
  ],
};

/** Why it is fast: two lines drawn against the size of the list, with a prediction before the second. */
const THE_COST: ClipSceneInput = {
  id: 'c4',
  kind: 'clip',
  title: 'Why it is fast',
  description:
    'A line chart of worst-case comparisons against the number of items, from 8 to 4,096. The linear search line climbs steeply to 4,096 comparisons. The binary search line stays almost flat and ends at 13. The steps along the axis are not equal amounts: each list is eight times as long as the one before.',
  stage: {
    kind: 'chart',
    mark: 'line',
    yLabel: 'Worst-case comparisons',
    xs: ['8', '64', '512', '4,096'],
    series: [
      { id: 'linear', label: 'Linear search', values: [8, 64, 512, 4096], tone: 'neutral' },
      { id: 'binary', label: 'Binary search', values: [4, 7, 10, 13], tone: 'accent' },
    ],
    stats: [
      { id: 'lin', label: 'Linear, 4,096 items', value: 0 },
      { id: 'bin', label: 'Binary, 4,096 items', value: 0 },
    ],
    cites: ['e2', 'e5'],
    provenance: 'worked',
  },
  beats: [
    {
      caption: { type: 'claim', text: 'Linear search needs up to n comparisons for n elements: its cost climbs with the list.', cites: ['e5'] },
      do: [{ verb: 'draw', target: 'linear' }, { verb: 'set', target: 'lin', value: 4096, on: 'climbs' }],
    },
    {
      gate: {
        prompt: 'The list grows from 8 items to 4,096. Where does the binary search line end?',
        options: [
          { text: 'Almost flat: about 13 comparisons', correct: true, feedback: 'Yes. Every doubling of the list adds just one comparison.' },
          { text: 'Half as high as linear search: about 2,000', correct: false, feedback: 'Halving happens at every comparison, not once, so the saving compounds.' },
          { text: 'As high as linear search', correct: false, feedback: 'That would mean no half was ever discarded. Each comparison discards one.' },
        ],
      },
      caption: { type: 'claim', text: 'Binary search needs at most about log2(n) + 1 comparisons, because each one halves the interval.', cites: ['e2'] },
      do: [{ verb: 'draw', target: 'binary' }, { verb: 'set', target: 'bin', value: 13, on: 'because' }, { verb: 'set', target: 'bin', tone: 'accent', with: true }],
    },
    {
      caption: { type: 'example', text: 'Each step on this axis is a list eight times longer; binary search adds three comparisons.', basedOn: ['e2', 'e5'] },
      do: [{ verb: 'focus', targets: ['binary'] }, { verb: 'pulse', target: 'bin' }],
    },
  ],
};

/** The same idea as a crowd: a thousand items, halved until one is left. */
const THE_HALVING: ClipSceneInput = {
  id: 'c5',
  kind: 'clip',
  title: 'A thousand items, ten looks',
  description:
    'One thousand dots, one for each item of a sorted list. Half of them are ruled out and move aside, then half of what is left, and again, until a single dot remains after ten comparisons.',
  pace: 'calm',
  // After the halving, the learner drags the comparisons back and watches what is still possible grow.
  explore: {
    prompt: 'Drag the comparisons back and watch what is left.',
    controls: [{ id: 'looks', label: 'Comparisons', min: 2, max: 10, step: 1, value: 10 }],
    bind: [
      { target: 'one', expr: '1000 / 2^looks' },
      { target: 'looks', expr: 'looks' },
    ],
  },
  stage: {
    kind: 'dots',
    total: 1000,
    legend: '1 dot = 1 item',
    group: { id: 'all', label: 'Sorted items' },
    stats: [{ id: 'looks', label: 'Comparisons', value: 0 }],
    cites: ['e1', 'e2'],
    provenance: 'worked',
  },
  beats: [
    { caption: { type: 'framing', text: 'Picture a sorted list of a thousand items. The target is one of them.' } },
    {
      caption: { type: 'claim', text: 'One comparison with the middle element rules out half of them.', cites: ['e1'] },
      do: [
        {
          verb: 'split',
          target: 'all',
          into: [
            { id: 'left1', label: 'Still possible', count: 500, tone: 'accent' },
            { id: 'out1', label: 'Ruled out', count: 500, tone: 'muted' },
          ],
          pick: 'first',
        },
        { verb: 'set', target: 'looks', value: 1, with: true },
      ],
    },
    {
      caption: { type: 'claim', text: 'The next comparison halves the remaining interval again.', cites: ['e2'] },
      do: [
        {
          verb: 'split',
          target: 'left1',
          into: [
            { id: 'left2', label: 'Still possible', count: 250, tone: 'accent' },
            { id: 'out2', label: 'Ruled out', count: 250, tone: 'muted' },
          ],
          pick: 'first',
        },
        { verb: 'set', target: 'looks', value: 2, with: true },
        { verb: 'merge', targets: ['out2', 'out1'], into: { id: 'out', label: 'Ruled out', tone: 'muted' } },
      ],
    },
    {
      caption: { type: 'example', text: 'Keep halving: 125, 63, 32, 16, 8, 4, 2, 1. Ten comparisons, one item left.', basedOn: ['e2'] },
      do: [
        {
          verb: 'split',
          target: 'left2',
          into: [
            { id: 'one', label: 'Still possible', count: 1, tone: 'good' },
            { id: 'out3', label: 'Ruled out', count: 249, tone: 'muted' },
          ],
        },
        { verb: 'set', target: 'looks', value: 10, with: true },
        { verb: 'merge', targets: ['out3', 'out'], into: { id: 'gone', label: 'Ruled out', tone: 'muted' } },
      ],
    },
    {
      caption: { type: 'claim', text: 'A sorted list of 1,000,000 items is searched in at most 20 steps.', cites: ['e2'] },
      do: [{ verb: 'focus', targets: ['one'] }, { verb: 'set', target: 'looks', tone: 'good', with: true }],
    },
  ],
};

/** Where it goes wrong: the same row, unsorted, and the midpoint formula as a read-out that is rewritten. */
const THE_TRAPS: ClipSceneInput = {
  id: 'c6',
  kind: 'clip',
  title: 'Two ways it goes wrong',
  description:
    'Seven numbers that are not in order: 42, 91, 3, 23, 8, 57, 15. The search for 42 looks at the middle, 23, and discards the first four cells, which include the 42 it wanted. Then a read-out showing the midpoint as (low + high) / 2 is rewritten to low + (high - low) / 2.',
  stage: {
    kind: 'cells',
    cells: [
      { id: 'u0', label: '42' },
      { id: 'u1', label: '91' },
      { id: 'u2', label: '3' },
      { id: 'u3', label: '23' },
      { id: 'u4', label: '8' },
      { id: 'u5', label: '57' },
      { id: 'u6', label: '15' },
    ],
    pointers: [{ id: 'mid', label: 'mid', side: 'above' }],
    brackets: [{ id: 'kept', label: 'kept' }],
    stats: [
      { id: 'want', label: 'Looking for', value: '42' },
      { id: 'formula', label: 'Midpoint', value: '(low + high) / 2' },
    ],
    cites: ['e3', 'e4'],
    provenance: 'worked',
  },
  beats: [
    {
      caption: { type: 'claim', text: 'Binary search is only reliable when the data is sorted. This row is not.', cites: ['e3'] },
      do: [{ verb: 'move', target: 'mid', to: 'u3' }, { verb: 'set', target: 'u3', tone: 'warn', with: true }],
    },
    {
      caption: { type: 'example', text: '23 is less than 42, so the search keeps the right half and discards the left.' },
      do: [{ verb: 'move', target: 'kept', to: ['u4', 'u6'] }, { verb: 'focus', between: ['u4', 'u6'], with: true }],
    },
    {
      caption: { type: 'quote', text: 'the half that is discarded may contain the target', cite: 'e3' },
      do: [{ verb: 'focus', targets: ['u0'] }, { verb: 'set', target: 'u0', tone: 'bad', with: true }, { verb: 'hide', target: 'kept', with: true }],
    },
    {
      caption: { type: 'claim', text: 'A second trap: adding low and high before dividing can overflow a fixed-width integer.', cites: ['e4'] },
      do: [{ verb: 'focus' }, { verb: 'set', target: 'formula', tone: 'bad', with: true }, { verb: 'pulse', target: 'formula' }],
    },
    {
      caption: { type: 'claim', text: 'Writing it as low + (high - low) / 2 avoids the overflow.', cites: ['e4'] },
      do: [{ verb: 'set', target: 'formula', value: 'low + (high - low) / 2' }, { verb: 'set', target: 'formula', tone: 'good', with: true }],
    },
  ],
};

/**
 * The example lesson as clips: a cold open, the loop, the trace (with two predictions, the second tapped on the row), a checkpoint,
 * why it is fast (with a prediction), the halving as a crowd, a checkpoint, the traps, a checkpoint,
 * and the recap. Scene ids c1..c6 are clips; q1..q3 and `end` are the v1 example's scenes s4, s6, s8, s9.
 */
export const EXAMPLE_V2_SCENES: AnySceneInput[] = [COLD_OPEN, THE_LOOP, THE_TRACE, reuse('s4', 'q1'), THE_COST, THE_HALVING, reuse('s6', 'q2'), THE_TRAPS, reuse('s8', 'q3'), reuse('s9', 'end')];

// ---------------------------------------------------------------------------------------------
// One small valid clip for every stage kind
// ---------------------------------------------------------------------------------------------

const SEQUENCE_CLIP: ClipSceneInput = {
  id: 'k-sequence',
  kind: 'clip',
  title: 'Who asks whom',
  description: 'Two columns, your code and the search function. Your code sends "find 42", and the function answers "position 4".',
  stage: {
    kind: 'sequence',
    actors: [
      { id: 'caller', label: 'Your code' },
      { id: 'search', label: 'binary_search' },
    ],
    messages: [
      { id: 'call', from: 'caller', to: 'search', label: 'find 42' },
      { id: 'lost', from: 'caller', to: 'search', label: 'find 42 again' },
      { id: 'result', from: 'search', to: 'caller', label: 'position 4' },
    ],
    stats: [{ id: 'calls', label: 'Calls', value: 0, at: 'caller' }],
    provenance: 'illustrative',
  },
  beats: [
    { caption: { type: 'example', text: 'Your code asks the function for 42.' }, do: [{ verb: 'send', target: 'call' }, { verb: 'set', target: 'calls', value: 1, with: true }] },
    { caption: { type: 'framing', text: 'A request can also be lost on the way.' }, do: [{ verb: 'send', target: 'lost', outcome: 'lost' }] },
    { caption: { type: 'claim', text: 'Binary search finds the target value and answers with its position.', cites: ['e1'] }, do: [{ verb: 'send', target: 'result' }, { verb: 'set', target: 'search', tone: 'good' }] },
  ],
};

const CELLS_CLIP: ClipSceneInput = {
  id: 'k-cells',
  kind: 'clip',
  title: 'Sort five cells',
  description: 'Five numbered cells, out of order. Two of them swap places, then the whole row is put in order.',
  stage: {
    kind: 'cells',
    cells: [
      { id: 'a', label: '5' },
      { id: 'b', label: '2' },
      { id: 'c', label: '9' },
      { id: 'd', label: '1' },
      { id: 'e', label: '7' },
    ],
    pointers: [{ id: 'i', label: 'i' }],
    provenance: 'illustrative',
  },
  beats: [
    { caption: { type: 'framing', text: 'A pointer walks to the smallest cell.' }, do: [{ verb: 'move', target: 'i', to: 'a' }, { verb: 'move', target: 'i', to: 'd' }] },
    { caption: { type: 'framing', text: 'Two cells trade places.' }, do: [{ verb: 'hide', target: 'i' }, { verb: 'swap', a: 'a', b: 'd' }] },
    { caption: { type: 'claim', text: 'The row sorts itself, and binary search only works when the data is sorted.', cites: ['e3'] }, do: [{ verb: 'reorder', order: ['d', 'b', 'a', 'e', 'c'] }, { verb: 'set', between: ['d', 'c'], tone: 'good' }] },
  ],
};

const BARS_CLIP: ClipSceneInput = {
  id: 'k-chart',
  kind: 'clip',
  title: 'Comparisons for a thousand items',
  description: 'Two bars. Linear search: 1,000 comparisons. Binary search: 10. The binary search bar is then marked as the better one.',
  stage: {
    kind: 'chart',
    mark: 'bars',
    yLabel: 'Worst-case comparisons',
    bars: [
      { id: 'lin', label: 'Linear search', value: 1000, tone: 'neutral' },
      { id: 'bin', label: 'Binary search', value: 10 },
    ],
    cites: ['e2', 'e5'],
    provenance: 'worked',
  },
  beats: [
    { caption: { type: 'claim', text: 'Linear search needs up to n comparisons for a list of n elements.', cites: ['e5'] }, do: [{ verb: 'pulse', target: 'lin' }] },
    { caption: { type: 'claim', text: 'Binary search needs at most about log2(n) + 1.', cites: ['e2'] }, do: [{ verb: 'focus', targets: ['bin'] }, { verb: 'set', target: 'bin', tone: 'good' }] },
  ],
};

const TIMELINE_CLIP: ClipSceneInput = {
  id: 'k-timeline',
  kind: 'clip',
  title: 'Three comparisons',
  description: 'Three moments in order along a track. After the first comparison half of the array is left, after the second a quarter, after the third an eighth.',
  stage: {
    kind: 'timeline',
    events: [
      { id: 't1', when: '1st comparison', label: 'Half is left' },
      { id: 't2', when: '2nd comparison', label: 'A quarter is left' },
      { id: 't3', when: '3rd comparison', label: 'An eighth is left' },
    ],
    cites: ['e2'],
    provenance: 'sourced',
  },
  beats: [
    { caption: { type: 'claim', text: 'Each comparison halves the remaining search interval.', cites: ['e2'] }, do: [{ verb: 'focus', targets: ['t1'] }] },
    { caption: { type: 'framing', text: 'Three comparisons in, an eighth of the array is left.' }, do: [{ verb: 'focus', targets: ['t3'] }, { verb: 'set', target: 't3', tone: 'good' }] },
  ],
};

/**
 * One small valid clip for every stage kind. `chart` is the bars form here; the lesson above has the line form.
 * Each cites the example lesson's evidence, except `frame`: the bubble sort of ./frame-examples
 * cites the passage that example carries with it (FRAME_EXAMPLE_SORT.evidence, stored as e1).
 */
export const EXAMPLE_CLIPS: Record<StageKind, ClipSceneInput> = {
  sequence: SEQUENCE_CLIP,
  cells: CELLS_CLIP,
  dots: { ...THE_HALVING, id: 'k-dots' },
  chart: BARS_CLIP,
  flow: { ...THE_LOOP, id: 'k-flow' },
  words: { ...COLD_OPEN, id: 'k-words' },
  lines: { ...LINES_CODE_TRACE, id: 'k-lines' },
  timeline: TIMELINE_CLIP,
  frame: { ...frameExampleClip(FRAME_EXAMPLE_SORT), id: 'k-frame' },
};

// ---------------------------------------------------------------------------------------------
// Explore: three clips that end by handing the stage to the learner
// ---------------------------------------------------------------------------------------------
//
// What they show, for anyone writing one:
//   - the beats set the scene with the sliders at their starting values, and the stage's own
//     numbers ARE the formulas' values there, so nothing jumps when the stage is handed over;
//   - a control's id is its name in formulas; a binding ties one part's number to the controls;
//   - the goal says what to make happen in the learner's terms, never the setting that does it and
//     never a number to read off. It is false where the sliders start, and it is not reached by
//     dragging a slider to its end: it holds inside the range, at a place the learner has to find
//     by understanding what the picture does. Its `done` says why it worked;
//   - the stage is "worked" or "illustrative": dragging puts numbers on screen that no passage
//     contains. What the captions state as fact is still a `claim` that cites a passage.

/**
 * The passages the two clips below that are not about searching rest on. Like the example lesson's
 * own evidence they are SYNTHETIC: written for these examples, on hosts reserved for documentation.
 * A lesson that carries these clips stores them after the example lesson's five, as e6 to e9.
 */
export const EXPLORE_EXAMPLE_EVIDENCE: EvidenceInput[] = [
  {
    url: 'https://example.org/screening/how-common',
    title: 'How common the condition is (synthetic test source)',
    publisher: 'Example Screening Handbook',
    excerpt: 'The condition is rare among the people who are tested: about 10 of every 1,000 people tested have it.',
    via: 'page',
  },
  {
    url: 'https://example.org/screening/what-the-test-gets-right',
    title: 'What the test gets right and wrong (synthetic test source)',
    publisher: 'Example Screening Handbook',
    excerpt:
      'The test is good but not perfect. Of every 10 people who have the condition, it finds 9. Of every 100 people who do not have the condition, 9 test positive anyway.',
    via: 'page',
  },
  {
    url: 'https://example.com/economics/supply-and-demand',
    title: 'Supply and demand (synthetic test source)',
    publisher: 'Example Economics Primer',
    excerpt: 'When the price of a good rises, buyers want less of it, and sellers are willing to offer more of it for sale.',
    via: 'page',
  },
  {
    url: 'https://example.com/economics/the-market-price',
    title: 'The market price (synthetic test source)',
    publisher: 'Example Economics Primer',
    excerpt: 'The market price settles where the two meet: the price at which the amount offered for sale equals the amount buyers want.',
    via: 'page',
  },
];

/**
 * Dots: a thousand people and a test. The slider is how common the condition is. `sick` drives the
 * first cut, `tp` and `fa` the cuts inside each side; whatever they do not take stays where it was
 * split from. The second prediction is tapped: the answer is one of the groups. The goal is a
 * tipping point part-way along the slider: neither end of it reaches it.
 */
const EXPLORE_DOTS: ClipSceneInput = {
  id: 'x-dots',
  kind: 'clip',
  title: 'A positive result, in a crowd',
  description:
    'One thousand dots, one for each person tested. Ten have the condition, and the test finds nine of them. Of the 990 who do not have it, 89 test positive anyway. So of 98 positive results, only 9 are right. A slider then changes how common the condition is, and the groups of true positives and false alarms resize with it.',
  stage: {
    kind: 'dots',
    total: 1000,
    legend: '1 dot = 1 person',
    group: { id: 'all', label: 'People tested' },
    stats: [{ id: 'right', label: 'A positive is right', value: 0, unit: '%' }],
    cites: ['e6', 'e7'],
    provenance: 'worked',
  },
  beats: [
    { caption: { type: 'framing', text: 'A test for a rare condition comes back positive. How worried should that person be?' } },
    {
      caption: { type: 'claim', text: 'About 10 of every 1,000 people tested have the condition.', cites: ['e6'] },
      do: [
        {
          verb: 'split',
          target: 'all',
          into: [
            { id: 'sick', label: 'Have it', count: 10, tone: 'warn' },
            { id: 'well', label: 'Do not have it', count: 990 },
          ],
        },
      ],
    },
    {
      caption: { type: 'claim', text: 'Of every 10 people who have the condition, the test finds 9.', cites: ['e7'] },
      do: [
        {
          verb: 'split',
          target: 'sick',
          into: [
            { id: 'tp', label: 'True positives', count: 9, tone: 'accent' },
            { id: 'missed', label: 'Missed', count: 1, tone: 'muted' },
          ],
          pick: 'first',
        },
      ],
    },
    {
      gate: {
        prompt: 'Of every 100 people who do not have the condition, 9 test positive anyway. Tap the group that will give more positive results.',
        pick: ['well'],
        right: 'Yes. 9 in every 100 of 990 people is 89 positives, far more than the 9 from the people who have it.',
        wrong: 'Compare the sizes of the groups before the percentages: one of them is a hundred times larger.',
      },
      caption: { type: 'example', text: 'Among the 990 others, 9 in every 100 is 89 false alarms.', basedOn: ['e7'] },
      do: [
        {
          verb: 'split',
          target: 'well',
          into: [
            { id: 'fa', label: 'False alarms', count: 89, tone: 'bad' },
            { id: 'clear', label: 'Cleared', count: 901, tone: 'muted' },
          ],
          pick: 'first',
        },
      ],
    },
    {
      caption: { type: 'example', text: 'So 98 people test positive, and only 9 of them have the condition.', basedOn: ['e6', 'e7'] },
      do: [
        { verb: 'merge', targets: ['clear', 'missed'], into: { id: 'neg', label: 'Negative results', tone: 'muted' } },
        { verb: 'show', target: 'right' },
        { verb: 'set', target: 'right', value: 9, with: true },
        { verb: 'set', target: 'right', tone: 'warn', with: true },
      ],
    },
  ],
  explore: {
    prompt: 'Drag to change how common the condition is. Watch the true positives against the false alarms.',
    controls: [{ id: 'rate', label: 'People who have it', min: 1, max: 50, step: 1, value: 1, unit: '%' }],
    bind: [
      { target: 'sick', expr: '10 * rate' },
      { target: 'tp', expr: 'round(9 * rate)' },
      { target: 'fa', expr: 'round(0.09 * (1000 - 10 * rate))' },
      { target: 'right', expr: 'round(100 * round(9 * rate) / (round(9 * rate) + round(0.09 * (1000 - 10 * rate))))' },
    ],
    goal: {
      text: 'Find the crowd in which a positive result is a coin flip: as likely right as wrong.',
      when: 'abs(round(9 * rate) - round(0.09 * (1000 - 10 * rate))) <= 9',
      done: 'Here the true positives have drawn level with the false alarms. Nothing about the test changed: only how common the condition is.',
    },
  },
};

/**
 * A curve chart: supply and demand, with two sliders. Each curve is a formula in x that names one
 * slider, so each slider moves one curve and leaves the other still to compare against. The point
 * rides the supply curve at the x where the two cross, and the read-outs are bound to the same
 * crossing. The prediction is tapped on a curve. The goal needs both sliders: either one alone
 * moves the price.
 */
const EXPLORE_CURVE: ClipSceneInput = {
  id: 'x-curve',
  kind: 'clip',
  title: 'Where a price comes from',
  description:
    'A chart of price against cups of coffee a day. The supply curve rises from left to right; the demand curve falls. They cross where 60 cups sell at a price of 5.00, and a point marks the crossing. Two sliders then shift demand and the sellers\' costs: each moves one curve, and the crossing, the price and the number of cups sold move with it.',
  stage: {
    kind: 'chart',
    mark: 'curve',
    yLabel: 'Price of a cup',
    x: { label: 'Cups a day', min: 0, max: 140 },
    min: 0,
    max: 12,
    curves: [
      { id: 'supply', label: 'Supply', expr: '2 + costs + 0.05 * x', tone: 'neutral' },
      { id: 'demand', label: 'Demand', expr: '8 + demand - 0.05 * x', tone: 'accent' },
    ],
    points: [{ id: 'cross', label: 'Market price', x: '60 + 10 * (demand - costs)', on: 'supply' }],
    stats: [
      { id: 'price', label: 'Price', value: 5 },
      { id: 'sold', label: 'Cups sold', value: 60 },
    ],
    cites: ['e8', 'e9'],
    provenance: 'illustrative',
  },
  beats: [
    { caption: { type: 'framing', text: 'A coffee stall. What decides the price of a cup?' } },
    { caption: { type: 'claim', text: 'When the price rises, sellers are willing to offer more.', cites: ['e8'] }, do: [{ verb: 'draw', target: 'supply' }] },
    { caption: { type: 'claim', text: 'And buyers want less.', cites: ['e8'] }, do: [{ verb: 'draw', target: 'demand' }] },
    {
      caption: { type: 'claim', text: 'The price settles where the amount offered equals the amount buyers want.', cites: ['e9'] },
      do: [
        { verb: 'show', target: 'cross' },
        { verb: 'show', targets: ['price', 'sold'], with: true },
      ],
    },
    {
      gate: {
        prompt: 'A cold snap: at every price, more people want a hot coffee. Tap the curve that moves.',
        pick: ['demand'],
        right: 'Yes. What buyers want at each price is the demand curve; nothing has changed for the sellers.',
        wrong: 'Ask who changed their mind. The weather changed what buyers want, not what sellers offer.',
      },
      caption: { type: 'framing', text: 'Made-up numbers, real rule. Now move the market yourself.' },
      do: [{ verb: 'pulse', target: 'demand' }],
    },
  ],
  explore: {
    prompt: 'Move demand, the sellers\' costs, or both. Watch where the curves cross.',
    controls: [
      { id: 'demand', label: 'Shift in demand', min: -2.5, max: 2.5, step: 0.5, value: 0 },
      { id: 'costs', label: 'Change in costs', min: -3.5, max: 1.5, step: 0.5, value: 0 },
    ],
    bind: [
      { target: 'price', expr: '5 + 0.5 * demand + 0.5 * costs' },
      { target: 'sold', expr: '60 + 10 * (demand - costs)' },
    ],
    goal: {
      text: 'Sell more cups a day without the price moving.',
      when: 'abs(demand + costs) < 0.01 and demand - costs > 0',
      done: 'Stronger demand lifts the price and cheaper supply pulls it back down. Moved in step, the two cancel, and only the cups sold grow.',
    },
  },
};

/**
 * Bars: the two searches, with the size of the list on a slider. The bars and the read-out are
 * bound; the chart's scale is fixed for the whole range, so the linear bar visibly outgrows the
 * other. The goal is one place inside the range: the last list before binary search pays again.
 */
const EXPLORE_BARS: ClipSceneInput = {
  id: 'x-bars',
  kind: 'clip',
  title: 'Make the list longer',
  description:
    'Two bars: the most comparisons linear search and binary search need for a list of 20 items, 20 against 5. A slider then changes the size of the list from 2 to 64 items. The linear search bar grows with every item; the binary search bar steps up only when the list doubles.',
  stage: {
    kind: 'chart',
    mark: 'bars',
    yLabel: 'Worst-case comparisons',
    bars: [
      { id: 'lin', label: 'Linear search', value: 20, tone: 'neutral' },
      { id: 'bin', label: 'Binary search', value: 5 },
    ],
    stats: [{ id: 'times', label: 'Linear needs', value: 4, unit: '× as many' }],
    cites: ['e2', 'e5'],
    provenance: 'worked',
  },
  beats: [
    { caption: { type: 'claim', text: 'Linear search needs up to n comparisons for a list of n elements.', cites: ['e5'] }, do: [{ verb: 'pulse', target: 'lin' }] },
    { caption: { type: 'claim', text: 'Binary search needs at most about log2(n) + 1.', cites: ['e2'] }, do: [{ verb: 'pulse', target: 'bin' }] },
    { caption: { type: 'example', text: 'For 20 items that is 20 against 5. What happens as the list grows?', basedOn: ['e2', 'e5'] }, do: [{ verb: 'pulse', target: 'times' }] },
  ],
  explore: {
    prompt: 'Drag to change the size of the list. Watch how differently the two bars grow.',
    controls: [{ id: 'n', label: 'Items in the list', min: 2, max: 64, step: 1, value: 20 }],
    bind: [
      { target: 'lin', expr: 'n' },
      { target: 'bin', expr: 'floor(log2(n)) + 1' },
      { target: 'times', expr: 'n / (floor(log2(n)) + 1)' },
    ],
    goal: {
      text: 'Find the longest list that costs binary search no more comparisons than this one did.',
      when: 'floor(log2(n)) + 1 == 5 and floor(log2(n + 1)) + 1 == 6',
      done: 'One more item and binary search needs another comparison: it pays again only when a list doubles. Linear search paid for every item you added.',
    },
  },
};

/**
 * Three clips that end in an explore, one per kind of stage that a formula can drive in its own
 * way: groups of dots, a curve chart (with two sliders), and bars. The bars clip cites the example
 * lesson's evidence; the other two cite EXPLORE_EXAMPLE_EVIDENCE, stored after it as e6 to e9.
 */
export const EXPLORE_EXAMPLE_CLIPS: Record<'dots' | 'curve' | 'bars', ClipSceneInput> = { dots: EXPLORE_DOTS, curve: EXPLORE_CURVE, bars: EXPLORE_BARS };
