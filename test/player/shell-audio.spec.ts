// Optional narration. Every clip here is digital silence, every media element is forced mute by
// the kit before it can play, and Chromium is launched muted as well: nothing in this file can
// make a sound.
import { examplePublished } from '../helpers/example';
import { exampleScenes, expect, expectClean, openLesson, sectionId, test, withSilentAudio } from './shell-kit';
import { SILENT_MP3_SECONDS } from './shell-silence';

const example = exampleScenes();
const lesson = examplePublished().lesson;
const stepScene = lesson.scenes.find((s) => s.kind === 'step_through');
const plain = lesson.scenes.filter((s) => s.kind === 'narration');
const checkpoint = lesson.scenes.find((s) => s.kind === 'checkpoint' && s.question.type === 'single');
const NOTE = 'Machine narration by ElevenLabs (elevenlabs.io). The text is authoritative.';

type P = import('@playwright/test').Page;
const audioState = (page: P) =>
  page.evaluate(() => {
    const a = document.getElementById('lt-audio') as HTMLAudioElement;
    return { paused: a.paused, muted: a.muted, volume: a.volume, src: a.getAttribute('src') ?? '', rate: a.playbackRate, time: a.currentTime, duration: a.duration, autoplay: a.autoplay, controls: a.controls };
  });
const reading = (page: P) => page.evaluate(() => Array.from(document.querySelectorAll('.lt-reading')).map((el) => (el as HTMLElement).dataset.narration));
/** Jump to just before the end of the clip, so it finishes without three seconds of waiting. */
async function skipToEnd(page: P): Promise<void> {
  // The length is only known once the clip's header has been read.
  await expect.poll(async () => Number.isFinite((await audioState(page)).duration)).toBe(true);
  await page.evaluate(() => {
    const a = document.getElementById('lt-audio') as HTMLAudioElement;
    a.currentTime = Math.max(0, a.duration - 0.15);
  });
}

test('a lesson with no clips has no narration controls and no audio element', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo);
  await expect(page.locator('#lt-audiobar')).toHaveCount(0);
  await expect(page.locator('audio')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('ElevenLabs');
  await expectClean(watch, browserName);
});

test('Listen plays the scene’s clip from a blob address, marks the text being read, and nothing starts by itself', async ({ page, browserName }, testInfo) => {
  const first = plain[0]?.id as string;
  const watch = await openLesson(page, testInfo, { published: withSilentAudio([first, example.last]) });
  const bar = page.locator('#lt-audiobar');
  const button = page.locator('#lt-play');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.lt-audio-note')).toContainText(NOTE);
  await expect(bar.locator('.lt-audio-note')).toContainText('Voice: Test Voice.');
  await expect(button).toHaveText('Listen');

  // Nothing plays until asked.
  expect(await audioState(page)).toMatchObject({ paused: true, src: '', autoplay: false, controls: false });
  expect(await reading(page)).toEqual([]);

  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveText('Pause');
  await expect.poll(async () => (await audioState(page)).paused).toBe(false);
  const playing = await audioState(page);
  expect(playing.muted).toBe(true);
  expect(playing.volume).toBe(0);
  expect(playing.src.startsWith('blob:')).toBe(true);
  expect(await reading(page)).toEqual([first]);
  await expect(page.locator(`#${sectionId(first)} .lt-prose`)).toHaveClass(/lt-reading/);
  await expect.poll(async () => (await audioState(page)).duration).toBeCloseTo(SILENT_MP3_SECONDS, 0);

  // Pause stops the mark at once; Resume carries on from the same place. The clip is let run a
  // little first, so that "the same place" is not simply the start.
  await expect.poll(async () => (await audioState(page)).time).toBeGreaterThan(0.25);
  await page.keyboard.press('Enter');
  await expect(button).toHaveText('Resume');
  expect((await audioState(page)).paused).toBe(true);
  expect(await reading(page)).toEqual([]);
  const at = (await audioState(page)).time;
  await page.keyboard.press('Enter');
  await expect(button).toHaveText('Pause');
  expect(await reading(page)).toEqual([first]);
  expect(at).toBeGreaterThan(0.25);
  await expect.poll(async () => (await audioState(page)).time).toBeGreaterThanOrEqual(at - 0.05);

  // At the end it goes back to Listen and the mark is gone.
  await skipToEnd(page);
  await expect(button).toHaveText('Listen', { timeout: 5000 });
  expect(await reading(page)).toEqual([]);
  await expectClean(watch, browserName);
});

test('the controls show only on scenes that have a clip, and leaving a scene stops playback', async ({ page, browserName }, testInfo) => {
  expect(plain.length).toBeGreaterThanOrEqual(2);
  const withClip = plain[0]?.id as string;
  const watch = await openLesson(page, testInfo, { published: withSilentAudio([withClip]) });
  const bar = page.locator('#lt-audiobar');
  await expect(bar).toBeVisible();
  await page.locator('#lt-play').click();
  await expect(page.locator('#lt-play')).toHaveText('Pause');

  await page.locator('#lt-next').click();
  await expect(bar).toBeHidden();
  await expect.poll(async () => (await audioState(page)).paused).toBe(true);
  expect(await reading(page)).toEqual([]);

  await page.locator('#lt-back').click();
  await expect(bar).toBeVisible();
  await expect(page.locator('#lt-play')).toHaveText('Listen');
  await expectClean(watch, browserName);
});

test('the speed choice applies at once, is remembered, and is a labelled group of radios', async ({ page, browserName }, testInfo) => {
  const first = plain[0]?.id as string;
  const watch = await openLesson(page, testInfo, { published: withSilentAudio([first]) });
  const group = page.getByRole('group', { name: 'Narration speed' });
  await expect(group.getByRole('radio')).toHaveCount(4);
  await expect(group.getByRole('radio', { name: '1×', exact: true })).toBeChecked();

  await page.locator('#lt-play').click();
  await expect.poll(async () => (await audioState(page)).rate).toBe(1);
  await group.getByRole('radio', { name: '1.5×' }).check({ force: true });
  await expect.poll(async () => (await audioState(page)).rate).toBe(1.5);
  // Arrow keys move through the group like any radio group.
  await group.getByRole('radio', { name: '1.5×' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(group.getByRole('radio', { name: '1.25×' })).toBeChecked();
  await expect.poll(async () => (await audioState(page)).rate).toBe(1.25);

  await page.reload();
  await expect(page.getByRole('group', { name: 'Narration speed' }).getByRole('radio', { name: '1.25×' })).toBeChecked();
  await page.locator('#lt-play').click();
  await expect.poll(async () => (await audioState(page)).rate).toBe(1.25);
  await expectClean(watch, browserName);
});

test('a step-through reads the intro and then the step on show, follows the steps, and stops where there is no clip', async ({ page, browserName }, testInfo) => {
  expect(stepScene).toBeDefined();
  if (!stepScene) return;
  const id = stepScene.id;
  const watch = await openLesson(page, testInfo, { published: withSilentAudio([`${id}.intro`, `${id}.step1`, `${id}.step2`]), hash: `#/${id}` });
  const bar = page.locator('#lt-audiobar');
  const button = page.locator('#lt-play');
  await expect(bar).toBeVisible();

  await button.click();
  await expect(button).toHaveText('Pause');
  await expect.poll(() => reading(page)).toEqual([`${id}.intro`]);
  await skipToEnd(page);
  // The intro runs on into the first step without another press.
  await expect.poll(() => reading(page), { timeout: 5000 }).toEqual([`${id}.step1`]);
  await expect(button).toHaveText('Pause');

  // The step module reports a change of step; someone who is listening keeps listening.
  await page.evaluate((sceneId) => document.dispatchEvent(new CustomEvent('lt:stepchange', { detail: { sceneId, step: 2 } })), id);
  await expect.poll(() => reading(page)).toEqual([`${id}.step2`]);
  expect((await audioState(page)).paused).toBe(false);

  // Paused, a change of step only changes what Listen will read.
  await button.click();
  await expect(button).toHaveText('Resume');
  await page.evaluate((sceneId) => document.dispatchEvent(new CustomEvent('lt:stepchange', { detail: { sceneId, step: 1 } })), id);
  await expect(button).toHaveText('Listen');
  expect((await audioState(page)).paused).toBe(true);

  // A step with no clip: the controls go, and nothing plays.
  await page.evaluate((sceneId) => document.dispatchEvent(new CustomEvent('lt:stepchange', { detail: { sceneId, step: 3 } })), id);
  await expect(bar).toBeHidden();
  expect((await audioState(page)).paused).toBe(true);
  // A change reported for another scene is ignored.
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('lt:stepchange', { detail: { sceneId: 'elsewhere', step: 1 } })));
  await expect(bar).toBeHidden();

  // "Nothing readable on this step yet" is said outright, with null, and not by naming a step that has no clip.
  await page.evaluate((sceneId) => document.dispatchEvent(new CustomEvent('lt:stepchange', { detail: { sceneId, step: 2 } })), id);
  await expect(bar).toBeVisible();
  await button.click();
  await expect.poll(() => reading(page)).toEqual([`${id}.step2`]);
  await page.evaluate((sceneId) => document.dispatchEvent(new CustomEvent('lt:stepchange', { detail: { sceneId, step: null } })), id);
  await expect(bar).toBeHidden();
  expect(await reading(page)).toEqual([]);
  expect((await audioState(page)).paused).toBe(true);
  // And when the step can be read after all, Listen is back, and reads that step.
  await page.evaluate((sceneId) => document.dispatchEvent(new CustomEvent('lt:stepchange', { detail: { sceneId, step: 1 } })), id);
  await expect(bar).toBeVisible();
  await expect(button).toHaveText('Listen');
  await expectClean(watch, browserName);
});

test('the mark on the text being read does not widen a 320 pixel page', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const first = plain[0]?.id as string;
  await openLesson(page, testInfo, { published: withSilentAudio([first]) });
  await page.locator('#lt-play').click();
  await expect.poll(() => reading(page)).toEqual([first]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const mark = await page.locator('.lt-reading').boundingBox();
  expect(mark && mark.x >= 0).toBe(true);
  expect(await page.locator('.lt-reading').evaluate((el) => getComputedStyle(el).borderInlineStartWidth)).toBe('3px');
});

test('reading the recap aloud opens the takeaways it reads', async ({ page }, testInfo) => {
  await openLesson(page, testInfo, { published: withSilentAudio([example.last]), hash: `#/${example.last}` });
  const recap = page.locator(`#${sectionId(example.last)}`);
  await expect(recap.locator('details[open]')).toHaveCount(0);
  await page.locator('#lt-play').click();
  await expect.poll(() => reading(page)).toEqual([example.last]);
  expect(await recap.locator('.lt-takeaways details').count()).toBe(await recap.locator('.lt-takeaways details[open]').count());
});

// The narration used to open every <details> inside the text it was reading. In the recap that is
// right: the takeaways are what is read. In a checkpoint it reads the prompt only, and the
// disclosures there are the hint and the answer.
test('reading a checkpoint aloud opens nothing: its hint and its answer are not what is read', async ({ page }, testInfo) => {
  expect(checkpoint).toBeDefined();
  if (!checkpoint) return;
  const id = checkpoint.id;
  await openLesson(page, testInfo, { published: withSilentAudio([id]), hash: `#/${id}` });
  const scene = page.locator(`#${sectionId(id)}`);
  const opened = (): Promise<string[]> => scene.locator('details').evaluateAll((els) => els.filter((el) => (el as HTMLDetailsElement).open).map((el) => el.className));
  expect(await scene.locator('details').count()).toBeGreaterThanOrEqual(1);
  expect(await opened()).toEqual([]);
  await page.locator('#lt-play').click();
  await expect.poll(() => reading(page)).toEqual([id]);
  expect(await opened()).toEqual([]);
  // Not opened and then shut again, either: the attribute is never set.
  const toggled = await scene.locator('details').evaluateAll(
    (els) =>
      new Promise<number>((resolve) => {
        let count = 0;
        const observer = new MutationObserver((records) => (count += records.length));
        for (const el of els) observer.observe(el, { attributes: true, attributeFilter: ['open'] });
        (document.getElementById('lt-play') as HTMLElement).click();
        (document.getElementById('lt-play') as HTMLElement).click();
        setTimeout(() => resolve(count), 300);
      }),
  );
  expect(toggled).toBe(0);
});

test('a question the player left as it was rendered keeps its answer shut while its prompt is read', async ({ page }, testInfo) => {
  expect(checkpoint).toBeDefined();
  if (!checkpoint) return;
  const id = checkpoint.id;
  await openLesson(page, testInfo, {
    published: withSilentAudio([id]),
    hash: `#/${id}`,
    // The markup says one kind of question and the data another, so the player does not touch it:
    // it stays the plain question with its answer behind a native disclosure.
    mutate: (html) => html.replace('data-question="single"', 'data-question="order"'),
  });
  const scene = page.locator(`#${sectionId(id)}`);
  const answer = scene.locator('details[data-answer]');
  await expect(answer).toBeVisible();
  await expect(answer.locator('.lt-reveal-body')).toBeHidden();
  await page.locator('#lt-play').click();
  await expect.poll(() => reading(page)).toEqual([id]);
  await expect(answer.locator('.lt-reveal-body')).toBeHidden();
  expect(await answer.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
  // The learner can still open it.
  await answer.locator('summary').click();
  await expect(answer.locator('.lt-reveal-body')).toBeVisible();
});

test('narration does not change the page’s policy and survives a reload', async ({ page, browserName }, testInfo) => {
  const first = plain[0]?.id as string;
  const watch = await openLesson(page, testInfo, { published: withSilentAudio([first]), via: 'http' });
  await page.locator('#lt-play').click();
  await expect(page.locator('#lt-play')).toHaveText('Pause');
  await page.reload();
  await expect(page.locator('#lt-play')).toHaveText('Listen');
  expect((await audioState(page)).paused).toBe(true);
  await expectClean(watch, browserName);
  expect(new Set(watch.serverHits)).toEqual(new Set([`GET ${new URL(watch.url).pathname}`]));
});
