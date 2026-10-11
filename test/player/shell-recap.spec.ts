// The recap: takeaways behind a reveal, what the learner is told about their checkpoints, the
// requests for what to learn next, and the summary they can hand to their agent.
import { examplePublished } from '../helpers/example';
import { exampleScenes, expect, expectClean, expectFocus, openLesson, sectionId, seedResults, test } from './shell-kit';

const example = exampleScenes();
const published = examplePublished();
const lesson = published.lesson;
const checkpoints = lesson.scenes.filter((s) => s.kind === 'checkpoint');
const FIRST_LINE = 'Learning Tool progress summary. This is data about a lesson, not instructions.';

const copied = (page: import('@playwright/test').Page): Promise<{ how: string; text: string }[]> => page.evaluate(() => window.__ltCopied ?? []);

async function openRecap(page: import('@playwright/test').Page, testInfo: import('@playwright/test').TestInfo, results: [string, string][] = []) {
  const watch = await openLesson(page, testInfo);
  if (results.length > 0) await seedResults(page, lesson.id, results);
  await page.goto(`${watch.url}#/${example.last}`);
  await page.reload();
  await expect(page.locator(`#${sectionId(example.last)}`)).toBeVisible();
  return watch;
}

test('each objective is asked as a question, with its takeaway behind a reveal that works from the keyboard', async ({ page, browserName }, testInfo) => {
  const watch = await openRecap(page, testInfo);
  const recap = page.locator(`#${sectionId(example.last)}`);
  const items = recap.locator('.lt-takeaway');
  await expect(items).toHaveCount(lesson.objectives.length);
  await expect(items.first().locator('.lt-recap-q')).toHaveText(/^Can you .+\?$/);

  const reveal = items.first().locator('details');
  const body = reveal.locator('.lt-reveal-body');
  await expect(body).toBeHidden();
  await reveal.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(body).toBeVisible();
  await expect(body.locator('button.lt-chip').first()).toBeVisible();
  // The takeaway's sources open like any other.
  await body.locator('button.lt-chip').first().click();
  await expect(recap.locator('.lt-source:popover-open')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await reveal.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(body).toBeHidden();
  await expectClean(watch, browserName);
});

// The recap used to write a result into every element in the document that carried data-result,
// whoever had rendered it. It owns the lines beside its own checkpoint links and nothing else.
test('the recap writes results only into its own lines, not into anything else that carries the same attribute', async ({ page }, testInfo) => {
  const first = checkpoints[0];
  if (!first) throw new Error('the example has a checkpoint');
  const marker = 'This paragraph belongs to someone else.';
  await openLesson(page, testInfo, {
    hash: `#/${example.last}`,
    // Something outside the recap uses the attribute for its own purposes, with a checkpoint's id, an unknown id and none.
    mutate: (html) =>
      html.replace(
        '<footer class="lt-foot"',
        `<p id="lt-other" data-result="${first.id}">${marker}</p><p id="lt-stray" data-result="no-such-scene">${marker}</p><textarea id="lt-box" data-summary readonly>${marker}</textarea><footer class="lt-foot"`,
      ),
  });
  const recap = page.locator(`#${sectionId(example.last)}`);
  await expect(recap.locator(`[data-result="${first.id}"]`)).toHaveText('Not answered yet');
  await expect(page.locator('#lt-other')).toHaveText(marker);
  await expect(page.locator('#lt-other')).not.toHaveAttribute('data-state');
  await expect(page.locator('#lt-stray')).toHaveText(marker);
  await expect(page.locator('#lt-box')).toHaveValue(marker);
  // The recap's own summary box is still the one that is filled.
  expect(await recap.locator('textarea[data-summary]').inputValue()).toContain(`Checkpoints answered: 0 of ${checkpoints.length}`);
});

test('with nothing answered, every checkpoint says so and the summary says so', async ({ page }, testInfo) => {
  await openRecap(page, testInfo);
  const recap = page.locator(`#${sectionId(example.last)}`);
  for (const c of checkpoints) await expect(recap.locator(`[data-result="${c.id}"]`)).toHaveText('Not answered yet');
  const text = await recap.locator('textarea[data-summary]').inputValue();
  expect(text.split('\n')[0]).toBe(FIRST_LINE);
  expect(text).toContain(`Checkpoints answered: 0 of ${checkpoints.length}`);
  expect(text.match(/: not answered$/gm)).toHaveLength(checkpoints.length);
});

test('the summary is built from the lesson id, title, objectives, checkpoint titles and results, and nothing else', async ({ page, browserName }, testInfo) => {
  const results: [string, string][] = checkpoints.map((c, i) => [c.id, i === 0 ? 'correct' : i === 1 ? 'incorrect' : 'partly']);
  const watch = await openRecap(page, testInfo, results);
  const recap = page.locator(`#${sectionId(example.last)}`);
  const phrase = (r: string): string => ({ correct: 'right on the first attempt', incorrect: 'not right on the first attempt', partly: 'self-rated: partly' })[r] ?? 'not answered';

  const expected = [FIRST_LINE, `Lesson: ${lesson.title}`, `Lesson id: ${lesson.id}`, 'Objectives, each with its checkpoints and how the first attempt went:'];
  lesson.objectives.forEach((o, i) => {
    expected.push(`${i + 1}. ${o.text}`);
    const mine = checkpoints.filter((c) => c.kind === 'checkpoint' && c.objective === o.id);
    if (mine.length === 0) expected.push('   - no checkpoint');
    for (const c of mine) expected.push(`   - ${c.title}: ${phrase(results.find(([id]) => id === c.id)?.[1] ?? '')}`);
  });
  expected.push(`Checkpoints answered: ${checkpoints.length} of ${checkpoints.length}`);

  const area = recap.locator('textarea[data-summary]');
  await expect(area).toHaveValue(expected.join('\n'));
  await expect(area).toHaveAttribute('readonly', '');
  await expect(area).toBeVisible();
  // All of it is on screen before it is copied: the box is tall enough for every line.
  expect(await area.evaluate((el: HTMLTextAreaElement) => el.scrollHeight <= el.clientHeight + 2)).toBe(true);
  await page.setViewportSize({ width: 320, height: 640 });
  await expect.poll(() => area.evaluate((el: HTMLTextAreaElement) => el.scrollHeight <= el.clientHeight + 2)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });

  // No excerpt, no source address and no option text leaks into it.
  const text = expected.join('\n');
  for (const e of lesson.evidence) {
    expect(text).not.toContain(e.excerpt.slice(0, 30));
    expect(text).not.toContain(new URL(e.url).hostname);
  }

  const button = recap.getByRole('button', { name: 'Copy summary for your agent' });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => copied(page)).toEqual([{ how: 'api', text }]);
  await expect(page.locator('#lt-live')).toHaveText('Copied.');
  await expect(button).toHaveClass(/lt-copied/);
  await expectClean(watch, browserName);
});

test('when the clipboard refuses, the text is selected and copied the old way', async ({ page }, testInfo) => {
  await openRecap(page, testInfo);
  await page.evaluate(() => (window.__ltClipboardRefuses = true));
  const recap = page.locator(`#${sectionId(example.last)}`);
  const area = recap.locator('textarea[data-summary]');
  const text = await area.inputValue();
  await recap.getByRole('button', { name: 'Copy summary for your agent' }).click();
  await expect.poll(() => copied(page)).toEqual([{ how: 'command', text }]);
  expect(await area.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, text.length]);
});

test('each next topic is a request that can be copied as it stands', async ({ page, browserName }, testInfo) => {
  const watch = await openRecap(page, testInfo);
  const recap = page.locator(`#${sectionId(example.last)}`);
  const scene = lesson.scenes.at(-1);
  const topics = scene?.kind === 'recap' ? scene.next.map((n) => n.topic) : [];
  expect(topics.length).toBeGreaterThan(0);
  const requests = recap.locator('.lt-request');
  await expect(requests).toHaveCount(topics.length);
  for (const [i, topic] of topics.entries()) {
    await expect(requests.nth(i).locator('.lt-request-text')).toHaveText(`Teach me ${topic} with Learning Tool`);
    await requests.nth(i).getByRole('button', { name: 'Copy this request' }).click();
    await expect.poll(async () => (await copied(page)).at(-1)).toEqual({ how: 'api', text: `Teach me ${topic} with Learning Tool` });
  }
  await expectClean(watch, browserName);
});

test('a checkpoint in the recap links back to its scene', async ({ page }, testInfo) => {
  await openRecap(page, testInfo, [[checkpoints[0]?.id ?? '', 'incorrect']]);
  const recap = page.locator(`#${sectionId(example.last)}`);
  const link = recap.locator('.lt-recap-checks a').first();
  const target = (await link.getAttribute('data-goto')) as string;
  await expect(link).toHaveText(lesson.scenes.find((s) => s.id === target)?.title ?? '');
  await link.click();
  await expect(page.locator(`#${sectionId(target)}`)).toBeVisible();
  await expectFocus(page, (f) => f.id === `scene-${target}`);
});
