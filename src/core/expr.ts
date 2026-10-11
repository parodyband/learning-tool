// A small arithmetic language for interactive lessons: the formula behind a slider.
//
// The agent writes "sick * sensitivity" or "a * x^2 + b"; the validator parses it here before a
// lesson can be published, and the player evaluates it here while the learner drags. There is no
// eval and no access to anything: an expression is numbers, named values, a fixed list of
// functions, and operators. Environment-neutral (no node imports): the page bundles this file.

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'un'; op: '-' | 'not'; a: Expr }
  | { t: 'bin'; op: BinOp; a: Expr; b: Expr }
  | { t: 'call'; fn: string; args: Expr[] };

export type BinOp = '+' | '-' | '*' | '/' | '^' | '<' | '<=' | '>' | '>=' | '==' | '!=' | 'and' | 'or';

export type ExprResult = { ok: true; expr: Expr; vars: string[] } | { ok: false; message: string; at: number };

/** Hard limits. An expression is checked against them at parse time, so evaluation is always cheap. */
export const EXPR_LIMITS = { chars: 120, nodes: 80, depth: 24 } as const;

const truth = (b: boolean): number => (b ? 1 : 0);

/** Every function an expression may call, with how many arguments it takes. */
export const EXPR_FUNCTIONS: Readonly<Record<string, { min: number; max: number; f: (...a: number[]) => number }>> = {
  abs: { min: 1, max: 1, f: Math.abs },
  sqrt: { min: 1, max: 1, f: Math.sqrt },
  exp: { min: 1, max: 1, f: Math.exp },
  ln: { min: 1, max: 1, f: Math.log },
  log2: { min: 1, max: 1, f: Math.log2 },
  log10: { min: 1, max: 1, f: Math.log10 },
  sin: { min: 1, max: 1, f: Math.sin },
  cos: { min: 1, max: 1, f: Math.cos },
  tan: { min: 1, max: 1, f: Math.tan },
  floor: { min: 1, max: 1, f: Math.floor },
  ceil: { min: 1, max: 1, f: Math.ceil },
  round: { min: 1, max: 1, f: Math.round },
  min: { min: 2, max: 4, f: Math.min },
  max: { min: 2, max: 4, f: Math.max },
  clamp: { min: 3, max: 3, f: (x, lo, hi) => Math.min(Math.max(x, lo), hi) },
  /** if(condition, then, otherwise): the only branching there is. */
  if: { min: 3, max: 3, f: (c, a, b) => (c !== 0 ? a : b) },
};

export const EXPR_CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E };

const WORD_OPS = new Set(['and', 'or', 'not']);

/** Names a value may not take, because the language already uses them. */
export const EXPR_RESERVED: ReadonlySet<string> = new Set([...Object.keys(EXPR_FUNCTIONS), ...Object.keys(EXPR_CONSTANTS), ...WORD_OPS]);

/** One paragraph for error hints and the skill reference. */
export const EXPR_HELP =
  'A formula uses numbers, your control ids (and x on a curve), + - * / ^, parentheses, comparisons (< <= > >= == !=) joined with and / or / not, ' +
  `the constants pi and e, and these functions: ${Object.keys(EXPR_FUNCTIONS).join(', ')}. At most ${EXPR_LIMITS.chars} characters.`;

type Token = { k: 'num'; v: number; at: number } | { k: 'id'; v: string; at: number } | { k: 'op'; v: string; at: number } | { k: 'end'; at: number };

class Fail extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i] as string;
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if ((c >= '0' && c <= '9') || (c === '.' && i + 1 < n && (src[i + 1] as string) >= '0' && (src[i + 1] as string) <= '9')) {
      let j = i;
      while (j < n && (src[j] as string) >= '0' && (src[j] as string) <= '9') j++;
      if (src[j] === '.') {
        j++;
        while (j < n && (src[j] as string) >= '0' && (src[j] as string) <= '9') j++;
      }
      if ((src[j] === 'e' || src[j] === 'E') && j + 1 < n) {
        let k = j + 1;
        if (src[k] === '+' || src[k] === '-') k++;
        if (k < n && (src[k] as string) >= '0' && (src[k] as string) <= '9') {
          while (k < n && (src[k] as string) >= '0' && (src[k] as string) <= '9') k++;
          j = k;
        }
      }
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) throw new Fail('That number is too large.', i);
      out.push({ k: 'num', v, at: i });
      i = j;
      continue;
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j] as string)) j++;
      out.push({ k: 'id', v: src.slice(i, j), at: i });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '==' || two === '!=') {
      out.push({ k: 'op', v: two, at: i });
      i += 2;
      continue;
    }
    if ('+-*/^(),<>'.includes(c)) {
      out.push({ k: 'op', v: c, at: i });
      i++;
      continue;
    }
    throw new Fail(`"${c}" is not part of a formula.`, i);
  }
  out.push({ k: 'end', at: n });
  return out;
}

/**
 * Parse a formula. Never throws. Precedence, loosest first: or, and, not, comparison, + -, * /,
 * unary minus, ^ (right to left, so -x^2 is -(x^2)).
 */
export function parseExpr(src: string): ExprResult {
  if (typeof src !== 'string' || src.trim() === '') return { ok: false, message: 'The formula is empty.', at: 0 };
  if (src.length > EXPR_LIMITS.chars) return { ok: false, message: `A formula is at most ${EXPR_LIMITS.chars} characters.`, at: EXPR_LIMITS.chars };
  let tokens: Token[];
  try {
    tokens = tokenize(src);
  } catch (e) {
    return e instanceof Fail ? { ok: false, message: e.message, at: e.at } : { ok: false, message: 'The formula could not be read.', at: 0 };
  }
  let p = 0;
  let nodes = 0;
  const vars = new Set<string>();
  const peek = (): Token => tokens[p] as Token;
  const isOp = (v: string): boolean => {
    const t = peek();
    return (t.k === 'op' && t.v === v) || (t.k === 'id' && WORD_OPS.has(v) && t.v === v);
  };
  const node = <T extends Expr>(e: T, at: number): T => {
    if (++nodes > EXPR_LIMITS.nodes) throw new Fail('The formula is too long: split it into two bindings.', at);
    return e;
  };
  const deeper = (depth: number, at: number): number => {
    if (depth >= EXPR_LIMITS.depth) throw new Fail('The formula is nested too deeply.', at);
    return depth + 1;
  };

  const or = (d: number): Expr => {
    let a = and(d);
    while (isOp('or')) {
      const at = peek().at;
      p++;
      a = node({ t: 'bin', op: 'or', a, b: and(d) }, at);
    }
    return a;
  };
  const and = (d: number): Expr => {
    let a = not(d);
    while (isOp('and')) {
      const at = peek().at;
      p++;
      a = node({ t: 'bin', op: 'and', a, b: not(d) }, at);
    }
    return a;
  };
  const not = (d: number): Expr => {
    if (isOp('not')) {
      const at = peek().at;
      p++;
      return node({ t: 'un', op: 'not', a: not(deeper(d, at)) }, at);
    }
    return compare(d);
  };
  const compare = (d: number): Expr => {
    const a = sum(d);
    const t = peek();
    if (t.k === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(t.v)) {
      p++;
      const b = sum(d);
      const next = peek();
      if (next.k === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(next.v)) throw new Fail('Join two comparisons with "and": a < b and b < c.', next.at);
      return node({ t: 'bin', op: t.v as BinOp, a, b }, t.at);
    }
    return a;
  };
  const sum = (d: number): Expr => {
    let a = product(d);
    for (;;) {
      const t = peek();
      if (t.k !== 'op' || (t.v !== '+' && t.v !== '-')) return a;
      p++;
      a = node({ t: 'bin', op: t.v as BinOp, a, b: product(d) }, t.at);
    }
  };
  const product = (d: number): Expr => {
    let a = unary(d);
    for (;;) {
      const t = peek();
      if (t.k !== 'op' || (t.v !== '*' && t.v !== '/')) return a;
      p++;
      a = node({ t: 'bin', op: t.v as BinOp, a, b: unary(d) }, t.at);
    }
  };
  const unary = (d: number): Expr => {
    const t = peek();
    if (t.k === 'op' && t.v === '-') {
      p++;
      return node({ t: 'un', op: '-', a: unary(deeper(d, t.at)) }, t.at);
    }
    if (t.k === 'op' && t.v === '+') {
      p++;
      return unary(deeper(d, t.at));
    }
    return power(d);
  };
  const power = (d: number): Expr => {
    const base = primary(d);
    const t = peek();
    if (t.k === 'op' && t.v === '^') {
      p++;
      // Right to left, and the exponent may carry its own sign: 2^-x.
      return node({ t: 'bin', op: '^', a: base, b: unary(deeper(d, t.at)) }, t.at);
    }
    return base;
  };
  const primary = (d: number): Expr => {
    const t = peek();
    if (t.k === 'num') {
      p++;
      return node({ t: 'num', v: t.v }, t.at);
    }
    if (t.k === 'op' && t.v === '(') {
      p++;
      const e = or(deeper(d, t.at));
      const close = peek();
      if (close.k !== 'op' || close.v !== ')') throw new Fail('A bracket is not closed.', t.at);
      p++;
      return e;
    }
    if (t.k === 'id') {
      if (WORD_OPS.has(t.v)) throw new Fail(`"${t.v}" needs a value on each side.`, t.at);
      p++;
      const next = peek();
      if (next.k === 'op' && next.v === '(') {
        const fn = EXPR_FUNCTIONS[t.v];
        if (!Object.prototype.hasOwnProperty.call(EXPR_FUNCTIONS, t.v) || !fn) throw new Fail(`There is no function "${t.v}". ${EXPR_HELP}`, t.at);
        p++;
        const args: Expr[] = [];
        const inner = deeper(d, t.at);
        if (!(peek().k === 'op' && (peek() as { v: string }).v === ')')) {
          for (;;) {
            args.push(or(inner));
            const sep = peek();
            if (sep.k === 'op' && sep.v === ',') {
              p++;
              continue;
            }
            break;
          }
        }
        const close = peek();
        if (close.k !== 'op' || close.v !== ')') throw new Fail(`The bracket after "${t.v}" is not closed.`, next.at);
        p++;
        if (args.length < fn.min || args.length > fn.max) {
          throw new Fail(`"${t.v}" takes ${fn.min === fn.max ? fn.min : `${fn.min} to ${fn.max}`} value${fn.max === 1 ? '' : 's'}, not ${args.length}.`, t.at);
        }
        return node({ t: 'call', fn: t.v, args }, t.at);
      }
      if (Object.prototype.hasOwnProperty.call(EXPR_FUNCTIONS, t.v)) throw new Fail(`"${t.v}" is a function: write ${t.v}(...).`, t.at);
      if (!Object.prototype.hasOwnProperty.call(EXPR_CONSTANTS, t.v)) vars.add(t.v);
      return node({ t: 'var', name: t.v }, t.at);
    }
    if (t.k === 'end') throw new Fail('The formula stops before it is finished.', t.at);
    throw new Fail(`"${t.v}" is not expected here.`, t.at);
  };

  try {
    const expr = or(0);
    const rest = peek();
    if (rest.k !== 'end') {
      const what = rest.k === 'num' ? String(rest.v) : rest.v;
      return { ok: false, message: `"${what}" is not expected here. Is an operator missing before it?`, at: rest.at };
    }
    return { ok: true, expr, vars: [...vars] };
  } catch (e) {
    return e instanceof Fail ? { ok: false, message: e.message, at: e.at } : { ok: false, message: 'The formula could not be read.', at: 0 };
  }
}

/**
 * The value of a parsed formula. A comparison is 1 or 0. A name missing from `env` is NaN, and
 * division by zero and the like give NaN or an infinity: callers check Number.isFinite.
 */
export function evalExpr(e: Expr, env: Readonly<Record<string, number>>): number {
  switch (e.t) {
    case 'num':
      return e.v;
    case 'var': {
      if (Object.prototype.hasOwnProperty.call(EXPR_CONSTANTS, e.name)) return EXPR_CONSTANTS[e.name] as number;
      return Object.prototype.hasOwnProperty.call(env, e.name) ? (env[e.name] as number) : Number.NaN;
    }
    case 'un': {
      const a = evalExpr(e.a, env);
      return e.op === '-' ? -a : truth(a === 0);
    }
    case 'call': {
      const fn = EXPR_FUNCTIONS[e.fn];
      if (!fn) return Number.NaN;
      // `if` evaluates only the branch it takes, so if(x > 0, ln(x), 0) is finite everywhere.
      if (e.fn === 'if') return evalExpr(e.args[0] as Expr, env) !== 0 ? evalExpr(e.args[1] as Expr, env) : evalExpr(e.args[2] as Expr, env);
      return fn.f(...e.args.map((a) => evalExpr(a, env)));
    }
    case 'bin': {
      if (e.op === 'and') return truth(evalExpr(e.a, env) !== 0 && evalExpr(e.b, env) !== 0);
      if (e.op === 'or') return truth(evalExpr(e.a, env) !== 0 || evalExpr(e.b, env) !== 0);
      const a = evalExpr(e.a, env);
      const b = evalExpr(e.b, env);
      switch (e.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return a / b;
        case '^':
          return Math.pow(a, b);
        case '<':
          return truth(a < b);
        case '<=':
          return truth(a <= b);
        case '>':
          return truth(a > b);
        case '>=':
          return truth(a >= b);
        case '==':
          return truth(a === b);
        case '!=':
          return truth(a !== b);
      }
    }
  }
  return Number.NaN;
}

/** True when the formula's top level is a comparison or a logical join: what a goal needs. */
export function isCondition(e: Expr): boolean {
  if (e.t === 'un') return e.op === 'not';
  return e.t === 'bin' && ['<', '<=', '>', '>=', '==', '!=', 'and', 'or'].includes(e.op);
}
