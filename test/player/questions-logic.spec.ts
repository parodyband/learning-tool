// The number reader and grader on their own, with no page: what a learner may type, how it is
// read, and where the tolerance ends. (Run by Playwright only because the player's code lives in
// the browser bundle; nothing here opens a browser.)
import { closeEnough, decimalMarkOf, gradeNumber, needsRetyping, readNumber } from '../../src/player/questions';
import { expect, test } from './shell-kit';

test.describe('reading what was typed', () => {
  const cases: [string, number[] | null, string?][] = [
    ['20', [20]],
    [' 20 ', [20]],
    ['+20', [20]],
    ['-3', [-3]],
    ['−3', [-3]],
    ['– 3', [-3]],
    ['0.5', [0.5]],
    ['0,5', [0.5]],
    ['.5', [0.5]],
    [',5', [0.5]],
    ['5.', [5]],
    ['5,', [5]],
    ['3.14159', [3.14159]],
    ['3,14159', [3.14159]],
    ['1e6', [1e6]],
    ['1E6', [1e6]],
    ['2.5e-3', [0.0025]],
    ['2,5e-3', [0.0025]],
    ['1/2', [0.5]],
    ['-3 / 4', [-0.75]],
    ['1/0', null],
    // Thousands, in each convention.
    ['1,000,000', [1000000]],
    ['1.000.000', [1000000]],
    ['1 000 000', [1000000]],
    ['1 000 000', [1000000]],
    ['1 000 000', [1000000]],
    ["1'000'000", [1000000]],
    ['1’000’000', [1000000]],
    ['1_000_000', [1000000]],
    ['1,234.5', [1234.5]],
    ['1.234,5', [1234.5]],
    ['1,234,567.89', [1234567.89]],
    ['1.234.567,89', [1234567.89]],
    // One separator and exactly three digits after it: a thousand to some, one to others. Both are
    // kept, and the first is the reading of a language that writes a decimal point (the default
    // here): a dot starts the fraction, a comma groups thousands.
    ['1.000', [1, 1000]],
    ['999.999', [999.999, 999999]],
    ['12,345', [12345, 12.345]],
    ['1,250', [1250, 1.25]],
    // A grouping mark and three zeros: nobody writes "1,000" to mean one.
    ['1,000', [1000]],
    ['20,000', [20000]],
    ['-2,000', [-2000]],
    // Not ambiguous: the count of digits, or a leading zero, settles it.
    ['1,00', [1]],
    ['1,0000', [1]],
    ['0,500', [0.5]],
    ['1234,567', [1234.567]],
    ['1,000e3', [1000]],
    // Other digits.
    ['２０', [20]],
    ['٢٠', [20]],
    ['۲۰٫۵', [20.5]],
    ['२०', [20]],
    ['๒๐', [20]],
    // The unit may be typed along, before or after, in any case.
    ['20 comparisons', [20], 'comparisons'],
    ['20COMPARISONS', [20], 'comparisons'],
    ['50%', [50], '%'],
    ['$5', [5], '$'],
    ['5 ms', [5], 'ms'],
    ['1,5 ms', [1.5], 'ms'],
    // Not numbers.
    ['', null],
    ['   ', null],
    ['twenty', null],
    ['20 steps', null, 'comparisons'],
    ['50%', null],
    ['1,00,000', null],
    ['1.2.3', null],
    ['1,2,3', null],
    ['1.234.5', null],
    ['1,2.3,4', null],
    ['--5', null],
    ['5-', null],
    ['e5', null],
    ['1e', null],
    ['Infinity', null],
    ['NaN', null],
    ['0x10', null],
    ['1e999', null],
    ['<b>5</b>', null],
  ];
  for (const [typed, expected, unit] of cases) {
    test(`${JSON.stringify(typed)}${unit ? ` with unit ${JSON.stringify(unit)}` : ''} reads as ${JSON.stringify(expected)}`, () => {
      expect(readNumber(typed, unit)).toEqual(expected);
    });
  }

  // Review finding P9. The same characters in a lesson whose language writes a decimal comma.
  const comma: [string, number[] | null][] = [
    ['1,000', [1, 1000]],
    ['999,999', [999.999, 999999]],
    ['12.345', [12345, 12.345]],
    ['1.250', [1250, 1.25]],
    ['1.000', [1000]],
    ['20.000', [20000]],
    // Nothing else depends on the language.
    ['0,5', [0.5]],
    ['0.5', [0.5]],
    ['1.234,5', [1234.5]],
    ['1,234.5', [1234.5]],
    ['1.000.000', [1000000]],
    ['1,00', [1]],
  ];
  for (const [typed, expected] of comma) {
    test(`${JSON.stringify(typed)} in a decimal-comma language reads as ${JSON.stringify(expected)}`, () => {
      expect(readNumber(typed, undefined, ',')).toEqual(expected);
    });
  }

  test('the decimal mark is the lesson language’s own', () => {
    for (const lang of ['en', 'en-GB', 'ja', 'zh-Hans', 'th', 'ko', 'he', 'es-MX']) expect(decimalMarkOf(lang), lang).toBe('.');
    for (const lang of ['de', 'fr', 'es', 'it', 'pt-BR', 'nl', 'ru', 'pl', 'sv', 'tr', 'id']) expect(decimalMarkOf(lang), lang).toBe(',');
    // Not a language tag at all: the common case, not an exception.
    for (const lang of ['', '"><script>', 'x'.repeat(40)]) expect(decimalMarkOf(lang), lang).toBe('.');
  });

  test('a long run of digits and separators is read or refused quickly', () => {
    const started = Date.now();
    expect(readNumber(`${'1,'.repeat(50_000)}1`)).toBeNull();
    expect(readNumber('9'.repeat(400))).toBeNull();
    expect(readNumber(`0.${'3'.repeat(50_000)}`)).toEqual([Number(`0.${'3'.repeat(30)}`)]);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

test.describe('grading', () => {
  test('with no tolerance only the answer itself is right', () => {
    expect(gradeNumber([20], 20, 0)).toEqual({ right: true, exact: true, direction: null });
    expect(gradeNumber([20.0000001], 20, 0)).toEqual({ right: false, exact: false, direction: 'high' });
    expect(gradeNumber([19], 20, 0)).toEqual({ right: false, exact: false, direction: 'low' });
    expect(gradeNumber([0], 0, 0).right).toBe(true);
    expect(gradeNumber([1e-12], 0, 0).right).toBe(false);
    expect(gradeNumber([-0], 0, 0).right).toBe(true);
  });

  test('the tolerance is absolute and includes its ends, whatever binary arithmetic makes of them', () => {
    // 1.3 - 1.25 is 0.05000000000000004 in floating point. It is within 0.05 all the same.
    expect(1.3 - 1.25).toBeGreaterThan(0.05);
    expect(gradeNumber([1.3], 1.25, 0.05)).toEqual({ right: true, exact: false, direction: null });
    expect(gradeNumber([1.2], 1.25, 0.05).right).toBe(true);
    expect(gradeNumber([1.31], 1.25, 0.05)).toEqual({ right: false, exact: false, direction: 'high' });
    expect(gradeNumber([1.19], 1.25, 0.05)).toEqual({ right: false, exact: false, direction: 'low' });
    expect(gradeNumber([0.1 + 0.2], 0.3, 0).right).toBe(true);
    expect(gradeNumber([1e12 + 1], 1e12, 0).right).toBe(false);
    expect(gradeNumber([3], 2, 1).right).toBe(true);
    expect(gradeNumber([3.0001], 2, 1).right).toBe(false);
    expect(gradeNumber([2], 2, 1).exact).toBe(true);
  });

  test('a tolerance that is not a positive number counts as none', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
      expect(closeEnough(20, 20, bad)).toBe(true);
      expect(closeEnough(21, 20, bad)).toBe(false);
    }
  });

  // Review finding P9. Either reading used to make an answer right, so "20,000" was Correct for
  // 20 and the first attempt was recorded as right.
  test('a thousand times the answer is wrong, in the reading the lesson’s language gives it', () => {
    for (const [typed, answer] of [['20,000', 20], ['2,000', 2], ['1,000', 1]] as const) {
      const values = readNumber(typed) as number[];
      expect(gradeNumber(values, answer, 0), typed).toEqual({ right: false, exact: false, direction: 'high' });
      // One reading only, so there is nothing to ask about: it is simply wrong, and the attempt counts.
      expect(needsRetyping(values, answer, 0), typed).toBe(false);
    }
    // In English "2.000" is two, written with three decimal places.
    expect(gradeNumber(readNumber('2.000') as number[], 2, 0).right).toBe(true);
    expect(gradeNumber(readNumber('20,000') as number[], 20000, 0).right).toBe(true);
    // And the other way round where a comma starts the fraction.
    expect(gradeNumber(readNumber('20.000', undefined, ',') as number[], 20, 0)).toEqual({ right: false, exact: false, direction: 'high' });
    expect(gradeNumber(readNumber('2,000', undefined, ',') as number[], 2, 0).right).toBe(true);
    expect(gradeNumber(readNumber('20.000', undefined, ',') as number[], 20000, 0).right).toBe(true);
  });

  test('an answer with two readings is graded by the first, and says which way it is wrong only when both agree', () => {
    const both = readNumber('1,250') as number[];
    expect(both).toEqual([1250, 1.25]);
    expect(gradeNumber(both, 1250, 0).right).toBe(true);
    expect(gradeNumber(both, 1.25, 0).right).toBe(false);
    expect(gradeNumber(both, 20, 0)).toEqual({ right: false, exact: false, direction: null });
    expect(gradeNumber(both, 5000, 0).direction).toBe('low');
    expect(gradeNumber(both, 0.5, 0).direction).toBe('high');
    expect(gradeNumber([], 5, 0)).toEqual({ right: false, exact: false, direction: null });
  });

  test('an answer that is right only in its second reading is asked for again, not graded', () => {
    // Someone who writes a decimal comma, answering 1.25 in an English lesson: not marked wrong for it.
    expect(needsRetyping(readNumber('1,250') as number[], 1.25, 0)).toBe(true);
    expect(needsRetyping(readNumber('1,250') as number[], 1.2, 0.05)).toBe(true);
    // Right as it stands, wrong either way, or with one reading: nothing to ask.
    expect(needsRetyping(readNumber('1,250') as number[], 1250, 0)).toBe(false);
    expect(needsRetyping(readNumber('1,250') as number[], 7, 0)).toBe(false);
    expect(needsRetyping(readNumber('1.25') as number[], 1.25, 0)).toBe(false);
    expect(needsRetyping(readNumber('1250') as number[], 1.25, 0)).toBe(false);
    expect(needsRetyping([], 1.25, 0)).toBe(false);
    // The same in a decimal-comma lesson for someone who writes a decimal point.
    expect(needsRetyping(readNumber('1.250', undefined, ',') as number[], 1.25, 0)).toBe(true);
    expect(needsRetyping(readNumber('1,250', undefined, ',') as number[], 1.25, 0)).toBe(false);
  });
});
