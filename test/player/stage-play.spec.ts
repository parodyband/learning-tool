// A clip that plays: the poster, play and pause, the scrubber, stepping, replay, speed, the
// prediction that holds the clip, and the shell that still works around it.
import { examplePublishedV2, withSilentBeats } from '../helpers/clip-example';
import { expect, expectClean, openLesson, test } from './shell-kit';
import { CLIPS, at, captionShown, clip, clipOf, clipState, control, openClip, picture, settled } from './stage-kit';

const TRACE = clipOf('c3');
// The trace asks twice. The first prediction is chosen from options, and is what these specs are
// about; the second is tapped on the picture (test/player/explore.spec.ts) and holds the clip in its turn.
const GATE = TRACE.beats.findIndex((b) => b.gate && 'options' in b.gate);
const TAPPED = TRACE.beats.findIndex((b) => b.gate && 'pick' in b.gate);
const gate = TRACE.beats[GATE]?.gate as { prompt: string; options: { text: string; correct: boolean; feedback: string }[] };
const RIGHT = gate.options.findIndex((o) => o.correct);
const WRONG = gate.options.findIndex((o) => !o.correct);

test('a clip arrives, plays its establishing move by itself, and waits on its poster', async ({ page, browserName }, testInfo) => {
  const watch = await openClip(page, testInfo, 'c2');
  const s = await clipState(page, 'c2');
  expect(s.state).toBe('poster');
  expect(s.t).toBe(s.poster);
  expect(s.k).toBe(-1);
  await expect(clip(page, 'c2').locator('.st-bigplay')).toBeVisible();
  await expect(clip(page, 'c2').locator('.st-slate')).toHaveText(/5 beats · 0:\d\d/);
  expect(await captionShown(page, 'c2')).toBe('');
  // Nothing goes on moving while it waits.
  const before = await picture(page, 'c2');
  await page.waitForTimeout(400);
  expect(await picture(page, 'c2')).toBe(before);
  expect((await clipState(page, 'c2')).t).toBe(s.poster);
  await expectClean(watch, browserName);
});

test('Play runs the clip through to its end, captions and all, and Replay starts it again', async ({ page, browserName }, testInfo) => {
  const watch = await openClip(page, testInfo, 'c1');
  await control(page, 'c1', 'st-speed').locator('input[value=\"2\"]').check();
  await clip(page, 'c1').locator('.st-bigplay').click();
  await expect(clip(page, 'c1')).toHaveAttribute('data-state', 'playing');
  await expect(clip(page, 'c1').locator('.st-bigplay')).toBeHidden();
  await expect(control(page, 'c1', 'st-play')).toHaveAccessibleName('Pause');
  await expect(control(page, 'c1', 'st-play')).toBeFocused();
  const seen = new Set<string>();
  await expect
    .poll(
      async () => {
        seen.add(await captionShown(page, 'c1'));
        return (await clipState(page, 'c1')).state;
      },
      { timeout: 30_000, intervals: [120] },
    )
    .toBe('ended');
  const c1 = clipOf('c1');
  for (const b of c1.beats) expect([...seen], b.caption.text).toContain(b.caption.text);
  const end = await clipState(page, 'c1');
  expect(end.t).toBe(end.duration - 1);
  expect(end.playing).toBe(false);
  await expect(control(page, 'c1', 'st-play')).toHaveAccessibleName('Replay');
  await expect(clip(page, 'c1').locator('p[role="status"]')).toHaveText(new RegExp(`^End of clip\\. ${c1.beats.at(-1)?.caption.text.slice(0, 20)}`));
  // Replay, from the play control and from its own button.
  await control(page, 'c1', 'st-play').click();
  await expect(clip(page, 'c1')).toHaveAttribute('data-state', 'playing');
  expect((await clipState(page, 'c1')).t).toBeLessThan(end.duration / 2);
  await control(page, 'c1', 'st-play').click();
  await expect(clip(page, 'c1')).toHaveAttribute('data-state', 'paused');
  await at(page, 'c1', end.duration);
  await control(page, 'c1', 'st-again').click();
  await expect(clip(page, 'c1')).toHaveAttribute('data-state', 'playing');
  expect((await clipState(page, 'c1')).t).toBeLessThan(end.duration / 2);
  await control(page, 'c1', 'st-play').click();
  await expectClean(watch, browserName);
});

test('Pause holds the picture exactly where it is, and Play carries on from there', async ({ page }, testInfo) => {
  await openClip(page, testInfo, 'c2');
  await clip(page, 'c2').locator('.st-bigplay').click();
  await expect.poll(async () => (await clipState(page, 'c2')).k).toBeGreaterThanOrEqual(0);
  await control(page, 'c2', 'st-play').click();
  const paused = await clipState(page, 'c2');
  expect(paused.playing).toBe(false);
  expect(paused.state).toBe('paused');
  const held = await picture(page, 'c2');
  await page.waitForTimeout(300);
  expect((await clipState(page, 'c2')).t).toBe(paused.t);
  expect(await picture(page, 'c2')).toBe(held);
  await control(page, 'c2', 'st-play').click();
  await expect.poll(async () => (await clipState(page, 'c2')).t).toBeGreaterThan(paused.t + 100);
  // A click on the stage is the same control.
  await clip(page, 'c2').locator('.st-stage').click({ position: { x: 40, y: 80 } });
  expect((await clipState(page, 'c2')).playing).toBe(false);
});

test('the scrubber goes anywhere, by pointer and by its keys, and marks every beat', async ({ page }, testInfo) => {
  await openClip(page, testInfo, 'c6');
  const range = control(page, 'c6', 'st-range');
  const s = await clipState(page, 'c6');
  await expect(clip(page, 'c6').locator('.st-mark')).toHaveCount(s.beats.length);
  await expect(range).toHaveAttribute('max', String(s.duration - 1));

  await range.focus();
  await page.keyboard.press('End');
  let now = await clipState(page, 'c6');
  expect(now.t).toBe(s.duration - 1);
  await expect(range).toHaveAttribute('aria-valuetext', new RegExp(`^Beat ${s.beats.length} of ${s.beats.length}, 0:\\d\\d of 0:\\d\\d$`));
  await page.keyboard.press('Home');
  expect((await clipState(page, 'c6')).t).toBe(0);
  await expect(range).toHaveAttribute('aria-valuetext', `Before beat 1 of ${s.beats.length}`);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect((await clipState(page, 'c6')).t).toBe(500);
  await page.keyboard.press('ArrowLeft');
  expect((await clipState(page, 'c6')).t).toBe(250);
  // Page Up and Page Down move between the places a clip rests: the poster, then the end of each beat.
  await page.keyboard.press('PageUp');
  expect((await clipState(page, 'c6')).t).toBe(s.poster);
  await page.keyboard.press('PageUp');
  expect((await clipState(page, 'c6')).t).toBe((s.beats[0]?.t1 ?? 0) - 1);
  await page.keyboard.press('PageUp');
  now = await clipState(page, 'c6');
  expect(now.t).toBe((s.beats[1]?.t1 ?? 0) - 1);
  expect(now.k).toBe(1);
  expect(await captionShown(page, 'c6')).toBe(clipOf('c6').beats[1]?.caption.text);
  await page.keyboard.press('PageDown');
  expect((await clipState(page, 'c6')).t).toBe((s.beats[0]?.t1 ?? 0) - 1);

  // By pointer: a press two thirds of the way along lands there.
  const box = (await range.boundingBox()) as { x: number; y: number; width: number; height: number };
  await page.mouse.click(box.x + box.width * 0.66, box.y + box.height / 2);
  now = await clipState(page, 'c6');
  expect(now.t).toBeGreaterThan(s.duration * 0.55);
  expect(now.t).toBeLessThan(s.duration * 0.78);
  expect(now.playing).toBe(false);
});

test('scrubbing shows the same picture at an instant whichever way it was reached', async ({ page }, testInfo) => {
  for (const id of ['c3', 'c5']) {
    await openClip(page, testInfo, id);
    await page.evaluate((sceneId) => {
      const root = Array.from(document.querySelectorAll<HTMLElement>('.lt-clip')).find((el) => el.dataset.clip === sceneId) as HTMLElement & { ltClip: { beats: { i: number; gate: boolean }[]; pass(i: number): void } };
      for (const b of root.ltClip.beats) if (b.gate) root.ltClip.pass(b.i);
    }, id);
    const s = await clipState(page, id);
    const instants = [s.poster, ...s.beats.flatMap((b) => [Math.round((b.t0 + b.motionEnd) / 2), b.t1 - 1])];
    const first = new Map<number, string>();
    for (const t of instants) {
      await at(page, id, t);
      first.set(t, await picture(page, id));
    }
    // Backwards, then in a shuffled order: the pictures are the same ones.
    for (const t of [...instants].reverse()) {
      await at(page, id, t);
      expect(await picture(page, id), `${id} at ${t} ms, going back`).toBe(first.get(t));
    }
    for (const t of instants.filter((_, i) => i % 3 === 1).concat(instants.filter((_, i) => i % 3 === 0))) {
      await at(page, id, s.duration);
      await at(page, id, t);
      expect(await picture(page, id), `${id} at ${t} ms, from the end`).toBe(first.get(t));
    }
  }
});

test('a caption arrives before anything it describes moves', async ({ page }, testInfo) => {
  await openClip(page, testInfo, 'c6');
  const s = await clipState(page, 'c6');
  const beats = clipOf('c6').beats;
  for (const b of s.beats.slice(1)) {
    await at(page, 'c6', b.t0 - 1);
    const before = await picture(page, 'c6');
    expect(await captionShown(page, 'c6')).toBe(beats[b.i - 1]?.caption.text);
    // A fifth of a second into the beat the new caption is up and the stage has not changed.
    await at(page, 'c6', b.t0 + 200);
    expect(await captionShown(page, 'c6'), `beat ${b.i + 1}`).toBe(beats[b.i]?.caption.text);
    expect(await picture(page, 'c6'), `beat ${b.i + 1}: stage still`).toBe(before);
    // By the end of the beat it has.
    await at(page, 'c6', b.t1 - 1);
    expect(await picture(page, 'c6'), `beat ${b.i + 1}: stage moved`).not.toBe(before);
  }
});

test('with "Pause each beat" on, the clip stops at the end of every beat, and Next plays one more', async ({ page }, testInfo) => {
  await openClip(page, testInfo, 'c6');
  const s = await clipState(page, 'c6');
  await control(page, 'c6', 'st-speed').locator('input[value=\"2\"]').check();
  await control(page, 'c6', 'st-step').locator('input').check();
  expect((await clipState(page, 'c6')).stepMode).toBe(true);
  await clip(page, 'c6').locator('.st-bigplay').click();
  let now = await settled(page, 'c6');
  expect(now.t).toBe((s.beats[0]?.t1 ?? 0) - 1);
  expect(now.state).toBe('paused');
  expect(await captionShown(page, 'c6')).toBe(clipOf('c6').beats[0]?.caption.text);
  await control(page, 'c6', 'st-next').click();
  now = await settled(page, 'c6');
  expect(now.t).toBe((s.beats[1]?.t1 ?? 0) - 1);
  await control(page, 'c6', 'st-play').click();
  now = await settled(page, 'c6');
  expect(now.t).toBe((s.beats[2]?.t1 ?? 0) - 1);
  // Previous goes back to where the clip last rested, without playing.
  await control(page, 'c6', 'st-prev').click();
  now = await clipState(page, 'c6');
  expect(now.t).toBe((s.beats[1]?.t1 ?? 0) - 1);
  expect(now.playing).toBe(false);
  // Off again: Next from rest still plays exactly one beat (a step), and Play runs on.
  await control(page, 'c6', 'st-step').locator('input').uncheck();
  await control(page, 'c6', 'st-next').click();
  now = await settled(page, 'c6');
  expect(now.t).toBe((s.beats[2]?.t1 ?? 0) - 1);
  await control(page, 'c6', 'st-play').click();
  now = await settled(page, 'c6');
  expect(now.state).toBe('ended');
  await expect(control(page, 'c6', 'st-next')).toHaveAttribute('aria-disabled', 'true');
});

test('speed is one setting for every clip in the lesson, and it is kept', async ({ page }, testInfo) => {
  await openClip(page, testInfo, 'c2');
  await expect(control(page, 'c2', 'st-speed').locator('input:checked')).toHaveValue('1');
  await control(page, 'c2', 'st-speed').locator('input[value=\"1.5\"]').check();
  expect((await clipState(page, 'c2')).rate).toBe(1.5);
  expect((await clipState(page, 'c3')).rate).toBe(1.5);
  // Measured: at 2x about two seconds of clip pass in one second.
  await control(page, 'c2', 'st-speed').locator('input[value=\"2\"]').check();
  await clip(page, 'c2').locator('.st-bigplay').click();
  const a = await clipState(page, 'c2');
  const started = Date.now();
  await page.waitForTimeout(1000);
  const b = await clipState(page, 'c2');
  const ratio = (b.t - a.t) / (Date.now() - started);
  expect(ratio).toBeGreaterThan(1.5);
  expect(ratio).toBeLessThan(2.5);
  await control(page, 'c2', 'st-play').click();
  await page.reload();
  await settled(page, 'c2');
  await expect(control(page, 'c2', 'st-speed').locator('input:checked')).toHaveValue('2');
});

test.describe('a prediction', () => {
  test('stops the clip before the beat that answers it, and nothing gets past it', async ({ page, browserName }, testInfo) => {
    const watch = await openClip(page, testInfo, 'c3');
    const s = await clipState(page, 'c3');
    const hold = (s.beats[GATE]?.t0 ?? 0) - 1;
    expect(s.limit).toBe(hold);
    await expect(clip(page, 'c3').locator('.st-mark-gate')).toHaveCount(2);
    await control(page, 'c3', 'st-speed').locator('input[value=\"2\"]').check();
    await clip(page, 'c3').locator('.st-bigplay').click();
    const stopped = await settled(page, 'c3');
    expect(stopped.t).toBe(hold);
    expect(stopped.asking).toBe(true);
    expect(stopped.k).toBe(GATE - 1);
    const panel = clip(page, 'c3').locator(`li[data-beat="${GATE + 1}"] .lt-predict`);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(gate.prompt);
    // The caption that answers it is not on show, and neither is any other.
    await expect(clip(page, 'c3').locator(`li[data-beat="${GATE + 1}"] .lt-cap`)).toBeHidden();
    await expect(clip(page, 'c3').locator(`li[data-beat="${GATE}"] .lt-cap`)).toBeHidden();
    await expect(clip(page, 'c3').locator('p[role="status"]').first()).toHaveText(`The clip is waiting for your prediction. ${gate.prompt}`);

    // Play, Next, End and a drag all stay behind it.
    await control(page, 'c3', 'st-play').click();
    expect((await clipState(page, 'c3')).t).toBe(hold);
    await control(page, 'c3', 'st-next').press('Enter');
    expect((await clipState(page, 'c3')).t).toBe(hold);
    await control(page, 'c3', 'st-range').focus();
    await page.keyboard.press('End');
    expect((await clipState(page, 'c3')).t).toBe(hold);
    expect((await at(page, 'c3', s.duration)).t).toBe(hold);
    // Going back hides the question; coming forward brings it back.
    await at(page, 'c3', hold - 800);
    await expect(panel).toBeHidden();
    await expect(clip(page, 'c3').locator(`li[data-beat="${GATE}"] .lt-cap`)).toBeVisible();
    await at(page, 'c3', hold);
    await expect(panel).toBeVisible();
    await expectClean(watch, browserName);
  });

  test('checked with nothing chosen it asks for a choice; answered wrong it says why, then plays the outcome', async ({ page }, testInfo) => {
    await openClip(page, testInfo, 'c3');
    const s = await clipState(page, 'c3');
    const hold = (s.beats[GATE]?.t0 ?? 0) - 1;
    await at(page, 'c3', hold);
    const li = clip(page, 'c3').locator(`li[data-beat="${GATE + 1}"]`);
    await li.locator('button[data-act="check"]').click();
    await expect(li.locator('[data-outcome]')).toHaveText('Choose an answer first, or skip the question.');
    expect((await clipState(page, 'c3')).limit).toBe(hold);

    await li.locator(`label.lt-option[data-option="${WRONG}"]`).click();
    await li.locator('button[data-act="check"]').click();
    await expect(li.locator('[data-outcome]')).toContainText('Not quite.');
    await expect(li.locator('[data-outcome]')).toContainText(gate.options[WRONG]?.feedback as string);
    await expect(li.locator(`label.lt-option[data-option="${RIGHT}"]`)).toHaveAttribute('data-state', 'right');
    await expect(li.locator(`label.lt-option[data-option="${WRONG}"]`)).toHaveAttribute('data-state', 'wrong');
    await expect(li.locator('button[data-act="skip"]')).toBeHidden();
    await expect(clip(page, 'c3').locator('.st-mark-gate').first()).toHaveAttribute('data-passed', 'true');
    await expect(clip(page, 'c3').locator('.st-mark-gate').last()).not.toHaveAttribute('data-passed', 'true');
    // Still held, with the feedback up, until the learner goes on. What is ahead now is the next prediction.
    let now = await clipState(page, 'c3');
    expect(now.t).toBe(hold);
    expect(now.playing).toBe(false);
    expect(now.limit).toBe((s.beats[TAPPED]?.t0 ?? 0) - 1);
    await expect(li.locator('button[data-act="check"]')).toHaveText('Watch what happens');
    await control(page, 'c3', 'st-speed').locator('input[value=\"2\"]').check();
    await li.locator('button[data-act="check"]').click();
    await expect(clip(page, 'c3')).toHaveAttribute('data-state', 'playing');
    await expect(li.locator('.lt-predict')).toBeHidden();
    await expect.poll(() => captionShown(page, 'c3')).toBe(TRACE.beats[GATE]?.caption.text);
    // The outcome plays as far as the second prediction, which is skipped here; then the clip runs to its end.
    now = await settled(page, 'c3');
    expect(now.asking).toBe(true);
    expect(now.t).toBe((s.beats[TAPPED]?.t0 ?? 0) - 1);
    const tapped = clip(page, 'c3').locator(`li[data-beat="${TAPPED + 1}"]`);
    await tapped.locator('button[data-act="skip"]').click();
    await tapped.locator('button[data-act="check"]').click();
    now = await settled(page, 'c3');
    expect(now.state).toBe('ended');
    // Once passed it does not ask again.
    await at(page, 'c3', hold);
    await expect(li.locator('.lt-predict')).toBeHidden();
  });

  test('can be skipped: the answer is marked and the clip plays on', async ({ page }, testInfo) => {
    await openClip(page, testInfo, 'c3');
    const s = await clipState(page, 'c3');
    await at(page, 'c3', s.duration);
    const li = clip(page, 'c3').locator(`li[data-beat="${GATE + 1}"]`);
    await li.locator('button[data-act="skip"]').click();
    await expect(clip(page, 'c3')).toHaveAttribute('data-state', 'playing');
    await control(page, 'c3', 'st-play').click();
    // Nothing holds the clip any more until the prediction after this one.
    expect((await clipState(page, 'c3')).limit).toBe((s.beats[TAPPED]?.t0 ?? 0) - 1);
    await clip(page, 'c3').locator('.st-text input').check();
    await expect(li.locator(`label.lt-option[data-option="${RIGHT}"]`)).toHaveAttribute('data-state', 'right');
    await expect(li.locator('[data-outcome]')).toHaveText('Question skipped. The answer is marked.');
  });

  test('answered right says so', async ({ page }, testInfo) => {
    await openClip(page, testInfo, 'c4');
    const s = await clipState(page, 'c4');
    await at(page, 'c4', s.duration);
    const c4 = clipOf('c4');
    const g = c4.beats.findIndex((b) => b.gate);
    const li = clip(page, 'c4').locator(`li[data-beat="${g + 1}"]`);
    await li.locator(`label.lt-option[data-option="${(c4.beats[g]?.gate as typeof gate).options.findIndex((o) => o.correct)}"]`).click();
    await li.locator('button[data-act="check"]').click();
    await expect(li.locator('[data-outcome]')).toContainText('Your prediction was right.');
  });
});

test('every caption can be read as a list, and the description and parts are one disclosure away', async ({ page }, testInfo) => {
  await openClip(page, testInfo, 'c3');
  const root = clip(page, 'c3');
  await expect(root.locator('li.lt-beat .lt-cap').filter({ visible: true })).toHaveCount(0);
  await root.locator('.st-text input').check();
  await expect(root.locator('li.lt-beat .lt-cap').filter({ visible: true })).toHaveCount(TRACE.beats.length);
  for (const predict of await root.locator('li.lt-beat .lt-predict').all()) await expect(predict).toBeVisible();
  await expect(root.locator('li.lt-beat .lt-predict')).toHaveCount(2);
  await root.locator('.st-text input').uncheck();
  await expect(root.locator('li.lt-beat .lt-cap').filter({ visible: true })).toHaveCount(0);
  await root.locator('.st-about > summary').click();
  await expect(root.locator('.st-about .lt-clip-desc')).toHaveText(TRACE.description);
  await expect(root.locator('.st-about .lt-onstage')).toContainText('3, 8, 15, 23, 42, 57, 91');
});

test('a source opened from a caption or from the stage pauses the clip and shows its card', async ({ page }, testInfo) => {
  await openClip(page, testInfo, 'c2');
  const root = clip(page, 'c2');
  await expect(root.locator('.st-stage .lt-prov')).toHaveAttribute('data-provenance', 'sourced');
  await expect(root.locator('.st-stage .lt-prov')).toContainText('Sourced');
  await root.locator('.st-bigplay').click();
  await expect.poll(() => captionShown(page, 'c2')).not.toBe('');
  await root.locator('li.lt-beat[data-on="1"] button.lt-chip').first().click();
  const s = await clipState(page, 'c2');
  expect(s.playing).toBe(false);
  await expect(page.locator('.lt-source:popover-open')).toHaveCount(1);
  await expect(page.locator('.lt-source:popover-open')).toContainText('Binary search');
  await page.keyboard.press('Escape');
  await root.locator('.st-stage .lt-prov button.lt-chip').click();
  await expect(page.locator('.lt-source:popover-open')).toHaveCount(1);
  expect((await clipState(page, 'c2')).t).toBe(s.t);
});

test.describe('the shell around clips', () => {
  test('the lesson opens on its title card, and Start plays the first clip', async ({ page, browserName }, testInfo) => {
    const watch = await openLesson(page, testInfo, { published: examplePublishedV2() });
    await expect(page.locator('html')).toHaveClass(/lt-clips/);
    const title = page.locator('#lt-title');
    await expect(title).toHaveText(examplePublishedV2().lesson.title);
    expect(await title.locator('.st-tw').count()).toBe(examplePublishedV2().lesson.title.split(/\s+/).length);
    await expect(page.locator('header .lt-objectives li')).toHaveCount(2);
    // The card's field runs to both edges of the window, and nothing scrolls sideways for it.
    const header = await page.locator('header.lt-top').evaluate((el) => getComputedStyle(el).colorScheme);
    expect(header).toBe('dark');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await settled(page, 'c1');
    expect((await clipState(page, 'c1')).state).toBe('poster');
    await page.locator('.st-start').click();
    await expect(clip(page, 'c1')).toHaveAttribute('data-state', 'playing');
    await expect(control(page, 'c1', 'st-play')).toBeFocused();
    await control(page, 'c1', 'st-play').click();
    // The card plays once: its entrance is over and does not run again.
    await expect(page.locator('html')).toHaveClass(/lt-card-done/, { timeout: 5000 });
    await expectClean(watch, browserName);
  });

  test('Continue hands over from one clip to the next: the one left stops, the next arrives and waits', async ({ page, browserName }, testInfo) => {
    const watch = await openClip(page, testInfo, 'c1');
    await clip(page, 'c1').locator('.st-bigplay').click();
    await expect(clip(page, 'c1')).toHaveAttribute('data-state', 'playing');
    await page.locator('#lt-next').click();
    await expect(page.locator('section[data-scene="c2"]')).toBeVisible();
    await expect(page.locator('section[data-scene="c1"]')).toBeHidden();
    expect((await clipState(page, 'c1')).playing).toBe(false);
    await expect(page.locator('html')).toHaveClass(/lt-compact/);
    await expect(page).toHaveTitle(/^Scene 2 of 10: The loop, as a picture/);
    // It arrives behind a wipe, plays its establishing move, and rests on its poster.
    await expect
      .poll(async () => {
        const now = await clipState(page, 'c2');
        return now.t === now.poster && !now.playing;
      })
      .toBe(true);
    const arrived = await clipState(page, 'c2');
    expect(arrived.state).toBe('poster');
    // The wipe it arrived behind is over and gone.
    await expect.poll(() => clip(page, 'c2').locator('.st-curtain').evaluate((el) => getComputedStyle(el).visibility)).toBe('hidden');
    // Back, and the first clip is where it was left; the rail and the contents know where we are.
    await page.locator('#lt-back').click();
    await expect(page.locator('section[data-scene="c1"]')).toBeVisible();
    expect((await clipState(page, 'c1')).state).toBe('paused');
    await expect(page.locator('[data-rail="c1"]')).toHaveClass(/lt-rail-current/);
    await expectClean(watch, browserName);
  });

  test('checkpoints, the recap and the sources list work as they did, between clips', async ({ page, browserName }, testInfo) => {
    const watch = await openClip(page, testInfo, 'c3');
    await page.locator('#lt-next').click();
    const q1 = page.locator('section[data-scene="q1"]');
    await expect(q1).toBeVisible();
    await expect(q1).toHaveAttribute('data-kind', 'checkpoint');
    await q1.locator('label.lt-option').first().click();
    await q1.getByRole('button', { name: 'Check answer' }).click();
    await expect(q1.locator('[role="status"]')).not.toBeEmpty();
    await page.locator('#lt-opensources').click();
    await expect(page.locator('#lt-sources')).toBeVisible();
    await expect(page.locator('#lt-sources .lt-source-item')).toHaveCount(examplePublishedV2().lesson.evidence.length);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Contents' }).click();
    await page.locator('#lt-contents a[data-goto="end"]').click();
    const recap = page.locator('section[data-scene="end"]');
    await expect(recap).toBeVisible();
    await expect(recap.locator('.lt-takeaway')).toHaveCount(2);
    await expect(recap.locator('[data-result="q1"]')).not.toBeEmpty();
    await expectClean(watch, browserName);
  });

  test('a lesson with no clips is left exactly as it was', async ({ page, browserName }, testInfo) => {
    const watch = await openLesson(page, testInfo);
    await expect(page.locator('html')).not.toHaveClass(/lt-clips/);
    await expect(page.locator('.st-band')).toHaveCount(0);
    await expect(page.locator('.st-start')).toHaveCount(0);
    expect(await page.locator('#lt-title .st-tw').count()).toBe(0);
    await expectClean(watch, browserName);
  });
});

test.describe('narration', () => {
  test('one silent clip per beat: voice on retimes the beats to the audio and plays it, muted, from Play only', async ({ page, browserName }, testInfo) => {
    const watch = await openClip(page, testInfo, 'c2', { published: withSilentBeats() });
    const silent = await clipState(page, 'c2');
    const voice = control(page, 'c2', 'st-voice').locator('input');
    await expect(voice).not.toBeChecked();
    // The shell's own Listen bar has nothing to read on a clip scene, so it stays away.
    await expect(page.locator('#lt-audiobar')).toBeHidden();
    const audio = page.locator('#lt-audio');
    expect(await audio.evaluate((el: HTMLAudioElement) => el.paused && !el.currentSrc)).toBe(true);

    await voice.check();
    await expect.poll(async () => (await clipState(page, 'c2')).duration).not.toBe(silent.duration);
    const voiced = await clipState(page, 'c2');
    // Nothing has played: turning the voice on only measures the clips.
    expect(await audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true);
    for (const b of voiced.beats) expect(b.t1 - b.t0).toBeGreaterThanOrEqual(500);

    await clip(page, 'c2').locator('.st-bigplay').click();
    await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentSrc.startsWith('blob:') && el.muted)).toBe(true);
    await expect.poll(async () => (await clipState(page, 'c2')).k).toBeGreaterThanOrEqual(1);
    await control(page, 'c2', 'st-play').click();
    await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true);
    // Off again: the beats go back to reading time.
    await voice.uncheck();
    await expect.poll(async () => (await clipState(page, 'c2')).duration).toBe(silent.duration);
    expect(watch.requests.filter((r) => r.split('#')[0] !== watch.url)).toEqual([]);
    await expectClean(watch, browserName);
  });

  test('a lesson without narration offers no voice control', async ({ page }, testInfo) => {
    await openClip(page, testInfo, 'c2');
    await expect(control(page, 'c2', 'st-voice')).toHaveCount(0);
    await expect(page.locator('#lt-audio')).toHaveCount(0);
  });
});

test('a clip that cannot be built leaves its text version in place and says so', async ({ page }, testInfo) => {
  const broken = examplePublishedV2();
  const scene = broken.lesson.scenes.find((x) => x.id === 'c3') as unknown as { beats: { do: Record<string, unknown>[] }[] };
  (scene.beats[1] as { do: Record<string, unknown>[] }).do = [{ verb: 'move', target: 'mid', to: 'c99' }];
  const watch = await openLesson(page, testInfo, { published: broken, hash: '#/c3' });
  const root = clip(page, 'c3');
  await expect(root).toHaveAttribute('data-failed', 'true');
  await expect(root.locator('.st-band')).toHaveCount(0);
  await expect(root.locator('.lt-clip-failed')).toHaveText('This clip could not be drawn. Everything it shows is written out below.');
  await expect(root.locator('li.lt-beat')).toHaveCount(TRACE.beats.length);
  await expect(root.locator('li.lt-beat').first()).toBeVisible();
  // The other clips are unharmed, and the failure is reported, not swallowed.
  await page.locator('#lt-back').click();
  await expect(clip(page, 'c2').locator('.st-band')).toBeVisible();
  await expect.poll(() => watch.pageErrors.join(' | ')).toContain('"c99" is not a cell');
});

test('every clip of the lesson builds, at every beat, with no error and no request', async ({ page, browserName }, testInfo) => {
  const watch = await openClip(page, testInfo, 'c1');
  for (const c of CLIPS) {
    await page.evaluate((id) => {
      location.hash = `#/${id}`;
    }, c.id);
    await expect(page.locator(`section[data-scene="${c.id}"]`)).toBeVisible();
    const s = await settled(page, c.id);
    expect(s.beats).toHaveLength(c.beats.length);
    await page.evaluate((id) => {
      const root = Array.from(document.querySelectorAll<HTMLElement>('.lt-clip')).find((el) => el.dataset.clip === id) as HTMLElement & { ltClip: { beats: { i: number; gate: boolean }[]; pass(i: number): void } };
      for (const b of root.ltClip.beats) if (b.gate) root.ltClip.pass(b.i);
    }, c.id);
    for (const b of s.beats) {
      await at(page, c.id, b.t1 - 1);
      expect(await captionShown(page, c.id), `${c.id} beat ${b.i + 1}`).toBe(c.beats[b.i]?.caption.text);
    }
  }
  await expectClean(watch, browserName);
});
