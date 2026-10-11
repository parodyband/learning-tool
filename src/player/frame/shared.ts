// Constants the page and the server must agree on. Plain values only: no DOM, no Node, no zod, so
// this file can be read by the player bundle, by src/frame/check.ts and by the tests alike.

/**
 * How the agent's code is wrapped. The worker's text ends with
 *
 *     __LT_BOOT(function(S){ FRAME_BODY_PREFIX + code + FRAME_BODY_SUFFIX });
 *
 * and src/frame/check.ts compiles exactly FRAME_BODY_PREFIX + code + FRAME_BODY_SUFFIX as the body
 * of a function of `S`, so code that tries to close the wrapper early is a syntax error there.
 * `render` is a function declaration at the top of the body; the suffix hands it to the runtime.
 */
export const FRAME_BODY_PREFIX = '"use strict";\n';
export const FRAME_BODY_SUFFIX = '\n;return typeof render==="function"?render:null;\n';

/**
 * Stage size in stage units for each aspect, and for the tall stage every frame switches to in a
 * narrow column. The same table as FRAME_STAGE_UNITS in src/core/frame.ts (which the player cannot
 * import without pulling the schema library into the page); test/frame/schema.test.ts holds the
 * two equal.
 */
export const STAGE_UNITS: Readonly<Record<string, { readonly w: number; readonly h: number }>> = {
  '16:9': { w: 960, h: 540 },
  '4:3': { w: 720, h: 540 },
  '1:1': { w: 540, h: 540 },
  tall: { w: 540, h: 675 },
};
/** Below this many CSS pixels of column width the stage is the tall one. Also written in css/frame.css. */
export const NARROW_BELOW = 640;

/** Stage units for an aspect, or for the tall stage when `tall`. */
export function stageUnits(aspect: string | undefined, tall: boolean): { readonly w: number; readonly h: number } {
  const wide = STAGE_UNITS[aspect ?? '16:9'] ?? { w: 960, h: 540 };
  return tall ? (STAGE_UNITS.tall ?? wide) : wide;
}

/**
 * The height in CSS pixels a frame's stage wants in a column `width` wide: the author's aspect,
 * or the tall stage under NARROW_BELOW. For a clip engine that sizes the stage element itself.
 */
export function frameStageHeight(aspect: string | undefined, width: number): number {
  const u = stageUnits(aspect, width < NARROW_BELOW);
  return Math.round((width * u.h) / u.w);
}

/** A beat's place in time, in milliseconds: the same fields as the clip engine's BeatTime. */
export interface FrameBeatTime {
  readonly i: number;
  readonly t0: number;
  readonly t1: number;
  readonly motionEnd: number;
  readonly gate: boolean;
}

/**
 * The timeline of a frame clip, in milliseconds. A frame clip is not compiled from actions: its
 * length is the animation's `duration` and beat i's caption is on from its `at` until the next
 * beat's. The motion never rests inside a beat, so `motionEnd` is the beat's end.
 */
export function frameBeatTimes(durationSeconds: number, beats: readonly { readonly at?: number | undefined; readonly gate?: unknown }[]): { beats: FrameBeatTime[]; duration: number } {
  const duration = Math.max(1, Math.round(durationSeconds * 1000));
  const starts = beats.map((b, i) => (i === 0 ? 0 : Math.min(duration, Math.max(0, Math.round((b.at ?? 0) * 1000)))));
  for (let i = 1; i < starts.length; i++) starts[i] = Math.max(starts[i] ?? 0, starts[i - 1] ?? 0);
  return {
    duration,
    beats: beats.map((b, i) => {
      const t0 = starts[i] ?? 0;
      const t1 = i + 1 < starts.length ? (starts[i + 1] ?? duration) : duration;
      return { i, t0, t1, motionEnd: t1, gate: b.gate !== undefined && b.gate !== null };
    }),
  };
}

/** The watchdog and the budgets the host enforces. Times are milliseconds. */
export const WATCHDOG = {
  /** From `new Worker` to the runtime's "ready". Covers code that never returns from its set-up. */
  bootMs: 3000,
  /** From a request to its bitmap. */
  frameMs: 1500,
  /** A worker nobody has asked for a frame in this long is ended; the canvas keeps its picture. */
  idleMs: 4000,
  /** Messages that are not the one answer asked for. More than this and the frame is turned off. */
  unsolicited: 20,
  /** Most device pixels per stage unit, and most pixels in one bitmap. */
  maxScale: 3,
  maxPixels: 2400 * 1500,
  /** A frame slower than this, three times running, is drawn with fewer pixels (down to half). */
  slowMs: 80,
  /** Workers that use up their allocation budget this fast, three times running, are greedy. */
  shortLifeMs: 600,
} as const;

/** The largest bitmap side the runtime will make and the host will accept. */
export const MAX_SIDE = 4096;

/** Bitmap size for a stage of w by h units at `scale` device pixels per unit. Host and worker both use this. */
export function bitmapSize(w: number, h: number, scale: number): { pw: number; ph: number } {
  return { pw: Math.max(1, Math.min(MAX_SIDE, Math.round(w * scale))), ph: Math.max(1, Math.min(MAX_SIDE, Math.round(h * scale))) };
}

/** The colour roles a frame is given as `S.theme`, and the page token each one is read from. */
export const THEME_TOKENS = {
  bg: '--lt-bg',
  surface: '--lt-surface',
  sunken: '--lt-sunken',
  fg: '--lt-ink',
  fg2: '--lt-ink-2',
  muted: '--lt-ink-3',
  line: '--lt-line',
  lineStrong: '--lt-line-strong',
  accent: '--lt-accent',
  accentInk: '--lt-accent-ink',
  accentSoft: '--lt-accent-soft',
  good: '--lt-good',
  goodSoft: '--lt-good-soft',
  bad: '--lt-bad',
  badSoft: '--lt-bad-soft',
  warn: '--lt-warn',
  warnSoft: '--lt-warn-soft',
  mark: '--lt-mark',
} as const;
export type ThemeRole = keyof typeof THEME_TOKENS;
/** What the worker receives: every role as "#rrggbb", and which scheme the page is in. */
export type FrameTheme = Record<ThemeRole, string> & { scheme: 'light' | 'dark' };

/** What the learner is told. One place, so the static page, the player and the tests agree. */
export const FRAME_TEXT = {
  label: 'This animation was written by your agent and is not checked by Learning Tool.',
  timeout: 'The animation stopped responding, so it was turned off. The rest of the lesson is not affected.',
  error: 'The animation has an error and was turned off. The description says what it shows.',
  badFrame: 'The animation sent something unexpected and was turned off.',
  flood: 'The animation misbehaved and was turned off.',
  greedy: 'The animation used too much memory and was turned off.',
  unsupported: 'This browser cannot show the animation. The description says what it shows.',
  blocked: 'This browser blocked the animation. The description says what it shows.',
  retry: 'Try again',
} as const;

/** Why a frame was turned off. */
export type FrameFailure = 'timeout:boot' | 'timeout:frame' | 'error' | 'bad-frame' | 'flood' | 'greedy' | 'unsupported' | 'blocked';

// ----- the protocol between host and worker ---------------------------------------------------

/** Host to worker: the only message. Draw the instant `t` at this size and answer with one bitmap. */
export interface FrameRequest {
  type: 'frame';
  id: number;
  /** Seconds. */
  t: number;
  dur: number;
  /** Stage units. */
  w: number;
  h: number;
  /** Device pixels per stage unit. */
  scale: number;
  theme: FrameTheme;
  params: Record<string, number>;
}
