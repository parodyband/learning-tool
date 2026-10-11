// Core of the clip engine: easing, channels (pure functions of time), the DOM writers, and the two
// building blocks every kit draws with (the box and the wire).
//
// The whole engine rests on one rule: NOTHING remembers the previous frame. Every visible property
// is `channel.at(t)`. Play, pause, scrub, jump, replay, resize, theme, reduced motion and print are
// all "render(t)". A test holds the rule (test/clip/determinism.test.ts): it does not hold by itself.
//
// Writes go through CSSOM and SVG attributes only (the page's policy blocks style attributes), and
// each write is skipped when the value has not changed.
import { type Live, format } from './explore';

export type { Live };

// ---------------------------------------------------------------------------------------------
// Easing. One motion language for every kit (numbers from the motion-design-skills
// "animation-principles" reference, MIT): arrive by decelerating, leave by accelerating, move with
// both. No bounce anywhere; `pop` is a small overshoot kept for tokens and newcomers only.
// ---------------------------------------------------------------------------------------------
export type Ease = (u: number) => number;

export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const f = ((ax * t + bx) * t + cx) * t - x;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(f) < 1e-6 || d === 0) break;
      t -= f / d;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}

export const E = {
  /** easeOutExpo: arrive with energy, settle. */
  enter: bezier(0.16, 1, 0.3, 1),
  /** easeOutCubic: fades, small settles. */
  out: bezier(0.33, 1, 0.68, 1),
  /** easeInExpo: accelerate away. */
  exit: bezier(0.7, 0, 0.84, 0),
  /** easeInOutCubic: reposition while on stage; the camera. */
  move: bezier(0.65, 0, 0.35, 1),
  /** easeInOutQuad: travel of tokens, long draws. */
  soft: bezier(0.45, 0, 0.55, 1),
  /** A small overshoot and settle. */
  pop: bezier(0.34, 1.4, 0.64, 1),
  linear: ((u) => (u <= 0 ? 0 : u >= 1 ? 1 : u)) as Ease,
} as const;

/** Base durations in ms, before pace and distance scaling. */
export const D = { enter: 460, exit: 240, move: 400, draw: 440, send: 680, pop: 460, count: 800, camera: 900, dim: 300, tone: 340, word: 400, swap: 640, ring: 620 } as const;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Duration grows with the square root of distance, measured against the stage width, so timing does not depend on screen size. */
export function travel(base: number, dist: number, W: number): number {
  const n = Math.max(0.01, dist / (0.25 * W));
  return clamp(base * Math.sqrt(n), base * 0.6, base * 2.2);
}

/** Per-item delay for a group of n: 60 ms for lists, 30 ms for dense groups, the whole reveal capped near 480 ms. */
export function stagger(n: number): number {
  if (n <= 1) return 0;
  return Math.min(n > 8 ? 30 : 60, 480 / (n - 1));
}

// ---------------------------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------------------------
export type SegFn = (e: number, from: number, to: number) => number;
interface Seg {
  t0: number;
  t1: number;
  from: number;
  to: number;
  ease: Ease;
  fn: SegFn | undefined;
}

/**
 * One animated number. A base value plus segments; `at(t)` is a pure function of t. The latest
 * segment that has started wins; a finished one holds its end value. `to()` takes its starting
 * value from `at(t0)`, so moves chain pose to pose and overlapping moves blend without a jump.
 */
export class Chan {
  base: number;
  readonly segs: Seg[] = [];
  constructor(base = 0) {
    this.base = base;
  }
  at(t: number): number {
    let v = this.base;
    const s = this.segs;
    for (let i = 0; i < s.length; i++) {
      const g = s[i] as Seg;
      if (t < g.t0) break;
      if (t >= g.t1) v = g.to;
      else {
        const e = g.ease((t - g.t0) / (g.t1 - g.t0));
        v = g.fn ? g.fn(e, g.from, g.to) : g.from + (g.to - g.from) * e;
      }
    }
    return v;
  }
  /** Add a move to `to`, starting at t0. Returns when it ends. */
  to(to: number, t0: number, dur: number, ease?: Ease, fn?: SegFn): number {
    const from = this.at(t0);
    const seg: Seg = { t0, t1: t0 + Math.max(0, dur), from, to, ease: ease ?? E.move, fn };
    let i = this.segs.length;
    while (i > 0 && (this.segs[i - 1] as Seg).t0 > t0) i--;
    this.segs.splice(i, 0, seg);
    return seg.t1;
  }
  /** The value once everything scheduled so far has played. */
  get end(): number {
    const last = this.segs[this.segs.length - 1];
    return last ? last.to : this.base;
  }
}

export type Chans<K extends string> = { [P in K]: Chan };
export function chans<K extends string>(names: readonly K[]): Chans<K> {
  const out = {} as Chans<K>;
  for (const n of names) out[n] = new Chan(0);
  return out;
}

/** A bump: goes out and comes back to where it was heading. Arcs, pulses, hops. */
export const bump =
  (amount: number): SegFn =>
  (e, from, to) =>
    from + (to - from) * e + amount * Math.sin(Math.PI * e);

// ---------------------------------------------------------------------------------------------
// The compile context: what a kit is handed while a clip's beats are turned into channel segments.
// ---------------------------------------------------------------------------------------------
export interface TweenOptions {
  /** Start time in ms. Default: the start of the action being compiled (`ctx.t`). */
  at?: number;
  /** Base duration in ms, scaled by the clip's pace. Default 300. */
  d?: number;
  e?: Ease;
  fn?: SegFn;
}

export interface Ctx {
  /** Stage size in CSS pixels. */
  readonly W: number;
  readonly H: number;
  /** 0.82 (brisk), 1 or 1.25 (calm). `tw` applies it; multiply your own delays by it. */
  readonly pace: number;
  /** When the action being compiled starts, in ms from the start of the clip. */
  t: number;
  /** The latest end of anything this action has scheduled. The compiler reads it to chain the next action. */
  end: number;
  /** A move with a base duration (scaled by pace). Returns when it ends. */
  tw(chan: Chan, v: number, o?: TweenOptions): number;
  /** A move with absolute timing, for things tied to other things. */
  raw(chan: Chan, v: number, at: number, dur: number, e?: Ease, fn?: SegFn): number;
}

// ---------------------------------------------------------------------------------------------
// DOM writers
// ---------------------------------------------------------------------------------------------
/** What a writer remembers about an element, so that an unchanged value is not written again. */
interface Memo {
  t?: string;
  o?: string;
  w?: number;
  h?: number;
  x?: string;
  a?: Map<string, string>;
  d?: Map<string, string>;
}
const memo = new WeakMap<object, Memo>();
function memoOf(el: object): Memo {
  let m = memo.get(el);
  if (!m) memo.set(el, (m = {}));
  return m;
}

type Styled = Element & { style: CSSStyleDeclaration };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

const NS = 'http://www.w3.org/2000/svg';
export function s(tag: string, attrs?: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, tag) as SVGElement;
  if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(k, String(attrs[k]));
  return el;
}

export const f2 = (n: number): number => Math.round(n * 100) / 100;
const f3 = (n: number): number => Math.round(n * 1000) / 1000;

/** translate, then optional rotate and scale. `sy` given: a non-uniform scale. */
export function setT(el: Styled, x: number, y: number, sc = 1, rot = 0, sy?: number): void {
  let v = `translate3d(${f2(x)}px,${f2(y)}px,0)`;
  if (rot) v += ` rotate(${f2(rot)}deg)`;
  if (sy !== undefined) v += ` scale(${f3(sc)},${f3(sy)})`;
  else if (sc !== 1) v += ` scale(${f3(sc)})`;
  const m = memoOf(el);
  if (m.t !== v) {
    m.t = v;
    el.style.transform = v;
  }
}
export function setO(el: Styled, o: number): void {
  const v = o <= 0.004 ? '0' : o >= 0.996 ? '1' : String(f2(o));
  const m = memoOf(el);
  if (m.o !== v) {
    m.o = v;
    el.style.opacity = v;
  }
}
export function setSize(el: Styled, w: number, hh: number): void {
  const a = f2(w);
  const b = f2(hh);
  const m = memoOf(el);
  if (m.w !== a) {
    m.w = a;
    el.style.width = `${a}px`;
  }
  if (m.h !== b) {
    m.h = b;
    el.style.height = `${b}px`;
  }
}
export function setAttr(el: Element, name: string, value: string): void {
  const m = memoOf(el);
  const a = (m.a ??= new Map());
  if (a.get(name) !== value) {
    a.set(name, value);
    el.setAttribute(name, value);
  }
}
export function setText(el: Element, text: string): void {
  const m = memoOf(el);
  if (m.x !== text) {
    m.x = text;
    el.textContent = text;
  }
}
export function setData(el: Element, name: string, value: string): void {
  const m = memoOf(el);
  const d = (m.d ??= new Map());
  if (d.get(name) !== value) {
    d.set(name, value);
    el.setAttribute(`data-${name}`, value);
  }
}
/** A CSS length property on an element (stroke-dashoffset, a custom property). */
export function setProp(el: Styled, name: string, value: string): void {
  const m = memoOf(el);
  const d = (m.d ??= new Map());
  const key = `:${name}`;
  if (d.get(key) !== value) {
    d.set(key, value);
    el.style.setProperty(name, value);
  }
}

/** The interface face, as the stylesheet names it: what on-stage labels are measured in. */
const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif';
let measurer: { font: string; measureText(text: string): { width: number } } | null | undefined;
/**
 * The width of a label in CSS pixels, so a kit can size a part to its words. Measured with a 2D
 * canvas where there is one; estimated from the character count where there is not (in Node).
 */
export function textWidth(text: string, px: number, weight = 600): number {
  if (measurer === undefined) {
    measurer = null;
    try {
      const canvas = document.createElement('canvas') as Partial<HTMLCanvasElement>;
      if (typeof canvas.getContext === 'function') measurer = canvas.getContext('2d');
    } catch {
      measurer = null;
    }
  }
  if (measurer) {
    measurer.font = `${weight} ${px}px ${UI_FONT}`;
    return measurer.measureText(text).width;
  }
  return text.length * px * 0.58;
}

// ---------------------------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------------------------
export const TONES = ['neutral', 'accent', 'good', 'bad', 'warn', 'muted'] as const;
export type ToneName = (typeof TONES)[number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Where a part can be tapped (its centre and size, in the stage's own coordinates) and the words it is called by. */
export interface TapBox extends Rect {
  label: string;
}

/**
 * Anything a stage keeps by id. A kit may add parts of its own (a bar, a series, a group of dots):
 * this is all the base stage asks of them. The optional methods are the ones the shared verbs call;
 * a part that lacks one simply does not take that verb.
 */
export interface Part {
  readonly id: string;
  /** What kind of part this is, for error messages and for kits that treat kinds differently. */
  readonly kind: string;
  /** Channels by name. `dim` (0..1) makes the part recede under a focus; `o` is its own opacity. */
  readonly c: { readonly [name: string]: Chan };
  /** Never dimmed by a focus (read-outs, pointers, tokens). */
  hud?: boolean;
  /** The id of the part this one belongs to: it stays bright when that part is in focus. */
  group?: string;
  /** Text shown before a string value (a read-out's label), so `set value` keeps it. */
  textPrefix?: string;
  /** A kit's own word for what this part is on its stage ("cell", "node", "edge"): the word tappable.ts and the binding check know it by. */
  role?: string;
  /** Draw this part at time t. `live`: the number a formula gives it while the learner explores, in place of its own. */
  apply(t: number, live?: Live): void;
  /** Where the learner can tap this part at time t, or null when it is not on stage then. Only parts a tap gate can offer have it. */
  tap?(t: number): TapBox | null;
  /** Where the part rests once everything scheduled so far has played (centre and size), for the camera. */
  rest(): Rect;
  /** Make the part start off stage; a later `show` brings it on. */
  startHidden?(): void;
  enter?(ctx: Ctx, delay?: number, from?: string): void;
  exit?(ctx: Ctx, delay?: number): void;
  pulse?(ctx: Ctx, delay?: number, amount?: number): void;
  setTone?(ctx: Ctx, tone: string, delay?: number): void;
  setValue?(ctx: Ctx, value: number | string, delay?: number): void;
}

const fmt = (n: number, unit: string, dp = 0): string => `${dp > 0 ? format(n, dp) : Math.round(n).toLocaleString('en-US')}${unit}`;

export interface BoxData {
  id: string;
  label?: string | undefined;
  value?: number | string | undefined;
  unit?: string | undefined;
  /** Extra class names: the kit's own look for this box ("st-node", "st-cell"). */
  cls?: string | undefined;
  tone?: string | undefined;
  /** Text before a counting number, on the same line ("Sick  9"). */
  prefix?: string | undefined;
  /** A small label set above the value (a read-out's name). */
  kicker?: string | undefined;
  /** Decimals a counting number is shown with. Whole numbers unless a formula will drive it and needs more. */
  dp?: number | undefined;
}

export const BOX_CHANNELS = ['x', 'y', 'w', 'h', 'dx', 'dy', 's', 'o', 'dim', 'r', 'tone', 'ti', 'val', 'ly', 'ring', 'lift'] as const;

/**
 * The box: the one HTML building block. A rounded card with a label that can move, resize, recede,
 * change tone (two tint layers cross-faded: opacity only) and change its text (a number counts, a
 * string morphs). Its position is its centre.
 *
 * What makes it read as designed motion and not as a diagram that fades:
 *   - it arrives decelerating, and its label settles a moment after the card has landed;
 *   - a change of meaning (tone, a token arriving, a pulse) sends one ring outwards, once;
 *   - while another part is in focus it recedes; while it is in focus itself it carries a rim.
 */
export class Box implements Part {
  readonly id: string;
  readonly kind: string = 'box';
  readonly el: HTMLDivElement;
  readonly c: Chans<(typeof BOX_CHANNELS)[number]>;
  hud?: boolean;
  group?: string;
  textPrefix?: string;
  /** A kit's own word for what this box is on its stage ("pointer", "bracket", "token"). */
  role?: string;
  /** Which side of its subject a pointer or a label sits on. */
  side?: 'above' | 'below';
  texts: string[];
  readonly tones: string[];
  readonly numeric: boolean;
  private readonly tintA: HTMLElement;
  private readonly tintB: HTMLElement;
  private readonly ringEl: HTMLElement;
  private readonly txt: HTMLElement;
  private readonly la: HTMLElement;
  private readonly lb: HTMLElement;
  private readonly unit: string;
  private readonly prefix: string;
  private readonly dp: number;

  constructor(d: BoxData, parent: Element) {
    this.id = d.id;
    this.el = h('div', `st-p st-box ${d.cls ?? ''}`.trim());
    this.tintA = this.el.appendChild(h('span', 'st-tint'));
    this.tintB = this.el.appendChild(h('span', 'st-tint'));
    this.ringEl = this.el.appendChild(h('span', 'st-ring'));
    if (d.kicker !== undefined) this.el.appendChild(h('span', 'st-k', d.kicker));
    this.txt = this.el.appendChild(h('span', 'st-txt'));
    this.la = this.txt.appendChild(h('span', 'st-l'));
    this.lb = this.txt.appendChild(h('span', 'st-l'));
    this.unit = d.unit ?? '';
    this.prefix = d.prefix ?? '';
    this.dp = d.dp ?? 0;
    this.numeric = typeof d.value === 'number';
    // A value that is words carries its unit as a number does.
    this.texts = [this.numeric ? '' : d.value !== undefined ? `${d.value}${this.unit}` : String(d.label ?? '')];
    this.tones = [d.tone ?? 'neutral'];
    this.c = chans(BOX_CHANNELS);
    this.c.s.base = 1;
    this.c.o.base = 1;
    if (typeof d.value === 'number') this.c.val.base = d.value;
    parent.appendChild(this.el);
  }
  place(r: Rect): void {
    this.c.x.base = r.x;
    this.c.y.base = r.y;
    this.c.w.base = r.w;
    this.c.h.base = r.h;
  }
  startHidden(): void {
    this.c.o.base = 0;
    this.c.dy.base = 16;
    this.c.s.base = 0.9;
  }
  enter(ctx: Ctx, delay = 0, from = 'below'): void {
    const at = ctx.t + delay;
    const c = this.c;
    if (from === 'above') c.dy.to(-16, at, 0);
    else if (from === 'left') {
      c.dy.to(0, at, 0);
      c.dx.to(-22, at, 0);
    } else if (from === 'pop') {
      c.dy.to(0, at, 0);
      c.s.to(0.6, at, 0);
    } else c.dy.to(16, at, 0);
    ctx.tw(c.o, 1, { at, d: D.enter * 0.5, e: E.out });
    ctx.tw(c.dy, 0, { at, d: D.enter, e: E.enter });
    ctx.tw(c.dx, 0, { at, d: D.enter, e: E.enter });
    ctx.tw(c.s, 1, { at, d: D.enter, e: from === 'pop' ? E.pop : E.enter });
    // Follow-through: the label keeps travelling for a moment after the card has landed.
    c.ly.to(from === 'above' ? -7 : 7, at, 0);
    ctx.tw(c.ly, 0, { at: at + 70 * ctx.pace, d: D.enter, e: E.enter });
  }
  exit(ctx: Ctx, delay = 0): void {
    const at = ctx.t + delay;
    ctx.tw(this.c.o, 0, { at, d: D.exit, e: E.exit });
    ctx.tw(this.c.dy, -10, { at, d: D.exit, e: E.exit });
    ctx.tw(this.c.s, 0.94, { at, d: D.exit, e: E.exit });
  }
  /** A brief swell, with one ring sent outwards. A negative amount is a dip (anticipation) and sends no ring. */
  pulse(ctx: Ctx, delay = 0, amount = 0.12): void {
    const at = ctx.t + delay;
    ctx.tw(this.c.s, this.c.s.at(at), { at, d: D.pop, e: E.linear, fn: bump(amount) });
    if (amount > 0) this.ring(ctx, delay);
  }
  /** One ring that leaves the box and fades: "something happened here". Never repeats. */
  ring(ctx: Ctx, delay = 0): void {
    const at = ctx.t + delay;
    this.c.ring.to(0, at, 0);
    ctx.tw(this.c.ring, 1, { at, d: D.ring, e: E.out });
  }
  setTone(ctx: Ctx, tone: string, delay = 0): void {
    if (this.tones[this.tones.length - 1] === tone) return;
    this.tones.push(tone);
    ctx.tw(this.c.tone, this.tones.length - 1, { at: ctx.t + delay, d: D.tone, e: E.out });
    if (tone !== 'neutral' && tone !== 'muted') this.ring(ctx, delay);
  }
  setValue(ctx: Ctx, value: number | string, delay = 0): void {
    const at = ctx.t + delay;
    if (this.numeric && typeof value === 'number') {
      const dist = Math.abs(value - this.c.val.at(at));
      const d = dist <= 1 ? 1 : clamp(D.count * (0.6 + Math.log10(1 + dist) / 4), 500, 1200);
      const end = ctx.tw(this.c.val, value, { at, d, e: dist <= 1 ? E.linear : E.enter });
      // The number lands, then the box answers it.
      ctx.tw(this.c.s, this.c.s.at(end), { at: dist <= 1 ? at : end - 140 * ctx.pace, d: D.pop * 0.8, e: E.linear, fn: bump(0.07) });
    } else {
      this.texts.push(`${value}${this.unit}`);
      ctx.tw(this.c.ti, this.texts.length - 1, { at, d: D.tone, e: E.move });
    }
  }
  /** Bring the box forward (1) or let it go back (0): a rim while it is the subject of a focus. */
  setLift(ctx: Ctx, on: number): void {
    if (this.c.lift.end !== on) ctx.tw(this.c.lift, on, { d: D.dim, e: E.out });
  }
  /** The words on the box at time t. */
  said(t: number): string {
    if (this.numeric) return this.prefix + fmt(this.c.val.at(t), this.unit, this.dp);
    return this.texts[Math.min(this.texts.length - 1, Math.round(this.c.ti.at(t)))] as string;
  }
  tap(t: number): TapBox | null {
    const c = this.c;
    if (c.o.at(t) < 0.5) return null;
    return { x: c.x.at(t) + c.dx.at(t), y: c.y.at(t) + c.dy.at(t), w: c.w.at(t), h: c.h.at(t), label: this.said(t) };
  }
  apply(t: number, live?: Live): void {
    const c = this.c;
    const o = c.o.at(t) * (1 - 0.78 * c.dim.at(t));
    setO(this.el, o);
    if (o <= 0.004) return;
    const w = c.w.at(t);
    const hh = c.h.at(t);
    setSize(this.el, w, hh);
    setT(this.el, (live?.x ?? c.x.at(t)) + c.dx.at(t) - w / 2, (live?.y ?? c.y.at(t)) + c.dy.at(t) - hh / 2, c.s.at(t), c.r.at(t));
    // A part whose number is the learner's to change says so: the stylesheet marks it.
    setData(this.el, 'live', live ? '1' : '0');
    // tone: tint A holds the tone being left, tint B fades the next one in over it
    const tv = c.tone.at(t);
    const last = this.tones.length - 1;
    const ti = Math.min(last, Math.floor(tv + 1e-6));
    setData(this.tintA, 'tone', this.tones[ti] as string);
    setData(this.tintB, 'tone', this.tones[Math.min(last, ti + 1)] as string);
    setO(this.tintB, tv - ti);
    setData(this.el, 'tone', this.tones[Math.round(tv)] as string);
    setData(this.el, 'lift', c.lift.at(t) > 0.5 ? '1' : '0');
    // the ring: grows a little past the box and fades as it goes
    const rv = c.ring.at(t);
    const ro = rv <= 0 || rv >= 1 ? 0 : 0.55 * (1 - rv);
    setO(this.ringEl, ro);
    if (ro > 0) setT(this.ringEl, 0, 0, 1 + (14 / Math.max(24, w)) * rv * 2, 0, 1 + (14 / Math.max(24, hh)) * rv * 2);
    setT(this.txt, 0, c.ly.at(t));
    // text: a number counts, a string morphs (the old line slides up and out, the new one rises in)
    if (this.numeric || live) {
      setText(this.la, live ? this.prefix + live.s + this.unit : this.prefix + fmt(c.val.at(t), this.unit, this.dp));
      setO(this.la, 1);
      setT(this.la, 0, 0);
      setO(this.lb, 0);
    } else {
      const xv = c.ti.at(t);
      const lastText = this.texts.length - 1;
      const xi = Math.min(lastText, Math.floor(xv + 1e-6));
      const f = xv - xi;
      setText(this.la, this.texts[xi] as string);
      setText(this.lb, this.texts[Math.min(lastText, xi + 1)] as string);
      setO(this.la, 1 - f);
      setO(this.lb, f);
      setT(this.la, 0, -10 * f);
      setT(this.lb, 0, 10 * (1 - f));
    }
  }
  rest(): Rect {
    return { x: this.c.x.end, y: this.c.y.end, w: this.c.w.end, h: this.c.h.end };
  }
  /** Travel to a new place (and size). `arc` lifts the path by that many pixels at its middle. Returns when it lands. */
  moveTo(ctx: Ctx, r: { x: number; y: number; w?: number; h?: number }, o: { delay?: number; arc?: number; base?: number } = {}): number {
    const at = ctx.t + (o.delay ?? 0);
    const c = this.c;
    const dist = Math.hypot(r.x - c.x.at(at), r.y - c.y.at(at));
    const resize = Math.abs((r.w ?? c.w.end) - c.w.end) + Math.abs((r.h ?? c.h.end) - c.h.end);
    if (dist < 0.5 && resize < 0.5) return at;
    const d = travel(o.base ?? D.move, Math.max(dist, resize), ctx.W);
    ctx.tw(c.x, r.x, { at, d, e: E.move });
    ctx.tw(c.y, r.y, o.arc ? { at, d, e: E.move, fn: bump(o.arc) } : { at, d, e: E.move });
    if (r.w !== undefined) ctx.tw(c.w, r.w, { at, d, e: E.move });
    if (r.h !== undefined) ctx.tw(c.h, r.h, { at, d, e: E.move });
    return at + d * ctx.pace;
  }
}

export interface Pt {
  x: number;
  y: number;
}
/** A point on a quadratic curve and its direction, for tokens and arrowheads. */
export function quad(p0: Pt, p1: Pt, p2: Pt, u: number): Pt & { ang: number } {
  const a = 1 - u;
  return {
    x: a * a * p0.x + 2 * a * u * p1.x + u * u * p2.x,
    y: a * a * p0.y + 2 * a * u * p1.y + u * u * p2.y,
    ang: (Math.atan2(2 * a * (p1.y - p0.y) + 2 * u * (p2.y - p1.y), 2 * a * (p1.x - p0.x) + 2 * u * (p2.x - p1.x)) * 180) / Math.PI,
  };
}
export interface Curve {
  a: Pt;
  b: Pt;
  m: Pt;
}
/** The control point of a connector from a to b that bows `bend` px to the left of the direction of travel. */
export function curve(a: Pt, b: Pt, bend = 0): Curve {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { a, b, m: { x: mx + ((b.y - a.y) / len) * bend, y: my - ((b.x - a.x) / len) * bend } };
}

/** A connector: an SVG path drawn along its length (pathLength 1, dash offset), with an arrowhead riding the tip. */
export class Wire implements Part {
  readonly id: string;
  readonly kind: string = 'wire';
  readonly path: SVGElement;
  readonly head: SVGElement;
  readonly c: Chans<'draw' | 'o' | 'dim' | 'lost'>;
  hud?: boolean;
  group?: string;
  role?: string;
  /** What the connector is called, for a tap gate. */
  label = '';
  geo: Curve = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, m: { x: 0, y: 0 } };
  /** A kit may say where the wire rests for the camera; by default, its own bounding box. */
  restBox: (() => Rect) | null = null;

  constructor(id: string, svg: Element, cls = '') {
    this.id = id;
    this.path = svg.appendChild(s('path', { class: `st-wire ${cls}`.trim(), pathLength: '1', d: 'M0 0' }));
    this.head = svg.appendChild(s('path', { class: `st-head ${cls}`.trim(), d: 'M-10 -5.5 L0 0 L-10 5.5 Z' }));
    this.c = chans(['draw', 'o', 'dim', 'lost']);
    this.c.o.base = 1;
  }
  /** Straight when there is no bend, otherwise a quadratic curve bulging `bend` px to the left of travel. */
  setGeo(a: Pt, b: Pt, bend = 0): void {
    this.geo = curve(a, b, bend);
  }
  point(u: number): Pt & { ang: number } {
    return quad(this.geo.a, this.geo.m, this.geo.b, u);
  }
  rest(): Rect {
    if (this.restBox) return this.restBox();
    const { a, b } = this.geo;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: Math.abs(b.x - a.x) + 20, h: Math.abs(b.y - a.y) + 20 };
  }
  /** A drawn connector is tapped about its middle, where its label sits. */
  tap(t: number): TapBox | null {
    if (this.c.draw.at(t) < 0.5 || this.c.o.at(t) < 0.5) return null;
    const { a, b } = this.geo;
    const m = this.point(0.5);
    return { x: m.x, y: m.y, w: clamp(Math.abs(b.x - a.x) * 0.7, 48, 420), h: clamp(Math.abs(b.y - a.y) * 0.7, 40, 220), label: this.label };
  }
  apply(t: number): void {
    const g = this.geo;
    const d = this.c.draw.at(t);
    const o = this.c.o.at(t) * (1 - 0.78 * this.c.dim.at(t));
    setAttr(this.path, 'd', `M${f2(g.a.x)} ${f2(g.a.y)} Q${f2(g.m.x)} ${f2(g.m.y)} ${f2(g.b.x)} ${f2(g.b.y)}`);
    setO(this.path as unknown as Styled, d > 0.002 ? o : 0);
    setO(this.head as unknown as Styled, d > 0.04 ? o : 0);
    setProp(this.path as unknown as Styled, 'stroke-dashoffset', String(f3(1 - d)));
    const p = this.point(d);
    setAttr(this.head, 'transform', `translate(${f2(p.x)} ${f2(p.y)}) rotate(${f2(p.ang)})`);
    const lost = this.c.lost.at(t) > 0.5 ? '1' : '0';
    setData(this.path, 'lost', lost);
    setData(this.head, 'lost', lost);
  }
}

/**
 * Kinetic type: the words of a line rise and fade in one after another, fast enough to stay
 * readable. Whole words only, so the text is always real text.
 */
export class Words {
  readonly spans: HTMLElement[];
  readonly step: number;
  /** How long the whole reveal takes, in ms. */
  readonly total: number;
  constructor(el: Element, text: string) {
    el.textContent = '';
    const words = text.split(/\s+/).filter(Boolean);
    this.spans = words.map((w, i) => {
      const sp = el.appendChild(h('span', 'st-w', w));
      if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
      return sp;
    });
    const n = this.spans.length;
    this.step = n > 1 ? Math.min(60, 560 / (n - 1)) : 0;
    this.total = Math.max(0, n - 1) * this.step + D.word;
  }
  /** `ms` is the time since the reveal began. */
  apply(ms: number, rise = 10): void {
    for (let i = 0; i < this.spans.length; i++) {
      const sp = this.spans[i] as HTMLElement;
      const u = clamp((ms - i * this.step) / D.word, 0, 1);
      setO(sp, Math.min(1, u * 2.5));
      setT(sp, 0, (1 - E.enter(u)) * rise);
    }
  }
}
