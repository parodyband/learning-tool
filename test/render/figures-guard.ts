// The chart's axis arithmetic, run where it cannot hurt: in a worker with a small heap and a time
// limit. A lesson's numbers once made this code loop without end and fill memory (review finding
// H1), so the tests that feed it hostile numbers never call it in their own process. If it ever
// stops returning again, the worker is ended and the test fails in seconds; a browser is opened on
// such numbers only after this has passed.
//
// Also here: the hostile numbers themselves and the list of things a scale must always be, so the
// unit tests and the browser specs hold the code to the same account.
import { build } from 'esbuild';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

export interface ScaleCase {
  min: number;
  max: number;
  fromZero: boolean;
  target: number;
}

export interface ScaleAnswer {
  lo: number;
  hi: number;
  step: number;
  /** How many ticks the scale has. Only the first `KEPT` are sent back. */
  count: number;
  ticks: number[];
  labels: string[];
}

export type Guarded = { ok: true; answers: ScaleAnswer[]; ms: number; slowest: number } | { ok: false; why: string };

export interface GuardOptions {
  /** The module to run. The default is the player's own. */
  source?: string;
  /** How long the whole batch may take. */
  ms?: number;
  heapMb?: number;
  locale?: string;
}

const ROOT = path.resolve(import.meta.dirname, '../..');
export const SCALE_SOURCE = path.join(ROOT, 'src/player/figures/scale.ts');
/** More ticks than any axis should have; enough to show what went wrong without sending a mountain. */
const KEPT = 64;

const bundles = new Map<string, Promise<string>>();

function bundle(source: string): Promise<string> {
  let made = bundles.get(source);
  if (!made) {
    made = build({ entryPoints: [source], bundle: true, format: 'iife', globalName: '__scale', platform: 'neutral', write: false, logLevel: 'silent' }).then((result) => (result.outputFiles[0] as { text: string }).text);
    bundles.set(source, made);
  }
  return made;
}

const RUNNER = `
const { parentPort, workerData } = require('node:worker_threads');
const answers = [];
let slowest = 0;
for (const c of workerData.cases) {
  const started = performance.now();
  const s = __scale.niceScale(c.min, c.max, c.fromZero, c.target);
  const count = Array.isArray(s.ticks) ? s.ticks.length : -1;
  const ticks = count > ${KEPT} ? s.ticks.slice(0, ${KEPT}) : s.ticks;
  const labels = __scale.tickLabels(ticks, workerData.locale);
  slowest = Math.max(slowest, performance.now() - started);
  answers.push({ lo: s.lo, hi: s.hi, step: s.step, count, ticks, labels });
}
parentPort.postMessage({ answers, slowest });
`;

/** `niceScale` and `tickLabels` for every case, or the reason they did not come back. Never throws, never hangs. */
export async function scaleInWorker(cases: readonly ScaleCase[], opts: GuardOptions = {}): Promise<Guarded> {
  const code = await bundle(opts.source ?? SCALE_SOURCE);
  const limit = opts.ms ?? 10_000;
  const started = performance.now();
  return new Promise<Guarded>((resolve) => {
    const worker = new Worker(`${code}\n${RUNNER}`, {
      eval: true,
      workerData: { cases, locale: opts.locale ?? 'en' },
      resourceLimits: { maxOldGenerationSizeMb: opts.heapMb ?? 64, maxYoungGenerationSizeMb: 16 },
    });
    let settled = false;
    const settle = (answer: Guarded): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(answer);
    };
    const timer = setTimeout(() => settle({ ok: false, why: `did not return within ${limit} ms` }), limit);
    worker.once('message', (message: { answers: ScaleAnswer[]; slowest: number }) => settle({ ok: true, answers: message.answers, ms: performance.now() - started, slowest: message.slowest }));
    worker.once('error', (error: Error & { code?: string }) => settle({ ok: false, why: error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? `ran out of memory (${opts.heapMb ?? 64} MB) after ${Math.round(performance.now() - started)} ms` : `threw: ${error.message}` }));
    worker.once('exit', (exitCode) => settle({ ok: false, why: `the worker ended (${exitCode}) without an answer` }));
  });
}

/** The double next to `x`, `hops` steps away from zero. */
export function beyond(x: number, hops = 1): number {
  const floats = new Float64Array([x]);
  const bits = new BigUint64Array(floats.buffer);
  bits[0] = (bits[0] as bigint) + BigInt(hops);
  return floats[0] as number;
}

/** A deterministic stream of numbers in [0, 1), so a failing case can be found again by its seed. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The pairs the reviewers hung the page with, and their relatives: every way two numbers can be too close, too small or too large. */
export const HOSTILE_PAIRS: readonly (readonly [number, number])[] = [
  // Floating point noise: 0.1 + 0.2 beside 0.3, and its kind.
  [0.3, 0.1 + 0.2],
  [3.3, 1.1 * 3],
  [1, beyond(1)],
  [1, 1 + 1e-13],
  [1, 1 + 1e-11],
  [1, 1 + 1e-10],
  [1, 1 + 1e-9],
  [1, 1 + 1e-8],
  [-1, -beyond(1)],
  [100, beyond(100, 3)],
  // Subnormals: too small to halve or to divide by.
  [-5e-324, 5e-324],
  [0, 5e-324],
  [5e-324, 5e-324],
  [5e-324, 1e-323],
  [1e-310, 3e-310],
  [-3e-310, -1e-310],
  [2.2250738585072014e-308, 4.4501477170144028e-308],
  [5e-324, 1],
  [-1, 5e-324],
  [1e-50, 3e-50],
  [1e-50, 1e-50],
  // The largest values the format allows, and neighbours a hair apart.
  [1e12 - 1e-4, 1e12],
  [beyond(1e12, -1), 1e12],
  [-1e12, beyond(-1e12, -1)],
  [1e12, 1e12],
  [-1e12, -1e12],
  [-1e12, 1e12],
  [123456789012.345, 123456789012.348],
  [999999999999, 1e12],
  // Flat, zero, and both zeros.
  [0, 0],
  [-0, 0],
  [5, 5],
  [-3, -3],
  // Outside the format altogether: a damaged file is still only a file.
  [Number.MIN_VALUE, Number.MAX_VALUE],
  [-Number.MAX_VALUE, Number.MAX_VALUE],
  [Number.MAX_VALUE, Number.MAX_VALUE],
  [1e300, 1e300],
  [1e299, 1e308],
  [2 ** 53, 2 ** 53 + 2],
  [-(2 ** 53), 2 ** 53],
  [Number.NaN, Number.NaN],
  [Number.NaN, 1],
  [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
  [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
  // And ordinary charts, which must come out as they always did.
  [8, 4096],
  [99.8, 100.2],
  [1011, 1015],
  [-31, 14],
];

/** One series of chart values of each kind that has ever gone wrong, by name. */
export function hostileSeries(next: () => number): number[] {
  const length = 2 + Math.floor(next() * 15);
  const sign = next() < 0.3 ? -1 : 1;
  const kind = Math.floor(next() * 9);
  // Sizes from far below the smallest normal number to the largest the format allows.
  const size = sign * 10 ** (next() < 0.25 ? 12 - next() * 3 : next() * 335 - 323);
  const fill = (make: (i: number) => number): number[] => Array.from({ length }, (_, i) => make(i));
  switch (kind) {
    case 0:
      // The same value at every position.
      return fill(() => size);
    case 1:
      // Neighbouring doubles: the next one, or a few further on.
      return fill(() => beyond(size, Math.floor(next() * 4)));
    case 2:
      // Equal to somewhere between the sixth and the sixteenth digit.
      return fill(() => size * (1 + (next() - 0.5) * 10 ** (-6 - next() * 10)));
    case 3:
      // Subnormals of both signs.
      return fill(() => (next() < 0.5 ? -1 : 1) * Math.floor(next() * 1000) * 5e-324);
    case 4:
      // A hair under the limit of the format, on either side of zero.
      return fill(() => (next() < 0.5 ? -1 : 1) * (1e12 - next() * 10 ** (-4 + next() * 8)));
    case 5:
      // A range that lies wholly below zero.
      return fill(() => -Math.abs(size) * (1 + next()));
    case 6:
      // Anything the format allows.
      return fill(() => (next() - 0.5) * 2e12);
    case 7:
      // Everyday values: a few digits, a modest range.
      return fill(() => Math.round(next() * 10 ** Math.floor(next() * 7)) / 10 ** Math.floor(next() * 4));
    default:
      // Sums that should be round and are not quite: 0.1 + 0.2.
      return fill((i) => (i % 2 === 0 ? 0.1 + 0.2 : 0.3) * 10 ** Math.floor(next() * 6 - 3));
  }
}

/** The cases a chart would ask for from a series: bars and lines, and the fewer ticks a narrow column gets. */
export function casesFor(values: readonly number[]): ScaleCase[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return [
    { min, max, fromZero: false, target: 5 },
    { min, max, fromZero: true, target: 5 },
    { min, max, fromZero: true, target: 2 },
  ];
}

/** Every call the player's chart can make for these values: upright as a line or as bars, and as bars on their side at each number of ticks a column can ask for. */
export function casesDrawn(values: readonly number[]): ScaleCase[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return [{ min, max, fromZero: false, target: 5 }, ...[5, 4, 3, 2].map((target) => ({ min, max, fromZero: true, target }))];
}

/**
 * Whether the player a rendered page carries is the build of the source as it is now.
 *
 * The guard above runs the source. A page runs the bundle in src/generated, which is only as new
 * as the last build. A spec that is about to open a page on hostile numbers checks both: the
 * source comes back for them, and the bundle is that source. (The build call is the one in
 * scripts/build.mjs, buildPlayer; if its options change there, they change here.)
 */
export async function playerIsCurrent(): Promise<boolean> {
  const { PLAYER_JS } = await import('../../src/generated/player-assets');
  const built = await build({
    entryPoints: [path.join(ROOT, 'src/player/main.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020', 'safari15'],
    minify: true,
    legalComments: 'none',
    write: false,
    logLevel: 'silent',
  });
  return (built.outputFiles[0] as { text: string }).text === PLAYER_JS;
}

/** What an English tick label says, as a number. Null when it is not a number written one of the three ways a tick may be. */
export function readLabel(label: string): number | null {
  const text = label.replaceAll(',', '');
  const power = /^(-?\d+(?:\.\d+)?)E(-?\d+)$/.exec(text);
  if (power) return Number(`${power[1]}e${power[2]}`);
  const plain = /^(-?\d+(?:\.\d+)?)([KMBT]?)$/.exec(text);
  if (!plain) return null;
  return Number(plain[1]) * ({ '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[plain[2] as string] as number);
}

/** Everything wrong with a scale, in words. Empty when it is sound. `labels` are checked as English ones unless told otherwise. */
export function scaleProblems(c: ScaleCase, a: ScaleAnswer, opts: { english?: boolean } = {}): string[] {
  const out: string[] = [];
  const ticks = a.ticks;
  if (a.count < 2 || a.count > 8) out.push(`${a.count} ticks`);
  if (!ticks.every((t) => Number.isFinite(t))) out.push(`a tick that is not a number: ${ticks.slice(0, 8).join(', ')}`);
  if (ticks.some((t, i) => i > 0 && !(t > (ticks[i - 1] as number)))) out.push(`ticks that do not rise: ${ticks.slice(0, 8).join(', ')}`);
  if (!(a.step > 0) || !Number.isFinite(a.step)) out.push(`step ${a.step}`);
  if (a.lo !== ticks[0] || a.hi !== ticks[ticks.length - 1] || !(a.hi > a.lo)) out.push(`ends ${a.lo}..${a.hi} for ticks ${ticks[0]}..${ticks[ticks.length - 1]}`);
  if (out.length > 0) return out;

  // Round numbers: a step of 1, 2, 2.5 or 5 times a power of ten, and every tick a whole number of steps.
  if (!['1', '2', '2.5', '5'].includes(a.step.toExponential().split('e')[0] as string)) out.push(`step ${a.step} is not round`);
  for (const t of ticks) {
    const q = t / a.step;
    if (Math.abs(q - Math.round(q)) > 1e-9 * Math.max(1, Math.abs(q))) out.push(`tick ${t} is not a multiple of ${a.step}`);
  }
  // The data lies on the axis. Numbers too small to draw count as zero, and ones beyond anything a lesson may hold are not promised.
  const drawn = (v: number): number => (Math.abs(v) < 1e-300 ? 0 : v);
  const given = [c.min, c.max].filter((v) => Number.isFinite(v) && Math.abs(v) <= 1e300).map(drawn);
  const slack = a.step * 1e-3;
  for (const v of given) if (v < a.lo - slack || v > a.hi + slack) out.push(`${v} is off the axis ${a.lo}..${a.hi}`);
  if (c.fromZero && (a.lo > 0 || a.hi < 0)) out.push(`bars need zero on the axis, which runs ${a.lo}..${a.hi}`);

  // The labels: one per tick, all different, short, and each saying exactly what its tick is.
  if (a.labels.length !== ticks.length) out.push(`${a.labels.length} labels for ${ticks.length} ticks`);
  if (new Set(a.labels).size !== a.labels.length) out.push(`labels repeat: ${a.labels.join(' | ')}`);
  // The longest an exact label gets: eleven digits, a point, a sign and "E-300". Other scripts spell the power at more length.
  const longest = opts.english === false ? 28 : 18;
  for (const [i, label] of a.labels.entries()) {
    if (label.length < 1 || label.length > longest) out.push(`label "${label}" is ${label.length} characters`);
    if (opts.english === false) continue;
    const said = readLabel(label);
    const tick = ticks[i] as number;
    if (said === null || Math.abs(said - tick) > 1e-11 * Math.abs(tick)) out.push(`label "${label}" for tick ${tick}`);
  }
  return out;
}
