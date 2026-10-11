// The clip rules must be satisfiable: for each depth, the smallest lesson made only of clips,
// checkpoints and a recap passes, the largest passes, and many shapes in between pass. If two
// rules contradict each other (a caption limit that the fewest words cannot meet, a citation limit
// too low for the largest lesson, a stage no action may touch), this is where it shows. Also
// here: the time bound and determinism, on the largest lesson.
import { describe, expect, it } from 'vitest';
import { CLIP_LIMITS as C, LessonV2, STAGE_KINDS } from '../../src/core/clip';
import { canonicalJson } from '../../src/core/hash';
import { DEPTHS, LIMITS as L, type Depth } from '../../src/core/limits';
import type { Draft, LessonReport } from '../../src/core/types';
import { checkLesson, checkPlan, checkScene, verifyLesson } from '../../src/core/validate';
import { buildClipLesson, type ClipBuildOptions } from './build-clips';
import { assemble, expectNoExcerptText, newDraft, saveEvidence } from './helpers';

const DEPTH_NAMES: Depth[] = ['quick', 'standard', 'deep'];
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 3);

function passes(options: ClipBuildOptions): { draft: Draft; report: LessonReport } {
  // `assemble` goes through checkEvidence, checkPlan and checkScene, and throws if any refuses.
  const draft = assemble(buildClipLesson(options));
  const report = checkLesson(draft);
  expect(report.errors, `${options.depth}/${options.size}`).toEqual([]);
  expect(report.ok).toBe(true);
  expect(report.complete).toBe(true);
  expect(LessonV2.safeParse(report.lesson).success).toBe(true);
  return { draft, report };
}

describe.each(DEPTH_NAMES)('a %s lesson of clips, checkpoints and a recap', (depth) => {
  const profile = DEPTHS[depth];

  it('is made of nothing else', () => {
    for (const size of ['min', 'max', 7] as const) {
      const kinds = new Set(buildClipLesson({ depth, size }).plan.outline.map((e) => e.kind));
      expect([...kinds].sort()).toEqual(['checkpoint', 'clip', 'recap']);
    }
  });

  it('passes at its minimum: fewest scenes, objectives and evidence, two beats of six words in every clip', () => {
    const { draft, report } = passes({ depth, size: 'min' });
    expect(draft.outline).toHaveLength(profile.scenes.min);
    expect(draft.objectives).toHaveLength(profile.objectives.min);
    expect(draft.outline[0]!.kind).toBe('clip');
    expect(report.stats.sources).toBeGreaterThanOrEqual(profile.evidenceMin);
    expect(report.stats.sources).toBeLessThanOrEqual(Math.max(profile.evidenceMin, 4));
    expect(report.warnings).toEqual([]);
    for (const scene of report.lesson!.scenes) if (scene.kind === 'clip') expect(scene.beats).toHaveLength(C.beats.min);
  });

  it('passes at its maximum: most scenes and objectives, eight beats of four actions, every caption at its limit', () => {
    const { draft, report } = passes({ depth, size: 'max' });
    expect(draft.outline).toHaveLength(profile.scenes.max);
    expect(draft.objectives).toHaveLength(profile.objectives.max);
    expect(draft.evidence).toHaveLength(L.evidencePerLesson);
    // Full captions are warned about, never refused; nothing else is said.
    expect(new Set(report.warnings.map((w) => w.code))).toEqual(new Set(['WORDS_NEAR_BUDGET']));
    for (const scene of report.lesson!.scenes) {
      if (scene.kind !== 'clip') continue;
      expect(scene.beats).toHaveLength(C.beats.max);
      const metrics = checkScene(scene, draft).metrics!;
      expect(Math.max(...metrics.steps!)).toBe(L.captionWords.max);
      if (scene.stage.kind !== 'frame' && scene.stage.kind !== 'dots') expect(scene.beats.every((b) => b.do.length >= 1)).toBe(true);
    }
    expect(report.stats.words).toBeLessThanOrEqual(profile.words.max);
  });

  it.each(SEEDS)('passes in a random shape (seed %i)', (seed) => {
    const { draft, report } = passes({ depth, size: seed });
    expect(draft.outline.length).toBeGreaterThanOrEqual(profile.scenes.min);
    expect(draft.outline.length).toBeLessThanOrEqual(profile.scenes.max);
    // What was published can be validated again from its own data.
    const verified = verifyLesson(JSON.parse(JSON.stringify(report.lesson)));
    expect(verified.errors).toEqual([]);
    expect(verified.hash).toBe(report.hash);
    expectNoExcerptText(report.warnings, draft);
  });
});

describe('the generated lessons cover the format', () => {
  it('every stage kind, the three chart marks, every verb, every kind of caption, both kinds of gate and explores with and without a goal appear across the shapes', () => {
    const stages = new Set<string>();
    const verbs = new Set<string>();
    const captions = new Set<string>();
    const provenances = new Set<string>();
    const explored = new Set<string>();
    let gates = 0;
    let taps = 0;
    let goals = 0;
    for (const depth of DEPTH_NAMES) {
      for (const size of ['min', 'max', ...SEEDS] as const) {
        for (const scene of buildClipLesson({ depth, size }).scenes as any[]) {
          if (scene.kind !== 'clip') continue;
          const key = scene.stage.kind === 'chart' ? `chart.${scene.stage.mark}` : scene.stage.kind;
          stages.add(key);
          provenances.add(scene.stage.provenance);
          if (scene.explore) {
            explored.add(key);
            // What the learner can drag is never a passage's own numbers.
            expect(scene.stage.provenance, scene.id).not.toBe('sourced');
            if (scene.explore.goal) goals++;
          }
          for (const beat of scene.beats) {
            captions.add(beat.caption.type);
            if (beat.gate) gates++;
            if (beat.gate?.pick) taps++;
            for (const action of beat.do ?? []) verbs.add(action.verb);
          }
        }
      }
    }
    expect([...stages].sort()).toEqual(['cells', 'chart.bars', 'chart.curve', 'chart.line', 'dots', 'flow', 'frame', 'lines', 'sequence', 'timeline', 'words']);
    expect([...explored].sort()).toEqual(['chart.bars', 'chart.curve', 'dots']);
    expect(new Set([...stages].map((s) => s.split('.')[0]))).toEqual(new Set(STAGE_KINDS));
    expect([...verbs].sort()).toEqual(['draw', 'focus', 'hide', 'merge', 'move', 'pulse', 'reorder', 'send', 'set', 'show', 'split', 'swap'].filter((v) => v !== 'merge').sort());
    expect([...captions].sort()).toEqual(['analogy', 'claim', 'example', 'framing', 'quote']);
    expect([...provenances].sort()).toEqual(['illustrative', 'sourced', 'worked']);
    expect(gates).toBeGreaterThan(100);
    expect(taps).toBeGreaterThan(20);
    expect(goals).toBeGreaterThan(20);
  });

  it('the learner acts in every clip of a generated lesson, and a lesson without gates is held to its explores', () => {
    for (const depth of DEPTH_NAMES) {
      for (const size of ['min', 'max', 5, 9] as const) {
        const clips = (buildClipLesson({ depth, size }).scenes as any[]).filter((s) => s.kind === 'clip');
        expect(clips.every((s) => s.explore !== undefined || s.beats.some((b: any) => b.gate !== undefined)), `${depth}/${size}`).toBe(true);
      }
    }
    // Explores alone can carry the rule: a lesson of dots and bars, no gate anywhere, two clips in three still act.
    const explores = checkLesson(assemble(buildClipLesson({ depth: 'standard', size: 'min', gates: false, stages: ['dots', 'chart'], provenance: 'worked' })));
    expect(explores.errors).toEqual([]);
    // Without either, the same lesson is refused for it, and for the stretch with nothing to do.
    const none = checkLesson(assemble(buildClipLesson({ depth: 'standard', size: 'min', gates: false, explore: false, stages: ['dots', 'chart'], provenance: 'worked' })));
    expect(none.errors.map((e) => e.code)).toContain('INTERACTIVE_SHARE');
  });

  it('a lesson of one stage kind passes, for every kind (frames within their limit)', () => {
    for (const kind of STAGE_KINDS) {
      const stages = kind === 'frame' ? (['frame', 'frame', 'words'] as const) : ([kind] as const);
      const { report } = passes({ depth: 'standard', size: 'max', stages: [...stages] });
      const used = new Set(report.lesson!.scenes.flatMap((s) => (s.kind === 'clip' ? [s.stage.kind] : [])));
      expect(used.has(kind), kind).toBe(true);
    }
  });

  it('every provenance passes at every size', () => {
    for (const provenance of ['sourced', 'worked', 'illustrative'] as const) {
      for (const size of ['min', 'max'] as const) {
        const report = checkLesson(assemble(buildClipLesson({ depth: 'standard', size, provenance })));
        expect(report.errors, `${provenance}/${size}`).toEqual([]);
      }
    }
  });

  it('plans of clips are accepted by checkPlan as they are', () => {
    for (const depth of DEPTH_NAMES) {
      for (const size of ['min', 'max', 5, 9] as const) {
        const parts = buildClipLesson({ depth, size });
        const draft = newDraft(parts.start);
        for (const item of parts.evidence) saveEvidence(draft, item);
        const check = checkPlan(parts.plan, draft);
        expect(check.errors, `${depth}/${size}`).toEqual([]);
        expect(check.warnings).toEqual([]);
      }
    }
  });
});

describe('time and determinism', () => {
  const draft = assemble(buildClipLesson({ depth: 'deep', size: 'max' }));

  it('a maximal deep lesson of clips is 16 scenes, 80 beats and 40 stored passages, with an explore that has a goal and a gate answered by a tap', () => {
    expect(draft.scenes).toHaveLength(16);
    expect(draft.evidence).toHaveLength(40);
    expect(draft.scenes.reduce((n, s) => n + (s.kind === 'clip' ? s.beats.length : 0), 0)).toBe(80);
    expect(draft.scenes.some((s) => s.kind === 'clip' && s.stage.kind === 'frame')).toBe(true);
    expect(draft.scenes.some((s) => s.kind === 'clip' && s.explore?.goal !== undefined)).toBe(true);
    expect(draft.scenes.some((s) => s.kind === 'clip' && s.beats.some((b) => b.gate !== undefined && 'pick' in b.gate))).toBe(true);
  });

  it('checkLesson on it takes well under 100 ms', () => {
    checkLesson(draft);
    const runs = 5;
    const start = performance.now();
    for (let i = 0; i < runs; i++) checkLesson(draft);
    const each = (performance.now() - start) / runs;
    expect(each).toBeLessThan(100);
  });

  it('the same draft gives the identical report and hash, twice and from a copy', () => {
    const a = checkLesson(draft);
    const b = checkLesson(draft);
    const c = checkLesson(JSON.parse(JSON.stringify(draft)) as Draft);
    expect(a.ok).toBe(true);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
    expect(c.hash).toBe(a.hash);
    expect(canonicalJson(c.lesson)).toBe(canonicalJson(a.lesson));
  });

  it('the same options build the same lesson, and checkScene says the same of each scene twice', () => {
    const one = buildClipLesson({ depth: 'standard', size: 11 });
    const two = buildClipLesson({ depth: 'standard', size: 11 });
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    const stored = assemble(one);
    for (const scene of one.scenes) expect(JSON.stringify(checkScene(scene, stored))).toBe(JSON.stringify(checkScene(scene, stored)));
  });
});
