// checkStart: the arguments of start_lesson. The format is the schema's; the one rule beyond it is
// that the topic, which is published under the lesson's title, passes the same address and command
// checks as the title.
import { capIssues } from '../issues';
import { StartInput } from '../schema';
import type { Issue } from '../types';
import { topicIssues } from './plan';
import { parseShape } from './shape';

export interface StartCheck {
  ok: boolean;
  /** The normalised arguments, defaults applied. Absent when not ok. */
  start?: StartInput;
  errors: Issue[];
  warnings: Issue[];
}

/** Check the arguments of start_lesson: their shape, and the text safety of the topic. */
export function checkStart(input: unknown): StartCheck {
  const shape = parseShape(StartInput, input, { what: 'start_lesson arguments' });
  if (!shape.value) return { ok: false, errors: capIssues(shape.issues, 'error'), warnings: [] };
  const errors = topicIssues(shape.value.topic);
  if (errors.length > 0) return { ok: false, errors: capIssues(errors, 'error'), warnings: [] };
  return { ok: true, start: shape.value, errors: [], warnings: [] };
}
