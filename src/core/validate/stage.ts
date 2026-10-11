// The stage of a clip and what its beats do to it: ids that are unique, references that resolve,
// verbs that the stage's kit can perform on the parts they name, and a stage that says honestly
// where its content comes from. A clip that fails here would stop the player when it is compiled
// (src/player/stage throws on an unknown part or a verb a part does not take), or would play
// something other than what its captions say.
//
// The verb tables. `lines` and `timeline` export theirs (EXTRA_KIT_VERBS in core/clip-kits-extra).
// The six stages of core/clip export only the verbs each stage accepts (VERBS_BY_STAGE), not which
// kind of part each verb acts on, so that table is written here, CORE_KIT_VERBS, and it is DERIVED
// FROM THE KIT CODE in src/player/stage/kit-{sequence,cells,dots,chart,flow,words}.ts and the base
// class in kit.ts: a verb is listed for a kind of part when the kit performs it on that part, and
// left out when the kit throws or silently does nothing. A test (test/validate/clip-engine.test.ts)
// compiles clips with the real kits and holds this table to them.
import { CLIP_LIMITS } from '../clip-base';
import type { Action, ClipScene, Stage, Verb } from '../clip';
import { evalExpr, parseExpr } from '../expr';
// The engine's own table of what a learner can tap: data and pure functions, with no imports.
import { TAPPABLE as ENGINE_TAPPABLE } from '../../player/stage/tappable';
import { EXTRA_KIT_VERBS, EXTRA_KIT_VERB_SUMMARY, TRACK_ID, checkExtraStage, type ExtraStage, type ExtraStageProblem } from '../clip-kits-extra';
import { issue } from '../issues';
import { LIMITS as L } from '../limits';
import { parseMath } from '../math';
import type { Issue } from '../types';
import type { Ctx } from './context';
// src/frame/check.ts, through the bridge that keeps it out of the browser's type check.
import { checkFrame, checkFrameBeats, type FrameIssue } from './frame-check';
import { fieldSafetyIssues, linesSafetyIssues } from './safety';
import { idList, nearest, onlyNearest, show } from './shape';

// ---------------------------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------------------------

export type PartKind =
  | 'actor'
  | 'message'
  | 'cell'
  | 'pointer'
  | 'bracket'
  | 'group'
  | 'bar'
  | 'series'
  | 'curve'
  | 'point'
  | 'node'
  | 'edge'
  | 'line'
  | 'annotation'
  | 'value'
  | 'track'
  | 'lane'
  | 'event'
  | 'span'
  | 'marker'
  | 'stat';

export interface StagePart {
  id: string;
  kind: PartKind;
  /** Where the part's id is written: "stage.nodes[1].id". A line of a lines stage has no id of its own: "stage.lines[2]". */
  path: string;
}

/** What a kind of part is called in a message: after "is", and in a list. */
const A: Record<PartKind, string> = {
  actor: 'an actor',
  message: 'a message',
  cell: 'a cell',
  pointer: 'a pointer',
  bracket: 'a bracket',
  group: 'a group of dots',
  bar: 'a bar',
  series: 'a series',
  curve: 'a curve',
  point: 'a point on a curve',
  node: 'a node',
  edge: 'an edge',
  line: 'a line',
  annotation: 'an annotation',
  value: 'a value beside a line',
  track: 'the track',
  lane: 'a lane',
  event: 'an event',
  span: 'a span',
  marker: 'a marker',
  stat: 'a read-out',
};
const NAME: Record<PartKind, string> = { ...Object.fromEntries(Object.entries(A).map(([kind, text]) => [kind, text.replace(/^(an?|the) /, '')])), stat: 'read-out', group: 'group', value: 'value', point: 'point' } as Record<PartKind, string>;

/** "cells", "chart.bars": the stage kind as the verb tables are keyed. */
export function stageKey(stage: Stage): string {
  return stage.kind === 'chart' ? `chart.${stage.mark}` : stage.kind;
}
/** "cells", "bar chart": the stage kind as a message names it. */
export function stageName(stage: Stage): string {
  return stage.kind === 'chart' ? (stage.mark === 'bars' ? 'bar chart' : stage.mark === 'line' ? 'line chart' : 'curve chart') : stage.kind;
}

/** Every part of a stage that an action can name, in the order the stage lists them. A frame has none. */
export function stageParts(stage: Stage): StagePart[] {
  const out: StagePart[] = [];
  const each = (key: string, kind: PartKind, list: readonly { id: string }[] | undefined): void => {
    (list ?? []).forEach((part, i) => out.push({ id: part.id, kind, path: `stage.${key}[${i}].id` }));
  };
  switch (stage.kind) {
    case 'sequence':
      each('actors', 'actor', stage.actors);
      each('messages', 'message', stage.messages);
      break;
    case 'cells':
      each('cells', 'cell', stage.cells);
      each('pointers', 'pointer', stage.pointers);
      each('brackets', 'bracket', stage.brackets);
      break;
    case 'dots':
      out.push({ id: stage.group.id, kind: 'group', path: 'stage.group.id' });
      break;
    case 'chart':
      if (stage.mark === 'bars') each('bars', 'bar', stage.bars);
      else if (stage.mark === 'line') each('series', 'series', stage.series);
      else {
        each('curves', 'curve', stage.curves);
        each('points', 'point', stage.points);
      }
      break;
    case 'flow':
      each('nodes', 'node', stage.nodes);
      each('edges', 'edge', stage.edges);
      break;
    case 'words':
      each('lines', 'line', stage.lines);
      break;
    case 'lines':
      stage.lines.forEach((_, i) => out.push({ id: `l${i + 1}`, kind: 'line', path: `stage.lines[${i}]` }));
      each('pointers', 'pointer', stage.pointers);
      each('brackets', 'bracket', stage.brackets);
      each('annotations', 'annotation', stage.annotations);
      each('values', 'value', stage.values);
      break;
    case 'timeline':
      out.push({ id: TRACK_ID, kind: 'track', path: 'stage' });
      each('lanes', 'lane', stage.lanes);
      each('events', 'event', stage.events);
      each('spans', 'span', stage.spans);
      each('markers', 'marker', stage.markers);
      break;
    case 'frame':
      return out;
  }
  if (stage.kind !== 'words') each('stats', 'stat', stage.stats);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Which verb acts on which kind of part
// ---------------------------------------------------------------------------------------------

export type VerbTable = Partial<Record<Verb, readonly PartKind[]>>;

const BOXES = ['cell', 'pointer', 'bracket', 'stat'] as const;

/**
 * The six stages of core/clip: for each verb, the kinds of part the kit performs it on. Derived
 * from the kits (see the note at the top of this file); a read-out takes show, hide, set, pulse
 * and focus on every stage that has read-outs, whether or not VERBS_BY_STAGE lists the verb.
 *
 *   sequence    an actor is a box (every shared verb); a message is a connector that only `send`
 *               draws, and that a `focus` can name.
 *   cells       cells, pointers and brackets are boxes; `move` wants a pointer or a bracket, `swap`
 *               and `reorder` want cells.
 *   dots        a group takes split, merge, focus and `set tone`, and nothing else.
 *   chart.bars  a bar takes every shared verb and `reorder`.
 *   chart.line  a series is drawn and can be in focus; it takes nothing else.
 *   chart.curve a curve is drawn (`draw`, which may stop at a number on the x axis with `upto`) and
 *               takes every shared verb; so does a point on a curve. Both take `set tone` only.
 *   flow        a node is a box; an edge is a connector that `draw` draws, `send` travels (`along`)
 *               and a `focus` can name.
 *   words       a line takes show, hide, focus, pulse and `set tone`.
 */
export const CORE_KIT_VERBS = {
  sequence: { show: ['actor', 'stat'], hide: ['actor', 'stat'], send: ['message'], focus: ['actor', 'message', 'stat'], set: ['actor', 'stat'], pulse: ['actor', 'stat'] },
  cells: { show: BOXES, hide: BOXES, move: ['pointer', 'bracket'], swap: ['cell'], reorder: ['cell'], focus: BOXES, set: BOXES, pulse: BOXES },
  dots: { split: ['group'], merge: ['group'], focus: ['group', 'stat'], set: ['group', 'stat'], show: ['stat'], hide: ['stat'], pulse: ['stat'] },
  'chart.bars': { show: ['bar', 'stat'], hide: ['bar', 'stat'], set: ['bar', 'stat'], reorder: ['bar'], focus: ['bar', 'stat'], pulse: ['bar', 'stat'] },
  'chart.line': { draw: ['series'], focus: ['series', 'stat'], set: ['stat'], pulse: ['stat'], show: ['stat'], hide: ['stat'] },
  'chart.curve': { show: ['curve', 'point', 'stat'], hide: ['curve', 'point', 'stat'], draw: ['curve'], focus: ['curve', 'point', 'stat'], set: ['curve', 'point', 'stat'], pulse: ['curve', 'point', 'stat'] },
  flow: { show: ['node', 'stat'], hide: ['node', 'stat'], draw: ['edge'], send: ['edge', 'node'], focus: ['node', 'edge', 'stat'], set: ['node', 'stat'], pulse: ['node', 'stat'] },
  words: { show: ['line'], hide: ['line'], focus: ['line'], set: ['line'], pulse: ['line'] },
} as const satisfies Record<string, VerbTable>;

/** The verbs of a stage, each with the kinds of part it acts on. Empty for a frame, which takes no actions. */
export function kitVerbs(stage: Stage): VerbTable {
  if (stage.kind === 'frame') return {};
  if (stage.kind === 'lines' || stage.kind === 'timeline') return EXTRA_KIT_VERBS[stage.kind];
  return CORE_KIT_VERBS[stageKey(stage) as keyof typeof CORE_KIT_VERBS];
}

/** "show (actor, read-out); send (message); ...": the table of a stage in one line, for a fix. */
export function verbSummary(stage: Stage): string {
  return Object.entries(kitVerbs(stage))
    .map(([verb, kinds]) => `${verb} (${(kinds as readonly PartKind[]).map((k) => NAME[k]).join(', ')})`)
    .join('; ');
}

/** "show/hide (node); draw (edge)": a table with the verbs that share their parts written together, read-outs left out. */
function tableNote(table: VerbTable): string {
  const groups = new Map<string, string[]>();
  for (const [verb, kinds] of Object.entries(table)) {
    const parts = (kinds as readonly PartKind[]).filter((k) => k !== 'stat').map((k) => NAME[k]).join(', ');
    if (parts !== '') groups.set(parts, [...(groups.get(parts) ?? []), verb]);
  }
  return [...groups].map(([parts, verbs]) => `${verbs.join('/')} (${parts})`).join('; ');
}

/**
 * The verbs of every stage kind with the parts each works on, as one paragraph for the template
 * notes. Generated from the tables above (and from the summary the `lines` and `timeline` kits
 * export), so what an agent is told is what is checked. Read-outs are left out: they take the
 * same verbs on every stage.
 */
export const STAGE_VERB_NOTES: string = [
  ...Object.entries(CORE_KIT_VERBS).map(([key, table]) => `${key === 'chart.bars' ? 'chart with bars' : key === 'chart.line' ? 'chart with a line' : key === 'chart.curve' ? 'chart with curves' : key}: ${tableNote(table)}.`),
  `${EXTRA_KIT_VERB_SUMMARY.lines}.`,
  `${EXTRA_KIT_VERB_SUMMARY.timeline}.`,
  'Parameters: on a sequence, send takes "target" (a message), once for each message. On cells, move takes "to" (a cell; for a bracket also [first, last]), swap takes "a" and "b", reorder takes "order" (every cell once), and focus and set also take "between": [first, last]. On dots, split takes "into": [{ "id", "label", "count" }] (the counts add up to the group) and merge takes "targets" and "into": { "id", "label" }; a group takes set with a tone only. On a chart, a bar takes set with a number and reorder takes "order" (every bar once); a curve and a point take set with a tone only, and draw may stop a curve at a number on the x axis with "upto". On a flow, send takes "along" (an edge) or "from" and "to" (nodes), and set may give a node "size". A line of a words stage takes set with a tone only.',
].join(' ');

type SetParam = 'value' | 'label' | 'tone' | 'size';
const TEXT: readonly SetParam[] = ['label', 'value', 'tone'];
const READOUT: readonly SetParam[] = ['value', 'tone'];
const TONE: readonly SetParam[] = ['tone'];

/**
 * What a `set` may change on a kind of part, again as the kits perform it. A read-out and a value
 * beside a line hold a `value`; a part that shows words takes new words (`label`; a `value` is read
 * as the same thing); a bar takes a number; a group of dots, a line of a words stage and a lane
 * take a `tone` only; only a flow node has a `size`.
 */
function settable(stage: Stage, kind: PartKind): readonly SetParam[] {
  switch (kind) {
    case 'stat':
    case 'value':
    case 'bar':
      return READOUT;
    case 'group':
    case 'lane':
    case 'curve':
    case 'point':
      return TONE;
    case 'line':
      return stage.kind === 'words' ? TONE : TEXT;
    case 'node':
      return [...TEXT, 'size'];
    default:
      return TEXT;
  }
}

/** The kinds of part a range (`between`) runs over, for the verbs that take one on this stage. */
function rangeKind(stage: Stage, verb: 'focus' | 'set'): PartKind | null {
  if (stage.kind === 'cells') return 'cell';
  if (stage.kind === 'lines') return 'line';
  if (stage.kind === 'timeline' && verb === 'focus') return 'event';
  return null;
}

// ---------------------------------------------------------------------------------------------
// The stage on its own
// ---------------------------------------------------------------------------------------------

const joinIds = (ids: readonly string[]): string => (ids.length ? ids.join(', ') : 'none');

/** Part ids as a message lists them: the lines of a lines stage as a run, everything else by name. */
function listIds(parts: readonly StagePart[], kinds: readonly PartKind[]): string {
  const lines = parts.filter((p) => p.kind === 'line' && /^l[0-9]+$/.test(p.id) && p.path.startsWith('stage.lines[') && !p.path.endsWith('.id'));
  const named = parts.filter((p) => kinds.includes(p.kind) && !lines.includes(p)).map((p) => p.id);
  const out: string[] = [];
  if (kinds.includes('line') && lines.length > 0) out.push(lines.length === 1 ? 'l1' : `l1 to l${lines.length} (one per line)`);
  out.push(...named);
  return joinIds(out);
}

/** "a cell", "a read-out": a kind of part as a message names it. */
export function aPart(kind: PartKind): string {
  return A[kind];
}

export const kindsText = (kinds: readonly PartKind[]): string => {
  const words = kinds.map((k) => A[k]);
  return words.length <= 1 ? (words[0] ?? 'nothing') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
};

/** How an extra stage's problem (core/clip-kits-extra `checkExtraStage`) is reported: its code and a fix for this stage. */
function extraProblem(stage: ExtraStage, problem: ExtraStageProblem): Issue | null {
  const last = problem.path[problem.path.length - 1];
  // Ids used twice are found for every stage kind by `structureIssues`, with both places named.
  if (last === 'id') return null;
  const path = `stage${problem.path.map((key) => (typeof key === 'number' ? `[${key}]` : `.${key}`)).join('')}`;
  const first = problem.path[0];
  if (last === 'at' && stage.kind === 'lines') {
    const n = stage.lines.length;
    return issue('STAGE_UNKNOWN_REF', path, problem.message, { fix: `Set "at" to a line of this stage: ${n === 1 ? 'l1' : `l1 to l${n}`}.` });
  }
  if (stage.kind === 'timeline' && last === 'lane') {
    const lanes = (stage.lanes ?? []).map((l) => l.id);
    return issue('STAGE_UNKNOWN_REF', path, problem.message, { fix: lanes.length ? `Use one of the lanes: ${joinIds(lanes)}.` : 'Remove "lane" from the event, or declare the lanes in "lanes" (two or three).' });
  }
  if (stage.kind === 'timeline' && first === 'spans' && (last === 'from' || last === 'to')) {
    return issue('STAGE_UNKNOWN_REF', path, problem.message, { fix: `A span runs from one event to a later one. The event ids are: ${joinIds(stage.events.map((e) => e.id))}.` });
  }
  let fix = 'Change the stage so that this holds, and submit the clip again.';
  if (first === 'language') fix = 'Remove "language", or set "format" to "code".';
  else if (first === 'lines' && stage.kind === 'lines') {
    fix = problem.message.includes('rows')
      ? `Use fewer lines or annotations, or show the rest in a second clip (plan_lesson again). The lines of a clip stay readable up to about ${stage.lines.length > 12 ? 12 : 'a dozen'}.`
      : 'Remove the empty line. Only code keeps blank lines.';
  } else if (first === 'lanes') fix = 'Give the lane an event (set "lane" on an event to its id), or remove the lane.';
  else if (first === 'spans') fix = 'Swap "from" and "to": a span starts at the earlier event, in the order of "events".';
  return issue('STAGE_INCONSISTENT', path, problem.message, { fix });
}

/** Ids, references and consistency of the stage data, before any action is looked at. */
function structureIssues(stage: Stage, parts: readonly StagePart[]): Issue[] {
  const out: Issue[] = [];

  const seen = new Map<string, StagePart>();
  for (const part of parts) {
    const first = seen.get(part.id);
    if (first === undefined) {
      seen.set(part.id, part);
      continue;
    }
    const reserved =
      first.kind === 'track'
        ? `"${TRACK_ID}" names the whole track of a timeline, so no part may use it.`
        : first.kind === 'line' && stage.kind === 'lines'
          ? `The lines of a lines stage are named l1, l2, ... by position, so "${part.id}" is taken by line ${part.id.slice(1)}.`
          : `The id "${part.id}" is used twice on this stage, at ${first.path} and ${part.path}.`;
    out.push(
      issue('STAGE_DUPLICATE_ID', part.path, reserved, {
        fix: `Rename ${first.kind === 'track' || (first.kind === 'line' && stage.kind === 'lines') ? 'the part' : 'one of them'}. All parts of a stage, its read-outs included, share one set of ids, because an action names a part by id alone.`,
        got: part.id,
      }),
    );
  }

  const ends = (list: string, links: readonly { id: string; from: string; to: string }[], kind: 'actor' | 'node', ids: readonly string[]): void => {
    links.forEach((link, i) => {
      let known = true;
      for (const side of ['from', 'to'] as const) {
        const target = link[side];
        if (ids.includes(target)) continue;
        known = false;
        const guess = nearest(target, ids);
        out.push(
          issue('STAGE_UNKNOWN_REF', `stage.${list}[${i}].${side}`, `"${link.id}" goes ${side} "${target}", which is not ${A[kind]} of this stage.`, {
            fix: `${guess ? `Use "${guess}". ` : ''}The ${kind} ids are: ${joinIds(ids)}.`,
            got: target,
            expected: `one of ${joinIds(ids)}`,
          }),
        );
      }
      if (known && link.from === link.to) {
        out.push(
          issue('STAGE_INCONSISTENT', `stage.${list}[${i}].to`, `"${link.id}" goes from "${link.from}" back to "${link.to}": ${kind === 'actor' ? 'a message' : 'an edge'} joins two different ${kind}s.`, {
            fix: `Set "to" to another ${kind} (${joinIds(ids.filter((id) => id !== link.from))}), or remove "${link.id}".`,
            got: link.to,
          }),
        );
      }
    });
  };

  switch (stage.kind) {
    case 'sequence': {
      const actors = stage.actors.map((a) => a.id);
      ends('messages', stage.messages, 'actor', actors);
      (stage.stats ?? []).forEach((stat, i) => {
        if (stat.at === undefined || actors.includes(stat.at)) return;
        const guess = nearest(stat.at, actors);
        out.push(
          issue('STAGE_UNKNOWN_REF', `stage.stats[${i}].at`, `The read-out "${stat.id}" belongs to "${stat.at}", which is not an actor of this stage.`, {
            fix: `${guess ? `Use "${guess}". ` : ''}The actor ids are: ${joinIds(actors)}. Without "at" the read-out sits along the bottom edge.`,
            got: stat.at,
          }),
        );
      });
      break;
    }
    case 'flow':
      ends('edges', stage.edges, 'node', stage.nodes.map((n) => n.id));
      break;
    case 'chart':
      if (stage.mark === 'line') {
        const want = stage.xs.length;
        stage.series.forEach((series, i) => {
          if (series.values.length === want) return;
          out.push(
            issue('STAGE_INCONSISTENT', `stage.series[${i}].values`, `The series "${series.id}" has ${series.values.length} value${series.values.length === 1 ? '' : 's'}, but the chart has ${want} x positions.`, {
              fix: `Give it exactly ${want} values, one for each entry of "xs" in order.`,
              got: String(series.values.length),
              expected: String(want),
            }),
          );
        });
        stage.xs.forEach((x, i) => {
          const first = stage.xs.indexOf(x);
          if (first === i) return;
          out.push(
            issue('STAGE_INCONSISTENT', `stage.xs[${i}]`, `Two x positions of the chart, xs[${first}] and xs[${i}], have the same label.`, {
              fix: 'Give each x position its own label: a "draw" names the position to stop at by its label ("upto").',
            }),
          );
        });
      }
      if (stage.mark === 'curve') {
        if (!(stage.x.min < stage.x.max)) {
          out.push(
            issue('STAGE_INCONSISTENT', 'stage.x.max', `The x axis runs from ${stage.x.min} to ${stage.x.max}: its "min" must be below its "max".`, {
              fix: 'Give the x axis a "min" and a larger "max": the curves are drawn between the two, left to right.',
              got: String(stage.x.max),
              expected: `more than ${stage.x.min}`,
            }),
          );
        }
        if (stage.min !== undefined && stage.max !== undefined && !(stage.min < stage.max)) {
          out.push(
            issue('STAGE_INCONSISTENT', 'stage.max', `The value axis runs from ${stage.min} ("min") to ${stage.max} ("max"): its bottom must be below its top.`, {
              fix: 'Set "min" below "max", or remove both and let the stage choose the scale from what the curves reach.',
              got: String(stage.max),
              expected: `more than ${stage.min}`,
            }),
          );
        }
        const curves = stage.curves.map((c) => c.id);
        (stage.points ?? []).forEach((point, i) => {
          if (point.on === undefined || curves.includes(point.on)) return;
          const guess = nearest(point.on, curves);
          out.push(
            issue('STAGE_UNKNOWN_REF', `stage.points[${i}].on`, `The point "${point.id}" rides "${point.on}", which is not a curve of this chart.`, {
              fix: `${guess ? `Use "${guess}". ` : ''}The curve ids are: ${joinIds(curves)}. Without "on" the point rides the first curve.`,
              got: point.on,
              expected: `one of ${joinIds(curves)}`,
            }),
          );
        });
      }
      break;
    case 'lines':
    case 'timeline':
      for (const problem of checkExtraStage(stage)) {
        const found = extraProblem(stage, problem);
        if (found) out.push(found);
      }
      break;
    default:
      break;
  }

  if (stage.kind !== 'sequence' && stage.kind !== 'words' && stage.kind !== 'frame') {
    (stage.stats ?? []).forEach((stat, i) => {
      if (stat.at === undefined) return;
      out.push(
        issue('STAGE_INCONSISTENT', `stage.stats[${i}].at`, `The read-out "${stat.id}" has "at", which places a read-out beside an actor of a sequence stage; this is a ${stageName(stage)} stage.`, {
          fix: 'Remove "at". On this stage every read-out sits along the bottom edge.',
        }),
      );
    });
  }
  return out;
}

/** The largest value a chart shows, with where it is given: its own values and the ones a `set` counts a bar to. */
function chartPeak(scene: ClipScene): { value: number; path: string } | null {
  const stage = scene.stage;
  if (stage.kind !== 'chart') return null;
  let peak: { value: number; path: string } | null = null;
  const see = (value: number, path: string): void => {
    if (!peak || value > peak.value) peak = { value, path };
  };
  if (stage.mark === 'bars') {
    stage.bars.forEach((bar, i) => see(bar.value, `stage.bars[${i}].value`));
    const bars = new Set(stage.bars.map((b) => b.id));
    scene.beats.forEach((beat, i) =>
      beat.do.forEach((action, k) => {
        if (action.verb !== 'set' || typeof action.value !== 'number') return;
        const ids = action.targets ?? (action.target !== undefined ? [action.target] : []);
        if (ids.some((id) => bars.has(id))) see(action.value, `beats[${i}].do[${k}].value`);
      }),
    );
  } else if (stage.mark === 'line') {
    stage.series.forEach((series, i) => series.values.forEach((value) => see(value, `stage.series[${i}].values`)));
  }
  // A curve is clipped to the plot: what a formula reaches is checked where formulas are (./explore).
  return peak;
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

interface Group {
  count: number;
  live: boolean;
}

/** The ids an action gives in `target` / `targets`, each with its path. */
function named(action: { target?: string | undefined; targets?: string[] | undefined }, p: string): { ids: { id: string; path: string }[]; both: boolean } {
  const ids: { id: string; path: string }[] = [];
  if (action.targets !== undefined) action.targets.forEach((id, j) => ids.push({ id, path: `${p}.targets[${j}]` }));
  else if (action.target !== undefined) ids.push({ id: action.target, path: `${p}.target` });
  return { ids, both: action.target !== undefined && action.targets !== undefined };
}

/** The words a cue is looked for in: the caption as the player reads it (an analogy with its limits). */
function captionText(caption: ClipScene['beats'][number]['caption']): string {
  return caption.type === 'analogy' ? `${caption.text} ${caption.limits}` : caption.text;
}

/** Every action of every beat against the stage. */
function actionIssues(scene: ClipScene, parts: readonly StagePart[]): Issue[] {
  const out: Issue[] = [];
  const stage = scene.stage;
  const name = stageName(stage);
  const table = kitVerbs(stage);
  const verbs = Object.keys(table) as Verb[];
  const byId = new Map<string, StagePart>();
  for (const part of parts) if (!byId.has(part.id)) byId.set(part.id, part);

  // Dots: which groups are on stage changes as the clip plays.
  const groups = new Map<string, Group>();
  const later = new Map<string, number>();
  if (stage.kind === 'dots') {
    groups.set(stage.group.id, { count: stage.total, live: true });
    scene.beats.forEach((beat, i) =>
      beat.do.forEach((action) => {
        const made = action.verb === 'split' ? action.into.map((g) => g.id) : action.verb === 'merge' ? [action.into.id] : [];
        for (const id of made) if (!later.has(id)) later.set(id, i);
      }),
    );
  }
  const liveGroups = (): string[] => [...groups].filter(([, g]) => g.live).map(([id]) => id);
  const sent = new Map<string, number>();

  const kindOf = (id: string): PartKind | undefined => (groups.has(id) ? 'group' : byId.get(id)?.kind);
  const idsOfKinds = (kinds: readonly PartKind[]): string[] => [...parts.filter((p) => kinds.includes(p.kind)).map((p) => p.id), ...(kinds.includes('group') ? liveGroups().filter((id) => !byId.has(id)) : [])];
  const listed = (kinds: readonly PartKind[]): string => (stage.kind === 'dots' && kinds.includes('group') ? joinIds([...liveGroups(), ...parts.filter((p) => p.kind !== 'group' && kinds.includes(p.kind)).map((p) => p.id)]) : listIds(parts, kinds));

  /** A guess at the id that was meant: the nearest by spelling, or for a line "line4", "L4" and "4" as l4. */
  const guessFor = (id: string, kinds: readonly PartKind[]): string | null => {
    const valid = idsOfKinds(kinds);
    if (stage.kind === 'lines' && kinds.includes('line')) {
      const digits = /([0-9]+)$/.exec(id);
      if (digits && valid.includes(`l${Number(digits[1])}`)) return `l${Number(digits[1])}`;
    }
    return nearest(id, valid);
  };

  /**
   * One id that `verb` is to act on: it must be a part of the stage, of a kind the verb works on,
   * and (a group of dots) on stage now. Returns the part's kind when all of that holds.
   */
  const check = (id: string, path: string, verb: Verb, kinds: readonly PartKind[], subject = `This "${verb}"`): PartKind | null => {
    const kind = kindOf(id);
    if (kind === undefined) {
      if (later.has(id)) {
        out.push(
          issue('GROUP_NOT_ON_STAGE', path, `The group "${id}" is not on stage yet: it is created in beat ${(later.get(id) as number) + 1}.`, {
            fix: `Name a group that is on stage at this point (${joinIds(liveGroups())}), or move this action after the one that creates "${id}".`,
            got: id,
          }),
        );
        return null;
      }
      const guess = guessFor(id, kinds);
      out.push(
        issue('ACTION_UNKNOWN_PART', path, `${subject} names "${id}", which is not a part of this ${name} stage.`, {
          fix: `${guess ? `Use "${guess}". ` : ''}Name ${kindsText(kinds)}: ${listed(kinds)}.`,
          got: id,
        }),
      );
      return null;
    }
    if (!kinds.includes(kind)) {
      const takes = verbs.filter((v) => (table[v] as readonly PartKind[]).includes(kind));
      out.push(
        issue('ACTION_VERB_NOT_ALLOWED', path, `${subject} names "${id}", which is ${A[kind]}; on a ${name} stage it takes ${kindsText(kinds)}.`, {
          fix: `Name ${kindsText(kinds)}: ${listed(kinds)}. ${cap(A[kind])} takes: ${takes.length ? takes.join(', ') : 'no verb'}.`,
          got: id,
          expected: kindsText(kinds),
        }),
      );
      return null;
    }
    if (kind === 'group' && groups.get(id)?.live === false) {
      out.push(
        issue('GROUP_NOT_ON_STAGE', path, `The group "${id}" is no longer on stage: an earlier action split or merged it away.`, {
          fix: `Name a group that is on stage at this point: ${joinIds(liveGroups())}.`,
          got: id,
        }),
      );
      return null;
    }
    return kind;
  };

  const target = (path: string, message: string, fix: string): void => void out.push(issue('ACTION_TARGET', path, message, { fix }));
  const parameter = (path: string, message: string, fix: string, got?: string): void => void out.push(issue('ACTION_PARAMETER', path, message, { fix, ...(got !== undefined ? { got } : {}) }));

  /** `target` and `targets`, where a verb needs exactly one of the two. */
  const many = (action: { target?: string | undefined; targets?: string[] | undefined }, p: string, verb: Verb, kinds: readonly PartKind[], optional = false): PartKind[] => {
    const { ids, both } = named(action, p);
    if (both) target(p, `This "${verb}" has both "target" and "targets".`, 'Keep one: "target" for a single part, "targets" for several.');
    else if (ids.length === 0 && !optional) target(p, `This "${verb}" names no part.`, `Add "target" (one id) or "targets" (a list). Here "${verb}" works on ${kindsText(kinds)}: ${listed(kinds)}.`);
    const found: PartKind[] = [];
    for (const { id, path } of ids) {
      const kind = check(id, path, verb, kinds);
      if (kind) found.push(kind);
    }
    return found;
  };

  /** A range, `between: [first, last]`: both ends parts of the kind the stage ranges over. */
  const range = (pair: readonly [string, string], path: string, verb: 'focus' | 'set' | 'move', kind: PartKind): boolean => {
    let ok = true;
    pair.forEach((id, j) => {
      const got = kindOf(id);
      if (got === kind) return;
      ok = false;
      if (got === undefined) {
        const guess = guessFor(id, [kind]);
        out.push(
          issue('ACTION_UNKNOWN_PART', `${path}[${j}]`, `The range of this "${verb}" names "${id}", which is not ${A[kind]} of this ${name} stage.`, {
            fix: `${guess ? `Use "${guess}". ` : ''}A range runs from one ${NAME[kind]} to another: ${listIds(parts, [kind])}.`,
            got: id,
          }),
        );
      } else parameter(`${path}[${j}]`, `The range of this "${verb}" names "${id}", which is ${A[got]}; a range runs from one ${NAME[kind]} to another.`, `Use two ${NAME[kind]} ids: ${listIds(parts, [kind])}.`, id);
    });
    return ok;
  };

  scene.beats.forEach((beat, i) => {
    const caption = captionText(beat.caption).toLowerCase();
    beat.do.forEach((action: Action, k) => {
      const p = `beats[${i}].do[${k}]`;
      const verb = action.verb;

      if (action.on !== undefined && !caption.includes(action.on.toLowerCase())) {
        out.push(
          issue('ACTION_CUE_NOT_IN_CAPTION', `${p}.on`, `The cue of this "${verb}" is not a phrase of the caption of beat ${i + 1}.`, {
            fix: 'Set "on" to a word or a short phrase copied from this beat\'s caption exactly as it stands there (the action starts when that word is read), or remove "on" and let the action follow the one before it.',
            got: show(action.on),
          }),
        );
      }

      const kinds = table[verb];
      if (kinds === undefined) {
        out.push(
          issue('ACTION_VERB_NOT_ALLOWED', `${p}.verb`, `A ${name} stage has no "${verb}".`, {
            fix: `The verbs of a ${name} stage, with the parts each works on: ${verbSummary(stage)}.`,
            got: verb,
            expected: `one of ${verbs.join(', ')}`,
          }),
        );
        return;
      }

      switch (action.verb) {
        case 'show':
        case 'hide':
        case 'pulse':
          many(action, p, verb, kinds);
          break;

        case 'draw': {
          // On a timeline a draw that names nothing draws the whole track.
          many(action, p, verb, kinds, stage.kind === 'timeline');
          if (action.upto === undefined) break;
          if (stage.kind === 'chart' && stage.mark === 'line') {
            if (!stage.xs.includes(action.upto)) {
              const guess = nearest(action.upto, stage.xs);
              out.push(
                issue('ACTION_UNKNOWN_PART', `${p}.upto`, `This "draw" stops at "${show(action.upto)}", which is not an x position of the chart.`, {
                  fix: `${guess ? `Use "${guess}". ` : ''}"upto" is one of the labels in "xs", written exactly as it is there: ${stage.xs.map((x) => `"${x}"`).join(', ')}.`,
                  got: show(action.upto),
                }),
              );
            }
          } else if (stage.kind === 'chart' && stage.mark === 'curve') {
            const at = Number(action.upto.replace(/,/g, ''));
            if (action.upto.trim() === '' || !Number.isFinite(at) || at < stage.x.min || at > stage.x.max) {
              parameter(
                `${p}.upto`,
                `This "draw" stops at "${show(action.upto)}", which is not a value on the x axis of this chart (it runs from ${stage.x.min} to ${stage.x.max}).`,
                `On a curve chart "upto" is a number on the x axis, written as a string: "${(stage.x.min + stage.x.max) / 2}" stops the curve half way. Remove "upto" to draw the whole curve.`,
                show(action.upto),
              );
            }
          } else if (stage.kind === 'timeline') {
            const got = kindOf(action.upto);
            if (got !== 'event') {
              const guess = guessFor(action.upto, ['event']);
              out.push(
                issue('ACTION_UNKNOWN_PART', `${p}.upto`, `This "draw" stops at "${show(action.upto)}", which is not an event of this timeline.`, {
                  fix: `${guess ? `Use "${guess}". ` : ''}"upto" is the id of the event the track runs on to: ${listIds(parts, ['event'])}.`,
                  got: show(action.upto),
                }),
              );
            }
          } else parameter(`${p}.upto`, `"upto" stops a line or a curve of a chart, or the track of a timeline, early; on a ${name} stage a "draw" draws the whole connector.`, 'Remove "upto".');
          break;
        }

        case 'send': {
          if (stage.kind === 'sequence') {
            for (const key of ['along', 'from', 'to', 'label'] as const) {
              if (action[key] === undefined) continue;
              parameter(`${p}.${key}`, `"${key}" belongs to a "send" on a flow stage. On a sequence stage a send names a message, and the message already says who sends what to whom.`, `Remove "${key}" and name the message with "target".`);
            }
            if (action.target === undefined) {
              target(p, 'This "send" names no message.', `Add "target": the id of the message to send. The messages are: ${listIds(parts, ['message'])}.`);
              break;
            }
            if (!check(action.target, `${p}.target`, verb, ['message'])) break;
            const before = sent.get(action.target);
            if (before !== undefined) {
              out.push(
                issue('MESSAGE_SENT_TWICE', `${p}.target`, `The message "${action.target}" was already sent in beat ${before + 1}; a message is sent once.`, {
                  fix: `Declare a second message in "messages" (its own id, the same "from", "to" and "label" if it repeats) and send that one here. Not yet sent: ${joinIds(parts.filter((part) => part.kind === 'message' && !sent.has(part.id)).map((part) => part.id))}.`,
                  got: action.target,
                }),
              );
            } else sent.set(action.target, i);
            break;
          }
          // Flow: along an edge, or from one node to another.
          if (action.target !== undefined) {
            const edge = kindOf(action.target) === 'edge';
            parameter(
              `${p}.target`,
              'On a flow stage a "send" does not take "target": the token travels "along" an edge, or "from" one node "to" another.',
              edge ? `Use "along": "${action.target}" in place of "target".` : `Replace "target" with "along" (an edge id: ${listIds(parts, ['edge'])}), or with "from" and "to" (node ids: ${listIds(parts, ['node'])}).`,
              action.target,
            );
          }
          const hasPair = action.from !== undefined || action.to !== undefined;
          if (action.along !== undefined) {
            check(action.along, `${p}.along`, verb, ['edge'], 'The "along" of this "send"');
            if (hasPair) target(p, 'This "send" has "along" and also "from" or "to".', 'Keep "along" (the edge already says where it starts and ends), or remove it and give "from" and "to" to send the token between two nodes that no edge joins.');
          } else if (action.from === undefined || action.to === undefined) {
            if (action.target === undefined || hasPair) target(p, hasPair ? 'This "send" has only one of "from" and "to".' : 'This "send" does not say where the token travels.', `Give "along" (an edge id: ${listIds(parts, ['edge'])}), or both "from" and "to" (node ids: ${listIds(parts, ['node'])}).`);
          } else {
            const a = check(action.from, `${p}.from`, verb, ['node'], 'The "from" of this "send"');
            const b = check(action.to, `${p}.to`, verb, ['node'], 'The "to" of this "send"');
            if (a && b && action.from === action.to) parameter(`${p}.to`, `This "send" goes from "${action.from}" to itself.`, 'Send the token to another node.', action.to);
          }
          break;
        }

        case 'focus':
        case 'set': {
          const ranged = rangeKind(stage, action.verb);
          const { ids, both } = named(action, p);
          const found: PartKind[] = [];
          if (both) target(p, `This "${verb}" has both "target" and "targets".`, 'Keep one: "target" for a single part, "targets" for several.');
          if (action.between !== undefined) {
            if (ranged === null) {
              parameter(`${p}.between`, `"between" names a range of cells, of lines, or (for a focus) of events; ${verb === 'set' && stage.kind === 'timeline' ? 'a "set" on a timeline takes none' : `a ${name} stage has no ranges`}.`, `Name the parts with "targets": ${listed(kinds)}.`);
            } else {
              if (ids.length > 0) target(p, `This "${verb}" has "between" and also "target" or "targets".`, 'Keep one: "between" for a range, "target" or "targets" for parts named one by one.');
              if (range(action.between, `${p}.between`, action.verb, ranged)) found.push(ranged);
            }
          }
          for (const { id, path } of ids) {
            const kind = check(id, path, verb, kinds);
            if (kind) found.push(kind);
          }
          if (action.verb === 'focus') break;

          // set
          if (ids.length === 0 && action.between === undefined) target(p, 'This "set" names no part.', `Add "target" (one id) or "targets" (a list). Here "set" works on ${kindsText(kinds)}: ${listed(kinds)}.`);
          const given = (['value', 'label', 'tone', 'size'] as const).filter((key) => action[key] !== undefined);
          if (given.length === 0) {
            parameter(p, 'This "set" changes nothing: it has no "value", "label", "tone" or "size".', 'Give what changes: "value" (a number counts to it, a string morphs), "label" (new words on the part), "tone" (its meaning) or, on a flow node, "size".');
            break;
          }
          for (const key of given) {
            const kind = found.find((got) => !settable(stage, got).includes(key));
            if (kind === undefined) continue;
            const takes = settable(stage, kind).map((param) => `"${param}"`);
            const why =
              key === 'size'
                ? 'only a node of a flow stage has a size'
                : kind === 'stat' || kind === 'value'
                  ? `${A[kind]} shows a value: change it with "value"`
                  : kind === 'bar'
                    ? 'a bar shows a number: change it with "value"'
                    : `${A[kind]}${stage.kind === 'words' ? ' of a words stage' : ''} keeps its words: only its tone can change`;
            parameter(`${p}.${key}`, `This "set" gives "${key}" to ${A[kind]} of a ${name} stage, which does not take it: ${why}.`, `On ${A[kind]} a "set" takes ${takes.join(', ')}. ${key === 'label' && takes.includes('"value"') ? 'Rename "label" to "value".' : `Remove "${key}", or name a part that takes it.`}`);
          }
          if (found.includes('bar') && action.value !== undefined) {
            if (typeof action.value !== 'number') parameter(`${p}.value`, 'This "set" gives a bar a value that is text; a bar\'s value is a number.', 'Send the number without quotation marks. The unit of the chart is added by the stage ("unit").', show(action.value));
            else if (action.value < 0) parameter(`${p}.value`, `This "set" gives a bar the value ${action.value}; bars grow from zero, so a bar's value is zero or more.`, 'Use a value of zero or more, or show the quantity on a line chart, which can go below zero.', String(action.value));
          }
          break;
        }

        case 'move': {
          const kind = check(action.target, `${p}.target`, verb, kinds);
          if (!kind) break;
          const goal: PartKind = stage.kind === 'cells' ? 'cell' : stage.kind === 'lines' ? 'line' : 'event';
          const single = kind === 'pointer' || kind === 'marker';
          const wantsPair = kind === 'span';
          const to = action.to;
          if (typeof to === 'string') {
            if (wantsPair) {
              parameter(`${p}.to`, `This "move" sends the span "${action.target}" to one event; a span stretches between two.`, `Give "to" as [first, last], two event ids: ${listIds(parts, ['event'])}.`);
              break;
            }
            const got = kindOf(to);
            if (got === goal) break;
            if (got === undefined) {
              const guess = guessFor(to, [goal]);
              out.push(
                issue('ACTION_UNKNOWN_PART', `${p}.to`, `This "move" sends "${action.target}" to "${to}", which is not ${A[goal]} of this ${name} stage.`, {
                  fix: `${guess ? `Use "${guess}". ` : ''}${cap(A[kind])} goes to ${A[goal]}: ${listIds(parts, [goal])}.`,
                  got: to,
                }),
              );
            } else parameter(`${p}.to`, `This "move" sends "${action.target}" to "${to}", which is ${A[got]}; ${A[kind]} goes to ${A[goal]}.`, `Set "to" to ${A[goal]}: ${listIds(parts, [goal])}.`, to);
            break;
          }
          if (single) {
            parameter(`${p}.to`, `This "move" sends the ${NAME[kind]} "${action.target}" to a range; ${A[kind]} goes to one ${NAME[goal]}.`, `Give "to" as one ${NAME[goal]} id: ${listIds(parts, [goal])}. A range is for a ${stage.kind === 'timeline' ? 'span' : 'bracket'}.`);
            break;
          }
          range(to, `${p}.to`, 'move', goal);
          break;
        }

        case 'swap': {
          const a = check(action.a, `${p}.a`, verb, kinds);
          const b = check(action.b, `${p}.b`, verb, kinds);
          if (a && b && action.a === action.b) parameter(`${p}.b`, `This "swap" trades "${action.a}" with itself.`, `Name two different cells: ${listIds(parts, ['cell'])}.`, action.b);
          break;
        }

        case 'reorder': {
          const kind: PartKind = stage.kind === 'cells' ? 'cell' : 'bar';
          const all = parts.filter((part) => part.kind === kind).map((part) => part.id);
          let known = true;
          action.order.forEach((id, j) => {
            if (!check(id, `${p}.order[${j}]`, verb, kinds)) known = false;
          });
          if (!known) break;
          const missing = all.filter((id) => !action.order.includes(id));
          const repeated = [...new Set(action.order.filter((id, j) => action.order.indexOf(id) !== j))];
          if (missing.length === 0 && repeated.length === 0) break;
          const what = [missing.length ? `leaves out ${joinIds(missing)}` : '', repeated.length ? `names ${joinIds(repeated)} more than once` : ''].filter(Boolean).join(' and ');
          out.push(
            issue('REORDER_INCOMPLETE', `${p}.order`, `The "order" of this "reorder" ${what}; it must name every ${kind} of the stage exactly once.`, {
              fix: `List all ${all.length} ${kind}s once, in the new order from first to last: ${joinIds(all)}.`,
              got: String(action.order.length),
              expected: String(all.length),
            }),
          );
          break;
        }

        case 'split': {
          const parent = check(action.target, `${p}.target`, verb, kinds) ? (groups.get(action.target) as Group) : null;
          const made: string[] = [];
          action.into.forEach((group, j) => {
            const taken = byId.has(group.id) || groups.has(group.id) || made.includes(group.id);
            if (taken) {
              out.push(
                issue('STAGE_DUPLICATE_ID', `${p}.into[${j}].id`, `This "split" creates a group with the id "${group.id}", which ${made.includes(group.id) ? 'another group of the same split has' : 'is already used on this stage'}.`, {
                  fix: 'Give every group a split creates an id of its own, different from every part of the stage and from every group created earlier (even one that has since been split or merged away).',
                  got: group.id,
                }),
              );
            }
            made.push(group.id);
          });
          const sum = action.into.reduce((n, group) => n + group.count, 0);
          if (parent && sum !== parent.count) {
            out.push(
              issue('SPLIT_COUNT_MISMATCH', `${p}.into`, `The groups of this "split" add up to ${sum} dots, but "${action.target}" has ${parent.count} at this point.`, {
                fix: `Change the "count" values so that they add up to ${parent.count}: every dot of "${action.target}" goes into one of the new groups.`,
                got: String(sum),
                expected: String(parent.count),
              }),
            );
          }
          if (parent) parent.live = false;
          for (const group of action.into) if (!groups.has(group.id) && !byId.has(group.id)) groups.set(group.id, { count: group.count, live: true });
          break;
        }

        case 'merge': {
          let count = 0;
          const merged: Group[] = [];
          action.targets.forEach((id, j) => {
            if (action.targets.indexOf(id) !== j) {
              parameter(`${p}.targets[${j}]`, `This "merge" names the group "${id}" twice.`, 'Name each group once: a merge joins two or more different groups.', id);
              return;
            }
            if (!check(id, `${p}.targets[${j}]`, verb, kinds)) return;
            const group = groups.get(id) as Group;
            count += group.count;
            merged.push(group);
          });
          const into = action.into.id;
          if (byId.has(into) || groups.has(into)) {
            out.push(
              issue('STAGE_DUPLICATE_ID', `${p}.into.id`, `This "merge" creates a group with the id "${into}", which is already used on this stage.`, {
                fix: 'Give the merged group an id of its own, different from every part of the stage and from every group created earlier (the groups being merged included).',
                got: into,
              }),
            );
          } else groups.set(into, { count, live: true });
          for (const group of merged) group.live = false;
          break;
        }
      }
    });
  });
  return out;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------------------------
// What is on show, beat by beat
// ---------------------------------------------------------------------------------------------

/** A group of dots as the clip makes it and leaves it. */
export interface GroupLife {
  /** The dots it holds, as the stage, the `split` or the `merge` that made it says. */
  count: number;
  /** On stage once the last beat has played. */
  live: boolean;
  /** How it came to be: the group every dot starts in, a `split`, or a `merge`. */
  made: 'start' | 'split' | 'merge';
  /** A split-off group: the group it was split from, */
  from?: string;
  /** how many dots that group held at that moment, */
  fromCount?: number;
  /** and every group that split made, this one included. */
  siblings?: readonly string[];
  /** The groups a later `split` divided this one into. */
  kids?: readonly string[];
  /** A merged group: the groups that flowed into it. */
  sources?: readonly string[];
  /** The group a later `merge` took this one into. */
  mergedInto?: string;
}

export interface StageRun {
  /** `before[i]`: the ids of the parts on show when beat i begins, which is when a gate on that beat opens. */
  before: ReadonlySet<string>[];
  /** The parts on show once the last beat has played: what an explore starts from. */
  after: ReadonlySet<string>;
  /** Dots: every group the clip starts with or creates, by id. Empty on every other stage. */
  groups: ReadonlyMap<string, GroupLife>;
}

/** Kinds of part that are not on stage until an action brings them, whatever the clip's `show`s name. */
const ARRIVES_BY_ACTION: readonly PartKind[] = ['message', 'edge', 'pointer', 'bracket', 'annotation', 'span', 'marker', 'series'];

/** How far along its x axis a curve has been drawn, and whether its name (what a tap on a curve is offered by) has arrived. */
interface CurveLife {
  to: number;
  named: boolean;
}

/**
 * The clip played through as the kits play it, for one question only: which parts are on show at
 * each beat. DERIVED FROM THE KIT CODE (src/player/stage), like the verb tables above:
 *
 *   every stage   a part that some `show` of the clip names starts off stage (timeline.ts collects
 *                 them, `hideAtStart`); `show` brings a part on and `hide` takes it off.
 *   sequence      a message is on stage once a `send` has sent it.
 *   cells, lines  a pointer or a bracket arrives with its first `move`; an annotation with a `show`;
 *                 a value beside a line that has no `value` with its first `set`.
 *   dots          the groups on stage are the ones `split` and `merge` have left. Every group the
 *                 clip makes is also kept with its place in the tree of splits and merges, which
 *                 is what an explore's bindings are held to.
 *   chart         a series arrives with its first `draw`. A curve that some `draw` names starts
 *                 undrawn, and is offered for a tap (by its name, at its right end) once a `draw`
 *                 has taken it to the end of the axis; every other curve draws itself as the clip
 *                 opens. A point is on show while it is, its curve is, and the curve has been
 *                 drawn past the point's x (worked out with every control at its starting value).
 *   flow          an edge arrives with a `draw`, or with a `send` that travels it and is not lost,
 *                 and goes for good when a node at one of its ends is hidden.
 *   timeline      the opening draws each track as far as the first event a later `show` brings,
 *                 with the events on the way, unless a `draw` names that track before any `show`
 *                 has run it on: then only `draw` and `show` bring its events. A `draw` brings the
 *                 events between where the track had got to and where it stops. Events are counted
 *                 in their order, which is how a narrow stage lays them out; a wide stage with
 *                 lanes may show an event a little sooner, never later.
 *
 * It does not judge the actions (./actionIssues does): one that names nothing real is passed over.
 */
export function runStage(scene: ClipScene, parts: readonly StagePart[]): StageRun {
  const stage = scene.stage;
  const byId = new Map<string, StagePart>();
  for (const part of parts) if (!byId.has(part.id)) byId.set(part.id, part);
  const kind = (id: string): PartKind | undefined => byId.get(id)?.kind;
  const actions = scene.beats.flatMap((beat) => beat.do);
  const idsOf = (action: Action): string[] => ('targets' in action && action.targets !== undefined ? action.targets : 'target' in action && action.target !== undefined ? [action.target] : []);

  const later = new Set<string>();
  for (const action of actions) if (action.verb === 'show') for (const id of idsOf(action)) later.add(id);

  // ----- curve chart: how far each curve is drawn, and where each point sits at the starting values
  const curveChart = stage.kind === 'chart' && stage.mark === 'curve' ? stage : null;
  const curveLife = new Map<string, CurveLife>();
  const pointAt = new Map<string, { curve: string; x: number | null }>();
  if (curveChart) {
    const drawnLater = new Set<string>();
    for (const action of actions) if (action.verb === 'draw') for (const id of idsOf(action)) drawnLater.add(id);
    for (const curve of curveChart.curves) curveLife.set(curve.id, drawnLater.has(curve.id) ? { to: curveChart.x.min, named: false } : { to: curveChart.x.max, named: true });
    const start: Record<string, number> = Object.fromEntries((scene.explore?.controls ?? []).map((control) => [control.id, control.value]));
    const first = curveChart.curves[0]?.id as string;
    for (const q of curveChart.points ?? []) {
      // A formula that cannot be read is reported where formulas are; here the point is then taken to sit where its curve begins.
      const parsed = parseExpr(q.x);
      const x = parsed.ok ? evalExpr(parsed.expr, start) : Number.NaN;
      pointAt.set(q.id, { curve: q.on ?? first, x: Number.isFinite(x) ? x : null });
    }
  }

  const on = new Set<string>();
  const groups = new Map<string, GroupLife>();
  for (const part of parts) {
    if (later.has(part.id) || ARRIVES_BY_ACTION.includes(part.kind) || part.kind === 'event') continue;
    on.add(part.id);
  }
  if (stage.kind === 'lines') (stage.values ?? []).forEach((value) => void (value.value === undefined && on.delete(value.id)));
  if (stage.kind === 'dots') groups.set(stage.group.id, { count: stage.total, live: true, made: 'start' });

  // ----- timeline: which tracks the opening draws, and how far each has got
  const events = stage.kind === 'timeline' ? stage.events : [];
  const index = new Map(events.map((event, i) => [event.id, i] as const));
  const laneIds = stage.kind === 'timeline' && stage.lanes && stage.lanes.length > 0 ? stage.lanes.map((lane) => lane.id) : [TRACK_ID];
  const lanesOf = (i: number): string[] => {
    const lane = (events[i] as { lane?: string | undefined }).lane;
    return laneIds.length === 1 ? laneIds : lane !== undefined && laneIds.includes(lane) ? [lane] : laneIds;
  };
  const drawnLanes = (action: Action): string[] => {
    const ids = idsOf(action);
    return ids.length === 0 || ids.includes(TRACK_ID) ? laneIds : ids.filter((id) => laneIds.includes(id));
  };
  const stopAt = (action: Action): number => (action.verb === 'draw' && action.upto !== undefined ? (index.get(action.upto) ?? events.length - 1) : events.length - 1);
  const openingReach = new Map<string, number>();
  const opening = new Map<string, boolean>();
  const reach = new Map<string, number>();
  if (stage.kind === 'timeline') {
    for (const lane of laneIds) {
      const mine = events.map((_, i) => i).filter((i) => lanesOf(i).includes(lane));
      const firstLater = mine.find((i) => later.has((events[i] as { id: string }).id));
      const before = firstLater === undefined ? mine : mine.filter((i) => i < firstLater);
      openingReach.set(lane, firstLater === undefined ? events.length - 1 : before.length ? Math.max(...before) : -1);
      opening.set(lane, true);
    }
    // First pass: a `draw` on a track that nothing has run on yet takes that track over from the opening.
    const got = new Map(openingReach);
    const ran = new Set<string>();
    for (const action of actions) {
      if (action.verb === 'show') {
        for (const id of idsOf(action)) {
          const i = index.get(id);
          if (i === undefined) continue;
          for (const lane of lanesOf(i)) {
            if (i <= (got.get(lane) as number)) continue;
            got.set(lane, i);
            ran.add(lane);
          }
        }
      } else if (action.verb === 'draw') {
        for (const lane of drawnLanes(action)) {
          if (opening.get(lane) && !ran.has(lane)) {
            opening.set(lane, false);
            got.set(lane, -1);
          }
          const stop = stopAt(action);
          if (stop > (got.get(lane) as number)) {
            got.set(lane, stop);
            ran.add(lane);
          }
        }
      }
    }
    for (const lane of laneIds) reach.set(lane, opening.get(lane) ? (openingReach.get(lane) as number) : -1);
    events.forEach((event, i) => {
      const mine = lanesOf(i);
      const first = mine[0] as string;
      if (!later.has(event.id) && mine.every((lane) => opening.get(lane)) && i <= (openingReach.get(first) as number)) on.add(event.id);
    });
  }

  /** Edges that went with a hidden node: nothing draws them again. */
  const gone = new Set<string>();
  /** What is on show now. On a curve chart: a curve once its name has arrived, a point once its curve has been drawn past it. */
  const snapshot = (): Set<string> => {
    const out = new Set(on);
    if (!curveChart) return out;
    for (const id of on) {
      const life = curveLife.get(id);
      if (life && !life.named) out.delete(id);
      const at = pointAt.get(id);
      if (!at) continue;
      const rides = curveLife.get(at.curve);
      if (rides && (!on.has(at.curve) || (at.x !== null && rides.to < at.x - 1e-9))) out.delete(id);
    }
    return out;
  };

  const before: Set<string>[] = [];
  for (const beat of scene.beats) {
    before.push(snapshot());
    for (const action of beat.do) {
      switch (action.verb) {
        case 'show':
          for (const id of idsOf(action)) {
            if (!byId.has(id)) continue;
            on.add(id);
            const i = index.get(id);
            if (i !== undefined) for (const lane of lanesOf(i)) reach.set(lane, Math.max(reach.get(lane) as number, i));
          }
          break;
        case 'hide':
          for (const id of idsOf(action)) {
            on.delete(id);
            if (stage.kind === 'flow' && kind(id) === 'node') {
              for (const edge of stage.edges) {
                if (edge.from !== id && edge.to !== id) continue;
                on.delete(edge.id);
                gone.add(edge.id);
              }
            }
          }
          break;
        case 'draw':
          if (stage.kind === 'timeline') {
            const stop = stopAt(action);
            for (const lane of drawnLanes(action)) {
              const from = reach.get(lane) as number;
              events.forEach((event, i) => {
                if (lanesOf(i)[0] === lane && i > from && i <= stop) on.add(event.id);
              });
              reach.set(lane, Math.max(from, stop));
            }
          } else if (curveChart) {
            const stop = action.upto === undefined ? Number.NaN : Number(action.upto.replace(/,/g, ''));
            for (const id of idsOf(action)) {
              const life = curveLife.get(id);
              if (!life) continue;
              life.to = Number.isFinite(stop) ? Math.min(Math.max(stop, curveChart.x.min), curveChart.x.max) : curveChart.x.max;
              if (life.to >= curveChart.x.max) life.named = true;
            }
          } else for (const id of idsOf(action)) if (byId.has(id) && !gone.has(id)) on.add(id);
          break;
        case 'send':
          if (stage.kind === 'sequence' && action.target !== undefined && kind(action.target) === 'message') on.add(action.target);
          if (stage.kind === 'flow' && action.outcome !== 'lost') {
            // The connector is drawn behind the token: the one named, or the one that joins the two nodes.
            const edge = action.along !== undefined ? stage.edges.find((e) => e.id === action.along) : stage.edges.find((e) => e.from === action.from && e.to === action.to);
            if (edge && !gone.has(edge.id)) on.add(edge.id);
          }
          break;
        case 'move':
          if (byId.has(action.target)) on.add(action.target);
          break;
        case 'set':
          for (const id of idsOf(action)) if (kind(id) === 'value') on.add(id);
          break;
        case 'split': {
          const parent = groups.get(action.target);
          const from = parent?.live ? parent : undefined;
          if (from) {
            from.live = false;
            on.delete(action.target);
          }
          const made = action.into.map((group) => group.id).filter((id, j, all) => !groups.has(id) && !byId.has(id) && all.indexOf(id) === j);
          for (const group of action.into) {
            if (groups.has(group.id) || byId.has(group.id)) continue;
            groups.set(group.id, { count: group.count, live: true, made: 'split', ...(from ? { from: action.target, fromCount: from.count, siblings: made } : {}) });
            on.add(group.id);
          }
          if (from) from.kids = made;
          break;
        }
        case 'merge': {
          let count = 0;
          const merged = [...new Set(action.targets)].flatMap((id) => {
            const group = groups.get(id);
            return group?.live ? [{ id, group }] : [];
          });
          for (const { group } of merged) count += group.count;
          const fresh = !groups.has(action.into.id) && !byId.has(action.into.id);
          if (fresh) {
            groups.set(action.into.id, { count, live: true, made: 'merge', sources: merged.map((m) => m.id) });
            on.add(action.into.id);
          }
          for (const { id, group } of merged) {
            group.live = false;
            if (fresh) group.mergedInto = action.into.id;
            on.delete(id);
          }
          break;
        }
        default:
          break;
      }
    }
  }
  return { before, after: snapshot(), groups };
}

// ---------------------------------------------------------------------------------------------
// Tap gates
// ---------------------------------------------------------------------------------------------

/**
 * The kinds of part a learner can tap to answer a gate, by stage (chart marks as in
 * `VERBS_BY_STAGE`). This is the engine's own table (src/player/stage/tappable.ts), not a copy of
 * it: the player makes each part of these kinds a real, focusable control while the gate is open.
 * A stage with an empty row has nothing to tap, and its gates take options.
 */
export const TAPPABLE = ENGINE_TAPPABLE as Readonly<Record<string, readonly PartKind[]>>;

/** The kinds of part a learner can tap on this stage. */
export function tappableKinds(stage: Stage): readonly PartKind[] {
  return TAPPABLE[stageKey(stage)] ?? [];
}

/** "a cell, a bar, a point on a curve, ...": every kind that can be tapped, for a fix. */
const TAPPABLE_SUMMARY = Object.entries(TAPPABLE)
  .filter(([, kinds]) => kinds.length > 0)
  .map(([key, kinds]) => `${key === 'chart.bars' ? 'chart with bars' : key === 'chart.line' ? 'chart with a line' : key === 'chart.curve' ? 'chart with curves' : key}: ${kinds.map((k) => NAME[k] ?? k).join(', ')}`)
  .join('; ');

const fewIds = (ids: readonly string[], max = 12): string => (ids.length === 0 ? 'none' : ids.length <= max ? ids.join(', ') : `${ids.slice(0, max).join(', ')} and ${ids.length - max} more`);

/**
 * A gate answered on the picture (`pick`): every id it names is a part of the stage, of a kind the
 * learner can tap there, and on show when the gate opens, which is before its own beat plays. And
 * something else that can be tapped is on show too: a gate no tap can get wrong asks nothing.
 */
function pickIssues(scene: ClipScene, parts: readonly StagePart[]): Issue[] {
  const out: Issue[] = [];
  const gates = scene.beats.flatMap((beat, i) => (beat.gate !== undefined && 'pick' in beat.gate ? [{ i, pick: beat.gate.pick }] : []));
  if (gates.length === 0) return out;
  const stage = scene.stage;
  const name = stageName(stage);
  const kinds = tappableKinds(stage);
  const options = 'Ask with options instead: replace "pick", "right" and "wrong" with "options": [{ "text", "correct", "feedback" }, ...], exactly one of them correct.';

  if (kinds.length === 0) {
    for (const { i } of gates) {
      const what = stage.kind === 'frame' ? 'A frame is drawn by your code, so nothing on it is a part the learner can tap.' : `Nothing on a ${name} stage can be tapped.`;
      out.push(
        issue('PICK_NOT_TAPPABLE', `beats[${i}].gate.pick`, `Beat ${i + 1} asks the learner to tap a part of the stage. ${what}`, {
          fix: `${options} What can be tapped, by stage: ${TAPPABLE_SUMMARY}.`,
        }),
      );
    }
    return out;
  }

  const byId = new Map<string, StagePart>();
  for (const part of parts) if (!byId.has(part.id)) byId.set(part.id, part);
  const run = runStage(scene, parts);
  const kindOf = (id: string): PartKind | undefined => (run.groups.has(id) ? 'group' : byId.get(id)?.kind);
  /** Every id that can be tapped at some point of the clip. */
  const all = [...parts.filter((part) => kinds.includes(part.kind)).map((part) => part.id), ...(kinds.includes('group') ? [...run.groups.keys()].filter((id) => !byId.has(id)) : [])];
  /** The state after beat k has played. */
  const after = (k: number): ReadonlySet<string> => run.before[k + 1] ?? run.after;

  for (const { i, pick } of gates) {
    const p = `beats[${i}].gate.pick`;
    const shown = run.before[i] as ReadonlySet<string>;
    const now = all.filter((id) => shown.has(id));
    const listed = `On show when this gate opens: ${fewIds(now)}.`;
    let sound = true;
    pick.forEach((id, j) => {
      const kind = kindOf(id);
      if (kind === undefined) {
        sound = false;
        const guess = onlyNearest(id, all);
        out.push(
          issue('PICK_UNKNOWN_PART', `${p}[${j}]`, `The gate of beat ${i + 1} counts a tap on "${id}" as right, but "${id}" is not a part of this ${name} stage.`, {
            fix: `${guess ? `Use "${guess}". ` : ''}"pick" lists the ids of the parts that are right. On a ${name} stage the learner can tap ${kindsText(kinds)}. ${listed}`,
            got: id,
          }),
        );
        return;
      }
      if (!kinds.includes(kind)) {
        sound = false;
        out.push(
          issue('PICK_NOT_TAPPABLE', `${p}[${j}]`, `The gate of beat ${i + 1} counts a tap on "${id}" as right, but "${id}" is ${A[kind]}; on a ${name} stage the learner can tap ${kindsText(kinds)}.`, {
            fix: `Name ${kindsText(kinds)} in "pick". ${listed} If the answer is not one of those, ${options.charAt(0).toLowerCase()}${options.slice(1)}`,
            got: id,
            expected: kindsText(kinds),
          }),
        );
        return;
      }
      // The first beat cannot carry a gate at all (GATE_ON_FIRST_BEAT): where it moves to decides what is on show.
      if (i === 0 || shown.has(id)) return;
      sound = false;
      let arrives = -1;
      for (let k = i; k < scene.beats.length && arrives === -1; k++) if (after(k).has(id)) arrives = k;
      const was = run.before.slice(0, i).some((state) => state.has(id));
      const why =
        arrives === i
          ? 'it arrives in this very beat, which plays only after the learner has answered'
          : arrives > i
            ? `it arrives in beat ${arrives + 1}`
            : was
              ? `an earlier beat took it off stage (a hide${kind === 'group' ? ', a split or a merge' : ''})`
              : kind === 'group'
                ? 'no split or merge has made it yet'
                : 'no action brings it on stage';
      out.push(
        issue('PICK_NOT_ON_STAGE', `${p}[${j}]`, `The gate of beat ${i + 1} counts a tap on "${id}" as right, but "${id}" is not on show when the gate opens: ${why}.`, {
          fix: `A gate opens before its own beat plays, so the learner can tap only what the beats before it have put on stage. ${listed} Bring "${id}" on in an earlier beat${arrives > i && arrives + 2 <= scene.beats.length ? `, move the gate to beat ${arrives + 2} (the first that plays after "${id}" has arrived)` : ''}, or ask about a part that is there.`,
          got: id,
        }),
      );
    });
    if (sound && i > 0 && now.every((id) => pick.includes(id))) {
      out.push(
        issue('PICK_NO_WRONG_PART', p, `The gate of beat ${i + 1} counts ${now.length === 1 ? `the only part that can be tapped ("${now[0]}")` : `every part that can be tapped (${fewIds(now)})`} as right, so no tap can be wrong.`, {
          fix: `List in "pick" only the parts that are right, and have at least one other ${kinds.map((k) => NAME[k]).join(' or ')} on stage when the gate opens. If there is nothing to choose between on the picture, ${options.charAt(0).toLowerCase()}${options.slice(1)}`,
        }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The custom frame
// ---------------------------------------------------------------------------------------------

function frameIssue(found: FrameIssue, path: string): Issue {
  return issue(found.code, path, found.message, { fix: found.fix, ...(found.got !== undefined ? { got: found.got } : {}) });
}

/**
 * The static checks of src/frame/check.ts, reported as issues of this scene: the code and the
 * fields of the stage under "stage.", the caption times under "beats[i].at". The code is never run.
 */
function frameIssues(scene: ClipScene, hosts: ReadonlySet<string>): Issue[] {
  const stage = scene.stage;
  if (stage.kind !== 'frame') return [];
  // The code is stored exactly as it was sent, so the frame check is also what keeps out the
  // characters that are removed from every other string of a lesson (FRAME_HIDDEN_CHARACTERS).
  const out = checkFrame(stage).issues.map((found) => frameIssue(found, `stage.${found.path}`));

  // What the code can put in front of a learner as text is held to the rules for a line of code
  // in a lesson: no address outside the evidence, no command that would harm someone who typed it,
  // no long encoded blob. One report for each kind of problem, at its first line.
  const lines = stage.code.split('\n');
  const reported = new Set<string>();
  const safety = (found: Issue, line: number): void => {
    if (reported.has(found.code)) return;
    reported.add(found.code);
    out.push({ ...found, path: 'stage.code', message: `Line ${line} of the frame's code: ${found.message}` });
  };
  lines.forEach((text, n) => {
    for (const found of fieldSafetyIssues({ path: 'stage.code', text, markup: false, code: true, what: 'line' }, hosts)) safety(found, n + 1);
  });
  for (const found of linesSafetyIssues(lines, 'stage.code', "frame's code")) safety(found, Number(/\[([0-9]+)\]$/.exec(found.path)?.[1] ?? 0) + 1);

  out.push(...checkFrameBeats(stage.duration, scene.beats.map((beat) => beat.at)).map((found) => frameIssue(found, found.path)));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Everything about a clip that is not a block rule
// ---------------------------------------------------------------------------------------------

/**
 * The rules of a clip beyond its captions: the stage's ids and references, every action against
 * the stage, the honesty of `provenance`, the fields a beat may carry, the frame checks, and that
 * the clip moves. `hosts` are the evidence hosts that code may name.
 */
export function clipIssues(scene: ClipScene, ctx: Ctx, hosts: ReadonlySet<string>): Issue[] {
  const out: Issue[] = [];
  const stage = scene.stage;
  const frame = stage.kind === 'frame';
  const parts = stageParts(stage);

  out.push(...structureIssues(stage, parts));
  if (stage.kind === 'chart' && stage.max !== undefined) {
    const peak = chartPeak(scene);
    if (peak && peak.value > stage.max) {
      out.push(
        issue('STAGE_INCONSISTENT', 'stage.max', `The top of the value axis ("max") is ${stage.max}, but the chart reaches ${peak.value} (${peak.path}): that ${stage.mark === 'bars' ? 'bar' : 'line'} would be cut off at the top.`, {
          fix: `Raise "max" to at least ${peak.value}, or remove it and let the stage choose the scale from the values.`,
          got: String(stage.max),
          expected: `at least ${peak.value}`,
        }),
      );
    }
  }
  if (stage.kind === 'lines' && stage.format === 'math') {
    stage.lines.forEach((line, i) => {
      const parsed = parseMath(line);
      if (parsed.ok) return;
      out.push(
        issue('MARKUP_MATH', `stage.lines[${i}]`, `Line ${i + 1} of the math stage does not parse (character ${parsed.at + 1}): ${parsed.message}`, {
          fix: 'Write each line as one expression in the supported math subset, without "$" delimiters. Put words inside \\text{...}, or use format "text" for a line that is not math.',
        }),
      );
    });
  }
  if (stage.kind === 'lines') out.push(...linesSafetyIssues(stage.lines, 'stage.lines', 'stage'));

  // ----- honesty: where the stage says its content comes from
  const found = frameIssues(scene, hosts);
  const cites = stage.cites;
  if ((stage.provenance === 'sourced' || stage.provenance === 'worked') && cites.length === 0 && !found.some((i) => i.code === 'FRAME_SOURCED_NO_CITES')) {
    const stored = ctx.storedIds.length ? `Stored ids: ${idList(ctx.storedIds)}.` : 'No evidence is stored yet: call save_evidence first.';
    const sourced = stage.provenance === 'sourced';
    out.push(
      issue('STAGE_NO_CITES', 'stage.cites', sourced ? 'This stage is marked "sourced" but cites no passage.' : 'This stage is marked "worked" (a worked example that applies what a passage says) but cites no passage.', {
        fix: sourced
          ? `Add to "cites" the ids of the passages the stage's parts and numbers come from (up to ${CLIP_LIMITS.citesPerStage}). ${stored} If the stage is a case you worked through yourself, mark it "worked" and cite the passage whose rule it applies; if it rests on no passage, mark it "illustrative".`
          : `Add to "cites" the id of the passage whose rule or definition the example applies (up to ${CLIP_LIMITS.citesPerStage}). ${stored} If it applies nothing a source says, set "provenance" to "illustrative".`,
      }),
    );
  }

  // ----- beats
  scene.beats.forEach((beat, i) => {
    if (frame && beat.do.length > 0) {
      out.push(
        issue('BEAT_FIELD_NOT_ALLOWED', `beats[${i}].do`, `Beat ${i + 1} has ${beat.do.length === 1 ? 'an action' : `${beat.do.length} actions`}, but the stage of this clip is a frame: its animation is its code, and nothing on it can be named by an action.`, {
          fix: 'Remove "do" from the beats of a frame clip (each is a caption and "at", the second it appears). To move typed parts with verbs, call plan_lesson again with a typed stage kind for this clip.',
        }),
      );
    }
    if (!frame && beat.at !== undefined) {
      out.push(
        issue('BEAT_FIELD_NOT_ALLOWED', `beats[${i}].at`, `Beat ${i + 1} has "at", but only a frame clip times its captions; on a ${stageName(stage)} stage the player times each beat from its caption and its actions.`, {
          fix: 'Remove "at". You never write a time on a typed stage.',
        }),
      );
    }
  });
  if (scene.beats[0]?.gate !== undefined) {
    out.push(
      issue('GATE_ON_FIRST_BEAT', 'beats[0].gate', 'The first beat carries a prediction, so the clip would stop before it has shown anything.', {
        fix: 'Move "gate" to the beat whose caption and motion are the outcome, after a beat that sets the scene. The clip stops before that beat until the learner has chosen.',
      }),
    );
  }
  out.push(...pickIssues(scene, parts));

  if (!frame) out.push(...actionIssues(scene, parts));
  out.push(...found);

  // ----- a clip moves
  const n = scene.beats.length;
  const moving = frame ? n : scene.beats.filter((beat) => beat.do.length > 0).length;
  if (moving < n * L.beatsThatMove - 1e-9) {
    const need = Math.ceil(n * L.beatsThatMove - 1e-9);
    const still = scene.beats.flatMap((beat, i) => (beat.do.length === 0 ? [i + 1] : []));
    out.push(
      issue('CLIP_TOO_STATIC', 'beats', `${moving} of the ${n} beats of this clip change the picture; at least ${need} must (beats ${still.join(', ')} have no action).`, {
        fix: `Give ${need - moving} more beat${need - moving === 1 ? '' : 's'} an action that shows what its caption says (${Object.keys(kitVerbs(stage)).join(', ')}), or fold the captions of the still beats into the beats that move. A caption over a picture that does not change is a slide.`,
        got: String(moving),
        expected: `at least ${need}`,
      }),
    );
  }
  return out;
}

/** True when a beat of the clip carries a gate, by options or by a tap: the clip then asks the learner to do something. */
export function hasGate(scene: ClipScene): boolean {
  return scene.beats.some((beat) => beat.gate !== undefined);
}

/** True when the clip contains a learner action: a gate of either kind, or an explore after its last beat. */
export function hasAction(scene: ClipScene): boolean {
  return hasGate(scene) || scene.explore !== undefined;
}

/** The stages an explore sits most naturally on: quantities that respond. What NO_EXPLORE names. */
export function couldExplore(stage: Stage): boolean {
  return stage.kind === 'dots' || (stage.kind === 'chart' && (stage.mark === 'bars' || stage.mark === 'curve'));
}

/** The stage kinds whose picture is data: what MOSTLY_ILLUSTRATIVE counts. */
export const DATA_STAGE_KINDS: readonly string[] = ['chart', 'dots', 'cells', 'sequence', 'flow', 'timeline'];
