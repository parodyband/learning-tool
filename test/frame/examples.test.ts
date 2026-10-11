// The three sample frames: they pass the schema and every static check with no issue at all, and
// they draw without an error at any time in both stage shapes, the same picture for the same t.
import { describe, expect, it } from 'vitest';
import { FrameStage } from '../../src/core/frame';
import { FRAME_EXAMPLES, FRAME_EXAMPLE_PROJECTILE, FRAME_EXAMPLE_SORT } from '../../src/core/frame-examples';
import { checkFrame, checkFrameBeats, drawnText } from '../../src/frame/check';
import { startWorker } from './realm';

describe.each(FRAME_EXAMPLES.map((e) => [e.id, e] as const))('%s', (_id, example) => {
  it('is a valid frame stage exactly as written', () => {
    expect(FrameStage.parse(example.stage)).toEqual(example.stage);
  });

  it('passes every static check with no error and no warning', () => {
    expect(checkFrame(example.stage)).toEqual({ ok: true, issues: [] });
    expect(checkFrameBeats(example.stage.duration, example.beats.map((b) => b.at))).toEqual([]);
  });

  it('has a description, a title and captions of the lengths a clip allows', () => {
    expect(example.description.length).toBeGreaterThanOrEqual(30);
    expect(example.description.length).toBeLessThanOrEqual(400);
    expect(example.title.length).toBeLessThanOrEqual(60);
    expect(example.beats.length).toBeGreaterThanOrEqual(2);
    for (const b of example.beats) expect(b.caption.split(/\s+/).length).toBeLessThanOrEqual(20);
  });

  it('draws every instant asked for, wide and tall, without an error', () => {
    const params = Object.fromEntries(example.stage.params.map((p) => [p.id, p.value]));
    const w = startWorker(example.stage.code);
    expect(w.sent).toEqual([{ type: 'ready', left: [] }]);
    const d = example.stage.duration;
    const times = [0, 0.05, example.stage.poster, d / 3, d / 2, d - 0.01, d, ...example.beats.map((b) => b.at)];
    for (const shape of [{ w: 960, h: 540 }, { w: 540, h: 675 }]) {
      for (const t of times) {
        const m = w.frame(t, { ...shape, dur: d, params });
        expect(m.type === 'frame' ? 'frame' : m.message, `t=${t} ${shape.w}x${shape.h}`).toBe('frame');
        expect(m.bitmap.calls.length).toBeGreaterThan(5);
      }
    }
  });

  it('is a pure function of time: the same t gives the same drawing, whatever was drawn before', () => {
    const params = Object.fromEntries(example.stage.params.map((p) => [p.id, p.value]));
    const d = example.stage.duration;
    const a = startWorker(example.stage.code);
    const b = startWorker(example.stage.code);
    const forward = [0, d * 0.2, d * 0.5, d * 0.8, d].map((t) => a.frame(t, { dur: d, params }).bitmap.calls);
    const backward = [d, d * 0.8, d * 0.5, d * 0.2, 0].map((t) => b.frame(t, { dur: d, params }).bitmap.calls).reverse();
    expect(backward).toEqual(forward);
    // And something does move: the first and last instants differ.
    expect(forward[0]).not.toEqual(forward[4]);
  });

  it('stays within the stage: every coordinate it draws at is near the box', () => {
    const params = Object.fromEntries(example.stage.params.map((p) => [p.id, p.value]));
    const w = startWorker(example.stage.code);
    for (const shape of [{ w: 960, h: 540 }, { w: 540, h: 675 }]) {
      const m = w.frame(example.stage.poster, { ...shape, dur: example.stage.duration, params });
      for (const call of m.bitmap.calls as unknown[][]) {
        if (call[0] !== 'fillText') continue;
        const [, , x, y] = call as [string, string, number, number];
        // Text is placed inside S.group transforms in one example, so only untransformed text is tested here.
        if (example.id === 'word-order') continue;
        expect(x, `${String(call[1])} x`).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(shape.w);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(shape.h);
      }
    }
  });
});

describe('what the examples say', () => {
  it('the sort example counts what its description says', () => {
    const values = [5, 2, 8, 3, 9, 1, 6, 4];
    let comparisons = 0;
    let swaps = 0;
    const a = values.slice();
    for (let end = a.length - 1; end > 0; end--) {
      for (let j = 0; j < end; j++) {
        comparisons++;
        if ((a[j] as number) > (a[j + 1] as number)) {
          [a[j], a[j + 1]] = [a[j + 1] as number, a[j] as number];
          swaps++;
        }
      }
    }
    expect(FRAME_EXAMPLE_SORT.description).toContain(`${comparisons} comparisons and ${swaps} swaps`);
    expect(FRAME_EXAMPLE_SORT.stage.code).toContain(`[${values.join(', ')}]`);
    // 1.6 s of introduction, then half a second per comparison.
    expect(FRAME_EXAMPLE_SORT.beats.at(-1)?.at).toBe(1.6 + comparisons * 0.5);
    expect(FRAME_EXAMPLE_SORT.stage.duration).toBeGreaterThan(1.6 + comparisons * 0.5);
  });

  it('the projectile example lands where its description says', () => {
    expect(FRAME_EXAMPLE_PROJECTILE.description).toContain('about 49 metres');
    expect((22 * 22) / 9.81).toBeCloseTo(49.3, 1);
    const w = startWorker(FRAME_EXAMPLE_PROJECTILE.stage.code);
    const texts = (angle: number): string[] =>
      (w.frame(5, { dur: 5, params: { angle } }).bitmap.calls as unknown[][]).filter((c) => c[0] === 'fillText').map((c) => String(c[1]));
    expect(texts(45)).toContain('49.3 m');
    expect(texts(45)).toContain('Launch angle 45°');
    expect(texts(30)).toContain('42.7 m');
    expect(texts(60)).toContain('42.7 m');
  });

  it('lists the sentences each example draws, so a validator can compare them with the captions', () => {
    expect(drawnText(FRAME_EXAMPLE_SORT.stage.code)).toContain('Compare neighbours. Swap them if the left one is larger.');
    expect(drawnText(FRAME_EXAMPLE_PROJECTILE.stage.code)).toContain('Sideways speed never changes. Upward speed shrinks, then reverses.');
  });
});
