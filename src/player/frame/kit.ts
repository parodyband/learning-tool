// The custom frame as a stage kit of the clip engine (player/stage/kit.ts).
//
// Importing this module registers the kind "frame". The engine then builds a frame like any other
// stage, `makeStage(stageData, env)`, and drives it with `apply(t)` (ms), `still(which)` and
// `destroy()`.
//
// How a frame differs from the typed kits:
//   - It has no parts and takes no verbs: `hideAtStart` and `intro` do nothing. Its timeline is
//     not compiled from actions. The engine reads the beats' `at` and the stage's `duration`
//     (player/stage/mount.ts); `frameBeatTimes` in shared.ts is the same arithmetic.
//   - `apply(t)` returns at once and the picture arrives a moment later, drawn by a worker. Calls
//     coalesce, within a task and across frames, so `apply(0)` followed by `still('poster')` draws
//     the poster only, and calling `apply` every animation frame is right. `settled()` resolves
//     when the picture asked for last is on the canvas.
//   - The picture is fitted inside `env.el` and keeps the stage's own shape (16:9, 4:3, 1:1, or
//     4:5 in a box taller than it is wide). `frameStageHeight(aspect, W)` in shared.ts gives the
//     height a frame would like for a width, for an engine that sizes the stage per kind.
//   - `env.el` is hidden from assistive technology and is not interactive, but a frame has things
//     a learner reads and operates: its sliders, the line that says the animation is custom and
//     unchecked, the status line and "Try again". Those live in the frame's own element (`panel`,
//     a div.lt-frame): the static frame render/frame.ts wrote, wherever the engine has put it in
//     the scene. When the scene has none, one is made and placed straight after the stage.
//   - A frame can be turned off by the watchdog and come back ("Try again"). `state` says which,
//     and `onState` is called on a change, for controls that want to follow.
//   - Rebuilding it (the engine does on resize) starts a new worker, which draws the same picture
//     for the same t. The learner's slider positions are kept across rebuilds.
import type { Ctx } from '../stage/core';
import { type StageEnv, type StageKit, registerKit } from '../stage/kit';
import { type FrameKit, type FrameStageData, createFrameKit } from './index';
import type { FrameState } from './host';
import type { FrameFailure } from './shared';

/** Static frames that a kit is using. A second kit for the same scene (a still built off screen) gets its own. */
const TAKEN = new WeakSet<HTMLElement>();

export class FrameStageKit implements StageKit {
  readonly kit: FrameKit;
  /** The frame's own element: sliders, status, "Try again", the label, the description. */
  readonly panel: HTMLElement;
  /** Length of the animation in ms. */
  readonly duration: number;
  /** The time of the poster still in ms. */
  readonly poster: number;
  /** Called when the frame is turned off or comes back. */
  onState: ((state: FrameState, failure: FrameFailure | null) => void) | null = null;
  private readonly made: boolean;

  constructor(data: FrameStageData, env: StageEnv) {
    const found = env.el.closest<HTMLElement>('.lt-scene')?.querySelector<HTMLElement>('.lt-frame') ?? null;
    let panel = found && !TAKEN.has(found) ? found : null;
    this.made = panel === null;
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'lt-frame';
      panel.dataset.frame = '';
      // Straight after the stage, outside whatever hides the stage from assistive technology.
      // (A stage that is not in the page, a still built off screen, gets a panel that is not either.)
      let anchor: HTMLElement = env.el;
      for (let up: HTMLElement | null = env.el; up; up = up.parentElement) {
        if (up.getAttribute('aria-hidden') === 'true') anchor = up;
      }
      if (!found && anchor.parentElement) anchor.after(panel);
    }
    TAKEN.add(panel);
    this.panel = panel;
    const lang = document.documentElement.lang;
    this.kit = createFrameKit(panel, data, {
      picture: env.el,
      uiLang: lang && !/^en(-|$)/i.test(lang) ? 'en' : undefined,
      onState: (state, failure) => this.onState?.(state, failure),
    });
    this.duration = Math.round(data.duration * 1000);
    this.poster = Math.round(this.kit.poster * 1000);
  }

  get state(): FrameState {
    return this.kit.state;
  }
  get failure(): FrameFailure | null {
    return this.kit.failure;
  }

  hideAtStart(): void {
    /* a frame has no parts */
  }
  intro(_ctx: Ctx): void {
    /* and no establishing move: the animation starts at 0 */
  }
  /** Draw the instant t, in ms. */
  apply(t: number): void {
    this.kit.render(t / 1000);
  }
  /** Show the poster still (the instant the author chose) or the end still. */
  still(which: 'poster' | 'end'): void {
    this.kit.still(which);
  }
  /** Resolves when the picture asked for last is on the canvas, or cannot be. */
  settled(): Promise<void> {
    return this.kit.settled();
  }
  retry(): void {
    this.kit.retry();
  }
  destroy(): void {
    this.kit.destroy();
    TAKEN.delete(this.panel);
    if (this.made) this.panel.remove();
  }
}

registerKit('frame', (data, env) => new FrameStageKit(data as FrameStageData, env));
