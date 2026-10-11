// Item-writing rules for checkpoint questions and predict steps. These are the flaws a rule can
// find (see the pedagogy notes): more than one key, repeated or cross-referring options, a length
// giveaway, feedback that says nothing. Whether a distractor is plausible is not checkable, which
// is why every wrong option must name its misconception instead.
import { issue } from '../issues';
import { LIMITS as L } from '../limits';
import { plainText } from '../markup';
import type { PickGate } from '../clip';
import type { Predict, Question } from '../schema';
import { canonical } from '../text';
import type { Issue } from '../types';

interface Option {
  text: string;
  correct: boolean;
  feedback: string;
  misconception?: string | undefined;
}

/** Comparison form of a short piece of text: markup removed, canonical, without closing punctuation. */
function plain(text: string): string {
  return canonical(plainText(text))
    .replace(/[\s.!?;:,]+$/u, '')
    .trim();
}

/**
 * Words that only confirm or deny. Feedback made of nothing else tells the learner what the tick
 * or cross already did.
 */
const VERDICT_WORDS = new Set(
  (
    'a absolutely again agree answer almost an and are as bad best but choice close completely congrats congratulations correct correctly ' +
    'definitely done entirely exactly excellent false fine good got great here incorrect incorrectly indeed is it its job just keep keep ' +
    'luck mistake nearly nice no nope not of oh on one oops option perfect please precisely quite really response right sadly so sorry spot ' +
    'that thats the there this though to true try unfortunately very was way well work wrong yeah yes yep you youre your'
  ).split(' '),
);

function isVerdictOnly(feedback: string): boolean {
  const words = plain(feedback)
    .replace(/['"]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return words.length > 0 && words.every((w) => VERDICT_WORDS.has(w));
}

const POSITIONAL = /\b(all|none|both|neither|either|any|one|two|three|some|each) of the (above|below|preceding|following|previous)\b/;
// "None of the other options", "all of these answers are correct". The same words are also plain
// subject matter: a loop runs "none of the statements in its body", a command "ignores all of the
// options after --". So the phrase counts as a reference to the other options only where it reads
// as one: it is the whole option; or it ends the option and points ("these", "those", "other");
// or it opens the option and says "other".
const QUANTITY = '(all|none|both|neither|either|any|two|some|more than one)';
const PLACE = '( (above|below|listed|given|here|shown))?';
const VERDICT = '( (is|are|apply|applies|hold|holds|work|works)( (all |both )?(correct|true|right|wrong|false|incorrect|valid))?)?';
const TRUTH = ' (is|are) (all |both )?(correct|true|right|wrong|false|incorrect|valid)';
const OTHERS_WHOLE = new RegExp(`^${QUANTITY} of (the |these |those )?(other )?(options|answers|choices|statements|alternatives)${PLACE}${VERDICT}$`);
const OTHERS_POINTED = new RegExp(`\\b${QUANTITY} of (these |those |the other |other )(options|answers|choices)${PLACE}${VERDICT}$`);
/** "Statements" and "alternatives" are more often the subject's own, so later in a sentence they need a verdict on them too. */
const OTHERS_JUDGED = new RegExp(`\\b${QUANTITY} of (the |these |those )?(other )?(statements|alternatives)${PLACE}${TRUTH}$`);
const OTHERS_FIRST = new RegExp(`^${QUANTITY} of (the |these |those )?other (options|answers|choices)\\b`);
const WHOLE_OPTION = /^(all|none|both|neither|either) of (these|them|those)( (is|are) (correct|true|right|wrong|false|incorrect))?$/;
const BARE = /^(both|neither|all (three|four)|both (are|is) (correct|true|right)|all (are|is) (correct|true|right)|none (are|is) (correct|true|right))$/;
const LETTERS = /^(both |either |neither |only )?(options? |answers? |choices? )?\(?[a-d]\)?(, \(?[a-d]\)?)*,? (and|or|nor|&) \(?[a-d]\)?( only| (is|are) (both )?(correct|true|right))?$/;

function refersToOptions(text: string): boolean {
  const t = plain(text);
  return POSITIONAL.test(t) || OTHERS_WHOLE.test(t) || OTHERS_POINTED.test(t) || OTHERS_JUDGED.test(t) || OTHERS_FIRST.test(t) || WHOLE_OPTION.test(t) || BARE.test(t) || LETTERS.test(t);
}

const length = (text: string): number => Array.from(plainText(text)).length;

function optionIssues(options: readonly Option[], p: string, what: string, wantsMisconception: boolean): Issue[] {
  const out: Issue[] = [];
  const correct = options.flatMap((o, i) => (o.correct ? [i] : []));
  if (correct.length !== 1) {
    const fix =
      correct.length === 0
        ? 'Set "correct": true on the one option that is right.'
        : `Keep "correct": true on one option only (it is set on options ${correct.map((i) => i + 1).join(', ')}). If more than one is defensible, rewrite the question so that one is not.`;
    out.push(
      issue('OPTION_CORRECT_COUNT', `${p}.options`, `This ${what} has ${correct.length} correct options; it needs exactly one.`, {
        fix,
        got: String(correct.length),
        expected: '1',
      }),
    );
  }

  const firstText = new Map<string, number>();
  const firstFeedback = new Map<string, number>();
  options.forEach((option, i) => {
    const at = `${p}.options[${i}]`;
    const text = plain(option.text);
    const sameText = firstText.get(text);
    if (sameText === undefined) firstText.set(text, i);
    else out.push(
      issue('OPTION_DUPLICATE', `${at}.text`, `Options ${sameText + 1} and ${i + 1} say the same thing.`, {
        fix: `Replace option ${i + 1} with a different answer a learner could plausibly give, or remove it if at least the minimum number of options remain.`,
      }),
    );

    if (refersToOptions(option.text)) {
      out.push(
        issue('OPTION_ALL_NONE', `${at}.text`, `Option ${i + 1} refers to the other options instead of giving an answer.`, {
          fix: 'Replace it with an answer that stands on its own. The player shuffles options, and "all of the above" or "both A and B" rewards test-taking, not understanding. If the option is about the subject\'s own options or statements (the options of a command, the statements of a program), say which ones: "none of the statements in the loop body".',
        }),
      );
    }

    const feedback = plain(option.feedback);
    const sameFeedback = firstFeedback.get(feedback);
    if (sameFeedback !== undefined) {
      out.push(
        issue('FEEDBACK_GENERIC', `${at}.feedback`, `Options ${sameFeedback + 1} and ${i + 1} have the same feedback.`, {
          fix: `Write feedback for option ${i + 1} that says why that particular answer is ${option.correct ? 'right' : 'wrong'}.`,
        }),
      );
    } else {
      firstFeedback.set(feedback, i);
      if (isVerdictOnly(option.feedback)) {
        out.push(
          issue('FEEDBACK_GENERIC', `${at}.feedback`, `The feedback on option ${i + 1} only says whether the answer is right.`, {
            fix: `Say why option ${i + 1} is ${option.correct ? 'right' : 'wrong'}, in one sentence about the idea.`,
          }),
        );
      }
    }

    if (wantsMisconception && !option.correct && option.misconception === undefined) {
      out.push(
        issue('MISCONCEPTION_MISSING', at, `Option ${i + 1} is wrong but names no misconception.`, {
          fix: `Add "misconception" to option ${i + 1}: the mistaken belief that would lead a learner to choose it (${L.misconceptionChars.min} to ${L.misconceptionChars.max} characters; it is not shown to the learner). If you cannot name one, the option is filler: replace it.`,
        }),
      );
    }
  });

  if (correct.length === 1) {
    const key = options[correct[0] as number] as Option;
    const others = options.filter((o) => !o.correct).map((o) => length(o.text));
    const longest = others.length ? Math.max(...others) : 0;
    const mine = length(key.text);
    if (longest > 0 && mine > longest) {
      const ratio = mine / longest;
      const diff = mine - longest;
      const measured = `The correct option is ${mine} characters; the longest wrong option is ${longest}.`;
      const fix = `Shorten the correct option to about ${longest} characters, or give the wrong options the same length and level of detail.`;
      if (ratio >= L.correctLengthRatio.error && diff >= L.correctLengthRatio.minCharDiff) {
        out.push(
          issue('CORRECT_OPTION_LONGEST', `${p}.options[${correct[0]}].text`, `${measured} A learner can pick it by length alone.`, {
            severity: 'error',
            fix,
            got: String(mine),
            expected: `under ${Math.ceil(longest * L.correctLengthRatio.error)} characters`,
          }),
        );
      } else if (ratio >= L.correctLengthRatio.warn && diff >= L.correctLengthRatio.warnMinCharDiff) {
        // Below `warnMinCharDiff` characters a longer option is not a cue anyone could use: "20" is twice as long as "8".
        out.push(
          issue('CORRECT_OPTION_LONGEST', `${p}.options[${correct[0]}].text`, `${measured} Its length hints at the answer.`, {
            severity: 'warning',
            fix,
            got: String(mine),
            expected: `under ${Math.ceil(longest * L.correctLengthRatio.warn)} characters`,
          }),
        );
      }
    }
  }
  return out;
}

const CAPITALS = /\b(NOT|EXCEPT)\b/;
const WHICH_NOT = /\bwhich\b[^.?!]*\b(is|are|was|were|does|do|did|would|will|can|could|should|has|have)(n't| not)\b/;
const WHICH_FALSE = /\bwhich\b[^.?!]*\b(false|incorrect|untrue|wrong)\b/;
const ENDS_EXCEPT = /\bexcept$/;

function isNegativeStem(prompt: string): boolean {
  const raw = plainText(prompt);
  if (CAPITALS.test(raw)) return true;
  const t = plain(prompt);
  return WHICH_NOT.test(t) || WHICH_FALSE.test(t) || ENDS_EXCEPT.test(t);
}

function stemIssue(prompt: string, p: string): Issue[] {
  if (!isNegativeStem(prompt)) return [];
  return [
    issue('NEGATIVE_STEM', `${p}.prompt`, 'The prompt asks for the option that is not true, which tests careful reading more than the idea.', {
      fix: 'Ask it the positive way round: which option is true, what happens, what to do next.',
    }),
  ];
}

/** Rules for a checkpoint's question. `p` is its path ("question"). */
export function questionIssues(question: Question, p: string): Issue[] {
  const out: Issue[] = [];
  if (question.type === 'single') {
    out.push(...optionIssues(question.options, p, 'question', true));
    out.push(...stemIssue(question.prompt, p));
  }
  if (question.type === 'order') {
    const first = new Map<string, number>();
    question.items.forEach((item, i) => {
      const text = plain(item);
      const same = first.get(text);
      if (same === undefined) first.set(text, i);
      else out.push(
        issue('ORDER_DUPLICATE', `${p}.items[${i}]`, `Items ${same + 1} and ${i + 1} are the same, so there is more than one correct order.`, {
          fix: `Make item ${i + 1} a distinct step, or remove it if at least ${L.orderItems.min} items remain.`,
        }),
      );
    });
  }
  return out;
}

/** Rules for the predict question of a step. `p` is its path ("steps[2].predict"). */
export function predictIssues(predict: Predict, p: string): Issue[] {
  return [...optionIssues(predict.options, p, 'predict', false), ...stemIssue(predict.prompt, p)];
}

/**
 * Rules for a gate answered on the picture (`pick`). `p` is its path ("beats[2].gate"). Its two
 * replies are feedback like an option's: each says why, and they are not the same sentence. (Which
 * parts may be tapped is the stage's business: see ./stage.)
 */
export function pickGateIssues(gate: PickGate, p: string): Issue[] {
  const out: Issue[] = [];
  const replies = [
    { key: 'right', text: gate.right, says: 'why the part the learner tapped is the right one' },
    { key: 'wrong', text: gate.wrong, says: 'what to look at again, without naming the part' },
  ] as const;
  if (plain(gate.right) === plain(gate.wrong)) {
    out.push(
      issue('FEEDBACK_GENERIC', `${p}.wrong`, 'This gate says the same thing after a right tap and after a wrong one.', {
        fix: 'Write "right" to say why that part is the answer, and "wrong" as a nudge to try again: what to notice on the picture, without giving the part away.',
      }),
    );
  } else {
    for (const reply of replies) {
      if (!isVerdictOnly(reply.text)) continue;
      out.push(
        issue('FEEDBACK_GENERIC', `${p}.${reply.key}`, `The "${reply.key}" of this gate only says whether the tap was right.`, {
          fix: `Say ${reply.says}, in one sentence about the idea. The learner already sees whether the tap counted.`,
        }),
      );
    }
  }
  out.push(...stemIssue(gate.prompt, p));
  return out;
}
