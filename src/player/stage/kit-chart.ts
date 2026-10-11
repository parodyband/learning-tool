// Chart stage (`kind: "chart"`): bars that grow, change and trade places (`mark: "bars"`), or
// lines drawn left to right with the value riding the tip (`mark: "line"`). The third mark, a
// function plot (`mark: "curve"`), is kit-curve.ts; it is registered here with the other two.
import { format } from './explore';
import { type CurveData, CurveStage } from './kit-curve';
import {
  type ActionData,
  type Chans,
  type Ctx,
  D,
  E,
  type Live,
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
  registerKit,
  s,
  setAttr,
  setData,
  setO,
  setProp,
  setSize,
  setT,
  setText,
  stagger,
  textWidth,
  travel,
} from './kit';

interface ChartCommon {
  kind: 'chart';
  unit?: string;
  max?: number;
  yLabel?: string;
  stats?: StatData[];
}
interface BarsData extends ChartCommon {
  mark: 'bars';
  bars: { id: string; label: string; value: number; tone?: string }[];
}
interface LineData extends ChartCommon {
  mark: 'line';
  xs: string[];
  series: { id: string; label: string; values: number[]; tone?: string }[];
}

/** The next round number at or above v: 1, 2, 2.5, 5 or 10 times a power of ten. */
function nice(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v > 0 ? v : 1)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
const num = (v: number): string => (Math.abs(v) < 10 && !Number.isInteger(v) ? String(Math.round(v * 10) / 10) : Math.round(v).toLocaleString('en-US'));

type Styled = Element & { style: CSSStyleDeclaration };
/** The pitch of the rows of a narrow chart's legend, in px: tall enough for each name to be tapped on its own (kit-curve.ts has the same). */
const LEGEND_ROW = 26;

interface BarGeo {
  W: number;
  max: number;
  baseY: number;
  maxH: number;
  slotW: number;
  bw: number;
}

/** A bar: a clipping frame that never changes size, and a fill that slides up inside it (transform only, so corners never distort). */
class Bar implements Part {
  readonly id: string;
  readonly kind = 'bar';
  readonly c: Chans<'x' | 'v' | 'o' | 'dim' | 'dy' | 'tone'>;
  private readonly el: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly tintB: HTMLElement;
  private readonly val: HTMLElement;
  private readonly name: HTMLElement;
  private readonly tones: string[];
  private value: number;
  private readonly label: string;

  constructor(
    d: BarsData['bars'][number],
    world: Element,
    private readonly geo: BarGeo,
    private readonly unit: string,
    /** Decimals its value is shown with when a formula will drive it; otherwise the chart's own rounding. */
    private readonly dp: number | undefined,
  ) {
    this.id = d.id;
    this.label = d.label;
    this.el = world.appendChild(h('div', 'st-p st-bar'));
    this.fill = this.el.appendChild(h('span', 'st-bar-fill'));
    this.tintB = this.fill.appendChild(h('span', 'st-tint'));
    this.val = world.appendChild(h('span', 'st-p st-barval'));
    this.name = world.appendChild(h('span', 'st-p st-barname', d.label));
    this.tones = [d.tone ?? 'accent'];
    this.c = chans(['x', 'v', 'o', 'dim', 'dy', 'tone']);
    this.c.o.base = 1;
    this.c.v.base = d.value;
    this.value = d.value;
    setSize(this.el, geo.bw, geo.maxH);
    setSize(this.name, geo.slotW, 20);
    setSize(this.val, geo.slotW, 28);
  }
  startHidden(): void {
    this.c.o.base = 0;
    this.c.v.base = 0;
  }
  enter(ctx: Ctx, delay = 0): void {
    const at = ctx.t + delay;
    ctx.tw(this.c.o, 1, { at, d: 200, e: E.out });
    ctx.tw(this.c.v, this.value, { at, d: D.enter * 1.6, e: E.enter });
  }
  exit(ctx: Ctx, delay = 0): void {
    ctx.tw(this.c.v, 0, { at: ctx.t + delay, d: D.exit * 1.3, e: E.exit });
    ctx.tw(this.c.o, 0, { at: ctx.t + delay + 150 * ctx.pace, d: 160, e: E.exit });
  }
  pulse(ctx: Ctx, delay = 0): void {
    ctx.tw(this.c.dy, 0, { at: ctx.t + delay, d: D.pop, e: E.linear, fn: bump(-9) });
  }
  setTone(ctx: Ctx, tone: string, delay = 0): void {
    if (this.tones[this.tones.length - 1] === tone) return;
    this.tones.push(tone);
    ctx.tw(this.c.tone, this.tones.length - 1, { at: ctx.t + delay, d: D.tone, e: E.out });
  }
  setValue(ctx: Ctx, v: number | string, delay = 0): void {
    if (typeof v !== 'number') throw new Error(`A bar's value is a number; "${this.id}" was given "${v}".`);
    const g = this.geo;
    const dist = (Math.abs(v - this.c.v.end) / g.max) * g.maxH;
    this.value = v;
    ctx.tw(this.c.v, v, { at: ctx.t + delay, d: travel(D.move * 1.7, dist, g.W), e: E.move });
  }
  rest(): Rect {
    const g = this.geo;
    const hh = (clamp(this.c.v.end, 0, g.max) / g.max) * g.maxH;
    return { x: this.c.x.end, y: g.baseY - hh / 2, w: g.slotW, h: hh + 52 };
  }
  /** A bar is tapped anywhere in its column: the bar, the value over it and the name under it. */
  tap(t: number): TapBox | null {
    const g = this.geo;
    if (this.c.o.at(t) < 0.5) return null;
    const v = this.c.v.at(t);
    const hh = (clamp(v, 0, g.max) / g.max) * g.maxH;
    const top = g.baseY - hh - 36;
    const bottom = g.baseY + 30;
    return { x: this.c.x.at(t), y: (top + bottom) / 2, w: Math.min(g.slotW - 6, Math.max(g.bw + 16, 56)), h: bottom - top, label: `${this.label}: ${num(v)}${this.unit}` };
  }
  /** `live`: the height a formula gives the bar while the learner explores. */
  apply(t: number, live?: Live): void {
    const g = this.geo;
    const c = this.c;
    const o = c.o.at(t) * (1 - 0.78 * c.dim.at(t));
    const x = c.x.at(t);
    const v = live ? (Number.isFinite(live.v) ? live.v : 0) : c.v.at(t);
    const dy = c.dy.at(t);
    setO(this.el, o);
    setO(this.val, o);
    setO(this.name, o);
    const hh = (clamp(v, 0, g.max) / g.max) * g.maxH;
    setT(this.el, x - g.bw / 2, g.baseY - g.maxH + dy);
    setT(this.fill, 0, g.maxH - hh);
    setT(this.val, x - g.slotW / 2, g.baseY - hh - 34 + dy);
    setT(this.name, x - g.slotW / 2, g.baseY + 9);
    setText(this.val, (live ? live.s : this.dp !== undefined ? format(v, this.dp) : num(v)) + this.unit);
    setData(this.val, 'live', live ? '1' : '0');
    const tv = c.tone.at(t);
    const last = this.tones.length - 1;
    const ti = Math.min(last, Math.floor(tv + 1e-6));
    setData(this.fill, 'tone', this.tones[ti] as string);
    setData(this.tintB, 'tone', this.tones[Math.min(last, ti + 1)] as string);
    setO(this.tintB, tv - ti);
    setData(this.val, 'tone', this.tones[Math.round(tv)] as string);
  }
}

export class BarsStage extends Stage<BarsData> {
  private readonly geo: BarGeo;
  private readonly pad: number;
  private readonly slotOf = new Map<string, number>();

  constructor(data: BarsData, env: StageEnv) {
    super(data, env);
    const { W, narrow } = this;
    const n = data.bars.length;
    const pad = (this.pad = narrow ? 10 : Math.max(40, Math.round((W - Math.min(W - 80, n * 230)) / 2)));
    let max = data.max ?? 0;
    if (!data.max) {
      for (const b of data.bars) max = Math.max(max, b.value);
      for (const v of env.values) max = Math.max(max, v);
      // A bar the learner will drive has room for the tallest it can get, so the scale never changes under a slider.
      for (const b of data.bars) for (const v of env.explore?.samples.get(b.id) ?? []) if (Number.isFinite(v)) max = Math.max(max, v);
      // The tallest bar nearly fills the plot: there are no tick labels to round for.
      max *= 1.06;
    }
    if (!(max > 0)) max = 1;
    const baseY = this.floor - 38;
    const top = data.yLabel ? 76 : 54;
    const slotW = (W - 2 * pad) / n;
    this.geo = { W, max, baseY, maxH: Math.max(40, baseY - top), slotW, bw: Math.round(clamp(slotW * 0.56, 12, 132)) };
    // Fixtures: the baseline and three quiet rules. They never move.
    for (let k = 1; k <= 3; k++) {
      const y = Math.round(baseY - (this.geo.maxH * k) / 3) + 0.5;
      this.wires.appendChild(s('path', { class: 'st-grid', d: `M${pad} ${y} H${W - pad}` }));
    }
    this.wires.appendChild(s('path', { class: 'st-axis', d: `M${pad} ${baseY + 0.5} H${W - pad}` }));
    if (data.yLabel) {
      const lab = this.world.appendChild(h('span', 'st-p st-ylabel', data.yLabel));
      setT(lab, pad, 22);
    }
    data.bars.forEach((b, i) => {
      const bar = this.add(new Bar(b, this.world, this.geo, data.unit ?? '', env.explore?.dp.get(b.id)));
      bar.c.x.base = this.slotX(i);
      this.slotOf.set(b.id, i);
    });
  }
  private slotX(i: number): number {
    return this.pad + this.geo.slotW * (i + 0.5);
  }
  override intro(ctx: Ctx): void {
    const bars = this.d.bars.map((b) => this.get(b.id) as Bar).filter((b) => b.c.o.base === 1);
    const st = stagger(bars.length) * 1.3 * ctx.pace;
    bars.forEach((b, i) => {
      b.startHidden();
      b.enter(ctx, i * st);
    });
    this.introStats(ctx, 260);
  }
  /** reorder: bars slide to their new slots, hopping a little so crossing bars read as passing, not merging. */
  reorder(ctx: Ctx, a: ActionData): void {
    const order = Array.isArray(a.order) ? (a.order as string[]) : [];
    if (order.length !== this.slotOf.size || new Set(order).size !== order.length || order.some((id) => !this.slotOf.has(id))) {
      throw new Error('reorder: "order" must name every bar of the chart exactly once.');
    }
    const st = stagger(order.length) * 0.8 * ctx.pace;
    let k = 0;
    order.forEach((id, i) => {
      const from = this.slotOf.get(id) as number;
      if (from === i) return;
      const b = this.get(id) as Bar;
      const at = ctx.t + k++ * st;
      const d = travel(D.swap, Math.abs(this.slotX(i) - b.c.x.end), this.W);
      ctx.tw(b.c.x, this.slotX(i), { at, d, e: E.move });
      ctx.tw(b.c.dy, 0, { at, d, e: E.linear, fn: bump(i < from ? -14 : -5) });
      this.slotOf.set(id, i);
    });
  }
}

/** A series: one polyline drawn by x position, a dot riding the tip, and the value at the tip. */
class Series implements Part {
  readonly id: string;
  readonly kind = 'series';
  readonly c: Chans<'p' | 'o' | 'dim' | 'name'>;
  readonly pts: { x: number; y: number }[];
  private readonly label: string;
  private readonly values: number[];
  private readonly area: SVGElement;
  private readonly path: SVGElement;
  private readonly dot: SVGElement;
  private readonly val: HTMLElement;
  private readonly name: HTMLElement;
  private readonly cum: number[] = [0];

  constructor(
    d: LineData['series'][number],
    tone: string,
    wires: Element,
    world: Element,
    pts: { x: number; y: number }[],
    private readonly unit: string,
    private readonly nameAt: { x: number; y: number; align: 'left' | 'right' },
    private readonly baseY: number,
    private readonly W: number,
  ) {
    this.id = d.id;
    this.label = d.label;
    this.pts = pts;
    this.values = d.values;
    // Under the line, a wash of its colour down to the baseline: it grows with the line.
    this.area = wires.appendChild(s('path', { class: 'st-area', d: 'M0 0' }));
    this.area.setAttribute('data-tone', tone);
    this.path = wires.appendChild(s('path', { class: 'st-series', pathLength: '1', d: `M${pts.map((p) => `${p.x} ${p.y}`).join(' L')}` }));
    this.dot = wires.appendChild(s('circle', { class: 'st-tip', r: 7 }));
    this.path.setAttribute('data-tone', tone);
    this.dot.setAttribute('data-tone', tone);
    this.val = world.appendChild(h('span', 'st-p st-tipval'));
    this.val.setAttribute('data-tone', tone);
    this.name = world.appendChild(h('span', 'st-p st-seriesname', d.label));
    this.name.setAttribute('data-tone', tone);
    this.name.setAttribute('data-align', nameAt.align);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as { x: number; y: number };
      const b = pts[i] as { x: number; y: number };
      this.cum[i] = (this.cum[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y);
    }
    this.c = chans(['p', 'o', 'dim', 'name']);
    this.c.o.base = 1;
  }
  /** A line that has been drawn is offered by its name, or by its tip while it has no name yet. */
  tap(t: number): TapBox | null {
    const c = this.c;
    if (c.o.at(t) < 0.5 || c.p.at(t) <= 0.001) return null;
    if (c.name.at(t) > 0.5) {
      const w = Math.round(textWidth(this.label, 15, 700) + 30);
      return { x: this.nameAt.x + w / 2, y: this.nameAt.y + 11, w, h: this.nameAt.align === 'left' && this.nameAt.x < 20 ? LEGEND_ROW - 2 : 32, label: this.label };
    }
    const lastI = this.pts.length - 1;
    const p = clamp(c.p.at(t), 0, lastI);
    const i = Math.min(lastI - 1, Math.floor(p));
    const a = this.pts[i] as { x: number; y: number };
    const b = this.pts[i + 1] as { x: number; y: number };
    return { x: a.x + (b.x - a.x) * (p - i), y: a.y + (b.y - a.y) * (p - i) - 12, w: 100, h: 60, label: this.label };
  }
  rest(): Rect {
    const xs = this.pts.map((p) => p.x);
    const ys = this.pts.map((p) => p.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 + 30 };
  }
  apply(t: number): void {
    const c = this.c;
    const lastI = this.pts.length - 1;
    const p = clamp(c.p.at(t), 0, lastI);
    const i = Math.min(lastI - 1, Math.floor(p));
    const f = p - i;
    const a = this.pts[i] as { x: number; y: number };
    const b = this.pts[i + 1] as { x: number; y: number };
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;
    const total = this.cum[lastI] as number;
    const len = total > 0 ? ((this.cum[i] as number) + ((this.cum[i + 1] as number) - (this.cum[i] as number)) * f) / total : 1;
    const o = c.o.at(t) * (1 - 0.78 * c.dim.at(t));
    const on = p > 0.001 ? o : 0;
    setProp(this.path as unknown as Styled, 'stroke-dashoffset', String(Math.round((1 - len) * 10000) / 10000));
    let wash = `M${(this.pts[0] as { x: number }).x} ${this.baseY}`;
    for (let q = 0; q <= i; q++) wash += ` L${(this.pts[q] as { x: number }).x} ${(this.pts[q] as { y: number }).y}`;
    setAttr(this.area, 'd', `${wash} L${f2(x)} ${f2(y)} L${f2(x)} ${this.baseY} Z`);
    setO(this.area as unknown as Styled, on);
    setO(this.path as unknown as Styled, on);
    setO(this.dot as unknown as Styled, on);
    setO(this.val, on);
    setAttr(this.dot, 'transform', `translate(${f2(x)} ${f2(y)})`);
    // The value rides above the tip, and stays on the stage when the tip reaches its edge.
    setT(this.val, clamp(x - 50, 2, this.W - 102), y - 40);
    const va = this.values[i] as number;
    const vb = this.values[i + 1] as number;
    setText(this.val, num(va + (vb - va) * f) + this.unit);
    const nv = c.name.at(t);
    setO(this.name, nv * o);
    setT(this.name, this.nameAt.x, this.nameAt.y + (1 - nv) * 8);
  }
}

export class LineStage extends Stage<LineData> {
  private readonly xIndex: Map<string, number>;

  constructor(data: LineData, env: StageEnv) {
    super(data, env);
    const { W, narrow } = this;
    const n = data.xs.length;
    for (const q of data.series) {
      if (q.values.length !== n) throw new Error(`The series "${q.id}" has ${q.values.length} values for ${n} x positions; it needs one for each.`);
    }
    const nameW = Math.max(...data.series.map((q) => textWidth(q.label, 15, 700)));
    const left = narrow ? 48 : 76;
    const right = W - (narrow ? 30 : Math.min(230, Math.round(nameW) + 44));
    // On a narrow stage the names are a small legend above the plot, so the plot starts lower.
    const legendY = data.yLabel ? 44 : 18;
    // A row of the legend is tall enough to be tapped on its own (a tap gate offers a line by its name).
    const top = narrow ? legendY + LEGEND_ROW * data.series.length + 30 : data.yLabel ? 64 : 44;
    const bottom = this.floor - 34;
    const max = data.max ?? nice(Math.max(1e-9, ...data.series.flatMap((q) => q.values)) * 1.04);
    const X = (i: number): number => left + ((right - left) * i) / Math.max(1, n - 1);
    const Y = (v: number): number => bottom - ((bottom - top) * v) / max;
    for (let k = 0; k <= 4; k++) {
      const y = Math.round(Y((max * k) / 4)) + 0.5;
      this.wires.appendChild(s('path', { class: k ? 'st-grid' : 'st-axis', d: `M${left} ${y} H${right}` }));
      const lab = this.world.appendChild(h('span', 'st-p st-tick', num((max * k) / 4)));
      setT(lab, 0, y - 10);
      setSize(lab, left - 12, 20);
    }
    const every = Math.ceil(n / (narrow ? 4 : 8));
    data.xs.forEach((label, i) => {
      if (i % every && i !== n - 1) return;
      if (i !== n - 1 && n - 1 - i < every * 0.6) return;
      const lab = this.world.appendChild(h('span', 'st-p st-xtick', label));
      setT(lab, X(i) - 50, bottom + 10);
    });
    if (data.yLabel) {
      const lab = this.world.appendChild(h('span', 'st-p st-ylabel', data.yLabel + (data.unit ? ` (${data.unit.trim()})` : '')));
      setT(lab, narrow ? 12 : left, narrow ? 16 : 22);
    }
    data.series.forEach((q, k) => {
      const pts = q.values.map((v, i) => ({ x: Math.round(X(i) * 10) / 10, y: Math.round(Y(v) * 10) / 10 }));
      const end = pts[pts.length - 1] as { x: number; y: number };
      // The name sits at the end of its line where there is a margin for it (clear of the axis
      // labels), and in the top corner on a narrow stage.
      const nameAt = narrow ? { x: 12, y: legendY + LEGEND_ROW * k, align: 'left' as const } : { x: end.x + 16, y: Math.min(end.y - 11, bottom - 14), align: 'left' as const };
      this.add(new Series(q, q.tone ?? (k === 0 ? 'accent' : 'neutral'), this.wires, this.world, pts, data.unit ?? '', nameAt, Math.round(Y(0)), W));
    });
    this.xIndex = new Map(data.xs.map((x, i) => [x, i]));
  }
  override hideAtStart(ids: readonly string[]): void {
    super.hideAtStart(ids.filter((id) => !(this.parts.get(id) instanceof Series)));
  }
  override intro(ctx: Ctx): void {
    this.introStats(ctx, 120);
  }
  /** draw: the line advances at a steady pace in x, so equal time means equal steps along the axis. `upto` stops it early. */
  draw(ctx: Ctx, a: ActionData): void {
    this.ids(a).forEach((id, k) => {
      const sr = this.get(id);
      if (!(sr instanceof Series)) throw new Error(`draw: "${id}" is not a series of this chart.`);
      const to = typeof a.upto === 'string' ? this.xIndex.get(a.upto) : sr.pts.length - 1;
      if (to === undefined) throw new Error(`draw: "${String(a.upto)}" is not an x position of this chart.`);
      const segs = Math.abs(to - sr.c.p.end);
      const end = ctx.tw(sr.c.p, to, { at: ctx.t + k * 200 * ctx.pace, d: clamp(440 + segs * 240, 640, 2400), e: E.soft });
      if (to === sr.pts.length - 1) ctx.raw(sr.c.name, 1, end - 120, 340, E.out);
    });
  }
}

registerKit('chart', (data: BarsData | LineData | CurveData, env) => (data.mark === 'curve' ? new CurveStage(data, env) : data.mark === 'line' ? new LineStage(data, env) : new BarsStage(data, env)));
