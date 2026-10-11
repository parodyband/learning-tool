// Checkpoint questions as static markup: what a learner with no script reads, what the player is
// handed to work with, and what must never be on show before an attempt.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_QUESTIONS } from '../../src/core/examples';
import { type CheckpointScene, type NumericQuestion, type OrderQuestion, Question, type ReflectQuestion, type SingleQuestion } from '../../src/core/schema';
import type { Published } from '../../src/core/types';
import { renderLessonHtml } from '../../src/render/index';
import { ASK, RATINGS, hasMath, optionOrder, renderQuestion, showNumber, showSum, shuffledOrder, startOrder } from '../../src/render/questions';
import { createContext } from '../../src/render/scenes';
import { WEAK_MATCH_LINE, sourceBook } from '../../src/render/sources';
import { attrs } from '../../src/render/escape';
import { EXAMPLE_HASH, examplePublished, exampleReceipt } from '../helpers/example';
import { ALLOWED_TAGS, PAYLOADS, type Scanned, type Tag, attrAllowed, elements, scan } from './helpers';

const base = examplePublished();
const checkpointOf = (p: Published, type: string): CheckpointScene => p.lesson.scenes.find((s): s is CheckpointScene => s.kind === 'checkpoint' && s.question.type === type) as CheckpointScene;
const SINGLE = checkpointOf(base, 'single');
const NUMERIC = checkpointOf(base, 'numeric');
const ORDER = checkpointOf(base, 'order');
const single = SINGLE.question as SingleQuestion;
const numeric = NUMERIC.question as NumericQuestion;
const order = ORDER.question as OrderQuestion;
const reflect = Question.parse(EXAMPLE_QUESTIONS.reflect) as ReflectQuestion;

/** The example lesson with one checkpoint's question replaced, and any receipt fields given. */
function lesson(change: (p: Published) => void = () => {}, receipt: Parameters<typeof exampleReceipt>[0] = {}): Published {
  const p = examplePublished({ receipt: exampleReceipt(receipt) });
  change(p);
  return p;
}
function setQuestion(p: Published, sceneId: string, question: unknown): void {
  const scene = p.lesson.scenes.find((s) => s.id === sceneId);
  if (scene?.kind !== 'checkpoint') throw new Error(`${sceneId} is not a checkpoint`);
  scene.question = Question.parse(question);
}

/** The markup of one scene, cut out of the document. */
function sceneHtml(doc: string, sceneId: string): string {
  const at = doc.indexOf(`data-scene="${sceneId}"`);
  expect(at, `scene ${sceneId}`).toBeGreaterThan(0);
  const start = doc.lastIndexOf('<section class="lt-scene', at);
  return doc.slice(start, doc.indexOf('</section>', start) + '</section>'.length);
}
const render = (p: Published, sceneId: string): { html: string; s: Scanned; doc: string } => {
  const doc = renderLessonHtml(p);
  const html = sceneHtml(doc, sceneId);
  return { html, s: scan(html), doc };
};
const byClass = (s: Scanned, cls: string): Tag[] => s.tags.filter((t) => !t.closing && (t.attrs.get('class') ?? '').split(' ').includes(cls));
const withAttr = (s: Scanned, name: string): Tag[] => s.tags.filter((t) => !t.closing && t.attrs.has(name));
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
const VOID = new Set(['input', 'path', 'circle', 'meta', 'br', 'hr', 'mspace']);
/** For each start tag, the elements it sits inside, outermost first. */
function ancestry(s: Scanned): Map<Tag, Tag[]> {
  const stack: Tag[] = [];
  const out = new Map<Tag, Tag[]>();
  for (const t of s.tags) {
    if (t.closing) {
      stack.pop();
      continue;
    }
    out.set(t, [...stack]);
    if (!VOID.has(t.name)) stack.push(t);
  }
  return out;
}
/** The part of a scene that sits inside its no-script answer. */
const answerOf = (html: string): string => html.slice(html.indexOf('<details class="lt-reveal lt-answer"'), html.lastIndexOf('</details>') + '</details>'.length);
const outsideAnswer = (html: string): string => html.replace(answerOf(html), '');

describe('every question', () => {
  const cases: [string, Published, string][] = [
    ['single', base, SINGLE.id],
    ['order', base, ORDER.id],
    ['numeric', base, NUMERIC.id],
    ['reflect', lesson((p) => setQuestion(p, NUMERIC.id, reflect)), NUMERIC.id],
  ];

  it.each(cases)('%s: is one question element with one empty status region that the player can find by id', (type, p, id) => {
    const { html, s } = render(p, id);
    const boxes = byClass(s, 'lt-question');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.attrs.get('data-question')).toBe(type);
    const status = s.tags.filter((t) => !t.closing && t.attrs.get('role') === 'status');
    expect(status).toHaveLength(1);
    expect(status[0]?.attrs.get('id')).toBe(`lt-${id}-_ask-status`);
    // Present and empty in the markup: a live region that arrives with its text is not announced.
    expect(html).toContain(`<div class="lt-feedback lt-callout" role="status" id="lt-${id}-_ask-status"></div>`);
  });

  it.each(cases)('%s: every control that needs the script is hidden, and nothing is pre-selected or pre-filled', (_type, p, id) => {
    const { s } = render(p, id);
    const inside = ancestry(s);
    const hiddenAbove = (tag: Tag): boolean => tag.attrs.has('hidden') || (inside.get(tag) ?? []).some((t) => t.attrs.has('hidden'));
    const controls = s.tags.filter((t) => !t.closing && ['input', 'textarea', 'button'].includes(t.name) && !(t.attrs.get('class') ?? '').includes('lt-chip') && !t.attrs.has('popovertarget'));
    expect(controls.length).toBeGreaterThan(0);
    for (const c of controls) {
      expect(hiddenAbove(c), `${c.name}.${c.attrs.get('class') ?? ''}[${c.attrs.get('data-act') ?? c.attrs.get('data-move') ?? c.attrs.get('type') ?? ''}]`).toBe(true);
      expect(c.attrs.has('checked')).toBe(false);
      expect(c.attrs.has('disabled')).toBe(false);
      if (c.name === 'button') expect(c.attrs.get('type')).toBe('button');
    }
    for (const t of elements(s, 'textarea')) expect(t.content).toBe('');
    for (const t of elements(s, 'input')) expect(t.attrs.has('value') && t.attrs.get('type') === 'text').toBe(false);
  });

  it.each(cases)('%s: the answer is behind a closed native disclosure, with the sources of its explanation', (type, p, id) => {
    const { html, s } = render(p, id);
    const answers = elements(s, 'details').filter((d) => d.attrs.has('data-answer'));
    expect(answers).toHaveLength(1);
    expect(answers[0]?.attrs.has('open')).toBe(false);
    for (const d of elements(s, 'details')) expect(d.attrs.has('open')).toBe(false);
    const inside = answerOf(html);
    expect(inside).toContain(`<summary>${type === 'reflect' ? ASK.reveal : ASK.answer}</summary>`);
    const explained = type === 'reflect' ? reflect.modelAnswer : (checkpointOf(p, type).question as SingleQuestion).explanation;
    expect(scan(inside).text).toContain(explained.text);
    expect(byClass(scan(inside), 'lt-chip')).toHaveLength(explained.cites.length);
    // Nothing of the answer is outside the disclosure.
    expect(scan(outsideAnswer(html)).text).not.toContain(explained.text);
    expect(byClass(scan(outsideAnswer(html)), 'lt-chip')).toHaveLength(0);
  });

  it.each(cases)('%s: uses only elements and attributes the page allows, and ids that are its own', (_type, p, id) => {
    const { s, doc } = render(p, id);
    for (const tag of s.tags) {
      expect(ALLOWED_TAGS.has(tag.name), `<${tag.name}>`).toBe(true);
      if (tag.closing) continue;
      for (const [name, value] of tag.attrs) {
        expect(attrAllowed(name), `${tag.name}[${name}]`).toBe(true);
        if (['id', 'for', 'aria-labelledby', 'aria-describedby', 'popovertarget'].includes(name)) expect(value).toMatch(/^(lt|scene)-[A-Za-z0-9_-]+$/);
      }
    }
    // Every reference points at an element that exists, and no id is used twice in the document.
    const all = scan(doc);
    const ids = withAttr(all, 'id').map((t) => t.attrs.get('id') as string);
    expect(new Set(ids).size).toBe(ids.length);
    for (const name of ['for', 'aria-labelledby', 'aria-describedby', 'popovertarget']) for (const t of withAttr(s, name)) expect(ids, `${name}=${t.attrs.get(name)}`).toContain(t.attrs.get(name));
  });

  it('marks its own words as English in a lesson that is not, and leaves the lesson’s words alone', () => {
    const p = lesson((q) => (q.lesson.language = 'de'));
    const { html } = render(p, SINGLE.id);
    expect(html).toContain(`<summary lang="en">${ASK.answer}</summary>`);
    expect(html).toContain(`<summary lang="en">${ASK.hint}</summary>`);
    expect(html).toContain('<p class="lt-actions" data-actions hidden lang="en">');
    expect(html).toContain(`<span class="lt-key-verdict" lang="en">${ASK.right}</span>`);
    expect(html).toContain(`<p class="lt-label" lang="en">${ASK.why}</p>`);
    expect(html).toContain('<legend class="lt-prompt">');
    expect(html).toContain('<span class="lt-option-text">');
    expect(render(base, SINGLE.id).html).not.toContain('lang=');
  });

  it('shows the weak-match line on the card of an explanation the receipt lists', () => {
    const mark = `<p class="lt-source-weak">${WEAK_MATCH_LINE}</p>`;
    expect(count(render(base, SINGLE.id).html, mark)).toBe(0);
    expect(count(render(lesson(undefined, { weakClaims: [`${SINGLE.id}/question.explanation`] }), SINGLE.id).html, mark)).toBe(single.explanation.cites.length);
    const p = lesson((q) => setQuestion(q, NUMERIC.id, reflect), { weakClaims: [`${NUMERIC.id}/question.modelAnswer`] });
    expect(count(render(p, NUMERIC.id).html, mark)).toBe(reflect.modelAnswer.cites.length);
  });

  it('renders nothing for a type it does not know, and does not throw', () => {
    const env = { lesson: base.lesson, receipt: base.receipt, book: sourceBook(base.lesson), weak: new Set<string>(), ui: attrs({}), clips: new Set<string>() };
    const ctx = createContext(env, SINGLE, 3);
    expect(renderQuestion({ type: 'essay', prompt: 'x' } as never, ctx)).toBe('');
    expect(renderQuestion({ type: '__proto__' } as never, ctx)).toBe('');
    expect(renderQuestion(single, ctx)).toContain('data-question="single"');
  });
});

describe('single choice', () => {
  const { html, s, doc } = render(base, SINGLE.id);

  it('is native radios in a fieldset whose legend is the prompt, one name for the group', () => {
    expect(elements(s, 'fieldset')).toHaveLength(1);
    expect(html).toContain(`<fieldset class="lt-choices"><legend class="lt-prompt">${single.prompt}</legend>`);
    const radios = elements(s, 'input');
    expect(radios).toHaveLength(single.options.length);
    expect(new Set(radios.map((r) => r.attrs.get('type')))).toEqual(new Set(['radio']));
    expect(new Set(radios.map((r) => r.attrs.get('name')))).toEqual(new Set([`lt-${SINGLE.id}-_ask`]));
    const labels = byClass(s, 'lt-option');
    expect(labels.map((l) => l.name)).toEqual(single.options.map(() => 'label'));
    expect(radios.map((r) => r.attrs.get('value'))).toEqual(labels.map((l) => l.attrs.get('data-option')));
    for (const o of single.options) expect(html).toContain(`<span class="lt-option-text">${o.text}</span></label>`);
  });

  it('has an explicit Check button, a way to practise again, and a hint only when the lesson gives one', () => {
    expect(html).toContain(`<button type="button" class="lt-btn lt-btn-primary" data-act="check">${ASK.check}</button><button type="button" class="lt-btn lt-btn-quiet" data-act="again" hidden>${ASK.again}</button>`);
    expect(html).toContain(`<details class="lt-reveal lt-hint"><summary>${ASK.hint}</summary><div class="lt-reveal-body"><p>${single.hint}</p></div></details>`);
    const { hint: _hint, ...rest } = EXAMPLE_QUESTIONS.single as SingleQuestion;
    expect(render(lesson((p) => setQuestion(p, SINGLE.id, rest)), SINGLE.id).html).not.toContain('lt-hint');
  });

  it('keeps each option’s feedback, and which option is right, inside the answer and nowhere else', () => {
    const inside = answerOf(html);
    const outside = scan(outsideAnswer(html)).text;
    for (const [i, o] of single.options.entries()) {
      expect(inside).toContain(`<p class="lt-key-option"><span class="lt-key-verdict">${o.correct ? ASK.right : ASK.wrong}</span> ${o.text}</p><p class="lt-key-why" data-feedback="${i}">`);
      expect(outside).not.toContain(o.feedback);
    }
    expect(count(inside, ASK.right)).toBe(1);
    expect(count(inside, ASK.wrong)).toBe(single.options.length - 1);
    // No attribute anywhere says which radio is the answer.
    for (const t of s.tags) for (const name of t.attrs.keys()) expect(name).not.toMatch(/correct|right|answer-is/);
    expect(outside).not.toContain(ASK.right);
  });

  it('never writes a misconception into the page: it exists only in the embedded data', () => {
    const texts = single.options.flatMap((o) => (o.misconception ? [o.misconception] : []));
    expect(texts.length).toBeGreaterThan(0);
    const all = scan(doc);
    const data = elements(all, 'script').find((t) => t.attrs.get('type') === 'application/json')?.content ?? '';
    for (const text of texts) {
      expect(html).not.toContain(text);
      expect(all.text).not.toContain(text);
      expect(count(doc, text)).toBe(1);
      expect(data).toContain(text);
      for (const t of all.tags) for (const value of t.attrs.values()) expect(value).not.toContain(text);
    }
  });

  it('shows the options in an order fixed by the receipt hash and the scene, the same in the list and in the answer', () => {
    const shown = (p: Published): number[] => byClass(render(p, SINGLE.id).s, 'lt-option').map((l) => Number(l.attrs.get('data-option')));
    const n = single.options.length;
    expect(shown(base)).toEqual(optionOrder(n, `${EXAMPLE_HASH}/${SINGLE.id}/ask`, false));
    const orders = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const hash = i.toString(16).padStart(64, '0');
      const order = shown(lesson(undefined, { hash }));
      expect([...order].sort()).toEqual(Array.from({ length: n }, (_, k) => k));
      expect(order).toEqual(shuffledOrder(n, `${hash}/${SINGLE.id}/ask`));
      expect(shown(lesson(undefined, { hash }))).toEqual(order);
      orders.add(order.join());
      const page = render(lesson(undefined, { hash }), SINGLE.id);
      expect(withAttr(scan(answerOf(page.html)), 'data-feedback').map((t) => Number(t.attrs.get('data-feedback')))).toEqual(order);
    }
    expect(orders.size).toBeGreaterThan(3);
  });

  it('puts the right answer in every position about equally often', () => {
    const n = 4;
    const first = Array.from({ length: n }, () => 0);
    const rounds = 4000;
    for (let i = 0; i < rounds; i++) (first[shuffledOrder(n, `${i.toString(16).padStart(64, 'f')}/s/ask`).indexOf(0)] as number)++;
    for (const seen of first) expect(seen / rounds).toBeGreaterThan(0.2);
    for (const seen of first) expect(seen / rounds).toBeLessThan(0.3);
  });

  it('keeps the author’s order when fixedOrder is set, whatever the hash', () => {
    for (const hash of ['1'.repeat(64), '2'.repeat(64), 'e'.repeat(64)]) {
      const p = lesson((q) => setQuestion(q, SINGLE.id, { ...EXAMPLE_QUESTIONS.single, fixedOrder: true }), { hash });
      expect(byClass(render(p, SINGLE.id).s, 'lt-option').map((l) => Number(l.attrs.get('data-option')))).toEqual(single.options.map((_, i) => i));
    }
  });

  it('renders inline markup in the prompt, the options and the feedback', () => {
    const p = lesson((q) =>
      setQuestion(q, SINGLE.id, {
        ...EXAMPLE_QUESTIONS.single,
        prompt: 'What does `mid` hold when $n = 8$?',
        options: single.options.map((o, i) => (i === 0 ? { ...o, text: 'The **middle** position', feedback: 'Yes: *halfway* between `low` and `high`, which is right.' } : o)),
      }),
    );
    const { html: h } = render(p, SINGLE.id);
    expect(h).toContain('<legend class="lt-prompt">What does <code>mid</code> hold when <math');
    expect(h).toContain('<span class="lt-option-text">The <strong>middle</strong> position</span>');
    expect(h).toContain('data-feedback="0">Yes: <em>halfway</em> between <code>low</code> and <code>high</code>, which is right.</p>');
  });
});

describe('ordering', () => {
  const { html, s } = render(base, ORDER.id);

  it('is a named list whose items each carry two named buttons, hidden until the script is there', () => {
    const lists = elements(s, 'ol').filter((t) => (t.attrs.get('class') ?? '') === 'lt-order');
    expect(lists).toHaveLength(1);
    expect(lists[0]?.attrs.get('role')).toBe('list');
    expect(lists[0]?.attrs.get('aria-labelledby')).toBe(`lt-${ORDER.id}-_ask-prompt`);
    expect(html).toContain(`<p class="lt-prompt" id="lt-${ORDER.id}-_ask-prompt">${order.prompt}</p>`);
    const items = byClass(s, 'lt-order-item');
    expect(items).toHaveLength(order.items.length);
    for (const [i, item] of order.items.entries()) {
      expect(html).toContain(
        `<li class="lt-order-item" data-item="${i}"><span class="lt-order-text">${item}</span><span class="lt-order-moves" data-moves hidden><button type="button" class="lt-btn lt-move" data-move="up" aria-label="${ASK.moveUp}: ${item}">`,
      );
      expect(html).toContain(`data-move="down" aria-label="${ASK.moveDown}: ${item}">`);
    }
    expect(html).toContain(`<p class="lt-order-how" data-how hidden>${ASK.orderHow}</p>`);
  });

  it('starts in an order that is never the answer, for any hash and any number of items', () => {
    const start = (p: Published): number[] => byClass(render(p, ORDER.id).s, 'lt-order-item').map((t) => Number(t.attrs.get('data-item')));
    expect(start(base)).toEqual(startOrder(order.items, `${EXAMPLE_HASH}/${ORDER.id}/ask`));
    for (let i = 0; i < 25; i++) {
      const got = start(lesson(undefined, { hash: (i * 7919).toString(16).padStart(64, '0') }));
      expect([...got].sort()).toEqual(order.items.map((_, k) => k));
      expect(got).not.toEqual(order.items.map((_, k) => k));
    }
    for (const size of [3, 4, 5, 6]) {
      const items = Array.from({ length: size }, (_, k) => `item ${k}`);
      for (let i = 0; i < 3000; i++) {
        const got = startOrder(items, `seed-${i}`);
        expect([...got].sort((a, b) => a - b)).toEqual(items.map((_, k) => k));
        expect(got.every((from, at) => from === at)).toBe(false);
      }
    }
  });

  it('is never solved at the start even when two items read the same', () => {
    for (const items of [
      ['a', 'a', 'b'],
      ['a', 'b', 'a', 'b'],
      ['x', 'y', 'y', 'y'],
    ])
      for (let i = 0; i < 2000; i++) {
        const got = startOrder(items, `dup-${i}`);
        expect(got.every((from, at) => items[from] === items[at])).toBe(false);
      }
  });

  it('gives the correct order only inside the answer, and names the buttons with plain text', () => {
    const inside = answerOf(html);
    expect(inside).toContain(`<div class="lt-solution" data-solution><p class="lt-label">${ASK.orderAnswer}</p><ol class="lt-key-order">${order.items.map((item) => `<li>${item}</li>`).join('')}</ol></div>`);
    const p = lesson((q) => setQuestion(q, ORDER.id, { ...EXAMPLE_QUESTIONS.order, items: ['Read **the** `middle`', 'Compare with $x^2$', 'Discard a half'] }));
    const marked = render(p, ORDER.id);
    const labels = withAttr(marked.s, 'aria-label').map((t) => t.attrs.get('aria-label'));
    expect(labels).toContain('Move up: Read the middle');
    expect(labels).toContain('Move down: Compare with x^2');
    expect(marked.html).toContain('<span class="lt-order-text">Read <strong>the</strong> <code>middle</code></span>');
  });
});

describe('numeric', () => {
  const { html, s } = render(base, NUMERIC.id);

  it('is a labelled text field with its unit, and carries its own keyboard hints', () => {
    const inputs = elements(s, 'input');
    expect(inputs).toHaveLength(1);
    const input = inputs[0] as Tag;
    expect(input.attrs.get('type')).toBe('text');
    // In the markup, not added by the script: a number pad on a phone, nothing offered from other
    // forms, no capital first letter, and "done" on the return key.
    expect(Object.fromEntries(['inputmode', 'autocomplete', 'autocapitalize', 'enterkeyhint', 'spellcheck'].map((name) => [name, input.attrs.get(name)]))).toEqual({
      inputmode: 'decimal',
      autocomplete: 'off',
      autocapitalize: 'off',
      enterkeyhint: 'done',
      spellcheck: 'false',
    });
    expect(input.attrs.has('hidden')).toBe(true);
    expect(input.attrs.get('id')).toBe(`lt-${NUMERIC.id}-_ask-input`);
    expect(input.attrs.get('aria-describedby')).toBe(`lt-${NUMERIC.id}-_ask-unit`);
    expect(html).toContain(`<p class="lt-prompt"><label for="lt-${NUMERIC.id}-_ask-input">${numeric.prompt}</label></p>`);
    expect(html).toContain(`<span class="lt-unit-lead">${ASK.unitLead} </span><span class="lt-unit" id="lt-${NUMERIC.id}-_ask-unit">${numeric.unit}</span>`);
    // The unit line is readable with no script; only the field inside it is hidden.
    expect(html).toContain('<p class="lt-numeric"><input type="text"');
  });

  it('leaves out the unit, and hides the empty line, when there is none', () => {
    const { unit: _unit, ...rest } = EXAMPLE_QUESTIONS.numeric as NumericQuestion;
    const plain = render(lesson((p) => setQuestion(p, NUMERIC.id, rest)), NUMERIC.id);
    expect(plain.html).toContain('<p class="lt-numeric" hidden><input type="text"');
    expect(plain.html).not.toContain('lt-unit');
    expect(elements(plain.s, 'input')[0]?.attrs.has('aria-describedby')).toBe(false);
    expect(answerOf(plain.html)).toContain(`<strong class="lt-solution-value">${numeric.answer}</strong>`);
  });

  it('gives the answer with its unit, and the range that counts, only inside the answer', () => {
    const inside = answerOf(html);
    expect(inside).toContain(`<span class="lt-label">${ASK.numericAnswer}</span> <strong class="lt-solution-value">${numeric.answer} ${numeric.unit}</strong>`);
    expect(inside).not.toContain('lt-solution-range');
    expect(outsideAnswer(html)).not.toContain(`>${numeric.answer}<`);
    const ranged = render(lesson((p) => setQuestion(p, NUMERIC.id, { ...EXAMPLE_QUESTIONS.numeric, answer: 0.3, tolerance: 0.1 })), NUMERIC.id);
    expect(answerOf(ranged.html)).toContain('<p class="lt-solution-range">Anything from 0.2 to 0.4 counts as right.</p>');
  });

  it('writes numbers as plain digits, the same on every machine', () => {
    expect(showNumber(20)).toBe('20');
    expect(showNumber(1000000)).toBe('1000000');
    expect(showNumber(0.3)).toBe('0.3');
    expect(showNumber(-2.5)).toBe('-2.5');
    expect(showNumber(-0)).toBe('0');
    expect(showNumber(1e21)).toBe('1e+21');
    expect(showNumber(Number.NaN)).toBe('');
    expect(showNumber(Number.POSITIVE_INFINITY)).toBe('');
    expect(showNumber('7' as never)).toBe('');
  });

  // Review finding P1. The answer used to be rounded to twelve digits, so the page stated a number
  // that was not the answer and that its own grader refused.
  it('shows the answer itself, however many digits it has', () => {
    const exact: [number, string][] = [
      [1099511627776, '1099511627776'],
      [2 ** 53, '9007199254740992'],
      [2 ** 60, '1152921504606847000'],
      [123456789.123456, '123456789.123456'],
      [0.1234567890123456, '0.1234567890123456'],
      [-1099511627776, '-1099511627776'],
    ];
    for (const [n, text] of exact) {
      expect(showNumber(n)).toBe(text);
      // Whatever is shown names the same number when it is typed back.
      expect(Number(showNumber(n))).toBe(n);
    }
    const big = render(lesson((p) => setQuestion(p, NUMERIC.id, { ...EXAMPLE_QUESTIONS.numeric, answer: 1099511627776, tolerance: 0 })), NUMERIC.id);
    expect(answerOf(big.html)).toContain(`<strong class="lt-solution-value">1099511627776 ${numeric.unit}</strong>`);
    expect(big.html).not.toContain('1099511627780');
  });

  it('adds the tolerance in decimal, so the range has neither binary noise nor rounding', () => {
    expect(showSum(0.1, 0.2)).toBe('0.3');
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(showSum(0.3, -0.1)).toBe('0.2');
    expect(showSum(1.25, 0.05)).toBe('1.3');
    expect(showSum(1.25, -0.05)).toBe('1.2');
    expect(showSum(20, 0.5)).toBe('20.5');
    expect(showSum(20, -20)).toBe('0');
    expect(showSum(0.5, -1)).toBe('-0.5');
    expect(showSum(-2.5, 2.25)).toBe('-0.25');
    expect(showSum(1099511627776, -0.5)).toBe('1099511627775.5');
    expect(showSum(1099511627776, 0.5)).toBe('1099511627776.5');
    expect(showSum(2 ** 53, 1)).toBe('9007199254740993');
    expect(showSum(1e21, 1)).toBe('1000000000000000000001');
    expect(showSum(1.5e-7, 1e-7)).toBe('0.00000025');
    // Too far apart to write out: the plain sum, as before.
    expect(showSum(1e300, 1)).toBe('1e+300');
    expect(showSum(Number.NaN, 1)).toBe('');
    const ranged = render(lesson((p) => setQuestion(p, NUMERIC.id, { ...EXAMPLE_QUESTIONS.numeric, answer: 1099511627776, tolerance: 0.5 })), NUMERIC.id);
    expect(answerOf(ranged.html)).toContain('<p class="lt-solution-range">Anything from 1099511627775.5 to 1099511627776.5 counts as right.</p>');
  });
});

// Review finding P7. A browser does not read MathML when it names a control from its label, so
// wherever lesson text with math names a control or a group, the name is also given in words.
describe('names for controls whose text holds math', () => {
  const MATHS = {
    type: 'single',
    prompt: 'A square has $1 + 1$ pairs of sides. Which is $2^3$?',
    options: [
      { text: '$8$', correct: true, feedback: 'Two cubed is eight: two times two times two.' },
      { text: 'Doubling twice, $2^{2}$', correct: false, feedback: 'That is two squared, which is four.', misconception: 'Squares the base instead of cubing it.' },
      { text: 'Six', correct: false, feedback: 'That is two times three, not two cubed.', misconception: 'Multiplies the base by the exponent.' },
    ],
    hint: 'Multiply two by itself.',
    explanation: single.explanation,
  };
  const named = (s: Scanned, name: string): Tag[] => elements(s, name);

  it('knows math from text that only looks like it', () => {
    expect(hasMath('$2^3$')).toBe(true);
    expect(hasMath('costs $5 and $6')).toBe(false);
    expect(hasMath('`$x$` in code')).toBe(false);
    expect(hasMath('no math')).toBe(false);
  });

  it('names a radio in words when its option holds math, and leaves the others to their visible text', () => {
    const { s } = render(lesson((p) => setQuestion(p, SINGLE.id, MATHS)), SINGLE.id);
    const radios = named(s, 'input').filter((t) => t.attrs.get('type') === 'radio');
    expect(Object.fromEntries(radios.map((r) => [r.attrs.get('value'), r.attrs.get('aria-label')]))).toEqual({ '0': '8', '1': 'Doubling twice, 2^2', '2': undefined });
    expect(named(s, 'fieldset')[0]?.attrs.get('aria-label')).toBe('A square has 1 + 1 pairs of sides. Which is 2^3?');
    // The visible label is still the label: the name only repeats it in a form that can be read out.
    expect(named(s, 'math').length).toBeGreaterThanOrEqual(4);
  });

  it('adds no name where there is no math, so what is seen and what is announced stay one string', () => {
    for (const [p, id] of [
      [base, SINGLE.id],
      [base, ORDER.id],
      [base, NUMERIC.id],
      [lesson((q) => setQuestion(q, NUMERIC.id, reflect)), NUMERIC.id],
    ] as const) {
      const { s } = render(p, id);
      const labelled = s.tags.filter((t) => !t.closing && t.attrs.has('aria-label') && !t.attrs.has('data-move') && t.attrs.get('class') !== 'lt-chip');
      expect(labelled.map((t) => `${t.name}: ${t.attrs.get('aria-label')}`)).toEqual([]);
    }
  });

  it('names the number field, the reflect box, the ordering list and a look-for tick the same way', () => {
    const n = render(lesson((p) => setQuestion(p, NUMERIC.id, { ...EXAMPLE_QUESTIONS.numeric, prompt: 'What is $2^{10}$?' })), NUMERIC.id);
    expect(named(n.s, 'input')[0]?.attrs.get('aria-label')).toBe('What is 2^10?');

    const r = render(lesson((p) => setQuestion(p, NUMERIC.id, { ...reflect, prompt: 'Why is $\\frac{1}{2}$ a half?', lookFor: ['Says $n/2$ halves', 'Plain words'] })), NUMERIC.id);
    expect(named(r.s, 'textarea')[0]?.attrs.get('aria-label')).toBe('Why is 1/2 a half?');
    const ticks = named(r.s, 'input').filter((t) => t.attrs.get('type') === 'checkbox');
    expect(ticks.map((t) => t.attrs.get('aria-label'))).toEqual(['Says n/2 halves', undefined]);

    const o = render(lesson((p) => setQuestion(p, ORDER.id, { ...order, prompt: 'Order by size, starting from $2^1$.' })), ORDER.id);
    const list = named(o.s, 'ol').find((t) => t.attrs.get('class') === 'lt-order');
    expect(list?.attrs.get('aria-label')).toBe('Order by size, starting from 2^1.');
    expect(list?.attrs.has('aria-labelledby')).toBe(false);
    const plain = named(render(base, ORDER.id).s, 'ol').find((t) => t.attrs.get('class') === 'lt-order');
    expect(plain?.attrs.get('aria-labelledby')).toBe(`lt-${ORDER.id}-_ask-prompt`);
  });
});

describe('reflect', () => {
  const p = lesson((q) => setQuestion(q, NUMERIC.id, reflect));
  const { html, s } = render(p, NUMERIC.id);

  it('is a labelled textarea, a button to reveal, and a note that what is written stays put', () => {
    const areas = elements(s, 'textarea');
    expect(areas).toHaveLength(1);
    expect(areas[0]?.attrs.get('id')).toBe(`lt-${NUMERIC.id}-_ask-input`);
    expect(html).toContain(`<p class="lt-prompt"><label for="lt-${NUMERIC.id}-_ask-input">${reflect.prompt}</label></p><p class="lt-reflect-how">${ASK.reflectHow}</p>`);
    // autocomplete is off in the markup: what is typed here is never put back by the browser.
    expect(html).toContain(
      `<div class="lt-reflect-write" data-write hidden><textarea class="lt-field lt-reflect-text" id="lt-${NUMERIC.id}-_ask-input" rows="5" autocomplete="off" spellcheck="true"></textarea><p class="lt-private">${ASK.reflectPrivate}</p></div>`,
    );
    expect(html).toContain(`<button type="button" class="lt-btn lt-btn-primary" data-act="reveal">${ASK.reveal}</button>`);
    expect(ASK.reflectPrivate).toMatch(/not saved/);
  });

  it('keeps the model answer and the look-for list inside the answer, each item with a checkbox for the player to wake', () => {
    const inside = answerOf(html);
    expect(inside).toContain(`<div class="lt-model" data-model><p class="lt-label">${ASK.model}</p><p>${reflect.modelAnswer.text}&nbsp;<span class="lt-cites">`);
    expect(inside).toContain(`<p class="lt-label" id="lt-${NUMERIC.id}-_ask-look">${ASK.lookFor}</p><ul class="lt-lookfor" aria-labelledby="lt-${NUMERIC.id}-_ask-look">`);
    for (const item of reflect.lookFor) expect(inside).toContain(`<li><label class="lt-look"><input type="checkbox" hidden><span>${item}</span></label></li>`);
    expect(scan(outsideAnswer(html)).text).not.toContain(reflect.lookFor[0]);
  });

  it('offers a three-way self-rating as a hidden group of radios whose values are the results the shell records', () => {
    expect(RATINGS.map((r) => r.value)).toEqual(['yes', 'partly', 'no']);
    const group = html.slice(html.indexOf('<fieldset class="lt-rate"'), html.indexOf('</fieldset>') + '</fieldset>'.length);
    expect(group).toContain(`<fieldset class="lt-rate" data-rate hidden><legend class="lt-label">${ASK.rate}</legend>`);
    const radios = elements(scan(group), 'input');
    expect(radios.map((r) => `${r.attrs.get('type')}:${r.attrs.get('value')}`)).toEqual(['radio:yes', 'radio:partly', 'radio:no']);
    expect(new Set(radios.map((r) => r.attrs.get('name')))).toEqual(new Set([`lt-${NUMERIC.id}-_ask-rate`]));
    for (const r of RATINGS) expect(group).toContain(`<span>${r.label}</span>`);
    // The status region follows the rating, so what it says sits under the control that caused it.
    expect(html.indexOf('</fieldset>')).toBeLessThan(html.indexOf('role="status"'));
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf('<details class="lt-reveal lt-answer"'));
  });
});

describe('text from the lesson stays text', () => {
  it.each(PAYLOADS.map((payload, i) => [i, payload] as const))('#%i %j in every string of every question', (_i, payload) => {
    const p = lesson((q) => {
      setQuestion(q, SINGLE.id, {
        type: 'single',
        prompt: payload,
        options: single.options.map((_, k) => ({ text: `${k} ${payload}`.slice(0, 120), correct: k === 0, feedback: `${k} because ${payload}`.padEnd(15, '.'), ...(k === 0 ? {} : { misconception: `${k} mistaken ${payload}`.slice(0, 120) }) })),
        explanation: { text: payload, cites: ['e1'] },
        hint: payload,
      });
      setQuestion(q, NUMERIC.id, { type: 'numeric', prompt: payload, answer: 2, tolerance: 0.5, unit: payload.slice(0, 16), explanation: { text: payload, cites: ['e2'] }, hint: payload });
      setQuestion(q, ORDER.id, { type: 'order', prompt: payload, items: order.items.map((_, k) => `${k} ${payload}`.slice(0, 100)), explanation: { text: payload, cites: ['e1'] } });
    });
    const clean = scan(renderLessonHtml(base));
    const doc = renderLessonHtml(p);
    const s = scan(doc);
    for (const name of ['input', 'button', 'label', 'fieldset', 'details', 'svg', 'script', 'ol', 'li', 'a', 'form']) expect(elements(s, name).length, name).toBe(elements(clean, name).length);
    for (const tag of s.tags) {
      expect(ALLOWED_TAGS.has(tag.name), `<${tag.name}>`).toBe(true);
      if (!tag.closing) for (const name of tag.attrs.keys()) expect(attrAllowed(name), `${tag.name}[${name}]`).toBe(true);
    }
    expect(s.comments).toEqual([]);
    // The names of the move buttons carry the item as plain characters, in an attribute.
    const labels = withAttr(scan(sceneHtml(doc, ORDER.id)), 'data-move').map((t) => t.attrs.get('aria-label') as string);
    expect(labels).toHaveLength(order.items.length * 2);
    for (const label of labels) expect(label).toMatch(/^Move (up|down): /);
    const again = renderLessonHtml(lesson((q) => setQuestion(q, NUMERIC.id, { ...reflect, prompt: payload, modelAnswer: { text: payload, cites: ['e3'] }, lookFor: [payload.slice(0, 120), `${payload} 2`.slice(0, 120)] })));
    const r = scan(again);
    for (const tag of r.tags) expect(ALLOWED_TAGS.has(tag.name), `<${tag.name}>`).toBe(true);
    expect(elements(r, 'textarea').map((t) => t.content)).toContain('');
    expect(elements(r, 'script').slice(0, 2).map((t) => t.attrs.get('type') ?? 'classic')).toEqual(['application/json', 'classic']);
  });
});
