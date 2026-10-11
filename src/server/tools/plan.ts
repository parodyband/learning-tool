// plan_lesson: check the plan, store it, drop the accepted scenes it no longer fits, and return a
// word budget and a fill-in template for every scene.
//
// New lessons are visual. The format still reads the two teaching kinds of lessons made before
// clips (`narration`, `step_through`), so that an older lesson can be shown, checked and published
// again, and the validator therefore accepts them in a plan. This tool does not: a plan that names
// one is refused here, before the validator is asked anything, with what to plan in its place.
import { TEMPLATE_NOTES, templateFor } from '../../core/templates';
import { sanitizeText } from '../../core/text';
import type { Issue } from '../../core/types';
import { checkPlan } from '../../core/validate';
import { show } from '../../core/validate/shape';
import { readList } from '../args';
import { serverIssue } from '../issues';
import { STAGE_SHOWS, TYPED_STAGE_KINDS } from '../texts';
import type { Handler } from './common';
import { lessonCall, type Work } from './lesson-call';

const idOf = (scene: unknown): string | null => {
  const id = (scene as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : null;
};

/** The teaching kinds of lessons made before clips. Still read from a stored draft; never planned again. */
export const LEGACY_KINDS: readonly string[] = ['narration', 'step_through'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A note about the scene kinds, or the figures, of lessons made before clips. The validator keeps
 * one list of notes for every template it has, older kinds included.
 */
const OLDER_KINDS_NOTE = /narration scene|step-through|step_through|\bfigure\b|flow layout/i;

/**
 * The template notes that go with a plan. A plan stored by this tool holds clips, checkpoints and
 * a recap, never a scene of the older kinds, so the notes about those kinds describe templates the
 * result does not carry, and one of them ("chart mark is bar, line or step") contradicts what is
 * true of a clip's chart. They are left out.
 */
export function notesFor(kinds: Iterable<string>): string[] {
  const planned = new Set(kinds);
  if (LEGACY_KINDS.some((kind) => planned.has(kind))) return [...TEMPLATE_NOTES];
  const notes = TEMPLATE_NOTES.filter((note) => !OLDER_KINDS_NOTE.test(note));
  // The one fact about a checkpoint template sits in a note about the older figures; it is kept in its own words.
  if (planned.has('checkpoint') && !notes.some((note) => note.includes('"recall"'))) notes.push(CHECKPOINT_LEVEL_NOTE);
  return notes;
}

/** What the notes say of a checkpoint's one choice, for a plan whose other notes about choices are left out. */
export const CHECKPOINT_LEVEL_NOTE = 'A checkpoint\'s `level` is a choice, not text: "recall" or "apply". The template shows "apply"; choose.';

/** The stage that most often shows what a figure of the older format showed, so the refusal can name a place to start. */
const STAGE_FOR_FIGURE: Readonly<Record<string, string>> = { flow: 'flow', sequence: 'sequence', layers: 'flow', timeline: 'timeline', compare: 'chart', chart: 'chart', lines: 'lines' };

/**
 * One error for each outline entry of a legacy kind, or none. The outline is read as it was sent
 * (a list, or a string of JSON holding one, which the validator would also accept), and only the
 * `kind` of each entry is looked at: everything else about the plan is the validator's to judge.
 */
export function legacyKindErrors(outline: unknown): Issue[] {
  const entries = readList(outline) ?? [];
  const stages = TYPED_STAGE_KINDS.map((kind) => `"${kind}" (${STAGE_SHOWS[kind as keyof typeof STAGE_SHOWS]})`).join(', ');
  const errors: Issue[] = [];
  entries.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.kind !== 'string') return;
    // Read as the validator will read it (spaces and hidden characters tidied away), and a little more generously: "Step-Through" is step_through.
    const kind = sanitizeText(entry.kind, 'prose').toLowerCase().replace(/[\s-]+/g, '_');
    if (!LEGACY_KINDS.includes(kind)) return;
    const id = typeof entry.id === 'string' ? show(entry.id) : null;
    const where = id !== null ? `"${id}"` : `outline[${index}]`;
    // A step-through, or a narration with a figure, already had a picture in mind: say which stage draws it now.
    const hint = typeof entry.figure === 'string' && Object.hasOwn(STAGE_FOR_FIGURE, entry.figure) ? ` For what was a "${entry.figure}" figure, start from stage "${STAGE_FOR_FIGURE[entry.figure]}".` : '';
    errors.push(
      serverIssue('PLAN_LEGACY_KIND', `outline[${index}].kind`, `Scene ${where} is planned as "${kind}". New lessons are visual: a teaching scene is a clip, a picture that moves with one short caption per beat.`, {
        got: kind,
        expected: 'clip',
        fix: `Change the entry to {"id", "kind": "clip", "purpose", "stage"}${typeof entry.figure === 'string' ? ' and remove "figure"' : ''}. Decide what the learner will see change, then choose the stage that shows it: ${stages}. "frame" (your own drawing code) is the rare escape hatch when none of those can show it.${hint}`,
      }),
    );
  });
  if (errors.length > 0) {
    // Said once, on the first: the rest of the plan has not been looked at yet.
    const first = errors[0] as Issue;
    first.message = `${first.message} Nothing else in this plan was checked: it is checked once no entry is of an older kind.`;
  }
  return errors;
}

export const planLesson: Handler = (deps, raw) =>
  lessonCall(deps, raw, {
    tool: 'plan_lesson',
    spec: { required: ['lessonId'] },
    // title, objectives and outline, and anything sent beside them, are the plan: the validator names what is wrong with it.
    passUnknown: true,
    write: true,
    work: (draft, args): Work => {
      const { lessonId: _lessonId, ...plan } = args;
      const legacy = legacyKindErrors(plan.outline);
      if (legacy.length > 0) return { errors: legacy, outcome: { rejected: legacy } };

      const check = checkPlan(plan, draft);
      if (!check.ok || !check.plan) return { errors: check.errors, warnings: check.warnings, outcome: { rejected: check.errors } };
      // The plan as the validator read it is the one that would be stored, so it is the one that decides: a kind
      // that only its reading makes plain is refused here as it would have been above.
      const stored = legacyKindErrors(check.plan.outline);
      if (stored.length > 0) return { errors: stored, outcome: { rejected: stored } };

      const planned = new Set(check.plan.outline.map((entry) => entry.id));
      const orphans = new Set(check.orphans ?? []);
      const dropped: string[] = [];
      const kept: string[] = [];
      draft.scenes = draft.scenes.filter((scene) => {
        const id = idOf(scene);
        // A stored scene the plan has no place for is dropped whether or not the check listed it.
        if (id === null || orphans.has(id) || !planned.has(id) || kept.includes(id)) {
          if (id !== null && !dropped.includes(id)) dropped.push(id);
          return false;
        }
        kept.push(id);
        return true;
      });
      draft.title = check.plan.title;
      draft.objectives = check.plan.objectives;
      draft.outline = check.plan.outline;

      return {
        warnings: check.warnings,
        changed: true,
        payload: {
          title: check.plan.title,
          scenes: check.plan.outline.length,
          // For a clip: the words one caption may have. A caption is one short line.
          budgets: check.budgets ?? {},
          templates: check.plan.outline.map((entry) => templateFor(entry)),
          templateNotes: notesFor(check.plan.outline.map((entry) => entry.kind)),
          // In lesson order, whatever order the scenes were accepted in.
          kept: check.plan.outline.map((entry) => entry.id).filter((id) => kept.includes(id)),
          dropped,
          evidenceIds: draft.evidence.map((item) => idOf(item)).filter((id): id is string => id !== null),
        },
      };
    },
  });
