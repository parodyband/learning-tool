// submit_scene: check one scene and, if it has no errors, store it in place of any earlier version
// with the same id. validate_lesson: the whole-lesson report, changing nothing.
import { ISSUES } from '../../core/issues';
import { sanitizeText } from '../../core/text';
import { DEPTHS, LIMITS as L } from '../../core/limits';
import { PLAN_CHART_MARKS, type OutlineEntry, type PlanChartMark } from '../../core/schema';
import { templateFor } from '../../core/templates';
import type { Draft, Issue, LessonReport, SceneMetrics } from '../../core/types';
import { checkLesson, checkScene, evidenceUses } from '../../core/validate';
import { capIssueList, countByCode } from '../envelope';
import { serverIssue } from '../issues';
import { hasLearnerAction, unpredicted } from '../next';
import { outlineEntries, type Handler } from './common';
import { lessonCall, type Work } from './lesson-call';

/** Errors that mean the scene's shape is off, where seeing the template again is the quickest way to put it right. */
const SHAPE_TROUBLE = new Set(['UNKNOWN_FIELD', 'MISSING_FIELD', 'WRONG_TYPE', 'BAD_VALUE', 'SCENE_KIND_MISMATCH', 'SCENE_SHAPE_MISMATCH']);
/**
 * The validator's groups of codes that are about how a clip is put together: its stage, its beats
 * and actions (`clips`), what it hands to the learner (`interactive`: an explore, its formulas, a
 * gate answered by a tap), and the code and timing of a custom frame (`frame`). The template is
 * the reference for exactly that, with the verbs its stage accepts, an explore that passes as it
 * stands, and the fields a frame takes.
 */
const CLIP_GROUPS = new Set(['clips', 'interactive', 'frame']);

/**
 * Whether a rejection is one the template helps with: the shape is off, or the scene is a clip
 * whose stage, actions or frame code were refused. A caption that cites the wrong passage or runs
 * long is not: the template says nothing about it, and would only bury the error.
 */
export function wantsTemplate(errors: readonly Issue[]): boolean {
  return errors.some((e) => {
    if (SHAPE_TROUBLE.has(e.code) || e.code.startsWith('FRAME_')) return true;
    const entry = Object.hasOwn(ISSUES, e.code) ? (ISSUES as Record<string, { group?: string }>)[e.code] : undefined;
    return entry?.group !== undefined && CLIP_GROUPS.has(entry.group);
  });
}

/**
 * A scene's metrics as they are sent. The validator counts the words of each caption of a clip
 * into `steps`, the field it also uses for the steps of an older step-through, and marks the
 * budget as per beat. An agent writing a clip thinks in beats, so for a clip the list is sent as
 * `beats`: one number per caption, in order, against a budget that applies to each of them.
 */
export function metricsPayload(metrics: SceneMetrics): Record<string, unknown> {
  if (metrics.budget?.per !== 'beat' || metrics.steps === undefined) return { ...metrics };
  const { steps, ...rest } = metrics;
  return { ...rest, beats: steps };
}

const idOf = (scene: unknown): string | null => {
  const id = (scene as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : null;
};

/**
 * The whole-lesson report as it is sent: everything but the assembled lesson, which the agent
 * already wrote. The lists are cut to what one result may list; `warningCounts` keeps the whole
 * count by code, which is also what the receipt of the published lesson records.
 */
export function reportPayload(report: LessonReport): Record<string, unknown> {
  return {
    ok: report.ok,
    complete: report.complete,
    pending: report.pending,
    errors: capIssueList(report.errors, 'error'),
    warnings: capIssueList(report.warnings, 'warning'),
    warningCounts: countByCode(report.warnings),
    stats: report.stats,
    weakClaims: report.weakClaims,
    ...(report.hash !== undefined ? { hash: report.hash } : {}),
  };
}

/**
 * The running counts an agent would otherwise keep by hand. Passages, pages and sites are three
 * different numbers: a passage is one stored excerpt, a page one URL, a site one host.
 */
function totals(draft: Draft, report: LessonReport): Record<string, unknown> {
  const depth = DEPTHS[draft.depth];
  const planned = new Set(outlineEntries(draft).map((entry) => entry.id)).size;
  return {
    scenesAccepted: report.stats.scenes,
    scenesPlanned: planned,
    words: report.stats.words,
    // A warning above this, an error above wordsMax. Not a target: a lesson may be well under it.
    wordsWarnAbove: depth.words.warn,
    wordsMax: depth.words.max,
    minutes: report.stats.minutes,
    claims: report.stats.claims,
    quotes: report.stats.quotes,
    passagesCited: report.stats.sources,
    passagesNeeded: depth.evidenceMin,
    pages: report.stats.pages,
    sites: report.stats.hosts,
    // How many items cite each stored passage so far, against the most one passage may support.
    evidenceUses: { max: L.usesPerEvidence, byId: evidenceUses(draft) },
    checkpoints: report.stats.checkpoints,
    figures: report.stats.figures,
    weakClaims: report.stats.weakClaims,
  };
}

/**
 * A clip accepted without a prediction, in a stretch of the outline where that is certain to fail
 * PASSIVE_RUN once every scene is in. The plan rule could not know (an outline entry has no gate),
 * so this is the first moment it can be said, and saying it now saves a failed publish. The same
 * goes for a step-through without a predict, in a lesson made before clips.
 */
function predictNote(draft: Draft, sceneId: string): Issue[] {
  const lacking = unpredicted(draft, { pendingPredict: true }).find((scene) => scene.id === sceneId);
  if (!lacking) return [];
  const stretch = `it sits among more than ${L.passiveRun} scenes in a row with no checkpoint and no prediction. As it stands the lesson will fail PASSIVE_RUN when the last scene is in.`;
  if (lacking.kind === 'clip') {
    return [
      serverIssue('PREDICT_NEEDED', 'beats', `"${sceneId}" has no beat with a "gate" and no "explore", and ${stretch}`, {
        sceneId,
        fix: `Add a "gate" to the beat of "${sceneId}" that shows an outcome and submit it again (the template plan_lesson returned shows one), or an "explore" after its last beat; give another clip in that stretch one; or call plan_lesson again with a checkpoint there.`,
      }),
    ];
  }
  return [
    serverIssue('PREDICT_NEEDED', 'steps', `"${sceneId}" has no step with a "predict", and ${stretch}`, {
      sceneId,
      fix: `Add a "predict" to one step of "${sceneId}" and submit it again, or call plan_lesson again with a checkpoint in that stretch.`,
    }),
  ];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A scene, or a stage, as it arrived: an object, or a string of JSON that holds one. */
const opened = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * The template that answers a rejected scene. A chart is one of three (bars, a line, curves), and
 * the plan may not say which: the template of the chart that was sent is the one that helps, so
 * the `mark` of the scene as it arrived is read first, then the plan's.
 */
export function templateForSent(entry: OutlineEntry, scene: unknown): Record<string, unknown> {
  if (entry.kind !== 'clip' || entry.stage !== 'chart') return templateFor(entry);
  const sent = opened(scene);
  const stage = isRecord(sent) ? opened(sent.stage) : undefined;
  const mark = isRecord(stage) && typeof stage.mark === 'string' ? sanitizeText(stage.mark, 'prose') : undefined;
  const known = (PLAN_CHART_MARKS as readonly string[]).includes(mark ?? '') ? (mark as PlanChartMark) : entry.mark;
  return templateFor({ ...entry, ...(known !== undefined ? { mark: known } : {}) });
}

/**
 * A clip accepted with nothing for the learner to do, in a lesson that is then certain to fail
 * INTERACTIVE_SHARE: even if every clip still to come has a gate or an explore, fewer than two
 * thirds will. Said now, while it costs one resubmission.
 */
function actionNote(draft: Draft, sceneId: string): Issue[] {
  const stored = new Map<string, Record<string, unknown>>();
  for (const scene of draft.scenes as unknown[]) if (isRecord(scene) && typeof scene.id === 'string') stored.set(scene.id, scene);
  const clips = outlineEntries(draft).filter((entry, i, all) => entry.kind === 'clip' && all.findIndex((e) => e.id === entry.id) === i);
  const idle = clips.filter((entry) => {
    const scene = stored.get(entry.id);
    return scene !== undefined && scene.kind === 'clip' && !hasLearnerAction(scene);
  });
  const needed = Math.ceil(clips.length * L.interactiveShare - 1e-9);
  if (!idle.some((entry) => entry.id === sceneId) || clips.length - idle.length >= needed) return [];
  return [
    serverIssue('ACTION_NEEDED', 'beats', `"${sceneId}" has no gate and no explore, and with it ${idle.length} of the ${clips.length} planned clips ${idle.length === 1 ? 'has' : 'have'} nothing for the learner to do (${idle.map((entry) => entry.id).join(', ')}): at least ${needed} of the ${clips.length} must. As it stands the lesson will fail INTERACTIVE_SHARE when the last scene is in.`, {
      sceneId,
      fix: `The learner acts before being told. Add a "gate" to the beat of "${sceneId}" that shows an outcome ({ "prompt", "options" }, or { "prompt", "pick", "right", "wrong" } to tap a part of the picture), or an "explore" after its last beat, and submit it again; or do so in another of those clips.`,
    }),
  ];
}

/**
 * The `code` of a frame stage as it arrived in a call, before anything read it: from a scene sent
 * as an object or as a string of JSON, with its stage as either. Names are matched the way the
 * validator reads them (tidied of spaces and hidden characters), so the code is found even when a
 * name was sent untidily, which is exactly the case this exists for. Undefined when there is none.
 */
export function sentFrameCode(scene: unknown): string | undefined {
  const open = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  };
  const pick = (record: Record<string, unknown>, name: string): unknown => {
    if (Object.hasOwn(record, name)) return record[name];
    const key = Object.keys(record).find((k) => sanitizeText(k, 'prose') === name);
    return key === undefined ? undefined : record[key];
  };
  const sent = open(scene);
  if (!isRecord(sent)) return undefined;
  const stage = open(pick(sent, 'stage'));
  if (!isRecord(stage)) return undefined;
  const code = pick(stage, 'code');
  return typeof code === 'string' ? code : undefined;
}

/**
 * The promise about a custom frame is that its code is stored, checked and published exactly as it
 * was sent. The validator keeps that promise for a stage marked exactly `"kind": "frame"` with its
 * code under exactly `"code"`; sent with a stray space or hidden character in one of those, the
 * same stage is still read as a frame, but its code is tidied like prose on the way in, and code
 * that survives the tidying would be stored changed. So an accepted frame is compared here with
 * what was sent, and one that differs is refused: nothing is ever stored that is not the agent's
 * own text.
 */
function frameCodeAltered(sent: unknown, scene: { id: string; kind: string; stage?: unknown }): Issue[] {
  const stage = scene.stage as { kind?: unknown; code?: unknown } | undefined;
  if (scene.kind !== 'clip' || !stage || stage.kind !== 'frame' || typeof stage.code !== 'string') return [];
  const code = sentFrameCode(sent);
  if (code === undefined || code === stage.code) return [];
  return [
    serverIssue('FRAME_CODE_ALTERED', 'stage.code', `The code of the frame in "${scene.id}" would have been stored differently from how it was sent (${code.length} characters sent, ${stage.code.length} after reading), so the scene was not stored.`, {
      sceneId: scene.id,
    }),
  ];
}

export const submitScene: Handler = (deps, raw) =>
  lessonCall(deps, raw, {
    tool: 'submit_scene',
    spec: { required: ['lessonId', 'scene'] },
    write: true,
    work: (draft, args): Work => {
      const check = checkScene(args.scene, draft);
      if (!check.ok || !check.scene) {
        // The validator names the scene only when the plan has it, so this id is always a planned one.
        const sceneId = check.errors.find((e) => e.sceneId !== undefined)?.sceneId ?? check.metrics?.sceneId;
        const entry = sceneId === undefined ? undefined : outlineEntries(draft).find((e) => e.id === sceneId);
        return {
          errors: check.errors,
          warnings: check.warnings,
          outcome: { rejected: check.errors, ...(entry ? { sceneId: entry.id } : {}) },
          payload: {
            accepted: false,
            ...(entry ? { sceneId: entry.id } : {}),
            ...(check.metrics ? { metrics: metricsPayload(check.metrics) } : {}),
            ...(entry && wantsTemplate(check.errors) ? { template: templateForSent(entry, args.scene) } : {}),
          },
        };
      }

      const scene = check.scene;
      const altered = frameCodeAltered(args.scene, scene);
      if (altered.length > 0) {
        const entry = outlineEntries(draft).find((e) => e.id === scene.id);
        return {
          errors: altered,
          warnings: check.warnings,
          outcome: { rejected: altered, sceneId: scene.id },
          payload: { accepted: false, sceneId: scene.id, ...(check.metrics ? { metrics: metricsPayload(check.metrics) } : {}), ...(entry ? { template: templateForSent(entry, args.scene) } : {}) },
        };
      }
      const replaced = draft.scenes.some((stored) => idOf(stored) === scene.id);
      draft.scenes = [...draft.scenes.filter((stored) => idOf(stored) !== scene.id), scene];
      const report = checkLesson(draft);
      return {
        // Once every scene is in, PASSIVE_RUN itself is in the report below and says the same.
        warnings: [...check.warnings, ...(!report.complete ? [...predictNote(draft, scene.id), ...actionNote(draft, scene.id)] : [])],
        changed: true,
        outcome: { report, ...(report.complete ? { errorsAt: 'lessonReport.errors' } : {}) },
        payload: {
          accepted: true,
          sceneId: scene.id,
          replaced,
          // Words against the budget; for a clip, `beats` has the words of each caption and the budget is per beat.
          ...(check.metrics ? { metrics: metricsPayload(check.metrics) } : {}),
          totals: totals(draft, report),
          pending: report.pending,
          // With nothing pending this is exactly what publish_lesson will decide on, so the usual path needs no validate_lesson.
          ...(report.complete ? { lessonReport: reportPayload(report) } : {}),
        },
      };
    },
  });

export const validateLesson: Handler = (deps, raw) =>
  lessonCall(deps, raw, {
    tool: 'validate_lesson',
    spec: { required: ['lessonId'] },
    write: false,
    work: (draft): Work => {
      const report = checkLesson(draft);
      // The report's errors and warnings are the envelope's own (which cuts them to what one result lists); the rest is the payload.
      const payload = reportPayload(report);
      delete payload.ok;
      delete payload.errors;
      delete payload.warnings;
      return { ok: report.ok, errors: report.errors, warnings: report.warnings, outcome: { report, errorsAt: 'errors' }, payload };
    },
  });
