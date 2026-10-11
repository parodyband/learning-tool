// The lesson format. This file is the contract: the validator enforces it, the renderer draws it,
// the skill teaches it, and the tool templates are examples of it.
//
// Design rules for anyone changing it:
//   - The agent supplies typed data only. There is no field that carries HTML, SVG, CSS, JS or a URL
//     other than `Evidence.url`. Do not add one.
//   - Every object is strict: an unknown key is an error, never silently dropped. A typo such as
//     `cite` for `cites` must be reported.
//   - Text that states facts lives in fields that carry citations. Text without citations is a
//     visibly labelled kind (analogy, example, framing) or structural (titles, labels).
//   - Strings are sanitised (see core/text) BEFORE they are parsed here, so lengths are measured on
//     what will actually be shown.
import { z } from 'zod';
import { LIMITS as L } from './limits';

export const FORMAT = 'learning-tool/lesson@1' as const;

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

/** Ids chosen by the agent: scene ids and figure part ids. Safe as DOM ids and as map keys. */
export const ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
export const Id = z.string().regex(ID_PATTERN, {
  error: 'Use a short lowercase id such as "s1" or "syn-ack": a-z, 0-9, "-" or "_", starting with a letter, at most 32 characters.',
});

/** Evidence ids are minted by the server: e1, e2, ... */
export const EvidenceId = z.string().regex(/^e[1-9][0-9]{0,2}$/, { error: 'Evidence ids look like "e1". Use an id returned by save_evidence.' });
/** Objective ids are o1..o9, chosen by the agent in plan_lesson. */
export const ObjectiveId = z.string().regex(/^o[1-9]$/, { error: 'Objective ids look like "o1".' });
/** Lesson ids are minted by the server. Anything else is rejected before the disk is touched. */
export const LESSON_ID_PATTERN = /^[a-z0-9]{12}$/;
export const LessonId = z.string().regex(LESSON_ID_PATTERN, { error: 'Use the lessonId returned by start_lesson.' });

const text = (max: number, min = 1) => z.string().min(min).max(max);

export const DepthSchema = z.enum(['quick', 'standard', 'deep']);
/** BCP 47 language tag, kept deliberately loose: "en", "pt-BR", "zh-Hans". */
export const Language = z.string().regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,3}$/, { error: 'Use a BCP 47 language tag such as "en" or "pt-BR".' });

const Cites = z.array(EvidenceId).min(1).max(L.citesPerBlock);
/** The passages a figure's content, and every number in it, comes from. */
const FigureCites = z.array(EvidenceId).min(1).max(L.citesPerFigure);

// ---------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------

/** How the agent obtained the excerpt. Shown to the learner beside the excerpt. */
export const EvidenceVia = z.enum(['page', 'search_snippet', 'learner']);

/** What the agent sends to save_evidence. */
export const EvidenceInput = z.strictObject({
  /** http(s) URL of the source. Further restrictions (no credentials, no local hosts) are applied by the validator. */
  url: z.string().min(8).max(L.urlChars),
  title: text(L.evidenceTitleChars),
  publisher: text(L.publisherChars).optional(),
  /** Verbatim text from the source. Immutable once stored. */
  excerpt: z.string().min(L.excerptChars.min).max(L.excerptChars.max),
  via: EvidenceVia,
  /** Language of the excerpt when it differs from the lesson language. */
  lang: Language.optional(),
});

export const Evidence = EvidenceInput.extend({
  id: EvidenceId,
  /** ASCII (punycode) hostname computed by the server from `url`. This, not `publisher`, is what the learner is shown first. */
  host: z.string().min(1).max(255),
  /** ISO date (YYYY-MM-DD) the excerpt was stored. */
  savedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// ---------------------------------------------------------------------------------------------
// Blocks: the units of prose
// ---------------------------------------------------------------------------------------------

/** A factual statement. Every claim cites the excerpt(s) that support it. */
export const ClaimBlock = z.strictObject({ type: z.literal('claim'), text: text(L.claimChars), cites: Cites });
/** Words taken from a source. The validator matches `text` against the excerpt and stores the excerpt's own characters. */
export const QuoteBlock = z.strictObject({ type: z.literal('quote'), text: text(L.quoteChars), cite: EvidenceId });
/** A comparison written by the agent. Shown labelled as an analogy, with where it breaks down. */
export const AnalogyBlock = z.strictObject({
  type: z.literal('analogy'),
  text: text(L.analogyChars),
  limits: text(L.analogyLimitsChars.max, L.analogyLimitsChars.min),
});
/** A worked example written by the agent: a calculation, a concrete case, applied numbers. Shown labelled as such. */
export const ExampleBlock = z.strictObject({
  type: z.literal('example'),
  text: text(L.exampleChars),
  /** The evidence whose rule or figures the example applies, when there is one. */
  basedOn: z.array(EvidenceId).max(L.citesPerBlock).optional(),
});
/** Short connective text: a transition, a question to the learner, an instruction. Never a fact. */
export const FramingBlock = z.strictObject({ type: z.literal('framing'), text: text(L.framingChars) });

export const Block = z.discriminatedUnion('type', [ClaimBlock, QuoteBlock, AnalogyBlock, ExampleBlock, FramingBlock]);
export const BLOCK_TYPES = ['claim', 'quote', 'analogy', 'example', 'framing'] as const;

// ---------------------------------------------------------------------------------------------
// Figures: typed data, drawn by the renderer. Every part has an id a step can highlight.
// ---------------------------------------------------------------------------------------------

const figureCommon = {
  /** Text alternative: what the figure shows and the point it makes, for someone who cannot see it. */
  description: text(L.figureDescriptionChars.max, L.figureDescriptionChars.min),
  caption: text(L.captionChars).optional(),
};
const part = { id: Id, label: text(L.labelChars) };
const detail = text(L.detailChars).optional();

/** Boxes and arrows: processes, state machines, cause and effect. `layout: "ring"` draws a cycle. */
export const FlowFigure = z.strictObject({
  type: z.literal('flow'),
  layout: z.enum(['right', 'down', 'ring']).default('right'),
  nodes: z.array(z.strictObject({ ...part, detail })).min(L.flow.nodes.min).max(L.flow.nodes.max),
  edges: z
    .array(z.strictObject({ id: Id, from: Id, to: Id, label: text(L.flow.edgeLabelChars).optional(), dashed: z.boolean().optional() }))
    .min(L.flow.edges.min)
    .max(L.flow.edges.max),
  cites: FigureCites,
  ...figureCommon,
});

/** Who sends what to whom, in order: protocols, conversations, hand-offs. */
export const SequenceFigure = z.strictObject({
  type: z.literal('sequence'),
  actors: z.array(z.strictObject({ id: Id, label: text(L.sequence.actorChars) })).min(L.sequence.actors.min).max(L.sequence.actors.max),
  messages: z
    .array(z.strictObject({ id: Id, from: Id, to: Id, label: text(L.sequence.messageChars), status: z.enum(['ok', 'lost']).optional() }))
    .min(L.sequence.messages.min)
    .max(L.sequence.messages.max),
  cites: FigureCites,
  ...figureCommon,
});

/** A stack, top first: protocol layers, levels of abstraction, strata. */
export const LayersFigure = z.strictObject({
  type: z.literal('layers'),
  layers: z.array(z.strictObject({ ...part, detail })).min(L.layers.min).max(L.layers.max),
  cites: FigureCites,
  ...figureCommon,
});

/** Ordered moments. `when` is free text: "1914", "+4 h", "overnight", "step 2". */
export const TimelineFigure = z.strictObject({
  type: z.literal('timeline'),
  events: z
    .array(z.strictObject({ id: Id, when: text(L.timeline.whenChars), label: text(L.timeline.labelChars), detail: text(L.timeline.detailChars).optional() }))
    .min(L.timeline.events.min)
    .max(L.timeline.events.max),
  cites: FigureCites,
  ...figureCommon,
});

/** A comparison table. Each row has one cell per column, in column order. Cells take inline markup. */
export const CompareFigure = z.strictObject({
  type: z.literal('compare'),
  /** Heading of the first column, the one that holds the row labels. */
  rowHeading: text(L.compare.columnChars).optional(),
  columns: z.array(z.strictObject({ id: Id, label: text(L.compare.columnChars) })).min(L.compare.columns.min).max(L.compare.columns.max),
  rows: z
    .array(z.strictObject({ ...part, cells: z.array(text(L.compare.cellChars)).min(L.compare.columns.min).max(L.compare.columns.max) }))
    .min(L.compare.rows.min)
    .max(L.compare.rows.max),
  cites: FigureCites,
  ...figureCommon,
});

/**
 * Numbers drawn as bars, a line or a stepped line. Each series has one value per x position.
 * `data: "sourced"` means every value appears in a cited excerpt (checked). `data: "illustrative"`
 * means the shape is the point, not the numbers, and the figure is labelled that way.
 */
export const ChartFigure = z.strictObject({
  type: z.literal('chart'),
  mark: z.enum(['bar', 'line', 'step']),
  data: z.enum(['sourced', 'illustrative']),
  xLabel: text(L.chart.axisChars),
  yLabel: text(L.chart.axisChars),
  unit: text(L.chart.unitChars).optional(),
  xs: z.array(z.strictObject({ id: Id, label: text(L.chart.xChars) })).min(L.chart.xs.min).max(L.chart.xs.max),
  series: z
    .array(
      z.strictObject({
        id: Id,
        label: text(L.chart.seriesChars),
        values: z.array(z.number().finite().min(-L.chart.maxAbsValue).max(L.chart.maxAbsValue)).min(L.chart.xs.min).max(L.chart.xs.max),
      }),
    )
    .min(L.chart.series.min)
    .max(L.chart.series.max),
  cites: FigureCites,
  ...figureCommon,
});

/**
 * Lines to read or step through: code, a derivation, or plain text. Parts are addressed as l1, l2, ...
 * Written by the agent and labelled so; `cites` is optional. Whitespace in code lines is preserved.
 * In `format: "math"` each line is one expression in the supported LaTeX subset.
 */
export const LinesFigure = z.strictObject({
  type: z.literal('lines'),
  format: z.enum(['code', 'math', 'text']),
  /** Display name of the programming language, for `format: "code"`. */
  language: text(L.lines.languageChars).optional(),
  lines: z.array(z.string().max(L.lines.lineChars)).min(L.lines.min).max(L.lines.max),
  cites: z.array(EvidenceId).max(L.citesPerFigure).optional(),
  ...figureCommon,
});

export const Figure = z.discriminatedUnion('type', [FlowFigure, SequenceFigure, LayersFigure, TimelineFigure, CompareFigure, ChartFigure, LinesFigure]);
export const FIGURE_TYPES = ['flow', 'sequence', 'layers', 'timeline', 'compare', 'chart', 'lines'] as const;
export const FigureType = z.enum(FIGURE_TYPES);

// ---------------------------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------------------------

/** Why the right answer is right. Shown after an attempt, with its sources. */
export const Explanation = z.strictObject({ text: text(L.explanationChars), cites: Cites });

const option = {
  text: text(L.optionChars),
  correct: z.boolean(),
  /** Shown when the learner picks this option: why it is right or wrong, in a sentence. */
  feedback: text(L.feedbackChars.max, L.feedbackChars.min),
};

/** One correct answer among three or four. Options are shuffled by the player unless `fixedOrder`. */
export const SingleQuestion = z.strictObject({
  type: z.literal('single'),
  prompt: text(L.promptChars),
  options: z
    .array(
      z.strictObject({
        ...option,
        /** Required on every wrong option: the mistaken belief that would lead a learner to choose it. Not shown to the learner. */
        misconception: text(L.misconceptionChars.max, L.misconceptionChars.min).optional(),
      }),
    )
    .min(L.options.min)
    .max(L.options.max),
  explanation: Explanation,
  hint: text(L.hintChars).optional(),
  fixedOrder: z.boolean().optional(),
});

/** Put the items in order. `items` is given in the correct order; the player shuffles it. */
export const OrderQuestion = z.strictObject({
  type: z.literal('order'),
  prompt: text(L.promptChars),
  items: z.array(text(L.orderItemChars)).min(L.orderItems.min).max(L.orderItems.max),
  explanation: Explanation,
  hint: text(L.hintChars).optional(),
});

/** A computed answer, graded within `tolerance` (absolute). */
export const NumericQuestion = z.strictObject({
  type: z.literal('numeric'),
  prompt: text(L.promptChars),
  answer: z.number().finite(),
  tolerance: z.number().finite().min(0).default(0),
  unit: text(L.unitChars).optional(),
  explanation: Explanation,
  hint: text(L.hintChars).optional(),
});

/** The learner writes an answer, reveals a cited model answer, and checks their own against `lookFor`. Not graded. */
export const ReflectQuestion = z.strictObject({
  type: z.literal('reflect'),
  prompt: text(L.promptChars),
  modelAnswer: z.strictObject({ text: text(L.modelAnswerChars), cites: Cites }),
  lookFor: z.array(text(L.lookFor.chars)).min(L.lookFor.min).max(L.lookFor.max),
});

export const Question = z.discriminatedUnion('type', [SingleQuestion, OrderQuestion, NumericQuestion, ReflectQuestion]);
export const QUESTION_TYPES = ['single', 'order', 'numeric', 'reflect'] as const;
export const QuestionType = z.enum(QUESTION_TYPES);
/** Question types the player grades. An objective is best assessed by one of these. */
export const GRADED_QUESTION_TYPES: readonly string[] = ['single', 'order', 'numeric'];

/** Asked before a step is revealed, so the learner commits to a prediction. */
export const Predict = z.strictObject({
  prompt: text(L.promptChars),
  options: z.array(z.strictObject(option)).min(L.predictOptions.min).max(L.predictOptions.max),
});

// ---------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------

const sceneCommon = { id: Id, title: text(L.sceneTitleChars) };

/** Prose, optionally beside a figure it explains. */
export const NarrationScene = z.strictObject({
  ...sceneCommon,
  kind: z.literal('narration'),
  blocks: z.array(Block).min(1).max(L.blocksPerNarration),
  figure: Figure.optional(),
});

export const Step = z.strictObject({
  title: text(L.stepTitleChars).optional(),
  /** Ids of the figure parts this step is about. Only what the step's text names. */
  highlight: z.array(Id).max(L.highlightsPerStep).default([]),
  blocks: z.array(Block).min(1).max(L.blocksPerStep),
  /** Values that change as the steps advance, shown in a small panel: a counter, a variable, a temperature. */
  state: z.array(z.strictObject({ label: text(L.stateLabelChars), value: text(L.stateValueChars) })).max(L.stateRows).optional(),
  predict: Predict.optional(),
});

/** One figure, revealed and explained a step at a time. */
export const StepThroughScene = z.strictObject({
  ...sceneCommon,
  kind: z.literal('step_through'),
  /** One line of framing shown before the first step. */
  intro: text(L.introChars).optional(),
  figure: Figure,
  steps: z.array(Step).min(L.steps.min).max(L.steps.max),
});

export const CheckpointLevel = z.enum(['recall', 'apply']);

/** A question that assesses one objective. */
export const CheckpointScene = z.strictObject({
  ...sceneCommon,
  kind: z.literal('checkpoint'),
  objective: ObjectiveId,
  /** `recall`: retrieve something taught. `apply`: use it on a case the lesson did not show. */
  level: CheckpointLevel,
  question: Question,
});

/** The last scene: one cited takeaway per objective, what to try, and where to go next. */
export const RecapScene = z.strictObject({
  ...sceneCommon,
  kind: z.literal('recap'),
  takeaways: z.array(z.strictObject({ objective: ObjectiveId, text: text(L.takeawayChars), cites: Cites })).min(1).max(9),
  /** An optional thing to do away from the screen, with observable signs of success. */
  practice: z
    .strictObject({ task: text(L.practice.taskChars), lookFor: z.array(text(L.practice.lookFor.chars)).min(L.practice.lookFor.min).max(L.practice.lookFor.max) })
    .optional(),
  /** Follow-up lessons, each shown as a ready-to-send request for the learner's agent. */
  next: z.array(z.strictObject({ topic: text(L.nextTopics.topicChars), why: text(L.nextTopics.whyChars) })).min(L.nextTopics.min).max(L.nextTopics.max),
});

export const Scene = z.discriminatedUnion('kind', [NarrationScene, StepThroughScene, CheckpointScene, RecapScene]);
export const SCENE_KINDS = ['narration', 'step_through', 'checkpoint', 'recap'] as const;
export const SceneKind = z.enum(SCENE_KINDS);

// ---------------------------------------------------------------------------------------------
// Lesson header, plan, and the assembled lesson
// ---------------------------------------------------------------------------------------------

export const LearnerLevel = z.enum(['new', 'some', 'solid']);

/** What calibration found. Stays in the draft; only `level` is published. */
export const Learner = z.strictObject({
  level: LearnerLevel,
  /** What the learner already knows about the topic, in the agent's words. */
  knows: text(L.learnerKnowsChars, 3),
  /** What the learner wants to be able to do. */
  goal: text(L.learnerGoalChars, 3),
  /** The questions asked and the answers given. Empty if the learner said to just start. */
  calibration: z.array(z.strictObject({ question: text(L.calibration.questionChars), answer: text(L.calibration.answerChars) })).max(L.calibration.max).default([]),
});

export const StartInput = z.strictObject({
  topic: text(L.topicChars, 2),
  language: Language.default('en'),
  depth: DepthSchema.default('standard'),
  learner: Learner,
});

export const Objective = z.strictObject({
  id: ObjectiveId,
  /** Completes "After this lesson you can ...", starting with a verb the learner could be seen doing. */
  text: text(L.objectiveChars.max, L.objectiveChars.min),
});

/**
 * The kinds a plan may name: the four above and `clip`, the v2 teaching scene (core/clip), whose
 * shape lives beside this file because it is built from this file's blocks and predict. A lesson
 * that may hold clips is `LessonV2` there. `narration` and `step_through` are legacy kinds.
 */
export const PLAN_SCENE_KINDS = [...SCENE_KINDS, 'clip'] as const;
export const PlanSceneKind = z.enum(PLAN_SCENE_KINDS);
/** The stage kinds of a clip, as the plan names them. The same list as `STAGE_KINDS` in core/clip (a test holds the two equal). */
export const PLAN_STAGE_KINDS = ['sequence', 'cells', 'dots', 'chart', 'flow', 'words', 'lines', 'timeline', 'frame'] as const;
export const PlanStageKind = z.enum(PLAN_STAGE_KINDS);
/** The marks of a `chart` stage, as the plan names them. The same list as the options of `ChartStage` in core/clip (a test holds the two equal). */
export const PLAN_CHART_MARKS = ['bars', 'line', 'curve'] as const;
export const PlanChartMark = z.enum(PLAN_CHART_MARKS);

/** One planned scene. The plan fixes order, kinds and shapes before any scene is written. */
export const OutlineEntry = z.strictObject({
  id: Id,
  kind: PlanSceneKind,
  /** What this scene is for, in a phrase. */
  purpose: text(L.purposeChars),
  /** The figure type: required for step_through, optional for narration. */
  figure: FigureType.optional(),
  /** The question type: required for checkpoint. */
  question: QuestionType.optional(),
  /** The objective a checkpoint assesses: required for checkpoint. */
  objective: ObjectiveId.optional(),
  /** The stage kind: required for clip, and for nothing else. */
  stage: PlanStageKind.optional(),
  /**
   * For a clip on a `chart` stage, which chart: it chooses the template plan_lesson returns
   * ("bars" when left out). It is a help to the writer and not a promise: the clip that is
   * submitted may use another mark.
   */
  mark: PlanChartMark.optional(),
});

export const PlanInput = z.strictObject({
  title: text(L.titleChars, 3),
  objectives: z.array(Objective).min(1).max(9),
  outline: z.array(OutlineEntry).min(1).max(32),
});

/**
 * A complete lesson: what is validated, hashed, rendered and embedded in the published file.
 * It deliberately leaves out the learner's free-text profile and anything about the machine.
 */
export const Lesson = z.strictObject({
  format: z.literal(FORMAT),
  id: LessonId,
  title: text(L.titleChars, 3),
  topic: text(L.topicChars, 2),
  language: Language,
  depth: DepthSchema,
  level: LearnerLevel,
  objectives: z.array(Objective).min(1).max(9),
  /** Only the evidence the lesson cites, in id order. */
  evidence: z.array(Evidence).min(1).max(L.evidencePerLesson),
  scenes: z.array(Scene).min(1).max(32),
});

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type Depth = z.infer<typeof DepthSchema>;
export type EvidenceInput = z.infer<typeof EvidenceInput>;
export type Evidence = z.infer<typeof Evidence>;
export type ClaimBlock = z.infer<typeof ClaimBlock>;
export type QuoteBlock = z.infer<typeof QuoteBlock>;
export type AnalogyBlock = z.infer<typeof AnalogyBlock>;
export type ExampleBlock = z.infer<typeof ExampleBlock>;
export type FramingBlock = z.infer<typeof FramingBlock>;
export type Block = z.infer<typeof Block>;
export type FlowFigure = z.infer<typeof FlowFigure>;
export type SequenceFigure = z.infer<typeof SequenceFigure>;
export type LayersFigure = z.infer<typeof LayersFigure>;
export type TimelineFigure = z.infer<typeof TimelineFigure>;
export type CompareFigure = z.infer<typeof CompareFigure>;
export type ChartFigure = z.infer<typeof ChartFigure>;
export type LinesFigure = z.infer<typeof LinesFigure>;
export type Figure = z.infer<typeof Figure>;
export type FigureType = z.infer<typeof FigureType>;
export type Explanation = z.infer<typeof Explanation>;
export type SingleQuestion = z.infer<typeof SingleQuestion>;
export type OrderQuestion = z.infer<typeof OrderQuestion>;
export type NumericQuestion = z.infer<typeof NumericQuestion>;
export type ReflectQuestion = z.infer<typeof ReflectQuestion>;
export type Question = z.infer<typeof Question>;
export type QuestionType = z.infer<typeof QuestionType>;
export type Predict = z.infer<typeof Predict>;
export type Step = z.infer<typeof Step>;
export type NarrationScene = z.infer<typeof NarrationScene>;
export type StepThroughScene = z.infer<typeof StepThroughScene>;
export type CheckpointScene = z.infer<typeof CheckpointScene>;
export type RecapScene = z.infer<typeof RecapScene>;
export type Scene = z.infer<typeof Scene>;
export type SceneKind = z.infer<typeof SceneKind>;
export type Learner = z.infer<typeof Learner>;
export type LearnerLevel = z.infer<typeof LearnerLevel>;
export type StartInput = z.infer<typeof StartInput>;
export type Objective = z.infer<typeof Objective>;
export type PlanSceneKind = z.infer<typeof PlanSceneKind>;
export type PlanStageKind = z.infer<typeof PlanStageKind>;
export type PlanChartMark = z.infer<typeof PlanChartMark>;
export type OutlineEntry = z.infer<typeof OutlineEntry>;
export type PlanInput = z.infer<typeof PlanInput>;
export type Lesson = z.infer<typeof Lesson>;
