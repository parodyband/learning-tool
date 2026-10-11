// The validator: four entry points, one per stage of building a lesson. Each takes an unknown
// value, sanitises it, applies the same small leniency, parses it with the strict schema and then
// applies the rules. Each is deterministic and offline: the same input gives the same report.
//
//   checkEvidence(input, draft)  one item for save_evidence
//   checkPlan(input, draft)      the outline for plan_lesson
//   checkScene(input, draft)     one scene for submit_scene
//   checkLesson(draft)           the whole draft; the only thing that decides "may be published"
//
// verifyLesson(lesson) re-validates a published lesson from its own data, for the `verify` command.
// checkStart(input) checks the arguments of start_lesson (shape, and the topic's text safety);
// evidenceUses(draft) is the running count behind EVIDENCE_OVERUSED, for the tools to show.
// A scene may be a clip (core/clip): its stage, beats and actions are checked by ./validate/stage,
// and a clip whose stage is a custom frame by the static checks of src/frame/check.ts.
// The rules live in ./validate/*.ts; the catalog of what they report is ./issues.ts.
import type { CheckEvidence, CheckLesson, CheckPlan, CheckScene } from './types';
import { checkEvidence as evidence } from './validate/evidence';
import { checkLesson as lesson } from './validate/lesson';
import { checkPlan as plan } from './validate/plan';
import { checkScene as scene } from './validate/scene';

export const checkEvidence: CheckEvidence = evidence;
export const checkPlan: CheckPlan = plan;
export const checkScene: CheckScene = scene;
export const checkLesson: CheckLesson = lesson;

export { normalizeSourceUrl } from './validate/evidence';
export { draftFromLesson, estimateMinutes, evidenceUses, MINUTES, verifyLesson, type MinuteCounts } from './validate/lesson';
export { topicIssues } from './validate/plan';
export { checkStart, type StartCheck } from './validate/start';
export { budgetFor, type SceneBudget } from './validate/words';
// Clips: which verb acts on which kind of part of a stage (what ACTION_VERB_NOT_ALLOWED checks by),
// the parts of a stage by id, and the stage kinds MOSTLY_ILLUSTRATIVE counts.
export { CORE_KIT_VERBS, DATA_STAGE_KINDS, STAGE_VERB_NOTES, kitVerbs, stageParts, verbSummary, type PartKind, type StagePart, type VerbTable } from './validate/stage';
