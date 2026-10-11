// Shared shapes that cross module boundaries: what the validator reports, what the store keeps,
// what the renderer receives. Function types at the bottom are the module contracts.
import type { z } from 'zod';
// A lesson may hold clips (core/clip): `AnyScene` is a v1 scene or a clip, `LessonV2` a lesson of
// them. Type-only, so this file still loads nothing at run time.
import type { AnyScene, LessonV2 } from './clip';
import type { Depth, Evidence, Learner, Objective, OutlineEntry, PlanInput } from './schema';

// ---------------------------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------------------------

export type Severity = 'error' | 'warning';

/**
 * One problem found by validation. Written for an agent to act on without re-reading the format.
 * Never contains source excerpt text: excerpts are untrusted page content and must not be echoed
 * into instructions. Refer to evidence by id.
 */
export interface Issue {
  /** Stable UPPER_SNAKE code from the catalog in core/issues. */
  code: string;
  severity: Severity;
  /** Where, as a path inside the submitted object: "blocks[1].cites[0]". Empty for whole-lesson issues. */
  path: string;
  sceneId?: string;
  /** What is wrong, concretely. */
  message: string;
  /** The specific action that resolves it. */
  fix: string;
  /** The offending value, shortened, when it helps and is not excerpt text. */
  got?: string;
  expected?: string;
  /**
   * The nearest span of a stored excerpt, for quote mismatches. This is untrusted page text carried
   * as data so the agent can copy it; it is never woven into `message` or `fix`.
   */
  source?: { evidenceId: string; start: number; end: number; text: string };
}

// ---------------------------------------------------------------------------------------------
// Draft: what the store persists between tool calls
// ---------------------------------------------------------------------------------------------

export type Stage = 'started' | 'researching' | 'planned' | 'writing' | 'ready' | 'published';

export interface Draft {
  format: 'learning-tool/draft@1';
  id: string;
  createdAt: string;
  updatedAt: string;
  topic: string;
  language: string;
  depth: Depth;
  learner: Learner;
  title?: string;
  objectives: Objective[];
  outline: OutlineEntry[];
  /** Append-only. An excerpt is never edited; new text gets a new id. */
  evidence: Evidence[];
  /** Accepted scenes, in any order. Lesson order comes from `outline`. */
  scenes: AnyScene[];
  published?: { fileName: string; hash: string; at: string };
  /** Tool calls and rejections by code, so a run can be measured. */
  activity: { calls: Record<string, number>; rejects: Record<string, number> };
}

// ---------------------------------------------------------------------------------------------
// Validation results
// ---------------------------------------------------------------------------------------------

export interface WordBudget {
  warn: number;
  max: number;
  /** What the budget is measured over. A step-through's budget applies to each step and a clip's to each beat's caption, not to the scene. */
  per?: 'scene' | 'step' | 'beat';
}

export interface SceneMetrics {
  sceneId: string;
  /** Prose words in the scene, counted the way the limits are defined. */
  words: number;
  budget: WordBudget | null;
  /**
   * Words in each step of a step-through, in order, so the agent can see which step is near its
   * budget. For a clip: the words of each beat's caption, in order (`budget.per` is then "beat").
   */
  steps?: number[];
  citedBlocks: number;
  uncitedBlocks: number;
}

export interface LessonStats {
  scenes: number;
  words: number;
  /** Estimated learner minutes. */
  minutes: number;
  claims: number;
  quotes: number;
  /** Evidence items (passages) the lesson cites. */
  sources: number;
  /** Distinct source pages (URLs) those passages come from. */
  pages: number;
  /** Distinct source hosts (sites) among them. */
  hosts: number;
  checkpoints: number;
  /** Figures of narration and step-through scenes, and clips (a clip's stage is its figure). */
  figures: number;
  /** Share of prose words that are framing or analogy. */
  uncitedShare: number;
  exampleShare: number;
  /** Claims that share few words with their cited excerpts. */
  weakClaims: number;
}

export interface EvidenceCheck {
  ok: boolean;
  /** The normalised item with `host` computed, ready to be given an id. Absent when not ok. */
  evidence?: Omit<Evidence, 'id' | 'savedOn'>;
  /** Set when the same URL and excerpt are already stored: return this id instead of adding. */
  duplicateOf?: string;
  /** Excerpt characters stored from this item's URL after this item, against the per-URL limit. */
  urlChars?: { used: number; max: number };
  errors: Issue[];
  warnings: Issue[];
}

export interface PlanCheck {
  ok: boolean;
  plan?: PlanInput;
  /** Word budget per planned scene id; null for scenes with no prose budget. */
  budgets?: Record<string, WordBudget | null>;
  /** Ids of already-accepted scenes that the new plan no longer fits and that will be dropped. */
  orphans?: string[];
  errors: Issue[];
  warnings: Issue[];
}

export interface SceneCheck {
  ok: boolean;
  /** The normalised scene to store: defaults applied, quotes replaced by the excerpt's own characters. */
  scene?: AnyScene;
  metrics?: SceneMetrics;
  errors: Issue[];
  warnings: Issue[];
}

export interface LessonReport {
  /** True when every planned scene is accepted and there are no errors. Only then can it be published. */
  ok: boolean;
  /** False while planned scenes are still missing. */
  complete: boolean;
  pending: string[];
  errors: Issue[];
  warnings: Issue[];
  stats: LessonStats;
  /** Paths of claims with a weak textual match to their excerpts, as "<sceneId>/<path>". */
  weakClaims: string[];
  /** The assembled lesson and its hash, present when `ok`. */
  lesson?: LessonV2;
  hash?: string;
}

// ---------------------------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------------------------

/** Embedded in every published file: what was validated, by which rules, with what result. */
export interface Receipt {
  generator: 'learning-tool';
  version: string;
  rules: string;
  /** SHA-256 (hex) of the canonical JSON of `lesson`. */
  hash: string;
  /** YYYY-MM-DD. */
  validatedOn: string;
  stats: LessonStats;
  /** Warning counts by code. Warnings are published, not hidden. */
  warnings: Record<string, number>;
  weakClaims: string[];
}

/** A stretch of lesson text that is narrated as one audio clip. */
export interface NarrationSegment {
  /** "<sceneId>" for a whole scene, "<sceneId>.step<N>" (1-based) for a step, "<sceneId>.intro" for a step-through intro, "<sceneId>.beat<N>" (1-based) for a beat of a clip. */
  id: string;
  sceneId: string;
  /** Plain text to speak: markup removed, no citation markers, no excerpts. */
  text: string;
}

export interface AudioClip {
  segmentId: string;
  mime: 'audio/mpeg';
  base64: string;
}

export interface AudioBundle {
  provider: 'elevenlabs';
  /** Display name of the voice, for the attribution line. */
  voice: string;
  clips: AudioClip[];
}

/** Everything the renderer needs. This object, minus `audio`, is also embedded in the file as JSON. */
export interface Published {
  lesson: LessonV2;
  receipt: Receipt;
  audio?: AudioBundle;
}

// ---------------------------------------------------------------------------------------------
// Module contracts
// ---------------------------------------------------------------------------------------------

/** core/validate */
export type CheckEvidence = (input: unknown, draft: Draft) => EvidenceCheck;
export type CheckPlan = (input: unknown, draft: Draft) => PlanCheck;
export type CheckScene = (input: unknown, draft: Draft) => SceneCheck;
export type CheckLesson = (draft: Draft) => LessonReport;
/** core/hash: canonical JSON (sorted keys, no whitespace) and its SHA-256 hex. */
export type CanonicalJson = (value: unknown) => string;
export type HashLesson = (lesson: LessonV2) => string;
/** core/narration */
export type NarrationSegments = (lesson: LessonV2) => NarrationSegment[];
/** render/index: one self-contained HTML document. */
export type RenderLessonHtml = (published: Published) => string;

/** What the agent may send before defaults are applied. */
export type SceneInput = z.input<typeof import('./schema').Scene>;
export type FigureInput = z.input<typeof import('./schema').Figure>;
export type QuestionInput = z.input<typeof import('./schema').Question>;
export type StartInputRaw = z.input<typeof import('./schema').StartInput>;
