// The static account of two stage kinds, `lines` and `timeline`: what a reader has of the stage
// with scripting off, in print, or folded under the player as the clip's text version. Lines are an
// ordered list (code keeps its whitespace and carries its label, and never has a copy button);
// events are an ordered list with their `when`.
//
// render/clip.ts calls one function per kind and places the result in the clip's static block.
// Stats, the description and the captions are common to every stage and are written there.
//
// What the player reads back from this markup, so the two files change together:
//   ol.lt-xs-lines > li[data-line]   in `math` format each line holds one or more <math>; the lines
//                                    kit (player/stage/kit-lines.ts) clones them onto the stage.
//                                    MathML is made only by core/math, here, at publish time.
import type { LinesStage, TimelineStage } from '../core/clip-kits-extra';
import { type MathNode, mathToMathML, parseMath } from '../core/math';
import { type Attrs, type Html, html, raw } from './escape';
import { CODE_LABEL } from './figures';

/** The part of a scene's render context these two functions use. A `RenderContext` is one. */
export interface StageRenderContext {
  /** ` lang="en"` for interface words in a lesson written in another language. */
  readonly ui: Attrs;
  /** The DOM id of a part the lesson names. */
  id(partId: string): string;
  /** The DOM id of something the renderer adds. */
  own(name: string): string;
}

const FORMATS = ['code', 'math', 'text'] as const;
const FORMAT_LABEL = new Map<string, string>([
  ['code', 'Code'],
  ['math', 'Working'],
  ['text', 'Text'],
]);

/** One of a fixed set of words, whatever the lesson says. The stylesheet and the player switch on these. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const list = <T>(v: readonly T[] | undefined): readonly T[] => (Array.isArray(v) ? v : []);

/** The signs at which a line of working may be carried on to the next row, as it would be by hand. */
const RELATIONS = new Set(['=', '<', '>', '≤', '≥', '≠', '≈', '→']);

/**
 * One line of working as display math: one <math> per run between relation signs, each run
 * beginning with its sign, so that a line wider than a phone wraps where a person would break it
 * (the same rule as v1's `lines` figure). A line the math subset cannot parse is shown as typed.
 */
function mathLine(src: string): Html {
  const parsed = parseMath(src);
  if (!parsed.ok) return html`<code>${src}</code>`;
  const runs: MathNode[][] = [[]];
  let depth = 0;
  let bars = 0;
  for (const node of parsed.nodes) {
    const run = runs[runs.length - 1] as MathNode[];
    const sign = node.t === 'op' ? node.v : node.t === 'script' && node.base.t === 'op' ? node.base.v : null;
    if (sign === '(' || sign === '[') depth++;
    else if (sign === ')' || sign === ']') depth = Math.max(0, depth - 1);
    else if (sign === '|' && depth === 0) bars++;
    else if (node.t === 'op' && RELATIONS.has(node.v) && depth === 0 && bars % 2 === 0 && run.length > 0) {
      runs.push([node]);
      continue;
    }
    run.push(node);
  }
  // core/math builds every element itself and escapes every character it places inside one.
  return html`${runs.map((run) => raw(mathToMathML(run, true)))}`;
}

/** "line 3" for a line reference such as "l3"; the reference itself when it is not one. */
function lineName(ref: unknown): string {
  const m = typeof ref === 'string' ? /^l(\d{1,2})$/.exec(ref) : null;
  return m ? `line ${Number(m[1])}` : str(ref);
}

/**
 * A `lines` stage as static markup: the lines in order, each annotation under its line, and the
 * values, brackets and pointers that the clip moves, by name.
 */
export function renderLinesStage(stage: LinesStage, ctx: StageRenderContext): Html {
  const format = oneOf(stage.format, FORMATS, 'text');
  const labelId = ctx.own('stage-lines');
  const notes = list(stage.annotations);
  const items = list(stage.lines).map((line, i) => {
    const part = `l${i + 1}`;
    const text = str(line);
    const content = format === 'math' ? mathLine(text) : format === 'code' ? html`<code>${text}</code>` : html`<span class="lt-xs-text">${text}</span>`;
    const mine = notes.filter((n) => n.at === part);
    return html`<li id="${ctx.id(part)}" data-line="${part}"><span class="lt-xs-line">${content}</span>${mine.map(
      (n) => html`<span class="lt-xs-note" id="${ctx.id(str(n.id))}"><span class="lt-vh"${ctx.ui}>Note: </span>${str(n.text)}</span>`,
    )}</li>`;
  });
  const extras: Html[] = [];
  for (const v of list(stage.values)) {
    const name = str(v.label) || str(v.id);
    const start = v.value === undefined ? null : html`<span${ctx.ui}>, starting at </span><span class="lt-xs-value">${str(v.value)}${str(v.unit)}</span>`;
    extras.push(html`<li id="${ctx.id(str(v.id))}"><span class="lt-xs-key">${name}</span><span${ctx.ui}>: a value shown beside ${lineName(v.at)}</span>${start}</li>`);
  }
  for (const b of list(stage.brackets)) {
    if (b.label) extras.push(html`<li id="${ctx.id(str(b.id))}"><span class="lt-xs-key">${str(b.label)}</span><span${ctx.ui}>: a bracket round a range of lines</span></li>`);
  }
  for (const p of list(stage.pointers)) {
    if (p.label) extras.push(html`<li id="${ctx.id(str(p.id))}"><span class="lt-xs-key">${str(p.label)}</span><span${ctx.ui}>: a pointer that moves from line to line</span></li>`);
  }
  return html`<div class="lt-xs" data-stage="lines"><p class="lt-xs-label" id="${labelId}"><span class="lt-label"${ctx.ui}>${FORMAT_LABEL.get(format) ?? 'Text'}</span>${
    format === 'code' && stage.language ? html` <span class="lt-xs-language">${str(stage.language)}</span>` : null
  }</p>${format === 'code' ? html`<p class="lt-xs-flag"${ctx.ui}>${CODE_LABEL}</p>` : null}<ol class="lt-xs-lines" role="list" data-format="${format}" aria-labelledby="${labelId}">${items}</ol>${
    extras.length ? html`<ul class="lt-xs-parts" role="list">${extras}</ul>` : null
  }</div>`;
}

/**
 * A `timeline` stage as static markup: the events in order with their `when` (and their lane, on a
 * stage with lanes), then each span as a sentence.
 */
export function renderTimelineStage(stage: TimelineStage, ctx: StageRenderContext): Html {
  const labelId = ctx.own('stage-timeline');
  const lanes = new Map(list(stage.lanes).map((l) => [str(l.id), str(l.label)]));
  const events = list(stage.events);
  const byId = new Map(events.map((e) => [str(e.id), e]));
  const items = events.map((e) => {
    const lane = typeof e.lane === 'string' ? lanes.get(e.lane) : undefined;
    return html`<li id="${ctx.id(str(e.id))}" data-event="${str(e.id)}"><span class="lt-xs-when">${str(e.when)}</span> ${
      lane ? html`<span class="lt-xs-lane">${lane}</span><span class="lt-vh">: </span> ` : null
    }<span class="lt-xs-what">${str(e.label)}</span>${e.detail ? html` <span class="lt-xs-detail">${str(e.detail)}</span>` : null}</li>`;
  });
  const name = (id: unknown): Html => {
    const e = byId.get(str(id));
    return e ? html`<span class="lt-xs-when">${str(e.when)}</span> (${str(e.label)})` : html`${str(id)}`;
  };
  const spans = list(stage.spans).map(
    (s) =>
      html`<li id="${ctx.id(str(s.id))}">${s.label ? html`<span class="lt-xs-key">${str(s.label)}</span><span class="lt-vh">: </span> ` : null}<span${ctx.ui}>from </span>${name(s.from)}<span${
        ctx.ui
      }> to </span>${name(s.to)}</li>`,
  );
  return html`<div class="lt-xs" data-stage="timeline"><p class="lt-xs-label" id="${labelId}"><span class="lt-label"${ctx.ui}>Timeline</span>${
    lanes.size ? html` <span class="lt-xs-lanes">${[...lanes.values()].join(' · ')}</span>` : null
  }</p><ol class="lt-xs-timeline" role="list" aria-labelledby="${labelId}">${items}</ol>${
    spans.length ? html`<ul class="lt-xs-parts" role="list">${spans}</ul>` : null
  }</div>`;
}
