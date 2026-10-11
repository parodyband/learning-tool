// The central offline promise: a published lesson makes no request, logs no error and breaks no
// policy rule, in any state, whether it is opened as a file or from the local listener.
import { exampleScenes, expect, expectClean, openLesson, sectionId, test, type Via } from './shell-kit';

const example = exampleScenes();

for (const via of ['file', 'http'] as Via[]) {
  test.describe(`opened from ${via === 'file' ? 'file://' : 'http://127.0.0.1'}`, () => {
    test('every scene and every overlay works with the network cut off', async ({ page, browserName }, testInfo) => {
      const watch = await openLesson(page, testInfo, { via });
      await expect(page.locator('html')).toHaveClass(/lt-js/);

      const scenes = page.locator('section.lt-scene');
      const total = await scenes.count();
      expect(total).toBe(example.total);
      await expect(scenes.locator('visible=true')).toHaveCount(1);

      // A source popover on the first scene.
      const chip = page.locator(`#${sectionId(example.first)} button.lt-chip`).first();
      await chip.click();
      const card = page.locator(`#${sectionId(example.first)} .lt-source:popover-open`);
      await expect(card).toBeVisible();
      await expect(card).toContainText('Open the source at this passage');
      await page.keyboard.press('Escape');
      await expect(card).toHaveCount(0);

      // The sources dialog.
      await page.locator('#lt-opensources').click();
      await expect(page.locator('dialog#lt-sources')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('dialog#lt-sources')).toBeHidden();

      // The theme switch and the contents list.
      await page.locator('#lt-theme').click();
      await page.getByRole('button', { name: 'Contents' }).click();
      await expect(page.locator('#lt-contents')).toBeVisible();
      await page.keyboard.press('Escape');

      // Forward through every scene, then back to the start through history.
      for (let i = 1; i < total; i++) {
        await page.locator('#lt-next').click();
        await expect(scenes.nth(i)).toBeVisible();
        await expect(scenes.locator('visible=true')).toHaveCount(1);
      }
      await page.locator(`#${sectionId(example.last)} details.lt-reveal > summary`).first().click();
      await page.locator(`#${sectionId(example.last)} button[data-copy]`).last().click();
      for (let i = total - 1; i > 0; i--) await page.goBack();
      await expect(scenes.first()).toBeVisible();

      // A reload is a second fetch of the same document and nothing more.
      await page.reload();
      await expect(page.locator('html')).toHaveClass(/lt-js/);

      await expectClean(watch, browserName);
      expect(new Set(watch.requests.map((r) => r.split('#')[0]))).toEqual(new Set([watch.url]));
      if (via === 'http') {
        expect(watch.serverHits.length).toBeGreaterThanOrEqual(2);
        expect(new Set(watch.serverHits)).toEqual(new Set([`GET ${new URL(watch.url).pathname}`]));
      }
    });

    test('the page is watched closely enough to catch a breach', async ({ page, browserName }, testInfo) => {
      // The assertions above only mean something if a real request, error or violation would be seen.
      const watch = await openLesson(page, testInfo, { via });
      await page.evaluate(() => {
        const img = document.createElement('img');
        img.src = 'https://example.org/pixel.png';
        document.body.append(img);
        const s = document.createElement('script');
        s.textContent = 'window.__ltInjected = true';
        document.body.append(s);
        document.body.setAttribute('style', 'color: red');
      });
      await page.evaluate(() => fetch('https://example.org/data.json').catch(() => undefined));
      await expect.poll(async () => (await watch.violations()).length).toBeGreaterThanOrEqual(3);
      const directives = (await watch.violations()).map((v) => v.directive);
      expect(directives.some((d) => d.startsWith('img-src'))).toBe(true);
      expect(directives.some((d) => d.startsWith('script-src'))).toBe(true);
      expect(directives.some((d) => d.startsWith('style-src'))).toBe(true);
      expect(directives.some((d) => d.startsWith('connect-src'))).toBe(true);
      expect(await page.evaluate(() => (window as unknown as { __ltInjected?: boolean }).__ltInjected)).toBeUndefined();
      // The policy stops these before they reach the network, so the server never hears of them.
      expect(watch.blocked).toEqual([]);
      if (via === 'http') expect(watch.serverHits).toHaveLength(1);
      expect(browserName).toBeTruthy();
    });
  });
}
