// Dots stage: a population of units (up to 1,000) that splits into labelled groups and merges
// again. The dots are one canvas, because a thousand DOM nodes is the wrong tool; every dot is
// still a pure function of time, so scrubbing works exactly as it does for the DOM parts. Group
// labels are boxes.
//
// EXPLORE. When a clip lets the learner drive group counts (a binding on a group), the groups are
// drawn as one sheet cut into pieces: every block has the same number of rows, so a block's width
// IS its count, and the pieces stand side by side in the order they were split. The sheet has one
// fixed order of dots. A group is a run of that order, and a slider moves the cuts between runs:
// the dots a cut passes change colour and step across the gap to the block next door. No other
// dot moves, and no block is ever reshuffled. Where each dot belongs is a pure function of the
// counts (`place`); the only thing with a clock of its own is the short flight of a dot from where
// it is drawn to where it now belongs, and that flight is skipped under reduced motion.
//
// How the counts follow the formulas (`resolve`): the tree of splits is walked from the top. In
// each split, a group with a formula (or whose own parts all have one) takes its number, capped at
// what its parent has left; the parts without a formula share the rest, which is how "whatever a
// bound group does not take stays in the group it was split from". A group made by a merge is the
// sum of what was merged into it.
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { type ActionData, Box, Chan, type Ctx, D, E, type ExploreState, type Part, type Rect, Stage, type StageEnv, type StatData, TONES, type TapTarget, type ToneName, clamp, h, registerKit, setProp, textWidth, travel } from './kit';

interface DotsData {
  kind: 'dots';
  total: number;
  legend?: string;
  group: { id: string; label: string; tone?: string };
  stats?: StatData[];
}

const TAU = Math.PI * 2;
const ease3 = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const toneIndex = (tone: string): number => Math.max(0, (TONES as readonly string[]).indexOf(tone));

/** A small seeded generator, so "scattered through the crowd" is the same scatter every time. */
function seeded(str: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < str.length; i++) a = Math.imul(a ^ str.charCodeAt(i), 16777619);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A group as the tree of splits knows it: who it was split into, or merged from, and how many it was written with. */
interface Node {
  readonly id: string;
  readonly name: string;
  readonly authored: number;
  kids: string[] | null;
  sources: string[] | null;
}

/**
 * How many dots each group has when some groups are given a number. `nodes` are in the order the
 * groups were made (a parent before its parts, the merged after what it was merged from).
 */
function resolve(nodes: readonly Node[], total: number, bound: (id: string) => number | undefined): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const count = new Map<string, number>();
  const wants = new Map<string, number | undefined>();
  const want = (id: string): number | undefined => {
    if (wants.has(id)) return wants.get(id);
    let v: number | undefined;
    const b = bound(id);
    const node = byId.get(id);
    if (b !== undefined) v = Number.isFinite(b) ? Math.max(0, Math.round(b)) : 0;
    else if (node?.kids) {
      // A group with no formula of its own whose parts all have one is as large as its parts.
      let sum: number | undefined = 0;
      for (const k of node.kids) {
        const w = want(k);
        sum = w === undefined || sum === undefined ? undefined : sum + w;
      }
      v = sum;
    }
    wants.set(id, v);
    return v;
  };
  if (nodes[0]) count.set(nodes[0].id, total);
  for (const node of nodes) {
    if (node.sources) count.set(node.id, node.sources.reduce((n, id) => n + (count.get(id) ?? 0), 0));
    if (!node.kids) continue;
    let left = count.get(node.id) ?? 0;
    const free: Node[] = [];
    for (const id of node.kids) {
      const w = want(id);
      if (w === undefined) free.push(byId.get(id)!);
      else {
        const c = Math.min(w, left);
        count.set(id, c);
        left -= c;
      }
    }
    const kids = node.kids.map((id) => byId.get(id)!);
    const largest = (of: readonly Node[]): Node => of.reduce((m, k) => (k.authored > m.authored ? k : m), of[0]!);
    if (free.length) {
      // What the bound parts do not take stays with the rest, in the proportions they were written with.
      const weight = free.reduce((n, k) => n + k.authored, 0) || free.length;
      const big = largest(free);
      let given = 0;
      for (const k of free) {
        if (k === big) continue;
        const c = Math.floor((left * (k.authored || 1)) / weight);
        count.set(k.id, c);
        given += c;
      }
      count.set(big.id, left - given);
    } else if (left > 0) {
      const big = largest(kids);
      count.set(big.id, (count.get(big.id) ?? 0) + left);
    }
  }
  return count;
}

/** The groups a clip will make, read from its actions before any of them is compiled: for choosing a dot size once. */
function foresee(root: { id: string; label: string }, total: number, actions: readonly ActionData[]): { nodes: Node[]; states: string[][] } {
  const nodes: Node[] = [{ id: root.id, name: root.label, authored: total, kids: null, sources: null }];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let leaves = [root.id];
  const states = [leaves];
  for (const a of actions) {
    if (a.verb === 'split' && typeof a.target === 'string' && Array.isArray(a.into)) {
      const at = leaves.indexOf(a.target);
      const parent = byId.get(a.target);
      const into = (a.into as { id?: unknown; label?: unknown; count?: unknown }[]).filter((k) => typeof k.id === 'string' && !byId.has(k.id as string));
      if (at < 0 || !parent || into.length < 2) continue;
      const kids = into.map((k) => ({ id: k.id as string, name: String(k.label ?? ''), authored: Number(k.count) || 0, kids: null, sources: null }));
      for (const k of kids) {
        nodes.push(k);
        byId.set(k.id, k);
      }
      parent.kids = kids.map((k) => k.id);
      leaves = [...leaves.slice(0, at), ...parent.kids, ...leaves.slice(at + 1)];
    } else if (a.verb === 'merge' && Array.isArray(a.targets) && typeof a.into === 'object' && a.into !== null) {
      const ids = (a.targets as unknown[]).filter((id): id is string => typeof id === 'string' && leaves.includes(id));
      const into = a.into as { id?: unknown; label?: unknown };
      if (ids.length < 2 || typeof into.id !== 'string' || byId.has(into.id)) continue;
      const merged: Node = { id: into.id, name: String(into.label ?? ''), authored: ids.reduce((n, id) => n + (byId.get(id)?.authored ?? 0), 0), kids: null, sources: ids };
      nodes.push(merged);
      byId.set(merged.id, merged);
      const first = ids[0]!;
      leaves = leaves.filter((id) => !ids.includes(id) || id === first).map((id) => (id === first ? merged.id : id));
    } else continue;
    states.push(leaves);
  }
  return { nodes, states };
}

/** A group of dots. As a part it is what `focus`, `split`, `merge` and `set tone` name; its dots are drawn by the stage. */
class Group implements Part {
  readonly kind = 'group';
  readonly c = { dim: new Chan(0) };
  rect: Rect = { x: 0, y: 0, w: 1, h: 1 };
  labelRect: Rect = { x: 0, y: 0, w: 1, h: 1 };
  members: Int32Array = new Int32Array(0);
  /** Dots per row (wide) or per column run (narrow). Frozen once used, so a block keeps its shape. */
  line = 0;
  fresh = true;
  /** The groups this one was split into, or merged from: the tree a formula's numbers are shared down. */
  kids: Group[] | null = null;
  sources: Group[] | null = null;
  constructor(
    readonly id: string,
    readonly name: string,
    public count: number,
    public tone: string,
    readonly gi: number,
    readonly label: Box,
  ) {}
  apply(): void {}
  rest(): Rect {
    return this.rect;
  }
}

interface Bucket {
  cFrom: number;
  cTo: number;
  grp: number;
  idx: number[];
}
/** One change of arrangement: every dot's start, end, delay, duration, arc and colours. */
interface Phase {
  t0: number;
  /** When recolouring is done and travel begins. */
  t1: number;
  tEnd: number;
  from: Float32Array;
  to: Float32Array;
  delay: Float32Array;
  dur: Float32Array;
  arc: Float32Array;
  cFrom: Uint8Array;
  cTo: Uint8Array;
  ct0: number;
  cdur: number;
  grp: Uint16Array;
  pFrom: number;
  pTo: number;
  /** Only the opening: per-dot delay of the grow-in. */
  intro?: Float32Array;
  buckets: Bucket[];
  /** The groups on stage in this arrangement, and where each stands: what a tap gate offers. */
  stands: { id: string; said: string; rect: Rect; label: Rect }[];
}

/** One group as it is drawn for the learner's numbers: its run of the sheet, and its pieces (more than one after a merge). */
interface Piece {
  group: Group;
  /** Where its run began when the clip ended: the block's grid is counted from here, so it never reshuffles. */
  anchor: number;
  /** Its pieces in order, each with the colour its dots had when the clip ended. */
  atoms: { id: string; tone: number }[];
  labelW: number;
}
/** What the stage keeps for explore. `order` and `pieces` never change; `at` and `lab` are where things are drawn now, on their way to where they belong. */
interface Sheet {
  nodes: Node[];
  /** Every dot, in the one order the sheet has: the groups left to right, each in its block's own order. */
  order: Int32Array;
  pieces: Piece[];
  at: Float32Array;
  lab: Float32Array;
  /** The clock at the last frame drawn, or -1 when the next one starts from the clip's own picture. */
  last: number;
}

export class DotsStage extends Stage<DotsData> {
  private readonly N: number;
  private readonly dpr: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private readonly groups: Group[] = [];
  private leaves: Group[];
  private col: Uint8Array;
  private readonly grp: Uint16Array;
  private pos: Float32Array;
  private pitch: number;
  private readonly phases: Phase[];
  /** What the canvas last drew, so a frame identical to it is not painted again. Not state: a cache of the output. */
  private sig = '';
  /** Set when the learner will drive group counts: every block has this many dots to a line and one dot size, for the whole clip. */
  private readonly strip: { p: number; line: number } | null = null;
  /** On a narrow stage whose groups the learner will drive, labels and gaps are a little tighter: the dots need the room. */
  private tight = false;
  private readonly bound = new Set<string>();
  private sheet: Sheet | null = null;
  private moving = false;

  constructor(data: DotsData, env: StageEnv) {
    super(data, env);
    const N = (this.N = data.total);
    if (this.narrow && data.legend && this.stats.length) this.floor -= 18;
    this.strip = this.planStrip(env);
    // Backing store capped near 1.5 million pixels: past that the fill cost grows and the dots look no better.
    this.dpr = Math.min(env.dpr || 1, Math.sqrt(1.5e6 / (this.W * this.H)));
    this.canvas = h('canvas', 'st-dots');
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.el.insertBefore(this.canvas, this.world);
    this.g = typeof this.canvas.getContext === 'function' ? this.canvas.getContext('2d') : null;
    const root = this.makeGroup(data.group.id, data.group.label, N, data.group.tone ?? 'neutral');
    root.members = Int32Array.from({ length: N }, (_, i) => i);
    this.leaves = [root];
    this.col = new Uint8Array(N).fill(toneIndex(root.tone));
    this.grp = new Uint16Array(N).fill(root.gi);
    const lay = this.layout();
    this.pos = lay.pos;
    this.pitch = lay.p;
    root.label.place(root.labelRect);
    root.label.c.val.base = N;
    // Phase 0, the opening: dots grow in, radiating from the middle of the block.
    const delay = new Float32Array(N);
    const r = root.rect;
    const reach = Math.hypot(r.w, r.h) / 2 || 1;
    for (let i = 0; i < N; i++) delay[i] = (Math.hypot(this.pos[2 * i]! - r.x, this.pos[2 * i + 1]! - r.y) / reach) * 560;
    this.phases = [
      this.bucket({
        t0: -1e9,
        t1: 0,
        tEnd: 0,
        from: this.pos,
        to: this.pos,
        delay: new Float32Array(N),
        dur: new Float32Array(N).fill(1),
        arc: new Float32Array(N),
        cFrom: this.col.slice(),
        cTo: this.col.slice(),
        ct0: 0,
        cdur: 1,
        grp: this.grp.slice(),
        pFrom: this.pitch,
        pTo: this.pitch,
        intro: delay,
        buckets: [],
        stands: this.stands(),
      }),
    ];
    if (data.legend) {
      const lg = this.hud.appendChild(h('span', 'st-legend', data.legend));
      // Beside the read-outs where there is room for both; on a narrow stage, on the line kept for it above them.
      const above = this.narrow && this.stats.length > 0;
      lg.setAttribute('data-side', above ? 'above' : this.stats.length ? 'right' : 'left');
      if (above) setProp(lg, 'bottom', `${Math.round(this.H - this.floor - 17)}px`);
    }
  }

  private makeGroup(id: string, name: string, count: number, tone: string): Group {
    const label = new Box({ id: `${id}~label`, value: 0, prefix: `${name}  `, cls: 'st-glabel', tone }, this.world);
    label.group = id;
    const group = new Group(id, name, count, tone, this.groups.length, label);
    this.groups.push(group);
    this.add(group);
    this.add(label);
    return group;
  }

  private labelW(g: { name: string; count: number }): number {
    // A label whose count the learner will change has room for the largest it could show.
    const count = this.strip ? this.N : g.count;
    return Math.round(textWidth(`${g.name}  ${count.toLocaleString('en-US')}`, this.narrow ? 12.5 : 15, 700) + (this.narrow ? 30 : 38));
  }

  /** The groups on stage now and where each stands, as a tap gate will name them. */
  private stands(): Phase['stands'] {
    return this.leaves.map((l) => ({ id: l.id, said: `${l.name}: ${l.count.toLocaleString('en-US')}`, rect: l.rect, label: l.labelRect }));
  }

  /**
   * When a formula will drive a group, choose one dot size and one line length for the whole clip:
   * the largest at which every arrangement fits, both those the beats pass through and those the
   * sliders can reach. Nothing then has to rescale when the stage is handed over, or while a
   * slider moves.
   */
  private planStrip(env: StageEnv): { p: number; line: number } | null {
    const samples = env.explore?.samples;
    if (!samples) return null;
    const stats = new Set((this.d.stats ?? []).map((st) => st.id));
    const driven = [...samples.keys()].filter((id) => !stats.has(id));
    if (!driven.length) return null;
    const { narrow, N } = this;
    this.tight = narrow;
    const plan = foresee(this.d.group, N, env.actions ?? []);
    const byId = new Map(plan.nodes.map((n) => [n.id, n]));
    const m = this.margins();
    const final = plan.states[plan.states.length - 1]!;
    // Every setting the sliders were sampled at, as the counts the groups would have there.
    const settings: Map<string, number>[] = [];
    const sampled = samples.get(driven[0]!)?.length ?? 0;
    for (let i = 0; i < sampled; i++) settings.push(resolve(plan.nodes, N, (id) => samples.get(id)?.[i]));
    const labW = (id: string): number => this.labelW({ name: byId.get(id)?.name ?? '', count: N });
    const fits = (p: number, line: number): boolean => {
      const room = narrow ? m.bottom - m.top + 6 : m.availW;
      const need = (ids: readonly string[], count: (id: string) => number, ragged: number): number => {
        let total = m.gap * (ids.length - 1);
        for (const id of ids) {
          const n = count(id);
          const lines = n > 0 ? Math.ceil(n / line) + ragged : 0;
          total += narrow ? lines * p + m.labH + 6 : Math.max(lines * p, labW(id));
        }
        return total;
      };
      for (const state of plan.states) if (need(state, (id) => byId.get(id)?.authored ?? 0, 0) > room) return false;
      // A block that is cut at both ends can spill into one line more than its count needs.
      for (const counts of settings) if (need(final, (id) => counts.get(id) ?? 0, 1) > room) return false;
      return true;
    };
    for (let p = narrow ? 26 : 34; p > 2; p -= 0.5) {
      const line = Math.floor((narrow ? m.availW : m.availH) / p);
      if (line >= 1 && fits(p, line)) return { p, line };
    }
    return { p: 2.5, line: Math.max(1, Math.floor((narrow ? m.availW : m.availH) / 2.5)) };
  }

  /**
   * The largest pitch (distance between dots) at which every block fits, and the line length each
   * block would have at it. A block that has been drawn keeps its line length; a new one takes the
   * length nearest to a pleasing shape that divides its count, and with `clean` only such a length
   * will do, so the block has no ragged edge.
   */
  private fit(clean: boolean): { p: number; lines: Map<Group, number> } | null {
    const { W, narrow, leaves } = this;
    const m = this.margins();
    for (let p = narrow ? 26 : 34; p > 2; p -= 0.5) {
      const lines = new Map<Group, number>();
      let total = m.gap * (leaves.length - 1);
      let ok = true;
      for (const l of leaves) {
        let line = l.line;
        if (!line) {
          const most = narrow ? Math.floor(m.availW / p) : Math.floor(m.availH / p);
          const want = Math.min(most, Math.max(1, Math.ceil(Math.sqrt(l.count * (narrow ? 1.9 : 0.7)))));
          line = want;
          const top = Math.min(most, Math.ceil(want * 1.3));
          for (let off = 0; off <= want; off++) {
            const below = want - off;
            const above = want + off;
            if (below >= Math.max(1, Math.ceil(want * 0.55)) && l.count % below === 0) {
              line = below;
              break;
            }
            if (above <= top && l.count % above === 0) {
              line = above;
              break;
            }
          }
          if (clean && line > 0 && l.count % line !== 0) ok = false;
        }
        if (line < 1) {
          ok = false;
          break;
        }
        lines.set(l, line);
        const other = Math.ceil(l.count / line);
        if (!narrow) {
          if (line * p > m.availH) ok = false;
          total += Math.max(other * p, this.labelW(l));
        } else {
          if (line * p > m.availW) ok = false;
          total += other * p + m.labH + 6;
        }
      }
      if (ok && total <= (narrow ? m.bottom - m.top + 6 : m.availW)) return { p, lines };
    }
    void W;
    return null;
  }

  private margins(): { labH: number; top: number; bottom: number; left: number; right: number; gap: number; availH: number; availW: number } {
    const { W, narrow } = this;
    const labH = this.tight ? 22 : narrow ? 26 : 32;
    const top = this.tight ? 10 : narrow ? 16 : 26;
    const bottom = this.floor - (this.tight ? 2 : 6);
    const left = narrow ? 14 : 36;
    const right = W - left;
    return { labH, top, bottom, left, right, gap: this.tight ? 7 : narrow ? 12 : 34, availH: bottom - top - labH - 8, availW: right - left };
  }

  /**
   * Blocks side by side on a wide stage, stacked on a narrow one. A block's shape (rows when wide,
   * columns when narrow) is fixed when the group is made, so a later change elsewhere slides and
   * scales the block as one piece; it never reshuffles the dots inside it.
   */
  private layout(): { pos: Float32Array; p: number } {
    const { W, narrow, leaves } = this;
    const { labH, top, bottom, left, gap, availH } = this.margins();
    const pos = new Float32Array(2 * this.N);
    let p: number;
    if (this.strip) {
      p = this.strip.p;
      for (const l of leaves) {
        l.line = this.strip.line;
        l.fresh = false;
      }
    } else {
      // Clean blocks are worth slightly smaller dots, but not much smaller.
      const loose = this.fit(false);
      const clean = this.fit(true);
      const use = clean && (!loose || clean.p >= loose.p * 0.78) ? clean : loose;
      p = use ? use.p : 2;
      for (const l of leaves) {
        if (!l.line) l.line = use?.lines.get(l) ?? 1;
        l.fresh = false;
      }
    }
    const slot = (l: Group): number => (narrow ? Math.ceil(l.count / l.line) * p + labH + 6 : Math.max(Math.ceil(l.count / l.line) * p, this.labelW(l)));
    const used = leaves.reduce((n, l) => n + slot(l), 0) + gap * (leaves.length - 1);
    let cur = narrow ? Math.max(6, (bottom + top - used) / 2) : (W - used) / 2;
    for (const l of leaves) {
      const cols = narrow ? l.line : Math.ceil(l.count / l.line);
      const rows = narrow ? Math.ceil(l.count / l.line) : l.line;
      const bw = cols * p;
      const bh = rows * p;
      const sl = slot(l);
      const bx = narrow ? left : cur + (sl - bw) / 2;
      const by = narrow ? cur + labH + 6 : top + labH + 8 + (availH - bh) / 2;
      l.rect = { x: bx + bw / 2, y: by + bh / 2, w: bw, h: bh };
      const lw = this.labelW(l);
      l.labelRect = narrow ? { x: left + lw / 2, y: by - labH / 2 - 4, w: lw, h: labH } : { x: cur + sl / 2, y: by - labH / 2 - 8, w: lw, h: labH };
      for (let m = 0; m < l.members.length; m++) {
        const i = l.members[m]!;
        const col = narrow ? m % cols : Math.floor(m / rows);
        const row = narrow ? Math.floor(m / cols) : m % rows;
        pos[2 * i] = bx + (col + 0.5) * p;
        pos[2 * i + 1] = by + (row + 0.5) * p;
      }
      cur += sl + gap;
    }
    return { pos, p };
  }

  /** Group dots that share colours and group, so each frame fills a handful of paths, not a thousand. */
  private bucket(ph: Phase): Phase {
    const map = new Map<number, Bucket>();
    for (let i = 0; i < this.N; i++) {
      const key = ph.cFrom[i]! * 4096 + ph.cTo[i]! * 256 + ph.grp[i]!;
      let b = map.get(key);
      if (!b) map.set(key, (b = { cFrom: ph.cFrom[i]!, cTo: ph.cTo[i]!, grp: ph.grp[i]!, idx: [] }));
      b.idx.push(i);
    }
    ph.buckets = [...map.values()];
    return ph;
  }

  /** One change of arrangement. `movers` travel on arcs with a stagger; everything else closes ranks as one sheet. */
  private phase(ctx: Ctx, movers: ReadonlySet<number>, recolour: ReadonlyMap<number, number>): Phase {
    const N = this.N;
    const prev = this.phases[this.phases.length - 1]!;
    const t0 = Math.max(ctx.t, prev.tEnd);
    const lay = this.layout();
    const ph: Phase = {
      t0,
      t1: t0,
      tEnd: t0,
      from: this.pos,
      to: lay.pos,
      delay: new Float32Array(N),
      dur: new Float32Array(N).fill(1),
      arc: new Float32Array(N),
      cFrom: this.col.slice(),
      cTo: this.col.slice(),
      ct0: t0,
      cdur: 400 * ctx.pace,
      grp: this.grp.slice(),
      pFrom: this.pitch,
      pTo: lay.p,
      buckets: [],
      stands: this.stands(),
    };
    for (const [i, tone] of recolour) ph.cTo[i] = tone;
    // The chosen dots light up where they stand first; only then does anything travel.
    const tA = recolour.size ? 460 * ctx.pace : 0;
    let rank = 0;
    let tEnd = t0 + tA;
    let far = 0;
    const count = movers.size || 1;
    const dists = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      dists[i] = Math.hypot(lay.pos[2 * i]! - this.pos[2 * i]!, lay.pos[2 * i + 1]! - this.pos[2 * i + 1]!);
      if (!movers.has(i) && dists[i]! > far) far = dists[i]!;
    }
    // Everything that is not a mover shifts as one rigid sheet: same start, same duration, so blocks never shear.
    const sheet = travel(D.move * 1.3, far, this.W) * ctx.pace;
    for (let i = 0; i < N; i++) {
      const dist = dists[i]!;
      if (dist < 0.4) continue;
      if (movers.has(i)) {
        ph.delay[i] = tA + (rank++ / count) * 480 * ctx.pace;
        ph.dur[i] = travel(D.move * 1.5, dist, this.W) * ctx.pace;
        ph.arc[i] = -Math.min(54, dist * 0.22);
      } else {
        ph.delay[i] = tA + 90 * ctx.pace;
        ph.dur[i] = sheet;
      }
      tEnd = Math.max(tEnd, t0 + ph.delay[i]! + ph.dur[i]!);
    }
    ph.t1 = t0 + tA;
    ph.tEnd = tEnd;
    this.phases.push(this.bucket(ph));
    this.pos = lay.pos;
    this.col = ph.cTo;
    this.pitch = lay.p;
    ctx.end = Math.max(ctx.end, tEnd);
    return ph;
  }

  private leaf(id: string): Group {
    const l = this.leaves.find((q) => q.id === id);
    if (!l) throw new Error(`"${id}" is not a group that is on stage now.`);
    return l;
  }
  private retire(ctx: Ctx, group: Group, at: number): void {
    group.label.exit(ctx, at - ctx.t);
  }
  private arrive(ctx: Ctx, group: Group, ph: Phase, from = 0): void {
    const lab = group.label;
    lab.place(group.labelRect);
    lab.startHidden();
    lab.c.val.base = from;
    lab.enter(ctx, ph.t1 - ctx.t + 120 * ctx.pace, 'below');
    // The count climbs while the dots arrive, and lands with the last of them.
    ctx.raw(lab.c.val, group.count, ph.t1 + 160 * ctx.pace, Math.max(520, ph.tEnd - ph.t1 - 160 * ctx.pace), E.out);
  }
  /** Leaves that stay but shift because the layout changed: their labels follow their blocks. */
  private follow(ctx: Ctx, ph: Phase, except: ReadonlySet<Group>): void {
    for (const l of this.leaves) {
      if (except.has(l)) continue;
      const c = l.label.c;
      const r = l.labelRect;
      ctx.raw(c.x, r.x, ph.t1 + 90 * ctx.pace, D.move * 1.3 * ctx.pace, E.move);
      ctx.raw(c.y, r.y, ph.t1 + 90 * ctx.pace, D.move * 1.3 * ctx.pace, E.move);
    }
  }

  /**
   * split: the members of each smaller subgroup light up where they stand (scattered through the
   * crowd), then travel out together into their own block while the rest close ranks.
   */
  split(ctx: Ctx, a: ActionData): void {
    const parent = this.leaf(String(a.target));
    const into = Array.isArray(a.into) ? (a.into as { id: string; label: string; count: number; tone?: string }[]) : [];
    if (into.length < 2) throw new Error('split needs "into": at least two groups.');
    const sum = into.reduce((n, k) => n + k.count, 0);
    if (sum !== parent.count) throw new Error(`split: the groups add up to ${sum}, but "${parent.id}" has ${parent.count}.`);
    const at = this.leaves.indexOf(parent);
    const kids = into.map((k) => this.makeGroup(k.id, k.label, k.count, k.tone ?? parent.tone));
    parent.kids = kids;
    const big = kids.reduce((m, k, i) => (k.count > kids[m]!.count ? i : m), 0);
    const pool = Array.from(parent.members);
    if (a.pick !== 'first') {
      const rnd = seeded(parent.id + kids.map((k) => k.id).join());
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = pool[i]!;
        pool[i] = pool[j]!;
        pool[j] = tmp;
      }
    }
    const movers = new Set<number>();
    const recolour = new Map<number, number>();
    const gone = new Set<number>();
    let off = 0;
    kids.forEach((k, ki) => {
      if (ki === big) return;
      k.members = Int32Array.from(pool.slice(off, off + k.count).sort((x, y) => x - y));
      off += k.count;
      for (const i of k.members) {
        movers.add(i);
        gone.add(i);
      }
    });
    // The largest child keeps the parent's shape and order. Each hole a leaver makes is filled by a
    // dot from the tail of the block, so only as many dots move as left: the rest stand still.
    const keep = Array.from(parent.members);
    const size = keep.length - gone.size;
    let tail = keep.length - 1;
    for (let i = 0; i < size; i++) {
      if (!gone.has(keep[i]!)) continue;
      while (gone.has(keep[tail]!)) tail--;
      keep[i] = keep[tail--]!;
    }
    keep.length = size;
    const bigKid = kids[big]!;
    bigKid.members = Int32Array.from(keep);
    bigKid.count = size;
    bigKid.line = parent.line;
    bigKid.fresh = false;
    kids.forEach((k, ki) => {
      for (const i of k.members) {
        this.grp[i] = k.gi;
        if (into[ki]!.tone) recolour.set(i, toneIndex(k.tone));
      }
    });
    this.leaves.splice(at, 1, ...kids);
    const ph = this.phase(ctx, movers, recolour);
    ph.grp = this.grp.slice();
    this.bucket(ph);
    this.retire(ctx, parent, ph.t0 + 120 * ctx.pace);
    kids.forEach((k) => this.arrive(ctx, k, ph));
    this.follow(ctx, ph, new Set(kids));
  }

  /** merge: groups flow together into one block. Dots keep their colours unless a tone is given, so what was mixed stays visible. */
  merge(ctx: Ctx, a: ActionData): void {
    const ids = Array.isArray(a.targets) ? (a.targets as string[]) : [];
    const into = a.into as { id: string; label: string; tone?: string } | undefined;
    if (ids.length < 2 || !into) throw new Error('merge needs "targets" (two or more groups) and "into".');
    const parts = ids.map((id) => this.leaf(id));
    const first = parts[0]!;
    const merged = this.makeGroup(into.id, into.label, parts.reduce((n, l) => n + l.count, 0), into.tone ?? first.tone);
    merged.sources = parts;
    merged.members = Int32Array.from(parts.flatMap((l) => Array.from(l.members)));
    const movers = new Set<number>(merged.members);
    const recolour = new Map<number, number>();
    for (const i of merged.members) {
      this.grp[i] = merged.gi;
      if (into.tone) recolour.set(i, toneIndex(into.tone));
    }
    this.leaves = this.leaves.filter((l) => !parts.includes(l) || l === first);
    this.leaves[this.leaves.indexOf(first)] = merged;
    const ph = this.phase(ctx, movers, recolour);
    ph.grp = this.grp.slice();
    this.bucket(ph);
    parts.forEach((l) => this.retire(ctx, l, ph.t0 + 100 * ctx.pace));
    this.arrive(ctx, merged, ph, Math.max(...parts.map((l) => l.count)));
    this.follow(ctx, ph, new Set([merged]));
  }

  override set(ctx: Ctx, a: ActionData): void {
    const ids = this.ids(a);
    const groups = ids.filter((id) => this.parts.get(id) instanceof Group);
    if (groups.length && typeof a.tone === 'string') {
      const recolour = new Map<number, number>();
      for (const id of groups) {
        const l = this.leaf(id);
        l.tone = a.tone;
        l.label.setTone(ctx, a.tone);
        for (const i of l.members) recolour.set(i, toneIndex(a.tone));
      }
      this.phase(ctx, new Set(), recolour);
    }
    const rest = ids.filter((id) => !groups.includes(id));
    if (rest.length) super.set(ctx, { ...a, targets: rest });
  }

  override intro(ctx: Ctx): void {
    const root = this.leaves[0]!;
    root.label.startHidden();
    root.label.c.val.base = 0;
    root.label.enter(ctx, 220 * ctx.pace, 'below');
    ctx.raw(root.label.c.val, this.N, ctx.t + 220 * ctx.pace, 860 * ctx.pace, E.out);
    this.introStats(ctx, 320);
    ctx.end = Math.max(ctx.end, ctx.t + 1080 * ctx.pace);
  }

  // ------------------------------------------------------------------------------------------ taps
  /** A group is tapped on its block or its label. Where the groups stand is kept with each arrangement, so any instant can be asked. */
  override taps(t: number): TapTarget[] {
    let k = this.phases.length - 1;
    while (k > 0 && this.phases[k]!.t0 > t) k--;
    // A little room round each group, but never so much that two groups' boxes meet.
    const m = this.narrow ? 1 : 6;
    return this.phases[k]!.stands.map((st) => {
      const x0 = Math.min(st.rect.x - st.rect.w / 2, st.label.x - st.label.w / 2) - m;
      const x1 = Math.max(st.rect.x + st.rect.w / 2, st.label.x + st.label.w / 2) + m;
      const y0 = Math.min(st.rect.y - st.rect.h / 2, st.label.y - st.label.h / 2) - m;
      const y1 = Math.max(st.rect.y + st.rect.h / 2, st.label.y + st.label.h / 2) + m;
      return this.tapTarget(st.id, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, label: st.said }, t);
    });
  }

  // ------------------------------------------------------------------------------------------ explore
  override bind(id: string): void {
    super.bind(id);
    const p = this.parts.get(id);
    if (!(p instanceof Group)) return;
    if (p.sources) throw new Error(`explore: "${id}" was made by a merge. Bind the groups that were merged into it, or the group they were split from.`);
    if (p === this.groups[0]) throw new Error(`explore: "${id}" is every dot there is; a formula can drive the groups it is split into.`);
    this.bound.add(id);
  }
  override busy(): boolean {
    return this.moving;
  }

  /** The sheet: the one order the dots have once the clip has ended, and the pieces it is cut into. */
  private makeSheet(): Sheet {
    const nodes: Node[] = this.groups.map((g) => ({ id: g.id, name: g.name, authored: g.count, kids: g.kids?.map((k) => k.id) ?? null, sources: g.sources?.map((q) => q.id) ?? null }));
    const atomsOf = (g: Group): Group[] => (g.sources ? g.sources.flatMap(atomsOf) : [g]);
    const order: number[] = [];
    const pieces: Piece[] = this.leaves.map((l) => {
      const anchor = order.length;
      for (const i of l.members) order.push(i);
      const atoms = atomsOf(l).map((a) => ({ id: a.id, tone: a.members.length ? this.col[a.members[0]!]! : toneIndex(a.tone) }));
      return { group: l, anchor, atoms, labelW: this.labelW(l) };
    });
    const lab = new Float32Array(2 * pieces.length);
    pieces.forEach((pc, k) => {
      lab[2 * k] = pc.group.labelRect.x;
      lab[2 * k + 1] = pc.group.labelRect.y;
    });
    return { nodes, order: Int32Array.from(order), pieces, at: this.pos.slice(), lab, last: -1 };
  }

  /**
   * Where everything belongs for the learner's numbers: every dot's place and colour, and every
   * label's place and count. A pure function of the counts; it uses the same arithmetic as
   * `layout`, so with the clip's own counts it gives the clip's own last picture.
   */
  private place(sheet: Sheet, x: ExploreState): { to: Float32Array; tone: Uint8Array; piece: Uint16Array; labels: { x: number; y: number; n: number }[] } {
    const { W, N, narrow } = this;
    const { labH, top, bottom, left, gap, availH } = this.margins();
    const p = this.pitch;
    const counts = resolve(sheet.nodes, N, (id) => (this.bound.has(id) ? x.values.get(id)?.v : undefined));
    const to = new Float32Array(2 * N);
    const tone = new Uint8Array(N);
    const piece = new Uint16Array(N);
    // Each piece's run of the sheet, and the lines of its grid that the run touches.
    let rank = 0;
    const runs = sheet.pieces.map((pc, k) => {
      const lo = rank;
      for (const a of pc.atoms) {
        const n = k === sheet.pieces.length - 1 && a === pc.atoms[pc.atoms.length - 1] ? N - rank : Math.min(counts.get(a.id) ?? 0, N - rank);
        for (let r = rank; r < rank + n; r++) {
          tone[sheet.order[r]!] = a.tone;
          piece[sheet.order[r]!] = k;
        }
        rank += n;
      }
      const line = pc.group.line || 1;
      const first = Math.floor((lo - pc.anchor) / line);
      const lines = rank > lo ? Math.floor((rank - 1 - pc.anchor) / line) - first + 1 : 0;
      return { lo, hi: rank, line, first, lines };
    });
    const slot = (k: number): number => (narrow ? runs[k]!.lines * p + labH + 6 : Math.max(runs[k]!.lines * p, sheet.pieces[k]!.labelW));
    const used = runs.reduce((n, _, k) => n + slot(k), 0) + gap * (runs.length - 1);
    let cur = narrow ? Math.max(6, (bottom + top - used) / 2) : (W - used) / 2;
    const labels = runs.map((run, k) => {
      const pc = sheet.pieces[k]!;
      const sl = slot(k);
      const across = narrow ? run.line : run.lines;
      const down = narrow ? run.lines : run.line;
      const bx = narrow ? left : cur + (sl - across * p) / 2;
      const by = narrow ? cur + labH + 6 : top + labH + 8 + (availH - down * p) / 2;
      for (let r = run.lo; r < run.hi; r++) {
        const s = r - pc.anchor;
        const along = Math.floor(s / run.line) - run.first;
        const within = s - Math.floor(s / run.line) * run.line;
        const i = sheet.order[r]!;
        to[2 * i] = bx + ((narrow ? within : along) + 0.5) * p;
        to[2 * i + 1] = by + ((narrow ? along : within) + 0.5) * p;
      }
      const at = narrow ? { x: left + pc.labelW / 2, y: by - labH / 2 - 4 } : { x: cur + sl / 2, y: by - labH / 2 - 8 };
      cur += sl + gap;
      return { ...at, n: run.hi - run.lo };
    });
    return { to, tone, piece, labels };
  }

  /** The stage with the learner's numbers: every dot heads for where `place` says it belongs. */
  private drawLive(t: number, x: ExploreState): void {
    const sheet = (this.sheet ??= this.makeSheet());
    const { W, H, dpr, N } = this;
    const want = this.place(sheet, x);
    // A dot does not jump to its new block: it closes most of the distance left with every frame.
    const fresh = sheet.last < 0;
    if (fresh) {
      sheet.at.set(this.pos);
      sheet.pieces.forEach((pc, k) => {
        sheet.lab[2 * k] = pc.group.labelRect.x;
        sheet.lab[2 * k + 1] = pc.group.labelRect.y;
      });
    }
    const dt = fresh ? 0 : clamp(x.now - sheet.last, 0, 64);
    sheet.last = x.now;
    const k = x.instant ? 1 : 1 - Math.exp(-dt / 70);
    let moving = false;
    const chase = (at: Float32Array, to: ArrayLike<number>, n: number): void => {
      for (let i = 0; i < n; i++) {
        const d = to[i]! - at[i]!;
        if (d === 0) continue;
        if (k >= 1 || Math.abs(d) < 0.3) at[i] = to[i]!;
        else {
          at[i] = at[i]! + d * k;
          moving = true;
        }
      }
    };
    chase(sheet.at, want.to, 2 * N);
    const labTo = new Float32Array(2 * want.labels.length);
    want.labels.forEach((l, i) => {
      labTo[2 * i] = l.x;
      labTo[2 * i + 1] = l.y;
    });
    chase(sheet.lab, labTo, labTo.length);
    this.moving = moving;
    sheet.pieces.forEach((pc, i) => {
      const n = want.labels[i]!.n;
      pc.group.label.apply(t, { v: n, s: n.toLocaleString('en-US'), x: sheet.lab[2 * i]!, y: sheet.lab[2 * i + 1]! });
    });
    const g = this.g;
    if (!g) return;
    this.sig = '';
    const cam = this.camera(t);
    const r = this.pitch * 0.37;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * (W / 2 - cam.x * cam.z), dpr * (H / 2 - cam.y * cam.z));
    // One path for each colour of each piece.
    const C = this.colors;
    const pieces = sheet.pieces.length;
    const paths = new Map<number, number[]>();
    for (let i = 0; i < N; i++) {
      const key = want.piece[i]! * TONES.length + want.tone[i]!;
      let list = paths.get(key);
      if (!list) paths.set(key, (list = []));
      list.push(i);
    }
    for (const key of [...paths.keys()].sort((a, b) => a - b)) {
      const pc = sheet.pieces[Math.min(pieces - 1, Math.floor(key / TONES.length))]!;
      const c = C[TONES[key % TONES.length] as ToneName];
      g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      g.globalAlpha = 1 - 0.82 * pc.group.c.dim.at(t);
      g.beginPath();
      for (const i of paths.get(key)!) {
        const px = sheet.at[2 * i]!;
        const py = sheet.at[2 * i + 1]!;
        g.moveTo(px + r, py);
        g.arc(px, py, r, 0, TAU);
      }
      g.fill();
    }
    g.globalAlpha = 1;
  }

  override apply(t: number, x?: ExploreState): void {
    super.apply(t, x);
    if (x && this.bound.size) {
      this.drawLive(t, x);
      return;
    }
    // Back in the clip's own picture: the next hand-over starts from it again.
    if (this.sheet) this.sheet.last = -1;
    this.moving = false;
    const g = this.g;
    if (!g) return;
    const { W, H, dpr } = this;
    const cam = this.camera(t);
    const z = cam.z;
    let k = this.phases.length - 1;
    while (k > 0 && this.phases[k]!.t0 > t) k--;
    const ph = this.phases[k]!;
    const local = t - ph.t0;
    // Nothing to repaint while the picture is at rest: same phase, finished, same camera, same dimming.
    let sig = `${k}|${t >= ph.tEnd && t > 1300 ? 'rest' : t}|${cam.x}|${cam.y}|${z}`;
    for (const b of ph.buckets) sig += `|${this.groups[b.grp]!.c.dim.at(t)}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const span = Math.max(1, ph.tEnd - ph.t1);
    const pu = ease3(clamp((t - ph.t1) / span, 0, 1));
    const r = (ph.pFrom + (ph.pTo - ph.pFrom) * pu) * 0.37;
    const cu = clamp((t - ph.ct0) / ph.cdur, 0, 1);
    const ce = cu * cu * (3 - 2 * cu);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - cam.x * z), dpr * (H / 2 - cam.y * z));
    const C = this.colors;
    for (const b of ph.buckets) {
      const a = C[TONES[b.cFrom] as ToneName];
      const c2 = C[TONES[b.cTo] as ToneName];
      const changing = b.cFrom !== b.cTo;
      g.fillStyle = changing
        ? `rgb(${Math.round(a[0] + (c2[0] - a[0]) * ce)},${Math.round(a[1] + (c2[1] - a[1]) * ce)},${Math.round(a[2] + (c2[2] - a[2]) * ce)})`
        : `rgb(${a[0]},${a[1]},${a[2]})`;
      g.globalAlpha = 1 - 0.82 * this.groups[b.grp]!.c.dim.at(t);
      // A dot that is changing colour swells as it changes: that is how the eye finds it in a crowd.
      const rr0 = changing ? r * (1 + 0.6 * Math.sin(Math.PI * cu)) : r;
      g.beginPath();
      for (let q = 0; q < b.idx.length; q++) {
        const i = b.idx[q]!;
        const u = clamp((local - ph.delay[i]!) / ph.dur[i]!, 0, 1);
        const e = ease3(u);
        const x = ph.from[2 * i]! + (ph.to[2 * i]! - ph.from[2 * i]!) * e;
        const y = ph.from[2 * i + 1]! + (ph.to[2 * i + 1]! - ph.from[2 * i + 1]!) * e + (ph.arc[i] ? ph.arc[i]! * Math.sin(Math.PI * e) : 0);
        let rr = rr0;
        if (ph.intro) {
          const iu = clamp((t - ph.intro[i]!) / 320, 0, 1);
          rr = r * (1 - Math.pow(1 - iu, 3));
          if (rr < 0.05) continue;
        }
        g.moveTo(x + rr, y);
        g.arc(x, y, rr, 0, TAU);
      }
      g.fill();
    }
    g.globalAlpha = 1;
  }
}

registerKit('dots', (data: DotsData, env) => new DotsStage(data, env));
