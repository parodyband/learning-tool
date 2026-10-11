import { describe, expect, it } from 'vitest';
import { MAX_INPUT_DEPTH, MAX_INPUT_NODES, MAX_MARK_RUN, SanitizeError, sanitizeInput, sanitizeText } from '../../src/core/text';
import { rng } from './helpers';

const cp = (n: number) => String.fromCodePoint(n);

describe('sanitizeText: what is removed, in both modes', () => {
  const removed: Array<[string, string]> = [
    ['C0 control NUL', '\u0000'],
    ['C0 control BEL', '\u0007'],
    ['C0 control ESC', '\u001b'],
    ['DEL', '\u007f'],
    ['C1 control', '\u0080'],
    ['C1 control CSI', '\u009b'],
    ['bidi embedding LRE', '\u202a'],
    ['bidi embedding RLE', '\u202b'],
    ['bidi pop PDF', '\u202c'],
    ['bidi override LRO', '\u202d'],
    ['bidi override RLO', '\u202e'],
    ['bidi isolate LRI', '\u2066'],
    ['bidi isolate RLI', '\u2067'],
    ['bidi isolate FSI', '\u2068'],
    ['bidi isolate PDI', '\u2069'],
    ['tag character', cp(0xe0001)],
    ['tag letter', cp(0xe0041)],
    ['cancel tag', cp(0xe007f)],
    ['zero width space', '\u200b'],
    ['word joiner', '\u2060'],
    ['byte order mark', '\ufeff'],
    ['soft hyphen', '\u00ad'],
    ['private use (BMP)', '\ue000'],
    ['private use (BMP, last)', '\uf8ff'],
    ['private use (plane 15)', cp(0xf0000)],
    ['private use (plane 16)', cp(0x10fffd)],
    ['noncharacter U+FDD0', '\ufdd0'],
    ['noncharacter U+FDEF', '\ufdef'],
    ['noncharacter U+FFFE', '\ufffe'],
    ['noncharacter U+FFFF', '\uffff'],
    ['noncharacter U+1FFFE', cp(0x1fffe)],
    ['noncharacter U+10FFFF', cp(0x10ffff)],
    ['lone high surrogate', '\ud83d'],
    ['lone low surrogate', '\ude00'],
  ];
  it.each(removed)('%s', (_name, ch) => {
    expect(sanitizeText(`ab${ch}cd`, 'prose')).toBe('abcd');
    expect(sanitizeText(`ab${ch}cd`, 'code')).toBe('abcd');
  });

  const kept: Array<[string, string]> = [
    ['an emoji outside the BMP', 'a😀b'],
    ['zero width joiner inside an emoji sequence', '👩\u200d💻'],
    ['zero width non-joiner (Persian)', 'می\u200cخواهم'],
    ['right-to-left mark', 'a\u200fb'],
    ['variation selector', '✌\ufe0f'],
    ['combining marks', 'e\u0301\u0323'.normalize('NFC')],
    ['CJK', '二分探索'],
    ['Arabic', 'البحث الثنائي'],
    ['supplementary ideograph', cp(0x20000)],
  ];
  it.each(kept)('keeps %s', (_name, s) => {
    expect(sanitizeText(s, 'prose')).toBe(s);
    expect(sanitizeText(s, 'code')).toBe(s);
  });
});

describe('sanitizeText: prose mode', () => {
  const cases: Array<[string, string, string]> = [
    ['plain text is untouched', 'Binary search halves the interval.', 'Binary search halves the interval.'],
    ['trims both ends', '  hello  ', 'hello'],
    ['collapses runs of spaces', 'a    b', 'a b'],
    ['newline becomes a space', 'line one\nline two', 'line one line two'],
    ['CRLF becomes one space', 'a\r\nb', 'a b'],
    ['tab becomes a space', 'a\tb', 'a b'],
    ['vertical tab and form feed', 'a\u000bb\u000cc', 'a b c'],
    ['NEL (a C1 line break)', 'a\u0085b', 'a b'],
    ['line separator', 'a\u2028b', 'a b'],
    ['paragraph separator', 'a\u2029b', 'a b'],
    ['no-break space', 'a\u00a0b', 'a b'],
    ['Ogham space mark', 'a\u1680b', 'a b'],
    ['en quad to hair space', 'a\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200ab', 'a b'],
    ['narrow no-break space', 'a\u202fb', 'a b'],
    ['medium mathematical space', 'a\u205fb', 'a b'],
    ['ideographic space', '二分\u3000探索', '二分 探索'],
    ['mixed white space collapses to one', 'a \u00a0\t\n b', 'a b'],
    ['a removed character between spaces does not leave two', 'a \u200b b', 'a b'],
    ['a removed character between letters joins them', 'co\u00adoperate', 'cooperate'],
    ['only white space', ' \n\t ', ''],
    ['only removed characters', '\u200b\u202e\ufeff', ''],
    ['empty', '', ''],
    ['a hidden right-to-left override is taken out of a file name', 'invoice\u202efdp.exe', 'invoicefdp.exe'],
    ['NFD input becomes NFC', 'e\u0301cole', 'école'],
    ['NFC composes after a removed character is taken out', 'e\u200b\u0301', 'é'],
    ['compatibility characters are not folded (that is canonical, not sanitise)', 'ﬁ ² Ｈ', 'ﬁ ² Ｈ'],
    ['curly quotes and dashes are kept', '“a” – b…', '“a” – b…'],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(sanitizeText(input, 'prose')).toBe(expected);
  });
});

describe('sanitizeText: code mode', () => {
  const cases: Array<[string, string, string]> = [
    ['keeps leading spaces', '    return mid', '    return mid'],
    ['keeps inner runs of spaces', 'x  =  1', 'x  =  1'],
    ['trims the end only', '  x = 1   ', '  x = 1'],
    ['a tab becomes four spaces', '\tif x:', '    if x:'],
    ['two tabs', '\t\treturn', '        return'],
    ['a tab inside the line', 'a\tb', 'a    b'],
    ['a line break inside a line becomes one space', 'a\nb', 'a b'],
    ['no-break space becomes a plain space, one for one', 'a\u00a0\u00a0b', 'a  b'],
    ['a trailing tab is trimmed', 'x\t', 'x'],
    ['controls are removed', 'a\u0000b\u001b[0m', 'ab[0m'],
    ['bidi controls are removed (the Trojan Source pattern)', 'if (access != "user\u202e \u2066// check\u2069 \u2066") {', 'if (access != "user // check ") {'],
    ['only white space', '  \t ', ''],
    ['NFC', 'cafe\u0301 = 1', 'café = 1'],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(sanitizeText(input, 'code')).toBe(expected);
  });
});

describe('sanitizeText: combining marks', () => {
  it(`keeps a run of ${MAX_MARK_RUN} marks and drops the rest`, () => {
    // U+0305 does not compose with "a", so the count is exact after NFC.
    const out = sanitizeText(`a${'\u0305'.repeat(200)}b`, 'prose');
    expect(out).toBe(`a${'\u0305'.repeat(MAX_MARK_RUN)}b`);
  });
  it('counts marks across characters that are removed between them', () => {
    const out = sanitizeText(`a${'\u0305\u200b'.repeat(200)}b`, 'prose');
    expect(out).toBe(`a${'\u0305'.repeat(MAX_MARK_RUN)}b`);
  });
  it('a new base character starts a new run', () => {
    const s = `${`a${'\u0305'.repeat(MAX_MARK_RUN)}`.repeat(5)}`;
    expect(sanitizeText(s, 'prose')).toBe(s);
  });
  it('stays within the bound when NFC splits one mark into two', () => {
    // U+0344 is replaced by U+0308 U+0301 under NFC.
    const out = sanitizeText(`a${'\u0344'.repeat(MAX_MARK_RUN)}`, 'prose');
    expect(sanitizeText(out, 'prose')).toBe(out);
    expect([...out].length).toBeLessThanOrEqual(1 + MAX_MARK_RUN);
  });
});

describe('sanitizeText: properties', () => {
  const POOL = [
    'a', 'b', 'Z', '0', ' ', ' ', '\t', '\n', '\u00a0', '\u3000', '\u200b', '\u00ad', '\u202e', '\u2066', '\u0000', '\u0085', '\ufeff', '\ue000', '\ud800', '\udc00',
    'e\u0301', '\u0301', '\u0323', '\u0344', '\u0305', '😀', cp(0xe0041), cp(0xf0000), 'ﬁ', '中', 'é', '\u1100', '\u1161', '\u11a8', 'ガ', 'ｶﾞ', '“', '—',
  ];
  it('is idempotent, in both modes, on 2,000 random strings', () => {
    const rand = rng(1);
    for (let k = 0; k < 2000; k++) {
      let s = '';
      const len = 1 + Math.floor(rand() * 40);
      for (let i = 0; i < len; i++) s += POOL[Math.floor(rand() * POOL.length)];
      for (const mode of ['prose', 'code'] as const) {
        const once = sanitizeText(s, mode);
        expect(sanitizeText(once, mode)).toBe(once);
      }
    }
  });
  it('prose output never has a control, a doubled space, or a space at either end', () => {
    const rand = rng(2);
    for (let k = 0; k < 2000; k++) {
      let s = '';
      const len = 1 + Math.floor(rand() * 40);
      for (let i = 0; i < len; i++) s += POOL[Math.floor(rand() * POOL.length)];
      const out = sanitizeText(s, 'prose');
      expect(out).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b\u2060\ufeff\u202a-\u202e\u2066-\u2069\ue000-\uf8ff]/);
      expect(out).not.toMatch(/ {2}|^ | $/);
      expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
      expect(out).toBe(out.normalize('NFC'));
    }
  });
});

describe('sanitizeInput', () => {
  it('copies deeply and sanitises every string', () => {
    const input = { title: '  Two\u00a0 words ', blocks: [{ type: 'claim', text: 'A\u202e fact.\n', cites: ['e1 '] }], n: 3, flag: true };
    const out = sanitizeInput(input);
    expect(out).toEqual({ title: 'Two words', blocks: [{ type: 'claim', text: 'A fact.', cites: ['e1'] }], n: 3, flag: true });
    expect(out).not.toBe(input);
    expect((out as typeof input).blocks).not.toBe(input.blocks);
    expect(input.title).toBe('  Two\u00a0 words ');
  });

  it('uses code mode for strings under a property named "lines", and prose mode elsewhere', () => {
    const out = sanitizeInput({
      figure: { type: 'lines', format: 'code', lines: ['def f(x):', '    return  x\t', '\tpass', ''], description: '  A   function. ' },
    });
    expect(out).toEqual({ figure: { type: 'lines', format: 'code', lines: ['def f(x):', '    return  x', '    pass', ''], description: 'A function.' } });
  });

  it('a "lines" value that is itself a string also uses code mode', () => {
    expect(sanitizeInput({ lines: '  x  ' })).toEqual({ lines: '  x' });
  });

  it('drops properties whose value is null or undefined, at any depth', () => {
    expect(sanitizeInput({ a: 1, b: null, c: { d: null, e: 'x', f: undefined }, g: [{ h: null, i: 2 }] })).toEqual({ a: 1, c: { e: 'x' }, g: [{ i: 2 }] });
  });

  it('keeps null inside an array, so positions do not shift', () => {
    expect(sanitizeInput({ cites: ['e1', null, 'e2'] })).toEqual({ cites: ['e1', null, 'e2'] });
  });

  const passthrough: Array<[string, unknown]> = [
    ['a number', 42],
    ['NaN', Number.NaN],
    ['a boolean', false],
    ['null', null],
    ['undefined', undefined],
    ['an empty array', []],
    ['an empty object', {}],
  ];
  it.each(passthrough)('passes %s through', (_name, v) => {
    expect(sanitizeInput(v)).toEqual(v);
  });

  it('sanitises a top-level string in prose mode', () => {
    expect(sanitizeInput('  a \n b ')).toBe('a b');
  });

  it('sanitises property names', () => {
    expect(sanitizeInput({ 'ci\u200btes': ['e1'], 'te\u202ext': 'x' })).toEqual({ cites: ['e1'], text: 'x' });
  });

  it('keeps "__proto__" as an ordinary own property and does not touch any prototype', () => {
    const out = sanitizeInput(JSON.parse('{"__proto__": {"polluted": true}, "constructor": "c"}')) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['__proto__', 'constructor']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual({ polluted: true });
  });

  const nest = (depth: number): unknown => {
    let v: unknown = 'leaf\u0000';
    for (let d = 0; d < depth; d++) v = d % 2 ? [v] : { k: v };
    return v;
  };

  it(`accepts containers nested exactly ${MAX_INPUT_DEPTH} deep`, () => {
    expect(JSON.stringify(sanitizeInput(nest(MAX_INPUT_DEPTH)))).toContain('"leaf"');
  });

  it(`throws a typed error at depth ${MAX_INPUT_DEPTH + 1}, with the path`, () => {
    let caught: unknown;
    try {
      sanitizeInput(nest(MAX_INPUT_DEPTH + 1));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SanitizeError);
    expect(caught).toBeInstanceOf(Error);
    const err = caught as SanitizeError;
    expect(err.code).toBe('INPUT_TOO_DEEP');
    expect(err.name).toBe('SanitizeError');
    // The path leads to the container that is one level too deep: twelve steps down from the top.
    expect(err.path).toBe('k[0].k[0].k[0].k[0].k[0].k[0]');
  });

  it('does not overflow the stack on input nested 100,000 deep', () => {
    let v: unknown = 1;
    for (let d = 0; d < 100_000; d++) v = [v];
    expect(() => sanitizeInput(v)).toThrowError(SanitizeError);
  });

  it('throws a typed error on a cycle, with the path where it closes', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.child = { back: a };
    let caught: unknown;
    try {
      sanitizeInput(a);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SanitizeError);
    expect((caught as SanitizeError).code).toBe('INPUT_CYCLE');
    expect((caught as SanitizeError).path).toBe('child.back');
  });

  it('accepts the same object in two places when it is not a cycle', () => {
    const shared = { text: ' x ' };
    expect(sanitizeInput({ a: shared, b: [shared, shared] })).toEqual({ a: { text: 'x' }, b: [{ text: 'x' }, { text: 'x' }] });
  });

  it('throws a typed error when the input has too many values', () => {
    const big = new Array(MAX_INPUT_NODES + 1).fill(0);
    let caught: unknown;
    try {
      sanitizeInput(big);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SanitizeError);
    expect((caught as SanitizeError).code).toBe('INPUT_TOO_LARGE');
  });

  it('the error message and path never carry raw control characters from a key', () => {
    const key = `bad\u0000\u202ekey${'x'.repeat(200)}`;
    let v: unknown = 1;
    for (let d = 0; d < MAX_INPUT_DEPTH + 1; d++) v = { [key]: v };
    try {
      sanitizeInput(v);
      throw new Error('expected a SanitizeError');
    } catch (e) {
      expect(e).toBeInstanceOf(SanitizeError);
      const err = e as SanitizeError;
      expect(err.path).not.toMatch(/[\u0000\u202e]/);
      expect(err.path.split('.')[0]?.length).toBeLessThanOrEqual(40);
    }
  });
});
