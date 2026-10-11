// Word accounting. "Prose" is what the learner reads as the lesson's telling: block texts (the
// captions of a clip are blocks), a step-through's intro, what an explore tells the learner to do,
// and the recap's takeaways. Questions, feedback, figure labels and state
// panels are not prose: the time they take is the interaction, which the depth profile budgets
// separately (lesson prose is sized at about 60% of lesson time).
import { issue } from '../issues';
import { LIMITS as L } from '../limits';
import { CLIP_LIMITS } from '../clip-base';
import type { AnyScene } from '../clip';
import type { Block } from '../schema';
import { countWords } from '../text';
import type { Issue, SceneMetrics, WordBudget } from '../types';

export interface Prose {
  /** Claims, quotes and takeaways. */
  cited: number;
  /** Framing, analogies with their limits, intros, and what an explore tells the learner to do (its prompt and its goal). */
  uncited: number;
  /** Worked examples. */
  example: number;
  total: number;
  /** Words of each step, for a step_through; words of each beat's caption, for a clip. */
  steps: number[];
  claims: number;
  quotes: number;
  citedBlocks: number;
  uncitedBlocks: number;
  /**
   * Of `uncited`: what an explore tells the learner, beside the clip's captions: its prompt and
   * the text of its goal. They are statements of the agent's own, read as part of the lesson, so
   * they count in the lesson's total and in its uncited share, but in no caption's budget.
   */
  interactive: number;
}

/**
 * The prose of an explore: its prompt and what its goal asks for. Like a framing line, each is a
 * sentence the agent wrote and no passage supports, standing on the page as part of the lesson.
 *
 * What is NOT prose here is what is not prose anywhere in a lesson (see the top of this file): a
 * question and the feedback to an answer. So a tap gate's prompt and its two replies are counted
 * no more than the prompt and the feedback of a gate by options are, a goal's `done` (said once
 * the goal is reached: feedback) is not, and a control's label is a label. All of them are still
 * held to the checks on text and to the rule on numbers (./fields).
 */
export function interactiveTexts(scene: AnyScene): string[] {
  if (scene.kind !== 'clip' || !scene.explore) return [];
  return [scene.explore.prompt, ...(scene.explore.goal ? [scene.explore.goal.text] : [])];
}

function addBlocks(blocks: readonly Block[], lang: string, into: Prose): number {
  let words = 0;
  for (const block of blocks) {
    let n = countWords(block.text, lang);
    switch (block.type) {
      case 'claim':
        into.cited += n;
        into.claims++;
        into.citedBlocks++;
        break;
      case 'quote':
        into.cited += n;
        into.quotes++;
        into.citedBlocks++;
        break;
      case 'analogy':
        n += countWords(block.limits, lang);
        into.uncited += n;
        into.uncitedBlocks++;
        break;
      case 'example':
        into.example += n;
        into.uncitedBlocks++;
        break;
      case 'framing':
        into.uncited += n;
        into.uncitedBlocks++;
        break;
    }
    words += n;
  }
  return words;
}

export function sceneProse(scene: AnyScene, lang: string): Prose {
  const p: Prose = { cited: 0, uncited: 0, example: 0, total: 0, steps: [], claims: 0, quotes: 0, citedBlocks: 0, uncitedBlocks: 0, interactive: 0 };
  switch (scene.kind) {
    case 'narration':
      addBlocks(scene.blocks, lang, p);
      break;
    case 'step_through':
      if (scene.intro !== undefined) p.uncited += countWords(scene.intro, lang);
      for (const step of scene.steps) p.steps.push(addBlocks(step.blocks, lang, p));
      break;
    case 'checkpoint':
      break;
    case 'recap':
      for (const takeaway of scene.takeaways) p.cited += countWords(takeaway.text, lang);
      break;
    case 'clip':
      // An analogy's limits are read with it, so they count towards its caption.
      for (const beat of scene.beats) p.steps.push(addBlocks([beat.caption], lang, p));
      for (const text of interactiveTexts(scene)) p.interactive += countWords(text, lang);
      p.uncited += p.interactive;
      break;
  }
  p.total = p.cited + p.uncited + p.example;
  return p;
}

/**
 * A word budget that says what it is measured over. A narration scene is budgeted as a whole, a
 * step_through step by step and a clip caption by caption; without `per`, "70" beside a five-step
 * scene of 200 words reads as a limit that was broken. The extra field travels with the numbers to
 * the agent.
 */
export type SceneBudget = WordBudget & { per: 'scene' | 'step' | 'beat' };

/**
 * The budget for a scene of this kind: per beat (one caption) for a clip, per scene for a
 * narration (smaller beside a figure), per step for a step_through.
 */
export function budgetFor(entry: { kind: string; figure?: unknown }): SceneBudget | null {
  if (entry.kind === 'clip') return { ...L.captionWords, per: 'beat' };
  if (entry.kind === 'narration') return { ...(entry.figure !== undefined ? L.narrationWithFigureWords : L.narrationWords), per: 'scene' };
  if (entry.kind === 'step_through') return { ...L.stepWords, per: 'step' };
  return null;
}

/**
 * What a scene measures against its budget. A step_through also reports the words of each step,
 * in order, because that is what its budget applies to: `words` alone (the scene's total, intro
 * included) cannot be compared with a per-step limit. A clip reports the words of each beat's
 * caption in the same field, for the same reason.
 */
export function metricsOf(scene: AnyScene, prose: Prose): SceneMetrics {
  const perPart = scene.kind === 'step_through' || scene.kind === 'clip';
  return { sceneId: scene.id, words: prose.total, budget: budgetFor(scene), ...(perPart ? { steps: [...prose.steps] } : {}), citedBlocks: prose.citedBlocks, uncitedBlocks: prose.uncitedBlocks };
}

function budgetIssue(path: string, what: string, words: number, budget: WordBudget, splitHint: string): Issue | null {
  if (words > budget.max) {
    return issue('WORDS_OVER_BUDGET', path, `This ${what} has ${words} words; the limit is ${budget.max}.`, {
      fix: `Cut at least ${words - budget.max} words. ${splitHint}`,
      got: String(words),
      expected: `at most ${budget.max} words`,
    });
  }
  if (words > budget.warn) {
    return issue('WORDS_NEAR_BUDGET', path, `This ${what} has ${words} words; the target is ${budget.warn} or fewer (limit ${budget.max}).`, {
      fix: `Fine if every sentence is needed. Otherwise trim about ${words - budget.warn} words.`,
      got: String(words),
      expected: `at most ${budget.warn} words`,
    });
  }
  return null;
}

/** WORDS_OVER_BUDGET and WORDS_NEAR_BUDGET: per narration scene, per step of a step_through, and per caption of a clip. */
export function budgetIssues(scene: AnyScene, prose: Prose): Issue[] {
  const out: Issue[] = [];
  if (scene.kind === 'narration') {
    const withFigure = scene.figure !== undefined;
    const found = budgetIssue(
      'blocks',
      withFigure ? 'narration scene with a figure' : 'narration scene',
      prose.total,
      withFigure ? L.narrationWithFigureWords : L.narrationWords,
      withFigure ? 'Leave to the figure what the figure shows, or move part of the text to another scene by planning again.' : 'A scene this long holds more than one idea: move part of it to another scene by planning again.',
    );
    if (found) out.push(found);
  } else if (scene.kind === 'step_through') {
    prose.steps.forEach((words, i) => {
      const found = budgetIssue(`steps[${i}].blocks`, `step (step ${i + 1})`, words, L.stepWords, `Split it into two steps (a step_through may have up to ${L.steps.max}).`);
      if (found) out.push(found);
    });
  } else if (scene.kind === 'clip') {
    const room = scene.beats.length < CLIP_LIMITS.beats.max ? ` or split the beat in two (a clip may have up to ${CLIP_LIMITS.beats.max})` : '';
    prose.steps.forEach((words, i) => {
      const analogy = scene.beats[i]?.caption.type === 'analogy' ? ' (an analogy is counted with its limits)' : '';
      const found = budgetIssue(`beats[${i}].caption`, `caption (beat ${i + 1})${analogy}`, words, L.captionWords, `A caption is one short line, read while the picture moves: say only what the picture cannot${room}.`);
      if (found) out.push(found);
    });
  }
  return out;
}
