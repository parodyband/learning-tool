// setHighlight: what a step-through calls to point at parts of its figure. For every kind of part
// (node, edge, participant, message, layer, event, row, column, x position, series, line) it must
// mark exactly the parts named, say "(highlighted)" to a screen reader, and show the mark by
// something other than colour: a ring, a bar, a heavier stroke. Clearing must leave nothing behind.
import type { Page } from '@playwright/test';
import { figuresPublished, highlight, partId, sceneIdFor } from './figures-kit';
import { expect, expectClean, openLesson, sectionId, test } from './shell-kit';

const ALL = ['ex-flow', 'ex-sequence', 'ex-layers', 'ex-timeline', 'ex-compare', 'ex-chart', 'ex-lines', 'flow12', 'sequence12', 'chartBar3', 'chartStep2', 'linesMath'];

async function show(page: Page, name: string): Promise<string> {
  const id = sceneIdFor(name);
  await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), id);
  await expect(page.locator(`#${sectionId(id)}`)).toBeVisible();
  // A scene slides in over a fifth of a second. Boxes are compared before and after a mark, so wait for it to settle.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  return id;
}

/** Which parts of a scene's figure are marked, and what each says. */
function marked(page: Page, sceneId: string): Promise<{ id: string; notes: string[]; noteBox: number }[]> {
  return page.evaluate((id) => {
    const figure = Array.from(document.querySelectorAll<HTMLElement>('.lt-figure')).find((f) => f.dataset.scene === id) as HTMLElement;
    return Array.from(figure.querySelectorAll<HTMLElement>('[data-hl]')).map((part) => {
      const notes = Array.from(part.querySelectorAll<HTMLElement>('.lt-hl-note'));
      return { id: part.dataset.part ?? '', notes: notes.map((n) => n.textContent ?? ''), noteBox: Math.max(0, ...notes.map((n) => Math.max(n.getBoundingClientRect().width, n.getBoundingClientRect().height))) };
    });
  }, sceneId);
}

const style = (page: Page, selector: string, property: string, pseudo?: string): Promise<string> =>
  page
    .locator(selector)
    .first()
    .evaluate((el, [p, ps]) => getComputedStyle(el, ps || undefined).getPropertyValue(p as string), [property, pseudo ?? '']);
const part = (sceneId: string, id: string): string => `[id="${partId(sceneId, id)}"]`;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
});

test('marks exactly the parts named, of every kind, and says so in hidden text', async ({ page, browserName }, testInfo) => {
  const watch = await openLesson(page, testInfo, { published: figuresPublished(ALL) });
  const cases: [string, string[]][] = [
    ['ex-flow', ['compare', 'discard', 'no', 'again']], // nodes and edges, one of them with no label
    ['ex-flow', ['begin']],
    ['ex-sequence', ['search', 'narrow', 'value']], // a participant, a self-message, a message
    ['ex-layers', ['interval']],
    ['ex-timeline', ['c2', 'c3']],
    ['ex-compare', ['binary', 'cost']], // a column and a row
    ['ex-chart', ['n512', 'binary']], // an x position and a series
    ['ex-lines', ['l4', 'l9', 'l10']],
    ['linesMath', ['l3']],
    ['sequence12', ['m6', 'db']], // the lost message
    ['chartBar3', ['merge', 'random']],
  ];
  for (const [name, parts] of cases) {
    const id = await show(page, name);
    await highlight(page, id, parts);
    const now = await marked(page, id);
    expect(now.map((m) => m.id).sort(), name).toEqual([...parts].sort());
    for (const m of now) {
      expect(m.notes, `${name}/${m.id}`).toEqual([' (highlighted)']);
      // Present for a screen reader, and one pixel to the eye.
      expect(m.noteBox, `${name}/${m.id}`).toBeLessThanOrEqual(1.5);
    }
    for (const p of parts) await expect(page.locator(part(id, p)), `${name}/${p}`).toHaveAttribute('data-hl', 'true');
    // The same call again changes nothing: no second note.
    await highlight(page, id, parts);
    expect((await marked(page, id)).every((m) => m.notes.length === 1), name).toBe(true);
    // A new call replaces the old marks; an empty one clears them.
    await highlight(page, id, [parts[0] as string]);
    expect((await marked(page, id)).map((m) => m.id), name).toEqual([parts[0]]);
    await highlight(page, id, []);
    expect(await marked(page, id), name).toEqual([]);
    await expect(page.locator(`#${sectionId(id)} .lt-hl-note`)).toHaveCount(0);
    await expect(page.locator(`#${sectionId(id)} .lt-hl, #${sectionId(id)} .lt-hl-col`), `${name}: nothing drawn stays marked`).toHaveCount(0);
  }
  await expectClean(watch, browserName);
});

test('ignores ids the figure does not have, and never reaches into another figure', async ({ page }, testInfo) => {
  await openLesson(page, testInfo, { published: figuresPublished(['ex-flow', 'ex-lines']) });
  const id = await show(page, 'ex-flow');
  const other = sceneIdFor('ex-lines');
  await highlight(page, id, ['nope', 'l1', 'compare', '__proto__', 'constructor', '', 'figure', '_figure']);
  expect((await marked(page, id)).map((m) => m.id)).toEqual(['compare']);
  expect(await marked(page, other)).toEqual([]);
  // The figure's own furniture (its label, its popovers) is never a part.
  await expect(page.locator(`#${sectionId(id)} .lt-figure-label`)).not.toHaveAttribute('data-hl', 'true');
  await highlight(page, other, ['l2']);
  expect((await marked(page, id)).map((m) => m.id)).toEqual(['compare']);
  expect((await marked(page, other)).map((m) => m.id)).toEqual(['l2']);
});

test('is read out: the accessibility tree says which parts are highlighted', async ({ page }, testInfo) => {
  await openLesson(page, testInfo, { published: figuresPublished(['ex-flow', 'ex-compare', 'ex-lines']) });
  const flow = await show(page, 'ex-flow');
  await highlight(page, flow, ['compare', 'no']);
  const tree = await page.locator(`#${sectionId(flow)} .lt-figure`).ariaSnapshot();
  expect(tree).toContain('Is it the target? (highlighted)');
  expect(tree).toMatch(/Is it the target\? to Discard the half that cannot hold it: no \(highlighted\)/);
  expect(tree).not.toContain('Sorted list and a target (highlighted)');
  // The figure is a named group, its parts a list and its connections another.
  expect(tree).toMatch(/group "Diagram"/);
  expect(tree).toMatch(/list "Parts"/);
  expect(tree).toMatch(/list "Connections"/);

  const compare = await show(page, 'ex-compare');
  await highlight(page, compare, ['binary', 'cost']);
  const table = await page.locator(`#${sectionId(compare)} .lt-figure`).ariaSnapshot();
  expect(table).toContain('columnheader "Binary search (highlighted)"');
  expect(table).toContain('rowheader "Comparisons for n elements (highlighted)"');

  const lines = await show(page, 'ex-lines');
  await highlight(page, lines, ['l4']);
  const listing = await page.locator(`#${sectionId(lines)} .lt-figure`).ariaSnapshot();
  // The line is a code element inside its list item, and the note follows it there.
  expect(listing).toMatch(/code: mid = low \+ \(high - low\) \/\/ 2\n\s+- text: \(highlighted\)/);
  expect(listing.match(/\(highlighted\)/g)).toHaveLength(1);
});

test.describe('the mark is a shape, not only a tint', () => {
  test('boxes get a ring: nodes, participants, layers, events', async ({ page }, testInfo) => {
    await openLesson(page, testInfo, { published: figuresPublished(ALL) });
    for (const [name, id, selector] of [
      ['ex-flow', 'compare', ''],
      ['ex-sequence', 'search', ''],
      ['ex-layers', 'interval', ''],
      ['ex-timeline', 'c2', ' > .lt-event-body'],
    ] as const) {
      const scene = await show(page, name);
      const target = `${part(scene, id)}${selector}`;
      expect(await style(page, target, 'outline-style'), `${name}: before`).toBe('none');
      const before = await page.locator(target).boundingBox();
      await highlight(page, scene, [id]);
      expect(await style(page, target, 'outline-style'), name).toBe('solid');
      expect(Number.parseFloat(await style(page, target, 'outline-width')), name).toBeGreaterThanOrEqual(2);
      // Marking a part must not move it, or the connectors drawn to it would miss.
      expect(await page.locator(target).boundingBox(), `${name}: same box`).toEqual(before);
    }
  });

  test('connectors get a heavier stroke and are drawn on top: edges, messages, lifelines', async ({ page }, testInfo) => {
    await openLesson(page, testInfo, { published: figuresPublished(ALL) });
    const flow = await show(page, 'ex-flow');
    const line = (scene: string, index: number): string => `#${sectionId(scene)} .lt-conn[data-edge="${index}"] .lt-conn-line`;
    // "again" is the fifth edge and "no" the fourth; neither has been touched yet.
    expect(Number.parseFloat(await style(page, line(flow, 4), 'stroke-width'))).toBe(1.5);
    await highlight(page, flow, ['again']);
    expect(Number.parseFloat(await style(page, line(flow, 4), 'stroke-width'))).toBe(3);
    expect(Number.parseFloat(await style(page, line(flow, 3), 'stroke-width'))).toBe(1.5);
    await expect(page.locator(`#${sectionId(flow)} .lt-conn.lt-hl`)).toHaveCount(1);
    expect(await page.locator(`#${sectionId(flow)} .lt-flow-svg > .lt-conn`).last().getAttribute('data-edge')).toBe('4');
    // The dashed edge stays dashed: its meaning is not traded for the mark.
    expect(await style(page, line(flow, 4), 'stroke-dasharray')).not.toBe('none');
    // Its label on the drawing is ringed too.
    expect(await style(page, part(flow, 'again'), 'outline-style')).toBe('solid');

    const seq = await show(page, 'sequence12');
    await highlight(page, seq, ['m6', 'api']);
    expect(Number.parseFloat(await style(page, line(seq, 5), 'stroke-width'))).toBe(3);
    expect(Number.parseFloat(await style(page, line(seq, 4), 'stroke-width'))).toBe(1.5);
    expect(await style(page, `${part(seq, 'm6')} .lt-msg-text`, 'outline-style')).toBe('solid');
    const lifelines = await page.locator(`#${sectionId(seq)} .lt-seq-lifeline`).evaluateAll((els) => els.map((el) => Number.parseFloat(getComputedStyle(el).strokeWidth)));
    expect(lifelines).toEqual([1, 1, 3, 1, 1]);
  });

  test('lines of code get a bar and a bold number; rows and columns get rules', async ({ page }, testInfo) => {
    await openLesson(page, testInfo, { published: figuresPublished(ALL) });
    const lines = await show(page, 'ex-lines');
    const ground = await style(page, part(lines, 'l4'), 'border-left-color');
    const box = await page.locator(part(lines, 'l4')).boundingBox();
    await highlight(page, lines, ['l4']);
    expect(await style(page, part(lines, 'l4'), 'border-left-color')).not.toBe(ground);
    expect(await style(page, part(lines, 'l5'), 'border-left-color')).toBe(ground);
    expect(Number.parseFloat(await style(page, part(lines, 'l4'), 'border-left-width'))).toBe(3);
    expect(Number.parseInt(await style(page, part(lines, 'l4'), 'font-weight', '::before'), 10)).toBeGreaterThanOrEqual(700);
    expect(Number.parseInt(await style(page, part(lines, 'l5'), 'font-weight', '::before'), 10)).toBeLessThan(700);
    expect(await page.locator(part(lines, 'l4')).boundingBox()).toEqual(box);

    const compare = await show(page, 'ex-compare');
    await highlight(page, compare, ['binary', 'cost']);
    // The column: its header and every cell under it, and no cell of the other column.
    const scene = page.locator(`#${sectionId(compare)}`);
    await expect(scene.locator('td.lt-hl-col')).toHaveCount(2);
    expect(await scene.locator('tbody tr').evaluateAll((rows) => rows.map((row) => Array.from(row.querySelectorAll('td')).map((td) => td.classList.contains('lt-hl-col'))))).toEqual([
      [false, true],
      [false, true],
    ]);
    expect(Number.parseFloat(await style(page, `#${sectionId(compare)} td.lt-hl-col`, 'border-left-width'))).toBe(2);
    expect(Number.parseFloat(await style(page, `${part(compare, 'cost')} > th`, 'border-top-width'))).toBe(2);
    expect(Number.parseFloat(await style(page, `${part(compare, 'sorted')} > th`, 'border-top-width'))).toBeLessThan(2);
  });

  test('a chart marks an x position with a band, a boxed label and its values in words, and a series with a heavier line', async ({ page }, testInfo) => {
    await openLesson(page, testInfo, { published: figuresPublished(ALL) });
    const chart = await show(page, 'ex-chart');
    const scene = page.locator(`#${sectionId(chart)}`);
    await expect(scene.locator('.lt-chart-band')).toHaveCount(0);
    await expect(scene.locator('.lt-chart-readout')).toBeHidden();
    await highlight(page, chart, ['n512']);
    await expect(scene.locator('.lt-chart-band')).toHaveCount(1);
    await expect(scene.locator('.lt-chart-xtick.lt-hl')).toHaveText('512');
    expect(await style(page, `#${sectionId(chart)} .lt-chart-xtick.lt-hl`, 'outline-style')).toBe('solid');
    // What the plot shows at that position, for anyone who cannot or does not read it off the plot.
    await expect(scene.locator('.lt-chart-readout')).toBeVisible();
    await expect(scene.locator('.lt-chart-readout')).toHaveText('512: Linear search 512, Binary search 10');
    expect(await scene.locator('.lt-chart-readout').evaluate((el) => el.closest('[aria-hidden]'))).toBeNull();
    await expect(scene.locator('.lt-chart-frame > svg > .lt-chart-dot.lt-hl')).toHaveCount(2);

    await highlight(page, chart, ['binary']);
    await expect(scene.locator('.lt-chart-band')).toHaveCount(0);
    await expect(scene.locator('.lt-chart-readout')).toBeHidden();
    const widths = await scene.locator('.lt-chart-frame > svg > .lt-chart-line').evaluateAll((els) => els.map((el) => Number.parseFloat(getComputedStyle(el).strokeWidth)));
    expect(widths).toEqual([2, 4]);
    await expect(scene.locator('.lt-chart-end.lt-hl')).toHaveText('Binary search');
    expect(await style(page, `#${sectionId(chart)} .lt-chart-end.lt-hl`, 'text-decoration-line')).toBe('underline');
    // The table says the same, for a reader who opens it.
    await scene.locator('details.lt-chart-table > summary').click();
    await expect(scene.getByRole('columnheader', { name: 'Binary search (highlighted)' })).toBeVisible();

    const bars = await show(page, 'chartBar3');
    const barScene = page.locator(`#${sectionId(bars)}`);
    await highlight(page, bars, ['merge', 'random']);
    // Three bars at "Merge sort" and five in the "Random order" series, one of them both.
    await expect(barScene.locator('.lt-chart-frame > svg > .lt-chart-bar.lt-hl')).toHaveCount(7);
    await expect(barScene.locator('.lt-chart-readout')).toHaveText('Merge sort: Already sorted 5,044, Random order 8,704, Reversed 4,932');
    await expect(barScene.locator('.lt-chart-key.lt-hl')).toHaveText('Random order');
  });

  test('a mark made while a scene is out of sight is there when the scene is shown', async ({ page }, testInfo) => {
    await openLesson(page, testInfo, { published: figuresPublished(['ex-chart', 'ex-flow']) });
    await show(page, 'ex-chart');
    const flow = sceneIdFor('ex-flow');
    await highlight(page, flow, ['compare', 'again']);
    await highlight(page, sceneIdFor('ex-chart'), ['n64']);
    await show(page, 'ex-flow');
    await expect(page.locator(`#${sectionId(flow)} .lt-conn.lt-hl`)).toHaveCount(1);
    expect(await style(page, part(flow, 'compare'), 'outline-style')).toBe('solid');
    await show(page, 'ex-chart');
    await expect(page.locator(`#${sectionId(sceneIdFor('ex-chart'))} .lt-chart-band`)).toHaveCount(1);
  });
});

test.describe('in forced colours', () => {
  test.use({ forcedColors: 'active' });

  test('tints are gone, and every mark still shows as a ring, a rule or a heavier stroke', async ({ page }, testInfo) => {
    await openLesson(page, testInfo, { published: figuresPublished(ALL) });
    const flow = await show(page, 'ex-flow');
    const plainGround = await style(page, part(flow, 'start'), 'background-color');
    await highlight(page, flow, ['compare', 'again']);
    // The tint has been taken away by the system: the highlighted node has the same ground as any other.
    expect(await style(page, part(flow, 'compare'), 'background-color')).toBe(plainGround);
    expect(await style(page, part(flow, 'compare'), 'outline-style')).toBe('solid');
    expect(Number.parseFloat(await style(page, part(flow, 'compare'), 'outline-width'))).toBe(3);
    const line = `#${sectionId(flow)} .lt-conn[data-edge="4"] .lt-conn-line`;
    expect(Number.parseFloat(await style(page, line, 'stroke-width'))).toBe(3);
    // Connectors are drawn in the system's text colour, not left in a colour the theme may hide.
    const plain = await style(page, `#${sectionId(flow)} .lt-conn[data-edge="0"] .lt-conn-line`, 'stroke');
    expect(plain).toBe(await style(page, part(flow, 'start'), 'color'));
    expect(await style(page, line, 'stroke')).not.toBe(plain);

    const lines = await show(page, 'ex-lines');
    await highlight(page, lines, ['l4']);
    expect(await style(page, part(lines, 'l4'), 'outline-style')).toBe('solid');
    expect(await style(page, part(lines, 'l5'), 'outline-style')).toBe('none');
    expect(await style(page, part(lines, 'l4'), 'border-left-style')).toBe('double');

    const bars = await show(page, 'chartBar3');
    await highlight(page, bars, ['merge']);
    const strokes = await page.locator(`#${sectionId(bars)} .lt-chart-frame > svg > .lt-chart-bar`).evaluateAll((els) => els.map((el) => [el.classList.contains('lt-hl'), Number.parseFloat(getComputedStyle(el).strokeWidth)]));
    expect(strokes.filter(([on]) => on).every(([, w]) => w === 3)).toBe(true);
    expect(strokes.filter(([on]) => !on).every(([, w]) => (w as number) < 3)).toBe(true);
    expect(strokes.filter(([on]) => on)).toHaveLength(3);
  });
});
