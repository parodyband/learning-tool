// What a scene is checked against: the lesson header, the plan and the stored evidence, with the
// token sets that the grounding checks compare. Built once per call (once per lesson for
// checkLesson) so each excerpt is tokenised at most once.
import { ID_PATTERN, PLAN_SCENE_KINDS, type Evidence, type Objective, type OutlineEntry } from '../schema';
import { canonical, contentTokens, sourceNumberTokens } from '../text';
import type { Draft } from '../types';

export interface EvidenceInfo {
  ev: Evidence;
  /** The excerpt is in another language than the lesson, so word overlap with a claim says nothing. */
  foreign: boolean;
  /** The item names a language of its own. False for no `lang` and for a tag that names none ("und"). */
  tagged: boolean;
  /** Distinct content tokens of the excerpt. */
  tokens(): Set<string>;
  /** Every number the excerpt gives a statement to rest on (see `sourceNumberTokens`). */
  numbers(): Set<string>;
  /** The excerpt in comparison form, for a quick "could these words be in here at all". */
  canonical(): string;
  /** Every word of the excerpt in comparison form, short ones included: what a name is looked up in. */
  words(): Set<string>;
  /** The excerpt as notation tokens (see `notationTokens`): what a formula or an expression is looked up in. */
  notation(): string[];
}

export interface Ctx {
  lang: string;
  planned: boolean;
  objectives: Objective[];
  outline: OutlineEntry[];
  /** Every stored evidence item, by id. */
  evidence: Map<string, EvidenceInfo>;
  /** Stored ids in numeric order, for messages. */
  storedIds: string[];
  /**
   * The evidence that text without a citation may rest on: a number in a caption, a host in a code
   * span. While scenes are being written this is everything stored. For the lesson as a whole it
   * is the evidence the lesson references, because only that is published and can be shown.
   */
  grounding: EvidenceInfo[];
  /** True when `grounding` is narrower than everything stored. */
  groundingIsNarrowed: boolean;
  /** Numbers that are part of the lesson's topic or title and so need no source. */
  exemptNumbers: Set<string>;
  /** The lesson's language as a primary subtag ("en"), or null when the tag names none. */
  language: string | null;
  /** Words of the lesson's topic and title, in comparison form: a name the lesson is about needs no source. */
  subjectWords(): Set<string>;
  groundingNumbers(): Set<string>;
  groundingHosts(): Set<string>;
}

/** Tags that say "no particular language": undetermined, no linguistic content, several, uncoded. */
const NO_LANGUAGE = new Set(['und', 'zxx', 'mul', 'mis']);

/**
 * The language a tag names, as its canonical primary subtag, or null when it names none.
 *
 * "en-GB", "EN" and "eng" are all English: the tag is supplied by the agent, the format accepts
 * three-letter codes, and an excerpt tagged "eng" in an English lesson must not count as foreign
 * (which would switch the overlap checks off). `Intl.Locale` does the canonicalisation ("eng" to
 * "en", "fra" and "fre" to "fr", "iw" to "he"). A tag that says only "undetermined" is no tag.
 */
export function primaryLanguage(tag: string): string | null {
  let language: string | undefined;
  try {
    language = new Intl.Locale(tag).language;
  } catch {
    const cut = tag.indexOf('-');
    language = (cut === -1 ? tag : tag.slice(0, cut)).toLowerCase();
  }
  return !language || NO_LANGUAGE.has(language) ? null : language;
}

const NOTATION_TOKEN = /\p{L}+|\p{N}+|[^\s\p{L}\p{N}]/gu;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu;

/**
 * `s` as the tokens a formula is compared by: each run of letters, each run of digits and each
 * other visible character on its own, in comparison form, white space dropped. "x = 3" and "x=3"
 * are the same three tokens, and "x = 30" is not "x = 3".
 */
export function notationTokens(s: string): string[] {
  return canonical(s).match(NOTATION_TOKEN) ?? [];
}

/** Every word of `s` in comparison form (lower case, NFKC), as a set. Apostrophes and hyphens separate words. */
export function wordSet(s: string): Set<string> {
  return new Set(canonical(s).match(WORD) ?? []);
}

/** e1, e2, e10: by number, not by text. */
export function byEvidenceId(a: string, b: string): number {
  const x = Number(a.slice(1));
  const y = Number(b.slice(1));
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A host as compared between evidence and a URL in code: lower case, without a leading "www." or trailing dot. */
export function comparableHost(host: string): string {
  let h = host.toLowerCase();
  while (h.endsWith('.')) h = h.slice(0, -1);
  return h.startsWith('www.') ? h.slice(4) : h;
}

function info(ev: Evidence, lessonLang: string): EvidenceInfo {
  let tokens: Set<string> | undefined;
  let numbers: Set<string> | undefined;
  let form: string | undefined;
  let words: Set<string> | undefined;
  let notation: string[] | undefined;
  const own = ev.lang === undefined ? null : primaryLanguage(ev.lang);
  const lesson = primaryLanguage(lessonLang);
  // An excerpt with no language of its own is read as being in the lesson's.
  const lang = own === null ? lessonLang : (ev.lang as string);
  return {
    ev,
    // Only a language that is named and differs makes an excerpt foreign. When the lesson's own tag names none, nothing can differ from it.
    foreign: own !== null && lesson !== null && own !== lesson,
    tagged: own !== null,
    tokens: () => (tokens ??= new Set(contentTokens(ev.excerpt, lang))),
    numbers: () => (numbers ??= new Set(sourceNumberTokens(ev.excerpt))),
    canonical: () => (form ??= canonical(ev.excerpt)),
    words: () => (words ??= wordSet(ev.excerpt)),
    notation: () => (notation ??= notationTokens(ev.excerpt)),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** The form of an id the server mints. Ids are named in messages, so nothing else is taken for one. */
const EVIDENCE_ID = /^e[1-9][0-9]{0,2}$/;
const OBJECTIVE_ID = /^o[1-9]$/;

/**
 * The stored evidence that can be used at all. A draft is read from disk, and a damaged entry must
 * surface as "that id is not stored", not as an exception halfway through a check.
 */
export function usableEvidence(draft: Draft): Evidence[] {
  const out: Evidence[] = [];
  const seen = new Set<string>();
  for (const ev of Array.isArray(draft.evidence) ? (draft.evidence as unknown[]) : []) {
    if (!isRecord(ev) || typeof ev.id !== 'string' || !EVIDENCE_ID.test(ev.id) || typeof ev.excerpt !== 'string' || typeof ev.url !== 'string' || typeof ev.host !== 'string') continue;
    if (ev.lang !== undefined && typeof ev.lang !== 'string') continue;
    // The first item with an id wins; ids are minted once and never reused.
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    out.push(ev as unknown as Evidence);
  }
  return out;
}

export interface ContextOptions {
  /** Restrict what uncited text may rest on to these evidence ids. */
  groundingIds?: ReadonlySet<string>;
}

export function buildContext(draft: Draft, options: ContextOptions = {}): Ctx {
  const lang = typeof draft.language === 'string' && draft.language ? draft.language : 'en';
  const evidence = new Map<string, EvidenceInfo>();
  for (const ev of usableEvidence(draft)) evidence.set(ev.id, info(ev, lang));
  const storedIds = [...evidence.keys()].sort(byEvidenceId);
  const narrowed = options.groundingIds !== undefined;
  const grounding = storedIds.filter((id) => !options.groundingIds || options.groundingIds.has(id)).map((id) => evidence.get(id) as EvidenceInfo);

  // Only entries with a well-formed id and kind count: both are named in messages and compared with scenes.
  const outline = (Array.isArray(draft.outline) ? (draft.outline as unknown[]) : []).filter(
    (e): e is OutlineEntry => isRecord(e) && typeof e.id === 'string' && ID_PATTERN.test(e.id) && (PLAN_SCENE_KINDS as readonly unknown[]).includes(e.kind),
  );
  const objectives = (Array.isArray(draft.objectives) ? (draft.objectives as unknown[]) : []).filter((o): o is Objective => isRecord(o) && typeof o.id === 'string' && OBJECTIVE_ID.test(o.id));
  const title = typeof draft.title === 'string' ? draft.title : '';
  const topic = typeof draft.topic === 'string' ? draft.topic : '';

  let groundingNumbers: Set<string> | undefined;
  let groundingHosts: Set<string> | undefined;
  let subjectWords: Set<string> | undefined;
  return {
    lang,
    planned: outline.length > 0 && title !== '',
    objectives,
    outline,
    evidence,
    storedIds,
    grounding,
    groundingIsNarrowed: narrowed,
    // Read as a passage is: a topic that names "the 1660s" lets the lesson say the decade and its years' forms.
    exemptNumbers: new Set([...sourceNumberTokens(topic), ...sourceNumberTokens(title)]),
    language: primaryLanguage(lang),
    subjectWords: () => (subjectWords ??= new Set([...wordSet(topic), ...wordSet(title)])),
    groundingNumbers: () => {
      if (!groundingNumbers) {
        groundingNumbers = new Set();
        for (const g of grounding) for (const n of g.numbers()) groundingNumbers.add(n);
      }
      return groundingNumbers;
    },
    groundingHosts: () => {
      if (!groundingHosts) {
        groundingHosts = new Set();
        for (const g of grounding) groundingHosts.add(comparableHost(g.ev.host));
      }
      return groundingHosts;
    },
  };
}
