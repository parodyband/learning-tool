// Layout of a flow figure as pure geometry: no DOM, so it can be tested on its own.
//
// A flow is drawn in layers (Sugiyama's scheme, cut down to what at most twelve nodes need):
//   1. edges that close a cycle are found by depth-first search and treated as pointing backwards;
//   2. each node gets a layer, one past its deepest predecessor, with a cap on nodes per layer so a
//      narrow column can still hold the drawing;
//   3. nodes are ordered within layers to reduce crossings (barycentre sweeps);
//   4. nodes are placed, and each edge is routed.
// An edge between neighbouring layers is a curve across the gap between them. Every other edge
// (a skip forward, a loop back) leaves the node area and runs in a lane of its own down one side,
// so no edge ever passes through a node.
//
// A ring sets the same nodes out around a loop instead: round an ellipse when there is room
// (`placeRingEllipse`), otherwise up and down two columns (`placeRingTrack`). Both hold to the
// same rule by checking it: every route is walked before it is returned, and a ring in which some
// connection could only be drawn through a node is not drawn as a ring at all. The caller then
// falls back to the layers above, where the rule holds by construction.
//
// Coordinates inside this file are "main" (the direction the layers advance) and "cross". They are
// turned into x and y at the end, so "down" and "right" share every line of the layout.

export interface Edge {
  from: number;
  to: number;
}

export interface EdgeInput extends Edge {
  /** Size of the edge's label chip, or 0 by 0 when it has none. */
  labelW: number;
  labelH: number;
  /** How wide the chip is when its text is set along a lane instead of across it. */
  turnedW?: number;
}

export interface Size {
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layering {
  /** The layer of each node. */
  layerOf: number[];
  /** The nodes of each layer, in the order they are drawn. */
  layers: number[][];
}

/** A connector as a cubic curve (four points) or a run of straight segments whose corners are rounded when drawn. */
export interface Route {
  kind: 'curve' | 'ortho';
  points: Pt[];
  /** Centre of the label chip, for an edge that has one. */
  label: Pt | null;
  /** For an `ortho` route, the two ends of the lane segment, along which the label may slide. */
  lane?: [Pt, Pt];
}

export interface Placed {
  width: number;
  height: number;
  nodes: Rect[];
  /** One per edge, null for an edge whose ends do not both exist. */
  routes: (Route | null)[];
}

/** Distances the layout is built from, in pixels. The caller derives them from the font size. */
export interface Metrics {
  /** Between two nodes of one layer. */
  nodeGap: number;
  /** Between two layers, before room for labels and tracks is added. */
  layerGap: number;
  /** Width of a lane that carries no label. */
  lane: number;
  /** Clear space kept around a label chip. */
  labelPad: number;
  /** Room an arrowhead needs before it meets a node. */
  arrow: number;
  /** Between two parallel runs inside one gap. */
  track: number;
  /** Between two connectors that meet the same side of a node. */
  port: number;
  /** How far a self-loop stands out from its node. */
  loop: number;
}

export type Direction = 'down' | 'right';

const valid = (e: Edge, n: number): boolean => Number.isInteger(e.from) && Number.isInteger(e.to) && e.from >= 0 && e.to >= 0 && e.from < n && e.to < n;

/** Edges that close a cycle, found depth-first from the nodes in the order the author gave them. */
export function backEdges(n: number, edges: readonly Edge[]): boolean[] {
  const out: number[][] = Array.from({ length: n }, () => []);
  edges.forEach((e, i) => {
    if (valid(e, n) && e.from !== e.to) (out[e.from] as number[]).push(i);
  });
  const state = new Uint8Array(n);
  const back = edges.map(() => false);
  for (let start = 0; start < n; start++) {
    if (state[start] !== 0) continue;
    const stack: { v: number; k: number }[] = [{ v: start, k: 0 }];
    state[start] = 1;
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as { v: number; k: number };
      const list = out[top.v] as number[];
      if (top.k < list.length) {
        const ei = list[top.k++] as number;
        const w = (edges[ei] as Edge).to;
        if (state[w] === 1) back[ei] = true;
        else if (state[w] === 0) {
          state[w] = 1;
          stack.push({ v: w, k: 0 });
        }
      } else {
        state[top.v] = 2;
        stack.pop();
      }
    }
  }
  return back;
}

/**
 * Give every node a layer so that each forward edge points to a later layer, with at most `cap`
 * nodes in a layer. A node with nothing before it is moved down to sit just above what it feeds,
 * which keeps a late-joining input from needing a long connector.
 */
export function assignLayers(n: number, edges: readonly Edge[], cap = Number.POSITIVE_INFINITY): Layering {
  const back = backEdges(n, edges);
  const preds: number[][] = Array.from({ length: n }, () => []);
  const succs: number[][] = Array.from({ length: n }, () => []);
  edges.forEach((e, i) => {
    if (!valid(e, n) || e.from === e.to || back[i]) return;
    (succs[e.from] as number[]).push(e.to);
    (preds[e.to] as number[]).push(e.from);
  });

  // Longest path from the sources, in topological order.
  const raw = new Array<number>(n).fill(0);
  const waiting = preds.map((p) => p.length);
  const queue: number[] = [];
  for (let v = 0; v < n; v++) if (waiting[v] === 0) queue.push(v);
  const topo: number[] = [];
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head] as number;
    topo.push(v);
    for (const w of succs[v] as number[]) {
      raw[w] = Math.max(raw[w] as number, (raw[v] as number) + 1);
      waiting[w] = (waiting[w] as number) - 1;
      if (waiting[w] === 0) queue.push(w);
    }
  }
  for (const v of topo) {
    const next = succs[v] as number[];
    if ((preds[v] as number[]).length === 0 && next.length > 0) raw[v] = Math.min(...next.map((w) => raw[w] as number)) - 1;
  }

  const limit = Math.max(1, Math.floor(cap));
  const order = Array.from({ length: n }, (_, v) => v).sort((a, b) => (raw[a] as number) - (raw[b] as number) || a - b);
  const layerOf = new Array<number>(n).fill(0);
  const layers: number[][] = [];
  for (const v of order) {
    let layer = 0;
    for (const u of preds[v] as number[]) layer = Math.max(layer, (layerOf[u] as number) + 1);
    // A source that was moved down stays at least where the longest path put it.
    layer = Math.max(layer, raw[v] as number);
    while ((layers[layer]?.length ?? 0) >= limit) layer++;
    while (layers.length <= layer) layers.push([]);
    (layers[layer] as number[]).push(v);
    layerOf[v] = layer;
  }
  // Capping can leave a layer empty when everything in it was pushed on; close the gaps.
  const kept = layers.filter((l) => l.length > 0);
  kept.forEach((l, i) => {
    for (const v of l) layerOf[v] = i;
  });
  const result: Layering = { layerOf, layers: kept };
  orderLayers(result, edges);
  return result;
}

function crossings(layering: Layering, near: readonly Edge[]): number {
  const pos = new Map<number, number>();
  for (const layer of layering.layers) layer.forEach((v, i) => pos.set(v, i));
  let count = 0;
  for (let i = 0; i < near.length; i++) {
    const a = near[i] as Edge;
    const aTop = (layering.layerOf[a.from] as number) < (layering.layerOf[a.to] as number) ? a.from : a.to;
    const aBottom = aTop === a.from ? a.to : a.from;
    for (let j = i + 1; j < near.length; j++) {
      const b = near[j] as Edge;
      const bTop = (layering.layerOf[b.from] as number) < (layering.layerOf[b.to] as number) ? b.from : b.to;
      const bBottom = bTop === b.from ? b.to : b.from;
      if (layering.layerOf[aTop] !== layering.layerOf[bTop]) continue;
      const d1 = (pos.get(aTop) as number) - (pos.get(bTop) as number);
      const d2 = (pos.get(aBottom) as number) - (pos.get(bBottom) as number);
      if (d1 * d2 < 0) count++;
    }
  }
  return count;
}

/** Reorder the nodes inside each layer to reduce crossings between neighbouring layers. */
function orderLayers(layering: Layering, edges: readonly Edge[]): void {
  const n = layering.layerOf.length;
  const near = edges.filter((e) => valid(e, n) && Math.abs((layering.layerOf[e.from] as number) - (layering.layerOf[e.to] as number)) === 1);
  if (near.length === 0) return;
  const up: number[][] = Array.from({ length: n }, () => []);
  const down: number[][] = Array.from({ length: n }, () => []);
  for (const e of near) {
    const top = (layering.layerOf[e.from] as number) < (layering.layerOf[e.to] as number) ? e.from : e.to;
    const bottom = top === e.from ? e.to : e.from;
    (down[top] as number[]).push(bottom);
    (up[bottom] as number[]).push(top);
  }
  const sweep = (layerIndex: number, neighbours: number[][], reference: number[] | undefined): void => {
    const layer = layering.layers[layerIndex] as number[];
    if (!reference) return;
    const refPos = new Map(reference.map((v, i) => [v, i]));
    // A node with no neighbour on that side keeps the place it has, scaled to the reference layer.
    const scale = reference.length / Math.max(1, layer.length);
    const key = new Map(
      layer.map((v, i) => {
        const ns = neighbours[v] as number[];
        return [v, ns.length > 0 ? ns.reduce((sum, u) => sum + (refPos.get(u) as number), 0) / ns.length : (i + 0.5) * scale - 0.5];
      }),
    );
    const before = new Map(layer.map((v, i) => [v, i]));
    layer.sort((a, b) => (key.get(a) as number) - (key.get(b) as number) || (before.get(a) as number) - (before.get(b) as number));
  };

  let best = layering.layers.map((l) => [...l]);
  let bestCount = crossings(layering, near);
  for (let round = 0; round < 6 && bestCount > 0; round++) {
    for (let i = 1; i < layering.layers.length; i++) sweep(i, up, layering.layers[i - 1]);
    for (let i = layering.layers.length - 2; i >= 0; i--) sweep(i, down, layering.layers[i + 1]);
    const count = crossings(layering, near);
    if (count < bestCount) {
      bestCount = count;
      best = layering.layers.map((l) => [...l]);
    }
  }
  layering.layers = best;
}

// ---------------------------------------------------------------------------------------------
// Routing plan: which edges cross a gap, which take a lane, and how much room each needs
// ---------------------------------------------------------------------------------------------

type Side = -1 | 1;

interface FarEdge {
  edge: number;
  side: Side;
  lane: number;
  /** Whether each end meets the side of its node (true) or goes round through the gap next to it. */
  sideExit: boolean;
  sideEntry: boolean;
  exitTrack: number;
  entryTrack: number;
}

interface Routing {
  kind: ('near' | 'far' | 'self' | 'none')[];
  far: Map<number, FarEdge>;
  /** Lane widths per side, innermost first. */
  lanes: { low: number[]; high: number[] };
  /** Room each side needs outside the nodes. */
  low: number;
  high: number;
  /** Main size of each gap: gap g lies before layer g, and the last one lies after the last layer. */
  gaps: number[];
  /** Tracks in each gap: how many leave the layer before it and how many enter the layer after it. */
  exits: number[];
  entries: number[];
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * `turned` plans for lane labels set sideways along their lane (see `Plan.turned`), which takes the
 * room of one line of text instead of the label's whole length.
 */
function planRoutes(layering: Layering, edges: readonly EdgeInput[], direction: Direction, m: Metrics, turned = false): Routing {
  const n = layering.layerOf.length;
  const layerCount = layering.layers.length;
  const at = (v: number): number => (layering.layers[layering.layerOf[v] as number] as number[]).indexOf(v);
  const isFirst = (v: number): boolean => at(v) === 0;
  const isLast = (v: number): boolean => at(v) === (layering.layers[layering.layerOf[v] as number] as number[]).length - 1;
  const labelCross = (e: EdgeInput): number => (e.labelW > 0 ? (direction === 'down' ? e.labelW : e.labelH) : 0);
  const laneLabel = (e: EdgeInput): number => (e.labelW > 0 && turned && direction === 'down' ? (e.turnedW ?? Math.min(e.labelW, e.labelH)) : labelCross(e));
  const labelMain = (e: EdgeInput): number => (e.labelW > 0 ? (direction === 'down' ? e.labelH : e.labelW) : 0);

  const kind: Routing['kind'] = edges.map((e) => {
    if (!valid(e, n)) return 'none';
    if (e.from === e.to) return 'self';
    return Math.abs((layering.layerOf[e.from] as number) - (layering.layerOf[e.to] as number)) === 1 ? 'near' : 'far';
  });

  const far = new Map<number, FarEdge>();
  const bySide: { low: number[]; high: number[] } = { low: [], high: [] };
  edges.forEach((e, i) => {
    if (kind[i] !== 'far') return;
    const high = (isLast(e.from) ? 1 : 0) + (isLast(e.to) ? 1 : 0);
    const low = (isFirst(e.from) ? 1 : 0) + (isFirst(e.to) ? 1 : 0);
    // On a tie, loops back go down one side and skips forward down the other, so the two read apart.
    const backwards = (layering.layerOf[e.to] as number) < (layering.layerOf[e.from] as number);
    const side: Side = high > low ? 1 : low > high ? -1 : backwards ? 1 : -1;
    far.set(i, { edge: i, side, lane: 0, sideExit: side === 1 ? isLast(e.from) : isFirst(e.from), sideEntry: side === 1 ? isLast(e.to) : isFirst(e.to), exitTrack: 0, entryTrack: 0 });
    bySide[side === 1 ? 'high' : 'low'].push(i);
  });

  // Lanes: short spans innermost, and two edges share a lane when their spans do not meet.
  const span = (i: number): [number, number] => {
    const e = edges[i] as EdgeInput;
    const a = layering.layerOf[e.from] as number;
    const b = layering.layerOf[e.to] as number;
    return [Math.min(a, b), Math.max(a, b)];
  };
  const lanes: Routing['lanes'] = { low: [], high: [] };
  for (const key of ['low', 'high'] as const) {
    const taken: [number, number][][] = [];
    const list = [...bySide[key]].sort((a, b) => span(a)[1] - span(a)[0] - (span(b)[1] - span(b)[0]) || span(a)[0] - span(b)[0] || a - b);
    for (const i of list) {
      const [lo, hi] = span(i);
      let lane = taken.findIndex((spans) => spans.every(([a, b]) => hi < a || b < lo));
      if (lane === -1) {
        lane = taken.length;
        taken.push([]);
        lanes[key].push(m.lane);
      }
      (taken[lane] as [number, number][]).push([lo, hi]);
      const wanted = laneLabel(edges[i] as EdgeInput);
      if (wanted > 0) lanes[key][lane] = Math.max(lanes[key][lane] as number, wanted + m.labelPad);
      (far.get(i) as FarEdge).lane = lane;
    }
  }

  // Runs through the gaps, for the ends that cannot reach the lane from the side of their node.
  const exits = new Array<number>(layerCount + 1).fill(0);
  const entries = new Array<number>(layerCount + 1).fill(0);
  for (const f of far.values()) {
    const e = edges[f.edge] as EdgeInput;
    if (!f.sideExit) {
      const gap = (layering.layerOf[e.from] as number) + 1;
      f.exitTrack = exits[gap] as number;
      exits[gap] = (exits[gap] as number) + 1;
    }
    if (!f.sideEntry) {
      const gap = layering.layerOf[e.to] as number;
      f.entryTrack = entries[gap] as number;
      entries[gap] = (entries[gap] as number) + 1;
    }
  }

  const nearLabel = new Array<number>(layerCount + 1).fill(0);
  edges.forEach((e, i) => {
    if (kind[i] !== 'near') return;
    const gap = Math.max(layering.layerOf[e.from] as number, layering.layerOf[e.to] as number);
    nearLabel[gap] = Math.max(nearLabel[gap] as number, labelMain(e));
  });
  const gaps = exits.map((ex, g) => {
    const tracks = ex + (entries[g] as number);
    const inner = g > 0 && g < layerCount;
    const base = inner ? Math.max(m.layerGap, (nearLabel[g] as number) > 0 ? (nearLabel[g] as number) + 2 * m.arrow + m.labelPad : 0) : 0;
    return base + (tracks > 0 ? tracks * m.track + (inner ? 0 : m.track) : 0);
  });

  // A self-loop on the last node of a layer stands outside the nodes, like a lane.
  let loopRoom = 0;
  edges.forEach((e, i) => {
    if (kind[i] === 'self' && isLast(e.from)) loopRoom = Math.max(loopRoom, m.loop + (labelCross(e) > 0 ? labelCross(e) + m.labelPad : m.labelPad));
  });
  const low = lanes.low.length > 0 ? sum(lanes.low) + m.labelPad : 0;
  const high = Math.max(lanes.high.length > 0 ? sum(lanes.high) + m.labelPad : 0, loopRoom);
  return { kind, far, lanes, low, high, gaps, exits, entries };
}

// ---------------------------------------------------------------------------------------------
// Choosing a direction and a node width for the room there is
// ---------------------------------------------------------------------------------------------

export interface PlanOptions {
  /** Width there is to draw in. */
  avail: number;
  wanted: Direction;
  /** Narrowest and widest a node may be. */
  minNode: number;
  maxNode: number;
  metrics: Metrics;
}

export interface Plan {
  direction: Direction;
  layering: Layering;
  /** Every node is drawn this wide; heights are then measured. */
  nodeWidth: number;
  /** Which edges run in a lane outside the nodes, by edge index. */
  far: boolean[];
  /**
   * Whether the labels of those edges are to be set along their lanes (reading downwards) instead
   * of across them. The caller turns the labels and measures them again before placing anything.
   */
  turned: boolean;
}

/**
 * Pick the layout that fits. "right" is kept only when every layer fits side by side at a readable
 * width; otherwise the layers run down the page, with as many nodes abreast as the width allows.
 * When even one node and its lanes are too wide the drawing overflows, and the caller scrolls it.
 */
export function planLayered(n: number, edges: readonly EdgeInput[], o: PlanOptions): Plan {
  const m = o.metrics;
  const hasSelf = edges.some((e) => valid(e, n) && e.from === e.to);
  const nodeGap = hasSelf ? Math.max(m.nodeGap, m.loop + m.labelPad) : m.nodeGap;
  const farOf = (routing: Routing): boolean[] => routing.kind.map((k) => k === 'far');
  if (o.wanted === 'right') {
    const layering = assignLayers(n, edges);
    const routing = planRoutes(layering, edges, 'right', m);
    const width = (o.avail - sum(routing.gaps)) / Math.max(1, layering.layers.length);
    if (width >= o.minNode * 0.9) return { direction: 'right', layering, nodeWidth: Math.min(o.maxNode, width), far: farOf(routing), turned: false };
  }
  // As many nodes abreast as fit, because branches and joins read best side by side. At each
  // width the lane labels are set across their lanes if that leaves the nodes comfortable room,
  // along the lanes if it does not, and a narrower drawing is the last resort.
  const widest = Math.max(1, Math.floor((o.avail + nodeGap) / (o.minNode + nodeGap)));
  let last: Plan | null = null;
  for (let cap = Math.min(widest, Math.max(1, n)); cap >= 1; cap--) {
    const layering = assignLayers(n, edges, cap);
    const abreast = Math.max(1, ...layering.layers.map((l) => l.length));
    const attempt = (turned: boolean): { plan: Plan; width: number; lanes: boolean } => {
      const routing = planRoutes(layering, edges, 'down', m, turned);
      const width = (o.avail - routing.low - routing.high - (abreast - 1) * nodeGap) / abreast;
      const plan: Plan = { direction: 'down', layering, nodeWidth: Math.min(o.maxNode, Math.max(width, o.minNode * 0.72)), far: farOf(routing), turned };
      return { plan, width, lanes: routing.kind.some((k, i) => k === 'far' && (edges[i] as EdgeInput).labelW > 0) };
    };
    const across = attempt(false);
    if (across.width >= o.minNode * (across.lanes ? 1.25 : 1)) return across.plan;
    last = across.plan;
    if (across.lanes) {
      const along = attempt(true);
      if (along.width >= o.minNode) return along.plan;
      if (across.width >= o.minNode) return across.plan;
      last = along.plan;
    }
  }
  return last ?? { direction: 'down', layering: assignLayers(n, edges, 1), nodeWidth: o.minNode, far: edges.map(() => false), turned: false };
}

// ---------------------------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------------------------

interface Box {
  /** Start and size along the main axis, and along the cross axis. */
  m: number;
  c: number;
  sm: number;
  sc: number;
}

/** Positions for boxes of the given sizes, as near to `desired` as their order, the gap and the bounds allow. */
function fit(desired: readonly number[], sizes: readonly number[], gap: number, lo: number, hi: number): number[] {
  const pos: number[] = [];
  for (let i = 0; i < desired.length; i++) pos.push(i === 0 ? Math.max(lo, desired[i] as number) : Math.max(desired[i] as number, (pos[i - 1] as number) + (sizes[i - 1] as number) + gap));
  for (let i = pos.length - 1; i >= 0; i--) {
    const limit = i === pos.length - 1 ? hi - (sizes[i] as number) : (pos[i + 1] as number) - gap - (sizes[i] as number);
    pos[i] = Math.min(pos[i] as number, limit);
  }
  return pos;
}

type Face = 'in' | 'out' | 'low' | 'high';

/** Lay the nodes out in their layers and route every edge. Sizes are the measured boxes of the nodes. */
export function placeLayered(sizes: readonly Size[], edges: readonly EdgeInput[], layering: Layering, direction: Direction, m: Metrics): Placed {
  const n = sizes.length;
  const down = direction === 'down';
  const routing = planRoutes(layering, edges, direction, m);
  const hasSelf = routing.kind.includes('self');
  const nodeGap = hasSelf ? Math.max(m.nodeGap, m.loop + m.labelPad) : m.nodeGap;
  const boxes: Box[] = sizes.map((s) => ({ m: 0, c: 0, sm: down ? s.h : s.w, sc: down ? s.w : s.h }));
  const box = (v: number): Box => boxes[v] as Box;
  const layerOf = (v: number): number => layering.layerOf[v] as number;

  // Cross axis: each layer packed and centred, then pulled towards its neighbours so chains run straight.
  const totals = layering.layers.map((l) => sum(l.map((v) => box(v).sc)) + (l.length - 1) * nodeGap);
  const extent = Math.max(0, ...totals);
  layering.layers.forEach((l, i) => {
    let c = (extent - (totals[i] as number)) / 2;
    for (const v of l) {
      box(v).c = c;
      c += box(v).sc + nodeGap;
    }
  });
  const upOf: number[][] = Array.from({ length: n }, () => []);
  const downOf: number[][] = Array.from({ length: n }, () => []);
  edges.forEach((e, i) => {
    if (routing.kind[i] !== 'near') return;
    const top = layerOf(e.from) < layerOf(e.to) ? e.from : e.to;
    const bottom = top === e.from ? e.to : e.from;
    (downOf[top] as number[]).push(bottom);
    (upOf[bottom] as number[]).push(top);
  });
  const centre = (v: number): number => box(v).c + box(v).sc / 2;
  const align = (layer: readonly number[], neighbours: number[][]): void => {
    const desired = layer.map((v) => {
      const ns = neighbours[v] as number[];
      return ns.length > 0 ? sum(ns.map(centre)) / ns.length - box(v).sc / 2 : box(v).c;
    });
    const pos = fit(desired, layer.map((v) => box(v).sc), nodeGap, 0, extent);
    layer.forEach((v, i) => {
      box(v).c = pos[i] as number;
    });
  };
  for (let round = 0; round < 2; round++) {
    for (let i = 1; i < layering.layers.length; i++) align(layering.layers[i] as number[], upOf);
    for (let i = layering.layers.length - 2; i >= 0; i--) align(layering.layers[i] as number[], downOf);
  }

  // Main axis: layers one after another, each node centred in its layer's band.
  const bandStart: number[] = [];
  const bandSize: number[] = [];
  let cursor = routing.gaps[0] as number;
  layering.layers.forEach((l, i) => {
    const size = Math.max(0, ...l.map((v) => box(v).sm));
    bandStart.push(cursor);
    bandSize.push(size);
    for (const v of l) box(v).m = cursor + (size - box(v).sm) / 2;
    cursor += size + (routing.gaps[i + 1] as number);
  });
  const mainSize = cursor;
  /** Where gap g starts and ends along the main axis. */
  const gapStart = (g: number): number => (g === 0 ? 0 : (bandStart[g - 1] as number) + (bandSize[g - 1] as number));
  const gapEnd = (g: number): number => (g < bandStart.length ? (bandStart[g] as number) : mainSize);

  // Lanes outside the nodes.
  const laneAt = (side: Side, lane: number): number => {
    const widths = side === 1 ? routing.lanes.high : routing.lanes.low;
    const inner = sum(widths.slice(0, lane)) + (widths[lane] as number) / 2 + m.labelPad / 2;
    return side === 1 ? extent + inner : -inner;
  };

  // Ports: where each connector meets each node.
  interface Attach {
    edge: number;
    end: 'from' | 'to';
    key: number;
  }
  const attached = new Map<string, Attach[]>();
  const attach = (v: number, face: Face, a: Attach): void => {
    const k = `${v}:${face}`;
    const list = attached.get(k);
    if (list) list.push(a);
    else attached.set(k, [a]);
  };
  edges.forEach((e, i) => {
    const k = routing.kind[i];
    if (k === 'near') {
      const forward = layerOf(e.to) > layerOf(e.from);
      attach(e.from, forward ? 'out' : 'in', { edge: i, end: 'from', key: centre(e.to) });
      attach(e.to, forward ? 'in' : 'out', { edge: i, end: 'to', key: centre(e.from) });
    } else if (k === 'far') {
      const f = routing.far.get(i) as FarEdge;
      const sideFace: Face = f.side === 1 ? 'high' : 'low';
      const mid = (v: number): number => box(v).m + box(v).sm / 2;
      attach(e.from, f.sideExit ? sideFace : 'out', { edge: i, end: 'from', key: f.sideExit ? mid(e.to) : f.side * 1e9 });
      attach(e.to, f.sideEntry ? sideFace : 'in', { edge: i, end: 'to', key: f.sideEntry ? mid(e.from) : f.side * 1e9 });
    }
  });
  const ports = new Map<string, number>();
  for (const [k, list] of attached) {
    const [vText, face] = k.split(':') as [string, Face];
    const b = box(Number(vText));
    const along = face === 'in' || face === 'out';
    const length = along ? b.sc : b.sm;
    const start = along ? b.c : b.m;
    list.sort((a, c) => a.key - c.key || a.edge - c.edge);
    const step = Math.min(m.port, (length * 0.7) / list.length);
    list.forEach((a, i) => ports.set(`${a.edge}:${a.end}`, start + length / 2 + (i - (list.length - 1) / 2) * step));
  }
  const port = (edge: number, end: 'from' | 'to'): number => ports.get(`${edge}:${end}`) as number;

  // Routes, in main and cross coordinates: a point is [main, cross].
  type MC = [number, number];
  const raw: ({ kind: Route['kind']; points: MC[]; label: MC | null; lane?: [MC, MC] } | null)[] = edges.map((e, i) => {
    const k = routing.kind[i];
    const labelled = e.labelW > 0;
    if (k === 'near') {
      const forward = layerOf(e.to) > layerOf(e.from);
      const a = box(e.from);
      const b = box(e.to);
      const p0: MC = [forward ? a.m + a.sm : a.m, port(i, 'from')];
      const p3: MC = [forward ? b.m : b.m + b.sm, port(i, 'to')];
      const pull = (p3[0] - p0[0]) / 2;
      const points: MC[] = [p0, [p0[0] + pull, p0[1]], [p3[0] - pull, p3[1]], p3];
      return { kind: 'curve', points, label: labelled ? [(p0[0] + p3[0]) / 2, (p0[1] + p3[1]) / 2] : null };
    }
    if (k === 'far') {
      const f = routing.far.get(i) as FarEdge;
      const a = box(e.from);
      const b = box(e.to);
      const lane = laneAt(f.side, f.lane);
      const points: MC[] = [];
      let laneFrom: number;
      if (f.sideExit) {
        laneFrom = port(i, 'from');
        points.push([laneFrom, f.side === 1 ? a.c + a.sc : a.c]);
      } else {
        const g = layerOf(e.from) + 1;
        laneFrom = gapStart(g) + m.track * (f.exitTrack + 1);
        points.push([a.m + a.sm, port(i, 'from')], [laneFrom, port(i, 'from')]);
      }
      let laneTo: number;
      const tail: MC[] = [];
      if (f.sideEntry) {
        laneTo = port(i, 'to');
        tail.push([laneTo, f.side === 1 ? b.c + b.sc : b.c]);
      } else {
        const g = layerOf(e.to);
        laneTo = gapEnd(g) - m.track * (f.entryTrack + 1);
        tail.push([laneTo, port(i, 'to')], [b.m, port(i, 'to')]);
      }
      points.push([laneFrom, lane], [laneTo, lane], ...tail);
      return { kind: 'ortho', points, label: labelled ? [(laneFrom + laneTo) / 2, lane] : null, lane: [[laneFrom, lane], [laneTo, lane]] };
    }
    if (k === 'self') {
      const a = box(e.from);
      const face = a.c + a.sc;
      const mid = a.m + a.sm / 2;
      const reach = Math.min(a.sm * 0.28, m.port);
      const far = face + m.loop * 1.3;
      const points: MC[] = [[mid - reach, face], [mid - reach * 2.2, far], [mid + reach * 2.2, far], [mid + reach, face]];
      return { kind: 'curve', points, label: labelled ? [mid, face + m.loop + (down ? e.labelW : e.labelH) / 2] : null };
    }
    return null;
  });

  // To x and y, with the low-side lanes making room on the left (or on top).
  const shift = routing.low;
  const xy = (p: MC): Pt => (down ? { x: p[1] + shift, y: p[0] } : { x: p[0], y: p[1] + shift });
  const nodes: Rect[] = boxes.map((b) => (down ? { x: b.c + shift, y: b.m, w: b.sc, h: b.sm } : { x: b.m, y: b.c + shift, w: b.sm, h: b.sc }));
  const routes: (Route | null)[] = raw.map((r) => {
    if (!r) return null;
    const route: Route = { kind: r.kind, points: r.points.map(xy), label: r.label ? xy(r.label) : null };
    if (r.lane) route.lane = [xy(r.lane[0]), xy(r.lane[1])];
    return route;
  });
  const crossSize = routing.low + extent + routing.high;
  const placed: Placed = down ? { width: crossSize, height: mainSize, nodes, routes } : { width: mainSize, height: crossSize, nodes, routes };
  settleLabels(placed, edges, true);
  return frame(placed, edges);
}

// ---------------------------------------------------------------------------------------------
// Ring
// ---------------------------------------------------------------------------------------------

export function cubicAt(p: readonly Pt[], t: number): Pt {
  const [a, b, c, d] = p as [Pt, Pt, Pt, Pt];
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return { x: w0 * a.x + w1 * b.x + w2 * c.x + w3 * d.x, y: w0 * a.y + w1 * b.y + w2 * c.y + w3 * d.y };
}

const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (p: Pt, r: Rect): boolean => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
const centreOf = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const around = (c: Pt, w: number, h: number): Rect => ({ x: c.x - w / 2, y: c.y - h / 2, w, h });

/** Where the ray from the centre of a box towards `target` leaves the box. */
function exitPoint(r: Rect, target: Pt): Pt {
  const c = centreOf(r);
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  if (dx === 0 && dy === 0) return { x: c.x, y: r.y };
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : r.w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : r.h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/** A curve from one box to another that bends through `control`. */
function bowed(a: Rect, b: Rect, control: Pt): Pt[] {
  const p0 = exitPoint(a, control);
  const p3 = exitPoint(b, control);
  return [p0, { x: p0.x + ((control.x - p0.x) * 2) / 3, y: p0.y + ((control.y - p0.y) * 2) / 3 }, { x: p3.x + ((control.x - p3.x) * 2) / 3, y: p3.y + ((control.y - p3.y) * 2) / 3 }, p3];
}

/** The most points any one route is walked in. A route is a few hundred pixels long; this is the stop beyond that. */
const WALK_LIMIT = 1024;

/**
 * Points along a route about `spacing` pixels apart, both ends included. The number of points is
 * settled, as a whole number with a ceiling, before the first is made.
 */
function walk(route: Route, spacing: number): Pt[] {
  const count = (length: number): number => {
    const steps = Math.ceil(length / spacing);
    return Number.isFinite(steps) ? Math.min(WALK_LIMIT, Math.max(1, steps)) : 1;
  };
  const out: Pt[] = [];
  if (route.kind === 'curve' && route.points.length === 4) {
    const [a, b, c, d] = route.points as [Pt, Pt, Pt, Pt];
    // A curve is no longer than the three straight lines through its control points.
    const steps = count(Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y) + Math.hypot(d.x - c.x, d.y - c.y));
    for (let k = 0; k <= steps; k++) out.push(cubicAt(route.points, k / steps));
    return out;
  }
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1] as Pt;
    const b = route.points[i] as Pt;
    const steps = count(Math.hypot(b.x - a.x, b.y - a.y));
    for (let k = 0; k <= steps; k++) out.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
  }
  return out;
}

/**
 * The first node that one of `points` lies in, keeping `margin` clear around every node but the two
 * the route joins. Or -1. The route touches its own two nodes, at their borders; it may not go
 * inside them either.
 */
function entered(points: readonly Pt[], e: Edge, nodes: readonly Rect[], margin: number): number {
  for (const p of points) {
    for (let v = 0; v < nodes.length; v++) {
      const r = nodes[v] as Rect;
      const by = v === e.from || v === e.to ? -1 : margin;
      if (p.x > r.x - by && p.x < r.x + r.w + by && p.y > r.y - by && p.y < r.y + r.h + by) return v;
    }
  }
  return -1;
}

/** Whether a route keeps out of every node, walked closely enough that clipping a corner counts. */
const clearOf = (route: Route, e: Edge, nodes: readonly Rect[]): boolean => entered(walk(route, 2), e, nodes, 0) === -1;

/** A loop from a node back to itself, standing out from its left (-1) or right (1) side. */
function loopRoute(a: Rect, out: -1 | 1, e: EdgeInput, m: Metrics): Route {
  const c = centreOf(a);
  const face = out === 1 ? a.x + a.w : a.x;
  const reach = Math.min(a.h * 0.28, m.port);
  const far = face + out * m.loop * 1.3;
  const points = [{ x: face, y: c.y - reach }, { x: far, y: c.y - reach * 2.2 }, { x: far, y: c.y + reach * 2.2 }, { x: face, y: c.y + reach }];
  return { kind: 'curve', points, label: e.labelW > 0 ? { x: face + out * (m.loop + e.labelW / 2), y: c.y } : null };
}

/** Clear space a connection across a round ring is given past the boxes it does not join: comfortable, and if that cannot be had, just enough. */
const BERTHS = [6, 2];

/**
 * Routes for a ring set out round an ellipse: each connection a curve between its two boxes, bent
 * to one side or the other until it passes clear of every other box. Null when some connection has
 * no such curve.
 */
function ringRoutes(nodes: readonly Rect[], edges: readonly EdgeInput[], m: Metrics, adjacentBow: number): (Route | null)[] | null {
  const n = nodes.length;
  const middle = centreOf(bounds(nodes));
  const pairs = new Set(edges.filter((e) => valid(e, n)).map((e) => `${e.from}>${e.to}`));
  const routes: (Route | null)[] = [];
  for (const e of edges) {
    if (!valid(e, n)) {
      routes.push(null);
      continue;
    }
    const a = nodes[e.from] as Rect;
    const labelled = e.labelW > 0;
    if (e.from === e.to) {
      // A loop on the side of the node that faces away from the middle of the ring.
      const loop = loopRoute(a, centreOf(a).x >= middle.x ? 1 : -1, e, m);
      if (!clearOf(loop, e, nodes)) return null;
      routes.push(loop);
      continue;
    }
    const b = nodes[e.to] as Rect;
    // Measured between the two boxes, not between their centres: with boxes of different sizes the
    // middle of the gap is not the middle of the centres, and the label belongs in the gap.
    const ca = exitPoint(a, centreOf(b));
    const cb = exitPoint(b, centreOf(a));
    const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
    const between = Math.hypot(cb.x - ca.x, cb.y - ca.y);
    const dist = Math.max(between, 24);
    const along = between > 0 ? { x: (cb.x - ca.x) / between, y: (cb.y - ca.y) / between } : { x: 1, y: 0 };
    // Unit vector to the left of the direction of travel, and whether that points away from the middle.
    const left = { x: along.y, y: -along.x };
    const outward = left.x * (mid.x - middle.x) + left.y * (mid.y - middle.y) >= 0 ? 1 : -1;
    const step = Math.abs(e.to - e.from);
    const adjacent = step === 1 || step === n - 1;
    // Two edges between the same pair in opposite directions each bend to their own left, so they part.
    const first = pairs.has(`${e.to}>${e.from}`) ? 0.24 : adjacent ? adjacentBow * outward : 0;
    // Then towards the middle of the ring, where there is most room, and away from it, each a little further.
    const bows = [first, ...[1, 2, 3, 4, 5, 6].flatMap((k) => [-outward * k * 0.3, outward * k * 0.3])];
    const curves = bows.map((bow) => {
      const route: Route = { kind: 'curve', points: bowed(a, b, { x: mid.x + left.x * dist * bow, y: mid.y + left.y * dist * bow }), label: null };
      return { route, walked: walk(route, 2) };
    });
    let found: Route | null = null;
    for (const berth of BERTHS) {
      found = curves.find((c) => entered(c.walked, e, nodes, berth) === -1)?.route ?? null;
      if (found) break;
    }
    // Drawn straight through the boxes in its way, the connection would look like several others. Better no ring.
    if (!found) return null;
    if (labelled) found.label = cubicAt(found.points, 0.5);
    routes.push(found);
  }
  return routes;
}

function bounds(rects: readonly Rect[]): Rect {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return rects.length === 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** How many heights of ellipse are looked at before giving up on a round ring, and for how many of them the connections are routed. */
const ELLIPSE_TRIES = 200;
const ELLIPSE_ROUTINGS = 5;

/**
 * Nodes on an ellipse, first node at the top, going clockwise. The ellipse is made as tall as it
 * must be for no two nodes to touch, for every labelled step round the ring to have room for its
 * label, and for every connection across the ring to pass clear of the nodes it does not join.
 * Returns null when no ellipse of a sensible shape does that within `avail`; `placeRingTrack` then
 * applies.
 */
export function placeRingEllipse(sizes: readonly Size[], edges: readonly EdgeInput[], avail: number, m: Metrics): Placed | null {
  const n = sizes.length;
  if (n < 3) return null;
  const w = Math.max(...sizes.map((s) => s.w));
  const h = Math.max(...sizes.map((s) => s.h));
  const rx = (avail - w) / 2 - m.labelPad;
  if (!(rx >= w * 0.45)) return null;
  const labelBetween = new Map<string, EdgeInput>();
  for (const e of edges) {
    if (!valid(e, n) || e.labelW <= 0) continue;
    const step = Math.abs(e.to - e.from);
    if (step === 1 || step === n - 1) labelBetween.set(`${Math.min(e.from, e.to)}:${Math.max(e.from, e.to)}`, e);
  }
  const at = (ry: number): Rect[] =>
    sizes.map((s, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
      return around({ x: rx * Math.cos(angle), y: ry * Math.sin(angle) }, s.w, s.h);
    });
  const fits = (nodes: readonly Rect[]): boolean => {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const neighbours = j - i === 1 || j - i === n - 1;
        // Neighbours on the ring need room between them for an arrow.
        if (overlap(inflate(nodes[i] as Rect, neighbours ? m.arrow * 1.4 : m.nodeGap / 2), inflate(nodes[j] as Rect, neighbours ? m.arrow * 1.4 : m.nodeGap / 2))) return false;
        const e = labelBetween.get(`${i}:${j}`);
        if (e) {
          const a = exitPoint(nodes[i] as Rect, centreOf(nodes[j] as Rect));
          const b = exitPoint(nodes[j] as Rect, centreOf(nodes[i] as Rect));
          const chip = around({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, e.labelW + m.labelPad, e.labelH + m.labelPad);
          if (overlap(chip, nodes[i] as Rect) || overlap(chip, nodes[j] as Rect)) return false;
        }
      }
    }
    return true;
  };
  const lowest = Math.max(rx * 0.62, h * 1.3);
  const highest = Math.max(rx * 1.5, h * 4);
  if (!Number.isFinite(lowest) || !Number.isFinite(highest)) return null;
  // Counted, not stepped until a bound is passed: a height that adding six to does not change would never pass it.
  const tries = Math.min(ELLIPSE_TRIES, Math.floor((highest - lowest) / 6));
  let routings = 0;
  for (let k = 0; k <= tries && routings < ELLIPSE_ROUTINGS; k++) {
    const nodes = at(lowest + k * 6);
    if (!fits(nodes)) continue;
    routings++;
    const routes = ringRoutes(nodes, edges, m, 0.1);
    if (!routes) {
      // A connection across the ring found no way through. A taller ring has more room inside; a little taller hardly differs.
      k += 3;
      continue;
    }
    const placed: Placed = { width: 0, height: 0, nodes, routes };
    settleLabels(placed, edges);
    const framed = frame(placed, edges);
    // A taller ellipse is no narrower, so a ring that spills over the side at this height spills at every height.
    return framed.width <= avail + 0.5 ? framed : null;
  }
  return null;
}

// The ring as two columns: across the top, down the right-hand column, back across the bottom and
// up the left. It is what a ring becomes when there is no room for a round one.
//
// Round the ring every connection is short and straight: between two nodes of one column that
// stand next to each other, or across the gap from one column to the other. A connection that is
// not part of the ring is one of two kinds. From one column to the other, it is a curve that stays
// inside the gap between the columns, where there are no nodes. Between two nodes of the same
// column, the nodes between them are in the way, so it leaves by the outer side of its column and
// runs in a lane of its own outside, as a long connection does in the layered layout.

type TrackFace = 'top' | 'bottom' | 'inner' | 'outer';
type TrackKind = 'none' | 'self' | 'step' | 'cross' | 'lane';

interface TrackPlan {
  rows: number;
  /** Column 0 is the left, column 1 the right. */
  slot: { col: 0 | 1; row: number }[];
  kind: TrackKind[];
  /** For a connection that runs outside its column: which lane, counted outwards from the column. */
  lane: Map<number, number>;
  /** Lane widths outside each column, innermost first. */
  lanes: [number[], number[]];
  /** Room needed outside each column, for its lanes and loops. */
  outer: [number, number];
  /** The least the gap between the columns may be. */
  gap: number;
}

function planTrack(n: number, edges: readonly EdgeInput[], m: Metrics): TrackPlan {
  const rows = Math.ceil(n / 2);
  const slot: TrackPlan['slot'] = Array.from({ length: n }, (_, i) => (i === 0 ? { col: 0, row: 0 } : i <= rows ? { col: 1, row: i - 1 } : { col: 0, row: n - i }));
  const at = (v: number): { col: 0 | 1; row: number } => slot[v] as { col: 0 | 1; row: number };
  const kind: TrackKind[] = edges.map((e) => {
    if (!valid(e, n)) return 'none';
    if (e.from === e.to) return 'self';
    if (at(e.from).col !== at(e.to).col) return 'cross';
    return Math.abs(at(e.from).row - at(e.to).row) === 1 ? 'step' : 'lane';
  });

  // Lanes: short spans innermost, and two connections share a lane when their spans do not meet.
  const span = (i: number): [number, number] => {
    const e = edges[i] as EdgeInput;
    return [Math.min(at(e.from).row, at(e.to).row), Math.max(at(e.from).row, at(e.to).row)];
  };
  const lane = new Map<number, number>();
  const lanes: [number[], number[]] = [[], []];
  for (const col of [0, 1] as const) {
    const taken: [number, number][][] = [];
    const list = edges.map((_, i) => i).filter((i) => kind[i] === 'lane' && at((edges[i] as EdgeInput).from).col === col);
    list.sort((a, b) => span(a)[1] - span(a)[0] - (span(b)[1] - span(b)[0]) || span(a)[0] - span(b)[0] || a - b);
    for (const i of list) {
      const [lo, hi] = span(i);
      let index = taken.findIndex((spans) => spans.every(([a, b]) => hi < a || b < lo));
      if (index === -1) {
        index = taken.length;
        taken.push([]);
        lanes[col].push(m.lane);
      }
      (taken[index] as [number, number][]).push([lo, hi]);
      const labelW = (edges[i] as EdgeInput).labelW;
      if (labelW > 0) lanes[col][index] = Math.max(lanes[col][index] as number, labelW + m.labelPad);
      lane.set(i, index);
    }
  }
  const outer: [number, number] = [0, 0];
  for (const col of [0, 1] as const) {
    let loop = 0;
    edges.forEach((e, i) => {
      if (kind[i] === 'self' && at(e.from).col === col) loop = Math.max(loop, m.loop * 1.3 + m.labelPad, e.labelW > 0 ? m.loop + e.labelW + m.labelPad : 0);
    });
    outer[col] = Math.max(lanes[col].length > 0 ? sum(lanes[col]) + m.labelPad : 0, loop);
  }
  const across = Math.max(0, ...edges.map((e, i) => (kind[i] === 'cross' ? e.labelW : 0)));
  return { rows, slot, kind, lane, lanes, outer, gap: Math.max(m.layerGap, across > 0 ? across + 2 * m.arrow + m.labelPad : 0) };
}

/**
 * How much of the width a two-column ring needs for everything that is not a node: the gap between
 * the columns and the lanes outside them. The caller takes it off the width it has and gives each
 * column half of what is left.
 */
export function ringTrackRoom(n: number, edges: readonly EdgeInput[], m: Metrics): number {
  const plan = planTrack(n, edges, m);
  return plan.gap + plan.outer[0] + plan.outer[1];
}

/**
 * The ring as two columns. Null when it cannot be drawn in `avail` with every connection clear of
 * the nodes it does not join; the caller then draws the cycle in layers, as a chain that loops back.
 */
export function placeRingTrack(sizes: readonly Size[], edges: readonly EdgeInput[], avail: number, m: Metrics): Placed | null {
  const n = sizes.length;
  const plan = planTrack(n, edges, m);
  const { rows } = plan;
  const at = (v: number): { col: 0 | 1; row: number } => plan.slot[v] as { col: 0 | 1; row: number };
  const w = Math.max(0, ...sizes.map((s) => s.w));
  const labelH = Math.max(0, ...edges.map((e) => e.labelH));
  const colGap = Math.max(plan.gap, Math.min(avail - 2 * w - plan.outer[0] - plan.outer[1], m.layerGap * 3.2));
  const rowGap = Math.max(m.layerGap, labelH > 0 ? labelH + 2 * m.arrow + m.labelPad : 0);
  const rowSize = new Array<number>(rows).fill(0);
  sizes.forEach((s, i) => {
    const r = at(i).row;
    rowSize[r] = Math.max(rowSize[r] as number, s.h);
  });
  const rowStart: number[] = [];
  let y = 0;
  for (let r = 0; r < rows; r++) {
    rowStart.push(y);
    y += (rowSize[r] as number) + rowGap;
  }
  // Each column is set against the gap, so the sides that face each other line up whatever the widths.
  const nodes: Rect[] = sizes.map((s, i) => {
    const { col, row } = at(i);
    return { x: col === 0 ? w - s.w : w + colGap, y: (rowStart[row] as number) + ((rowSize[row] as number) - s.h) / 2, w: s.w, h: s.h };
  });
  const node = (v: number): Rect => nodes[v] as Rect;

  // Ports: where each connection meets each node, spread along the side they share.
  const faceOf = (i: number, end: 'from' | 'to'): TrackFace => {
    const e = edges[i] as EdgeInput;
    const k = plan.kind[i];
    if (k === 'cross') return 'inner';
    if (k === 'lane') return 'outer';
    const here = end === 'from' ? e.from : e.to;
    const there = end === 'from' ? e.to : e.from;
    return at(here).row < at(there).row ? 'bottom' : 'top';
  };
  const attached = new Map<string, { edge: number; end: 'from' | 'to'; key: number }[]>();
  edges.forEach((e, i) => {
    const k = plan.kind[i];
    if (k !== 'step' && k !== 'cross' && k !== 'lane') return;
    for (const end of ['from', 'to'] as const) {
      const here = end === 'from' ? e.from : e.to;
      const there = end === 'from' ? e.to : e.from;
      const face = faceOf(i, end);
      // Across the gap, in the order of the far ends, so two curves from one side do not cross. On a
      // lane, upward connections above downward ones, and nearer lanes outermost of each group, so
      // no connection crosses another on its way out. Elsewhere the connections run side by side.
      const up = at(there).row < at(here).row;
      const key = face === 'inner' ? centreOf(node(there)).y : face === 'outer' ? (up ? -1 : 1) * (1000 - (plan.lane.get(i) ?? 0)) : 0;
      const id = `${here}:${face}`;
      const list = attached.get(id);
      if (list) list.push({ edge: i, end, key });
      else attached.set(id, [{ edge: i, end, key }]);
    }
  });
  const ports = new Map<string, number>();
  for (const [id, list] of attached) {
    const [vText, face] = id.split(':') as [string, TrackFace];
    const r = node(Number(vText));
    const flat = face === 'top' || face === 'bottom';
    const length = flat ? r.w : r.h;
    list.sort((a, b) => a.key - b.key || a.edge - b.edge);
    const step = Math.min(m.port, (length * 0.7) / list.length);
    list.forEach((a, i) => ports.set(`${a.edge}:${a.end}`, (flat ? r.x : r.y) + length / 2 + (i - (list.length - 1) / 2) * step));
  }
  const port = (edge: number, end: 'from' | 'to'): number => ports.get(`${edge}:${end}`) as number;
  const innerX = (v: number): number => (at(v).col === 0 ? node(v).x + node(v).w : node(v).x);
  const outerX = (v: number): number => (at(v).col === 0 ? node(v).x : node(v).x + node(v).w);

  const routes: (Route | null)[] = edges.map((e, i) => {
    const k = plan.kind[i];
    const labelled = e.labelW > 0;
    if (k === 'none' || k === undefined) return null;
    if (k === 'self') return loopRoute(node(e.from), at(e.from).col === 0 ? -1 : 1, e, m);
    if (k === 'step') {
      const down = at(e.from).row < at(e.to).row;
      const p0 = { x: port(i, 'from'), y: down ? node(e.from).y + node(e.from).h : node(e.from).y };
      const p3 = { x: port(i, 'to'), y: down ? node(e.to).y : node(e.to).y + node(e.to).h };
      const pull = (p3.y - p0.y) / 2;
      const points = [p0, { x: p0.x, y: p0.y + pull }, { x: p3.x, y: p3.y - pull }, p3];
      return { kind: 'curve', points, label: labelled ? cubicAt(points, 0.5) : null };
    }
    if (k === 'cross') {
      const p0 = { x: innerX(e.from), y: port(i, 'from') };
      const p3 = { x: innerX(e.to), y: port(i, 'to') };
      // Pulled level at both ends, so the curve never leaves the gap between the columns.
      const pull = (p3.x - p0.x) / 2;
      const points = [p0, { x: p0.x + pull, y: p0.y }, { x: p3.x - pull, y: p3.y }, p3];
      return { kind: 'curve', points, label: labelled ? cubicAt(points, 0.5) : null };
    }
    const col = at(e.from).col;
    const widths = plan.lanes[col];
    const index = plan.lane.get(i) ?? 0;
    const out = sum(widths.slice(0, index)) + (widths[index] as number) / 2 + m.labelPad / 2;
    const x = col === 0 ? -out : 2 * w + colGap + out;
    const from = { x, y: port(i, 'from') };
    const to = { x, y: port(i, 'to') };
    return { kind: 'ortho', points: [{ x: outerX(e.from), y: from.y }, from, to, { x: outerX(e.to), y: to.y }], label: labelled ? { x, y: (from.y + to.y) / 2 } : null, lane: [from, to] };
  });
  // Checked, not assumed: with boxes of the sizes given, is every route clear of every box?
  for (const [i, route] of routes.entries()) if (route && !clearOf(route, edges[i] as EdgeInput, nodes)) return null;

  const placed: Placed = { width: 0, height: 0, nodes, routes };
  settleLabels(placed, edges);
  const framed = frame(placed, edges);
  return framed.width <= avail + 0.5 ? framed : null;
}

// ---------------------------------------------------------------------------------------------
// Labels and the final frame
// ---------------------------------------------------------------------------------------------

/** Points along a route, close enough together that a label lying across the route contains one. */
function samples(route: Route): Pt[] {
  const out: Pt[] = [];
  if (route.kind === 'curve') {
    for (let k = 0; k <= 16; k++) out.push(cubicAt(route.points, k / 16));
    return out;
  }
  return walk(route, 8);
}

/**
 * Find each label a place: on its connector if it can sit there without covering a node, another
 * label or another connector, otherwise just beside it. A label that fits nowhere stays where it
 * was first put, on the middle of its connector.
 */
function settleLabels(placed: Placed, edges: readonly EdgeInput[], keepInside = false): void {
  const taken: Rect[] = [];
  // In a layered drawing the width was promised to the caller, so no label may hang over the edge.
  const within = (c: Pt, e: EdgeInput): boolean => !keepInside || (c.x - e.labelW / 2 >= 0 && c.x + e.labelW / 2 <= placed.width && c.y - e.labelH / 2 >= 0 && c.y + e.labelH / 2 <= placed.height);
  const pulledIn = (c: Pt, e: EdgeInput): Pt =>
    keepInside ? { x: Math.min(Math.max(c.x, e.labelW / 2), Math.max(e.labelW / 2, placed.width - e.labelW / 2)), y: Math.min(Math.max(c.y, e.labelH / 2), Math.max(e.labelH / 2, placed.height - e.labelH / 2)) } : c;
  const lines = placed.routes.map((route) => (route ? samples(route) : []));
  placed.routes.forEach((route, i) => {
    const e = edges[i] as EdgeInput;
    if (!route || !route.label) return;
    const on: Pt[] = [route.label];
    if (route.kind === 'curve') for (const t of [0.4, 0.6, 0.3, 0.7]) on.push(cubicAt(route.points, t));
    else if (route.lane) {
      const [a, b] = route.lane;
      for (const t of [0.35, 0.65, 0.2, 0.8]) on.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    // Beside the connector: clear of it on either side, or just above or below.
    const beside: Pt[] = [];
    for (const c of on.slice(0, 3)) {
      const dx = e.labelW / 2 + 7;
      const dy = e.labelH / 2 + 5;
      beside.push({ x: c.x - dx, y: c.y }, { x: c.x + dx, y: c.y }, { x: c.x, y: c.y - dy }, { x: c.x, y: c.y + dy });
    }
    const clearOfBoxes = (c: Pt): boolean => {
      const chip = around(c, e.labelW + 4, e.labelH + 4);
      return within(c, e) && !placed.nodes.some((r) => overlap(chip, r)) && !taken.some((r) => overlap(chip, r));
    };
    const clearOfLines = (c: Pt): boolean => {
      const chip = around(c, e.labelW + 2, e.labelH + 2);
      return !lines.some((points, j) => j !== i && points.some((p) => inside(p, chip)));
    };
    const chosen = on.find((c) => clearOfBoxes(c) && clearOfLines(c)) ?? beside.find((c) => clearOfBoxes(c) && clearOfLines(c)) ?? on.find(clearOfBoxes) ?? pulledIn(route.label, e);
    route.label = chosen;
    taken.push(around(chosen, e.labelW, e.labelH));
  });
}

/** Move everything so the drawing starts at the origin, and measure it, labels and curves included. */
function frame(placed: Placed, edges: readonly EdgeInput[]): Placed {
  const rects: Rect[] = [...placed.nodes];
  placed.routes.forEach((route, i) => {
    if (!route) return;
    const e = edges[i] as EdgeInput;
    if (route.label) rects.push(around(route.label, e.labelW, e.labelH));
    if (route.kind === 'curve') for (let k = 0; k <= 8; k++) rects.push(around(cubicAt(route.points, k / 8), 2, 2));
    else for (const p of route.points) rects.push(around(p, 2, 2));
  });
  const b = bounds(rects);
  const dx = -b.x;
  const dy = -b.y;
  const move = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  return {
    width: b.w,
    height: b.h,
    nodes: placed.nodes.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })),
    routes: placed.routes.map((route) => {
      if (!route) return null;
      const moved: Route = { kind: route.kind, points: route.points.map(move), label: route.label ? move(route.label) : null };
      if (route.lane) moved.lane = [move(route.lane[0]), move(route.lane[1])];
      return moved;
    }),
  };
}
