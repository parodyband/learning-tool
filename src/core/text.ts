// Text handling shared by the validator, the renderer and the player: sanitising what the agent
// sends, counting words, and the comparisons behind quote matching and claim grounding.
//
// Two rules hold for everything in this file:
//   - Environment-neutral. No node: imports and no DOM, because the browser bundle may import it.
//   - Linear time. Every function is a bounded number of passes over its input. The platform's own
//     `normalize()` is quadratic on long runs of combining marks, so no function here hands it one
//     (see MAX_MARK_RUN).
import { plainText } from './markup';

// ---------------------------------------------------------------------------------------------
// Character classes
// ---------------------------------------------------------------------------------------------

const MARK = /\p{M}/u;
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const LETTER = /\p{L}/u;
const DECIMAL_DIGIT = /\p{Nd}/u;
const DASH = /\p{Pd}/u;
/** Scripts written without spaces between words. Marks and the prolonged sound mark are covered through Script_Extensions. */
const UNSPACED = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u;
/** Scripts whose words are too short, or not delimited, for prefix tokens: compared as character bigrams. */
const BIGRAM_SCRIPT = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u;

/**
 * The longest run of combining marks that is kept. Unicode's Stream-Safe Text Format (UAX #15)
 * sets the same bound: no real text needs more, and beyond it `normalize()` reorders marks in
 * quadratic time (100,000 alternating marks take about two seconds).
 */
export const MAX_MARK_RUN = 30;

function isMark(cp: number): boolean {
  if (cp < 0x300) return false;
  // CJK ideographs and Hangul syllables: common, and never marks.
  if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7a3)) return false;
  return MARK.test(String.fromCodePoint(cp));
}

/** Unicode space separators (Zs) and every line break, plus tab. */
function isSpace(cp: number): boolean {
  if (cp <= 0x20) return cp === 0x20 || (cp >= 0x09 && cp <= 0x0d);
  if (cp < 0x1680) return cp === 0xa0 || cp === 0x85;
  return cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x2028 || cp === 0x2029 || cp === 0x202f || cp === 0x205f || cp === 0x3000;
}

/** What `sanitizeText` removes outright. Lone surrogates are included: they are not characters. */
function isRemoved(cp: number): boolean {
  if (cp < 0xa0) return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);
  if (cp < 0x2000) return cp === 0xad;
  if (cp < 0x2070) return cp === 0x200b || cp === 0x2060 || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
  if (cp < 0xd800) return false;
  if (cp <= 0xf8ff) return true; // surrogates met on their own, and the BMP private-use area
  if (cp <= 0xffff) return (cp >= 0xfdd0 && cp <= 0xfdef) || cp === 0xfeff || cp >= 0xfffe;
  if ((cp & 0xfffe) === 0xfffe) return true; // the last two code points of every plane
  if (cp >= 0xe0000 && cp <= 0xe007f) return true; // tag characters
  return cp >= 0xf0000; // planes 15 and 16 are private use
}

// ---------------------------------------------------------------------------------------------
// Sanitising
// ---------------------------------------------------------------------------------------------

export type TextMode = 'prose' | 'code';

/**
 * Make a string safe to store, measure and show.
 *
 * Removed in both modes: C0 and C1 controls, bidirectional embedding, override and isolate
 * controls (U+202A-202E, U+2066-2069), tag characters (U+E0000-E007F), U+200B, U+2060, U+FEFF,
 * U+00AD, private-use and noncharacter code points, lone surrogates, and combining marks beyond
 * the first MAX_MARK_RUN in a row. The result is NFC.
 *
 * `prose`: every space separator, tab and line break becomes a space; runs collapse; ends trimmed.
 * `code`: leading spaces are kept, a tab becomes four spaces, any other space separator or line
 * break becomes one space, and only the end is trimmed.
 *
 * Idempotent: sanitising a sanitised string returns it unchanged.
 */
export function sanitizeText(s: string, mode: TextMode): string {
  const prose = mode === 'prose';
  const n = s.length;
  let out = '';
  let from = 0;
  let lastSpace = prose; // true at the start of prose, so leading spaces are dropped
  let markRun = 0;
  let ascii = true;

  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x20 && c < 0x7f) {
      lastSpace = false;
      markRun = 0;
      continue;
    }
    if (c === 0x20) {
      if (prose && lastSpace) {
        out += s.slice(from, i);
        from = i + 1;
      }
      lastSpace = true;
      markRun = 0;
      continue;
    }
    let cp = c;
    let width = 1;
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
      const low = s.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = (c - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        width = 2;
      }
    }

    if (isSpace(cp)) {
      out += s.slice(from, i);
      from = i + 1;
      if (prose) {
        if (!lastSpace) out += ' ';
      } else {
        out += cp === 0x09 ? '    ' : ' ';
      }
      lastSpace = true;
      markRun = 0;
      continue;
    }

    let drop = isRemoved(cp);
    if (!drop && isMark(cp)) {
      markRun++;
      drop = markRun > MAX_MARK_RUN;
    } else if (!drop) {
      markRun = 0;
    }
    if (drop) {
      out += s.slice(from, i);
      from = i + width;
    } else {
      lastSpace = false;
      ascii = false;
    }
    i += width - 1;
  }
  out += s.slice(from);

  // NFC can turn one mark into two (U+0344), so the bound is applied again to keep this idempotent.
  if (!ascii) out = capMarks(out.normalize('NFC'));
  let end = out.length;
  while (end > 0 && out.charCodeAt(end - 1) === 0x20) end--;
  return end === out.length ? out : out.slice(0, end);
}

/** Containers (objects and arrays) may nest this deep. The deepest real input, a full lesson, uses eight levels. */
export const MAX_INPUT_DEPTH = 12;
/** Values visited before the input is refused. A maximal lesson has a few thousand. */
export const MAX_INPUT_NODES = 200_000;

export type SanitizeErrorCode = 'INPUT_TOO_DEEP' | 'INPUT_CYCLE' | 'INPUT_TOO_LARGE';

/** Thrown by `sanitizeInput` for input that is not a finite tree of reasonable size. The validator turns it into an issue. */
export class SanitizeError extends Error {
  readonly code: SanitizeErrorCode;
  /** Where the problem is, in the same form as `Issue.path`: "steps[1].predict". */
  readonly path: string;
  constructor(code: SanitizeErrorCode, path: string, message: string) {
    super(message);
    this.name = 'SanitizeError';
    this.code = code;
    this.path = path;
  }
}

function pathOf(trail: (string | number)[]): string {
  let out = '';
  for (const key of trail) {
    if (typeof key === 'number') out += `[${key}]`;
    // Keys are echoed sanitised and shortened: an unexpected key is agent text.
    else out += (out ? '.' : '') + sanitizeText(key, 'prose').slice(0, 40);
  }
  return out;
}

/**
 * A deep copy of a tool argument with every string sanitised.
 *
 * - The strings of a list named `lines` (and a `lines` that is itself a string) use code mode: the
 *   lines of code of a figure or of a stage. All others use prose mode, including the strings of
 *   objects inside such a list (the lines of a `words` stage are objects whose `text` is prose).
 * - The `code` of a custom frame (an object whose `kind` is "frame", see core/frame) is kept
 *   exactly as it was sent, line breaks and indentation included. It is a program, checked as
 *   written by src/frame/check.ts, which refuses what must not be in it instead of repairing it.
 *   Both names are read as they will be stored, after tidying: a key sent as "code " or a kind
 *   sent as "frame " (or with a character that is removed) is still a frame's code, and is kept.
 * - Property names are sanitised too, since an unknown key is quoted back in an issue.
 * - A property whose value is `null` or `undefined` is dropped. `null` inside an array is kept,
 *   so positions do not shift and the schema reports it.
 * - Numbers, booleans and anything else that is not a string, array or object pass through.
 *
 * Throws `SanitizeError` when containers nest deeper than MAX_INPUT_DEPTH, when the value
 * contains itself, or when it has more than MAX_INPUT_NODES values.
 *
 * Strings are sanitised as they arrive. If a caller later parses one of them as JSON (the
 * validator's leniency for stringified arguments), the parsed value must be passed through
 * `sanitizeInput` again: JSON escapes such as "\u202e" only become characters at that point.
 */
export function sanitizeInput(value: unknown): unknown {
  const ancestors = new Set<object>();
  const trail: (string | number)[] = [];
  let visited = 0;

  const walk = (v: unknown, mode: TextMode): unknown => {
    if (++visited > MAX_INPUT_NODES) {
      throw new SanitizeError('INPUT_TOO_LARGE', pathOf(trail), `The input has more than ${MAX_INPUT_NODES} values.`);
    }
    if (typeof v === 'string') return sanitizeText(v, mode);
    if (v === null || typeof v !== 'object') return v;
    if (ancestors.has(v)) throw new SanitizeError('INPUT_CYCLE', pathOf(trail), 'The input contains itself.');
    if (ancestors.size >= MAX_INPUT_DEPTH) {
      throw new SanitizeError('INPUT_TOO_DEEP', pathOf(trail), `The input is nested more than ${MAX_INPUT_DEPTH} levels deep.`);
    }
    ancestors.add(v);
    let out: unknown;
    if (Array.isArray(v)) {
      const copy: unknown[] = new Array(v.length);
      for (let k = 0; k < v.length; k++) {
        trail.push(k);
        copy[k] = walk(v[k], mode);
        trail.pop();
      }
      out = copy;
    } else {
      const copy: Record<string, unknown> = {};
      const keys = Object.keys(v);
      const names = keys.map((key) => sanitizeText(key, 'prose'));
      // Whether this object is a frame stage is asked only when it has a `code`, and of the tidied names.
      let frame: boolean | undefined;
      const isFrame = (): boolean =>
        (frame ??= keys.some((key, k) => {
          const kind = (v as Record<string, unknown>)[key];
          return names[k] === 'kind' && typeof kind === 'string' && sanitizeText(kind, 'prose') === 'frame';
        }));
      keys.forEach((key, k) => {
        const child = (v as Record<string, unknown>)[key];
        if (child === null || child === undefined) return;
        trail.push(key);
        const verbatim = names[k] === 'code' && typeof child === 'string' && isFrame();
        // An object starts again in prose mode: code mode is for the strings of a `lines` list itself.
        const cleaned = verbatim ? child : walk(child, key === 'lines' ? 'code' : 'prose');
        trail.pop();
        // defineProperty, not assignment: a key named "__proto__" must stay an ordinary own property.
        Object.defineProperty(copy, names[k] as string, { value: cleaned, enumerable: true, writable: true, configurable: true });
      });
      out = copy;
    }
    ancestors.delete(v);
    return out;
  };

  return walk(value, 'prose');
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

const SEGMENTERS = new Map<string, Intl.Segmenter>();

/**
 * A word segmenter for `lang`. When the runtime has no data for the language, Intl would fall
 * back to the machine's default locale; a fixed "en" is used instead so counts are the same on
 * every machine. Scripts that need a dictionary (Chinese, Japanese, Thai) get one under any locale.
 */
function wordSegmenter(lang: string): Intl.Segmenter {
  let seg = SEGMENTERS.get(lang);
  if (seg) return seg;
  let locale = 'en';
  try {
    if (Intl.Segmenter.supportedLocalesOf([lang]).length > 0) locale = lang;
  } catch {
    // Not a well-formed language tag.
  }
  seg = new Intl.Segmenter(locale, { granularity: 'word' });
  if (SEGMENTERS.size >= 64) SEGMENTERS.clear();
  SEGMENTERS.set(lang, seg);
  return seg;
}

/**
 * Words in `s`, where `s` may carry inline markup: the markup is removed first (`plainText`), so
 * delimiters are never counted and a math span counts as its symbols. A word is a word-like
 * segment of `Intl.Segmenter` for `lang`, which also holds for languages written without spaces.
 */
export function countWords(s: string, lang = 'en'): number {
  const text = plainText(s);
  if (text === '') return 0;
  let count = 0;
  for (const part of wordSegmenter(lang).segment(text)) if (part.isWordLike) count++;
  return count;
}

// ---------------------------------------------------------------------------------------------
// Canonical form
// ---------------------------------------------------------------------------------------------

/**
 * Characters dropped before comparing: those with no visible form (Default_Ignorable_Code_Point
 * and the non-space controls) and those that are not text at all (private-use, noncharacters,
 * lone surrogates). This covers everything `sanitizeText` removes, so a string compares the same
 * before and after it is sanitised.
 */
function isIgnorable(cp: number): boolean {
  if (cp < 0xa0) return (cp < 0x20 && !(cp >= 0x09 && cp <= 0x0d)) || (cp >= 0x7f && cp !== 0x85);
  if (cp < 0x300) return cp === 0xad;
  if (cp < 0x2000) return cp === 0x34f || cp === 0x61c || cp === 0x115f || cp === 0x1160 || cp === 0x17b4 || cp === 0x17b5 || (cp >= 0x180b && cp <= 0x180f);
  if (cp < 0x3000) return (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x206f);
  if (cp < 0xd800) return cp === 0x3164;
  if (cp <= 0xf8ff) return true; // surrogates met on their own, and the BMP private-use area
  if (cp <= 0xffff) return (cp >= 0xfdd0 && cp <= 0xfdef) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0xfeff || cp === 0xffa0 || (cp >= 0xfff0 && cp <= 0xfff8) || cp >= 0xfffe;
  if ((cp & 0xfffe) === 0xfffe || cp >= 0xf0000) return true;
  return (cp >= 0x1bca0 && cp <= 0x1bca3) || (cp >= 0x1d173 && cp <= 0x1d17a) || (cp >= 0xe0000 && cp <= 0xe0fff);
}

const CONTINUES = new Map<number, boolean>();

/**
 * True when `cp` can combine with, or reorder against, the character before it under NFKC, so the
 * two must be normalised together: combining marks, the vowel and trailing consonant jamo that
 * build Hangul syllables, and compatibility characters that turn into one of those (halfwidth
 * voiced sound marks, Thai SARA AM). Everything else starts a new cluster.
 */
function continuesCluster(cp: number): boolean {
  if (cp < 0x300) return false;
  if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7a3)) return false;
  let v = CONTINUES.get(cp);
  if (v === undefined) {
    const first = String.fromCodePoint(cp).normalize('NFKD').codePointAt(0) as number;
    v =
      MARK.test(String.fromCodePoint(first)) ||
      (first >= 0x1160 && first <= 0x11ff) ||
      (first >= 0xd7b0 && first <= 0xd7ff) ||
      // KIRAT RAI VOWEL SIGN E: a letter, not a mark, that composes with the vowel before it.
      first === 0x16d67;
    if (CONTINUES.size >= 8192) CONTINUES.clear();
    CONTINUES.set(cp, v);
  }
  return v;
}

/** Folds that must happen before NFKC, which would otherwise split these into pieces that no longer look like a quote mark. */
const PRE_FOLD = new Map<number, string>([
  [0x00b4, "'"], // acute accent typed as an apostrophe
  [0x1ffd, "'"], // Greek oxia, canonically the same character
  [0x2033, '"'], // double prime
  [0x2036, '"'],
  [0x2034, "'''"],
  [0x2037, "'''"],
  [0x2057, "''''"],
]);

const QUOTE_FOLD = new Map<number, string>([
  // single quotation marks, primes and the letters used as apostrophes
  ...[0x2018, 0x2019, 0x201a, 0x201b, 0x2032, 0x2035, 0x2039, 0x203a, 0x02b9, 0x02bb, 0x02bc, 0x02bd, 0x275b, 0x275c].map((c): [number, string] => [c, "'"]),
  // double quotation marks
  ...[0x201c, 0x201d, 0x201e, 0x201f, 0x00ab, 0x00bb, 0x02ba, 0x301d, 0x301e, 0x301f, 0x275d, 0x275e].map((c): [number, string] => [c, '"']),
  // dash-like characters outside Dash_Punctuation: minus sign, hyphen bullet
  [0x2212, '-'],
  [0x2043, '-'],
  // final sigma, so that folding does not depend on the letters around it
  [0x03c2, 'σ'],
]);

/** CJK unified ideographs and Hangul syllables: unchanged by NFKC and by case folding, and far too common to normalise one at a time. */
function isStableLetter(cp: number): boolean {
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7a3);
}

function foldCluster(raw: string): string {
  let x = raw.normalize('NFKC');
  const lower = x.toLowerCase();
  if (lower !== x) x = lower.normalize('NFKC');
  let out = '';
  let from = 0;
  for (let i = 0; i < x.length; i++) {
    const c = x.charCodeAt(i);
    if (c < 0x80) continue;
    let cp = c;
    let width = 1;
    if (c >= 0xd800 && c <= 0xdbff) {
      cp = x.codePointAt(i) as number;
      width = cp > 0xffff ? 2 : 1;
    }
    let rep = QUOTE_FOLD.get(cp);
    if (rep === undefined && cp >= 0x58a && !isStableLetter(cp) && DASH.test(String.fromCodePoint(cp))) rep = '-';
    if (rep !== undefined) {
      out += x.slice(from, i) + rep;
      from = i + width;
    }
    i += width - 1;
  }
  return from === 0 ? x : out + x.slice(from);
}

/** Per canonical UTF-16 unit: where the original cluster it came from starts and ends, and what kind of character it is. */
interface CanonMap {
  starts: number[];
  ends: number[];
  /** 0 = not part of a word, 1 = letter, mark or other number, 2 = decimal digit. Unspaced scripts are 0: any position between their characters is a word boundary. */
  kind: number[];
}

function wordKind(cp: number): number {
  if (cp < 0x80) {
    if (cp >= 0x30 && cp <= 0x39) return 2;
    return (cp >= 0x61 && cp <= 0x7a) || (cp >= 0x41 && cp <= 0x5a) || cp === 0x5f ? 1 : 0;
  }
  const ch = String.fromCodePoint(cp);
  if (!WORD_CHAR.test(ch) || UNSPACED.test(ch)) return 0;
  return DECIMAL_DIGIT.test(ch) ? 2 : 1;
}

/**
 * The single implementation of the canonical form. The string is cut into clusters that NFKC
 * treats independently (a base character and what combines with it), and each is folded on its
 * own. That makes the form of a substring equal to the substring of the form, which is what lets
 * a match found in canonical text be mapped back to original offsets through `map`.
 */
function canonicalize(s: string, map: CanonMap | null): string {
  const n = s.length;
  let out = '';
  let spaceFrom = -1;
  let spaceTo = -1;

  const space = (start: number, end: number): void => {
    if (spaceFrom === -1) spaceFrom = start;
    spaceTo = end;
  };
  const emit = (text: string, start: number, end: number): void => {
    // Folding can itself produce spaces (U+00A8 becomes a space and a combining diaeresis). They
    // collapse with the white space around them like any other, so that the form does not depend
    // on whether the input was already normalised.
    const gap = text.indexOf(' ');
    if (gap !== -1) {
      if (gap > 0) emit(text.slice(0, gap), start, end);
      space(start, end);
      let rest = gap + 1;
      while (text.charCodeAt(rest) === 0x20) rest++;
      if (rest < text.length) emit(text.slice(rest), start, end);
      return;
    }
    if (spaceFrom !== -1) {
      if (out !== '') {
        out += ' ';
        if (map) {
          map.starts.push(spaceFrom);
          map.ends.push(spaceTo);
          map.kind.push(0);
        }
      }
      spaceFrom = -1;
    }
    out += text;
    if (!map) return;
    for (let k = 0; k < text.length; k++) {
      const c = text.charCodeAt(k);
      const pair = c >= 0xd800 && c <= 0xdbff && k + 1 < text.length;
      const kind = wordKind(pair ? (text.codePointAt(k) as number) : c);
      map.starts.push(start);
      map.ends.push(end);
      map.kind.push(kind);
      if (pair) {
        map.starts.push(start);
        map.ends.push(end);
        map.kind.push(kind);
        k++;
      }
    }
  };

  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) {
        space(i, i + 1);
        i++;
        continue;
      }
      // Any other ASCII character stands alone unless something that could combine with it follows.
      const d = i + 1 < n ? s.charCodeAt(i + 1) : 0x20;
      if (d < 0x300 && !isIgnorable(d)) {
        if (c >= 0x20 && c !== 0x7f) emit(c >= 0x41 && c <= 0x5a ? String.fromCharCode(c + 32) : (s[i] as string), i, i + 1);
        i++;
        continue;
      }
    }
    const cp = s.codePointAt(i) as number;
    const width = cp > 0xffff ? 2 : 1;
    if (isIgnorable(cp)) {
      i += width;
      continue;
    }
    // White space is never the base of a cluster: marks that follow it stand on their own.
    if (isSpace(cp)) {
      space(i, i + width);
      i += width;
      continue;
    }
    let raw = PRE_FOLD.get(cp) ?? s.slice(i, i + width);
    let end = i + width;
    let attached = 0;
    for (;;) {
      let k = end;
      let next = -1;
      while (k < n) {
        next = s.codePointAt(k) as number;
        if (!isIgnorable(next)) break;
        k += next > 0xffff ? 2 : 1;
        next = -1;
      }
      if (next === -1 || !continuesCluster(next)) break;
      const w = next > 0xffff ? 2 : 1;
      // Past the bound, further marks still belong to the cluster but are left out of its form.
      if (attached < MAX_MARK_RUN) raw += s.slice(k, k + w);
      attached++;
      end = k + w;
    }
    if (attached === 0 && isStableLetter(cp)) {
      emit(raw, i, end);
    } else {
      const folded = foldCluster(raw);
      if (folded !== '') emit(folded, i, end);
    }
    i = end;
  }
  return out;
}

/**
 * A form of `s` for comparison only, never for display: NFKC, lower case (`toLowerCase()`, never a
 * locale variant, with final sigma folded), curly quotes and primes as straight quotes, every dash
 * and hyphen as `-`, the ellipsis as `...`, invisible characters dropped, white space collapsed
 * and trimmed. Two strings a reader would call the same quotation have the same canonical form.
 */
export function canonical(s: string): string {
  return canonicalize(s, null);
}

// ---------------------------------------------------------------------------------------------
// Quote matching
// ---------------------------------------------------------------------------------------------

export interface QuoteSpan {
  /** Offsets into the original excerpt, in UTF-16 units; `text === excerpt.slice(start, end)`. */
  start: number;
  end: number;
  text: string;
}

export type QuoteMatch = ({ found: true } & QuoteSpan) | { found: false; closest?: QuoteSpan };

/** The longest `closest` text that is returned. */
export const CLOSEST_MAX_CHARS = 160;
/** `closest` is searched for within this much canonical text; real excerpts and quotes are far shorter. Bounds the one quadratic step. */
const CLOSEST_SCAN = { excerpt: 4000, quote: 400 };

/**
 * A cut at canonical offset `p` is allowed when it does not fall inside one original character
 * (a ligature, say) and does not split a word: not between two word characters, not at an
 * apostrophe inside a word ("don't"), and not at a point or comma inside a number ("3.14", "1,000").
 */
function isCut(text: string, map: CanonMap, p: number): boolean {
  const n = text.length;
  if (p <= 0 || p >= n) return true;
  if (map.starts[p] === map.starts[p - 1]) return false;
  const before = map.kind[p - 1] as number;
  const after = map.kind[p] as number;
  if (before && after) return false;
  if (before && p + 1 < n && joins(text.charCodeAt(p), before, map.kind[p + 1] as number)) return false;
  if (after && p >= 2 && joins(text.charCodeAt(p - 1), map.kind[p - 2] as number, after)) return false;
  return true;
}

function joins(c: number, left: number, right: number): boolean {
  if (c === 0x27) return left !== 0 && right !== 0;
  if (c === 0x2e || c === 0x2c) return left === 2 && right === 2;
  return false;
}

function spanOf(excerpt: string, map: CanonMap, from: number, to: number): QuoteSpan {
  const start = map.starts[from] as number;
  const end = map.ends[to - 1] as number;
  return { start, end, text: excerpt.slice(start, end) };
}

/**
 * Find `quote` in `excerpt`. Matching is done on canonical forms, so curly quotes, dashes, case,
 * ligatures, composed or decomposed accents and line-wrap white space do not matter; the result is
 * always the excerpt's own characters, taken from the original string by offset.
 *
 * A match must start and end on word boundaries (see `isCut`). When there is none, `closest` is
 * the part of the excerpt the quote most likely meant: the excerpt text lined up with the quote
 * around their longest common substring, widened to whole words and at most CLOSEST_MAX_CHARS
 * long. It is absent when the two share almost nothing.
 *
 * Linear in the two lengths (one Knuth-Morris-Pratt scan), plus a bounded search for `closest`.
 */
export function findQuote(excerpt: string, quote: string): QuoteMatch {
  const map: CanonMap = { starts: [], ends: [], kind: [] };
  const text = canonicalize(excerpt, map);
  const pattern = canonical(quote);
  const n = text.length;
  const m = pattern.length;
  if (m === 0 || n === 0) return { found: false };

  let misaligned = -1;
  if (m <= n) {
    const fail = new Int32Array(m);
    for (let i = 1, k = 0; i < m; i++) {
      while (k > 0 && pattern.charCodeAt(i) !== pattern.charCodeAt(k)) k = fail[k - 1] as number;
      if (pattern.charCodeAt(i) === pattern.charCodeAt(k)) k++;
      fail[i] = k;
    }
    for (let i = 0, k = 0; i < n; i++) {
      const c = text.charCodeAt(i);
      while (k > 0 && c !== pattern.charCodeAt(k)) k = fail[k - 1] as number;
      if (c === pattern.charCodeAt(k)) k++;
      if (k < m) continue;
      const from = i + 1 - m;
      if (isCut(text, map, from) && isCut(text, map, i + 1)) return { found: true, ...spanOf(excerpt, map, from, i + 1) };
      if (misaligned === -1) misaligned = from;
      k = fail[k - 1] as number;
    }
  }

  // The quote is there but cuts a word: the words it cuts are the closest span.
  if (misaligned !== -1) {
    const closest = widen(excerpt, text, map, misaligned, misaligned + m, misaligned, true);
    return closest ? { found: false, closest } : { found: false };
  }

  const anchor = longestCommon(text, pattern);
  if (!anchor) return { found: false };
  const from = Math.max(0, anchor.inText - anchor.inPattern);
  const to = Math.min(n, anchor.inText - anchor.inPattern + m);
  const closest = widen(excerpt, text, map, from, to, anchor.inText, false);
  return closest ? { found: false, closest } : { found: false };
}

/** Longest common substring of the two canonical strings, earliest in the excerpt on a tie. Null when it is too short to mean anything. */
function longestCommon(text: string, pattern: string): { inText: number; inPattern: number; length: number } | null {
  const n = Math.min(text.length, CLOSEST_SCAN.excerpt);
  const m = Math.min(pattern.length, CLOSEST_SCAN.quote);
  const codes = new Uint16Array(m);
  for (let j = 0; j < m; j++) codes[j] = pattern.charCodeAt(j);
  let prev = new Uint16Array(m + 1);
  let cur = new Uint16Array(m + 1);
  let best = 0;
  let bestI = 0;
  let bestJ = 0;
  for (let i = 1; i <= n; i++) {
    const c = text.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      if (codes[j - 1] === c) {
        const v = (prev[j - 1] as number) + 1;
        cur[j] = v;
        if (v > best) {
          best = v;
          bestI = i;
          bestJ = j;
        }
      } else {
        cur[j] = 0;
      }
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  // A few shared letters are chance. Ask for more as the quote gets longer, up to a couple of words.
  const needed = Math.min(m, Math.max(4, Math.min(12, Math.ceil(m * 0.15))));
  if (best < needed) return null;
  return { inText: bestI - best, inPattern: bestJ - best, length: best };
}

/**
 * Turn the canonical range [from, to) into a span of whole words of at most CLOSEST_MAX_CHARS
 * original characters, starting no later than `keep` (the start of the shared text) when it can.
 *
 * `outward`: the range is the quote itself, so every word it touches is taken whole. Otherwise the
 * range is an estimate, and each end moves to the nearest place a quote may be cut.
 */
function widen(excerpt: string, text: string, map: CanonMap, from: number, to: number, keep: number, outward: boolean): QuoteSpan | null {
  const n = text.length;
  let a = from;
  let b = to;
  if (!outward) {
    a = nearestCut(text, map, from, -1);
    b = nearestCut(text, map, to, 1);
  }
  // Outward is also the fallback when the nearest cuts leave nothing: the range lies inside one word.
  if (outward || a >= b) {
    a = from;
    b = to;
    while (a > 0 && !isCut(text, map, a)) a--;
    while (b < n && !isCut(text, map, b)) b++;
  }
  while (a < b && text.charCodeAt(a) === 0x20) a++;
  while (b > a && text.charCodeAt(b - 1) === 0x20) b--;
  if (a >= b) return null;

  const tooLong = (x: number, y: number): boolean => (map.ends[y - 1] as number) - (map.starts[x] as number) > CLOSEST_MAX_CHARS;
  if (tooLong(a, b) && keep > a && keep < b && tooLong(a, keep + 1)) {
    // The window is long and the shared text sits far into it: start at the shared text instead.
    a = keep;
    while (a > 0 && !isCut(text, map, a)) a--;
    while (a < b && text.charCodeAt(a) === 0x20) a++;
  }
  // Give up whole words from the end until it fits.
  let end = b;
  while (end > a && tooLong(a, end)) {
    end--;
    while (end > a && (!isCut(text, map, end) || text.charCodeAt(end - 1) === 0x20)) end--;
  }
  if (end > a) return spanOf(excerpt, map, a, end);
  // A single unbroken run longer than the limit: cut it between characters.
  end = b;
  while (end > a + 1 && (tooLong(a, end) || map.starts[end] === map.starts[end - 1])) end--;
  return tooLong(a, end) ? null : spanOf(excerpt, map, a, end);
}

/** The allowed cut nearest to `p`; on a tie the one in direction `prefer` (-1 = earlier, 1 = later). */
function nearestCut(text: string, map: CanonMap, p: number, prefer: -1 | 1): number {
  const n = text.length;
  for (let d = 0; d <= n; d++) {
    const first = p + prefer * d;
    const second = p - prefer * d;
    if (first >= 0 && first <= n && isCut(text, map, first)) return first;
    if (second >= 0 && second <= n && isCut(text, map, second)) return second;
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Tokens for grounding checks
// ---------------------------------------------------------------------------------------------

/** Function words of four letters or more; shorter words never become tokens. Used only when the text is English. */
const STOPWORDS = new Set(
  (
    'about above after again against also although always another around because been before being below between both cannot could ' +
    'does doing down during each either else ever every from further have having here hers herself himself however into itself just ' +
    'like many might more most much must myself neither never once only onto other ours ourselves over rather same shall should since ' +
    'some such than that their theirs them themselves then there therefore these they this those though through thus under until upon ' +
    'very were what when where whether which while whom whose will with within without would your yours yourself yourselves'
  ).split(' '),
);

const TOKEN_MIN_CHARS = 4;
const TOKEN_PREFIX_CHARS = 5;

/**
 * Content tokens of `s`, in order, repeats included.
 *
 * - A token is a run of letters, digits and marks that contains a letter. It is folded with NFKC
 *   and `toLowerCase()`, dropped when shorter than 4 characters or (for English, by `lang`) a
 *   stopword, and cut to its first 5 characters, a crude stem: "comparing" and "comparison" agree.
 * - Text in a script written without spaces, or with very short words (Han, kana, Hangul, Thai,
 *   Lao, Khmer, Myanmar), becomes overlapping two-character tokens instead; a lone character is
 *   its own token.
 *
 * Markup is not interpreted: pass `plainText(...)` for a string that carries inline markup.
 */
export function contentTokens(s: string, lang = 'en'): string[] {
  const english = /^en(g)?(-|$)/i.test(lang);
  const out: string[] = [];
  const n = s.length;
  let wordStart = -1;
  let wordHasLetter = false;
  let prevBigram = '';
  let bigramRun = 0;

  const endWord = (end: number): void => {
    if (wordStart === -1) return;
    const hadLetter = wordHasLetter;
    const raw = s.slice(wordStart, end);
    wordStart = -1;
    wordHasLetter = false;
    if (!hadLetter) return;
    const word = isAscii(raw) ? raw.toLowerCase() : capMarks(raw).normalize('NFKC').toLowerCase();
    const chars = isAscii(word) ? null : Array.from(word);
    if ((chars ? chars.length : word.length) < TOKEN_MIN_CHARS) return;
    if (english && STOPWORDS.has(word)) return;
    out.push(chars ? chars.slice(0, TOKEN_PREFIX_CHARS).join('') : word.slice(0, TOKEN_PREFIX_CHARS));
  };
  const endBigrams = (): void => {
    if (bigramRun === 1) out.push(prevBigram);
    bigramRun = 0;
    prevBigram = '';
  };

  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      const letter = (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a);
      if (letter || (c >= 0x30 && c <= 0x39)) {
        if (bigramRun) endBigrams();
        if (wordStart === -1) wordStart = i;
        if (letter) wordHasLetter = true;
      } else {
        endWord(i);
        if (bigramRun) endBigrams();
      }
      i++;
      continue;
    }
    const cp = s.codePointAt(i) as number;
    const width = cp > 0xffff ? 2 : 1;
    const ch = width === 2 ? s.slice(i, i + 2) : (s[i] as string);
    if (!WORD_CHAR.test(ch)) {
      endWord(i);
      if (bigramRun) endBigrams();
    } else if (BIGRAM_SCRIPT.test(ch)) {
      endWord(i);
      if (bigramRun) out.push(prevBigram + ch);
      prevBigram = ch;
      bigramRun++;
    } else {
      if (bigramRun) endBigrams();
      if (wordStart === -1) wordStart = i;
      if (!wordHasLetter && LETTER.test(ch)) wordHasLetter = true;
    }
    i += width;
  }
  endWord(n);
  if (bigramRun) endBigrams();
  return out;
}

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) >= 0x80) return false;
  return true;
}

/** `s` with every run of combining marks cut to MAX_MARK_RUN, so it is safe to normalise. */
function capMarks(s: string): string {
  if (s.length <= MAX_MARK_RUN) return s;
  let out = '';
  let from = 0;
  let run = 0;
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i) as number;
    const width = cp > 0xffff ? 2 : 1;
    if (isMark(cp)) {
      if (++run > MAX_MARK_RUN) {
        out += s.slice(from, i);
        from = i + width;
      }
    } else {
      run = 0;
    }
    i += width - 1;
  }
  return from === 0 ? s : out + s.slice(from);
}

const DIGIT_VALUES = new Map<number, number>();

/** The value of a Unicode decimal digit (General_Category Nd), or -1. */
function digitValue(cp: number): number {
  if (cp >= 0x30 && cp <= 0x39) return cp - 0x30;
  if (cp < 0x660) return -1;
  let v = DIGIT_VALUES.get(cp);
  if (v === undefined) {
    v = -1;
    if (DECIMAL_DIGIT.test(String.fromCodePoint(cp))) {
      // Decimal digits are encoded as contiguous runs of ten, zero first, so the value is the
      // distance from the start of the run, modulo ten.
      let start = cp;
      while (start > 0 && cp - start < 60 && DECIMAL_DIGIT.test(String.fromCodePoint(start - 1))) start--;
      v = (cp - start) % 10;
    }
    if (DIGIT_VALUES.size >= 2048) DIGIT_VALUES.clear();
    DIGIT_VALUES.set(cp, v);
  }
  return v;
}

/** Kinds of character that can sit between two digits of one number. */
const SEP_NONE = 0;
const SEP_DOT = 1;
const SEP_COMMA = 2;
const SEP_SPACE = 3;
const SEP_APOSTROPHE = 4;
const SEP_ARABIC_THOUSANDS = 5;
const SEP_ARABIC_DECIMAL = 6;

function separatorKind(c: number): number {
  switch (c) {
    case 0x2e: case 0xff0e:
      return SEP_DOT;
    case 0x2c: case 0xff0c:
      return SEP_COMMA;
    case 0x20: case 0xa0: case 0x2007: case 0x2008: case 0x2009: case 0x202f:
      return SEP_SPACE;
    case 0x27: case 0x2019: case 0x02bc:
      return SEP_APOSTROPHE;
    case 0x066c:
      return SEP_ARABIC_THOUSANDS;
    case 0x066b:
      return SEP_ARABIC_DECIMAL;
    default:
      return SEP_NONE;
  }
}

/** A number found in a text, with where it stands, so that what surrounds it can be read. */
interface NumberSpan {
  /** ASCII digits with at most one ".". */
  token: string;
  start: number;
  end: number;
}

/**
 * `s` without what cannot be seen inside a number: every character with no visible form (a
 * zero-width joiner, a left-to-right mark, an invisible operator, a variation selector) and every
 * combining mark placed on a digit or on a separator between digits. "1946" written with a joiner
 * between each pair of digits looks like 1946 to a learner, so it is read as 1946.
 *
 * This is for reading numbers only. The text itself keeps these characters: Persian, Indic scripts
 * and emoji need the joiners.
 */
function withoutNumberNoise(s: string): string {
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c > 0x7e || (c < 0x20 && !(c >= 0x09 && c <= 0x0d))) break;
    i++;
  }
  if (i === n) return s;

  let out = '';
  let from = 0;
  // The last character kept is a digit, or something that can stand between two digits.
  let numeric = false;
  for (i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    let cp = c;
    let width = 1;
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
      const low = s.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = (c - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        width = 2;
      }
    }
    if (isIgnorable(cp) || (numeric && isMark(cp))) {
      out += s.slice(from, i);
      from = i + width;
    } else {
      numeric = digitValue(cp) !== -1 || separatorKind(cp) !== SEP_NONE;
    }
    i += width - 1;
  }
  return from === 0 ? s : out + s.slice(from);
}

/**
 * The numbers written in `s`, in order, each as ASCII digits with at most one `.`, with offsets.
 *
 * The exact rule, applied left to right at every digit that does not follow another digit:
 *
 * 1. Digits. Any Unicode decimal digit (Arabic-Indic, Devanagari, fullwidth, ...) counts and is
 *    mapped to 0-9. Read the longest run of digits: the first group.
 * 2. Grouping. If the first group has 1 to 3 digits and does not start with 0, and is followed by
 *    a separator and then exactly three digits (not four), that separator is a thousands
 *    separator: it is removed, and so is every further occurrence of the same separator followed
 *    by exactly three digits. Separators: `,` and `.` (also in fullwidth form), a space (also
 *    no-break, thin, narrow and figure spaces), `'`, and the Arabic thousands separator. So
 *    "1,000,000", "1 000 000", "1.000.000" and "1'000'000" all give "1000000". One exception: a
 *    space is not a thousands separator when the digits it would join are then grouped by a dot
 *    or comma, so "13 200,000" gives "13" and "200000".
 * 3. Decimals. If what follows is a decimal mark and at least one digit, they are kept as "." and
 *    the digits. The decimal mark is `.` or `,` (or the Arabic decimal separator), and must differ
 *    from the separator used for grouping. So "3.13" gives "3.13", "12,5" gives "12.5" and
 *    "1.234,56" gives "1234.56".
 * 4. Everything else ends the number: letters, other punctuation, a sign, an exponent. "9/11"
 *    gives "9" and "11"; "COVID-19" gives "19"; "ES2015" gives "2015"; "3.13.2" gives "3.13", "2".
 *
 * A sign is not part of a token ("-5" gives "5"). Leading and trailing zeros are kept as written:
 * "007" and "2.50" stay as they are. Superscript and subscript digits are not decimal digits
 * ("10⁶" gives "10", "CO₂" gives nothing): they are visibly not part of the number beside them.
 *
 * Known limits: after a first group of one to three digits, a dot or comma followed by exactly
 * three digits is read as grouping, so "3.142" and "3,142" both give "3142"; and two separate
 * numbers written with only a space between them, the second of exactly three digits ("Area 51
 * 300 km away"), read as one.
 */
function scanNumbers(s: string): NumberSpan[] {
  const out: NumberSpan[] = [];
  const n = s.length;

  // The digit at offset k as { value, width }, packed as value * 4 + width, or -1.
  const digitAt = (k: number): number => {
    if (k >= n) return -1;
    const c = s.charCodeAt(k);
    if (c >= 0x30 && c <= 0x39) return (c - 0x30) * 4 + 1;
    if (c < 0x660) return -1;
    const cp = c >= 0xd800 && c <= 0xdbff ? (s.codePointAt(k) as number) : c;
    const v = digitValue(cp);
    return v === -1 ? -1 : v * 4 + (cp > 0xffff ? 2 : 1);
  };
  // Offset just past exactly three digits starting at k, or -1 when there are fewer or more.
  const threeDigits = (k: number): { end: number; digits: string } | null => {
    let digits = '';
    for (let t = 0; t < 3; t++) {
      const d = digitAt(k);
      if (d === -1) return null;
      digits += d >> 2;
      k += d & 3;
    }
    return digitAt(k) === -1 ? { end: k, digits } : null;
  };

  let i = 0;
  while (i < n) {
    let d = digitAt(i);
    if (d === -1) {
      i++;
      continue;
    }
    const start = i;
    let token = '';
    let groupLength = 0;
    while (d !== -1) {
      token += d >> 2;
      groupLength++;
      i += d & 3;
      d = digitAt(i);
    }

    let grouping = SEP_NONE;
    if (groupLength <= 3 && token.charCodeAt(0) !== 0x30) {
      const kind = i < n ? separatorKind(s.charCodeAt(i)) : SEP_NONE;
      if (kind !== SEP_NONE && kind !== SEP_ARABIC_DECIMAL) {
        const first = token;
        const afterFirst = i;
        let group = threeDigits(i + 1);
        while (group) {
          grouping = kind;
          token += group.digits;
          i = group.end;
          group = i < n && separatorKind(s.charCodeAt(i)) === kind ? threeDigits(i + 1) : null;
        }
        // "13 200,000" is two numbers: a space cannot group digits that another separator goes on to group.
        if (grouping === SEP_SPACE && i < n) {
          const then = separatorKind(s.charCodeAt(i));
          if ((then === SEP_DOT || then === SEP_COMMA) && threeDigits(i + 1)) {
            grouping = SEP_NONE;
            token = first;
            i = afterFirst;
          }
        }
      }
    }

    const mark = i < n ? separatorKind(s.charCodeAt(i)) : SEP_NONE;
    if ((mark === SEP_DOT || mark === SEP_COMMA || mark === SEP_ARABIC_DECIMAL) && mark !== grouping) {
      let k = i + 1;
      let fraction = '';
      for (let f = digitAt(k); f !== -1; f = digitAt(k)) {
        fraction += f >> 2;
        k += f & 3;
      }
      if (fraction !== '') {
        token += `.${fraction}`;
        i = k;
      }
    }
    out.push({ token, start, end: i });
  }
  return out;
}

// ----- what stands around a number -----

const isInteger = (token: string): boolean => !token.includes('.');
/** A year as a lesson writes one: four digits, from 1000 to 2999. */
const isYear = (token: string): boolean => token.length === 4 && (token.charCodeAt(0) === 0x31 || token.charCodeAt(0) === 0x32) && isInteger(token);

function letterAt(s: string, k: number): boolean {
  if (k < 0 || k >= s.length) return false;
  const c = s.charCodeAt(k);
  if (c < 0x80) return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
  return LETTER.test(String.fromCodePoint(s.codePointAt(k) as number));
}

/** True when the word `word` (lower case) stands at offset `k`, in any letter case, and ends there. */
function wordAt(s: string, k: number, word: string): boolean {
  return s.length >= k + word.length && s.slice(k, k + word.length).toLowerCase() === word && !letterAt(s, k + word.length);
}

function skipSpaces(s: string, k: number, max: number): number {
  for (let t = 0; t < max && k < s.length; t++) {
    const c = s.charCodeAt(k);
    if (c !== 0x20 && c !== 0xa0 && c !== 0x202f) break;
    k++;
  }
  return k;
}

function isDashCode(c: number): boolean {
  return c === 0x2d || (c >= 0x2010 && c <= 0x2015) || c === 0x2212;
}

/** `digits` moved `places` to the left of the decimal point: ("124.35", 6) gives "124350000", ("1.2345", 3) gives "1234.5". Done on the string, so no digit is ever rounded. */
function shiftDecimal(token: string, places: number): string {
  const dot = token.indexOf('.');
  let whole = dot === -1 ? token : token.slice(0, dot);
  let fraction = dot === -1 ? '' : token.slice(dot + 1);
  if (fraction.length <= places) {
    whole += fraction + '0'.repeat(places - fraction.length);
    fraction = '';
  } else {
    whole += fraction.slice(0, places);
    fraction = fraction.slice(places);
    let end = fraction.length;
    while (end > 0 && fraction.charCodeAt(end - 1) === 0x30) end--;
    fraction = fraction.slice(0, end);
  }
  let lead = 0;
  while (lead < whole.length - 1 && whole.charCodeAt(lead) === 0x30) lead++;
  whole = whole.slice(lead);
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

/** The sum of two whole numbers given as digit strings. */
function addDigits(a: string, b: string): string {
  let out = '';
  let carry = 0;
  for (let i = a.length - 1, j = b.length - 1; i >= 0 || j >= 0 || carry > 0; i--, j--) {
    const sum = (i >= 0 ? a.charCodeAt(i) - 0x30 : 0) + (j >= 0 ? b.charCodeAt(j) - 0x30 : 0) + carry;
    out = (sum % 10) + out;
    carry = sum >= 10 ? 1 : 0;
  }
  return out === '' ? '0' : out;
}

/** The units that Chinese, Japanese and Korean count large numbers in, as powers of ten. */
const MYRIADS: ReadonlyMap<string, number> = new Map([['万', 4], ['萬', 4], ['億', 8], ['亿', 8], ['兆', 12], ['만', 4], ['억', 8], ['조', 12]]);
/** The units inside one group of four digits: 5千 is 5000. */
const SUB_UNITS: ReadonlyMap<string, number> = new Map([['千', 3], ['百', 2], ['천', 3], ['백', 2]]);
const KANA = /[぀-ヿ]/;
const SINGLE_DIGIT = /^[1-9]$/;

/**
 * A number written in East Asian units, starting at `nums[k]`: 1億2435万 is 124350000, 72万7277 is
 * 727277, 59万5千 is 595000, 1.2億 is 120000000. Returns the value and the index after the last
 * part used, or null when what stands there is not such a number.
 *
 * Deliberately narrow:
 * - A unit of ten thousand or more has to be present. A bare "595千" or "3百" is left as it is.
 * - 千 and 百 multiply a single digit only (2千5百), as they do in ordinary writing. "124.35百万",
 *   the form of financial tables, is left as the digits 124.35, which is how its source prints it.
 * - A number made of single digits only (3万, 1億2千万) is left alone too: single digits need no
 *   source, and that does not change because a unit follows.
 * - 兆 counts only in a text with kana. In mainland Chinese it is also "mega" (300兆瓦 is 300 MW).
 */
function eastAsianNumber(s: string, nums: readonly NumberSpan[], k: number, kana: () => boolean): { token: string; next: number } | null {
  let total = '0';
  let groups = 0;
  let lastPower = Number.POSITIVE_INFINITY;
  let wide = false;
  let i = k;
  // Where the next group has to begin: just after the previous group's unit.
  let at = -1;
  let spaced = false;

  while (i < nums.length) {
    const num = nums[i] as NumberSpan;
    if (groups > 0) {
      // Korean writes a space between groups ("1억 2435만"); Chinese and Japanese write none.
      spaced = num.start === at + 1 && s.charCodeAt(at) === 0x20 && s.charCodeAt(at - 1) >= 0xac00;
      if (num.start !== at && !spaced) break;
    }

    let value: string;
    let used = 1;
    let p = num.end;
    let multi = num.token.length > 1;
    const sub = SUB_UNITS.get(s[p] as string);
    if (sub !== undefined) {
      if (!SINGLE_DIGIT.test(num.token)) break;
      value = num.token + '0'.repeat(sub);
      let lastSub = sub;
      p++;
      for (;;) {
        const more = nums[i + used];
        if (!more || more.start !== p || !SINGLE_DIGIT.test(more.token)) break;
        const next = SUB_UNITS.get(s[more.end] as string);
        if (next === undefined || next >= lastSub) break;
        value = addDigits(value, more.token + '0'.repeat(next));
        lastSub = next;
        p = more.end + 1;
        used++;
      }
    } else if (!isInteger(num.token)) {
      // A decimal with one unit, and nothing after it: 1.2億.
      const power = MYRIADS.get(s[p] as string);
      if (groups > 0 || power === undefined || (s[p] === '兆' && !kana())) break;
      return { token: shiftDecimal(num.token, power), next: i + 1 };
    } else {
      if (groups > 0 && num.token.length > 4) break;
      value = num.token;
      multi = num.token.length > 1;
    }

    const unit = s[p] as string | undefined;
    const power = unit === undefined ? undefined : MYRIADS.get(unit);
    if (power !== undefined && power < lastPower && !(unit === '兆' && !kana())) {
      total = addDigits(total, shiftDecimal(value, power));
      lastPower = power;
      at = p + 1;
      groups++;
      i += used;
      wide ||= multi;
      continue;
    }
    // The last part has no unit: the 7277 of 72万7277. After a space it must not be a year ("3만 2023년").
    if (groups > 0 && power === undefined && value.length <= 4 && !(spaced && s[p] === '년')) {
      total = addDigits(total, value);
      i += used;
      wide ||= multi;
    }
    break;
  }
  return groups > 0 && wide ? { token: total, next: i } : null;
}

const CENTURY_WORDS = ['centur', 'jahrhundert', 'jh.', 'jhd', 'siècle', 'siecle', 'eeuw', 'secolo', 'siglo', 'século', 'seculo'];
const CENTURY_WORDS_BEFORE = ['siglo', 'siglos', 'século', 'séculos', 'seculo', 'seculos', 'secolo', 'secoli'];
const CENTURY_CJK = ['世紀', '世纪', '세기'];
const ORDINAL_ENDINGS = ['st', 'nd', 'rd', 'th', 'e', 'er', 'ème', 'eme', 'ième', 'de', 'ste'];
const ORDINAL_JOINERS = ['and', 'or', 'to', 'through', 'und', 'bis', 'oder', 'et', 'ou', 'au', 'en', 'tot', 'y', 'e'];

/**
 * True when the one or two digits that end at `p` name a century: "17th century", "17th-century",
 * "the 16th and 17th centuries", "im 17. Jahrhundert", "16./17. Jahrhundert", "17e siècle",
 * "17世紀". A century is a way of naming a period, not a quantity anyone measured, and spelt out
 * ("seventeenth") it was never a number at all. A count stays a number: "20 centuries".
 */
function namesCentury(s: string, p: number, depth: number): boolean {
  for (const word of CENTURY_CJK) if (s.startsWith(word, p)) return true;
  let q = p;
  const c = s.charCodeAt(q);
  if (c === 0x2e || c === 0xba || c === 0xb0 || c === 0xaa) q++;
  else {
    const ending = ORDINAL_ENDINGS.find((e) => wordAt(s, p, e));
    if (ending === undefined) return false;
    q += ending.length;
  }
  // "17th century", "17th-century", "17. Jahrhundert"
  let r = q;
  for (let t = 0; t < 2 && r < s.length; t++) {
    const d = s.charCodeAt(r);
    if (d !== 0x20 && d !== 0xa0 && !isDashCode(d)) break;
    r++;
  }
  const rest = s.slice(r, r + 12).toLowerCase();
  if (CENTURY_WORDS.some((word) => rest.startsWith(word))) return true;
  if (depth >= 3) return false;
  // "16th and 17th centuries", "16th–17th centuries", "16./17. Jahrhundert": another ordinal follows.
  let t = skipSpaces(s, q, 1);
  const joiner = ORDINAL_JOINERS.find((w) => wordAt(s, t, w));
  if (joiner !== undefined) t += joiner.length;
  else if (t < s.length && (isDashCode(s.charCodeAt(t)) || s[t] === '/' || s[t] === ',' || s[t] === '&')) t++;
  else return false;
  t = skipSpaces(s, t, 1);
  let digits = 0;
  while (digits < 3 && t + digits < s.length && s.charCodeAt(t + digits) >= 0x30 && s.charCodeAt(t + digits) <= 0x39) digits++;
  return digits >= 1 && digits <= 2 && namesCentury(s, t + digits, depth + 1);
}

/** "siglo 17", "século 20": the languages that put the word first. */
function centuryNamedBefore(s: string, start: number): boolean {
  const before = s.slice(Math.max(0, start - 9), start).toLowerCase();
  if (!before.endsWith(' ') && !before.endsWith(' ')) return false;
  const words = before.slice(0, -1);
  return CENTURY_WORDS_BEFORE.some((w) => words.endsWith(w) && !letterAt(s, start - 2 - w.length));
}

/** True when the year that ends at `p` names its decade or century: "the 1660s", "the 1960's", "1660er Jahre", "1960年代". "1000s of people" is a quantity. */
function namesDecade(s: string, p: number): boolean {
  if (s.startsWith('年代', p) || s.startsWith('년대', p)) return true;
  if (wordAt(s, p, 'er')) return true;
  let q = p;
  if (s[q] === "'" || s[q] === '’') q++;
  if (!wordAt(s, q, 's')) return false;
  return !wordAt(s, skipSpaces(s, q + 1, 1), 'of');
}

/**
 * The numbers that `s` states, in order, each as ASCII digits with at most one `.`. This is the
 * reading for text that has to be grounded: a claim, a caption, a label. `sourceNumberTokens` is
 * the reading for the passage it is grounded in.
 *
 * Numbers are found as `scanNumbers` describes ("1,000,000" gives "1000000", "3.13" stays "3.13",
 * "9/11" gives "9" and "11"), after characters that cannot be seen are removed from between their
 * digits. Then the ways of writing a number that differ between languages are brought to one form:
 *
 * - East Asian units give the value: 1億2435万 is "124350000", 72万7277 is "727277" (see
 *   `eastAsianNumber` for what is left alone).
 * - A month written as a numeral before 月 or 월 gives nothing, like a month written as a word.
 * - A century named by an ordinal gives nothing: "17th-century", "im 17. Jahrhundert", "17世紀".
 * - A decade gives its year followed by "s": "the 1660s" is "1660s", which a source grounds with any
 *   year of that decade, and not with a claim about the year 1660.
 * - The second year of a range is completed: "1939–45" gives "1939" and "1945".
 */
export function numberTokens(s: string): string[] {
  const text = withoutNumberNoise(s);
  return statedNumbers(text, scanNumbers(text));
}

function statedNumbers(s: string, nums: readonly NumberSpan[]): string[] {
  const out: string[] = [];
  // Looked for once, however many numbers ask.
  let hasKana: boolean | undefined;
  const kana = (): boolean => (hasKana ??= KANA.test(s));
  for (let k = 0; k < nums.length; k++) {
    const num = nums[k] as NumberSpan;
    const token = num.token;
    const after = num.end < s.length ? s.charCodeAt(num.end) : 0;

    // Every East Asian unit, 月 and 월 are above this; nothing an ASCII text contains is.
    if (after >= 0x4e00) {
      const value = eastAsianNumber(s, nums, k, kana);
      if (value) {
        out.push(value.token);
        k = value.next - 1;
        continue;
      }
      if ((after === 0x6708 || after === 0xc6d4) && token.length <= 2 && isInteger(token) && Number(token) >= 1 && Number(token) <= 12) continue;
    }
    if (token.length <= 2 && isInteger(token) && (namesCentury(s, num.end, 0) || centuryNamedBefore(s, num.start))) continue;
    if (isYear(token) && token.endsWith('0') && namesDecade(s, num.end)) {
      out.push(`${token}s`);
      continue;
    }
    if (token.length === 2 && isInteger(token) && k > 0) {
      const first = nums[k - 1] as NumberSpan;
      const next = s.charCodeAt(num.end);
      const nextIsDigit = s.charCodeAt(num.end + 1) >= 0x30 && s.charCodeAt(num.end + 1) <= 0x39;
      // "2024-05-01" is a date, not a range of years.
      const goesOn = (isDashCode(next) || next === 0x2e || next === 0x2f) && nextIsDigit;
      if (isYear(first.token) && first.end + 1 === num.start && isDashCode(s.charCodeAt(first.end)) && !goesOn) {
        const century = Number(first.token.slice(0, 2));
        const sameCentury = `${century}${token}`;
        out.push(sameCentury > first.token ? sameCentury : `${century + 1}${token}`);
        continue;
      }
    }
    out.push(token);
  }
  return out;
}

/** Words that multiply the number before them, as powers of ten. English "billion" is 10^9; the long-scale words of other languages are left out because they mean something else there. */
const SCALE_WORDS: ReadonlyMap<string, number> = new Map([
  ['thousand', 3], ['million', 6], ['millions', 6], ['billion', 9], ['trillion', 12], ['bn', 9], ['mn', 6], ['tn', 12], ['lakh', 5], ['lakhs', 5], ['crore', 7], ['crores', 7],
  ['tausend', 3], ['mio', 6], ['millionen', 6], ['mrd', 9], ['milliarde', 9], ['milliarden', 9], ['milliard', 9], ['milliards', 9],
  ['mil', 3], ['millón', 6], ['millones', 6], ['milhão', 6], ['milhões', 6], ['mila', 3], ['milione', 6], ['milioni', 6], ['miliardo', 9], ['miliardi', 9],
]);
const TIME_MARKS = ['am', 'pm', 'a.m.', 'p.m.', 'a.m', 'p.m', 'uhr'];

/**
 * Every number that the passage `s` gives a statement to rest on: all of `numberTokens(s)`, the
 * numbers as plainly written, and the other forms the same passage entails. Use it for an excerpt
 * (and for a topic or title, whose numbers a lesson may repeat); use `numberTokens` for the text
 * that is checked against it. The extra forms, each entailed by digits that are in the passage:
 *
 * - A number before a scale word, at its value: "124.35 million" also gives "124350000", "595
 *   thousand" also "595000". So a lesson in Japanese may write 1億2435万人, which states that value.
 * - The parts of a date, version or address written with two or more dots: "16.10.2023" also
 *   gives "16", "10" and "2023". A number with one dot is a decimal and keeps its digits to
 *   itself ("29.1" does not give "29"), and so does a grouped number ("1.234.567").
 * - The hour and minute of a time written with a dot: "10.30pm" and "14.30 Uhr" also give both.
 * - For a year, its decade and its century in the form `numberTokens` gives them: "1666" also
 *   gives "1660s" and "1600s".
 * - Both readings of what `numberTokens` rewrites: "1939–45" gives "45" and "1945"; "17th century"
 *   keeps its "17"; 72万7277 gives "727277" as well as "72" and "7277".
 */
export function sourceNumberTokens(s: string): string[] {
  const text = withoutNumberNoise(s);
  const nums = scanNumbers(text);
  const out = new Set<string>();
  for (const num of nums) out.add(num.token);
  for (const token of statedNumbers(text, nums)) out.add(token);

  for (const num of nums) {
    const token = num.token;
    if (isYear(token)) {
      out.add(`${token.slice(0, 3)}0s`);
      out.add(`${token.slice(0, 2)}00s`);
    }

    let p = num.end;
    const gap = p < text.length ? text.charCodeAt(p) : 0;
    if (gap === 0x20 || gap === 0xa0 || gap === 0x202f || gap === 0x2d) p++;
    if (!letterAt(text, p)) continue;
    let q = p;
    while (q < text.length && q - p < 12 && letterAt(text, q)) q++;
    if (letterAt(text, q)) continue;
    const word = text.slice(p, q).toLowerCase();
    const power = SCALE_WORDS.get(word);
    if (power !== undefined) out.add(shiftDecimal(token, power));
    // "10.30pm", "14.30 Uhr": a dot between hour and minute, as the text has it, not a decimal comma.
    if (/^[0-9]{1,2}\.[0-9]{2}$/.test(token) && text[num.end - 3] === '.' && TIME_MARKS.some((mark) => wordAt(text, p, mark))) {
      out.add(token.slice(0, token.indexOf('.')));
      out.add(token.slice(-2));
    }
  }

  // Runs of digits joined by two or more dots. Only ASCII digits: this is how dates and versions are printed.
  const n = text.length;
  const digit = (k: number): boolean => k < n && text.charCodeAt(k) >= 0x30 && text.charCodeAt(k) <= 0x39;
  for (let i = 0; i < n; i++) {
    if (!digit(i)) continue;
    const groups: string[] = [];
    let k = i;
    for (;;) {
      const from = k;
      while (digit(k)) k++;
      groups.push(text.slice(from, k));
      if (text[k] !== '.' || !digit(k + 1)) break;
      k++;
    }
    const first = groups[0] as string;
    const grouped = first.length <= 3 && first[0] !== '0' && groups.slice(1).every((g) => g.length === 3);
    if (groups.length >= 3 && !grouped) for (const g of groups) out.add(g);
    i = k;
  }
  return [...out];
}

// ---------------------------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------------------------

function isSchemeChar(c: number): boolean {
  return (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e;
}

/** Punctuation that ends a sentence or closes a bracket or quotation around a URL, and markup delimiters. */
const URL_TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '"', "'", '`', '*', '’', '”', '»']);
const URL_LEADING = new Set(['(', '[', '{', '<', '"', "'", '`', '*', '‘', '“', '«']);

function trimUrl(raw: string): string {
  let open = 0;
  let close = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 0x28) open++;
    else if (c === 0x29) close++;
  }
  let end = raw.length;
  while (end > 0 && URL_TRAILING.has(raw[end - 1] as string)) {
    if (raw.charCodeAt(end - 1) === 0x29) {
      // A closing parenthesis that has its partner inside the URL is part of it.
      if (close <= open) break;
      close--;
    }
    end--;
  }
  return raw.slice(0, end);
}

function isHostChar(c: number): boolean {
  return c >= 0x80 || (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x2e || c === 0x5f;
}

/** The host of what follows "scheme://", or of a bare "www." address: lower case, without credentials or port, in ASCII form when the runtime can convert it. */
function hostOf(rest: string): string {
  let end = rest.length;
  for (let i = 0; i < rest.length; i++) {
    const c = rest.charCodeAt(i);
    if (c === 0x2f || c === 0x3f || c === 0x23 || c === 0x5c) {
      end = i;
      break;
    }
  }
  let authority = rest.slice(0, end);
  const at = authority.lastIndexOf('@');
  if (at !== -1) authority = authority.slice(at + 1);
  let host: string;
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    host = close === -1 ? authority : authority.slice(0, close + 1);
  } else {
    // A host name ends at the first character that cannot be part of one: a port colon, or
    // punctuation that followed the URL in the text ("example.org's", "example.org,").
    let stop = 0;
    while (stop < authority.length && isHostChar(authority.charCodeAt(stop))) stop++;
    host = authority.slice(0, stop);
  }
  let hostEnd = host.length;
  while (hostEnd > 0 && host.charCodeAt(hostEnd - 1) === 0x2e) hostEnd--;
  host = host.slice(0, hostEnd).toLowerCase();
  if (!isAscii(host) && host.length <= 255) {
    try {
      // The same conversion the evidence check applies, so hosts compare equal.
      host = new URL(`http://${host}`).hostname;
    } catch {
      // Not a host the URL parser accepts; the lowercased text is reported as it is.
    }
  }
  return host;
}

/**
 * Every URL-like token in `s`: anything containing "://", and anything starting with "www.".
 * `raw` is the token without surrounding punctuation; `host` is its lowercased host name.
 * Addresses without a scheme or "www." ("example.com/page") are deliberately not matched.
 */
export function findUrls(s: string): { raw: string; host: string }[] {
  const out: { raw: string; host: string }[] = [];
  const n = s.length;
  let i = 0;
  while (i < n) {
    while (i < n && isSpace(s.charCodeAt(i))) i++;
    const start = i;
    while (i < n && !isSpace(s.charCodeAt(i))) i++;
    if (i > start) urlsInToken(s.slice(start, i), out);
  }
  return out;
}

function urlsInToken(token: string, out: { raw: string; host: string }[]): void {
  let from = 0;
  let found = false;
  for (;;) {
    const sep = token.indexOf('://', from);
    if (sep === -1) break;
    let begin = sep;
    while (begin > from && isSchemeChar(token.charCodeAt(begin - 1))) begin--;
    // The URL runs to the start of the next one in the same token, if there is another.
    const nextSep = token.indexOf('://', sep + 3);
    let end = token.length;
    if (nextSep !== -1) {
      end = nextSep;
      while (end > sep + 3 && isSchemeChar(token.charCodeAt(end - 1))) end--;
    }
    const raw = trimUrl(token.slice(begin, end));
    out.push({ raw, host: hostOf(raw.slice(sep - begin + 3)) });
    found = true;
    if (nextSep === -1) break;
    from = end;
  }
  if (found) return;
  let lead = 0;
  while (lead < token.length && URL_LEADING.has(token[lead] as string)) lead++;
  if (token.length - lead > 4 && token.slice(lead, lead + 4).toLowerCase() === 'www.') {
    const raw = trimUrl(token.slice(lead));
    if (raw.length > 4) out.push({ raw, host: hostOf(raw) });
  }
}
