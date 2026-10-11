// The custom frame's host: everything on the page's side of the worker.
//
// The agent's code never runs here. It runs in a Web Worker made from a data: URL (runtime.ts),
// and the only thing this file accepts back is one ImageBitmap per request, of exactly the size
// it asked for, which it shows on a canvas it owns. This file owns the worker's life: it starts
// it when the frame is first on screen, gives it 3 s to get ready and 1.5 s per frame, and
// terminates it when it misses a deadline, floods, answers with the wrong thing or reports an
// error. Then it tells the learner in words and offers "Try again". The clock, the play button
// and the scrubber are not here either: the clip's controls own time and ask for an instant.
import { type FrameFailure, FRAME_TEXT, type FrameRequest, type FrameTheme, THEME_TOKENS, type ThemeRole, WATCHDOG, bitmapSize, stageUnits } from './shared';
import { type WorkerSourceOptions, workerUrl } from './runtime';

export type FrameState = 'idle' | 'live' | 'failed';

/** What the host needs from the stage data. Structurally a FrameStage; nothing else is read. */
export interface FrameSpec {
  readonly code: string;
  /** Seconds. */
  readonly duration: number;
  readonly aspect?: string;
  readonly poster: number;
  readonly params?: readonly { readonly id: string; readonly value: number }[];
}

export interface FrameElements {
  /** The frame's own element. Carries data-state="idle|live|failed" for the stylesheet. */
  root: HTMLElement;
  /** The box the picture goes in. Its size is the stage's size, unless `fit` is set. */
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  /** Shown while there is no picture: before the first frame, and when the frame is off. */
  placeholder: HTMLElement;
  /** role="status": why the frame was turned off. */
  status: HTMLElement;
  retry: HTMLButtonElement;
}

export interface FrameHostOptions {
  /** Called after the state changes. */
  onState?: (state: FrameState, failure: FrameFailure | null) => void;
  /** Called after a frame has been put on the canvas, with the time it shows. */
  onDrawn?: (t: number) => void;
  /**
   * The stage box belongs to someone else and has whatever shape they gave it (a clip engine's
   * stage element): fit the picture inside it, keeping the stage's own shape, instead of filling it.
   */
  fit?: boolean;
  /** For tests only: how the worker is built (to leave the lockdown out and measure the platform). The player never sets it. */
  worker?: WorkerSourceOptions;
}

export interface FrameStats {
  /** Frames put on the canvas. */
  frames: number;
  /** Workers started. */
  spawns: number;
  /** Fresh workers swapped in because the allocation budget ran low. */
  recycles: number;
  /** Answers refused: wrong size, wrong id, not a bitmap. */
  rejected: number;
  failures: { code: FrameFailure; at: number }[];
  /** Milliseconds from request to picture, most recent last (at most 600). */
  ms: number[];
  lastError: string;
  /** Globals the runtime could not remove, as it reported them. */
  left: readonly string[];
}

interface Pending {
  id: number;
  t: number;
  at: number;
  pw: number;
  ph: number;
}

const MESSAGES: Record<FrameFailure, string> = {
  'timeout:boot': FRAME_TEXT.timeout,
  'timeout:frame': FRAME_TEXT.timeout,
  error: FRAME_TEXT.error,
  'bad-frame': FRAME_TEXT.badFrame,
  flood: FRAME_TEXT.flood,
  greedy: FRAME_TEXT.greedy,
  unsupported: FRAME_TEXT.unsupported,
  blocked: FRAME_TEXT.blocked,
};

// One probe and one 1x1 canvas for the whole page, to turn a colour token into "#rrggbb" whatever
// syntax the stylesheet used (light-dark(), oklch(), a system colour in forced-colours mode).
let probe: HTMLSpanElement | null = null;
let probeCtx: CanvasRenderingContext2D | null = null;

function hex2(v: number): string {
  return (v < 16 ? '0' : '') + v.toString(16);
}

/** The lesson's colours as the frame's `S.theme`, resolved for the theme in force where `scope` sits. */
export function readTheme(scope: HTMLElement): FrameTheme {
  if (!probe) {
    probe = document.createElement('span');
    probe.hidden = true;
    probeCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  }
  scope.append(probe);
  const out: Record<string, string> = {};
  for (const role of Object.keys(THEME_TOKENS) as ThemeRole[]) {
    probe.style.setProperty('color', `var(${THEME_TOKENS[role]})`);
    let rgb = [128, 128, 128];
    if (probeCtx) {
      probeCtx.clearRect(0, 0, 1, 1);
      probeCtx.fillStyle = '#000';
      probeCtx.fillStyle = getComputedStyle(probe).color;
      probeCtx.fillRect(0, 0, 1, 1);
      const d = probeCtx.getImageData(0, 0, 1, 1).data;
      rgb = [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
    }
    out[role] = `#${rgb.map(hex2).join('')}`;
  }
  probe.remove();
  const bg = out.bg ?? '#ffffff';
  const light = (parseInt(bg.slice(1, 3), 16) + parseInt(bg.slice(3, 5), 16) + parseInt(bg.slice(5, 7), 16)) / 3 >= 128;
  return { ...(out as Record<ThemeRole, string>), scheme: light ? 'light' : 'dark' };
}

export class FrameHost {
  state: FrameState = 'idle';
  failure: FrameFailure | null = null;
  readonly stats: FrameStats = { frames: 0, spawns: 0, recycles: 0, rejected: 0, failures: [], ms: [], lastError: '', left: [] };
  /** The time the canvas should show, in seconds. */
  t: number;
  /** Stage size in units and device pixels per unit, once the box has been measured. */
  units: { w: number; h: number } | null = null;
  scale = 1;
  quality = 1;
  readonly params: Record<string, number> = Object.create(null) as Record<string, number>;

  private worker: Worker | null = null;
  private ready = false;
  private pending: Pending | null = null;
  private dirty = false;
  private queued = false;
  private nextId = 1;
  private unsolicited = 0;
  private timer = 0;
  private idleTimer = 0;
  private spawnedAt = 0;
  private shortLives = 0;
  private slow = 0;
  private visible = false;
  private theme: FrameTheme | null = null;
  private readonly bitmap: ImageBitmapRenderingContext | null;
  private readonly cleanup: (() => void)[] = [];
  private readonly waiters: (() => void)[] = [];

  constructor(
    private readonly el: FrameElements,
    private readonly spec: FrameSpec,
    private readonly opts: FrameHostOptions = {},
  ) {
    this.t = this.clampTime(spec.poster);
    for (const p of spec.params ?? []) this.params[p.id] = p.value;
    this.bitmap = typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && typeof ImageBitmap === 'function' ? el.canvas.getContext('bitmaprenderer') : null;
    el.root.dataset.state = 'idle';
    if (!this.bitmap) {
      this.fail('unsupported');
      return;
    }
    const onRetry = (): void => this.retry();
    el.retry.addEventListener('click', onRetry);
    this.cleanup.push(() => el.retry.removeEventListener('click', onRetry));

    const resize = new ResizeObserver(() => this.layout());
    resize.observe(el.stage);
    this.cleanup.push(() => resize.disconnect());

    // The theme can change under the frame: the system scheme, or the learner's own choice.
    const retheme = (): void => {
      this.theme = null;
      this.request();
    };
    const queries = ['(prefers-color-scheme: dark)', '(prefers-contrast: more)', '(forced-colors: active)'].map((q) => window.matchMedia(q));
    for (const q of queries) q.addEventListener('change', retheme);
    const themeAttr = new MutationObserver(retheme);
    themeAttr.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // Zoom changes the device pixel ratio without always changing the box.
    const onResize = (): void => this.layout();
    window.addEventListener('resize', onResize);
    this.cleanup.push(() => {
      for (const q of queries) q.removeEventListener('change', retheme);
      themeAttr.disconnect();
      window.removeEventListener('resize', onResize);
    });

    // The code does not run until the frame is on screen. Then the instant asked for last is drawn
    // (the poster still, until someone asks for another).
    const seen = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.visible) {
        this.layout();
        this.request();
      }
    });
    // What has to be seen is the box the picture goes in, which is not always inside the frame's own element.
    seen.observe(el.stage);
    this.cleanup.push(() => seen.disconnect());
  }

  /**
   * Ask for the instant `t` (seconds). Requests coalesce: several in one task draw only the last,
   * and while a frame is being drawn the newest replaces any that waits. Slow code drops frames;
   * it never queues them.
   */
  setTime(t: number): void {
    this.t = this.clampTime(t);
    this.request();
  }

  /** A slider moved. The current instant is redrawn with the new value. */
  setParam(id: string, value: number): void {
    if (!(id in this.params) || !Number.isFinite(value)) return;
    this.params[id] = value;
    this.request();
  }

  /** Resolves when the canvas shows the time last asked for, or the frame is off or cannot draw yet. */
  settled(): Promise<void> {
    if (!this.busy()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** After a failure: start again from a fresh worker. */
  retry(): void {
    if (this.state !== 'failed' || this.failure === 'unsupported' || this.failure === 'blocked') return;
    this.failure = null;
    this.shortLives = 0;
    this.el.status.textContent = '';
    // The button is about to go: a keyboard user who pressed it keeps their place, on the frame itself.
    const hadFocus = document.activeElement === this.el.retry;
    this.el.retry.hidden = true;
    if (hadFocus) {
      this.el.root.tabIndex = -1;
      this.el.root.focus({ preventScroll: true });
    }
    this.setState('idle');
    this.request();
  }

  destroy(): void {
    this.kill();
    for (const f of this.cleanup.splice(0)) f();
    this.flush();
  }

  // ----- sizing ---------------------------------------------------------------------------------

  private clampTime(t: number): number {
    return Number.isFinite(t) ? Math.max(0, Math.min(this.spec.duration, t)) : 0;
  }

  /** Measure the stage box and choose stage units and scale. A change of shape restarts the worker. */
  layout(): void {
    const boxW = this.el.stage.clientWidth;
    const boxH = this.el.stage.clientHeight;
    if (!boxW || !boxH) return;
    // Two stages could be drawn here: the author's aspect, or the tall one a narrow column gets.
    const wide = stageUnits(this.spec.aspect, false);
    const tall = stageUnits(this.spec.aspect, true);
    let units = wide;
    if (this.opts.fit) {
      // Someone else's box (a clip engine's stage: wide and low on a wide screen, taller than wide
      // on a narrow one). The stage that comes out larger in it, with more pixels per unit and so
      // larger text, is the one it is for.
      const fits = (u: { w: number; h: number }): number => Math.min(boxW / u.w, boxH / u.h);
      if (fits(tall) > fits(wide) * 1.02) units = tall;
    } else {
      // The stylesheet's box has exactly one of the two shapes: take the one it is.
      const shape = boxH / boxW;
      if (Math.abs(shape - tall.h / tall.w) < Math.abs(shape - wide.h / wide.w)) units = tall;
    }
    let w = boxW;
    if (this.opts.fit) {
      // Someone else's box: the largest picture of the stage's shape that fits inside it.
      w = Math.max(1, Math.floor(Math.min(boxW, (boxH * units.w) / units.h)));
      const h = Math.max(1, Math.round((w * units.h) / units.w));
      this.el.canvas.style.setProperty('width', `${w}px`);
      this.el.canvas.style.setProperty('height', `${h}px`);
    }
    const dpr = Math.min(window.devicePixelRatio || 1, WATCHDOG.maxScale);
    let scale = (w / units.w) * dpr * this.quality;
    if (units.w * scale * units.h * scale > WATCHDOG.maxPixels) scale = Math.sqrt(WATCHDOG.maxPixels / (units.w * units.h));
    const reshaped = this.units !== null && (this.units.w !== units.w || this.units.h !== units.h);
    const changed = reshaped || this.units === null || Math.abs(this.scale - scale) > 1e-6;
    this.units = units;
    this.scale = scale;
    // Set-up code may have read the old stage size, so a new shape gets a new worker.
    if (reshaped) this.kill();
    if (changed) this.request();
  }

  // ----- the worker's life ----------------------------------------------------------------------

  private spawn(): void {
    let w: Worker;
    try {
      w = new Worker(workerUrl(this.spec.code, this.opts.worker));
    } catch (error) {
      // Text that cannot be put in a URL (a lone surrogate) is the code's fault; anything else is the browser refusing a worker.
      this.stats.lastError = String(error).slice(0, 300);
      this.fail(error instanceof URIError ? 'error' : 'blocked');
      return;
    }
    this.worker = w;
    this.ready = false;
    this.unsolicited = 0;
    this.stats.spawns++;
    this.spawnedAt = performance.now();
    w.onmessage = (ev: MessageEvent): void => {
      if (this.worker === w) this.onMessage(ev.data);
      else closeBitmap(ev.data);
    };
    w.onerror = (ev: ErrorEvent): void => {
      ev.preventDefault();
      if (this.worker !== w) return;
      this.stats.lastError = String(ev.message || 'error').slice(0, 300);
      this.fail('error');
    };
    w.onmessageerror = (): void => {
      if (this.worker === w) this.strike();
    };
    this.arm(WATCHDOG.bootMs, 'timeout:boot');
  }

  private arm(ms: number, code: FrameFailure): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.fail(code), ms);
  }

  private kill(): void {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.idleTimer);
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
    }
    this.worker = null;
    this.ready = false;
    this.pending = null;
  }

  private fail(code: FrameFailure): void {
    this.kill();
    this.failure = code;
    this.stats.failures.push({ code, at: performance.now() });
    this.el.canvas.hidden = true;
    this.el.placeholder.hidden = false;
    this.el.status.textContent = MESSAGES[code];
    this.el.retry.hidden = code === 'unsupported' || code === 'blocked';
    this.setState('failed');
  }

  private setState(state: FrameState): void {
    const was = this.state;
    this.state = state;
    this.el.root.dataset.state = state;
    if (state === 'failed' && this.failure) this.el.root.dataset.failure = this.failure;
    else delete this.el.root.dataset.failure;
    if (was !== state || state === 'failed') this.opts.onState?.(state, this.failure);
    this.flush();
  }

  private busy(): boolean {
    return this.state !== 'failed' && this.visible && this.units !== null && (this.pending !== null || this.dirty || this.stats.frames === 0);
  }

  private flush(): void {
    if (this.busy()) return;
    for (const resolve of this.waiters.splice(0)) resolve();
  }

  /** Something arrived that is not the one answer asked for. */
  private strike(): void {
    if (++this.unsolicited > WATCHDOG.unsolicited) this.fail('flood');
  }

  // ----- one request at a time -------------------------------------------------------------------

  /** Something changed: the canvas should be redrawn. Sent at the end of the task, so calls in one task make one request. */
  private request(): void {
    this.dirty = true;
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (this.dirty) this.pump();
    });
  }

  private pump(): void {
    if (this.state === 'failed' || !this.visible || !this.units) return;
    window.clearTimeout(this.idleTimer);
    if (!this.worker) this.spawn();
    if (!this.worker || !this.ready || this.pending) return;
    this.dirty = false;
    if (!this.theme) this.theme = readTheme(this.el.root);
    const id = this.nextId++;
    const { pw, ph } = bitmapSize(this.units.w, this.units.h, this.scale);
    this.pending = { id, t: this.t, at: performance.now(), pw, ph };
    const message: FrameRequest = { type: 'frame', id, t: this.t, dur: this.spec.duration, w: this.units.w, h: this.units.h, scale: this.scale, theme: this.theme, params: { ...this.params } };
    this.worker.postMessage(message);
    this.arm(WATCHDOG.frameMs, 'timeout:frame');
  }

  private onMessage(m: unknown): void {
    const p = this.pending;
    const msg = (typeof m === 'object' && m !== null ? m : {}) as { type?: unknown; id?: unknown; bitmap?: unknown; phase?: unknown; message?: unknown; left?: unknown };

    if (msg.type === 'ready' && !this.ready) {
      this.ready = true;
      if (Array.isArray(msg.left)) this.stats.left = msg.left.filter((x): x is string => typeof x === 'string').slice(0, 200);
      window.clearTimeout(this.timer);
      this.dirty = true;
      this.pump();
      return;
    }

    if (msg.type === 'frame' && p && msg.id === p.id) {
      // The one answer asked for. It must be a bitmap of exactly the size asked for: anything else ends the frame.
      const bmp = msg.bitmap;
      if (!(bmp instanceof ImageBitmap) || bmp.width !== p.pw || bmp.height !== p.ph) {
        closeBitmap(msg);
        this.stats.rejected++;
        this.fail('bad-frame');
        return;
      }
      window.clearTimeout(this.timer);
      this.pending = null;
      const c = this.el.canvas;
      if (c.width !== p.pw || c.height !== p.ph) {
        c.width = p.pw;
        c.height = p.ph;
      }
      this.bitmap?.transferFromImageBitmap(bmp);
      c.hidden = false;
      this.el.placeholder.hidden = true;
      const now = performance.now();
      const ms = now - p.at;
      this.stats.frames++;
      this.stats.ms.push(ms);
      if (this.stats.ms.length > 600) this.stats.ms.shift();
      if (this.state === 'idle') this.setState('live');
      this.opts.onDrawn?.(p.t);
      // Three slow frames in a row: draw fewer pixels rather than stutter.
      this.slow = ms > WATCHDOG.slowMs ? this.slow + 1 : 0;
      if (this.slow >= 3 && this.quality > 0.5) {
        this.quality = Math.max(0.5, this.quality * 0.7);
        this.slow = 0;
        this.layout();
      }
      if (this.dirty) this.pump();
      else {
        // Nobody is asking: after a while the worker is ended. The canvas keeps its picture, and
        // the next request starts a new worker, which draws the same thing for the same t.
        this.idleTimer = window.setTimeout(() => this.kill(), WATCHDOG.idleMs);
        this.flush();
      }
      return;
    }

    if (msg.type === 'recycle' && p && msg.id === p.id) {
      // The worker has used most of its allocation budget. Honest code that allocates a little
      // every frame lives for seconds between swaps; code that burns the whole budget in well
      // under a second, three times running, is turned off.
      this.stats.recycles++;
      this.shortLives = performance.now() - this.spawnedAt < WATCHDOG.shortLifeMs ? this.shortLives + 1 : 0;
      if (this.shortLives >= 3) {
        this.fail('greedy');
        return;
      }
      this.kill();
      this.dirty = true;
      this.pump();
      return;
    }

    if (msg.type === 'error' && (msg.phase === 'load' || (p && msg.id === p.id))) {
      this.stats.lastError = String(msg.message).slice(0, 300);
      this.fail('error');
      return;
    }

    closeBitmap(msg);
    this.stats.rejected++;
    this.strike();
  }
}

function closeBitmap(m: unknown): void {
  const bmp = typeof m === 'object' && m !== null ? (m as { bitmap?: unknown }).bitmap : null;
  if (typeof ImageBitmap === 'function' && bmp instanceof ImageBitmap) bmp.close();
}
