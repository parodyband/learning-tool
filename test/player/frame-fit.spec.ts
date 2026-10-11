// How the frame fits the page around it: keyboard, what assistive technology is given, theme,
// size and sharpness down to 320 px, reduced motion, print, scripting off, and axe. Ported from
// the sandbox research (.scratch/v2-sandbox/tests/31-fit.mjs), less the transport controls, which
// belong to the clip engine and are tested with it.
import AxeBuilder from '@axe-core/playwright';
import { type Browser, type Page, test } from '@playwright/test';
import { FRAME_TEXT } from '../../src/player/frame/shared';
import { CLOCK, KINETIC, PROJECTILE, SORT, VIAS, buildPage, expect, frameOf, info, ink, open, pixel, seek, settled, violations } from './frame-kit';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const tabKey = (browserName: string): string => (browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
const focusedClass = (page: Page): Promise<string> => page.evaluate(() => (document.activeElement ? document.activeElement.className || document.activeElement.tagName : ''));

async function newPage(browser: Browser, options: Parameters<Browser['newContext']>[0]): Promise<Page> {
  const context = await browser.newContext(options);
  return context.newPage();
}

for (const via of VIAS) {
  test.describe(`fit, opened from ${via}`, () => {
    test('keyboard: the canvas is not a tab stop, the slider is, and arrow keys redraw', async ({ page, browserName }, testInfo) => {
      const o = await open(page, testInfo, await buildPage([PROJECTILE]), via);
      await settled(page, PROJECTILE.id);
      await page.locator('h1').click();
      const order: string[] = [];
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press(tabKey(browserName));
        order.push(await focusedClass(page));
      }
      expect(order.slice(0, 3)).toEqual(['lt-frame-range', 'lt-btn lt-btn-small', 'lt-btn lt-btn-small']);
      expect(order).not.toContain('lt-frame-canvas');
      expect(await page.locator('canvas').getAttribute('tabindex')).toBeNull();

      const slider = page.locator('[data-param="angle"]');
      await slider.focus();
      const before = (await info(page, PROJECTILE.id)).frames;
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await settled(page, PROJECTILE.id);
      const after = await info(page, PROJECTILE.id);
      expect(after.frames).toBeGreaterThan(before);
      expect(await page.evaluate((id) => window.__ltf!.get(id).kit.host.params.angle, PROJECTILE.id)).toBe(43);
      await expect(page.locator('.lt-frame-param-value')).toHaveText('43°');
      expect(await focusedClass(page)).toBe('lt-frame-range');
      await o.close();
    });

    test('what assistive technology gets: a named image with its description, the slider, the status region, the label', async ({ page }, testInfo) => {
      const o = await open(page, testInfo, await buildPage([PROJECTILE]), via);
      await settled(page, PROJECTILE.id);
      const section = page.locator(`section[data-scene="${PROJECTILE.id}"]`);
      const snapshot = await section.ariaSnapshot();
      expect(snapshot).toMatch(/img "Launch angle and range"/);
      expect(snapshot).toMatch(/slider "Launch angle"/);
      expect(snapshot).toContain(FRAME_TEXT.label);
      // The canvas is described by the description on the page, which is still in the document while the picture shows.
      const canvas = section.locator('canvas');
      const describedBy = await canvas.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(await page.evaluate((id) => document.getElementById(id as string)?.textContent, describedBy)).toBe(PROJECTILE.description);
      await expect(section.locator('.lt-frame-status')).toHaveAttribute('role', 'status');
      await expect(section.locator('.lt-frame-status')).toBeEmpty();
      await expect(section.locator('[data-param="angle"]')).toHaveAttribute('aria-valuetext', '45°');
      await o.close();
    });

    test('theme: the page override and the system scheme both redraw the picture', async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: 'light' });
      const o = await open(page, testInfo, await buildPage([SORT]), via);
      await settled(page, SORT.id);
      const light = await pixel(page, SORT.id, 0.02, 0.02);
      expect(light[0]).toBeGreaterThan(200);
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'dark';
      });
      await expect.poll(async () => (await pixel(page, SORT.id, 0.02, 0.02))[0]).toBeLessThan(60);
      await page.evaluate(() => {
        delete document.documentElement.dataset.theme;
      });
      await expect.poll(async () => (await pixel(page, SORT.id, 0.02, 0.02))[0]).toBeGreaterThan(200);
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect.poll(async () => (await pixel(page, SORT.id, 0.02, 0.02))[0]).toBeLessThan(60);
      expect(await page.evaluate((id) => window.__ltf!.get(id).kit.state, SORT.id)).toBe('live');
      await o.close();
    });

    test('1280 to 320 and back: wide stage, tall stage, sharp at 2x, no sideways scroll', async ({ browser }, testInfo) => {
      const page = await newPage(browser, { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
      const o = await open(page, testInfo, await buildPage([SORT, PROJECTILE]), via);
      await settled(page, SORT.id);
      const wide = await info(page, SORT.id);
      expect(wide.units).toEqual({ w: 960, h: 540 });
      expect(Math.abs(wide.css[0] / wide.css[1] - 16 / 9)).toBeLessThan(0.02);
      expect(Math.abs(wide.px[0] - wide.css[0] * 2)).toBeLessThanOrEqual(2);

      await page.setViewportSize({ width: 320, height: 800 });
      await expect.poll(async () => (await info(page, SORT.id)).units).toEqual({ w: 540, h: 675 });
      await settled(page, SORT.id);
      const narrow = await info(page, SORT.id);
      expect(Math.abs(narrow.css[0] / narrow.css[1] - 4 / 5)).toBeLessThan(0.02);
      expect(Math.abs(narrow.px[0] - narrow.css[0] * 2)).toBeLessThanOrEqual(2);
      expect(narrow.css[0]).toBeGreaterThan(250);
      expect(narrow.spawns, 'a new shape gets a new worker').toBeGreaterThan(wide.spawns);
      expect(narrow.state).toBe('live');
      expect(await ink(page, SORT.id)).toBeGreaterThan(0.01);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      // Everything a pointer is asked to hit is at least 24 px (WCAG 2.5.8).
      await settled(page, PROJECTILE.id);
      const smallest = await page.evaluate(() =>
        Math.min(
          ...Array.from(document.querySelectorAll<HTMLElement>('.lt-frame input, .lt-frame button'))
            .filter((el) => el.offsetParent !== null)
            .map((el) => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height)),
        ),
      );
      expect(smallest).toBeGreaterThanOrEqual(24);
      await page.locator(`section[data-scene="${SORT.id}"] .lt-frame`).screenshot({ path: testInfo.outputPath('frame-320.png') });

      await page.setViewportSize({ width: 1280, height: 900 });
      await expect.poll(async () => (await info(page, SORT.id)).units).toEqual({ w: 960, h: 540 });
      await settled(page, SORT.id);
      expect((await info(page, SORT.id)).state).toBe('live');
      expect(o.pageErrors).toEqual([]);
      await o.close();
      await page.context().close();
    });

    test('print: the picture as it stood, then the description; no controls', async ({ page }, testInfo) => {
      const built = await buildPage([SORT, PROJECTILE, frameOf('unseen', 'function render(ctx, t) { S.clear(); }')]);
      built.html = built.html.replace('<section class="lt-scene" data-scene="unseen"', '<div id="spacer"></div><section class="lt-scene" data-scene="unseen"');
      await page.setViewportSize({ width: 1000, height: 700 });
      const o = await open(page, testInfo, built, via);
      await page.evaluate(() => document.getElementById('spacer')!.style.setProperty('height', '4000px'));
      await seek(page, SORT.id, 6.3);
      await settled(page, PROJECTILE.id);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.emulateMedia({ media: 'print' });
      const read = (id: string) =>
        page.evaluate((id) => {
          const root = window.__ltf!.get(id).kit.root;
          const shown = (sel: string): boolean => {
            const el = root.querySelector(sel) ?? root.parentElement?.querySelector(sel) ?? null;
            return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
          };
          const canvas = root.querySelector('canvas');
          const alt = root.querySelector('.lt-frame-alt');
          return {
            canvas: shown('canvas'),
            alt: shown('.lt-frame-alt'),
            altText: alt?.textContent ?? '',
            altBelowCanvas: !!canvas && !!alt && alt.getBoundingClientRect().top >= canvas.getBoundingClientRect().bottom - 1,
            label: shown('.lt-frame-label'),
            params: shown('.lt-frame-params'),
            retry: shown('.lt-frame-retry'),
            controls: shown('.h-controls'),
          };
        }, id);
      const sort = await read(SORT.id);
      expect(sort).toEqual({ canvas: true, alt: true, altText: SORT.description, altBelowCanvas: true, label: true, params: false, retry: false, controls: false });
      expect((await read(PROJECTILE.id)).params).toBe(false);
      // A frame that was never on screen has no picture: its description prints in its place.
      const unseen = await read('unseen');
      expect(unseen.canvas).toBe(false);
      expect(unseen.alt).toBe(true);
      expect(unseen.label).toBe(true);
      await page.locator(`section[data-scene="${SORT.id}"]`).screenshot({ path: testInfo.outputPath('print.png') });
      await page.emulateMedia({ media: 'screen' });
      await o.close();
    });

    test('scripting off: the description in the picture\'s place, the label, and no dead controls', async ({ browser }, testInfo) => {
      const page = await newPage(browser, { viewport: { width: 1280, height: 900 }, javaScriptEnabled: false });
      const o = await open(page, testInfo, await buildPage([PROJECTILE]), via, { wait: false });
      const frame = page.locator('.lt-frame');
      await expect(frame).toHaveAttribute('data-state', 'static');
      await expect(frame.locator('.lt-frame-alt')).toBeVisible();
      await expect(frame.locator('.lt-frame-alt')).toHaveText(PROJECTILE.description);
      await expect(frame.locator('.lt-frame-label')).toBeVisible();
      await expect(frame.locator('.lt-frame-label')).toHaveText('This animation was written by your agent and is not checked by Learning Tool.');
      await expect(page.locator('canvas')).toHaveCount(0);
      await expect(page.locator('input')).toHaveCount(0);
      await expect(page.locator('button')).toHaveCount(0);
      // The box already has its shape, so nothing jumps when the script arrives.
      const box = await frame.locator('.lt-frame-stage').boundingBox();
      expect(Math.abs((box?.width ?? 0) / (box?.height ?? 1) - 16 / 9)).toBeLessThan(0.02);
      expect((await frame.locator('.lt-frame-status').boundingBox())?.height ?? 0).toBe(0);
      await o.close();
      await page.context().close();
    });
  });
}

test('reduced motion: the poster still, and nothing moves by itself', async ({ browser }, testInfo) => {
  const page = await newPage(browser, { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const o = await open(page, testInfo, await buildPage([CLOCK]), 'file');
  await settled(page, 'clock');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const first = await info(page, 'clock');
  expect(first.state).toBe('live');
  expect(first.t).toBe(CLOCK.stage.poster);
  const still = await pixel(page, 'clock');
  expect(Math.abs(still[0] - 127)).toBeLessThan(8);
  await page.waitForTimeout(700);
  const later = await info(page, 'clock');
  expect(later.frames).toBe(first.frames);
  expect(later.t).toBe(first.t);
  expect(await pixel(page, 'clock')).toEqual(still);
  // The stills a clip's controls ask for under reduced motion: the end, and the poster again.
  await page.evaluate(() => window.__ltf!.get('clock').kit.still('end'));
  await settled(page, 'clock');
  expect((await pixel(page, 'clock'))[0]).toBeGreaterThan(245);
  await page.evaluate(() => window.__ltf!.get('clock').kit.still('poster'));
  await settled(page, 'clock');
  expect(await pixel(page, 'clock')).toEqual(still);
  await o.close();
  await page.context().close();
});

test('forced colours: the picture is redrawn in the system colours the page itself is using', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'only Chromium can be asked to emulate forced colours');
  await page.emulateMedia({ colorScheme: 'light' });
  const o = await open(page, testInfo, await buildPage([SORT]), 'file');
  await settled(page, SORT.id);
  const before = await pixel(page, SORT.id, 0.02, 0.02);
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' });
  // The stage's background is now the system's Canvas colour, which is what the page's own background is.
  const canvasColour = await page.evaluate(() => {
    const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) ?? [];
    return m.slice(0, 3).map(Number);
  });
  await expect.poll(() => pixel(page, SORT.id, 0.02, 0.02)).toEqual(canvasColour);
  expect(canvasColour).not.toEqual(before);
  expect((await info(page, SORT.id)).state).toBe('live');
  expect(await ink(page, SORT.id)).toBeGreaterThan(0.01);
  await o.close();
});

test('several requests in one task draw only the last: time 0, then the poster, shows the poster', async ({ page }, testInfo) => {
  const o = await open(page, testInfo, await buildPage([CLOCK]), 'file');
  await settled(page, 'clock');
  const before = (await info(page, 'clock')).frames;
  await page.evaluate(() => {
    const kit = window.__ltf!.get('clock').kit;
    kit.render(0);
    kit.render(4);
    kit.still('poster');
  });
  await settled(page, 'clock');
  expect((await info(page, 'clock')).frames).toBe(before + 1);
  expect(Math.abs((await pixel(page, 'clock'))[0] - 127)).toBeLessThan(8);
  await o.close();
});

for (const [aspect, ratio, units] of [
  ['4:3', 4 / 3, { w: 720, h: 540 }],
  ['1:1', 1, { w: 540, h: 540 }],
] as const) {
  test(`aspect ${aspect}: the box has that shape where there is room, and the tall stage at 320`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1200 });
    const frame = frameOf('shaped', 'function render(ctx, t) { S.clear(S.theme.accentSoft); S.circle(S.W / 2, S.H / 2, Math.min(S.W, S.H) * 0.4, { stroke: S.theme.accent, lw: 6 }); }', { aspect });
    const o = await open(page, testInfo, await buildPage([frame]), 'file');
    await settled(page, 'shaped');
    const wide = await info(page, 'shaped');
    expect(wide.units).toEqual(units);
    expect(Math.abs(wide.css[0] / wide.css[1] - ratio)).toBeLessThan(0.02);
    expect(Math.abs(wide.px[0] / wide.px[1] - ratio)).toBeLessThan(0.02);
    await page.setViewportSize({ width: 320, height: 800 });
    await expect.poll(async () => (await info(page, 'shaped')).units).toEqual({ w: 540, h: 675 });
    await settled(page, 'shaped');
    expect((await info(page, 'shaped')).state).toBe('live');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await o.close();
  });
}

test('on someone else\'s stage: the picture is fitted into their box, and what a learner operates stays outside it', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  const away = { ...PROJECTILE, away: true };
  const o = await open(page, testInfo, await buildPage([away]), 'file');
  await settled(page, away.id);
  const section = page.locator(`section[data-scene="${away.id}"]`);
  const stage = section.locator('.h-stage');
  await expect(stage.locator('canvas')).toHaveCount(1);
  await expect(section.locator('.lt-frame canvas')).toHaveCount(0);
  await expect(section.locator('.lt-frame')).toHaveAttribute('data-picture', 'away');
  // 16:9 inside a box 320 px high: the height decides, and the picture is centred.
  const box = (await stage.boundingBox())!;
  const pic = (await stage.locator('canvas').boundingBox())!;
  expect(Math.round(pic.height)).toBe(320);
  expect(Math.abs(pic.width / pic.height - 16 / 9)).toBeLessThan(0.02);
  expect(Math.abs(pic.x + pic.width / 2 - (box.x + box.width / 2))).toBeLessThan(2);
  // Hidden from assistive technology with the stage, so it is not named as an image there.
  expect(await stage.locator('canvas').getAttribute('role')).toBeNull();
  // The slider, the label and the status line are in the frame's own element, outside the stage.
  await expect(section.locator('.lt-frame [data-param="angle"]')).toBeVisible();
  await expect(section.locator('.lt-frame .lt-frame-label')).toBeVisible();
  await expect(section.locator('.lt-frame .lt-frame-alt')).toBeHidden();
  expect((await info(page, away.id)).state).toBe('live');
  expect(await ink(page, away.id)).toBeGreaterThan(0.01);
  await o.close();
});

test('destroy puts the static frame back as it was, and a rebuilt kit keeps the slider where the learner left it', async ({ page }, testInfo) => {
  const built = await buildPage([PROJECTILE]);
  const staticMarkup = /<div class="lt-frame"[\s\S]*?<\/div><p class="lt-frame-status"[^>]*><\/p><p class="lt-frame-label">[^<]*<\/p><\/div>/.exec(built.html)?.[0];
  expect(staticMarkup).toBeTruthy();
  const o = await open(page, testInfo, built, 'file');
  await settled(page, PROJECTILE.id);
  const slider = page.locator('[data-param="angle"]');
  await slider.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await settled(page, PROJECTILE.id);

  await page.evaluate((id) => window.__ltf!.get(id).kit.destroy(), PROJECTILE.id);
  // (A browser writes a bare attribute back with an empty value.)
  expect(await page.locator('.lt-frame').evaluate((el) => el.outerHTML.replace('data-frame=""', 'data-frame'))).toBe(staticMarkup);
  await expect(page.locator('canvas')).toHaveCount(0);

  await page.evaluate((id) => window.__ltf!.get(id).rebuild(), PROJECTILE.id);
  await settled(page, PROJECTILE.id);
  await expect(page.locator('[data-param="angle"]')).toHaveValue('50');
  await expect(page.locator('.lt-frame-param-value')).toHaveText('50°');
  expect(await page.evaluate((id) => window.__ltf!.get(id).kit.host.params.angle, PROJECTILE.id)).toBe(50);
  expect((await info(page, PROJECTILE.id)).state).toBe('live');
  await o.close();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: no violations, ${scheme}, live and turned off`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    const broken = frameOf('broken', 'function render(ctx, t) { S.clear(); if (t > 1) { null.x; } }');
    const o = await open(page, testInfo, await buildPage([SORT, PROJECTILE, KINETIC, broken]), 'file');
    for (const f of [SORT, PROJECTILE, KINETIC, broken]) await settled(page, f.id);
    await page.evaluate(() => window.__ltf!.get('broken').seek(2));
    await page.waitForFunction(() => window.__ltf!.get('broken').kit.state === 'failed');
    await expect(page.locator('section[data-scene="broken"] .lt-frame-retry')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    expect(await violations(page), 'policy violations on the page').toEqual([]);
    await o.close();
  });
}
