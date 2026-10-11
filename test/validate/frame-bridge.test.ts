// src/core/validate/frame-check.js hands the validator the static checks of src/frame/check.ts
// (which is Node-only), and frame-check.d.ts declares them by hand so that the browser's type
// check of src/core never reads that file. This test holds the declaration to the real thing:
// the same functions at run time, and the same types when this file is type-checked.
import { describe, expect, it } from 'vitest';
import { ISSUE_CODES, ISSUES } from '../../src/core/issues';
import * as bridge from '../../src/core/validate/frame-check';
import type { FrameIssue as DeclaredIssue, FrameIssueCode as DeclaredCode } from '../../src/core/validate/frame-check';
import * as real from '../../src/frame/check';
import type { FrameIssue as RealIssue, FrameIssueCode as RealCode } from '../../src/frame/check';

// Compile-time: each side is assignable to the other. A code added to, or renamed in, src/frame/check.ts fails the type check here.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameCodes: Same<DeclaredCode, RealCode> = true;
const sameIssue: Same<Pick<DeclaredIssue, 'code' | 'severity' | 'path' | 'message' | 'fix' | 'got' | 'line'>, Pick<RealIssue, 'code' | 'severity' | 'path' | 'message' | 'fix' | 'got' | 'line'>> = true;
const checkFrameFits: typeof bridge.checkFrame = real.checkFrame;
const checkBeatsFits: typeof bridge.checkFrameBeats = real.checkFrameBeats;
const issuesFit: typeof bridge.FRAME_ISSUES = real.FRAME_ISSUES;

describe('the bridge to the frame checks', () => {
  it('is the real module, not a copy of it', () => {
    expect(bridge.checkFrame).toBe(real.checkFrame);
    expect(bridge.checkFrameBeats).toBe(real.checkFrameBeats);
    expect(bridge.FRAME_ISSUES).toBe(real.FRAME_ISSUES);
    expect(Object.keys(bridge).sort()).toEqual(['FRAME_ISSUES', 'checkFrame', 'checkFrameBeats']);
    expect([sameCodes, sameIssue, typeof checkFrameFits, typeof checkBeatsFits, typeof issuesFit]).toEqual([true, true, 'function', 'function', 'object']);
  });

  it('every code of the frame checks is in the catalog, with the frame checks\' own words', () => {
    expect(real.FRAME_ISSUE_CODES).toHaveLength(15);
    for (const code of real.FRAME_ISSUE_CODES) {
      expect(ISSUE_CODES).toContain(code);
      expect(ISSUES[code]).toEqual({ severity: real.FRAME_ISSUES[code].severity, group: 'frame', title: real.FRAME_ISSUES[code].title, fix: real.FRAME_ISSUES[code].fix });
    }
    expect(ISSUE_CODES.filter((code) => ISSUES[code].group === 'frame').sort()).toEqual([...real.FRAME_ISSUE_CODES].sort());
  });
});
