import { describe, expect, it } from 'vitest';
import { MATH_COMMAND_GROUPS, MATH_COMMANDS, MATH_HELP, MATH_MAX_DEPTH, MATH_OPERATORS, mathToMathML, mathToText, parseMath, type MathNode } from '../../src/core/math';
import { pick, rng } from './helpers';

function ok(src: string): MathNode[] {
  const r = parseMath(src);
  if (!r.ok) throw new Error(`${src}: ${r.message} at ${r.at}`);
  return r.nodes;
}
const inline = (src: string) => mathToMathML(ok(src), false).replace(/^<math display="inline"><mrow>|<\/mrow><\/math>$/g, '');
const display = (src: string) => mathToMathML(ok(src), true).replace(/^<math display="block"><mrow>|<\/mrow><\/math>$/g, '');

/** A strict check that a string is well-formed markup made only of the given element names. */
function elementsOf(markup: string): Set<string> {
  const names = new Set<string>();
  const stack: string[] = [];
  const tag = /<(\/?)([a-z]+)((?: [a-z]+="[^"<>&]*")*)>|([^<>]+)|([<>])/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = tag.exec(markup))) {
    consumed += m[0].length;
    if (m[5]) throw new Error(`stray ${m[5]} in ${markup}`);
    if (m[4] !== undefined) {
      if (/&(?!(amp|lt|gt|quot|#39|#x2061);)/.test(m[4])) throw new Error(`unescaped & in ${markup}`);
      continue;
    }
    const name = m[2] as string;
    if (m[1]) {
      if (stack.pop() !== name) throw new Error(`mismatched </${name}> in ${markup}`);
    } else {
      names.add(name);
      stack.push(name);
    }
  }
  if (consumed !== markup.length) throw new Error(`unparsed text in ${markup}`);
  if (stack.length) throw new Error(`unclosed <${stack.join('>, <')}> in ${markup}`);
  return names;
}

const MATHML_CORE = new Set(['math', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace', 'msup', 'msub', 'msubsup', 'munder', 'mover', 'munderover', 'mfrac', 'msqrt', 'mroot']);

describe('parseMath: the supported subset', () => {
  const cases: Array<[string, string, string, string]> = [
    // [name, source, linear text, MathML inside <math><mrow>]
    ['a number', '42', '42', '<mn>42</mn>'],
    ['a decimal', '3.14', '3.14', '<mn>3.14</mn>'],
    ['a leading decimal point', '.5', '.5', '<mn>.5</mn>'],
    ['thousands groups are one number', '1,000,000', '1,000,000', '<mn>1,000,000</mn>'],
    ['a list of numbers is not', '1, 2, 3', '1, 2, 3', '<mn>1</mn><mo>,</mo><mn>2</mn><mo>,</mo><mn>3</mn>'],
    ['an identifier', 'x', 'x', '<mi>x</mi>'],
    ['letters are separate identifiers', 'xy', 'xy', '<mi>x</mi><mi>y</mi>'],
    ['plus', 'a + b', 'a + b', '<mi>a</mi><mo>+</mo><mi>b</mi>'],
    ['minus is a true minus sign', 'a - b', 'a − b', '<mi>a</mi><mo>−</mo><mi>b</mi>'],
    ['a leading minus is a prefix', '-x', '−x', '<mo form="prefix">−</mo><mi>x</mi>'],
    ['a minus after an operator is a prefix', 'a = -b', 'a = −b', '<mi>a</mi><mo>=</mo><mo form="prefix">−</mo><mi>b</mi>'],
    ['a minus after a bracket is a prefix', '(-x)', '(−x)', '<mo stretchy="false">(</mo><mo form="prefix">−</mo><mi>x</mi><mo stretchy="false">)</mo>'],
    ['a minus after a closing bracket is not', '(a) - b', '(a) − b', '<mo stretchy="false">(</mo><mi>a</mi><mo stretchy="false">)</mo><mo>−</mo><mi>b</mi>'],
    ['equals', 'a = b', 'a = b', '<mi>a</mi><mo>=</mo><mi>b</mi>'],
    ['less than is escaped', 'a < b', 'a < b', '<mi>a</mi><mo>&lt;</mo><mi>b</mi>'],
    ['greater than is escaped', 'a > b', 'a > b', '<mi>a</mi><mo>&gt;</mo><mi>b</mi>'],
    ['slash', 'a/b', 'a/b', '<mi>a</mi><mo>/</mo><mi>b</mi>'],
    ['star is the asterisk operator', 'a * b', 'a ∗ b', '<mi>a</mi><mo>∗</mo><mi>b</mi>'],
    ['brackets do not stretch', '[a]', '[a]', '<mo stretchy="false">[</mo><mi>a</mi><mo stretchy="false">]</mo>'],
    ['factorial', 'n!', 'n!', '<mi>n</mi><mo>!</mo>'],
    ['absolute value', '|x|', '|x|', '<mo stretchy="false" lspace="0" rspace="0">|</mo><mi>x</mi><mo stretchy="false" lspace="0" rspace="0">|</mo>'],
    ['a minus inside bars is a prefix, after them it is not', '|-x| - 1', '|−x| − 1', '<mo stretchy="false" lspace="0" rspace="0">|</mo><mo form="prefix">−</mo><mi>x</mi><mo stretchy="false" lspace="0" rspace="0">|</mo><mo>−</mo><mn>1</mn>'],
    ['a colon', 'f: A', 'f : A', '<mi>f</mi><mo>:</mo><mi>A</mi>'],
    ['a full stop', 'x.', 'x.', '<mi>x</mi><mo>.</mo>'],
    ['a percent sign', '50%', '50%', '<mn>50</mn><mi mathvariant="normal">%</mi>'],
    ['an escaped percent sign', '50\\%', '50%', '<mn>50</mn><mi mathvariant="normal">%</mi>'],
    ['an escaped dollar sign', '\\$5', '$5', '<mi mathvariant="normal">$</mi><mn>5</mn>'],
    ['a superscript with one token', 'x^2', 'x^2', '<msup><mi>x</mi><mn>2</mn></msup>'],
    ['a multi-digit exponent is one token', '2^10', '2^10', '<msup><mn>2</mn><mn>10</mn></msup>'],
    ['a superscript group', 'x^{n+1}', 'x^(n + 1)', '<msup><mi>x</mi><mrow><mi>n</mi><mo>+</mo><mn>1</mn></mrow></msup>'],
    ['a signed exponent without braces', '10^-3', '10^(−3)', '<msup><mn>10</mn><mrow><mo form="prefix">−</mo><mn>3</mn></mrow></msup>'],
    ['a subscript', 'x_i', 'x_i', '<msub><mi>x</mi><mi>i</mi></msub>'],
    ['a subscript group', 'x_{i,j}', 'x_(i, j)', '<msub><mi>x</mi><mrow><mi>i</mi><mo>,</mo><mi>j</mi></mrow></msub>'],
    ['both scripts', 'x_i^2', 'x_i^2', '<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>'],
    ['both scripts, the other way round', 'x^2_i', 'x_i^2', '<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>'],
    ['a script on a group', '{a+b}^2', 'a + b^2', '<msup><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mn>2</mn></msup>'],
    ['a script with nothing before it', '{}^{14}C', '^14C', '<msup><mrow></mrow><mn>14</mn></msup><mi>C</mi>'],
    ['a prime', "f'(x)", "f'(x)", '<msup><mi>f</mi><mo>′</mo></msup><mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo>'],
    ['two primes', "f''", "f''", '<msup><mi>f</mi><mrow><mo>′</mo><mo>′</mo></mrow></msup>'],
    ['a fraction', '\\frac{a}{b}', 'a/b', '<mfrac><mrow><mi>a</mi></mrow><mrow><mi>b</mi></mrow></mfrac>'],
    ['a fraction of expressions', '\\frac{a+1}{2n}', '(a + 1)/(2n)', '<mfrac><mrow><mi>a</mi><mo>+</mo><mn>1</mn></mrow><mrow><mn>2</mn><mi>n</mi></mrow></mfrac>'],
    ['a nested fraction', '\\frac{1}{\\frac{a}{b}}', '1/(a/b)', '<mfrac><mrow><mn>1</mn></mrow><mrow><mfrac><mrow><mi>a</mi></mrow><mrow><mi>b</mi></mrow></mfrac></mrow></mfrac>'],
    ['a square root', '\\sqrt{x}', '√x', '<msqrt><mi>x</mi></msqrt>'],
    ['a root of an expression', '\\sqrt{x+1}', '√(x + 1)', '<msqrt><mi>x</mi><mo>+</mo><mn>1</mn></msqrt>'],
    ['an nth root', '\\sqrt[3]{x}', '√[3]x', '<mroot><mrow><mi>x</mi></mrow><mrow><mn>3</mn></mrow></mroot>'],
    ['text', '\\text{speed} = d', 'speed = d', '<mtext>speed</mtext><mo>=</mo><mi>d</mi>'],
    ['text keeps its spaces at the ends', 'x \\text{ if } y', 'x if y', '<mi>x</mi><mtext>\u00a0if\u00a0</mtext><mi>y</mi>'],
    ['text is escaped', '\\text{a < b & "c"}', 'a < b & "c"', '<mtext>a &lt; b &amp; &quot;c&quot;</mtext>'],
    ['lower-case Greek', '\\alpha + \\beta', 'α + β', '<mi>α</mi><mo>+</mo><mi>β</mi>'],
    ['capital Greek is upright', '\\Delta x', 'Δx', '<mi mathvariant="normal">Δ</mi><mi>x</mi>'],
    ['pi', '2\\pi r', '2πr', '<mn>2</mn><mi>π</mi><mi>r</mi>'],
    ['Greek typed directly', 'α + Ω', 'α + Ω', '<mi>α</mi><mo>+</mo><mi>Ω</mi>'],
    ['times', '3 \\times 4', '3 × 4', '<mn>3</mn><mo>×</mo><mn>4</mn>'],
    ['cdot', 'a \\cdot b', 'a ⋅ b', '<mi>a</mi><mo>⋅</mo><mi>b</mi>'],
    ['div', '6 \\div 2', '6 ÷ 2', '<mn>6</mn><mo>÷</mo><mn>2</mn>'],
    ['pm', 'a \\pm b', 'a ± b', '<mi>a</mi><mo>±</mo><mi>b</mi>'],
    ['le and its long spelling', 'a \\le b \\leq c', 'a ≤ b ≤ c', '<mi>a</mi><mo>≤</mo><mi>b</mi><mo>≤</mo><mi>c</mi>'],
    ['ge and its long spelling', 'a \\ge b \\geq c', 'a ≥ b ≥ c', '<mi>a</mi><mo>≥</mo><mi>b</mi><mo>≥</mo><mi>c</mi>'],
    ['ne and its long spelling', 'a \\ne b \\neq c', 'a ≠ b ≠ c', '<mi>a</mi><mo>≠</mo><mi>b</mi><mo>≠</mo><mi>c</mi>'],
    ['approx', '\\pi \\approx 3.14', 'π ≈ 3.14', '<mi>π</mi><mo>≈</mo><mn>3.14</mn>'],
    ['to and its long spelling', 'x \\to 0 \\rightarrow y', 'x → 0 → y', '<mi>x</mi><mo>→</mo><mn>0</mn><mo>→</mo><mi>y</mi>'],
    ['infinity', 'n \\to \\infty', 'n → ∞', '<mi>n</mi><mo>→</mo><mi mathvariant="normal">∞</mi>'],
    ['operators typed directly', 'a × b ≤ c ≠ d', 'a × b ≤ c ≠ d', '<mi>a</mi><mo>×</mo><mi>b</mi><mo>≤</mo><mi>c</mi><mo>≠</mo><mi>d</mi>'],
    ['a function name', '\\log n', 'log n', '<mi>log</mi><mo>&#x2061;</mo><mspace width="0.167em"></mspace><mi>n</mi>'],
    ['a function with brackets has no extra space', '\\sin(x)', 'sin(x)', '<mi>sin</mi><mo>&#x2061;</mo><mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo>'],
    ['a function after a factor', '2\\cos x', '2 cos x', '<mn>2</mn><mspace width="0.167em"></mspace><mi>cos</mi><mo>&#x2061;</mo><mspace width="0.167em"></mspace><mi>x</mi>'],
    ['a function with a base', '\\log_2 n', 'log_2 n', '<msub><mi>log</mi><mn>2</mn></msub><mo>&#x2061;</mo><mspace width="0.167em"></mspace><mi>n</mi>'],
    ['big O', 'O(\\log n)', 'O(log n)', '<mi>O</mi><mo stretchy="false">(</mo><mi>log</mi><mo>&#x2061;</mo><mspace width="0.167em"></mspace><mi>n</mi><mo stretchy="false">)</mo>'],
    ['ln, tan, min, max', '\\ln x + \\tan y + \\min(a,b) + \\max(a,b)', 'ln x + tan y + min(a, b) + max(a, b)', '<mi>ln</mi><mo>&#x2061;</mo><mspace width="0.167em"></mspace><mi>x</mi><mo>+</mo><mi>tan</mi><mo>&#x2061;</mo><mspace width="0.167em"></mspace><mi>y</mi><mo>+</mo><mi>min</mi><mo>&#x2061;</mo><mo stretchy="false">(</mo><mi>a</mi><mo>,</mo><mi>b</mi><mo stretchy="false">)</mo><mo>+</mo><mi>max</mi><mo>&#x2061;</mo><mo stretchy="false">(</mo><mi>a</mi><mo>,</mo><mi>b</mi><mo stretchy="false">)</mo>'],
    ['a sum with limits', '\\sum_{i=1}^{n} i', '∑_(i = 1)^n i', '<msubsup><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></msubsup><mi>i</mi>'],
    ['a product', '\\prod_{k=1}^{n} k', '∏_(k = 1)^n k', '<msubsup><mo>∏</mo><mrow><mi>k</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></msubsup><mi>k</mi>'],
    ['an integral with a thin space', '\\int_0^1 x \\, dx', '∫_0^1 x dx', '<msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><mi>x</mi><mspace width="0.167em"></mspace><mi>d</mi><mi>x</mi>'],
    ['a limit', '\\lim_{x \\to 0} x', 'lim_(x → 0) x', '<msub><mi>lim</mi><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></msub><mo>&#x2061;</mo><mspace width="0.167em"></mspace><mi>x</mi>'],
    ['stretching brackets', '\\left( \\frac{a}{b} \\right)', '(a/b)', '<mrow><mo fence="true">(</mo><mfrac><mrow><mi>a</mi></mrow><mrow><mi>b</mi></mrow></mfrac><mo fence="true">)</mo></mrow>'],
    ['stretching square brackets and bars', '\\left[ x \\right] \\left| y \\right|', '[x]|y|', '<mrow><mo fence="true">[</mo><mi>x</mi><mo fence="true">]</mo></mrow><mrow><mo fence="true">|</mo><mi>y</mi><mo fence="true">|</mo></mrow>'],
    ['an invisible delimiter', '\\left. x \\right|', 'x|', '<mrow><mi>x</mi><mo fence="true">|</mo></mrow>'],
    ['a script on stretching brackets', '\\left( a \\right)^2', '(a)^2', '<msup><mrow><mo fence="true">(</mo><mi>a</mi><mo fence="true">)</mo></mrow><mn>2</mn></msup>'],
    ['the other spaces', 'a \\: b \\; c \\quad d \\ e', 'a b c d e', '<mi>a</mi><mspace width="0.222em"></mspace><mi>b</mi><mspace width="0.278em"></mspace><mi>c</mi><mspace width="1em"></mspace><mi>d</mi><mspace width="0.333em"></mspace><mi>e</mi>'],
    ['white space in the source does not matter', '  x   ^  2  ', 'x^2', '<msup><mi>x</mi><mn>2</mn></msup>'],
    ['Pythagoras', 'x^2 + y^2 = r^2', 'x^2 + y^2 = r^2', '<msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><msup><mi>y</mi><mn>2</mn></msup><mo>=</mo><msup><mi>r</mi><mn>2</mn></msup>'],
    ['Euler', 'e^{i\\pi} + 1 = 0', 'e^(iπ) + 1 = 0', '<msup><mi>e</mi><mrow><mi>i</mi><mi>π</mi></mrow></msup><mo>+</mo><mn>1</mn><mo>=</mo><mn>0</mn>'],
    ['the cost of binary search', '\\log_2(n) + 1', 'log_2(n) + 1', '<msub><mi>log</mi><mn>2</mn></msub><mo>&#x2061;</mo><mo stretchy="false">(</mo><mi>n</mi><mo stretchy="false">)</mo><mo>+</mo><mn>1</mn>'],
  ];
  it.each(cases)('%s: %s', (_name, src, text, mathml) => {
    const nodes = ok(src);
    expect(mathToText(nodes)).toBe(text);
    expect(inline(src)).toBe(mathml);
  });

  it('wraps the result in one complete math element, inline or block', () => {
    expect(mathToMathML(ok('x'), false)).toBe('<math display="inline"><mrow><mi>x</mi></mrow></math>');
    expect(mathToMathML(ok('x'), true)).toBe('<math display="block"><mrow><mi>x</mi></mrow></math>');
  });

  const limits: Array<[string, string, string]> = [
    ['a sum puts its limits under and over', '\\sum_{i=1}^{n} i', '<munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><mi>i</mi>'],
    ['a product with only a lower limit', '\\prod_{k} k', '<munder><mo>∏</mo><mi>k</mi></munder><mi>k</mi>'],
    ['a limit goes underneath', '\\lim_{x \\to 0} x', '<munder><mi>lim</mi><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder><mo>&#x2061;</mo><mspace width="0.167em"></mspace><mi>x</mi>'],
    ['max with a subscript', '\\max_{i} a_i', '<munder><mi>max</mi><mi>i</mi></munder><mo>&#x2061;</mo><mspace width="0.167em"></mspace><msub><mi>a</mi><mi>i</mi></msub>'],
    ['an integral keeps its limits at the side', '\\int_0^1 x', '<msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><mi>x</mi>'],
    ['log keeps its base at the side', '\\log_2 n', '<msub><mi>log</mi><mn>2</mn></msub><mo>&#x2061;</mo><mspace width="0.167em"></mspace><mi>n</mi>'],
    ['an ordinary script is unchanged', 'x_i^2', '<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>'],
  ];
  it.each(limits)('in display style, %s', (_name, src, mathml) => {
    expect(display(src)).toBe(mathml);
  });
});

describe('parseMath: errors', () => {
  const cases: Array<[string, string, number, string]> = [
    // [name, source, at, the message]
    ['an unknown command', '\\foo', 0, 'Unsupported command \\foo.'],
    ['an unknown command later on', 'a + \\bar{x}', 4, 'Unsupported command \\bar.'],
    ['\\in', 'x \\in S', 2, 'Unsupported command \\in.'],
    ['\\mathrm', '\\mathrm{d}x', 0, 'Unsupported command \\mathrm.'],
    ['\\mathbb', '\\mathbb{R}', 0, 'Unsupported command \\mathbb.'],
    ['\\begin', '\\begin{matrix} a \\end{matrix}', 0, 'Unsupported command \\begin.'],
    ['\\ldots', '1, \\ldots, n', 3, 'Unsupported command \\ldots.'],
    ['\\vec', '\\vec{v}', 0, 'Unsupported command \\vec.'],
    ['\\binom', '\\binom{n}{k}', 0, 'Unsupported command \\binom.'],
    ['a line break', 'a \\\\ b', 2, 'Unsupported command \\ followed by "\\" (U+005C).'],
    ['an escaped brace', '\\{a\\}', 0, 'Unsupported command \\ followed by "{" (U+007B).'],
    ['a prototype name is not a command', '\\constructor', 0, 'Unsupported command \\constructor.'],
    ['another prototype name', '\\toString', 0, 'Unsupported command \\toString.'],
    ['__proto__', '\\__proto__', 0, 'Unsupported command \\ followed by "_" (U+005F).'],
    ['a long name is shortened', `\\${'x'.repeat(100)}`, 0, `Unsupported command \\${'x'.repeat(24)}.`],
    ['a backslash at the end', 'a\\', 1, 'A backslash needs a command name after it, such as \\frac.'],
    ['an unsupported character', 'a # b', 2, 'Unsupported character "#" (U+0023) in math.'],
    ['an ampersand', 'a & b', 2, 'Unsupported character "&" (U+0026) in math.'],
    ['a semicolon', 'a; b', 1, 'Unsupported character ";" (U+003B) in math.'],
    ['a backtick', 'a`b', 1, 'Unsupported character "`" (U+0060) in math.'],
    ['a dollar', 'a $ b', 2, 'Unsupported character "$" (U+0024) in math.'],
    ['a double quote', 'a "b"', 2, 'Unsupported character \'"\' (U+0022) in math.'],
    ['an unsupported symbol', 'a ∈ S', 2, 'Unsupported character "∈" (U+2208) in math.'],
    ['an emoji', 'a 😀', 2, 'Unsupported character "😀" (U+1F600) in math.'],
    ['a control character is named by number only', 'a\u0007b', 1, 'Unsupported character U+0007 in math.'],
    ['so is an invisible character', 'a\u200bb', 1, 'Unsupported character U+200B in math.'],
    ['and a combining mark with nothing under it', '\u0301', 0, 'Unsupported character U+0301 in math.'],
    ['and an unusual space', 'a\u2009b', 1, 'Unsupported character U+2009 in math.'],
    ['empty', '', 0, 'Empty math expression.'],
    ['spaces only', '   ', 0, 'Empty math expression.'],
    ['an unclosed group', '{a + b', 0, 'Missing } to close the { opened here.'],
    ['an unclosed group in a fraction', '\\frac{a}{b', 8, 'Missing } to close the { opened here.'],
    ['a stray closing brace', 'a}', 1, 'Unexpected }. Every } needs a { before it.'],
    ['a fraction with one part', '\\frac{a}', 0, '\\frac needs braces: write \\frac{a}{b}.'],
    ['a fraction without braces', '\\frac12', 0, '\\frac needs braces: write \\frac{a}{b}.'],
    ['a root without braces', '\\sqrt x', 0, '\\sqrt needs braces: write \\sqrt{x}.'],
    ['an unclosed root index', '\\sqrt[3{x}', 5, 'Missing ] to close the [ opened here.'],
    ['text without braces', '\\text abc', 0, '\\text needs braces: write \\text{words}.'],
    ['unclosed text', '\\text{abc', 0, 'Missing } to close \\text{.'],
    ['a brace inside text', '\\text{a{b}', 7, '\\text{} cannot contain {.'],
    ['a superscript with nothing after it', 'x^', 1, '^ needs something after it: write x^2 or x^{n+1}.'],
    ['a subscript with nothing after it', 'x_', 1, '_ needs something after it: write x_i or x_{i,j}.'],
    ['a superscript before a closing brace', '{x^}', 2, '^ needs something after it: write x^2 or x^{n+1}.'],
    ['a sign with nothing after it', 'x^-', 1, '^ needs something after the sign: write ^{-1}.'],
    ['two superscripts', 'x^2^3', 3, 'Two superscripts in a row. Group them with braces, as in x^{a^b}.'],
    ['two subscripts', 'x_1_2', 3, 'Two subscripts in a row. Group them with braces, as in x_{a_b}.'],
    ['a prime after a superscript', "x^2'", 3, 'A prime cannot follow a superscript. Write the prime first, or group with braces.'],
    ['\\left without \\right', '\\left( a', 0, '\\left has no matching \\right.'],
    ['\\right without \\left', 'a \\right)', 2, '\\right has no matching \\left.'],
    ['\\left with a bad delimiter', '\\left\\{ a \\right\\}', 0, '\\left needs one of ( [ | . after it.'],
    ['\\right with a bad delimiter', '\\left( a \\right>', 9, '\\right needs one of ) ] | . after it.'],
    ['a group closed by \\right', '{a \\right)', 3, '\\right has no matching \\left.'],
  ];
  it.each(cases)('%s', (_name, src, at, message) => {
    expect(parseMath(src)).toEqual({ ok: false, message, at });
  });

  it(`accepts ${MATH_MAX_DEPTH - 1} nested groups and rejects more, without overflowing the stack`, () => {
    const nest = (d: number) => `${'{'.repeat(d)}x${'}'.repeat(d)}`;
    expect(parseMath(nest(MATH_MAX_DEPTH - 1)).ok).toBe(true);
    const over = parseMath(nest(MATH_MAX_DEPTH));
    expect(over).toMatchObject({ ok: false, message: `Math is nested more than ${MATH_MAX_DEPTH} levels deep. Simplify the expression.` });
    for (const opener of ['{', '\\frac{', '\\sqrt{', '\\left(', '\\sqrt[', 'x^{', 'x_{']) {
      const deep = parseMath(opener.repeat(50_000));
      expect(deep.ok, opener).toBe(false);
    }
  });

  it('never throws, on 5,000 random strings', () => {
    const rand = rng(41);
    const pool = ['x', 'y', '2', '10', '.', ',', '+', '-', '=', '^', '_', '{', '}', '[', ']', '(', ')', '|', "'", ' ', '\\', '\\frac', '\\sqrt', '\\left', '\\right', '\\text', '\\alpha', '\\sum', '\\lim', '\\,', '\\foo', '#', '&', '<', '>', 'é', '中', '≤'];
    let parsed = 0;
    for (let k = 0; k < 5000; k++) {
      let s = '';
      const len = 1 + Math.floor(rand() * 14);
      for (let i = 0; i < len; i++) s += pick(rand, pool);
      const r = parseMath(s);
      if (r.ok) {
        parsed++;
        for (const d of [false, true]) expect([...elementsOf(mathToMathML(r.nodes, d))].every((n) => MATHML_CORE.has(n)), s).toBe(true);
        expect(typeof mathToText(r.nodes)).toBe('string');
      } else {
        expect(r.at).toBeGreaterThanOrEqual(0);
        expect(r.at).toBeLessThanOrEqual(s.length);
        expect(r.message.length).toBeGreaterThan(0);
        expect(r.message.length).toBeLessThan(120);
      }
    }
    // The pool is hostile, but a fair share of what it produces is valid math.
    expect(parsed).toBeGreaterThan(300);
  });
});

describe('mathToMathML: safe to place in HTML as it is', () => {
  const hostile: Array<[string, string]> = [
    ['markup in text', '\\text{</mtext></math><script>alert(1)</script>}'],
    ['an attribute breakout in text', '\\text{" onload="alert(1)}'],
    ['an entity in text', '\\text{&lt;script&gt; &amp; &#x3c;}'],
    ['comparison operators', 'a < b > c'],
    ['a single quote in text', "\\text{it's}"],
    ['an image tag in text', '\\text{<img src=x onerror=alert(1)>}'],
  ];
  it.each(hostile)('%s', (_name, src) => {
    for (const d of [false, true]) {
      const out = mathToMathML(ok(src), d);
      // `elementsOf` accepts only complete tags with plain quoted attributes and text with no raw
      // "<", ">" or bare "&", so passing it means nothing in the source became markup.
      const names = elementsOf(out);
      expect([...names].every((n) => MATHML_CORE.has(n)), out).toBe(true);
      expect(out.match(/<[a-z]+/g)?.length, out).toBe(src.startsWith('\\text') ? 3 : 7);
      expect(out.startsWith('<math display="')).toBe(true);
      expect(out.endsWith('</math>')).toBe(true);
    }
  });

  it('escapes the five characters', () => {
    expect(inline('\\text{<>&"\'}')).toBe('<mtext>&lt;&gt;&amp;&quot;&#39;</mtext>');
  });

  it('never emits a style attribute, a class, an id or an event handler', () => {
    for (const src of [...MATH_COMMAND_GROUPS.structure, '\\sum_{i=1}^{n} i', '\\left( x \\right)', '|x|', '-x', '\\log n']) {
      const r = parseMath(src.replace(/\.\.\./g, 'x'));
      if (!r.ok) continue;
      expect(mathToMathML(r.nodes, true)).not.toMatch(/ (style|class|id|on[a-z]+|href|src)=/);
    }
  });
});

describe('the exported lists of what is supported', () => {
  const arity = (cmd: string): string => {
    if (cmd === '\\frac') return '\\frac{a}{b}';
    if (cmd === '\\sqrt') return '\\sqrt{x}';
    if (cmd === '\\text') return '\\text{words}';
    if (cmd === '\\left') return '\\left( x \\right)';
    if (cmd === '\\right') return '\\left[ x \\right]';
    return `a ${cmd} b`;
  };

  it.each(MATH_COMMANDS.map((c) => [c]))('%s parses', (cmd) => {
    expect(parseMath(arity(cmd))).toMatchObject({ ok: true });
  });

  it.each(MATH_OPERATORS.map((c) => [c]))('operator %s parses', (op) => {
    expect(parseMath(`a ${op} b`)).toMatchObject({ ok: true });
  });

  it.each(Object.entries(MATH_COMMAND_GROUPS).flatMap(([group, items]) => items.map((item) => [group, item])))('%s example %s parses', (_group, item) => {
    expect(parseMath(item.replace(/\.\.\./g, 'x'))).toMatchObject({ ok: true });
  });

  it('names every command the contract lists', () => {
    const required = ['frac', 'sqrt', 'text', 'times', 'cdot', 'div', 'pm', 'le', 'ge', 'ne', 'approx', 'to', 'infty', 'sum', 'prod', 'int', 'log', 'ln', 'sin', 'cos', 'tan', 'lim', 'min', 'max', 'left', 'right', ',', 'alpha', 'beta', 'gamma', 'delta', 'theta', 'lambda', 'mu', 'pi', 'sigma', 'omega', 'Delta', 'Sigma', 'Omega'];
    for (const name of required) expect(MATH_COMMANDS, name).toContain(`\\${name}`);
    for (const op of ['+', '-', '=', '<', '>', '/', '*', '(', ')', '[', ']', ',', '.', '!', '|']) expect(MATH_OPERATORS, op).toContain(op);
  });

  it('has no duplicates, and the help line mentions the main forms', () => {
    expect(new Set(MATH_COMMANDS).size).toBe(MATH_COMMANDS.length);
    for (const piece of ['\\frac{}{}', '\\sqrt[n]{}', '\\text{}', '\\left( \\right)', '\\alpha', '\\times', '\\sum', '\\log']) expect(MATH_HELP).toContain(piece);
    expect(MATH_HELP.length).toBeLessThan(600);
  });

  it('an unknown command that is close to a supported one is still an error naming it', () => {
    for (const name of ['Frac', 'SQRT', 'Alpha', 'lg', 'arcsin', 'cdots', 'leqslant']) {
      expect(parseMath(`\\${name}`)).toEqual({ ok: false, message: `Unsupported command \\${name}.`, at: 0 });
    }
  });
});
