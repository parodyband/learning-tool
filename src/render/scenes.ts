// Scenes, and the contract between the shell and the modules built on it.
//
// THE DOM CONTRACT
// Read this before writing a figure, question or step renderer, or its player module. The shell
// (render/{escape,inline,blocks,sources,scenes,page}.ts, player/{main,nav,storage,popovers,audio,
// summary}.ts, css/{tokens,base,shell,blocks,print}.css) is fixed; the three renderers, the three
// player modules and the three stylesheets named below are yours to replace.
//
// 1. One representation
//    The whole lesson is rendered to semantic HTML here, at publish time. The script only enhances
//    it. With scripting off every scene is visible in order and must read as a complete document,
//    so whatever you render must make sense with no script: answers behind a native <details>,
//    every step listed, every figure part present as text.
//
// 2. What you implement (signatures are final)
//      render/figures.ts    renderFigure(figure: Figure, ctx: RenderContext): string
//      render/questions.ts  renderQuestion(question: Question, ctx: RenderContext): string
//      render/steps.ts      renderSteps(scene: StepThroughScene, ctx: RenderContext): string
//      player/figures.ts    enhanceFigures(root: ParentNode): void
//                           setHighlight(figureEl: Element, partIds: readonly string[]): void
//      player/questions.ts  initQuestions(root: ParentNode, api: PlayerApi): void
//      player/steps.ts      initSteps(root: ParentNode, api: PlayerApi): void
//      css/figures.css, css/questions.css, css/steps.css (already imported by styles.css)
//    Each render function returns a string of HTML that is safe to insert as it is.
//
// 3. Building markup (render/escape.ts)
//    Build every piece with the html`` tag and return `html`...`.toString()`.
//      - A plain string or number you interpolate is TEXT and is escaped. Markup is an `Html` value;
//        only html``, ctx.inline, ctx.cites and ctx.blocks produce one. `raw(s)` is for markup from
//        another trusted builder (MathML) and must never be given a string from the lesson.
//      - Interpolate only into element content or inside a double-quoted attribute value. The tag
//        rejects anything else the first time the template runs: an interpolated tag or attribute
//        name, an unquoted or single-quoted value, a `style` attribute, an `on...` handler, a
//        <script> or <style> element, a literal "<" that is not a tag.
//      - Optional and boolean attributes: `<li${attrs({ lang, hidden: cond })}>`. Names are literals.
//      - A class name that depends on lesson data: `class="x ${token(value, ALLOWED, fallback, 'x-')}"`.
//        A plain string is refused in `class`. Prefer a data attribute and select on that.
//      - `href` and the other URL attributes take only a `Url`: `idLink(id)` for a link inside the
//        page. The one URL that comes from a lesson is the source link, and sources.ts builds it.
//      - No `style=""` anywhere: the page's policy blocks it. Position and size things from the
//        player through CSSOM (`el.style.setProperty(...)`) or with classes and data attributes.
//    Ids: `ctx.id(partId)` for a part the lesson names (lt-<sceneId>-<partId>), `ctx.own(name)` for
//    anything you add (lt-<sceneId>-_<name>). In the player compute the first with `domId(sceneId,
//    partId)` from player/main.ts (the scene id is escaped, so do not concatenate by hand) and look
//    elements up with getElementById; never build a selector from lesson data, and keep runtime
//    lookups in a Map, never an object keyed by lesson strings.
//
// 4. The render context (RenderContext, below)
//      ctx.lesson, ctx.receipt, ctx.scene, ctx.index
//      ctx.inline(text)          inline markup (strong, em, code, math) as Html
//      ctx.blocks(blocks, path)  a run of blocks as Html; path is the array's place in the scene in
//                                the validator's notation: "blocks", `steps[${i}].blocks`
//      ctx.cites(ids, { path })  -> { chips, popovers }, both Html. `chips` is phrasing content: put
//                                it at the end of the sentence it supports, after a `&nbsp;`.
//                                `popovers` is flow content: put it directly after that paragraph,
//                                never inside a <p>. Pass `path` for the citing item ("figure",
//                                "question.explanation", "takeaways[0]") so a weak-match claim gets
//                                its note. Unknown ids produce nothing (compare with EMPTY).
//      ctx.source(id)            the Evidence record, for attribution text
//      ctx.ui                    put inside the tag of an element that holds only interface words
//                                (a label, a button): it adds lang="en" in a non-English lesson
//      ctx.hasClip(segmentId)    whether narration exists for "<sceneId>", "<sceneId>.step2", ...
//    For one line of math on its own use renderMath(src, display) from render/inline.ts.
//
// 5. Page skeleton (page-level ids are lt-<oneword>; do not create ids of that shape)
//      html[lang]                          classes set by the player: lt-js, lt-compact, lt-wide;
//                                          data-theme="light|dark" when the learner overrides
//        a.lt-skip
//        header.lt-top                     p.lt-brand, h1#lt-title, div.lt-tools, p.lt-meta,
//                                          div.lt-objectives, p#lt-resume
//        nav#lt-contents[popover]          ol > li[data-contents=<sceneId>] > a[data-goto=<sceneId>]
//        ol.lt-rail[aria-hidden]           li[data-rail=<sceneId>]
//        main#lt-main
//          div#lt-audiobar.lt-audio        only in a lesson with narration clips
//          section.lt-scene ...            one per scene, below
//          nav#lt-pager.lt-pager           button#lt-back, p#lt-upnext, button#lt-next
//        footer.lt-foot
//        dialog#lt-sources.lt-sources      every source, the known limit, the receipt
//        p#lt-live[role=status].lt-vh      the shell's one announcement region
//        audio#lt-audio                    only in a lesson with narration clips; the one media element
//        script#lt-data[type=application/json]   { lesson, receipt }
//        script                            the player
//        script[type=application/octet-stream][data-seg=<segmentId>]   base64 MP3, one per clip
//
// 6. Scene skeleton
//      section.lt-scene.lt-kind-<kind>[.lt-scene-wide]#lt-<sceneId>-_scene
//          [data-scene=<sceneId>][data-kind=<kind>][data-rev][data-objective][data-level][aria-labelledby]
//          data-rev is a short digest of the scene as it was validated. Whatever the player keeps
//          about a scene (a checkpoint result, the step reached) is kept with it and dropped when
//          it no longer matches, so a republished lesson never shows a result for a question the
//          learner did not answer.
//        header.lt-scene-head > h2#scene-<sceneId>[tabindex=-1]
//                                 > span.lt-kicker ("Scene 2 of 9 · Checkpoint") + span.lt-scene-title
//        div.lt-scene-body[.lt-split][.lt-split-steps]
//      narration      div.lt-text-col.lt-prose[data-narration=<sceneId>]  (blocks)
//                     div.lt-figure-col                                   <- renderFigure, when present
//      step_through   p.lt-intro[data-narration=<sceneId>.intro]          (when the scene has one)
//                     div.lt-figure-col                                   <- renderFigure
//                     div.lt-text-col                                     <- renderSteps
//      checkpoint     div.lt-text-col[data-narration=<sceneId>]           <- renderQuestion
//      recap          div.lt-text-col.lt-recap                            (shell)
//    The narration marks the [data-narration] element it is reading. It opens a <details> inside
//    that element only when the disclosure carries data-narrated, which says its content is part
//    of what is read aloud (a recap takeaway). A hint or an answer is the learner's to open.
//    A scene that is not on show has the `hidden` attribute. `.lt-split` puts text and figure side
//    by side from 62rem and stacks them below that; in a step-through the figure column is sticky.
//    The column you render into can be as narrow as 288px: nothing may scroll the page sideways at
//    a 320px viewport. Wrap, or scroll inside your own box; a box that scrolls must be reachable by
//    keyboard, so give it tabindex="0", role="region" and an aria-label (axe checks this).
//
//    What your root elements must carry:
//      figure   div.lt-figure[role=group][aria-labelledby][data-figure=<type>][data-scene=<sceneId>]
//               every part a step can highlight: id=ctx.id(partId) and data-part=<partId>
//               (a `lines` figure names its parts l1..lN). setHighlight sets data-hl="true" on the
//               chosen parts, clears it on the rest, and adds visually hidden " (highlighted)" text
//               (class lt-vh). The description is visible text. role=group goes on a div, not on a
//               <figure> (axe rejects that).
//      steps    div.lt-steps[data-steps=<sceneId>]; each step element [data-step=<N>] (1-based) and
//               [data-narration=<sceneId>.step<N>] so the narration can mark it while it is read
//      question div.lt-question[data-question=<type>]; visible feedback goes in your own element
//               with role="status" that is present and empty in the initial markup
//
// 7. The player (types in player/main.ts)
//    Start-up order, all in one task, so there is no flash: add html.lt-js; initPopovers;
//    initSummary; initAudio; enhanceFigures(document); initQuestions(document, api);
//    initSteps(document, api); then the first scene is shown. While your init runs every scene is
//    still laid out; after it, all but one are hidden. A module that measures layout must redo it
//    when its scene is shown or resized (a ResizeObserver covers both).
//    Events, fired on `document` (names in EVENTS):
//      lt:scenechange  detail { scene: SceneInfo, previous: SceneInfo | null }, after a scene is shown
//      lt:result       detail { sceneId, objective, result }, after a result is recorded
//      lt:stepchange   detail { sceneId, step }, after api.stepChanged; step is null while the
//                      step on show has nothing that may be read out yet
//    PlayerApi:
//      api.lesson, api.receipt   the embedded data. Strings in it are text: use textContent.
//                                Seed option shuffles from api.receipt.hash.
//      api.scenes, api.scene(id), api.current(), api.go(sceneId, focusEl?)
//                                A SceneInfo carries `rev`, the scene's data-rev: store it beside
//                                anything you keep about a scene and check it when you read back.
//      api.recordResult(sceneId, result)   result is 'correct' | 'incorrect' for a graded question,
//                                'yes' | 'partly' | 'no' for a reflect self-rating. A graded result
//                                is first-attempt: once stored, later calls return the stored value
//                                and change nothing. A self-rating may be changed. The objective is
//                                read from the scene, so you do not pass it.
//      api.result(sceneId)       what is stored, to restore a question after a reload
//      api.stepChanged(sceneId, step)   call whenever the visible step changes (1-based), and once
//                                at start if you do not begin on step 1. The narration then reads
//                                that step's clip; if the learner was listening it carries on.
//                                Pass null while the step's text is held back (an open prediction):
//                                nothing is read, and Listen is put away, until you call again.
//      api.announce(text)        the shell's hidden status region, for things with no visible text
//      api.store                 get(name, check) / set(name, value) / remove(name) under
//                                lt:<lessonId>:<name>. `check` must validate what comes back: on
//                                file:// every local page shares one localStorage. Never store
//                                what a learner typed; reflect answers live in memory only.
//    Links to a scene are <a href="#scene-<sceneId>" data-goto="<sceneId>"> (render with
//    idLink(sceneHeadingId(id))); the shell handles the click.
//
// 8. Styling
//    Use only the custom properties in css/tokens.css: colours (--lt-bg, --lt-surface, --lt-sunken,
//    --lt-ink, --lt-ink-2, --lt-ink-3, --lt-line, --lt-line-strong, --lt-accent, --lt-accent-ink,
//    --lt-accent-soft, --lt-good/-bad/-warn and their -soft pairs, --lt-mark), type (--lt-font-prose
//    for lesson text, --lt-font-ui for labels and controls, --lt-font-mono; --lt-size-body, -lede,
//    -s, -xs, -h2, -h3; --lt-leading), space (--lt-space-1..8), --lt-radius, --lt-radius-s,
//    --lt-target (smallest pointer target), --lt-focus, --lt-speed, --lt-shadow. They already follow
//    light and dark, prefers-contrast and forced colours. Text needs 4.5:1: use --lt-ink, -ink-2 or
//    -ink-3. Lines that carry meaning (connectors, node borders, a highlight) need 3:1: use
//    --lt-line-strong, --lt-ink or --lt-accent, never --lt-line. State is never colour alone.
//    Shared pieces in css/base.css: .lt-btn (.lt-btn-primary, .lt-btn-quiet, .lt-btn-small;
//    aria-disabled="true" keeps it focusable), .lt-label, details.lt-reveal > summary +
//    div.lt-reveal-body, .lt-table inside .lt-table-wrap, .lt-field, .lt-callout[data-tone=good|bad|
//    warn], .lt-vh, .lt-chip. Motion goes inside @media (prefers-reduced-motion: no-preference).
//    An empty .lt-callout is not shown, unless it is a role="status" region: that one stays in
//    the page with no box, because a region that appears together with its words is not announced.
//    In forced colours fills vanish: give anything that was only a fill a border.
//    Avoid <select>: WebKit reports a policy violation for its internals (measured; no other native
//    control does). Radios, checkboxes, text inputs, textarea, details, dialog and popover are clean.
//
// 9. Tests
//    test/player/shell-kit.ts has openLesson(page, testInfo, { published, hash, via }), which blocks
//    the network, silences media and replaces the clipboard, plus expectClean, tab (WebKit needs
//    Option+Tab) and withSilentAudio. Open a scene directly with hash "#/<sceneId>".
import type { AnyScene, LessonV2 } from '../core/clip';
import type { Block, Evidence, NarrationScene, Objective, RecapScene, StepThroughScene, CheckpointScene } from '../core/schema';
import type { Receipt } from '../core/types';
import { renderBlocks } from './blocks';
import { clipBody } from './clip';
import { canonicalJson, sha256Hex, utf8 } from '../core/hash';
import { type Attrs, EMPTY, type Html, attrs, domId, html, idLink, internalId, raw, sceneHeadingId, token } from './escape';
import { renderFigure } from './figures';
import { renderInline } from './inline';
import { renderQuestion } from './questions';
import { type CiteOptions, type Cited, type SourceBook, renderCites } from './sources';
import { renderSteps } from './steps';

/** What a scene's renderers are given. One per scene; see the contract at the top of this file. */
export interface RenderContext {
  /** The lesson being rendered. Its scenes may be clips (core/clip.ts) as well as the v1 kinds. */
  readonly lesson: LessonV2;
  readonly receipt: Receipt;
  readonly scene: AnyScene;
  /** 0-based position of the scene in the lesson. */
  readonly index: number;
  /** ` lang="en"` for interface text when the lesson is in another language, otherwise nothing. Interpolate it inside the tag of an element that holds only our own words. */
  readonly ui: Attrs;
  /** The DOM id of a part the lesson names: `lt-<sceneId>-<partId>`. */
  id(partId: string): string;
  /** The DOM id of something the renderer adds to this scene: `lt-<sceneId>-_<name>`. */
  own(name: string): string;
  /** A prose string with its inline markup rendered. */
  inline(src: string): Html;
  /** Numbered source chips and the popovers they open. */
  cites(evidenceIds: readonly string[], opts?: CiteOptions): Cited;
  /** A run of blocks. `path` is the path of the array within the scene: "blocks", "steps[2].blocks". */
  blocks(blocks: readonly Block[], path: string): Html;
  /** The stored evidence for an id, when the lesson carries it. */
  source(evidenceId: string): Evidence | undefined;
  /** Whether a narration clip exists for a segment id ("<sceneId>", "<sceneId>.step2", "<sceneId>.intro"). */
  hasClip(segmentId: string): boolean;
}

export interface SceneEnv {
  lesson: LessonV2;
  receipt: Receipt;
  book: SourceBook;
  weak: ReadonlySet<string>;
  ui: Attrs;
  clips: ReadonlySet<string>;
}

export function createContext(env: SceneEnv, scene: AnyScene, index: number): RenderContext {
  let popovers = 0;
  const ctx: RenderContext = {
    lesson: env.lesson,
    receipt: env.receipt,
    scene,
    index,
    ui: env.ui,
    id: (partId) => domId(scene.id, partId),
    own: (name) => internalId(scene.id, name),
    inline: renderInline,
    cites: (ids, opts) => renderCites({ book: env.book, sceneId: scene.id, weak: env.weak, ui: env.ui, language: env.lesson.language, nextPopover: () => ++popovers }, ids, opts),
    blocks: (blocks, path) => renderBlocks(blocks, ctx, path),
    source: (id) => env.book.get(id),
    hasClip: (segmentId) => env.clips.has(segmentId),
  };
  return ctx;
}

const KINDS = ['narration', 'step_through', 'checkpoint', 'recap', 'clip'] as const;
//      clip           div.lt-clip[data-clip=<sceneId>]                    <- clipBody (render/clip.ts)
//    A clip (core/clip.ts) is the v2 teaching scene: its section is laid out wide, and its body is
//    the static account of the clip that the player's stage engine (player/stage/) brings to life.

/** The word shown beside the scene number. A narration scene needs none. */
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'step_through':
      return 'Step by step';
    case 'checkpoint':
      return 'Checkpoint';
    case 'recap':
      return 'Recap';
    default:
      return '';
  }
}

/** Whether a scene is laid out with a figure beside its text. */
export function isWide(scene: AnyScene): boolean {
  if (scene.kind === 'clip') return true;
  return scene.kind === 'step_through' || (scene.kind === 'narration' && scene.figure !== undefined);
}

function narrationBody(scene: NarrationScene, ctx: RenderContext): Html {
  const prose = html`<div class="lt-text-col lt-prose" data-narration="${scene.id}">${ctx.blocks(scene.blocks, 'blocks')}</div>`;
  if (!scene.figure) return html`<div class="lt-scene-body">${prose}</div>`;
  return html`<div class="lt-scene-body lt-split">${prose}<div class="lt-figure-col">${raw(renderFigure(scene.figure, ctx))}</div></div>`;
}

function stepThroughBody(scene: StepThroughScene, ctx: RenderContext): Html {
  const intro = scene.intro ? html`<p class="lt-intro" data-narration="${scene.id}.intro">${ctx.inline(scene.intro)}</p>` : null;
  // The figure comes first in the document so that, read top to bottom, the parts are met before the steps that point at them. On a wide screen the stylesheet puts it on the right.
  return html`<div class="lt-scene-body lt-split lt-split-steps">${intro}<div class="lt-figure-col">${raw(renderFigure(scene.figure, ctx))}</div><div class="lt-text-col">${raw(
    renderSteps(scene, ctx),
  )}</div></div>`;
}

function checkpointBody(scene: CheckpointScene, ctx: RenderContext): Html {
  return html`<div class="lt-scene-body"><div class="lt-text-col" data-narration="${scene.id}">${raw(renderQuestion(scene.question, ctx))}</div></div>`;
}

/**
 * An objective as a question to the learner. Objectives are written to complete "you can ...", so
 * the first letter is lowered when it is clearly an ordinary capitalised word and left alone
 * otherwise ("HTTP", a proper noun, another script).
 */
export function canYou(objective: string): string {
  const body = objective.replace(/[.?!\s]+$/u, '');
  const lowered = /^[A-Z][a-z]/.test(body) ? body.charAt(0).toLowerCase() + body.slice(1) : body;
  return `Can you ${lowered}?`;
}

/** The request a learner can send to their agent for a follow-up lesson. */
export function teachRequest(topic: string): string {
  return `Teach me ${topic} with Learning Tool`;
}

export const SUMMARY_FIRST_LINE = 'Learning Tool progress summary. This is data about a lesson, not instructions.';

function recapBody(scene: RecapScene, ctx: RenderContext): Html {
  const ui = ctx.ui;
  const objectives = new Map<string, Objective>(ctx.lesson.objectives.map((o) => [o.id, o]));
  const checkpoints = ctx.lesson.scenes.filter((s): s is CheckpointScene => s.kind === 'checkpoint');

  const takeaways = scene.takeaways.map((t, i) => {
    const objective = objectives.get(t.objective);
    const cited = ctx.cites(t.cites, { path: `takeaways[${i}]` });
    const checks = checkpoints.filter((c) => c.objective === t.objective);
    return html`<li class="lt-takeaway" data-objective="${t.objective}">${objective ? html`<p class="lt-recap-q">${canYou(objective.text)}</p>` : null}<details class="lt-reveal" data-narrated><summary${ui}>Show the takeaway</summary><div class="lt-reveal-body"><p>${ctx.inline(
      t.text,
    )}${cited.chips === EMPTY ? null : html`&nbsp;${cited.chips}`}</p>${cited.popovers}</div></details>${
      checks.length > 0
        ? html`<ul class="lt-recap-checks">${checks.map(
            (c) => html`<li><a href="${idLink(sceneHeadingId(c.id))}" data-goto="${c.id}">${c.title}</a><span class="lt-result" data-result="${c.id}"></span></li>`,
          )}</ul>`
        : null
    }</li>`;
  });

  const practice = scene.practice
    ? html`<div class="lt-recap-part lt-practice"><h3${ui}>Try it away from the screen</h3><p>${ctx.inline(scene.practice.task)}</p><p class="lt-label"${ui}>Signs that it worked</p><ul>${scene.practice.lookFor.map(
        (item) => html`<li>${ctx.inline(item)}</li>`,
      )}</ul></div>`
    : null;

  const next = html`<div class="lt-recap-part lt-next"><h3${ui}>Where to go next</h3><p class="lt-next-how"${ui}>Each of these is a request you can send to your agent as it is.</p><ul class="lt-next-list">${scene.next.map((n, i) => {
    const requestId = ctx.own(`next${i + 1}`);
    return html`<li><p class="lt-request"><span class="lt-request-text" id="${requestId}">${teachRequest(n.topic)}</span><button type="button" class="lt-btn lt-btn-quiet lt-copy" data-copy="${requestId}" hidden${ui}>Copy<span class="lt-vh"> this request</span></button></p><p class="lt-next-why">${ctx.inline(n.why)}</p></li>`;
  })}</ul></div>`;

  const summaryId = ctx.own('summary');
  const summary = html`<div class="lt-recap-part lt-summary"${ui}><h3>Tell your agent how it went</h3><p><label for="${summaryId}">This is everything the button copies: the lesson, its objectives, and how each checkpoint went on your first attempt. Nothing you typed is included.</label></p><textarea id="${summaryId}" class="lt-summary-text" readonly rows="8" spellcheck="false" data-summary${attrs(
    { lang: ctx.lesson.language === 'en' ? undefined : ctx.lesson.language },
  )}>${[SUMMARY_FIRST_LINE, `Lesson: ${ctx.lesson.title}`, `Lesson id: ${ctx.lesson.id}`, 'No results are recorded yet.'].join('\n')}</textarea><p><button type="button" class="lt-btn lt-copy" data-copy="${summaryId}" hidden>Copy summary for your agent</button></p></div>`;

  return html`<div class="lt-scene-body"><div class="lt-text-col lt-recap"><ol class="lt-takeaways" data-narration="${scene.id}">${takeaways}</ol>${practice}${next}${summary}</div></div>`;
}

function body(scene: AnyScene, ctx: RenderContext): Html {
  switch (scene.kind) {
    case 'clip':
      return clipBody(scene, ctx);
    case 'narration':
      return narrationBody(scene, ctx);
    case 'step_through':
      return stepThroughBody(scene, ctx);
    case 'checkpoint':
      return checkpointBody(scene, ctx);
    case 'recap':
      return recapBody(scene, ctx);
    default:
      return EMPTY;
  }
}

/**
 * A short digest of one scene's content: the same scene always gives the same twelve characters,
 * and any change to it gives others. Not a security measure; it only lets the player tell that
 * what it stored was about this version of the scene.
 */
export function sceneRev(scene: AnyScene): string {
  try {
    return sha256Hex(utf8(canonicalJson(scene))).slice(0, 12);
  } catch {
    // Only a value JSON cannot hold gets here, and a lesson read from a file never has one.
    return 'none';
  }
}

/** One scene as a `<section>`. With scripting off every section is visible, in order: that is the transcript. */
export function renderScene(env: SceneEnv, scene: AnyScene, index: number): Html {
  const ctx = createContext(env, scene, index);
  const total = env.lesson.scenes.length;
  const headingId = sceneHeadingId(scene.id);
  const label = kindLabel(scene.kind);
  const checkpoint = scene.kind === 'checkpoint' ? scene : null;
  return html`<section class="lt-scene ${token(scene.kind, KINDS, 'narration', 'lt-kind-')} ${isWide(scene) ? token('wide', ['wide'], 'wide', 'lt-scene-') : null}" id="${internalId(
    scene.id,
    'scene',
  )}" data-scene="${scene.id}" data-kind="${scene.kind}" data-rev="${sceneRev(scene)}"${attrs({ 'data-objective': checkpoint?.objective, 'data-level': checkpoint?.level })} aria-labelledby="${headingId}"><header class="lt-scene-head"><h2 id="${headingId}" tabindex="-1"><span class="lt-kicker"${
    env.ui
  }>Scene ${index + 1} of ${total}${label ? html`<span class="lt-kicker-kind"> · ${label}</span>` : null}</span> <span class="lt-scene-title">${scene.title}</span></h2></header>${body(scene, ctx)}</section>`;
}
