// The player: one classic script that enhances a page which is already complete without it.
//
// This file owns start-up and the small API the other player modules are given. The contract for
// the modules built on top of it (figures, questions, steps) is written out at the top of
// src/render/scenes.ts; the types below are that contract's TypeScript half.
import type { Lesson } from '../core/schema';
import type { Receipt } from '../core/types';
import { initAudio } from './audio';
import { enhanceFigures } from './figures';
import { createNav } from './nav';
import { initPopovers } from './popovers';
import { initQuestions } from './questions';
import { initClips } from './stage/index';
import { initSteps } from './steps';
import { ALL_RESULTS, type CheckpointResult, GRADED_RESULTS, SELF_RATINGS, type Store, createResultLog, createStore } from './storage';
import { initSummary } from './summary';

export type { CheckpointResult } from './storage';
export { ALL_RESULTS, GRADED_RESULTS, SELF_RATINGS };

export interface SceneInfo {
  readonly id: string;
  /** 0-based position. */
  readonly index: number;
  readonly kind: string;
  readonly title: string;
  /** The objective a checkpoint assesses. */
  readonly objective: string | null;
  /** A digest of the scene's content, written by the renderer. Anything kept about a scene is kept with it, and dropped when it differs. */
  readonly rev: string;
  readonly section: HTMLElement;
  readonly heading: HTMLElement;
}

export interface SceneChangeDetail {
  scene: SceneInfo;
  previous: SceneInfo | null;
}
export interface ResultDetail {
  sceneId: string;
  objective: string | null;
  result: CheckpointResult;
}
export interface StepChangeDetail {
  sceneId: string;
  /** 1-based step number, or null while the step on show holds its text back and there is nothing to read out. */
  step: number | null;
}

/** Fired on `document`. */
export const EVENTS = { scene: 'lt:scenechange', result: 'lt:result', step: 'lt:stepchange' } as const;

export interface PlayerApi {
  /** The lesson and receipt embedded in the page. Strings in here are text: use `textContent`, never markup. */
  readonly lesson: Lesson;
  readonly receipt: Receipt;
  readonly scenes: readonly SceneInfo[];
  scene(id: string): SceneInfo | undefined;
  current(): SceneInfo;
  /** Show a scene and move focus to its heading, or to `focus` when given (an element inside that scene). */
  go(sceneId: string, focus?: HTMLElement): void;
  /** Say something through the page's one visually hidden status region. For feedback the learner should also see, write to your own visible `role="status"` element instead. */
  announce(text: string): void;
  /** Record a checkpoint result and return what is now stored. A graded result is kept from the first attempt: a later call for the same scene returns the earlier result unchanged. */
  recordResult(sceneId: string, result: CheckpointResult): CheckpointResult;
  result(sceneId: string): CheckpointResult | undefined;
  /** A step-through tells the narration which step is showing (1-based), or null when the step on show has nothing readable yet (its prediction is still open). */
  stepChanged(sceneId: string, step: number | null): void;
  /** Persistence for this lesson. Never put typed answers in it. */
  readonly store: Store;
}

/** The DOM id of a part the lesson names. The same function as `domId` in render/escape. */
export function domId(sceneId: string, partId: string): string {
  return `lt-${idChars(sceneId).replace(/-/g, '--')}-${idChars(partId)}`;
}

function idChars(s: string): string {
  const flat = s.replace(/[^a-z0-9_-]/g, '_').slice(0, 64);
  return /^[a-z]/.test(flat) ? flat : `x${flat}`;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function fire<T>(name: string, detail: T): void {
  document.dispatchEvent(new CustomEvent<T>(name, { detail }));
}

function readData(): { lesson: Lesson; receipt: Receipt } {
  const el = byId('lt-data');
  const value: unknown = JSON.parse(el?.textContent ?? 'null');
  if (typeof value !== 'object' || value === null) throw new Error('lesson data is missing');
  const { lesson, receipt } = value as { lesson?: Lesson; receipt?: Receipt };
  if (!lesson || !receipt || typeof lesson.id !== 'string' || !Array.isArray(lesson.scenes)) throw new Error('lesson data is incomplete');
  return { lesson, receipt };
}

function collectScenes(): SceneInfo[] {
  const out: SceneInfo[] = [];
  document.querySelectorAll<HTMLElement>('section.lt-scene').forEach((section) => {
    const heading = section.querySelector<HTMLElement>('h2');
    const id = section.dataset.scene;
    if (!heading || !id) return;
    out.push({
      id,
      index: out.length,
      kind: section.dataset.kind ?? 'narration',
      title: section.querySelector('.lt-scene-title')?.textContent ?? '',
      objective: section.dataset.objective ?? null,
      rev: section.dataset.rev ?? '',
      section,
      heading,
    });
  });
  return out;
}

function start(): void {
  const root = document.documentElement;
  const { lesson, receipt } = readData();
  const scenes = collectScenes();
  if (scenes.length === 0) return;
  const sceneById = new Map(scenes.map((s) => [s.id, s]));
  const store = createStore(lesson.id);

  const live = byId('lt-live');
  let liveTimer = 0;
  const announce = (text: string): void => {
    if (!live) return;
    // Cleared first so that saying the same thing twice is still announced.
    live.textContent = '';
    window.clearTimeout(liveTimer);
    liveTimer = window.setTimeout(() => {
      live.textContent = text;
    }, 50);
  };

  const results = createResultLog(store, (sceneId) => {
    const scene = sceneById.get(sceneId);
    return scene?.kind === 'checkpoint' ? scene.rev : undefined;
  });

  const nav = createNav({ scenes, sceneById, lessonTitle: lesson.title, store, announce, onChange: (detail) => fire<SceneChangeDetail>(EVENTS.scene, detail) });

  const api: PlayerApi = {
    lesson,
    receipt,
    scenes,
    scene: (id) => sceneById.get(id),
    current: () => nav.current(),
    go: (sceneId, focus) => nav.go(sceneId, focus),
    announce,
    recordResult(sceneId, result) {
      const outcome = results.record(sceneId, result);
      if (!outcome) return result;
      if (outcome.changed) fire<ResultDetail>(EVENTS.result, { sceneId, objective: sceneById.get(sceneId)?.objective ?? null, result: outcome.stored });
      return outcome.stored;
    },
    result: (sceneId) => results.get(sceneId),
    stepChanged(sceneId, step) {
      if (sceneById.has(sceneId) && (step === null || (Number.isInteger(step) && step >= 1))) fire<StepChangeDetail>(EVENTS.step, { sceneId, step });
    },
    store,
  };

  root.classList.add('lt-js');
  initPopovers();
  initSummary(api);
  initAudio(api);
  // Every scene is still laid out at this point. A module that measures must also cope with its
  // scene being hidden and shown later (see the contract).
  enhanceFigures(document);
  initQuestions(document, api);
  initSteps(document, api);
  // Clips (src/player/stage/): the v2 teaching scenes. A lesson without any is untouched by this call.
  initClips(document, api);
  nav.start();
}

function boot(): void {
  try {
    start();
  } catch (error) {
    // Without the script the page is a complete linear document, so that is what a failure falls back to.
    const root = document.documentElement;
    root.classList.remove('lt-js', 'lt-compact', 'lt-wide');
    document.querySelectorAll<HTMLElement>('section.lt-scene').forEach((s) => {
      s.hidden = false;
    });
    // Rethrown on its own task so the failure is still reported, after the page has been put back.
    window.setTimeout(() => {
      throw error;
    }, 0);
  }
}

// This file is also imported for its types and helpers by code that runs outside a page (tests).
if (typeof document !== 'undefined') boot();
