import { describe, expect, it } from 'vitest';
import { EXPR_LIMITS, evalExpr, isCondition, parseExpr } from '../../src/core/expr';

const value = (src: string, env: Record<string, number> = {}): number => {
  const r = parseExpr(src);
  if (!r.ok) throw new Error(`${src}: ${r.message}`);
  return evalExpr(r.expr, env);
};

describe('formulas evaluate as arithmetic does', () => {
  it.each([
    ['1 + 2 * 3', {}, 7],
    ['(1 + 2) * 3', {}, 9],
    ['2 ^ 3 ^ 2', {}, 512],
    ['-x ^ 2', { x: 3 }, -9],
    ['2 ^ -1', {}, 0.5],
    ['10 / 4', {}, 2.5],
    ['.5 + 1e2', {}, 100.5],
    ['total * rate', { total: 1000, rate: 0.01 }, 10],
    ['sick * sens / (sick * sens + (total - sick) * fp)', { total: 1000, sick: 10, sens: 0.9, fp: 0.09 }, 9 / (9 + 89.1)],
    ['max(1, 2, 3) - min(4, 5)', {}, -1],
    ['clamp(x, 0, 10)', { x: 12 }, 10],
    ['round(log2(n)) + 1', { n: 1000 }, 11],
    ['if(x > 0, ln(x), 0)', { x: 0 }, 0],
    ['2 * pi', {}, 2 * Math.PI],
    ['a >= 3 and not (b == 0)', { a: 3, b: 1 }, 1],
    ['a < 1 or b < 1', { a: 2, b: 2 }, 0],
  ] as const)('%s', (src, env, expected) => expect(value(src, env)).toBeCloseTo(expected, 12));

  it('lists the names a formula needs, without constants or functions', () => {
    const r = parseExpr('a * x ^ 2 + min(b, pi) + a');
    expect(r.ok && r.vars.sort()).toEqual(['a', 'b', 'x']);
  });
  it('gives NaN for a name it was not given, and never throws', () => {
    expect(value('a + 1')).toBeNaN();
    expect(value('1 / 0')).toBe(Infinity);
  });
  it('knows a condition from a quantity', () => {
    const cond = parseExpr('ppv >= 0.5');
    const qty = parseExpr('ppv * 100');
    expect(cond.ok && isCondition(cond.expr)).toBe(true);
    expect(qty.ok && isCondition(qty.expr)).toBe(false);
  });
});

describe('what is not a formula is refused with a place and a reason', () => {
  it.each([
    ['', 'empty'],
    ['1 +', 'stops before'],
    ['(1 + 2', 'not closed'],
    ['2 3', 'not expected'],
    ['foo(1)', 'no function'],
    ['sqrt', 'is a function'],
    ['min(1)', 'takes 2 to 4'],
    ['a < b < c', 'Join two comparisons'],
    ['x; alert(1)', 'not part of a formula'],
    ['a.b', 'not part of a formula'],
    ['"1"', 'not part of a formula'],
    ['constructor(1)', 'no function'],
    ['__proto__', ''],
    ['1e999', 'too large'],
  ] as const)('%s', (src, why) => {
    const r = parseExpr(src);
    if (src === '__proto__') return expect(r.ok && r.vars).toEqual(['__proto__']); // an ordinary unknown name: the validator refuses it as not a control
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(why);
  });
  it('does not read values off the prototype chain', () => {
    expect(value('toString + 1')).toBeNaN();
    expect(value('constructor')).toBeNaN();
  });
  it('holds its limits on length, size and depth', () => {
    expect(parseExpr('1+'.repeat(80) + '1').ok).toBe(false);
    expect(parseExpr('('.repeat(40) + '1' + ')'.repeat(40)).ok).toBe(false);
    expect(parseExpr('x'.repeat(EXPR_LIMITS.chars + 1)).ok).toBe(false);
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) parseExpr('-'.repeat(60) + '1');
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
