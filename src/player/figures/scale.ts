// Axis arithmetic for charts: where an axis starts and ends, where its ticks go, and what each tick
// is called. Pure, so it is tested without a browser.
//
// A lesson may hold any finite number, including ones that differ only in their last binary digit
// and ones too small to divide. Nothing here may run for longer because of the numbers it is given:
// every list is built to a length that is a whole number, checked and capped before the list is
// started, and a result that is not a short run of finite, rising ticks is never returned.

export interface Scale {
  lo: number;
  hi: number;
  step: number;
  /** Tick values from `lo` to `hi` inclusive: at least two, at most `MAX_TICKS`, finite and rising. */
  ticks: number[];
}

/** The arithmetic asks for about five intervals and can reach seven. This is the stop beyond that. */
export const MAX_TICKS = 13;

/**
 * Values closer together than this, as a share of their size, are drawn as one value. Ticks are
 * kept to twelve significant digits, so a narrower axis could not tell its own ticks apart; and a
 * difference in the tenth digit is not one a chart can show.
 */
const FLAT = 1e-9;
/** Below this a value is drawn as zero: halving it or dividing by it underflows. */
const TINY = 1e-300;
/** Far past anything a lesson may hold (the format stops at a million million). Held here so that a sum of two values cannot overflow. */
const HUGE = 1e300;
/** How far a quotient may be from a whole number and still be that number: floating point noise, nothing a reader could see. */
const NOISE = 1e-13;

/** Drop the noise binary floating point adds to a product such as 3 * 0.1. */
const tidy = (v: number): number => Number.parseFloat(v.toPrecision(12));

/** `q` rounded down or up to a whole number, where a `q` that is whole but for noise is already there. */
function whole(q: number, round: (v: number) => number): number {
  const nearest = Math.round(q);
  return Math.abs(q - nearest) <= NOISE * Math.max(1, Math.abs(nearest)) ? nearest : round(q);
}

/** Ticks on round numbers from at or below `lo` to at or above `hi`, or null when these two numbers do not make an axis. */
function ticksAcross(lo: number, hi: number, target: number): Scale | null {
  const rough = (hi - lo) / Math.max(1, target);
  if (!(rough > 0) || !Number.isFinite(rough)) return null;
  const magnitude = Number(`1e${Math.floor(Math.log10(rough))}`);
  const ratio = rough / magnitude;
  const step = tidy((ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 2.5 ? 2.5 : ratio <= 5 ? 5 : 10) * magnitude);
  if (!(step > 0) || !Number.isFinite(step)) return null;
  const first = whole(lo / step, Math.floor);
  const last = whole(hi / step, Math.ceil);
  // The number of ticks is settled here, as a whole number, before any tick is made. Counting up
  // from `first` until `last` is passed would never end once the two are too large to add one to.
  const intervals = last - first;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || intervals < 1 || intervals >= MAX_TICKS) return null;
  const ticks = Array.from({ length: intervals + 1 }, (_, i) => tidy((first + i) * step));
  for (let i = 0; i < ticks.length; i++) {
    const tick = ticks[i] as number;
    if (!Number.isFinite(tick) || (i > 0 && !(tick > (ticks[i - 1] as number)))) return null;
  }
  return { lo: ticks[0] as number, hi: ticks[ticks.length - 1] as number, step, ticks };
}

/** The axis for a chart with nothing to measure: zero to one. */
const unit = (): Scale => ({ lo: 0, hi: 1, step: 0.2, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] });

/**
 * A scale that covers the data with ticks on round numbers (1, 2, 2.5 or 5 times a power of ten).
 *
 * Bars are lengths, so a bar chart always starts at zero. A line may start elsewhere, but only when
 * zero is far from the data: if the smallest value is no more than half the largest, the axis
 * starts at zero anyway, because a cut axis would make a modest change look dramatic.
 *
 * Total: any two numbers give a scale, in the same few steps. Values that cannot be told apart
 * (see `FLAT`) share an axis that runs from half to one and a half times their size.
 */
export function niceScale(min: number, max: number, fromZero: boolean, target = 5): Scale {
  const held = (v: number, fallback: number): number => (Number.isFinite(v) ? Math.min(HUGE, Math.max(-HUGE, v)) : fallback);
  let lo = held(min, 0);
  let hi = held(max, 1);
  if (lo > hi) [lo, hi] = [hi, lo];
  if (Math.abs(lo) < TINY) lo = 0;
  if (Math.abs(hi) < TINY) hi = 0;
  if (fromZero || (lo >= 0 && lo <= hi * 0.5)) lo = Math.min(lo, 0);
  if (fromZero || (hi <= 0 && hi >= lo * 0.5)) hi = Math.max(hi, 0);
  const aim = Number.isFinite(target) ? target : 5;
  const size = Math.max(Math.abs(lo), Math.abs(hi));
  if (hi - lo > size * FLAT) {
    const scale = ticksAcross(lo, hi, aim);
    if (scale) return scale;
  }
  // A flat series still needs an axis with some height.
  const middle = lo / 2 + hi / 2;
  if (middle === 0) return ticksAcross(0, 1, aim) ?? unit();
  const pad = Math.abs(middle) * 0.5;
  return ticksAcross(middle - pad, middle + pad, aim) ?? unit();
}

/** How many significant digits a number is written with, and how many of them come after the decimal point. */
function digitsOf(v: number): { significant: number; decimals: number } {
  const [mantissa, exponent] = Math.abs(v).toExponential().split('e') as [string, string];
  const significant = Math.max(1, mantissa.length - 1);
  return { significant, decimals: Math.max(0, significant - 1 - Number(exponent)) };
}

/** A label of this length or less is never swapped for powers of ten: "0.00001" and "12.345M" are still read at a glance. */
const PLAIN_ENOUGH = 7;

/**
 * What to call each tick: the shortest spelling that says exactly what the tick is.
 *
 * Three spellings are tried, each given as many digits as the ticks themselves have, so none of
 * them rounds: with a unit ("1.5K"), in full ("1,500"), and as a power of ten ("1.5E3"), which is
 * only for numbers too long to write out. Rounding to a fixed three digits is what this replaces:
 * it called 1,011 to 1,015 "1.01K" four times over and then "1.02K".
 */
export function tickLabels(ticks: readonly number[], locale: string): string[] {
  const digits = ticks.filter((t) => t !== 0 && Number.isFinite(t)).map(digitsOf);
  const significant = Math.min(21, Math.max(1, ...digits.map((d) => d.significant)));
  const decimals = Math.max(0, ...digits.map((d) => d.decimals));
  const spell = (options: Intl.NumberFormatOptions, zero?: string): string[] | null => {
    for (const tag of [locale, 'en']) {
      try {
        const format = new Intl.NumberFormat(tag, options);
        const labels = ticks.map((t) => (t === 0 && zero !== undefined ? zero : format.format(t)));
        // A spelling the reader's browser does not know comes back the same for every tick, or not at all.
        return new Set(labels).size === labels.length && labels.every((l) => l.length > 0) ? labels : null;
      } catch {
        // The page's language is not one Intl can name, or this browser lacks the notation.
      }
    }
    return null;
  };
  const longest = (labels: readonly string[]): number => Math.max(0, ...labels.map((l) => l.length));
  const full = decimals <= 20 ? spell({ maximumFractionDigits: decimals }) : null;
  const withUnit = spell({ notation: 'compact', maximumSignificantDigits: Math.max(3, significant) });
  // The unit earns its place only by making the labels shorter: "5K" for "5,000", but not "299.7924586K" for "299,792.4586".
  let best = withUnit && full ? (longest(withUnit) < longest(full) ? withUnit : full) : (withUnit ?? full);
  if (!best || longest(best) > PLAIN_ENOUGH) {
    const power = spell({ notation: 'scientific', maximumSignificantDigits: significant }, full?.[ticks.indexOf(0)] ?? '0');
    if (power && (!best || longest(power) < longest(best))) best = power;
  }
  // The last resort is the number as the language itself writes it, which is different for different numbers.
  return best ?? ticks.map(String);
}

/**
 * Which of `count` evenly spaced labels to show when each needs `need` pixels and has `room`.
 * The first is always shown, and the last when it does not crowd the one before it.
 */
export function thin(count: number, need: number, room: number): boolean[] {
  const length = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  // A measurement that is not a number asks for nothing to be dropped.
  const stride = Math.max(1, Math.ceil(need / Math.max(1, room))) || 1;
  const show = Array.from({ length }, (_, i) => i % stride === 0);
  if (stride > 1 && length > 1 && !show[length - 1]) {
    const previous = Math.floor((length - 1) / stride) * stride;
    // Give the end of the axis its label, dropping the one before it if the two would collide.
    if (previous !== 0 && length - 1 - previous < stride) show[previous] = false;
    if (previous === 0 && length - 1 < stride) return show;
    show[length - 1] = true;
  }
  return show;
}
