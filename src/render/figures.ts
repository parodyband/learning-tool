// Figures as static markup. What this file writes is the whole figure for a reader with no script:
// every part is a real element carrying its own label, every connection is also a sentence, a table
// is a table, and a chart is its data table. The player (player/figures.ts) then lays the same
// elements out and draws connectors between them; it adds no information of its own.
//
// What the player reads back from the markup, so the two files must change together:
//   .lt-flow[data-layout]     li.lt-node; li.lt-edge[data-from][data-to][data-dashed][data-bare] > .lt-edge-label
//   .lt-seq                   li.lt-actor; li.lt-msg[data-from][data-to][data-status] > .lt-msg-text
//   table.lt-compare          thead [data-part] for each column; a cell's column is its position in its row
//   .lt-chart[data-mark][data-xlabel][data-ylabel][data-unit] > .lt-chart-data
//                             thead th[data-part] > .lt-series-label; tbody tr[data-part] > th > .lt-x-label, td[data-value]
//   .lt-lines[data-format]    li[data-indent] for a code line that starts with spaces; in math
//                             format a line is one or more <math>, and the player lets a line
//                             that is still too wide be scrolled from the keyboard
// Ids named by `data-from` and `data-to` are part ids, never DOM ids: the player resolves them with
// domId() and getElementById. Layers and timelines are drawn by the stylesheet alone.
import type { ChartFigure, CompareFigure, Figure, FlowFigure, LayersFigure, LinesFigure, SequenceFigure, TimelineFigure } from '../core/schema';
import { type MathNode, mathToMathML, parseMath } from '../core/math';
import { EMPTY, type Html, attrs, html, raw } from './escape';
import type { RenderContext } from './scenes';

export const ILLUSTRATIVE_LABEL = 'Illustrative shape, not measured data';
export const CODE_LABEL = 'Code written by your agent. Read it before you run it.';
export const LOST_LABEL = 'lost';

/** The word shown before the caption. Also the start of the figure's accessible name. */
const TYPE_LABEL = new Map<string, string>([
  ['flow', 'Diagram'],
  ['sequence', 'Sequence'],
  ['layers', 'Layers'],
  ['timeline', 'Timeline'],
  ['compare', 'Comparison'],
  ['chart', 'Chart'],
  ['lines', 'Listing'],
]);
const LINES_LABEL = new Map<string, string>([
  ['code', 'Code'],
  ['math', 'Working'],
  ['text', 'Text'],
]);

const LAYOUTS = ['right', 'down', 'ring'];
const MARKS = ['bar', 'line', 'step'];
const FORMATS = ['code', 'math', 'text'];

/** One of a fixed set of words, whatever the lesson says. The player and the stylesheet switch on these. */
function oneOf(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

/**
 * "A to B" for a reader and "A → B" for the eye. The word is what the page says: a screen reader
 * reads an arrow as nothing or as its Unicode name, and copied text should still make sense. The
 * arrow itself is drawn by the stylesheet in the empty span. `labelled` adds the ": " that joins
 * the route to a label after it; it sits inside the route so that when the drawing hides the route
 * from the eye, the two are still one phrase to a screen reader.
 */
function route(from: Html | string, to: Html | string | null, labelled: boolean, ctx: RenderContext): Html {
  return html`<span class="lt-route"><span class="lt-route-end">${from}</span>${
    to === null
      ? html`<span class="lt-route-self"${ctx.ui}> to itself</span>`
      : html`<span class="lt-vh"${ctx.ui}> to </span><span class="lt-route-arrow" aria-hidden="true"></span><span class="lt-route-end">${to}</span>`
  }${labelled ? html`<span class="lt-sep">: </span>` : null}</span>`;
}

function flow(f: FlowFigure, ctx: RenderContext): Html {
  const labels = new Map(f.nodes.map((n) => [n.id, n.label]));
  const name = (id: string): Html | string => {
    const label = labels.get(id);
    return label === undefined ? id : ctx.inline(label);
  };
  const partsId = ctx.own('figure-parts');
  const linksId = ctx.own('figure-links');
  return html`<div class="lt-flow" data-layout="${oneOf(f.layout, LAYOUTS, 'right')}"><p class="lt-vh" id="${partsId}"${ctx.ui}>Parts</p><ol class="lt-flow-nodes" role="list" aria-labelledby="${partsId}">${f.nodes.map(
    (n) =>
      html`<li class="lt-node" id="${ctx.id(n.id)}" data-part="${n.id}"><span class="lt-node-label">${ctx.inline(n.label)}</span>${
        n.detail ? html` <span class="lt-node-detail">${ctx.inline(n.detail)}</span>` : null
      }</li>`,
  )}</ol><p class="lt-label lt-links-label" id="${linksId}"${ctx.ui}>Connections</p><ul class="lt-flow-edges" role="list" aria-labelledby="${linksId}">${f.edges.map(
    (e) =>
      html`<li class="lt-edge" id="${ctx.id(e.id)}" data-part="${e.id}" data-from="${e.from}" data-to="${e.to}"${attrs({ 'data-dashed': e.dashed === true, 'data-bare': !e.label })}>${route(name(e.from), name(e.to), !!e.label, ctx)}${
        e.label ? html`<span class="lt-edge-label">${ctx.inline(e.label)}</span>` : null
      }</li>`,
  )}</ul></div>`;
}

function sequence(f: SequenceFigure, ctx: RenderContext): Html {
  const labels = new Map(f.actors.map((a) => [a.id, a.label]));
  const name = (id: string): Html | string => {
    const label = labels.get(id);
    return label === undefined ? id : ctx.inline(label);
  };
  const partsId = ctx.own('figure-parts');
  const linksId = ctx.own('figure-links');
  return html`<div class="lt-seq"><p class="lt-label lt-parts-label" id="${partsId}"${ctx.ui}>Participants</p><ul class="lt-seq-actors" role="list" aria-labelledby="${partsId}">${f.actors.map(
    (a) => html`<li class="lt-actor" id="${ctx.id(a.id)}" data-part="${a.id}"><span class="lt-actor-label">${ctx.inline(a.label)}</span></li>`,
  )}</ul><p class="lt-label lt-links-label" id="${linksId}"${ctx.ui}>Messages, in order</p><ol class="lt-seq-messages" role="list" aria-labelledby="${linksId}">${f.messages.map((m) => {
    const lost = m.status === 'lost';
    const self = m.from === m.to;
    return html`<li class="lt-msg" id="${ctx.id(m.id)}" data-part="${m.id}" data-from="${m.from}" data-to="${m.to}"${attrs({ 'data-status': lost ? 'lost' : undefined })}>${route(name(m.from), self ? null : name(m.to), true, ctx)}<span class="lt-msg-text"><span class="lt-msg-label">${ctx.inline(m.label)}</span>${lost ? html` <span class="lt-msg-lost"${ctx.ui}>${LOST_LABEL}</span>` : null}</span></li>`;
  })}</ol></div>`;
}

function layers(f: LayersFigure, ctx: RenderContext): Html {
  const orderId = ctx.own('figure-parts');
  return html`<p class="lt-vh" id="${orderId}"${ctx.ui}>Layers, top first</p><ol class="lt-layers" role="list" aria-labelledby="${orderId}">${f.layers.map(
    (l) =>
      html`<li class="lt-layer" id="${ctx.id(l.id)}" data-part="${l.id}"><span class="lt-layer-label">${ctx.inline(l.label)}</span>${
        l.detail ? html` <span class="lt-layer-detail">${ctx.inline(l.detail)}</span>` : null
      }</li>`,
  )}</ol>`;
}

function timeline(f: TimelineFigure, ctx: RenderContext): Html {
  const orderId = ctx.own('figure-parts');
  return html`<p class="lt-vh" id="${orderId}"${ctx.ui}>Events, in order</p><ol class="lt-timeline" role="list" aria-labelledby="${orderId}">${f.events.map(
    (e) =>
      html`<li class="lt-event" id="${ctx.id(e.id)}" data-part="${e.id}"><span class="lt-event-when">${e.when}</span><span class="lt-vh">: </span><span class="lt-event-body"><span class="lt-event-label">${ctx.inline(e.label)}</span>${
        e.detail ? html` <span class="lt-event-detail">${ctx.inline(e.detail)}</span>` : null
      }</span></li>`,
  )}</ol>`;
}

/**
 * A table sits in a box that scrolls sideways if it must, and a box that scrolls has to be focusable
 * and named. The name carries the scene number: with scripting off every scene is on the page at
 * once, and two regions both called "Table" could not be told apart in a list of landmarks.
 */
function regionName(what: string, ctx: RenderContext): string {
  return `${what}, scene ${ctx.index + 1}`;
}

/**
 * A comparison table. The roles repeat what the elements already mean because the narrow layout
 * sets each row out as a card, and a table whose `display` has changed loses its meaning in the
 * accessibility tree unless the roles are spelled out. Each cell carries its column's label for that
 * layout, hidden from a screen reader, which is told the column by the header.
 */
function compare(f: CompareFigure, ctx: RenderContext): Html {
  const columns = f.columns.length;
  return html`<div class="lt-table-wrap lt-compare-wrap" role="region" aria-label="${regionName('Table', ctx)}" tabindex="0"><table class="lt-table lt-compare" role="table" data-columns="${columns}"><thead role="rowgroup"><tr role="row">${
    f.rowHeading ? html`<th scope="col" role="columnheader" class="lt-compare-corner">${f.rowHeading}</th>` : html`<td role="cell" class="lt-compare-corner"></td>`
  }${f.columns.map((c) => html`<th scope="col" role="columnheader" id="${ctx.id(c.id)}" data-part="${c.id}">${ctx.inline(c.label)}</th>`)}</tr></thead><tbody role="rowgroup">${f.rows.map(
    (r) =>
      html`<tr role="row" id="${ctx.id(r.id)}" data-part="${r.id}"><th scope="row" role="rowheader">${ctx.inline(r.label)}</th>${r.cells.map((cell, i) => {
        const column = f.columns[i];
        return html`<td role="cell">${column ? html`<span class="lt-cell-column" aria-hidden="true">${ctx.inline(column.label)}</span>` : null}<span class="lt-cell-text">${ctx.inline(cell)}</span></td>`;
      })}</tr>`,
  )}</tbody></table></div>`;
}

/**
 * Numbers in the data table are written for the lesson's language. The locale is one the runtime
 * really has (never the machine's own), so the same lesson gives the same table everywhere.
 */
function numberFormat(language: string): Intl.NumberFormat {
  let locale = 'en';
  try {
    locale = Intl.NumberFormat.supportedLocalesOf(language)[0] ?? 'en';
  } catch {
    // Not a language tag at all.
  }
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 12 });
}

function chart(f: ChartFigure, ctx: RenderContext): Html {
  const format = numberFormat(ctx.lesson.language);
  const cell = (value: unknown): Html => {
    if (typeof value === 'number' && Number.isFinite(value)) return html`<td data-value="${String(value)}">${format.format(value)}</td>`;
    // A value that is not a number is shown as it came, and the player draws no chart from it.
    return html`<td>${typeof value === 'string' ? value : ''}</td>`;
  };
  return html`<div class="lt-chart" data-mark="${oneOf(f.mark, MARKS, 'bar')}" data-xlabel="${f.xLabel}" data-ylabel="${f.yLabel}"${attrs({ 'data-unit': f.unit })}><div class="lt-table-wrap lt-chart-data" role="region" aria-label="${regionName('Data table', ctx)}" tabindex="0"><table class="lt-table lt-chart-table"><caption><span class="lt-vh"${
    ctx.ui
  }>Data: </span>${f.yLabel}${f.unit ? html` <span class="lt-chart-unit">(${f.unit})</span>` : null}</caption><thead><tr><th scope="col">${f.xLabel}</th>${f.series.map(
    (s) => html`<th scope="col" id="${ctx.id(s.id)}" data-part="${s.id}"><span class="lt-series-label">${s.label}</span></th>`,
  )}</tr></thead><tbody>${f.xs.map(
    (x, i) => html`<tr id="${ctx.id(x.id)}" data-part="${x.id}"><th scope="row"><span class="lt-x-label">${x.label}</span></th>${f.series.map((s) => cell(s.values[i]))}</tr>`,
  )}</tbody></table></div></div>`;
}

/** Leading spaces of a code line, so the player can hang a wrapped line under its own first character. */
function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

/** The signs at which a line of working may be carried on to the next row, as it would be by hand. */
const RELATIONS = new Set(['=', '<', '>', '≤', '≥', '≠', '≈', '→']);

/**
 * One line of working, as display math.
 *
 * A browser does not wrap inside a <math> element, and a line of working is often wider than a
 * phone. So the line is written as one <math> per run between relation signs, each run beginning
 * with its sign ("a", "= b", "≈ c"). Side by side they read as the one line they are; in a narrow
 * column they wrap between runs, where a person writing it out would break the line. A sign inside
 * brackets or between two bars is not a place to break: P(A | B = 1) and |x = 1| stay whole. (A bar
 * inside brackets, as in P(A | B), is not one of a pair and is not counted.)
 *
 * A line the math subset cannot parse is shown as the text the author typed.
 */
function mathLine(src: string): Html {
  const parsed = parseMath(src);
  if (!parsed.ok) return html`<code>${src}</code>`;
  const runs: MathNode[][] = [[]];
  let depth = 0;
  let bars = 0;
  for (const node of parsed.nodes) {
    const run = runs[runs.length - 1] as MathNode[];
    // A bracket or bar that carries a power, as in (x + 3)^2, is still a bracket.
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

function lines(f: LinesFigure, ctx: RenderContext): Html {
  const format = oneOf(f.format, FORMATS, 'text');
  const items = f.lines.map((line, i) => {
    const part = `l${i + 1}`;
    const text = typeof line === 'string' ? line : '';
    const content = format === 'math' ? mathLine(text) : format === 'code' ? html`<code>${text}</code>` : html`<span class="lt-line-text">${text}</span>`;
    const indent = format === 'code' ? indentOf(text) : 0;
    return html`<li id="${ctx.id(part)}" data-part="${part}"${attrs({ 'data-indent': indent > 0 ? indent : undefined })}>${content}</li>`;
  });
  return html`<ol class="lt-lines" role="list" data-format="${format}">${items}</ol>`;
}

function body(figure: Figure, ctx: RenderContext): Html {
  switch (figure.type) {
    case 'flow':
      return flow(figure, ctx);
    case 'sequence':
      return sequence(figure, ctx);
    case 'layers':
      return layers(figure, ctx);
    case 'timeline':
      return timeline(figure, ctx);
    case 'compare':
      return compare(figure, ctx);
    case 'chart':
      return chart(figure, ctx);
    case 'lines':
      return lines(figure, ctx);
    default:
      return EMPTY;
  }
}

/** The line that says how far to trust what follows: an invented curve, or code nobody has run. */
function flag(figure: Figure, ctx: RenderContext): Html | null {
  if (figure.type === 'chart' && figure.data !== 'sourced') return html`<p class="lt-figure-flag"${ctx.ui}>${ILLUSTRATIVE_LABEL}</p>`;
  if (figure.type === 'lines' && figure.format === 'code') return html`<p class="lt-figure-flag"${ctx.ui}>${CODE_LABEL}</p>`;
  return null;
}

function typeLabel(figure: Figure, ctx: RenderContext): Html {
  if (figure.type === 'lines') {
    const word = LINES_LABEL.get(figure.format) ?? 'Listing';
    return html`<span class="lt-label"${ctx.ui}>${word}</span>${figure.format === 'code' && figure.language ? html` <span class="lt-figure-language">${figure.language}</span>` : null}`;
  }
  return html`<span class="lt-label"${ctx.ui}>${TYPE_LABEL.get(figure.type) ?? 'Figure'}</span>`;
}

/** A figure as accessible static markup. Returns a string of HTML that is safe to place in the page as it is. */
export function renderFigure(figure: Figure, ctx: RenderContext): string {
  const labelId = ctx.own('figure');
  const cited = Array.isArray(figure.cites) && figure.cites.length > 0 ? ctx.cites(figure.cites, { path: 'figure' }) : null;
  return html`<div class="lt-figure" role="group" aria-labelledby="${labelId}" data-figure="${figure.type}" data-scene="${ctx.scene.id}"><p class="lt-figure-label" id="${labelId}">${typeLabel(figure, ctx)}${
    figure.caption ? html` <span class="lt-figure-caption">${ctx.inline(figure.caption)}</span>` : null
  }</p>${flag(figure, ctx)}<div class="lt-figure-body">${body(figure, ctx)}</div><p class="lt-figure-desc">${ctx.inline(figure.description)}</p>${
    cited && cited.chips !== EMPTY ? html`<p class="lt-figure-source"><span${ctx.ui}>Based on</span>&nbsp;${cited.chips}</p>${cited.popovers}` : null
  }</div>`.toString();
}
