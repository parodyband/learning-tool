// Hang and abuse: code that never returns, throws, floods, lies about its bitmap or eats memory.
// Ported from the sandbox research (.scratch/v2-sandbox/tests/20-hang.mjs). Each page holds one
// hostile frame and one good one. The hostile frame is played until the host stops it; then the
// spec checks how it was stopped, that the page's own thread was never held up, that the learner
// was told and offered "Try again", and that the good frame on the same page still plays.
//
// "raw" scenarios leave the runtime's lockdown out, because what they do (posting their own
// messages, starting workers) is impossible with it: they show the host's watchdog holding by itself.
import { test } from '@playwright/test';
import { FRAME_TEXT } from '../../src/player/frame/shared';
import { SORT, type Via, buildPage, expect, frameOf, info, lag, open, pixel, settled } from './frame-kit';

// These scenarios spin processor cores on purpose. Run one after another (per engine), they leave
// the rest of the suite, which runs beside them and has timing checks of its own, undisturbed.
test.describe.configure({ mode: 'default' });

interface Scenario {
  code: string;
  raw?: boolean;
  /** The failure code(s) the host must report, or null when the frame must keep running. */
  expect: string | null;
  /** Fails while its set-up runs, before any frame. */
  atLoad?: boolean;
  /** Milliseconds from Play (or, for `atLoad`, from the page's start) within which it must be stopped. */
  within?: [number, number];
  /** Also run from http://127.0.0.1 (the load mode does not change the mechanism; three are spot-checked). */
  http?: boolean;
}

const SCENARIOS: Record<string, Scenario> = {
  loop_at_load: { code: 'while (true) {}\nfunction render(ctx, t) {}', expect: 'timeout:boot', atLoad: true, within: [2950, 6000] },
  loop_in_render: { code: 'function render(ctx, t) { S.clear(); if (t > 1) { while (true) {} } }', expect: 'timeout:frame', within: [2300, 4500], http: true },
  microtask_spin: { code: 'function render(ctx, t) { S.clear(); if (t > 1) { (function spin() { Promise.resolve().then(spin); })(); } }', expect: 'timeout:frame', within: [2300, 4500] },
  throw_in_render: { code: 'function render(ctx, t) { S.clear(); if (t > 1) { null.x; } }', expect: 'error', within: [900, 2500] },
  no_render: { code: 'const x = 1;', expect: 'error', atLoad: true, within: [0, 2500] },
  syntax_error: { code: 'function render(ctx, t) { S.clear( }', expect: 'error', atLoad: true, within: [0, 2500] },
  slow_frames_120ms: { code: 'function render(ctx, t) { S.clear(); S.text("slow", 40, 80, { size: 40 }); const end = Date.now() + 120; while (Date.now() < end) {} }', expect: null },
  memory_typed_arrays: { code: 'const hog = [];\nfunction render(ctx, t) { S.clear(); if (t > 1) { for (;;) { const a = new Float64Array(2e6); a.fill(1.5); hog.push(a); } } }', expect: 'error', within: [900, 2500], http: true },
  memory_strings: { code: 'const hog = [];\nfunction render(ctx, t) { S.clear(); if (t > 1) { for (let i = 0; i < 200; i++) hog.push("x".repeat(5e8) + i); } }', expect: 'error', within: [900, 2500] },
  memory_canvases: { code: 'const c = [];\nfunction render(ctx, t) { S.clear(); if (t > 1) { for (let i = 0; i < 64; i++) { const o = new OffscreenCanvas(4096, 4096); o.getContext("2d").fillRect(0, 0, 4096, 4096); c.push(o); } } }', expect: 'error', within: [900, 2500] },
  memory_canvas_resize: { code: 'const o = new OffscreenCanvas(8, 8);\nfunction render(ctx, t) { S.clear(); if (t > 1) { for (let i = 0; i < 64; i++) { o.width = 4096; o.height = 4096 - i; } } }', expect: 'error', within: [900, 2500] },
  stage_canvas_resize: { code: 'function render(ctx, t) { S.clear(); if (t > 1) { ctx.canvas.width = 16000; ctx.canvas.height = 16000; } }', expect: 'error', within: [900, 2500] },
  alloc_2mb_every_frame_honest: { code: 'function render(ctx, t) { S.clear(); const a = new Float32Array(5e5); a[0] = t; S.text("scratch buffer each frame " + a[0].toFixed(1), 40, 80, { size: 40 }); }', expect: null },
  alloc_40mb_every_frame_greedy: { code: 'function render(ctx, t) { S.clear(); if (t > 1) { const a = new Float32Array(1e7); a.fill(1); } }', expect: 'greedy', within: [900, 4000] },
  memory_slow_leak: { code: 'const hog = [];\nfunction render(ctx, t) { S.clear(); if (t > 1 && hog.length < 60) { const a = new Float64Array(2.5e6); a.fill(1.5); hog.push(a); } S.text(hog.length * 20 + " MB kept", 40, 80, { size: 40 }); }', expect: 'greedy', within: [900, 5000] },
  // Plain objects are not metered by the budget: the deadline is what stops this one. (Capped here, to be kind to the machine running the test.)
  memory_js_heap: { code: 'const hog = [];\nfunction render(ctx, t) { S.clear(); if (t > 1) { while (hog.length < 3e6) hog.push({ a: [1, 2, 3], s: "x" + hog.length }); for (;;) {} } }', expect: 'timeout:frame', within: [2300, 5500] },
  raw_message_flood: { raw: true, code: 'function render(ctx, t) { S.clear(); if (t > 1) { for (;;) postMessage({ junk: new ArrayBuffer(65536) }); } }', expect: 'flood', within: [900, 2500], http: true },
  raw_wrong_id_bitmaps: { raw: true, code: 'function render(ctx, t) { S.clear(); if (t > 1) { const c = new OffscreenCanvas(400, 400); c.getContext("2d"); const b = c.transferToImageBitmap(); for (let id = 100000; id < 103000; id++) postMessage({ type: "frame", id, bitmap: b }); for (;;) {} } }', expect: 'flood', within: [900, 2500] },
  raw_right_id_wrong_size: { raw: true, code: 'addEventListener("message", (e) => { if (e.data.t > 1) { const c = new OffscreenCanvas(10, 10); c.getContext("2d"); postMessage({ type: "frame", id: e.data.id, bitmap: c.transferToImageBitmap() }); } });\nfunction render(ctx, t) { S.clear(); }', expect: 'bad-frame', within: [900, 2500] },
  raw_right_id_not_a_bitmap: { raw: true, code: 'addEventListener("message", (e) => { if (e.data.t > 1) postMessage({ type: "frame", id: e.data.id, bitmap: { width: 1, height: 1 } }); });\nfunction render(ctx, t) { S.clear(); }', expect: 'bad-frame', within: [900, 2500] },
  raw_nested_spinning_workers: { raw: true, code: 'for (let i = 0; i < 2; i++) new Worker("data:text/javascript,for(;;){}");\nfunction render(ctx, t) { S.clear(); if (t > 1) { while (true) {} } }', expect: 'timeout:frame', within: [2300, 4500] },
  raw_self_close: { raw: true, code: 'function render(ctx, t) { S.clear(); if (t > 1) close(); }', expect: 'timeout:frame', within: [2300, 4500] },
};

const MESSAGE: Record<string, string> = {
  'timeout:boot': FRAME_TEXT.timeout,
  'timeout:frame': FRAME_TEXT.timeout,
  error: FRAME_TEXT.error,
  'bad-frame': FRAME_TEXT.badFrame,
  flood: FRAME_TEXT.flood,
  greedy: FRAME_TEXT.greedy,
};

// The page's own thread: the longest it may ever go without running, however badly the frame behaves.
const MAX_GAP_MS = 400;

async function run(page: import('@playwright/test').Page, testInfo: import('@playwright/test').TestInfo, name: string, sc: Scenario, via: Via): Promise<void> {
  test.setTimeout(60_000);
  const hostile = frameOf('hostile', sc.code, { raw: sc.raw === true, duration: 6, poster: 0.2 });
  const o = await open(page, testInfo, await buildPage([hostile, SORT], { title: `Abuse: ${name}` }), via);

  if (sc.atLoad) {
    // It is on screen from the start, so its set-up is already running (or already over).
    await page.evaluate(() => window.__ltf!.get('hostile').kit.root.scrollIntoView());
  } else {
    await settled(page, 'hostile');
    expect((await info(page, 'hostile')).state, 'the frame draws its poster before it misbehaves').toBe('live');
    await lag(page, true);
    await page.evaluate(() => window.__ltf!.get('hostile').play());
  }

  if (sc.expect === null) {
    // It must keep running: play for a few seconds and look.
    await page.waitForFunction(() => window.__ltf!.get('hostile').t > 3.6 || window.__ltf!.get('hostile').kit.state === 'failed', null, { timeout: 20_000 });
    const i = await info(page, 'hostile');
    expect(i.state, `${name}: ${i.failure} ${i.lastError}`).toBe('live');
    expect(i.status).toBe('');
    expect(i.frames).toBeGreaterThan(8);
    if (name.startsWith('slow')) expect(i.quality, 'slow frames are drawn with fewer pixels').toBeLessThan(1);
    if (name.startsWith('alloc')) expect(i.recycles, 'a fresh worker was swapped in, unseen').toBeGreaterThan(0);
  } else {
    await page.waitForFunction(() => window.__ltf!.get('hostile').kit.state === 'failed', null, { timeout: 20_000 });
    const i = await info(page, 'hostile');
    const failure = i.failures.at(-1);
    expect(sc.expect.split('|'), `${name}: ${i.lastError}`).toContain(i.failure);
    if (sc.within && failure) {
      const ms = sc.atLoad ? failure.atMs : failure.afterPlayMs;
      expect(ms, 'stopped no sooner than the deadline allows').toBeGreaterThanOrEqual(sc.within[0]);
      expect(ms, 'stopped in time').toBeLessThanOrEqual(sc.within[1]);
    }
    // The learner is told, in words, and offered a way back; the description stands in for the picture.
    expect(i.status).toBe(MESSAGE[i.failure ?? ''] ?? 'no message');
    expect(i.retryShown).toBe(true);
    expect(i.canvasShown).toBe(false);
    expect(i.altShown).toBe(true);
    await expect(page.locator('section[data-scene="hostile"] .lt-frame')).toHaveAttribute('data-state', 'failed');
    await expect(page.locator('section[data-scene="hostile"] .lt-frame-status')).toHaveAttribute('role', 'status');
  }

  // The page itself was never held up.
  const gaps = await lag(page);
  expect(gaps.timer, 'longest gap between timer ticks on the page').toBeLessThan(MAX_GAP_MS);
  expect(gaps.raf, 'longest gap between frames on the page').toBeLessThan(MAX_GAP_MS);

  // The good frame on the same page still plays.
  await settled(page, SORT.id);
  const good = await page.evaluate(async (id) => {
    const g = window.__ltf!.get(id);
    g.seek(3);
    await g.kit.settled();
    const before = g.kit.host.stats.frames;
    g.play();
    await new Promise((r) => setTimeout(r, 1000));
    g.pause();
    return { drawn: g.kit.host.stats.frames - before, state: g.kit.state };
  }, SORT.id);
  expect(good.state).toBe('live');
  expect(good.drawn, 'pictures the good frame drew in a second').toBeGreaterThan(10);

  // "Try again" starts a fresh worker. (This code will fail again when it reaches the same place; that is its business.)
  if (sc.expect !== null) {
    const spawnsBefore = (await info(page, 'hostile')).spawns;
    await page.locator('section[data-scene="hostile"] .lt-frame-retry').click();
    await page.waitForFunction((n) => window.__ltf!.get('hostile').kit.host.stats.spawns > n, spawnsBefore, { timeout: 5000 });
    expect((await info(page, 'hostile')).spawns).toBe(spawnsBefore + 1);
  }

  expect(o.crashed(), 'the page crashed').toBe(false);
  // WebKit also reports a worker's own syntax error on the page that started it. It is the frame's error, not the page's.
  const ownError = name === 'syntax_error' ? /Unexpected token/ : null;
  expect(
    o.pageErrors.filter((e) => !(ownError && ownError.test(e))),
    'uncaught exceptions on the page',
  ).toEqual([]);
  expect(o.sent(), 'requests other than the document').toEqual([]);
  await o.close();
}

for (const [name, sc] of Object.entries(SCENARIOS)) {
  test(`${name}${sc.raw ? ' (no lockdown)' : ''}: ${sc.expect ?? 'keeps running'}`, async ({ page }, testInfo) => {
    await run(page, testInfo, name, sc, 'file');
  });
  if (sc.http) {
    test(`${name}${sc.raw ? ' (no lockdown)' : ''}, from http: ${sc.expect}`, async ({ page }, testInfo) => {
      await run(page, testInfo, name, sc, 'http');
    });
  }
}

test('after an error, "Try again" brings the picture back', async ({ page }, testInfo) => {
  const hostile = frameOf('hostile', 'function render(ctx, t) { S.clear(S.theme.accent); if (t > 1) { null.x; } }');
  const o = await open(page, testInfo, await buildPage([hostile]), 'file');
  await settled(page, 'hostile');
  await page.evaluate(() => window.__ltf!.get('hostile').seek(2));
  await page.waitForFunction(() => window.__ltf!.get('hostile').kit.state === 'failed');
  await expect(page.locator('.lt-frame-status')).toHaveText(FRAME_TEXT.error);
  const retry = page.locator('.lt-frame-retry');
  await expect(retry).toBeVisible();
  await expect(retry).toHaveText('Try again');

  // Back to an instant the code can draw, then try again from the keyboard.
  await page.evaluate(() => window.__ltf!.get('hostile').seek(0.5));
  expect((await info(page, 'hostile')).state, 'a frame that is off stays off until asked').toBe('failed');
  await retry.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__ltf!.get('hostile').kit.state === 'live');
  const i = await info(page, 'hostile');
  expect(i.canvasShown).toBe(true);
  expect(i.altShown).toBe(false);
  expect(i.status).toBe('');
  expect(i.retryShown).toBe(false);
  expect(i.spawns).toBe(2);
  // The button has gone; focus did not fall back to the top of the page.
  expect(await page.evaluate(() => document.activeElement?.className)).toBe('lt-frame');
  const p = await pixel(page, 'hostile');
  expect(p[2]).toBeGreaterThan(p[0]);
  await o.close();
});

test('a frame that is off does not start a worker, and one nobody watches is ended', async ({ page }, testInfo) => {
  const far = frameOf('far', 'function render(ctx, t) { S.clear(); }');
  const built = await buildPage([SORT, far]);
  // Enough page between the two that the second is off screen.
  built.html = built.html.replace('<section class="lt-scene" data-scene="far"', '<div id="spacer"></div><section class="lt-scene" data-scene="far"');
  await page.setViewportSize({ width: 900, height: 600 });
  const o = await open(page, testInfo, built, 'file');
  await page.evaluate(() => document.getElementById('spacer')!.style.setProperty('height', '3000px'));
  await settled(page, SORT.id);
  // Not seen yet: its code has not run at all.
  expect((await info(page, 'far')).spawns).toBe(0);
  expect((await info(page, 'far')).state).toBe('idle');
  await settled(page, 'far');
  expect((await info(page, 'far')).spawns).toBe(1);

  // Four seconds after the last picture the worker is ended; the picture stays, and the next request draws again.
  const idle = await page.evaluate(() => window.__ltf!.limits.idleMs);
  await page.waitForTimeout(idle + 600);
  const before = await info(page, 'far');
  expect(before.canvasShown).toBe(true);
  await page.evaluate(() => window.__ltf!.get('far').seek(1));
  await settled(page, 'far');
  const after = await info(page, 'far');
  expect(after.spawns).toBe(before.spawns + 1);
  expect(after.frames).toBe(before.frames + 1);
  expect(after.state).toBe('live');
  await o.close();
});
