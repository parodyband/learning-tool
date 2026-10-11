// The page script of the frame specs. It is bundled by frame-kit.ts with the same settings as the
// player's own bundle and placed in a page built with the product's real policy, so the worker
// runtime is the minified text a lesson would ship.
//
// It stands in for the clip's controls, which belong to the clip engine: a driver that owns the
// clock and asks the kit for instants. In "probe" mode it instead starts one worker itself, from
// the production worker text plus a reporting hook, and collects what the probes say.
import { type FrameKit, type FrameStageData, WATCHDOG, createFrameKit, workerUrl } from '../../src/player/frame/index';

interface FrameSpecData {
  id: string;
  title: string;
  description: string;
  stage: FrameStageData;
  beats: { at: number; caption: string }[];
  /** Leave the lockdown out, to measure what the platform and the host stop by themselves. */
  raw?: boolean;
}
interface PageData {
  frames?: FrameSpecData[];
  probe?: { code: string; hardened: boolean };
}

class Driver {
  t: number;
  playing = false;
  started = false;
  speed = 1;
  playAt = 0;
  private last = 0;
  constructor(
    readonly spec: FrameSpecData,
    public kit: FrameKit,
    readonly caption: HTMLElement | null,
    private readonly make: () => FrameKit,
  ) {
    this.t = kit.poster;
  }
  /** Destroy the kit and make it again, as a clip engine does when the page is resized. */
  rebuild(): void {
    this.playing = false;
    this.kit.destroy();
    this.kit = this.make();
    this.kit.render(this.t);
  }
  play(): void {
    if (this.kit.state === 'failed' || this.playing) return;
    // The first Play starts from the beginning, not from the poster still.
    if (!this.started || this.t >= this.kit.duration) this.t = 0;
    this.started = true;
    this.playing = true;
    this.playAt = this.last = performance.now();
    const tick = (now: number): void => {
      if (!this.playing) return;
      this.t += Math.min(0.1, (now - this.last) / 1000) * this.speed;
      this.last = now;
      if (this.t >= this.kit.duration) {
        this.t = this.kit.duration;
        this.playing = false;
      }
      this.draw();
      if (this.playing) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  pause(): void {
    this.playing = false;
  }
  seek(t: number): void {
    this.started = true;
    this.playing = false;
    this.t = Math.max(0, Math.min(this.kit.duration, t));
    this.draw();
  }
  restart(): void {
    this.playing = false;
    this.t = this.kit.duration;
    this.play();
  }
  private draw(): void {
    this.kit.render(this.t);
    if (!this.caption) return;
    let text = '';
    for (const b of this.spec.beats) if (this.t >= b.at) text = b.caption;
    if (this.caption.textContent !== text) this.caption.textContent = text;
  }
}

declare global {
  interface Window {
    __ltf?: { drivers: Driver[]; get(id: string): Driver; limits: typeof WATCHDOG };
    __ready?: boolean;
    __lag?: { timer: number; raf: number };
    __viol?: string[];
    __r?: { violations: string[]; probe: unknown; late: Record<string, string>; msgs: number; bc: unknown[]; workerError: string | null; ready: unknown };
  }
}

window.__viol = [];
document.addEventListener('securitypolicyviolation', (e) => {
  window.__viol?.push(`${e.effectiveDirective} ${String(e.blockedURI).slice(0, 40)} @${e.target instanceof Element ? e.target.nodeName : ''}`);
});

// How long the page's own thread was ever kept from running: the largest gap between timer ticks and between frames.
window.__lag = { timer: 0, raf: 0 };
{
  const lag = window.__lag;
  let a = performance.now();
  let b = a;
  window.setInterval(() => {
    const n = performance.now();
    if (n - a > lag.timer) lag.timer = n - a;
    a = n;
  }, 10);
  const frame = (n: number): void => {
    if (n - b > lag.raf) lag.raf = n - b;
    b = n;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

const data = JSON.parse(document.getElementById('lt-data')?.textContent ?? '{}') as PageData;

if (data.probe) {
  const R = (window.__r = { violations: [] as string[], probe: null as unknown, late: {} as Record<string, string>, msgs: 0, bc: [] as unknown[], workerError: null as string | null, ready: null as unknown });
  document.addEventListener('securitypolicyviolation', (e) => R.violations.push(`${e.effectiveDirective} ${String(e.blockedURI).slice(0, 40)}`));
  try {
    new BroadcastChannel('lt-probe').onmessage = (e) => R.bc.push(e.data);
  } catch {
    /* no BroadcastChannel here */
  }
  try {
    localStorage.setItem('lt-secret', 'host-secret');
  } catch {
    /* storage is not available from file:// in every engine */
  }
  // The production worker text, plus a hook that lets a probe report. Nothing else differs from a real frame's worker.
  const w = new Worker(workerUrl(data.probe.code, { hardened: data.probe.hardened, hook: 'function(S,post){S.__report=function(o){post({type:"probe",data:o});};}' }));
  w.onmessage = (e: MessageEvent) => {
    R.msgs++;
    const m = e.data as { type?: string; data?: { late?: Record<string, string> }; message?: string };
    if (m && m.type === 'probe' && m.data) {
      if (m.data.late) Object.assign(R.late, m.data.late);
      else R.probe = m.data;
    }
    if (m && m.type === 'ready') R.ready = m;
    if (m && m.type === 'error') R.workerError = String(m.message);
  };
  w.onerror = (e) => {
    R.workerError = e.message || 'error event';
  };
}

const drivers: Driver[] = [];
for (const spec of data.frames ?? []) {
  const section = Array.from(document.querySelectorAll<HTMLElement>('section[data-scene]')).find((s) => s.dataset.scene === spec.id);
  const root = section?.querySelector<HTMLElement>('.lt-frame');
  if (!section || !root) continue;
  // A section with a stage box of its own stands in for a clip engine's stage: the picture goes there.
  const picture = section.querySelector<HTMLElement>('[data-stagebox]') ?? undefined;
  const make = (): FrameKit => createFrameKit(root, spec.stage, { ...(spec.raw ? { worker: { hardened: false } } : {}), ...(picture ? { picture } : {}) });
  const kit = make();
  const driver = new Driver(spec, kit, section.querySelector<HTMLElement>('[data-caption]'), make);
  drivers.push(driver);

  // Stand-in controls: just enough to drive the kit from the keyboard in a spec.
  const bar = document.createElement('div');
  bar.className = 'h-controls';
  const button = (label: string, act: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lt-btn lt-btn-small';
    b.textContent = label;
    b.dataset.act = label.toLowerCase().replace(/\s+/g, '-');
    b.addEventListener('click', act);
    bar.append(b);
    return b;
  };
  button('Play', () => (driver.playing ? driver.pause() : driver.play()));
  button('Start again', () => driver.restart());
  root.after(bar);
}
window.__ltf = {
  drivers,
  get(id: string): Driver {
    const d = drivers.find((x) => x.spec.id === id);
    if (!d) throw new Error(`no frame ${id}`);
    return d;
  },
  limits: WATCHDOG,
};
window.__ready = true;
