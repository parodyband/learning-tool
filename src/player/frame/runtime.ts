// The custom frame's worker runtime: what runs inside the Web Worker around the agent's code.
//
// THIS FILE IS SHIPPED AS TEXT. The two functions below are never called in the page. The player
// turns them into source with Function.prototype.toString and puts that source, followed by the
// agent's code, into a data: URL that becomes the worker (see workerSource at the bottom). So:
//
//   - Each function must be SELF-CONTAINED: it may use only its own parameters, its own locals and
//     the JavaScript built-ins. It must not touch an import, a module-level constant or another
//     function in this file: that name would not exist in the worker. test/frame/runtime.test.ts
//     runs both from their text in an empty realm and fails if one reaches outside.
//   - They are written in plain ES2017-style JavaScript (var, function) and typed loosely on
//     purpose, so the bundler has nothing to lower and adds no helper that lives outside them.
//
// WHAT THE BOUNDARY IS. Not this file. A worker has no DOM, no window and no way to navigate,
// focus or make a sound. It is started from a data: URL, so its origin is opaque (no storage) and
// it inherits the page's Content-Security-Policy (no network, no eval, no imports). The host
// (host.ts) terminates it when it misses a deadline. Those four hold with everything below
// switched off, which the tests measure (`hardened: false`). The lockdown here is defence in
// depth: it removes what the platform leaves lying around (WebGL and WebGPU, nested workers, the
// Cache API in WebKit), meters the fast ways to eat memory, and makes time and randomness inputs.
//
// The agent's code is the body of a function of S that declares `function render(ctx, t)`.
// Per frame the host sends one message and gets one back:
//   in   { type: 'frame', id, t, dur, w, h, scale, theme, params }
//   out  { type: 'frame', id, bitmap }      one ImageBitmap of round(w*scale) x round(h*scale)
//        { type: 'error', id, message }     render threw
//        { type: 'recycle', id }            the allocation budget is nearly used: start a fresh worker
// and once, after the code's set-up has run:
//        { type: 'ready', left }  or  { type: 'error', phase: 'load', message }
import { FRAME_BODY_PREFIX, FRAME_BODY_SUFFIX } from './shared';

/* eslint-disable no-var, prefer-const, @typescript-eslint/no-explicit-any */

/**
 * The helper library the agent's code sees as `S`. Self-contained (see the top of this file).
 * Returns the library and `bind`, which the runtime calls with the canvas and context to draw on.
 * Members are documented for authors in api.ts; test/frame/api.test.ts holds the two lists equal.
 */
export function frameHelpers(): { S: any; bind: (canvas: any, ctx: any) => void } {
  var canvas: any = null;
  var ctx: any = null;
  var S: any = {};

  function clamp(x: number, a: number, b: number): number {
    return x < a ? a : x > b ? b : x;
  }
  function lerp(a: number, b: number, k: number): number {
    return a + (b - a) * k;
  }
  S.clamp = clamp;
  S.lerp = lerp;

  /** cubic-bezier(x1, y1, x2, y2) as a function of progress, as in CSS. */
  function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
    var cx = 3 * x1;
    var bx = 3 * (x2 - x1) - cx;
    var ax = 1 - cx - bx;
    var cy = 3 * y1;
    var by = 3 * (y2 - y1) - cy;
    var ay = 1 - cy - by;
    return function (x: number): number {
      if (!(x > 0)) return 0;
      if (x >= 1) return 1;
      var u = x;
      for (var i = 0; i < 8; i++) {
        var f = ((ax * u + bx) * u + cx) * u - x;
        var d = (3 * ax * u + 2 * bx) * u + cx;
        if (Math.abs(f) < 1e-5 || d === 0) break;
        u -= f / d;
      }
      return ((ay * u + by) * u + cy) * u;
    };
  }
  S.bezier = bezier;

  // Names and values follow the easing table in motion-design-skills/animation-principles (MIT).
  S.ease = {
    linear: function (x: number): number {
      return clamp(x, 0, 1);
    },
    out: bezier(0.33, 1, 0.68, 1),
    in: bezier(0.32, 0, 0.67, 0),
    inOut: bezier(0.65, 0, 0.35, 1),
    outQuart: bezier(0.25, 1, 0.5, 1),
    outExpo: bezier(0.16, 1, 0.3, 1),
    inExpo: bezier(0.7, 0, 0.84, 0),
    inOutQuart: bezier(0.76, 0, 0.24, 1),
    outBack: bezier(0.34, 1.56, 0.64, 1),
    inBack: bezier(0.36, 0, 0.66, -0.56),
  };

  /** Progress 0..1 of a move that starts at `start` and lasts `dur` seconds, optionally eased. */
  S.prog = function (t: number, start: number, dur: number, e?: (x: number) => number): number {
    var p = clamp((t - start) / (dur > 0 ? dur : 1e-9), 0, 1);
    return e ? e(p) : p;
  };

  function rgb(c: any): any {
    if (typeof c !== 'string') return c;
    if (c.length === 4) return [parseInt(c.charAt(1) + c.charAt(1), 16), parseInt(c.charAt(2) + c.charAt(2), 16), parseInt(c.charAt(3) + c.charAt(3), 16)];
    return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  }
  function hex(v: number): string {
    var n = Math.round(clamp(v, 0, 255)) || 0;
    return (n < 16 ? '0' : '') + n.toString(16);
  }
  function mix(a: any, b: any, k: number): string {
    var p = rgb(a);
    var q = rgb(b);
    return '#' + hex(lerp(p[0], q[0], k)) + hex(lerp(p[1], q[1], k)) + hex(lerp(p[2], q[2], k));
  }
  S.mix = mix;
  S.alpha = function (c: any, a: number): string {
    var p = rgb(c);
    return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + clamp(a, 0, 1) + ')';
  };

  /** Keyframes: S.map(t, [0, 1, 3], [10, 200, 50], S.ease.inOut). Always clamped. Numbers or '#rrggbb' colours. */
  S.map = function (x: number, ins: any, outs: any, e?: (x: number) => number): any {
    var n = ins.length;
    if (!(x > ins[0])) return outs[0];
    if (x >= ins[n - 1]) return outs[n - 1];
    var i = 1;
    while (i < n - 1 && x > ins[i]) i++;
    var span = ins[i] - ins[i - 1];
    var p = span > 0 ? (x - ins[i - 1]) / span : 1;
    if (e) p = e(p);
    return typeof outs[i] === 'string' ? mix(outs[i - 1], outs[i], p) : lerp(outs[i - 1], outs[i], p);
  };

  /** A spring from 0 to 1 as a closed-form function of the seconds since it started. */
  var SPRINGS: any = { gentle: [120, 20, 1], snappy: [300, 30, 1], bouncy: [400, 17, 1], stiff: [500, 50, 1] };
  S.spring = function (t: number, cfg?: any): number {
    if (!(t > 0)) return 0;
    var c = typeof cfg === 'string' ? SPRINGS[cfg] || SPRINGS.snappy : cfg ? [cfg.stiffness || 170, cfg.damping || 26, cfg.mass || 1] : [170, 26, 1];
    var w0 = Math.sqrt(c[0] / c[2]);
    var z = c[1] / (2 * Math.sqrt(c[0] * c[2]));
    if (z < 1) {
      var wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
    }
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t); // critically damped (also used when over-damped)
  };

  /** A stable pseudo-random number in [0, 1) for a seed: the same in every frame. */
  S.rand = function (seed: number): number {
    var x = Math.sin((seed + 1) * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };

  // The page's own type: lesson text is set in the book face, labels in the interface face.
  var FONTS: any = {
    sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif',
    serif: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, "Iowan Old Style", "Palatino Linotype", Georgia, serif',
    mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  };

  function paint(o: any, lineOnly: boolean): void {
    if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha, 0, 1);
    if (o.fill && !lineOnly) {
      ctx.fillStyle = o.fill;
      ctx.fill();
    }
    if (o.stroke || lineOnly) {
      ctx.strokeStyle = o.stroke || S.theme.fg;
      ctx.lineWidth = o.lw || 2;
      ctx.lineCap = o.cap || 'round';
      ctx.lineJoin = 'round';
      if (o.dash) ctx.setLineDash(o.dash);
      ctx.stroke();
    }
  }

  S.clear = function (c?: string): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = c || S.theme.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  };
  S.rect = function (x: number, y: number, w: number, h: number, o?: any): void {
    o = o || {};
    ctx.save();
    ctx.beginPath();
    if (o.r && ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(o.r, Math.abs(w) / 2, Math.abs(h) / 2));
    else ctx.rect(x, y, w, h);
    paint(o, false);
    ctx.restore();
  };
  S.circle = function (x: number, y: number, r: number, o?: any): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0, r), 0, 6.283185307179586);
    paint(o || {}, false);
    ctx.restore();
  };
  /** A polyline. o.draw (0..1) draws only the first part of its length: the "draw-on" effect. */
  S.poly = function (pts: any, o?: any): void {
    o = o || {};
    var n = pts.length;
    var d = o.draw == null ? 1 : clamp(o.draw, 0, 1);
    var i: number;
    if (n < 2 || !(d > 0)) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (d >= 1) {
      for (i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    } else {
      var total = 0;
      var seg: any = [];
      for (i = 1; i < n; i++) {
        var L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        seg.push(L);
        total += L;
      }
      var want = total * d;
      for (i = 1; i < n && want > 0; i++) {
        var k = Math.min(1, want / (seg[i - 1] || 1e-9));
        ctx.lineTo(lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k));
        want -= seg[i - 1];
      }
    }
    if (o.close && d >= 1) ctx.closePath();
    paint(o, !o.fill);
    ctx.restore();
  };
  S.line = function (x1: number, y1: number, x2: number, y2: number, o?: any): void {
    S.poly(
      [
        [x1, y1],
        [x2, y2],
      ],
      o,
    );
  };
  S.arrow = function (x1: number, y1: number, x2: number, y2: number, o?: any): void {
    o = o || {};
    var d = o.draw == null ? 1 : clamp(o.draw, 0, 1);
    if (!(d > 0)) return;
    var ex = lerp(x1, x2, d);
    var ey = lerp(y1, y2, d);
    var a = Math.atan2(y2 - y1, x2 - x1);
    var h = o.head || 12;
    // The shaft ends where the head is: `draw` has been applied already, so it is not passed on.
    S.line(x1, y1, ex, ey, { stroke: o.stroke, lw: o.lw, alpha: o.alpha, dash: o.dash, cap: o.cap });
    S.poly(
      [
        [ex - h * Math.cos(a - 0.45), ey - h * Math.sin(a - 0.45)],
        [ex, ey],
        [ex - h * Math.cos(a + 0.45), ey - h * Math.sin(a + 0.45)],
      ],
      { stroke: o.stroke, lw: o.lw, alpha: o.alpha },
    );
  };

  function setFont(o: any): void {
    ctx.font = (o.italic ? 'italic ' : '') + (o.weight || 500) + ' ' + (o.size || 24) + 'px ' + (FONTS[o.font || 'sans'] || FONTS.sans);
  }
  function wrap(str: any, maxW: number): string[] {
    var out: string[] = [];
    String(str)
      .split('\n')
      .forEach(function (para: string) {
        if (!maxW) {
          out.push(para);
          return;
        }
        var line = '';
        para.split(' ').forEach(function (word: string) {
          var tryLine = line ? line + ' ' + word : word;
          if (line && ctx.measureText(tryLine).width > maxW) {
            out.push(line);
            line = word;
          } else line = tryLine;
        });
        out.push(line);
      });
    return out;
  }
  /** Width and height of text as S.text would draw it. */
  S.measure = function (str: any, o?: any): any {
    o = o || {};
    ctx.save();
    setFont(o);
    var lines = wrap(str, o.maxWidth);
    var w = 0;
    lines.forEach(function (l: string) {
      w = Math.max(w, ctx.measureText(l).width);
    });
    ctx.restore();
    var lh = (o.size || 24) * (o.lineHeight || 1.25);
    return { width: w, height: lines.length * lh, lines: lines, lineHeight: lh };
  };
  /** Text in the page's fonts, wrapped at o.maxWidth. Returns what S.measure returns. */
  S.text = function (str: any, x: number, y: number, o?: any): any {
    o = o || {};
    ctx.save();
    setFont(o);
    if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha, 0, 1);
    ctx.fillStyle = o.fill || S.theme.fg;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    var lines = wrap(str, o.maxWidth);
    var lh = (o.size || 24) * (o.lineHeight || 1.25);
    var w = 0;
    lines.forEach(function (l: string, i: number) {
      ctx.fillText(l, x, y + i * lh);
      w = Math.max(w, ctx.measureText(l).width);
    });
    ctx.restore();
    return { width: w, height: lines.length * lh, lines: lines, lineHeight: lh };
  };
  /** Draw fn() moved, scaled, turned or faded as one unit. */
  S.group = function (o: any, fn: () => void): void {
    o = o || {};
    ctx.save();
    if (o.x || o.y) ctx.translate(o.x || 0, o.y || 0);
    if (o.rotate) ctx.rotate(o.rotate);
    if (o.scale != null) ctx.scale(o.scale, o.scale);
    if (o.alpha != null) ctx.globalAlpha *= clamp(o.alpha, 0, 1);
    try {
      fn();
    } finally {
      ctx.restore();
    }
  };

  // Placeholders, so set-up code that reads S.W or S.theme does not throw. Real values arrive with each frame.
  S.W = 960;
  S.H = 540;
  S.tall = false;
  S.t = 0;
  S.dur = 0;
  S.params = {};
  S.theme = {};
  S.ctx = null;

  return {
    S: S,
    bind: function (c: any, x: any): void {
      canvas = c;
      ctx = x;
      S.ctx = x;
    },
  };
}

/**
 * The worker's main function. Self-contained (see the top of this file). It is called once, as the
 * worker's only statement, with the global scope as `this`:
 *
 *     (frameWorker).call(this, frameHelpers, true, function (S) { ...the agent's code... });
 *
 * `hook`, when given, is called with S and the worker's postMessage after the lockdown and before
 * the agent's code. Only tests pass one (to let a probe report what it found).
 *
 * The global scope comes from `this` and the Object constructor from a literal, not from the names
 * `self` and `Object`, so that nothing the agent's code could declare by breaking out of its
 * wrapper (a hoisted `function Object() {}`) is ever called before the lockdown has finished.
 */
export function frameWorker(this: any, makeHelpers: () => any, hardened: boolean, factory: (S: any) => any, hook?: (S: any, post: any) => void): void {
  var G: any = this;
  var O: any = {}.constructor;
  var post: any = G.postMessage.bind(G);
  var listen: any = G.addEventListener.bind(G);
  var OC: any = G.OffscreenCanvas;
  var getContext: any = OC && OC.prototype && OC.prototype.getContext;
  var toBitmap: any = OC && OC.prototype && OC.prototype.transferToImageBitmap;

  function say(o: any, transfer?: any[]): void {
    try {
      post(o, transfer || []);
    } catch (e) {
      /* a message that cannot be sent is a missed deadline for the host */
    }
  }
  function describe(e: any): string {
    var text: string;
    try {
      text = String(e && e.message ? e.name + ': ' + e.message : e);
    } catch (e2) {
      text = 'error';
    }
    return text.slice(0, 300);
  }

  // ---- 1. lockdown: delete every global that is not on this list -----------------------------
  var KEEP = (
    'Object Function Array Number parseFloat parseInt Infinity NaN undefined Boolean String Symbol Date Promise RegExp ' +
    'Error AggregateError EvalError RangeError ReferenceError SyntaxError TypeError URIError globalThis JSON Math Intl ' +
    'ArrayBuffer Uint8Array Int8Array Uint16Array Int16Array Uint32Array Int32Array Float16Array Float32Array Float64Array ' +
    'Uint8ClampedArray BigUint64Array BigInt64Array DataView Map BigInt Set WeakMap WeakSet WeakRef Proxy Reflect ' +
    'decodeURI decodeURIComponent encodeURI encodeURIComponent isFinite isNaN Iterator ' +
    'OffscreenCanvas OffscreenCanvasRenderingContext2D Path2D ImageData ImageBitmap DOMMatrix DOMMatrixReadOnly DOMPoint ' +
    'DOMPointReadOnly TextMetrics CanvasGradient CanvasPattern'
  ).split(' ');
  var left: string[] = [];
  // Bytes this worker may still allocate in buffers, typed arrays, ImageData and extra canvases.
  // It is never refunded (garbage collection cannot be seen from here). When it runs low between
  // frames the host swaps in a fresh worker, which nobody can see, because a frame depends on
  // nothing but t.
  var BUDGET = 256 * 1048576;
  var LOW = 64 * 1048576;
  var MAX_SIDE = 4096;
  var budget = BUDGET;
  var setSize: any = {};
  var canvas: any = null;
  var ctx: any = null;

  function charge(bytes: any): void {
    bytes = +bytes;
    if (!(bytes >= 0) || bytes > budget) {
      throw new RangeError('A frame may allocate ' + (BUDGET >> 20) + ' MB of buffers and canvases in total. Create big buffers once, outside render.');
    }
    budget -= bytes;
  }

  function lockdown(): void {
    var keep = O.create(null);
    KEEP.forEach(function (k: string) {
      keep[k] = 1;
    });
    var chain: any[] = [];
    for (var o = G; o && o !== O.prototype; o = O.getPrototypeOf(o)) chain.push(o);
    chain.forEach(function (o: any, depth: number) {
      O.getOwnPropertyNames(o).forEach(function (name: string) {
        if (name === 'constructor' || (depth === 0 && keep[name])) return;
        try {
          if (!delete o[name]) throw 0;
        } catch (e) {
          try {
            O.defineProperty(o, name, { value: undefined, writable: false, configurable: false });
          } catch (e2) {
            left.push(name);
          }
        }
        try {
          if (name in o && o[name] !== undefined && left.indexOf(name) < 0) left.push(name);
        } catch (e3) {
          if (left.indexOf(name) < 0) left.push(name);
        }
      });
    });

    if (!getContext || !toBitmap) return; // not a browser that can draw a frame; said below, after the lockdown

    // Only a 2D context: no WebGL or WebGPU (a hostile shader can stall the GPU process the whole browser shares).
    OC.prototype.getContext = function (kind: any, opts: any): any {
      return kind === '2d' ? getContext.call(this, '2d', opts) : null;
    };

    // A memory budget for the fastest ways to eat RAM: buffers, typed arrays, ImageData and canvases.
    function guard(name: string, cost: (a: any[], T: any) => number): void {
      var C = G[name];
      if (typeof C !== 'function') return;
      var P: any = new Proxy(C, {
        construct: function (T: any, a: any[], NT: any): any {
          charge(cost(a, T));
          return Reflect.construct(T, a, NT === P ? T : NT);
        },
      });
      try {
        O.defineProperty(C.prototype, 'constructor', { value: P, writable: false, configurable: false });
      } catch (e) {
        /* the prototype keeps pointing at the unmetered constructor; the watchdog still applies */
      }
      G[name] = P;
    }
    var AB = G.ArrayBuffer;
    var elems = function (a: any[], T: any): number {
      var x = a[0];
      return (typeof x === 'number' ? x : x && typeof x === 'object' && !(x instanceof AB) ? x.length || 0 : 0) * (T.BYTES_PER_ELEMENT || 1);
    };
    guard('ArrayBuffer', function (a: any[]): number {
      return a[0];
    });
    'Uint8Array Int8Array Uint16Array Int16Array Uint32Array Int32Array Float16Array Float32Array Float64Array Uint8ClampedArray BigUint64Array BigInt64Array'
      .split(' ')
      .forEach(function (n: string) {
        guard(n, elems);
      });
    guard('ImageData', function (a: any[]): number {
      return typeof a[0] === 'number' ? a[0] * a[1] * 4 : 0;
    });
    var side = function (w: number, h: number): number {
      if (!(w <= MAX_SIDE && h <= MAX_SIDE)) throw new RangeError('A canvas can be at most ' + MAX_SIDE + ' pixels a side.');
      return w * h * 4;
    };
    guard('OffscreenCanvas', function (a: any[]): number {
      return side(+a[0], +a[1]);
    });
    ['width', 'height'].forEach(function (k: string) {
      var d = O.getOwnPropertyDescriptor(OC.prototype, k);
      if (!d || !d.set) return;
      O.defineProperty(OC.prototype, k, {
        get: d.get,
        set: function (this: any, v: any): void {
          // The stage's own canvas is sized by the runtime only (see sizeTo): code that sets it is refused.
          if (this === canvas) throw new RangeError('The stage canvas is sized by the player. Draw within S.W by S.H.');
          charge(side(k === 'width' ? +v : this.width, k === 'height' ? +v : this.height));
          d.set.call(this, v);
        },
        configurable: false,
      });
      setSize[k] = d.set;
    });
    var C2 = G.OffscreenCanvasRenderingContext2D && G.OffscreenCanvasRenderingContext2D.prototype;
    if (C2) {
      ['createImageData', 'getImageData'].forEach(function (k: string) {
        var f = C2[k];
        if (typeof f !== 'function') return;
        C2[k] = function (this: any): any {
          var a = arguments;
          var w = k === 'getImageData' ? a[2] : typeof a[0] === 'number' ? a[0] : a[0].width;
          var h = k === 'getImageData' ? a[3] : typeof a[0] === 'number' ? a[1] : a[0].height;
          charge(Math.abs(w * h * 4));
          return f.apply(this, a);
        };
      });
    }
    // Strings are the other quick way to fill memory: cap the three methods that make long ones in one call.
    ['repeat', 'padStart', 'padEnd'].forEach(function (k: string) {
      var P: any = ''.constructor.prototype;
      var f = P[k];
      P[k] = function (this: any, n: any): any {
        if (k === 'repeat' ? this.length * n > 1e6 : n > 1e6) throw new RangeError('That string would be too long.');
        return f.apply(this, arguments);
      };
    });
  }

  // ---- 2. the frame loop: the host asks for time t, the answer is one bitmap ------------------
  var render: any = null;
  var seed = 1;
  var budgetAtReady = 0;
  // Math.random is an input like everything else: reseeded before each frame, so a frame depends only on t.
  function seededRandom(): number {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    var x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }
  function sizeTo(w: number, h: number): void {
    if (setSize.width) {
      setSize.width.call(canvas, w);
      setSize.height.call(canvas, h);
    } else {
      canvas.width = w;
      canvas.height = h;
    }
  }

  var lib: any = null;
  var S: any = null;

  function onFrame(m: any): void {
    var pw = Math.max(1, Math.min(MAX_SIDE, Math.round(m.w * m.scale)));
    var ph = Math.max(1, Math.min(MAX_SIDE, Math.round(m.h * m.scale)));
    // Ask for a fresh worker rather than fail in the middle of a clip.
    if (budget < LOW && budget < budgetAtReady) {
      say({ type: 'recycle', id: m.id });
      return;
    }
    if (!canvas) {
      canvas = new OC(pw, ph);
      ctx = getContext.call(canvas, '2d');
      lib.bind(canvas, ctx);
    }
    if (canvas.width !== pw || canvas.height !== ph) sizeTo(pw, ph);
    else if (ctx.reset) ctx.reset();
    else sizeTo(pw, ph);
    S.W = m.w;
    S.H = m.h;
    S.tall = m.h > m.w;
    S.t = m.t;
    S.dur = m.dur;
    S.theme = m.theme || {};
    S.params = m.params || {};
    seed = 1;
    ctx.setTransform(m.scale, 0, 0, m.scale, 0, 0);
    try {
      render(ctx, m.t);
    } catch (e) {
      say({ type: 'error', id: m.id, message: describe(e) });
      return;
    }
    var bmp: any;
    try {
      bmp = toBitmap.call(canvas);
    } catch (e) {
      say({ type: 'error', id: m.id, message: describe(e) });
      return;
    }
    say({ type: 'frame', id: m.id, bitmap: bmp }, [bmp]);
  }

  // The lockdown comes first, before anything else that could fail or that reads a global by name.
  if (hardened) {
    lockdown();
    Math.random = seededRandom;
  }
  if (!getContext || !toBitmap) {
    say({ type: 'error', phase: 'load', message: 'no-offscreen-canvas' });
    return;
  }
  lib = makeHelpers();
  S = lib.S;
  if (hook) hook(S, post);
  try {
    render = factory(S);
  } catch (e) {
    say({ type: 'error', phase: 'load', message: describe(e) });
    return;
  }
  if (typeof render !== 'function') {
    say({ type: 'error', phase: 'load', message: 'no-render-function' });
    return;
  }
  listen('message', function (ev: any) {
    var m = ev.data;
    if (m && m.type === 'frame') onFrame(m);
  });
  budgetAtReady = budget;
  say({ type: 'ready', left: left });
}

export interface WorkerSourceOptions {
  /** false leaves the lockdown out. For tests that measure what the platform alone stops; the player never passes it. */
  hardened?: boolean;
  /** Source of a function (S, post) run after the lockdown and before the agent's code. For tests only. */
  hook?: string;
}

/**
 * The complete text of the worker for one frame: the runtime, then the agent's code as the body of
 * a function of S. The code is placed as text because nothing else can make it run: the policy the
 * worker inherits forbids eval, Function and imports.
 */
export function workerSource(code: string, opts: WorkerSourceOptions = {}): string {
  const hardened = opts.hardened === false ? 'false' : 'true';
  return (
    `"use strict";(${frameWorker.toString()}).call(this,${frameHelpers.toString()},${hardened},` +
    `function(S){${FRAME_BODY_PREFIX}${code}${FRAME_BODY_SUFFIX}}${opts.hook ? `,${opts.hook}` : ''});`
  );
}

/** The data: URL a worker for this frame is started from. */
export function workerUrl(code: string, opts: WorkerSourceOptions = {}): string {
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(workerSource(code, opts))}`;
}
