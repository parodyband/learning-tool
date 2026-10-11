// Clips for someone who does not use a pointer, does not see the stage, or has asked for less
// motion: keyboard-only use from the first key to the end of a clip with a prediction, names and
// announcements, axe-core over every state in both themes and at 320 pixels, and reduced motion.
import type { Page } from '@playwright/test';
import { asPublished, exampleKitsLesson, examplePublishedV2 } from '../helpers/clip-example';
import { expect, expectClean, expectFocus, openLesson, tab, tabTo, test } from './shell-kit';
import { at, auditStage as audit, captionShown, clip, clipOf, clipState, control, openClip, picture, settled } from './stage-kit';

const TRACE = clipOf('c3');
const GATE = TRACE.beats.findIndex((b) => b.gate);
const gate = TRACE.beats[GATE]?.gate as { prompt: string; options: { text: string; correct: boolean; feedback: string }[] };

async function passGates(page: Page, id: string): Promise<void> {
  await page.evaluate((sceneId) => {
    const root = Array.from(document.querySelectorAll<HTMLElement>('.lt-clip')).find((el) => el.dataset.clip === sceneId) as HTMLElement & { ltClip: { beats: { i: number; gate: boolean }[]; pass(i: number): void } };
    for (const b of root.ltClip.beats) if (b.gate) root.ltClip.pass(b.i);
  }, id);
}

test('a clip with a prediction can be watched to its end with the keyboard alone', async ({ page, browserName }, testInfo) => {
  const watch = await openClip(page, testInfo, 'c3');
  // From the scene's heading, Tab reaches the stage's source chips, then Play.
  await page.locator('#scene-c3').focus();
  await tabTo(page, browserName, (f) => f.cls.includes('st-bigplay'));
  await page.keyboard.press('Enter');
  await expect(clip(page, 'c3')).toHaveAttribute('data-state', 'playing');
  // Focus has moved to the play control, which now pauses.
  await expectFocus(page, (f) => f.cls.includes('st-play'), 'focus on Pause');
  await expect(control(page, 'c3', 'st-play')).toHaveAccessibleName('Pause');
  // Faster, from the keyboard: the speed group is a radio group, moved with the arrow keys.
  await tabTo(page, browserName, (f) => f.tag === 'INPUT' && f.cls === '', 12);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect((await clipState(page, 'c3')).rate).toBe(2);

  // The clip stops for its prediction and takes focus to the question.
  const stopped = await settled(page, 'c3');
  expect(stopped.asking).toBe(true);
  const li = clip(page, 'c3').locator(`li[data-beat="${GATE + 1}"]`);
  await expectFocus(page, (f) => f.tag === 'INPUT', 'focus on the first option');
  expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).type)).toBe('radio');
  await page.keyboard.press('Space');
  await expect(li.locator('label.lt-option[data-picked="true"]')).toHaveCount(1);
  await tabTo(page, browserName, (f) => f.text === 'Check my prediction', 6);
  await page.keyboard.press('Enter');
  await expect(li.locator('[data-outcome]')).not.toBeEmpty();
  await expectFocus(page, (f) => f.text === 'Watch what happens', 'focus stays on the button, which now resumes');
  await page.keyboard.press('Enter');
  await expect(clip(page, 'c3')).toHaveAttribute('data-state', 'playing');
  await expectFocus(page, (f) => f.cls.includes('st-play'), 'focus back on the play control');

  // The clip stops again, for the prediction that is answered on the picture: focus goes to the first
  // cell of the row, Tab walks the cells from left to right, and Enter taps the one in focus.
  const again = await settled(page, 'c3');
  expect(again.asking).toBe(true);
  await expectFocus(page, (f) => f.cls.includes('st-tap') && f.text.startsWith('3, cell 1 of 7'), 'focus on the first cell');
  for (let i = 0; i < 5; i++) await tab(page, browserName);
  await expectFocus(page, (f) => f.text.startsWith('57, cell 6 of 7'), 'focus on the cell that holds 57');
  await page.keyboard.press('Enter');
  await expectFocus(page, (f) => f.text === 'Watch what happens', 'focus on the button that plays the outcome');
  await page.keyboard.press('Enter');
  await expect(clip(page, 'c3')).toHaveAttribute('data-state', 'playing');
  await expectFocus(page, (f) => f.cls.includes('st-play'), 'focus back on the play control, again');
  const done = await settled(page, 'c3');
  expect(done.state).toBe('ended');
  await expect(control(page, 'c3', 'st-play')).toHaveAccessibleName('Replay');

  // Back a beat, on to the scrubber, and to the very start, all without a pointer.
  await tab(page, browserName, true);
  await expectFocus(page, (f) => f.cls.includes('st-prev'), 'Previous beat');
  await page.keyboard.press('Enter');
  expect((await clipState(page, 'c3')).t).toBe((done.beats.at(-2)?.t1 ?? 0) - 1);
  await tabTo(page, browserName, (f) => f.cls.includes('st-range'), 6);
  await page.keyboard.press('Home');
  expect((await clipState(page, 'c3')).t).toBe(0);
  await expectClean(watch, browserName);
});

test('every control has a name, the stage is hidden from assistive technology, and its text is elsewhere', async ({ page }, testInfo) => {
  await openClip(page, testInfo, 'c3');
  const root = clip(page, 'c3');
  await expect(root.locator('.st-controls')).toHaveAttribute('role', 'group');
  await expect(root.locator('.st-controls')).toHaveAccessibleName('Clip controls');
  await expect(control(page, 'c3', 'st-prev')).toHaveAccessibleName('Previous beat');
  await expect(control(page, 'c3', 'st-play')).toHaveAccessibleName('Play');
  await expect(control(page, 'c3', 'st-next')).toHaveAccessibleName('Next beat');
  await expect(control(page, 'c3', 'st-again')).toHaveAccessibleName('Replay from the start');
  await expect(control(page, 'c3', 'st-range')).toHaveAccessibleName('Position in clip');
  await expect(root.getByRole('group', { name: 'Speed' })).toBeVisible();
  for (const speed of ['0.5×', '1×', '1.5×', '2×']) await expect(root.getByRole('radio', { name: speed, exact: true })).toHaveCount(1);
  await expect(root.getByRole('checkbox', { name: 'Pause each beat' })).toHaveCount(1);
  await expect(root.getByRole('checkbox', { name: 'Show every caption as a list' })).toHaveCount(1);
  await expect(root.getByRole('button', { name: 'Play', exact: true })).toHaveCount(2);
  await expect(root.locator('.st-view')).toHaveAttribute('aria-hidden', 'true');
  expect(await root.locator('.st-view').evaluate((el) => el.querySelectorAll('a, button, input, [tabindex]').length)).toBe(0);
  // What the stage shows is on the page as text: the description and the parts, and every caption.
  await expect(root.locator('.st-about')).toContainText(TRACE.description);
  await expect(root.locator('.st-prov, .lt-prov')).toContainText('A worked example written by your agent.');
  // No single-key shortcuts: letters and Space on the page do nothing to a clip.
  await page.locator('#scene-c3').focus();
  for (const key of ['k', ' ', 'j', 'l', 'ArrowRight']) await page.keyboard.press(key);
  expect((await clipState(page, 'c3')).playing).toBe(false);
  expect((await clipState(page, 'c3')).state).toBe('poster');
});

test('beat changes, the prediction and the end are announced once each, in one polite region', async ({ page }, testInfo) => {
  await openClip(page, testInfo, 'c3');
  const live = clip(page, 'c3').locator('.st-band > p[role="status"]');
  await expect(live).toHaveCount(1);
  await expect(live).toBeEmpty();
  await control(page, 'c3', 'st-step').locator('input').check();
  await control(page, 'c3', 'st-speed').locator('input[value="2"]').check();
  await clip(page, 'c3').locator('.st-bigplay').click();
  await expect(live).toHaveText(`Beat 1 of ${TRACE.beats.length}. ${TRACE.beats[0]?.caption.text}`);
  await settled(page, 'c3');
  await control(page, 'c3', 'st-next').click();
  await expect(live).toHaveText(`Beat 2 of ${TRACE.beats.length}. ${TRACE.beats[1]?.caption.text}`);
  // The end of that beat is where the clip waits for its prediction, and it says so.
  await settled(page, 'c3');
  await expect(live).toHaveText(`The clip is waiting for your prediction. ${gate.prompt}`);
  await expect(control(page, 'c3', 'st-next')).toHaveAttribute('aria-disabled', 'true');
  // A drag across several beats announces only where it stops.
  await passGates(page, 'c3');
  const s = await clipState(page, 'c3');
  for (const b of s.beats) await at(page, 'c3', b.t0 + 10);
  await expect(live).toHaveText(new RegExp(`^Beat ${s.beats.length} of ${s.beats.length}\\.`));
});

const STATES: { name: string; reach(page: Page): Promise<void> }[] = [
  { name: 'the poster', reach: async () => {} },
  {
    name: 'paused in the middle of a beat',
    reach: async (page) => {
      const s = await clipState(page, 'c3');
      await at(page, 'c3', Math.round(((s.beats[1]?.t0 ?? 0) + (s.beats[1]?.motionEnd ?? 0)) / 2));
    },
  },
  {
    name: 'a prediction waiting',
    reach: async (page) => {
      const s = await clipState(page, 'c3');
      await at(page, 'c3', s.duration);
      await expect(clip(page, 'c3').locator('.lt-predict').filter({ visible: true })).toHaveCount(1);
    },
  },
  {
    name: 'a prediction answered wrong',
    reach: async (page) => {
      const s = await clipState(page, 'c3');
      await at(page, 'c3', s.duration);
      const li = clip(page, 'c3').locator(`li[data-beat="${GATE + 1}"]`);
      await li.locator(`label.lt-option[data-option="${gate.options.findIndex((o) => !o.correct)}"]`).click();
      await li.locator('button[data-act="check"]').click();
      await expect(li.locator('[data-outcome]')).toContainText('Not quite.');
    },
  },
  {
    name: 'the end, zoomed in',
    reach: async (page) => {
      await passGates(page, 'c3');
      const s = await clipState(page, 'c3');
      await at(page, 'c3', s.duration);
    },
  },
  {
    name: 'every caption as a list, with the text version open',
    reach: async (page) => {
      await clip(page, 'c3').locator('.st-text input').check();
      await clip(page, 'c3').locator('.st-about > summary').click();
    },
  },
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });
    for (const state of STATES) {
      test(`the trace: ${state.name}`, async ({ page }, testInfo) => {
        await openClip(page, testInfo, 'c3');
        await state.reach(page);
        await audit(page, `${state.name}, ${scheme}`);
      });
    }

    test('the title card and the first clip', async ({ page }, testInfo) => {
      await openLesson(page, testInfo, { published: examplePublishedV2() });
      await settled(page, 'c1');
      await audit(page, `title card, ${scheme}`);
    });

    test('every clip of the lesson at its last beat', async ({ page }, testInfo) => {
      await openClip(page, testInfo, 'c1');
      for (const id of ['c1', 'c2', 'c4', 'c5', 'c6']) {
        await page.evaluate((sceneId) => {
          location.hash = `#/${sceneId}`;
        }, id);
        await expect(page.locator(`section[data-scene="${id}"]`)).toBeVisible();
        await settled(page, id);
        await passGates(page, id);
        const s = await clipState(page, id);
        await at(page, id, s.duration);
        await audit(page, `${id} at its end, ${scheme}`);
      }
    });
  });
}

test.describe('axe at 320 pixels', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test('the trace, waiting for its prediction, and one clip of every kind the engine draws', async ({ page }, testInfo) => {
    await openClip(page, testInfo, 'c3');
    await at(page, 'c3', (await clipState(page, 'c3')).duration);
    await audit(page, 'a prediction waiting at 320');
    const kits = exampleKitsLesson(['sequence', 'cells', 'dots', 'chart', 'flow', 'words']);
    await openLesson(page, testInfo, { published: asPublished(kits), hash: '#/k-sequence' });
    for (const scene of kits.scenes) {
      await page.evaluate((sceneId) => {
        location.hash = `#/${sceneId}`;
      }, scene.id);
      await expect(page.locator(`section[data-scene="${scene.id}"]`)).toBeVisible();
      await settled(page, scene.id);
      const s = await clipState(page, scene.id);
      await at(page, scene.id, s.duration);
      await audit(page, `${scene.id} at 320`);
    }
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('a clip is a sequence of stills: one picture per beat, no travel, and it waits after each', async ({ page, browserName }, testInfo) => {
    const watch = await openClip(page, testInfo, 'c2');
    const s = await clipState(page, 'c2');
    expect(s.reduced).toBe(true);
    // Arriving shows the poster at once: the establishing move is not played.
    expect(s.t).toBe(s.poster);
    await expect(control(page, 'c2', 'st-step').locator('input')).toBeChecked();
    // Every instant of a beat is the same picture: its end state.
    for (const b of s.beats) {
      const frames = new Set<string>();
      for (let i = 0; i <= 12; i++) {
        await at(page, 'c2', b.t0 + ((b.t1 - 1 - b.t0) * i) / 12);
        frames.add(await picture(page, 'c2'));
      }
      expect(frames.size, `beat ${b.i + 1}`).toBe(1);
    }
    // Next goes to the next still at once, with its caption whole.
    await at(page, 'c2', s.poster);
    await control(page, 'c2', 'st-next').click();
    let now = await clipState(page, 'c2');
    expect(now.playing).toBe(false);
    expect(now.t).toBe((s.beats[0]?.t1 ?? 0) - 1);
    expect(await captionShown(page, 'c2')).toBe(clipOf('c2').beats[0]?.caption.text);
    expect(await clip(page, 'c2').locator('li.lt-beat[data-on="1"] .lt-cap').evaluate((el: HTMLElement) => el.style.opacity)).toBe('1');
    await control(page, 'c2', 'st-next').click();
    now = await clipState(page, 'c2');
    expect(now.t).toBe((s.beats[1]?.t1 ?? 0) - 1);
    await expectClean(watch, browserName);
  });

  test('a prediction still holds the clip, and the title card and the hand-over do not move', async ({ page }, testInfo) => {
    await openLesson(page, testInfo, { published: examplePublishedV2() });
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    await page.evaluate(() => {
      location.hash = '#/c3';
    });
    await expect(page.locator('section[data-scene="c3"]')).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    const s = await clipState(page, 'c3');
    expect(s.t).toBe(s.poster);
    const hold = (s.beats[GATE]?.t0 ?? 0) - 1;
    for (let i = 0; i < GATE; i++) await control(page, 'c3', 'st-next').click();
    expect((await clipState(page, 'c3')).t).toBe(hold);
    await control(page, 'c3', 'st-next').press('Enter');
    const now = await clipState(page, 'c3');
    expect(now.t).toBe(hold);
    expect(now.asking).toBe(true);
    await expect(clip(page, 'c3').locator('.lt-predict').filter({ visible: true })).toHaveCount(1);
  });
});

test('the system setting is followed while the page is open', async ({ page }, testInfo) => {
  await openClip(page, testInfo, 'c2');
  expect((await clipState(page, 'c2')).reduced).toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => (await clipState(page, 'c2')).reduced).toBe(true);
  await expect(control(page, 'c2', 'st-step').locator('input')).toBeChecked();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(async () => (await clipState(page, 'c2')).reduced).toBe(false);
});

test.describe('more contrast and forced colours', () => {
  test('with more contrast the stage is black and white and still passes', async ({ page }, testInfo) => {
    await page.emulateMedia({ contrast: 'more' });
    await openClip(page, testInfo, 'c3');
    await at(page, 'c3', (await clipState(page, 'c3')).beats[1]?.t1 ?? 0);
    await audit(page, 'more contrast');
  });

  test('in forced colours the band keeps an edge and every control is still there', async ({ page }, testInfo) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await openClip(page, testInfo, 'c3');
    const edge = await clip(page, 'c3').locator('.st-band').evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(Number.parseFloat(edge)).toBeGreaterThanOrEqual(1);
    await expect(control(page, 'c3', 'st-play')).toBeVisible();
    await expect(control(page, 'c3', 'st-range')).toBeVisible();
  });
});
