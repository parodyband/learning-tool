// Cells stage: a row of cells (an array, a tape, a queue) with pointers that walk it and brackets
// that span a range.
import { type ActionData, Box, type Ctx, D, E, type ExploreState, type Part, Stage, type StageEnv, type StatData, type TapTarget, bump, clamp, h, registerKit, setData, setSize, setT, stagger, textWidth, travel } from './kit';

interface CellsData {
  kind: 'cells';
  cells: { id: string; label: string }[];
  indices?: boolean;
  pointers?: { id: string; label: string; side?: 'above' | 'below'; tone?: string }[];
  brackets?: { id: string; label?: string }[];
  stats?: StatData[];
}

export class CellsStage extends Stage<CellsData> {
  private readonly cw: number;
  private readonly ch: number;
  private readonly cy: number;
  private readonly gap: number;
  private readonly x0: number;
  /** cell id -> slot index, as it will be once everything scheduled so far has played */
  private readonly slotOf = new Map<string, number>();
  /** slot index -> cell id, likewise */
  private readonly at: string[] = [];
  private readonly brackets: Box[] = [];
  /** Where each pointer rests once everything scheduled so far has played: its cell, and how far out it is stacked. */
  private readonly ptr = new Map<string, { box: Box; side: 'above' | 'below'; slot: number; lane: number }>();
  private readonly ptrH: number;
  private readonly lane: number;
  private aboveY = 0;
  private belowY = 0;

  constructor(data: CellsData, env: StageEnv) {
    super(data, env);
    const { W, narrow } = this;
    const n = data.cells.length;
    const pad = narrow ? 10 : 40;
    const gap = (this.gap = narrow ? 3 : 8);
    const cw = (this.cw = Math.floor(clamp((W - 2 * pad - gap * (n - 1)) / n, 16, 118)));
    const ch = (this.ch = Math.round(clamp(cw * 0.94, 38, 108)));
    const rowW = n * cw + (n - 1) * gap;
    this.x0 = (W - rowW) / 2 + cw / 2;
    const pointers = data.pointers ?? [];
    const above = pointers.filter((p) => p.side === 'above').length;
    const below = pointers.length - above;
    const ptrH = (this.ptrH = narrow ? 22 : 30);
    const lane = (this.lane = ptrH + 7);
    const brPad = (data.brackets ?? []).some((b) => b.label) ? (narrow ? 24 : 24) : 0;
    const idxPad = data.indices ? (narrow ? 18 : 22) : 0;
    const cy = (this.cy = Math.round(clamp(this.floor * 0.5, 16 + brPad + above * lane + 14 + ch / 2, this.floor - ch / 2 - idxPad - 14 - below * lane)));

    const size = cw < 30 ? 'tight' : cw < 56 ? 'small' : cw < 88 ? 'medium' : 'large';
    this.aboveY = cy - ch / 2 - 13 - brPad - ptrH / 2;
    this.belowY = cy + ch / 2 + 13 + idxPad + ptrH / 2;
    data.cells.forEach((c, i) => {
      const b = this.add(new Box({ id: c.id, label: c.label, cls: `st-cell st-cell-${size}` }, this.world));
      b.role = 'cell';
      b.place({ x: this.slotX(i), y: cy, w: cw, h: ch });
      this.slotOf.set(c.id, i);
      this.at[i] = c.id;
      if (data.indices) {
        // The index belongs to the slot, not to the cell: it stays put when cells trade places.
        const ix = this.world.appendChild(h('span', 'st-p st-idx', String(i)));
        setT(ix, this.slotX(i) - cw / 2, cy + ch / 2 + 6);
        setSize(ix, cw, 16);
      }
    });

    for (const p of pointers) {
      const side = p.side === 'above' ? 'above' : 'below';
      const w = Math.max(narrow ? 28 : 40, Math.round(textWidth(p.label, narrow ? 12 : 14.5, 750) + (narrow ? 16 : 24)));
      const b = this.add(new Box({ id: p.id, label: p.label, cls: `st-ptr st-ptr-${side}`, tone: p.tone ?? 'accent' }, this.world));
      b.side = side;
      b.role = 'pointer';
      b.hud = true;
      b.place({ x: this.slotX(0), y: this.laneY(side, 0), w, h: ptrH });
      b.c.o.base = 0;
      this.ptr.set(p.id, { box: b, side, slot: -1, lane: 0 });
    }
    for (const br of data.brackets ?? []) {
      const b = this.add(new Box({ id: br.id, label: br.label ?? '', cls: 'st-bracket' }, this.world));
      b.role = 'bracket';
      b.hud = true;
      b.place({ x: this.slotX(0), y: cy, w: cw + 12, h: ch + 14 });
      b.c.o.base = 0;
      this.brackets.push(b);
    }
  }

  private slotX(i: number): number {
    return Math.round(this.x0 + i * (this.cw + this.gap));
  }
  /** Pointers on one cell stack outwards from it; alone, a pointer sits right beside its cell. */
  private laneY(side: 'above' | 'below', lane: number): number {
    return side === 'above' ? this.aboveY - lane * this.lane : this.belowY + lane * this.lane;
  }

  override intro(ctx: Ctx): void {
    const cells = this.d.cells.map((c) => this.get(c.id) as Box).filter((b) => b.c.o.base === 1);
    const st = stagger(cells.length) * ctx.pace;
    cells.forEach((b, i) => {
      b.startHidden();
      b.enter(ctx, i * st, 'below');
    });
    this.introStats(ctx);
  }

  private span(a: string, b: string): [number, number] {
    const i = this.slotOf.get(a);
    const j = this.slotOf.get(b);
    if (i === undefined || j === undefined) throw new Error(`A range needs two cell ids; got "${a}" and "${b}".`);
    return [Math.min(i, j), Math.max(i, j)];
  }
  private range(a: ActionData): string[] | null {
    const between = a.between;
    if (!Array.isArray(between) || typeof between[0] !== 'string' || typeof between[1] !== 'string') return null;
    const [i, j] = this.span(between[0], between[1]);
    return this.at.slice(i, j + 1);
  }

  /** move: a pointer goes to a cell (hopping when it crosses more than one); a bracket stretches over a range of cells. */
  move(ctx: Ctx, a: ActionData): void {
    const p = this.get(String(a.target));
    if (!(p instanceof Box) || (p.role !== 'pointer' && p.role !== 'bracket')) throw new Error(`move works on a pointer or a bracket; "${String(a.target)}" is neither.`);
    if (p.role === 'pointer') {
      const i = typeof a.to === 'string' ? this.slotOf.get(a.to) : undefined;
      const me = this.ptr.get(p.id);
      if (i === undefined || !me) throw new Error(`move: "${String(a.to)}" is not a cell.`);
      const x = this.slotX(i);
      const sameSide = [...this.ptr.values()].filter((q) => q !== me && q.side === me.side && q.box.c.o.end > 0);
      // Those stacked beyond this pointer on the cell it leaves close up behind it.
      for (const q of sameSide) {
        if (q.slot !== me.slot || q.lane < me.lane || me.slot === i) continue;
        q.lane--;
        q.box.moveTo(ctx, { x: q.box.c.x.end, y: this.laneY(q.side, q.lane) });
      }
      if (me.slot !== i) {
        const taken = new Set(sameSide.filter((q) => q.slot === i).map((q) => q.lane));
        let lane = 0;
        while (taken.has(lane)) lane++;
        me.lane = lane;
        me.slot = i;
      }
      const y = this.laneY(me.side, me.lane);
      if (p.c.o.end === 0) {
        // First use: it drops in over its cell.
        p.c.x.to(x, ctx.t, 0);
        p.c.y.to(y, ctx.t, 0);
        p.enter(ctx, 0, p.side === 'above' ? 'above' : 'below');
      } else {
        const cells = Math.abs(x - p.c.x.end) / (this.cw + this.gap);
        p.moveTo(ctx, { x, y }, { arc: cells > 1.5 ? (p.side === 'above' ? -14 : 14) : 0 });
      }
      return;
    }
    const to = a.to;
    const [i, j] = Array.isArray(to) ? this.span(String(to[0]), String(to[1])) : this.span(String(to), String(to));
    const xa = this.slotX(i) - this.cw / 2 - 6;
    const xb = this.slotX(j) + this.cw / 2 + 6;
    const r = { x: (xa + xb) / 2, y: this.cy, w: xb - xa, h: this.ch + 14 };
    if (p.c.o.end === 0) {
      p.c.x.to(r.x, ctx.t, 0);
      p.c.w.to(r.w, ctx.t, 0);
      p.c.s.to(1.06, ctx.t, 0);
      p.c.dy.to(0, ctx.t, 0);
      ctx.tw(p.c.o, 1, { d: D.enter * 0.6, e: E.out });
      ctx.tw(p.c.s, 1, { d: D.enter, e: E.enter });
    } else p.moveTo(ctx, r);
  }

  /** swap: two cells trade places, one over the top and one underneath, so the eye can follow both. */
  swap(ctx: Ctx, a: ActionData): void {
    const ia = String(a.a);
    const ib = String(a.b);
    const A = this.get(ia) as Box;
    const B = this.get(ib) as Box;
    const i = this.slotOf.get(ia);
    const j = this.slotOf.get(ib);
    if (i === undefined || j === undefined) throw new Error(`swap needs two cells; got "${ia}" and "${ib}".`);
    const lift = this.ch * 0.9 + 8;
    A.moveTo(ctx, { x: this.slotX(j), y: this.cy }, { arc: -lift, base: D.swap });
    B.moveTo(ctx, { x: this.slotX(i), y: this.cy }, { arc: lift, base: D.swap });
    const d = travel(D.swap, Math.abs(this.slotX(j) - this.slotX(i)), this.W);
    ctx.tw(A.c.s, 1, { d, e: E.linear, fn: bump(0.08) });
    this.slotOf.set(ia, j);
    this.slotOf.set(ib, i);
    this.at[i] = ib;
    this.at[j] = ia;
  }

  /** reorder: every cell goes to its place in the new order; cells moving left arc over, cells moving right arc under. */
  reorder(ctx: Ctx, a: ActionData): void {
    const order = Array.isArray(a.order) ? (a.order as string[]) : [];
    if (order.length !== this.at.length || new Set(order).size !== order.length || order.some((id) => !this.slotOf.has(id))) {
      throw new Error('reorder: "order" must name every cell of the row exactly once.');
    }
    const st = stagger(order.length) * 0.7 * ctx.pace;
    let k = 0;
    order.forEach((id, i) => {
      const from = this.slotOf.get(id) as number;
      if (from === i) return;
      (this.get(id) as Box).moveTo(ctx, { x: this.slotX(i), y: this.cy }, { delay: k++ * st, arc: (i < from ? -1 : 1) * (this.ch * 0.6 + 6), base: D.swap });
    });
    order.forEach((id, i) => {
      this.slotOf.set(id, i);
      this.at[i] = id;
    });
  }

  override apply(t: number, x?: ExploreState): void {
    super.apply(t, x);
    // A bracket's label hangs from whichever end keeps it on the stage.
    for (const b of this.brackets) setData(b.el, 'align', b.c.x.at(t) > this.W * 0.56 ? 'right' : 'left');
  }

  /** A cell is called by what it holds and where it stands in the row at that moment. */
  override taps(t: number): TapTarget[] {
    const n = this.d.cells.length;
    const out: TapTarget[] = [];
    for (const c of this.d.cells) {
      const box = this.get(c.id) as Box;
      const b = box.tap(t);
      if (!b) continue;
      const slot = clamp(Math.round((box.c.x.at(t) - this.x0) / (this.cw + this.gap)), 0, n - 1);
      out.push(this.tapTarget(c.id, { ...b, label: `${b.label}, cell ${slot + 1} of ${n}` }, t));
    }
    return out.sort((p, q) => p.x - q.x);
  }

  /** A zoom on cells keeps the pointers that stand on them in the frame. */
  override zoomParts(want: ReadonlySet<string>): Part[] {
    const slots = new Set([...want].map((id) => this.slotOf.get(id)));
    return [...super.zoomParts(want), ...[...this.ptr.values()].filter((q) => q.box.c.o.end > 0 && slots.has(q.slot)).map((q) => q.box)];
  }
  /** A focus may name cells one by one or as `between: [first, last]`. */
  override focusSet(a: ActionData): Set<string> {
    return new Set(this.range(a) ?? this.ids(a));
  }
  override set(ctx: Ctx, a: ActionData): void {
    const range = this.range(a);
    super.set(ctx, range ? { ...a, targets: range } : a);
  }
}

registerKit('cells', (data: CellsData, env) => new CellsStage(data, env));
