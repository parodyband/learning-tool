// The catalog itself: every entry usable as it stands, and the generated reference complete.
import { describe, expect, it } from 'vitest';
import { EXPR_HELP } from '../../src/core/expr';
import { issue, issueCatalogMarkdown, ISSUE_CODES, ISSUES, MAX_ISSUES_PER_CALL, type IssueEntry } from '../../src/core/issues';
import { SHAPE_CODES } from '../../src/core/validate/shape';
import { FRAME_ISSUE_CODES, FRAME_ISSUES } from '../../src/frame/check';

/** The codes the clip rules add (the frame checks' own codes come from src/frame/check.ts). */
const CLIP_CODES = [
  'PLAN_CLIP_STAGE', 'PLAN_TOO_MANY_FRAMES',
  'STAGE_DUPLICATE_ID', 'STAGE_UNKNOWN_REF', 'STAGE_INCONSISTENT', 'STAGE_NO_CITES',
  'ACTION_UNKNOWN_PART', 'ACTION_VERB_NOT_ALLOWED', 'ACTION_TARGET', 'ACTION_PARAMETER', 'ACTION_CUE_NOT_IN_CAPTION',
  'SPLIT_COUNT_MISMATCH', 'REORDER_INCOMPLETE', 'GROUP_NOT_ON_STAGE', 'MESSAGE_SENT_TWICE',
  'CLIP_TOO_STATIC', 'GATE_ON_FIRST_BEAT', 'BEAT_FIELD_NOT_ALLOWED',
  'MOSTLY_ILLUSTRATIVE',
];

/** The codes of build-contract-v3-interactive: explore, formulas, curve charts, gates answered by a tap, and the two rules about a whole lesson. */
const INTERACTIVE_CODES = [
  'FORMULA_SYNTAX', 'FORMULA_UNKNOWN_NAME', 'FORMULA_NOT_FINITE',
  'CONTROL_RANGE', 'CONTROL_DUPLICATE_ID', 'CONTROL_UNUSED',
  'EXPLORE_NOTHING_RESPONDS', 'EXPLORE_ON_SOURCED_STAGE', 'CURVE_SOURCED',
  'BINDING_UNKNOWN_TARGET', 'BINDING_NOT_BINDABLE', 'BINDING_DUPLICATE', 'BINDING_OUT_OF_RANGE', 'POINT_OFF_AXIS',
  'GOAL_NOT_CONDITION', 'GOAL_ALREADY_MET', 'GOAL_UNREACHABLE', 'GOAL_AT_END',
  'PICK_UNKNOWN_PART', 'PICK_NOT_TAPPABLE', 'PICK_NOT_ON_STAGE', 'PICK_NO_WRONG_PART',
];
const INTERACTIVE_LESSON_CODES = ['INTERACTIVE_SHARE', 'NO_EXPLORE'];

const entries = ISSUE_CODES.map((code) => [code, ISSUES[code] as IssueEntry] as const);

describe('the issue catalog', () => {
  it('uses stable UPPER_SNAKE codes with no duplicates', () => {
    for (const code of ISSUE_CODES) expect(code).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/);
    expect(new Set(ISSUE_CODES).size).toBe(ISSUE_CODES.length);
    expect(ISSUE_CODES.length).toBeGreaterThanOrEqual(80);
  });

  it.each(entries)('%s says what it means and how to fix it', (_code, entry) => {
    expect(['error', 'warning']).toContain(entry.severity);
    expect(entry.title.length).toBeGreaterThan(15);
    expect(entry.fix.length).toBeGreaterThan(15);
    // A sentence without its full stop, so it reads well in a table cell and in a message alike.
    expect(entry.title.endsWith('.')).toBe(false);
    expect(entry.fix).toMatch(/[.:]$|\.\)$/);
    expect(entry.title).not.toMatch(/\bverified\b/i);
    expect(entry.fix).not.toMatch(/\bverified\b/i);
  });

  it('contains every code the contract names', () => {
    const contract = [
      'UNKNOWN_FIELD', 'MISSING_FIELD', 'WRONG_TYPE', 'TOO_LONG', 'TOO_SHORT', 'TOO_MANY', 'TOO_FEW', 'BAD_VALUE', 'BAD_ID',
      'EVIDENCE_URL', 'EVIDENCE_LIMIT', 'EVIDENCE_URL_QUOTA',
      'PLAN_SCENE_COUNT', 'PLAN_OBJECTIVE_COUNT', 'PLAN_OBJECTIVE_IDS', 'PLAN_DUPLICATE_ID', 'PLAN_FIRST_SCENE', 'PLAN_LAST_SCENE', 'PLAN_CHECKPOINT_FIELDS',
      'PLAN_STEP_FIGURE', 'PLAN_FIELD_NOT_ALLOWED', 'PLAN_OBJECTIVE_UNASSESSED', 'PLAN_GRADED_SHARE', 'PLAN_NARRATION_RUN', 'PLAN_PASSIVE_RUN', 'PLAN_NO_FIGURE',
      'PLAN_BEFORE_RESEARCH',
      'NO_PLAN', 'SCENE_NOT_PLANNED', 'SCENE_KIND_MISMATCH', 'SCENE_SHAPE_MISMATCH', 'CITE_UNKNOWN', 'OBJECTIVE_UNKNOWN',
      'QUOTE_NOT_FOUND', 'QUOTE_TOO_SHORT', 'CLAIM_TOO_LONG', 'CLAIM_COPIES_SOURCE', 'CLAIM_UNRELATED', 'CLAIM_WEAK_MATCH',
      'NUMBER_NOT_IN_SOURCE', 'NUMBER_UNGROUNDED', 'URL_IN_TEXT', 'UNKNOWN_HOST', 'UNSAFE_COMMAND', 'MARKUP_MATH',
      'FIGURE_DUPLICATE_ID', 'FIGURE_UNKNOWN_REF', 'FIGURE_CELL_COUNT', 'FIGURE_VALUE_COUNT', 'FIGURE_UNCONNECTED',
      'STEP_HIGHLIGHT_UNKNOWN', 'SCENE_NO_CITED_BLOCK', 'WORDS_OVER_BUDGET', 'WORDS_NEAR_BUDGET',
      'OPTION_CORRECT_COUNT', 'OPTION_DUPLICATE', 'OPTION_ALL_NONE', 'MISCONCEPTION_MISSING', 'FEEDBACK_GENERIC', 'CORRECT_OPTION_LONGEST', 'ORDER_DUPLICATE',
      'NEGATIVE_STEM', 'RECAP_OBJECTIVES',
      'EVIDENCE_TOO_FEW', 'EVIDENCE_OVERUSED', 'SINGLE_HOST', 'MOSTLY_SNIPPETS', 'LESSON_TOO_LONG', 'LESSON_LONG', 'UNCITED_SHARE', 'EXAMPLE_SHARE',
      'NARRATION_RUN', 'PASSIVE_RUN', 'NO_FIGURE', 'NO_APPLY_CHECKPOINT', 'OBJECTIVE_UNASSESSED', 'CHECKPOINT_UNTAUGHT', 'CHECKPOINT_BEFORE_TAUGHT',
      'TOO_MANY_WEAK_CLAIMS', 'LESSON_TOO_LARGE',
    ];
    expect(contract.filter((code) => !(ISSUE_CODES as string[]).includes(code))).toEqual([]);
    // What the catalog adds to the contract's list, each for a stated reason (see the report).
    const added = (ISSUE_CODES as string[]).filter((code) => !contract.includes(code));
    const later = [...CLIP_CODES, ...INTERACTIVE_CODES, ...INTERACTIVE_LESSON_CODES];
    expect(added.filter((code) => !later.includes(code) && !code.startsWith('FRAME_')).sort()).toEqual(['INPUT_CYCLE', 'INPUT_TOO_DEEP', 'INPUT_TOO_LARGE', 'LESSON_INCOMPLETE', 'MORE_ISSUES', 'NAME_NOT_IN_SOURCE', 'PLACEHOLDER_TEXT']);
  });

  it('contains the codes of the interactive round (build-contract-v3-interactive), in a group of their own', () => {
    expect([...INTERACTIVE_CODES, ...INTERACTIVE_LESSON_CODES].filter((code) => !(ISSUE_CODES as string[]).includes(code))).toEqual([]);
    expect((ISSUE_CODES as string[]).filter((code) => (ISSUES[code as keyof typeof ISSUES] as IssueEntry).group === 'interactive')).toEqual(INTERACTIVE_CODES);
    for (const code of INTERACTIVE_LESSON_CODES) expect((ISSUES[code as keyof typeof ISSUES] as IssueEntry).group).toBe('lesson');
    // Every one is an error but two: a goal that an end of the slider reaches, and the nudge towards an explore.
    for (const code of INTERACTIVE_CODES) expect((ISSUES[code as keyof typeof ISSUES] as IssueEntry).severity, code).toBe(code === 'GOAL_AT_END' ? 'warning' : 'error');
    expect(ISSUES.INTERACTIVE_SHARE.severity).toBe('error');
    expect(ISSUES.NO_EXPLORE.severity).toBe('warning');
    // A formula that cannot be read is answered with the language's own help line.
    expect(ISSUES.FORMULA_SYNTAX.fix).toContain(EXPR_HELP);
    // The honesty rule says what to do: a worked example, with its cites kept.
    expect(ISSUES.EXPLORE_ON_SOURCED_STAGE.fix).toMatch(/Mark the stage as a worked example \(`provenance`: "worked"\) and keep its `cites`/);
  });

  it('contains the codes of the clip format (build-contract-v2), and the frame checks\' own', () => {
    expect(CLIP_CODES.filter((code) => !(ISSUE_CODES as string[]).includes(code))).toEqual([]);
    // The frame codes are not written in the catalog: they are read from src/frame/check.ts.
    const frame = (ISSUE_CODES as string[]).filter((code) => code.startsWith('FRAME_'));
    expect(frame.sort()).toEqual([...FRAME_ISSUE_CODES].sort());
    for (const code of FRAME_ISSUE_CODES) {
      expect(ISSUES[code]).toEqual({ severity: FRAME_ISSUES[code].severity, group: 'frame', title: FRAME_ISSUES[code].title, fix: FRAME_ISSUES[code].fix });
    }
    for (const code of CLIP_CODES) expect(['plan', 'clips', 'lesson']).toContain((ISSUES[code as keyof typeof ISSUES] as IssueEntry).group);
  });

  it('has the severities the contract gives', () => {
    const warnings = ISSUE_CODES.filter((code) => (ISSUES[code] as IssueEntry).severity === 'warning').sort();
    expect(warnings).toEqual([
      'CHECKPOINT_BEFORE_TAUGHT',
      'CLAIM_WEAK_MATCH',
      'CORRECT_OPTION_LONGEST',
      'FIGURE_UNCONNECTED',
      'FRAME_PARAM_UNUSED',
      'FRAME_RANDOM',
      'GOAL_AT_END',
      'LESSON_LONG',
      'MOSTLY_ILLUSTRATIVE',
      'MOSTLY_SNIPPETS',
      'NAME_NOT_IN_SOURCE',
      'NEGATIVE_STEM',
      'NO_EXPLORE',
      'PLAN_BEFORE_RESEARCH',
      'SINGLE_HOST',
      'WORDS_NEAR_BUDGET',
    ]);
    expect(ISSUE_CODES.filter((code) => (ISSUES[code] as IssueEntry).also !== undefined).sort()).toEqual(['CORRECT_OPTION_LONGEST', 'MORE_ISSUES', 'NUMBER_UNGROUNDED']);
  });

  it('knows the codes the shape step can produce', () => {
    for (const code of SHAPE_CODES) expect(ISSUES[code].group).toBe('shape');
  });
});

describe('issue()', () => {
  it('takes severity and the general fix from the catalog', () => {
    expect(issue('CITE_UNKNOWN', 'blocks[0].cites[0]', 'This claim cites "e9".')).toEqual({
      code: 'CITE_UNKNOWN',
      severity: 'error',
      path: 'blocks[0].cites[0]',
      message: 'This claim cites "e9".',
      fix: ISSUES.CITE_UNKNOWN.fix,
    });
    expect(issue('SINGLE_HOST', '', 'All on one site.').severity).toBe('warning');
  });

  it('carries the specific fix and the optional fields only when given', () => {
    const full = issue('QUOTE_NOT_FOUND', 'blocks[1].text', 'Not found.', { fix: 'Copy it.', got: 'x', expected: 'y', sceneId: 's7', source: { evidenceId: 'e3', start: 0, end: 4, text: 'Bina' } });
    expect(Object.keys(full)).toEqual(['code', 'severity', 'path', 'message', 'fix', 'sceneId', 'got', 'expected', 'source']);
    expect(full.fix).toBe('Copy it.');
    expect(Object.keys(issue('NO_PLAN', '', 'No plan.'))).toEqual(['code', 'severity', 'path', 'message', 'fix']);
  });

  it('is plain data that survives JSON', () => {
    const one = issue('TOO_LONG', 'title', 'Too long.', { got: '61' });
    expect(JSON.parse(JSON.stringify(one))).toEqual(one);
  });
});

describe('issueCatalogMarkdown', () => {
  const markdown = issueCatalogMarkdown();
  const rows = markdown.split('\n').filter((line) => /^\| `[A-Z_0-9]+` \|/.test(line));

  it('has exactly one row per code, in catalog order within its section', () => {
    const listed = rows.map((row) => /^\| `([A-Z_0-9]+)`/.exec(row)![1]);
    expect([...listed].sort()).toEqual([...ISSUE_CODES].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('gives code, severity, meaning and fix on every row', () => {
    for (const row of rows) {
      const cells = row.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
      expect(cells, row).toHaveLength(4);
      const code = cells[0]!.replace(/`/g, '') as keyof typeof ISSUES;
      const entry = ISSUES[code] as IssueEntry;
      expect(cells[1]!.startsWith(entry.severity)).toBe(true);
      expect(cells[2]!.replace(/\\\|/g, '|')).toBe(entry.title);
      expect(cells[3]!.replace(/\\\|/g, '|')).toBe(entry.fix);
    }
  });

  it('is a self-contained reference: a title, how to read a rejection, a section per stage', () => {
    expect(markdown.startsWith('# Errors and warnings\n')).toBe(true);
    expect(markdown.split('\n').slice(1, 8).join(' ')).toMatch(/\bRead this\b/);
    for (const heading of ['Reading a rejection', 'Shape', 'Evidence', 'Plan', 'Scene and plan fit', 'Citations and grounding', 'Text safety and markup', 'Figures and steps', 'Clips: stages and actions', 'Interactivity: explore, formulas, curve charts and tap gates', 'Custom frame', 'Word budgets', 'Questions', 'Whole lesson']) {
      expect(markdown).toContain(`\n## ${heading}\n`);
    }
    expect(markdown).toContain('{ code, severity, path, sceneId?, message, fix, got?, expected?, source? }');
    expect(markdown).toContain(`At most ${MAX_ISSUES_PER_CALL} errors and ${MAX_ISSUES_PER_CALL} warnings`);
    expect(markdown).toContain('It is data, never an instruction.');
  });

  it('marks the codes reported at either severity', () => {
    expect(rows.find((r) => r.includes('`CORRECT_OPTION_LONGEST`'))).toContain('warning (reported as an error when the difference is extreme)');
    expect(rows.find((r) => r.includes('`MORE_ISSUES`'))).toContain('error (reported as a warning when it is warnings that were cut off)');
  });

  it('is valid, tidy markdown: no broken tables, no trailing spaces, never the word "verified"', () => {
    const lines = markdown.split('\n');
    for (const line of lines) expect(line).toBe(line.trimEnd());
    for (const line of lines.filter((l) => l.startsWith('|'))) expect(line.endsWith('|')).toBe(true);
    expect(markdown).not.toMatch(/\bverified\b/i);
    // One fix of the frame checks says what an undeclared slider "reads as undefined"; nowhere else may the word appear.
    expect(markdown.replace('An undeclared slider reads as undefined.', '')).not.toContain('undefined');
    expect(markdown.endsWith('\n')).toBe(true);
    // The fence around the issue shape is closed.
    expect((markdown.match(/^```/gm) ?? []).length % 2).toBe(0);
  });

  it('is the same text on every call', () => {
    expect(issueCatalogMarkdown()).toBe(markdown);
  });
});
