// The document around the scenes: head, policy, header, contents, pager, footer, the embedded data
// and the one script and one style element.
//
// Order in <head> matters. The character set comes first so nothing is decoded before it is known;
// the Content-Security-Policy comes second so that nothing can run before it is in force.
import { createHash } from 'node:crypto';
import type { AnyScene as Scene, LessonV2 as Lesson } from '../core/clip';
import type { AudioClip, Published, Receipt } from '../core/types';
import { PLAYER_CSS, PLAYER_JS } from '../generated/player-assets';
import { type Attrs, type Html, attrs, esc, html, idLink, inlineScriptText, inlineStyleText, isBase64, jsonForScript, pageId, sceneHeadingId, token } from './escape';
import { type SceneEnv, isWide, kindLabel, renderScene } from './scenes';
import { KNOWN_LIMIT, renderSourcesButton, renderSourcesDialog, sourceBook } from './sources';

export const NARRATION_LINE = 'Machine narration by ElevenLabs (elevenlabs.io). The text is authoritative.';
export const SPEEDS = ['0.75', '1', '1.25', '1.5'] as const;

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('base64');
}

/**
 * The policy for a page whose only script and only style have these exact texts. Nothing loads
 * from anywhere: images may only be data: URLs and audio only blob: URLs the script made itself.
 *
 * `worker-src data:` is there for the custom frame (src/player/frame/): the player starts a Web
 * Worker from a data: URL it builds itself. It gives markup nothing: only script that already runs
 * in the page can construct a worker, and the only script that runs is the one hashed above. The
 * worker inherits this whole policy, so it has no network, no eval and no imports, and a data: URL
 * gives it an opaque origin, so it has no storage (measured in docs/design/research/v2-sandbox.md).
 * Do not widen it to blob:, which would give the worker the page's own origin.
 */
export function contentSecurityPolicy(scriptText: string, styleText: string): string {
  return [
    "default-src 'none'",
    `script-src 'sha256-${sha256(scriptText)}'`,
    `style-src 'sha256-${sha256(styleText)}'`,
    'img-src data:',
    'media-src blob:',
    "base-uri 'none'",
    "form-action 'none'",
    'worker-src data:',
  ].join('; ');
}

const DEPTH_WORD: Record<string, string> = { quick: 'A quick lesson', standard: 'A standard lesson', deep: 'A deep lesson' };
const LEVEL_WORD: Record<string, string> = { new: 'someone new to this', some: 'someone with some background', solid: 'someone with a solid background' };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One or two plain sentences under the title. Sentences, not a row of separated facts, so they wrap cleanly at any width. */
function metaLine(p: Published): string {
  const { lesson, receipt } = p;
  const minutes = Number.isFinite(receipt.stats.minutes) && receipt.stats.minutes > 0 ? `about ${plural(Math.round(receipt.stats.minutes), 'minute', 'minutes')}` : null;
  const depth = Object.hasOwn(DEPTH_WORD, lesson.depth) ? (DEPTH_WORD[lesson.depth] as string) : 'A lesson';
  const facts = [minutes, plural(lesson.scenes.length, 'scene', 'scenes'), plural(lesson.evidence.length, 'source', 'sources')].filter(Boolean).join(', ');
  const level = Object.hasOwn(LEVEL_WORD, lesson.level) ? ` Written for ${LEVEL_WORD[lesson.level] as string}.` : '';
  return `${depth}: ${facts}.${level}`;
}

/** A segment id is "<sceneId>", "<sceneId>.intro", "<sceneId>.step<N>" or, for a clip, "<sceneId>.beat<N>", and its scene must exist. Anything else is not embedded. */
function clipScene(segmentId: string, sceneIds: ReadonlySet<string>): string | null {
  const m = /^([a-z][a-z0-9_-]{0,31})(?:\.(?:intro|(?:step|beat)[1-9][0-9]?))?$/.exec(segmentId);
  return m && sceneIds.has(m[1] as string) ? (m[1] as string) : null;
}

function usableClips(p: Published): AudioClip[] {
  if (!p.audio) return [];
  const sceneIds = new Set(p.lesson.scenes.map((s) => s.id));
  const seen = new Set<string>();
  return p.audio.clips.filter((clip) => {
    if (clip.mime !== 'audio/mpeg' || !isBase64(clip.base64) || clipScene(clip.segmentId, sceneIds) === null || seen.has(clip.segmentId)) return false;
    seen.add(clip.segmentId);
    return true;
  });
}

const ICON_THEME = html`<svg class="lt-icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 2.75a7.25 7.25 0 0 1 0 14.5z" fill="currentColor"/></svg>`;
const ICON_BACK = html`<svg class="lt-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="M16 10H4.5M9 5l-5 5 5 5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_NEXT = html`<svg class="lt-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 10h11.5M11 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_PLAY = html`<svg class="lt-icon lt-icon-play" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6.5 4.2v11.6L16 10z" fill="currentColor"/></svg>`;
const ICON_PAUSE = html`<svg class="lt-icon lt-icon-pause" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M5.5 4.5h3v11h-3zM11.5 4.5h3v11h-3z" fill="currentColor"/></svg>`;

function header(p: Published, ui: Attrs): Html {
  const { lesson } = p;
  const first = lesson.scenes[0];
  return html`<header class="lt-top ${first && isWide(first) ? token('wide', ['wide'], 'wide', 'lt-top-') : null}"><p class="lt-brand"${ui}>Learning Tool</p><h1 class="lt-title" id="${pageId('title')}">${
    lesson.title
  }</h1><div class="lt-tools"${ui}><button type="button" class="lt-tool" popovertarget="${pageId('contents')}">Contents</button>${renderSourcesButton(lesson, ui)}<button type="button" class="lt-tool lt-tool-icon" id="${pageId(
    'theme',
  )}" hidden>${ICON_THEME}<span class="lt-vh" data-theme-label>Use the dark theme</span></button></div><p class="lt-meta"${ui}>${metaLine(p)}</p><div class="lt-objectives"><p class="lt-label" id="${pageId('goals')}"${ui}>After this lesson you can</p><ol aria-labelledby="${pageId(
    'goals',
  )}">${lesson.objectives.map((o) => html`<li>${o.text}</li>`)}</ol></div><p class="lt-resume" id="${pageId('resume')}" hidden${ui}></p></header>`;
}

function contents(scenes: readonly Scene[], ui: Attrs): Html {
  return html`<nav popover id="${pageId('contents')}" class="lt-contents" aria-label="Contents"><ol>${scenes.map((scene) => {
    const label = kindLabel(scene.kind);
    return html`<li data-contents="${scene.id}"><a href="${idLink(sceneHeadingId(scene.id))}" data-goto="${scene.id}"><span class="lt-contents-title">${scene.title}</span>${
      label ? html` <span class="lt-contents-kind"${ui}>${label}</span>` : null
    }</a></li>`;
  })}</ol></nav>`;
}

function rail(scenes: readonly Scene[]): Html {
  return html`<ol class="lt-rail" aria-hidden="true">${scenes.map((scene) => html`<li data-rail="${scene.id}"></li>`)}</ol>`;
}

function audioBar(voice: string, segments: readonly string[], ui: Attrs): Html {
  // The clips themselves are parsed after the script has started, so the script is told here which segments have one.
  return html`<div class="lt-audio" id="${pageId('audiobar')}" data-segments="${segments.join(' ')}" hidden${ui}><button type="button" class="lt-btn lt-btn-quiet lt-audio-play" id="${pageId('play')}">${ICON_PLAY}${ICON_PAUSE}<span data-audio-label>Listen</span></button><fieldset class="lt-speed"><legend class="lt-vh">Narration speed</legend>${SPEEDS.map(
    (speed) => html`<label class="lt-speed-option"><input type="radio" name="lt-speed" value="${speed}"${attrs({ checked: speed === '1' })}><span>${speed}×</span></label>`,
  )}</fieldset><p class="lt-audio-note">${NARRATION_LINE}${voice ? html` <span class="lt-audio-voice">Voice: ${voice}.</span>` : null}</p></div>`;
}

function pager(ui: Attrs): Html {
  return html`<nav class="lt-pager" id="${pageId('pager')}" aria-label="Scenes" hidden${ui}><button type="button" class="lt-btn lt-btn-quiet" id="${pageId('back')}" aria-disabled="true">${ICON_BACK}Back</button><p class="lt-pager-next" id="${pageId(
    'upnext',
  )}"></p><button type="button" class="lt-btn lt-btn-primary" id="${pageId('next')}" aria-describedby="${pageId('upnext')}">Continue${ICON_NEXT}</button></nav>`;
}

function footer(ui: Attrs): Html {
  return html`<footer class="lt-foot"${ui}><p class="lt-foot-limit">Made by your agent with Learning Tool. ${KNOWN_LIMIT}</p><div class="lt-foot-progress" id="${pageId('progress')}" hidden><p class="lt-foot-note" id="${pageId(
    'storenote',
  )}">Your place and your checkpoint results are kept in this browser only.</p><p class="lt-foot-actions"><button type="button" class="lt-btn lt-btn-quiet" id="${pageId('clear')}">Clear my progress</button><span class="lt-clear-confirm" id="${pageId(
    'clearconfirm',
  )}" hidden><span>This forgets your place and your results in this lesson.</span> <button type="button" class="lt-btn lt-btn-quiet" id="${pageId('clearyes')}">Yes, clear it</button> <button type="button" class="lt-btn lt-btn-quiet" id="${pageId(
    'clearno',
  )}">Keep it</button></span></p></div></footer>`;
}

/** The opening tag of the data element, written and read back in this file only. */
const DATA_OPEN = `<script type="application/json" id="${pageId('data')}">`;

export interface RenderedLesson {
  /** The complete document. */
  html: string;
  /** The policy in the document's meta element, for a server that also sends it as a header. */
  csp: string;
}

export function renderDocument(p: Published): RenderedLesson {
  const { lesson, receipt } = p;
  const ui = attrs({ lang: /^en(-|$)/i.test(lesson.language) ? undefined : 'en' });
  const clips = usableClips(p);
  const env: SceneEnv = {
    lesson,
    receipt,
    book: sourceBook(lesson),
    weak: new Set(receipt.weakClaims),
    ui,
    clips: new Set(clips.map((c) => c.segmentId)),
  };

  const scriptText = inlineScriptText(PLAYER_JS);
  const styleText = inlineStyleText(PLAYER_CSS);
  const csp = contentSecurityPolicy(scriptText, styleText);

  const body = html`<a class="lt-skip" href="${idLink(pageId('main'))}"${ui}>Skip to the lesson</a>${header(p, ui)}${contents(lesson.scenes, ui)}${rail(lesson.scenes)}<main id="${pageId('main')}">${
    clips.length > 0
      ? audioBar(
          p.audio?.voice ?? '',
          clips.map((c) => c.segmentId),
          ui,
        )
      : null
  }${lesson.scenes.map((scene, i) => renderScene(env, scene, i))}${pager(ui)}</main>${footer(ui)}${renderSourcesDialog(lesson, receipt, ui)}<p id="${pageId(
    'live',
  )}" class="lt-vh" role="status"></p>${clips.length > 0 ? html`<audio id="${pageId('audio')}" preload="none"></audio>` : null}`;

  // The lesson and receipt exactly as they were validated and hashed. Audio is left out: it is
  // carried below, and it is not part of what the hash covers.
  const data = jsonForScript({ lesson, receipt });

  const head =
    '<meta charset="utf-8">' +
    // Written as it is: the policy is fixed words and base64, and its single quotes are fine inside a double-quoted attribute.
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<meta name="referrer" content="no-referrer">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="color-scheme" content="light dark">' +
    `<meta name="generator" content="${esc(`Learning Tool ${receipt.version}`)}">` +
    `<title>${esc(lesson.title)} – Learning Tool</title>` +
    `<style>${styleText}</style>`;

  // The script comes before the audio so the page is interactive without waiting for megabytes of
  // base64 to be parsed; the player looks the clips up when one is first played.
  const tail =
    `${DATA_OPEN}${data}</script>` +
    `<script>${scriptText}</script>` +
    clips.map((clip) => `<script type="application/octet-stream" data-seg="${esc(clip.segmentId)}">${clip.base64}</script>`).join('');

  const doc = `<!doctype html>\n<html lang="${esc(lesson.language)}">\n<head>${head}</head>\n<body>${body.value}${tail}</body>\n</html>\n`;
  return { html: doc, csp };
}

/**
 * Read the lesson and receipt back out of a published file. Returns null when the data element is
 * missing or is not JSON of the expected outer shape; checking the lesson itself is the caller's
 * job (the `verify` command re-validates it and compares the hash).
 */
export function readEmbeddedData(document: string): { lesson: Lesson; receipt: Receipt } | null {
  const open = DATA_OPEN;
  const start = document.indexOf(open);
  if (start === -1) return null;
  // The embedded text never contains "<", so the first "</script" after it is the real end.
  const end = document.indexOf('</script', start + open.length);
  if (end === -1) return null;
  try {
    const value: unknown = JSON.parse(document.slice(start + open.length, end));
    if (typeof value !== 'object' || value === null) return null;
    const { lesson, receipt } = value as { lesson?: unknown; receipt?: unknown };
    if (typeof lesson !== 'object' || lesson === null || typeof receipt !== 'object' || receipt === null) return null;
    return { lesson: lesson as Lesson, receipt: receipt as Receipt };
  } catch {
    return null;
  }
}
