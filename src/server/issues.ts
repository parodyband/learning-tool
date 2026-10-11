// What the server itself reports, in the same Issue shape as everything the validator reports, so
// the agent reads one kind of entry.
//
// Four kinds. Errors about this machine and not about the lesson: a lesson that is not stored
// here, a folder that cannot be written. One error about what a tool accepts that the format itself
// still allows: PLAN_LEGACY_KIND, because the validator goes on reading the older scene kinds (a
// lesson published before clips can still be checked and republished) while plan_lesson no longer
// plans them. One error that guards a promise of the tools: FRAME_CODE_ALTERED, for a custom
// frame whose code would have been stored differently from how it was sent. And warnings about the
// call that was just made, where the tool did something other than the agent may have meant: they
// say what was stored and what to do next, and unlike the validator's warnings they are not
// recorded in the published lesson.
//
// The validator's catalog (core/issues) stays the source for everything about the format. Problems
// with a tool's own arguments reuse its shape codes (UNKNOWN_FIELD, MISSING_FIELD, WRONG_TYPE,
// BAD_ID, BAD_VALUE, TOO_MANY, TOO_FEW), built with its `issue()` constructor.
import type { Issue, Severity } from '../core/types';

export interface ServerIssueEntry {
  severity: Severity;
  /** What the code means, in a sentence. */
  title: string;
  /** The general way to resolve it. */
  fix: string;
}

export const SERVER_ISSUES = {
  LESSON_NOT_FOUND: {
    severity: 'error',
    title: 'No lesson with that lessonId is stored on this machine',
    fix: 'Use the lessonId exactly as start_lesson returned it. get_lesson with no arguments lists the lessons that exist; start_lesson begins a new one.',
  },
  DRAFT_UNREADABLE: {
    severity: 'error',
    title: 'The stored draft of this lesson is damaged and cannot be read',
    fix: 'Begin the lesson again with start_lesson, and tell the learner the earlier draft could not be recovered.',
  },
  STORE_FAILED: {
    severity: 'error',
    title: 'The Learning Tool folder on this machine could not be read or written',
    fix: 'Tell the learner that Learning Tool cannot use its folder (set by LEARNING_TOOL_HOME, default ~/LearningTool) and why. Do not build the lesson any other way.',
  },
  STORE_UNSAFE: {
    severity: 'error',
    title: 'A folder or file inside the Learning Tool home is a symbolic link or not what the server created, so nothing was written through it',
    fix: 'Tell the learner which part of the Learning Tool folder has to be an ordinary folder again. Do not build the lesson any other way.',
  },
  INTERNAL_ERROR: {
    severity: 'error',
    title: 'The server failed in a way it did not expect',
    fix: 'Call the tool once more. If it fails again, tell the learner that Learning Tool hit an internal error; do not build the lesson any other way.',
  },
  PLAN_LEGACY_KIND: {
    severity: 'error',
    title: 'From plan_lesson: the outline plans a scene of kind "narration" or "step_through". New lessons are visual: a teaching scene is a clip',
    fix: 'Change the entry to {"id", "kind": "clip", "purpose", "stage"}, with "stage" one of sequence, cells, dots, chart, flow, words, lines, timeline (or frame, your own drawing code, as the rare escape hatch). Decide what the learner will see change, and name the stage that shows it; what you would have written as paragraphs becomes one short caption per beat.',
  },
  FRAME_CODE_ALTERED: {
    severity: 'error',
    title: 'From submit_scene: the code of a custom frame would not have been stored exactly as it was sent, so the scene was not stored. A frame\'s code is kept character for character; it is only ever taken as it is when its stage is marked exactly `"kind": "frame"` and the code is under exactly `"code"`',
    fix: 'Send the stage with the names "kind" and "code" and the value "frame" spelt exactly so, with no space or hidden character in any of them, and submit the scene again. Nothing in the code itself needs to change.',
  },
  EVIDENCE_STORED_AGAIN: {
    severity: 'warning',
    title: 'From save_evidence: a passage that is already stored was sent with a different `via` or `lang`, so it was stored again as a new item with its own id. The earlier item is unchanged',
    fix: 'Cite the new id where the lesson should rest on that version, and submit the scenes that cited the earlier id again. The earlier item stays stored and can be left uncited. Both ids share one count of uses.',
  },
  EVIDENCE_NOT_CHANGED: {
    severity: 'warning',
    title: 'From save_evidence: a passage that is already stored was sent with a different title, publisher or `lang`, and the stored item was kept as it is. Stored evidence is never edited',
    fix: 'Nothing to do if the stored item is right. To state a different `lang` or `via`, send the passage again with that value: it is stored as a new item. A different title or publisher can only be stored with a differently cut excerpt.',
  },
  PREDICT_NEEDED: {
    severity: 'warning',
    title: 'From submit_scene: the clip was accepted without a prediction (no beat has a `gate`, and it has no `explore`), and where it sits in the outline the lesson will then fail PASSIVE_RUN when the last scene is in',
    fix: 'Add a `gate` to the beat of that clip that shows an outcome (or an `explore` after its last beat) and submit it again, or call plan_lesson again with a checkpoint in that stretch of the outline.',
  },
  ACTION_NEEDED: {
    severity: 'warning',
    title: 'From submit_scene: the clip was accepted with nothing for the learner to do (no `gate`, no `explore`), and with the clips already accepted the lesson will then fail INTERACTIVE_SHARE when the last scene is in',
    fix: 'Add a `gate` to the beat of that clip that shows an outcome (options to choose from, or a part of the picture to tap), or an `explore` after its last beat, and submit it again; or do so in another clip that has neither.',
  },
} as const satisfies Record<string, ServerIssueEntry>;

export type ServerIssueCode = keyof typeof SERVER_ISSUES;

export const SERVER_ISSUE_CODES = Object.keys(SERVER_ISSUES) as ServerIssueCode[];

/** Build a server issue. Its severity comes from the catalog, so a code cannot be reported inconsistently. */
export function serverIssue(code: ServerIssueCode, path: string, message: string, detail: { fix?: string; got?: string; expected?: string; sceneId?: string } = {}): Issue {
  const entry: ServerIssueEntry = SERVER_ISSUES[code];
  const out: Issue = { code, severity: entry.severity, path, message, fix: detail.fix ?? entry.fix };
  if (detail.sceneId !== undefined) out.sceneId = detail.sceneId;
  if (detail.got !== undefined) out.got = detail.got;
  if (detail.expected !== undefined) out.expected = detail.expected;
  return out;
}

/** The server's codes as markdown tables, in the layout of the validator's catalog, for the skill's error reference. */
export function serverIssuesMarkdown(): string {
  const cell = (s: string): string => s.replace(/\|/g, '\\|');
  const table = (severity: Severity): string[] => [
    '| Code | Severity | Meaning | Fix |',
    '|---|---|---|---|',
    ...SERVER_ISSUE_CODES.filter((code) => SERVER_ISSUES[code].severity === severity).map((code) => `| \`${code}\` | ${severity} | ${cell(SERVER_ISSUES[code].title)} | ${cell(SERVER_ISSUES[code].fix)} |`),
  ];
  const lines = [
    '## Server',
    '',
    'From any tool. These are about this machine, not about the lesson: nothing you change in a scene fixes them. The two exceptions are `PLAN_LEGACY_KIND`, from plan_lesson, which is about the plan, and `FRAME_CODE_ALTERED`, from submit_scene, which is about how a frame was sent.',
    '',
    ...table('error'),
    '',
    '## Notes from the tools',
    '',
    'Warnings about the call you just made, where the tool did something other than you may have meant. The call succeeded. They are not recorded in the published lesson.',
    '',
    ...table('warning'),
    '',
  ];
  return lines.join('\n');
}
