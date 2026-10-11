// checkLesson on lessons of clips: a clip counts as a teaching scene wherever a narration or a
// step-through does, a learner action (a gate on a beat, or an explore) is what keeps a stretch of
// clips from being passive and what two clips in three must have, a clip is one citing item, and
// the time estimate counts beats, gates and explores.
import { describe, expect, it } from 'vitest';
import { LIMITS as L } from '../../src/core/limits';
import type { Draft, Issue } from '../../src/core/types';
import { checkLesson, draftFromLesson, estimateMinutes, evidenceUses, MINUTES } from '../../src/core/validate';
import { buildEvidence } from './build';
import { buildClipLesson } from './build-clips';
import { CLIP_PLAN, changedLesson, clipDraft, clipScene, plannedClipDraft, type Loose } from './clip-kit';
import { EXAMPLE_PARTS, assemble, errorCodes, expectActionable, expectNoExcerptText, newDraft, saveEvidence, setPlan, submit, warningCodes } from './helpers';

const brief = (issues: readonly Issue[]): string[] => issues.map((i) => i.code);
/** A sixth passage, stored but cited by nothing: about the same subject, so an explanation can honestly rest on it. */
const EXTRA = {
  url: 'https://example.org/algorithms/binary-search-variants',
  title: 'Variants of binary search (synthetic test source)',
  excerpt: 'In a sorted list with repeated values, binary search can be changed to return the first position that holds the target instead of any position that holds it.',
  via: 'page',
};
const storeExtra = (draft: Draft): void => void saveEvidence(draft, EXTRA);
const restOn = (id: string) => (s: Loose) => {
  s.question.explanation = { text: 'In a sorted list binary search can return the first position that holds the target.', cites: [id] };
};

/** A generated lesson stored as it stands, without asking checkPlan. */
function stored(options: Parameters<typeof buildClipLesson>[0]): { draft: Draft; report: ReturnType<typeof checkLesson> } {
  const parts = buildClipLesson(options);
  const draft = newDraft(parts.start);
  for (const item of parts.evidence) saveEvidence(draft, item);
  setPlan(draft, parts.plan);
  for (const scene of parts.scenes) {
    const check = submit(draft, scene);
    expect(check.errors, `generated scene ${(scene as { id: string }).id}`).toEqual([]);
  }
  return { draft, report: checkLesson(draft) };
}

describe('a clip teaches', () => {
  it('a checkpoint may ask only about what a clip has cited', () => {
    const out = changedLesson({ q1: restOn('e6') }, storeExtra);
    expect(out.errors.map((e) => [e.code, e.sceneId, e.path])).toEqual([['CHECKPOINT_UNTAUGHT', 'q1', 'question.explanation.cites']]);
    expect(out.errors[0]!.message).toBe('The explanation of "q1" cites e6, which no teaching scene (clip, narration or step_through) cites: the checkpoint asks about something the lesson never taught.');
    expect(out.errors[0]!.fix).toContain('cite e6 in a caption (a claim or a quote) or on the stage of an earlier clip');
    expectActionable(out.errors);
    expectNoExcerptText(out.errors, out.draft);
  });

  it('what a stage cites is taught, and so is what a caption cites', () => {
    const onStage = changedLesson({ q1: restOn('e6'), c2: (s) => s.stage.cites.push('e6') }, storeExtra);
    expect(onStage.errors).toEqual([]);
    const inCaption = changedLesson(
      { q1: restOn('e6'), c3: (s) => (s.beats[5].caption = { type: 'claim', text: 'Binary search can return the first position that holds the target.', cites: ['e6'] }) },
      storeExtra,
    );
    expect(inCaption.errors).toEqual([]);
  });

  it('what an example is only based on is not', () => {
    const out = changedLesson({ q1: restOn('e6'), c3: (s) => (s.beats[1].caption.basedOn = ['e6']) }, storeExtra);
    expect(brief(out.errors)).toEqual(['CHECKPOINT_UNTAUGHT']);
  });

  it('asking before the clip that teaches it is a warning', () => {
    // e4 (the midpoint overflow) is first cited by c6, after q1.
    const out = changedLesson({ q1: (s) => (s.question.explanation = { text: 'Adding low and high before dividing can overflow a fixed-width integer.', cites: ['e4'] }) });
    expect(out.errors).toEqual([]);
    expect(out.warnings.map((w) => [w.code, w.sceneId])).toEqual([['CHECKPOINT_BEFORE_TAUGHT', 'q1']]);
    expect(out.warnings[0]!.message).toBe('"q1" asks about e4 before "c6" teaches it.');
  });

  it('counts as the lesson\'s figure, in the report and for the depth', () => {
    const report = checkLesson(clipDraft());
    expect(report.stats.figures).toBe(6);
    expect(brief(report.errors)).not.toContain('NO_FIGURE');
  });

  it('its claims count among the lesson\'s claims: too many weak ones refuse the lesson', () => {
    // Four captions that share one word with the passage they cite, among fourteen claims.
    const weak = (text: string) => (cites: string[]) => ({ type: 'claim', text, cites });
    const out = changedLesson({
      c2: (s) => {
        s.beats[0].caption = weak('A target somewhere inside enormous catalogues keeps everybody guessing wildly.')(['e1']);
        s.beats[1].caption = weak('Folding paper in half again quickly produces something surprisingly thick.')(['e1']);
        s.beats[2].caption = weak('Sorted cupboards make cooking supper faster during busy weekday evenings.')(['e1']);
      },
      c5: (s) => (s.beats[1].caption = weak('Comparing prices between several shops rarely saves anybody serious money.')(['e1'])),
    });
    expect(warningCodes(out).filter((c) => c === 'CLAIM_WEAK_MATCH')).toHaveLength(4);
    expect(brief(out.errors)).toEqual(['TOO_MANY_WEAK_CLAIMS']);
    expect(out.errors[0]!.message).toContain('4 of 14 claims barely match the excerpts they cite (c2/beats[0].caption, c2/beats[1].caption, c2/beats[2].caption, c5/beats[1].caption)');
    expect(out.weakClaims).toEqual(['c2/beats[0].caption', 'c2/beats[1].caption', 'c2/beats[2].caption', 'c5/beats[1].caption']);
    // Three are recorded and published, not refused.
    const three = changedLesson({
      c2: (s) => {
        s.beats[0].caption = weak('A target somewhere inside enormous catalogues keeps everybody guessing wildly.')(['e1']);
        s.beats[1].caption = weak('Folding paper in half again quickly produces something surprisingly thick.')(['e1']);
        s.beats[2].caption = weak('Sorted cupboards make cooking supper faster during busy weekday evenings.')(['e1']);
      },
    });
    expect(three.errors).toEqual([]);
    expect(three.stats.weakClaims).toBe(3);
  });

  it('its captions are the lesson\'s prose: the shares of uncited words and of examples are held', () => {
    const framing = (beat: Loose): void => void (beat.caption = { type: 'framing', text: beat.caption.text });
    const uncited = changedLesson({
      c2: (s) => [1, 2].forEach((i) => framing(s.beats[i])),
      c4: (s) => [0].forEach((i) => framing(s.beats[i])),
      c5: (s) => [2, 4].forEach((i) => framing(s.beats[i])),
      c6: (s) => [3, 4].forEach((i) => framing(s.beats[i])),
    });
    expect(brief(uncited.errors)).toEqual(['UNCITED_SHARE']);
    expect(uncited.stats.uncitedShare).toBeGreaterThan(L.uncitedShare.share);

    const example = (beat: Loose): void => void (beat.caption = { type: 'example', text: beat.caption.text });
    const examples = changedLesson({
      c2: (s) => [1, 2].forEach((i) => example(s.beats[i])),
      c4: (s) => [0].forEach((i) => example(s.beats[i])),
      c5: (s) => [2, 4].forEach((i) => example(s.beats[i])),
      c6: (s) => [3, 4].forEach((i) => example(s.beats[i])),
    });
    expect(brief(examples.errors)).toEqual(['EXAMPLE_SHARE']);
    expect(examples.stats.exampleShare).toBeGreaterThan(L.exampleShare.share);
  });
});

describe('a clip is one citing item', () => {
  it('however many of its captions, and its stage, cite the same passage', () => {
    const draft = clipDraft();
    const c2 = draft.scenes.find((s) => s.id === 'c2') as Loose;
    expect([c2.stage.cites.includes('e1'), c2.beats.filter((b: Loose) => b.caption.cites?.includes('e1')).length]).toEqual([true, 3]);
    expect(evidenceUses(draft).e1).toBe(6);
    expect(checkLesson(draft).errors).toEqual([]);
  });

  it('a passage that supports more than six items is overused, and the clips are named as items', () => {
    const out = changedLesson({ c1: (s) => s.stage.cites.push('e1') });
    expect(brief(out.errors)).toEqual(['EVIDENCE_OVERUSED']);
    expect(out.errors[0]!.message).toBe('e1 is cited by 7 items (c1/clip, c2/clip, c3/clip, q1/question.explanation, c5/clip, q3/question.explanation, end/takeaways[0]); one excerpt may support at most 6. A clip is one item, whatever in it cites the passage.');
    expect(evidenceUses(out.draft).e1).toBe(7);
    expectActionable(out.errors);
  });

  it('what an example is based on is not a use', () => {
    const out = changedLesson({ c1: (s) => (s.beats[0].caption = { type: 'example', text: 'A million names, in order. You want exactly one of them.', basedOn: ['e1'] }) });
    expect(out.errors).toEqual([]);
    expect(evidenceUses(out.draft).e1).toBe(6);
  });
});

describe('a prediction is what a stretch of clips owes the learner', () => {
  const kinds: ('clip' | 'checkpoint' | 'recap')[] = ['clip', 'clip', 'clip', 'clip', 'checkpoint', 'recap'];

  const GATE = { prompt: 'What comes next?', options: [{ text: 'The first thing', correct: true, feedback: 'Yes, that is what the passage says.' }, { text: 'The other thing', correct: false, feedback: 'That is not what the passage describes.' }] };
  /** A stored clip of a draft with a prediction added to its second beat. */
  const gate = (draft: Draft, id: string): void => {
    const clip = structuredClone(draft.scenes.find((s) => s.id === id)) as Loose;
    clip.beats[1].gate = structuredClone(GATE);
    expect(submit(draft, clip).errors).toEqual([]);
  };

  it('four clips in a row with nothing to do are a passive run; the plan allowed them because a clip can carry a gate', () => {
    const { report, draft } = stored({ depth: 'quick', size: 'min', kinds, gates: false, explore: false, objectives: 1 });
    // Two rules, each with its own way out: the stretch, and the share of clips that ask something.
    expect(brief(report.errors)).toEqual(['PASSIVE_RUN', 'INTERACTIVE_SHARE']);
    expect(report.errors[0]!.message).toBe('Scenes s1, s2, s3, s4 come in a row with no checkpoint and no prediction (4; at most 3 are allowed).');
    expect(report.errors[0]!.fix).toBe('Add a "gate" (a prediction, by options or by a tap on the picture) to a beat of "s1", on the beat that shows the outcome and not the first, or an "explore" after its last beat, and submit it again; or call plan_lesson again with a checkpoint in this stretch.');
    expect(report.ok).toBe(false);
    expectActionable(report.errors);
    expect(draft.scenes).toHaveLength(6);
  });

  it('one gate anywhere in the stretch ends the passive run', () => {
    const { draft } = stored({ depth: 'quick', size: 'min', kinds, gates: false, explore: false, objectives: 1 });
    gate(draft, 's3');
    expect(brief(checkLesson(draft).errors)).toEqual(['INTERACTIVE_SHARE']);
  });

  it('so does an explore: the learner drags, which is something to do', () => {
    // The third and fourth clips of this lesson are dots and bars, which the builder hands over to a slider.
    const { report, draft } = stored({ depth: 'quick', size: 'min', kinds, gates: false, objectives: 1 });
    expect(draft.scenes.filter((s) => s.kind === 'clip' && s.explore !== undefined).map((s) => s.id)).toEqual(['s3', 's4']);
    // No passive run; what is left is that two clips of four ask something, and three must.
    expect(brief(report.errors)).toEqual(['INTERACTIVE_SHARE']);
    expect(report.errors[0]!.message).toBe("2 of the lesson's 4 clips contain a learner action (a gate or an explore); at least 3 must. Without one: s1, s2.");
  });

  it('with gates the same lesson passes, and three gateless clips before a checkpoint are no passive run', () => {
    expect(stored({ depth: 'quick', size: 'min', kinds, objectives: 1 }).report.errors).toEqual([]);
    expect(brief(stored({ depth: 'quick', size: 'min', kinds: ['clip', 'clip', 'clip', 'checkpoint', 'recap'], gates: false, explore: false, objectives: 1 }).report.errors)).toEqual(['INTERACTIVE_SHARE']);
  });
});

describe('two clips in three give the learner something to do', () => {
  const kinds: ('clip' | 'checkpoint' | 'recap')[] = ['clip', 'clip', 'clip', 'checkpoint', 'clip', 'clip', 'clip', 'checkpoint', 'recap'];
  const GATE = { prompt: 'What comes next?', options: [{ text: 'The first thing', correct: true, feedback: 'Yes, that is what the passage says.' }, { text: 'The other thing', correct: false, feedback: 'That is not what the passage describes.' }] };
  const gate = (draft: Draft, id: string): void => {
    const clip = structuredClone(draft.scenes.find((s) => s.id === id)) as Loose;
    clip.beats[1].gate = structuredClone(GATE);
    expect(submit(draft, clip).errors).toEqual([]);
  };

  it('a lesson whose clips ask nothing is refused, with the clips named and how many more must ask', () => {
    const { report } = stored({ depth: 'standard', size: 'min', kinds, gates: false, explore: false, objectives: 2 });
    expect(brief(report.errors)).toEqual(['INTERACTIVE_SHARE']);
    const found = report.errors[0]!;
    expect(found.message).toBe("0 of the lesson's 6 clips contain a learner action (a gate or an explore); at least 4 must. Without one: s1, s2, s3, s5, s6, s7.");
    expect(found).toMatchObject({ path: '', got: '0', expected: 'at least 4 of 6' });
    expect(found.sceneId).toBeUndefined();
    expect(found.fix).toMatch(/^The learner acts before being told\. Give 4 more of those clips an action and submit them again: a "gate" on the beat that shows an outcome, never the first/);
    // The clips whose stage suits an explore are pointed at.
    expect(found.fix).toMatch(/\("s3", "s5" have a stage that suits one\)\.$/);
    expectActionable(report.errors);
  });

  it('is counted clip by clip: three of six is too few, four is enough, whichever kind of action it is', () => {
    const { draft } = stored({ depth: 'standard', size: 'min', kinds, gates: false, explore: false, objectives: 2 });
    for (const id of ['s1', 's2', 's5']) gate(draft, id);
    const three = checkLesson(draft);
    expect(brief(three.errors)).toEqual(['INTERACTIVE_SHARE']);
    expect(three.errors[0]!.message).toBe("3 of the lesson's 6 clips contain a learner action (a gate or an explore); at least 4 must. Without one: s3, s6, s7.");
    gate(draft, 's7');
    expect(checkLesson(draft).errors).toEqual([]);
  });

  it('an explore counts like a gate, and two gates in one clip count once', () => {
    // Explores on, gates off: the dots clip and the bars clip are the two clips of six that act.
    const { draft, report } = stored({ depth: 'standard', size: 'min', kinds, gates: false, objectives: 2 });
    expect(report.errors[0]!.message).toMatch(/^2 of the lesson's 6 clips contain a learner action .* Without one: s1, s2, s6, s7\.$/);
    // A gate in a clip that already has an explore changes nothing: a clip is counted once.
    gate(draft, 's3');
    expect(checkLesson(draft).errors[0]!.message).toMatch(/^2 of the lesson's 6 clips contain a learner action/);
    gate(draft, 's1');
    expect(checkLesson(draft).errors[0]!.message).toMatch(/^3 of the lesson's 6 clips contain a learner action/);
    gate(draft, 's7');
    expect(checkLesson(draft).errors).toEqual([]);
  });

  it('the share is two thirds, rounded up: 1 of 1, 2 of 2, 2 of 3, 3 of 4, 4 of 5', () => {
    expect(L.interactiveShare).toBeCloseTo(2 / 3);
    for (const [clips, needed] of [[1, 1], [2, 2], [3, 2], [4, 3], [5, 4], [6, 4], [9, 6]] as const) expect(Math.ceil(clips * L.interactiveShare - 1e-9), `${clips} clips`).toBe(needed);
  });

  it('a lesson made before clips has no clips to count', () => {
    // The example in the older scene kinds: no clip, so nothing to hold to the share.
    const report = checkLesson(assemble(structuredClone(EXAMPLE_PARTS)));
    expect(report.errors).toEqual([]);
    expect(warningCodes(report)).not.toContain('NO_EXPLORE');
  });
});

describe('a standard or a deep lesson is expected to hand a picture over', () => {
  it('none of its clips has an explore: a warning that names the first clip whose stage could carry one', () => {
    const { report } = stored({ depth: 'standard', size: 'min', explore: false });
    expect(report.errors).toEqual([]);
    expect(warningCodes(report)).toEqual(['NO_EXPLORE']);
    const found = report.warnings[0]!;
    expect(found.message).toBe('No clip of this standard lesson has an "explore": there is nothing the learner can drag. "s4" has a dots stage that could carry one.');
    expect(found.fix).toMatch(/^Add "explore" to "s4" and submit it again: one or two "controls" \(sliders\), "bind" to tie a split-off group to them with a formula, and a "goal" the learner reaches by dragging\. Its stage must then be marked "worked" or "illustrative"\.$/);
    expect(report.ok).toBe(true);
  });

  it('with one explore anywhere, nothing is said; and a quick lesson is never asked for one', () => {
    expect(stored({ depth: 'standard', size: 'min' }).report.warnings).toEqual([]);
    expect(stored({ depth: 'deep', size: 'min', explore: false }).report.warnings.map((w) => w.code)).toEqual(['NO_EXPLORE']);
    expect(stored({ depth: 'quick', size: 'min', explore: false }).report.warnings).toEqual([]);
  });

  it('where no stage could carry one, the warning says what to plan', () => {
    const { report } = stored({ depth: 'standard', size: 'min', stages: ['flow', 'sequence', 'timeline'] });
    expect(warningCodes(report)).toEqual(['NO_EXPLORE']);
    expect(report.warnings[0]!.message).toBe('No clip of this standard lesson has an "explore": there is nothing the learner can drag.');
    expect(report.warnings[0]!.fix).toMatch(/call plan_lesson again with a clip on a "chart" or a "dots" stage/);
  });
});

describe('minutes', () => {
  it('a beat adds a quarter of a minute, a gate half a minute and an explore three quarters, in place of the step and figure terms', () => {
    expect(MINUTES).toMatchObject({ beat: 0.25, gate: 0.5, explore: 0.75 });
    const none = { words: 0, gradedCheckpoints: 0, reflectCheckpoints: 0, predicts: 0, steps: 0, figures: 0 };
    expect(estimateMinutes({ ...none, words: 400, beats: 8 })).toBe(4);
    expect(estimateMinutes({ ...none, words: 400, beats: 8, gates: 2 })).toBe(5);
    // 2 + 2 + 1 + 1.5 = 6.5, and without the explores 5.
    expect(estimateMinutes({ ...none, words: 400, beats: 8, gates: 2, explores: 2 })).toBe(7);
    expect(estimateMinutes({ ...none, words: 400, beats: 8, gates: 2, explores: 0 })).toBe(5);
    // Callers that know nothing of clips are unchanged.
    expect(estimateMinutes({ ...none, words: 400 })).toBe(2);
  });

  it('a lesson of clips is estimated from its words, its checkpoints, its beats, its gates and its explores, with no figure term', () => {
    const report = checkLesson(clipDraft());
    const clips = report.lesson!.scenes.filter((s) => s.kind === 'clip');
    const beats = clips.reduce((n, s) => n + (s.kind === 'clip' ? s.beats.length : 0), 0);
    // A gate is a gate whether it is answered by options or by a tap.
    const gates = clips.reduce((n, s) => n + (s.kind === 'clip' ? s.beats.filter((b) => b.gate).length : 0), 0);
    const explores = clips.filter((s) => s.kind === 'clip' && s.explore !== undefined).length;
    expect(beats).toBe(27);
    expect(gates).toBeGreaterThanOrEqual(3);
    expect(explores).toBeGreaterThanOrEqual(1);
    expect(report.stats.minutes).toBe(Math.round(report.stats.words / 200 + 3 + beats * 0.25 + gates * 0.5 + explores * 0.75));
    expect(report.stats.minutes).toBe(estimateMinutes({ words: report.stats.words, gradedCheckpoints: 3, reflectCheckpoints: 0, predicts: 0, steps: 0, figures: 0, beats, gates, explores }));
  });

  it('an explore adds three quarters of a minute to the lesson it is in', () => {
    const withIt = stored({ depth: 'standard', size: 'min' }).report;
    const without = stored({ depth: 'standard', size: 'min', explore: false }).report;
    const count = (report: typeof withIt): number => report.lesson!.scenes.filter((s) => s.kind === 'clip' && s.explore !== undefined).length;
    expect([count(withIt), count(without)]).toEqual([1, 0]);
    // The words of the explore are prose too, so the estimate is taken from each lesson's own counts.
    const beats = (report: typeof withIt): number => report.lesson!.scenes.reduce((n, s) => n + (s.kind === 'clip' ? s.beats.length : 0), 0);
    const gates = (report: typeof withIt): number => report.lesson!.scenes.reduce((n, s) => n + (s.kind === 'clip' ? s.beats.filter((b) => b.gate).length : 0), 0);
    const checkpoints = withIt.stats.checkpoints;
    expect(withIt.stats.minutes).toBe(Math.max(1, Math.round(withIt.stats.words / 200 + checkpoints + beats(withIt) * 0.25 + gates(withIt) * 0.5 + 0.75)));
    expect(without.stats.minutes).toBe(Math.max(1, Math.round(without.stats.words / 200 + checkpoints + beats(without) * 0.25 + gates(without) * 0.5)));
  });
});

describe('mostly illustrative', () => {
  const illustrative = (s: Loose): void => void (s.stage.provenance = 'illustrative');

  it('warns when more than half the clips that show data are illustrative', () => {
    // The example has five such clips (a flow, two rows of cells, a chart, dots); its words clip is not one.
    const two = changedLesson({ c3: illustrative, c4: illustrative });
    expect([...two.errors, ...two.warnings]).toEqual([]);
    const three = changedLesson({ c3: illustrative, c4: illustrative, c5: illustrative });
    expect(three.errors).toEqual([]);
    expect(three.warnings.map((w) => [w.code, w.path])).toEqual([['MOSTLY_ILLUSTRATIVE', '']]);
    expect(three.warnings[0]).toMatchObject({ got: '3', expected: 'at most 2' });
    expect(three.warnings[0]!.message).toBe('3 of the 5 clips that show data are marked "illustrative" (c3, c4, c5); the learner cannot check what an illustrative stage shows.');
    expect(three.ok).toBe(true);
    expectActionable(three.warnings);
  });

  it('does not count stages that show no data: words, lines and frames', () => {
    const { report } = stored({ depth: 'quick', size: 'min', stages: ['words', 'lines'], provenance: 'illustrative' });
    expect([...report.errors, ...report.warnings]).toEqual([]);
  });

  it('is published with the lesson: a warning, counted by its code', () => {
    const { report } = stored({ depth: 'quick', size: 'min', provenance: 'illustrative' });
    expect(report.ok).toBe(true);
    expect(warningCodes(report)).toEqual(['MOSTLY_ILLUSTRATIVE']);
  });
});

describe('the lesson as it is stored', () => {
  it('is incomplete until every planned clip is accepted', () => {
    const draft = plannedClipDraft();
    for (const id of ['c1', 'c2', 'q1']) expect(submit(draft, clipScene(id)).errors).toEqual([]);
    const report = checkLesson(draft);
    expect(report).toMatchObject({ ok: false, complete: false, pending: ['c3', 'c4', 'c5', 'q2', 'c6', 'q3', 'end'] });
    expect(brief(report.errors)).toEqual(['LESSON_INCOMPLETE']);
    expect(report.stats).toMatchObject({ scenes: 3, figures: 2, checkpoints: 1 });
  });

  it('checks every stored clip again: one that was changed in the store is refused with its scene id', () => {
    const draft = clipDraft();
    const c3 = draft.scenes.find((s) => s.id === 'c3') as Loose;
    c3.beats[1].do[0].target = 'middle';
    const report = checkLesson(draft);
    expect(report.errors.map((e) => [e.code, e.sceneId, e.path])).toEqual([['ACTION_UNKNOWN_PART', 'c3', 'beats[1].do[0].target']]);
    expect(report.lesson).toBeUndefined();
  });

  it('a number on a stage must be in a passage the finished lesson publishes', () => {
    // e6 is stored, and a sourced stage may cite it; then it is published with the lesson.
    const out = changedLesson({ c2: (s) => s.stage.cites.push('e6') }, storeExtra);
    expect(out.errors).toEqual([]);
    expect(out.lesson!.evidence.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
    expect(out.stats.sources).toBe(6);
  });

  it('more than two custom frames refuse the lesson too, however the plan came to be stored', () => {
    const { report } = stored({ depth: 'standard', size: 'min', kinds: ['clip', 'clip', 'checkpoint', 'clip', 'checkpoint', 'recap'], stages: ['frame'] });
    expect(report.errors.map((e) => [e.code, e.path])).toEqual([['PLAN_TOO_MANY_FRAMES', 'outline[3].stage']]);
    expect(report.errors[0]!.fix).toContain('Give 1 of them a typed stage');
    expect(report.ok).toBe(false);
    // Two frames and a typed stage are a lesson.
    expect(stored({ depth: 'standard', size: 'min', kinds: ['clip', 'clip', 'checkpoint', 'clip', 'checkpoint', 'recap'], stages: ['frame', 'frame', 'cells'] }).report.errors).toEqual([]);
  });

  it('a lesson read back as a draft plans each clip with its stage kind', () => {
    const report = checkLesson(clipDraft());
    const draft = draftFromLesson(report.lesson!);
    expect(draft.outline.map((e) => [e.id, e.kind, e.stage ?? e.question ?? null])).toEqual(CLIP_PLAN.outline.map((e) => [e.id, e.kind, e.stage ?? e.question ?? null]));
    expect(checkLesson(draft).hash).toBe(report.hash);
  });

  it('a lesson that mixes the older kinds with clips is still a lesson', () => {
    const parts = buildClipLesson({ depth: 'standard', size: 'min' });
    const draft = assemble(parts);
    expect(checkLesson(draft).errors).toEqual([]);
    // One more passage, and a narration scene of the older kind after the opening clip.
    const id = saveEvidence(draft, buildEvidence(30));
    draft.outline = [draft.outline[0]!, { id: 'n1', kind: 'narration' as const, purpose: 'The same in words' }, ...draft.outline.slice(1)];
    const check = submit(draft, { id: 'n1', kind: 'narration', title: 'In words', blocks: [{ type: 'quote', text: buildEvidence(30).excerpt.split('.')[0]!.split(' ').slice(2, 7).join(' '), cite: id }] });
    expect(check.errors).toEqual([]);
    const report = checkLesson(draft);
    expect(report.errors).toEqual([]);
    expect(report.lesson!.scenes.map((s) => s.kind)).toEqual(['clip', 'narration', 'clip', 'checkpoint', 'clip', 'checkpoint', 'recap']);
    // The narration scene counts by the older terms, the clips by theirs.
    expect(report.stats.figures).toBe(3);
  });
});
