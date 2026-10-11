// A step-through scene driven with the keyboard alone, in both engines: one step at a time, the
// figure's highlight, the values panel, the predict question that holds a step back, what the
// scene's one status region says, where focus is, and what the narration is told.
import type { Page } from '@playwright/test';
import type { StepThroughScene } from '../../src/core/schema';
import { examplePublished } from '../helpers/example';
import { active, choose, lessonWith, record, scene, seen, statusOf, stored, tabUntil } from './questions-kit';
import { expect, expectClean, openLesson, tab, test, withSilentAudio } from './shell-kit';

const lesson = examplePublished().lesson;
const STEPS = lesson.scenes.find((s): s is StepThroughScene => s.kind === 'step_through') as StepThroughScene;
const id = STEPS.id;
const total = STEPS.steps.length;
/** 1-based number of the step that carries the predict question. */
const ASK = STEPS.steps.findIndex((s) => s.predict) + 1;
const predict = STEPS.steps[ASK - 1]?.predict as NonNullable<StepThroughScene['steps'][number]['predict']>;
const rightOption = predict.options.findIndex((o) => o.correct);
const wrongOption = predict.options.findIndex((o) => !o.correct);
const step = (n: number) => STEPS.steps[n - 1] as StepThroughScene['steps'][number];

const s = (page: Page) => page.locator(scene(id));
const shownSteps = (page: Page): Promise<string[]> => s(page).locator('li.lt-step:visible').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.step ?? ''));
/** The figure parts that carry the highlight, sorted: the figure decides their order in the page, the step the order they are named in. */
const highlighted = (page: Page): Promise<string[]> => s(page).locator('.lt-figure [data-part][data-hl="true"]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.part ?? '').sort());
const marks = (n: number): string[] => [...step(n).highlight].sort();
/** The values panel as "label value" strings, with a trailing "*" on the rows marked as changed. */
const panel = (page: Page): Promise<string[]> =>
  s(page)
    .locator('[data-state-panel] .lt-state-row')
    .evaluateAll((rows) => rows.map((row) => `${row.querySelector('dt')?.textContent} ${row.querySelector('.lt-state-value')?.textContent}${row.hasAttribute('data-changed') ? '*' : ''}`));
const rowsOf = (n: number, marks: (label: string) => boolean = () => false): string[] => (step(n).state ?? []).map((r) => `${r.label} ${r.value}${marks(r.label) ? '*' : ''}`);
const nextButton = (page: Page) => s(page).locator('button[data-step-go="next"]');
const prevButton = (page: Page) => s(page).locator('button[data-step-go="prev"]');

test('the example has what these tests need', () => {
  expect(total).toBeGreaterThanOrEqual(4);
  expect(ASK).toBeGreaterThan(1);
  expect(ASK).toBeLessThan(total);
  expect(step(1).state?.length).toBeGreaterThan(0);
  expect(step(ASK - 1).state?.length).toBeGreaterThan(0);
});

test('one step is on show, under two named buttons and one status region that holds the counter', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo, { hash: `#/${id}` });
  expect(await shownSteps(page)).toEqual(['1']);
  const nav = page.getByRole('group', { name: 'Steps' });
  await expect(nav.getByRole('button', { name: 'Previous step' })).toHaveAttribute('aria-disabled', 'true');
  await expect(nav.getByRole('button', { name: 'Next step' })).toHaveAttribute('aria-disabled', 'false');
  await expect(statusOf(page, id)).toHaveCount(1);
  await expect(statusOf(page, id)).toHaveText(`Step 1 of ${total}`);
  expect(await nav.locator('[role="status"]').count()).toBe(1);
  // The step is still a heading with its number, for anyone moving by headings.
  await expect(page.getByRole('heading', { level: 3, name: `Step 1 of ${total} ${step(1).title}` })).toBeVisible();
  expect(await highlighted(page)).toEqual(marks(1));
  expect(await panel(page)).toEqual(rowsOf(1));
  await expect(s(page).locator('li.lt-step .lt-state-box:visible')).toHaveCount(0);
  // Nothing is recorded about a step-through, and none of the narration events fire on arrival at step 1.
  await record(page);
  expect(await stored(page, lesson.id)).toEqual([]);
  await expectClean(watch, browserName);
});

test('opening the lesson and looking at the step-through stores nothing; the place is kept from the first step taken', async ({ page }, testInfo) => {
  await openLesson(page, testInfo);
  const kept = (): Promise<string[]> => page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes(':step.')));
  expect(await kept()).toEqual([]);
  await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), id);
  await expect(s(page)).toBeVisible();
  expect(await kept()).toEqual([]);
  // A press that changes nothing keeps nothing either.
  await prevButton(page).press('Enter');
  expect(await kept()).toEqual([]);
  await nextButton(page).press('Enter');
  expect(await kept()).toEqual([`lt:${lesson.id}:step.${id}`]);
  // The step on show, the last step whose text has been shown, and the digest of the scene they are about.
  const rev = await s(page).getAttribute('data-rev');
  expect(rev).toMatch(/^[0-9a-f]{12}$/);
  expect(await page.evaluate((key) => localStorage.getItem(key), `lt:${lesson.id}:step.${id}`)).toBe(`[2,2,"${rev}"]`);
});

test('with the keyboard: Next and Previous keep focus, each step is announced with its changes, and the prediction holds its step back', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo, { hash: `#/${id}` });
  await record(page);
  const status = statusOf(page, id);
  const changedAt = (n: number): string[] => (step(n).state ?? []).filter((r) => (step(n - 1).state ?? []).find((b) => b.label === r.label)?.value !== r.value).map((r) => r.label);

  await tabUntil(page, browserName, (a) => a.does === 'next' && a.scene === id);
  // Every plain step before the question.
  for (let n = 2; n < ASK; n++) {
    await page.keyboard.press(n % 2 === 0 ? 'Enter' : 'Space');
    const changed = changedAt(n);
    await expect(status).toHaveText(`Step ${n} of ${total}: ${step(n).title}.${changed.length > 0 ? ` Changed: ${changed.map((label) => `${label} ${step(n).state?.find((r) => r.label === label)?.value}`).join(', ')}.` : ''}`);
    expect(await active(page)).toMatchObject({ does: 'next', scene: id });
    expect(await shownSteps(page)).toEqual([String(n)]);
    expect(await highlighted(page)).toEqual(marks(n));
    expect(await panel(page)).toEqual(rowsOf(n, (label) => changed.includes(label)));
  }
  // A changed value is marked in words, not only by its look.
  const changedRow = s(page).locator('[data-state-panel] .lt-state-row[data-changed]').first();
  await expect(changedRow).toContainText(/changed, (new|was .+)/);

  // The step with the question: its text, its highlight and its values wait.
  await page.keyboard.press('Enter');
  await expect(status).toHaveText(`Step ${ASK} of ${total}: ${step(ASK).title}. A question comes first. Answer it, or skip it, to see this step.`);
  expect(await active(page)).toMatchObject({ does: 'next', disabled: true });
  expect(await shownSteps(page)).toEqual([String(ASK)]);
  const body = s(page).locator(`li[data-step="${ASK}"] [data-step-body]`);
  await expect(body).toBeHidden();
  expect(await highlighted(page)).toEqual(marks(ASK - 1));
  expect(await panel(page)).toEqual(rowsOf(ASK - 1));
  const shown = await s(page).innerText();
  for (const o of predict.options) expect(shown).not.toContain(o.feedback);
  for (const block of step(ASK).blocks) expect(shown).not.toContain(block.text);

  // Next waits, and says why, as often as it is asked. So does the arrow key.
  await page.keyboard.press('Enter');
  await expect(status).toHaveText(`Step ${ASK} of ${total}: ${step(ASK).title}. Answer the question, or skip it, to go on.`);
  await page.keyboard.press('ArrowRight');
  await expect(status).toHaveText(`Step ${ASK} of ${total}: ${step(ASK).title}. Answer the question, or skip it, to go on.`);
  expect(await shownSteps(page)).toEqual([String(ASK)]);

  // Back and forward with the arrow keys: the question is still waiting.
  await page.keyboard.press('ArrowLeft');
  expect(await shownSteps(page)).toEqual([String(ASK - 1)]);
  expect(await active(page)).toMatchObject({ does: 'next', disabled: false });
  await page.keyboard.press('ArrowRight');
  await expect(body).toBeHidden();

  // Check with nothing chosen: said beside the question and through the status region.
  await tabUntil(page, browserName, (a) => a.does === 'check' && a.scene === id);
  await page.keyboard.press('Enter');
  await expect(s(page).locator('[data-outcome]')).toHaveText('Choose an answer first, or skip the question.');
  await expect(status).toHaveText(`Step ${ASK} of ${total}. Choose an answer first, or skip the question.`);
  await expect(body).toBeHidden();

  // A wrong prediction: its own feedback, the answer marked, and the step appears.
  await tabUntil(page, browserName, (a) => a.type === 'radio' && a.scene === id, { back: true });
  await choose(page, id, wrongOption);
  await tabUntil(page, browserName, (a) => a.does === 'check');
  await page.keyboard.press('Enter');
  const feedback = predict.options[wrongOption]?.feedback as string;
  await expect(s(page).locator('[data-outcome]')).toContainText('Not quite.');
  await expect(s(page).locator('[data-outcome]')).toContainText(feedback);
  await expect(status).toHaveText(`Step ${ASK} of ${total}. Not quite. ${feedback} The step is shown below.`);
  expect(await active(page)).toMatchObject({ does: 'check', disabled: true });
  await expect(body).toBeVisible();
  await expect(s(page).locator(`li[data-step="${ASK}"] label.lt-option[data-option="${rightOption}"]`)).toContainText('Correct answer');
  await expect(s(page).locator(`li[data-step="${ASK}"] label.lt-option[data-option="${wrongOption}"]`)).toContainText('Not this one');
  for (const radio of await s(page).locator(`li[data-step="${ASK}"]`).getByRole('radio').all()) await expect(radio).toBeDisabled();
  await expect(s(page).locator(`li[data-step="${ASK}"] button[data-act="skip"]`)).toBeHidden();
  expect(await highlighted(page)).toEqual(marks(ASK));
  const changed = changedAt(ASK);
  expect(await panel(page)).toEqual(rowsOf(ASK, (label) => changed.includes(label)));
  await expect(nextButton(page)).toHaveAttribute('aria-disabled', 'false');
  // A prediction is practice inside the step: nothing goes on the learner's record.
  expect(await stored(page, lesson.id)).toEqual([]);
  expect(await seen(page, 'lt:result')).toEqual([]);

  // On to the end. The last step says it is the last, and where to go.
  await tabUntil(page, browserName, (a) => a.does === 'next', { back: true });
  for (let n = ASK + 1; n <= total; n++) {
    await page.keyboard.press('Enter');
    expect(await shownSteps(page)).toEqual([String(n)]);
    expect(await highlighted(page)).toEqual(marks(n));
  }
  await expect(nextButton(page)).toHaveAttribute('aria-disabled', 'true');
  expect(await active(page)).toMatchObject({ does: 'next', disabled: true });
  await page.keyboard.press('Enter');
  await expect(status).toHaveText(`Step ${total} of ${total}: ${step(total).title}. This is the last step. Continue is further down.`);
  // And the first says it is the first.
  await tab(page, browserName, true);
  expect((await active(page)).does).toBe('prev');
  for (let n = total - 1; n >= 1; n--) await page.keyboard.press('Enter');
  expect(await shownSteps(page)).toEqual(['1']);
  await page.keyboard.press('Enter');
  await expect(status).toHaveText(`Step 1 of ${total}: ${step(1).title}. This is the first step.`);
  expect(await active(page)).toMatchObject({ does: 'prev', disabled: true });
  // Going back over an answered prediction does not ask again.
  await tab(page, browserName);
  for (let n = 2; n <= ASK; n++) await page.keyboard.press('Enter');
  await expect(body).toBeVisible();
  await expect(s(page).locator(`li[data-step="${ASK}"] [data-actions]`)).toBeHidden();

  // What the narration was told: each step as it became readable, and null, which says there is nothing to read, while the question was open.
  const told = (await seen(page, 'lt:stepchange')) as { sceneId: string; step: number | null }[];
  expect(told.every((t) => t.sceneId === id)).toBe(true);
  const upToAsk = Array.from({ length: ASK - 2 }, (_, i) => i + 2);
  expect(told.map((t) => t.step).slice(0, upToAsk.length + 4)).toEqual([...upToAsk, null, ASK - 1, null, ASK]);
  // Never a step number that does not exist, which is how "none" used to be said.
  expect(told.every((t) => t.step === null || (t.step >= 1 && t.step <= total))).toBe(true);
  await expectClean(watch, browserName);
});

test('a right prediction says so, and skipping shows the step with the answer marked', async ({ page, browserName }, testInfo) => {
  await openLesson(page, testInfo, { hash: `#/${id}` });
  const status = statusOf(page, id);
  await tabUntil(page, browserName, (a) => a.does === 'next' && a.scene === id);
  for (let n = 2; n <= ASK; n++) await page.keyboard.press('Enter');
  await tabUntil(page, browserName, (a) => a.type === 'radio' && a.scene === id);
  await choose(page, id, rightOption);
  await tabUntil(page, browserName, (a) => a.does === 'check');
  await page.keyboard.press('Space');
  const feedback = predict.options[rightOption]?.feedback as string;
  await expect(status).toHaveText(`Step ${ASK} of ${total}. Your prediction was right. ${feedback} The step is shown below.`);
  await expect(s(page).locator('[data-outcome]')).toHaveAttribute('data-tone', 'good');
  await expect(s(page).locator(`li[data-step="${ASK}"] [data-step-body]`)).toBeVisible();

  // Skipping, in a fresh copy of the page.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await tabUntil(page, browserName, (a) => a.does === 'next' && a.scene === id);
  for (let n = 2; n <= ASK; n++) await page.keyboard.press('Enter');
  await tabUntil(page, browserName, (a) => a.does === 'skip' && a.scene === id);
  await page.keyboard.press('Enter');
  await expect(status).toHaveText(`Step ${ASK} of ${total}. Question skipped. The answer is marked. The step is shown below.`);
  await expect(s(page).locator('[data-outcome]')).toHaveText('Question skipped. The answer is marked.');
  expect(await active(page)).toMatchObject({ does: 'skip', disabled: true });
  await expect(s(page).locator(`li[data-step="${ASK}"] button[data-act="check"]`)).toBeHidden();
  await expect(s(page).locator(`li[data-step="${ASK}"] label.lt-option[data-option="${rightOption}"]`)).toContainText('Correct answer');
  await expect(s(page).locator(`li[data-step="${ASK}"] [data-step-body]`)).toBeVisible();
  expect(await highlighted(page)).toEqual(marks(ASK));
});

test('the place is kept: leaving the scene and coming back, and across a reload, with the prediction not asked twice', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo, { hash: `#/${id}` });
  await tabUntil(page, browserName, (a) => a.does === 'next' && a.scene === id);
  for (let n = 2; n <= ASK; n++) await page.keyboard.press('Enter');

  // Reloaded while the question is open: still open, still holding the step back.
  await page.reload();
  expect(await shownSteps(page)).toEqual([String(ASK)]);
  await expect(statusOf(page, id)).toHaveText(`Step ${ASK} of ${total}`);
  await expect(s(page).locator(`li[data-step="${ASK}"] [data-step-body]`)).toBeHidden();
  expect(await highlighted(page)).toEqual(marks(ASK - 1));
  await expect(nextButton(page)).toHaveAttribute('aria-disabled', 'true');

  await tabUntil(page, browserName, (a) => a.does === 'skip' && a.scene === id);
  await page.keyboard.press('Enter');
  await tabUntil(page, browserName, (a) => a.does === 'next', { back: true });
  await page.keyboard.press('Enter');
  expect(await shownSteps(page)).toEqual([String(ASK + 1)]);

  // To another scene and back.
  const other = lesson.scenes[0]?.id as string;
  await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), other);
  await expect(s(page)).toBeHidden();
  await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), id);
  expect(await shownSteps(page)).toEqual([String(ASK + 1)]);

  // Reloaded past the question: the place, the highlight and the values are back, and the question is settled.
  await page.reload();
  expect(await shownSteps(page)).toEqual([String(ASK + 1)]);
  expect(await highlighted(page)).toEqual(marks(ASK + 1));
  await expect(prevButton(page)).toHaveAttribute('aria-disabled', 'false');
  await prevButton(page).press('Enter');
  expect(await shownSteps(page)).toEqual([String(ASK)]);
  await expect(s(page).locator(`li[data-step="${ASK}"] [data-step-body]`)).toBeVisible();
  await expect(s(page).locator(`li[data-step="${ASK}"] [data-outcome]`)).toHaveText('You answered or skipped this question earlier. The answer is marked.');
  await expect(s(page).locator(`li[data-step="${ASK}"] [data-actions]`)).toBeHidden();
  await expect(nextButton(page)).toHaveAttribute('aria-disabled', 'false');

  // A stored place that cannot be right is ignored. So is one kept for another version of this
  // scene (review finding P5): a lesson published again under the same id finds the old place, and
  // "seen up to step 3" would settle a prediction the learner has never met. The pair with no
  // digest is what the version before this one stored.
  const rev = (await s(page).getAttribute('data-rev')) as string;
  for (const bad of [`[99,99,"${rev}"]`, `[3,0,"${rev}"]`, '"2"', '[2]', '{"at":2}', `[1.5,2,"${rev}"]`, '[2,2]', `[${ASK + 1},${ASK + 1}]`, `[${ASK + 1},${ASK + 1},"0123456789ab"]`, `[2,2,7]`]) {
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: `lt:${lesson.id}:step.${id}`, value: bad });
    await page.reload();
    expect(await shownSteps(page), bad).toEqual(['1']);
    await expect(s(page).locator(`li[data-step="${ASK}"] [data-actions]`), bad).not.toHaveAttribute('hidden');
  }
  // The same place with this scene's digest is this scene's place.
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: `lt:${lesson.id}:step.${id}`, value: `[2,2,"${rev}"]` });
  await page.reload();
  expect(await shownSteps(page)).toEqual(['2']);
  await expectClean(watch, browserName);
});

test('the narration follows the steps, is told the place on arrival, and has nothing to read while a prediction is open', async ({ page, browserName }, testInfo) => {
  const clips = [`${id}.intro`, ...STEPS.steps.map((_, i) => `${id}.step${i + 1}`)];
  const watch = await openLesson(page, testInfo, { published: withSilentAudio(clips), hash: `#/${id}` });
  const bar = page.locator('#lt-audiobar');
  const listen = page.locator('#lt-play');
  const reading = (): Promise<string[]> => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.lt-reading')).map((el) => el.dataset.narration ?? ''));
  await expect(bar).toBeVisible();

  await tabUntil(page, browserName, (a) => a.does === 'next' && a.scene === id);
  for (let n = 2; n < ASK; n++) await page.keyboard.press('Enter');
  await listen.click();
  await expect(listen).toHaveText('Pause');
  await expect.poll(reading).toEqual([`${id}.step${ASK - 1}`]);

  // Next, while listening, onto the step with the question: the reading stops and there is nothing to listen to.
  await nextButton(page).press('Enter');
  await expect(bar).toBeHidden();
  expect(await page.evaluate(() => (document.getElementById('lt-audio') as HTMLAudioElement).paused)).toBe(true);
  expect(await reading()).toEqual([]);

  // Answered: the step can be read.
  await s(page).locator('button[data-act="skip"]').press('Enter');
  await expect(bar).toBeVisible();
  await listen.click();
  await expect.poll(reading).toEqual([`${id}.step${ASK}`]);
  await listen.click();

  // Arriving in the scene at a later step, the narration reads that step and not the first.
  await nextButton(page).press('Enter');
  await page.reload();
  expect(await shownSteps(page)).toEqual([String(ASK + 1)]);
  await listen.click();
  await expect.poll(reading).toEqual([`${id}.step${ASK + 1}`]);
  await expectClean(watch, browserName);
});

test('a step-through with a question on its first step, no titles and no values still works', async ({ page, browserName }, testInfo) => {
  const published = lessonWith((p) => {
    const st = p.lesson.scenes.find((x): x is StepThroughScene => x.kind === 'step_through') as StepThroughScene;
    const ask = st.steps.find((x) => x.predict)?.predict;
    st.steps = st.steps.slice(0, 3).map((x, i) => ({ highlight: x.highlight, blocks: x.blocks, ...(i === 0 ? { predict: ask } : {}) }));
  });
  const watch = await openLesson(page, testInfo, { published, hash: `#/${id}` });
  await expect(statusOf(page, id)).toHaveText('Step 1 of 3');
  await expect(s(page).locator('[data-state-panel]')).toBeHidden();
  await expect(s(page).locator('li[data-step="1"] [data-step-body]')).toBeHidden();
  expect(await highlighted(page)).toEqual([]);
  await expect(nextButton(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('heading', { level: 3, name: 'Step 1 of 3' })).toHaveCount(1);

  await tabUntil(page, browserName, (a) => a.does === 'skip' && a.scene === id);
  await page.keyboard.press('Enter');
  expect(await highlighted(page)).toEqual(marks(1));
  await tabUntil(page, browserName, (a) => a.does === 'next', { back: true });
  await page.keyboard.press('Enter');
  await expect(statusOf(page, id)).toHaveText('Step 2 of 3.');
  await expect(s(page).locator('[data-state-panel]')).toBeHidden();
  await expectClean(watch, browserName);
});

test.describe('scripting off', () => {
  test.use({ javaScriptEnabled: false });

  test('every step is on the page in order, the question is plain text with its answer in a disclosure, and changed values are marked in words', async ({ page }, testInfo) => {
    await openLesson(page, testInfo);
    expect(await shownSteps(page)).toEqual(STEPS.steps.map((_, i) => String(i + 1)));
    const headings = await s(page).locator('li.lt-step > h3').allTextContents();
    expect(headings.map((h) => h.replace(/\s+/g, ' ').trim())).toEqual(STEPS.steps.map((x, i) => `Step ${i + 1} of ${total} ${x.title}`));
    for (const x of STEPS.steps) for (const block of x.blocks) await expect(s(page)).toContainText(block.text);

    // Nothing that needs the script is offered.
    await expect(s(page).locator('[data-step-nav]')).toBeHidden();
    await expect(s(page).locator('[data-state-panel]')).toBeHidden();
    await expect(s(page).locator('input:visible')).toHaveCount(0);
    await expect(s(page).locator('button:visible:not(.lt-chip)')).toHaveCount(0);
    await expect(statusOf(page, id)).toBeEmpty();

    // The question reads as text. Its answer and each option's feedback are behind a native disclosure.
    const ask = s(page).locator(`li[data-step="${ASK}"] [data-predict]`);
    await expect(ask).toContainText('Predict first');
    await expect(ask).toContainText(predict.prompt);
    for (const o of predict.options) await expect(ask.locator('.lt-option', { hasText: o.text })).toBeVisible();
    const key = ask.locator('details');
    await expect(key.locator('.lt-reveal-body')).toBeHidden();
    await key.locator('summary').click();
    for (const o of predict.options) await expect(key).toContainText(`${o.correct ? 'Correct answer:' : 'Not this one:'} ${o.text}`);
    await expect(key).toContainText(predict.options[rightOption]?.feedback as string);

    // Each step lists its own values; a changed one says what it was.
    for (const [i, x] of STEPS.steps.entries()) {
      const box = s(page).locator(`li[data-step="${i + 1}"] .lt-state-box`);
      if (!x.state) {
        await expect(box).toHaveCount(0);
        continue;
      }
      await expect(box).toBeVisible();
      for (const row of x.state) {
        const before = STEPS.steps[i - 1]?.state?.find((b) => b.label === row.label);
        const el = box.locator('.lt-state-row', { has: page.locator('dt', { hasText: new RegExp(`^${row.label}$`) }) });
        if (i === 0 || before?.value === row.value) await expect(el).not.toHaveAttribute('data-changed', 'true');
        else await expect(el).toContainText(before ? `changed, was ${before.value}` : 'changed, new');
      }
    }
  });

  test('checkpoints read as questions with nothing to operate, and each answer opens from a native disclosure', async ({ page }, testInfo) => {
    await openLesson(page, testInfo);
    for (const c of lesson.scenes) {
      if (c.kind !== 'checkpoint') continue;
      const q = page.locator(`${scene(c.id)} .lt-question`);
      await expect(q).toContainText(c.question.prompt);
      await expect(q.locator('input:visible, textarea:visible, button:visible')).toHaveCount(0);
      await expect(q.locator('[role="status"]')).toBeEmpty();
      const answer = q.locator('details[data-answer]');
      await expect(answer.locator('.lt-reveal-body')).toBeHidden();
      await answer.locator('summary').click();
      const text = c.question.type === 'reflect' ? c.question.modelAnswer.text : c.question.explanation.text;
      await expect(answer.locator('.lt-reveal-body')).toContainText(text);
      // The source of the explanation still opens, as a native popover.
      await answer.locator('button.lt-chip').first().click();
      await expect(page.locator(`${scene(c.id)} .lt-source:popover-open`)).toHaveCount(1);
      await page.keyboard.press('Escape');
    }
  });
});
