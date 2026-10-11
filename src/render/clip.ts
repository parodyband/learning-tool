// A clip as static markup: what a teaching scene is at publish time, before any script runs, and
// all it ever is with scripting off. Read top to bottom it is a complete account of the clip: what
// it shows (the description), where its content comes from, every beat's caption with its source
// chips, every prediction as plain text with its answer in a disclosure, and what is on stage.
//
// The player (src/player/stage/) builds the moving stage from the clip's data, which is already in
// the page's one data element (script#lt-data, as part of the lesson). It does not copy this
// markup: it MOVES the beats into the caption strip under the stage and the provenance line onto
// the stage, so every caption, chip and source card exists once, with the id the renderer gave it.
//
//   div.lt-clip[data-clip=<sceneId>][data-stage=<kind>][data-mark][data-provenance]
//     p.lt-clip-desc                       the text alternative for the whole clip
//     p.lt-prov[data-provenance]           "Sourced" / "Worked example" / "Illustrative", the
//                                          stage's source chips; their cards follow it
//     ol.lt-beats
//       li.lt-beat[data-beat=<N>][data-gate]
//         div.lt-predict[data-predict]     when the beat carries a prediction: the same markup a
//                                          step's prediction has (render/steps.ts)
//         div.lt-predict.lt-pick[data-predict][data-pick]   when the prediction is answered by
//                                          tapping the picture: the question, and in the disclosure
//                                          the right part by name with why, and what a wrong tap is told
//         div.lt-cap[data-narration=<sceneId>.beat<N>][data-voice]   the caption: one block
//     div.lt-explore[data-explore]         when the clip hands the stage to the learner:
//       p.lt-explore-head                  "Your turn" and the prompt
//       div.lt-xp-control[data-control=<id>]   one per slider: its label, where it starts and its
//                                          range as text, and the range input itself, `hidden`
//                                          until the player wakes it (it does nothing without the script)
//       div.lt-xp-goal[data-goal]          the goal, and what reaching it shows in a disclosure
//       p.lt-actions[data-actions][hidden] "Replay the clip"
//     div.lt-onstage                       the stage's parts as text
//       (a `lines` or `timeline` stage: the account render/clip-kits-extra.ts writes;
//        a `frame` stage: the static frame from render/frame.ts)
import type { Beat, ClipScene, Explore, PickGate, Stage } from '../core/clip';
import type { Predict } from '../core/schema';
import { decimalsOf, format } from '../player/stage/explore';
import { tappableParts } from '../player/stage/tappable';
import { renderBlock } from './blocks';
import { renderLinesStage, renderTimelineStage } from './clip-kits-extra';
import { EMPTY, type Html, attrs, html } from './escape';
import { frameStageHtml } from './frame';
import { ASK, optionOrder, renderAnswer, renderChoiceKey, renderChoices, shuffleSeed } from './questions';
import type { RenderContext } from './scenes';
import { STEPS } from './steps';

/** Interface words written into the markup. */
export const CLIP = {
  sourced: 'Sourced',
  sourcedNote: 'What is on this stage comes from the cited passages.',
  worked: 'Worked example',
  workedNote: 'A worked example written by your agent.',
  illustrative: 'Illustrative',
  illustrativeNote: 'An illustration by your agent: the shape is the point, not the particulars.',
  beats: 'What happens, beat by beat',
  onStage: 'On stage',
  readouts: 'Read-outs',
  predict: STEPS.predict,
  custom: 'Custom animation',
  /** A prediction answered on the picture. */
  pickHow: 'Tap your answer on the picture.',
  pickRight: 'Correct answer:',
  pickAnyOf: 'Correct answer, any of:',
  pickOthers: 'Any other part:',
  watch: 'Watch what happens',
  /** Explore: the stage is the learner's. */
  yourTurn: 'Your turn',
  startsAt: 'starts at',
  from: 'from',
  to: 'to',
  goal: 'Goal',
  goalDone: 'Show what reaching the goal tells you',
  replay: 'Replay the clip',
  curves: 'Curves',
  points: 'Marked points',
} as const;

const STAGE_KINDS = ['sequence', 'cells', 'dots', 'chart', 'flow', 'words', 'lines', 'timeline', 'frame'] as const;
const PROVENANCES = ['sourced', 'worked', 'illustrative'] as const;

/** The narration segment id of a beat (0-based index): "<sceneId>.beat<N>", N from 1. */
export function beatSegment(sceneId: string, index: number): string {
  return `${sceneId}.beat${index + 1}`;
}

function provenance(stage: Stage, ctx: RenderContext): Html {
  const kind = (PROVENANCES as readonly string[]).includes(stage.provenance) ? stage.provenance : 'illustrative';
  const word = kind === 'sourced' ? CLIP.sourced : kind === 'worked' ? CLIP.worked : CLIP.illustrative;
  const note = kind === 'sourced' ? CLIP.sourcedNote : kind === 'worked' ? CLIP.workedNote : CLIP.illustrativeNote;
  const cited = ctx.cites(stage.cites ?? [], { path: 'stage' });
  return html`<p class="lt-prov" data-provenance="${kind}"><span class="lt-prov-word"${ctx.ui}>${word}</span><span class="lt-prov-note"${ctx.ui}> ${note}</span>${
    cited.chips === EMPTY ? null : html`&nbsp;${cited.chips}`
  }</p>${cited.popovers}`;
}

function prediction(ctx: RenderContext, p: Predict, n: number): Html {
  const order = optionOrder(p.options.length, shuffleSeed(ctx, `beat${n}`), false);
  const legend = html`<span class="lt-label lt-predict-kicker"${ctx.ui}>${CLIP.predict}</span> <span class="lt-predict-prompt">${ctx.inline(p.prompt)}</span>`;
  return html`<div class="lt-predict" data-predict>${renderChoices(ctx, { legend, prompt: p.prompt, lead: `${CLIP.predict}:`, options: p.options, order, name: ctx.own(`beat${n}-ask`) })}<p class="lt-actions" data-actions hidden${ctx.ui}><button type="button" class="lt-btn lt-btn-primary" data-act="check">${
    STEPS.checkPredict
  }</button><button type="button" class="lt-btn lt-btn-quiet" data-act="skip">${STEPS.skipPredict}</button></p><div class="lt-feedback lt-callout" data-outcome></div>${renderAnswer(ctx, ASK.answer, renderChoiceKey(ctx, p.options, order))}</div>`;
}

/**
 * A prediction answered by tapping a part of the picture. With no script it is the question, and
 * behind the disclosure the right part by name with the reason, and what a wrong tap is told.
 */
function pick(scene: ClipScene, ctx: RenderContext, p: PickGate): Html {
  const named = new Map(tappableParts(scene).map((part) => [part.id, part.label]));
  const right = p.pick.map((id) => named.get(id) ?? id);
  return html`<div class="lt-predict lt-pick" data-predict data-pick><p class="lt-prompt"><span class="lt-label lt-predict-kicker"${ctx.ui}>${CLIP.predict}</span> <span class="lt-predict-prompt">${ctx.inline(
    p.prompt,
  )}</span></p><p class="lt-pick-how" data-how hidden${ctx.ui}>${CLIP.pickHow}</p><p class="lt-actions" data-actions hidden${ctx.ui}><button type="button" class="lt-btn lt-btn-primary" data-act="check" hidden>${
    CLIP.watch
  }</button><button type="button" class="lt-btn lt-btn-quiet" data-act="skip">${STEPS.skipPredict}</button></p><div class="lt-feedback lt-callout" data-outcome></div>${renderAnswer(
    ctx,
    ASK.answer,
    html`<ul class="lt-key"><li><p class="lt-key-option"><span class="lt-key-verdict"${ctx.ui}>${right.length > 1 ? CLIP.pickAnyOf : CLIP.pickRight}</span> <span data-right-part>${right.join('; ')}</span></p><p class="lt-key-why" data-right>${ctx.inline(
      p.right,
    )}</p></li><li><p class="lt-key-option"><span class="lt-key-verdict"${ctx.ui}>${CLIP.pickOthers}</span></p><p class="lt-key-why" data-wrong>${ctx.inline(p.wrong)}</p></li></ul>`,
  )}</div>`;
}

/**
 * Explore as text: the prompt, each slider with where it starts and how far it goes, the goal, and
 * what reaching it shows. The range inputs are in the markup with their ids and their starting
 * values, hidden: a slider that moves nothing is not offered.
 */
function explore(ctx: RenderContext, x: Explore): Html {
  const controls = x.controls.map((c, i) => {
    const dp = Math.max(decimalsOf(c.step), decimalsOf(c.min));
    const unit = c.unit ?? '';
    // Numbered, not named after the control: a control's id may hold characters a DOM id made here may not.
    const id = ctx.own(`xp-${i + 1}`);
    return html`<div class="lt-xp-control" data-control="${c.id}"><label class="lt-xp-label" for="${id}">${c.label}</label><span class="lt-xp-now"><span class="lt-xp-word"${ctx.ui}>${CLIP.startsAt} </span><span class="lt-xp-value" data-value>${format(
      c.value,
      dp,
    )}</span><span class="lt-xp-unit">${unit}</span></span><input class="lt-xp-range" type="range" id="${id}" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}" hidden><span class="lt-xp-bounds"><span class="lt-xp-word"${
      ctx.ui
    }>${CLIP.from} </span><span data-min>${format(c.min, dp)}${unit}</span><span class="lt-xp-word"${ctx.ui}> ${CLIP.to} </span><span data-max>${format(c.max, dp)}${unit}</span></span></div>`;
  });
  const goal = x.goal
    ? html`<div class="lt-xp-goal" data-goal><p class="lt-xp-goal-text"><span class="lt-label lt-xp-goal-kicker"${ctx.ui}>${CLIP.goal}</span> <span class="lt-xp-goal-words">${ctx.inline(x.goal.text)}</span></p>${renderAnswer(
        ctx,
        CLIP.goalDone,
        html`<p class="lt-xp-done" data-done>${ctx.inline(x.goal.done)}</p>`,
      )}</div>`
    : null;
  return html`<div class="lt-explore" data-explore><p class="lt-explore-head"><span class="lt-label lt-explore-kicker"${ctx.ui}>${CLIP.yourTurn}</span> <span class="lt-explore-prompt">${ctx.inline(
    x.prompt,
  )}</span></p><div class="lt-xp-controls">${controls}</div>${goal}<p class="lt-actions lt-xp-actions" data-actions hidden${ctx.ui}><button type="button" class="lt-btn lt-btn-quiet" data-act="replay">${CLIP.replay}</button></p></div>`;
}

function beat(scene: ClipScene, b: Beat, i: number, ctx: RenderContext): Html {
  const n = i + 1;
  const segment = beatSegment(scene.id, i);
  const gate = !b.gate ? null : 'options' in b.gate ? prediction(ctx, b.gate, n) : pick(scene, ctx, b.gate);
  return html`<li class="lt-beat" data-beat="${n}"${attrs({ 'data-gate': b.gate ? 'true' : undefined })}>${gate}<div class="lt-cap" data-narration="${segment}"${attrs({
    'data-voice': ctx.hasClip(segment) ? 'true' : undefined,
  })}>${renderBlock(b.caption, ctx, `beats[${i}].caption`)}</div></li>`;
}

const number = (n: number): string => (Number.isFinite(n) ? n.toLocaleString('en-US') : String(n));
const list = (items: readonly Html[]): Html => (items.length ? html`<ul class="lt-parts">${items.map((item) => html`<li>${item}</li>`)}</ul>` : EMPTY);

/** The stage's parts as sentences and lists: everything a learner would see on it, in words. */
function parts(stage: Stage, ctx: RenderContext): Html {
  const out: Html[] = [];
  switch (stage.kind) {
    case 'sequence': {
      const name = new Map(stage.actors.map((a) => [a.id, a.label]));
      out.push(list(stage.actors.map((a) => html`${a.label}`)));
      out.push(list(stage.messages.map((m) => html`${m.label}: ${name.get(m.from) ?? m.from} → ${name.get(m.to) ?? m.to}`)));
      break;
    }
    case 'cells':
      out.push(html`<p class="lt-parts-row">${stage.cells.map((c) => c.label).join(', ')}</p>`);
      out.push(list([...(stage.pointers ?? []).map((p) => html`${p.label}`), ...(stage.brackets ?? []).filter((b) => b.label).map((b) => html`${b.label ?? ''}`)]));
      break;
    case 'dots':
      out.push(list([html`${stage.group.label}: ${number(stage.total)}`, ...(stage.legend ? [html`${stage.legend}`] : [])]));
      break;
    case 'chart':
      if (stage.yLabel) out.push(html`<p class="lt-parts-row">${stage.yLabel}</p>`);
      if (stage.mark === 'bars') out.push(list(stage.bars.map((b) => html`${b.label}: ${number(b.value)}${stage.unit ?? ''}`)));
      else if (stage.mark === 'line') out.push(list(stage.series.map((q) => html`${q.label}: ${q.values.map((v, i) => `${stage.xs[i] ?? ''} ${number(v)}${stage.unit ?? ''}`).join(', ')}`)));
      else {
        // A function plot: what runs along the bottom, the curves by name, and the places marked on them.
        const name = new Map(stage.curves.map((q) => [q.id, q.label]));
        out.push(html`<p class="lt-parts-row">${stage.x.label}: ${number(stage.x.min)}${stage.x.unit ?? ''} <span${ctx.ui}>${CLIP.to}</span> ${number(stage.x.max)}${stage.x.unit ?? ''}</p>`);
        out.push(html`<p class="lt-label lt-parts-h"${ctx.ui}>${CLIP.curves}</p>${list(stage.curves.map((q) => html`${q.label}`))}`);
        const points = stage.points ?? [];
        if (points.length) out.push(html`<p class="lt-label lt-parts-h"${ctx.ui}>${CLIP.points}</p>${list(points.map((p) => html`${p.label} (${name.get(p.on ?? stage.curves[0]?.id ?? '') ?? ''})`))}`);
      }
      break;
    case 'flow': {
      const name = new Map(stage.nodes.map((n) => [n.id, n.label]));
      out.push(list(stage.nodes.map((n) => html`${n.label}`)));
      out.push(list(stage.edges.map((e) => html`${name.get(e.from) ?? e.from} → ${name.get(e.to) ?? e.to}${e.label ? `: ${e.label}` : ''}`)));
      break;
    }
    case 'words':
      out.push(list(stage.lines.map((l) => html`${l.text}`)));
      break;
    case 'lines':
      out.push(renderLinesStage(stage, ctx));
      break;
    case 'timeline':
      out.push(renderTimelineStage(stage, ctx));
      break;
    default:
      break;
  }
  const stats = 'stats' in stage ? (stage.stats ?? []) : [];
  if (stats.length) {
    out.push(html`<p class="lt-label lt-parts-h"${ctx.ui}>${CLIP.readouts}</p>${list(stats.map((st) => html`${st.label}: ${typeof st.value === 'number' ? number(st.value) : st.value}${st.unit ?? ''}`))}`);
  }
  return html`${out}`;
}

/** The body of a clip scene (the shell renders the section and its heading), as Html for the shell to place. */
export function clipBody(scene: ClipScene, ctx: RenderContext): Html {
  const stage = scene.stage;
  const kind = (STAGE_KINDS as readonly string[]).includes(stage.kind) ? stage.kind : 'words';
  const onStage =
    stage.kind === 'frame'
      ? html`<div class="lt-onstage" data-custom>${frameStageHtml(stage, ctx, { description: scene.description, label: scene.title })}</div>`
      : html`<div class="lt-onstage"><p class="lt-label"${ctx.ui}>${CLIP.onStage}</p>${parts(stage, ctx)}</div>`;
  return html`<div class="lt-scene-body"><div class="lt-clip" data-clip="${scene.id}" data-stage="${kind}"${attrs({
    'data-mark': stage.kind === 'chart' ? stage.mark : undefined,
    'data-pace': scene.pace,
  })}><p class="lt-clip-desc" id="${ctx.own('desc')}">${scene.description}</p>${provenance(stage, ctx)}<p class="lt-label lt-beats-h" id="${ctx.own('beats')}"${ctx.ui}>${CLIP.beats}</p><ol class="lt-beats" aria-labelledby="${ctx.own(
    'beats',
  )}">${scene.beats.map((b, i) => beat(scene, b, i, ctx))}</ol>${scene.explore && stage.kind !== 'frame' ? explore(ctx, scene.explore) : null}${onStage}</div></div>`;
}

/** The same as a string that is safe to place in the page as it is, like the other scene renderers return. */
export function renderClip(scene: ClipScene, ctx: RenderContext): string {
  return clipBody(scene, ctx).toString();
}
