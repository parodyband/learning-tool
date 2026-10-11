// publish_lesson: the gate. It validates the whole draft itself, refuses on any error, and then
// renders from the very lesson object that validation assembled. The draft is not read again between
// the check and the write, so what is published is what was checked.
//
// Order of work, and why:
//   1. Validate. Any error: nothing is written.
//   2. Render and write the text-only file, record the publication in the draft, start the local link.
//      From here the lesson is published whatever happens next.
//   3. Only if voice is configured and not declined: synthesise within the deadline and replace the
//      file with a version that carries the audio. Any failure leaves the text file in place.
//      What is spoken is what `narrationSegments` returns: for a clip, one segment per beat (its
//      caption), under the id "<sceneId>.beat<N>". The clips come back keyed by those ids and the
//      page plays each beside the beat it belongs to; nothing here renames or regroups them.
//   4. Open the page if the learner asked for that.
import { pathToFileURL } from 'node:url';
import { RULES_VERSION } from '../../core/limits';
import { narrationSegments } from '../../core/narration';
import type { LessonV2 as Lesson } from '../../core/clip';
import type { Issue, LessonReport, Receipt } from '../../core/types';
import { checkLesson } from '../../core/validate';
import { VOICE_MESSAGES, type VoiceReport } from '../../tts';
import { readFlag } from '../args';
import { stampedVersion } from '../build-id';
import type { ServerDeps } from '../deps';
import { serverIssue } from '../issues';
import { isLessonFileName, lessonFileName, localDate } from '../paths';
import type { CallContext, Handler } from './common';
import { lessonCall, type Work } from './lesson-call';

function warningCounts(warnings: readonly Issue[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of warnings) {
    if (w.code === 'MORE_ISSUES') continue;
    out[w.code] = (out[w.code] ?? 0) + 1;
  }
  return out;
}

export function buildReceipt(deps: ServerDeps, report: LessonReport & { hash: string }): Receipt {
  return {
    generator: 'learning-tool',
    // With the build, so that `verify` compares a page only with the renderer that made it.
    version: stampedVersion(deps.version),
    rules: RULES_VERSION,
    hash: report.hash,
    validatedOn: localDate(deps.now()),
    stats: report.stats,
    warnings: warningCounts(report.warnings),
    weakClaims: report.weakClaims,
  };
}

/** What the agent is told about voice: the fixed code and sentence, counts, and whether the page ended up with audio. */
function voiceSummary(report: VoiceReport, audio: boolean): Record<string, unknown> {
  return {
    enabled: true,
    code: report.code,
    message: report.message,
    ...(report.cause !== undefined ? { cause: report.cause } : {}),
    audio,
    segments: report.counts,
    characters: { sent: report.characters.sent, cached: report.characters.cached, budget: report.characters.budget },
  };
}

async function addVoice(
  deps: ServerDeps,
  ctx: CallContext,
  lesson: Lesson,
  receipt: Receipt,
  target: { fileName: string; lessonId: string; filePath: string },
  declined: boolean,
): Promise<Record<string, unknown>> {
  const config = deps.voice.config;
  if (!config) return { enabled: false, code: 'VOICE_OFF', message: VOICE_MESSAGES.VOICE_OFF, audio: false };
  if (declined) return { enabled: true, code: 'VOICE_OFF', skipped: true, message: 'Audio was left out because "voice": false was passed.', audio: false };

  let result;
  try {
    result = await deps.voice.synthesize(narrationSegments(lesson), config, {
      ...deps.voice.options,
      cacheDir: deps.store.voiceCacheDir,
      deadlineMs: deps.voice.deadlineMs,
      signal: ctx.signal,
    });
  } catch (error) {
    // The voice module rejects only for a programming mistake. Its message is not passed on; the text lesson stands.
    deps.log(`learning-tool: publish_lesson: voice failed (${error instanceof Error ? error.name : 'error'})`);
    return { enabled: true, code: 'VOICE_NETWORK', message: VOICE_MESSAGES.VOICE_NETWORK, audio: false };
  }
  if (!result.audio || result.clips.length === 0) return voiceSummary(result.report, false);

  try {
    const page = deps.render({ lesson, receipt, audio: result.audio });
    await deps.store.writeLesson(target.fileName, target.lessonId, page.html);
    // Same script and style, so the same policy; registered again in case a renderer ever makes it differ.
    // Not once the connection has gone: that would open the listener again with no one left to close it.
    if (!ctx.signal.aborted) await deps.listener.serve(target.lessonId, target.filePath, page.csp);
    return voiceSummary(result.report, true);
  } catch (error) {
    deps.log(`learning-tool: publish_lesson: the audio version was not written (${error instanceof Error ? error.name : 'error'})`);
    return { ...voiceSummary(result.report, false), note: 'The audio was made but the page with audio could not be written. The text lesson is published.' };
  }
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * What to tell the learner. The file comes first because it always works: the local link dies with
 * the process that serves it, and an agent cannot know whether that process outlives its reply.
 * Passages, pages and sites are three different numbers, and passages are never called sources:
 * sixteen excerpts from three pages are not sixteen sources.
 */
function replyText(lesson: Lesson, receipt: Receipt, links: { fileUrl: string; path: string; localUrl: string | null }, voice: Record<string, unknown>): string {
  const warnings = Object.values(receipt.warnings).reduce((sum, n) => sum + n, 0);
  const codes = Object.keys(receipt.warnings).join(', ');
  const stats = receipt.stats;
  const parts = [
    `Tell the learner the lesson is ready and give them the file first: ${links.path} (${links.fileUrl}). It always works, offline too.`,
    links.localUrl ? `Then give the local link as a second way in: ${links.localUrl} (it works only while this app stays open).` : 'There is no local link this time: the file is the way in.',
    `Say in one line what it is: "${lesson.title}", about ${count(stats.minutes, 'minute', 'minutes')}, ${count(lesson.scenes.length, 'scene', 'scenes')}, ${count(stats.sources, 'passage', 'passages')} from ${count(stats.pages, 'page', 'pages')} on ${count(stats.hosts, 'site', 'sites')}. Passages are excerpts: never call them sources.`,
  ];
  if (warnings > 0) parts.push(`Say that validation recorded ${warnings} warning${warnings === 1 ? '' : 's'} (${codes}), which the page also shows under Sources.`);
  if (voice.audio === true) parts.push(voice.code === 'VOICE_PARTIAL' ? 'Say that the lesson is read aloud for part of the way: audio is included for part of the lesson.' : 'Say that the lesson is read aloud as it plays: audio is included.');
  else if (voice.enabled === true && voice.skipped !== true) parts.push('Say in a clause that audio could not be added this time; the lesson itself is complete.');
  parts.push(
    'Do not summarise the lesson, and do not reveal its questions or their answers: it works by having the learner watch, predict and retrieve.',
    'Do not call it verified or fact-checked. You may say that every claim opens the passage it is based on, so anything that matters can be checked.',
  );
  return parts.join(' ');
}

export const publishLesson: Handler = (deps, raw, ctx) =>
  lessonCall(deps, raw, {
    tool: 'publish_lesson',
    spec: { required: ['lessonId'], optional: ['voice', 'open'] },
    write: true,
    work: async (draft, args): Promise<Work> => {
      const flagErrors: Issue[] = [];
      const wantVoice = readFlag(args, 'voice', flagErrors);
      const wantOpen = readFlag(args, 'open', flagErrors);
      if (flagErrors.length > 0) return { errors: flagErrors, outcome: { rejected: flagErrors } };

      const report = checkLesson(draft);
      if (!report.ok || report.lesson === undefined || report.hash === undefined) {
        const errors = report.errors.length > 0 ? report.errors : [serverIssue('INTERNAL_ERROR', '', 'The lesson did not pass validation, and validation gave no reason.')];
        return {
          ok: false,
          errors,
          warnings: report.warnings,
          outcome: { report, errorsAt: 'errors' },
          payload: { published: false, complete: report.complete, pending: report.pending, stats: report.stats },
        };
      }

      // From here on, only `lesson` is used: the object that was validated and hashed.
      const lesson = report.lesson;
      const receipt = buildReceipt(deps, { ...report, hash: report.hash });
      const republished = draft.published !== undefined;
      // The name is fixed at first publish, so a link the learner already has keeps working after a title change.
      const stored = draft.published?.fileName;
      const fileName = isLessonFileName(stored, draft.id) ? stored : lessonFileName(lesson.title, draft.id);

      const page = deps.render({ lesson, receipt });
      const filePath = await deps.store.writeLesson(fileName, draft.id, page.html);
      draft.published = { fileName, hash: report.hash, at: deps.now().toISOString() };
      await deps.store.save(draft);
      const localUrl = ctx.signal.aborted ? null : await deps.listener.serve(draft.id, filePath, page.csp);

      const voice = await addVoice(deps, ctx, lesson, receipt, { fileName, lessonId: draft.id, filePath }, wantVoice === false);

      let opened: boolean | undefined;
      if (wantOpen === true) {
        try {
          await deps.open(filePath);
          opened = true;
        } catch {
          opened = false;
        }
      }

      const fileUrl = pathToFileURL(filePath).href;
      return {
        warnings: report.warnings,
        changed: true,
        outcome: { report },
        payload: {
          published: true,
          republished,
          title: lesson.title,
          file: { path: filePath, url: fileUrl },
          local: localUrl
            ? { url: localUrl, note: 'Served by this process to this machine only, and only while the host app stays open. Give the file first: it always works. Publishing this lesson again keeps this link.' }
            : { url: null, note: 'No local port could be opened, so there is no http link this time. The file works.' },
          receipt: { hash: receipt.hash, rules: receipt.rules, validatedOn: receipt.validatedOn, stats: receipt.stats, warnings: receipt.warnings, weakClaims: receipt.weakClaims.length },
          voice,
          ...(opened !== undefined ? { opened } : {}),
          reply: replyText(lesson, receipt, { fileUrl, path: filePath, localUrl }, voice),
        },
      };
    },
  });
