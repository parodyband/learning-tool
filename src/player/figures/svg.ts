// The few ways a figure adds to the page. Every element is made with createElement or
// createElementNS and filled through textContent or attributes, so nothing here can turn a string
// from the lesson into markup. Position and size are rules in a style sheet the script constructs
// (see `Styles`), which the page's policy allows; no element is ever given a style attribute.
import type { Pt, Route } from './graph';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** What every figure drawing offers the entry point in player/figures.ts. */
export interface Drawing {
  /** Lay the figure out for the room it has now. Safe to call again at any time. */
  layout(): void;
  /** Bring the drawn marks in line with the `data-hl` attributes on the figure's parts. */
  highlight(): void;
  /** Take the drawing away and leave the static markup as it was rendered. */
  dispose(): void;
}

export function svg<K extends keyof SVGElementTagNameMap>(name: K, className: string | null, attributes: Readonly<Record<string, string | number>> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  if (className) el.setAttribute('class', className);
  for (const key of Object.keys(attributes)) el.setAttribute(key, String(attributes[key]));
  return el;
}

/** An overlay that only decorates: hidden from assistive technology and from the tab order. */
export function overlay(className: string): SVGSVGElement {
  return svg('svg', className, { 'aria-hidden': 'true', focusable: 'false' });
}

export function el<K extends keyof HTMLElementTagNameMap>(name: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const px = (v: number): string => `${Math.round(v * 10) / 10}px`;
const n = (v: number): string => String(Math.round(v * 10) / 10);

let serial = 0;

/**
 * Where a drawing keeps the positions and sizes it works out: one rule per element, in a style
 * sheet made by the script and adopted by the document.
 *
 * Writing `element.style` would do the same job and is allowed by the policy, but it leaves a
 * `style` attribute on the element. The page promises that no element has one, so that a style
 * attribute anywhere can only be something that got past the escaping. A rule keeps that promise.
 * Each element is found by a number this module hands out, never by anything from the lesson.
 * Declarations are marked important because they stand in for inline styles and must win over the
 * figure's own rules in the same way.
 */
export class Styles {
  private sheet: CSSStyleSheet | null = null;
  private readonly rules = new Map<Element, CSSStyleDeclaration>();
  private inline = false;

  private declarations(node: Element): CSSStyleDeclaration {
    const known = this.rules.get(node);
    if (known) return known;
    if (!this.sheet && !this.inline) {
      try {
        const sheet = new CSSStyleSheet();
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        this.sheet = sheet;
      } catch {
        // A browser without constructed style sheets: the element's own style is the only way left.
        this.inline = true;
      }
    }
    if (!this.sheet) return (node as HTMLElement).style;
    const key = String(++serial);
    node.setAttribute('data-at', key);
    const index = this.sheet.insertRule(`[data-at="${key}"]{}`, this.sheet.cssRules.length);
    const style = (this.sheet.cssRules[index] as CSSStyleRule).style;
    this.rules.set(node, style);
    return style;
  }

  /** Set one property on an element, or take it away with null. */
  set(node: Element, property: string, value: string | null): void {
    if (value === null) {
      // Nothing to remove from an element that was never given anything.
      if (this.sheet ? this.rules.has(node) : this.inline) this.declarations(node).removeProperty(property);
    } else this.declarations(node).setProperty(property, value, 'important');
  }

  /** Set lengths in pixels on an element. A null takes the property away. */
  place(node: Element, properties: Readonly<Record<string, number | null>>): void {
    for (const key of Object.keys(properties)) {
      const value = properties[key];
      this.set(node, key, value === null || value === undefined ? null : px(value));
    }
  }

  /** Forget every rule, for a drawing that rebuilds its elements each time it is laid out. */
  clear(): void {
    for (const node of this.rules.keys()) node.removeAttribute('data-at');
    this.rules.clear();
    if (this.sheet) this.sheet.replaceSync('');
  }

  dispose(): void {
    this.clear();
    const sheet = this.sheet;
    if (sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    this.sheet = null;
  }
}

/** The font size an element is set in, which every distance in a drawing is a multiple of. */
export function emOf(node: Element): number {
  const size = Number.parseFloat(getComputedStyle(node).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 15;
}

/** An element's box relative to another's top left corner. */
export function boxIn(node: Element, frame: Element): { x: number; y: number; w: number; h: number } {
  const a = node.getBoundingClientRect();
  const b = frame.getBoundingClientRect();
  return { x: a.left - b.left + frame.scrollLeft, y: a.top - b.top + frame.scrollTop, w: a.width, h: a.height };
}

const unit = (from: Pt, to: Pt): Pt => {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return d === 0 ? { x: 0, y: 1 } : { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
};

/** A filled triangle whose tip is at `tip`, pointing along `direction` (a unit vector). */
export function headPath(tip: Pt, direction: Pt, length: number, half: number): string {
  const bx = tip.x - direction.x * length;
  const by = tip.y - direction.y * length;
  return `M${n(tip.x)} ${n(tip.y)}L${n(bx - direction.y * half)} ${n(by + direction.x * half)}L${n(bx + direction.y * half)} ${n(by - direction.x * half)}Z`;
}

/** Straight segments with each corner rounded off. */
export function roundedPath(points: readonly Pt[], radius: number): string {
  if (points.length === 0) return '';
  const first = points[0] as Pt;
  let d = `M${n(first.x)} ${n(first.y)}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i] as Pt;
    const next = points[i + 1];
    if (!next) {
      d += `L${n(p.x)} ${n(p.y)}`;
      break;
    }
    const prev = points[i - 1] as Pt;
    const r = Math.min(radius, Math.hypot(p.x - prev.x, p.y - prev.y) / 2, Math.hypot(next.x - p.x, next.y - p.y) / 2);
    const a = unit(p, prev);
    const b = unit(p, next);
    d += `L${n(p.x + a.x * r)} ${n(p.y + a.y * r)}Q${n(p.x)} ${n(p.y)} ${n(p.x + b.x * r)} ${n(p.y + b.y * r)}`;
  }
  return d;
}

export interface Connector {
  /** The line, stopped short so that the arrowhead, not the line, touches the node. */
  line: string;
  head: string;
  /** Where the connector ends: the tip of its arrowhead. */
  tip: Pt;
}

/** Path data for a route and its arrowhead. */
export function connector(route: Route, headLength: number, headHalf: number): Connector {
  const points = route.points.map((p) => ({ ...p }));
  const tip = points[points.length - 1] as Pt;
  const before = points[points.length - 2] ?? tip;
  let direction = unit(before, tip);
  if (route.kind === 'curve' && before.x === tip.x && before.y === tip.y) direction = unit(points[0] as Pt, tip);
  const back = headLength * 0.7;
  const end = { x: tip.x - direction.x * back, y: tip.y - direction.y * back };
  let line: string;
  if (route.kind === 'curve' && points.length === 4) {
    const [p0, c1, c2] = points as [Pt, Pt, Pt, Pt];
    const c2b = { x: c2.x - direction.x * back, y: c2.y - direction.y * back };
    line = `M${n(p0.x)} ${n(p0.y)}C${n(c1.x)} ${n(c1.y)} ${n(c2b.x)} ${n(c2b.y)} ${n(end.x)} ${n(end.y)}`;
  } else {
    points[points.length - 1] = end;
    line = roundedPath(points, 7);
  }
  return { line, head: headPath(tip, direction, headLength, headHalf), tip };
}

/**
 * Path data that draws `d` and has the whole canvas as its bounding box: a zero-length stroke at
 * each of two opposite corners, which paints nothing (the strokes here have butt ends).
 *
 * Why: the text of a figure sits in front of the connectors on an opaque ground of its own, and a
 * contrast checker should be able to confirm that. axe-core decides by listing the elements whose
 * boxes lie behind each line of a piece of text, and gives up when two lines of the same text have
 * different lists. A connector's own box is the rectangle around its path, which cuts through
 * whatever it passes: one line of a node's label, not the next. With every connector's box the
 * same size as the drawing, every line of every label has the same things behind it.
 */
export function spanning(d: string, width: number, height: number): string {
  return `M0 0h0${d}M${n(width)} ${n(height)}h0`;
}

/** A connector as a group: a wide underlay that shows only when highlighted, the line, and the head. */
export function connectorGroup(c: Connector, className: string, width: number, height: number): SVGGElement {
  const g = svg('g', className);
  const line = spanning(c.line, width, height);
  g.append(svg('path', 'lt-conn-halo', { d: line }), svg('path', 'lt-conn-line', { d: line }), svg('path', 'lt-conn-head', { d: spanning(c.head, width, height) }));
  return g;
}

/** Mark the groups whose parts are highlighted, and draw those last so they sit on top. */
export function syncGroups(groups: readonly (SVGElement | null)[], parts: readonly HTMLElement[]): void {
  groups.forEach((g, i) => {
    if (!g) return;
    const on = parts[i]?.dataset.hl === 'true';
    g.classList.toggle('lt-hl', on);
    if (on) g.parentNode?.append(g);
  });
}
