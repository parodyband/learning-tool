// The custom frame: the stage of a clip whose stage has kind "frame".
//
// The clip's controls own time. This module supplies the picture: it reports the animation's
// duration, draws the instant it is asked for, can show the poster still and the end still, and
// can be destroyed. It also owns the things that belong to the frame alone: the learner's sliders
// (`params`), the line that says the animation is custom and unchecked, and the recovery message
// with "Try again" when the watchdog turns the animation off.
//
// Two ways in, one implementation:
//   - kit.ts registers the kind "frame" with the clip engine (player/stage/kit.ts). The engine
//     hands it a stage element; the picture goes there, and everything a learner reads or operates
//     goes in the frame's own element, outside the stage (which is hidden from assistive technology).
//   - createFrameKit(target, stage) below, for anything else: it enhances the static frame that
//     render/frame.ts wrote, in place.
//
// Markup. render/frame.ts writes the static frame at publish time; this module adds the parts
// marked (added). Nothing here uses innerHTML or a style attribute, and no selector or id is built
// from lesson data.
//
//   div.lt-frame[data-frame][data-aspect][data-state=static|idle|live|failed][data-failure][data-picture=away]
//     div.lt-frame-stage
//       canvas.lt-frame-canvas[role=img][aria-label][aria-describedby]     (added; see `picture`)
//       p.lt-frame-alt                         the description; on screen it gives way to the picture
//     div.lt-frame-params                      (added, when the stage has sliders)
//       label.lt-frame-param > span + input[type=range][data-param] + output
//     p.lt-frame-status[role=status]           why the animation was turned off
//     button.lt-frame-retry                    (added) "Try again"
//     p.lt-frame-label                         "This animation was written by your agent ..."
//
// With `picture` (the engine's stage element) the canvas goes there instead, inside
// div.lt-frame-picture, and the frame's own box holds only the description.
import type { FrameStage } from '../../core/frame';
import { type FrameElements, FrameHost, type FrameHostOptions, type FrameState } from './host';
import { type FrameFailure, FRAME_TEXT } from './shared';

export { FrameHost, readTheme } from './host';
export type { FrameElements, FrameHostOptions, FrameSpec, FrameState, FrameStats } from './host';
export { frameHelpers, frameWorker, workerSource, workerUrl } from './runtime';
export type { WorkerSourceOptions } from './runtime';
export { FRAME_BODY_PREFIX, FRAME_BODY_SUFFIX, FRAME_TEXT, NARROW_BELOW, STAGE_UNITS, THEME_TOKENS, WATCHDOG, bitmapSize, frameBeatTimes, frameStageHeight, stageUnits } from './shared';
export type { FrameBeatTime, FrameFailure, FrameRequest, FrameTheme, ThemeRole } from './shared';

/** The stage data the kit reads. A parsed FrameStage satisfies it. */
export type FrameStageData = Pick<FrameStage, 'code' | 'duration' | 'poster'> & Partial<Pick<FrameStage, 'aspect' | 'params'>>;

export interface FrameKitOptions extends Omit<FrameHostOptions, 'fit'> {
  /**
   * Put the picture in this element instead of the frame's own box: a clip engine's stage element,
   * of whatever size. The picture is fitted inside it and keeps the stage's shape. The canvas is
   * then not named as an image (such a stage is hidden from assistive technology as a whole; the
   * description on the page is the text alternative).
   */
  picture?: HTMLElement;
  /** The clip's description. Used only when there is no static frame markup to take it from. */
  description?: string;
  /** The accessible name of the picture, usually the clip's title. Used only when the static markup gave none. */
  label?: string;
  /** `lang` for the interface words this module adds, when the lesson is not in English. */
  uiLang?: string;
}

/** What a clip's controls drive. Times are seconds. */
export interface FrameKit {
  readonly kind: 'frame';
  /** The frame's own element, div.lt-frame: sliders, status, "Try again", the label, the description. */
  readonly root: HTMLElement;
  /** Length of the animation. */
  readonly duration: number;
  /** The time of the poster still. */
  readonly poster: number;
  /** "idle" until the first picture, then "live"; "failed" when the watchdog turned the animation off. */
  readonly state: FrameState;
  readonly failure: FrameFailure | null;
  /**
   * Draw the instant `t`. Returns at once; the picture arrives a moment later, drawn by the worker.
   * Calls coalesce: only the latest time asked for is drawn, so calling this every animation frame
   * while playing is right. Any `t` in any order: a frame depends on nothing but `t`.
   */
  render(t: number): void;
  /** Show the poster still (the time the author chose) or the end still (the last instant). */
  still(which: 'poster' | 'end'): void;
  /** Resolves when the picture for the time last asked for is on the canvas, or cannot be (off screen, turned off). */
  settled(): Promise<void>;
  /** After a failure: start again. What "Try again" does. */
  retry(): void;
  /** End the worker and take back everything this module added to the page. */
  destroy(): void;
  /** The host, for tests and measurements. */
  readonly host: FrameHost;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function child<T extends HTMLElement>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

/** Decimal places a step needs, so a slider's value is shown as the author wrote it (0.1, not 0.30000000000000004). */
function decimals(step: number): number {
  const s = String(step);
  if (s.includes('e-')) return Math.min(8, Number(s.split('e-')[1]) || 0);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(8, s.length - dot - 1);
}

// Where each frame's sliders stand, kept by the stage object itself, so a kit that is rebuilt (a
// clip engine rebuilds its stage when the page is resized) comes back as the learner left it.
const SLIDERS = new WeakMap<object, Map<string, number>>();

/**
 * Bring a frame stage to life. `target` is the static frame (div.lt-frame), an element that
 * contains it, or any element to build the frame in.
 */
export function createFrameKit(target: HTMLElement, stage: FrameStageData, opts: FrameKitOptions = {}): FrameKit {
  const added: Element[] = [];
  const ui = (node: HTMLElement): void => {
    if (opts.uiLang) node.lang = opts.uiLang;
  };

  let root = target.matches('.lt-frame') ? target : child<HTMLElement>(target, '.lt-frame');
  if (!root) {
    root = el('div', 'lt-frame');
    root.dataset.frame = '';
    target.append(root);
    added.push(root);
  }
  const before = { aspect: root.dataset.aspect, picture: root.dataset.picture };
  const aspect = stage.aspect ?? '16:9';
  root.dataset.aspect = aspect;

  let box = child<HTMLElement>(root, '.lt-frame-stage');
  if (!box) {
    box = el('div', 'lt-frame-stage');
    root.prepend(box);
    added.push(box);
  }
  let alt = child<HTMLElement>(box, '.lt-frame-alt');
  if (!alt) {
    alt = el('p', 'lt-frame-alt', opts.description ?? '');
    box.append(alt);
    added.push(alt);
  }
  let status = child<HTMLElement>(root, '.lt-frame-status');
  if (!status) {
    status = el('p', 'lt-frame-status');
    status.setAttribute('role', 'status');
    ui(status);
    box.after(status);
    added.push(status);
  }
  if (!child(root, '.lt-frame-label')) {
    const label = el('p', 'lt-frame-label', FRAME_TEXT.label);
    ui(label);
    root.append(label);
    added.push(label);
  }

  // The picture. A canvas is never a tab stop.
  const canvas = el('canvas', 'lt-frame-canvas');
  canvas.hidden = true;
  let pictureBox = box;
  if (opts.picture) {
    pictureBox = el('div', 'lt-frame-picture');
    pictureBox.append(canvas);
    opts.picture.append(pictureBox);
    added.push(pictureBox);
    root.dataset.picture = 'away';
  } else {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', root.dataset.label || opts.label || 'Animation');
    if (alt.id) canvas.setAttribute('aria-describedby', alt.id);
    box.prepend(canvas);
    added.push(canvas);
  }

  const retry = el('button', 'lt-btn lt-btn-quiet lt-frame-retry', FRAME_TEXT.retry);
  retry.type = 'button';
  retry.hidden = true;
  ui(retry);
  status.after(retry);
  added.push(retry);

  const elements: FrameElements = { root, stage: pictureBox, canvas, placeholder: alt, status, retry };
  const altWasHidden = alt.hidden;

  // Sliders start where the learner left them, if this stage has been on show before.
  const params = stage.params ?? [];
  let kept = SLIDERS.get(stage);
  if (!kept) {
    kept = new Map();
    SLIDERS.set(stage, kept);
  }
  const values = kept;
  const start = params.map((p) => {
    const v = values.get(p.id);
    return { id: p.id, value: v !== undefined && v >= p.min && v <= p.max ? v : p.value };
  });
  const host = new FrameHost(
    elements,
    { code: stage.code, duration: stage.duration, aspect, poster: stage.poster, params: start },
    { onState: opts.onState, onDrawn: opts.onDrawn, worker: opts.worker, fit: opts.picture !== undefined },
  );

  // Moving a slider redraws the instant on show with the new value; it never touches the clock.
  if (params.length > 0 && host.failure !== 'unsupported') {
    const panel = el('div', 'lt-frame-params');
    params.forEach((p, i) => {
      const row = el('label', 'lt-frame-param');
      const text = el('span', 'lt-frame-param-label', p.label);
      const input = el('input', 'lt-frame-range');
      const out = el('output', 'lt-frame-param-value');
      const places = decimals(p.step);
      const show = (value: number): void => {
        const shown = `${value.toFixed(places)}${p.unit ?? ''}`;
        out.textContent = shown;
        input.setAttribute('aria-valuetext', shown);
      };
      input.type = 'range';
      input.min = String(p.min);
      input.max = String(p.max);
      input.step = String(p.step);
      input.value = String(start[i]?.value ?? p.value);
      input.dataset.param = p.id;
      input.addEventListener('input', () => {
        const value = Number(input.value);
        show(value);
        values.set(p.id, value);
        host.setParam(p.id, value);
      });
      show(Number(input.value));
      row.append(text, input, out);
      panel.append(row);
    });
    box.after(panel);
    added.push(panel);
  }

  let destroyed = false;
  return {
    kind: 'frame',
    root,
    duration: stage.duration,
    poster: host.t,
    host,
    get state(): FrameState {
      return host.state;
    },
    get failure(): FrameFailure | null {
      return host.failure;
    },
    render(t: number): void {
      if (!destroyed) host.setTime(t);
    },
    still(which: 'poster' | 'end'): void {
      if (!destroyed) host.setTime(which === 'end' ? stage.duration : stage.poster);
    },
    settled: () => host.settled(),
    retry: () => host.retry(),
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      host.destroy();
      for (const node of added.splice(0)) node.remove();
      // The static frame is left as the renderer wrote it.
      if (root.isConnected) {
        root.dataset.state = 'static';
        delete root.dataset.failure;
        for (const key of ['aspect', 'picture'] as const) {
          const was = before[key];
          if (was === undefined) delete root.dataset[key];
          else root.dataset[key] = was;
        }
        alt.hidden = altWasHidden;
        status.textContent = '';
        root.removeAttribute('tabindex');
      }
    },
  };
}
