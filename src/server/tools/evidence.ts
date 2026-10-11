// save_evidence: 1 to 10 excerpts, each judged on its own. Evidence is append-only: an accepted item
// gets the next id and is never touched again, and a repeat of a stored item answers with its id.
//
// A stored passage sent again with a different `via` or `lang` is not a repeat: it says something
// else about the passage (it was read on the page after all; it is in another language). Nothing
// stored is edited, so it is stored again as a new item with its own id, and the answer says which
// earlier item holds the same text. Without that, an agent that forgot `lang` could never supply it.
//
// Such a copy adds no text from the page, so it does not use up the page's allowance: for the
// per-URL limit a passage counts once however many items hold it (see `distinctPassages`).
import { issue } from '../../core/issues';
import { DEPTHS, LIMITS as L } from '../../core/limits';
import { EvidenceInput, type Evidence } from '../../core/schema';
import { canonical } from '../../core/text';
import type { Draft, Issue } from '../../core/types';
import { checkEvidence, normalizeSourceUrl } from '../../core/validate';
import { primaryLanguage } from '../../core/validate/context';
import { parseShape, show } from '../../core/validate/shape';
import { jsonType, readList } from '../args';
import { serverIssue } from '../issues';
import { localDate } from '../paths';
import { nextEvidenceId, type Handler } from './common';
import { lessonCall, type Work } from './lesson-call';

export const MAX_ITEMS_PER_CALL = 10;
const ITEM_SHAPE = 'Send "items" as an array of 1 to 10 objects {url, title, excerpt, via}, even for a single item.';

const under = (index: number, found: Issue): Issue => ({ ...found, path: found.path ? `items[${index}].${found.path}` : `items[${index}]` });

interface Stored {
  id: string;
  url: string;
  excerpt: string;
  via?: unknown;
  lang?: unknown;
  title?: unknown;
  publisher?: unknown;
}

const isStored = (item: unknown): item is Stored =>
  typeof item === 'object' && item !== null && typeof (item as Stored).id === 'string' && typeof (item as Stored).url === 'string' && typeof (item as Stored).excerpt === 'string';

/**
 * The language an item counts as being in, the way the grounding checks read it: null for no tag,
 * a tag that names no language, and a tag that names the lesson's own language.
 */
function languageOf(lang: unknown, lessonLanguage: string): string | null {
  const own = typeof lang === 'string' ? primaryLanguage(lang) : null;
  return own !== null && own === primaryLanguage(lessonLanguage) ? null : own;
}

/**
 * The draft as the per-URL allowance counts it: a passage stored more than once at one address
 * counts once. The validator adds up every stored item of an address, which is the same thing
 * until a passage is stored again with another `via` or `lang`; from then on the copies would eat
 * the allowance of a page from which nothing more had been taken. Returns the draft itself when
 * nothing repeats, which is nearly always.
 */
function distinctPassages(draft: Draft): Draft {
  const seen = new Set<string>();
  const evidence = draft.evidence.filter((item) => {
    if (!isStored(item)) return true;
    const key = `${item.url}\n${canonical(item.excerpt)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return evidence.length === draft.evidence.length ? draft : { ...draft, evidence };
}

const said = (lang: string | null): string => (lang === null ? 'no "lang" (read as the lesson\'s language)' : `"lang": "${lang}"`);

type Resent =
  /** The same item again: answer with its id. `note` when something sent beside it was not taken up. */
  | { kind: 'same'; id: string; note?: Issue }
  /** The same passage said to have come another way or to be in another language: stored as a new item. */
  | { kind: 'again'; evidence: Omit<Evidence, 'id' | 'savedOn'>; urlChars?: { used: number; max: number }; twin: string; note: Issue };

/**
 * What to do with an item whose URL and excerpt are already stored. `first` is the id the validator
 * named; several stored items can hold the passage, so all of them are looked at.
 */
function resent(item: unknown, first: string, draft: Draft, view: Draft): Resent {
  const sent = parseShape(EvidenceInput, item, { what: 'evidence item' }).value;
  const source = sent ? normalizeSourceUrl(sent.url) : null;
  if (!sent || !source || !source.ok) return { kind: 'same', id: first };
  const text = canonical(sent.excerpt);
  const twins = (draft.evidence as unknown[]).filter(isStored).filter((e) => e.url === source.url && canonical(e.excerpt) === text);
  if (twins.length === 0) return { kind: 'same', id: first };

  const language = languageOf(sent.lang, draft.language);
  const sameVia = twins.filter((e) => e.via === sent.via);
  const exact = sameVia.find((e) => languageOf(e.lang, draft.language) === language);
  if (exact) {
    const kept = [sent.title !== exact.title ? 'title' : '', (sent.publisher ?? null) !== (exact.publisher ?? null) ? 'publisher' : ''].filter((name) => name !== '');
    if (kept.length === 0) return { kind: 'same', id: exact.id };
    // The stored words are page text and are not repeated here; get_lesson shows them as data.
    const note = serverIssue('EVIDENCE_NOT_CHANGED', kept[0] as string, `${exact.id} already holds this passage. Its stored ${kept.join(' and ')} ${kept.length === 1 ? 'was' : 'were'} kept, not replaced by what this call sent.`, {
      fix: `Nothing to do if ${exact.id} names the page correctly (get_lesson with "include": ["evidence"] shows it). Stored evidence is never edited: a different ${kept.join(' or ')} can only be stored with a differently cut excerpt, which is a new item.`,
    });
    return { kind: 'same', id: exact.id, note };
  }

  // No "lang" sent says nothing about the language: it is the same item as the stored one, whatever that one says.
  const untold = sent.lang === undefined ? sameVia[0] : undefined;
  if (untold) {
    const stored = languageOf(untold.lang, draft.language);
    const note = serverIssue('EVIDENCE_NOT_CHANGED', 'lang', `${untold.id} already holds this passage, stored with ${said(stored)}. This call sent no "lang", and ${untold.id} was kept as it is.`, {
      fix: `Nothing to do if the passage is in that language. If it is in the lesson's language (${draft.language}), send it again with "lang": "${draft.language}": it is stored as a new item, and you cite the id that call returns.`,
    });
    return { kind: 'same', id: untold.id, note };
  }

  // The stored item nearest to what was sent, so that the answer names one difference where there is one.
  const twin = sameVia[0] ?? twins.find((e) => languageOf(e.lang, draft.language) === language) ?? (twins[0] as Stored);
  const changed = [twin.via !== sent.via ? `"via": "${sent.via}" (${twin.id} has "${show(twin.via)}")` : '', languageOf(twin.lang, draft.language) !== language ? `${said(language)} (${twin.id} has ${said(languageOf(twin.lang, draft.language))})` : ''].filter((part) => part !== '');
  const cannot = (why: string): Resent => ({
    kind: 'same',
    id: twin.id,
    note: serverIssue('EVIDENCE_NOT_CHANGED', '', `${twin.id} already holds this passage and was kept as it is: ${why}`, {
      fix: `Stored evidence is never edited. This call sent ${changed.join(' and ')}; to store that, save a shorter cut of the passage that still contains the fact (a new item), or cite ${twin.id} as it is.`,
    }),
  });
  // The lesson's limits still hold. The validator answered "duplicate" before it reached them, so it
  // is asked again about a draft without the passage: the copy is then accepted exactly when the
  // passage itself would be. The limit on items counts every item, copies included.
  if ((draft.evidence as unknown[]).length >= L.evidencePerLesson) return cannot(`the lesson already stores ${L.evidencePerLesson} items, which is the limit.`);
  const ids = new Set(twins.map((e) => e.id));
  const check = checkEvidence(item, { ...view, evidence: view.evidence.filter((e) => !ids.has((e as { id?: string }).id as string)) });
  if (!check.ok || !check.evidence) return cannot('it could not be stored a second time within the limits of the lesson.');
  // Nothing is stored between here and the caller's push, so this is the id the copy gets.
  const id = nextEvidenceId(draft);
  return {
    kind: 'again',
    evidence: check.evidence,
    urlChars: check.urlChars,
    twin: twin.id,
    note: serverIssue('EVIDENCE_STORED_AGAIN', '', `This passage is already stored as ${twin.id}. It was stored again as ${id}, because this call sent ${changed.join(' and ')}. ${twin.id} is unchanged.`, {
      fix: `Cite ${id} in place of ${twin.id} where the lesson should rest on this version, and submit those scenes again. ${twin.id} stays stored and can be left uncited; the two share one count of uses.`,
    }),
  };
}

export const saveEvidence: Handler = (deps, raw) =>
  lessonCall(deps, raw, {
    tool: 'save_evidence',
    spec: { required: ['lessonId', 'items'] },
    write: true,
    work: (draft, args): Work => {
      const items = readList(args.items);
      if (!items) {
        const errors = [issue('WRONG_TYPE', 'items', '"items" must be an array of evidence items.', { fix: `${ITEM_SHAPE} Nothing was saved from this call.`, got: jsonType(args.items), expected: 'array' })];
        return { errors, outcome: { rejected: errors } };
      }
      if (items.length < 1 || items.length > MAX_ITEMS_PER_CALL) {
        const errors = [
          items.length < 1
            ? issue('TOO_FEW', 'items', '"items" is empty.', { fix: ITEM_SHAPE, got: '0', expected: 'at least 1 item' })
            : issue('TOO_MANY', 'items', `"items" has ${items.length} items; one call takes at most ${MAX_ITEMS_PER_CALL}.`, {
                fix: `Send the first ${MAX_ITEMS_PER_CALL} now and call save_evidence again for the rest. Nothing was saved from this call.`,
                got: String(items.length),
                expected: `at most ${MAX_ITEMS_PER_CALL} items`,
              }),
        ];
        return { errors, outcome: { rejected: errors } };
      }

      const today = localDate(deps.now());
      const errors: Issue[] = [];
      const warnings: Issue[] = [];
      const results: Record<string, unknown>[] = [];
      const refused: number[] = [];
      let saved = 0;
      const store = (index: number, evidence: Omit<Evidence, 'id' | 'savedOn'>, extra: Record<string, unknown>): void => {
        const stored: Evidence = { ...evidence, id: nextEvidenceId(draft), savedOn: today };
        draft.evidence.push(stored);
        saved++;
        results.push({ index, ok: true, id: stored.id, host: stored.host, ...extra });
      };
      items.forEach((item, index) => {
        // Each item is checked against the draft as the items before it left it, so two copies in one call are one item.
        const view = distinctPassages(draft);
        let check = checkEvidence(item, view);
        // The limit on how many items a lesson stores counts every item. Asked about the draft as it is, the validator says so in its own words.
        if (view !== draft && check.ok && check.evidence && draft.evidence.length >= L.evidencePerLesson) check = checkEvidence(item, draft);
        warnings.push(...check.warnings.map((w) => under(index, w)));
        if (check.ok && check.duplicateOf !== undefined) {
          const again = resent(item, check.duplicateOf, draft, view);
          if (again.note) warnings.push(under(index, again.note));
          if (again.kind === 'again') store(index, again.evidence, { sameTextAs: again.twin, ...(again.urlChars ? { urlChars: again.urlChars } : {}) });
          else results.push({ index, ok: true, id: again.id, duplicate: true, ...(check.urlChars ? { urlChars: check.urlChars } : {}) });
        } else if (check.ok && check.evidence) {
          store(index, check.evidence, check.urlChars ? { urlChars: check.urlChars } : {});
        } else {
          errors.push(...check.errors.map((e) => under(index, e)));
          refused.push(index);
          // A refused item stores nothing: the count is what the address holds as it is.
          results.push({ index, ok: false, codes: [...new Set(check.errors.map((e) => e.code))], ...(check.urlChars ? { urlChars: check.urlChars } : {}) });
        }
      });

      return {
        errors,
        warnings,
        changed: saved > 0,
        outcome: errors.length > 0 ? { rejected: errors, evidence: { saved, refused } } : {},
        payload: {
          items: results,
          saved,
          rejected: refused.length,
          stored: { count: draft.evidence.length, mustCite: DEPTHS[draft.depth].evidenceMin, canStore: L.evidencePerLesson },
        },
      };
    },
  });
