// Review finding V5. A recap takeaway, a checkpoint explanation and a reflect model answer are shown
// with the same source chip as a claim, so each is compared with the excerpts it cites. Both
// directions: a statement that has nothing to do with its citation is caught, and the honest ones
// (which restate a source, or reason about a new case) pass as they did.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_QUESTIONS } from '../../src/core/examples';
import { LIMITS as L } from '../../src/core/limits';
import type { Draft } from '../../src/core/types';
import { checkLesson, checkScene } from '../../src/core/validate';
import { APOLLO_LESSON } from './fixtures/apollo';
import { HTTP_LESSON } from './fixtures/http';
import { assemble, codes, errorCodes, exampleDraft, exampleScene, expectNoExcerptText, submit, warningCodes } from './helpers';

const HONEY = 'Honey never spoils, and archaeologists have eaten jars found in Egyptian tombs.';

/** The example draft with s6 planned as a reflect question, as the reviewer's reproduction has it. */
function reflectDraft(): Draft {
  const draft = exampleDraft();
  draft.outline[5] = { ...draft.outline[5]!, question: 'reflect' };
  return draft;
}
const reflectScene = (text: string, cites = ['e2']) => {
  const s = exampleScene('s6');
  s.question = { type: 'reflect', prompt: 'Who first described binary search, and when?', modelAnswer: { text, cites }, lookFor: ['You name who described it first', 'You say when a correct version appeared'] };
  return s;
};

describe('a statement that has nothing to do with what it cites', () => {
  it('a takeaway is refused like a claim', () => {
    const s = exampleScene('s9');
    s.takeaways[0].text = HONEY;
    const draft = exampleDraft();
    const check = checkScene(s, draft);
    expect(check.ok).toBe(false);
    expect(check.errors.map((e) => [e.code, e.path])).toEqual([['CLAIM_UNRELATED', 'takeaways[0]']]);
    expect(check.errors[0]!.message).toBe('This takeaway shares no content word with the excerpt it cites (e1).');
    expect(check.errors[0]!.fix).toContain('Save the passage that supports the takeaway and cite it, or delete the takeaway.');
    expectNoExcerptText(check.errors, draft);
  });

  it('an explanation is accepted with a warning, and the lesson records it as a weak match the learner is shown', () => {
    const s = exampleScene('s4');
    s.question.explanation.text = 'A 2006 study found that 90% of professional programmers get this wrong, and that honey never spoils.';
    const draft = exampleDraft();
    const check = submit(draft, s);
    expect(check.errors).toEqual([]);
    expect(check.warnings.map((w) => [w.code, w.path])).toEqual([['CLAIM_WEAK_MATCH', 'question.explanation']]);
    expect(check.warnings[0]!.message).toBe('This explanation shares no content word with the excerpt it cites (e1).');
    expect(check.warnings[0]!.fix).toContain('The learner is shown a note on an explanation with this warning.');

    const report = checkLesson(draft);
    expect(report.ok).toBe(true);
    // The path is the one the page looks a weak match up by, beside the explanation's source chip.
    expect(report.weakClaims).toEqual(['s4/question.explanation']);
    expect(report.stats.weakClaims).toBe(1);
  });

  it('a model answer that shares one word in fifteen with its excerpt is warned about', () => {
    const draft = reflectDraft();
    const check = submit(draft, reflectScene('John Mauchly first described binary search in 1946 in the Moore School Lectures, and the first version free of bugs was not published until 1962. Honey also never spoils.'));
    expect(check.errors).toEqual([]);
    expect(check.warnings.map((w) => [w.code, w.path])).toEqual([['CLAIM_WEAK_MATCH', 'question.modelAnswer']]);
    expect(checkLesson(draft).weakClaims).toEqual(['s6/question.modelAnswer']);
  });

  it('a checkpoint on another subject altogether is flagged, where it passed in silence', () => {
    const s = exampleScene('s4');
    s.question.prompt = 'Which city is the capital of Australia?';
    s.question.explanation = { text: 'Canberra has been the capital of Australia since 1913.', cites: ['e1'] };
    expect(warningCodes(checkScene(s, exampleDraft()))).toContain('CLAIM_WEAK_MATCH');
  });

  it('the reviewer\'s lesson: all three are caught in one lesson', () => {
    const draft = reflectDraft();
    submit(draft, reflectScene('John Mauchly first described binary search in 1946 in the Moore School Lectures, and the first version free of bugs was not published until 1962. Honey also never spoils.'));
    const s4 = exampleScene('s4');
    s4.question.explanation.text = 'A 2006 study found that 90% of professional programmers get this wrong, and that honey never spoils.';
    submit(draft, s4);
    const s9 = exampleScene('s9');
    s9.takeaways[0].text = HONEY;
    expect(errorCodes(submit(draft, s9))).toEqual(['CLAIM_UNRELATED']);
    // The recap was not stored, so the lesson still holds the honest one, and reports the two weak matches.
    const report = checkLesson(draft);
    expect(report.weakClaims).toEqual(['s4/question.explanation', 's6/question.modelAnswer']);
  });
});

describe('honest takeaways, explanations and model answers pass as before', () => {
  it('the example lesson and both fixture lessons have no weak match and no warning', () => {
    for (const draft of [exampleDraft(), assemble(structuredClone(HTTP_LESSON)), assemble(structuredClone(APOLLO_LESSON))]) {
      const report = checkLesson(draft);
      expect(report.errors).toEqual([]);
      expect(report.warnings).toEqual([]);
      expect(report.weakClaims).toEqual([]);
    }
  });

  it('the example reflect question passes clean', () => {
    const draft = reflectDraft();
    const s = exampleScene('s6');
    s.question = structuredClone(EXAMPLE_QUESTIONS.reflect);
    expect(codes(checkScene(s, draft))).toEqual([]);
  });

  it('an explanation of a case the lesson did not show needs only the terms of the rule it applies', () => {
    const s = exampleScene('s4');
    s.question.explanation = { text: '70 is greater than 50, so in a sorted array it can only sit after the middle element; the earlier half is discarded.', cites: ['e1'] };
    expect(codes(checkScene(s, exampleDraft()))).toEqual([]);
  });

  it('a takeaway may restate its source closely, and a model answer may be long: neither the copy rule nor the claim word limit applies', () => {
    const recap = exampleScene('s9');
    recap.takeaways[0].text = 'Binary search finds a target value in a sorted array by repeatedly comparing the target with the middle element and discarding the half that cannot contain it.';
    expect(codes(checkScene(recap, exampleDraft()))).toEqual([]);

    const long = 'Each step discards a half on the assumption that sorted order puts the target on the other side. '.repeat(4).trim();
    expect(long.split(' ').length).toBeGreaterThan(L.claimWords);
    expect(long.length).toBeLessThanOrEqual(L.modelAnswerChars);
    expect(codes(checkScene(reflectScene(long, ['e3']), reflectDraft()))).toEqual([]);
  });

  it('numbers in an explanation or a model answer stay unchecked: a worked case has its own numbers', () => {
    const s = exampleScene('s4');
    s.question.explanation = { text: 'With 70 against a middle element of 50, the half before the middle element (25 items of 51) is discarded.', cites: ['e1'] };
    expect(codes(checkScene(s, exampleDraft()))).toEqual([]);
  });

  it('a statement citing a passage in another language is not compared, as for a claim', () => {
    const draft = exampleDraft();
    draft.evidence.push({ ...draft.evidence[0]!, id: 'e6', lang: 'de', url: 'https://example.com/suche', excerpt: 'Die binäre Suche vergleicht das gesuchte Element mit dem mittleren Element und verwirft die Hälfte, die es nicht enthalten kann.' });
    const s = exampleScene('s9');
    s.takeaways[0].cites = ['e6'];
    expect(codes(checkScene(s, draft))).toEqual([]);
  });
});

describe('too many weak matches', () => {
  const WEAK_CLAIMS: Array<[scene: string, block: number, text: string]> = [
    ['s1', 1, 'Binary trees store hierarchical records inside balanced database indexes.'],
    ['s2', 0, 'Sorted playlists help listeners locate favourite recordings without scrolling endlessly.'],
    ['s7', 2, 'Large spreadsheets frequently crash older laptops whenever formulas recalculate everything.'],
  ];
  const weakClaim = (draft: Draft, n: number): void => {
    const [id, block, text] = WEAK_CLAIMS[n]!;
    const s = exampleScene(id);
    s.blocks[block].text = text;
    expect(submit(draft, s).errors).toEqual([]);
  };
  const weakExplanation = (draft: Draft, id: string): void => {
    const s = exampleScene(id);
    s.question.explanation.text = 'Honey never spoils, which is why jars of it keep for thousands of years.';
    expect(submit(draft, s).errors).toEqual([]);
  };
  const weakTakeaway = (draft: Draft): void => {
    const s = exampleScene('s9');
    s.takeaways[0].text = 'Binary trees store hierarchical records inside balanced database indexes.';
    expect(submit(draft, s).errors).toEqual([]);
  };

  it('the share of weak claims among the claims is judged as it always was, and other statements do not dilute it', () => {
    // 8 claims, 2 takeaways and 3 explanations: 3 weak claims are 37% of the claims but 23% of all 13.
    const draft = exampleDraft();
    for (let n = 0; n < 3; n++) weakClaim(draft, n);
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['TOO_MANY_WEAK_CLAIMS']);
    expect(report.errors[0]!.message).toContain('3 of 8 claims barely match');
    expect(report.errors[0]).toMatchObject({ got: '3', expected: 'at most 2' });
  });

  it('weak matches of every kind are also judged together', () => {
    const draft = exampleDraft();
    weakClaim(draft, 0);
    weakTakeaway(draft);
    weakExplanation(draft, 's4');
    // 3 of 13 is under a quarter.
    let report = checkLesson(draft);
    expect(report.errors).toEqual([]);
    expect(report.weakClaims).toEqual(['s1/blocks[1]', 's4/question.explanation', 's9/takeaways[0]']);

    weakExplanation(draft, 's8');
    report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['TOO_MANY_WEAK_CLAIMS']);
    expect(report.errors[0]!.message).toContain('4 of 13 cited statements (claims, takeaways, explanations and model answers) barely match');
    expect(report.errors[0]!.message).toContain('s8/question.explanation');
    expect(report.stats.weakClaims).toBe(4);
  });
});
