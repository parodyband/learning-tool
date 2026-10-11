// Review finding R8. OPTION_ALL_NONE is for an option that points at the other options ("all of
// the above", "none of the other options"). It also refused ordinary answers in which "statements",
// "options" or "alternatives" are the subject matter: the statements of a program, the options of
// a command. Both directions are tested.
import { describe, expect, it } from 'vitest';
import { checkScene } from '../../src/core/validate';
import { errorCodes, exampleDraft, exampleScene } from './helpers';

function option(text: string, correct = false): ReturnType<typeof checkScene> {
  const s = exampleScene('s4');
  s.question.options[correct ? 0 : 2].text = text;
  return checkScene(s, exampleDraft());
}

describe('an answer about the subject\'s own options and statements stands on its own', () => {
  it.each([
    'None of the statements in the body run',
    'None of the statements in the block run',
    'It ignores all of the options after the double dash',
    'Both of the statements are executed in order',
    'Any of the alternatives listed in the grammar rule can match',
    'It parses all of the options before the first positional argument',
    'It runs both of these statements, then stops',
    'The loop skips some of the statements when the flag is set',
    'getopt returns -1 once it has read all of the options',
    'Either of the alternatives may be tried first',
    'It evaluates both of the statements, left to right',
  ])('accepted: "%s"', (text) => {
    expect(option(text).errors.filter((e) => e.code === 'OPTION_ALL_NONE')).toEqual([]);
    expect(option(text, true).errors.filter((e) => e.code === 'OPTION_ALL_NONE')).toEqual([]);
  });
});

describe('an option that points at the other options is still refused', () => {
  it.each([
    'None of the other options',
    'All of the other answers are correct',
    'Both of these statements are true',
    'Actually, none of these options',
    'It is true that all of the other options are correct',
    'More than one of the answers is right',
    'None of the other answers apply',
    'All of the options listed',
    'Some of the other choices, but not this one',
    'All of these answers',
    'Any of the options above',
    'Neither of the other choices works',
    'In fact both of the statements are correct',
    'All of the above',
    'None of the above.',
    'Both A and B',
  ])('OPTION_ALL_NONE: "%s"', (text) => {
    const check = option(text);
    expect(errorCodes(check)).toContain('OPTION_ALL_NONE');
    const e = check.errors.find((x) => x.code === 'OPTION_ALL_NONE')!;
    expect(e.path).toBe('question.options[2].text');
    // The fix tells an author whose option is about the subject how to say so.
    expect(e.fix).toContain('say which ones');
  });
});
