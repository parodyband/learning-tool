// A clip as data in, a timeline out. `compile` builds the stage for a size and turns beats and
// actions into channel segments; afterwards `stage.apply(t)` draws any instant.
//
//   0 ............ open ........ beat 1 ........ beat 2 ...                          duration
//   | establishing |  caption 1, lead, motion, hold | caption 2, ...                 |
//
// The establishing move (whatever starts on stage arrives) comes before the first beat, so a clip
// has a poster frame: the stage as it stands at `open`, before anything has been said.
//
// Per beat:
//   lead      = voiced ? 150 ms : min(650 ms, 22% of the reading time)   the eye gets the caption first
//   actions   = each starts as the previous one ends (90 ms overlap), or with it (`with`), and never
//               before its cue (`on`: a phrase of the caption, placed by its share of the text)
//   beat ends = max(last settle + 500 ms, start + (voiced ? audio + 300 ms : reading time))
//   reading   = max(1.8 s, 0.5 s + 0.3 s per word)                       200 words a minute
//
// Nothing here touches layout or a clock, so it runs the same in Node (the determinism test, and a
// publisher that wants a clip's length) as in the page.
import { type Chan, type Ctx, type Ease, type SegFn, type TweenOptions, clamp } from './core';
import { type ExploreData, type ExploreState, Explorer } from './explore';
import { type ActionData, type StageData, type StageEnv, type StageKit, type TapTarget, makeStage } from './kit';

export const VERBS = ['show', 'hide', 'draw', 'send', 'focus', 'set', 'move', 'swap', 'split', 'merge', 'reorder', 'pulse'] as const;
const PACE: Record<string, number> = { brisk: 0.82, normal: 1, calm: 1.25 };

/** The fields of a clip scene the engine reads. Structurally a `ClipScene` from src/core/clip.ts. */
export interface ClipData {
  readonly id: string;
  readonly pace?: string | undefined;
  readonly stage: StageData;
  readonly beats: readonly BeatData[];
  /** After the last beat, the learner drives the picture (explore.ts). */
  readonly explore?: ExploreData | undefined;
}
export interface BeatData {
  readonly caption: { readonly type: string; readonly text: string; readonly limits?: string | undefined };
  readonly do?: readonly ActionData[] | undefined;
  readonly gate?: unknown;
  /** Frame clips: seconds into the animation. */
  readonly at?: number | undefined;
}

export interface BeatTime {
  /** 0-based. */
  readonly i: number;
  readonly t0: number;
  readonly t1: number;
  /** When the last thing this beat moves has settled. */
  readonly motionEnd: number;
  /** The clip stops before this beat until the learner has predicted. */
  readonly gate: boolean;
}

export interface Timeline {
  readonly beats: readonly BeatTime[];
  /** Total length in ms. */
  readonly duration: number;
  /** Draw the instant t (ms). `x`: with the learner's numbers in place of the clip's own (the end of the clip only). */
  apply(t: number, x?: ExploreState): void;
  /** The parts a tap gate may offer at t. */
  taps?(t: number): TapTarget[];
  /** Whether something drawn for the learner's numbers is still on its way. */
  busy?(): boolean;
  /** A custom frame only: show the still its author chose to stand for it, or its last instant. */
  still?: ((which: 'poster' | 'end') => void) | undefined;
  destroy?(): void;
}

export interface Compiled extends Timeline {
  readonly stage: StageKit;
}

/** The words of a caption as they are read: the text, plus an analogy's limits. */
export function captionText(caption: BeatData['caption']): string {
  return caption.type === 'analogy' && caption.limits ? `${caption.text} ${caption.limits}` : caption.text;
}

/** Time to read a caption once without hurrying: 200 words a minute plus half a second, never under 1.8 s. */
export function readingMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1800, 500 + words * 300);
}

/** When a phrase of the caption is reached, as a share of the time the caption takes (spoken or read). */
function cueMs(caption: string, phrase: string, span: number): number {
  const i = caption.toLowerCase().indexOf(phrase.toLowerCase());
  if (i < 0) throw new Error(`The cue "${phrase}" does not occur in the caption "${caption}".`);
  return (i / Math.max(1, caption.length)) * span;
}

/**
 * The stage is wide and low on a wide screen, and taller than wide on a narrow one. `room` is the
 * most height the window can give it while the caption and the controls stay in view.
 */
export function stageHeight(W: number, room?: number): number {
  if (W < 520) return Math.round(clamp(W * 1.16, 340, 560));
  const ideal = clamp(W * 0.46, 320, 540);
  return Math.round(room === undefined ? ideal : clamp(Math.min(ideal, room), 320, 540));
}

function targetsOf(a: ActionData): string[] {
  if (Array.isArray(a.targets)) return a.targets as string[];
  return typeof a.target === 'string' ? [a.target] : [];
}

class CompileCtx implements Ctx {
  t = 0;
  end = 0;
  constructor(
    readonly W: number,
    readonly H: number,
    readonly pace: number,
  ) {}
  tw(chan: Chan, v: number, o: TweenOptions = {}): number {
    const end = chan.to(v, o.at ?? this.t, (o.d ?? 300) * this.pace, o.e, o.fn);
    if (end > this.end) this.end = end;
    return end;
  }
  raw(chan: Chan, v: number, at: number, dur: number, e?: Ease, fn?: SegFn): number {
    const end = chan.to(v, at, dur, e, fn);
    if (end > this.end) this.end = end;
    return end;
  }
}

/**
 * Build the stage and schedule the whole clip. Throws an Error whose message names what is wrong
 * when the clip asks for something its stage cannot do; the caller shows the text version instead.
 */
export function compile(data: ClipData, env: Omit<StageEnv, 'values' | 'texts' | 'drawn' | 'explore' | 'actions'>): Compiled {
  const pace = PACE[data.pace ?? 'normal'] ?? 1;
  const later: string[] = [];
  const drawn: string[] = [];
  const values: number[] = [];
  const texts = new Map<string, string[]>();
  for (const b of data.beats) {
    for (const a of b.do ?? []) {
      if (!(VERBS as readonly string[]).includes(a.verb)) throw new Error(`Unknown verb "${a.verb}". Use one of: ${VERBS.join(', ')}.`);
      const ids = targetsOf(a);
      if (a.verb === 'show') later.push(...ids);
      if (a.verb === 'draw') drawn.push(...ids);
      if (a.verb !== 'set') continue;
      if (typeof a.value === 'number') values.push(a.value);
      for (const text of [a.value, a.label]) {
        if (typeof text !== 'number' && typeof text !== 'string') continue;
        const shown = typeof text === 'number' ? Math.round(text).toLocaleString('en-US') : text;
        for (const id of ids) texts.set(id, [...(texts.get(id) ?? []), shown]);
      }
    }
  }

  // What the sliders can reach is known before the stage is built: a read-out is sized for the
  // longest number it will show, and a chart picks a scale that never has to change.
  const explorer = data.explore ? new Explorer(data.explore) : null;
  if (explorer) for (const [id, shown] of explorer.texts()) texts.set(id, [...(texts.get(id) ?? []), ...shown]);

  const actions = data.beats.flatMap((b) => b.do ?? []);
  const stage = makeStage(data.stage, { ...env, values, texts, drawn: [...new Set(drawn)], actions, explore: explorer?.env });
  stage.hideAtStart([...new Set(later)]);
  const ctx = new CompileCtx(env.W, env.H, pace);
  stage.intro(ctx);
  // A short rest after the establishing move, so the poster frame is a still picture. A stage
  // that opens empty still has a moment before its first caption: the poster is never beat 1.
  const open = Math.round(Math.max(ctx.end + 160 * pace, 260));

  const beats: BeatTime[] = [];
  let t = open;
  data.beats.forEach((b, i) => {
    const caption = captionText(b.caption);
    const audio = env.audio?.[i];
    const read = readingMs(caption);
    const lead = audio !== undefined ? 150 : Math.min(650, read * 0.22);
    let cursor = t + lead;
    let prevStart = cursor;
    let motionEnd = cursor;
    for (const a of b.do ?? []) {
      let start = a.with === true ? prevStart : cursor;
      if (typeof a.on === 'string') start = Math.max(start, t + cueMs(caption, a.on, audio ?? read));
      ctx.t = start;
      ctx.end = start;
      const verb = (stage as unknown as Record<string, unknown>)[a.verb];
      if (typeof verb !== 'function') throw new Error(`A ${data.stage.kind} stage has no "${a.verb}".`);
      (verb as (this: StageKit, ctx: Ctx, a: ActionData) => void).call(stage, ctx, a);
      prevStart = start;
      motionEnd = Math.max(motionEnd, ctx.end);
      cursor = Math.max(cursor, ctx.end - 90 * pace);
    }
    const t1 = Math.round(Math.max(motionEnd + 500, t + (audio !== undefined ? audio + 300 : read)));
    beats.push({ i, t0: t, t1, motionEnd, gate: b.gate !== undefined && b.gate !== null });
    t = t1;
  });
  if (explorer) {
    for (const b of explorer.binds) {
      if (!stage.bind) throw new Error(`explore: a ${data.stage.kind} stage has nothing a formula can drive.`);
      stage.bind(b.target);
    }
  }
  return { stage, beats, duration: t, apply: (at, x) => stage.apply(at, x), taps: (at) => stage.taps?.(at) ?? [], busy: () => stage.busy?.() === true, destroy: () => stage.destroy?.() };
}
