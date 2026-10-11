// The document as a whole: what is in <head> and in what order, the policy and its hashes, the
// embedded data, and the structural rules every page must keep.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PLAYER_CSS, PLAYER_JS } from '../../src/generated/player-assets';
import type { Published } from '../../src/core/types';
import { contentSecurityPolicy, readEmbeddedData, renderLesson, renderLessonHtml } from '../../src/render/index';
import { EXAMPLE_LESSON_ID, examplePublished, exampleReceipt } from '../helpers/example';
import { ALLOWED_TAGS, attrAllowed, elements, scan } from './helpers';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('base64');
const published = examplePublished();
const doc = renderLessonHtml(published);
const s = scan(doc);

const SILENT = 'SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYzLjEuMTAyAAAAAAAAAAAAAAD/8xDE';
const withAudio = (clips: { segmentId: string; base64?: string; mime?: string }[]): Published =>
  ({ ...examplePublished(), audio: { provider: 'elevenlabs', voice: 'Test Voice', clips: clips.map((c) => ({ mime: 'audio/mpeg', base64: SILENT, ...c })) } }) as Published;

describe('head', () => {
  it('starts with the doctype, then the character set, then the policy, then the referrer rule', () => {
    expect(doc.startsWith('<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="')).toBe(true);
    const head = s.tags.slice(s.tags.findIndex((t) => t.name === 'head') + 1);
    expect(head[0]?.attrs.get('charset')).toBe('utf-8');
    expect(head[1]?.attrs.get('http-equiv')).toBe('Content-Security-Policy');
    expect(head[2]?.attrs.get('name')).toBe('referrer');
    expect(head[2]?.attrs.get('content')).toBe('no-referrer');
  });

  it('has a policy that allows exactly this script and this style, and nothing from anywhere', () => {
    const csp = elements(s, 'meta').find((m) => m.attrs.get('http-equiv') === 'Content-Security-Policy')?.attrs.get('content');
    const style = elements(s, 'style')[0]?.content ?? '';
    const script = elements(s, 'script').find((t) => !t.attrs.has('type'))?.content ?? '';
    expect(csp).toBe(
      `default-src 'none'; script-src 'sha256-${sha(script)}'; style-src 'sha256-${sha(style)}'; img-src data:; media-src blob:; base-uri 'none'; form-action 'none'; worker-src data:`,
    );
    expect(csp).toBe(renderLesson(published).csp);
    expect(csp).toBe(contentSecurityPolicy(script, style));
    expect(csp).not.toMatch(/unsafe|\*|https?:|'self'/);
  });

  it('has exactly one style element and one classic script, and the script is last before any audio', () => {
    expect(elements(s, 'style')).toHaveLength(1);
    const scripts = elements(s, 'script');
    expect(scripts.map((t) => t.attrs.get('type') ?? 'classic')).toEqual(['application/json', 'classic']);
    expect(scripts[1]?.attrs.size).toBe(0);
  });

  it('carries the built player unchanged, which means the bundle has nothing that could end its element', () => {
    expect(elements(s, 'script')[1]?.content).toBe(PLAYER_JS);
    expect(elements(s, 'style')[0]?.content).toBe(PLAYER_CSS);
    expect(PLAYER_JS).not.toMatch(/<\/script|<!--/i);
    expect(PLAYER_CSS).not.toMatch(/<\/style/i);
  });

  it('sets the language and a title', () => {
    expect(elements(s, 'html')[0]?.attrs.get('lang')).toBe('en');
    expect(elements(s, 'title')[0]?.content).toBe(`${published.lesson.title} – Learning Tool`);
  });
});

describe('structure', () => {
  it('writes only known elements and attributes', () => {
    for (const tag of s.tags) {
      expect(ALLOWED_TAGS.has(tag.name), `<${tag.name}>`).toBe(true);
      if (tag.closing) continue;
      for (const name of tag.attrs.keys()) expect(attrAllowed(name), `${tag.name}[${name}]`).toBe(true);
    }
  });

  it('has no style attribute, no event handler, no comment and nothing that loads', () => {
    for (const tag of s.tags) for (const name of tag.attrs.keys()) expect(name === 'style' || name.startsWith('on'), `${tag.name}[${name}]`).toBe(false);
    // And not by another spelling the tokenizer above might read differently from a browser.
    expect(doc.slice(doc.indexOf('<body>'), doc.indexOf('<script type="application/json"'))).not.toMatch(/\sstyle\s*=|\son[a-z]+\s*=/i);
    expect(s.comments).toEqual([]);
    for (const tag of s.tags) {
      expect(tag.attrs.has('src'), `${tag.name}[src]`).toBe(false);
      expect(tag.attrs.has('srcset')).toBe(false);
      expect(tag.attrs.has('action')).toBe(false);
    }
  });

  it('gives every element a unique id', () => {
    const ids = s.tags.filter((t) => !t.closing && t.attrs.has('id')).map((t) => t.attrs.get('id') as string);
    expect(ids.length).toBeGreaterThan(40);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(lt|scene)-[A-Za-z0-9_-]+$/);
  });

  it('resolves every reference to an id', () => {
    const ids = new Set(s.tags.filter((t) => !t.closing && t.attrs.has('id')).map((t) => t.attrs.get('id') as string));
    const popovers = new Set(s.tags.filter((t) => !t.closing && t.attrs.has('popover')).map((t) => t.attrs.get('id') as string));
    let refs = 0;
    for (const tag of s.tags) {
      if (tag.closing) continue;
      for (const name of ['aria-labelledby', 'aria-describedby', 'for', 'data-copy']) {
        const value = tag.attrs.get(name);
        if (value === undefined) continue;
        refs++;
        expect(ids.has(value), `${tag.name}[${name}=${value}]`).toBe(true);
      }
      const target = tag.attrs.get('popovertarget');
      if (target !== undefined) {
        refs++;
        expect(popovers.has(target), `popovertarget=${target}`).toBe(true);
      }
      const href = tag.attrs.get('href');
      if (href?.startsWith('#')) {
        refs++;
        expect(ids.has(href.slice(1)), `href=${href}`).toBe(true);
      }
    }
    expect(refs).toBeGreaterThan(60);
  });

  it('links out only to the sources, in a new tab, with no opener and no referrer', () => {
    const hosts = new Set(published.lesson.evidence.map((e) => new URL(e.url).host));
    const external = elements(s, 'a').filter((a) => !a.attrs.get('href')?.startsWith('#'));
    expect(external.length).toBeGreaterThan(published.lesson.evidence.length);
    for (const a of external) {
      const url = new URL(a.attrs.get('href') as string);
      expect(url.protocol).toBe('https:');
      expect(hosts.has(url.host)).toBe(true);
      expect(url.hash.startsWith('#:~:text=')).toBe(true);
      expect(a.attrs.get('target')).toBe('_blank');
      expect(a.attrs.get('rel')).toBe('noopener noreferrer');
    }
  });

  it('has one h1, one h2 per scene, and a labelled section for each scene in order', () => {
    expect(elements(s, 'h1')).toHaveLength(1);
    const sections = elements(s, 'section').filter((t) => t.attrs.get('class')?.includes('lt-scene'));
    expect(sections.map((t) => t.attrs.get('data-scene'))).toEqual(published.lesson.scenes.map((sc) => sc.id));
    expect(sections.map((t) => t.attrs.get('data-kind'))).toEqual(published.lesson.scenes.map((sc) => sc.kind));
    const headings = elements(s, 'h2').filter((t) => t.attrs.get('id')?.startsWith('scene-'));
    expect(headings.map((t) => t.attrs.get('id'))).toEqual(sections.map((t) => t.attrs.get('aria-labelledby')));
    for (const h of headings) expect(h.attrs.get('tabindex')).toBe('-1');
    expect(sections.filter((t) => t.attrs.has('hidden'))).toHaveLength(0);
  });

  it('keeps controls that need the script hidden until the script shows them', () => {
    const byId = new Map(s.tags.filter((t) => !t.closing && t.attrs.has('id')).map((t) => [t.attrs.get('id') as string, t]));
    for (const id of ['lt-opensources', 'lt-theme', 'lt-pager', 'lt-progress', 'lt-resume']) expect(byId.get(id)?.attrs.has('hidden'), id).toBe(true);
    for (const copy of s.tags.filter((t) => t.attrs.has('data-copy'))) expect(copy.attrs.has('hidden')).toBe(true);
    expect(byId.get('lt-back')?.attrs.get('aria-disabled')).toBe('true');
    expect(byId.get('lt-live')?.attrs.get('role')).toBe('status');
  });

  it('never says a source or a claim was verified', () => {
    expect(doc).not.toMatch(/verif/i);
  });

  it('renders the same bytes every time', () => {
    expect(renderLessonHtml(examplePublished())).toBe(doc);
  });

  // The page carries the whole player: the clip engine, nine stage kits and the frame runtime as
  // well as the shell (about 220 kB of script and 115 kB of styles). The budget is a tripwire for
  // accidental growth, not a target.
  it('stays within its size budget', () => {
    expect(Buffer.byteLength(doc)).toBeLessThan(600_000);
  });
});

describe('embedded data', () => {
  it('is the lesson and receipt exactly, and reads back', () => {
    const data = elements(s, 'script')[0];
    expect(data?.attrs.get('id')).toBe('lt-data');
    expect(data?.content).not.toMatch(/[<>&]/);
    expect(JSON.parse(data?.content ?? '')).toEqual({ lesson: published.lesson, receipt: published.receipt });
    expect(readEmbeddedData(doc)).toEqual({ lesson: published.lesson, receipt: published.receipt });
    expect(readEmbeddedData(doc)?.lesson.id).toBe(EXAMPLE_LESSON_ID);
  });

  it('survives text that tries to close the element', () => {
    const p = examplePublished();
    p.lesson.title = '</script><script>alert(1)</script><!--';
    const out = renderLessonHtml(p);
    expect(readEmbeddedData(out)?.lesson.title).toBe(p.lesson.title);
    expect(elements(scan(out), 'script')).toHaveLength(2);
  });

  it('returns null for a page with no usable data', () => {
    expect(readEmbeddedData('<html></html>')).toBeNull();
    expect(readEmbeddedData('<script type="application/json" id="lt-data">{oops</script>')).toBeNull();
    expect(readEmbeddedData('<script type="application/json" id="lt-data">[1]</script>')).toBeNull();
    expect(readEmbeddedData('<script type="application/json" id="lt-data">{"lesson":1,"receipt":{}}</script>')).toBeNull();
  });

  it('leaves the audio out of the data', () => {
    const out = renderLessonHtml(withAudio([{ segmentId: 's1' }]));
    expect(Object.keys(JSON.parse(elements(scan(out), 'script')[0]?.content ?? '{}'))).toEqual(['lesson', 'receipt']);
  });
});

describe('language', () => {
  it('marks interface text as English in a lesson that is not', () => {
    const p = examplePublished();
    p.lesson.language = 'pt-BR';
    const t = scan(renderLessonHtml(p));
    expect(elements(t, 'html')[0]?.attrs.get('lang')).toBe('pt-BR');
    const english = t.tags.filter((tag) => tag.attrs.get('lang') === 'en');
    expect(english.length).toBeGreaterThan(20);
    expect(english.some((tag) => tag.attrs.get('class') === 'lt-skip')).toBe(true);
    expect(elements(t, 'h1')[0]?.attrs.has('lang')).toBe(false);
  });
  it('adds no language attributes in an English lesson', () => {
    expect(s.tags.filter((tag) => tag.name !== 'html' && tag.attrs.has('lang'))).toEqual([]);
  });
});

describe('narration clips', () => {
  it('has no audio element and no controls without clips', () => {
    expect(elements(s, 'audio')).toHaveLength(0);
    expect(s.tags.some((t) => t.attrs.get('id') === 'lt-audiobar')).toBe(false);
    expect(s.text).not.toContain('ElevenLabs');
  });

  it('embeds each clip as inert base64 after the script, and says whose voice it is', () => {
    const out = renderLessonHtml(withAudio([{ segmentId: 's1' }, { segmentId: 's3.intro' }, { segmentId: 's3.step2' }]));
    const t = scan(out);
    const scripts = elements(t, 'script');
    expect(scripts.map((x) => x.attrs.get('type') ?? 'classic')).toEqual(['application/json', 'classic', 'application/octet-stream', 'application/octet-stream', 'application/octet-stream']);
    expect(scripts.slice(2).map((x) => x.attrs.get('data-seg'))).toEqual(['s1', 's3.intro', 's3.step2']);
    expect(scripts[2]?.content).toBe(SILENT);
    const audio = elements(t, 'audio')[0];
    expect(audio?.attrs.get('id')).toBe('lt-audio');
    expect(audio?.attrs.has('src')).toBe(false);
    expect(audio?.attrs.has('autoplay')).toBe(false);
    const bar = t.tags.find((x) => x.attrs.get('id') === 'lt-audiobar');
    expect(bar?.attrs.get('data-segments')).toBe('s1 s3.intro s3.step2');
    expect(bar?.attrs.has('hidden')).toBe(true);
    expect(out).toContain('Machine narration by ElevenLabs (elevenlabs.io). The text is authoritative.');
    expect(out).toContain('Voice: Test Voice.');
    // The policy is the same with or without audio: clips are played from blob: URLs the script makes.
    expect(renderLesson(withAudio([{ segmentId: 's1' }])).csp).toBe(renderLesson(published).csp);
  });

  it('drops a clip it cannot embed safely', () => {
    const out = renderLessonHtml(
      withAudio([
        { segmentId: 's1', base64: '</script><script>alert(1)</script>' },
        { segmentId: 's2', base64: 'not base64!' },
        { segmentId: 'nosuchscene' },
        { segmentId: 's3.step0' },
        { segmentId: 's3"><script>' },
        { segmentId: 's4', mime: 'text/html' },
        { segmentId: 's5' },
        { segmentId: 's5' },
      ]),
    );
    const t = scan(out);
    expect(elements(t, 'script').slice(2).map((x) => x.attrs.get('data-seg'))).toEqual(['s5']);
    expect(elements(t, 'script')).toHaveLength(3);
  });

  it('leaves the controls out when no clip is usable', () => {
    const t = scan(renderLessonHtml(withAudio([{ segmentId: 'nosuchscene' }])));
    expect(elements(t, 'audio')).toHaveLength(0);
    expect(t.tags.some((x) => x.attrs.get('id') === 'lt-audiobar')).toBe(false);
  });
});

describe('receipt fields are treated as text', () => {
  it('escapes whatever the receipt holds', () => {
    const out = renderLessonHtml(examplePublished({ receipt: exampleReceipt({ version: '<b>1</b>', rules: '"><i>', hash: '<script>', validatedOn: '<u>', warnings: { '<img src=x>': 2 } }) }));
    const t = scan(out);
    expect(elements(t, 'b').concat(elements(t, 'i'), elements(t, 'u'), elements(t, 'img'))).toEqual([]);
    expect(elements(t, 'script')).toHaveLength(2);
    expect(t.text).toContain('<img src=x>');
  });
});
