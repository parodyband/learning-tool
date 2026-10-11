// What the learner is shown: blocks, source chips and cards, the sources dialog, scene chrome and
// the recap. These pin the wording the contract fixes and the honesty rules of the format.
//
// The example lesson belongs to another area and may be retuned, so the scenes whose exact text is
// asserted here are written in this file and swapped into it. Only its evidence, objectives and
// overall shape are relied on, and those are read from the data, not copied.
import { describe, expect, it } from 'vitest';
import { type Evidence, type RecapScene, Scene } from '../../src/core/schema';
import type { Published } from '../../src/core/types';
import { ANALOGY_LABEL, ANALOGY_LIMITS_LABEL, EXAMPLE_LABEL } from '../../src/render/blocks';
import { sourceLink } from '../../src/render/escape';
import { renderLessonHtml } from '../../src/render/index';
import { SUMMARY_FIRST_LINE, canYou, isWide, kindLabel, sceneRev, teachRequest } from '../../src/render/scenes';
import { KNOWN_LIMIT, WEAK_MATCH_LINE, formatDate, givenLabel, sourceBook } from '../../src/render/sources';
import { examplePublished, exampleReceipt } from '../helpers/example';
import { type Scanned, type Tag, elements, scan } from './helpers';

const FIRST = 'a1';
const LAST = 'z9';

/** The example lesson with a first scene and a recap whose every word is fixed here. */
function fixture(change?: (p: Published) => void): Published {
  const p = examplePublished();
  const [e1, e2, e3] = p.lesson.evidence as [Evidence, Evidence, Evidence];
  e1.savedOn = '2026-10-10';
  e2.via = 'search_snippet';
  p.lesson.scenes[0] = Scene.parse({
    id: FIRST,
    kind: 'narration',
    title: 'A scene of my own',
    blocks: [
      { type: 'framing', text: 'An opening question?' },
      { type: 'claim', text: 'A claim with **strong** words.', cites: [e1.id, e2.id] },
      { type: 'quote', text: e3.excerpt.split(' ').slice(0, 6).join(' '), cite: e3.id },
      { type: 'analogy', text: 'It is like a dictionary.', limits: 'A dictionary has no midpoint rule.' },
      { type: 'example', text: 'Take 8 items: 3 looks.', basedOn: [e2.id] },
      { type: 'example', text: 'An example with no basis given.' },
    ],
  });
  p.lesson.scenes[p.lesson.scenes.length - 1] = Scene.parse({
    id: LAST,
    kind: 'recap',
    title: 'What you can do now',
    takeaways: p.lesson.objectives.map((o, i) => ({ objective: o.id, text: `Takeaway number ${i + 1}.`, cites: i === 0 ? [e1.id, e3.id] : [e2.id] })),
    practice: { task: 'Write it from memory.', lookFor: ['It stops', 'It never reads outside the list'] },
    next: [
      { topic: 'Big-O notation', why: 'To compare growth.' },
      { topic: 'Sorting', why: 'Because order matters.' },
    ],
  });
  change?.(p);
  return p;
}

/** The markup of one scene, cut out of the document. */
function sceneHtml(doc: string, sceneId: string): string {
  const at = doc.indexOf(`data-scene="${sceneId}"`);
  expect(at, `scene ${sceneId}`).toBeGreaterThan(0);
  const start = doc.lastIndexOf('<section class="lt-scene', at);
  return doc.slice(start, doc.indexOf('</section>', start) + '</section>'.length);
}

function render(change?: (p: Published) => void): { doc: string; s: Scanned; p: Published } {
  const p = fixture(change);
  const doc = renderLessonHtml(p);
  return { doc, s: scan(doc), p };
}

const byClass = (s: Scanned, cls: string): Tag[] => s.tags.filter((t) => !t.closing && (t.attrs.get('class') ?? '').split(' ').includes(cls));
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe('blocks', () => {
  const { doc, p } = render();
  const first = sceneHtml(doc, FIRST);
  const [e1, e2, e3] = p.lesson.evidence as [Evidence, Evidence, Evidence];
  const host = (e: Evidence): string => new URL(e.url).hostname;

  it('ends a claim with numbered chips, and puts each popover straight after the paragraph', () => {
    expect(first).toContain(
      '<div class="lt-block lt-claim"><p>A claim with <strong>strong</strong> words.&nbsp;<span class="lt-cites">' +
        `<button type="button" class="lt-chip" popovertarget="lt-a1-_src1" aria-label="Source 1: ${host(e1)}"><span aria-hidden="true">1</span></button>` +
        `<button type="button" class="lt-chip" popovertarget="lt-a1-_src2" aria-label="Source 2: ${host(e2)}"><span aria-hidden="true">2</span></button>` +
        '</span></p><div popover id="lt-a1-_src1" class="lt-source" role="group" aria-labelledby="lt-a1-_src1-h">',
    );
  });

  it('gives every popover one chip and never repeats an id, however often a source is cited', () => {
    const s = scan(doc);
    const cards = byClass(s, 'lt-source').map((t) => t.attrs.get('id'));
    const chips = byClass(s, 'lt-chip').map((c) => c.attrs.get('popovertarget'));
    expect(cards.length).toBeGreaterThan(p.lesson.evidence.length);
    expect(new Set(cards).size).toBe(cards.length);
    expect(chips).toEqual(cards);
    for (const chip of byClass(s, 'lt-chip')) expect(chip.attrs.get('type')).toBe('button');
  });

  it('cites a source once even if the block names it twice', () => {
    const { doc: d } = render((q) => {
      const claim = (q.lesson.scenes[0] as { blocks: { cites?: string[] }[] }).blocks[1];
      if (claim) claim.cites = ['e1', 'e1', 'e2'];
    });
    expect(byClass(scan(sceneHtml(d, FIRST).split('lt-quote')[0] as string), 'lt-chip')).toHaveLength(2);
  });

  it('sets a quote as a blockquote in the source’s own characters, attributed from the evidence record', () => {
    const { doc: d } = render((q) => {
      const quote = (q.lesson.scenes[0] as { blocks: { text: string }[] }).blocks[2];
      if (quote) quote.text = 'the *half* that is `discarded` may $contain$ <it>';
    });
    const html = sceneHtml(d, FIRST);
    expect(html).toContain('<div class="lt-block lt-quote"><blockquote><p>the *half* that is `discarded` may $contain$ &lt;it&gt;</p></blockquote>');
    expect(html).toContain(`<p class="lt-quote-from"><cite>${e3.title}</cite><span class="lt-quote-host">${host(e3)}</span>&nbsp;<span class="lt-cites">`);
  });

  it('labels an analogy and always shows where it breaks down', () => {
    expect(ANALOGY_LABEL).toBe('Analogy');
    expect(ANALOGY_LIMITS_LABEL).toBe('Where this comparison breaks down:');
    expect(first).toContain(
      '<div class="lt-block lt-note lt-analogy"><p class="lt-label">Analogy</p><p>It is like a dictionary.</p><p class="lt-limits"><span class="lt-limits-label">Where this comparison breaks down:</span> A dictionary has no midpoint rule.</p></div>',
    );
  });

  it('labels an example as the agent’s own and shows what it is based on, when anything', () => {
    expect(EXAMPLE_LABEL).toBe('Worked example, written by your agent');
    expect(first).toContain(
      '<div class="lt-block lt-note lt-example"><p class="lt-label">Worked example, written by your agent</p><p>Take 8 items: 3 looks.</p><p class="lt-based"><span>Based on</span>&nbsp;<span class="lt-cites">',
    );
    expect(first).toContain('<div class="lt-block lt-note lt-example"><p class="lt-label">Worked example, written by your agent</p><p>An example with no basis given.</p></div>');
  });

  it('renders framing as a plain paragraph with no label and no chip', () => {
    expect(first).toContain('<div class="lt-block lt-framing"><p>An opening question?</p></div>');
  });

  it('leaves out a chip whose source the lesson does not carry', () => {
    const { doc: d } = render((q) => {
      for (const block of (q.lesson.scenes[0] as { blocks: { cites?: string[]; cite?: string; basedOn?: string[] }[] }).blocks) {
        if (block.cites) block.cites = ['e99'];
        if (block.cite) block.cite = 'e98';
        if (block.basedOn) block.basedOn = ['toString'];
      }
    });
    const html = sceneHtml(d, FIRST);
    expect(byClass(scan(html), 'lt-chip')).toHaveLength(0);
    expect(html).toContain('<p>A claim with <strong>strong</strong> words.</p></div>');
    expect(html).not.toContain('lt-based');
  });
});

describe('source cards', () => {
  it('shows host, title, publisher, when and how it was saved, the excerpt, and a link to the passage', () => {
    const { doc, p } = render();
    const e1 = p.lesson.evidence[0] as Evidence;
    const link = sourceLink(e1);
    const html = sceneHtml(doc, FIRST);
    const card = html.slice(html.indexOf('<div popover'), html.indexOf('</div>', html.indexOf('<div popover')) + 6);
    expect(link?.url.href).toMatch(/^https:\/\/[a-z.]+\/[^#]*#:~:text=[A-Za-z0-9%.,]+$/);
    expect(card).toBe(
      '<div popover id="lt-a1-_src1" class="lt-source" role="group" aria-labelledby="lt-a1-_src1-h">' +
        '<p class="lt-source-kicker">Source 1</p>' +
        `<h3 class="lt-source-host" id="lt-a1-_src1-h">${new URL(e1.url).hostname}</h3>` +
        '<p class="lt-source-given">Title and publisher, as given by your agent</p>' +
        `<p class="lt-source-title">${e1.title}</p>` +
        `<p class="lt-source-pub">${e1.publisher}</p>` +
        '<p class="lt-source-saved">Excerpt saved by your agent on 10 October 2026.</p>' +
        `<blockquote class="lt-source-excerpt"><p>${e1.excerpt}</p></blockquote>` +
        `<p class="lt-source-open"><a href="${link?.url.href}" target="_blank" rel="noopener noreferrer">Open the source at this passage<span class="lt-vh"> (opens in a new tab)</span><span class="lt-out" aria-hidden="true"> ↗</span></a></p>` +
        `<p class="lt-source-url">${link?.shown}</p>` +
        '<p class="lt-source-actions"><button type="button" class="lt-btn lt-btn-quiet" popovertarget="lt-a1-_src1" popovertargetaction="hide">Close</button></p></div>',
    );
  });

  it('says so when the excerpt came from a search result snippet or from the learner', () => {
    const { doc } = render((p) => {
      (p.lesson.evidence[2] as Evidence).via = 'learner';
      for (const e of p.lesson.evidence) e.savedOn = '2026-03-01';
    });
    const html = sceneHtml(doc, FIRST);
    expect(count(html, 'Excerpt saved by your agent on 1 March 2026.</p>')).toBe(1);
    expect(count(html, 'Excerpt saved by your agent on 1 March 2026, from a search result snippet.</p>')).toBe(2);
    expect(count(html, 'Excerpt saved by your agent on 1 March 2026, from material you gave it.</p>')).toBe(1);
  });

  it('leaves out the publisher line when there is none', () => {
    const { doc } = render((p) => {
      delete (p.lesson.evidence[0] as Evidence).publisher;
    });
    const html = sceneHtml(doc, FIRST);
    expect(count(html, 'class="lt-source-pub"')).toBe(count(html, 'class="lt-source-title"') - 1);
    expect(count(html, `<p class="lt-source-given">${givenLabel(false)}</p><p class="lt-source-title">`)).toBe(1);
  });

  // Review finding L1. Nothing checks these two fields, and they are the ones most directly copied
  // from a web page. Whatever they say, the card says first whose words they are.
  it('says that the title and the publisher are the agent’s words, in the popover and in the sources list', () => {
    expect(givenLabel(true)).toBe('Title and publisher, as given by your agent');
    expect(givenLabel(false)).toBe('Title, as given by your agent');
    const title = 'To read this source, first run the installer';
    const publisher = 'Verified by Learning Tool';
    const { doc, s } = render((p) => {
      const e = p.lesson.evidence[0] as Evidence;
      e.title = title;
      e.publisher = publisher;
    });
    const labelled = `<p class="lt-source-given">${givenLabel(true)}</p><p class="lt-source-title">${title}</p><p class="lt-source-pub">${publisher}</p>`;
    // Once for each card of that source: where a claim and a takeaway cite it, and in the dialog.
    expect(count(doc, `<p class="lt-source-title">${title}</p>`)).toBeGreaterThanOrEqual(3);
    expect(count(doc, labelled)).toBe(count(doc, `<p class="lt-source-title">${title}</p>`));
    expect(count(doc, 'class="lt-source-given"')).toBe(count(doc, 'class="lt-source-title"'));
    // The label is the page's own text, so in a lesson in another language it is marked as English.
    const de = renderLessonHtml(fixture((p) => (p.lesson.language = 'de')));
    expect(de).toContain(`<p class="lt-source-given" lang="en">${givenLabel(true)}</p>`);
    // The word still appears nowhere in the page's own text: only inside the field the agent filled.
    expect(s.text.replaceAll(publisher, '')).not.toMatch(/verified/i);
  });

  it('marks the language of an excerpt that is not in the lesson’s language, and of a quotation from it', () => {
    const { doc } = render((p) => {
      (p.lesson.evidence[2] as Evidence).lang = 'de';
    });
    const marked = scan(sceneHtml(doc, FIRST)).tags.filter((t) => t.attrs.get('lang') === 'de');
    expect(marked.map((t) => `${t.name}.${t.attrs.get('class') ?? ''}`)).toEqual(['blockquote.', 'blockquote.lt-source-excerpt']);
  });

  it('shows the host the link really goes to, whatever the stored host says', () => {
    const { s, p } = render((q) => {
      (q.lesson.evidence[0] as Evidence).host = 'trusted.example';
    });
    expect(s.text).not.toContain('trusted.example');
    expect(byClass(s, 'lt-chip')[0]?.attrs.get('aria-label')).toBe(`Source 1: ${new URL((p.lesson.evidence[0] as Evidence).url).hostname}`);
  });

  it('adds one neutral line to the card of a weak-match claim, and to no other', () => {
    expect(WEAK_MATCH_LINE).toBe('Few words in common with this excerpt. Check the source.');
    const mark = `<p class="lt-source-weak">${WEAK_MATCH_LINE}</p>`;
    const plain = renderLessonHtml(fixture());
    expect(count(plain, mark)).toBe(0);

    // The claim in the first scene cites two sources, so both of its cards carry the line.
    const claim = renderLessonHtml(fixture((p) => (p.receipt = exampleReceipt({ weakClaims: [`${FIRST}/blocks[1]`] }))));
    expect(count(sceneHtml(claim, FIRST), mark)).toBe(2);
    expect(count(claim, mark)).toBe(2);
    const html = sceneHtml(claim, FIRST);
    expect(html.indexOf(mark)).toBeLessThan(html.indexOf('lt-quote'));

    // A takeaway, by its own path.
    const takeaway = renderLessonHtml(fixture((p) => (p.receipt = exampleReceipt({ weakClaims: [`${LAST}/takeaways[1]`] }))));
    expect(count(sceneHtml(takeaway, LAST), mark)).toBe(1);
    expect(count(takeaway, mark)).toBe(1);

    // A claim inside a step, when the lesson has one.
    const p = fixture();
    for (const scene of p.lesson.scenes) {
      if (scene.kind !== 'step_through') continue;
      const stepAt = scene.steps.findIndex((st) => st.blocks.some((b) => b.type === 'claim'));
      if (stepAt === -1) continue;
      const blockAt = (scene.steps[stepAt] as (typeof scene.steps)[number]).blocks.findIndex((b) => b.type === 'claim');
      const out = renderLessonHtml(fixture((q) => (q.receipt = exampleReceipt({ weakClaims: [`${scene.id}/steps[${stepAt}].blocks[${blockAt}]`] }))));
      expect(count(sceneHtml(out, scene.id), mark)).toBeGreaterThanOrEqual(1);
      expect(count(out, mark)).toBe(count(sceneHtml(out, scene.id), mark));
    }

    // A path that names nothing changes nothing.
    expect(count(renderLessonHtml(fixture((q) => (q.receipt = exampleReceipt({ weakClaims: ['nowhere/blocks[0]', `${FIRST}/blocks[0]`] })))), mark)).toBe(0);
  });

  it('formats dates by hand and leaves an unexpected value alone', () => {
    expect(formatDate('2026-10-10')).toBe('10 October 2026');
    expect(formatDate('2027-01-05')).toBe('5 January 2027');
    expect(formatDate('2026-13-01')).toBe('2026-13-01');
    expect(formatDate('yesterday')).toBe('yesterday');
  });

  it('numbers sources by position and ignores a repeated id', () => {
    const p = fixture();
    const first = p.lesson.evidence[0] as Evidence;
    const book = sourceBook({ ...p.lesson, evidence: [...p.lesson.evidence, { ...first, title: 'duplicate' }] });
    expect(book.number(first.id)).toBe(1);
    expect(book.number((p.lesson.evidence.at(-1) as Evidence).id)).toBe(p.lesson.evidence.length);
    expect(book.get(first.id)?.title).not.toBe('duplicate');
    expect(book.number('toString')).toBeUndefined();
    expect(book.get('__proto__')).toBeUndefined();
  });
});

describe('sources dialog', () => {
  const p = fixture((q) => {
    q.receipt = exampleReceipt({
      warnings: { SINGLE_HOST: 1, CLAIM_WEAK_MATCH: 2 },
      weakClaims: [`${FIRST}/blocks[1]`, 'x/blocks[0]'],
      stats: { scenes: 9, words: 520, minutes: 10, claims: 10, quotes: 1, sources: 5, pages: 4, hosts: 3, checkpoints: 3, figures: 3, uncitedShare: 0.2, exampleShare: 0.2, weakClaims: 2 },
      version: '0.1.0',
      rules: '7',
      validatedOn: '2026-10-10',
    });
  });
  const doc = renderLessonHtml(p);
  const dialogHtml = doc.slice(doc.indexOf('<dialog'), doc.indexOf('</dialog>') + 9);
  const d = scan(dialogHtml);

  it('is a labelled dialog that lists every source once, in order', () => {
    const dialog = elements(d, 'dialog')[0];
    expect(dialog?.attrs.get('id')).toBe('lt-sources');
    expect(dialog?.attrs.get('aria-labelledby')).toBe('lt-sourcestitle');
    expect(dialog?.attrs.has('open')).toBe(false);
    expect(byClass(d, 'lt-source-item')).toHaveLength(p.lesson.evidence.length);
    expect(byClass(d, 'lt-source-host').map((h) => h.attrs.get('id'))).toEqual(p.lesson.evidence.map((_, i) => `lt-source-_${i + 1}`));
    expect(elements(d, 'a').map((a) => (a.attrs.get('href') as string).split('#')[0])).toEqual(p.lesson.evidence.map((e) => sourceLink(e)?.shown));
    for (const e of p.lesson.evidence) expect(d.text).toContain(e.excerpt);
  });

  it('never shows the weak-match line there: that is about a claim, not about a source', () => {
    expect(d.text).not.toContain(WEAK_MATCH_LINE);
  });

  it('closes with a form that submits nowhere', () => {
    const form = elements(d, 'form')[0];
    expect(form?.attrs.get('method')).toBe('dialog');
    expect(form?.attrs.has('action')).toBe(false);
  });

  it('states the known limit in one sentence', () => {
    expect(d.text).toContain(KNOWN_LIMIT);
    expect(KNOWN_LIMIT.split('. ').length).toBe(1);
    expect(KNOWN_LIMIT).toMatch(/cannot tell whether an excerpt is genuine or whether it supports the claim/);
  });

  it('shows the receipt: rules version, date, counts, and warnings by code', () => {
    expect(d.text).toContain('What was checked');
    expect(d.text).toContain('10 October 2026, by Learning Tool 0.1.0, rules version 7');
    expect(d.text).toContain('9 scenes, 520 words, 10 claims, 1 quotation, 5 sources from 3 sites, 3 checkpoints, 3 figures');
    expect(dialogHtml).toContain('<li><code>CLAIM_WEAK_MATCH</code> 2 times</li><li><code>SINGLE_HOST</code> 1 time</li>');
    expect(d.text).toContain('2 claims share few words with the excerpt cited for it.');
    expect(d.text).toContain(p.receipt.hash);
  });

  it('says "None" when there are no warnings, and nothing about loose matches', () => {
    const plain = renderLessonHtml(fixture());
    expect(plain).toContain('<dt>Warnings</dt><dd>None</dd>');
    expect(plain).not.toContain('Loose matches');
  });

  it('does not use the word, anywhere in the dialog or the footer', () => {
    expect(dialogHtml).not.toMatch(/verif/i);
    expect(doc.slice(doc.indexOf('<footer'), doc.indexOf('</footer>'))).not.toMatch(/verif/i);
  });
});

describe('scene chrome', () => {
  const { doc, p } = render();
  const total = p.lesson.scenes.length;

  it('heads each scene with its place, its kind and its title', () => {
    expect(sceneHtml(doc, FIRST)).toContain(`<h2 id="scene-a1" tabindex="-1"><span class="lt-kicker">Scene 1 of ${total}</span> <span class="lt-scene-title">A scene of my own</span></h2>`);
    expect(sceneHtml(doc, LAST)).toContain(`<span class="lt-kicker">Scene ${total} of ${total}<span class="lt-kicker-kind"> · Recap</span></span> <span class="lt-scene-title">What you can do now</span>`);
    expect(kindLabel('step_through')).toBe('Step by step');
    expect(kindLabel('checkpoint')).toBe('Checkpoint');
    expect(kindLabel('recap')).toBe('Recap');
    expect(kindLabel('narration')).toBe('');
    expect(kindLabel('constructor')).toBe('');
  });

  it('marks checkpoints with their objective and level, and scenes with a figure as wide', () => {
    const sections = elements(scan(doc), 'section').filter((t) => t.attrs.has('data-scene'));
    for (const scene of p.lesson.scenes) {
      const section = sections.find((t) => t.attrs.get('data-scene') === scene.id);
      expect(section?.attrs.get('data-kind')).toBe(scene.kind);
      expect(section?.attrs.get('id')).toBe(`lt-${scene.id}-_scene`);
      expect(section?.attrs.get('data-objective')).toBe(scene.kind === 'checkpoint' ? scene.objective : undefined);
      expect(section?.attrs.get('data-level')).toBe(scene.kind === 'checkpoint' ? scene.level : undefined);
      expect((section?.attrs.get('class') ?? '').includes('lt-scene-wide')).toBe(isWide(scene));
      expect((section?.attrs.get('class') ?? '').split(' ')).toContain(`lt-kind-${scene.kind}`);
    }
    expect(p.lesson.scenes.some(isWide)).toBe(true);
    expect(p.lesson.scenes.some((sc) => sc.kind === 'checkpoint')).toBe(true);
  });

  // Review finding P5. The player keeps a checkpoint result with the digest of the scene it was
  // given for, so the digest must move when the question does and stay put when it does not.
  it('gives each scene a digest of its content that changes when, and only when, that scene does', () => {
    const revs = (document: string): Map<string, string> =>
      new Map(
        elements(scan(document), 'section')
          .filter((t) => t.attrs.has('data-scene'))
          .map((t) => [t.attrs.get('data-scene') as string, t.attrs.get('data-rev') as string]),
      );
    const before = revs(doc);
    expect(before.size).toBe(total);
    for (const scene of p.lesson.scenes) {
      expect(before.get(scene.id)).toMatch(/^[0-9a-f]{12}$/);
      expect(before.get(scene.id)).toBe(sceneRev(scene));
    }
    expect(new Set(before.values()).size).toBe(total);

    const changed = p.lesson.scenes.find((sc) => sc.kind === 'checkpoint');
    if (changed?.kind !== 'checkpoint') throw new Error('the example has a checkpoint');
    const after = revs(
      renderLessonHtml(
        fixture((q) => {
          const scene = q.lesson.scenes.find((sc) => sc.id === changed.id);
          if (scene?.kind === 'checkpoint') scene.question.prompt = `${scene.question.prompt} (reworded)`;
          // Things that are not the scene: the lesson's title, its receipt, its sources.
          q.lesson.title = 'Another title';
          q.receipt = exampleReceipt({ hash: 'f'.repeat(64) });
          (q.lesson.evidence[0] as Evidence).title = 'Another source title';
        }),
      ),
    );
    for (const scene of p.lesson.scenes) {
      if (scene.id === changed.id) expect(after.get(scene.id)).not.toBe(before.get(scene.id));
      else expect(after.get(scene.id), scene.id).toBe(before.get(scene.id));
    }
    // Key order is not content, and a field that is absent is the same as one set to undefined.
    const scene = p.lesson.scenes[0] as Scene;
    expect(sceneRev(Object.fromEntries(Object.entries(scene).reverse()) as Scene)).toBe(sceneRev(scene));
    expect(sceneRev({ ...scene, extra: undefined } as unknown as Scene)).toBe(sceneRev(scene));
    expect(sceneRev({ ...scene, title: Number.NaN } as never)).toBe('none');
  });

  it('marks what the narration reads in each kind of scene', () => {
    const marks = scan(doc)
      .tags.filter((t) => t.attrs.has('data-narration'))
      .map((t) => t.attrs.get('data-narration'));
    for (const scene of p.lesson.scenes) {
      if (scene.kind !== 'step_through') {
        expect(marks, scene.id).toContain(scene.id);
        continue;
      }
      if (scene.intro) expect(marks).toContain(`${scene.id}.intro`);
      scene.steps.forEach((_, i) => expect(marks).toContain(`${scene.id}.step${i + 1}`));
    }
    expect(new Set(marks).size).toBe(marks.length);
  });

  it('puts a step-through figure before its steps in the document, and prose before a narration figure', () => {
    for (const scene of p.lesson.scenes) {
      const html = sceneHtml(doc, scene.id);
      if (scene.kind === 'step_through') {
        if (scene.intro) expect(html.indexOf('class="lt-intro"')).toBeLessThan(html.indexOf('class="lt-figure-col"'));
        expect(html.indexOf('class="lt-figure-col"')).toBeGreaterThan(0);
        expect(html.indexOf('class="lt-figure-col"')).toBeLessThan(html.indexOf('data-steps='));
      } else if (scene.kind === 'narration' && scene.figure) {
        expect(html.indexOf('lt-prose')).toBeLessThan(html.indexOf('class="lt-figure-col"'));
      } else {
        expect(html).not.toContain('lt-figure-col');
      }
    }
  });

  it('lists every scene in the contents, linked to its heading', () => {
    const nav = doc.slice(doc.indexOf('<nav popover'), doc.indexOf('</nav>'));
    const links = elements(scan(nav), 'a');
    expect(links.map((a) => a.attrs.get('href'))).toEqual(p.lesson.scenes.map((sc) => `#scene-${sc.id}`));
    expect(links.map((a) => a.attrs.get('data-goto'))).toEqual(p.lesson.scenes.map((sc) => sc.id));
  });

  it('opens with the title, a plain description and the objectives', () => {
    const top = scan(doc.slice(doc.indexOf('<header class="lt-top'), doc.indexOf('</header>')));
    expect(elements(top, 'h1')).toHaveLength(1);
    expect(top.text).toContain(p.lesson.title);
    expect(top.text).toContain('After this lesson you can');
    for (const o of p.lesson.objectives) expect(top.text).toContain(o.text);
  });

  it.each([
    [{ depth: 'quick', level: 'new', minutes: 5 }, 'A quick lesson: about 5 minutes, 2 scenes, 1 source. Written for someone new to this.'],
    [{ depth: 'deep', level: 'solid', minutes: 1 }, 'A deep lesson: about 1 minute, 2 scenes, 1 source. Written for someone with a solid background.'],
    [{ depth: 'standard', level: 'some', minutes: 0 }, 'A standard lesson: 2 scenes, 1 source. Written for someone with some background.'],
    [{ depth: 'toString', level: 'constructor', minutes: Number.NaN }, 'A lesson: 2 scenes, 1 source.'],
  ] as const)('describes the lesson in plain sentences: %j', (o, expected) => {
    const out = renderLessonHtml(
      fixture((q) => {
        q.lesson.depth = o.depth as never;
        q.lesson.level = o.level as never;
        q.receipt.stats.minutes = o.minutes;
        q.lesson.scenes = [q.lesson.scenes[0] as Scene, q.lesson.scenes.at(-1) as Scene];
        q.lesson.evidence = [q.lesson.evidence[0] as Evidence];
      }),
    );
    expect(out).toContain(`<p class="lt-meta">${expected}</p>`);
  });
});

describe('recap', () => {
  const { doc, p } = render();
  const html = sceneHtml(doc, LAST);
  const r = scan(html);
  const recap = p.lesson.scenes.at(-1) as RecapScene;

  it.each([
    ['Trace binary search on a sorted list', 'Can you trace binary search on a sorted list?'],
    ['Explain why it is fast.', 'Can you explain why it is fast?'],
    ['HTTP caching rules, applied', 'Can you HTTP caching rules, applied?'],
    ['Élargir le champ', 'Can you Élargir le champ?'],
    ['compare two things?  ', 'Can you compare two things?'],
    ['A', 'Can you A?'],
  ])('asks %j as %j', (objective, question) => expect(canYou(objective)).toBe(question));

  it('asks each objective as a question and keeps its takeaway behind a native reveal', () => {
    expect(byClass(r, 'lt-recap-q')).toHaveLength(p.lesson.objectives.length);
    for (const o of p.lesson.objectives) expect(r.text).toContain(canYou(o.text));
    const reveals = elements(r, 'details');
    expect(reveals).toHaveLength(p.lesson.objectives.length);
    for (const d of reveals) expect(d.attrs.has('open')).toBe(false);
    expect(html).toContain('<details class="lt-reveal" data-narrated><summary>Show the takeaway</summary><div class="lt-reveal-body"><p>Takeaway number 1.&nbsp;<span class="lt-cites">');
  });

  it('marks the takeaway reveals, and no other disclosure in the lesson, as text the narration reads', () => {
    const all = scan(doc);
    const narrated = elements(all, 'details').filter((d) => d.attrs.has('data-narrated'));
    expect(narrated).toHaveLength(p.lesson.objectives.length);
    for (const d of narrated) expect(d.attrs.get('class')).toBe('lt-reveal');
    // Hints and answers are disclosures too, and are never read out.
    expect(elements(all, 'details').length).toBeGreaterThan(narrated.length);
  });

  it('links each objective to the checkpoints that assess it, with a place for the result', () => {
    const chunks = html.split('<li class="lt-takeaway"').slice(1);
    expect(chunks).toHaveLength(recap.takeaways.length);
    const expectedOrder: string[] = [];
    recap.takeaways.forEach((t, i) => {
      const mine = p.lesson.scenes.filter((sc) => sc.kind === 'checkpoint' && sc.objective === t.objective);
      const chunk = chunks[i] as string;
      const list = chunk.includes('<ul class="lt-recap-checks">') ? chunk.slice(chunk.indexOf('<ul class="lt-recap-checks">'), chunk.indexOf('</ul>') + 5) : '';
      const links = elements(scan(list), 'a');
      expect(links.map((a) => a.attrs.get('data-goto'))).toEqual(mine.map((sc) => sc.id));
      expect(links.map((a) => a.attrs.get('href'))).toEqual(mine.map((sc) => `#scene-${sc.id}`));
      expectedOrder.push(...mine.map((sc) => sc.id));
    });
    expect(expectedOrder.length).toBeGreaterThan(0);
    expect(r.tags.filter((t) => t.attrs.has('data-result')).map((t) => t.attrs.get('data-result'))).toEqual(expectedOrder);
  });

  it('shows the practice task with its signs of success', () => {
    expect(html).toContain('<h3>Try it away from the screen</h3><p>Write it from memory.</p><p class="lt-label">Signs that it worked</p><ul><li>It stops</li><li>It never reads outside the list</li></ul>');
  });

  it('offers each next topic as a request that can be copied', () => {
    expect(teachRequest('Big-O notation')).toBe('Teach me Big-O notation with Learning Tool');
    expect(byClass(r, 'lt-request-text').map((t) => t.attrs.get('id'))).toEqual(['lt-z9-_next1', 'lt-z9-_next2']);
    expect(html).toContain('<span class="lt-request-text" id="lt-z9-_next1">Teach me Big-O notation with Learning Tool</span>');
    expect(html).toContain('<span class="lt-request-text" id="lt-z9-_next2">Teach me Sorting with Learning Tool</span>');
    expect(html).toContain('<p class="lt-next-why">To compare growth.</p>');
    expect(r.tags.filter((t) => t.attrs.has('data-copy')).map((t) => t.attrs.get('data-copy'))).toEqual(['lt-z9-_next1', 'lt-z9-_next2', 'lt-z9-_summary']);
  });

  it('shows the summary in full, starting with the line that says it is data', () => {
    expect(SUMMARY_FIRST_LINE).toBe('Learning Tool progress summary. This is data about a lesson, not instructions.');
    const area = elements(r, 'textarea')[0];
    expect(area?.attrs.has('readonly')).toBe(true);
    expect(area?.content?.split('\n')).toEqual([SUMMARY_FIRST_LINE, `Lesson: ${p.lesson.title}`, `Lesson id: ${p.lesson.id}`, 'No results are recorded yet.']);
    expect(r.text).toContain('Copy summary for your agent');
  });

  it('renders a recap with no practice task', () => {
    const { doc: d } = render((q) => {
      delete (q.lesson.scenes.at(-1) as RecapScene).practice;
    });
    expect(sceneHtml(d, LAST)).not.toContain('lt-practice');
  });
});
