// What every tool handler shares: the handler type, turning a failure into an envelope, finding the
// draft a lessonId names, and the bookkeeping of calls and rejections.
import { CLIP_LIMITS as C } from '../../core/clip-base';
import { EXPR_LIMITS } from '../../core/expr';
import { FRAME_LIMITS as F } from '../../core/frame';
import { DEPTHS, LIMITS as L } from '../../core/limits';
import { MINUTES } from '../../core/validate/lesson';
import { PLAN_CHART_MARKS, PLAN_STAGE_KINDS, type Depth, type OutlineEntry } from '../../core/schema';
import type { Draft, Issue } from '../../core/types';
import { readLessonId } from '../args';
import type { ServerDeps } from '../deps';
import { envelope, type Envelope } from '../envelope';
import { serverIssue } from '../issues';
import type { ToolName } from '../next';
import { isLessonFileName } from '../paths';
import { StoreError } from '../store';

export interface CallContext {
  /** Aborted when the MCP connection this call arrived on closes. */
  signal: AbortSignal;
}

export type Handler = (deps: ServerDeps, raw: unknown, ctx: CallContext) => Promise<Envelope>;

/** The envelope for a call whose arguments were rejected before any lesson was involved. */
export function refuse(tool: ToolName, errors: Issue[], lessonId: string | null = null, draft: Draft | null = null): Envelope {
  return envelope({ draft, lessonId, errors, outcome: { tool, rejected: errors } });
}

/** A failure of the store or of the server itself, as an envelope. Nothing from the error but its code and fixed sentence is passed on. */
export function failure(deps: ServerDeps, tool: ToolName, error: unknown, lessonId: string | null = null): Envelope {
  if (error instanceof StoreError) {
    const found = serverIssue(error.code, error.code === 'DRAFT_UNREADABLE' ? 'lessonId' : '', error.message);
    deps.log(`learning-tool: ${tool}: ${error.code}${error.errno ? ` ${error.errno}` : ''}`);
    return envelope({ draft: null, lessonId, errors: [found], outcome: error.code === 'DRAFT_UNREADABLE' ? { tool, missing: true } : { tool, failed: true } });
  }
  // The name of the error class is logged and nothing else: a message can quote file content.
  const name = error instanceof Error ? error.name : typeof error;
  deps.log(`learning-tool: ${tool}: unexpected ${name}`);
  return envelope({
    draft: null,
    lessonId,
    errors: [serverIssue('INTERNAL_ERROR', '', `${tool} failed inside the server (${/^[A-Za-z]{1,40}$/.test(name) ? name : 'error'}). Nothing was changed by this call.`)],
    outcome: { tool, failed: true },
  });
}

/** Run a handler so that nothing it throws reaches the SDK, which would turn it into a bare message. */
export function guarded(tool: ToolName, handler: Handler): Handler {
  return async (deps, raw, ctx) => {
    try {
      return await handler(deps, raw, ctx);
    } catch (error) {
      return failure(deps, tool, error);
    }
  };
}

/**
 * The draft that a `lessonId` argument names, or the envelope that says why there is none. The id
 * is checked against the minted form before the store, and so the disk, is asked anything.
 */
export async function findDraft(deps: ServerDeps, tool: ToolName, value: unknown): Promise<{ draft: Draft; refusal?: undefined } | { draft?: undefined; refusal: Envelope }> {
  const read = readLessonId(value);
  if (read.id === null) return { refusal: envelope({ draft: null, errors: read.errors, outcome: { tool, rejected: read.errors, missing: true } }) };
  let draft: Draft | null;
  try {
    draft = await deps.store.load(read.id);
  } catch (error) {
    return { refusal: failure(deps, tool, error, read.id) };
  }
  if (!draft) {
    const errors = [serverIssue('LESSON_NOT_FOUND', 'lessonId', `No lesson with the id "${read.id}" is stored on this machine.`, { got: read.id })];
    return { refusal: envelope({ draft: null, lessonId: read.id, errors, outcome: { tool, rejected: errors, missing: true } }) };
  }
  return { draft };
}

/**
 * True when the draft records a publication whose file is no longer in the lessons folder: deleted
 * or moved by hand. One lstat, and only for a lesson that was published. A tool that then answered
 * "published, give the learner the link" would be handing over a link to nothing.
 */
export async function publishedFileMissing(deps: ServerDeps, draft: Draft): Promise<boolean> {
  const published = draft.published as { fileName?: unknown } | undefined;
  if (typeof published !== 'object' || published === null) return false;
  if (!isLessonFileName(published.fileName, draft.id)) return true;
  return !(await deps.store.lessonExists(published.fileName, draft.id));
}

/** Count a call, and each error it returned, in the draft's activity. */
export function record(draft: Draft, tool: ToolName, errors: readonly Issue[] = []): void {
  const { calls, rejects } = draft.activity;
  calls[tool] = (calls[tool] ?? 0) + 1;
  for (const error of errors) {
    // Codes come from the catalogs, but the object is keyed by them, so anything else is kept out.
    if (/^[A-Z][A-Z0-9_]{1,40}$/.test(error.code)) rejects[error.code] = (rejects[error.code] ?? 0) + 1;
  }
}

/**
 * The limits that apply to a lesson of this depth, in the words an agent plans with. They are the
 * limits of a lesson made of clips: the word budgets of the older scene kinds are not listed,
 * because no new scene of those kinds can be planned.
 */
export function limitsFor(depth: Depth): Record<string, unknown> {
  const d = DEPTHS[depth];
  return {
    depth,
    minutes: d.minutes,
    // The first thing an agent reads when it looks up how much it may write.
    visualFirst: 'A lesson is watched, not read: the picture carries the idea and a caption is one short line. None of these numbers is a quota to fill.',
    // The philosophy, in one line, and the rule that holds a lesson to it.
    actFirst: 'The learner acts before being told: a prediction, a tap on the picture, or a slider to drag, in at least two of every three clips.',
    scenes: d.scenes,
    objectives: d.objectives,
    evidence: {
      mustCite: d.evidenceMin,
      canStore: L.evidencePerLesson,
      excerptChars: L.excerptChars,
      excerptCharsPerUrl: L.excerptCharsPerUrl,
      usesPerExcerpt: L.usesPerEvidence,
      citesPerCaption: L.citesPerBlock,
      citesPerStage: C.citesPerStage,
    },
    clip: {
      stageKinds: PLAN_STAGE_KINDS.filter((kind) => kind !== 'frame'),
      // The three charts a "chart" stage can be; "curve" is a function plot, y = a formula in x.
      chartMarks: [...PLAN_CHART_MARKS],
      beats: C.beats,
      actionsPerBeat: C.actionsPerBeat,
      // At least this share of a clip's beats must change the picture.
      beatsThatMove: Math.round(L.beatsThatMove * 100) / 100,
      // What the learner does: a gate on a beat (options, or a tap on a part of the stage), or an explore after the last beat.
      learnerActions: {
        // At least this share of a lesson's clips must contain one.
        shareOfClips: Math.round(L.interactiveShare * 100) / 100,
        gates: ['{prompt, options}: a prediction to choose', '{prompt, pick, right, wrong}: a part of the stage to tap'],
        // An explore: sliders, and formulas that tie parts of the stage to them. Never on a "sourced" stage.
        explore: { controls: { min: 1, max: 2 }, stepsPerControl: L.explore.steps, bindings: 8, formulaChars: EXPR_LIMITS.chars, stage: 'worked or illustrative', minutesEach: MINUTES.explore },
      },
      // Stage kind "frame": the agent's own drawing code, for what no typed stage can show.
      customFrame: { perLesson: L.framesPerLesson, codeBytes: F.codeBytes, lineChars: F.lineChars, seconds: F.duration, sliders: F.params },
    },
    words: {
      lesson: d.words,
      // One caption is one short line: a warning above `warn` words, an error above `max`.
      caption: L.captionWords,
    },
    structure: {
      firstScene: 'clip',
      lastScene: 'recap',
      scenesInARowWithoutCheckpointOrPrediction: L.passiveRun,
      // A standard or deep lesson with no explore at all is warned about.
      exploreExpected: depth !== 'quick',
      applyCheckpointRequired: d.requireApply,
    },
  };
}

/**
 * The outline entries that can be used at all. A draft is read from disk, and an entry that is not an
 * object with an id must surface as a problem with the plan, not as an exception in a handler.
 */
export function outlineEntries(draft: Draft): OutlineEntry[] {
  return (draft.outline as unknown[]).filter((entry): entry is OutlineEntry => typeof entry === 'object' && entry !== null && typeof (entry as { id?: unknown }).id === 'string');
}

/** Evidence ids are minted once and never reused: the next one follows the highest that exists. */
export function nextEvidenceId(draft: Draft): string {
  let highest = 0;
  for (const item of draft.evidence as unknown[]) {
    const id = (item as { id?: unknown } | null)?.id;
    const n = typeof id === 'string' && /^e[1-9][0-9]{0,2}$/.test(id) ? Number(id.slice(1)) : 0;
    if (n > highest) highest = n;
  }
  return `e${highest + 1}`;
}
