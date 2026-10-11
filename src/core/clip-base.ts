// Shared pieces of the v2 clip format: the things every stage schema needs.
//
// This file exists so that the stage schemas written beside `clip.ts` (`clip-kits-extra.ts` for the
// `lines` and `timeline` stages, `frame.ts` for the `frame` stage) can take these pieces WITHOUT
// importing `clip.ts`. `clip.ts` imports those files to build the stage union, so a value import in
// the other direction would be an import cycle. Rule: stage schema files import from here and from
// `schema.ts`, never from `clip.ts` (a type-only import from `clip.ts` is fine).
import { z } from 'zod';
import { EvidenceId, Id } from './schema';
import { LIMITS as L } from './limits';

/** Every numeric limit of the clip format, in one place, as `limits.ts` does for v1. */
export const CLIP_LIMITS = {
  /** Beats in one clip. */
  beats: { min: 2, max: 8 },
  /** Actions in one beat. */
  actionsPerBeat: 4,
  /**
   * A caption is one short line: about this many words at most. What the validator enforces is
   * `LIMITS.captionWords` in ./limits (a warning above 16 words, an error above 22).
   */
  captionWords: 20,
  /** Passages a stage's content comes from. */
  citesPerStage: 6,
  /** Read-outs ("values that change") on one stage. */
  stats: 3,
  statLabelChars: 24,
  statValueChars: 32,
  statUnitChars: 12,
  /** A string value given by `set` (a read-out or a label that morphs). */
  setValueChars: 32,
  setLabelChars: 40,
  /** The phrase of the caption an action waits for (`on`). */
  cueChars: 80,
  /** `draw ... upto`: an x label of a line chart, or an event id of a timeline. */
  uptoChars: 32,
  /** Ids one action may name in `targets`. */
  targetsPerAction: 12,
  sequence: { actors: { min: 2, max: 4 }, messages: { min: 1, max: 8 }, actorChars: 24, messageChars: 32 },
  cells: { cells: { min: 2, max: 12 }, cellChars: 8, pointers: 4, pointerChars: 10, brackets: 2, bracketChars: 24 },
  dots: { total: { min: 2, max: 1000 }, legendChars: 40, groupChars: 24, into: { min: 2, max: 4 }, merge: { min: 2, max: 4 } },
  chart: {
    bars: { min: 2, max: 8 },
    barChars: 16,
    xs: { min: 2, max: 16 },
    xChars: 10,
    series: { min: 1, max: 3 },
    seriesChars: 24,
    unitChars: 12,
    axisChars: 40,
    maxAbsValue: 1e12,
  },
  flow: { nodes: { min: 2, max: 6 }, nodeChars: 24, edges: { min: 1, max: 8 }, edgeChars: 16, tokenChars: 16 },
  words: { lines: { min: 1, max: 5 }, lineChars: 80 },
} as const;

const C = CLIP_LIMITS;

/** A non-empty string of at most `max` characters. */
export const clipText = (max: number, min = 1) => z.string().min(min).max(max);

/**
 * The six tones. A tone is a meaning, never a colour: the engine owns the palette.
 * neutral: ordinary. accent: the thing being talked about. good / bad / warn: outcome. muted: set aside.
 */
export const TONES = ['neutral', 'accent', 'good', 'bad', 'warn', 'muted'] as const;
export const Tone = z.enum(TONES);

/**
 * Where a stage's content comes from, shown as a small badge on the stage.
 * sourced: every part and number is in the cited passages. worked: a worked example by the agent,
 * applying what the passages say. illustrative: the shape is the point, not the particulars.
 */
export const PROVENANCES = ['sourced', 'worked', 'illustrative'] as const;
export const Provenance = z.enum(PROVENANCES);

/** A read-out: a labelled value that changes as the clip plays (a counter, a variable, a verdict). */
export const StageStat = z.strictObject({
  id: Id,
  label: clipText(C.statLabelChars),
  /** A number counts to its next value; a string morphs. */
  value: z.union([z.number().finite().min(-C.chart.maxAbsValue).max(C.chart.maxAbsValue), clipText(C.statValueChars)]),
  unit: clipText(C.statUnitChars).optional(),
  /** Sequence stages only: the actor this read-out belongs to. It sits beside that actor when there is room. */
  at: Id.optional(),
});

/** Fields every stage carries. Spread into each stage's strict object. */
export const stageCommon = {
  /** The passages the stage's content comes from. Required (at least one) when `provenance` is "sourced" or "worked". */
  cites: z.array(EvidenceId).max(C.citesPerStage).default([]),
  provenance: Provenance,
};

/** `stats` as an optional field of a stage. */
export const stageStats = { stats: z.array(StageStat).max(C.stats).optional() };

/** Text alternative length, shared with v1 figures. */
export const CLIP_DESCRIPTION_CHARS = L.figureDescriptionChars;

export type Tone = z.infer<typeof Tone>;
export type Provenance = z.infer<typeof Provenance>;
export type StageStat = z.infer<typeof StageStat>;
