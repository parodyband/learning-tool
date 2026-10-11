// The rule set must be satisfiable: for each depth, the smallest lesson the format allows, the
// largest, and many shapes in between all pass. If two rules ever contradict each other (a budget
// that cannot be met with the minimum blocks, a citation limit too low for the largest lesson),
// this is where it shows. Also here: the time bound and determinism, on the largest lesson.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/core/hash';
import { DEPTHS, LIMITS as L, type Depth } from '../../src/core/limits';
import { FIGURE_TYPES, QUESTION_TYPES, Lesson } from '../../src/core/schema';
import type { Draft, LessonReport } from '../../src/core/types';
import { checkLesson, checkScene, verifyLesson } from '../../src/core/validate';
import { buildLesson, type BuildOptions } from './build';
import { assemble, expectNoExcerptText } from './helpers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEPTH_NAMES: Depth[] = ['quick', 'standard', 'deep'];
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 3);

function passes(options: BuildOptions): { draft: Draft; report: LessonReport } {
  const parts = buildLesson(options);
  const draft = assemble(parts);
  const report = checkLesson(draft);
  expect(report.errors, `${options.depth}/${options.size}`).toEqual([]);
  expect(report.ok).toBe(true);
  expect(report.complete).toBe(true);
  expect(Lesson.safeParse(report.lesson).success).toBe(true);
  return { draft, report };
}

describe.each(DEPTH_NAMES)('a %s lesson', (depth) => {
  const profile = DEPTHS[depth];

  it('passes at its minimum: fewest scenes, objectives, evidence and words', () => {
    const { draft, report } = passes({ depth, size: 'min' });
    expect(draft.outline).toHaveLength(profile.scenes.min);
    expect(draft.objectives).toHaveLength(profile.objectives.min);
    expect(report.stats.sources).toBeGreaterThanOrEqual(profile.evidenceMin);
    expect(report.stats.sources).toBeLessThanOrEqual(Math.max(profile.evidenceMin, 4));
    expect(report.warnings).toEqual([]);
  });

  it('passes at its maximum: most scenes and objectives, every scene filled to its budget', () => {
    const { draft, report } = passes({ depth, size: 'max' });
    expect(draft.outline).toHaveLength(profile.scenes.max);
    expect(draft.objectives).toHaveLength(profile.objectives.max);
    expect(draft.evidence).toHaveLength(L.evidencePerLesson);
    // Full to the brim: within 3% of the word limit, and warned about it, but not refused.
    expect(report.stats.words).toBeGreaterThan(profile.words.max * 0.93);
    expect(report.stats.words).toBeLessThanOrEqual(profile.words.max);
    expect(new Set(report.warnings.map((w) => w.code))).toEqual(new Set(['WORDS_NEAR_BUDGET', 'LESSON_LONG']));
    // Narration scenes sit exactly on their limit.
    for (const scene of draft.scenes) {
      if (scene.kind !== 'narration') continue;
      const metrics = checkScene(scene, draft).metrics!;
      expect(metrics.words).toBe(metrics.budget!.max);
    }
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
  it('every figure type and question type appears across the shapes', () => {
    const figures = new Set<string>();
    const questions = new Set<string>();
    const blocks = new Set<string>();
    for (const depth of DEPTH_NAMES) {
      for (const size of ['min', 'max', ...SEEDS] as const) {
        for (const scene of buildLesson({ depth, size }).scenes as Array<Record<string, any>>) {
          if (scene.figure) figures.add(scene.figure.type);
          if (scene.question) questions.add(scene.question.type);
          for (const block of scene.blocks ?? []) blocks.add(block.type);
        }
      }
    }
    expect([...figures].sort()).toEqual([...FIGURE_TYPES].sort());
    expect([...questions].sort()).toEqual([...QUESTION_TYPES].sort());
    expect([...blocks].sort()).toEqual(['analogy', 'claim', 'example', 'framing', 'quote']);
  });
});

describe('checkLesson on the largest lesson', () => {
  const draft = assemble(buildLesson({ depth: 'deep', size: 'max' }));

  it('is a lesson at the edge of every limit', () => {
    const report = checkLesson(draft);
    expect(report.ok).toBe(true);
    expect(report.stats.scenes).toBe(DEPTHS.deep.scenes.max);
    expect(report.stats.sources).toBe(L.evidencePerLesson);
    expect(draft.scenes.filter((s) => s.kind === 'step_through').every((s) => s.kind === 'step_through' && s.steps.length === L.steps.max)).toBe(true);
  });

  it('takes under 100 ms', () => {
    // The first call pays for compiling the code; a tool call later in a session does not.
    checkLesson(draft);
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      const report = checkLesson(draft);
      times.push(performance.now() - start);
      expect(report.ok).toBe(true);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(100);
    expect(times[times.length - 1]).toBeLessThan(100);
  });

  it('takes under 100 ms on the first call of a fresh process, before any code is warm', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lt-validate-'));
    try {
      const file = path.join(dir, 'draft.json');
      writeFileSync(file, JSON.stringify(draft));
      const script = `
        import { readFileSync } from 'node:fs';
        import { checkLesson } from './src/core/validate.ts';
        const draft = JSON.parse(readFileSync(process.env.LT_DRAFT, 'utf8'));
        const start = performance.now();
        const report = checkLesson(draft);
        console.log(JSON.stringify({ ok: report.ok, ms: performance.now() - start, hash: report.hash }));
      `;
      const stdout = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, LT_DRAFT: file } });
      const out = JSON.parse(stdout.trim().split('\n').pop() as string) as { ok: boolean; ms: number; hash: string };
      expect(out.ok).toBe(true);
      expect(out.ms).toBeLessThan(100);
      // Another process, another run: the same hash.
      expect(out.hash).toBe(checkLesson(draft).hash);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('gives the identical report and hash on every run', () => {
    const a = checkLesson(draft);
    const b = checkLesson(structuredClone(draft));
    const c = checkLesson(JSON.parse(JSON.stringify(draft)));
    expect(canonicalJson(b)).toBe(canonicalJson(a));
    expect(canonicalJson(c)).toBe(canonicalJson(a));
    expect(b.hash).toBe(a.hash);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('gives the identical report when the same lesson is built again from nothing', () => {
    const again = assemble(buildLesson({ depth: 'deep', size: 'max' }));
    expect(JSON.stringify(checkLesson(again))).toBe(JSON.stringify(checkLesson(draft)));
  });

  it('does not depend on the order in which scenes were accepted', () => {
    const shuffled = structuredClone(draft);
    shuffled.scenes.reverse();
    const a = checkLesson(draft);
    const b = checkLesson(shuffled);
    expect(b.hash).toBe(a.hash);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('does not depend on the key order of what is stored', () => {
    const reorder = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(reorder);
      if (!v || typeof v !== 'object') return v;
      return Object.fromEntries(Object.entries(v).reverse().map(([k, child]) => [k, reorder(child)]));
    };
    const turned = reorder(draft) as Draft;
    expect(checkLesson(turned).hash).toBe(checkLesson(draft).hash);
  });
});

describe('determinism of the smaller checks', () => {
  it('a rejected scene is reported identically twice, in the same order', () => {
    const base = assemble(buildLesson({ depth: 'standard', size: 'max' }));
    const broken = structuredClone(base.scenes.find((s) => s.kind === 'step_through')!) as any;
    broken.steps[0].highlight = ['nowhere'];
    broken.steps[1].blocks[0].cites = ['e999'];
    broken.steps[2].blocks[0].text = 'It counts 987654 items across 4321 shelves.';
    broken.title = 'See https://unknown.invalid/page';
    const a = checkScene(broken, base);
    const b = checkScene(structuredClone(broken), structuredClone(base));
    expect(a.ok).toBe(false);
    expect(a.errors.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
