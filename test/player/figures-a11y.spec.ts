// axe-core over every figure, drawn and as rendered, in the states a figure can be in: plain,
// with parts highlighted, with a chart's data table unfolded, at phone width, in the dark theme and
// with more contrast asked for. Held to the shell's standard: a contrast result axe cannot decide
// is a failure, which is why no text in a figure may lie on top of an SVG without a ground of its own.
//
// axe has no rule for reflow or for "not colour alone"; figures-layout.spec.ts and
// figures-highlight.spec.ts cover those.
import AxeBuilder from '@axe-core/playwright';
import { ALL_FIGURES, contrastOf, figuresPublished, highlight, sceneIdFor, undecidedContrast } from './figures-kit';
import { expect, expectClean, openLesson, sectionId, test } from './shell-kit';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const names = [...ALL_FIGURES.keys()];

type P = import('@playwright/test').Page;

async function audit(page: P, state: string): Promise<void> {
  // A scene fades in. Measured halfway through, its text has less contrast than it will have.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const violations = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(violations, `${state}: violations`).toEqual([]);
  // A math operator on its own is the one thing axe cannot decide that is decided for it, by measuring. See figures-kit.ts.
  expect(await undecidedContrast(page, results), `${state}: contrast axe could not decide`).toEqual([]);
  expect(results.passes.length, `${state}: rules that ran`).toBeGreaterThan(20);
}

async function show(page: P, name: string): Promise<string> {
  const id = sceneIdFor(name);
  await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), id);
  await expect(page.locator(`#${sectionId(id)}`)).toBeVisible();
  return id;
}

/** Parts to highlight in each figure: at least one of every kind of part it has. */
const MARKS: Record<string, string[]> = {
  'ex-flow': ['compare', 'no', 'again'],
  'ex-sequence': ['search', 'narrow', 'value'],
  'ex-layers': ['interval'],
  'ex-timeline': ['c2'],
  'ex-compare': ['binary', 'cost'],
  'ex-chart': ['n512', 'binary'],
  'ex-lines': ['l4', 'l9'],
  flow12: ['review', 'e-redo', 'e-hot', 'e-lb'],
  flowRing: ['precip', 'r6', 'r3'],
  sequence12: ['api', 'm6', 'm7'],
  chartBar3: ['merge', 'random'],
  chartBarNeg: ['q2', 'p99'],
  chartStep2: ['h8', 'jobs'],
  chartLine3: ['x6', 'cached'],
  flowRing10: ['wait', 'again', 'd'],
  chartLineNarrow: ['d3', 'idx'],
  linesMath: ['l3'],
  linesWorking: ['l2', 'l6'],
  linesText: ['l2'],
};

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('every figure passes, plain and with parts highlighted', async ({ page, browserName }, testInfo) => {
      // Two audits of the whole page for each of some two dozen figures: about a second each, more when other suites share the machine.
      test.setTimeout(240_000);
      const watch = await openLesson(page, testInfo, { published: figuresPublished(names) });
      for (const name of names) {
        const id = await show(page, name);
        await audit(page, `${name}`);
        const marks = MARKS[name];
        if (!marks) continue;
        await highlight(page, id, marks);
        await expect(page.locator(`#${sectionId(id)} [data-hl="true"]`)).toHaveCount(marks.length);
        await audit(page, `${name}, highlighted`);
      }
      await expectClean(watch, browserName);
    });
  });
}

test.describe('at 320 pixels wide', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test('every figure passes, plain and with parts highlighted', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await openLesson(page, testInfo, { published: figuresPublished(names) });
    for (const name of names) {
      const id = await show(page, name);
      await audit(page, `320px ${name}`);
      const marks = MARKS[name];
      if (!marks) continue;
      await highlight(page, id, marks);
      await audit(page, `320px ${name}, highlighted`);
    }
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('a math operator on its own has the ink and the contrast of the digits beside it, plain and highlighted', async ({ page }, testInfo) => {
      // The measurement behind the one exception the audits above make. `x = -5` is the case from the
      // review: its minus sign is an element of its own, which axe will not judge.
      await openLesson(page, testInfo, { published: figuresPublished(['linesWorking', 'linesMath', 'ex-compare']) });
      for (const [name, marks] of [
        ['linesWorking', ['l6']],
        ['linesMath', ['l2']],
      ] as const) {
        const id = await show(page, name);
        const section = `#${sectionId(id)}`;
        for (const state of ['plain', 'highlighted']) {
          if (state === 'highlighted') await highlight(page, id, marks);
          const count = await page.locator(`${section} .lt-lines mo`).count();
          expect(count, `${name}: operators`).toBeGreaterThan(5);
          const selectors = await page.locator(`${section} .lt-lines li`).evaluateAll((items) =>
            items.flatMap((li) => Array.from(li.querySelectorAll('mo, mn')).map((el) => {
              // A selector for this one element: its place among the elements of its line.
              const path: string[] = [];
              for (let up: Element = el; up !== li; up = up.parentElement as Element) path.unshift(`${up.localName}:nth-child(${Array.from((up.parentElement as Element).children).indexOf(up) + 1})`);
              return { selector: `[id="${li.id}"] > ${path.join(' > ')}`, kind: el.localName };
            })),
          );
          const measured = await contrastOf(page, selectors.map((x) => x.selector));
          const ratios = { mo: [] as number[], mn: [] as number[] };
          measured.forEach((m, i) => {
            expect(m, selectors[i]?.selector).not.toBeNull();
            if (!m) return;
            expect(m.inherited, `${name}, ${state}: ${selectors[i]?.selector} is in the ink of its formula`).toBe(true);
            expect(m.ratio, `${name}, ${state}: ${selectors[i]?.selector}`).toBeGreaterThanOrEqual(7);
            ratios[(selectors[i] as { kind: 'mo' | 'mn' }).kind].push(Math.round(m.ratio * 100) / 100);
          });
          // The operators and the digits are in one ink on one ground: the same numbers, line for line.
          expect(new Set(ratios.mo).size).toBeLessThanOrEqual(2);
          expect([...new Set(ratios.mo)].sort()).toEqual([...new Set(ratios.mn)].sort());
        }
      }
    });
  });
}

test('a line of working that scrolls on a phone can be reached from the keyboard, and one that fits is not a tab stop', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openLesson(page, testInfo, { published: figuresPublished(['linesWorking']) });
  const id = await show(page, 'linesWorking');
  const lines = page.locator(`#${sectionId(id)} .lt-lines > li`);
  await expect(lines.nth(4)).toHaveAttribute('tabindex', '0');
  await expect(page.locator(`#${sectionId(id)} .lt-lines > li[tabindex]`)).toHaveCount(1);
  // A scene fades in. Measured halfway through, its text has less contrast than it will have.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const results = await new AxeBuilder({ page }).include('.lt-figure').withTags(TAGS).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  expect(results.passes.map((r) => r.id)).toContain('scrollable-region-focusable');
  // Focus shows on the line itself.
  await lines.nth(4).focus();
  expect(await lines.nth(4).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
});

test('a chart passes with its data table unfolded and a row and a column highlighted', async ({ page }, testInfo) => {
  await openLesson(page, testInfo, { published: figuresPublished(['ex-chart', 'chartBar3']) });
  for (const [name, marks] of [
    ['ex-chart', ['n512', 'binary']],
    ['chartBar3', ['merge', 'random']],
  ] as const) {
    const id = await show(page, name);
    await page.locator(`#${sectionId(id)} details.lt-chart-table > summary`).click();
    await expect(page.locator(`#${sectionId(id)} table.lt-chart-table`)).toBeVisible();
    await audit(page, `${name}, table open`);
    await highlight(page, id, marks);
    await audit(page, `${name}, table open, highlighted`);
  }
});

test.describe('with more contrast asked for', () => {
  test.use({ contrast: 'more' });
  test('one figure of each type passes', async ({ page }, testInfo) => {
    const examples = names.filter((n) => n.startsWith('ex-'));
    await openLesson(page, testInfo, { published: figuresPublished(examples) });
    for (const name of examples) {
      const id = await show(page, name);
      await highlight(page, id, MARKS[name] ?? []);
      await audit(page, `more contrast, ${name}`);
    }
  });
});

test('a flow that has to scroll sideways passes as a focusable, named region', async ({ page }, testInfo) => {
  // Narrower than the page itself promises to fit, so only the figure is audited.
  await page.setViewportSize({ width: 220, height: 640 });
  await openLesson(page, testInfo, { published: figuresPublished(['flow12']) });
  const id = await show(page, 'flow12');
  await expect(page.locator(`#${sectionId(id)} .lt-flow`)).toHaveAttribute('data-scroll', 'true');
  await highlight(page, id, ['review', 'e-redo']);
  const results = await new AxeBuilder({ page }).include('.lt-figure').withTags(TAGS).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  expect(results.incomplete.filter((r) => r.id === 'color-contrast').flatMap((r) => r.nodes.map((n) => n.target.join(' ')))).toEqual([]);
  expect(results.passes.map((r) => r.id)).toContain('scrollable-region-focusable');
});

test('every figure passes as rendered, with no player', async ({ page }, testInfo) => {
  // axe is itself a script, so scripting stays on and the player is taken out of the document instead.
  await openLesson(page, testInfo, { published: figuresPublished(names), mutate: (html) => html.replace(/<script>[\s\S]*?<\/script>/, '') });
  await expect(page.locator('html')).not.toHaveClass(/lt-js/);
  await expect(page.locator('.lt-figure:visible')).toHaveCount(names.length);
  await expect(page.locator('.lt-figure svg')).toHaveCount(0);
  await audit(page, 'as rendered');
});

test('a figure in a lesson in another language passes: interface words are marked as English', async ({ page }, testInfo) => {
  const published = figuresPublished(['ex-flow', 'ex-sequence', 'ex-chart', 'ex-lines']);
  published.lesson.language = 'pt-BR';
  await openLesson(page, testInfo, { published });
  for (const name of ['ex-flow', 'ex-sequence', 'ex-chart', 'ex-lines']) {
    const id = await show(page, name);
    await highlight(page, id, MARKS[name] ?? []);
    await audit(page, `pt-BR ${name}`);
    await expect(page.locator(`#${sectionId(id)} .lt-hl-note`).first()).toHaveAttribute('lang', 'en');
  }
});
