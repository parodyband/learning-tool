// The `lines` stage: code, a derivation or plain text as numbered lines.
//
// What it can show, all through the shared verbs:
//   show    lines arrive one after another (code and text are wiped in from the left, as if written);
//           on a `math` stage a line grows out of the line above it: a copy travels down and becomes
//           the next step. An annotation opens under its line and the lines below make room.
//   focus   the named lines (or `between: [first, last]`) are lit and everything else recedes.
//   move    a pointer travels to a line and takes a band of light with it; a bracket stretches over
//           a range of lines.
//   set     a value beside a line ticks over to its next value and glows for a moment; a line takes
//           a tone (good, bad, warn: a band, and a mark where its number was); `label` rewrites a
//           line where it stands.
//   hide, pulse  as on every stage.
//
// Parts: lines l1..lN, and the stage's pointers, brackets, annotations, values and stats, by id.
//
// Layout is a function of the stage size and the text lengths alone (monospace advances are known,
// prose is estimated with a margin), so the timeline compiles the same with or without a layout
// engine. Maths is the one exception: MathML is never built here. The page already carries each
// line as MathML (render/clip-kits-extra.ts, made by core/math), and this kit clones those nodes.
import { type ActionData, Box, Chan, type Ctx, D, E, type Ease, type ExploreState, type Live, type Part, type Rect, type SegFn, Stage, type StageEnv, type TapBox, bezier, bump, clamp, f2, h, registerKit, setO, setProp, setSize, setT, stagger, textWidth } from './kit';
import type { LinesStage as LinesData } from '../../core/clip-kits-extra';
import { format } from './explore';

/** The same words as the static page and v1's code figures. A test holds the three together. */
export const LINES_CODE_LABEL = 'Code written by your agent. Read it before you run it.';

/** Advance of one character, in em: the monospace stack, and lesson prose (with a margin). */
const MONO = 0.602;
const PROSE = 0.52;

/**
 * The stage puts its provenance badge in the top right corner (css/stage.css, .lt-prov): about this
 * tall with its margin, and on a stage narrower than BADGE_ROOM it leaves no room beside it.
 */
export const BADGE_H = 46;
export const BADGE_ROOM = 760;
/** Travel with weight: a little anticipation, a little overshoot, then rest. The pointer and the bracket. */
const HEAVY: Ease = bezier(0.62, -0.16, 0.3, 1.16);
/** A glow that comes up fast and dies away slowly: "this just changed". Ends where it began, at nothing. */
const glow =
  (amount: number): SegFn =>
  (e) =>
    amount * (e < 0.14 ? e / 0.14 : (1 - (e - 0.14) / 0.86) ** 2);

/** `between: [first, last]` or `to: [first, last]` of an action, when it is a pair of ids. */
function pairOf(v: unknown): [string, string] | null {
  return Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string' ? [v[0], v[1]] : null;
}

type Format = LinesData['format'];
/** Where the window's own y = 0 is on the stage: at time t, or (with no t) once everything scheduled so far has played. */
type Origin = (t?: number) => number;
const first = <T extends Element>(el: Element, cls: string): T => el.getElementsByClassName(cls)[0] as T;

// ---------------------------------------------------------------------------------------------
// A line
// ---------------------------------------------------------------------------------------------
class Line extends Box {
  override readonly kind: string = 'line';
  readonly index: number;
  readonly fmt: Format;
  /** Characters of text, and the share of the text column they fill (for the wipe). */
  chars: number;
  span = 1;
  /** rev: how much of the text has been written in. lit: in the spotlight. glow: just changed or just landed. */
  readonly x = { rev: new Chan(1), lit: new Chan(0), glow: new Chan(0) };
  /** The line's MathML, cloned from the page, when this is a maths line and the page has it. */
  math: HTMLElement | null = null;
  /** The line as written, for naming it. */
  private readonly source: string;
  readonly body: HTMLElement;
  private readonly origin: Origin;
  private readonly plate: HTMLElement;
  private readonly glowEl: HTMLElement;

  constructor(index: number, text: string, fmt: Format, parent: Element, math: Element[] | null, origin: Origin) {
    super({ id: `l${index + 1}`, label: math ? '' : text, cls: `st-ln st-ln-${fmt}` }, parent);
    this.origin = origin;
    this.index = index;
    this.source = text;
    this.fmt = fmt;
    this.chars = text.length;
    this.body = first(this.el, 'st-txt');
    this.glowEl = this.el.insertBefore(h('span', 'st-ln-glow'), this.el.firstChild);
    this.plate = this.el.insertBefore(h('span', 'st-ln-plate'), this.el.firstChild);
    const no = this.el.appendChild(h('span', 'st-ln-no'));
    no.appendChild(h('span', 'st-ln-n', fmt === 'code' ? String(index + 1) : ''));
    no.appendChild(h('span', 'st-ln-g'));
    if (math) {
      this.math = this.body.appendChild(h('span', 'st-ln-math'));
      for (const m of math) this.math.appendChild(m.cloneNode(true));
    }
  }
  /** A wrapped line of code hangs under its own indentation, `ch` characters in. */
  hang(ch: number): void {
    setProp(this.body, '--ln-hang', `${ch}ch`);
  }
  /** The text keeps to the top `px` of the row when the row is taller than its text (its values sit under it). */
  textHeight(px: number): void {
    setProp(this.body, 'height', `${px}px`);
  }
  /** How wide the line's maths is drawn, in CSS pixels; 0 where nothing can be measured (no layout engine, or no maths). */
  mathWidth(): number {
    const el = this.math as Partial<HTMLElement> | null;
    return el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect().width : 0;
  }
  /** The row gains `dy` of height below its text (a value opens under it); its top stays where it is. */
  grow(ctx: Ctx, dy: number, delay: number): void {
    const at = ctx.t + delay;
    ctx.tw(this.c.h, this.c.h.end + dy, { at, d: D.move, e: E.move });
    ctx.tw(this.c.y, this.c.y.end + dy / 2, { at, d: D.move, e: E.move });
  }
  override rest(): Rect {
    const r = super.rest();
    return { ...r, y: r.y + this.origin() };
  }
  /** A line is tapped across its whole row, wherever the window has scrolled it to. */
  override tap(t: number): TapBox | null {
    const b = super.tap(t);
    if (!b) return null;
    const words = this.math ? this.source : this.said(t);
    return { ...b, y: b.y + this.origin(t), label: `Line ${this.index + 1}: ${words.trim()}` };
  }
  override startHidden(): void {
    this.c.o.base = 0;
  }
  /** Code and text are wiped in from the left while the row slides the last few pixels; maths rises. */
  override enter(ctx: Ctx, delay = 0): void {
    const at = ctx.t + delay;
    const c = this.c;
    c.s.to(1, at, 0);
    c.ly.to(0, at, 0);
    if (this.fmt === 'math') {
      c.dx.to(0, at, 0);
      c.dy.to(14, at, 0);
      this.x.rev.to(1, at, 0);
      ctx.tw(c.dy, 0, { at, d: D.enter, e: E.enter });
      ctx.tw(c.o, 1, { at, d: D.enter * 0.5, e: E.out });
      return;
    }
    c.dy.to(0, at, 0);
    c.dx.to(-14, at, 0);
    this.x.rev.to(0, at, 0);
    ctx.tw(c.dx, 0, { at, d: D.enter, e: E.enter });
    ctx.tw(c.o, 1, { at, d: 140, e: E.out });
    ctx.tw(this.x.rev, 1, { at, d: clamp(220 + this.chars * 9, 260, 600), e: E.soft });
  }
  /** The end of a derivation step: the travelling copy turns into this line. */
  land(ctx: Ctx, delay: number, d: number): void {
    const at = ctx.t + delay;
    const c = this.c;
    c.dx.to(0, at, 0);
    c.dy.to(0, at, 0);
    c.ly.to(0, at, 0);
    this.x.rev.to(1, at, 0);
    c.s.to(0.95, at, 0);
    ctx.tw(c.o, 1, { at, d, e: E.soft });
    ctx.tw(c.s, 1, { at, d: D.enter, e: E.pop });
    this.flash(ctx, delay + d * ctx.pace * 0.5, 0.75);
  }
  override exit(ctx: Ctx, delay = 0): void {
    const at = ctx.t + delay;
    ctx.tw(this.c.o, 0, { at, d: D.exit, e: E.exit });
    ctx.tw(this.c.dx, -10, { at, d: D.exit, e: E.exit });
  }
  flash(ctx: Ctx, delay = 0, amount = 0.6): void {
    ctx.tw(this.x.glow, 0, { at: ctx.t + delay, d: 950, e: E.linear, fn: glow(amount) });
  }
  /** A row is wide, so its swell is small; the glow carries the emphasis. */
  override pulse(ctx: Ctx, delay = 0, amount = 0.025): void {
    const at = ctx.t + delay;
    ctx.tw(this.c.s, this.c.s.at(at), { at, d: D.pop, e: E.linear, fn: bump(amount) });
    if (amount > 0) this.flash(ctx, delay);
  }
  override setTone(ctx: Ctx, tone: string, delay = 0): void {
    if (this.tones[this.tones.length - 1] === tone) return;
    super.setTone(ctx, tone, delay);
    const at = ctx.t + delay;
    ctx.tw(this.c.s, this.c.s.at(at), { at, d: D.pop, e: E.linear, fn: bump(0.02) });
  }
  /** New words on the line, where it stands. A maths line cannot be rewritten: show the next step instead. */
  override setValue(ctx: Ctx, value: number | string, delay = 0): void {
    if (this.math) return;
    super.setValue(ctx, String(value), delay);
    this.chars = Math.max(this.chars, String(value).length);
    this.flash(ctx, delay + 120 * ctx.pace);
  }
  override apply(t: number): void {
    super.apply(t);
    if (this.c.o.at(t) <= 0.004) return;
    setO(this.plate, this.x.lit.at(t));
    setO(this.glowEl, this.x.glow.at(t));
    const r = this.x.rev.at(t);
    setProp(this.body, 'clip-path', r >= 0.999 ? 'none' : `inset(-30% ${f2(100 - r * this.span * 100)}% -30% 0)`);
  }
}

// ---------------------------------------------------------------------------------------------
// Parts that belong to a line and travel with it (they are children of the line's row)
// ---------------------------------------------------------------------------------------------

/** A value beside a line: a variable's current value. It ticks over (the old value leaves upwards, the new one rises in) and glows. */
class Value extends Box {
  override readonly kind: string = 'value';
  readonly host: Line;
  readonly glow = new Chan(0);
  private readonly unitText: string;
  private readonly glowEl: HTMLElement;
  /** No value yet: the read-out arrives with its first `set`. */
  private waiting: boolean;
  /** Set by the stage when this value sits under a full line and the row for it is not open yet: called once, as it first appears. */
  open: ((ctx: Ctx, delay: number) => void) | null = null;

  /** `places`: the decimals its number is shown with when a formula will drive it. */
  constructor(d: NonNullable<LinesData['values']>[number], host: Line, private readonly places?: number) {
    super({ id: d.id, label: d.value === undefined ? '' : `${typeof d.value === 'number' && places !== undefined ? format(d.value, places) : d.value}${d.unit ?? ''}`, cls: 'st-ln-val' }, host.el);
    this.host = host;
    this.hud = true;
    this.unitText = d.unit ?? '';
    this.waiting = d.value === undefined;
    if (this.waiting) this.c.o.base = 0;
    this.glowEl = this.el.insertBefore(h('span', 'st-ln-valglow'), first(this.el, 'st-ring'));
    if (d.label !== undefined) this.el.insertBefore(h('span', 'st-ln-key', d.label), first(this.el, 'st-txt'));
  }
  override setValue(ctx: Ctx, value: number | string, delay = 0): void {
    const text = `${typeof value === 'number' && this.places !== undefined ? format(value, this.places) : value}${this.unitText}`;
    const at = ctx.t + delay;
    const hidden = this.c.o.at(at) < 0.5 && this.c.o.end < 0.5;
    if (this.waiting) {
      this.waiting = false;
      this.texts[0] = text;
    } else if (this.texts[this.texts.length - 1] !== text) {
      this.texts.push(text);
      ctx.tw(this.c.ti, this.texts.length - 1, hidden ? { at, d: 0 } : { at, d: D.tone, e: E.move });
    }
    if (hidden) this.enter(ctx, delay, 'pop');
    else ctx.tw(this.c.s, this.c.s.at(at), { at, d: D.pop * 0.8, e: E.linear, fn: bump(0.09) });
    ctx.tw(this.glow, 0, { at: at + (hidden && this.lead ? this.lead * ctx.pace : 0), d: 1100, e: E.linear, fn: glow(1) });
  }
  private lead = 0;
  override enter(ctx: Ctx, delay = 0, from = 'pop'): void {
    this.lead = 0;
    if (this.open) {
      // The lines below move down first; the value lands in the room they leave.
      this.open(ctx, delay);
      this.open = null;
      this.lead = 150;
    }
    super.enter(ctx, delay + this.lead * ctx.pace, from);
  }
  /** While the learner explores, a bound value shows the number its formula gives, with its unit. */
  override apply(t: number, live?: Live): void {
    super.apply(t, live ? { v: live.v, s: live.s + this.unitText } : undefined);
    setO(this.glowEl, this.glow.at(t));
  }
  override rest(): Rect {
    return this.host.rest();
  }
}

/** A callout under a line. Opening it moves the lines below down first; closing it lets them back. */
class Note extends Box {
  override readonly kind: string = 'annotation';
  readonly host: Line;
  private open = false;
  /** The height it opens for itself under its line. */
  readonly room: number;
  private readonly makeRoom: (ctx: Ctx, after: number, dy: number, delay: number) => void;

  constructor(d: NonNullable<LinesData['annotations']>[number], host: Line, room: number, makeRoom: Note['makeRoom']) {
    super({ id: d.id, label: d.text, cls: 'st-ln-note', tone: d.tone ?? 'accent' }, host.el);
    this.host = host;
    this.hud = true;
    this.room = room;
    this.makeRoom = makeRoom;
    this.c.o.base = 0;
  }
  override startHidden(): void {
    this.c.o.base = 0;
  }
  get isOpen(): boolean {
    return this.open;
  }
  override enter(ctx: Ctx, delay = 0): void {
    if (this.open) return;
    this.open = true;
    this.makeRoom(ctx, this.host.index, this.room, delay);
    super.enter(ctx, delay + 130 * ctx.pace, 'above');
  }
  override exit(ctx: Ctx, delay = 0): void {
    if (!this.open) return;
    this.open = false;
    super.exit(ctx, delay);
    this.makeRoom(ctx, this.host.index, -this.room, delay + 110 * ctx.pace);
  }
  override rest(): Rect {
    return this.host.rest();
  }
}

// ---------------------------------------------------------------------------------------------
// Parts that move between lines. Their place is a (fractional) line number, so they follow the
// lines when an annotation opens above them.
// ---------------------------------------------------------------------------------------------
type RowAt = (f: number, t: number) => { top: number; h: number };
/** Where a bracket over lines i..j can put its label without covering text or a value: a distance along the row, on the top or the bottom edge. */
type TabAt = (i: number, j: number) => { x: number; edge: 0 | 1; dy: number };
/** A pointer's tab: its label, and the arrowhead it ends in. */
const ptrWidth = (label: string): number => Math.round(textWidth(label, 12, 700) + 26);

class Pointer extends Box {
  override readonly kind: string = 'pointer';
  readonly row = new Chan(0);
  private readonly rowAt: RowAt;
  private readonly rowH: number;
  private readonly beam: HTMLElement;
  private readonly band: { x: number; w: number };
  private readonly origin: Origin;

  constructor(d: NonNullable<LinesData['pointers']>[number], world: Element, under: Element, rowAt: RowAt, rowH: number, band: { x: number; w: number }, origin: Origin) {
    super({ id: d.id, label: d.label ?? '', cls: `st-ln-ptr${d.label ? '' : ' st-ln-ptr-bare'}`, tone: d.tone ?? 'accent' }, world);
    this.origin = origin;
    this.hud = true;
    this.rowAt = rowAt;
    this.rowH = rowH;
    this.band = band;
    this.c.o.base = 0;
    this.beam = under.appendChild(h('span', 'st-ln-beam'));
  }
  override startHidden(): void {
    this.c.o.base = 0;
  }
  /** Go to line i. The first time it drops in beside the line; after that it travels, and swings out on a long jump. */
  go(ctx: Ctx, i: number): void {
    const c = this.c;
    if (c.o.end < 0.5) {
      this.row.to(i, ctx.t, 0);
      this.enter(ctx, 0, 'left');
      return;
    }
    const rows = Math.abs(i - this.row.end);
    if (rows < 0.01) {
      this.pulse(ctx, 0, 0.1);
      return;
    }
    const d = D.move * clamp(0.8 + 0.13 * rows, 0.9, 1.7);
    const end = ctx.tw(this.row, i, { d, e: HEAVY });
    if (rows > 1.5) ctx.tw(c.dx, c.dx.end, { d, e: E.soft, fn: bump(-7) });
    // It lands, then settles.
    ctx.tw(c.s, 1, { at: end - 150 * ctx.pace, d: 300, e: E.linear, fn: bump(0.1) });
  }
  override setValue(ctx: Ctx, value: number | string, delay = 0): void {
    super.setValue(ctx, value, delay);
    const w = ptrWidth(String(value));
    if (w > this.c.w.end) ctx.tw(this.c.w, w, { at: ctx.t + delay, d: D.tone, e: E.move });
  }
  override apply(t: number): void {
    const g = this.rowAt(this.row.at(t), t);
    this.c.y.base = g.top + Math.min(g.h, this.rowH) / 2;
    super.apply(t);
    const o = this.c.o.at(t);
    setO(this.beam, o);
    if (o <= 0.004) return;
    setSize(this.beam, this.band.w, g.h);
    setT(this.beam, this.band.x, g.top);
  }
  override rest(): Rect {
    const g = this.rowAt(this.row.end, Infinity);
    return { x: this.c.x.end, y: g.top + g.h / 2 + this.origin(), w: this.c.w.end, h: g.h };
  }
}

class Bracket extends Box {
  override readonly kind: string = 'bracket';
  readonly r0 = new Chan(0);
  readonly r1 = new Chan(0);
  /** Where the label sits: how far along the edge, on which edge (0 the top, 1 the bottom), and how far off it. */
  private readonly tab = new Chan(0);
  private readonly edge = new Chan(0);
  private readonly tabDy = new Chan(-9);
  private readonly tabAt: TabAt;
  private readonly tabEl: HTMLElement;
  private readonly rowAt: RowAt;
  private readonly origin: Origin;

  constructor(d: NonNullable<LinesData['brackets']>[number], under: Element, rowAt: RowAt, tabAt: TabAt, origin: Origin) {
    super({ id: d.id, label: d.label ?? '', cls: `st-ln-bracket${d.label ? '' : ' st-ln-bracket-bare'}`, tone: d.tone ?? 'accent' }, under);
    this.hud = true;
    this.rowAt = rowAt;
    this.tabAt = tabAt;
    this.origin = origin;
    this.tabEl = first(this.el, 'st-txt');
    this.c.o.base = 0;
  }
  override startHidden(): void {
    this.c.o.base = 0;
  }
  /** Span lines i..j. The first time it closes in round them; after that the leading edge goes first and the other follows. */
  go(ctx: Ctx, i: number, j: number): void {
    const c = this.c;
    if (c.o.end < 0.5) {
      this.r0.to(i, ctx.t, 0);
      this.r1.to(j, ctx.t, 0);
      const spot = this.tabAt(i, j);
      this.tab.to(spot.x, ctx.t, 0);
      this.edge.to(spot.edge, ctx.t, 0);
      this.tabDy.to(spot.dy, ctx.t, 0);
      c.dy.to(0, ctx.t, 0);
      c.dx.to(0, ctx.t, 0);
      c.s.to(1.05, ctx.t, 0);
      ctx.tw(c.o, 1, { d: D.enter * 0.6, e: E.out });
      ctx.tw(c.s, 1, { d: D.enter, e: E.enter });
      return;
    }
    const rows = Math.max(Math.abs(i - this.r0.end), Math.abs(j - this.r1.end));
    if (rows < 0.01) return;
    const d = D.move * clamp(0.85 + 0.12 * rows, 0.9, 1.7);
    const down = i + j > this.r0.end + this.r1.end;
    const lag = 70 * ctx.pace;
    ctx.tw(this.r0, i, { at: ctx.t + (down ? lag : 0), d, e: E.move });
    ctx.tw(this.r1, j, { at: ctx.t + (down ? 0 : lag), d, e: E.move });
    const spot = this.tabAt(i, j);
    ctx.tw(this.tab, spot.x, { d, e: E.move });
    ctx.tw(this.edge, spot.edge, { d, e: E.move });
    ctx.tw(this.tabDy, spot.dy, { d, e: E.move });
  }
  override enter(ctx: Ctx, delay = 0): void {
    const at = ctx.t + delay;
    this.c.dy.to(0, at, 0);
    this.c.s.to(1.05, at, 0);
    ctx.tw(this.c.o, 1, { at, d: D.enter * 0.6, e: E.out });
    ctx.tw(this.c.s, 1, { at, d: D.enter, e: E.enter });
  }
  override apply(t: number): void {
    const a = this.rowAt(this.r0.at(t), t);
    const b = this.rowAt(this.r1.at(t), t);
    const top = a.top - 3;
    const bottom = b.top + b.h + 3;
    this.c.y.base = (top + bottom) / 2;
    this.c.h.base = Math.max(8, bottom - top);
    super.apply(t);
    setProp(this.tabEl, 'left', `${f2(this.tab.at(t) + 5)}px`);
    setProp(this.tabEl, 'top', `${f2(this.edge.at(t) * this.c.h.base + this.tabDy.at(t))}px`);
  }
  override rest(): Rect {
    const a = this.rowAt(this.r0.end, Infinity);
    const b = this.rowAt(this.r1.end, Infinity);
    return { x: this.c.x.end, y: (a.top + b.top + b.h) / 2 + this.origin(), w: this.c.w.end, h: b.top + b.h - a.top };
  }
}

/** The travelling copy of a derivation step: it leaves the line above and turns into the next one. */
class Ghost implements Part {
  readonly id: string;
  readonly kind = 'ghost';
  readonly c = { o: new Chan(0), u: new Chan(0) };
  hud = true;
  private readonly el: HTMLElement;
  private readonly src: Line;
  private readonly dst: Line;
  private readonly left: number;

  constructor(id: string, src: Line, dst: Line, parent: Element, box: { left: number; w: number }) {
    this.id = id;
    this.src = src;
    this.dst = dst;
    this.left = box.left;
    this.el = parent.appendChild(h('div', 'st-p st-ln-ghost'));
    if (src.math) this.el.appendChild(src.math.cloneNode(true));
    else this.el.textContent = src.texts[src.texts.length - 1] ?? '';
    setSize(this.el, box.w, src.c.h.base);
  }
  apply(t: number): void {
    const o = this.c.o.at(t);
    setO(this.el, o);
    if (o <= 0.004) return;
    const u = this.c.u.at(t);
    const a = this.src.c;
    const b = this.dst.c;
    const ya = a.y.at(t) - a.h.at(t) / 2;
    const yb = b.y.at(t) - b.h.at(t) / 2;
    setT(this.el, this.left, ya + (yb - ya) * u, 1 - 0.04 * Math.sin(Math.PI * u));
  }
  rest(): Rect {
    return this.dst.rest();
  }
}

// ---------------------------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------------------------

/** Each line's MathML as the page carries it, keyed by line id. Looked up once per build; never built from a selector made of lesson text. */
function pageMath(stage: Element): Map<string, Element[]> {
  const out = new Map<string, Element[]>();
  let scope: Element | null = stage;
  for (let up = 0; scope && up < 8; up++, scope = scope.parentElement) {
    const list = scope.getElementsByClassName('lt-xs-lines')[0];
    if (list) {
      for (const li of Array.from(list.children)) {
        const id = li.getAttribute('data-line');
        const maths = Array.from(li.getElementsByTagName('math'));
        if (id && maths.length) out.set(id, maths);
      }
      break;
    }
    if (scope.tagName === 'SECTION') break;
  }
  return out;
}

/** How many rows a line of code takes when it must wrap: it breaks after a space where it can, and the rest hangs under its own indentation. */
function wrapRows(text: string, perRow: number, hang: number): number {
  let rows = 1;
  let left = text;
  let cap = perRow;
  while (left.length > cap) {
    const cut = left.lastIndexOf(' ', cap);
    left = left.slice(cut > cap * 0.4 ? cut + 1 : cap);
    cap = Math.max(6, perRow - hang);
    rows++;
  }
  return rows;
}

export class LinesStage extends Stage<LinesData> {
  private readonly line: Line[] = [];
  private readonly fmt: Format;
  /** A window on the lines. When they are taller than the stage it clips them and `scroll` moves them through it. */
  private readonly view: HTMLElement;
  private readonly pan: HTMLElement;
  private readonly col: HTMLElement;
  private readonly under: HTMLElement;
  private readonly scroll = new Chan(0);
  private readonly scrolls: boolean;
  private readonly viewTop: number;
  private readonly viewH: number;
  /** Height of one row of text, and the box a derivation's travelling copy needs. */
  private readonly rowH: number;
  private readonly ghostBox: { left: number; w: number };
  private readonly notes: Note[] = [];

  constructor(data: LinesData, env: StageEnv) {
    super(data, env);
    const { W, narrow } = this;
    const fmt = (this.fmt = data.format);
    const code = fmt === 'code';
    const math = fmt === 'math';
    const n = data.lines.length;

    // ---- the label that code always carries, top left, outside the camera. The stage's own badge
    // (where the content comes from) has the top right corner; on a stage too narrow for both, this
    // kit starts below it.
    const clear = W < BADGE_ROOM ? BADGE_H : 0;
    let top = clear + (narrow ? 8 : 18);
    if (code) {
      const flag = this.hud.appendChild(h('p', 'st-ln-flag'));
      if (data.language) flag.appendChild(h('span', 'st-ln-lang', data.language));
      flag.appendChild(h('span', 'st-ln-warn', LINES_CODE_LABEL));
      const w = textWidth(LINES_CODE_LABEL, 11, 400) + (data.language ? textWidth(data.language.toUpperCase(), 11, 700) * 1.1 + 10 : 0);
      const flagTop = clear ? clear + 2 : 18;
      setProp(flag, 'top', `${flagTop}px`);
      top = flagTop + Math.ceil(w / (W - 28)) * 16 + (narrow ? 6 : 12);
    }
    const availH = this.floor - top - (narrow ? 4 : 8);
    this.viewTop = top;
    this.viewH = availH;
    this.view = this.world.appendChild(h('div', 'st-p st-ln-view'));
    setT(this.view, 0, top);
    setSize(this.view, W, availH);
    this.pan = this.view.appendChild(h('div', 'st-ln-pan'));
    this.under = this.pan.appendChild(h('div', 'st-ln-under'));
    this.col = this.pan.appendChild(h('div', 'st-ln-col'));

    // ---- columns: pointers, line numbers, text, values
    const ptrs = data.pointers ?? [];
    const ptrW = ptrs.map((p) => (p.label ? ptrWidth(p.label) : 24));
    const P = ptrW.reduce((a, w) => a + w + 4, 0);
    // On a maths or text stage the type is large, and the values beside it are set larger to match.
    const valPx = code ? (narrow ? 13 : 15) : narrow ? 14 : 17;
    const vals = (data.values ?? []).map((v) => {
      const texts = [...(v.value === undefined ? [] : [String(v.value)]), ...(env.texts.get(v.id) ?? [])];
      const longest = Math.max(1, ...texts.map((x) => x.length)) + (v.unit ?? '').length;
      return { d: v, i: Number(v.at.slice(1)) - 1, w: Math.round((v.label ? textWidth(v.label, valPx - 1, 600) + 7 : 0) + longest * valPx * MONO + 24) };
    });
    const valRow = Array.from({ length: n }, (_, i) => vals.filter((v) => v.i === i).reduce((a, v) => a + v.w + 6, 0));
    const valCol = Math.max(0, ...valRow);
    const padX = narrow ? 6 : 28;
    const gapX = narrow ? 6 : 10;
    const endX = narrow ? 4 : 10;
    const lens = data.lines.map((l) => l.length);
    const indents = data.lines.map((l) => (code ? l.length - l.trimStart().length : 0));
    const maxChars = Math.max(1, ...lens);
    const digits = String(n).length;
    const noW = (fs: number): number => (code ? Math.round(digits * fs * 0.78 * MONO + (narrow ? 8 : 14)) : Math.round(fs * 1.2));
    const adv = code ? MONO : math ? 0.5 : PROSE;

    /** Everything that depends on the type size. `beside`: the values have a column of their own after the text. */
    const plan = (fs: number, beside: boolean, mathW = 0) => {
      const nw = noW(fs);
      const textX = nw + gapX;
      const side = beside && valCol ? valCol + 14 : 0;
      const room = W - 2 * padX - P - textX - side - endX;
      const perRow = Math.max(8, Math.floor(room / (fs * adv)));
      const rows = lens.map((len, i) => (math ? 1 : code ? wrapRows(data.lines[i] as string, perRow, (indents[i] as number) + 2) : Math.max(1, Math.ceil((len * 1.04) / perRow))));
      const textW = math ? Math.min(room, Math.ceil(mathW > 0 ? mathW + fs * 1.6 : Math.max(200, maxChars * fs * 0.46))) : Math.min(room, Math.ceil(Math.min(maxChars, perRow) * fs * adv) + 2);
      const rowH = Math.round(fs * (math ? 2 : code ? 1.62 : 1.7));
      const rowW = textX + textW + side + endX;
      const valH = clamp(rowH - 4, 18, valPx + 13);
      /** Where each line's text ends; and whether its values, with no column of their own, must go under it. */
      const textEnd = lens.map((len, i) => textX + ((rows[i] as number) > 1 ? textW : Math.min(textW, Math.ceil(len * fs * adv))));
      const under = lens.map((_, i) => !side && (valRow[i] as number) > 0 && (textEnd[i] as number) + 10 + (valRow[i] as number) - 6 > rowW - endX);
      // A fraction or a large operator puts two rows of symbols where other lines have one.
      const textH = rows.map((r, i) => (math && /\\(frac|sum|prod|int)/.test(data.lines[i] as string) ? Math.round(fs * 3) : rowH + (r - 1) * Math.round(fs * 1.34)));
      const heights = textH.map((hh, i) => hh + (under[i] ? valH + 5 : 0));
      return { fs, nw, textX, textW, room, perRow, rows, rowH, valH, textEnd, under, textH, heights, rowW, beside: side > 0, linesH: heights.reduce((a, b) => a + b, 0) };
    };
    // The type is as large as the width allows, up to a ceiling; then as large as the height
    // allows, down to a size that is still comfortable to read. Below that the lines keep their
    // size and scroll through the window instead.
    const fsMax = code ? (narrow ? 14 : 22) : math ? clamp(W * 0.05 + 8, 22, 36) : clamp(W * 0.026, 16, 26);
    const fsMin = code ? (narrow ? 11 : 12) : math ? 15 : 14;
    const comfy = code ? (narrow ? 12 : 15) : math ? (narrow ? 17 : 21) : narrow ? 15 : 17;
    const fitW = (beside: boolean): number => {
      if (!code) return fsMax;
      const fixed = 2 * padX + P + (narrow ? 8 : 14) + gapX + (beside && valCol ? valCol + 14 : 0) + endX;
      return clamp(Math.floor((10 * (W - fixed)) / (maxChars * MONO + digits * 0.78 * MONO)) / 10, fsMin, fsMax);
    };
    let beside = valCol > 0;
    let fs = fitW(beside);
    // Too tight for a column of values: they sit over the right-hand end of their rows instead.
    if (beside && code && fs < Math.min(13, fsMax)) {
      beside = false;
      fs = fitW(false);
    }
    let g = plan(fs, beside);
    if (g.linesH > availH) {
      fs = Math.max(Math.min(comfy, fs), Math.floor((10 * fs * availH) / g.linesH) / 10);
      g = plan(fs, beside);
    }
    // Maths is the one thing whose width cannot be known from its source: build the lines, and where
    // there is a layout engine ask it. A line wider than the stage brings the type down with it.
    const maths = math ? pageMath(env.el) : null;
    const origin = (t?: number): number => this.viewTop - (t === undefined ? this.scroll.end : this.scroll.at(t));
    this.view.dataset.format = fmt;
    setProp(this.pan, 'font-size', `${f2(g.fs)}px`);
    const lines = data.lines.map((text, i) => new Line(i, text, fmt, this.col, maths?.get(`l${i + 1}`) ?? null, origin));
    if (math) {
      let widest = Math.max(0, ...lines.map((ln) => ln.mathWidth()));
      if (widest + g.fs * 1.6 > g.room && widest > 0) {
        const k = Math.max(0.5, g.room / (widest + g.fs * 1.6));
        fs = Math.floor(10 * g.fs * k) / 10;
        widest *= fs / g.fs;
      }
      if (widest > 0) g = plan(fs, beside, widest);
    }

    // ---- annotations: under their line, as wide as the text column allows
    const noteFs = narrow ? 12 : 13.5;
    const notes = (data.annotations ?? []).map((a) => {
      const natural = textWidth(a.text, noteFs, 500);
      const w = Math.round(clamp(natural + 28, 120, Math.max(160, g.rowW - g.textX - 4)));
      const rows = Math.max(1, Math.ceil((natural * 1.08) / (w - 28)));
      return { d: a, i: Number(a.at.slice(1)) - 1, w, h: Math.round(rows * noteFs * 1.38 + (narrow ? 12 : 16)) };
    });
    const notesH = notes.reduce((a, b) => a + b.h + 10, 0);
    this.scrolls = g.linesH + notesH > availH + 1;
    this.rowH = g.rowH;
    setProp(this.pan, 'font-size', `${f2(g.fs)}px`);
    setProp(this.pan, '--ln-nw', `${g.nw}px`);
    setProp(this.pan, '--ln-tx', `${g.textX}px`);
    setProp(this.pan, '--ln-tw', `${g.textW}px`);
    setProp(this.pan, '--ln-rh', `${g.rowH}px`);
    setProp(this.pan, '--ln-note', `${noteFs}px`);
    setProp(this.pan, '--ln-val', `${valPx}px`);
    if (g.rows.some((r) => r > 1)) this.view.dataset.wrap = 'true';
    if (this.scrolls) this.view.dataset.scroll = 'true';

    // ---- place the lines (coordinates are the window's own)
    const blockW = P + g.rowW;
    const x0 = Math.max(padX, Math.round((W - blockW) / 2));
    const rowX = x0 + P;
    let y = this.scrolls ? 0 : Math.max(0, Math.min((availH - g.linesH - notesH * 0.5) / 2, availH - g.linesH - notesH));
    // A row under a line, for values that have no room beside it, is opened when the first of them
    // appears; it is there from the start only when one of them starts on stage.
    const opens = lens.map((_, i) => g.under[i] === true && vals.filter((v) => v.i === i).every((v) => v.d.value === undefined));
    lines.forEach((ln, i) => {
      const text = data.lines[i] as string;
      const hh = opens[i] ? (g.textH[i] as number) : (g.heights[i] as number);
      ln.place({ x: rowX + g.rowW / 2, y: y + hh / 2, w: g.rowW, h: hh });
      ln.span = math || (g.rows[i] as number) > 1 ? 1 : clamp((text.length * g.fs * adv + 4) / g.textW, 0.05, 1);
      if (code && (g.rows[i] as number) > 1) ln.hang((indents[i] as number) + 2);
      if (g.under[i]) ln.textHeight(g.textH[i] as number);
      this.line.push(this.add(ln));
      y += hh;
    });
    this.ghostBox = { left: rowX + g.textX, w: g.textW };

    const rowAt: RowAt = (f, t) => this.rowAt(f, t);
    // ---- pointers, each in its own gutter column
    const over = this.pan.appendChild(h('div', 'st-ln-over'));
    let px = x0;
    ptrs.forEach((p, k) => {
      const w = ptrW[k] as number;
      const part = new Pointer(p, over, this.under, rowAt, g.rowH, { x: rowX, w: g.rowW }, origin);
      part.place({ x: px + w / 2, y: 0, w, h: Math.min(24, g.rowH - 2) });
      this.add(part);
      px += w + 4;
    });
    // ---- values: in their column, or over the right-hand end of the row when there is no room for one
    const used = new Map<number, number>();
    /** For each line, where the first value on it begins. A bracket's label goes between the text and that. */
    const valStart = lens.map(() => g.rowW);
    for (const v of vals) {
      const host = this.line[v.i];
      if (!host) throw new Error(`The value "${v.d.id}" sits beside "${v.d.at}", which is not a line of this stage.`);
      const before = used.get(v.i) ?? 0;
      const under = g.under[v.i] === true;
      const left = (g.beside ? g.textX + g.textW + 14 : under ? g.rowW - endX - (valRow[v.i] as number) + 6 : (g.textEnd[v.i] as number) + 10) + before;
      const part = new Value(v.d, host, env.explore?.dp.get(v.d.id));
      part.place({ x: left + v.w / 2, y: under ? (g.textH[v.i] as number) + g.valH / 2 : (g.textH[v.i] as number) / 2, w: v.w, h: g.valH });
      if (opens[v.i]) {
        const room = (g.heights[v.i] as number) - (g.textH[v.i] as number);
        part.open = (ctx, delay) => {
          if (!opens[v.i]) return;
          opens[v.i] = false;
          host.grow(ctx, room, delay);
          this.makeRoom(ctx, v.i, room, delay);
        };
      }
      this.add(part);
      valStart[v.i] = under ? g.textX : Math.min(valStart[v.i] as number, left);
      used.set(v.i, before + v.w + 6);
    }
    for (const b of data.brackets ?? []) {
      const tabW = b.label ? Math.round(textWidth(b.label.toUpperCase(), 11, 700) * 1.06 + 18) : 0;
      /**
       * The label needs a clear stretch on every line it touches: after the text, before any value.
       * It tries, in order: astride the top edge, astride the bottom edge, just inside the top,
       * just inside the bottom, hanging under the box, sitting on top of it.
       */
      const clear = (rows: number[]): number | null => {
        const near = rows.filter((r) => r >= 0 && r < n);
        const from = Math.max(g.textX, ...near.map((r) => g.textEnd[r] as number)) + 12;
        const to = Math.min(g.rowW, ...near.map((r) => valStart[r] as number)) - 6;
        return to - from >= tabW ? to - tabW : null;
      };
      const tabAt: TabAt = (i, j) => {
        const tries: [number[], 0 | 1, number][] = [
          [[i - 1, i], 0, -9],
          [[j, j + 1], 1, -9],
          [[i], 0, 3],
          [[j], 1, -21],
          [[j + 1], 1, 3],
          [[i - 1], 0, -21],
        ];
        for (const [rows, edge, dy] of tries) {
          const x = clear(rows);
          if (x !== null) return { x, edge, dy };
        }
        return { x: Math.max(g.textX, g.rowW - tabW - 8), edge: 0, dy: -9 };
      };
      const part = new Bracket(b, this.under, rowAt, tabAt, origin);
      part.place({ x: rowX + g.rowW / 2, y: 0, w: g.rowW + 10, h: g.rowH });
      this.add(part);
    }
    for (const a of notes) {
      const host = this.line[a.i];
      if (!host) throw new Error(`The annotation "${a.d.id}" is attached to "${a.d.at}", which is not a line of this stage.`);
      const part = new Note(a.d, host, a.h + 10, (ctx, after, dy, delay) => this.makeRoom(ctx, after, dy, delay));
      part.place({ x: g.textX + a.w / 2, y: (g.heights[a.i] as number) + 4 + a.h / 2, w: a.w, h: a.h });
      this.notes.push(this.add(part));
    }
  }

  /** Top and height of a (fractional) line number at time t. Past either end it carries on at the same pitch, so an overshoot has somewhere to go. */
  private rowAt(f: number, t: number): { top: number; h: number } {
    const last = this.line.length - 1;
    const i = clamp(Math.floor(f), 0, last);
    const u = f - i;
    const a = this.line[i] as Line;
    const at = (c: Chan): number => (t === Infinity ? c.end : c.at(t));
    const ah = at(a.c.h);
    const atop = at(a.c.y) - ah / 2;
    const b = this.line[clamp(u < 0 ? i - 1 : i + 1, 0, last)] as Line;
    if (b === a) return { top: atop + u * ah, h: ah };
    const bh = at(b.c.h);
    const btop = at(b.c.y) - bh / 2;
    const k = Math.abs(u);
    return { top: atop + (btop - atop) * k, h: ah + (bh - ah) * k };
  }
  /** The lines after `after` move by dy: an annotation is opening (or closing) above them. */
  private makeRoom(ctx: Ctx, after: number, dy: number, delay: number): void {
    for (let k = after + 1; k < this.line.length; k++) {
      const c = (this.line[k] as Line).c;
      ctx.tw(c.y, c.y.end + dy, { at: ctx.t + delay, d: D.move, e: E.move });
    }
  }
  /**
   * Keep lines i..j in the window (with a line of context either side), when the lines are taller
   * than the stage. The window moves only when a verb asks for something outside it.
   */
  private follow(ctx: Ctx, i: number, j: number, delay = 0): void {
    if (!this.scrolls) return;
    const a = this.line[clamp(i, 0, this.line.length - 1)] as Line;
    const b = this.line[clamp(j, 0, this.line.length - 1)] as Line;
    const last = this.line[this.line.length - 1] as Line;
    const under = (ln: Line): number => this.notes.filter((nt) => nt.host === ln && nt.isOpen).reduce((sum, nt) => sum + nt.room, 0);
    const margin = this.rowH * 1.1;
    const top = a.c.y.end - a.c.h.end / 2 - margin;
    const bottom = b.c.y.end + b.c.h.end / 2 + under(b) + margin;
    const max = Math.max(0, last.c.y.end + last.c.h.end / 2 + under(last) + 4 - this.viewH);
    let to = this.scroll.end;
    if (bottom > to + this.viewH) to = bottom - this.viewH;
    if (top < to) to = top;
    to = Math.round(clamp(to, 0, max));
    if (Math.abs(to - this.scroll.end) > 1) ctx.tw(this.scroll, to, { at: ctx.t + delay, d: D.camera * 0.6, e: E.move });
  }
  private lineIndex(id: string, verb: string): number {
    const p = this.parts.get(id);
    if (!(p instanceof Line)) throw new Error(`${verb}: "${id}" is not a line. Lines are l1 to l${this.line.length}.`);
    return p.index;
  }
  private range(pair: [string, string], verb: string): string[] {
    const i = this.lineIndex(pair[0], verb);
    const j = this.lineIndex(pair[1], verb);
    return this.line.slice(Math.min(i, j), Math.max(i, j) + 1).map((l) => l.id);
  }
  /** The line a part is, or belongs to; -1 for a part that has none (a stat). */
  private lineOf(p: Part): number {
    if (p instanceof Line) return p.index;
    if (p instanceof Value || p instanceof Note) return p.host.index;
    return -1;
  }
  /** Bring into the window whatever lines these parts are on. */
  private followParts(ctx: Ctx, ids: readonly string[], delay = 0): void {
    const rows = ids.map((id) => this.lineOf(this.get(id))).filter((i) => i >= 0);
    if (rows.length) this.follow(ctx, Math.min(...rows), Math.max(...rows), delay);
  }
  /** The nearest line above that is on stage: the one a new maths line grows out of. */
  private above(ln: Line): Line | null {
    for (let k = ln.index - 1; k >= 0; k--) if ((this.line[k] as Line).c.o.end > 0.5) return this.line[k] as Line;
    return null;
  }
  /** A derivation step: a copy of `src` lifts off, travels to `dst`'s row and turns into it. Returns the delay at which the next step may start. */
  private derive(ctx: Ctx, src: Line, dst: Line, delay: number): number {
    const pace = ctx.pace;
    const at = ctx.t + delay;
    const ghost = this.add(new Ghost(`${dst.id}~from`, src, dst, this.col, this.ghostBox));
    const d = D.move * 1.45;
    src.pulse(ctx, delay, -0.02);
    ctx.tw(ghost.c.o, 0.9, { at: at + 70 * pace, d: 110, e: E.out });
    const t0 = at + 110 * pace;
    const t1 = ctx.tw(ghost.c.u, 1, { at: t0, d, e: E.move });
    const cross = t0 + (t1 - t0) * 0.5;
    ctx.tw(ghost.c.o, 0, { at: cross, d: d * 0.5, e: E.soft });
    dst.land(ctx, cross - ctx.t, d * 0.5);
    return t1 - ctx.t + 80 * pace;
  }

  // ------------------------------------------------------------------------------------------ verbs
  override intro(ctx: Ctx): void {
    const ls = this.line.filter((l) => l.c.o.base === 1);
    const st = Math.max(stagger(ls.length), 45) * ctx.pace;
    ls.forEach((l, i) => {
      l.startHidden();
      l.enter(ctx, i * st);
    });
    let k = 0;
    for (const p of this.parts.values()) {
      if (!(p instanceof Value) || p.c.o.base !== 1) continue;
      p.startHidden();
      p.enter(ctx, ls.length * st + 120 * ctx.pace + k++ * 60 * ctx.pace, 'pop');
    }
    this.introStats(ctx);
  }
  override show(ctx: Ctx, a: ActionData): void {
    const ids = this.ids(a);
    const st = Math.max(stagger(ids.length), 70) * ctx.pace;
    let delay = 0;
    for (const id of ids) {
      const p = this.get(id);
      if (p instanceof Line) {
        const src = this.fmt === 'math' ? this.above(p) : null;
        if (src) {
          delay = this.derive(ctx, src, p, delay);
          continue;
        }
        p.enter(ctx, delay);
      } else if (p instanceof Value) p.enter(ctx, delay, 'pop');
      else if (p.enter) p.enter(ctx, delay, typeof a.from === 'string' ? a.from : p.hud ? 'left' : undefined);
      else throw new Error(`"${p.id}" is a ${p.kind}: it does not take "show" on this lines stage.`);
      delay += st;
    }
    this.followParts(ctx, ids);
  }
  override hide(ctx: Ctx, a: ActionData): void {
    super.hide(ctx, a);
    this.followParts(ctx, this.ids(a), 120 * ctx.pace);
  }
  /** move: a pointer goes to a line; a bracket goes to a line or to [first, last]. */
  move(ctx: Ctx, a: ActionData): void {
    const p = this.get(String(a.target));
    const to = a.to;
    if (p instanceof Pointer) {
      if (typeof to !== 'string') throw new Error(`move: the pointer "${p.id}" goes to one line, for example to: "l3".`);
      const i = this.lineIndex(to, 'move');
      p.go(ctx, i);
      this.follow(ctx, i, i);
    } else if (p instanceof Bracket) {
      const pair = typeof to === 'string' ? ([to, to] as [string, string]) : pairOf(to);
      if (!pair) throw new Error(`move: the bracket "${p.id}" goes to a line or to [first, last].`);
      const i = this.lineIndex(pair[0], 'move');
      const j = this.lineIndex(pair[1], 'move');
      p.go(ctx, Math.min(i, j), Math.max(i, j));
    } else throw new Error(`move works on a pointer or a bracket; "${String(a.target)}" is neither.`);
  }
  /** set: `value` on a value beside a line (or a stat), `label` for new words on a part, `tone` on anything. */
  override set(ctx: Ctx, a: ActionData): void {
    const between = pairOf(a.between);
    const ids = between ? this.range(between, 'set') : this.ids(a);
    const st = stagger(ids.length) * ctx.pace;
    const others: string[] = [];
    ids.forEach((id, i) => {
      const p = this.get(id);
      const own = p instanceof Line || p instanceof Value || p instanceof Note || p instanceof Pointer || p instanceof Bracket;
      if (!own) {
        others.push(id);
        return;
      }
      if (typeof a.tone === 'string') p.setTone(ctx, a.tone, i * st);
      const text = p instanceof Value ? a.value : (a.label ?? a.value);
      if (typeof text === 'string' || typeof text === 'number') p.setValue(ctx, text, i * st);
    });
    if (others.length) super.set(ctx, { ...a, target: undefined, targets: others });
    this.followParts(ctx, ids);
  }
  /** A focus names lines one by one or as `between: [first, last]`. A value or an annotation brings its line with it. */
  override focusSet(a: ActionData): Set<string> {
    const between = pairOf(a.between);
    const want = new Set(between ? this.range(between, 'focus') : this.ids(a));
    for (const id of [...want]) {
      const p = this.parts.get(id);
      if (p instanceof Value || p instanceof Note) want.add(p.host.id);
    }
    return want;
  }
  override focus(ctx: Ctx, a: ActionData): void {
    // The window and the camera would fight over the same lines: when the lines scroll, a focus does not zoom.
    super.focus(ctx, this.scrolls ? { ...a, zoom: false } : a);
    const want = this.focusSet(a);
    for (const ln of this.line) {
      const lit = want.has(ln.id) ? 1 : 0;
      if (ln.x.lit.end !== lit) ctx.tw(ln.x.lit, lit, { d: D.dim, e: E.out });
    }
    this.followParts(ctx, [...want]);
  }
  override apply(t: number, x?: ExploreState): void {
    super.apply(t, x);
    setT(this.pan, 0, -this.scroll.at(t));
  }
}

registerKit('lines', (data: LinesData, env) => new LinesStage(data, env));
