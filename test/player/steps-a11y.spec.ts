// Every state of a step-through, audited with axe-core in both themes and at 320 pixels, plus the
// things axe has no rule for: reflow, text spacing, a changed value that does not depend on
// colour, forced colours, and print.
import type { Page } from '@playwright/test';
import type { StepThroughScene } from '../../src/core/schema';
import { examplePublished } from '../helpers/example';
import { audit, lessonWith, openFresh, pageWidth, scene, smallControls, spaceText, statusOf } from './questions-kit';
import { expect, expectClean, openLesson, test } from './shell-kit';

const lesson = examplePublished().lesson;
const STEPS = lesson.scenes.find((s): s is StepThroughScene => s.kind === 'step_through') as StepThroughScene;
const id = STEPS.id;
const total = STEPS.steps.length;
const ASK = STEPS.steps.findIndex((s) => s.predict) + 1;
const predict = STEPS.steps[ASK - 1]?.predict as NonNullable<StepThroughScene['steps'][number]['predict']>;
const wrongOption = predict.options.findIndex((o) => !o.correct);

const s = (page: Page) => page.locator(scene(id));
// Enter on the button, not a click: a control that is aria-disabled must still answer, and a click would wait for it to be enabled.
const next = (page: Page): Promise<void> => s(page).locator('button[data-step-go="next"]').press('Enter');
const to = async (page: Page, n: number): Promise<void> => {
  for (let k = 2; k <= n; k++) await next(page);
  await expect(statusOf(page, id)).toContainText(`Step ${n} of ${total}`);
};
const skip = (page: Page): Promise<void> => s(page).locator(`li[data-step="${ASK}"] button[data-act="skip"]`).press('Enter');

interface State {
  name: string;
  reach(page: Page): Promise<void>;
}

const STATES: State[] = [
  { name: 'the first step', reach: async () => {} },
  { name: 'a step that changed a value', reach: (page) => to(page, ASK - 1) },
  { name: 'a prediction waiting', reach: (page) => to(page, ASK) },
  {
    name: 'Next pressed while a prediction waits',
    reach: async (page) => {
      await to(page, ASK);
      await next(page);
      await expect(statusOf(page, id)).toContainText('to go on');
    },
  },
  {
    name: 'a prediction checked with nothing chosen',
    reach: async (page) => {
      await to(page, ASK);
      await s(page).locator(`li[data-step="${ASK}"] button[data-act="check"]`).press('Enter');
      await expect(s(page).locator('[data-outcome]')).toContainText('Choose an answer first');
    },
  },
  {
    name: 'a wrong prediction, the step shown',
    reach: async (page) => {
      await to(page, ASK);
      await s(page).locator(`li[data-step="${ASK}"] label.lt-option[data-option="${wrongOption}"] input`).check();
      await s(page).locator(`li[data-step="${ASK}"] button[data-act="check"]`).press('Enter');
      await expect(s(page).locator(`li[data-step="${ASK}"] [data-step-body]`)).toBeVisible();
    },
  },
  {
    name: 'a skipped prediction',
    reach: async (page) => {
      await to(page, ASK);
      await skip(page);
      await expect(s(page).locator(`li[data-step="${ASK}"] [data-step-body]`)).toBeVisible();
    },
  },
  {
    name: 'the last step, told it is the last',
    reach: async (page) => {
      await to(page, ASK);
      await skip(page);
      await to(page, total);
      await next(page);
      await expect(statusOf(page, id)).toContainText('last step');
    },
  },
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });
    test('every state of the step-through passes axe', async ({ page, browserName }, testInfo) => {
      test.slow();
      for (const state of STATES) {
        const watch = await openFresh(page, testInfo, { hash: `#/${id}` });
        await state.reach(page);
        await audit(page, `${scheme}: ${state.name}`);
        expect(await smallControls(page), `${state.name}: controls under 24 by 24`).toEqual([]);
        await expectClean(watch, browserName);
      }
    });
  });
}

test.describe('at 320 pixels wide', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('no state scrolls sideways, also with text spacing increased, and each passes axe', async ({ page }, testInfo) => {
    test.slow();
    for (const state of STATES) {
      await openFresh(page, testInfo, { hash: `#/${id}` });
      await state.reach(page);
      expect(await pageWidth(page), state.name).toBeLessThanOrEqual(320);
      await audit(page, `320px: ${state.name}`);
      expect(await smallControls(page), `${state.name}: controls under 24 by 24`).toEqual([]);
      await spaceText(page);
      expect(await pageWidth(page), `${state.name}, text spaced`).toBeLessThanOrEqual(320);
      for (const part of ['[data-step-nav]', '[data-state-panel]', 'li.lt-step:not([hidden])']) {
        const box = await s(page).locator(part).first().boundingBox();
        if (box) expect(box.x >= 0 && box.x + box.width <= 320.5, `${state.name}: ${part} fits`).toBe(true);
      }
    }
  });

  test('long titles, long values and long options wrap instead of widening the page', async ({ page }, testInfo) => {
    const long = 'Supercalifragilisticexpialidocious_and_then_some';
    const published = lessonWith((p) => {
      const st = p.lesson.scenes.find((x): x is StepThroughScene => x.kind === 'step_through') as StepThroughScene;
      st.steps.forEach((x, i) => {
        x.title = `${long} ${i}`.slice(0, 50);
        x.state = Array.from({ length: 6 }, (_, k) => ({ label: `${long}`.slice(0, 24), value: `${long}${k + i}`.slice(-32) }));
        if (x.predict) x.predict.options = x.predict.options.map((o) => ({ ...o, text: `${long}${long} ${o.text}`.slice(0, 120) }));
      });
    });
    await openLesson(page, testInfo, { published, hash: `#/${id}` });
    for (let n = 1; n <= total; n++) {
      expect(await pageWidth(page), `step ${n}`).toBeLessThanOrEqual(320);
      if (n === ASK) await skip(page);
      expect(await pageWidth(page), `step ${n}, shown`).toBeLessThanOrEqual(320);
      if (n < total) await next(page);
    }
  });
});

test('the buttons are large enough to hit and the counter stays beside them when there is room', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openLesson(page, testInfo, { hash: `#/${id}` });
  const boxes = await Promise.all(['button[data-step-go="prev"]', 'button[data-step-go="next"]', '[role="status"]'].map((sel) => s(page).locator(`[data-step-nav] ${sel}`).boundingBox()));
  const [prev, nextBox, status] = boxes;
  expect(prev && nextBox && status).toBeTruthy();
  if (!prev || !nextBox || !status) return;
  for (const b of [prev, nextBox]) expect(b.height >= 24 && b.width >= 24).toBe(true);
  expect(Math.abs(prev.y - nextBox.y)).toBeLessThan(2);
  expect(status.y).toBeLessThan(prev.y + prev.height);
  // The figure is beside the steps at this width, and the steps column is a readable measure.
  const text = await s(page).locator('.lt-text-col').boundingBox();
  const figure = await s(page).locator('.lt-figure-col').boundingBox();
  expect(text && figure && figure.x > text.x + text.width - 1 && text.width < 520).toBe(true);
});

test('a changed value is told apart without colour: in words, and by a heavier line that survives forced colours', async ({ page }, testInfo) => {
  await openLesson(page, testInfo, { hash: `#/${id}` });
  await to(page, ASK - 1);
  const changed = s(page).locator('[data-state-panel] .lt-state-row[data-changed]').first();
  const plain = s(page).locator('[data-state-panel] .lt-state-row:not([data-changed])').first();
  await expect(changed).toContainText(/changed, (new|was )/);
  await expect(changed.locator('.lt-state-flag')).toBeVisible();
  const weight = (row: typeof changed): Promise<string> => row.locator('.lt-state-value').evaluate((el) => getComputedStyle(el).fontWeight);
  expect(Number(await weight(changed))).toBeGreaterThan(Number(await weight(plain)));
  expect(await changed.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
  expect(await plain.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');

  await page.emulateMedia({ forcedColors: 'active' });
  expect(await changed.evaluate((el) => `${getComputedStyle(el).borderTopStyle} ${getComputedStyle(el).borderTopWidth}`)).toBe('double 3px');
  expect(await plain.evaluate((el) => `${getComputedStyle(el).borderTopStyle} ${getComputedStyle(el).borderTopWidth}`)).toBe('solid 1px');
});

test('printed, every step is on the page with its own values and its prediction’s answer, and the controls are gone', async ({ page }, testInfo) => {
  await openLesson(page, testInfo, { hash: `#/${id}` });
  await to(page, 2);
  await page.emulateMedia({ media: 'print' });
  await expect(s(page).locator('li.lt-step:visible')).toHaveCount(total);
  await expect(s(page).locator('[data-step-nav]')).toBeHidden();
  await expect(s(page).locator('[data-state-panel]')).toBeHidden();
  await expect(s(page).locator('button:not(.lt-chip):visible')).toHaveCount(0);
  for (const [i, x] of STEPS.steps.entries()) {
    const li = s(page).locator(`li[data-step="${i + 1}"]`);
    await expect(li.locator('.lt-step-count')).toBeVisible();
    await expect(li.locator('[data-step-body]')).toBeVisible();
    if (x.state) await expect(li.locator('.lt-state-box')).toBeVisible();
  }
  // The step that was being held back is printed, with the answer to its question.
  const asked = s(page).locator(`li[data-step="${ASK}"]`);
  await expect(asked.locator('details[data-answer]')).toBeVisible();
  for (const o of predict.options) await expect(asked.locator('details[data-answer]')).toContainText(o.feedback);
});
