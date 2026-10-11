// Example clips for the `lines` and `timeline` stages: two of each. Tests compile, render and play
// them; the skill's format reference can show them.
//
// They belong to the example lesson in core/examples.ts (binary search) and cite its evidence, which
// is SYNTHETIC: e1 is the definition, e2 the cost, e3 why the data must be sorted. A caption that
// states a fact is a `claim` with `cites`; a caption that works a case through is an `example`.
// No clip here contains a duration, an easing, a coordinate or a colour.
import type { ClipScene } from './clip';
import { EXAMPLE_SCENES } from './examples';

/** The eleven lines of the example lesson's binary search, as its step-through shows them. */
const CODE: string[] = (() => {
  const scene = EXAMPLE_SCENES.find((s) => s.kind === 'step_through');
  const figure = scene && 'figure' in scene ? scene.figure : undefined;
  if (!figure || figure.type !== 'lines') throw new Error('The example lesson no longer has its code figure.');
  return [...figure.lines];
})();

/** `lines`, code: one search traced, with a pointer that travels, values that tick over, a bracket and an annotation. */
export const LINES_CODE_TRACE: ClipScene = {
  id: 'trace',
  kind: 'clip',
  title: 'One search, line by line',
  description:
    'The eleven-line binary search function. A pointer moves from line to line as 42 is searched for in a list of seven numbers, and the values of low, high and mid are shown beside the lines that set them. Three comparisons find it.',
  stage: {
    kind: 'lines',
    format: 'code',
    language: 'Python',
    lines: CODE,
    pointers: [{ id: 'pc' }],
    brackets: [{ id: 'loop', label: 'one pass' }],
    values: [
      { id: 'low', at: 'l2', label: 'low' },
      { id: 'high', at: 'l2', label: 'high' },
      { id: 'mid', at: 'l4', label: 'mid' },
    ],
    annotations: [{ id: 'why', at: 'l8', text: 'Sorted: nothing at or before mid can be 42.' }],
    stats: [
      { id: 'want', label: 'Looking for', value: '42' },
      { id: 'checks', label: 'Comparisons', value: 0 },
    ],
    cites: ['e1', 'e2', 'e3'],
    provenance: 'worked',
  },
  beats: [
    {
      caption: { type: 'example', text: 'Search [3, 8, 15, 23, 42, 57, 91] for 42. The interval is the whole list.', basedOn: ['e1'] },
      do: [
        { verb: 'move', target: 'pc', to: 'l2' },
        { verb: 'set', target: 'low', value: 0 },
        { verb: 'set', target: 'high', value: 6, with: true },
      ],
    },
    {
      caption: { type: 'example', text: 'Inside the loop, mid lands on position 3. That cell holds 23.' },
      do: [
        { verb: 'move', target: 'loop', to: ['l3', 'l10'] },
        { verb: 'move', target: 'pc', to: 'l4' },
        { verb: 'set', target: 'mid', value: 3 },
        { verb: 'set', target: 'checks', value: 1, with: true },
      ],
    },
    {
      caption: { type: 'claim', text: 'Because the list is sorted, the half that is discarded cannot contain the target.', cites: ['e3'] },
      gate: {
        prompt: '23 is less than 42. Which part of the list can be thrown away?',
        options: [
          { text: 'Everything up to and including position 3', correct: true, feedback: 'Yes. The list is sorted, so nothing at or before 23 can be 42.' },
          { text: 'Everything from position 3 onwards', correct: false, feedback: 'Those values are 23 or larger, and 42 is larger than 23, so it must be among them.' },
          { text: 'Nothing yet', correct: false, feedback: 'One comparison is enough: sorted order tells you which side 42 is on.' },
        ],
      },
      do: [
        { verb: 'move', target: 'pc', to: 'l8' },
        { verb: 'focus', between: ['l7', 'l8'], with: true },
        { verb: 'set', target: 'low', value: 4 },
        { verb: 'show', target: 'why' },
      ],
    },
    {
      caption: { type: 'example', text: 'Second pass: mid is 4 + (6 - 4) // 2 = 5, and that cell holds 57.' },
      do: [
        { verb: 'focus' },
        { verb: 'hide', target: 'why', with: true },
        { verb: 'move', target: 'pc', to: 'l4' },
        { verb: 'set', target: 'mid', value: 5 },
      ],
    },
    {
      caption: { type: 'example', text: '57 is greater than 42, so this time high drops to 4.' },
      do: [
        { verb: 'move', target: 'pc', to: 'l10' },
        { verb: 'set', target: 'high', value: 4 },
        { verb: 'set', target: 'checks', value: 2, with: true },
      ],
    },
    {
      caption: { type: 'example', text: 'Third pass: mid is 4, and items[4] is 42.' },
      do: [
        { verb: 'move', target: 'pc', to: 'l4' },
        { verb: 'set', target: 'mid', value: 4 },
        { verb: 'move', target: 'pc', to: 'l5' },
        { verb: 'set', target: 'checks', value: 3, with: true },
      ],
    },
    {
      caption: { type: 'claim', text: 'Found on the third comparison. Each one halved the interval that was left to search.', cites: ['e2'] },
      do: [
        { verb: 'move', target: 'pc', to: 'l6' },
        { verb: 'set', target: 'l6', tone: 'good' },
        { verb: 'focus', targets: ['l6'], with: true },
        { verb: 'hide', target: 'loop', with: true },
      ],
    },
  ],
};

/** `lines`, maths: a short derivation. Each line grows out of the one above it. */
export const LINES_DERIVATION: ClipScene = {
  id: 'halvings',
  kind: 'clip',
  title: 'How many halvings until one is left?',
  description:
    'A four-line derivation. Starting from n divided by 2 to the power k equals 1, it becomes n equals 2 to the k, then k equals log base 2 of n, and for a million items about 19.9: twenty comparisons are enough.',
  pace: 'calm',
  stage: {
    kind: 'lines',
    format: 'math',
    lines: ['\\frac{n}{2^k} = 1', 'n = 2^k', 'k = \\log_2 n', '\\log_2 10^6 \\approx 19.9'],
    values: [{ id: 'enough', at: 'l4', label: 'comparisons' }],
    stats: [{ id: 'items', label: 'Items', value: '1,000,000' }],
    cites: ['e2'],
    provenance: 'worked',
  },
  beats: [
    {
      caption: { type: 'claim', text: 'Each comparison halves what is left. After k of them, one item remains.', cites: ['e2'] },
      do: [{ verb: 'show', target: 'l1' }],
    },
    {
      caption: { type: 'example', text: 'Multiply both sides by 2 to the power k.' },
      do: [{ verb: 'show', target: 'l2' }],
    },
    {
      caption: { type: 'example', text: 'Take the logarithm, base 2, of both sides: k stands alone.' },
      do: [
        { verb: 'show', target: 'l3' },
        { verb: 'focus', targets: ['l3'] },
      ],
    },
    {
      caption: { type: 'example', text: 'For a million items that is about 19.9, so 20 comparisons are always enough.', basedOn: ['e2'] },
      do: [
        { verb: 'focus' },
        { verb: 'show', target: 'l4', with: true },
        { verb: 'set', target: 'enough', value: 20, on: '20 comparisons' },
        { verb: 'set', target: 'l4', tone: 'good', with: true },
      ],
    },
  ],
};

/** `timeline`, one track: a search of a million items, from the first step to the twentieth, with a marker, a span and a read-out. */
export const TIMELINE_HISTORY: ClipScene = {
  id: 'twenty',
  kind: 'clip',
  title: 'A million items, twenty steps',
  description:
    'A timeline of one binary search through 1,000,000 sorted items. It starts with a million candidates; after step 1 there are 500,000, after step 2 250,000, after step 5 31,250, after step 10 about a thousand, and after step 20 one. A bracket marks the whole run as 20 steps.',
  stage: {
    kind: 'timeline',
    events: [
      { id: 's0', when: 'start', label: '1,000,000 items could hold the target' },
      { id: 's1', when: 'step 1', label: '500,000 left' },
      { id: 's2', when: 'step 2', label: '250,000 left' },
      { id: 's5', when: 'step 5', label: '31,250 left' },
      { id: 's10', when: 'step 10', label: '977 left' },
      { id: 's20', when: 'step 20', label: '1 left: found, or not there', detail: 'Checking every item in turn could take 1,000,000 comparisons.' },
    ],
    spans: [{ id: 'run', from: 's0', to: 's20', label: '20 steps' }],
    markers: [{ id: 'now', label: 'now' }],
    stats: [{ id: 'left', label: 'Still possible', value: 1000000 }],
    cites: ['e2', 'e5'],
    provenance: 'worked',
  },
  beats: [
    {
      caption: { type: 'example', text: 'A sorted list of 1,000,000 items. Any one of them could be the target.', basedOn: ['e2'] },
      do: [
        { verb: 'show', target: 's0' },
        { verb: 'move', target: 'now', to: 's0' },
      ],
    },
    {
      caption: { type: 'example', text: 'Each comparison halves what is left: 500,000 after one, 250,000 after two.', basedOn: ['e2'] },
      do: [
        { verb: 'show', targets: ['s1', 's2'] },
        { verb: 'move', target: 'now', to: 's2' },
        { verb: 'set', target: 'left', value: 250000, with: true },
      ],
    },
    {
      caption: { type: 'example', text: 'Three more halvings leave 31,250. Ten in all leave fewer than a thousand.' },
      do: [
        { verb: 'draw', target: 'track', upto: 's10' },
        { verb: 'move', target: 'now', to: 's10' },
        { verb: 'set', target: 'left', value: 977, with: true },
      ],
    },
    {
      caption: { type: 'claim', text: 'Ten more halvings finish it: at most 20 steps for a million items.', cites: ['e2'] },
      gate: {
        prompt: 'Ten steps took a million down to about a thousand. How many more to get down to one?',
        options: [
          { text: 'About ten more', correct: true, feedback: 'Yes. Ten halvings divide by about a thousand, whatever you start from.' },
          { text: 'About five hundred more', correct: false, feedback: 'That would be halving the count of steps. Each step halves the items.' },
          { text: 'About a thousand more', correct: false, feedback: 'That is checking them one at a time. Each step still discards half.' },
        ],
      },
      do: [
        { verb: 'draw', target: 'track' },
        { verb: 'move', target: 'now', to: 's20' },
        { verb: 'set', target: 'left', value: 1, with: true },
        { verb: 'show', target: 'run' },
      ],
    },
    {
      caption: { type: 'claim', text: 'Twenty steps, where checking every item in turn could take a million.', cites: ['e5'] },
      do: [
        { verb: 'focus', targets: ['s20'] },
        { verb: 'set', target: 's20', tone: 'good', with: true },
      ],
    },
  ],
};

/** `timeline`, three lanes: low climbs, high falls and mid is caught between them, until all three meet. */
export const TIMELINE_LANES: ClipScene = {
  id: 'squeeze',
  kind: 'clip',
  title: 'Three positions close in',
  description:
    'Three parallel tracks, for low, high and mid, over three passes of one search for 42 in seven numbers. Low starts at 0 and high at 6. In pass 1 mid is 3 and low jumps to 4; in pass 2 mid is 5 and high drops to 4; in pass 3 all three are 4 and the target is found.',
  stage: {
    kind: 'timeline',
    lanes: [
      { id: 'low', label: 'low' },
      { id: 'mid', label: 'mid' },
      { id: 'high', label: 'high' },
    ],
    events: [
      { id: 'a1', when: 'start', lane: 'low', label: 'low = 0' },
      { id: 'a2', when: 'start', lane: 'high', label: 'high = 6' },
      { id: 'b1', when: 'pass 1', lane: 'mid', label: 'mid = 3 holds 23: too small' },
      { id: 'b2', when: 'pass 1', lane: 'low', label: 'low jumps to 4' },
      { id: 'c1', when: 'pass 2', lane: 'mid', label: 'mid = 5 holds 57: too big' },
      { id: 'c2', when: 'pass 2', lane: 'high', label: 'high drops to 4' },
      { id: 'd', when: 'pass 3', label: 'All three meet at 4: found', detail: 'low, high and mid name the same cell, and it holds 42.' },
    ],
    spans: [{ id: 'all', from: 'a1', to: 'd', label: 'three passes' }],
    markers: [{ id: 'now' }],
    stats: [{ id: 'width', label: 'Interval', value: 7, unit: ' cells' }],
    cites: ['e1'],
    provenance: 'worked',
  },
  beats: [
    {
      caption: { type: 'example', text: 'Searching seven sorted numbers for 42. Two positions fence the interval: low and high.', basedOn: ['e1'] },
      do: [{ verb: 'draw', targets: ['low', 'high'], upto: 'a2' }],
    },
    {
      caption: { type: 'example', text: 'Pass 1: mid lands on 23. Too small, so low jumps past it.' },
      do: [
        { verb: 'draw', target: 'track', upto: 'b2' },
        { verb: 'move', target: 'now', to: 'b2' },
        { verb: 'set', target: 'width', value: 3, with: true },
      ],
    },
    {
      caption: { type: 'example', text: 'Pass 2: mid lands on 57. Too big, so high drops below it.' },
      do: [
        { verb: 'draw', target: 'track', upto: 'c2' },
        { verb: 'move', target: 'now', to: 'c2' },
        { verb: 'set', target: 'width', value: 1, with: true },
      ],
    },
    {
      caption: { type: 'claim', text: 'Every pass discards the half that cannot contain the target: the fence only closes in.', cites: ['e1'] },
      do: [
        { verb: 'focus', targets: ['low', 'high'] },
        { verb: 'show', target: 'all' },
      ],
    },
    {
      caption: { type: 'example', text: 'Pass 3: low, high and mid are all 4, and that cell holds 42.' },
      do: [
        { verb: 'focus' },
        { verb: 'draw', target: 'track', with: true },
        { verb: 'move', target: 'now', to: 'd' },
        { verb: 'set', target: 'd', tone: 'good' },
      ],
    },
  ],
};

export const EXTRA_EXAMPLE_CLIPS: ClipScene[] = [LINES_CODE_TRACE, LINES_DERIVATION, TIMELINE_HISTORY, TIMELINE_LANES];
