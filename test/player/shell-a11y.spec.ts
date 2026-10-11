// axe-core over every scene and every state the shell can be in. axe has no rule for reflow, focus
// order, focus visibility or status messages; those are covered by the other shell specs.
import AxeBuilder from '@axe-core/playwright';
import { examplePublished, exampleReceipt } from '../helpers/example';
import { exampleScenes, expect, openLesson, sectionId, seedResults, test, withSilentAudio } from './shell-kit';

const example = exampleScenes();
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

type P = import('@playwright/test').Page;

/**
 * While a card or a dialog is open in the top layer, axe cannot work out the background of text
 * that lies under it or of text in it that lies over other text, and says so. Those two answers are
 * accepted in that state only; the colour pairs involved are held to 4.5:1 by the token test.
 */
const OVERLAP = new Set(['bgOverlap', 'elmPartiallyObscuring']);

async function audit(page: P, state: string, opts: { overlay?: boolean } = {}): Promise<void> {
  // A scene fades in. Measured halfway through, its text has less contrast than it will have.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const violations = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(violations, `${state}: violations`).toEqual([]);
  // Contrast that axe could not decide is treated as a failure, not as a pass.
  const undecided = results.incomplete
    .filter((r) => r.id === 'color-contrast')
    .flatMap((r) => r.nodes)
    .filter((n) => !(opts.overlay && n.any.every((check) => OVERLAP.has(String((check.data as { messageKey?: string } | undefined)?.messageKey)))))
    .map((n) => `${n.target.join(' ')}: ${n.any.map((check) => check.message).join('; ')}`);
  expect(undecided, `${state}: contrast axe could not decide`).toEqual([]);
  expect(results.passes.length, `${state}: rules that ran`).toBeGreaterThan(20);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('every scene passes', async ({ page }, testInfo) => {
      await openLesson(page, testInfo);
      for (const id of example.ids) {
        await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), id);
        await expect(page.locator(`#${sectionId(id)}`)).toBeVisible();
        await audit(page, `scene ${id}`);
      }
    });

    test('a source card, the contents list and the sources dialog pass while open', async ({ page }, testInfo) => {
      const published = examplePublished({ receipt: exampleReceipt({ weakClaims: [`${example.first}/blocks[1]`, `${example.first}/blocks[0]`, `${example.first}/blocks[2]`], warnings: { SINGLE_HOST: 1 } }) });
      await openLesson(page, testInfo, { published });
      await page.locator(`#${sectionId(example.first)} button.lt-chip`).first().click();
      await expect(page.locator('.lt-source.lt-placed:popover-open')).toHaveCount(1);
      await audit(page, 'source card open', { overlay: true });
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Contents' }).click();
      await expect(page.locator('#lt-contents')).toBeVisible();
      await audit(page, 'contents open', { overlay: true });
      await page.keyboard.press('Escape');

      await page.locator('#lt-opensources').click();
      await expect(page.locator('dialog#lt-sources')).toBeVisible();
      await audit(page, 'sources dialog open', { overlay: true });
    });

    test('the recap passes with takeaways open, results shown and the clear question asked', async ({ page }, testInfo) => {
      const published = examplePublished();
      const watch = await openLesson(page, testInfo, { published });
      const checkpoints = example.byKind('checkpoint');
      await seedResults(
        page,
        published.lesson.id,
        checkpoints.map((id, i) => [id, i % 2 === 0 ? 'correct' : 'incorrect'] as const),
      );
      await page.goto(`${watch.url}#/${example.last}`);
      await page.reload();
      for (const summary of await page.locator(`#${sectionId(example.last)} details > summary`).all()) await summary.click();
      await page.locator('#lt-clear').click();
      await expect(page.locator('#lt-clearconfirm')).toBeVisible();
      await audit(page, 'recap');
    });

    test('the narration controls pass, idle and while reading', async ({ page }, testInfo) => {
      await openLesson(page, testInfo, { published: withSilentAudio([example.first]) });
      await expect(page.locator('#lt-audiobar')).toBeVisible();
      await audit(page, 'narration idle');
      await page.locator('#lt-play').click();
      await expect(page.locator('#lt-play')).toHaveText('Pause');
      await audit(page, 'narration reading');
    });
  });
}

test.describe('at 320 pixels wide', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test('every scene, a source card and the dialog pass', async ({ page }, testInfo) => {
    await openLesson(page, testInfo);
    for (const id of example.ids) {
      await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), id);
      await expect(page.locator(`#${sectionId(id)}`)).toBeVisible();
      await audit(page, `320px scene ${id}`);
    }
    await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), example.first);
    await page.locator(`#${sectionId(example.first)} button.lt-chip`).first().click();
    await expect(page.locator('.lt-source.lt-placed:popover-open')).toHaveCount(1);
    await audit(page, '320px source card', { overlay: true });
    await page.keyboard.press('Escape');
    await page.locator('#lt-opensources').click();
    await audit(page, '320px sources dialog', { overlay: true });
  });
});

test.describe('with more contrast asked for', () => {
  test.use({ contrast: 'more' });
  test('the first scene and the dialog pass', async ({ page }, testInfo) => {
    await openLesson(page, testInfo);
    await audit(page, 'more contrast');
    await page.locator('#lt-opensources').click();
    await audit(page, 'more contrast, dialog', { overlay: true });
  });
});

test('a lesson in another language passes: interface words are marked as English', async ({ page }, testInfo) => {
  const published = examplePublished();
  published.lesson.language = 'pt-BR';
  await openLesson(page, testInfo, { published });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await audit(page, 'pt-BR');
});
