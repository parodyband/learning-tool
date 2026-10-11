// The static markup of a figure: what a reader gets with no script, and what the player builds on.
// Every figure must be a correct account of itself as plain HTML: parts are real elements with
// their labels on them, connections are also sentences, tables are tables, a chart is its data.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_FIGURES } from '../../src/core/examples';
import { FIGURE_TYPES, Figure } from '../../src/core/schema';
import type { FigureInput, Published } from '../../src/core/types';
import { attrs, domId, internalId } from '../../src/render/escape';
import { mathToMathML, parseMath } from '../../src/core/math';
import { CODE_LABEL, ILLUSTRATIVE_LABEL, LOST_LABEL, renderFigure } from '../../src/render/figures';
import { renderLessonHtml } from '../../src/render/index';
import { createContext } from '../../src/render/scenes';
import { sourceBook } from '../../src/render/sources';
import { examplePublished } from '../helpers/example';
import { ALL_FIGURES, HARD_FIGURES, figureScene, figuresPublished, sceneIdFor } from './figures-fixtures';
import { ALLOWED_TAGS, PAYLOADS, type Reach, type Scanned, type Tag, attrAllowed, elements, poison, scan } from './helpers';

/** One figure rendered on its own, in a scene named after it. */
function render(name: string, figure: FigureInput, language = 'en'): { html: string; s: Scanned; sceneId: string } {
  const published = examplePublished();
  published.lesson.language = language;
  const scene = figureScene(name, figure);
  const ctx = createContext({ lesson: published.lesson, receipt: published.receipt, book: sourceBook(published.lesson), weak: new Set(), ui: attrs({ lang: language === 'en' ? undefined : 'en' }), clips: new Set() }, scene, 2);
  const html = renderFigure(Figure.parse(figure), ctx);
  return { html, s: scan(html), sceneId: scene.id };
}

const byClass = (s: Scanned, cls: string): Tag[] => s.tags.filter((t) => !t.closing && (t.attrs.get('class') ?? '').split(' ').includes(cls));
const byPart = (s: Scanned, part: string): Tag[] => s.tags.filter((t) => !t.closing && t.attrs.get('data-part') === part);

/** Every id a step may highlight in a figure. */
function partIds(figure: FigureInput): string[] {
  switch (figure.type) {
    case 'flow':
      return [...figure.nodes.map((n) => n.id), ...figure.edges.map((e) => e.id)];
    case 'sequence':
      return [...figure.actors.map((a) => a.id), ...figure.messages.map((m) => m.id)];
    case 'layers':
      return figure.layers.map((l) => l.id);
    case 'timeline':
      return figure.events.map((e) => e.id);
    case 'compare':
      return [...figure.columns.map((c) => c.id), ...figure.rows.map((r) => r.id)];
    case 'chart':
      return [...figure.xs.map((x) => x.id), ...figure.series.map((x) => x.id)];
    case 'lines':
      return figure.lines.map((_, i) => `l${i + 1}`);
  }
}

describe('fixtures', () => {
  it('cover every figure type, and every one is valid in the format', () => {
    expect(new Set([...ALL_FIGURES.values()].map((f) => f.type))).toEqual(new Set(FIGURE_TYPES));
    for (const [name, figure] of ALL_FIGURES) expect(Figure.safeParse(figure).success, name).toBe(true);
  });
  it('include the hard cases at the limits the format allows', () => {
    const flow = HARD_FIGURES.flow12;
    expect(flow.type === 'flow' && flow.nodes.length).toBe(12);
    expect(flow.type === 'flow' && flow.edges.length).toBe(16);
    const sequence = HARD_FIGURES.sequence12;
    expect(sequence.type === 'sequence' && [sequence.actors.length, sequence.messages.length, sequence.messages.filter((m) => m.status === 'lost').length]).toEqual([5, 12, 1]);
    expect(HARD_FIGURES.chartLine3.type === 'chart' && HARD_FIGURES.chartLine3.series.length).toBe(3);
    expect(HARD_FIGURES.chartStep16.type === 'chart' && HARD_FIGURES.chartStep16.xs.length).toBe(16);
    expect(HARD_FIGURES.lines24.type === 'lines' && HARD_FIGURES.lines24.lines.length).toBe(24);
  });
});

describe.each([...ALL_FIGURES])('%s', (name, figure) => {
  const { html, s, sceneId } = render(name, figure);
  const root = s.tags[0] as Tag;

  it('is one labelled group that names its type and its scene', () => {
    expect(root.name).toBe('div');
    expect(root.attrs.get('class')).toBe('lt-figure');
    expect(root.attrs.get('role')).toBe('group');
    expect(root.attrs.get('data-figure')).toBe(figure.type);
    expect(root.attrs.get('data-scene')).toBe(sceneId);
    const labelId = root.attrs.get('aria-labelledby');
    expect(labelId).toBe(internalId(sceneId, 'figure'));
    expect(s.tags.filter((t) => t.attrs.get('id') === labelId)).toHaveLength(1);
    // The whole string is that one element: nothing before it, nothing after.
    expect(html.startsWith('<div class="lt-figure"')).toBe(true);
    expect(html.endsWith('</div>')).toBe(true);
    expect(s.tags.filter((t) => t.name === 'div' && !t.closing).length).toBe(s.tags.filter((t) => t.name === 'div' && t.closing).length);
  });

  it('gives every part exactly one element, with the id a step will look up', () => {
    const parts = partIds(figure);
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      const found = byPart(s, part);
      expect(found, part).toHaveLength(1);
      expect(found[0]?.attrs.get('id'), part).toBe(domId(sceneId, part));
    }
    expect(s.tags.filter((t) => t.attrs.has('data-part')).length).toBe(parts.length);
    const ids = s.tags.filter((t) => t.attrs.has('id')).map((t) => t.attrs.get('id'));
    expect(new Set(ids).size).toBe(ids.length);
    expect(s.tags.some((t) => t.attrs.has('data-hl'))).toBe(false);
  });

  it('shows its description and caption as text, and its sources as chips', () => {
    expect(byClass(s, 'lt-figure-desc')).toHaveLength(1);
    // Inline markup is rendered, so compare on the words.
    for (const word of figure.description.replace(/[`*$]/g, '').split(/\s+/).slice(0, 6)) expect(s.text).toContain(word);
    if (figure.caption) expect(byClass(s, 'lt-figure-caption')).toHaveLength(1);
    const cites = figure.cites ?? [];
    expect(elements(s, 'button').filter((b) => b.attrs.has('popovertarget') && !b.attrs.has('popovertargetaction'))).toHaveLength(new Set(cites).size);
    if (cites.length > 0) expect(s.text).toContain('Based on');
  });

  it('is plain HTML: known elements only, no drawing, no control, no style or handler', () => {
    for (const tag of s.tags) {
      expect(ALLOWED_TAGS.has(tag.name), `<${tag.name}>`).toBe(true);
      if (tag.closing) continue;
      for (const attr of tag.attrs.keys()) {
        expect(attrAllowed(attr), `${tag.name}[${attr}]`).toBe(true);
        expect(attr === 'style' || attr.startsWith('on'), `${tag.name}[${attr}]`).toBe(false);
      }
    }
    // Connectors and marks are drawn by the player. The markup carries none, and nothing to copy code with.
    expect(elements(s, 'svg')).toHaveLength(0);
    expect(elements(s, 'input')).toHaveLength(0);
    expect(elements(s, 'button').filter((b) => !b.attrs.has('popovertarget'))).toHaveLength(0);
    expect(s.comments).toEqual([]);
  });

  it('resolves every reference to an id inside the figure', () => {
    const ids = new Set(s.tags.filter((t) => t.attrs.has('id')).map((t) => t.attrs.get('id')));
    for (const tag of s.tags) {
      for (const attr of ['aria-labelledby', 'aria-describedby', 'popovertarget']) {
        const value = tag.attrs.get(attr);
        if (value !== undefined) expect(ids.has(value), `${tag.name}[${attr}=${value}]`).toBe(true);
      }
    }
  });

  it('renders the same bytes every time', () => {
    expect(render(name, figure).html).toBe(html);
  });
});

describe('flow', () => {
  const figure = EXAMPLE_FIGURES.flow;
  const { s } = render('flow', figure);
  if (figure.type !== 'flow') throw new Error('fixture');

  it('lists the nodes with their labels on them, in the order given', () => {
    const nodes = byClass(s, 'lt-node');
    expect(nodes.map((n) => n.attrs.get('data-part'))).toEqual(figure.nodes.map((n) => n.id));
    for (const node of figure.nodes) expect(s.text).toContain(node.label);
    expect(byClass(s, 'lt-flow')[0]?.attrs.get('data-layout')).toBe('down');
  });

  it('gives every connection as a sentence: from, the word "to", to, and its label', () => {
    const { html } = render('flow', figure);
    const edges = byClass(s, 'lt-edge');
    expect(edges).toHaveLength(figure.edges.length);
    const labelOf = new Map(figure.nodes.map((n) => [n.id, n.label]));
    for (const edge of figure.edges) {
      const tag = byPart(s, edge.id)[0] as Tag;
      expect(tag.attrs.get('data-from')).toBe(edge.from);
      expect(tag.attrs.get('data-to')).toBe(edge.to);
      expect(tag.attrs.has('data-dashed')).toBe(edge.dashed === true);
      expect(tag.attrs.has('data-bare')).toBe(!edge.label);
      // The item's text reads "<from> to <to>" and then ": <label>".
      const start = html.indexOf(`data-part="${edge.id}"`);
      const item = scan(html.slice(start, html.indexOf('</li>', start))).text;
      expect(item).toContain(`${labelOf.get(edge.from)} to ${labelOf.get(edge.to)}`);
      if (edge.label) expect(item.endsWith(`: ${edge.label}`)).toBe(true);
    }
    expect(s.text).toContain('Connections');
  });

  it('keeps the layout to the three it knows, and names an unknown end by its id', () => {
    expect(byClass(render('f', { ...figure, layout: 'ring' }).s, 'lt-flow')[0]?.attrs.get('data-layout')).toBe('ring');
    expect(byClass(render('f', { ...figure, layout: undefined }).s, 'lt-flow')[0]?.attrs.get('data-layout')).toBe('right');
    const published = examplePublished();
    const scene = figureScene('f', figure);
    const ctx = createContext({ lesson: published.lesson, receipt: published.receipt, book: sourceBook(published.lesson), weak: new Set(), ui: attrs({}), clips: new Set() }, scene, 0);
    const odd = { ...Figure.parse(figure), layout: 'spiral', edges: [{ id: 'x', from: 'nowhere', to: 'start' }] } as unknown as Figure;
    const out = scan(renderFigure(odd, ctx));
    expect(byClass(out, 'lt-flow')[0]?.attrs.get('data-layout')).toBe('right');
    expect(out.text).toContain('nowhere to Sorted list and a target');
  });
});

describe('sequence', () => {
  it('lists participants, then messages in order as "from to to: label"', () => {
    const figure = EXAMPLE_FIGURES.sequence;
    if (figure.type !== 'sequence') throw new Error('fixture');
    const { s } = render('seq', figure);
    expect(byClass(s, 'lt-actor').map((a) => a.attrs.get('data-part'))).toEqual(figure.actors.map((a) => a.id));
    expect(byClass(s, 'lt-msg').map((m) => m.attrs.get('data-part'))).toEqual(figure.messages.map((m) => m.id));
    expect(s.text).toContain('Your code to binary_search: find the target');
    // A message from a participant to itself says so instead of naming it twice.
    expect(s.text).toContain('binary_search to itself: discard the half that cannot contain it');
    expect(s.text).not.toContain('binary_search to binary_search');
    expect(elements(s, 'ol').some((ol) => (ol.attrs.get('class') ?? '').includes('lt-seq-messages'))).toBe(true);
  });

  it('says in words that a message is lost', () => {
    const { s, html } = render('seq', HARD_FIGURES.sequence12);
    const lost = byPart(s, 'm6')[0] as Tag;
    expect(lost.attrs.get('data-status')).toBe('lost');
    expect(byClass(s, 'lt-msg-lost')).toHaveLength(1);
    const start = html.indexOf('data-part="m6"');
    expect(scan(html.slice(start, html.indexOf('</li>', start))).text).toContain(`query orders for this user ${LOST_LABEL}`);
    expect(s.tags.filter((t) => t.attrs.has('data-status'))).toHaveLength(1);
  });
});

describe('layers and timeline', () => {
  it('are ordered lists, top first and earliest first, with labels and details in place', () => {
    const layers = render('layers', HARD_FIGURES.layers8).s;
    expect(elements(layers, 'ol')).toHaveLength(1);
    expect(byClass(layers, 'lt-layer')).toHaveLength(8);
    expect(byClass(layers, 'lt-layer-detail')).toHaveLength(7);
    expect(layers.text).toContain('Layers, top first');
    const timeline = render('timeline', HARD_FIGURES.timeline10).s;
    expect(elements(timeline, 'ol')).toHaveLength(1);
    expect(byClass(timeline, 'lt-event-when')).toHaveLength(10);
    expect(timeline.text).toContain('1 January 1983: ARPANET switches to TCP/IP');
  });
});

describe('compare', () => {
  const figure = HARD_FIGURES.compare4x8;
  if (figure.type !== 'compare') throw new Error('fixture');
  const { s } = render('compare', figure);

  it('is a table with a header cell for every column and every row', () => {
    expect(elements(s, 'table')).toHaveLength(1);
    const heads = elements(s, 'th');
    expect(heads.filter((t) => t.attrs.get('scope') === 'col')).toHaveLength(figure.columns.length + 1);
    expect(heads.filter((t) => t.attrs.get('scope') === 'row')).toHaveLength(figure.rows.length);
    expect(elements(s, 'td')).toHaveLength(figure.rows.length * figure.columns.length);
    expect(elements(s, 'table')[0]?.attrs.get('data-columns')).toBe('4');
    // Spelled-out roles keep it a table when the narrow layout changes how it is displayed.
    expect(elements(s, 'table')[0]?.attrs.get('role')).toBe('table');
    expect(elements(s, 'tr').every((t) => t.attrs.get('role') === 'row')).toBe(true);
    expect(elements(s, 'td').every((t) => t.attrs.get('role') === 'cell')).toBe(true);
  });

  it('scrolls inside a focusable, named region', () => {
    const wrap = byClass(s, 'lt-table-wrap')[0] as Tag;
    expect(wrap.attrs.get('tabindex')).toBe('0');
    expect(wrap.attrs.get('role')).toBe('region');
    expect(wrap.attrs.get('aria-label')).toBe('Table, scene 3');
  });

  it('repeats each column label beside its cell for the narrow layout, hidden from a screen reader', () => {
    const repeats = byClass(s, 'lt-cell-column');
    expect(repeats).toHaveLength(figure.rows.length * figure.columns.length);
    expect(repeats.every((t) => t.attrs.get('aria-hidden') === 'true')).toBe(true);
  });

  it('has no empty header cell when the first column has no heading', () => {
    const bare = render('compare', { ...figure, rowHeading: undefined }).s;
    expect(elements(bare, 'th').filter((t) => t.attrs.get('scope') === 'col')).toHaveLength(figure.columns.length);
    expect(byClass(bare, 'lt-compare-corner')[0]?.name).toBe('td');
  });

  it('renders inline markup in cells', () => {
    expect(elements(s, 'code').length).toBeGreaterThan(0);
  });
});

describe('chart', () => {
  const figure = HARD_FIGURES.chartLine3;
  if (figure.type !== 'chart') throw new Error('fixture');
  const { s } = render('chart', figure);

  it('is its data table: a column per series, a row per x position, every value', () => {
    expect(elements(s, 'table')).toHaveLength(1);
    expect(elements(s, 'caption')).toHaveLength(1);
    expect(byClass(s, 'lt-series-label')).toHaveLength(3);
    expect(byClass(s, 'lt-x-label')).toHaveLength(8);
    const cells = elements(s, 'td');
    expect(cells.map((c) => Number(c.attrs.get('data-value')))).toEqual(figure.xs.flatMap((_, i) => figure.series.map((series) => series.values[i])));
    expect(s.text).toContain('Median response time');
    expect(s.text).toContain('(ms)');
    expect(s.text).toContain('Requests per second');
  });

  it('tells the player what to draw', () => {
    const root = byClass(s, 'lt-chart')[0] as Tag;
    expect(root.attrs.get('data-mark')).toBe('line');
    expect(root.attrs.get('data-xlabel')).toBe('Requests per second');
    expect(root.attrs.get('data-ylabel')).toBe('Median response time');
    expect(root.attrs.get('data-unit')).toBe('ms');
  });

  it('labels illustrative data, visibly, and only illustrative data', () => {
    expect(byClass(s, 'lt-figure-flag')).toHaveLength(1);
    expect(s.text).toContain(ILLUSTRATIVE_LABEL);
    expect(ILLUSTRATIVE_LABEL).toBe('Illustrative shape, not measured data');
    const sourced = render('chart', HARD_FIGURES.chartBar3).s;
    expect(byClass(sourced, 'lt-figure-flag')).toHaveLength(0);
    expect(sourced.text).not.toContain(ILLUSTRATIVE_LABEL);
  });

  it('writes numbers for the lesson language, the same on every machine', () => {
    const cellsIn = (language: string): string[] => {
      const out = render('chart', HARD_FIGURES.chartBar3, language);
      return out.html.match(/<td data-value="498501">([^<]*)<\/td>/)?.slice(1) ?? [];
    };
    expect(cellsIn('en')).toEqual(['498,501']);
    expect(cellsIn('de')).toEqual(['498.501']);
    // A tag Intl has no data for, and one that is not a tag at all, both fall back to English and never to the machine's locale.
    expect(cellsIn('tlh')).toEqual(['498,501']);
    expect(cellsIn('<script>')).toEqual(['498,501']);
    const decimals = render('chart', HARD_FIGURES.chartBar1).s;
    expect(decimals.text).toContain('9.81');
    expect(render('chart', { ...figure, series: [{ id: 'a', label: 'A', values: [0.1 + 0.2, 1e12, -0, 1e-7, 5, 6, 7, 8] }] }).s.text).toContain('0.3');
  });
});

describe('lines', () => {
  it('labels code as the agent\'s own, names its language, keeps its spaces, and offers no way to copy it', () => {
    const figure = EXAMPLE_FIGURES.lines;
    if (figure.type !== 'lines') throw new Error('fixture');
    const { s, html } = render('lines', figure);
    expect(s.text).toContain(CODE_LABEL);
    expect(CODE_LABEL).toBe('Code written by your agent. Read it before you run it.');
    expect(byClass(s, 'lt-figure-language')).toHaveLength(1);
    expect(s.text).toContain('Python');
    expect(elements(s, 'code')).toHaveLength(figure.lines.length);
    expect(html).toContain('<code>        mid = low + (high - low) // 2</code>');
    expect(html).toContain('<code>        if items[mid] &lt; target:</code>');
    expect(byPart(s, 'l4')[0]?.attrs.get('data-indent')).toBe('8');
    expect(byPart(s, 'l1')[0]?.attrs.has('data-indent')).toBe(false);
    expect(elements(s, 'button')).toHaveLength(0);
    expect(html).not.toMatch(/copy/i);
  });

  it('sets math lines as MathML and falls back to the source text for a line that does not parse', () => {
    const { s } = render('lines', HARD_FIGURES.linesMath);
    // Six lines; each is one <math> per run between relation signs, so that a long line can wrap at them.
    expect(elements(s, 'li')).toHaveLength(6);
    expect(elements(s, 'math')).toHaveLength(13);
    expect(elements(s, 'math').every((m) => m.attrs.get('display') === 'block')).toBe(true);
    expect(byClass(s, 'lt-figure-flag')).toHaveLength(0);
    const broken = render('lines', { type: 'lines', format: 'math', lines: ['x^2', '\\unsupported{y}'], description: 'Two lines of working, the second of which uses a command the subset does not have.' }).s;
    expect(elements(broken, 'math')).toHaveLength(1);
    expect(broken.text).toContain('\\unsupported{y}');
  });

  describe('a line of working can wrap at its relation signs', () => {
    /** The <math> elements of each line of a math figure, as the markup between <math ...><mrow> and </mrow></math>. */
    const runsOf = (lines: string[]): string[][] => {
      const { html } = render('lines', { type: 'lines', format: 'math', lines, description: 'Lines of working used to test where a line may wrap.' });
      return [...html.matchAll(/<li [^>]*>(.*?)<\/li>/g)].map((li) => [...(li[1] as string).matchAll(/<math display="block"><mrow>(.*?)<\/mrow><\/math>/g)].map((m) => m[1] as string));
    };
    const whole = (line: string): string => {
      const parsed = parseMath(line);
      if (!parsed.ok) throw new Error(`fixture does not parse: ${line}`);
      return mathToMathML(parsed.nodes, true).replace(/^<math display="block"><mrow>/, '').replace(/<\/mrow><\/math>$/, '');
    };

    it('breaks before each relation sign, and the runs side by side are exactly the line', () => {
      const lines = [
        'x^2 + 6x + 5 = 0',
        'x = -1 \\text{ or } x = -5',
        '\\text{chance of cancer if positive} = \\frac{\\text{positives with cancer}}{\\text{all positives}}',
        '\\frac{8}{8 + 95} = \\frac{8}{103} \\approx 0.078',
        '\\frac{0.01 \\times 0.80}{0.01 \\times 0.80 + 0.99 \\times 0.096} \\approx 0.078',
        'P(A|B) = \\frac{P(B|A) \\times P(A)}{P(B)}',
        'y = \\sin x + \\log_2 n \\le 2',
        '0 < x \\ne 1 \\to \\infty',
        '= -5',
        'a + b',
      ];
      const runs = runsOf(lines);
      expect(runs.map((r) => r.length)).toEqual([2, 3, 2, 3, 2, 2, 3, 4, 1, 1]);
      // Nothing is added, dropped or respaced by the split: the same elements in the same order.
      lines.forEach((line, i) => expect((runs[i] as string[]).join(''), line).toBe(whole(line)));
      // Every run after the first starts with its relation sign, so a wrapped row reads "= ...".
      for (const list of runs) for (const run of list.slice(1)) expect(run).toMatch(/^<mo>(=|&lt;|&gt;|≤|≥|≠|≈|→)<\/mo>/);
    });

    it('never breaks inside brackets, between two bars, or inside a fraction or root', () => {
      const lines = ['P(A | B = 1) = 0.5', '|x = 1| + 2', '\\left( a = b \\right) = c', '\\frac{a = b}{c} + \\sqrt{x = y}', '[a < b] > 0', 'f(x = 1', '(x + 3)^2 = 4', '|x = 1|^2 = 1'];
      const runs = runsOf(lines);
      expect(runs.map((r) => r.length)).toEqual([2, 1, 2, 1, 2, 1, 2, 2]);
      lines.forEach((line, i) => expect((runs[i] as string[]).join(''), line).toBe(whole(line)));
    });
  });

  it('sets plain lines as text, and keeps an empty line as a line', () => {
    const { s } = render('lines', HARD_FIGURES.linesText);
    expect(byClass(s, 'lt-line-text')).toHaveLength(3);
    expect(s.text).toContain('Therefore Socrates is mortal.');
    const code = render('lines', HARD_FIGURES.lines24).s;
    expect(elements(code, 'li')).toHaveLength(24);
    expect(byPart(code, 'l4')).toHaveLength(1);
  });
});

describe('a lesson in another language', () => {
  it('marks the interface words in a figure as English, and nothing else', () => {
    const { s } = render('flow', EXAMPLE_FIGURES.flow, 'pt-BR');
    const english = s.tags.filter((t) => t.attrs.get('lang') === 'en');
    expect(english.length).toBeGreaterThan(3);
    // Parts carry the lesson's own words and must not be marked.
    expect(s.tags.filter((t) => t.attrs.has('data-part') && t.attrs.has('lang'))).toHaveLength(0);
    expect(byClass(s, 'lt-figure-desc')[0]?.attrs.has('lang')).toBe(false);
    expect(s.tags.filter((t) => t.attrs.has('lang')).every((t) => t.attrs.get('lang') === 'en')).toBe(true);
    const flag = byClass(render('chart', EXAMPLE_FIGURES.chart, 'pt-BR').s, 'lt-figure-flag')[0] as Tag;
    expect(flag.attrs.get('lang')).toBe('en');
    expect(render('flow', EXAMPLE_FIGURES.flow, 'en').s.tags.some((t) => t.attrs.has('lang'))).toBe(false);
  });
});

describe('hostile and broken figures', () => {
  const published = (): Published => figuresPublished([...ALL_FIGURES.keys()]);
  const clean = scan(renderLessonHtml(published()));

  it.each(['prose', 'strings', 'everything'] as Reach[])('a payload in every %s field stays text', (reach) => {
    for (const payload of PAYLOADS) {
      const out = scan(renderLessonHtml(poison(published(), reach, () => payload)));
      for (const tag of out.tags) {
        expect(ALLOWED_TAGS.has(tag.name), `${payload}: <${tag.name}>`).toBe(true);
        if (tag.closing) continue;
        for (const [attr, value] of tag.attrs) {
          expect(attrAllowed(attr), `${payload}: ${tag.name}[${attr}]`).toBe(true);
          if (attr === 'id' || attr === 'aria-labelledby') expect(value, `${payload}: ${attr}`).toMatch(/^(lt|scene)-[A-Za-z0-9_-]+$/);
          if (attr === 'class') expect(value, `${payload}: class`).toMatch(/^[a-z0-9_ -]*$/);
        }
      }
      expect(elements(out, 'svg').length, payload).toBeLessThanOrEqual(elements(clean, 'svg').length);
      expect(elements(out, 'script').length, payload).toBe(elements(clean, 'script').length);
      if (reach === 'prose') {
        // Structure survives, so every figure and every part is still there, and the payload is on the page as words.
        expect(byClass(out, 'lt-figure').length).toBe(ALL_FIGURES.size);
        expect(out.tags.filter((t) => t.attrs.has('data-part')).length).toBe(clean.tags.filter((t) => t.attrs.has('data-part')).length);
        expect(out.text).toContain(payload.replaceAll(String.fromCharCode(0), String.fromCharCode(0xfffd)));
      }
    }
  });

  it('renders something for a figure of a type it does not know, and for one with pieces missing', () => {
    const p = published();
    const scenes = p.lesson.scenes as unknown as { figure?: Record<string, unknown> }[];
    (scenes[0] as { figure: Record<string, unknown> }).figure = { type: 'hologram', description: 'A figure type from the future that this renderer has never heard of.' };
    (scenes[2] as { figure: Record<string, unknown> }).figure = { type: 'chart', mark: 'pie', data: 'sourced', xLabel: 'x', yLabel: 'y', xs: [{ id: 'a', label: 'A' }], series: [{ id: 's', label: 'S', values: [] }], description: 'A chart whose only series has lost its values.' };
    const out = scan(renderLessonHtml(p));
    expect(byClass(out, 'lt-figure').length).toBe(ALL_FIGURES.size);
    expect(out.text).toContain('A figure type from the future');
    // An unknown mark is drawn as bars; a missing value leaves its cell empty and unmarked.
    expect(byClass(out, 'lt-chart').some((t) => t.attrs.get('data-mark') === 'bar')).toBe(true);
  });

  it('is found in the scene the renderer put it in', () => {
    const html = renderLessonHtml(figuresPublished(['ex-flow', 'lines24'], { lines24: { steps: [['l1'], ['l2', 'l3']] } }));
    const s = scan(html);
    expect(byClass(s, 'lt-figure').map((t) => t.attrs.get('data-scene'))).toEqual([sceneIdFor('ex-flow'), sceneIdFor('lines24')]);
    expect(html.indexOf('lt-figure-col')).toBeGreaterThan(0);
  });
});
