// The `lines` and `timeline` stage kinds as data and as static markup: the schemas, the checks a
// schema cannot express, the verb tables, the four example clips, and what the page carries with
// scripting off (order, whitespace, labels, escaping).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Action, ClipScene, VERBS, VERBS_BY_STAGE } from '../../src/core/clip';
import {
  EXTRA_KIT_VERBS,
  EXTRA_KIT_VERB_SUMMARY,
  EXTRA_STAGE_KINDS,
  EXTRA_VERBS_BY_STAGE,
  KITS_EXTRA_LIMITS,
  LinesStage,
  TRACK_ID,
  TimelineStage,
  checkExtraStage,
  extraStageParts,
} from '../../src/core/clip-kits-extra';
import { EXTRA_EXAMPLE_CLIPS, LINES_CODE_TRACE, LINES_DERIVATION, TIMELINE_HISTORY, TIMELINE_LANES } from '../../src/core/clip-kits-extra-examples';
import { EXAMPLE_EVIDENCE } from '../../src/core/examples';
import { parseMath } from '../../src/core/math';
import { type StageRenderContext, renderLinesStage, renderTimelineStage } from '../../src/render/clip-kits-extra';
import { attrs, domId, internalId } from '../../src/render/escape';
import { CODE_LABEL } from '../../src/render/figures';

const ctx = (sceneId = 's1', lang?: string): StageRenderContext => ({ ui: attrs({ lang }), id: (p) => domId(sceneId, p), own: (n) => internalId(sceneId, n) });
const lines = (over: Record<string, unknown> = {}): unknown => ({ kind: 'lines', format: 'code', lines: ['a = 1', 'b = 2'], cites: [], provenance: 'worked', ...over });
const timeline = (over: Record<string, unknown> = {}): unknown => ({
  kind: 'timeline',
  events: [
    { id: 'a', when: '1914', label: 'It begins' },
    { id: 'b', when: '1918', label: 'It ends' },
  ],
  cites: [],
  provenance: 'illustrative',
  ...over,
});
const messages = (stage: unknown): string[] => checkExtraStage((stage as { kind: string }).kind === 'lines' ? LinesStage.parse(stage) : TimelineStage.parse(stage)).map((p) => p.message);

describe('the lines stage schema', () => {
  it('accepts a plain stage and fills in nothing but the defaults', () => {
    const parsed = LinesStage.parse(lines({ cites: undefined }));
    expect(parsed.cites).toEqual([]);
    expect(parsed.lines).toEqual(['a = 1', 'b = 2']);
  });
  it('keeps the whitespace of a code line', () => {
    expect(LinesStage.parse(lines({ lines: ['if x:', '    return\t1  '] })).lines[1]).toBe('    return\t1  ');
  });
  it('is strict at every level', () => {
    expect(LinesStage.safeParse(lines({ colour: 'red' })).success).toBe(false);
    expect(LinesStage.safeParse(lines({ pointers: [{ id: 'p', x: 10 }] })).success).toBe(false);
    expect(LinesStage.safeParse(lines({ values: [{ id: 'v', at: 'l1', value: 1, duration: 300 }] })).success).toBe(false);
    expect(LinesStage.safeParse(lines({ annotations: [{ id: 'n', at: 'l1', text: 'x', html: '<b>' }] })).success).toBe(false);
  });
  it('holds the limits', () => {
    const L = KITS_EXTRA_LIMITS.lines;
    expect(LinesStage.safeParse(lines({ lines: [] })).success).toBe(false);
    expect(LinesStage.safeParse(lines({ lines: Array.from({ length: L.lines.max + 1 }, () => 'x') })).success).toBe(false);
    expect(LinesStage.safeParse(lines({ lines: ['x'.repeat(L.lineChars + 1)] })).success).toBe(false);
    expect(LinesStage.safeParse(lines({ pointers: Array.from({ length: L.pointers.max + 1 }, (_, i) => ({ id: `p${i}` })) })).success).toBe(false);
    expect(LinesStage.safeParse(lines({ annotations: Array.from({ length: L.annotations.max + 1 }, (_, i) => ({ id: `n${i}`, at: 'l1', text: 'x' })) })).success).toBe(false);
    expect(LinesStage.safeParse(lines({ stats: Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, label: 'x', value: 1 })) })).success).toBe(false);
    expect(LinesStage.safeParse(lines({ cites: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'] })).success).toBe(false);
  });
  it('wants a line reference where a part attaches to a line', () => {
    expect(LinesStage.safeParse(lines({ values: [{ id: 'v', at: 'line 1' }] })).success).toBe(false);
    expect(LinesStage.safeParse(lines({ values: [{ id: 'v', at: 'l13' }] })).success).toBe(false);
    expect(LinesStage.safeParse(lines({ values: [{ id: 'v', at: 'l2', label: 'b', value: 2, unit: ' ms' }] })).success).toBe(true);
  });
  it('wants one of the three provenances and one of the three formats', () => {
    expect(LinesStage.safeParse(lines({ provenance: 'measured' })).success).toBe(false);
    expect(LinesStage.safeParse(lines({ provenance: undefined })).success).toBe(false);
    expect(LinesStage.safeParse(lines({ format: 'html' })).success).toBe(false);
  });
});

describe('the timeline stage schema', () => {
  it('accepts a single track and a stage with lanes', () => {
    expect(TimelineStage.safeParse(timeline()).success).toBe(true);
    expect(TimelineStage.safeParse(TIMELINE_LANES.stage).success).toBe(true);
  });
  it('takes any text for `when`', () => {
    for (const when of ['1914', '+4 h', 'overnight', 'step 2']) expect(TimelineStage.safeParse(timeline({ events: [{ id: 'a', when, label: 'x' }, { id: 'b', when: 'later', label: 'y' }] })).success).toBe(true);
  });
  it('is strict at every level', () => {
    expect(TimelineStage.safeParse(timeline({ orientation: 'vertical' })).success).toBe(false);
    expect(TimelineStage.safeParse(timeline({ events: [{ id: 'a', when: '1', label: 'x', x: 3 }, { id: 'b', when: '2', label: 'y' }] })).success).toBe(false);
    expect(TimelineStage.safeParse(timeline({ spans: [{ id: 's', from: 'a', to: 'b', colour: 'red' }] })).success).toBe(false);
    expect(TimelineStage.safeParse(timeline({ markers: [{ id: 'm', at: 'a' }] })).success).toBe(false);
  });
  it('holds the limits', () => {
    const L = KITS_EXTRA_LIMITS.timeline;
    const many = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ id: `e${i}x`, when: String(i), label: 'x' }));
    expect(TimelineStage.safeParse(timeline({ events: many(1) })).success).toBe(false);
    expect(TimelineStage.safeParse(timeline({ events: many(L.events.max + 1) })).success).toBe(false);
    expect(TimelineStage.safeParse(timeline({ lanes: [{ id: 'one', label: 'One' }] })).success).toBe(false);
    expect(TimelineStage.safeParse(timeline({ lanes: Array.from({ length: 4 }, (_, i) => ({ id: `lane${i}`, label: 'x' })) })).success).toBe(false);
    expect(TimelineStage.safeParse(timeline({ events: [{ id: 'a', when: 'x'.repeat(L.whenChars + 1), label: 'x' }, { id: 'b', when: '2', label: 'y' }] })).success).toBe(false);
  });
});

describe('what a schema cannot say', () => {
  it('finds nothing wrong with the examples', () => {
    for (const clip of EXTRA_EXAMPLE_CLIPS) expect(checkExtraStage(ClipScene.parse(clip).stage as LinesStage | TimelineStage), clip.id).toEqual([]);
  });
  it('names an id that is used twice, including a line id and the track', () => {
    expect(messages(lines({ pointers: [{ id: 'pc' }], values: [{ id: 'pc', at: 'l1' }] }))[0]).toContain('"pc" is used twice');
    expect(messages(lines({ brackets: [{ id: 'l2' }] }))[0]).toContain('"l2" is used twice');
    expect(messages(timeline({ markers: [{ id: TRACK_ID }] }))[0]).toContain('"track" is used twice');
    expect(messages(timeline({ spans: [{ id: 'a', from: 'a', to: 'b' }] }))[0]).toContain('"a" is used twice');
  });
  it('names a part attached to a line that is not there', () => {
    expect(messages(lines({ annotations: [{ id: 'n', at: 'l3', text: 'x' }] }))[0]).toContain('lines l1 to l2');
    expect(messages(lines({ values: [{ id: 'v', at: 'l9' }] }))[0]).toContain('lines l1 to l2');
  });
  it('holds the row budget: a line is one row, an annotation two', () => {
    const stage = lines({ lines: Array.from({ length: 12 }, () => 'x'), annotations: [{ id: 'n1', at: 'l1', text: 'x' }, { id: 'n2', at: 'l2', text: 'y' }] });
    expect(messages(stage).join(' ')).toContain('need 16 rows');
    expect(messages(lines({ lines: Array.from({ length: 12 }, () => 'x'), annotations: [{ id: 'n1', at: 'l1', text: 'x' }] }))).toEqual([]);
  });
  it('keeps `language` and empty lines to code', () => {
    expect(messages(lines({ format: 'text', language: 'Python' })).join(' ')).toContain('"language" belongs to format "code"');
    expect(messages(lines({ format: 'math', lines: ['x = 1', ''] })).join(' ')).toContain('An empty line is allowed in code only');
    expect(messages(lines({ lines: ['x = 1', '', 'y = 2'] }))).toEqual([]);
  });
  it('checks lanes and spans against the events', () => {
    expect(messages(timeline({ events: [{ id: 'a', when: '1', label: 'x', lane: 'north' }, { id: 'b', when: '2', label: 'y' }] }))[0]).toContain('declares no lanes');
    const lanes = [{ id: 'north', label: 'North' }, { id: 'south', label: 'South' }];
    expect(messages(timeline({ lanes, events: [{ id: 'a', when: '1', label: 'x', lane: 'east' }, { id: 'b', when: '2', label: 'y', lane: 'north' }] })).join(' ')).toContain('The lanes are: north, south');
    expect(messages(timeline({ lanes, events: [{ id: 'a', when: '1', label: 'x', lane: 'north' }, { id: 'b', when: '2', label: 'y', lane: 'north' }] })).join(' ')).toContain('The lane "south" has no events');
    expect(messages(timeline({ spans: [{ id: 's', from: 'a', to: 'z' }] }))[0]).toContain('"z", which is not an event');
    expect(messages(timeline({ spans: [{ id: 's', from: 'b', to: 'a' }] }))[0]).toContain('must run forward');
  });
});

describe('verbs and parts', () => {
  it('lists every part a beat may name, with its kind', () => {
    const trace = extraStageParts(LinesStage.parse(LINES_CODE_TRACE.stage));
    expect(trace.get('l1')).toBe('line');
    expect(trace.get('l11')).toBe('line');
    expect(trace.has('l12')).toBe(false);
    expect([trace.get('pc'), trace.get('loop'), trace.get('why'), trace.get('mid'), trace.get('checks')]).toEqual(['pointer', 'bracket', 'annotation', 'value', 'stat']);
    const lanes = extraStageParts(TimelineStage.parse(TIMELINE_LANES.stage));
    expect([lanes.get(TRACK_ID), lanes.get('low'), lanes.get('a1'), lanes.get('all'), lanes.get('now'), lanes.get('width')]).toEqual(['track', 'lane', 'event', 'span', 'marker', 'stat']);
  });
  it('offers only verbs the clip format has, and the same ones core/clip lists for the stage', () => {
    for (const kind of EXTRA_STAGE_KINDS) {
      for (const verb of EXTRA_VERBS_BY_STAGE[kind]) expect(VERBS as readonly string[]).toContain(verb);
      expect([...EXTRA_VERBS_BY_STAGE[kind]].sort()).toEqual(Object.keys(EXTRA_KIT_VERBS[kind]).sort());
      expect([...(VERBS_BY_STAGE[kind] ?? [])].sort()).toEqual([...EXTRA_VERBS_BY_STAGE[kind]].sort());
      for (const verb of EXTRA_VERBS_BY_STAGE[kind]) expect(EXTRA_KIT_VERB_SUMMARY[kind]).toContain(verb);
    }
  });
});

describe('the example clips', () => {
  const evidence = new Set(EXAMPLE_EVIDENCE.map((_, i) => `e${i + 1}`));
  const words = (text: string): number => text.trim().split(/\s+/).length;

  it('are two of each kind, and each parses as a clip scene', () => {
    expect(EXTRA_EXAMPLE_CLIPS.map((c) => c.stage.kind)).toEqual(['lines', 'lines', 'timeline', 'timeline']);
    expect((LINES_CODE_TRACE.stage as LinesStage).format).toBe('code');
    expect((LINES_DERIVATION.stage as LinesStage).format).toBe('math');
    expect((TIMELINE_HISTORY.stage as TimelineStage).lanes).toBeUndefined();
    expect((TIMELINE_LANES.stage as TimelineStage).lanes).toHaveLength(3);
    for (const clip of EXTRA_EXAMPLE_CLIPS) expect(ClipScene.safeParse(clip).error?.issues ?? [], clip.id).toEqual([]);
    expect(new Set(EXTRA_EXAMPLE_CLIPS.map((c) => c.id)).size).toBe(4);
  });
  it('contain no duration, easing, coordinate or colour', () => {
    const forbidden = /"(duration|delay|ease|easing|x|y|w|h|width|height|left|top|color|colour|ms|px)"\s*:/;
    for (const clip of EXTRA_EXAMPLE_CLIPS) expect(JSON.stringify(clip), clip.id).not.toMatch(forbidden);
  });
  it('use each verb only on a part of a kind that takes it', () => {
    for (const clip of EXTRA_EXAMPLE_CLIPS) {
      const stage = clip.stage as LinesStage | TimelineStage;
      const parts = extraStageParts(stage);
      const table = EXTRA_KIT_VERBS[stage.kind] as Record<string, readonly string[]>;
      for (const beat of clip.beats) {
        for (const action of beat.do) {
          const a = Action.parse(action) as { verb: string; target?: string; targets?: string[]; to?: string | string[]; between?: string[]; upto?: string };
          expect(Object.keys(table), `${clip.id}: ${a.verb}`).toContain(a.verb);
          for (const id of a.targets ?? (a.target === undefined ? [] : [a.target])) {
            expect(parts.has(id), `${clip.id}: "${id}" is a part`).toBe(true);
            expect(table[a.verb], `${clip.id}: ${a.verb} on ${id}`).toContain(parts.get(id));
          }
          for (const id of [a.to ?? [], a.between ?? [], a.upto ?? []].flat()) expect(parts.has(id), `${clip.id}: "${id}" is a part`).toBe(true);
        }
      }
    }
  });
  it('keep captions short, cue only words the caption has, and cite only stored evidence', () => {
    for (const clip of EXTRA_EXAMPLE_CLIPS) {
      for (const cite of clip.stage.cites) expect(evidence.has(cite), `${clip.id} stage cites ${cite}`).toBe(true);
      for (const beat of clip.beats) {
        expect(words(beat.caption.text), `${clip.id}: "${beat.caption.text}"`).toBeLessThanOrEqual(20);
        const cited = beat.caption.type === 'claim' ? beat.caption.cites : beat.caption.type === 'example' ? (beat.caption.basedOn ?? []) : [];
        if (beat.caption.type === 'claim') expect(cited.length, `${clip.id}: a claim cites`).toBeGreaterThan(0);
        for (const cite of cited) expect(evidence.has(cite), `${clip.id} cites ${cite}`).toBe(true);
        for (const action of beat.do) if (action.on !== undefined) expect(beat.caption.text.toLowerCase()).toContain(action.on.toLowerCase());
      }
    }
  });
  it('trace the example lesson\'s own function, and derive in maths that parses', () => {
    expect((LINES_CODE_TRACE.stage as LinesStage).lines[0]).toBe('def binary_search(items, target):');
    expect((LINES_CODE_TRACE.stage as LinesStage).lines).toHaveLength(11);
    for (const line of (LINES_DERIVATION.stage as LinesStage).lines) expect(parseMath(line).ok, line).toBe(true);
  });
  it('gate only on a beat after the first', () => {
    for (const clip of EXTRA_EXAMPLE_CLIPS) expect(clip.beats[0]?.gate, clip.id).toBeUndefined();
  });
});

describe('a lines stage as static markup', () => {
  const html = (stage: unknown, c = ctx()): string => renderLinesStage(LinesStage.parse(stage), c).toString();

  it('is an ordered list of the lines, in order, each with its part id', () => {
    const out = html(LINES_CODE_TRACE.stage, ctx('trace'));
    expect(out.match(/<li id="lt-trace-l\d+" data-line="l\d+">/g)).toHaveLength(11);
    expect(out.indexOf('data-line="l1"')).toBeLessThan(out.indexOf('data-line="l2"'));
    expect(out).toContain('<ol class="lt-xs-lines" role="list" data-format="code"');
    expect(out).toContain('<li id="lt-trace-l1" data-line="l1"><span class="lt-xs-line"><code>def binary_search(items, target):</code></span></li>');
  });
  it('labels code as the agent\'s, with the words v1 uses, and offers no copy button', () => {
    const out = html(LINES_CODE_TRACE.stage);
    expect(out).toContain(`<p class="lt-xs-flag">${CODE_LABEL}</p>`);
    expect(CODE_LABEL).toBe('Code written by your agent. Read it before you run it.');
    expect(out).toContain('<span class="lt-xs-language">Python</span>');
    expect(out).not.toMatch(/<button|copy/i);
    expect(html(lines({ format: 'text' }))).not.toContain(CODE_LABEL);
  });
  it('says the same words on the stage as in the page', () => {
    const kit = readFileSync(new URL('../../src/player/stage/kit-lines.ts', import.meta.url), 'utf8');
    expect(kit).toContain(`export const LINES_CODE_LABEL = '${CODE_LABEL}';`);
    expect(kit).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|setAttribute\('style'|clipboard/);
    const timelineKit = readFileSync(new URL('../../src/player/stage/kit-timeline.ts', import.meta.url), 'utf8');
    expect(timelineKit).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|setAttribute\('style'|clipboard/);
  });
  it('preserves the whitespace of code', () => {
    expect(html(lines({ lines: ['if x:', '        return  1'] }))).toContain('<code>        return  1</code>');
  });
  it('puts an annotation under its line, and names values, brackets and pointers', () => {
    const out = html(LINES_CODE_TRACE.stage, ctx('trace'));
    expect(out).toMatch(/data-line="l8">.*?<span class="lt-xs-note" id="lt-trace-why"><span class="lt-vh">Note: <\/span>Sorted: nothing at or before mid can be 42\.<\/span><\/li>/);
    expect(out).toContain('<li id="lt-trace-mid"><span class="lt-xs-key">mid</span><span>: a value shown beside line 4</span></li>');
    expect(out).toContain('<span class="lt-xs-key">one pass</span><span>: a bracket round a range of lines</span>');
    expect(html(lines({ values: [{ id: 'v', at: 'l2', label: 'b', value: 2, unit: ' ms' }] }))).toContain('<span>, starting at </span><span class="lt-xs-value">2 ms</span>');
  });
  it('renders maths through core/math, one <math> per run, and falls back to the source as code', () => {
    const out = html(LINES_DERIVATION.stage);
    expect(out).toContain('data-format="math"');
    expect(out.match(/<math display="block">/g)?.length).toBeGreaterThanOrEqual(4);
    expect(out).toContain('<mfrac>');
    expect(out).not.toContain('\\frac');
    const broken = html(lines({ format: 'math', lines: ['\\unknowncommand{<b>}'] }));
    expect(broken).toContain('<code>\\unknowncommand{&lt;b&gt;}</code>');
    expect(broken).not.toContain('<math');
  });
  it('escapes everything a lesson can write', () => {
    const attack = '<img src=x onerror=alert(1)>"\'&';
    const out = html(lines({ language: attack.slice(0, 20), lines: [attack, '</code></li><script>alert(1)</script>'], annotations: [{ id: 'n', at: 'l1', text: attack }], values: [{ id: 'v', at: 'l1', label: attack.slice(0, 16), value: '<b>' }], brackets: [{ id: 'b', label: '<i>x</i>' }], pointers: [{ id: 'p', label: '<u>' }] }));
    expect(out).not.toMatch(/<(img|script|b|i|u)[\s>]/);
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;');
    expect(out).toContain('&lt;/code&gt;&lt;/li&gt;&lt;script&gt;');
    // No element carries a style or a handler: what looks like one above is text, with its angle brackets escaped.
    expect(out).not.toMatch(/<[^>]*\s(style|on[a-z]+)=/);
  });
  it('marks interface words in a lesson written in another language', () => {
    const out = html(LINES_CODE_TRACE.stage, ctx('s1', 'en'));
    expect(out).toContain('<p class="lt-xs-flag" lang="en">');
    expect(out).toContain('<span class="lt-label" lang="en">Code</span>');
  });
});

describe('a timeline stage as static markup', () => {
  const html = (stage: unknown, c = ctx()): string => renderTimelineStage(TimelineStage.parse(stage), c).toString();

  it('is an ordered list of the events with their `when`, in order', () => {
    const out = html(TIMELINE_HISTORY.stage, ctx('twenty'));
    expect(out.match(/<li id="lt-twenty-s\d+" data-event="s\d+">/g)).toHaveLength(6);
    expect(out).toContain('<li id="lt-twenty-s1" data-event="s1"><span class="lt-xs-when">step 1</span> <span class="lt-xs-what">500,000 left</span></li>');
    expect(out.indexOf('data-event="s0"')).toBeLessThan(out.indexOf('data-event="s20"'));
    expect(out).toContain('<span class="lt-xs-detail">Checking every item in turn could take 1,000,000 comparisons.</span>');
  });
  it('writes each span as a sentence', () => {
    expect(html(TIMELINE_HISTORY.stage, ctx('twenty'))).toContain(
      '<li id="lt-twenty-run"><span class="lt-xs-key">20 steps</span><span class="lt-vh">: </span> <span>from </span><span class="lt-xs-when">start</span> (1,000,000 items could hold the target)<span> to </span><span class="lt-xs-when">step 20</span> (1 left: found, or not there)</li>',
    );
  });
  it('names the lanes, and each event\'s lane', () => {
    const out = html(TIMELINE_LANES.stage);
    expect(out).toContain('<span class="lt-xs-lanes">low · mid · high</span>');
    expect(out).toContain('<span class="lt-xs-when">pass 1</span> <span class="lt-xs-lane">mid</span><span class="lt-vh">: </span> <span class="lt-xs-what">mid = 3 holds 23: too small</span>');
    // The event that spans the lanes names none.
    expect(out).toMatch(/data-event="d"><span class="lt-xs-when">pass 3<\/span> <span class="lt-xs-what">/);
  });
  it('escapes everything a lesson can write', () => {
    const attack = '<svg onload=alert(1)>&"';
    const out = html(
      timeline({
        lanes: [{ id: 'one', label: attack }, { id: 'two', label: 'Two' }],
        events: [{ id: 'a', when: attack, label: attack, detail: attack, lane: 'one' }, { id: 'b', when: '2', label: 'y', lane: 'two' }],
        spans: [{ id: 's', from: 'a', to: 'b', label: attack }],
      }),
    );
    expect(out).not.toMatch(/<svg|<[^>]*\s(style|on[a-z]+)=/);
    expect(out.match(/&lt;svg onload=alert\(1\)&gt;&amp;&quot;/g)?.length).toBeGreaterThanOrEqual(5);
  });
});
