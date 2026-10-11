// Flow stage: boxes and arrows. The layout is a function of which nodes are present, so showing a
// node makes the others move over for it: a layout transition, not a cut.
import { type ActionData, Box, Chan, type Ctx, D, E, type ExploreState, type Pt, type Rect, Stage, type StageEnv, type StatData, Wire, clamp, curve, makeToken, quad, registerKit, textWidth, travel } from './kit';

interface FlowData {
  kind: 'flow';
  nodes: { id: string; label: string }[];
  edges: { id: string; from: string; to: string; label?: string }[];
  stats?: StatData[];
}
interface Edge {
  id: string;
  from: string;
  to: string;
  wire: Wire;
  label: Box | null;
  /** 0: straight between neighbours. 1: bowed away from the row, for a long or backward connector. */
  bend: Chan;
  /** Runs against the reading order: it bows on the other side of the row, so a loop never crosses a skip. */
  back: boolean;
}

/** Where the line from the middle of box `r` towards point `p` leaves the box, pushed out by `m` px. */
function edgePoint(r: Rect, p: Pt, m = 6): Pt {
  const dx = p.x - r.x;
  const dy = p.y - r.y;
  if (!dx && !dy) return { x: r.x, y: r.y };
  const k = Math.min((r.w / 2 + m) / Math.abs(dx || 1e-9), (r.h / 2 + m) / Math.abs(dy || 1e-9));
  return { x: r.x + dx * k, y: r.y + dy * k };
}

export class FlowStage extends Stage<FlowData> {
  private present: string[];
  private readonly big = new Set<string>();
  private readonly nodes = new Map<string, Box>();
  private readonly edges: Edge[];
  private placed = false;
  private tokens = 0;

  constructor(data: FlowData, env: StageEnv) {
    super(data, env);
    this.present = data.nodes.map((n) => n.id);
    for (const n of data.nodes) {
      const b = this.add(new Box({ id: n.id, label: n.label, cls: 'st-node' }, this.world));
      b.role = 'node';
      this.nodes.set(n.id, b);
    }
    this.edges = data.edges.map((e) => {
      if (!this.nodes.has(e.from) || !this.nodes.has(e.to)) throw new Error(`The connector "${e.id}" joins "${e.from}" and "${e.to}"; both must be nodes.`);
      const wire = this.add(new Wire(e.id, this.wires, 'st-edge'));
      wire.role = 'edge';
      const who = (id: string): string => data.nodes.find((n) => n.id === id)?.label ?? id;
      wire.label = `${e.label ? `${e.label}: ` : ''}the arrow from ${who(e.from)} to ${who(e.to)}`;
      wire.restBox = () => {
        const a = this.node(e.from).rest();
        const b = this.node(e.to).rest();
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: Math.abs(a.x - b.x) + 24, h: Math.abs(a.y - b.y) + 44 };
      };
      let label: Box | null = null;
      if (e.label) {
        label = this.add(new Box({ id: `${e.id}~label`, label: e.label, cls: 'st-elabel' }, this.world));
        label.group = e.id;
        label.place({ x: 0, y: 0, w: Math.round(textWidth(e.label, 12.5, 650) + 18), h: 22 });
        label.c.o.base = 0;
      }
      const order = data.nodes.map((n) => n.id);
      return { id: e.id, from: e.from, to: e.to, wire, label, bend: new Chan(0), back: order.indexOf(e.to) < order.indexOf(e.from) };
    });
  }

  private node(id: string): Box {
    const b = this.nodes.get(id);
    if (!b) throw new Error(`"${id}" is not a node on this flow stage.`);
    return b;
  }

  /** Where every present node belongs: a row on a wide stage, a column on a narrow one. */
  private slots(): Map<string, Rect> {
    const { W, narrow } = this;
    const ids = this.present;
    const k = ids.length;
    const out = new Map<string, Rect>();
    if (!narrow) {
      const side = 44;
      const gap = clamp(((W - 2 * side) / k) * 0.32, 36, 96);
      const w = Math.round(clamp((W - 2 * side - gap * (k - 1)) / k, 84, 236));
      const hh = Math.round(clamp(w * 0.44, 58, 100));
      const total = k * w + (k - 1) * gap;
      const y = Math.round(this.floor * 0.5);
      ids.forEach((id, i) => {
        const g = this.big.has(id) ? 1.28 : 1;
        out.set(id, { x: Math.round((W - total) / 2 + w / 2 + i * (w + gap)), y, w: Math.round(w * g), h: Math.round(hh * g) });
      });
    } else {
      const hh = 44;
      const gap = clamp((this.floor - 28 - k * hh) / Math.max(1, k - 1), 16, 46);
      const total = k * hh + (k - 1) * gap;
      ids.forEach((id, i) => {
        const g = this.big.has(id) ? 1.18 : 1;
        out.set(id, { x: Math.round(W / 2), y: Math.round((this.floor - total) / 2 + hh / 2 + i * (hh + gap)), w: Math.round(Math.min(204, W - 96) * g), h: Math.round(hh * g) });
      });
    }
    return out;
  }

  override hideAtStart(ids: readonly string[]): void {
    const gone = new Set(ids);
    this.present = this.present.filter((id) => !gone.has(id));
    for (const id of ids) this.parts.get(id)?.startHidden?.();
    this.place();
  }

  private place(): void {
    const sl = this.slots();
    for (const [id, r] of sl) this.node(id).place(r);
    // A node that is not on stage yet waits where it will first appear, so nothing slides in from a corner.
    for (const [id, b] of this.nodes) if (!sl.has(id)) b.place({ x: this.W / 2, y: this.floor / 2, w: 120, h: 56 });
    for (const e of this.edges) e.bend.base = this.wantBend(e);
    this.placed = true;
  }

  override intro(ctx: Ctx): void {
    if (!this.placed) this.place();
    this.present.forEach((id, i) => {
      const p = this.node(id);
      p.startHidden();
      p.enter(ctx, i * 80 * ctx.pace, 'below');
    });
    this.introStats(ctx, 260);
  }

  /** Everyone already on stage moves to where the new arrangement puts them. Returns when they have settled. */
  private relayout(ctx: Ctx, skip: ReadonlySet<string> = new Set()): number {
    let end = ctx.t;
    // A connector that has to reach over a newcomer bows into an arc; one that has become a neighbour straightens.
    for (const e of this.edges) {
      const want = this.wantBend(e);
      if (e.bend.end !== want) ctx.tw(e.bend, want, { d: D.move * 1.2, e: E.move });
    }
    for (const [id, r] of this.slots()) if (!skip.has(id)) end = Math.max(end, this.node(id).moveTo(ctx, r));
    return end;
  }

  override show(ctx: Ctx, a: ActionData): void {
    const ids = this.ids(a);
    const fresh = ids.filter((id) => this.nodes.has(id) && !this.present.includes(id));
    const others = ids.filter((id) => !fresh.includes(id));
    if (others.length) super.show(ctx, { ...a, targets: others });
    if (!fresh.length) return;
    const order = this.d.nodes.map((n) => n.id);
    this.present = order.filter((id) => this.present.includes(id) || fresh.includes(id));
    const settled = this.relayout(ctx, new Set(fresh));
    const sl = this.slots();
    fresh.forEach((id, i) => {
      const b = this.node(id);
      const r = sl.get(id) as Rect;
      const at = ctx.t + (settled - ctx.t) * 0.45 + i * 90 * ctx.pace;
      b.c.x.to(r.x, at, 0);
      b.c.y.to(r.y, at, 0);
      b.c.w.to(r.w, at, 0);
      b.c.h.to(r.h, at, 0);
      b.enter(ctx, at - ctx.t, 'pop');
    });
  }

  override hide(ctx: Ctx, a: ActionData): void {
    super.hide(ctx, a);
    const gone = new Set(this.ids(a).filter((id) => this.nodes.has(id)));
    if (!gone.size) return;
    this.present = this.present.filter((id) => !gone.has(id));
    const save = ctx.t;
    ctx.t += 160 * ctx.pace;
    this.relayout(ctx);
    ctx.t = save;
    for (const e of this.edges) {
      if (!gone.has(e.from) && !gone.has(e.to)) continue;
      ctx.tw(e.wire.c.o, 0, { d: D.exit, e: E.exit });
      if (e.label) ctx.tw(e.label.c.o, 0, { d: D.exit, e: E.exit });
    }
  }

  private edge(id: string): Edge | undefined {
    return this.edges.find((q) => q.id === id);
  }

  /** draw: the connector grows from its source to its target; its label settles once the line is most of the way. */
  draw(ctx: Ctx, a: ActionData): void {
    this.ids(a).forEach((id, i) => this.drawEdge(ctx, id, i * 130 * ctx.pace));
  }
  private drawEdge(ctx: Ctx, id: string, delay: number): number {
    const e = this.edge(id);
    if (!e) throw new Error(`draw: "${id}" is not a connector on this stage.`);
    const ra = this.node(e.from).rest();
    const rb = this.node(e.to).rest();
    const at = ctx.t + delay;
    const d = travel(D.draw, Math.hypot(rb.x - ra.x, rb.y - ra.y), this.W);
    if (e.wire.c.draw.end >= 1) return at;
    ctx.tw(e.wire.c.draw, 1, { at, d, e: E.soft });
    if (e.label) {
      const land = at + d * 0.55 * ctx.pace;
      ctx.tw(e.label.c.o, 1, { at: land, d: 260, e: E.out });
      e.label.c.dy.to(8, at, 0);
      ctx.tw(e.label.c.dy, 0, { at: land, d: D.enter, e: E.enter });
    }
    return at + d * ctx.pace;
  }

  private wantBend(e: Edge): number {
    const i = this.present.indexOf(e.from);
    const j = this.present.indexOf(e.to);
    if (i < 0 || j < 0) return e.bend.end;
    return Math.abs(i - j) > 1 || j < i ? 1 : 0;
  }

  private geometry(ra: Rect, rb: Rect, k: number, back: boolean): { a: Pt; b: Pt; bend: number } {
    const sa = edgePoint(ra, rb);
    const sb = edgePoint(rb, ra);
    if (k <= 0.001) return { a: sa, b: sb, bend: 0 };
    // A long connector leaves and arrives on one side of the row and bows away from it: above the
    // row (to the right of a column) when it runs forward, below (to the left) when it runs back.
    const out = back ? -1 : 1;
    const up = this.narrow ? { x: out, y: 0 } : { x: 0, y: -out };
    const ta = { x: ra.x + up.x * (ra.w / 2 + 6), y: ra.y + up.y * (ra.h / 2 + 6) };
    const tb = { x: rb.x + up.x * (rb.w / 2 + 6), y: rb.y + up.y * (rb.h / 2 + 6) };
    const dist = Math.hypot(tb.x - ta.x, tb.y - ta.y);
    const mix = (p: Pt, q: Pt): Pt => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
    return { a: mix(sa, ta), b: mix(sb, tb), bend: k * Math.min(this.narrow ? 46 : 120, dist * 0.3) };
  }

  /**
   * send: a token rides a connector (drawing it first if it is not there yet) or, with no
   * connector between the two parts, jumps across on an arc. `outcome: "lost"`: it stops part-way,
   * turns red and drops.
   */
  send(ctx: Ctx, a: ActionData): void {
    const along = typeof a.along === 'string' ? a.along : undefined;
    const e = along !== undefined ? this.edge(along) : this.edges.find((q) => q.from === a.from && q.to === a.to);
    if (along !== undefined && !e) throw new Error(`send: "${along}" is not a connector on this stage.`);
    const fromId = e ? e.from : String(a.from);
    const toId = e ? e.to : String(a.to);
    if (!e && (!this.nodes.has(fromId) || !this.nodes.has(toId))) throw new Error('send on a flow stage needs "along" (a connector id), or "from" and "to" (node ids).');
    const ra = this.node(fromId).rest();
    const rb = this.node(toId).rest();
    let p0: Pt;
    let p1: Pt;
    let p2: Pt;
    if (e) {
      const g = this.geometry(ra, rb, e.bend.end, e.back);
      const q = curve(g.a, g.b, g.bend);
      p0 = q.a;
      p2 = q.b;
      // Even along a straight connector the token lifts a little: it travels, it does not slide.
      const lift = Math.abs(g.bend) < 1 ? Math.min(14, Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) * 0.12) : 0;
      p1 = this.narrow ? { x: q.m.x + lift, y: q.m.y } : { x: q.m.x, y: q.m.y - lift };
    } else {
      p0 = { x: ra.x, y: ra.y - ra.h / 2 - 8 };
      p2 = { x: rb.x, y: rb.y - rb.h / 2 - 8 };
      const dist = Math.hypot(p2.x - p0.x, p2.y - p0.y);
      p1 = { x: (p0.x + p2.x) / 2, y: Math.min(p0.y, p2.y) - Math.min(90, dist * 0.32) };
    }
    const tok = makeToken(this, `~token${++this.tokens}`, typeof a.label === 'string' ? a.label : undefined, typeof a.tone === 'string' ? a.tone : 'accent');
    const lost = a.outcome === 'lost';
    const frac = lost ? 0.55 : 1;
    this.node(fromId).pulse(ctx, 0, -0.05);
    const t0 = ctx.t + 110 * ctx.pace;
    tok.c.x.to(p0.x, t0, 0);
    tok.c.y.to(p0.y, t0, 0);
    ctx.tw(tok.c.o, 1, { at: t0, d: 140, e: E.out });
    ctx.tw(tok.c.s, 1, { at: t0, d: 280, e: E.pop });
    const d = travel(D.send, Math.hypot(p2.x - p0.x, p2.y - p0.y) * frac, this.W);
    const t1 = t0 + 130 * ctx.pace;
    const stop = quad(p0, p1, p2, frac);
    ctx.tw(tok.c.x, stop.x, { at: t1, d, e: E.soft, fn: (u) => quad(p0, p1, p2, u * frac).x });
    ctx.tw(tok.c.y, stop.y, { at: t1, d, e: E.soft, fn: (u) => quad(p0, p1, p2, u * frac).y });
    // The connector is drawn behind the token if nothing has drawn it yet.
    if (e && e.wire.c.draw.end < 1 && !lost) {
      const save = ctx.t;
      ctx.t = t1;
      this.drawEdge(ctx, e.id, 0);
      ctx.t = save;
    }
    const tArr = t1 + d * ctx.pace;
    if (lost) {
      tok.setTone(ctx, 'bad', tArr - ctx.t);
      ctx.tw(tok.c.x, stop.x, { at: tArr, d: 380, e: E.linear, fn: (u, _from, to) => to + 5 * Math.sin(u * Math.PI * 6) * (1 - u) });
      ctx.tw(tok.c.y, stop.y + 36, { at: tArr + 380 * ctx.pace, d: 480, e: E.exit });
      ctx.tw(tok.c.o, 0, { at: tArr + 500 * ctx.pace, d: 360, e: E.exit });
    } else {
      ctx.tw(tok.c.s, 0.5, { at: tArr - 40, d: 220, e: E.exit });
      ctx.tw(tok.c.o, 0, { at: tArr - 40, d: 220, e: E.exit });
      this.node(toId).pulse(ctx, tArr - 60 - ctx.t, 0.08);
    }
  }

  /** set: besides tone and label, a node can be made large or normal; its neighbours make room. */
  override set(ctx: Ctx, a: ActionData): void {
    if (a.size === 'large' || a.size === 'normal') {
      for (const id of this.ids(a)) {
        if (!this.nodes.has(id)) continue;
        if (a.size === 'large') this.big.add(id);
        else this.big.delete(id);
      }
      this.relayout(ctx);
    }
    super.set(ctx, a);
  }

  override apply(t: number, x?: ExploreState): void {
    // Nodes first, then connectors from wherever the nodes are at this instant.
    const rect = (id: string): Rect => {
      const c = this.node(id).c;
      return { x: c.x.at(t) + c.dx.at(t), y: c.y.at(t) + c.dy.at(t), w: c.w.at(t), h: c.h.at(t) };
    };
    for (const e of this.edges) {
      const g = this.geometry(rect(e.from), rect(e.to), e.bend.at(t), e.back);
      e.wire.setGeo(g.a, g.b, g.bend);
      if (e.label) {
        const m = e.wire.point(0.5);
        const straight = 1 - Math.min(1, Math.abs(g.bend) / 20);
        e.label.c.x.base = this.narrow ? m.x + (e.label.c.w.base / 2 + 8) * straight : m.x;
        e.label.c.y.base = m.y - (this.narrow ? 0 : 17 * straight);
      }
    }
    super.apply(t, x);
  }
}

registerKit('flow', (data: FlowData, env) => new FlowStage(data, env));
