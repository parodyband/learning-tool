// Types of ./frame-check.js: the part of src/frame/check.ts the validator uses, declared by hand so
// that the browser's type check of src/core never reads that Node-only file. See frame-check.js.
// test/validate/frame-bridge.test.ts fails when these declarations and src/frame/check.ts differ.
import type { FrameStage } from '../frame';

export type FrameSeverity = 'error' | 'warning';

interface FrameIssueEntry {
  readonly severity: FrameSeverity;
  readonly title: string;
  readonly fix: string;
}

/** Every code the frame checks can report, with its severity, title and general fix. */
export declare const FRAME_ISSUES: {
  readonly FRAME_EMPTY: FrameIssueEntry;
  readonly FRAME_TOO_LARGE: FrameIssueEntry;
  readonly FRAME_LONG_LINE: FrameIssueEntry;
  readonly FRAME_HIDDEN_CHARACTERS: FrameIssueEntry;
  readonly FRAME_SYNTAX: FrameIssueEntry;
  readonly FRAME_NO_RENDER: FrameIssueEntry;
  readonly FRAME_BANNED: FrameIssueEntry;
  readonly FRAME_RANDOM: FrameIssueEntry;
  readonly FRAME_POSTER_RANGE: FrameIssueEntry;
  readonly FRAME_PARAM_DUPLICATE: FrameIssueEntry;
  readonly FRAME_PARAM_RANGE: FrameIssueEntry;
  readonly FRAME_PARAM_UNDECLARED: FrameIssueEntry;
  readonly FRAME_PARAM_UNUSED: FrameIssueEntry;
  readonly FRAME_SOURCED_NO_CITES: FrameIssueEntry;
  readonly FRAME_BEAT_TIME: FrameIssueEntry;
};

export type FrameIssueCode = keyof typeof FRAME_ISSUES;

/** One problem found by the frame checks. `path` is relative to the stage ("code", "params[1].value"), or to the clip for a beat ("beats[2].at"). */
export interface FrameIssue {
  code: FrameIssueCode;
  severity: FrameSeverity;
  path: string;
  message: string;
  fix: string;
  got?: string;
  rule?: string;
  line?: number;
}

/** Every check on a frame stage that has passed the schema. The code is never run. */
export declare function checkFrame(stage: FrameStage): { ok: boolean; issues: FrameIssue[] };

/** The caption times of a frame clip: `ats[i]` is beat i's `at`. */
export declare function checkFrameBeats(duration: number, ats: readonly (number | undefined)[]): FrameIssue[];
