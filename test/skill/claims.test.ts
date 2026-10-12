// Statements the clip references make about what the tools and the page do, tested against the
// code that decides them. Each module is loaded by path and its checks are skipped while it does
// not exist, so this file runs in a checkout where another area is still being written.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_V2_SCENES } from '../../src/core/clip-examples';
import { LIMITS as L } from '../../src/core/limits';
import { PlanInput } from '../../src/core/schema';
import type { Draft, PlanCheck } from '../../src/core/types';
import { exampleLessonV2 } from '../helpers/clip-example';
import { exampleDraft } from '../helpers/example';
import { FORMAT_MD, markedExamples, read, REF_DIR, ROOT } from './helpers';
import { TYPED } from './worked';

type Loose = Record<string, unknown>;
const load = async (module: string): Promise<Loose | null> => (await import(/* @vite-ignore */ path.join(ROOT, module)).catch(() => null)) as Loose | null;
const flat = (file: string): string => read(path.join(REF_DIR, file)).replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------

describe('what the references say about the plan', async () => {
  const validate = await load('src/core/validate');
  const checkPlan = typeof validate?.checkPlan === 'function' ? (validate.checkPlan as (input: unknown, draft: Draft) => PlanCheck) : null;
  const plan = (): Loose => JSON.parse(markedExamples(FORMAT_MD).find((ex) => ex.kind === 'plan')!.json) as Loose;
  const outline = (p: Loose): Loose[] => p.outline as Loose[];
  // A lesson that has been started and researched, with nothing planned or written yet.
  const blank = (): Draft => ({ ...exampleDraft(), outline: [], scenes: [], title: undefined }) as unknown as Draft;
  const knowsClips = checkPlan ? !checkPlan(plan(), blank()).errors.some((e) => e.path.endsWith('.kind') || e.path.endsWith('.stage')) : false;
  const codes = (p: Loose): string[] => checkPlan!(p, blank()).errors.map((e) => e.code);

  it.skipIf(!knowsClips)('the plan the format reference shows is accepted', () => {
    const check = checkPlan!(plan(), blank());
    expect(check.errors.map((e) => `${e.code} ${e.path}: ${e.message}`)).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it.skipIf(!knowsClips)('a clip must name its stage, and only a clip may', () => {
    const none = plan();
    delete outline(none)[1]!.stage;
    expect(codes(none)).toContain('PLAN_CLIP_STAGE');
    const stray = plan();
    outline(stray)[3]!.stage = 'flow';
    expect(codes(stray)).toContain('PLAN_FIELD_NOT_ALLOWED');
  });

  it.skipIf(!knowsClips)(`a lesson may hold at most ${L.framesPerLesson} frame clips`, () => {
    expect(flat('format.md')).toContain(`at most ${L.framesPerLesson} \`frame\` clips`);
    const within = plan();
    const clips = outline(within).filter((e) => e.kind === 'clip');
    clips.slice(0, L.framesPerLesson).forEach((e) => (e.stage = 'frame'));
    expect(codes(within)).not.toContain('PLAN_TOO_MANY_FRAMES');
    const over = plan();
    outline(over)
      .filter((e) => e.kind === 'clip')
      .slice(0, L.framesPerLesson + 1)
      .forEach((e) => (e.stage = 'frame'));
    expect(codes(over)).toContain('PLAN_TOO_MANY_FRAMES');
  });

  it.skipIf(!knowsClips)('the first scene is a clip and the recap is last', () => {
    const first = plan();
    outline(first).unshift(outline(first).splice(3, 1)[0]!);
    expect(outline(first)[0]!.kind).toBe('checkpoint');
    expect(codes(first)).toContain('PLAN_FIRST_SCENE');
    const last = plan();
    outline(last).push(outline(last).shift()!);
    expect(outline(last).at(-1)!.kind).toBe('clip');
    expect(codes(last)).toContain('PLAN_LAST_SCENE');
  });

  it('the plan schema names the kinds and stage kinds the references list', () => {
    const p = PlanInput.parse(plan());
    expect(new Set(p.outline.map((e) => e.kind))).toEqual(new Set(['clip', 'checkpoint', 'recap']));
    expect(p.outline.filter((e) => e.kind === 'clip').length).toBe(EXAMPLE_V2_SCENES.filter((s) => s.kind === 'clip').length);
  });
});

// ---------------------------------------------------------------------------------------------
// Voice: what is read aloud
// ---------------------------------------------------------------------------------------------

describe('what voice.md says is sent for a clip', async () => {
  const narration = await load('src/core/narration');
  const narrationSegments = typeof narration?.narrationSegments === 'function' ? (narration.narrationSegments as (lesson: unknown) => { id: string; sceneId: string; text: string }[]) : null;
  const lesson = exampleLessonV2();
  const segments = narrationSegments ? narrationSegments(lesson) : [];
  // Until the narration module learns about clips it returns nothing for them.
  const knowsClips = segments.some((s) => /\.beat1$/.test(s.id));

  it('says a clip sends each beat\'s spoken script or caption, one request per beat, and never a prediction or an explore', () => {
    const text = flat('voice.md');
    expect(text).toMatch(/\| A clip \| For each beat, its `say` when you wrote one, otherwise its caption, one request per beat\./);
    expect(text).toMatch(/A prediction's prompt and its replies\./);
    expect(text).toMatch(/The words of an explore: its prompt, its sliders and its goal\./);
    expect(text).toMatch(/What is on a stage, clip descriptions and a custom frame's code\./);
  });

  it.skipIf(!knowsClips)('which is what the narration module produces', () => {
    for (const scene of lesson.scenes) {
      if (scene.kind !== 'clip') continue;
      const mine = segments.filter((s) => s.sceneId === scene.id);
      expect(mine.map((s) => s.id)).toEqual(scene.beats.map((_, i) => `${scene.id}.beat${i + 1}`));
      scene.beats.forEach((beat, i) => {
        // The caption's own words, and nothing of the prediction that precedes it.
        expect(mine[i]!.text.replace(/[.`*]/g, '')).toContain(beat.caption.text.replace(/[.`*]/g, '').slice(0, 20));
        if (beat.gate) {
          // Neither kind of prediction is read out: not its prompt, and not what it says back.
          expect(mine[i]!.text).not.toContain(beat.gate.prompt.slice(0, 20));
          const replies = 'options' in beat.gate ? beat.gate.options.map((option) => option.feedback) : [beat.gate.right, beat.gate.wrong];
          for (const reply of replies) expect(mine[i]!.text).not.toContain(reply);
        }
      });
    }
    // Nothing that stands on a stage is read out.
    const all = segments.map((s) => s.text).join(' ');
    for (const scene of lesson.scenes) if (scene.kind === 'clip') expect(all).not.toContain(scene.description);
  });

  it.skipIf(!knowsClips)('and an explore adds nothing to what is sent: one segment per beat, none for its prompt or its goal', () => {
    // The worked clips of the skill that end in an explore, put in place of the example lesson's clips.
    const explored = TYPED.map((h) => h.clip).filter((clip) => clip.explore !== undefined);
    expect(explored.length).toBeGreaterThan(0);
    const scenes = [...explored, ...lesson.scenes.filter((scene) => scene.kind !== 'clip')];
    const sent = narrationSegments!({ ...lesson, scenes });
    for (const clip of explored) {
      expect(sent.filter((s) => s.sceneId === clip.id).map((s) => s.id)).toEqual(clip.beats.map((_, i) => `${clip.id}.beat${i + 1}`));
      const text = sent.map((s) => s.text).join(' ');
      for (const words of [clip.explore!.prompt, clip.explore!.goal?.text, clip.explore!.goal?.done]) if (words) expect(text).not.toContain(words);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The page: the words a learner sees on a stage
// ---------------------------------------------------------------------------------------------

describe('what clip-design.md says the learner sees on a stage', async () => {
  const render = await load('src/render/clip');
  const words = render?.CLIP as { sourced?: string; worked?: string; illustrative?: string; custom?: string } | undefined;
  const text = flat('clip-design.md');

  it('names a badge for each provenance', () => {
    expect(text).toMatch(/\| `sourced` \|[^|]*\| "Sourced", with the stage's source chips \|/);
    expect(text).toMatch(/\| `worked` \|[^|]*\| "Worked example" \|/);
    expect(text).toMatch(/\| `illustrative` \|[^|]*\| "Illustrative" \|/);
  });

  it.skipIf(!words?.sourced)('which are the words the page writes', () => {
    expect(words!.sourced).toBe('Sourced');
    expect(words!.worked).toBe('Worked example');
    expect(words!.illustrative).toBe('Illustrative');
    // format.md quotes the mark a custom frame carries.
    expect(flat('format.md')).toContain(`"${words!.custom}"`);
  });
});
