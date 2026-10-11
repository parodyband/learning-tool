// A stand-in for a Web Worker, for testing the frame runtime in Node without a browser.
//
// The runtime is shipped as text and run in a worker; here the same text is run in a fresh V8
// context (node:vm), which is a separate realm with its own Object, Math and String, so the
// lockdown can delete globals there without touching the test process. The context is given the
// few things a worker has that the runtime uses (postMessage, addEventListener, OffscreenCanvas
// and a 2D context that records what was drawn) and a handful of things it must remove.
//
// A vm context is not a security boundary and nothing here claims to be one: these tests run our
// own runtime and our own sample animations. What the platform blocks is measured in real
// browsers by test/player/frame-escape.spec.ts.
import vm from 'node:vm';
import { type WorkerSourceOptions, workerSource } from '../../src/player/frame/runtime';

const WORKER_GLOBALS = `
(function (G) {
  var METHODS = 'save restore beginPath rect roundRect arc arcTo ellipse moveTo lineTo closePath quadraticCurveTo bezierCurveTo fill stroke clip fillRect strokeRect clearRect fillText strokeText setTransform transform resetTransform translate rotate scale setLineDash drawImage putImageData'.split(' ');
  function Ctx(canvas) { this.canvas = canvas; this.calls = []; this.globalAlpha = 1; this.font = '10px sans-serif'; }
  METHODS.forEach(function (m) { Ctx.prototype[m] = function () { this.calls.push([m].concat(Array.prototype.slice.call(arguments))); }; });
  Ctx.prototype.reset = function () { this.calls = [['reset']]; };
  Ctx.prototype.measureText = function (s) { var size = parseFloat(/([0-9.]+)px/.exec(this.font)[1]); return { width: String(s).length * size * 0.5 }; };
  Ctx.prototype.createImageData = function (w, h) { return { width: w, height: h }; };
  Ctx.prototype.getImageData = function (x, y, w, h) { return { width: w, height: h }; };
  G.OffscreenCanvasRenderingContext2D = Ctx;
  function OffscreenCanvas(w, h) { this._w = w; this._h = h; this._ctx = null; }
  Object.defineProperty(OffscreenCanvas.prototype, 'width', { get: function () { return this._w; }, set: function (v) { this._w = v; if (this._ctx) this._ctx.calls = []; }, configurable: true });
  Object.defineProperty(OffscreenCanvas.prototype, 'height', { get: function () { return this._h; }, set: function (v) { this._h = v; if (this._ctx) this._ctx.calls = []; }, configurable: true });
  OffscreenCanvas.prototype.getContext = function (kind) { if (kind !== '2d') return { kind: kind }; return this._ctx || (this._ctx = new Ctx(this)); };
  OffscreenCanvas.prototype.transferToImageBitmap = function () { return { width: this._w, height: this._h, calls: this._ctx ? this._ctx.calls.slice() : [] }; };
  G.OffscreenCanvas = OffscreenCanvas;
  G.ImageData = function ImageData(w, h) { this.width = w; this.height = h; };
  // Things a real worker has and a frame must not.
  G.fetch = function () { return 'fetched'; };
  G.XMLHttpRequest = function () {};
  G.WebSocket = function () {};
  G.Worker = function () {};
  G.importScripts = function () {};
  G.setTimeout = function () {};
  G.setInterval = function () {};
  G.requestAnimationFrame = function () {};
  G.queueMicrotask = function () {};
  G.navigator = { userAgent: 'test', gpu: {} };
  G.caches = {};
  G.indexedDB = {};
  G.performance = { now: function () { return 0; } };
  G.console = { log: function () {} };
  G.self = G;
  G.close = function () {};
})(this);
`;

export interface Realm {
  /** Every message the worker posted, oldest first. */
  sent: any[];
  /** Deliver a message to the worker, as the host's postMessage would. */
  deliver(message: unknown): void;
  /** Evaluate an expression in the worker's realm. */
  evaluate(expression: string): any;
  /** Ask for one frame and return what came back. */
  frame(t: number, over?: Partial<{ w: number; h: number; scale: number; dur: number; params: Record<string, number> }>): any;
}

export const TEST_THEME = {
  bg: '#fbfaf7',
  surface: '#ffffff',
  sunken: '#f3f1ea',
  fg: '#1c1b18',
  fg2: '#4c4942',
  muted: '#66625a',
  line: '#e2ded4',
  lineStrong: '#878275',
  accent: '#2b3c9d',
  accentInk: '#ffffff',
  accentSoft: '#eceefa',
  good: '#17663a',
  goodSoft: '#e3f2e9',
  bad: '#a12a22',
  badSoft: '#fbe9e7',
  warn: '#7a5200',
  warnSoft: '#fbf0d6',
  mark: '#fdf0b8',
  scheme: 'light',
};

/** Start a worker for `code` in a fresh realm. `prelude` is extra script run in the realm before the worker's text. */
export function startWorker(code: string, opts: WorkerSourceOptions & { prelude?: string; source?: string } = {}): Realm {
  const sent: any[] = [];
  const listeners: ((ev: { data: unknown }) => void)[] = [];
  const sandbox: Record<string, unknown> = {
    postMessage: (m: unknown) => sent.push(m),
    addEventListener: (type: string, fn: (ev: { data: unknown }) => void) => {
      if (type === 'message') listeners.push(fn);
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(WORKER_GLOBALS, context);
  if (opts.prelude) vm.runInContext(opts.prelude, context);
  vm.runInContext(opts.source ?? workerSource(code, opts), context, { timeout: 5000 });
  let nextId = 1;
  return {
    sent,
    deliver: (message) => {
      for (const fn of listeners) fn({ data: message });
    },
    evaluate: (expression) => vm.runInContext(expression, context),
    frame(t, over = {}) {
      const id = nextId++;
      const before = sent.length;
      for (const fn of listeners) fn({ data: { type: 'frame', id, t, dur: 10, w: 960, h: 540, scale: 1, theme: TEST_THEME, params: {}, ...over } });
      return sent.slice(before).find((m) => m && m.id === id);
    },
  };
}
