// The payload corpus again, this time read by real HTML parsers. A payload that worked would run
// script (caught by the marker it sets, or by a dialog), add an element or attribute, or be stopped
// by the policy, which is itself a failure here: the escaping must hold with no help from the policy.
import type { Published } from '../../src/core/types';
import { examplePublished, exampleReceipt } from '../helpers/example';
import { PAYLOADS, poison } from '../render/helpers';
import { exampleScenes, expect, expectClean, openLesson, sectionId, test } from './shell-kit';

const example = exampleScenes();

function rich(): Published {
  return examplePublished({ receipt: exampleReceipt({ weakClaims: [`${example.first}/blocks[1]`], warnings: { SINGLE_HOST: 1 } }) });
}

type P = import('@playwright/test').Page;

/** What a parser made of the page, compared with the same lesson rendered without payloads. */
function census(page: P) {
  return page.evaluate(() => {
    const count = (selector: string): number => document.querySelectorAll(selector).length;
    const handlers: string[] = [];
    const styled: string[] = [];
    const tags = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('*'))) {
      tags.add(el.localName);
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith('on')) handlers.push(`${el.localName}[${attr.name}]`);
        // The player positions a source card and sizes the summary box through the CSSOM, which
        // shows up as a style attribute holding exactly those properties. Anything else is foreign.
        if (attr.name === 'style') {
          const own =
            (el.matches('div.lt-source[popover]') && /^(left: -?\d+px; top: -?\d+px;|top: -?\d+px; left: -?\d+px;)$/.test(attr.value.trim())) ||
            (el.matches('textarea.lt-summary-text[data-summary]') && /^height: \d+px;$/.test(attr.value.trim()));
          if (!own) styled.push(`${el.localName}: ${attr.value}`);
        }
      }
    }
    return {
      xss: (window as unknown as { __xss?: unknown }).__xss,
      scripts: Array.from(document.scripts).map((s) => s.type || 'classic'),
      styles: count('style'),
      loaders: count('img, iframe, frame, object, embed, link, base, video, source, track, portal, applet, meta[http-equiv="refresh"], form[action], [srcdoc], [formaction], [background]'),
      externalLinks: Array.from(document.querySelectorAll('a[href]'))
        .map((a) => a.getAttribute('href') as string)
        .filter((h) => !h.startsWith('#') && !/^https:\/\/example\.(org|com|net)\//.test(h)),
      handlers,
      styled,
      tags: Array.from(tags).sort(),
      scenes: count('section.lt-scene'),
      dialogs: count('dialog'),
      title: document.title,
    };
  });
}

test('a different payload in every text field: nothing runs, nothing is added, and the policy is never needed', async ({ page, browserName }, testInfo) => {
  let baseline: Awaited<ReturnType<typeof census>> | undefined;
  {
    await openLesson(page, testInfo, { published: rich() });
    baseline = await census(page);
  }
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });

  for (const shift of [0, 17, 31]) {
    let n = shift;
    const published = poison(rich(), 'prose', () => PAYLOADS[n++ % PAYLOADS.length] as string);
    const watch = await openLesson(page, testInfo, { published });
    await expect(page.locator('html')).toHaveClass(/lt-js/);

    // Walk every scene and open things, so anything waiting for interaction gets its chance.
    for (const id of example.ids) {
      await page.evaluate((sceneId) => (location.hash = `#/${sceneId}`), id);
      await expect(page.locator(`#${sectionId(id)}`)).toBeVisible();
      const chip = page.locator(`#${sectionId(id)} button.lt-chip:visible`).first();
      if ((await chip.count()) > 0) {
        await chip.click();
        await page.keyboard.press('Escape');
      }
    }
    for (const summary of await page.locator(`#${sectionId(example.last)} details > summary`).all()) await summary.click();
    await page.locator(`#${sectionId(example.last)} button[data-copy]`).last().click();
    await page.locator('#lt-opensources').click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Contents' }).click();
    await page.keyboard.press('Escape');

    const now = await census(page);
    expect(now.xss, `shift ${shift}: script ran`).toBeUndefined();
    expect(dialogs).toEqual([]);
    expect(now.scripts).toEqual(baseline.scripts);
    expect(now.styles).toBe(1);
    expect(now.loaders).toBe(0);
    expect(now.externalLinks).toEqual([]);
    expect(now.handlers).toEqual([]);
    expect(now.styled).toEqual([]);
    expect(now.scenes).toBe(baseline.scenes);
    expect(now.dialogs).toBe(1);
    // No element name appears that the clean page did not have (inline markup may add strong, em, code and MathML).
    const allowedExtra = new Set(['strong', 'em', 'code', 'math', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace', 'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot', 'munder', 'mover', 'munderover']);
    expect(now.tags.filter((t) => !baseline.tags.includes(t) && !allowedExtra.has(t))).toEqual([]);
    await expectClean(watch, browserName);
  }
});

for (const [i, payload] of PAYLOADS.entries()) {
  // The ones a tokenizer treats specially get a page of their own, in every field including ids.
  if (!/script|style|textarea|title|<!--|-->|math|svg|iframe|base|meta|\$/.test(payload)) continue;
  test(`payload #${i} in every field of the lesson: ${JSON.stringify(payload).slice(0, 50)}`, async ({ page, browserName }, testInfo) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    for (const reach of ['prose', 'strings'] as const) {
      const watch = await openLesson(page, testInfo, { published: poison(rich(), reach, () => payload) });
      const now = await census(page);
      expect(now.xss, `${reach}: script ran`).toBeUndefined();
      expect(dialogs).toEqual([]);
      expect(now.scripts).toEqual(['application/json', 'classic']);
      expect(now.styles).toBe(1);
      expect(now.loaders).toBe(0);
      expect(now.handlers).toEqual([]);
      expect(now.styled).toEqual([]);
      expect(now.dialogs).toBe(1);
      if (reach === 'prose') {
        // The title is shown as the exact characters that were written.
        const shown = payload.replaceAll(String.fromCharCode(0), String.fromCharCode(0xfffd));
        expect(await page.locator('h1').evaluate((el) => el.textContent)).toBe(shown);
        expect(await page.locator('script#lt-data').evaluate((el) => (JSON.parse(el.textContent ?? '{}') as Published).lesson.title)).toBe(payload);
        await expect(page.locator('html')).toHaveClass(/lt-js/);
      }
      await expectClean(watch, browserName);
    }
  });
}

test('a source address that is not a web address is shown as text and never becomes a link', async ({ page, browserName }, testInfo) => {
  const published = examplePublished();
  const bad = ['javascript:window.__xss=1', 'data:text/html,<script>window.__xss=1</script>', 'https://user:pw@example.org/', 'file:///etc/passwd', 'vbscript:window.__xss=1'];
  published.lesson.evidence.forEach((e, i) => (e.url = bad[i % bad.length] as string));
  const watch = await openLesson(page, testInfo, { published });
  await page.locator('#lt-opensources').click();
  const dialog = page.locator('dialog#lt-sources');
  await expect(dialog.getByRole('link')).toHaveCount(0);
  await expect(dialog.locator('.lt-source-open').first()).toHaveText('This address cannot be opened from here.');
  await expect(dialog).toContainText('javascript:window.__xss=1');
  expect((await census(page)).xss).toBeUndefined();
  await expectClean(watch, browserName);
});

test('following a source link sends no referrer and gives the new page no handle on this one', async ({ page, context }, testInfo) => {
  await openLesson(page, testInfo, { via: 'http' });
  await page.locator(`#${sectionId(example.first)} button.lt-chip`).first().click();
  const link = page.locator('.lt-source:popover-open a');
  const href = (await link.getAttribute('href')) as string;
  // The destination is answered here, by the test, so nothing leaves the machine.
  const seen: { url: string; referer: string | undefined }[] = [];
  await context.route(/^https:\/\/example\.(org|com|net)\//, (route) => {
    seen.push({ url: route.request().url(), referer: route.request().headers().referer });
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>source</title><p id="o"></p><script>document.getElementById("o").textContent = String(window.opener)</script>' });
  });
  const [popup] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await popup.waitForLoadState();
  expect(seen).toHaveLength(1);
  expect(seen[0]?.url.split('#')[0]).toBe(href.split('#')[0]);
  expect(seen[0]?.referer).toBeUndefined();
  await expect(popup.locator('#o')).toHaveText('null');
  await popup.close();
});
