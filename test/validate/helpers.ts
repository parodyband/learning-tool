// A minimal stand-in for the server's store, so tests drive the validator the way the tools do:
// evidence is saved through checkEvidence, the plan through checkPlan, scenes through checkScene.
import { expect } from 'vitest';
import { EXAMPLE_EVIDENCE, EXAMPLE_PLAN, EXAMPLE_SCENES, EXAMPLE_START } from '../../src/core/examples';
import { StartInput, type EvidenceInput, type PlanInput } from '../../src/core/schema';
import { canonical } from '../../src/core/text';
import type { Draft, Issue, SceneCheck, SceneInput, StartInputRaw } from '../../src/core/types';
import { checkEvidence, checkPlan, checkScene } from '../../src/core/validate';

export const LESSON_ID = 'abc123def456';

export function newDraft(start: StartInputRaw = EXAMPLE_START): Draft {
  const s = StartInput.parse(start);
  return {
    format: 'learning-tool/draft@1',
    id: LESSON_ID,
    createdAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-10T12:00:00.000Z',
    topic: s.topic,
    language: s.language,
    depth: s.depth,
    learner: s.learner,
    objectives: [],
    outline: [],
    evidence: [],
    scenes: [],
    activity: { calls: {}, rejects: {} },
  };
}

/** Save one evidence item as save_evidence does. Throws when it is refused. */
export function saveEvidence(draft: Draft, input: unknown): string {
  const check = checkEvidence(input, draft);
  if (check.duplicateOf) return check.duplicateOf;
  if (!check.ok || !check.evidence) throw new Error(`evidence refused: ${JSON.stringify(check.errors)}`);
  const id = `e${draft.evidence.length + 1}`;
  draft.evidence.push({ ...check.evidence, id, savedOn: '2026-10-10' });
  return id;
}

/** Store a plan as plan_lesson does, dropping orphaned scenes. Throws when it is refused. */
export function applyPlan(draft: Draft, input: unknown): void {
  const check = checkPlan(input, draft);
  if (!check.ok || !check.plan) throw new Error(`plan refused: ${JSON.stringify(check.errors)}`);
  setPlan(draft, check.plan);
  draft.scenes = draft.scenes.filter((s) => !(check.orphans ?? []).includes(s.id));
}

/** Store a plan without checking it, for tests of what checkLesson does with a plan that should never have been stored. */
export function setPlan(draft: Draft, plan: PlanInput): void {
  draft.title = plan.title;
  draft.objectives = plan.objectives;
  draft.outline = plan.outline;
}

/** Submit a scene as submit_scene does: stored (replacing the same id) only when accepted. */
export function submit(draft: Draft, input: unknown): SceneCheck {
  const check = checkScene(input, draft);
  if (check.ok && check.scene) {
    const scene = check.scene;
    draft.scenes = [...draft.scenes.filter((s) => s.id !== scene.id), scene];
  }
  return check;
}

export interface LessonParts {
  start: StartInputRaw;
  evidence: EvidenceInput[];
  plan: PlanInput;
  scenes: SceneInput[];
}

export const EXAMPLE_PARTS: LessonParts = { start: EXAMPLE_START, evidence: EXAMPLE_EVIDENCE, plan: EXAMPLE_PLAN, scenes: EXAMPLE_SCENES };

/** Build a draft through the four checks. Every step must be accepted, or this throws with the issues. */
export function assemble(parts: LessonParts): Draft {
  const draft = newDraft(parts.start);
  for (const item of parts.evidence) saveEvidence(draft, item);
  applyPlan(draft, parts.plan);
  for (const scene of parts.scenes) {
    const check = submit(draft, scene);
    if (!check.ok) throw new Error(`scene ${(scene as { id: string }).id} refused: ${JSON.stringify(check.errors, null, 1)}`);
  }
  return draft;
}

/** The example lesson with every scene accepted. A fresh copy each call. */
export function exampleDraft(): Draft {
  return assemble(structuredClone(EXAMPLE_PARTS));
}

/** A deep copy of example scene `id`, loosely typed so a test can break it. */
export function exampleScene(id: string): any {
  const scene = EXAMPLE_SCENES.find((s) => s.id === id);
  if (!scene) throw new Error(`no example scene ${id}`);
  return structuredClone(scene);
}

export function codes(result: { errors: Issue[]; warnings: Issue[] }): string[] {
  return [...new Set([...result.errors, ...result.warnings].map((i) => i.code))].sort();
}
export const errorCodes = (result: { errors: Issue[] }): string[] => result.errors.map((i) => i.code);
export const warningCodes = (result: { warnings: Issue[] }): string[] => result.warnings.map((i) => i.code);

/**
 * Excerpts are untrusted page text. Nothing an agent reads as instruction (message, fix, got,
 * expected, path) may carry a run of one; only `source` may.
 */
export function expectNoExcerptText(issues: readonly Issue[], draft: Draft, window = 24): void {
  const excerpts = draft.evidence.map((e) => canonical(e.excerpt));
  for (const i of issues) {
    for (const field of [i.message, i.fix, i.got ?? '', i.expected ?? '', i.path]) {
      const text = canonical(field);
      for (const excerpt of excerpts) {
        for (let at = 0; at + window <= excerpt.length; at += 4) {
          const piece = excerpt.slice(at, at + window);
          if (text.includes(piece)) expect.fail(`issue ${i.code} carries excerpt text "${piece}" in: ${field}`);
        }
      }
    }
  }
}

/** Every issue must say what to do, in a sentence, and carry the fields the contract names. */
export function expectActionable(issues: readonly Issue[]): void {
  for (const i of issues) {
    expect(i.code, 'code').toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/);
    expect(['error', 'warning'], `severity of ${i.code}`).toContain(i.severity);
    expect(typeof i.path, `path of ${i.code}`).toBe('string');
    expect(i.message.length, `message of ${i.code}`).toBeGreaterThan(10);
    expect(i.fix.length, `fix of ${i.code}`).toBeGreaterThan(10);
  }
}
