// The one module that turns data into markup. Every other render file builds HTML through `html`
// below and never by string concatenation, so the rules are enforced in one place:
//
//   - A plain string is always TEXT. Wherever it is interpolated it is escaped.
//   - Markup is an `Html` value. Only `html`, `raw` and the helpers here create one. `raw` exists
//     for markup produced by another trusted builder (MathML from core/math, a nested renderer
//     that returns a string) and must never be given a string that came from the lesson.
//   - An interpolation may sit in two places only: element content, or inside a double-quoted
//     attribute value. A template that puts one where a tag name or attribute name would go is
//     rejected the first time it runs. Optional attributes go through `attrs({...})`, whose names
//     are written by the renderer.
//   - A URL attribute accepts only a `Url`, and the only ways to make one are `idLink` (a fragment
//     that points at a renderer-generated id) and `sourceLink` (an http(s) URL that has been through
//     the WHATWG parser again). A `class` attribute accepts only a `Token` from a fixed list.
//   - `style` attributes and inline event handlers cannot be written at all. The page's
//     Content-Security-Policy would block them anyway; refusing them here keeps that from being the
//     only line of defence.
//
// Element ids are built by `domId`, `internalId`, `sceneHeadingId` and `pageId`. Nothing else may
// invent one.

const ENTITY: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\u0000': '\uFFFD' };
// U+0000 is a parse error in every HTML tokenizer state and is replaced or dropped differently by
// each one, so it never reaches the output.
const UNSAFE = /[&<>"'\u0000]/g;

/** Escape text for element content and for a double-quoted attribute value. */
export function esc(value: string | number): string {
  const s = typeof value === 'number' ? String(value) : value;
  return s.replace(UNSAFE, (c) => ENTITY[c] as string);
}

/** Markup that is safe to place in a document as it is. */
export class Html {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

/** A value for `href` and the other URL attributes. Made only by `idLink` and `sourceLink`. */
export class Url {
  readonly href: string;
  /** @internal Use `idLink` or `sourceLink`. */
  constructor(href: string) {
    this.href = href;
  }
}

/** One class name taken from a fixed list. Made only by `token`. */
export class Token {
  readonly value: string;
  /** @internal Use `token`. */
  constructor(value: string) {
    this.value = value;
  }
}

/** Zero or more whole attributes, for the tag position. Made only by `attrs`. */
export class Attrs {
  readonly value: string;
  /** @internal Use `attrs`. */
  constructor(value: string) {
    this.value = value;
  }
}

export type Part = string | number | Html | Url | Token | Attrs | null | undefined | false | readonly Part[];

/** Markup from another trusted builder. Never pass anything that came from the lesson. */
export function raw(markup: string): Html {
  return new Html(markup);
}

export const EMPTY = new Html('');

/** Attributes whose value is fetched or navigated to. */
const URL_ATTRS = new Set([
  'href', 'src', 'srcset', 'action', 'formaction', 'poster', 'data', 'ping', 'cite', 'background', 'manifest', 'codebase', 'longdesc', 'usemap', 'icon', 'xlink:href',
]);

function forbiddenAttr(name: string): boolean {
  return name === 'style' || name.startsWith('on');
}

type Slot = { where: 'text' } | { where: 'tag' } | { where: 'attr'; name: string; whole: boolean };

const analysed = new WeakMap<TemplateStringsArray, Slot[]>();

function fail(message: string, strings: readonly string[]): never {
  throw new Error(`render/escape: ${message} in template "${strings.join('${}').slice(0, 120)}"`);
}

/**
 * Walk the fixed parts of a template once and work out where each interpolation lands. The parts
 * are written by us, so this is a check on the renderer's own code, run once per template.
 */
function analyse(strings: TemplateStringsArray): Slot[] {
  const slots: Slot[] = [];
  let state: 'text' | 'tag' | 'value' = 'text';
  let attr = '';
  for (let k = 0; k < strings.length; k++) {
    const s = strings[k] as string;
    // True while the attribute value that is open began at the very end of this part.
    let openedAtEnd = false;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      openedAtEnd = false;
      if (state === 'text') {
        if (c !== 0x3c) continue;
        const next = s[i + 1];
        if (next === undefined) fail('an interpolation cannot be a tag name', strings);
        if (!/[A-Za-z/]/.test(next)) fail('write a literal "<" as &lt; (comments and doctype are not built here)', strings);
        const tagName = /^\/?([A-Za-z][A-Za-z0-9-]*)/.exec(s.slice(i + 1))?.[1]?.toLowerCase();
        // Their content is not parsed as HTML, so escaping means something else there. The page
        // shell writes them with inlineScript, inlineStyle and dataScript instead.
        if (tagName === 'script' || tagName === 'style') fail('script and style elements are written by the page shell only', strings);
        state = 'tag';
      } else if (state === 'tag') {
        if (c === 0x3e) state = 'text';
        else if (c === 0x27) fail('attribute values are always double-quoted', strings);
        else if (c === 0x22) {
          const name = /([^\s"'<>/=]+)=$/.exec(s.slice(0, i))?.[1]?.toLowerCase();
          if (!name) fail('a double quote in a tag must open an attribute value', strings);
          if (forbiddenAttr(name)) fail(`the "${name}" attribute is not allowed`, strings);
          attr = name;
          state = 'value';
          openedAtEnd = true;
        }
      } else if (c === 0x22) {
        state = 'tag';
      }
    }
    if (k === strings.length - 1) break;
    if (state === 'text') slots.push({ where: 'text' });
    else if (state === 'tag') {
      if (/=\s*$/.test(s)) fail('attribute values are always double-quoted', strings);
      slots.push({ where: 'tag' });
    } else {
      const whole = openedAtEnd && (strings[k + 1] as string).startsWith('"');
      slots.push({ where: 'attr', name: attr, whole });
    }
  }
  if (state !== 'text') fail('a template must end outside a tag', strings);
  return slots;
}

function textPart(v: Part, strings: readonly string[]): string {
  if (v === null || v === undefined || v === false) return '';
  if (typeof v === 'string' || typeof v === 'number') return esc(v);
  if (v instanceof Html) return v.value;
  if (v instanceof Token) return esc(v.value);
  if (Array.isArray(v)) {
    let out = '';
    for (const item of v as readonly Part[]) out += textPart(item, strings);
    return out;
  }
  return fail('a Url or Attrs value cannot be used as element content', strings);
}

function attrPart(v: Part, slot: { name: string; whole: boolean }, strings: readonly string[]): string {
  if (URL_ATTRS.has(slot.name)) {
    if (!(v instanceof Url) || !slot.whole) fail(`"${slot.name}" takes exactly one Url value`, strings);
    return esc(v.href);
  }
  if (slot.name === 'class') {
    if (v === null || v === undefined || v === false) return '';
    if (!(v instanceof Token)) fail('a class name must be a Token from a fixed list', strings);
    return v.value;
  }
  if (v === null || v === undefined || v === false) return '';
  if (typeof v === 'string' || typeof v === 'number') return esc(v);
  if (v instanceof Token) return v.value;
  return fail(`markup, a Url or a list cannot be used inside the "${slot.name}" attribute`, strings);
}

/**
 * Build markup. Plain strings and numbers are escaped; `Html` values are inserted as they are;
 * arrays are concatenated; null, undefined and false produce nothing.
 */
export function html(strings: TemplateStringsArray, ...values: Part[]): Html {
  let slots = analysed.get(strings);
  if (!slots) {
    slots = analyse(strings);
    analysed.set(strings, slots);
  }
  let out = strings[0] as string;
  for (let k = 0; k < values.length; k++) {
    const slot = slots[k] as Slot;
    const v = values[k];
    if (slot.where === 'text') out += textPart(v, strings);
    else if (slot.where === 'attr') out += attrPart(v, slot, strings);
    else if (v instanceof Attrs) out += v.value;
    else if (v !== null && v !== undefined && v !== false) fail('only attrs({...}) may be interpolated inside a tag', strings);
    out += strings[k + 1] as string;
  }
  return new Html(out);
}

/** Concatenate pieces of markup, with an optional separator written by the renderer. */
export function join(parts: readonly Html[], separator: Html = EMPTY): Html {
  return new Html(parts.map((p) => p.value).join(separator.value));
}

export type AttrValue = string | number | boolean | null | undefined | Url | Token;

/**
 * Optional and boolean attributes for the tag position: html`<p${attrs({ lang, hidden: true })}>`.
 * `true` writes the bare attribute; false, null and undefined write nothing. The names must be
 * literals in the renderer's code, never data.
 */
export function attrs(map: Record<string, AttrValue>): Attrs {
  let out = '';
  for (const name of Object.keys(map)) {
    const v = map[name];
    if (v === null || v === undefined || v === false) continue;
    if (!/^[a-z][a-z0-9-]*$/.test(name) || forbiddenAttr(name)) throw new Error(`render/escape: the "${name}" attribute is not allowed`);
    if (v === true) {
      out += ` ${name}`;
      continue;
    }
    let value: string;
    if (URL_ATTRS.has(name)) {
      if (!(v instanceof Url)) throw new Error(`render/escape: "${name}" takes a Url value`);
      value = esc(v.href);
    } else if (name === 'class') {
      if (!(v instanceof Token)) throw new Error('render/escape: a class name must be a Token from a fixed list');
      value = v.value;
    } else if (v instanceof Url) {
      throw new Error(`render/escape: a Url cannot be used in "${name}"`);
    } else {
      value = v instanceof Token ? v.value : esc(v);
    }
    out += ` ${name}="${value}"`;
  }
  return new Attrs(out);
}

/**
 * A class name (or other fixed word) chosen by a value from the lesson. The value only selects
 * among `allowed`; anything else becomes `fallback`, so a lesson can never write a class name.
 */
export function token<T extends string>(value: string, allowed: readonly T[], fallback: T, prefix = ''): Token {
  const chosen = (allowed as readonly string[]).includes(value) ? value : fallback;
  if (!/^[a-z0-9_-]*$/.test(prefix) || !/^[a-z][a-z0-9_-]*$/.test(prefix + chosen)) throw new Error('render/escape: a class token must be a plain lowercase word');
  return new Token(prefix + chosen);
}

// ---------------------------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------------------------

/** Anything the schema would not accept as an id is flattened, so a DOM id is always [A-Za-z0-9_-]. */
function idChars(s: string): string {
  const flat = s.replace(/[^a-z0-9_-]/g, '_').slice(0, 64);
  return /^[a-z]/.test(flat) ? flat : `x${flat}`;
}

/** A scene id inside a DOM id. `-` is doubled so that scene "a-b" and scene "a" with part "b-..." can never produce the same id. */
function sceneKey(sceneId: string): string {
  return idChars(sceneId).replaceAll('-', '--');
}

/**
 * The DOM id of a part the lesson names (a figure node, a line, an edge): `lt-<sceneId>-<partId>`.
 * The player computes the same string with its own `domId`.
 */
export function domId(sceneId: string, partId: string): string {
  return `lt-${sceneKey(sceneId)}-${idChars(partId)}`;
}

/**
 * The DOM id of something the renderer adds to a scene (a popover, a label): `lt-<sceneId>-_<name>`.
 * A lesson's part ids start with a letter, so the underscore keeps the two kinds apart.
 */
export function internalId(sceneId: string, name: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('render/escape: an internal id name is a plain lowercase word');
  return `lt-${sceneKey(sceneId)}-_${name}`;
}

/**
 * The DOM id of a scene's heading, which is also the scene's address in the URL fragment:
 * `scene-<sceneId>`. It has its own prefix so that a scene called "data" or "main" cannot collide
 * with a page-level id.
 */
export function sceneHeadingId(sceneId: string): string {
  return `scene-${sceneKey(sceneId)}`;
}

/**
 * The DOM id of something that exists once per page: `lt-<word>`, or `lt-<word>-_<n>` for the nth
 * of a repeated thing. One word with no dash, so it can never equal a part id (which always has a
 * scene and a part) or a scene's internal id (whose name starts with a letter).
 */
export function pageId(name: string, n?: number): string {
  if (!/^[a-z]+$/.test(name)) throw new Error('render/escape: a page id is one lowercase word');
  if (n === undefined) return `lt-${name}`;
  if (!Number.isInteger(n) || n < 0) throw new Error('render/escape: a page id counter is a whole number');
  return `lt-${name}-_${n}`;
}

/** A link to an element of this page, by an id built with the functions above. */
export function idLink(id: string): Url {
  if (!/^(lt|scene)-[A-Za-z0-9_-]+$/.test(id)) throw new Error('render/escape: idLink takes a renderer-generated id');
  return new Url(`#${id}`);
}

// ---------------------------------------------------------------------------------------------
// The source link: the only URL in the page that comes from the lesson
// ---------------------------------------------------------------------------------------------

/** Text directives treat `-`, `,` and `&` as syntax, so they are percent-encoded along with everything encodeURIComponent leaves alone that a URL parser might touch. */
function directiveText(s: string): string {
  return encodeURIComponent(s).replace(/[-!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

// A browser only matches a directive whose two pieces each begin and end on a word boundary, as its
// own word breaker sees them (measured in Chromium: a piece cut inside a word opens the page at the
// top with nothing marked). So a piece is never cut by counting characters. In order of how far
// every browser can be trusted to agree with what is decided here, at publish time, a piece ends
//   1. at white space: whole words, up to five of them and sixty characters;
//   2. inside a long run with no spaces (Japanese, Chinese, Thai), just before a punctuation mark;
//   3. failing that, at a word boundary of the dictionary `Intl.Segmenter` uses;
//   4. failing that, nowhere: the run is taken whole, however long it is.
// The third depends on the ICU data of the Node that renders the page, which is the one thing here
// that can differ between two machines (and so between a published page and a later render of the
// same lesson). It is reached only by a run of some forty characters or more in such a script that
// has no punctuation within thirty-two characters of the end being anchored.
const DIRECTIVE_WORDS = 5;
const DIRECTIVE_CHARS = 60;
/** Inside a run with no spaces: how far a piece may reach to stop before punctuation, and how far to stop at a dictionary word. */
const RUN_TO_MARK = 32;
const RUN_TO_WORD = 24;
/** A piece lighter than this ("Call", "in a") is found all over a page, so it would mark the wrong place. */
const MIN_WEIGHT = 12;
/** A run heavier than this is cut inside, where it can be, instead of being taken whole. */
const HEAVY_RUN = 120;

/** Scripts written without spaces between words. One of their characters says about as much as three letters. */
const DENSE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

function weight(points: readonly string[]): number {
  let w = 0;
  for (const p of points) w += DENSE.test(p) ? 3 : 1;
  return w;
}

const segmenters = new Map<string, Intl.Segmenter>();

/** The word segments of a run as sizes in code points, or null where there is no segmenter to ask. */
function wordSegments(run: string, lang: string | undefined): { size: number; word: boolean }[] | null {
  try {
    // Never the machine's own locale: the same lesson must give the same link everywhere.
    let locale = 'en';
    try {
      if (lang !== undefined && Intl.Segmenter.supportedLocalesOf([lang]).length > 0) locale = lang;
    } catch {
      // Not a well-formed language tag.
    }
    let segmenter = segmenters.get(locale);
    if (!segmenter) {
      segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
      if (segmenters.size >= 32) segmenters.clear();
      segmenters.set(locale, segmenter);
    }
    const out: { size: number; word: boolean }[] = [];
    for (const s of segmenter.segment(run)) out.push({ size: Array.from(s.segment).length, word: s.isWordLike === true });
    return out;
  } catch {
    return null;
  }
}

/**
 * The part of a long run with no spaces to anchor on, taken from its start or from its end.
 * `have` is the weight of the whole words already taken on that side.
 */
function cutRun(run: string, fromEnd: boolean, lang: string | undefined, have: number): string {
  const segs = wordSegments(run, lang);
  if (!segs) return run;
  const points = Array.from(run);
  if (fromEnd) {
    segs.reverse();
    points.reverse();
  }
  let at = 0;
  let w = have;
  let beforeMark = 0;
  let atWord = 0;
  let firstUsable = 0;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i] as { size: number; word: boolean };
    const beyond = segs[i + 1] as { size: number; word: boolean };
    w += weight(points.slice(at, at + seg.size));
    at += seg.size;
    // A piece stops on a word, never on a mark, and never before it says enough.
    if (!seg.word || w < MIN_WEIGHT) continue;
    if (firstUsable === 0) firstUsable = at;
    if (!beyond.word) {
      if (at <= RUN_TO_MARK) beforeMark = at;
    } else if (at <= RUN_TO_WORD) atWord = at;
  }
  const size = beforeMark || atWord || firstUsable || points.length;
  const piece = points.slice(0, size);
  return (fromEnd ? piece.reverse() : piece).join('');
}

/** The words to anchor on at one end of a passage: whole words, and at least enough of them to be worth looking for. */
function endPiece(words: readonly string[], fromEnd: boolean, lang: string | undefined): string {
  const taken: string[] = [];
  let chars = 0;
  let w = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[fromEnd ? words.length - 1 - i : i] as string;
    const points = Array.from(word);
    const gap = taken.length > 0 ? 1 : 0;
    const light = w < MIN_WEIGHT;
    if (chars + gap + points.length <= DIRECTIVE_CHARS && (taken.length < DIRECTIVE_WORDS || light)) {
      taken.push(word);
      chars += gap + points.length;
      w += gap + weight(points);
      continue;
    }
    // This word does not fit. It is taken all the same when nothing, or too little, came before it.
    if (light) taken.push(weight(points) > HEAVY_RUN ? cutRun(word, fromEnd, lang, w + gap) : word);
    break;
  }
  return (fromEnd ? taken.reverse() : taken).join(' ');
}

/**
 * `text=<first words>,<last words>` for a passage, so the browser scrolls to it and highlights it.
 * Empty when there is nothing to anchor on. `lang` is the language the passage is written in.
 */
export function textDirective(passage: string, lang?: string): string {
  const words = passage.split(/\s+/u).filter(Boolean);
  if (words.length === 0) return '';
  const whole = words.join(' ');
  const total = Array.from(whole).length;
  if (words.length <= DIRECTIVE_WORDS * 2 && total <= DIRECTIVE_CHARS * 2) return `text=${directiveText(whole)}`;
  const first = endPiece(words, false, lang);
  const last = endPiece(words, true, lang);
  // The two pieces must be separate stretches of the passage. Where they would meet, the passage itself is the anchor.
  if (Array.from(first).length + Array.from(last).length >= total) return `text=${directiveText(whole)}`;
  return `text=${directiveText(first)},${directiveText(last)}`;
}

export interface SourceLink {
  /** The address with a text directive, for the `href`. */
  url: Url;
  /** The address without the directive, to show as text. */
  shown: string;
  /** The ASCII host name the address really goes to. */
  host: string;
}

/**
 * The link to a source, rebuilt from scratch: the stored string is parsed again, anything that is
 * not plain http(s) to a named host is refused, and the result is the parser's own serialisation,
 * never the stored characters. Returns null when the address cannot be linked. `language` is the
 * lesson's, used for an excerpt that names none of its own.
 */
export function sourceLink(evidence: { url: string; excerpt: string; lang?: string | undefined }, language?: string): SourceLink | null {
  let u: URL;
  try {
    u = new URL(evidence.url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username !== '' || u.password !== '' || u.hostname === '') return null;
  u.hash = '';
  const shown = u.href;
  const directive = textDirective(evidence.excerpt, typeof evidence.lang === 'string' ? evidence.lang : language);
  return { url: new Url(directive ? `${shown}#:~:${directive}` : shown), shown, host: u.hostname };
}

// ---------------------------------------------------------------------------------------------
// Script and style elements
// ---------------------------------------------------------------------------------------------

/**
 * JSON for a `<script type="application/json">` element. `<`, `>` and `&` are written as \uXXXX so
 * that no sequence inside can end the element or open a comment, and U+2028 and U+2029 so that the
 * text is also valid as JavaScript. JSON.parse reads it back unchanged.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * The text of the one inline script. Inside a string or a regular expression `<\/script` and
 * `<\!--` mean the same as the unescaped forms, and those are the only places a bundler leaves
 * them, so the element cannot be closed or switched into a comment from within.
 */
export function inlineScriptText(js: string): string {
  return js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/** The text of the one inline style element. `\/` in CSS is an escaped `/`. */
export function inlineStyleText(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Whether a string can sit in an inert script element as it is. Base64 has no character that could end the element. */
export function isBase64(s: string): boolean {
  return s.length > 0 && s.length % 4 === 0 && BASE64.test(s);
}
