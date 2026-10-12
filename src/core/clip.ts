// The v2 lesson format: clips. A clip is a teaching scene whose picture is the lesson: a stage of
// typed parts, and beats that each carry one caption and the motion that goes with it.
//
// Design rules (they extend the rules at the top of `schema.ts`, which still bind):
//   - The agent writes WHAT is on stage and WHAT happens to it. It never writes a duration, an
//     easing, a coordinate, a size in pixels or a colour. There is no field for any of them.
//   - Every object is strict: an unknown key is an error.
//   - A caption is ONE block of the v1 block union, so the citation rule is unchanged.
//   - Parts are named by ids the agent chooses; verbs act on ids.
//
// Where things live:
//   - `clip-base.ts`       : tones, provenance, read-outs, limits. Stage schema files import from
//                            there, NEVER from this file (this file imports them: that would be a cycle).
//   - `clip-kits-extra.ts` : the `lines` and `timeline` stage schemas, their part kinds and checks.
//   - `frame.ts`           : the `frame` stage schema (custom animation code).
//   - this file            : the six prototype stages, the verbs, Beat, ClipScene, AnyScene, LessonV2.
//
// What the schema does NOT check (the validator's job, listed at the bottom of this file):
// cross-references between ids, which verbs a stage kind accepts, and the citation rules.
import { z } from 'zod';
import { Block, CheckpointScene, Id, Lesson, NarrationScene, Predict, RecapScene, StepThroughScene } from './schema';
import { LIMITS as L } from './limits';
import { CLIP_DESCRIPTION_CHARS, CLIP_LIMITS, Tone, clipText, stageCommon, stageStats } from './clip-base';
import { EXTRA_VERBS_BY_STAGE, LinesStage, TimelineStage } from './clip-kits-extra';
import { FrameStage, FrameTime } from './frame';
import { EXPR_LIMITS, EXPR_RESERVED } from './expr';

export { CLIP_LIMITS, PROVENANCES, Provenance, StageStat, TONES, Tone, stageCommon, stageStats } from './clip-base';

const C = CLIP_LIMITS;
const text = clipText;

// ---------------------------------------------------------------------------------------------
// Stages: the building blocks, by kind. A stage declares every part and its id.
// ---------------------------------------------------------------------------------------------

/** Who sends what to whom, in order. Actors are columns; each message is a row, sent by `send`. */
export const SequenceStage = z.strictObject({
  kind: z.literal('sequence'),
  actors: z.array(z.strictObject({ id: Id, label: text(C.sequence.actorChars) })).min(C.sequence.actors.min).max(C.sequence.actors.max),
  /** In the order they are drawn, top to bottom. A message is not on stage until a `send` names it. */
  messages: z
    .array(z.strictObject({ id: Id, from: Id, to: Id, label: text(C.sequence.messageChars) }))
    .min(C.sequence.messages.min)
    .max(C.sequence.messages.max),
  ...stageStats,
  ...stageCommon,
});

/** A row of cells (an array, a tape, a queue) with pointers that walk it and brackets that span a range. */
export const CellsStage = z.strictObject({
  kind: z.literal('cells'),
  cells: z.array(z.strictObject({ id: Id, label: text(C.cells.cellChars) })).min(C.cells.cells.min).max(C.cells.cells.max),
  /** Show each cell's position (0, 1, 2 ...) under it. */
  indices: z.boolean().optional(),
  /** A pointer is off stage until its first `move`. `side` defaults to "below". */
  pointers: z
    .array(z.strictObject({ id: Id, label: text(C.cells.pointerChars), side: z.enum(['above', 'below']).optional(), tone: Tone.optional() }))
    .max(C.cells.pointers)
    .optional(),
  /** A bracket is off stage until its first `move`. */
  brackets: z.array(z.strictObject({ id: Id, label: text(C.cells.bracketChars).optional() })).max(C.cells.brackets).optional(),
  ...stageStats,
  ...stageCommon,
});

/** A population of units, one dot each, that `split` into labelled groups and `merge` again. */
export const DotsStage = z.strictObject({
  kind: z.literal('dots'),
  total: z.number().int().min(C.dots.total.min).max(C.dots.total.max),
  /** What one dot is: "1 dot = 1 person". */
  legend: text(C.dots.legendChars).optional(),
  /** The one group every dot starts in. */
  group: z.strictObject({ id: Id, label: text(C.dots.groupChars), tone: Tone.optional() }),
  ...stageStats,
  ...stageCommon,
});

const chartValue = z.number().finite().min(-C.chart.maxAbsValue).max(C.chart.maxAbsValue);
const chartCommon = {
  kind: z.literal('chart'),
  /** Printed after every value: "%", " ms". */
  unit: text(C.chart.unitChars).optional(),
  /** Top of the value axis. Left out, the engine picks it from the largest value the clip reaches. */
  max: chartValue.optional(),
  /** What the values are, shown as the axis title. */
  yLabel: text(C.chart.axisChars).optional(),
};
/** Bars that grow from a zero baseline, change with `set`, and trade places with `reorder`. Values are zero or more. */
export const BarsChartStage = z.strictObject({
  ...chartCommon,
  mark: z.literal('bars'),
  bars: z
    .array(z.strictObject({ id: Id, label: text(C.chart.barChars), value: chartValue.min(0), tone: Tone.optional() }))
    .min(C.chart.bars.min)
    .max(C.chart.bars.max),
  ...stageStats,
  ...stageCommon,
});
/** Lines drawn left to right by `draw`, the value riding the tip. Each series has one value per x position. */
export const LineChartStage = z.strictObject({
  ...chartCommon,
  mark: z.literal('line'),
  /** The x positions, left to right, by their labels. `draw ... upto` names one of them. */
  xs: z.array(text(C.chart.xChars)).min(C.chart.xs.min).max(C.chart.xs.max),
  series: z
    .array(z.strictObject({ id: Id, label: text(C.chart.seriesChars), values: z.array(chartValue).min(C.chart.xs.min).max(C.chart.xs.max), tone: Tone.optional() }))
    .min(C.chart.series.min)
    .max(C.chart.series.max),
  ...stageStats,
  ...stageCommon,
});
/** A formula in the small arithmetic language of `expr.ts`: numbers, control ids, `x` on a curve, + - * / ^ and a fixed list of functions. */
export const Formula = z.string().min(1).max(EXPR_LIMITS.chars);
const axisNumber = z.number().finite().min(-C.chart.maxAbsValue).max(C.chart.maxAbsValue);
/**
 * A function plot: each curve is `y = expr` over a numeric x axis. A curve's formula may use `x`
 * and the ids of the clip's `explore` controls, so the curve bends as the learner drags. `draw`
 * draws a curve left to right. `points` mark a place on a curve (an equilibrium, a peak) by its x.
 */
export const CurveChartStage = z.strictObject({
  ...chartCommon,
  mark: z.literal('curve'),
  x: z.strictObject({ label: text(C.chart.axisChars), min: axisNumber, max: axisNumber, unit: text(C.chart.unitChars).optional() }),
  /** Bottom of the value axis. Left out, it is 0 or the lowest value the curves reach. */
  min: chartValue.optional(),
  curves: z.array(z.strictObject({ id: Id, label: text(C.chart.seriesChars), expr: Formula, tone: Tone.optional() })).min(1).max(3),
  points: z.array(z.strictObject({ id: Id, label: text(C.chart.seriesChars), x: Formula, on: Id.optional(), tone: Tone.optional() })).max(3).optional(),
  ...stageStats,
  ...stageCommon,
});
/** `kind: "chart"` with `mark: "bars"`, `mark: "line"` or `mark: "curve"`. */
export const ChartStage = z.discriminatedUnion('mark', [BarsChartStage, LineChartStage, CurveChartStage]);

/** Boxes and arrows in one row (a column on a narrow screen). Showing a node makes the others move over for it. */
export const FlowStage = z.strictObject({
  kind: z.literal('flow'),
  /** In reading order. A node named by a `show` starts off stage; the others arrive at the start. */
  nodes: z.array(z.strictObject({ id: Id, label: text(C.flow.nodeChars) })).min(C.flow.nodes.min).max(C.flow.nodes.max),
  /** A connector is not drawn until a `draw` names it (or a `send` travels along it). */
  edges: z
    .array(z.strictObject({ id: Id, from: Id, to: Id, label: text(C.flow.edgeChars).optional() }))
    .min(C.flow.edges.min)
    .max(C.flow.edges.max),
  ...stageStats,
  ...stageCommon,
});

/** Kinetic type: a few lines of large text that arrive word by word. For a cold open, a question, a definition. */
export const WordsStage = z.strictObject({
  kind: z.literal('words'),
  /** `size`: "xl" for the one line that matters, "l" (the default), "m" for a supporting line. */
  lines: z
    .array(z.strictObject({ id: Id, text: text(C.words.lineChars), size: z.enum(['xl', 'l', 'm']).optional() }))
    .min(C.words.lines.min)
    .max(C.words.lines.max),
  ...stageCommon,
});

// The `lines` and `timeline` stages (./clip-kits-extra) and the `frame` stage (./frame) are written
// beside this file and joined into the union here.
export { LinesStage, TimelineStage } from './clip-kits-extra';
export { FrameStage } from './frame';

export const Stage = z.discriminatedUnion('kind', [SequenceStage, CellsStage, DotsStage, ChartStage, FlowStage, WordsStage, LinesStage, TimelineStage, FrameStage]);
export const STAGE_KINDS = ['sequence', 'cells', 'dots', 'chart', 'flow', 'words', 'lines', 'timeline', 'frame'] as const;
export const StageKind = z.enum(STAGE_KINDS);

// ---------------------------------------------------------------------------------------------
// Actions: a verb on part ids. Twelve verbs; no timing, no geometry.
// ---------------------------------------------------------------------------------------------

/** Two sequencing hints, allowed on every action. */
const hints = {
  /** Start together with the previous action of this beat. Default: start as the previous one ends. */
  with: z.boolean().optional(),
  /** A word or phrase of this beat's caption: start no earlier than when it is said or read. */
  on: text(C.cueChars).optional(),
};
/** One part (`target`) or several (`targets`). Give exactly one of the two. */
const one = { target: Id.optional() };
const many = { target: Id.optional(), targets: z.array(Id).min(1).max(C.targetsPerAction).optional() };
const pair = z.tuple([Id, Id]);

/** Bring parts on, with a stagger. A part named by any `show` in the clip starts off stage. */
export const ShowAction = z.strictObject({ verb: z.literal('show'), ...many, from: z.enum(['below', 'above', 'left', 'pop']).optional(), ...hints });
/** Take parts off, faster than they arrived. */
export const HideAction = z.strictObject({ verb: z.literal('hide'), ...many, ...hints });
/**
 * Draw a connector from source to target (flow), advance a chart line, or draw a timeline's track.
 * `upto` stops early: at that x label on a line chart, at that event id on a timeline.
 */
export const DrawAction = z.strictObject({ verb: z.literal('draw'), ...many, upto: text(C.uptoChars).optional(), ...hints });
/**
 * Send a token. Sequence: `target` is a message id. Flow: `along` is an edge id, or `from` and `to`
 * are node ids (with no edge between them the token jumps across on an arc). `outcome: "lost"`: it
 * stops part-way, turns red and drops.
 */
export const SendAction = z.strictObject({
  verb: z.literal('send'),
  ...one,
  along: Id.optional(),
  from: Id.optional(),
  to: Id.optional(),
  /** Flow only: what the token carries. */
  label: text(C.flow.tokenChars).optional(),
  tone: Tone.optional(),
  outcome: z.enum(['lost']).optional(),
  ...hints,
});
/**
 * Bring parts forward; everything else recedes. With no target, everything returns and the camera
 * resets. `between` (cells): a range of cells, first and last. `zoom`: move the camera in on the targets.
 */
export const FocusAction = z.strictObject({ verb: z.literal('focus'), ...many, between: pair.optional(), zoom: z.boolean().optional(), ...hints });
/**
 * Change a part where it stands. `value`: a number counts to it (a read-out, a bar), a string
 * morphs. `label`: new words on the part. `tone`: its meaning. `size`: a flow node grows or returns.
 */
export const SetAction = z.strictObject({
  verb: z.literal('set'),
  ...many,
  /** Cells only: every cell from the first to the last. */
  between: pair.optional(),
  value: z.union([z.number().finite().min(-C.chart.maxAbsValue).max(C.chart.maxAbsValue), text(C.setValueChars)]).optional(),
  label: text(C.setLabelChars).optional(),
  tone: Tone.optional(),
  size: z.enum(['large', 'normal']).optional(),
  ...hints,
});
/** Cells: a pointer goes to a cell (`to`: cell id); a bracket stretches over a range (`to`: [first, last]). */
export const MoveAction = z.strictObject({ verb: z.literal('move'), target: Id, to: z.union([Id, pair]), ...hints });
/** Cells: two cells trade places. */
export const SwapAction = z.strictObject({ verb: z.literal('swap'), a: Id, b: Id, ...hints });
/**
 * Dots: a group divides. `into` lists the new groups; their counts add up to the group's count.
 * Members are picked scattered through the group, or from its front with `pick: "first"`.
 */
export const SplitAction = z.strictObject({
  verb: z.literal('split'),
  target: Id,
  into: z
    .array(z.strictObject({ id: Id, label: text(C.dots.groupChars), count: z.number().int().min(1).max(C.dots.total.max), tone: Tone.optional() }))
    .min(C.dots.into.min)
    .max(C.dots.into.max),
  pick: z.enum(['first']).optional(),
  ...hints,
});
/** Dots: groups flow into one. Dots keep their colours unless `into.tone` is given. */
export const MergeAction = z.strictObject({
  verb: z.literal('merge'),
  targets: z.array(Id).min(C.dots.merge.min).max(C.dots.merge.max),
  into: z.strictObject({ id: Id, label: text(C.dots.groupChars), tone: Tone.optional() }),
  ...hints,
});
/** Cells or bars: every one goes to its place in the new order. `order` names all of them, once each. */
export const ReorderAction = z.strictObject({ verb: z.literal('reorder'), order: z.array(Id).min(2).max(C.cells.cells.max), ...hints });
/** A brief swell on a part. Momentary; `focus` is the lasting one. */
export const PulseAction = z.strictObject({ verb: z.literal('pulse'), ...many, ...hints });

export const Action = z.discriminatedUnion('verb', [
  ShowAction,
  HideAction,
  DrawAction,
  SendAction,
  FocusAction,
  SetAction,
  MoveAction,
  SwapAction,
  SplitAction,
  MergeAction,
  ReorderAction,
  PulseAction,
]);
export const VERBS = ['show', 'hide', 'draw', 'send', 'focus', 'set', 'move', 'swap', 'split', 'merge', 'reorder', 'pulse'] as const;
export const Verb = z.enum(VERBS);

/**
 * Which verbs each stage accepts, as the engine implements them. The key is the stage kind, or
 * `chart.bars` / `chart.line` / `chart.curve` for the chart marks. A `frame` stage takes no verbs.
 * Read-outs (`stats`) accept show, hide, set, pulse and focus on every stage that has them.
 */
export const VERBS_BY_STAGE: Record<string, readonly Verb[]> = {
  sequence: ['show', 'hide', 'send', 'focus', 'set', 'pulse'],
  cells: ['show', 'hide', 'move', 'swap', 'reorder', 'focus', 'set', 'pulse'],
  dots: ['split', 'merge', 'focus', 'set'],
  'chart.bars': ['show', 'hide', 'set', 'reorder', 'focus', 'pulse'],
  'chart.line': ['draw', 'focus', 'set', 'pulse'],
  'chart.curve': ['show', 'hide', 'draw', 'focus', 'set', 'pulse'],
  flow: ['show', 'hide', 'draw', 'send', 'focus', 'set', 'pulse'],
  words: ['show', 'hide', 'focus', 'set', 'pulse'],
  lines: EXTRA_VERBS_BY_STAGE.lines,
  timeline: EXTRA_VERBS_BY_STAGE.timeline,
  frame: [],
};
/** The row of `VERBS_BY_STAGE` for a stage. */
export function verbsFor(stage: { kind: string; mark?: string }): readonly Verb[] {
  return VERBS_BY_STAGE[stage.kind === 'chart' ? `chart.${stage.mark}` : stage.kind] ?? [];
}

// ---------------------------------------------------------------------------------------------
// Beats and the clip
// ---------------------------------------------------------------------------------------------

/**
 * One caption and the motion that goes with it. The caption appears first; the motion follows.
 *
 * `gate`: a prediction. The clip stops BEFORE this beat (its caption and its motion are the
 * outcome) until the learner commits to an option or skips. The first beat cannot carry one.
 *
 * `at`: frame clips only. Seconds into the animation at which this beat's caption appears. Beats
 * of a frame clip have `at` and an empty `do`; beats of every other clip have no `at`.
 */
/**
 * A prediction answered on the picture: the learner taps the part they think is right. `pick`
 * lists the part ids that count as right (usually one). Use it when the answer IS a part of the
 * stage ("which cell is checked next?"); use options when it is not.
 */
export const PickGate = z.strictObject({
  prompt: clipText(L.promptChars),
  pick: z.array(Id).min(1).max(3),
  /** Shown after a right tap: why that part. */
  right: clipText(L.feedbackChars.max, L.feedbackChars.min),
  /** Shown after a wrong tap: what to notice, without giving the part away. */
  wrong: clipText(L.feedbackChars.max, L.feedbackChars.min),
});
/** A gate is options to choose from (v1's Predict) or a part to tap. */
export const Gate = z.union([Predict, PickGate]);

export const Beat = z.strictObject({
  caption: Block,
  /**
   * How to say the caption aloud, when reading it as written would go wrong: an identifier, an
   * abbreviation, a symbol or a formula. The same sentence, respelt for the ear ("memcpy" as "mem
   * copy"). The page always shows the caption; only the voice uses this.
   */
  say: clipText(400).optional(),
  do: z.array(Action).max(C.actionsPerBeat).default([]),
  gate: Gate.optional(),
  at: FrameTime.optional(),
});

// ---------------------------------------------------------------------------------------------
// Explore: the learner drives the picture
// ---------------------------------------------------------------------------------------------

/** A control's id is also its name in formulas, so it is a plain identifier and not a word the formula language uses. */
export const VAR_PATTERN = /^[a-z][a-zA-Z0-9_]{0,15}$/;
export const VarId = z
  .string()
  .regex(VAR_PATTERN, { error: 'A control id is its name in formulas: a letter, then letters, digits or "_", at most 16 characters, such as "rate".' })
  .refine((v) => !EXPR_RESERVED.has(v) && v !== 'x', { error: 'That name is taken by the formula language (a function, a constant, "x" or a logic word). Choose another.' });

/** A slider the learner drags. */
export const Control = z.strictObject({
  id: VarId,
  label: clipText(24),
  min: axisNumber,
  max: axisNumber,
  step: z.number().finite().positive(),
  /** Where it starts. The clip's beats play with every control at its starting value. */
  value: axisNumber,
  unit: clipText(C.chart.unitChars).optional(),
});

/** Ties a part's number to the controls: a read-out's value, a bar's height, a dot group's count. */
export const Binding = z.strictObject({ target: Id, expr: Formula });

/** A challenge the player can check: `when` is a condition over the controls. */
export const Goal = z.strictObject({
  /** What to make happen, in the learner's terms. Never the control setting that does it. */
  text: clipText(L.promptChars),
  when: Formula,
  /** Shown once the condition holds: why it worked. */
  done: clipText(L.feedbackChars.max, L.feedbackChars.min),
});

/**
 * After the clip's last beat the stage hands over to the learner: the controls appear, and every
 * bound part follows them live. Curves on a `chart` with `mark: "curve"` need no binding: their
 * formulas name the controls directly.
 */
export const Explore = z.strictObject({
  /** One line that tells the learner what to try and what to watch. */
  prompt: clipText(L.introChars),
  controls: z.array(Control).min(1).max(2),
  bind: z.array(Binding).max(8).default([]),
  goal: Goal.optional(),
});

/**
 * What a binding may drive, by stage (chart marks as in `VERBS_BY_STAGE`). A read-out (`stat`)
 * can be bound on every stage that has read-outs. On `dots`, bound groups are groups the clip has
 * split off by its last beat; whatever they do not take stays in the group they were split from.
 */
export const BINDABLE: Record<string, readonly string[]> = {
  sequence: ['stat'],
  cells: ['stat'],
  dots: ['group', 'stat'],
  'chart.bars': ['bar', 'stat'],
  'chart.line': ['stat'],
  'chart.curve': ['stat'],
  flow: ['stat'],
  lines: ['value', 'stat'],
  timeline: ['stat'],
  words: [],
  frame: [],
};

export const PACES = ['brisk', 'normal', 'calm'] as const;

/** A teaching scene: the stage fills the view, one caption at a time is timed to it. */
export const ClipScene = z.strictObject({
  id: Id,
  title: clipText(L.sceneTitleChars),
  kind: z.literal('clip'),
  /** Text alternative for the whole clip: what it shows and the point it makes. */
  description: clipText(CLIP_DESCRIPTION_CHARS.max, CLIP_DESCRIPTION_CHARS.min),
  /** The only timing knob: every duration and stagger is scaled a little. Default "normal". */
  pace: z.enum(PACES).optional(),
  stage: Stage,
  beats: z.array(Beat).min(C.beats.min).max(C.beats.max),
  /** Optional: after the last beat, the learner drives the picture with one or two sliders. */
  explore: Explore.optional(),
});

/** Every scene kind the page can show. `narration` and `step_through` are legacy: agents write clips. */
export const AnyScene = z.discriminatedUnion('kind', [NarrationScene, StepThroughScene, CheckpointScene, RecapScene, ClipScene]);
export const ANY_SCENE_KINDS = ['narration', 'step_through', 'checkpoint', 'recap', 'clip'] as const;

/** A lesson whose scenes may be clips. Everything else is the v1 lesson. */
export const LessonV2 = Lesson.extend({ scenes: z.array(AnyScene).min(1).max(32) });

/**
 * The narration segment id of beat `index` (0-based) of a clip: `<sceneId>.beat<N>`, N from 1.
 * One audio clip per beat; the text spoken is the beat's caption as plain text.
 */
export function beatSegmentId(sceneId: string, index: number): string {
  return `${sceneId}.beat${index + 1}`;
}

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type SequenceStage = z.infer<typeof SequenceStage>;
export type CellsStage = z.infer<typeof CellsStage>;
export type DotsStage = z.infer<typeof DotsStage>;
export type BarsChartStage = z.infer<typeof BarsChartStage>;
export type LineChartStage = z.infer<typeof LineChartStage>;
export type CurveChartStage = z.infer<typeof CurveChartStage>;
export type PickGate = z.infer<typeof PickGate>;
export type Gate = z.infer<typeof Gate>;
export type Control = z.infer<typeof Control>;
export type Binding = z.infer<typeof Binding>;
export type Goal = z.infer<typeof Goal>;
export type Explore = z.infer<typeof Explore>;
export type ChartStage = z.infer<typeof ChartStage>;
export type FlowStage = z.infer<typeof FlowStage>;
export type WordsStage = z.infer<typeof WordsStage>;
export type Stage = z.infer<typeof Stage>;
export type StageKind = z.infer<typeof StageKind>;
export type ShowAction = z.infer<typeof ShowAction>;
export type HideAction = z.infer<typeof HideAction>;
export type DrawAction = z.infer<typeof DrawAction>;
export type SendAction = z.infer<typeof SendAction>;
export type FocusAction = z.infer<typeof FocusAction>;
export type SetAction = z.infer<typeof SetAction>;
export type MoveAction = z.infer<typeof MoveAction>;
export type SwapAction = z.infer<typeof SwapAction>;
export type SplitAction = z.infer<typeof SplitAction>;
export type MergeAction = z.infer<typeof MergeAction>;
export type ReorderAction = z.infer<typeof ReorderAction>;
export type PulseAction = z.infer<typeof PulseAction>;
export type Action = z.infer<typeof Action>;
export type Verb = z.infer<typeof Verb>;
export type Beat = z.infer<typeof Beat>;
export type Pace = (typeof PACES)[number];
export type ClipScene = z.infer<typeof ClipScene>;
export type AnyScene = z.infer<typeof AnyScene>;
export type LessonV2 = z.infer<typeof LessonV2>;

// ---------------------------------------------------------------------------------------------
// For the validator: what this schema leaves unchecked
// ---------------------------------------------------------------------------------------------
//
//  1. Ids are unique within a stage (parts, read-outs, and the groups `split` and `merge` create).
//  2. Every id an action names exists on the stage at that point of the clip, and is the right
//     kind of part for the verb (see the engine's kits; `move` wants a pointer or a bracket, ...).
//  3. `verbsFor(stage)` lists the verbs a stage accepts.
//  4. Exactly one of `target` / `targets` where both are offered (`focus` may have neither).
//  5. Sequence: `from` / `to` of a message are actor ids and differ; each message is sent at most once
//     (`send` with `target`). Flow: `from` / `to` of an edge are node ids and differ; `send` gives
//     `along` (an edge id), or `from` + `to` (node ids). `stats[].at` names an actor (sequence only).
//  6. Line chart: every series has exactly `xs.length` values; `xs` are distinct; `upto` is one of them.
//  7. Dots: `split.into` counts add up to the group's count; `split` and `merge` name groups that
//     are on stage at that moment (not already split or merged away).
//  8. `reorder.order` names every cell (or bar) exactly once.
//  9. `on` is a phrase that occurs in the beat's caption text.
// 10. `gate` is not on the first beat. A frame clip's beats have `at` (ascending, within `duration`)
//     and an empty `do`; other clips' beats have no `at`.
// 11. `provenance: "sourced"` needs at least one `cites`, and the numbers on stage must appear in
//     the cited passages (the v1 figure rule). Caption blocks follow the v1 block rules unchanged.
// 12. A caption is at most about `CLIP_LIMITS.captionWords` words.
// 13. `lines` and `timeline` stages: `checkExtraStage` and the part-kind tables in clip-kits-extra.ts.
//     `frame` stages: src/frame/check.ts.
//
// The engine itself refuses what it cannot draw (src/player/stage/timeline.ts `compile` throws an
// Error whose message names the part and the verb), so a publisher can also compile each clip as a
// last check; but the validator should catch all of the above first, with its own codes.
