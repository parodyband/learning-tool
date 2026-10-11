// The two commands for people, in the same binary as the server:
//
//   learning-tool verify <file.html> [--data-only | --strict] [--json]
//   learning-tool voice-check [--json]
//
// `verify` checks two things, and says which of them it could check.
//
// The data: it reads the embedded lesson, validates it again under this build's rules, recomputes
// the hash and compares both with the receipt the file carries. That answers "is this the lesson
// that was validated, and does it still pass?".
//
// The page: a learner reads the markup, not the embedded data, so the data being right says
// nothing about what is on screen. The page is therefore rendered again from its own data and
// compared, byte for byte. A page that differs fails. That comparison is only possible with the
// build that made the page and for a page without audio; otherwise the result says "page not
// compared", plainly, and never claims more than was shown. `--strict` makes "not compared" a
// failure too; `--data-only` skips the comparison.
//
// Neither check can answer whether the excerpts are genuine, and the hash is not a signature: it
// is stored in the file it describes, so it catches damage and plain edits, not a file rebuilt on
// purpose. Nothing here can do more without a secret.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from '../core/hash';
import { RULES_VERSION } from '../core/limits';
import type { Issue, Receipt } from '../core/types';
import { verifyLesson } from '../core/validate';
import { VERSION } from '../generated/version';
import { readEmbeddedData, renderLesson } from '../render';
import { buildId, stampedVersion } from './build-id';
import { formatVoiceCheck, voiceCheck, voiceConfigFromEnv, type VoiceCheckOptions } from '../tts';
import type { Env } from './paths';

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

const MAX_FILE_BYTES = 128 * 1024 * 1024;

export type PageCheck = 'identical' | 'differs' | 'not-checked';

export interface VerifyResult {
  /** True when nothing that was checked failed. Decides the exit status. */
  ok: boolean;
  /** True when the embedded lesson is the one that was validated and still passes, whatever the page looks like. */
  dataOk: boolean;
  file: string;
  /** Present once the embedded data could be read. `sources` counts the passages (evidence items) the lesson carries, as in `LessonStats`. */
  lesson?: { id: string; title: string; scenes: number; sources: number };
  /** One line per thing that failed, in plain words. Empty when ok. */
  problems: string[];
  /** Validation errors found in the embedded lesson. */
  errors: Issue[];
  warnings: number;
  hash?: { receipt: string | null; computed: string | null; matches: boolean };
  rules?: { receipt: string | null; current: string };
  /** Whether the receipt's counts are the ones validation reports for this lesson now. */
  receiptMatches?: boolean;
  /** Whether the page is byte for byte what this build renders from its own data. "not-checked" always says why. */
  page?: { result: PageCheck; why?: string };
}

export interface VerifyOptions {
  /** Also fail when the page could not be compared: a pass then means the page was proven identical. */
  strict?: boolean;
  /** Check the embedded data only and leave the page alone. */
  dataOnly?: boolean;
}

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Text that may come from the file, made safe to print: a file can hold terminal escape codes. */
const plain = (value: string): string => value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');
/** The same, and not at length: for a single value taken from the file. */
const shown = (value: string): string => {
  const clean = plain(value);
  return clean.length > 120 ? `${clean.slice(0, 120)}…` : clean;
};

function same(a: unknown, b: unknown): boolean {
  try {
    return canonicalJson(a) === canonicalJson(b);
  } catch {
    return false;
  }
}

function countByCode(warnings: readonly Issue[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of warnings) if (w.code !== 'MORE_ISSUES') out[w.code] = (out[w.code] ?? 0) + 1;
  return out;
}

/** Check one published file: its embedded data, and whether the visible page is what that data renders to. */
export async function verifyFile(file: string, options: VerifyOptions = {}): Promise<VerifyResult> {
  const result: VerifyResult = { ok: false, dataOk: false, file, problems: [], errors: [], warnings: 0 };
  let html: string;
  try {
    const info = await stat(file);
    if (!info.isFile()) {
      result.problems.push('That path is not a file.');
      return result;
    }
    if (info.size > MAX_FILE_BYTES) {
      result.problems.push('The file is too large to be a Learning Tool lesson.');
      return result;
    }
    html = await readFile(file, 'utf8');
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    result.problems.push(code === 'ENOENT' ? 'There is no file at that path.' : `The file could not be read${typeof code === 'string' ? ` (${code})` : ''}.`);
    return result;
  }

  const data = readEmbeddedData(html);
  if (!data) {
    result.problems.push('No Learning Tool lesson data was found in this file. It was not written by publish_lesson, or its data was removed.');
    return result;
  }
  const receipt = data.receipt as Partial<Receipt>;
  const report = verifyLesson(data.lesson);
  result.errors = report.errors;
  result.warnings = report.warnings.filter((w) => w.code !== 'MORE_ISSUES').length;
  const lesson = data.lesson as { id?: unknown; title?: unknown; scenes?: unknown; evidence?: unknown };
  result.lesson = {
    id: text(lesson.id) ?? '',
    title: text(lesson.title) ?? '',
    scenes: Array.isArray(lesson.scenes) ? lesson.scenes.length : 0,
    sources: Array.isArray(lesson.evidence) ? lesson.evidence.length : 0,
  };
  result.rules = { receipt: text(receipt.rules), current: RULES_VERSION };
  const sameRules = result.rules.receipt === RULES_VERSION;

  if (!report.ok) {
    result.problems.push(
      sameRules
        ? `The embedded lesson does not pass validation (${report.errors.length} error${report.errors.length === 1 ? '' : 's'}).`
        : `The embedded lesson does not pass this build's rules (version ${RULES_VERSION}). It was published under rules version ${result.rules.receipt === null ? 'unknown' : shown(result.rules.receipt)}.`,
    );
  }

  const computed = report.hash ?? null;
  const claimed = text(receipt.hash);
  result.hash = { receipt: claimed, computed, matches: computed !== null && claimed !== null && computed === claimed };
  if (report.ok && !result.hash.matches) result.problems.push('The hash of the lesson does not match the receipt: the lesson or its receipt was changed after publishing.');

  if (report.ok && sameRules) {
    // The receipt is what the page shows the learner under Sources, so its counts have to be the true ones.
    result.receiptMatches = same(receipt.stats, report.stats) && same(receipt.weakClaims, report.weakClaims) && same(receipt.warnings, countByCode(report.warnings));
    if (!result.receiptMatches) result.problems.push('The counts or warnings in the receipt are not the ones validation reports for this lesson.');
  }

  result.dataOk = result.problems.length === 0;

  // The data is what the hash covers. Whether the visible page was drawn from that data can only be
  // checked by drawing it again, which is exact only for the same build and a page without audio.
  const build = stampedVersion(VERSION);
  // The receipt is part of the file: its version is shown only when it has the form of one.
  const made = /^[0-9A-Za-z.+-]{1,40}$/.test(text(receipt.version) ?? '') ? text(receipt.version) : null;
  if (options.dataOnly) result.page = { result: 'not-checked', why: '--data-only was given' };
  else if (html.includes('<script type="application/octet-stream"')) result.page = { result: 'not-checked', why: 'the page carries narration audio, which this command cannot draw again' };
  else if (made !== build) result.page = { result: 'not-checked', why: `the page was made by another build of Learning Tool (${made ?? 'unknown'}; this is ${build}), and only the build that made a page draws it the same way` };
  else {
    let rendered: string | null = null;
    try {
      rendered = renderLesson({ lesson: data.lesson, receipt: data.receipt }).html;
    } catch {
      rendered = null;
    }
    const why =
      buildId() === null
        ? 'the page is not what this build renders from the embedded data: it was changed after it was published, or made by a different build of this version'
        : 'this build made the page, and the page is no longer what it renders from the embedded data: the file was changed after it was published';
    result.page = rendered === html ? { result: 'identical' } : { result: 'differs', why };
  }
  // A page that differs fails whatever the data says: what the learner reads is the page.
  if (result.page.result === 'differs') result.problems.push('The visible page is not what its own data renders to.');
  if (options.strict && result.page.result === 'not-checked') result.problems.push('The visible page could not be compared with its data, and --strict passes only a page proven identical.');

  result.ok = result.problems.length === 0;
  return result;
}

/** The first word of the report. "OK" is kept for the one case in which everything was shown: the data holds and the page is what it renders to. */
function headline(result: VerifyResult): string {
  if (!result.dataOk || !result.page) return 'FAILED';
  if (result.page.result === 'identical') return 'OK';
  return result.page.result === 'differs' ? 'DATA OK, PAGE DIFFERS' : 'DATA OK, PAGE NOT COMPARED';
}

const NOT_SHOWN = 'It does not show that its excerpts are genuine: open the sources to check those. The hash is not a signature: it catches damage and plain edits, not a file rebuilt on purpose.';

export function formatVerify(result: VerifyResult): string {
  const lines: string[] = [];
  const name = result.lesson?.title ? `"${shown(result.lesson.title)}"` : shown(path.basename(result.file));
  lines.push(`${headline(result)}  ${name}`);
  // `sources` is the count of stored passages the lesson carries, and a passage is not called a source to a reader.
  if (result.lesson) lines.push(`  lesson   ${shown(result.lesson.id) || 'no id'}: ${result.lesson.scenes} scenes, ${result.lesson.sources} passages`);
  if (result.hash) {
    lines.push(
      result.hash.matches
        ? `  hash     ${result.hash.computed} matches the receipt`
        : `  hash     ${result.hash.computed ?? 'not computed, because the lesson does not pass'}; the receipt says ${result.hash.receipt === null ? 'nothing' : shown(result.hash.receipt)}`,
    );
  }
  if (result.rules) lines.push(`  rules    published under version ${result.rules.receipt === null ? 'unknown' : shown(result.rules.receipt)}; this build checks version ${result.rules.current}`);
  if (result.receiptMatches !== undefined) lines.push(`  receipt  ${result.receiptMatches ? `its counts are what validation reports now (${result.warnings} warning${result.warnings === 1 ? '' : 's'})` : 'its counts are NOT what validation reports now'}`);
  if (result.page) {
    lines.push(
      result.page.result === 'identical'
        ? '  page     identical to what this build renders from the data'
        : result.page.result === 'differs'
          ? `  page     DIFFERS: ${result.page.why}`
          : `  page     not compared: ${result.page.why}`,
    );
  }
  for (const problem of result.problems) lines.push(`  ! ${problem}`);
  for (const e of result.errors.slice(0, 20)) lines.push(plain(`    ${e.code}${e.sceneId ? ` ${e.sceneId}` : ''}${e.path ? ` ${e.path}` : ''}: ${e.message}`));
  // The reassurance is only ever printed for what was shown.
  if (result.dataOk && result.page?.result === 'identical') {
    lines.push(`  This shows the lesson is the one that was validated, that it still passes, and that the page is what it renders to. ${NOT_SHOWN}`);
  } else if (result.dataOk && result.page?.result === 'differs') {
    lines.push('  The embedded lesson is the one that was validated, and it still passes. The visible page is not what it renders to, so what a learner reads here is not the validated lesson. Publish the lesson again to get the page back.');
  } else if (result.dataOk && result.page) {
    lines.push(`  Only the embedded data was checked: it is the lesson that was validated, and it still passes. The visible page was not compared with it, so this does not show that the page is what the data renders to. ${NOT_SHOWN}`);
  }
  return lines.join('\n');
}

export const USAGE = [
  'Learning Tool',
  '',
  'Usage:',
  '  learning-tool.mjs                      serve the MCP tools over stdio (what an MCP host runs)',
  '  learning-tool.mjs verify <file.html>   validate the lesson embedded in a published file again, compare it with its',
  '                                         receipt, and compare the visible page with what that lesson renders to.',
  '                                         Exit 0 when it holds, 1 when the data fails or the page differs.',
  '                                         A page made by another build, or one with audio, cannot be compared:',
  '                                         that is said, and the exit status is 0 unless --strict is given.',
  '                                         --strict     pass only when the page was proven identical.',
  '                                         --data-only  check the embedded data and leave the page alone.',
  '                                         --json       print the result as JSON.',
  '  learning-tool.mjs voice-check          say whether voice is configured and whether ElevenLabs answers.',
  '                                         Exit 0 when voice works or is simply off, 1 when it is set up but failing.',
  '  learning-tool.mjs --version',
].join('\n');

export async function runVerify(argv: readonly string[], io: Io): Promise<number> {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const files = argv.filter((a) => !a.startsWith('--'));
  const unknown = [...flags].filter((f) => f !== '--strict' && f !== '--data-only' && f !== '--json');
  // The two say opposite things about the page, so together they are a mistake and not a preference.
  if (files.length !== 1 || unknown.length > 0 || (flags.has('--strict') && flags.has('--data-only'))) {
    io.err('Usage: learning-tool.mjs verify <file.html> [--data-only | --strict] [--json]');
    return 1;
  }
  const result = await verifyFile(path.resolve(files[0] as string), { strict: flags.has('--strict'), dataOnly: flags.has('--data-only') });
  io.out(flags.has('--json') ? JSON.stringify(result, null, 2) : formatVerify(result));
  return result.ok ? 0 : 1;
}

export async function runVoiceCheck(argv: readonly string[], io: Io, env: Env, options: VoiceCheckOptions = {}): Promise<number> {
  const unknown = argv.filter((a) => a !== '--json');
  if (unknown.length > 0) {
    io.err('Usage: learning-tool.mjs voice-check [--json]');
    return 1;
  }
  const report = await voiceCheck(voiceConfigFromEnv(env), { ...options, env });
  io.out(argv.includes('--json') ? JSON.stringify(report, null, 2) : formatVoiceCheck(report));
  if (report.code === 'VOICE_OK') return 0;
  return report.code === 'VOICE_OFF' && report.problems.length === 0 ? 0 : 1;
}
