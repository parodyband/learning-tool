// The example lesson as clips, and one clip per stage kind: they parse, they cite evidence that
// exists, and they stay inside what the format asks of an author.
import { describe, expect, it } from 'vitest';
import { BINDABLE, CLIP_LIMITS, ClipScene, STAGE_KINDS, VERBS_BY_STAGE, verbsFor } from '../../src/core/clip';
import { EXAMPLE_CLIPS, EXAMPLE_V2_SCENES, EXPLORE_EXAMPLE_CLIPS, EXPLORE_EXAMPLE_EVIDENCE } from '../../src/core/clip-examples';
import { evalExpr, isCondition, parseExpr } from '../../src/core/expr';
import { TAPPABLE, tappableKinds, tappableParts } from '../../src/player/stage/tappable';
import { exampleClip, exampleLessonV2, exploreEvidence } from '../helpers/clip-example';

const lesson = exampleLessonV2();
const clips = lesson.scenes.filter((s): s is ClipScene => s.kind === 'clip');
const kits = STAGE_KINDS.map((kind) => ClipScene.parse(EXAMPLE_CLIPS[kind]));
const explores = Object.values(EXPLORE_EXAMPLE_CLIPS).map((c) => ClipScene.parse(c));
const evidence = new Set(lesson.evidence.map((e) => e.id));

function citesOf(clip: ClipScene): string[] {
  const out = [...(clip.stage.cites ?? [])];
  for (const b of clip.beats) {
    const c = b.caption;
    if (c.type === 'claim') out.push(...c.cites);
    else if (c.type === 'quote') out.push(c.cite);
    else if (c.type === 'example') out.push(...(c.basedOn ?? []));
  }
  return out;
}
const words = (text: string): number => text.trim().split(/\s+/).length;

describe('the example lesson as clips', () => {
  it('is a cold open, a flow, a trace, a chart and a crowd, around the three checkpoints and the recap', () => {
    expect(clips.map((c) => c.stage.kind)).toEqual(['words', 'flow', 'cells', 'chart', 'dots', 'cells']);
    expect(lesson.scenes.filter((s) => s.kind === 'checkpoint')).toHaveLength(3);
    expect(lesson.scenes.at(-1)?.kind).toBe('recap');
    expect(EXAMPLE_V2_SCENES).toHaveLength(10);
  });

  it('opens on a question', () => {
    const open = exampleClip('c1');
    expect(open.stage.kind).toBe('words');
    const last = open.beats.at(-1)?.caption;
    expect(last?.type).toBe('framing');
    expect(last?.text.trim().endsWith('?')).toBe(true);
  });

  it('asks for a prediction in the trace (twice, once by tapping the row) and in the chart, never on a first beat', () => {
    const trace = exampleClip('c3').beats.flatMap((b) => (b.gate ? [b.gate] : []));
    expect(trace).toHaveLength(2);
    expect(trace.map((g) => ('pick' in g ? 'pick' : 'options'))).toEqual(['options', 'pick']);
    expect(exampleClip('c4').beats.filter((b) => b.gate)).toHaveLength(1);
    for (const c of clips) expect(c.beats[0]?.gate, c.id).toBeUndefined();
    for (const c of clips) for (const b of c.beats) if (b.gate && 'options' in b.gate) expect(b.gate.options.filter((o) => o.correct)).toHaveLength(1);
  });

  it('asks a tapped prediction only about parts the engine can make tappable', () => {
    for (const c of [...clips, ...explores]) {
      const parts = new Map(tappableParts(c).map((p) => [p.id, p]));
      for (const b of c.beats) {
        if (!b.gate || !('pick' in b.gate)) continue;
        for (const id of b.gate.pick) {
          expect(parts.has(id), `${c.id}: "${id}" is a part that can be tapped`).toBe(true);
          expect(tappableKinds(c.stage as { kind: string; mark?: string }), `${c.id}: ${id}`).toContain(parts.get(id)?.kind);
        }
      }
    }
  });

  it('cites only evidence the lesson carries, and every claim caption cites', () => {
    for (const c of [...clips, ...kits]) for (const id of citesOf(c)) expect(evidence.has(id), `${c.id} cites ${id}`).toBe(true);
    for (const c of clips) for (const b of c.beats) if (b.caption.type === 'claim') expect(b.caption.cites.length).toBeGreaterThan(0);
  });

  it('gives a sourced stage at least one passage', () => {
    for (const c of [...clips, ...kits]) if (c.stage.provenance === 'sourced') expect((c.stage.cites ?? []).length, c.id).toBeGreaterThan(0);
  });

  it('keeps captions short and uses only verbs its stage accepts', () => {
    for (const c of [...clips, ...kits]) {
      const allowed = verbsFor(c.stage as { kind: string; mark?: string });
      for (const b of c.beats) {
        expect(words(b.caption.text), `${c.id}: "${b.caption.text}"`).toBeLessThanOrEqual(CLIP_LIMITS.captionWords);
        for (const a of b.do) expect(allowed, `${c.id}: ${a.verb} on ${c.stage.kind}`).toContain(a.verb);
      }
    }
  });

  it('has unique scene ids', () => {
    const ids = lesson.scenes.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('one clip of every kind', () => {
  it('covers every stage kind, each with its own id', () => {
    expect(Object.keys(EXAMPLE_CLIPS).sort()).toEqual([...STAGE_KINDS].sort());
    for (const kind of STAGE_KINDS) expect(ClipScene.parse(EXAMPLE_CLIPS[kind]).stage.kind).toBe(kind);
    expect(new Set(kits.map((c) => c.id)).size).toBe(kits.length);
  });

  it('gives a frame clip times and no actions, and every other clip actions and no times', () => {
    for (const c of kits) {
      for (const b of c.beats) {
        if (c.stage.kind === 'frame') {
          expect(b.at, c.id).toBeTypeOf('number');
          expect(b.do).toEqual([]);
        } else expect(b.at, c.id).toBeUndefined();
      }
    }
  });
});

describe('what an author never writes', () => {
  // The format has no field for any of these, so a strict parse is the proof; this spells it out.
  const FORBIDDEN = /^(duration|delay|ease|easing|x|y|width|height|color|colour|fill|stroke|ms|seconds|style)$/i;
  const keys = (value: unknown, path: string, out: string[]): void => {
    if (Array.isArray(value)) value.forEach((v, i) => keys(v, `${path}[${i}]`, out));
    else if (typeof value === 'object' && value !== null) for (const [k, v] of Object.entries(value)) {
      out.push(`${path}.${k}`);
      keys(v, `${path}.${k}`, out);
    }
  };
  it('has no duration, easing, coordinate or colour anywhere in a typed clip', () => {
    for (const c of [...clips, ...kits.filter((k) => k.stage.kind !== 'frame')]) {
      const all: string[] = [];
      keys(c, c.id, all);
      for (const k of all) expect(FORBIDDEN.test(k.split('.').pop() ?? ''), k).toBe(false);
    }
  });
});

describe('three clips that end in an explore', () => {
  type Env = Record<string, number>;
  type Control = { id: string; label: string; min: number; max: number; step: number; value: number };
  const controlsOf = (c: ClipScene): Control[] => c.explore?.controls ?? [];
  /** Every setting the sliders of a clip can stand at. */
  const settings = (c: ClipScene): Env[] => {
    let out: Env[] = [{}];
    for (const k of controlsOf(c)) {
      const steps = Math.round((k.max - k.min) / k.step);
      out = out.flatMap((env) => Array.from({ length: steps + 1 }, (_, i) => ({ ...env, [k.id]: Number((k.min + i * k.step).toFixed(9)) })));
    }
    return out;
  };
  const startOf = (c: ClipScene): Env => Object.fromEntries(controlsOf(c).map((k) => [k.id, k.value]));
  const value = (src: string, env: Env): number => {
    const parsed = parseExpr(src);
    if (!parsed.ok) throw new Error(`${src}: ${parsed.message}`);
    return evalExpr(parsed.expr, env);
  };
  const goalOf = (c: ClipScene): { text: string; when: string; done: string } => {
    if (!c.explore?.goal) throw new Error(`${c.id} has no goal`);
    return c.explore.goal;
  };

  it('is one on dots, one on a curve chart and one on bars, each parsing and citing evidence that exists', () => {
    expect(explores.map((c) => (c.stage.kind === 'chart' ? c.stage.mark : c.stage.kind))).toEqual(['dots', 'curve', 'bars']);
    expect(new Set(explores.map((c) => c.id)).size).toBe(3);
    // The curve chart has two sliders; the other two have one.
    expect(explores.map((c) => controlsOf(c).length)).toEqual([1, 2, 1]);
    const stored = new Set(exploreEvidence().map((e) => e.id));
    expect([...stored]).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9']);
    for (const c of explores) {
      for (const id of citesOf(c)) expect(stored.has(id), `${c.id} cites ${id}`).toBe(true);
      // What a caption states as fact is a claim with its passage; every clip has at least one.
      expect(c.beats.filter((b) => b.caption.type === 'claim' || b.caption.type === 'quote').length, c.id).toBeGreaterThan(0);
      for (const b of c.beats) if (b.caption.type === 'claim') expect(b.caption.cites.length).toBeGreaterThan(0);
      // Dragging puts numbers on screen that no passage contains: an explored stage is never "sourced".
      expect(['worked', 'illustrative'], c.id).toContain(c.stage.provenance);
      if (c.stage.provenance === 'worked') expect((c.stage.cites ?? []).length, c.id).toBeGreaterThan(0);
      const allowed = verbsFor(c.stage as { kind: string; mark?: string });
      const stats = new Set('stats' in c.stage ? (c.stage.stats ?? []).map((st) => st.id) : []);
      for (const b of c.beats) {
        expect(words(b.caption.text), `${c.id}: "${b.caption.text}"`).toBeLessThanOrEqual(CLIP_LIMITS.captionWords);
        for (const a of b.do) {
          // A read-out takes show, hide, set, pulse and focus on every stage that has read-outs (core/clip.ts).
          const named = 'targets' in a && a.targets ? a.targets : 'target' in a && a.target ? [a.target] : [];
          const onStats = named.length > 0 && named.every((id) => stats.has(id)) && ['show', 'hide', 'set', 'pulse', 'focus'].includes(a.verb);
          if (!onStats) expect(allowed, `${c.id}: ${a.verb}`).toContain(a.verb);
        }
      }
      // At least two beats in three move something.
      expect(c.beats.filter((b) => b.do.length > 0).length / c.beats.length, c.id).toBeGreaterThanOrEqual(2 / 3);
    }
    // The passages are synthetic and say so.
    for (const e of EXPLORE_EXAMPLE_EVIDENCE) {
      expect(e.title).toContain('(synthetic test source)');
      expect(new URL(e.url).hostname).toMatch(/^example\.(org|com|net)$/);
    }
  });

  it('writes formulas that parse, use only the clip\'s controls, and are finite at every setting of the sliders', () => {
    for (const c of explores) {
      const x = c.explore;
      if (!x) throw new Error(`${c.id} has no explore`);
      const names = x.controls.map((k) => k.id);
      const formulas = [...x.bind.map((b) => b.expr), ...(x.goal ? [x.goal.when] : [])];
      const curve = c.stage.kind === 'chart' && c.stage.mark === 'curve' ? c.stage : null;
      if (curve) formulas.push(...(curve.points ?? []).map((p) => p.x));
      for (const src of formulas) {
        const parsed = parseExpr(src);
        expect(parsed.ok, `${c.id}: ${src}`).toBe(true);
        if (parsed.ok) for (const v of parsed.vars) expect(names, `${c.id}: ${src} uses ${v}`).toContain(v);
      }
      for (const env of settings(c)) {
        for (const b of x.bind) expect(Number.isFinite(value(b.expr, env)), `${c.id}: ${b.target} at ${JSON.stringify(env)}`).toBe(true);
        // A marked point stays on its axis, and is where the two curves cross.
        for (const p of curve?.points ?? []) {
          const at = value(p.x, env);
          expect(at >= curve!.x.min && at <= curve!.x.max, `${c.id}: ${p.id} at ${JSON.stringify(env)}`).toBe(true);
          const [supply, demand] = curve!.curves;
          expect(value(supply!.expr, { ...env, x: at })).toBeCloseTo(value(demand!.expr, { ...env, x: at }), 9);
        }
      }
    }
  });

  it('gives a goal that is a condition, does not hold where the sliders start, and can be reached', () => {
    for (const c of explores) {
      const goal = goalOf(c);
      const parsed = parseExpr(goal.when);
      expect(parsed.ok && isCondition(parsed.expr), c.id).toBe(true);
      expect(value(goal.when, startOf(c)), `${c.id}: at the start`).toBe(0);
      expect(settings(c).some((env) => value(goal.when, env) !== 0), `${c.id}: somewhere`).toBe(true);
    }
  });

  it('cannot be reached by dragging a slider to its end: the goal holds inside the range, at a place that has to be found', () => {
    for (const c of explores) {
      const goal = goalOf(c);
      const controls = controlsOf(c);
      // No corner: every slider at one of its ends.
      let corners: Env[] = [{}];
      for (const k of controls) corners = corners.flatMap((env) => [k.min, k.max].map((v) => ({ ...env, [k.id]: v })));
      for (const env of corners) expect(value(goal.when, env), `${c.id} at ${JSON.stringify(env)}`).toBe(0);
      // No sweep: one slider taken to an end with the others left where they start.
      const start = startOf(c);
      for (const k of controls) for (const end of [k.min, k.max]) expect(value(goal.when, { ...start, [k.id]: end }), `${c.id}: ${k.id} = ${end}`).toBe(0);
      // With two sliders neither reaches it alone, wherever it is put.
      if (controls.length > 1) for (const k of controls) for (const env of settings(c)) if (controls.every((o) => o === k || env[o.id] === o.value)) expect(value(goal.when, env), `${c.id}: ${k.id} alone at ${env[k.id]}`).toBe(0);
      // And it is first reached well inside the range of every slider.
      const reached = settings(c).filter((env) => value(goal.when, env) !== 0);
      for (const k of controls) expect(Math.min(...reached.map((env) => ((env[k.id] as number) - k.min) / (k.max - k.min))), `${c.id}: ${k.id}`).toBeGreaterThan(0.1);
    }
    // What each asks for, on the numbers.
    const [dots, curve, bars] = explores as [ClipScene, ClipScene, ClipScene];
    const where = (c: ClipScene): Env[] => settings(c).filter((env) => value(goalOf(c).when, env) !== 0);
    expect(where(dots)).toEqual([{ rate: 9 }, { rate: 10 }]);
    expect(where(bars)).toEqual([{ n: 31 }]);
    expect(where(curve)).toEqual([0.5, 1, 1.5, 2, 2.5].map((d) => ({ demand: d, costs: -d })));
  });

  it('names an outcome in the learner\'s terms: no setting, no number to read off, and a `done` that explains', () => {
    for (const c of explores) {
      const x = c.explore as NonNullable<ClipScene['explore']>;
      const goal = goalOf(c);
      expect(goal.text, c.id).not.toMatch(/\d/);
      for (const k of x.controls) expect(goal.text.toLowerCase(), c.id).not.toContain(k.label.toLowerCase());
      // A number of two or more digits in the panel's words is a slider's own start or end, or nothing.
      const own = new Set(x.controls.flatMap((k) => [k.min, k.max, k.value]).map(String));
      for (const text of [x.prompt, goal.text, goal.done]) for (const found of text.match(/\d[\d,.]*\d/g) ?? []) expect(own.has(found.replace(/,/g, '')), `${found} in "${text}"`).toBe(true);
      expect(goal.done).not.toMatch(/well done|correct|great|congratulations/i);
      expect(goal.done.split(/\s+/).length).toBeGreaterThan(8);
      // A slider has enough steps to feel continuous and few enough to land on one.
      for (const k of x.controls) {
        const steps = Math.round((k.max - k.min) / k.step);
        expect(steps, `${c.id}: ${k.id}`).toBeGreaterThanOrEqual(10);
        expect(steps, `${c.id}: ${k.id}`).toBeLessThanOrEqual(64);
      }
    }
  });

  it('starts every bound part at the number its formula gives where the sliders start, so nothing jumps at the hand-over', () => {
    for (const c of explores) {
      // The number each part shows once the last beat has played.
      const left = new Map<string, number>();
      if ('stats' in c.stage) for (const st of c.stage.stats ?? []) if (typeof st.value === 'number') left.set(st.id, st.value);
      if (c.stage.kind === 'chart' && c.stage.mark === 'bars') for (const b of c.stage.bars) left.set(b.id, b.value);
      for (const b of c.beats) {
        for (const a of b.do) {
          if (a.verb === 'split') for (const g of a.into) left.set(g.id, g.count);
          if (a.verb === 'set' && typeof a.value === 'number') for (const id of a.targets ?? (a.target ? [a.target] : [])) left.set(id, a.value);
        }
      }
      for (const b of c.explore?.bind ?? []) {
        expect(left.has(b.target), `${c.id}: "${b.target}" has a number on stage`).toBe(true);
        expect(value(b.expr, startOf(c)), `${c.id}: ${b.target}`).toBeCloseTo(left.get(b.target) as number, 9);
      }
    }
  });

  it('binds only what a formula can drive on that stage', () => {
    for (const c of explores) {
      const key = c.stage.kind === 'chart' ? `chart.${c.stage.mark}` : c.stage.kind;
      const kindOf = (id: string): string => {
        if ('stats' in c.stage && (c.stage.stats ?? []).some((st) => st.id === id)) return 'stat';
        if (c.stage.kind === 'chart' && c.stage.mark === 'bars' && c.stage.bars.some((b) => b.id === id)) return 'bar';
        if (c.stage.kind === 'dots' && tappableParts(c).some((p) => p.id === id)) return 'group';
        return 'nothing';
      };
      for (const b of c.explore?.bind ?? []) expect(BINDABLE[key], `${c.id}: ${b.target}`).toContain(kindOf(b.target));
    }
  });
});

describe('the table of parts that can be tapped', () => {
  it('has a row for every stage the format has, and none for any other', () => {
    expect(Object.keys(TAPPABLE).sort()).toEqual(Object.keys(VERBS_BY_STAGE).sort());
    expect(TAPPABLE.frame).toEqual([]);
    for (const [key, kinds] of Object.entries(TAPPABLE)) if (key !== 'frame') expect(kinds.length, key).toBeGreaterThan(0);
  });

  it('names every such part of a clip, with words to call it by', () => {
    const named = (id: string): string[] => tappableParts(exampleClip(id)).map((p) => `${p.kind} ${p.id}: ${p.label}`);
    expect(named('c3').slice(0, 2)).toEqual(['cell c0: 3', 'cell c1: 8']);
    expect(named('c3')).toHaveLength(7);
    expect(named('c2')).toContain('edge again: repeat: the arrow from Discard a half to Look at the middle');
    expect(named('c4')).toEqual(['series linear: Linear search', 'series binary: Binary search']);
    // Groups that the beats make are parts too.
    expect(named('c5')).toEqual(expect.arrayContaining(['group all: Sorted items', 'group left1: Still possible', 'group gone: Ruled out']));
    expect(tappableParts(explores[1] as ClipScene).map((p) => p.kind)).toEqual(['point', 'curve', 'curve']);
    for (const kind of STAGE_KINDS) {
      const clip = ClipScene.parse(EXAMPLE_CLIPS[kind]);
      for (const p of tappableParts(clip)) expect(tappableKinds(clip.stage as { kind: string; mark?: string }), `${kind}: ${p.id}`).toContain(p.kind);
    }
    expect(tappableParts(ClipScene.parse(EXAMPLE_CLIPS.frame))).toEqual([]);
  });
});
