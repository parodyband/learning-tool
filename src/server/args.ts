// Reading a tool's own arguments: the envelope around the lesson data (lessonId, scene, items ...).
// What is inside `scene`, `items` and the plan is the validator's business and is handed to it
// untouched. Problems found here use the validator's shape codes, so an agent meets one vocabulary.
import { issue } from '../core/issues';
import { LESSON_ID_PATTERN } from '../core/schema';
import type { Issue } from '../core/types';
import { nearest, show } from '../core/validate/shape';
import type { ToolName } from './next';

export interface ArgSpec {
  required?: readonly string[];
  optional?: readonly string[];
}

export type Args = Record<string, unknown>;

const isRecord = (v: unknown): v is Args => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keys that show the agent sent the payload's own fields where the wrapper was expected, with how to put it right. */
const MISPLACED: Partial<Record<ToolName, { missing: string; signs: readonly string[]; message: string; fix: string }>> = {
  submit_scene: {
    missing: 'scene',
    signs: ['kind', 'stage', 'beats', 'question', 'takeaways', 'blocks', 'steps'],
    message: "The scene's fields were sent at the top level of the arguments instead of inside \"scene\".",
    fix: 'Send {"lessonId": "...", "scene": {"id": "...", "kind": "...", "title": "...", ...}}: the whole scene object under the key "scene".',
  },
  save_evidence: {
    missing: 'items',
    signs: ['url', 'excerpt', 'item', 'evidence'],
    message: 'The evidence was not sent in "items".',
    fix: 'Send {"lessonId": "...", "items": [{"url": "...", "title": "...", "excerpt": "...", "via": "page"}]}: an array of 1 to 10 items under the key "items", even for one item.',
  },
  plan_lesson: {
    missing: 'outline',
    signs: ['plan'],
    message: 'The plan was sent inside "plan" instead of as arguments.',
    fix: 'Send {"lessonId": "...", "title": "...", "objectives": [...], "outline": [...]}: the three plan fields directly beside lessonId.',
  },
};

/**
 * Check the argument names of a call. Returns the arguments with `null` values removed (a null
 * optional means "not sent") and one issue per unknown or missing name. With `passUnknown`, names
 * outside the spec are left alone, because the validator reports on them itself.
 */
export function readArgs(tool: ToolName, raw: unknown, spec: ArgSpec, options: { passUnknown?: boolean } = {}): { args: Args; errors: Issue[] } {
  if (raw !== undefined && raw !== null && !isRecord(raw)) {
    return {
      args: {},
      errors: [
        issue('WRONG_TYPE', '', `The arguments of ${tool} must be a JSON object.`, {
          fix: `Call ${tool} with an object of named arguments${argumentList(spec)}.`,
          got: jsonType(raw),
          expected: 'object',
        }),
      ],
    };
  }
  const args: Args = {};
  for (const [key, value] of Object.entries(raw ?? {})) if (value !== null && value !== undefined) args[key] = value;

  const required = spec.required ?? [];
  const valid = [...required, ...(spec.optional ?? [])];
  const errors: Issue[] = [];

  const misplaced = MISPLACED[tool];
  if (misplaced && !Object.hasOwn(args, misplaced.missing) && misplaced.signs.some((sign) => Object.hasOwn(args, sign))) {
    return { args, errors: [issue('MISSING_FIELD', misplaced.missing, misplaced.message, { fix: misplaced.fix, expected: misplaced.missing })] };
  }

  if (!options.passUnknown) {
    for (const key of Object.keys(args)) {
      if (valid.includes(key)) continue;
      const guess = closest(key, valid);
      const shown = show(key);
      errors.push(
        issue('UNKNOWN_FIELD', shown, `"${shown}" is not an argument of ${tool}.`, {
          fix: `${guess && !Object.hasOwn(args, guess) ? `Rename it to "${guess}".` : 'Remove it.'} ${tool} takes${argumentList(spec)}.`,
          got: shown,
          ...(guess ? { expected: guess } : {}),
        }),
      );
    }
  }
  for (const key of required) {
    if (Object.hasOwn(args, key)) continue;
    // A misspelt name was already reported with the name it was meant to be.
    if (errors.some((e) => e.code === 'UNKNOWN_FIELD' && e.expected === key)) continue;
    errors.push(issue('MISSING_FIELD', key, `${tool} needs the argument "${key}".`, { fix: `Add "${key}". ${tool} takes${argumentList(spec)}.`, expected: key }));
  }
  return { args, errors };
}

/** The argument a misspelt name most likely stands for. Two swapped letters ("itmes") are the commonest slip and count as close. */
function closest(key: string, valid: readonly string[]): string | null {
  const letters = (s: string): string => [...s.toLowerCase()].sort().join('');
  return nearest(key, valid) ?? valid.find((name) => name.length >= 4 && letters(name) === letters(key)) ?? null;
}

function argumentList(spec: ArgSpec): string {
  const required = spec.required ?? [];
  const optional = spec.optional ?? [];
  const parts: string[] = [];
  if (required.length > 0) parts.push(required.join(', '));
  if (optional.length > 0) parts.push(`optionally ${optional.join(', ')}`);
  return parts.length > 0 ? `: ${parts.join('; ')}` : ' no arguments';
}

/**
 * The lessonId argument, checked before the disk is touched. Anything that is not exactly the form
 * the server mints (12 characters of a-z and 0-9) is refused here, so no other value can ever
 * become part of a file name.
 */
export function readLessonId(value: unknown): { id: string; errors: [] } | { id: null; errors: Issue[] } {
  if (typeof value === 'string' && LESSON_ID_PATTERN.test(value)) return { id: value, errors: [] };
  return {
    id: null,
    errors: [
      issue('BAD_ID', 'lessonId', typeof value === 'string' ? 'The lessonId is not in the form this server issues.' : 'The lessonId must be a string.', {
        fix: 'Use the lessonId exactly as start_lesson returned it: 12 lowercase letters and digits. get_lesson with no arguments lists the lessons on this machine.',
        got: show(value),
        expected: '12 characters of a-z and 0-9',
      }),
    ],
  };
}

/** The JSON type of a value, for messages that say what arrived without repeating it. */
export function jsonType(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

/** An optional true/false argument. A string such as "true" is not accepted: it is reported. */
export function readFlag(args: Args, key: string, errors: Issue[]): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  // The type is reported, never the value: whatever was put here by mistake is not repeated back.
  errors.push(issue('WRONG_TYPE', key, `"${key}" must be true or false.`, { fix: `Send "${key}" as a JSON boolean, or leave it out.`, got: jsonType(value), expected: 'boolean' }));
  return undefined;
}

/** A value that should be an array and may have arrived as a string of JSON, which is parsed once. */
export function readList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text.startsWith('[')) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
