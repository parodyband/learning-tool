// The payload corpus. Every string in a lesson is written by an agent that may have been steered
// by a hostile page, so each breakout attempt is placed in every field and the output is read back
// the way a browser would tokenize it. A payload has worked if it produced a tag, an attribute, a
// script, a URL or a comment. It has been handled if it is still there, as text.
import { describe, expect, it } from 'vitest';
import type { Published } from '../../src/core/types';
import { renderLessonHtml } from '../../src/render/index';
import { examplePublished, exampleReceipt } from '../helpers/example';
import { ALLOWED_TAGS, PAYLOADS, type Reach, type Scanned, attrAllowed, elements, poison, scan } from './helpers';

const baseline = scan(renderLessonHtml(examplePublished()));
const count = (s: Scanned, name: string): number => elements(s, name).length;

/** A lesson that also exercises a weak-match note, receipt warnings and narration clips. */
function rich(): Published {
  return {
    ...examplePublished({ receipt: exampleReceipt({ weakClaims: ['s1/blocks[1]', 's9/takeaways[0]'], warnings: { SINGLE_HOST: 1 } }) }),
    audio: { provider: 'elevenlabs', voice: 'Test Voice', clips: [{ segmentId: 's1', mime: 'audio/mpeg', base64: 'QUJD' }] },
  };
}

const richBaseline = scan(renderLessonHtml(rich()));

function assertInert(out: string, label: string): Scanned {
  const s = scan(out);
  for (const tag of s.tags) {
    expect(ALLOWED_TAGS.has(tag.name), `${label}: unexpected <${tag.name}>`).toBe(true);
    if (tag.closing) continue;
    for (const [name, value] of tag.attrs) {
      expect(attrAllowed(name), `${label}: unexpected attribute ${tag.name}[${name}]`).toBe(true);
      expect(name.startsWith('on') || name === 'style' || name === 'srcdoc' || name === 'src' || name === 'action' || name === 'formaction', `${label}: ${tag.name}[${name}]`).toBe(false);
      if (name === 'href') expect(/^#(lt|scene)-[A-Za-z0-9_-]+$/.test(value) || /^https?:\/\/[^\s"<>]+$/.test(value), `${label}: href ${value.slice(0, 60)}`).toBe(true);
      if (name === 'id' || name === 'popovertarget' || name === 'for' || name === 'aria-labelledby' || name === 'aria-describedby')
        expect(value, `${label}: ${tag.name}[${name}]`).toMatch(/^(lt|scene)-[A-Za-z0-9_-]+$/);
      if (name === 'class') expect(value, `${label}: class`).toMatch(/^[a-z0-9_ -]*$/);
    }
  }
  expect(s.comments, `${label}: comments`).toEqual([]);
  // The document keeps exactly the elements that can run or load something.
  expect(elements(s, 'script').map((t) => t.attrs.get('type') ?? 'classic').slice(0, 2), `${label}: scripts`).toEqual(['application/json', 'classic']);
  expect(
    elements(s, 'script')
      .slice(2)
      .every((t) => t.attrs.get('type') === 'application/octet-stream' && /^[A-Za-z0-9+/=]*$/.test(t.content ?? '')),
    `${label}: extra script`,
  ).toBe(true);
  expect(count(s, 'style'), `${label}: style elements`).toBe(1);
  expect(count(s, 'meta'), `${label}: meta elements`).toBe(count(baseline, 'meta'));
  expect(count(s, 'title'), `${label}: title elements`).toBe(1);
  expect(count(s, 'form'), `${label}: forms`).toBe(1);
  expect(count(s, 'dialog'), `${label}: dialogs`).toBe(1);
  expect(count(s, 'main'), `${label}: main`).toBe(1);
  // Icons, the speed radios and the audio element are the page's own: never more than the clean page has.
  expect(count(s, 'svg'), `${label}: svg`).toBeLessThanOrEqual(count(richBaseline, 'svg'));
  expect(count(s, 'input'), `${label}: inputs`).toBeLessThanOrEqual(count(richBaseline, 'input'));
  expect(count(s, 'audio'), `${label}: audio`).toBeLessThanOrEqual(1);
  expect(elements(s, 'audio').every((a) => !a.attrs.has('src') && !a.attrs.has('autoplay'))).toBe(true);
  // The data element still holds valid JSON and nothing spilled out of it.
  expect(() => JSON.parse(elements(s, 'script')[0]?.content ?? ''), `${label}: data`).not.toThrow();
  return s;
}

describe.each(['prose', 'strings', 'everything'] as Reach[])('a payload in %s fields', (reach) => {
  it.each(PAYLOADS.map((p, i) => [i, p] as const))('#%i %j stays text', (_i, payload) => {
    const out = renderLessonHtml(poison(rich(), reach, () => payload));
    const s = assertInert(out, payload);
    if (reach === 'prose') {
      // Structure is intact, so every scene, chip and popover is still there...
      expect(count(s, 'section')).toBe(count(baseline, 'section'));
      expect(s.tags.filter((t) => t.attrs.has('popover')).length).toBeGreaterThanOrEqual(baseline.tags.filter((t) => t.attrs.has('popover')).length);
      // ...and the title, which is plain text everywhere it is used, is shown exactly as written.
      const shown = payload.replaceAll(String.fromCharCode(0), String.fromCharCode(0xfffd));
      expect(elements(s, 'title')[0]?.content).toBe(`${shown} – Learning Tool`);
      expect(s.text).toContain(shown);
    }
  });
});

describe('a different payload in every field at once', () => {
  it.each(['prose', 'strings', 'everything'] as Reach[])('%s', (reach) => {
    let n = 0;
    const out = renderLessonHtml(poison(rich(), reach, () => `${PAYLOADS[n++ % PAYLOADS.length]}`));
    expect(n).toBeGreaterThan(120);
    assertInert(out, `mixed ${reach}`);
  });
});

describe('fields that are used as keys', () => {
  it('ignores names that exist on every object', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const p = examplePublished();
      // A cite, an objective and a segment named after something every object inherits must simply not be found.
      const scene = p.lesson.scenes[0];
      if (scene?.kind === 'narration' && scene.blocks[1]?.type === 'claim') scene.blocks[1].cites = [name];
      const recap = p.lesson.scenes.at(-1);
      if (recap?.kind === 'recap' && recap.takeaways[0]) recap.takeaways[0].objective = name;
      p.receipt.weakClaims = [name];
      p.lesson.depth = name as never;
      p.lesson.level = name as never;
      p.audio = { provider: 'elevenlabs', voice: 'v', clips: [{ segmentId: name, mime: 'audio/mpeg', base64: 'QUJD' }] };
      const shown = assertInert(renderLessonHtml(p), name).text;
      expect(shown).not.toContain('[object Object]');
      expect(shown).not.toContain('function ');
      expect(shown).not.toContain('undefined');
    }
  });
});

describe('the source address', () => {
  it.each([
    'javascript:window.__xss=1',
    'JaVaScRiPt:window.__xss=1',
    'data:text/html,<script>window.__xss=1</script>',
    'vbscript:x',
    'file:///etc/passwd',
    'https://user:secret@example.org/',
    'https://example.org/"><script>window.__xss=1</script>',
    "https://example.org/'onmouseover='window.__xss=1",
    'https://example.org/ onclick=window.__xss=1',
    'https://example.org/#"><img src=x onerror=window.__xss=1>',
    'https://example.org/?q=</script><script>window.__xss=1</script>',
    '//example.org/x',
    'not a url at all',
  ])('%j never becomes a dangerous link', (url) => {
    const p = examplePublished();
    for (const e of p.lesson.evidence) e.url = url;
    const s = assertInert(renderLessonHtml(p), url);
    for (const a of elements(s, 'a')) {
      const href = a.attrs.get('href') as string;
      if (href.startsWith('#')) continue;
      const parsed = new URL(href);
      expect(parsed.protocol).toMatch(/^https?:$/);
      expect(parsed.username + parsed.password).toBe('');
      expect(parsed.host).toBe('example.org');
      // A quote mark that the URL parser keeps is still only a character inside a double-quoted attribute.
      expect(href).not.toMatch(/["<>\s]/);
    }
  });

  it('shows no link for an address that cannot be opened, and still shows what was stored', () => {
    const p = examplePublished();
    for (const e of p.lesson.evidence) e.url = 'javascript:window.__xss=1';
    const s = scan(renderLessonHtml(p));
    expect(elements(s, 'a').filter((a) => !a.attrs.get('href')?.startsWith('#'))).toEqual([]);
    expect(s.text).toContain('This address cannot be opened from here.');
    expect(s.text).toContain('javascript:window.__xss=1');
  });
});
