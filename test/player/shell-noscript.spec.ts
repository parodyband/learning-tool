// With no script the page is the transcript: one linear document with every scene, every source,
// and working native controls. The same is true if the script fails.
import { examplePublished } from '../helpers/example';
import { LONG_TOPICS, exampleScenes, expect, openLesson, sectionId, test, withLongTopics } from './shell-kit';

const example = exampleScenes();
const lesson = examplePublished().lesson;

test.describe('scripting off', () => {
  test.use({ javaScriptEnabled: false });

  test('every scene is on the page in order, with the title block and the sources at the end', async ({ page }, testInfo) => {
    const watch = await openLesson(page, testInfo);
    await expect(page.locator('html')).not.toHaveClass(/lt-js/);
    await expect(page.locator('section.lt-scene:visible')).toHaveCount(example.total);
    await expect(page.locator('h1')).toHaveText(lesson.title);
    await expect(page.locator('.lt-objectives')).toBeVisible();
    const headings = await page.locator('section.lt-scene h2 .lt-scene-title').allTextContents();
    expect(headings).toEqual(lesson.scenes.map((s) => s.title));

    // The sources list is ordinary content at the end, not a closed dialog.
    const sources = page.locator('dialog#lt-sources');
    await expect(sources).toBeVisible();
    await expect(sources.locator('.lt-source-item:visible')).toHaveCount(lesson.evidence.length);
    await expect(sources.getByRole('link')).toHaveCount(lesson.evidence.length);
    await expect(sources).toContainText('it cannot tell whether an excerpt is genuine');
    const last = await page.locator('section.lt-scene').last().boundingBox();
    const box = await sources.boundingBox();
    expect(last && box && box.y > last.y + last.height - 1).toBe(true);

    // Nothing that needs the script is offered.
    for (const selector of ['#lt-pager', '#lt-theme', '#lt-opensources', '#lt-progress', '#lt-resume', '.lt-rail', '.lt-sources-close']) await expect(page.locator(selector), selector).toBeHidden();
    await expect(page.locator('button[data-copy]:visible')).toHaveCount(0);
    expect(new Set(watch.requests.map((r) => r.split('#')[0]))).toEqual(new Set([watch.url]));
    expect(watch.blocked).toEqual([]);
  });

  test('native controls still work: a source card, a takeaway, the contents list and its links', async ({ page }, testInfo) => {
    await openLesson(page, testInfo);
    const chip = page.locator(`#${sectionId(example.first)} button.lt-chip`).first();
    await chip.click();
    const card = page.locator(`[id="${await chip.getAttribute('popovertarget')}"]`);
    await expect(card).toBeVisible();
    // Unplaced, the card sits where the browser puts a popover: in the middle of the window.
    const box = await card.boundingBox();
    const view = page.viewportSize();
    expect(box && view && Math.abs(box.x + box.width / 2 - view.width / 2) < 12).toBe(true);
    await card.getByRole('button', { name: 'Close' }).click();
    await expect(card).toBeHidden();

    const reveal = page.locator(`#${sectionId(example.last)} details`).first();
    await reveal.locator('summary').click();
    await expect(reveal.locator('.lt-reveal-body')).toBeVisible();

    await page.getByRole('button', { name: 'Contents' }).click();
    const contents = page.locator('#lt-contents');
    await expect(contents).toBeVisible();
    await contents.locator('a').nth(4).click();
    expect(new URL(page.url()).hash).toBe(`#scene-${example.ids[4]}`);
    await expect(page.locator(`[id="scene-${example.ids[4]}"]`)).toBeInViewport();
    // A checkpoint link in the recap is an ordinary anchor too.
    const back = page.locator(`#${sectionId(example.last)} .lt-recap-checks a`).first();
    const href = await back.getAttribute('href');
    await back.click();
    expect(new URL(page.url()).hash).toBe(href);
  });

  test('the transcript fits a 320 pixel window', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openLesson(page, testInfo);
    const box = await page.locator('body').boundingBox();
    expect(box && box.width <= 320).toBe(true);
    for (const section of await page.locator('section.lt-scene, dialog#lt-sources, header.lt-top, footer.lt-foot').all()) {
      const b = await section.boundingBox();
      expect(b && b.x >= 0 && b.x + b.width <= 320.5).toBe(true);
    }
  });

  // Review finding P8: the box that holds a follow-up request did not shrink to the page, script or no script.
  test('the transcript still fits 320 pixels when a follow-up topic is one long word', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openLesson(page, testInfo, { published: withLongTopics() });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const requests = page.locator('.lt-request-text');
    await expect(requests).toHaveCount(LONG_TOPICS.length);
    for (const request of await requests.all()) {
      const b = await request.boundingBox();
      expect(b && b.x >= 0 && b.x + b.width <= 320.5).toBe(true);
    }
  });
});

test('if the script fails, the page falls back to the transcript and the failure is still reported', async ({ page }, testInfo) => {
  const watch = await openLesson(page, testInfo, {
    // The data element is emptied, as a truncated or hand-edited file might be. The script itself is untouched.
    mutate: (html) => html.replace(/(<script type="application\/json" id="lt-data">)[^<]*(<\/script>)/, '$1{$2'),
  });
  await expect(page.locator('html')).not.toHaveClass(/lt-js/);
  await expect(page.locator('section.lt-scene:visible')).toHaveCount(example.total);
  await expect(page.locator('dialog#lt-sources')).toBeVisible();
  await expect(page.locator('#lt-pager')).toBeHidden();
  await expect.poll(() => watch.pageErrors.length).toBe(1);
  expect(await watch.violations()).toEqual([]);
});

test('a file whose script has been altered does not run it, and the page is still the transcript', async ({ page }, testInfo) => {
  const watch = await openLesson(page, testInfo, {
    // One byte added to the script: its hash no longer matches the policy.
    mutate: (html) => html.replace('<script>', '<script>;'),
  });
  await expect(page.locator('html')).not.toHaveClass(/lt-js/);
  await expect(page.locator('section.lt-scene:visible')).toHaveCount(example.total);
  const violations = await watch.violations();
  expect(violations.length).toBe(1);
  expect(violations[0]?.directive.startsWith('script-src')).toBe(true);
});
