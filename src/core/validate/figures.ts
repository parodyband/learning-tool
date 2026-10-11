// Structure of a figure: ids that are unique within it, references that resolve, rows and series
// of the right length, and the steps that point at its parts.
import { issue } from '../issues';
import { parseMath } from '../math';
import type { Figure, Step } from '../schema';
import type { Issue } from '../types';
import { nearest } from './shape';

interface Part {
  id: string;
  path: string;
}

/** Every part of a figure a step can highlight, in the order the figure lists them. */
export function figureParts(figure: Figure): Part[] {
  const p = 'figure';
  switch (figure.type) {
    case 'flow':
      return [...figure.nodes.map((n, i) => ({ id: n.id, path: `${p}.nodes[${i}].id` })), ...figure.edges.map((e, i) => ({ id: e.id, path: `${p}.edges[${i}].id` }))];
    case 'sequence':
      return [...figure.actors.map((a, i) => ({ id: a.id, path: `${p}.actors[${i}].id` })), ...figure.messages.map((m, i) => ({ id: m.id, path: `${p}.messages[${i}].id` }))];
    case 'layers':
      return figure.layers.map((l, i) => ({ id: l.id, path: `${p}.layers[${i}].id` }));
    case 'timeline':
      return figure.events.map((e, i) => ({ id: e.id, path: `${p}.events[${i}].id` }));
    case 'compare':
      return [...figure.columns.map((c, i) => ({ id: c.id, path: `${p}.columns[${i}].id` })), ...figure.rows.map((r, i) => ({ id: r.id, path: `${p}.rows[${i}].id` }))];
    case 'chart':
      return [...figure.xs.map((x, i) => ({ id: x.id, path: `${p}.xs[${i}].id` })), ...figure.series.map((s, i) => ({ id: s.id, path: `${p}.series[${i}].id` }))];
    case 'lines':
      return figure.lines.map((_, i) => ({ id: `l${i + 1}`, path: `${p}.lines[${i}]` }));
  }
}

function describeIds(figure: Figure, ids: readonly string[]): string {
  if (figure.type === 'lines') return ids.length === 1 ? 'l1' : `l1 to l${ids.length} (one per line)`;
  return ids.join(', ');
}

/** Rules about the figure on its own. */
export function figureIssues(figure: Figure): Issue[] {
  const out: Issue[] = [];
  const p = 'figure';

  const seen = new Map<string, string>();
  for (const part of figureParts(figure)) {
    const first = seen.get(part.id);
    if (first === undefined) {
      seen.set(part.id, part.path);
      continue;
    }
    out.push(
      issue('FIGURE_DUPLICATE_ID', part.path, `The id "${part.id}" is used twice in this figure, at ${first} and ${part.path}.`, {
        fix: `Rename one of them. All parts of a ${figure.type} figure share one set of ids, because a step highlights a part by id alone.`,
        got: part.id,
      }),
    );
  }

  if (figure.type === 'flow' || figure.type === 'sequence') {
    const ends = figure.type === 'flow' ? figure.nodes.map((n) => n.id) : figure.actors.map((a) => a.id);
    const kind = figure.type === 'flow' ? 'node' : 'actor';
    const links = figure.type === 'flow' ? figure.edges : figure.messages;
    const list = figure.type === 'flow' ? 'edges' : 'messages';
    links.forEach((link, i) => {
      for (const side of ['from', 'to'] as const) {
        const target = link[side];
        if (ends.includes(target)) continue;
        const guess = nearest(target, ends);
        out.push(
          issue('FIGURE_UNKNOWN_REF', `${p}.${list}[${i}].${side}`, `"${link.id}" goes ${side} "${target}", which is not ${kind === 'actor' ? 'an' : 'a'} ${kind} of this figure.`, {
            fix: `${guess ? `Use "${guess}". ` : ''}The ${kind} ids are: ${ends.join(', ')}.`,
            got: target,
            expected: `one of ${ends.join(', ')}`,
          }),
        );
      }
    });
  }

  if (figure.type === 'flow') {
    const linked = new Set<string>();
    for (const edge of figure.edges) {
      linked.add(edge.from);
      linked.add(edge.to);
    }
    figure.nodes.forEach((node, i) => {
      if (linked.has(node.id)) return;
      out.push(
        issue('FIGURE_UNCONNECTED', `${p}.nodes[${i}]`, `The node "${node.id}" has no edge to or from it.`, {
          fix: `Add an edge that connects "${node.id}", or remove the node.`,
          got: node.id,
        }),
      );
    });
  }

  if (figure.type === 'compare') {
    const want = figure.columns.length;
    figure.rows.forEach((row, i) => {
      if (row.cells.length === want) return;
      out.push(
        issue('FIGURE_CELL_COUNT', `${p}.rows[${i}].cells`, `The row "${row.id}" has ${row.cells.length} cell${row.cells.length === 1 ? '' : 's'}, but the table has ${want} columns.`, {
          fix: `Give it exactly ${want} cells, one for each column in order (${figure.columns.map((c) => c.id).join(', ')}).`,
          got: String(row.cells.length),
          expected: String(want),
        }),
      );
    });
  }

  if (figure.type === 'chart') {
    const want = figure.xs.length;
    figure.series.forEach((series, i) => {
      if (series.values.length === want) return;
      out.push(
        issue('FIGURE_VALUE_COUNT', `${p}.series[${i}].values`, `The series "${series.id}" has ${series.values.length} value${series.values.length === 1 ? '' : 's'}, but the chart has ${want} x positions.`, {
          fix: `Give it exactly ${want} values, one for each entry of "xs" in order (${figure.xs.map((x) => x.id).join(', ')}).`,
          got: String(series.values.length),
          expected: String(want),
        }),
      );
    });
  }

  if (figure.type === 'lines' && figure.format === 'math') {
    figure.lines.forEach((line, i) => {
      const parsed = parseMath(line);
      if (parsed.ok) return;
      out.push(
        issue('MARKUP_MATH', `${p}.lines[${i}]`, `Line ${i + 1} of the math figure does not parse (character ${parsed.at + 1}): ${parsed.message}`, {
          fix: 'Write each line as one expression in the supported math subset, without "$" delimiters. Put words inside \\text{...}, or use format "text" for a line that is not math.',
        }),
      );
    });
  }
  return out;
}

/** Each highlight of each step must name a part of the figure. */
export function highlightIssues(figure: Figure, steps: readonly Step[]): Issue[] {
  const out: Issue[] = [];
  const ids = figureParts(figure).map((part) => part.id);
  const valid = new Set(ids);
  steps.forEach((step, i) => {
    step.highlight.forEach((id, k) => {
      if (valid.has(id)) return;
      let guess = nearest(id, ids);
      if (figure.type === 'lines') {
        // "line4", "L4" and "4" all mean l4.
        const digits = /(\d+)$/.exec(id);
        guess = digits && valid.has(`l${Number(digits[1])}`) ? `l${Number(digits[1])}` : null;
      }
      out.push(
        issue('STEP_HIGHLIGHT_UNKNOWN', `steps[${i}].highlight[${k}]`, `Step ${i + 1} highlights "${id}", which is not a part of the ${figure.type} figure.`, {
          fix: `${guess ? `Use "${guess}". ` : ''}The part ids of this figure are: ${describeIds(figure, ids)}.`,
          got: id,
        }),
      );
    });
  });
  return out;
}
