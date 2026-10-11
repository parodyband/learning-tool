// Two stage kinds for clips: `lines` (code, a derivation or plain text as numbered lines) and
// `timeline` (ordered moments along a track, optionally in two or three parallel lanes).
//
// Same design rules as core/schema and core/clip: typed data only (no HTML, CSS, coordinates,
// colours, durations or easings), every object strict, every part that a beat can act on has an id.
//
// core/clip.ts imports the two stage schemas from here and adds them to its `Stage` union, so this
// file takes the shared pieces (tones, provenance, read-outs) from core/clip-base and never imports
// core/clip.ts.
import { z } from 'zod';
import { Id } from './schema';
import { Tone, clipText as text, stageCommon, stageStats } from './clip-base';

// ---------------------------------------------------------------------------------------------
// Limits (design heuristics: what stays readable on a 320 px stage)
// ---------------------------------------------------------------------------------------------

export const KITS_EXTRA_LIMITS = {
  lines: {
    lines: { min: 1, max: 12 },
    /** Longer code lines wrap on a narrow stage; every wrapped row costs a row of the budget. */
    lineChars: 72,
    languageChars: 20,
    pointers: { max: 2, labelChars: 10 },
    brackets: { max: 2, labelChars: 24 },
    annotations: { max: 3, textChars: 80 },
    values: { max: 8, labelChars: 16, valueChars: 24, unitChars: 8 },
    /** Rows the stage can hold: each line is one row, each annotation two. */
    rowBudget: 14,
  },
  timeline: {
    events: { min: 2, max: 10 },
    whenChars: 24,
    labelChars: 60,
    detailChars: 120,
    lanes: { min: 2, max: 3, labelChars: 24 },
    spans: { max: 3, labelChars: 30 },
    markers: { max: 2, labelChars: 12 },
  },
} as const;
const L = KITS_EXTRA_LIMITS;

// ---------------------------------------------------------------------------------------------
// lines
// ---------------------------------------------------------------------------------------------

/** Lines are addressed by position, as in v1: l1 is the first line. */
export const LINE_REF_PATTERN = /^l([1-9]|1[0-2])$/;
export const LineRef = z.string().regex(LINE_REF_PATTERN, { error: 'Lines are addressed as "l1", "l2", ... up to "l12".' });

/**
 * Code, a derivation, or plain text, as numbered lines.
 *
 *   lines        the text of each line. Part ids are l1..lN. In `format: "math"` each line is one
 *                expression in the supported LaTeX subset (core/math). Whitespace in code is kept.
 *   pointers     an arrow in the gutter that travels from line to line (`move`). Hidden until its
 *                first `move`.
 *   brackets     an outline round a range of lines (`move` to a line or to [first, last]). Hidden
 *                until its first `move`.
 *   annotations  a callout attached to a line. Hidden until a `show` names it; the lines below make
 *                room for it.
 *   values       a small read-out beside a line: a variable's current value. With a `value` it is
 *                on stage from the start; without one it appears on its first `set`.
 *   stats        read-outs along the bottom edge, as on every stage.
 *
 * Code is written by the agent and labelled so on the stage and in the static page; it never has a
 * copy button.
 */
export const LinesStage = z.strictObject({
  kind: z.literal('lines'),
  format: z.enum(['code', 'math', 'text']),
  /** Display name of the programming language, for `format: "code"`. */
  language: text(L.lines.languageChars).optional(),
  lines: z.array(z.string().max(L.lines.lineChars)).min(L.lines.lines.min).max(L.lines.lines.max),
  pointers: z
    .array(z.strictObject({ id: Id, label: text(L.lines.pointers.labelChars).optional(), tone: Tone.optional() }))
    .max(L.lines.pointers.max)
    .optional(),
  brackets: z
    .array(z.strictObject({ id: Id, label: text(L.lines.brackets.labelChars).optional(), tone: Tone.optional() }))
    .max(L.lines.brackets.max)
    .optional(),
  annotations: z
    .array(z.strictObject({ id: Id, at: LineRef, text: text(L.lines.annotations.textChars), tone: Tone.optional() }))
    .max(L.lines.annotations.max)
    .optional(),
  values: z
    .array(
      z.strictObject({
        id: Id,
        at: LineRef,
        label: text(L.lines.values.labelChars).optional(),
        value: z.union([z.number().finite(), text(L.lines.values.valueChars)]).optional(),
        unit: text(L.lines.values.unitChars).optional(),
      }),
    )
    .max(L.lines.values.max)
    .optional(),
  ...stageStats,
  ...stageCommon,
});
export type LinesStage = z.infer<typeof LinesStage>;

// ---------------------------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------------------------

/** The id that names the whole track (every lane at once) in a `draw`. An agent may not use it for a part. */
export const TRACK_ID = 'track';

/**
 * Ordered moments along a track. `when` is free text: "1914", "+4 h", "overnight", "step 2".
 *
 *   events   in order. Each takes the next place along the track; on a stage with lanes, events in
 *            different lanes that follow one another with the same `when` share a place, so they
 *            sit side by side. An event with no `lane` on a stage with lanes spans every lane: the
 *            moment the threads meet.
 *   lanes    two or three parallel threads. Omit for a single track.
 *   spans    a bracket between two events, with an optional label ("four years"). Hidden until a
 *            `show` names it.
 *   markers  a "now" marker that travels along the track to an event (`move`). Hidden until its
 *            first `move`.
 *   stats    read-outs along the bottom edge, as on every stage.
 *
 * `draw` on `"track"` (or on a lane id) draws the line itself, and the events it passes arrive as
 * the tip reaches them; `upto` stops at an event. A track that no `draw` names draws itself when
 * the clip opens.
 */
export const TimelineStage = z.strictObject({
  kind: z.literal('timeline'),
  lanes: z
    .array(z.strictObject({ id: Id, label: text(L.timeline.lanes.labelChars), tone: Tone.optional() }))
    .min(L.timeline.lanes.min)
    .max(L.timeline.lanes.max)
    .optional(),
  events: z
    .array(
      z.strictObject({
        id: Id,
        when: text(L.timeline.whenChars),
        label: text(L.timeline.labelChars),
        /** One more sentence, shown while the event is in focus. */
        detail: text(L.timeline.detailChars).optional(),
        lane: Id.optional(),
        tone: Tone.optional(),
      }),
    )
    .min(L.timeline.events.min)
    .max(L.timeline.events.max),
  spans: z
    .array(z.strictObject({ id: Id, from: Id, to: Id, label: text(L.timeline.spans.labelChars).optional(), tone: Tone.optional() }))
    .max(L.timeline.spans.max)
    .optional(),
  markers: z
    .array(z.strictObject({ id: Id, label: text(L.timeline.markers.labelChars).optional(), tone: Tone.optional() }))
    .max(L.timeline.markers.max)
    .optional(),
  ...stageStats,
  ...stageCommon,
});
export type TimelineStage = z.infer<typeof TimelineStage>;

export type ExtraStage = LinesStage | TimelineStage;
export const EXTRA_STAGE_KINDS = ['lines', 'timeline'] as const;
export type ExtraStageKind = (typeof EXTRA_STAGE_KINDS)[number];

// ---------------------------------------------------------------------------------------------
// Which verbs act on which kinds of part (the validator's table for these two stages)
// ---------------------------------------------------------------------------------------------
//
// Parameters the two kits read from an action, all of them fields core/clip.ts already defines:
//   show     target | targets. On a `math` stage a line that is shown grows out of the line above it.
//   hide     target | targets
//   focus    target | targets, or `between: [first, last]` (lines; events), `zoom`
//   move     target, `to`: a line id or an event id; for a bracket or a span, [first, last]
//   set      target | targets, `value` (a value or stat: a number counts, a string morphs),
//            `label` (new words on a line, annotation, pointer, bracket, event, span or marker), `tone`
//   draw     target | targets ("track" or lane ids), `upto`: an event id
//   pulse    target | targets

export type LinesPartKind = 'line' | 'pointer' | 'bracket' | 'annotation' | 'value' | 'stat';
export type TimelinePartKind = 'track' | 'lane' | 'event' | 'span' | 'marker' | 'stat';

/** lines: show/hide line, annotation, value, bracket, pointer, stat · focus line, annotation, value (or `between`) · move pointer (to a line), bracket (to a line or [first, last]) · set line (tone, label), value (value, tone), annotation / pointer / bracket (label, tone), stat (value, tone) · pulse any part. */
export const LINES_VERBS = {
  show: ['line', 'annotation', 'value', 'bracket', 'pointer', 'stat'],
  hide: ['line', 'annotation', 'value', 'bracket', 'pointer', 'stat'],
  focus: ['line', 'annotation', 'value', 'stat'],
  move: ['pointer', 'bracket'],
  set: ['line', 'value', 'annotation', 'pointer', 'bracket', 'stat'],
  pulse: ['line', 'annotation', 'value', 'pointer', 'bracket', 'stat'],
} as const satisfies Record<string, readonly LinesPartKind[]>;

/** timeline: draw track, lane (optional `upto` an event) · show/hide event, span, marker, stat · move marker (to an event), span (to [first, last]) · focus event, lane, span (or `between`) · set event (tone, label), span / marker (label, tone), lane (tone), stat (value, tone) · pulse event, span, marker, stat. */
export const TIMELINE_VERBS = {
  draw: ['track', 'lane'],
  show: ['event', 'span', 'marker', 'stat'],
  hide: ['event', 'span', 'marker', 'stat'],
  move: ['marker', 'span'],
  focus: ['event', 'lane', 'span', 'stat'],
  set: ['event', 'span', 'marker', 'lane', 'stat'],
  pulse: ['event', 'span', 'marker', 'stat'],
} as const satisfies Record<string, readonly TimelinePartKind[]>;

export const EXTRA_KIT_VERBS = { lines: LINES_VERBS, timeline: TIMELINE_VERBS } as const;

/** The rows for core/clip.ts `VERBS_BY_STAGE`: the verbs each of the two stages accepts. */
export const EXTRA_VERBS_BY_STAGE = {
  lines: ['show', 'hide', 'focus', 'set', 'move', 'pulse'],
  timeline: ['show', 'hide', 'draw', 'focus', 'set', 'move', 'pulse'],
} as const;

/** One line per stage kind, for the skill text and for error messages. */
export const EXTRA_KIT_VERB_SUMMARY: Record<ExtraStageKind, string> = {
  lines:
    'lines: show/hide (line, annotation, value, bracket, pointer, stat); focus (line, annotation, value, stat; or between: [first, last]); move (pointer to a line; bracket to a line or [first, last]); set (line: tone, label; value: value, tone; annotation, pointer, bracket: label, tone; stat: value, tone); pulse (any part)',
  timeline:
    'timeline: draw ("track" or a lane, optional upto: event); show/hide (event, span, marker, stat); move (marker to an event; span to [first, last]); focus (event, lane, span, stat; or between: [first, last]); set (event: tone, label; span, marker: label, tone; lane: tone; stat: value, tone); pulse (event, span, marker, stat)',
};

// ---------------------------------------------------------------------------------------------
// Parts by id, and the checks a schema cannot express
// ---------------------------------------------------------------------------------------------

/** Every id a beat may name on this stage, with the kind of part it is. Later duplicates do not replace earlier ones. */
export function extraStageParts(stage: ExtraStage): Map<string, LinesPartKind | TimelinePartKind> {
  const out = new Map<string, LinesPartKind | TimelinePartKind>();
  const put = (id: string, kind: LinesPartKind | TimelinePartKind): void => {
    if (!out.has(id)) out.set(id, kind);
  };
  if (stage.kind === 'lines') {
    stage.lines.forEach((_, i) => put(`l${i + 1}`, 'line'));
    for (const p of stage.pointers ?? []) put(p.id, 'pointer');
    for (const b of stage.brackets ?? []) put(b.id, 'bracket');
    for (const a of stage.annotations ?? []) put(a.id, 'annotation');
    for (const v of stage.values ?? []) put(v.id, 'value');
  } else {
    put(TRACK_ID, 'track');
    for (const l of stage.lanes ?? []) put(l.id, 'lane');
    for (const e of stage.events) put(e.id, 'event');
    for (const s of stage.spans ?? []) put(s.id, 'span');
    for (const m of stage.markers ?? []) put(m.id, 'marker');
  }
  for (const s of stage.stats ?? []) put(s.id, 'stat');
  return out;
}

export interface ExtraStageProblem {
  /** Path inside the stage, for example ["annotations", 0, "at"]. */
  path: (string | number)[];
  message: string;
}

/**
 * What the schema cannot say about one stage: ids are unique, references point at parts that
 * exist, and the stage fits its row budget. Pure; the validator turns each problem into an issue.
 */
export function checkExtraStage(stage: ExtraStage): ExtraStageProblem[] {
  const problems: ExtraStageProblem[] = [];
  const seen = new Map<string, string>();
  const claim = (id: string, what: string, path: (string | number)[]): void => {
    const before = seen.get(id);
    if (before !== undefined) problems.push({ path, message: `The id "${id}" is used twice on this stage (${before} and ${what}). Give every part its own id.` });
    else seen.set(id, what);
  };
  const each = <T extends { id: string }>(key: string, what: string, list: readonly T[] | undefined): void => {
    (list ?? []).forEach((p, i) => claim(p.id, what, [key, i, 'id']));
  };
  if (stage.kind === 'lines') {
    const n = stage.lines.length;
    stage.lines.forEach((_, i) => seen.set(`l${i + 1}`, `line ${i + 1}`));
    each('pointers', 'a pointer', stage.pointers);
    each('brackets', 'a bracket', stage.brackets);
    each('annotations', 'an annotation', stage.annotations);
    each('values', 'a value', stage.values);
    each('stats', 'a stat', stage.stats);
    const lineExists = (ref: string): boolean => LINE_REF_PATTERN.test(ref) && Number(ref.slice(1)) <= n;
    (stage.annotations ?? []).forEach((a, i) => {
      if (!lineExists(a.at)) problems.push({ path: ['annotations', i, 'at'], message: `The annotation "${a.id}" is attached to "${a.at}", but this stage has lines l1 to l${n}.` });
    });
    (stage.values ?? []).forEach((v, i) => {
      if (!lineExists(v.at)) problems.push({ path: ['values', i, 'at'], message: `The value "${v.id}" sits beside "${v.at}", but this stage has lines l1 to l${n}.` });
    });
    const rows = n + 2 * (stage.annotations ?? []).length;
    if (rows > L.lines.rowBudget) {
      problems.push({ path: ['lines'], message: `${n} lines and ${(stage.annotations ?? []).length} annotations need ${rows} rows; a stage holds ${L.lines.rowBudget} (an annotation takes two). Use fewer lines or split the clip.` });
    }
    if (stage.language !== undefined && stage.format !== 'code') problems.push({ path: ['language'], message: '"language" belongs to format "code" only.' });
    if (stage.format !== 'code' && stage.lines.some((l) => l.trim() === '')) problems.push({ path: ['lines'], message: `An empty line is allowed in code only; this stage is "${stage.format}".` });
  } else {
    seen.set(TRACK_ID, 'the track');
    each('lanes', 'a lane', stage.lanes);
    each('events', 'an event', stage.events);
    each('spans', 'a span', stage.spans);
    each('markers', 'a marker', stage.markers);
    each('stats', 'a stat', stage.stats);
    const lanes = new Set((stage.lanes ?? []).map((l) => l.id));
    const order = new Map(stage.events.map((e, i) => [e.id, i]));
    stage.events.forEach((e, i) => {
      if (e.lane === undefined) return;
      if (lanes.size === 0) problems.push({ path: ['events', i, 'lane'], message: `The event "${e.id}" names the lane "${e.lane}", but this stage declares no lanes.` });
      else if (!lanes.has(e.lane)) problems.push({ path: ['events', i, 'lane'], message: `The event "${e.id}" names the lane "${e.lane}". The lanes are: ${[...lanes].join(', ')}.` });
    });
    for (const lane of stage.lanes ?? []) {
      if (!stage.events.some((e) => e.lane === lane.id)) problems.push({ path: ['lanes'], message: `The lane "${lane.id}" has no events. Remove it or give it one.` });
    }
    (stage.spans ?? []).forEach((s, i) => {
      const a = order.get(s.from);
      const b = order.get(s.to);
      if (a === undefined) problems.push({ path: ['spans', i, 'from'], message: `The span "${s.id}" starts at "${s.from}", which is not an event.` });
      if (b === undefined) problems.push({ path: ['spans', i, 'to'], message: `The span "${s.id}" ends at "${s.to}", which is not an event.` });
      if (a !== undefined && b !== undefined && a >= b) problems.push({ path: ['spans', i], message: `The span "${s.id}" must run forward: "${s.from}" has to come before "${s.to}" in the events.` });
    });
  }
  return problems;
}
