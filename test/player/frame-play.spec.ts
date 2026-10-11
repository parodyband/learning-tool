// The frame under the product's real policy: it starts when it is seen, shows the poster still,
// plays, scrubs to any instant in any order, restarts, obeys its slider, and makes no request at
// all. Both engines (the projects), from file:// and from http://127.0.0.1.
import { test } from '@playwright/test';
import { FRAME_LIMITS } from '../../src/core/frame';
import { checkFrameCode } from '../../src/frame/check';
import { CLOCK, HARMLESS_LEFT, frameOf, KINETIC, PROJECTILE, SORT, VIAS, buildPage, expect, info, ink, open, pixel, seek, settled, violations } from './frame-kit';

for (const via of VIAS) {
  test.describe(`a frame, opened from ${via}`, () => {
    test('runs under the policy with worker-src data: and nothing else new', async ({ page }, testInfo) => {
      const built = await buildPage([CLOCK]);
      expect(built.csp).toMatch(/^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'; style-src 'sha256-[A-Za-z0-9+/=]+'; img-src data:; media-src blob:; base-uri 'none'; form-action 'none'; worker-src data:$/);
      const o = await open(page, testInfo, built, via);
      await settled(page, 'clock');
      const i = await info(page, 'clock');
      expect(i.state).toBe('live');
      expect(i.frames).toBeGreaterThan(0);
      expect(i.left.filter((name) => !HARMLESS_LEFT.includes(name)), 'globals the lockdown could not remove').toEqual([]);
      expect(o.requests.map((r) => r.split('#')[0])).toEqual([o.url]);
      if (via === 'http') expect(o.serverHits).toHaveLength(1);
      expect(await violations(page), 'policy violations on the page').toEqual([]);
      expect(o.pageErrors).toEqual([]);
      await o.close();
    });

    test('shows the poster still first, then plays from the start', async ({ page }, testInfo) => {
      const o = await open(page, testInfo, await buildPage([CLOCK]), via);
      await settled(page, 'clock');
      // The poster is t = 2 of 4: mid grey.
      const poster = await pixel(page, 'clock');
      expect(poster[0]).toBeGreaterThan(110);
      expect(poster[0]).toBeLessThan(145);
      expect((await info(page, 'clock')).t).toBe(2);

      await page.locator('[data-act="play"]').click();
      await page.waitForFunction(() => window.__ltf!.get('clock').t > 0.25 && window.__ltf!.get('clock').t < 1.2);
      await page.evaluate(() => window.__ltf!.get('clock').pause());
      await settled(page, 'clock');
      const early = await pixel(page, 'clock');
      const t = (await info(page, 'clock')).t;
      // The picture is the instant the clock says: grey = 255 * t / 4.
      expect(Math.abs(early[0] - (255 * t) / 4)).toBeLessThan(12);
      expect(early[0]).toBeLessThan(poster[0]);
      await o.close();
    });

    test('plays to the end at the speed of the clock, drawing as it goes', async ({ page }, testInfo) => {
      const o = await open(page, testInfo, await buildPage([CLOCK]), via);
      await settled(page, 'clock');
      const before = (await info(page, 'clock')).frames;
      const started = Date.now();
      await page.locator('[data-act="play"]').click();
      await page.waitForFunction(() => window.__ltf!.get('clock').t >= 4, null, { timeout: 15_000 });
      const took = Date.now() - started;
      await settled(page, 'clock');
      const i = await info(page, 'clock');
      expect(took).toBeGreaterThan(3500);
      expect(took).toBeLessThan(9000);
      // Four seconds of animation: far more than a handful of pictures, whatever the machine is doing.
      expect(i.frames - before).toBeGreaterThan(40);
      expect((await pixel(page, 'clock'))[0]).toBeGreaterThan(245);
      expect(i.state).toBe('live');
      await o.close();
    });

    test('scrubs to any instant, in any order, and restarts', async ({ page }, testInfo) => {
      const o = await open(page, testInfo, await buildPage([CLOCK]), via);
      await settled(page, 'clock');
      for (const t of [3, 0.5, 4, 0, 1.5, 3]) {
        await seek(page, 'clock', t);
        const p = await pixel(page, 'clock');
        expect(Math.abs(p[0] - (255 * t) / 4), `t=${t}`).toBeLessThan(6);
        expect(p[0]).toBe(p[1]);
      }
      // Restart from the end: the clock goes back to 0 and runs.
      await seek(page, 'clock', 4);
      await page.locator('[data-act="start-again"]').click();
      await page.waitForFunction(() => {
        const d = window.__ltf!.get('clock');
        return d.playing && d.t > 0.1 && d.t < 1.5;
      });
      await page.evaluate(() => window.__ltf!.get('clock').pause());
      await settled(page, 'clock');
      expect((await pixel(page, 'clock'))[0]).toBeLessThan(110);
      await o.close();
    });

    test('redraws the instant on show when the slider moves, without touching the clock', async ({ page }, testInfo) => {
      const o = await open(page, testInfo, await buildPage([CLOCK]), via);
      await seek(page, 'clock', 1);
      expect((await pixel(page, 'clock', 0.5, 0.1))[0]).toBeLessThan(10);
      const slider = page.locator('[data-param="level"]');
      await slider.focus();
      for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
      await settled(page, 'clock');
      const top = await pixel(page, 'clock', 0.5, 0.1);
      expect(Math.abs(top[0] - 127)).toBeLessThan(8);
      expect(top[1]).toBeLessThan(8);
      // The time did not move: the bottom of the picture is still the grey of t = 1.
      expect(Math.abs((await pixel(page, 'clock'))[0] - 64)).toBeLessThan(6);
      expect((await info(page, 'clock')).t).toBe(1);
      await expect(page.locator('.lt-frame-param-value')).toHaveText('50%');
      await expect(slider).toHaveAttribute('aria-valuetext', '50%');
      await o.close();
    });
  });
}

for (const via of VIAS) {
  test(`a frame at the size limit, with text from several scripts, runs from ${via}`, async ({ page }, testInfo) => {
    // 24 KB of code is a data: URL of several times that once it is escaped. Both engines take it.
    const head = "function render(ctx, t) { S.clear(S.theme.accent); S.text('\u00e9t\u00e9 \u4e16\u754c \u0633\u0644\u0627\u0645 \u{1F600}', 20, 60, { size: 40, fill: S.theme.accentInk }); }\n";
    const line = `// ${'\u00e9'.repeat(150)}\n`;
    let code = head;
    while (Buffer.byteLength(code + line) <= FRAME_LIMITS.codeBytes) code += line;
    expect(Buffer.byteLength(code)).toBeGreaterThan(FRAME_LIMITS.codeBytes - 400);
    expect(checkFrameCode(code)).toEqual([]);
    const o = await open(page, testInfo, await buildPage([frameOf('big', code)]), via);
    await settled(page, 'big');
    const i = await info(page, 'big');
    expect(i.state, i.lastError).toBe('live');
    expect(await ink(page, 'big')).toBeGreaterThan(0.005);
    expect(o.pageErrors).toEqual([]);
    await o.close();
  });
}

test('the three sample animations draw, at every beat, without an error', async ({ page }, testInfo) => {
  const o = await open(page, testInfo, await buildPage([SORT, PROJECTILE, KINETIC]), 'file');
  for (const example of [SORT, PROJECTILE, KINETIC]) {
    await settled(page, example.id);
    for (const t of [...example.beats.map((b) => b.at), example.stage.poster, example.stage.duration]) {
      await seek(page, example.id, t);
      const i = await info(page, example.id);
      expect(i.state, `${example.id} at ${t}: ${i.lastError}`).toBe('live');
      expect(i.canvasShown).toBe(true);
    }
    // Something was drawn over the background: more than a stray line, less than a flood.
    await seek(page, example.id, example.stage.poster);
    const share = await ink(page, example.id);
    expect(share, example.id).toBeGreaterThan(0.01);
    expect(share, example.id).toBeLessThan(0.7);
  }
  expect(o.pageErrors).toEqual([]);
  await o.close();
});
