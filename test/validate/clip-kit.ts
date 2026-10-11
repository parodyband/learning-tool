// Helpers for the clip tests: the v2 example lesson (src/core/clip-examples.ts) driven through the
// four checks as the tools drive them, and one honest clip for every stage kind, written against
// the example's SYNTHETIC evidence (e1 the definition of binary search, e2 its cost, e3 why the data
// must be sorted, e4 the midpoint overflow, e5 linear search).
import { ClipScene, STAGE_KINDS, type StageKind } from '../../src/core/clip';
import { EXAMPLE_V2_SCENES, type AnySceneInput, type ClipSceneInput } from '../../src/core/clip-examples';
import { EXAMPLE_EVIDENCE, EXAMPLE_PLAN, EXAMPLE_START } from '../../src/core/examples';
import type { OutlineEntry, PlanInput } from '../../src/core/schema';
import type { Draft, Issue, SceneCheck } from '../../src/core/types';
import { checkLesson, checkPlan, checkScene } from '../../src/core/validate';
import { applyPlan, newDraft, saveEvidence, setPlan, submit } from './helpers';

export type Loose = any;

/** The outline entry a scene fits: what plan_lesson would have been given for it. */
export function entryFor(scene: AnySceneInput | Loose): OutlineEntry {
  const base = { id: scene.id as string, purpose: `What "${scene.id}" is for` };
  if (scene.kind === 'clip') return { ...base, kind: 'clip', stage: scene.stage.kind };
  if (scene.kind === 'checkpoint') return { ...base, kind: 'checkpoint', question: scene.question.type, objective: scene.objective };
  if (scene.kind === 'recap') return { ...base, kind: 'recap' };
  return { ...base, kind: scene.kind, ...(scene.figure ? { figure: scene.figure.type } : {}) };
}

export function outlineFor(scenes: readonly (AnySceneInput | Loose)[]): OutlineEntry[] {
  return scenes.map(entryFor);
}

/** The plan of the v2 example lesson: six clips (c1..c6), three checkpoints (q1..q3) and the recap (end). */
export const CLIP_PLAN: PlanInput = { title: EXAMPLE_PLAN.title, objectives: EXAMPLE_PLAN.objectives, outline: outlineFor(EXAMPLE_V2_SCENES) };

// ---------------------------------------------------------------------------------------------
// The example lesson, with the learner actions the interactivity rules ask for
// ---------------------------------------------------------------------------------------------
//
// The example lesson (src/core/clip-examples.ts) belongs to the player's side of the work. The
// rules of a whole lesson ask that two clips in three give the learner something to do, and warn
// when a standard lesson has no explore. Wherever the example does not yet do that, the lesson
// these tests are built on adds it here, honestly and from the example's own evidence, and adds
// nothing where the example already has it: when the example meets the rules, this is the example.

/**
 * After the halving (c5): drag the comparisons back and watch what is still possible grow. "one"
 * was split from a group of 250. It is kept to a line and a label: what an explore tells the
 * learner counts as uncited prose, and the example lesson has little of that share left.
 */
const HALVING_EXPLORE = {
  prompt: 'Drag the comparisons back and watch what is left.',
  controls: [{ id: 'looks', label: 'Comparisons', min: 2, max: 10, step: 1, value: 10 }],
  bind: [
    { target: 'one', expr: '1000 / 2^looks' },
    { target: 'looks', expr: 'looks' },
  ],
};

/** A prediction for the last beat of the loop (c2), and one for the beat of the traps (c6) that shows what was thrown away. */
const ADDED_GATES: Record<string, { beat: number; gate: Loose }> = {
  c2: {
    beat: 4,
    gate: {
      prompt: 'The middle element turns out to be the target. What does the search do?',
      options: [
        { text: 'It stops', correct: true, feedback: 'Yes. The comparison with the middle element is how the target is found.' },
        { text: 'It discards a half', correct: false, feedback: 'A half is discarded only when the middle element is not the target.' },
      ],
    },
  },
  c6: {
    beat: 2,
    gate: {
      prompt: 'The search kept the right half of a row that is not sorted. What can have gone wrong?',
      options: [
        { text: 'The target was in the half it threw away', correct: true, feedback: 'Yes. Without order, nothing says which half the target is in.' },
        { text: 'The search now takes longer', correct: false, feedback: 'It is no slower. It can simply discard the half that holds the target.' },
      ],
    },
  },
  c1: {
    beat: 2,
    gate: {
      prompt: 'The names are in order. Must every one of them be checked?',
      options: [
        { text: 'No: order lets one look rule out many', correct: true, feedback: 'Yes. In sorted data one comparison says which side the name is on.' },
        { text: 'Yes: any of them could be the one', correct: false, feedback: 'Any could be, but the order tells you where not to look.' },
      ],
    },
  },
};

const acts = (scene: Loose): boolean => scene.kind === 'clip' && (scene.explore !== undefined || scene.beats.some((beat: Loose) => beat.gate !== undefined));

/** The example's scenes, with a learner action added to as many clips as the rules need and no more. */
function withActions(scenes: readonly AnySceneInput[]): AnySceneInput[] {
  const out = structuredClone(scenes) as Loose[];
  const clips = out.filter((scene) => scene.kind === 'clip');
  const halving = out.find((scene) => scene.id === 'c5');
  if (!clips.some((scene) => scene.explore !== undefined) && halving?.stage?.kind === 'dots' && halving.beats.some((beat: Loose) => (beat.do ?? []).some((a: Loose) => a.verb === 'split' && a.into.some((g: Loose) => g.id === 'one')))) {
    halving.explore = structuredClone(HALVING_EXPLORE);
  }
  let short = Math.ceil((clips.length * 2) / 3 - 1e-9) - clips.filter(acts).length;
  for (const id of ['c2', 'c6', 'c1']) {
    if (short <= 0) break;
    const clip = out.find((scene) => scene.id === id);
    const added = ADDED_GATES[id];
    if (!clip || !added || acts(clip) || clip.beats[added.beat] === undefined) continue;
    clip.beats[added.beat].gate = structuredClone(added.gate);
    short--;
  }
  return out as AnySceneInput[];
}

/** The lesson the whole-lesson tests are built on: the v2 example, made to meet the interactivity rules (see above). */
export const LESSON_SCENES: AnySceneInput[] = withActions(EXAMPLE_V2_SCENES);
/** True when the example lesson already meets the interactivity rules by itself, so that `LESSON_SCENES` is the example. */
export const EXAMPLE_IS_INTERACTIVE = JSON.stringify(LESSON_SCENES) === JSON.stringify(EXAMPLE_V2_SCENES);

/** A draft with the example's evidence stored and nothing else. */
export function evidenceDraft(): Draft {
  const draft = newDraft(EXAMPLE_START);
  for (const item of EXAMPLE_EVIDENCE) saveEvidence(draft, item);
  return draft;
}

/** The v2 example lesson with its plan accepted and no scene submitted yet. */
export function plannedClipDraft(): Draft {
  const draft = evidenceDraft();
  applyPlan(draft, structuredClone(CLIP_PLAN));
  return draft;
}

/** The v2 example lesson (as `LESSON_SCENES` has it) with every scene accepted through checkScene. A fresh copy each call. */
export function clipDraft(): Draft {
  const draft = plannedClipDraft();
  for (const scene of LESSON_SCENES) {
    const check = submit(draft, structuredClone(scene));
    if (!check.ok) throw new Error(`scene ${scene.id} refused: ${JSON.stringify(check.errors, null, 1)}`);
  }
  return draft;
}

/** A deep copy of scene `id` of the v2 example lesson (as `LESSON_SCENES` has it), loosely typed so a test can break it. */
export function clipScene(id: string): Loose {
  const scene = LESSON_SCENES.find((s) => s.id === id);
  if (!scene) throw new Error(`no v2 example scene ${id}`);
  return structuredClone(scene);
}

export interface Outcome {
  errors: Issue[];
  warnings: Issue[];
  draft: Draft;
}

/** Scene `id` of the v2 example lesson, changed, checked against the accepted lesson. */
export function changedClip(id: string, change: (s: Loose) => void, prepare?: (draft: Draft) => void): Outcome & SceneCheck {
  const draft = clipDraft();
  prepare?.(draft);
  const scene = clipScene(id);
  change(scene);
  return { ...checkScene(scene, draft), draft };
}

/** The v2 example lesson with some scenes replaced (each must be accepted on its own), checked as a whole. */
export function changedLesson(changes: Record<string, (s: Loose) => void>, prepare?: (draft: Draft) => void): Outcome & ReturnType<typeof checkLesson> {
  const draft = clipDraft();
  prepare?.(draft);
  for (const [id, change] of Object.entries(changes)) {
    const scene = clipScene(id);
    change(scene);
    const check = submit(draft, scene);
    if (!check.ok) throw new Error(`the changed scene ${id} must be accepted on its own: ${JSON.stringify(check.errors, null, 1)}`);
  }
  return { ...checkLesson(draft), draft };
}

/** The example's plan, changed, checked against a draft that holds the example's evidence. */
export function changedPlan(change: (p: Loose) => void): Outcome & ReturnType<typeof checkPlan> {
  const draft = evidenceDraft();
  const plan: Loose = structuredClone(CLIP_PLAN);
  change(plan);
  return { ...checkPlan(plan, draft), draft };
}

/** A draft whose plan holds exactly this clip, with the example's evidence: enough for checkScene. */
export function draftAround(clip: Loose): Draft {
  const draft = evidenceDraft();
  setPlan(draft, { title: EXAMPLE_PLAN.title, objectives: EXAMPLE_PLAN.objectives, outline: [entryFor(clip)] });
  return draft;
}

/** One clip checked on its own, in a lesson planned around it. */
export function checkAlone(clip: Loose): Outcome & SceneCheck {
  const draft = draftAround(clip);
  return { ...checkScene(clip, draft), draft };
}

// ---------------------------------------------------------------------------------------------
// One honest clip for every stage kind
// ---------------------------------------------------------------------------------------------

const GATE = {
  prompt: 'The middle element is smaller than the target. What can be thrown away?',
  options: [
    { text: 'The half before the middle', correct: true, feedback: 'Yes. In sorted data nothing before a smaller element can be the target.' },
    { text: 'The half after the middle', correct: false, feedback: 'Those elements are larger than the middle one, so the target is among them.' },
  ],
};

/** A small frame that passes the frame checks: a bar that shrinks by half, three times. */
export const HONEST_FRAME_CODE = [
  '// A bar that is cut in half three times. Laid out from S.W and S.H; every move is a function of t.',
  'const HALVINGS = 3;',
  '',
  'function render(ctx, t) {',
  '  const { W, H, theme: c } = S;',
  '  S.clear();',
  '  let width = W * 0.8;',
  '  for (let k = 0; k < HALVINGS; k++) width *= 1 - 0.5 * S.prog(t, 1 + k * 2, 1, S.ease.out);',
  '  S.rect(W * 0.1, H * 0.4, width, H * 0.2, { fill: c.accentSoft, stroke: c.accent, lw: 2, r: 8 });',
  "  S.text('What is left to search', W * 0.1, H * 0.3, { size: 22, fill: c.fg2 });",
  '}',
  '',
].join('\n');

const SEQUENCE: ClipSceneInput = {
  id: 'h-sequence',
  kind: 'clip',
  title: 'One comparison, as a conversation',
  description: 'Two columns: the search and the sorted array. The search asks for the middle element, the array answers, and the search discards a half.',
  stage: {
    kind: 'sequence',
    actors: [
      { id: 'search', label: 'Binary search' },
      { id: 'array', label: 'Sorted array' },
    ],
    messages: [
      { id: 'ask', from: 'search', to: 'array', label: 'the middle element?' },
      { id: 'answer', from: 'array', to: 'search', label: 'smaller than the target' },
      { id: 'drop', from: 'search', to: 'array', label: 'discard a half' },
    ],
    stats: [{ id: 'left', label: 'Still possible', value: 'all of it', at: 'search' }],
    cites: ['e1'],
    provenance: 'sourced',
  },
  beats: [
    { caption: { type: 'claim', text: 'Binary search compares the target with the middle element of a sorted array.', cites: ['e1'] }, do: [{ verb: 'send', target: 'ask' }] },
    { caption: { type: 'framing', text: 'Suppose the middle element turns out to be smaller.' }, do: [{ verb: 'send', target: 'answer' }, { verb: 'pulse', target: 'search' }] },
    {
      gate: GATE,
      caption: { type: 'claim', text: 'It discards the half that cannot contain the target.', cites: ['e1'] },
      do: [{ verb: 'send', target: 'drop' }, { verb: 'set', target: 'left', value: 'one half', with: true }, { verb: 'focus', targets: ['search'], on: 'discards' }],
    },
  ],
};

const CELLS: ClipSceneInput = {
  id: 'h-cells',
  kind: 'clip',
  title: 'Halving a row of five',
  description: 'Five sorted numbers, 2, 4, 6, 8 and 9, with a pointer on the middle one. The search for 8 rules out the first three cells and keeps the last two.',
  stage: {
    kind: 'cells',
    indices: true,
    cells: [
      { id: 'c0', label: '2' },
      { id: 'c1', label: '4' },
      { id: 'c2', label: '6' },
      { id: 'c3', label: '8' },
      { id: 'c4', label: '9' },
    ],
    pointers: [{ id: 'mid', label: 'mid', side: 'above' }],
    brackets: [{ id: 'range', label: 'still possible' }],
    stats: [{ id: 'looks', label: 'Comparisons', value: 0 }],
    cites: ['e1'],
    provenance: 'worked',
  },
  beats: [
    { caption: { type: 'example', text: 'Search these five sorted numbers for 8.', basedOn: ['e1'] }, do: [{ verb: 'move', target: 'range', to: ['c0', 'c4'] }] },
    {
      caption: { type: 'claim', text: 'Binary search compares the target with the middle element.', cites: ['e1'] },
      do: [{ verb: 'move', target: 'mid', to: 'c2' }, { verb: 'set', target: 'c2', tone: 'warn', with: true }, { verb: 'set', target: 'looks', value: 1, with: true }],
    },
    {
      gate: GATE,
      caption: { type: 'claim', text: 'Then it discards the half that cannot contain the target.', cites: ['e1'] },
      do: [{ verb: 'move', target: 'range', to: ['c3', 'c4'] }, { verb: 'focus', between: ['c3', 'c4'], with: true }, { verb: 'set', between: ['c0', 'c2'], tone: 'muted', with: true }],
    },
    { caption: { type: 'framing', text: 'Two cells are left, and the next comparison settles it.' }, do: [{ verb: 'move', target: 'mid', to: 'c3' }, { verb: 'set', target: 'c3', tone: 'good' }, { verb: 'swap', a: 'c3', b: 'c4' }] },
  ],
};

const DOTS: ClipSceneInput = {
  id: 'h-dots',
  kind: 'clip',
  title: 'Sixteen items, halved',
  description: 'Sixteen dots, one for each item of a sorted list. Half are ruled out, then half of what is left, until four remain.',
  stage: {
    kind: 'dots',
    total: 16,
    legend: '1 dot = 1 item',
    group: { id: 'all', label: 'Sorted items' },
    stats: [{ id: 'looks', label: 'Comparisons', value: 0 }],
    cites: ['e2'],
    provenance: 'worked',
  },
  beats: [
    {
      caption: { type: 'claim', text: 'Each comparison halves the remaining search interval.', cites: ['e2'] },
      do: [
        {
          verb: 'split',
          target: 'all',
          into: [
            { id: 'keep', label: 'Still possible', count: 8, tone: 'accent' },
            { id: 'gone', label: 'Ruled out', count: 8, tone: 'muted' },
          ],
        },
        { verb: 'set', target: 'looks', value: 1, with: true },
      ],
    },
    {
      caption: { type: 'example', text: 'A second comparison leaves four of the sixteen.' },
      do: [
        {
          verb: 'split',
          target: 'keep',
          into: [
            { id: 'four', label: 'Still possible', count: 4, tone: 'good' },
            { id: 'more', label: 'Ruled out', count: 4, tone: 'muted' },
          ],
          pick: 'first',
        },
        { verb: 'merge', targets: ['more', 'gone'], into: { id: 'out', label: 'Ruled out', tone: 'muted' } },
        { verb: 'focus', targets: ['four'] },
      ],
    },
  ],
};

const BARS: ClipSceneInput = {
  id: 'h-chart',
  kind: 'clip',
  title: 'A million items, twenty steps',
  description: 'Two bars: 1,000,000 for the items in a sorted list, and 20 for the steps binary search needs at most.',
  stage: {
    kind: 'chart',
    mark: 'bars',
    yLabel: 'How many',
    bars: [
      { id: 'items', label: 'Items', value: 1000000, tone: 'neutral' },
      { id: 'steps', label: 'Steps at most', value: 0 },
    ],
    cites: ['e2'],
    provenance: 'sourced',
  },
  beats: [
    { caption: { type: 'claim', text: 'A sorted list of 1,000,000 items is searched in at most 20 steps.', cites: ['e2'] }, do: [{ verb: 'set', target: 'steps', value: 20 }, { verb: 'pulse', target: 'items', with: true }] },
    { caption: { type: 'framing', text: 'The second bar is there. It is too short to see.' }, do: [{ verb: 'focus', targets: ['steps'], zoom: true }, { verb: 'set', target: 'steps', tone: 'good' }, { verb: 'reorder', order: ['steps', 'items'] }] },
  ],
};

const LINE: ClipSceneInput = {
  id: 'h-line',
  kind: 'clip',
  title: 'Two costs against the size of the list',
  description: 'A line chart of comparisons against the number of items, from 8 to 512. Linear search climbs to 512; binary search stays near the bottom and ends at 10.',
  stage: {
    kind: 'chart',
    mark: 'line',
    yLabel: 'Comparisons at most',
    xs: ['8', '64', '512'],
    series: [
      { id: 'linear', label: 'Linear search', values: [8, 64, 512], tone: 'neutral' },
      { id: 'binary', label: 'Binary search', values: [4, 7, 10] },
    ],
    stats: [{ id: 'gap', label: 'At 512 items', value: '512 against 10' }],
    cites: ['e2', 'e5'],
    provenance: 'worked',
  },
  beats: [
    { caption: { type: 'claim', text: 'Linear search needs up to n comparisons for a list of n elements.', cites: ['e5'] }, do: [{ verb: 'draw', target: 'linear', upto: '64' }, { verb: 'draw', target: 'linear' }] },
    { caption: { type: 'claim', text: 'Binary search needs at most about log2(n) + 1 comparisons.', cites: ['e2'] }, do: [{ verb: 'draw', target: 'binary' }, { verb: 'focus', targets: ['binary'] }, { verb: 'pulse', target: 'gap' }] },
  ],
};

const FLOW: ClipSceneInput = {
  id: 'h-flow',
  kind: 'clip',
  title: 'Why the data must be sorted',
  description: 'Sorted data goes into binary search and a reliable result comes out. Unsorted data goes into the same search and the result is unreliable.',
  stage: {
    kind: 'flow',
    nodes: [
      { id: 'sorted', label: 'Sorted data' },
      { id: 'search', label: 'Binary search' },
      { id: 'good', label: 'The target is found' },
      { id: 'unsorted', label: 'Unsorted data' },
      { id: 'bad', label: 'Unreliable result' },
    ],
    edges: [
      { id: 'in', from: 'sorted', to: 'search' },
      { id: 'out', from: 'search', to: 'good' },
      { id: 'wrong', from: 'search', to: 'bad', label: 'unsorted' },
    ],
    cites: ['e3'],
    provenance: 'sourced',
  },
  beats: [
    { caption: { type: 'claim', text: 'Binary search only works when the data is sorted.', cites: ['e3'] }, do: [{ verb: 'draw', targets: ['in', 'out'] }, { verb: 'set', target: 'good', tone: 'good' }] },
    { caption: { type: 'quote', text: 'the half that is discarded may contain the target', cite: 'e3' }, do: [{ verb: 'show', target: 'unsorted' }, { verb: 'send', from: 'unsorted', to: 'search', label: 'unsorted', tone: 'warn' }] },
    { caption: { type: 'claim', text: 'On unsorted data the result is unreliable.', cites: ['e3'] }, do: [{ verb: 'show', target: 'bad' }, { verb: 'send', along: 'wrong', outcome: 'lost' }, { verb: 'set', target: 'bad', tone: 'bad', size: 'large' }] },
  ],
};

const WORDS: ClipSceneInput = {
  id: 'h-words',
  kind: 'clip',
  title: 'The question',
  description: 'Large words on an empty stage: "Sorted", then "Look in the middle", then the question "How much can one look rule out?".',
  stage: {
    kind: 'words',
    lines: [
      { id: 'given', text: 'Sorted', size: 'xl' },
      { id: 'move', text: 'Look in the middle' },
      { id: 'ask', text: 'How much can one look rule out?', size: 'l' },
    ],
    provenance: 'illustrative',
  },
  beats: [
    { caption: { type: 'claim', text: 'Binary search finds a target value in a sorted array.', cites: ['e1'] }, do: [{ verb: 'show', targets: ['given', 'move'] }] },
    { caption: { type: 'framing', text: 'Before you go on: how much does one look rule out?' }, do: [{ verb: 'hide', target: 'given' }, { verb: 'show', target: 'ask' }, { verb: 'set', target: 'ask', tone: 'accent' }, { verb: 'focus', targets: ['ask'] }] },
  ],
};

const CODE: ClipSceneInput = {
  id: 'h-lines',
  kind: 'clip',
  title: 'The midpoint, written safely',
  description: 'Three lines of code that compute the midpoint. The first form, (low + high) / 2, is marked as a bug and the second, low + (high - low) / 2, as the fix.',
  stage: {
    kind: 'lines',
    format: 'code',
    language: 'C',
    lines: ['int mid = (low + high) / 2;', '// the sum can overflow', 'int mid = low + (high - low) / 2;'],
    pointers: [{ id: 'pc', label: 'here' }],
    brackets: [{ id: 'pair', label: 'same midpoint' }],
    annotations: [{ id: 'why', at: 'l1', text: 'low + high can be too large for the type.' }],
    values: [{ id: 'sum', at: 'l1', label: 'low + high' }],
    cites: ['e4'],
    provenance: 'worked',
  },
  beats: [
    { caption: { type: 'claim', text: 'A classic bug computes the midpoint by adding low and high first.', cites: ['e4'] }, do: [{ verb: 'move', target: 'pc', to: 'l1' }, { verb: 'show', target: 'why' }, { verb: 'set', target: 'l1', tone: 'bad' }] },
    { caption: { type: 'example', text: 'With two large positions the sum no longer fits.' }, do: [{ verb: 'set', target: 'sum', value: 'too large' }, { verb: 'pulse', target: 'sum' }] },
    {
      caption: { type: 'claim', text: 'Writing it as low + (high - low) / 2 avoids the overflow.', cites: ['e4'] },
      do: [{ verb: 'hide', target: 'why' }, { verb: 'move', target: 'pc', to: 'l3' }, { verb: 'move', target: 'pair', to: ['l1', 'l3'] }, { verb: 'focus', between: ['l3', 'l3'] }],
    },
  ],
};

const MATH: ClipSceneInput = {
  id: 'h-math',
  kind: 'clip',
  title: 'Halvings until one is left',
  description: 'A three-line derivation: n over 2 to the k equals 1, so n equals 2 to the k, so k is the logarithm of n to base 2.',
  stage: {
    kind: 'lines',
    format: 'math',
    lines: ['\\frac{n}{2^k} = 1', 'n = 2^k', 'k = \\log_2 n'],
    cites: ['e2'],
    provenance: 'worked',
  },
  beats: [
    { caption: { type: 'claim', text: 'Each comparison halves the remaining search interval.', cites: ['e2'] }, do: [{ verb: 'show', target: 'l1' }] },
    { caption: { type: 'example', text: 'Solve for the number of halvings, k.' }, do: [{ verb: 'show', targets: ['l2', 'l3'] }, { verb: 'set', target: 'l3', tone: 'good' }] },
  ],
};

const TIMELINE: ClipSceneInput = {
  id: 'h-timeline',
  kind: 'clip',
  title: 'From a million to one',
  description: 'A track with three moments of one search: 1,000,000 items at the start, half of them after one step, and the search over by step 20.',
  stage: {
    kind: 'timeline',
    events: [
      { id: 'start', when: 'start', label: '1,000,000 items' },
      { id: 'first', when: 'step 1', label: 'Half the interval is left' },
      { id: 'done', when: 'step 20', label: 'Searched', detail: 'At most 20 steps for 1,000,000 items.' },
    ],
    spans: [{ id: 'run', from: 'start', to: 'done', label: 'at most 20 steps' }],
    markers: [{ id: 'now', label: 'now' }],
    cites: ['e2'],
    provenance: 'sourced',
  },
  beats: [
    { caption: { type: 'claim', text: 'Each comparison halves the remaining search interval.', cites: ['e2'] }, do: [{ verb: 'draw', target: 'track', upto: 'first' }, { verb: 'move', target: 'now', to: 'first' }] },
    {
      caption: { type: 'claim', text: 'A sorted list of 1,000,000 items is searched in at most 20 steps.', cites: ['e2'] },
      do: [{ verb: 'draw', target: 'track' }, { verb: 'move', target: 'now', to: 'done' }, { verb: 'show', target: 'run' }, { verb: 'focus', between: ['first', 'done'] }],
    },
  ],
};

const FRAME: ClipSceneInput = {
  id: 'h-frame',
  kind: 'clip',
  title: 'Half, and half again',
  description: 'A wide bar stands for the part of a sorted array that is still to be searched. Three times in a row it shrinks to half its width.',
  stage: { kind: 'frame', code: HONEST_FRAME_CODE, duration: 8, poster: 4, cites: ['e2'], provenance: 'worked' },
  beats: [
    { caption: { type: 'framing', text: 'This bar is everything that could still hold the target.' }, at: 0 },
    { caption: { type: 'claim', text: 'Each comparison halves the remaining search interval.', cites: ['e2'] }, at: 1 },
    { caption: { type: 'example', text: 'Three comparisons leave an eighth of it.', basedOn: ['e2'] }, at: 5.5 },
  ],
};

// ---------------------------------------------------------------------------------------------
// Honest clips that hand the picture to the learner
// ---------------------------------------------------------------------------------------------

/** Bars the learner drives: the two searches, with the list doubling on a slider. Starts where the clip ends: 8 items, 8 against 4. */
const X_BARS: ClipSceneInput = {
  id: 'x-bars',
  kind: 'clip',
  title: 'Double the list',
  description: 'Two bars: the most comparisons linear search and binary search need for a list of 8 items, 8 against 4. A slider then doubles the list again and again; the first bar doubles with it and the second grows by one.',
  stage: {
    kind: 'chart',
    mark: 'bars',
    yLabel: 'Comparisons at most',
    bars: [
      { id: 'linear', label: 'Linear search', value: 8, tone: 'neutral' },
      { id: 'binary', label: 'Binary search', value: 4 },
    ],
    cites: ['e2', 'e5'],
    provenance: 'worked',
  },
  beats: [
    { caption: { type: 'claim', text: 'Linear search needs up to n comparisons for a list of n elements.', cites: ['e5'] }, do: [{ verb: 'pulse', target: 'linear' }] },
    { caption: { type: 'claim', text: 'Binary search needs at most about log2(n) + 1 comparisons.', cites: ['e2'] }, do: [{ verb: 'focus', targets: ['binary'] }, { verb: 'set', target: 'binary', tone: 'good' }] },
  ],
  explore: {
    prompt: 'Double the list and watch the two bars.',
    controls: [{ id: 'doublings', label: 'Doublings', min: 3, max: 12, step: 1, value: 3 }],
    bind: [
      { target: 'linear', expr: '2^doublings' },
      { target: 'binary', expr: 'doublings + 1' },
    ],
  },
};

/** A curve chart the learner drives: how long a list a budget of comparisons can search. The budget is a level line; the point rides the cost curve to where they meet. */
const X_CURVE: ClipSceneInput = {
  id: 'x-curve',
  kind: 'clip',
  title: 'What a few comparisons buy',
  description: 'A chart of comparisons against the size of a sorted list, up to 1,024 items. The cost of binary search rises quickly at first and then hardly at all. A level line marks a budget of comparisons, and a point marks the longest list that budget can search. A slider raises the budget, and the point runs out along the curve.',
  stage: {
    kind: 'chart',
    mark: 'curve',
    yLabel: 'Comparisons at most',
    x: { label: 'Items in the list', min: 1, max: 1024 },
    min: 0,
    max: 12,
    curves: [
      { id: 'cost', label: 'Binary search', expr: 'log2(x) + 1' },
      { id: 'budget', label: 'Your budget', expr: 'spend', tone: 'muted' },
    ],
    points: [{ id: 'reach', label: 'Longest list', x: '2^(spend - 1)', on: 'cost' }],
    stats: [{ id: 'items', label: 'Items it can search', value: 16 }],
    cites: ['e2'],
    provenance: 'worked',
  },
  beats: [
    { caption: { type: 'claim', text: 'An array of n elements needs at most about log2(n) + 1 comparisons.', cites: ['e2'] }, do: [{ verb: 'draw', target: 'cost' }] },
    { caption: { type: 'example', text: 'Five comparisons are enough for sixteen items.', basedOn: ['e2'] }, do: [{ verb: 'draw', target: 'budget' }, { verb: 'show', target: 'reach' }, { verb: 'pulse', target: 'items', with: true }] },
  ],
  explore: {
    prompt: 'Raise the budget and watch the point.',
    controls: [{ id: 'spend', label: 'Comparisons', min: 2, max: 11, step: 1, value: 5 }],
    bind: [{ target: 'items', expr: '2^(spend - 1)' }],
  },
};

/** Dots the learner drives, with a goal: 64 items, and what is still possible after each comparison. */
const X_DOTS: ClipSceneInput = {
  id: 'x-dots',
  kind: 'clip',
  title: 'Halve it again',
  description: 'Sixty-four dots, one for each item of a sorted list. One comparison rules out half of them. A slider then adds comparisons, and the group that is still possible halves each time, down to a single dot.',
  stage: {
    kind: 'dots',
    total: 64,
    legend: '1 dot = 1 item',
    group: { id: 'all', label: 'Sorted items' },
    stats: [{ id: 'looks', label: 'Comparisons', value: 0 }],
    cites: ['e2'],
    provenance: 'worked',
  },
  beats: [
    {
      caption: { type: 'claim', text: 'Each comparison halves the remaining search interval.', cites: ['e2'] },
      do: [
        {
          verb: 'split',
          target: 'all',
          into: [
            { id: 'left', label: 'Still possible', count: 32, tone: 'accent' },
            { id: 'out', label: 'Ruled out', count: 32, tone: 'muted' },
          ],
        },
        { verb: 'set', target: 'looks', value: 1, with: true },
      ],
    },
    { caption: { type: 'example', text: 'One comparison leaves 32 of the 64.', basedOn: ['e2'] }, do: [{ verb: 'focus', targets: ['left'] }] },
  ],
  explore: {
    prompt: 'Add comparisons and watch what is left.',
    controls: [{ id: 'looks', label: 'Comparisons', min: 1, max: 6, step: 1, value: 1 }],
    bind: [
      { target: 'left', expr: '64 / 2^looks' },
      { target: 'looks', expr: 'looks' },
    ],
    // Four of the 64 are left after four comparisons: a place inside the range, which neither end of the slider reaches.
    goal: {
      text: 'Compare until four items are still possible.',
      when: '64 / 2^looks == 4',
      done: 'Four halvings take 64 items down to four.',
    },
  },
};

/** A gate answered on the picture: which cell does the search look at first? */
const X_TAP: ClipSceneInput = {
  id: 'x-tap',
  kind: 'clip',
  title: 'Where to look first',
  description: 'Five sorted numbers, 2, 4, 6, 8 and 9. The learner taps the cell binary search compares first; a pointer then lands on the middle cell, the 6.',
  stage: {
    kind: 'cells',
    indices: true,
    cells: [
      { id: 'c0', label: '2' },
      { id: 'c1', label: '4' },
      { id: 'c2', label: '6' },
      { id: 'c3', label: '8' },
      { id: 'c4', label: '9' },
    ],
    pointers: [{ id: 'mid', label: 'mid', side: 'above' }],
    brackets: [{ id: 'range', label: 'still possible' }],
    cites: ['e1'],
    provenance: 'worked',
  },
  beats: [
    { caption: { type: 'example', text: 'Search these five sorted numbers for 8.', basedOn: ['e1'] }, do: [{ verb: 'move', target: 'range', to: ['c0', 'c4'] }] },
    {
      gate: {
        prompt: 'Tap the cell the search compares first.',
        pick: ['c2'],
        right: 'It starts in the middle, so one comparison rules out half the row.',
        wrong: 'Look for the cell that splits the row into two equal parts.',
      },
      caption: { type: 'claim', text: 'Binary search compares the target with the middle element.', cites: ['e1'] },
      do: [{ verb: 'move', target: 'mid', to: 'c2' }, { verb: 'set', target: 'c2', tone: 'warn', with: true }],
    },
  ],
};

/** Honest clips that hand the picture over: an explore on bars, on a curve chart and on dots (with a goal), and a gate answered by a tap. */
export const INTERACTIVE = { bars: X_BARS, curve: X_CURVE, dots: X_DOTS, tap: X_TAP } as const;
export type InteractiveKind = keyof typeof INTERACTIVE;
export const INTERACTIVE_CLIPS: ClipSceneInput[] = [X_BARS, X_CURVE, X_DOTS, X_TAP];

/** A deep copy of one of the interactive clips, loosely typed so a test can break it. */
export function interactive(kind: InteractiveKind): Loose {
  return structuredClone(INTERACTIVE[kind]);
}

/** An interactive clip, changed, checked in the lesson planned around the clip as it was. */
export function changedInteractive(kind: InteractiveKind, change: (s: Loose) => void): Outcome & SceneCheck {
  const draft = draftAround(interactive(kind));
  const clip = interactive(kind);
  change(clip);
  return { ...checkScene(clip, draft), draft };
}

/**
 * A whole lesson built on those four: a gate answered by a tap, then why the data must be sorted
 * (the honest flow clip, which asks nothing), a checkpoint, the bars and the curve chart the
 * learner drives, a checkpoint, the dots with their goal, and the recap. Four of its five clips
 * give the learner something to do. It is planned with the mark of its curve chart, so that
 * plan_lesson answers with that chart's template.
 */
export function interactiveLesson(): { start: typeof EXAMPLE_START; evidence: typeof EXAMPLE_EVIDENCE; plan: PlanInput; scenes: AnySceneInput[] } {
  const from = (id: string): AnySceneInput => structuredClone(LESSON_SCENES.find((scene) => scene.id === id) as AnySceneInput);
  const scenes: AnySceneInput[] = [structuredClone(X_TAP), structuredClone(FLOW), from('q1'), structuredClone(X_BARS), structuredClone(X_CURVE), from('q2'), structuredClone(X_DOTS), from('end')];
  const outline = outlineFor(scenes).map((entry) => (entry.id === X_CURVE.id ? { ...entry, mark: 'curve' as const } : entry));
  return { start: EXAMPLE_START, evidence: EXAMPLE_EVIDENCE, plan: { title: 'Binary search, with your hands on it', objectives: EXAMPLE_PLAN.objectives, outline }, scenes };
}

/** One honest clip for every stage kind (`chart` is the bars form; `HONEST_LINE` and `HONEST_MATH` are the other forms). */
export const HONEST: Record<StageKind, ClipSceneInput> = {
  sequence: SEQUENCE,
  cells: CELLS,
  dots: DOTS,
  chart: BARS,
  flow: FLOW,
  words: WORDS,
  lines: CODE,
  timeline: TIMELINE,
  frame: FRAME,
};
export const HONEST_LINE = LINE;
export const HONEST_MATH = MATH;
/** Every honest clip: the nine kinds and the two other forms. */
export const HONEST_CLIPS: ClipSceneInput[] = [...STAGE_KINDS.map((kind) => HONEST[kind]), LINE, MATH];

/** A deep copy of the honest clip of a stage kind, loosely typed so a test can break it. */
export function honest(kind: StageKind | 'line' | 'math'): Loose {
  return structuredClone(kind === 'line' ? LINE : kind === 'math' ? MATH : HONEST[kind]);
}

/** The honest clip of a stage kind, changed, checked in the lesson planned around the clip as it was. */
export function changedHonest(kind: StageKind | 'line' | 'math', change: (s: Loose) => void): Outcome & SceneCheck {
  const draft = draftAround(honest(kind));
  const clip = honest(kind);
  change(clip);
  return { ...checkScene(clip, draft), draft };
}

/** A clip as the schema parses it, for the tests that hand one to the engine. */
export function parsed(clip: ClipSceneInput | Loose): ClipScene {
  return ClipScene.parse(clip);
}
