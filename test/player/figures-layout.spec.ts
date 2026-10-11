// Figures as drawn in a real page, measured: no node on another, every connector ending on the
// nodes it joins and passing through none, labels clear of nodes and of each other, nothing wider
// than its column at 320 pixels, and all of it again after the window, the font spacing or the
// scene changes. The same geometry is tested without a browser in test/render/figures-layout.test.ts;
// here it is the boxes the reader actually gets, text measured by the engine that draws it.
import type { Page } from '@playwright/test';
import { casesDrawn, playerIsCurrent, scaleInWorker } from '../render/figures-guard';
import { ALL_FIGURES, HOSTILE_CHARTS, figuresPublished, sceneIdFor } from './figures-kit';
import { expect, expectClean, openLesson, sectionId, test } from './shell-kit';

const names = [...ALL_FIGURES.keys()];
const flows = names.filter((n) => ALL_FIGURES.get(n)?.type === 'flow');
const charts = names.filter((n) => ALL_FIGURES.get(n)?.type === 'chart');

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface FlowShot {
  drawn: string | null;
  scroll: boolean;
  width: number;
  height: number;
  inner: number;
  /** The column width the drawing was last made for: the width of its SVG. */
  laidFor: number;
  nodes: (Box & { id: string })[];
  edges: { id: string; from: string; to: string; bare: boolean; turned: boolean; chip: Box; start: [number, number] | null; tip: [number, number] | null; trace: [number, number][] }[];
}

/** A drawing is redone in the frame after its scene appears or its column changes: let that frame pass. */
const settle = (page: Page): Promise<unknown> => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function show(page: Page, name: string): Promise<string> {
  const id = sceneIdFor(name);
  await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), id);
  await expect(page.locator(`#${sectionId(id)}`)).toBeVisible();
  await settle(page);
  return id;
}

/** Change the window and wait until the page has it. */
async function resize(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
}

/**
 * Everything about a drawn flow that a ruler could measure. A drawing is redone a frame after its
 * column changes, so this waits until the drawing on the page is the one made for the column as it
 * is now; measuring in between would be measuring the old drawing in the new column.
 */
async function flowShot(page: Page, sceneId: string): Promise<FlowShot> {
  let shot = await readFlow(page, sceneId);
  const current = (): boolean => shot.drawn !== 'true' || shot.scroll || shot.laidFor === Math.ceil(shot.inner);
  if (!current()) {
    await expect
      .poll(async () => {
        shot = await readFlow(page, sceneId);
        return current();
      }, 'the flow is redrawn for its column')
      .toBe(true);
  }
  return shot;
}

/** The flow as it is at this instant, relative to the top left of the drawing. */
function readFlow(page: Page, sceneId: string): Promise<FlowShot> {
  return page.evaluate((id) => {
    const figure = Array.from(document.querySelectorAll<HTMLElement>('.lt-figure')).find((f) => f.dataset.scene === id) as HTMLElement;
    const root = figure.querySelector<HTMLElement>('.lt-flow') as HTMLElement;
    const origin = root.getBoundingClientRect();
    const box = (el: Element): { x: number; y: number; w: number; h: number } => {
      const r = el.getBoundingClientRect();
      return { x: r.left - origin.left + root.scrollLeft, y: r.top - origin.top, w: r.width, h: r.height };
    };
    // Path data here starts and ends with a zero-length stroke at a corner of the drawing; the real path lies between.
    const second = (d: string | null | undefined): [number, number] | null => {
      const m = Array.from((d ?? '').matchAll(/M(-?[\d.]+) (-?[\d.]+)/g));
      return m.length >= 3 ? [Number((m[1] as RegExpMatchArray)[1]), Number((m[1] as RegExpMatchArray)[2])] : null;
    };
    const groups = Array.from(root.querySelectorAll<SVGGElement>('.lt-conn'));
    return {
      drawn: root.dataset.drawn ?? null,
      scroll: root.dataset.scroll !== undefined,
      width: root.scrollWidth,
      height: origin.height,
      inner: root.clientWidth,
      laidFor: Number(root.querySelector('.lt-flow-svg')?.getAttribute('width')),
      nodes: Array.from(root.querySelectorAll<HTMLElement>('.lt-node')).map((n) => ({ id: n.dataset.part ?? '', ...box(n) })),
      edges: Array.from(root.querySelectorAll<HTMLElement>('.lt-edge')).map((e, i) => {
        const group = groups.find((g) => g.getAttribute('data-edge') === String(i));
        const line = group?.querySelector<SVGPathElement>('.lt-conn-line');
        const trace: [number, number][] = [];
        if (line) {
          const total = line.getTotalLength();
          for (let at = 2; at < total - 2; at += 3) {
            const p = line.getPointAtLength(at);
            trace.push([p.x, p.y]);
          }
        }
        return {
          id: e.dataset.part ?? '',
          from: e.dataset.from ?? '',
          to: e.dataset.to ?? '',
          bare: e.dataset.bare !== undefined,
          turned: e.dataset.turned !== undefined,
          chip: box(e),
          start: second(line?.getAttribute('d')),
          tip: second(group?.querySelector('.lt-conn-head')?.getAttribute('d')),
          trace,
        };
      }),
    };
  }, sceneId);
}

const overlaps = (a: Box, b: Box, slack = 0.5): boolean => a.x < b.x + b.w - slack && b.x < a.x + a.w - slack && a.y < b.y + b.h - slack && b.y < a.y + a.h - slack;
const onBorder = (p: [number, number], r: Box, slack = 1.6): boolean => {
  const inside = p[0] >= r.x - slack && p[0] <= r.x + r.w + slack && p[1] >= r.y - slack && p[1] <= r.y + r.h + slack;
  return inside && Math.min(Math.abs(p[0] - r.x), Math.abs(p[0] - (r.x + r.w)), Math.abs(p[1] - r.y), Math.abs(p[1] - (r.y + r.h))) <= slack;
};

/** What is wrong with a drawn flow, in words. */
function flowProblems(shot: FlowShot): string[] {
  const out: string[] = [];
  if (shot.drawn !== 'true') out.push(`not drawn (${shot.drawn})`);
  if (shot.scroll || shot.width > shot.inner + 1) out.push(`wider than its column: ${shot.width} in ${shot.inner}`);
  const byId = new Map(shot.nodes.map((n) => [n.id, n]));
  shot.nodes.forEach((n, i) => {
    if (n.w < 60 || n.h < 20) out.push(`node ${n.id} is ${n.w}x${n.h}`);
    if (n.x < -0.5 || n.y < -0.5 || n.x + n.w > shot.inner + 0.5 || n.y + n.h > shot.height + 0.5) out.push(`node ${n.id} lies outside the drawing`);
    for (const other of shot.nodes.slice(i + 1)) if (overlaps(n, other)) out.push(`nodes ${n.id} and ${other.id} overlap`);
  });
  const chips = shot.edges.filter((e) => !e.bare);
  for (const e of shot.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;
    if (!e.start || !e.tip) {
      out.push(`edge ${e.id} is not drawn`);
      continue;
    }
    if (!onBorder(e.start, from)) out.push(`edge ${e.id} starts at ${e.start.map(Math.round)}, not on ${e.from}`);
    if (!onBorder(e.tip, to)) out.push(`edge ${e.id} ends at ${e.tip.map(Math.round)}, not on ${e.to}`);
    const through = shot.nodes.find((n) => e.trace.some(([x, y]) => x > n.x + 2 && x < n.x + n.w - 2 && y > n.y + 2 && y < n.y + n.h - 2));
    if (through) out.push(`edge ${e.id} runs through node ${through.id}`);
    if (e.trace.some(([x, y]) => x < -1 || y < -1 || x > shot.inner + 1 || y > shot.height + 1)) out.push(`edge ${e.id} leaves the drawing`);
  }
  chips.forEach((e, i) => {
    if (e.chip.w < 8 || e.chip.h < 8) out.push(`label ${e.id} is ${e.chip.w}x${e.chip.h}`);
    if (e.chip.x < -0.5 || e.chip.y < -0.5 || e.chip.x + e.chip.w > shot.inner + 0.5 || e.chip.y + e.chip.h > shot.height + 0.5) out.push(`label ${e.id} lies outside the drawing`);
    const on = shot.nodes.find((n) => overlaps(e.chip, n));
    if (on) out.push(`label ${e.id} covers node ${on.id}`);
    for (const other of chips.slice(i + 1)) if (overlaps(e.chip, other.chip)) out.push(`labels ${e.id} and ${other.id} overlap`);
  });
  return out;
}

/** Elements of the figure in a scene that stick out of the figure sideways, and how wide the page has become. */
function spill(page: Page, sceneId: string): Promise<{ page: number; out: string[] }> {
  return page.evaluate((id) => {
    const figure = Array.from(document.querySelectorAll<HTMLElement>('.lt-figure')).find((f) => f.dataset.scene === id) as HTMLElement;
    const frame = figure.getBoundingClientRect();
    const out: string[] = [];
    for (const el of Array.from(figure.querySelectorAll<HTMLElement>('*'))) {
      if (el.closest('svg, [popover], .lt-figure-probe, .lt-figure-ruler')) continue;
      // A table, or one run of working, may be wider than a phone: it scrolls inside its own box, which is itself checked here.
      if (el.parentElement?.closest('.lt-table-wrap, .lt-lines > li[data-scroll]')) continue;
      const r = el.getBoundingClientRect();
      // Skip what is hidden on purpose: the 1px boxes that hold text for a screen reader, and what is inside them.
      let clipped = false;
      for (let up: HTMLElement | null = el; up && up !== figure && !clipped; up = up.parentElement) {
        const box = up.getBoundingClientRect();
        clipped = box.width <= 1.5 || box.height <= 1.5;
      }
      if (clipped || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.left < frame.left - 0.5 || r.right > frame.right + 0.5) out.push(`${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.left - frame.left)}..${Math.round(r.right - frame.left)} of ${Math.round(frame.width)}`);
    }
    return { page: document.documentElement.scrollWidth, out };
  }, sceneId);
}

for (const [width, height] of [
  [1280, 800],
  [320, 640],
] as const) {
  test.describe(`at ${width} pixels wide`, () => {
    test.use({ viewport: { width, height } });

    test('every flow is drawn soundly', async ({ page, browserName }, testInfo) => {
      const watch = await openLesson(page, testInfo, { published: figuresPublished(flows) });
      for (const name of flows) {
        const id = await show(page, name);
        const shot = await flowShot(page, id);
        expect(flowProblems(shot), name).toEqual([]);
        expect(shot.edges.filter((e) => e.start).length, `${name}: connectors`).toBe(shot.edges.length);
      }
      await expectClean(watch, browserName);
    });

    test('no figure is wider than its column, and the page does not scroll sideways', async ({ page }, testInfo) => {
      await openLesson(page, testInfo, { published: figuresPublished(names) });
      for (const name of names) {
        const id = await show(page, name);
        const found = await spill(page, id);
        expect(found.out, name).toEqual([]);
        expect(found.page, `${name}: page width`).toBeLessThanOrEqual(width);
      }
    });
  });
}

test('drawing leaves no style attribute on any element: positions are rules in a sheet the script made', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo, { published: figuresPublished(names) });
  for (const name of names) await show(page, name);
  // Everything is drawn and placed...
  await expect(page.locator('[data-drawn]')).toHaveCount(names.filter((n) => ['flow', 'sequence', 'chart'].includes(ALL_FIGURES.get(n)?.type ?? '')).length);
  expect(await page.evaluate(() => document.querySelectorAll('.lt-figure [data-at]').length)).toBeGreaterThan(100);
  // ...and the page's promise still holds, so a style attribute can only ever be something that got past the escaping.
  expect(await page.evaluate(() => Array.from(document.querySelectorAll('.lt-figure [style], .lt-figure[style]')).map((el) => `${el.localName}: ${el.getAttribute('style')}`))).toEqual([]);
  expect(await page.evaluate(() => document.querySelectorAll('style').length)).toBe(1);
  await expectClean(watch, browserName);
});

test.describe('flow layouts', () => {
  test('the twelve-node pipeline is two abreast on a desk and a single column with side lanes on a phone', async ({ page }, testInfo) => {
    await resize(page, 1280, 800);
    await openLesson(page, testInfo, { published: figuresPublished(['flow12']) });
    const id = await show(page, 'flow12');
    const wide = await flowShot(page, id);
    const rows = (shot: FlowShot): number[][] => {
      const tops = [...new Set(shot.nodes.map((n) => Math.round(n.y + n.h / 2)))].sort((a, b) => a - b);
      return tops.map((t) => shot.nodes.filter((n) => Math.abs(n.y + n.h / 2 - t) < 2).map((n) => n.x));
    };
    expect(Math.max(...rows(wide).map((r) => r.length))).toBe(2);
    // Branches sit side by side: lint beside unit tests, the scan beside the integration tests.
    const at = (shot: FlowShot, part: string): Box => shot.nodes.find((n) => n.id === part) as Box;
    expect(Math.abs(at(wide, 'lint').y + at(wide, 'lint').h / 2 - (at(wide, 'unit').y + at(wide, 'unit').h / 2))).toBeLessThan(2);
    expect(at(wide, 'build').y).toBeGreaterThan(at(wide, 'lint').y + at(wide, 'lint').h);
    // The loops back to the first node come in from the side, having gone round everything in between.
    for (const loop of ['e-redo', 'e-again']) {
      const edge = wide.edges.find((e) => e.id === loop) as FlowShot['edges'][number];
      const commit = at(wide, 'commit');
      expect(Math.abs((edge.tip as [number, number])[0] - (commit.x + commit.w)), loop).toBeLessThan(2);
      expect(Math.max(...edge.trace.map(([x]) => x)), loop).toBeGreaterThan(Math.max(...wide.nodes.map((n) => n.x + n.w)));
    }

    await resize(page, 320, 640);
    await show(page, 'flow12');
    const narrow = await flowShot(page, id);
    expect(flowProblems(narrow)).toEqual([]);
    expect(Math.max(...rows(narrow).map((r) => r.length))).toBe(1);
    expect(narrow.nodes.every((n) => n.w >= 100)).toBe(true);
    // On a lane, a label reads down the lane so it takes one line's width.
    const laneLabels = narrow.edges.filter((e) => e.turned);
    expect(laneLabels.length).toBeGreaterThanOrEqual(3);
    for (const label of laneLabels) expect(label.chip.h, label.id).toBeGreaterThan(label.chip.w);
  });

  test('"right" runs left to right when the layers fit, and falls back to top to bottom when they do not', async ({ page }, testInfo) => {
    await resize(page, 900, 800);
    await openLesson(page, testInfo, { published: figuresPublished(['flowRight', 'flowRightBranch']) });
    for (const name of ['flowRight', 'flowRightBranch']) {
      const id = await show(page, name);
      const shot = await flowShot(page, id);
      expect(flowProblems(shot), name).toEqual([]);
      const centres = shot.nodes.map((n) => n.y + n.h / 2);
      expect(Math.max(...centres) - Math.min(...centres), `${name}: one row`).toBeLessThan(2);
      const lefts = shot.nodes.map((n) => n.x);
      expect([...lefts].sort((a, b) => a - b), `${name}: in the order given`).toEqual(lefts);
    }
    await resize(page, 320, 640);
    const id = await show(page, 'flowRight');
    const shot = await flowShot(page, id);
    expect(flowProblems(shot)).toEqual([]);
    const tops = shot.nodes.map((n) => n.y);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    expect(new Set(shot.nodes.map((n) => Math.round(n.x))).size).toBe(1);
  });

  test('a ring is round when there is room, two columns when there are many nodes, and a looped chain on a phone', async ({ page }, testInfo) => {
    await resize(page, 1280, 800);
    await openLesson(page, testInfo, { published: figuresPublished(['flowRing', 'flowRing12']) });
    const id = await show(page, 'flowRing');
    const round = await flowShot(page, id);
    expect(flowProblems(round)).toEqual([]);
    // Round: five nodes at five different heights or sides, the first one topmost and centred.
    const first = round.nodes[0] as Box;
    expect(first.y).toBe(Math.min(...round.nodes.map((n) => n.y)));
    expect(Math.abs(first.x + first.w / 2 - round.inner / 2)).toBeLessThan(12);
    expect(new Set(round.nodes.map((n) => Math.round(n.x))).size).toBeGreaterThanOrEqual(4);

    const id12 = await show(page, 'flowRing12');
    const track = await flowShot(page, id12);
    expect(flowProblems(track)).toEqual([]);
    expect(new Set(track.nodes.map((n) => Math.round(n.x))).size).toBe(2);
    expect(new Set(track.nodes.map((n) => Math.round(n.y))).size).toBe(6);

    await resize(page, 320, 640);
    await show(page, 'flowRing');
    const chain = await flowShot(page, id);
    expect(flowProblems(chain)).toEqual([]);
    expect(new Set(chain.nodes.map((n) => Math.round(n.x))).size).toBe(1);
    expect(chain.nodes.every((n) => n.w >= 100)).toBe(true);
  });

  test('a ring with connections across it shows each one joining its own two nodes, at every width: review finding P3', async ({ page, browserName }, testInfo) => {
    // Ten nodes do not fit round an ellipse, so the ring is two columns. "again" joins two nodes of
    // one column and was drawn hidden behind the three boxes between them; "in time" crosses from
    // one column to the other and was drawn through a fourth.
    await resize(page, 1280, 800);
    const watch = await openLesson(page, testInfo, { published: figuresPublished(['flowRing10']) });
    const id = await show(page, 'flowRing10');
    const wide = await flowShot(page, id);
    expect(flowProblems(wide)).toEqual([]);
    expect(new Set(wide.nodes.map((n) => Math.round(n.x))).size).toBe(2);
    const node = (shot: FlowShot, name: string): Box => shot.nodes.find((n) => n.id === name) as Box;
    const edge = (shot: FlowShot, name: string): FlowShot['edges'][number] => shot.edges.find((e) => e.id === name) as FlowShot['edges'][number];
    // "again" leaves its column on the outside and comes back in to the node it belongs to.
    const column = node(wide, 'timer');
    const again = edge(wide, 'again');
    expect(Math.max(...again.trace.map(([x]) => x))).toBeGreaterThan(column.x + column.w + 8);
    for (const between of ['wait', 'expire', 'double']) {
      const box = node(wide, between);
      expect(again.trace.filter(([x, y]) => y > box.y && y < box.y + box.h).every(([x]) => x > box.x + box.w + 4), `"again" passes outside ${between}`).toBe(true);
    }
    // Its label sits on its own line, clear of every box.
    expect(wide.nodes.some((n) => overlaps(again.chip, n))).toBe(false);
    expect(again.trace.some(([x, y]) => x >= again.chip.x - 2 && x <= again.chip.x + again.chip.w + 2 && y >= again.chip.y - 2 && y <= again.chip.y + again.chip.h + 2)).toBe(true);
    // "in time" stays in the gap between the two columns all the way down.
    const left = node(wide, 'ack');
    const inTime = edge(wide, 'd');
    expect(inTime.trace.every(([x]) => x > left.x + left.w - 1 && x < column.x + 1)).toBe(true);

    // The same at every width a window is likely to have: sound, and inside its column without scrolling.
    for (const width of [1024, 768, 600, 480, 414, 390, 360, 320]) {
      await resize(page, width, 800);
      await show(page, 'flowRing10');
      const shot = await flowShot(page, id);
      expect(flowProblems(shot), `${width} pixels`).toEqual([]);
      expect(shot.edges.filter((e) => e.start).length, `${width} pixels: connectors`).toBe(shot.edges.length);
    }
    await expectClean(watch, browserName);
  });
});

test('a flow too wide even for one column scrolls inside its own box, which the keyboard can reach, and stays in its column', async ({ page, browserName }, testInfo) => {
  // Narrower than any phone: twelve nodes and their lanes cannot fit, so this is the last resort.
  await resize(page, 220, 640);
  const watch = await openLesson(page, testInfo, { published: figuresPublished(['flow12']) });
  const id = await show(page, 'flow12');
  const root = page.locator(`#${sectionId(id)} .lt-flow`);
  await expect(root).toHaveAttribute('data-scroll', 'true');
  await expect(root).toHaveAttribute('tabindex', '0');
  await expect(root).toHaveAttribute('role', 'region');
  await expect(root).toHaveAccessibleName(/scroll sideways/);
  const box = await root.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, overflow: getComputedStyle(el).overflowX }));
  expect(box.scroll).toBeGreaterThan(box.client);
  expect(box.overflow).toBe('auto');
  // The figure keeps to its column. (At this width the page's own chrome is past what it promises to fit, so the page is not measured.)
  const fit = await root.evaluate((el) => {
    const column = (el.closest('.lt-figure-col') as HTMLElement).getBoundingClientRect();
    const figure = (el.closest('.lt-figure') as HTMLElement).getBoundingClientRect();
    return { figure: figure.right - column.right, drawing: el.getBoundingClientRect().right - figure.right };
  });
  expect(fit.figure).toBeLessThanOrEqual(0.5);
  expect(fit.drawing).toBeLessThanOrEqual(0);
  // The drawing inside is still sound: it is only wider than the window.
  const shot = await flowShot(page, id);
  expect(flowProblems({ ...shot, scroll: false, inner: shot.width })).toEqual([]);
  await root.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => root.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

  // With room again, it is an ordinary drawing: no scroll box, nothing to tab to.
  await resize(page, 1280, 800);
  await show(page, 'flow12');
  await expect(root).not.toHaveAttribute('data-scroll');
  await expect(root).not.toHaveAttribute('tabindex');
  await expect(root).not.toHaveAttribute('role');
  expect(flowProblems(await flowShot(page, id))).toEqual([]);
  await expectClean(watch, browserName);
});

test.describe('a drawing follows its column', () => {
  test('it is redrawn when the window narrows and widens, and when the reader spaces the text out', async ({ page, browserName }, testInfo) => {
    await resize(page, 1280, 800);
    const watch = await openLesson(page, testInfo, { published: figuresPublished(['ex-flow', 'ex-sequence', 'ex-chart']) });
    const id = await show(page, 'ex-flow');
    const wide = await flowShot(page, id);
    expect(flowProblems(wide)).toEqual([]);

    await resize(page, 320, 640);
    await expect.poll(async () => (await flowShot(page, id)).inner).toBeLessThan(280);
    await settle(page);
    const narrow = await flowShot(page, id);
    expect(flowProblems(narrow)).toEqual([]);
    expect((await spill(page, id)).page).toBeLessThanOrEqual(320);

    // WCAG 1.4.12: wider letters and words make every label bigger. The drawing has to be made again around them.
    const heights = narrow.nodes.map((n) => n.h);
    await page.evaluate(() => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    });
    await expect.poll(async () => (await flowShot(page, id)).nodes.some((n, i) => n.h > (heights[i] as number) + 4)).toBe(true);
    await settle(page);
    expect(flowProblems(await flowShot(page, id))).toEqual([]);
    for (const name of ['ex-flow', 'ex-sequence', 'ex-chart']) {
      const found = await spill(page, await show(page, name));
      expect(found.out, `${name} with text spacing`).toEqual([]);
      expect(found.page, `${name} with text spacing`).toBeLessThanOrEqual(320);
    }

    await resize(page, 1280, 800);
    await show(page, 'ex-flow');
    await expect.poll(async () => (await flowShot(page, id)).inner).toBeGreaterThan(400);
    await settle(page);
    expect(flowProblems(await flowShot(page, id))).toEqual([]);
    await expectClean(watch, browserName);
  });

  test('a figure in a scene that was hidden while the window changed is right when its scene is shown', async ({ page }, testInfo) => {
    await resize(page, 1280, 800);
    await openLesson(page, testInfo, { published: figuresPublished(['ex-chart', 'flow12']) });
    await show(page, 'ex-chart');
    await resize(page, 320, 640);
    const id = await show(page, 'flow12');
    const shot = await flowShot(page, id);
    expect(shot.inner).toBeLessThan(280);
    expect(flowProblems(shot)).toEqual([]);
  });
});

test.describe('sequence', () => {
  interface SeqShot {
    drawn: string | null;
    lifelines: number[];
    actors: Box[];
    messages: { id: string; from: number; to: number; lost: boolean; chip: Box; row: Box; start: [number, number] | null; tip: [number, number] | null; cross: boolean; head: boolean; arrowY: number }[];
    width: number;
  }
  const seqShot = (page: Page, sceneId: string): Promise<SeqShot> =>
    page.evaluate((id) => {
      const figure = Array.from(document.querySelectorAll<HTMLElement>('.lt-figure')).find((f) => f.dataset.scene === id) as HTMLElement;
      const root = figure.querySelector<HTMLElement>('.lt-seq') as HTMLElement;
      const origin = root.getBoundingClientRect();
      const box = (el: Element): { x: number; y: number; w: number; h: number } => {
        const r = el.getBoundingClientRect();
        return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
      };
      const second = (d: string | null | undefined): [number, number] | null => {
        const m = Array.from((d ?? '').matchAll(/M(-?[\d.]+) (-?[\d.]+)/g));
        return m.length >= 3 ? [Number((m[1] as RegExpMatchArray)[1]), Number((m[1] as RegExpMatchArray)[2])] : null;
      };
      const actors = Array.from(root.querySelectorAll<HTMLElement>('.lt-actor'));
      const index = new Map(actors.map((a, i) => [a.dataset.part, i]));
      const groups = Array.from(root.querySelectorAll<SVGGElement>('.lt-conn'));
      return {
        drawn: root.dataset.drawn ?? null,
        width: origin.width,
        lifelines: Array.from(root.querySelectorAll('.lt-seq-lifeline')).map((l) => Number(l.getAttribute('x1'))),
        actors: actors.map(box),
        messages: Array.from(root.querySelectorAll<HTMLElement>('.lt-msg')).map((m, i) => {
          const group = groups.find((g) => g.getAttribute('data-edge') === String(i));
          const start = second(group?.querySelector('.lt-conn-line')?.getAttribute('d'));
          return {
            id: m.dataset.part ?? '',
            from: index.get(m.dataset.from) ?? -1,
            to: index.get(m.dataset.to) ?? -1,
            lost: m.dataset.status === 'lost',
            chip: box(m.querySelector('.lt-msg-text') as Element),
            row: box(m),
            start,
            tip: second(group?.querySelector('.lt-conn-head, .lt-conn-cross')?.getAttribute('d')),
            cross: !!group?.querySelector('.lt-conn-cross'),
            head: !!group?.querySelector('.lt-conn-head'),
            arrowY: start ? start[1] : Number.NaN,
          };
        }),
      };
    }, sceneId);

  test('five participants and twelve messages are drawn with lifelines, self-messages and a lost message', async ({ page, browserName }, testInfo) => {
    await resize(page, 1280, 900);
    const watch = await openLesson(page, testInfo, { published: figuresPublished(['sequence12', 'ex-sequence']) });
    const id = await show(page, 'sequence12');
    const shot = await seqShot(page, id);
    expect(shot.drawn).toBe('true');
    expect(shot.lifelines).toHaveLength(5);
    // One lifeline under the middle of each participant, evenly spaced.
    shot.actors.forEach((a, i) => expect(Math.abs(a.x + a.w / 2 - (shot.lifelines[i] as number)), `participant ${i}`).toBeLessThan(1.5));
    for (let i = 1; i < 5; i++) expect((shot.lifelines[i] as number) - (shot.lifelines[i - 1] as number)).toBeCloseTo(shot.width / 5, 0);
    for (let i = 1; i < shot.actors.length; i++) expect(overlaps(shot.actors[i - 1] as Box, shot.actors[i] as Box)).toBe(false);

    let previous = -1;
    for (const m of shot.messages) {
      const from = shot.lifelines[m.from] as number;
      const to = shot.lifelines[m.to] as number;
      expect(m.start, m.id).not.toBeNull();
      expect(Math.abs((m.start as [number, number])[0] - from), `${m.id} starts on its sender's lifeline`).toBeLessThan(1.5);
      // In order, top to bottom, each label above its own arrow and inside the drawing.
      expect(m.arrowY, `${m.id} is below the message before it`).toBeGreaterThan(previous);
      previous = m.arrowY;
      expect(m.chip.y + m.chip.h, `${m.id}: label above its arrow`).toBeLessThanOrEqual(m.arrowY + 0.5);
      expect(m.chip.x, m.id).toBeGreaterThanOrEqual(-0.5);
      expect(m.chip.x + m.chip.w, m.id).toBeLessThanOrEqual(shot.width + 0.5);
      const tip = m.tip as [number, number];
      if (m.lost) {
        // A lost message has no arrowhead: it stops short of the receiver and ends in a cross.
        expect([m.cross, m.head]).toEqual([true, false]);
        expect(Math.abs(to - from) - Math.abs(tip[0] - from)).toBeGreaterThan(20);
      } else if (m.from === m.to) {
        expect(m.head).toBe(true);
        expect(Math.abs(tip[0] - from), `${m.id} comes back to its own lifeline`).toBeLessThan(2);
        expect(tip[1], `${m.id} comes back lower than it left`).toBeGreaterThan(m.arrowY + 6);
      } else {
        expect([m.cross, m.head]).toEqual([false, true]);
        expect(Math.abs(tip[0] - to), `${m.id} ends on its receiver's lifeline`).toBeLessThan(2);
      }
    }
    expect(shot.messages.filter((m) => m.lost)).toHaveLength(1);
    expect(shot.messages.filter((m) => m.from === m.to)).toHaveLength(3);
    for (let i = 1; i < shot.messages.length; i++) expect(overlaps((shot.messages[i - 1] as { chip: Box }).chip, (shot.messages[i] as { chip: Box }).chip), `labels ${i - 1} and ${i}`).toBe(false);
    await expect(page.locator(`#${sectionId(id)} .lt-msg-lost`)).toBeVisible();
    await expect(page.locator(`#${sectionId(id)} .lt-msg-lost`)).toHaveText('lost');
    await expectClean(watch, browserName);
  });

  test('on a phone three participants are still drawn, and five become a numbered list of who to whom', async ({ page }, testInfo) => {
    await resize(page, 320, 640);
    await openLesson(page, testInfo, { published: figuresPublished(['sequence12', 'ex-sequence']) });
    const three = await seqShot(page, await show(page, 'ex-sequence'));
    expect(three.drawn).toBe('true');
    expect(three.lifelines).toHaveLength(3);
    for (let i = 1; i < three.actors.length; i++) expect(overlaps(three.actors[i - 1] as Box, three.actors[i] as Box)).toBe(false);
    for (const m of three.messages) expect(m.chip.x + m.chip.w).toBeLessThanOrEqual(three.width + 0.5);

    const id = await show(page, 'sequence12');
    const five = await seqShot(page, id);
    expect(five.drawn).toBe('list');
    expect(five.lifelines).toHaveLength(0);
    const scene = page.locator(`#${sectionId(id)}`);
    await expect(scene.locator('.lt-seq-svg')).toBeHidden();
    await expect(scene.locator('.lt-msg').first()).toContainText('Browser to CDN edge: GET /orders');
    await expect(scene.locator('.lt-msg .lt-route').first()).toBeVisible();
    await expect(scene.getByText('Messages, in order')).toBeVisible();
    await expect(scene.locator('.lt-msg-lost')).toBeVisible();
    // Rows in order, one under another.
    for (let i = 1; i < five.messages.length; i++) expect((five.messages[i] as { row: Box }).row.y).toBeGreaterThanOrEqual((five.messages[i - 1] as { row: Box }).row.y + (five.messages[i - 1] as { row: Box }).row.h - 0.5);
  });
});

test.describe('chart', () => {
  interface ChartShot {
    drawn: string | null;
    hidden: string | null;
    frame: Box;
    ticks: { cls: string; text: string; box: Box }[];
    keys: string[];
    bars: number;
    lines: number;
    dots: number;
    tableOpen: boolean;
    patterns: number;
  }
  const chartShot = (page: Page, sceneId: string): Promise<ChartShot> =>
    page.evaluate((id) => {
      const figure = Array.from(document.querySelectorAll<HTMLElement>('.lt-figure')).find((f) => f.dataset.scene === id) as HTMLElement;
      const root = figure.querySelector<HTMLElement>('.lt-chart') as HTMLElement;
      const frame = root.querySelector<HTMLElement>('.lt-chart-frame') as HTMLElement;
      const origin = frame.getBoundingClientRect();
      const box = (el: Element): { x: number; y: number; w: number; h: number } => {
        const r = el.getBoundingClientRect();
        return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
      };
      const shown = (el: HTMLElement): boolean => !el.hidden && el.getBoundingClientRect().width > 0;
      return {
        drawn: root.dataset.drawn ?? null,
        hidden: root.querySelector('.lt-chart-plot')?.getAttribute('aria-hidden') ?? null,
        frame: { x: 0, y: 0, w: origin.width, h: origin.height },
        ticks: Array.from(frame.querySelectorAll<HTMLElement>(':scope > span')).filter(shown).map((t) => ({ cls: t.className, text: t.textContent ?? '', box: box(t) })),
        keys: Array.from(root.querySelectorAll<HTMLElement>('.lt-chart-key-text')).filter(shown).map((k) => k.textContent ?? ''),
        // The plot's own marks: a label at the end of a line carries a small sample of the line, which is not counted.
        bars: frame.querySelectorAll(':scope > svg > .lt-chart-bar').length,
        lines: frame.querySelectorAll(':scope > svg > .lt-chart-line').length,
        dots: frame.querySelectorAll(':scope > svg > .lt-chart-dot').length,
        tableOpen: (root.querySelector('details') as HTMLDetailsElement | null)?.open ?? true,
        patterns: frame.querySelectorAll('pattern').length,
      };
    }, sceneId);
  const of = (shot: ChartShot, cls: string): ChartShot['ticks'] => shot.ticks.filter((t) => t.cls.split(' ').includes(cls));

  for (const [width, height] of [
    [1280, 800],
    [320, 640],
  ] as const) {
    test(`every chart has readable axes, a mark for every value and a name for every series at ${width} pixels`, async ({ page, browserName }, testInfo) => {
      await resize(page, width, height);
      const watch = await openLesson(page, testInfo, { published: figuresPublished(charts) });
      for (const name of charts) {
        const figure = ALL_FIGURES.get(name);
        if (figure?.type !== 'chart') continue;
        const id = await show(page, name);
        const shot = await chartShot(page, id);
        const scene = page.locator(`#${sectionId(id)}`);
        expect(shot.drawn, name).toMatch(/^(true|sideways)$/);
        expect(shot.hidden, `${name}: the plot is for the eye, the table is for a screen reader`).toBe('true');

        // No label hangs out of the plot, and no two labels of one axis run into each other.
        for (const t of shot.ticks) {
          expect(t.box.x, `${name}: "${t.text}"`).toBeGreaterThanOrEqual(-0.5);
          expect(t.box.x + t.box.w, `${name}: "${t.text}"`).toBeLessThanOrEqual(shot.frame.w + 0.5);
          expect(t.box.y + t.box.h, `${name}: "${t.text}"`).toBeLessThanOrEqual(shot.frame.h + 0.5);
        }
        for (const axis of ['lt-chart-xtick', 'lt-chart-ytick', 'lt-chart-vtick', 'lt-chart-cat', 'lt-chart-value', 'lt-chart-end']) {
          const labels = of(shot, axis);
          labels.forEach((a, i) => labels.slice(i + 1).forEach((b) => expect(overlaps(a.box, b.box, 0), `${name}: "${a.text}" and "${b.text}"`).toBe(false)));
        }

        // The value axis: at least three ticks, evenly spaced, in order, starting from zero for bars.
        const valueTicks = of(shot, shot.drawn === 'sideways' ? 'lt-chart-vtick' : 'lt-chart-ytick');
        expect(valueTicks.length, `${name}: ticks`).toBeGreaterThanOrEqual(shot.drawn === 'sideways' ? 2 : 3);
        expect(valueTicks.length, `${name}: ticks`).toBeLessThanOrEqual(8);
        if (figure.mark === 'bar') expect(valueTicks.some((t) => t.text === '0'), `${name}: bars start at zero`).toBe(true);
        const places = valueTicks.map((t) => (shot.drawn === 'sideways' ? t.box.x + t.box.w / 2 : -(t.box.y + t.box.h / 2)));
        expect([...places].sort((a, b) => a - b), `${name}: ticks in order`).toEqual(places);
        // No two ticks of an axis are called the same thing.
        expect(new Set(valueTicks.map((t) => t.text)).size, `${name}: tick labels ${valueTicks.map((t) => t.text).join(' | ')}`).toBe(valueTicks.length);

        // Every x position is named: all of them for bars, and at least the first and last for a line.
        const xLabels = of(shot, shot.drawn === 'sideways' ? 'lt-chart-cat' : 'lt-chart-xtick').map((t) => t.text);
        if (figure.mark === 'bar') expect(xLabels, name).toEqual(figure.xs.map((x) => x.label));
        else {
          expect(xLabels[0], name).toBe(figure.xs[0]?.label);
          expect(xLabels.at(-1), name).toBe(figure.xs.at(-1)?.label);
          expect(xLabels.length, name).toBeGreaterThanOrEqual(Math.min(3, figure.xs.length));
        }

        // Marks: a bar per value, or a line per series with a marker per point.
        if (figure.mark === 'bar') {
          expect(shot.bars, name).toBe(figure.xs.length * figure.series.length);
        } else {
          expect(shot.lines, name).toBe(figure.series.length);
          expect(shot.dots, name).toBe(figure.mark === 'line' ? figure.xs.length * figure.series.length : 0);
        }
        // Each series is named once beside the plot, whether in a legend or at the end of its line.
        const named = [...shot.keys].sort();
        expect(named, `${name}: series names`).toEqual(figure.series.map((s) => s.label).sort());
        if (figure.mark === 'bar' && figure.series.length === 3) expect(shot.patterns, `${name}: the third series is hatched`).toBe(1);

        await expect(scene.locator('.lt-chart-ytitle')).toHaveText(shot.drawn === 'sideways' ? figure.xLabel : figure.unit ? `${figure.yLabel} (${figure.unit})` : figure.yLabel);
        await expect(scene.locator('.lt-chart-xtitle')).toHaveText(shot.drawn === 'sideways' ? (figure.unit ? `${figure.yLabel} (${figure.unit})` : figure.yLabel) : figure.xLabel);
        if (figure.data === 'illustrative') await expect(scene.getByText('Illustrative shape, not measured data')).toBeVisible();
        else await expect(scene.getByText('Illustrative shape, not measured data')).toHaveCount(0);
        expect(shot.tableOpen, `${name}: the table is folded once the chart is drawn`).toBe(false);
      }
      await expectClean(watch, browserName);
    });
  }

  for (const [width, height] of [
    [1280, 800],
    [320, 640],
  ] as const) {
    test(`a line with a narrow range has an axis that can be read at ${width} pixels: review finding P2`, async ({ page, browserName }, testInfo) => {
      await resize(page, width, height);
      const watch = await openLesson(page, testInfo, { published: figuresPublished(['chartLineNarrow']) });
      const id = await show(page, 'chartLineNarrow');
      const shot = await chartShot(page, id);
      // Was "100, 100, 100, 99.9, 99.8": three ticks at three heights under one name.
      const ticks = of(shot, 'lt-chart-ytick');
      expect(ticks.map((t) => t.text)).toEqual(['99.8', '99.9', '100', '100.1', '100.2']);
      // And each label is beside the value it names: the five points are 99.8 to 100.2, one per tick.
      const dots = await page.locator(`#${sectionId(id)} .lt-chart-frame > svg > .lt-chart-dot`).evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          const frame = (el.closest('.lt-chart-frame') as HTMLElement).getBoundingClientRect();
          return r.top + r.height / 2 - frame.top;
        }),
      );
      expect(dots).toHaveLength(5);
      dots.forEach((y, i) => expect(Math.abs(y - ((ticks[i] as ChartShot['ticks'][number]).box.y + (ticks[i] as ChartShot['ticks'][number]).box.h / 2)), `point ${i + 1} against "${ticks[i]?.text}"`).toBeLessThan(1.5));
      await expectClean(watch, browserName);
    });

    test(`charts of values a hair apart, too small to divide or at the limit are drawn at once at ${width} pixels: review finding H1`, async ({ page, browserName }, testInfo) => {
      const hostile = Object.keys(HOSTILE_CHARTS) as (keyof typeof HOSTILE_CHARTS)[];
      // First, away from any browser: the axis arithmetic comes back for these values, in every way
      // the chart can ask for it, and the player the page will carry is built from that arithmetic.
      // A page that holds these values is opened only after both, because when the arithmetic did
      // not come back the page froze and took memory without limit.
      for (const name of hostile) {
        const figure = HOSTILE_CHARTS[name];
        if (figure.type !== 'chart') continue;
        const guarded = await scaleInWorker(casesDrawn(figure.series.flatMap((s) => s.values)), { ms: 5000, heapMb: 32 });
        expect(guarded.ok ? 'returned' : guarded.why, `${name}: the axis arithmetic`).toBe('returned');
      }
      expect(await playerIsCurrent(), 'src/generated/player-assets.ts is the build of the player source as it is now (if not: node scripts/build.mjs --only=player)').toBe(true);

      await resize(page, width, height);
      const started = Date.now();
      const watch = await openLesson(page, testInfo, { published: figuresPublished(hostile) });
      const axes = new Map<string, string[]>();
      for (const name of hostile) {
        const figure = HOSTILE_CHARTS[name];
        if (figure.type !== 'chart') continue;
        const id = await show(page, name);
        const shot = await chartShot(page, id);
        expect(shot.drawn, name).toMatch(/^(true|sideways)$/);
        const ticks = of(shot, shot.drawn === 'sideways' ? 'lt-chart-vtick' : 'lt-chart-ytick');
        // A short axis, every tick with a name of its own, none of them a row of fifty zeros.
        expect(ticks.length, `${name}: ticks`).toBeGreaterThanOrEqual(2);
        expect(ticks.length, `${name}: ticks`).toBeLessThanOrEqual(8);
        expect(new Set(ticks.map((t) => t.text)).size, `${name}: ${ticks.map((t) => t.text).join(' | ')}`).toBe(ticks.length);
        for (const t of ticks) expect(t.text.length, `${name}: "${t.text}"`).toBeLessThanOrEqual(18);
        axes.set(name, ticks.map((t) => t.text));
        // The value written beside a bar is short too: a power of ten, not the fifty zeros before its first digit.
        for (const t of of(shot, 'lt-chart-value')) expect(t.text.length, `${name}: value "${t.text}"`).toBeLessThanOrEqual(12);
        if (name === 'tinyBar' && shot.drawn === 'true') expect(of(shot, 'lt-chart-value').map((t) => t.text)).toEqual(['1E-50', '3E-50', '2E-50', '4E-50']);
        // Every mark is there and every coordinate is a number.
        if (figure.mark === 'bar') expect(shot.bars, name).toBe(figure.xs.length * figure.series.length);
        else expect(shot.lines, name).toBe(figure.series.length);
        const bad = await page
          .locator(`#${sectionId(id)} .lt-chart-frame svg, #${sectionId(id)} .lt-chart-frame svg *`)
          .evaluateAll((els) => els.flatMap((el) => Array.from(el.attributes).filter((a) => /NaN|Infinity/.test(a.value) || (/^(width|height|r)$/.test(a.name) && Number(a.value) < 0)).map((a) => `${el.localName} ${a.name}="${a.value}"`)));
        expect(bad, `${name}: coordinates`).toEqual([]);
        // Nothing hangs out of the frame, and the page is no wider than the window.
        for (const t of shot.ticks) {
          expect(t.box.x, `${name}: "${t.text}"`).toBeGreaterThanOrEqual(-0.5);
          expect(t.box.x + t.box.w, `${name}: "${t.text}"`).toBeLessThanOrEqual(shot.frame.w + 0.5);
        }
        expect((await spill(page, id)).page, `${name}: page width`).toBeLessThanOrEqual(width);
      }
      // Upright, the axes are exactly these. (On a phone the bar charts lie on their side and have fewer ticks.)
      if (width === 1280) {
        expect(axes.get('noiseLine')).toEqual(['0.1', '0.2', '0.3', '0.4', '0.5']);
        expect(axes.get('noiseBar')).toEqual(['0', '0.1', '0.2', '0.3']);
        expect(axes.get('subnormalLine')).toEqual(['0', '0.2', '0.4', '0.6', '0.8', '1']);
        expect(axes.get('subnormalBar')).toEqual(['0', '0.2', '0.4', '0.6', '0.8', '1']);
        expect(axes.get('limitLine')).toEqual(['400B', '600B', '800B', '1T', '1.2T', '1.4T', '1.6T']);
        expect(axes.get('tinyBar')).toEqual(['0', '1E-50', '2E-50', '3E-50', '4E-50']);
        expect(axes.get('flatLine')).toEqual(['2', '4', '6', '8', '10', '12']);
      }
      // The whole lesson, eleven charts, opened and drawn in less time than one of them used to take to fail.
      expect(Date.now() - started).toBeLessThan(15_000);
      await expectClean(watch, browserName);
    });
  }

  test('bars stand up when their labels fit under them and lie on their side when they do not', async ({ page }, testInfo) => {
    await resize(page, 1280, 800);
    await openLesson(page, testInfo, { published: figuresPublished(['chartBar3', 'chartBar1']) });
    const id = await show(page, 'chartBar3');
    expect((await chartShot(page, id)).drawn).toBe('true');
    const one = await chartShot(page, await show(page, 'chartBar1'));
    // Four bars with room over each: every value is written above its bar.
    expect(of(one, 'lt-chart-value').map((t) => t.text)).toEqual(['3.7', '8.87', '9.81', '3.72']);
    await resize(page, 320, 640);
    await show(page, 'chartBar3');
    await expect.poll(async () => (await chartShot(page, id)).drawn).toBe('sideways');
    const side = await chartShot(page, id);
    expect(of(side, 'lt-chart-cat').map((t) => t.text)).toEqual(['Bubble sort', 'Insertion sort', 'Merge sort', 'Quicksort', 'Heapsort']);
    expect(of(side, 'lt-chart-value')).toHaveLength(15);
    // Groups in the order given, top to bottom.
    const tops = of(side, 'lt-chart-cat').map((t) => t.box.y);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  });

  test('lines are told apart by dash and marker as well as colour, and bars by fill', async ({ page }, testInfo) => {
    await resize(page, 1280, 800);
    await openLesson(page, testInfo, { published: figuresPublished(['chartLine3', 'chartBar3']) });
    const lineScene = page.locator(`#${sectionId(await show(page, 'chartLine3'))}`);
    const dashes = await lineScene.locator('.lt-chart-frame > svg > .lt-chart-line').evaluateAll((els) => els.map((el) => getComputedStyle(el).strokeDasharray));
    expect(new Set(dashes).size).toBe(3);
    const markers = await lineScene.locator('.lt-chart-frame > svg > .lt-chart-dot').evaluateAll((els) => [...new Set(els.map((el) => el.tagName.toLowerCase()))].sort());
    expect(markers).toEqual(['circle', 'path', 'rect']);
    // With room, each line is named at its own end, beside a sample of how it is drawn.
    await expect(lineScene.locator('.lt-chart-end')).toHaveCount(3);
    await expect(lineScene.locator('.lt-chart-end svg')).toHaveCount(3);
    await expect(lineScene.locator('.lt-chart-legend')).toBeHidden();

    const barScene = page.locator(`#${sectionId(await show(page, 'chartBar3'))}`);
    const fills = await barScene.locator('.lt-chart-frame > svg > .lt-chart-bar').evaluateAll((els) => [...new Set(els.map((el) => `${getComputedStyle(el).fill}|${getComputedStyle(el).strokeWidth}`))]);
    expect(fills).toHaveLength(3);
    expect(fills.filter((f) => f.startsWith('url('))).toHaveLength(1);
    await expect(barScene.locator('.lt-chart-legend li')).toHaveCount(3);
  });

  test('the data table is one keypress away and complete', async ({ page }, testInfo) => {
    await openLesson(page, testInfo, { published: figuresPublished(['chartLine3']) });
    const scene = page.locator(`#${sectionId(await show(page, 'chartLine3'))}`);
    const summary = scene.locator('details.lt-chart-table > summary');
    await expect(summary).toHaveText('Show the data as a table');
    await expect(scene.locator('table')).toBeHidden();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(scene.locator('table')).toBeVisible();
    await expect(scene.getByRole('columnheader')).toHaveCount(4);
    await expect(scene.getByRole('rowheader')).toHaveCount(8);
    await expect(scene.getByRole('cell')).toHaveCount(24);
    await expect(scene.getByRole('cell').nth(21)).toHaveText('1,400');
    // The box the table scrolls in can be reached and is named.
    const region = scene.getByRole('region', { name: 'Data table, scene 1' });
    await expect(region).toHaveAttribute('tabindex', '0');
    await expect(scene.locator('table caption')).toContainText('Median response time (ms)');
  });
});

test.describe('lines, layers, timeline and compare', () => {
  test('twenty-four lines of code wrap inside the listing, each continuing under its own indent', async ({ page }, testInfo) => {
    await resize(page, 320, 640);
    await openLesson(page, testInfo, { published: figuresPublished(['lines24']) });
    const id = await show(page, 'lines24');
    const scene = page.locator(`#${sectionId(id)}`);
    await expect(scene.locator('.lt-lines > li')).toHaveCount(24);
    await expect(scene.getByText('Code written by your agent. Read it before you run it.')).toBeVisible();
    await expect(scene.locator('.lt-figure-language')).toHaveText('TypeScript');
    await expect(scene.locator('.lt-figure button:not([popovertarget])')).toHaveCount(0);
    const measured = await scene.locator('.lt-lines > li').evaluateAll((items) =>
      items.map((li) => {
        const code = li.querySelector('code') as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(code);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
        const list = (li.parentElement as HTMLElement).getBoundingClientRect();
        // Where each visual line starts. A line can be several boxes (the space it wrapped at is one of its own).
        const starts = new Map<number, number>();
        for (const r of rects) starts.set(Math.round(r.top), Math.min(starts.get(Math.round(r.top)) ?? Number.POSITIVE_INFINITY, r.left - list.left));
        return {
          indent: getComputedStyle(li).getPropertyValue('--lt-indent').trim(),
          lines: starts.size,
          lefts: [...new Set([...starts.values()].map((v) => Math.round(v)))],
          overflow: li.scrollWidth > li.clientWidth + 1 || rects.some((r) => r.right > list.right + 0.5),
          text: code.textContent ?? '',
        };
      }),
    );
    expect(measured.filter((m) => m.overflow).map((m) => m.text)).toEqual([]);
    // The long lines do wrap at this width.
    expect(measured.filter((m) => m.lines > 1).length).toBeGreaterThan(8);
    // Line 15 is indented six spaces and wraps: its later lines start where its first character does.
    const fifteen = measured[14] as (typeof measured)[number];
    expect(fifteen.indent).toBe('6');
    expect(fifteen.lines).toBeGreaterThan(1);
    const top = measured[0] as (typeof measured)[number];
    expect(top.lefts.length).toBe(1);
    const ch = await scene.locator('.lt-lines code').first().evaluate((el) => {
      const probe = document.createElement('span');
      probe.textContent = '0000000000';
      el.append(probe);
      const w = probe.getBoundingClientRect().width / 10;
      probe.remove();
      return w;
    });
    // Its first line starts at the margin (the six spaces are part of the text); the rest hang six characters in.
    expect(fifteen.lefts).toHaveLength(2);
    expect(Math.min(...fifteen.lefts)).toBe(top.lefts[0]);
    expect(Math.abs(Math.max(...fifteen.lefts) - (top.lefts[0] as number) - 6 * ch)).toBeLessThan(1.2);
  });

  test('working is set larger than the prose beside it, with room between its lines, on a desk and on a phone', async ({ page, browserName }, testInfo) => {
    for (const [width, height] of [
      [1280, 800],
      [320, 640],
    ] as const) {
      await resize(page, width, height);
      const watch = await openLesson(page, testInfo, { published: figuresPublished(['linesWorking']) });
      const id = await show(page, 'linesWorking');
      const scene = page.locator(`#${sectionId(id)}`);
      const measured = await scene.evaluate((section) => {
        const px = (el: Element | null): number => Number.parseFloat(getComputedStyle(el as Element).fontSize);
        const items = Array.from(section.querySelectorAll<HTMLElement>('.lt-lines > li'));
        const list = (section.querySelector('.lt-lines') as HTMLElement).getBoundingClientRect();
        return {
          prose: px(section.querySelector('.lt-claim p')),
          figure: px(section.querySelector('.lt-figure-desc')),
          math: Array.from(section.querySelectorAll('.lt-lines math')).map((m) => px(m)),
          digits: Array.from(section.querySelectorAll('.lt-lines mfrac mn')).map((m) => px(m)),
          lines: items.map((li) => {
            const boxes = Array.from(li.querySelectorAll('math')).map((m) => m.getBoundingClientRect());
            // Runs follow each other along a row; one that starts to the left of where the last ended has wrapped.
            const ink = { top: Math.min(...boxes.map((b) => b.top)), bottom: Math.max(...boxes.map((b) => b.bottom)), right: Math.max(...boxes.map((b) => b.right)) };
            return { top: li.getBoundingClientRect().top, bottom: li.getBoundingClientRect().bottom, ink, rows: 1 + boxes.filter((b, k) => k > 0 && b.left < (boxes[k - 1] as DOMRect).right - 1).length, runs: boxes.length, over: li.scrollWidth > li.clientWidth + 1, tab: li.getAttribute('tabindex'), cut: ink.right > list.right + 0.5 && !(li.scrollWidth > li.clientWidth + 1) };
          }),
        };
      });
      // Larger than the prose, which is itself larger than the rest of the figure. That goes for the digits of a fraction too.
      expect(measured.figure, `${width}px`).toBeLessThan(measured.prose);
      for (const size of [...measured.math, ...measured.digits]) expect(size, `${width}px`).toBeGreaterThan(measured.prose + 0.9);
      expect(measured.digits.length).toBeGreaterThan(8);
      // Room between one line and the next: the ink of two lines is never closer than half a line of prose.
      for (let i = 1; i < measured.lines.length; i++) {
        const gap = (measured.lines[i] as (typeof measured.lines)[number]).ink.top - (measured.lines[i - 1] as (typeof measured.lines)[number]).ink.bottom;
        expect(gap, `${width}px: between lines ${i} and ${i + 1}`).toBeGreaterThanOrEqual(measured.prose * 0.5);
      }
      // No line is cut off: it fits, or it wraps at a relation sign, or it scrolls and can be reached.
      expect(measured.lines.filter((l) => l.cut), `${width}px`).toEqual([]);
      for (const [i, line] of measured.lines.entries()) expect(line.tab, `${width}px: line ${i + 1}`).toBe(line.over ? '0' : null);
      if (width === 1280) {
        // On a desk every line is one row and nothing scrolls.
        expect(measured.lines.map((l) => l.rows)).toEqual([1, 1, 1, 1, 1, 1]);
        expect(measured.lines.some((l) => l.over)).toBe(false);
      } else {
        // On a phone the long lines wrap before their "=" or "≈"...
        expect(measured.lines.map((l) => l.rows).slice(0, 4)).toEqual([2, 1, 2, 1]);
        // ...and the one run that is wider than the column scrolls inside its own line, from the keyboard too.
        const long = scene.locator('.lt-lines > li').nth(4);
        expect((measured.lines[4] as (typeof measured.lines)[number]).over).toBe(true);
        await expect(long).toHaveAttribute('tabindex', '0');
        await long.focus();
        await page.keyboard.press('ArrowRight');
        await expect.poll(() => long.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
        await page.keyboard.press('ArrowLeft');
        await expect.poll(() => long.evaluate((el) => el.scrollLeft)).toBe(0);
        const found = await spill(page, id);
        expect(found.page).toBeLessThanOrEqual(320);
      }
      await expectClean(watch, browserName);
    }
    // Back on a desk, the line that scrolled is an ordinary line again: nothing to tab to.
    await resize(page, 1280, 800);
    await expect(page.locator('.lt-lines > li[tabindex]')).toHaveCount(0);
  });

  test('a comparison is a table on a desk and a card per row on a phone, and is a table to a screen reader in both', async ({ page }, testInfo) => {
    await resize(page, 1280, 800);
    await openLesson(page, testInfo, { published: figuresPublished(['compare4x8', 'ex-compare']) });
    const scene = page.locator(`#${sectionId(await show(page, 'compare4x8'))}`);
    const display = (): Promise<string[]> => scene.locator('table, thead, tbody tr, tbody td').evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).display))]);
    expect(await display()).toEqual(['table', 'table-header-group', 'table-row', 'table-cell']);
    await expect(scene.locator('.lt-cell-column').first()).toBeHidden();
    const roles = async (): Promise<void> => {
      await expect(scene.getByRole('table')).toHaveCount(1);
      await expect(scene.getByRole('row')).toHaveCount(9);
      await expect(scene.getByRole('columnheader')).toHaveCount(5);
      await expect(scene.getByRole('rowheader')).toHaveCount(8);
      await expect(scene.getByRole('cell')).toHaveCount(32);
      await expect(scene.getByRole('rowheader', { name: 'Keeps an order' })).toHaveCount(1);
    };
    await roles();

    await resize(page, 320, 640);
    await expect.poll(async () => (await display()).includes('table')).toBe(false);
    // Each value is now labelled with its column, since the header row is out of sight.
    await expect(scene.locator('.lt-cell-column').first()).toBeVisible();
    await expect(scene.locator('.lt-cell-column').first()).toHaveText('Array');
    expect((await scene.locator('thead').boundingBox())?.width).toBeLessThanOrEqual(1);
    await roles();
    const wrap = scene.locator('.lt-table-wrap');
    expect(await wrap.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });

  test('layers are a stack and a timeline is a rail, in the order given', async ({ page }, testInfo) => {
    await resize(page, 320, 640);
    await openLesson(page, testInfo, { published: figuresPublished(['layers8', 'timeline10']) });
    const layers = page.locator(`#${sectionId(await show(page, 'layers8'))} .lt-layer`);
    await expect(layers).toHaveCount(8);
    const boxes = await layers.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })));
    for (let i = 1; i < boxes.length; i++) {
      // Stacked with nothing between: each layer starts where the one above ends, and all are the same width.
      expect(Math.abs((boxes[i] as { top: number }).top - (boxes[i - 1] as { bottom: number }).bottom)).toBeLessThan(1);
      expect((boxes[i] as { left: number }).left).toBe((boxes[0] as { left: number }).left);
      expect((boxes[i] as { right: number }).right).toBe((boxes[0] as { right: number }).right);
    }
    const events = page.locator(`#${sectionId(await show(page, 'timeline10'))} .lt-event`);
    await expect(events).toHaveCount(10);
    const tops = await events.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    await expect(events.nth(3)).toContainText('1 January 1983');
    await expect(events.nth(3).locator('.lt-event-when')).toBeVisible();
  });
});

test('a figure the player cannot draw stays the list or table it was rendered as, and the rest are still drawn', async ({ page, browserName }, testInfo) => {
  // None of these would pass validation. The player is the last thing between a damaged lesson and the reader.
  const published = figuresPublished(['ex-flow', 'ex-sequence', 'ex-chart', 'chartBar1', 'flowRing']);
  const figureOf = (name: string): Record<string, unknown> => (published.lesson.scenes.find((s) => s.id === sceneIdFor(name)) as unknown as { figure: Record<string, unknown> }).figure;
  // A connection to a node that does not exist, and one from a node to itself.
  (figureOf('ex-flow').edges as { id: string; from: string; to: string; label?: string }[]).push({ id: 'ghost', from: 'compare', to: 'nowhere', label: 'lost' }, { id: 'self', from: 'middle', to: 'middle', label: 'again' });
  // A message to a participant the figure does not have.
  (figureOf('ex-sequence').messages as { to: string }[])[1] = { ...(figureOf('ex-sequence').messages as { to: string }[])[1], to: 'nobody' } as { to: string };
  // A value that is not a number, and a series with a value missing.
  ((figureOf('ex-chart').series as { values: unknown[] }[])[0] as { values: unknown[] }).values[1] = 'many';
  ((figureOf('chartBar1').series as { values: unknown[] }[])[0] as { values: unknown[] }).values.pop();

  const watch = await openLesson(page, testInfo, { published });
  const flow = await show(page, 'ex-flow');
  const shot = await flowShot(page, flow);
  // The flow is drawn; the edge to nowhere is left out of the drawing and kept in the list for a screen reader.
  expect(shot.drawn).toBe('true');
  expect(flowProblems({ ...shot, edges: shot.edges.filter((e) => e.id !== 'self' && e.id !== 'ghost') })).toEqual([]);
  expect(shot.edges.find((e) => e.id === 'ghost')?.start).toBeNull();
  await expect(page.locator(`#${sectionId(flow)} .lt-edge[data-unplaced]`)).toHaveCount(1);
  await expect(page.locator(`#${sectionId(flow)} .lt-edge[data-unplaced]`)).toContainText('Is it the target? to nowhere: lost');
  // The loop from a node to itself starts and ends on that node.
  const self = shot.edges.find((e) => e.id === 'self') as FlowShot['edges'][number];
  const middle = shot.nodes.find((n) => n.id === 'middle') as Box;
  expect(onBorder(self.start as [number, number], middle) && onBorder(self.tip as [number, number], middle)).toBe(true);

  const sequence = page.locator(`#${sectionId(await show(page, 'ex-sequence'))}`);
  await expect(sequence.locator('.lt-seq')).not.toHaveAttribute('data-drawn');
  await expect(sequence.locator('svg')).toHaveCount(0);
  await expect(sequence.locator('.lt-msg:visible')).toHaveCount(5);
  await expect(sequence.locator('.lt-msg').nth(1)).toContainText('binary_search to nobody: read the middle element');

  for (const name of ['ex-chart', 'chartBar1']) {
    const chart = page.locator(`#${sectionId(await show(page, name))}`);
    await expect(chart.locator('.lt-chart'), name).not.toHaveAttribute('data-drawn');
    await expect(chart.locator('.lt-chart-plot'), name).toHaveCount(0);
    await expect(chart.locator('details'), name).toHaveCount(0);
    await expect(chart.locator('table'), name).toBeVisible();
  }
  await expect(page.locator(`#${sectionId(sceneIdFor('ex-chart'))} tbody td`).nth(2)).toHaveText('many');

  // And an undamaged figure in the same lesson is drawn as usual.
  expect(flowProblems(await flowShot(page, await show(page, 'flowRing')))).toEqual([]);
  await expectClean(watch, browserName);
});

test.describe('scripting off', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 320, height: 640 } });

  test('every figure is a readable list or table that fits a phone', async ({ page }, testInfo) => {
    const watch = await openLesson(page, testInfo, { published: figuresPublished(names) });
    await expect(page.locator('.lt-figure:visible')).toHaveCount(names.length);
    await expect(page.locator('.lt-figure svg')).toHaveCount(0);
    await expect(page.locator('[data-drawn]')).toHaveCount(0);
    const body = await page.locator('body').boundingBox();
    expect(body && body.width <= 320).toBe(true);
    for (const figure of await page.locator('.lt-figure').all()) {
      const box = await figure.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= 320.5).toBe(true);
    }

    const flow = page.locator(`#${sectionId(sceneIdFor('ex-flow'))}`);
    await expect(flow.locator('.lt-node:visible')).toHaveCount(5);
    await expect(flow.getByText('Connections')).toBeVisible();
    await expect(flow.locator('.lt-edge:visible')).toHaveCount(5);
    await expect(flow.locator('.lt-edge').nth(2)).toHaveText('Is it the target? to Done: return its position: yes');
    const sequence = page.locator(`#${sectionId(sceneIdFor('sequence12'))}`);
    await expect(sequence.locator('.lt-msg:visible')).toHaveCount(12);
    await expect(sequence.locator('.lt-msg').nth(5)).toContainText('API gateway to Database: query orders for this user lost');
    const chart = page.locator(`#${sectionId(sceneIdFor('chartLine3'))}`);
    await expect(chart.locator('table')).toBeVisible();
    await expect(chart.locator('details')).toHaveCount(0);
    await expect(chart.getByText('Illustrative shape, not measured data')).toBeVisible();
    await expect(chart.getByRole('cell')).toHaveCount(24);
    const lines = page.locator(`#${sectionId(sceneIdFor('lines24'))}`);
    await expect(lines.locator('.lt-lines > li:visible')).toHaveCount(24);
    await expect(lines.getByText('Code written by your agent. Read it before you run it.')).toBeVisible();
    expect(watch.blocked).toEqual([]);
  });
});
