// Quotes and claims against their excerpts. For each rule: the dishonest case is refused, and the
// honest case next to it, the one a careful agent would actually write, is accepted.
import { describe, expect, it } from 'vitest';
import { LIMITS as L } from '../../src/core/limits';
import { contentTokens, countWords } from '../../src/core/text';
import type { Draft } from '../../src/core/types';
import { checkLesson, checkScene } from '../../src/core/validate';
import { codes, errorCodes, exampleDraft, exampleScene, expectNoExcerptText, submit, warningCodes } from './helpers';

/** A draft with one extra excerpt full of typographic characters, as copied from a real page. */
function typographic(): Draft {
  const draft = exampleDraft();
  draft.evidence.push({
    ...draft.evidence[2]!,
    id: 'e6',
    url: 'https://example.com/notes/typography',
    excerpt: 'Knuth wrote that “the idea is comparatively straightforward” — yet the details can be “surprisingly tricky”; it wasn’t until 1962 that a bug\u2011free version appeared, ﬁrst in print… and later in code.',
  });
  return draft;
}

const quoteScene = (text: string, cite = 'e6') => {
  const s = exampleScene('s7');
  s.blocks[1] = { type: 'quote', text, cite };
  return s;
};

describe('quotes', () => {
  it.each([
    ['straight quotes for curly ones', 'wrote that "the idea is comparatively straightforward"', 'wrote that “the idea is comparatively straightforward”'],
    ['a hyphen for the dash, and for the non-breaking hyphen', 'straightforward" - yet the details can be "surprisingly tricky"', 'straightforward” — yet the details can be “surprisingly tricky”'],
    ['a typed apostrophe', "it wasn't until 1962 that a bug-free version appeared", 'it wasn’t until 1962 that a bug\u2011free version appeared'],
    ['letters for the ligature, three dots for the ellipsis', 'first in print... and later in code', 'ﬁrst in print… and later in code'],
    ['different letter case', 'THE DETAILS CAN BE "SURPRISINGLY TRICKY"', 'the details can be “surprisingly tricky”'],
    ['white space from a line wrap', 'the details can be\n   “surprisingly   tricky”', 'the details can be “surprisingly tricky”'],
    ['a non-breaking space and a soft hyphen', 'a bug-free ver\u00adsion\u00a0appeared', 'a bug\u2011free version appeared'],
    ['decomposed accents elsewhere do not matter', 'Knuth wrote that “the idea is comparatively straightforward”', 'Knuth wrote that “the idea is comparatively straightforward”'],
  ])('accepted with %s, and stored in the source\'s own characters', (_what, typed, stored) => {
    const draft = typographic();
    const check = checkScene(quoteScene(typed), draft);
    expect(check.errors).toEqual([]);
    const block = (check.scene as any).blocks[1];
    expect(block.text).toBe(stored);
    expect(draft.evidence[5]!.excerpt).toContain(block.text);
  });

  it('what is stored is found again, unchanged, when the scene is checked later', () => {
    const draft = typographic();
    const first = submit(draft, quoteScene("it wasn't until 1962 that a bug-free version appeared"));
    const again = checkScene(first.scene, draft);
    expect(again.errors).toEqual([]);
    expect(again.scene).toEqual(first.scene);
  });

  it.each([
    ['a paraphrase', 'the idea is fairly simple but the details are hard'],
    ['one word changed', 'the idea is comparatively easy'],
    ['words in another order', 'straightforward is comparatively the idea'],
    ['a cut in the middle of a word', 'the idea is comparatively straight'],
    ['a number cut in two', 'it wasn’t until 196'],
    ['words that are in a different excerpt', 'the half that is discarded may contain the target'],
  ])('refused: %s', (_what, text) => {
    const draft = typographic();
    const check = checkScene(quoteScene(text), draft);
    expect(errorCodes(check)).toEqual(['QUOTE_NOT_FOUND']);
    expect(check.errors[0]!.path).toBe('blocks[1].text');
    expect(check.scene).toBeUndefined();
    expectNoExcerptText(check.errors, draft);
  });

  it('gives the nearest span of the excerpt as data, with offsets into it', () => {
    const draft = typographic();
    const check = checkScene(quoteScene('the idea is comparatively easy'), draft);
    const source = check.errors[0]!.source!;
    expect(source.evidenceId).toBe('e6');
    expect(draft.evidence[5]!.excerpt.slice(source.start, source.end)).toBe(source.text);
    expect(source.text).toContain('the idea is comparatively');
    expect(source.text.length).toBeLessThanOrEqual(160);
    // Copying that span exactly is accepted.
    expect(checkScene(quoteScene(source.text), draft).errors).toEqual([]);
  });

  it('says so when the words are in another stored excerpt', () => {
    const check = checkScene(quoteScene('the half that is discarded may contain the target'), typographic());
    expect(check.errors[0]!.fix).toBe('These words are in e3, not in e6. Set "cite" to "e3".');
    expect(check.errors[0]!.source).toBeUndefined();
  });

  it('says so when quotation marks or an ellipsis were wrapped around the words', () => {
    for (const text of ['"the half that is discarded may contain the target"', '“the half that is discarded may contain the target”', '... the half that is discarded may contain the target ...', '…the half that is discarded may contain the target…']) {
      const check = checkScene(quoteScene(text, 'e3'), exampleDraft());
      expect(errorCodes(check), text).toEqual(['QUOTE_NOT_FOUND']);
      expect(check.errors[0]!.fix).toContain('once the quotation marks or ellipsis around them are removed');
      expect(check.errors[0]!.source!.text).toBe('the half that is discarded may contain the target');
    }
  });

  it('says so when an ellipsis joins two passages', () => {
    const check = checkScene(quoteScene('Binary search only works when the data is sorted ... the result is unreliable', 'e3'), exampleDraft());
    expect(errorCodes(check)).toEqual(['QUOTE_NOT_FOUND']);
    expect(check.errors[0]!.fix).toContain('An ellipsis joins 2 separate passages of e3');
    expect(check.errors[0]!.source!.text).toBe('Binary search only works when the data is sorted');
  });

  it('a quote needs at least four words', () => {
    expect(L.quoteMinWords).toBe(4);
    const short = checkScene(quoteScene('may contain the', 'e3'), exampleDraft());
    expect(errorCodes(short)).toEqual(['QUOTE_TOO_SHORT']);
    expect(short.errors[0]).toMatchObject({ got: '3', expected: 'at least 4 words' });
    expect(checkScene(quoteScene('may contain the target', 'e3'), exampleDraft()).errors).toEqual([]);
  });

  it('a quote of the whole excerpt is a quote, not a copy', () => {
    const draft = exampleDraft();
    const check = checkScene(quoteScene(draft.evidence[2]!.excerpt, 'e3'), draft);
    expect(check.errors).toEqual([]);
  });

  it('a quote from an excerpt in another language is matched like any other', () => {
    const draft = exampleDraft();
    draft.evidence.push({ ...draft.evidence[2]!, id: 'e6', lang: 'de', url: 'https://example.com/notizen', excerpt: 'Die binäre Suche funktioniert nur, wenn die Daten sortiert sind; sonst ist das Ergebnis unzuverlässig.' });
    expect(checkScene(quoteScene('die binäre suche funktioniert nur, wenn die Daten sortiert sind'), draft).errors).toEqual([]);
    expect(errorCodes(checkScene(quoteScene('die binäre Suche funktioniert immer'), draft))).toEqual(['QUOTE_NOT_FOUND']);
  });

  it('word counts for a quote hold in a language written without spaces', () => {
    const draft = exampleDraft();
    draft.evidence.push({ ...draft.evidence[2]!, id: 'e6', lang: 'ja', url: 'https://example.com/ja', excerpt: '二分探索は、整列済みの配列の中央の要素と目標の値を比較し、目標を含み得ない半分を捨てることを繰り返して目標を見つける。' });
    expect(checkScene(quoteScene('目標を含み得ない半分を捨てる'), draft).errors).toEqual([]);
    expect(errorCodes(checkScene(quoteScene('半分'), draft))).toEqual(['QUOTE_TOO_SHORT']);
  });
});

describe('claims', () => {
  const claimScene = (text: string, cites: string[] = ['e1']) => {
    const s = exampleScene('s1');
    s.blocks[1] = { type: 'claim', text, cites };
    return s;
  };
  const E1 = 'Binary search finds a target value in a sorted array by repeatedly comparing the target with the middle element and discarding the half that cannot contain it.';

  it('the excerpt this section argues about is the first example excerpt', () => {
    expect(exampleDraft().evidence[0]!.excerpt).toBe(E1);
  });

  it.each([
    ['a restatement in the agent\'s own sentence, with the source\'s terms', 'Binary search looks at the middle of a sorted array and throws away the half where the value cannot be.'],
    ['a short claim that uses two of the source\'s terms', 'Binary search needs a sorted array.'],
    ['a claim that explains a consequence', 'Because half of the array is discarded each time, the search reaches the target after only a few comparisons.'],
    ['a claim that reuses most of the excerpt\'s vocabulary in another structure', 'To find a target, compare it with the middle element; the half of the sorted array that cannot contain the target is then discarded, and the search repeats.'],
    ['a claim with markup', 'Binary search compares the **target** with the *middle element* of a sorted `array`.'],
  ])('accepted: %s', (_what, text) => {
    const check = checkScene(claimScene(text), exampleDraft());
    expect(check.errors).toEqual([]);
    expect(check.warnings).toEqual([]);
  });

  it.each([
    ['the excerpt itself', E1],
    ['the excerpt with one word changed', E1.replace('finds', 'locates')],
    ['the excerpt reordered', 'By repeatedly comparing the target with the middle element and discarding the half that cannot contain it, binary search finds a target value in a sorted array.'],
    ['the excerpt with filler words added', `It is well known that ${E1.charAt(0).toLowerCase()}${E1.slice(1, -1)}, as you will see.`],
  ])('CLAIM_COPIES_SOURCE: %s', (_what, text) => {
    const draft = exampleDraft();
    const check = checkScene(claimScene(text), draft);
    expect(errorCodes(check)).toEqual(['CLAIM_COPIES_SOURCE']);
    expect(check.errors[0]!.path).toBe('blocks[1].text');
    expect(check.errors[0]!.fix).toContain('"type": "quote"');
    expectNoExcerptText(check.errors, draft);
  });

  it('the copy rule is about the limit in limits.ts, in both directions', () => {
    // Every content word of this claim is the excerpt's, but it covers only part of the excerpt.
    const partial = 'Binary search finds a target value in a sorted array.';
    const source = new Set(contentTokens(E1, 'en'));
    const mine = new Set(contentTokens(partial, 'en'));
    const shared = [...mine].filter((t) => source.has(t)).length;
    expect(shared / mine.size).toBeGreaterThanOrEqual(L.copyContainment);
    expect(shared / source.size).toBeLessThan(L.copyContainment);
    expect(checkScene(claimScene(partial), exampleDraft()).errors).toEqual([]);
  });

  it.each([
    ['a claim about something else entirely', 'Photosynthesis converts sunlight into chemical energy inside chloroplasts.'],
    ['a true statement on the topic that this excerpt does not make', 'Hash tables answer lookups faster on average.'],
  ])('CLAIM_UNRELATED: %s', (_what, text) => {
    const check = checkScene(claimScene(text), exampleDraft());
    expect(errorCodes(check)).toEqual(['CLAIM_UNRELATED']);
    expect(check.errors[0]!.path).toBe('blocks[1]');
    expect(check.scene).toBeUndefined();
  });

  it('points to the stored excerpt that does share the claim\'s terms, without saying to cite it blindly', () => {
    const check = checkScene(claimScene('Linear search checks every element in turn and works on unsorted data.', ['e4']), exampleDraft());
    expect(errorCodes(check)).toEqual(['CLAIM_UNRELATED']);
    // The honest way out comes first; the other passage is named after it, and only as a question.
    expect(check.errors[0]!.fix).toMatch(/^Save the passage that supports the claim and cite it, or delete the claim\. The stored excerpt e5 shares \d+ content words with this claim: cite e5 only if that passage is what supports it\./);
    expect(check.errors[0]!.fix).toContain('Do not reword the claim to borrow words from an excerpt that does not support it.');
  });

  it('CLAIM_WEAK_MATCH is a warning, and the claim is still accepted', () => {
    const check = checkScene(claimScene('Binary trees store hierarchical records inside balanced database indexes.'), exampleDraft());
    expect(check.errors).toEqual([]);
    expect(warningCodes(check)).toEqual(['CLAIM_WEAK_MATCH']);
    expect(check.warnings[0]!.path).toBe('blocks[1]');
    expect(check.ok).toBe(true);
  });

  it('one shared term in a short claim is not weak; one in a long claim is', () => {
    // 1 of 4 content words is 25%, above the 20% line.
    expect(codes(checkScene(claimScene('Binary numbers confuse beginners sometimes.'), exampleDraft()))).toEqual([]);
    expect(codes(checkScene(claimScene('Binary numbers confuse beginners because positional notation reverses their expectations.'), exampleDraft()))).toEqual(['CLAIM_WEAK_MATCH']);
  });

  it('several citations are judged together', () => {
    const text = 'Linear search checks every element, while each comparison of the other method halves the interval.';
    expect(checkScene(claimScene(text, ['e5', 'e2']), exampleDraft()).errors).toEqual([]);
    expect(codes(checkScene(claimScene(text, ['e4']), exampleDraft()))).toContain('CLAIM_UNRELATED');
  });

  it('a claim with no word long enough to compare is warned about, not refused', () => {
    const check = checkScene(claimScene('It is so.'), exampleDraft());
    expect(check.errors).toEqual([]);
    expect(warningCodes(check)).toEqual(['CLAIM_WEAK_MATCH']);
    expect(check.warnings[0]!.message).toContain('no word of four letters or more');
  });

  it('word overlap is not judged against an excerpt in another language, but numbers still are', () => {
    const draft = exampleDraft();
    draft.evidence.push({ ...draft.evidence[1]!, id: 'e6', lang: 'de', url: 'https://example.com/kosten', excerpt: 'Jeder Vergleich halbiert das verbleibende Intervall, daher genügen für 1.000.000 Elemente höchstens 20 Schritte.' });
    const ok = checkScene(claimScene('Each comparison halves what is left, so 1,000,000 elements take at most 20 steps.', ['e6']), draft);
    expect(codes(ok)).toEqual([]);
    const number = checkScene(claimScene('Each comparison halves what is left, so 1,000,000 elements take at most 25 steps.', ['e6']), draft);
    expect(errorCodes(number)).toEqual(['NUMBER_NOT_IN_SOURCE']);
    // The same excerpt marked as being in the lesson's language is compared as usual.
    draft.evidence[5] = { ...draft.evidence[5]!, lang: 'en-GB' };
    expect(codes(checkScene(claimScene('Photosynthesis converts sunlight into chemical energy inside chloroplasts.', ['e6']), draft))).toEqual(['CLAIM_UNRELATED']);
  });

  it('a claim may have 45 words and not 46', () => {
    const filler = (n: number) => `Binary search discards half of the sorted array ${Array.from({ length: n - 8 }, () => 'and').join(' ')}.`;
    const s = (n: number) => {
      const scene = exampleScene('s1');
      scene.blocks = [{ type: 'claim', text: filler(n), cites: ['e1'] }];
      return scene;
    };
    expect(countWords(filler(45), 'en')).toBe(45);
    expect(checkScene(s(45), exampleDraft()).errors).toEqual([]);
    const over = checkScene(s(46), exampleDraft());
    expect(errorCodes(over)).toEqual(['CLAIM_TOO_LONG']);
    expect(over.errors[0]).toMatchObject({ path: 'blocks[0].text', got: '46', expected: 'at most 45 words' });
  });

  it('claims in steps are checked like claims in narration, with their step in the path', () => {
    const s = exampleScene('s3');
    s.steps[4].blocks[1] = { type: 'claim', text: 'Photosynthesis converts sunlight into chemical energy inside chloroplasts.', cites: ['e2'] };
    const check = checkScene(s, exampleDraft());
    expect(errorCodes(check)).toEqual(['CLAIM_UNRELATED']);
    expect(check.errors[0]!.path).toBe('steps[4].blocks[1]');
  });
});

describe('weak claims across the lesson', () => {
  const WEAK: Array<[scene: string, block: number, text: string]> = [
    ['s1', 1, 'Binary trees store hierarchical records inside balanced database indexes.'],
    ['s2', 0, 'Sorted playlists help listeners locate favourite recordings without scrolling endlessly.'],
    ['s7', 2, 'Large spreadsheets frequently crash older laptops whenever formulas recalculate everything.'],
  ];
  const withWeak = (count: number) => {
    const draft = exampleDraft();
    for (const [id, block, text] of WEAK.slice(0, count)) {
      const s = exampleScene(id);
      s.blocks[block].text = text;
      const check = submit(draft, s);
      expect(check.errors).toEqual([]);
      expect(warningCodes(check)).toEqual(['CLAIM_WEAK_MATCH']);
    }
    return checkLesson(draft);
  };

  it('two weak claims are published with their warnings and listed for the player', () => {
    const report = withWeak(2);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(warningCodes(report)).toEqual(['CLAIM_WEAK_MATCH', 'CLAIM_WEAK_MATCH']);
    expect(report.weakClaims).toEqual(['s1/blocks[1]', 's2/blocks[0]']);
    expect(report.stats.weakClaims).toBe(2);
  });

  it('three, more than a quarter of the claims, stop the lesson', () => {
    const report = withWeak(3);
    expect(errorCodes(report)).toEqual(['TOO_MANY_WEAK_CLAIMS']);
    expect(report.ok).toBe(false);
    expect(report.lesson).toBeUndefined();
    expect(report.weakClaims).toEqual(['s1/blocks[1]', 's2/blocks[0]', 's7/blocks[2]']);
    expect(report.errors[0]!.message).toContain('3 of 8 claims');
  });
});

describe('references', () => {
  it('every place that names evidence is checked against what is stored', () => {
    const cases: Array<[id: string, path: string, edit: (s: any) => void]> = [
      ['s1', 'blocks[1].cites[0]', (s) => (s.blocks[1].cites = ['e9'])],
      ['s7', 'blocks[1].cite', (s) => (s.blocks[1].cite = 'e9')],
      ['s5', 'blocks[2].basedOn[1]', (s) => (s.blocks[2].basedOn = ['e2', 'e9'])],
      ['s2', 'figure.cites[0]', (s) => (s.figure.cites = ['e9'])],
      ['s3', 'steps[2].blocks[0].cites[1]', (s) => (s.steps[2].blocks[0].cites = ['e3', 'e9'])],
      ['s4', 'question.explanation.cites[0]', (s) => (s.question.explanation.cites = ['e9'])],
      ['s9', 'takeaways[1].cites[2]', (s) => (s.takeaways[1].cites = ['e2', 'e3', 'e9'])],
    ];
    for (const [id, path, edit] of cases) {
      const s = exampleScene(id);
      edit(s);
      const check = checkScene(s, exampleDraft());
      expect(errorCodes(check), path).toEqual(['CITE_UNKNOWN']);
      expect(check.errors[0]).toMatchObject({ path, got: 'e9' });
      expect(check.errors[0]!.fix).toContain('Stored ids: e1, e2, e3, e4, e5.');
    }
  });

  it('a model answer names its evidence too', () => {
    const draft = exampleDraft();
    draft.outline[3]!.question = 'reflect';
    const s = exampleScene('s4');
    s.question = { type: 'reflect', prompt: 'Why does sorted order matter here?', modelAnswer: { text: 'Sorted order is what lets one comparison rule out a half.', cites: ['e12'] }, lookFor: ['You mention sorted order', 'You mention ruling out a half'] };
    const check = checkScene(s, draft);
    expect(errorCodes(check)).toEqual(['CITE_UNKNOWN']);
    expect(check.errors[0]!.path).toBe('question.modelAnswer.cites[0]');
  });

  it('says to save evidence first when none is stored', () => {
    const draft = exampleDraft();
    draft.evidence = [];
    const check = checkScene(exampleScene('s8'), draft);
    expect(errorCodes(check)).toEqual(['CITE_UNKNOWN']);
    expect(check.errors[0]!.fix).toContain('No evidence is stored yet: call save_evidence first.');
  });

  it('a narration scene or a whole step-through with nothing cited is refused; one cited step is enough', () => {
    const narration = exampleScene('s7');
    narration.blocks = [narration.blocks[3]];
    expect(errorCodes(checkScene(narration, exampleDraft()))).toEqual(['SCENE_NO_CITED_BLOCK']);

    const steps = exampleScene('s3');
    steps.steps[2].blocks.shift();
    expect(checkScene(steps, exampleDraft()).errors).toEqual([]);
    steps.steps[4].blocks.pop();
    const none = checkScene(steps, exampleDraft());
    expect(errorCodes(none)).toEqual(['SCENE_NO_CITED_BLOCK']);
    expect(none.errors[0]!.path).toBe('steps');

    // A quote is as good as a claim.
    const quoted = exampleScene('s7');
    quoted.blocks = [quoted.blocks[1], quoted.blocks[3]];
    expect(checkScene(quoted, exampleDraft()).errors).toEqual([]);
  });
});
