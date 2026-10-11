import { describe, expect, it } from 'vitest';
import { codeSpans, MARKUP_MAX_NESTING, mathSpans, parseInline, plainText, proseText, type Inline } from '../../src/core/markup';
import { pick, rng, show } from './helpers';

const parse = (src: string) => {
  const r = parseInline(src);
  return { shown: show(r.nodes), errors: r.errors };
};

describe('parseInline: text that looks like markup and is not', () => {
  // Every one of these must come back as the same literal text, with no errors.
  const literal: Array<[string, string]> = [
    ['a starred argument', '*args'],
    ['a double-starred argument', '**kwargs'],
    ['multiplication without spaces', '2*3*4'],
    ['a pointer declaration', 'int *p'],
    ['a glob', '*.txt'],
    ['both arguments in a signature', 'def f(*args, **kwargs):'],
    ['both arguments in a sentence', 'Use *args and **kwargs to accept anything.'],
    ['unpacking in two calls', 'f(*args) and g(*args)'],
    ['two globs', 'Match *.txt and *.md files.'],
    ['two pointers', 'int *p and char *q'],
    ['a pointer type and a dereference', 'char* p; char* q;'],
    ['multiplication with letters', 'a*b*c'],
    ['multiplication with spaces', 'a * b * c'],
    ['a product and a power', '2*3 = 6 and 2**3 = 8'],
    ['a power between words', 'x**2 + y**2'],
    ['a trailing star', 'see the note*'],
    ['a footnote star after a word, twice', 'first* and second*'],
    ['a lone star', '*'],
    ['a lone pair', '**'],
    ['stars with spaces inside', '* not emphasis *'],
    ['double stars with spaces inside', '** not strong **'],
    ['four or more stars', '****loud****'],
    ['a row of stars', '* * *'],
    ['a regex', 'a.*b matches a, then anything, then b'],
    ['a wildcard import', 'from x import *'],
    ['a C comment', '/* comment */'],
    ['a product with brackets', '5*(3+2)*4'],
    ['a product of calls', 'f(x)*g(x)*h(x)'],
    ['a product in Japanese text', '3*4は12、5*6は30'],
    ['two prices', '$5 and $10'],
    ['a price range', '$5-$10'],
    ['a price range with an en dash', '$5–$10'],
    ['prices with a slash', '$5/$10 per month'],
    ['prices in a list', 'It costs $20, $30 or $40.'],
    ['a price and a later variable', 'Pay $5 then set $HOME'],
    ['a single dollar', 'It costs $5.'],
    ['a dollar at the end', 'The price in US$'],
    ['an empty pair', '$$'],
    ['three dollars', '$$$'],
    ['spaced dollars', '$ x $'],
    ['space after the opening dollar', '$ x$'],
    ['space before the closing dollar', '$x $ and so on'],
    ['a shell prompt', '$ ls -la'],
    ['a template variable', 'Hello ${name}!'],
    ['a lone backtick', 'the ` character'],
    ['an unclosed code span', 'run `make build'],
    ['backticks of different lengths', '``a`'],
    ['a backslash that escapes nothing', 'C:\\Users\\me and \\n'],
    ['a trailing backslash', 'ends with \\'],
    ['underscores are never markup', 'snake_case and __init__ and _private_'],
    ['HTML is never markup', '<b>bold</b> <script>alert(1)</script> &amp;'],
    ['a link is never markup', '[text](https://example.org) and ![alt](x.png)'],
    ['a heading and a list marker', '# Heading and - item and 1. one'],
    ['tildes and carets', '~~strike~~ ^sup^ ==mark=='],
    ['plain text', 'Binary search halves the interval.'],
  ];
  it.each(literal)('%s', (_name, src) => {
    const r = parseInline(src);
    expect(r.errors).toEqual([]);
    expect(r.nodes).toEqual([{ t: 'text', v: src }]);
    expect(plainText(src)).toBe(src);
  });
});

describe('parseInline: emphasis', () => {
  const cases: Array<[string, string, string]> = [
    ['strong', '**bold**', '<b>bold</b>'],
    ['em', '*em*', '<i>em</i>'],
    ['both in a sentence', 'This is **very** *important* text.', 'This is <b>very</b> <i>important</i> text.'],
    ['several words', '**two words** and *three whole words*', '<b>two words</b> and <i>three whole words</i>'],
    ['strong and em together', '***both***', '<i><b>both</b></i>'],
    ['em inside strong', '**a *b* c**', '<b>a <i>b</i> c</b>'],
    ['strong inside em', '*a **b** c*', '<i>a <b>b</b> c</i>'],
    ['next to punctuation', 'Wait, **really**? (*yes*.)', 'Wait, <b>really</b>? (<i>yes</i>.)'],
    ['around quotes', '**"quoted"** and *(aside)*', '<b>"quoted"</b> and <i>(aside)</i>'],
    ['at both ends of the string', '*start* and *end*', '<i>start</i> and <i>end</i>'],
    ['code inside strong', '**see `x` here**', '<b>see <c>x</c> here</b>'],
    ['strong around a code span only', '**`code`**', '<b><c>code</c></b>'],
    ['math inside em', '*so $x^2$ grows*', '<i>so <m>x^2</m> grows</i>'],
    ['an unmatched opener stays literal beside real emphasis', '*a and **b**', '*a and <b>b</b>'],
    ['a closer with more stars than the opener', '*a**', '<i>a</i>*'],
    ['an opener with more stars than the closer', '**a*', '*<i>a</i>'],
    ['literal stars inside emphasis', '*2\\*3*', '<i>2*3</i>'],
    ['a product inside strong stays literal', '**2*3*4**', '<b>2*3*4</b>'],
    ['Chinese, where words are not spaced', '这是**重要**的', '这是<b>重要</b>的'],
    ['Japanese', 'これは*重要*です', 'これは<i>重要</i>です'],
    ['Japanese at the start', '**重要**な点', '<b>重要</b>な点'],
    ['Thai', 'นี่คือ**สำคัญ**มาก', 'นี่คือ<b>สำคัญ</b>มาก'],
    ['Chinese emphasis that ends in punctuation', '这是**重要的。**下一句', '这是<b>重要的。</b>下一句'],
    ['Japanese emphasis that starts with a bracket', 'これは**「重要」**です', 'これは<b>「重要」</b>です'],
    ['Japanese emphasis around a number', '値は*42*です', '値は<i>42</i>です'],
    ['Japanese emphasis right after a digit', '約3**倍**速い', '約3<b>倍</b>速い'],
    ['Japanese emphasis right after a Latin word', 'CはPython**よりも**速い', 'CはPython<b>よりも</b>速い'],
    ['Japanese emphasis right before a Latin word', '**重要**APIを使う', '<b>重要</b>APIを使う'],
    ['Latin emphasis inside Chinese text', '这是**API**的说明', '这是<b>API</b>的说明'],
    ['Latin letters inside CJK text still do not open', '式はa*b*cです', '式はa*b*cです'],
    ['Cyrillic', 'Это **важно** знать', 'Это <b>важно</b> знать'],
    ['Arabic', 'هذا **مهم** جدا', 'هذا <b>مهم</b> جدا'],
    ['accented letters count as letters', 'caf*é*s', 'caf*é*s'],
    ['a surrogate pair beside the delimiter', '*𝒳 marks* it', '<i>𝒳 marks</i> it'],
  ];
  it.each(cases)('%s', (_name, src, expected) => {
    const r = parse(src);
    expect(r.shown).toBe(expected);
    expect(r.errors).toEqual([]);
  });

  it('gives the exact node shape the renderer expects', () => {
    expect(parseInline('a **b *c*** `d` $e$').nodes).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'strong', c: [{ t: 'text', v: 'b ' }, { t: 'em', c: [{ t: 'text', v: 'c' }] }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'd' },
      { t: 'text', v: ' ' },
      { t: 'math', v: 'e', nodes: [{ t: 'id', v: 'e' }] },
    ] satisfies Inline[]);
  });

  it('an empty string has no nodes', () => {
    expect(parseInline('')).toEqual({ nodes: [], errors: [] });
  });

  it('adjacent text is one node', () => {
    for (const src of ['a \\* b * c', '*a b', 'a `b', '$5 and \\$6 and *']) {
      const { nodes } = parseInline(src);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.t).toBe('text');
    }
  });
});

describe('parseInline: backslash escapes', () => {
  const cases: Array<[string, string, string]> = [
    ['an escaped star', '\\*not em\\*', '*not em*'],
    ['escaped double stars', '\\*\\*not strong\\*\\*', '**not strong**'],
    ['an escaped backtick', '\\`not code\\`', '`not code`'],
    ['an escaped dollar', 'costs \\$5 and \\$10', 'costs $5 and $10'],
    ['an escaped dollar does not open math', '\\$x$', '$x$'],
    ['an escaped dollar does not close math', '$x\\$ and more', '$x$ and more'],
    ['only the opener escaped', '\\*a*', '*a*'],
    ['only the closer escaped', '*a\\*', '*a*'],
    ['a backslash before anything else is literal', 'a\\b \\\\ \\_ \\[', 'a\\b \\\\ \\_ \\['],
    ['a backslash before a backslash is not an escape', '\\\\*a*', '\\*a*'],
    ['escapes do not work inside a code span', '`a\\*b`', '<c>a\\*b</c>'],
    ['a code span can end with a backslash', '`a\\`', '<c>a\\</c>'],
    ['an escaped star beside a real one', '**a\\***', '<b>a*</b>'],
  ];
  it.each(cases)('%s', (_name, src, expected) => {
    const r = parse(src);
    expect(r.shown).toBe(expected);
    expect(r.errors).toEqual([]);
  });
});

describe('parseInline: code spans', () => {
  const cases: Array<[string, string, string]> = [
    ['a code span', 'call `binary_search(items)` now', 'call <c>binary_search(items)</c> now'],
    ['stars inside are literal', '`a*b*c` and `**kwargs`', '<c>a*b*c</c> and <c>**kwargs</c>'],
    ['dollars inside are literal', '`$x$` and `$HOME`', '<c>$x$</c> and <c>$HOME</c>'],
    ['double backticks hold a single one', '``a`b``', '<c>a`b</c>'],
    ['one space of padding is removed', '`` `tick` ``', '<c>`tick`</c>'],
    ['padding is kept when only one side has it', '` a`', '<c> a</c>'],
    ['a span of spaces is kept', '`  `', '<c>  </c>'],
    ['inner spaces are kept', '`a   b`', '<c>a   b</c>'],
    ['two spans', '`a` and `b`', '<c>a</c> and <c>b</c>'],
    ['the first closer wins', '`a` b `c', '<c>a</c> b `c'],
    ['code wins over emphasis that starts earlier', '*a `b* c`', '*a <c>b* c</c>'],
    ['code wins over math that starts earlier', '$a `b$ c`', '$a <c>b$ c</c>'],
    ['a price before a code span that holds a dollar', 'price $5 for `x$y`', 'price $5 for <c>x$y</c>'],
    ['mismatched run lengths stay literal', '``a` b', '``a` b'],
    ['HTML inside code stays text', '`<script>`', '<c><script></c>'],
  ];
  it.each(cases)('%s', (_name, src, expected) => {
    const r = parse(src);
    expect(r.shown).toBe(expected);
    expect(r.errors).toEqual([]);
  });
});

describe('parseInline: math spans', () => {
  const cases: Array<[string, string, string]> = [
    ['a math span', 'so $x^2 + 1$ grows', 'so <m>x^2 + 1</m> grows'],
    ['a single letter', 'for every $n$ there is', 'for every <m>n</m> there is'],
    ['two spans', '$a$ and $b$', '<m>a</m> and <m>b</m>'],
    ['stars inside are literal', '$a*b*c$', '<m>a*b*c</m>'],
    ['a command', 'cost is $O(\\log n)$', 'cost is <m>O(\\log n)</m>'],
    ['doubled dollars are the same math', '$$x + 1$$', '<m>x + 1</m>'],
    ['an escaped dollar inside math', '$\\$5 \\times 3$', '<m>\\$5 \\times 3</m>'],
    ['followed by punctuation', 'is it $x$?', 'is it <m>x</m>?'],
    ['followed by a letter', '$n$th item', '<m>n</m>th item'],
    ['a price then real math', 'Pay $5 for $x$', 'Pay $5 for <m>x</m>'],
    ['a closing dollar followed by a digit is not a closer', '$a$1 and $b$', '$a$1 and <m>b</m>'],
    ['math beside emphasis', '**$x$** is *not* $y$', '<b><m>x</m></b> is <i>not</i> <m>y</m>'],
  ];
  it.each(cases)('%s', (_name, src, expected) => {
    const r = parse(src);
    expect(r.shown).toBe(expected);
    expect(r.errors).toEqual([]);
  });

  const failing: Array<[string, string, number, number, number, string]> = [
    // [name, source, at, start, end, what the message names]
    ['an unsupported command', 'so $\\foo{x}$ here', 4, 3, 12, '\\foo'],
    ['a common unsupported command', '$x \\in S$', 3, 0, 9, '\\in'],
    ['an unsupported character', '$a # b$', 3, 0, 7, '#'],
    ['an unclosed brace', 'see $\\frac{a}{b$ end', 13, 4, 16, '}'],
    ['a second error-free span does not hide the first', '$\\bad$ and $x$', 1, 0, 6, '\\bad'],
  ];
  it.each(failing)('%s is a MARKUP_MATH error, and the span stays as text', (_name, src, at, start, end, names) => {
    const r = parseInline(src);
    expect(r.errors).toHaveLength(1);
    const err = r.errors[0];
    expect(err).toMatchObject({ code: 'MARKUP_MATH', at, start, end });
    expect(err?.message).toContain(names);
    expect(src.slice(start, end).startsWith('$')).toBe(true);
    expect(src.slice(start, end).endsWith('$')).toBe(true);
    // Nothing is lost: the source of the failed span is still in the text.
    expect(plainText(src)).toContain(src.slice(start, end));
    expect(show(r.nodes)).not.toContain(`<m>${src.slice(start + 1, end - 1)}</m>`);
  });

  it('reports every failing span', () => {
    const r = parseInline('$\\one$ then $\\two$ then $x$');
    expect(r.errors.map((e) => e.message)).toEqual(['Unsupported command \\one.', 'Unsupported command \\two.']);
    expect(show(r.nodes)).toBe('$\\one$ then $\\two$ then <m>x</m>');
  });

  it('an error message never carries more than the offending name', () => {
    const long = `\\${'a'.repeat(300)}`;
    const r = parseInline(`$${long}$`);
    expect(r.errors[0]?.message.length).toBeLessThan(60);
  });
});

describe('plainText, proseText, codeSpans, mathSpans', () => {
  const cases: Array<[string, string, string, string, string[], string[]]> = [
    // [name, source, plainText, proseText, codeSpans, mathSpans]
    ['no markup', 'Binary search.', 'Binary search.', 'Binary search.', [], []],
    ['emphasis', 'This is **very** *important*.', 'This is very important.', 'This is very important.', [], []],
    ['code', 'Call `f(x)` and `g`.', 'Call f(x) and g.', 'Call and .', ['f(x)', 'g'], []],
    ['math', 'So $x^2 + 1$ grows.', 'So x^2 + 1 grows.', 'So grows.', [], ['x^2 + 1']],
    ['a fraction reads on one line', 'Half is $\\frac{1}{2}$.', 'Half is 1/2.', 'Half is .', [], ['\\frac{1}{2}']],
    ['a root and a sum', '$\\sqrt{x+1}$ and $\\sum_{i=1}^{n} i$', '√(x + 1) and ∑_(i = 1)^n i', 'and', [], ['\\sqrt{x+1}', '\\sum_{i=1}^{n} i']],
    ['code inside emphasis', '**run `make`** twice', 'run make twice', 'run twice', ['make'], []],
    ['escapes', 'Costs \\$5, not \\*free\\*.', 'Costs $5, not *free*.', 'Costs $5, not *free*.', [], []],
    ['numbers in code and math are outside the prose', 'Port `8080`, about $2^{10}$ items, in 2015.', 'Port 8080, about 2^10 items, in 2015.', 'Port , about items, in 2015.', ['8080'], ['2^{10}']],
    ['a URL in code is outside the prose', 'Run `curl https://example.org` now.', 'Run curl https://example.org now.', 'Run now.', ['curl https://example.org'], []],
    ['literal look-alikes', 'Pass *args; pay $5.', 'Pass *args; pay $5.', 'Pass *args; pay $5.', [], []],
    ['a failed math span stays as written', 'So $\\foo$ here.', 'So $\\foo$ here.', 'So $\\foo$ here.', [], []],
    ['empty', '', '', '', [], []],
  ];
  it.each(cases)('%s', (_name, src, plain, prose, code, math) => {
    expect(plainText(src)).toBe(plain);
    expect(proseText(src)).toBe(prose);
    expect(codeSpans(src)).toEqual(code);
    expect(mathSpans(src)).toEqual(math);
  });
});

describe('parseInline: bounds', () => {
  const depth = (nodes: Inline[]): number => {
    let d = 0;
    for (const n of nodes) if (n.t === 'strong' || n.t === 'em') d = Math.max(d, 1 + depth(n.c));
    return d;
  };

  it(`nests at most ${MARKUP_MAX_NESTING} runs deep, however deep the source goes`, () => {
    const levels = 200;
    const src = `${'*a '.repeat(levels)}x${' a*'.repeat(levels)}`;
    const { nodes, errors } = parseInline(src);
    expect(errors).toEqual([]);
    expect(depth(nodes)).toBe(MARKUP_MAX_NESTING);
    // Nothing is lost: all the letters are still there.
    expect(plainText(src).replace(/[^ax]/g, '').length).toBe(levels * 2 + 1);
  });

  it('three stars on each side is at most two levels', () => {
    expect(depth(parseInline('***a***').nodes)).toBe(2);
    expect(depth(parseInline(`${'***'.repeat(1)}a${'***'.repeat(1)}`).nodes)).toBe(2);
  });

  it('reproduces every character of text that has no markup characters at all', () => {
    const rand = rng(31);
    const pool = ['a', 'B', ' ', '_', '#', '<', '>', '&', '[', ']', '(', ')', '~', '^', '{', '}', '"', "'", '1', '.', 'é', '中', '😀', '-', '+', '='];
    for (let k = 0; k < 500; k++) {
      let s = '';
      for (let i = 0; i < 30; i++) s += pick(rand, pool);
      expect(parseInline(s)).toEqual({ nodes: [{ t: 'text', v: s }], errors: [] });
    }
  });

  it('never throws and never loses a letter or digit, on 3,000 random strings of markup characters', () => {
    const rand = rng(32);
    const pool = ['*', '*', '**', '`', '``', '$', '$$', '\\', ' ', ' ', 'a', 'b', '1', '.', '(', ')', '中', 'é', '{', '}', '^', '_'];
    const letters = (s: string) => s.replace(/[^ab1中é]/g, '');
    for (let k = 0; k < 3000; k++) {
      let s = '';
      const len = 1 + Math.floor(rand() * 30);
      for (let i = 0; i < len; i++) s += pick(rand, pool);
      const r = parseInline(s);
      for (const e of r.errors) {
        expect(e.code).toBe('MARKUP_MATH');
        expect(e.start).toBeGreaterThanOrEqual(0);
        expect(e.end).toBeLessThanOrEqual(s.length);
        expect(e.at).toBeGreaterThanOrEqual(e.start);
        expect(e.at).toBeLessThanOrEqual(e.end);
      }
      // Math is rewritten into linear text, so compare letters only on strings where no math span parsed.
      if (mathSpans(s).length === 0) expect(letters(plainText(s)), JSON.stringify(s)).toBe(letters(s));
      expect(depth(r.nodes)).toBeLessThanOrEqual(MARKUP_MAX_NESTING * 2);
    }
  });
});
