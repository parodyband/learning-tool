// Checkpoint questions driven with the keyboard alone, in both engines: what is recorded, what is
// announced, where focus is, and what is never shown.
import { EXAMPLE_QUESTIONS } from '../../src/core/examples';
import type { CheckpointScene, NumericQuestion, OrderQuestion, SingleQuestion } from '../../src/core/schema';
import { examplePublished } from '../helpers/example';
import { active, choose, lessonWith, record, scene, seen, setQuestion, shownOrder, statusOf, stored, tabUntil, withReflect } from './questions-kit';
import { expect, expectClean, openLesson, tab, test, withSilentAudio } from './shell-kit';

const lesson = examplePublished().lesson;
const checkpoint = (type: string): CheckpointScene => lesson.scenes.find((s): s is CheckpointScene => s.kind === 'checkpoint' && s.question.type === type) as CheckpointScene;

const SINGLE = checkpoint('single');
const NUMERIC = checkpoint('numeric');
const ORDER = checkpoint('order');
const single = SINGLE.question as SingleQuestion;
const numeric = NUMERIC.question as NumericQuestion;
const order = ORDER.question as OrderQuestion;
const right = single.options.findIndex((o) => o.correct);
const wrong = single.options.flatMap((o, i) => (o.correct ? [] : [i]));

/** Wrong answers for the numeric question, on either side of the right one, and one written with a space between its thousands. */
const TOO_HIGH = String(numeric.answer + 5);
const TOO_LOW = String(numeric.answer - 3);
const FAR_TOO_HIGH = `${numeric.answer + 1} 000`;

/** A receipt hash under which the options of the single question are not in the order they were written. */
const OTHER_HASH = 'b'.repeat(64);

test('the example has what these tests need', () => {
  // The example lesson belongs to another area. If it changes shape, this says so before the tests below fail in stranger ways.
  expect(single.options.length).toBeGreaterThanOrEqual(3);
  expect(wrong.length).toBeGreaterThanOrEqual(2);
  expect(single.hint).toBeTruthy();
  expect(single.fixedOrder).not.toBe(true);
  expect(single.options.some((o) => o.misconception)).toBe(true);
  expect(numeric.unit).toBeTruthy();
  expect(numeric.tolerance).toBe(0);
  expect(Number.isInteger(numeric.answer) && numeric.answer > 3).toBe(true);
  expect(order.items.length).toBeGreaterThanOrEqual(4);
  expect(new Set([SINGLE.id, NUMERIC.id, ORDER.id]).size).toBe(3);
});

test.describe('single choice', () => {
  test('nothing is graded or shown until Check is pressed, and Check with no choice costs nothing', async ({ page, browserName }, testInfo) => {
    const watch = await openLesson(page, testInfo, { hash: `#/${SINGLE.id}` });
    const s = page.locator(scene(SINGLE.id));
    await expect(statusOf(page, SINGLE.id)).toHaveCount(1);
    await expect(statusOf(page, SINGLE.id)).toBeEmpty();
    await expect(s.getByRole('radio')).toHaveCount(single.options.length);
    await expect(s.getByRole('group', { name: single.prompt })).toBeVisible();

    // No feedback, explanation or misconception is on show, and none of it can be found by a reader.
    const shown = await s.innerText();
    for (const o of single.options) {
      expect(shown).not.toContain(o.feedback);
      if (o.misconception) expect(await s.evaluate((el, text) => (el.textContent ?? '').includes(text), o.misconception)).toBe(false);
    }
    expect(shown).not.toContain(single.explanation.text);
    await expect(s.locator('button.lt-chip:visible')).toHaveCount(0);

    // Arrowing through the options selects, and selecting alone does nothing.
    await tabUntil(page, browserName, (a) => a.type === 'radio' && a.scene === SINGLE.id);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(statusOf(page, SINGLE.id)).toBeEmpty();
    expect(await stored(page, lesson.id)).toEqual([]);
    await expectClean(watch, browserName);
  });

  test('Check with nothing chosen says so in words and records nothing', async ({ page, browserName }, testInfo) => {
    await openLesson(page, testInfo, { hash: `#/${SINGLE.id}` });
    await tabUntil(page, browserName, (a) => a.does === 'check' && a.scene === SINGLE.id);
    await page.keyboard.press('Enter');
    await expect(statusOf(page, SINGLE.id)).toHaveText('Choose an answer first.');
    expect((await active(page)).does).toBe('check');
    // Said again when asked again: the region is emptied and refilled so that it is announced twice.
    await page.keyboard.press('Space');
    await expect(statusOf(page, SINGLE.id)).toHaveText('Choose an answer first.');
    expect(await stored(page, lesson.id)).toEqual([]);
  });

  test('wrong, then right: that option’s feedback, one more try, then the explanation with its source, and the first attempt on record', async ({ page, browserName }, testInfo) => {
    const watch = await openLesson(page, testInfo, { hash: `#/${SINGLE.id}`, published: lessonWith(undefined, { hash: OTHER_HASH }) });
    await record(page);
    const s = page.locator(scene(SINGLE.id));
    const status = statusOf(page, SINGLE.id);
    const pickedWrong = wrong[0] as number;

    await tabUntil(page, browserName, (a) => a.type === 'radio' && a.scene === SINGLE.id);
    await choose(page, SINGLE.id, pickedWrong);
    await tabUntil(page, browserName, (a) => a.does === 'check');
    await page.keyboard.press('Enter');

    await expect(status).toContainText('Not quite.');
    await expect(status).toContainText(single.options[pickedWrong]?.feedback as string);
    await expect(status).toContainText('You have one more try.');
    await expect(status).toHaveAttribute('data-tone', 'bad');
    // Focus has not moved, the wrong option is marked in words and can no longer be chosen, and the answer is still not shown.
    expect((await active(page)).does).toBe('check');
    const tried = s.locator(`label.lt-option[data-option="${pickedWrong}"]`);
    await expect(tried).toContainText('Not this one');
    await expect(tried.locator('input')).toBeDisabled();
    await expect(tried.locator('input')).not.toBeChecked();
    await expect(s.locator('[data-explain]')).toBeHidden();
    await expect(s.locator(`label.lt-option[data-option="${right}"]`)).not.toContainText('Correct answer');
    expect(await stored(page, lesson.id)).toEqual([[SINGLE.id, 'incorrect']]);
    expect(await seen(page, 'lt:result')).toEqual([{ sceneId: SINGLE.id, objective: SINGLE.objective, result: 'incorrect' }]);

    // Second attempt.
    await tabUntil(page, browserName, (a) => a.type === 'radio', { back: true });
    await choose(page, SINGLE.id, right);
    await tabUntil(page, browserName, (a) => a.does === 'check');
    await page.keyboard.press('Space');

    await expect(status).toContainText('Correct.');
    await expect(status).toContainText(single.options[right]?.feedback as string);
    await expect(status).not.toContainText('one more try');
    await expect(status).toContainText('The explanation is below.');
    await expect(status).toHaveAttribute('data-tone', 'good');
    const check = s.locator('button[data-act="check"]');
    await expect(check).toHaveAttribute('aria-disabled', 'true');
    expect((await active(page)).does).toBe('check');
    await expect(s.locator(`label.lt-option[data-option="${right}"]`)).toContainText('Correct answer');
    for (const input of await s.getByRole('radio').all()) await expect(input).toBeDisabled();
    const explain = s.locator('[data-explain]');
    await expect(explain).toBeVisible();
    await expect(explain).toContainText(single.explanation.text);

    // The explanation's source opens from the keyboard like any other.
    await tabUntil(page, browserName, (a) => a.tag === 'BUTTON' && a.does === '' && a.scene === SINGLE.id, { limit: 4 });
    await page.keyboard.press('Enter');
    await expect(s.locator('.lt-source:popover-open')).toHaveCount(1);
    await page.keyboard.press('Escape');

    // Only the first attempt counts, and nothing new was announced to the recap.
    expect(await stored(page, lesson.id)).toEqual([[SINGLE.id, 'incorrect']]);
    expect(await seen(page, 'lt:result')).toHaveLength(1);
    // A misconception is for the agent. It is never in the page, before or after.
    for (const o of single.options) if (o.misconception) expect(await page.locator('main').evaluate((el, text) => (el.textContent ?? '').includes(text), o.misconception)).toBe(false);
    await expectClean(watch, browserName);
  });

  test('wrong twice: the answer is marked, both tries are marked, and the explanation follows', async ({ page, browserName }, testInfo) => {
    await openLesson(page, testInfo, { hash: `#/${SINGLE.id}` });
    const s = page.locator(scene(SINGLE.id));
    const status = statusOf(page, SINGLE.id);
    await tabUntil(page, browserName, (a) => a.type === 'radio' && a.scene === SINGLE.id);
    await choose(page, SINGLE.id, wrong[0] as number);
    await tabUntil(page, browserName, (a) => a.does === 'check');
    await page.keyboard.press('Enter');
    await expect(status).toContainText('one more try');
    await tabUntil(page, browserName, (a) => a.type === 'radio', { back: true });
    await choose(page, SINGLE.id, wrong[1] as number);
    await tabUntil(page, browserName, (a) => a.does === 'check');
    await page.keyboard.press('Enter');

    await expect(status).toContainText('Not quite.');
    await expect(status).toContainText(single.options[wrong[1] as number]?.feedback as string);
    await expect(status).not.toContainText('one more try');
    await expect(s.locator(`label.lt-option[data-option="${right}"]`)).toContainText('Correct answer');
    await expect(s.locator(`label.lt-option[data-option="${right}"]`)).toHaveAttribute('data-state', 'right');
    for (const i of wrong.slice(0, 2)) {
      await expect(s.locator(`label.lt-option[data-option="${i}"]`)).toContainText('Not this one');
      await expect(s.locator(`label.lt-option[data-option="${i}"]`)).toHaveAttribute('data-state', 'wrong');
    }
    await expect(s.locator('[data-explain]')).toContainText(single.explanation.text);
    await expect(s.locator('button[data-act="check"]')).toHaveAttribute('aria-disabled', 'true');
    // A third press does nothing.
    await page.keyboard.press('Enter');
    expect(await stored(page, lesson.id)).toEqual([[SINGLE.id, 'incorrect']]);
  });

  test('right first time is recorded as correct and shows in the recap', async ({ page, browserName }, testInfo) => {
    await openLesson(page, testInfo, { hash: `#/${SINGLE.id}` });
    await tabUntil(page, browserName, (a) => a.type === 'radio' && a.scene === SINGLE.id);
    await choose(page, SINGLE.id, right);
    await tabUntil(page, browserName, (a) => a.does === 'check');
    await page.keyboard.press('Enter');
    await expect(statusOf(page, SINGLE.id)).toContainText('Correct.');
    expect(await stored(page, lesson.id)).toEqual([[SINGLE.id, 'correct']]);

    const recap = lesson.scenes.at(-1)?.id as string;
    await page.evaluate((id) => (location.hash = `#/${id}`), recap);
    await expect(page.locator(`${scene(recap)} [data-result="${SINGLE.id}"]`)).toHaveText('✓ Right on your first attempt');
    expect(await page.locator(`${scene(recap)} textarea[data-summary]`).inputValue()).toContain(`${SINGLE.title}: right on the first attempt`);
  });

  test('trying again is practice: the question starts over, focus goes to the first option, and the record stays', async ({ page, browserName }, testInfo) => {
    await openLesson(page, testInfo, { hash: `#/${SINGLE.id}` });
    const s = page.locator(scene(SINGLE.id));
    await tabUntil(page, browserName, (a) => a.type === 'radio' && a.scene === SINGLE.id);
    await choose(page, SINGLE.id, right);
    await tabUntil(page, browserName, (a) => a.does === 'check');
    await page.keyboard.press('Enter');
    await expect(s.locator('[data-explain]')).toBeVisible();

    await tabUntil(page, browserName, (a) => a.does === 'again');
    await page.keyboard.press('Enter');
    await expect(s.locator('[data-explain]')).toBeHidden();
    await expect(statusOf(page, SINGLE.id)).toBeEmpty();
    await expect(s.locator('button[data-act="again"]')).toBeHidden();
    await expect(s.locator('[data-earlier]')).toHaveText('Earlier result: right on your first attempt. Answering again is practice and does not change it.');
    const first = (await shownOrder(page, SINGLE.id, 'option'))[0];
    expect(await active(page)).toMatchObject({ type: 'radio', option: String(first) });
    for (const input of await s.getByRole('radio').all()) {
      await expect(input).toBeEnabled();
      await expect(input).not.toBeChecked();
    }

    // A wrong answer now changes nothing that was recorded.
    await choose(page, SINGLE.id, wrong[0] as number);
    await tabUntil(page, browserName, (a) => a.does === 'check');
    await page.keyboard.press('Enter');
    await expect(statusOf(page, SINGLE.id)).toContainText('Not quite.');
    expect(await stored(page, lesson.id)).toEqual([[SINGLE.id, 'correct']]);
  });

  test('after a reload the question is fresh and says how the first attempt went', async ({ page, browserName }, testInfo) => {
    await openLesson(page, testInfo, { hash: `#/${SINGLE.id}` });
    const s = page.locator(scene(SINGLE.id));
    await tabUntil(page, browserName, (a) => a.type === 'radio' && a.scene === SINGLE.id);
    await choose(page, SINGLE.id, wrong[0] as number);
    await tabUntil(page, browserName, (a) => a.does === 'check');
    await page.keyboard.press('Enter');
    await expect(statusOf(page, SINGLE.id)).toContainText('Not quite.');

    await page.reload();
    await expect(s.locator('[data-earlier]')).toHaveText('Earlier result: not right on your first attempt. Answering again is practice and does not change it.');
    await expect(statusOf(page, SINGLE.id)).toBeEmpty();
    await expect(s.locator('[data-explain]')).toBeHidden();
    for (const input of await s.getByRole('radio').all()) {
      await expect(input).toBeEnabled();
      await expect(input).not.toBeChecked();
    }
  });

  test('the options are shown in an order fixed by the receipt hash, unless the author fixed the order', async ({ page }, testInfo) => {
    await openLesson(page, testInfo, { hash: `#/${SINGLE.id}`, published: lessonWith(undefined, { hash: OTHER_HASH }) });
    const shuffled = await shownOrder(page, SINGLE.id, 'option');
    expect([...shuffled].sort()).toEqual(single.options.map((_, i) => i));
    expect(shuffled).not.toEqual(single.options.map((_, i) => i));
    await page.reload();
    expect(await shownOrder(page, SINGLE.id, 'option')).toEqual(shuffled);

    await openLesson(page, testInfo, { hash: `#/${SINGLE.id}`, published: lessonWith((p) => setQuestion(p, SINGLE.id, { ...EXAMPLE_QUESTIONS.single, fixedOrder: true }), { hash: OTHER_HASH }) });
    expect(await shownOrder(page, SINGLE.id, 'option')).toEqual(single.options.map((_, i) => i));
  });

  test('the hint is a native disclosure that works from the keyboard and goes once the answer is shown', async ({ page, browserName }, testInfo) => {
    await openLesson(page, testInfo, { hash: `#/${SINGLE.id}` });
    const s = page.locator(scene(SINGLE.id));
    const hint = s.locator('details.lt-hint');
    await expect(hint).not.toHaveAttribute('open', '');
    await tabUntil(page, browserName, (a) => a.tag === 'SUMMARY' && a.scene === SINGLE.id);
    await page.keyboard.press('Enter');
    await expect(hint.locator('.lt-reveal-body')).toHaveText(single.hint as string);
    await tabUntil(page, browserName, (a) => a.type === 'radio', { back: true });
    await choose(page, SINGLE.id, right);
    await tabUntil(page, browserName, (a) => a.does === 'check');
    await page.keyboard.press('Enter');
    await expect(hint).toBeHidden();
  });
});

test.describe('numeric', () => {
  const field = (page: import('@playwright/test').Page) => page.locator(`${scene(NUMERIC.id)} input.lt-number`);

  test('the field takes decimals from a phone keyboard, is labelled by the prompt, and shows its unit', async ({ page }, testInfo) => {
    await openLesson(page, testInfo, { hash: `#/${NUMERIC.id}` });
    const input = field(page);
    await expect(input).toHaveAttribute('type', 'text');
    await expect(input).toHaveAttribute('inputmode', 'decimal');
    await expect(input).toHaveAttribute('autocomplete', 'off');
    await expect(page.getByRole('textbox', { name: numeric.prompt })).toHaveCount(1);
    await expect(page.locator(`${scene(NUMERIC.id)} .lt-unit`)).toHaveText(numeric.unit as string);
    await expect(input).toHaveAccessibleDescription(numeric.unit as string);
  });

  test('typed with the keyboard: an empty or unreadable answer costs nothing, wrong says which way, and Enter checks', async ({ page, browserName }, testInfo) => {
    const watch = await openLesson(page, testInfo, { hash: `#/${NUMERIC.id}` });
    await record(page);
    const s = page.locator(scene(NUMERIC.id));
    const status = statusOf(page, NUMERIC.id);
    const input = field(page);
    await expect(status).toHaveCount(1);
    await tabUntil(page, browserName, (a) => a.tag === 'INPUT' && a.type === 'text' && a.scene === NUMERIC.id);

    await page.keyboard.press('Enter');
    await expect(status).toHaveText('Type your answer first.');
    await page.keyboard.type('about twenty');
    await page.keyboard.press('Enter');
    await expect(status).toHaveText('That does not read as a number. Use digits, such as 12 or 0.5.');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(await stored(page, lesson.id)).toEqual([]);

    await input.press('ControlOrMeta+a');
    await page.keyboard.type(TOO_HIGH);
    await expect(input).not.toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.press('Enter');
    await expect(status).toContainText('Not quite.');
    await expect(status).toContainText('Your answer is too high.');
    await expect(status).toContainText('You have one more try.');
    expect((await active(page)).tag).toBe('INPUT');
    expect(await stored(page, lesson.id)).toEqual([[NUMERIC.id, 'incorrect']]);
    await expect(s.locator('[data-explain]')).toBeHidden();
    expect(await s.innerText()).not.toContain(numeric.explanation.text);

    // The same answer again is not a second attempt.
    await page.keyboard.press('Enter');
    await expect(status).toHaveText('That is the answer you already tried. Change it, then check again.');

    // A decimal comma is a decimal.
    await input.press('ControlOrMeta+a');
    await page.keyboard.type(`${numeric.answer},0`);
    await tabUntil(page, browserName, (a) => a.does === 'check');
    await page.keyboard.press('Enter');
    await expect(status).toContainText('Correct.');
    await expect(status).toHaveAttribute('data-tone', 'good');
    await expect(input).toHaveJSProperty('readOnly', true);
    await expect(s.locator('[data-explain]')).toContainText(numeric.explanation.text);
    // Right in the end, so the answer need not be spelled out again; the first attempt is what was recorded.
    await expect(s.locator('[data-solution]')).toBeHidden();
    expect(await stored(page, lesson.id)).toEqual([[NUMERIC.id, 'incorrect']]);
    expect(await seen(page, 'lt:result')).toEqual([{ sceneId: NUMERIC.id, objective: NUMERIC.objective, result: 'incorrect' }]);
    await expectClean(watch, browserName);
  });

  test('wrong twice shows the answer with its unit, and trying again clears the field and takes focus there', async ({ page, browserName }, testInfo) => {
    await openLesson(page, testInfo, { hash: `#/${NUMERIC.id}` });
    const s = page.locator(scene(NUMERIC.id));
    const input = field(page);
    await tabUntil(page, browserName, (a) => a.tag === 'INPUT' && a.type === 'text' && a.scene === NUMERIC.id);
    await page.keyboard.type(TOO_LOW);
    await page.keyboard.press('Enter');
    await expect(statusOf(page, NUMERIC.id)).toContainText('Your answer is too low.');
    await input.press('ControlOrMeta+a');
    await page.keyboard.type(FAR_TOO_HIGH);
    await page.keyboard.press('Enter');
    await expect(statusOf(page, NUMERIC.id)).toContainText('Not quite.');
    await expect(s.locator('[data-solution]')).toContainText(`${numeric.answer} ${numeric.unit}`);
    await expect(s.locator('.lt-numeric')).toContainText('Not this one');

    await tabUntil(page, browserName, (a) => a.does === 'again');
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('');
    await expect(input).toHaveJSProperty('readOnly', false);
    expect((await active(page)).tag).toBe('INPUT');
    await expect(s.locator('[data-explain]')).toBeHidden();
  });

  test('an answer inside the tolerance counts, and the exact value is given', async ({ page, browserName }, testInfo) => {
    const published = lessonWith((p) => setQuestion(p, NUMERIC.id, { ...EXAMPLE_QUESTIONS.numeric, answer: 1.25, tolerance: 0.05, unit: 'ms' }));
    await openLesson(page, testInfo, { hash: `#/${NUMERIC.id}`, published });
    await tabUntil(page, browserName, (a) => a.tag === 'INPUT' && a.type === 'text' && a.scene === NUMERIC.id);
    // 1.3 - 1.25 is a hair over 0.05 in binary. It is inside the tolerance all the same. The unit may be typed along.
    await page.keyboard.type('1,3 ms');
    await page.keyboard.press('Enter');
    await expect(statusOf(page, NUMERIC.id)).toContainText('Correct.');
    await expect(statusOf(page, NUMERIC.id)).toContainText('Close enough to count. The exact answer:');
    await expect(statusOf(page, NUMERIC.id)).toContainText('1.25 ms');
    expect(await stored(page, published.lesson.id)).toEqual([[NUMERIC.id, 'correct']]);
  });

  // Review finding P9. Both readings of "20,000" used to be tried, and twenty was one of them.
  test('a thousand times the answer is wrong: "20,000" is not twenty in an English lesson', async ({ page, browserName }, testInfo) => {
    const published = lessonWith((p) => setQuestion(p, NUMERIC.id, { ...EXAMPLE_QUESTIONS.numeric, answer: 20, tolerance: 0 }));
    await openLesson(page, testInfo, { hash: `#/${NUMERIC.id}`, published });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const input = field(page);
    await tabUntil(page, browserName, (a) => a.tag === 'INPUT' && a.type === 'text' && a.scene === NUMERIC.id);
    await page.keyboard.type('20,000');
    await page.keyboard.press('Enter');
    await expect(statusOf(page, NUMERIC.id)).toContainText('Not quite.');
    await expect(statusOf(page, NUMERIC.id)).toContainText('Your answer is too high.');
    expect(await stored(page, published.lesson.id)).toEqual([[NUMERIC.id, 'incorrect']]);
    // Twenty written with decimals is still twenty.
    await input.press('ControlOrMeta+a');
    await page.keyboard.type('20.000');
    await page.keyboard.press('Enter');
    await expect(statusOf(page, NUMERIC.id)).toContainText('Correct.');
  });

  test('in a lesson whose language writes a decimal comma it is the other way round', async ({ page, browserName }, testInfo) => {
    const published = lessonWith((p) => {
      p.lesson.language = 'de';
      setQuestion(p, NUMERIC.id, { ...EXAMPLE_QUESTIONS.numeric, answer: 2, tolerance: 0 });
    });
    await openLesson(page, testInfo, { hash: `#/${NUMERIC.id}`, published });
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    const input = field(page);
    await tabUntil(page, browserName, (a) => a.tag === 'INPUT' && a.type === 'text' && a.scene === NUMERIC.id);
    await page.keyboard.type('2.000');
    await page.keyboard.press('Enter');
    await expect(statusOf(page, NUMERIC.id)).toContainText('Your answer is too high.');
    await input.press('ControlOrMeta+a');
    await page.keyboard.type('2,000');
    await page.keyboard.press('Enter');
    await expect(statusOf(page, NUMERIC.id)).toContainText('Correct.');
    expect(await stored(page, published.lesson.id)).toEqual([[NUMERIC.id, 'incorrect']]);
  });

  test('an answer that is right only in its other reading is asked for again, and costs no attempt', async ({ page, browserName }, testInfo) => {
    const published = lessonWith((p) => setQuestion(p, NUMERIC.id, { ...EXAMPLE_QUESTIONS.numeric, answer: 1.25, tolerance: 0, unit: 'ms' }));
    await openLesson(page, testInfo, { hash: `#/${NUMERIC.id}`, published });
    await record(page);
    const s = page.locator(scene(NUMERIC.id));
    const input = field(page);
    await tabUntil(page, browserName, (a) => a.tag === 'INPUT' && a.type === 'text' && a.scene === NUMERIC.id);
    // Someone who writes a decimal comma types one and a quarter to three places. In English that reads as 1250.
    await page.keyboard.type('1,250');
    await page.keyboard.press('Enter');
    await expect(statusOf(page, NUMERIC.id)).toHaveText('That can be read as 1250 or as 1.25. Type it again the way you mean it, with nothing between the thousands.');
    await expect(statusOf(page, NUMERIC.id)).toHaveAttribute('data-tone', 'warn');
    // Nothing was graded: no result, no verdict, the answer still hidden, the field still open.
    expect(await stored(page, published.lesson.id)).toEqual([]);
    expect(await seen(page, 'lt:result')).toEqual([]);
    await expect(s.locator('[data-explain]')).toBeHidden();
    await expect(input).toHaveJSProperty('readOnly', false);
    expect((await active(page)).tag).toBe('INPUT');

    // Typed unambiguously, it is the first attempt, and it is right.
    await input.press('ControlOrMeta+a');
    await page.keyboard.type('1,25');
    await page.keyboard.press('Enter');
    await expect(statusOf(page, NUMERIC.id)).toContainText('Correct.');
    expect(await stored(page, published.lesson.id)).toEqual([[NUMERIC.id, 'correct']]);
  });

  // Review finding P1. The answer was shown rounded to twelve digits: 2^40 as 1099511627780, which the grader then refused.
  test('a long answer is shown digit for digit, and typing what is shown is right', async ({ page, browserName }, testInfo) => {
    const answer = 1099511627776;
    const published = lessonWith((p) => setQuestion(p, NUMERIC.id, { ...EXAMPLE_QUESTIONS.numeric, answer, tolerance: 0, unit: 'bytes' }));
    await openLesson(page, testInfo, { hash: `#/${NUMERIC.id}`, published });
    const s = page.locator(scene(NUMERIC.id));
    const input = field(page);
    await tabUntil(page, browserName, (a) => a.tag === 'INPUT' && a.type === 'text' && a.scene === NUMERIC.id);
    for (const miss of ['1099511627780', '1']) {
      await input.press('ControlOrMeta+a');
      await page.keyboard.type(miss);
      await page.keyboard.press('Enter');
      await expect(statusOf(page, NUMERIC.id)).toContainText('Not quite.');
    }
    // Out of tries: the answer the page now shows is the lesson's own.
    const shown = (await s.locator('[data-solution] .lt-solution-value').innerText()).replace(/\s+/g, ' ');
    expect(shown).toBe(`${answer} bytes`);
    // And that number, typed back, is what the grader accepts.
    await tabUntil(page, browserName, (a) => a.does === 'again');
    await page.keyboard.press('Enter');
    await page.keyboard.type(shown);
    await page.keyboard.press('Enter');
    await expect(statusOf(page, NUMERIC.id)).toContainText('Correct.');
    await expect(statusOf(page, NUMERIC.id)).not.toContainText('Close enough');
  });

  test('nothing typed is stored, and a reload starts with an empty field', async ({ page, browserName }, testInfo) => {
    await openLesson(page, testInfo, { hash: `#/${NUMERIC.id}` });
    await tabUntil(page, browserName, (a) => a.tag === 'INPUT' && a.type === 'text' && a.scene === NUMERIC.id);
    await page.keyboard.type('31337');
    await page.keyboard.press('Enter');
    await expect(statusOf(page, NUMERIC.id)).toContainText('Not quite.');
    const everything = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)) + JSON.stringify(Object.entries(sessionStorage)));
    expect(everything).not.toContain('31337');
    await page.reload();
    await expect(field(page)).toHaveValue('');
  });
});

test.describe('ordering', () => {
  const items = order.items;
  const rows = (page: import('@playwright/test').Page) => page.locator(`${scene(ORDER.id)} ol.lt-order > li`);
  const name = (i: number): string => items[i] as string;

  /** Move the item that belongs at `to` up into place, by pressing its own Move up button. Returns the presses made. */
  async function raise(page: import('@playwright/test').Page, browserName: string, item: number, to: number): Promise<number> {
    let at = (await shownOrder(page, ORDER.id, 'item')).indexOf(item);
    if (at === to) return 0;
    const now = await active(page);
    if (!(now.does === 'up' && now.item === String(item))) await tabUntil(page, browserName, (a) => a.does === 'up' && a.item === String(item));
    let presses = 0;
    while (at > to) {
      await page.keyboard.press(presses % 2 === 0 ? 'Enter' : 'Space');
      at -= 1;
      presses += 1;
      await expect(statusOf(page, ORDER.id)).toHaveText(`“${name(item)}” moved up to position ${at + 1} of ${items.length}.`);
      // Focus stays on the button of the item that moved, wherever it now is.
      expect(await active(page)).toMatchObject({ does: 'up', item: String(item) });
      expect((await shownOrder(page, ORDER.id, 'item'))[at]).toBe(item);
    }
    return presses;
  }

  test('starts shuffled and never solved, as a labelled list with two named buttons per item', async ({ page }, testInfo) => {
    for (const hash of ['a'.repeat(64), OTHER_HASH, 'c'.repeat(64), '0123456789abcdef'.repeat(4)]) {
      await openLesson(page, testInfo, { hash: `#/${ORDER.id}`, published: lessonWith(undefined, { hash }) });
      const start = await shownOrder(page, ORDER.id, 'item');
      expect([...start].sort()).toEqual(items.map((_, i) => i));
      expect(start, hash).not.toEqual(items.map((_, i) => i));
    }
    const list = page.getByRole('list', { name: order.prompt });
    await expect(list.getByRole('listitem')).toHaveCount(items.length);
    for (const item of items) {
      await expect(page.getByRole('button', { name: `Move up: ${item}` })).toHaveCount(1);
      await expect(page.getByRole('button', { name: `Move down: ${item}` })).toHaveCount(1);
    }
    await expect(rows(page).first().locator('button[data-move="up"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(rows(page).last().locator('button[data-move="down"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(statusOf(page, ORDER.id)).toHaveCount(1);
    await expect(statusOf(page, ORDER.id)).toBeEmpty();
  });

  test('moved with the keyboard: each move is announced with the new position, focus stays on the moved item, and the ends say so', async ({ page, browserName }, testInfo) => {
    const watch = await openLesson(page, testInfo, { hash: `#/${ORDER.id}` });
    await record(page);
    const s = page.locator(scene(ORDER.id));
    const status = statusOf(page, ORDER.id);

    // Checking before anything has moved costs nothing.
    await tabUntil(page, browserName, (a) => a.does === 'check' && a.scene === ORDER.id);
    await page.keyboard.press('Enter');
    await expect(status).toHaveText('Move at least one item first.');
    expect(await stored(page, lesson.id)).toEqual([]);

    // The first item cannot go further up, and says so.
    const start = await shownOrder(page, ORDER.id, 'item');
    const top = start[0] as number;
    await tabUntil(page, browserName, (a) => a.does === 'up' && a.item === String(top), { back: true });
    expect((await active(page)).disabled).toBe(true);
    await page.keyboard.press('Enter');
    await expect(status).toHaveText(`“${name(top)}” is already first.`);
    expect(await shownOrder(page, ORDER.id, 'item')).toEqual(start);

    // One move down, with the other button of the same item.
    await tab(page, browserName);
    expect(await active(page)).toMatchObject({ does: 'down', item: String(top) });
    await page.keyboard.press('Enter');
    await expect(status).toHaveText(`“${name(top)}” moved down to position 2 of ${items.length}.`);
    expect(await active(page)).toMatchObject({ does: 'down', item: String(top) });
    expect((await shownOrder(page, ORDER.id, 'item'))[1]).toBe(top);

    // A first attempt that is not yet right: the count of items in place, and one more try.
    const mixed = await shownOrder(page, ORDER.id, 'item');
    const placed = mixed.filter((item, at) => item === at).length;
    expect(placed).toBeLessThan(items.length);
    await tabUntil(page, browserName, (a) => a.does === 'check');
    await page.keyboard.press('Enter');
    await expect(status).toContainText('Not quite.');
    await expect(status).toContainText(placed === 0 ? 'No item is in the right place yet.' : `${placed} of ${items.length} items ${placed === 1 ? 'is' : 'are'} in the right place.`);
    await expect(status).toContainText('You have one more try.');
    expect((await active(page)).does).toBe('check');
    expect(await stored(page, lesson.id)).toEqual([[ORDER.id, 'incorrect']]);
    await expect(s.locator('[data-explain]')).toBeHidden();

    // Unchanged, a second check is refused rather than spent.
    await page.keyboard.press('Enter');
    await expect(status).toHaveText('Change the order, then check again.');

    // Put every item in place from the top down, then check.
    await tabUntil(page, browserName, (a) => a.does === 'up' || a.does === 'down', { back: true, limit: 12 });
    await tabUntil(page, browserName, (a) => a.scene !== ORDER.id || a.tag === 'BODY', { back: true, limit: 20 });
    for (let to = 0; to < items.length; to++) await raise(page, browserName, to, to);
    expect(await shownOrder(page, ORDER.id, 'item')).toEqual(items.map((_, i) => i));
    await tabUntil(page, browserName, (a) => a.does === 'check');
    await page.keyboard.press('Enter');
    await expect(status).toContainText('Correct.');
    await expect(s.locator('[data-explain]')).toContainText(order.explanation.text);
    await expect(s.locator('[data-solution]')).toBeHidden();
    await expect(s.locator('button[data-move]:visible')).toHaveCount(0);
    expect(await stored(page, lesson.id)).toEqual([[ORDER.id, 'incorrect']]);
    expect(await seen(page, 'lt:result')).toEqual([{ sceneId: ORDER.id, objective: ORDER.objective, result: 'incorrect' }]);
    await expectClean(watch, browserName);
  });

  test('right at the first check is recorded as correct', async ({ page, browserName }, testInfo) => {
    await openLesson(page, testInfo, { hash: `#/${ORDER.id}` });
    for (let to = 0; to < items.length; to++) await raise(page, browserName, to, to);
    await tabUntil(page, browserName, (a) => a.does === 'check');
    await page.keyboard.press('Enter');
    await expect(statusOf(page, ORDER.id)).toContainText('Correct.');
    expect(await stored(page, lesson.id)).toEqual([[ORDER.id, 'correct']]);
  });

  test('wrong twice: each item is marked in words, the correct order is shown, and trying again puts the start back', async ({ page, browserName }, testInfo) => {
    await openLesson(page, testInfo, { hash: `#/${ORDER.id}` });
    const s = page.locator(scene(ORDER.id));
    const start = await shownOrder(page, ORDER.id, 'item');
    const down = async (): Promise<void> => {
      const top = (await shownOrder(page, ORDER.id, 'item'))[0] as number;
      await tabUntil(page, browserName, (a) => a.does === 'down' && a.item === String(top));
      await page.keyboard.press('Enter');
      await tabUntil(page, browserName, (a) => a.does === 'check');
      await page.keyboard.press('Enter');
    };
    // Two checks, each after a move that cannot have solved it: the second undoes the first, which was the unsolved start.
    await down();
    const afterFirst = await shownOrder(page, ORDER.id, 'item');
    test.skip(
      afterFirst.every((item, at) => item === at),
      'this start is one move from solved',
    );
    await expect(statusOf(page, ORDER.id)).toContainText('one more try');
    await tabUntil(page, browserName, (a) => a.scene !== ORDER.id || a.tag === 'BODY', { back: true, limit: 20 });
    await down();
    const final = await shownOrder(page, ORDER.id, 'item');
    await expect(statusOf(page, ORDER.id)).toContainText('The correct order is below.');
    for (const [at, item] of final.entries()) {
      const row = s.locator(`li[data-item="${item}"]`);
      await expect(row).toContainText(item === at ? 'In place' : 'Out of place');
      await expect(row).toHaveAttribute('data-state', item === at ? 'right' : 'wrong');
    }
    expect(await s.locator('[data-solution] li').allTextContents()).toEqual([...items]);
    await expect(s.locator('button[data-move]:visible')).toHaveCount(0);

    await tabUntil(page, browserName, (a) => a.does === 'again');
    await page.keyboard.press('Enter');
    expect(await shownOrder(page, ORDER.id, 'item')).toEqual(start);
    expect(await active(page)).toMatchObject({ does: 'down', item: String(start[0]) });
    await expect(s.locator('[data-state]')).toHaveCount(0);
    await expect(s.locator('button[data-move]:visible')).toHaveCount(items.length * 2);
  });
});

test.describe('reflect', () => {
  const id = NUMERIC.id;
  const published = withReflect(id);
  const q = EXAMPLE_QUESTIONS.reflect as { prompt: string; modelAnswer: { text: string }; lookFor: string[] };
  const typed = 'Because throwing away a half only works when order says where the target is.';

  test('write, reveal, tick, rate: all from the keyboard, with the model answer held back until asked for', async ({ page, browserName }, testInfo) => {
    const watch = await openLesson(page, testInfo, { hash: `#/${id}`, published });
    await record(page);
    const s = page.locator(scene(id));
    const status = statusOf(page, id);
    await expect(status).toHaveCount(1);
    await expect(status).toBeEmpty();
    expect(await s.innerText()).not.toContain(q.modelAnswer.text);
    await expect(page.getByRole('textbox', { name: q.prompt })).toHaveCount(1);

    // Asked with nothing written: reminded once, in words, and not refused twice.
    await tabUntil(page, browserName, (a) => a.does === 'reveal' && a.scene === id);
    await page.keyboard.press('Enter');
    await expect(status).toContainText('Write your own answer first');
    await expect(s.locator('[data-explain]')).toBeHidden();
    expect((await active(page)).does).toBe('reveal');

    await tabUntil(page, browserName, (a) => a.tag === 'TEXTAREA', { back: true });
    await page.keyboard.type(typed);
    await tabUntil(page, browserName, (a) => a.does === 'reveal');
    await page.keyboard.press('Enter');
    await expect(status).toHaveText('The model answer is shown above. Compare it with yours, then rate how close you were.');
    await expect(s.locator('[data-explain]')).toContainText(q.modelAnswer.text);
    expect((await active(page)).does).toBe('reveal');
    await expect(s.locator('button[data-act="reveal"]')).toHaveAttribute('aria-disabled', 'true');
    expect(await stored(page, published.lesson.id)).toEqual([]);

    // The model answer's source, then the look-for checklist.
    await tabUntil(page, browserName, (a) => a.tag === 'BUTTON' && a.does === '' && a.scene === id, { limit: 3 });
    await page.keyboard.press('Enter');
    await expect(s.locator('.lt-source:popover-open')).toHaveCount(1);
    await page.keyboard.press('Escape');
    for (const item of q.lookFor) await expect(page.getByRole('checkbox', { name: item })).toHaveCount(1);
    await tabUntil(page, browserName, (a) => a.type === 'checkbox');
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: q.lookFor[0] as string })).toBeChecked();

    // The self-rating: three radios in a named group. Each choice is kept, and can be changed.
    const group = page.getByRole('group', { name: 'How close was your answer?' });
    await expect(group.getByRole('radio')).toHaveCount(3);
    await tabUntil(page, browserName, (a) => a.type === 'radio' && a.scene === id);
    await page.keyboard.press('Space');
    await expect(status).toHaveText('Rating kept: got it.');
    expect(await stored(page, published.lesson.id)).toEqual([[id, 'yes']]);
    await page.keyboard.press('ArrowRight');
    await expect(status).toHaveText('Rating kept: partly.');
    await expect(group.getByRole('radio', { name: 'Partly' })).toBeChecked();
    expect(await stored(page, published.lesson.id)).toEqual([[id, 'partly']]);
    expect(await seen(page, 'lt:result')).toEqual([
      { sceneId: id, objective: NUMERIC.objective, result: 'yes' },
      { sceneId: id, objective: NUMERIC.objective, result: 'partly' },
    ]);

    // What was typed is in the field and nowhere else.
    const everything = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)) + JSON.stringify(Object.entries(sessionStorage)) + document.cookie);
    expect(everything).not.toContain('throwing away');
    await expect(s.locator('textarea')).toHaveValue(typed);
    await expectClean(watch, browserName);
  });

  test('a second press shows the model answer to someone who chose not to write', async ({ page, browserName }, testInfo) => {
    await openLesson(page, testInfo, { hash: `#/${id}`, published });
    const s = page.locator(scene(id));
    await tabUntil(page, browserName, (a) => a.does === 'reveal' && a.scene === id);
    await page.keyboard.press('Enter');
    await expect(s.locator('[data-explain]')).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(s.locator('[data-explain]')).toContainText(q.modelAnswer.text);
  });

  test('after a reload the writing is gone, the rating is remembered, and the model answer is held back again', async ({ page, browserName }, testInfo) => {
    await openLesson(page, testInfo, { hash: `#/${id}`, published });
    const s = page.locator(scene(id));
    await tabUntil(page, browserName, (a) => a.tag === 'TEXTAREA' && a.scene === id);
    await page.keyboard.type(typed);
    await tabUntil(page, browserName, (a) => a.does === 'reveal');
    await page.keyboard.press('Enter');
    await tabUntil(page, browserName, (a) => a.type === 'radio' && a.scene === id);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(statusOf(page, id)).toHaveText('Rating kept: not yet.');

    await page.reload();
    await expect(s.locator('textarea')).toHaveValue('');
    await expect(s.locator('[data-earlier]')).toHaveText('Earlier you rated your answer: not yet.');
    await expect(s.locator('[data-explain]')).toBeHidden();
    await expect(statusOf(page, id)).toBeEmpty();
    await s.locator('button[data-act="reveal"]').press('Enter');
    await s.locator('button[data-act="reveal"]').press('Enter');
    await expect(page.getByRole('radio', { name: 'Not yet' })).toBeChecked();

    const recap = published.lesson.scenes.at(-1)?.id as string;
    await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), recap);
    await expect(page.locator(`${scene(recap)} [data-result="${id}"]`)).toHaveText('You rated your answer: not yet');
  });
});

test('reading a checkpoint aloud gives nothing away: the hint stays shut until the learner opens it, and the answer stays out of sight', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo, { hash: `#/${SINGLE.id}`, published: withSilentAudio([SINGLE.id]) });
  const s = page.locator(scene(SINGLE.id));
  const hint = s.locator('details.lt-hint');
  await page.locator('#lt-play').click();
  await expect(page.locator('#lt-play')).toHaveText('Pause');
  await expect(s.locator('.lt-reading')).toHaveCount(1);
  await expect(hint.locator('.lt-reveal-body')).toBeHidden();
  expect(await hint.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
  const shown = await s.innerText();
  expect(shown).not.toContain(single.hint as string);
  expect(shown).not.toContain(single.explanation.text);
  for (const o of single.options) expect(shown).not.toContain(o.feedback);

  // Opened by the learner, with the keyboard or the pointer, it opens and stays open, also while the reading goes on.
  await tabUntil(page, browserName, (a) => a.tag === 'SUMMARY' && a.scene === SINGLE.id);
  await page.keyboard.press('Enter');
  await expect(hint.locator('.lt-reveal-body')).toHaveText(single.hint as string);
  await page.keyboard.press('Enter');
  await expect(hint.locator('.lt-reveal-body')).toBeHidden();
  await hint.locator('summary').click();
  await expect(hint.locator('.lt-reveal-body')).toBeVisible();
  await page.locator('#lt-play').click();
  await page.locator('#lt-play').click();
  await expect(hint.locator('.lt-reveal-body')).toBeVisible();
  await expectClean(watch, browserName);
});

test('every checkpoint of the example, answered from the keyboard, ends up in the recap and the summary', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo, { hash: `#/${SINGLE.id}` });
  await tabUntil(page, browserName, (a) => a.type === 'radio' && a.scene === SINGLE.id);
  await choose(page, SINGLE.id, right);
  await tabUntil(page, browserName, (a) => a.does === 'check');
  await page.keyboard.press('Enter');
  await expect(statusOf(page, SINGLE.id)).toContainText('Correct.');

  await page.evaluate((id) => (location.hash = `#/${id}`), NUMERIC.id);
  await tabUntil(page, browserName, (a) => a.tag === 'INPUT' && a.type === 'text' && a.scene === NUMERIC.id);
  await page.keyboard.type(TOO_HIGH);
  await page.keyboard.press('Enter');
  await expect(statusOf(page, NUMERIC.id)).toContainText('Not quite.');

  const recap = lesson.scenes.at(-1)?.id as string;
  await page.evaluate((id) => (location.hash = `#/${id}`), recap);
  const r = page.locator(scene(recap));
  await expect(r.locator(`[data-result="${SINGLE.id}"]`)).toHaveText('✓ Right on your first attempt');
  await expect(r.locator(`[data-result="${NUMERIC.id}"]`)).toHaveText('✗ Not right on your first attempt');
  await expect(r.locator(`[data-result="${ORDER.id}"]`)).toHaveText('Not answered yet');
  const summary = await r.locator('textarea[data-summary]').inputValue();
  expect(summary).toContain(`${SINGLE.title}: right on the first attempt`);
  expect(summary).toContain(`${NUMERIC.title}: not right on the first attempt`);
  expect(summary).toContain(`${ORDER.title}: not answered`);
  expect(summary).toContain(`Checkpoints answered: 2 of ${lesson.scenes.filter((x) => x.kind === 'checkpoint').length}`);
  // The link back from the recap lands on the checkpoint, which still shows how it went.
  await r.locator(`.lt-recap-checks a[data-goto="${NUMERIC.id}"]`).press('Enter');
  await expect(statusOf(page, NUMERIC.id)).toContainText('Not quite.');
  await expectClean(watch, browserName);
});

test('served from the local listener instead of a file, a question and a step-through work the same and ask the server for nothing more', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo, { hash: `#/${SINGLE.id}`, via: 'http' });
  await tabUntil(page, browserName, (a) => a.type === 'radio' && a.scene === SINGLE.id);
  await choose(page, SINGLE.id, wrong[0] as number);
  await tabUntil(page, browserName, (a) => a.does === 'check');
  await page.keyboard.press('Enter');
  await expect(statusOf(page, SINGLE.id)).toContainText('You have one more try.');
  expect(await stored(page, lesson.id)).toEqual([[SINGLE.id, 'incorrect']]);

  const steps = lesson.scenes.find((x) => x.kind === 'step_through')?.id as string;
  await page.evaluate((id) => (location.hash = `#/${id}`), steps);
  await tabUntil(page, browserName, (a) => a.does === 'next' && a.scene === steps);
  await page.keyboard.press('Enter');
  await expect(statusOf(page, steps)).toContainText('Step 2 of');
  await page.reload();
  await expect(statusOf(page, steps)).toHaveText(/^Step 2 of \d+$/);
  await expectClean(watch, browserName);
  expect(new Set(watch.serverHits)).toEqual(new Set([`GET ${new URL(watch.url).pathname}`]));
});
