// Every state a question can be in, audited with axe-core in both themes and at 320 pixels, plus
// the things axe has no rule for: reflow, text spacing, forced colours, state that does not depend
// on colour, interface words marked as English, and print.
import type { Page } from '@playwright/test';
import { EXAMPLE_QUESTIONS } from '../../src/core/examples';
import type { CheckpointScene, NumericQuestion, SingleQuestion } from '../../src/core/schema';
import { examplePublished } from '../helpers/example';
import { audit, lessonWith, openFresh, pageWidth, scene, setQuestion, shownOrder, smallControls, spaceText, statusOf, withReflect } from './questions-kit';
import { expect, expectClean, openLesson, test } from './shell-kit';

const lesson = examplePublished().lesson;
const checkpoint = (type: string): CheckpointScene => lesson.scenes.find((s): s is CheckpointScene => s.kind === 'checkpoint' && s.question.type === type) as CheckpointScene;
const SINGLE = checkpoint('single');
const NUMERIC = checkpoint('numeric');
const ORDER = checkpoint('order');
const single = SINGLE.question as SingleQuestion;
const right = single.options.findIndex((o) => o.correct);
const wrong = single.options.flatMap((o, i) => (o.correct ? [] : [i]));
const numeric = NUMERIC.question as NumericQuestion;
const TOO_HIGH = String(numeric.answer + 5);
const TOO_LOW = String(numeric.answer - 3);
/** The checkpoint whose question the reflect variant replaces. */
const REFLECT = NUMERIC.id;

const go = async (page: Page, id: string): Promise<void> => {
  await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), id);
  await expect(page.locator(scene(id))).toBeVisible();
};
const option = (page: Page, i: number) => page.locator(`${scene(SINGLE.id)} label.lt-option[data-option="${i}"] input`);
const check = (page: Page, id: string) => page.locator(`${scene(id)} button[data-act="check"]`);
const number = (page: Page) => page.locator(`${scene(NUMERIC.id)} input.lt-number`);
const moveTopDown = async (page: Page): Promise<void> => {
  const top = (await shownOrder(page, ORDER.id, 'item'))[0];
  await page.locator(`${scene(ORDER.id)} li[data-item="${top}"] button[data-move="down"]`).click();
};

interface State {
  name: string;
  scene: string;
  reach(page: Page): Promise<void>;
}

/** The states of the three graded questions, each reached from a freshly opened page. */
const GRADED: State[] = [
  { name: 'single, untouched', scene: SINGLE.id, reach: async () => {} },
  {
    name: 'single, an option chosen and the hint open',
    scene: SINGLE.id,
    reach: async (page) => {
      await option(page, wrong[0] as number).check();
      await page.locator(`${scene(SINGLE.id)} details.lt-hint summary`).click();
    },
  },
  {
    name: 'single, asked to choose first',
    scene: SINGLE.id,
    reach: async (page) => {
      await check(page, SINGLE.id).click();
      await expect(statusOf(page, SINGLE.id)).toContainText('Choose');
    },
  },
  {
    name: 'single, wrong once',
    scene: SINGLE.id,
    reach: async (page) => {
      await option(page, wrong[0] as number).check();
      await check(page, SINGLE.id).click();
      await expect(statusOf(page, SINGLE.id)).toContainText('one more try');
    },
  },
  {
    name: 'single, wrong twice',
    scene: SINGLE.id,
    reach: async (page) => {
      await option(page, wrong[0] as number).check();
      await check(page, SINGLE.id).click();
      await option(page, wrong[1] as number).check();
      await check(page, SINGLE.id).click();
      await expect(page.locator(`${scene(SINGLE.id)} [data-explain]`)).toBeVisible();
    },
  },
  {
    name: 'single, right',
    scene: SINGLE.id,
    reach: async (page) => {
      await option(page, right).check();
      await check(page, SINGLE.id).click();
      await expect(page.locator(`${scene(SINGLE.id)} [data-explain]`)).toBeVisible();
    },
  },
  { name: 'numeric, untouched', scene: NUMERIC.id, reach: async () => {} },
  {
    name: 'numeric, not a number',
    scene: NUMERIC.id,
    reach: async (page) => {
      await number(page).fill('a great many');
      await check(page, NUMERIC.id).click();
      await expect(statusOf(page, NUMERIC.id)).toContainText('does not read as a number');
    },
  },
  {
    name: 'numeric, wrong once',
    scene: NUMERIC.id,
    reach: async (page) => {
      await number(page).fill(TOO_HIGH);
      await check(page, NUMERIC.id).click();
      await expect(statusOf(page, NUMERIC.id)).toContainText('too high');
    },
  },
  {
    name: 'numeric, wrong twice',
    scene: NUMERIC.id,
    reach: async (page) => {
      await number(page).fill(TOO_HIGH);
      await check(page, NUMERIC.id).click();
      await number(page).fill(TOO_LOW);
      await check(page, NUMERIC.id).click();
      await expect(page.locator(`${scene(NUMERIC.id)} [data-solution]`)).toBeVisible();
    },
  },
  {
    name: 'numeric, right',
    scene: NUMERIC.id,
    reach: async (page) => {
      await number(page).fill(String(numeric.answer));
      await check(page, NUMERIC.id).click();
      await expect(page.locator(`${scene(NUMERIC.id)} [data-explain]`)).toBeVisible();
    },
  },
  { name: 'order, untouched', scene: ORDER.id, reach: async () => {} },
  {
    name: 'order, one item moved',
    scene: ORDER.id,
    reach: async (page) => {
      await moveTopDown(page);
      await expect(statusOf(page, ORDER.id)).toContainText('moved down');
    },
  },
  {
    name: 'order, wrong once',
    scene: ORDER.id,
    reach: async (page) => {
      await moveTopDown(page);
      await check(page, ORDER.id).click();
      await expect(statusOf(page, ORDER.id)).toContainText(/one more try|Correct/);
    },
  },
  {
    name: 'order, finished',
    scene: ORDER.id,
    reach: async (page) => {
      await moveTopDown(page);
      await check(page, ORDER.id).click();
      await moveTopDown(page);
      await check(page, ORDER.id).click();
      await expect(page.locator(`${scene(ORDER.id)} [data-explain]`)).toBeVisible();
    },
  },
];

const REFLECTED: State[] = [
  { name: 'reflect, untouched', scene: REFLECT, reach: async () => {} },
  {
    name: 'reflect, asked to write first',
    scene: REFLECT,
    reach: async (page) => {
      await page.locator(`${scene(REFLECT)} button[data-act="reveal"]`).click();
      await expect(statusOf(page, REFLECT)).toContainText('Write your own answer first');
    },
  },
  {
    name: 'reflect, model answer shown, one item ticked, rated',
    scene: REFLECT,
    reach: async (page) => {
      await page.locator(`${scene(REFLECT)} textarea`).fill('Sorted order is what tells you which half to drop.');
      await page.locator(`${scene(REFLECT)} button[data-act="reveal"]`).click();
      await page.locator(`${scene(REFLECT)} .lt-look input`).first().check();
      await page.locator(`${scene(REFLECT)} .lt-rate input[value="partly"]`).check();
      await expect(statusOf(page, REFLECT)).toContainText('Rating kept');
    },
  },
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('every state of the graded questions passes axe', async ({ page, browserName }, testInfo) => {
      test.slow();
      for (const state of GRADED) {
        const watch = await openFresh(page, testInfo, { hash: `#/${state.scene}` });
        await state.reach(page);
        await audit(page, `${scheme}: ${state.name}`);
        expect(await smallControls(page), `${state.name}: controls under 24 by 24`).toEqual([]);
        await expectClean(watch, browserName);
      }
    });

    test('every state of a reflect question passes axe', async ({ page, browserName }, testInfo) => {
      for (const state of REFLECTED) {
        const watch = await openFresh(page, testInfo, { hash: `#/${state.scene}`, published: withReflect(REFLECT) });
        await state.reach(page);
        await audit(page, `${scheme}: ${state.name}`);
        expect(await smallControls(page), `${state.name}: controls under 24 by 24`).toEqual([]);
        await expectClean(watch, browserName);
      }
    });

    test('a question that was answered on an earlier visit passes axe', async ({ page }, testInfo) => {
      await openLesson(page, testInfo, { hash: `#/${SINGLE.id}` });
      await option(page, right).check();
      await check(page, SINGLE.id).click();
      await page.reload();
      await expect(page.locator(`${scene(SINGLE.id)} [data-earlier]`)).toBeVisible();
      await audit(page, `${scheme}: earlier result`);
    });
  });
}

test.describe('at 320 pixels wide', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('no state of any question scrolls sideways, also with text spacing increased, and each passes axe', async ({ page }, testInfo) => {
    test.slow();
    for (const [states, published] of [
      [GRADED, undefined],
      [REFLECTED, withReflect(REFLECT)],
    ] as const) {
      for (const state of states) {
        await openFresh(page, testInfo, { hash: `#/${state.scene}`, published });
        await state.reach(page);
        expect(await pageWidth(page), state.name).toBeLessThanOrEqual(320);
        await audit(page, `320px: ${state.name}`);
        expect(await smallControls(page), `${state.name}: controls under 24 by 24`).toEqual([]);
        await spaceText(page);
        expect(await pageWidth(page), `${state.name}, text spaced`).toBeLessThanOrEqual(320);
        const box = await page.locator(`${scene(state.scene)} .lt-question`).boundingBox();
        expect(box && box.x >= 0 && box.x + box.width <= 320.5, `${state.name}: the question fits`).toBe(true);
      }
    }
  });

  test('long options, a long unit and long items wrap instead of widening the page', async ({ page }, testInfo) => {
    const long = 'Pneumonoultramicroscopicsilicovolcanoconiosis-and-then-some-more-letters-without-any-space';
    const published = lessonWith((p) => {
      setQuestion(p, SINGLE.id, { ...EXAMPLE_QUESTIONS.single, options: single.options.map((o) => ({ ...o, text: `${long} ${o.text}`.slice(0, 120) })) });
      setQuestion(p, NUMERIC.id, { ...EXAMPLE_QUESTIONS.numeric, unit: 'kilometres/hour' });
      setQuestion(p, ORDER.id, { ...EXAMPLE_QUESTIONS.order, items: ['one', 'two', 'three'].map((w) => `${long} ${w}`) });
    });
    await openLesson(page, testInfo, { published });
    for (const id of [SINGLE.id, NUMERIC.id, ORDER.id]) {
      await go(page, id);
      expect(await pageWidth(page), id).toBeLessThanOrEqual(320);
    }
    await go(page, ORDER.id);
    const explained = page.locator(`${scene(ORDER.id)} [data-explain]`);
    for (let tries = 0; tries < 2 && !(await explained.isVisible()); tries++) {
      await moveTopDown(page);
      await check(page, ORDER.id).click();
      await expect(statusOf(page, ORDER.id)).toContainText(/Correct|Not quite/);
    }
    await expect(explained).toBeVisible();
    expect(await pageWidth(page), 'order, finished').toBeLessThanOrEqual(320);
  });
});

test('right and wrong are told apart without colour: in words, by the kind of line, and in forced colours', async ({ page }, testInfo) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openLesson(page, testInfo, { hash: `#/${SINGLE.id}` });
  const row = (i: number) => page.locator(`${scene(SINGLE.id)} label.lt-option[data-option="${i}"]`);
  const line = (i: number): Promise<string> => row(i).evaluate((el) => `${getComputedStyle(el).borderTopStyle} ${getComputedStyle(el).borderTopWidth}`);

  await option(page, wrong[0] as number).check();
  // Chosen: a heavier line than the options around it.
  expect(await line(wrong[0] as number)).toBe('solid 3px');
  expect(await line(right)).toBe('solid 1px');
  await check(page, SINGLE.id).click();
  await option(page, wrong[1] as number).check();
  await check(page, SINGLE.id).click();
  // In words, which are also part of each radio's name...
  await expect(page.getByRole('radio', { name: `${single.options[right]?.text} Correct answer` })).toHaveCount(1);
  await expect(page.getByRole('radio', { name: `${single.options[wrong[0] as number]?.text} Not this one` })).toHaveCount(1);
  // ...with a tick or a cross drawn before them, which is not read out on top of the words...
  const drawn = (selector: string): Promise<string> => page.locator(selector).first().evaluate((el) => getComputedStyle(el, '::before').content);
  expect(await drawn(`${scene(SINGLE.id)} [data-state="right"] > .lt-mark`)).toMatch(/^"✓\s" \/ ""$/);
  expect(await drawn(`${scene(SINGLE.id)} [data-state="wrong"] > .lt-mark`)).toMatch(/^"✗\s" \/ ""$/);
  expect(await drawn(`${scene(SINGLE.id)} .lt-verdict`)).toMatch(/^"✗\s" \/ ""$/);
  await expect(statusOf(page, SINGLE.id).locator('.lt-verdict')).toHaveText('Not quite.');
  // ...and by the line around them: heavy and solid, or dashed.
  expect(await line(right)).toBe('solid 3px');
  expect(await line(wrong[0] as number)).toBe('dashed 1px');
});

test('in a lesson that is not in English, the words the player adds are marked as English and the lesson’s own are not', async ({ page }, testInfo) => {
  const published = lessonWith((p) => (p.lesson.language = 'pt-BR'));
  await openLesson(page, testInfo, { hash: `#/${SINGLE.id}`, published });
  await option(page, wrong[0] as number).check();
  await check(page, SINGLE.id).click();
  const status = statusOf(page, SINGLE.id);
  await expect(status.locator('.lt-verdict [lang="en"]')).toHaveText('Not quite.');
  await expect(status.locator('.lt-feedback-text')).not.toHaveAttribute('lang', 'en');
  await expect(status.locator('p[lang="en"]')).toHaveText('You have one more try.');
  await expect(page.locator(`${scene(SINGLE.id)} .lt-mark[lang="en"]`)).toHaveText('Not this one');
  await expect(check(page, SINGLE.id).locator('xpath=..')).toHaveAttribute('lang', 'en');
  await audit(page, 'pt-BR');
});

test('printed, a question is followed by its answer: controls go, and what was held back is on the page', async ({ page }, testInfo) => {
  await openLesson(page, testInfo, { hash: `#/${SINGLE.id}` });
  await page.emulateMedia({ media: 'print' });
  for (const c of [SINGLE, NUMERIC, ORDER]) {
    const q = page.locator(`${scene(c.id)} .lt-question`);
    await expect(q).toBeVisible();
    // A source chip stays, as its number in the text: it is what ties the explanation to the printed source list.
    await expect(q.locator('button:not(.lt-chip):visible')).toHaveCount(0);
    await expect(q.locator('[data-explain] .lt-chip:visible')).not.toHaveCount(0);
    await expect(q.locator('[data-explain]')).toBeVisible();
    await expect(q.locator('[data-explain]')).toContainText((c.question as SingleQuestion).explanation.text);
  }
  // The single question's key, with each option's feedback, is printed too.
  for (const o of single.options) await expect(page.locator(`${scene(SINGLE.id)} details[data-answer]`)).toContainText(o.feedback);
  await expect(page.locator(`${scene(ORDER.id)} [data-solution]`)).toBeVisible();
  await expect(page.locator(`${scene(NUMERIC.id)} [data-solution]`)).toBeVisible();
});

test('the status region is rendered before it says anything, and takes no room while it is empty', async ({ page }, testInfo) => {
  await openLesson(page, testInfo, { hash: `#/${SINGLE.id}` });
  const status = statusOf(page, SINGLE.id);
  // Not display:none: a live region that first appears together with its words is not reliably announced.
  expect(await status.evaluate((el) => getComputedStyle(el).display)).toBe('block');
  expect(await status.evaluate((el) => el.getBoundingClientRect().height)).toBe(0);
  const tree = await page.locator(scene(SINGLE.id)).ariaSnapshot();
  expect(tree).toContain('- status');
  // Measured in the page, not the window: pressing the button may scroll it into view.
  const top = (locator: typeof status): Promise<{ y: number; bottom: number }> => locator.evaluate((el) => ({ y: el.getBoundingClientRect().top + scrollY, bottom: el.getBoundingClientRect().bottom + scrollY }));
  // The scene slides in by a few pixels; measure once it has arrived.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const before = await top(check(page, SINGLE.id));
  await check(page, SINGLE.id).click();
  await expect(status).toHaveText('Choose an answer first.');
  // What it says appears under the button that was pressed, which has not moved.
  const after = await top(check(page, SINGLE.id));
  const said = await top(status);
  expect(after.y).toBe(before.y);
  expect(said.y).toBeGreaterThanOrEqual(after.bottom);
  expect(said.bottom - said.y).toBeGreaterThan(20);
});
