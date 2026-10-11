// What is actually sent to ElevenLabs for one narration segment. The segment text arrives as plain
// text (markup already removed by core/narration); this pass makes sure lesson text can never act as
// markup for the speech model.

/** Part of every cache key. Bump it when `prepareText` changes what it returns. */
export const PREPROCESSOR_VERSION = 1;

/** The smallest per-request character limit of any documented model (eleven_v3). A segment never comes close. */
export const MAX_REQUEST_CHARS = 5000;

const BRACKETS = /[[\]<>]/;

// Square brackets are audio tags on the v3 and v4 models ("[laughs]") and angle brackets are SSML on
// the v2 models (`<break time="3s"/>`). Fullwidth and small-form variants fold to the ASCII ones
// under NFKC, which a text normaliser on the other side may well apply, so they go too.
function isBracket(ch: string, cp: number): boolean {
  if (cp < 0x80) return BRACKETS.test(ch);
  return BRACKETS.test(ch.normalize('NFKC'));
}

// Invisible characters are billed like any other and say nothing.
function isInvisible(cp: number): boolean {
  return (
    cp < 0x20 ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0xad ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x2069) ||
    cp === 0xfeff ||
    (cp >= 0xd800 && cp <= 0xdfff) ||
    (cp >= 0xe0000 && cp <= 0xe007f)
  );
}

/**
 * The text to speak for a segment: brackets and invisible characters become spaces, whitespace is
 * collapsed, and a final full stop is added when the text ends mid-air (speech models trail off
 * without one). Returns '' when nothing speakable is left, and then no request is made.
 */
export function prepareText(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0) ?? 0;
    out += isInvisible(cp) || isBracket(ch, cp) ? ' ' : ch;
  }
  out = out.replace(/\s+/gu, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(out)) return '';
  if (/[\p{L}\p{N}]$/u.test(out)) out += '.';
  return out;
}

/** Characters as ElevenLabs counts them for billing: code points, not UTF-16 units. */
export function countCharacters(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}
