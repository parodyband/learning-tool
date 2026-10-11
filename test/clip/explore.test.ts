// Explore, held on the numbers: once a clip has ended, the picture is a function of the control
// values and of nothing else, as during play it is a function of t and of nothing else.
//
// The three example clips that end in an explore are compiled against test/clip/fake-dom.ts (which
// records every write the engine makes) at a wide and a narrow stage, and drawn for settings of
// their sliders reached by different routes. Also held here: the arithmetic (formulas, rounding,
// the goal), what a curve chart draws, that a crowd's dots are never reshuffled, and the parts
// each kit offers a tap gate.
import { beforeAll, describe, expect, it } from 'vitest';
import { ClipScene, STAGE_KINDS } from '../../src/core/clip';
import { EXAMPLE_CLIPS, EXPLORE_EXAMPLE_CLIPS } from '../../src/core/clip-examples';
import { TAPPABLE, tappableKinds, tappableParts } from '../../src/player/stage/tappable';
import { exampleClip } from '../helpers/clip-example';
import { type FakeElement, installFakeDom, snapshot, stageElement } from './fake-dom';

interface Live {
  v: number;
  s: string;
}
interface State {
  env: Record<string, number>;
  values: Map<string, Live>;
  now: number;
  instant: boolean;
}
interface Tap {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Compiled {
  beats: { i: number; t0: number; t1: number; gate: boolean }[];
  duration: number;
  stage: unknown;
  apply(t: number, x?: State): void;
  taps(t: number): Tap[];
  busy(): boolean;
}
interface ExplorerLike {
  start: Record<string, number>;
  binds: { target: string; dp: number }[];
  values(env: Record<string, number>): Map<string, Live>;
  reached(env: Record<string, number>): boolean;
  state(env: Record<string, number>, now: number, instant: boolean): State;
  texts(): Map<string, string[]>;
}
type Control = { id: string; label: string; min: number; max: number; step: number; value: number; unit?: string };
let compile: (data: unknown, env: { el: FakeElement; W: number; H: number; dpr: number; colors: unknown }) => Compiled;
let stageHeight: (W: number) => number;
let Explorer: new (data: unknown) => ExplorerLike;
let format: (v: number, dp: number) => string;
let decimalsFor: (samples: number[]) => number;
let decimalsOf: (n: number) => number;
let snap: (c: Control, v: number) => number;
let controlGrid: (controls: Control[], per: number) => Record<string, number>[];

const ENGINE = '../../src/player/stage';
beforeAll(async () => {
  installFakeDom();
  const load = (name: string): Promise<unknown> => import(/* @vite-ignore */ `${ENGINE}/${name}`);
  ({ compile, stageHeight } = (await load('timeline')) as { compile: typeof compile; stageHeight: typeof stageHeight });
  ({ Explorer, format, decimalsFor, decimalsOf, snap, controlGrid } = (await load('explore')) as { Explorer: typeof Explorer; format: typeof format; decimalsFor: typeof decimalsFor; decimalsOf: typeof decimalsOf; snap: typeof snap; controlGrid: typeof controlGrid });
  for (const kit of ['kit-sequence', 'kit-cells', 'kit-dots', 'kit-chart', 'kit-flow', 'kit-words', 'kit-lines', 'kit-timeline']) await load(kit);
});

const COLORS = { neutral: [127, 134, 189], accent: [170, 181, 255], good: [134, 214, 163], bad: [255, 161, 152], warn: [242, 197, 107], muted: [77, 83, 145] } as const;
const WIDTHS = [960, 320];
const DOTS = ClipScene.parse(EXPLORE_EXAMPLE_CLIPS.dots);
const CURVE = ClipScene.parse(EXPLORE_EXAMPLE_CLIPS.curve);
const BARS = ClipScene.parse(EXPLORE_EXAMPLE_CLIPS.bars);
const ALL = [DOTS, CURVE, BARS];
/** Slider settings worth drawing, for each example: the ends, the start, and some between. */
const SETTINGS: Record<string, number[]> = { 'x-dots': [1, 2, 9, 10, 23, 50], 'x-curve': [-2.5, -1.5, 0, 0.5, 2, 2.5], 'x-bars': [2, 3, 20, 31, 40, 64] };

function build(clip: unknown, W: number): { el: FakeElement; c: Compiled } {
  const H = stageHeight(W);
  const el = stageElement(W, H);
  return { el, c: compile(clip, { el, W, H, dpr: 1, colors: COLORS }) };
}
const control = (clip: ClipScene): Control => clip.explore?.controls[0] as Control;
/**
 * The state for one value of the clip's first slider, the others where they start (or as `more`
 * says). `instant`: as with reduced motion, nothing travels.
 */
function at(clip: ClipScene, value: number, now = 0, instant = true, more: Record<string, number> = {}): State {
  const x = new Explorer(clip.explore);
  return x.state({ ...x.start, [control(clip).id]: value, ...more }, now, instant);
}
/** Every element of a class under a root, in document order. */
function byClass(root: FakeElement, cls: string): FakeElement[] {
  return root.querySelectorAll(`.${cls}`);
}
const shown = (el: FakeElement): boolean => el.style.props.get('opacity') !== '0';
const textOf = (root: FakeElement, cls: string): string[] => byClass(root, cls).filter(shown).map((el) => el.textContent);
/** The dots on a canvas as a sorted list: where each is, and its colour. */
function dots(root: FakeElement): string[] {
  const canvas = root.querySelectorAll('canvas')[0] as FakeElement;
  const out: string[] = [];
  let fill = '';
  for (const op of canvas.drawn()) {
    if (op.startsWith('B')) fill = op.slice(1);
    else if (op.startsWith('A')) out.push(`${op.slice(1).split(',').slice(0, 2).map((v) => Math.round(Number(v))).join(',')} ${fill}`);
  }
  return out.sort();
}

describe('the arithmetic of explore', () => {
  it('turns a setting of the sliders into every bound number, rounded one way for the whole range', () => {
    const x = new Explorer(BARS.explore);
    expect(x.start).toEqual({ n: 20 });
    expect([...x.values({ n: 20 })].map(([id, v]) => `${id}=${v.s}`)).toEqual(['lin=20', 'bin=5', 'times=4.0']);
    expect([...x.values({ n: 64 })].map(([id, v]) => `${id}=${v.s}`)).toEqual(['lin=64', 'bin=7', 'times=9.1']);
    // Whole numbers stay whole; a ratio keeps one decimal everywhere, so its digits tick and its width holds.
    expect(x.binds.map((b) => b.dp)).toEqual([0, 0, 1]);
    // Two sliders: every formula sees both.
    const market = new Explorer(CURVE.explore);
    expect(market.start).toEqual({ demand: 0, costs: 0 });
    expect(market.values({ demand: 0.5, costs: 0 }).get('price')?.s).toBe('5.25');
    expect(market.values({ demand: 1, costs: -1 }).get('price')?.s).toBe('5.00');
    expect(market.values({ demand: 1, costs: -1 }).get('sold')?.s).toBe('80');
    expect(new Explorer(DOTS.explore).values({ rate: 50 }).get('right')?.s).toBe('91');
    // What a read-out must have room for: the extremes, as they will be written.
    expect(x.texts().get('lin')).toEqual(['2', '64']);
  });

  it('formats and rounds sensibly', () => {
    expect(format(1234.5, 0)).toBe('1,235');
    expect(format(-0.0001, 2)).toBe('0.00');
    expect(format(Number.NaN, 1)).toBe('–');
    expect(decimalsFor([1, 2, 3])).toBe(0);
    expect(decimalsFor([0.5, 120])).toBe(0);
    expect(decimalsFor([0.5, 12])).toBe(1);
    expect(decimalsFor([0.25, 4])).toBe(2);
    expect(decimalsFor([0.012, 0.09])).toBe(3);
    expect(decimalsOf(0.5)).toBe(1);
    expect(decimalsOf(3)).toBe(0);
    const c: Control = { id: 'k', label: 'k', min: -3, max: 3, step: 0.5, value: 0 };
    expect(snap(c, 0.74)).toBe(0.5);
    expect(snap(c, 99)).toBe(3);
    expect(snap({ ...c, min: 0.1, step: 0.1, max: 1 }, 0.30000000000000004)).toBe(0.3);
    // Settings that cover a range: both ends and the start are always among them.
    const grid = controlGrid([{ ...c, min: 0, max: 1000, step: 1, value: 7 }], 6).map((env) => env.k);
    expect(grid).toEqual(expect.arrayContaining([0, 7, 1000]));
    expect(grid.length).toBeLessThanOrEqual(10);
  });

  it('checks the goal against the sliders, and says what is wrong with a formula it cannot use', () => {
    const x = new Explorer(DOTS.explore);
    expect(x.reached({ rate: 1 })).toBe(false);
    expect(x.reached({ rate: 8 })).toBe(false);
    expect(x.reached({ rate: 9 })).toBe(true);
    expect(x.reached({ rate: 10 })).toBe(true);
    // Not by dragging to the end: the goal is a place inside the range.
    expect(x.reached({ rate: 11 })).toBe(false);
    expect(x.reached({ rate: 50 })).toBe(false);
    // Two sliders: neither reaches the market's goal alone.
    const market = new Explorer(CURVE.explore);
    expect(market.reached({ demand: 2.5, costs: 0 })).toBe(false);
    expect(market.reached({ demand: 0, costs: -3.5 })).toBe(false);
    expect(market.reached({ demand: 1.5, costs: -1.5 })).toBe(true);
    const base = BARS.explore as NonNullable<ClipScene['explore']>;
    expect(() => new Explorer({ ...base, bind: [{ target: 'lin', expr: 'n +' }] })).toThrow('explore: the formula for "lin": The formula stops before it is finished.');
    expect(() => new Explorer({ ...base, bind: [{ target: 'lin', expr: 'size * 2' }] })).toThrow('"size" is not a control of this clip (it has "n")');
    expect(() => new Explorer({ ...base, bind: [{ target: 'lin', expr: 'n' }, { target: 'lin', expr: 'n' }] })).toThrow('"lin" is bound twice');
    expect(() => new Explorer({ ...base, goal: { text: 'x', when: 'n + 1', done: 'y' } })).toThrow('must be a comparison');
  });
});

describe('what a clip refuses to explore', () => {
  const withBind = (clip: ClipScene, bind: { target: string; expr: string }[]): unknown => ({ ...clip, explore: { ...clip.explore, bind } });
  it('names a binding it cannot draw', () => {
    expect(() => build(withBind(BARS, [{ target: 'nobody', expr: 'n' }]), 960)).toThrow('explore: nothing on this chart stage has the id "nobody"');
    const cells = { ...exampleClip('c3'), explore: { prompt: 'Drag.', controls: [{ id: 'k', label: 'K', min: 0, max: 5, step: 1, value: 0 }], bind: [{ target: 'c0', expr: 'k' }] } };
    expect(() => build(cells, 960)).toThrow('"c0" is a cell. A formula can drive a read-out, a bar, a group of dots or a value beside a line.');
    expect(() => build(withBind(DOTS, [{ target: 'neg', expr: 'rate' }]), 960)).toThrow('"neg" was made by a merge');
    expect(() => build(withBind(DOTS, [{ target: 'all', expr: 'rate' }]), 960)).toThrow('"all" is every dot there is');
  });
  it('lets a formula drive a read-out on any stage, and a value beside a line', () => {
    const cells = { ...exampleClip('c3'), explore: { prompt: 'Drag.', controls: [{ id: 'k', label: 'K', min: 0, max: 5, step: 1, value: 0 }], bind: [{ target: 'count', expr: 'k * 2' }] } };
    const { el, c } = build(cells, 960);
    c.apply(c.duration - 1, new Explorer(cells.explore).state({ k: 4 }, 0, true));
    const stat = byClass(el, 'st-stat').find((b) => b.textContent.includes('Comparisons')) as FakeElement;
    expect(stat.textContent).toContain('8');
    expect(stat.attrs.get('data-live')).toBe('1');
    const lines = ClipScene.parse(EXAMPLE_CLIPS.lines);
    const stage = lines.stage as { values?: { id: string; unit?: string }[] };
    const value = stage.values?.[0];
    if (!value) throw new Error('the lines example has a value');
    const traced = { ...lines, explore: { prompt: 'Drag.', controls: [{ id: 'k', label: 'K', min: 0, max: 9, step: 1, value: 0 }], bind: [{ target: value.id, expr: 'k + 0.5' }] } };
    const built = build(traced, 960);
    built.c.apply(built.c.duration - 1, new Explorer(traced.explore).state({ k: 7 }, 0, true));
    expect(textOf(built.el, 'st-ln-val').some((t) => t.includes(`7.5${value.unit ?? ''}`))).toBe(true);
  });
});

for (const W of WIDTHS) {
  describe(`explore at ${W} px: same control values, same picture`, () => {
    for (const clip of ALL) {
      const values = SETTINGS[clip.id] as number[];

      it(`${clip.id}: a fresh stage and one that has been dragged all over show the same`, () => {
        const walker = build(clip, W);
        const end = walker.c.duration - 1;
        for (const v of values) {
          const fresh = build(clip, W);
          fresh.c.apply(end, at(clip, v));
          for (const other of [...values].reverse()) walker.c.apply(end, at(clip, other));
          walker.c.apply(end, at(clip, v));
          expect(snapshot(walker.el), `${clip.id} at ${v}`).toBe(snapshot(fresh.el));
        }
      });

      it(`${clip.id}: with motion, the picture comes to rest on exactly what reduced motion shows at once`, () => {
        const eased = build(clip, W);
        const end = eased.c.duration - 1;
        let now = 1000;
        eased.c.apply(end, at(clip, control(clip).value, now, false));
        for (const v of values) {
          const still = build(clip, W);
          still.c.apply(end, at(clip, v));
          // A second and a half of frames is far more than any dot needs to cross.
          for (let i = 0; i < 90; i++) eased.c.apply(end, at(clip, v, (now += 16), false));
          expect(eased.c.busy(), `${clip.id} at ${v}: at rest`).toBe(false);
          expect(snapshot(eased.el), `${clip.id} at ${v}`).toBe(snapshot(still.el));
        }
      });

      it(`${clip.id}: exploring leaves nothing behind: every instant of the clip is still a function of t alone`, () => {
        const used = build(clip, W);
        const end = used.c.duration - 1;
        for (const v of values) used.c.apply(end, at(clip, v, v * 10, false));
        for (const t of [0, Math.round(end / 3), Math.round(end / 2), end]) {
          const fresh = build(clip, W);
          fresh.c.apply(t);
          used.c.apply(t);
          expect(snapshot(used.el), `${clip.id} at ${t} ms`).toBe(snapshot(fresh.el));
        }
      });

      it(`${clip.id}: the settings differ from one another, so the sliders do move the picture`, () => {
        const { el, c } = build(clip, W);
        const seen = new Set<string>();
        for (const v of values) {
          c.apply(c.duration - 1, at(clip, v));
          seen.add(snapshot(el));
        }
        expect(seen.size).toBe(values.length);
      });
    }

    it('bars and read-outs: where the sliders start, the hand-over changes nothing but the mark that says "live"', () => {
      for (const clip of [BARS, CURVE]) {
        const plain = build(clip, W);
        const live = build(clip, W);
        const end = plain.c.duration - 1;
        plain.c.apply(end);
        live.c.apply(end, at(clip, control(clip).value));
        const unmarked = (s: string): string => s.replace(/data-live="[01]"/g, 'data-live');
        expect(unmarked(snapshot(live.el)), clip.id).toBe(unmarked(snapshot(plain.el)));
        expect(snapshot(live.el)).toContain('data-live="1"');
        expect(snapshot(plain.el)).not.toContain('data-live="1"');
      }
    });

    it('bars: the scale is chosen for the whole range, so the tallest bar fits and the others are measured against it', () => {
      const { el, c } = build(BARS, W);
      const end = c.duration - 1;
      const heights = (n: number): number[] => {
        c.apply(end, at(BARS, n));
        // A bar's fill slides down inside a frame of the plot's height: how far down is how much is missing.
        return byClass(el, 'st-bar-fill').map((fill) => Number(/translate3d\([^,]+,([-\d.]+)px/.exec(fill.style.props.get('transform') ?? '')?.[1] ?? Number.NaN));
      };
      const [lin64, bin64] = heights(64) as [number, number];
      const [lin20, bin20] = heights(20) as [number, number];
      expect(lin64).toBeGreaterThanOrEqual(0);
      expect(lin64).toBeLessThan(lin20);
      expect(bin64).toBeLessThan(bin20);
      // Linear search at 64 items towers over binary search at 64 items.
      expect(bin64 - lin64).toBeGreaterThan(40);
      expect(textOf(el, 'st-barval')).toEqual(['20', '5']);
      c.apply(end, at(BARS, 31));
      expect(textOf(el, 'st-barval')).toEqual(['31', '5']);
      expect(textOf(el, 'st-stat').join(' ')).toContain('6.2× as many');
      // While the beats play, the read-out is already written the way the slider will write it: one decimal.
      c.apply(end);
      expect(textOf(el, 'st-stat').join(' ')).toContain('4.0× as many');
    });

    describe('dots', () => {
      interface Placed {
        to: Float32Array;
        tone: Uint8Array;
        piece: Uint16Array;
        labels: { x: number; y: number; n: number }[];
      }
      const placed = (c: Compiled, rate: number): Placed => {
        c.apply(c.duration - 1, at(DOTS, rate));
        const stage = c.stage as { sheet: unknown; place(sheet: unknown, x: State): Placed };
        return stage.place(stage.sheet, at(DOTS, rate));
      };

      it('where the slider starts, every dot and every label is where the clip left it', () => {
        const plain = build(DOTS, W);
        const live = build(DOTS, W);
        const end = plain.c.duration - 1;
        plain.c.apply(end);
        live.c.apply(end, at(DOTS, 1));
        expect(dots(live.el)).toEqual(dots(plain.el));
        expect(textOf(live.el, 'st-glabel')).toEqual(textOf(plain.el, 'st-glabel'));
        expect(textOf(live.el, 'st-glabel')).toEqual(['True positives  9', 'False alarms  89', 'Negative results  902']);
      });

      it('follows the formulas: every group has its number, and the thousand people are always all there', () => {
        const { el, c } = build(DOTS, W);
        for (let rate = 1; rate <= 50; rate++) {
          c.apply(c.duration - 1, at(DOTS, rate));
          const tp = Math.round(9 * rate);
          const fa = Math.round(0.09 * (1000 - 10 * rate));
          expect(textOf(el, 'st-glabel'), `at ${rate}%`).toEqual([`True positives  ${tp}`, `False alarms  ${fa}`, `Negative results  ${1000 - tp - fa}`]);
          expect(dots(el), `at ${rate}%`).toHaveLength(1000);
          // Every dot is on the stage.
          for (const d of dots(el)) {
            const [x, y] = (d.split(' ')[0] as string).split(',').map(Number) as [number, number];
            expect(x >= 0 && x <= W && y >= 0 && y <= stageHeight(W), `${d} at ${rate}%`).toBe(true);
          }
        }
      });

      it('never reshuffles: a dot that stays in its group keeps its place in the block, and one that leaves goes next door', () => {
        const { c } = build(DOTS, W);
        let before = placed(c, 1);
        for (let rate = 2; rate <= 50; rate++) {
          const after = placed(c, rate);
          const shift = new Map<number, string>();
          let moved = 0;
          for (let i = 0; i < 1000; i++) {
            const from = before.piece[i] as number;
            const to = after.piece[i] as number;
            if (from !== to) {
              moved++;
              // Dots change hands only between neighbours: the cut between two groups moved past them.
              expect(Math.abs(from - to), `dot ${i} at ${rate}%`).toBe(1);
              continue;
            }
            // Everything that stayed in a block moved with the block, as one piece: one offset for all of it.
            const d = `${Math.round(((after.to[2 * i] as number) - (before.to[2 * i] as number)) * 10)},${Math.round(((after.to[2 * i + 1] as number) - (before.to[2 * i + 1] as number)) * 10)}`;
            if (!shift.has(to)) shift.set(to, d);
            expect(d, `dot ${i} in group ${to} at ${rate}%`).toBe(shift.get(to));
          }
          // About nine people become true positives for each point of the rate, and nothing else has to move.
          expect(moved, `at ${rate}%`).toBeLessThan(40);
          expect(moved).toBeGreaterThan(0);
          before = after;
        }
      });

      it('eases: a dot that changes group is on its way for a few frames, then exactly in place', () => {
        const { el, c } = build(DOTS, W);
        const end = c.duration - 1;
        let now = 0;
        c.apply(end, at(DOTS, 1, now, false));
        expect(c.busy()).toBe(false);
        c.apply(end, at(DOTS, 30, (now += 16), false));
        expect(c.busy()).toBe(true);
        const mid = dots(el);
        for (let i = 0; i < 120; i++) c.apply(end, at(DOTS, 30, (now += 16), false));
        expect(c.busy()).toBe(false);
        expect(dots(el)).not.toEqual(mid);
        // Back in the clip's own picture, nothing is on its way any more.
        c.apply(end, at(DOTS, 2, (now += 16), false));
        c.apply(end);
        expect(c.busy()).toBe(false);
      });
    });

    describe('a curve chart', () => {
      const paths = (el: FakeElement): string[] => byClass(el, 'st-curve').map((p) => p.attrs.get('d') ?? '');
      const plotOf = (el: FakeElement): { x: number; y: number; w: number; h: number } => {
        const plot = byClass(el, 'st-plot')[0] as FakeElement;
        return { x: Number(plot.attrs.get('x')), y: Number(plot.attrs.get('y')), w: Number(plot.attrs.get('width')), h: Number(plot.attrs.get('height')) };
      };
      const xy = (d: string): [number, number][] => [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

      it('has a numeric x axis with round ticks and its label, and a value axis that does not move with the slider', () => {
        const { el, c } = build(CURVE, W);
        const end = c.duration - 1;
        c.apply(end);
        const xt = textOf(el, 'st-xtick').map(Number);
        expect(xt[0]).toBe(0);
        const step = (xt[1] as number) - (xt[0] as number);
        expect(new Set(xt.slice(1).map((v, i) => v - (xt[i] as number))).size, 'evenly spaced').toBe(1);
        // Round steps, a handful of them, reaching the end of the axis or stopping within a step of it (a narrow stage has room for fewer).
        expect([10, 20, 25, 30, 40, 50]).toContain(step);
        expect(xt.length).toBeGreaterThanOrEqual(4);
        expect(xt.length).toBeLessThanOrEqual(9);
        expect(xt.at(-1)).toBeGreaterThan(140 - step);
        expect(xt.at(-1)).toBeLessThanOrEqual(140);
        if (W >= 520) expect(xt.at(-1)).toBe(140);
        expect(textOf(el, 'st-tick').map(Number).at(0)).toBe(0);
        expect(textOf(el, 'st-tick').map(Number).at(-1)).toBe(12);
        expect(textOf(el, 'st-xlabel')).toEqual(['Cups a day']);
        expect(textOf(el, 'st-ylabel')).toEqual(['Price of a cup']);
        const plot = byClass(el, 'st-plot')[0] as FakeElement;
        const fixtures = (): string => [[...plot.attrs].join(' '), ...[...byClass(el, 'st-tick'), ...byClass(el, 'st-xtick'), ...byClass(el, 'st-grid'), ...byClass(el, 'st-axis'), ...byClass(el, 'st-tickmark')].map((f) => snapshot(f))].join('\n');
        const before = fixtures();
        for (const v of SETTINGS['x-curve'] as number[]) {
          for (const costs of [-3.5, 0, 1.5]) {
            c.apply(end, at(CURVE, v, 0, true, { costs }));
            expect(fixtures(), `demand ${v}, costs ${costs}`).toBe(before);
          }
        }
      });

      it('draws each curve from its formula, densely, inside a plot that clips it', () => {
        const { el, c } = build(CURVE, W);
        c.apply(c.duration - 1);
        const plot = plotOf(el);
        const [supply, demand] = paths(el).map(xy) as [[number, number][], [number, number][]];
        expect(supply.length).toBeGreaterThanOrEqual(48);
        // Supply rises (y falls on screen) from left to right, across the whole plot; demand falls.
        expect(supply[0]?.[0]).toBe(0);
        expect(supply.at(-1)?.[0]).toBeCloseTo(plot.w, 1);
        expect(supply.at(-1)?.[1]).toBeLessThan(supply[0]?.[1] as number);
        expect(demand.at(-1)?.[1]).toBeGreaterThan(demand[0]?.[1] as number);
        // y = 2 + 0.05x at x = 0 is 2 on an axis from 0 to 12: a sixth of the way up.
        expect(supply[0]?.[1]).toBeCloseTo((plot.h * 5) / 6, 0);
        // The curves live in a nested svg (which clips to its own box), not on the open stage.
        const nested = byClass(el, 'st-plot')[0] as FakeElement;
        expect(nested.tagName).toBe('svg');
        expect(byClass(nested, 'st-curve')).toHaveLength(2);
      });

      it('follows the sliders: each moves one curve and leaves the other still, and the point rides to the new crossing', () => {
        const { el, c } = build(CURVE, W);
        const end = c.duration - 1;
        c.apply(end, at(CURVE, 0));
        const [supply0, demand0] = paths(el) as [string, string];
        const dot = (): [number, number] => {
          const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec((byClass(el, 'st-pt')[0] as FakeElement).attrs.get('transform') ?? '') as RegExpExecArray;
          return [Number(m[1]), Number(m[2])];
        };
        const plot = plotOf(el);
        const X = (x: number): number => plot.x + (plot.w * x) / 140;
        const Y = (y: number): number => plot.y + plot.h - (plot.h * y) / 12;
        expect(dot()[0]).toBeCloseTo(X(60), 1);
        expect(dot()[1]).toBeCloseTo(Y(5), 1);
        expect(textOf(el, 'st-pt-pill')).toEqual(['60', '5.00']);
        // More demand: the demand curve moves, supply stays, and the crossing climbs the supply curve.
        c.apply(end, at(CURVE, 2.5));
        const [supply1, demand1] = paths(el) as [string, string];
        expect(supply1).toBe(supply0);
        expect(demand1).not.toBe(demand0);
        expect(dot()[0]).toBeCloseTo(X(85), 1);
        expect(dot()[1]).toBeCloseTo(Y(6.25), 1);
        expect(textOf(el, 'st-pt-pill')).toEqual(['85', '6.25']);
        expect(textOf(el, 'st-stat').join(' ')).toContain('6.25');
        expect(textOf(el, 'st-stat').join(' ')).toContain('85');
        // The value at each curve's right end rides with it.
        expect(textOf(el, 'st-tipval')).toEqual(['9.0', '3.5']);
        // Lower costs alone: now supply moves and demand is the one that stays.
        c.apply(end, at(CURVE, 0, 0, true, { costs: -2 }));
        const [supply2, demand2] = paths(el) as [string, string];
        expect(demand2).toBe(demand0);
        expect(supply2).not.toBe(supply0);
        expect(textOf(el, 'st-pt-pill')).toEqual(['80', '4.00']);
        // Both in step: more cups at the price the clip ended on.
        c.apply(end, at(CURVE, 2, 0, true, { costs: -2 }));
        expect(textOf(el, 'st-pt-pill')).toEqual(['100', '5.00']);
        expect(dot()[1]).toBeCloseTo(Y(5), 1);
      });

      it('`draw` draws a curve from left to right, the value riding its tip; a point appears once its curve has passed it', () => {
        const { el, c } = build(CURVE, W);
        const beat = c.beats[1] as { t0: number; t1: number };
        const plot = plotOf(el);
        const reach = (t: number): number => {
          c.apply(t);
          const supply = byClass(el, 'st-curve')[0] as FakeElement;
          return shown(supply) ? (xy(supply.attrs.get('d') ?? '').at(-1)?.[0] ?? 0) : 0;
        };
        // Nothing is drawn on the poster: both curves wait for their `draw`.
        expect(reach(beat.t0 - 1)).toBe(0);
        const samples = Array.from({ length: 12 }, (_, i) => reach(beat.t0 + ((beat.t1 - beat.t0) * i) / 11));
        for (let i = 1; i < samples.length; i++) expect(samples[i] as number, `sample ${i}`).toBeGreaterThanOrEqual(samples[i - 1] as number);
        expect(samples.some((v) => v > plot.w * 0.1 && v < plot.w * 0.9), 'seen part-way').toBe(true);
        expect(samples.at(-1)).toBeCloseTo(plot.w, 1);
        // Part-way, the value at the tip is the curve's value there, not its last.
        const half = samples.findIndex((v) => v > plot.w * 0.2 && v < plot.w * 0.9);
        reach(beat.t0 + ((beat.t1 - beat.t0) * half) / 11);
        const tip = Number(textOf(el, 'st-tipval')[0]);
        expect(tip).toBeGreaterThan(2);
        expect(tip).toBeLessThan(9);
        // The point is named by a `show` on the fourth beat: not before.
        c.apply((c.beats[2] as { t1: number }).t1 - 1);
        expect(byClass(el, 'st-pt').filter(shown)).toHaveLength(0);
        c.apply((c.beats[3] as { t1: number }).t1 - 1);
        expect(byClass(el, 'st-pt').filter(shown)).toHaveLength(1);
      });

      it('breaks a curve where its formula has no value, and where it leaps across the plot', () => {
        const stage = { ...CURVE.stage, curves: [{ id: 'gap', label: 'A gap', expr: 'if(x > 40 and x < 60, sqrt(-1), 5)' }, { id: 'pole', label: 'A pole', expr: '5 + 20 / (x - 60.3)' }], points: [], stats: [] };
        const clip = { ...CURVE, stage, beats: [{ caption: { type: 'framing', text: 'Two curves that are not whole.' } }, { caption: { type: 'framing', text: 'Look at where they stop.' } }], explore: undefined };
        const { el, c } = build(clip, W);
        c.apply(c.duration - 1);
        const [gap, pole] = paths(el) as [string, string];
        expect(gap.split('M').length - 1, 'a gap: two pieces').toBe(2);
        expect(gap).not.toContain('NaN');
        expect(pole.split('M').length - 1, 'a pole: two pieces').toBe(2);
        // No coordinate runs away: what is far outside the plot is pulled in to just beyond it.
        const plot = plotOf(el);
        for (const [, y] of xy(pole)) expect(Math.abs(y)).toBeLessThanOrEqual(plot.h * 3 + 1);
      });

      it('names what is wrong with a formula or a point it cannot draw', () => {
        const stage = CURVE.stage as { curves: unknown[]; points: unknown[] };
        expect(() => build({ ...CURVE, stage: { ...stage, curves: [{ id: 'a', label: 'A', expr: 'x +* 2' }], points: [] }, explore: undefined }, W)).toThrow('The curve "a":');
        expect(() => build({ ...CURVE, stage: { ...stage, curves: [{ id: 'a', label: 'A', expr: 'k * x' }], points: [] }, explore: undefined }, W)).toThrow('"k" is not a control of this clip');
        expect(() => build({ ...CURVE, stage: { ...stage, points: [{ id: 'p', label: 'P', x: '3', on: 'nowhere' }] } }, W)).toThrow('The point "p" is on "nowhere"');
        // A chart with no sliders at all still draws: its curves are formulas in x alone.
        const plain = build({ ...CURVE, stage: { ...stage, curves: [{ id: 'a', label: 'A', expr: '2 + x / 20' }], points: [{ id: 'p', label: 'P', x: '40' }], stats: [] }, beats: CURVE.beats.slice(0, 2).map((b) => ({ caption: b.caption })), explore: undefined }, W);
        plain.c.apply(plain.c.duration - 1);
        expect((paths(plain.el)[0] as string).split('L').length).toBeGreaterThan(40);
        expect(textOf(plain.el, 'st-pt-pill')).toEqual(['40', '4']);
        expect(() => build({ ...CURVE, stage: { ...stage, points: [{ id: 'p', label: 'P', x: 'x + 1' }] } }, W)).toThrow('The point "p": "x" is not a control of this clip');
      });
    });
  });
}

describe('the parts a tap gate offers', () => {
  const W = 960;
  const H = (): number => stageHeight(W);

  it('are, at the gate in the trace, the seven cells from left to right, each called by what it holds and where it stands', () => {
    const clip = exampleClip('c3');
    const { c } = build(clip, W);
    const gate = c.beats.findIndex((b, i) => b.gate && 'pick' in ((clip.beats[i]?.gate ?? {}) as object));
    expect(gate).toBe(3);
    const hold = (c.beats[gate] as { t0: number }).t0 - 1;
    c.apply(hold);
    const taps = c.taps(hold);
    expect(taps.map((t) => t.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
    expect(taps.map((t) => t.label)).toEqual(['3, cell 1 of 7', '8, cell 2 of 7', '15, cell 3 of 7', '23, cell 4 of 7', '42, cell 5 of 7', '57, cell 6 of 7', '91, cell 7 of 7']);
    for (let i = 1; i < taps.length; i++) expect((taps[i] as Tap).x).toBeGreaterThanOrEqual((taps[i - 1] as Tap).x + (taps[i - 1] as Tap).w - 4);
    for (const t of taps) expect(t.x >= 0 && t.y >= 0 && t.x + t.w <= W && t.y + t.h <= H() && t.w >= 24 && t.h >= 32, `${t.id} is on the stage and large enough`).toBe(true);
  });

  it('are the groups on stage at that moment on a dots stage, and the curves and points drawn so far on a curve chart', () => {
    const dotsStage = build(DOTS, W).c;
    const at3 = (dotsStage.beats[3] as { t0: number }).t0 - 1;
    dotsStage.apply(at3);
    expect(dotsStage.taps(at3).map((t) => t.label)).toEqual(['True positives: 9', 'Missed: 1', 'Do not have it: 990']);
    expect(dotsStage.taps(0).map((t) => t.label)).toEqual(['People tested: 1,000']);
    const end = dotsStage.duration - 1;
    dotsStage.apply(end);
    expect(dotsStage.taps(end).map((t) => t.id)).toEqual(['tp', 'fa', 'neg']);

    const curve = build(CURVE, W).c;
    const poster = (curve.beats[0] as { t0: number }).t0 - 1;
    curve.apply(poster);
    expect(curve.taps(poster)).toEqual([]);
    const gate = (curve.beats[4] as { t0: number }).t0 - 1;
    curve.apply(gate);
    expect(curve.taps(gate).map((t) => t.label).sort()).toEqual(['Demand', 'Market price: 60, 5.00', 'Supply']);
  });

  it('are, on every kit, parts of a kind the table lists, and only those that are on stage', () => {
    for (const kind of STAGE_KINDS) {
      if (kind === 'frame') continue;
      const clip = ClipScene.parse(EXAMPLE_CLIPS[kind]);
      const { c } = build(clip, W);
      const end = c.duration - 1;
      c.apply(end);
      const known = new Map(tappableParts(clip).map((p) => [p.id, p]));
      const taps = c.taps(end);
      for (const t of taps) {
        expect(known.has(t.id), `${kind}: ${t.id}`).toBe(true);
        expect(tappableKinds(clip.stage as { kind: string; mark?: string }), `${kind}: ${t.id}`).toContain(known.get(t.id)?.kind);
        expect(t.label.length, `${kind}: ${t.id} has a name`).toBeGreaterThan(0);
      }
      // Words are laid out by the page, which this stand-in does not do; every other kit knows where its parts are.
      if (kind !== 'words') expect(taps.length, kind).toBeGreaterThan(0);
    }
    // A bar, a flow's boxes and drawn arrows, a sequence's actors and sent messages, a timeline's events, a line of code.
    const ids = (kind: (typeof STAGE_KINDS)[number]): string[] => {
      const { c } = build(ClipScene.parse(EXAMPLE_CLIPS[kind]), W);
      c.apply(c.duration - 1);
      return c.taps(c.duration - 1).map((t) => t.id);
    };
    expect(ids('chart')).toEqual(['lin', 'bin']);
    expect(ids('flow')).toEqual(expect.arrayContaining(['list', 'found', 'begin', 'yes']));
    expect(ids('sequence')).toEqual(expect.arrayContaining(['caller', 'search', 'call', 'result']));
    expect(ids('timeline')).toEqual(['t1', 't2', 't3']);
    expect(ids('lines')[0]).toBe('l1');
    expect(Object.keys(TAPPABLE)).toContain('chart.curve');
  });

  it('never include a pointer, a bracket, a read-out or a label', () => {
    const { c } = build(exampleClip('c3'), W);
    const end = c.duration - 1;
    c.apply(end);
    for (const t of c.taps(end)) expect(t.id).toMatch(/^c\d$/);
  });
});
