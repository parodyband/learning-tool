// The custom frame: the one stage kind whose picture is drawn by code the agent wrote.
//
// A frame is the escape hatch for what the typed stages cannot show. Its `code` is the body of a
// function that declares `function render(ctx, t)`: a pure function of time that draws one frame
// with a 2D canvas context and the helper library `S` (documented for authors in
// plugin/skills/learning-tool/references/frame-api.md). The code never runs in the lesson page: the
// player runs it in a Web Worker made from a data: URL and accepts back one bitmap per request (see
// src/player/frame/). It is checked before publishing by src/frame/check.ts, which never runs it.
//
// This file is the shape only. Rules that compare two fields (the poster lies inside the duration,
// a slider's value lies inside its range, ids are unique) are reported with codes by
// src/frame/check.ts, in the same way the lesson validator reports cross-field rules.
//
// Like every stage schema it takes `cites` and `provenance` from ./clip-base and never imports
// ./clip (which imports this file). It is also read by the player's type check, so it uses no Node
// types; the player itself imports only types from here, never values, so zod stays out of the page.
import { z } from 'zod';
import { stageCommon } from './clip-base';

export const FRAME_LIMITS = {
  /** The code as UTF-8. The three samples in ./frame-examples are 2 to 4 KB. */
  codeBytes: 24 * 1024,
  /** No line longer than this: code is written to be read, never minified. */
  lineChars: 400,
  /** Seconds. Long enough to show one idea, short enough to watch twice. */
  duration: { min: 2, max: 120 },
  /** Sliders the learner can move. More than three is an app, not an animation. */
  params: 3,
  paramLabelChars: 40,
  paramUnitChars: 8,
  /** Steps between a slider's min and max, so a keyboard user can cross it. */
  paramSteps: 1000,
  paramAbsValue: 1e9,
} as const;

/**
 * The shape of the stage where there is room for it. In a column narrower than
 * FRAME_NARROW_BELOW CSS pixels every frame is drawn on the tall stage instead, so code must lay
 * itself out from `S.W`, `S.H` and `S.tall` and never from fixed coordinates.
 */
export const FRAME_ASPECTS = ['16:9', '4:3', '1:1'] as const;
/** Stage size in stage units (what `S.W` and `S.H` hold) for each aspect, and for the tall stage. */
export const FRAME_STAGE_UNITS = {
  '16:9': { w: 960, h: 540 },
  '4:3': { w: 720, h: 540 },
  '1:1': { w: 540, h: 540 },
  tall: { w: 540, h: 675 },
} as const;
/** Below this many CSS pixels of column width the stage is the tall one (4:5). */
export const FRAME_NARROW_BELOW = 640;

/**
 * A slider id is read by the code as `S.params.<id>`, so it is a plain identifier: a lowercase
 * letter, then letters and digits. Names every object already has ("constructor") are refused.
 */
export const FRAME_PARAM_ID_PATTERN = /^[a-z][a-zA-Z0-9]{0,23}$/;
const ParamId = z
  .string()
  .regex(FRAME_PARAM_ID_PATTERN, { error: 'Use a short identifier such as "angle" or "rate2": a lowercase letter, then letters and digits, at most 24 characters.' })
  .refine((id) => !(id in Object.prototype), { error: 'This name is taken by JavaScript itself. Choose another, such as "angle".' });

const bounded = z.number().finite().min(-FRAME_LIMITS.paramAbsValue).max(FRAME_LIMITS.paramAbsValue);

/** One slider under the stage. The player draws it; the code reads its value as `S.params.<id>`. */
export const FrameParam = z.strictObject({
  id: ParamId,
  /** What the slider sets, in the learner's words: "Launch angle". */
  label: z.string().min(1).max(FRAME_LIMITS.paramLabelChars),
  min: bounded,
  max: bounded,
  step: z.number().finite().positive().max(FRAME_LIMITS.paramAbsValue),
  /** Where the slider starts, and the value the poster still is drawn with. */
  value: bounded,
  /** Shown after the value: "°", " m/s", "%". */
  unit: z.string().min(1).max(FRAME_LIMITS.paramUnitChars).optional(),
});

/** Seconds into the animation. A beat on a frame clip carries one of these as `at`. */
export const FrameTime = z.number().finite().min(0).max(FRAME_LIMITS.duration.max);

/**
 * The frame stage. The clip that holds it supplies the title, the `description` (the text
 * alternative, always on the page) and the beats; a beat on a frame clip is a caption and `at`
 * (seconds into the animation) and has no actions.
 */
export const FrameStage = z.strictObject({
  kind: z.literal('frame'),
  /**
   * The body of a function: set-up at the top, then `function render(ctx, t) { ... }`. Not a
   * module, not a script, not HTML. It must pass src/frame/check.ts exactly as it is stored.
   */
  code: z.string().min(1).max(FRAME_LIMITS.codeBytes),
  /** Length of the animation in seconds. `render` is asked for times from 0 to this. */
  duration: z.number().finite().min(FRAME_LIMITS.duration.min).max(FRAME_LIMITS.duration.max),
  aspect: z.enum(FRAME_ASPECTS).default('16:9'),
  /** Up to three sliders. Moving one redraws the current instant; it never restarts the clock. */
  params: z.array(FrameParam).max(FRAME_LIMITS.params).default([]),
  /**
   * The time of the still that stands for the animation: shown before Play is pressed, under
   * reduced motion and on paper. Choose the instant that shows the idea, which is rarely 0.
   */
  poster: FrameTime,
  /**
   * `cites`: the passages the animation's content comes from, up to six; required when
   * `provenance` is "sourced" or "worked". `provenance`: "sourced", "worked" (a worked example by
   * the agent, applying a rule from a cited passage) or
   * "illustrative" (the shape is the point, not the numbers). Whatever is chosen, the stage also
   * says that the animation is custom and unchecked, because nothing can check what code draws.
   */
  ...stageCommon,
});

export type FrameAspect = (typeof FRAME_ASPECTS)[number];
export type FrameParam = z.infer<typeof FrameParam>;
export type FrameStage = z.infer<typeof FrameStage>;
/** What an author writes: `aspect` and `params` may be left out. */
export type FrameStageInput = z.input<typeof FrameStage>;

/** Stage units for a frame, given whether the column it sits in is narrow. */
export function frameStageUnits(aspect: FrameAspect, narrow: boolean): { w: number; h: number } {
  return narrow ? FRAME_STAGE_UNITS.tall : FRAME_STAGE_UNITS[aspect];
}
