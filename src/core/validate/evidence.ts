// checkEvidence: one item for save_evidence. The server never fetches the URL, so what is checked
// here is only that the address is an ordinary public web page and that the lesson is not turning
// into a copy of it.
import { capIssues, issue } from '../issues';
import { LIMITS as L } from '../limits';
import { EvidenceInput, type Evidence } from '../schema';
import { canonical } from '../text';
import type { Draft, EvidenceCheck, Issue } from '../types';
import { byEvidenceId, usableEvidence } from './context';
import { idList, parseShape, show } from './shape';

/** Names that resolve only inside a private network, or on the machine itself. */
const PRIVATE_SUFFIXES = ['.local', '.internal', '.lan', '.home', '.localhost'];

export type SourceUrl = { ok: true; url: string; host: string } | { ok: false; message: string; fix: string; got?: string };

/**
 * The rules for a source address, and its normal form: parsed by the WHATWG URL parser, without
 * the fragment. `host` is the ASCII (punycode) hostname the parser produced.
 */
export function normalizeSourceUrl(raw: string): SourceUrl {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    const bare = !raw.includes('://');
    return {
      ok: false,
      message: 'The url is not an absolute web address.',
      fix: bare ? 'Send the full address of the page, starting with "https://".' : 'Send the address of the page exactly as the browser shows it.',
    };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    const scheme = show(u.protocol.replace(/:$/, ''));
    return {
      ok: false,
      message: `The url uses the scheme "${scheme}"; only http and https pages can be evidence.`,
      fix: "Use the page's public https address. A file, a data URL or an app link cannot be evidence.",
      got: scheme,
    };
  }
  if (u.username !== '' || u.password !== '') {
    return { ok: false, message: 'The url contains a username or password.', fix: 'Remove the credentials (the part before "@"). If the page cannot be read without them, it cannot be evidence.' };
  }
  let host = u.hostname;
  while (host.endsWith('.')) host = host.slice(0, -1);
  const got = show(host);
  const local = 'A learner must be able to open the source: use a page on the public web.';
  if (host === '' || host.length > 255) return { ok: false, message: 'The url has no usable host name.', fix: 'Send the address of the page exactly as the browser shows it.' };
  // The parser writes every numeric host as dotted decimal and every IPv6 host in brackets.
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return { ok: false, message: 'The host of the url is an IP address.', fix: local, got };
  if (host === 'localhost' || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, message: `The host "${got}" is a local or private name.`, fix: local, got };
  if (!host.includes('.')) return { ok: false, message: `The host "${got}" is a single-label name, which only resolves inside a private network.`, fix: local, got };
  if (u.port !== '') return { ok: false, message: `The url names port ${u.port}.`, fix: 'Use the address on the default port. A page served on another port is usually not a public source.', got: u.port };
  const query = u.search.startsWith('?') ? u.search.length - 1 : u.search.length;
  if (query > L.urlQueryChars) {
    return {
      ok: false,
      message: `The query string of the url is ${query} characters; the limit is ${L.urlQueryChars}.`,
      fix: 'Remove tracking and session parameters and keep only what the page needs.',
      got: String(query),
    };
  }
  // A fragment names a place in the page, not another page. It is dropped without comment, and so
  // is a "?" with nothing after it: "page?" is the same address as "page", not a second source.
  // (`search` reads as empty for both; assigning it is what takes the bare "?" out of `href`.)
  u.hash = '';
  if (u.search === '') u.search = '';
  return { ok: true, url: u.href, host };
}

/** Check one evidence item against the format, the URL rules and the lesson's limits. */
export function checkEvidence(input: unknown, draft: Draft): EvidenceCheck {
  const shape = parseShape(EvidenceInput, input, { what: 'evidence item' });
  if (!shape.value) return { ok: false, errors: capIssues(shape.issues, 'error'), warnings: [] };
  const item = shape.value;
  const errors: Issue[] = [];
  const stored = usableEvidence(draft);

  const source = normalizeSourceUrl(item.url);
  if (!source.ok) {
    errors.push(issue('EVIDENCE_URL', 'url', source.message, { fix: source.fix, ...(source.got !== undefined ? { got: source.got } : {}) }));
    return { ok: false, errors, warnings: [] };
  }
  if (source.url.length > L.urlChars) {
    errors.push(
      issue('TOO_LONG', 'url', `The url is ${source.url.length} characters once it is written in standard form; the limit is ${L.urlChars}.`, {
        fix: 'Use a shorter address for the same page, without tracking parameters.',
        got: String(source.url.length),
        expected: `at most ${L.urlChars} characters`,
      }),
    );
    return { ok: false, errors, warnings: [] };
  }

  // What is stored from this address already, and what the agent has left of the per-URL allowance.
  const fromUrl = stored.filter((e) => e.url === source.url);
  const used = fromUrl.reduce((sum, e) => sum + e.excerpt.length, 0);
  const max = L.excerptCharsPerUrl;

  // A repeat of something already stored is answered with its id, even when the lesson is full.
  const excerptForm = canonical(item.excerpt);
  const same = fromUrl.find((e) => canonical(e.excerpt) === excerptForm);
  if (same) return { ok: true, duplicateOf: same.id, urlChars: { used, max }, errors: [], warnings: [] };

  if (stored.length >= L.evidencePerLesson) {
    errors.push(
      issue('EVIDENCE_LIMIT', '', `The lesson already stores ${stored.length} evidence items, which is the limit.`, {
        fix: `Cite from the ${stored.length} stored items (${idList(stored.map((e) => e.id).sort(byEvidenceId))}). Evidence cannot be removed.`,
        got: String(stored.length),
        expected: `at most ${L.evidencePerLesson} items`,
      }),
    );
  }

  if (used + item.excerpt.length > max) {
    const room = max - used;
    const fix =
      room >= L.excerptChars.min
        ? `Save a passage of at most ${room} characters from this page, or use another source for the rest.`
        : 'Nothing more can be saved from this page. Cite what is stored from it, or use another source.';
    errors.push(
      issue(
        'EVIDENCE_URL_QUOTA',
        'excerpt',
        `Excerpts from this URL already total ${used} characters (${idList(fromUrl.map((e) => e.id))}); with this one (${item.excerpt.length}) they would exceed the limit of ${max} per URL.`,
        { fix, got: String(used + item.excerpt.length), expected: `at most ${max} characters per URL` },
      ),
    );
  }
  // A refused item stores nothing, so the count it reports is what the address holds as it is.
  if (errors.length > 0) return { ok: false, urlChars: { used, max }, errors, warnings: [] };

  const evidence: Omit<Evidence, 'id' | 'savedOn'> = { url: source.url, title: item.title, excerpt: item.excerpt, via: item.via, host: source.host };
  if (item.publisher !== undefined) evidence.publisher = item.publisher;
  if (item.lang !== undefined) evidence.lang = item.lang;
  return { ok: true, evidence, urlChars: { used: used + item.excerpt.length, max }, errors: [], warnings: [] };
}
