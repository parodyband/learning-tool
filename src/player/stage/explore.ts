// Explore: the learner drives the picture.
//
// After a clip's last beat the stage is handed over: one or two sliders, and every bound part
// follows them. During play the picture is a pure function of time; here it is a pure function of
// the control values. This file is the arithmetic of that and nothing else: it parses the clip's
// formulas once (core/expr.ts: no eval, hard limits), and turns a setting of the controls into the
// number every bound part shows. It touches no DOM, so it runs the same in Node.
//
// Who does what:
//   Explorer (here)        formulas in, numbers out; how each number reads (its rounding); the goal.
//   compile (timeline.ts)  tells the stage, before it is built, what the sliders can reach
//                          (`ExploreEnv`), so a chart picks its scale once and a read-out is sized
//                          for its longest value: nothing re-lays-out while the learner drags.
//   a kit                  draws `apply(t, x)`: the instant t with the learner's numbers `x` in
//                          place of the clip's own. Bars, read-outs and values take theirs from
//                          `x.values`; a curve chart evaluates its curves with `x.env`.
//   mount.ts               the sliders, the goal, and the easing: the control values that are
//                          DRAWN move towards the ones the sliders show over a few frames, so the
//                          picture eases without any part remembering where it was.
import { type Expr, evalExpr, isCondition, parseExpr } from '../../core/expr';

export interface ControlData {
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly unit?: string | undefined;
}
export interface ExploreData {
  readonly prompt: string;
  readonly controls: readonly ControlData[];
  readonly bind?: readonly { readonly target: string; readonly expr: string }[] | undefined;
  readonly goal?: { readonly text: string; readonly when: string; readonly done: string } | undefined;
}

/** A setting of the controls: each control's id and its value. */
export type Env = Readonly<Record<string, number>>;

/**
 * What a formula gives a part: the number, and how it reads (rounded, with separators, no unit).
 * A kit that moves a part to follow a number (a dot group's label) may add where it stands.
 */
export interface Live {
  readonly v: number;
  readonly s: string;
  readonly x?: number;
  readonly y?: number;
}

/** The learner's numbers at one moment. A kit draws them with `apply(t, x)`. */
export interface ExploreState {
  /** The control values being drawn (on their way to what the sliders show). */
  readonly env: Env;
  /** Every bound part's number, by part id. */
  readonly values: ReadonlyMap<string, Live>;
  /** A clock in ms, for the one thing that takes time of its own: a dot crossing from one group to another. */
  readonly now: number;
  /** Reduced motion: nothing travels, everything is where it belongs at once. */
  readonly instant: boolean;
}

/** What the stage is told about the sliders before it is built. */
export interface ExploreEnv {
  readonly controls: readonly ControlData[];
  /** Every control at its starting value: what the beats play with. */
  readonly start: Env;
  /** Settings spread over the whole range of every control, ends included: for choosing a scale that never has to change. */
  readonly grid: readonly Env[];
  /** For each bound part, the numbers its formula gives across the range (more finely than `grid`: every step when there are few). */
  readonly samples: ReadonlyMap<string, readonly number[]>;
  /**
   * For each bound part, how many decimals its number is shown with. A part that will be driven
   * shows its own number the same way while the beats play, so nothing changes shape at the hand-over.
   */
  readonly dp: ReadonlyMap<string, number>;
}

/** Parse a formula that may use only the names in `allowed`. Throws a sentence that names what is wrong. */
export function formula(src: string, what: string, allowed: readonly string[]): Expr {
  const parsed = parseExpr(src);
  if (!parsed.ok) throw new Error(`${what}: ${parsed.message}`);
  const stray = parsed.vars.find((v) => !allowed.includes(v));
  if (stray !== undefined) throw new Error(`${what}: "${stray}" is not a control of this clip${allowed.length ? ` (it has ${allowed.map((a) => `"${a}"`).join(', ')})` : ''}.`);
  return parsed.expr;
}

/** How many digits after the point it takes to write n exactly, up to six. */
export function decimalsOf(n: number): number {
  for (let d = 0; d < 6; d++) if (Math.abs(n * 10 ** d - Math.round(n * 10 ** d)) < 1e-9 * 10 ** d) return d;
  return 6;
}

/** A number as it is shown: `dp` digits after the point, thousands separated. Never "-0". */
export function format(v: number, dp: number): string {
  if (!Number.isFinite(v)) return '–';
  const r = Math.round(v * 10 ** dp) / 10 ** dp;
  return (r === 0 ? 0 : r).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/**
 * Sensible rounding for a number that will be watched while it changes: one set of decimals for
 * the whole range, so the digits tick and the width holds. Whole numbers stay whole; otherwise
 * about three figures.
 */
export function decimalsFor(samples: readonly number[]): number {
  const finite = samples.filter((v) => Number.isFinite(v));
  if (finite.every((v) => Math.abs(v - Math.round(v)) < 1e-9)) return 0;
  const top = Math.max(...finite.map((v) => Math.abs(v)));
  return top >= 100 ? 0 : top >= 10 ? 1 : top >= 0.1 ? 2 : 3;
}

/** The value nearest to v that the slider can show. */
export function snap(c: ControlData, v: number): number {
  const steps = Math.round((Math.min(Math.max(v, c.min), c.max) - c.min) / c.step);
  const dp = Math.max(decimalsOf(c.step), decimalsOf(c.min));
  return Math.min(c.max, Number((c.min + steps * c.step).toFixed(dp)));
}

/** Up to `per` values of a control spread over its range (every step when there are few), with both ends and the start. */
function spread(c: ControlData, per: number): number[] {
  const steps = Math.floor((c.max - c.min) / c.step + 1e-9);
  const out = new Set<number>([c.min, c.max, c.value]);
  if (steps <= per) for (let i = 0; i <= steps; i++) out.add(snap(c, c.min + i * c.step));
  else for (let i = 0; i <= per; i++) out.add(snap(c, c.min + ((c.max - c.min) * i) / per));
  return [...out].sort((a, b) => a - b);
}

/** Settings that cover the range of every control: the product of each control's spread. */
export function controlGrid(controls: readonly ControlData[], per: number): Env[] {
  let out: Record<string, number>[] = [{}];
  for (const c of controls) {
    const next: Record<string, number>[] = [];
    for (const env of out) for (const v of spread(c, per)) next.push({ ...env, [c.id]: v });
    out = next;
  }
  return out;
}

export class Explorer {
  readonly controls: readonly ControlData[];
  readonly start: Env;
  /** Each binding: the part it drives, its formula, and how many decimals its number is shown with. */
  readonly binds: readonly { readonly target: string; readonly expr: Expr; readonly dp: number }[];
  readonly env: ExploreEnv;
  private readonly goal: Expr | null;

  /** Throws an Error whose message names the formula that is wrong. */
  constructor(data: ExploreData) {
    this.controls = data.controls;
    const ids = data.controls.map((c) => c.id);
    for (const c of data.controls) {
      if (ids.filter((id) => id === c.id).length > 1) throw new Error(`explore: two controls share the id "${c.id}".`);
      if (!(c.max > c.min) || !(c.step > 0)) throw new Error(`explore: the control "${c.id}" needs min below max and a step above zero.`);
    }
    this.start = Object.fromEntries(data.controls.map((c) => [c.id, c.value]));
    // Rounding is decided where the slider can actually stand; the scale, over a coarser spread.
    const fine = controlGrid(data.controls, data.controls.length > 1 ? 16 : 60);
    const grid = controlGrid(data.controls, 6);
    const samples = new Map<string, number[]>();
    const seen = new Set<string>();
    this.binds = (data.bind ?? []).map((b) => {
      if (seen.has(b.target)) throw new Error(`explore: "${b.target}" is bound twice.`);
      seen.add(b.target);
      const expr = formula(b.expr, `explore: the formula for "${b.target}"`, ids);
      const values = fine.map((env) => evalExpr(expr, env));
      samples.set(b.target, values);
      return { target: b.target, expr, dp: decimalsFor(values) };
    });
    if (data.goal) {
      this.goal = formula(data.goal.when, 'explore: the goal', ids);
      if (!isCondition(this.goal)) throw new Error('explore: the goal\'s "when" must be a comparison, such as "price > 6".');
    } else this.goal = null;
    this.env = { controls: data.controls, start: this.start, grid, samples, dp: new Map(this.binds.map((b) => [b.target, b.dp])) };
  }

  /** Every bound part's number at a setting of the controls. */
  values(env: Env): Map<string, Live> {
    const out = new Map<string, Live>();
    for (const b of this.binds) {
      const v = evalExpr(b.expr, env);
      out.set(b.target, { v, s: format(v, b.dp) });
    }
    return out;
  }

  /** How each bound part's number reads across the range: what a read-out must have room for. */
  texts(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const b of this.binds) {
      const values = (this.env.samples.get(b.target) ?? []).filter((v) => Number.isFinite(v));
      if (!values.length) continue;
      // The longest strings are at the extremes; the start is there so a width never shrinks under it.
      out.set(b.target, [...new Set([Math.min(...values), Math.max(...values)].map((v) => format(v, b.dp)))]);
    }
    return out;
  }

  /** Whether the goal's condition holds. False when there is no goal. */
  reached(env: Env): boolean {
    return this.goal !== null && evalExpr(this.goal, env) !== 0;
  }

  state(env: Env, now: number, instant: boolean): ExploreState {
    return { env, values: this.values(env), now, instant };
  }
}
