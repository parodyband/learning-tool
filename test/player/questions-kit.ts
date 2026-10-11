// Shared by the question and step specs: lessons to open, and ways of driving a page with the
// keyboard alone and of reading back what it recorded, announced and focused.
import type { Page, TestInfo } from '@playwright/test';
import { EXAMPLE_QUESTIONS } from '../../src/core/examples';
import { Question } from '../../src/core/schema';
import type { Published, Receipt } from '../../src/core/types';
import { examplePublished, exampleReceipt } from '../helpers/example';
import { type OpenOptions, type Watch, expect, openLesson, sectionId, tab } from './shell-kit';

/** The example lesson, changed by `change`, with any receipt fields given. */
export function lessonWith(change: (p: Published) => void = () => {}, receipt: Partial<Receipt> = {}): Published {
  const p = examplePublished({ receipt: exampleReceipt(receipt) });
  change(p);
  return p;
}

/** Replace the question of a checkpoint scene. The object is parsed, so defaults are applied as they would be on publish. */
export function setQuestion(p: Published, sceneId: string, question: unknown): void {
  const scene = p.lesson.scenes.find((s) => s.id === sceneId);
  if (scene?.kind !== 'checkpoint') throw new Error(`${sceneId} is not a checkpoint`);
  scene.question = Question.parse(question);
}

/** The example lesson with the reflect question in place of the question of one checkpoint. */
export function withReflect(sceneId: string): Published {
  return lessonWith((p) => setQuestion(p, sceneId, EXAMPLE_QUESTIONS.reflect));
}

export const scene = (sceneId: string): string => `#${sectionId(sceneId)}`;

/**
 * Open a lesson with nothing remembered. Every file:// page shares one localStorage, so a second
 * lesson opened in the same test would otherwise start where the first one stopped.
 */
export async function openFresh(page: Page, testInfo: TestInfo, opts: OpenOptions = {}): Promise<Watch> {
  const watch = await openLesson(page, testInfo, opts);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  return watch;
}

export interface Active {
  tag: string;
  type: string;
  /** data-act, data-move or data-step-go of a button. */
  does: string;
  /** data-option of the row a radio sits in. */
  option: string;
  /** data-item of the row a move button sits in. */
  item: string;
  value: string;
  text: string;
  disabled: boolean;
  scene: string;
}

/** What has focus, in the terms these specs care about. */
export function active(page: Page): Promise<Active> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const input = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
    return {
      tag: el?.tagName ?? '',
      type: el instanceof HTMLInputElement ? el.type : '',
      does: el?.dataset.act ?? el?.dataset.move ?? el?.dataset.stepGo ?? '',
      option: el?.closest<HTMLElement>('[data-option]')?.dataset.option ?? '',
      item: el?.closest<HTMLElement>('[data-item]')?.dataset.item ?? '',
      value: input?.value ?? '',
      text: (el?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
      disabled: el?.getAttribute('aria-disabled') === 'true',
      scene: el?.closest<HTMLElement>('section.lt-scene')?.dataset.scene ?? '',
    };
  });
}

/** Press Tab (or Shift+Tab) until `done` accepts what has focus. */
export async function tabUntil(page: Page, browserName: string, done: (a: Active) => boolean, opts: { back?: boolean; limit?: number } = {}): Promise<Active> {
  const limit = opts.limit ?? 45;
  for (let i = 0; i < limit; i++) {
    await tab(page, browserName, opts.back === true);
    const now = await active(page);
    if (done(now)) return now;
  }
  throw new Error(`focus did not reach the wanted element in ${limit} presses; it is on ${JSON.stringify(await active(page))}`);
}

/**
 * With focus on a radio of a group, choose one option using the keyboard only: Space on the radio
 * that has focus, the arrow keys towards another. (WebKit does not wrap from the last radio to the
 * first, so the arrow pressed is the one that points at the wanted option.)
 */
export async function choose(page: Page, sceneId: string, option: number): Promise<void> {
  const wanted = page.locator(`${scene(sceneId)} label.lt-option[data-option="${option}"] input`);
  for (let i = 0; i < 8; i++) {
    if (await wanted.isChecked()) return;
    const now = await active(page);
    expect(now.type, 'focus is on a radio').toBe('radio');
    const order = await shownOrder(page, sceneId, 'option');
    const from = order.indexOf(Number(now.option));
    const to = order.indexOf(option);
    await page.keyboard.press(from === to ? 'Space' : to < from ? 'ArrowUp' : 'ArrowDown');
  }
  throw new Error(`could not choose option ${option} with the keyboard`);
}

/** The first-attempt results the shell has stored, as [sceneId, result]. Each is kept with the digest of its scene, which must be the one in the page. */
export function stored(page: Page, lessonId: string): Promise<[string, string][]> {
  return page.evaluate((key) => {
    const entries = JSON.parse(localStorage.getItem(key) ?? '[]') as [string, string, string][];
    return entries.map(([sceneId, result, rev]): [string, string] => {
      const now = document.querySelector<HTMLElement>(`section[data-scene="${sceneId}"]`)?.dataset.rev;
      if (rev !== now) throw new Error(`the result for ${sceneId} was stored with digest ${rev}, and the scene has ${now}`);
      return [sceneId, result];
    });
  }, `lt:${lessonId}:results`);
}

declare global {
  interface Window {
    __ltSeen?: { type: string; detail: unknown }[];
  }
}

/** Start recording the shell's result and step events. */
export async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__ltSeen = [];
    for (const type of ['lt:result', 'lt:stepchange']) document.addEventListener(type, (e) => window.__ltSeen?.push({ type, detail: (e as CustomEvent).detail }));
  });
}

export function seen(page: Page, type: string): Promise<unknown[]> {
  return page.evaluate((t) => (window.__ltSeen ?? []).filter((e) => e.type === t).map((e) => e.detail), type);
}

/** Every role="status" element inside a scene. There must be exactly one. */
export const statusOf = (page: Page, sceneId: string) => page.locator(`${scene(sceneId)} [role="status"]`);

/** The order options or items are shown in, as their indexes in the lesson. */
export function shownOrder(page: Page, sceneId: string, what: 'option' | 'item'): Promise<number[]> {
  return page.locator(`${scene(sceneId)} [data-${what}]`).evaluateAll((els, key) => els.map((el) => Number((el as HTMLElement).dataset[key])), what);
}

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * axe-core over the page as it is now. A contrast axe could not decide counts as a failure, as in
 * the shell's own audit. `only` limits the audit to one part of the page.
 */
export async function audit(page: Page, state: string, only?: string): Promise<void> {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  // A scene fades in; measured halfway through, its text has less contrast than it will have.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (only) builder = builder.include(only);
  const results = await builder.analyze();
  const violations = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(violations, `${state}: violations`).toEqual([]);
  const undecided = results.incomplete
    .filter((r) => r.id === 'color-contrast')
    .flatMap((r) => r.nodes)
    .map((n) => `${n.target.join(' ')}: ${n.any.map((check) => check.message).join('; ')}`);
  expect(undecided, `${state}: contrast axe could not decide`).toEqual([]);
  expect(results.passes.length, `${state}: rules that ran`).toBeGreaterThan(15);
}

/** WCAG 1.4.12 text spacing, applied through a constructed sheet because the page's policy refuses an injected style element. */
export async function spaceText(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
}

/** How wide the page has become. At most the window's width when nothing scrolls sideways. */
export const pageWidth = (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth);

/**
 * Every control on show that is smaller than 24 by 24 CSS pixels (WCAG 2.5.8), measured the way the
 * shell's own layout spec measures: the control itself, whatever its row or its label adds.
 */
export function smallControls(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, summary, textarea'))
      .filter((el) => el.offsetParent !== null && !el.closest('[popover]:not(:popover-open)') && !el.classList.contains('lt-skip'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => (r.width < 24 || r.height < 24) && !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
      .map(({ el, r }) => `${el.tagName}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`),
  );
}
