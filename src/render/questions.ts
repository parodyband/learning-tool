// Checkpoint questions as static markup. The player (src/player/questions.ts) makes them
// interactive; nothing here depends on it.
//
// One representation, read two ways:
//   - With no script a question is its prompt, what there is to choose from as plain text, an
//     optional hint, and the answer behind a native <details>. Every control that needs the script
//     (radio, text field, button) carries `hidden`, so nothing is offered that cannot work.
//   - The player removes those `hidden` attributes, takes the per-option feedback and the
//     explanation out of the <details>, and shows them only after an attempt.
//
// The order of the options is decided here, not in the browser: it is seeded from the receipt's
// hash, so one published lesson always shows one order, with or without the script.
//
// Hooks the player relies on (all inside `div.lt-question[data-question=<type>]`):
//   [data-earlier]             a line for "you answered this before", empty until the player fills it
//   label.lt-option[data-option=<i>] > input[type=radio]   i is the option's index in the lesson
//   ol.lt-order > li[data-item=<i>]  with  [data-moves] > button[data-move=up|down];  [data-how]
//   p.lt-numeric > input.lt-number;  [data-write] > textarea.lt-reflect-text
//                              (both carry what they need to be typed into: inputmode, autocomplete
//                              and the rest are in the markup, so the player adds no attribute)
//   [data-actions] > button[data-act=check|again|reveal]
//   div.lt-feedback[role=status]    the question's one status region, empty here
//   div.lt-explain[data-explain]    empty here: where the explanation is shown once it is earned
//   details.lt-answer[data-answer]  the no-script answer; inside it [data-feedback=<i>],
//                                   [data-solution], [data-explanation], [data-model]
//   fieldset.lt-rate[data-rate]     the self-rating of a reflect question
//
// Names. A browser does not read MathML when it works out a control's name from its label, so an
// option that is only `$2^3$` would be a radio with no name, and a prompt would lose its formula.
// Wherever lesson text names a control or a group and holds math, the name is also given in words
// (`nameAttrs`). Text without math is left to name the control itself, so what is seen and what is
// announced stay the same string.
//
// A `misconception` is for the validator and the agent. It is never written into the page.
import { mathSpans, plainText } from '../core/markup';
import type { NumericQuestion, OrderQuestion, Question, ReflectQuestion, SingleQuestion } from '../core/schema';
import { type Attrs, EMPTY, type Html, attrs, html } from './escape';
import type { RenderContext } from './scenes';

/** Interface words written into the markup. The player has its own for what it says after an attempt. */
export const ASK = {
  answer: 'Show the answer',
  hint: 'Need a hint?',
  check: 'Check answer',
  again: 'Try this question again',
  why: 'Why',
  right: 'Correct answer:',
  wrong: 'Not this one:',
  orderHow: 'Use the arrow buttons beside each item to move it up or down.',
  orderAnswer: 'Correct order',
  moveUp: 'Move up',
  moveDown: 'Move down',
  unitLead: 'Answer in:',
  numericAnswer: 'Answer',
  reflectHow: 'This one is not graded. Answer in your own words first, then compare with the model answer.',
  reflectPrivate: 'What you write stays on this page. It is not saved and it is not sent anywhere.',
  reveal: 'Show the model answer',
  model: 'A model answer',
  lookFor: 'What to look for in your answer',
  rate: 'How close was your answer?',
  rateKept: 'Your rating is shown in the recap. You can change it.',
} as const;

export const RATINGS = [
  { value: 'yes', label: 'Got it' },
  { value: 'partly', label: 'Partly' },
  { value: 'no', label: 'Not yet' },
] as const;

const ICON_UP = html`<svg class="lt-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="M10 16V4.5M5 9l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_DOWN = html`<svg class="lt-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="M10 4v11.5M5 11l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ---------------------------------------------------------------------------------------------
// Order: a shuffle that depends only on the lesson
// ---------------------------------------------------------------------------------------------

/** FNV-1a over the UTF-16 units of a string: a 32-bit seed. */
function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The positions 0..count-1 in an order fixed by `seed` (mulberry32 driving a Fisher-Yates shuffle).
 * The same seed always gives the same order, on every machine.
 */
export function shuffledOrder(count: number, seed: string): number[] {
  let state = seedOf(seed);
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const held = order[i] as number;
    order[i] = order[j] as number;
    order[j] = held;
  }
  return order;
}

/** The seed for one shuffle: the lesson's hash, the scene, and which list inside it. */
export function shuffleSeed(ctx: RenderContext, part: string): string {
  return `${ctx.receipt.hash}/${ctx.scene.id}/${part}`;
}

/** The order options are shown in: shuffled, or as written when the author fixed it. */
export function optionOrder(count: number, seed: string, fixed: boolean): number[] {
  return fixed ? Array.from({ length: count }, (_, i) => i) : shuffledOrder(count, seed);
}

/**
 * The order the items of an ordering question start in. Never the answer itself: a shuffle that
 * happens to land on it is rotated until the texts read differently. Compared by text, so two
 * items with the same words cannot hide a solved start.
 */
export function startOrder(items: readonly string[], seed: string): number[] {
  const order = shuffledOrder(items.length, seed);
  const solved = (): boolean => order.every((from, at) => items[from] === items[at]);
  for (let turn = 1; turn < order.length && solved(); turn++) order.push(order.shift() as number);
  return order;
}

// ---------------------------------------------------------------------------------------------
// Pieces shared with the predict question of a step (render/steps.ts)
// ---------------------------------------------------------------------------------------------

/** Whether a prose string holds math that will be drawn as MathML. */
export function hasMath(src: string): boolean {
  return mathSpans(src).length > 0;
}

/**
 * `aria-label` for a control or group that lesson text names, when that text holds math; nothing
 * otherwise. `lead` is interface text that is part of the visible name ("Predict first").
 */
export function nameAttrs(src: string, lead = ''): Attrs {
  if (!hasMath(src)) return attrs({});
  const name = plainText(src).replace(/\s+/g, ' ').trim();
  return attrs({ 'aria-label': lead ? `${lead} ${name}` : name });
}

export interface ChoiceOption {
  text: string;
  correct: boolean;
  feedback: string;
}

/**
 * Radios in a fieldset whose legend is the prompt. The inputs stay hidden until the player takes
 * over, so with no script this reads as the question and its options.
 */
export function renderChoices(ctx: RenderContext, o: { legend: Html; prompt: string; lead?: string; options: readonly ChoiceOption[]; order: readonly number[]; name: string }): Html {
  return html`<fieldset class="lt-choices"${nameAttrs(o.prompt, o.lead)}><legend class="lt-prompt">${o.legend}</legend><div class="lt-options">${o.order.map((i) => {
    const option = o.options[i];
    return option
      ? html`<label class="lt-option" data-option="${i}"><input type="radio" name="${o.name}" value="${i}"${nameAttrs(option.text)} hidden><span class="lt-option-text">${ctx.inline(option.text)}</span></label>`
      : null;
  })}</div></fieldset>`;
}

/** Every option with whether it is the answer and why: the no-script answer, and where the player finds each option's feedback. */
export function renderChoiceKey(ctx: RenderContext, options: readonly ChoiceOption[], order: readonly number[]): Html {
  return html`<ul class="lt-key">${order.map((i) => {
    const option = options[i];
    return option
      ? html`<li><p class="lt-key-option"><span class="lt-key-verdict"${ctx.ui}>${option.correct === true ? ASK.right : ASK.wrong}</span> ${ctx.inline(option.text)}</p><p class="lt-key-why" data-feedback="${i}">${ctx.inline(option.feedback)}</p></li>`
      : null;
  })}</ul>`;
}

/** The native disclosure that holds an answer when there is no script. */
export function renderAnswer(ctx: RenderContext, summary: string, body: Html): Html {
  return html`<details class="lt-reveal lt-answer" data-answer><summary${ctx.ui}>${summary}</summary><div class="lt-reveal-body">${body}</div></details>`;
}

// ---------------------------------------------------------------------------------------------
// The four question types
// ---------------------------------------------------------------------------------------------

/** A paragraph of lesson text that ends with its source chips, followed by their popovers. */
function cited(ctx: RenderContext, text: string, cites: readonly string[], path: string): Html {
  const c = ctx.cites(cites, { path });
  return html`<p>${ctx.inline(text)}${c.chips === EMPTY ? null : html`&nbsp;${c.chips}`}</p>${c.popovers}`;
}

function why(ctx: RenderContext, explanation: { text: string; cites: readonly string[] }): Html {
  return html`<div class="lt-why" data-explanation><p class="lt-label"${ctx.ui}>${ASK.why}</p>${cited(ctx, explanation.text, explanation.cites, 'question.explanation')}</div>`;
}

function hint(ctx: RenderContext, text: string | undefined): Html {
  return text ? html`<details class="lt-reveal lt-hint"><summary${ctx.ui}>${ASK.hint}</summary><div class="lt-reveal-body"><p>${ctx.inline(text)}</p></div></details>` : EMPTY;
}

const earlier = html`<p class="lt-earlier" data-earlier hidden></p>`;

/** Check and, once the question is finished, a way to practise it again. Then the status region and the place the explanation appears. */
function gradedTail(ctx: RenderContext): Html {
  return html`<p class="lt-actions" data-actions hidden${ctx.ui}><button type="button" class="lt-btn lt-btn-primary" data-act="check">${ASK.check}</button><button type="button" class="lt-btn lt-btn-quiet" data-act="again" hidden>${ASK.again}</button></p><div class="lt-feedback lt-callout" role="status" id="${ctx.own(
    'ask-status',
  )}"></div><div class="lt-explain" data-explain hidden></div>`;
}

function single(q: SingleQuestion, ctx: RenderContext): Html {
  const order = optionOrder(q.options.length, shuffleSeed(ctx, 'ask'), q.fixedOrder === true);
  return html`<div class="lt-question" data-question="single">${earlier}${renderChoices(ctx, { legend: ctx.inline(q.prompt), prompt: q.prompt, options: q.options, order, name: ctx.own('ask') })}${hint(ctx, q.hint)}${gradedTail(ctx)}${renderAnswer(
    ctx,
    ASK.answer,
    html`${renderChoiceKey(ctx, q.options, order)}${why(ctx, q.explanation)}`,
  )}</div>`;
}

function order(q: OrderQuestion, ctx: RenderContext): Html {
  const promptId = ctx.own('ask-prompt');
  const start = startOrder(q.items, shuffleSeed(ctx, 'ask'));
  return html`<div class="lt-question" data-question="order">${earlier}<p class="lt-prompt" id="${promptId}">${ctx.inline(q.prompt)}</p><p class="lt-order-how" data-how hidden${ctx.ui}>${ASK.orderHow}</p><ol class="lt-order" role="list"${hasMath(q.prompt) ? nameAttrs(q.prompt) : attrs({ 'aria-labelledby': promptId })}>${start.map(
    (i) => {
      const item = q.items[i];
      if (item === undefined) return null;
      const name = plainText(item);
      return html`<li class="lt-order-item" data-item="${i}"><span class="lt-order-text">${ctx.inline(item)}</span><span class="lt-order-moves" data-moves hidden><button type="button" class="lt-btn lt-move" data-move="up" aria-label="${ASK.moveUp}: ${name}"${
        ctx.ui
      }>${ICON_UP}</button><button type="button" class="lt-btn lt-move" data-move="down" aria-label="${ASK.moveDown}: ${name}"${ctx.ui}>${ICON_DOWN}</button></span></li>`;
    },
  )}</ol>${hint(ctx, q.hint)}${gradedTail(ctx)}${renderAnswer(
    ctx,
    ASK.answer,
    html`<div class="lt-solution" data-solution><p class="lt-label"${ctx.ui}>${ASK.orderAnswer}</p><ol class="lt-key-order">${q.items.map((item) => html`<li>${ctx.inline(item)}</li>`)}</ol></div>${why(ctx, q.explanation)}`,
  )}</div>`;
}

/**
 * A number as the lesson gives it: the shortest digits that name it, the same characters in every
 * locale, and something the field itself would accept. Nothing is rounded, so the answer shown is
 * the answer graded (2^40 is 1099511627776, not 1099511627780).
 */
export function showNumber(n: number): string {
  return typeof n === 'number' && Number.isFinite(n) ? String(n) : '';
}

/** A finite number as whole `units` of 10^-scale, read from the digits that name it: 0.1 is one tenth, not its nearest binary fraction. */
function decimalOf(n: number): { units: bigint; scale: number } | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(showNumber(n));
  if (!m) return null;
  const fraction = m[3] ?? '';
  let units = BigInt(`${m[1]}${m[2]}${fraction}`);
  let scale = fraction.length - Number(m[4] ?? 0);
  // Beyond this the number is written with an exponent anyway, and the sum below would be hundreds of digits.
  if (Math.abs(scale) > 30) return null;
  if (scale < 0) {
    units *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { units, scale };
}

/**
 * `a + b` in decimal, as digits. Adding the two as binary numbers leaves noise (0.1 + 0.2), and
 * trimming the noise to a fixed number of digits misprints a large answer; the digits the lesson
 * wrote add exactly.
 */
export function showSum(a: number, b: number): string {
  const x = decimalOf(a);
  const y = decimalOf(b);
  if (!x || !y) return showNumber(a + b);
  const scale = Math.max(x.scale, y.scale);
  const total = x.units * 10n ** BigInt(scale - x.scale) + y.units * 10n ** BigInt(scale - y.scale);
  const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
  return `${total < 0n ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function numeric(q: NumericQuestion, ctx: RenderContext): Html {
  const inputId = ctx.own('ask-input');
  const unitId = ctx.own('ask-unit');
  const tolerance = typeof q.tolerance === 'number' && q.tolerance > 0 ? q.tolerance : 0;
  return html`<div class="lt-question" data-question="numeric">${earlier}<p class="lt-prompt"><label for="${inputId}">${ctx.inline(q.prompt)}</label></p><p class="lt-numeric"${attrs({ hidden: !q.unit })}><input type="text" class="lt-field lt-number" id="${inputId}" inputmode="decimal" autocomplete="off" autocapitalize="off" enterkeyhint="done" spellcheck="false"${nameAttrs(
    q.prompt,
  )}${attrs({ 'aria-describedby': q.unit ? unitId : undefined })} hidden>${q.unit ? html`<span class="lt-unit-lead"${ctx.ui}>${ASK.unitLead} </span><span class="lt-unit" id="${unitId}">${q.unit}</span>` : null}</p>${hint(ctx, q.hint)}${gradedTail(ctx)}${renderAnswer(
    ctx,
    ASK.answer,
    html`<div class="lt-solution" data-solution><p><span class="lt-label"${ctx.ui}>${ASK.numericAnswer}</span> <strong class="lt-solution-value">${showNumber(q.answer)}${q.unit ? html` ${q.unit}` : null}</strong></p>${
      tolerance > 0 ? html`<p class="lt-solution-range"${ctx.ui}>Anything from ${showSum(q.answer, -tolerance)} to ${showSum(q.answer, tolerance)} counts as right.</p>` : null
    }</div>${why(ctx, q.explanation)}`,
  )}</div>`;
}

function reflect(q: ReflectQuestion, ctx: RenderContext): Html {
  const textId = ctx.own('ask-input');
  const lookId = ctx.own('ask-look');
  const rateName = ctx.own('ask-rate');
  // The status region comes last here: each thing it says (write first, compare, rating kept) then sits directly under the control that caused it.
  return html`<div class="lt-question" data-question="reflect">${earlier}<p class="lt-prompt"><label for="${textId}">${ctx.inline(q.prompt)}</label></p><p class="lt-reflect-how"${ctx.ui}>${
    ASK.reflectHow
  }</p><div class="lt-reflect-write" data-write hidden><textarea class="lt-field lt-reflect-text" id="${textId}" rows="5" autocomplete="off" spellcheck="true"${nameAttrs(q.prompt)}></textarea><p class="lt-private"${ctx.ui}>${
    ASK.reflectPrivate
  }</p></div><p class="lt-actions" data-actions hidden${ctx.ui}><button type="button" class="lt-btn lt-btn-primary" data-act="reveal">${
    ASK.reveal
  }</button></p><div class="lt-explain" data-explain hidden></div><fieldset class="lt-rate" data-rate hidden${ctx.ui}><legend class="lt-label">${ASK.rate}</legend><div class="lt-rate-options">${RATINGS.map(
    (r) => html`<label class="lt-rate-option"><input type="radio" name="${rateName}" value="${r.value}"><span>${r.label}</span></label>`,
  )}</div><p class="lt-rate-kept">${ASK.rateKept}</p></fieldset><div class="lt-feedback lt-callout" role="status" id="${ctx.own('ask-status')}"></div>${renderAnswer(
    ctx,
    ASK.reveal,
    html`<div class="lt-model" data-model><p class="lt-label"${ctx.ui}>${ASK.model}</p>${cited(ctx, q.modelAnswer.text, q.modelAnswer.cites, 'question.modelAnswer')}<p class="lt-label" id="${lookId}"${ctx.ui}>${
      ASK.lookFor
    }</p><ul class="lt-lookfor" aria-labelledby="${lookId}">${q.lookFor.map((item) => html`<li><label class="lt-look"><input type="checkbox"${nameAttrs(item)} hidden><span>${ctx.inline(item)}</span></label></li>`)}</ul></div>`,
  )}</div>`;
}

/** A checkpoint question. Returns a string of HTML that is safe to place in the page as it is. */
export function renderQuestion(question: Question, ctx: RenderContext): string {
  switch (question.type) {
    case 'single':
      return single(question, ctx).toString();
    case 'order':
      return order(question, ctx).toString();
    case 'numeric':
      return numeric(question, ctx).toString();
    case 'reflect':
      return reflect(question, ctx).toString();
    default:
      // A type this version does not know is left out, like a scene of an unknown kind.
      return '';
  }
}
