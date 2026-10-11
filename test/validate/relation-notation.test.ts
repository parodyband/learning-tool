// Review finding R4. Word overlap is measured on words of four letters or more, so a maths claim
// that restates its excerpt's own equation had nothing to share and was refused, and the fix text
// then pointed at another excerpt. A formula the excerpt contains now counts as shared, and so does
// a number of two or more digits. Both directions: honest notation passes, and notation the source
// does not have, single letters and single digits open nothing.
import { describe, expect, it } from 'vitest';
import type { Draft } from '../../src/core/types';
import { checkScene } from '../../src/core/validate';
import { applyPlan, codes, errorCodes, exampleDraft, exampleScene, newDraft, saveEvidence, warningCodes } from './helpers';

const WORKED = 'For example, x^2 − 5x + 6 = 0 has a = 1, b = −5 and c = 6. The discriminant is 25 − 24 = 1, so x = (5 ± 1)/2, giving x = 3 or x = 2.';
const FORMULA = 'The quadratic formula gives the solutions of any quadratic equation in terms of its three coefficients, using the discriminant under the square root.';

function maths(): Draft {
  const draft = newDraft({ topic: 'Solving quadratic equations', language: 'en', depth: 'quick', learner: { level: 'some', knows: 'Basic algebra.', goal: 'Solve a quadratic.' } });
  saveEvidence(draft, { url: 'https://maths.example.org/quadratics/worked', title: 'A worked quadratic (synthetic)', via: 'page', excerpt: WORKED });
  saveEvidence(draft, { url: 'https://maths.example.org/quadratics/formula', title: 'The quadratic formula (synthetic)', via: 'page', excerpt: FORMULA });
  applyPlan(draft, { title: 'Solving quadratic equations', objectives: [{ id: 'o1', text: 'Solve a quadratic with the formula' }], outline: [{ id: 's1', kind: 'narration', purpose: 'A worked case' }, { id: 's2', kind: 'narration', purpose: 'The formula' }, { id: 's3', kind: 'checkpoint', purpose: 'Check', question: 'single', objective: 'o1' }, { id: 's4', kind: 'recap', purpose: 'Recap' }] });
  return draft;
}
const claim = (text: string, cites = ['e1']) => checkScene({ id: 's1', kind: 'narration', title: 'A worked case', blocks: [{ type: 'claim', text, cites }] }, maths());

describe('a claim that restates the source\'s own notation', () => {
  it.each([
    ['the equation and its coefficients, in math spans', 'Take $x^2 - 5x + 6 = 0$, where $a = 1$, $b = -5$ and $c = 6$.'],
    ['the solutions, with a fraction', 'The formula gives $x = \\frac{5 \\pm 1}{2}$, that is $x = 3$ or $x = 2$.'],
    ['two words and the solutions', 'Hence $x = 3$ or $x = 2$.'],
    ['no word of four letters at all', 'So $x = 3$ or $x = 2$.'],
    ['in code spans', 'Here `x = 3` or `x = 2`, since `25 - 24 = 1`.'],
    ['spaced differently from the source', 'Hence $x=3$ or $x  =  2$.'],
  ])('is accepted with no warning: %s', (_what, text) => {
    expect(codes(claim(text))).toEqual([]);
  });

  it('"So" and "Hence" in front of the same statement now get the same answer', () => {
    // Before: the first passed with a warning (no word to compare) and the second was refused.
    expect(codes(claim('So $x = 3$ or $x = 2$.'))).toEqual(codes(claim('Hence $x = 3$ or $x = 2$.')));
  });

  it('a wordier claim about one part of a formula-heavy excerpt is not called a copy of it', () => {
    // The excerpt has three content tokens; the claim uses all three and covers half the excerpt.
    expect(codes(claim('For this example the discriminant is 1, giving $x = 3$ or $x = 2$.'))).toEqual([]);
  });
});

describe('what does not count as shared', () => {
  it.each([
    ['a claim on something else, in words', 'Cats are mammals.'],
    ['notation the excerpt does not have', 'Hence $x = 7$ whenever $y = 9$.'],
    ['the same letters with another value', 'Hence $x = 30$ holds here.'],
    ['a single letter and a single digit in spans', 'Hence $x$ and $3$ matter greatly.'],
    ['a short span that is a word', 'Hence `the` matter rests there.'],
  ])('is still refused: %s', (_what, text) => {
    const check = claim(text);
    expect(errorCodes(check)).toEqual(['CLAIM_UNRELATED']);
    expect(check.errors[0]!.path).toBe('blocks[0]');
  });

  it('notation never turns a claim that word overlap accepts into a weaker one', () => {
    const plain = claim('The discriminant decides how many solutions there are.');
    const withFormula = claim('The discriminant $b^2 - 4ac$ decides how many solutions there are.');
    expect(codes(plain)).toEqual([]);
    expect(codes(withFormula)).toEqual([]);
  });

  it('a paraphrase with a synonym for every term is still caught: this is a tripwire on wording, by design', () => {
    const draft = maths();
    saveEvidence(draft, { url: 'https://biology.example.org/dna', title: 'DNA (synthetic)', via: 'page', excerpt: 'Deoxyribonucleic acid carries hereditary instructions in the sequence of its nucleotides: adenine, thymine, guanine and cytosine.' });
    const check = checkScene({ id: 's1', kind: 'narration', title: 'Probe', blocks: [{ type: 'claim', text: 'DNA stores genetic information in the order of its four bases.', cites: ['e3'] }] }, draft);
    expect(errorCodes(check)).toEqual(['CLAIM_UNRELATED']);
  });
});

describe('numbers of two or more digits', () => {
  it('a claim that shares only numbers with its excerpt is accepted with a weak-match warning, not refused', () => {
    const check = claim('Hence 25 less 24 leaves only that.');
    expect(check.errors).toEqual([]);
    expect(warningCodes(check)).toEqual(['CLAIM_WEAK_MATCH']);
    expect(check.warnings[0]!.message).toBe('This claim shares numbers with the excerpt it cites (e1) but no content word.');
    // With no word of four letters it was a warning before, and still is.
    expect(warningCodes(claim('So 25 - 24 = 1.'))).toEqual(['CLAIM_WEAK_MATCH']);
  });

  it('a number the excerpt does not have is refused by the number rule, as always', () => {
    const check = claim('Hence 26 less 24 leaves only that.');
    expect(errorCodes(check)).toContain('NUMBER_NOT_IN_SOURCE');
  });

  it('a single digit shared with the excerpt is no relation', () => {
    expect(errorCodes(claim('Cats have 6 lives in some stories, others say 3.'))).toEqual(['CLAIM_UNRELATED']);
  });
});

describe('what the rejection tells the agent', () => {
  it('saving the supporting passage comes first, and no other excerpt is offered that lacks the claim\'s formula', () => {
    // e2 shares "formula" and "gives" with this claim but states no solutions.
    const check = claim('The formula gives $x = 8$ and $x = 9$ for this equation.', ['e1']);
    expect(errorCodes(check)).toEqual(['CLAIM_UNRELATED']);
    const fix = check.errors[0]!.fix;
    expect(fix).toMatch(/^If e1 does state this, write the formula the way the excerpt writes it, or quote the passage\. Otherwise save the passage that supports the claim and cite it, or delete the claim\./);
    expect(fix).toContain('No other stored excerpt shares its terms.');
    expect(fix).not.toContain('cite e2');
  });

  it('another stored excerpt is named only as a question, after the honest way out', () => {
    const check = checkScene((() => {
      const s = exampleScene('s1');
      s.blocks[1] = { type: 'claim', text: 'Linear search checks every element in turn and works on unsorted data.', cites: ['e4'] };
      return s;
    })(), exampleDraft());
    expect(errorCodes(check)).toEqual(['CLAIM_UNRELATED']);
    const fix = check.errors[0]!.fix;
    expect(fix.indexOf('Save the passage that supports the claim')).toBe(0);
    expect(fix).toContain('cite e5 only if that passage is what supports it');
    expect(fix.indexOf('cite e5')).toBeGreaterThan(fix.indexOf('delete the claim'));
  });

  it('an excerpt that has the claim\'s words but not its number is not offered', () => {
    const draft = exampleDraft();
    // e5 (linear search) shares the words; the claim's number 1,000,000 is only in e2.
    const s = exampleScene('s1');
    s.blocks[1] = { type: 'claim', text: 'Linear search checks every element in turn, 1,000,000 of them on unsorted data.', cites: ['e4'] };
    const check = checkScene(s, draft);
    expect(errorCodes(check)).toContain('CLAIM_UNRELATED');
    expect(check.errors.find((e) => e.code === 'CLAIM_UNRELATED')!.fix).not.toContain('cite e5');
  });
});

describe('the copy rule on short excerpts is as strict as it was', () => {
  const SHORT = 'Linear search checks every element in turn.';
  const shortDraft = (): Draft => {
    const draft = exampleDraft();
    saveEvidence(draft, { url: 'https://example.com/notes/linear-search-short', title: 'Linear search, in a line (synthetic test source)', via: 'page', excerpt: SHORT });
    return draft;
  };
  const on = (text: string) => {
    const s = exampleScene('s1');
    s.blocks[1] = { type: 'claim', text, cites: ['e6'] };
    return checkScene(s, shortDraft());
  };

  it('the excerpt itself, and the excerpt with its words moved about, are still copies', () => {
    expect(errorCodes(on(SHORT))).toEqual(['CLAIM_COPIES_SOURCE']);
    expect(errorCodes(on('In turn, linear search checks every element.'))).toEqual(['CLAIM_COPIES_SOURCE']);
    expect(errorCodes(on('In its turn, a linear search checks every element.'))).toEqual(['CLAIM_COPIES_SOURCE']);
  });

  it('a claim in the agent\'s own sentence on the same short excerpt is not', () => {
    expect(codes(on('A linear search looks at the elements one after another until it finds the target.'))).toEqual([]);
  });

  it('a long excerpt copied word for word is a copy, as before', () => {
    const s = exampleScene('s1');
    s.blocks[1].text = 'Binary search finds a target value in a sorted array by repeatedly comparing the target with the middle element and discarding the half that cannot contain it.';
    expect(errorCodes(checkScene(s, exampleDraft()))).toEqual(['CLAIM_COPIES_SOURCE']);
  });
});
