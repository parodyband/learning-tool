// The clips the skill writes out in full by hand, and the passages the lesson behind each had
// stored. Shared by the tests that hold those clips to the engine, to the validator and to the
// formula language.
//
// Every excerpt here is SYNTHETIC: written for these tests. Nothing in this file is a real citation.
import { ClipScene } from '../../src/core/clip';
import type { Evidence } from '../../src/core/schema';
import { exampleEvidence } from '../helpers/example';
import { syntheticEvidence } from './drafts';
import { markedExamples, rel, skillFiles } from './helpers';

/** What the lesson behind each worked clip had stored: the passages its captions and its stage cite. */
export const PASSAGES: Record<string, Record<string, string>> = {
  // "What a positive test really tells you"
  crowd: {
    e4: 'Breast cancer is uncommon at that age: of every 1,000 women who are screened at age 40, about 10 have breast cancer.',
    e5: 'The test finds most of them. Of 10 women who have breast cancer, 8 will get a positive result from the test.',
    e6: 'False alarms are common: of the 990 women who do not have cancer, 95 will also get a positive test result.',
    e9: 'Put the two groups together and 103 women in every thousand test positive, yet only 8 of those 103 women have cancer.',
  },
  // "How a price finds its level"
  market: {
    e2: 'When the price of a good rises, buyers want less of it, and sellers are willing to offer more of it for sale.',
    e3: 'The market price settles where the two meet: the price at which the amount offered for sale equals the amount buyers want.',
  },
  // "How binary search works"
  next: {
    e1: 'Binary search finds a target value in a sorted array by repeatedly comparing the target with the middle element and discarding the half that cannot contain it.',
  },
};

export interface HandWritten {
  at: string;
  file: string;
  clip: ClipScene;
}

/** Every clip the skill writes out in full without naming a source in the example files. */
export const HAND_WRITTEN: HandWritten[] = skillFiles()
  .flatMap((file) => markedExamples(file))
  .filter((ex) => ex.kind === 'scene' && ex.ref === undefined)
  .map((ex) => ({ at: `${rel(ex.file)}:${ex.line}`, file: ex.file, clip: ClipScene.parse(JSON.parse(ex.json)) }));
export const TYPED = HAND_WRITTEN.filter((h) => h.clip.stage.kind !== 'frame');
export const FRAMES = HAND_WRITTEN.filter((h) => h.clip.stage.kind === 'frame');

/** The passages a worked clip rests on: its own lesson's, or the example lesson's for the clips of the format reference. */
export const evidenceFor = (clip: ClipScene): Evidence[] => (PASSAGES[clip.id] ? syntheticEvidence(PASSAGES[clip.id]!) : exampleEvidence());
