// Fill-in skeletons, one per planned scene. plan_lesson returns these so the agent completes a shape
// with the exact field names instead of recalling the schema. Placeholder strings say what belongs
// there. Every skeleton parses under the schema (a test asserts it); none is meant to be published.
import { EXPR_HELP } from './expr';
import { LIMITS as L } from './limits';
import type { FigureType, OutlineEntry, PlanChartMark, PlanStageKind, QuestionType } from './schema';
import { STAGE_VERB_NOTES } from './validate/stage';

const CITES = ['e1'];
const DESCRIPTION = 'What the figure shows and the point it makes, for someone who cannot see it.';

const BLOCKS = [
  { type: 'claim', text: 'One fact from a source, in at most two sentences.', cites: CITES },
  { type: 'quote', text: 'words copied exactly from the cited excerpt', cite: 'e1' },
  { type: 'analogy', text: 'A comparison to something the learner already knows.', limits: 'Where the comparison stops being true.' },
  { type: 'example', text: 'A worked case in your own words: a calculation or a concrete instance.', basedOn: CITES },
  { type: 'framing', text: 'A short transition or a question to the learner. Never a fact.' },
];

const FIGURES: Record<FigureType, unknown> = {
  flow: {
    type: 'flow',
    layout: 'right',
    nodes: [
      { id: 'a', label: 'First thing', detail: 'Optional short detail' },
      { id: 'b', label: 'Second thing' },
    ],
    edges: [{ id: 'a-to-b', from: 'a', to: 'b', label: 'optional', dashed: false }],
    cites: CITES,
    description: DESCRIPTION,
    caption: 'Optional one-line caption.',
  },
  sequence: {
    type: 'sequence',
    actors: [
      { id: 'left', label: 'Who starts' },
      { id: 'right', label: 'Who answers' },
    ],
    messages: [
      { id: 'm1', from: 'left', to: 'right', label: 'What is sent', status: 'ok' },
      { id: 'm2', from: 'right', to: 'left', label: 'What comes back' },
    ],
    cites: CITES,
    description: DESCRIPTION,
  },
  layers: {
    type: 'layers',
    layers: [
      { id: 'top', label: 'Top layer', detail: 'Optional short detail' },
      { id: 'bottom', label: 'Bottom layer' },
    ],
    cites: CITES,
    description: DESCRIPTION,
  },
  timeline: {
    type: 'timeline',
    events: [
      { id: 't1', when: 'When (free text)', label: 'What happened', detail: 'Optional short detail' },
      { id: 't2', when: 'Later', label: 'What happened next' },
    ],
    cites: CITES,
    description: DESCRIPTION,
  },
  compare: {
    type: 'compare',
    rowHeading: 'Optional row-label heading',
    columns: [
      { id: 'c1', label: 'Option A' },
      { id: 'c2', label: 'Option B' },
    ],
    rows: [{ id: 'r1', label: 'What is compared', cells: ['Value for A', 'Value for B'] }],
    cites: CITES,
    description: DESCRIPTION,
  },
  chart: {
    type: 'chart',
    mark: 'bar',
    data: 'sourced',
    xLabel: 'What the x axis is',
    yLabel: 'What the y axis is',
    unit: 'unit',
    xs: [
      { id: 'x1', label: 'First' },
      { id: 'x2', label: 'Second' },
    ],
    series: [{ id: 'main', label: 'What is measured', values: [1, 2] }],
    cites: CITES,
    description: DESCRIPTION,
  },
  lines: {
    type: 'lines',
    format: 'code',
    language: 'Python',
    lines: ['first line (parts are addressed as l1, l2, ...)', 'second line'],
    description: DESCRIPTION,
  },
};

const EXPLANATION = { text: 'Why the right answer is right, in a sentence or two.', cites: CITES };

const QUESTIONS: Record<QuestionType, unknown> = {
  single: {
    type: 'single',
    prompt: 'A question that makes the learner use what was taught.',
    options: [
      { text: 'The correct answer', correct: true, feedback: 'Why this is right, in one sentence.' },
      { text: 'A tempting wrong answer', correct: false, feedback: 'Why this is wrong, in one sentence.', misconception: 'The mistaken belief that leads here' },
      { text: 'Another tempting wrong answer', correct: false, feedback: 'Why this is wrong, in one sentence.', misconception: 'The mistaken belief that leads here' },
    ],
    explanation: EXPLANATION,
    hint: 'Optional nudge that does not give the answer away.',
  },
  order: {
    type: 'order',
    prompt: 'Put these in order.',
    items: ['First, in the correct order', 'Second', 'Third'],
    explanation: EXPLANATION,
  },
  numeric: {
    type: 'numeric',
    prompt: 'A question whose answer is a number the learner works out.',
    answer: 0,
    tolerance: 0,
    unit: 'unit',
    explanation: EXPLANATION,
  },
  reflect: {
    type: 'reflect',
    prompt: 'A question the learner answers in their own words.',
    modelAnswer: { text: 'A good answer, in two or three sentences.', cites: CITES },
    lookFor: ['First thing a good answer contains', 'Second thing a good answer contains'],
  },
};

const STEP = {
  title: 'Optional step title',
  highlight: ['part-id'],
  blocks: [BLOCKS[0]],
  state: [{ label: 'name', value: 'value now' }],
};

const PREDICT = {
  prompt: 'What happens next? (asked before this step is revealed)',
  options: [
    { text: 'What actually happens', correct: true, feedback: 'Why, in one sentence.' },
    { text: 'A plausible wrong guess', correct: false, feedback: 'Why not, in one sentence.' },
  ],
};

// ---------------------------------------------------------------------------------------------
// Clips: one skeleton for each stage kind. A stage, and three beats that use the verbs the stage
// is best at. Every id an action names is a part of the stage above it, so a skeleton whose
// strings are replaced is a clip that plays.
// ---------------------------------------------------------------------------------------------

const CAPTION_CLAIM = { type: 'claim', text: 'One fact from a source, in one short line.', cites: CITES };
const CAPTION_QUOTE = { type: 'quote', text: 'a few words copied exactly from the cited excerpt', cite: 'e1' };
const CAPTION_EXAMPLE = { type: 'example', text: 'One step of a worked case, in your own words.', basedOn: CITES };
const CAPTION_FRAMING = { type: 'framing', text: 'A short link or a question to the learner. Never a fact.' };
// Short on purpose: an analogy's `limits` are read with it and count towards the caption's words.
const CAPTION_ANALOGY = { type: 'analogy', text: 'A comparison to something the learner knows.', limits: 'Where the comparison stops being true.' };

const GATE = {
  prompt: 'What happens next? (asked before this beat plays)',
  options: [
    { text: 'What actually happens', correct: true, feedback: 'Why, in one sentence.' },
    { text: 'A plausible wrong guess', correct: false, feedback: 'Why not, in one sentence.' },
  ],
};

/** A gate answered on the picture: the learner taps a part of the stage. `pick` is filled in by the template that uses it. */
const TAP_GATE = {
  prompt: 'Which part is it? (the learner taps it on the stage, before this beat plays)',
  right: 'Why that part is the one, in one sentence.',
  wrong: 'What to look at again, without naming the part.',
};

const STAT = { id: 'count', label: 'What is counted', value: 0 };

/** The words of an explore, the same in every template that shows one. */
const EXPLORE_PROMPT = 'What to drag and what to watch, in one line.';
const CONTROL_LABEL = 'What the slider sets';
const GOAL = { text: 'An outcome to bring about by dragging. Never the setting that does it.', done: 'Why that worked, in one sentence.' };

/**
 * The code of the frame skeleton: a complete, valid frame that draws five bars and reads its one
 * slider. It passes the frame checks as it stands, so an agent starts from something that runs.
 */
export const FRAME_TEMPLATE_CODE = [
  '// Set-up at the top: constants and tables, worked out once.',
  'const BARS = 5;',
  '',
  'function render(ctx, t) {',
  '  // Draw one instant. Everything is a function of t (seconds) and of S: no timers, nothing kept between frames.',
  '  const { W, H, theme: c } = S;',
  '  S.clear();',
  '  const grow = S.prog(t, 0, 2, S.ease.out);',
  '  for (let i = 0; i < BARS; i++) {',
  '    const h = H * 0.12 * (i + 1) * grow * (S.params.amount / 10);',
  '    S.rect(W * (0.18 + i * 0.13), H * 0.85 - h, W * 0.09, h, { fill: c.accentSoft, stroke: c.accent, lw: 2, r: 6 });',
  '  }',
  '}',
  '',
].join('\n');

interface Skeleton {
  stage: unknown;
  beats: unknown[];
  /** After the last beat the learner drags: on the stages whose numbers can follow a slider. */
  explore?: unknown;
}

const STAGES: Record<PlanStageKind, Skeleton> = {
  sequence: {
    stage: {
      kind: 'sequence',
      actors: [
        { id: 'left', label: 'Who starts' },
        { id: 'right', label: 'Who answers' },
      ],
      messages: [
        { id: 'm1', from: 'left', to: 'right', label: 'What is sent' },
        { id: 'm2', from: 'right', to: 'left', label: 'What comes back' },
      ],
      stats: [STAT],
      cites: CITES,
      provenance: 'sourced',
    },
    beats: [
      { caption: CAPTION_CLAIM, do: [{ verb: 'send', target: 'm1' }] },
      { caption: CAPTION_QUOTE, gate: GATE, do: [{ verb: 'send', target: 'm2' }, { verb: 'set', target: 'count', value: 1, with: true }] },
      { caption: CAPTION_ANALOGY, do: [{ verb: 'focus', targets: ['right'] }, { verb: 'set', target: 'right', tone: 'good' }] },
    ],
  },
  cells: {
    stage: {
      kind: 'cells',
      indices: true,
      cells: [
        { id: 'c0', label: 'a' },
        { id: 'c1', label: 'b' },
        { id: 'c2', label: 'c' },
      ],
      pointers: [{ id: 'at', label: 'here', side: 'below' }],
      brackets: [{ id: 'range', label: 'What the bracket marks' }],
      stats: [STAT],
      cites: CITES,
      provenance: 'worked',
    },
    beats: [
      { caption: CAPTION_EXAMPLE, do: [{ verb: 'move', target: 'range', to: ['c0', 'c2'] }, { verb: 'move', target: 'at', to: 'c0', with: true }] },
      // A gate answered by a tap: the right cell is on stage before this beat plays, among others.
      { caption: CAPTION_CLAIM, gate: { ...TAP_GATE, pick: ['c1'] }, do: [{ verb: 'move', target: 'at', to: 'c1' }, { verb: 'set', target: 'c1', tone: 'warn', with: true }, { verb: 'set', target: 'count', value: 1, with: true }] },
      { caption: CAPTION_FRAMING, do: [{ verb: 'swap', a: 'c0', b: 'c2' }, { verb: 'focus', between: ['c0', 'c1'] }] },
    ],
  },
  dots: {
    stage: {
      kind: 'dots',
      total: 100,
      legend: '1 dot = 1 of what is counted',
      group: { id: 'all', label: 'Everyone at the start' },
      stats: [STAT],
      cites: CITES,
      provenance: 'worked',
    },
    beats: [
      {
        caption: CAPTION_CLAIM,
        do: [
          {
            verb: 'split',
            target: 'all',
            into: [
              { id: 'some', label: 'One group', count: 40, tone: 'accent' },
              { id: 'rest', label: 'The rest', count: 60, tone: 'muted' },
            ],
          },
        ],
      },
      {
        caption: CAPTION_EXAMPLE,
        gate: GATE,
        do: [
          {
            verb: 'split',
            target: 'some',
            into: [
              { id: 'few', label: 'Part of that group', count: 10, tone: 'good' },
              { id: 'others', label: 'The other part', count: 30 },
            ],
          },
          { verb: 'set', target: 'count', value: 10, with: true },
        ],
      },
      { caption: CAPTION_FRAMING, do: [{ verb: 'merge', targets: ['others', 'rest'], into: { id: 'left-over', label: 'Everyone else', tone: 'muted' } }, { verb: 'focus', targets: ['few'] }] },
    ],
    // "few" was split from "some", which held 40 dots: it can take up to 40, and starts at the 10 the clip ends on.
    explore: {
      prompt: EXPLORE_PROMPT,
      controls: [{ id: 'rate', label: CONTROL_LABEL, min: 0, max: 100, step: 5, value: 25, unit: '%' }],
      bind: [
        { target: 'few', expr: '40 * rate / 100' },
        { target: 'count', expr: '40 * rate / 100' },
      ],
      // True at one place inside the range (half of the 40), false where the slider starts and at both its ends.
      goal: { text: GOAL.text, when: 'abs(40 * rate / 100 - 20) < 1', done: GOAL.done },
    },
  },
  chart: {
    stage: {
      kind: 'chart',
      mark: 'bars',
      yLabel: 'What the values are',
      unit: 'unit',
      bars: [
        { id: 'a', label: 'First thing', value: 10 },
        { id: 'b', label: 'Second thing', value: 20 },
      ],
      cites: CITES,
      // A stage with an explore is a worked example: dragging shows numbers no passage states.
      provenance: 'worked',
    },
    beats: [
      { caption: CAPTION_CLAIM, do: [{ verb: 'show', targets: ['a', 'b'] }] },
      { caption: CAPTION_EXAMPLE, gate: GATE, do: [{ verb: 'set', target: 'b', value: 40 }, { verb: 'set', target: 'b', tone: 'accent', with: true }] },
      { caption: CAPTION_FRAMING, do: [{ verb: 'reorder', order: ['b', 'a'] }, { verb: 'focus', targets: ['b'] }] },
    ],
    // The bar "b" follows the slider: 40 at the start, where the clip left it.
    explore: {
      prompt: EXPLORE_PROMPT,
      controls: [{ id: 'amount', label: CONTROL_LABEL, min: 0, max: 10, step: 1, value: 4 }],
      bind: [{ target: 'b', expr: 'amount * 10' }],
      // True at one place inside the range, false where the slider starts and at both its ends.
      goal: { text: GOAL.text, when: 'abs(amount * 10 - 70) < 5', done: GOAL.done },
    },
  },
  flow: {
    stage: {
      kind: 'flow',
      nodes: [
        { id: 'a', label: 'First thing' },
        { id: 'b', label: 'Second thing' },
        { id: 'c', label: 'What it leads to' },
      ],
      edges: [
        { id: 'a-to-b', from: 'a', to: 'b', label: 'optional' },
        { id: 'b-to-c', from: 'b', to: 'c' },
      ],
      cites: CITES,
      provenance: 'sourced',
    },
    beats: [
      { caption: CAPTION_CLAIM, do: [{ verb: 'draw', target: 'a-to-b' }] },
      { caption: CAPTION_QUOTE, gate: GATE, do: [{ verb: 'show', target: 'c' }, { verb: 'draw', target: 'b-to-c' }] },
      { caption: CAPTION_FRAMING, do: [{ verb: 'send', along: 'a-to-b', label: 'what travels' }, { verb: 'set', target: 'c', tone: 'good' }] },
    ],
  },
  words: {
    stage: {
      kind: 'words',
      lines: [
        { id: 'hook', text: 'The few words that open the idea', size: 'xl' },
        { id: 'ask', text: 'The question this clip leaves the learner with', size: 'l' },
      ],
      cites: CITES,
      provenance: 'illustrative',
    },
    beats: [
      { caption: CAPTION_FRAMING, do: [{ verb: 'show', target: 'hook' }] },
      { caption: CAPTION_CLAIM, do: [{ verb: 'show', target: 'ask' }, { verb: 'set', target: 'ask', tone: 'accent' }] },
    ],
  },
  lines: {
    stage: {
      kind: 'lines',
      format: 'code',
      language: 'Python',
      lines: ['first line (parts are addressed as l1, l2, ...)', 'second line', 'third line'],
      pointers: [{ id: 'pc', label: 'now' }],
      brackets: [{ id: 'block', label: 'What the bracket marks' }],
      annotations: [{ id: 'note', at: 'l2', text: 'A short remark attached to a line.' }],
      values: [{ id: 'x', at: 'l1', label: 'x' }],
      cites: CITES,
      provenance: 'worked',
    },
    beats: [
      { caption: CAPTION_EXAMPLE, do: [{ verb: 'move', target: 'pc', to: 'l1' }, { verb: 'set', target: 'x', value: 1, with: true }] },
      { caption: CAPTION_CLAIM, gate: GATE, do: [{ verb: 'move', target: 'pc', to: 'l2' }, { verb: 'show', target: 'note' }] },
      { caption: CAPTION_FRAMING, do: [{ verb: 'move', target: 'block', to: ['l2', 'l3'] }, { verb: 'focus', between: ['l2', 'l3'] }] },
    ],
  },
  timeline: {
    stage: {
      kind: 'timeline',
      events: [
        { id: 't1', when: 'When (free text)', label: 'What happened', detail: 'Optional: one more sentence, shown while the event is in focus.' },
        { id: 't2', when: 'Later', label: 'What happened next' },
        { id: 't3', when: 'Later still', label: 'How it ended' },
      ],
      spans: [{ id: 'gap', from: 't1', to: 't3', label: 'How long it took' }],
      markers: [{ id: 'now', label: 'now' }],
      cites: CITES,
      provenance: 'sourced',
    },
    beats: [
      { caption: CAPTION_CLAIM, do: [{ verb: 'show', target: 't1' }, { verb: 'move', target: 'now', to: 't1' }] },
      { caption: CAPTION_QUOTE, gate: GATE, do: [{ verb: 'draw', target: 'track', upto: 't2' }, { verb: 'move', target: 'now', to: 't2' }] },
      { caption: CAPTION_FRAMING, do: [{ verb: 'draw', target: 'track' }, { verb: 'show', target: 'gap' }, { verb: 'focus', targets: ['t3'] }] },
    ],
  },
  frame: {
    stage: {
      kind: 'frame',
      code: FRAME_TEMPLATE_CODE,
      duration: 8,
      aspect: '16:9',
      params: [{ id: 'amount', label: 'What the slider sets', min: 0, max: 10, step: 1, value: 5, unit: 'unit' }],
      poster: 4,
      cites: CITES,
      provenance: 'worked',
    },
    // A frame clip has no actions: a beat is a caption and the second it appears.
    beats: [
      { caption: CAPTION_CLAIM, at: 0 },
      { caption: CAPTION_EXAMPLE, at: 3 },
    ],
  },
};

/**
 * The two other charts: a clip planned as `stage: "chart"` gets the bars skeleton above unless its
 * outline entry names another `mark`.
 */
const CHARTS: Record<Exclude<PlanChartMark, 'bars'>, Skeleton> = {
  line: {
    stage: {
      kind: 'chart',
      mark: 'line',
      yLabel: 'What the values are',
      unit: 'unit',
      xs: ['First', 'Second', 'Third'],
      series: [
        { id: 'main', label: 'What is measured', values: [10, 20, 40] },
        { id: 'other', label: 'What it is compared with', values: [10, 15, 20], tone: 'muted' },
      ],
      stats: [STAT],
      cites: CITES,
      provenance: 'sourced',
    },
    beats: [
      { caption: CAPTION_CLAIM, do: [{ verb: 'draw', target: 'main', upto: 'Second' }] },
      { caption: CAPTION_CLAIM, gate: GATE, do: [{ verb: 'draw', targets: ['main', 'other'] }, { verb: 'set', target: 'count', value: 40, with: true }] },
      { caption: CAPTION_FRAMING, do: [{ verb: 'focus', targets: ['main'] }] },
    ],
  },
  curve: {
    stage: {
      kind: 'chart',
      mark: 'curve',
      yLabel: 'What the values are',
      x: { label: 'What x is', min: 0, max: 10 },
      // Each curve is y = expr, a formula in x and the control ids. The point sits where the two meet.
      curves: [
        { id: 'f', label: 'First curve', expr: 'slope * x' },
        { id: 'g', label: 'Second curve', expr: '20 - x', tone: 'muted' },
      ],
      points: [{ id: 'meet', label: 'A place on a curve', x: '20 / (slope + 1)', on: 'f' }],
      stats: [{ id: 'count', label: 'What is read off', value: 10 }],
      cites: CITES,
      provenance: 'worked',
    },
    beats: [
      { caption: CAPTION_CLAIM, do: [{ verb: 'draw', target: 'f' }] },
      { caption: CAPTION_EXAMPLE, gate: GATE, do: [{ verb: 'draw', target: 'g' }, { verb: 'show', target: 'meet' }] },
      { caption: CAPTION_FRAMING, do: [{ verb: 'focus', targets: ['meet'] }, { verb: 'set', target: 'meet', tone: 'accent', with: true }] },
    ],
    // The curves need no binding: their formulas name the control. A read-out is bound like any other.
    explore: {
      prompt: EXPLORE_PROMPT,
      controls: [{ id: 'slope', label: CONTROL_LABEL, min: 1, max: 4, step: 0.5, value: 1 }],
      bind: [{ target: 'count', expr: '20 / (slope + 1)' }],
      goal: { text: GOAL.text, when: 'abs(20 / (slope + 1) - 5) < 0.5', done: GOAL.done },
    },
  },
};

type TemplateEntry = Pick<OutlineEntry, 'id' | 'kind' | 'figure' | 'question' | 'objective' | 'stage' | 'mark'>;

/** The skeleton for one planned scene. Returns a fresh object each call. */
export function templateFor(entry: TemplateEntry): Record<string, unknown> {
  const base = { id: entry.id, kind: entry.kind, title: 'Scene title' };
  let out: Record<string, unknown>;
  switch (entry.kind) {
    case 'clip': {
      const kind = entry.stage ?? 'flow';
      const { stage, beats, explore } = kind === 'chart' && entry.mark !== undefined && entry.mark !== 'bars' ? CHARTS[entry.mark] : STAGES[kind];
      out = { ...base, description: 'What the clip shows and the point it makes, for someone who cannot see it.', stage, beats, ...(explore !== undefined ? { explore } : {}) };
      break;
    }
    case 'narration':
      out = { ...base, blocks: BLOCKS, ...(entry.figure ? { figure: FIGURES[entry.figure] } : {}) };
      break;
    case 'step_through':
      out = {
        ...base,
        intro: 'Optional one line shown before the first step.',
        figure: FIGURES[entry.figure ?? 'flow'],
        steps: [STEP, { ...STEP, predict: PREDICT }],
      };
      break;
    case 'checkpoint':
      out = { ...base, objective: entry.objective ?? 'o1', level: 'apply', question: QUESTIONS[entry.question ?? 'single'] };
      break;
    case 'recap':
      out = {
        ...base,
        takeaways: [{ objective: 'o1', text: 'What the learner can now do or explain, one per objective.', cites: CITES }],
        practice: { task: 'Optional: something to try away from the screen.', lookFor: ['An observable sign it worked'] },
        next: [{ topic: 'A follow-up topic', why: 'Why it is the natural next lesson.' }],
      };
      break;
  }
  return structuredClone(out);
}

/** What every template has in common, whatever the kind of scene. */
const HOW_TO_READ = 'Templates show shape and field names. Replace every string; delete optional fields you do not need.';

/**
 * How to read the templates of a lesson of clips, checkpoints and a recap: what plan_lesson sends
 * with them. Every sentence here is true of a clip (a clip's chart has `mark` "bars", "line" or "curve"),
 * and none describes a scene of the older kinds.
 */
export const CLIP_TEMPLATE_NOTES = [
  HOW_TO_READ,
  'A clip is a stage (typed parts, each with an id) and 2 to 8 beats. A beat is `caption` and `do`. The caption is ONE block (claim, quote, example, analogy or framing), not a list: at most 22 words, 16 or fewer is the target (an analogy is counted with its `limits`). At least one caption of every clip must be a claim or a quote, the opening `words` clip included. You never write a time, a position, a size or a colour.',
  '`do` is a list of up to 4 actions, each a verb on part ids: { "verb", "target" (one id) or "targets" (a list), ...parameters }. The verbs are show, hide, draw, send, focus, set, move, swap, split, merge, reorder, pulse. At least two thirds of a clip\'s beats need an action: a caption over a picture that does not change is a slide.',
  `Each stage kind has its own verbs, and each verb its own kinds of part. ${STAGE_VERB_NOTES} A read-out (an entry of "stats") takes show, hide, set (value, tone), pulse and focus on every stage that has them.`,
  'Two hints order the actions of a beat. `with: true` starts an action together with the one before it; without it an action starts as the one before it ends. `on` is a word or short phrase copied from this beat\'s caption: the action waits until that word is read.',
  '`gate` on a beat is a prediction (a prompt and 2 to 4 options, exactly one correct, feedback on each). The clip stops before that beat plays until the learner answers or skips, so put it on the beat that shows the outcome, never on the first beat. The templates show one; keep it where a learner can really predict, delete it elsewhere, and make sure no more than 3 scenes in a row go without a gate or a checkpoint. The learner acts before being told: at least two of every three clips need a gate or an `explore`.',
  'A gate may be answered on the picture instead (the cells template shows one): { "prompt", "pick": [ids of the parts that are right], "right", "wrong" }. The learner taps a part; use it only when the answer IS a part of the picture, on stage before that beat plays with nothing marking it and at least one other to choose from: a cell, a bar, a line or a curve of a chart, a point on a curve, a node or an edge, an actor or a message, an event, a line, a group of dots. `right` says why; `wrong` says what to look at again, without naming the part.',
  `\`explore\` on a clip (the chart and dots templates show one) comes last, after the beats have named the parts, and hands the picture to the learner: \`prompt\` (what to drag, what to watch), 1 or 2 \`controls\` (sliders { "id", "label", "min", "max", "step", "value" }: at most ${L.explore.steps} steps, starting on one; the beats play at \`value\`), \`bind\` ([{ "target", "expr" }]: a formula drives a read-out on any stage, a bar, a split-off group of dots, or a value beside a line) and an optional \`goal\` { "text", "when", "done" }, where \`when\` is a condition that is false at the start and true somewhere inside the range (not at an end: a goal reached by dragging to the end is warned about), and \`text\` names an outcome, never the setting. Every control must be used. A stage with an explore is "worked" or "illustrative", never "sourced". Its text is yours and uncited (the prompt and the goal count as uncited prose). The text of an explore or of a tap gate may name a number the picture holds (on the stage, an end or the start of a slider, a constant of a formula) or a stored passage holds, and no other.`,
  `A formula (\`expr\`, a point's \`x\`, \`when\`) is a string. ${EXPR_HELP} A power is ^ and not **, every multiplication is written with *, and there is no %. It names control ids only (a curve's \`expr\` also x), never a part of the stage, and is tried over the whole range of the sliders before the clip is accepted: every value finite, a bar or a group never negative, bound groups never more than the group they were split from.`,
  'A stage says where its content comes from. `provenance` "sourced": every number and name on the stage, and every number an action brings on, must be in a passage listed in the stage\'s `cites`. "worked": your own worked case; its numbers are yours, and `cites` must still name the passage whose rule it applies. "illustrative": the shape is the point; nothing on it is checked, it needs no `cites`, and the page says so. The clip\'s `description` is the text alternative of the stage and follows the same rule.',
  'Values that are a choice, not text: a checkpoint `level` is "recall" or "apply" (the template shows "apply"; choose). chart `mark` is "bars" (the template), "line" (in place of `bars`: "xs": ["label", ...] and "series": [{ "id", "label", "values": [one per x] }], drawn with the verb draw, which may stop at an x label with "upto") or "curve" (a function plot: "x": { "label", "min", "max" }, "curves": [{ "id", "label", "expr" }], each y = a formula in x, optional "points": [{ "id", "label", "x", "on" }] marking a place on a curve; never "sourced"). Plan the clip with "mark": "line" or "curve" to get that template. lines `format` is "code", "math" or "text", and its lines are the parts l1, l2, ... A timeline\'s whole track is the part "track"; give events a "lane" only if you declare "lanes". `tone` is "neutral", "accent", "good", "bad", "warn" or "muted". A words line `size` is "xl", "l" or "m". `pace` of a clip is "brisk", "normal" or "calm".',
  'A frame clip (stage kind "frame") has no actions: each beat is a caption and `at`, the second its caption appears (the first 0, each later than the one before, all inside `duration`). `code` is the body of a function that declares `function render(ctx, t)`; it is stored exactly as you send it and checked without being run. `poster` is the second of the still that stands for the animation. A lesson may have at most 2 frames: what code draws cannot be checked against a source.',
];

/**
 * How to read the templates of the older scene kinds (`narration`, `step_through`, and the figures
 * they carry). Those kinds are still validated but no longer planned; these notes are kept for a
 * caller that shows one of their templates. Note that a FIGURE's chart has `mark` "bar", "line" or
 * "step" and `data`, where a clip's chart stage has `mark` "bars" or "line" and `provenance`.
 */
export const LEGACY_TEMPLATE_NOTES = [
  HOW_TO_READ,
  'A narration scene takes 1 or more blocks in any mix; you do not need one of each type.',
  'In a step-through, each step highlights figure part ids and may carry `state` and one `predict`.',
  'A step-through over a "lines" figure highlights l1, l2, ... by line number.',
  'Values that are a choice, not text: checkpoint level is "recall" or "apply" (the template shows "apply"; choose). flow layout is "right", "down" or "ring". chart mark is "bar", "line" or "step" and chart data is "sourced" or "illustrative". lines format is "code", "math" or "text" (language applies to code only). A sequence message status is "ok" or "lost".',
  'A figure cites the passages its content comes from (up to 6). Every number in a figure must appear in a passage that figure cites, unless it is a chart marked "illustrative" or a "lines" figure.',
];

/** How to read a template. Sent once with the plan response. The notes for a lesson of clips: see `LEGACY_TEMPLATE_NOTES` for the older kinds. */
export const TEMPLATE_NOTES: string[] = CLIP_TEMPLATE_NOTES;

/** The notes that go with a plan holding these scene kinds: the clip notes, and the older ones only when the plan has a scene of an older kind. */
export function templateNotesFor(kinds: Iterable<string>): string[] {
  const planned = new Set(kinds);
  const legacy = planned.has('narration') || planned.has('step_through');
  return legacy ? [...CLIP_TEMPLATE_NOTES, ...LEGACY_TEMPLATE_NOTES.slice(1)] : [...CLIP_TEMPLATE_NOTES];
}
