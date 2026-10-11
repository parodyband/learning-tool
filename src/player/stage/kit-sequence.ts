// Sequence stage: who sends what to whom, in order. Actors are columns; each message is a row.
import { type ActionData, Box, type Ctx, D, E, type Pt, Stage, type StageEnv, type StatData, Wire, clamp, makeToken, registerKit, textWidth, travel } from './kit';

interface SequenceData {
  kind: 'sequence';
  actors: { id: string; label: string }[];
  messages: { id: string; from: string; to: string; label: string }[];
  stats?: StatData[];
}

interface Message {
  id: string;
  from: string;
  to: string;
  label: string;
  a: Pt;
  b: Pt;
  wire: Wire;
  tag: Box;
  dir: number;
}

export class SequenceStage extends Stage<SequenceData> {
  private readonly col = new Map<string, number>();
  private readonly life = new Map<string, Wire>();
  private readonly msg = new Map<string, Message>();

  constructor(data: SequenceData, env: StageEnv) {
    super(data, env);
    const { W, narrow } = this;
    const n = data.actors.length;
    const headW = Math.round(clamp(W / n - (narrow ? 20 : 56), 72, 210));
    const headH = narrow ? 44 : 56;
    const headY = (narrow ? 14 : 22) + headH / 2;
    data.actors.forEach((a, i) => {
      const x = Math.round((W * (i + 0.5)) / n);
      this.col.set(a.id, x);
      const life = this.add(new Wire(`${a.id}~life`, this.wires, 'st-life'));
      life.setGeo({ x, y: headY + headH / 2 }, { x, y: this.floor - 4 });
      life.c.draw.base = 1;
      this.life.set(a.id, life);
      const box = this.add(new Box({ id: a.id, label: a.label, cls: 'st-actor' }, this.world));
      box.role = 'actor';
      box.place({ x, y: headY, w: headW, h: headH });
    });

    // A read-out that belongs to an actor sits beside that actor's head when there is room.
    const stats = data.stats ?? [];
    let moved = 0;
    for (const st of stats) {
      const x = st.at === undefined ? undefined : this.col.get(st.at);
      if (x === undefined) continue;
      const b = this.get(st.id) as Box;
      const r = b.rest();
      const cx = x < W / 2 ? x - headW / 2 - 12 - r.w / 2 : x + headW / 2 + 12 + r.w / 2;
      if (cx - r.w / 2 < 8 || cx + r.w / 2 > W - 8) continue;
      b.place({ x: Math.round(cx), y: headY, w: r.w, h: Math.min(r.h, headH) });
      moved++;
    }
    if (moved > 0) {
      // The read-outs left on the bottom row close up; if none are left the picture gets the row.
      const pad = narrow ? 10 : 16;
      let sx = pad;
      let left = 0;
      for (const st of stats) {
        const b = this.get(st.id) as Box;
        const r = b.rest();
        if (r.y < this.H / 2) continue;
        b.place({ x: sx + r.w / 2, y: r.y, w: r.w, h: r.h });
        sx += r.w + 8;
        left++;
      }
      if (left === 0) this.floor = this.H - 10;
      for (const life of this.life.values()) life.setGeo(life.geo.a, { x: life.geo.a.x, y: this.floor - 4 });
    }

    const top = headY + headH / 2 + (narrow ? 30 : 40);
    const m = data.messages.length;
    const gap = clamp((this.floor - top - 8) / m, 34, 92);
    data.messages.forEach((msg, j) => {
      const y = Math.round(top + j * gap + gap * 0.28);
      const xa = this.col.get(msg.from);
      const xb = this.col.get(msg.to);
      if (xa === undefined || xb === undefined) throw new Error(`The message "${msg.id}" goes from "${msg.from}" to "${msg.to}"; both must be actors.`);
      const dir = Math.sign(xb - xa) || 1;
      const a = { x: xa, y };
      const b = { x: xb - dir * 4, y: y + (narrow ? 6 : 10) };
      const wire = this.add(new Wire(msg.id, this.wires, 'st-msgwire'));
      wire.setGeo(a, b);
      wire.role = 'message';
      const who = (id: string): string => data.actors.find((q) => q.id === id)?.label ?? id;
      wire.label = `${msg.label}, from ${who(msg.from)} to ${who(msg.to)}`;
      wire.restBox = () => ({ x: (a.x + b.x) / 2, y: y + 4, w: Math.abs(b.x - a.x), h: 34 });
      const lw = Math.max(40, Math.min(Math.abs(xb - xa) - 30, Math.round(textWidth(msg.label, narrow ? 13 : 15, 650) + 24)));
      const tag = this.add(new Box({ id: `${msg.id}~label`, label: msg.label, cls: 'st-msglabel' }, this.world));
      tag.group = msg.id;
      tag.place({ x: (a.x + b.x) / 2, y: y - (narrow ? 12 : 15), w: lw, h: narrow ? 24 : 28 });
      tag.startHidden();
      this.msg.set(msg.id, { ...msg, a, b, wire, tag, dir });
    });
  }

  override hideAtStart(ids: readonly string[]): void {
    for (const id of ids) {
      const p = this.parts.get(id);
      if (!(p instanceof Box)) continue;
      p.startHidden();
      const life = this.life.get(id);
      if (life) life.c.draw.base = 0;
    }
  }

  override intro(ctx: Ctx): void {
    const st = 110 * ctx.pace;
    this.d.actors.forEach((a, i) => {
      const box = this.get(a.id) as Box;
      if (box.c.o.base !== 1) return;
      box.startHidden();
      (this.life.get(a.id) as Wire).c.draw.base = 0;
      this.enterActor(ctx, a.id, i * st);
    });
    this.introStats(ctx, 260);
  }

  private enterActor(ctx: Ctx, id: string, delay: number): void {
    (this.get(id) as Box).enter(ctx, delay, 'above');
    // Follow-through: the lifeline drops out of the head just after the head lands.
    const life = this.life.get(id);
    if (life) ctx.tw(life.c.draw, 1, { at: ctx.t + delay + 160 * ctx.pace, d: 560, e: E.soft });
  }

  override show(ctx: Ctx, a: ActionData): void {
    const ids = this.ids(a);
    const actors = ids.filter((id) => this.life.has(id));
    actors.forEach((id, i) => this.enterActor(ctx, id, i * 110 * ctx.pace));
    const rest = ids.filter((id) => !this.life.has(id));
    if (rest.length) super.show(ctx, { ...a, targets: rest });
  }

  /**
   * send: the sender dips, the packet leaves it, the line is drawn behind the packet, the label
   * settles on the line as the packet passes the middle, and the receiver answers. `outcome:
   * "lost"`: the packet stops part-way, shakes, turns red, drops away, and a cross marks the place.
   */
  send(ctx: Ctx, a: ActionData): void {
    const m = typeof a.target === 'string' ? this.msg.get(a.target) : undefined;
    if (!m) throw new Error(`send needs a message id on a sequence stage; "${String(a.target)}" is not one.`);
    const lost = a.outcome === 'lost';
    const frac = lost ? 0.58 : 1;
    const tok = makeToken(this, `${m.id}~token`, m.label, typeof a.tone === 'string' ? a.tone : 'accent');
    const sender = this.get(m.from) as Box;
    const receiver = this.get(m.to) as Box;
    const end = { x: m.a.x + (m.b.x - m.a.x) * frac, y: m.a.y + (m.b.y - m.a.y) * frac };
    sender.pulse(ctx, 0, -0.06);
    const t0 = ctx.t + 120 * ctx.pace;
    tok.c.x.to(m.a.x, t0, 0);
    tok.c.y.to(m.a.y, t0, 0);
    ctx.tw(tok.c.o, 1, { at: t0, d: 140, e: E.out });
    ctx.tw(tok.c.s, 1, { at: t0, d: 280, e: E.pop });
    const d = travel(D.send, Math.abs(end.x - m.a.x), this.W);
    const t1 = t0 + 130 * ctx.pace;
    ctx.tw(tok.c.x, end.x, { at: t1, d, e: E.soft });
    ctx.tw(tok.c.y, end.y, { at: t1, d, e: E.soft });
    ctx.tw(m.wire.c.draw, frac, { at: t1, d, e: E.soft });
    const tArr = t1 + d * ctx.pace;
    m.tag.enter(ctx, t1 + d * ctx.pace * 0.5 - ctx.t, 'below');
    if (!lost) {
      ctx.tw(tok.c.s, 0.5, { at: tArr - 40, d: 220, e: E.exit });
      ctx.tw(tok.c.o, 0, { at: tArr - 40, d: 220, e: E.exit });
      receiver.pulse(ctx, tArr - 60 - ctx.t, 0.08);
      return;
    }
    tok.setTone(ctx, 'bad', tArr - ctx.t);
    ctx.tw(tok.c.x, end.x, { at: tArr, d: 420, e: E.linear, fn: (e, _from, to) => to + 6 * Math.sin(e * Math.PI * 6) * (1 - e) });
    const tFall = tArr + 420 * ctx.pace;
    ctx.tw(tok.c.y, end.y + 40, { at: tFall, d: 520, e: E.exit });
    ctx.tw(tok.c.r, 18 * m.dir, { at: tFall, d: 520, e: E.exit });
    ctx.tw(tok.c.o, 0, { at: tFall + 160 * ctx.pace, d: 360, e: E.exit });
    m.wire.c.lost.to(1, tArr, 0);
    m.tag.setTone(ctx, 'bad', tArr - ctx.t);
    const cross = this.add(new Box({ id: `${m.id}~lost`, label: '✕', cls: 'st-cross', tone: 'bad' }, this.world));
    cross.group = m.id;
    // The cross marks where it died: at the end of the stub, hanging below it, clear of the label above.
    cross.place({ x: end.x + m.dir * 15, y: end.y + 9, w: 26, h: 26 });
    cross.startHidden();
    cross.enter(ctx, tArr + 120 * ctx.pace - ctx.t, 'pop');
  }
}

registerKit('sequence', (data: SequenceData, env) => new SequenceStage(data, env));
