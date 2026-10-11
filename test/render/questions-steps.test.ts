// The steps of a step-through as static markup: every step in order for a reader with no script,
// the predict question as plain text, values that changed marked in words, and the hooks the player
// needs, hidden until it is there.
import { describe, expect, it } from 'vitest';
import { Scene, type Step, type StepThroughScene } from '../../src/core/schema';
import type { Published } from '../../src/core/types';
import { attrs } from '../../src/render/escape';
import { renderLessonHtml } from '../../src/render/index';
import { ASK, optionOrder } from '../../src/render/questions';
import { createContext } from '../../src/render/scenes';
import { sourceBook } from '../../src/render/sources';
import { STEPS, renderSteps } from '../../src/render/steps';
import { EXAMPLE_HASH, examplePublished, exampleReceipt } from '../helpers/example';
import { ALLOWED_TAGS, PAYLOADS, type Scanned, type Tag, attrAllowed, elements, scan } from './helpers';

const base = examplePublished();
const stepScene = (p: Published): StepThroughScene => p.lesson.scenes.find((s): s is StepThroughScene => s.kind === 'step_through') as StepThroughScene;
const SCENE = stepScene(base);
const id = SCENE.id;
const total = SCENE.steps.length;
const ASKED = SCENE.steps.findIndex((s) => s.predict);
const predict = SCENE.steps[ASKED]?.predict as NonNullable<Step['predict']>;

function lesson(change: (scene: StepThroughScene, p: Published) => void = () => {}, receipt: Parameters<typeof exampleReceipt>[0] = {}): Published {
  const p = examplePublished({ receipt: exampleReceipt(receipt) });
  change(stepScene(p), p);
  return p;
}
function sceneHtml(doc: string, sceneId: string): string {
  const at = doc.indexOf(`data-scene="${sceneId}"`);
  expect(at, `scene ${sceneId}`).toBeGreaterThan(0);
  const start = doc.lastIndexOf('<section class="lt-scene', at);
  return doc.slice(start, doc.indexOf('</section>', start) + '</section>'.length);
}
const render = (p: Published = base): { html: string; s: Scanned; doc: string } => {
  const doc = renderLessonHtml(p);
  const scene = sceneHtml(doc, id);
  // Only the steps: the figure beside them belongs to another renderer.
  const html = scene.slice(scene.indexOf('<div class="lt-steps"'));
  return { html, s: scan(html), doc };
};
const byClass = (s: Scanned, cls: string): Tag[] => s.tags.filter((t) => !t.closing && (t.attrs.get('class') ?? '').split(' ').includes(cls));
const withAttr = (s: Scanned, name: string): Tag[] => s.tags.filter((t) => !t.closing && t.attrs.has(name));
/** The markup of step n (1-based). */
const stepHtml = (html: string, n: number): string => {
  const start = html.indexOf(`<li class="lt-step" data-step="${n}"`);
  const end = html.indexOf('<li class="lt-step"', start + 1);
  return html.slice(start, end === -1 ? html.lastIndexOf('</ol>') : end);
};

describe('the step-through', () => {
  const { html, s } = render();

  it('has the controls the player needs, hidden, and exactly one status region, empty', () => {
    expect(html.startsWith(`<div class="lt-steps" data-steps="${id}"><div class="lt-step-nav" data-step-nav role="group" aria-label="${STEPS.nav}" hidden>`)).toBe(true);
    expect(html).toContain(`<button type="button" class="lt-btn lt-btn-small lt-btn-quiet" data-step-go="prev" aria-keyshortcuts="ArrowLeft" aria-disabled="true">`);
    expect(html).toContain(`<button type="button" class="lt-btn lt-btn-small" data-step-go="next" aria-keyshortcuts="ArrowRight">${STEPS.next}<svg`);
    expect(html).toContain(`${STEPS.previous}</button>`);
    const status = s.tags.filter((t) => !t.closing && t.attrs.get('role') === 'status');
    expect(status).toHaveLength(1);
    expect(html).toContain(`<p class="lt-step-status" role="status" id="lt-${id}-_steps-status"></p></div>`);
    // The panel that follows the values is there for the player to fill, and is not shown without it.
    expect(html).toContain(`<div class="lt-state-panel" data-state-panel role="group" aria-labelledby="lt-${id}-_steps-state" hidden><p class="lt-label" id="lt-${id}-_steps-state">${STEPS.stateNow}</p><dl class="lt-state"></dl></div>`);
  });

  it('lists every step in order, each marked for the highlight and for the narration', () => {
    const steps = byClass(s, 'lt-step');
    expect(steps.map((t) => t.name)).toEqual(SCENE.steps.map(() => 'li'));
    expect(steps.map((t) => t.attrs.get('data-step'))).toEqual(SCENE.steps.map((_, i) => String(i + 1)));
    expect(steps.map((t) => t.attrs.get('data-narration'))).toEqual(SCENE.steps.map((_, i) => `${id}.step${i + 1}`));
    expect(steps.map((t) => t.attrs.get('data-highlight'))).toEqual(SCENE.steps.map((x) => x.highlight.join(' ')));
    for (const t of steps) expect(t.attrs.has('hidden')).toBe(false);
    expect(html.indexOf('<ol class="lt-step-list">')).toBeGreaterThan(html.indexOf('data-state-panel'));
  });

  it('heads each step with its number and its title, and marks a step that has no title', () => {
    for (const [i, x] of SCENE.steps.entries()) {
      expect(stepHtml(html, i + 1)).toContain(`<h3 class="lt-step-title "><span class="lt-label lt-step-count">Step ${i + 1} of ${total}</span> <span class="lt-step-name">${x.title}</span></h3>`);
    }
    const untitled = render(lesson((scene) => delete (scene.steps[1] as Step).title));
    expect(stepHtml(untitled.html, 2)).toContain(`<h3 class="lt-step-title lt-step-untitled"><span class="lt-label lt-step-count">Step 2 of ${total}</span></h3>`);
  });

  it('puts each step’s text, with its source chips, in a body the player can hold back', () => {
    for (const [i, x] of SCENE.steps.entries()) {
      const step = stepHtml(html, i + 1);
      const body = step.slice(step.indexOf('<div class="lt-step-body" data-step-body>'));
      expect(body.length).toBeGreaterThan(40);
      for (const block of x.blocks) expect(scan(body).text).toContain(block.text);
      const chips = x.blocks.reduce((n, b) => n + (b.type === 'claim' ? b.cites.length : b.type === 'quote' ? 1 : b.type === 'example' ? (b.basedOn?.length ?? 0) : 0), 0);
      expect(byClass(scan(body), 'lt-chip')).toHaveLength(chips);
    }
    // A predict question comes before the body it holds back.
    const asked = stepHtml(html, ASKED + 1);
    expect(asked.indexOf('data-predict')).toBeGreaterThan(0);
    expect(asked.indexOf('data-predict')).toBeLessThan(asked.indexOf('data-step-body'));
  });

  it('uses only elements and attributes the page allows, and ids that exist once', () => {
    const { doc } = render();
    for (const tag of s.tags) {
      expect(ALLOWED_TAGS.has(tag.name), `<${tag.name}>`).toBe(true);
      if (!tag.closing) for (const name of tag.attrs.keys()) expect(attrAllowed(name), `${tag.name}[${name}]`).toBe(true);
    }
    const ids = withAttr(scan(doc), 'id').map((t) => t.attrs.get('id') as string);
    expect(new Set(ids).size).toBe(ids.length);
    for (const name of ['aria-labelledby', 'popovertarget']) for (const t of withAttr(s, name)) expect(ids).toContain(t.attrs.get(name));
    // The recap owns data-result; a step-through must not put one in the page.
    expect(withAttr(s, 'data-result')).toHaveLength(0);
  });

  it('marks its own words as English in a lesson that is not', () => {
    const { html: h } = render(lesson((_scene, p) => (p.lesson.language = 'fr')));
    expect(h).toContain(`role="group" aria-label="${STEPS.nav}" hidden lang="en">`);
    expect(h).toContain(`<span class="lt-label lt-step-count" lang="en">Step 1 of ${total}</span>`);
    expect(h).toContain(`<span class="lt-label lt-predict-kicker" lang="en">${STEPS.predict}</span>`);
    expect(h).toContain(`<p class="lt-label" lang="en">${STEPS.stateAfter}</p>`);
    expect(h).toContain(`<span class="lt-vh" lang="en">${STEPS.changed}</span>`);
    expect(h).toContain('<span class="lt-step-name">');
    expect(h).not.toContain('<span class="lt-step-name" lang');
  });

  it('renders a step-through with no titles, no values and no question', () => {
    const env = { lesson: base.lesson, receipt: base.receipt, book: sourceBook(base.lesson), weak: new Set<string>(), ui: attrs({}), clips: new Set<string>() };
    const bare = Scene.parse({ id, kind: 'step_through', title: 'Bare', figure: SCENE.figure, steps: SCENE.steps.slice(0, 2).map((x) => ({ blocks: x.blocks })) }) as StepThroughScene;
    const out = renderSteps(bare, createContext(env, bare, 2));
    expect(out).not.toContain('lt-state-box');
    expect(out).not.toContain('data-predict');
    expect(scan(out).tags.filter((t) => !t.closing && t.attrs.get('data-highlight') === '')).toHaveLength(2);
  });
});

describe('values', () => {
  const { html } = render();
  const rowsOf = (step: string): { label: string; value: string; changed: boolean; flag: string }[] => {
    const box = step.slice(step.indexOf('<div class="lt-state-box"'));
    return box
      .split('<div class="lt-state-row"')
      .slice(1)
      .map((row) => {
        const text = scan(`<div${row}`).text;
        const label = /<dt>([^<]*)<\/dt>/.exec(row)?.[1] ?? '';
        const value = /<span class="lt-state-value">([^<]*)<\/span>/.exec(row)?.[1] ?? '';
        return { label, value, changed: row.startsWith(' data-changed="true"'), flag: text.slice(label.length + value.length).trim() };
      });
  };

  it('lists each step’s own values under a label, in the order given', () => {
    for (const [i, x] of SCENE.steps.entries()) {
      const step = stepHtml(html, i + 1);
      if (!x.state) {
        expect(step).not.toContain('lt-state-box');
        continue;
      }
      expect(step).toContain(`<div class="lt-state-box" data-state><p class="lt-label">${STEPS.stateAfter}</p><dl class="lt-state">`);
      expect(rowsOf(step).map((r) => `${r.label}=${r.value}`)).toEqual(x.state.map((r) => `${r.label}=${r.value}`));
    }
  });

  it('marks a value that changed since the step before in words, a new one as new, and nothing in the first step', () => {
    expect(rowsOf(stepHtml(html, 1)).some((r) => r.changed || r.flag !== '')).toBe(false);
    let before: Map<string, string> | null = null;
    let marked = 0;
    for (const [i, x] of SCENE.steps.entries()) {
      if (!x.state) continue;
      for (const row of rowsOf(stepHtml(html, i + 1))) {
        const was = before?.get(row.label);
        const changed = before !== null && was !== row.value;
        expect(row.changed, `step ${i + 1} ${row.label}`).toBe(changed);
        expect(row.flag, `step ${i + 1} ${row.label}`).toBe(!changed ? '' : was === undefined ? `${STEPS.changed}${STEPS.isNew}` : `${STEPS.changed}${STEPS.was} ${was}`);
        if (changed) marked++;
      }
      before = new Map(x.state.map((r) => [r.label, r.value]));
    }
    expect(marked).toBeGreaterThan(2);
    // The words a sighted reader needs are not hidden; only "changed," is, because the look of the row says that.
    expect(html).toContain(`<span class="lt-state-flag"><span class="lt-vh">${STEPS.changed}</span><span>${STEPS.was}</span> 0</span>`);
    expect(html).toContain(`<span class="lt-state-flag"><span class="lt-vh">${STEPS.changed}</span><span>${STEPS.isNew}</span></span>`);
  });

  it('compares with the last step that showed any values, not merely the one before', () => {
    const p = lesson((scene) => {
      const steps = scene.steps as Step[];
      (steps[0] as Step).state = [
        { label: 'a', value: '1' },
        { label: 'b', value: '2' },
      ];
      delete (steps[1] as Step).state;
      (steps[2] as Step).state = [
        { label: 'a', value: '1' },
        { label: 'b', value: '3' },
        { label: 'a', value: '9' },
      ];
    });
    const { html: h } = render(p);
    expect(stepHtml(h, 2)).not.toContain('lt-state-box');
    expect(rowsOf(stepHtml(h, 3)).map((r) => `${r.label}=${r.value}:${r.changed ? r.flag : '-'}`)).toEqual(['a=1:-', `b=3:${STEPS.changed}${STEPS.was} 2`, `a=9:${STEPS.changed}${STEPS.was} 1`]);
  });
});

describe('a predict question', () => {
  const { html } = render();
  const asked = stepHtml(html, ASKED + 1);
  const box = asked.slice(asked.indexOf('<div class="lt-predict"'), asked.indexOf('<div class="lt-step-body"'));
  const b = scan(box);

  it('reads as plain text with no script: a labelled prompt and its options, every control hidden', () => {
    expect(box).toContain(`<fieldset class="lt-choices"><legend class="lt-prompt"><span class="lt-label lt-predict-kicker">${STEPS.predict}</span> <span class="lt-predict-prompt">${predict.prompt}</span></legend>`);
    const radios = elements(b, 'input');
    expect(radios).toHaveLength(predict.options.length);
    for (const r of radios) {
      expect(r.attrs.get('type')).toBe('radio');
      expect(r.attrs.has('hidden')).toBe(true);
      expect(r.attrs.has('checked')).toBe(false);
      expect(r.attrs.get('name')).toBe(`lt-${id}-_step${ASKED + 1}-ask`);
    }
    for (const o of predict.options) expect(box).toContain(`<span class="lt-option-text">${o.text}</span>`);
    expect(box).toContain(`<p class="lt-actions" data-actions hidden><button type="button" class="lt-btn lt-btn-primary" data-act="check">${STEPS.checkPredict}</button><button type="button" class="lt-btn lt-btn-quiet" data-act="skip">${STEPS.skipPredict}</button></p>`);
  });

  it('keeps which option is right, and each option’s feedback, behind a closed disclosure', () => {
    const details = elements(b, 'details');
    expect(details).toHaveLength(1);
    expect(details[0]?.attrs.has('open')).toBe(false);
    const inside = box.slice(box.indexOf('<details'));
    const outside = scan(box.slice(0, box.indexOf('<details'))).text;
    for (const [i, o] of predict.options.entries()) {
      expect(inside).toContain(`<span class="lt-key-verdict">${o.correct ? ASK.right : ASK.wrong}</span> ${o.text}</p><p class="lt-key-why" data-feedback="${i}">`);
      expect(outside).not.toContain(o.feedback);
    }
    expect(outside).not.toContain(ASK.right);
  });

  it('has a place for what is said about the prediction that is not a second status region', () => {
    expect(box).toContain('<div class="lt-feedback lt-callout" data-outcome></div>');
    expect(b.tags.filter((t) => t.attrs.has('role'))).toHaveLength(0);
  });

  it('shows its options in an order fixed by the receipt hash, the scene and the step', () => {
    const shown = (p: Published): number[] => {
      const step = stepHtml(render(p).html, ASKED + 1);
      return withAttr(scan(step), 'data-option').map((t) => Number(t.attrs.get('data-option')));
    };
    const n = predict.options.length;
    expect(shown(base)).toEqual(optionOrder(n, `${EXAMPLE_HASH}/${id}/step${ASKED + 1}`, false));
    const orders = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const hash = (i * 31).toString(16).padStart(64, '0');
      const order = shown(lesson(undefined, { hash }));
      expect([...order].sort()).toEqual(Array.from({ length: n }, (_, k) => k));
      expect(order).toEqual(optionOrder(n, `${hash}/${id}/step${ASKED + 1}`, false));
      orders.add(order.join());
    }
    expect(orders.size).toBeGreaterThan(2);
  });

  // Review finding P7: `$8$` and `$6$` as the only text of two options were two radios with no name.
  it('names the group and each radio in words when a prediction is written in math', () => {
    const p = lesson((scene) => {
      (scene.steps[ASKED] as Step).predict = {
        prompt: 'How many leaves after $3$ splits?',
        options: [
          { text: '$2^3 = 8$', correct: true, feedback: 'Each split doubles the count of leaves.' },
          { text: '$6$', correct: false, feedback: 'That adds two per split instead of doubling.' },
        ],
      };
    });
    const step = scan(stepHtml(render(p).html, ASKED + 1));
    expect(elements(step, 'fieldset')[0]?.attrs.get('aria-label')).toBe(`${STEPS.predict}: How many leaves after 3 splits?`);
    const radios = elements(step, 'input');
    expect(Object.fromEntries(radios.map((r) => [r.attrs.get('value'), r.attrs.get('aria-label')]))).toEqual({ '0': '2^3 = 8', '1': '6' });
    // With no math there is nothing to add: the legend and the labels name everything.
    const plain = scan(stepHtml(render().html, ASKED + 1));
    expect(withAttr(plain, 'aria-label').filter((t) => t.attrs.get('class') !== 'lt-chip')).toHaveLength(0);
  });

  it('gives two predict questions in one scene their own radio groups', () => {
    const p = lesson((scene) => {
      (scene.steps[0] as Step).predict = predict;
    });
    const names = new Set(elements(render(p).s, 'input').map((t) => t.attrs.get('name')));
    expect(names).toEqual(new Set([`lt-${id}-_step1-ask`, `lt-${id}-_step${ASKED + 1}-ask`]));
  });
});

describe('text from the lesson stays text', () => {
  it.each(PAYLOADS.map((payload, i) => [i, payload] as const))('#%i %j in every string of the steps', (_i, payload) => {
    const p = lesson((scene) => {
      for (const [i, x] of (scene.steps as Step[]).entries()) {
        x.title = `${i} ${payload}`.slice(0, 50);
        x.state = (x.state ?? []).map((_, k) => ({ label: `${k}${payload}`.slice(0, 24), value: `${i} ${payload}`.slice(0, 32) }));
        if (x.predict) x.predict = { prompt: payload, options: x.predict.options.map((o, k) => ({ ...o, text: `${k} ${payload}`.slice(0, 120), feedback: `${k} because ${payload}`.padEnd(15, '.') })) };
      }
    });
    const clean = render();
    const { s, html } = render(p);
    for (const name of ['input', 'button', 'label', 'fieldset', 'legend', 'details', 'svg', 'li', 'dl', 'dt', 'dd', 'h3']) expect(elements(s, name).length, name).toBe(elements(clean.s, name).length);
    for (const tag of s.tags) {
      expect(ALLOWED_TAGS.has(tag.name), `<${tag.name}>`).toBe(true);
      if (!tag.closing) for (const name of tag.attrs.keys()) expect(attrAllowed(name), `${tag.name}[${name}]`).toBe(true);
    }
    expect(s.comments).toEqual([]);
    expect(byClass(s, 'lt-step').map((t) => t.attrs.get('data-step'))).toEqual(SCENE.steps.map((_, i) => String(i + 1)));
    // A title is plain text: shown as the characters that were written.
    const shown = `0 ${payload}`.slice(0, 50).replaceAll(String.fromCharCode(0), String.fromCharCode(0xfffd));
    expect(scan(stepHtml(html, 1)).text).toContain(shown);
  });
});
