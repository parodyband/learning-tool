// The frame around every tool that works on one lesson: read the argument names, check the
// lessonId, load the draft, do the work, record the call, save, and answer with the envelope.
// Tools that change the draft run one at a time per lesson, so parallel calls cannot lose each
// other's writes.
import type { Draft, Issue } from '../../core/types';
import { readArgs, readLessonId, type ArgSpec, type Args } from '../args';
import type { ServerDeps } from '../deps';
import { envelope, type Envelope } from '../envelope';
import type { Outcome, ToolName } from '../next';
import { failure, findDraft, publishedFileMissing, record, refuse } from './common';

export interface Work {
  errors?: Issue[];
  warnings?: Issue[];
  payload?: Record<string, unknown>;
  /** What the call did, for `next`. The tool name is added by the frame. */
  outcome?: Omit<Outcome, 'tool'>;
  /** The lesson itself changed, not only the bookkeeping. */
  changed?: boolean;
  /** Overrides `ok`, which is otherwise "no errors". */
  ok?: boolean;
}

export interface LessonCall {
  tool: ToolName;
  spec: ArgSpec;
  /** Leave argument names outside the spec to the validator, which reports them with the plan's own field names. */
  passUnknown?: boolean;
  /** True for tools that change the draft: the work is serialised per lesson, counted and saved. */
  write: boolean;
  work: (draft: Draft, args: Args) => Promise<Work> | Work;
}

export async function lessonCall(deps: ServerDeps, raw: unknown, call: LessonCall): Promise<Envelope> {
  const { tool } = call;
  const read = readArgs(tool, raw, { required: call.spec.required, optional: call.spec.optional }, { passUnknown: call.passUnknown });
  if (!Object.hasOwn(read.args, 'lessonId')) return refuse(tool, read.errors);
  const id = readLessonId(read.args.lessonId);
  if (id.id === null) {
    const errors = [...id.errors, ...read.errors];
    return envelope({ draft: null, errors, outcome: { tool, rejected: errors, missing: true } });
  }
  const lessonId = id.id;

  const run = async (): Promise<Envelope> => {
    const found = await findDraft(deps, tool, lessonId);
    if (found.refusal) return found.refusal;
    const draft = found.draft;
    const done: Work = read.errors.length > 0 ? { errors: read.errors, outcome: { rejected: read.errors } } : await call.work(draft, read.args);
    if (call.write) {
      record(draft, tool, done.errors);
      await deps.store.save(draft, { touch: done.changed === true });
    }
    const outcome: Outcome = { tool, ...done.outcome };
    if (await publishedFileMissing(deps, draft)) outcome.fileMissing = true;
    return envelope({ draft, errors: done.errors, warnings: done.warnings, ok: done.ok, payload: done.payload, outcome });
  };

  try {
    return await (call.write ? deps.store.serial(lessonId, run) : run());
  } catch (error) {
    return failure(deps, tool, error, lessonId);
  }
}
