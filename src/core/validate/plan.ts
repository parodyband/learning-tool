// checkPlan: the outline, before any scene is written. The plan fixes order, kinds and shapes, so
// structural problems (nothing to do for four scenes, an objective nobody tests) are caught while
// they cost one call to fix.
import { AnyScene } from '../clip';
import { capIssues, issue } from '../issues';
import { DEPTHS, LIMITS as L } from '../limits';
import { GRADED_QUESTION_TYPES, PLAN_STAGE_KINDS, PlanInput, type Depth, type OutlineEntry } from '../schema';
import type { Draft, Issue, PlanCheck, WordBudget } from '../types';
import { buildContext, usableEvidence } from './context';
import { objectiveNumberIssues } from './grounding';
import { textSafetyIssues } from './safety';
import { parseShape } from './shape';
import { budgetFor } from './words';

const list = (items: readonly string[]): string => items.join(', ');

/** True when an accepted scene still has the id, kind and shape the outline entry plans. */
export function fitsEntry(scene: AnyScene, entry: OutlineEntry): boolean {
  if (scene.id !== entry.id || scene.kind !== entry.kind) return false;
  switch (scene.kind) {
    case 'clip':
      return scene.stage.kind === entry.stage;
    case 'narration':
      return (scene.figure?.type ?? null) === (entry.figure ?? null);
    case 'step_through':
      return scene.figure.type === entry.figure;
    case 'checkpoint':
      return scene.question.type === entry.question && scene.objective === entry.objective;
    case 'recap':
      return true;
  }
}

export interface PlanRuleOptions {
  /**
   * Leave out the four rules that checkLesson states in terms of the finished lesson
   * (NARRATION_RUN, PASSIVE_RUN, NO_FIGURE, OBJECTIVE_UNASSESSED), so one defect has one code.
   */
  forLesson?: boolean;
}

/** The plan rules, on a plan that already has the right shape. */
export function planRules(plan: PlanInput, depth: Depth, options: PlanRuleOptions = {}): Issue[] {
  const out: Issue[] = [];
  const profile = DEPTHS[depth] ?? DEPTHS.standard;
  const { objectives, outline } = plan;
  const n = outline.length;

  if (n < profile.scenes.min || n > profile.scenes.max) {
    const fix =
      n < profile.scenes.min
        ? `Add ${profile.scenes.min - n} more scene${profile.scenes.min - n === 1 ? '' : 's'}: a ${depth} lesson has ${profile.scenes.min} to ${profile.scenes.max}.`
        : `Merge or remove ${n - profile.scenes.max} scene${n - profile.scenes.max === 1 ? '' : 's'}, or start a new lesson at a deeper depth: a ${depth} lesson has ${profile.scenes.min} to ${profile.scenes.max}.`;
    out.push(
      issue('PLAN_SCENE_COUNT', 'outline', `The outline has ${n} scene${n === 1 ? '' : 's'}; a ${depth} lesson needs ${profile.scenes.min} to ${profile.scenes.max}.`, {
        fix,
        got: String(n),
        expected: `${profile.scenes.min} to ${profile.scenes.max}`,
      }),
    );
  }

  const m = objectives.length;
  if (m < profile.objectives.min || m > profile.objectives.max) {
    const fix =
      m < profile.objectives.min
        ? `Add ${profile.objectives.min - m} more: a ${depth} lesson has ${profile.objectives.min} to ${profile.objectives.max} objectives.`
        : `Keep the ${profile.objectives.max} the learner needs most and cut ${m - profile.objectives.max}: a ${depth} lesson has ${profile.objectives.min} to ${profile.objectives.max} objectives.`;
    out.push(
      issue('PLAN_OBJECTIVE_COUNT', 'objectives', `The plan has ${m} objective${m === 1 ? '' : 's'}; a ${depth} lesson needs ${profile.objectives.min} to ${profile.objectives.max}.`, {
        fix,
        got: String(m),
        expected: `${profile.objectives.min} to ${profile.objectives.max}`,
      }),
    );
  }

  const wantIds = objectives.map((_, i) => `o${i + 1}`);
  const gotIds = objectives.map((o) => o.id);
  if (gotIds.some((id, i) => id !== wantIds[i])) {
    out.push(
      issue('PLAN_OBJECTIVE_IDS', 'objectives', `Objective ids must run o1, o2, ... in order; the plan has ${list(gotIds)}.`, {
        fix: `Number them ${list(wantIds)}, and use the same ids in the checkpoints.`,
        got: list(gotIds),
        expected: list(wantIds),
      }),
    );
  }
  const objectiveIds = new Set(gotIds);

  const firstAt = new Map<string, number>();
  outline.forEach((entry, i) => {
    const first = firstAt.get(entry.id);
    if (first === undefined) firstAt.set(entry.id, i);
    else out.push(
      issue('PLAN_DUPLICATE_ID', `outline[${i}].id`, `The scene id "${entry.id}" is used by outline[${first}] and outline[${i}].`, {
        fix: 'Give each scene its own id, for example s1, s2, ... in order.',
        got: entry.id,
      }),
    );
  });

  // A lesson opens by showing something: a clip, or in a lesson of the older kinds a narration.
  const first = outline[0];
  if (first && first.kind !== 'clip' && first.kind !== 'narration') {
    out.push(
      issue('PLAN_FIRST_SCENE', 'outline[0].kind', `The first scene ("${first.id}") is a ${first.kind}; a lesson opens with a clip.`, {
        fix: 'Put a clip first, to set up the idea before anything is asked: a "words" stage makes a cold open on the question the lesson answers.',
        got: first.kind,
        expected: 'clip',
      }),
    );
  }

  const recaps = outline.flatMap((entry, i) => (entry.kind === 'recap' ? [i] : []));
  if (recaps.length === 0) {
    out.push(
      issue('PLAN_LAST_SCENE', 'outline', 'The outline has no recap scene.', {
        fix: 'Add one scene of kind "recap" as the last entry of the outline.',
        expected: 'one recap, last',
      }),
    );
  } else if (recaps.length > 1) {
    out.push(
      issue('PLAN_LAST_SCENE', `outline[${recaps[1]}].kind`, `The outline has ${recaps.length} recap scenes (${list(recaps.map((i) => `outline[${i}]`))}); a lesson has exactly one.`, {
        fix: 'Keep one recap, as the last entry, and remove or change the others.',
        got: String(recaps.length),
        expected: 'one recap, last',
      }),
    );
  } else if (recaps[0] !== n - 1) {
    const at = recaps[0] as number;
    const after = n - 1 - at;
    out.push(
      issue('PLAN_LAST_SCENE', `outline[${at}].kind`, `The recap is outline[${at}], but ${after} ${after === 1 ? 'scene comes' : 'scenes come'} after it.`, {
        fix: 'Move the recap to the end of the outline.',
        expected: 'one recap, last',
      }),
    );
  }

  const assessed = new Set<string>();
  let checkpoints = 0;
  let graded = 0;
  outline.forEach((entry, i) => {
    const at = `outline[${i}]`;
    if (entry.kind === 'checkpoint') {
      const missing = [entry.question === undefined ? 'question' : '', entry.objective === undefined ? 'objective' : ''].filter(Boolean);
      if (missing.length > 0) {
        out.push(
          issue('PLAN_CHECKPOINT_FIELDS', at, `The checkpoint "${entry.id}" has no ${missing.join(' and no ')}.`, {
            fix: `Add ${missing.map((k) => (k === 'question' ? '"question" (single, order, numeric or reflect)' : `"objective" (one of ${list(wantIds)})`)).join(' and ')}.`,
          }),
        );
      }
      if (entry.objective !== undefined) {
        if (objectiveIds.has(entry.objective)) assessed.add(entry.objective);
        else out.push(
          issue('PLAN_CHECKPOINT_FIELDS', `${at}.objective`, `The checkpoint "${entry.id}" assesses "${entry.objective}", which is not an objective of this plan.`, {
            fix: `Use one of the planned objectives: ${list(gotIds)}.`,
            got: entry.objective,
            expected: `one of ${list(gotIds)}`,
          }),
        );
      }
      if (entry.question !== undefined) {
        checkpoints++;
        if (GRADED_QUESTION_TYPES.includes(entry.question)) graded++;
      }
      if (entry.figure !== undefined) out.push(
        issue('PLAN_FIELD_NOT_ALLOWED', `${at}.figure`, `The checkpoint "${entry.id}" plans a figure; a checkpoint holds a question only.`, {
          fix: 'Remove "figure" from this entry. To show a picture, plan a clip before the checkpoint.',
          got: entry.figure,
        }),
      );
      if (entry.stage !== undefined) out.push(stageNotAllowed(entry, at));
      if (entry.mark !== undefined) out.push(markNotAllowed(entry, at));
      return;
    }
    if (entry.question !== undefined) out.push(
      issue('PLAN_FIELD_NOT_ALLOWED', `${at}.question`, `The ${entry.kind} scene "${entry.id}" plans a question; only a checkpoint has one.`, {
        fix: 'Remove "question" from this entry, or make the scene a checkpoint.',
        got: entry.question,
      }),
    );
    if (entry.objective !== undefined) out.push(
      issue('PLAN_FIELD_NOT_ALLOWED', `${at}.objective`, `The ${entry.kind} scene "${entry.id}" names an objective; only a checkpoint assesses one.`, {
        fix: 'Remove "objective" from this entry.',
        got: entry.objective,
      }),
    );
    if (entry.kind === 'recap' && entry.figure !== undefined) out.push(
      issue('PLAN_FIELD_NOT_ALLOWED', `${at}.figure`, `The recap "${entry.id}" plans a figure; a recap holds takeaways only.`, {
        fix: 'Remove "figure" from this entry.',
        got: entry.figure,
      }),
    );
    if (entry.kind === 'step_through' && entry.figure === undefined) out.push(
      issue('PLAN_STEP_FIGURE', at, `The step_through "${entry.id}" names no figure type.`, {
        fix: 'Add "figure" with the type it steps through: flow, sequence, layers, timeline, compare, chart or lines.',
      }),
    );
    if (entry.kind === 'clip') {
      if (entry.stage === undefined) out.push(
        issue('PLAN_CLIP_STAGE', at, `The clip "${entry.id}" names no stage kind.`, {
          fix: `Add "stage" with the kind of stage the clip plays on: ${list(PLAN_STAGE_KINDS)}.`,
          expected: `one of ${list(PLAN_STAGE_KINDS)}`,
        }),
      );
      if (entry.figure !== undefined) out.push(
        issue('PLAN_FIELD_NOT_ALLOWED', `${at}.figure`, `The clip "${entry.id}" plans a figure; the picture of a clip is its stage.`, {
          fix: entry.stage === undefined ? 'Remove "figure" and name the kind of stage with "stage".' : 'Remove "figure" from this entry: "stage" already says what the clip shows.',
          got: entry.figure,
        }),
      );
    } else if (entry.stage !== undefined) out.push(stageNotAllowed(entry, at));
    if (entry.mark !== undefined && !(entry.kind === 'clip' && entry.stage === 'chart')) out.push(markNotAllowed(entry, at));
  });

  // What code draws cannot be checked against a source, so a lesson may lean on a frame only so far.
  const frames = outline.flatMap((entry, i) => (entry.kind === 'clip' && entry.stage === 'frame' ? [i] : []));
  if (frames.length > L.framesPerLesson) {
    const ids = frames.map((i) => (outline[i] as OutlineEntry).id);
    out.push(
      issue('PLAN_TOO_MANY_FRAMES', `outline[${frames[L.framesPerLesson]}].stage`, `${frames.length} clips have a custom frame for a stage (${list(ids)}); a lesson may have at most ${L.framesPerLesson}.`, {
        fix: `Give ${frames.length - L.framesPerLesson} of them a typed stage (sequence, cells, dots, chart, flow, words, lines or timeline): what a typed stage shows is checked against the passages it cites, and what code draws cannot be. Keep the frame for what no typed stage can show.`,
        got: String(frames.length),
        expected: `at most ${L.framesPerLesson}`,
      }),
    );
  }

  if (!options.forLesson) {
    for (const o of objectives) {
      if (assessed.has(o.id)) continue;
      out.push(
        issue('PLAN_OBJECTIVE_UNASSESSED', 'outline', `No checkpoint assesses objective ${o.id}.`, {
          fix: `Add a checkpoint with "objective": "${o.id}", or drop ${o.id} from the objectives.`,
          got: o.id,
        }),
      );
    }
  }

  if (checkpoints > 0 && graded * 2 < checkpoints) {
    out.push(
      issue('PLAN_GRADED_SHARE', 'outline', `${graded} of ${checkpoints} checkpoints use a graded question type; at least half must.`, {
        fix: `Change ${Math.ceil(checkpoints / 2) - graded} reflect checkpoint${Math.ceil(checkpoints / 2) - graded === 1 ? '' : 's'} to single, order or numeric, or add graded checkpoints.`,
        got: `${graded} of ${checkpoints}`,
        expected: `at least ${Math.ceil(checkpoints / 2)} of ${checkpoints}`,
      }),
    );
  }

  if (!options.forLesson) {
    // A stretch with nothing to do is reported once, under its broader name; a run of narrations
    // inside it is the same defect and is not listed again.
    // A clip can carry a prediction, as a step_through can, so at plan time it counts as something
    // to do; the finished lesson is held to it (PASSIVE_RUN asks for the prediction itself).
    const covered = new Array<boolean>(n).fill(false);
    for (const run of runs(outline, (e) => e.kind !== 'checkpoint' && e.kind !== 'step_through' && e.kind !== 'clip')) {
      if (run.length <= L.passiveRun) continue;
      for (let i = run.start; i < run.start + run.length; i++) covered[i] = true;
      const ids = outline.slice(run.start, run.start + run.length).map((e) => e.id);
      out.push(
        issue('PLAN_PASSIVE_RUN', `outline[${run.start + L.passiveRun}]`, `Scenes ${list(ids)} come in a row with no checkpoint, no clip and no step_through (${run.length}; at most ${L.passiveRun} are allowed).`, {
          fix: `Put a checkpoint or a clip among them, no later than position ${run.start + L.passiveRun + 1} of the outline.`,
          got: String(run.length),
          expected: `at most ${L.passiveRun}`,
        }),
      );
    }
    for (const run of runs(outline, (e) => e.kind === 'narration')) {
      if (run.length <= L.narrationRun || covered[run.start]) continue;
      const ids = outline.slice(run.start, run.start + run.length).map((e) => e.id);
      out.push(
        issue('PLAN_NARRATION_RUN', `outline[${run.start + L.narrationRun}]`, `Scenes ${list(ids)} are ${run.length} narration scenes in a row; at most ${L.narrationRun} are allowed.`, {
          fix: `Make "${ids[L.narrationRun]}" a step_through or a checkpoint, or move one between them.`,
          got: String(run.length),
          expected: `at most ${L.narrationRun}`,
        }),
      );
    }

    // The stage of a clip is its figure.
    if (profile.requireFigure && !outline.some((e) => e.kind === 'clip' || e.kind === 'step_through' || (e.kind === 'narration' && e.figure !== undefined))) {
      const candidate = outline.find((e) => e.kind === 'narration');
      out.push(
        issue('PLAN_NO_FIGURE', 'outline', `A ${depth} lesson needs at least one figure, and the outline plans none.`, {
          // A lesson with a narration scene is one of the older kinds, and is answered in its own terms.
          fix: candidate
            ? `Add "figure" to a narration entry (for example "${candidate.id}") with the type that fits the idea, or plan a step_through.`
            : 'Plan a clip: its stage is the figure.',
        }),
      );
    }
  }
  return out;
}

function stageNotAllowed(entry: OutlineEntry, at: string): Issue {
  return issue('PLAN_FIELD_NOT_ALLOWED', `${at}.stage`, `The ${entry.kind} scene "${entry.id}" plans a stage; only a clip has one.`, {
    fix: 'Remove "stage" from this entry, or make the scene a clip.',
    got: entry.stage as string,
  });
}

function markNotAllowed(entry: OutlineEntry, at: string): Issue {
  const clip = entry.kind === 'clip';
  return issue('PLAN_FIELD_NOT_ALLOWED', `${at}.mark`, clip ? `The clip "${entry.id}" plans a mark, but its stage is ${entry.stage === undefined ? 'not named' : `"${entry.stage}"`}; only a chart has one.` : `The ${entry.kind} scene "${entry.id}" plans a mark; only a clip on a chart stage has one.`, {
    fix: clip ? 'Remove "mark" from this entry, or set "stage" to "chart": "mark" says which chart (bars, line or curve) the template shows.' : 'Remove "mark" from this entry.',
    got: entry.mark as string,
  });
}

/** Maximal stretches of consecutive entries that satisfy `test`. */
export function runs<T>(items: readonly T[], test: (item: T) => boolean): { start: number; length: number }[] {
  const out: { start: number; length: number }[] = [];
  let start = -1;
  for (let i = 0; i <= items.length; i++) {
    const inside = i < items.length && test(items[i] as T);
    if (inside && start === -1) start = i;
    if (!inside && start !== -1) {
      out.push({ start, length: i - start });
      start = -1;
    }
  }
  return out;
}

/**
 * The lesson's topic is published under the title, so it is held to the same address and command
 * checks. It is fixed by start_lesson: the way out of a refusal is a new lesson.
 */
export function topicIssues(topic: unknown, when: 'start' | 'lesson' = 'start'): Issue[] {
  if (typeof topic !== 'string') return [];
  const found = textSafetyIssues(topic, 'topic', 'lesson topic');
  if (when === 'lesson') for (const i of found) i.fix = `${i.fix} The topic is set by start_lesson and cannot be changed afterwards: start a new lesson whose topic names the subject in plain words.`;
  return found;
}

/** Text of the plan that the learner will read: no addresses and no dangerous commands there either. */
export function planTextIssues(plan: PlanInput): Issue[] {
  const out: Issue[] = [];
  out.push(...textSafetyIssues(plan.title, 'title', 'lesson title'));
  plan.objectives.forEach((o, i) => out.push(...textSafetyIssues(o.text, `objectives[${i}].text`, 'objective')));
  return out;
}

/** Check a plan against the depth profile and the structure rules, and say which accepted scenes it orphans. */
export function checkPlan(input: unknown, draft: Draft): PlanCheck {
  const shape = parseShape(PlanInput, input, { what: 'plan' });
  if (!shape.value) return { ok: false, errors: capIssues(shape.issues, 'error'), warnings: [] };
  const plan = shape.value;

  const errors = [...planRules(plan, draft.depth), ...planTextIssues(plan)];
  const warnings: Issue[] = [];
  if (usableEvidence(draft).length === 0) {
    warnings.push(
      issue('PLAN_BEFORE_RESEARCH', '', 'No evidence is stored yet, so this plan was not shaped by what the sources say.', {
        fix: 'Research, call save_evidence, then call plan_lesson again with an outline built around what the sources support.',
      }),
    );
  }
  if (errors.length > 0) return { ok: false, errors: capIssues(errors, 'error'), warnings };

  // A number in an objective has to be in a passage the finished lesson cites. That can only be
  // judged at the end, so here it is a warning against what is stored now: the agent hears of it
  // while rewording the objective costs nothing.
  warnings.push(...objectiveNumberIssues(plan.objectives, buildContext({ ...draft, title: plan.title, objectives: plan.objectives, outline: plan.outline }), 'plan'));

  const budgets: Record<string, WordBudget | null> = {};
  for (const entry of plan.outline) budgets[entry.id] = budgetFor(entry);

  const entries = new Map(plan.outline.map((e) => [e.id, e] as const));
  const orphans: string[] = [];
  for (const stored of Array.isArray(draft.scenes) ? (draft.scenes as unknown[]) : []) {
    // Anything in the store that is not a scene cannot fit a plan either.
    const parsed = AnyScene.safeParse(stored);
    const id = parsed.success ? parsed.data.id : typeof (stored as { id?: unknown } | null)?.id === 'string' ? (stored as { id: string }).id : null;
    if (id === null || orphans.includes(id)) continue;
    const entry = entries.get(id);
    if (!parsed.success || !entry || !fitsEntry(parsed.data, entry)) orphans.push(id);
  }
  return { ok: true, plan, budgets, orphans, errors: [], warnings };
}
