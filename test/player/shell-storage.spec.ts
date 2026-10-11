// Progress: what is stored, under which keys, how a returning learner is offered their place, what
// happens when storage is hostile or absent, and "clear my progress".
import { examplePublished } from '../helpers/example';
import { exampleScenes, expect, expectClean, expectFocus, openLesson, sectionId, test } from './shell-kit';

const example = exampleScenes();
const lesson = examplePublished().lesson;
const prefix = `lt:${lesson.id}:`;
const checkpoints = example.byKind('checkpoint');

const keys = (page: import('@playwright/test').Page): Promise<Record<string, string>> =>
  page.evaluate(() => Object.fromEntries(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) as string).map((k) => [k, localStorage.getItem(k) as string])));

test('everything it stores is under this lesson’s prefix, and nothing is stored just by opening the page', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo);
  expect(await keys(page)).toEqual({});
  await expect(page.locator('#lt-progress')).toBeVisible();
  await expect(page.locator('#lt-storenote')).toHaveText('Your place and your checkpoint results are kept in this browser only.');

  await page.locator('#lt-next').click();
  await page.locator('#lt-next').click();
  await page.locator('#lt-theme').click();
  const stored = await keys(page);
  expect(Object.keys(stored).sort()).toEqual([`${prefix}pos`, `${prefix}seen`, `${prefix}theme`]);
  expect(JSON.parse(stored[`${prefix}pos`] as string)).toBe(example.ids[2]);
  expect(JSON.parse(stored[`${prefix}seen`] as string)).toEqual(example.ids.slice(0, 3));
  await expectClean(watch, browserName);
});

test('a returning learner is offered their place, and the first scene is shown until they take it', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo);
  await expect(page.locator('#lt-resume')).toBeHidden();
  for (let i = 0; i < 4; i++) await page.locator('#lt-next').click();

  await page.goto(watch.url);
  await expect(page.locator(`#${sectionId(example.first)}`)).toBeVisible();
  const resume = page.locator('#lt-resume');
  await expect(resume).toBeVisible();
  await expect(resume).toContainText(`Last time you reached scene 5, “${lesson.scenes[4]?.title}”.`);
  // Looking at the first scene again has not thrown the place away.
  expect(JSON.parse((await keys(page))[`${prefix}pos`] as string)).toBe(example.ids[4]);
  // Scenes seen before are still marked on the rail.
  await expect(page.locator('.lt-rail .lt-rail-seen')).toHaveCount(5);

  await resume.getByRole('link', { name: 'Pick up where you left off' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(`#${sectionId(example.ids[4] as string)}`)).toBeVisible();
  await expectFocus(page, (f) => f.id === `scene-${example.ids[4]}`);
  await expect(resume).toBeHidden();
  await expectClean(watch, browserName);
});

test('stored results appear in the recap, and anything else found in storage is ignored', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo);
  expect(checkpoints.length).toBeGreaterThanOrEqual(2);
  await page.evaluate(
    ({ p, cps, firstScene }) => {
      const rev = (sceneId: string): string => document.querySelector<HTMLElement>(`section[data-scene="${sceneId}"]`)?.dataset.rev ?? 'none';
      // Two real results, then entries that name no checkpoint, a narration scene, a value that is
      // not a result, and a second entry for a scene already listed.
      localStorage.setItem(
        `${p}results`,
        JSON.stringify([
          [cps[0], 'correct', rev(cps[0] as string)],
          [cps[1], 'incorrect', rev(cps[1] as string)],
          ['no-such-scene', 'correct', 'none'],
          [firstScene, 'correct', rev(firstScene)],
          ['__proto__', 'correct', 'none'],
          [cps[0], 'incorrect', rev(cps[0] as string)],
          [cps[2] ?? 'x', '<img src=x onerror=alert(1)>', rev(cps[2] ?? 'x')],
        ]),
      );
    },
    { p: prefix, cps: checkpoints, firstScene: example.first },
  );
  await page.goto(`${watch.url}#/${example.last}`);
  await page.reload();
  const recap = page.locator(`#${sectionId(example.last)}`);
  await expect(recap.locator(`[data-result="${checkpoints[0]}"]`)).toHaveText('✓ Right on your first attempt');
  await expect(recap.locator(`[data-result="${checkpoints[0]}"]`)).toHaveAttribute('data-state', 'correct');
  await expect(recap.locator(`[data-result="${checkpoints[1]}"]`)).toHaveText('✗ Not right on your first attempt');
  for (const id of checkpoints.slice(2)) await expect(recap.locator(`[data-result="${id}"]`)).toHaveText('Not answered yet');
  await expect(recap.locator('img')).toHaveCount(0);
  await expectClean(watch, browserName);
});

test('garbage in storage never breaks the page', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo);
  await page.evaluate((p) => {
    localStorage.setItem(`${p}pos`, '{not json');
    localStorage.setItem(`${p}seen`, JSON.stringify({ length: 3 }));
    localStorage.setItem(`${p}results`, JSON.stringify('correct'));
    localStorage.setItem(`${p}theme`, JSON.stringify('<script>'));
    localStorage.setItem(`${p}rate`, JSON.stringify(99));
  }, prefix);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/lt-js/);
  await expect(page.locator(`#${sectionId(example.first)}`)).toBeVisible();
  await expect(page.locator('#lt-resume')).toBeHidden();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');

  await page.evaluate((p) => {
    localStorage.setItem(`${p}pos`, JSON.stringify('no-such-scene'));
    localStorage.setItem(`${p}seen`, JSON.stringify(['a', 1, null]));
    localStorage.setItem(`${p}results`, JSON.stringify([['x'], 'y', [1, 2]]));
    localStorage.setItem(`${p}theme`, 'x'.repeat(50_000));
  }, prefix);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/lt-js/);
  await expect(page.locator('#lt-resume')).toBeHidden();
  await page.locator('#lt-next').click();
  await expect(page.locator(`#${sectionId(example.ids[1] as string)}`)).toBeVisible();
  await expectClean(watch, browserName);
});

test('“Clear my progress” asks first, removes only this lesson’s keys, and starts again from the first scene', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo);
  await page.evaluate(() => {
    localStorage.setItem('lt:zzzzzzzzzzzz:pos', '"s3"');
    localStorage.setItem('unrelated', 'keep me');
  });
  await page.locator('#lt-next').click();
  await page.locator('#lt-next').click();
  await page.locator('#lt-theme').click();

  const clear = page.locator('#lt-clear');
  const confirm = page.locator('#lt-clearconfirm');
  await expect(confirm).toBeHidden();
  await clear.focus();
  await page.keyboard.press('Enter');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('This forgets your place and your results in this lesson.');
  await expect(clear).toBeHidden();
  // Focus goes to the safe choice.
  await expectFocus(page, (f) => f.id === 'lt-clearno');
  await page.keyboard.press('Enter');
  await expect(confirm).toBeHidden();
  await expectFocus(page, (f) => f.id === 'lt-clear');
  expect(Object.keys(await keys(page))).toContain(`${prefix}pos`);

  await page.keyboard.press('Enter');
  await page.locator('#lt-clearyes').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(`#${sectionId(example.first)}`)).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/lt-js/);
  expect(new URL(page.url()).hash).toBe('');
  expect(await keys(page)).toEqual({ 'lt:zzzzzzzzzzzz:pos': '"s3"', unrelated: 'keep me' });
  await expect(page.locator('#lt-resume')).toBeHidden();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expect(page.locator('.lt-rail .lt-rail-seen')).toHaveCount(1);
  await expectClean(watch, browserName);
});

test('when the browser refuses storage the lesson still works, and says that nothing is being kept', async ({ page, browserName }, testInfo) => {
  await page.addInitScript(() => {
    const refuse = (): never => {
      throw new DOMException('refused', 'SecurityError');
    };
    Storage.prototype.setItem = refuse;
    Storage.prototype.getItem = refuse;
    Storage.prototype.removeItem = refuse;
    Storage.prototype.key = refuse;
  });
  const watch = await openLesson(page, testInfo);
  await expect(page.locator('html')).toHaveClass(/lt-js/);
  await expect(page.locator('#lt-storenote')).toHaveText('This browser is not saving anything for this page, so your place and your results last only until you close it.');
  await page.locator('#lt-next').click();
  await expect(page.locator(`#${sectionId(example.ids[1] as string)}`)).toBeVisible();
  await page.locator('#lt-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);
  // Clearing still works: it resets the page.
  await page.locator('#lt-clear').click();
  await page.locator('#lt-clearyes').click();
  await expect(page.locator(`#${sectionId(example.first)}`)).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await expectClean(watch, browserName);
});

test('when localStorage itself cannot be reached the lesson still works', async ({ page, browserName }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  });
  const watch = await openLesson(page, testInfo);
  await expect(page.locator('html')).toHaveClass(/lt-js/);
  await page.locator('#lt-next').click();
  await expect(page.locator(`#${sectionId(example.ids[1] as string)}`)).toBeVisible();
  await expect(page.locator('#lt-storenote')).toContainText('not saving anything');
  await expectClean(watch, browserName);
});
