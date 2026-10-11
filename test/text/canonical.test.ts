import { describe, expect, it } from 'vitest';
import { canonical, MAX_MARK_RUN, sanitizeText } from '../../src/core/text';
import { pick, rng } from './helpers';

const cp = (n: number) => String.fromCodePoint(n);

describe('canonical: the folds', () => {
  const cases: Array<[string, string, string]> = [
    ['plain ASCII is lowercased', 'Binary Search', 'binary search'],
    ['empty', '', ''],
    ['only white space', ' \n\t\u00a0 ', ''],
    ['collapses and trims white space', '  a \n\t b  ', 'a b'],
    ['line-wrap white space', 'halves the\r\n   remaining interval', 'halves the remaining interval'],
    ['no-break space', 'a\u00a0b', 'a b'],
    ['narrow no-break and thin spaces', '1\u202f000\u2009km', '1 000 km'],
    ['ideographic space', '二分\u3000探索', '二分 探索'],
    ['left and right single quotes', '‘it’s’', "'it's'"],
    ['left and right double quotes', '“quoted”', '"quoted"'],
    ['low-9 quotes', '„so“ ‚so‘', '"so" \'so\''],
    ['guillemets', '«oui» ‹non›', '"oui" \'non\''],
    ['prime and double prime', "5′ 10″", '5\' 10"'],
    ['reversed primes', '‵a‶', '\'a"'],
    ['modifier letter apostrophe', 'Hawaiʻi oʼclock', "hawai'i o'clock"],
    ['acute accent typed as an apostrophe', 'it´s', "it's"],
    ['fullwidth quotes', '＂a＂ ＇b＇', '"a" \'b\''],
    ['hyphen', 'well\u2010known', 'well-known'],
    ['non-breaking hyphen', 'well\u2011known', 'well-known'],
    ['figure dash', '555\u20121234', '555-1234'],
    ['en dash', '1914–1918', '1914-1918'],
    ['em dash', 'wait—what', 'wait-what'],
    ['horizontal bar', 'a―b', 'a-b'],
    ['minus sign', '−5', '-5'],
    ['fullwidth hyphen-minus', 'a－b', 'a-b'],
    ['small em dash and small hyphen', 'a﹘b﹣c', 'a-b-c'],
    ['two-em and three-em dashes', 'a⸺b⸻c', 'a-b-c'],
    ['wave dash', '1〜3', '1-3'],
    ['Hebrew maqaf and Armenian hyphen', 'a־b֊c', 'a-b-c'],
    ['ellipsis', 'wait… what', 'wait... what'],
    ['two dot leader', 'a‥b', 'a..b'],
    ['soft hyphen is dropped', 'dis\u00adcarded', 'discarded'],
    ['zero width space is dropped', 'dis\u200bcarded', 'discarded'],
    ['byte order mark and word joiner are dropped', '\ufeffa\u2060b', 'ab'],
    ['bidi controls are dropped', 'a\u202eb\u2066c\u2069', 'abc'],
    ['other controls are dropped', 'a\u0000b\u0007c', 'abc'],
    ['variation selector is dropped', '✌\ufe0f', '✌'],
    ['zero width joiner and non-joiner are dropped', 'می\u200cخواهم a\u200db', 'میخواهم ab'],
    ['lone surrogates are dropped', 'a\ud800b\udc00c', 'abc'],
    ['ligatures', 'ﬁnal ofﬁce ﬂow ﬀ ﬃ ﬄ ﬅ', 'final office flow ff ffi ffl st'],
    ['fullwidth letters and digits', 'ＡＢＣ１２３', 'abc123'],
    ['superscripts and fractions', 'x² ½', 'x2 1⁄2'],
    ['circled and squared forms', '① ㎏', '1 kg'],
    ['halfwidth katakana composes with its voiced mark', 'ｶﾞｷﾞ', 'ガギ'],
    ['Hangul compatibility jamo compose', 'ㄱㅏ', '가'],
    ['Hangul conjoining jamo compose', '\u1100\u1161\u11a8', '각'],
    ['NFD accents compose', 'e\u0301cole', 'école'],
    ['marks are reordered canonically', 'a\u0301\u0323', 'a\u0323\u0301'.normalize('NFC')],
    ['upper case with an accent', 'ÉCOLE', 'école'],
    ['German sharp s is not expanded', 'Straße STRASSE', 'straße strasse'],
    ['capital sharp s', 'STRAẞE', 'straße'],
    ['Greek final sigma is folded', 'ΟΔΟΣ οδός', 'οδοσ οδόσ'],
    ['dotted capital I uses the locale-independent mapping', 'İ', 'i\u0307'],
    ['Turkish dotless i is left alone', 'ı', 'ı'],
    ['Kelvin and Angstrom signs', '\u212a \u212b', 'k å'],
    ['a dash is not removed, only unified', 'a - b', 'a - b'],
    ['straight quotes stay', `"a" 'b'`, `"a" 'b'`],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(canonical(input)).toBe(expected);
  });
});

describe('canonical: strings a reader would call the same compare equal', () => {
  const groups: Array<[string, string[]]> = [
    ['quotes', ['“the half that is discarded”', '"the half that is discarded"', '„The Half That Is Discarded“', '«the half that is discarded»']],
    ['apostrophes', ["it's", 'it’s', 'it‘s', 'itʼs', 'it′s', 'it´s', 'IT＇S']],
    ['dashes', ['1914-1918', '1914–1918', '1914—1918', '1914−1918', '1914\u20101918', '1914\u20111918', '1914\u20121918', '1914―1918']],
    ['ellipsis', ['and so on...', 'and so on…', 'AND SO ON…']],
    ['white space', ['a b c', 'a  b\tc', 'a\nb\r\nc', ' a\u00a0b\u2003c ', 'a\u200b b\u00ad c']],
    ['normal forms', ['café', 'cafe\u0301', 'CAFÉ', 'CAFE\u0301', 'ｃａｆé']],
    ['ligature', ['office', 'ofﬁce', 'oﬃce', 'OFFICE']],
    ['Hangul', ['한국어', '한국어'.normalize('NFD'), '한국어'.normalize('NFKD')]],
    ['invisible characters', ['binary search', 'bi\u00adna\u200bry\u2060 sea\ufeffrch', '\u202abinary search\u202c']],
  ];
  it.each(groups)('%s', (_name, forms) => {
    const first = canonical(forms[0] as string);
    for (const form of forms) expect(canonical(form)).toBe(first);
  });

  const different: Array<[string, string, string]> = [
    ['a different word', 'discarded', 'discard'],
    ['a different number', '3.13', '313'],
    ['a hyphen is not a space', 'well-known', 'well known'],
    ['single and double quotes', "'a'", '"a"'],
    ['an accent matters', 'resume', 'résumé'],
    ['ß is not ss', 'straße', 'strasse'],
    ['joined words', 'binarysearch', 'binary search'],
  ];
  it.each(different)('but not %s', (_name, a, b) => {
    expect(canonical(a)).not.toBe(canonical(b));
  });
});

describe('canonical: combining marks', () => {
  it(`uses at most ${MAX_MARK_RUN} marks from one run`, () => {
    const long = canonical(`a${'\u0305'.repeat(500)}b`);
    expect(long).toBe(`a${'\u0305'.repeat(MAX_MARK_RUN)}b`);
  });
  it('a mark with nothing before it is kept as it is', () => {
    expect(canonical('\u0301a')).toBe('\u0301a');
  });
  it('a mark after a space stays with that space', () => {
    expect(canonical('a \u0301b')).toBe('a \u0301b');
  });
});

describe('canonical: exhaustive checks against the Unicode data in this runtime', () => {
  it('every character with a canonical decomposition has the same form composed and decomposed', () => {
    const bad: string[] = [];
    let checked = 0;
    for (let c = 0xa0; c <= 0x10ffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const ch = cp(c);
      const nfd = ch.normalize('NFD');
      if (nfd === ch) continue;
      checked++;
      if (canonical(nfd) !== canonical(ch)) bad.push(c.toString(16));
    }
    expect(bad).toEqual([]);
    // Latin, Greek, Cyrillic, Indic and kana composites, CJK compatibility ideographs, and 11,172 Hangul syllables.
    expect(checked).toBeGreaterThan(13_000);
  });

  it('every character has the same form in NFC, NFD, NFKC and NFKD, except the quote-like ones folded before NFKC', () => {
    // These are folded to a quote mark first, because NFKC would break them into pieces.
    const preFolded = new Set([0xb4, 0x1ffd, 0x2033, 0x2034, 0x2036, 0x2037, 0x2057]);
    const bad: string[] = [];
    for (let c = 0xa0; c <= 0x10ffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      // Unassigned planes: nothing to normalise.
      if (c >= 0x40000 && c < 0xe0000) continue;
      const ch = cp(c);
      const nfkd = ch.normalize('NFKD');
      if (nfkd === ch || preFolded.has(c)) continue;
      const want = canonical(ch);
      if (canonical(nfkd) !== want || canonical(ch.normalize('NFKC')) !== want || canonical(ch.normalize('NFD')) !== want) bad.push(c.toString(16));
    }
    expect(bad).toEqual([]);
  });

  it('what it drops is exactly: default-ignorable characters, non-space controls, private-use, noncharacters and lone surrogates', () => {
    const ignorable = /[\p{Default_Ignorable_Code_Point}\p{Co}\p{Noncharacter_Code_Point}]/u;
    const bad: string[] = [];
    for (let c = 0; c <= 0x10ffff; c++) {
      const ch = cp(c);
      const isSurrogate = c >= 0xd800 && c <= 0xdfff;
      const isSpaceControl = (c >= 0x09 && c <= 0x0d) || c === 0x85;
      const isControl = c < 0x20 || (c >= 0x7f && c <= 0x9f);
      const expectDropped = isSurrogate || ignorable.test(ch) || (isControl && !isSpaceControl);
      const dropped = canonical(`a${ch}b`) === 'ab';
      if (dropped !== expectDropped) bad.push(c.toString(16));
    }
    expect(bad).toEqual([]);
  });

  it('drops everything sanitizeText removes, so sanitising never changes what a string compares equal to', () => {
    const bad: string[] = [];
    for (let c = 0; c <= 0x10ffff; c++) {
      const s = `a${cp(c)}b`;
      if (canonical(sanitizeText(s, 'prose')) !== canonical(s)) bad.push(c.toString(16));
    }
    expect(bad).toEqual([]);
  });

  it('every dash punctuation character becomes a hyphen-minus', () => {
    const dash = /\p{Dash_Punctuation}/u;
    const bad: string[] = [];
    let seen = 0;
    for (let c = 0; c <= 0x10ffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const ch = cp(c);
      if (!dash.test(ch)) continue;
      seen++;
      if (canonical(`a${ch}b`) !== 'a-b') bad.push(c.toString(16));
    }
    expect(bad).toEqual([]);
    expect(seen).toBeGreaterThanOrEqual(25);
  });
});

describe('canonical: properties on random strings', () => {
  // Pieces that stress cluster boundaries: marks, jamo, compatibility forms, things that are dropped.
  const POOL = [
    'a', 'B', 'e', 'o', 'n', 'Σ', 'σ', 'İ', 'ß', '0', '7', ' ', ' ', '\n', '\u00a0', '\u3000', '\u200b', '\u00ad', '\u200d', '\ufe0f', '\u0000',
    '\u0301', '\u0323', '\u0308', '\u0327', '\u0338', '\u0345', '\u3099', 'ﾞ', 'ำ', 'é', 'ǆ', 'ﬁ', '½', '²', '…', '“', '’', '—', '\u2011', '−',
    'カ', 'ｶ', 'は', '中', '한', '\u1100', '\u1161', '\u11a8', 'ㄱ', 'ㅏ', '가', 'ก', 'ำ', '😀', cp(0x16d63), cp(0x16d67), cp(0x1d15e), cp(0x1d165),
  ];
  const randomString = (rand: () => number, max: number): string => {
    let s = '';
    const len = 1 + Math.floor(rand() * max);
    for (let i = 0; i < len; i++) s += pick(rand, POOL);
    return s;
  };

  it('does not depend on the normal form of its input (3,000 strings)', () => {
    const rand = rng(11);
    for (let k = 0; k < 3000; k++) {
      const s = randomString(rand, 24);
      const want = canonical(s);
      for (const form of ['NFC', 'NFD', 'NFKC', 'NFKD'] as const) {
        expect(canonical(s.normalize(form)), `${JSON.stringify(s)} as ${form}`).toBe(want);
      }
    }
  });

  it('is idempotent (3,000 strings)', () => {
    const rand = rng(12);
    for (let k = 0; k < 3000; k++) {
      const once = canonical(randomString(rand, 24));
      expect(canonical(once)).toBe(once);
    }
  });

  it('does not depend on case (3,000 strings)', () => {
    const rand = rng(13);
    for (let k = 0; k < 3000; k++) {
      const s = randomString(rand, 24);
      expect(canonical(s.toLowerCase()), JSON.stringify(s)).toBe(canonical(s));
    }
  });

  it('the form of two words is the two forms joined by a space (3,000 pairs)', () => {
    const rand = rng(14);
    const word = (): string => {
      // A word here starts with a letter, so it cannot attach to what came before it.
      let w = pick(rand, ['a', 'Σ', 'カ', '中', 'é', '한', 'ﬁ']);
      const len = Math.floor(rand() * 8);
      for (let i = 0; i < len; i++) {
        const piece = pick(rand, POOL);
        if (piece.trim() !== '' && piece !== '\u3000') w += piece;
      }
      return w;
    };
    for (let k = 0; k < 3000; k++) {
      const a = word();
      const b = word();
      const gap = pick(rand, [' ', '  ', '\n', '\u00a0 ', ' \u200b ', '\t']);
      expect(canonical(a + gap + b), JSON.stringify([a, gap, b])).toBe(`${canonical(a)} ${canonical(b)}`);
    }
  });
});
