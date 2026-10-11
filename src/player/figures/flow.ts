// A flow figure, drawn. The nodes and the edge labels are the list items the renderer wrote: this
// file only moves them (left, top and width through the CSSOM) and draws the connectors between
// them in an SVG that sits behind. Nothing is copied, so a part has one element whether it is read
// as a list or seen as a diagram.
import { domId } from '../main';
import { type EdgeInput, type Metrics, type Placed, type Size, placeLayered, placeRingEllipse, placeRingTrack, planLayered, ringTrackRoom } from './graph';
import { type Drawing, Styles, connector, connectorGroup, emOf, overlay, syncGroups } from './svg';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Room kept clear around the drawing so a highlight ring on an outer node is not cut off. */
const MARGIN = 6;

/**
 * A label that has wrapped is as wide as it was allowed to be, not as wide as its longest line.
 * Narrow it to its text, so it covers no more of its connector and claims no more room than it needs.
 */
function tighten(edge: HTMLElement, styles: Styles): void {
  styles.set(edge, 'inline-size', null);
  const label = edge.querySelector('.lt-edge-label');
  if (!label) return;
  const range = document.createRange();
  range.selectNodeContents(label);
  const rects = Array.from(range.getClientRects());
  if (rects.length < 2) return;
  const text = Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
  const style = getComputedStyle(edge);
  const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  if (text + padding + 1 < edge.offsetWidth) styles.place(edge, { 'inline-size': text + padding + 1 });
}

function metrics(em: number): Metrics {
  return { nodeGap: 1.5 * em, layerGap: 2.5 * em, lane: 1.1 * em, labelPad: 8, arrow: 10, track: 0.85 * em, port: 1.1 * em, loop: 1.5 * em };
}

export function flowDrawing(figure: HTMLElement): Drawing | null {
  const root = figure.querySelector<HTMLElement>('.lt-flow');
  if (!root) return null;
  const sceneId = figure.dataset.scene ?? '';
  const nodeEls = Array.from(root.querySelectorAll<HTMLElement>('.lt-flow-nodes > .lt-node'));
  const edgeEls = Array.from(root.querySelectorAll<HTMLElement>('.lt-flow-edges > .lt-edge'));
  if (nodeEls.length === 0) return null;

  const indexOf = new Map<Element, number>(nodeEls.map((node, i) => [node, i]));
  const resolve = (partId: string | undefined): number => {
    const node = partId === undefined ? null : document.getElementById(domId(sceneId, partId));
    return (node ? indexOf.get(node) : undefined) ?? -1;
  };
  const ends = edgeEls.map((edge) => ({ from: resolve(edge.dataset.from), to: resolve(edge.dataset.to) }));
  const ring = root.dataset.layout === 'ring';
  const wanted = root.dataset.layout === 'right' ? 'right' : 'down';

  const canvas = overlay('lt-flow-svg');
  root.prepend(canvas);
  const styles = new Styles();
  let groups: (SVGGElement | null)[] = [];

  // When the drawing has to scroll sideways it is focusable, and the arrow keys move it. Not every
  // browser scrolls a focused box by itself, so it is done here.
  const onKey = (event: KeyboardEvent): void => {
    if (root.dataset.scroll === undefined || event.target !== root) return;
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    root.scrollLeft += step * 48;
  };
  root.addEventListener('keydown', onKey);

  // The width is the one that was set, not one read back: a read is rounded to a whole pixel, and
  // four nodes each half a pixel wider than planned no longer fit the column they were planned for.
  let nodeWidth = 0;
  const widths = (w: number): void => {
    nodeWidth = Math.round(w * 10) / 10;
    for (const node of nodeEls) styles.place(node, { width: nodeWidth });
  };
  const sizes = (): Size[] => nodeEls.map((node) => ({ w: nodeWidth, h: node.getBoundingClientRect().height }));

  const drawing: Drawing = {
    layout() {
      const avail = root.clientWidth;
      if (avail <= 0) return;
      root.dataset.drawn = 'true';
      const em = emOf(root);
      const m = metrics(em);
      const room = avail - 2 * MARGIN;
      // A label wraps early: every pixel it is wide is a pixel the nodes beside it cannot have.
      styles.set(root, '--lt-chip-max', `${Math.round(clamp(room * 0.3, 4 * em, 6.5 * em))}px`);
      const labelled = edgeEls.filter((edge) => edge.dataset.bare === undefined);
      // Measured both ways round, because which labels end up on a lane is only known once a layout is chosen.
      for (const edge of labelled) {
        edge.dataset.turned = 'true';
        styles.set(edge, 'inline-size', null);
      }
      const turnedWidth = new Map(labelled.map((edge) => [edge, edge.offsetWidth]));
      for (const edge of labelled) delete edge.dataset.turned;
      for (const edge of labelled) tighten(edge, styles);
      const measured = (): EdgeInput[] =>
        edgeEls.map((edge, i) => {
          const bare = edge.dataset.bare !== undefined;
          return { ...(ends[i] as { from: number; to: number }), labelW: bare ? 0 : edge.offsetWidth, labelH: bare ? 0 : edge.offsetHeight, turnedW: turnedWidth.get(edge) ?? 0 };
        });
      let edges = measured();
      const minNode = 6.8 * em;
      const maxNode = 13.5 * em;

      let placed: Placed | null = null;
      if (ring) {
        // A round ring first, with narrower nodes if that is what it takes; then the ring as two
        // columns. Each says so when it cannot be drawn in this width with every connection clear
        // of the nodes it does not join, and then the cycle is drawn as a chain with its closing
        // edge looping back, which the layered layout below does.
        for (const share of [0.3, 0.26, 0.22]) {
          const width = clamp(room * share, minNode, maxNode * 0.85);
          widths(width);
          placed = placeRingEllipse(sizes(), edges, room, m);
          if (placed || width === minNode) break;
        }
        if (!placed) {
          // What is left for the two columns once the gap between them and any lanes outside them have their room.
          const width = (room - ringTrackRoom(nodeEls.length, edges, m)) / 2;
          if (width >= minNode) {
            widths(Math.min(width, maxNode));
            placed = placeRingTrack(sizes(), edges, room, m);
          }
        }
      }
      if (!placed) {
        const plan = planLayered(nodeEls.length, edges, { avail: room, wanted, minNode, maxNode, metrics: m });
        if (plan.turned) {
          // The labels on lanes are set along them. Their boxes change shape, so they are measured again.
          edgeEls.forEach((edge, i) => {
            if (!plan.far[i] || edge.dataset.bare !== undefined) return;
            edge.dataset.turned = 'true';
            styles.set(edge, 'inline-size', null);
          });
          edges = measured();
        }
        widths(plan.nodeWidth);
        placed = placeLayered(sizes(), edges, plan.layering, plan.direction, m);
      }

      // Centre a drawing that is narrower than its column; one that is wider scrolls inside the figure.
      const overflow = placed.width > room + 0.5;
      const dx = overflow ? MARGIN : MARGIN + (room - placed.width) / 2;
      const dy = MARGIN;
      const width = overflow ? placed.width + 2 * MARGIN : avail;
      const height = placed.height + 2 * MARGIN;
      styles.place(root, { height });
      if (overflow) {
        root.dataset.scroll = 'true';
        root.tabIndex = 0;
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', 'Diagram, wider than the page: scroll sideways');
      } else {
        delete root.dataset.scroll;
        root.removeAttribute('tabindex');
        root.removeAttribute('role');
        root.removeAttribute('aria-label');
      }

      placed.nodes.forEach((r, i) => styles.place(nodeEls[i] as HTMLElement, { left: r.x + dx, top: r.y + dy }));
      canvas.setAttribute('width', String(Math.ceil(width)));
      canvas.setAttribute('height', String(Math.ceil(height)));
      canvas.replaceChildren();
      groups = placed.routes.map((route, i) => {
        const edge = edgeEls[i] as HTMLElement;
        if (!route) {
          // An edge whose ends cannot be found stays in the list for a screen reader and is not drawn.
          edge.dataset.unplaced = 'true';
          return null;
        }
        delete edge.dataset.unplaced;
        const moved = { ...route, points: route.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
        const group = connectorGroup(connector(moved, 9, 4.5), edge.dataset.dashed !== undefined ? 'lt-conn lt-conn-dashed' : 'lt-conn', width, height);
        // Which edge this is, by position in the list: highlighting reorders the groups.
        group.setAttribute('data-edge', String(i));
        canvas.append(group);
        const e = edges[i] as EdgeInput;
        if (route.label) styles.place(edge, { left: route.label.x + dx - e.labelW / 2, top: route.label.y + dy - e.labelH / 2 });
        return group;
      });
      drawing.highlight();
    },
    highlight() {
      syncGroups(groups, edgeEls);
    },
    dispose() {
      root.removeEventListener('keydown', onKey);
      canvas.remove();
      delete root.dataset.drawn;
      delete root.dataset.scroll;
      root.removeAttribute('tabindex');
      root.removeAttribute('role');
      root.removeAttribute('aria-label');
      styles.dispose();
      for (const node of [...nodeEls, ...edgeEls]) {
        delete node.dataset.unplaced;
        delete node.dataset.turned;
      }
    },
  };
  return drawing;
}
