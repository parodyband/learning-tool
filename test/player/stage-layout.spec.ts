// Clips on every screen and with nothing but markup: 320 pixels, a wide window, text spacing,
// print, scripting off, a change of theme or of size while a clip is on show, and one clip of
// every stage kind built in the page.
import type { Page } from '@playwright/test';
import { EXAMPLE_CLIPS } from '../../src/core/clip-examples';
import { asPublished, exampleKitsLesson, examplePublishedV2 } from '../helpers/clip-example';
import { spaceText } from './questions-kit';
import { expect, expectClean, openLesson, test } from './shell-kit';
import { CLIPS, at, clip, clipOf, clipState, control, expectNoSidewaysScroll, openClip, picture, settled } from './stage-kit';

const KITS = exampleKitsLesson();
/** The kinds this engine draws itself. `lines`, `timeline` and `frame` have their own specs. */
const OWN = ['sequence', 'cells', 'dots', 'chart', 'flow', 'words'] as const;

async function passGates(page: Page, id: string): Promise<void> {
  await page.evaluate((sceneId) => {
    const root = Array.from(document.querySelectorAll<HTMLElement>('.lt-clip')).find((el) => el.dataset.clip === sceneId) as HTMLElement & { ltClip: { beats: { i: number; gate: boolean }[]; pass(i: number): void } };
    for (const b of root.ltClip.beats) if (b.gate) root.ltClip.pass(b.i);
  }, id);
}
async function go(page: Page, id: string): Promise<void> {
  await page.evaluate((sceneId) => {
    location.hash = `#/${sceneId}`;
  }, id);
  await expect(page.locator(`section[data-scene="${id}"]`)).toBeVisible();
  await settled(page, id);
}

/** Parts of the picture that stick out of the stage, as "class: by how much". Anything the camera has zoomed past is not counted. */
function overflowing(page: Page, id: string): Promise<string[]> {
  return page.evaluate((sceneId) => {
    const root = Array.from(document.querySelectorAll<HTMLElement>('.lt-clip')).find((el) => el.dataset.clip === sceneId) as HTMLElement;
    const view = root.querySelector('.st-view') as HTMLElement;
    const frame = view.getBoundingClientRect();
    const out: string[] = [];
    view.querySelectorAll<HTMLElement>('.st-hud > *, .st-world > .st-p, .st-lines > *').forEach((el) => {
      if (el.style.opacity === '0' || getComputedStyle(el).opacity === '0') return;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      const by = Math.max(frame.left - r.left, r.right - frame.right, frame.top - r.top, r.bottom - frame.bottom);
      if (by > 1.5) out.push(`${el.className}: ${Math.round(by)}px`);
    });
    return out;
  }, id);
}

test.describe('at 320 pixels', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('the lesson: nothing scrolls sideways at any beat of any clip, and the stage runs edge to edge', async ({ page, browserName }, testInfo) => {
    const watch = await openClip(page, testInfo, 'c1');
    await expectNoSidewaysScroll(page, 'title card');
    for (const c of CLIPS) {
      await go(page, c.id);
      await passGates(page, c.id);
      const s = await clipState(page, c.id);
      expect(s.W, `${c.id}: stage width`).toBe(320);
      const band = (await clip(page, c.id).locator('.st-band').boundingBox()) as { x: number; width: number };
      expect(Math.round(band.x)).toBe(0);
      expect(Math.round(band.width)).toBe(320);
      for (const t of [s.poster, ...s.beats.map((b) => b.t1 - 1)]) {
        await at(page, c.id, t);
        await expectNoSidewaysScroll(page, `${c.id} at ${t} ms`);
      }
    }
    await expectClean(watch, browserName);
  });

  test('the picture stays on the stage where the camera has not moved in', async ({ page }, testInfo) => {
    await openLesson(page, testInfo, { published: asPublished(exampleKitsLesson([...OWN])), hash: '#/k-sequence' });
    for (const kind of OWN) {
      const id = EXAMPLE_CLIPS[kind].id;
      await go(page, id);
      const s = await clipState(page, id);
      for (const b of s.beats) {
        await at(page, id, b.t1 - 1);
        expect(await overflowing(page, id), `${id} beat ${b.i + 1}`).toEqual([]);
      }
    }
  });

  test('every control is at least 24 pixels and reachable, and wider text spacing breaks nothing', async ({ page }, testInfo) => {
    await openClip(page, testInfo, 'c3');
    await spaceText(page);
    await at(page, 'c3', (await clipState(page, 'c3')).duration);
    await expectNoSidewaysScroll(page, 'with text spacing, at the prediction');
    const small = await clip(page, 'c3').evaluate((root) =>
      Array.from(root.querySelectorAll<HTMLElement>('.st-controls button, .st-controls input, .st-bigplay, .lt-predict input, .lt-predict button, .st-under input, summary, button.lt-chip'))
        .filter((el) => el.offsetParent !== null && !el.hidden)
        .map((el) => {
          const r = (el.matches('.st-speed-option input, .st-toggle input, .lt-option input') ? (el.closest('label') as HTMLElement) : el).getBoundingClientRect();
          return { cls: el.className || el.tagName, w: Math.round(r.width), h: Math.round(r.height) };
        })
        .filter((b) => b.w < 24 || b.h < 24),
    );
    expect(small).toEqual([]);
    // The controls stay inside the window.
    const out = await clip(page, 'c3').evaluate((root) =>
      Array.from(root.querySelectorAll<HTMLElement>('.st-controls *'))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && (r.left < -0.5 || r.right > document.documentElement.clientWidth + 0.5)).length,
    );
    expect(out).toBe(0);
  });
});

test.describe('in a wide window', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the band runs the full width of the window, the stage and its caption and controls fit one screen', async ({ page }, testInfo) => {
    await openClip(page, testInfo, 'c3');
    const full = await page.evaluate(() => document.documentElement.clientWidth);
    const band = (await clip(page, 'c3').locator('.st-band').boundingBox()) as { x: number; y: number; width: number; height: number };
    expect(Math.round(band.x)).toBe(0);
    expect(Math.round(band.width)).toBe(full);
    await expectNoSidewaysScroll(page, 'wide');
    // The heading, the whole stage, the caption strip and the controls are in view without scrolling.
    const head = (await page.locator('#scene-c3').boundingBox()) as { y: number };
    expect(head.y).toBeGreaterThanOrEqual(0);
    expect(band.y + band.height).toBeLessThanOrEqual(800);
    const s = await clipState(page, 'c3');
    expect(s.W).toBe(1280);
  });

  test('on a very wide window the picture keeps a readable width and the field still reaches the edges', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1900, height: 1000 });
    await openClip(page, testInfo, 'c3');
    const band = (await clip(page, 'c3').locator('.st-band').boundingBox()) as { x: number; width: number };
    expect(Math.round(band.x)).toBe(0);
    expect(Math.round(band.width)).toBe(await page.evaluate(() => document.documentElement.clientWidth));
    expect((await clipState(page, 'c3')).W).toBe(1280);
    await expectNoSidewaysScroll(page, 'very wide');
  });

  test('a clip is built again for a new size and keeps its place', async ({ page }, testInfo) => {
    await openClip(page, testInfo, 'c3');
    const wide = await clipState(page, 'c3');
    const b = wide.beats[1] as { t0: number; t1: number };
    await at(page, 'c3', Math.round(b.t0 + (b.t1 - b.t0) * 0.5));
    await page.setViewportSize({ width: 360, height: 700 });
    await expect.poll(async () => (await clipState(page, 'c3')).W).toBe(360);
    const narrow = await clipState(page, 'c3');
    expect(narrow.k).toBe(1);
    expect(narrow.playing).toBe(false);
    await expectNoSidewaysScroll(page, 'after narrowing');
    const band = (await clip(page, 'c3').locator('.st-band').boundingBox()) as { x: number; width: number };
    expect(Math.round(band.x)).toBe(0);
    expect(Math.round(band.width)).toBe(360);
    // The picture at that place is the one a clip built at this size from the start would show.
    const rebuilt = await picture(page, 'c3');
    await page.reload();
    await settled(page, 'c3');
    await at(page, 'c3', narrow.t);
    expect(await picture(page, 'c3')).toBe(rebuilt);
  });

  test('changing the theme redraws the stage for it, where it stands', async ({ page }, testInfo) => {
    await openClip(page, testInfo, 'c5');
    const s = await clipState(page, 'c5');
    await at(page, 'c5', (s.beats[1]?.t1 ?? 0) - 1);
    const canvas = clip(page, 'c5').locator('canvas.st-dots');
    const light = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
    const field = () => clip(page, 'c5').locator('.st-strip').evaluate((el) => getComputedStyle(el).backgroundColor);
    const before = await field();
    await page.locator('#lt-theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(field).not.toBe(before);
    await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).not.toBe(light);
    expect((await clipState(page, 'c5')).t).toBe((s.beats[1]?.t1 ?? 0) - 1);
    // And the band keeps the dark scheme for its own words in both themes.
    expect(await clip(page, 'c5').locator('.st-band').evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
  });
});

test('print: every beat of every clip as a still with its caption, and the player put away', async ({ page, browserName }, testInfo) => {
  const watch = await openClip(page, testInfo, 'c3');
  await page.emulateMedia({ media: 'print' });
  for (const c of CLIPS) {
    const root = clip(page, c.id);
    await expect(root.locator('.st-stills .st-still')).toHaveCount(c.beats.length);
    await expect(root.locator('.st-stage')).toBeHidden();
    await expect(root.locator('.st-controls')).toBeHidden();
    await expect(root.locator('li.lt-beat .lt-cap').filter({ visible: true })).toHaveCount(c.beats.length);
    // Each still is a picture: it has parts, and it is drawn on white.
    const stills = await root.locator('.st-still > .st-view').evaluateAll((views) =>
      views.map((v) => ({ parts: v.querySelectorAll('.st-p, .st-line, canvas').length, bg: getComputedStyle(v).backgroundColor, h: v.getBoundingClientRect().height })),
    );
    for (const still of stills) {
      expect(still.parts, c.id).toBeGreaterThan(0);
      expect(still.bg, c.id).toBe('rgb(255, 255, 255)');
      expect(still.h, c.id).toBeGreaterThan(100);
    }
  }
  // The stills of a clip differ from one another: they are its beats, not one frame repeated.
  const trace = await clip(page, 'c3').locator('.st-still > .st-view').evaluateAll((views) => new Set(views.map((v) => v.innerHTML)).size);
  expect(trace).toBe(clipOf('c3').beats.length);
  // A prediction prints as its question, with the answer written out: the one chosen from options, and the one tapped on the picture.
  await expect(clip(page, 'c3').locator('.lt-predict')).toHaveCount(2);
  for (const predict of await clip(page, 'c3').locator('.lt-predict').all()) {
    await expect(predict).toBeVisible();
    await expect(predict.locator('.lt-key')).toBeVisible();
  }
  await expect(clip(page, 'c3').locator('.lt-pick .lt-key')).toContainText('Correct answer: 57');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (browserName === 'chromium') {
    const pdf = await page.pdf({ format: 'A4' });
    expect(pdf.byteLength).toBeGreaterThan(20_000);
  }
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('.st-stills')).toHaveCount(0);
  await expect(clip(page, 'c3').locator('.st-stage')).toBeVisible();
  await expectClean(watch, browserName);
});

test.describe('with scripting off', () => {
  test.use({ javaScriptEnabled: false });

  test('a clip is a readable account: what it shows, each beat with its sources, each prediction with its answer, what is on stage', async ({ page }, testInfo) => {
    await openLesson(page, testInfo, { published: examplePublishedV2() });
    await expect(page.locator('.st-band')).toHaveCount(0);
    await expect(page.locator('section.lt-scene').filter({ visible: true })).toHaveCount(examplePublishedV2().lesson.scenes.length);
    for (const c of CLIPS) {
      const root = clip(page, c.id);
      await expect(root.locator('.lt-clip-desc')).toHaveText(c.description);
      await expect(root.locator('.lt-prov')).toBeVisible();
      await expect(root.locator('li.lt-beat .lt-cap').filter({ visible: true })).toHaveCount(c.beats.length);
      for (const [i, b] of c.beats.entries()) await expect(root.locator(`li[data-beat="${i + 1}"] .lt-cap`)).toContainText(b.caption.text);
      await expect(root.locator('.lt-onstage')).toBeVisible();
      for (const [i, b] of c.beats.entries()) {
        if (!b.gate) continue;
        const li = root.locator(`li[data-beat="${i + 1}"]`);
        await expect(li.locator('.lt-predict')).toContainText(b.gate.prompt);
        // No dead controls: the radios and buttons the script would wake are not shown.
        await expect(li.locator('input').filter({ visible: true })).toHaveCount(0);
        await expect(li.locator('button:not(.lt-chip)').filter({ visible: true })).toHaveCount(0);
        const answer = li.locator('details[data-answer]');
        await expect(answer.locator('.lt-key')).toBeHidden();
        await answer.locator('summary').click();
        // Chosen from options: the right option's reason. Tapped on the picture: the reason for the right part.
        await expect(answer.locator('.lt-key')).toContainText('options' in b.gate ? (b.gate.options.find((o) => o.correct)?.feedback as string) : b.gate.right);
      }
    }
    // The stage's sources are chips that open a card with no script at all.
    await clip(page, 'c2').locator('.lt-prov button.lt-chip').click();
    await expect(page.locator('.lt-source:popover-open')).toHaveCount(1);
  });

  test('at 320 pixels the account does not scroll sideways', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openLesson(page, testInfo, { published: asPublished(KITS) });
    await expectNoSidewaysScroll(page, 'no script, every kind');
    for (const scene of KITS.scenes) await expect(clip(page, scene.id).locator('.lt-clip-desc')).toBeVisible();
  });
});

test('one clip of every stage kind builds in the page, plays to its end, and asks for nothing from the network', async ({ page, browserName }, testInfo) => {
  test.setTimeout(120_000);
  const watch = await openLesson(page, testInfo, { published: asPublished(KITS), hash: `#/${KITS.scenes[0]?.id}` });
  for (const scene of KITS.scenes) {
    await go(page, scene.id);
    const root = clip(page, scene.id);
    await expect(root).toHaveClass(/lt-clip-live/);
    await expect(root).not.toHaveAttribute('data-failed', 'true');
    const s = await clipState(page, scene.id);
    expect(s.beats.length, scene.id).toBe(scene.kind === 'clip' ? scene.beats.length : 0);
    await control(page, scene.id, 'st-speed').locator('input[value="2"]').check();
    await passGates(page, scene.id);
    await at(page, scene.id, Math.max(0, s.duration - 1500));
    await control(page, scene.id, 'st-play').click();
    await expect(root, scene.id).toHaveAttribute('data-state', 'ended', { timeout: 20_000 });
    await expect(root.locator('.st-stage .lt-prov')).toBeVisible();
  }
  await expectClean(watch, browserName);
});
