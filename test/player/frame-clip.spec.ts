// The frame inside a real lesson: rendered by the product's renderer, played by the clip engine's
// own controls, under the page's real policy. The frame's own specs (frame-play, frame-escape,
// frame-abuse, frame-fit) test it on a page of its own; this one tests the join.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { FRAME_EXAMPLE_PROJECTILE, FRAME_EXAMPLE_SORT, frameExampleClip } from '../../src/core/frame-examples';
import type { Scene } from '../../src/core/schema';
import type { Published } from '../../src/core/types';
import { FRAME_TEXT } from '../../src/player/frame/shared';
import { examplePublished } from '../helpers/example';
import { type Via, expect, expectClean, openLesson, test } from './shell-kit';

const SHOTS = process.env.FRAME_SHOTS ? path.resolve(process.env.FRAME_SHOTS, '../shots-clip') : null;

/** The example lesson with two frame clips in front of it. */
function lessonWithFrames(extra: unknown[] = []): Published {
  const p = examplePublished();
  const clips = [frameExampleClip(FRAME_EXAMPLE_PROJECTILE), frameExampleClip(FRAME_EXAMPLE_SORT), ...extra] as unknown as Scene[];
  p.lesson.scenes = [...clips, ...p.lesson.scenes];
  return p;
}

const scene = (page: Page, id: string) => page.locator(`section[data-scene="${id}"]`);

/** The colour of the frame's picture at a point given as shares of its width and height. */
function pixel(page: Page, id: string, fx: number, fy: number): Promise<[number, number, number] | null> {
  return page.evaluate(
    ([id, fx, fy]) => {
      const section = Array.from(document.querySelectorAll<HTMLElement>('section[data-scene]')).find((s) => s.dataset.scene === id);
      const c = section?.querySelector<HTMLCanvasElement>('canvas.lt-frame-canvas');
      if (!c || c.hidden || !c.width) return null;
      const probe = document.createElement('canvas');
      probe.width = probe.height = 1;
      const x = probe.getContext('2d')!;
      x.drawImage(c, Math.floor(c.width * (fx as number)), Math.floor(c.height * (fy as number)), 1, 1, 0, 0, 1, 1);
      const d = x.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]] as [number, number, number];
    },
    [id, fx, fy] as const,
  );
}

/** A digest of the whole picture, to tell two instants apart. */
function digest(page: Page, id: string): Promise<string> {
  return page.evaluate((id) => {
    const section = Array.from(document.querySelectorAll<HTMLElement>('section[data-scene]')).find((s) => s.dataset.scene === id);
    const c = section?.querySelector<HTMLCanvasElement>('canvas.lt-frame-canvas');
    if (!c || c.hidden || !c.width) return '';
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 36;
    const x = probe.getContext('2d')!;
    x.drawImage(c, 0, 0, 64, 36);
    let h = 0;
    for (const v of x.getImageData(0, 0, 64, 36).data) h = (h * 31 + v) | 0;
    return String(h);
  }, id);
}

/** Bring the clip's stage into view and wait for its picture. A frame's code does not run until its stage is seen. */
async function live(page: Page, id: string): Promise<void> {
  await scene(page, id).locator('.st-view').scrollIntoViewIfNeeded();
  await expect(scene(page, id).locator('.lt-frame')).toHaveAttribute('data-state', 'live', { timeout: 10_000 });
}

for (const via of ['file', 'http'] as Via[]) {
  test.describe(`a frame clip in a lesson, opened from ${via}`, () => {
    test('stands on its poster, plays under the clip\'s controls, scrubs and replays, and the page stays clean', async ({ page, browserName }, testInfo) => {
      const id = FRAME_EXAMPLE_PROJECTILE.id;
      const watch = await openLesson(page, testInfo, { published: lessonWithFrames(), via, hash: `#/${id}` });
      const s = scene(page, id);
      await expect(s.locator('.lt-clip')).toHaveClass(/lt-clip-live/);
      await live(page, id);
      // The picture is on the clip's stage; the frame's own element sits outside it with the slider and the label.
      await expect(s.locator('.st-view canvas.lt-frame-canvas')).toHaveCount(1);
      await expect(s.locator('.lt-frame')).toHaveAttribute('data-picture', 'away');
      await expect(s.locator('.lt-frame .lt-frame-label')).toHaveText(FRAME_TEXT.label);
      await expect(s.locator('.lt-frame [data-param="angle"]')).toBeVisible();
      await expect(s.locator('.lt-clip')).toHaveAttribute('data-state', 'poster');
      const poster = await digest(page, id);
      expect(poster).not.toBe('');

      // Play with the clip's own button; the picture changes as time passes.
      await s.locator('.st-play').click();
      await expect(s.locator('.lt-clip')).toHaveAttribute('data-state', 'playing');
      await expect.poll(() => digest(page, id), { timeout: 5000 }).not.toBe(poster);
      await s.locator('.st-play').click();
      await expect(s.locator('.lt-clip')).toHaveAttribute('data-state', 'paused');

      // Scrub with the clip's own slider: the end of the flight has the range written under it.
      const range = s.locator('.st-range');
      await range.focus();
      await page.keyboard.press('End');
      await expect.poll(async () => (await s.locator('.lt-clip').getAttribute('data-state')) ?? '').toMatch(/ended|paused/);
      await expect.poll(() => digest(page, id), { timeout: 5000 }).not.toBe(poster);
      const atEnd = await digest(page, id);
      await page.keyboard.press('Home');
      await expect.poll(() => digest(page, id), { timeout: 5000 }).not.toBe(atEnd);

      // The frame's slider redraws the instant on show.
      const before = await digest(page, id);
      await s.locator('[data-param="angle"]').focus();
      for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
      await expect(s.locator('.lt-frame-param-value')).toHaveText('57°');
      await expect.poll(() => digest(page, id), { timeout: 5000 }).not.toBe(before);

      await expect(s.locator('.lt-frame')).toHaveAttribute('data-state', 'live');
      await expectClean(watch, browserName);
    });
  });
}

test('reduced motion: the clip opens on the frame\'s poster still and does not move', async ({ browser, browserName }, testInfo) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const id = FRAME_EXAMPLE_SORT.id;
  const watch = await openLesson(page, testInfo, { published: lessonWithFrames(), hash: `#/${id}` });
  await live(page, id);
  await expect(scene(page, id).locator('.lt-clip')).toHaveAttribute('data-state', 'poster');
  // The sort's poster (6.3 s) is in the middle of a pass: the bars stand at full height and the last
  // one, already in place, is green. At 0 s there are no bars at all, only the stage's own blue.
  const isGreen = (p: [number, number, number] | null): boolean => p !== null && p[1] > p[0] && p[1] > p[2];
  await expect.poll(async () => isGreen(await pixel(page, id, 0.845, 0.6)), { timeout: 5000 }).toBe(true);
  expect(isGreen(await pixel(page, id, 0.02, 0.02)), 'the background is not green').toBe(false);
  const still = await digest(page, id);
  await page.waitForTimeout(800);
  expect(await digest(page, id)).toBe(still);
  await expectClean(watch, browserName);
  await context.close();
});

test('a frame that fails inside a clip says so outside the stage, offers "Try again", and the lesson goes on', async ({ page, browserName }, testInfo) => {
  const broken = frameExampleClip({ ...FRAME_EXAMPLE_SORT, id: 'broken', title: 'A frame that breaks', stage: { ...FRAME_EXAMPLE_SORT.stage, code: 'function render(ctx, t) { S.clear(); if (t > 1 && t < 6) { null.x; } }', duration: 8, poster: 0.5 } });
  broken.beats = [broken.beats[0]!, { ...broken.beats[1]!, at: 4 }];
  const watch = await openLesson(page, testInfo, { published: lessonWithFrames([broken]), hash: '#/broken' });
  const s = scene(page, 'broken');
  await live(page, 'broken');
  await s.locator('.st-play').click();
  await expect(s.locator('.lt-frame')).toHaveAttribute('data-state', 'failed', { timeout: 10_000 });
  await expect(s.locator('.lt-frame-status')).toHaveText(FRAME_TEXT.error);
  await expect(s.locator('.lt-frame-status')).toBeVisible();
  await expect(s.locator('.lt-frame-retry')).toBeVisible();
  await expect(s.locator('.lt-frame .lt-frame-alt')).toBeVisible();
  // Neither the status line nor the button is inside the stage that is hidden from assistive technology.
  expect(await s.locator('.lt-frame-status').evaluate((el) => el.closest('[aria-hidden="true"]') === null)).toBe(true);
  expect(await s.locator('.lt-frame-retry').evaluate((el) => el.closest('[aria-hidden="true"]') === null)).toBe(true);

  // The rest of the lesson is not affected: another clip plays.
  await page.evaluate((id) => {
    location.hash = `#/${id}`;
  }, FRAME_EXAMPLE_PROJECTILE.id);
  await live(page, FRAME_EXAMPLE_PROJECTILE.id);
  const other = scene(page, FRAME_EXAMPLE_PROJECTILE.id);
  const poster = await digest(page, FRAME_EXAMPLE_PROJECTILE.id);
  await other.locator('.st-play').click();
  await expect.poll(() => digest(page, FRAME_EXAMPLE_PROJECTILE.id), { timeout: 5000 }).not.toBe(poster);
  expect(watch.pageErrors).toEqual([]);
  void browserName;
});

test('scripting off: the clip is its description, its captions and the frame\'s label; nothing is dead', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await openLesson(page, testInfo, { published: lessonWithFrames() });
  const s = scene(page, FRAME_EXAMPLE_PROJECTILE.id);
  await expect(s.locator('.lt-clip-desc')).toHaveText(FRAME_EXAMPLE_PROJECTILE.description);
  await expect(s.locator('.lt-clip-desc')).toBeVisible();
  await expect(s.locator('.lt-frame-label')).toHaveText(FRAME_TEXT.label);
  await expect(s.locator('.lt-frame-label')).toBeVisible();
  // The clip has already said what the animation shows, so the frame's own copy stays out of sight.
  await expect(s.locator('.lt-frame .lt-frame-alt')).toBeHidden();
  for (const b of FRAME_EXAMPLE_PROJECTILE.beats) await expect(s.getByText(b.caption)).toBeVisible();
  await expect(s.locator('canvas')).toHaveCount(0);
  await expect(s.locator('input[type="range"]')).toHaveCount(0);
  await context.close();
});

test('print: the stage prints the picture as it stood, with the label and the description', async ({ page }, testInfo) => {
  const id = FRAME_EXAMPLE_SORT.id;
  await openLesson(page, testInfo, { published: lessonWithFrames(), hash: `#/${id}` });
  await live(page, id);
  await page.emulateMedia({ media: 'print' });
  const s = scene(page, id);
  const read = await s.evaluate((el) => {
    const shown = (sel: string): boolean => {
      const node = el.querySelector(sel);
      return !!node && getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().height > 0;
    };
    return { canvas: shown('canvas.lt-frame-canvas'), label: shown('.lt-frame-label'), description: shown('.lt-clip-desc'), params: shown('.lt-frame-params'), retry: shown('.lt-frame-retry') };
  });
  expect(read).toEqual({ canvas: true, label: true, description: true, params: false, retry: false });
  if (SHOTS) await s.screenshot({ path: path.join(SHOTS, 'print.png') });
  await page.emulateMedia({ media: 'screen' });
});

for (const width of [1280, 320]) {
  test(`axe and reflow at ${width}: a lesson with frame clips has no violations and does not scroll sideways`, async ({ page, browserName }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const id = FRAME_EXAMPLE_PROJECTILE.id;
    await openLesson(page, testInfo, { published: lessonWithFrames(), hash: `#/${id}` });
    await live(page, id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const results = await new AxeBuilder({ page }).include(`section[data-scene="${id}"] .lt-frame`).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    // Pictures to look at, when asked for (FRAME_SHOTS): the poster, then the flight under way.
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await scene(page, id).locator('.st-band').screenshot({ path: path.join(SHOTS, `${browserName}-${width}-poster.png`) });
      await scene(page, id).locator('.st-range').focus();
      for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(400);
      await scene(page, id).locator('.st-band').screenshot({ path: path.join(SHOTS, `${browserName}-${width}-playing.png`) });
    }
  });
}
