// Curve chart (`kind: "chart"`, `mark: "curve"`): a function plot. Each curve is y = a formula in
// x; a formula may also name the clip's sliders, so the curve bends while the learner drags.
//
// What it can show:
//   draw    a curve is drawn left to right, its value riding the tip; `upto` (a number on the x
//           axis) stops early. A curve that some `draw` names starts undrawn; every other curve
//           draws itself as the clip opens.
//   show    a curve or a point that some `show` names starts off stage and fades in.
//   hide, focus, pulse, set (tone)   as on the other marks.
//   points  a point marks a place on a curve by its x (a formula in the sliders): a dot, a guide
//           down to each axis, and the two values where the guides land. It appears when its curve
//           has been drawn past it.
//
// Both axes are chosen once, when the stage is built, from everything the curves reach across the
// whole range of every slider (compile hands that over in `env.explore`), so nothing rescales
// while a slider moves. A curve is clipped to the plot (it lives in a nested <svg>, which clips to
// its own box), and where a formula has no finite value the line simply breaks.
//
// The picture is a pure function of (t, the control values): `apply(t)` evaluates every curve with
// the sliders' starting values, `apply(t, x)` with the learner's. What the parts keep between
// frames (the last sampled curve, the last path string) are caches of their own output.
import { type Expr, evalExpr } from '../../core/expr';
import { type Env, decimalsFor, decimalsOf, format, formula } from './explore';
import {
  type ActionData,
  type Chans,
  type Ctx,
  D,
  E,
  type ExploreState,
  type Part,
  type Rect,
  Stage,
  type StageEnv,
  type StatData,
  type TapBox,
  bump,
  chans,
  clamp,
  f2,
  h,
  s,
  setAttr,
  setData,
  setO,
  setProp,
  setSize,
  setT,
  setText,
  textWidth,
} from './kit';

export interface CurveData {
  kind: 'chart';
  mark: 'curve';
  unit?: string;
  max?: number;
  min?: number;
  yLabel?: string;
  x: { label: string; min: number; max: number; unit?: string };
  curves: { id: string; label: string; expr: string; tone?: string }[];
  points?: { id: string; label: string; x: string; on?: string; tone?: string }[];
  stats?: StatData[];
}

type Styled = Element & { style: CSSStyleDeclaration };
/** The pitch of the rows of a narrow chart's legend, in px: tall enough for each name to be tapped on its own (kit-chart.ts has the same). */
const LEGEND_ROW = 26;

/**
 * A round step that cuts `span` into about `about` parts: 1, 2, 2.5, 3, 4 or 5 times a power of
 * ten. A step that divides the span exactly is preferred, so the last tick is the end of the axis.
 */
function niceStep(span: number, about: number): number {
  const raw = span / Math.max(1, about);
  const p = Math.pow(10, Math.floor(Math.log10(raw > 0 ? raw : 1)));
  let best = p;
  let least = Infinity;
  for (const m of [1, 2, 2.5, 3, 4, 5, 10, 20]) {
    const parts = span / (m * p);
    const cost = Math.abs(parts - about) + (Math.abs(parts - Math.round(parts)) < 1e-9 ? 0 : 1.25);
    if (cost < least - 1e-9) {
      least = cost;
      best = m * p;
    }
  }
  return best;
}
/** The multiples of `step` from a to b, ends included when they are multiples. */
function ticks(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  for (let k = Math.ceil(a / step - 1e-9); k * step <= b + step * 1e-9; k++) out.push(Number((k * step).toPrecision(12)));
  return out;
}
const keyOf = (env: Env): string => Object.values(env).join(',');

interface Geo {
  W: number;
  narrow: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Decimals a value on each axis is read out with. */
  dpX: number;
  dpY: number;
  unitX: string;
  unitY: string;
}
const X = (g: Geo, x: number): number => g.left + ((g.right - g.left) * (x - g.x0)) / (g.x1 - g.x0);
const Y = (g: Geo, y: number): number => g.bottom - ((g.bottom - g.top) * (y - g.y0)) / (g.y1 - g.y0);

/** One curve: a path rebuilt from its formula, a dot riding the tip with the value there, and its name at its right end. */
class Curve implements Part {
  readonly id: string;
  readonly kind = 'curve';
  readonly label: string;
  /** p: how far along x it is drawn (0..1). name: its name has arrived. swell: a pulse on the stroke. */
  readonly c: Chans<'p' | 'o' | 'dim' | 'name' | 'tone' | 'swell'>;
  private readonly tones: string[];
  private readonly path: SVGElement;
  private readonly tip: SVGElement;
  private readonly val: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly nameW: number;
  private readonly scope: Record<string, number> = {};
  /** Caches of this part's own output: the curve as last sampled, and what the path was last built from. */
  private ys = new Float64Array(0);
  private sampled: string | null = null;
  private built: string | null = null;
  /** Where the name was last drawn, for a tap gate. */
  private nameAt = { x: 0, y: 0 };

  constructor(
    d: CurveData['curves'][number],
    tone: string,
    plot: Element,
    wires: Element,
    world: Element,
    private readonly expr: Expr,
    private readonly g: Geo,
    /** How many pieces the line is made of. */
    private readonly n: number,
    /** A narrow stage keeps the names in a small legend above the plot: this is the curve's row in it. */
    private readonly legendY: number | null,
  ) {
    this.id = d.id;
    this.label = d.label;
    this.tones = [tone];
    this.path = plot.appendChild(s('path', { class: 'st-curve', d: 'M0 0' }));
    this.tip = wires.appendChild(s('circle', { class: 'st-tip', r: 7 }));
    this.val = world.appendChild(h('span', 'st-p st-tipval'));
    this.nameEl = world.appendChild(h('span', 'st-p st-seriesname', d.label));
    this.nameW = Math.round(textWidth(d.label, 15, 700) + 26);
    this.c = chans(['p', 'o', 'dim', 'name', 'tone', 'swell']);
    this.c.o.base = 1;
    this.c.p.base = 1;
    this.c.name.base = 1;
  }
  /** y at x, with the controls set as `env`. */
  f(x: number, env: Env): number {
    const scope = this.scope;
    for (const k of Object.keys(env)) scope[k] = env[k] as number;
    scope.x = x;
    return evalExpr(this.expr, scope);
  }
  startHidden(): void {
    this.c.o.base = 0;
  }
  enter(ctx: Ctx, delay = 0): void {
    ctx.tw(this.c.o, 1, { at: ctx.t + delay, d: D.enter * 0.7, e: E.out });
  }
  exit(ctx: Ctx, delay = 0): void {
    ctx.tw(this.c.o, 0, { at: ctx.t + delay, d: D.exit, e: E.exit });
  }
  pulse(ctx: Ctx, delay = 0): void {
    ctx.tw(this.c.swell, 0, { at: ctx.t + delay, d: D.pop * 1.2, e: E.linear, fn: bump(1) });
  }
  setTone(ctx: Ctx, tone: string, delay = 0): void {
    if (this.tones[this.tones.length - 1] === tone) return;
    this.tones.push(tone);
    this.c.tone.to(this.tones.length - 1, ctx.t + delay + (D.tone / 2) * ctx.pace, 0);
    ctx.end = Math.max(ctx.end, ctx.t + delay + D.tone * ctx.pace);
    this.pulse(ctx, delay);
  }
  rest(): Rect {
    const g = this.g;
    return { x: (g.left + g.right) / 2, y: (g.top + g.bottom) / 2, w: g.right - g.left, h: g.bottom - g.top };
  }
  /** A curve is offered by its name. */
  tap(t: number): TapBox | null {
    if (this.c.o.at(t) < 0.5 || this.c.name.at(t) < 0.5) return null;
    return { x: this.nameAt.x + this.nameW / 2, y: this.nameAt.y + 11, w: this.nameW + 8, h: this.legendY !== null ? LEGEND_ROW - 2 : 32, label: this.label };
  }
  apply(): void {}

  /** Draw the curve for these control values. Returns where its right end is (the y its name wants), or null when it has not got there. */
  draw(t: number, env: Env, key: string): number | null {
    const c = this.c;
    const g = this.g;
    const n = this.n;
    const p = clamp(c.p.at(t), 0, 1);
    const o = c.o.at(t) * (1 - 0.78 * c.dim.at(t));
    const on = p > 0.001 ? o : 0;
    const tone = this.tones[Math.round(c.tone.at(t))] as string;
    setO(this.path as unknown as Styled, on);
    setData(this.path, 'tone', tone);
    setData(this.tip, 'tone', tone);
    setData(this.val, 'tone', tone);
    setData(this.nameEl, 'tone', tone);
    setProp(this.path as unknown as Styled, '--st-swell', String(f2(c.swell.at(t))));
    if (on > 0.004) {
      if (this.sampled !== key) {
        this.sampled = key;
        this.ys = new Float64Array(n + 1);
        for (let i = 0; i <= n; i++) this.ys[i] = this.f(g.x0 + ((g.x1 - g.x0) * i) / n, env);
      }
      const sig = `${p}|${key}`;
      if (this.built !== sig) {
        this.built = sig;
        setAttr(this.path, 'd', this.trace(p, env));
      }
    }
    // The tip: the value rides it while the curve is drawn, and stays at the right end afterwards.
    const tx = g.x0 + (g.x1 - g.x0) * p;
    const ty = this.f(tx, env);
    const span = g.y1 - g.y0;
    const inside = Number.isFinite(ty) && ty >= g.y0 - span * 0.002 && ty <= g.y1 + span * 0.002;
    const sx = X(g, tx);
    const sy = inside ? Y(g, ty) : 0;
    setO(this.tip as unknown as Styled, inside ? on : 0);
    setO(this.val, inside ? on : 0);
    if (inside) {
      setAttr(this.tip, 'transform', `translate(${f2(sx)} ${f2(sy)})`);
      setT(this.val, clamp(sx - 50, 2, g.W - 102), sy - 40);
      setText(this.val, format(ty, g.dpY) + g.unitY);
    }
    if (this.legendY !== null) {
      this.name(t, 12, this.legendY);
      return null;
    }
    if (c.name.at(t) * o <= 0.004) {
      setO(this.nameEl, 0);
      return null;
    }
    const end = this.f(g.x1, env);
    return Number.isFinite(end) ? Y(g, clamp(end, g.y0, g.y1)) : g.top;
  }
  /** Put the name at (x, y): its top left. */
  name(t: number, x: number, y: number): void {
    const nv = this.c.name.at(t);
    setO(this.nameEl, nv * this.c.o.at(t) * (1 - 0.78 * this.c.dim.at(t)));
    setT(this.nameEl, x, y + (1 - nv) * 8);
    this.nameAt = { x, y };
  }
  /** The path up to the fraction p of the x range, in the plot's own coordinates. It breaks where the formula has no value, and where it jumps across the whole plot (an asymptote). */
  private trace(p: number, env: Env): string {
    const g = this.g;
    const n = this.n;
    const w = g.right - g.left;
    const hh = g.bottom - g.top;
    const span = g.y1 - g.y0;
    let d = '';
    let pen = false;
    let prev = 0;
    const put = (u: number, y: number): void => {
      if (!Number.isFinite(y)) {
        pen = false;
        return;
      }
      if (pen && ((prev > g.y1 && y < g.y0) || (prev < g.y0 && y > g.y1))) pen = false;
      // Far outside the plot a point is pulled in to just beyond it, so the numbers stay small; the clip hides the difference.
      const v = clamp(y, g.y0 - span * 2, g.y1 + span * 2);
      d += `${pen ? 'L' : 'M'}${f2(u * w)} ${f2(hh - (hh * (v - g.y0)) / span)}`;
      pen = true;
      prev = y;
    };
    const whole = Math.floor(p * n + 1e-9);
    for (let i = 0; i <= whole; i++) put(i / n, this.ys[i] as number);
    if (p * n - whole > 1e-6) put(p, this.f(g.x0 + (g.x1 - g.x0) * p, env));
    return d || 'M0 0';
  }
}

/** A marked place on a curve: a dot, a guide to each axis, the two values where the guides land, and its name. */
class Point implements Part {
  readonly id: string;
  readonly kind = 'point';
  readonly label: string;
  readonly c: Chans<'o' | 'dim' | 's' | 'tone' | 'ring'>;
  private readonly tones: string[];
  private readonly guide: SVGElement;
  private readonly halo: SVGElement;
  private readonly dot: SVGElement;
  private readonly pillX: HTMLElement;
  private readonly pillY: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly nameW: number;
  /** Where the point was last drawn, for a tap gate. */
  private last: { x: number; y: number; on: boolean; said: string } = { x: 0, y: 0, on: false, said: '' };

  constructor(
    d: NonNullable<CurveData['points']>[number],
    wires: Element,
    world: Element,
    private readonly xExpr: Expr,
    private readonly curve: Curve,
    private readonly g: Geo,
    private readonly pillW: { x: number; y: number },
    /** Decimals its two values are read out with: enough for everything it can show. */
    private readonly dp: { x: number; y: number },
  ) {
    this.id = d.id;
    this.label = d.label;
    this.tones = [d.tone ?? 'warn'];
    this.guide = wires.appendChild(s('path', { class: 'st-guide', d: 'M0 0' }));
    this.halo = wires.appendChild(s('circle', { class: 'st-pt-halo', r: 9 }));
    this.dot = wires.appendChild(s('circle', { class: 'st-pt', r: 7.5 }));
    this.pillX = world.appendChild(h('span', 'st-p st-pt-pill'));
    this.pillY = world.appendChild(h('span', 'st-p st-pt-pill'));
    this.nameEl = world.appendChild(h('span', 'st-p st-pt-name', d.label));
    this.nameW = Math.round(textWidth(d.label, 13, 700) + 20);
    setSize(this.pillX, pillW.x, 22);
    setSize(this.pillY, pillW.y, 22);
    setSize(this.nameEl, this.nameW, 24);
    this.c = chans(['o', 'dim', 's', 'tone', 'ring']);
    this.c.o.base = 1;
    this.c.s.base = 1;
  }
  startHidden(): void {
    this.c.o.base = 0;
  }
  enter(ctx: Ctx, delay = 0): void {
    const at = ctx.t + delay;
    this.c.s.to(0.4, at, 0);
    ctx.tw(this.c.o, 1, { at, d: 200, e: E.out });
    ctx.tw(this.c.s, 1, { at, d: D.pop, e: E.pop });
    this.ring(ctx, delay + 120 * ctx.pace);
  }
  exit(ctx: Ctx, delay = 0): void {
    ctx.tw(this.c.o, 0, { at: ctx.t + delay, d: D.exit, e: E.exit });
  }
  ring(ctx: Ctx, delay = 0): void {
    const at = ctx.t + delay;
    this.c.ring.to(0, at, 0);
    ctx.tw(this.c.ring, 1, { at, d: D.ring, e: E.out });
  }
  pulse(ctx: Ctx, delay = 0): void {
    const at = ctx.t + delay;
    ctx.tw(this.c.s, this.c.s.at(at), { at, d: D.pop, e: E.linear, fn: bump(0.35) });
    this.ring(ctx, delay);
  }
  setTone(ctx: Ctx, tone: string, delay = 0): void {
    if (this.tones[this.tones.length - 1] === tone) return;
    this.tones.push(tone);
    this.c.tone.to(this.tones.length - 1, ctx.t + delay + (D.tone / 2) * ctx.pace, 0);
    this.pulse(ctx, delay);
  }
  rest(): Rect {
    return { x: this.last.x, y: this.last.y, w: 120, h: 90 };
  }
  tap(): TapBox | null {
    return this.last.on ? { x: this.last.x, y: this.last.y, w: 44, h: 44, label: `${this.label}: ${this.last.said}` } : null;
  }
  apply(): void {}

  draw(t: number, env: Env): void {
    const g = this.g;
    const c = this.c;
    const x = evalExpr(this.xExpr, env);
    const y = Number.isFinite(x) ? this.curve.f(x, env) : Number.NaN;
    const ok = Number.isFinite(y) && x >= g.x0 && x <= g.x1 && y >= g.y0 && y <= g.y1;
    // It belongs to its curve: it is there once the curve has been drawn past it, and goes when the curve goes.
    const reach = ok ? clamp((this.curve.c.p.at(t) - (x - g.x0) / (g.x1 - g.x0)) / 0.03 + 1, 0, 1) : 0;
    const o = c.o.at(t) * (1 - 0.78 * c.dim.at(t)) * reach * this.curve.c.o.at(t);
    const parts = [this.guide, this.halo, this.dot] as unknown as Styled[];
    for (const el of parts) setO(el, o);
    setO(this.pillX, o);
    setO(this.pillY, o);
    setO(this.nameEl, o);
    this.last = { x: 0, y: 0, on: false, said: '' };
    if (o <= 0.004) return;
    const px = X(g, x);
    const py = Y(g, y);
    const tone = this.tones[Math.round(c.tone.at(t))] as string;
    const sc = c.s.at(t) * (0.6 + 0.4 * reach);
    setAttr(this.guide, 'd', `M${f2(px)} ${f2(g.bottom)}V${f2(py)}H${f2(g.left)}`);
    setAttr(this.dot, 'transform', `translate(${f2(px)} ${f2(py)}) scale(${f2(sc)})`);
    const rv = c.ring.at(t);
    setAttr(this.halo, 'transform', `translate(${f2(px)} ${f2(py)}) scale(${f2(1 + (rv > 0 && rv < 1 ? 1.8 * rv : 0))})`);
    setO(this.halo as unknown as Styled, o * (rv > 0 && rv < 1 ? 1 - rv : 0.45));
    for (const el of [this.guide, this.halo, this.dot, this.pillX, this.pillY, this.nameEl]) setData(el, 'tone', tone);
    const sx = format(x, this.dp.x) + g.unitX;
    const sy = format(y, this.dp.y) + g.unitY;
    setText(this.pillX, sx);
    setText(this.pillY, sy);
    // The two read-outs sit on the axes, over the tick labels, where the guides land.
    setT(this.pillX, clamp(px - this.pillW.x / 2, 2, g.W - this.pillW.x - 2), g.bottom + 5);
    setT(this.pillY, Math.max(2, g.left - this.pillW.y - 5), clamp(py - 11, g.top - 4, g.bottom - 20));
    // The name stands off the dot, on whichever side has room.
    const right = px + 12 + this.nameW <= g.right + (g.narrow ? 6 : 0);
    const above = py - 34 >= g.top - 6;
    setT(this.nameEl, right ? px + 12 : px - 12 - this.nameW, above ? py - 34 : py + 12);
    this.last = { x: px, y: py, on: o > 0.5, said: `${sx}, ${sy}` };
  }
}

export class CurveStage extends Stage<CurveData> {
  private readonly curves: Curve[] = [];
  private readonly points: Point[] = [];
  private readonly start: Env;
  private readonly g: Geo;

  constructor(data: CurveData, env: StageEnv) {
    super(data, env);
    const { W, narrow } = this;
    const controls = (env.explore?.controls ?? []).map((c) => c.id);
    const start = (this.start = env.explore?.start ?? {});
    const grid = env.explore?.grid ?? [start];
    if (!(data.x.max > data.x.min)) throw new Error(`The x axis of this chart runs from ${data.x.min} to ${data.x.max}: it needs min below max.`);
    const exprs = data.curves.map((q) => formula(q.expr, `The curve "${q.id}"`, [...controls, 'x']));
    const x0 = data.x.min;
    const x1 = data.x.max;

    // ---- the value axis: from what the curves reach across the whole range of every slider
    let lo = Infinity;
    let hi = -Infinity;
    const scope: Record<string, number> = {};
    for (const setting of grid) {
      Object.assign(scope, setting);
      for (const e of exprs) {
        for (let i = 0; i <= 48; i++) {
          scope.x = x0 + ((x1 - x0) * i) / 48;
          const v = evalExpr(e, scope);
          if (!Number.isFinite(v)) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    if (!(hi >= lo)) {
      lo = 0;
      hi = 1;
    }
    let y0 = data.min ?? Math.min(0, lo);
    let y1 = data.max ?? hi;
    if (!(y1 > y0)) y1 = y0 + 1;
    const stepY = niceStep(y1 - y0, 5);
    if (data.min === undefined) y0 = Math.floor(y0 / stepY + 1e-9) * stepY;
    if (data.max === undefined) y1 = Math.ceil(y1 / stepY - 1e-9) * stepY;
    const stepX = niceStep(x1 - x0, narrow ? 4 : 7);
    // A value is read one figure finer than its axis is ticked, unless the numbers are large.
    const finer = (step: number, span: number): number => (span >= 100 ? decimalsOf(step) : Math.min(decimalsOf(step) + 1, Math.max(2, decimalsOf(step))));

    // ---- the plot
    const nameW = Math.max(...data.curves.map((q) => textWidth(q.label, 15, 700)));
    const left = narrow ? 46 : 76;
    const right = W - (narrow ? 18 : Math.min(240, Math.round(nameW) + 64));
    const legendY = data.yLabel ? 44 : 18;
    const top = narrow ? legendY + LEGEND_ROW * data.curves.length + 30 : data.yLabel ? 70 : 50;
    const bottom = this.floor - (narrow ? 50 : 56);
    const g: Geo = (this.g = { W, narrow, left, right, top, bottom, x0, x1, y0, y1, dpX: finer(stepX, x1 - x0), dpY: finer(stepY, y1 - y0), unitX: data.x.unit ?? '', unitY: data.unit ?? '' });

    // Fixtures: rules, ticks and titles. They never move.
    for (const v of ticks(y0, y1, stepY)) {
      const y = Math.round(Y(g, v)) + 0.5;
      this.wires.appendChild(s('path', { class: Math.abs(v - y0) < stepY * 1e-6 ? 'st-axis' : 'st-grid', d: `M${left} ${y} H${right}` }));
      const lab = this.world.appendChild(h('span', 'st-p st-tick', format(v, decimalsOf(stepY))));
      setT(lab, 0, y - 10);
      setSize(lab, left - 12, 20);
    }
    for (const v of ticks(x0, x1, stepX)) {
      const x = Math.round(X(g, v)) + 0.5;
      this.wires.appendChild(s('path', { class: 'st-tickmark', d: `M${x} ${bottom} v5` }));
      const lab = this.world.appendChild(h('span', 'st-p st-xtick', format(v, decimalsOf(stepX))));
      setT(lab, x - 50, bottom + 8);
    }
    const xTitle = this.world.appendChild(h('span', 'st-p st-xlabel', data.x.label + (data.x.unit ? ` (${data.x.unit.trim()})` : '')));
    setT(xTitle, left, bottom + 29);
    setSize(xTitle, right - left, 16);
    if (data.yLabel) {
      const lab = this.world.appendChild(h('span', 'st-p st-ylabel', data.yLabel + (data.unit ? ` (${data.unit.trim()})` : '')));
      setT(lab, narrow ? 12 : left, narrow ? 16 : 26);
    }

    // ---- the curves, clipped to the plot by a nested svg
    const plot = this.wires.appendChild(s('svg', { class: 'st-plot', x: left, y: top, width: right - left, height: bottom - top }));
    const n = Math.round(clamp((right - left) / 3, 48, 240));
    const drawn = new Set(env.drawn ?? []);
    data.curves.forEach((q, k) => {
      const cv = new Curve(q, q.tone ?? (k === 0 ? 'accent' : 'neutral'), plot, this.wires, this.world, exprs[k] as Expr, g, n, narrow ? legendY + LEGEND_ROW * k : null);
      if (drawn.has(q.id)) {
        cv.c.p.base = 0;
        cv.c.name.base = 0;
      }
      this.curves.push(this.add(cv));
    });

    // ---- the points, each on its curve
    for (const pt of data.points ?? []) {
      const on = pt.on === undefined ? this.curves[0] : this.curves.find((cv) => cv.id === pt.on);
      if (!on) throw new Error(`The point "${pt.id}" is on "${String(pt.on)}", which is not a curve of this chart.`);
      const xExpr = formula(pt.x, `The point "${pt.id}"`, controls);
      // Its two read-outs are sized for the longest value they will show, anywhere the sliders can go.
      const xs = grid.map((setting) => evalExpr(xExpr, setting));
      const ys = grid.map((setting, i) => on.f(xs[i] as number, setting));
      const inPlot = ys.map((v) => clamp(v, y0, y1));
      const dp = { x: decimalsFor(xs), y: decimalsFor(inPlot) };
      const widest = (values: number[], places: number, unit: string): number => Math.round(Math.max(28, ...values.filter((v) => Number.isFinite(v)).map((v) => textWidth(format(v, places) + unit, 12.5, 700))) + 16);
      this.points.push(this.add(new Point(pt, this.wires, this.world, xExpr, on, g, { x: widest(xs, dp.x, g.unitX), y: widest(inPlot, dp.y, g.unitY) }, dp)));
    }
  }

  /** The curves that start on stage draw themselves, one just behind another; their points follow them. */
  override intro(ctx: Ctx): void {
    let k = 0;
    for (const cv of this.curves) {
      if (cv.c.o.base !== 1 || cv.c.p.base !== 1) continue;
      cv.c.p.base = 0;
      cv.c.name.base = 0;
      const end = ctx.tw(cv.c.p, 1, { at: ctx.t + k++ * 140 * ctx.pace, d: 760, e: E.soft });
      ctx.raw(cv.c.name, 1, end - 140, 340, E.out);
    }
    this.introStats(ctx, 200);
  }

  /** draw: the curve advances at a steady pace in x, the value riding its tip. `upto` (a number on the x axis) stops it early. */
  draw(ctx: Ctx, a: ActionData): void {
    const g = this.g;
    this.ids(a).forEach((id, k) => {
      const cv = this.get(id);
      if (!(cv instanceof Curve)) throw new Error(`draw: "${id}" is not a curve of this chart.`);
      let to = 1;
      if (typeof a.upto === 'string') {
        const v = Number(a.upto.replace(/,/g, ''));
        if (!Number.isFinite(v) || v < g.x0 || v > g.x1) throw new Error(`draw: "${a.upto}" is not a value on this chart's x axis, which runs from ${g.x0} to ${g.x1}.`);
        to = (v - g.x0) / (g.x1 - g.x0);
      }
      const far = Math.abs(to - cv.c.p.end);
      const end = ctx.tw(cv.c.p, to, { at: ctx.t + k * 200 * ctx.pace, d: clamp(500 + 1300 * far, 640, 1900), e: E.soft });
      if (to >= 1) ctx.raw(cv.c.name, 1, end - 120, 340, E.out);
    });
  }

  override apply(t: number, x?: ExploreState): void {
    super.apply(t, x);
    const env = x?.env ?? this.start;
    const key = keyOf(env);
    const g = this.g;
    // Each curve's name sits at its right end; where two ends meet, the names stand clear of each other.
    const names: { cv: Curve; y: number }[] = [];
    for (const cv of this.curves) {
      const end = cv.draw(t, env, key);
      if (end !== null) names.push({ cv, y: clamp(end - 11, g.top - 2, g.bottom - 20) });
    }
    names.sort((a, b) => a.y - b.y);
    for (let i = 1; i < names.length; i++) (names[i] as { y: number }).y = Math.max((names[i] as { y: number }).y, (names[i - 1] as { y: number }).y + 24);
    for (let i = names.length - 1; i >= 0; i--) {
      const cap = i === names.length - 1 ? g.bottom - 20 : (names[i + 1] as { y: number }).y - 24;
      (names[i] as { y: number }).y = Math.min((names[i] as { y: number }).y, cap);
    }
    for (const nm of names) nm.cv.name(t, g.right + 18, nm.y);
    for (const pt of this.points) pt.draw(t, env);
  }
}
