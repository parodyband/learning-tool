// Layout and theming: reflow at 320 pixels, text-spacing overrides, the reading measure, the two
// column layout, light and dark with the manual switch, reduced motion, more contrast, forced
// colours, target sizes, and print.
import type { Locator } from '@playwright/test';
import { examplePublished } from '../helpers/example';
import { LONG_TOPICS, exampleScenes, expect, expectClean, openLesson, sectionId, test, withLongTopics } from './shell-kit';

const example = exampleScenes();
const lesson = examplePublished().lesson;
const wide = lesson.scenes.filter((s) => s.kind === 'step_through' || (s.kind === 'narration' && s.figure)).map((s) => s.id);

type P = import('@playwright/test').Page;
const show = async (page: P, id: string): Promise<void> => {
  await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), id);
  await expect(page.locator(`#${sectionId(id)}`)).toBeVisible();
};
const rgb = (page: P, selector: string, property: string): Promise<string> => page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

test.describe('at 320 by 640', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('no scene scrolls sideways, also with text spacing increased', async ({ page, browserName }, testInfo) => {
    const watch = await openLesson(page, testInfo);
    const widths = async (): Promise<Record<string, number>> => {
      const out: Record<string, number> = {};
      for (const id of example.ids) {
        await show(page, id);
        out[id] = await page.evaluate(() => document.documentElement.scrollWidth);
      }
      return out;
    };
    for (const [id, w] of Object.entries(await widths())) expect(w, `scene ${id}`).toBeLessThanOrEqual(320);

    // WCAG 1.4.12: line height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing 0.16em.
    // The page's policy refuses an injected <style>, so the override goes in as a constructed sheet.
    await page.evaluate(() => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    });
    for (const [id, w] of Object.entries(await widths())) expect(w, `scene ${id} with text spacing`).toBeLessThanOrEqual(320);

    // Overlays too.
    await show(page, example.first);
    await page.locator('#lt-opensources').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const box = await page.locator('dialog#lt-sources').boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 320).toBe(true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Contents' }).click();
    const nav = await page.locator('#lt-contents').boundingBox();
    expect(nav && nav.x >= 0 && nav.x + nav.width <= 320).toBe(true);
    await expectClean(watch, browserName);
  });

  // Review finding P8. The request is a flex item, which will not shrink below its longest word
  // by itself, so one long compound pushed the page to 535 pixels.
  test('a follow-up topic that is one long word wraps inside its box', async ({ page, browserName }, testInfo) => {
    const watch = await openLesson(page, testInfo, { published: withLongTopics(), hash: `#/${example.last}` });
    await expect(page.locator(`#${sectionId(example.last)}`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const requests = page.locator('.lt-request-text');
    await expect(requests).toHaveCount(LONG_TOPICS.length);
    for (const [i, topic] of LONG_TOPICS.entries()) {
      const request = requests.nth(i);
      await expect(request).toHaveText(`Teach me ${topic} with Learning Tool`);
      const box = await request.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= 320, `request ${i + 1} is inside the page`).toBe(true);
      // Wrapped, not clipped: every character is laid out inside the box.
      expect(await request.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(box && box.height).toBeGreaterThan(40);
      // The whole request is still selected in one go, and its button copies all of it.
      expect(await request.evaluate((el) => getComputedStyle(el).userSelect)).toBe('all');
    }
    await page.locator('.lt-request button[data-copy]').first().click();
    await expect.poll(() => page.evaluate(() => window.__ltCopied?.at(-1)?.text)).toBe(`Teach me ${LONG_TOPICS[0]} with Learning Tool`);
    await expectClean(watch, browserName);
  });

  test('the header fits: tools on one line, and the title is still the page’s h1', async ({ page }, testInfo) => {
    await openLesson(page, testInfo);
    const tools = await page.locator('.lt-tools').boundingBox();
    expect(tools && tools.height < 60 && tools.x >= 0 && tools.x + tools.width <= 320).toBe(true);
    await expect(page.locator('h1')).toBeVisible();
    await page.locator('#lt-next').click();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(lesson.title);
  });

  test('a scene with a figure stacks: text, then figure, each the full width', async ({ page }, testInfo) => {
    await openLesson(page, testInfo);
    for (const id of wide) {
      await show(page, id);
      const text = await page.locator(`#${sectionId(id)} .lt-text-col`).boundingBox();
      const figure = await page.locator(`#${sectionId(id)} .lt-figure-col`).boundingBox();
      expect(text && figure).toBeTruthy();
      if (!text || !figure) continue;
      expect(Math.abs(text.x - figure.x)).toBeLessThan(1);
      expect(Math.abs(text.width - figure.width)).toBeLessThan(1);
      expect(text.width).toBeGreaterThan(280);
    }
  });
});

test.describe('at 1280 wide', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('prose is set at about 18px with 1.6 line height on a measure of about 66 characters', async ({ page }, testInfo) => {
    await openLesson(page, testInfo);
    const p = page.locator(`#${sectionId(example.first)} .lt-claim p`).first();
    const style = await p.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { size: Number.parseFloat(cs.fontSize), leading: Number.parseFloat(cs.lineHeight), family: cs.fontFamily, width: el.getBoundingClientRect().width };
    });
    expect(style.size).toBe(18);
    expect(style.leading / style.size).toBeCloseTo(1.6, 1);
    expect(style.family).toMatch(/Charter/);
    // Characters per line, measured on a long run of ordinary prose set in the same column.
    const perLine = await p.evaluate((el) => {
      const probe = document.createElement('p');
      probe.textContent = 'Binary search compares the target with the middle element and discards the half that cannot contain it. '.repeat(12);
      el.parentElement?.append(probe);
      const range = document.createRange();
      range.selectNodeContents(probe);
      const lines = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
      const chars = probe.textContent.length;
      probe.remove();
      return chars / lines;
    });
    expect(perLine).toBeGreaterThan(58);
    expect(perLine).toBeLessThan(76);
  });

  test('a scene with a figure sets text and figure side by side; a scene without is one centred column', async ({ page }, testInfo) => {
    await openLesson(page, testInfo);
    expect(wide.length).toBeGreaterThan(0);
    for (const id of wide) {
      await show(page, id);
      await expect(page.locator('html')).toHaveClass(/lt-wide/);
      const text = await page.locator(`#${sectionId(id)} .lt-text-col`).boundingBox();
      const figure = await page.locator(`#${sectionId(id)} .lt-figure-col`).boundingBox();
      expect(text && figure).toBeTruthy();
      if (!text || !figure) continue;
      expect(figure.x).toBeGreaterThan(text.x + text.width);
      expect(Math.abs(figure.y - text.y)).toBeLessThan(2);
      expect(text.width).toBeGreaterThan(380);
      expect(figure.width).toBeGreaterThan(text.width);
    }
    await show(page, example.first);
    await expect(page.locator('html')).not.toHaveClass(/lt-wide/);
    const column = await page.locator(`#${sectionId(example.first)}`).boundingBox();
    expect(column).toBeTruthy();
    if (column) expect(Math.abs(column.x + column.width / 2 - 640)).toBeLessThan(2);
  });

  test('every control is at least 24 by 24 CSS pixels, in every scene', async ({ page }, testInfo) => {
    await openLesson(page, testInfo);
    for (const id of example.ids) {
      await show(page, id);
      const small = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, summary, textarea'))
          .filter((el) => el.offsetParent !== null && !el.closest('[popover]:not(:popover-open)') && !el.classList.contains('lt-skip'))
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          // A link in a sentence is exempt (WCAG 2.5.8); block-level links and every control are not.
          .filter(({ el, r }) => (r.width < 24 || r.height < 24) && !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
          .map(({ el, r }) => `${el.tagName}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`),
      );
      expect(small, `scene ${id}`).toEqual([]);
    }
  });
});

test.describe('theme', () => {
  for (const system of ['light', 'dark'] as const) {
    test(`follows a ${system} system, and the switch overrides it and is remembered`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ colorScheme: system });
      const page = await context.newPage();
      await openLesson(page, testInfo);
      const other = system === 'light' ? 'dark' : 'light';
      const before = await rgb(page, 'body', 'background-color');
      const ink = await rgb(page, 'body', 'color');
      expect(before).not.toBe(ink);
      await expect(page.locator('html')).not.toHaveAttribute('data-theme');
      const button = page.locator('#lt-theme');
      await expect(button).toHaveAccessibleName(`Use the ${other} theme`);

      await button.click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', other);
      await expect(button).toHaveAccessibleName(`Use the ${system} theme`);
      const after = await rgb(page, 'body', 'background-color');
      expect(after).not.toBe(before);
      await expect(page.locator('#lt-live')).toHaveText(other === 'dark' ? 'Dark theme on.' : 'Light theme on.');

      // The override matches what the other system setting would have given.
      const reference = await browser.newContext({ colorScheme: other });
      const refPage = await reference.newPage();
      await openLesson(refPage, testInfo);
      expect(after).toBe(await rgb(refPage, 'body', 'background-color'));
      await reference.close();

      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', other);
      expect(await rgb(page, 'body', 'background-color')).toBe(after);
      await page.locator('#lt-theme').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', system);
      expect(await rgb(page, 'body', 'background-color')).toBe(before);
      await context.close();
    });
  }
});

test.describe('motion', () => {
  test('a scene fades in when motion is welcome', async ({ browser }, testInfo) => {
    const context = await browser.newContext({ reducedMotion: 'no-preference' });
    const page = await context.newPage();
    await openLesson(page, testInfo);
    expect(await rgb(page, `#${sectionId(example.first)}`, 'animation-name')).toBe('lt-arrive');
    await context.close();
  });
  test('nothing animates or transitions when reduced motion is asked for', async ({ browser }, testInfo) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await openLesson(page, testInfo);
    expect(await rgb(page, `#${sectionId(example.first)}`, 'animation-name')).toBe('none');
    for (const selector of ['#lt-next', '.lt-chip', '.lt-tool', '.lt-skip']) expect(await rgb(page, selector, 'transition-duration'), selector).toBe('0s');
    await context.close();
  });
});

test('more contrast: text is pure black on pure white, and lines are as strong as text', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ contrast: 'more', colorScheme: 'light' });
  const page = await context.newPage();
  await openLesson(page, testInfo);
  expect(await rgb(page, 'body', 'color')).toBe('rgb(0, 0, 0)');
  expect(await rgb(page, 'body', 'background-color')).toBe('rgb(255, 255, 255)');
  expect(await rgb(page, '.lt-chip', 'border-top-color')).toBe('rgb(0, 0, 0)');
  await context.close();
});

test('forced colours: the page takes the system colours and keeps its non-colour cues', async ({ browser, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'forced-colors emulation is a Chromium feature');
  const context = await browser.newContext({ forcedColors: 'active' });
  const page = await context.newPage();
  const watch = await openLesson(page, testInfo);
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
  await page.locator('#lt-next').click();
  // The rail no longer has fills, so each segment is a line, and the current one is a different system colour.
  const rail = await page.evaluate(() => Array.from(document.querySelectorAll('.lt-rail li')).map((li) => getComputedStyle(li).borderTopWidth + ' ' + getComputedStyle(li).borderTopColor));
  expect(rail.every((r) => r.startsWith('3px'))).toBe(true);
  expect(new Set(rail).size).toBeGreaterThanOrEqual(2);
  // Chips, buttons and notes keep a border.
  await page.goBack();
  for (const selector of ['.lt-chip', '#lt-next', '#lt-back', '.lt-note']) expect(await rgb(page, selector, 'border-top-style'), selector).not.toBe('none');
  await expectClean(watch, browserName);
  await context.close();
});

/**
 * What a button's label looks like in a screenshot: how much of the label's area is drawn in the
 * text colour, how much in the commonest other colour (the ground the letters sit on), what that
 * colour is, and the contrast between the two. Computed styles cannot answer this in forced
 * colours: the browser paints its own plate behind text, and the plate is in no property.
 */
async function labelInk(button: Locator): Promise<{ text: number; ground: number; groundColour: string; contrast: number }> {
  await button.scrollIntoViewIfNeeded();
  const png = (await button.screenshot({ animations: 'disabled' })).toString('base64');
  return button.evaluate(async (el, data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    g.drawImage(image, 0, 0);
    const label = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '') as Text;
    const range = document.createRange();
    range.selectNodeContents(label);
    const words = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const scale = image.width / box.width;
    const pixels = g.getImageData(Math.round((words.left - box.left) * scale), Math.round((words.top - box.top) * scale), Math.round(words.width * scale), Math.round(words.height * scale)).data;
    const ink = (getComputedStyle(el).color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number) as [number, number, number];
    const counts = new Map<string, number>();
    let text = 0;
    for (let at = 0; at < pixels.length; at += 4) {
      const [r, gr, b] = [pixels[at] as number, pixels[at + 1] as number, pixels[at + 2] as number];
      if (Math.abs(r - ink[0]) + Math.abs(gr - ink[1]) + Math.abs(b - ink[2]) < 60) text++;
      else counts.set(`${r},${gr},${b}`, (counts.get(`${r},${gr},${b}`) ?? 0) + 1);
    }
    const [groundColour, ground] = Array.from(counts).sort((x, y) => y[1] - x[1])[0] ?? ['', 0];
    const luminance = (c: number[]): number => {
      const [r, gr, b] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)) as [number, number, number];
      return 0.2126 * r + 0.7152 * gr + 0.0722 * b;
    };
    const [hi, lo] = [luminance(ink), luminance(groundColour ? groundColour.split(',').map(Number) : ink)].sort((x, y) => y - x) as [number, number];
    const total = pixels.length / 4;
    return { text: text / total, ground: ground / total, groundColour: `rgb(${groundColour.split(',').join(', ')})`, contrast: (hi + 0.05) / (lo + 0.05) };
  }, png);
}

// Review finding P4. In forced colours the primary button was Canvas text on a LinkText fill, and
// Chromium painted a Canvas plate behind the text: Continue and Check answer were blank blocks.
for (const scheme of ['light', 'dark'] as const) {
  test(`forced colours, ${scheme}: the labels of the primary buttons can be read`, async ({ browser, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'only Chromium paints a plate behind text in forced colours, and that plate is the defect');
    const context = await browser.newContext({ forcedColors: 'active', colorScheme: scheme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const checkpoint = example.byKind('checkpoint')[0] as string;
    const watch = await openLesson(page, testInfo, { hash: `#/${checkpoint}` });
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
    const pageColour = await rgb(page, 'body', 'background-color');

    /** Letters on a ground: some of the label's area is text, most of it is one other colour, and the two are far apart. */
    const readable = (ink: Awaited<ReturnType<typeof labelInk>>, what: string): void => {
      expect(ink.text, `${what}: share of the label drawn in the text colour`).toBeGreaterThan(0.04);
      expect(ink.text, `${what}: share of the label drawn in the text colour`).toBeLessThan(0.6);
      expect(ink.ground, `${what}: share of the label that is its ground`).toBeGreaterThan(0.3);
      expect(ink.contrast, `${what}: contrast of text on ground`).toBeGreaterThanOrEqual(4.5);
    };

    for (const button of [page.locator('#lt-next'), page.locator(`#${sectionId(checkpoint)} button[data-act="check"]`)]) {
      await expect(button).toBeVisible();
      const ink = await labelInk(button);
      readable(ink, (await button.textContent()) ?? '');
      // Still a filled button, unlike the quiet ones beside it, which are outlines on the page colour.
      expect(ink.groundColour).not.toBe(pageColour);
    }
    // A quiet button passes by the same measure, so the measure is not tuned to the fix.
    const quiet = await labelInk(page.locator('#lt-back'));
    readable(quiet, 'Back');
    expect(quiet.groundColour).toBe(pageColour);

    // The last scene's Continue cannot be pressed. It must still be readable, and look unlike one that can.
    await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), example.last);
    await expect(page.locator('#lt-next')).toHaveAttribute('aria-disabled', 'true');
    const off = await labelInk(page.locator('#lt-next'));
    expect(off.text).toBeGreaterThan(0.04);
    expect(off.text).toBeLessThan(0.6);
    expect(off.groundColour).toBe(pageColour);
    await expectClean(watch, browserName);
    await context.close();
  });
}

// base.css hid every empty callout, and a status region is a callout in two places. An empty
// region that is display:none is not in the accessibility tree, and what is then put into it
// arrives together with the region, which is not reliably announced.
test('an empty status region that is styled as a callout stays rendered and takes no room; any other empty callout is not shown', async ({ page }, testInfo) => {
  await openLesson(page, testInfo);
  const made = await page.evaluate(() => {
    const region = document.createElement('div');
    region.className = 'lt-callout';
    region.setAttribute('role', 'status');
    const plain = document.createElement('div');
    plain.className = 'lt-callout';
    document.querySelector('main')?.append(region, plain);
    const read = (el: HTMLElement): { display: string; height: number } => ({ display: getComputedStyle(el).display, height: el.getBoundingClientRect().height });
    const empty = { region: read(region), plain: read(plain) };
    region.textContent = 'Saved.';
    const said = read(region);
    region.remove();
    plain.remove();
    return { empty, said };
  });
  expect(made.empty.region).toEqual({ display: 'block', height: 0 });
  expect(made.empty.plain.display).toBe('none');
  expect(made.said.height).toBeGreaterThan(20);
});

test('print: every scene and every source is on the page, and the controls are not', async ({ page }, testInfo) => {
  await openLesson(page, testInfo, { hash: `#/${example.ids[2]}` });
  await expect(page.locator('section.lt-scene:visible')).toHaveCount(1);
  await page.emulateMedia({ media: 'print' });

  await expect(page.locator('section.lt-scene:visible')).toHaveCount(example.total);
  for (const selector of ['.lt-tools', '.lt-pager', '.lt-rail', '#lt-clear', '.lt-skip']) await expect(page.locator(selector).first(), selector).toBeHidden();
  await expect(page.locator('button:not(.lt-chip):visible')).toHaveCount(0);
  await expect(page.locator('[popover]:visible')).toHaveCount(0);
  // The title block is back in full, and the sources list is in the flow with each address in text.
  await expect(page.locator('.lt-objectives')).toBeVisible();
  const sources = page.locator('dialog#lt-sources');
  await expect(sources).toBeVisible();
  expect(await sources.evaluate((el) => getComputedStyle(el).position)).toBe('static');
  await expect(sources.locator('.lt-source-item:visible')).toHaveCount(lesson.evidence.length);
  for (const e of lesson.evidence) await expect(sources).toContainText(new URL(e.url).pathname);
  // Takeaways that were folded away on screen are printed.
  await expect(page.locator(`#${sectionId(example.last)} .lt-reveal-body`).first()).toBeVisible();

  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('section.lt-scene:visible')).toHaveCount(1);
});

// Review finding P10. Chips were hidden on paper with nothing in their place, so no printed claim
// said which source it cites and "Based on" was followed by nothing.
test('print: every claim keeps the number of its source, as plain text that matches the printed source list', async ({ page }, testInfo) => {
  await openLesson(page, testInfo, { hash: `#/${example.ids[2]}` });
  await page.emulateMedia({ media: 'print' });

  for (const holder of ['.lt-claim', '.lt-quote', '.lt-based', '.lt-takeaway']) {
    const all = page.locator(`${holder} .lt-chip`);
    expect(await all.count(), holder).toBeGreaterThan(0);
    await expect(page.locator(`${holder} .lt-chip:visible`), holder).toHaveCount(await all.count());
  }
  // "Based on" is followed by what the example is based on.
  for (const based of await page.locator('.lt-based').all()) expect((await based.innerText()).replace(/\s+/g, ' ').trim()).toMatch(/^Based on \d+/);

  const chip = page.locator('.lt-claim .lt-chip').first();
  const looks = await chip.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      display: cs.display,
      border: cs.borderTopStyle,
      padding: cs.paddingLeft,
      background: cs.backgroundColor,
      color: cs.color,
      before: getComputedStyle(el, '::before').content,
      after: getComputedStyle(el, '::after').content,
      family: cs.fontFamily === getComputedStyle(el.closest('p') as Element).fontFamily,
      height: el.getBoundingClientRect().height,
      line: (el.closest('p') as Element).getBoundingClientRect().height,
    };
  });
  expect(looks).toMatchObject({ border: 'none', padding: '0px', background: 'rgba(0, 0, 0, 0)', color: 'rgb(0, 0, 0)', before: '"["', after: '"]"', family: true });
  expect(looks.display).toMatch(/^inline/);
  // Text in the line, not a box that props the line open.
  expect(looks.height).toBeLessThanOrEqual(looks.line);

  // The number printed after a claim is the number its source carries in the list at the end.
  const number = Number(await chip.textContent());
  const cited = lesson.evidence[number - 1];
  expect(cited).toBeDefined();
  const entry = page.locator('dialog#lt-sources .lt-source-item').nth(number - 1);
  await expect(entry.locator('.lt-source-kicker')).toHaveText(`Source ${number}`);
  await expect(entry).toContainText(cited?.excerpt ?? '');

  // On screen it is the control it was.
  await page.emulateMedia({ media: 'screen' });
  expect(await chip.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('solid');
  expect(await chip.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
});
