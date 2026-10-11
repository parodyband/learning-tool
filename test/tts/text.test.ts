// What is sent to the speech model: lesson text can never act as an audio tag or as SSML.
import { describe, expect, it } from 'vitest';
import { countCharacters, prepareText } from '../../src/tts/text';

describe('prepareText', () => {
  it.each([
    ['square brackets (audio tags on v3 and v4)', 'Then it [laughs] halves the list.', 'Then it laughs halves the list.'],
    ['angle brackets (SSML on v2)', 'Wait <break time="3s"/> for it.', 'Wait break time="3s"/ for it.'],
    ['an index expression', 'Read a[0] first.', 'Read a 0 first.'],
    ['a comparison', 'Stop when low > high.', 'Stop when low high.'],
    ['fullwidth brackets', 'A ［whisper］ and ＜break＞ here.', 'A whisper and break here.'],
    ['small-form angle brackets', 'x ﹤ y ﹥ z.', 'x y z.'],
    ['nested and unbalanced brackets', '[[a] <b <c>> ]d[', 'a b c d.'],
  ])('removes %s', (_name, input, expected) => {
    const out = prepareText(input);
    expect(out).toBe(expected);
    expect(out).not.toMatch(/[[\]<>]/);
  });

  it('leaves no bracket of any width for any input made of brackets and letters', () => {
    const alphabet = ['[', ']', '<', '>', '［', '］', '＜', '＞', '﹤', '﹥', 'a', ' ', '/'];
    let seed = 7;
    const next = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let round = 0; round < 300; round += 1) {
      let input = '';
      for (let i = 0; i < 24; i += 1) input += alphabet[next() % alphabet.length];
      expect(prepareText(input).normalize('NFKC')).not.toMatch(/[[\]<>]/);
    }
  });

  it.each([
    ['collapses whitespace and line breaks', '  one\n\n two\tthree  ', 'one two three.'],
    ['drops control characters', 'one\u0000two\u0007 three\u009f.', 'one two three .'],
    ['drops zero-width and direction controls', 'ze\u{200B}ro \u{202E}width\u{202C} \u{FEFF}here\u{2060}.', 'ze ro width here .'],
    ['drops a lone surrogate', 'bro\ud800ken text', 'bro ken text.'],
    ['normalises to NFC', 'café', 'café.'],
  ])('%s', (_name, input, expected) => {
    expect(prepareText(input)).toBe(expected);
  });

  it.each([
    ['a sentence that already ends', 'It halves the list.', 'It halves the list.'],
    ['a question', 'Why is it fast?', 'Why is it fast?'],
    ['a closing parenthesis', 'It is fast (very).', 'It is fast (very).'],
    ['a closing quotation mark', 'She said "stop"', 'She said "stop"'],
    ['a Japanese full stop', '二分探索です。', '二分探索です。'],
  ])('adds nothing after %s', (_name, input, expected) => {
    expect(prepareText(input)).toBe(expected);
  });

  it.each([
    ['a letter', 'A title with no full stop', 'A title with no full stop.'],
    ['a digit', 'At most 20', 'At most 20.'],
    ['a CJK character', '二分探索', '二分探索.'],
  ])('adds a full stop after %s', (_name, input, expected) => {
    expect(prepareText(input)).toBe(expected);
  });

  it.each([['empty', ''], ['spaces', '   \n '], ['only brackets', '[]<>'], ['only punctuation', '... — !'], ['only invisible characters', '\u{200B}\u{FEFF}\u0000']])(
    'returns nothing to say for text that is %s',
    (_name, input) => {
      expect(prepareText(input)).toBe('');
    },
  );

  it('is idempotent', () => {
    for (const input of ['Then it [laughs] halves', 'a[0] < b[1]', 'Why?', 'café', '  spaced   out  ', 'ends with digit 7']) {
      const once = prepareText(input);
      expect(prepareText(once)).toBe(once);
    }
  });

  it('keeps ordinary prose exactly, apart from the final stop', () => {
    const prose = "Binary search compares the target with the middle element; it's 50% faster & simpler: n = 8 → 3 steps.";
    expect(prepareText(prose)).toBe(prose);
  });
});

describe('countCharacters', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(countCharacters('abc')).toBe(3);
    expect(countCharacters('é')).toBe(1);
    expect(countCharacters('a😀b')).toBe(3);
    expect(countCharacters('')).toBe(0);
  });
});
