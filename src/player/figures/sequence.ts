// A sequence figure, drawn: one column per participant, a lifeline under each, and every message
// as an arrow between two lifelines with its label above it. The labels are the list items the
// renderer wrote, moved sideways; the lifelines and arrows are an SVG behind them.
//
// When the columns would be too narrow to read (many participants in a phone-width column) nothing
// is drawn and the figure stays the numbered list it already is: who to whom, then what.
import { domId } from '../main';
import { type Drawing, Styles, boxIn, emOf, headPath, overlay, roundedPath, spanning, svg, syncGroups } from './svg';

/** Narrowest a participant's column may be, in ems, before the list reads better than the drawing. */
const MIN_COLUMN = 5.4;

export function sequenceDrawing(figure: HTMLElement): Drawing | null {
  const root = figure.querySelector<HTMLElement>('.lt-seq');
  if (!root) return null;
  const sceneId = figure.dataset.scene ?? '';
  const actorEls = Array.from(root.querySelectorAll<HTMLElement>('.lt-seq-actors > .lt-actor'));
  const msgEls = Array.from(root.querySelectorAll<HTMLElement>('.lt-seq-messages > .lt-msg'));
  if (actorEls.length < 2 || msgEls.length === 0) return null;

  const indexOf = new Map<Element, number>(actorEls.map((actor, i) => [actor, i]));
  const resolve = (partId: string | undefined): number => {
    const actor = partId === undefined ? null : document.getElementById(domId(sceneId, partId));
    return (actor ? indexOf.get(actor) : undefined) ?? -1;
  };
  const messages = msgEls.map((msg) => ({
    el: msg,
    chip: msg.querySelector<HTMLElement>('.lt-msg-text'),
    from: resolve(msg.dataset.from),
    to: resolve(msg.dataset.to),
    lost: msg.dataset.status === 'lost',
  }));
  // A message that names a participant the figure does not have cannot be placed; the list still says it.
  if (messages.some((msg) => msg.from < 0 || msg.to < 0 || !msg.chip)) return null;

  const canvas = overlay('lt-seq-svg');
  root.prepend(canvas);
  const styles = new Styles();
  let lifelines: SVGElement[] = [];
  let arrows: SVGElement[] = [];

  const clear = (): void => {
    canvas.replaceChildren();
    lifelines = [];
    arrows = [];
    styles.clear();
    for (const msg of messages) delete msg.el.dataset.self;
  };

  const drawing: Drawing = {
    layout() {
      const avail = root.clientWidth;
      if (avail <= 0) return;
      const em = emOf(root);
      const count = actorEls.length;
      const column = avail / count;
      clear();
      if (column < MIN_COLUMN * em) {
        root.dataset.drawn = 'list';
        return;
      }
      root.dataset.drawn = 'true';
      styles.set(root, '--lt-cols', String(count));
      const x = (i: number): number => (i + 0.5) * column;
      const loop = Math.min(1.6 * em, column * 0.3);
      const pad = 0.5 * em;

      // Each label gets the widest box that still reads as belonging to its arrow, then its measured
      // width decides where it sits. Writes first, then one round of reads, then writes again.
      const sides = messages.map((msg) => (msg.from === msg.to && x(msg.from) + pad + 6 * em > avail ? -1 : 1));
      messages.forEach((msg, k) => {
        const chip = msg.chip as HTMLElement;
        if (msg.from === msg.to) {
          msg.el.dataset.self = 'true';
          // Kept between its own lifeline and the next when that leaves a readable width, so the
          // label is not taken for a message to the neighbour.
          const reach = sides[k] === 1 ? avail - x(msg.from) - pad : x(msg.from) - pad;
          styles.place(chip, { 'max-width': column - 2 * pad >= 7 * em ? Math.min(reach, column - 2 * pad) : reach });
        } else {
          styles.place(chip, { 'max-width': Math.min(avail, Math.max(Math.abs(x(msg.to) - x(msg.from)) - 2 * pad, 16 * em)) });
        }
      });
      const chipWidths = messages.map((msg) => (msg.chip as HTMLElement).offsetWidth);
      messages.forEach((msg, k) => {
        const chip = msg.chip as HTMLElement;
        const w = chipWidths[k] as number;
        if (msg.from === msg.to) styles.place(chip, { 'margin-left': sides[k] === 1 ? x(msg.from) + pad : x(msg.from) - pad - w });
        else styles.place(chip, { 'margin-left': Math.min(avail - w, Math.max(0, (x(msg.from) + x(msg.to)) / 2 - w / 2)) });
      });

      const height = root.offsetHeight;
      canvas.setAttribute('width', String(Math.ceil(avail)));
      canvas.setAttribute('height', String(Math.ceil(height)));
      const lifeGroup = svg('g', 'lt-seq-lifelines');
      const arrowGroup = svg('g', 'lt-seq-arrows');
      canvas.append(lifeGroup, arrowGroup);

      lifelines = actorEls.map((actor, i) => {
        const box = boxIn(actor, root);
        const line = svg('line', 'lt-seq-lifeline', { x1: x(i), y1: box.y + box.h, x2: x(i), y2: height - 1 });
        lifeGroup.append(line);
        return line;
      });

      arrows = messages.map((msg, k) => {
        const row = boxIn(msg.el, root);
        const bottom = row.y + row.h;
        const group = svg('g', msg.lost ? 'lt-conn lt-conn-lost' : 'lt-conn', { 'data-edge': k });
        const from = x(msg.from);
        let d: string;
        let tip: { x: number; y: number };
        let direction: { x: number; y: number };
        if (msg.from === msg.to) {
          // Out from the lifeline, down, and back to it.
          const side = sides[k] as number;
          const y0 = bottom - 1.65 * em;
          const y1 = bottom - 0.5 * em;
          const out = from + side * loop;
          tip = msg.lost ? { x: out, y: y1 } : { x: from + side * 1, y: y1 };
          direction = msg.lost ? { x: 0, y: 1 } : { x: -side, y: 0 };
          const points = msg.lost ? [{ x: from, y: y0 }, { x: out, y: y0 }, { x: out, y: y1 - 7 }] : [{ x: from, y: y0 }, { x: out, y: y0 }, { x: out, y: y1 }, { x: from + side * 7, y: y1 }];
          d = roundedPath(points, 5);
        } else {
          const to = x(msg.to);
          const y = bottom - 0.6 * em;
          const sign = to > from ? 1 : -1;
          // A lost message stops well short of the lifeline it was meant for.
          const reach = msg.lost ? from + (to - from) * 0.62 : to - sign;
          tip = { x: reach, y };
          direction = { x: sign, y: 0 };
          d = `M${Math.round(from * 10) / 10} ${Math.round(y * 10) / 10}H${Math.round((reach - sign * 7) * 10) / 10}`;
        }
        // Every path is given the whole drawing as its box, so no label has an arrow behind part of it only (see `spanning`).
        const whole = (data: string): string => spanning(data, avail, height);
        group.append(svg('path', 'lt-conn-halo', { d: whole(d) }), svg('path', 'lt-conn-line', { d: whole(d) }));
        if (msg.lost) {
          const s = 4.5;
          group.append(svg('path', 'lt-conn-cross', { d: whole(`M${tip.x - s} ${tip.y - s}L${tip.x + s} ${tip.y + s}M${tip.x - s} ${tip.y + s}L${tip.x + s} ${tip.y - s}`) }));
        } else {
          group.append(svg('path', 'lt-conn-head', { d: whole(headPath(tip, direction, 9, 4.5)) }));
        }
        arrowGroup.append(group);
        return group;
      });
      drawing.highlight();
    },
    highlight() {
      syncGroups(arrows, msgEls);
      lifelines.forEach((line, i) => line.classList.toggle('lt-hl', actorEls[i]?.dataset.hl === 'true'));
    },
    dispose() {
      clear();
      styles.dispose();
      canvas.remove();
      delete root.dataset.drawn;
    },
  };
  return drawing;
}
