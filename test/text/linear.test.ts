// Every function in the text foundation must stay linear on hostile input. Each one is run on
// 100,000-character strings built to provoke the classic blow-ups (unclosed delimiters, long
// runs of marks, repeated near-matches) and must finish in under 50 ms.
import { describe, expect, it } from 'vitest';
import { codeSpans, mathSpans, parseInline, plainText, proseText } from '../../src/core/markup';
import { mathToMathML, mathToText, parseMath } from '../../src/core/math';
import { canonical, contentTokens, countWords, findQuote, findUrls, numberTokens, sanitizeInput, sanitizeText, sourceNumberTokens } from '../../src/core/text';
import { fastest } from './helpers';

const N = 100_000;
const BUDGET_MS = 50;
const fill = (unit: string): string => unit.repeat(Math.ceil(N / unit.length)).slice(0, N);

const INPUTS: Array<[string, string]> = [
  ['one long word', fill('a')],
  ['single letters', fill('a ')],
  ['only stars', fill('*')],
  ['openers that never close', fill('*a ')],
  ['closers that never opened', fill('a* ')],
  ['many small emphases', fill('*a* ')],
  ['strong openers that never close', fill('**a ')],
  ['deep nesting', fill('*a ').slice(0, N / 2) + fill('a* ').slice(0, N / 2)],
  ['stars between unspaced-script characters', fill('*中')],
  ['only backticks', fill('`')],
  ['backticks that never pair', fill('`a')],
  ['backtick runs of many lengths', Array.from({ length: 450 }, (_, k) => `${'`'.repeat(k + 1)}a`).join('').slice(0, N)],
  ['backtick runs of mixed lengths', fill('`a``b```c')],
  ['only dollars', fill('$')],
  ['dollars that never close', fill('$a ')],
  ['one opener and many escaped dollars', `$a${fill('\\$')}`],
  ['many openers before escaped dollars', fill(`$a${'\\$'.repeat(20)} `)],
  ['many small math spans', fill('$a$ ')],
  ['many failing math spans', fill('$#$ ')],
  ['only backslashes', fill('\\')],
  ['escapes', fill('\\*')],
  ['alternating combining marks', fill('\u0301\u0323')],
  ['a base with four kinds of mark', `a${fill('\u0301\u0323\u0315\u0327')}`],
  ['marks in descending class order', fill('\u0315\u0301\u0323\u0327\u0338')],
  ['decomposed letters', fill('e\u0301')],
  ['Hangul jamo', fill('\u1100\u1161\u11a8')],
  ['only vowel jamo', fill('\u1161')],
  ['halfwidth voiced marks', fill('ｶﾞ')],
  ['Chinese', fill('日本語の文章')],
  ['Thai', fill('ภาษาไทย')],
  ['only spaces', fill(' ')],
  ['no-break spaces', fill('\u00a0')],
  ['zero width spaces', fill('\u200b')],
  ['controls', fill('\u0001')],
  ['lone surrogates', fill('\ud800')],
  ['emoji', fill('😀')],
  ['private use', fill('\ue000')],
  ['only digits', fill('1')],
  ['digit groups', fill('1,000')],
  ['digits and dots', fill('1.')],
  ['digits and spaces', fill('123 ')],
  ['Arabic-Indic digits', fill('١٢٣ ')],
  ['mathematical digits', fill('𝟏𝟐𝟑,')],
  ['many URLs', fill('http://a.b/c ')],
  ['only scheme separators', fill('://')],
  ['a URL ending in brackets', `http://a.b/(${fill(')')}`],
  ['a host of dots', `http://a${fill('.')}`],
  ['a host of at signs', `http://${fill('a@')}`],
  ['many www', fill('www.a.b ')],
  ['open braces', fill('{')],
  ['nested fractions', fill('\\frac{')],
  ['nested roots', fill('\\sqrt[')],
  ['superscript chains', fill('x^')],
  ['curly quotes and dashes', fill('“a” – ')],
  ['ligatures', fill('ﬁ')],
  ['apostrophes inside words', fill("a'")],
  ['points inside numbers', fill('1.2,')],
  ['one long dotted run', fill('1.')],
  ['East Asian units without kana', fill('1兆2億')],
  ['East Asian units, never wide', fill('1億2千万')],
  ['ordinals joined to ordinals', fill('1st and ')],
  ['years and decades', fill('1939-45 1660s ')],
  ['digits with joiners', fill('1\u200d')],
  ['scale words', fill('12 million ')],
  ['ordinary prose', fill('The “quick” brown fox—jumps over 1,234 lazy dogs… ')],
];

const FUNCTIONS: Array<[string, (s: string) => unknown]> = [
  ['sanitizeText (prose)', (s) => sanitizeText(s, 'prose')],
  ['sanitizeText (code)', (s) => sanitizeText(s, 'code')],
  ['sanitizeInput', (s) => sanitizeInput({ a: [s, { lines: [s] }] })],
  ['canonical', (s) => canonical(s)],
  ['countWords', (s) => countWords(s, 'en')],
  ['contentTokens', (s) => contentTokens(s, 'en')],
  ['numberTokens', (s) => numberTokens(s)],
  ['sourceNumberTokens', (s) => sourceNumberTokens(s)],
  ['findUrls', (s) => findUrls(s)],
  ['parseInline', (s) => parseInline(s)],
  ['plainText', (s) => plainText(s)],
  ['proseText', (s) => proseText(s)],
  ['codeSpans', (s) => codeSpans(s)],
  ['mathSpans', (s) => mathSpans(s)],
  ['parseMath', (s) => parseMath(s)],
  ['findQuote, quote is most of the excerpt', (s) => findQuote(s, s.slice(1, N / 2))],
  ['findQuote, quote almost matches everywhere', (s) => findQuote(s, `${s.slice(0, N / 2)}#`)],
  ['findQuote, short quote with a long shared part', (s) => findQuote(s, `zzz ${s.slice(0, 300)}`)],
  ['findQuote, long excerpt and unrelated quote', (s) => findQuote(s, 'no such words anywhere in it')],
];

describe(`linear time: ${N.toLocaleString('en')} characters in under ${BUDGET_MS} ms`, () => {
  // Compile every code path before timing anything.
  for (const [, fn] of FUNCTIONS) for (const [, input] of INPUTS) fn(input.slice(0, 2000));

  it.each(FUNCTIONS)('%s', (_name, fn) => {
    const over: string[] = [];
    let worst = 0;
    for (const [label, input] of INPUTS) {
      // One clean run under half the budget is proof enough; anything slower is timed again,
      // because a single slow run usually means the machine was busy.
      let ms = fastest(() => fn(input), 1);
      if (ms >= BUDGET_MS / 2) ms = Math.min(ms, fastest(() => fn(input), 7));
      worst = Math.max(worst, ms);
      if (ms >= BUDGET_MS) over.push(`${label}: ${ms.toFixed(1)} ms`);
    }
    expect(over).toEqual([]);
    expect(worst).toBeLessThan(BUDGET_MS);
  });

  it('each input really is 100,000 characters or more', () => {
    for (const [label, input] of INPUTS) expect(input.length, label).toBeGreaterThanOrEqual(N);
  });

  it('time grows in proportion to length, not faster', () => {
    // Doubling the input should about double the time. A quadratic step would quadruple it.
    const cases: Array<[string, (s: string) => unknown, string]> = [
      ['parseInline', (s) => parseInline(s), '*a* $b$ `c` '],
      ['canonical', (s) => canonical(s), 'e\u0301 “q” '],
      ['sanitizeText', (s) => sanitizeText(s, 'prose'), '\u0301\u0323'],
      ['findQuote', (s) => findQuote(s, `${s.slice(0, s.length / 2)}#`), 'ab'],
    ];
    for (const [name, fn, unit] of cases) {
      const small = unit.repeat(Math.ceil(200_000 / unit.length));
      const large = small + small;
      fn(small);
      // The best of three attempts, so a burst of other work on the machine cannot fail it.
      let ratio = Number.POSITIVE_INFINITY;
      let detail = '';
      for (let attempt = 0; attempt < 3 && ratio >= 3.2; attempt++) {
        const a = fastest(() => fn(small), 7);
        const b = fastest(() => fn(large), 7);
        if (b / Math.max(a, 0.05) < ratio) {
          ratio = b / Math.max(a, 0.05);
          detail = `${name}: ${a.toFixed(2)} ms then ${b.toFixed(2)} ms`;
        }
      }
      expect(ratio, detail).toBeLessThan(3.2);
    }
  });

  it('math output is produced in linear time too', () => {
    const src = Array.from({ length: 12_000 }, (_, k) => `x_{${k}}^2 +`).join(' ') + ' 1';
    const r = parseMath(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(fastest(() => mathToMathML(r.nodes, true))).toBeLessThan(BUDGET_MS);
    expect(fastest(() => mathToText(r.nodes))).toBeLessThan(BUDGET_MS);
  });
});
