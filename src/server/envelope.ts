// The one shape every tool result has:
//
//   { ok, lessonId, stage, next: { tool, why }, errors, warnings, ...payload }
//
// It is returned twice, as `structuredContent` and as one text block holding the same JSON, because
// hosts differ in which of the two they show the model. `isError` is the opposite of `ok`. The one
// exception is get_guide, whose text block is the guide itself (see `withTextBlock`).
import type { CallToolResult } from '@modelcontextprotocol/server';
import { issue, MAX_ISSUES_PER_CALL } from '../core/issues';
import type { Draft, Issue, LessonReport, Stage } from '../core/types';
import { nextStep, progress, type Next, type Outcome } from './next';

/** A result whose text block is this text and not the JSON of the envelope. */
const TEXT_BLOCK = Symbol('learning-tool.text-block');

export interface Envelope {
  ok: boolean;
  lessonId: string | null;
  stage: Stage | null;
  next: Next;
  errors: Issue[];
  warnings: Issue[];
  [payload: string]: unknown;
  [TEXT_BLOCK]?: string;
}

export interface EnvelopeInput {
  /** The draft as it is after the call, or null when the call is about no lesson. */
  draft: Draft | null;
  /** Shown as `lessonId` when there is no draft, for a result about an id that could not be used. */
  lessonId?: string | null;
  outcome?: Outcome;
  errors?: readonly Issue[];
  warnings?: readonly Issue[];
  /** Overrides `ok`, which is otherwise "no errors". */
  ok?: boolean;
  payload?: Record<string, unknown>;
}

type Kind = 'error' | 'warning';

/** The entry that stands for issues not listed. As in the validator's own, `got` is the total number found. */
function leftOut(rest: number, total: number, kind: Kind, why: 'cap' | 'size', counts = ''): Issue {
  const fix =
    kind === 'error'
      ? 'Fix the errors listed and call the tool again to see the rest.'
      : why === 'cap'
        ? 'Every kind of warning found is among those listed, with its fix. Warnings do not block publishing.'
        : 'Fix the errors first. validate_lesson lists the warnings once the errors are gone.';
  const message =
    why === 'cap'
      ? `${rest} more ${kind}${rest === 1 ? '' : 's'} not listed (${total} in total${counts}).`
      : `${rest} more ${kind}${rest === 1 ? '' : 's'} not listed, to keep this result readable (${total} in total).`;
  return issue('MORE_ISSUES', '', message, { severity: kind, got: String(total), fix });
}

/** The issues of a list that are findings, and how many findings there were in all (a MORE_ISSUES entry carries that number in `got`). */
function tally(list: readonly Issue[]): { real: Issue[]; total: number; counted: boolean } {
  const real = list.filter((i) => i.code !== 'MORE_ISSUES');
  const more = list.find((i) => i.code === 'MORE_ISSUES');
  const counted = more ? Number(more.got) : Number.NaN;
  return { real, total: Number.isFinite(counted) ? Math.max(counted, real.length) : real.length, counted: more !== undefined };
}

export function countByCode(list: readonly Issue[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const found of list) if (found.code !== 'MORE_ISSUES') out[found.code] = (out[found.code] ?? 0) + 1;
  return out;
}

/**
 * At most `MAX_ISSUES_PER_CALL` findings of one list, then a count of the rest. Every tool result
 * goes through this, whoever built the list: the validator caps what one scene or one plan can
 * report, but a whole-lesson report lists every warning, and a call with thousands of wrong
 * argument names would otherwise be answered with thousands of entries.
 *
 * The findings kept are the first of every code, then the earliest of the others, in their original
 * order: so one very common finding cannot hide the only instance of another.
 */
export function capIssueList(list: readonly Issue[], kind: Kind, keep = MAX_ISSUES_PER_CALL): Issue[] {
  const { real, total, counted } = tally(list);
  if (real.length <= keep) return [...list];
  const chosen = new Set<number>();
  const seen = new Set<string>();
  for (let i = 0; i < real.length && chosen.size < keep; i++) {
    const code = (real[i] as Issue).code;
    if (seen.has(code)) continue;
    seen.add(code);
    chosen.add(i);
  }
  for (let i = 0; i < real.length && chosen.size < keep; i++) chosen.add(i);
  // Counts by code are given only when this list is everything that was found.
  const counts = counted
    ? ''
    : `: ${Object.entries(countByCode(real))
        .map(([code, n]) => `${n} ${code}`)
        .join(', ')}`;
  return [...real.filter((_, i) => chosen.has(i)), leftOut(total - keep, total, kind, 'cap', counts)];
}

/** Build the envelope. `stage` and `next` always come from the draft, here and nowhere else. */
export function envelope(input: EnvelopeInput): Envelope {
  const errors = capIssueList(input.errors ?? [], 'error');
  const warnings = capIssueList(input.warnings ?? [], 'warning');
  const outcome: Outcome = { ...(input.outcome ?? {}) };
  // Once every scene is in, the stage depends on the whole-lesson report. It is worked out once and shared with `next`.
  const at = input.draft ? progress(input.draft, outcome.report) : null;
  const report: LessonReport | undefined = outcome.report ?? at?.report;
  if (report) outcome.report = report;
  const payload: Record<string, unknown> = { ...(input.payload ?? {}) };

  // Every scene is in and the lesson does not pass: `next` will point at an error, so the error has
  // to be in this result. Tools that show the report say where; for the others it is added here.
  const blocked = at !== null && at.stage === 'writing' && at.pending.length === 0 && report !== undefined && !outcome.failed && !(outcome.rejected && outcome.rejected.length > 0);
  if (blocked && outcome.errorsAt === undefined) {
    payload.lessonErrors = capIssueList(report.errors, 'error');
    outcome.errorsAt = 'lessonErrors';
  }

  // "published" promises a file. When the file has gone the lesson is ready to be published again, no more.
  const stage = at?.stage === 'published' && outcome.fileMissing ? 'ready' : (at?.stage ?? null);
  return {
    ok: input.ok ?? errors.length === 0,
    lessonId: input.draft?.id ?? input.lessonId ?? null,
    stage,
    next: nextStep(input.draft, outcome),
    errors,
    warnings,
    ...payload,
  };
}

/**
 * Claude Code keeps only the first and last 5,000 characters of an error result longer than about
 * 11,000, which would cut the middle out of the list of errors. An error result is therefore kept
 * under this size by listing fewer issues and saying how many were left out.
 */
export const ERROR_RESULT_MAX_CHARS = 10_000;

const jsonLength = (value: unknown): number => JSON.stringify(value).length;

/**
 * The longest prefix of `list` (at most `most`, at least `least` findings) that fits in `room`
 * characters as a JSON array together with its count of the rest. Each entry is measured once and
 * the lengths are added, so the work grows with the list and not with its square.
 */
function fitList(list: readonly Issue[], kind: Kind, room: number, least: number): Issue[] {
  const { real, total } = tally(list);
  const sizes = real.map(jsonLength);
  let sum = 0;
  const upTo = sizes.map((size) => (sum += size));
  for (let keep = real.length - 1; keep >= least; keep--) {
    const more = leftOut(total - keep, total, kind, 'size');
    // "[" entries joined by commas, the count, "]".
    const length = 2 + (keep > 0 ? (upTo[keep - 1] as number) + keep : 0) + jsonLength(more);
    if (length <= room || keep === least) return [...real.slice(0, keep), more];
  }
  return [...list];
}

/** Said in place of a scene template that was left out of a rejection to make room for its errors. */
export const TEMPLATE_LEFT_OUT = 'The template for this scene was left out to keep this result readable. It is in the result of plan_lesson; sending the same plan again returns it.';

/**
 * Shorten an error envelope that is too long: warnings go first, then the scene template a
 * rejected submit_scene carries, then errors from the end. Never touches a successful result.
 *
 * The template goes before any error does. It is an aid, and the agent has had it once already;
 * the errors are what it has to act on, and each of them is new.
 */
export function fitErrorEnvelope(env: Envelope, max = ERROR_RESULT_MAX_CHARS): Envelope {
  if (env.ok) return env;
  const whole = jsonLength(env);
  if (whole <= max) return env;
  const out: Envelope = { ...env };
  let length = whole;
  const replace = (key: 'warnings' | 'errors', list: Issue[]): void => {
    length += jsonLength(list) - jsonLength(out[key]);
    out[key] = list;
  };
  if (env.warnings.some((w) => w.code !== 'MORE_ISSUES')) replace('warnings', fitList(env.warnings, 'warning', max - (length - jsonLength(env.warnings)), 0));
  if (length > max && out.template !== undefined) {
    delete out.template;
    out.templateNote = TEMPLATE_LEFT_OUT;
    length = jsonLength(out);
  }
  // At least one error always stays: a rejection that names nothing cannot be acted on.
  if (length > max && env.errors.filter((e) => e.code !== 'MORE_ISSUES').length > 1) replace('errors', fitList(env.errors, 'error', max - (length - jsonLength(env.errors)), 1));
  return out;
}

/**
 * Give a successful result a text block of its own. get_guide uses it: the guide is long, and a
 * host that counts both the text block and the structured content would otherwise pay for it
 * twice. The structured content then holds everything but the text.
 */
export function withTextBlock(env: Envelope, text: string): Envelope {
  return { ...env, [TEXT_BLOCK]: text };
}

/** The MCP result for an envelope. */
export function toResult(env: Envelope): CallToolResult {
  const { [TEXT_BLOCK]: own, ...fitted } = fitErrorEnvelope(env);
  return { content: [{ type: 'text', text: own !== undefined && fitted.ok ? own : JSON.stringify(fitted) }], structuredContent: fitted, isError: !fitted.ok };
}
