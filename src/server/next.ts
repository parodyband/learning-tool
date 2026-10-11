// Where a lesson stands and what to do next. Every tool result carries the answer, so an agent that
// has lost the thread, or has just been told "rejected", is never left to guess. This is the one
// place that decides it: handlers pass the draft and what just happened, and nothing else computes
// a `next`.
import { ISSUES } from '../core/issues';
import { DEPTHS, LIMITS as L } from '../core/limits';
import type { Draft, Issue, LessonReport, Stage } from '../core/types';
import { checkLesson } from '../core/validate';

export const TOOL_NAMES = ['start_lesson', 'save_evidence', 'plan_lesson', 'submit_scene', 'validate_lesson', 'publish_lesson', 'get_lesson', 'get_guide'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface Next {
  /** The tool to call next, or "reply" when it is time to answer the learner. */
  tool: ToolName | 'reply';
  why: string;
}

/** What the call being answered did, where that changes what comes next. */
export interface Outcome {
  /** The tool that was called. */
  tool?: ToolName;
  /** The call was rejected with these errors. Only save_evidence can have stored something all the same: see `evidence`. */
  rejected?: readonly Issue[];
  /** The scene a rejected submit_scene was about, when it could be told. */
  sceneId?: string;
  /** The whole-lesson report, when the handler already has one for the draft as it now is. */
  report?: LessonReport;
  /** The lessonId was malformed, not on this machine, or its draft is damaged. */
  missing?: boolean;
  /** The server itself failed: the folder cannot be written, or an unexpected error. */
  failed?: boolean;
  /** get_lesson with no id found this many lessons. */
  listed?: number;
  /**
   * save_evidence judged the items one by one: how many it stored, and the indexes of those it
   * refused. Absent when the call was refused as a whole, and then nothing was stored.
   */
  evidence?: { saved: number; refused: readonly number[] };
  /** The field of this result that lists the whole-lesson errors, such as "errors" or "lessonReport.errors". */
  errorsAt?: string;
  /** The draft records a publication, but the published file is no longer on disk. */
  fileMissing?: boolean;
}

export interface Progress {
  stage: Stage;
  /** Planned scene ids, in order. */
  planned: string[];
  accepted: string[];
  pending: string[];
  /** Present once every planned scene is accepted. */
  report?: LessonReport;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ids = (items: unknown): string[] => (Array.isArray(items) ? items : []).flatMap((item) => (isRecord(item) && typeof item.id === 'string' ? [item.id] : []));
const unique = (items: readonly string[]): string[] => [...new Set(items)];
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
/** A list short enough to read in a sentence. */
const some = (items: readonly string[], max = 8): string => (items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} and ${items.length - max} more`);
const quoted = (items: readonly string[]): string[] => items.map((item) => `"${item}"`);

/**
 * The stage of a draft, from what it holds:
 *   started      nothing stored yet
 *   researching  evidence, no plan
 *   planned      a plan, no accepted scene
 *   writing      some scenes accepted, or all of them but the lesson has errors
 *   ready        every scene accepted and the whole lesson passes
 *   published    ready, and the published file is this exact lesson
 * A lesson that was published and then changed is "ready" (or "writing") again until it is republished.
 * So is one whose published file has gone: this function reads only the draft, and the envelope,
 * which is told when the file is missing, lowers "published" to "ready" (see `Outcome.fileMissing`).
 */
export function progress(draft: Draft, report?: LessonReport): Progress {
  const planned = unique(ids(draft.outline));
  const hasPlan = planned.length > 0 && typeof draft.title === 'string' && draft.title !== '';
  if (!hasPlan) {
    const evidence = Array.isArray(draft.evidence) ? draft.evidence.length : 0;
    return { stage: evidence === 0 ? 'started' : 'researching', planned: [], accepted: [], pending: [] };
  }
  const stored = new Set(ids(draft.scenes));
  const accepted = planned.filter((id) => stored.has(id));
  const pending = planned.filter((id) => !stored.has(id));
  if (accepted.length === 0) return { stage: 'planned', planned, accepted, pending };
  if (pending.length > 0) return { stage: 'writing', planned, accepted, pending };
  const whole = report ?? checkLesson(draft);
  if (!whole.ok) return { stage: 'writing', planned, accepted, pending, report: whole };
  const published = isRecord(draft.published) && typeof draft.published.hash === 'string' && draft.published.hash === whole.hash;
  return { stage: published ? 'published' : 'ready', planned, accepted, pending, report: whole };
}

/** A stored scene that could carry a prediction and has none: a clip with no `gate` and no `explore`, or (in a lesson made before clips) a step-through with no `predict`. */
export interface Unpredicted {
  id: string;
  kind: 'clip' | 'step_through';
}

/**
 * Whether a stored scene asks the learner to do something: a clip with a `gate` on a beat (by
 * options or by a tap) or an `explore` after its last beat; a step-through with a `predict` on a
 * step. What PASSIVE_RUN and INTERACTIVE_SHARE count.
 */
export function hasLearnerAction(scene: Record<string, unknown>): boolean {
  const some = (list: unknown, key: string): boolean => Array.isArray(list) && list.some((item) => isRecord(item) && item[key] !== undefined);
  return scene.kind === 'clip' ? some(scene.beats, 'gate') || isRecord(scene.explore) : some(scene.steps, 'predict');
}

/**
 * The stored clips with nothing for the learner to do, in outline order: the scenes
 * INTERACTIVE_SHARE is settled in. A gate or an explore in enough of them is the repair; the plan
 * is not what has to change.
 */
export function idleClips(draft: Draft): string[] {
  const stored = new Map<string, Record<string, unknown>>();
  for (const scene of Array.isArray(draft.scenes) ? (draft.scenes as unknown[]) : []) if (isRecord(scene) && typeof scene.id === 'string') stored.set(scene.id, scene);
  const out: string[] = [];
  for (const entry of Array.isArray(draft.outline) ? (draft.outline as unknown[]) : []) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || out.includes(entry.id)) continue;
    const scene = stored.get(entry.id);
    if (scene !== undefined && scene.kind === 'clip' && !hasLearnerAction(scene)) out.push(entry.id);
  }
  return out;
}

/**
 * Stored scenes that have no prediction and sit in a stretch of more than `passiveRun` scenes with
 * no checkpoint and no prediction: the scenes PASSIVE_RUN is settled in.
 *
 * The plan rule counts any clip as something to do, because an outline cannot say whether it will
 * carry a prediction; the lesson rule needs the prediction. So a plan that was accepted can only
 * fail PASSIVE_RUN through clips written without a `gate`, and adding one there is the repair: the
 * plan is not what has to change. The same holds for the step-throughs of a lesson made before
 * clips, and their `predict`.
 *
 * With `pendingPredict`, scenes not yet stored are read at their best: a planned clip is taken to
 * have a prediction. What is returned then is certain to fail whatever the rest turns out to be.
 */
export function unpredicted(draft: Draft, options: { pendingPredict?: boolean } = {}): Unpredicted[] {
  const stored = new Map<string, Record<string, unknown>>();
  for (const scene of Array.isArray(draft.scenes) ? (draft.scenes as unknown[]) : []) if (isRecord(scene) && typeof scene.id === 'string') stored.set(scene.id, scene);
  const seen = new Set<string>();
  const scenes: { id: string; passive: boolean; lacks: Unpredicted['kind'] | null }[] = [];
  for (const entry of Array.isArray(draft.outline) ? (draft.outline as unknown[]) : []) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const scene = stored.get(entry.id);
    const kind = scene && typeof scene.kind === 'string' ? scene.kind : entry.kind;
    const could = kind === 'clip' || kind === 'step_through';
    const predicts = scene ? hasLearnerAction(scene) : options.pendingPredict === true;
    const active = kind === 'checkpoint' || (could && predicts);
    scenes.push({ id: entry.id, passive: !active, lacks: could && scene !== undefined && !predicts ? kind : null });
  }
  const out: Unpredicted[] = [];
  let start = 0;
  for (let i = 0; i <= scenes.length; i++) {
    if (i < scenes.length && (scenes[i] as { passive: boolean }).passive) continue;
    if (i - start > L.passiveRun) for (const scene of scenes.slice(start, i)) if (scene.lacks !== null) out.push({ id: scene.id, kind: scene.lacks });
    start = i + 1;
  }
  return out;
}

/** How to add the prediction PASSIVE_RUN asks for, in the words of the scenes that lack one. */
function predictionAdvice(lacking: readonly Unpredicted[]): string {
  const clips = lacking.filter((s) => s.kind === 'clip').map((s) => s.id);
  const steppers = lacking.filter((s) => s.kind === 'step_through').map((s) => s.id);
  const parts: string[] = [];
  if (clips.length === 1) parts.push(`a "gate" on the beat of "${clips[0]}" that shows an outcome (or an "explore" after its last beat)`);
  else if (clips.length > 1) parts.push(`a "gate" on a beat that shows an outcome (or an "explore"), in one of ${some(quoted(clips), 6)}`);
  if (steppers.length > 0) parts.push(`a "predict" on one step of ${some(quoted(steppers), 6)}`);
  return ` PASSIVE_RUN needs ${parts.join(', or ')}; the plan can stay as it is.`;
}

/** How to settle INTERACTIVE_SHARE, in the words of the clips that have nothing for the learner to do. */
function actionAdvice(idle: readonly string[], error: Issue): string {
  // "2 of the lesson's 6 clips ... at least 4 must": how many more is read from the error itself.
  const got = Number(error.got);
  const needed = Number(/at least ([0-9]+)/.exec(error.expected ?? '')?.[1]);
  const short = Number.isFinite(got) && Number.isFinite(needed) && needed > got ? needed - got : 1;
  const where = idle.length === 1 ? `"${idle[0]}"` : `${short === 1 ? 'one' : short} of ${some(quoted(idle), 6)}`;
  return ` INTERACTIVE_SHARE needs a "gate" on a beat that shows an outcome (options, or a part of the picture to tap) or an "explore" after the last beat, in ${where}; the plan can stay as it is.`;
}

/** The validator's group of codes about what a clip hands to the learner: an explore, its formulas, a gate answered by a tap. */
const isInteractive = (code: string): boolean => Object.hasOwn(ISSUES, code) && (ISSUES as Record<string, { group: string }>)[code]?.group === 'interactive';

/** Whole-lesson errors that only a different outline resolves. */
const PLAN_CODES = new Set(['NO_PLAN', 'NARRATION_RUN', 'PASSIVE_RUN', 'NO_FIGURE', 'OBJECTIVE_UNASSESSED']);
/** Whole-lesson errors that call for more, or other, stored passages. */
const EVIDENCE_CODES = new Set(['EVIDENCE_OVERUSED', 'EVIDENCE_URL']);
/** Errors about the shape of something stored. With no scene named, the thing that is damaged is the plan. */
const SHAPE_CODES = new Set(['UNKNOWN_FIELD', 'MISSING_FIELD', 'WRONG_TYPE', 'TOO_LONG', 'TOO_SHORT', 'TOO_MANY', 'TOO_FEW', 'BAD_VALUE', 'BAD_ID', 'INPUT_TOO_DEEP', 'INPUT_CYCLE', 'INPUT_TOO_LARGE']);

type Repair = 'plan_lesson' | 'save_evidence' | 'submit_scene';

function repairFor(error: Issue, draft: Draft, report: LessonReport, lacking: readonly Unpredicted[]): Repair {
  if (error.sceneId !== undefined) return 'submit_scene';
  // A prediction in a clip that is already there settles it; only when no scene can take one is the outline at fault.
  if (error.code === 'PASSIVE_RUN' && lacking.length > 0) return 'submit_scene';
  if (error.code.startsWith('PLAN_') || PLAN_CODES.has(error.code) || SHAPE_CODES.has(error.code)) return 'plan_lesson';
  if (EVIDENCE_CODES.has(error.code)) return 'save_evidence';
  if (error.code === 'EVIDENCE_TOO_FEW') {
    // Stored passages the lesson does not use yet can be cited without more research.
    const stored = Array.isArray(draft.evidence) ? draft.evidence.length : 0;
    return stored > report.stats.sources ? 'submit_scene' : 'save_evidence';
  }
  return 'submit_scene';
}

/** Every scene is in but the lesson does not pass: name the tool that resolves the first thing in the way. */
function repair(draft: Draft, report: LessonReport, outcome: Outcome): Next {
  const errors = report.errors.filter((e) => e.code !== 'MORE_ISSUES' && e.code !== 'LESSON_INCOMPLETE');
  const count = plural(errors.length, 'error blocks', 'errors block');
  // An error is only ever pointed at where this result shows it.
  const where = outcome.errorsAt !== undefined ? `"${outcome.errorsAt}" has each error with its "fix"` : 'validate_lesson lists each error with its "fix"';
  const lacking = errors.some((e) => e.code === 'PASSIVE_RUN') ? unpredicted(draft) : [];

  const plan = errors.find((e) => repairFor(e, draft, report, lacking) === 'plan_lesson');
  if (plan) {
    const lead = outcome.tool === 'plan_lesson' ? `The plan is stored, but ${count} publishing and this plan still has ${plan.code}, which is about the outline` : `${count} publishing, and ${plan.code} is about the outline`;
    return { tool: 'plan_lesson', why: `${lead}: ${where}. Change the outline as that fix says, call plan_lesson with the whole plan, then submit the scenes the new plan adds.` };
  }
  const evidence = errors.find((e) => repairFor(e, draft, report, lacking) === 'save_evidence');
  if (evidence) {
    return {
      tool: 'save_evidence',
      why: `${count} publishing, and ${evidence.code} needs passages that are not stored yet: ${where}. Research, save them, cite them where the fix says, and resubmit those scenes.`,
    };
  }
  // Too few clips with something to do: a gate or an explore in the clips that have neither settles it.
  const share = errors.find((e) => e.code === 'INTERACTIVE_SHARE');
  const idle = share ? idleClips(draft) : [];
  // One prediction settles a stretch, so a single scene that lacks one is named as the scene to resubmit; of several, the agent chooses.
  const scenes = unique([...errors.flatMap((e) => (e.sceneId !== undefined ? [e.sceneId] : [])), ...(lacking.length === 1 ? [(lacking[0] as Unpredicted).id] : []), ...(idle.length === 1 ? idle : [])]);
  if (scenes.length > 0 || lacking.length > 0 || idle.length > 0) {
    const fix = scenes.length > 0 ? ` Fix and resubmit ${some(scenes)}.` : '';
    return { tool: 'submit_scene', why: `Every scene is accepted, but ${count} publishing: ${where}.${fix}${lacking.length > 0 ? predictionAdvice(lacking) : ''}${share && idle.length > 0 ? actionAdvice(idle, share) : ''}` };
  }
  const first = errors[0];
  return {
    tool: 'submit_scene',
    why: first
      ? `Every scene is accepted, but ${count} publishing (${first.code} first): ${where}, which names what to change. Resubmit the scenes you change.`
      : 'Every scene is accepted, but the lesson does not pass yet. Call validate_lesson to see why.',
  };
}

/** What to do when the call that was just made was rejected. */
function afterRejection(draft: Draft | null, outcome: Outcome): Next | null {
  const errors = outcome.rejected ?? [];
  if (errors.length === 0 || outcome.tool === undefined) return null;
  const codes = new Set(errors.map((e) => e.code));
  switch (outcome.tool) {
    case 'start_lesson':
      return { tool: 'start_lesson', why: 'No lesson was started. Correct the arguments named in errors and call start_lesson again.' };
    case 'save_evidence': {
      // The one tool where a rejected call may have stored something: its items are judged one by one.
      const judged = outcome.evidence;
      if (!judged) {
        return { tool: 'save_evidence', why: 'Nothing was saved from this call. Correct what the error\'s "fix" says and call save_evidence again with "items": an array of 1 to 10 evidence items.' };
      }
      const refused = some(judged.refused.map((index) => `items[${index}]`));
      const again = `Correct ${refused} as each error's "fix" says and send only ${judged.refused.length === 1 ? 'that item' : 'those items'} again`;
      if (judged.saved === 0) return { tool: 'save_evidence', why: `Nothing was saved from this call: every item was refused. ${again}.` };
      return { tool: 'save_evidence', why: `${plural(judged.saved, 'item was', 'items were')} saved and must not be sent again ("items" has the ids). ${again}.` };
    }
    case 'plan_lesson':
      return {
        tool: 'plan_lesson',
        why: `The plan was not stored${draft && progress(draft).planned.length > 0 ? '; the earlier plan still stands' : ''}. ${
          codes.has('PLAN_LEGACY_KIND') ? 'Plan every teaching scene as a clip (kind "clip", with the "stage" that shows the idea), then' : 'Change what each error\'s "fix" says and'
        } call plan_lesson again with the whole plan.`,
      };
    case 'submit_scene': {
      if (codes.has('NO_PLAN')) return { tool: 'plan_lesson', why: 'There is no accepted plan yet, so no scene can be checked. Call plan_lesson first; it returns a template for every scene.' };
      const scene = outcome.sceneId !== undefined ? `"${outcome.sceneId}"` : 'The scene';
      // A custom frame is refused for its code as often as for its shape, and the code is the one thing no template shows.
      const frame = errors.some((e) => e.code.startsWith('FRAME_')) ? ' For the code of a frame, get_guide section "frame-api" lists what it may use.' : '';
      // An explore, a formula or a tap gate: say what the check did, so the fix reads as it is meant.
      const interactive = errors.filter((e) => isInteractive(e.code));
      const explore =
        interactive.length === 0
          ? ''
          : interactive.every((e) => e.code.startsWith('PICK_'))
            ? ' A gate answered by a tap can only name parts that are on stage before its own beat plays.'
            : interactive.some((e) => e.code.startsWith('FORMULA_'))
              ? ' Every formula is tried over the whole range of its sliders: where a value fails, the error names the first setting at which it does.'
              : ' An explore is tried at every position of its sliders before the clip is accepted.';
      return { tool: 'submit_scene', why: `${scene} was not stored. Change only what each error's "fix" says and submit it again under the same id.${frame}${explore}` };
    }
    default:
      return { tool: outcome.tool, why: `Correct the arguments named in errors and call ${outcome.tool} again.` };
  }
}

/**
 * The next action for a lesson, or for no lesson at all. Pure: the same draft and outcome give the
 * same answer. (It validates the whole lesson when every scene is in and no report was passed.)
 */
export function nextStep(draft: Draft | null, outcome: Outcome = {}): Next {
  if (outcome.failed) {
    return { tool: 'reply', why: 'Learning Tool could not do this on this machine (see errors). Tell the learner what went wrong. Do not write the lesson by any other means.' };
  }
  if (!draft) {
    const rejected = afterRejection(null, outcome);
    if (rejected && !outcome.missing) return rejected;
    if (outcome.missing) {
      return { tool: 'get_lesson', why: 'That lessonId cannot be used. Call get_lesson with no arguments to list the lessons on this machine, or start_lesson to begin a new one.' };
    }
    if (outcome.listed !== undefined && outcome.listed > 0) {
      return { tool: 'get_lesson', why: 'Pass a lessonId from "lessons" to see where that lesson stands and what it needs next, or call start_lesson for a new lesson.' };
    }
    if (outcome.tool === 'get_guide') {
      return { tool: 'start_lesson', why: 'If a lesson is under way, carry on where its last result pointed (get_lesson shows it again). Otherwise calibrate with the learner, then call start_lesson.' };
    }
    return { tool: 'start_lesson', why: 'No lesson is open. Ask the learner 2 or 3 calibration questions in one message, then call start_lesson.' };
  }

  const rejected = afterRejection(draft, outcome);
  if (rejected) return rejected;

  const p = progress(draft, outcome.report);
  const stored = Array.isArray(draft.evidence) ? draft.evidence.length : 0;
  const needed = (DEPTHS[draft.depth] ?? DEPTHS.standard).evidenceMin;

  switch (p.stage) {
    case 'started':
      return { tool: 'save_evidence', why: 'Research the topic with your own web search and fetch tools, then store each passage you will rely on. Plan after you have read the sources.' };
    case 'researching':
      if (stored < needed) {
        return { tool: 'save_evidence', why: `${plural(stored, 'excerpt is', 'excerpts are')} stored, and a ${draft.depth} lesson must cite at least ${needed}. Keep researching and saving; aim for more than the minimum, from at least two sites.` };
      }
      return { tool: 'plan_lesson', why: `${plural(stored, 'excerpt is', 'excerpts are')} stored. Plan the objectives and the outline around what they support. You can save more evidence at any time.` };
    case 'planned':
      if (stored === 0) {
        return { tool: 'save_evidence', why: 'A plan is stored but no evidence is, and every claim must cite a stored excerpt. Research and save evidence first, then adjust the plan to what the sources support.' };
      }
      return {
        tool: 'submit_scene',
        why: `The plan is stored. Submit the first scene ("${p.pending[0] ?? p.planned[0]}") alone and read the result before you write the others.`,
      };
    case 'writing':
      if (p.pending.length > 0) {
        return {
          tool: 'submit_scene',
          why: `${p.accepted.length} of ${p.planned.length} scenes are accepted. Still to submit: ${some(p.pending)}${p.pending.length > 1 ? ' (in parallel if your host allows)' : ''}.`,
        };
      }
      return repair(draft, p.report as LessonReport, outcome);
    case 'ready':
      return {
        tool: 'publish_lesson',
        why: draft.published
          ? 'The lesson has changed since it was published and passes every check. Call publish_lesson to replace the published page.'
          : 'Every scene is accepted and the lesson passes every check. Call publish_lesson.',
      };
    case 'published':
      if (outcome.fileMissing) {
        return { tool: 'publish_lesson', why: 'The lesson was published, but its file is no longer in the Learning Tool folder (deleted or moved). Call publish_lesson: it writes the same file again.' };
      }
      return {
        tool: 'reply',
        why: 'The lesson is published. Give the learner the file, which always works, then the local link if there is one (it works only while this app is open), the title and the length, and the warning count if any. Do not summarise the lesson or reveal checkpoint answers.',
      };
  }
}
