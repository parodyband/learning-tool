// The picture in the learner's hands: `explore` (sliders, bindings, a goal) and the formulas of a
// curve chart. A clip that fails here would show a slider that moves nothing, a bar that goes
// below its baseline, a curve with a hole in it, or a goal that is already met or can never be.
//
// Nothing is run that the page does not run: every formula is parsed and evaluated by core/expr,
// the same module the player bundles, and it is tried here over the whole range of the controls
// before the clip is accepted. What "the whole range" means:
//
//   one control    every position when the slider has at most LIMITS.explore.settingsPerControl
//                  steps; otherwise that many evenly spaced positions, both ends included.
//   two controls   the grid of both, each thinned evenly until the grid has at most
//                  LIMITS.explore.settings settings.
//   always         the starting values, first.
//   a curve        LIMITS.explore.curveSamples evenly spaced x, both ends of the axis included, at
//                  each of those settings.
//   a goal         every setting when there are at most GOAL_SETTINGS of them (a goal may hold in
//                  a band narrower than the gaps of the sample above), otherwise an even grid of
//                  that size.
//
// The first setting at which something fails is named in the issue: "At rate = 0, ...".
import { BINDABLE, type ClipScene, type Control, type Stage } from '../clip';
import { EXPR_CONSTANTS, EXPR_FUNCTIONS, EXPR_HELP, evalExpr, isCondition, parseExpr, type Expr } from '../expr';
import { issue } from '../issues';
import { LIMITS as L } from '../limits';
import type { Issue } from '../types';
import { onlyNearest, show } from './shape';
import { aPart, kindsText, runStage, stageKey, stageName, type PartKind, type StagePart, type StageRun } from './stage';

/** A goal is tried at every setting up to this many; past it, at an even grid of this size. */
export const GOAL_SETTINGS = 20_000;

type Env = Record<string, number>;

// ---------------------------------------------------------------------------------------------
// Formulas
// ---------------------------------------------------------------------------------------------

interface Formula {
  /** Where it is written: "explore.bind[0].expr". */
  path: string;
  src: string;
  /** What to call it: 'the binding of "share"', 'the curve "demand"'. */
  what: string;
  /** May it use `x`: only a curve's `expr`. */
  curve: boolean;
  /** Parsed, and every name it uses is one it may use. */
  expr?: Expr;
}

/** A formula as it may be shown back: it has parsed and names only what it may, so it is numbers, operators and declared names. */
const shown = (src: string): string => src.replace(/\s+/g, ' ').trim();

/** A parser message with anything long in quotation marks cut short: an issue never carries a stretch of what was sent. */
function parserMessage(message: string): string {
  return message
    .replace(EXPR_HELP, '')
    .replace(/"([^"]{25,})"/g, (_all, inner: string) => `"${inner.slice(0, 12)}…"`)
    .trim();
}

/** What most often goes wrong in a formula written from habit, by what the source contains. */
function formulaHint(src: string): string {
  if (src.includes('**')) return 'Write a power with "^": x^2, not x ** 2. ';
  if (/&&|\|\||!(?!=)/.test(src)) return 'Join conditions with the words and, or, not: "a > 1 and b < 2". ';
  if (/\bMath\s*\./.test(src)) return 'Leave out "Math.": a function is called by its bare name, as in sqrt(x). ';
  if (/[?:]/.test(src)) return 'There is no "? :": write if(condition, then, otherwise). ';
  if (/(^|[^<>=!])=($|[^=])/.test(src)) return 'A formula is only the right-hand side: leave out "y =". To compare, write "==". ';
  if (src.includes('%')) return 'There is no "%": write a percentage as a number (5% is 0.05), or divide by 100. ';
  if (/\bpow\s*\(/.test(src)) return 'There is no pow(): write a power with "^", as in x^2. ';
  if (/\blog\s*\(/.test(src)) return 'There is no log(): use ln (natural), log2 or log10. ';
  if (/[×·÷−]/.test(src)) return 'Use * for times, / for divided by and - for minus. ';
  if (/[0-9)]\s*[A-Za-z(]/.test(src)) return 'Write every multiplication with "*": 2*x and 2*(x + 1), not 2x or 2(x + 1). ';
  if (/[0-9],[0-9]/.test(src)) return 'Write a decimal with a point: 0.5, not 0,5. ';
  return '';
}

/**
 * Parse every formula and hold each to the names it may use: the ids of the clip's controls, and
 * `x` in a curve's `expr` only. A formula that fails either way is reported and left without
 * `expr`, so nothing downstream evaluates it.
 */
function readFormulas(formulas: Formula[], controls: readonly string[], hasExplore: boolean, partKind: (id: string) => PartKind | undefined, out: Issue[]): void {
  for (const f of formulas) {
    const parsed = parseExpr(f.src);
    if (!parsed.ok) {
      out.push(
        issue('FORMULA_SYNTAX', f.path, `The formula of ${f.what} cannot be read at character ${parsed.at + 1}: ${parserMessage(parsed.message)}`, {
          fix: `${formulaHint(f.src)}${EXPR_HELP}`,
        }),
      );
      continue;
    }
    const allowed = f.curve ? [...controls, 'x'] : [...controls];
    const unknown = parsed.vars.filter((name) => !allowed.includes(name));
    if (unknown.length === 0) {
      f.expr = parsed.expr;
      continue;
    }
    const names = unknown.map((name) => `"${show(name)}"`).join(', ');
    const may = controls.length ? `the control id${controls.length === 1 ? '' : 's'} ${controls.join(', ')}${f.curve ? ', and x' : ''}` : f.curve ? 'x' : 'no name at all (the clip has no control)';
    const constants = ` The constants ${Object.keys(EXPR_CONSTANTS).join(' and ')} and the functions (${Object.keys(EXPR_FUNCTIONS).join(', ')}) are always there.`;
    let message: string;
    let fix: string;
    const first = unknown[0] as string;
    const part = unknown.map((name) => ({ name, kind: partKind(name) })).find((x) => x.kind !== undefined);
    if (!f.curve && unknown.length === 1 && first === 'x') {
      message = `The formula of ${f.what} uses "x", but x is the position along a curve's x axis: only a curve's "expr" may use it.`;
      fix = `Write this formula from ${controls.length ? `the control ids (${controls.join(', ')})` : 'numbers'} alone.${controls.length ? '' : ' To let the learner change a quantity, declare it as a control in "explore.controls" and use its id.'}`;
    } else if (!hasExplore) {
      message = `The formula of ${f.what} uses ${names}, but this clip has no "explore", so nothing gives ${unknown.length === 1 ? 'that name' : 'those names'} a value.`;
      fix = `Add "explore" to the clip with a control whose "id" is ${unknown.length === 1 ? `"${show(first)}"` : `each of ${names}`} (the learner drags it and the curve follows), or write a number in its place. Without controls a curve's formula may use x only.${constants}`;
    } else {
      const guess = unknown.length === 1 ? onlyNearest(first, allowed) : null;
      message = `The formula of ${f.what} uses ${names}, which ${unknown.length === 1 ? 'is not a control' : 'are not controls'} of this clip.`;
      fix = `${guess ? `Use "${guess}". ` : ''}A formula here may use ${may}.${part ? ` "${show(part.name)}" is ${aPart(part.kind as PartKind)} of the stage, and a formula cannot read a part: write the quantity from the controls and numbers.` : ''}${constants}`;
    }
    out.push(issue('FORMULA_UNKNOWN_NAME', f.path, message, { fix, got: unknown.map((name) => show(name)).join(', '), expected: allowed.length ? `only ${allowed.join(', ')}` : 'numbers only' }));
  }
}

// ---------------------------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------------------------

const whole = (q: number): boolean => Math.abs(q - Math.round(q)) <= 1e-7 * Math.max(1, Math.abs(q));

/** Decimal places of a number as it is written, so that a slider position is the clean number the page gets from a range input. */
function decimals(n: number): number {
  const text = String(n);
  const [mantissa = '', exponent] = text.split('e-');
  const own = mantissa.split('.')[1]?.length ?? 0;
  return Math.min(12, exponent === undefined ? own : own + Number(exponent));
}

/** The value of a control at position `i` (0 is `min`). */
function position(c: Control, i: number): number {
  return Number((c.min + i * c.step).toFixed(Math.max(decimals(c.min), decimals(c.step))));
}

const steps = (c: Control): number => Math.round((c.max - c.min) / c.step);

/** A number as a message shows it. */
function num(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return String(Number(n.toPrecision(8)));
}

function controlIssues(controls: readonly Control[], used: (id: string) => boolean): { issues: Issue[]; sane: boolean } {
  const issues: Issue[] = [];
  let sane = true;
  const seen = new Map<string, number>();
  controls.forEach((c, i) => {
    const p = `explore.controls[${i}]`;
    const first = seen.get(c.id);
    if (first !== undefined) {
      sane = false;
      issues.push(
        issue('CONTROL_DUPLICATE_ID', `${p}.id`, `Two controls have the id "${c.id}" (explore.controls[${first}] and explore.controls[${i}]).`, {
          fix: 'Give each control its own id: the id is the name a formula calls it by.',
          got: c.id,
        }),
      );
      return;
    }
    seen.set(c.id, i);

    const range = (path: string, message: string, fix: string, got: number, expected?: string): void => {
      sane = false;
      issues.push(issue('CONTROL_RANGE', `${p}.${path}`, `The control "${c.id}": ${message}`, { fix, got: num(got), ...(expected !== undefined ? { expected } : {}) }));
    };
    const count = (c.max - c.min) / c.step;
    if (!(c.min < c.max)) {
      range('max', `"min" is ${num(c.min)} and "max" is ${num(c.max)}, so the slider has no room to move.`, 'Set "min" below "max": the two ends of what the learner may drag between.', c.max, `more than ${num(c.min)}`);
    } else if (count > L.explore.steps + 1e-7) {
      const least = (c.max - c.min) / L.explore.steps;
      range('step', `a step of ${num(c.step)} gives ${num(Math.round(count))} steps from ${num(c.min)} to ${num(c.max)}; a slider has at most ${L.explore.steps}.`, `Use a "step" of at least ${num(least)}, or narrow the range. A learner cannot tell positions that fine apart.`, c.step, `at least ${num(least)}`);
    } else if (!whole(count)) {
      const reach = position(c, Math.floor(count + 1e-7));
      range('step', `the range from ${num(c.min)} to ${num(c.max)} is not a whole number of steps of ${num(c.step)}, so the slider could never reach "max".`, `Set "max" to ${num(reach)}, or choose a "step" that divides ${num(c.max - c.min)}.`, c.step);
    } else if (c.value < c.min || c.value > c.max) {
      range('value', `it starts at ${num(c.value)}, outside its range of ${num(c.min)} to ${num(c.max)}.`, `Set "value" (where the slider starts, and what the clip's beats play with) between ${num(c.min)} and ${num(c.max)}.`, c.value, `${num(c.min)} to ${num(c.max)}`);
    } else if (!whole((c.value - c.min) / c.step)) {
      const below = position(c, Math.floor((c.value - c.min) / c.step));
      const above = position(c, Math.floor((c.value - c.min) / c.step) + 1);
      range('value', `it starts at ${num(c.value)}, which is between two steps (the slider moves by ${num(c.step)} from ${num(c.min)}).`, `Start it on a step: ${num(below)} or ${num(above)} are the nearest.`, c.value, `${num(below)} or ${num(above)}`);
    }

    if (!used(c.id)) {
      issues.push(
        issue('CONTROL_UNUSED', `${p}.id`, `No binding, curve, point or goal uses the control "${c.id}": dragging it would change nothing.`, {
          fix: `Use "${c.id}" in a formula (a binding's "expr", a curve's "expr", a point's "x" or the goal's "when"), or remove the control.`,
          got: c.id,
        }),
      );
    }
  });
  return { issues, sane };
}

// ---------------------------------------------------------------------------------------------
// Settings: the positions of the sliders that are tried
// ---------------------------------------------------------------------------------------------

/** `k` positions spread evenly over 0..n, both ends included (all of them when there are no more than k). */
function spread(n: number, k: number): number[] {
  if (n + 1 <= k) return Array.from({ length: n + 1 }, (_, i) => i);
  const out: number[] = [];
  for (let j = 0; j < k; j++) {
    const i = Math.round((j * n) / (k - 1));
    if (out[out.length - 1] !== i) out.push(i);
  }
  return out;
}

/** The positions tried on each control, so that the grid of all of them has at most `most` settings. */
function sample(controls: readonly Control[], perControl: number, most: number): number[][] {
  const lists = controls.map((c) => spread(steps(c), perControl));
  if (lists.length < 2) return lists;
  const [a, b] = lists as [number[], number[]];
  if (a.length * b.length <= most) return lists;
  const side = Math.floor(Math.sqrt(most));
  const want = a.length <= side ? [a.length, Math.floor(most / a.length)] : b.length <= side ? [Math.floor(most / b.length), b.length] : [side, side];
  return [spread(steps(controls[0] as Control), want[0] as number), spread(steps(controls[1] as Control), want[1] as number)];
}

/** Call `visit` with each setting of the grid in turn (the first control slowest) until it returns false. */
function eachSetting(controls: readonly Control[], lists: readonly number[][], visit: (env: Env) => boolean): void {
  const env: Env = {};
  if (controls.length === 0) {
    visit(env);
    return;
  }
  const [first, second] = controls as [Control, Control | undefined];
  for (const i of lists[0] as number[]) {
    env[first.id] = position(first, i);
    if (!second) {
      if (!visit(env)) return;
      continue;
    }
    for (const j of lists[1] as number[]) {
      env[second.id] = position(second, j);
      if (!visit(env)) return;
    }
  }
}

/** "rate = 0 and size = 40", with x last when a curve is being walked. */
function settingText(controls: readonly Control[], env: Env, x?: number): string {
  const parts = controls.map((c) => `${c.id} = ${num(env[c.id] as number)}`);
  if (x !== undefined) parts.push(`x = ${num(x)}`);
  return parts.join(' and ');
}

// ---------------------------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------------------------

const BINDABLE_NOTE = 'What a binding may drive: a read-out ("stats") on any stage that has them, a bar of a bars chart, a group of dots that a split created and no merge has taken, a value beside a line. On a curve chart the curves and points need no binding: their formulas name the controls.';

interface Bound {
  index: number;
  target: string;
  kind: PartKind;
}

/** Each binding's target: a part of the stage, of a kind that can follow a control there, bound once. Returns the bindings that are sound. */
function bindingTargets(scene: ClipScene, parts: readonly StagePart[], run: StageRun, out: Issue[]): Bound[] {
  const stage = scene.stage;
  const name = stageName(stage);
  const allowed = (BINDABLE[stageKey(stage)] ?? []) as readonly PartKind[];
  const byId = new Map<string, StagePart>();
  for (const part of parts) if (!byId.has(part.id)) byId.set(part.id, part);
  const kindOf = (id: string): PartKind | undefined => (run.groups.has(id) ? 'group' : byId.get(id)?.kind);
  const boundable = (id: string): boolean => {
    const group = run.groups.get(id);
    return group ? group.made === 'split' && group.from !== undefined && group.mergedInto === undefined : allowed.includes(byId.get(id)?.kind as PartKind);
  };
  const candidates = [...parts.map((part) => part.id), ...[...run.groups.keys()].filter((id) => !byId.has(id))].filter(boundable);
  const can = candidates.length ? `On this stage a binding can drive: ${candidates.join(', ')}.` : `Nothing on this ${name} stage can follow a control${stage.kind === 'frame' ? ' (a frame has its own sliders, "params")' : stage.kind === 'dots' ? ' yet: split the dots into groups first' : ': give the stage a read-out ("stats") and bind that'}.`;

  const sound: Bound[] = [];
  const first = new Map<string, number>();
  (scene.explore?.bind ?? []).forEach((binding, i) => {
    const p = `explore.bind[${i}].target`;
    const id = binding.target;
    const kind = kindOf(id);
    if (kind === undefined) {
      const guess = onlyNearest(id, candidates);
      out.push(issue('BINDING_UNKNOWN_TARGET', p, `This binding drives "${id}", which is not a part of this ${name} stage.`, { fix: `${guess ? `Use "${guess}". ` : ''}${can}`, got: id }));
      return;
    }
    const group = run.groups.get(id);
    if (group) {
      const why =
        group.made === 'start'
          ? 'is the group every dot starts in: it is every dot there is, and holds what the bound groups do not take'
          : group.made === 'merge'
            ? 'was made by a merge, so there is no group it was split from to trade dots with'
            : group.mergedInto !== undefined
              ? `was merged into "${group.mergedInto}" before the clip ended, so it is no longer a group of its own`
              : group.from === undefined
                ? 'was not split from a group that was on stage'
                : null;
      if (why !== null) {
        out.push(issue('BINDING_NOT_BINDABLE', p, `This binding drives the group "${id}", which ${why}.`, { fix: `Bind a group that a split created and that no merge has taken by the last beat: what it does not take stays in the group it was split from. ${can}`, got: id }));
        return;
      }
    } else if (!allowed.includes(kind)) {
      out.push(
        issue('BINDING_NOT_BINDABLE', p, `This binding drives "${id}", which is ${aPart(kind)}; on a ${name} stage a binding drives ${allowed.length ? kindsText(allowed) : 'nothing'}.`, {
          fix: `${can} ${BINDABLE_NOTE}`,
          got: id,
          ...(allowed.length ? { expected: kindsText(allowed) } : {}),
        }),
      );
      return;
    }
    const before = first.get(id);
    if (before !== undefined) {
      out.push(issue('BINDING_DUPLICATE', p, `explore.bind[${before}] and explore.bind[${i}] both drive "${id}".`, { fix: `Keep one binding for "${id}": one formula says what it shows. To combine two quantities, write them into one formula.`, got: id }));
      return;
    }
    first.set(id, i);
    sound.push({ index: i, target: id, kind });
  });
  return sound;
}

// ---------------------------------------------------------------------------------------------
// The whole of it
// ---------------------------------------------------------------------------------------------

/**
 * Everything about `explore` and about the formulas of a curve chart: formulas that parse and name
 * only what they may, controls that make a slider, bindings that drive something bindable, values
 * that stay finite and inside their limits at every setting tried, a goal that is a condition, not
 * yet met and reachable, and a stage that says honestly that its numbers are not a passage's.
 */
export function exploreIssues(scene: ClipScene, parts: readonly StagePart[]): Issue[] {
  const out: Issue[] = [];
  const stage: Stage = scene.stage;
  const explore = scene.explore;
  const curveChart = stage.kind === 'chart' && stage.mark === 'curve' ? stage : null;
  if (!explore && !curveChart) return out;

  // ----- honesty: a picture the learner can drag, or one drawn from a formula, is not a passage's numbers
  if (curveChart && stage.provenance === 'sourced') {
    out.push(
      issue('CURVE_SOURCED', 'stage.provenance', 'This curve chart is marked "sourced", but a curve is drawn from a formula: what it shows at each x is your working, not a number a passage states.', {
        fix: `Set "provenance" to "worked" and keep "cites"${stage.cites.length ? ` (${stage.cites.join(', ')})` : ''}: the passages then say where the rule behind the formula comes from. If only the shape matters, set it to "illustrative".`,
        got: 'sourced',
        expected: '"worked" or "illustrative"',
      }),
    );
  } else if (explore && stage.provenance === 'sourced') {
    out.push(
      issue('EXPLORE_ON_SOURCED_STAGE', 'stage.provenance', 'This clip has an "explore", but its stage is marked "sourced": as soon as the learner drags a control, the stage shows numbers that no passage contains.', {
        fix: `Mark the stage as a worked example: set "provenance" to "worked" and keep its "cites"${stage.cites.length ? ` (${stage.cites.join(', ')})` : ''}, which still say where the rule comes from. A stage the learner can drag is never "sourced".`,
        got: 'sourced',
        expected: '"worked" or "illustrative"',
      }),
    );
  }

  // ----- formulas
  const controls = explore?.controls ?? [];
  const ids = controls.map((c) => c.id);
  const partKinds = new Map(parts.map((part) => [part.id, part.kind] as const));
  const run = runStage(scene, parts);
  const partKind = (id: string): PartKind | undefined => (run.groups.has(id) ? 'group' : partKinds.get(id));

  const curves: Formula[] = (curveChart?.curves ?? []).map((curve, i) => ({ path: `stage.curves[${i}].expr`, src: curve.expr, what: `the curve "${curve.id}"`, curve: true }));
  const points: Formula[] = (curveChart?.points ?? []).map((point, i) => ({ path: `stage.points[${i}].x`, src: point.x, what: `the point "${point.id}" (its "x")`, curve: false }));
  const binds: Formula[] = (explore?.bind ?? []).map((binding, i) => ({ path: `explore.bind[${i}].expr`, src: binding.expr, what: `the binding of "${binding.target}"`, curve: false }));
  const goal: Formula | null = explore?.goal ? { path: 'explore.goal.when', src: explore.goal.when, what: 'the goal ("when")', curve: false } : null;
  const formulas = [...curves, ...points, ...binds, ...(goal ? [goal] : [])];
  readFormulas(formulas, ids, explore !== undefined, partKind, out);

  // ----- controls, and that something answers them
  /** A control is used when a formula names it: read from the source, so a formula that does not parse still counts. */
  const mentions = (list: readonly Formula[], id: string): boolean => list.some((f) => new RegExp(`(^|[^A-Za-z0-9_])${id}($|[^A-Za-z0-9_])`).test(f.src));
  const checked = controlIssues(controls, (id) => mentions(formulas, id));
  out.push(...checked.issues);
  const sound = explore ? bindingTargets(scene, parts, run, out) : [];
  if (explore && explore.bind.length === 0 && !ids.some((id) => mentions([...curves, ...points], id))) {
    const what = curveChart ? 'no binding, and no curve or point of the chart names a control' : 'no binding';
    const how =
      stage.kind === 'frame'
        ? 'A frame cannot be explored this way: its own sliders are "params", read by its code. Remove "explore".'
        : curveChart
          ? `Use a control id (${ids.join(', ')}) in a curve's "expr" or a point's "x", so the curve bends as the learner drags; or bind a read-out in "explore.bind".`
          : `Add to "explore.bind" at least one { "target", "expr" } that ties a part of the stage to ${ids.length === 1 ? `"${ids[0]}"` : 'the controls'}. ${BINDABLE_NOTE}`;
    out.push(issue('EXPLORE_NOTHING_RESPONDS', 'explore.bind', `This explore has ${what}, so nothing on the stage would follow the ${ids.length === 1 ? 'slider' : 'sliders'}.`, { fix: how }));
  }

  // ----- the goal is a condition
  if (goal?.expr && !isCondition(goal.expr)) {
    out.push(
      issue('GOAL_NOT_CONDITION', goal.path, `The goal's "when" (${shown(goal.src)}) works out to a number, not to true or false, so the player cannot tell when it is reached.`, {
        fix: `Write it as a comparison of what the learner should bring about, such as "${shown(goal.src)} >= ..." or "abs(a - b) < 1", joined with and / or when it has two parts.`,
      }),
    );
    delete goal.expr;
  }

  // ----- trying it: every setting the sample holds
  if (!checked.sane) return out;
  const lists = sample(controls, L.explore.settingsPerControl, L.explore.settings);
  const start: Env = Object.fromEntries(controls.map((c) => [c.id, c.value]));
  const at = (env: Env, x?: number): string => {
    if (controls.length === 0) return x === undefined ? 'As written' : `At x = ${num(x)}`;
    const starting = controls.every((c) => env[c.id] === c.value);
    return starting ? `At the starting ${controls.length === 1 ? 'value' : 'values'} (${settingText(controls, env, x)})` : `At ${settingText(controls, env, x)}`;
  };

  interface Trial {
    /** Returns an issue when this setting fails, and is then not tried again. */
    try(env: Env): Issue | null;
    done?: boolean;
  }
  const trials: Trial[] = [];
  const notFinite = (f: Formula, where: string, extra = ''): Issue =>
    issue('FORMULA_NOT_FINITE', f.path, `${where}, ${shown(f.src)} is not finite${extra}.`, {
      fix: `Change the formula, or the range of a control, so that ${f.what} has a value at every setting the learner can reach. A division by zero, the logarithm of zero or less and the root of a negative number have none; if(condition, then, otherwise) steps round a single bad point, and max(...) keeps a divisor away from zero.`,
    });

  // Bindings: finite, and a bar or a group of dots within what it can show.
  const boundExprs = new Map<number, Expr>();
  for (const b of sound) {
    const f = binds[b.index] as Formula;
    if (!f.expr) continue;
    const expr = f.expr;
    boundExprs.set(b.index, expr);
    const top = stage.kind === 'chart' && stage.mark === 'bars' ? stage.max : undefined;
    trials.push({
      try: (env) => {
        const v = evalExpr(expr, env);
        if (!Number.isFinite(v)) return notFinite(f, at(env));
        if ((b.kind === 'bar' || b.kind === 'group') && v < -1e-9) {
          return issue('BINDING_OUT_OF_RANGE', f.path, `${at(env)}, the binding of "${b.target}" (${shown(f.src)}) is ${num(v)}: ${b.kind === 'bar' ? 'a bar grows from zero and cannot be negative' : 'a group cannot hold fewer than no dots'}.`, {
            fix: `Change the formula or the range of a control so that it is never below zero: max(0, ...) holds it there.${b.kind === 'bar' ? ' A quantity that goes below zero belongs on a curve chart.' : ''}`,
            got: num(v),
            expected: 'zero or more',
          });
        }
        if (b.kind === 'bar' && top !== undefined && v > top + 1e-9) {
          return issue('BINDING_OUT_OF_RANGE', f.path, `${at(env)}, the binding of "${b.target}" (${shown(f.src)}) is ${num(v)}, above the top of the value axis ("max": ${num(top)}): the bar would be cut off.`, {
            fix: `Raise the stage's "max" to at least what the bar can reach, remove "max" and let the stage choose the scale, or hold the formula down with min(..., ${num(top)}).`,
            got: num(v),
            expected: `at most ${num(top)}`,
          });
        }
        return null;
      },
    });
  }
  // Dots: in every split, the groups that are given a number never need more dots than the group
  // they were split from holds at that setting. The tree of splits is walked from the top exactly
  // as the stage walks it (src/player/stage/kit-dots.ts `resolve`), so a group whose own count
  // follows a formula is the room its parts are held to.
  const boundGroups = new Map<string, { expr: Expr; index: number }>();
  for (const b of sound) if (b.kind === 'group' && boundExprs.has(b.index)) boundGroups.set(b.target, { expr: boundExprs.get(b.index) as Expr, index: b.index });
  if (boundGroups.size > 0) {
    const tree = [...run.groups];
    const authored = (id: string): number => run.groups.get(id)?.count ?? 0;
    const largest = (ids: readonly string[]): string => ids.reduce((m, id) => (authored(id) > authored(m) ? id : m), ids[0] as string);
    trials.push({
      try: (env) => {
        // What each group asks for: its formula, or (with no formula of its own) the sum of its parts when every part asks.
        const asks = new Map<string, { raw: number; whole: number } | undefined>();
        const ask = (id: string): { raw: number; whole: number } | undefined => {
          if (asks.has(id)) return asks.get(id);
          let v: { raw: number; whole: number } | undefined;
          const b = boundGroups.get(id);
          const kids = run.groups.get(id)?.kids;
          if (b) {
            const value = evalExpr(b.expr, env);
            const raw = Number.isFinite(value) ? Math.max(0, value) : 0;
            v = { raw, whole: Math.round(raw) };
          } else if (kids && kids.length > 0) {
            let sum: { raw: number; whole: number } | undefined = { raw: 0, whole: 0 };
            for (const kid of kids) {
              const w = ask(kid);
              sum = w === undefined || sum === undefined ? undefined : { raw: sum.raw + w.raw, whole: sum.whole + w.whole };
            }
            v = sum;
          }
          asks.set(id, v);
          return v;
        };
        const count = new Map<string, number>();
        for (const [id, group] of tree) {
          if (group.made === 'start') count.set(id, group.count);
          if (group.sources) count.set(id, group.sources.reduce((n, source) => n + (count.get(source) ?? 0), 0));
          const kids = group.kids;
          if (!kids || kids.length === 0) continue;
          const room = count.get(id) ?? 0;
          let left = room;
          let need = 0;
          const takers: string[] = [];
          const free: string[] = [];
          for (const kid of kids) {
            const w = ask(kid);
            if (w === undefined) {
              free.push(kid);
              continue;
            }
            need += w.raw;
            takers.push(kid);
            const c = Math.min(w.whole, left);
            count.set(kid, c);
            left -= c;
          }
          // Half a dot of slack: the stage rounds each count, and a sum that is exact before rounding is not too much.
          if (need > room + 0.5) {
            // The binding to point at: the first part of this split that has one, itself or below it.
            const below = (start: string): { index: number } | undefined => {
              const own = boundGroups.get(start);
              if (own) return own;
              for (const kid of run.groups.get(start)?.kids ?? []) {
                const found = below(kid);
                if (found) return found;
              }
              return undefined;
            };
            const at0 = takers.map(below).find((b) => b !== undefined) as { index: number };
            const f = binds[at0.index] as Formula;
            const who = takers.length === 1 ? `"${takers[0]}" needs ${num(need)} dots` : `${takers.map((t) => `"${t}"`).join(' and ')} need ${num(need)} dots between them`;
            return issue('BINDING_OUT_OF_RANGE', f.path, `${at(env)}, ${who}, but "${id}", the group ${takers.length === 1 ? 'it was' : 'they were'} split from, holds only ${num(room)}${boundGroups.has(id) || group.made !== 'start' ? ' at that setting' : ''}.`, {
              fix: `A bound group takes its dots from the group it was split from, so ${takers.length === 1 ? 'it' : 'together they'} can never hold more than that group does. Write the formula${takers.length === 1 ? '' : 's'} as a share of it, narrow the range of a control, or hold the value down with min(..., ${num(room)}).`,
              got: num(need),
              expected: `at most ${num(room)}`,
            });
          }
          if (free.length > 0) {
            // What the bound parts do not take stays with the rest, in the proportions they were written with.
            const weight = free.reduce((n, kid) => n + authored(kid), 0) || free.length;
            const big = largest(free);
            let given = 0;
            for (const kid of free) {
              if (kid === big) continue;
              const c = Math.floor((left * (authored(kid) || 1)) / weight);
              count.set(kid, c);
              given += c;
            }
            count.set(big, left - given);
          } else if (left > 0) {
            const big = largest(kids);
            count.set(big, (count.get(big) ?? 0) + left);
          }
        }
        return null;
      },
    });
  }

  // Curves: finite all the way along the axis. Points: on the axis, and on a curve that has a value there.
  if (curveChart && curveChart.x.min < curveChart.x.max) {
    const { min, max } = curveChart.x;
    const n = L.explore.curveSamples;
    const xs = Array.from({ length: n }, (_, j) => (j === n - 1 ? max : min + ((max - min) * j) / (n - 1)));
    const walk: Env = {};
    curves.forEach((f) => {
      if (!f.expr) return;
      const expr = f.expr;
      trials.push({
        try: (env) => {
          Object.assign(walk, env);
          for (const x of xs) {
            walk.x = x;
            if (!Number.isFinite(evalExpr(expr, walk))) return notFinite(f, at(env, x));
          }
          return null;
        },
      });
    });
    points.forEach((f, i) => {
      if (!f.expr) return;
      const expr = f.expr;
      const point = (curveChart.points ?? [])[i] as { id: string; on?: string | undefined };
      const rides = point.on === undefined ? 0 : curveChart.curves.findIndex((c) => c.id === point.on);
      const curve = rides === -1 ? undefined : curves[rides];
      trials.push({
        try: (env) => {
          const x = evalExpr(expr, env);
          if (!Number.isFinite(x)) return notFinite(f, at(env));
          if (x < min - 1e-9 || x > max + 1e-9) {
            return issue('POINT_OFF_AXIS', f.path, `${at(env)}, the point "${point.id}" is at x = ${num(x)} (${shown(f.src)}), off the x axis, which runs from ${num(min)} to ${num(max)}.`, {
              fix: `Keep the point on the axis at every setting: clamp(${shown(f.src)}, ${num(min)}, ${num(max)}) holds it at the ends, or widen the axis ("x.min", "x.max"), or narrow the range of a control.`,
              got: num(x),
              expected: `${num(min)} to ${num(max)}`,
            });
          }
          if (curve?.expr) {
            Object.assign(walk, env);
            walk.x = x;
            const y = evalExpr(curve.expr, walk);
            if (!Number.isFinite(y)) return notFinite(curve, at(env, x), `, so the point "${point.id}" has nowhere to sit`);
            // The plot is clipped to a value axis the stage fixes: a point beyond it is not drawn at all.
            const over = curveChart.max !== undefined && y > curveChart.max + 1e-9;
            const under = curveChart.min !== undefined && y < curveChart.min - 1e-9;
            if (over || under) {
              const edge = over ? `above the top of the value axis ("max": ${num(curveChart.max as number)})` : `below the bottom of the value axis ("min": ${num(curveChart.min as number)})`;
              return issue('POINT_OFF_AXIS', f.path, `${at(env)}, the point "${point.id}" sits at ${num(y)} on its curve, ${edge}, where nothing is drawn.`, {
                fix: `${over ? 'Raise "max"' : 'Lower "min"'} of the stage to take in what the curve reaches where the point sits, or remove it and let the stage choose the scale from the curves.`,
                got: num(y),
                expected: over ? `at most ${num(curveChart.max as number)}` : `at least ${num(curveChart.min as number)}`,
              });
            }
          }
          return null;
        },
      });
    });
  }

  let open = trials.length;
  const attempt = (env: Env): boolean => {
    for (const trial of trials) {
      if (trial.done) continue;
      const found = trial.try(env);
      if (!found) continue;
      out.push(found);
      trial.done = true;
      open--;
    }
    return open > 0;
  };
  if (open > 0 && attempt(start) && controls.length > 0) eachSetting(controls, lists, attempt);

  // ----- the goal: not yet met, and within reach
  if (goal?.expr) {
    const when = goal.expr;
    const dense = sample(controls, GOAL_SETTINGS, GOAL_SETTINGS);
    let tried = 0;
    let reached: string | null = null;
    let unmet: string | null = null;
    eachSetting(controls, dense, (env) => {
      tried++;
      if (evalExpr(when, env) !== 0) reached ??= settingText(controls, env);
      else unmet ??= settingText(controls, env);
      return reached === null || unmet === null;
    });
    if (evalExpr(when, start) !== 0) {
      out.push(
        issue('GOAL_ALREADY_MET', goal.path, `The goal (${shown(goal.src)}) already holds at the starting ${controls.length === 1 ? 'value' : 'values'} (${settingText(controls, start)}), so the learner would have nothing to do.`, {
          fix: `Start the controls ("value") where the goal does not hold yet${unmet !== null ? `: it is false at ${unmet}, for one` : ''}, or ask for something the starting picture does not already show. The beats of the clip play at the starting values.`,
        }),
      );
    } else if (reached === null) {
      const exact = /==/.test(goal.src) ? ' An exact "==" between worked-out numbers rarely holds: use abs(a - b) < a small tolerance.' : '';
      out.push(
        issue('GOAL_UNREACHABLE', goal.path, `The goal (${shown(goal.src)}) holds at none of the ${tried === 1 ? 'settings' : `${tried} settings`} the learner can reach${controls.length ? ` (${controls.map((c) => `${c.id} from ${num(c.min)} to ${num(c.max)}`).join(', ')})` : ''}.`, {
          fix: `Loosen the condition or widen the range of a control, so that at least one position of the ${controls.length === 1 ? 'slider' : 'sliders'} satisfies it.${exact}`,
        }),
      );
    } else {
      // Reachable, and not yet met. But a goal that an end of the slider satisfies asks for a sweep, not for a thought:
      // one control at its min or its max, two controls at one of their four corners.
      const ends = controls.map((c) => [c.min, c.max]);
      const corners: Env[] = ends.reduce<Env[]>((all, pair, k) => all.flatMap((env) => pair.map((v) => ({ ...env, [(controls[k] as Control).id]: v }))), [{}]);
      const corner = corners.find((env) => evalExpr(when, env) !== 0);
      if (corner) {
        const where = controls.map((c) => `"${c.id}" at its ${corner[c.id] === c.max ? 'largest' : 'smallest'}`).join(' and ');
        out.push(
          issue('GOAL_AT_END', goal.path, `The goal (${shown(goal.src)}) holds with ${where} (${settingText(controls, corner)}): the learner reaches it by dragging ${controls.length === 1 ? 'the slider to its end' : 'both sliders to an end'}, without having to find anything.`, {
            fix: `Move the tipping point inside the range, so that neither end satisfies the goal and the learner has to find where it turns (a balance such as abs(a - b) < a small tolerance, or a band: "at least this and at most that"), or narrow the range of ${controls.length === 1 ? `"${(controls[0] as Control).id}"` : 'a control'} so that it stops short of the goal on that side.`,
          }),
        );
      }
    }
  }
  return out;
}
