// Names of controls whose text is math (review finding P7).
//
// A browser does not read MathML when it works out a control's name from its label: an option
// that is only `$8$` was a radio with no name, and a prompt lost its formula from the name of its
// group. The renderer now gives such a control its name in words as well.
//
// What a browser exposes is read here from Chromium's own accessibility tree, over the DevTools
// protocol. Tools that compute names in script (Playwright's own role queries among them) read
// the MathML text and so reported nothing wrong; axe, which runs in both browsers, did.
import type { BrowserContext, Page } from '@playwright/test';
import { EXAMPLE_QUESTIONS } from '../../src/core/examples';
import type { CheckpointScene, StepThroughScene } from '../../src/core/schema';
import { examplePublished } from '../helpers/example';
import { audit, lessonWith, openFresh, scene, setQuestion } from './questions-kit';
import { expect, expectClean, test } from './shell-kit';

const lesson = examplePublished().lesson;
const checkpoint = (type: string): CheckpointScene => lesson.scenes.find((s): s is CheckpointScene => s.kind === 'checkpoint' && s.question.type === type) as CheckpointScene;
const SINGLE = checkpoint('single');
const NUMERIC = checkpoint('numeric');
const ORDER = checkpoint('order');
const STEPS = lesson.scenes.find((s): s is StepThroughScene => s.kind === 'step_through') as StepThroughScene;
const ASK = STEPS.steps.findIndex((s) => s.predict) + 1;

const single = EXAMPLE_QUESTIONS.single as { explanation: unknown };

/** The example lesson with math in every place where lesson text names a control or a group. */
const published = () =>
  lessonWith((p) => {
    setQuestion(p, SINGLE.id, {
      type: 'single',
      prompt: 'A square has $1 + 1$ pairs of sides. Which of these is $2^3$?',
      options: [
        { text: '$8$', correct: true, feedback: 'Two cubed is eight: two times two times two.' },
        { text: 'Doubling twice, $2^{2}$', correct: false, feedback: 'That is two squared, which is four.', misconception: 'Squares the base instead of cubing it.' },
        { text: 'Six', correct: false, feedback: 'That is two times three, not two cubed.', misconception: 'Multiplies the base by the exponent.' },
      ],
      explanation: single.explanation,
    });
    setQuestion(p, NUMERIC.id, { ...EXAMPLE_QUESTIONS.numeric, prompt: 'What is $2^{10}$ minus $4$?' });
    setQuestion(p, ORDER.id, { ...EXAMPLE_QUESTIONS.order, prompt: 'Put these in order, starting from $n = 1$.' });
    const steps = p.lesson.scenes.find((s) => s.id === STEPS.id) as StepThroughScene;
    (steps.steps[ASK - 1] as StepThroughScene['steps'][number]).predict = {
      prompt: 'How many leaves after $3$ splits?',
      options: [
        { text: '$2^3 = 8$', correct: true, feedback: 'Each split doubles the count of leaves.' },
        { text: '$6$', correct: false, feedback: 'That adds two per split instead of doubling.' },
      ],
    };
  });

interface AxNode {
  role: string;
  name: string;
}

/** Every node Chromium exposes to assistive technology, as it names them. Hidden scenes are not in the tree. */
async function exposed(context: BrowserContext, page: Page): Promise<AxNode[]> {
  const session = await context.newCDPSession(page);
  const { nodes } = (await session.send('Accessibility.getFullAXTree')) as { nodes: { ignored?: boolean; role?: { value?: string }; name?: { value?: string } }[] };
  await session.detach();
  return nodes.filter((n) => !n.ignored).map((n) => ({ role: n.role?.value ?? '', name: (n.name?.value ?? '').replace(/\s+/g, ' ').trim() }));
}
const named = (nodes: AxNode[], role: string): string[] => nodes.filter((n) => n.role === role).map((n) => n.name);

const go = async (page: Page, id: string): Promise<void> => {
  await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), id);
  await expect(page.locator(scene(id))).toBeVisible();
};
const toPrediction = async (page: Page): Promise<void> => {
  await go(page, STEPS.id);
  for (let n = 2; n <= ASK; n++) await page.locator(`${scene(STEPS.id)} button[data-step-go="next"]`).click();
  await expect(page.locator(`${scene(STEPS.id)} li[data-step="${ASK}"] fieldset`)).toBeVisible();
};

test('a browser exposes a name for every option, prompt and field that is written in math', async ({ page, context, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'the accessibility tree is read over the DevTools protocol; axe covers WebKit below');
  await openFresh(page, testInfo, { published: published(), hash: `#/${SINGLE.id}` });

  let tree = await exposed(context, page);
  expect(named(tree, 'radio').sort()).toEqual(['8', 'Doubling twice, 2^2', 'Six']);
  expect(named(tree, 'group')).toContain('A square has 1 + 1 pairs of sides. Which of these is 2^3?');

  await toPrediction(page);
  tree = await exposed(context, page);
  expect(named(tree, 'radio').sort()).toEqual(['2^3 = 8', '6']);
  expect(named(tree, 'group')).toContain('Predict first: How many leaves after 3 splits?');

  await go(page, NUMERIC.id);
  tree = await exposed(context, page);
  expect(named(tree, 'textbox')).toEqual(['What is 2^10 minus 4?']);

  await go(page, ORDER.id);
  tree = await exposed(context, page);
  expect(named(tree, 'list')).toContain('Put these in order, starting from n = 1.');
  // No control in any of these scenes is left without a name.
  for (const role of ['radio', 'textbox', 'button', 'checkbox']) expect(named(tree, role).filter((name) => name === ''), role).toEqual([]);
});

test('the name is only added where there is math: an option in plain words is named by its own label', async ({ page }, testInfo) => {
  await openFresh(page, testInfo, { published: published(), hash: `#/${SINGLE.id}` });
  const labels = await page.locator(`${scene(SINGLE.id)} label.lt-option`).evaluateAll((els) => els.map((el) => ({ shown: (el.querySelector('.lt-option-text')?.textContent ?? '').trim(), label: el.querySelector('input')?.getAttribute('aria-label') ?? null })));
  expect(labels.find((l) => l.shown === 'Six')).toEqual({ shown: 'Six', label: null });
  expect(labels.filter((l) => l.label !== null)).toHaveLength(2);
  // The math is still drawn as math; the name does not replace what is seen.
  await expect(page.locator(`${scene(SINGLE.id)} label.lt-option math`)).toHaveCount(2);
  await expect(page.locator(`${scene(SINGLE.id)} legend math`)).toHaveCount(2);
});

test('questions written in math pass axe in every state a learner meets first', async ({ page, browserName }, testInfo) => {
  const watch = await openFresh(page, testInfo, { published: published(), hash: `#/${SINGLE.id}` });
  await audit(page, 'single with math');
  await page.locator(`${scene(SINGLE.id)} label.lt-option input`).first().check();
  await page.locator(`${scene(SINGLE.id)} button[data-act="check"]`).click();
  await audit(page, 'single with math, checked once');

  await toPrediction(page);
  await audit(page, 'a prediction whose options are only math');
  await page.locator(`${scene(STEPS.id)} li[data-step="${ASK}"] label.lt-option input`).first().check();
  await page.locator(`${scene(STEPS.id)} li[data-step="${ASK}"] button[data-act="check"]`).click();
  await audit(page, 'that prediction, checked');

  await go(page, NUMERIC.id);
  await audit(page, 'numeric with math in its prompt');
  await go(page, ORDER.id);
  await audit(page, 'ordering with math in its prompt');
  await expectClean(watch, browserName);
});
