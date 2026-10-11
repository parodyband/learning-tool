import { describe, expect, it } from 'vitest';
import { canonical, CLOSEST_MAX_CHARS, findQuote, sanitizeText } from '../../src/core/text';
import { pick, rng } from './helpers';

/** The matched text, or null. Also checks the contract every result must keep: offsets address the original excerpt. */
function found(excerpt: string, quote: string): string | null {
  const r = findQuote(excerpt, quote);
  if (!r.found) return null;
  expect(excerpt.slice(r.start, r.end)).toBe(r.text);
  expect(canonical(r.text)).toBe(canonical(quote));
  return r.text;
}

function closest(excerpt: string, quote: string): string | null {
  const r = findQuote(excerpt, quote);
  expect(r.found).toBe(false);
  if (r.found || !r.closest) return null;
  expect(excerpt.slice(r.closest.start, r.closest.end)).toBe(r.closest.text);
  expect(r.closest.text.length).toBeLessThanOrEqual(CLOSEST_MAX_CHARS);
  return r.closest.text;
}

describe('findQuote: the quote-matching corpus', () => {
  // [name, excerpt as the source has it, quote as an agent would type it, the excerpt's own characters that must come back]
  const corpus: Array<[string, string, string, string]> = [
    ['exact', 'Binary search only works when the data is sorted.', 'only works when the data is sorted', 'only works when the data is sorted'],
    ['the whole excerpt', 'Binary search only works when the data is sorted.', 'Binary search only works when the data is sorted.', 'Binary search only works when the data is sorted.'],
    ['different case', 'Binary Search only works when the data is sorted.', 'binary search ONLY works', 'Binary Search only'.concat(' works')],
    ['curly double quotes in the source', 'He called it “the half that cannot contain it” and moved on.', '"the half that cannot contain it"', '“the half that cannot contain it”'],
    ['curly quotes in the quote, straight in the source', 'He called it "the half" and moved on.', 'called it “the half”', 'called it "the half"'],
    ['curly apostrophe in the source', 'It doesn’t matter which half you keep.', "It doesn't matter", 'It doesn’t matter'],
    ['low and high German quotes', 'Er nannte es „die Hälfte“ und ging.', 'nannte es "die Hälfte"', 'nannte es „die Hälfte“'],
    ['guillemets', 'Il a dit «la moitié» puis il est parti.', 'dit "la moitié"', 'dit «la moitié»'],
    ['no-break space in the source', 'A list of 1\u00a0000\u00a0000 items is searched in 20\u00a0steps.', 'searched in 20 steps', 'searched in 20\u00a0steps'],
    ['narrow no-break space', 'about 20\u202f% of the time', 'about 20 % of the time', 'about 20\u202f% of the time'],
    ['en dash in the source', 'during the years 1914–1918 the front barely moved', 'the years 1914-1918 the front', 'the years 1914–1918 the front'],
    ['em dash in the source', 'the interval shrinks—by half—each time', 'shrinks-by half-each time', 'shrinks—by half—each time'],
    ['hyphen typed where the source has a real hyphen', 'a well\u2010known result', 'a well-known result', 'a well\u2010known result'],
    ['non-breaking hyphen', 'a fixed\u2011width integer', 'fixed-width integer', 'fixed\u2011width integer'],
    ['minus sign', 'the result is −1 when absent', 'the result is -1 when absent', 'the result is −1 when absent'],
    ['en dash in the quote, hyphen in the source', 'pages 10-20 cover it', 'pages 10–20 cover', 'pages 10-20 cover'],
    ['soft hyphen in the source', 'the half that is dis\u00adcarded may con\u00adtain the target', 'the half that is discarded may contain the target', 'the half that is dis\u00adcarded may con\u00adtain the target'],
    ['zero width space in the source', 'the mid\u200bpoint over\u200bflows', 'midpoint overflows', 'mid\u200bpoint over\u200bflows'],
    ['fi ligature in the source', 'the ﬁrst element of the ﬁnal interval', 'first element of the final interval', 'ﬁrst element of the ﬁnal interval'],
    ['ffi and fl ligatures', 'an e\ufb03cient work\ufb02ow', 'efficient workflow', 'e\ufb03cient work\ufb02ow'],
    ['ligature in the quote only', 'the first element', 'the ﬁrst element', 'the first element'],
    ['NFD source, NFC quote', 'le cafe\u0301 est ferme\u0301 le lundi', 'café est fermé', 'cafe\u0301 est ferme\u0301'],
    ['NFC source, NFD quote', 'le café est fermé le lundi', 'cafe\u0301 est ferme\u0301', 'café est fermé'],
    ['line-wrap white space in the source', 'Each comparison halves the\n    remaining search interval,\r\n so the cost is small.', 'halves the remaining search interval, so the cost', 'halves the\n    remaining search interval,\r\n so the cost'],
    ['line-wrap white space in the quote', 'halves the remaining search interval', 'halves the\nremaining   search\tinterval', 'halves the remaining search interval'],
    ['ellipsis character in the source', 'and so it goes… until one item is left', 'so it goes... until one', 'so it goes… until one'],
    ['ellipsis character in the quote', 'and so it goes... until one item is left', 'so it goes… until one', 'so it goes... until one'],
    ['fullwidth forms', 'ＣＰＵ time is ｎｏｔ free', 'CPU time is not free', 'ＣＰＵ time is ｎｏｔ free'],
    ['leading and trailing space in the quote', 'the data is sorted', '  the data  ', 'the data'],
    ['quote ends with the punctuation', 'It works. It is fast.', 'It works.', 'It works.'],
    ['quote starts after punctuation', 'First (and only then) compare.', 'and only then', 'and only then'],
    ['the first of several occurrences', 'the half, the half, the half', 'the half', 'the half'],
    ['a number with its separator', 'A sorted list of 1,000,000 items is searched in at most 20 steps.', 'list of 1,000,000 items', 'list of 1,000,000 items'],
    ['a decimal', 'pi is roughly 3.14159 in value', 'roughly 3.14159 in', 'roughly 3.14159 in'],
    ['up to a hyphen', 'a fixed-width integer', 'a fixed', 'a fixed'],
    ['Chinese, from the middle of a sentence', '他说二分查找在有序数组中查找目标值,非常快。', '二分查找在有序数组中', '二分查找在有序数组中'],
    ['Japanese, with halfwidth katakana in the source', '二分探索はｿｰﾄ済みの配列から値を探す。', 'ソート済みの配列', 'ｿｰﾄ済みの配列'],
    ['Thai, which has no spaces', 'การค้นหาแบบทวิภาคเร็วมาก', 'ทวิภาคเร็ว', 'ทวิภาคเร็ว'],
    ['Korean, composed and decomposed', '이진 검색은 정렬된 배열에서 동작한다'.normalize('NFD'), '검색은 정렬된 배열에서', '검색은 정렬된 배열에서'.normalize('NFD')],
    ['Arabic', 'البحث الثنائي يعمل فقط على البيانات المرتبة', 'يعمل فقط على البيانات', 'يعمل فقط على البيانات'],
    ['Greek with a final sigma', 'Η δυαδική αναζήτηση είναι γρήγορος αλγόριθμος', 'ΓΡΉΓΟΡΟΣ ΑΛΓΌΡΙΘΜΟΣ', 'γρήγορος αλγόριθμος'],
    ['an emoji', 'ship it 🚀 today', 'it 🚀 today', 'it 🚀 today'],
  ];
  it.each(corpus)('%s', (_name, excerpt, quote, expected) => {
    expect(found(excerpt, quote)).toBe(expected);
  });

  it.each(corpus)('%s, after the excerpt and quote are sanitised as the validator does', (_name, excerpt, quote) => {
    const stored = sanitizeText(excerpt, 'prose');
    const text = found(stored, sanitizeText(quote, 'prose'));
    expect(text).not.toBeNull();
    // What is stored and shown is taken from the stored excerpt, character for character.
    expect(stored.includes(text as string)).toBe(true);
  });
});

describe('findQuote: a quote must start and end on word boundaries', () => {
  const excerpt = "Binary search finds a target value. It costs 1,000 dollars, the dog's bowl is 3.14 m wide, and x2 is set.";
  const rejected: Array<[string, string, string]> = [
    ['starts inside a word', 'inary search finds', 'Binary search finds'],
    ['ends inside a word', 'Binary search fin', 'Binary search finds'],
    ['both ends inside words', 'earch find', 'search finds'],
    ['a single partial word', 'targe', 'target'],
    ['ends inside a number at a comma', 'costs 1', 'costs 1,000'],
    ['ends inside a number at a decimal point', 'bowl is 3', 'bowl is 3.14'],
    ['starts inside a number', '000 dollars', '1,000 dollars'],
    ['ends before a possessive', 'the dog', "the dog's"],
    ['splits a letter from a digit', 'and x', 'and x2'],
  ];
  it.each(rejected)('%s: not found, and closest is the whole words', (_name, quote, want) => {
    expect(closest(excerpt, quote)).toBe(want);
  });

  const accepted: Array<[string, string]> = [
    ['a sentence end', 'finds a target value.'],
    ['before a comma', 'costs 1,000 dollars'],
    ['the whole number', '1,000'],
    ['the possessive whole', "the dog's bowl"],
    ['up to a full stop that ends a sentence', 'Binary search finds a target value'],
  ];
  it.each(accepted)('%s is a boundary', (_name, quote) => {
    expect(found(excerpt, quote)).toBe(quote);
  });

  it('does not cut one original character in two: half of a ligature is not a match', () => {
    // "ﬁ" is one character in the source, so "f" cannot be quoted without "i".
    const r = findQuote('a ﬁsh', 'a f');
    expect(r.found).toBe(false);
  });

  it('skips an occurrence that cuts a word and takes a later one that does not', () => {
    const r = findQuote('the cathedral and the cat sat', 'the cat');
    expect(r).toEqual({ found: true, start: 18, end: 25, text: 'the cat' });
  });
});

describe('findQuote: offsets', () => {
  it('are UTF-16 offsets into the original excerpt', () => {
    const excerpt = '🚀 “Launch”\u00a0was  on\ntime — truly.';
    const r = findQuote(excerpt, '"launch" was on time - truly');
    expect(r.found).toBe(true);
    if (r.found) {
      expect(r.start).toBe(3);
      expect(r.end).toBe(excerpt.length - 1);
      expect(r.text).toBe('“Launch”\u00a0was  on\ntime — truly');
    }
  });

  it('a match ends before invisible characters that follow it', () => {
    const r = findQuote('first\u00ad\u200b second', 'first');
    expect(r).toEqual({ found: true, start: 0, end: 5, text: 'first' });
  });

  it('a combining sequence is never split', () => {
    const excerpt = 'cafe\u0301\u0323 noir';
    const r = findQuote(excerpt, 'café\u0323 noir');
    expect(r.found).toBe(true);
    // "cafe" alone is not a match: the accents belong to the e.
    expect(findQuote(excerpt, 'cafe').found).toBe(false);
  });
});

describe('findQuote: not found', () => {
  const none: Array<[string, string, string]> = [
    ['empty quote', 'Some excerpt text here.', ''],
    ['quote of white space only', 'Some excerpt text here.', ' \n '],
    ['empty excerpt', '', 'anything'],
    ['nothing in common', 'Binary search halves the interval.', 'QWXZ JKVP'],
    ['only a couple of letters in common', 'Binary search halves the interval.', 'zzzzzzzz he zzzzzzzzz'],
  ];
  it.each(none)('%s: no closest span', (_name, excerpt, quote) => {
    expect(findQuote(excerpt, quote)).toEqual({ found: false });
  });

  const near: Array<[string, string, string, string]> = [
    [
      'one word changed',
      'Binary search finds a target value in a sorted array by repeatedly comparing the target with the middle element.',
      'finds a target value in the sorted array by repeatedly comparing',
      'finds a target value in a sorted array by repeatedly comparing',
    ],
    [
      'a word left out',
      'On unsorted data the half that is discarded may contain the target, so the result is unreliable.',
      'the half that is discarded may contain target',
      'the half that is discarded may contain the',
    ],
    [
      'a paraphrased beginning',
      'Each comparison halves the remaining search interval, so an array of n elements needs few comparisons.',
      'every check halves the remaining search interval',
      'comparison halves the remaining search interval',
    ],
    [
      'the quote runs past the end of the excerpt',
      'Linear search checks every element in turn.',
      'checks every element in turn and needs up to n comparisons',
      'checks every element in turn.',
    ],
    [
      'the quote starts before the excerpt does',
      'every element in turn and needs up to n comparisons.',
      'Linear search checks every element in turn and needs',
      'every element in turn and needs',
    ],
    ['words joined that the source keeps apart', 'compare with the middle element of the array', 'the middleelement of the array', 'the middle element of the array'],
  ];
  it.each(near)('%s: closest is the nearby span of whole words', (_name, excerpt, quote, want) => {
    expect(closest(excerpt, quote)).toBe(want);
  });

  it('closest is itself a quote that would be found', () => {
    for (const [, excerpt, quote] of near) {
      const span = closest(excerpt, quote) as string;
      expect(found(excerpt, span)).toBe(span);
    }
  });

  it(`closest is at most ${CLOSEST_MAX_CHARS} characters and ends on a whole word`, () => {
    const sentence = 'The search interval is halved by every comparison that the algorithm makes while it runs. ';
    const excerpt = sentence.repeat(8).trim();
    const quote = excerpt.slice(0, 300).replace('halved', 'doubled');
    const span = closest(excerpt, quote) as string;
    expect(span.length).toBeLessThanOrEqual(CLOSEST_MAX_CHARS);
    expect(span.length).toBeGreaterThan(CLOSEST_MAX_CHARS - 20);
    expect(found(excerpt, span)).toBe(span);
  });

  it('a long quote whose shared text comes late still gets a closest span that contains it', () => {
    const excerpt = `${'Filler words that the quote does not share at all. '.repeat(6)}The unique closing phrase is right here.`;
    const quote = `${'Completely different opening material goes in this part. '.repeat(4)}The unique closing phrase is right here`;
    const span = closest(excerpt, quote) as string;
    expect(span).toContain('unique closing phrase is right here');
  });

  it('is deterministic', () => {
    const excerpt = 'alpha beta gamma delta, alpha beta gamma delta, alpha beta epsilon';
    const a = findQuote(excerpt, 'alpha beta gamma zeta');
    const b = findQuote(excerpt, 'alpha beta gamma zeta');
    expect(a).toEqual(b);
    // On a tie the earliest place in the excerpt wins.
    expect(a.found === false && a.closest?.start).toBe(0);
  });

  it('a single unbroken run longer than the limit is cut between characters', () => {
    const r = findQuote('x'.repeat(500), 'x'.repeat(200));
    expect(r.found).toBe(false);
    if (!r.found) expect(r.closest?.text).toBe('x'.repeat(CLOSEST_MAX_CHARS));
  });
});

describe('findQuote: round trip on random text', () => {
  const WORDS = ['binary', 'search', 'Ünïcode', 'ﬁnal', 'oﬃce', 'naïve', 'cafe\u0301', '“quoted”', 'it’s', '1,000', '3.14', 'well\u2011known', 'A–B', 'wait…', 'ΟΔΟΣ', 'straße', '二分探索', 'ｶﾞｷﾞ', 'ทวิภาค', '한국어', 'x²', 'co\u00adoperate', 'İstanbul', '🚀'];
  const GAPS = [' ', ' ', '  ', '\n', '\u00a0', ' \n  ', '\t', '\u2009'];
  const VARIANTS: Array<(s: string) => string> = [
    (s) => s,
    (s) => s.normalize('NFD'),
    (s) => s.normalize('NFKC'),
    // Upper case, except where that is not reversible (ß becomes SS).
    (s) => [...s].map((ch) => (ch.toUpperCase().toLowerCase() === ch.toLowerCase() ? ch.toUpperCase() : ch)).join(''),
    (s) => s.replace(/[“”]/g, '"').replace(/’/g, "'").replace(/[–\u2011]/g, '-').replace(/…/g, '...'),
    (s) => s.replace(/\u00ad/g, ''),
  ];

  it('any run of whole words is found, at exactly its place, however the quote is typed (2,000 cases)', () => {
    const rand = rng(21);
    for (let k = 0; k < 2000; k++) {
      const count = 3 + Math.floor(rand() * 10);
      const words: string[] = [];
      const starts: number[] = [];
      const ends: number[] = [];
      let excerpt = '';
      for (let w = 0; w < count; w++) {
        if (w > 0) excerpt += pick(rand, GAPS);
        const word = pick(rand, WORDS);
        starts.push(excerpt.length);
        excerpt += word;
        ends.push(excerpt.length);
        words.push(word);
      }
      const from = Math.floor(rand() * count);
      const to = from + 1 + Math.floor(rand() * (count - from));
      const quote = pick(rand, VARIANTS)(words.slice(from, to).join(' '));
      const r = findQuote(excerpt, quote);
      const label = JSON.stringify({ excerpt, quote });
      expect(r.found, label).toBe(true);
      if (!r.found) continue;
      expect(r.text, label).toBe(excerpt.slice(r.start, r.end));
      expect(canonical(r.text), label).toBe(canonical(quote));
      // The same words may occur earlier, so the match is at or before the place they were taken from.
      expect(r.start, label).toBeLessThanOrEqual(starts[from] as number);
      expect(starts, label).toContain(r.start);
      expect(ends, label).toContain(r.end);
    }
  });
});
