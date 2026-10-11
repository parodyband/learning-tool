// A small stand-in for the DOM, for running the clip engine in Node.
//
// It does no layout and paints nothing. What it does is remember every write the engine makes
// (class names, attributes, inline styles through CSSOM, text, and the drawing calls on a canvas),
// so a test can ask "what would be on screen now?" as one string and compare two of them. That is
// all the determinism test needs: the engine's claim is that the page after render(t) depends on t
// alone, and this is the page.
//
// Only what the stage kits use is implemented. A kit that reaches for something else fails loudly
// here (an undefined method), which is the right outcome: add it, or do not use it in a kit.

export class FakeNode {
  parentNode: FakeElement | null = null;
  constructor(public nodeType: number) {}
  get parentElement(): FakeElement | null {
    return this.parentNode;
  }
  remove(): void {
    const p = this.parentNode;
    if (!p) return;
    const i = p.childNodes.indexOf(this);
    if (i >= 0) p.childNodes.splice(i, 1);
    this.parentNode = null;
  }
  get textContent(): string {
    return '';
  }
}

export class FakeText extends FakeNode {
  constructor(public data: string) {
    super(3);
  }
  override get textContent(): string {
    return this.data;
  }
  override set textContent(v: string) {
    this.data = v;
  }
  cloneNode(): FakeText {
    return new FakeText(this.data);
  }
}

class FakeStyle {
  readonly props = new Map<string, string>();
  setProperty(name: string, value: string): void {
    this.props.set(name, String(value));
  }
  getPropertyValue(name: string): string {
    return this.props.get(name) ?? '';
  }
  removeProperty(name: string): void {
    this.props.delete(name);
  }
}
/** `el.style.transform = ...` and friends land in the same map as setProperty. */
function styleProxy(): FakeStyle & Record<string, unknown> {
  const style = new FakeStyle();
  return new Proxy(style, {
    get(target, key) {
      if (key in target) return (target as unknown as Record<string | symbol, unknown>)[key];
      return typeof key === 'string' ? (target.props.get(key) ?? '') : undefined;
    },
    set(target, key, value) {
      if (typeof key === 'string') target.props.set(key, String(value));
      return true;
    },
  }) as FakeStyle & Record<string, unknown>;
}

/** A 2D context that records what was drawn since the canvas was last cleared. */
class FakeContext {
  readonly ops: string[] = [];
  font = '';
  fillStyle = '';
  strokeStyle = '';
  globalAlpha = 1;
  lineWidth = 1;
  private n(v: number): number {
    return Math.round(v * 100) / 100;
  }
  measureText(text: string): { width: number } {
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 16);
    return { width: text.length * px * 0.58 };
  }
  setTransform(...a: number[]): void {
    this.ops.push(`T${a.map((v) => this.n(v)).join(',')}`);
  }
  clearRect(): void {
    this.ops.length = 0;
  }
  beginPath(): void {
    this.ops.push(`B${this.fillStyle}@${this.n(this.globalAlpha)}`);
  }
  moveTo(): void {}
  arc(x: number, y: number, r: number): void {
    this.ops.push(`A${this.n(x)},${this.n(y)},${this.n(r)}`);
  }
  fill(): void {
    this.ops.push('F');
  }
}

function matches(el: FakeElement, selector: string): boolean {
  const sel = selector.trim();
  if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
  if (sel.startsWith('#')) return el.getAttribute('id') === sel.slice(1);
  return el.tagName.toLowerCase() === sel.toLowerCase();
}

export class FakeElement extends FakeNode {
  readonly childNodes: FakeNode[] = [];
  readonly attrs = new Map<string, string>();
  readonly style = styleProxy();
  private text: string | null = null;
  private ctx: FakeContext | null = null;
  width = 0;
  height = 0;
  hidden = false;
  type = '';
  clientWidth = 0;
  clientHeight = 0;
  [extra: string]: unknown;

  constructor(
    readonly tagName: string,
    readonly namespaceURI: string | null = null,
  ) {
    super(1);
    if (tagName.toLowerCase() === 'canvas') {
      (this as Record<string, unknown>).getContext = (kind: string): FakeContext | null => (kind === '2d' ? (this.ctx ??= new FakeContext()) : null);
    }
  }
  get className(): string {
    return this.attrs.get('class') ?? '';
  }
  set className(v: string) {
    this.attrs.set('class', v);
  }
  get id(): string {
    return this.attrs.get('id') ?? '';
  }
  set id(v: string) {
    this.attrs.set('id', v);
  }
  get classList(): { add(...c: string[]): void; remove(...c: string[]): void; contains(c: string): boolean; toggle(c: string, on?: boolean): boolean } {
    const read = (): string[] => this.className.split(/\s+/).filter(Boolean);
    const write = (list: string[]): void => void this.attrs.set('class', list.join(' '));
    return {
      add: (...c) => write([...new Set([...read(), ...c])]),
      remove: (...c) => write(read().filter((x) => !c.includes(x))),
      contains: (c) => read().includes(c),
      toggle: (c, on) => {
        const has = read().includes(c);
        const want = on ?? !has;
        if (want && !has) write([...read(), c]);
        if (!want && has) write(read().filter((x) => x !== c));
        return want;
      },
    };
  }
  get dataset(): Record<string, string | undefined> {
    return new Proxy(
      {},
      {
        get: (_t, key) => (typeof key === 'string' ? this.attrs.get(`data-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`) : undefined),
        set: (_t, key, value) => {
          if (typeof key === 'string') this.attrs.set(`data-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, String(value));
          return true;
        },
        deleteProperty: (_t, key) => {
          if (typeof key === 'string') this.attrs.delete(`data-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
          return true;
        },
      },
    ) as Record<string, string | undefined>;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  get children(): FakeElement[] {
    return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
  }
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): FakeNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  get childElementCount(): number {
    return this.children.length;
  }
  get offsetWidth(): number {
    return this.clientWidth;
  }
  get offsetHeight(): number {
    return this.clientHeight;
  }
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number; x: number; y: number } {
    return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight, x: 0, y: 0 };
  }
  override get textContent(): string {
    if (this.text !== null) return this.text;
    return this.childNodes.map((n) => n.textContent).join('');
  }
  override set textContent(v: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes.length = 0;
    this.text = null;
    if (v !== '') this.appendChild(new FakeText(v));
  }
  private adopt<T extends FakeNode>(node: T): T {
    node.remove();
    node.parentNode = this;
    return node;
  }
  appendChild<T extends FakeNode>(node: T): T {
    this.childNodes.push(this.adopt(node));
    return node;
  }
  append(...nodes: (FakeNode | string)[]): void {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? new FakeText(n) : n);
  }
  prepend(...nodes: (FakeNode | string)[]): void {
    const first = this.childNodes[0] ?? null;
    for (const n of nodes) this.insertBefore(typeof n === 'string' ? new FakeText(n) : n, first);
  }
  insertBefore<T extends FakeNode>(node: T, ref: FakeNode | null): T {
    this.adopt(node);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(node);
    else this.childNodes.splice(i, 0, node);
    return node;
  }
  after(...nodes: FakeNode[]): void {
    const p = this.parentNode;
    if (!p) return;
    let ref: FakeNode | null = p.childNodes[p.childNodes.indexOf(this) + 1] ?? null;
    for (const n of nodes) {
      p.insertBefore(n, ref);
      ref = p.childNodes[p.childNodes.indexOf(n) + 1] ?? null;
    }
  }
  replaceChildren(...nodes: (FakeNode | string)[]): void {
    this.textContent = '';
    this.append(...nodes);
  }
  removeChild<T extends FakeNode>(node: T): T {
    node.remove();
    return node;
  }
  contains(node: FakeNode | null): boolean {
    for (let n: FakeNode | null = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  cloneNode(deep = false): FakeElement {
    const copy = new FakeElement(this.tagName, this.namespaceURI);
    for (const [k, v] of this.attrs) copy.attrs.set(k, v);
    for (const [k, v] of this.style.props) copy.style.props.set(k, v);
    if (deep) for (const c of this.childNodes) copy.appendChild((c as FakeElement | FakeText).cloneNode(true));
    return copy;
  }
  private walk(visit: (el: FakeElement) => boolean | void): FakeElement | null {
    for (const c of this.children) {
      if (visit(c) === true) return c;
      const hit = c.walk(visit);
      if (hit) return hit;
    }
    return null;
  }
  querySelector(selector: string): FakeElement | null {
    const last = selector.replace(':scope >', '').trim().split(/\s+/).pop() ?? '';
    return this.walk((el) => matches(el, last));
  }
  querySelectorAll(selector: string): FakeElement[] {
    const last = selector.replace(':scope >', '').trim().split(/\s+/).pop() ?? '';
    const out: FakeElement[] = [];
    this.walk((el) => {
      if (matches(el, last)) out.push(el);
    });
    return out;
  }
  getElementsByClassName(cls: string): FakeElement[] {
    return this.querySelectorAll(`.${cls}`);
  }
  getElementsByTagName(tag: string): FakeElement[] {
    return this.querySelectorAll(tag);
  }
  closest(selector: string): FakeElement | null {
    for (let n: FakeElement | null = this; n; n = n.parentNode) if (matches(n, selector)) return n;
    return null;
  }
  matches(selector: string): boolean {
    return matches(this, selector);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  focus(): void {}

  /** What has been drawn on this canvas since it was last cleared. */
  drawn(): string[] {
    return this.ctx ? [...this.ctx.ops] : [];
  }
}

class FakeDocument {
  readonly documentElement = new FakeElement('html');
  readonly body = new FakeElement('body');
  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }
  createElementNS(ns: string, tag: string): FakeElement {
    return new FakeElement(tag, ns);
  }
  createTextNode(data: string): FakeText {
    return new FakeText(data);
  }
  getElementById(): null {
    return null;
  }
  querySelector(): null {
    return null;
  }
  querySelectorAll(): never[] {
    return [];
  }
  addEventListener(): void {}
}

/** Put the stand-in where the engine looks for `document`. Call once, before the engine is used. */
export function installFakeDom(): FakeDocument {
  const doc = new FakeDocument();
  (globalThis as Record<string, unknown>).document = doc;
  return doc;
}

/** A stage element of a given size, as the engine's `env.el`. */
export function stageElement(width: number, height: number): FakeElement {
  const scene = new FakeElement('section');
  scene.className = 'lt-scene';
  const el = new FakeElement('div');
  el.className = 'st-view';
  el.clientWidth = width;
  el.clientHeight = height;
  scene.appendChild(el);
  return el;
}

/**
 * Everything the engine has written under `root` that can be seen, as one string: each element's
 * tag, class, attributes, inline styles and own text, in document order, and each canvas's drawing
 * since its last clear. Two equal strings are two equal pages.
 *
 * An element at opacity 0 is recorded as hidden and nothing more: the engine stops writing to a
 * part it has made invisible, so what such a part last held is not part of the picture.
 */
export function snapshot(root: FakeElement): string {
  const out: string[] = [];
  const visit = (el: FakeElement, depth: number): void => {
    const pad = ' '.repeat(depth);
    if (el.style.props.get('opacity') === '0') {
      out.push(`${pad}<${el.tagName} class=${JSON.stringify(el.className)}> hidden`);
      return;
    }
    const attrs = [...el.attrs].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    const style = [...el.style.props].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}:${v}`);
    const text = el.childNodes
      .filter((n): n is FakeText => n instanceof FakeText)
      .map((n) => n.data)
      .join('');
    const drawn = el.drawn();
    out.push(`${pad}<${el.tagName} ${attrs.join(' ')}> {${style.join(';')}} ${JSON.stringify(text)}${drawn.length ? ` canvas[${drawn.join(' ')}]` : ''}`);
    for (const c of el.children) visit(c, depth + 1);
  };
  visit(root, 0);
  return out.join('\n');
}
