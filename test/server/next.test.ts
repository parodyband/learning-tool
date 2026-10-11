// `next` is the one thing every result must get right: it is how an agent with nothing else in its
// context knows what to do. These tests walk a draft through every stage, and through every kind of
// rejection at every stage, and check the answer each time.
//
// The first part walks a lesson in the scene kinds of lessons made before clips (the example
// draft), which the server still has to steer when it meets one. The second part, "a lesson of
// clips", walks the lesson an agent writes now, with every rejection a clip can meet.
import { describe, expect, it } from 'vitest';
import { AnyScene } from '../../src/core/clip';
import { EXAMPLE_CLIPS } from '../../src/core/clip-examples';
import { ISSUES } from '../../src/core/issues';
import { DEPTHS, LIMITS } from '../../src/core/limits';
import { PlanInput } from '../../src/core/schema';
import type { Draft, Issue, LessonReport } from '../../src/core/types';
import { checkLesson } from '../../src/core/validate';
import { FRAME_ISSUE_CODES, FRAME_ISSUES } from '../../src/frame/check';
import { hasLearnerAction, idleClips, nextStep, progress, TOOL_NAMES, unpredicted, type Outcome, type ToolName } from '../../src/server/next';
import { exampleDraft, exampleStats } from '../helpers/example';
import { LESSON_SCENES } from '../validate/clip-kit';
import { planFor } from './helpers/kit';

/** The example draft cut back to a given point in its life. */
function at(stage: 'started' | 'researching' | 'planned' | 'writing' | 'ready'): Draft {
  const draft = exampleDraft();
  if (stage === 'ready') return draft;
  if (stage === 'writing') return { ...draft, scenes: draft.scenes.slice(0, 3) };
  if (stage === 'planned') return { ...draft, scenes: [] };
  const { title: _title, ...rest } = draft;
  const bare: Draft = { ...rest, objectives: [], outline: [], scenes: [] };
  return stage === 'researching' ? bare : { ...bare, evidence: [] };
}

function published(): Draft {
  const draft = exampleDraft();
  const report = checkLesson(draft);
  expect(report.ok).toBe(true);
  return { ...draft, published: { fileName: 'binary-search-abc123.html', hash: report.hash as string, at: '2026-10-10T12:00:00.000Z' } };
}

const error = (code: string, extra: Partial<Issue> = {}): Issue => ({ code, severity: 'error', path: '', message: `${code} happened.`, fix: `Fix ${code}.`, ...extra });

/** A whole-lesson report that fails with exactly these errors, for a complete draft. */
function failing(draft: Draft, errors: Issue[]): LessonReport {
  const real = checkLesson(draft);
  const { lesson: _lesson, hash: _hash, ...rest } = real;
  return { ...rest, ok: false, errors };
}

describe('stage', () => {
  it.each([
    ['started', at('started')],
    ['researching', at('researching')],
    ['planned', at('planned')],
    ['writing', at('writing')],
    ['ready', at('ready')],
    ['published', published()],
  ] as const)('%s', (stage, draft) => {
    expect(progress(draft).stage).toBe(stage);
  });

  it('lists planned, accepted and pending scenes in outline order', () => {
    const p = progress(at('writing'));
    expect(p.planned).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']);
    expect(p.accepted).toEqual(['s1', 's2', 's3']);
    expect(p.pending).toEqual(['s4', 's5', 's6', 's7', 's8', 's9']);
  });

  it('is "writing", not "ready", when every scene is in but the lesson has an error', () => {
    const draft = exampleDraft();
    expect(progress(draft, failing(draft, [error('LESSON_TOO_LONG')])).stage).toBe('writing');
  });

  it('goes back to "ready" when a published lesson has changed since', () => {
    const draft = published();
    draft.scenes = draft.scenes.map((s) => (s.id === 's1' ? { ...s, title: 'One name in a billion' } : s));
    expect(progress(draft).stage).toBe('ready');
    expect(nextStep(draft)).toMatchObject({ tool: 'publish_lesson' });
    expect(nextStep(draft).why).toContain('changed since it was published');
  });

  it('counts a scene the plan no longer has as neither accepted nor pending', () => {
    const draft = at('writing');
    draft.scenes = [...draft.scenes, { ...draft.scenes[0]!, id: 'gone' }];
    expect(progress(draft).accepted).toEqual(['s1', 's2', 's3']);
  });
});

describe('next, from the state of the draft', () => {
  it('no lesson: start one, after calibrating', () => {
    const next = nextStep(null);
    expect(next.tool).toBe('start_lesson');
    expect(next.why).toMatch(/calibration questions in one message/);
  });

  it('started: research and save evidence', () => {
    expect(nextStep(at('started'))).toMatchObject({ tool: 'save_evidence' });
    expect(nextStep(at('started')).why).toMatch(/your own web search and fetch tools/);
  });

  it('researching with fewer excerpts than the lesson must cite: keep saving, and say how many', () => {
    const draft = at('researching');
    draft.evidence = draft.evidence.slice(0, 2);
    const next = nextStep(draft);
    expect(next.tool).toBe('save_evidence');
    expect(next.why).toContain('2 excerpts are stored');
    expect(next.why).toContain(`at least ${DEPTHS.standard.evidenceMin}`);
  });

  it('researching with enough: plan', () => {
    const next = nextStep(at('researching'));
    expect(next.tool).toBe('plan_lesson');
    expect(next.why).toContain('5 excerpts are stored');
  });

  it('planned: submit the first scene, alone, by name', () => {
    const next = nextStep(at('planned'));
    expect(next.tool).toBe('submit_scene');
    expect(next.why).toContain('"s1"');
    expect(next.why).toMatch(/alone/);
  });

  it('planned with no evidence at all: research before writing', () => {
    const draft = { ...at('planned'), evidence: [] };
    expect(nextStep(draft)).toMatchObject({ tool: 'save_evidence' });
  });

  it('writing: submit what is pending, by id, with the count', () => {
    const next = nextStep(at('writing'));
    expect(next.tool).toBe('submit_scene');
    expect(next.why).toContain('3 of 9 scenes are accepted');
    expect(next.why).toContain('s4, s5, s6, s7, s8, s9');
    expect(next.why).toContain('in parallel');
  });

  it('writing with one scene left does not talk about parallel calls', () => {
    const draft = exampleDraft();
    draft.scenes = draft.scenes.filter((s) => s.id !== 's9');
    const next = nextStep(draft);
    expect(next.why).toContain('Still to submit: s9.');
    expect(next.why).not.toContain('parallel');
  });

  it('ready: publish', () => {
    expect(nextStep(at('ready'))).toMatchObject({ tool: 'publish_lesson' });
  });

  it('published: reply with the file first, then the link, and do not summarise', () => {
    const next = nextStep(published());
    expect(next.tool).toBe('reply');
    // The file always works; the local link only while the app that serves it is open.
    expect(next.why).toMatch(/the file, which always works, then the local link/);
    expect(next.why.indexOf('file')).toBeLessThan(next.why.indexOf('local link'));
    expect(next.why).toMatch(/Do not summarise/);
  });

  it('published, but the file has gone: publish again, which writes it', () => {
    // Before, this was "reply: give the learner the link" to a file that was not there.
    const next = nextStep(published(), { tool: 'get_lesson', fileMissing: true });
    expect(next.tool).toBe('publish_lesson');
    expect(next.why).toMatch(/its file is no longer in the Learning Tool folder/);
    // A missing file changes nothing for a lesson that is not published as it stands.
    expect(nextStep(at('writing'), { fileMissing: true })).toEqual(nextStep(at('writing')));
    expect(nextStep(at('ready'), { fileMissing: true })).toEqual(nextStep(at('ready')));
  });
});

describe('next, when every scene is in but the lesson does not pass', () => {
  const draft = exampleDraft();
  const from = (errors: Issue[]) => nextStep(draft, { report: failing(draft, errors) });

  it('an error in a scene: fix and resubmit that scene', () => {
    const next = from([error('NUMBER_NOT_IN_SOURCE', { sceneId: 's5', path: 'blocks[1].text' }), error('CLAIM_UNRELATED', { sceneId: 's7' }), error('QUOTE_NOT_FOUND', { sceneId: 's7' })]);
    expect(next.tool).toBe('submit_scene');
    expect(next.why).toContain('3 errors block publishing');
    expect(next.why).toContain('s5, s7');
  });

  it.each(['NARRATION_RUN', 'PASSIVE_RUN', 'NO_FIGURE', 'OBJECTIVE_UNASSESSED', 'PLAN_GRADED_SHARE', 'PLAN_LAST_SCENE'])('%s is about the outline: plan again', (code) => {
    // (PASSIVE_RUN here is on the example draft, whose step-through has its predict: nothing short of another outline helps.)
    const next = from([error('LESSON_TOO_LONG'), error(code)]);
    expect(next.tool).toBe('plan_lesson');
    expect(next.why).toContain(code);
  });

  describe('PASSIVE_RUN on a plan that was accepted', () => {
    // The outline with the first checkpoint moved back, and the step-through written without its predict.
    const passive = (): Draft => {
      const d = exampleDraft();
      const o = d.outline;
      d.outline = [o[0]!, o[1]!, o[2]!, o[6]!, o[3]!, o[4]!, o[5]!, o[7]!, o[8]!];
      d.scenes = d.scenes.map((s) => (s.kind === 'step_through' ? { ...s, steps: s.steps.map(({ predict: _predict, ...step }) => step) } : s));
      return d;
    };

    it('is settled in the step-through that lacks a predict: resubmit that scene', () => {
      // Before: next was plan_lesson, and sending the accepted plan again answered plan_lesson again, for ever.
      const d = passive();
      const report = checkLesson(d);
      expect(report.errors.map((e) => e.code)).toEqual(['PASSIVE_RUN']);
      expect(unpredicted(d)).toEqual([{ id: 's3', kind: 'step_through' }]);
      const next = nextStep(d, { tool: 'submit_scene', report, errorsAt: 'lessonReport.errors' });
      expect(next.tool).toBe('submit_scene');
      expect(next.why).toContain('Fix and resubmit s3.');
      expect(next.why).toContain('PASSIVE_RUN needs a "predict" on one step of "s3"; the plan can stay as it is.');
      // After the plan tool, too: the plan it just stored is not the thing to change.
      expect(nextStep(d, { tool: 'plan_lesson', report }).tool).toBe('submit_scene');
    });

    it('with other scene errors beside it, names every scene to resubmit once', () => {
      const d = passive();
      const report = failing(d, [error('PASSIVE_RUN'), error('CLAIM_UNRELATED', { sceneId: 's7' }), error('NUMBER_NOT_IN_SOURCE', { sceneId: 's3' })]);
      const next = nextStep(d, { report });
      expect(next.tool).toBe('submit_scene');
      expect(next.why).toContain('3 errors block publishing');
      expect(next.why).toContain('Fix and resubmit s7, s3.');
    });

    it('an outline error beside it still comes first', () => {
      const d = passive();
      expect(nextStep(d, { report: failing(d, [error('PASSIVE_RUN'), error('NO_FIGURE')]) }).tool).toBe('plan_lesson');
    });
  });

  describe('where the error is', () => {
    // Before: 'Follow its "fix" in errors', on results whose "errors" was empty.
    it.each(['errors', 'lessonReport.errors', 'outstanding.errors', 'lessonErrors'])('names "%s" when the result shows the errors there', (errorsAt) => {
      for (const errors of [[error('NO_FIGURE')], [error('EVIDENCE_OVERUSED')], [error('CLAIM_UNRELATED', { sceneId: 's7' })], [error('UNCITED_SHARE')]]) {
        const next = nextStep(draft, { report: failing(draft, errors), errorsAt });
        expect(next.why).toContain(`"${errorsAt}" has each error with its "fix"`);
      }
    });

    it('sends the agent to validate_lesson when the result at hand shows none', () => {
      for (const errors of [[error('NO_FIGURE')], [error('EVIDENCE_OVERUSED')], [error('CLAIM_UNRELATED', { sceneId: 's7' })], [error('UNCITED_SHARE')]]) {
        const next = nextStep(draft, { report: failing(draft, errors) });
        expect(next.why).toContain('validate_lesson lists each error with its "fix"');
        expect(next.why).not.toMatch(/in errors\b/);
      }
    });

    it('after plan_lesson stored a plan that still has the outline error, says that this plan has it', () => {
      const next = nextStep(draft, { tool: 'plan_lesson', report: failing(draft, [error('NO_FIGURE')]), errorsAt: 'lessonErrors' });
      expect(next.tool).toBe('plan_lesson');
      expect(next.why).toMatch(/^The plan is stored, but 1 error blocks publishing and this plan still has NO_FIGURE/);
    });
  });

  it.each(['EVIDENCE_OVERUSED', 'EVIDENCE_URL'])('%s needs other passages: save evidence', (code) => {
    const next = from([error(code)]);
    expect(next.tool).toBe('save_evidence');
    expect(next.why).toContain(code);
  });

  it('too few cited excerpts, with unused ones stored: cite them', () => {
    const report = failing(draft, [error('EVIDENCE_TOO_FEW')]);
    report.stats = { ...report.stats, sources: 3 };
    expect(nextStep(draft, { report }).tool).toBe('submit_scene');
  });

  it('too few cited excerpts, with nothing spare: research more', () => {
    const report = failing(draft, [error('EVIDENCE_TOO_FEW')]);
    report.stats = { ...report.stats, sources: draft.evidence.length };
    expect(nextStep(draft, { report }).tool).toBe('save_evidence');
  });

  it('a lesson-wide error with no scene: resubmit what the fix names', () => {
    const next = from([error('UNCITED_SHARE')]);
    expect(next.tool).toBe('submit_scene');
    expect(next.why).toContain('UNCITED_SHARE');
  });

  it('a damaged stored plan (a shape error with no scene): plan again', () => {
    expect(from([error('MISSING_FIELD', { path: 'outline[2].purpose' })]).tool).toBe('plan_lesson');
  });

  it('the plan outranks evidence, and evidence outranks scenes', () => {
    expect(from([error('CLAIM_UNRELATED', { sceneId: 's1' }), error('EVIDENCE_OVERUSED'), error('NO_FIGURE')]).tool).toBe('plan_lesson');
    expect(from([error('CLAIM_UNRELATED', { sceneId: 's1' }), error('EVIDENCE_OVERUSED')]).tool).toBe('save_evidence');
  });

  it('with a real failing report from the validator', () => {
    const broken = exampleDraft();
    broken.scenes = broken.scenes.map((s) => (s.id === 's5' && s.kind === 'narration' ? { ...s, blocks: [{ type: 'claim' as const, text: 'A linear search may check all 73 of the elements.', cites: ['e5'] }, ...s.blocks.slice(1)] } : s));
    const report = checkLesson(broken);
    expect(report.errors.map((e) => e.code)).toContain('NUMBER_NOT_IN_SOURCE');
    const next = nextStep(broken);
    expect(next.tool).toBe('submit_scene');
    expect(next.why).toContain('s5');
    expect(progress(broken).stage).toBe('writing');
  });
});

describe('next, after a rejected call', () => {
  const rejected = (tool: ToolName, errors: Issue[] = [error('MISSING_FIELD', { path: 'x' })], extra: Outcome = {}): Outcome => ({ tool, rejected: errors, ...extra });

  it('start_lesson: call it again', () => {
    const next = nextStep(null, rejected('start_lesson'));
    expect(next.tool).toBe('start_lesson');
    expect(next.why).toMatch(/No lesson was started/);
  });

  describe('save_evidence, the one tool whose rejected call may have stored something', () => {
    // Before, one sentence served every case: "Items without an error were saved", also when nothing was.
    const bad = [error('EVIDENCE_URL', { path: 'items[1].url' })];

    it('some items saved: says how many, and which to send again', () => {
      const next = nextStep(at('researching'), rejected('save_evidence', bad, { evidence: { saved: 3, refused: [1, 4] } }));
      expect(next.tool).toBe('save_evidence');
      expect(next.why).toBe('3 items were saved and must not be sent again ("items" has the ids). Correct items[1], items[4] as each error\'s "fix" says and send only those items again.');
      const one = nextStep(at('researching'), rejected('save_evidence', bad, { evidence: { saved: 1, refused: [1] } }));
      expect(one.why).toBe('1 item was saved and must not be sent again ("items" has the ids). Correct items[1] as each error\'s "fix" says and send only that item again.');
    });

    it('every item refused: nothing was saved', () => {
      const next = nextStep(at('started'), rejected('save_evidence', bad, { evidence: { saved: 0, refused: [0, 1] } }));
      expect(next.why).toMatch(/^Nothing was saved from this call: every item was refused\./);
      expect(next.why).toContain('items[0], items[1]');
    });

    it('the call refused as a whole (too many items, "items" not a list, a misspelt argument): nothing was saved', () => {
      for (const errors of [[error('TOO_MANY', { path: 'items' })], [error('WRONG_TYPE', { path: 'items' })], [error('MISSING_FIELD', { path: 'items' })], [error('UNKNOWN_FIELD', { path: 'itmes' })]]) {
        const next = nextStep(at('researching'), rejected('save_evidence', errors));
        expect(next.tool).toBe('save_evidence');
        expect(next.why).toMatch(/^Nothing was saved from this call\./);
        expect(next.why).not.toMatch(/items? (was|were) saved/);
      }
    });
  });

  it('plan_lesson, first plan: nothing was stored', () => {
    const next = nextStep(at('researching'), rejected('plan_lesson', [error('PLAN_FIRST_SCENE')]));
    expect(next.tool).toBe('plan_lesson');
    expect(next.why).toMatch(/The plan was not stored\./);
  });

  it('plan_lesson, replacing a plan: the earlier one still stands', () => {
    const next = nextStep(at('writing'), rejected('plan_lesson', [error('PLAN_FIRST_SCENE')]));
    expect(next.tool).toBe('plan_lesson');
    expect(next.why).toContain('the earlier plan still stands');
  });

  it('submit_scene: the same scene again, under the same id', () => {
    const next = nextStep(at('writing'), rejected('submit_scene', [error('QUOTE_NOT_FOUND', { sceneId: 's4' })], { sceneId: 's4' }));
    expect(next.tool).toBe('submit_scene');
    expect(next.why).toContain('"s4" was not stored');
    expect(next.why).toContain('same id');
  });

  it('submit_scene before there is a plan: plan first', () => {
    const next = nextStep(at('researching'), rejected('submit_scene', [error('NO_PLAN')]));
    expect(next.tool).toBe('plan_lesson');
  });

  it.each(['validate_lesson', 'publish_lesson', 'get_lesson', 'get_guide'] as const)('%s with bad arguments: the same tool again', (tool) => {
    expect(nextStep(at('writing'), rejected(tool))).toMatchObject({ tool });
    expect(nextStep(null, rejected(tool))).toMatchObject({ tool });
  });

  it('a lessonId that cannot be used: find the lesson', () => {
    const next = nextStep(null, { tool: 'submit_scene', rejected: [error('LESSON_NOT_FOUND', { path: 'lessonId' })], missing: true });
    expect(next.tool).toBe('get_lesson');
    expect(next.why).toMatch(/no arguments/);
  });

  it('the server itself failed: tell the learner, and do not improvise', () => {
    for (const draft of [null, at('writing')]) {
      const next = nextStep(draft, { tool: 'publish_lesson', failed: true });
      expect(next.tool).toBe('reply');
      expect(next.why).toMatch(/Do not write the lesson by any other means/);
    }
  });

  it('a refused publish is not a rejected call: next comes from the lesson', () => {
    const draft = at('writing');
    expect(nextStep(draft, { tool: 'publish_lesson', report: checkLesson(draft) })).toMatchObject({ tool: 'submit_scene' });
    expect(nextStep(at('researching'), { tool: 'publish_lesson' })).toMatchObject({ tool: 'plan_lesson' });
  });
});

describe('next, without a lesson', () => {
  it('a listing that found lessons: look at one', () => {
    expect(nextStep(null, { tool: 'get_lesson', listed: 3 })).toMatchObject({ tool: 'get_lesson' });
  });
  it('a listing that found none: start one', () => {
    expect(nextStep(null, { tool: 'get_lesson', listed: 0 })).toMatchObject({ tool: 'start_lesson' });
  });
  it('after reading the guide: carry on, or start', () => {
    const next = nextStep(null, { tool: 'get_guide' });
    expect(next.tool).toBe('start_lesson');
    expect(next.why).toMatch(/carry on/);
  });
});

describe('every stage with every outcome', () => {
  const drafts: [string, Draft | null][] = [
    ['no lesson', null],
    ['started', at('started')],
    ['researching', at('researching')],
    ['planned', at('planned')],
    ['writing', at('writing')],
    ['ready', at('ready')],
    ['published', published()],
  ];
  const outcomes: [string, Outcome][] = [
    ['plain', {}],
    ...TOOL_NAMES.map((tool): [string, Outcome] => [`after ${tool}`, { tool }]),
    ...TOOL_NAMES.map((tool): [string, Outcome] => [`${tool} rejected`, { tool, rejected: [error('BAD_VALUE', { path: 'x' })] }]),
    ['missing', { tool: 'get_lesson', missing: true, rejected: [error('LESSON_NOT_FOUND')] }],
    ['failed', { tool: 'publish_lesson', failed: true }],
    ['evidence partly saved', { tool: 'save_evidence', rejected: [error('EVIDENCE_URL', { path: 'items[0].url' })], evidence: { saved: 2, refused: [0] } }],
    ['evidence all refused', { tool: 'save_evidence', rejected: [error('EVIDENCE_URL', { path: 'items[0].url' })], evidence: { saved: 0, refused: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] } }],
    ...TOOL_NAMES.map((tool): [string, Outcome] => [`${tool}, published file missing`, { tool, fileMissing: true }]),
    ...['errors', 'lessonReport.errors', 'outstanding.errors', 'lessonErrors'].map((errorsAt): [string, Outcome] => [`errors shown in ${errorsAt}`, { tool: 'validate_lesson', errorsAt }]),
  ];

  it.each(drafts)('%s: always names a tool that exists, with a reason, and never throws', (_name, draft) => {
    for (const [, outcome] of outcomes) {
      const next = nextStep(draft, outcome);
      expect([...TOOL_NAMES, 'reply']).toContain(next.tool);
      expect(next.why.length).toBeGreaterThan(30);
      expect(next.why.length).toBeLessThan(400);
      // The same question has the same answer.
      expect(nextStep(draft, outcome)).toEqual(next);
    }
  });

  it('a rejected call is answered with the tool to call again, at every stage', () => {
    for (const [, draft] of drafts) {
      for (const tool of TOOL_NAMES) {
        const next = nextStep(draft, { tool, rejected: [error('BAD_VALUE', { path: 'x' })] });
        expect(next.tool).toBe(tool);
      }
    }
  });

  it('tolerates a draft whose lists are damaged', () => {
    const damaged = { ...exampleDraft(), outline: 'nope', scenes: null, evidence: undefined } as unknown as Draft;
    expect(progress(damaged).stage).toBe('started');
    expect(nextStep(damaged).tool).toBe('save_evidence');
    expect(unpredicted(damaged)).toEqual([]);
    expect(unpredicted({ ...exampleDraft(), scenes: [null, 7, { id: 's3', kind: 'step_through', steps: 'nope' }] } as unknown as Draft)).toEqual([]);
    expect(unpredicted({ ...exampleDraft(), scenes: [{ id: 's3', kind: 'clip', beats: 'nope' }, { id: 's1', kind: 'clip' }] } as unknown as Draft)).toEqual([]);
  });

  it('only a published lesson is ever told its file is missing, and then at every stage the answer is a tool that exists', () => {
    for (const [name, draft] of drafts) {
      const next = nextStep(draft, { tool: 'get_lesson', fileMissing: true });
      expect(next.tool, name).toBe(name === 'published' ? 'publish_lesson' : nextStep(draft, { tool: 'get_lesson' }).tool);
    }
  });
});

describe('scenes that leave a stretch with nothing to do', () => {
  type Kind = 'narration' | 'step_through' | 'checkpoint' | 'recap' | 'clip';
  /**
   * A draft with this outline. k is a clip, s a step-through, n a narration, c a checkpoint, r the
   * recap. A clip or step-through marked "+" is stored with a prediction (a gate on a beat, a
   * predict on a step), "-" stored without one, "?" not stored yet. A clip marked "x" is stored
   * with an explore and no gate.
   */
  const draftOf = (spec: string): Draft => {
    const kinds: Record<string, Kind> = { n: 'narration', s: 'step_through', c: 'checkpoint', r: 'recap', k: 'clip' };
    const entries = spec.split(' ').map((token, i) => ({ id: `x${i + 1}`, kind: kinds[token[0]!]!, mark: token[1] ?? '' }));
    const body = (kind: Kind, mark: string): Record<string, unknown> => {
      if (kind === 'step_through') return { steps: [{ blocks: [] }, mark === '+' ? { blocks: [], predict: {} } : { blocks: [] }] };
      if (kind === 'clip') return { beats: [{ caption: {} }, mark === '+' ? { caption: {}, gate: {} } : { caption: {} }], ...(mark === 'x' ? { explore: { prompt: 'p', controls: [] } } : {}) };
      return {};
    };
    return {
      ...exampleDraft(),
      outline: entries.map(({ id, kind }) => ({ id, kind, purpose: 'p' })),
      scenes: entries.filter((e) => e.mark !== '?').map(({ id, kind, mark }) => ({ id, kind, ...body(kind, mark) })),
    } as unknown as Draft;
  };
  const ids = (draft: Draft, options?: { pendingPredict?: boolean }): string[] => unpredicted(draft, options).map((scene) => scene.id);

  it.each([
    ['n n s- n c r', ['x3'], 'four in a row, the step-through among them has no predict'],
    ['n n s+ n c r', [], 'the same with its predict'],
    ['n n s- c n r', [], 'three in a row is allowed'],
    ['n s- n s- n c r', ['x2', 'x4'], 'two step-throughs without a predict in one stretch'],
    ['n s+ n s- n n c r', ['x4'], 'only the one in the stretch that is too long'],
    ['n c n n s- n', ['x5'], 'a stretch that runs to the end'],
    ['n n n n c r', [], 'no step-through at all: nothing to add a predict to'],
    // The same rule for clips, where the prediction is a gate on a beat.
    ['k- k- k- c k- r', [], 'three clips in a row is allowed, gate or no gate'],
    ['k- k- k- k- c r', ['x1', 'x2', 'x3', 'x4'], 'four clips in a row and not one gate: any of them can take it'],
    ['k- k+ k- k- c r', [], 'one gate among the four breaks the stretch'],
    ['k- k- k- k+ k- k- k- k- c r', ['x5', 'x6', 'x7', 'x8'], 'only the stretch that is too long'],
    ['k+ c k- k- k- k- r', ['x3', 'x4', 'x5', 'x6'], 'the recap ends the lesson, and counts in the stretch'],
    ['k- k- c k- k- k- r', ['x4', 'x5', 'x6'], 'three clips and the recap make four with nothing to do'],
    // An explore is something to do, as a gate is.
    ['k- kx k- k- c r', [], 'an explore among the four breaks the stretch'],
    ['k- k- k- k- kx c r', ['x1', 'x2', 'x3', 'x4'], 'an explore after the stretch does not shorten it'],
  ])('%s -> %j (%s)', (spec, expected) => {
    expect(ids(draftOf(spec))).toEqual(expected);
  });

  it('says which kind of scene lacks the prediction, because the field to add differs', () => {
    expect(unpredicted(draftOf('k- s- n n c r'))).toEqual([
      { id: 'x1', kind: 'clip' },
      { id: 'x2', kind: 'step_through' },
    ]);
  });

  it('reads scenes not yet stored at their best when asked to, so a warning is only given for what is certain', () => {
    // x3 is stored without a predict. x5, another step-through, is still to come.
    const waiting = draftOf('n n s- n s? n c r');
    expect(ids(waiting)).toEqual(['x3']);
    expect(ids(waiting, { pendingPredict: true })).toEqual(['x3']);
    // Here the pending step-through, if it gets a predict, breaks the stretch into pieces that are short enough.
    const saved = draftOf('n s- s? n c r');
    expect(ids(saved)).toEqual(['x2']);
    expect(ids(saved, { pendingPredict: true })).toEqual([]);
    // Clips: with three stored without a gate and a fourth to come, nothing is certain yet. Once the fourth is in without one, it is.
    const clips = draftOf('k- k- k- k? c r');
    expect(ids(clips, { pendingPredict: true })).toEqual([]);
    expect(ids(draftOf('k- k- k- k- c r'), { pendingPredict: true })).toEqual(['x1', 'x2', 'x3', 'x4']);
  });

  it('agrees with the validator about which lessons of clips fail PASSIVE_RUN', () => {
    // The stretch c1, c2, c3 of the clip example is three long. Moving the first checkpoint behind c4 makes it four.
    const example = clipDraft();
    expect(checkLesson(example).errors.map((e) => e.code)).not.toContain('PASSIVE_RUN');
    expect(unpredicted(example)).toEqual([]);
    const gateless = (draft: Draft, only: string[]): Draft => ({
      ...draft,
      scenes: draft.scenes.map((scene) => (scene.kind === 'clip' && only.includes(scene.id) ? { ...scene, beats: scene.beats.map(({ gate: _gate, ...beat }) => beat) } : scene)),
    });
    // The clips of that stretch that carry a gate in the lesson as the tests have it.
    const gated = example.scenes.flatMap((scene) => (scene.kind === 'clip' && ['c1', 'c2', 'c3', 'c4'].includes(scene.id) && scene.beats.some((beat) => beat.gate !== undefined) ? [scene.id] : []));
    expect(gated).toEqual(['c2', 'c3', 'c4']);
    const moved = (draft: Draft): Draft => {
      const o = draft.outline;
      // c1 c2 c3 c4 q1 c5 q2 c6 q3 end
      return { ...draft, outline: [o[0]!, o[1]!, o[2]!, o[4]!, o[3]!, o[5]!, o[6]!, o[7]!, o[8]!, o[9]!] };
    };
    // With its gates, the longer stretch still passes.
    const withGates = moved(example);
    expect(checkLesson(withGates).errors.map((e) => e.code)).not.toContain('PASSIVE_RUN');
    expect(unpredicted(withGates)).toEqual([]);
    // Without them it fails, and the scenes named are the clips of that stretch.
    const without = gateless(moved(example), gated);
    expect(checkLesson(without).errors.map((e) => e.code)).toContain('PASSIVE_RUN');
    expect(unpredicted(without).map((scene) => scene.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    // One gate left in the stretch and the two agree again: no passive run, nothing named.
    const one = gateless(moved(example), gated.slice(1));
    expect(checkLesson(one).errors.map((e) => e.code)).not.toContain('PASSIVE_RUN');
    expect(unpredicted(one)).toEqual([]);
  });

  it('agrees with the validator about which clips have nothing for the learner to do', () => {
    const example = clipDraft();
    expect(idleClips(example)).toEqual(['c1', 'c6']);
    expect(checkLesson(example).errors).toEqual([]);
    // Take the gate from c2: three clips in six ask something, and the validator names the three that do not.
    const fewer: Draft = { ...example, scenes: example.scenes.map((scene) => (scene.kind === 'clip' && scene.id === 'c2' ? { ...scene, beats: scene.beats.map(({ gate: _gate, ...beat }) => beat) } : scene)) };
    expect(idleClips(fewer)).toEqual(['c1', 'c2', 'c6']);
    const errors = checkLesson(fewer).errors;
    expect(errors.map((e) => e.code)).toEqual(['INTERACTIVE_SHARE']);
    expect(errors[0]!.message).toMatch(/Without one: c1, c2, c6\.$/);
    // An explore counts: c5 has no gate and is not among them. Take the explore away and it is.
    const noExplore: Draft = { ...example, scenes: example.scenes.map((scene) => (scene.kind === 'clip' && scene.id === 'c5' ? (({ explore: _explore, ...rest }) => rest)(scene) as typeof scene : scene)) };
    expect(idleClips(noExplore)).toEqual(['c1', 'c5', 'c6']);
    // Scenes that are not stored, and scenes that are not clips, are never named.
    expect(idleClips({ ...example, scenes: example.scenes.filter((scene) => scene.id !== 'c1') })).toEqual(['c6']);
    expect(idleClips(exampleDraft())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// A lesson of clips
// ---------------------------------------------------------------------------------------------

/**
 * The clip example as a draft with every scene accepted: six clips, three checkpoints, the recap.
 * Its scenes are LESSON_SCENES: the example with the learner actions the interactivity rules ask
 * for (see test/validate/clip-kit.ts). c2, c3 and c4 carry a gate, c5 an explore; c1 and c6 neither.
 */
function clipDraft(): Draft {
  const plan = PlanInput.parse(planFor(LESSON_SCENES));
  return { ...exampleDraft(), title: plan.title, objectives: plan.objectives, outline: plan.outline, scenes: LESSON_SCENES.map((scene) => AnyScene.parse(scene)) };
}

/** The clip draft cut back to a given point in its life. */
function clipAt(stage: 'started' | 'researching' | 'planned' | 'writing' | 'complete'): Draft {
  const draft = clipDraft();
  if (stage === 'complete') return draft;
  if (stage === 'writing') return { ...draft, scenes: draft.scenes.slice(0, 3) };
  if (stage === 'planned') return { ...draft, scenes: [] };
  const { title: _title, ...rest } = draft;
  const bare: Draft = { ...rest, objectives: [], outline: [], scenes: [] };
  return stage === 'researching' ? bare : { ...bare, evidence: [] };
}

const HASH = 'c'.repeat(64);
/** A whole-lesson report for a complete draft, written by hand so that these tests ask nothing of the validator. */
const reportOf = (errors: Issue[] = []): LessonReport => ({ ok: errors.length === 0, complete: true, pending: [], errors, warnings: [], stats: { ...exampleStats(), scenes: 10 }, weakClaims: [], ...(errors.length === 0 ? { hash: HASH } : {}) });

describe('a lesson of clips: next, at every stage', () => {
  it.each([
    ['started', clipAt('started'), {}, 'started', 'save_evidence', /Research the topic with your own web search and fetch tools/],
    ['researching', clipAt('researching'), {}, 'researching', 'plan_lesson', /5 excerpts are stored\. Plan the objectives and the outline/],
    ['planned', clipAt('planned'), {}, 'planned', 'submit_scene', /Submit the first scene \("c1"\) alone and read the result/],
    ['writing', clipAt('writing'), {}, 'writing', 'submit_scene', /3 of 10 scenes are accepted\. Still to submit: q1, c4, c5, q2, c6, q3, end \(in parallel if your host allows\)\./],
    ['every scene in and passing', clipAt('complete'), { report: reportOf() }, 'ready', 'publish_lesson', /Every scene is accepted and the lesson passes every check/],
    ['published', { ...clipAt('complete'), published: { fileName: 'binary-search-abc123.html', hash: HASH, at: '2026-10-11T12:00:00.000Z' } }, { report: reportOf() }, 'published', 'reply', /the file, which always works, then the local link/],
    ['published, then a clip was changed', { ...clipAt('complete'), published: { fileName: 'binary-search-abc123.html', hash: 'd'.repeat(64), at: '2026-10-11T12:00:00.000Z' } }, { report: reportOf() }, 'ready', 'publish_lesson', /changed since it was published/],
  ] as [string, Draft, Outcome, string, string, RegExp][])('%s', (_name, draft, outcome, stage, tool, why) => {
    expect(progress(draft, outcome.report).stage).toBe(stage);
    const next = nextStep(draft, outcome);
    expect(next.tool).toBe(tool);
    expect(next.why).toMatch(why);
  });

  it('the stages list the scenes of a clip lesson in outline order', () => {
    const p = progress(clipAt('writing'));
    expect(p.planned).toEqual(['c1', 'c2', 'c3', 'q1', 'c4', 'c5', 'q2', 'c6', 'q3', 'end']);
    expect(p.accepted).toEqual(['c1', 'c2', 'c3']);
  });

  it('with the real validator: the complete clip example is ready, and published once its hash is recorded', () => {
    const draft = clipAt('complete');
    const report = checkLesson(draft);
    expect(report.errors).toEqual([]);
    expect(progress(draft).stage).toBe('ready');
    expect(nextStep(draft).tool).toBe('publish_lesson');
    const published: Draft = { ...draft, published: { fileName: 'binary-search-abc123.html', hash: report.hash as string, at: '2026-10-11T12:00:00.000Z' } };
    expect(progress(published).stage).toBe('published');
    expect(nextStep(published).tool).toBe('reply');
  });
});

describe('a lesson of clips: next, when every scene is in but the lesson does not pass', () => {
  const draft = clipAt('complete');
  const from = (errors: Issue[], extra: Outcome = {}) => nextStep(draft, { report: reportOf(errors), ...extra });
  /** The codes about how a clip is put together, from the validator's own catalog. */
  const clipCodes = Object.entries(ISSUES as Record<string, { group: string; severity: string }>)
    .filter(([, entry]) => entry.group === 'clips' && entry.severity === 'error')
    .map(([code]) => code);
  const frameErrors = FRAME_ISSUE_CODES.filter((code) => FRAME_ISSUES[code].severity === 'error');

  it('the catalog has the codes these tests walk through', () => {
    // If the validator renames a group, the tables below would be empty and prove nothing.
    expect(clipCodes).toEqual(expect.arrayContaining(['STAGE_UNKNOWN_REF', 'ACTION_UNKNOWN_PART', 'ACTION_VERB_NOT_ALLOWED', 'CLIP_TOO_STATIC', 'GATE_ON_FIRST_BEAT', 'BEAT_FIELD_NOT_ALLOWED']));
    expect(frameErrors).toEqual(expect.arrayContaining(['FRAME_SYNTAX', 'FRAME_BANNED', 'FRAME_NO_RENDER', 'FRAME_BEAT_TIME']));
    for (const code of frameErrors) expect(Object.hasOwn(ISSUES, code), code).toBe(true);
  });

  it.each([...clipCodes, ...frameErrors, 'WORDS_OVER_BUDGET', 'NUMBER_NOT_IN_SOURCE', 'CITE_UNKNOWN'])('%s in a clip: fix and resubmit that clip', (code) => {
    const next = from([error(code, { sceneId: 'c3', path: 'beats[2].do[0].target' })], { errorsAt: 'lessonReport.errors' });
    expect(next.tool).toBe('submit_scene');
    expect(next.why).toBe('Every scene is accepted, but 1 error blocks publishing: "lessonReport.errors" has each error with its "fix". Fix and resubmit c3.');
  });

  it('errors in several clips: each scene is named once', () => {
    const next = from([error('ACTION_UNKNOWN_PART', { sceneId: 'c3' }), error('FRAME_SYNTAX', { sceneId: 'c5' }), error('ACTION_TARGET', { sceneId: 'c3' }), error('CLIP_TOO_STATIC', { sceneId: 'c2' })]);
    expect(next.tool).toBe('submit_scene');
    expect(next.why).toContain('4 errors block publishing');
    expect(next.why).toContain('Fix and resubmit c3, c5, c2.');
  });

  it.each(['PLAN_CLIP_STAGE', 'PLAN_TOO_MANY_FRAMES', 'PLAN_FIRST_SCENE', 'PLAN_LEGACY_KIND', 'NO_FIGURE', 'OBJECTIVE_UNASSESSED'])('%s is about the outline: plan again', (code) => {
    const next = from([error('ACTION_UNKNOWN_PART', { sceneId: 'c3' }), error(code)]);
    expect(next.tool).toBe('plan_lesson');
    expect(next.why).toContain(`${code} is about the outline`);
  });

  describe('PASSIVE_RUN, in a plan that was accepted', () => {
    const without = (d: Draft, ids: string[]): Draft => ({
      ...d,
      scenes: d.scenes.map((scene) => {
        if (scene.kind !== 'clip' || !ids.includes(scene.id)) return scene;
        const { explore: _explore, ...rest } = scene;
        return { ...rest, beats: scene.beats.map(({ gate: _gate, ...beat }) => beat) } as typeof scene;
      }),
    });
    /** c1 c2 c3 c4 q1 c5 q2 c6 q3 end: four clips before the first checkpoint. */
    const stretched = (): Draft => {
      const d = clipDraft();
      const o = d.outline;
      return { ...d, outline: [o[0]!, o[1]!, o[2]!, o[4]!, o[3]!, o[5]!, o[6]!, o[7]!, o[8]!, o[9]!] };
    };

    it('several clips could take the prediction: any one of them, and the plan can stay', () => {
      const d = without(stretched(), ['c2', 'c3', 'c4']);
      const next = nextStep(d, { tool: 'submit_scene', report: reportOf([error('PASSIVE_RUN')]), errorsAt: 'lessonReport.errors' });
      expect(next.tool).toBe('submit_scene');
      expect(next.why).toBe(
        'Every scene is accepted, but 1 error blocks publishing: "lessonReport.errors" has each error with its "fix". PASSIVE_RUN needs a "gate" on a beat that shows an outcome (or an "explore"), in one of "c1", "c2", "c3", "c4"; the plan can stay as it is.',
      );
      // After the plan tool, too: the plan it just stored is not the thing to change.
      expect(nextStep(d, { tool: 'plan_lesson', report: reportOf([error('PASSIVE_RUN')]) }).tool).toBe('submit_scene');
    });

    it('one clip could take it: that clip is the scene to resubmit', () => {
      // c1 c2 q1 c3 x x x: make the only gateless clip in a long stretch a single one by storing the others as checkpoints would not do; use a hand-built outline instead.
      const d = { ...clipDraft() };
      d.outline = [
        { id: 'c1', kind: 'clip', purpose: 'p', stage: 'words' },
        { id: 'n1', kind: 'narration', purpose: 'p' },
        { id: 'n2', kind: 'narration', purpose: 'p' },
        { id: 'n3', kind: 'narration', purpose: 'p' },
        { id: 'end', kind: 'recap', purpose: 'p' },
      ];
      d.scenes = [...d.scenes.filter((scene) => scene.id === 'c1' || scene.id === 'end'), ...['n1', 'n2', 'n3'].map((id) => ({ id, kind: 'narration', title: 't', blocks: [] }) as unknown as Draft['scenes'][number])];
      const next = nextStep(d, { report: reportOf([error('PASSIVE_RUN')]) });
      expect(next.tool).toBe('submit_scene');
      expect(next.why).toContain('Fix and resubmit c1.');
      expect(next.why).toContain('PASSIVE_RUN needs a "gate" on the beat of "c1" that shows an outcome (or an "explore" after its last beat); the plan can stay as it is.');
    });

    it('with clip errors beside it, the scenes with errors are named, and the gate is asked for separately', () => {
      const d = without(stretched(), ['c2', 'c3', 'c4']);
      const next = nextStep(d, { report: reportOf([error('PASSIVE_RUN'), error('ACTION_UNKNOWN_PART', { sceneId: 'c6' })]) });
      expect(next.tool).toBe('submit_scene');
      expect(next.why).toContain('2 errors block publishing');
      expect(next.why).toContain('Fix and resubmit c6. PASSIVE_RUN needs a "gate" on a beat that shows an outcome (or an "explore"), in one of "c1", "c2", "c3", "c4"');
    });

    it('an outline error beside it still comes first', () => {
      const d = without(stretched(), ['c2', 'c3', 'c4']);
      expect(nextStep(d, { report: reportOf([error('PASSIVE_RUN'), error('PLAN_TOO_MANY_FRAMES')]) }).tool).toBe('plan_lesson');
    });

    it('when every clip of the lesson has its gate, only another outline helps', () => {
      // The example as it is: PASSIVE_RUN could then only come from a stretch that holds no clip to add a gate to.
      const d = clipDraft();
      expect(unpredicted(d)).toEqual([]);
      const next = nextStep(d, { report: reportOf([error('PASSIVE_RUN')]) });
      expect(next.tool).toBe('plan_lesson');
      expect(next.why).toContain('PASSIVE_RUN is about the outline');
    });

    it('an explore settles a passive run as a gate does: a clip that has one is not asked for a gate', () => {
      // c5 has an explore and no gate. In a stretch with three idle clips it is what keeps the stretch from being passive.
      const d = clipDraft();
      expect(hasLearnerAction(d.scenes.find((scene) => scene.id === 'c5') as unknown as Record<string, unknown>)).toBe(true);
      expect(unpredicted(d).map((scene) => scene.id)).not.toContain('c5');
    });

    it('the advice stays one readable sentence however many clips there are', () => {
      const d = clipDraft();
      const many = Array.from({ length: 14 }, (_, i) => `clip-number-${i + 1}`);
      d.outline = [...many.map((id) => ({ id, kind: 'clip' as const, purpose: 'p', stage: 'words' as const })), { id: 'end', kind: 'recap' as const, purpose: 'p' }];
      d.scenes = [...many.map((id) => ({ ...(d.scenes[0] as object), id }) as Draft['scenes'][number]), d.scenes.find((scene) => scene.id === 'end')!];
      const next = nextStep(d, { report: reportOf([error('PASSIVE_RUN')]), errorsAt: 'lessonReport.errors' });
      expect(next.tool).toBe('submit_scene');
      expect(next.why).toMatch(/in one of "clip-number-1", .* and 8 more; the plan can stay as it is\.$/);
      expect(next.why.length).toBeLessThan(400);
    });
  });
});

describe('a lesson of clips: next, when too few clips give the learner something to do', () => {
  const share = (got: number, needed: number, of: number): Issue => error('INTERACTIVE_SHARE', { got: String(got), expected: `at least ${needed} of ${of}` });
  const stripped = (d: Draft, ids: string[]): Draft => ({
    ...d,
    scenes: d.scenes.map((scene) => {
      if (scene.kind !== 'clip' || !ids.includes(scene.id)) return scene;
      const { explore: _explore, ...rest } = scene;
      return { ...rest, beats: scene.beats.map(({ gate: _gate, ...beat }) => beat) } as typeof scene;
    }),
  });

  it('is settled in the clips, not in the plan: next names the clips that have neither a gate nor an explore, and how many must get one', () => {
    // c2 loses its gate: c1, c2 and c6 are idle, three of six act, four must.
    const d = stripped(clipDraft(), ['c2']);
    const next = nextStep(d, { tool: 'submit_scene', report: reportOf([share(3, 4, 6)]), errorsAt: 'lessonReport.errors' });
    expect(next).toEqual({
      tool: 'submit_scene',
      why: 'Every scene is accepted, but 1 error blocks publishing: "lessonReport.errors" has each error with its "fix". INTERACTIVE_SHARE needs a "gate" on a beat that shows an outcome (options, or a part of the picture to tap) or an "explore" after the last beat, in one of "c1", "c2", "c6"; the plan can stay as it is.',
    });
    // After the plan tool as well: the plan it just stored is not what has to change.
    expect(nextStep(d, { tool: 'plan_lesson', report: reportOf([share(3, 4, 6)]) }).tool).toBe('submit_scene');
  });

  it('says how many when more than one clip is short', () => {
    const d = stripped(clipDraft(), ['c2', 'c3', 'c4']);
    const next = nextStep(d, { report: reportOf([share(1, 4, 6)]) });
    expect(next.tool).toBe('submit_scene');
    expect(next.why).toContain('in 3 of "c1", "c2", "c3", "c4", "c6"; the plan can stay as it is.');
  });

  it('one idle clip is the scene to resubmit', () => {
    // A lesson of one clip and a recap, the clip with nothing to do.
    const d = { ...clipDraft() };
    d.outline = d.outline.filter((entry) => entry.id === 'c1' || entry.id === 'end');
    d.scenes = d.scenes.filter((scene) => scene.id === 'c1' || scene.id === 'end');
    const next = nextStep(d, { report: reportOf([share(0, 1, 1)]) });
    expect(next.tool).toBe('submit_scene');
    expect(next.why).toContain('Fix and resubmit c1.');
    expect(next.why).toContain('or an "explore" after the last beat, in "c1"; the plan can stay as it is.');
  });

  it('beside a passive run, each is said once, and an outline error still comes first', () => {
    const moved = (d: Draft): Draft => {
      const o = d.outline;
      return { ...d, outline: [o[0]!, o[1]!, o[2]!, o[4]!, o[3]!, o[5]!, o[6]!, o[7]!, o[8]!, o[9]!] };
    };
    const d = stripped(moved(clipDraft()), ['c2', 'c3', 'c4']);
    const next = nextStep(d, { report: reportOf([error('PASSIVE_RUN'), share(1, 4, 6)]), errorsAt: 'errors' });
    expect(next.tool).toBe('submit_scene');
    expect(next.why).toBe(
      'Every scene is accepted, but 2 errors block publishing: "errors" has each error with its "fix". PASSIVE_RUN needs a "gate" on a beat that shows an outcome (or an "explore"), in one of "c1", "c2", "c3", "c4"; the plan can stay as it is. INTERACTIVE_SHARE needs a "gate" on a beat that shows an outcome (options, or a part of the picture to tap) or an "explore" after the last beat, in 3 of "c1", "c2", "c3", "c4", "c6"; the plan can stay as it is.',
    );
    expect(nextStep(d, { report: reportOf([share(1, 4, 6), error('PLAN_TOO_MANY_FRAMES')]) }).tool).toBe('plan_lesson');
  });
});

describe('a lesson of clips: next, after each kind of rejection', () => {
  const rejected = (tool: ToolName, errors: Issue[], extra: Outcome = {}): Outcome => ({ tool, rejected: errors, ...extra });
  const frameCodes = [...FRAME_ISSUE_CODES];
  const clipCodes = Object.entries(ISSUES as Record<string, { group: string }>)
    .filter(([, entry]) => entry.group === 'clips')
    .map(([code]) => code);

  it('a plan in the older scene kinds: plan again, as clips', () => {
    const first = nextStep(clipAt('researching'), rejected('plan_lesson', [error('PLAN_LEGACY_KIND', { path: 'outline[0].kind' })]));
    expect(first).toEqual({ tool: 'plan_lesson', why: 'The plan was not stored. Plan every teaching scene as a clip (kind "clip", with the "stage" that shows the idea), then call plan_lesson again with the whole plan.' });
    // With a plan already stored, of either kind, that plan stands.
    for (const draft of [clipAt('writing'), at('writing')]) {
      const next = nextStep(draft, rejected('plan_lesson', [error('PLAN_LEGACY_KIND', { path: 'outline[0].kind' })]));
      expect(next.tool).toBe('plan_lesson');
      expect(next.why).toMatch(/^The plan was not stored; the earlier plan still stands\. Plan every teaching scene as a clip/);
    }
  });

  it.each(['PLAN_CLIP_STAGE', 'PLAN_TOO_MANY_FRAMES', 'PLAN_FIRST_SCENE', 'PLAN_FIELD_NOT_ALLOWED', 'PLAN_PASSIVE_RUN', 'BAD_VALUE'])('a clip plan refused for %s: plan again, as each fix says', (code) => {
    for (const [draft, standing] of [[clipAt('researching'), false], [clipAt('planned'), true], [clipAt('writing'), true]] as [Draft, boolean][]) {
      const next = nextStep(draft, rejected('plan_lesson', [error(code, { path: 'outline[1].stage' })]));
      expect(next.tool).toBe('plan_lesson');
      expect(next.why).toBe(`The plan was not stored${standing ? '; the earlier plan still stands' : ''}. Change what each error's "fix" says and call plan_lesson again with the whole plan.`);
    }
  });

  it.each(frameCodes)('a frame clip refused for %s: the same clip again, and where the frame rules are', (code) => {
    for (const draft of [clipAt('planned'), clipAt('writing'), clipAt('complete')]) {
      const next = nextStep(draft, rejected('submit_scene', [error(code, { sceneId: 'c5', path: code === 'FRAME_BEAT_TIME' ? 'beats[2].at' : 'stage.code' })], { sceneId: 'c5' }));
      expect(next).toEqual({
        tool: 'submit_scene',
        why: '"c5" was not stored. Change only what each error\'s "fix" says and submit it again under the same id. For the code of a frame, get_guide section "frame-api" lists what it may use.',
      });
    }
  });

  // The interactive codes a clip can be refused for (GOAL_AT_END is a warning: it refuses nothing).
  const interactiveCodes = Object.entries(ISSUES as Record<string, { group: string; severity: string }>)
    .filter(([, entry]) => entry.group === 'interactive' && entry.severity === 'error')
    .map(([code]) => code);
  const SAME = '"c5" was not stored. Change only what each error\'s "fix" says and submit it again under the same id.';

  it('the interactive codes are the twenty-one of the catalog: formulas, controls, bindings, the goal, and gates answered by a tap', () => {
    expect(interactiveCodes).toHaveLength(21);
    expect(interactiveCodes.filter((code) => code.startsWith('FORMULA_'))).toHaveLength(3);
    expect(interactiveCodes.filter((code) => code.startsWith('PICK_'))).toHaveLength(4);
  });

  it.each(interactiveCodes.filter((code) => code.startsWith('FORMULA_')))('a clip refused for %s: the same clip again, and what the check did with the formula', (code) => {
    for (const draft of [clipAt('planned'), clipAt('writing'), clipAt('complete')]) {
      const next = nextStep(draft, rejected('submit_scene', [error(code, { sceneId: 'c5', path: 'explore.bind[0].expr' })], { sceneId: 'c5' }));
      expect(next).toEqual({ tool: 'submit_scene', why: `${SAME} Every formula is tried over the whole range of its sliders: where a value fails, the error names the first setting at which it does.` });
    }
  });

  it.each(interactiveCodes.filter((code) => code.startsWith('PICK_')))('a clip refused for %s: the same clip again, and when a gate by a tap opens', (code) => {
    for (const draft of [clipAt('planned'), clipAt('writing'), clipAt('complete')]) {
      const next = nextStep(draft, rejected('submit_scene', [error(code, { sceneId: 'c5', path: 'beats[2].gate.pick[0]' })], { sceneId: 'c5' }));
      expect(next).toEqual({ tool: 'submit_scene', why: `${SAME} A gate answered by a tap can only name parts that are on stage before its own beat plays.` });
    }
  });

  it.each(interactiveCodes.filter((code) => !code.startsWith('PICK_') && !code.startsWith('FORMULA_')))('a clip refused for %s: the same clip again, and that an explore is tried before it is accepted', (code) => {
    for (const draft of [clipAt('planned'), clipAt('writing'), clipAt('complete')]) {
      const next = nextStep(draft, rejected('submit_scene', [error(code, { sceneId: 'c5', path: 'explore.controls[0].value' })], { sceneId: 'c5' }));
      expect(next).toEqual({ tool: 'submit_scene', why: `${SAME} An explore is tried at every position of its sliders before the clip is accepted.` });
    }
  });

  it('a formula error beside others of the explore is answered as a formula error; beside a frame error, both are said', () => {
    const both = nextStep(clipAt('writing'), rejected('submit_scene', [error('CONTROL_UNUSED', { sceneId: 'c5' }), error('FORMULA_SYNTAX', { sceneId: 'c5' }), error('PICK_NOT_ON_STAGE', { sceneId: 'c5' })], { sceneId: 'c5' }));
    expect(both.why).toBe(`${SAME} Every formula is tried over the whole range of its sliders: where a value fails, the error names the first setting at which it does.`);
    const frame = nextStep(clipAt('writing'), rejected('submit_scene', [error('FRAME_SYNTAX', { sceneId: 'c5' }), error('GOAL_UNREACHABLE', { sceneId: 'c5' })], { sceneId: 'c5' }));
    expect(frame.why).toBe(`${SAME} For the code of a frame, get_guide section "frame-api" lists what it may use. An explore is tried at every position of its sliders before the clip is accepted.`);
  });

  it.each([...clipCodes, 'WORDS_OVER_BUDGET', 'SCENE_KIND_MISMATCH', 'SCENE_SHAPE_MISMATCH', 'UNKNOWN_FIELD', 'CLAIM_UNRELATED', 'QUOTE_NOT_FOUND', 'OPTION_CORRECT_COUNT'])('a clip refused for %s: the same clip again, under the same id', (code) => {
    for (const draft of [clipAt('planned'), clipAt('writing'), clipAt('complete')]) {
      const next = nextStep(draft, rejected('submit_scene', [error(code, { sceneId: 'c3', path: 'beats[1].do[0]' })], { sceneId: 'c3' }));
      expect(next).toEqual({ tool: 'submit_scene', why: '"c3" was not stored. Change only what each error\'s "fix" says and submit it again under the same id.' });
    }
  });

  it('a rejected clip does not move the lesson on, even when every other scene is in and the lesson would pass', () => {
    // A resubmitted clip that is refused leaves the accepted version in place; next is still about the refusal.
    const next = nextStep(clipAt('complete'), { tool: 'submit_scene', rejected: [error('ACTION_VERB_NOT_ALLOWED', { sceneId: 'c2' })], sceneId: 'c2', report: reportOf() });
    expect(next.tool).toBe('submit_scene');
    expect(next.why).toContain('"c2" was not stored');
  });

  it('a clip submitted before there is a plan, or under an id the plan does not have', () => {
    expect(nextStep(clipAt('researching'), rejected('submit_scene', [error('NO_PLAN')]))).toMatchObject({ tool: 'plan_lesson' });
    const unplanned = nextStep(clipAt('planned'), rejected('submit_scene', [error('SCENE_NOT_PLANNED')]));
    expect(unplanned).toEqual({ tool: 'submit_scene', why: 'The scene was not stored. Change only what each error\'s "fix" says and submit it again under the same id.' });
  });

  it('a refused publish of a clip lesson is not a rejected call: next comes from the lesson', () => {
    expect(nextStep(clipAt('writing'), { tool: 'publish_lesson', report: { ...reportOf([error('LESSON_INCOMPLETE')]), complete: false, pending: ['q1'] } })).toMatchObject({ tool: 'submit_scene' });
    expect(nextStep(clipAt('complete'), { tool: 'publish_lesson', report: reportOf([error('FRAME_SYNTAX', { sceneId: 'c5' })]), errorsAt: 'errors' }).why).toContain('Fix and resubmit c5.');
  });

  it('every stage of a clip lesson with every outcome: a tool that exists, a reason, and the same answer twice', () => {
    const drafts: [string, Draft, Outcome][] = [
      ['started', clipAt('started'), {}],
      ['researching', clipAt('researching'), {}],
      ['planned', clipAt('planned'), {}],
      ['writing', clipAt('writing'), {}],
      ['ready', clipAt('complete'), { report: reportOf() }],
      ['failing', clipAt('complete'), { report: reportOf([error('PASSIVE_RUN'), error('FRAME_BANNED', { sceneId: 'c5' })]) }],
      ['a lesson of one clip of every stage kind', { ...clipAt('planned'), outline: PlanInput.parse(planFor(Object.values(EXAMPLE_CLIPS))).outline }, {}],
    ];
    const outcomes: Outcome[] = [
      {},
      ...TOOL_NAMES.map((tool): Outcome => ({ tool })),
      ...TOOL_NAMES.map((tool): Outcome => ({ tool, rejected: [error('FRAME_SYNTAX', { sceneId: 'c5', path: 'stage.code' })], sceneId: 'c5' })),
      ...TOOL_NAMES.map((tool): Outcome => ({ tool, rejected: [error('PLAN_LEGACY_KIND', { path: 'outline[0].kind' })] })),
      { tool: 'get_lesson', missing: true, rejected: [error('LESSON_NOT_FOUND')] },
      { tool: 'publish_lesson', failed: true },
      ...TOOL_NAMES.map((tool): Outcome => ({ tool, fileMissing: true })),
      ...['errors', 'lessonReport.errors', 'outstanding.errors', 'lessonErrors'].map((errorsAt): Outcome => ({ tool: 'validate_lesson', errorsAt })),
    ];
    for (const [name, draft, base] of drafts) {
      for (const outcome of outcomes) {
        const asked = { ...base, ...outcome };
        const next = nextStep(draft, asked);
        expect([...TOOL_NAMES, 'reply'], name).toContain(next.tool);
        expect(next.why.length, `${name}: ${next.why}`).toBeGreaterThan(30);
        expect(next.why.length, `${name}: ${next.why}`).toBeLessThan(400);
        expect(next.why, name).not.toMatch(/narration|step_through|step-through/);
        expect(nextStep(draft, asked)).toEqual(next);
        // A rejected call is always answered with the tool to call again.
        if (asked.rejected && !asked.missing && !asked.failed && asked.tool && !(asked.tool === 'submit_scene' && asked.rejected[0]!.code === 'NO_PLAN')) expect(next.tool, name).toBe(asked.tool);
      }
    }
  });
});
