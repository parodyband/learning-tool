// The grounding checks: a quote is in its excerpt, a claim shares words with the excerpts it cites
// without being a copy of one, and every number rests on a source. The other statements the page
// shows with a source chip (a recap takeaway, a checkpoint's explanation or model answer) are
// compared with their excerpts as a claim is, and a name in a claim is looked for in its passages.
//
// These are tripwires, not proof. They catch a citation that points at the wrong excerpt, a
// number nobody sourced and a name the source never mentions. They cannot tell whether an excerpt
// supports what is said about it, and the lesson says so to the learner. No message here ever
// contains excerpt text: the nearest span for a failed quote travels in `Issue.source`, as data.
import { issue } from '../issues';
import { LIMITS as L } from '../limits';
import { codeSpans, mathSpans, plainText, proseText } from '../markup';
import type { AnyScene } from '../clip';
import type { Block, ChartFigure, Objective } from '../schema';
import { canonical, contentTokens, countWords, findQuote, numberTokens, type QuoteSpan } from '../text';
import type { Issue, Severity } from '../types';
import { notationTokens, wordSet, type Ctx, type EvidenceInfo } from './context';
import type { NumberField, TextField } from './fields';
import { idList, show } from './shape';

const WEAK_SHARE = 0.2;
const WEAK_MIN_SHARED = 2;
/**
 * Below this many distinct content tokens on either side, "85% of the tokens agree" is too blunt to
 * call a copy: an excerpt that is mostly a formula has three such tokens, and a claim about one
 * part of it uses all three. The copy is then confirmed on every word of both texts.
 */
const COPY_CONFIRM_BELOW = 6;
const COPY_CONFIRM_WORDS = 0.7;

function known(ctx: Ctx, ids: readonly string[]): EvidenceInfo[] | null {
  const out: EvidenceInfo[] = [];
  for (const id of ids) {
    const info = ctx.evidence.get(id);
    // An unknown id is reported as CITE_UNKNOWN; grounding against a partial set would only add noise.
    if (!info) return null;
    out.push(info);
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

// ---------------------------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------------------------

const QUOTE_MARKS = new Set(['"', "'", '“', '”', '‘', '’', '«', '»', '„', '‹', '›']);
const ELLIPSIS = /\s*(?:\[\s*(?:\.\.\.|…)\s*\]|\(\s*(?:\.\.\.|…)\s*\)|\.\.\.|…)\s*/u;

function stripWrapping(text: string): string {
  let a = 0;
  let b = text.length;
  const skip = (ch: string): boolean => QUOTE_MARKS.has(ch) || ch === ' ';
  while (a < b && skip(text[a] as string)) a++;
  while (b > a && skip(text[b - 1] as string)) b--;
  let out = text.slice(a, b);
  out = out.replace(/^(?:\.\.\.|…)\s*/u, '').replace(/\s*(?:\.\.\.|…)$/u, '');
  return out;
}

function sourceOf(id: string, span: QuoteSpan): NonNullable<Issue['source']> {
  return { evidenceId: id, start: span.start, end: span.end, text: span.text };
}

/**
 * Check the quote block at `path` and, when its words are found, replace its text with the
 * excerpt's own characters, so what is stored and shown is the source's punctuation and spelling.
 */
function checkQuote(block: Extract<Block, { type: 'quote' }>, path: string, ctx: Ctx, out: Issue[]): void {
  const info = ctx.evidence.get(block.cite);
  if (!info) return;
  const id = block.cite;
  const excerpt = info.ev.excerpt;
  const match = findQuote(excerpt, block.text);

  if (!match.found) {
    let fix = `Copy the words from the excerpt of ${id} exactly as they stand there; "source" holds the nearest span. If you are restating the point in your own words, use a claim block instead.`;
    let source = match.closest ? sourceOf(id, match.closest) : undefined;

    const bare = stripWrapping(block.text);
    const unwrapped = bare !== block.text && bare !== '' ? findQuote(excerpt, bare) : null;
    const parts = block.text.split(ELLIPSIS).filter((part) => part.trim() !== '');
    if (unwrapped?.found) {
      fix = `The words are in ${id} once the quotation marks or ellipsis around them are removed. Send only the quoted words; "source" holds them exactly.`;
      source = sourceOf(id, unwrapped);
    } else if (parts.length > 1 && parts.every((part) => findQuote(excerpt, part).found)) {
      const first = findQuote(excerpt, parts[0] as string);
      fix = `An ellipsis joins ${parts.length} separate passages of ${id}. A quote is one continuous passage: use one quote block for each, or quote only one of them ("source" holds the first).`;
      if (first.found) source = sourceOf(id, first);
    } else {
      // A plain substring test first: the full search for a nearest span is not needed for the other excerpts.
      const wanted = canonical(block.text);
      const elsewhere = ctx.storedIds.filter((other) => {
        if (other === id) return false;
        const theirs = ctx.evidence.get(other) as EvidenceInfo;
        return wanted !== '' && theirs.canonical().includes(wanted) && findQuote(theirs.ev.excerpt, block.text).found;
      });
      if (elsewhere.length > 0) {
        fix = `These words are in ${idList(elsewhere)}, not in ${id}. Set "cite" to ${JSON.stringify(elsewhere[0])}.`;
        source = undefined;
      }
    }
    out.push(issue('QUOTE_NOT_FOUND', `${path}.text`, `The text of this quote does not occur in the excerpt of ${id}.`, { fix, ...(source ? { source } : {}) }));
    return;
  }

  const words = countWords(match.text, info.ev.lang ?? ctx.lang);
  if (words < L.quoteMinWords) {
    out.push(
      issue('QUOTE_TOO_SHORT', `${path}.text`, `This quote is ${words} ${plural(words, 'word')}; a quote needs at least ${L.quoteMinWords}.`, {
        fix: `Quote a longer phrase from ${id}, or state the point as a claim that cites ${id}.`,
        got: String(words),
        expected: `at least ${L.quoteMinWords} words`,
      }),
    );
    return;
  }
  if (match.text.length > L.quoteChars) {
    // The source may spell the same words with more characters than the agent typed.
    out.push(
      issue('TOO_LONG', `${path}.text`, `This quote is ${match.text.length} characters in the source's own spelling; the limit is ${L.quoteChars}.`, {
        fix: 'Quote a shorter passage.',
        got: String(match.text.length),
        expected: `at most ${L.quoteChars} characters`,
      }),
    );
    return;
  }
  block.text = match.text;
}

// ---------------------------------------------------------------------------------------------
// Claims, and the other statements that carry a citation
// ---------------------------------------------------------------------------------------------

/** What the page shows with a source chip. Each is compared with the excerpts it cites. */
type StatementKind = 'claim' | 'takeaway' | 'explanation' | 'model answer';

interface Statement {
  /** Path of the citing item, which is also how the receipt and the page name it: "blocks[1]", "takeaways[0]", "question.explanation". */
  path: string;
  kind: StatementKind;
  text: string;
  cites: readonly string[];
}

const ONLY_LETTERS = /^\p{L}+$/u;

/**
 * The formulas and expressions of a statement: the content of each code span and each math span
 * (math as the line of text it reads as), as notation tokens. A span counts only when it is real
 * notation: three tokens or more, not all of them words. So `x = 3` and `log2(n) + 1` count, and a
 * lone letter, a lone digit or a word in a code span does not.
 */
function notationUnits(text: string): string[][] {
  if (!text.includes('`') && !text.includes('$')) return [];
  const spans = [...codeSpans(text), ...mathSpans(text).map((m) => plainText(`$${m}$`))];
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const span of spans) {
    const tokens = notationTokens(span);
    if (tokens.length < 3 || tokens.every((t) => ONLY_LETTERS.test(t))) continue;
    const key = tokens.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tokens);
  }
  return out;
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  const last = haystack.length - needle.length;
  outer: for (let i = 0; i <= last; i++) {
    for (let k = 0; k < needle.length; k++) if (haystack[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
}

/** The numbers of two or more digits in the running prose of a statement: the ones a source has to state. */
function longNumbers(text: string): string[] {
  return distinct(numberTokens(proseText(text))).filter((t) => t.replace(/[^0-9]/g, '').length >= 2);
}

/** Every word of both texts, not only the content tokens: does each hold at least `COPY_CONFIRM_WORDS` of the other? */
function sameWords(text: string, info: EvidenceInfo): boolean {
  const mine = wordSet(plainText(text));
  const theirs = info.words();
  if (mine.size === 0 || theirs.size === 0) return false;
  let common = 0;
  for (const w of mine) if (theirs.has(w)) common++;
  return common / mine.size >= COPY_CONFIRM_WORDS && common / theirs.size >= COPY_CONFIRM_WORDS;
}

/**
 * The relation check: does the statement share anything with the excerpts it cites?
 *
 * Shared content words are the measure. A formula or an expression that the excerpt also contains
 * counts as one, and so does a number of two or more digits: a maths claim that restates the
 * source's own equation has almost no word of four letters to share. Those two can only help a
 * statement; they never make one fail that word overlap alone would pass.
 *
 * A claim or a takeaway that shares nothing is refused (CLAIM_UNRELATED). An explanation or a
 * model answer that shares nothing is only warned about: it reasons about a case the lesson did
 * not show, and may honestly share no word with the passage it rests on. Every warning here is
 * recorded as a weak match, which the page shows to the learner beside that statement.
 *
 * Returns false when the statement was refused.
 */
function checkRelation(st: Statement, cited: readonly EvidenceInfo[], tokens: ReadonlySet<string>, ctx: Ctx, out: Issue[], weak: string[]): boolean {
  const ids = idList(st.cites);
  const excerpts = plural(cited.length, 'excerpt');
  const strict = st.kind === 'claim' || st.kind === 'takeaway';

  const sharedWords = new Set<string>();
  for (const info of cited) for (const t of tokens) if (info.tokens().has(t)) sharedWords.add(t);
  const units = notationUnits(st.text);
  const sharedNotation = units.filter((unit) => cited.some((info) => containsRun(info.notation(), unit))).length;
  const numbers = longNumbers(st.text);
  const sharedNumbers = numbers.filter((n) => cited.some((info) => info.numbers().has(n))).length;
  const shared = sharedWords.size + sharedNotation + sharedNumbers;

  const note = `The learner is shown a note on ${st.kind === 'claim' ? 'a claim' : `${st.kind === 'explanation' ? 'an' : 'a'} ${st.kind}`} with this warning.`;
  const warn = (message: string, fix: string): void => {
    weak.push(st.path);
    out.push(issue('CLAIM_WEAK_MATCH', st.path, message, { fix: `${fix}${languageHint(cited, ctx)} ${note}` }));
  };

  if (shared === 0 && tokens.size === 0) {
    warn(
      `This ${st.kind} has no word of four letters or more, and no formula or number, to compare with the ${excerpts} it cites (${ids}).`,
      `Say what the ${st.kind} is about with the key terms of ${ids}, so a learner who opens the source can find the passage.`,
    );
    return true;
  }
  if (shared === 0 && !strict) {
    warn(
      `This ${st.kind} shares no content word with the ${excerpts} it cites (${ids}).`,
      `Check that ${ids} is what makes the answer right. If it is, say why in the source's own key terms; if it is not, cite the passage the lesson taught this from.`,
    );
    return true;
  }
  if (shared === 0) {
    // Another stored passage is named only when it could be the right one: it shares words with
    // the statement and has every number and formula the statement states.
    let best: { id: string; shared: number } | null = null;
    for (const other of ctx.storedIds) {
      if (st.cites.includes(other)) continue;
      const info = ctx.evidence.get(other) as EvidenceInfo;
      if (info.foreign) continue;
      let common = 0;
      for (const t of tokens) if (info.tokens().has(t)) common++;
      if (common < WEAK_MIN_SHARED || (best && common <= best.shared)) continue;
      if (!numbers.every((n) => info.numbers().has(n)) || !units.every((unit) => containsRun(info.notation(), unit))) continue;
      best = { id: other, shared: common };
    }
    const first =
      units.length > 0
        ? `If ${ids} does state this, write the formula the way the excerpt writes it, or quote the passage. Otherwise save the passage that supports the ${st.kind} and cite it, or delete the ${st.kind}.`
        : `Save the passage that supports the ${st.kind} and cite it, or delete the ${st.kind}.`;
    const elsewhere = best
      ? ` The stored excerpt ${best.id} shares ${best.shared} content words with this ${st.kind}: cite ${best.id} only if that passage is what supports it.`
      : ' No other stored excerpt shares its terms.';
    out.push(
      issue('CLAIM_UNRELATED', st.path, `This ${st.kind} shares no content word with the ${excerpts} it cites (${ids}).`, {
        fix: `${first}${elsewhere} Do not reword the ${st.kind} to borrow words from an excerpt that does not support it.${languageHint(cited, ctx)}`,
      }),
    );
    return false;
  }
  if (sharedWords.size + sharedNotation === 0) {
    warn(
      `This ${st.kind} shares ${sharedNumbers === 1 ? 'a number' : 'numbers'} with the ${excerpts} it cites (${ids}) but no content word.`,
      `Check that ${ids} supports the ${st.kind}. If it does, use the source's own key terms; if it does not, cite the excerpt that does or delete the ${st.kind}.`,
    );
    return true;
  }
  if (shared < WEAK_MIN_SHARED && shared / (tokens.size + sharedNotation + sharedNumbers) < WEAK_SHARE) {
    warn(
      `This ${st.kind} shares ${sharedWords.size} of its ${tokens.size} content words with the ${excerpts} it cites (${ids}).`,
      `Check that ${ids} supports the ${st.kind}. If it does, use the source's own key terms; if it does not, cite the excerpt that does or delete the ${st.kind}.`,
    );
  }
  return true;
}

/**
 * A lesson in one language built on passages in another is ordinary, and `lang` on the evidence is
 * what says so. When a cited passage names no language and the lesson is not in English (the
 * language most sources are in), say that this may be the cause, as a fact to check and not as a
 * way through: a language tag switches the comparison off, and that is only honest when it is true.
 */
function languageHint(cited: readonly EvidenceInfo[], ctx: Ctx): string {
  if (ctx.language === 'en') return '';
  const untagged = cited.filter((info) => !info.tagged).map((info) => info.ev.id);
  if (untagged.length === 0) return '';
  return ` If ${idList(untagged)} is in another language than this lesson (${show(ctx.lang)}), and only then, the evidence item needs "lang": save the passage again with "lang" set to the language it is in, and cite the id that save_evidence answers with (read its answer: a stored passage is never changed in place).`;
}

function checkClaim(block: Extract<Block, { type: 'claim' }>, path: string, ctx: Ctx, out: Issue[], weak: string[]): void {
  const words = countWords(block.text, ctx.lang);
  if (words > L.claimWords) {
    out.push(
      issue('CLAIM_TOO_LONG', `${path}.text`, `This claim has ${words} words; the limit is ${L.claimWords}.`, {
        fix: `Split it into two claims of at most ${L.claimWords} words, each citing the excerpt that supports it.`,
        got: String(words),
        expected: `at most ${L.claimWords} words`,
      }),
    );
  }

  const cited = known(ctx, block.cites);
  // Words in one language cannot be matched against an excerpt in another.
  if (!cited || cited.some((info) => info.foreign)) return;
  const tokens = new Set(contentTokens(plainText(block.text), ctx.lang));

  for (const info of cited) {
    const theirs = info.tokens();
    if (tokens.size === 0 || theirs.size === 0) continue;
    let common = 0;
    for (const t of tokens) if (theirs.has(t)) common++;
    if (common / tokens.size < L.copyContainment || common / theirs.size < L.copyContainment) continue;
    if (Math.min(tokens.size, theirs.size) < COPY_CONFIRM_BELOW && !sameWords(block.text, info)) continue;
    out.push(
      issue('CLAIM_COPIES_SOURCE', `${path}.text`, `This claim repeats the excerpt of ${info.ev.id} almost word for word: ${Math.round((common / tokens.size) * 100)}% of its content words are the excerpt's, and they cover ${Math.round((common / theirs.size) * 100)}% of the excerpt.`, {
        fix: `Make it a quote block ({"type": "quote", "text": the words exactly as in the excerpt, "cite": "${info.ev.id}"}), or say it in your own sentence with the source's key terms.`,
      }),
    );
    return;
  }

  // A claim that is refused as unrelated is not also asked about its names.
  if (checkRelation({ path, kind: 'claim', text: block.text, cites: block.cites }, cited, tokens, ctx, out, weak)) checkNames(block.text, `${path}.text`, block.cites, cited, ctx, out);
}

/** The relation check alone, for a statement that is not a claim block: no word limit and no copy check. */
function checkStatement(st: Statement, ctx: Ctx, out: Issue[], weak: string[]): void {
  const cited = known(ctx, st.cites);
  if (!cited || cited.some((info) => info.foreign)) return;
  checkRelation(st, cited, new Set(contentTokens(plainText(st.text), ctx.lang)), ctx, out, weak);
}

/**
 * Quotes, claims and the other cited statements of the scene: a recap's takeaways, a checkpoint's
 * explanation or model answer. Quote texts are rewritten in place to the excerpt's characters.
 * Returns the paths of the statements with a weak match.
 */
export function checkBlocks(scene: AnyScene, ctx: Ctx, out: Issue[]): string[] {
  const weak: string[] = [];
  const one = (block: Block, path: string): void => {
    if (block.type === 'quote') checkQuote(block, path, ctx, out);
    else if (block.type === 'claim') checkClaim(block, path, ctx, out, weak);
  };
  const visit = (blocks: Block[], prefix: string): void => blocks.forEach((block, i) => one(block, `${prefix}blocks[${i}]`));
  switch (scene.kind) {
    case 'narration':
      visit(scene.blocks, '');
      break;
    case 'step_through':
      scene.steps.forEach((step, i) => visit(step.blocks, `steps[${i}].`));
      break;
    case 'checkpoint':
      if (scene.question.type === 'reflect') checkStatement({ path: 'question.modelAnswer', kind: 'model answer', ...scene.question.modelAnswer }, ctx, out, weak);
      else checkStatement({ path: 'question.explanation', kind: 'explanation', ...scene.question.explanation }, ctx, out, weak);
      break;
    case 'recap':
      scene.takeaways.forEach((takeaway, i) => checkStatement({ path: `takeaways[${i}]`, kind: 'takeaway', text: takeaway.text, cites: takeaway.cites }, ctx, out, weak));
      break;
    case 'clip':
      // A caption is one block, held to every rule a block of a narration scene is held to.
      scene.beats.forEach((beat, i) => one(beat.caption, `beats[${i}].caption`));
      break;
  }
  return weak;
}

/** How many statements of the scene go through the relation check: what a share of weak matches is a share of. */
export function statementCount(scene: AnyScene): number {
  const claims = (blocks: readonly Block[]): number => blocks.filter((b) => b.type === 'claim').length;
  switch (scene.kind) {
    case 'narration':
      return claims(scene.blocks);
    case 'step_through':
      return scene.steps.reduce((sum, step) => sum + claims(step.blocks), 0);
    case 'checkpoint':
      return 1;
    case 'recap':
      return scene.takeaways.length;
    case 'clip':
      return scene.beats.filter((beat) => beat.caption.type === 'claim').length;
  }
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

/** Languages that write every noun with a capital, where a capital does not mark a name. */
const CAPITALISES_NOUNS = new Set(['de', 'lb', 'nds', 'gsw', 'bar']);
const NAME_WORD = /\p{L}[\p{L}\p{M}\p{N}]*/gu;
const STARTS_UPPER = /^[\p{Lu}\p{Lt}]/u;
const LETTER = /\p{L}/gu;
const OPENERS = new Set(['"', "'", '(', '[', '“', '‘', '«', '„', '‹']);
const CLOSERS = new Set(['"', "'", ')', ']', '”', '’', '»', '›']);
const SENTENCE_END = new Set(['.', '!', '?', ':', '…']);

/** True when the word at `at` opens the text or follows the end of a sentence (or a colon), so its capital is only the sentence's. */
function startsSentence(text: string, at: number): boolean {
  let k = at - 1;
  while (k >= 0 && OPENERS.has(text[k] as string)) k--;
  while (k >= 0 && text[k] === ' ') k--;
  while (k >= 0 && CLOSERS.has(text[k] as string)) k--;
  return k < 0 || SENTENCE_END.has(text[k] as string);
}

/** A name of this many letters or more is compared by its first letters, as content words are: "Germany" is present where "German" is. */
const NAME_STEM_CHARS = 5;

/** The forms under which a name counts as present: itself, its plural, and what it is the plural of. A possessive is two words already. */
function nameForms(word: string): string[] {
  const out = [word, `${word}s`, `${word}es`];
  if (word.endsWith('ies') && word.length > 4) out.push(`${word.slice(0, -3)}y`);
  if (word.endsWith('es') && word.length > 4) out.push(word.slice(0, -2));
  if (word.endsWith('s') && word.length > 3) out.push(word.slice(0, -1));
  if (word.endsWith('y')) out.push(`${word.slice(0, -1)}ies`);
  return out;
}

/** True when `words` has the name: one of its forms, or, for a name long enough to have a stem, a word that begins the same way. */
function hasName(words: ReadonlySet<string>, name: string, forms: readonly string[]): boolean {
  if (forms.some((f) => words.has(f))) return true;
  const chars = Array.from(name);
  if (chars.length < NAME_STEM_CHARS) return false;
  const stem = chars.slice(0, NAME_STEM_CHARS).join('');
  for (const w of words) if (w.startsWith(stem)) return true;
  return false;
}

const CALENDAR = new Map<string, Set<string>>();

/**
 * The names of the months and weekdays in the lesson's language, in comparison form. English
 * writes them with a capital, and a date is checked as a number: "16 October" rests on a passage
 * that prints "16.10." or "2023-10-16" without the word.
 */
function calendarWords(lang: string): Set<string> {
  let out = CALENDAR.get(lang);
  if (out) return out;
  out = new Set();
  try {
    for (const width of ['long', 'short'] as const) {
      const month = new Intl.DateTimeFormat(lang, { month: width, timeZone: 'UTC' });
      const day = new Intl.DateTimeFormat(lang, { weekday: width, timeZone: 'UTC' });
      for (let m = 0; m < 12; m++) for (const w of wordSet(month.format(new Date(Date.UTC(2024, m, 1))))) out.add(w);
      for (let d = 1; d <= 7; d++) for (const w of wordSet(day.format(new Date(Date.UTC(2024, 0, d))))) out.add(w);
    }
  } catch {
    // A language tag the runtime does not know: no calendar words, and the check runs without them.
  }
  if (CALENDAR.size >= 64) CALENDAR.clear();
  CALENDAR.set(lang, out);
  return out;
}

/**
 * NAME_NOT_IN_SOURCE, a warning: a claim names something its cited passages never mention.
 *
 * A name is taken to be a word of three letters or more that begins with a capital and does not
 * begin a sentence. It needs no source when the lesson's topic or title has it, or when it is a
 * month or a weekday. It is present in a cited item when the passage, or the item's title or
 * publisher (what the learner is shown as the source), has the word, its plural or its possessive,
 * compared in canonical form; a longer name also when a word there begins with the same five
 * letters, so that "East Germany" rests on "East German". This is a prompt to look, never a
 * refusal: a capital can be a term the source spells differently.
 *
 * It is skipped where a capital is not a sign of a name: in a language that capitalises every
 * noun, in a script without case (no word qualifies), and against a passage in another language,
 * which may write the name another way (the caller does not get here for one).
 *
 * Measured on the honest corpus of this round (the example lesson, the two fixture lessons and the
 * four trial lessons, 91 claims): the plain rule fired on 4 claims, all in the history lesson and
 * none a mistake ("East Germany" for "East German", the page's own title and publisher). With the
 * title, the publisher and the stem counted it fires on none, and still on the claim that named a
 * city its passage did not.
 */
function checkNames(text: string, path: string, cites: readonly string[], cited: readonly EvidenceInfo[], ctx: Ctx, out: Issue[], what = 'claim', markup = true): void {
  if (ctx.language !== null && CAPITALISES_NOUNS.has(ctx.language)) return;
  const prose = markup ? proseText(text) : text;
  // No capital that could be a name: most claims in most lessons.
  if (!/\p{Lu}/u.test(prose.slice(1))) return;
  const subject = ctx.subjectWords();
  const calendar = calendarWords(ctx.lang);
  // The stored item is read from disk: a title or publisher that is not text is simply not there.
  const label = (v: unknown): Set<string> => (typeof v === 'string' ? wordSet(v) : new Set());
  const sources = cited.map((info) => new Set([...info.words(), ...label(info.ev.title), ...label(info.ev.publisher)]));
  const missing: { name: string; key: string; forms: string[] }[] = [];
  const seen = new Set<string>();
  for (const match of prose.matchAll(NAME_WORD)) {
    const word = match[0];
    if (!STARTS_UPPER.test(word) || (word.match(LETTER) ?? []).length < 3 || startsSentence(prose, match.index)) continue;
    const key = canonical(word);
    if (seen.has(key)) continue;
    seen.add(key);
    const forms = nameForms(key);
    if (calendar.has(key) || hasName(subject, key, forms) || sources.some((words) => hasName(words, key, forms))) continue;
    missing.push({ name: word, key, forms });
  }
  if (missing.length === 0) return;

  const ids = idList(cites);
  const names = missing.slice(0, 6).map((m) => `"${show(m.name)}"`);
  const more = missing.length > 6 ? ` and ${missing.length - 6} more` : '';
  const where = missing
    .map((m) => ({ name: m.name, ids: ctx.storedIds.filter((id) => !cites.includes(id) && hasName((ctx.evidence.get(id) as EvidenceInfo).words(), m.key, m.forms)) }))
    .filter((x) => x.ids.length > 0);
  const elsewhere = where.length
    ? `${where.slice(0, 4).map((x) => `"${show(x.name)}" is in ${idList(x.ids.slice(0, 4))}`).join('; ')}: cite that passage as well if it is what supports this part of the ${what === 'claim' ? 'claim' : 'stage'}. `
    : '';
  const onStage = what !== 'claim';
  const owner = onStage ? 'the stage cites' : 'it cites';
  const scope = cites.length === 1 ? `not in the excerpt ${owner} (${ids})` : `in none of the excerpts ${owner} (${ids})`;
  const own = onStage ? ' If the stage is your own worked case or an illustration, set its "provenance" to "worked" or "illustrative".' : '';
  out.push(
    issue('NAME_NOT_IN_SOURCE', path, `${missing.length === 1 ? `The name ${names[0]} in this ${what} is` : `The names ${names.join(', ')}${more} in this ${what} are`} ${scope}.`, {
      fix: `${elsewhere}Check where ${missing.length === 1 ? 'the name' : 'each name'} came from. If a source you read states it, save that passage and cite it too; if you added it from memory, take it out, or say only what ${ids} says.${own} Nothing needs changing for a word that is not a name, or that the source spells another way: this is a warning and is recorded as one.`,
      got: missing.map((m) => show(m.name)).slice(0, 6).join(', '),
    }),
  );
}

/**
 * NAME_NOT_IN_SOURCE for the text of a stage marked "sourced": a label, a date or a read-out that
 * names something none of the stage's cited passages mentions. Code is not read for names.
 */
export function checkStageNames(fields: readonly TextField[], ctx: Ctx, out: Issue[]): void {
  for (const field of fields) {
    if (field.numbers.kind !== 'cited' || field.numbers.of !== 'stage' || field.code) continue;
    const cited = known(ctx, field.numbers.cites);
    if (!cited || cited.some((info) => info.foreign)) continue;
    checkNames(field.text, field.path, field.numbers.cites, cited, ctx, out, field.what, field.markup);
  }
}

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

/** A number needs a source unless it is a single digit or part of the lesson's topic or title. */
function needsSource(token: string, ctx: Ctx): boolean {
  return token.length > 1 && !ctx.exemptNumbers.has(token);
}

function distinct(tokens: readonly string[]): string[] {
  return [...new Set(tokens)];
}

function holders(ctx: Ctx, has: (info: EvidenceInfo) => boolean, exclude: readonly string[]): string[] {
  return ctx.storedIds.filter((id) => !exclude.includes(id) && has(ctx.evidence.get(id) as EvidenceInfo));
}

function numberList(tokens: readonly string[]): string {
  return tokens.length === 1 ? `number ${tokens[0]}` : `numbers ${tokens.join(', ')}`;
}

/** Where a number that is not a sourced fact belongs. Code and math spans exist only where markup is read. */
function ownWorking(markup: boolean): string {
  const example = 'If it is your own arithmetic or an illustration, it belongs in an example block.';
  return markup ? `${example} If it is notation (an identifier, an expression), write it in a code span or math span.` : example;
}

type NumberOwner = 'statement' | 'figure' | 'chart' | 'stage';

/**
 * NUMBER_NOT_IN_SOURCE for one field. For a part of a figure the citations are the figure's own:
 * the way out is to cite the passage from the figure, and the message says so.
 */
function citedNumberIssue(path: string, what: string, markup: boolean, missing: readonly string[], cites: readonly string[], ctx: Ctx, has: (info: EvidenceInfo, token: string) => boolean, owner: NumberOwner = 'statement'): Issue {
  const where = missing.map((token) => ({ token, ids: holders(ctx, (info) => has(info, token), cites) })).filter((x) => x.ids.length > 0);
  const found = where.map((x) => `${x.token} is in ${idList(x.ids)}`).join('; ');
  const verb = missing.length === 1 ? 'is' : 'are';
  if (owner === 'statement') {
    const elsewhere = where.length ? `${found}: add that id to the citations only if that passage is what supports this statement. ` : 'No stored excerpt contains it. Save the passage that states it and cite it, or remove the number. ';
    return issue('NUMBER_NOT_IN_SOURCE', path, `The ${numberList(missing)} in this ${what} ${verb} not in the ${plural(cites.length, 'excerpt')} it cites (${idList(cites)}).`, {
      fix: `${elsewhere}${ownWorking(markup)} Write a number the way the source writes it.`,
      got: missing.join(', '),
    });
  }
  if (owner === 'stage') {
    const full = cites.length >= L.citesPerFigure ? ', and this one already does, so take out one it does not draw on' : '';
    const elsewhere = where.length
      ? `${found}: add that id to the stage's "cites" if that passage is where the stage takes the number from (a stage may cite up to ${L.citesPerFigure} passages${full}). `
      : 'No stored excerpt contains it. If a source states it, save that passage with save_evidence and add its id to the stage\'s "cites". ';
    return issue('NUMBER_NOT_IN_SOURCE', path, `The ${numberList(missing)} in this ${what} ${verb} not in the ${plural(cites.length, 'excerpt')} the stage cites (${idList(cites)}).`, {
      fix: `${elsewhere}A stage marked "sourced" is read as fact, so every number on it, and every number its actions bring on, must be in a passage the stage itself cites: the learner opens the stage's sources to check it. If the numbers are a case you worked through yourself, set "provenance" to "worked"; if only the shape matters, to "illustrative". The page says which it is.`,
      got: missing.join(', '),
    });
  }
  const room = cites.length >= L.citesPerFigure ? `, and this one already does, so take out one it does not draw on` : '';
  const elsewhere = where.length
    ? `${found}: add that id to the figure's "cites" if that passage is where the figure takes the number from (a figure may cite up to ${L.citesPerFigure} passages${room}). `
    : 'No stored excerpt contains it. If a source states it, save that passage with save_evidence and add its id to the figure\'s "cites". ';
  const own =
    owner === 'chart'
      ? 'If the numbers are yours and only the shape matters, set "data" to "illustrative".'
      : `If it is a value you chose to illustrate the idea, write a symbol such as n or x, or a single digit, in its place${markup ? ', put the notation in a code span' : ''}, or show the worked case in a lines figure or an example block.`;
  return issue('NUMBER_NOT_IN_SOURCE', path, `The ${numberList(missing)} in this ${what} ${verb} not in the ${plural(cites.length, 'excerpt')} the figure cites (${idList(cites)}).`, {
    fix: `${elsewhere}A number in a figure is read as a fact, so it must be in a passage the figure itself cites: the learner opens the figure's sources to check it. ${own}`,
    got: missing.join(', '),
  });
}

function fieldNumbers(field: TextField): string[] {
  return distinct(numberTokens(field.markup ? proseText(field.text) : field.text));
}

/** NUMBER_NOT_IN_SOURCE and NUMBER_UNGROUNDED for every text field of a scene. */
export function checkNumbers(fields: readonly TextField[], ctx: Ctx, out: Issue[]): void {
  for (const field of fields) {
    if (field.numbers.kind === 'exempt') continue;
    const allow = field.numbers.kind === 'uncited' ? (field.numbers.allow ?? []) : [];
    // A number the picture itself shows (an end or the start of a slider) is not a fact that needs a source.
    const tokens = fieldNumbers(field).filter((t) => needsSource(t, ctx) && !allow.includes(Number(t)));
    if (tokens.length === 0) continue;

    if (field.numbers.kind === 'cited') {
      const cites = field.numbers.cites;
      const cited = known(ctx, cites);
      if (!cited) continue;
      const missing = tokens.filter((t) => !cited.some((info) => info.numbers().has(t)));
      if (missing.length > 0) out.push(citedNumberIssue(field.path, field.what, field.markup, missing, cites, ctx, (info, token) => info.numbers().has(token), field.numbers.of ?? 'statement'));
      continue;
    }

    const missing = ungrounded(tokens, ctx);
    if (missing.length === 0) continue;
    // The text of an explore or of a tap gate: the way out is to say it without the number.
    const interactive = field.numbers.allow !== undefined;
    const fix = interactive
      ? `Say it without the number ("more than half", "until the two bars meet"), or use a number that belongs to the picture: one the stage shows, an end or the start of a slider, or a constant of the clip's own formulas. Any other number in this ${field.what} is a fact from outside the picture and needs a stored passage that states it; a single digit needs no source.`
      : `A number is a fact. State it in a claim that cites its source, or remove it from this ${field.what}. ${ownWorking(field.markup)}`;
    out.push(ungroundedIssue(field.path, field.what, missing, ctx, fix, `State the number in a claim that cites that excerpt, or remove it from this ${field.what}.`));
  }
}

function ungrounded(tokens: readonly string[], ctx: Ctx): string[] {
  const grounded = ctx.groundingNumbers();
  return tokens.filter((t) => !grounded.has(t));
}

/** NUMBER_UNGROUNDED for text that carries no citation. `fix` is the way out; `uncitedFix` the one for a number that sits in a stored passage the lesson never cites. */
function ungroundedIssue(path: string, what: string, missing: readonly string[], ctx: Ctx, fix: string, uncitedFix: string, severity?: Severity): Issue {
  // Stored but not referenced by the lesson: only possible when the lesson as a whole is checked.
  const unpublished = ctx.groundingIsNarrowed ? missing.map((token) => ({ token, ids: holders(ctx, (info) => info.numbers().has(token), []) })).filter((x) => x.ids.length > 0) : [];
  return issue('NUMBER_UNGROUNDED', path, `The ${numberList(missing)} in this ${what} ${missing.length === 1 ? 'is' : 'are'} in no ${ctx.groundingIsNarrowed ? 'excerpt the lesson cites' : 'stored excerpt'}.`, {
    fix: unpublished.length ? `${unpublished.map((x) => `${x.token} is in ${idList(x.ids)}`).join('; ')}, which the lesson never cites, so the learner could not check it. ${uncitedFix}` : fix,
    got: missing.join(', '),
    ...(severity ? { severity } : {}),
  });
}

/**
 * NUMBER_UNGROUNDED for the objectives, which the lesson prints under "After this lesson you can"
 * and which carry no citation. An objective is plain text (no markup).
 *
 * For a finished lesson this is an error like any other uncited number. While the lesson is being
 * planned it is a warning: the passage may not be saved yet, and the agent should hear about it
 * now and not when the last scene is in.
 */
export function objectiveNumberIssues(objectives: readonly Objective[], ctx: Ctx, when: 'plan' | 'lesson'): Issue[] {
  const out: Issue[] = [];
  objectives.forEach((objective, i) => {
    if (typeof objective.text !== 'string') return;
    const missing = ungrounded(distinct(numberTokens(objective.text)).filter((t) => needsSource(t, ctx)), ctx);
    if (missing.length === 0) return;
    const reword = 'say what the learner will be able to do without the number';
    out.push(
      when === 'plan'
        ? ungroundedIssue(
            `objectives[${i}].text`,
            `objective (${objective.id})`,
            missing,
            ctx,
            `A number is a fact, and the finished lesson is refused unless a passage it cites states this one. Save that passage with save_evidence and cite it in the lesson, or ${reword} and call plan_lesson again.`,
            '',
            'warning',
          )
        : ungroundedIssue(
            `objectives[${i}].text`,
            `objective (${objective.id})`,
            missing,
            ctx,
            `A number is a fact. Call plan_lesson again with the same outline and the objective reworded (${reword}); the accepted scenes are kept. Or, if a source states the number, save that passage and cite it in a claim.`,
            `State the number in a claim that cites that excerpt, or call plan_lesson again with the same outline and the objective reworded (${reword}); the accepted scenes are kept.`,
          ),
    );
  });
  return out;
}

/** A chart value as the digits a source would print: no exponent, no sign. */
function plainNumber(value: number): string {
  const abs = Math.abs(value);
  const text = String(abs);
  return text.includes('e') ? abs.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 }) : text;
}

/** True when the excerpt states a number worth `value`, however it prints it. */
function worth(info: EvidenceInfo, value: number): boolean {
  for (const token of info.numbers()) if (Number(token) === value) return true;
  return false;
}

/** The values, each once and without its sign, that need a source and that none of the cited excerpts states. */
function unsourcedValues(values: readonly number[], cited: readonly EvidenceInfo[], ctx: Ctx): number[] {
  const missing: number[] = [];
  for (const value of values) {
    const abs = Math.abs(value);
    if (!needsSource(plainNumber(value), ctx) || missing.includes(abs)) continue;
    if (!cited.some((info) => worth(info, abs))) missing.push(abs);
  }
  return missing;
}

/**
 * The numbers of a stage marked "sourced" that are not text: bar and series values, read-outs,
 * counts of dots, the value a `set` counts to. Matched by what they are worth, like a sourced
 * chart's values.
 */
export function checkStageValues(values: readonly NumberField[], ctx: Ctx, out: Issue[]): void {
  for (const field of values) {
    const cited = known(ctx, field.cites);
    if (!cited) continue;
    const missing = unsourcedValues(field.values, cited, ctx);
    if (missing.length === 0) continue;
    const base = citedNumberIssue(field.path, field.what, false, missing.map(plainNumber), field.cites, ctx, (info, token) => worth(info, Number(token)), 'stage');
    base.fix = `${base.fix} Put the scale (thousands, percent) in the unit.`;
    out.push(base);
  }
}

/**
 * The values of a chart marked `data: "sourced"`. A value is matched by what it is worth, so 2.5
 * finds "2.50" and 1200 finds "1,200"; the scale (thousands, percent) belongs in `unit`.
 */
export function checkChartValues(figure: ChartFigure, ctx: Ctx, out: Issue[]): void {
  if (figure.data !== 'sourced') return;
  const cited = known(ctx, figure.cites);
  if (!cited) return;
  figure.series.forEach((series, i) => {
    const missing = unsourcedValues(series.values, cited, ctx);
    if (missing.length === 0) return;
    const tokens = missing.map(plainNumber);
    const base = citedNumberIssue(`figure.series[${i}].values`, `sourced chart (series "${series.id}")`, false, tokens, figure.cites, ctx, (info, token) => worth(info, Number(token)), 'chart');
    base.fix = `${base.fix} Put the scale (thousands, percent) in "unit".`;
    out.push(base);
  });
}
