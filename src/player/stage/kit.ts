// THE STAGE-KIT INTERFACE
//
// A stage kit draws one kind of stage (`cells`, `flow`, `lines`, ...). It is the only code that
// knows that kind's layout and what each verb looks like on it. Everything around it is shared: the
// compiler that turns beats into time (timeline.ts), the clip that plays, scrubs and steps
// (clip.ts), the captions, the controls, narration, print.
//
// 1. What a kit is
//    A class that extends `Stage` (below), registered under its stage kind:
//
//        export class LinesStage extends Stage<LinesData> { ... }
//        registerKit('lines', (data, env) => new LinesStage(data, env));
//
//    Registration is one call at module load. `index.ts` imports every kit module, so a new kit
//    is: one file `kit-<kind>.ts`, one import line there.
//
// 2. The life of a kit (all of it happens inside `compile`, before anything is shown)
//      new Kit(data, env)     build every part the stage will ever show, and lay it out for
//                             env.W x env.H. `data` is the stage object exactly as authored
//                             (src/core/clip.ts). Parts go into `this.world` (moved by the camera)
//                             or `this.hud` (not moved); connectors into `this.wires` (an SVG the
//                             size of the stage). Register each with `this.add(part)`.
//      hideAtStart(ids)       ids that some `show` in the clip names: start them off stage.
//      intro(ctx)             the establishing move, scheduled from ctx.t (which is 0): whatever
//                             starts on stage arrives in a short stagger.
//      <verb>(ctx, action)    once per action, in beat order: `show`, `hide`, `draw`, `send`,
//                             `focus`, `set`, `move`, `swap`, `split`, `merge`, `reorder`, `pulse`.
//                             Implement the verbs your stage accepts; the base class implements
//                             show, hide, pulse, set and focus for any part. A verb SCHEDULES: it
//                             adds segments to channels starting at ctx.t, through `ctx.tw(chan,
//                             value, { at, d, e })` (d is a base duration; the clip's pace scales
//                             it) or `ctx.raw(...)` (absolute timing). It draws nothing. The
//                             compiler reads `ctx.end` afterwards to know when the action has
//                             settled, so use ctx.tw / ctx.raw, or raise `ctx.end` yourself.
//                             Throw an Error with a sentence an author can act on when an action
//                             names something that does not exist ("move: "c99" is not a cell.").
//      apply(t)               draw the instant t, in ms. Called for every frame, in any order of
//                             t: scrubbing, stepping back, a fresh build after a resize.
//      apply(t, x)            the same instant with the learner's numbers in place of the clip's
//                             own (explore.ts). Only ever asked at the end of the clip. The base
//                             class hands every bound part its number (`x.values`); a kit whose
//                             picture depends on the controls themselves (a curve) reads `x.env`.
//      taps(t)                the parts a tap gate may offer at t, as boxes in the stage's own
//                             pixels. The base class asks every part of a tappable kind
//                             (tappable.ts) for its `tap(t)`; a kit only says what its parts are
//                             (`role`) and, for a part that is not a Box or a Wire, where it is.
//
// 3. The one rule
//    `apply(t)` is a pure function of t. Nothing may remember the previous frame: no counters, no
//    "current" state that a verb method or an earlier apply left behind and a later apply reads.
//    State that verbs build up while compiling (which slot a cell is in after a swap) is fine, as
//    long as apply reads channels and not that state. Write through the writers in core.ts (setT,
//    setO, setSize, setText, setData, setAttr, setProp): they use CSSOM only, as the page's policy
//    requires, and skip unchanged values. test/clip/determinism.test.ts renders every example clip
//    at instants reached by different routes and compares every write; a kit registered here is
//    covered by it as soon as src/core/clip-examples.ts has a clip of its kind.
//
// 4. What a kit never does
//    No timers, no requestAnimationFrame, no CSS transitions or animations on parts, no listeners
//    on the stage (the stage is aria-hidden and not interactive), no innerHTML, no style
//    attributes, no colours or sizes taken from the lesson. No motion that loops or drifts: every
//    segment ends, and when the clip rests the stage is still.
//
// 5. The look
//    Kits share one hand. Use `Box` (core.ts) for anything that is a labelled shape, `Wire` for a
//    connector, `Words` for kinetic type, `makeToken` for something that travels. Give a box a
//    class of your own (`cls: 'st-line'`) and style it in your stylesheet. Tones are the six in
//    `TONES`; a tone changes weight and fill together, never colour alone. Durations come from
//    `D`, curves from `E`, stagger from `stagger(n)`, distance scaling from `travel(base,
//    distance, W)`, label widths from `textWidth(text, px, weight)`: do not invent numbers that
//    already have a name.
//    Colour: the stage is a dark field in both page themes (css/stage.css sets `color-scheme:
//    dark` on the band), so the shell's tokens resolve to their dark values on it, and on the
//    picture `--lt-bg`, `--lt-surface` and `--lt-sunken` are the field's own and `--lt-ink-3` is
//    the stage's quiet ink. Whatever else the stage needs is a token in css/stage-tokens.css
//    (--st-*): the field, panes, hairlines, shades, halos. A stylesheet names no colour of its
//    own (test/render/source-rules.test.ts), and test/clip/stage-tokens.test.ts holds the
//    contrast of text on every part of the field. `.st-paper` is the same set for print.
//    Depth and emphasis come free with the base class: a box lands and its label settles after
//    it, a change of tone or a pulse sends one ring outwards, a focus dims everything else and
//    rims its subject. `introStats(ctx)` brings the read-outs on; call it from your `intro`.
//    Override `zoomParts` if a zoom on your parts should keep something attached to them in frame.
//
// 6. Narrow stages
//    `this.narrow` is true under 520 px of stage width, where the stage is taller than it is wide.
//    Restack, do not shrink: a row becomes a column, labels move under their parts.
import { Box, Chan, type Ctx, D, E, type Part, type Rect, type TapBox, type ToneName, clamp, h, s, setT, stagger, textWidth } from './core';
import { type ExploreEnv, type ExploreState, format } from './explore';
import { tappableKinds } from './tappable';

export * from './core';
export type { ExploreEnv, ExploreState } from './explore';

/** A part a tap gate offers: its id, what it is called, and its box in the stage's own pixels (top left and size). */
export interface TapTarget {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
/** What a formula can drive, by what the part is. */
const BINDABLE_PARTS = ['stat', 'bar', 'group', 'value'];

/** What the compiler hands a kit: where to build, how large, and what the clip will ask of it later. */
export interface StageEnv {
  /** The element to build into. Empty, positioned, exactly W x H. */
  readonly el: HTMLElement;
  readonly W: number;
  readonly H: number;
  /** Device pixels per CSS pixel, at most 2, for a kit that draws on a canvas. */
  readonly dpr: number;
  /** The six tones as RGB, resolved for the current theme, for a kit that draws on a canvas. */
  readonly colors: Readonly<Record<ToneName, readonly [number, number, number]>>;
  /** Every number a `set ... value` in this clip will give, so a chart can choose its scale once. */
  readonly values: readonly number[];
  /** For each part id, the texts later `set`s will give it, so a part can be sized for its longest. */
  readonly texts: ReadonlyMap<string, readonly string[]>;
  /** Length in ms of each beat's narration, when the clip is being voiced. */
  readonly audio?: readonly (number | undefined)[] | undefined;
  /** Ids that some `draw` in the clip names: what a chart leaves undrawn until then. */
  readonly drawn?: readonly string[] | undefined;
  /** Every action of every beat, in order, before any is compiled: for a kit that must choose a size once for everything the clip will do. */
  readonly actions?: readonly ActionData[] | undefined;
  /** The clip's sliders, when the learner may explore: where each starts and what the bound parts reach across their ranges. */
  readonly explore?: ExploreEnv | undefined;
}

/** An action as a kit receives it: the authored object, loosely typed, because each kit reads its own fields. */
export interface ActionData {
  readonly verb: string;
  readonly target?: string;
  readonly targets?: readonly string[];
  readonly with?: boolean;
  readonly on?: string;
  readonly [field: string]: unknown;
}

/** What the compiler and the clip need from a kit. `Stage` implements all of it. */
export interface StageKit {
  hideAtStart(ids: readonly string[]): void;
  intro(ctx: Ctx): void;
  apply(t: number, x?: ExploreState): void;
  /** The parts a tap gate may offer at time t. */
  taps?(t: number): TapTarget[];
  /** Called once per binding, after the beats are compiled: throws when the part is not one a formula can drive. */
  bind?(id: string): void;
  /** Whether something drawn for the learner's numbers is still on its way (a dot crossing): the page keeps drawing while it is. */
  busy?(): boolean;
  /** Release anything held outside the stage element (a worker, an observer). Most kits hold nothing. */
  destroy?(): void;
}

export type KitMaker = (data: never, env: StageEnv) => StageKit;
const KITS = new Map<string, KitMaker>();

/** Register the kit for a stage kind. Call once, at module load. */
export function registerKit(kind: string, make: KitMaker): void {
  KITS.set(kind, make);
}
export function hasKit(kind: string): boolean {
  return KITS.has(kind);
}
export function makeStage(data: { kind: string }, env: StageEnv): StageKit {
  const make = KITS.get(data.kind);
  if (!make) throw new Error(`No stage kit is registered for the kind "${data.kind}".`);
  return make(data as never, env);
}

export interface StatData {
  id: string;
  label: string;
  value: number | string;
  unit?: string | undefined;
  at?: string | undefined;
}
export interface StageData {
  readonly kind: string;
  readonly stats?: readonly StatData[] | undefined;
}

/** A camera: where the stage is looking, and how closely. */
export interface Camera {
  readonly x: Chan;
  readonly y: Chan;
  readonly z: Chan;
}

/**
 * The stage base: parts by id, the camera, the read-outs, and the verbs that work on any stage.
 * A kit extends it, builds its parts in its constructor, and adds the verbs that are its own.
 */
export class Stage<T extends StageData = StageData> implements StageKit {
  /** The stage as authored. */
  readonly d: T;
  readonly W: number;
  readonly H: number;
  /** Under 520 px of width: restack. */
  readonly narrow: boolean;
  readonly el: HTMLElement;
  readonly colors: StageEnv['colors'];
  /** Moved and scaled by the camera. Parts and connectors live here. */
  readonly world: HTMLElement;
  /** An SVG the size of the stage, inside the world, for connectors and chart lines. */
  readonly wires: SVGElement;
  /** Above the world and not moved by the camera: read-outs, legends. */
  readonly hud: HTMLElement;
  readonly parts = new Map<string, Part>();
  readonly cam: Camera;
  /** The read-outs, in authored order. */
  readonly stats: Box[];
  /** The y below which the picture must not go: the read-outs have the strip under it. */
  floor: number;
  /** The kinds of part a tap gate can offer here (tappable.ts). */
  readonly tappable: readonly string[];

  constructor(data: T, env: StageEnv) {
    this.d = data;
    this.tappable = tappableKinds(data as { kind: string; mark?: string });
    this.W = env.W;
    this.H = env.H;
    this.narrow = env.W < 520;
    this.el = env.el;
    this.colors = env.colors;
    this.world = env.el.appendChild(h('div', 'st-world'));
    this.wires = this.world.appendChild(s('svg', { class: 'st-wires', width: this.W, height: this.H, viewBox: `0 0 ${this.W} ${this.H}`, 'aria-hidden': 'true', focusable: 'false' }));
    this.hud = env.el.appendChild(h('div', 'st-hud'));
    this.cam = { x: new Chan(this.W / 2), y: new Chan(this.H / 2), z: new Chan(1) };

    // Read-outs: a small label over a large value, in a row along the bottom edge, outside the
    // camera so a zoom never moves them. Sized for the longest value the clip will give them.
    const stats = data.stats ?? [];
    const big = this.narrow ? 19 : 24;
    const statH = this.narrow ? 46 : 56;
    const pad = this.narrow ? 10 : 16;
    this.stats = stats.map((st) => {
      const b = new Box({ id: st.id, value: st.value, unit: st.unit, kicker: st.label, cls: 'st-stat', dp: env.explore?.dp.get(st.id) }, this.hud);
      b.hud = true;
      b.role = 'stat';
      this.add(b);
      return b;
    });
    let x = pad;
    let row = 0;
    stats.forEach((st, i) => {
      const b = this.stats[i] as Box;
      const all = [String(typeof st.value === 'number' ? format(st.value, env.explore?.dp.get(st.id) ?? 0) : st.value), ...(env.texts.get(st.id) ?? [])];
      const longest = Math.max(...all.map((v) => textWidth(v + (st.unit ?? ''), big, 700)));
      const w = Math.min(this.W - 2 * pad, Math.round(Math.max(longest, textWidth(st.label.toUpperCase(), 10.5, 700) * 1.1) + (this.narrow ? 22 : 30)));
      if (x + w > this.W - pad && x > pad) {
        x = pad;
        row++;
      }
      b.place({ x: x + w / 2, y: this.H - pad - statH / 2 - row * (statH + 6), w, h: statH });
      x += w + 8;
    });
    this.floor = this.H - (stats.length ? pad + (row + 1) * (statH + 6) + 6 : 10);
  }

  add<P extends Part>(part: P): P {
    if (this.parts.has(part.id)) throw new Error(`Two parts share the id "${part.id}".`);
    this.parts.set(part.id, part);
    return part;
  }
  get(id: string): Part {
    const p = this.parts.get(id);
    if (!p) throw new Error(`No part with the id "${id}" on this ${this.d.kind} stage.`);
    return p;
  }
  /** The ids an action names: `targets`, or `target` alone, or none. */
  ids(a: ActionData): string[] {
    if (Array.isArray(a.targets)) return [...(a.targets as string[])];
    return typeof a.target === 'string' ? [a.target] : [];
  }
  /** Parts that recede when something else is in focus. */
  dimmable(): Part[] {
    return [...this.parts.values()].filter((p) => p.c.dim !== undefined && !p.hud);
  }
  bbox(parts: readonly Part[]): { cx: number; cy: number; w: number; h: number } {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of parts) {
      const r = p.rest();
      x0 = Math.min(x0, r.x - r.w / 2);
      x1 = Math.max(x1, r.x + r.w / 2);
      y0 = Math.min(y0, r.y - r.h / 2);
      y1 = Math.max(y1, r.y + r.h / 2);
    }
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }

  /** Parts that a `show` names somewhere in the clip start out of sight. */
  hideAtStart(ids: readonly string[]): void {
    for (const id of ids) this.parts.get(id)?.startHidden?.();
  }
  /** The read-outs slide in from the left, a beat behind the picture. Kits call this from their own intro. */
  introStats(ctx: Ctx, delay = 220): void {
    this.stats.forEach((b, i) => {
      if (b.c.o.base !== 1) return;
      b.startHidden();
      b.enter(ctx, (delay + i * 70) * ctx.pace, 'left');
    });
  }
  /** The establishing move: everything that starts on stage arrives in a short stagger. */
  intro(ctx: Ctx): void {
    const ps = [...this.parts.values()].filter((p) => !p.hud && p.enter && p.startHidden && p.c.o?.base === 1);
    const st = stagger(ps.length) * ctx.pace;
    ps.forEach((p, i) => {
      p.startHidden?.();
      p.enter?.(ctx, i * st, 'below');
    });
    this.introStats(ctx);
  }

  // ------------------------------------------------------------------------------------------ verbs
  show(ctx: Ctx, a: ActionData): void {
    const ps = this.ids(a).map((id) => this.get(id));
    const st = stagger(ps.length) * ctx.pace;
    ps.forEach((p, i) => this.need(p, 'enter', 'show').enter?.(ctx, i * st, typeof a.from === 'string' ? a.from : p.hud ? 'left' : undefined));
  }
  hide(ctx: Ctx, a: ActionData): void {
    const ps = this.ids(a).map((id) => this.get(id));
    const st = (stagger(ps.length) / 2) * ctx.pace;
    ps.forEach((p, i) => this.need(p, 'exit', 'hide').exit?.(ctx, i * st));
  }
  pulse(ctx: Ctx, a: ActionData): void {
    const ps = this.ids(a).map((id) => this.get(id));
    const st = stagger(ps.length) * ctx.pace;
    ps.forEach((p, i) => this.need(p, 'pulse', 'pulse').pulse?.(ctx, i * st));
  }
  set(ctx: Ctx, a: ActionData): void {
    const ps = this.ids(a).map((id) => this.get(id));
    const st = stagger(ps.length) * ctx.pace;
    ps.forEach((p, i) => {
      if (typeof a.tone === 'string') this.need(p, 'setTone', 'set tone').setTone?.(ctx, a.tone, i * st);
      if (typeof a.value === 'number' || typeof a.value === 'string') {
        this.need(p, 'setValue', 'set value').setValue?.(ctx, p.textPrefix !== undefined && typeof a.value === 'string' ? p.textPrefix + a.value : a.value, i * st);
      }
      if (typeof a.label === 'string') this.need(p, 'setValue', 'set label').setValue?.(ctx, a.label, i * st);
    });
  }
  private need(p: Part, method: 'enter' | 'exit' | 'pulse' | 'setTone' | 'setValue', verb: string): Part {
    if (typeof p[method] !== 'function') throw new Error(`"${p.id}" is a ${p.kind}: it does not take "${verb}" on this ${this.d.kind} stage.`);
    return p;
  }
  /** Which parts a focus names. A kit may widen this (a range of cells, a group's label). */
  focusSet(a: ActionData): Set<string> {
    return new Set(this.ids(a));
  }
  /** What the camera frames when a focus zooms: the parts in focus. A kit may add what is attached to them. */
  zoomParts(want: ReadonlySet<string>): Part[] {
    return [...want].map((id) => this.get(id));
  }
  /** Everything but the named parts recedes; with `zoom` the camera moves in on them. No target: all return. */
  focus(ctx: Ctx, a: ActionData): void {
    const want = this.focusSet(a);
    const none = want.size === 0;
    for (const id of want) this.get(id);
    for (const p of this.dimmable()) {
      const inFocus = want.has(p.id) || (p.group !== undefined && want.has(p.group));
      const dim = none || inFocus ? 0 : 1;
      const chan = p.c.dim as Chan;
      if (chan.end !== dim) ctx.tw(chan, dim, { d: D.dim, e: E.out });
      if (p instanceof Box) p.setLift(ctx, !none && want.has(p.id) ? 1 : 0);
    }
    const cam = this.cam;
    if (a.zoom === true && !none) {
      const b = this.bbox(this.zoomParts(want));
      const z = clamp(0.62 * Math.min(this.W / Math.max(b.w, 40), this.floor / Math.max(b.h, 40)), 1, 1.75);
      // The subject is centred in the picture's own area (above the read-outs), not in the whole
      // stage. The field behind the stage is continuous, so the camera may look a little past the
      // edge to get it there.
      const slack = 0.18 * this.W;
      const cx = clamp(b.cx, this.W / (2 * z) - slack, this.W - this.W / (2 * z) + slack);
      const cy = clamp(b.cy + (this.H - this.floor) / (2 * z), this.H / (2 * z) - slack, this.H - this.H / (2 * z) + slack);
      ctx.tw(cam.x, cx, { d: D.camera, e: E.move });
      ctx.tw(cam.y, cy, { d: D.camera, e: E.move });
      ctx.tw(cam.z, z, { d: D.camera, e: E.move });
    } else if (cam.z.end !== 1) {
      ctx.tw(cam.x, this.W / 2, { d: D.camera, e: E.move });
      ctx.tw(cam.y, this.H / 2, { d: D.camera, e: E.move });
      ctx.tw(cam.z, 1, { d: D.camera, e: E.move });
    }
  }

  // ------------------------------------------------------------------------------------------ frame
  camera(t: number): { x: number; y: number; z: number } {
    return { x: this.cam.x.at(t), y: this.cam.y.at(t), z: this.cam.z.at(t) };
  }
  apply(t: number, x?: ExploreState): void {
    const c = this.camera(t);
    setT(this.world, this.W / 2 - c.x * c.z, this.H / 2 - c.y * c.z, c.z);
    if (x) for (const p of this.parts.values()) p.apply(t, x.values.get(p.id));
    else for (const p of this.parts.values()) p.apply(t);
  }

  // ------------------------------------------------------------------------------------------ taps
  /** A part's box as the learner sees it at time t: through the camera, kept on the stage, never too small to hit. */
  tapTarget(id: string, b: TapBox, t: number): TapTarget {
    const c = this.camera(t);
    const w = Math.max(b.w * c.z, 24);
    const hh = Math.max(b.h * c.z, 24);
    // A little inside the edge, so the outline and its mark are never cut off by it.
    const cx = clamp(this.W / 2 + (b.x - c.x) * c.z, w / 2 + 6, Math.max(w / 2 + 6, this.W - w / 2 - 6));
    const cy = clamp(this.H / 2 + (b.y - c.y) * c.z, hh / 2 + 6, Math.max(hh / 2 + 6, this.H - hh / 2 - 6));
    return { id, label: b.label, x: Math.round(cx - w / 2), y: Math.round(cy - hh / 2), w: Math.round(w), h: Math.round(hh) };
  }
  /** Every part of a tappable kind that is on stage at time t. */
  taps(t: number): TapTarget[] {
    const out: TapTarget[] = [];
    if (!this.tappable.length) return out;
    for (const p of this.parts.values()) {
      if (!this.tappable.includes(p.role ?? p.kind)) continue;
      const b = p.tap?.(t);
      if (b) out.push(this.tapTarget(p.id, b, t));
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------ explore
  /** Whether something drawn for the learner's numbers is still on its way. Only a kit with a clock of its own (dots) ever says yes. */
  busy(): boolean {
    return false;
  }
  bind(id: string): void {
    const p = this.parts.get(id);
    if (!p) throw new Error(`explore: nothing on this ${this.d.kind} stage has the id "${id}".`);
    const what = p.role ?? p.kind;
    if (!BINDABLE_PARTS.includes(what)) throw new Error(`explore: "${id}" is a ${what}. A formula can drive a read-out, a bar, a group of dots or a value beside a line.`);
  }
}

/**
 * A token: a small labelled packet that travels. Made per `send`, it exists only on its way.
 * It starts hidden and small; the sender schedules its launch, its path and its end.
 */
export function makeToken(stage: Stage, id: string, label: string | undefined, tone = 'accent'): Box {
  const b = new Box({ id, label: label ?? '', cls: label ? 'st-token' : 'st-token st-token-bare', tone }, stage.world);
  b.c.o.base = 0;
  b.c.s.base = 0.5;
  b.hud = true;
  b.role = 'token';
  const w = Math.max(34, Math.round(textWidth(label ?? '', 13, 700) + 22));
  b.place({ x: 0, y: 0, w: label ? w : 18, h: label ? 26 : 18 });
  return stage.add(b);
}

/** The x of one of `n` evenly spaced columns across a width, centred in its slot. */
export function column(i: number, n: number, W: number, pad = 0): number {
  return pad + ((W - 2 * pad) * (i + 0.5)) / n;
}

export type { Rect };
