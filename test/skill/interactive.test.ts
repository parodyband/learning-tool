// What the skill teaches about the interactive shapes (an explore with its sliders, bindings and
// goal; formulas; a curve chart; a tap gate), held to the code that decides it.
//
// Three kinds of check:
//   1. Every formula in every clip the skill shows is parsed by the real parser and evaluated at
//      every setting its sliders can reach. A worked example that an agent copies must not carry a
//      formula that fails at an end of its range.
//   2. The worked clips are held to the craft rules the skill gives and no tool checks: a goal that
//      neither end of a slider reaches, a picture that does not jump when the sliders appear.
//   3. What the references say the tools refuse (and what they say the tools do not catch) is
//      tried against the real validator.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Binding, ClipScene, Stage } from '../../src/core/clip';
import { evalExpr, parseExpr } from '../../src/core/expr';
import { DEPTHS, LIMITS as L } from '../../src/core/limits';
import type { Draft, LessonReport, SceneCheck } from '../../src/core/types';
import { draftAround, exampleClipDraft } from './drafts';
import { CLIP_DESIGN_MD, cornersOf, formulaTrials, goalOf, markedExamples, read, rel, ROOT, settingsOf, skillFiles, startOf } from './helpers';
import { evidenceFor, TYPED } from './worked';

type Loose = Record<string, any>;
type Env = Record<string, number>;

const squash = (s: string): string => s.replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------------------------
// clip-design.md: learn by doing is the spine, and each new thing has its craft
// ---------------------------------------------------------------------------------------------

describe('clip-design.md is built around what the learner does', () => {
  const raw = read(CLIP_DESIGN_MD);
  const text = squash(raw);
  const headings = raw.split('\n').filter((line) => line.startsWith('## ')).map((line) => line.slice(3));
  const section = (heading: string): string => {
    const from = raw.indexOf(`\n## ${heading}\n`);
    if (from === -1) throw new Error(`clip-design.md has no section "${heading}"`);
    const to = raw.indexOf('\n## ', from + 4);
    return squash(raw.slice(from, to === -1 ? undefined : to));
  };

  it('opens with the philosophy, before stages and beats, and gives each interactive shape a section', () => {
    expect(headings[0]).toBe('Learn by doing');
    for (const heading of ['Storyboard first', 'Choosing the stage', 'Predictions: a choice or a tap', 'Explore: hand over the system', 'Formulas', 'Curve charts', 'Honesty of the picture', 'Checkpoints', 'Worked examples', 'Failure modes', 'Before you submit']) expect(headings, heading).toContain(heading);
    const at = (heading: string): number => headings.indexOf(heading);
    expect(at('Learn by doing')).toBeLessThan(at('Choosing the stage'));
    expect(at('Predictions: a choice or a tap')).toBeLessThan(at('Explore: hand over the system'));
    expect(at('Explore: hand over the system')).toBeLessThan(at('Formulas'));
  });

  it('gives the six moves, each with its reason', () => {
    const spine = section('Learn by doing');
    for (const move of ['Open on something to work out.', 'Make them commit before the outcome plays.', 'Where the idea is a relationship between quantities, hand over the system.', 'Explain after, naming what they just saw.', 'Concrete before abstract.', 'Small steps.']) expect(spine, move).toContain(`**${move}**`);
    expect(spine).toContain('Count the people before writing the formula.');
    // The evidence for acting first, and for a goal on what is explored.
    for (const key of ['[CR04]', '[BR21]', '[LOW04]', '[ALF11]']) expect(spine).toContain(key);
    for (const key of ['ALF11', 'BR21', 'CR04', 'LOW04', 'BB16', 'PBB21', 'PS13', 'BAR']) expect(raw, key).toMatch(new RegExp(`^- \\[${key}\\] .+https://`, 'm'));
    // Every key the page uses is in its list of sources.
    for (const used of new Set([...raw.matchAll(/\[([A-Z]{2,6}\d{0,2})\]/g)].map((m) => m[1]!))) expect(raw, used).toMatch(new RegExp(`^- \\[${used}\\] `, 'm'));
  });

  it('puts what the learner does into the storyboard, before the picture', () => {
    const storyboard = section('Storyboard first');
    expect(storyboard).toMatch(/2\. \*\*What the learner does\*\*: predicts, taps, or drags towards a goal\. Decide it before the picture/);
    expect(storyboard.indexOf('What the learner does')).toBeLessThan(storyboard.indexOf('**The stage**'));
  });

  it('shows a weak and a strong version of an explore, of a goal and of a tap gate', () => {
    const explore = section('Explore: hand over the system');
    const rows = (within: string, label: string): number => within.split(`| ${label} |`).length - 1;
    expect(rows(explore, 'Weak')).toBeGreaterThanOrEqual(3);
    expect(rows(explore, 'Strong')).toBeGreaterThanOrEqual(3);
    expect(explore).toContain('"Set the rate to 10%."');
    expect(explore).toContain('"Make a positive result more likely right than wrong."');
    const gates = section('Predictions: a choice or a tap');
    expect(gates).toContain('| Weak tap |');
    expect(gates).toContain('| Strong tap |');
  });

  it('says when a relationship deserves an explore and when it does not', () => {
    const explore = section('Explore: hand over the system');
    expect(explore).toMatch(/\*\*Does this relationship deserve one\?\*\* Yes, when quantities depend on each other/);
    expect(explore).toMatch(/No, when the content is a list of facts, a chain of events or a definition\. Those have nothing to drag/);
    expect(explore).toMatch(/a slider invented for its own sake/);
    expect(explore).toMatch(/\*\*Explore last\.\*\*/);
    expect(explore).toMatch(/Name an outcome, never the setting\./);
    expect(explore).toMatch(/\*\*`done` says why that worked\*\*/);
  });

  it('keeps the honesty rule: an explored stage is never sourced, and the captions still carry the cited facts', () => {
    const honesty = section('Honesty of the picture');
    expect(honesty).toMatch(/\*\*A stage the learner can drag is never `sourced`\*\*, and nor is a curve chart/);
    expect(honesty).toMatch(/The cited facts stay where they were, in the captions of the beats before the explore/);
  });

  it('names the failure modes of an interactive lesson, each with its counter-rule', () => {
    const failures = section('Failure modes');
    for (const failure of [
      'A slider that changes nothing the learner can see',
      'A goal reachable by dragging to the end',
      'A goal that restates a number',
      'An explore before the learner knows the parts',
      'Interactivity as decoration',
      'A tap gate with one obviously highlighted part',
    ]) {
      const row = failures.split(' | ').length > 0 ? failures.slice(failures.indexOf(`| ${failure} |`)) : '';
      expect(failures, failure).toContain(`| ${failure} |`);
      // What it looks like, and what to do instead: two more cells with something in them.
      const cells = row.split('|').slice(1, 4).map((cell) => cell.trim());
      expect(cells.every((cell) => cell.length > 15), failure).toBe(true);
    }
  });

  it('asks about the action, the ends of the sliders and `done` before a clip is submitted', () => {
    const list = section('Before you submit');
    expect(list).toMatch(/What does the learner do in it, and do they do it before I explain\?/);
    expect(list).toMatch(/have I worked every formula at both ends and at the start, does the goal fail at both ends, and does `done` say why\?/);
    expect(list).toMatch(/does anything give a tap away\?/);
  });
});

// ---------------------------------------------------------------------------------------------
// Every clip and every curve chart the skill shows
// ---------------------------------------------------------------------------------------------

const SCENES = skillFiles()
  .flatMap((file) => markedExamples(file))
  .filter((ex) => ex.kind === 'scene')
  .map((ex) => ({ at: `${rel(ex.file)}:${ex.line}`, value: JSON.parse(ex.json) as Loose }))
  .filter(({ value }) => value.kind === 'clip')
  .map(({ at, value }) => ({ at, clip: ClipScene.parse(value) }));

const isCurve = (clip: ClipScene): boolean => clip.stage.kind === 'chart' && clip.stage.mark === 'curve';
/** The clips with something to evaluate: an explore, or curves drawn from formulas. */
const WITH_FORMULAS = SCENES.filter(({ clip }) => clip.explore !== undefined || isCurve(clip));
const EXPLORED = WITH_FORMULAS.filter(({ clip }) => clip.explore !== undefined);

/** A curve chart shown on its own (format.md): a clip around it, so the same trial runs. */
const CURVE_STAGES = skillFiles()
  .flatMap((file) => markedExamples(file))
  .filter((ex) => ex.kind === 'stage')
  .map((ex) => ({ at: `${rel(ex.file)}:${ex.line}`, stage: Stage.parse(JSON.parse(ex.json)) }))
  .filter(({ stage }) => stage.kind === 'chart' && stage.mark === 'curve')
  .map(({ at, stage }) => ({ at, clip: { id: 'curve-stage', stage, beats: [], explore: undefined } as unknown as ClipScene }));

const each = <T extends { at: string; clip: ClipScene }>(list: T[]) => list.map((item) => [`${item.clip.id} (${item.at})`, item.clip] as const);

/** The number each part shows once the last beat has played: what a binding takes over from. */
function leftOnStage(clip: ClipScene): Map<string, number> {
  const out = new Map<string, number>();
  const stage = clip.stage;
  if (stage.kind !== 'words' && stage.kind !== 'frame') for (const stat of stage.stats ?? []) if (typeof stat.value === 'number') out.set(stat.id, stat.value);
  if (stage.kind === 'chart' && stage.mark === 'bars') for (const bar of stage.bars) out.set(bar.id, bar.value);
  if (stage.kind === 'dots') out.set(stage.group.id, stage.total);
  for (const beat of clip.beats) {
    for (const action of beat.do) {
      if (action.verb === 'split') for (const group of action.into) out.set(group.id, group.count);
      if (action.verb === 'set' && typeof action.value === 'number') for (const id of action.targets ?? (action.target ? [action.target] : [])) out.set(id, action.value);
    }
  }
  return out;
}

/** Dots: for each group a split made, the group it was split from and how many that group held. */
function splitFamilies(clip: ClipScene): Map<string, { from: string; room: number }> {
  const out = new Map<string, { from: string; room: number }>();
  if (clip.stage.kind !== 'dots') return out;
  const count = new Map<string, number>([[clip.stage.group.id, clip.stage.total]]);
  for (const beat of clip.beats) {
    for (const action of beat.do) {
      if (action.verb !== 'split') continue;
      const room = count.get(action.target) ?? 0;
      for (const group of action.into) {
        count.set(group.id, group.count);
        out.set(group.id, { from: action.target, room });
      }
    }
  }
  return out;
}

const value = (src: string, env: Env): number => {
  const parsed = parseExpr(src);
  if (!parsed.ok) throw new Error(`${src}: ${parsed.message}`);
  return evalExpr(parsed.expr, env);
};

describe('a binding written in a sentence', () => {
  // `{ "target": "hits", "expr": "round(8 * rate)" }`: what an agent copies from prose must be a binding too.
  const inline = skillFiles().flatMap((file) => [...read(file).matchAll(/`(\{ "target": [^`]*\})`/g)].map((m) => ({ at: rel(file), json: m[1]! })));

  it('there is one, so the check below is not vacuous', () => expect(inline.length).toBeGreaterThan(0));

  it.each(inline.map((b) => [b.json, b.at] as const))('%s (%s) is a binding whose formula parses', (json) => {
    const binding = Binding.parse(JSON.parse(json));
    expect(parseExpr(binding.expr).ok).toBe(true);
  });
});

describe('the formulas of every clip the skill shows', () => {
  it('there are clips with an explore on dots, on bars and on a curve chart, and a curve chart on its own', () => {
    const stages = EXPLORED.map(({ clip }) => (clip.stage.kind === 'chart' ? `chart.${clip.stage.mark}` : clip.stage.kind));
    expect(new Set(stages)).toEqual(new Set(['dots', 'chart.bars', 'chart.curve']));
    expect(CURVE_STAGES.length).toBeGreaterThan(0);
  });

  it.each(each([...WITH_FORMULAS, ...CURVE_STAGES]))('%s: every formula parses, names only what it may, and is finite at every setting', (_name, clip) => {
    const trials = formulaTrials(clip);
    expect(trials.length).toBeGreaterThan(0);
    expect(trials.filter((trial) => trial.problem !== undefined).map((trial) => `${trial.path} (${trial.src}): ${trial.problem}`)).toEqual([]);
    for (const trial of trials) {
      expect(trial.values.length, trial.path).toBeGreaterThan(0);
      expect(trial.values.filter((v) => !Number.isFinite(v)), `${trial.path}: ${trial.src}`).toEqual([]);
    }
  });

  it.each(each(EXPLORED))('%s: every control is named by a formula, and its numbers make a slider', (_name, clip) => {
    const sources = formulaTrials(clip).map((trial) => trial.src);
    for (const control of clip.explore!.controls) {
      expect(sources.some((src) => new RegExp(`(^|[^A-Za-z0-9_])${control.id}($|[^A-Za-z0-9_])`).test(src)), control.id).toBe(true);
      const steps = (control.max - control.min) / control.step;
      expect(control.min).toBeLessThan(control.max);
      expect(Math.abs(steps - Math.round(steps)), 'a whole number of steps').toBeLessThan(1e-9);
      expect(steps).toBeLessThanOrEqual(L.explore.steps);
      const at = (control.value - control.min) / control.step;
      expect(Math.abs(at - Math.round(at)), 'it starts on a step').toBeLessThan(1e-9);
      expect(control.value).toBeGreaterThanOrEqual(control.min);
      expect(control.value).toBeLessThanOrEqual(control.max);
    }
  });

  it.each(each(EXPLORED))('%s: a bound bar or group is never negative, and the groups of one split never outgrow it', (_name, clip) => {
    const stage = clip.stage;
    const settings = settingsOf(clip);
    const families = splitFamilies(clip);
    const bars = stage.kind === 'chart' && stage.mark === 'bars' ? new Set(stage.bars.map((bar) => bar.id)) : new Set<string>();
    const amounts = clip.explore!.bind.filter((binding) => bars.has(binding.target) || families.has(binding.target));
    for (const binding of amounts) for (const env of settings) expect(value(binding.expr, env), `${binding.target} at ${JSON.stringify(env)}`).toBeGreaterThanOrEqual(0);
    const parents = new Set(amounts.flatMap((binding) => (families.has(binding.target) ? [families.get(binding.target)!.from] : [])));
    for (const parent of parents) {
      const members = amounts.filter((binding) => families.get(binding.target)?.from === parent);
      const room = families.get(members[0]!.target)!.room;
      for (const env of settings) expect(members.reduce((sum, binding) => sum + value(binding.expr, env), 0), `groups split from ${parent} at ${JSON.stringify(env)}`).toBeLessThanOrEqual(room);
    }
    if (stage.kind === 'chart' && stage.mark === 'bars' && stage.max !== undefined) for (const binding of amounts) for (const env of settings) expect(value(binding.expr, env)).toBeLessThanOrEqual(stage.max);
  });

  it.each(each([...WITH_FORMULAS, ...CURVE_STAGES].filter(({ clip }) => isCurve(clip))))('%s: every marked point stays on the x axis', (_name, clip) => {
    if (clip.stage.kind !== 'chart' || clip.stage.mark !== 'curve') return;
    const { min, max } = clip.stage.x;
    expect(min).toBeLessThan(max);
    for (const point of clip.stage.points ?? []) {
      for (const env of settingsOf(clip)) {
        const x = value(point.x, env);
        expect(x, `${point.id} at ${JSON.stringify(env)}`).toBeGreaterThanOrEqual(min);
        expect(x, `${point.id} at ${JSON.stringify(env)}`).toBeLessThanOrEqual(max);
      }
      if (point.on !== undefined) expect(clip.stage.curves.map((curve) => curve.id)).toContain(point.on);
    }
  });

  it.each(each(EXPLORED.filter(({ clip }) => clip.explore!.goal !== undefined)))('%s: the goal is a condition, not met at the start, and within reach', (_name, clip) => {
    const when = goalOf(clip);
    expect(evalExpr(when, startOf(clip))).toBe(0);
    expect(settingsOf(clip).some((env) => evalExpr(when, env) !== 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The craft the skill asks for and no tool checks, on the skill's own worked clips
// ---------------------------------------------------------------------------------------------

describe('the worked clips follow the skill\'s own rules for an explore', () => {
  const explored = TYPED.filter((h) => h.clip.explore !== undefined).map((h) => [h.clip.id, h.clip] as const);

  it('there are three of them', () => expect(explored.map(([id]) => id).sort()).toEqual(['crowd', 'grow', 'market']));

  // "If an end of a slider satisfies the goal, the learner reaches it by sweeping the slider across."
  it.each(explored)('%s: no end of a slider, and no corner of two, reaches the goal', (_id, clip) => {
    const when = goalOf(clip);
    for (const env of cornersOf(clip)) expect(evalExpr(when, env), JSON.stringify(env)).toBe(0);
    // With two sliders, each one swept across on its own does not reach it either.
    const start = startOf(clip);
    for (const control of clip.explore!.controls) for (const end of [control.min, control.max]) expect(evalExpr(when, { ...start, [control.id]: end }), `${control.id} = ${end}`).toBe(0);
  });

  // "Start where the clip ended. At the starting values every formula must give the number already on stage."
  it.each(explored)('%s: at the starting values every binding gives the number the beats left on stage', (_id, clip) => {
    const left = leftOnStage(clip);
    const start = startOf(clip);
    for (const binding of clip.explore!.bind) {
      expect(left.has(binding.target), `"${binding.target}" has a number on stage`).toBe(true);
      expect(value(binding.expr, start), binding.target).toBeCloseTo(left.get(binding.target)!, 9);
    }
  });

  // "Set `min` and `max` so that something happens inside the range."
  it.each(explored)('%s: the goal is first reached well inside the range of a slider', (_id, clip) => {
    const when = goalOf(clip);
    const reached = settingsOf(clip).filter((env) => evalExpr(when, env) !== 0);
    for (const control of clip.explore!.controls) {
      const at = reached.map((env) => (env[control.id]! - control.min) / (control.max - control.min));
      expect(Math.min(...at), control.id).toBeGreaterThan(0.1);
      expect(Math.max(...at), control.id).toBeLessThanOrEqual(1);
    }
  });

  // "Name an outcome, never the setting", and "a number of two or more digits there must be in a
  // stored passage or be a slider's own min, max or value".
  it.each(explored)('%s: the goal names no setting, and its words carry no number that is not a slider\'s own', (_id, clip) => {
    const explore = clip.explore!;
    const goal = explore.goal!;
    expect(goal.text).not.toMatch(/\d/);
    for (const control of explore.controls) expect(goal.text.toLowerCase()).not.toContain(control.label.toLowerCase());
    const own = new Set(explore.controls.flatMap((control) => [control.min, control.max, control.value]).map(String));
    for (const text of [explore.prompt, goal.text, goal.done]) for (const found of text.match(/\d[\d,.]*\d/g) ?? []) expect(own.has(found.replace(/,/g, '')), `${found} in "${text}"`).toBe(true);
    // `done` explains; it does not congratulate.
    expect(goal.done).not.toMatch(/well done|correct|great|congratulations/i);
    expect(goal.done.split(/\s+/).length).toBeGreaterThan(8);
  });

  // "Ten to fifty steps is plenty. Give the slider a plain label and a unit."
  it.each(explored)('%s: a slider has between ten and fifty steps or so', (_id, clip) => {
    for (const control of clip.explore!.controls) {
      const steps = Math.round((control.max - control.min) / control.step);
      expect(steps).toBeGreaterThanOrEqual(10);
      expect(steps).toBeLessThanOrEqual(64);
    }
  });

  it('what clip-design.md says about its own examples is true of them', () => {
    const text = squash(read(CLIP_DESIGN_MD));
    const crowd = TYPED.find((h) => h.clip.id === 'crowd')!.clip;
    // "At `rate` 1 they give 8, 95 and 8%, exactly what the beats left on stage."
    expect(text).toContain('At `rate` 1 they give 8, 95 and 8%, exactly what the beats left on stage.');
    expect(crowd.explore!.bind.map((binding) => value(binding.expr, { rate: 1 }))).toEqual([8, 95, 8]);
    // "The goal holds at 10 and 11 only, and at neither end."
    expect(text).toContain('The goal holds at 10 and 11 only, and at neither end.');
    const when = goalOf(crowd);
    expect(settingsOf(crowd).filter((env) => evalExpr(when, env) !== 0).map((env) => env.rate)).toEqual([10, 11]);
    // The formulas are the cited facts: 8 in 10 found, 95 of every 990 others alarmed.
    expect(text).toContain('`10 * rate` women in 1,000 have cancer, the test finds 8 in 10 of them and alarms 95 of every 990 others');
    expect(crowd.explore!.bind[0]!.expr).toBe('round(0.8 * 10 * rate)');
    expect(crowd.explore!.bind[1]!.expr).toBe('round((1000 - 10 * rate) * 95 / 990)');

    const market = TYPED.find((h) => h.clip.id === 'market')!.clip;
    // "More buyers alone raise the price and more sellers alone lower it; the goal needs both."
    expect(text).toContain('More buyers alone raise the price and more sellers alone lower it; the goal needs both');
    if (market.stage.kind !== 'chart' || market.stage.mark !== 'curve') throw new Error('"market" is not a curve chart');
    const price = (env: Env): number => value(market.stage.kind === 'chart' && market.stage.mark === 'curve' ? market.stage.points![0]!.x : '0', env);
    expect(price({ buyers: 150, sellers: 100 })).toBeGreaterThan(price({ buyers: 100, sellers: 100 }));
    expect(price({ buyers: 100, sellers: 160 })).toBeLessThan(price({ buyers: 100, sellers: 100 }));
    // The marked point is where the two curves cross, at every setting.
    const [demand, supply] = market.stage.curves;
    for (const env of settingsOf(market)) expect(value(demand!.expr, { ...env, x: price(env) })).toBeCloseTo(value(supply!.expr, { ...env, x: price(env) }), 9);
    // "Each slider tilts one curve and leaves the other still to compare against."
    expect(demand!.expr).toContain('buyers');
    expect(demand!.expr).not.toContain('sellers');
    expect(supply!.expr).toContain('sellers');
    expect(supply!.expr).not.toContain('buyers');
  });
});

// ---------------------------------------------------------------------------------------------
// What the references say the tools refuse, and what they say the tools do not catch
// ---------------------------------------------------------------------------------------------

describe('what the references say the tools do with an explore, a formula and a tap gate', async () => {
  const validate = (await import(/* @vite-ignore */ path.join(ROOT, 'src/core/validate')).catch(() => null)) as { checkScene?: (input: unknown, draft: Draft) => SceneCheck; checkLesson?: (draft: Draft) => LessonReport } | null;
  const issues = (await import(/* @vite-ignore */ path.join(ROOT, 'src/core/issues')).catch(() => null)) as { ISSUES?: Record<string, unknown> } | null;
  const checkScene = validate?.checkScene ?? null;
  // The validator learns these shapes in the same round as this skill; until its catalog has their codes there is nothing to ask it.
  const knows = Boolean(checkScene && issues?.ISSUES && 'FORMULA_SYNTAX' in issues.ISSUES && 'PICK_UNKNOWN_PART' in issues.ISSUES);

  const base = (id: string): { clip: Loose; draft: Draft } => {
    const { clip } = TYPED.find((h) => h.clip.id === id)!;
    return { clip: structuredClone(clip) as unknown as Loose, draft: draftAround(clip, evidenceFor(clip)) };
  };
  const after = (id: string, change: (clip: Loose) => void): { errors: string[]; all: string[] } => {
    const { clip, draft } = base(id);
    change(clip);
    const check = checkScene!(clip, draft);
    return { errors: check.errors.map((e) => e.code), all: [...check.errors, ...check.warnings].map((i) => `${i.code} ${i.path}`) };
  };
  const tapGate = (clip: Loose): Loose => (clip.beats as Loose[]).find((beat) => beat.gate && 'pick' in beat.gate)!.gate;

  // [what the reference says, the worked clip it is tried on, the change, the code it must be refused with]
  const refused: Array<[string, string, (clip: Loose) => void, string]> = [
    ['`**` for a power', 'crowd', (c) => (c.explore.bind[0].expr = 'round(8 * rate ** 1)'), 'FORMULA_SYNTAX'],
    ['a missing `*`', 'crowd', (c) => (c.explore.bind[0].expr = 'round(8rate)'), 'FORMULA_SYNTAX'],
    ['a `%` sign', 'crowd', (c) => (c.explore.bind[0].expr = 'round(1000 * rate% * 0.8)'), 'FORMULA_SYNTAX'],
    ['a name that is another part, not a control', 'crowd', (c) => (c.explore.bind[2].expr = 'round(100 * hits / (hits + alarms))'), 'FORMULA_UNKNOWN_NAME'],
    ['`x` in the formula of a point', 'market', (c) => (c.stage.points[0].x = 'x / 2'), 'FORMULA_UNKNOWN_NAME'],
    [
      'dividing by a control that can reach zero',
      'crowd',
      (c) => {
        c.explore.controls[0].min = 0;
        c.explore.bind[2].expr = '800 / rate';
      },
      'FORMULA_NOT_FINITE',
    ],
    ['a goal that is a quantity', 'crowd', (c) => (c.explore.goal.when = '8 * rate'), 'GOAL_NOT_CONDITION'],
    ['a goal that is met at the start', 'crowd', (c) => (c.explore.goal.when = 'rate >= 1'), 'GOAL_ALREADY_MET'],
    ['a goal that is never met', 'crowd', (c) => (c.explore.goal.when = 'rate > 99'), 'GOAL_UNREACHABLE'],
    ['a control that nothing uses', 'crowd', (c) => c.explore.controls.push({ id: 'spare', label: 'Spare', min: 0, max: 10, step: 1, value: 0 }), 'CONTROL_UNUSED'],
    [
      'an explore in which nothing on the stage answers',
      'grow',
      (c) => {
        c.explore.bind = [];
      },
      'EXPLORE_NOTHING_RESPONDS',
    ],
    ['a negative bar', 'grow', (c) => (c.explore.bind[0].expr = 'items - 10'), 'BINDING_OUT_OF_RANGE'],
    ['a bound bar that passes the stage\'s `max`', 'grow', (c) => (c.stage.max = 50), 'BINDING_OUT_OF_RANGE'],
    ['a negative group', 'crowd', (c) => (c.explore.bind[1].expr = 'round(95 - 10 * rate)'), 'BINDING_OUT_OF_RANGE'],
    ['groups that outgrow the group they were split from', 'crowd', (c) => (c.explore.bind[0].expr = 'round(40 * rate)'), 'BINDING_OUT_OF_RANGE'],
    ['a marked point that leaves the axis', 'market', (c) => (c.stage.points[0].x = '20 * buyers / (buyers + sellers)'), 'POINT_OFF_AXIS'],
    ['an explore on a stage marked sourced', 'crowd', (c) => (c.stage.provenance = 'sourced'), 'EXPLORE_ON_SOURCED_STAGE'],
    ['a curve chart marked sourced', 'market', (c) => (c.stage.provenance = 'sourced'), 'CURVE_SOURCED'],
    ['a binding on the group every dot starts in', 'crowd', (c) => (c.explore.bind[0].target = 'all'), 'BINDING_NOT_BINDABLE'],
    ['a binding on something that is not a part', 'grow', (c) => (c.explore.bind[0].target = 'ghost'), 'BINDING_UNKNOWN_TARGET'],
    ['a part bound twice', 'grow', (c) => c.explore.bind.push({ target: 'lin', expr: 'items + 1' }), 'BINDING_DUPLICATE'],
    ['a range that is not a whole number of steps', 'grow', (c) => (c.explore.controls[0].step = 5), 'CONTROL_RANGE'],
    ['a starting value between two steps', 'grow', (c) => (c.explore.controls[0].value = 8.5), 'CONTROL_RANGE'],
    [`more than ${L.explore.steps.toLocaleString('en-US')} steps`, 'grow', (c) => (c.explore.controls[0].step = 0.01), 'CONTROL_RANGE'],
    ['a number in the words of an explore that is neither in the picture nor in a passage', 'crowd', (c) => (c.explore.goal.text = 'Set the rate to 25%.'), 'NUMBER_UNGROUNDED'],
    ['a tap on something that is not a part', 'next', (c) => (tapGate(c).pick = ['c9']), 'PICK_UNKNOWN_PART'],
    ['a tap on a pointer', 'next', (c) => (tapGate(c).pick = ['mid']), 'PICK_NOT_TAPPABLE'],
    [
      'a tap gate in which every part on stage is right',
      'next',
      (c) => {
        // Three cells, and all three count as right.
        const gate = { ...tapGate(c), pick: ['c4', 'c5', 'c6'] };
        c.stage.cells = c.stage.cells.slice(4);
        c.beats = [
          { caption: c.beats[0].caption, do: [{ verb: 'move', target: 'mid', to: 'c4' }] },
          { caption: c.beats[1].caption, gate, do: [{ verb: 'move', target: 'mid', to: 'c5' }] },
        ];
      },
      'PICK_NO_WRONG_PART',
    ],
    ['a tap on a part that is not on stage when the gate opens', 'next', (c) => c.beats[2].do.push({ verb: 'show', target: 'c5' }), 'PICK_NOT_ON_STAGE'],
    ['a number in the words of a tap gate that is neither in the picture nor in a passage', 'next', (c) => (tapGate(c).wrong = 'Not that one: fewer than 77 looks are needed.'), 'NUMBER_UNGROUNDED'],
  ];

  it.skipIf(!knows).each(refused)('refuses %s', (_what, id, change, code) => {
    expect(after(id, change).errors).toContain(code);
  });

  it.skipIf(!knows)('the worked clips these are tried on are accepted as they stand', () => {
    for (const id of new Set(refused.map(([, id]) => id))) expect(after(id, () => undefined).all, id).toEqual([]);
  });

  // "`if(rate > 0, hits / rate, 0)`, since `if` works out only the branch it takes."
  it.skipIf(!knows)('accepts the same division once `if` steps round the bad point', () => {
    const found = after('crowd', (c) => {
      c.explore.controls[0].min = 0;
      c.explore.bind[2].expr = 'if(rate > 0, 800 / rate, 0)';
    });
    expect(found.errors).not.toContain('FORMULA_NOT_FINITE');
  });

  // "A number of two or more digits must be one the picture already holds (on the stage, an end or
  // the start of a slider, a number in a formula) or be in a stored passage."
  it.skipIf(!knows)('lets the words of an explore and of a tap gate name a number the picture holds, or one a stored passage holds', () => {
    const slider = after('crowd', (c) => (c.explore.prompt = 'Drag from 1 up to 30. Watch the two positive groups.'));
    expect(slider.errors).not.toContain('NUMBER_UNGROUNDED');
    const onStage = after('crowd', (c) => (c.explore.goal.done = 'The 95 false alarms have shrunk and the true positives have caught up with them.'));
    expect(onStage.errors).not.toContain('NUMBER_UNGROUNDED');
    const stored = after('crowd', (c) => (c.explore.goal.done = 'Now far more than 10 women in every 1,000 have cancer, so true positives have caught up.'));
    expect(stored.errors).not.toContain('NUMBER_UNGROUNDED');
    const tap = after('next', (c) => (tapGate(c).wrong = 'The search cannot see where 42 is. Which look rules out the most?'));
    expect(tap.errors).not.toContain('NUMBER_UNGROUNDED');
  });

  // sourcing.md: "nothing is checked inside ... a checkpoint, a gate with options".
  it.skipIf(!knows)('does not check the numbers in a gate answered by options', () => {
    const options = after('grow', (c) => (c.beats[1].gate.prompt = 'Suppose the list had 77 items. Would binary search need more than 7 comparisons?'));
    expect(options.errors).not.toContain('NUMBER_UNGROUNDED');
    expect(squash(read(path.join(path.dirname(CLIP_DESIGN_MD), 'sourcing.md')))).toContain('a tap gate or an explore may name a number its clip\'s picture holds');
  });

  // "They warn about a goal that an end of the slider satisfies (`GOAL_AT_END`). They do not catch a
  // starting value that differs from what the last beat left on stage: that is the one you are
  // looking for."
  it.skipIf(!knows)('warns about a goal that the far end satisfies, and does not catch a picture that jumps when the sliders appear', () => {
    const jumps = after('crowd', (c) => (c.explore.bind[0].expr = 'round(9 * rate)'));
    expect(jumps.all).toEqual([]);
    const sweep = after('crowd', (c) => (c.explore.goal.when = '8 * rate > (1000 - 10 * rate) * 95 / 990'));
    expect(sweep.errors).toEqual([]);
    expect(sweep.all).toEqual(['GOAL_AT_END explore.goal.when']);
    const text = squash(read(CLIP_DESIGN_MD));
    expect(text).toContain('They warn about a goal that an end of the slider satisfies (`GOAL_AT_END`). They do not catch a starting value that differs from what the last beat left on stage: that is the one you are looking for.');
    expect(text).toContain('The tools check that `when` is false at the start and true somewhere.');
  });

  // The lesson as a whole: "The tools refuse a lesson in which fewer than two thirds of the clips
  // do, and warn about a standard or deep lesson with no `explore` anywhere."
  const checkLesson = validate?.checkLesson ?? null;
  const knowsLesson = Boolean(knows && checkLesson && issues?.ISSUES && 'INTERACTIVE_SHARE' in issues.ISSUES && 'NO_EXPLORE' in issues.ISSUES);
  const clipsOf = (draft: Draft): Loose[] => (draft.scenes as unknown as Loose[]).filter((scene) => scene.kind === 'clip');

  it.skipIf(!knowsLesson)('refuses a lesson in which too few clips ask the learner to do anything', () => {
    const draft = exampleClipDraft();
    for (const clip of clipsOf(draft)) {
      delete clip.explore;
      for (const beat of clip.beats as Loose[]) delete beat.gate;
    }
    expect(checkLesson!(draft).errors.map((e) => e.code)).toContain('INTERACTIVE_SHARE');
    // With a gate or an explore in every clip, that error is gone.
    const acting = exampleClipDraft();
    for (const clip of clipsOf(acting)) if (!clip.explore && !(clip.beats as Loose[]).some((beat) => beat.gate)) (clip.beats as Loose[])[1]!.gate = { prompt: 'What happens next?', options: [{ text: 'It halves', correct: true, feedback: 'Yes: each comparison discards a half.' }, { text: 'It stays', correct: false, feedback: 'A comparison always rules something out.' }] };
    expect(checkLesson!(acting).errors.map((e) => e.code)).not.toContain('INTERACTIVE_SHARE');
  });

  it.skipIf(!knowsLesson)('warns about a standard or deep lesson with no explore, and not about a quick one', () => {
    const draft = exampleClipDraft();
    for (const clip of clipsOf(draft)) delete clip.explore;
    expect(DEPTHS[draft.depth].minutes).toBeGreaterThanOrEqual(DEPTHS.standard.minutes);
    const report = checkLesson!(draft);
    expect(report.warnings.map((w) => w.code)).toContain('NO_EXPLORE');
    expect(report.errors.map((e) => e.code)).not.toContain('NO_EXPLORE');
    const quick = exampleClipDraft();
    for (const clip of clipsOf(quick)) delete clip.explore;
    (quick as unknown as Loose).depth = 'quick';
    expect(checkLesson!(quick).warnings.map((w) => w.code)).not.toContain('NO_EXPLORE');
  });
});
