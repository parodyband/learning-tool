// A clip as static markup: with scripting off it must be a readable account of the scene, it must
// carry what the engine moves into the stage, and nothing a lesson says may leave the place it
// was put.
import { describe, expect, it } from 'vitest';
import type { ClipScene } from '../../src/core/clip';
import { EXAMPLE_CLIPS } from '../../src/core/clip-examples';
import { FRAME_EXAMPLE_SORT } from '../../src/core/frame-examples';
import { CLIP, beatSegment } from '../../src/render/clip';
import { readEmbeddedData, renderLesson, renderLessonHtml } from '../../src/render/index';
import { STEPS } from '../../src/render/steps';
import { ALLOWED_TAGS, PAYLOADS, type Reach, type Scanned, type Tag, attrAllowed, elements, poison, scan } from '../render/helpers';
import { asPublished, beatSegments, exampleKitsLesson, exampleLessonV2, examplePublishedV2, exploreLesson, withSilentBeats } from '../helpers/clip-example';

const published = examplePublishedV2();
const lesson = exampleLessonV2();
const doc = renderLessonHtml(published);
const s = scan(doc);
const clips = lesson.scenes.filter((x): x is ClipScene => x.kind === 'clip');

const has = (tag: Tag, cls: string): boolean => (tag.attrs.get('class') ?? '').split(/\s+/).includes(cls);
const withClass = (sc: Scanned, name: string, cls: string): Tag[] => elements(sc, name).filter((t) => has(t, cls));
/** The markup of one scene's section, from its opening tag to the next section (or the pager). */
function sectionOf(html: string, sceneId: string): string {
  const start = html.indexOf(`data-scene="${sceneId}"`);
  expect(start, `section for ${sceneId}`).toBeGreaterThan(-1);
  const next = html.indexOf('<section', start);
  const pager = html.indexOf('<nav class="lt-pager"', start);
  return html.slice(html.lastIndexOf('<section', start), next === -1 ? pager : Math.min(next, pager === -1 ? next : pager));
}

describe('the page around clips', () => {
  it('writes only known elements and attributes, with no style attribute, handler or comment', () => {
    for (const tag of s.tags) {
      expect(ALLOWED_TAGS.has(tag.name), `<${tag.name}>`).toBe(true);
      if (tag.closing) continue;
      for (const name of tag.attrs.keys()) {
        expect(attrAllowed(name), `${tag.name}[${name}]`).toBe(true);
        expect(name === 'style' || name.startsWith('on'), `${tag.name}[${name}]`).toBe(false);
      }
    }
    expect(s.comments).toEqual([]);
    expect(doc.slice(doc.indexOf('<body>'), doc.indexOf('<script type="application/json"'))).not.toMatch(/\sstyle\s*=|\son[a-z]+\s*=/i);
  });

  it('gives every element its own id, all of them made by the renderer', () => {
    const ids = s.tags.filter((t) => !t.closing && t.attrs.has('id')).map((t) => t.attrs.get('id') as string);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(lt|scene)-[A-Za-z0-9_-]+$/);
  });

  it('renders one wide section per scene, a clip marked as a clip', () => {
    const sections = withClass(s, 'section', 'lt-scene');
    expect(sections).toHaveLength(lesson.scenes.length);
    for (const scene of clips) {
      const section = sections.find((t) => t.attrs.get('data-scene') === scene.id);
      expect(section?.attrs.get('data-kind')).toBe('clip');
      expect(has(section as Tag, 'lt-kind-clip')).toBe(true);
      expect(has(section as Tag, 'lt-scene-wide')).toBe(true);
    }
    // The header is laid out for a wide first scene, and the checkpoints are untouched.
    expect(has(elements(s, 'header')[0] as Tag, 'lt-top-wide')).toBe(true);
    expect(sections.filter((t) => t.attrs.get('data-kind') === 'checkpoint')).toHaveLength(3);
  });

  it('embeds the clips in the page data exactly as they were given', () => {
    const data = readEmbeddedData(doc);
    expect(data?.lesson.scenes).toEqual(lesson.scenes);
  });

  it('is the same bytes every time', () => {
    expect(renderLessonHtml(examplePublishedV2())).toBe(doc);
  });
});

describe('a clip with scripting off', () => {
  for (const scene of clips) {
    const part = sectionOf(doc, scene.id);
    const sc = scan(part);

    it(`${scene.id}: says what the clip shows, then each beat in order, then what is on stage`, () => {
      const root = withClass(sc, 'div', 'lt-clip')[0];
      expect(root?.attrs.get('data-clip')).toBe(scene.id);
      expect(root?.attrs.get('data-stage')).toBe(scene.stage.kind);
      expect(sc.text).toContain(scene.description);
      const order = [part.indexOf('lt-clip-desc'), part.indexOf('lt-prov'), part.indexOf('lt-beats'), part.indexOf('lt-onstage')];
      expect(order.every((i) => i > -1)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      const beats = withClass(sc, 'li', 'lt-beat');
      expect(beats.map((b) => b.attrs.get('data-beat'))).toEqual(scene.beats.map((_, i) => String(i + 1)));
      for (const b of scene.beats) expect(sc.text.replace(/ /g, ' '), b.caption.text).toContain(b.caption.text);
    });

    it(`${scene.id}: marks each caption with its narration segment and cites its sources as chips`, () => {
      const caps = withClass(sc, 'div', 'lt-cap');
      expect(caps.map((c) => c.attrs.get('data-narration'))).toEqual(scene.beats.map((_, i) => beatSegment(scene.id, i)));
      for (const c of caps) expect(c.attrs.has('data-voice')).toBe(false);
      const cited = scene.beats.filter((b) => b.caption.type === 'claim' || b.caption.type === 'quote').length;
      const chips = withClass(sc, 'button', 'lt-chip');
      expect(chips.length).toBeGreaterThanOrEqual(cited + (scene.stage.cites?.length ?? 0));
      const popovers = new Set(elements(sc, 'div').filter((t) => t.attrs.has('popover')).map((t) => t.attrs.get('id')));
      for (const chip of chips) expect(popovers.has(chip.attrs.get('popovertarget'))).toBe(true);
    });

    it(`${scene.id}: states where the stage's content comes from, in words`, () => {
      const prov = withClass(sc, 'p', 'lt-prov')[0];
      expect(prov?.attrs.get('data-provenance')).toBe(scene.stage.provenance);
      const word = { sourced: CLIP.sourced, worked: CLIP.worked, illustrative: CLIP.illustrative }[scene.stage.provenance];
      const note = { sourced: CLIP.sourcedNote, worked: CLIP.workedNote, illustrative: CLIP.illustrativeNote }[scene.stage.provenance];
      expect(sc.text).toContain(word);
      expect(sc.text).toContain(note);
    });

    it(`${scene.id}: writes each prediction as plain text with its answer in a disclosure`, () => {
      const gated = scene.beats.map((b, i) => ({ b, i })).filter(({ b }) => b.gate);
      expect(withClass(sc, 'li', 'lt-beat').filter((t) => t.attrs.get('data-gate') === 'true')).toHaveLength(gated.length);
      expect(withClass(sc, 'div', 'lt-predict')).toHaveLength(gated.length);
      expect(elements(sc, 'details').filter((t) => t.attrs.has('data-answer'))).toHaveLength(gated.length);
      for (const { b } of gated) {
        const gate = b.gate as NonNullable<typeof b.gate>;
        expect(sc.text).toContain(gate.prompt);
        if ('options' in gate) {
          for (const o of gate.options) {
            expect(sc.text).toContain(o.text);
            expect(sc.text).toContain(o.feedback);
          }
        } else {
          // Answered on the picture: the right part by name and both reasons are in the disclosure.
          expect(sc.text).toContain(gate.right);
          expect(sc.text).toContain(gate.wrong);
        }
        // The question comes before the caption that answers it.
        expect(part.indexOf(b.gate?.prompt as string)).toBeLessThan(part.indexOf(b.caption.text.slice(0, 20)));
      }
      // Nothing the script must wake is operable before it has: radios and buttons are hidden.
      for (const input of elements(sc, 'input')) expect(input.attrs.has('hidden')).toBe(true);
      for (const p of elements(sc, 'p').filter((t) => t.attrs.has('data-actions'))) expect(p.attrs.has('hidden')).toBe(true);
      if (gated.some(({ b }) => b.gate && 'options' in b.gate)) expect(sc.text).toContain(STEPS.checkPredict);
    });
  }

  it('writes a tapped prediction as a question, with the right part named in a disclosure', () => {
    const part = sectionOf(doc, 'c3');
    const sc = scan(part);
    const pick = withClass(sc, 'div', 'lt-pick');
    expect(pick).toHaveLength(1);
    expect(pick[0]?.attrs.has('data-pick')).toBe(true);
    const from = part.indexOf('data-pick');
    const text = scan(part.slice(from, part.indexOf('class="lt-cap"', from))).text;
    expect(text).toContain('Three cells are still possible. Tap the one the search looks at next.');
    // The cell is named by what it holds, not by its id.
    expect(text).toContain(`${CLIP.pickRight} 57`);
    expect(text).toContain('Yes. The middle of positions 4 to 6 is position 5');
    expect(text).toContain(CLIP.pickOthers);
    // The instruction to tap, and the buttons, need the script: they are hidden until it wakes them.
    const how = elements(sc, 'p').find((t) => t.attrs.has('data-how'));
    expect(how?.attrs.has('hidden')).toBe(true);
    expect(text.indexOf('Three cells')).toBeLessThan(text.indexOf(`${CLIP.pickRight} 57`));
  });

  it('lists the parts of every kind of stage as text', () => {
    const text = (id: string): string => scan(sectionOf(doc, id)).text;
    expect(text('c1')).toContain('How few looks are enough?');
    expect(text('c2')).toContain('Is it the target? → Discard a half: no');
    expect(text('c3')).toContain('3, 8, 15, 23, 42, 57, 91');
    expect(text('c3')).toContain('Comparisons: 0');
    expect(text('c4')).toContain('Binary search: 8 4, 64 7, 512 10, 4,096 13');
    expect(text('c5')).toContain('Sorted items: 1,000');
    expect(text('c5')).toContain('1 dot = 1 item');
    expect(text('c6')).toContain('Midpoint: (low + high) / 2');
  });
});

describe('every stage kind', () => {
  const kits = exampleKitsLesson();
  const kitsDoc = renderLessonHtml(asPublished(kits));
  const ks = scan(kitsDoc);

  it('renders one clip per kind, with only known elements and attributes', () => {
    const roots = withClass(ks, 'div', 'lt-clip');
    expect(roots.map((t) => t.attrs.get('data-stage'))).toEqual(Object.values(EXAMPLE_CLIPS).map((c) => c.stage.kind));
    for (const tag of ks.tags) {
      expect(ALLOWED_TAGS.has(tag.name), `<${tag.name}>`).toBe(true);
      if (tag.closing) continue;
      for (const name of tag.attrs.keys()) expect(attrAllowed(name), `${tag.name}[${name}]`).toBe(true);
    }
    const ids = ks.tags.filter((t) => !t.closing && t.attrs.has('id')).map((t) => t.attrs.get('id') as string);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('says which mark a chart has', () => {
    expect(withClass(ks, 'div', 'lt-clip').find((t) => t.attrs.get('data-stage') === 'chart')?.attrs.get('data-mark')).toBe('bars');
    expect(withClass(s, 'div', 'lt-clip').find((t) => t.attrs.get('data-stage') === 'chart')?.attrs.get('data-mark')).toBe('line');
  });

  it('never writes a custom frame\'s code into the markup: it travels in the data element only', () => {
    const code = FRAME_EXAMPLE_SORT.stage.code;
    const probe = code.slice(0, 60);
    const before = kitsDoc.slice(0, kitsDoc.indexOf('<script type="application/json"'));
    expect(before).not.toContain(probe);
    expect(JSON.stringify(readEmbeddedData(kitsDoc)?.lesson.scenes)).toContain(JSON.stringify(code).slice(1, 40));
    expect(scan(sectionOf(kitsDoc, 'k-frame')).text).toContain(EXAMPLE_CLIPS.frame.description);
  });
});

describe('explore, with scripting off', () => {
  const xpLesson = exploreLesson();
  const xpPublished = asPublished(xpLesson);
  const xdoc = renderLessonHtml(xpPublished);
  const xs = scan(xdoc);
  const scenes = xpLesson.scenes.filter((x): x is ClipScene => x.kind === 'clip');

  it('writes only known elements and attributes, and ids of its own making', () => {
    for (const tag of xs.tags) {
      expect(ALLOWED_TAGS.has(tag.name), `<${tag.name}>`).toBe(true);
      if (tag.closing) continue;
      for (const name of tag.attrs.keys()) {
        expect(attrAllowed(name), `${tag.name}[${name}]`).toBe(true);
        expect(name === 'style' || name.startsWith('on'), `${tag.name}[${name}]`).toBe(false);
      }
    }
    const ids = xs.tags.filter((t) => !t.closing && t.attrs.has('id')).map((t) => t.attrs.get('id') as string);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(lt|scene)-[A-Za-z0-9_-]+$/);
  });

  for (const scene of scenes) {
    it(`${scene.id}: the prompt, each slider with where it starts and how far it goes, the goal, and what reaching it shows`, () => {
      const part = sectionOf(xdoc, scene.id);
      const sc = scan(part);
      const x = scene.explore as NonNullable<ClipScene['explore']>;
      expect(withClass(sc, 'div', 'lt-explore')).toHaveLength(1);
      expect(sc.text).toContain(CLIP.yourTurn);
      expect(sc.text).toContain(x.prompt);
      const rows = elements(sc, 'div').filter((t) => t.attrs.has('data-control'));
      expect(rows.map((t) => t.attrs.get('data-control'))).toEqual(x.controls.map((c) => c.id));
      const ranges = elements(sc, 'input').filter((t) => t.attrs.get('type') === 'range');
      expect(ranges).toHaveLength(x.controls.length);
      for (const [i, c] of x.controls.entries()) {
        expect(sc.text).toContain(c.label);
        // Where it starts and its two ends, as text, with the unit.
        expect(sc.text).toMatch(new RegExp(`${CLIP.startsAt} ${String(c.value).replace('.', '\\.')}[.0]*${(c.unit ?? '').replace(/[%]/g, '%')}`));
        const input = ranges[i];
        expect(input?.attrs.get('value'), `${c.id}: its range input`).toBe(String(c.value));
        expect(input?.attrs.get('min')).toBe(String(c.min));
        expect(input?.attrs.get('max')).toBe(String(c.max));
        expect(input?.attrs.get('step')).toBe(String(c.step));
        // A slider that moves nothing is not offered: it is hidden until the script wakes it, and its label points at it.
        expect(input?.attrs.has('hidden')).toBe(true);
        expect(elements(sc, 'label').some((l) => l.attrs.get('for') === input?.attrs.get('id'))).toBe(true);
      }
      const goal = x.goal as NonNullable<typeof x.goal>;
      expect(sc.text).toContain(goal.text);
      // `done` is behind a disclosure, after the goal.
      const from = part.indexOf('data-goal');
      const details = part.indexOf('<details', from);
      expect(details).toBeGreaterThan(from);
      expect(part.indexOf(goal.done, details)).toBeGreaterThan(details);
      expect(part.slice(from, details)).not.toContain(goal.done);
      expect(sc.text).toContain(CLIP.goalDone);
      // "Replay the clip" needs the script.
      const actions = elements(sc, 'p').filter((t) => t.attrs.has('data-actions'));
      expect(actions.length).toBeGreaterThan(0);
      for (const p of actions) expect(p.attrs.has('hidden')).toBe(true);
      // The panel comes after the beats and before the list of what is on stage.
      expect(part.indexOf('lt-explore')).toBeGreaterThan(part.lastIndexOf('lt-cap'));
      expect(part.indexOf('lt-explore')).toBeLessThan(part.indexOf('lt-onstage'));
      // No formula is written into the page as prose: formulas travel in the data element only.
      for (const b of x.bind) if (b.expr.length > 3) expect(sc.text).not.toContain(b.expr);
    });
  }

  it('lists a curve chart as text: the axis, the curves and the marked points', () => {
    const text = scan(sectionOf(xdoc, 'x-curve')).text;
    expect(text).toContain('Cups a day: 0 to 140');
    expect(text).toContain(CLIP.curves);
    expect(text).toContain('Supply');
    expect(text).toContain('Demand');
    expect(text).toContain('Market price (Supply)');
    expect(text).toContain('Price: 5');
    expect(text).toContain('Cups sold: 60');
    expect(withClass(xs, 'div', 'lt-clip').map((t) => `${t.attrs.get('data-stage')}/${t.attrs.get('data-mark') ?? ''}`)).toEqual(['dots/', 'chart/curve', 'chart/bars']);
  });

  it('carries the explore and the tap gates to the player in the data element', () => {
    const data = readEmbeddedData(xdoc)?.lesson.scenes as unknown as ClipScene[];
    expect(data.map((sc) => sc.explore?.controls.map((c) => c.id))).toEqual([['rate'], ['demand', 'costs'], ['n']]);
    expect(data[0]?.beats.some((b) => b.gate && 'pick' in b.gate)).toBe(true);
  });

  it('keeps every payload as text, whatever a lesson puts in an explore or a tap gate', () => {
    const baseline = { input: elements(xs, 'input').length, button: elements(xs, 'button').length, svg: elements(xs, 'svg').length };
    for (const reach of ['prose', 'strings', 'everything'] as Reach[]) {
      for (const [i, payload] of PAYLOADS.entries()) {
        const out = scan(renderLessonHtml(poison(xpPublished, reach, () => payload)));
        const label = `payload ${i} in ${reach}`;
        for (const tag of out.tags) {
          expect(ALLOWED_TAGS.has(tag.name), `${label}: unexpected <${tag.name}>`).toBe(true);
          if (tag.closing) continue;
          for (const [name, value] of tag.attrs) {
            expect(attrAllowed(name), `${label}: unexpected attribute ${tag.name}[${name}]`).toBe(true);
            expect(name.startsWith('on') || name === 'style' || name === 'src', `${label}: ${tag.name}[${name}]`).toBe(false);
            if (name === 'id' || name === 'for') expect(value, `${label}: ${tag.name}[${name}]`).toMatch(/^(lt|scene)-[A-Za-z0-9_-]+$/);
          }
        }
        expect(elements(out, 'input').length, `${label}: inputs`).toBeLessThanOrEqual(baseline.input);
        expect(elements(out, 'button').length, `${label}: buttons`).toBeLessThanOrEqual(baseline.button);
        expect(elements(out, 'svg').length, `${label}: svg`).toBeLessThanOrEqual(baseline.svg);
        expect(elements(out, 'script').map((t) => t.attrs.get('type') ?? 'classic'), `${label}: scripts`).toEqual(['application/json', 'classic']);
      }
    }
  });
});

describe('narration clips for beats', () => {
  const voiced = withSilentBeats();
  const vdoc = renderLesson(voiced).html;
  const vs = scan(vdoc);
  const segments = beatSegments(lesson);

  it('embeds one clip per beat under "<sceneId>.beat<N>" and tells each caption it has one', () => {
    const embedded = elements(vs, 'script').filter((t) => t.attrs.get('type') === 'application/octet-stream').map((t) => t.attrs.get('data-seg'));
    expect(embedded).toEqual(segments);
    const caps = withClass(vs, 'div', 'lt-cap');
    expect(caps.filter((c) => c.attrs.get('data-voice') === 'true').map((c) => c.attrs.get('data-narration'))).toEqual(segments);
    expect(elements(vs, 'audio')).toHaveLength(1);
  });

  it('drops a clip whose segment is not a beat of a scene in the lesson', () => {
    const odd = { ...voiced, audio: { ...(voiced.audio as NonNullable<typeof voiced.audio>), clips: [{ segmentId: 'c1.beat0', mime: 'audio/mpeg' as const, base64: 'QUJD' }, { segmentId: 'zz.beat1', mime: 'audio/mpeg' as const, base64: 'QUJD' }, { segmentId: 'c1.beat1', mime: 'audio/mpeg' as const, base64: 'QUJD' }] } };
    const out = scan(renderLesson(odd).html);
    expect(elements(out, 'script').filter((t) => t.attrs.get('type') === 'application/octet-stream').map((t) => t.attrs.get('data-seg'))).toEqual(['c1.beat1']);
  });
});

describe('payloads in a lesson made of clips', () => {
  const baseline = { svg: elements(s, 'svg').length, input: elements(s, 'input').length, button: elements(s, 'button').length };

  function assertInert(out: string, label: string): void {
    const sc = scan(out);
    for (const tag of sc.tags) {
      expect(ALLOWED_TAGS.has(tag.name), `${label}: unexpected <${tag.name}>`).toBe(true);
      if (tag.closing) continue;
      for (const [name, value] of tag.attrs) {
        expect(attrAllowed(name), `${label}: unexpected attribute ${tag.name}[${name}]`).toBe(true);
        expect(name.startsWith('on') || name === 'style' || name === 'srcdoc' || name === 'src' || name === 'action' || name === 'formaction', `${label}: ${tag.name}[${name}]`).toBe(false);
        if (name === 'href') expect(/^#(lt|scene)-[A-Za-z0-9_-]+$/.test(value) || /^https?:\/\/[^\s"<>]+$/.test(value), `${label}: href ${value.slice(0, 60)}`).toBe(true);
        if (name === 'id' || name === 'popovertarget' || name === 'for' || name === 'aria-labelledby' || name === 'aria-describedby') expect(value, `${label}: ${tag.name}[${name}]`).toMatch(/^(lt|scene)-[A-Za-z0-9_-]+$/);
        if (name === 'class') expect(value, `${label}: class`).toMatch(/^[a-z0-9_ -]*$/);
      }
    }
    expect(sc.comments, `${label}: comments`).toEqual([]);
    expect(elements(sc, 'script').map((t) => t.attrs.get('type') ?? 'classic'), `${label}: scripts`).toEqual(['application/json', 'classic']);
    expect(elements(sc, 'style'), `${label}: style elements`).toHaveLength(1);
    expect(elements(sc, 'main'), `${label}: main`).toHaveLength(1);
    expect(elements(sc, 'svg').length, `${label}: svg`).toBeLessThanOrEqual(baseline.svg);
    expect(elements(sc, 'input').length, `${label}: inputs`).toBeLessThanOrEqual(baseline.input);
    expect(elements(sc, 'button').length, `${label}: buttons`).toBeLessThanOrEqual(baseline.button);
    expect(() => JSON.parse(elements(sc, 'script')[0]?.content ?? ''), `${label}: data`).not.toThrow();
  }

  for (const reach of ['prose', 'strings', 'everything'] as Reach[]) {
    it(`keeps every payload as text, written into ${reach}`, () => {
      for (const [i, payload] of PAYLOADS.entries()) {
        for (const source of [published, asPublished(exampleKitsLesson())]) {
          const out = renderLessonHtml(poison(source, reach, () => payload));
          assertInert(out, `payload ${i} in ${reach}`);
        }
      }
    });
  }

  it('shows a payload in a caption, a part label and a prediction as the characters it is', () => {
    const payload = '<img src=x onerror=window.__xss=1>';
    const out = renderLessonHtml(poison(published, 'prose', () => payload));
    const part = scan(sectionOf(out, 'c3'));
    expect(elements(part, 'img')).toHaveLength(0);
    expect(part.text.split(payload).length - 1).toBeGreaterThan(10);
  });
});
