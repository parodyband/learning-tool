// The helper library S: the arithmetic an animation is built from, and what each drawing helper
// asks of the canvas. Run directly (it is plain JavaScript with no globals of its own) against a
// context that records its calls.
import { describe, expect, it } from 'vitest';
import { frameHelpers } from '../../src/player/frame/runtime';
import { TEST_THEME } from './realm';

type Call = [string, ...unknown[]];

function library(): { S: any; calls: Call[]; ctx: Record<string, unknown> } {
  const calls: Call[] = [];
  const ctx: Record<string, unknown> = { globalAlpha: 1, font: '10px sans-serif' };
  for (const m of ['save', 'restore', 'beginPath', 'rect', 'roundRect', 'arc', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'fillRect', 'fillText', 'setTransform', 'translate', 'rotate', 'scale', 'setLineDash']) {
    ctx[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
    };
  }
  ctx.measureText = (s: string) => ({ width: s.length * 10 });
  const lib = frameHelpers();
  lib.bind({ width: 1920, height: 1080 }, ctx);
  lib.S.theme = TEST_THEME;
  return { S: lib.S, calls, ctx };
}
const names = (calls: Call[]): string[] => calls.map((c) => c[0]);

describe('time', () => {
  const { S } = library();

  it('clamp and lerp', () => {
    expect(S.clamp(5, 0, 3)).toBe(3);
    expect(S.clamp(-1, 0, 3)).toBe(0);
    expect(S.clamp(2, 0, 3)).toBe(2);
    expect(S.lerp(10, 20, 0.25)).toBe(12.5);
  });

  it('prog is 0 before a move, 1 after it, and eased between', () => {
    expect(S.prog(1, 2, 4)).toBe(0);
    expect(S.prog(2, 2, 4)).toBe(0);
    expect(S.prog(4, 2, 4)).toBe(0.5);
    expect(S.prog(6, 2, 4)).toBe(1);
    expect(S.prog(99, 2, 4)).toBe(1);
    expect(S.prog(4, 2, 4, (x: number) => x * x)).toBe(0.25);
    // A move of no length is a step, not a division by zero.
    expect(S.prog(1.9, 2, 0)).toBe(0);
    expect(S.prog(2.1, 2, 0)).toBe(1);
  });

  it('every easing runs from 0 to 1 and holds outside', () => {
    for (const [name, ease] of Object.entries(S.ease) as [string, (x: number) => number][]) {
      expect(ease(0), name).toBe(0);
      expect(ease(1), name).toBe(1);
      expect(ease(-3), name).toBe(0);
      expect(ease(7), name).toBe(1);
      expect(Number.isFinite(ease(0.37)), name).toBe(true);
    }
    expect(S.ease.linear(0.3)).toBe(0.3);
    // "out" is ahead of linear, "in" behind it, and "inOut" passes through the middle.
    expect(S.ease.out(0.3)).toBeGreaterThan(0.3);
    expect(S.ease.in(0.3)).toBeLessThan(0.3);
    expect(S.ease.inOut(0.5)).toBeCloseTo(0.5, 3);
    // The "back" curves overshoot, which is their point.
    expect(Math.max(...[0.6, 0.7, 0.8, 0.9].map((x) => S.ease.outBack(x)))).toBeGreaterThan(1);
  });

  it('bezier matches the CSS curve of the same numbers', () => {
    const ease = S.bezier(0.25, 0.1, 0.25, 1); // CSS "ease"
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    expect(S.bezier(0, 0, 1, 1)(0.42)).toBeCloseTo(0.42, 4);
  });

  it('map interpolates between keyframes and clamps at both ends', () => {
    expect(S.map(-1, [0, 1, 3], [10, 200, 50])).toBe(10);
    expect(S.map(0, [0, 1, 3], [10, 200, 50])).toBe(10);
    expect(S.map(0.5, [0, 1, 3], [10, 200, 50])).toBe(105);
    expect(S.map(1, [0, 1, 3], [10, 200, 50])).toBe(200);
    expect(S.map(2, [0, 1, 3], [10, 200, 50])).toBe(125);
    expect(S.map(3, [0, 1, 3], [10, 200, 50])).toBe(50);
    expect(S.map(9, [0, 1, 3], [10, 200, 50])).toBe(50);
    expect(S.map(0.5, [0, 1], [0, 100], (x: number) => x * x)).toBe(25);
    expect(S.map(0.5, [0, 1], ['#000000', '#ffffff'])).toBe('#808080');
    expect(S.map(Number.NaN, [0, 1], [3, 4])).toBe(3);
  });

  it('spring starts at 0, ends at 1, and the bouncy one overshoots', () => {
    for (const preset of ['gentle', 'snappy', 'bouncy', 'stiff', undefined, { stiffness: 200, damping: 20, mass: 1 }, 'nonsense']) {
      expect(S.spring(-1, preset)).toBe(0);
      expect(S.spring(0, preset)).toBe(0);
      expect(S.spring(10, preset)).toBeCloseTo(1, 4);
      expect(S.spring(0.1, preset)).toBeGreaterThan(0);
    }
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => S.spring(i / 100, 'bouncy')));
    expect(peak).toBeGreaterThan(1.05);
    const stiff = Math.max(...Array.from({ length: 100 }, (_, i) => S.spring(i / 100, 'stiff')));
    expect(stiff).toBeLessThanOrEqual(1.0001);
  });

  it('rand is stable per seed and spread over [0, 1)', () => {
    const values = Array.from({ length: 200 }, (_, i) => S.rand(i));
    expect(values).toEqual(Array.from({ length: 200 }, (_, i) => S.rand(i)));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new Set(values.map((v) => v.toFixed(6))).size).toBeGreaterThan(190);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });
});

describe('colour', () => {
  const { S } = library();

  it('mix blends two colours and always returns #rrggbb', () => {
    expect(S.mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(S.mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(S.mix('#ff0000', '#0000ff', 0.5)).toBe('#800080');
    expect(S.mix('#fff', '#000', 0.5)).toBe('#808080');
    expect(S.mix('#000000', '#ffffff', 4)).toBe('#ffffff');
    expect(S.mix('#102030', '#102030', Number.NaN)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('alpha gives an rgba() of the same colour', () => {
    expect(S.alpha('#2b3c9d', 0.25)).toBe('rgba(43,60,157,0.25)');
    expect(S.alpha('#fff', 2)).toBe('rgba(255,255,255,1)');
  });
});

describe('drawing', () => {
  it('clear fills every pixel with the page colour, whatever the transform', () => {
    const { S, calls, ctx } = library();
    S.clear();
    expect(calls).toEqual([['save'], ['setTransform', 1, 0, 0, 1, 0, 0], ['fillRect', 0, 0, 1920, 1080], ['restore']]);
    expect(ctx.fillStyle).toBe(TEST_THEME.bg);
    S.clear('#123456');
    expect(ctx.fillStyle).toBe('#123456');
  });

  it('rect fills and strokes what it is asked to, and nothing when asked for nothing', () => {
    const { S, calls, ctx } = library();
    S.rect(1, 2, 30, 40, { fill: '#111111', stroke: '#222222', lw: 4, r: 6, dash: [4, 8] });
    expect(names(calls)).toEqual(['save', 'beginPath', 'roundRect', 'fill', 'setLineDash', 'stroke', 'restore']);
    expect(calls[2]).toEqual(['roundRect', 1, 2, 30, 40, 6]);
    expect(ctx.lineWidth).toBe(4);
    calls.length = 0;
    S.rect(1, 2, 30, 40);
    expect(names(calls)).toEqual(['save', 'beginPath', 'rect', 'restore']);
    calls.length = 0;
    // A corner radius never exceeds half the shorter side.
    S.rect(0, 0, 10, 100, { fill: '#000000', r: 50 });
    expect(calls[2]).toEqual(['roundRect', 0, 0, 10, 100, 5]);
  });

  it('circle never asks for a negative radius', () => {
    const { S, calls } = library();
    S.circle(5, 6, -3, { fill: '#000000' });
    expect(calls[2]?.slice(0, 4)).toEqual(['arc', 5, 6, 0]);
  });

  it('poly draws a line by default, a share of it with draw, and a shape with fill', () => {
    const { S, calls, ctx } = library();
    const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
    S.poly(square);
    expect(names(calls)).toEqual(['save', 'beginPath', 'moveTo', 'lineTo', 'lineTo', 'lineTo', 'stroke', 'restore']);
    expect(ctx.strokeStyle).toBe(TEST_THEME.fg);
    calls.length = 0;
    // Half of 300 units of line: the first side, and half of the second.
    S.poly(square, { draw: 0.5, stroke: '#000000' });
    expect(calls.filter((c) => c[0] === 'lineTo')).toEqual([['lineTo', 100, 0], ['lineTo', 100, 50]]);
    calls.length = 0;
    S.poly(square, { draw: 0 });
    expect(calls).toEqual([]);
    S.poly(square, { fill: '#000000', close: true });
    expect(names(calls)).toEqual(['save', 'beginPath', 'moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath', 'fill', 'restore']);
    calls.length = 0;
    S.poly([[0, 0]]);
    expect(calls).toEqual([]);
  });

  it('line is a two-point poly, and arrow adds a head at the drawn end', () => {
    const { S, calls } = library();
    S.line(0, 0, 100, 0, { stroke: '#000000' });
    expect(calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo')).toEqual([['moveTo', 0, 0], ['lineTo', 100, 0]]);
    calls.length = 0;
    S.arrow(0, 0, 100, 0, { stroke: '#000000', draw: 0.5, head: 10 });
    const points = calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo');
    expect(points[1]).toEqual(['lineTo', 50, 0]);
    // The head: two short lines meeting at the tip.
    expect(points[3]).toEqual(['lineTo', 50, 0]);
    expect((points[2]?.[1] as number) < 50 && (points[4]?.[1] as number) < 50).toBe(true);
    calls.length = 0;
    S.arrow(0, 0, 100, 0, { draw: 0 });
    expect(calls).toEqual([]);
  });

  it('text sets the font from the options and wraps at maxWidth', () => {
    const { S, calls, ctx } = library();
    const m = S.text('one two three four', 10, 20, { size: 20, weight: 700, font: 'mono', maxWidth: 90, align: 'center', fill: '#333333' });
    expect(String(ctx.font)).toMatch(/^700 20px ui-monospace/);
    expect(ctx.textAlign).toBe('center');
    expect(ctx.fillStyle).toBe('#333333');
    // 10 units a character in this fake: "one two" fits in 90, "one two three" does not.
    expect(m.lines).toEqual(['one two', 'three', 'four']);
    expect(m.lineHeight).toBe(25);
    expect(m.height).toBe(75);
    expect(calls.filter((c) => c[0] === 'fillText')).toEqual([['fillText', 'one two', 10, 20], ['fillText', 'three', 10, 45], ['fillText', 'four', 10, 70]]);
    expect(S.measure('one two three four', { size: 20, maxWidth: 90 })).toEqual(m);
    // Numbers and line breaks are text too.
    expect(S.text(42, 0, 0).lines).toEqual(['42']);
    expect(S.text('a\nb', 0, 0).lines).toEqual(['a', 'b']);
    // The serif face is the lesson's own book face, with fallbacks.
    S.text('x', 0, 0, { font: 'serif', italic: true });
    expect(String(ctx.font)).toMatch(/^italic 500 24px Charter, /);
    S.text('x', 0, 0, { font: 'no-such-face' });
    expect(String(ctx.font)).toMatch(/^500 24px system-ui/);
  });

  it('group restores the context even when the drawing inside throws', () => {
    const { S, calls } = library();
    expect(() =>
      S.group({ x: 5, y: 6, scale: 2, rotate: 1, alpha: 0.5 }, () => {
        throw new Error('inside');
      }),
    ).toThrow('inside');
    expect(names(calls)).toEqual(['save', 'translate', 'rotate', 'scale', 'restore']);
  });

  it('alpha multiplies what is already there and is clamped', () => {
    const { S, ctx } = library();
    ctx.globalAlpha = 0.5;
    S.rect(0, 0, 1, 1, { fill: '#000000', alpha: 0.5 });
    expect(ctx.globalAlpha).toBe(0.25);
    ctx.globalAlpha = 1;
    S.text('x', 0, 0, { alpha: 7 });
    expect(ctx.globalAlpha).toBe(1);
  });
});
