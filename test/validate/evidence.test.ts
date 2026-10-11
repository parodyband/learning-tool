// checkEvidence: an ordinary public web address is accepted in whatever form a browser shows it,
// and nothing else is. The server never fetches a source, so these rules are about what a learner
// can open, and about a lesson not turning into a copy of one page.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_EVIDENCE } from '../../src/core/examples';
import { LIMITS as L } from '../../src/core/limits';
import { Evidence } from '../../src/core/schema';
import { checkEvidence, normalizeSourceUrl } from '../../src/core/validate';
import { errorCodes, exampleDraft, expectActionable, newDraft, saveEvidence } from './helpers';

const EXCERPT = 'Binary search finds a target value in a sorted array by comparing it with the middle element.';
const item = (url: string, extra: Record<string, unknown> = {}) => ({ url, title: 'A page about searching', excerpt: EXCERPT, via: 'page', ...extra });

describe('source addresses that are accepted', () => {
  it.each([
    ['a plain https page', 'https://en.wikipedia.org/wiki/Binary_search', 'https://en.wikipedia.org/wiki/Binary_search', 'en.wikipedia.org'],
    ['http', 'http://example.org/page', 'http://example.org/page', 'example.org'],
    ['a fragment, dropped without comment', 'https://docs.python.org/3/library/bisect.html#bisect.bisect_left', 'https://docs.python.org/3/library/bisect.html', 'docs.python.org'],
    ['a text fragment', 'https://example.org/a#:~:text=binary%20search', 'https://example.org/a', 'example.org'],
    ['a query string', 'https://example.org/search?q=binary+search&page=2', 'https://example.org/search?q=binary+search&page=2', 'example.org'],
    ['an upper-case host', 'https://EN.Wikipedia.ORG/wiki/Binary_search', 'https://en.wikipedia.org/wiki/Binary_search', 'en.wikipedia.org'],
    ['the default https port written out', 'https://example.org:443/a', 'https://example.org/a', 'example.org'],
    ['the default http port written out', 'http://example.org:80/a', 'http://example.org/a', 'example.org'],
    ['an internationalised host', 'https://bücher.example/suche', 'https://xn--bcher-kva.example/suche', 'xn--bcher-kva.example'],
    ['non-ASCII letters in the path', 'https://de.wikipedia.org/wiki/Binäre_Suche', 'https://de.wikipedia.org/wiki/Bin%C3%A4re_Suche', 'de.wikipedia.org'],
    ['a host only', 'https://example.org', 'https://example.org/', 'example.org'],
    ['a trailing dot on the host', 'https://example.org./a', 'https://example.org./a', 'example.org'],
    ['a deep subdomain', 'https://a.b.c.example.co.uk/x', 'https://a.b.c.example.co.uk/x', 'a.b.c.example.co.uk'],
    ['a PDF', 'https://example.org/papers/search.pdf', 'https://example.org/papers/search.pdf', 'example.org'],
    ['a host that merely contains "local"', 'https://localnews.example.org/a', 'https://localnews.example.org/a', 'localnews.example.org'],
    ['a host that starts with digits', 'https://3blue1brown.example.com/lessons', 'https://3blue1brown.example.com/lessons', '3blue1brown.example.com'],
  ])('%s', (_what, url, stored, host) => {
    const check = checkEvidence(item(url), newDraft());
    expect(check.errors).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.evidence).toMatchObject({ url: stored, host, excerpt: EXCERPT, via: 'page' });
    expect(normalizeSourceUrl(url)).toEqual({ ok: true, url: stored, host });
    // With an id and a date it is a valid stored item.
    expect(Evidence.safeParse({ ...check.evidence, id: 'e1', savedOn: '2026-10-10' }).success).toBe(true);
  });

  it('keeps the optional fields that were sent and adds none', () => {
    const plain = checkEvidence(item('https://example.org/a'), newDraft()).evidence!;
    expect(Object.keys(plain).sort()).toEqual(['excerpt', 'host', 'title', 'url', 'via']);
    const full = checkEvidence(item('https://example.org/a', { publisher: 'Example Press', lang: 'de', via: 'search_snippet' }), newDraft()).evidence!;
    expect(full).toMatchObject({ publisher: 'Example Press', lang: 'de', via: 'search_snippet' });
  });

  it('stores the excerpt as it will be shown: sanitised, never reworded', () => {
    const check = checkEvidence(item('https://example.org/a', { excerpt: `  Binary\u00a0search “halves”\u200b the  interval\n— every time, without exception.  ` }), newDraft());
    expect(check.evidence!.excerpt).toBe('Binary search “halves” the interval — every time, without exception.');
  });
});

describe('source addresses that are refused', () => {
  it.each([
    ['no scheme', 'example.org/page', 'starting with "https://"'],
    ['a bare word', 'wikipedia', 'starting with "https://"'],
    ['a file', 'file:///Users/me/notes.txt', 'public https address'],
    ['a data URL', 'data:text/plain,Binary%20search', 'public https address'],
    ['javascript', 'javascript:alert(document.cookie)', 'public https address'],
    ['ftp', 'ftp://example.org/file.txt', 'public https address'],
    ['a username', 'https://reader@example.org/page', 'Remove the credentials'],
    ['a username and password', 'https://reader:secret@example.org/page', 'Remove the credentials'],
    ['an IPv4 address', 'http://93.184.216.34/page', 'public web'],
    ['a private IPv4 address', 'http://192.168.1.10/page', 'public web'],
    ['the loopback address', 'http://127.0.0.1:8080/page', 'public web'],
    ['an IPv4 address written as one number', 'http://2130706433/page', 'public web'],
    ['an IPv4 address written in hex', 'http://0x7f.0.0.1/page', 'public web'],
    ['an IPv6 address', 'http://[::1]/page', 'public web'],
    ['an IPv6 address with an embedded IPv4 one', 'http://[::ffff:192.168.0.1]/page', 'public web'],
    ['localhost', 'http://localhost/page', 'public web'],
    ['localhost in capitals with a trailing dot', 'http://LOCALHOST./page', 'public web'],
    ['a name under .localhost', 'http://app.localhost/page', 'public web'],
    ['a name under .local', 'http://printer.local/status', 'public web'],
    ['a name under .internal', 'https://wiki.corp.internal/page', 'public web'],
    ['a name under .lan', 'http://nas.lan/page', 'public web'],
    ['a name under .home', 'http://router.home/page', 'public web'],
    ['a single-label host', 'http://intranet/page', 'public web'],
    ['another port', 'https://example.org:8443/page', 'default port'],
    ['the https port on http', 'http://example.org:443/page', 'default port'],
    ['a query string that is too long', `https://example.org/page?${'utm_source=newsletter&'.repeat(10)}`, 'tracking'],
    ['slashes where the host should be', 'https:///page', 'public web'],
  ])('%s', (_what, url, fix) => {
    const check = checkEvidence(item(url), newDraft());
    expect(errorCodes(check)).toEqual(['EVIDENCE_URL']);
    expect(check.ok).toBe(false);
    expect(check.evidence).toBeUndefined();
    expect(check.errors[0]!.path).toBe('url');
    expect(check.errors[0]!.fix).toContain(fix);
    expectActionable(check.errors);
    expect(normalizeSourceUrl(url).ok).toBe(false);
  });

  it('the query limit is exactly the one in limits.ts', () => {
    const at = (n: number) => checkEvidence(item(`https://example.org/p?${'q'.repeat(n)}`), newDraft());
    expect(at(L.urlQueryChars).ok).toBe(true);
    const over = at(L.urlQueryChars + 1);
    expect(errorCodes(over)).toEqual(['EVIDENCE_URL']);
    expect(over.errors[0]).toMatchObject({ got: String(L.urlQueryChars + 1) });
  });

  it('an address that grows past the limit once written in standard form is refused then, not later', () => {
    const url = `https://example.org/${'ä'.repeat(200)}`;
    expect(url.length).toBeLessThan(L.urlChars);
    const check = checkEvidence(item(url), newDraft());
    expect(errorCodes(check)).toEqual(['TOO_LONG']);
    expect(check.errors[0]!.path).toBe('url');
  });
});

describe('the shape of an evidence item', () => {
  const draft = newDraft();
  it.each([
    ['no via', (e: any) => delete e.via, 'MISSING_FIELD', 'via', 'one of "page", "search_snippet", "learner"'],
    ['an unknown via', (e: any) => (e.via = 'web'), 'BAD_VALUE', 'via', '"page", "search_snippet", "learner"'],
    ['a via that is a near miss', (e: any) => (e.via = 'snippet'), 'BAD_VALUE', 'via', 'Use one of: "page", "search_snippet", "learner".'],
    ['an excerpt that is too short', (e: any) => (e.excerpt = 'Binary search is fast.'), 'TOO_SHORT', 'excerpt', 'Write at least 40 characters.'],
    ['an excerpt that is too long', (e: any) => (e.excerpt = 'word '.repeat(170)), 'TOO_LONG', 'excerpt', 'Shorten it by at least 49 characters.'],
    ['no excerpt', (e: any) => delete e.excerpt, 'MISSING_FIELD', 'excerpt', 'a string of 40 to 800 characters'],
    ['no title', (e: any) => delete e.title, 'MISSING_FIELD', 'title', 'a string of 1 to 200 characters'],
    ['a language written out', (e: any) => (e.lang = 'German'), 'BAD_VALUE', 'lang', 'BCP 47'],
    ['"text" for the excerpt', (e: any) => ((e.text = e.excerpt), delete e.excerpt), 'UNKNOWN_FIELD', 'text', 'Valid fields here: url, title, publisher, excerpt, via, lang.'],
    ['"source" for the url', (e: any) => ((e.source = e.url), delete e.url), 'UNKNOWN_FIELD', 'source', 'Valid fields here'],
    ['an id chosen by the agent', (e: any) => (e.id = 'e7'), 'UNKNOWN_FIELD', 'id', 'Remove "id".'],
    ['a host chosen by the agent', (e: any) => (e.host = 'nature.com'), 'UNKNOWN_FIELD', 'host', 'Remove "host".'],
  ])('%s', (_what, edit, code, path, fix) => {
    const e: any = item('https://example.org/a');
    edit(e);
    const check = checkEvidence(e, draft);
    expect(check.ok).toBe(false);
    const found = check.errors.find((i) => i.code === code && i.path === path);
    expect(found, JSON.stringify(check.errors.map((i) => [i.code, i.path]))).toBeDefined();
    expect(`${found!.fix} ${found!.expected ?? ''}`).toContain(fix);
    expectActionable(check.errors);
  });

  it('an excerpt is measured after stray white space and invisible characters are removed', () => {
    const padded = `${' '.repeat(30)}Too short.${'\u200b'.repeat(30)}`;
    expect(padded.length).toBeGreaterThan(L.excerptChars.min);
    const check = checkEvidence(item('https://example.org/a', { excerpt: padded }), draft);
    expect(errorCodes(check)).toEqual(['TOO_SHORT']);
    expect(check.errors[0]).toMatchObject({ got: '10' });
  });

  it('ten items sent at once are not one item', () => {
    const check = checkEvidence([item('https://example.org/a'), item('https://example.org/b')], draft);
    expect(errorCodes(check)).toEqual(['WRONG_TYPE']);
    expect(check.errors[0]!.fix).toBe('Send one evidence item per call, as an object and not inside an array.');
  });
});

describe('what is already stored', () => {
  it('the same passage of the same page is answered with the id it already has', () => {
    const draft = exampleDraft();
    const same = checkEvidence(EXAMPLE_EVIDENCE[2], draft);
    // A repeat stores nothing, so the count for its address is what was already there.
    expect(same).toEqual({ ok: true, duplicateOf: 'e3', urlChars: { used: EXAMPLE_EVIDENCE[2]!.excerpt.length, max: L.excerptCharsPerUrl }, errors: [], warnings: [] });
    // The same page reached with a fragment, the same words with other punctuation and spacing.
    const variant = checkEvidence({ ...EXAMPLE_EVIDENCE[2], url: `${EXAMPLE_EVIDENCE[2]!.url}#when`, title: 'Another title', excerpt: `  ${EXAMPLE_EVIDENCE[2]!.excerpt.toUpperCase().replace(/ /g, '  ')}` }, draft);
    expect(variant.duplicateOf).toBe('e3');
    expect(variant.evidence).toBeUndefined();
    expect(draft.evidence).toHaveLength(5);
  });

  it('another passage of the same page, or the same words on another page, is new evidence', () => {
    const draft = exampleDraft();
    const other = checkEvidence({ ...EXAMPLE_EVIDENCE[2], excerpt: 'Sorting first costs time, so binary search pays off only when the data is searched many times.' }, draft);
    expect(other.duplicateOf).toBeUndefined();
    expect(other.ok).toBe(true);
    const elsewhere = checkEvidence({ ...EXAMPLE_EVIDENCE[2], url: 'https://example.com/notes/mirror' }, draft);
    expect(elsewhere.duplicateOf).toBeUndefined();
    expect(elsewhere.ok).toBe(true);
  });

  it('a lesson holds at most 40 items, and a repeat is still answered when it is full', () => {
    const draft = newDraft();
    for (let i = 0; i < L.evidencePerLesson; i++) saveEvidence(draft, item(`https://example.org/page-${i}`, { excerpt: `${EXCERPT} This is passage number ${i} of the collection.` }));
    expect(draft.evidence).toHaveLength(40);
    const more = checkEvidence(item('https://example.org/one-more'), draft);
    expect(errorCodes(more)).toEqual(['EVIDENCE_LIMIT']);
    expect(more.errors[0]!.fix).toContain('e1 to e40');
    const repeat = checkEvidence(item('https://example.org/page-7', { excerpt: `${EXCERPT} This is passage number 7 of the collection.` }), draft);
    expect(repeat).toMatchObject({ ok: true, duplicateOf: 'e8', errors: [], warnings: [] });
    expect(repeat.evidence).toBeUndefined();
  });

  it('at most 2000 characters may be excerpted from one address', () => {
    const draft = newDraft();
    const passage = (n: number, length: number) => item('https://example.org/long-read', { excerpt: `Passage ${'abcdefgh'[n]} of the long read. ${'x'.repeat(length)}`.slice(0, length) });
    saveEvidence(draft, passage(0, 800));
    saveEvidence(draft, passage(1, 800));
    // Exactly up to the limit is fine.
    expect(checkEvidence(passage(2, 400), draft).ok).toBe(true);
    const over = checkEvidence(passage(2, 401), draft);
    expect(errorCodes(over)).toEqual(['EVIDENCE_URL_QUOTA']);
    expect(over.errors[0]).toMatchObject({ path: 'excerpt', got: '2001', expected: 'at most 2000 characters per URL' });
    expect(over.errors[0]!.message).toContain('already total 1600 characters (e1, e2)');
    expect(over.errors[0]!.fix).toContain('at most 400 characters');
    // The same amount from another page is not held against this one.
    expect(checkEvidence({ ...passage(2, 800), url: 'https://example.org/another-read' }, draft).ok).toBe(true);

    saveEvidence(draft, passage(2, 400));
    const full = checkEvidence(passage(3, 100), draft);
    expect(full.errors[0]!.fix).toContain('Nothing more can be saved from this page');
  });

  it('checking never changes the draft', () => {
    const draft = exampleDraft();
    const before = JSON.stringify(draft);
    checkEvidence(item('https://example.org/new'), draft);
    checkEvidence(item('nonsense'), draft);
    expect(JSON.stringify(draft)).toBe(before);
  });
});
