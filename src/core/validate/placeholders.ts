// A template returned by plan_lesson is a shape to fill in. Its strings say what belongs in each
// field ("Why the right answer is right, in a sentence or two."), and a scene that still carries
// one has not been written: the sentence would be published, with a citation beside it.
import { AnyScene } from '../clip';
import { issue } from '../issues';
import { FIGURE_TYPES, PLAN_CHART_MARKS, PLAN_STAGE_KINDS, QUESTION_TYPES, type OutlineEntry } from '../schema';
import { templateFor } from '../templates';
import type { Issue } from '../types';
import { sceneFields, type TextField } from './fields';

/**
 * A placeholder that reads as an instruction ("A question that makes the learner use what was
 * taught.") is refused in whatever field it turns up. A short one is only refused where the
 * template put it, see `LEFT_IN_PLACE`.
 */
const MIN_PLACEHOLDER_CHARS = 20;

const TEMPLATE_ENTRIES: Pick<OutlineEntry, 'id' | 'kind' | 'figure' | 'question' | 'objective' | 'stage' | 'mark'>[] = [
  ...PLAN_STAGE_KINDS.map((stage) => ({ id: 't', kind: 'clip' as const, stage })),
  ...PLAN_CHART_MARKS.map((mark) => ({ id: 't', kind: 'clip' as const, stage: 'chart' as const, mark })),
  { id: 't', kind: 'narration' },
  ...FIGURE_TYPES.flatMap((figure) => [
    { id: 't', kind: 'narration' as const, figure },
    { id: 't', kind: 'step_through' as const, figure },
  ]),
  ...QUESTION_TYPES.map((question) => ({ id: 't', kind: 'checkpoint' as const, question, objective: 'o1' })),
  { id: 't', kind: 'recap' },
];

function collect(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (value.length >= MIN_PLACEHOLDER_CHARS && value.includes(' ')) into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collect(item, into);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collect(item, into);
  }
}

/** Every placeholder sentence of every template, read from the templates themselves so the two cannot drift apart. */
export const PLACEHOLDERS: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  for (const entry of TEMPLATE_ENTRIES) collect(templateFor(entry), out);
  return out;
})();

const LENGTHS: ReadonlySet<number> = new Set([...PLACEHOLDERS].map((p) => p.length));

/** "steps[1].state[0].value" as the kind of field it is: "steps[*].state[*].value". */
const kindOf = (path: string): string => path.replace(/\[[0-9]+\]/g, '[*]');

/**
 * Template strings that a real lesson may hold in the very field the template has them in, so
 * finding one there proves nothing: a code figure in Python, an order question that says "Put
 * these in order.", a table whose columns are Option A and Option B.
 */
const REAL_IN_PLACE: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries({
    'figure.language': ['Python'],
    'question.prompt': ['Put these in order.'],
    'question.items[*]': ['Second', 'Third'],
    'figure.events[*].when': ['Later'],
    'figure.columns[*].label': ['Option A', 'Option B'],
    'figure.xs[*].label': ['First', 'Second'],
    'figure.layers[*].label': ['Top layer', 'Bottom layer'],
    'figure.lines[*]': ['second line'],
    'steps[*].state[*].label': ['name'],
    // Clips. A row of cells may hold a, b, c; a pointer may be called "here" or "now"; code is often Python.
    'stage.cells[*].label': ['a', 'b', 'c'],
    'stage.pointers[*].label': ['here', 'now'],
    'stage.markers[*].label': ['now'],
    'stage.values[*].label': ['x'],
    'stage.language': ['Python'],
    'stage.lines[*]': ['second line', 'third line'],
    'stage.events[*].when': ['Later', 'Later still'],
    'stage.xs[*]': ['First', 'Second', 'Third'],
    'explore.controls[*].unit': ['%'],
  }).map(([kind, texts]) => [kind, new Set(texts)]),
);

/**
 * The short placeholders, by the kind of field the template has them in: "Scene title" as a scene
 * title, "Optional step title" as a step title, "unit" as a unit, "optional" as an edge label,
 * "A follow-up topic" as a next topic. They are too short and too ordinary to refuse everywhere
 * (a column may honestly be headed "unit"), but in the template's own field they are the template.
 *
 * Read from the templates through the same enumeration of fields the scene check uses, so ids and
 * choices such as "bar" or "apply" are never compared, and a new template field is covered as soon
 * as it exists.
 */
export const LEFT_IN_PLACE: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const out = new Map<string, Set<string>>();
  for (const entry of TEMPLATE_ENTRIES) {
    const parsed = AnyScene.safeParse(templateFor(entry));
    // Every template parses (a test asserts it); one that did not would simply add nothing here.
    if (!parsed.success) continue;
    for (const field of sceneFields(parsed.data).fields) {
      const kind = kindOf(field.path);
      if (PLACEHOLDERS.has(field.text) || REAL_IN_PLACE.get(kind)?.has(field.text)) continue;
      let texts = out.get(kind);
      if (!texts) out.set(kind, (texts = new Set()));
      texts.add(field.text);
    }
  }
  return out;
})();

/** PLACEHOLDER_TEXT for every field whose whole text is a template placeholder. */
export function placeholderIssues(fields: readonly TextField[]): Issue[] {
  const out: Issue[] = [];
  for (const field of fields) {
    const sentence = LENGTHS.has(field.text.length) && PLACEHOLDERS.has(field.text);
    if (!sentence && !LEFT_IN_PLACE.get(kindOf(field.path))?.has(field.text)) continue;
    // The placeholder is the template's own text, never the agent's or a source's, so it can be named.
    const named = sentence ? '' : ` ("${field.text}")`;
    out.push(
      issue('PLACEHOLDER_TEXT', field.path, `This ${field.what} still holds the placeholder text of the template${named}.`, {
        fix: 'Write the real text for this field. If the field is optional and the scene does not need it, delete the field instead.',
      }),
    );
  }
  return out;
}
