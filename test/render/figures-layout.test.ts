// The geometry behind a drawn figure, tested without a browser: layering, routing and placement of
// a flow (src/player/figures/graph.ts) and the axis arithmetic of a chart (scale.ts). The claims
// are the ones a reader would notice if they failed: no node on top of another, every connector
// ends on the nodes it joins, no connector runs through a node, and the drawing fits its column.
import { describe, expect, it } from 'vitest';
import type { FigureInput } from '../../src/core/types';
import {
  type Edge,
  type EdgeInput,
  type Metrics,
  type Placed,
  type Pt,
  type Rect,
  type Size,
  assignLayers,
  backEdges,
  cubicAt,
  placeLayered,
  placeRingEllipse,
  placeRingTrack,
  planLayered,
} from '../../src/player/figures/graph';
import { niceScale, thin } from '../../src/player/figures/scale';
import { ALL_FIGURES } from './figures-fixtures';

/** The distances the player derives from a 15px font. */
const M: Metrics = { nodeGap: 22.5, layerGap: 37.5, lane: 16.5, labelPad: 8, arrow: 10, track: 12.75, port: 16.5, loop: 22.5 };
const MIN_NODE = 102;
const MAX_NODE = 202;

/** A deterministic stream of numbers in [0, 1), so a failing case can be found again by its seed. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const overlap = (a: Rect, b: Rect, slack = 0.01): boolean => a.x < b.x + b.w - slack && b.x < a.x + a.w - slack && a.y < b.y + b.h - slack && b.y < a.y + a.h - slack;
const onBorder = (p: Pt, r: Rect, slack = 0.6): boolean => {
  const within = p.x >= r.x - slack && p.x <= r.x + r.w + slack && p.y >= r.y - slack && p.y <= r.y + r.h + slack;
  const edge = Math.min(Math.abs(p.x - r.x), Math.abs(p.x - (r.x + r.w)), Math.abs(p.y - r.y), Math.abs(p.y - (r.y + r.h)));
  return within && edge <= slack;
};
const strictlyInside = (p: Pt, r: Rect, margin = 1): boolean => p.x > r.x + margin && p.x < r.x + r.w - margin && p.y > r.y + margin && p.y < r.y + r.h - margin;

/** Points along a route, dense enough that a route through a node has a point inside it. */
function trace(route: NonNullable<Placed['routes'][number]>): Pt[] {
  const out: Pt[] = [];
  if (route.kind === 'curve') {
    // A curve can clip the corner of a box by a few pixels: forty points along it were not enough to see that.
    for (let k = 0; k <= 240; k++) out.push(cubicAt(route.points, k / 240));
    return out;
  }
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1] as Pt;
    const b = route.points[i] as Pt;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
    for (let k = 0; k <= steps; k++) out.push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
  }
  return out;
}

interface Problem {
  what: string;
}

/** Everything wrong with a placement, in words. Empty when it is sound. */
function problems(placed: Placed, edges: readonly Edge[], opts: { labels?: readonly EdgeInput[] } = {}): Problem[] {
  const out: Problem[] = [];
  const say = (what: string): void => void out.push({ what });
  if (!(Number.isFinite(placed.width) && Number.isFinite(placed.height) && placed.width >= 0 && placed.height >= 0)) say(`size ${placed.width}x${placed.height}`);
  placed.nodes.forEach((r, i) => {
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite)) say(`node ${i} is not finite`);
    if (r.x < -0.5 || r.y < -0.5 || r.x + r.w > placed.width + 0.5 || r.y + r.h > placed.height + 0.5) say(`node ${i} lies outside the drawing`);
    for (let j = i + 1; j < placed.nodes.length; j++) if (overlap(r, placed.nodes[j] as Rect)) say(`nodes ${i} and ${j} overlap`);
  });
  placed.routes.forEach((route, i) => {
    const e = edges[i] as Edge;
    const real = e.from >= 0 && e.to >= 0 && e.from < placed.nodes.length && e.to < placed.nodes.length;
    if (!real) {
      if (route) say(`edge ${i} has no ends but was routed`);
      return;
    }
    if (!route) return void say(`edge ${i} was not routed`);
    const first = route.points[0] as Pt;
    const last = route.points[route.points.length - 1] as Pt;
    if (!onBorder(first, placed.nodes[e.from] as Rect)) say(`edge ${i} does not start on node ${e.from}`);
    if (!onBorder(last, placed.nodes[e.to] as Rect)) say(`edge ${i} does not end on node ${e.to}`);
    for (const p of trace(route)) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return void say(`edge ${i} is not finite`);
      if (p.x < -1 || p.y < -1 || p.x > placed.width + 1 || p.y > placed.height + 1) return void say(`edge ${i} leaves the drawing`);
      const through = placed.nodes.findIndex((r) => strictlyInside(p, r));
      if (through !== -1) return void say(`edge ${i} runs through node ${through}`);
    }
    const label = opts.labels?.[i];
    if (label && label.labelW > 0) {
      if (!route.label) return void say(`edge ${i} lost its label`);
      const chip: Rect = { x: route.label.x - label.labelW / 2, y: route.label.y - label.labelH / 2, w: label.labelW, h: label.labelH };
      if (chip.x < -0.5 || chip.y < -0.5 || chip.x + chip.w > placed.width + 0.5 || chip.y + chip.h > placed.height + 0.5) say(`label ${i} lies outside the drawing`);
    }
  });
  return out;
}

/** A flow figure as the numbers the layout takes: node boxes of a plausible size, and label sizes from label lengths. */
function fromFigure(figure: FigureInput, nodeWidth: number): { sizes: Size[]; edges: EdgeInput[] } {
  if (figure.type !== 'flow') throw new Error('not a flow');
  const index = new Map(figure.nodes.map((n, i) => [n.id, i]));
  const sizes = figure.nodes.map((n) => ({ w: nodeWidth, h: 38 + Math.ceil((n.label.length * 8.5) / (nodeWidth - 20)) * 19 + (n.detail ? Math.ceil((n.detail.length * 7) / (nodeWidth - 20)) * 17 : 0) }));
  const edges = figure.edges.map((e) => ({ from: index.get(e.from) ?? -1, to: index.get(e.to) ?? -1, labelW: e.label ? Math.min(98, e.label.length * 7 + 10) : 0, labelH: e.label ? (e.label.length * 7 + 10 > 98 ? 34 : 18) : 0, turnedW: e.label ? 18 : 0 }));
  return { sizes, edges };
}

describe('the checker used below', () => {
  it('notices each kind of fault it is there to find', () => {
    const nodes: Rect[] = [{ x: 0, y: 0, w: 100, h: 40 }, { x: 0, y: 100, w: 100, h: 40 }, { x: 0, y: 200, w: 100, h: 40 }];
    const straight = (from: Pt, to: Pt): Placed['routes'][number] => ({ kind: 'ortho', points: [from, to], label: null });
    const sound: Placed = { width: 100, height: 240, nodes, routes: [straight({ x: 50, y: 40 }, { x: 50, y: 100 })] };
    expect(problems(sound, [{ from: 0, to: 1 }])).toEqual([]);
    const what = (placed: Placed, edges: Edge[]): string[] => problems(placed, edges).map((p) => p.what);
    expect(what({ ...sound, nodes: [nodes[0] as Rect, { x: 50, y: 20, w: 100, h: 40 }, nodes[2] as Rect] }, [{ from: 0, to: 1 }])).toContain('nodes 0 and 1 overlap');
    expect(what({ ...sound, routes: [straight({ x: 50, y: 20 }, { x: 50, y: 100 })] }, [{ from: 0, to: 1 }])).toContain('edge 0 does not start on node 0');
    expect(what({ ...sound, routes: [straight({ x: 50, y: 40 }, { x: 50, y: 90 })] }, [{ from: 0, to: 1 }])).toContain('edge 0 does not end on node 1');
    // From the first node straight down to the third, through the second.
    expect(what({ ...sound, routes: [straight({ x: 50, y: 40 }, { x: 50, y: 200 })] }, [{ from: 0, to: 2 }])).toContain('edge 0 runs through node 1');
    expect(what({ ...sound, routes: [null] }, [{ from: 0, to: 1 }])).toContain('edge 0 was not routed');
    expect(what({ ...sound, width: 80 }, [{ from: 0, to: 1 }])).toContain('node 0 lies outside the drawing');
  });
});

describe('cycles and layers', () => {
  const chain: Edge[] = [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }];

  it('finds the edge that closes a cycle and no other', () => {
    expect(backEdges(4, [...chain, { from: 3, to: 1 }])).toEqual([false, false, false, true]);
    expect(backEdges(4, chain)).toEqual([false, false, false]);
    // A pure ring: the last edge back to where the author started.
    expect(backEdges(3, [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 0 }])).toEqual([false, false, true]);
    // A self-loop is not a cycle between layers, and an edge to nowhere is ignored.
    expect(backEdges(2, [{ from: 0, to: 0 }, { from: 0, to: 9 }, { from: 0, to: 1 }])).toEqual([false, false, false]);
  });

  it('puts a chain in one layer per node, in order', () => {
    const l = assignLayers(4, chain);
    expect(l.layerOf).toEqual([0, 1, 2, 3]);
    expect(l.layers).toEqual([[0], [1], [2], [3]]);
  });

  it('puts the two arms of a branch side by side and the join below both', () => {
    const l = assignLayers(4, [{ from: 0, to: 1 }, { from: 0, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 3 }]);
    expect(l.layerOf).toEqual([0, 1, 1, 2]);
    expect(l.layers[1]).toHaveLength(2);
  });

  it('lays a cycle out as a chain, with the closing edge pointing back up', () => {
    const edges = [...chain, { from: 3, to: 0 }];
    const l = assignLayers(4, edges);
    expect(l.layerOf).toEqual([0, 1, 2, 3]);
    expect(l.layerOf[3]).toBeGreaterThan(l.layerOf[0] as number);
  });

  it('never puts more nodes in a layer than the cap, and keeps every forward edge pointing down', () => {
    const star: Edge[] = [1, 2, 3, 4, 5, 6].map((to) => ({ from: 0, to }));
    for (const cap of [1, 2, 3, 6]) {
      const l = assignLayers(7, star, cap);
      expect(Math.max(...l.layers.map((x) => x.length))).toBeLessThanOrEqual(cap);
      for (const e of star) expect(l.layerOf[e.to]).toBeGreaterThan(l.layerOf[e.from] as number);
      expect(l.layers.flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });

  it('moves a late input down to just above what it feeds', () => {
    // 0 -> 1 -> 2 -> 3, and 4 feeds only 3.
    const l = assignLayers(5, [...chain, { from: 4, to: 3 }]);
    expect(l.layerOf[4]).toBe(2);
  });

  it('orders a layer to untangle crossings', () => {
    // Given in an order that crosses: 0 -> 3, 1 -> 2 with 2 listed before 3.
    const l = assignLayers(4, [{ from: 0, to: 3 }, { from: 1, to: 2 }]);
    expect(l.layers[0]).toEqual([0, 1]);
    expect(l.layers[1]).toEqual([3, 2]);
  });

  it('gives every node a layer whatever it is handed', () => {
    const l = assignLayers(3, [{ from: 0, to: 7 }, { from: -1, to: 1 }, { from: 2, to: 2 }]);
    expect(l.layerOf).toHaveLength(3);
    expect(l.layers.flat().sort()).toEqual([0, 1, 2]);
    expect(assignLayers(0, []).layers).toEqual([]);
  });
});

describe('the flow fixtures', () => {
  const flows = [...ALL_FIGURES].filter(([, f]) => f.type === 'flow');

  it.each(flows)('%s is sound at every width from a phone to a desk', (_name, figure) => {
    for (const avail of [234, 246, 300, 380, 474, 640, 824]) {
      const probe = fromFigure(figure, MIN_NODE);
      const plan = planLayered(probe.sizes.length, probe.edges, { avail, wanted: figure.type === 'flow' && figure.layout === 'right' ? 'right' : 'down', minNode: MIN_NODE, maxNode: MAX_NODE, metrics: M });
      const { sizes, edges } = fromFigure(figure, plan.nodeWidth);
      // A label on a lane is turned when the plan says so, which swaps its sides.
      const drawn = edges.map((e, i) => (plan.turned && plan.far[i] && e.labelW > 0 ? { ...e, labelW: 18, labelH: e.labelW } : e));
      const placed = placeLayered(sizes, drawn, plan.layering, plan.direction, M);
      expect(problems(placed, drawn, { labels: drawn }), `avail ${avail}`).toEqual([]);
      expect(placed.width, `avail ${avail}: fits`).toBeLessThanOrEqual(avail + 0.5);
    }
  });

  it('draws the twelve-node pipeline two abreast on a desk and in one column on a phone', () => {
    const figure = ALL_FIGURES.get('flow12') as FigureInput;
    const { edges } = fromFigure(figure, MIN_NODE);
    const wide = planLayered(12, edges, { avail: 474, wanted: 'down', minNode: MIN_NODE, maxNode: MAX_NODE, metrics: M });
    expect(Math.max(...wide.layering.layers.map((l) => l.length))).toBe(2);
    const narrow = planLayered(12, edges, { avail: 246, wanted: 'down', minNode: MIN_NODE, maxNode: MAX_NODE, metrics: M });
    expect(Math.max(...narrow.layering.layers.map((l) => l.length))).toBe(1);
    expect(narrow.turned).toBe(true);
    expect(narrow.nodeWidth).toBeGreaterThanOrEqual(MIN_NODE);
    // The two loops back to the start run in lanes, not through the pipeline.
    expect(wide.far.filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });

  it('keeps "right" only when the layers fit side by side', () => {
    const figure = ALL_FIGURES.get('flowRight') as FigureInput;
    const { edges } = fromFigure(figure, MIN_NODE);
    expect(planLayered(4, edges, { avail: 824, wanted: 'right', minNode: MIN_NODE, maxNode: MAX_NODE, metrics: M }).direction).toBe('right');
    expect(planLayered(4, edges, { avail: 246, wanted: 'right', minNode: MIN_NODE, maxNode: MAX_NODE, metrics: M }).direction).toBe('down');
  });
});

describe('any graph the format allows', () => {
  it('is laid out soundly: 400 random flows of up to 12 nodes and 16 edges, with cycles, self-loops and labels', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const next = random(seed);
      const n = 2 + Math.floor(next() * 11);
      const count = 1 + Math.floor(next() * 16);
      const edges: EdgeInput[] = Array.from({ length: count }, () => {
        const from = Math.floor(next() * n);
        // Mostly forward, some back, the odd self-loop.
        const to = next() < 0.06 ? from : Math.floor(next() * n);
        const labelled = next() < 0.4;
        return { from, to, labelW: labelled ? 24 + Math.floor(next() * 74) : 0, labelH: labelled ? (next() < 0.3 ? 34 : 18) : 0, turnedW: labelled ? 18 : 0 };
      });
      const avail = [240, 300, 474, 700][Math.floor(next() * 4)] as number;
      const wanted = next() < 0.3 ? 'right' : 'down';
      const plan = planLayered(n, edges, { avail, wanted, minNode: MIN_NODE, maxNode: MAX_NODE, metrics: M });
      const sizes: Size[] = Array.from({ length: n }, () => ({ w: plan.nodeWidth, h: 36 + Math.floor(next() * 5) * 19 }));
      const drawn = edges.map((e, i) => (plan.turned && plan.far[i] && e.labelW > 0 ? { ...e, labelW: 18, labelH: e.labelW } : e));
      const placed = placeLayered(sizes, drawn, plan.layering, plan.direction, M);
      const found = problems(placed, drawn, { labels: drawn });
      if (found.length > 0) failures.push(`seed ${seed} (${n} nodes, ${count} edges, ${plan.direction}, ${avail}px): ${found[0]?.what}`);
      // A layout the plan called a fit must be one.
      const abreast = Math.max(...plan.layering.layers.map((l) => l.length));
      if (plan.direction === 'down' && plan.nodeWidth >= MIN_NODE && abreast >= 1 && placed.width > avail + 0.5) failures.push(`seed ${seed}: planned to fit ${avail}px but is ${Math.round(placed.width)}px wide`);
    }
    expect(failures).toEqual([]);
  });

  it('gives the same drawing for the same input', () => {
    const { sizes, edges } = fromFigure(ALL_FIGURES.get('flow12') as FigureInput, 150);
    const once = (): Placed => {
      const plan = planLayered(12, edges, { avail: 474, wanted: 'down', minNode: MIN_NODE, maxNode: MAX_NODE, metrics: M });
      return placeLayered(sizes, edges, plan.layering, plan.direction, M);
    };
    expect(once()).toEqual(once());
  });
});

describe('ring', () => {
  const ringOf = (n: number, extra: Edge[] = []): EdgeInput[] => [...Array.from({ length: n }, (_, i) => ({ from: i, to: (i + 1) % n })), ...extra].map((e) => ({ ...e, labelW: 0, labelH: 0 }));
  const boxes = (n: number, w: number, h = 56): Size[] => Array.from({ length: n }, () => ({ w, h }));

  it('sets five nodes round an ellipse when there is room, first node at the top', () => {
    const placed = placeRingEllipse(boxes(5, 124), ringOf(5, [{ from: 2, to: 4 }]), 474, M) as Placed;
    expect(placed).not.toBeNull();
    expect(problems(placed, ringOf(5, [{ from: 2, to: 4 }]))).toEqual([]);
    const top = Math.min(...placed.nodes.map((r) => r.y));
    expect((placed.nodes[0] as Rect).y).toBe(top);
    // Clockwise: the second node is to the right of the first.
    expect((placed.nodes[1] as Rect).x).toBeGreaterThan((placed.nodes[0] as Rect).x);
    expect(placed.width).toBeLessThanOrEqual(474.5);
  });

  it('says so when no ellipse fits, and the two-column ring takes over', () => {
    expect(placeRingEllipse(boxes(5, 102), ringOf(5), 246, M)).toBeNull();
    expect(placeRingEllipse(boxes(12, 143), ringOf(12), 474, M)).toBeNull();
    expect(placeRingEllipse(boxes(2, 143), ringOf(2), 474, M)).toBeNull();
    for (const n of [1, 2, 3, 4, 5, 7, 12]) {
      const edges = ringOf(n);
      const placed = placeRingTrack(boxes(n, 150), edges, 474, M) as Placed;
      expect(placed, `${n} nodes`).not.toBeNull();
      expect(problems(placed, edges), `${n} nodes`).toEqual([]);
      expect(placed.width).toBeLessThanOrEqual(474.5);
    }
  });

  it('parts two edges that join the same pair in opposite directions', () => {
    const edges: EdgeInput[] = [{ from: 0, to: 1, labelW: 0, labelH: 0 }, { from: 1, to: 0, labelW: 0, labelH: 0 }];
    const placed = placeRingTrack(boxes(2, 150), edges, 474, M) as Placed;
    expect(placed).not.toBeNull();
    const mid = (i: number): Pt => cubicAt((placed.routes[i] as NonNullable<Placed['routes'][number]>).points, 0.5);
    expect(Math.hypot(mid(0).x - mid(1).x, mid(0).y - mid(1).y)).toBeGreaterThan(8);
  });

  it('puts a label in the middle of the gap between two boxes of different sizes', () => {
    const edges: EdgeInput[] = [{ from: 0, to: 1, labelW: 40, labelH: 18 }, { from: 1, to: 2, labelW: 0, labelH: 0 }, { from: 2, to: 3, labelW: 40, labelH: 18 }, { from: 3, to: 0, labelW: 0, labelH: 0 }];
    const sizes: Size[] = [{ w: 150, h: 40 }, { w: 150, h: 40 }, { w: 150, h: 130 }, { w: 150, h: 40 }];
    const placed = placeRingTrack(sizes, edges, 474, M) as Placed;
    expect(placed).not.toBeNull();
    expect(problems(placed, edges, { labels: edges })).toEqual([]);
    for (const [i, e] of edges.entries()) {
      const label = placed.routes[i]?.label;
      if (!label) continue;
      const chip: Rect = { x: label.x - e.labelW / 2, y: label.y - e.labelH / 2, w: e.labelW, h: e.labelH };
      expect(placed.nodes.some((r) => overlap(chip, r)), `label ${i}`).toBe(false);
    }
  });
});

describe('a ring with connections across it: review finding P3', () => {
  const sizes = (n: number, w: number, next: () => number): Size[] => Array.from({ length: n }, () => ({ w, h: 38 + Math.floor(next() * 3) * 19 }));
  const ringEdges = (n: number, chords: Edge[], labelled: boolean): EdgeInput[] =>
    [...Array.from({ length: n }, (_, i) => ({ from: i, to: (i + 1) % n })), ...chords].map((e, i) => ({ ...e, labelW: labelled && i >= n ? 44 : 0, labelH: labelled && i >= n ? 18 : 0 }));

  it('the reported drawing: ten nodes in two columns, one connection back up a column and one across', () => {
    // The lesson in the review: "again" from the sixth node back to the second, "in time" from the third to the seventh.
    const edges: EdgeInput[] = [
      ...[0, 1, 2, 3, 4].map((i) => ({ from: i, to: i + 1, labelW: i === 2 ? 98 : 0, labelH: i === 2 ? 18 : 0 })),
      { from: 5, to: 1, labelW: 44, labelH: 18 },
      { from: 2, to: 6, labelW: 52, labelH: 18 },
      ...[6, 7, 8].map((i) => ({ from: i, to: i + 1, labelW: 0, labelH: 0 })),
      { from: 9, to: 0, labelW: 0, labelH: 0 },
    ];
    const boxes: Size[] = Array.from({ length: 10 }, (_, i) => ({ w: 202, h: i === 2 ? 57 : 38 }));
    expect(placeRingEllipse(boxes, edges, 590, M)).toBeNull();
    const placed = placeRingTrack(boxes, edges, 590, M) as Placed;
    expect(placed).not.toBeNull();
    expect(problems(placed, edges, { labels: edges })).toEqual([]);
    expect(placed.width).toBeLessThanOrEqual(590.5);
    // Still two columns: the way back runs outside its column, not through it.
    expect(new Set(placed.nodes.map((r) => Math.round(r.x))).size).toBe(2);
    const again = placed.routes[5] as NonNullable<Placed['routes'][number]>;
    const column = placed.nodes[1] as Rect;
    expect(trace(again).some((p) => p.x > column.x + column.w + 4)).toBe(true);
  });

  it('two columns: no connection passes through a node, for rings of 2 to 12 with any two connections across', () => {
    const failures: string[] = [];
    let drawn = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const next = random(seed);
      const n = 2 + Math.floor(next() * 11);
      const chords: Edge[] = Array.from({ length: 1 + Math.floor(next() * 3) }, () => ({ from: Math.floor(next() * n), to: Math.floor(next() * n) }));
      const edges = ringEdges(n, chords, next() < 0.5);
      const avail = [474, 590, 824][Math.floor(next() * 3)] as number;
      const boxes = sizes(n, 150, next);
      const placed = placeRingTrack(boxes, edges, avail, M);
      // It may say it cannot (the caller then draws the cycle as a chain), but it may not draw through a node.
      if (!placed) continue;
      drawn++;
      const found = problems(placed, edges, { labels: edges });
      if (found.length > 0) failures.push(`seed ${seed} (${n} nodes, chords ${chords.map((c) => `${c.from}>${c.to}`).join(' ')}): ${found[0]?.what}`);
      if (placed.width > avail + 0.5) failures.push(`seed ${seed}: ${Math.round(placed.width)}px wide in ${avail}px`);
    }
    expect(failures).toEqual([]);
    // And it does draw them: saying "cannot" every time would pass the lines above.
    expect(drawn).toBeGreaterThan(540);
  });

  it('nine to twelve nodes with one connection along a column and one across: drawn, and through nothing', () => {
    for (let n = 9; n <= 12; n++) {
      const rows = Math.ceil(n / 2);
      // Along the right-hand column from its last node to its first, and across from the right column to the left.
      const edges = ringEdges(n, [{ from: rows, to: 1 }, { from: 2, to: rows + 1 }], true);
      const placed = placeRingTrack(Array.from({ length: n }, () => ({ w: 180, h: 38 })), edges, 590, M) as Placed;
      expect(placed, `${n} nodes`).not.toBeNull();
      expect(problems(placed, edges, { labels: edges }), `${n} nodes`).toEqual([]);
    }
  });

  it('round: a connection across the ring bends clear of the boxes beside it, or the ring is not drawn round', () => {
    const failures: string[] = [];
    let drawn = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const next = random(seed);
      const n = 3 + Math.floor(next() * 7);
      const chords: Edge[] = Array.from({ length: 1 + Math.floor(next() * 2) }, () => ({ from: Math.floor(next() * n), to: Math.floor(next() * n) }));
      const edges = ringEdges(n, chords, next() < 0.4);
      const avail = [330, 474, 590, 824][Math.floor(next() * 4)] as number;
      const placed = placeRingEllipse(sizes(n, [102, 124, 150][Math.floor(next() * 3)] as number, next), edges, avail, M);
      if (!placed) continue;
      drawn++;
      const found = problems(placed, edges);
      if (found.length > 0) failures.push(`seed ${seed} (${n} nodes in ${avail}px, chords ${chords.map((c) => `${c.from}>${c.to}`).join(' ')}): ${found[0]?.what}`);
    }
    expect(failures).toEqual([]);
    expect(drawn).toBeGreaterThan(100);
  });
});

describe('labels', () => {
  it('never sit on a node, and two labels never sit on each other, in the fixtures', () => {
    for (const [name, figure] of ALL_FIGURES) {
      if (figure.type !== 'flow') continue;
      const { sizes, edges } = fromFigure(figure, 150);
      const plan = planLayered(sizes.length, edges, { avail: 474, wanted: 'down', minNode: MIN_NODE, maxNode: MAX_NODE, metrics: M });
      const drawn = edges.map((e, i) => (plan.turned && plan.far[i] && e.labelW > 0 ? { ...e, labelW: 18, labelH: e.labelW } : e));
      const placed = placeLayered(fromFigure(figure, plan.nodeWidth).sizes, drawn, plan.layering, plan.direction, M);
      const chips = drawn.flatMap((e, i) => {
        const label = placed.routes[i]?.label;
        return label && e.labelW > 0 ? [{ x: label.x - e.labelW / 2, y: label.y - e.labelH / 2, w: e.labelW, h: e.labelH }] : [];
      });
      chips.forEach((chip, i) => {
        expect(placed.nodes.some((r) => overlap(chip, r)), `${name}: label ${i} on a node`).toBe(false);
        for (let j = i + 1; j < chips.length; j++) expect(overlap(chip, chips[j] as Rect), `${name}: labels ${i} and ${j}`).toBe(false);
      });
    }
  });
});

describe('chart axes', () => {
  it.each([
    // [min, max, from zero, expected ticks]
    [4, 4096, false, [0, 1000, 2000, 3000, 4000, 5000]],
    [9, 1400, false, [0, 500, 1000, 1500]],
    [1, 20, false, [0, 5, 10, 15, 20]],
    [3.7, 9.81, true, [0, 2, 4, 6, 8, 10]],
    [-31, 14, true, [-40, -30, -20, -10, 0, 10, 20]],
    [999, 499500, true, [0, 100000, 200000, 300000, 400000, 500000]],
    [0.12, 0.47, true, [0, 0.1, 0.2, 0.3, 0.4, 0.5]],
    // A line far from zero keeps its own range...
    [98.1, 99.2, false, [98, 98.25, 98.5, 98.75, 99, 99.25]],
    // ...but one that comes within half of zero starts there.
    [40, 100, false, [0, 20, 40, 60, 80, 100]],
    [-100, -40, false, [-100, -80, -60, -40, -20, 0]],
    [-1e12, 1e12, true, [-1e12, -5e11, 0, 5e11, 1e12]],
  ] as [number, number, boolean, number[]][])('from %d to %d (bars: %s) has ticks at %j', (min, max, fromZero, ticks) => {
    const scale = niceScale(min, max, fromZero);
    expect(scale.ticks).toEqual(ticks);
    expect(scale.lo).toBe(ticks[0]);
    expect(scale.hi).toBe(ticks[ticks.length - 1]);
    expect(scale.lo).toBeLessThanOrEqual(min);
    expect(scale.hi).toBeGreaterThanOrEqual(max);
  });

  it('copes with a flat series, with zero, and with nonsense', () => {
    expect(niceScale(5, 5, false).ticks).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(niceScale(5, 5, true).ticks).toEqual([0, 1, 2, 3, 4, 5]);
    expect(niceScale(0, 0, true).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceScale(Number.NaN, Number.POSITIVE_INFINITY, true).ticks.every(Number.isFinite)).toBe(true);
    expect(niceScale(10, 2, true).ticks).toEqual([0, 2, 4, 6, 8, 10]);
    for (const [min, max] of [[0, 1e-9], [-3, -3], [1e11, 1e12], [0.001, 0.0011]] as const) {
      const s = niceScale(min, max, false);
      expect(s.ticks.length, `${min}..${max}`).toBeGreaterThanOrEqual(2);
      expect(s.ticks.length, `${min}..${max}`).toBeLessThanOrEqual(12);
      expect(s.hi).toBeGreaterThan(s.lo);
    }
  });

  it('has no floating point noise in its ticks', () => {
    for (const tick of niceScale(0, 0.7, true).ticks) expect(String(tick).length).toBeLessThanOrEqual(4);
  });

  it('thins axis labels evenly and always keeps the first and the last', () => {
    expect(thin(4, 40, 100)).toEqual([true, true, true, true]);
    expect(thin(16, 30, 16).map((s, i) => (s ? i : -1)).filter((i) => i >= 0)).toEqual([0, 2, 4, 6, 8, 10, 12, 15]);
    expect(thin(16, 60, 16).map((s, i) => (s ? i : -1)).filter((i) => i >= 0)).toEqual([0, 4, 8, 15]);
    expect(thin(8, 60, 30).map((s, i) => (s ? i : -1)).filter((i) => i >= 0)).toEqual([0, 2, 4, 7]);
    // When even two do not fit, the first stands alone.
    expect(thin(4, 500, 20)).toEqual([true, false, false, false]);
    expect(thin(1, 500, 20)).toEqual([true]);
    for (let count = 2; count <= 16; count++) {
      for (const need of [10, 35, 70, 140]) {
        const shown = thin(count, need, 24);
        const kept = shown.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
        expect(kept[0]).toBe(0);
        // Neighbouring labels are never closer than the room each needs.
        for (let k = 1; k < kept.length; k++) expect(((kept[k] as number) - (kept[k - 1] as number)) * 24, `${count}/${need}`).toBeGreaterThanOrEqual(Math.min(need, 24 * Math.ceil(need / 24)) - 24);
      }
    }
  });
});
