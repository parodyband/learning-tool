// The clip engine's way into the page. `initClips` finds every clip the renderer wrote, brings it
// to life, and ties the clips to the shell around them: the scene on show, the title card, the
// hand-over from one clip to the next, the learner's motion preference, and print.
//
// Every stage kit is imported here, and importing a kit registers it (see kit.ts). The lines and
// timeline kits and the custom frame are written by their own modules against the same interface.
import './kit-sequence';
import './kit-cells';
import './kit-dots';
import './kit-chart';
import './kit-flow';
import './kit-words';
import './kit-lines';
import './kit-timeline';
import '../frame/kit';
import { EVENTS, type PlayerApi, type SceneChangeDetail } from '../main';
import { type ClipSettings, type MountedClip, CLIP_SAID, SPEEDS, mountClip } from './mount';
import type { ClipData } from './timeline';
import { initTitleCard } from './titlecard';
import { words } from '../questions';

export type { MountedClip } from './mount';

const isRate = (v: unknown): v is string => typeof v === 'string' && (SPEEDS as readonly string[]).includes(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

function createSettings(api: PlayerApi): ClipSettings {
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const listeners: (() => void)[] = [];
  const stored = api.store.get('clipstep', isBool);
  const settings: ClipSettings = {
    rate: api.store.get('cliprate', isRate) ?? '1',
    // With reduced motion a clip is a sequence of stills, so it waits after each one unless the learner says otherwise.
    step: stored ?? reducedQuery.matches,
    voice: api.store.get('clipvoice', isBool) ?? false,
    reduced: reducedQuery.matches,
    set(name, value) {
      if (name === 'rate' && isRate(value)) {
        settings.rate = value;
        api.store.set('cliprate', value);
      } else if (name === 'step' && isBool(value)) {
        settings.step = value;
        api.store.set('clipstep', value);
      } else if (name === 'voice' && isBool(value)) {
        settings.voice = value;
        api.store.set('clipvoice', value);
      }
      for (const fn of listeners) fn();
    },
    listen(fn) {
      listeners.push(fn);
    },
  };
  reducedQuery.addEventListener('change', () => {
    settings.reduced = reducedQuery.matches;
    if (api.store.get('clipstep', isBool) === undefined) settings.step = reducedQuery.matches;
    for (const fn of listeners) fn();
  });
  return settings;
}

/** Turn every clip under `root` into a stage that plays. Called once at start-up, before the first scene is shown. */
export function initClips(root: ParentNode, api: PlayerApi): void {
  const boxes = Array.from(root.querySelectorAll<HTMLElement>('div.lt-clip[data-clip]'));
  if (boxes.length === 0) return;
  const scenes = new Map<string, ClipData>();
  for (const scene of api.lesson.scenes as unknown as (ClipData & { kind: string })[]) {
    if (scene.kind === 'clip' && !scenes.has(scene.id)) scenes.set(scene.id, scene);
  }
  const settings = createSettings(api);
  const mounted = new Map<string, MountedClip>();
  document.documentElement.classList.add('lt-clips');

  for (const box of boxes) {
    const id = box.dataset.clip ?? '';
    const data = scenes.get(id);
    if (!data || !Array.isArray(data.beats) || typeof data.stage !== 'object' || data.stage === null) continue;
    try {
      mounted.set(id, mountClip(box, data, api, settings));
    } catch (error) {
      // A clip that cannot be built leaves its text version in place, visibly, and says so.
      box.querySelector(':scope > .st-band')?.remove();
      box.classList.remove('lt-clip-live');
      box.dataset.failed = 'true';
      box.insertBefore(words('p', CLIP_SAID.failed, 'lt-clip-failed'), box.firstChild);
      window.setTimeout(() => {
        throw error;
      }, 0);
    }
  }

  initTitleCard(api, (sceneId) => mounted.get(sceneId));

  document.addEventListener(EVENTS.scene, (event) => {
    const { scene, previous } = (event as CustomEvent<SceneChangeDetail>).detail;
    if (previous && previous.id !== scene.id) mounted.get(previous.id)?.leave();
    mounted.get(scene.id)?.enter(previous !== null && previous.id !== scene.id);
  });

  // Paper: one still per beat, drawn by the same render(t) at the end of its beat, made when the
  // print starts and removed after it.
  let stills: HTMLElement[] = [];
  const before = (): void => {
    if (stills.length) return;
    for (const m of mounted.values()) {
      try {
        const box = m.stills();
        if (box) stills.push(box);
      } catch {
        // The captions still print.
      }
    }
  };
  const after = (): void => {
    for (const box of stills) box.remove();
    stills = [];
  };
  window.addEventListener('beforeprint', before);
  window.addEventListener('afterprint', after);
  window.matchMedia('print').addEventListener('change', (e) => (e.matches ? before() : after()));
}
