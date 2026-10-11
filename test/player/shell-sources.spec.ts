// Source chips, the card each one opens, and the sources dialog: keyboard behaviour, where focus
// goes, where the card is put, and what it says.
import { sourceLink } from '../../src/render/escape';
import { WEAK_MATCH_LINE } from '../../src/render/sources';
import { examplePublished, exampleReceipt } from '../helpers/example';
import { exampleScenes, expect, expectClean, expectFocus, focused, openLesson, sectionId, tab, tabTo, test } from './shell-kit';

const example = exampleScenes();
const first = `#${sectionId(example.first)}`;

test('a chip opens its card with Enter; focus stays on the chip, Tab goes inside, Escape closes and returns focus', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo);
  const chip = page.locator(`${first} button.lt-chip`).first();
  const target = await chip.getAttribute('popovertarget');
  await expect(chip).toHaveAttribute('aria-label', /^Source \d+: [a-z0-9.-]+$/);

  await tabTo(page, browserName, (f) => f.cls.includes('lt-chip'));
  await page.keyboard.press('Enter');
  const card = page.locator(`[id="${target}"]`);
  await expect(card).toBeVisible();
  expect(await card.evaluate((el) => el.matches(':popover-open'))).toBe(true);
  expect((await focused(page)).cls).toContain('lt-chip');
  await expect(chip).toHaveClass(/lt-chip-open/);
  await expect(card).toHaveClass(/lt-placed/);

  // The card is the next thing in the tab order: first its link, then its Close button.
  await tab(page, browserName);
  expect(await page.evaluate((id) => document.getElementById(id as string)?.contains(document.activeElement), target)).toBe(true);
  expect((await focused(page)).tag).toBe('A');
  await tab(page, browserName);
  expect(await focused(page)).toMatchObject({ tag: 'BUTTON', text: 'Close' });

  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expectFocus(page, (f) => f.cls.includes('lt-chip'), 'focus back on the chip');
  await expect(chip).not.toHaveClass(/lt-chip-open/);

  // Space opens it too, and the Close button inside closes it and hands focus back.
  await page.keyboard.press('Space');
  await expect(card).toBeVisible();
  await tab(page, browserName);
  await tab(page, browserName);
  expect(await focused(page)).toMatchObject({ tag: 'BUTTON', text: 'Close' });
  await page.keyboard.press('Enter');
  await expect(card).toBeHidden();
  await expectFocus(page, (f) => f.cls.includes('lt-chip'), 'focus back on the chip');

  // With a pointer the Close button closes it as well. (Safari does not focus a button that is
  // clicked, so where focus rests afterwards is the browser's own business.)
  await chip.click();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(card).toBeHidden();
  await expectClean(watch, browserName);
});

test('the card says where the excerpt is from and links to the passage in a new tab', async ({ page }, testInfo) => {
  const published = examplePublished();
  await openLesson(page, testInfo, { published });
  const chip = page.locator(`${first} button.lt-chip`).first();
  const number = Number(await chip.textContent());
  const evidence = published.lesson.evidence[number - 1];
  expect(evidence).toBeDefined();
  if (!evidence) return;
  const link = sourceLink(evidence);

  await chip.click();
  const card = page.locator(`${first} .lt-source:popover-open`);
  await expect(card.locator('.lt-source-kicker')).toHaveText(`Source ${number}`);
  await expect(card.getByRole('heading')).toHaveText(new URL(evidence.url).hostname);
  await expect(card.locator('.lt-source-title')).toHaveText(evidence.title);
  await expect(card.locator('.lt-source-saved')).toContainText('Excerpt saved by your agent on ');
  await expect(card.locator('blockquote')).toHaveText(evidence.excerpt);
  const a = card.getByRole('link');
  await expect(a).toHaveAttribute('href', link?.url.href ?? '');
  await expect(a).toHaveAttribute('target', '_blank');
  await expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(a).toHaveAccessibleName('Open the source at this passage (opens in a new tab)');
  await expect(card.locator('.lt-source-url')).toHaveText(link?.shown ?? '');
  await expect(card).toHaveAttribute('role', 'group');
  await expect(card).toHaveAccessibleName(new URL(evidence.url).hostname);
});

for (const width of [1280, 320]) {
  test(`at ${width}px a card opens next to its chip and inside the page`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 700 });
    await openLesson(page, testInfo);
    for (const sceneId of example.ids.slice(0, 5)) {
      await page.evaluate((id) => (location.hash = `#/${id}`), sceneId);
      const chips = page.locator(`#${sectionId(sceneId)} button.lt-chip:visible`);
      const n = await chips.count();
      for (let i = 0; i < n; i++) {
        const chip = chips.nth(i);
        await chip.scrollIntoViewIfNeeded();
        await chip.click();
        const card = page.locator(`#${sectionId(sceneId)} .lt-source.lt-placed:popover-open`);
        await expect(card).toHaveCount(1);
        const c = await chip.boundingBox();
        const b = await card.boundingBox();
        expect(c && b).toBeTruthy();
        if (!c || !b) continue;
        // Directly below the chip, or directly above it, and never over it.
        const below = Math.abs(b.y - (c.y + c.height + 8)) <= 2;
        const above = Math.abs(b.y + b.height - (c.y - 8)) <= 2;
        expect(below || above, `card at ${b.y}, chip at ${c.y}`).toBe(true);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        // All of it can be reached: its last control scrolls into the window.
        await card.getByRole('button', { name: 'Close' }).scrollIntoViewIfNeeded();
        await expect(card.getByRole('button', { name: 'Close' })).toBeInViewport({ ratio: 1 });
        await page.keyboard.press('Escape');
        await expect(card).toHaveCount(0);
      }
    }
  });
}

test('only one card is open at a time, and a click elsewhere closes it', async ({ page }, testInfo) => {
  const published = examplePublished();
  // The first claim of the first scene is made to cite two sources, so there are two chips side by side.
  const scene = published.lesson.scenes[0];
  const claim = scene?.kind === 'narration' ? scene.blocks.find((b) => b.type === 'claim') : undefined;
  if (claim?.type === 'claim') claim.cites = published.lesson.evidence.slice(0, 2).map((e) => e.id);
  await openLesson(page, testInfo, { published });
  const chips = page.locator(`${first} button.lt-chip`);
  expect(await chips.count()).toBeGreaterThanOrEqual(2);
  await chips.nth(0).click();
  await expect(page.locator('.lt-source:popover-open')).toHaveCount(1);
  await chips.nth(1).click();
  await expect(page.locator('.lt-source:popover-open')).toHaveCount(1);
  await expect(page.locator('.lt-source:popover-open')).toHaveAttribute('id', (await chips.nth(1).getAttribute('popovertarget')) as string);
  await page.locator('h2:visible').click();
  await expect(page.locator('.lt-source:popover-open')).toHaveCount(0);
});

test('a weak-match claim says so in its card, in plain words, and nowhere else', async ({ page }, testInfo) => {
  const published = examplePublished();
  const scene = published.lesson.scenes[0];
  const at = scene?.kind === 'narration' ? scene.blocks.findIndex((b) => b.type === 'claim') : -1;
  expect(at).toBeGreaterThanOrEqual(0);
  published.receipt = exampleReceipt({ weakClaims: [`${example.first}/blocks[${at}]`] });
  await openLesson(page, testInfo, { published });
  await page.locator(`${first} .lt-claim button.lt-chip`).first().click();
  await expect(page.locator('.lt-source:popover-open .lt-source-weak')).toHaveText(WEAK_MATCH_LINE);
  await page.keyboard.press('Escape');
  await page.locator('#lt-opensources').click();
  await expect(page.locator('dialog#lt-sources')).not.toContainText(WEAK_MATCH_LINE);
  await expect(page.locator('dialog#lt-sources')).toContainText('1 claim shares few words with the excerpt cited for it.');
});

test('the sources dialog is modal: it takes focus, blocks the page behind it, closes with Escape and returns focus', async ({ page, browserName }, testInfo) => {
  const published = examplePublished();
  const watch = await openLesson(page, testInfo, { published });
  const opener = page.locator('#lt-opensources');
  await expect(opener).toHaveText(new RegExp(`^Sources\\s*${published.lesson.evidence.length}$`));
  await tabTo(page, browserName, (f) => f.id === 'lt-opensources');
  await page.keyboard.press('Enter');

  const dialog = page.locator('dialog#lt-sources');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.matches(':modal'))).toBe(true);
  await expect(dialog).toHaveAccessibleName('Sources');
  expect(await page.evaluate(() => document.querySelector('dialog#lt-sources')?.contains(document.activeElement))).toBe(true);
  await expect(dialog.locator('.lt-source-item')).toHaveCount(published.lesson.evidence.length);
  await expect(dialog.getByRole('link')).toHaveCount(published.lesson.evidence.length);

  // The page behind is inert: a click on Continue does not get through.
  await expect(page.locator('#lt-next').click({ timeout: 600 })).rejects.toThrow();
  await expect(page.locator(first)).toBeVisible();

  // Focus cannot leave the dialog by tabbing.
  for (let i = 0; i < 30; i++) {
    await tab(page, browserName);
    const inside = await page.evaluate(() => {
      const a = document.activeElement;
      return a === document.body || a === document.documentElement || document.querySelector('dialog#lt-sources')?.contains(a) === true;
    });
    expect(inside).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expectFocus(page, (f) => f.id === 'lt-opensources', 'focus back on the Sources button');

  // The Close button closes it too, and focus comes back the same way.
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expectFocus(page, (f) => f.id === 'lt-opensources', 'focus back on the Sources button');

  // With a pointer: the Close button, and a click on the backdrop.
  await opener.click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await opener.click();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
  // A click on the text inside does not close it.
  await opener.click();
  await dialog.locator('.lt-sources-limit').click();
  await expect(dialog).toBeVisible();
  await expectClean(watch, browserName);
});

test('the dialog states the limit and shows the receipt', async ({ page }, testInfo) => {
  const published = examplePublished({ receipt: exampleReceipt({ warnings: { SINGLE_HOST: 1 } }) });
  await openLesson(page, testInfo, { published });
  await page.locator('#lt-opensources').click();
  const dialog = page.locator('dialog#lt-sources');
  await expect(dialog.locator('.lt-sources-limit')).toContainText('it cannot tell whether an excerpt is genuine or whether it supports the claim');
  const receipt = dialog.locator('.lt-receipt');
  await expect(receipt.getByRole('heading')).toHaveText('What was checked');
  await expect(receipt).toContainText(`rules version ${published.receipt.rules}`);
  await expect(receipt).toContainText('SINGLE_HOST 1 time');
  await expect(receipt).toContainText(published.receipt.hash);
  expect(await page.locator('body').innerText()).not.toMatch(/verif/i);
});
