// checkLesson: the rules about the lesson as a whole, at their thresholds, and the property that
// nothing accepted earlier is trusted. It is the only thing that says a lesson may be published.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_PLAN, EXAMPLE_QUESTIONS } from '../../src/core/examples';
import { hashLesson } from '../../src/core/hash';
import { MAX_ISSUES_PER_CALL } from '../../src/core/issues';
import { DEPTHS, LIMITS as L, type Depth } from '../../src/core/limits';
import type { SceneKind } from '../../src/core/schema';
import type { Draft, LessonReport } from '../../src/core/types';
import { checkLesson } from '../../src/core/validate';
import { buildEvidence, buildLesson, type BuildOptions } from './build';
import { applyPlan, codes, errorCodes, exampleDraft, exampleScene, expectActionable, expectNoExcerptText, newDraft, saveEvidence, setPlan, submit, warningCodes } from './helpers';

/** A generated lesson stored without asking checkPlan, with every scene accepted on its own. */
function stored(depth: Depth, kinds: SceneKind[], options: Partial<BuildOptions> = {}): Draft {
  const parts = buildLesson({ depth, size: 'min', kinds, fill: 'warn', ...options });
  const draft = newDraft(parts.start);
  for (const item of parts.evidence) saveEvidence(draft, item);
  setPlan(draft, parts.plan);
  for (const scene of parts.scenes) expect(submit(draft, scene).errors, (scene as { id: string }).id).toEqual([]);
  return draft;
}
const K = (pattern: string): SceneKind[] => [...pattern].map((c) => ({ n: 'narration', s: 'step_through', c: 'checkpoint', r: 'recap' })[c] as SceneKind);

function resubmit(draft: Draft, id: string, edit: (s: any) => void): void {
  const s = exampleScene(id);
  edit(s);
  expect(submit(draft, s).errors, id).toEqual([]);
}

const consistent = (report: LessonReport): void => {
  expect(report.ok).toBe(report.errors.length === 0 && report.complete);
  expect(report.lesson !== undefined).toBe(report.ok);
  expect(report.hash !== undefined).toBe(report.ok);
  for (const e of report.errors) expect(e.severity).toBe('error');
  for (const w of report.warnings) expect(w.severity).toBe('warning');
  expectActionable([...report.errors, ...report.warnings]);
};

describe('complete, pending and ok', () => {
  it('a draft with no plan cannot be checked further', () => {
    const report = checkLesson(newDraft());
    expect(errorCodes(report)).toEqual(['NO_PLAN']);
    expect(report).toMatchObject({ ok: false, complete: false, pending: [] });
    expect(report.stats.scenes).toBe(0);
    consistent(report);
  });

  it('a planned lesson with nothing written lists every scene as pending and reports nothing else', () => {
    const draft = exampleDraft();
    draft.scenes = [];
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['LESSON_INCOMPLETE']);
    expect(report.pending).toEqual(EXAMPLE_PLAN.outline.map((o) => o.id));
    expect(report.errors[0]!.message).toBe('9 of 9 planned scenes have not been accepted: s1, s2, s3, s4, s5, s6, s7, s8, s9.');
    expect(report.warnings).toEqual([]);
    expect(report.stats).toMatchObject({ scenes: 0, words: 0, minutes: 0, sources: 0 });
    consistent(report);
  });

  it('a half-written lesson is not blamed for what its missing scenes will bring', () => {
    const draft = exampleDraft();
    // Without the checkpoints and the recap, nothing is assessed and the lesson cites less.
    draft.scenes = draft.scenes.filter((s) => ['s1', 's2'].includes(s.id));
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['LESSON_INCOMPLETE']);
    expect(report.pending).toEqual(['s3', 's4', 's5', 's6', 's7', 's8', 's9']);
    expect(report.stats).toMatchObject({ scenes: 2, claims: 2, figures: 1, checkpoints: 0 });
    expect(report.complete).toBe(false);
    expect(report.lesson).toBeUndefined();
  });

  it('but a problem that is already certain is reported while scenes are still pending', () => {
    const draft = exampleDraft();
    resubmit(draft, 's3', (s) => (s.steps[2].blocks[0].cites = ['e3', 'e1']));
    draft.scenes = draft.scenes.filter((s) => s.id !== 's5');
    expect(errorCodes(checkLesson(draft))).toEqual(['LESSON_INCOMPLETE', 'EVIDENCE_OVERUSED']);
  });

  it('ok is true only with every scene accepted and no error, and only then is there a lesson', () => {
    const report = checkLesson(exampleDraft());
    expect(report.ok).toBe(true);
    consistent(report);
    expect(report.hash).toBe(hashLesson(report.lesson!));
  });
});

describe('nothing accepted earlier is trusted', () => {
  it('a stored scene that no longer fits the plan stops the lesson', () => {
    const draft = exampleDraft();
    draft.outline[1] = { ...draft.outline[1]!, figure: 'sequence' };
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['SCENE_SHAPE_MISMATCH']);
    expect(report.errors[0]).toMatchObject({ sceneId: 's2', path: 'figure.type' });
    consistent(report);
  });

  it('a stored scene is checked against the evidence as it is now', () => {
    const draft = exampleDraft();
    draft.evidence = draft.evidence.filter((e) => e.id !== 'e4');
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['CITE_UNKNOWN']);
    expect(report.errors[0]).toMatchObject({ sceneId: 's7', path: 'blocks[2].cites[0]', got: 'e4' });
  });

  it('a stored scene written into the draft by hand gets no pass', () => {
    const draft = exampleDraft();
    const s1 = draft.scenes.find((s) => s.id === 's1') as any;
    s1.blocks[1].text = 'Binary search inspects 4,321 sorted values per second on a pocket calculator.';
    s1.blocks[0].text = 'Read https://tracker.invalid/pixel first.';
    s1.blocks.push({ type: 'quote', text: 'words the source never wrote', cite: 'e4' });
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['QUOTE_NOT_FOUND', 'NUMBER_NOT_IN_SOURCE', 'URL_IN_TEXT']);
    expect(report.errors.every((e) => e.sceneId === 's1')).toBe(true);
    expect(report.ok).toBe(false);
    expectNoExcerptText(report.errors, draft);
  });

  it('a stored scene that is not a scene at all stops the lesson', () => {
    const draft = exampleDraft();
    (draft.scenes as unknown[])[draft.scenes.findIndex((s) => s.id === 's6')] = { id: 's6', kind: 'checkpoint', title: 'Check', html: '<script>alert(1)</script>' };
    const report = checkLesson(draft);
    expect(report.ok).toBe(false);
    expect(errorCodes(report)).toContain('UNKNOWN_FIELD');
    expect(report.errors.every((e) => e.sceneId === 's6')).toBe(true);
    expect(report.lesson).toBeUndefined();
  });

  it('a stored plan that should never have been stored stops the lesson', () => {
    const cases: Array<[string, (d: Draft) => void, string[]]> = [
      ['a first scene that is not a narration', (d) => d.outline.reverse(), ['PLAN_FIRST_SCENE', 'PLAN_LAST_SCENE']],
      ['a title with an address in it', (d) => (d.title = 'Binary search: see https://evil.invalid/x'), ['URL_IN_TEXT']],
      ['too many objectives for the depth', (d) => (d.depth = 'quick'), ['PLAN_SCENE_COUNT']],
      ['an objective that is not an objective', (d) => ((d.objectives as unknown[])[0] = { id: 'o1', text: 'Trace binary search on a sorted list', weight: 3 }), ['UNKNOWN_FIELD']],
      ['a title that is too long', (d) => (d.title = 'Binary search '.repeat(8)), ['TOO_LONG']],
    ];
    for (const [what, edit, expected] of cases) {
      const draft = exampleDraft();
      edit(draft);
      const report = checkLesson(draft);
      expect(report.ok, what).toBe(false);
      for (const code of expected) expect(errorCodes(report), what).toContain(code);
    }
  });

  it('stored evidence with an address that is not a public page stops the lesson', () => {
    for (const url of ['javascript:alert(1)', 'http://169.254.169.254/latest/meta-data/', 'https://example.org:8443/algorithms/binary-search', 'file:///etc/passwd']) {
      const draft = exampleDraft();
      draft.evidence[0] = { ...draft.evidence[0]!, url };
      const report = checkLesson(draft);
      expect(errorCodes(report), url).toEqual(['EVIDENCE_URL']);
      expect(report.errors[0]!.message).toContain('e1');
      expect(report.lesson).toBeUndefined();
    }
    // A host that does not match the address it sits beside is refused too: the learner is shown the host first.
    const draft = exampleDraft();
    draft.evidence[0] = { ...draft.evidence[0]!, host: 'nature.com' };
    expect(errorCodes(checkLesson(draft))).toEqual(['EVIDENCE_URL']);
  });

  it('a header that is not valid stops the lesson', () => {
    const draft = exampleDraft();
    draft.id = '../../etc/passwd';
    const report = checkLesson(draft);
    expect(report.ok).toBe(false);
    expect(report.errors.map((e) => [e.code, e.path])).toEqual([['BAD_ID', 'id']]);
    const language = exampleDraft();
    language.language = 'English';
    expect(checkLesson(language).errors.map((e) => [e.code, e.path])).toEqual([['BAD_VALUE', 'language']]);
  });

  it('a number that was allowed by the title is refused once the title no longer has it', () => {
    const draft = exampleDraft();
    applyPlan(draft, { ...EXAMPLE_PLAN, title: 'Binary search in 20 steps or fewer, for 4096 items' });
    resubmit(draft, 's1', (s) => (s.blocks[0].text = 'How do you find one name among 4096 without reading them all?'));
    expect(checkLesson(draft).errors).toEqual([]);
    draft.title = EXAMPLE_PLAN.title;
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['NUMBER_UNGROUNDED']);
    expect(report.errors[0]).toMatchObject({ sceneId: 's1', got: '4096' });
  });
});

describe('what is assembled', () => {
  it('scenes follow the outline whatever order they were accepted in; unplanned and superseded scenes are left out', () => {
    const draft = exampleDraft();
    draft.scenes.reverse();
    draft.scenes.push({ ...(draft.scenes[0] as any), id: 'old-scene' });
    // An older copy of s1, stored before the current one.
    draft.scenes.unshift({ ...(draft.scenes.find((s) => s.id === 's1') as any), title: 'An older title' });
    const order = draft.scenes.map((s) => s.id);
    order.push(order.splice(order.indexOf('s1'), 1)[0]!);
    const report = checkLesson(draft);
    expect(report.errors).toEqual([]);
    expect(report.lesson!.scenes.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']);
    expect(report.lesson!.scenes[0]!.title).toBe('One name in a million');
    expect(report.hash).toBe(checkLesson(exampleDraft()).hash);
  });

  it('only referenced evidence is published, in numeric id order, and an example\'s basedOn counts as a reference', () => {
    const draft = exampleDraft();
    for (let i = 0; i < 7; i++) saveEvidence(draft, buildEvidence(i));
    expect(draft.evidence.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12']);
    resubmit(draft, 's5', (s) => (s.blocks[2].basedOn = ['e2', 'e10']));
    const report = checkLesson(draft);
    expect(report.errors).toEqual([]);
    expect(report.lesson!.evidence.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e10']);
    expect(report.stats.sources).toBe(6);
    // Stored but unreferenced evidence leaves no trace in what is published.
    expect(JSON.stringify(report.lesson)).not.toContain(draft.evidence[6]!.excerpt);
  });

  it('the hash covers every part of the lesson', () => {
    const base = checkLesson(exampleDraft()).hash;
    const variants: Array<(d: Draft) => void> = [
      (d) => (d.title = 'Binary search: another title'),
      (d) => (d.learner.level = 'solid'),
      (d) => (d.id = 'zzz999yyy888'),
      (d) => (d.evidence[0] = { ...d.evidence[0]!, savedOn: '2026-10-11' }),
      (d) => (d.evidence[0] = { ...d.evidence[0]!, title: 'Another title for the same page' }),
      (d) => resubmit(d, 's1', (s) => (s.title = 'One name in ten million')),
      (d) => resubmit(d, 's4', (s) => (s.question.fixedOrder = true)),
      (d) => (d.objectives[0] = { ...d.objectives[0]!, text: 'Trace binary search on a sorted list, step by step' }),
    ];
    const hashes = variants.map((edit) => {
      const draft = exampleDraft();
      edit(draft);
      const report = checkLesson(draft);
      expect(report.errors).toEqual([]);
      return report.hash;
    });
    expect(new Set([base, ...hashes]).size).toBe(variants.length + 1);
    // What is not published does not change it: the learner's words, timestamps, activity counters, unused evidence.
    const same = exampleDraft();
    same.learner.knows = 'Something else entirely.';
    same.learner.goal = 'Another goal.';
    same.updatedAt = '2027-01-01T00:00:00.000Z';
    same.activity.calls.submit_scene = 99;
    saveEvidence(same, buildEvidence(3));
    same.published = { fileName: 'x.html', hash: 'old', at: 'then' };
    expect(checkLesson(same).hash).toBe(base);
  });
});

describe('evidence across the lesson', () => {
  it('six uses of one excerpt are allowed and a seventh is not; basedOn is not a use', () => {
    expect(L.usesPerEvidence).toBe(6);
    const draft = exampleDraft();
    resubmit(draft, 's5', (s) => (s.blocks[2].basedOn = ['e2', 'e5', 'e1']));
    expect(checkLesson(draft).errors).toEqual([]);
    resubmit(draft, 's7', (s) => s.blocks.push({ type: 'claim', text: 'Each comparison is made against the middle element of a sorted array.', cites: ['e1'] }));
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['EVIDENCE_OVERUSED']);
    expect(report.errors[0]!.message).toContain('e1 is cited by 7 items');
    expect(report.errors[0]!.message).toContain('s7/blocks[4]');
    // Naming the same excerpt twice in one citation list is still one use.
    const twice = exampleDraft();
    resubmit(twice, 's1', (s) => (s.blocks[1].cites = ['e1', 'e1']));
    expect(checkLesson(twice).errors).toEqual([]);
  });

  it.each(['quick', 'standard', 'deep'] as Depth[])('a %s lesson must cite its minimum number of excerpts, and basedOn does not count', (depth) => {
    const min = DEPTHS[depth].evidenceMin;
    const kinds = { quick: 'nscr', standard: 'nscncr', deep: 'nscnscnscr' }[depth];
    const enough = stored(depth, K(kinds), { fill: 'min', evidence: min });
    expect(checkLesson(enough).errors).toEqual([]);
    expect(checkLesson(enough).stats.sources).toBe(min);

    const short = stored(depth, K(kinds), { fill: 'min', evidence: min - 1 });
    const report = checkLesson(short);
    expect(errorCodes(report)).toEqual(['EVIDENCE_TOO_FEW']);
    expect(report.errors[0]).toMatchObject({ got: String(min - 1), expected: `at least ${min}` });

    // Storing one more and pointing an example at it does not make it cited.
    saveEvidence(short, buildEvidence(39));
    const narration = short.scenes.find((s) => s.kind === 'narration') as any;
    narration.blocks.push({ type: 'example', text: 'A worked case of the idea, in my own words.', basedOn: [`e${min}`] });
    const padded = checkLesson(short);
    expect(errorCodes(padded)).toEqual(['EVIDENCE_TOO_FEW']);
    expect(padded.errors[0]!.fix).toContain('"basedOn" does not count as a citation');
    expect(padded.stats.sources).toBe(min);
  });

  it('warns when every source is on one site, with or without "www."', () => {
    const one = stored('quick', K('nscr'), { fill: 'min', singleHost: true });
    expect(codes(checkLesson(one))).toEqual(['SINGLE_HOST']);
    expect(checkLesson(one).ok).toBe(true);
    expect(checkLesson(one).stats.hosts).toBe(1);

    const www = stored('quick', K('nscr'), { fill: 'min', singleHost: true });
    www.evidence[0] = { ...www.evidence[0]!, url: www.evidence[0]!.url.replace('library.', 'www.library.'), host: `www.${www.evidence[0]!.host}` };
    expect(codes(checkLesson(www))).toEqual(['SINGLE_HOST']);

    const two = stored('quick', K('nscr'), { fill: 'min' });
    expect(codes(checkLesson(two))).toEqual([]);
    expect(checkLesson(two).stats.hosts).toBeGreaterThan(1);
  });

  it('warns when more than half the cited evidence is search snippets, not at exactly half', () => {
    const draft = stored('quick', K('nscr'), { fill: 'min', evidence: 4 });
    const snippets = (n: number): Draft => {
      const copy = structuredClone(draft);
      copy.evidence.slice(0, n).forEach((e) => (e.via = 'search_snippet'));
      return copy;
    };
    expect(checkLesson(snippets(0)).stats.sources).toBe(4);
    expect(codes(checkLesson(snippets(2)))).toEqual([]);
    const most = checkLesson(snippets(3));
    expect(codes(most)).toEqual(['MOSTLY_SNIPPETS']);
    expect(most.warnings[0]!.message).toBe('3 of 4 cited excerpts are search result snippets (e1, e2, e3).');
    expect(most.ok).toBe(true);
  });
});

describe('length and balance', () => {
  it.each([
    ['quick', 'nssscr', 1],
    ['standard', 'nssscsscr', 2],
    ['deep', 'nssscssscsscsscr', 3],
  ] as Array<[Depth, string, number]>)('%s: scenes that each fit their own budget can still add up to too much', (depth, kinds, objectives) => {
    const profile = DEPTHS[depth];
    // Every step at its own limit: within each scene's budget, far over the lesson's.
    const over = stored(depth, K(kinds), { fill: 'max', objectives });
    const report = checkLesson(over);
    expect(errorCodes(report)).toEqual(['LESSON_TOO_LONG']);
    expect(report.stats.words).toBeGreaterThan(profile.words.max);
    expect(report.errors[0]).toMatchObject({ got: String(report.stats.words), expected: `at most ${profile.words.max} words` });
    expect(report.errors[0]!.fix).toContain(`Cut at least ${report.stats.words - profile.words.max} words`);
    expect(warningCodes(report)).not.toContain('LESSON_LONG');
  });

  it('between the target and the limit there is a warning only', () => {
    const draft = stored('quick', K('nsscr'), { steps: 8 });
    const report = checkLesson(draft);
    expect(report.stats.words).toBeGreaterThan(DEPTHS.quick.words.warn);
    expect(report.stats.words).toBeLessThanOrEqual(DEPTHS.quick.words.max);
    expect(codes(report)).toEqual(['LESSON_LONG']);
    expect(report.ok).toBe(true);
  });

  it('framing and analogy may fill 30% of the prose, or 80 words in a short lesson', () => {
    expect(L.uncitedShare).toEqual({ share: 0.3, floorWords: 80 });
    const filler = (n: number) => ({ type: 'framing', text: `${Array.from({ length: n }, () => 'look').join(' ')}.` });
    const withFraming = (perScene: number[]) => {
      const draft = stored('quick', K('nncnr'), { fill: 'min', narrationFigures: false });
      const narrations = draft.scenes.filter((s) => s.kind === 'narration') as any[];
      perScene.forEach((n, i) => {
        if (n === 0) return;
        const scene = structuredClone(narrations[i]);
        scene.blocks.push(filler(n));
        expect(submit(draft, scene).errors).toEqual([]);
      });
      return checkLesson(draft);
    };
    const base = withFraming([0, 0, 0]);
    expect(base.errors).toEqual([]);
    expect(base.stats.words).toBe(78);
    // 80 of 158 words is half the lesson, and still allowed: the floor protects short lessons.
    const atFloor = withFraming([25, 25, 30]);
    expect(atFloor.errors).toEqual([]);
    expect(atFloor.stats.uncitedShare).toBeCloseTo(80 / 158, 3);
    const over = withFraming([25, 25, 31]);
    expect(errorCodes(over)).toEqual(['UNCITED_SHARE']);
    expect(over.errors[0]).toMatchObject({ got: '81', expected: 'at most 80 words' });
  });

  it('in a longer lesson the share is what counts', () => {
    // 204 words of claims and takeaways, to which framing is added step by step.
    const withFraming = (total: number) => {
      const draft = stored('standard', K('nscnscnscr'), { fill: 'min', steps: 4, objectives: 2 });
      expect(checkLesson(draft).stats).toMatchObject({ words: 204, uncitedShare: 0 });
      let left = total;
      for (const stored of draft.scenes.filter((s) => s.kind === 'step_through')) {
        const scene = structuredClone(stored) as any;
        for (const step of scene.steps) {
          const n = Math.min(25, left);
          if (n === 0) break;
          step.blocks.push({ type: 'framing', text: `${Array.from({ length: n }, () => 'look').join(' ')}.` });
          left -= n;
        }
        expect(submit(draft, scene).errors).toEqual([]);
      }
      expect(left).toBe(0);
      return checkLesson(draft);
    };
    // 87 of 291 words is 29.9%; 88 of 292 is 30.1%. Both are above the 80-word floor.
    const under = withFraming(87);
    expect(under.errors).toEqual([]);
    expect(under.stats).toMatchObject({ words: 291, uncitedShare: 0.299 });
    const over = withFraming(88);
    expect(errorCodes(over)).toEqual(['UNCITED_SHARE']);
    expect(over.errors[0]).toMatchObject({ got: '88', expected: 'at most 87 words' });
    expect(over.stats.uncitedShare).toBeGreaterThan(L.uncitedShare.share);
  });

  it('worked examples may fill 35% of the prose, or 120 words in a short lesson', () => {
    expect(L.exampleShare).toEqual({ share: 0.35, floorWords: 120 });
    const withExamples = (perScene: number[]) => {
      const draft = stored('quick', K('nncnr'), { fill: 'min', narrationFigures: false });
      const narrations = draft.scenes.filter((s) => s.kind === 'narration') as any[];
      perScene.forEach((n, i) => {
        const scene = structuredClone(narrations[i]);
        scene.blocks.push({ type: 'example', text: `${Array.from({ length: n }, () => 'try').join(' ')}.` });
        expect(submit(draft, scene).errors).toEqual([]);
      });
      return checkLesson(draft);
    };
    expect(withExamples([40, 40, 40]).errors).toEqual([]);
    const over = withExamples([40, 40, 41]);
    expect(errorCodes(over)).toEqual(['EXAMPLE_SHARE']);
    expect(over.errors[0]).toMatchObject({ got: '121', expected: 'at most 120 words' });
  });
});

describe('structure of the finished lesson', () => {
  it('a step-through keeps the learner active only if it asks for a prediction', () => {
    const withPredict = stored('quick', K('nsnncr'), { steps: 2 });
    expect(checkLesson(withPredict).errors).toEqual([]);
    const without = stored('quick', K('nsnncr'), { steps: 2, predict: false });
    const report = checkLesson(without);
    expect(errorCodes(report)).toEqual(['PASSIVE_RUN']);
    expect(report.errors[0]!.message).toContain('s1, s2, s3, s4');
    expect(report.errors[0]!.fix).toContain('Add a "predict" to a step of "s2"');
    // Three in a row are fine.
    expect(checkLesson(stored('quick', K('nsncr'), { steps: 2, predict: false })).errors).toEqual([]);
    // The recap counts as a scene with nothing to do.
    expect(errorCodes(checkLesson(stored('quick', K('ncnsnr'), { steps: 2, predict: false })))).toEqual(['PASSIVE_RUN']);
    expect(checkLesson(stored('quick', K('ncnsnr'), { steps: 2 })).errors).toEqual([]);
  });

  it('three narration scenes in a row are refused even in a stored plan', () => {
    expect(errorCodes(checkLesson(stored('quick', K('nnncr'))))).toEqual(['NARRATION_RUN']);
    expect(checkLesson(stored('quick', K('nncnr'))).errors).toEqual([]);
  });

  it('a figure and an apply-level checkpoint are required at standard and deep depth only', () => {
    const quick = stored('quick', K('ncnr'), { narrationFigures: false });
    for (const scene of quick.scenes) if (scene.kind === 'checkpoint') scene.level = 'recall';
    expect(checkLesson(quick).errors).toEqual([]);

    const standard = stored('standard', K('ncncncr'), { narrationFigures: false, objectives: 2 });
    expect(errorCodes(checkLesson(standard))).toEqual(['NO_FIGURE']);
    for (const scene of standard.scenes) if (scene.kind === 'checkpoint') scene.level = 'recall';
    expect(errorCodes(checkLesson(standard))).toEqual(['NO_FIGURE', 'NO_APPLY_CHECKPOINT']);

    const withFigure = stored('standard', K('ncncncr'), { narrationFigures: true, objectives: 2 });
    expect(checkLesson(withFigure).errors).toEqual([]);
    expect(checkLesson(withFigure).stats.figures).toBe(3);
  });

  it('every objective needs a checkpoint in the lesson itself', () => {
    const draft = exampleDraft();
    // Both remaining checkpoints assess o1.
    draft.outline[5] = { ...draft.outline[5]!, objective: 'o1' };
    resubmit(draft, 's6', (s) => (s.objective = 'o1'));
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['OBJECTIVE_UNASSESSED']);
    expect(report.errors[0]).toMatchObject({ got: 'o2' });
  });
});

describe('checkpoints ask about what was taught', () => {
  it('teaching is a claim, a quote or a figure of a narration or step-through; an example\'s basedOn is not', () => {
    const base = (): Draft => {
      const draft = exampleDraft();
      saveEvidence(draft, { url: 'https://example.org/algorithms/binary-search-steps', title: 'Steps (synthetic test source)', excerpt: 'One pass of binary search finds the middle element, compares it with the target and discards a half.', via: 'page' });
      resubmit(draft, 's8', (s) => (s.question.explanation.cites = ['e6']));
      return draft;
    };
    expect(errorCodes(checkLesson(base()))).toEqual(['CHECKPOINT_UNTAUGHT']);

    const viaBasedOn = base();
    resubmit(viaBasedOn, 's5', (s) => (s.blocks[2].basedOn = ['e6']));
    expect(errorCodes(checkLesson(viaBasedOn))).toEqual(['CHECKPOINT_UNTAUGHT']);

    const viaFigure = base();
    resubmit(viaFigure, 's2', (s) => (s.figure.cites = ['e1', 'e6']));
    expect(checkLesson(viaFigure).errors).toEqual([]);

    const viaQuote = base();
    resubmit(viaQuote, 's7', (s) => s.blocks.push({ type: 'quote', text: 'compares it with the target and discards a half', cite: 'e6' }));
    expect(checkLesson(viaQuote).errors).toEqual([]);

    const viaStep = base();
    resubmit(viaStep, 's3', (s) => s.steps[3].blocks.push({ type: 'claim', text: 'Each pass compares the middle element with the target and discards a half.', cites: ['e6'] }));
    expect(checkLesson(viaStep).errors).toEqual([]);

    // One taught excerpt among those cited is enough.
    const mixed = base();
    resubmit(mixed, 's8', (s) => (s.question.explanation.cites = ['e6', 'e1']));
    expect(checkLesson(mixed).errors).toEqual([]);
  });

  it('a recap or another checkpoint that cites the excerpt does not teach it', () => {
    const draft = exampleDraft();
    saveEvidence(draft, { url: 'https://example.org/algorithms/binary-search-steps', title: 'Steps (synthetic test source)', excerpt: 'One pass of binary search finds the middle element, compares it with the target and discards a half.', via: 'page' });
    resubmit(draft, 's8', (s) => (s.question.explanation.cites = ['e6']));
    resubmit(draft, 's4', (s) => (s.question.explanation.cites = ['e6', 'e1']));
    resubmit(draft, 's9', (s) => (s.takeaways[0].cites = ['e6']));
    expect(errorCodes(checkLesson(draft))).toEqual(['CHECKPOINT_UNTAUGHT']);
  });

  it('asking before teaching is a warning, and names the scene that teaches it', () => {
    const draft = exampleDraft();
    // An explanation that rests on e4, which only s7 teaches.
    resubmit(draft, 's4', (s) => (s.question.explanation = { text: 'Computing the midpoint as low plus half the distance cannot overflow, however large the array; the half without the target is then dropped.', cites: ['e4'] }));
    const report = checkLesson(draft);
    expect(report.errors).toEqual([]);
    expect(warningCodes(report)).toEqual(['CHECKPOINT_BEFORE_TAUGHT']);
    expect(report.warnings[0]).toMatchObject({ sceneId: 's4', path: 'question.explanation.cites' });
    expect(report.warnings[0]!.message).toBe('"s4" asks about e4 before "s7" teaches it.');
    expect(report.ok).toBe(true);
  });

  it('a model answer is held to the same rule as an explanation', () => {
    const draft = exampleDraft();
    saveEvidence(draft, buildEvidence(39));
    draft.outline[3] = { ...draft.outline[3]!, question: 'reflect' };
    resubmit(draft, 's4', (s) => (s.question = { ...structuredClone(EXAMPLE_QUESTIONS.reflect), modelAnswer: { text: 'Sorted order is what tells you which half the target is in.', cites: ['e6'] } }));
    const report = checkLesson(draft);
    expect(errorCodes(report)).toEqual(['CHECKPOINT_UNTAUGHT']);
    expect(report.errors[0]).toMatchObject({ sceneId: 's4', path: 'question.modelAnswer.cites' });
    expect(report.errors[0]!.message).toContain('The model answer of "s4" cites e6');
    // The same answer resting on what the lesson taught is fine.
    resubmit(draft, 's4', (s) => (s.question = structuredClone(EXAMPLE_QUESTIONS.reflect)));
    expect(checkLesson(draft).errors).toEqual([]);
  });
});

describe('many problems', () => {
  it('errors are capped with a count of the rest; warnings are all kept, for the receipt', () => {
    const draft = stored('deep', buildLesson({ depth: 'deep', size: 'max' }).plan.outline.map((o) => o.kind as SceneKind), { fill: 'max', objectives: 5 });
    const clean = checkLesson(draft);
    // Every step sits above its target: dozens of warnings, none dropped.
    expect(clean.warnings.length).toBeGreaterThan(MAX_ISSUES_PER_CALL);
    expect(clean.warnings.every((w) => w.code === 'WORDS_NEAR_BUDGET')).toBe(true);

    for (const scene of draft.scenes as any[]) {
      if (scene.kind !== 'step_through') continue;
      for (const step of scene.steps) step.blocks[0].cites = ['e77'];
    }
    const broken = checkLesson(draft);
    expect(broken.errors).toHaveLength(MAX_ISSUES_PER_CALL + 1);
    expect(broken.errors.slice(0, MAX_ISSUES_PER_CALL).every((e) => e.code === 'CITE_UNKNOWN')).toBe(true);
    const more = broken.errors[MAX_ISSUES_PER_CALL]!;
    expect(more.code).toBe('MORE_ISSUES');
    expect(more.severity).toBe('error');
    expect(more.message).toMatch(/^\d+ more errors not listed \(\d+ in total\)\.$/);
    expect(broken.ok).toBe(false);
  });
});
