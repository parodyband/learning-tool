// Figures in the player. The page already holds every figure as readable markup (see
// render/figures.ts); this module draws on top of that and never replaces it:
//
//   flow       nodes placed in layers or round a ring, connectors drawn behind them
//   sequence   a column and a lifeline per participant, an arrow per message
//   chart      bars, lines or steps drawn from the data table, which stays as the alternative
//   compare    nothing to draw; a highlighted column is carried down to its cells
//   lines      nothing to draw; wrapped code lines are hung under their own indentation, and a line
//              of working too wide for its column can be scrolled from the keyboard
//   layers and timeline are complete in the stylesheet
//
// A drawing is redone whenever its column changes width or its text changes size, so it follows a
// resized window, a scene being shown, and a reader's own font and spacing settings. If drawing a
// figure fails, that figure goes back to its static form and the rest of the page carries on.
//
// Which parts are highlighted is a fact about the page, not about this module: it is the `data-hl`
// attribute on each part. `setHighlight` writes it, and each drawing watches for it changing, so
// the drawn marks follow whoever changed it.
import { chartDrawing } from './figures/chart';
import { flowDrawing } from './figures/flow';
import { sequenceDrawing } from './figures/sequence';
import { type Drawing, Styles, el } from './figures/svg';
import { domId } from './main';

const drawings = new WeakMap<Element, Drawing>();
/** What a figure measured when it was last laid out. Laying out again for the same numbers would change nothing. */
const laidOutFor = new WeakMap<Element, string>();
const watched = new WeakMap<Element, HTMLElement>();
const figures: HTMLElement[] = [];
let observer: ResizeObserver | null = null;

function report(error: unknown): void {
  // On its own task, so the failure is still seen and nothing else on the page is interrupted.
  window.setTimeout(() => {
    throw error;
  }, 0);
}

/** A comparison table has nothing to lay out, but a highlighted column has to reach every cell in it. */
function compareDrawing(figure: HTMLElement): Drawing | null {
  const table = figure.querySelector('table.lt-compare');
  if (!table) return null;
  const heads = Array.from(table.querySelectorAll<HTMLElement>('thead [data-part]'));
  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr'));
  const mark = (on: (head: HTMLElement) => boolean): void => {
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      heads.forEach((head, i) => cells[i]?.classList.toggle('lt-hl-col', on(head)));
    }
  };
  return { layout() {}, highlight: () => mark((head) => head.dataset.hl === 'true'), dispose: () => mark(() => false) };
}

/**
 * Code wraps instead of scrolling; a wrapped line continues under its own first character.
 *
 * Working wraps at its relation signs, which the stylesheet does alone. What is left for here is a
 * run of math wider than the column: its line scrolls sideways, and a box that scrolls has to be
 * reachable from the keyboard. Only the lines that do scroll at this width are made so, so that
 * nobody tabs through six lines that fit.
 */
function linesDrawing(figure: HTMLElement): Drawing | null {
  const list = figure.querySelector<HTMLElement>('.lt-lines');
  if (!list) return null;
  const items = Array.from(list.querySelectorAll<HTMLElement>(':scope > li'));
  const indented = items.filter((item) => item.dataset.indent !== undefined);
  const working = list.dataset.format === 'math';
  if (indented.length === 0 && !working) return null;
  const styles = new Styles();
  for (const item of indented) {
    const indent = Number(item.dataset.indent);
    if (Number.isInteger(indent) && indent > 0 && indent <= 100) styles.set(item, '--lt-indent', String(indent));
  }
  // Not every browser scrolls a focused box by itself, so the arrow keys are handled here.
  const onKey = (event: KeyboardEvent): void => {
    const line = event.target;
    if (!(line instanceof HTMLElement) || line.parentElement !== list || line.dataset.scroll === undefined) return;
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    line.scrollLeft += step * 48;
  };
  const settle = (item: HTMLElement, scrolls: boolean): void => {
    if (scrolls) {
      item.dataset.scroll = 'true';
      item.tabIndex = 0;
    } else {
      delete item.dataset.scroll;
      item.removeAttribute('tabindex');
    }
  };
  if (working) list.addEventListener('keydown', onKey);
  return {
    layout() {
      if (working) for (const item of items) settle(item, item.scrollWidth > item.clientWidth + 1);
    },
    highlight() {},
    dispose() {
      styles.dispose();
      list.removeEventListener('keydown', onKey);
      for (const item of items) settle(item, false);
    },
  };
}

function create(figure: HTMLElement): Drawing | null {
  switch (figure.dataset.figure) {
    case 'flow':
      return flowDrawing(figure);
    case 'sequence':
      return sequenceDrawing(figure);
    case 'chart':
      return chartDrawing(figure);
    case 'compare':
      return compareDrawing(figure);
    case 'lines':
      return linesDrawing(figure);
    default:
      return null;
  }
}

/** The numbers a layout depends on: the width of the figure's column and the size of its text. Null while the figure is not on show. */
function measure(figure: HTMLElement): string | null {
  const body = figure.querySelector<HTMLElement>('.lt-figure-body');
  const probe = body?.querySelector<HTMLElement>(':scope > .lt-figure-probe');
  if (!body || body.clientWidth <= 0) return null;
  return `${body.clientWidth}:${probe?.offsetWidth ?? 0}:${probe?.offsetHeight ?? 0}`;
}

/**
 * The two things watched for a figure, neither of which a layout can change: a rule with no height
 * that is as wide as the figure's column, and a line of text nobody sees, whose box changes when
 * the font, the zoom or the letter spacing does. Watching the figure itself would not do. Laying
 * it out changes its height, which would be reported back as another change, and the browser
 * raises an error when a resize observer keeps itself busy like that.
 */
function gauges(body: HTMLElement): HTMLElement[] {
  const ruler = el('div', 'lt-figure-ruler');
  const probe = el('span', 'lt-figure-probe', 'Mgx 0123');
  for (const gauge of [ruler, probe]) gauge.setAttribute('aria-hidden', 'true');
  body.append(ruler, probe);
  return [ruler, probe];
}

function give(figure: HTMLElement): void {
  const drawing = drawings.get(figure);
  if (!drawing) return;
  try {
    drawing.dispose();
  } catch {
    // The figure is being abandoned; what matters is that it is no longer treated as drawn.
  }
  drawings.delete(figure);
}

function relayout(figure: HTMLElement): void {
  const drawing = drawings.get(figure);
  const key = measure(figure);
  if (!drawing || key === null || key === laidOutFor.get(figure)) return;
  laidOutFor.set(figure, key);
  try {
    drawing.layout();
  } catch (error) {
    give(figure);
    report(error);
  }
}

function watch(figure: HTMLElement): void {
  const body = figure.querySelector<HTMLElement>('.lt-figure-body');
  if (!body) return;
  const watchedHere = gauges(body);
  figures.push(figure);
  if (typeof ResizeObserver === 'undefined') {
    if (figures.length === 1) window.addEventListener('resize', () => figures.forEach(relayout));
    return;
  }
  observer ??= new ResizeObserver((entries) => {
    const seen = new Set<HTMLElement>();
    for (const entry of entries) {
      const owner = watched.get(entry.target);
      if (owner) seen.add(owner);
    }
    seen.forEach(relayout);
  });
  for (const gauge of watchedHere) {
    watched.set(gauge, figure);
    observer.observe(gauge);
  }
}

function follow(figure: HTMLElement): void {
  if (typeof MutationObserver === 'undefined') return;
  new MutationObserver(() => {
    try {
      drawings.get(figure)?.highlight();
    } catch (error) {
      give(figure);
      report(error);
    }
  }).observe(figure, { attributes: true, subtree: true, attributeFilter: ['data-hl'] });
}

/** Lay out and draw every figure under `root`. Called once at start-up, while all scenes are still visible. */
export function enhanceFigures(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.lt-figure[data-figure]').forEach((figure) => {
    if (drawings.has(figure)) return;
    let drawing: Drawing | null = null;
    try {
      drawing = create(figure);
      if (!drawing) return;
      drawings.set(figure, drawing);
      watch(figure);
      follow(figure);
      const key = measure(figure);
      if (key !== null) laidOutFor.set(figure, key);
      drawing.layout();
      drawing.highlight();
    } catch (error) {
      if (drawing) give(figure);
      report(error);
    }
  });
}

/**
 * Mark the parts of a figure that a step is about, and clear every other mark. A marked part gets
 * `data-hl="true"`, which the stylesheet turns into a ring and a tint (never colour alone), and a
 * visually hidden " (highlighted)" so the same is said to a screen reader. Works on any part: a node,
 * an edge, a participant, a message, a layer, an event, a row, a column, an x position, a series, a line.
 */
export function setHighlight(figureEl: Element, partIds: readonly string[]): void {
  const sceneId = figureEl instanceof HTMLElement ? (figureEl.dataset.scene ?? '') : '';
  const wanted = new Set<Element>();
  for (const partId of partIds) {
    const part = document.getElementById(domId(sceneId, partId));
    if (part && figureEl.contains(part) && part.hasAttribute('data-part')) wanted.add(part);
  }
  const english = (document.documentElement.lang || 'en').toLowerCase().split('-')[0] === 'en';
  figureEl.querySelectorAll<HTMLElement>('[data-part]').forEach((part) => {
    const on = wanted.has(part);
    if (on === (part.dataset.hl === 'true')) return;
    // A table row cannot hold text of its own, so its note goes in its header cell.
    const holder = part instanceof HTMLTableRowElement ? (part.cells[0] ?? part) : part;
    if (on) {
      part.dataset.hl = 'true';
      const note = el('span', 'lt-vh lt-hl-note', ' (highlighted)');
      if (!english) note.lang = 'en';
      holder.append(note);
    } else {
      delete part.dataset.hl;
      holder.querySelector(':scope > .lt-hl-note')?.remove();
    }
  });
}
