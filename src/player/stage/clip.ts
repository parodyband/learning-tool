// A clip that plays. It holds one number, `t`, and everything on screen is drawn from it:
// `render(t)` draws any instant, and the playback loop only decides which t to draw next. Play,
// pause, scrub, step, replay, resize, a change of theme, reduced motion and print are all the same
// operation.
//
// Where a clip rests:
//   - the poster: the stage after its establishing move, before the first caption;
//   - the end of each beat (a hair before the next one starts), where step mode stops;
//   - before a beat that carries a prediction, until the learner has committed or skipped;
//   - the end.
import { type ToneName, TONES, clamp, h } from './core';
import type { ExploreState } from './explore';
import type { StageEnv, TapTarget } from './kit';
import { type BeatTime, type Timeline, stageHeight } from './timeline';

export type ClipEvent = 'time' | 'beat' | 'state' | 'hold' | 'gate' | 'seek' | 'build' | 'ready';

/** Builds the timeline for a size. A stage kit clip compiles its beats; a custom frame brings its own. */
export type TimelineMaker = (env: Omit<StageEnv, 'values' | 'texts' | 'drawn' | 'explore' | 'actions'>) => Timeline;

export interface ClipOptions {
  /** Reduced motion: every instant of a beat shows that beat's end state. No travel. */
  reduced?: boolean;
  /** Fixed stage width, for a still that is built off screen. Default: the width of the view. */
  width?: number;
  /** The most height the stage may take (the room the window leaves it). */
  maxHeight?: () => number;
  /** Called by render with the instant that was drawn and the beat it lies in (-1 before the first). */
  draw?: (t: number, beat: number, clip: Clip) => void;
}

/** Resolve the tone colours once per build, through a probe: custom properties hold light-dark() unresolved. */
export function toneColors(el: HTMLElement): Record<ToneName, [number, number, number]> {
  const out = {} as Record<ToneName, [number, number, number]>;
  const probe = el.appendChild(h('i', 'st-probe'));
  for (const tone of TONES) {
    probe.setAttribute('data-tone', tone);
    let rgb: [number, number, number] = [150, 150, 160];
    try {
      const m = getComputedStyle(probe).color.match(/[\d.]+/g);
      if (m && m.length >= 3) rgb = [Number(m[0]), Number(m[1]), Number(m[2])];
    } catch {
      // No computed style (not in a page): the fallback grey is as good as any.
    }
    out[tone] = rgb;
  }
  probe.remove();
  return out;
}

export class Clip {
  t = 0;
  /** The beat `t` lies in, or -1 before the first. */
  k = -1;
  playing = false;
  rate = 1;
  /** Pause after every beat. */
  stepMode = false;
  reduced: boolean;
  beats: readonly BeatTime[] = [];
  duration = 1;
  /** Stage width of the current build, in CSS pixels. */
  W = 0;
  /** Beats whose prediction has been answered or skipped. */
  readonly passed = new Set<number>();
  /** Length in ms of each beat's narration while the clip is voiced. */
  audioMs: (number | undefined)[] | undefined;
  /** Narration steers the clock through this while it is speaking. */
  sync: ((t: number) => number) | null = null;
  /** True while the establishing move plays by itself on arrival. */
  opening = false;
  /**
   * The learner's numbers, once the stage has been handed over (explore.ts). They are drawn in
   * place of the clip's own at the end of the clip and nowhere else: every earlier instant is
   * still a function of t alone.
   */
  live: ExploreState | null = null;

  private timeline: Timeline | null = null;
  private stopAt: number | null = null;
  private raf = 0;
  private last = 0;
  private readonly listeners = new Map<ClipEvent, ((arg: number) => void)[]>();

  constructor(
    private readonly make: TimelineMaker,
    readonly view: HTMLElement,
    private readonly opts: ClipOptions = {},
  ) {
    this.reduced = opts.reduced === true;
    this.build();
  }

  on(name: ClipEvent, fn: (arg: number) => void): void {
    const list = this.listeners.get(name) ?? [];
    list.push(fn);
    this.listeners.set(name, list);
  }
  private emit(name: ClipEvent, arg = 0): void {
    for (const fn of this.listeners.get(name) ?? []) fn(arg);
  }

  /** Build (or build again) for the view's current size, keeping the place within the current beat. */
  build(): void {
    const el = this.view;
    const W = Math.max(280, Math.round(this.opts.width ?? (el.clientWidth || 640)));
    const H = stageHeight(W, this.opts.maxHeight?.());
    const before = this.timeline ? this.where() : null;
    this.timeline?.destroy?.();
    el.replaceChildren();
    el.style.setProperty('height', `${H}px`);
    const colors = toneColors(el);
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    this.timeline = this.make({ el, W, H, dpr, colors, audio: this.audioMs });
    this.beats = this.timeline.beats;
    this.duration = Math.max(1, this.timeline.duration);
    this.W = W;
    if (before) this.t = this.fromWhere(before);
    this.k = -2;
    this.emit('build');
    this.render(this.t);
  }
  /** The place as a beat and a share of it, so a rebuild with other timings lands on the same moment. */
  private where(): { k: number; f: number } {
    const k = this.beatAt(this.t);
    if (k < 0) return { k, f: this.poster > 0 ? this.t / this.poster : 1 };
    const b = this.beats[k] as BeatTime;
    return { k, f: (this.t - b.t0) / Math.max(1, b.t1 - 1 - b.t0) };
  }
  private fromWhere(w: { k: number; f: number }): number {
    if (w.k < 0) return this.poster * clamp(w.f, 0, 1);
    const b = this.beats[Math.min(w.k, this.beats.length - 1)];
    return b ? b.t0 + clamp(w.f, 0, 1) * (b.t1 - 1 - b.t0) : 0;
  }

  /** The poster frame: the stage established, nothing said yet. */
  get poster(): number {
    const first = this.beats[0];
    return first ? Math.max(0, first.t0 - 1) : 0;
  }
  get end(): number {
    return this.duration - 1;
  }
  beatAt(t: number): number {
    let k = this.beats.length - 1;
    while (k >= 0 && (this.beats[k] as BeatTime).t0 > t) k--;
    return k;
  }
  /** Places to rest: the poster, then the end of every beat. */
  stops(): number[] {
    return [this.poster, ...this.beats.map((b) => b.t1 - 1)];
  }
  /** Where the clip waits for the prediction on beat i: the end of the beat before it. */
  gateHold(i: number): number {
    const b = this.beats[i];
    return !b || i === 0 ? this.poster : b.t0 - 1;
  }
  /** The first beat whose prediction is still open, or -1. */
  openGate(): number {
    for (const b of this.beats) if (b.gate && !this.passed.has(b.i)) return b.i;
    return -1;
  }
  /** The furthest the learner may go: a beat with an open prediction holds the clip before it. */
  limit(): number {
    const g = this.openGate();
    return g < 0 ? this.end : this.gateHold(g);
  }
  /** Whether the clip stands at an open prediction. */
  atGate(): boolean {
    return this.openGate() >= 0 && this.t >= this.limit() - 1;
  }
  atEnd(): boolean {
    return this.t >= this.end - 1;
  }
  /** Whether the first caption has not been reached yet. */
  beforeStart(): boolean {
    return this.t <= this.poster + 1;
  }

  /** The instant that is drawn for t. With reduced motion every instant of a beat is that beat's end state. */
  shownAt(t: number): number {
    if (!this.reduced) return t;
    const k = this.beatAt(t);
    return k < 0 ? this.poster : (this.beats[k] as BeatTime).t1 - 1;
  }

  render(t: number): void {
    this.t = clamp(t, 0, this.end);
    const k = this.beatAt(this.t);
    const shown = this.shownAt(this.t);
    this.timeline?.apply(shown, this.live !== null && this.atEnd() ? this.live : undefined);
    this.opts.draw?.(shown, k, this);
    if (k !== this.k) {
      this.k = k;
      this.emit('beat', k);
    }
    this.emit('time');
  }

  seek(t: number): void {
    this.stopAt = null;
    this.render(Math.min(t, this.limit()));
    this.emit('seek');
  }

  /** Where playback from the current instant must stop next. */
  private nextHold(): { t: number; gate: number } {
    const g = this.openGate();
    let t = this.end;
    let gate = -1;
    if (g >= 0 && this.gateHold(g) <= t) {
      t = this.gateHold(g);
      gate = g;
    }
    if (this.stopAt !== null && this.stopAt < t) {
      t = this.stopAt;
      gate = -1;
    }
    if (this.stepMode && !this.opening) {
      const stop = this.stops().find((x) => x > this.t + 2 && x > this.poster);
      if (stop !== undefined && stop < t) {
        t = stop;
        gate = -1;
      }
    }
    return { t, gate };
  }

  play(until: number | null = null): void {
    if (this.atEnd()) this.t = 0;
    if (this.atGate()) {
      this.emit('gate', this.openGate());
      return;
    }
    this.stopAt = until;
    if (this.playing) return;
    this.playing = true;
    this.last = performance.now();
    this.emit('state');
    const tick = (now: number): void => {
      if (!this.playing) return;
      const dt = Math.min(100, now - this.last) * this.rate;
      this.last = now;
      let t = this.t + dt;
      if (this.sync) t = this.sync(t);
      const hold = this.nextHold();
      if (t >= hold.t) {
        this.render(hold.t);
        const wasOpening = this.opening;
        this.halt();
        if (hold.gate >= 0) this.emit('gate', hold.gate);
        else this.emit(wasOpening ? 'ready' : 'hold', this.k);
        return;
      }
      this.render(t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  private halt(): void {
    if (!this.playing) return;
    this.playing = false;
    this.opening = false;
    this.stopAt = null;
    cancelAnimationFrame(this.raf);
    this.emit('state');
  }
  pause(): void {
    this.halt();
  }
  toggle(): void {
    if (this.playing && !this.opening) this.pause();
    else {
      this.opening = false;
      this.play();
    }
  }

  /**
   * The establishing move, played once when the clip comes into view: the parts arrive and the
   * clip rests on its poster. With reduced motion the poster is simply shown.
   */
  open(): void {
    if (this.playing || this.t > 0) return;
    if (this.reduced || this.poster <= 0) {
      this.render(this.poster);
      // A custom frame stands on the still its author chose until it is played.
      this.timeline?.still?.('poster');
      this.emit('ready');
      return;
    }
    this.opening = true;
    this.play(this.poster);
  }

  /** Next: while playing, skip ahead to the next beat. While paused, play one beat and stop: a step. */
  next(): void {
    const lim = this.limit();
    if (this.t >= lim - 1) {
      if (this.openGate() >= 0) this.emit('gate', this.openGate());
      return;
    }
    const target = Math.min(this.stops().find((x) => x > this.t + 2) ?? this.end, lim);
    if (this.playing && !this.opening) {
      const k = this.beatAt(this.t);
      const nb = this.beats[k + 1];
      if (nb && nb.t0 <= lim) {
        this.render(nb.t0);
        this.emit('seek');
      }
      return;
    }
    if (this.reduced) {
      this.seek(target);
      if (this.atGate()) this.emit('gate', this.openGate());
      else this.emit('hold', this.k);
      return;
    }
    this.opening = false;
    this.play(target);
  }
  /** Previous: back to the last place the clip rested. */
  prev(): void {
    let target = this.poster;
    for (const x of this.stops()) if (x < this.t - 2) target = x;
    this.halt();
    this.render(Math.min(target, this.t));
    this.emit('seek');
  }
  replay(): void {
    this.halt();
    this.render(this.reduced ? this.poster : 0);
    this.emit('seek');
    this.play();
  }
  setRate(r: number): void {
    this.rate = r;
  }
  /** The parts of the stage a tap gate may offer where the clip stands now. */
  taps(): TapTarget[] {
    return this.timeline?.taps?.(this.shownAt(this.t)) ?? [];
  }
  /** Whether something drawn for the learner's numbers is still on its way. */
  busy(): boolean {
    return this.timeline?.busy?.() === true;
  }
  pass(i: number): void {
    this.passed.add(i);
  }
  destroy(): void {
    this.halt();
    this.timeline?.destroy?.();
  }
}
