// Shared by the figure specs: the fixtures (from test/render/figures-fixtures.ts) and the few things
// a spec needs to do inside a page.
import type { Page } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

export * from '../render/figures-fixtures';

let bundle: Promise<string> | null = null;

/**
 * The figures module as a script a spec can run inside a page, to call `setHighlight` the way the
 * step-through does. The player's own copy is sealed inside its bundle, so this is a second copy;
 * that is enough because highlighting is written to the page (`data-hl`) and the player's drawings
 * watch the page. The module's one import from player/main is pointed at render/escape, which has
 * the same `domId` and does not start a second player.
 */
function figuresBundle(): Promise<string> {
  const root = path.resolve(import.meta.dirname, '../..');
  bundle ??= build({
    entryPoints: [path.join(root, 'src/player/figures.ts')],
    bundle: true,
    format: 'iife',
    globalName: '__ltFigures',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
    plugins: [{ name: 'main-is-escape', setup: (b) => void b.onResolve({ filter: /^\.\.?\/main$/ }, () => ({ path: path.join(root, 'src/render/escape.ts') })) }],
  }).then((result) => `${(result.outputFiles[0] as { text: string }).text};window.__ltFigures = __ltFigures;`);
  return bundle;
}

declare global {
  interface Window {
    __ltFigures?: { setHighlight(figure: Element, parts: readonly string[]): void; enhanceFigures(root: ParentNode): void };
  }
}

/** Highlight parts of the figure in a scene, exactly as a step would. */
export async function highlight(page: Page, sceneId: string, parts: readonly string[]): Promise<void> {
  if (!(await page.evaluate(() => typeof window.__ltFigures === 'object'))) await page.evaluate(await figuresBundle());
  await page.evaluate(
    ({ id, ids }) => {
      const figure = Array.from(document.querySelectorAll<HTMLElement>('.lt-figure')).find((f) => f.dataset.scene === id);
      if (!figure) throw new Error(`no figure in scene ${id}`);
      window.__ltFigures?.setHighlight(figure, ids);
    },
    { id: sceneId, ids: [...parts] },
  );
  // A mark fades in. Let it finish, so that what a spec reads next is the mark and not the way there.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

/** The parts of an axe result this file reads. */
export interface ContrastResults {
  incomplete: { id: string; nodes: { html: string; target: unknown[]; any: { message: string; data?: unknown }[] }[] }[];
}

/**
 * The contrast of text against what is painted behind it, worked out the way WCAG defines it: the
 * element's colour over the backgrounds of its ancestors, laid one on another from the page up.
 * Colours are read by painting them on a canvas, so any way of writing a colour is understood.
 * Null for a selector that finds nothing.
 */
export function contrastOf(page: Page, selectors: readonly string[]): Promise<({ ratio: number; ink: string; inherited: boolean; cut: boolean } | null)[]> {
  return page.evaluate((list) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const rgba = (color: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0] as number, d[1] as number, d[2] as number, (d[3] as number) / 255];
    };
    const over = (top: [number, number, number, number], under: number[]): number[] => [0, 1, 2].map((i) => (under[i] as number) * (1 - top[3]) + top[i as 0 | 1 | 2] * top[3]);
    const luminance = (c: number[]): number => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    return list.map((selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const chain: Element[] = [];
      for (let up: Element | null = el; up; up = up.parentElement) chain.unshift(up);
      let ground = [255, 255, 255];
      for (const node of chain) ground = over(rgba(getComputedStyle(node).backgroundColor), ground);
      const color = getComputedStyle(el).color;
      const ink = over(rgba(color), ground);
      const [a, b] = [luminance(ink), luminance(ground)];
      // Whether the element runs past the edge of a box it can be scrolled into view in.
      const box = el.getBoundingClientRect();
      let cut = false;
      for (let up = el.parentElement; up && !cut; up = up.parentElement) {
        if (!/auto|scroll/.test(getComputedStyle(up).overflowX) || up.scrollWidth <= up.clientWidth + 1) continue;
        const frame = up.getBoundingClientRect();
        cut = box.right > frame.right - 0.5 || box.left < frame.left + 0.5;
      }
      return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), ink: color, inherited: !!el.parentElement && getComputedStyle(el.parentElement).color === color, cut };
    });
  }, [...selectors]);
}

/**
 * The contrast results axe could not decide, less the two kinds that are decided here instead, by
 * measuring. Anything else axe could not decide is returned as a failure, and so is either of
 * these two when the measurement falls short of the standard for body text (4.5 to 1).
 *
 * A math operator. axe will not judge an element whose whole text is a symbol or a punctuation
 * mark, and core/math writes each operator of a formula as an element of its own: `<mo>−</mo>`,
 * `<mo>=</mo>`. Every minus sign in a lesson is therefore "undecided". There is no contrast problem
 * behind that answer: an operator is set in the ink of the digits beside it, on the same ground.
 * It is let through only if it is in the ink it inherits and that ink has the contrast.
 *
 * Text past the edge of a box that scrolls sideways. axe asks the browser what lies at the middle
 * of the text, is given whatever is beside the box, and reports the text as obscured. It is not: it
 * is where the reader scrolls to.
 */
export async function undecidedContrast(page: Page, results: ContrastResults): Promise<string[]> {
  type Node = ContrastResults['incomplete'][number]['nodes'][number];
  const nodes = results.incomplete.filter((r) => r.id === 'color-contrast').flatMap((r) => r.nodes);
  const describe = (n: Node): string => `${n.target.join(' ')}: ${n.any.map((check) => check.message).join('; ')}`;
  const all = (n: Node, key: string): boolean => n.any.length > 0 && n.any.every((check) => (check.data as { messageKey?: string } | undefined)?.messageKey === key);
  const findable = (n: Node): boolean => n.target.length === 1 && typeof n.target[0] === 'string';
  const isOperator = (n: Node): boolean => /^<mo[\s>]/.test(n.html) && findable(n) && all(n, 'nonBmp');
  const maybeCut = (n: Node): boolean => findable(n) && all(n, 'elmPartiallyObscured');
  const measurable = nodes.filter((n) => isOperator(n) || maybeCut(n));
  const measured = await contrastOf(page, measurable.map((n) => n.target[0] as string));
  const out = nodes.filter((n) => !measurable.includes(n)).map(describe);
  measurable.forEach((n, i) => {
    const m = measured[i];
    if (!m) return void out.push(`${n.target.join(' ')}: could not be found again to be measured`);
    // Obscured, and not by the edge of a scrolling box: that is a real question, and it stays one.
    if (!isOperator(n) && !m.cut) return void out.push(describe(n));
    if (isOperator(n) && !m.inherited) return void out.push(`${n.target.join(' ')}: a math operator in ${m.ink}, not the ink of its formula`);
    if (m.ratio < 4.5) out.push(`${n.target.join(' ')}: ${isOperator(n) ? 'a math operator' : 'text past the edge of its scrolling box'} in ${m.ink} with a contrast of ${m.ratio.toFixed(2)} to 1`);
  });
  return out;
}
