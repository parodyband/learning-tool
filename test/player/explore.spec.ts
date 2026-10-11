// Lessons you can poke: the hand-over at the end of a clip, sliders that the picture follows, a
// goal that is noticed once, and predictions answered by tapping the stage. Also what each of them
// is with scripting off, on paper, with reduced motion, at 320 pixels and to axe.
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { ClipScene } from '../../src/core/clip';
import { asPublished, examplePublishedV2, exploreLesson, lessonOf } from '../helpers/clip-example';
import { type Watch, expect, expectClean, expectFocus, openLesson, tab, test } from './shell-kit';
import { at, auditStage, clip, clipOf, clipState, control, expectNoSidewaysScroll, picture, settled } from './stage-kit';

const XP_LESSON = exploreLesson();
const XP = asPublished(XP_LESSON);
const xpClip = (id: string): ClipScene => XP_LESSON.scenes.find((s) => s.id === id) as ClipScene;
const BARS = xpClip('x-bars');
const DOTS = xpClip('x-dots');
const CURVE = xpClip('x-curve');
const TRACE = clipOf('c3');
const PICK = TRACE.beats.findIndex((b) => b.gate && 'pick' in b.gate);
const pickGate = TRACE.beats[PICK]?.gate as { prompt: string; pick: string[]; right: string; wrong: string };

async function open(page: Page, testInfo: TestInfo, id: string, published = XP): Promise<Watch> {
  const watch = await openLesson(page, testInfo, { published, hash: `#/${id}` });
  await settled(page, id);
  return watch;
}
/** Answer nothing: mark every prediction up to (not including) beat `upTo` as passed, through the handle the player leaves for tests. */
async function passGates(page: Page, id: string, upTo = 99): Promise<void> {
  await page.evaluate(([sceneId, limit]) => {
    const root = Array.from(document.querySelectorAll<HTMLElement>('.lt-clip')).find((el) => el.dataset.clip === sceneId) as HTMLElement & { ltClip: { beats: { i: number; gate: boolean }[]; pass(i: number): void } };
    for (const b of root.ltClip.beats) if (b.gate && b.i < (limit as number)) root.ltClip.pass(b.i);
  }, [id, upTo] as const);
}
/** Press Play: with the pointer, or (`keys`) with the keyboard, which leaves focus on the control in every browser. */
async function pressPlay(page: Page, id: string, keys: boolean): Promise<void> {
  if (!keys) return control(page, id, 'st-play').click();
  await control(page, id, 'st-play').focus();
  await page.keyboard.press('Enter');
}
/** Let the clip play its last moments and end by itself, so the stage is handed over as it is for a learner. */
async function toExplore(page: Page, id: string, keys = false): Promise<void> {
  await passGates(page, id);
  const s = await clipState(page, id);
  await at(page, id, s.duration - 350);
  await pressPlay(page, id, keys);
  await expect(clip(page, id)).toHaveAttribute('data-exploring', 'true', { timeout: 15_000 });
}
/** Play up to the prediction on beat `beat` (0-based) and stop there, as playback does. */
async function toGate(page: Page, id: string, beat: number, keys = false): Promise<void> {
  await passGates(page, id, beat);
  const s = await clipState(page, id);
  await at(page, id, (s.beats[beat]?.t0 ?? 0) - 400);
  await pressPlay(page, id, keys);
  await expect(clip(page, id)).toHaveAttribute('data-asking', 'true', { timeout: 15_000 });
  await settled(page, id);
}
const panel = (page: Page, id: string): Locator => clip(page, id).locator('.st-explore');
/** A slider of the panel: the only one, or the one for the control with this id. */
const slider = (page: Page, id: string, control?: string): Locator => panel(page, id).locator(control ? `[data-control="${control}"] input[type="range"]` : 'input[type="range"]');
/** Put a slider where a drag would: its value, then the event a drag fires. */
async function slide(page: Page, id: string, value: number, control?: string): Promise<void> {
  await slider(page, id, control).evaluate((el, v) => {
    (el as HTMLInputElement).value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
/** What the stage shows in a class of its parts, hidden parts left out. */
function shownText(page: Page, id: string, cls: string): Promise<string[]> {
  return page.evaluate(([sceneId, name]) => {
    const root = Array.from(document.querySelectorAll<HTMLElement>('.lt-clip')).find((el) => el.dataset.clip === sceneId) as HTMLElement;
    return Array.from(root.querySelectorAll<HTMLElement>(`.st-view .${name}`)).filter((el) => el.style.opacity !== '0').map((el) => (el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim());
  }, [id, cls] as const);
}
/** Wait until the stage has stopped changing: every eased value has arrived. */
async function rest(page: Page, id: string): Promise<void> {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = await picture(page, id);
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [200], timeout: 8000 },
    )
    .toBe(true);
}
const status = (page: Page, id: string): Locator => clip(page, id).locator('.st-band > p[role="status"]');
const tapButton = (page: Page, id: string, part: string): Locator => clip(page, id).locator(`.st-taps .st-tap[data-part="${part}"]`);

// ------------------------------------------------------------------------------------------------ explore

test('when the last beat has played the stage is handed over: "Your turn", the prompt, a labelled slider, the goal, and a way to replay', async ({ page, browserName }, testInfo) => {
  const watch = await open(page, testInfo, 'x-bars');
  // Before the clip has played there is no panel: the caption strip is the clip's.
  await expect(panel(page, 'x-bars')).toBeHidden();
  await toExplore(page, 'x-bars');
  const x = BARS.explore as NonNullable<ClipScene['explore']>;
  const p = panel(page, 'x-bars');
  await expect(p).toBeVisible();
  await expect(p.locator('.lt-explore-kicker')).toHaveText('Your turn');
  await expect(p.locator('.lt-explore-prompt')).toHaveText(x.prompt);
  // A native range input, named by its visible label, with its value and its range.
  const s = p.getByRole('slider');
  await expect(s).toHaveCount(1);
  await expect(s).toHaveAccessibleName('Items in the list');
  expect(await s.evaluate((el) => [el.tagName, (el as HTMLInputElement).type, (el as HTMLInputElement).min, (el as HTMLInputElement).max, (el as HTMLInputElement).step, (el as HTMLInputElement).value])).toEqual(['INPUT', 'range', '2', '64', '1', '20']);
  await expect(s).toHaveAttribute('aria-valuetext', '20');
  await expect(p.locator('.lt-xp-label')).toBeVisible();
  await expect(p.locator('.st-xp-out')).toHaveText('20');
  await expect(p.locator('.lt-xp-bounds [data-min]')).toHaveText('2');
  await expect(p.locator('.lt-xp-bounds [data-max]')).toHaveText('64');
  // The goal, not yet reached, and the way back.
  await expect(p.locator('.lt-xp-goal-words')).toHaveText(x.goal?.text as string);
  await expect(p.locator('[data-goal]')).not.toHaveAttribute('data-reached', 'true');
  await expect(p.locator('.st-xp-done')).toBeHidden();
  await expect(p.getByRole('button', { name: 'Replay the clip' })).toBeVisible();
  // The stage says it is theirs, the last caption has made way, and the play control replays.
  await expect(clip(page, 'x-bars').locator('.st-live')).toBeVisible();
  await expect(clip(page, 'x-bars').locator('ol.lt-beats')).toBeHidden();
  await expect(control(page, 'x-bars', 'st-play')).toHaveAccessibleName('Replay');
  await expect(status(page, 'x-bars')).toHaveText(new RegExp(`^End of clip\\. .*Your turn\\. ${x.prompt.slice(0, 30)}`));
  // The bars and the read-out stand where the clip left them: the hand-over itself changes no number.
  expect(await shownText(page, 'x-bars', 'st-barval')).toEqual(['20', '5']);
  expect((await shownText(page, 'x-bars', 'st-stat')).join(' ')).toContain('4.0× as many');
  // Nothing moves until the learner moves it.
  await page.waitForTimeout(1300);
  const before = await picture(page, 'x-bars');
  await page.waitForTimeout(400);
  expect(await picture(page, 'x-bars')).toBe(before);
  await expectClean(watch, browserName);
});

test('the slider works from the keyboard, and the bars and the read-out follow it', async ({ page, browserName }, testInfo) => {
  const watch = await open(page, testInfo, 'x-bars');
  await toExplore(page, 'x-bars', true);
  // Someone who reached the end from the keyboard is taken to the slider.
  await expectFocus(page, (f) => f.cls.includes('lt-xp-range'), 'focus on the slider');
  await page.keyboard.press('ArrowRight');
  await expect(slider(page, 'x-bars')).toHaveAttribute('aria-valuetext', '21');
  await expect(panel(page, 'x-bars').locator('.st-xp-out')).toHaveText('21');
  await expect.poll(() => shownText(page, 'x-bars', 'st-barval')).toEqual(['21', '5']);
  await page.keyboard.press('End');
  await expect(slider(page, 'x-bars')).toHaveAttribute('aria-valuetext', '64');
  await expect.poll(() => shownText(page, 'x-bars', 'st-barval')).toEqual(['64', '7']);
  await expect.poll(async () => (await shownText(page, 'x-bars', 'st-stat')).join(' ')).toContain('9.1× as many');
  // Dragging to the end does not reach the goal: it is a place inside the range.
  await expect(panel(page, 'x-bars').locator('[data-goal]')).not.toHaveAttribute('data-reached', 'true');
  await page.keyboard.press('Home');
  await expect.poll(() => shownText(page, 'x-bars', 'st-barval')).toEqual(['2', '2']);
  // A bound part is marked as the learner's, in the slider's colour.
  expect(await clip(page, 'x-bars').locator('.st-stat[data-live="1"]').count()).toBe(1);
  // What the slider did is also said, for someone who cannot see the stage.
  await expect(status(page, 'x-bars')).toHaveText(/^Now: Linear search 2, Binary search 2, Linear needs 1\.0× as many\.$/, { timeout: 5000 });
  await expectClean(watch, browserName);
});

test('the picture eases to a new value, and with reduced motion it is simply there', async ({ page }, testInfo) => {
  await open(page, testInfo, 'x-bars');
  await toExplore(page, 'x-bars');
  /** Move the slider, wait for one frame to be drawn, and read the taller bar's value. */
  const oneFrameAfter = (value: number): Promise<string> =>
    slider(page, 'x-bars').evaluate(
      (el, v) =>
        new Promise<string>((resolve) => {
          (el as HTMLInputElement).value = String(v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          requestAnimationFrame(() => requestAnimationFrame(() => resolve((el.closest('.lt-clip') as HTMLElement).querySelector('.st-barval')?.textContent ?? '')));
        }),
      value,
    );
  const mid = Number(await oneFrameAfter(64));
  expect(mid).toBeGreaterThan(20);
  expect(mid).toBeLessThan(64);
  await expect.poll(() => shownText(page, 'x-bars', 'st-barval')).toEqual(['64', '7']);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await oneFrameAfter(3)).toBe('3');
});

test('a real drag moves the slider, and the slider is large enough to drag', async ({ page }, testInfo) => {
  await open(page, testInfo, 'x-bars');
  await toExplore(page, 'x-bars');
  // The hand-over may scroll the band into place: wait until the slider has stopped moving.
  let box = { x: -1, y: -1, width: 0, height: 0 };
  await expect
    .poll(async () => {
      const now = (await slider(page, 'x-bars').boundingBox()) as typeof box;
      const still = now.x === box.x && now.y === box.y;
      box = now;
      return still;
    }, { intervals: [250] })
    .toBe(true);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(240);
  // The thumb stands at 20 of 2..64. Take it and pull it most of the way to the right.
  const thumb = box.x + 14 + ((box.width - 28) * 18) / 62;
  await page.mouse.move(thumb, box.y + box.height / 2);
  await page.mouse.down();
  await expect(panel(page, 'x-bars').locator('[data-control]')).toHaveAttribute('data-active', 'true');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const value = Number(await slider(page, 'x-bars').inputValue());
  expect(value).toBeGreaterThan(44);
  expect(value).toBeLessThan(58);
  await expect.poll(async () => (await shownText(page, 'x-bars', 'st-barval'))[0]).toBe(String(value));
  await expect(panel(page, 'x-bars').locator('[data-control]')).not.toHaveAttribute('data-active', 'true');
  // A click on the stage while it is the learner's does not start the clip again.
  await clip(page, 'x-bars').locator('.st-stage').click({ position: { x: 30, y: 200 } });
  await expect(clip(page, 'x-bars')).toHaveAttribute('data-exploring', 'true');
});

test('the goal is noticed the first time its condition holds, announced once, and stays reached', async ({ page, browserName }, testInfo) => {
  const watch = await open(page, testInfo, 'x-bars');
  await toExplore(page, 'x-bars');
  const goal = (BARS.explore as NonNullable<ClipScene['explore']>).goal as { text: string; when: string; done: string };
  const box = panel(page, 'x-bars').locator('[data-goal]');
  // Count what the status region says from here on.
  await status(page, 'x-bars').evaluate((el) => {
    const heard: string[] = [];
    (window as unknown as { heard: string[] }).heard = heard;
    new MutationObserver(() => heard.push(el.textContent ?? '')).observe(el, { childList: true, characterData: true, subtree: true });
  });
  // Neither end of the slider reaches it, and nor does a list one item short.
  for (const n of [64, 2, 30]) {
    await slide(page, 'x-bars', n);
    await page.waitForTimeout(250);
    await expect(box).not.toHaveAttribute('data-reached', 'true');
  }
  await expect(clip(page, 'x-bars')).not.toHaveAttribute('data-won', 'true');
  await slide(page, 'x-bars', 31);
  await expect(box).toHaveAttribute('data-reached', 'true');
  await expect(box.locator('.lt-xp-goal-kicker')).toHaveText('Goal reached');
  await expect(box.locator('.st-xp-done')).toBeVisible();
  await expect(box.locator('.st-xp-done')).toHaveText(goal.done);
  await expect(clip(page, 'x-bars')).toHaveAttribute('data-won', 'true');
  await expect(status(page, 'x-bars')).toHaveText(`Goal reached. ${goal.done}`);
  // Away from it, and onto it again: it stays reached, and is not announced a second time.
  await slide(page, 'x-bars', 10);
  await expect(box).toHaveAttribute('data-reached', 'true');
  await expect(box.locator('.st-xp-done')).toBeVisible();
  await slide(page, 'x-bars', 31);
  await page.waitForTimeout(1600);
  const heard = await page.evaluate(() => (window as unknown as { heard: string[] }).heard);
  expect(heard.filter((text) => text.startsWith('Goal reached'))).toHaveLength(1);
  await expectClean(watch, browserName);
});

test('replaying the clip puts the sliders back where they start; scrubbing out of the end hides the panel', async ({ page, browserName }, testInfo) => {
  const watch = await open(page, testInfo, 'x-bars');
  await toExplore(page, 'x-bars');
  await slide(page, 'x-bars', 31);
  await expect(panel(page, 'x-bars').locator('[data-goal]')).toHaveAttribute('data-reached', 'true');
  await slide(page, 'x-bars', 50);
  await expect.poll(() => shownText(page, 'x-bars', 'st-barval')).toEqual(['50', '6']);

  // Scrub back out of the end: the panel goes, and the stage shows the clip's own picture again.
  const s = await clipState(page, 'x-bars');
  await at(page, 'x-bars', (s.beats[1]?.t1 ?? 0) - 1);
  await expect(clip(page, 'x-bars')).not.toHaveAttribute('data-exploring', 'true');
  await expect(panel(page, 'x-bars')).toBeHidden();
  await expect(clip(page, 'x-bars').locator('.st-live')).toBeHidden();
  await expect(clip(page, 'x-bars').locator('ol.lt-beats')).toBeVisible();
  expect(await shownText(page, 'x-bars', 'st-barval')).toEqual(['20', '5']);
  // Scrub to the end again: the panel is back, with the learner's value still on it and on the stage.
  await at(page, 'x-bars', s.duration);
  await expect(clip(page, 'x-bars')).toHaveAttribute('data-exploring', 'true');
  // Reached by scrubbing, the hand-over is still said.
  await expect(status(page, 'x-bars')).toHaveText(/^End of clip\. .*Your turn\. Drag to change the size of the list/);
  await expect(slider(page, 'x-bars')).toHaveValue('50');
  await expect.poll(() => shownText(page, 'x-bars', 'st-barval')).toEqual(['50', '6']);

  // "Replay the clip": the clip plays from its start, with every slider back at its starting value.
  await panel(page, 'x-bars').getByRole('button', { name: 'Replay the clip' }).click();
  await expect(clip(page, 'x-bars')).toHaveAttribute('data-state', 'playing');
  await expect(panel(page, 'x-bars')).toBeHidden();
  await expect(control(page, 'x-bars', 'st-play')).toBeFocused();
  expect((await clipState(page, 'x-bars')).t).toBeLessThan(s.duration / 2);
  await control(page, 'x-bars', 'st-play').click();
  await at(page, 'x-bars', s.duration - 300);
  await control(page, 'x-bars', 'st-play').click();
  await expect(clip(page, 'x-bars')).toHaveAttribute('data-exploring', 'true', { timeout: 15_000 });
  await expect(slider(page, 'x-bars')).toHaveValue('20');
  await expect(slider(page, 'x-bars')).toHaveAttribute('aria-valuetext', '20');
  await expect(panel(page, 'x-bars').locator('.st-xp-out')).toHaveText('20');
  await expect.poll(() => shownText(page, 'x-bars', 'st-barval')).toEqual(['20', '5']);
  // A goal that was reached stays reached.
  await expect(panel(page, 'x-bars').locator('[data-goal]')).toHaveAttribute('data-reached', 'true');
  // The transport's own Replay does the same.
  await slide(page, 'x-bars', 55);
  await control(page, 'x-bars', 'st-again').click();
  await control(page, 'x-bars', 'st-play').click();
  expect(await panel(page, 'x-bars').locator('input[type="range"]').inputValue()).toBe('20');
  await expectClean(watch, browserName);
});

test('dots: groups resize with the slider, counts follow the formulas, and the goal lands', async ({ page, browserName }, testInfo) => {
  const watch = await open(page, testInfo, 'x-dots');
  await toExplore(page, 'x-dots');
  expect(await shownText(page, 'x-dots', 'st-glabel')).toEqual(['True positives 9', 'False alarms 89', 'Negative results 902']);
  await expect(slider(page, 'x-dots')).toHaveAttribute('aria-valuetext', '1%');
  const before = await picture(page, 'x-dots');
  // The far end of the slider does not reach the goal: there the true positives are far ahead.
  await slide(page, 'x-dots', 50);
  await expect.poll(() => shownText(page, 'x-dots', 'st-glabel')).toEqual(['True positives 450', 'False alarms 45', 'Negative results 505']);
  await expect(panel(page, 'x-dots').locator('[data-goal]')).not.toHaveAttribute('data-reached', 'true');
  await slide(page, 'x-dots', 10);
  await expect(slider(page, 'x-dots')).toHaveAttribute('aria-valuetext', '10%');
  await expect.poll(() => shownText(page, 'x-dots', 'st-glabel')).toEqual(['True positives 90', 'False alarms 81', 'Negative results 829']);
  await expect.poll(async () => (await shownText(page, 'x-dots', 'st-stat')).join(' ')).toContain('53%');
  expect(await picture(page, 'x-dots')).not.toBe(before);
  await expect(panel(page, 'x-dots').locator('[data-goal]')).toHaveAttribute('data-reached', 'true');
  // The dots come to rest: once they have, the picture is still.
  await page.waitForTimeout(1200);
  const rest = await picture(page, 'x-dots');
  await page.waitForTimeout(300);
  expect(await picture(page, 'x-dots')).toBe(rest);
  // Back at the start, the picture is the one the clip ended on: the same dots in the same places.
  await slide(page, 'x-dots', 1);
  await expect.poll(() => shownText(page, 'x-dots', 'st-glabel')).toEqual(['True positives 9', 'False alarms 89', 'Negative results 902']);
  await expect.poll(() => picture(page, 'x-dots'), { timeout: 5000 }).toBe(before);
  await expectClean(watch, browserName);
});

test('a curve chart: axes, curves, a point on the crossing; the demand curve and the point follow the slider and the axes stay put', async ({ page, browserName }, testInfo) => {
  const watch = await open(page, testInfo, 'x-curve');
  await toExplore(page, 'x-curve');
  const view = clip(page, 'x-curve').locator('.st-view');
  const read = (): Promise<{ ticks: string[]; curves: string[]; pills: string[]; tips: string[]; dot: string }> =>
    view.evaluate((el) => ({
      ticks: Array.from(el.querySelectorAll('.st-tick, .st-xtick, .st-xlabel, .st-ylabel')).map((t) => t.textContent ?? ''),
      curves: Array.from(el.querySelectorAll('.st-plot .st-curve')).map((p) => p.getAttribute('d') ?? ''),
      pills: Array.from(el.querySelectorAll<HTMLElement>('.st-pt-pill')).map((p) => p.textContent ?? ''),
      tips: Array.from(el.querySelectorAll<HTMLElement>('.st-tipval')).map((p) => p.textContent ?? ''),
      dot: el.querySelector('.st-pt')?.getAttribute('transform') ?? '',
    }));
  const start = await read();
  expect(start.ticks).toEqual(expect.arrayContaining(['0', '12', '140', 'Cups a day', 'Price of a cup']));
  expect(start.curves).toHaveLength(2);
  for (const d of start.curves) expect(d.split('L').length).toBeGreaterThan(40);
  expect(start.pills).toEqual(['60', '5.00']);
  // Two sliders, each named by its label.
  await expect(panel(page, 'x-curve').getByRole('slider')).toHaveCount(2);
  await expect(panel(page, 'x-curve').getByRole('slider', { name: 'Shift in demand' })).toHaveValue('0');
  await expect(panel(page, 'x-curve').getByRole('slider', { name: 'Change in costs' })).toHaveAttribute('aria-valuetext', '0.0');
  expect((await shownText(page, 'x-curve', 'st-stat')).join(' ')).toMatch(/Price ?5\.00.*Cups sold ?60/i);
  // Each curve is named at its right end.
  expect(await shownText(page, 'x-curve', 'st-seriesname')).toEqual(['Supply', 'Demand']);
  // The curves are clipped to the plot: the nested svg is as large as the plot and no larger.
  const clipped = await view.evaluate((el) => {
    const plot = el.querySelector('.st-plot') as SVGSVGElement;
    return { overflow: getComputedStyle(plot).overflow, w: plot.width.baseVal.value, h: plot.height.baseVal.value };
  });
  expect(clipped.overflow).not.toBe('visible');
  expect(clipped.w).toBeGreaterThan(200);

  // More demand alone: the demand curve moves, supply stays, the crossing climbs, and the price with it.
  await slide(page, 'x-curve', 2.5, 'demand');
  await expect.poll(async () => (await read()).pills).toEqual(['85', '6.25']);
  await expect.poll(async () => (await shownText(page, 'x-curve', 'st-stat')).join(' ')).toMatch(/Price ?6\.25.*Cups sold ?85/i);
  // Let the curve come to rest before reading where it is.
  await rest(page, 'x-curve');
  const moved = await read();
  expect(moved.ticks).toEqual(start.ticks);
  expect(moved.curves[0]).toBe(start.curves[0]);
  expect(moved.curves[1]).not.toBe(start.curves[1]);
  expect(moved.dot).not.toBe(start.dot);
  expect(moved.tips).toEqual(['9.0', '3.5']);
  await expect(slider(page, 'x-curve', 'demand')).toHaveAttribute('aria-valuetext', '2.5');
  // One slider at its end does not reach the goal: the price moved.
  await expect(panel(page, 'x-curve').locator('[data-goal]')).not.toHaveAttribute('data-reached', 'true');
  // Cheaper supply as well, in step: the supply curve moves now, the price is back where it began, and more cups sell.
  await slide(page, 'x-curve', -2.5, 'costs');
  await expect.poll(async () => (await read()).pills).toEqual(['110', '5.00']);
  await rest(page, 'x-curve');
  const both = await read();
  expect(both.curves[1]).toBe(moved.curves[1]);
  expect(both.curves[0]).not.toBe(moved.curves[0]);
  expect(both.ticks).toEqual(start.ticks);
  await expect(panel(page, 'x-curve').locator('[data-goal]')).toHaveAttribute('data-reached', 'true');
  await expect(status(page, 'x-curve')).toHaveText(/^Goal reached\. Stronger demand lifts the price/);
  await expectClean(watch, browserName);
});

// ------------------------------------------------------------------------------------------------ tap gates

test('a tap gate: every cell is a labelled button in reading order; a wrong tap is marked and explained; the right one plays the outcome', async ({ page, browserName }, testInfo) => {
  const watch = await open(page, testInfo, 'c3', examplePublishedV2());
  await toGate(page, 'c3', PICK);
  const c3 = clip(page, 'c3');
  const li = c3.locator(`li[data-beat="${PICK + 1}"]`);
  // The prompt is where the options would be, with what to do and a way to skip.
  await expect(li.locator('.lt-predict-prompt')).toHaveText(pickGate.prompt);
  await expect(li.getByText('Tap your answer on the picture.')).toBeVisible();
  await expect(li.getByRole('button', { name: 'Skip the question' })).toBeVisible();
  await expect(li.getByRole('button', { name: 'Watch what happens' })).toBeHidden();
  await expect(status(page, 'c3')).toHaveText(new RegExp(`tap your answer on the picture\\. ${pickGate.prompt.slice(0, 20)}`));
  // The buttons: real ones, named, grouped under the question, laid over the cells from left to right.
  const group = c3.getByRole('group', { name: /^Answer on the picture: Three cells/ });
  await expect(group).toBeVisible();
  const buttons = group.getByRole('button');
  await expect(buttons).toHaveCount(7);
  const names = await buttons.evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));
  expect(names).toEqual(['3, cell 1 of 7', '8, cell 2 of 7', '15, cell 3 of 7', '23, cell 4 of 7', '42, cell 5 of 7', '57, cell 6 of 7', '91, cell 7 of 7']);
  await expect(tapButton(page, 'c3', 'c5')).toHaveAccessibleName('57, cell 6 of 7');
  const boxes = await buttons.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left));
  expect([...boxes].sort((a, b) => a - b)).toEqual(boxes);
  // Each button sits on its cell.
  const overlap = await c3.evaluate((root) => {
    const cells = Array.from(root.querySelectorAll<HTMLElement>('.st-view .st-cell')).map((el) => el.getBoundingClientRect());
    const taps = Array.from(root.querySelectorAll<HTMLElement>('.st-tap')).map((el) => el.getBoundingClientRect());
    return taps.map((t, i) => Math.abs(t.left + t.width / 2 - ((cells[i] as DOMRect).left + (cells[i] as DOMRect).width / 2)) < 3 && Math.abs(t.top + t.height / 2 - ((cells[i] as DOMRect).top + (cells[i] as DOMRect).height / 2)) < 3);
  });
  expect(overlap).toEqual([true, true, true, true, true, true, true]);
  // The clip is held, and a stray click on the stage does not start it.
  const held = (await clipState(page, 'c3')).t;
  await c3.locator('.st-stage').click({ position: { x: 20, y: 300 } });
  expect((await clipState(page, 'c3')).playing).toBe(false);

  // A wrong tap: that cell is marked, the reason is given, and every other cell can still be tried.
  await tapButton(page, 'c3', 'c4').click();
  await expect(tapButton(page, 'c3', 'c4')).toHaveAttribute('data-state', 'wrong');
  await expect(tapButton(page, 'c3', 'c4')).toHaveAttribute('aria-disabled', 'true');
  await expect(tapButton(page, 'c3', 'c4')).toHaveAccessibleName('42, cell 5 of 7, not this one');
  await expect(li.locator('[data-outcome]')).toHaveAttribute('role', 'status');
  await expect(li.locator('[data-outcome]')).toContainText('Not quite.');
  await expect(li.locator('[data-outcome]')).toContainText(pickGate.wrong);
  await expect(li.locator('[data-outcome]')).not.toContainText(pickGate.right);
  expect((await clipState(page, 'c3')).t).toBe(held);
  await expect(c3).toHaveAttribute('data-asking', 'true');
  await expect(buttons.and(page.locator('[aria-disabled="true"]'))).toHaveCount(1);
  // Tapping the marked cell again changes nothing.
  await tapButton(page, 'c3', 'c4').click({ force: true });
  await expect(li.locator('[data-outcome]')).toContainText(pickGate.wrong);

  // The right tap: marked, explained, and the clip waits for "Watch what happens".
  await tapButton(page, 'c3', 'c5').click();
  await expect(tapButton(page, 'c3', 'c5')).toHaveAttribute('data-state', 'right');
  await expect(tapButton(page, 'c3', 'c5')).toHaveAccessibleName('57, cell 6 of 7, the answer');
  await expect(li.locator('[data-outcome]')).toContainText('Correct.');
  await expect(li.locator('[data-outcome]')).toContainText(pickGate.right);
  await expect(li.getByRole('button', { name: 'Skip the question' })).toBeHidden();
  await expect(li.getByText('Tap your answer on the picture.')).toBeHidden();
  await expect(buttons.and(page.locator('[aria-disabled="true"]'))).toHaveCount(7);
  await expect(tapButton(page, 'c3', 'c4')).toHaveAttribute('data-state', 'wrong');
  await li.getByRole('button', { name: 'Watch what happens' }).click();
  await expect(c3).toHaveAttribute('data-state', 'playing');
  // The outcome plays, and the buttons are gone from the stage.
  await expect(c3.locator('.st-tap')).toHaveCount(0);
  await expect(c3.locator('.st-taps')).toBeHidden();
  const done = await settled(page, 'c3');
  expect(done.state).toBe('ended');
  await expectClean(watch, browserName);
});

test('a tap gate from the keyboard: focus goes to the first part, Tab walks them in order, Enter answers', async ({ page, browserName }, testInfo) => {
  await open(page, testInfo, 'c3', examplePublishedV2());
  await toGate(page, 'c3', PICK, true);
  // Play was pressed from the keyboard, so the question takes focus to the first cell.
  await expectFocus(page, (f) => f.cls.includes('st-tap') && f.text.startsWith('3, cell 1 of 7'), 'focus on the first cell');
  const walked: string[] = [];
  for (let i = 0; i < 6; i++) {
    await tab(page, browserName);
    walked.push(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.part ?? ''));
  }
  expect(walked).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  // Back one, to the cell that holds 57, and answer with the keyboard.
  await tab(page, browserName, true);
  await expectFocus(page, (f) => f.text.startsWith('57, cell 6 of 7'), 'focus on 57');
  await page.keyboard.press('Enter');
  const li = clip(page, 'c3').locator(`li[data-beat="${PICK + 1}"]`);
  await expect(li.locator('[data-outcome]')).toContainText('Your prediction was right.');
  await expect(li.locator('[data-outcome]')).toContainText(pickGate.right);
  // Focus moves on to the button that plays the outcome.
  await expectFocus(page, (f) => f.text === 'Watch what happens', 'focus on Watch what happens');
  await page.keyboard.press('Enter');
  await expect(clip(page, 'c3')).toHaveAttribute('data-state', 'playing');
  await expectFocus(page, (f) => f.cls.includes('st-play'), 'focus back on the play control');
});

test('a tap gate can be skipped: the right part is marked, and the outcome plays when asked', async ({ page, browserName }, testInfo) => {
  const watch = await open(page, testInfo, 'c3', examplePublishedV2());
  await toGate(page, 'c3', PICK);
  const li = clip(page, 'c3').locator(`li[data-beat="${PICK + 1}"]`);
  await li.getByRole('button', { name: 'Skip the question' }).focus();
  await page.keyboard.press('Enter');
  await expect(tapButton(page, 'c3', 'c5')).toHaveAttribute('data-state', 'right');
  await expect(clip(page, 'c3').locator('.st-tap[data-state]')).toHaveCount(1);
  await expect(li.locator('[data-outcome]')).toContainText('Question skipped. The answer is marked on the picture.');
  await expect(li.locator('[data-outcome]')).toContainText(pickGate.right);
  await expect(li.getByRole('button', { name: 'Watch what happens' })).toBeFocused();
  // The scrubber now shows the prediction as passed, and the clip can go on.
  expect((await clipState(page, 'c3')).limit).toBeGreaterThan((await clipState(page, 'c3')).t);
  await li.getByRole('button', { name: 'Watch what happens' }).click();
  expect((await settled(page, 'c3')).state).toBe('ended');
  await expectClean(watch, browserName);
});

test('tap gates on a crowd and on a curve chart: the groups, and the curves by name, are the buttons', async ({ page, browserName }, testInfo) => {
  const watch = await open(page, testInfo, 'x-dots');
  const dotsGate = DOTS.beats.findIndex((b) => b.gate);
  await toGate(page, 'x-dots', dotsGate);
  const names = (id: string): Promise<string[]> => clip(page, id).locator('.st-tap').evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()));
  expect(await names('x-dots')).toEqual(['True positives: 9', 'Missed: 1', 'Do not have it: 990']);
  // Every button is inside the stage.
  const inside = (id: string): Promise<boolean> =>
    clip(page, id).evaluate((root) => {
      const stage = (root.querySelector('.st-stage') as HTMLElement).getBoundingClientRect();
      return Array.from(root.querySelectorAll<HTMLElement>('.st-tap')).every((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= stage.left && r.right <= stage.right && r.top >= stage.top && r.bottom <= stage.bottom && r.width >= 24 && r.height >= 24;
      });
    });
  expect(await inside('x-dots')).toBe(true);
  await tapButton(page, 'x-dots', 'tp').click();
  await expect(tapButton(page, 'x-dots', 'tp')).toHaveAttribute('data-state', 'wrong');
  await tapButton(page, 'x-dots', 'well').click();
  await expect(tapButton(page, 'x-dots', 'well')).toHaveAttribute('data-state', 'right');
  await clip(page, 'x-dots').getByRole('button', { name: 'Watch what happens' }).click();
  await expect(clip(page, 'x-dots')).toHaveAttribute('data-exploring', 'true', { timeout: 30_000 });

  // The curve chart, in the same lesson.
  await page.evaluate(() => {
    location.hash = '#/x-curve';
  });
  await settled(page, 'x-curve');
  await toGate(page, 'x-curve', CURVE.beats.findIndex((b) => b.gate));
  expect((await names('x-curve')).sort()).toEqual(['Demand', 'Market price: 60, 5.00', 'Supply']);
  expect(await inside('x-curve')).toBe(true);
  await tapButton(page, 'x-curve', 'demand').click();
  await expect(tapButton(page, 'x-curve', 'demand')).toHaveAttribute('data-state', 'right');
  await expectClean(watch, browserName);
});

test('a tap gate whose answer is not on the stage does not trap the learner: the clip passes it by', async ({ page }, testInfo) => {
  // The gate names a pointer, which is never offered.
  const broken = { ...TRACE, beats: TRACE.beats.map((b, i) => (i === PICK ? { ...b, gate: { ...pickGate, pick: ['mid'] } } : b)) };
  const lesson = lessonOf([broken]);
  await open(page, testInfo, 'c3', asPublished(lesson));
  await passGates(page, 'c3', PICK);
  const s = await clipState(page, 'c3');
  await at(page, 'c3', (s.beats[PICK]?.t0 ?? 0) - 300);
  await control(page, 'c3', 'st-play').click();
  await expect.poll(async () => (await clipState(page, 'c3')).t, { timeout: 20_000 }).toBeGreaterThan((s.beats[PICK]?.t0 ?? 0) + 200);
  await expect(clip(page, 'c3').locator('.st-tap')).toHaveCount(0);
});

// ------------------------------------------------------------------------------------------------ the guarantees

test.describe('scripting off', () => {
  test.use({ javaScriptEnabled: false });

  test('explore is its prompt, each slider\'s start and range, the goal, and what reaching it shows in a disclosure', async ({ page }, testInfo) => {
    const watch = await openLesson(page, testInfo, { published: XP });
    for (const scene of [DOTS, CURVE, BARS]) {
      const x = scene.explore as NonNullable<ClipScene['explore']>;
      const box = clip(page, scene.id).locator('.lt-explore');
      await expect(box).toBeVisible();
      await expect(box).toContainText('Your turn');
      await expect(box).toContainText(x.prompt);
      await expect(box.locator('.lt-xp-control')).toHaveCount(x.controls.length);
      for (const [i, c] of x.controls.entries()) {
        const row = box.locator('.lt-xp-control').nth(i);
        await expect(row.locator('.lt-xp-label')).toHaveText(c.label);
        await expect(row.locator('.lt-xp-now')).toContainText(`starts at ${c.value}`);
        await expect(row.locator('.lt-xp-bounds')).toContainText(`from ${c.min}`);
        await expect(row.locator('.lt-xp-bounds')).toContainText(`to ${c.max}`);
      }
      // Nothing is offered that cannot work.
      await expect(box.locator('input:visible')).toHaveCount(0);
      await expect(box.getByRole('button')).toHaveCount(0);
      await expect(box).toContainText(x.goal?.text as string);
      const done = box.locator('details');
      await expect(done.getByText(x.goal?.done as string)).toBeHidden();
      await done.locator('summary').click();
      await expect(done.getByText(x.goal?.done as string)).toBeVisible();
    }
    expect(new Set(watch.requests.map((r) => r.split('#')[0]))).toEqual(new Set([watch.url]));
    await expectNoSidewaysScroll(page, 'explore with scripting off');
  });

  test('a tap gate is its question, with the right part named and explained in a disclosure', async ({ page }, testInfo) => {
    await openLesson(page, testInfo, { published: examplePublishedV2() });
    const box = clip(page, 'c3').locator('.lt-pick');
    await expect(box).toBeVisible();
    await expect(box).toContainText(pickGate.prompt);
    await expect(box.getByText('Tap your answer on the picture.')).toBeHidden();
    await expect(box.getByRole('button')).toHaveCount(0);
    await expect(box.getByText(pickGate.right)).toBeHidden();
    await box.locator('summary').click();
    await expect(box.locator('details')).toContainText('Correct answer: 57');
    await expect(box.getByText(pickGate.right)).toBeVisible();
    await expect(box.getByText(pickGate.wrong)).toBeVisible();
  });
});

test('print: the stage at its starting state, and the panel as text, whatever the sliders say', async ({ page, browserName }, testInfo) => {
  const watch = await open(page, testInfo, 'x-bars');
  await toExplore(page, 'x-bars');
  await slide(page, 'x-bars', 60);
  await expect.poll(() => shownText(page, 'x-bars', 'st-barval')).toEqual(['60', '6']);
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const bars = clip(page, 'x-bars');
  // One still per beat, each drawn from the clip as written: 20 against 5, not what the slider says.
  await expect(bars.locator('.st-still')).toHaveCount(BARS.beats.length);
  const last = await bars.locator('.st-still').last().evaluate((el) => Array.from(el.querySelectorAll('.st-barval')).map((v) => v.textContent));
  expect(last).toEqual(['20', '5']);
  // The panel prints as what it was: the prompt, where the slider starts and how far it goes, and the goal.
  const p = panel(page, 'x-bars');
  await expect(p).toBeVisible();
  await expect(p.locator('.lt-xp-now')).toHaveText('starts at 20');
  await expect(p.locator('.lt-xp-bounds')).toHaveText('from 2 to 64');
  await expect(p.locator('.st-xp-slide')).toBeHidden();
  await expect(p.locator('.st-xp-out')).toBeHidden();
  await expect(p.getByRole('button', { name: 'Replay the clip' })).toBeHidden();
  await expect(p.locator('.lt-xp-goal-words')).toBeVisible();
  await expect(bars.locator('.st-stage')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await expect(bars.locator('.st-still')).toHaveCount(0);
  await expectClean(watch, browserName);
});

for (const width of [1280, 320]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: width === 320 ? 720 : 800 } });

    for (const scheme of ['light', 'dark'] as const) {
      test(`explore and a tap gate pass axe, ${scheme}`, async ({ page, browserName }, testInfo) => {
        await page.emulateMedia({ colorScheme: scheme });
        const watch = await open(page, testInfo, 'x-dots');
        const gate = DOTS.beats.findIndex((b) => b.gate);
        await toGate(page, 'x-dots', gate);
        await auditStage(page, `x-dots tap gate open, ${width} ${scheme}`);
        await tapButton(page, 'x-dots', 'tp').click();
        await auditStage(page, `x-dots after a wrong tap, ${width} ${scheme}`);
        await tapButton(page, 'x-dots', 'well').click();
        await auditStage(page, `x-dots after the right tap, ${width} ${scheme}`);
        await toExplore(page, 'x-dots');
        await page.waitForTimeout(1300);
        await auditStage(page, `x-dots handed over, ${width} ${scheme}`);
        await slide(page, 'x-dots', 10);
        await expect(panel(page, 'x-dots').locator('[data-goal]')).toHaveAttribute('data-reached', 'true');
        await page.waitForTimeout(1500);
        await auditStage(page, `x-dots goal reached, ${width} ${scheme}`);
        await expectNoSidewaysScroll(page, `x-dots at ${width}`);
        await expectClean(watch, browserName);
      });
    }

    test('nothing scrolls sideways, and the picture and its slider share the window', async ({ page }, testInfo) => {
      await open(page, testInfo, 'x-dots');
      for (const id of ['x-dots', 'x-curve', 'x-bars']) {
        if (id !== 'x-dots') {
          await page.evaluate((sceneId) => {
            location.hash = `#/${sceneId}`;
          }, id);
          await settled(page, id);
        }
        await toExplore(page, id);
        await expectNoSidewaysScroll(page, `${id} handed over at ${width}`);
        // After the hand-over has scrolled the band into place, the stage's picture and the slider are both on screen.
        await expect
          .poll(
            () =>
              clip(page, id).evaluate((root) => {
                const view = (root.querySelector('.st-view') as HTMLElement).getBoundingClientRect();
                const input = (root.querySelector('.st-explore input[type="range"]') as HTMLElement).getBoundingClientRect();
                return view.top >= -50 && input.bottom <= window.innerHeight && input.width >= 200;
              }),
            { message: `${id}: stage and slider on screen together`, timeout: 5000 },
          )
          .toBe(true);
        // Every slider to its far end: the fullest the stage gets.
        for (const input of await panel(page, id).locator('input[type="range"]').all()) {
          await input.evaluate((el) => {
            (el as HTMLInputElement).value = (el as HTMLInputElement).max;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
        }
        await page.waitForTimeout(900);
        await expectNoSidewaysScroll(page, `${id} at its maximum at ${width}`);
        // Nothing on the stage has been pushed off it.
        const off = await clip(page, id).evaluate((root) => {
          const stage = (root.querySelector('.st-view') as HTMLElement).getBoundingClientRect();
          return Array.from(root.querySelectorAll<HTMLElement>('.st-view .st-stat, .st-view .st-glabel, .st-view .st-barval, .st-view .st-pt-pill, .st-view .st-tipval'))
            .filter((el) => el.style.opacity !== '0')
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.left < stage.left - 1 || r.right > stage.right + 1 || r.top < stage.top - 1 || r.bottom > stage.bottom + 1).length;
        });
        expect(off, `${id}: parts off the stage`).toBe(0);
      }
    });
  });
}

test('with reduced motion the hand-over, the slider and the goal still work, and nothing travels', async ({ page, browserName }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const watch = await open(page, testInfo, 'x-dots');
  await toExplore(page, 'x-dots');
  await expect(panel(page, 'x-dots')).toBeVisible();
  // One frame after the slider moves, every group is at its number and the dots are in place.
  const labels = await slider(page, 'x-dots').evaluate(
    (el) =>
      new Promise<string[]>((resolve) => {
        (el as HTMLInputElement).value = '10';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(Array.from((el.closest('.lt-clip') as HTMLElement).querySelectorAll<HTMLElement>('.st-view .st-glabel')).filter((g) => g.style.opacity !== '0').map((g) => (g.textContent ?? '').replace(/\s+/g, ' ')))));
      }),
  );
  expect(labels).toEqual(['True positives 90', 'False alarms 81', 'Negative results 829']);
  const rest = await picture(page, 'x-dots');
  await page.waitForTimeout(400);
  expect(await picture(page, 'x-dots')).toBe(rest);
  await expect(panel(page, 'x-dots').locator('[data-goal]')).toHaveAttribute('data-reached', 'true');
  // No animation of the panel or the stage is running.
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  await expectClean(watch, browserName);
});
