// A chart, drawn from its own data table. The table the renderer wrote stays in the page as the
// accessible account of the numbers (folded behind "Show the data as a table" once a chart is on
// screen); this file reads the values back out of it and draws bars, lines or steps above it.
//
// All text in the plot is HTML placed around or over the SVG, never SVG text: it wraps, it follows
// the reader's font settings, and its contrast can be checked like any other text. The SVG holds
// only marks. The plot is hidden from assistive technology because the table says the same thing.
//
// Series are told apart without relying on colour: lines differ in dash pattern and marker shape,
// bars in fill (solid, hollow, hatched), and where there is room each line is labelled at its end.
import { type Scale, niceScale, thin, tickLabels } from './scale';
import { type Drawing, Styles, el, emOf, overlay, svg } from './svg';

type Mark = 'bar' | 'line' | 'step';

interface Model {
  mark: Mark;
  xLabel: string;
  yLabel: string;
  xs: { el: HTMLElement; label: string }[];
  series: { el: HTMLElement; label: string; values: number[] }[];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/**
 * A coordinate as it is written into the drawing: to a tenth of a pixel, and never further off than
 * any canvas reaches. A value far outside its axis is then still a number an SVG attribute can hold.
 */
const r1 = (v: number): number => Math.round(clamp(v, -1e6, 1e6) * 10) / 10;

/** The chart's data, read from the table. Null when the table is not a complete grid of numbers. */
function readModel(root: HTMLElement): Model | null {
  const table = root.querySelector('table');
  if (!table) return null;
  const series = Array.from(table.querySelectorAll<HTMLElement>('thead th[data-part]')).map((th) => ({ el: th, label: th.querySelector('.lt-series-label')?.textContent ?? '', values: [] as number[] }));
  const xs: Model['xs'] = [];
  for (const row of Array.from(table.querySelectorAll<HTMLElement>('tbody tr[data-part]'))) {
    const cells = Array.from(row.querySelectorAll<HTMLElement>('td'));
    if (cells.length !== series.length) return null;
    for (let j = 0; j < cells.length; j++) {
      const text = (cells[j] as HTMLElement).dataset.value;
      const value = text === undefined || text === '' ? Number.NaN : Number(text);
      if (!Number.isFinite(value)) return null;
      (series[j] as Model['series'][number]).values.push(value);
    }
    xs.push({ el: row, label: row.querySelector('.lt-x-label')?.textContent ?? '' });
  }
  if (xs.length === 0 || series.length === 0 || series.length > 3) return null;
  const mark: Mark = root.dataset.mark === 'line' ? 'line' : root.dataset.mark === 'step' ? 'step' : 'bar';
  const unit = root.dataset.unit;
  return { mark, xLabel: root.dataset.xlabel ?? '', yLabel: unit ? `${root.dataset.ylabel ?? ''} (${unit})` : (root.dataset.ylabel ?? ''), xs, series };
}

interface Formats {
  /** A label for each tick of an axis. They are made together, because how many digits one needs depends on the others. */
  ticks(values: readonly number[]): string[];
  value(v: number): string;
}

function formats(): Formats {
  const make = (locale: string): Formats => {
    const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumSignificantDigits: 3 });
    const plain = new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 });
    // For a value that would otherwise be written as a long row of zeros.
    const power = new Intl.NumberFormat(locale, { notation: 'scientific', maximumSignificantDigits: 6 });
    const value = (v: number): string => {
      const size = Math.abs(v);
      if (size !== 0 && (size < 1e-5 || size >= 1e15)) return power.format(v);
      return size >= 100_000 ? compact.format(v) : plain.format(v);
    };
    return { ticks: (values) => tickLabels(values, locale), value };
  };
  try {
    return make(document.documentElement.lang || 'en');
  } catch {
    // The page's language is not one Intl knows how to name.
    return make('en');
  }
}

export function chartDrawing(figure: HTMLElement): Drawing | null {
  const root = figure.querySelector<HTMLElement>('.lt-chart');
  const tableWrap = root?.querySelector<HTMLElement>('.lt-chart-data');
  if (!root || !tableWrap) return null;
  const model = readModel(root);
  if (!model) return null;
  const format = formats();
  const styles = new Styles();
  const place = (node: Element, properties: Readonly<Record<string, number | null>>): void => styles.place(node, properties);
  const { mark, xs, series } = model;
  const count = xs.length;
  // Hatching is a pattern, and a pattern is referred to by id. The figure's own label id makes it unique.
  const hatchId = `${figure.getAttribute('aria-labelledby') ?? 'lt-figure'}-hatch`;

  const plot = el('div', 'lt-chart-plot');
  plot.setAttribute('aria-hidden', 'true');
  const yTitle = el('p', 'lt-chart-title lt-chart-ytitle');
  const legend = el('ul', 'lt-chart-legend');
  const frame = el('div', 'lt-chart-frame');
  const canvas = overlay('lt-chart-svg');
  const xTitle = el('p', 'lt-chart-title lt-chart-xtitle');
  plot.append(yTitle, legend, frame, xTitle);
  // What the highlighted positions hold, in words, for anyone who cannot or does not read it off the plot.
  const readout = el('p', 'lt-chart-readout');
  readout.hidden = true;
  const details = el('details', 'lt-reveal lt-chart-table');
  const summary = el('summary', '', 'Show the data as a table');
  const holder = el('div', 'lt-reveal-body');
  if ((document.documentElement.lang || 'en').toLowerCase().split('-')[0] !== 'en') summary.lang = 'en';
  root.insertBefore(plot, tableWrap);
  root.insertBefore(readout, tableWrap);
  root.insertBefore(details, tableWrap);
  holder.append(tableWrap);
  details.append(summary, holder);

  /** A small sample of how a series is drawn, for the legend and the labels at the ends of lines. */
  const swatch = (j: number): SVGSVGElement => {
    const s = overlay('lt-chart-swatch');
    const cls = `lt-s${j + 1}`;
    if (mark === 'bar') {
      s.setAttribute('width', '14');
      s.setAttribute('height', '14');
      s.append(bar(j, 1, 1, 12, 12));
    } else {
      s.setAttribute('width', '26');
      s.setAttribute('height', '14');
      s.append(svg('path', `lt-chart-line ${cls}`, { d: 'M1 7H25' }));
      if (mark === 'line') s.append(dot(j, 13, 7));
    }
    return s;
  };
  const bar = (j: number, x: number, y: number, w: number, h: number): SVGRectElement => {
    const rect = svg('rect', `lt-chart-bar lt-s${j + 1}`, { x: r1(x), y: r1(y), width: r1(Math.max(1, w)), height: r1(Math.max(1, h)) });
    if (j === 2) rect.setAttribute('fill', `url(#${hatchId})`);
    return rect;
  };
  /** The marker for a point: a circle, a square or a triangle, by series. */
  const dot = (j: number, x: number, y: number): SVGElement => {
    const cls = `lt-chart-dot lt-s${j + 1}`;
    if (j === 1) return svg('rect', cls, { x: r1(x - 3.5), y: r1(y - 3.5), width: 7, height: 7 });
    if (j === 2) return svg('path', cls, { d: `M${r1(x)} ${r1(y - 4.6)}L${r1(x + 4.6)} ${r1(y + 3.6)}H${r1(x - 4.6)}Z` });
    return svg('circle', cls, { cx: r1(x), cy: r1(y), r: 3.6 });
  };
  const hatch = (): SVGDefsElement => {
    const defs = svg('defs', null);
    const pattern = svg('pattern', null, { id: hatchId, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pattern.append(svg('rect', 'lt-chart-hatch-ground', { width: 6, height: 6 }), svg('path', 'lt-chart-hatch-line', { d: 'M1.5 0V6' }));
    defs.append(pattern);
    return defs;
  };
  const label = (text: string, className: string): HTMLSpanElement => {
    const span = el('span', className, text);
    frame.append(span);
    return span;
  };
  const seriesLabel = (j: number, className: string): HTMLElement => {
    const item = el('span', `${className} lt-s${j + 1}`);
    item.append(swatch(j), el('span', 'lt-chart-key-text', (series[j] as Model['series'][number]).label));
    return item;
  };
  const isOn = (part: HTMLElement): boolean => part.dataset.hl === 'true';

  const all = series.flatMap((s) => s.values);
  const dataMin = Math.min(...all);
  const dataMax = Math.max(...all);

  const drawLegend = (show: boolean): void => {
    legend.replaceChildren();
    legend.hidden = !show;
    if (!show) return;
    series.forEach((s, j) => {
      const item = el('li', isOn(s.el) ? 'lt-chart-key lt-hl' : 'lt-chart-key');
      item.append(seriesLabel(j, 'lt-chart-key-in'));
      legend.append(item);
    });
  };

  /** Bars standing on a horizontal axis, lines and steps. */
  const upright = (width: number, em: number, scale: Scale): boolean => {
    yTitle.textContent = model.yLabel;
    xTitle.textContent = model.xLabel;
    const direct = mark !== 'bar' && width >= 26 * em;
    drawLegend(!direct);

    const yTicks = format.ticks(scale.ticks).map((text) => label(text, 'lt-chart-tick lt-chart-ytick'));
    const ends = direct
      ? series.map((s, j) => {
          const end = seriesLabel(j, isOn(s.el) ? 'lt-chart-end lt-hl' : 'lt-chart-end');
          frame.append(end);
          return end;
        })
      : [];
    for (const end of ends) place(end, { 'max-width': width * 0.34 });
    const xTicks = xs.map((x) => label(x.label, isOn(x.el) ? 'lt-chart-tick lt-chart-xtick lt-hl' : 'lt-chart-tick lt-chart-xtick'));

    const gutterLeft = Math.max(...yTicks.map((t) => t.offsetWidth)) + 8;
    const gutterRight = direct ? Math.max(...ends.map((e) => e.offsetWidth)) + 12 : 10;
    // Never less than nothing, however wide the labels beside it: a canvas cannot have a negative width.
    const plotW = Math.max(1, width - gutterLeft - gutterRight);
    const band = plotW / count;
    const natural = xTicks.map((t) => t.offsetWidth);
    const widest = Math.max(...natural);

    if (mark === 'bar') {
      // Upright bars need a label under every group. When the groups are too narrow for that, the
      // caller lays the bars on their side instead.
      const needed = Math.max(series.length * 7 + 8, Math.min(widest, 4.4 * em) + 6);
      if (band < needed) return false;
      for (const t of xTicks) place(t, { width: band - 4 });
    } else {
      const shown = thin(count, widest + 10, band);
      // A highlighted position always has its label, and the labels that would run into it give way.
      const reach = Math.max(1, Math.ceil((widest + 10) / Math.max(1, band))) - 1;
      xs.forEach((x, i) => {
        if (!isOn(x.el)) return;
        for (let j = Math.max(0, i - reach); j <= Math.min(count - 1, i + reach); j++) shown[j] = false;
      });
      xTicks.forEach((t, i) => {
        t.hidden = !shown[i] && !isOn((xs[i] as Model['xs'][number]).el);
      });
    }
    const tickHeight = Math.max(...xTicks.map((t) => t.offsetHeight));
    const yTickHeight = (yTicks[0] as HTMLElement).offsetHeight;
    const endHeights = ends.map((e) => e.offsetHeight);

    // Value labels over bars, when every one of them fits over its own bar.
    const group = band * (series.length === 1 ? 0.62 : 0.8);
    const gap = series.length === 1 ? 0 : 2;
    const barW = (group - gap * (series.length - 1)) / series.length;
    let values: HTMLSpanElement[][] = [];
    if (mark === 'bar') {
      values = series.map((s) => s.values.map((v) => label(format.value(v), 'lt-chart-value')));
      const fits = values.every((list) => list.every((v) => v.offsetWidth <= (series.length === 1 ? band - 2 : barW + gap)));
      if (!fits) {
        for (const list of values) for (const v of list) v.remove();
        values = [];
      }
    }
    const valueHeight = values[0]?.[0]?.offsetHeight ?? 0;

    const top = Math.max(yTickHeight / 2, valueHeight > 0 && scale.hi > 0 ? valueHeight + 4 : 6);
    const plotH = Math.round(clamp(plotW * 0.5, 9.5 * em, 16 * em));
    const below = valueHeight > 0 && scale.lo < 0 ? valueHeight + 4 : 0;
    const y = (v: number): number => plotH - ((v - scale.lo) / (scale.hi - scale.lo)) * plotH;
    const xMid = (i: number): number => (i + 0.5) * band;
    const base = y(clamp(0, scale.lo, scale.hi));

    place(frame, { height: top + plotH + below + 8 + tickHeight });
    // The axis title is centred under the plot, not under the plot and its gutters.
    place(xTitle, { 'padding-left': gutterLeft, 'padding-right': gutterRight });
    place(canvas, { left: gutterLeft, top });
    canvas.setAttribute('width', String(Math.ceil(plotW)));
    canvas.setAttribute('height', String(Math.ceil(plotH + 6)));

    xs.forEach((x, i) => {
      if (isOn(x.el)) canvas.append(svg('rect', 'lt-chart-band', { x: r1(i * band + 1), y: 0, width: r1(band - 2), height: plotH }));
    });
    scale.ticks.forEach((v, k) => {
      canvas.append(svg('path', v === 0 ? 'lt-chart-grid lt-chart-zero' : 'lt-chart-grid', { d: `M0 ${r1(y(v))}H${r1(plotW)}` }));
      const tick = yTicks[k] as HTMLElement;
      place(tick, { left: gutterLeft - 8 - tick.offsetWidth, top: top + y(v) - yTickHeight / 2 });
    });
    canvas.append(svg('path', 'lt-chart-axis', { d: `M0 ${r1(base)}H${r1(plotW)}` }));
    if (mark !== 'bar') canvas.append(svg('path', 'lt-chart-axis', { d: xs.map((_, i) => `M${r1(xMid(i))} ${plotH}v5`).join('') }));

    xTicks.forEach((t, i) => {
      const w = mark === 'bar' ? band - 4 : (natural[i] as number);
      // Kept inside the frame, so a label at either end of the axis is never cut off.
      place(t, { left: clamp(gutterLeft + xMid(i) - w / 2, 0, width - w), top: top + plotH + below + 8 });
    });

    series.forEach((s, j) => {
      const on = isOn(s.el);
      const cls = on ? `lt-s${j + 1} lt-hl` : `lt-s${j + 1}`;
      if (mark === 'bar') {
        s.values.forEach((v, i) => {
          const x0 = i * band + (band - group) / 2 + j * (barW + gap);
          const rect = bar(j, x0, Math.min(y(v), base), barW, Math.abs(y(v) - base));
          if (on || isOn((xs[i] as Model['xs'][number]).el)) rect.classList.add('lt-hl');
          canvas.append(rect);
          const value = values[j]?.[i];
          if (value) place(value, { left: gutterLeft + x0 + barW / 2 - value.offsetWidth / 2, top: v >= 0 ? top + y(v) - valueHeight - 2 : top + y(v) + 3 });
        });
        return;
      }
      let d = '';
      if (mark === 'line') d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${r1(xMid(i))} ${r1(y(v))}`).join('');
      else d = s.values.map((v, i) => `${i === 0 ? `M0 ${r1(y(v))}` : `V${r1(y(v))}`}H${r1((i + 1) * band)}`).join('');
      canvas.append(svg('path', `lt-chart-line-halo ${cls}`, { d }), svg('path', `lt-chart-line ${cls}`, { d }));
      if (mark === 'line') {
        s.values.forEach((v, i) => {
          const point = dot(j, xMid(i), y(v));
          if (on || isOn((xs[i] as Model['xs'][number]).el)) point.classList.add('lt-hl');
          canvas.append(point);
        });
      }
    });

    // Labels at the ends of the lines, nudged apart where two lines finish close together.
    if (direct) {
      const order = series.map((s, j) => ({ j, y: top + y(s.values[count - 1] as number) - (endHeights[j] as number) / 2, h: endHeights[j] as number })).sort((a, b) => a.y - b.y);
      for (let k = 1; k < order.length; k++) {
        const above = order[k - 1] as { y: number; h: number };
        const here = order[k] as { y: number; h: number };
        here.y = Math.max(here.y, above.y + above.h + 2);
      }
      const last = order[order.length - 1] as { y: number; h: number };
      const over = last.y + last.h - (top + plotH + below + 8 + tickHeight);
      if (over > 0) {
        for (let k = order.length - 1; k >= 0; k--) {
          const here = order[k] as { y: number; h: number };
          const next = order[k + 1];
          here.y = Math.max(0, Math.min(here.y - over, next ? next.y - here.h - 2 : here.y - over));
        }
      }
      for (const o of order) place(ends[o.j] as HTMLElement, { left: gutterLeft + plotW + 10, top: o.y });
    }
    return true;
  };

  /** Bars lying on their side, one group per row with its label above it. For narrow columns and long labels. */
  const sideways = (width: number, em: number): void => {
    yTitle.textContent = model.xLabel;
    xTitle.textContent = model.yLabel;
    place(xTitle, { 'padding-left': null, 'padding-right': null });
    drawLegend(true);
    const scale = niceScale(dataMin, dataMax, true, clamp(Math.floor(width / (5 * em)), 2, 5));
    const cats = xs.map((x) => {
      const cat = label(x.label, isOn(x.el) ? 'lt-chart-cat lt-hl' : 'lt-chart-cat');
      place(cat, { width });
      return cat;
    });
    const values = series.map((s) => s.values.map((v) => label(format.value(v), 'lt-chart-value')));
    const ticks = format.ticks(scale.ticks).map((text) => label(text, 'lt-chart-tick lt-chart-vtick'));
    const catHeights = cats.map((c) => c.offsetHeight);
    const valueWidths = values.map((list) => list.map((v) => v.offsetWidth));
    const valueHeight = (values[0]?.[0] as HTMLElement).offsetHeight;
    const tickWidths = ticks.map((t) => t.offsetWidth);
    const tickHeight = (ticks[0] as HTMLElement).offsetHeight;

    let roomRight = 0;
    let roomLeft = 0;
    series.forEach((s, j) =>
      s.values.forEach((v, i) => {
        const w = ((valueWidths[j] as number[])[i] as number) + 8;
        if (v >= 0) roomRight = Math.max(roomRight, w);
        else roomLeft = Math.max(roomLeft, w);
      }),
    );
    // The value labels stand beyond the ends of the longest bars, so the axis is drawn that much shorter.
    const span = scale.hi - scale.lo;
    const left = scale.lo < 0 ? Math.max(roomLeft, (tickWidths[0] as number) / 2) : Math.max(1, (tickWidths[0] as number) / 2 - 2);
    const right = Math.max(scale.hi > 0 ? roomRight : 0, (tickWidths[tickWidths.length - 1] as number) / 2);
    const plotW = Math.max(40, width - left - right);
    const x = (v: number): number => left + ((v - scale.lo) / span) * plotW;
    const thick = Math.round(Math.max(valueHeight, 0.95 * em));
    const pitch = thick + 3;

    let cursor = 0;
    const rows = cats.map((cat, i) => {
      const rowTop = cursor;
      const barsTop = rowTop + (catHeights[i] as number) + 3;
      place(cat, { left: 0, top: rowTop });
      cursor = barsTop + series.length * pitch + 0.7 * em;
      return { rowTop, barsTop, bottom: cursor - 0.35 * em };
    });
    const plotH = cursor;
    place(frame, { height: plotH + 6 + tickHeight });
    place(canvas, { left: 0, top: 0 });
    canvas.setAttribute('width', String(Math.ceil(width)));
    canvas.setAttribute('height', String(Math.ceil(plotH + 4)));

    xs.forEach((xPos, i) => {
      const row = rows[i] as { rowTop: number; bottom: number };
      if (isOn(xPos.el)) canvas.append(svg('rect', 'lt-chart-band', { x: 0, y: r1(row.rowTop - 2), width: r1(width), height: r1(row.bottom - row.rowTop + 2) }));
    });
    const shown = thin(ticks.length, Math.max(...tickWidths) + 10, plotW / Math.max(1, ticks.length - 1));
    scale.ticks.forEach((v, k) => {
      canvas.append(svg('path', v === 0 ? 'lt-chart-grid lt-chart-zero' : 'lt-chart-grid', { d: `M${r1(x(v))} 0V${r1(plotH)}` }));
      const tick = ticks[k] as HTMLElement;
      tick.hidden = !shown[k];
      place(tick, { left: clamp(x(v) - (tickWidths[k] as number) / 2, 0, width - (tickWidths[k] as number)), top: plotH + 6 });
    });
    const base = x(clamp(0, scale.lo, scale.hi));
    canvas.append(svg('path', 'lt-chart-axis', { d: `M${r1(base)} 0V${r1(plotH)}` }));

    series.forEach((s, j) => {
      const on = isOn(s.el);
      s.values.forEach((v, i) => {
        const yTop = (rows[i] as { barsTop: number }).barsTop + j * pitch;
        const rect = bar(j, Math.min(x(v), base), yTop, Math.abs(x(v) - base), thick);
        if (on || isOn((xs[i] as Model['xs'][number]).el)) rect.classList.add('lt-hl');
        canvas.append(rect);
        const value = (values[j] as HTMLElement[])[i] as HTMLElement;
        const w = (valueWidths[j] as number[])[i] as number;
        place(value, { left: v >= 0 ? x(v) + 5 : x(v) - 5 - w, top: yTop + (thick - valueHeight) / 2 });
      });
    });
  };

  const say = (): void => {
    const on = xs.map((x, i) => ({ x, i })).filter(({ x }) => isOn(x.el));
    readout.hidden = on.length === 0;
    readout.textContent = on.map(({ x, i }) => `${x.label}: ${series.map((s) => (series.length > 1 ? `${s.label} ${format.value(s.values[i] as number)}` : format.value(s.values[i] as number))).join(', ')}`).join(' · ');
  };

  const drawing: Drawing = {
    layout() {
      const width = plot.clientWidth;
      if (width <= 0) return;
      const em = emOf(plot);
      const reset = (): void => {
        // The labels are made afresh each time, so the rules that placed the old ones go with them.
        styles.clear();
        frame.replaceChildren(canvas);
        canvas.replaceChildren();
        if (mark === 'bar' && series.length === 3) canvas.append(hatch());
      };
      reset();
      root.dataset.drawn = 'true';
      const scale = niceScale(dataMin, dataMax, mark === 'bar', 5);
      if (!upright(width, em, scale)) {
        reset();
        sideways(width, em);
        root.dataset.drawn = 'sideways';
      }
      say();
    },
    highlight() {
      drawing.layout();
    },
    dispose() {
      styles.dispose();
      root.insertBefore(tableWrap, plot);
      plot.remove();
      readout.remove();
      details.remove();
      delete root.dataset.drawn;
    },
  };
  return drawing;
}
