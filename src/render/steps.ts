// The steps of a step-through scene as static markup. The player (src/player/steps.ts) shows them
// one at a time; nothing here depends on it.
//
// With no script every step is on the page in order: its number and title, its predict question as
// plain text with the answer behind a native <details>, its text, and its state with the values
// that changed since the step before marked in words. The controls that need the script (Previous,
// Next, the one status region, the panel that follows the state) are in the markup with `hidden`.
//
// Hooks the player relies on (all inside `div.lt-steps[data-steps=<sceneId>]`):
//   [data-step-nav] > button[data-step-go=prev|next], p[role=status]   the scene's one status region
//   [data-state-panel] > dl             filled by the player from the step on show
//   li.lt-step[data-step=<N>][data-highlight="<part ids>"][data-narration=<sceneId>.step<N>]
//     div.lt-predict[data-predict]      label.lt-option[data-option=<i>], [data-actions],
//                                       [data-outcome], details[data-answer] with [data-feedback=<i>]
//     div.lt-step-body[data-step-body]  what a predict holds back
//       div.lt-state-box[data-state] > dl.lt-state > div.lt-state-row[data-changed]
import type { Predict, Step, StepThroughScene } from '../core/schema';
import { EMPTY, type Html, attrs, html, token } from './escape';
import { ASK, optionOrder, renderAnswer, renderChoiceKey, renderChoices, shuffleSeed } from './questions';
import type { RenderContext } from './scenes';

/** Interface words written into the markup. */
export const STEPS = {
  nav: 'Steps',
  previous: 'Previous step',
  next: 'Next step',
  predict: 'Predict first',
  checkPredict: 'Check my prediction',
  skipPredict: 'Skip the question',
  stateNow: 'Values now',
  stateAfter: 'Values after this step',
  changed: 'changed, ',
  was: 'was',
  isNew: 'new',
} as const;

const ICON_PREV = html`<svg class="lt-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_NEXT = html`<svg class="lt-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

type StateRow = NonNullable<Step['state']>[number];

/**
 * The state of one step. A value that differs from the one the same label had in the last step
 * that showed any state is marked in words ("was 0"), and a label that was not there is marked
 * "new", so the change does not depend on seeing a colour.
 */
function stateBox(ctx: RenderContext, rows: readonly StateRow[], before: ReadonlyMap<string, string> | null): Html {
  return html`<div class="lt-state-box" data-state><p class="lt-label"${ctx.ui}>${STEPS.stateAfter}</p><dl class="lt-state">${rows.map((row) => {
    const was = before?.get(row.label);
    const changed = before !== null && was !== row.value;
    return html`<div class="lt-state-row"${attrs({ 'data-changed': changed ? 'true' : undefined })}><dt>${row.label}</dt><dd><span class="lt-state-value">${row.value}</span>${
      changed
        ? html` <span class="lt-state-flag"><span class="lt-vh"${ctx.ui}>${STEPS.changed}</span>${was === undefined ? html`<span${ctx.ui}>${STEPS.isNew}</span>` : html`<span${ctx.ui}>${STEPS.was}</span> ${was}`}</span>`
        : null
    }</dd></div>`;
  })}</dl></div>`;
}

function predict(ctx: RenderContext, p: Predict, n: number): Html {
  const order = optionOrder(p.options.length, shuffleSeed(ctx, `step${n}`), false);
  const legend = html`<span class="lt-label lt-predict-kicker"${ctx.ui}>${STEPS.predict}</span> <span class="lt-predict-prompt">${ctx.inline(p.prompt)}</span>`;
  return html`<div class="lt-predict" data-predict>${renderChoices(ctx, { legend, prompt: p.prompt, lead: `${STEPS.predict}:`, options: p.options, order, name: ctx.own(`step${n}-ask`) })}<p class="lt-actions" data-actions hidden${ctx.ui}><button type="button" class="lt-btn lt-btn-primary" data-act="check">${
    STEPS.checkPredict
  }</button><button type="button" class="lt-btn lt-btn-quiet" data-act="skip">${STEPS.skipPredict}</button></p><div class="lt-feedback lt-callout" data-outcome></div>${renderAnswer(ctx, ASK.answer, renderChoiceKey(ctx, p.options, order))}</div>`;
}

/** The steps of a step-through scene (the shell renders the heading, the intro and the figure). Returns a string of HTML that is safe to place in the page as it is. */
export function renderSteps(scene: StepThroughScene, ctx: RenderContext): string {
  const total = scene.steps.length;
  const panelId = ctx.own('steps-state');
  let before: Map<string, string> | null = null;

  const steps = scene.steps.map((step, i) => {
    const n = i + 1;
    const rows = step.state ?? [];
    let state: Html = EMPTY;
    if (rows.length > 0) {
      state = stateBox(ctx, rows, before);
      // The first value given for a label is the one shown, so it is the one compared against.
      const now = new Map<string, string>();
      for (const row of rows) if (!now.has(row.label)) now.set(row.label, row.value);
      before = now;
    }
    return html`<li class="lt-step" data-step="${n}" data-highlight="${step.highlight.join(' ')}" data-narration="${scene.id}.step${n}"><h3 class="lt-step-title ${
      step.title ? null : token('untitled', ['untitled'], 'untitled', 'lt-step-')
    }"><span class="lt-label lt-step-count"${ctx.ui}>Step ${n} of ${total}</span>${step.title ? html` <span class="lt-step-name">${step.title}</span>` : null}</h3>${
      step.predict ? predict(ctx, step.predict, n) : null
    }<div class="lt-step-body" data-step-body>${ctx.blocks(step.blocks, `steps[${i}].blocks`)}${state}</div></li>`;
  });

  return html`<div class="lt-steps" data-steps="${scene.id}"><div class="lt-step-nav" data-step-nav role="group" aria-label="${STEPS.nav}" hidden${ctx.ui}><button type="button" class="lt-btn lt-btn-small lt-btn-quiet" data-step-go="prev" aria-keyshortcuts="ArrowLeft" aria-disabled="true">${ICON_PREV}${
    STEPS.previous
  }</button><button type="button" class="lt-btn lt-btn-small" data-step-go="next" aria-keyshortcuts="ArrowRight">${STEPS.next}${ICON_NEXT}</button><p class="lt-step-status" role="status" id="${ctx.own(
    'steps-status',
  )}"></p></div><div class="lt-state-panel" data-state-panel role="group" aria-labelledby="${panelId}" hidden><p class="lt-label" id="${panelId}"${ctx.ui}>${STEPS.stateNow}</p><dl class="lt-state"></dl></div><ol class="lt-step-list">${steps}</ol></div>`.toString();
}
