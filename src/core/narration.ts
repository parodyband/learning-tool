// What a lesson says aloud. One segment per stretch of text the player shows at one time, so a clip
// can be played beside exactly the words it reads.
//
// Only lesson text written for the learner is narrated: block texts (the caption of a beat is a
// block), a step-through's intro, a checkpoint's prompt and the recap's takeaways. Never an evidence
// excerpt, never feedback or an explanation (they would give answers away), never the prediction
// of a beat, and nothing from the learner's profile, which is not in a Lesson at all.
//
// Environment-neutral: no node: imports. (core/clip is imported for its types only.)
import type { LessonV2 } from './clip';
import { plainText } from './markup';
import type { Block } from './schema';
import type { NarrationSegment } from './types';

/** Spoken before an analogy's `limits`, so a listener hears where the comparison stops, as a reader sees it labelled. */
export const ANALOGY_LIMITS_LEAD = 'Where this comparison breaks down:';

const ENDS_SENTENCE = /[.!?:;…。！？][)\]"'’”»]*$/u;

/** Plain text of one prose string, closed with a full stop so that consecutive blocks do not run together when spoken. */
function sentence(src: string): string {
  const text = plainText(src).replace(/\s+/g, ' ').trim();
  if (text === '') return '';
  return ENDS_SENTENCE.test(text) ? text : `${text}.`;
}

function blockText(block: Block): string {
  if (block.type === 'analogy') return `${sentence(block.text)} ${ANALOGY_LIMITS_LEAD} ${sentence(block.limits)}`;
  return sentence(block.text);
}

function blocksText(blocks: Block[]): string {
  return blocks
    .map(blockText)
    .filter((t) => t !== '')
    .join(' ');
}

/**
 * The narration segment id of beat `index` (0-based) of a clip: "<sceneId>.beat<N>", N from 1. The
 * same id as `beatSegmentId` in core/clip and `beatSegment` in render/clip (a test holds them
 * equal); written here so that this file loads no schema.
 */
export function beatSegment(sceneId: string, index: number): string {
  return `${sceneId}.beat${index + 1}`;
}

/**
 * The narration of a lesson, in the order it is shown.
 *
 * - A clip gives one segment for each beat, `<sceneId>.beat<N>` (1-based): the caption's text (an
 *   analogy with its limits, as below). A beat's prediction (`gate`) is never narrated: the
 *   learner answers it before the caption is shown.
 * - A narration scene is one segment with id `<sceneId>`: every block text in order.
 * - A step-through gives `<sceneId>.intro` when it has an intro, then `<sceneId>.step<N>` (1-based)
 *   for each step.
 * - A checkpoint is one segment `<sceneId>`: its prompt.
 * - The recap is one segment `<sceneId>`: its takeaways.
 *
 * Text is plain (`plainText`): no markup, no citation markers.
 */
export function narrationSegments(lesson: LessonV2): NarrationSegment[] {
  const out: NarrationSegment[] = [];
  const push = (id: string, sceneId: string, text: string): void => {
    if (text !== '') out.push({ id, sceneId, text });
  };
  for (const scene of lesson.scenes) {
    switch (scene.kind) {
      case 'clip':
        scene.beats.forEach((beat, i) => push(beatSegment(scene.id, i), scene.id, blockText(beat.caption)));
        break;
      case 'narration':
        push(scene.id, scene.id, blocksText(scene.blocks));
        break;
      case 'step_through':
        if (scene.intro !== undefined) push(`${scene.id}.intro`, scene.id, sentence(scene.intro));
        scene.steps.forEach((step, i) => push(`${scene.id}.step${i + 1}`, scene.id, blocksText(step.blocks)));
        break;
      case 'checkpoint':
        push(scene.id, scene.id, sentence(scene.question.prompt));
        break;
      case 'recap':
        push(
          scene.id,
          scene.id,
          scene.takeaways
            .map((t) => sentence(t.text))
            .filter((t) => t !== '')
            .join(' '),
        );
        break;
    }
  }
  return out;
}
