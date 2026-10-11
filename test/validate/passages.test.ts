// Review finding V6, and the counts the tools show an agent while it researches.
//
// Evidence is counted by passage, not by id: the same excerpt stored under "?ref=1", or cut one
// character shorter, is not a second source and does not buy six more uses. Honest evidence
// (different passages, of one page or of several) counts exactly as before. The same grouping is
// behind `evidenceUses`, the running count the server reports, and `urlChars` is the running count
// for the per-URL allowance.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_EVIDENCE } from '../../src/core/examples';
import { LIMITS as L } from '../../src/core/limits';
import type { Draft } from '../../src/core/types';
import { checkEvidence, checkLesson, evidenceUses, normalizeSourceUrl } from '../../src/core/validate';
import { applyPlan, errorCodes, exampleDraft, exampleScene, newDraft, saveEvidence, submit, warningCodes } from './helpers';

const PASSAGE = EXAMPLE_EVIDENCE[0]!.excerpt;
const PAGE = 'https://example.org/algorithms/binary-search';
const item = (url: string, excerpt = PASSAGE) => ({ url, title: 'Binary search (synthetic test source)', excerpt, via: 'page' });

/** A quick lesson of four scenes whose claim, quote, takeaway and explanation cite the given ids. `more` are further claims for the first scene. */
function quick(evidence: unknown[], cites: [claim: string, quote: string, takeaway: string, explanation: string], more: Array<[text: string, cite: string]> = []): Draft {
  const draft = newDraft({ topic: 'How binary search works', language: 'en', depth: 'quick', learner: { level: 'new', knows: 'Writes simple loops.', goal: 'Explain binary search.' } });
  for (const e of evidence) saveEvidence(draft, e);
  applyPlan(draft, {
    title: 'Binary search in five minutes',
    objectives: [{ id: 'o1', text: 'Say what binary search does on each pass' }],
    outline: [
      { id: 's1', kind: 'narration', purpose: 'The idea' },
      { id: 's2', kind: 'narration', purpose: 'In the source\'s words' },
      { id: 's3', kind: 'checkpoint', purpose: 'Check', question: 'single', objective: 'o1' },
      { id: 's4', kind: 'recap', purpose: 'Recap' },
    ],
  });
  const scenes = [
    { id: 's1', kind: 'narration', title: 'The idea', blocks: [{ type: 'claim', text: 'Binary search compares the target with the middle element of a sorted array.', cites: [cites[0]] }, ...more.map(([text, cite]) => ({ type: 'claim', text, cites: [cite] }))] },
    { id: 's2', kind: 'narration', title: 'In the source\'s words', blocks: [{ type: 'quote', text: 'discarding the half that cannot', cite: cites[1] }] },
    {
      id: 's3', kind: 'checkpoint', title: 'Check: what happens on a pass?', objective: 'o1', level: 'recall',
      question: {
        type: 'single', prompt: 'What does binary search do with the half that cannot hold the target?',
        options: [
          { text: 'It discards that half', correct: true, feedback: 'Yes: the half that cannot contain the target is discarded.' },
          { text: 'It searches that half first', correct: false, feedback: 'That half cannot contain the target, so searching it gains nothing.', misconception: 'Thinks both halves are searched' },
          { text: 'It sorts that half again', correct: false, feedback: 'The array is already sorted; nothing is sorted during the search.', misconception: 'Confuses searching with sorting' },
        ],
        explanation: { text: 'The target is compared with the middle element and the half that cannot contain it is discarded.', cites: [cites[3]] },
      },
    },
    { id: 's4', kind: 'recap', title: 'What you can do now', takeaways: [{ objective: 'o1', text: 'Compare with the middle element and discard the half that cannot contain the target.', cites: [cites[2]] }], next: [{ topic: 'Big-O notation', why: 'To say how the cost grows.' }] },
  ];
  for (const scene of scenes) expect(submit(draft, scene).errors, scene.id).toEqual([]);
  return draft;
}

describe('a "?" with nothing after it is not another address', () => {
  it('the normal form of a URL drops an empty query and a fragment, and keeps a real query', () => {
    const url = (raw: string) => (normalizeSourceUrl(raw) as { url: string }).url;
    expect(url(`${PAGE}?`)).toBe(PAGE);
    expect(url(`${PAGE}?#top`)).toBe(PAGE);
    expect(url(`${PAGE}#top`)).toBe(PAGE);
    expect(url(`${PAGE}?ref=toc`)).toBe(`${PAGE}?ref=toc`);
    expect(url('https://wiki.example.org/index.php?title=Binary_search')).toBe('https://wiki.example.org/index.php?title=Binary_search');
  });

  it('the same passage saved under "page?" is answered with the id it already has', () => {
    const draft = newDraft();
    expect(saveEvidence(draft, item(PAGE))).toBe('e1');
    expect(checkEvidence(item(`${PAGE}?`), draft)).toMatchObject({ ok: true, duplicateOf: 'e1' });
    expect(checkEvidence(item(`${PAGE}?#top`), draft)).toMatchObject({ ok: true, duplicateOf: 'e1' });
    // A page that really is identified by its query stays a page of its own.
    expect(checkEvidence(item(`${PAGE}?page=2`), draft).duplicateOf).toBeUndefined();
  });
});

describe('the minimum number of sources is a number of different passages', () => {
  it('control: one passage under one id is too few for a quick lesson', () => {
    const report = checkLesson(quick([item(PAGE)], ['e1', 'e1', 'e1', 'e1']));
    expect(errorCodes(report)).toEqual(['EVIDENCE_TOO_FEW']);
    expect(report.errors[0]).toMatchObject({ got: '1', expected: 'at least 3' });
  });

  it('the same passage stored under three addresses is still one passage', () => {
    const draft = quick([item(PAGE), item(`${PAGE}?ref=toc`), item(`${PAGE}?ref=index`)], ['e1', 'e2', 'e3', 'e1']);
    expect(draft.evidence.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['EVIDENCE_TOO_FEW']);
    expect(report.errors[0]).toMatchObject({ got: '1', expected: 'at least 3' });
    expect(report.errors[0]!.message).toBe('The lesson cites 3 excerpts (e1, e2, e3), but e2, e3 hold a passage that another cited excerpt already holds, in whole or in part, so they are 1 different passage; a quick lesson needs at least 3.');
    expect(report.errors[0]!.fix).toContain('A passage stored again under another address, or cut shorter, is still one passage.');
    expect(report.ok).toBe(false);
  });

  it('the same passage cut a little shorter and stored again is still one passage', () => {
    const draft = quick([item(PAGE), item(PAGE, PASSAGE.slice(0, -1)), item(PAGE, PASSAGE.slice(0, -4))], ['e1', 'e2', 'e3', 'e1']);
    expect(draft.evidence).toHaveLength(3);
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['EVIDENCE_TOO_FEW']);
    expect(report.errors[0]).toMatchObject({ got: '1' });
  });

  it('a stored passage that only repeats a cited one is not offered as the way out', () => {
    const draft = quick([item(PAGE), item(`${PAGE}?ref=toc`), item('https://example.com/notes/when-binary-search-fails', EXAMPLE_EVIDENCE[2]!.excerpt)], ['e1', 'e1', 'e1', 'e1']);
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['EVIDENCE_TOO_FEW']);
    expect(report.errors[0]!.fix).toContain('(stored and uncited: e3)');
  });

  const OTHER = [
    'Each comparison halves the remaining search interval, so the half that cannot hold the target is never looked at again.',
    'On unsorted data the half that is discarded may contain the target, so binary search needs the middle element to split sorted data.',
  ];
  const MORE: Array<[string, string]> = [
    ['Every comparison halves the interval that is still to be searched.', 'e2'],
    ['On unsorted data the discarded half may still hold the target.', 'e3'],
  ];

  it('three different passages count as three, whether they come from one page or from three', () => {
    for (const urls of [[PAGE, PAGE, PAGE], [PAGE, 'https://example.com/notes/halving', 'https://example.net/blog/sorted-data']]) {
      const draft = quick([item(urls[0]!), item(urls[1]!, OTHER[0]), item(urls[2]!, OTHER[1])], ['e1', 'e1', 'e2', 'e1'], MORE);
      const report = checkLesson(draft);
      expect(report.errors, urls.join(' ')).toEqual([]);
      expect(report.stats.sources).toBe(3);
    }
  });

  it('two passages that overlap without one holding the other are two passages', () => {
    const first = 'Binary search finds a target value in a sorted array by repeatedly comparing the target with the middle element and discarding the half that cannot hold it.';
    const second = 'By repeatedly comparing the target with the middle element and discarding the half that cannot contain it, each comparison halves the interval.';
    const draft = quick([item(PAGE, first), item(PAGE, second), item(PAGE, OTHER[1])], ['e1', 'e1', 'e2', 'e1'], MORE);
    expect(checkLesson(draft).errors).toEqual([]);
  });

  it('the example lesson and its counts are unchanged', () => {
    const report = checkLesson(exampleDraft());
    expect(report.errors).toEqual([]);
    expect(report.stats).toMatchObject({ sources: 5, pages: 5, hosts: 3 });
  });
});

describe('six uses is a limit on a passage, however many ids hold it', () => {
  it('a passage stored under two ids cannot support twelve statements', () => {
    const draft = exampleDraft();
    // e1 is cited by six items of the example. The same passage under another address gets id e6.
    const copy = saveEvidence(draft, { ...EXAMPLE_EVIDENCE[0], url: `${EXAMPLE_EVIDENCE[0]!.url}?ref=toc` });
    expect(copy).toBe('e6');
    const s7 = exampleScene('s7');
    s7.blocks.push({ type: 'claim', text: 'Each comparison is made against the middle element of a sorted array.', cites: ['e6'] });
    expect(submit(draft, s7).errors).toEqual([]);
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['EVIDENCE_OVERUSED']);
    expect(report.errors[0]!.message).toContain('e1, e6 hold the same passage and are together cited by 7 items');
    expect(report.errors[0]!.message).toContain('one passage may support at most 6');
    expect(report.errors[0]!.fix).toContain('Storing a passage a second time does not add to what it may support.');
    expect(evidenceUses(draft)).toMatchObject({ e1: 7, e6: 7 });
  });

  it('one item that cites both ids of a passage is one use', () => {
    const draft = exampleDraft();
    saveEvidence(draft, { ...EXAMPLE_EVIDENCE[0], url: `${EXAMPLE_EVIDENCE[0]!.url}?ref=toc` });
    const s1 = exampleScene('s1');
    s1.blocks[1].cites = ['e1', 'e6'];
    expect(submit(draft, s1).errors).toEqual([]);
    expect(checkLesson(draft).errors).toEqual([]);
    expect(evidenceUses(draft)).toMatchObject({ e1: 6, e6: 6 });
  });

  it('different passages keep their own six uses each', () => {
    const draft = exampleDraft();
    expect(evidenceUses(draft)).toEqual({ e1: 6, e2: 5, e3: 4, e4: 1, e5: 2 });
    expect(checkLesson(draft).errors).toEqual([]);
  });
});

describe('evidenceUses: the count the tools show, as EVIDENCE_OVERUSED counts it', () => {
  it('lists every stored id in id order, an unused one with 0', () => {
    const draft = exampleDraft();
    for (const e of EXAMPLE_EVIDENCE.slice(0, 2)) saveEvidence(draft, { ...e, url: e.url.replace('example.org', 'mirror.example.org'), excerpt: `${e.excerpt} A further sentence that makes this another passage.` });
    expect(evidenceUses(draft)).toEqual({ e1: 6, e2: 5, e3: 4, e4: 1, e5: 2, e6: 0, e7: 0 });
    expect(Object.keys(evidenceUses(draft))).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7']);
  });

  it('counts blocks, figures, explanations, model answers and takeaways, and not an example\'s basedOn', () => {
    const draft = exampleDraft();
    // In the example e5 is cited by one claim and one figure (s5), and pointed at by one example.
    expect(evidenceUses(draft).e5).toBe(2);
    const s5 = exampleScene('s5');
    s5.blocks[2].basedOn = ['e2'];
    s5.figure.cites = ['e2'];
    expect(submit(draft, s5).errors).toEqual([]);
    expect(evidenceUses(draft).e5).toBe(1);
  });

  it('agrees with the error: the number in EVIDENCE_OVERUSED is the number it reports', () => {
    const draft = exampleDraft();
    const s7 = exampleScene('s7');
    s7.blocks.push({ type: 'claim', text: 'Each comparison is made against the middle element of a sorted array.', cites: ['e1'] });
    expect(submit(draft, s7).errors).toEqual([]);
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['EVIDENCE_OVERUSED']);
    expect(report.errors[0]!.got).toBe(String(evidenceUses(draft).e1));
    expect(evidenceUses(draft).e1).toBe(L.usesPerEvidence + 1);
  });

  it('counts only the scenes the plan still has, and is all zeros before anything is written', () => {
    const draft = exampleDraft();
    draft.outline = draft.outline.filter((entry) => entry.id !== 's8');
    expect(evidenceUses(draft).e1).toBe(5);
    const empty = exampleDraft();
    empty.scenes = [];
    expect(evidenceUses(empty)).toEqual({ e1: 0, e2: 0, e3: 0, e4: 0, e5: 0 });
    expect(evidenceUses(newDraft())).toEqual({});
  });

  it('never changes the draft', () => {
    const draft = exampleDraft();
    const before = JSON.stringify(draft);
    evidenceUses(draft);
    expect(JSON.stringify(draft)).toBe(before);
  });
});

describe('pages: distinct source addresses, beside passages and sites', () => {
  const OTHER = [
    'Each comparison halves the remaining search interval, so the half that cannot hold the target is never looked at again.',
    'On unsorted data the half that is discarded may contain the target, so binary search needs the middle element to split sorted data.',
  ];
  const MORE: Array<[string, string]> = [
    ['Every comparison halves the interval that is still to be searched.', 'e2'],
    ['On unsorted data the discarded half may still hold the target.', 'e3'],
  ];

  it('several passages of one page are one page', () => {
    const onePage = checkLesson(quick([item(PAGE), item(PAGE, OTHER[0]), item(PAGE, OTHER[1])], ['e1', 'e1', 'e2', 'e1'], MORE));
    expect(onePage.errors).toEqual([]);
    expect(onePage.stats).toMatchObject({ sources: 3, pages: 1, hosts: 1 });
    expect(warningCodes(onePage)).toEqual(['SINGLE_HOST']);

    const threePages = checkLesson(quick([item(PAGE), item(`${PAGE}-cost`, OTHER[0]), item('https://example.com/notes/sorted', OTHER[1])], ['e1', 'e1', 'e2', 'e1'], MORE));
    expect(threePages.errors).toEqual([]);
    expect(threePages.stats).toMatchObject({ sources: 3, pages: 3, hosts: 2 });
  });

  it('the three counts describe the same set, the evidence the lesson carries', () => {
    // An example may point at a passage (basedOn) that nothing cites: it is published, so it is counted.
    const draft = exampleDraft();
    saveEvidence(draft, { url: 'https://docs.example.io/search/overview', title: 'Search overview (synthetic test source)', via: 'page', excerpt: 'Searching a sorted collection can skip most of its elements, which is the idea behind every divide and conquer search.' });
    const s5 = exampleScene('s5');
    s5.blocks[2].basedOn = ['e2', 'e5', 'e6'];
    expect(submit(draft, s5).errors).toEqual([]);
    const report = checkLesson(draft);
    expect(report.errors).toEqual([]);
    expect(report.lesson!.evidence.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
    expect(report.stats).toMatchObject({ sources: 6, pages: 6, hosts: 4 });
  });

  it('a report with nothing in it counts no pages', () => {
    expect(checkLesson(newDraft()).stats.pages).toBe(0);
  });
});

describe('urlChars: what is stored from one address, against the allowance', () => {
  it('a new item reports the total including itself', () => {
    const draft = newDraft();
    const first = checkEvidence(item(PAGE), draft);
    expect(first.urlChars).toEqual({ used: PASSAGE.length, max: L.excerptCharsPerUrl });
    saveEvidence(draft, item(PAGE));
    const second = checkEvidence(item(PAGE, EXAMPLE_EVIDENCE[1]!.excerpt), draft);
    expect(second.urlChars).toEqual({ used: PASSAGE.length + EXAMPLE_EVIDENCE[1]!.excerpt.length, max: 2000 });
    // Another address has its own allowance.
    expect(checkEvidence(item(`${PAGE}-cost`, EXAMPLE_EVIDENCE[1]!.excerpt), draft).urlChars).toEqual({ used: EXAMPLE_EVIDENCE[1]!.excerpt.length, max: 2000 });
  });

  it('a repeat and a refusal store nothing, and report what the address holds as it is', () => {
    const draft = newDraft();
    const long = (n: number) => `Passage ${'abc'[n]} of the long read. ${'x'.repeat(800)}`.slice(0, 800);
    saveEvidence(draft, item(PAGE, long(0)));
    saveEvidence(draft, item(PAGE, long(1)));
    expect(checkEvidence(item(PAGE, long(1)), draft)).toMatchObject({ ok: true, duplicateOf: 'e2', urlChars: { used: 1600, max: 2000 } });
    const over = checkEvidence(item(PAGE, long(2)), draft);
    expect(errorCodes(over)).toEqual(['EVIDENCE_URL_QUOTA']);
    expect(over.urlChars).toEqual({ used: 1600, max: 2000 });
  });

  it('an item that is not a valid source has no count', () => {
    expect(checkEvidence(item('http://localhost/notes'), newDraft()).urlChars).toBeUndefined();
    expect(checkEvidence({ url: PAGE }, newDraft()).urlChars).toBeUndefined();
  });
});
