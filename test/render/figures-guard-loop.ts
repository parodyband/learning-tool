// The axis arithmetic as it was when it froze the page (review finding H1), kept as a fixture so
// that the tests can show their guard stops it. Run only inside the guarded worker of
// figures-guard.ts: called directly with values a hair apart, `niceScale` here never returns.
//
// Why it never returns: `first` and `last` are the data divided by a step that is far smaller than
// the data, so both are at or above 2^53, where adding one to a number leaves it unchanged.

const tidy = (v: number): number => Number.parseFloat(v.toPrecision(12));

export function niceScale(min: number, max: number, fromZero: boolean, target = 5): { lo: number; hi: number; step: number; ticks: number[] } {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 1;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (fromZero || (lo >= 0 && lo <= hi * 0.5)) lo = Math.min(lo, 0);
  if (fromZero || (hi <= 0 && hi >= lo * 0.5)) hi = Math.max(hi, 0);
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.5;
    lo -= lo === 0 ? 0 : pad;
    hi += pad;
  }
  const rough = (hi - lo) / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const ratio = rough / magnitude;
  const step = tidy((ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 2.5 ? 2.5 : ratio <= 5 ? 5 : 10) * magnitude);
  const first = Math.floor(tidy(lo / step));
  const last = Math.ceil(tidy(hi / step));
  const ticks: number[] = [];
  for (let k = first; k <= last; k++) ticks.push(tidy(k * step));
  return { lo: ticks[0] as number, hi: ticks[ticks.length - 1] as number, step, ticks };
}

/** Tick labels as they were before review finding P2: three significant digits, whatever the step. */
export function tickLabels(ticks: readonly number[], locale: string): string[] {
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumSignificantDigits: 3 });
  return ticks.map((v) => compact.format(v));
}
