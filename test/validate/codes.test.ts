// One fixture per code in the catalog: a mutation of a valid lesson that triggers that code and
// nothing else. A code without a fixture fails the last test here, so a rule cannot be added
// without proof that it can fire on its own, and that its message is one an agent can act on.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_EVIDENCE, EXAMPLE_FIGURES, EXAMPLE_PLAN } from '../../src/core/examples';
import { ISSUE_CODES, ISSUES, MAX_ISSUES_PER_CALL, type IssueCode } from '../../src/core/issues';
import { LIMITS as L } from '../../src/core/limits';
import type { SceneKind } from '../../src/core/schema';
import { countWords } from '../../src/core/text';
import type { Draft, Issue } from '../../src/core/types';
import { checkEvidence, checkLesson, checkPlan, checkScene } from '../../src/core/validate';
import { buildEvidence, buildLesson } from './build';
import { CLIP_FIXTURES } from './clip-fixtures';
import { assemble, codes, EXAMPLE_PARTS, exampleDraft, exampleScene, expectActionable, expectNoExcerptText, newDraft, saveEvidence, setPlan, submit } from './helpers';

interface Outcome {
  errors: Issue[];
  warnings: Issue[];
  draft: Draft;
}

/** Codes that cannot occur without another, with the reason. Everything else must appear alone. */
const COMPANIONS: Partial<Record<IssueCode, IssueCode[]>> = {
  // The entry that says "there are more" only exists beside the issues it cuts short.
  MORE_ISSUES: ['UNKNOWN_FIELD'],
  // The lesson-level error is a count of the per-claim warnings.
  TOO_MANY_WEAK_CLAIMS: ['CLAIM_WEAK_MATCH'],
};

type Loose = any;

function scene(id: string, change: (s: Loose) => void, prepare?: (draft: Draft) => void): Outcome {
  const draft = exampleDraft();
  prepare?.(draft);
  const s = exampleScene(id);
  change(s);
  return { ...checkScene(s, draft), draft };
}

function plan(change: (p: Loose) => void, prepare?: (draft: Draft) => void): Outcome {
  const draft = exampleDraft();
  prepare?.(draft);
  const p: Loose = structuredClone(EXAMPLE_PLAN);
  change(p);
  return { ...checkPlan(p, draft), draft };
}

function evidence(input: unknown, prepare?: (draft: Draft) => void): Outcome {
  const draft = exampleDraft();
  prepare?.(draft);
  return { ...checkEvidence(input, draft), draft };
}

/** The example lesson with some scenes replaced. Each replacement must itself be accepted. */
function lesson(changes: Record<string, (s: Loose) => void>, prepare?: (draft: Draft) => void, allowWarnings: string[] = []): Outcome {
  const draft = exampleDraft();
  prepare?.(draft);
  for (const [id, change] of Object.entries(changes)) {
    const s = exampleScene(id);
    change(s);
    const check = submit(draft, s);
    expect(check.errors, `the changed scene ${id} must be accepted on its own`).toEqual([]);
    expect(check.warnings.map((w) => w.code).filter((c) => !allowWarnings.includes(c)), `the changed scene ${id} must be clean on its own`).toEqual([]);
  }
  return { ...checkLesson(draft), draft };
}

/** A generated lesson stored as it stands, without asking checkPlan: what checkLesson finds in a draft that should not exist. */
function stored(depth: 'quick' | 'standard' | 'deep', kinds: SceneKind[], options: Partial<Parameters<typeof buildLesson>[0]> = {}): Outcome {
  const parts = buildLesson({ depth, size: 'min', kinds, fill: 'warn', ...options });
  const draft = newDraft(parts.start);
  for (const item of parts.evidence) saveEvidence(draft, item);
  setPlan(draft, parts.plan);
  for (const s of parts.scenes) {
    const check = submit(draft, s);
    expect(check.errors, `generated scene ${(s as { id: string }).id}`).toEqual([]);
  }
  return { ...checkLesson(draft), draft };
}

const words = (n: number, word = 'tap'): string => `${Array.from({ length: n }, () => word).join(' ')}.`;
const withoutKey = (o: Loose, key: string): void => {
  delete o[key];
};
const nest = (depth: number): unknown => (depth === 0 ? 'x' : [nest(depth - 1)]);

const FIXTURES: Record<IssueCode, () => Outcome> = {
  // The codes of the clip rules and of the frame checks: one mutated clip each (./clip-fixtures.ts).
  ...CLIP_FIXTURES,

  // ----- shape
  INPUT_TOO_DEEP: () => scene('s1', (s) => (s.extra = nest(14))),
  INPUT_CYCLE: () => scene('s1', (s) => (s.self = s)),
  INPUT_TOO_LARGE: () => scene('s1', (s) => (s.blocks = new Array(200_001).fill(0))),
  UNKNOWN_FIELD: () => scene('s1', (s) => (s.notes = 'for later')),
  MISSING_FIELD: () => scene('s1', (s) => withoutKey(s, 'title')),
  WRONG_TYPE: () => scene('s1', (s) => (s.title = 5)),
  TOO_LONG: () => scene('s1', (s) => (s.title = 'x'.repeat(L.sceneTitleChars + 1))),
  TOO_SHORT: () => scene('s1', (s) => (s.title = '')),
  TOO_MANY: () => scene('s1', (s) => (s.blocks = Array.from({ length: L.blocksPerNarration + 1 }, () => s.blocks[1]))),
  TOO_FEW: () => scene('s1', (s) => (s.blocks = [])),
  BAD_VALUE: () => scene('s4', (s) => (s.level = 'hard')),
  BAD_ID: () => scene('s1', (s) => (s.blocks[1].cites = ['E1'])),
  PLACEHOLDER_TEXT: () => scene('s4', (s) => (s.question.hint = 'Optional nudge that does not give the answer away.')),
  MORE_ISSUES: () =>
    scene('s1', (s) => {
      for (let i = 0; i < MAX_ISSUES_PER_CALL + 5; i++) s[`extra${String.fromCharCode(97 + i)}`] = true;
    }),

  // ----- evidence
  EVIDENCE_URL: () => evidence({ ...EXAMPLE_EVIDENCE[0], url: 'http://localhost:8080/notes', excerpt: `${EXAMPLE_EVIDENCE[0]!.excerpt} Again.` }),
  EVIDENCE_LIMIT: () =>
    evidence({ ...buildEvidence(0), url: 'https://library.example.org/entries/one-more', excerpt: 'A further passage that the lesson has no room left to store.' }, (draft) => {
      for (let i = draft.evidence.length; i < L.evidencePerLesson; i++) saveEvidence(draft, buildEvidence(i));
    }),
  EVIDENCE_URL_QUOTA: () =>
    evidence(
      { ...buildEvidence(0), excerpt: `${'Seventh passage of the same page. '.repeat(8)}`.trim() },
      (draft) => {
        for (let i = 0; i < 6; i++) saveEvidence(draft, { ...buildEvidence(0), excerpt: `Passage ${'abcdefg'[i]} of one page. ${'Filler sentence to make it long. '.repeat(9)}`.trim() });
      },
    ),

  // ----- plan
  PLAN_SCENE_COUNT: () =>
    plan((p) => {
      p.outline.splice(8, 0, { id: 'x1', kind: 'step_through', purpose: 'One more trace', figure: 'flow' }, { id: 'x2', kind: 'checkpoint', purpose: 'One more check', question: 'single', objective: 'o2' });
    }),
  PLAN_OBJECTIVE_COUNT: () =>
    plan((p) => {
      p.objectives = [p.objectives[0]];
      for (const entry of p.outline) if (entry.objective) entry.objective = 'o1';
    }),
  PLAN_OBJECTIVE_IDS: () =>
    plan((p) => {
      p.objectives[1].id = 'o3';
      for (const entry of p.outline) if (entry.objective === 'o2') entry.objective = 'o3';
    }),
  PLAN_DUPLICATE_ID: () => plan((p) => (p.outline[6].id = 's5')),
  PLAN_FIRST_SCENE: () => plan((p) => (p.outline[0] = { id: 's1', kind: 'step_through', purpose: 'Open with a trace', figure: 'flow' })),
  PLAN_LAST_SCENE: () => plan((p) => p.outline.splice(7, 2, p.outline[8], p.outline[7])),
  PLAN_CHECKPOINT_FIELDS: () => plan((p) => withoutKey(p.outline[7], 'question')),
  PLAN_STEP_FIGURE: () => plan((p) => withoutKey(p.outline[2], 'figure')),
  PLAN_FIELD_NOT_ALLOWED: () => plan((p) => (p.outline[0].question = 'single')),
  PLAN_OBJECTIVE_UNASSESSED: () => plan((p) => p.objectives.push({ id: 'o3', text: 'Choose between binary search and linear search' })),
  PLAN_GRADED_SHARE: () =>
    plan((p) => {
      p.outline[3].question = 'reflect';
      p.outline[7].question = 'reflect';
    }),
  PLAN_NARRATION_RUN: () => plan((p) => (p.outline[2] = { id: 's3', kind: 'narration', purpose: 'A third narration in a row' })),
  PLAN_PASSIVE_RUN: () =>
    plan((p) => {
      p.outline[2] = { id: 's3', kind: 'narration', purpose: 'A third narration in a row' };
      p.outline[3] = { id: 's4', kind: 'narration', purpose: 'And a fourth' };
    }),
  PLAN_NO_FIGURE: () =>
    plan((p) => {
      p.outline = [
        { id: 's1', kind: 'narration', purpose: 'Hook' },
        { id: 's2', kind: 'narration', purpose: 'The idea' },
        { id: 's3', kind: 'checkpoint', purpose: 'Check the idea', question: 'single', objective: 'o1' },
        { id: 's4', kind: 'narration', purpose: 'Why it is fast' },
        { id: 's5', kind: 'checkpoint', purpose: 'Check the cost', question: 'numeric', objective: 'o2' },
        { id: 's6', kind: 'recap', purpose: 'Takeaways' },
      ];
    }),
  PLAN_BEFORE_RESEARCH: () => plan(() => undefined, (draft) => (draft.evidence = [])),

  // ----- scene and plan fit
  NO_PLAN: () => scene('s1', () => undefined, (draft) => (draft.outline = [])),
  SCENE_NOT_PLANNED: () => scene('s1', (s) => (s.id = 's99')),
  SCENE_KIND_MISMATCH: () => scene('s1', (s) => (s.id = 's4')),
  SCENE_SHAPE_MISMATCH: () => scene('s2', (s) => withoutKey(s, 'figure')),
  OBJECTIVE_UNKNOWN: () => scene('s4', (s) => (s.objective = 'o7')),
  RECAP_OBJECTIVES: () => scene('s9', (s) => s.takeaways.pop()),

  // ----- grounding
  CITE_UNKNOWN: () => scene('s1', (s) => (s.blocks[1].cites = ['e9'])),
  QUOTE_NOT_FOUND: () => scene('s7', (s) => (s.blocks[1].text = 'the half that is thrown away may hold the target')),
  QUOTE_TOO_SHORT: () => scene('s7', (s) => (s.blocks[1].text = 'may contain')),
  CLAIM_TOO_LONG: () =>
    scene('s2', (s) => {
      s.blocks[0].text =
        'The search keeps one rule and uses it again and again: look at the middle element of what is left, compare it with the target, and then drop the half that can not hold it, so the part still to be searched gets smaller with each pass it makes.';
      expect(countWords(s.blocks[0].text, 'en')).toBeGreaterThan(L.claimWords);
    }),
  CLAIM_COPIES_SOURCE: () => scene('s1', (s) => (s.blocks[1].text = 'Binary search finds a target value in a sorted array by repeatedly comparing the target with the middle element and discarding the half that cannot contain it.')),
  CLAIM_UNRELATED: () => scene('s1', (s) => (s.blocks[1].text = 'Photosynthesis converts sunlight into chemical energy inside chloroplasts.')),
  CLAIM_WEAK_MATCH: () => scene('s1', (s) => (s.blocks[1].text = 'Binary trees store hierarchical records inside balanced database indexes.')),
  NAME_NOT_IN_SOURCE: () => scene('s7', (s) => (s.blocks[0].text = 'Binary search, as first taught at Stanford, is only reliable when the data is sorted.')),
  NUMBER_NOT_IN_SOURCE: () => scene('s5', (s) => (s.blocks[1].text = 'Binary search needs at most about 30 comparisons for a billion items, because each comparison halves the interval.')),
  NUMBER_UNGROUNDED: () => scene('s1', (s) => (s.blocks[0].text = 'How do you find one name among 5,000,000 without reading them all?')),
  SCENE_NO_CITED_BLOCK: () => scene('s1', (s) => s.blocks.splice(1, 1)),

  // ----- text safety and markup
  URL_IN_TEXT: () => scene('s1', (s) => (s.blocks[0].text = 'Read https://example.org/algorithms/binary-search before you go on.')),
  UNKNOWN_HOST: () => scene('s5', (s) => (s.blocks[2].text = 'Fetch the list from `https://lists.invalid/names.txt` and count its lines.')),
  UNSAFE_COMMAND: () => scene('s5', (s) => (s.blocks[2].text = 'Install the helper with `cat setup.sh | bash` before you start.')),
  MARKUP_MATH: () => scene('s1', (s) => (s.blocks[0].text = 'What does $\\bogus{n}$ comparisons cost?')),

  // ----- figures and steps
  FIGURE_DUPLICATE_ID: () => scene('s2', (s) => (s.figure.edges[0].id = 'start')),
  FIGURE_UNKNOWN_REF: () => scene('s2', (s) => (s.figure.edges[4].to = 'center')),
  FIGURE_CELL_COUNT: () =>
    scene(
      's2',
      (s) => {
        s.figure = structuredClone(EXAMPLE_FIGURES.compare);
        s.figure.rows[0].cells.pop();
        s.figure.rows[0].cells.push('Yes', 'Sometimes');
      },
      (draft) => (draft.outline[1]!.figure = 'compare'),
    ),
  FIGURE_VALUE_COUNT: () => scene('s5', (s) => s.figure.series[1].values.pop()),
  FIGURE_UNCONNECTED: () => scene('s2', (s) => s.figure.nodes.push({ id: 'spare', label: 'A node nobody reaches' })),
  STEP_HIGHLIGHT_UNKNOWN: () => scene('s3', (s) => (s.steps[0].highlight = ['line2'])),

  // ----- word budgets
  WORDS_OVER_BUDGET: () => scene('s1', (s) => s.blocks.push({ type: 'example', text: words(L.narrationWords.max - 70) })),
  WORDS_NEAR_BUDGET: () => scene('s1', (s) => s.blocks.push({ type: 'framing', text: words(L.narrationWords.warn - 70) })),

  // ----- questions
  OPTION_CORRECT_COUNT: () => scene('s4', (s) => (s.question.options[1].correct = true)),
  OPTION_DUPLICATE: () => scene('s4', (s) => (s.question.options[2].text = s.question.options[1].text.toUpperCase())),
  OPTION_ALL_NONE: () => scene('s4', (s) => (s.question.options[2].text = 'None of the above, because the search has to start again')),
  MISCONCEPTION_MISSING: () => scene('s4', (s) => withoutKey(s.question.options[1], 'misconception')),
  FEEDBACK_GENERIC: () => scene('s4', (s) => (s.question.options[1].feedback = 'No, that is not correct.')),
  CORRECT_OPTION_LONGEST: () => scene('s4', (s) => (s.question.options[0].text = 'Search only the half after the middle element, since 70 is larger')),
  ORDER_DUPLICATE: () => scene('s8', (s) => (s.question.items[3] = s.question.items[1])),
  NEGATIVE_STEM: () => scene('s4', (s) => (s.question.prompt = 'You search a sorted list for 70 and the middle element is 50. Which of these does binary search NOT do next?')),

  // ----- the lesson as a whole
  LESSON_INCOMPLETE: () => {
    const draft = exampleDraft();
    draft.scenes = draft.scenes.filter((s) => s.id !== 's5' && s.id !== 's9');
    return { ...checkLesson(draft), draft };
  },
  EVIDENCE_TOO_FEW: () =>
    lesson({
      // Drop the two statements that rest on e4 and e5, leaving three cited excerpts.
      s5: (s) => {
        s.blocks.splice(0, 1);
        s.figure.cites = ['e2'];
      },
      s7: (s) => s.blocks.splice(2, 1),
    }),
  EVIDENCE_OVERUSED: () => lesson({ s3: (s) => (s.steps[2].blocks[0].cites = ['e3', 'e1']) }),
  SINGLE_HOST: () => {
    const draft = assemble({ ...structuredClone(EXAMPLE_PARTS), evidence: EXAMPLE_EVIDENCE.map((e) => ({ ...e, url: e.url.replace(/example\.(com|net)/, 'example.org') })) });
    return { ...checkLesson(draft), draft };
  },
  MOSTLY_SNIPPETS: () =>
    lesson({}, (draft) => {
      for (const e of draft.evidence.slice(0, 3)) e.via = 'search_snippet';
    }),
  LESSON_TOO_LONG: () => stored('quick', ['narration', 'step_through', 'step_through', 'checkpoint', 'step_through', 'recap'], { steps: 8 }),
  LESSON_LONG: () => stored('quick', ['narration', 'step_through', 'step_through', 'checkpoint', 'recap'], { steps: 8 }),
  UNCITED_SHARE: () =>
    lesson({
      s2: (s) => s.blocks.push({ type: 'framing', text: words(25, 'look') }),
      s5: (s) => s.blocks.push({ type: 'framing', text: words(10, 'look') }),
      s7: (s) => s.blocks.push({ type: 'framing', text: words(25, 'look') }),
    }),
  EXAMPLE_SHARE: () =>
    lesson({
      s1: (s) => s.blocks.push({ type: 'example', text: words(14, 'try') }),
      s7: (s) => s.blocks.push({ type: 'example', text: words(41, 'try') }),
    }),
  NARRATION_RUN: () => stored('quick', ['narration', 'narration', 'narration', 'checkpoint', 'recap']),
  PASSIVE_RUN: () => stored('quick', ['narration', 'step_through', 'narration', 'narration', 'checkpoint', 'recap'], { predict: false, steps: 2 }),
  NO_FIGURE: () => stored('standard', ['narration', 'checkpoint', 'narration', 'checkpoint', 'narration', 'checkpoint', 'recap'], { narrationFigures: false, objectives: 2 }),
  NO_APPLY_CHECKPOINT: () => lesson({ s4: (s) => (s.level = 'recall') }),
  OBJECTIVE_UNASSESSED: () =>
    lesson(
      { s9: (s) => s.takeaways.push({ objective: 'o3', text: 'Linear search works on unsorted data, so it is the fallback when sorting is not possible.', cites: ['e5'] }) },
      (draft) => draft.objectives.push({ id: 'o3', text: 'Choose between binary search and linear search' }),
    ),
  CHECKPOINT_UNTAUGHT: () =>
    lesson({ s8: (s) => (s.question.explanation.cites = ['e6']) }, (draft) => {
      saveEvidence(draft, { ...EXAMPLE_EVIDENCE[0], url: 'https://example.org/algorithms/binary-search-steps', excerpt: 'One pass of binary search finds the middle element, compares it with the target and discards a half.' });
    }),
  // The explanation rests on e5, which only s5 teaches.
  CHECKPOINT_BEFORE_TAUGHT: () =>
    lesson({ s4: (s) => (s.question.explanation = { text: 'Checking one element after another is linear search, which needs up to n comparisons; halving the interval is what sets this search apart.', cites: ['e5'] }) }),
  TOO_MANY_WEAK_CLAIMS: () =>
    lesson(
      {
        s1: (s) => (s.blocks[1].text = 'Binary trees store hierarchical records inside balanced database indexes.'),
        s2: (s) => (s.blocks[0].text = 'Sorted playlists help listeners locate favourite recordings without scrolling endlessly.'),
        s7: (s) => (s.blocks[2].text = 'Large spreadsheets frequently crash older laptops whenever formulas recalculate everything.'),
      },
      undefined,
      ['CLAIM_WEAK_MATCH'],
    ),
  LESSON_TOO_LARGE: () => {
    // No honest lesson of this size exists in the fixtures, so the limit is lowered for one call.
    const limits = L as { lessonJsonBytes: number };
    const real = limits.lessonJsonBytes;
    limits.lessonJsonBytes = 2000;
    try {
      const draft = exampleDraft();
      return { ...checkLesson(draft), draft };
    } finally {
      limits.lessonJsonBytes = real;
    }
  },
};

describe('every code has a fixture that triggers it and nothing else', () => {
  it.each(ISSUE_CODES.map((code) => [code] as const))('%s', (code) => {
    const outcome = FIXTURES[code]();
    const all = [...outcome.errors, ...outcome.warnings];
    const expected = [code, ...(COMPANIONS[code] ?? [])].sort();
    expect(codes(outcome), all.map((i) => `${i.code} ${i.path}: ${i.message}`).join('\n')).toEqual(expected);

    const mine = all.filter((i) => i.code === code);
    const entry = ISSUES[code] as { severity: string; also?: string };
    // The severity is the catalog's, except for the two codes documented as reported at either.
    if (!entry.also) for (const i of mine) expect(i.severity).toBe(entry.severity);
    for (const i of outcome.errors) expect(i.severity).toBe('error');
    for (const i of outcome.warnings) expect(i.severity).toBe('warning');
    expectActionable(all);
    expectNoExcerptText(all, outcome.draft);
  });

  it('covers the whole catalog', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...ISSUE_CODES].sort());
  });

  it('an error rejects and a warning does not', () => {
    for (const code of ISSUE_CODES) {
      const outcome = FIXTURES[code]() as Outcome & { ok?: boolean };
      if (outcome.ok === undefined) continue;
      expect(outcome.ok, code).toBe(outcome.errors.length === 0);
    }
  });
});

describe('codes reported at two severities', () => {
  it('CORRECT_OPTION_LONGEST is an error when the difference is extreme', () => {
    const out = scene('s4', (s) => (s.question.options[0].text = 'Search only the half after the middle element, because 70 is larger than 50 in a sorted list'));
    expect(out.errors.map((e) => e.code)).toEqual(['CORRECT_OPTION_LONGEST']);
    expect(out.errors[0]!.got).toBe('92');
  });
});

describe('fixtures are stable', () => {
  it('the same fixture gives the same issues twice', () => {
    for (const code of ['CLAIM_UNRELATED', 'PLAN_PASSIVE_RUN', 'EVIDENCE_OVERUSED', 'QUOTE_NOT_FOUND'] as const) {
      const a = FIXTURES[code]();
      const b = FIXTURES[code]();
      expect(JSON.stringify([a.errors, a.warnings])).toBe(JSON.stringify([b.errors, b.warnings]));
    }
  });
});
