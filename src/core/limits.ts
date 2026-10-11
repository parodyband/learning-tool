// Every numeric limit in one place. The schema, the validator, the tool responses and the skill
// reference all read from here, so a limit is never stated twice.
//
// Where a number comes from evidence it says so; the rest are design heuristics (see the pedagogy
// notes in the skill's scene-design reference).

export type Depth = 'quick' | 'standard' | 'deep';

export interface DepthProfile {
  /** Target learner time in minutes. Shown to the agent, not enforced directly. */
  minutes: number;
  scenes: { min: number; max: number };
  objectives: { min: number; max: number };
  /** Minimum number of stored evidence items that the lesson actually cites. */
  evidenceMin: number;
  /** Lesson prose words: a warning above `warn`, an error above `max`. Derived from ~238 wpm silent reading at about 60% of lesson time. */
  words: { warn: number; max: number };
  /** Standard and deep lessons must contain at least one figure and one apply-level checkpoint. */
  requireFigure: boolean;
  requireApply: boolean;
}

export const DEPTHS: Record<Depth, DepthProfile> = {
  quick: { minutes: 5, scenes: { min: 4, max: 6 }, objectives: { min: 1, max: 2 }, evidenceMin: 3, words: { warn: 700, max: 900 }, requireFigure: false, requireApply: false },
  standard: { minutes: 10, scenes: { min: 6, max: 10 }, objectives: { min: 2, max: 4 }, evidenceMin: 4, words: { warn: 1500, max: 1900 }, requireFigure: true, requireApply: true },
  deep: { minutes: 20, scenes: { min: 10, max: 16 }, objectives: { min: 3, max: 5 }, evidenceMin: 6, words: { warn: 2850, max: 3500 }, requireFigure: true, requireApply: true },
};

export const LIMITS = {
  // ----- header
  topicChars: 120,
  titleChars: 80,
  sceneTitleChars: 60,
  objectiveChars: { min: 10, max: 160 },
  purposeChars: 160,
  learnerKnowsChars: 400,
  learnerGoalChars: 300,
  /** A task-style probe with its stated default runs long; 200 rejected honest questions in trials. */
  calibration: { max: 4, questionChars: 400, answerChars: 400 },

  // ----- evidence
  evidencePerLesson: 40,
  excerptChars: { min: 40, max: 800 },
  /** Total stored excerpt characters from one URL, so a lesson cannot reproduce a source. */
  excerptCharsPerUrl: 2000,
  urlChars: 1000,
  urlQueryChars: 200,
  evidenceTitleChars: 200,
  publisherChars: 80,
  /** How many clips (a clip is one item, captions and stage together), explanations and takeaways one excerpt may support; in a lesson of the older kinds, also blocks and figures. */
  usesPerEvidence: 6,
  citesPerBlock: 3,
  /** A figure may draw on more passages than a sentence does, and its numbers must come from the passages it cites. */
  citesPerFigure: 6,

  // ----- blocks
  claimChars: 360,
  /** About two sentences. One citation should not have to carry a paragraph. */
  claimWords: 45,
  quoteChars: 320,
  quoteMinWords: 4,
  analogyChars: 320,
  analogyLimitsChars: { min: 10, max: 200 },
  exampleChars: 480,
  framingChars: 160,
  blocksPerNarration: 6,
  blocksPerStep: 3,

  // ----- scene word budgets (words are counted with Intl.Segmenter, so they hold for any language)
  narrationWords: { warn: 90, max: 150 },
  /** A narration scene that carries a figure gets less text, so the figure does the work. */
  narrationWithFigureWords: { warn: 60, max: 120 },
  stepWords: { warn: 45, max: 70 },
  introChars: 160,

  // ----- structure
  /** At most this many narration scenes in a row. */
  narrationRun: 2,
  /** At most this many scenes in a row with no checkpoint and no predict step. */
  passiveRun: 3,
  /** Share of lesson prose that may be framing plus analogy text, with an absolute floor in words. */
  uncitedShare: { share: 0.3, floorWords: 80 },
  /** Share of lesson prose that may be worked examples, with an absolute floor in words. */
  exampleShare: { share: 0.35, floorWords: 120 },
  /** Above this share of claims with a weak textual match to their excerpts, the warning becomes an error. */
  weakClaimShare: 0.25,
  /** A claim this close to its excerpt (token containment, both directions) must be a quote block instead. */
  copyContainment: 0.85,

  // ----- figures
  figureDescriptionChars: { min: 30, max: 400 },
  captionChars: 120,
  labelChars: 40,
  detailChars: 100,
  flow: { nodes: { min: 2, max: 12 }, edges: { min: 1, max: 16 }, edgeLabelChars: 30 },
  sequence: { actors: { min: 2, max: 5 }, messages: { min: 1, max: 12 }, actorChars: 24, messageChars: 60 },
  layers: { min: 2, max: 8 },
  timeline: { events: { min: 2, max: 10 }, whenChars: 24, labelChars: 60, detailChars: 120 },
  compare: { columns: { min: 2, max: 4 }, rows: { min: 1, max: 8 }, cellChars: 100, columnChars: 30 },
  chart: { xs: { min: 2, max: 16 }, series: { min: 1, max: 3 }, axisChars: 40, unitChars: 12, xChars: 16, seriesChars: 30, maxAbsValue: 1e12 },
  lines: { min: 1, max: 24, lineChars: 100, languageChars: 20 },

  // ----- step-through
  steps: { min: 2, max: 9 },
  highlightsPerStep: 4,
  stepTitleChars: 50,
  stateRows: 6,
  stateLabelChars: 24,
  stateValueChars: 32,

  // ----- clips (the v2 teaching scene; the shape limits of stages and actions are CLIP_LIMITS in clip-base)
  /** Words in one beat's caption: a caption is one short line read while the picture moves. A warning above `warn`, an error above `max`. */
  captionWords: { warn: 16, max: 22 },
  /** At least this share of a clip's beats must change the picture: a clip whose captions change over a still stage is a slide. */
  beatsThatMove: 2 / 3,
  /** Custom frames (stage kind "frame") in one lesson. Nothing can check what code draws, so a lesson leans on typed stages. */
  framesPerLesson: 2,
  /** Above this share of illustrative stages among the clips that show data, the lesson is warned about. */
  illustrativeShare: 0.5,
  /** At least this share of a lesson's clips must contain a learner action: a gate (options or a tap) or an explore. */
  interactiveShare: 2 / 3,
  /**
   * Explore (the sliders after a clip's last beat), and how the validator samples it.
   *   steps             the most positions one slider may have between its ends.
   *   settingsPerControl  every position is tried when a slider has at most this many steps; a longer
   *                     slider is tried at this many evenly spaced positions, both ends included.
   *   settings          with two sliders, the grid of settings tried is at most this large.
   *   curveSamples      a curve is evaluated at this many evenly spaced x, both ends of the axis included.
   */
  explore: { steps: 1000, settingsPerControl: 50, settings: 400, curveSamples: 40 },

  // ----- checkpoints
  promptChars: 240,
  /** Three options is the evidence-backed target for multiple choice; four is allowed. */
  options: { min: 3, max: 4 },
  predictOptions: { min: 2, max: 4 },
  optionChars: 120,
  feedbackChars: { min: 15, max: 200 },
  misconceptionChars: { min: 8, max: 120 },
  explanationChars: 400,
  hintChars: 160,
  orderItems: { min: 3, max: 6 },
  orderItemChars: 100,
  unitChars: 16,
  modelAnswerChars: 500,
  lookFor: { min: 2, max: 4, chars: 120 },
  /** The correct option being much longer than the distractors is the most common giveaway. */
  correctLengthRatio: { warn: 1.25, warnMinCharDiff: 5, error: 1.6, minCharDiff: 20 },

  // ----- recap
  takeawayChars: 240,
  nextTopics: { min: 1, max: 3, topicChars: 80, whyChars: 160 },
  practice: { taskChars: 300, lookFor: { min: 1, max: 4, chars: 120 } },

  // ----- whole lesson
  /** Size of the canonical lesson JSON. Keeps validation in milliseconds and the file small. */
  lessonJsonBytes: 300_000,
} as const;

/** The published contract version of the rule set. Bump when a rule changes what passes. */
export const RULES_VERSION = '3';
