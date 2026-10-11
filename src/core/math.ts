// The small LaTeX subset that lessons may use inside `$...$` and in `lines` figures with
// `format: "math"`. A string either parses into typed nodes or is rejected with a message that
// names what is unsupported. Nothing is ever passed through as raw markup: `mathToMathML` builds
// every element itself and escapes every character it places inside one.
//
// Environment-neutral: no node: imports, no DOM. The browser bundle may import this file.

/** One parsed piece of math. Rows are plain arrays; a `row` node is a `{...}` group. */
export type MathNode =
  | { t: 'num'; v: string }
  /** One variable: a Latin or Greek letter. `upright` for capital Greek, the infinity sign and `%`. */
  | { t: 'id'; v: string; upright?: boolean }
  | { t: 'op'; v: string }
  /** A named function (`log`, `sin`, `lim`). `limits` when a script belongs under it in display style. */
  | { t: 'fn'; v: string; limits?: boolean }
  /** A large operator: sum, product, integral. */
  | { t: 'big'; v: string; limits?: boolean }
  | { t: 'text'; v: string }
  /** Explicit spacing, in em. */
  | { t: 'space'; em: number }
  | { t: 'row'; c: MathNode[] }
  | { t: 'script'; base: MathNode; sub?: MathNode[]; sup?: MathNode[] }
  | { t: 'frac'; num: MathNode[]; den: MathNode[] }
  | { t: 'sqrt'; body: MathNode[]; index?: MathNode[] }
  /** `\left( ... \right)`. An empty string is the invisible delimiter written as `.`. */
  | { t: 'fenced'; open: string; close: string; c: MathNode[] };

export type MathResult = { ok: true; nodes: MathNode[] } | { ok: false; message: string; at: number };

/** Groups, fractions, roots and \left pairs may nest this deep. Deeper input is rejected, so no parser or renderer recursion is unbounded. */
export const MATH_MAX_DEPTH = 16;

// Lookups are Maps, never plain objects: a command name comes from the agent, and `\constructor`
// must not find Object.prototype.
const GREEK = new Map<string, string>([
  ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['epsilon', 'ϵ'], ['varepsilon', 'ε'], ['zeta', 'ζ'],
  ['eta', 'η'], ['theta', 'θ'], ['vartheta', 'ϑ'], ['iota', 'ι'], ['kappa', 'κ'], ['lambda', 'λ'], ['mu', 'μ'], ['nu', 'ν'],
  ['xi', 'ξ'], ['pi', 'π'], ['rho', 'ρ'], ['sigma', 'σ'], ['tau', 'τ'], ['upsilon', 'υ'], ['phi', 'ϕ'], ['varphi', 'φ'],
  ['chi', 'χ'], ['psi', 'ψ'], ['omega', 'ω'],
  ['Gamma', 'Γ'], ['Delta', 'Δ'], ['Theta', 'Θ'], ['Lambda', 'Λ'], ['Xi', 'Ξ'], ['Pi', 'Π'], ['Sigma', 'Σ'],
  ['Upsilon', 'Υ'], ['Phi', 'Φ'], ['Psi', 'Ψ'], ['Omega', 'Ω'],
]);

const MINUS = '\u2212';
const PRIME = '\u2032';

/** Commands that stand for one operator character. `\leq`, `\geq`, `\neq` and `\rightarrow` are the long spellings of `\le`, `\ge`, `\ne` and `\to`. */
const SYMBOLS = new Map<string, string>([
  ['times', '×'], ['cdot', '⋅'], ['div', '÷'], ['pm', '±'],
  ['le', '≤'], ['leq', '≤'], ['ge', '≥'], ['geq', '≥'], ['ne', '≠'], ['neq', '≠'],
  ['approx', '≈'], ['to', '→'], ['rightarrow', '→'],
]);
const BIG = new Map<string, { v: string; limits: boolean }>([
  ['sum', { v: '∑', limits: true }],
  ['prod', { v: '∏', limits: true }],
  ['int', { v: '∫', limits: false }],
]);
const FUNCTIONS = new Map<string, boolean>([
  ['log', false], ['ln', false], ['sin', false], ['cos', false], ['tan', false],
  ['lim', true], ['min', true], ['max', true],
]);
/** Widths follow TeX: thin, medium, thick, a word space, one em. */
const SPACES = new Map<string, number>([[',', 0.167], [':', 0.222], [';', 0.278], [' ', 0.333], ['quad', 1]]);

/** Characters typed directly that mean the same as a supported command. */
const DIRECT_OPS = new Map<string, string>([
  ['×', '×'], ['⋅', '⋅'], ['·', '⋅'], ['÷', '÷'], ['±', '±'], ['≤', '≤'], ['≥', '≥'], ['≠', '≠'], ['≈', '≈'], ['→', '→'], [MINUS, MINUS],
]);
const DIRECT_BIG = new Map<string, string>([['∑', 'sum'], ['∏', 'prod'], ['∫', 'int']]);

/** Operator characters accepted as typed. `-` is shown as a true minus sign and `*` as the asterisk operator, as TeX does. */
export const MATH_OPERATORS: readonly string[] = ['+', '-', '=', '<', '>', '/', '*', '(', ')', '[', ']', ',', '.', '!', '|', ':', '%', "'"];

export type MathCommandGroup = 'structure' | 'greek' | 'symbols' | 'large' | 'functions' | 'delimiters' | 'spacing' | 'escapes';

/** Everything supported, grouped for printing in the skill reference and in error hints. Each entry is itself valid math once `...` is replaced. */
export const MATH_COMMAND_GROUPS: Readonly<Record<MathCommandGroup, readonly string[]>> = {
  structure: ['\\frac{a}{b}', '\\sqrt{x}', '\\sqrt[n]{x}', '\\text{words}', 'x^2', 'x^{n+1}', 'x_i', 'x_{i,j}'],
  greek: [...GREEK.keys()].map((k) => `\\${k}`),
  symbols: [...SYMBOLS.keys(), 'infty'].map((k) => `\\${k}`),
  large: [...BIG.keys()].map((k) => `\\${k}`),
  functions: [...FUNCTIONS.keys()].map((k) => `\\${k}`),
  delimiters: ['\\left( ... \\right)', '\\left[ ... \\right]', '\\left| ... \\right|'],
  spacing: ['\\,', '\\:', '\\;', '\\quad'],
  escapes: ['\\$', '\\%'],
};

/** Flat list of every supported backslash command name, each with its backslash. */
export const MATH_COMMANDS: readonly string[] = [
  '\\frac', '\\sqrt', '\\text', '\\left', '\\right',
  ...MATH_COMMAND_GROUPS.greek,
  ...MATH_COMMAND_GROUPS.symbols,
  ...MATH_COMMAND_GROUPS.large,
  ...MATH_COMMAND_GROUPS.functions,
  ...MATH_COMMAND_GROUPS.spacing,
  '\\ ',
  ...MATH_COMMAND_GROUPS.escapes,
];

/** One paragraph an error hint can append. */
export const MATH_HELP =
  'Math supports numbers, letters, the operators ' +
  MATH_OPERATORS.join(' ') +
  ', ^ and _ with one token or a {group}, ' +
  '\\frac{}{}, \\sqrt{}, \\sqrt[n]{}, \\text{}, \\left( \\right), Greek letters such as \\alpha and \\Delta, and ' +
  [...MATH_COMMAND_GROUPS.symbols, ...MATH_COMMAND_GROUPS.large, ...MATH_COMMAND_GROUPS.functions].join(' ') +
  '. Write anything else in words, or with \\text{}.';

class MathFail {
  readonly message: string;
  readonly at: number;
  constructor(message: string, at: number) {
    this.message = message;
    this.at = at;
  }
}

const LETTER = /\p{L}/u;
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

function isAsciiLetter(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}
function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}
/** After sanitising, a prose string holds only U+0020, but a `lines` entry or a direct caller may not have been sanitised. */
function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0xa0;
}

function describeChar(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  const hex = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  // Controls, spaces, marks and other invisible characters are named by number only, so a message never carries one.
  if (!VISIBLE.test(ch)) return hex;
  return ch === '"' ? `'"' (${hex})` : `"${ch}" (${hex})`;
}

type Stop = 'end' | '}' | ']' | 'right';
type Script = Extract<MathNode, { t: 'script' }>;

// A class rather than closures: a lesson string can hold thousands of tiny math spans, and this
// way parsing one allocates nothing but its nodes.
class Parser {
  private readonly src: string;
  private readonly n: number;
  private i = 0;
  private depth = 0;

  constructor(src: string) {
    this.src = src;
    this.n = src.length;
  }

  private fail(message: string, at: number): never {
    throw new MathFail(message, at);
  }

  private skipSpaces(): void {
    while (this.i < this.n && isSpace(this.src.charCodeAt(this.i))) this.i++;
  }

  private atRight(): boolean {
    return this.src.startsWith('\\right', this.i) && !isAsciiLetter(this.src.charCodeAt(this.i + 6));
  }

  /** Parses until the closer that `stop` names, which it leaves for the caller to consume. */
  row(stop: Stop, openedAt: number): MathNode[] {
    const { src, n } = this;
    if (++this.depth > MATH_MAX_DEPTH) this.fail(`Math is nested more than ${MATH_MAX_DEPTH} levels deep. Simplify the expression.`, openedAt);
    const out: MathNode[] = [];
    for (;;) {
      this.skipSpaces();
      if (this.i >= n) {
        if (stop === 'end') break;
        this.fail(stop === 'right' ? '\\left has no matching \\right.' : `Missing ${stop} to close the ${stop === '}' ? '{' : '['} opened here.`, openedAt);
      }
      const c = src.charCodeAt(this.i);
      if (c === 0x7d /* } */) {
        if (stop === '}') break;
        this.fail('Unexpected }. Every } needs a { before it.', this.i);
      }
      if (c === 0x5d /* ] */ && stop === ']') break;
      if (c === 0x5c /* \ */ && this.atRight()) {
        if (stop === 'right') break;
        this.fail('\\right has no matching \\left.', this.i);
      }
      if (c === 0x5e /* ^ */ || c === 0x5f /* _ */) {
        const at = this.i;
        this.i++;
        const arg = this.scriptArg(c === 0x5e ? '^' : '_', at);
        const base = this.popBase(out);
        if (c === 0x5e) {
          if (base.sup) this.fail('Two superscripts in a row. Group them with braces, as in x^{a^b}.', at);
          base.sup = arg;
        } else {
          if (base.sub) this.fail('Two subscripts in a row. Group them with braces, as in x_{a_b}.', at);
          base.sub = arg;
        }
        out.push(base);
        continue;
      }
      if (c === 0x27 /* ' */ || c === 0x2032) {
        const at = this.i;
        const primes: MathNode[] = [];
        while (this.i < n && (src.charCodeAt(this.i) === 0x27 || src.charCodeAt(this.i) === 0x2032)) {
          primes.push({ t: 'op', v: PRIME });
          this.i++;
        }
        const base = this.popBase(out);
        if (base.sup) this.fail('A prime cannot follow a superscript. Write the prime first, or group with braces.', at);
        base.sup = primes;
        out.push(base);
        continue;
      }
      out.push(this.atom());
    }
    this.depth--;
    return out;
  }

  /** The node a script attaches to: the previous item, or an empty group when there is none (as in `{}^{14}C`). */
  private popBase(out: MathNode[]): Script {
    const last = out.pop();
    if (!last) return { t: 'script', base: { t: 'row', c: [] } };
    if (last.t === 'script') return last;
    return { t: 'script', base: last };
  }

  private scriptArg(which: '^' | '_', at: number): MathNode[] {
    const { src, n } = this;
    this.skipSpaces();
    const hint = which === '^' ? 'x^2 or x^{n+1}' : 'x_i or x_{i,j}';
    if (this.i >= n) this.fail(`${which} needs something after it: write ${hint}.`, at);
    const ch = src[this.i] as string;
    if (ch === '{') return this.group();
    if (ch === '^' || ch === '_' || ch === '}' || ch === "'" || (ch === '\\' && this.atRight())) this.fail(`${which} needs something after it: write ${hint}.`, at);
    // `10^-3` is read as `10^{-3}`: a sign belongs with the token that follows it.
    if (ch === '-' || ch === '+' || ch === MINUS) {
      this.i++;
      const sign: MathNode = { t: 'op', v: ch === '+' ? '+' : MINUS };
      this.skipSpaces();
      if (this.i >= n || '^_}\''.includes(src[this.i] as string)) this.fail(`${which} needs something after the sign: write ${which}{-1}.`, at);
      if (src[this.i] === '{') return [sign, ...this.group()];
      return [sign, this.atom()];
    }
    return [this.atom()];
  }

  private group(): MathNode[] {
    const at = this.i;
    this.i++;
    const c = this.row('}', at);
    this.i++;
    return c;
  }

  private requiredGroup(command: string, at: number, shape: string): MathNode[] {
    this.skipSpaces();
    if (this.src[this.i] !== '{') this.fail(`${command} needs braces: write ${shape}.`, at);
    return this.group();
  }

  private atom(): MathNode {
    const { src } = this;
    const c = src.charCodeAt(this.i);
    if (isAsciiLetter(c)) return { t: 'id', v: src[this.i++] as string };
    if (isDigit(c) || (c === 0x2e && isDigit(src.charCodeAt(this.i + 1)))) return this.number();
    const ch = src[this.i] as string;
    switch (ch) {
      case '{':
        return { t: 'row', c: this.group() };
      case '\\':
        return this.command();
      case '-':
        this.i++;
        return { t: 'op', v: MINUS };
      case '*':
        this.i++;
        return { t: 'op', v: '∗' };
      case '%':
        this.i++;
        return { t: 'id', v: '%', upright: true };
      case '+': case '=': case '<': case '>': case '/': case '(': case ')': case '[': case ']': case ',': case '.': case '!': case '|': case ':':
        this.i++;
        return { t: 'op', v: ch };
    }
    if (c < 0x80) return this.fail(`Unsupported character ${describeChar(ch)} in math.`, this.i);
    const direct = DIRECT_OPS.get(ch);
    if (direct) {
      this.i++;
      return { t: 'op', v: direct };
    }
    const big = DIRECT_BIG.get(ch);
    if (big) {
      this.i++;
      const def = BIG.get(big) as { v: string; limits: boolean };
      return { t: 'big', v: def.v, limits: def.limits };
    }
    if (ch === '∞') {
      this.i++;
      return { t: 'id', v: '∞', upright: true };
    }
    const full = String.fromCodePoint(src.codePointAt(this.i) as number);
    if (LETTER.test(full)) {
      this.i += full.length;
      return { t: 'id', v: full };
    }
    return this.fail(`Unsupported character ${describeChar(full)} in math.`, this.i);
  }

  private number(): MathNode {
    const { src, n } = this;
    const start = this.i;
    let i = start;
    while (i < n && isDigit(src.charCodeAt(i))) i++;
    // Thousands groups stay inside one number, so "1,000" is not drawn as a list of two.
    if (i - start >= 1 && i - start <= 3) {
      while (src.charCodeAt(i) === 0x2c && isDigit(src.charCodeAt(i + 1)) && isDigit(src.charCodeAt(i + 2)) && isDigit(src.charCodeAt(i + 3)) && !isDigit(src.charCodeAt(i + 4))) {
        i += 4;
      }
    }
    if (src.charCodeAt(i) === 0x2e && isDigit(src.charCodeAt(i + 1))) {
      i++;
      while (i < n && isDigit(src.charCodeAt(i))) i++;
    }
    this.i = i;
    return { t: 'num', v: src.slice(start, i) };
  }

  private command(): MathNode {
    const { src, n } = this;
    const at = this.i;
    this.i++;
    if (this.i >= n) this.fail('A backslash needs a command name after it, such as \\frac.', at);
    let name: string;
    if (isAsciiLetter(src.charCodeAt(this.i))) {
      const from = this.i;
      while (this.i < n && isAsciiLetter(src.charCodeAt(this.i))) this.i++;
      name = src.slice(from, this.i);
    } else {
      name = String.fromCodePoint(src.codePointAt(this.i) as number);
      this.i += name.length;
    }

    switch (name) {
      case 'frac': {
        const num = this.requiredGroup('\\frac', at, '\\frac{a}{b}');
        const den = this.requiredGroup('\\frac', at, '\\frac{a}{b}');
        return { t: 'frac', num, den };
      }
      case 'sqrt': {
        this.skipSpaces();
        let index: MathNode[] | undefined;
        if (src[this.i] === '[') {
          const open = this.i;
          this.i++;
          index = this.row(']', open);
          this.i++;
        }
        const body = this.requiredGroup('\\sqrt', at, '\\sqrt{x}');
        return index ? { t: 'sqrt', body, index } : { t: 'sqrt', body };
      }
      case 'text': {
        this.skipSpaces();
        if (src[this.i] !== '{') this.fail('\\text needs braces: write \\text{words}.', at);
        const close = src.indexOf('}', this.i + 1);
        if (close === -1) this.fail('Missing } to close \\text{.', at);
        const v = src.slice(this.i + 1, close);
        const nested = v.indexOf('{');
        if (nested !== -1) this.fail('\\text{} cannot contain {.', this.i + 1 + nested);
        this.i = close + 1;
        return { t: 'text', v };
      }
      case 'left': {
        const open = this.delimiter('\\left', at, '([|.');
        const c = this.row('right', at);
        const rightAt = this.i;
        this.i += 6;
        const close = this.delimiter('\\right', rightAt, ')]|.');
        return { t: 'fenced', open: open === '.' ? '' : open, close: close === '.' ? '' : close, c };
      }
      case 'right':
        return this.fail('\\right has no matching \\left.', at);
      case 'infty':
        return { t: 'id', v: '∞', upright: true };
      case '$':
      case '%':
        return { t: 'id', v: name, upright: true };
    }
    const greek = GREEK.get(name);
    if (greek) return name.charCodeAt(0) <= 0x5a ? { t: 'id', v: greek, upright: true } : { t: 'id', v: greek };
    const symbol = SYMBOLS.get(name);
    if (symbol) return { t: 'op', v: symbol };
    const big = BIG.get(name);
    if (big) return { t: 'big', v: big.v, limits: big.limits };
    const limits = FUNCTIONS.get(name);
    if (limits !== undefined) return limits ? { t: 'fn', v: name, limits: true } : { t: 'fn', v: name };
    const em = SPACES.get(name);
    if (em !== undefined) return { t: 'space', em };
    // The name is letters only, or one character, and is shortened: a message never carries a long run of agent text.
    const shown = isAsciiLetter(name.charCodeAt(0)) ? `\\${name.slice(0, 24)}` : `\\ followed by ${describeChar(name)}`;
    return this.fail(`Unsupported command ${shown}.`, at);
  }

  private delimiter(command: string, at: number, allowed: string): string {
    this.skipSpaces();
    const ch = this.src[this.i];
    if (ch === undefined || !allowed.includes(ch)) this.fail(`${command} needs one of ${allowed.split('').join(' ')} after it.`, at);
    this.i++;
    return ch as string;
  }
}

/**
 * Parse one expression in the supported subset.
 * `at` is the offset in `src` (UTF-16 units) of the first thing that is not supported.
 */
export function parseMath(src: string): MathResult {
  try {
    const nodes = new Parser(src).row('end', 0);
    if (nodes.length === 0) return { ok: false, message: 'Empty math expression.', at: 0 };
    return { ok: true, nodes };
  } catch (e) {
    if (e instanceof MathFail) return { ok: false, message: e.message, at: Math.min(Math.max(e.at, 0), src.length) };
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// MathML
// ---------------------------------------------------------------------------------------------

function esc(s: string): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const rep = c === 0x26 ? '&amp;' : c === 0x3c ? '&lt;' : c === 0x3e ? '&gt;' : c === 0x22 ? '&quot;' : c === 0x27 ? '&#39;' : '';
    if (rep) {
      out += s.slice(from, i) + rep;
      from = i + 1;
    }
  }
  return from === 0 ? s : out + s.slice(from);
}

const THIN_SPACE = '<mspace width="0.167em"></mspace>';
/** U+2061 FUNCTION APPLICATION, so assistive technology reads "sine of x". */
const APPLY = '<mo>&#x2061;</mo>';
const SIGNS = new Set(['+', MINUS, '±']);
/** After one of these a sign is binary, not a prefix. */
const OPERAND_END = new Set([')', ']', '!', PRIME]);

function isFunction(node: MathNode): boolean {
  return node.t === 'fn' || (node.t === 'script' && node.base.t === 'fn');
}
function isBig(node: MathNode): boolean {
  return node.t === 'big' || (node.t === 'script' && node.base.t === 'big');
}
function opensFence(node: MathNode): boolean {
  return node.t === 'fenced' || (node.t === 'op' && (node.v === '(' || node.v === '['));
}
/** True when `node` ends something a following function name or binary sign applies to. */
function endsOperand(node: MathNode, openBar: boolean): boolean {
  if (node.t === 'op') return OPERAND_END.has(node.v) || (node.v === '|' && !openBar);
  return node.t !== 'space' && node.t !== 'big';
}

function emitRow(nodes: MathNode[], display: boolean): string {
  let out = '';
  // Bars are not marked as opening or closing in the source, so they are paired by counting.
  let bars = 0;
  let spaced = false;
  for (let k = 0; k < nodes.length; k++) {
    const node = nodes[k] as MathNode;
    const prev = nodes[k - 1];
    const next = nodes[k + 1];
    const afterOpenBar = bars % 2 === 1;
    const afterSpace = spaced;
    spaced = false;
    if (node.t === 'op' && node.v === '|') bars++;
    if (isFunction(node)) {
      // A function name is set off from its neighbours by a thin space, as TeX does, except before a bracket.
      if (prev && !afterSpace && endsOperand(prev, afterOpenBar)) out += THIN_SPACE;
      out += emit(node, display);
      if (next) {
        out += APPLY;
        if (!opensFence(next)) {
          out += THIN_SPACE;
          spaced = true;
        }
      }
      continue;
    }
    if (node.t === 'op' && SIGNS.has(node.v) && (!prev || !endsOperand(prev, afterOpenBar))) {
      out += `<mo form="prefix">${esc(node.v)}</mo>`;
      continue;
    }
    out += emit(node, display);
  }
  return out;
}

/** Exactly one element, as the children of msup, mfrac and friends must be. */
function one(nodes: MathNode[], display: boolean): string {
  const first = nodes[0];
  if (nodes.length === 1 && first && first.t !== 'space' && !(first.t === 'op' && SIGNS.has(first.v))) return emit(first, display);
  return `<mrow>${emitRow(nodes, display)}</mrow>`;
}

function emit(node: MathNode, display: boolean): string {
  switch (node.t) {
    case 'num':
      return `<mn>${esc(node.v)}</mn>`;
    case 'id':
      return node.upright ? `<mi mathvariant="normal">${esc(node.v)}</mi>` : `<mi>${esc(node.v)}</mi>`;
    case 'op':
      // Plain brackets and bars keep their size; only \left and \right stretch.
      if (node.v === '|') return '<mo stretchy="false" lspace="0" rspace="0">|</mo>';
      if (node.v === '(' || node.v === ')' || node.v === '[' || node.v === ']') return `<mo stretchy="false">${node.v}</mo>`;
      return `<mo>${esc(node.v)}</mo>`;
    case 'fn':
      return `<mi>${esc(node.v)}</mi>`;
    case 'big':
      return `<mo>${esc(node.v)}</mo>`;
    case 'text': {
      // MathML trims white space at the ends of token elements; a no-break space survives.
      const v = node.v.replace(/^ +| +$/g, (m) => '\u00a0'.repeat(m.length));
      return `<mtext>${esc(v)}</mtext>`;
    }
    case 'space':
      return `<mspace width="${node.em}em"></mspace>`;
    case 'row':
      return `<mrow>${emitRow(node.c, display)}</mrow>`;
    case 'script': {
      const base = emit(node.base, display);
      const limits = display && (node.base.t === 'fn' || node.base.t === 'big') && node.base.limits === true;
      // Scripts are always set in text style, like TeX.
      const sub = node.sub ? one(node.sub, false) : '';
      const sup = node.sup ? one(node.sup, false) : '';
      if (node.sub && node.sup) return limits ? `<munderover>${base}${sub}${sup}</munderover>` : `<msubsup>${base}${sub}${sup}</msubsup>`;
      if (node.sub) return limits ? `<munder>${base}${sub}</munder>` : `<msub>${base}${sub}</msub>`;
      if (node.sup) return limits ? `<mover>${base}${sup}</mover>` : `<msup>${base}${sup}</msup>`;
      return base;
    }
    case 'frac':
      return `<mfrac><mrow>${emitRow(node.num, false)}</mrow><mrow>${emitRow(node.den, false)}</mrow></mfrac>`;
    case 'sqrt':
      if (node.index) return `<mroot><mrow>${emitRow(node.body, display)}</mrow><mrow>${emitRow(node.index, false)}</mrow></mroot>`;
      return `<msqrt>${emitRow(node.body, display)}</msqrt>`;
    case 'fenced': {
      const open = node.open ? `<mo fence="true">${esc(node.open)}</mo>` : '';
      const close = node.close ? `<mo fence="true">${esc(node.close)}</mo>` : '';
      return `<mrow>${open}${emitRow(node.c, display)}${close}</mrow>`;
    }
  }
}

/**
 * A complete `<math>` element for nodes returned by `parseMath`. Every character taken from the
 * nodes is escaped, and element and attribute names are fixed strings, so the result is safe to
 * place in HTML as it is. This is the only place MathML is produced.
 */
export function mathToMathML(nodes: MathNode[], display: boolean): string {
  return `<math display="${display ? 'block' : 'inline'}"><mrow>${emitRow(nodes, display)}</mrow></math>`;
}

// ---------------------------------------------------------------------------------------------
// Linear text
// ---------------------------------------------------------------------------------------------

const SPACED = new Set(['=', '<', '>', '≤', '≥', '≠', '≈', '→', '×', '÷', '⋅', '∗', ':']);

function textRow(nodes: MathNode[]): string {
  let out = '';
  let bars = 0;
  for (let k = 0; k < nodes.length; k++) {
    const node = nodes[k] as MathNode;
    const prev = nodes[k - 1];
    const next = nodes[k + 1];
    const afterOpenBar = bars % 2 === 1;
    if (node.t === 'op') {
      if (node.v === '|') bars++;
      if (SPACED.has(node.v)) out += ` ${node.v} `;
      else if (SIGNS.has(node.v)) out += prev && endsOperand(prev, afterOpenBar) ? ` ${node.v} ` : node.v;
      else if (node.v === ',') out += ', ';
      else out += node.v;
      continue;
    }
    if (isFunction(node) || isBig(node)) {
      if (prev && endsOperand(prev, afterOpenBar)) out += ' ';
      out += text(node);
      if (next && !opensFence(next)) out += ' ';
      continue;
    }
    out += text(node);
  }
  return out;
}

/** One script or fraction part: bare when it is a single simple token, in parentheses otherwise. */
function textArg(nodes: MathNode[]): string {
  const first = nodes[0];
  if (nodes.length === 1 && first && (first.t === 'num' || first.t === 'id' || first.t === 'text' || first.t === 'fn')) return text(first);
  return `(${tidy(textRow(nodes))})`;
}

function text(node: MathNode): string {
  switch (node.t) {
    case 'num':
    case 'id':
    case 'op':
    case 'fn':
    case 'big':
    case 'text':
      return node.v;
    case 'space':
      return ' ';
    case 'row':
      return textRow(node.c);
    case 'script': {
      let out = text(node.base);
      if (node.sub) out += `_${textArg(node.sub)}`;
      if (node.sup) out += node.sup.every((p) => p.t === 'op' && p.v === PRIME) ? "'".repeat(node.sup.length) : `^${textArg(node.sup)}`;
      return out;
    }
    case 'frac':
      return `${textArg(node.num)}/${textArg(node.den)}`;
    case 'sqrt':
      return node.index ? `√[${tidy(textRow(node.index))}]${textArg(node.body)}` : `√${textArg(node.body)}`;
    case 'fenced':
      return `${node.open}${tidy(textRow(node.c))}${node.close}`;
  }
}

function tidy(s: string): string {
  return s.replace(/ {2,}/g, ' ').trim();
}

/**
 * The expression on one line of plain text: `x^2 + y^2 = r^2`, `(a + b)/2`, `√(x + 1)`.
 * Used wherever markup is removed: word counts, narration, the summary.
 */
export function mathToText(nodes: MathNode[]): string {
  return tidy(textRow(nodes));
}
