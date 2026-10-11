// The example lesson as typed objects, for tests in every area. Read-only contract helper.
//
// `exampleLesson()` parses the example through the schema (so defaults are applied) and assembles a
// Lesson directly. It does not run the validator: areas that are built before the validator exists
// can still render and exercise a realistic lesson.
import { EXAMPLE_EVIDENCE, EXAMPLE_PLAN, EXAMPLE_SCENES, EXAMPLE_START } from '../../src/core/examples';
import { FORMAT, Lesson, Scene, StartInput, type Evidence } from '../../src/core/schema';
import type { Draft, LessonStats, Published, Receipt } from '../../src/core/types';

export const EXAMPLE_LESSON_ID = 'abc123def456';
export const EXAMPLE_HASH = 'a3f1c2d4e5b60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00';

export function exampleEvidence(): Evidence[] {
  return EXAMPLE_EVIDENCE.map((e, i) => ({ ...e, id: `e${i + 1}`, host: new URL(e.url).hostname, savedOn: '2026-10-10' }));
}

export function exampleLesson(): Lesson {
  const start = StartInput.parse(EXAMPLE_START);
  return Lesson.parse({
    format: FORMAT,
    id: EXAMPLE_LESSON_ID,
    title: EXAMPLE_PLAN.title,
    topic: start.topic,
    language: start.language,
    depth: start.depth,
    level: start.learner.level,
    objectives: EXAMPLE_PLAN.objectives,
    evidence: exampleEvidence(),
    scenes: EXAMPLE_SCENES.map((s) => Scene.parse(s)),
  });
}

export function exampleStats(): LessonStats {
  return { scenes: 9, words: 349, minutes: 8, claims: 8, quotes: 1, sources: 5, pages: 5, hosts: 3, checkpoints: 3, figures: 3, uncitedShare: 0.249, exampleShare: 0.266, weakClaims: 0 };
}

export function exampleReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return { generator: 'learning-tool', version: '0.1.0', rules: '1', hash: EXAMPLE_HASH, validatedOn: '2026-10-10', stats: exampleStats(), warnings: {}, weakClaims: [], ...overrides };
}

export function examplePublished(overrides: Partial<Published> = {}): Published {
  return { lesson: exampleLesson(), receipt: exampleReceipt(), ...overrides };
}

/** A draft at the point where every example scene has been accepted. */
export function exampleDraft(): Draft {
  const start = StartInput.parse(EXAMPLE_START);
  return {
    format: 'learning-tool/draft@1',
    id: EXAMPLE_LESSON_ID,
    createdAt: '2026-10-10T12:00:00.000Z',
    updatedAt: '2026-10-10T12:00:00.000Z',
    topic: start.topic,
    language: start.language,
    depth: start.depth,
    learner: start.learner,
    title: EXAMPLE_PLAN.title,
    objectives: EXAMPLE_PLAN.objectives,
    outline: EXAMPLE_PLAN.outline,
    evidence: exampleEvidence(),
    scenes: EXAMPLE_SCENES.map((s) => Scene.parse(s)),
    activity: { calls: {}, rejects: {} },
  };
}
