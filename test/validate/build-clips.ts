// A generator of whole lessons in the v2 shape: clips, checkpoints and a recap, and nothing else.
// The counterpart of ./build.ts (which generates lessons of the older kinds), built on its words,
// its excerpts and its question writer, for the satisfiability property of the clip rules, the
// performance bound, determinism and the whole-lesson fixtures.
//
// A clip teaches from two excerpts or more: its stage cites them all, and its captions are claims
// and quotes grounded in the first two, with a framing line, a worked example or an analogy among
// them. (A lesson with few clips cites more passages from each, to reach its depth's minimum.) A
// "sourced" stage shows only what its excerpt states (its own number, and words); a "worked" or
// "illustrative" one shows numbers of its own. Every action names a part of the stage above it.
//
// The learner acts in every clip: a prediction on the last beat (answered by a tap on a row of
// cells, by options elsewhere), and, where the stage shows quantities that are the writer's own (dots,
// bars and curves that are not "sourced"), an explore after it: a slider, a binding and, in the
// fuller shapes, a goal. What an explore tells the learner (its prompt, its goal) is the writer's
// own and counts with the framing lines towards the lesson's share of uncited prose.
import { CLIP_LIMITS as C, STAGE_KINDS, type StageKind } from '../../src/core/clip';
import type { ClipSceneInput } from '../../src/core/clip-examples';
import { KITS_EXTRA_LIMITS as X } from '../../src/core/clip-kits-extra';
import { DEPTHS, LIMITS as L, type Depth } from '../../src/core/limits';
import { QUESTION_TYPES, type OutlineEntry, type PlanInput, type QuestionType } from '../../src/core/schema';
import type { SceneInput, StartInputRaw } from '../../src/core/types';
import { Builder, HOSTS, MAX_EVIDENCE, buildEvidence, cap, evidenceNumber, evidenceWords, letters } from './build';
import type { LessonParts } from './helpers';

export type Provenance = 'sourced' | 'worked' | 'illustrative';
export type ClipFill = 'min' | 'warn' | 'max';

export interface ClipBuildOptions {
  depth: Depth;
  /** `min`: the fewest scenes, objectives, beats and words. `max`: the most. A number: a random shape from that seed. */
  size: 'min' | 'max' | number;
  /** Fix the scene kinds ('clip' | 'checkpoint' | 'recap'; the recap must be last). */
  kinds?: ('clip' | 'checkpoint' | 'recap')[];
  /** Fix the stage kind of every clip, or give the kinds to cycle through. Default: all nine, at most two frames. */
  stages?: StageKind[];
  /** Fix the provenance of every stage. Default: cycle sourced, worked, sourced, illustrative. */
  provenance?: Provenance;
  /** Words in each caption: 6 (min), at the warning threshold, or at the limit. */
  fill?: ClipFill;
  /** Beats in each clip. */
  beats?: number;
  /** Give every clip a prediction on its last beat (a tap on a cells stage, options elsewhere). Default true. */
  gates?: boolean;
  /** Give the clips that show the writer's own quantities (dots, bars, curves) an explore. Default true. */
  explore?: boolean;
  objectives?: number;
  evidence?: number;
  topic?: string;
  title?: string;
}

/** A frame that passes the frame checks: a row of blocks that light up one after another. */
export const BUILT_FRAME_CODE = [
  '// Blocks that light up one after another. Everything is laid out from S.W and S.H.',
  'const COUNT = 6;',
  '',
  'function render(ctx, t) {',
  '  const { W, H, theme: c } = S;',
  '  S.clear();',
  '  for (let i = 0; i < COUNT; i++) {',
  '    const on = S.prog(t, i * 0.8, 0.5, S.ease.out);',
  '    S.rect(W * (0.1 + i * 0.14), H * 0.4, W * 0.1, H * 0.2, { fill: on > 0.5 ? c.accentSoft : c.bg, stroke: c.accent, lw: 2, r: 6 });',
  '  }',
  '}',
  '',
].join('\n');

interface Shape {
  stage: Record<string, unknown>;
  /** The actions of beat `i` of `n`, each naming parts of the stage. `full`: as many as a beat may hold. */
  actions(i: number, n: number, full: boolean): Record<string, unknown>[];
  /** What an explore on this stage is made of: the slider, what it drives, and a condition it can reach. Absent where the stage has nothing a formula can honestly drive. */
  explore?: { control: Record<string, unknown>; bind: Record<string, unknown>[]; when: string };
  /** The parts a learner could tap on the last beat, the first of them the right one. */
  taps?: string[];
  /** A curve chart is drawn from formulas: never "sourced". */
  neverSourced?: boolean;
}

const TONES = ['accent', 'good', 'warn', 'bad', 'muted', 'neutral'] as const;
const tone = (i: number): string => TONES[i % TONES.length] as string;

/** A stage of a kind, sized small or large, with the actions that play on it. `number` is what a sourced stage may show. */
function shapeOf(b: Builder, kind: StageKind, big: boolean, sourced: boolean, number: number, curve = false, driven = true): Shape {
  const short = (max: number, words = 2): string => {
    for (let n = words; n >= 1; n--) {
      const text = b.label(n);
      if (text.length <= max) return text;
    }
    return b.label(1).slice(0, max);
  };
  // A sourced stage shows its excerpt's own number; any other stage shows numbers of its own.
  const value = (i: number): number => (sourced ? (i === 0 ? number : (i % 9) + 1) : 12 * (i + 1) + 5);
  const stat = { id: 'tally', label: short(C.statLabelChars), value: 0 };
  const extras = (i: number, ids: readonly string[], full: boolean, first: Record<string, unknown>[]): Record<string, unknown>[] => {
    const out = [...first];
    if (!full) return out;
    const id = ids[i % ids.length] as string;
    for (const more of [{ verb: 'pulse', target: id, with: true }, { verb: 'set', target: 'tally', value: value(i + 1) }, { verb: 'focus', targets: [id] }]) if (out.length < C.actionsPerBeat) out.push(more);
    return out;
  };

  switch (kind) {
    case 'sequence': {
      const actors = Array.from({ length: big ? C.sequence.actors.max : C.sequence.actors.min }, (_, i) => ({ id: `a-${letters(i)}`, label: short(C.sequence.actorChars) }));
      const messages = Array.from({ length: C.sequence.messages.max }, (_, i) => ({ id: `m-${letters(i)}`, from: (actors[i % actors.length] as { id: string }).id, to: (actors[(i + 1) % actors.length] as { id: string }).id, label: short(C.sequence.messageChars) }));
      return {
        stage: { kind, actors, messages, stats: [{ ...stat, at: (actors[0] as { id: string }).id }] },
        actions: (i, _n, full) => extras(i, actors.map((a) => a.id), full, [{ verb: 'send', target: (messages[i] as { id: string }).id, ...(big && i === 1 ? { outcome: 'lost' } : {}) }]),
      };
    }
    case 'cells': {
      const count = big ? C.cells.cells.max : C.cells.cells.min + 1;
      const cells = Array.from({ length: count }, (_, i) => ({ id: `c-${letters(i)}`, label: String(sourced ? (i % 9) + 1 : 3 * i + 11) }));
      const ids = cells.map((c) => c.id);
      return {
        stage: { kind, indices: big, cells, pointers: [{ id: 'at', label: 'at', ...(big ? { side: 'above', tone: 'warn' } : {}) }], brackets: [{ id: 'span', label: short(C.cells.bracketChars) }], stats: [stat] },
        actions: (i, _n, full) =>
          extras(i, ids, full, [
            i % 3 === 0 ? { verb: 'move', target: 'at', to: ids[i % ids.length] } : i % 3 === 1 ? { verb: 'move', target: 'span', to: [ids[0], ids[(i % (ids.length - 1)) + 1]] } : { verb: 'swap', a: ids[0], b: ids[ids.length - 1] },
          ]),
        // Every cell is on stage from the start, so any of them can be the one to tap.
        taps: ids,
      };
    }
    case 'dots': {
      // The counts of a split are arithmetic of the agent's own, so a dots stage here is never "sourced" (see buildClipLesson).
      const total = big ? C.dots.total.max : 64;
      // sizes[i]: how many dots the group that beat i acts on holds. Each beat halves what the beat before kept.
      const sizes: number[] = [total];
      for (let k = 1; k <= C.beats.max; k++) sizes.push(Math.ceil((sizes[k - 1] as number) / 2));
      const lastSplit = sizes.findIndex((size) => size < 2) - 1;
      return {
        stage: { kind, total, legend: short(C.dots.legendChars, 3), group: { id: 'g-root', label: short(C.dots.groupChars) }, stats: [stat] },
        actions: (i, _n, full) => {
          const size = sizes[i] as number;
          const keep = Math.ceil(size / 2);
          // One dot is left: nothing more to halve, so the later beats look at it.
          if (size < 2) return [{ verb: 'focus', targets: [`g-keep${lastSplit}`] }, { verb: 'set', target: 'tally', tone: tone(i), with: true }];
          const split = {
            verb: 'split',
            target: i === 0 ? 'g-root' : `g-keep${i - 1}`,
            into: [
              { id: `g-keep${i}`, label: short(C.dots.groupChars), count: keep, tone: 'accent' },
              { id: `g-drop${i}`, label: short(C.dots.groupChars), count: size - keep, tone: 'muted' },
            ],
            ...(big ? { pick: 'first' } : {}),
          };
          return full ? [split, { verb: 'set', target: 'tally', value: i + 1, with: true }, { verb: 'focus', targets: [`g-keep${i}`] }] : [split];
        },
        // The first group split off takes a share of every dot; it starts at the half the clip gave it.
        explore: {
          control: { id: 'share', label: short(16, 1), min: 0, max: 100, step: 10, value: 50, unit: '%' },
          bind: [
            { target: 'g-keep0', expr: `${total} * share / 100` },
            { target: 'tally', expr: 'share' },
          ],
          when: 'share >= 70 and share <= 80',
        },
      };
    }
    case 'chart': {
      if (big) {
        const xs = Array.from({ length: C.chart.xs.max }, (_, i) => `x${letters(i)}`);
        const series = Array.from({ length: C.chart.series.max }, (_, k) => ({ id: `q-${letters(k)}`, label: short(C.chart.seriesChars), values: xs.map((_, i) => value(i + k)), ...(k === 0 ? { tone: 'accent' } : {}) }));
        return {
          stage: { kind, mark: 'line', yLabel: short(C.chart.axisChars, 3), xs, series, stats: [stat] },
          actions: (i, n, full) => extras(i, series.map((q) => q.id), full, [{ verb: 'draw', targets: series.map((q) => q.id), ...(i < n - 1 ? { upto: xs[Math.min(xs.length - 1, i + 1)] } : {}) }]).filter((a) => a.verb !== 'pulse' || a.target === 'tally'),
        };
      }
      if (curve) {
        // Two curves and a point where the first one is read off. With an explore the second curve and the point follow the slider.
        const curves = [
          { id: 'q-a', label: short(C.chart.seriesChars), expr: 'x * x / 10' },
          { id: 'q-b', label: short(C.chart.seriesChars), expr: driven ? 'rate * x' : '0.5 * x', tone: 'muted' },
        ];
        const ids = curves.map((q) => q.id);
        return {
          stage: { kind, mark: 'curve', yLabel: short(C.chart.axisChars, 3), x: { label: short(C.chart.axisChars, 3), min: 0, max: 10 }, curves, points: [{ id: 'p-a', label: short(C.chart.seriesChars), x: driven ? '10 * rate' : '5', on: 'q-a' }], stats: [stat] },
          actions: (i, _n, full) => extras(i, ids, full, [i === 0 ? { verb: 'draw', target: 'q-a' } : i === 1 ? { verb: 'draw', target: 'q-b' } : i === 2 ? { verb: 'show', target: 'p-a' } : i % 2 === 1 ? { verb: 'focus', targets: ['p-a'] } : { verb: 'pulse', target: 'p-a' }]),
          ...(driven ? { explore: { control: { id: 'rate', label: short(16, 1), min: 0, max: 1, step: 0.1, value: 0.5 }, bind: [{ target: 'tally', expr: '10 * rate' }], when: 'rate >= 0.7 and rate <= 0.8' } } : {}),
          // Both curves have drawn themselves, or been drawn, by the last beat of a clip of three beats or more.
          taps: ids,
          neverSourced: true,
        };
      }
      const bars = Array.from({ length: C.chart.bars.min + 1 }, (_, i) => ({ id: `b-${letters(i)}`, label: short(C.chart.barChars), value: value(i) }));
      const ids = bars.map((x) => x.id);
      return {
        stage: { kind, mark: 'bars', yLabel: short(C.chart.axisChars, 3), unit: ' u', bars },
        actions: (i) => [i % 2 === 0 ? { verb: 'set', target: ids[i % ids.length], value: value(i % 3) } : { verb: 'reorder', order: [...ids].reverse() }, { verb: 'focus', targets: [ids[i % ids.length]] }],
        explore: { control: { id: 'level', label: short(16, 1), min: 0, max: 100, step: 5, value: 50 }, bind: [{ target: ids[0] as string, expr: 'level' }], when: 'level >= 70 and level <= 80' },
      };
    }
    case 'flow': {
      const count = big ? C.flow.nodes.max : C.flow.nodes.min + 1;
      const nodes = Array.from({ length: count }, (_, i) => ({ id: `n-${letters(i)}`, label: short(C.flow.nodeChars) }));
      const edges = Array.from({ length: Math.min(C.flow.edges.max, big ? count + 2 : count - 1) }, (_, i) => ({ id: `e-${letters(i)}`, from: (nodes[i % count] as { id: string }).id, to: (nodes[(i + 1) % count] as { id: string }).id, ...(big ? { label: short(C.flow.edgeChars, 1) } : {}) }));
      const ids = nodes.map((x) => x.id);
      return {
        stage: { kind, nodes, edges, stats: [stat] },
        actions: (i, _n, full) =>
          extras(i, ids, full, [i % 2 === 0 ? { verb: 'draw', target: (edges[i % edges.length] as { id: string }).id } : { verb: 'send', along: (edges[i % edges.length] as { id: string }).id, label: short(C.flow.tokenChars, 1), ...(big ? { tone: tone(i) } : {}) }]),
      };
    }
    case 'words': {
      const lines = Array.from({ length: big ? C.words.lines.max : 2 }, (_, i) => ({ id: `w-${letters(i)}`, text: b.label(big ? 5 : 3), ...(i === 0 ? { size: 'xl' } : {}) }));
      const ids = lines.map((x) => x.id);
      return {
        stage: { kind, lines },
        actions: (i, _n, full) => {
          const id = ids[i % ids.length] as string;
          const first = i < ids.length ? { verb: 'show', target: id } : { verb: 'set', target: id, tone: tone(i) };
          return full ? [first, { verb: 'pulse', target: id }, { verb: 'focus', targets: [id] }, { verb: 'set', target: id, tone: tone(i + 1), with: true }] : [first];
        },
      };
    }
    case 'lines': {
      // Twelve lines and an annotation are fourteen rows: all a stage holds.
      const count = big ? X.lines.lines.max : 3;
      const lines = Array.from({ length: count }, (_, i) => `${'  '.repeat(i % 3)}${b.words(1)[0]}_${letters(i)} = ${b.words(1)[0]}(${sourced ? (i % 9) + 1 : i * 12 + 10})`);
      const ids = lines.map((_, i) => `l${i + 1}`);
      return {
        stage: {
          kind,
          format: 'code',
          language: 'Python',
          lines,
          pointers: [{ id: 'pc', label: 'pc' }],
          brackets: [{ id: 'block', label: short(X.lines.brackets.labelChars) }],
          annotations: [{ id: 'note', at: 'l2', text: b.text(4) }],
          values: [{ id: 'val', at: 'l1', label: 'v' }],
          stats: [stat],
        },
        actions: (i, _n, full) =>
          extras(i, ids, full, [
            i % 4 === 0
              ? { verb: 'move', target: 'pc', to: ids[i % ids.length] }
              : i % 4 === 1
                ? { verb: 'set', target: 'val', value: value(i) }
                : i % 4 === 2
                  ? { verb: 'move', target: 'block', to: [ids[0], ids[ids.length - 1]] }
                  : { verb: i % 8 === 3 ? 'show' : 'hide', target: 'note' },
          ]),
      };
    }
    case 'timeline': {
      const count = big ? X.timeline.events.max : X.timeline.events.min + 1;
      const lanes = big ? [{ id: 'lane-a', label: short(X.timeline.lanes.labelChars) }, { id: 'lane-b', label: short(X.timeline.lanes.labelChars) }] : undefined;
      const events = Array.from({ length: count }, (_, i) => ({ id: `t-${letters(i)}`, when: `Stage ${letters(i)}`, label: short(X.timeline.labelChars, 3), ...(big ? { detail: b.text(5), lane: (lanes as { id: string }[])[i % 2]?.id } : {}) }));
      const ids = events.map((x) => x.id);
      return {
        stage: { kind, ...(lanes ? { lanes } : {}), events, spans: [{ id: 'reach', from: ids[0], to: ids[ids.length - 1], label: short(X.timeline.spans.labelChars) }], markers: [{ id: 'now', label: 'now' }], stats: [stat] },
        actions: (i, n, full) =>
          extras(i, ids, full, [
            i % 2 === 0 ? { verb: 'draw', target: 'track', ...(i < n - 1 ? { upto: ids[Math.min(ids.length - 1, i + 1)] } : {}) } : { verb: 'move', target: 'now', to: ids[Math.min(ids.length - 1, i)] },
            ...(i === n - 1 ? [{ verb: 'show', target: 'reach' }] : []),
          ]).slice(0, C.actionsPerBeat),
      };
    }
    case 'frame':
      return { stage: { kind, code: BUILT_FRAME_CODE, duration: big ? 60 : 12, poster: 3, ...(big ? { aspect: '4:3' } : {}) }, actions: () => [] };
  }
}

/** Scene kinds for `n` scenes: a clip first, a recap last, at least `checkpoints` checkpoints, never four scenes in a row without one. */
function deriveKinds(b: Builder, n: number, checkpoints: number, random: boolean): ('clip' | 'checkpoint' | 'recap')[] {
  const kinds: ('clip' | 'checkpoint' | 'recap')[] = ['clip'];
  let run = 1;
  for (let i = 1; i < n - 1; i++) {
    // The recap that ends the lesson is passive too, so leave room for it.
    const mustAsk = run >= L.passiveRun - 1;
    const kind = mustAsk ? 'checkpoint' : random ? (b.int(0, 2) === 0 ? 'checkpoint' : 'clip') : i % 3 === 2 ? 'checkpoint' : 'clip';
    kinds.push(kind);
    run = kind === 'clip' ? run + 1 : 0;
  }
  kinds.push('recap');
  for (let i = n - 2; i >= 1 && kinds.filter((k) => k === 'checkpoint').length < checkpoints; i--) if (kinds[i] !== 'checkpoint') kinds[i] = 'checkpoint';
  return kinds;
}

const PROVENANCES: Provenance[] = ['sourced', 'worked', 'sourced', 'illustrative'];
/** What the caption of each beat is, by its place in the clip. */
const ROLES = ['claim', 'framing', 'claim', 'example', 'quote', 'claim', 'analogy', 'claim'] as const;

/** A complete lesson of clips, checkpoints and a recap. The same options always give the same lesson. */
export function buildClipLesson(options: ClipBuildOptions): LessonParts {
  const profile = DEPTHS[options.depth];
  const depthIndex = ['quick', 'standard', 'deep'].indexOf(options.depth);
  const seed = typeof options.size === 'number' ? options.size : options.size === 'min' ? 1 : 2;
  const random = typeof options.size === 'number';
  const big = options.size === 'max';
  const fill: ClipFill = options.fill ?? (big ? 'max' : options.size === 'min' ? 'min' : 'warn');
  const shape = new Builder(seed * 7 + depthIndex, 1);

  const sceneCount = options.kinds?.length ?? (random ? shape.int(profile.scenes.min, profile.scenes.max) : big ? profile.scenes.max : profile.scenes.min);
  const maxCheckpoints = Math.max(1, sceneCount - 3);
  const objectiveCount = Math.min(options.objectives ?? (random ? shape.int(profile.objectives.min, profile.objectives.max) : big ? profile.objectives.max : profile.objectives.min), maxCheckpoints);
  const evidenceCount = options.evidence ?? (big || options.kinds ? MAX_EVIDENCE : random ? shape.int(Math.max(profile.evidenceMin, sceneCount * 2), MAX_EVIDENCE) : Math.max(profile.evidenceMin, 4));
  const b = new Builder(seed * 31 + depthIndex, evidenceCount);
  const kinds = options.kinds ?? deriveKinds(b, sceneCount, objectiveCount, random);

  // ----- the plan
  const objectives = Array.from({ length: objectiveCount }, (_, i) => ({ id: `o${i + 1}`, text: cap(b.words(6).join(' ')) }));
  const cycle = options.stages ?? [...STAGE_KINDS];
  const startAt = random ? b.int(0, cycle.length - 1) : 0;
  const totalCheckpoints = kinds.filter((k) => k === 'checkpoint').length;
  const outline: OutlineEntry[] = [];
  let clipAt = 0;
  let frames = 0;
  let checkpointAt = 0;
  let reflects = 0;
  let questionAt = random ? b.int(0, QUESTION_TYPES.length - 1) : 0;
  kinds.forEach((kind, i) => {
    const entry: OutlineEntry = { id: `s${i + 1}`, kind, purpose: b.label(4) };
    if (kind === 'clip') {
      let stage = cycle[(startAt + clipAt++) % cycle.length] as StageKind;
      // A lesson may hold two frames; past that, the next kind in the cycle that is not one.
      while (stage === 'frame' && frames >= L.framesPerLesson && cycle.some((k) => k !== 'frame')) stage = cycle[(startAt + clipAt++) % cycle.length] as StageKind;
      if (stage === 'frame') frames++;
      entry.stage = stage;
    } else if (kind === 'checkpoint') {
      let type = QUESTION_TYPES[questionAt++ % QUESTION_TYPES.length] as QuestionType;
      // At least half the checkpoints must be graded.
      if (type === 'reflect' && (reflects + 1) * 2 > totalCheckpoints) type = 'single';
      if (type === 'reflect') reflects++;
      entry.question = type;
      entry.objective = `o${(checkpointAt++ % objectiveCount) + 1}`;
    }
    outline.push(entry);
  });
  const plan: PlanInput = { title: options.title ?? cap(b.words(4).join(' ')), objectives, outline };

  // ----- the scenes
  const captionWords = fill === 'max' ? L.captionWords.max : fill === 'warn' ? L.captionWords.warn : 6;
  // Enough passages for the depth, however few clips there are to cite them from.
  const clipTotal = Math.max(1, kinds.filter((k) => k === 'clip').length);
  const teachPer = Math.min(C.citesPerStage, Math.max(2, Math.ceil(profile.evidenceMin / clipTotal)));
  const scenes: (SceneInput | ClipSceneInput)[] = [];
  let checkpointIndex = 0;
  let clipIndex = 0;
  outline.forEach((entry) => {
    const title = b.label(3);
    if (entry.kind === 'clip') {
      const kind = entry.stage as StageKind;
      const first = b.teach();
      const second = b.teach();
      const others = Array.from({ length: teachPer - 2 }, () => b.teach());
      const wanted = options.provenance ?? (PROVENANCES[clipIndex % PROVENANCES.length] as Provenance);
      // A small chart is bars, or, in one random shape in three, curves; a large one is lines.
      const curve = kind === 'chart' && !big && random && b.int(0, 2) === 0;
      // The groups of a split are counted by the agent, and a curve is drawn from a formula: a dots stage and a curve chart are worked cases, never sourced ones.
      const provenance: Provenance = (kind === 'dots' || curve) && wanted === 'sourced' ? 'worked' : wanted;
      const sourced = provenance === 'sourced';
      const n = options.beats ?? (fill === 'min' ? C.beats.min : random ? b.int(C.beats.min, C.beats.max) : C.beats.max);
      const full = fill === 'max';
      const explores = options.explore ?? true;
      const made = shapeOf(b, kind, big, sourced, evidenceNumber(first), curve, explores);
      // A sequence sends one message per beat, and a dots stage halves until one dot is left.
      const stage = kind === 'sequence' ? { ...made.stage, messages: (made.stage.messages as unknown[]).slice(0, Math.max(C.sequence.messages.min, n)) } : made.stage;
      const gated = options.gates ?? true;
      const explored = explores && made.explore !== undefined && !sourced;
      const beats = Array.from({ length: n }, (_, i) => {
        const cited = i % 2 === 0 ? first : second;
        // Mostly claims; a framing line, a worked example, a quote and an analogy among them, as an honest clip has.
        const role = n > 2 ? (ROLES[i] as (typeof ROLES)[number]) : 'claim';
        const caption =
          role === 'claim'
            ? b.claim(captionWords, cited)
            : role === 'quote'
              ? b.quote(cited)
              : role === 'framing'
                ? { type: 'framing', text: b.text(Math.min(captionWords, 10)) }
                : role === 'example'
                  ? { type: 'example', text: b.text(captionWords), basedOn: [`e${cited + 1}`] }
                  : { type: 'analogy', text: b.text(Math.max(1, captionWords - 3)), limits: b.text(3) };
        const actions = kind === 'frame' ? [] : made.actions(i, n, full);
        // The cue is a word of the caption, as the engine wants it.
        if (full && actions.length > 0 && caption.type !== 'quote') (actions[actions.length - 1] as Record<string, unknown>).on = caption.text.split(' ')[1]?.replace(/[.,]/g, '') ?? caption.text.split(' ')[0];
        // The last beat asks: by a tap where the answer is a cell of the row, by options everywhere else.
        const gate =
          gated && i === n - 1
            ? kind === 'cells' && made.taps
              ? { prompt: `${cap(b.words(6).join(' '))}?`, pick: [made.taps[0] as string], right: b.text(big ? 12 : 6), wrong: b.text(big ? 12 : 6) }
              : {
                  prompt: `${cap(b.words(6).join(' '))}?`,
                  options: Array.from({ length: big ? L.predictOptions.max : L.predictOptions.min }, (_, o) => ({ text: b.label(4), correct: o === 0, feedback: b.text(5) })),
                }
            : undefined;
        return { caption, ...(kind === 'frame' ? { at: (i * ((stage.duration as number) - 1)) / n } : { do: actions }), ...(gate ? { gate } : {}) };
      });
      scenes.push({
        id: entry.id,
        kind: 'clip',
        title,
        description: b.text(8),
        ...(big ? { pace: 'calm' } : {}),
        stage: { ...stage, cites: [first, second, ...others].map((index) => `e${index + 1}`), provenance },
        beats,
        // Dragging shows numbers no passage states, so only a stage that is the writer's own is handed over.
        ...(explored && made.explore
          ? {
              explore: {
                prompt: b.text(fill === 'min' ? 4 : 8),
                controls: [made.explore.control],
                bind: made.explore.bind,
                // A goal wherever the clip is more than the barest.
                ...(fill === 'min' ? {} : { goal: { text: b.text(8), when: made.explore.when, done: b.text(big ? 14 : 7) } }),
              },
            }
          : {}),
      } as unknown as ClipSceneInput);
      clipIndex++;
    } else if (entry.kind === 'checkpoint') {
      scenes.push({ id: entry.id, kind: 'checkpoint', title, objective: entry.objective as string, level: checkpointIndex === 0 ? 'apply' : 'recall', question: b.question(entry.question as QuestionType, big) } as SceneInput);
      checkpointIndex++;
    } else {
      scenes.push({
        id: entry.id,
        kind: 'recap',
        title,
        takeaways: objectives.map((o) => {
          const index = b.recall();
          const claim = b.claim(fill === 'min' ? 6 : 20, index);
          return { objective: o.id, text: claim.text, cites: claim.cites };
        }),
        ...(fill === 'min' ? {} : { practice: { task: b.text(20), lookFor: [b.label(4)] } }),
        next: Array.from({ length: big ? L.nextTopics.max : L.nextTopics.min }, () => ({ topic: b.label(3), why: b.text(8) })),
      } as SceneInput);
    }
  });

  const start: StartInputRaw = {
    topic: options.topic ?? 'How the generated machine sorts its parts',
    language: 'en',
    depth: options.depth,
    learner: { level: 'new', knows: 'Nothing about the topic yet.', goal: 'Explain how it works.', calibration: [] },
  };
  const evidence = Array.from({ length: evidenceCount }, (_, i) => buildEvidence(i, HOSTS[i % HOSTS.length] as string));
  return { start, evidence, plan, scenes: scenes as SceneInput[] };
}

/** The words an excerpt is made of, for a test that wants to write a grounded claim by hand. */
export { evidenceNumber, evidenceWords };
