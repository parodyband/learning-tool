// checkScene: one scene against the plan and the stored evidence. An error rejects the scene; the
// same function is run again on every stored scene by checkLesson, so nothing is trusted because
// it was accepted once.
import { AnyScene } from '../clip';
import { capIssues, issue } from '../issues';
import { parseInline } from '../markup';
import { MATH_HELP } from '../math';
import { PLAN_SCENE_KINDS, type OutlineEntry } from '../schema';
import { FRAME_TEMPLATE_CODE } from '../templates';
import { countWords } from '../text';
import type { Draft, Issue, SceneCheck, SceneMetrics } from '../types';
import { buildContext, type Ctx } from './context';
import { sceneFields, type CiteRef, type TextField } from './fields';
import { figureIssues, highlightIssues } from './figures';
import { checkBlocks, checkChartValues, checkNumbers, checkStageNames, checkStageValues, statementCount } from './grounding';
import { placeholderIssues } from './placeholders';
import { exploreIssues } from './explore';
import { pickGateIssues, predictIssues, questionIssues } from './questions';
import { fieldSafetyIssues, linesSafetyIssues } from './safety';
import { idList, nearest, parseShape, show } from './shape';
import { clipIssues, hasAction, stageParts } from './stage';
import { budgetFor, budgetIssues, metricsOf, sceneProse, type Prose } from './words';

/** What checkLesson needs to know about a scene beyond its issues. */
export interface SceneFacts {
  scene: AnyScene;
  prose: Prose;
  cites: CiteRef[];
  /** Paths of the cited statements with a weak match: "blocks[1]", "steps[0].blocks[2]", "takeaways[0]", "question.explanation". */
  weakClaims: string[];
  /** How many cited statements the scene has that are compared with their excerpts (claims, takeaways, an explanation or model answer). */
  statements: number;
  /** A step_through with at least one predict, or a clip with a gate (options or a tap) or an explore, asks the learner to do something. */
  hasPredict: boolean;
}

export interface SceneInspection extends SceneCheck {
  facts?: SceneFacts;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function plannedList(outline: readonly OutlineEntry[]): string {
  return outline.map((e) => `${e.id} (${e.kind})`).join(', ');
}

/** The scene's place in the plan: NO_PLAN is handled by the caller; this is the id and the kind. */
function fitIssues(id: unknown, kind: unknown, ctx: Ctx): { entry: OutlineEntry | undefined; issues: Issue[] } {
  const issues: Issue[] = [];
  if (typeof id !== 'string') return { entry: undefined, issues };
  const entry = ctx.outline.find((e) => e.id === id);
  if (!entry) {
    const guess = nearest(
      id,
      ctx.outline.map((e) => e.id),
    );
    issues.push(
      issue('SCENE_NOT_PLANNED', 'id', `The plan has no scene with the id "${show(id)}".`, {
        fix: `${guess ? `Did you mean "${guess}"? ` : ''}Planned scenes: ${plannedList(ctx.outline)}. Use one of these ids, or call plan_lesson again to add a scene.`,
        got: show(id),
      }),
    );
    return { entry: undefined, issues };
  }
  if (typeof kind === 'string' && (PLAN_SCENE_KINDS as readonly string[]).includes(kind) && kind !== entry.kind) {
    issues.push(
      issue('SCENE_KIND_MISMATCH', 'kind', `The plan says "${entry.id}" is a ${entry.kind}; this scene is a ${kind}.`, {
        fix: `Send a ${entry.kind} scene for "${entry.id}", or call plan_lesson again with "kind": "${kind}" for it.`,
        got: kind,
        expected: entry.kind,
      }),
    );
  }
  return { entry, issues };
}

function shapeMismatch(scene: AnyScene, entry: OutlineEntry, ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  const replan = (field: string, value: string): string => `or call plan_lesson again with "${field}": "${value}" for "${entry.id}"`;
  if (scene.kind === 'clip' && entry.stage !== undefined && scene.stage.kind !== entry.stage) {
    out.push(
      issue('SCENE_SHAPE_MISMATCH', 'stage.kind', `The plan gives "${entry.id}" a ${entry.stage} stage; this clip has a ${scene.stage.kind} stage.`, {
        fix: `Send a ${entry.stage} stage (the template from plan_lesson shows its fields), ${replan('stage', scene.stage.kind)}.`,
        got: scene.stage.kind,
        expected: entry.stage,
      }),
    );
  }
  if (scene.kind === 'narration' || scene.kind === 'step_through') {
    const got = scene.figure?.type;
    const want = entry.figure;
    if (got !== undefined && want === undefined) {
      out.push(
        issue('SCENE_SHAPE_MISMATCH', 'figure', `The plan has no figure for "${entry.id}", but this scene carries a ${got} figure.`, {
          fix: `Remove the figure, ${replan('figure', got)}.`,
          got,
          expected: 'no figure',
        }),
      );
    } else if (got === undefined && want !== undefined) {
      out.push(
        issue('SCENE_SHAPE_MISMATCH', 'figure', `The plan gives "${entry.id}" a ${want} figure, but this scene has none.`, {
          fix: `Add a ${want} figure (the template from plan_lesson shows its fields), or call plan_lesson again without a figure for "${entry.id}".`,
          got: 'no figure',
          expected: want,
        }),
      );
    } else if (got !== undefined && want !== undefined && got !== want) {
      out.push(
        issue('SCENE_SHAPE_MISMATCH', 'figure.type', `The plan gives "${entry.id}" a ${want} figure; this scene has a ${got} figure.`, {
          fix: `Send a ${want} figure, ${replan('figure', got)}.`,
          got,
          expected: want,
        }),
      );
    }
  }
  if (scene.kind === 'checkpoint') {
    if (entry.question !== undefined && scene.question.type !== entry.question) {
      out.push(
        issue('SCENE_SHAPE_MISMATCH', 'question.type', `The plan gives "${entry.id}" a ${entry.question} question; this scene has a ${scene.question.type} question.`, {
          fix: `Send a ${entry.question} question, ${replan('question', scene.question.type)}.`,
          got: scene.question.type,
          expected: entry.question,
        }),
      );
    }
    // An objective the plan does not have at all is reported as OBJECTIVE_UNKNOWN instead.
    if (entry.objective !== undefined && scene.objective !== entry.objective && ctx.objectives.some((o) => o.id === scene.objective)) {
      out.push(
        issue('SCENE_SHAPE_MISMATCH', 'objective', `The plan says "${entry.id}" assesses ${entry.objective}; this scene names ${scene.objective}.`, {
          fix: `Set "objective" to "${entry.objective}", ${replan('objective', scene.objective)}.`,
          got: scene.objective,
          expected: entry.objective,
        }),
      );
    }
  }
  return out;
}

function citeIssues(cites: readonly CiteRef[], ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  const stored = ctx.storedIds.length ? `Stored ids: ${idList(ctx.storedIds)}.` : 'No evidence is stored yet: call save_evidence first.';
  for (const ref of cites) {
    ref.ids.forEach((id, k) => {
      if (ctx.evidence.has(id)) return;
      const path = ref.path.endsWith('.cite') ? ref.path : `${ref.path}[${k}]`;
      out.push(
        issue('CITE_UNKNOWN', path, `This ${ref.what} ${ref.basedOn ? 'is based on' : 'cites'} "${id}", which is not a stored evidence id.`, {
          fix: `${stored} Use the id that save_evidence returned for the passage that supports this ${ref.what}.`,
          got: id,
        }),
      );
    });
  }
  return out;
}

function objectiveIssues(scene: AnyScene, ctx: Ctx): Issue[] {
  const out: Issue[] = [];
  const planned = ctx.objectives.map((o) => o.id);
  const unknown = (path: string, id: string): Issue =>
    issue('OBJECTIVE_UNKNOWN', path, `"${id}" is not an objective of the plan.`, {
      fix: `Use one of the planned objectives: ${planned.join(', ')}.`,
      got: id,
      expected: `one of ${planned.join(', ')}`,
    });

  if (scene.kind === 'checkpoint' && !planned.includes(scene.objective)) out.push(unknown('objective', scene.objective));
  if (scene.kind === 'recap') {
    const counts = new Map<string, number>(planned.map((id) => [id, 0]));
    scene.takeaways.forEach((takeaway, i) => {
      const n = counts.get(takeaway.objective);
      if (n === undefined) out.push(unknown(`takeaways[${i}].objective`, takeaway.objective));
      else counts.set(takeaway.objective, n + 1);
    });
    const missing = planned.filter((id) => counts.get(id) === 0);
    const repeated = planned.filter((id) => (counts.get(id) as number) > 1);
    if (missing.length > 0 || repeated.length > 0) {
      const parts = [missing.length ? `no takeaway for ${missing.join(', ')}` : '', repeated.length ? `more than one for ${repeated.join(', ')}` : ''].filter(Boolean);
      const add = missing.length ? `Add a takeaway with "objective": ${missing.map((id) => `"${id}"`).join(' and one with ')}` : '';
      const merge = repeated.length ? `merge the takeaways for ${repeated.join(', ')} into one each` : '';
      out.push(
        issue('RECAP_OBJECTIVES', 'takeaways', `The recap has ${parts.join(' and ')}; it needs exactly one for each planned objective (${planned.join(', ')}).`, {
          fix: `${[add, merge].filter(Boolean).join('; ')}.`,
        }),
      );
    }
  }
  return out;
}

function markupIssues(fields: readonly TextField[]): Issue[] {
  const out: Issue[] = [];
  for (const field of fields) {
    // A math span needs two "$"; most fields have none and are not parsed.
    if (!field.markup || field.text.indexOf('$') === field.text.lastIndexOf('$')) continue;
    for (const error of parseInline(field.text).errors) {
      out.push(
        issue('MARKUP_MATH', field.path, `The math span starting at character ${error.start + 1} of this ${field.what} does not parse: ${error.message}`, {
          fix: `${MATH_HELP} If a "$" was meant as a currency sign, write "\\$".`,
        }),
      );
    }
  }
  return out;
}

/** Word counts for a scene that did not parse, so a rejected scene still reports its size. */
function looseMetrics(clean: unknown, entry: OutlineEntry | undefined, lang: string): SceneMetrics | undefined {
  if (!isRecord(clean) || typeof clean.id !== 'string') return undefined;
  let words = 0;
  let cited = 0;
  let uncited = 0;
  const texts = (blocks: unknown): number => {
    if (!Array.isArray(blocks)) return 0;
    let n = 0;
    for (const block of blocks) {
      if (!isRecord(block)) continue;
      if (typeof block.text === 'string') n += countWords(block.text, lang);
      if (typeof block.limits === 'string') n += countWords(block.limits, lang);
      if (block.type === 'claim' || block.type === 'quote') cited++;
      else uncited++;
    }
    words += n;
    return n;
  };
  texts(clean.blocks);
  if (typeof clean.intro === 'string') words += countWords(clean.intro, lang);
  const steps = Array.isArray(clean.steps) ? clean.steps.map((step) => (isRecord(step) ? texts(step.blocks) : 0)) : undefined;
  if (Array.isArray(clean.takeaways)) for (const t of clean.takeaways) if (isRecord(t) && typeof t.text === 'string') words += countWords(t.text, lang);
  // A clip: one caption block for each beat.
  const beats = Array.isArray(clean.beats) ? clean.beats.map((beat) => (isRecord(beat) ? texts([beat.caption]) : 0)) : undefined;
  const kind = typeof clean.kind === 'string' ? clean.kind : entry?.kind;
  const budget = typeof kind === 'string' ? budgetFor({ kind, figure: clean.figure }) : null;
  const parts = kind === 'step_through' ? steps : kind === 'clip' ? beats : undefined;
  return { sceneId: show(clean.id), words, budget, ...(parts ? { steps: parts } : {}), citedBlocks: cited, uncitedBlocks: uncited };
}

function finish(found: Issue[], sceneId: string | undefined, capped: boolean): { errors: Issue[]; warnings: Issue[] } {
  if (sceneId !== undefined) for (const i of found) i.sceneId = sceneId;
  const errors = found.filter((i) => i.severity === 'error');
  const warnings = found.filter((i) => i.severity === 'warning');
  return capped ? { errors: capIssues(errors, 'error', sceneId), warnings: capIssues(warnings, 'warning', sceneId) } : { errors, warnings };
}

/** The checks behind checkScene, against a prepared context. `capped: false` returns every issue, for checkLesson. */
export function inspectScene(input: unknown, ctx: Ctx, capped: boolean): SceneInspection {
  if (!ctx.planned) {
    return { ok: false, errors: [
      issue('NO_PLAN', '', 'This lesson has no accepted plan, so a scene has nothing to fit.', {
        fix: 'Call plan_lesson with a title, objectives and an outline. It returns a template for each scene.',
      }),
    ], warnings: [] };
  }

  const shape = parseShape(AnyScene, input, { what: 'scene', evidenceIds: ctx.storedIds, objectiveIds: ctx.objectives.map((o) => o.id) });
  const loose = isRecord(shape.clean) ? shape.clean : {};
  const fit = fitIssues(shape.value?.id ?? loose.id, shape.value?.kind ?? loose.kind, ctx);
  const sceneId = typeof loose.id === 'string' && fit.entry ? fit.entry.id : undefined;

  if (!shape.value) {
    // An id the plan does not have is one mistake: say which ids are planned, not also that its form is wrong.
    const unplanned = fit.issues.some((i) => i.code === 'SCENE_NOT_PLANNED');
    const shapeIssues = unplanned ? shape.issues.filter((i) => !(i.code === 'BAD_ID' && i.path === 'id')) : shape.issues;
    const { errors, warnings } = finish([...fit.issues, ...shapeIssues], sceneId, capped);
    const metrics = looseMetrics(shape.clean, fit.entry, ctx.lang);
    return { ok: false, errors, warnings, ...(metrics ? { metrics } : {}) };
  }

  const scene = shape.value;
  const found: Issue[] = [...fit.issues];
  if (fit.entry && scene.kind === fit.entry.kind) found.push(...shapeMismatch(scene, fit.entry, ctx));

  // Quotes are rewritten to the excerpt's own characters first, so that everything after this
  // line (the safety checks, the word counts) sees the text that will be stored and shown.
  const blockIssues: Issue[] = [];
  const weakClaims = checkBlocks(scene, ctx, blockIssues);

  const { fields, cites, values } = sceneFields(scene);
  found.push(...placeholderIssues(fields));
  if (scene.kind === 'clip' && scene.stage.kind === 'frame' && scene.stage.code.trim() === FRAME_TEMPLATE_CODE.trim()) {
    found.push(
      issue('PLACEHOLDER_TEXT', 'stage.code', "This frame still holds the template's code: five bars that show nothing about the lesson.", {
        fix: 'Write the animation this clip is for, as the body of a function that declares `function render(ctx, t)`. If a typed stage can show the idea, call plan_lesson again with that stage kind instead.',
      }),
    );
  }
  found.push(...citeIssues(cites, ctx));
  found.push(...objectiveIssues(scene, ctx));
  found.push(...blockIssues);
  const prose = sceneProse(scene, ctx.lang);
  if ((scene.kind === 'narration' || scene.kind === 'step_through') && prose.citedBlocks === 0) {
    const narration = scene.kind === 'narration';
    const message = narration ? 'This narration scene has no claim and no quote, so nothing in it rests on a source.' : 'No step of this step_through has a claim or a quote, so nothing in it rests on a source.';
    found.push(
      issue('SCENE_NO_CITED_BLOCK', narration ? 'blocks' : 'steps', message, {
        fix: 'Add the fact the scene is about as a claim with "cites", or as a quote with "cite". Framing, analogies and examples are your own words and cannot carry a scene alone.',
      }),
    );
  }
  if (scene.kind === 'clip' && prose.citedBlocks === 0) {
    found.push(
      issue('SCENE_NO_CITED_BLOCK', 'beats', 'No caption of this clip is a claim or a quote, so nothing it says rests on a source.', {
        fix: 'Make the caption that states the fact the clip is about a claim with "cites", or a quote with "cite". Framing, analogies and examples are your own words and cannot carry a clip alone, whatever its stage cites.',
      }),
    );
  }

  checkNumbers(fields, ctx, found);
  // A stage marked "sourced": its numbers that are not text, and the names on it.
  checkStageValues(values, ctx, found);
  checkStageNames(fields, ctx, found);
  const figure = scene.kind === 'narration' || scene.kind === 'step_through' ? scene.figure : undefined;
  if (figure?.type === 'chart') checkChartValues(figure, ctx, found);

  const hosts = ctx.groundingHosts();
  for (const field of fields) found.push(...fieldSafetyIssues(field, hosts));
  // What only shows when the lines are read together: a command continued over lines, a blob split across them.
  if (figure?.type === 'lines') found.push(...linesSafetyIssues(figure.lines));
  found.push(...markupIssues(fields));

  if (figure) found.push(...figureIssues(figure));
  if (scene.kind === 'step_through') {
    found.push(...highlightIssues(scene.figure, scene.steps));
    scene.steps.forEach((step, i) => {
      if (step.predict) found.push(...predictIssues(step.predict, `steps[${i}].predict`));
    });
  }
  if (scene.kind === 'clip') {
    found.push(...clipIssues(scene, ctx, hosts));
    scene.beats.forEach((beat, i) => {
      if (!beat.gate) return;
      found.push(...('pick' in beat.gate ? pickGateIssues(beat.gate, `beats[${i}].gate`) : predictIssues(beat.gate, `beats[${i}].gate`)));
    });
    found.push(...exploreIssues(scene, stageParts(scene.stage)));
  }
  found.push(...budgetIssues(scene, prose));
  if (scene.kind === 'checkpoint') found.push(...questionIssues(scene.question, 'question'));

  const { errors, warnings } = finish(found, scene.id, capped);
  const metrics = metricsOf(scene, prose);
  const asks = (scene.kind === 'step_through' && scene.steps.some((s) => s.predict !== undefined)) || (scene.kind === 'clip' && hasAction(scene));
  const facts: SceneFacts = { scene, prose, cites, weakClaims, statements: statementCount(scene), hasPredict: asks };
  if (errors.length > 0) return { ok: false, metrics, errors, warnings, facts };
  return { ok: true, scene, metrics, errors, warnings, facts };
}

/** Check one submitted scene. On success `scene` is what to store: defaults applied, quotes in the excerpt's own characters. */
export function checkScene(input: unknown, draft: Draft): SceneCheck {
  const { facts: _facts, ...check } = inspectScene(input, buildContext(draft), true);
  return check;
}
