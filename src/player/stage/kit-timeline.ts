// The `timeline` stage: ordered moments along a track, optionally in two or three parallel lanes.
//
// What it can show, all through the shared verbs:
//   draw    the track draws itself ("track", or a lane id), and each event it passes arrives as the
//           tip reaches it; `upto` stops at an event. A track that no `draw` names draws itself
//           when the clip opens, as far as the first event a later `show` will bring.
//   show    events arrive in order: the track runs on to each one, its dot lands, its words rise.
//           A span grows from its first event to its last.
//   move    a marker travels along the track to an event, leaving the stretch behind it marked as
//           passed; a span slides to another pair of events.
//   focus   the named events (or `between: [first, last]`, or a lane, or a span) stay lit and the
//           rest recede; one event alone in focus also shows its `detail`.
//   set     an event, span, marker or lane takes a tone; `label` rewrites an event or a span.
//   hide, pulse  as on every stage.
//
// Layout. Wide: the track runs left to right. One track: events hang above it (above and below by
// turns when there are five or more and nothing else needs the space below). Lanes: one track per
// lane, stacked, and events that follow one another with the same `when` in different lanes share
// a place, so the lanes read against one axis. Narrow, or when the words would not fit: the track
// turns vertical, one row per event, and when the rows are taller than the stage they scroll
// through a window that follows whatever the clip is talking about.
import {
  type ActionData,
  Chan,
  type Ctx,
  D,
  E,
  type Ease,
  type ExploreState,
  type Part,
  type Rect,
  Stage,
  type StageEnv,
  type TapBox,
  Wire,
  bezier,
  bump,
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
  textWidth,
  travel,
} from './kit';
import type { TimelineStage as TimelineData } from '../../core/clip-kits-extra';

/** The height the stage's provenance badge takes at the top of the stage (css/stage.css, .lt-prov), with its margin. */
const BADGE_H = 46;
/** The id that names every lane at once in a `draw`. */
const TRACK = 'track';
/** Travel with weight: a little anticipation, a little overshoot, then rest. */
const HEAVY: Ease = bezier(0.6, -0.12, 0.28, 1.12);

type EventData = TimelineData['events'][number];
type Along = (f: number) => number;

function pairOf(v: unknown): [string, string] | null {
  return Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string' ? [v[0], v[1]] : null;
}
/** How many rows a text takes in a column `w` wide, with a margin for the break points a browser chooses. */
function rowsOf(text: string, px: number, weight: number, w: number): number {
  return Math.max(1, Math.ceil((textWidth(text, px, weight) * 1.08) / Math.max(24, w)));
}

/** A text that can be rewritten where it stands: the old words dip out, the new ones come up. */
class Swap {
  readonly texts: string[];
  readonly ti = new Chan(0);
  constructor(
    private readonly el: HTMLElement,
    text: string,
  ) {
    this.texts = [text];
    el.textContent = text;
  }
  set(ctx: Ctx, text: string, delay: number): void {
    if (this.texts[this.texts.length - 1] === text) return;
    this.texts.push(text);
    ctx.tw(this.ti, this.texts.length - 1, { at: ctx.t + delay, d: D.tone, e: E.move });
  }
  apply(t: number): void {
    const v = this.ti.at(t);
    const i = Math.min(this.texts.length - 1, Math.floor(v + 1e-6));
    const f = v - i;
    setText(this.el, this.texts[f < 0.5 ? i : Math.min(this.texts.length - 1, i + 1)] as string);
    setO(this.el, Math.abs(Math.cos(Math.PI * f)));
    setT(this.el, 0, f < 0.5 ? -8 * f : 8 * (1 - f));
  }
}

/** The tone a part shows at time t: tones are a list, and a channel says how far along it the part is. */
class Tones {
  readonly list: string[];
  readonly at = new Chan(0);
  constructor(first: string) {
    this.list = [first];
  }
  set(ctx: Ctx, tone: string, delay: number): boolean {
    if (this.list[this.list.length - 1] === tone) return false;
    this.list.push(tone);
    this.at.to(this.list.length - 1, ctx.t + delay + 90 * ctx.pace, 0);
    return true;
  }
  now(t: number): string {
    return this.list[Math.round(this.at.at(t))] as string;
  }
}

// ---------------------------------------------------------------------------------------------
// A lane: the track itself, and its name
// ---------------------------------------------------------------------------------------------
class Lane implements Part {
  readonly id: string;
  readonly kind = 'lane';
  /** draw: how far the track has been drawn (0..1), by `draw` and `show`. intro: how far the opening drew it. */
  readonly c = { draw: new Chan(0), intro: new Chan(0), o: new Chan(1), dim: new Chan(0) };
  /** The opening draws this track. Cleared by the first `draw` that names it: that draw is then the whole story. */
  auto = true;
  readonly wire: Wire;
  readonly tones: Tones;
  private readonly done: SVGElement;
  private readonly name: HTMLElement | null;
  /** Wide, with lanes: a faint band that gives each lane its own ground. */
  band: HTMLElement | null = null;

  constructor(id: string, svg: Element, tone: string, name: HTMLElement | null) {
    this.id = id;
    this.wire = new Wire(`${id}~wire`, svg, 'st-tl-track');
    this.done = svg.appendChild(s('path', { class: 'st-tl-done', d: 'M0 0' }));
    this.tones = new Tones(tone);
    this.name = name;
  }
  /** How far along (0..1) the track is drawn at time t. */
  drawn(t: number): number {
    const d = this.c.draw.at(t);
    return this.auto ? Math.max(d, this.c.intro.at(t)) : d;
  }
  /** As `drawn`, once everything scheduled so far has played. */
  get reach(): number {
    return this.auto ? Math.max(this.c.draw.end, this.c.intro.end) : this.c.draw.end;
  }
  /** Run the track on to `q` (0..1), from wherever it has got to. Returns when the tip arrives. */
  extend(ctx: Ctx, q: number, at: number, px: number, W: number): number {
    const from = this.reach;
    if (q <= from + 1e-4) return at;
    // The opening's share is taken over by the draw channel from here on, so the two never have to be added.
    if (this.c.draw.end < from) this.c.draw.to(from, at, 0);
    return ctx.tw(this.c.draw, q, { at, d: travel(D.draw, (q - from) * px, W) * 1.15, e: E.soft });
  }
  setTone(ctx: Ctx, tone: string, delay = 0): void {
    this.tones.set(ctx, tone, delay);
  }
  exit(ctx: Ctx, delay = 0): void {
    ctx.tw(this.c.o, 0, { at: ctx.t + delay, d: D.exit, e: E.exit });
  }
  enter(ctx: Ctx, delay = 0): void {
    ctx.tw(this.c.o, 1, { at: ctx.t + delay, d: D.enter * 0.5, e: E.out });
  }
  rest(): Rect {
    return this.wire.rest();
  }
  /** `passed`: how far along (0..1) a marker has come, or -1 for none; `passedO`: that marker's opacity. */
  draw(t: number, passed: number, passedO: number): void {
    const d = this.drawn(t);
    const w = this.wire;
    w.c.draw.base = d;
    w.c.o.base = this.c.o.at(t);
    w.c.dim.base = this.c.dim.at(t);
    w.apply(t);
    const tone = this.tones.now(t);
    setData(w.path, 'tone', tone);
    setData(w.head, 'tone', tone);
    const o = this.c.o.at(t) * (1 - 0.78 * this.c.dim.at(t));
    if (this.name) setO(this.name, o * clamp(d * 12, 0, 1));
    if (this.band) setO(this.band, o * clamp(d * 8, 0, 1));
    const p = Math.min(d, passed);
    const { a, b } = w.geo;
    setO(this.done as unknown as HTMLElement, p > 0.002 ? o * passedO : 0);
    if (p > 0.002) setAttr(this.done, 'd', `M${f2(a.x)} ${f2(a.y)} L${f2(a.x + (b.x - a.x) * p)} ${f2(a.y + (b.y - a.y) * p)}`);
  }
  apply(): void {
    // Drawn by the stage (it knows where the marker is): see TimelineStage.apply.
  }
}

// ---------------------------------------------------------------------------------------------
// An event: a dot on the track, a stem, and a card of words
// ---------------------------------------------------------------------------------------------
interface MomentBox {
  /** Each dot's centre: one, or one per lane for an event that spans the lanes. */
  dots: { x: number; y: number }[];
  /** The bar joining the dots of an event that spans the lanes. */
  bar: { x: number; y: number; w: number; h: number } | null;
  /** The line from the dot to the card: where it starts, how long, and which way it runs. */
  stem: { x: number; y: number; len: number; dir: 'up' | 'down' | 'right' };
  /** The card's box, with no detail showing; and the height the detail adds. */
  card: Rect;
  detailH: number;
  /** Which way the card comes from as it arrives, and which edge stays put when the detail opens. */
  side: 'above' | 'below' | 'right';
  /** The size of the `when` and the label, in px. */
  whenPx: number;
  labelPx: number;
  showWhen: boolean;
}

class Moment implements Part {
  readonly id: string;
  readonly kind = 'event';
  /**
   * rev: how far the arrival has got (0..1), by `show` and `draw`. intro: the same, by the opening.
   * lit: in the spotlight. det: the detail is open. ping: one ring leaving the dot.
   */
  readonly c = { rev: new Chan(0), intro: new Chan(0), o: new Chan(1), dim: new Chan(0), s: new Chan(1), lit: new Chan(0), det: new Chan(0), ping: new Chan(0) };
  readonly place: number;
  readonly lanes: Lane[];
  readonly box: MomentBox;
  readonly hasDetail: boolean;
  /** Not on stage until something brings it: a `show` names it. */
  later = false;
  private readonly el: HTMLElement;
  private readonly dots: HTMLElement[];
  private readonly pings: HTMLElement[];
  private readonly stem: HTMLElement;
  private readonly card: HTMLElement;
  private readonly plate: HTMLElement;
  private readonly detail: HTMLElement | null;
  private readonly label: Swap;
  private readonly tones: Tones;
  private readonly origin: (t?: number) => { x: number; y: number };
  /** What the event is called: its `when` and its words. */
  private readonly name: string;

  constructor(d: EventData, place: number, lanes: Lane[], box: MomentBox, parent: Element, origin: Moment['origin']) {
    this.id = d.id;
    this.name = `${d.when}: ${d.label}`;
    this.place = place;
    this.lanes = lanes;
    this.box = box;
    this.origin = origin;
    this.tones = new Tones(d.tone ?? 'neutral');
    this.el = parent.appendChild(h('div', 'st-p st-tl-ev'));
    this.el.dataset.side = box.side;
    if (box.dots.length > 1) this.el.dataset.cross = 'true';
    if (box.bar) {
      const bar = this.el.appendChild(h('span', 'st-p st-tl-bar'));
      setT(bar, box.bar.x, box.bar.y);
      setSize(bar, box.bar.w, box.bar.h);
    }
    this.stem = this.el.appendChild(h('span', 'st-p st-tl-stem'));
    const st = box.stem;
    if (st.dir === 'right') setSize(this.stem, st.len, 2);
    else setSize(this.stem, 2, st.len);
    this.dots = box.dots.map(() => this.el.appendChild(h('span', 'st-p st-tl-dot')));
    this.pings = this.dots.map((dot) => dot.appendChild(h('span', 'st-tl-ping')));
    this.card = this.el.appendChild(h('div', 'st-p st-tl-card'));
    this.plate = this.card.appendChild(h('span', 'st-tl-plate'));
    if (box.showWhen) {
      const when = this.card.appendChild(h('span', 'st-tl-when', d.when));
      when.style.fontSize = `${box.whenPx}px`;
    }
    const lab = this.card.appendChild(h('span', 'st-tl-label'));
    lab.style.fontSize = `${box.labelPx}px`;
    this.label = new Swap(lab.appendChild(h('span', 'st-tl-words')), d.label);
    this.hasDetail = d.detail !== undefined;
    this.detail = d.detail === undefined ? null : this.card.appendChild(h('span', 'st-tl-detail', d.detail));
  }
  /** The opening may bring this event only while it draws every track the event sits on. */
  private get auto(): boolean {
    return !this.later && this.lanes.every((l) => l.auto);
  }
  /** How far the arrival has got at time t (0..1). */
  shown(t: number): number {
    const r = this.c.rev.at(t);
    return this.auto ? Math.max(r, this.c.intro.at(t)) : r;
  }
  get onStage(): boolean {
    return (this.auto ? Math.max(this.c.rev.end, this.c.intro.end) : this.c.rev.end) > 0.5 && this.c.o.end > 0.5;
  }
  startHidden(): void {
    this.later = true;
  }
  /** Arrive: the dot lands, the stem grows out of it, the words rise. `intro`: on the opening's own channel. */
  arrive(ctx: Ctx, at: number, intro = false): number {
    const chan = intro ? this.c.intro : this.c.rev;
    if (!intro) {
      chan.to(0, at, 0);
      this.c.o.to(1, at, 0);
    }
    const end = ctx.tw(chan, 1, { at, d: 640, e: E.linear });
    if (!intro) this.ring(ctx, at - ctx.t + 120 * ctx.pace);
    return end;
  }
  enter(ctx: Ctx, delay = 0): void {
    this.arrive(ctx, ctx.t + delay);
  }
  exit(ctx: Ctx, delay = 0): void {
    ctx.tw(this.c.o, 0, { at: ctx.t + delay, d: D.exit, e: E.exit });
  }
  ring(ctx: Ctx, delay = 0): void {
    const at = ctx.t + delay;
    this.c.ping.to(0, at, 0);
    ctx.tw(this.c.ping, 1, { at, d: D.ring, e: E.out });
  }
  pulse(ctx: Ctx, delay = 0, amount = 0.22): void {
    const at = ctx.t + delay;
    ctx.tw(this.c.s, this.c.s.at(at), { at, d: D.pop, e: E.linear, fn: bump(amount) });
    if (amount > 0) this.ring(ctx, delay);
  }
  setTone(ctx: Ctx, tone: string, delay = 0): void {
    if (this.tones.set(ctx, tone, delay)) this.pulse(ctx, delay, 0.18);
  }
  setValue(ctx: Ctx, value: number | string, delay = 0): void {
    this.label.set(ctx, String(value), delay);
  }
  /** In the spotlight or out of it; `detail`: also open the extra sentence. */
  light(ctx: Ctx, on: boolean, detail: boolean): void {
    const c = this.c;
    if (c.lit.end !== (on ? 1 : 0)) ctx.tw(c.lit, on ? 1 : 0, { d: D.dim, e: E.out });
    const det = on && detail && this.hasDetail ? 1 : 0;
    if (c.det.end !== det) ctx.tw(c.det, det, { at: ctx.t + (det ? 120 * ctx.pace : 0), d: D.move, e: E.move });
  }
  /** An event that has arrived is tapped on its card and its dot. */
  tap(t: number): TapBox | null {
    if (this.shown(t) < 0.5 || this.c.o.at(t) < 0.5) return null;
    const end = this.origin();
    const now = this.origin(t);
    const r = this.rest();
    return { x: r.x - end.x + now.x, y: r.y - end.y + now.y, w: r.w - 8, h: r.h - 8, label: this.name };
  }
  rest(): Rect {
    const { card, dots } = this.box;
    const o = this.origin();
    const xs = [card.x - card.w / 2, card.x + card.w / 2, ...dots.map((d) => d.x)];
    const ys = [card.y - card.h / 2, card.y + card.h / 2, ...dots.map((d) => d.y)];
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    return { x: (x0 + x1) / 2 + o.x, y: (y0 + y1) / 2 + o.y, w: x1 - x0 + 16, h: y1 - y0 + 16 };
  }
  apply(t: number): void {
    const c = this.c;
    const rev = this.shown(t);
    const o = rev <= 0.001 ? 0 : c.o.at(t) * (1 - 0.78 * c.dim.at(t));
    setO(this.el, o);
    if (o <= 0.004) return;
    const b = this.box;
    const lit = c.lit.at(t);
    const dotU = E.pop(clamp(rev / 0.42, 0, 1));
    const stemU = E.out(clamp((rev - 0.18) / 0.4, 0, 1));
    const cardU = clamp((rev - 0.3) / 0.7, 0, 1);
    const cardE = E.enter(cardU);
    const sc = dotU * c.s.at(t) * (1 + 0.3 * lit);
    const pv = c.ping.at(t);
    const po = pv <= 0 || pv >= 1 ? 0 : 0.6 * (1 - pv);
    b.dots.forEach((d, i) => {
      setT(this.dots[i] as HTMLElement, d.x, d.y, sc);
      setO(this.pings[i] as HTMLElement, po);
      if (po > 0) setT(this.pings[i] as HTMLElement, 0, 0, 1 + 2.4 * pv);
    });
    const st = b.stem;
    if (st.dir === 'right') setT(this.stem, st.x, st.y - 1, stemU, 0, 1);
    else setT(this.stem, st.x - 1, st.dir === 'up' ? st.y - st.len : st.y, 1, 0, stemU);
    // The card: comes from the track's side, and grows away from the track when its detail opens.
    const det = c.det.at(t);
    const hh = b.card.h + b.detailH * det;
    const away = 12 * (1 - cardE);
    const top = b.card.y - b.card.h / 2 - (b.side === 'above' ? b.detailH * det : 0);
    setO(this.card, Math.min(1, cardU * 2.2));
    setSize(this.card, b.card.w, hh);
    setT(this.card, b.card.x - b.card.w / 2 + (b.side === 'right' ? -away : 0), top + (b.side === 'above' ? away : b.side === 'below' ? -away : 0), 1 + 0.03 * lit);
    setO(this.plate, lit);
    if (this.detail) {
      setO(this.detail, clamp(det * 1.6 - 0.6, 0, 1));
      // A card above the track keeps its words against the stem; the detail opens under them, so they are lifted by its height.
      if (b.side === 'above') setProp(this.card, 'padding-bottom', `${f2(b.detailH * det)}px`);
    }
    this.label.apply(t);
    setData(this.el, 'tone', this.tones.now(t));
    setData(this.el, 'lit', lit > 0.5 ? '1' : '0');
  }
}

// ---------------------------------------------------------------------------------------------
// A marker: "now". It travels along the track.
// ---------------------------------------------------------------------------------------------
class Marker implements Part {
  readonly id: string;
  readonly kind = 'marker';
  /** f: the (fractional) place it is at. cr: where across the lanes its ring sits. sq: stretch along the direction of travel while it moves. */
  readonly c = { f: new Chan(0), cr: new Chan(0), o: new Chan(0), s: new Chan(1), sq: new Chan(0) };
  hud = true;
  private readonly el: HTMLElement;
  private readonly ring: HTMLElement;
  /** With lanes: what says "the same moment" across them. Vertical: one line across the tracks. Wide: a tick on each track, because a line down the lanes would run through the events' words. */
  private readonly line: HTMLElement | null;
  private readonly ticks: HTMLElement[];
  private readonly tab: HTMLElement | null;
  private readonly label: Swap | null;
  private readonly tones: Tones;
  private readonly geo: { along: Along; lanes: number[]; vertical: boolean; origin: () => { x: number; y: number } };

  constructor(d: NonNullable<TimelineData['markers']>[number], parent: Element, geo: Marker['geo'], withTab: boolean) {
    this.id = d.id;
    this.geo = geo;
    this.tones = new Tones(d.tone ?? 'accent');
    this.el = parent.appendChild(h('div', 'st-p st-tl-mk'));
    this.line = geo.lanes.length > 1 && geo.vertical ? this.el.appendChild(h('span', 'st-p st-tl-mk-line')) : null;
    this.ticks = geo.lanes.length > 1 && !geo.vertical ? geo.lanes.map(() => this.el.appendChild(h('span', 'st-p st-tl-mk-line'))) : [];
    for (const tick of this.ticks) setSize(tick, 3, 30);
    this.ring = this.el.appendChild(h('span', 'st-p st-tl-mk-ring'));
    this.c.cr.base = geo.lanes[0] ?? 0;
    this.tab = d.label && withTab ? this.el.appendChild(h('span', 'st-p st-tl-mk-tab')) : null;
    this.label = this.tab ? new Swap(this.tab.appendChild(h('span', 'st-tl-words')), d.label ?? '') : null;
  }
  get onStage(): boolean {
    return this.c.o.end > 0.5;
  }
  /** Go to a place, the ring to `cross` (its event's own track). The first time it lands there; after that it travels, stretched along its path, and settles. Returns when it arrives. */
  go(ctx: Ctx, place: number, cross: number, W: number): number {
    const c = this.c;
    if (!this.onStage) {
      c.f.to(place, ctx.t, 0);
      c.cr.to(cross, ctx.t, 0);
      c.s.to(0.4, ctx.t, 0);
      ctx.tw(c.o, 1, { d: D.enter * 0.4, e: E.out });
      return ctx.tw(c.s, 1, { d: D.enter, e: E.pop });
    }
    const dist = Math.hypot(this.geo.along(place) - this.geo.along(c.f.end), cross - c.cr.end);
    if (dist < 0.5) return ctx.t;
    const d = travel(D.send, dist, W);
    const end = ctx.tw(c.f, place, { d, e: HEAVY });
    ctx.tw(c.cr, cross, { d, e: E.move });
    ctx.tw(c.sq, 0, { d, e: E.soft, fn: bump(1) });
    ctx.tw(c.s, 1, { at: end - 140 * ctx.pace, d: 320, e: E.linear, fn: bump(0.16) });
    return end;
  }
  enter(ctx: Ctx, delay = 0): void {
    const at = ctx.t + delay;
    this.c.s.to(0.4, at, 0);
    ctx.tw(this.c.o, 1, { at, d: D.enter * 0.4, e: E.out });
    ctx.tw(this.c.s, 1, { at, d: D.enter, e: E.pop });
  }
  exit(ctx: Ctx, delay = 0): void {
    ctx.tw(this.c.o, 0, { at: ctx.t + delay, d: D.exit, e: E.exit });
  }
  pulse(ctx: Ctx, delay = 0, amount = 0.2): void {
    const at = ctx.t + delay;
    ctx.tw(this.c.s, this.c.s.at(at), { at, d: D.pop, e: E.linear, fn: bump(amount) });
  }
  setTone(ctx: Ctx, tone: string, delay = 0): void {
    if (this.tones.set(ctx, tone, delay)) this.pulse(ctx, delay);
  }
  setValue(ctx: Ctx, value: number | string, delay = 0): void {
    this.label?.set(ctx, String(value), delay);
  }
  rest(): Rect {
    const g = this.geo;
    const o = g.origin();
    const p = g.along(this.c.f.end);
    const a = Math.min(...g.lanes);
    const b = Math.max(...g.lanes);
    return g.vertical ? { x: (a + b) / 2 + o.x, y: p + o.y, w: b - a + 30, h: 30 } : { x: p + o.x, y: (a + b) / 2 + o.y, w: 30, h: b - a + 30 };
  }
  apply(t: number): void {
    const c = this.c;
    const o = c.o.at(t);
    setO(this.el, o);
    if (o <= 0.004) return;
    const g = this.geo;
    const p = g.along(c.f.at(t));
    const sc = c.s.at(t);
    const sq = 1 + 0.4 * c.sq.at(t);
    const cross = c.cr.at(t);
    if (g.vertical) setT(this.ring, cross, p, sc, 0, sc * sq);
    else setT(this.ring, p, cross, sc * sq, 0, sc);
    const a = Math.min(...g.lanes);
    const b = Math.max(...g.lanes);
    if (this.line) {
      setT(this.line, a - 12, p - 1);
      setSize(this.line, b - a + 24, 2);
    }
    this.ticks.forEach((tick, i) => setT(tick, p - 1.5, (g.lanes[i] as number) - 15));
    // The label: under the ring on a single track; with lanes, in the strip kept clear for it along the top.
    if (this.tab) setT(this.tab, p, this.ticks.length ? 0 : b + 15);
    this.label?.apply(t);
    setData(this.el, 'tone', this.tones.now(t));
  }
}

// ---------------------------------------------------------------------------------------------
// A span: a bracket between two events
// ---------------------------------------------------------------------------------------------
class Span implements Part {
  readonly id: string;
  readonly kind = 'span';
  /** a, b: the (fractional) places it runs between. grow: how much of it is drawn. */
  readonly c = { a: new Chan(0), b: new Chan(0), grow: new Chan(0), o: new Chan(1), dim: new Chan(0), s: new Chan(1) };
  private readonly el: HTMLElement;
  private readonly line: HTMLElement;
  private readonly tab: HTMLElement;
  private readonly label: Swap;
  private readonly tones: Tones;
  private readonly geo: { along: Along; cross: number; vertical: boolean; tabW: number; origin: () => { x: number; y: number } };

  constructor(d: NonNullable<TimelineData['spans']>[number], a: number, b: number, parent: Element, geo: Span['geo']) {
    this.id = d.id;
    this.geo = geo;
    this.c.a.base = a;
    this.c.b.base = b;
    this.tones = new Tones(d.tone ?? 'accent');
    this.el = parent.appendChild(h('div', 'st-p st-tl-span'));
    this.el.dataset.dir = geo.vertical ? 'v' : 'h';
    this.line = this.el.appendChild(h('span', 'st-p st-tl-span-line'));
    this.tab = this.el.appendChild(h('span', 'st-p st-tl-span-tab'));
    if (!d.label) this.tab.hidden = true;
    this.label = new Swap(this.tab.appendChild(h('span', 'st-tl-words')), d.label ?? '');
  }
  get onStage(): boolean {
    return this.c.grow.end > 0.5 && this.c.o.end > 0.5;
  }
  startHidden(): void {
    // A span is always brought by a `show` (or a `move`): nothing to do.
  }
  enter(ctx: Ctx, delay = 0): void {
    const at = ctx.t + delay;
    const g = this.geo;
    const len = Math.abs(g.along(this.c.b.end) - g.along(this.c.a.end));
    this.c.grow.to(0, at, 0);
    this.c.o.to(1, at, 0);
    ctx.tw(this.c.grow, 1, { at, d: travel(D.draw, len, ctx.W) * 1.2, e: E.soft });
  }
  exit(ctx: Ctx, delay = 0): void {
    ctx.tw(this.c.o, 0, { at: ctx.t + delay, d: D.exit, e: E.exit });
  }
  /** Slide to another pair of places: the leading end first, the other following. */
  go(ctx: Ctx, a: number, b: number): void {
    if (!this.onStage) {
      this.c.a.to(a, ctx.t, 0);
      this.c.b.to(b, ctx.t, 0);
      this.enter(ctx, 0);
      return;
    }
    const forward = a + b > this.c.a.end + this.c.b.end;
    const lag = 80 * ctx.pace;
    const g = this.geo;
    const d = travel(D.move, Math.max(Math.abs(g.along(a) - g.along(this.c.a.end)), Math.abs(g.along(b) - g.along(this.c.b.end))), ctx.W);
    ctx.tw(this.c.a, a, { at: ctx.t + (forward ? lag : 0), d, e: E.move });
    ctx.tw(this.c.b, b, { at: ctx.t + (forward ? 0 : lag), d, e: E.move });
  }
  pulse(ctx: Ctx, delay = 0, amount = 0.08): void {
    const at = ctx.t + delay;
    ctx.tw(this.c.s, this.c.s.at(at), { at, d: D.pop, e: E.linear, fn: bump(amount) });
  }
  setTone(ctx: Ctx, tone: string, delay = 0): void {
    if (this.tones.set(ctx, tone, delay)) this.pulse(ctx, delay);
  }
  setValue(ctx: Ctx, value: number | string, delay = 0): void {
    this.label.set(ctx, String(value), delay);
  }
  rest(): Rect {
    const g = this.geo;
    const o = g.origin();
    const a = g.along(this.c.a.end);
    const b = g.along(this.c.b.end);
    return g.vertical ? { x: g.cross + o.x, y: (a + b) / 2 + o.y, w: 24, h: Math.abs(b - a) } : { x: (a + b) / 2 + o.x, y: g.cross + 10 + o.y, w: Math.abs(b - a), h: 34 };
  }
  apply(t: number): void {
    const c = this.c;
    const grow = c.grow.at(t);
    const o = grow <= 0.001 ? 0 : c.o.at(t) * (1 - 0.78 * c.dim.at(t));
    setO(this.el, o);
    if (o <= 0.004) return;
    const g = this.geo;
    const a = g.along(c.a.at(t));
    const b = g.along(c.b.at(t));
    const len = Math.max(2, (b - a) * grow);
    const mid = (a + b) / 2;
    const tabO = clamp(grow * 2.5 - 1.5, 0, 1);
    if (g.vertical) {
      setT(this.line, g.cross, a);
      setSize(this.line, 7, len);
      setT(this.tab, g.cross - 9, mid, c.s.at(t));
    } else {
      setT(this.line, a, g.cross);
      setSize(this.line, len, 8);
      setT(this.tab, mid - g.tabW / 2, g.cross + 12, c.s.at(t));
    }
    setO(this.tab, tabO);
    this.label.apply(t);
    setData(this.el, 'tone', this.tones.now(t));
  }
}

// ---------------------------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------------------------
export class TimelineStage extends Stage<TimelineData> {
  private readonly lanes: Lane[] = [];
  private readonly moments: Moment[] = [];
  private readonly markers: Marker[] = [];
  /** Per place: the tick on the shared axis (lanes, wide) that says `when`. */
  private readonly ticks: { el: HTMLElement; moments: Moment[] }[] = [];
  private readonly view: HTMLElement;
  private readonly pan: HTMLElement;
  private readonly scroll = new Chan(0);
  private readonly scrolls: boolean;
  private readonly vertical: boolean;
  private readonly viewTop: number;
  private readonly viewH: number;
  /** The along-axis centre of each place, and the two ends of the track. */
  private readonly pos: number[];
  private readonly from: number;
  private readonly to: number;

  constructor(data: TimelineData, env: StageEnv) {
    super(data, env);
    const { W, narrow } = this;
    const lanesData = data.lanes ?? [];
    const laned = lanesData.length > 0;
    const L = Math.max(1, lanesData.length);
    const events = data.events;
    const laneIndex = new Map(lanesData.map((l, i) => [l.id, i]));
    const spansData = data.spans ?? [];
    const markersData = data.markers ?? [];

    // A timeline runs the width of the stage, so it always starts below the stage's own badge in the top right corner.
    let top = BADGE_H;
    const availH0 = this.floor - top - (narrow ? 4 : 8);

    // ---- places. Wide, with lanes: events that follow one another with the same `when` in different lanes share one.
    const shared: number[] = [];
    let slots = 0;
    let open: { when: string; lanes: Set<number> } | null = null;
    events.forEach((e) => {
      const li = e.lane === undefined ? undefined : laneIndex.get(e.lane);
      if (laned && open && li !== undefined && open.when === e.when && !open.lanes.has(li) && !open.lanes.has(-1)) open.lanes.add(li);
      else {
        open = { when: e.when, lanes: new Set([li ?? -1]) };
        slots++;
      }
      shared.push(slots - 1);
    });

    // ---- wide: does everything fit along a horizontal track?
    const padX = narrow ? 10 : 30;
    const spanRows: number[] = [];
    const rowEnds: number[] = [];
    const placeOfH = (id: string): number => shared[events.findIndex((e) => e.id === id)] ?? 0;
    for (const sp of spansData) {
      const a = Math.min(placeOfH(sp.from), placeOfH(sp.to));
      const b = Math.max(placeOfH(sp.from), placeOfH(sp.to));
      let row = rowEnds.findIndex((end) => end < a);
      if (row < 0) row = rowEnds.length;
      rowEnds[row] = b;
      spanRows.push(row);
    }
    const stripH = rowEnds.length ? rowEnds.length * 34 + 4 : 0;
    const tabH = markersData.some((m) => m.label) ? 26 : 0;
    const nameW = laned ? Math.ceil(Math.max(...lanesData.map((l) => textWidth(l.label.toUpperCase(), 11, 700) * 1.1))) + 16 : 0;
    const hLeft = padX + nameW + (laned ? 8 : 6);
    const hRight = W - padX - 22;
    const pitch = (hRight - hLeft) / slots;
    const alt = !laned && slots >= 5 && stripH === 0 && tabH === 0;
    const cardW = Math.floor(Math.min(alt ? 2 * pitch - 26 : pitch - 14, 280));
    const stemH = 20;
    const axisH = 26;
    const laneH = laned ? (availH0 - (tabH ? 20 : 0) - stripH - axisH - 4) / L : 0;
    // Type is as large as the room allows: sized by the room each event has along the track, then
    // tried larger first and smaller after, until every card fits beside its track.
    let labelPxH = 14;
    let lineH = 18;
    let whenPxH = 17;
    let whenH = 25;
    let cardHs: number[] = [];
    let fits = false;
    for (const m of !narrow && cardW >= 84 ? [1.4, 1.2, 1.05, 0.92, 0.82] : []) {
      labelPxH = Math.round(2 * clamp(pitch * (laned ? 0.085 : 0.1) * m, 12.5, laned ? 21 : 23)) / 2;
      lineH = Math.round(labelPxH * 1.3);
      whenPxH = Math.round(clamp(pitch * 0.13 * m, 15, 34));
      whenH = Math.round(whenPxH * 1.4) + 1;
      cardHs = events.map((e) => (laned ? 0 : whenH) + rowsOf(e.label, labelPxH, 500, cardW - 6) * lineH);
      const tallest = Math.max(...cardHs);
      if (laned) fits = tallest <= laneH - 14 - stemH - 6;
      else fits = alt ? tallest + stemH + 12 <= availH0 / 2 : tallest + stemH + 14 + stripH + tabH + 20 <= availH0;
      if (fits) break;
    }
    const vertical = (this.vertical = !fits);

    // ---- the window: the whole stage when wide; a strip that the rows scroll through when the track is vertical
    const legendH = vertical && laned ? 26 : 0;
    top += legendH;
    const availH = availH0 - legendH;
    this.viewTop = top;
    this.viewH = availH;
    this.view = this.world.appendChild(h('div', 'st-p st-tl-view'));
    setT(this.view, 0, top);
    setSize(this.view, W, availH);
    this.pan = this.view.appendChild(h('div', 'st-tl-pan'));
    const svg = this.pan.appendChild(s('svg', { class: 'st-tl-wires', width: W, height: availH, 'aria-hidden': 'true', focusable: 'false' }));
    const under = this.pan.appendChild(h('div', 'st-tl-layer'));
    const over = this.pan.appendChild(h('div', 'st-tl-layer'));
    const origin = (t?: number): { x: number; y: number } => ({ x: 0, y: this.viewTop - (t === undefined ? this.scroll.end : this.scroll.at(t)) });
    this.view.dataset.dir = vertical ? 'v' : 'h';

    const laneOf = (e: EventData): number[] => {
      const li = e.lane === undefined ? undefined : laneIndex.get(e.lane);
      return li === undefined ? Array.from({ length: L }, (_, i) => i) : [li];
    };
    const boxes: MomentBox[] = [];
    const placeOf: number[] = [];
    /** Cross-axis position of each lane's track: y when wide, x when vertical. */
    const cross: number[] = [];
    let contentH = availH;
    let spanCross = 0;

    if (!vertical) {
      // ------------------------------------------------------------------------ wide
      this.pos = Array.from({ length: slots }, (_, i) => hLeft + (i + 0.5) * pitch);
      this.from = hLeft - 2;
      this.to = hRight + 14;
      if (laned) {
        const y0 = tabH ? 20 : 0;
        for (let l = 0; l < L; l++) cross.push(Math.round(y0 + (l + 1) * laneH - 12));
        spanCross = (cross[L - 1] as number) + 16;
      } else {
        const need = Math.max(...cardHs) + stemH + 12;
        const below = stripH + tabH + 18;
        cross.push(Math.round(alt ? availH / 2 : clamp(availH * 0.62, need, availH - below)));
        spanCross = (cross[0] as number) + 14 + tabH;
      }
      events.forEach((e, k) => {
        const place = shared[k] as number;
        placeOf.push(place);
        const x = this.pos[place] as number;
        const ls = laneOf(e);
        const y = cross[ls[0] as number] as number;
        const below = alt && place % 2 === 1;
        const hh = cardHs[k] as number;
        const cy = below ? y + stemH + 8 + hh / 2 : y - stemH - 8 - hh / 2;
        const detailH = e.detail === undefined ? 0 : rowsOf(e.detail, 12.5, 400, cardW - 6) * 17 + 6;
        const yEnd = cross[ls[ls.length - 1] as number] as number;
        boxes.push({
          dots: ls.map((l) => ({ x, y: cross[l] as number })),
          bar: ls.length > 1 ? { x: x - 4, y, w: 8, h: yEnd - y } : null,
          stem: { x, y: below ? y + 8 : y - 8, len: stemH, dir: below ? 'down' : 'up' },
          card: { x: clamp(x, cardW / 2 + 6, W - cardW / 2 - 6), y: cy, w: cardW, h: hh },
          detailH,
          side: below ? 'below' : 'above',
          whenPx: whenPxH,
          labelPx: labelPxH,
          showWhen: !laned,
        });
      });
    } else {
      // ------------------------------------------------------------------------ vertical: one row per event
      const colW = Math.min(W, 620);
      const x0 = Math.round((W - colW) / 2) + (narrow ? 10 : 20) + (spansData.length ? 22 : 0);
      for (let l = 0; l < L; l++) cross.push(x0 + 9 + l * 16);
      spanCross = x0 - 14;
      const textX = (cross[L - 1] as number) + 20;
      const textW = Math.round((W + colW) / 2 - (narrow ? 16 : 24) - textX);
      const labelPx = narrow ? 14 : 15.5;
      const lh = Math.round(labelPx * 1.32);
      const whenPx = narrow ? 13 : 14;
      this.pos = [];
      let y = laned ? 26 : 6;
      events.forEach((e, k) => {
        placeOf.push(k);
        const ls = laneOf(e);
        const hh = 20 + rowsOf(e.label, labelPx, 500, textW - 4) * lh;
        const dotY = y + 11;
        this.pos.push(dotY);
        const xa = cross[ls[0] as number] as number;
        const xb = cross[ls[ls.length - 1] as number] as number;
        const detailH = e.detail === undefined ? 0 : rowsOf(e.detail, 12.5, 400, textW - 4) * 17 + 6;
        boxes.push({
          dots: ls.map((l) => ({ x: cross[l] as number, y: dotY })),
          bar: ls.length > 1 ? { x: xa, y: dotY - 4, w: xb - xa, h: 8 } : null,
          stem: { x: xb + 7, y: dotY, len: textX - xb - 12, dir: 'right' },
          card: { x: textX + textW / 2, y: y + hh / 2, w: textW, h: hh },
          detailH,
          side: 'right',
          whenPx,
          labelPx,
          showWhen: true,
        });
        y += hh + 12;
      });
      this.from = (this.pos[0] as number) - 14;
      this.to = y + 4;
      const lastBox = boxes[boxes.length - 1] as MomentBox;
      contentH = Math.max(this.to + 16, lastBox.card.y + lastBox.card.h / 2 + lastBox.detailH + 18);
    }
    this.contentH = contentH;
    this.scrolls = vertical && contentH > availH + 1;
    if (this.scrolls) this.view.dataset.scroll = 'true';
    const S = this.pos.length;
    const along: Along = (f) => this.along(f);
    const span = this.to - this.from;

    // ---- lanes: the tracks, and their names
    for (let l = 0; l < L; l++) {
      const d = lanesData[l];
      let name: HTMLElement | null = null;
      if (d && !vertical) {
        name = under.appendChild(h('span', 'st-p st-tl-lane', d.label));
        setT(name, padX, (cross[l] as number) - 9);
        setSize(name, nameW, 18);
      } else if (d) {
        // Vertical: the tracks are too close for names beside them, so each wears a number and the legend says which is which.
        name = under.appendChild(h('span', 'st-p st-tl-lane-no', String(l + 1)));
        setT(name, (cross[l] as number) - 7, this.from - 18);
      }
      const lane = new Lane(d ? d.id : TRACK, svg, d?.tone ?? 'neutral', name);
      const c = cross[l] as number;
      if (d && !vertical) {
        lane.band = under.insertBefore(h('span', 'st-p st-tl-band'), under.firstChild);
        setT(lane.band, padX - 10, c - laneH + 18);
        setSize(lane.band, W - 2 * padX + 20, laneH - 6);
      }
      if (vertical) lane.wire.setGeo({ x: c, y: this.from }, { x: c, y: this.to });
      else lane.wire.setGeo({ x: this.from, y: c }, { x: this.to, y: c });
      this.lanes.push(this.add(lane));
    }
    if (vertical && laned) {
      const legend = this.hud.appendChild(h('p', 'st-tl-legend'));
      setProp(legend, 'top', `${BADGE_H + 2}px`);
      lanesData.forEach((l, i) => {
        const item = legend.appendChild(h('span', 'st-tl-legend-item'));
        item.appendChild(h('span', 'st-tl-lane-no', String(i + 1)));
        item.appendChild(h('span', '', l.label));
      });
    }
    // ---- the shared axis (lanes, wide): one `when` per place, along the bottom
    if (laned && !vertical) {
      const y = (cross[L - 1] as number) + 16 + stripH;
      for (let i = 0; i < S; i++) {
        const k = shared.indexOf(i);
        const tick = under.appendChild(h('span', 'st-p st-tl-tick', (events[k] as EventData).when));
        setT(tick, (this.pos[i] as number) - pitch / 2, y);
        setSize(tick, pitch, axisH - 4);
        this.ticks.push({ el: tick, moments: [] });
      }
    }
    // ---- events
    events.forEach((e, k) => {
      const m = new Moment(e, placeOf[k] as number, laneOf(e).map((l) => this.lanes[l] as Lane), boxes[k] as MomentBox, over, origin);
      this.moments.push(this.add(m));
      this.ticks[shared[k] as number]?.moments.push(m);
    });
    // ---- spans
    const placeById = new Map(events.map((e, k) => [e.id, placeOf[k] as number]));
    this.placeById = placeById;
    spansData.forEach((sp, i) => {
      const a = placeById.get(sp.from);
      const b = placeById.get(sp.to);
      if (a === undefined || b === undefined) throw new Error(`The span "${sp.id}" runs from "${sp.from}" to "${sp.to}"; both must be events of this stage.`);
      const tabW = sp.label ? Math.ceil(textWidth(sp.label, 12, 700)) + 18 : 0;
      const part = new Span(sp, Math.min(a, b), Math.max(a, b), under, { along, cross: vertical ? spanCross : spanCross + (spanRows[i] as number) * 34, vertical, tabW, origin });
      this.add(part);
    });
    // ---- markers
    for (const mk of markersData) {
      const part = new Marker(mk, over, { along, lanes: cross, vertical, origin }, !vertical);
      this.markers.push(this.add(part));
    }
    this.pxLength = span;
  }
  private readonly placeById: Map<string, number>;
  private readonly contentH: number;
  /** The track's length in px, for timing a draw by the distance it covers. */
  private readonly pxLength: number;

  /** Where a (fractional) place is along the track. Before the first place and after the last it runs out to the track's ends. */
  private along(f: number): number {
    const p = this.pos;
    const last = p.length - 1;
    if (f <= 0) return (p[0] as number) + (f / 0.5) * ((p[0] as number) - this.from);
    if (f >= last) return (p[last] as number) + ((f - last) / 0.5) * (this.to - (p[last] as number));
    const i = Math.floor(f);
    return (p[i] as number) + ((p[i + 1] as number) - (p[i] as number)) * (f - i);
  }
  /** A place as a share of the track's length (0..1): what a lane's `draw` channel counts in. */
  private share(place: number): number {
    return (this.along(place) - this.from) / (this.to - this.from);
  }
  private moment(id: string, verb: string): Moment {
    const p = this.parts.get(id);
    if (!(p instanceof Moment)) throw new Error(`${verb}: "${id}" is not an event of this timeline.`);
    return p;
  }
  /** Keep places a..b in the window, when the rows are taller than the stage. */
  private follow(ctx: Ctx, a: number, b: number, extra = 0, delay = 0): void {
    if (!this.scrolls) return;
    const boxA = (this.moments[clamp(a, 0, this.moments.length - 1)] as Moment).box.card;
    const boxB = (this.moments[clamp(b, 0, this.moments.length - 1)] as Moment).box.card;
    const top = boxA.y - boxA.h / 2 - 30;
    const bottom = boxB.y + boxB.h / 2 + extra + 34;
    const max = Math.max(0, this.contentH - this.viewH);
    let to = this.scroll.end;
    if (bottom > to + this.viewH) to = bottom - this.viewH;
    if (top < to) to = top;
    to = Math.round(clamp(to, 0, max));
    if (Math.abs(to - this.scroll.end) > 1) ctx.tw(this.scroll, to, { at: ctx.t + delay, d: D.camera * 0.6, e: E.move });
  }
  private followParts(ctx: Ctx, ids: readonly string[]): void {
    const places = ids.map((id) => this.parts.get(id)).filter((p): p is Moment => p instanceof Moment);
    if (places.length) this.follow(ctx, Math.min(...places.map((m) => m.place)), Math.max(...places.map((m) => m.place)), places.length === 1 ? (places[0] as Moment).box.detailH : 0);
  }

  // ------------------------------------------------------------------------------------------ verbs
  /** The opening: each track draws itself, and the events it passes arrive as the tip reaches them. */
  override intro(ctx: Ctx): void {
    const px = this.pxLength;
    for (const lane of this.lanes) {
      const mine = this.moments.filter((m) => m.lanes.includes(lane));
      const firstLater = mine.find((m) => m.later);
      // As far as the last event before the first one that arrives later; the whole track when none does.
      const before = firstLater ? mine.filter((m) => m.place < firstLater.place) : mine;
      const lastPlace = before.length ? Math.max(...before.map((m) => m.place)) : -1;
      const q = firstLater ? (lastPlace < 0 ? 0 : this.share(lastPlace + 0.18)) : 1;
      if (q <= 0) continue;
      const d = clamp(travel(D.draw, q * px, this.W) * 1.5, 500, 1500);
      const t0 = 120 * ctx.pace;
      ctx.tw(lane.c.intro, q, { at: t0, d, e: E.soft });
      for (const m of before) {
        if (m.lanes[0] !== lane) continue;
        // E.soft is its own inverse about the middle, near enough: the tip is at share s after about this long.
        const u = clamp(this.share(m.place) / q, 0, 1);
        const when = t0 + d * ctx.pace * (u < 0.5 ? Math.sqrt(u / 2) : 1 - Math.sqrt((1 - u) / 2)) - 70 * ctx.pace;
        m.arrive(ctx, Math.max(0, when), true);
      }
    }
    this.introStats(ctx);
  }
  /** draw: the track ("track", or lane ids) runs on, to the event `upto` or to its end, and brings the events it passes. */
  draw(ctx: Ctx, a: ActionData): void {
    const ids = this.ids(a);
    const lanes = ids.includes(TRACK) || ids.length === 0 ? this.lanes : ids.map((id) => this.get(id)).filter((p): p is Lane => p instanceof Lane);
    if (lanes.length === 0) throw new Error(`draw: name "track" or a lane of this timeline; "${ids.join(', ')}" is neither.`);
    const upto = typeof a.upto === 'string' ? this.moment(a.upto, 'draw') : null;
    const q = upto ? this.share(upto.place + 0.18) : 1;
    let lastPlace = -1;
    for (const lane of lanes) {
      // The first draw on an untouched track takes it over from the opening.
      if (lane.auto && lane.c.draw.segs.length === 0) lane.auto = false;
      const from = lane.reach;
      const end = lane.extend(ctx, q, ctx.t, this.pxLength, this.W);
      for (const m of this.moments) {
        if (m.lanes[0] !== lane || m.onStage) continue;
        const sh = this.share(m.place);
        if (sh > q + 1e-6 || sh < from - 1e-6) continue;
        const u = clamp((sh - from) / Math.max(1e-6, q - from), 0, 1);
        const when = ctx.t + (end - ctx.t) * (u < 0.5 ? Math.sqrt(u / 2) : 1 - Math.sqrt((1 - u) / 2)) - 70 * ctx.pace;
        m.arrive(ctx, Math.max(ctx.t, when));
        lastPlace = Math.max(lastPlace, m.place);
      }
    }
    if (lastPlace >= 0) this.follow(ctx, lastPlace, lastPlace);
  }
  /** show: events arrive in order, the track running on to each; spans grow; anything else as on every stage. */
  override show(ctx: Ctx, a: ActionData): void {
    const ids = this.ids(a);
    let delay = 0;
    const others: string[] = [];
    for (const id of ids) {
      const p = this.get(id);
      if (!(p instanceof Moment)) {
        others.push(id);
        continue;
      }
      let at = ctx.t + delay;
      for (const lane of p.lanes) at = Math.max(at, lane.extend(ctx, this.share(p.place + 0.18), ctx.t + delay, this.pxLength, this.W) - 90 * ctx.pace);
      p.arrive(ctx, at);
      delay = at - ctx.t + 150 * ctx.pace;
    }
    if (others.length) {
      const st = 90 * ctx.pace;
      others.forEach((id, i) => {
        const p = this.get(id);
        if (!p.enter) throw new Error(`"${p.id}" is a ${p.kind}: it does not take "show" on this timeline stage.`);
        p.enter(ctx, delay + i * st, p.hud && !(p instanceof Marker) ? 'left' : undefined);
      });
    }
    this.followParts(ctx, ids);
  }
  /** move: a marker travels to an event; a span slides to [first, last]. */
  move(ctx: Ctx, a: ActionData): void {
    const p = this.get(String(a.target));
    if (p instanceof Marker) {
      if (typeof a.to !== 'string') throw new Error(`move: the marker "${p.id}" goes to one event.`);
      const m = this.moment(a.to, 'move');
      const dots = m.box.dots;
      const end = p.go(ctx, m.place, dots.reduce((sum, d) => sum + (this.vertical ? d.x : d.y), 0) / dots.length, this.W);
      // It lands, and the event answers.
      if (m.onStage) m.pulse(ctx, Math.max(0, end - ctx.t - 120 * ctx.pace), 0.16);
      this.follow(ctx, m.place, m.place);
    } else if (p instanceof Span) {
      const pair = pairOf(a.to);
      if (!pair) throw new Error(`move: the span "${p.id}" goes to [first, last].`);
      const i = this.moment(pair[0], 'move').place;
      const j = this.moment(pair[1], 'move').place;
      p.go(ctx, Math.min(i, j), Math.max(i, j));
      this.follow(ctx, Math.min(i, j), Math.max(i, j));
    } else throw new Error(`move works on a marker or a span; "${String(a.target)}" is neither.`);
  }
  /** A focus names events, a lane (all its events), a span (its two events and what lies between), or `between: [first, last]`. */
  override focusSet(a: ActionData): Set<string> {
    const want = new Set(this.ids(a));
    const range = (i: number, j: number): void => {
      for (const m of this.moments) if (m.place >= Math.min(i, j) && m.place <= Math.max(i, j)) want.add(m.id);
    };
    const between = pairOf(a.between);
    if (between) range(this.moment(between[0], 'focus').place, this.moment(between[1], 'focus').place);
    for (const id of [...want]) {
      const p = this.parts.get(id);
      if (p instanceof Lane) for (const m of this.moments) if (m.lanes.includes(p)) want.add(m.id);
      if (p instanceof Span) range(p.c.a.end, p.c.b.end);
    }
    return want;
  }
  override focus(ctx: Ctx, a: ActionData): void {
    super.focus(ctx, this.scrolls ? { ...a, zoom: false } : a);
    const want = this.focusSet(a);
    const named = new Set([...this.ids(a), ...(pairOf(a.between) ? [...want] : [])]);
    const lit = this.moments.filter((m) => named.has(m.id));
    for (const m of this.moments) m.light(ctx, lit.includes(m), lit.length === 1);
    // A track stays bright while any of its events is in focus: the line is what joins them.
    const ids = this.ids(a);
    for (const lane of this.lanes) {
      const on = want.size === 0 || want.has(lane.id) || this.moments.some((m) => want.has(m.id) && m.lanes.includes(lane) && (m.lanes.length === 1 || ids.includes(m.id)));
      const dim = on ? 0 : 1;
      if (lane.c.dim.end !== dim) ctx.tw(lane.c.dim, dim, { d: D.dim, e: E.out });
    }
    this.followParts(ctx, [...want]);
  }
  /** set: `tone` on anything; `label` (or `value`) rewrites an event, a span or a marker; a stat as on every stage. */
  override set(ctx: Ctx, a: ActionData): void {
    const ids = this.ids(a);
    const others: string[] = [];
    ids.forEach((id, i) => {
      const p = this.get(id);
      const delay = i * 70 * ctx.pace;
      if (!(p instanceof Moment || p instanceof Span || p instanceof Marker || p instanceof Lane)) {
        others.push(id);
        return;
      }
      if (typeof a.tone === 'string') p.setTone(ctx, a.tone, delay);
      const text = a.label ?? a.value;
      if ((typeof text === 'string' || typeof text === 'number') && !(p instanceof Lane)) p.setValue(ctx, text, delay);
    });
    if (others.length) super.set(ctx, { ...a, target: undefined, targets: others });
    this.followParts(ctx, ids);
  }
  override apply(t: number, x?: ExploreState): void {
    super.apply(t, x);
    setT(this.pan, 0, -this.scroll.at(t));
    // The stretch of track behind the first marker is marked as passed.
    const mk = this.markers[0];
    const passedO = mk ? mk.c.o.at(t) : 0;
    const passed = mk && passedO > 0.004 ? (this.along(mk.c.f.at(t)) - this.from) / (this.to - this.from) : -1;
    for (const lane of this.lanes) lane.draw(t, passed, passedO);
    for (const tick of this.ticks) setO(tick.el, Math.max(0, ...tick.moments.map((m) => clamp(m.shown(t) * 2 - 0.6, 0, 1) * m.c.o.at(t))));
  }
}

registerKit('timeline', (data: TimelineData, env) => new TimelineStage(data, env));
