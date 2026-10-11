// The example lesson is the reference for everyone: the skill shows it, the renderer draws it.
// It must go through the validator the way a real lesson does and come out clean.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_EVIDENCE, EXAMPLE_FIGURES, EXAMPLE_PLAN, EXAMPLE_QUESTIONS, EXAMPLE_SCENES, EXAMPLE_START } from '../../src/core/examples';
import { hashLesson } from '../../src/core/hash';
import { DEPTHS, LIMITS as L } from '../../src/core/limits';
import { FIGURE_TYPES, FORMAT, Lesson, QUESTION_TYPES } from '../../src/core/schema';
import { templateFor } from '../../src/core/templates';
import { checkEvidence, checkLesson, checkPlan, checkScene, draftFromLesson, verifyLesson } from '../../src/core/validate';
import { exampleDraft as helperDraft, exampleStats } from '../helpers/example';
import { applyPlan, exampleDraft, newDraft, saveEvidence } from './helpers';

describe('the example lesson passes every rule', () => {
  it('every evidence item is accepted, with its host computed', () => {
    const draft = newDraft();
    for (const item of EXAMPLE_EVIDENCE) {
      const check = checkEvidence(item, draft);
      expect(check.errors).toEqual([]);
      expect(check.warnings).toEqual([]);
      expect(check.evidence).toMatchObject({ url: item.url, excerpt: item.excerpt, host: new URL(item.url).hostname });
      saveEvidence(draft, item);
    }
    expect(draft.evidence.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
  });

  it('the plan is accepted, with a budget for each scene and no orphans', () => {
    const draft = newDraft();
    for (const item of EXAMPLE_EVIDENCE) saveEvidence(draft, item);
    const check = checkPlan(EXAMPLE_PLAN, draft);
    expect(check.errors).toEqual([]);
    expect(check.warnings).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.plan).toEqual(EXAMPLE_PLAN);
    expect(check.orphans).toEqual([]);
    // Each budget says what it is measured over: a narration scene as a whole, a step_through step by step.
    expect(check.budgets).toEqual({
      s1: { ...L.narrationWords, per: 'scene' },
      s2: { ...L.narrationWithFigureWords, per: 'scene' },
      s3: { ...L.stepWords, per: 'step' },
      s4: null,
      s5: { ...L.narrationWithFigureWords, per: 'scene' },
      s6: null,
      s7: { ...L.narrationWords, per: 'scene' },
      s8: null,
      s9: null,
    });
  });

  it.each(EXAMPLE_SCENES.map((s) => [s.id, s] as const))('scene %s is accepted with no error and no warning', (_id, scene) => {
    const draft = newDraft();
    for (const item of EXAMPLE_EVIDENCE) saveEvidence(draft, item);
    applyPlan(draft, EXAMPLE_PLAN);
    const check = checkScene(scene, draft);
    expect(check.errors).toEqual([]);
    expect(check.warnings).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.scene?.id).toBe(scene.id);
    expect(check.metrics?.sceneId).toBe(scene.id);
  });

  it('the whole lesson is complete, clean and assembled', () => {
    const report = checkLesson(exampleDraft());
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report).toMatchObject({ ok: true, complete: true, pending: [], weakClaims: [] });
    expect(report.stats).toEqual({ scenes: 9, words: 349, minutes: 8, claims: 8, quotes: 1, sources: 5, pages: 5, hosts: 3, checkpoints: 3, figures: 3, uncitedShare: 0.249, exampleShare: 0.266, weakClaims: 0 });
    // The helper every other area renders and tests with states the same numbers.
    expect(report.stats).toEqual(exampleStats());
    expect(report.stats.words).toBeLessThanOrEqual(DEPTHS.standard.words.warn);

    const lesson = report.lesson!;
    expect(Lesson.safeParse(lesson).success).toBe(true);
    expect(lesson.format).toBe(FORMAT);
    expect(lesson.scenes.map((s) => s.id)).toEqual(EXAMPLE_PLAN.outline.map((o) => o.id));
    expect(lesson.evidence.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(lesson.level).toBe(EXAMPLE_START.learner.level);
    expect(report.hash).toBe(hashLesson(lesson));
    expect(report.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('carries nothing of the learner profile but the level', () => {
    const json = JSON.stringify(checkLesson(exampleDraft()).lesson);
    expect(json).not.toContain('Writes simple loops');
    expect(json).not.toContain('Write binary search from memory and explain');
    expect(json).not.toContain('Start at the top and check each one');
    expect(json).not.toContain('calibration');
  });

  it('the draft built by the shared test helper passes too', () => {
    const report = checkLesson(helperDraft());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('no excerpt is used more often than allowed, with none to spare for the most used', () => {
    const report = checkLesson(exampleDraft());
    const uses = new Map<string, number>();
    const visit = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(visit);
      if (!v || typeof v !== 'object') return;
      for (const [key, child] of Object.entries(v)) {
        if (key === 'cites') for (const id of child as string[]) uses.set(id, (uses.get(id) ?? 0) + 1);
        else if (key === 'cite') uses.set(child as string, (uses.get(child as string) ?? 0) + 1);
        else visit(child);
      }
    };
    visit(report.lesson!.scenes);
    expect(Math.max(...uses.values())).toBeLessThanOrEqual(L.usesPerEvidence);
    expect([...uses.keys()].sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
  });
});

describe('every example figure and question is valid in a scene', () => {
  it.each(FIGURE_TYPES.map((t) => [t] as const))('figure %s beside a narration', (type) => {
    const draft = exampleDraft();
    draft.outline[1]!.figure = type;
    const scene = { ...structuredClone(EXAMPLE_SCENES[1]!), figure: structuredClone(EXAMPLE_FIGURES[type]) };
    const check = checkScene(scene, draft);
    expect(check.errors).toEqual([]);
    expect(check.warnings).toEqual([]);
  });

  it.each(QUESTION_TYPES.map((t) => [t] as const))('question %s in a checkpoint', (type) => {
    const draft = exampleDraft();
    draft.outline[3]!.question = type;
    const scene = { ...structuredClone(EXAMPLE_SCENES[3]!), question: structuredClone(EXAMPLE_QUESTIONS[type]) };
    const check = checkScene(scene, draft);
    expect(check.errors).toEqual([]);
    expect(check.warnings).toEqual([]);
  });
});

describe('what is stored can be checked again and gives itself back', () => {
  it('checkScene on an accepted scene returns the same scene', () => {
    const draft = exampleDraft();
    for (const stored of draft.scenes) {
      const again = checkScene(structuredClone(stored), draft);
      expect(again.ok).toBe(true);
      expect(again.scene).toEqual(stored);
    }
  });

  it('checkLesson does not change the draft it is given', () => {
    const draft = exampleDraft();
    const before = JSON.stringify(draft);
    checkLesson(draft);
    checkLesson(draft);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('a published lesson re-validates from its own data, to the same hash', () => {
    const report = checkLesson(exampleDraft());
    const fromFile: unknown = JSON.parse(JSON.stringify(report.lesson));
    const verified = verifyLesson(fromFile);
    expect(verified.errors).toEqual([]);
    expect(verified.ok).toBe(true);
    expect(verified.hash).toBe(report.hash);
    expect(verified.lesson).toEqual(report.lesson);
    expect(verified.stats).toEqual(report.stats);
  });

  it('a lesson edited after publishing does not verify', () => {
    const report = checkLesson(exampleDraft());
    const edits: Array<[string, (l: any) => void]> = [
      ['a claim reworded with a number its source does not have', (l) => (l.scenes[0].blocks[1].text = 'Binary search looks at the middle of a sorted array 900 times.')],
      ['a quote changed by one word', (l) => (l.scenes[6].blocks[1].text = 'the half that is discarded will contain the target')],
      ['an excerpt rewritten', (l) => (l.evidence[2].excerpt = 'Binary search works on any data, sorted or not, and the result is always reliable.')],
      ['a source address pointed elsewhere', (l) => (l.evidence[0].url = 'https://evil.invalid/algorithms/binary-search')],
      ['an address added to the prose', (l) => (l.scenes[0].blocks[0].text = 'Go to https://evil.invalid/ and enter your password.')],
      ['an unknown field added', (l) => (l.scenes[0].script = 'alert(1)')],
      ['a scene removed', (l) => l.scenes.splice(4, 1)],
      ['a different case in a quote, which validation would rewrite', (l) => (l.scenes[6].blocks[1].text = 'The half that is discarded may contain the target')],
      ['evidence the lesson never cites added', (l) => l.evidence.push({ ...l.evidence[0], id: 'e6', url: 'https://example.org/other', excerpt: 'Another passage that no scene of this lesson cites at all.' })],
    ];
    for (const [what, edit] of edits) {
      const copy = JSON.parse(JSON.stringify(report.lesson));
      edit(copy);
      const verified = verifyLesson(copy);
      expect(verified.ok, what).toBe(false);
      expect(verified.errors.length, what).toBeGreaterThan(0);
      expect(verified.lesson, what).toBeUndefined();
    }
  });

  it('draftFromLesson rebuilds a plan that checkPlan accepts', () => {
    const lesson = checkLesson(exampleDraft()).lesson!;
    const draft = draftFromLesson(lesson);
    const check = checkPlan({ title: draft.title, objectives: draft.objectives, outline: draft.outline }, draft);
    expect(check.errors).toEqual([]);
    expect(check.orphans).toEqual([]);
  });
});

describe('templates', () => {
  it('a template submitted as it stands is refused, with the placeholders named', () => {
    // A template is a shape to fill in. Its placeholder text cites e1 for things e1 does not say.
    const draft = exampleDraft();
    const check = checkScene(templateFor(draft.outline[0]!), draft);
    expect(check.ok).toBe(false);
    expect(check.errors.map((e) => e.code)).toContain('QUOTE_NOT_FOUND');
  });
});
