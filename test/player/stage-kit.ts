// Shared by the stage specs: opening a lesson made of clips, reading a clip's state, and driving
// it where the way of getting there is not what a test is about.
//
// A clip keeps one number, t (ms). Specs operate the real controls for what they test and use
// `at()` only to arrive somewhere quickly. `clipState` reads the engine's own account of itself
// through the handle the player leaves on the clip's element for tests and measurements.
import type { Page, TestInfo } from '@playwright/test';
import type { ClipScene } from '../../src/core/clip';
import type { Published } from '../../src/core/types';
import { exampleLessonV2, examplePublishedV2 } from '../helpers/clip-example';
import { type Watch, expect, openLesson } from './shell-kit';

export const LESSON = exampleLessonV2();
export const CLIPS = LESSON.scenes.filter((s): s is ClipScene => s.kind === 'clip');
export const clipOf = (id: string): ClipScene => CLIPS.find((c) => c.id === id) as ClipScene;

export interface ClipState {
  t: number;
  k: number;
  playing: boolean;
  opening: boolean;
  duration: number;
  poster: number;
  limit: number;
  rate: number;
  stepMode: boolean;
  reduced: boolean;
  W: number;
  beats: { i: number; t0: number; t1: number; motionEnd: number; gate: boolean }[];
  state: string;
  asking: boolean;
}

export const clip = (page: Page, id: string) => page.locator(`.lt-clip[data-clip="${id}"]`);
export const control = (page: Page, id: string, cls: string) => clip(page, id).locator(`.st-controls .${cls}`);

export function clipState(page: Page, id: string): Promise<ClipState> {
  return page.evaluate((sceneId) => {
    const root = Array.from(document.querySelectorAll<HTMLElement>('.lt-clip')).find((el) => el.dataset.clip === sceneId) as HTMLElement & { ltClip: Record<string, never> };
    const c = root.ltClip as unknown as {
      t: number; k: number; playing: boolean; opening: boolean; duration: number; poster: number; rate: number; stepMode: boolean; reduced: boolean; W: number;
      beats: ClipState['beats']; limit(): number;
    };
    return {
      t: c.t, k: c.k, playing: c.playing, opening: c.opening, duration: c.duration, poster: c.poster, limit: c.limit(), rate: c.rate, stepMode: c.stepMode, reduced: c.reduced, W: c.W,
      beats: c.beats.map((b) => ({ i: b.i, t0: b.t0, t1: b.t1, motionEnd: b.motionEnd, gate: b.gate })),
      state: root.dataset.state ?? '', asking: root.dataset.asking === 'true',
    };
  }, id);
}

/** Open the v2 example at a clip and wait until its establishing move has ended and it rests on its poster. */
export async function openClip(page: Page, testInfo: TestInfo, id: string, opts: { published?: Published; via?: 'file' | 'http' } = {}): Promise<Watch> {
  const watch = await openLesson(page, testInfo, { published: opts.published ?? examplePublishedV2(), hash: `#/${id}`, ...(opts.via ? { via: opts.via } : {}) });
  await settled(page, id);
  return watch;
}

/** Wait until the clip is not moving. */
export async function settled(page: Page, id: string): Promise<ClipState> {
  await expect.poll(async () => (await clipState(page, id)).playing, { message: `${id} comes to rest`, timeout: 30_000 }).toBe(false);
  return clipState(page, id);
}

/** Go straight to an instant, as a drag of the scrubber would (the clip clamps it at an open prediction). */
export async function at(page: Page, id: string, t: number): Promise<ClipState> {
  await page.evaluate(([sceneId, time]) => {
    const root = Array.from(document.querySelectorAll<HTMLElement>('.lt-clip')).find((el) => el.dataset.clip === sceneId) as HTMLElement;
    const range = root.querySelector<HTMLInputElement>('.st-range') as HTMLInputElement;
    range.value = String(time);
    range.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, t] as const);
  return clipState(page, id);
}

/** What is on the stage now, as markup and, for a canvas, as pixels. Two equal strings are two equal pictures. */
export function picture(page: Page, id: string): Promise<string> {
  return page.evaluate((sceneId) => {
    const root = Array.from(document.querySelectorAll<HTMLElement>('.lt-clip')).find((el) => el.dataset.clip === sceneId) as HTMLElement;
    const view = root.querySelector('.st-view') as HTMLElement;
    const visible = (el: Element): string => {
      const style = (el as HTMLElement).style;
      if (style && style.opacity === '0') return `<${el.tagName} hidden>`;
      const attrs = Array.from(el.attributes).filter((a) => a.name !== 'style').map((a) => `${a.name}="${a.value}"`).sort().join(' ');
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
      const pixels = el instanceof HTMLCanvasElement ? el.toDataURL() : '';
      return `<${el.tagName} ${attrs} style="${style ? style.cssText : ''}">${own}${pixels}${Array.from(el.children).map(visible).join('')}</${el.tagName}>`;
    };
    return visible(view);
  }, id);
}

/** The caption on show, as text, or '' when none is. */
export function captionShown(page: Page, id: string): Promise<string> {
  return page.evaluate((sceneId) => {
    const root = Array.from(document.querySelectorAll<HTMLElement>('.lt-clip')).find((el) => el.dataset.clip === sceneId) as HTMLElement;
    const on = Array.from(root.querySelectorAll<HTMLElement>('li.lt-beat')).filter((li) => li.dataset.on === '1' && getComputedStyle(li).visibility !== 'hidden');
    const top = on.sort((a, b) => Number((b.querySelector('.lt-cap') as HTMLElement).style.opacity || 0) - Number((a.querySelector('.lt-cap') as HTMLElement).style.opacity || 0))[0];
    // The caption's own words: not the label of an example or an analogy, not an attribution, not the chips.
    const words = top?.querySelector('.lt-cap p:not(.lt-label):not(.lt-limits):not(.lt-based):not(.lt-quote-from)');
    return words ? (words.textContent ?? '').replace(/\u00a0.*$/, '').trim() : '';
  }, id);
}

/** The page is as wide as the window: nothing scrolls it sideways. */
export async function expectNoSidewaysScroll(page: Page, what: string): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `${what}: page width`).toBeLessThanOrEqual(client);
}

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * axe-core over the page as it is now, as test/player/questions-kit.ts `audit` does it, with one
 * difference. The picture on the stage (`.st-view`, hidden from assistive technology, drawn over a
 * lit field) is text over a gradient, which axe cannot measure: there it reports "could not
 * decide". Those are left out here, and only those: the contrast of everything drawn on the stage
 * is held on the numbers by test/clip/stage-tokens.test.ts. A contrast axe DID decide and failed
 * is a violation anywhere, the stage included, and an undecided contrast anywhere else still fails.
 */
export async function auditStage(page: Page, state: string): Promise<void> {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const violations = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(violations, `${state}: violations`).toEqual([]);
  const undecided: string[] = [];
  for (const node of results.incomplete.filter((r) => r.id === 'color-contrast').flatMap((r) => r.nodes)) {
    const selector = node.target.join(' ');
    const inPicture = await page
      .locator(selector)
      .first()
      .evaluate((el) => el.closest('.st-view') !== null)
      .catch(() => false);
    if (!inPicture) undecided.push(`${selector}: ${node.any.map((check) => check.message).join('; ')}`);
  }
  expect(undecided, `${state}: contrast axe could not decide, outside the stage picture`).toEqual([]);
  expect(results.passes.length, `${state}: rules that ran`).toBeGreaterThan(15);
}
