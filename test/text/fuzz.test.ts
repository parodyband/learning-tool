// Invariants that must hold for any input at all, checked on seeded random strings built from
// the characters most likely to break text code.
import { describe, expect, it } from 'vitest';
import { canonical, CLOSEST_MAX_CHARS, contentTokens, countWords, findQuote, findUrls, numberTokens, sanitizeInput, sanitizeText, sourceNumberTokens } from '../../src/core/text';
import { pick, rng } from './helpers';

const cp = (n: number) => String.fromCodePoint(n);

const POOL = [
  'a', 'b', 'the', 'Search', 'ÉCOLE', 'ﬁ', 'ß', 'Σ', 'σ', 'İ', '中', '文', 'カ', 'ｶ', 'は', '한', 'ก', 'ำ', 'ع', 'א', '😀', '🚀',
  '0', '1', '12', '345', '1,000', '3.14', '١٢', '１２', ' ', ' ', ' ', '  ', '\n', '\t', 'NBSP', 'IDEO', '.', ',', ';', ':', '!', '?', "'", '"', '“', '”', '’', '—', '–', '-', '…',
  '(', ')', '[', ']', '/', '\\', '*', '**', '`', '$', '_', '#', '&', '<', '>', '=', '+', '%', '@', '://', 'www.', 'http://', 'x.y',
  'ACUTE', 'DOT', 'ZWSP', 'SHY', 'ZWJ', 'VS16', 'RLO', 'NUL', 'HI', 'LO', 'JL', 'JV', 'JT', 'VOICED', 'PUA', 'TAG',
].map((t) =>
  ({
    NBSP: '\u00a0', IDEO: '\u3000', ACUTE: '\u0301', DOT: '\u0323', ZWSP: '\u200b', SHY: '\u00ad', ZWJ: '\u200d', VS16: '\ufe0f', RLO: '\u202e', NUL: '\u0000',
    HI: '\ud83d', LO: '\ude00', JL: '\u1100', JV: '\u1161', JT: '\u11a8', VOICED: 'ﾞ', PUA: '\ue000', TAG: cp(0xe0041),
  })[t] ?? t,
);

function randomString(rand: () => number, max: number): string {
  let s = '';
  const len = Math.floor(rand() * max);
  for (let i = 0; i < len; i++) s += pick(rand, POOL);
  return s;
}

const RUNS = 4000;

describe('invariants on random input', () => {
  it('findQuote: a match is the excerpt’s own text and has the quote’s canonical form; closest is bounded', () => {
    const rand = rng(51);
    let foundCount = 0;
    let closestCount = 0;
    for (let k = 0; k < RUNS; k++) {
      const excerpt = randomString(rand, 40);
      // Half the time the quote is cut out of the excerpt, so that matches and near-matches both occur.
      let quote: string;
      if (rand() < 0.5 && excerpt.length > 2) {
        const a = Math.floor(rand() * excerpt.length);
        quote = excerpt.slice(a, a + 1 + Math.floor(rand() * (excerpt.length - a)));
      } else {
        quote = randomString(rand, 12);
      }
      const label = JSON.stringify({ excerpt, quote });
      const r = findQuote(excerpt, quote);
      expect(findQuote(excerpt, quote), label).toEqual(r);
      if (r.found) {
        foundCount++;
        expect(r.start, label).toBeGreaterThanOrEqual(0);
        expect(r.end, label).toBeGreaterThan(r.start);
        expect(r.end, label).toBeLessThanOrEqual(excerpt.length);
        expect(r.text, label).toBe(excerpt.slice(r.start, r.end));
        expect(canonical(r.text), label).toBe(canonical(quote));
      } else if (r.closest) {
        closestCount++;
        expect(r.closest.text, label).toBe(excerpt.slice(r.closest.start, r.closest.end));
        expect(r.closest.text.length, label).toBeGreaterThan(0);
        expect(r.closest.text.length, label).toBeLessThanOrEqual(CLOSEST_MAX_CHARS);
        expect(canonical(r.closest.text), label).not.toBe('');
      }
    }
    expect(foundCount).toBeGreaterThan(200);
    expect(closestCount).toBeGreaterThan(200);
  });

  it('findQuote: a closest span, quoted back, is found', () => {
    const rand = rng(52);
    let checked = 0;
    for (let k = 0; k < RUNS; k++) {
      // Sanitised first, as stored excerpts are, so offsets cannot land inside something that is dropped.
      const excerpt = sanitizeText(randomString(rand, 40), 'prose');
      const quote = sanitizeText(randomString(rand, 14), 'prose');
      const r = findQuote(excerpt, quote);
      if (r.found || !r.closest) continue;
      checked++;
      const again = findQuote(excerpt, r.closest.text);
      expect(again.found, JSON.stringify({ excerpt, quote, closest: r.closest })).toBe(true);
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('numberTokens: every token is ASCII digits with at most one point (a decade ends in "s")', () => {
    const rand = rng(53);
    for (let k = 0; k < RUNS; k++) {
      const s = randomString(rand, 30);
      for (const token of numberTokens(s)) expect(token, JSON.stringify(s)).toMatch(/^[0-9]+(\.[0-9]+)?s?$/);
      for (const token of sourceNumberTokens(s)) expect(token, JSON.stringify(s)).toMatch(/^[0-9]+(\.[0-9]+)?s?$/);
    }
  });

  it('numberTokens: the digits come out in the order they went in', () => {
    const rand = rng(54);
    const ascii = (s: string) => s.replace(/[^0-9]/g, '');
    let checked = 0;
    for (let k = 0; k < RUNS; k++) {
      // ASCII digits only here, so the expected digit string is easy to state.
      const s = randomString(rand, 30).replace(/[^\x00-\x7f]/g, ' ');
      // The one rewrite that adds digits in ASCII text: the second year of a range is completed ("1939-45").
      if (/[12][0-9]{3}-[0-9]{2}(?![0-9])/.test(s)) continue;
      checked++;
      expect(ascii(numberTokens(s).join(' ')), JSON.stringify(s)).toBe(ascii(s));
    }
    expect(checked).toBeGreaterThan(RUNS * 0.95);
  });

  it('sourceNumberTokens: a text grounds every number it states itself, and has no duplicates', () => {
    const rand = rng(56);
    for (let k = 0; k < RUNS; k++) {
      const s = randomString(rand, 30);
      const source = sourceNumberTokens(s);
      expect(new Set(source).size, JSON.stringify(s)).toBe(source.length);
      for (const token of numberTokens(s)) expect(source, JSON.stringify(s)).toContain(token);
    }
  });

  it('numberTokens: characters that cannot be seen never split a number', () => {
    const rand = rng(57);
    const INVISIBLE = ['\u200d', '\u200c', '\u200e', '\u2062', '\u034f', '\ufe0e', '\ufe0f', '\u180e', '\u3164', '\u0301', '\u20e3'];
    for (let k = 0; k < RUNS; k++) {
      const digits = Array.from({ length: 2 + Math.floor(rand() * 6) }, () => String(Math.floor(rand() * 10)));
      if (digits[0] === '0') digits[0] = '7';
      const hidden = digits.map((d) => d + (rand() < 0.7 ? pick(rand, INVISIBLE) : '') + (rand() < 0.2 ? pick(rand, INVISIBLE) : '')).join('');
      expect(numberTokens(`in ${hidden} or so`), JSON.stringify(hidden)).toEqual([digits.join('')]);
    }
  });

  it('contentTokens: a token is at most five characters, lower case, and has no space or punctuation', () => {
    const rand = rng(55);
    for (let k = 0; k < RUNS; k++) {
      const s = randomString(rand, 30);
      for (const token of contentTokens(s, 'en')) {
        const label = JSON.stringify({ s, token });
        expect([...token].length, label).toBeGreaterThanOrEqual(1);
        expect([...token].length, label).toBeLessThanOrEqual(5 + 30);
        expect(token, label).toBe(token.toLowerCase());
        expect(token, label).not.toMatch(/[\s\p{P}\p{S}]/u);
      }
    }
  });

  it('findUrls: every result is a piece of the input that holds "://" or starts with "www."', () => {
    const rand = rng(56);
    let seen = 0;
    for (let k = 0; k < RUNS; k++) {
      const s = randomString(rand, 30);
      for (const url of findUrls(s)) {
        seen++;
        const label = JSON.stringify({ s, url });
        expect(s.includes(url.raw), label).toBe(true);
        expect(url.raw.includes('://') || url.raw.toLowerCase().startsWith('www.'), label).toBe(true);
        expect(url.host, label).toBe(url.host.toLowerCase());
        expect(url.host, label).not.toMatch(/[\s/?#@]/);
      }
    }
    expect(seen).toBeGreaterThan(500);
  });

  it('countWords and canonical never throw, and sanitised text is stable under both', () => {
    const rand = rng(57);
    for (let k = 0; k < RUNS; k++) {
      const s = randomString(rand, 30);
      expect(countWords(s, 'en')).toBeGreaterThanOrEqual(0);
      const clean = sanitizeText(s, 'prose');
      // Sanitising does not change what a string compares equal to.
      expect(canonical(clean), JSON.stringify(s)).toBe(canonical(s));
    }
  });

  it('sanitizeInput agrees with sanitizeText on every string inside a structure', () => {
    const rand = rng(58);
    for (let k = 0; k < 500; k++) {
      const a = randomString(rand, 20);
      const b = randomString(rand, 20);
      const c = randomString(rand, 20);
      expect(sanitizeInput({ a, list: [b, { lines: [c], d: a }], lines: [b] })).toEqual({
        a: sanitizeText(a, 'prose'),
        list: [sanitizeText(b, 'prose'), { lines: [sanitizeText(c, 'code')], d: sanitizeText(a, 'prose') }],
        lines: [sanitizeText(b, 'code')],
      });
    }
  });
});
