// A complete lesson that passes every rule, plus one valid figure and question of each type.
// Tests render and validate these; the skill's format reference shows them.
//
// The evidence is SYNTHETIC: the excerpts were written for this fixture and the example.* hosts are
// reserved for documentation. Nothing here is a real citation, and the titles say so.
import type { EvidenceInput, FigureType, PlanInput, QuestionType } from './schema';
import type { FigureInput, QuestionInput, SceneInput, StartInputRaw } from './types';

export const EXAMPLE_START: StartInputRaw = {
  topic: 'How binary search works',
  language: 'en',
  depth: 'standard',
  learner: {
    level: 'new',
    knows: 'Writes simple loops in Python. Has not studied algorithms and guessed that searching a list always means checking every item.',
    goal: 'Write binary search from memory and explain why it is fast.',
    calibration: [
      { question: 'In a sentence or two, how would you find one name in a sorted list of a million names?', answer: 'Start at the top and check each one until I find it.' },
      { question: 'What do you want to be able to do after this?', answer: 'Write it myself in Python and say why it is quicker.' },
    ],
  },
};

export const EXAMPLE_EVIDENCE: EvidenceInput[] = [
  {
    url: 'https://example.org/algorithms/binary-search',
    title: 'Binary search (synthetic test source)',
    publisher: 'Example Algorithms Handbook',
    excerpt:
      'Binary search finds a target value in a sorted array by repeatedly comparing the target with the middle element and discarding the half that cannot contain it.',
    via: 'page',
  },
  {
    url: 'https://example.org/algorithms/binary-search-cost',
    title: 'Cost of binary search (synthetic test source)',
    publisher: 'Example Algorithms Handbook',
    excerpt:
      'Each comparison halves the remaining search interval, so an array of n elements needs at most about log2(n) + 1 comparisons. A sorted list of 1,000,000 items is searched in at most 20 steps.',
    via: 'page',
  },
  {
    url: 'https://example.com/notes/when-binary-search-fails',
    title: 'When binary search fails (synthetic test source)',
    publisher: 'Example Course Notes',
    excerpt:
      'Binary search only works when the data is sorted. On unsorted data the half that is discarded may contain the target, so the result is unreliable.',
    via: 'page',
  },
  {
    url: 'https://example.net/blog/midpoint-overflow',
    title: 'The midpoint overflow bug (synthetic test source)',
    publisher: 'Example Engineering Blog',
    excerpt:
      'A classic bug computes the midpoint as (low + high) / 2, which can overflow for very large arrays in languages with fixed-width integers; low + (high - low) / 2 avoids it.',
    via: 'page',
  },
  {
    url: 'https://example.com/notes/linear-search',
    title: 'Linear search (synthetic test source)',
    publisher: 'Example Course Notes',
    excerpt: 'Linear search checks every element in turn and needs up to n comparisons for a list of n elements. It works on unsorted data.',
    via: 'search_snippet',
  },
];

export const EXAMPLE_PLAN: PlanInput = {
  title: 'Binary search: find anything in a sorted list, fast',
  objectives: [
    { id: 'o1', text: 'Trace binary search on a sorted list, one comparison at a time' },
    { id: 'o2', text: 'Explain why it needs so few comparisons and when it cannot be used' },
  ],
  outline: [
    { id: 's1', kind: 'narration', purpose: 'Hook: the idea of halving, tied to what the learner already does' },
    { id: 's2', kind: 'narration', purpose: 'The loop as a picture before any code', figure: 'flow' },
    { id: 's3', kind: 'step_through', purpose: 'Trace one search through real code, with a prediction', figure: 'lines' },
    { id: 's4', kind: 'checkpoint', purpose: 'Apply the halving rule to a new case', question: 'single', objective: 'o1' },
    { id: 's5', kind: 'narration', purpose: 'Why it is fast: comparisons against list size', figure: 'chart' },
    { id: 's6', kind: 'checkpoint', purpose: 'Retrieve the cost for a large list', question: 'numeric', objective: 'o2' },
    { id: 's7', kind: 'narration', purpose: 'Two ways it goes wrong: unsorted data and midpoint overflow' },
    { id: 's8', kind: 'checkpoint', purpose: 'Rebuild one pass of the loop in order', question: 'order', objective: 'o1' },
    { id: 's9', kind: 'recap', purpose: 'Takeaways, a practice task, and what to learn next' },
  ],
};

const CODE = [
  'def binary_search(items, target):',
  '    low, high = 0, len(items) - 1',
  '    while low <= high:',
  '        mid = low + (high - low) // 2',
  '        if items[mid] == target:',
  '            return mid',
  '        if items[mid] < target:',
  '            low = mid + 1',
  '        else:',
  '            high = mid - 1',
  '    return -1',
];

export const EXAMPLE_SCENES: SceneInput[] = [
  {
    id: 's1',
    kind: 'narration',
    title: 'One name in a million',
    blocks: [
      { type: 'framing', text: 'How do you find one name among a million without reading them all?' },
      { type: 'claim', text: 'Binary search looks at the middle of a sorted array and throws away the half where the value cannot be.', cites: ['e1'] },
      {
        type: 'analogy',
        text: 'Looking up a word in a paper dictionary works the same way: open near the middle, see whether your word comes before or after, and ignore the other half.',
        limits: 'A reader guesses roughly where to open. Binary search always picks the exact middle.',
      },
    ],
  },
  {
    id: 's2',
    kind: 'narration',
    title: 'The loop, as a picture',
    blocks: [
      { type: 'claim', text: 'The search repeats one move: compare the target with the middle element, then discard the half that cannot contain it.', cites: ['e1'] },
      { type: 'framing', text: 'Follow the arrows once before you read any code.' },
    ],
    figure: {
      type: 'flow',
      layout: 'down',
      nodes: [
        { id: 'start', label: 'Sorted list and a target' },
        { id: 'middle', label: 'Look at the middle element' },
        { id: 'compare', label: 'Is it the target?' },
        { id: 'found', label: 'Done: return its position' },
        { id: 'discard', label: 'Discard the half that cannot hold it' },
      ],
      edges: [
        { id: 'begin', from: 'start', to: 'middle' },
        { id: 'check', from: 'middle', to: 'compare' },
        { id: 'yes', from: 'compare', to: 'found', label: 'yes' },
        { id: 'no', from: 'compare', to: 'discard', label: 'no' },
        { id: 'again', from: 'discard', to: 'middle', label: 'repeat', dashed: true },
      ],
      cites: ['e1'],
      description:
        'A loop. Start with a sorted list and a target, look at the middle element, and ask whether it is the target. If yes, return its position. If no, discard the half that cannot hold the target and look at the middle of what remains.',
    },
  },
  {
    id: 's3',
    kind: 'step_through',
    title: 'Trace it: one search, start to finish',
    intro: 'Watch low, high and mid change as the interval shrinks.',
    figure: {
      type: 'lines',
      format: 'code',
      language: 'Python',
      lines: CODE,
      description: 'An eleven-line Python function. It keeps two positions, low and high, and loops while low is not past high, moving one of them past the middle each time.',
    },
    steps: [
      {
        title: 'Start with the whole list',
        highlight: ['l2'],
        blocks: [{ type: 'example', text: 'Search for 42 in [3, 8, 15, 23, 42, 57, 91]. The interval is the whole list: low is 0 and high is 6.', basedOn: ['e1'] }],
        state: [
          { label: 'low', value: '0' },
          { label: 'high', value: '6' },
        ],
      },
      {
        title: 'Find the middle',
        highlight: ['l4'],
        blocks: [{ type: 'example', text: 'mid = 0 + (6 - 0) // 2 = 3, and items[3] is 23.' }],
        state: [
          { label: 'low', value: '0' },
          { label: 'high', value: '6' },
          { label: 'mid', value: '3' },
        ],
      },
      {
        title: 'Discard a half',
        highlight: ['l7', 'l8'],
        predict: {
          prompt: '23 is less than 42. Which part of the list can be thrown away?',
          options: [
            { text: 'Everything up to and including position 3', correct: true, feedback: 'Yes. The list is sorted, so nothing at or before 23 can be 42.' },
            { text: 'Everything from position 3 onwards', correct: false, feedback: 'Those values are 23 or larger, and 42 is larger than 23, so it must be among them.' },
            { text: 'Nothing yet', correct: false, feedback: 'One comparison is enough: sorted order tells you which side 42 is on.' },
          ],
        },
        blocks: [
          { type: 'claim', text: 'Because the list is sorted, the half that is discarded cannot contain the target.', cites: ['e3'] },
          { type: 'example', text: 'low becomes mid + 1, which is 4.' },
        ],
        state: [
          { label: 'low', value: '4' },
          { label: 'high', value: '6' },
        ],
      },
      {
        title: 'Halve again',
        highlight: ['l4', 'l9', 'l10'],
        blocks: [{ type: 'example', text: 'mid = 4 + (6 - 4) // 2 = 5. items[5] is 57, which is greater than 42, so high becomes 4.' }],
        state: [
          { label: 'low', value: '4' },
          { label: 'high', value: '4' },
          { label: 'mid', value: '5' },
        ],
      },
      {
        title: 'Found',
        highlight: ['l5', 'l6'],
        blocks: [
          { type: 'example', text: 'mid is 4 and items[4] is 42: found on the third comparison.' },
          { type: 'claim', text: 'Each comparison halved the interval that was left to search.', cites: ['e2'] },
        ],
        state: [
          { label: 'low', value: '4' },
          { label: 'high', value: '4' },
          { label: 'mid', value: '4' },
        ],
      },
    ],
  },
  {
    id: 's4',
    kind: 'checkpoint',
    title: 'Check: which half?',
    objective: 'o1',
    level: 'apply',
    question: {
      type: 'single',
      prompt: 'You search a sorted list for 70. The middle element is 50. What does binary search do next?',
      options: [
        { text: 'Search only the half after the middle element', correct: true, feedback: 'Right: 70 is greater than 50, so in a sorted list it can only be in the later half.' },
        {
          text: 'Search only the half before the middle element',
          correct: false,
          feedback: 'That half holds values smaller than 50, so 70 cannot be there.',
          misconception: 'Mixes up which side of a sorted list holds the larger values',
        },
        {
          text: 'Move to the next element and continue one at a time',
          correct: false,
          feedback: 'That is linear search. Binary search discards half of the interval instead.',
          misconception: 'Treats binary search as a faster-starting linear scan',
        },
      ],
      explanation: { text: 'The target is compared with the middle element, and the half that cannot contain it is discarded.', cites: ['e1'] },
      hint: 'The list is sorted. Where do values larger than 50 live?',
    },
  },
  {
    id: 's5',
    kind: 'narration',
    title: 'Why it is fast',
    blocks: [
      { type: 'claim', text: 'A linear search may have to check every one of the n elements.', cites: ['e5'] },
      { type: 'claim', text: 'Binary search needs at most about log2(n) + 1 comparisons, because each comparison halves the interval.', cites: ['e2'] },
      { type: 'example', text: 'Doubling a list from 512 to 1,024 items adds one comparison for binary search and 512 for linear search.', basedOn: ['e2', 'e5'] },
    ],
    figure: {
      type: 'chart',
      mark: 'line',
      data: 'illustrative',
      xLabel: 'Items in the list',
      yLabel: 'Worst-case comparisons',
      xs: [
        { id: 'n8', label: '8' },
        { id: 'n64', label: '64' },
        { id: 'n512', label: '512' },
        { id: 'n4096', label: '4,096' },
      ],
      series: [
        { id: 'linear', label: 'Linear search', values: [8, 64, 512, 4096] },
        { id: 'binary', label: 'Binary search', values: [4, 7, 10, 13] },
      ],
      cites: ['e2', 'e5'],
      description:
        'A line chart of worst-case comparisons against list size. The linear search line climbs steeply to 4,096 comparisons for 4,096 items. The binary search line stays almost flat, reaching only 13.',
      caption: 'Linear search grows with the list. Binary search barely moves.',
    },
  },
  {
    id: 's6',
    kind: 'checkpoint',
    title: 'Check: how many comparisons?',
    objective: 'o2',
    level: 'recall',
    question: {
      type: 'numeric',
      prompt: 'A sorted list has 1,000,000 items. At most how many comparisons does binary search need?',
      answer: 20,
      unit: 'comparisons',
      explanation: { text: 'Each comparison halves the interval, so a sorted list of 1,000,000 items is searched in at most 20 steps.', cites: ['e2'] },
      hint: 'How many times can you halve a million before one item is left?',
    },
  },
  {
    id: 's7',
    kind: 'narration',
    title: 'Two ways it goes wrong',
    blocks: [
      { type: 'claim', text: 'Binary search is only reliable when the data is sorted.', cites: ['e3'] },
      { type: 'quote', text: 'the half that is discarded may contain the target', cite: 'e3' },
      { type: 'claim', text: 'Adding low and high before dividing can overflow a fixed-width integer when the array is very large.', cites: ['e4'] },
      { type: 'framing', text: 'The code you traced already uses the safe form of the midpoint.' },
    ],
  },
  {
    id: 's8',
    kind: 'checkpoint',
    title: 'Check: one pass, in order',
    objective: 'o1',
    level: 'recall',
    question: {
      type: 'order',
      prompt: 'Put one pass of binary search in order.',
      items: ['Find the middle element of the current interval', 'Compare it with the target', 'Discard the half that cannot contain the target', 'Repeat on the half that remains'],
      explanation: { text: 'Binary search repeatedly compares the target with the middle element and discards the half that cannot contain it.', cites: ['e1'] },
    },
  },
  {
    id: 's9',
    kind: 'recap',
    title: 'What you can do now',
    takeaways: [
      { objective: 'o1', text: 'Compare the target with the middle element, discard the half that cannot contain it, and repeat on what is left.', cites: ['e1'] },
      { objective: 'o2', text: 'Each comparison halves the interval, so the cost grows with log2(n), and it only works on sorted data.', cites: ['e2', 'e3'] },
    ],
    practice: {
      task: 'Write binary search from memory in a language you use. Test it on an empty list, a one-item list, and a target that is not present.',
      lookFor: ['It returns a not-found result instead of looping forever', 'It never reads a position outside the list'],
    },
    next: [
      { topic: 'Big-O notation', why: 'To say precisely how the cost of binary search and linear search grows.' },
      { topic: 'How sorting algorithms work', why: 'Binary search needs sorted data, so the cost of sorting matters.' },
    ],
  },
];

/** One valid figure of each type, citing the example evidence. */
export const EXAMPLE_FIGURES: Record<FigureType, FigureInput> = {
  flow: (EXAMPLE_SCENES[1] as { figure: FigureInput }).figure,
  lines: (EXAMPLE_SCENES[2] as { figure: FigureInput }).figure,
  chart: (EXAMPLE_SCENES[4] as { figure: FigureInput }).figure,
  sequence: {
    type: 'sequence',
    actors: [
      { id: 'caller', label: 'Your code' },
      { id: 'search', label: 'binary_search' },
      { id: 'list', label: 'Sorted list' },
    ],
    messages: [
      { id: 'call', from: 'caller', to: 'search', label: 'find the target' },
      { id: 'read', from: 'search', to: 'list', label: 'read the middle element' },
      { id: 'value', from: 'list', to: 'search', label: 'middle value' },
      { id: 'narrow', from: 'search', to: 'search', label: 'discard the half that cannot contain it' },
      { id: 'result', from: 'search', to: 'caller', label: 'position, or not found' },
    ],
    cites: ['e1'],
    description:
      'Three participants: your code, the binary_search function and the sorted list. Your code asks for the target; the function reads the middle element, discards a half, and finally returns a position or not found.',
  },
  layers: {
    type: 'layers',
    layers: [
      { id: 'whole', label: 'Whole sorted array', detail: 'Where the search starts' },
      { id: 'interval', label: 'Remaining interval', detail: 'Halved by every comparison' },
      { id: 'mid', label: 'Middle element', detail: 'The only value compared on each pass' },
    ],
    cites: ['e1', 'e2'],
    description: 'Three nested levels, widest first: the whole sorted array, the interval still being searched, and the single middle element that is compared on each pass.',
  },
  timeline: {
    type: 'timeline',
    events: [
      { id: 'c1', when: '1st comparison', label: 'Half of the array is left' },
      { id: 'c2', when: '2nd comparison', label: 'A quarter is left' },
      { id: 'c3', when: '3rd comparison', label: 'An eighth is left', detail: 'Each comparison halves the remaining interval.' },
    ],
    cites: ['e2'],
    description: 'Three comparisons in order. After the first, half of the array remains; after the second, a quarter; after the third, an eighth.',
  },
  compare: {
    type: 'compare',
    rowHeading: 'Question',
    columns: [
      { id: 'linear', label: 'Linear search' },
      { id: 'binary', label: 'Binary search' },
    ],
    rows: [
      { id: 'sorted', label: 'Needs sorted data?', cells: ['No, it works on unsorted data', 'Yes, it only works when the data is sorted'] },
      { id: 'cost', label: 'Comparisons for n elements', cells: ['Up to `n`', 'At most about `log2(n) + 1`'] },
    ],
    cites: ['e2', 'e3', 'e5'],
    description: 'A two-column table. Linear search works on unsorted data and needs up to n comparisons. Binary search needs sorted data and at most about log2(n) + 1 comparisons.',
  },
};

/** One valid question of each type, citing the example evidence. */
export const EXAMPLE_QUESTIONS: Record<QuestionType, QuestionInput> = {
  single: (EXAMPLE_SCENES[3] as { question: QuestionInput }).question,
  numeric: (EXAMPLE_SCENES[5] as { question: QuestionInput }).question,
  order: (EXAMPLE_SCENES[7] as { question: QuestionInput }).question,
  reflect: {
    type: 'reflect',
    prompt: 'In your own words, why can binary search not be trusted on a list that is not sorted?',
    modelAnswer: {
      text: 'Each step discards a half on the assumption that sorted order puts the target on the other side. Without that order, the discarded half may contain the target.',
      cites: ['e3'],
    },
    lookFor: ['You mention that a half is discarded at every step', 'You say that sorted order is what makes discarding safe'],
  },
};
