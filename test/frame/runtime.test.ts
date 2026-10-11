// The worker runtime, run from its shipped text in a fresh realm (see realm.ts). These tests hold
// the properties that do not need a browser: both runtime functions are self-contained, the
// lockdown leaves nothing behind, the protocol is one message in and one message out, a frame
// depends on nothing but t, and the allocation budget stops the fast ways to eat memory.
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { frameHelpers, frameWorker, workerSource, workerUrl } from '../../src/player/frame/runtime';
import { FRAME_BODY_PREFIX, FRAME_BODY_SUFFIX, MAX_SIDE, bitmapSize } from '../../src/player/frame/shared';
import { TEST_THEME, startWorker } from './realm';

const GOOD = 'function render(ctx, t) { S.clear(); S.rect(10, 10, 100 * t, 20, { fill: S.theme.accent }); }';

describe('the runtime as text', () => {
  it('is the two functions and the wrapped code, and nothing else', () => {
    const text = workerSource(GOOD);
    expect(text.startsWith('"use strict";(function frameWorker(')).toBe(true);
    expect(text).toContain(`function(S){${FRAME_BODY_PREFIX}${GOOD}${FRAME_BODY_SUFFIX}}`);
    expect(text.endsWith(');')).toBe(true);
    expect(workerUrl(GOOD)).toBe(`data:text/javascript;charset=utf-8,${encodeURIComponent(text)}`);
  });

  it('passes the hardened flag as a literal and only adds a hook when a test asks for one', () => {
    expect(workerSource(GOOD)).toContain(',true,function(S){');
    expect(workerSource(GOOD, { hardened: false })).toContain(',false,function(S){');
    expect(workerSource(GOOD, { hook: 'function(S,post){}' }).endsWith('},function(S,post){});')).toBe(true);
    expect(workerSource(GOOD).endsWith(`${FRAME_BODY_SUFFIX}});`)).toBe(true);
  });

  it('frameHelpers reaches nothing outside itself: it runs from its text in an empty realm', () => {
    const lib = vm.runInNewContext(`(${frameHelpers.toString()})()`) as ReturnType<typeof frameHelpers>;
    expect(typeof lib.S.text).toBe('function');
    expect(typeof lib.bind).toBe('function');
  });

  it('frameWorker reaches nothing outside itself: a realm with only worker globals boots it', () => {
    const w = startWorker(GOOD);
    expect(w.sent).toEqual([{ type: 'ready', left: [] }]);
    // Run directly, the function would need its module: it must never be called in the page.
    expect(frameWorker.toString()).not.toMatch(/__vi|__vite|import_/);
    expect(frameHelpers.toString()).not.toMatch(/__vi|__vite|import_/);
  });
});

describe('lockdown', () => {
  it('removes everything a frame must not have', () => {
    const w = startWorker(GOOD);
    const gone = ['fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'importScripts', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask', 'navigator', 'caches', 'indexedDB', 'performance', 'console', 'self', 'close', 'postMessage', 'addEventListener'];
    for (const name of gone) expect(w.evaluate(`typeof ${name}`), name).toBe('undefined');
  });

  it('keeps the language and the 2D canvas', () => {
    const w = startWorker(GOOD);
    for (const name of ['Object', 'Array', 'Math', 'JSON', 'Map', 'Set', 'Float32Array', 'OffscreenCanvas', 'Promise']) expect(w.evaluate(`typeof ${name}`), name).not.toBe('undefined');
  });

  it('leaves the worker as it was when a test turns it off', () => {
    const w = startWorker(GOOD, { hardened: false });
    expect(w.evaluate('typeof fetch')).toBe('function');
    expect(w.evaluate('typeof postMessage')).toBe('function');
    expect(w.sent[0]).toMatchObject({ type: 'ready' });
  });

  it('gives only a 2D context', () => {
    const w = startWorker('const c = new OffscreenCanvas(8, 8); const kinds = [c.getContext("webgl"), c.getContext("webgl2"), c.getContext("webgpu"), c.getContext("bitmaprenderer")];\nfunction render(ctx, t) { if (kinds.some((k) => k !== null)) throw new Error("got a context"); S.clear(); }');
    expect(w.frame(0)).toMatchObject({ type: 'frame' });
  });

  it('gives the code no this, and strict mode', () => {
    const w = startWorker('const self0 = (function () { return this; })();\nfunction render(ctx, t) { if (self0 !== undefined) throw new Error("has this"); undeclared = 1; }');
    expect(w.sent[0]).toMatchObject({ type: 'ready' });
    expect(w.frame(0)).toMatchObject({ type: 'error', message: expect.stringContaining('ReferenceError') });
  });

  it('runs the hook after the lockdown and before the code', () => {
    const w = startWorker('const seen = S.__seen;\nfunction render(ctx, t) { if (seen !== "undefined") throw new Error(seen); S.clear(); }', { hook: 'function(S,post){S.__seen=typeof fetch;post({type:"hooked"});}' });
    expect(w.sent.map((m) => m.type)).toEqual(['hooked', 'ready']);
    expect(w.frame(0)).toMatchObject({ type: 'frame' });
  });
});

describe('a wrapper break-out gains nothing', () => {
  // Code that closes the wrapper early is refused by the static check (test/frame/check.test.ts).
  // If a published file were edited by hand to carry it, the statements it adds run at the top
  // level of the worker. Function declarations there are hoisted above the runtime, so the
  // runtime must not call anything by a global name before the lockdown has finished.
  const breakout = (body: string): string => `function render(ctx, t) {}\n;return render;});\n${body}\n(function(S){`;

  it('top-level statements run after the lockdown', () => {
    const w = startWorker(breakout('globalThis.__after = typeof fetch + "," + typeof postMessage;'));
    expect(w.evaluate('__after')).toBe('undefined,undefined');
  });

  it('hoisted functions named after globals are never called while the globals are still there', () => {
    const names = ['Object', 'Array', 'String', 'Proxy', 'Reflect', 'Math', 'RangeError', 'Symbol', 'Promise', 'ArrayBuffer', 'Float64Array', 'ImageData', 'parseInt', 'isFinite', 'Function', 'Number', 'Boolean', 'JSON', 'Map'];
    const hostile = names.map((n) => `function ${n}() { __calls.push(typeof fetch); return {}; }`).join('\n');
    const prelude = 'var __calls = [];';
    let threw: unknown = null;
    let calls: string[] = [];
    try {
      const w = startWorker(breakout(hostile), { prelude });
      calls = w.evaluate('__calls') as string[];
    } catch (error) {
      // Replacing the language's own names may well break the runtime: a worker that dies is a missed deadline, not an escape.
      threw = error;
    }
    expect(threw === null || threw instanceof Error || typeof threw === 'object').toBe(true);
    for (const c of calls) expect(c).toBe('undefined');
  });

  it('a hoisted OffscreenCanvas does not stop the lockdown', () => {
    const w = startWorker(breakout('function OffscreenCanvas() {}\nglobalThis.__after = typeof fetch;'));
    expect(w.evaluate('__after')).toBe('undefined');
    expect(w.sent).toEqual([{ type: 'error', phase: 'load', message: 'no-offscreen-canvas' }]);
  });
});

describe('protocol', () => {
  it('answers one request with one bitmap of the size asked for', () => {
    const w = startWorker(GOOD);
    const m = w.frame(2, { w: 960, h: 540, scale: 1.5 });
    expect(m).toMatchObject({ type: 'frame', id: 1 });
    expect([m.bitmap.width, m.bitmap.height]).toEqual([1440, 810]);
    expect(m.bitmap.calls.find((c: unknown[]) => c[0] === 'setTransform' && c[1] === 1.5)).toBeTruthy();
    expect(w.sent).toHaveLength(2);
  });

  it('sizes the bitmap as the host expects, including the cap', () => {
    const w = startWorker(GOOD);
    for (const [uw, uh, scale] of [[960, 540, 2.1625], [540, 675, 0.5296], [960, 540, 9], [720, 540, 1], [540, 540, 3]] as const) {
      const m = w.frame(0, { w: uw, h: uh, scale });
      const want = bitmapSize(uw, uh, scale);
      expect([m.bitmap.width, m.bitmap.height]).toEqual([want.pw, want.ph]);
      expect(m.bitmap.width).toBeLessThanOrEqual(MAX_SIDE);
    }
  });

  it('gives render the stage, the time, the theme and the sliders', () => {
    const w = startWorker('let seen = null;\nfunction render(ctx, t) { S.clear(); if (ctx !== S.ctx) throw new Error("ctx"); throw new Error(JSON.stringify([S.W, S.H, S.tall, S.t, t, S.dur, S.theme.accent, S.theme.scheme, S.params.angle])); }');
    const m = w.frame(3.25, { w: 540, h: 675, dur: 12, params: { angle: 40 } });
    expect(m.type).toBe('error');
    expect(JSON.parse(m.message.replace(/^Error: /, ''))).toEqual([540, 675, true, 3.25, 3.25, 12, TEST_THEME.accent, 'light', 40]);
  });

  it('reports an error thrown in render with the request id, and stays alive', () => {
    const w = startWorker('function render(ctx, t) { if (t > 1) null.x; S.clear(); }');
    expect(w.frame(2)).toMatchObject({ type: 'error', id: 1, message: expect.stringContaining('TypeError') });
    expect(w.frame(0)).toMatchObject({ type: 'frame', id: 2 });
  });

  it('reports code with no render, and code whose set-up throws, as load errors', () => {
    expect(startWorker('const x = 1;').sent).toEqual([{ type: 'error', phase: 'load', message: 'no-render-function' }]);
    expect(startWorker('var render = 1;').sent).toEqual([{ type: 'error', phase: 'load', message: 'no-render-function' }]);
    const thrown = startWorker('null.x;\nfunction render(ctx, t) {}').sent;
    expect(thrown).toHaveLength(1);
    expect(thrown[0]).toMatchObject({ type: 'error', phase: 'load', message: expect.stringContaining('TypeError') });
  });

  it('ignores messages that are not frame requests', () => {
    const w = startWorker(GOOD);
    w.deliver(null);
    w.deliver({ type: 'eval', code: '1' });
    w.deliver('frame');
    expect(w.sent).toHaveLength(1);
  });

  it('keeps an error message short', () => {
    const w = startWorker('function render(ctx, t) { throw new Error("x".repeat(5000)); }');
    expect(w.frame(0).message.length).toBeLessThanOrEqual(300);
  });
});

describe('a frame depends on nothing but t', () => {
  it('reseeds Math.random before every frame', () => {
    const w = startWorker('function render(ctx, t) { S.clear(); S.rect(Math.random(), Math.random(), Math.random(), 1); }');
    const a = w.frame(1).bitmap.calls;
    const b = w.frame(1).bitmap.calls;
    const c = w.frame(5).bitmap.calls;
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    const rect = a.find((call: unknown[]) => call[0] === 'rect') as number[];
    expect(rect[1]).not.toBe(rect[2]);
    expect(rect[1]).toBeGreaterThanOrEqual(0);
    expect(rect[1]).toBeLessThan(1);
  });

  it('starts every frame from a clean context', () => {
    const w = startWorker('function render(ctx, t) { ctx.translate(50, 50); S.rect(0, 0, 10, 10, { fill: "#000000" }); }');
    const a = w.frame(1).bitmap.calls;
    const b = w.frame(1).bitmap.calls;
    expect(b).toEqual(a);
    expect(b[0][0] === 'reset' || b[0][0] === 'setTransform').toBe(true);
  });
});

describe('allocation budget', () => {
  it('stops a typed-array bomb inside the frame that sets it off', () => {
    const w = startWorker('const hog = [];\nfunction render(ctx, t) { S.clear(); if (t > 1) { for (let i = 0; i < 10000; i++) hog.push(new Float64Array(2e6)); } }');
    expect(w.frame(0)).toMatchObject({ type: 'frame' });
    const m = w.frame(2);
    expect(m).toMatchObject({ type: 'error', message: expect.stringContaining('RangeError') });
    expect(w.evaluate('1')).toBe(1);
  });

  it('counts typed arrays made through the prototype too', () => {
    const w = startWorker('function render(ctx, t) { const C = new Uint8Array(1).constructor; const hog = []; for (let i = 0; i < 400; i++) hog.push(new C(1048576)); }');
    expect(w.frame(0)).toMatchObject({ type: 'error', message: expect.stringContaining('RangeError') });
  });

  it('refuses a canvas larger than 4096 a side, and stops a pile of big ones', () => {
    expect(startWorker('const c = new OffscreenCanvas(5000, 10);\nfunction render(ctx, t) {}').sent[0]).toMatchObject({ type: 'error', phase: 'load', message: expect.stringContaining('4096') });
    const w = startWorker('const keep = [];\nfunction render(ctx, t) { for (let i = 0; i < 64; i++) keep.push(new OffscreenCanvas(4096, 4096)); }');
    expect(w.frame(0)).toMatchObject({ type: 'error', message: expect.stringContaining('RangeError') });
  });

  it('charges for resizing a canvas and refuses to resize the stage itself', () => {
    const grow = startWorker('const o = new OffscreenCanvas(8, 8);\nfunction render(ctx, t) { for (let i = 0; i < 64; i++) { o.width = 4096; o.height = 4096 - i; } }');
    expect(grow.frame(0)).toMatchObject({ type: 'error', message: expect.stringContaining('RangeError') });
    const stage = startWorker('function render(ctx, t) { if (t < 0.5) ctx.canvas.width = 16000; S.clear(); }');
    const m = stage.frame(0);
    expect(m).toMatchObject({ type: 'error', message: expect.stringContaining('sized by the player') });
    expect(stage.frame(1)).toMatchObject({ type: 'frame' });
    expect(stage.frame(1).bitmap.width).toBe(960);
  });

  it('caps the string methods that make a huge string in one call', () => {
    const w = startWorker('function render(ctx, t) { "x".repeat(5e8); }');
    expect(w.frame(0)).toMatchObject({ type: 'error', message: expect.stringContaining('RangeError') });
    const ok = startWorker('function render(ctx, t) { S.clear(); S.text("ab".repeat(10) + "7".padStart(3, "0"), 0, 0); }');
    expect(ok.frame(0)).toMatchObject({ type: 'frame' });
  });

  it('asks for a fresh worker when honest code has used most of it', () => {
    const w = startWorker('function render(ctx, t) { S.clear(); const scratch = new Float32Array(5e6); scratch[0] = t; }');
    const kinds: string[] = [];
    for (let i = 0; i < 14 && !kinds.includes('recycle'); i++) kinds.push(w.frame(i / 10).type);
    expect(kinds.at(-1)).toBe('recycle');
    expect(kinds.slice(0, -1).every((k) => k === 'frame')).toBe(true);
    expect(kinds.length).toBeGreaterThan(8);
  });

  it('does not ask for a fresh worker over memory the set-up took once', () => {
    const w = startWorker('const table = new Float64Array(26e6);\nfunction render(ctx, t) { S.clear(); }');
    expect(w.sent[0]).toMatchObject({ type: 'ready' });
    for (let i = 0; i < 5; i++) expect(w.frame(i).type).toBe('frame');
  });
});
