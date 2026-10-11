// Sources: the numbered chips that end a claim, the popover each chip opens, and the dialog that
// lists everything with the receipt.
//
// What the learner is shown is deliberately the same in both places: the host we computed from the
// address (first, and largest), then the title and publisher the agent gave, when and how the
// excerpt was saved, the excerpt itself, and a link that opens the real page at that passage. The
// player never claims more than that. In particular it never uses the word that would suggest the
// excerpt was confirmed against the page.
//
// The title and the publisher are the two lines of a card that nothing has checked: the agent
// copied them from a page, or wrote them. They sit under a line that says so, because without it
// they read as the card's own description of the source, whatever words they hold.
import type { LessonV2 as Lesson } from '../core/clip';
import type { Evidence } from '../core/schema';
import type { Receipt } from '../core/types';
import { type Attrs, EMPTY, type Html, attrs, html, internalId, pageId, sourceLink } from './escape';

/** The evidence a lesson cites, with the number each item is shown under. */
export interface SourceBook {
  readonly list: readonly Evidence[];
  /** 1-based position in the lesson's source list, or undefined for an id the lesson does not carry. */
  number(evidenceId: string): number | undefined;
  get(evidenceId: string): Evidence | undefined;
}

export function sourceBook(lesson: Lesson): SourceBook {
  const byId = new Map<string, { n: number; evidence: Evidence }>();
  lesson.evidence.forEach((evidence, i) => {
    if (!byId.has(evidence.id)) byId.set(evidence.id, { n: i + 1, evidence });
  });
  return {
    list: lesson.evidence,
    number: (id) => byId.get(id)?.n,
    get: (id) => byId.get(id)?.evidence,
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-10-10" as "10 October 2026". Written out by hand so the same lesson renders the same bytes on every machine. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month) return iso;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** The host a source link really goes to. Falls back to the stored field only when the address cannot be parsed. */
export function sourceHost(evidence: Evidence): string {
  return sourceLink(evidence)?.host ?? evidence.host;
}

function savedLine(evidence: Evidence): string {
  const how = evidence.via === 'search_snippet' ? ', from a search result snippet' : evidence.via === 'learner' ? ', from material you gave it' : '';
  return `Excerpt saved by your agent on ${formatDate(evidence.savedOn)}${how}.`;
}

export const WEAK_MATCH_LINE = 'Few words in common with this excerpt. Check the source.';

/** The line above a source's title and publisher. */
export function givenLabel(hasPublisher: boolean): string {
  return hasPublisher ? 'Title and publisher, as given by your agent' : 'Title, as given by your agent';
}

export const KNOWN_LIMIT =
  'Learning Tool checks that every claim points to an excerpt your agent saved and that the two share wording; it cannot tell whether an excerpt is genuine or whether it supports the claim, so open the source when it matters.';

interface CardOptions {
  headingId: string;
  number: number;
  weak: boolean;
  ui: Attrs;
  /** The lesson's language, for an excerpt that names none of its own. */
  language: string;
}

/** Everything shown about one source. Used by the popover and by the sources dialog. */
function sourceCard(evidence: Evidence, o: CardOptions): Html {
  const link = sourceLink(evidence, o.language);
  // The host comes from the address the link really goes to, not from the stored field, so the two can never disagree.
  const host = link?.host ?? evidence.host;
  return html`<p class="lt-source-kicker"${o.ui}>Source ${o.number}</p><h3 class="lt-source-host" id="${o.headingId}">${host}</h3><p class="lt-source-given"${o.ui}>${givenLabel(
    Boolean(evidence.publisher),
  )}</p><p class="lt-source-title">${evidence.title}</p>${evidence.publisher ? html`<p class="lt-source-pub">${evidence.publisher}</p>` : null}<p class="lt-source-saved"${o.ui}>${savedLine(evidence)}</p><blockquote class="lt-source-excerpt"${attrs({ lang: evidence.lang })}><p>${evidence.excerpt}</p></blockquote>${
    o.weak ? html`<p class="lt-source-weak"${o.ui}>${WEAK_MATCH_LINE}</p>` : null
  }${
    link
      ? html`<p class="lt-source-open"${o.ui}><a href="${link.url}" target="_blank" rel="noopener noreferrer">Open the source at this passage<span class="lt-vh"> (opens in a new tab)</span><span class="lt-out" aria-hidden="true"> ↗</span></a></p><p class="lt-source-url">${link.shown}</p>`
      : html`<p class="lt-source-open"${o.ui}>This address cannot be opened from here.</p><p class="lt-source-url">${evidence.url}</p>`
  }`;
}

export interface CiteOptions {
  /** Where the citing item sits in its scene, as the validator writes it: "blocks[1]", "steps[2].blocks[0]", "takeaways[0]". Decides whether the weak-match line is shown. */
  path?: string;
}

export interface Cited {
  /** The numbered buttons, to place at the end of the sentence they support. Phrasing content. */
  chips: Html;
  /** The popovers the buttons open, to place directly after the paragraph. Flow content. */
  popovers: Html;
}

export interface CiteEnv {
  book: SourceBook;
  sceneId: string;
  /** "<sceneId>/<path>" for every claim the receipt lists as a weak match. */
  weak: ReadonlySet<string>;
  ui: Attrs;
  /** The lesson's language. */
  language: string;
  /** A fresh number for each popover in the scene, so ids never repeat. */
  nextPopover(): number;
}

/**
 * Chips and popovers for a list of evidence ids. An id the lesson does not carry is left out: a
 * chip that opens nothing would be worse than no chip, and validation has already refused it.
 */
export function renderCites(env: CiteEnv, ids: readonly string[], opts: CiteOptions = {}): Cited {
  const chips: Html[] = [];
  const popovers: Html[] = [];
  const weak = opts.path !== undefined && env.weak.has(`${env.sceneId}/${opts.path}`);
  const seen = new Set<string>();
  for (const id of ids) {
    const evidence = env.book.get(id);
    const number = env.book.number(id);
    if (!evidence || number === undefined || seen.has(id)) continue;
    seen.add(id);
    const k = env.nextPopover();
    const popoverId = internalId(env.sceneId, `src${k}`);
    const headingId = internalId(env.sceneId, `src${k}-h`);
    const host = sourceHost(evidence);
    chips.push(
      html`<button type="button" class="lt-chip" popovertarget="${popoverId}" aria-label="Source ${number}: ${host}"><span aria-hidden="true">${number}</span></button>`,
    );
    popovers.push(
      html`<div popover id="${popoverId}" class="lt-source" role="group" aria-labelledby="${headingId}">${sourceCard(evidence, { headingId, number, weak, ui: env.ui, language: env.language })}<p class="lt-source-actions"${env.ui}><button type="button" class="lt-btn lt-btn-quiet" popovertarget="${popoverId}" popovertargetaction="hide">Close</button></p></div>`,
    );
  }
  if (chips.length === 0) return { chips: EMPTY, popovers: EMPTY };
  return { chips: html`<span class="lt-cites">${chips}</span>`, popovers: html`${popovers}` };
}

function count(n: unknown, one: string, many: string): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  return `${v} ${v === 1 ? one : many}`;
}

function receiptSection(receipt: Receipt, ui: Attrs): Html {
  const s = receipt.stats;
  const warnings = Object.keys(receipt.warnings)
    .sort()
    .map((code) => ({ code, n: receipt.warnings[code] }));
  const counted = [
    count(s.scenes, 'scene', 'scenes'),
    count(s.words, 'word', 'words'),
    count(s.claims, 'claim', 'claims'),
    count(s.quotes, 'quotation', 'quotations'),
    `${count(s.sources, 'source', 'sources')} from ${count(s.hosts, 'site', 'sites')}`,
    count(s.checkpoints, 'checkpoint', 'checkpoints'),
    count(s.figures, 'figure', 'figures'),
  ].join(', ');
  const weak = receipt.weakClaims.length;
  return html`<section class="lt-receipt" aria-labelledby="${pageId('receipt')}"${ui}><h3 id="${pageId('receipt')}">What was checked</h3><dl class="lt-receipt-list"><dt>Checked on</dt><dd>${formatDate(
    receipt.validatedOn,
  )}, by Learning Tool ${receipt.version}, rules version ${receipt.rules}</dd><dt>Counted</dt><dd>${counted}</dd><dt>Warnings</dt><dd>${
    warnings.length === 0
      ? 'None'
      : html`<ul class="lt-receipt-warnings">${warnings.map((w) => html`<li><code>${w.code}</code> ${count(w.n, 'time', 'times')}</li>`)}</ul>`
  }</dd>${
    weak > 0
      ? html`<dt>Loose matches</dt><dd>${count(weak, 'claim shares', 'claims share')} few words with the excerpt cited for it. The source card for that claim says so.</dd>`
      : null
  }<dt>Lesson fingerprint</dt><dd><code class="lt-hash">${receipt.hash}</code></dd></dl></section>`;
}

/**
 * The dialog that lists every source. It is ordinary content inside a `<dialog>`: with scripting
 * off, and in print, the stylesheet shows it in the page flow as the last section.
 */
export function renderSourcesDialog(lesson: Lesson, receipt: Receipt, ui: Attrs): Html {
  const title = pageId('sourcestitle');
  const items = lesson.evidence.map((evidence, i) => {
    const headingId = pageId('source', i + 1);
    return html`<li class="lt-source-item">${sourceCard(evidence, { headingId, number: i + 1, weak: false, ui, language: lesson.language })}</li>`;
  });
  return html`<dialog id="${pageId('sources')}" class="lt-sources" aria-labelledby="${title}"><div class="lt-sources-inner"><div class="lt-sources-head"><h2 id="${title}"${ui}>Sources</h2><form method="dialog" class="lt-sources-close"${ui}><button type="submit" class="lt-btn lt-btn-quiet">Close</button></form></div><p class="lt-sources-limit"${ui}>${KNOWN_LIMIT}</p><ol class="lt-source-list">${items}</ol>${receiptSection(
    receipt,
    ui,
  )}</div></dialog>`;
}

/** The control in the header that opens the dialog. Hidden until the script is there to open it. */
export function renderSourcesButton(lesson: Lesson, ui: Attrs): Html {
  return html`<button type="button" class="lt-tool" id="${pageId('opensources')}" aria-haspopup="dialog" hidden${ui}>Sources <span class="lt-tool-count">${lesson.evidence.length}</span></button>`;
}
