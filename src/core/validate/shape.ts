// From an unknown tool argument to a typed value, or to issues an agent can act on.
//
// Every entry point of the validator comes through `parseShape`, which does four things in order:
//   1. `sanitizeInput`: a clean deep copy, or a typed refusal for input that is not a finite tree.
//   2. Deterministic leniency, exactly three rules and nothing more:
//        - a string that is valid JSON, where an object or array is expected, is parsed once;
//        - `cites: "e1"` becomes `["e1"]`;
//        - `cite: ["e1"]` with one element becomes `"e1"`.
//      (`null` optionals were already dropped by step 1.)
//   3. The strict zod schema.
//   4. Translation of the schema's findings into catalog issues that name the valid keys, the
//      nearest key, the allowed values, the limit and the measured value.
import type { z } from 'zod';
import { issue, type IssueCode } from '../issues';
import { VAR_PATTERN } from '../clip';
import { ID_PATTERN, LESSON_ID_PATTERN } from '../schema';
import { sanitizeInput, SanitizeError, sanitizeText } from '../text';
import type { Issue } from '../types';

type Schema = z.ZodType;

/** The parts of a zod schema definition this module reads. Kept in one place so a zod upgrade has one thing to check. */
interface Def {
  type: string;
  innerType?: Schema;
  element?: Schema;
  options?: Schema[];
  discriminator?: string;
  shape?: Record<string, Schema>;
  values?: unknown[];
  entries?: Record<string, unknown>;
  checks?: { _zod?: { def?: { check?: string; format?: string; pattern?: RegExp; minimum?: number; maximum?: number } } }[];
}

const defOf = (schema: Schema): Def => (schema as unknown as { def: Def }).def;

const WRAPPERS = new Set(['optional', 'default', 'prefault', 'nullable', 'nonoptional', 'readonly', 'catch']);

function unwrap(schema: Schema): Schema {
  let s = schema;
  for (let guard = 0; guard < 8; guard++) {
    const def = defOf(s);
    if (!WRAPPERS.has(def.type) || !def.innerType) break;
    s = def.innerType;
  }
  return s;
}

function isOptional(schema: Schema): boolean {
  const type = defOf(schema).type;
  return type === 'optional' || type === 'default' || type === 'prefault';
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

function literalValues(schema: Schema): unknown[] {
  const def = defOf(unwrap(schema));
  if (def.type === 'literal') return def.values ?? [];
  if (def.type === 'enum') return Object.values(def.entries ?? {});
  return [];
}

/**
 * The schema that applies to `value` once wrappers are removed and, for a discriminated union, the
 * option that `value` selects is chosen. A union whose discriminator does not match stays a union.
 */
function resolve(schema: Schema, value: unknown): Schema {
  const s = unwrap(schema);
  const def = defOf(s);
  if (def.type !== 'union' || !def.options || !isRecord(value)) return s;
  if (!def.discriminator) {
    // A union with no field that tells its options apart (a gate): the keys present decide.
    const branch = unionBranch(def.options, value);
    return branch === null ? s : unwrap(def.options[branch] as Schema);
  }
  const tag = own(value, def.discriminator) ? value[def.discriminator] : undefined;
  for (const option of def.options) {
    if (tagsOf(option, def.discriminator).includes(tag)) {
      // An option may be a union again, told apart by another field (a chart stage, by `mark`).
      const inner = unwrap(option);
      return defOf(inner).type === 'union' ? resolve(inner, value) : inner;
    }
  }
  return s;
}

/** The keys of each option of a union of objects, or null when an option is not an object. */
function optionKeys(options: readonly Schema[]): string[][] | null {
  const out: string[][] = [];
  for (const option of options) {
    const def = defOf(unwrap(option));
    if (def.type !== 'object' || !def.shape) return null;
    out.push(Object.keys(def.shape));
  }
  return out;
}

/**
 * Which option of a union of strict objects `value` was meant as, when no single field says so: a
 * gate is {prompt, options} or {prompt, pick, right, wrong}. The keys that belong to one option
 * only decide: each one present counts for its option, and a key that is nearly one (a misspelling,
 * a known alias) counts a little. The first option wins a tie. Deciding this before the schema's
 * findings are read is what turns "invalid input" into "rename `picks` to `pick`".
 */
function unionBranch(options: readonly Schema[], value: Record<string, unknown>): number | null {
  const shapes = optionKeys(options);
  if (!shapes) return null;
  const keys = Object.keys(value);
  let best = 0;
  let bestScore = -1;
  shapes.forEach((shape, i) => {
    const mine = shape.filter((key) => !shapes.every((other) => other.includes(key)));
    let score = 0;
    for (const key of keys) {
      if (mine.includes(key)) score += 4;
      else if (!shape.includes(key) && !shapes.some((other) => other.includes(key)) && nearest(key, mine) !== null) score += 1;
    }
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** The values of `discriminator` that select this option of a union: one for an object, several for a union nested in it. */
function tagsOf(option: Schema, discriminator: string): unknown[] {
  const def = defOf(unwrap(option));
  if (def.type === 'union' && def.options) return [...new Set(def.options.flatMap((inner) => tagsOf(inner, discriminator)))];
  const field = def.shape?.[discriminator];
  return field ? literalValues(field) : [];
}

function child(schema: Schema, key: string | number, value: unknown): Schema | null {
  const s = resolve(schema, value);
  const def = defOf(s);
  if (def.type === 'object' && typeof key === 'string') return def.shape && own(def.shape, key) ? (def.shape[key] ?? null) : null;
  if (def.type === 'array' && typeof key === 'number') return def.element ?? null;
  return null;
}

/** The value and the schema at `path`, following the input through discriminated unions. */
function locate(root: Schema, rootValue: unknown, path: readonly PropertyKey[]): { schema: Schema | null; value: unknown } {
  let schema: Schema | null = root;
  let value: unknown = rootValue;
  for (const key of path) {
    const k = typeof key === 'symbol' ? String(key) : key;
    if (schema) schema = child(schema, k, value);
    if (Array.isArray(value) && typeof k === 'number') value = value[k];
    else if (isRecord(value) && typeof k === 'string' && own(value, k)) value = value[k];
    else value = undefined;
  }
  return { schema, value };
}

// ---------------------------------------------------------------------------------------------
// Paths and small text helpers
// ---------------------------------------------------------------------------------------------

const TOKEN = /^[A-Za-z0-9_$.:+/-]{1,40}$/;

/**
 * Text taken from the submission, as it may be shown back in an issue. A name, an id or an enum
 * value is one short token and is echoed whole. Anything else (a sentence where an id belongs) is
 * cut to a few characters: an issue is read as instruction, and whatever was pasted into the wrong
 * field, a stretch of a source page included, must not come back through it.
 */
function echo(text: string): string {
  const clean = sanitizeText(text, 'prose');
  if (TOKEN.test(clean)) return clean;
  const head = Array.from(clean.replace(/[^\p{L}\p{N}_-]/gu, '')).slice(0, 12).join('');
  return `${head}…`;
}

/** A key is echoed as one token: an unexpected key is agent text. */
function showKey(key: string): string {
  return echo(key);
}

export function pathString(path: readonly PropertyKey[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else out += (out ? '.' : '') + showKey(String(key));
  }
  return out;
}

export function joinPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  return parent ? `${parent}.${key}` : key;
}

const quoted = (values: readonly unknown[]): string => values.map((v) => JSON.stringify(v)).join(', ');

/** A submitted value as it may be shown back: a token whole, other text cut short (see `echo`), anything else by its type. */
export function show(value: unknown): string {
  if (typeof value === 'string') return echo(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return jsonType(value);
}

function jsonType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number' && !Number.isFinite(v)) return 'non-finite number';
  return typeof v;
}

/** Levenshtein distance, bounded: the inputs are keys and enum values, a few characters each. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[n] as number;
}

const fold = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** What agents commonly write for a key, by folded name, with the keys it most likely stands for, best first. */
const ALIASES = new Map<string, string[]>([
  ['citations', ['cites', 'cite', 'basedOn']],
  ['citation', ['cite', 'cites']],
  ['sources', ['cites', 'cite', 'basedOn']],
  ['references', ['cites', 'cite']],
  ['reference', ['cite', 'cites']],
  ['refs', ['cites', 'cite']],
  ['evidence', ['cites', 'cite', 'basedOn']],
  ['evidenceid', ['cite', 'cites']],
  ['evidenceids', ['cites', 'cite']],
  ['content', ['text', 'blocks']],
  ['body', ['text', 'blocks']],
  ['statement', ['text']],
  ['heading', ['title', 'label', 'rowHeading']],
  ['header', ['title', 'label', 'rowHeading']],
  ['details', ['detail']],
  ['choices', ['options']],
  ['answers', ['options']],
  ['alternatives', ['options']],
  ['iscorrect', ['correct']],
  ['rationale', ['feedback', 'explanation']],
  ['reason', ['feedback', 'explanation', 'why']],
  ['question', ['prompt', 'question']],
  ['stem', ['prompt']],
  ['highlights', ['highlight']],
  ['highlighted', ['highlight']],
  ['objectiveid', ['objective']],
  ['objectives', ['objective', 'takeaways']],
  ['breakdown', ['limits']],
  ['caveat', ['limits']],
  ['code', ['lines']],
  ['summary', ['takeaways', 'description']],
  ['alt', ['description']],
  ['alttext', ['description']],
  // The two discriminators are easy to swap: scenes and outline entries have `kind`, everything else `type`.
  ['type', ['kind']],
  ['kind', ['type']],
  ['scenes', ['outline', 'steps']],
  ['goals', ['objectives']],
  ['name', ['title', 'label']],
  // Clips: what agents write for the fields of a beat and an action.
  ['actions', ['do']],
  ['action', ['verb', 'do']],
  ['steps', ['beats']],
  ['predict', ['gate']],
  ['prediction', ['gate']],
  ['time', ['at']],
  ['seconds', ['at']],
  ['figure', ['stage']],
  ['ids', ['targets', 'pick']],
  ['parts', ['targets', 'pick']],
  ['target', ['pick']],
  ['targets', ['pick']],
  ['cue', ['on']],
  ['together', ['with']],
  ['source', ['cite', 'cites', 'provenance']],
  // Explore, formulas and tap gates.
  ['sliders', ['controls']],
  ['slider', ['controls']],
  ['inputs', ['controls']],
  ['variables', ['controls']],
  ['params', ['controls']],
  ['parameters', ['controls']],
  ['bindings', ['bind']],
  ['binding', ['bind']],
  ['outputs', ['bind']],
  ['formula', ['expr', 'when', 'x']],
  ['expression', ['expr', 'when', 'x']],
  ['equation', ['expr']],
  ['function', ['expr']],
  ['fn', ['expr']],
  ['y', ['expr']],
  ['condition', ['when']],
  ['test', ['when']],
  ['if', ['when']],
  ['default', ['value']],
  ['initial', ['value']],
  ['start', ['value']],
  ['success', ['done']],
  ['reached', ['done']],
  ['feedback', ['done', 'right']],
  ['challenge', ['goal']],
  ['task', ['goal', 'text', 'prompt']],
  ['instruction', ['prompt']],
  ['series', ['curves']],
  ['lines', ['curves']],
  ['markers', ['points']],
  ['dots', ['points']],
  ['xaxis', ['x']],
  ['domain', ['x']],
  ['curve', ['on', 'curves']],
  ['answer', ['pick']],
  ['correct', ['pick', 'right']],
  ['tap', ['pick']],
  ['part', ['target', 'pick']],
  ['incorrect', ['wrong']],
  ['explanation', ['right', 'feedback']],
  ['hint', ['wrong']],
]);

/**
 * The valid name nearest to `got`: the same name in another letter case or separator style, a
 * known alias, a name within a small edit distance, a longer or shorter form of the same word
 * ("begining" for "begin"), or the one id with the same number ("scene4" for "s4"). The first
 * valid name wins a tie, so the answer does not depend on anything but the two lists.
 */
export function nearest(got: string, valid: readonly string[]): string | null {
  // A slip of the pen is short. Anything longer is not a misspelt name, and is not worth comparing.
  if (got.length > 64) return null;
  const g = fold(got);
  if (g === '') return null;
  for (const v of valid) if (fold(v) === g) return v;
  const alias = ALIASES.get(g);
  if (alias) for (const a of alias) if (valid.includes(a)) return a;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const v of valid) {
    const f = fold(v);
    const d = editDistance(g, f);
    // Close enough to be a slip: one edit in a short name, a third of the letters in a long one.
    const limit = Math.max(1, Math.floor(Math.max(g.length, f.length) / 3));
    if (d <= limit && d < bestDistance) {
      best = v;
      bestDistance = d;
    }
  }
  if (best) return best;
  for (const v of valid) {
    const f = fold(v);
    if (f.length >= 3 && g.length >= 3 && (g.startsWith(f) || f.startsWith(g))) return v;
  }
  const number = /[0-9]+$/.exec(g)?.[0];
  if (number) {
    const same = valid.filter((v) => {
      const f = fold(v);
      return f.charAt(0) === g.charAt(0) && /[0-9]+$/.exec(f)?.[0] === number;
    });
    if (same.length === 1) return same[0] as string;
  }
  return null;
}

/**
 * `nearest`, but only when the answer is not a toss-up: among ids as short as "c1" to "c5" every
 * one is a single edit from "c9", and offering the first of them would send an agent the wrong way.
 */
export function onlyNearest(got: string, valid: readonly string[]): string | null {
  const best = nearest(got, valid);
  if (best === null) return null;
  return nearest(got, valid.filter((v) => v !== best)) === null ? best : null;
}

// ---------------------------------------------------------------------------------------------
// Describing what a schema expects
// ---------------------------------------------------------------------------------------------

const LANGUAGE_PATTERN = '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,3}$';
const EVIDENCE_ID_PATTERN = '^e[1-9][0-9]{0,2}$';
const OBJECTIVE_ID_PATTERN = '^o[1-9]$';

type IdKind = 'part' | 'evidence' | 'objective' | 'lesson' | 'language' | 'control' | null;

function patternKind(source: string): IdKind {
  if (source === ID_PATTERN.source) return 'part';
  if (source === EVIDENCE_ID_PATTERN) return 'evidence';
  if (source === OBJECTIVE_ID_PATTERN) return 'objective';
  if (source === LESSON_ID_PATTERN.source) return 'lesson';
  if (source === LANGUAGE_PATTERN) return 'language';
  if (source === VAR_PATTERN.source) return 'control';
  return null;
}

function bounds(def: Def): { min?: number; max?: number; pattern?: string } {
  const out: { min?: number; max?: number; pattern?: string } = {};
  for (const check of def.checks ?? []) {
    const c = check._zod?.def;
    if (!c) continue;
    if (c.check === 'min_length' && c.minimum !== undefined) out.min = c.minimum;
    else if (c.check === 'max_length' && c.maximum !== undefined) out.max = c.maximum;
    else if (c.check === 'string_format' && c.pattern) out.pattern = c.pattern.source;
  }
  return out;
}

function range(b: { min?: number; max?: number }, unit: string): string {
  if (b.min !== undefined && b.max !== undefined) return b.min === b.max ? `${b.min} ${unit}` : `${b.min} to ${b.max} ${unit}`;
  if (b.max !== undefined) return `at most ${b.max} ${unit}`;
  if (b.min !== undefined) return `at least ${b.min} ${unit}`;
  return '';
}

const ID_DESCRIPTIONS: Record<Exclude<IdKind, null>, string> = {
  part: 'an id such as "s1" (a lowercase letter, then a-z, 0-9, "-" or "_")',
  evidence: 'an evidence id such as "e1"',
  objective: 'an objective id such as "o1"',
  lesson: 'the lessonId returned by start_lesson',
  language: 'a language tag such as "en" or "pt-BR"',
  control: 'a control id such as "rate" (a lowercase letter, then letters, digits or "_", at most 16 characters; not a word of the formula language)',
};

/** What a field should hold, in words an agent can turn into JSON. */
function describe(schema: Schema | null, nested = false): string {
  if (!schema) return 'a value';
  const s = unwrap(schema);
  const def = defOf(s);
  switch (def.type) {
    case 'string': {
      const b = bounds(def);
      const kind = b.pattern ? patternKind(b.pattern) : null;
      if (kind) return ID_DESCRIPTIONS[kind];
      const r = range(b, 'characters');
      return r ? `a string of ${r}` : 'a string';
    }
    case 'number':
      return 'a number';
    case 'boolean':
      return 'true or false';
    case 'literal':
      return quoted(def.values ?? []);
    case 'enum':
      return `one of ${quoted(Object.values(def.entries ?? {}))}`;
    case 'array': {
      const r = range(bounds(def), 'items');
      const each = nested || !def.element ? '' : `, each ${describe(def.element, true)}`;
      return `an array${r ? ` of ${r}` : ''}${each}`;
    }
    case 'object': {
      const keys = Object.keys(def.shape ?? {});
      const required = keys.filter((k) => !isOptional((def.shape as Record<string, Schema>)[k] as Schema));
      return nested ? `an object with ${quoted(required)}` : `an object with the fields ${quoted(required)}`;
    }
    case 'union': {
      if (def.discriminator && def.options) {
        const tags = [...new Set(def.options.flatMap((o) => tagsOf(o, def.discriminator as string)))];
        return `an object whose "${def.discriminator}" is one of ${quoted(tags)}`;
      }
      const shapes = def.options ? optionKeys(def.options) : null;
      if (shapes && def.options) {
        const required = def.options.map((option, i) => (shapes[i] as string[]).filter((k) => !isOptional((defOf(unwrap(option)).shape as Record<string, Schema>)[k] as Schema)));
        return `an object with the fields ${required.map((keys) => quoted(keys)).join(', or with ')}`;
      }
      return 'one of the allowed shapes';
    }
    default:
      return 'a value';
  }
}

// ---------------------------------------------------------------------------------------------
// Leniency
// ---------------------------------------------------------------------------------------------

function tryJson(text: string): unknown {
  const t = text.trim();
  const first = t.charCodeAt(0);
  // Only a container can stand in for a container; anything else is left as the string it is.
  if (first !== 0x7b /* { */ && first !== 0x5b /* [ */) return undefined;
  try {
    const parsed: unknown = JSON.parse(t);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function expectsContainer(schema: Schema, value: unknown): 'object' | 'array' | null {
  const type = defOf(resolve(schema, value)).type;
  if (type === 'array') return 'array';
  return type === 'object' || type === 'union' ? 'object' : null;
}

/**
 * Apply the leniency rules to `value` (the sanitised copy, changed in place) with `raw` as the
 * matching part of the original input.
 *
 * The original is kept alongside because sanitising a string collapses runs of spaces: a scene
 * sent as a JSON string would lose the indentation of its code lines if the sanitised string were
 * the one parsed. So the original string is parsed, and the result is sanitised as a value, which
 * treats `lines` in code mode.
 */
function relax(value: unknown, raw: unknown, schema: Schema | null, key: string | null, path: PropertyKey[], issues: Issue[]): unknown {
  if (!schema) return value;
  let v = value;
  let r = raw;

  if (typeof v === 'string') {
    const wants = expectsContainer(schema, v);
    if (wants) {
      const parsed = (typeof r === 'string' ? tryJson(r) : undefined) ?? tryJson(v);
      if (parsed !== undefined) {
        try {
          // JSON escapes such as "\u202e" only become characters now, so the result is sanitised again.
          v = key === 'lines' ? (sanitizeInput({ lines: parsed }) as { lines: unknown }).lines : sanitizeInput(parsed);
          r = parsed;
        } catch (e) {
          if (!(e instanceof SanitizeError)) throw e;
          issues.push(sanitizeIssue(e, pathString(path)));
          return value;
        }
      } else if (key === 'cites' && wants === 'array') {
        v = [v];
        r = [r];
      }
    }
  } else if (key === 'cite' && Array.isArray(v) && v.length === 1 && typeof v[0] === 'string' && defOf(unwrap(schema)).type === 'string') {
    v = v[0];
    r = Array.isArray(r) ? r[0] : r;
  }

  if (Array.isArray(v)) {
    const element = child(schema, 0, v);
    if (element) {
      for (let i = 0; i < v.length; i++) {
        path.push(i);
        v[i] = relax(v[i], Array.isArray(r) ? r[i] : undefined, element, null, path, issues);
        path.pop();
      }
    }
  } else if (isRecord(v)) {
    for (const k of Object.keys(v)) {
      const field = child(schema, k, v);
      // An unknown key gets no leniency: it is reported as it was sent.
      if (!field) continue;
      path.push(k);
      const next = relax(v[k], isRecord(r) && own(r, k) ? r[k] : undefined, field, k, path, issues);
      path.pop();
      if (next !== v[k]) v[k] = next;
    }
  }
  return v;
}

function sanitizeIssue(e: SanitizeError, prefix: string): Issue {
  const path = prefix && e.path ? `${prefix}.${e.path}` : prefix || e.path;
  return issue(e.code, path, e.message);
}

// ---------------------------------------------------------------------------------------------
// Schema findings to issues
// ---------------------------------------------------------------------------------------------

export interface ShapeHints {
  /** What is being checked, for messages about the whole input: "scene", "plan", "evidence item". */
  what: string;
  /** Ids that exist, named in the fix when an id has the wrong form. */
  evidenceIds?: readonly string[];
  objectiveIds?: readonly string[];
}

interface ZodFinding {
  code: string;
  path: PropertyKey[];
  message: string;
  expected?: string;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  keys?: string[];
  values?: unknown[];
  options?: unknown[];
  discriminator?: string;
  note?: string;
  pattern?: string;
  format?: string;
  /** A bound that the value itself may not take: "more than 0". */
  inclusive?: boolean;
  /** A union with no discriminator: what each option found, with paths inside the value. */
  errors?: ZodFinding[][];
}

/** Evidence ids as a short phrase: "e1, e2 and e3", or "e1 to e24" for a long unbroken run. */
export function idList(ids: readonly string[]): string {
  if (ids.length === 0) return 'none';
  if (ids.length > 8) {
    const numbers = ids.map((id) => Number(id.slice(1)));
    const prefix = (ids[0] as string).slice(0, 1);
    const unbroken = ids.every((id) => id.startsWith(prefix)) && numbers.every((n, i) => Number.isInteger(n) && (i === 0 || n === (numbers[i - 1] as number) + 1));
    if (unbroken) return `${ids[0]} to ${ids[ids.length - 1]}`;
  }
  return ids.join(', ');
}

function where(path: string, what: string): string {
  return path ? `"${path}"` : `the ${what}`;
}

/** The arrays of a figure whose items carry the ids a step can highlight, by figure type. */
const PART_LISTS: Readonly<Record<string, readonly string[]>> = {
  flow: ['nodes', 'edges'],
  sequence: ['actors', 'messages'],
  layers: ['layers'],
  timeline: ['events'],
  compare: ['columns', 'rows'],
  chart: ['xs', 'series'],
};

/**
 * The part ids of the figure in a scene that has not parsed, as far as they can be read. A lines
 * figure has one part per line, l1 to lN; every other figure names its parts itself.
 */
function looseParts(scene: unknown): { type: string; ids: string[] } | null {
  const figure = isRecord(scene) ? scene.figure : undefined;
  if (!isRecord(figure) || typeof figure.type !== 'string') return null;
  if (figure.type === 'lines') return Array.isArray(figure.lines) ? { type: 'lines', ids: figure.lines.map((_, i) => `l${i + 1}`) } : null;
  const lists = own(PART_LISTS, figure.type) ? PART_LISTS[figure.type] : undefined;
  if (!lists) return null;
  const ids: string[] = [];
  for (const key of lists) {
    const list = figure[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) if (isRecord(item) && typeof item.id === 'string' && ID_PATTERN.test(item.id) && !ids.includes(item.id)) ids.push(item.id);
  }
  return { type: figure.type, ids };
}

/**
 * A highlight that does not have the form of an id: the number 2, "4", "L2" or "Line 2" for a line
 * of code. The general advice about ids names a scene id and no part of the figure, so this says
 * what a highlight is, lists the parts this figure has and offers the one that was meant.
 */
function highlightHelp(path: readonly PropertyKey[], value: unknown, scene: unknown): { step: number; type: string | null; fix: string } | null {
  if (path.length !== 4 || path[0] !== 'steps' || typeof path[1] !== 'number' || path[2] !== 'highlight' || typeof path[3] !== 'number') return null;
  const parts = looseParts(scene);
  const general = 'A highlight is the id of a part of the figure, as a string: "l1", "l2", ... for the lines of a lines figure (by line number), otherwise the "id" of a node, edge, actor, message, layer, event, column, row, x position or series.';
  if (!parts || parts.ids.length === 0) return { step: path[1], type: parts?.type ?? null, fix: general };
  const sent = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  let guess: string | null = null;
  if (parts.type === 'lines') {
    // 2, "2", "L2", "line2" and "Line 2" all mean l2.
    const digits = /([0-9]+)\s*$/.exec(sent);
    const id = digits ? `l${Number(digits[1])}` : '';
    guess = parts.ids.includes(id) ? id : null;
  } else if (sent !== '') {
    guess = nearest(sent, parts.ids);
  }
  const all = parts.type === 'lines' ? (parts.ids.length === 1 ? 'l1' : `l1 to l${parts.ids.length} (one per line)`) : `${parts.ids.slice(0, 24).join(', ')}${parts.ids.length > 24 ? ', ...' : ''}`;
  // A highlight that has the form of an id but names no part is only found once the scene parses.
  // It is named here as well, so that one correction covers every highlight of the scene.
  const strangers: string[] = [];
  const steps = isRecord(scene) && Array.isArray(scene.steps) ? scene.steps : [];
  steps.forEach((step, i) => {
    const highlight = isRecord(step) && Array.isArray(step.highlight) ? step.highlight : [];
    for (const id of highlight) if (typeof id === 'string' && ID_PATTERN.test(id) && !parts.ids.includes(id) && strangers.length < 6) strangers.push(`"${id}" (step ${i + 1})`);
  });
  const also = strangers.length ? ` Also not a part of this figure: ${strangers.join(', ')}.` : '';
  return { step: path[1], type: parts.type, fix: `${guess ? `Use "${guess}". ` : ''}The part ids of this figure are: ${all}. A highlight is one of these, as a string.${also}` };
}

/** The lists of a stage whose items carry the ids an action can name, whatever the stage kind. */
const STAGE_PART_LISTS = ['actors', 'messages', 'cells', 'pointers', 'brackets', 'bars', 'series', 'nodes', 'edges', 'annotations', 'values', 'lanes', 'events', 'spans', 'markers', 'stats'] as const;

/** The part ids of the stage of a clip that has not parsed, as far as they can be read. */
function looseStageParts(scene: unknown): string[] {
  const stage = isRecord(scene) ? scene.stage : undefined;
  if (!isRecord(stage)) return [];
  const ids: string[] = [];
  const add = (id: unknown): void => {
    if (typeof id === 'string' && ID_PATTERN.test(id) && !ids.includes(id)) ids.push(id);
  };
  // A lines stage names its lines l1, l2, ... by position; a words stage gives each line an id.
  if (Array.isArray(stage.lines)) stage.lines.forEach((line, i) => add(isRecord(line) ? line.id : `l${i + 1}`));
  if (stage.kind === 'timeline') add('track');
  if (isRecord(stage.group)) add(stage.group.id);
  for (const key of STAGE_PART_LISTS) {
    const list = stage[key];
    if (Array.isArray(list)) for (const item of list) if (isRecord(item)) add(item.id);
  }
  return ids;
}

const ACTION_REF_KEYS = new Set(['target', 'to', 'from', 'along', 'a', 'b', 'upto']);
const ACTION_REF_LISTS = new Set(['targets', 'order', 'between', 'to']);

/**
 * Where an action of a clip names a part, and what was sent there does not have the form of an id:
 * the number 3, "L3" or "Line 3" for a line, "Node A" for a node. The general advice about ids
 * names a scene id; this lists the parts the stage has and offers the one that was meant.
 */
function actionRefHelp(path: readonly PropertyKey[], value: unknown, scene: unknown): { field: string; fix: string } | null {
  if (path.length < 5 || path[0] !== 'beats' || path[2] !== 'do' || typeof path[1] !== 'number' || typeof path[3] !== 'number') return null;
  const key = path[4];
  const inList = path.length === 6 && typeof path[5] === 'number' && typeof key === 'string' && ACTION_REF_LISTS.has(key);
  if (!(inList || (path.length === 5 && typeof key === 'string' && ACTION_REF_KEYS.has(key)))) return null;
  const ids = looseStageParts(scene);
  const sent = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  let guess: string | null = null;
  // 3, "3", "L3", "line3" and "Line 3" all mean l3.
  const digits = /([0-9]+)\s*$/.exec(sent);
  if (digits && ids.includes(`l${Number(digits[1])}`)) guess = `l${Number(digits[1])}`;
  else if (sent !== '') guess = nearest(sent, ids);
  const lines = ids.filter((id) => /^l[0-9]+$/.test(id));
  const others = ids.filter((id) => !lines.includes(id));
  const listed = [...(lines.length > 1 ? [`l1 to l${lines.length} (one per line)`] : lines), ...others.slice(0, 24)].join(', ');
  const range = key === 'to' || key === 'between' ? ' A range is [first, last], two ids.' : '';
  const parts = ids.length ? ` The part ids of this stage are: ${listed}${others.length > 24 ? ', ...' : ''}.` : '';
  return { field: String(key), fix: `${guess ? `Use "${guess}". ` : ''}An action names a part of the stage by its id, as a string.${range}${parts}` };
}

/** What to send where a beat's caption is not one block. */
function captionHelp(path: readonly PropertyKey[], value: unknown): string | null {
  if (path.length !== 3 || path[0] !== 'beats' || path[2] !== 'caption') return null;
  if (Array.isArray(value)) return 'A caption is ONE block, not a list: send the block itself, {"type": ..., "text": ...}. If the beat needs two things said, make it two beats.';
  if (typeof value === 'string') {
    return 'A caption is one block, an object: {"type": "claim", "text": "...", "cites": ["e1"]} for a fact from a source, {"type": "quote", "text": "...", "cite": "e1"} for its own words, or {"type": "framing", "text": "..."} for a link or a question of your own (also "example" and "analogy").';
  }
  return null;
}

function translate(f: ZodFinding, root: Schema, input: unknown, hints: ShapeHints): Issue[] {
  const path = pathString(f.path);
  const at = locate(root, input, f.path);
  const here = where(path, hints.what);

  switch (f.code) {
    case 'unrecognized_keys': {
      const def = defOf(at.schema ? resolve(at.schema, at.value) : root);
      const valid = Object.keys(def.shape ?? {});
      const present = isRecord(at.value) ? Object.keys(at.value) : [];
      return (f.keys ?? []).map((key) => {
        const shown = showKey(key);
        const guess = nearest(key, valid);
        // Suggest a rename only into a slot that is free; otherwise the key is simply surplus.
        const rename = guess && !present.includes(guess) ? guess : null;
        const fix = rename
          ? `Rename "${shown}" to "${rename}". Valid fields here: ${valid.join(', ')}.`
          : `Remove "${shown}". Valid fields here: ${valid.join(', ')}.`;
        const out = issue('UNKNOWN_FIELD', joinPath(path, shown), `"${shown}" is not a field of ${here}.`, { fix, got: shown });
        if (rename) out.expected = rename;
        return out;
      });
    }

    case 'invalid_type': {
      const expected = describe(at.schema);
      if (at.value === undefined && f.path.length > 0) {
        const last = f.path[f.path.length - 1];
        const owner = where(pathString(f.path.slice(0, -1)), hints.what);
        const label = typeof last === 'number' ? `Item ${last}` : `The required field "${showKey(String(last))}"`;
        return [issue('MISSING_FIELD', path, `${label} is missing from ${owner}.`, { fix: `Add it: ${expected}.`, expected })];
      }
      if (at.value === undefined) {
        return [issue('WRONG_TYPE', path, `${cap(here)} must be ${expected}, but nothing was sent.`, { fix: `Send ${expected}.`, got: 'nothing', expected })];
      }
      const got = jsonType(at.value);
      const article = /^[aeiou]/.test(got) ? 'an' : 'a';
      const highlight = highlightHelp(f.path, at.value, input);
      if (highlight) {
        const figure = highlight.type ? `the ${highlight.type} figure` : 'the figure';
        return [
          issue('WRONG_TYPE', path, `Step ${highlight.step + 1} highlights ${article} ${got} (${show(at.value)}); a highlight is the id of a part of ${figure}, as a string.`, {
            fix: highlight.fix,
            got,
            expected: 'the id of a part of the figure',
          }),
        ];
      }
      const caption = captionHelp(f.path, at.value);
      if (caption) return [issue('WRONG_TYPE', path, `${cap(here)} must be one block (an object with a "type"), but ${article} ${got} was sent.`, { fix: caption, got, expected: 'one block' })];
      const ref = actionRefHelp(f.path, at.value, input);
      if (ref) {
        // "target": ["a", "b"] is the commonest slip: several parts go in "targets".
        const several = ref.field === 'target' && Array.isArray(at.value);
        return [
          issue('WRONG_TYPE', path, `${cap(here)} must be the id of a part of the stage, as a string, but ${article} ${got} was sent.`, {
            fix: several ? `"target" names one part. For several, rename it to "targets" and keep the list. ${ref.fix}` : ref.fix,
            got,
            expected: 'the id of a part of the stage',
          }),
        ];
      }
      let fix = `Send ${expected}.`;
      if (f.expected === 'number' && typeof at.value === 'string' && at.value.trim() !== '' && Number.isFinite(Number(at.value))) {
        fix = `Send the number ${Number(at.value)} without quotation marks.`;
      } else if (f.expected === 'boolean' && typeof at.value === 'string' && /^(true|false)$/i.test(at.value)) {
        fix = `Send ${at.value.toLowerCase()} without quotation marks.`;
      } else if ((f.expected === 'array' || f.expected === 'object') && typeof at.value === 'string') {
        fix = `Send ${expected}, as JSON and not as a string.`;
      } else if (f.expected === 'string' && Array.isArray(at.value)) {
        fix = `Send one string, not an array: ${expected}.`;
      } else if (f.path.length === 0 && Array.isArray(at.value)) {
        fix = `Send one ${hints.what} per call, as an object and not inside an array.`;
      }
      return [issue('WRONG_TYPE', path, `${cap(here)} must be ${expected}, but ${article} ${got} was sent.`, { fix, got, expected })];
    }

    case 'too_big':
    case 'too_small': {
      const big = f.code === 'too_big';
      const limit = Number(big ? f.maximum : f.minimum);
      if (f.origin === 'string') {
        const length = typeof at.value === 'string' ? at.value.length : 0;
        if (big) {
          return [
            issue('TOO_LONG', path, `${cap(here)} is ${count(length, 'character')}; the limit is ${limit}.`, {
              fix: `Shorten it by at least ${count(length - limit, 'character')}.`,
              got: String(length),
              expected: `at most ${count(limit, 'character')}`,
            }),
          ];
        }
        const message = length === 0 ? `${cap(here)} is empty; it needs at least ${count(limit, 'character')}.` : `${cap(here)} is ${count(length, 'character')}; the minimum is ${limit}.`;
        return [
          issue('TOO_SHORT', path, message, {
            fix: `Write at least ${count(limit, 'character')}.`,
            got: String(length),
            expected: `at least ${count(limit, 'character')}`,
          }),
        ];
      }
      if (f.origin === 'array' || f.origin === 'set') {
        const items = Array.isArray(at.value) ? at.value.length : 0;
        if (big) {
          return [
            issue('TOO_MANY', path, `${cap(here)} has ${count(items, 'item')}; at most ${limit} ${limit === 1 ? 'is' : 'are'} allowed.`, {
              fix: `Remove ${items - limit} of them.`,
              got: String(items),
              expected: `at most ${count(limit, 'item')}`,
            }),
          ];
        }
        return [
          issue('TOO_FEW', path, `${cap(here)} has ${count(items, 'item')}; at least ${limit} ${limit === 1 ? 'is' : 'are'} needed.`, {
            fix: `Add ${limit - items} more.`,
            got: String(items),
            expected: `at least ${count(limit, 'item')}`,
          }),
        ];
      }
      const bound = f.inclusive === false ? (big ? `less than ${limit}` : `more than ${limit}`) : big ? `at most ${limit}` : `at least ${limit}`;
      return [
        issue('BAD_VALUE', path, `${cap(here)} is ${show(at.value)}; it must be ${bound}.`, {
          fix: `Send a number that is ${bound}.`,
          got: show(at.value),
          expected: bound,
        }),
      ];
    }

    case 'invalid_value': {
      const values = f.values ?? [];
      if (at.value === undefined && f.path.length > 0) {
        const last = f.path[f.path.length - 1];
        const owner = where(pathString(f.path.slice(0, -1)), hints.what);
        const expected = `one of ${quoted(values)}`;
        return [issue('MISSING_FIELD', path, `The required field "${showKey(String(last))}" is missing from ${owner}.`, { fix: `Add it: ${expected}.`, expected })];
      }
      const guess = typeof at.value === 'string' ? nearest(at.value, values.filter((v): v is string => typeof v === 'string')) : null;
      const fix = guess ? `Use "${guess}". Allowed values: ${quoted(values)}.` : `Use one of: ${quoted(values)}.`;
      return [
        issue('BAD_VALUE', path, `${cap(here)} is "${show(at.value)}", which is not an allowed value.`, {
          fix,
          got: show(at.value),
          expected: `one of ${quoted(values)}`,
        }),
      ];
    }

    case 'invalid_union': {
      const options = f.options ?? [];
      if (f.discriminator && options.length > 0) {
        const name = f.discriminator;
        const parent = pathString(f.path.slice(0, -1));
        const owner = where(parent, hints.what);
        if (at.value === undefined) {
          // "type" where "kind" belongs, or the reverse: the value is right and only the key is wrong.
          const swapped = name === 'kind' ? 'type' : name === 'type' ? 'kind' : null;
          const holder = locate(root, input, f.path.slice(0, -1)).value;
          if (swapped && isRecord(holder) && own(holder, swapped) && options.includes(holder[swapped])) {
            return [
              issue('UNKNOWN_FIELD', joinPath(parent, swapped), `${cap(owner)} is told apart by "${name}", not "${swapped}".`, {
                fix: `Rename "${swapped}" to "${name}". Valid values for "${name}": ${quoted(options)}.`,
                got: swapped,
                expected: name,
              }),
            ];
          }
          return [
            issue('MISSING_FIELD', path, `${cap(owner)} has no "${name}", so its shape cannot be read.`, {
              fix: `Add "${name}" with one of: ${quoted(options)}.`,
              expected: `one of ${quoted(options)}`,
            }),
          ];
        }
        const guess = typeof at.value === 'string' ? nearest(at.value, options.filter((v): v is string => typeof v === 'string')) : null;
        const fix = guess ? `Use "${guess}". Valid values for "${name}": ${quoted(options)}.` : `Use one of the valid values for "${name}": ${quoted(options)}.`;
        return [
          issue('BAD_VALUE', path, `"${name}" of ${owner} is "${show(at.value)}", which is not a valid ${name}.`, {
            fix,
            got: show(at.value),
            expected: `one of ${quoted(options)}`,
          }),
        ];
      }
      const ref = actionRefHelp(f.path, at.value, input);
      if (ref) {
        return [issue('BAD_VALUE', path, `${cap(here)} must be the id of a part of the stage, as a string${ref.field === 'to' ? ', or [first, last] for a range' : ''}.`, { fix: ref.fix, got: show(at.value) })];
      }
      const forms = at.schema ? defOf(unwrap(at.schema)) : null;
      const shapes = forms?.type === 'union' && forms.options ? optionKeys(forms.options) : null;
      if (shapes && forms?.options && f.errors && isRecord(at.value)) {
        // The keys present say which form was meant; what the schema found for that form is then
        // reported as it would be for any object, with paths inside the whole input.
        const branch = unionBranch(forms.options, at.value) ?? 0;
        const mine = shapes[branch] as string[];
        const inner = f.errors[branch] ?? [];
        const mistyped = new Set(inner.filter((sub) => sub.code === 'invalid_type').map((sub) => pathString(sub.path)));
        const out: Issue[] = [];
        for (const sub of inner) {
          if ((sub.code === 'too_big' || sub.code === 'too_small') && mistyped.has(pathString(sub.path))) continue;
          out.push(...translate({ ...sub, path: [...f.path, ...sub.path] }, root, input, hints));
        }
        // A key of the other form is not a slip of the pen: say that the two forms do not mix.
        for (const found of out) {
          if (found.code !== 'UNKNOWN_FIELD' || found.got === undefined || found.expected !== undefined) continue;
          const other = shapes.findIndex((shape, i) => i !== branch && shape.includes(found.got as string));
          if (other === -1) continue;
          const told = mine.filter((key) => !shapes.every((shape) => shape.includes(key)) && Object.prototype.hasOwnProperty.call(at.value, key));
          found.message = `"${found.got}" belongs to the other form of ${here}: this one has ${told.length ? quoted(told) : 'the other fields'}, so it is read as {${mine.join(', ')}}.`;
          found.fix = `Keep one form: {${mine.join(', ')}} or {${(shapes[other] as string[]).join(', ')}}. Remove "${found.got}", or remove ${told.length ? quoted(told) : 'the fields of this form'} and send the other form whole.`;
        }
        if (out.length > 0) return out;
      }
      if (shapes && at.value !== undefined && !isRecord(at.value)) {
        const got = jsonType(at.value);
        const expected = describe(at.schema);
        return [issue('WRONG_TYPE', path, `${cap(here)} must be ${expected}, but ${/^[aeiou]/.test(got) ? 'an' : 'a'} ${got} was sent.`, { fix: `Send ${expected}${typeof at.value === 'string' ? ', as JSON and not as a string' : ''}.`, got, expected })];
      }
      return [issue('BAD_VALUE', path, `${cap(here)} does not match any allowed shape.`, { fix: `Send ${describe(at.schema)}.` })];
    }

    case 'invalid_format': {
      const source = (f.pattern ?? '').replace(/^\/|\/[a-z]*$/g, '');
      const kind = patternKind(source);
      const got = show(at.value);
      if (kind === 'evidence') {
        const stored = hints.evidenceIds;
        const tail = stored === undefined ? '' : stored.length ? ` Stored ids: ${idList(stored)}.` : ' No evidence is stored yet: call save_evidence first.';
        return [
          issue('BAD_ID', path, `${cap(here)} is not an evidence id.`, {
            fix: `Evidence ids look like "e1". Use an id returned by save_evidence.${tail}`,
            got,
            expected: ID_DESCRIPTIONS.evidence,
          }),
        ];
      }
      if (kind === 'objective') {
        const planned = hints.objectiveIds;
        const tail = planned && planned.length ? ` Planned objectives: ${planned.join(', ')}.` : '';
        return [
          issue('BAD_ID', path, `${cap(here)} is not an objective id.`, {
            fix: `Objective ids are "o1" to "o9".${tail}`,
            got,
            expected: ID_DESCRIPTIONS.objective,
          }),
        ];
      }
      if (kind === 'part') {
        const ref = actionRefHelp(f.path, at.value, input);
        if (ref) {
          return [
            issue('BAD_ID', path, `${cap(here)} is "${got}", which does not have the form of a part id.`, {
              fix: ref.fix,
              got,
              expected: 'the id of a part of the stage',
            }),
          ];
        }
        const highlight = highlightHelp(f.path, at.value, input);
        if (highlight) {
          const figure = highlight.type ? `the ${highlight.type} figure` : 'the figure';
          return [
            issue('BAD_ID', path, `Step ${highlight.step + 1} highlights "${got}", which is not the id of a part of ${figure}.`, {
              fix: highlight.fix,
              got,
              expected: 'the id of a part of the figure',
            }),
          ];
        }
      }
      if (kind === 'part' || kind === 'lesson') {
        return [issue('BAD_ID', path, `${cap(here)} is not a valid id.`, { fix: f.message, got, expected: ID_DESCRIPTIONS[kind] })];
      }
      if (kind === 'control') {
        return [issue('BAD_ID', path, `${cap(here)} is "${got}", which cannot be the id of a control.`, { fix: f.message, got, expected: ID_DESCRIPTIONS.control })];
      }
      return [
        issue('BAD_VALUE', path, `${cap(here)} is not in the expected form.`, {
          fix: f.message,
          got,
          expected: kind ? ID_DESCRIPTIONS[kind] : describe(at.schema),
        }),
      ];
    }

    case 'custom': {
      // The one refinement of the format: a control id that the formula language already uses.
      const kind = at.schema ? patternKind(bounds(defOf(unwrap(at.schema))).pattern ?? '') : null;
      if (kind === 'control') {
        return [issue('BAD_ID', path, `${cap(here)} is "${show(at.value)}", which the formula language already uses.`, { fix: f.message, got: show(at.value), expected: ID_DESCRIPTIONS.control })];
      }
      return [issue('BAD_VALUE', path, `${cap(here)} is not valid.`, { fix: f.message || `Send ${describe(at.schema)}.`, got: show(at.value) })];
    }

    default:
      return [issue('BAD_VALUE', path, `${cap(here)} is not valid.`, { fix: `Send ${describe(at.schema)}.` })];
  }
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * One mistake, one issue: a misspelt key is reported as UNKNOWN_FIELD with a rename, so the
 * MISSING_FIELD for the key it was meant to be would only repeat it.
 */
function dropImpliedMissing(issues: Issue[]): Issue[] {
  const renames = new Set<string>();
  for (const i of issues) {
    if (i.code !== 'UNKNOWN_FIELD' || i.expected === undefined || i.got === undefined) continue;
    const parent = i.path.slice(0, i.path.length - i.got.length).replace(/\.$/, '');
    renames.add(joinPath(parent, i.expected));
  }
  if (renames.size === 0) return issues;
  return issues.filter((i) => !(i.code === 'MISSING_FIELD' && renames.has(i.path)));
}

export interface ShapeResult<T> {
  /** The typed value, when the input has the right shape. */
  value?: T;
  /** The sanitised input after leniency, for best-effort reads (an id, a kind) when parsing failed. */
  clean?: unknown;
  issues: Issue[];
}

/** Sanitise, apply leniency, parse with the strict schema, and translate what the schema found. */
export function parseShape<T extends Schema>(schema: T, input: unknown, hints: ShapeHints): ShapeResult<z.output<T>> {
  let clean: unknown;
  try {
    clean = sanitizeInput(input);
  } catch (e) {
    if (e instanceof SanitizeError) return { issues: [sanitizeIssue(e, '')] };
    throw e;
  }
  const relaxIssues: Issue[] = [];
  clean = relax(clean, input, schema, null, [], relaxIssues);
  if (relaxIssues.length > 0) return { clean, issues: relaxIssues };

  const result = schema.safeParse(clean);
  if (result.success) return { value: result.data, clean, issues: [] };

  const findings = result.error.issues as unknown as ZodFinding[];
  // A value of the wrong type is still measured by the schema ("a string of 38 items"); only the type matters.
  const mistyped = new Set(findings.filter((f) => f.code === 'invalid_type').map((f) => pathString(f.path)));
  const issues: Issue[] = [];
  for (const finding of findings) {
    if ((finding.code === 'too_big' || finding.code === 'too_small') && mistyped.has(pathString(finding.path))) continue;
    issues.push(...translate(finding, schema, clean, hints));
  }
  return { clean, issues: dropImpliedMissing(issues) };
}

/** `IssueCode`s this module can produce, for the catalog test. */
export const SHAPE_CODES: readonly IssueCode[] = [
  'INPUT_TOO_DEEP',
  'INPUT_CYCLE',
  'INPUT_TOO_LARGE',
  'UNKNOWN_FIELD',
  'MISSING_FIELD',
  'WRONG_TYPE',
  'TOO_LONG',
  'TOO_SHORT',
  'TOO_MANY',
  'TOO_FEW',
  'BAD_VALUE',
  'BAD_ID',
];
