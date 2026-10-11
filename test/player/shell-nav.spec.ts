// Moving through a lesson with the keyboard alone: order of focus, where focus lands after each
// move, the page title, the address, history, and reload.
import { examplePublished } from '../helpers/example';
import { exampleScenes, expect, expectClean, focused, openLesson, sectionId, tab, tabTo, test } from './shell-kit';

const example = exampleScenes();
const lesson = examplePublished().lesson;
const title = (i: number): string => `Scene ${i + 1} of ${example.total}: ${lesson.scenes[i]?.title} – ${lesson.title}`;
const hash = (i: number): string => `#/${example.ids[i]}`;
const heading = (i: number): string => `scene-${example.ids[i]}`;

test('the skip link is the first stop and moves focus to the lesson without changing the address', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo);
  await tab(page, browserName);
  expect(await focused(page)).toMatchObject({ tag: 'A', text: 'Skip to the lesson' });
  await expect(page.locator('a.lt-skip')).toBeInViewport();
  await page.keyboard.press('Enter');
  expect((await focused(page)).id).toBe('lt-main');
  expect(new URL(page.url()).hash).toBe('');
  // The next Tab goes on into the lesson, and <main> does not stay focusable behind it.
  await tab(page, browserName);
  expect((await focused(page)).cls).toContain('lt-chip');
  await expect(page.locator('main')).not.toHaveAttribute('tabindex');
  await expectClean(watch, browserName);
});

test('focus follows reading order: tools, then the scene, then Back and Continue, then the footer', async ({ page, browserName }, testInfo) => {
  await openLesson(page, testInfo);
  const stops: string[] = [];
  for (let i = 0; i < 30; i++) {
    await tab(page, browserName);
    const f = await focused(page);
    if (f.tag === 'BODY' || (stops.length > 0 && f.cls === 'lt-skip')) break;
    stops.push(f.id || f.cls.split(' ')[0] || f.tag);
  }
  const chips = await page.locator(`#${sectionId(example.first)} button.lt-chip`).count();
  expect(chips).toBeGreaterThan(0);
  expect(stops.slice(0, 4)).toEqual(['lt-skip', 'lt-tool', 'lt-opensources', 'lt-theme']);
  expect(stops.slice(4, 4 + chips)).toEqual(Array(chips).fill('lt-chip'));
  expect(stops.slice(4 + chips)).toEqual(['lt-back', 'lt-next', 'lt-clear']);
});

test('Continue and Back by keyboard: the scene changes, focus lands on its heading, and the title and address follow', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo);
  await expect(page).toHaveTitle(title(0));
  await expect(page.locator('#lt-back')).toHaveAttribute('aria-disabled', 'true');

  await tabTo(page, browserName, (f) => f.id === 'lt-next');
  await page.keyboard.press('Enter');
  await expect(page.locator(`#${sectionId(example.ids[1] as string)}`)).toBeVisible();
  await expect(page.locator(`#${sectionId(example.first)}`)).toBeHidden();
  expect((await focused(page)).id).toBe(heading(1));
  await expect(page).toHaveTitle(title(1));
  expect(new URL(page.url()).hash).toBe(hash(1));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('#lt-back')).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('#lt-upnext')).toHaveText(`Next: ${lesson.scenes[2]?.title}`);

  // Space works as well as Enter.
  await tabTo(page, browserName, (f) => f.id === 'lt-next');
  await page.keyboard.press('Space');
  expect((await focused(page)).id).toBe(heading(2));
  expect(new URL(page.url()).hash).toBe(hash(2));

  await tabTo(page, browserName, (f) => f.id === 'lt-back');
  await page.keyboard.press('Enter');
  expect((await focused(page)).id).toBe(heading(1));
  await expect(page).toHaveTitle(title(1));
  await expect(page.locator('section.lt-scene:visible')).toHaveCount(1);
  await expectClean(watch, browserName);
});

test('the browser’s Back and Forward return to the scene with focus on its heading, and a reload keeps it', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo);
  await page.locator('#lt-next').click();
  await page.locator('#lt-next').click();
  expect(new URL(page.url()).hash).toBe(hash(2));

  await page.goBack();
  await expect(page.locator(`#${sectionId(example.ids[1] as string)}`)).toBeVisible();
  expect((await focused(page)).id).toBe(heading(1));
  await expect(page).toHaveTitle(title(1));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.goBack();
  await expect(page.locator(`#${sectionId(example.first)}`)).toBeVisible();
  expect((await focused(page)).id).toBe(heading(0));
  expect(new URL(page.url()).hash).toBe('');

  await page.goForward();
  await page.goForward();
  await expect(page.locator(`#${sectionId(example.ids[2] as string)}`)).toBeVisible();
  expect((await focused(page)).id).toBe(heading(2));

  await page.reload();
  await expect(page.locator(`#${sectionId(example.ids[2] as string)}`)).toBeVisible();
  await expect(page.locator('section.lt-scene:visible')).toHaveCount(1);
  await expect(page).toHaveTitle(title(2));
  expect(new URL(page.url()).hash).toBe(hash(2));
  await expectClean(watch, browserName);
});

test('Back is inert on the first scene and Continue on the last, and both stay focusable', async ({ page, browserName }, testInfo) => {
  await openLesson(page, testInfo);
  await tabTo(page, browserName, (f) => f.id === 'lt-back');
  await page.keyboard.press('Enter');
  await expect(page.locator(`#${sectionId(example.first)}`)).toBeVisible();
  expect((await focused(page)).id).toBe('lt-back');

  await page.goto(`${page.url().split('#')[0]}#/${example.last}`);
  await page.reload();
  await expect(page.locator(`#${sectionId(example.last)}`)).toBeVisible();
  await expect(page.locator('#lt-next')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#lt-upnext')).toHaveText('This is the last scene.');
  await tabTo(page, browserName, (f) => f.id === 'lt-next', 80);
  await page.keyboard.press('Enter');
  await expect(page.locator(`#${sectionId(example.last)}`)).toBeVisible();
  expect((await focused(page)).id).toBe('lt-next');
});

test('the contents list opens from the keyboard, marks the current scene, and jumps to any scene', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo, { hash: hash(1) });
  await tabTo(page, browserName, (f) => f.text === 'Contents');
  await page.keyboard.press('Enter');
  const contents = page.locator('#lt-contents');
  await expect(contents).toBeVisible();
  expect((await focused(page)).text).toBe('Contents');
  await expect(contents.locator('a[aria-current="step"]')).toHaveCount(1);
  await expect(contents.locator('a[aria-current="step"]')).toHaveAttribute('data-goto', example.ids[1] as string);
  await expect(contents.locator('a')).toHaveCount(example.total);

  // Tab goes into the list next; the fourth link is three more presses on.
  for (let i = 0; i < 4; i++) await tab(page, browserName);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-goto'))).toBe(example.ids[3]);
  await page.keyboard.press('Enter');
  await expect(contents).toBeHidden();
  await expect(page.locator(`#${sectionId(example.ids[3] as string)}`)).toBeVisible();
  expect((await focused(page)).id).toBe(heading(3));
  expect(new URL(page.url()).hash).toBe(hash(3));

  // Escape closes it and gives focus back to the button.
  await page.getByRole('button', { name: 'Contents' }).focus();
  await page.keyboard.press('Enter');
  await expect(contents).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(contents).toBeHidden();
  expect((await focused(page)).text).toBe('Contents');
  await expectClean(watch, browserName);
});

test('an address in the anchor form opens that scene at the top and is rewritten; an unknown one opens the first', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo, { hash: `#scene-${example.ids[3]}` });
  await expect(page.locator(`#${sectionId(example.ids[3] as string)}`)).toBeVisible();
  await expect(page.locator('section.lt-scene:visible')).toHaveCount(1);
  expect(new URL(page.url()).hash).toBe(hash(3));
  await page.waitForLoadState('load');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.goto(`${watch.url}#/no-such-scene`);
  await page.reload();
  await expect(page.locator(`#${sectionId(example.first)}`)).toBeVisible();
  await page.goto(`${watch.url}#lt-data`);
  await page.reload();
  await expect(page.locator(`#${sectionId(example.first)}`)).toBeVisible();
  await expectClean(watch, browserName);
});

test('the header shows the title block on the first scene and a running head after it', async ({ page }, testInfo) => {
  await openLesson(page, testInfo);
  await expect(page.locator('html')).not.toHaveClass(/lt-compact/);
  await expect(page.locator('.lt-objectives')).toBeVisible();
  await expect(page.locator('h1')).toHaveText(lesson.title);
  const big = await page.locator('h1').evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));

  await page.locator('#lt-next').click();
  await expect(page.locator('html')).toHaveClass(/lt-compact/);
  await expect(page.locator('.lt-objectives')).toBeHidden();
  await expect(page.locator('h1')).toBeVisible();
  const small = await page.locator('h1').evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(small).toBeLessThan(big / 2);

  // The rail shows where you are: one current segment, and the ones already seen.
  await expect(page.locator('.lt-rail li')).toHaveCount(example.total);
  await expect(page.locator('.lt-rail .lt-rail-current')).toHaveCount(1);
  await expect(page.locator('.lt-rail li').nth(1)).toHaveClass(/lt-rail-current/);
  await expect(page.locator('.lt-rail li').nth(0)).toHaveClass(/lt-rail-seen/);
  await expect(page.locator('.lt-rail')).toHaveAttribute('aria-hidden', 'true');
});

test('a link inside the page that names a scene goes there', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo, { hash: `#/${example.last}` });
  const link = page.locator(`#${sectionId(example.last)} .lt-recap-checks a`).first();
  const target = await link.getAttribute('data-goto');
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(`#${sectionId(target as string)}`)).toBeVisible();
  expect((await focused(page)).id).toBe(`scene-${target}`);
  expect(new URL(page.url()).hash).toBe(`#/${target}`);
  await page.goBack();
  await expect(page.locator(`#${sectionId(example.last)}`)).toBeVisible();
  await expectClean(watch, browserName);
});
