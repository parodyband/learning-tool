// Inline markup for prose strings: `**strong**`, `*em*`, `` `code` `` and `$math$`. Nothing else.
//
// A hand-written tokenizer in three linear passes: code spans, then math spans and escapes, then
// emphasis. The rules are chosen so that ordinary technical prose is never mistaken for markup:
//
//   - `*` and `**` follow CommonMark's flanking rules with one tightening: a run between two word
//     characters neither opens nor closes (as CommonMark does for `_`), so `2*3*4` and `a*b*c` stay
//     literal. A character of a script written without spaces (Chinese, Japanese, Thai, ...) does
//     not count as a word character here, because in those scripts every run sits between two.
//     Runs of four or more stars are always literal.
//   - A `$` opens math only when the next `$` closes it: the content is not empty, has no space at
//     either end, and the closing `$` is not followed by a digit. "$5 and $10" and "$5-$10" are text.
//   - Code spans are found first and are opaque: nothing inside one is markup.
//   - A delimiter with no partner is literal text and is not an error. The only error is a math
//     span whose content is outside the supported subset.
//
// Environment-neutral: no node: imports, no DOM.
import { mathToText, parseMath, type MathNode } from './math';

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'math'; v: string; nodes: MathNode[] };

export interface MarkupError {
  code: 'MARKUP_MATH';
  /** What is unsupported. Names at most one command or character, never a run of the source text. */
  message: string;
  /** Offset in the source string (UTF-16 units) of the unsupported thing. */
  at: number;
  /** The math span that contains it, delimiters included: `src.slice(start, end)`. */
  start: number;
  end: number;
}

export interface ParsedInline {
  nodes: Inline[];
  errors: MarkupError[];
}

/** Emphasis may nest this many delimiter runs deep; further openers are literal. Bounds the depth of the node tree for every consumer. */
export const MARKUP_MAX_NESTING = 8;

const BACKSLASH = 0x5c;
const STAR = 0x2a;
const TICK = 0x60;
const DOLLAR = 0x24;

const PUNCT = /[\p{P}\p{S}]/u;
const SPACE = /\s/u;
// Scripts written without spaces between words. Marks and the prolonged sound mark are covered through Script_Extensions.
const UNSPACED = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u;

function isEscapable(c: number): boolean {
  return c === STAR || c === TICK || c === DOLLAR;
}
function isAsciiSpace(c: number): boolean {
  return c === 0x20 || (c >= 0x09 && c <= 0x0d);
}
function isSpaceAt(s: string, i: number): boolean {
  const c = s.charCodeAt(i);
  return c < 0x80 ? isAsciiSpace(c) : SPACE.test(s[i] as string);
}

/** 0 = white space or an end of the string, 1 = punctuation or symbol, 2 = unspaced-script character, 3 = any other character. */
function classify(cp: number | undefined): 0 | 1 | 2 | 3 {
  if (cp === undefined) return 0;
  if (cp < 0x80) {
    if (isAsciiSpace(cp)) return 0;
    const alnum = (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
    return alnum || cp < 0x20 || cp === 0x7f ? 3 : 1;
  }
  const ch = String.fromCodePoint(cp);
  if (SPACE.test(ch)) return 0;
  if (PUNCT.test(ch)) return 1;
  return UNSPACED.test(ch) ? 2 : 3;
}

function codePointBefore(s: string, i: number): number | undefined {
  if (i <= 0) return undefined;
  const c = s.charCodeAt(i - 1);
  if (c >= 0xdc00 && c <= 0xdfff && i >= 2) {
    const h = s.charCodeAt(i - 2);
    if (h >= 0xd800 && h <= 0xdbff) return s.codePointAt(i - 2);
  }
  return c;
}

type Item = { k: 'text'; v: string } | { k: 'node'; node: Inline } | { k: 'run'; count: number; canOpen: boolean; canClose: boolean };

interface Segment {
  start: number;
  end: number;
  /** Set for a code span; otherwise the segment is raw text still to be scanned. */
  code?: string;
}

/** Pass 1: code spans. A run of N backticks opens a span closed by the next run of exactly N, as in CommonMark. */
function splitCode(src: string): Segment[] {
  const n = src.length;
  const first = src.indexOf('`');
  if (first === -1) return [{ start: 0, end: n }];

  // Start offsets of every maximal backtick run, by run length, so a closer is found without rescanning.
  const runs = new Map<number, number[]>();
  for (let i = first; i < n; i++) {
    if (src.charCodeAt(i) !== TICK) continue;
    let j = i + 1;
    while (j < n && src.charCodeAt(j) === TICK) j++;
    const list = runs.get(j - i);
    if (list) list.push(i);
    else runs.set(j - i, [i]);
    i = j;
  }
  const cursor = new Map<number, number>();

  const out: Segment[] = [];
  let rawStart = 0;
  let i = 0;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === BACKSLASH && isEscapable(src.charCodeAt(i + 1))) {
      i += 2;
      continue;
    }
    if (c !== TICK) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < n && src.charCodeAt(j) === TICK) j++;
    const len = j - i;
    const list = runs.get(len);
    let close = -1;
    if (list) {
      let p = cursor.get(len) ?? 0;
      while (p < list.length && (list[p] as number) < j) p++;
      cursor.set(len, p);
      if (p < list.length) close = list[p] as number;
    }
    if (close === -1) {
      i = j;
      continue;
    }
    let v = src.slice(j, close);
    // One space of padding is removed from each end, so a span can begin or end with a backtick.
    if (v.length >= 2 && v.charCodeAt(0) === 0x20 && v.charCodeAt(v.length - 1) === 0x20 && v.trim() !== '') v = v.slice(1, -1);
    if (rawStart < i) out.push({ start: rawStart, end: i });
    out.push({ start: i, end: close + len, code: v });
    i = close + len;
    rawStart = i;
  }
  if (rawStart < n) out.push({ start: rawStart, end: n });
  return out;
}

/** Pass 2, over one raw segment: backslash escapes, math spans, and `*` runs with what each may do. */
function scanRaw(src: string, start: number, end: number, items: Item[], errors: MarkupError[]): void {
  let buf = '';
  let from = start;
  const flush = (upTo: number): void => {
    if (upTo > from) buf += src.slice(from, upTo);
    if (buf) items.push({ k: 'text', v: buf });
    buf = '';
  };

  let i = start;
  while (i < end) {
    const c = src.charCodeAt(i);
    if (c !== BACKSLASH && c !== STAR && c !== DOLLAR) {
      i++;
      continue;
    }
    if (c === BACKSLASH) {
      if (i + 1 < end && isEscapable(src.charCodeAt(i + 1))) {
        buf += src.slice(from, i) + (src[i + 1] as string);
        i += 2;
        from = i;
      } else {
        i++;
      }
      continue;
    }

    let j = i + 1;
    while (j < end && src.charCodeAt(j) === c) j++;
    const len = j - i;

    if (c === DOLLAR) {
      const close = len <= 2 ? findMathClose(src, j, end, len) : -1;
      if (close === -1) {
        i = j;
        continue;
      }
      const content = src.slice(j, close);
      const spanEnd = close + len;
      const parsed = parseMath(content);
      if (parsed.ok) {
        flush(i);
        items.push({ k: 'node', node: { t: 'math', v: content, nodes: parsed.nodes } });
        from = spanEnd;
      } else {
        // The span stays in the text as written, so a reader of an unvalidated string sees the source.
        errors.push({ code: 'MARKUP_MATH', message: parsed.message, at: j + parsed.at, start: i, end: spanEnd });
      }
      i = spanEnd;
      continue;
    }

    // A run of `*`. Four or more is never emphasis. In the two flanking tests an unspaced-script
    // character counts with white space and punctuation (`<= 2`): there, emphasis that ends in
    // punctuation is followed directly by the next word, as in "**重要。**次の文".
    const before = classify(codePointBefore(src, i));
    const after = classify(j < src.length ? src.codePointAt(j) : undefined);
    const left = after !== 0 && (after !== 1 || before <= 2);
    const right = before !== 0 && (before !== 1 || after <= 2);
    // Between two letters or digits of a spaced script a run is arithmetic or a glob, not emphasis.
    const insideWord = before === 3 && after === 3;
    const canOpen = len <= 3 && left && !insideWord;
    const canClose = len <= 3 && right && !insideWord;
    if (!canOpen && !canClose) {
      i = j;
      continue;
    }
    flush(i);
    items.push({ k: 'run', count: len, canOpen, canClose });
    i = j;
    from = j;
  }
  flush(end);
}

/**
 * The offset of the `$` run that closes a math span whose content starts at `from`, or -1.
 * Only the nearest unescaped run is considered, so the scan is linear however many `$` there are.
 */
function findMathClose(src: string, from: number, end: number, len: number): number {
  if (from >= end || isSpaceAt(src, from)) return -1;
  let at = from;
  for (;;) {
    const e = src.indexOf('$', at);
    if (e === -1 || e >= end) return -1;
    if (src.charCodeAt(e - 1) === BACKSLASH) {
      at = e + 1;
      continue;
    }
    let j = e + 1;
    while (j < end && src.charCodeAt(j) === DOLLAR) j++;
    if (j - e !== len) return -1;
    if (isSpaceAt(src, e - 1)) return -1;
    const next = src.charCodeAt(j);
    if (next >= 0x30 && next <= 0x39) return -1;
    return e;
  }
}

function pushText(into: Inline[], v: string): void {
  if (!v) return;
  const last = into[into.length - 1];
  if (last && last.t === 'text') last.v += v;
  else into.push({ t: 'text', v });
}

/** Pass 3: pair `*` runs. Each closer pairs with the nearest open run, so the tree is always properly nested. */
function resolveEmphasis(items: Item[]): Inline[] {
  const frames: { count: number; children: Inline[] }[] = [{ count: 0, children: [] }];
  const top = (): { count: number; children: Inline[] } => frames[frames.length - 1] as { count: number; children: Inline[] };

  for (const item of items) {
    if (item.k === 'text') {
      pushText(top().children, item.v);
      continue;
    }
    if (item.k === 'node') {
      top().children.push(item.node);
      continue;
    }
    let count = item.count;
    if (item.canClose) {
      while (count > 0 && frames.length > 1) {
        const f = top();
        const use = f.count >= 2 && count >= 2 ? 2 : 1;
        const node: Inline = { t: use === 2 ? 'strong' : 'em', c: f.children };
        f.count -= use;
        count -= use;
        if (f.count === 0) {
          frames.pop();
          top().children.push(node);
        } else {
          f.children = [node];
        }
      }
    }
    if (count === 0) continue;
    if (item.canOpen && frames.length <= MARKUP_MAX_NESTING) frames.push({ count, children: [] });
    else pushText(top().children, '*'.repeat(count));
  }

  // Runs that never closed are text. Folding upward from the root keeps this linear.
  const out = (frames[0] as { children: Inline[] }).children;
  for (let k = 1; k < frames.length; k++) {
    const f = frames[k] as { count: number; children: Inline[] };
    pushText(out, '*'.repeat(f.count));
    for (const child of f.children) {
      if (child.t === 'text') pushText(out, child.v);
      else out.push(child);
    }
  }
  return out;
}

/**
 * Parse a prose string. Always returns nodes that reproduce the whole string; `errors` lists math
 * spans that are outside the supported subset (those spans appear in `nodes` as literal text).
 */
export function parseInline(src: string): ParsedInline {
  if (src === '') return { nodes: [], errors: [] };
  let special = false;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === STAR || c === TICK || c === DOLLAR || c === BACKSLASH) {
      special = true;
      break;
    }
  }
  if (!special) return { nodes: [{ t: 'text', v: src }], errors: [] };

  const items: Item[] = [];
  const errors: MarkupError[] = [];
  for (const seg of splitCode(src)) {
    if (seg.code !== undefined) items.push({ k: 'node', node: { t: 'code', v: seg.code } });
    else scanRaw(src, seg.start, seg.end, items, errors);
  }
  return { nodes: resolveEmphasis(items), errors };
}

type Part = 'text' | 'code' | 'math';

function collect(nodes: Inline[], want: (part: Part, value: string, math: MathNode[] | null) => void): void {
  for (const node of nodes) {
    if (node.t === 'text') want('text', node.v, null);
    else if (node.t === 'code') want('code', node.v, null);
    else if (node.t === 'math') want('math', node.v, node.nodes);
    else collect(node.c, want);
  }
}

/**
 * The string with markup removed: emphasis delimiters dropped, code spans as their content, math
 * as one line of readable text (`x^2 + 1`). This is what is counted, narrated and compared.
 */
export function plainText(src: string): string {
  let out = '';
  collect(parseInline(src).nodes, (part, value, math) => {
    out += part === 'math' && math ? mathToText(math) : value;
  });
  return out;
}

/**
 * Only the running prose: code and math spans are each replaced by one space. Use it for checks
 * that must not look inside those spans (numbers that need a source, URLs in text).
 */
export function proseText(src: string): string {
  let out = '';
  collect(parseInline(src).nodes, (part, value) => {
    out += part === 'text' ? value : ' ';
  });
  return out.replace(/ {2,}/g, ' ').trim();
}

/** The content of every code span, in order. */
export function codeSpans(src: string): string[] {
  const out: string[] = [];
  collect(parseInline(src).nodes, (part, value) => {
    if (part === 'code') out.push(value);
  });
  return out;
}

/** The source of every math span that parsed, in order, without its `$` delimiters. */
export function mathSpans(src: string): string[] {
  const out: string[] = [];
  collect(parseInline(src).nodes, (part, value) => {
    if (part === 'math') out.push(value);
  });
  return out;
}
