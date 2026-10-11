// The v2 example lesson (src/core/clip-examples.ts) as typed objects, for tests in every area.
//
// Like test/helpers/example.ts it parses through the schema (so defaults are applied) and does not
// run the validator.
import { EXAMPLE_CLIPS, EXAMPLE_V2_SCENES, EXPLORE_EXAMPLE_CLIPS, EXPLORE_EXAMPLE_EVIDENCE, type AnySceneInput, type ClipSceneInput } from '../../src/core/clip-examples';
import { AnyScene, ClipScene, LessonV2 } from '../../src/core/clip';
import { EXAMPLE_PLAN, EXAMPLE_START } from '../../src/core/examples';
import { FORMAT, StartInput, type Evidence } from '../../src/core/schema';
import type { Published, Receipt } from '../../src/core/types';
import { SILENT_MP3_BASE64 } from '../player/shell-silence';
import { EXAMPLE_LESSON_ID, exampleEvidence, exampleReceipt } from './example';

/**
 * The example lesson's evidence (e1 to e5) followed by the passages the explore examples carry
 * (EXPLORE_EXAMPLE_EVIDENCE, e6 to e9). All of it is synthetic.
 */
export function exploreEvidence(): Evidence[] {
  const base = exampleEvidence();
  return [...base, ...EXPLORE_EXAMPLE_EVIDENCE.map((e, i) => ({ ...e, id: `e${base.length + i + 1}`, host: new URL(e.url).hostname, savedOn: '2026-10-11' }))];
}

/** A lesson made of the given scenes, with the example's header and evidence (and the explore examples' passages after it). */
export function lessonOf(scenes: readonly AnySceneInput[], title: string = EXAMPLE_PLAN.title): LessonV2 {
  const start = StartInput.parse(EXAMPLE_START);
  return LessonV2.parse({
    format: FORMAT,
    id: EXAMPLE_LESSON_ID,
    title,
    topic: start.topic,
    language: start.language,
    depth: start.depth,
    level: start.learner.level,
    objectives: EXAMPLE_PLAN.objectives,
    evidence: scenes.some((s) => s.kind === 'clip' && s.explore !== undefined) ? exploreEvidence() : exampleEvidence(),
    scenes: scenes.map((s) => AnyScene.parse(s)),
  });
}

/** The three clips that end in an explore (dots, a curve chart, bars), in a lesson of their own. */
export function exploreLesson(): LessonV2 {
  return lessonOf(Object.values(EXPLORE_EXAMPLE_CLIPS), 'Three clips you can poke');
}

/** The example lesson as clips: six clips, three checkpoints and the recap. */
export function exampleLessonV2(): LessonV2 {
  return lessonOf(EXAMPLE_V2_SCENES);
}

/** One clip per stage kind, in a lesson of their own. */
export function exampleKitsLesson(kinds: readonly (keyof typeof EXAMPLE_CLIPS)[] = Object.keys(EXAMPLE_CLIPS) as (keyof typeof EXAMPLE_CLIPS)[]): LessonV2 {
  return lessonOf(
    kinds.map((k) => EXAMPLE_CLIPS[k]),
    'One clip of every kind',
  );
}

/** A parsed clip of the example lesson, by scene id ("c1".."c6"). */
export function exampleClip(id: string): ClipScene {
  const scene = EXAMPLE_V2_SCENES.find((s) => s.id === id);
  if (!scene || scene.kind !== 'clip') throw new Error(`The v2 example has no clip "${id}".`);
  return ClipScene.parse(scene);
}

export function parseClip(input: ClipSceneInput): ClipScene {
  return ClipScene.parse(input);
}

/** What the renderer is given. The receipt is the example's, with the scene count of this lesson. */
export function asPublished(lesson: LessonV2, overrides: Partial<Published> = {}): Published {
  const receipt: Receipt = exampleReceipt();
  receipt.stats = { ...receipt.stats, scenes: lesson.scenes.length };
  return { lesson, receipt, ...overrides };
}

export function examplePublishedV2(overrides: Partial<Published> = {}): Published {
  return asPublished(exampleLessonV2(), overrides);
}

/** Segment ids of every beat of every clip in a lesson: "<sceneId>.beat<N>". */
export function beatSegments(lesson: LessonV2): string[] {
  return lesson.scenes.flatMap((s) => (s.kind === 'clip' ? s.beats.map((_, i) => `${s.id}.beat${i + 1}`) : []));
}

/** The lesson with a silent narration clip for every beat. Nothing here can make a sound. */
export function withSilentBeats(published: Published = examplePublishedV2()): Published {
  const segments = beatSegments(published.lesson);
  return { ...published, audio: { provider: 'elevenlabs', voice: 'Test Voice', clips: segments.map((segmentId) => ({ segmentId, mime: 'audio/mpeg', base64: SILENT_MP3_BASE64 })) } };
}
