// checkLesson: the whole draft, and the single source of truth for "may this be published".
//
// It trusts nothing that was accepted earlier. The plan is checked again, every stored scene goes
// through the scene checks again against the draft as it is now, and only then are the rules about
// the lesson as a whole applied. When all of that passes it assembles the Lesson that is rendered
// and hashes it.
import { AnyScene, LessonV2 } from '../clip';
import { capIssues, issue } from '../issues';
import { canonicalJson, sha256Hex, utf8 } from '../hash';
import { DEPTHS, LIMITS as L } from '../limits';
import { FORMAT, GRADED_QUESTION_TYPES, PlanInput, type Depth, type Evidence, type OutlineEntry } from '../schema';
import type { Draft, Issue, LessonReport, LessonStats } from '../types';
import { buildContext, byEvidenceId, comparableHost, type Ctx, type EvidenceInfo } from './context';
import { normalizeSourceUrl } from './evidence';
import { sceneFields, type CiteRef } from './fields';
import { objectiveNumberIssues } from './grounding';
import { planRules, planTextIssues, runs, topicIssues } from './plan';
import { inspectScene, type SceneFacts } from './scene';
import { idList, parseShape, show } from './shape';
import { DATA_STAGE_KINDS, couldExplore, hasAction, stageName } from './stage';

/**
 * The time estimate, in minutes:
 *
 *   words / 200
 *   + 1.0 for each graded checkpoint (single, order, numeric)
 *   + 1.5 for each reflect checkpoint (writing an answer, then reading the model answer)
 *   + 0.25 for each beat of a clip (watching what the caption says happen)
 *   + 0.5 for each prediction (a gate of a clip, by options or by a tap; a predict of a step)
 *   + 0.75 for each explore (dragging the sliders until the goal is reached)
 *   and, in a lesson of the older kinds, + 0.25 for each step of a step-through and + 0.5 for
 *   each figure of a narration or step-through scene. A clip has no step or figure term: its
 *   beats are the time its picture takes.
 *
 * rounded to the nearest minute, and at least 1 for a lesson with any scene. Prose is counted at
 * 200 words a minute, slower than plain silent reading, because it is read to be learned and with
 * a picture beside it. Most of a lesson's time is spent answering, watching and looking, which an
 * earlier estimate hardly counted: lessons planned as ten minutes were reported as six. The same
 * formula is printed in the LESSON_LONG fix, so an agent can see where its minutes come from.
 */
export const MINUTES = { wordsPerMinute: 200, gradedCheckpoint: 1, reflectCheckpoint: 1.5, predict: 0.5, step: 0.25, figure: 0.5, beat: 0.25, gate: 0.5, explore: 0.75 } as const;
const MINUTES_FORMULA = `prose words / ${MINUTES.wordsPerMinute}, plus ${MINUTES.gradedCheckpoint} for each graded checkpoint, ${MINUTES.reflectCheckpoint} for each reflect checkpoint, ${MINUTES.predict} for each predict, ${MINUTES.step} for each step and ${MINUTES.figure} for each figure, rounded; a clip counts ${MINUTES.beat} for each beat, ${MINUTES.gate} for each gate and ${MINUTES.explore} for an explore in place of steps and a figure`;

export interface MinuteCounts {
  words: number;
  gradedCheckpoints: number;
  reflectCheckpoints: number;
  /** Predicts of step-through steps. */
  predicts: number;
  steps: number;
  /** Figures of narration and step-through scenes. A clip is counted by its beats instead. */
  figures: number;
  /** Beats of clips. */
  beats?: number;
  /** Gates (predictions, by options or by a tap) of clips. */
  gates?: number;
  /** Clips that end in an explore. */
  explores?: number;
}

/** Estimated learner minutes for a lesson with these counts (see `MINUTES`). */
export function estimateMinutes(c: MinuteCounts): number {
  const minutes =
    c.words / MINUTES.wordsPerMinute +
    c.gradedCheckpoints * MINUTES.gradedCheckpoint +
    c.reflectCheckpoints * MINUTES.reflectCheckpoint +
    c.predicts * MINUTES.predict +
    c.steps * MINUTES.step +
    c.figures * MINUTES.figure +
    (c.beats ?? 0) * MINUTES.beat +
    (c.gates ?? 0) * MINUTES.gate +
    (c.explores ?? 0) * MINUTES.explore;
  return Math.max(1, Math.round(minutes));
}

/** The scenes that teach: what a checkpoint may ask about, and where claims are made. */
const teaches = (scene: AnyScene): boolean => scene.kind === 'clip' || scene.kind === 'narration' || scene.kind === 'step_through';

const round = (x: number): number => Math.round(x * 1000) / 1000;
const list = (items: readonly string[]): string => items.join(', ');
/** A list that may be long, cut so that one issue stays one readable sentence. */
const some = (items: readonly string[], max = 10): string => (items.length <= max ? list(items) : `${list(items.slice(0, max))} and ${items.length - max} more`);

function emptyStats(): LessonStats {
  return { scenes: 0, words: 0, minutes: 0, claims: 0, quotes: 0, sources: 0, pages: 0, hosts: 0, checkpoints: 0, figures: 0, uncitedShare: 0, exampleShare: 0, weakClaims: 0 };
}

/** The planned scenes that are stored, latest submission of each id, in outline order. A scene the outline no longer plans is not part of the lesson. */
function storedScenes(draft: Draft, outline: readonly OutlineEntry[]): { planned: OutlineEntry[]; stored: Map<string, unknown> } {
  const stored = new Map<string, unknown>();
  for (const scene of Array.isArray(draft.scenes) ? (draft.scenes as unknown[]) : []) {
    if (scene && typeof scene === 'object' && typeof (scene as { id?: unknown }).id === 'string') stored.set((scene as { id: string }).id, scene);
  }
  const planned = outline.filter((entry, i) => outline.findIndex((e) => e.id === entry.id) === i);
  return { planned, stored };
}

interface Uses {
  /** For each cited evidence id, the items that cite it, as "<sceneId>/<path>": a block, a figure, an explanation, a model answer, a takeaway, or a clip ("<sceneId>/clip"). */
  by: Map<string, string[]>;
  /** Ids an example points at with `basedOn`. A pointer is published but is not a use. */
  basedOn: Set<string>;
}

/** What a clip is called as one citing item. */
const CLIP_ITEM = 'clip';

/**
 * Who cites what. One item citing an id twice is one use; an id that is not stored is nobody's use.
 *
 * A clip is ONE item, however many of its captions and its stage cite the same excerpt. A clip
 * says in three captions of a line each what a narration scene says in one claim block, and a
 * count per caption would charge an excerpt three uses for it (the example lesson would cite one
 * passage ten times); it would also reward moving facts out of cited captions. So the limit reads:
 * one passage may support at most `usesPerEvidence` clips, explanations, model answers and
 * takeaways (and, in a lesson of the older kinds, blocks and figures).
 */
function citingItems(scenes: readonly { id: string; cites: readonly CiteRef[]; clip?: boolean }[], ctx: Ctx): Uses {
  const by = new Map<string, string[]>();
  const basedOn = new Set<string>();
  for (const scene of scenes) {
    for (const ref of scene.cites) {
      for (const id of new Set(ref.ids)) {
        if (!ctx.evidence.has(id)) continue;
        if (ref.basedOn) {
          basedOn.add(id);
          continue;
        }
        const item = `${scene.id}/${scene.clip ? CLIP_ITEM : ref.owner}`;
        const items = by.get(id) ?? [];
        if (!items.includes(item)) by.set(id, [...items, item]);
      }
    }
  }
  return { by, basedOn };
}

/**
 * Evidence ids grouped by passage. Two ids whose excerpts are the same text in comparison form
 * hold one passage, whatever their URLs say: storing a passage again under "?ref=1" does not make
 * it a second source, and does not buy six more uses of it.
 */
function passages(ids: readonly string[], ctx: Ctx): string[][] {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const text = (ctx.evidence.get(id) as EvidenceInfo).canonical();
    groups.set(text, [...(groups.get(text) ?? []), id]);
  }
  return [...groups.values()];
}

/** The items that cite any id of one passage, each counted once. This is the number EVIDENCE_OVERUSED limits. */
function pooledUses(group: readonly string[], uses: Uses): string[] {
  return [...new Set(group.flatMap((id) => uses.by.get(id) ?? []))];
}

/**
 * How many items (clips, explanations, model answers, takeaways, and the blocks and figures of
 * narration and step-through scenes) of the planned, stored scenes cite each stored evidence id,
 * counted exactly as EVIDENCE_OVERUSED counts them: a clip is one item whatever in it cites the
 * excerpt, an example's `basedOn` is not a use, and ids that hold the same passage share one
 * count. Every stored id is listed, an unused one with 0, in id order. The limit is
 * `LIMITS.usesPerEvidence`.
 */
export function evidenceUses(draft: Draft): Record<string, number> {
  const ctx = buildContext(draft);
  const { planned, stored } = storedScenes(draft, ctx.outline);
  const scenes: { id: string; cites: CiteRef[]; clip: boolean }[] = [];
  for (const entry of planned) {
    if (!stored.has(entry.id)) continue;
    // Read as checkLesson reads a stored scene; one that no longer has the shape of a scene cites nothing.
    const scene = parseShape(AnyScene, stored.get(entry.id), { what: 'scene' }).value;
    if (scene) scenes.push({ id: scene.id, cites: sceneFields(scene).cites, clip: scene.kind === 'clip' });
  }
  const uses = citingItems(scenes, ctx);
  const out: Record<string, number> = {};
  for (const group of passages(ctx.storedIds, ctx)) {
    const n = pooledUses(group, uses).length;
    for (const id of group) out[id] = n;
  }
  return Object.fromEntries(ctx.storedIds.map((id) => [id, out[id] ?? 0]));
}

/** The address a source is counted under as a page: its normal form, or the stored text when that does not parse. */
function pageOf(ev: Evidence): string {
  const source = typeof ev.url === 'string' ? normalizeSourceUrl(ev.url) : null;
  return source && source.ok ? source.url : String(ev.url);
}

function failed(errors: Issue[]): LessonReport {
  return { ok: false, complete: false, pending: [], errors: capIssues(errors, 'error'), warnings: [], stats: emptyStats(), weakClaims: [] };
}

/** Check the whole draft. `ok` is true only when every planned scene is accepted and nothing is in error. */
export function checkLesson(draft: Draft): LessonReport {
  if (!Array.isArray(draft.outline) || draft.outline.length === 0 || typeof draft.title !== 'string' || draft.title === '') {
    return failed([
      issue('NO_PLAN', '', 'This lesson has no accepted plan.', {
        fix: 'Call plan_lesson with a title, objectives and an outline, then submit each planned scene.',
      }),
    ]);
  }

  // The plan, once more. Without a plan of the right shape there is nothing to hold the scenes against.
  const plan = parseShape(PlanInput, { title: draft.title, objectives: draft.objectives, outline: draft.outline }, { what: 'plan' });
  if (!plan.value) return failed(plan.issues);
  const outline: OutlineEntry[] = plan.value.outline;

  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  // An unknown depth is reported when the lesson is assembled; until then the middle profile stands in.
  const depth: Depth = typeof draft.depth === 'string' && Object.prototype.hasOwnProperty.call(DEPTHS, draft.depth) ? draft.depth : 'standard';
  const profile = DEPTHS[depth];
  // Rules that have a lesson-level form below are left to that form.
  errors.push(...planRules(plan.value, depth, { forLesson: true }), ...planTextIssues(plan.value), ...topicIssues(draft.topic, 'lesson'));

  const { planned, stored } = storedScenes(draft, outline);
  const pending = planned.filter((entry) => !stored.has(entry.id)).map((entry) => entry.id);
  const complete = pending.length === 0;

  // What the lesson references decides what is published, and uncited text may rest only on that.
  const referenced = new Set<string>();
  if (complete) {
    for (const entry of planned) {
      const parsed = AnyScene.safeParse(stored.get(entry.id));
      if (parsed.success) for (const ref of sceneFields(parsed.data).cites) for (const id of ref.ids) referenced.add(id);
    }
  }
  // The checks below see the plan as parsed, so a damaged entry in the store cannot derail them.
  const view: Draft = { ...draft, title: plan.value.title, objectives: plan.value.objectives, outline };
  const ctx = buildContext(view, complete ? { groundingIds: referenced } : {});

  const facts: SceneFacts[] = [];
  let unreadable = 0;
  for (const entry of planned) {
    if (!stored.has(entry.id)) continue;
    const result = inspectScene(stored.get(entry.id), ctx, false);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (result.facts) facts.push(result.facts);
    else unreadable++;
  }

  if (!complete) {
    errors.push(
      issue('LESSON_INCOMPLETE', '', `${pending.length} of ${planned.length} planned scenes ${pending.length === 1 ? 'has' : 'have'} not been accepted: ${list(pending)}.`, {
        fix: `Call submit_scene for ${list(pending)}. The lesson can be published once every planned scene is accepted.`,
        got: String(planned.length - pending.length),
        expected: String(planned.length),
      }),
    );
  }

  // ----- what the scenes add up to
  const weakClaims: string[] = [];
  let words = 0;
  let uncited = 0;
  let interactiveWords = 0;
  let example = 0;
  let claims = 0;
  let quotes = 0;
  let checkpoints = 0;
  let graded = 0;
  let figures = 0;
  let clips = 0;
  let steps = 0;
  let predicts = 0;
  let beats = 0;
  let gates = 0;
  let explores = 0;
  let statements = 0;
  const weakBlocks: string[] = [];
  for (const f of facts) {
    if (f.scene.kind === 'step_through') {
      steps += f.scene.steps.length;
      predicts += f.scene.steps.filter((step) => step.predict !== undefined).length;
    }
    if (f.scene.kind === 'clip') {
      clips++;
      beats += f.scene.beats.length;
      gates += f.scene.beats.filter((beat) => beat.gate !== undefined).length;
      if (f.scene.explore !== undefined) explores++;
    }
    words += f.prose.total;
    interactiveWords += f.prose.interactive;
    uncited += f.prose.uncited;
    example += f.prose.example;
    claims += f.prose.claims;
    quotes += f.prose.quotes;
    statements += f.statements;
    if (f.scene.kind === 'checkpoint') {
      checkpoints++;
      if (GRADED_QUESTION_TYPES.includes(f.scene.question.type)) graded++;
    }
    if ((f.scene.kind === 'narration' || f.scene.kind === 'step_through') && f.scene.figure) figures++;
    for (const path of f.weakClaims) {
      weakClaims.push(`${f.scene.id}/${path}`);
      if (teaches(f.scene)) weakBlocks.push(`${f.scene.id}/${path}`);
    }
  }
  const uses = citingItems(facts.map((f) => ({ id: f.scene.id, cites: f.cites, clip: f.scene.kind === 'clip' })), ctx);
  const cited = [...uses.by.keys()].sort(byEvidenceId);
  const published = [...new Set([...cited, ...uses.basedOn])].sort(byEvidenceId);
  const evidenceOf = (id: string): Evidence => (ctx.evidence.get(id) as EvidenceInfo).ev;
  // SINGLE_HOST is about what the statements rest on; the counts describe everything the lesson carries.
  const citedHosts = new Set(cited.map((id) => comparableHost(evidenceOf(id).host ?? '')));
  const minutes = estimateMinutes({ words, gradedCheckpoints: graded, reflectCheckpoints: checkpoints - graded, predicts, steps, figures, beats, gates, explores });
  const stats: LessonStats = {
    scenes: facts.length,
    words,
    minutes: facts.length === 0 ? 0 : minutes,
    claims,
    quotes,
    sources: published.length,
    pages: new Set(published.map((id) => pageOf(evidenceOf(id)))).size,
    hosts: new Set(published.map((id) => comparableHost(evidenceOf(id).host ?? ''))).size,
    checkpoints,
    // The stage of a clip is its figure.
    figures: figures + clips,
    uncitedShare: words === 0 ? 0 : round(uncited / words),
    exampleShare: words === 0 ? 0 : round(example / words),
    weakClaims: weakClaims.length,
  };

  // ----- rules that already hold or fail whatever is still to come
  const citedPassages = passages(cited, ctx);
  for (const group of citedPassages) {
    const by = pooledUses(group, uses);
    if (by.length <= L.usesPerEvidence) continue;
    const who = group.length === 1 ? `${group[0]} is` : `${idList(group)} hold the same passage and are together`;
    errors.push(
      issue('EVIDENCE_OVERUSED', '', `${who} cited by ${by.length} items (${some(by)}); one ${group.length === 1 ? 'excerpt' : 'passage'} may support at most ${L.usesPerEvidence}.${by.some((item) => item.endsWith(`/${CLIP_ITEM}`)) ? ' A clip is one item, whatever in it cites the passage.' : ''}`, {
        fix: `Move at least ${by.length - L.usesPerEvidence} of these citations to other passages: save the passage that states each point with save_evidence, cite it, and submit the changed scenes again.${group.length === 1 ? '' : ' Storing a passage a second time does not add to what it may support.'}`,
        got: String(by.length),
        expected: `at most ${L.usesPerEvidence}`,
      }),
    );
  }
  for (const id of published) {
    const ev = evidenceOf(id);
    const source = typeof ev.url === 'string' ? normalizeSourceUrl(ev.url) : null;
    if (source && source.ok && source.host === ev.host) continue;
    errors.push(
      issue('EVIDENCE_URL', '', `The stored evidence item ${id} does not have a valid public address.`, {
        fix: `Save the passage again with save_evidence under its public https address, and cite the new id in place of ${id}.`,
        got: id,
      }),
    );
  }
  if (words > profile.words.max) {
    errors.push(
      issue('LESSON_TOO_LONG', '', `The lesson has ${words} words of prose; a ${depth} lesson may have at most ${profile.words.max}.`, {
        fix: `Cut at least ${words - profile.words.max} words: remove what serves no objective, starting with the longest scenes.`,
        got: String(words),
        expected: `at most ${profile.words.max} words`,
      }),
    );
  } else if (words > profile.words.warn) {
    warnings.push(
      issue('LESSON_LONG', '', `The lesson has ${words} words of prose; the target for a ${depth} lesson is ${profile.words.warn} or fewer (limit ${profile.words.max}).`, {
        fix: `Fine if every scene earns its place. Otherwise trim about ${words - profile.words.warn} words. The lesson is estimated at about ${minutes} minutes (${MINUTES_FORMULA}); a ${depth} lesson aims at about ${profile.minutes}.`,
        got: String(words),
        expected: `at most ${profile.words.warn} words`,
      }),
    );
  }

  // ----- rules about the finished lesson
  if (complete && unreadable === 0) {
    errors.push(...objectiveNumberIssues(plan.value.objectives, ctx, 'lesson'));

    // The minimum is a number of different passages. An id that holds the text of another cited
    // id, or a part of it (the same passage cut a little shorter), adds no passage.
    const texts = citedPassages.map((group) => (ctx.evidence.get(group[0] as string) as EvidenceInfo).canonical());
    const distinct = citedPassages.filter((_, i) => !texts.some((other, k) => k !== i && other.length > (texts[i] as string).length && other.includes(texts[i] as string)));
    if (distinct.length < profile.evidenceMin) {
      const counted = new Set(distinct.map((group) => group[0] as string));
      const repeats = cited.filter((id) => !counted.has(id));
      const citedTexts = cited.map((id) => (ctx.evidence.get(id) as EvidenceInfo).canonical());
      // A stored passage that only repeats a cited one would not help either.
      const spare = ctx.storedIds.filter((id) => !uses.by.has(id) && !citedTexts.some((text) => text.includes((ctx.evidence.get(id) as EvidenceInfo).canonical())));
      const short = profile.evidenceMin - distinct.length;
      const uncitedIds = spare.length ? ` (stored and uncited: ${idList(spare)})` : '';
      const n = cited.length;
      const message = repeats.length
        ? `The lesson cites ${n} excerpts (${idList(cited)}), but ${idList(repeats)} ${repeats.length === 1 ? 'holds' : 'hold'} a passage that another cited excerpt already holds, in whole or in part, so they are ${distinct.length} different passage${distinct.length === 1 ? '' : 's'}; a ${depth} lesson needs at least ${profile.evidenceMin}.`
        : `The lesson cites ${n} excerpt${n === 1 ? '' : 's'}${n ? ` (${idList(cited)})` : ''}; a ${depth} lesson needs at least ${profile.evidenceMin}.`;
      errors.push(
        issue('EVIDENCE_TOO_FEW', '', message, {
          fix: `Ground ${short} more statement${short === 1 ? '' : 's'} in passages not yet cited${uncitedIds}, researching further if needed.${repeats.length ? ' A passage stored again under another address, or cut shorter, is still one passage.' : ''} Cite an excerpt only where it supports the statement; "basedOn" does not count as a citation.`,
          got: String(distinct.length),
          expected: `at least ${profile.evidenceMin}`,
        }),
      );
    }
    if (cited.length > 1 && citedHosts.size === 1) {
      warnings.push(
        issue('SINGLE_HOST', '', `All ${cited.length} cited excerpts come from one site (${show([...citedHosts][0])}).`, {
          fix: 'Add a source from an independent site, so the lesson does not inherit one site\'s mistakes.',
        }),
      );
    }
    const snippets = cited.filter((id) => ctx.evidence.get(id)?.ev.via === 'search_snippet');
    if (snippets.length * 2 > cited.length) {
      warnings.push(
        issue('MOSTLY_SNIPPETS', '', `${snippets.length} of ${cited.length} cited excerpts are search result snippets (${idList(snippets)}).`, {
          fix: 'Open those pages, save the passage from the page itself with "via": "page", and cite the new id.',
        }),
      );
    }

    const uncitedAllowed = Math.max(L.uncitedShare.floorWords, Math.floor(words * L.uncitedShare.share));
    if (uncited > uncitedAllowed) {
      errors.push(
        issue('UNCITED_SHARE', '', `${interactiveWords > 0 ? 'Framing, analogy and what the explores tell the learner (their prompts and goals)' : 'Framing and analogy'} make up ${uncited} of the lesson's ${words} words (${Math.round((uncited / words) * 100)}%); at most ${uncitedAllowed} are allowed.`, {
          fix: `Cut at least ${uncited - uncitedAllowed} words of framing or analogy, or replace them with sourced claims.${interactiveWords > 0 ? ` The prompts and goals of the explores are ${interactiveWords} of those ${uncited} words: trim the framing captions first, then say the prompts in fewer words.` : ''}`,
          got: String(uncited),
          expected: `at most ${uncitedAllowed} words`,
        }),
      );
    }
    const exampleAllowed = Math.max(L.exampleShare.floorWords, Math.floor(words * L.exampleShare.share));
    if (example > exampleAllowed) {
      errors.push(
        issue('EXAMPLE_SHARE', '', `Worked examples make up ${example} of the lesson's ${words} words (${Math.round((example / words) * 100)}%); at most ${exampleAllowed} are allowed.`, {
          fix: `Cut at least ${example - exampleAllowed} words of examples, or state the rules they apply as sourced claims.`,
          got: String(example),
          expected: `at most ${exampleAllowed} words`,
        }),
      );
    }

    for (const run of runs(facts, (f) => f.scene.kind === 'narration')) {
      if (run.length <= L.narrationRun) continue;
      const ids = facts.slice(run.start, run.start + run.length).map((f) => f.scene.id);
      errors.push(
        issue('NARRATION_RUN', '', `Scenes ${list(ids)} are ${run.length} narration scenes in a row; at most ${L.narrationRun} are allowed.`, {
          fix: `Call plan_lesson again with a step_through or a checkpoint in place of, or before, "${ids[L.narrationRun]}".`,
          got: String(run.length),
          expected: `at most ${L.narrationRun}`,
        }),
      );
    }
    for (const run of runs(facts, (f) => f.scene.kind !== 'checkpoint' && !f.hasPredict)) {
      if (run.length <= L.passiveRun) continue;
      const stretch = facts.slice(run.start, run.start + run.length);
      const ids = stretch.map((f) => f.scene.id);
      const clip = stretch.find((f) => f.scene.kind === 'clip');
      const stepper = stretch.find((f) => f.scene.kind === 'step_through');
      errors.push(
        issue('PASSIVE_RUN', '', `Scenes ${list(ids)} come in a row with no checkpoint and no prediction (${run.length}; at most ${L.passiveRun} are allowed).`, {
          fix: clip
            ? `Add a "gate" (a prediction, by options or by a tap on the picture) to a beat of "${clip.scene.id}", on the beat that shows the outcome and not the first, or an "explore" after its last beat, and submit it again; or call plan_lesson again with a checkpoint in this stretch.`
            : stepper
              ? `Add a "predict" to a step of "${stepper.scene.id}" and submit it again, or call plan_lesson again with a checkpoint in this stretch.`
              : 'Call plan_lesson again with a checkpoint, or a clip one of whose beats has a "gate", in this stretch.',
          got: String(run.length),
          expected: `at most ${L.passiveRun}`,
        }),
      );
    }

    if (profile.requireFigure && figures + clips === 0) {
      errors.push(
        issue('NO_FIGURE', '', `A ${depth} lesson needs at least one figure, and this one has none.`, {
          fix: 'Call plan_lesson again with a clip (its stage is the figure) and submit that scene. In a lesson of the older kinds: with a "figure" on a narration scene, or with a step_through.',
        }),
      );
    }
    const checks = facts.filter((f) => f.scene.kind === 'checkpoint');
    if (profile.requireApply && !checks.some((f) => f.scene.kind === 'checkpoint' && f.scene.level === 'apply')) {
      errors.push(
        issue('NO_APPLY_CHECKPOINT', '', `A ${depth} lesson needs at least one checkpoint with "level": "apply"; ${checks.length ? `all ${checks.length} are recall` : 'it has no checkpoint'}.`, {
          fix: `Rewrite one checkpoint${checks.length ? ` (${list(checks.map((f) => f.scene.id))})` : ''} so the learner uses the idea on a case the lesson did not show, set its "level" to "apply", and submit it again.`,
        }),
      );
    }
    for (const objective of ctx.objectives) {
      if (checks.some((f) => f.scene.kind === 'checkpoint' && f.scene.objective === objective.id)) continue;
      errors.push(
        issue('OBJECTIVE_UNASSESSED', '', `No checkpoint assesses objective ${objective.id}.`, {
          fix: `Call plan_lesson again with a checkpoint whose "objective" is "${objective.id}", or without ${objective.id}.`,
          got: objective.id,
        }),
      );
    }

    // Where each excerpt is first taught: cited by a claim, a quote, a figure or a stage of a teaching scene.
    const taughtAt = new Map<string, number>();
    facts.forEach((f, index) => {
      if (!teaches(f.scene)) return;
      for (const ref of f.cites) if (!ref.basedOn) for (const id of ref.ids) if (!taughtAt.has(id)) taughtAt.set(id, index);
    });
    facts.forEach((f, index) => {
      if (f.scene.kind !== 'checkpoint') return;
      const ref = f.cites.find((r) => !r.basedOn);
      if (!ref) return;
      const known = ref.ids.filter((id) => ctx.evidence.has(id));
      if (known.length === 0) return;
      const taught = known.filter((id) => taughtAt.has(id));
      if (taught.length === 0) {
        errors.push(
          issue('CHECKPOINT_UNTAUGHT', ref.path, `The ${ref.what} of "${f.scene.id}" cites ${idList(known)}, which no teaching scene (clip, narration or step_through) cites: the checkpoint asks about something the lesson never taught.`, {
            sceneId: f.scene.id,
            fix: `Teach it before asking: cite ${idList(known)} in a caption (a claim or a quote) or on the stage of an earlier clip, or base the ${ref.what} on evidence the lesson already teaches (${idList([...taughtAt.keys()].sort(byEvidenceId))}).`,
          }),
        );
      } else if (!taught.some((id) => (taughtAt.get(id) as number) < index)) {
        const where = (facts[Math.min(...taught.map((id) => taughtAt.get(id) as number))] as SceneFacts).scene.id;
        warnings.push(
          issue('CHECKPOINT_BEFORE_TAUGHT', ref.path, `"${f.scene.id}" asks about ${idList(taught)} before "${where}" teaches it.`, {
            sceneId: f.scene.id,
            fix: `Move "${f.scene.id}" after "${where}" by planning again, or keep it deliberately as an ask-first question for a learner who already knows the topic.`,
          }),
        );
      }
    });

    // Two shares, either of which is too many: weak claims among the claims (as it has always
    // been counted), and weak matches among every statement that is compared with its excerpts.
    // Counting the second alone would let checked takeaways and explanations dilute weak claims.
    const tooManyClaims = weakBlocks.length >= 3 && weakBlocks.length > claims * L.weakClaimShare;
    const tooManyStatements = weakClaims.length >= 3 && weakClaims.length > statements * L.weakClaimShare;
    if (tooManyClaims || tooManyStatements) {
      const [listed, of, what] = tooManyClaims ? [weakBlocks, claims, 'claims'] : [weakClaims, statements, 'cited statements (claims, takeaways, explanations and model answers)'];
      errors.push(
        issue('TOO_MANY_WEAK_CLAIMS', '', `${listed.length} of ${of} ${what} barely match the excerpts they cite (${some(listed)}); the limit is ${Math.round(L.weakClaimShare * 100)}%.`, {
          fix: `For each ${tooManyClaims ? 'claim' : 'statement'} listed: cite the excerpt that supports it, save the passage that does, or delete the ${tooManyClaims ? 'claim' : 'statement'}. Then submit the changed scenes again.`,
          got: String(listed.length),
          expected: `at most ${Math.floor(of * L.weakClaimShare)}`,
        }),
      );
    }

    // A lesson whose pictures of data are mostly invented shapes shows little the learner can check.
    const data = facts.filter((f) => f.scene.kind === 'clip' && DATA_STAGE_KINDS.includes(f.scene.stage.kind));
    const invented = data.filter((f) => f.scene.kind === 'clip' && f.scene.stage.provenance === 'illustrative');
    if (invented.length > data.length * L.illustrativeShare) {
      warnings.push(
        issue('MOSTLY_ILLUSTRATIVE', '', `${invented.length} of the ${data.length} clips that show data are marked "illustrative" (${list(invented.map((f) => f.scene.id))}); the learner cannot check what an illustrative stage shows.`, {
          fix: 'For each one: if a stored passage states what the stage shows, cite it in the stage\'s "cites" and set "provenance" to "sourced" (its numbers are then checked against that passage); if the stage works a case through by a rule a passage states, cite that passage and set "worked". Keep "illustrative" for a picture whose shape alone is the point.',
          got: String(invented.length),
          expected: `at most ${Math.floor(data.length * L.illustrativeShare)}`,
        }),
      );
    }

    // The learner acts before being told: most clips ask for something, and where a lesson is long
    // enough to hold a relationship between quantities, one of them hands the picture over.
    const clipFacts = facts.flatMap((f) => (f.scene.kind === 'clip' ? [f.scene] : []));
    const idle = clipFacts.filter((scene) => !hasAction(scene));
    const acting = clipFacts.length - idle.length;
    const needed = Math.ceil(clipFacts.length * L.interactiveShare - 1e-9);
    if (acting < needed) {
      const short = needed - acting;
      const carriers = idle.filter((scene) => couldExplore(scene.stage));
      errors.push(
        issue('INTERACTIVE_SHARE', '', `${acting} of the lesson's ${clipFacts.length} clips ${acting === 1 ? 'contains' : 'contain'} a learner action (a gate or an explore); at least ${needed} must. Without one: ${list(idle.map((scene) => scene.id))}.`, {
          fix: `The learner acts before being told. Give ${short} more of those clips an action and submit ${short === 1 ? 'it' : 'them'} again: a "gate" on the beat that shows an outcome, never the first ({ "prompt", "options" } to choose from, or { "prompt", "pick", "right", "wrong" } to tap a part of the picture), or an "explore" after the last beat${carriers.length ? ` (${list(carriers.map((scene) => `"${scene.id}"`))} ${carriers.length === 1 ? 'has' : 'have'} a stage that suits one)` : ''}.`,
          got: String(acting),
          expected: `at least ${needed} of ${clipFacts.length}`,
        }),
      );
    }
    if (depth !== 'quick' && clipFacts.length > 0 && !clipFacts.some((scene) => scene.explore !== undefined)) {
      const carrier = clipFacts.find((scene) => couldExplore(scene.stage));
      warnings.push(
        issue('NO_EXPLORE', '', `No clip of this ${depth} lesson has an "explore": there is nothing the learner can drag.${carrier ? ` "${carrier.id}" has a ${stageName(carrier.stage)} stage that could carry one.` : ''}`, {
          fix: carrier
            ? `Add "explore" to "${carrier.id}" and submit it again: one or two "controls" (sliders), "bind" to tie ${carrier.stage.kind === 'dots' ? 'a split-off group' : carrier.stage.kind === 'chart' && carrier.stage.mark === 'curve' ? 'a read-out to them (the curves follow by naming a control in their "expr")' : 'a bar'}${carrier.stage.kind === 'chart' && carrier.stage.mark === 'curve' ? '' : ' to them with a formula'}, and a "goal" the learner reaches by dragging. Its stage must then be marked "worked" or "illustrative".`
            : 'Where an idea of the lesson is a relationship between quantities, call plan_lesson again with a clip on a "chart" or a "dots" stage for it, and give that clip an "explore": the learner changes one quantity and watches the others respond. A lesson with no such idea can keep this warning.',
        }),
      );
    }
  }

  // ----- assemble
  let lesson: LessonV2 | undefined;
  let hash: string | undefined;
  if (complete && unreadable === 0 && errors.length === 0) {
    const assembled = {
      format: FORMAT,
      id: draft.id,
      title: draft.title,
      topic: draft.topic,
      language: draft.language,
      depth: draft.depth,
      level: draft.learner?.level,
      objectives: draft.objectives,
      evidence: published.map(evidenceOf),
      scenes: facts.map((f) => f.scene),
    };
    const parsed = parseShape(LessonV2, assembled, { what: 'lesson' });
    if (!parsed.value) {
      errors.push(...parsed.issues);
    } else {
      // Encoded once: the size limit and the hash are both about these bytes.
      const bytes = utf8(canonicalJson(parsed.value));
      if (bytes.length > L.lessonJsonBytes) {
        errors.push(
          issue('LESSON_TOO_LARGE', '', `The lesson's data is ${bytes.length} bytes; the limit is ${L.lessonJsonBytes}.`, {
            fix: `Shorten the largest scenes and figures by at least ${bytes.length - L.lessonJsonBytes} bytes in total.`,
            got: String(bytes.length),
            expected: `at most ${L.lessonJsonBytes} bytes`,
          }),
        );
      } else {
        lesson = parsed.value;
        hash = sha256Hex(bytes);
      }
    }
  }

  const report: LessonReport = { ok: lesson !== undefined, complete, pending, errors: capIssues(errors, 'error'), warnings, stats, weakClaims };
  if (lesson !== undefined && hash !== undefined) {
    report.lesson = lesson;
    report.hash = hash;
  }
  return report;
}

/**
 * A draft that holds exactly a published lesson: its scenes as accepted, an outline read off them,
 * and only the evidence the lesson carries. The learner's profile is not in a lesson, so it is blank.
 */
export function draftFromLesson(lesson: LessonV2): Draft {
  const outline: OutlineEntry[] = lesson.scenes.map((scene) => {
    const entry: OutlineEntry = { id: scene.id, kind: scene.kind, purpose: scene.title };
    if (scene.kind === 'clip') entry.stage = scene.stage.kind;
    if ((scene.kind === 'narration' || scene.kind === 'step_through') && scene.figure) entry.figure = scene.figure.type;
    if (scene.kind === 'checkpoint') {
      entry.question = scene.question.type;
      entry.objective = scene.objective;
    }
    return entry;
  });
  return {
    format: 'learning-tool/draft@1',
    id: lesson.id,
    createdAt: '',
    updatedAt: '',
    topic: lesson.topic,
    language: lesson.language,
    depth: lesson.depth,
    learner: { level: lesson.level, knows: 'not published', goal: 'not published', calibration: [] },
    title: lesson.title,
    objectives: lesson.objectives,
    outline,
    evidence: lesson.evidence,
    scenes: lesson.scenes,
    activity: { calls: {}, rejects: {} },
  };
}

/**
 * Re-validate a published lesson from its own data, as the `verify` command does: every rule that
 * checkLesson applies, plus the requirement that validating it again reproduces it exactly. A
 * lesson edited after publishing fails one or the other. Compare `hash` with the receipt.
 */
export function verifyLesson(input: unknown): LessonReport {
  const shape = parseShape(LessonV2, input, { what: 'lesson' });
  if (!shape.value) return failed(shape.issues);
  const report = checkLesson(draftFromLesson(shape.value));
  if (!report.ok || !report.lesson) return report;

  let same = false;
  try {
    same = canonicalJson(input) === canonicalJson(report.lesson);
  } catch {
    same = false;
  }
  if (same) return report;
  const { lesson: _lesson, hash: _hash, ...rest } = report;
  return {
    ...rest,
    ok: false,
    errors: [
      issue('BAD_VALUE', '', 'The lesson data is not what validation produces from it, so it was changed after it was published.', {
        fix: 'Publish the lesson again with publish_lesson. A published file is never edited by hand.',
      }),
    ],
  };
}
