// The chart's axis, held to account for every number a lesson could hold. The arithmetic is run
// in a worker with a small heap and a clock (see figures-guard.ts): review finding H1 was a loop in
// it that never ended for values a hair apart, and a test that calls such code directly would hang
// with it. Here a hang is a failed test, seconds later.
import { describe, expect, it } from 'vitest';
import { MAX_TICKS, niceScale, thin, tickLabels } from '../../src/player/figures/scale';
import { Figure } from '../../src/core/schema';
import { HOSTILE_CHARTS } from './figures-fixtures';
import { HOSTILE_PAIRS, type ScaleAnswer, type ScaleCase, casesDrawn, casesFor, hostileSeries, random, readLabel, scaleInWorker, scaleProblems } from './figures-guard';

async function answers(cases: readonly ScaleCase[], locale = 'en'): Promise<ScaleAnswer[]> {
  const guarded = await scaleInWorker(cases, { locale });
  if (!guarded.ok) throw new Error(`the scale ${guarded.why}`);
  return guarded.answers;
}

describe('the axis never hangs: review finding H1', () => {
  it('returns at once for the values that froze the page', async () => {
    const pairs: [number, number, boolean][] = [
      [0.3, 0.1 + 0.2, false],
      [-5e-324, 5e-324, false],
      [-5e-324, 5e-324, true],
      [1e12 - 1e-4, 1e12, false],
    ];
    const cases = pairs.map(([min, max, fromZero]) => ({ min, max, fromZero, target: 5 }));
    const guarded = await scaleInWorker(cases, { ms: 4000, heapMb: 32 });
    expect(guarded.ok ? 'returned' : guarded.why).toBe('returned');
    if (!guarded.ok) return;
    expect(guarded.slowest).toBeLessThan(200);
    // 0.1 + 0.2 beside 0.3 is one value: an axis round it, not ten thousand million million ticks between.
    expect(guarded.answers[0]?.ticks).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    // Values too small to draw are drawn as zero.
    expect(guarded.answers[1]?.ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(guarded.answers[2]?.ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    // A million million and its neighbour are one value too.
    expect(guarded.answers[3]?.labels).toEqual(['400B', '600B', '800B', '1T', '1.2T', '1.4T', '1.6T']);
    cases.forEach((c, i) => expect(scaleProblems(c, guarded.answers[i] as ScaleAnswer), `${c.min}..${c.max}`).toEqual([]));
  });

  it('gives a short run of finite, rising, round ticks with distinct labels for every hostile pair, bars and lines, wide and narrow', async () => {
    const cases: ScaleCase[] = [];
    for (const [min, max] of HOSTILE_PAIRS) for (const fromZero of [false, true]) for (const target of [5, 4, 3, 2, 1, 0, Number.NaN]) cases.push({ min, max, fromZero, target });
    const got = await answers(cases);
    const failures = cases.flatMap((c, i) => scaleProblems(c, got[i] as ScaleAnswer).map((p) => `niceScale(${c.min}, ${c.max}, ${c.fromZero}, ${c.target}): ${p}`));
    expect(failures).toEqual([]);
  });

  it('does the same for 6,000 series of random and adversarial values, in bounded time', async () => {
    const next = random(20261011);
    const cases: ScaleCase[] = [];
    for (let n = 0; n < 6000; n++) cases.push(...casesFor(hostileSeries(next)));
    const guarded = await scaleInWorker(cases, { ms: 20_000 });
    expect(guarded.ok ? 'returned' : guarded.why).toBe('returned');
    if (!guarded.ok) return;
    const failures = cases.flatMap((c, i) => scaleProblems(c, guarded.answers[i] as ScaleAnswer).map((p) => `niceScale(${c.min}, ${c.max}, ${c.fromZero}, ${c.target}): ${p}`));
    expect(failures.slice(0, 20)).toEqual([]);
    // No single axis takes long, whatever it is given: the slowest of 18,000 is still a blink.
    expect(guarded.slowest).toBeLessThan(200);
  });

  it('labels the same ticks distinctly in other languages and scripts', async () => {
    const next = random(7);
    const cases: ScaleCase[] = [];
    for (let n = 0; n < 400; n++) cases.push(...casesFor(hostileSeries(next)));
    for (const locale of ['de', 'fr', 'ja', 'hi', 'ar-EG', 'pt-BR', 'not a language']) {
      const got = await answers(cases, locale);
      const failures = cases.flatMap((c, i) => scaleProblems(c, got[i] as ScaleAnswer, { english: false }).map((p) => `${locale}: niceScale(${c.min}, ${c.max}, ${c.fromZero}, ${c.target}): ${p}`));
      expect(failures.slice(0, 10), locale).toEqual([]);
    }
  });

  it('the guard has teeth: the arithmetic as it was before the fix is stopped, for each value that froze the page', async () => {
    // Without this, every test above could pass because nothing was being guarded. It is also the
    // record of the defect: the same four calls as the first test, against the code as it was.
    const before = new URL('./figures-guard-loop.ts', import.meta.url).pathname;
    const froze = [[0.3, 0.1 + 0.2, false], [-5e-324, 5e-324, false], [-5e-324, 5e-324, true], [1e12 - 1e-4, 1e12, false]] as const;
    // Each in a worker of its own, all at once: none of them is going to finish.
    const stopped = await Promise.all(froze.map(([min, max, fromZero]) => scaleInWorker([{ min, max, fromZero, target: 5 }], { source: before, ms: 3000, heapMb: 32 })));
    stopped.forEach((guarded, i) => expect(guarded.ok ? 'returned' : guarded.why, `${froze[i]?.[0]}..${froze[i]?.[1]}`).toMatch(/^ran out of memory|^did not return/));
    // And it is the values, not the worker: an ordinary chart came back from the old code too.
    const ordinary = await scaleInWorker([{ min: 8, max: 4096, fromZero: false, target: 5 }], { source: before });
    expect(ordinary.ok && ordinary.answers[0]?.ticks).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    // The old labels, for the record of P2: 1,011 to 1,015 as "1.01K" four times and then "1.02K".
    const narrow = await scaleInWorker([{ min: 1011, max: 1015, fromZero: false, target: 5 }], { source: before });
    expect(narrow.ok && narrow.answers[0]?.labels).toEqual(['1.01K', '1.01K', '1.01K', '1.01K', '1.02K']);
  });

  it('holds for the charts the browser specs open: each is one the format accepts, and its axis comes back however the chart asks for it', async () => {
    for (const [name, figure] of Object.entries(HOSTILE_CHARTS)) {
      // Accepted as it stands: these are not damaged files, they are lessons the tools would publish.
      const parsed = Figure.safeParse(figure);
      expect(parsed.success, name).toBe(true);
      if (figure.type !== 'chart') continue;
      const cases = casesDrawn(figure.series.flatMap((s) => s.values));
      const got = await answers(cases);
      expect(cases.flatMap((c, i) => scaleProblems(c, got[i] as ScaleAnswer)), name).toEqual([]);
    }
  });

  it('the stop on the number of ticks sits above the eight the arithmetic can reach, and is itself small', () => {
    expect(MAX_TICKS).toBeGreaterThan(8);
    expect(MAX_TICKS).toBeLessThanOrEqual(20);
  });
});

describe('tick labels say what the tick is: review finding P2', () => {
  const labelled = (min: number, max: number, fromZero = false): string[] => tickLabels(niceScale(min, max, fromZero).ticks, 'en');

  it('a line with a narrow range gets a label for each tick, not one label five times', () => {
    // Both were reported: "100, 100, 100, 99.9, 99.8" and "1.01K" four times with "1.02K" on top.
    expect(labelled(99.8, 100.2)).toEqual(['99.8', '99.9', '100', '100.1', '100.2']);
    expect(labelled(1011, 1015)).toEqual(['1,011', '1,012', '1,013', '1,014', '1,015']);
    for (const [min, max] of [[99.8, 100.2], [1011, 1015], [12345000, 12360000], [0.98, 1.02], [299792.458, 299792.459], [-1015, -1011]] as const) {
      const scale = niceScale(min, max, false);
      const labels = tickLabels(scale.ticks, 'en');
      expect(new Set(labels).size, `${min}..${max}: ${labels.join(' | ')}`).toBe(labels.length);
      // Each label read back is its tick, to the last digit shown.
      labels.forEach((label, i) => expect(Math.abs((readLabel(label) ?? Number.NaN) - (scale.ticks[i] as number)), `${min}..${max}: "${label}"`).toBeLessThanOrEqual(1e-11 * Math.abs(scale.ticks[i] as number)));
    }
  });

  it('keeps the short spelling wherever it is exact', () => {
    expect(labelled(4, 4096)).toEqual(['0', '1K', '2K', '3K', '4K', '5K']);
    expect(labelled(999, 499500, true)).toEqual(['0', '100K', '200K', '300K', '400K', '500K']);
    expect(labelled(0, 2_400_000, true)).toEqual(['0', '500K', '1M', '1.5M', '2M', '2.5M']);
    expect(labelled(-1e12, 1e12, true)).toEqual(['-1T', '-500B', '0', '500B', '1T']);
    expect(labelled(0.12, 0.47, true)).toEqual(['0', '0.1', '0.2', '0.3', '0.4', '0.5']);
    expect(labelled(98.1, 99.2)).toEqual(['98', '98.25', '98.5', '98.75', '99', '99.25']);
    // With a unit when that is shorter and still exact, in full when it is not.
    expect(labelled(12345000, 12360000)).toEqual(['12.345M', '12.35M', '12.355M', '12.36M']);
  });

  it('writes a number too long to read as a power of ten, never as a row of fifty zeros', () => {
    expect(labelled(1e-50, 4e-50)).toEqual(['0', '1E-50', '2E-50', '3E-50', '4E-50']);
    expect(labelled(0.000001, 0.000004)).toEqual(['0', '1E-6', '2E-6', '3E-6', '4E-6']);
    expect(labelled(0.00001, 0.00004)).toEqual(['0', '0.00001', '0.00002', '0.00003', '0.00004']);
    for (const label of labelled(1e-300, 3e-300)) expect(label.length).toBeLessThanOrEqual(8);
  });

  it('falls back to English for a language Intl cannot name, and copes with no ticks and with a tick that is not a number', () => {
    expect(tickLabels([0, 1000, 2000], 'not a language')).toEqual(['0', '1K', '2K']);
    expect(tickLabels([0, 1000, 2000], 'de')).toHaveLength(3);
    expect(tickLabels([], 'en')).toEqual([]);
    expect(tickLabels([Number.NaN, 1], 'en')).toHaveLength(2);
  });
});

describe('thinning the labels along the x axis', () => {
  it('always answers with one yes or no per label, the first one yes, whatever the measurements', () => {
    const next = random(99);
    const odd = [0, -1, 1, 0.5, 16, 1e9, -1e9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 5e-324, 1e308];
    const pick = (): number => (next() < 0.5 ? (odd[Math.floor(next() * odd.length)] as number) : next() * 400 - 20);
    for (let n = 0; n < 4000; n++) {
      const count = Math.floor(next() * 40);
      const need = pick();
      const room = pick();
      const shown = thin(count, need, room);
      expect(shown, `thin(${count}, ${need}, ${room})`).toHaveLength(count);
      if (count > 0) expect(shown[0], `thin(${count}, ${need}, ${room})`).toBe(true);
    }
    // One position, or the same position many times over, is one label.
    expect(thin(1, 80, 10)).toEqual([true]);
    expect(thin(0, 80, 10)).toEqual([]);
    expect(thin(Number.NaN, 80, 10)).toEqual([]);
    expect(thin(-3, 80, 10)).toEqual([]);
  });
});
