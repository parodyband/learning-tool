// A lesson published again under the same id (review finding P5).
//
// publish_lesson writes the changed lesson to the same file with the same lesson id, and progress
// is stored under that id. What the earlier version stored used to be applied to the new content by
// scene id alone: a rewritten question opened with "Earlier result: right on your first attempt",
// the first-attempt lock kept the real first attempt from being recorded, and the recap and the
// copied summary reported the old result as a fact about the new question.
//
// Progress is now kept with a digest of the scene it is about. These tests publish a second
// version by rendering the changed lesson and opening it in the same browser profile, which is
// what a learner's browser sees after a republish.
import type { Page, TestInfo } from '@playwright/test';
import { EXAMPLE_QUESTIONS } from '../../src/core/examples';
import type { CheckpointScene, NumericQuestion, SingleQuestion, StepThroughScene } from '../../src/core/schema';
import type { Published } from '../../src/core/types';
import { examplePublished, exampleReceipt } from '../helpers/example';
import { lessonWith, scene, setQuestion, statusOf, stored } from './questions-kit';
import { exampleScenes, expect, openLesson, test } from './shell-kit';

const example = exampleScenes();
const lesson = examplePublished().lesson;
const checkpoint = (type: string): CheckpointScene => lesson.scenes.find((s): s is CheckpointScene => s.kind === 'checkpoint' && s.question.type === type) as CheckpointScene;
const SINGLE = checkpoint('single');
const NUMERIC = checkpoint('numeric');
const single = SINGLE.question as SingleQuestion;
const numeric = NUMERIC.question as NumericQuestion;
const right = single.options.findIndex((o) => o.correct);
const STEPS = lesson.scenes.find((s): s is StepThroughScene => s.kind === 'step_through') as StepThroughScene;
const ASK = STEPS.steps.findIndex((s) => s.predict) + 1;

const go = async (page: Page, id: string): Promise<void> => {
  await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), id);
  await expect(page.locator(scene(id))).toBeVisible();
};
const recapLine = (page: Page, id: string) => page.locator(`${scene(example.last)} [data-result="${id}"]`);
const summary = (page: Page): Promise<string> => page.locator(`${scene(example.last)} textarea[data-summary]`).inputValue();

/** Open a version of the lesson where the one before it was: same profile, same lesson id. */
async function publish(page: Page, testInfo: TestInfo, version: Published): Promise<void> {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await openLesson(page, testInfo, { published: version });
}

/** The same lesson with the single-choice question rewritten: another prompt, and another option is now the right one. */
const REWRITTEN_PROMPT = 'You search a sorted list for 30. The middle element is 50. What does binary search do next?';
function secondVersion(): Published {
  return lessonWith(
    (p) => {
      const flipped = single.options.map((o, i) => ({ ...o, correct: i === (right + 1) % single.options.length, misconception: i === (right + 1) % single.options.length ? undefined : (o.misconception ?? 'Keeps the half that was ruled out.') }));
      setQuestion(p, SINGLE.id, { ...EXAMPLE_QUESTIONS.single, prompt: REWRITTEN_PROMPT, options: flipped });
    },
    // A republish has a new hash: the lesson changed.
    { hash: 'c'.repeat(64) },
  );
}

test('a rewritten question starts unanswered, and the questions that did not change keep their results', async ({ page }, testInfo) => {
  await openLesson(page, testInfo);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // First version: the single-choice question right, the numeric one wrong.
  await go(page, SINGLE.id);
  await page.locator(`${scene(SINGLE.id)} label.lt-option[data-option="${right}"] input`).check();
  await page.locator(`${scene(SINGLE.id)} button[data-act="check"]`).click();
  await expect(statusOf(page, SINGLE.id)).toContainText('Correct.');
  await go(page, NUMERIC.id);
  await page.locator(`${scene(NUMERIC.id)} input.lt-number`).fill(String(numeric.answer + 7));
  await page.locator(`${scene(NUMERIC.id)} button[data-act="check"]`).click();
  await expect(statusOf(page, NUMERIC.id)).toContainText('Not quite.');
  expect(await stored(page, lesson.id)).toEqual([
    [SINGLE.id, 'correct'],
    [NUMERIC.id, 'incorrect'],
  ]);

  // Published again with the single-choice question rewritten.
  await publish(page, testInfo, secondVersion());
  await go(page, SINGLE.id);
  await expect(page.locator(`${scene(SINGLE.id)} legend`)).toHaveText(REWRITTEN_PROMPT);
  // No "Earlier result" for a question that was never answered.
  await expect(page.locator(`${scene(SINGLE.id)} [data-earlier]`)).toBeHidden();
  await expect(page.locator(`${scene(SINGLE.id)} [data-earlier]`)).toBeEmpty();
  // The question that did not change still says how it went.
  await go(page, NUMERIC.id);
  await expect(page.locator(`${scene(NUMERIC.id)} [data-earlier]`)).toHaveText('Earlier result: not right on your first attempt. Answering again is practice and does not change it.');

  await go(page, example.last);
  await expect(recapLine(page, SINGLE.id)).toHaveText('Not answered yet');
  await expect(recapLine(page, NUMERIC.id)).toHaveText('✗ Not right on your first attempt');
  const before = await summary(page);
  expect(before).toContain(`   - ${SINGLE.title}: not answered`);
  expect(before).toContain(`   - ${NUMERIC.title}: not right on the first attempt`);
  expect(before).toContain('Checkpoints answered: 1 of ');
  expect(before).not.toContain(': right on the first attempt');

  // The real first attempt at the new question is recorded: the old result does not stand in its way.
  await go(page, SINGLE.id);
  await page.locator(`${scene(SINGLE.id)} label.lt-option[data-option="${right}"] input`).check();
  await page.locator(`${scene(SINGLE.id)} button[data-act="check"]`).click();
  await expect(statusOf(page, SINGLE.id)).toContainText('Not quite.');
  expect((await stored(page, lesson.id)).sort()).toEqual(
    [
      [SINGLE.id, 'incorrect'],
      [NUMERIC.id, 'incorrect'],
    ].sort(),
  );
  await go(page, example.last);
  await expect(recapLine(page, SINGLE.id)).toHaveText('✗ Not right on your first attempt');
  expect(await summary(page)).toContain(`   - ${SINGLE.title}: not right on the first attempt`);
});

test('a version that changes nothing in a question keeps its result: a new title, a new receipt, a typo fixed elsewhere', async ({ page }, testInfo) => {
  await openLesson(page, testInfo);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await go(page, SINGLE.id);
  await page.locator(`${scene(SINGLE.id)} label.lt-option[data-option="${right}"] input`).check();
  await page.locator(`${scene(SINGLE.id)} button[data-act="check"]`).click();
  await expect(statusOf(page, SINGLE.id)).toContainText('Correct.');

  const version = examplePublished({ receipt: exampleReceipt({ hash: 'd'.repeat(64), validatedOn: '2026-11-01' }) });
  version.lesson.title = `${version.lesson.title} (second edition)`;
  const first = version.lesson.scenes[0];
  if (first?.kind === 'narration' && first.blocks[0]) first.blocks[0].text = `${first.blocks[0].text} `;
  await publish(page, testInfo, version);
  await go(page, SINGLE.id);
  await expect(page.locator(`${scene(SINGLE.id)} [data-earlier]`)).toHaveText('Earlier result: right on your first attempt. Answering again is practice and does not change it.');
  await go(page, example.last);
  await expect(recapLine(page, SINGLE.id)).toHaveText('✓ Right on your first attempt');
});

test('the place kept in a step-through is dropped when its steps are rewritten, so a prediction never met is still asked', async ({ page }, testInfo) => {
  await openLesson(page, testInfo);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const steps = page.locator(scene(STEPS.id));
  const shown = (): Promise<string[]> => steps.locator('li.lt-step:visible').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.step ?? ''));

  // First version: step through to the prediction, skip it, and go one step past it.
  await go(page, STEPS.id);
  for (let n = 2; n <= ASK; n++) await steps.locator('button[data-step-go="next"]').click();
  await steps.locator(`li[data-step="${ASK}"] button[data-act="skip"]`).click();
  if (ASK < STEPS.steps.length) await steps.locator('button[data-step-go="next"]').click();
  const reached = await shown();
  expect(Number(reached[0])).toBeGreaterThanOrEqual(ASK);

  // The same lesson again: the place is this scene's, and it is kept.
  await publish(page, testInfo, examplePublished());
  await go(page, STEPS.id);
  expect(await shown()).toEqual(reached);

  // Published again with the prediction rewritten: the place was about other steps.
  const rewritten = lessonWith((p) => {
    const scene2 = p.lesson.scenes.find((s) => s.id === STEPS.id) as StepThroughScene;
    const step = scene2.steps[ASK - 1] as StepThroughScene['steps'][number];
    if (step.predict) step.predict.prompt = `${step.predict.prompt} Think again.`;
  });
  await publish(page, testInfo, rewritten);
  await go(page, STEPS.id);
  expect(await shown()).toEqual(['1']);
  for (let n = 2; n <= ASK; n++) await steps.locator('button[data-step-go="next"]').click();
  // The new prediction is open and holds its step back; it is not marked as answered on an earlier visit.
  await expect(steps.locator(`li[data-step="${ASK}"] [data-actions]`)).toBeVisible();
  await expect(steps.locator(`li[data-step="${ASK}"] [data-step-body]`)).toBeHidden();
  await expect(steps.locator(`li[data-step="${ASK}"] [data-outcome]`)).toBeEmpty();
});
