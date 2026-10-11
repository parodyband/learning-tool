// Shared by the skill tests: where the skill lives, how its marked examples are found, and the
// pieces of the references that are derived from source (the examples, the limits table, the table
// of which stage takes which verb, what can be tapped and bound, and the formula language).
//
// The derived pieces can be rewritten in place with
//   UPDATE_SKILL_DOCS=1 npx vitest run test/skill/format.test.ts
// which is what to run after an example file, a limits file or the verb tables change.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { BINDABLE, CLIP_LIMITS as C, Control, CurveChartStage, Explore, Goal, PickGate, VERBS_BY_STAGE, type ClipScene } from '../../src/core/clip';
import { EXTRA_KIT_VERBS, KITS_EXTRA_LIMITS as K } from '../../src/core/clip-kits-extra';
import { EXPR_CONSTANTS, EXPR_FUNCTIONS, EXPR_HELP, EXPR_LIMITS, evalExpr, isCondition, parseExpr, type Expr } from '../../src/core/expr';
import { CORE_KIT_VERBS, TAPPABLE } from '../../src/core/validate/stage';
import { FRAME_LIMITS as F } from '../../src/core/frame';
import { DEPTHS, LIMITS as L } from '../../src/core/limits';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PLUGIN_DIR = path.join(ROOT, 'plugin');
export const SKILL_DIR = path.join(PLUGIN_DIR, 'skills/learning-tool');
export const REF_DIR = path.join(SKILL_DIR, 'references');
export const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
export const FORMAT_MD = path.join(REF_DIR, 'format.md');
export const CLIP_DESIGN_MD = path.join(REF_DIR, 'clip-design.md');
export const MOTION_MD = path.join(REF_DIR, 'motion.md');

export const read = (file: string): string => readFileSync(file, 'utf8');

/**
 * Interactive-learning and course products and their makers. The skill and the README describe what
 * a lesson does in their own words and name none of them: a lesson is not "like" another product.
 */
export const OTHER_PRODUCTS =
  /\b(Brilliant|Khan Academy|Duolingo|Desmos|GeoGebra|Mathigon|PhET|Coursera|Udemy|Udacity|edX|Codecademy|Kahoot|Quizlet|Anki|Wolfram|3Blue1Brown|Explorable Explanations|Seeing Theory|Setosa|Nicky Case|Bret Victor|Numberphile|MasterClass|Skillshare|Sololearn|Babbel|Photomath|Chegg)\b/;
export const rel = (file: string): string => path.relative(ROOT, file);

/** SKILL.md and every reference, as absolute paths. */
export function skillFiles(): string[] {
  const refs = readdirSync(REF_DIR)
    .filter((n) => n.endsWith('.md'))
    .sort()
    .map((n) => path.join(REF_DIR, n));
  return [SKILL_MD, ...refs];
}

// ---------------------------------------------------------------------------------------------
// Marked examples
// ---------------------------------------------------------------------------------------------

export interface MarkedExample {
  file: string;
  /** What follows "example:" in the marker: scene, stage, question, ... */
  kind: string;
  /**
   * The optional second word of the marker: which object in the example files this block stands
   * for (`<!-- example: scene c3 -->`, `<!-- example: stage k-sequence -->`). A block with a
   * reference must equal that object; a block without one is written by hand and must parse.
   */
  ref: string | undefined;
  /** True for `<!-- counter-example: ... -->`: deliberately poor content that must still be well-formed. */
  counter: boolean;
  line: number;
  /** Offsets of the JSON text inside the fence, for rewriting. */
  start: number;
  end: number;
  json: string;
}

const MARKER = /<!--\s*(counter-)?example:\s*([a-z_]+)(?:\s+([A-Za-z0-9_.-]+))?\s*-->/g;
const FENCE = /^[ \t]*\n?```json\n([\s\S]*?)\n```/;

/** Every `<!-- example: kind [ref] -->` marker with the fenced json block that must follow it directly. */
export function markedExamples(file: string, text = read(file)): MarkedExample[] {
  const out: MarkedExample[] = [];
  for (const m of text.matchAll(MARKER)) {
    const after = m.index + m[0].length;
    const line = text.slice(0, m.index).split('\n').length;
    const fence = FENCE.exec(text.slice(after));
    if (!fence) throw new Error(`${rel(file)}:${line}: the marker "${m[0]}" is not followed directly by a \`\`\`json block`);
    const start = after + fence[0].indexOf('```json\n') + '```json\n'.length;
    out.push({ file, kind: m[2]!, ref: m[3], counter: Boolean(m[1]), line, start, end: start + fence[1]!.length, json: fence[1]! });
  }
  return out;
}

/** Actions written inline, in a table cell or a sentence: every code span that is an object with a "verb". */
export function inlineActions(file: string, text = read(file)): { file: string; line: number; json: string }[] {
  const out: { file: string; line: number; json: string }[] = [];
  text.split('\n').forEach((raw, i) => {
    for (const m of raw.matchAll(/`(\{ "verb": [^`]*\})`/g)) out.push({ file, line: i + 1, json: m[1]! });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// JSON layout for the reference: short objects stay on one line, long ones open up.
// ---------------------------------------------------------------------------------------------

function inline(value: unknown): string {
  if (Array.isArray(value)) return value.length ? `[${value.map(inline).join(', ')}]` : '[]';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}

export function formatJson(value: unknown, width = 150, indent = '', lead = 0): string {
  const flat = inline(value);
  if (value === null || typeof value !== 'object' || indent.length + lead + flat.length <= width) return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((v) => inner + formatJson(v, width, inner)).join(',\n')}\n${indent}]`;
  const rows = Object.entries(value).map(([k, v]) => {
    const key = `${JSON.stringify(k)}: `;
    return inner + key + formatJson(v, width, inner, key.length);
  });
  return `{\n${rows.join(',\n')}\n${indent}}`;
}

// ---------------------------------------------------------------------------------------------
// The limits section of format.md, rendered from the limits the code enforces
// ---------------------------------------------------------------------------------------------

// Rendered from src/core/limits.ts, clip-base.ts, clip-kits-extra.ts and frame.ts. The marker is kept short: it is read by every agent.
export const LIMITS_START = '<!-- limits:start (generated; see test/skill/helpers.ts) -->';
export const LIMITS_END = '<!-- limits:end -->';

// ---------------------------------------------------------------------------------------------
// Limits the schema states as literals (a slider's label, how many curves a chart holds). They are
// read off the schema by trying it, so the reference cannot state a number the schema does not hold.
// ---------------------------------------------------------------------------------------------

/** The fewest and the most `count` for which `accepts(count)` holds, trying 0 to `top`. */
function accepted(accepts: (count: number) => boolean, top: number): { min: number; max: number } {
  const ok = Array.from({ length: top + 1 }, (_, i) => i).filter(accepts);
  if (ok.length === 0) throw new Error('A schema the limits table reads accepts nothing.');
  return { min: ok[0]!, max: ok[ok.length - 1]! };
}
/** The lengths of text a string schema accepts. */
const chars = (schema: z.ZodType): { min: number; max: number } => accepted((count) => schema.safeParse('a'.repeat(count)).success, 600);
/** How many of `item` an array schema accepts. */
const items = (schema: z.ZodType, item: unknown): { min: number; max: number } => accepted((count) => schema.safeParse(Array.from({ length: count }, () => item)).success, 24);

/** The limits of the interactive shapes: explore, a curve chart, a tap gate, a formula. */
export function interactiveLimits() {
  const control = { id: 'rate', label: 'Rate', min: 0, max: 1, step: 1, value: 0 };
  return {
    controls: items(Explore.shape.controls, control),
    bindings: items(Explore.shape.bind, { target: 'a', expr: '1' }),
    steps: L.explore.steps,
    controlLabel: chars(Control.shape.label),
    controlUnit: chars(Control.shape.unit),
    prompt: chars(Explore.shape.prompt),
    goalText: chars(Goal.shape.text),
    goalDone: chars(Goal.shape.done),
    formula: EXPR_LIMITS.chars,
    curves: items(CurveChartStage.shape.curves, { id: 'a', label: 'A', expr: 'x' }),
    points: items(CurveChartStage.shape.points, { id: 'a', label: 'A', x: '1' }),
    pick: items(PickGate.shape.pick, 'a'),
    pickPrompt: chars(PickGate.shape.prompt),
    pickReply: chars(PickGate.shape.right),
  };
}

const n = (x: number): string => x.toLocaleString('en-US');
const range = (r: { min: number; max: number }): string => `${n(r.min)} to ${n(r.max)}`;
const most = (x: number, unit = 'characters'): string => `at most ${n(x)}${unit ? ` ${unit}` : ''}`;
const budget = (b: { warn: number; max: number }): string => `warning above ${n(b.warn)} words, error above ${n(b.max)}`;
const pct = (x: number): string => `${Math.round(x * 100)}%`;
/** "two thirds" for 2/3, and a percentage for a share that has no such name. */
const share = (x: number): string => (Math.abs(x - 2 / 3) < 1e-9 ? 'two thirds' : Math.abs(x - 0.5) < 1e-9 ? 'half' : pct(x));

export function renderLimits(): string {
  const I = interactiveLimits();
  const depthRows = (['quick', 'standard', 'deep'] as const).map((name) => {
    const d = DEPTHS[name];
    return `| \`${name}\` | about ${d.minutes} min | ${range(d.scenes)} | ${range(d.objectives)} | at least ${d.evidenceMin} | ${budget(d.words)} | ${d.requireApply ? 'required' : 'optional'} |`;
  });

  const rows: Array<[string, string, string]> = [
    ['Header', 'Topic / lesson title / scene title', `at most ${n(L.topicChars)} / ${n(L.titleChars)} / ${n(L.sceneTitleChars)} characters`],
    ['', 'Objective text / outline `purpose`', `${range(L.objectiveChars)} / ${most(L.purposeChars)}`],
    ['', '`learner.knows` / `learner.goal`', `${most(L.learnerKnowsChars, '')} / ${most(L.learnerGoalChars)}`],
    ['', '`learner.calibration`', `${most(L.calibration.max, 'entries')}; question ${most(L.calibration.questionChars, '')}, answer ${most(L.calibration.answerChars)}`],

    ['Evidence', 'Items stored per lesson / items one excerpt may support', `${most(L.evidencePerLesson, '')} / ${most(L.usesPerEvidence, '')}`],
    ['', 'Excerpt / all excerpts from one URL', `${range(L.excerptChars)} / ${most(L.excerptCharsPerUrl)}`],
    ['', 'URL / its query string', `${most(L.urlChars, '')} / ${most(L.urlQueryChars)}`],
    ['', 'Source title / publisher', `${most(L.evidenceTitleChars, '')} / ${most(L.publisherChars)}`],
    ['', 'Evidence ids in one `cites`', `1 to ${L.citesPerBlock}; on a stage, up to ${C.citesPerStage}`],

    ['Captions', 'Words in one caption', budget(L.captionWords)],
    ['', '`claim` / `example` / `framing`', `at most ${n(L.claimChars)} / ${n(L.exampleChars)} / ${n(L.framingChars)} characters`],
    ['', '`quote`', `${most(L.quoteChars)}, at least ${L.quoteMinWords} words`],
    ['', '`analogy` text / `limits`', `${most(L.analogyChars, '')} / ${range(L.analogyLimitsChars)} characters`],

    ['Clip', 'Beats / actions in one beat', `${range(C.beats)} / ${most(C.actionsPerBeat, '')}`],
    ['', 'Beats with at least one action', `at least ${share(L.beatsThatMove)} of the clip's beats`],
    ['', '`description`', `${range(L.figureDescriptionChars)} characters`],
    ['', 'Read-outs (`stats`)', `${most(C.stats, '')}; label ${most(C.statLabelChars, '')}, value ${most(C.statValueChars, '')}, unit ${most(C.statUnitChars)}`],
    ['', '`set`: `value` text / `label`; ids in one `targets`', `${most(C.setValueChars, '')} / ${most(C.setLabelChars)}; ${most(C.targetsPerAction, '')}`],
    ['', 'Clips with a `frame` stage, in one lesson', most(L.framesPerLesson, '')],

    ['Explore', 'Sliders (`controls`) / bindings', `${range(I.controls)} / ${most(I.bindings.max, '')}`],
    ['', 'One slider', `${most(I.steps, 'steps')} from \`min\` to \`max\`; \`label\` ${most(I.controlLabel.max, '')}, \`unit\` ${most(I.controlUnit.max)}`],
    ['', '`prompt` / goal `text` / goal `done`', `${most(I.prompt.max, '')} / ${most(I.goalText.max, '')} / ${range(I.goalDone)} characters`],
    ['', 'A formula', most(I.formula)],

    ['Stages', '`sequence`', `${range(C.sequence.actors)} actors, ${range(C.sequence.messages)} messages; actor label ${most(C.sequence.actorChars, '')}, message label ${most(C.sequence.messageChars)}`],
    ['', '`cells`', `${range(C.cells.cells)} cells of ${most(C.cells.cellChars)}; ${most(C.cells.pointers, 'pointers')} (label ${most(C.cells.pointerChars)}), ${most(C.cells.brackets, 'brackets')} (label ${most(C.cells.bracketChars, '')})`],
    ['', '`dots`', `${range(C.dots.total)} dots; legend ${most(C.dots.legendChars, '')}, group label ${most(C.dots.groupChars)}; a \`split\` makes ${range(C.dots.into)} groups, a \`merge\` joins ${range(C.dots.merge)}`],
    ['', '`chart`, bars', `${range(C.chart.bars)} bars; label ${most(C.chart.barChars)}`],
    ['', '`chart`, line', `${range(C.chart.xs)} x positions, ${range(C.chart.series)} series; x label ${most(C.chart.xChars, '')}, series label ${most(C.chart.seriesChars)}`],
    ['', '`chart`, curve', `${range(I.curves)} curves, ${most(I.points.max, 'points')}; curve and point label ${most(C.chart.seriesChars)}`],
    ['', '`chart`, all', `\`yLabel\` and an axis label ${most(C.chart.axisChars, '')}, \`unit\` ${most(C.chart.unitChars)}`],
    ['', '`flow`', `${range(C.flow.nodes)} nodes, ${range(C.flow.edges)} edges; node label ${most(C.flow.nodeChars, '')}, edge label ${most(C.flow.edgeChars, '')}, token label ${most(C.flow.tokenChars)}`],
    ['', '`words`', `${range(C.words.lines)} lines of ${most(C.words.lineChars)}`],
    ['', '`lines`', `${range(K.lines.lines)} lines of ${most(K.lines.lineChars)}; ${most(K.lines.pointers.max, 'pointers')}, ${most(K.lines.brackets.max, 'brackets')}, ${most(K.lines.annotations.max, 'annotations')} of ${most(K.lines.annotations.textChars)}, ${most(K.lines.values.max, 'values')}; ${n(K.lines.rowBudget)} rows in all, an annotation taking two`],
    ['', '`timeline`', `${range(K.timeline.events)} events; \`when\` ${most(K.timeline.whenChars, '')}, label ${most(K.timeline.labelChars, '')}, detail ${most(K.timeline.detailChars)}; ${range(K.timeline.lanes)} lanes, ${most(K.timeline.spans.max, 'spans')}, ${most(K.timeline.markers.max, 'markers')}`],
    ['', '`frame`', `code ${most(F.codeBytes, 'bytes')}, no line over ${n(F.lineChars)} characters; \`duration\` ${range(F.duration)} seconds; ${most(F.params, 'sliders')}`],

    ['Questions', 'Prompt, of a checkpoint or a gate', most(L.promptChars)],
    ['', 'Options in a `single` / in a gate', `${range(L.options)} / ${range(L.predictOptions)}`],
    ['', 'Tap gate: ids in `pick` / `right` and `wrong`', `${range(I.pick)} / ${range(I.pickReply)} characters`],
    ['', 'Option text / `feedback` / `misconception`', `${most(L.optionChars, '')} / ${range(L.feedbackChars)} / ${range(L.misconceptionChars)} characters`],
    ['', '`explanation` / `hint`', `${most(L.explanationChars, '')} / ${most(L.hintChars)}`],
    ['', '`order` items', `${range(L.orderItems)} items of ${most(L.orderItemChars)}`],
    ['', '`numeric` unit / `reflect` model answer', `${most(L.unitChars, '')} / ${most(L.modelAnswerChars)}`],
    ['', '`reflect` `lookFor`', `${range(L.lookFor)} points of ${most(L.lookFor.chars)}`],
    ['', 'Correct option longer than every distractor', `warning at ${L.correctLengthRatio.warn} times the longest; error at ${L.correctLengthRatio.error} times when also ${L.correctLengthRatio.minCharDiff} characters longer`],

    ['Recap', 'Takeaway', most(L.takeawayChars)],
    ['', '`next` topics', `${range(L.nextTopics)}; topic ${most(L.nextTopics.topicChars, '')}, why ${most(L.nextTopics.whyChars)}`],
    ['', '`practice`', `task ${most(L.practice.taskChars)}; ${range(L.practice.lookFor)} \`lookFor\` points of ${most(L.practice.lookFor.chars)}`],

    ['Structure', 'Scenes in a row with no checkpoint and no gate', most(L.passiveRun, '')],
    ['', 'Clips with a gate or an explore', `at least ${share(L.interactiveShare)} of the lesson's clips`],
    ['', 'Framing plus analogy, as a share of the lesson\'s words', `at most ${pct(L.uncitedShare.share)}, or ${n(L.uncitedShare.floorWords)} words if that is more`],
    ['', 'Worked examples, as a share of the lesson\'s words', `at most ${pct(L.exampleShare.share)}, or ${n(L.exampleShare.floorWords)} words if that is more`],
    ['', 'Claims with a weak match to their excerpts', `error above ${pct(L.weakClaimShare)} of claims, once there are 3`],
    ['', 'Claim that must become a quote', `shares ${pct(L.copyContainment)} of its words with the excerpt, in both directions`],
    ['', 'Illustrative stages among the clips that show data', `warning above ${share(L.illustrativeShare)}`],

    ['Whole lesson', 'Size of the lesson data', most(L.lessonJsonBytes, 'bytes')],
  ];

  return [
    '| Depth | Target time | Scenes | Objectives | Excerpts cited | Caption and takeaway words | An `apply` checkpoint |',
    '|---|---|---|---|---|---|---|',
    ...depthRows,
    '',
    '| Area | What | Limit |',
    '|---|---|---|',
    ...rows.map(([area, what, limit]) => `| ${area ? `**${area}**` : ''} | ${what} | ${limit} |`),
  ].join('\n');
}

export const limitsRegion = (text: string): { start: number; end: number; body: string } => region(text, LIMITS_START, LIMITS_END);

// ---------------------------------------------------------------------------------------------
// Which stage takes which verb, rendered from the tables the engine and the validator share
// ---------------------------------------------------------------------------------------------

// Rendered into motion.md from the tables the validator checks actions against (src/core/validate/stage.ts, src/core/clip-kits-extra.ts).
export const VERBS_START = '<!-- verbs:start (generated; see test/skill/helpers.ts) -->';
export const VERBS_END = '<!-- verbs:end -->';

export const STAGE_LABELS: Record<string, string> = { 'chart.bars': '`chart`, bars', 'chart.line': '`chart`, line', 'chart.curve': '`chart`, curve' };

/**
 * One row per stage kind, in the order of `VERBS_BY_STAGE`: its verbs, each with the kinds of part
 * it acts on, taken from the tables the validator checks an action against (`CORE_KIT_VERBS` for
 * the six core stages, `EXTRA_KIT_VERBS` for `lines` and `timeline`). Verbs that act on the same
 * parts are written together. Read-outs are left out of the rows: they take the same verbs on
 * every stage, which the sentence under the table says once.
 */
export function renderVerbs(): string {
  const tables: Record<string, Record<string, readonly string[]>> = { ...CORE_KIT_VERBS, ...EXTRA_KIT_VERBS };
  const rows = Object.keys(VERBS_BY_STAGE).map((kind) => {
    const label = STAGE_LABELS[kind] ?? `\`${kind}\``;
    const table = tables[kind];
    if (!table || Object.keys(table).length === 0) return `| ${label} | none: its beats carry \`at\` and no actions |`;
    const groups = new Map<string, string[]>();
    for (const [verb, kinds] of Object.entries(table)) {
      const parts = kinds.filter((k) => k !== 'stat').join(', ');
      if (parts !== '') groups.set(parts, [...(groups.get(parts) ?? []), verb]);
    }
    const cells = [...groups].map(([parts, verbs]) => `${verbs.map((v) => `\`${v}\``).join(' ')}: ${parts}`);
    return `| ${label} | ${cells.join('; ')} |`;
  });
  return ['| Stage | Verbs, and the parts each acts on |', '|---|---|', ...rows].join('\n');
}

/** The verbs a read-out takes, on every stage that has read-outs: what every core table lists for `stat`. */
export function readoutVerbs(): string[] {
  const perStage = Object.values(CORE_KIT_VERBS as Record<string, Record<string, readonly string[]>>)
    .map((table) => Object.entries(table).filter(([, kinds]) => kinds.includes('stat')).map(([verb]) => verb).sort())
    .filter((verbs) => verbs.length > 0);
  const first = perStage[0] ?? [];
  if (perStage.some((verbs) => verbs.join() !== first.join())) throw new Error('Read-outs no longer take the same verbs on every stage: say so in format.md.');
  return first;
}

// ---------------------------------------------------------------------------------------------
// What a tap gate may name and what a binding may drive, by stage: the validator's `TAPPABLE` and
// the format's `BINDABLE`
// ---------------------------------------------------------------------------------------------

export const INTERACTIVE_START = '<!-- interactive:start (generated; see test/skill/helpers.ts) -->';
export const INTERACTIVE_END = '<!-- interactive:end -->';

/** A kind of part as the reference calls it. */
const PART_NAMES: Record<string, string> = { stat: 'read-out', value: 'value beside a line', point: 'point on a curve', group: 'group of dots' };
const partList = (kinds: readonly string[]): string => (kinds.length ? kinds.map((kind) => PART_NAMES[kind] ?? kind).join(', ') : 'nothing');

/** One row per stage kind, in the order of `VERBS_BY_STAGE`. */
export function renderInteractive(): string {
  const rows = Object.keys(VERBS_BY_STAGE).map((kind) => `| ${STAGE_LABELS[kind] ?? `\`${kind}\``} | ${partList(TAPPABLE[kind] ?? [])} | ${partList(BINDABLE[kind] ?? [])} |`);
  return ['| Stage | A tap gate may name | A binding may drive |', '|---|---|---|', ...rows].join('\n');
}

// ---------------------------------------------------------------------------------------------
// The formula language, rendered from src/core/expr.ts
// ---------------------------------------------------------------------------------------------

export const FORMULAS_START = '<!-- formulas:start (generated from src/core/expr.ts; see test/skill/helpers.ts) -->';
export const FORMULAS_END = '<!-- formulas:end -->';
export const FORMULA_HELP_START = '<!-- formula-help:start (generated from EXPR_HELP in src/core/expr.ts; see test/skill/helpers.ts) -->';
export const FORMULA_HELP_END = '<!-- formula-help:end -->';

/** What the values of a function with several are, where the name alone does not say. A function without an entry is listed by its name. */
const FUNCTION_VALUES: Record<string, string> = { clamp: 'clamp(value, low, high)', if: 'if(condition, then, otherwise)' };

/** Every function of the language, grouped by how many values it takes, then the constants and the length limit. */
export function renderFormulas(): string {
  const groups = new Map<string, string[]>();
  for (const [name, fn] of Object.entries(EXPR_FUNCTIONS)) {
    const takes = fn.min === fn.max ? (fn.min === 1 ? 'One value' : `${n(fn.min)} values`) : `${n(fn.min)} to ${n(fn.max)} values`;
    groups.set(takes, [...(groups.get(takes) ?? []), `\`${FUNCTION_VALUES[name] ?? name}\``]);
  }
  return [
    '- Numbers, the control ids, `+` `-` `*` `/` `^`, brackets, `<` `<=` `>` `>=` `==` `!=`, and the words `and` `or` `not`',
    ...[...groups].map(([takes, names]) => `- ${takes}: ${names.join(' ')}`),
    `- Constants: ${Object.keys(EXPR_CONSTANTS).map((name) => `\`${name}\``).join(' ')}`,
    `- Length: ${most(EXPR_LIMITS.chars)}`,
  ].join('\n');
}

/** The one paragraph the formula module writes about itself, as a block quote. */
export const renderFormulaHelp = (): string => `> ${EXPR_HELP}`;

// ---------------------------------------------------------------------------------------------
// A clip's formulas, tried over everything its sliders can reach
// ---------------------------------------------------------------------------------------------

export interface FormulaTrial {
  /** Where the formula is written: "explore.bind[0].expr". */
  path: string;
  src: string;
  /** Why it does not parse, or the name it uses that it may not. Undefined when it is sound. */
  problem?: string;
  /** Its value at every setting tried (for a curve, at every x of every setting). */
  values: number[];
}

/** Every position of every slider: the grid of all settings, the first control slowest. */
export function settingsOf(clip: Pick<ClipScene, 'explore'>): Record<string, number>[] {
  let out: Record<string, number>[] = [{}];
  for (const control of clip.explore?.controls ?? []) {
    const steps = Math.round((control.max - control.min) / control.step);
    out = out.flatMap((env) => Array.from({ length: steps + 1 }, (_, i) => ({ ...env, [control.id]: Number((control.min + i * control.step).toFixed(9)) })));
  }
  return out;
}

/** The settings with every slider at one of its ends. */
export function cornersOf(clip: Pick<ClipScene, 'explore'>): Record<string, number>[] {
  let out: Record<string, number>[] = [{}];
  for (const control of clip.explore?.controls ?? []) out = out.flatMap((env) => [control.min, control.max].map((v) => ({ ...env, [control.id]: v })));
  return out;
}

export const startOf = (clip: Pick<ClipScene, 'explore'>): Record<string, number> => Object.fromEntries((clip.explore?.controls ?? []).map((c) => [c.id, c.value]));

/**
 * Every formula of a clip (bindings, the goal, and on a curve chart the curves and points), parsed
 * with the real parser, held to the names it may use, and evaluated at every setting of the
 * sliders; a curve at 41 evenly spaced x as well.
 */
export function formulaTrials(clip: ClipScene): FormulaTrial[] {
  const controls = (clip.explore?.controls ?? []).map((c) => c.id);
  const settings = settingsOf(clip);
  const stage = clip.stage;
  const curve = stage.kind === 'chart' && stage.mark === 'curve' ? stage : null;
  const xs = curve ? Array.from({ length: 41 }, (_, i) => curve.x.min + ((curve.x.max - curve.x.min) * i) / 40) : [];
  const list: { path: string; src: string; x: boolean }[] = [
    ...(curve?.curves ?? []).map((c, i) => ({ path: `stage.curves[${i}].expr`, src: c.expr, x: true })),
    ...(curve?.points ?? []).map((p, i) => ({ path: `stage.points[${i}].x`, src: p.x, x: false })),
    ...(clip.explore?.bind ?? []).map((b, i) => ({ path: `explore.bind[${i}].expr`, src: b.expr, x: false })),
    ...(clip.explore?.goal ? [{ path: 'explore.goal.when', src: clip.explore.goal.when, x: false }] : []),
  ];
  return list.map(({ path: at, src, x }) => {
    const parsed = parseExpr(src);
    if (!parsed.ok) return { path: at, src, problem: parsed.message, values: [] };
    const stray = parsed.vars.filter((name) => !(controls.includes(name) || (x && name === 'x')));
    if (stray.length) return { path: at, src, problem: `uses ${stray.join(', ')}, which ${x ? 'is neither x nor a control' : 'is not a control'}`, values: [] };
    const values = x ? settings.flatMap((env) => xs.map((value) => evalExpr(parsed.expr, { ...env, x: value }))) : settings.map((env) => evalExpr(parsed.expr, env));
    return { path: at, src, values };
  });
}

/** A goal's condition, parsed. Throws when it is not a formula or not a condition. */
export function goalOf(clip: ClipScene): Expr {
  const parsed = parseExpr(clip.explore?.goal?.when ?? '');
  if (!parsed.ok) throw new Error(`The goal of "${clip.id}" does not parse: ${parsed.message}`);
  if (!isCondition(parsed.expr)) throw new Error(`The goal of "${clip.id}" is a quantity, not a condition.`);
  return parsed.expr;
}

// ---------------------------------------------------------------------------------------------
// The supported-math list of format.md, rendered from what src/core/math.ts exports
// ---------------------------------------------------------------------------------------------

export const MATH_START = '<!-- math:start (generated from src/core/math.ts; see test/skill/helpers.ts) -->';
export const MATH_END = '<!-- math:end -->';

const MATH_GROUP_LABELS: Record<string, string> = {
  structure: 'Fractions, roots, text and scripts',
  greek: 'Greek letters',
  symbols: 'Symbols',
  large: 'Large operators',
  functions: 'Named functions',
  delimiters: 'Sized delimiters',
  spacing: 'Spacing',
  escapes: 'Literal characters',
};

/** A group the math module adds later is listed under its own key, so it cannot go undocumented. */
export function renderMath(groups: Record<string, readonly string[]>, operators: readonly string[]): string {
  const code = (items: readonly string[]): string => items.map((x) => `\`${x}\``).join(' ');
  return [`- Operators and punctuation: ${code(operators)}`, ...Object.entries(groups).map(([key, items]) => `- ${MATH_GROUP_LABELS[key] ?? key}: ${code(items)}`)].join('\n');
}

/** The text between two generated-region markers, without the surrounding blank lines. */
export function region(text: string, startMarker: string, endMarker: string): { start: number; end: number; body: string } {
  const a = text.indexOf(startMarker);
  const b = text.indexOf(endMarker);
  if (a === -1 || b === -1 || b < a) throw new Error(`The reference is missing the markers ${startMarker} ... ${endMarker}`);
  const start = a + startMarker.length;
  return { start, end: b, body: text.slice(start, b).trim() };
}

// ---------------------------------------------------------------------------------------------
// Headings and links
// ---------------------------------------------------------------------------------------------

/** GitHub-style heading anchors, which is how the links between the skill files are written. */
export function headingAnchors(text: string): Set<string> {
  const anchors = new Set<string>();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    if (fenced) continue;
    const m = /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (!m) continue;
    const slug = m[1]!
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s/g, '-');
    anchors.add(slug);
  }
  return anchors;
}

export interface Link {
  file: string;
  line: number;
  text: string;
  target: string;
}

/** Inline markdown links outside code fences and code spans. */
export function links(file: string, text = read(file)): Link[] {
  const out: Link[] = [];
  let fenced = false;
  text.split('\n').forEach((raw, i) => {
    if (raw.startsWith('```')) fenced = !fenced;
    if (fenced) return;
    const line = raw.replace(/`[^`]*`/g, (span) => (span.includes('](') ? ' '.repeat(span.length) : span));
    for (const m of line.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)) out.push({ file, line: i + 1, text: m[1]!, target: m[2]! });
  });
  return out;
}
