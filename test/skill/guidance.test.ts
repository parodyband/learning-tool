// What four trial agents hesitated over, guessed at or worked around while following the skill,
// kept as statements the guidance must go on making. Each entry says what happened in the trial,
// so that a later rewrite knows why the sentence is there before it removes it.
//
// Two kinds of check. Where the guidance states something the code decides (how the server treats
// whitespace, what counts as a use of an excerpt, how the passage link is built), the statement is
// tested against the code. Where it is advice only a reader can follow (which route to try first,
// what to do with a search digest), the test can only hold the advice in place, in its section.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_QUESTIONS } from '../../src/core/examples';
import { LIMITS as L } from '../../src/core/limits';
import { sanitizeInput } from '../../src/core/text';
import type { Draft, EvidenceCheck, LessonReport } from '../../src/core/types';
import { exampleDraft } from '../helpers/example';
import { exampleClipDraft } from './drafts';
import { markedExamples, read, REF_DIR, ROOT, SKILL_MD } from './helpers';

const SOURCING = path.join(REF_DIR, 'sourcing.md');
const CALIBRATION = path.join(REF_DIR, 'calibration.md');

const squash = (s: string): string => s.replace(/\s+/g, ' ');

/** The text under one `##` or `###` heading, up to the next heading of the same or a higher level, on one line. */
function section(file: string, heading: string): string {
  const lines = read(file).split('\n');
  const start = lines.findIndex((line) => /^#{2,3} /.test(line) && line.replace(/^#+\s+/, '').trim() === heading);
  if (start === -1) throw new Error(`${path.basename(file)} has no section "${heading}"`);
  const level = /^#+/.exec(lines[start]!)![0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+) /.exec(lines[i]!);
    if (m && m[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return squash(lines.slice(start + 1, end).join('\n'));
}

/** The one paragraph, list item or table row under `heading` that matches `marker`, so that two rules cannot satisfy one check between them. */
function passage(file: string, heading: string, marker: RegExp): string {
  const lines = read(file).split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let inside = false;
  for (const line of lines) {
    const h = /^#{2,3}\s+(.*?)\s*$/.exec(line);
    if (h) {
      if (inside) break;
      inside = h[1] === heading;
      continue;
    }
    if (!inside) continue;
    const startsItem = /^\s*(?:[-*]|\d+\.)\s/.test(line) || /^\|/.test(line);
    if (line.trim() === '' || startsItem) {
      if (current.length) chunks.push(squash(current.join(' ')));
      current = [];
    }
    if (line.trim() !== '') current.push(line.trim());
  }
  if (current.length) chunks.push(squash(current.join(' ')));
  const found = chunks.find((c) => marker.test(c));
  if (!found) throw new Error(`${path.basename(file)} "${heading}" has no paragraph matching ${marker}`);
  return found;
}

/** A module of another area, or null while it does not exist. */
const load = async (module: string): Promise<Record<string, unknown> | null> =>
  (await import(/* @vite-ignore */ path.join(ROOT, module)).catch(() => null)) as Record<string, unknown> | null;

type Statement = [what: string, pattern: RegExp];

/** Sections are read inside each test, so a heading that has gone missing fails the tests about it and no others. */
function holds(file: string, heading: string, statements: Statement[]): void {
  it.each(statements)('%s', (_what, pattern) => {
    expect(section(file, heading)).toMatch(pattern);
  });
}

// ---------------------------------------------------------------------------------------------
// The files stay the size they were. The trial agents read about 1,600 lines before their first
// scene; a finding is answered by replacing what did not work, not by adding beside it. The sizes
// are those of the three files as the trial agents read them. SKILL.md was rewritten for clips
// (version 2) and is held to the same size: the new format replaced the old text, it was not
// added beside it.
// ---------------------------------------------------------------------------------------------

describe('the guidance is no longer than it was before the trials', () => {
  const before: Array<[string, string, { lines: number; chars: number }]> = [
    ['SKILL.md', SKILL_MD, { lines: 220, chars: 14_437 }],
    ['sourcing.md', SOURCING, { lines: 276, chars: 17_711 }],
    ['calibration.md', CALIBRATION, { lines: 226, chars: 13_652 }],
  ];
  it.each(before)('%s', (_name, file, was) => {
    const text = read(file);
    expect(text.trimEnd().split('\n').length, 'lines').toBeLessThanOrEqual(was.lines);
    expect(text.length, 'characters').toBeLessThanOrEqual(was.chars);
  });
});

// ---------------------------------------------------------------------------------------------
// sourcing.md: getting the page's own words
// ---------------------------------------------------------------------------------------------

describe('sourcing.md, getting real page text', () => {
  const heading = 'Getting real page text';
  const routes = (): { text: string; one: string; two: string; three: string; at: number[] } => {
    const text = section(SOURCING, heading);
    const at = ['**1. ', '**2. ', '**3. '].map((m) => text.indexOf(m));
    return { text, at, one: text.slice(at[0], at[1]), two: text.slice(at[1], at[2]), three: text.slice(at[2]) };
  };

  // All four trial agents met a fetch tool that capped every quotation at about 125 characters. The
  // old order (raw source, then "ask the summarising tool for the exact passage") sent them through a
  // refusal first. The order is what worked: fetch the text, then the capped tool, then stop.
  it('gives three routes, in the order that worked', () => {
    const { at, one, two, three } = routes();
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(one).toMatch(/\bshell\b/);
    expect(two).toMatch(/one sentence at a time/);
    expect(three).toMatch(/tell the learner and stop/);
  });

  // "I was unsure whether a shell fetch was in bounds" (Berlin). The skill had it in half a clause.
  holds(SOURCING, heading, [
    ['says that a GET of a public page is reading the page', /Reading a public page with an ordinary GET request is reading the page/],
    ['says that nothing fetched is ever run', /Nothing you fetch is ever run/],
    ['says not to work around a page that blocks the fetch', /challenge.{0,120}do not (try to )?work around/i],
  ]);

  // Three agents invented the same recipe separately; one "had to invent that check" (the last step).
  it('gives the recipe: fetch, reduce to visible text, cut by phrases with a script, confirm on the page', () => {
    const recipe = routes().one;
    expect(recipe).toMatch(/to a file/);
    expect(recipe).toMatch(/strip the remaining tags/);
    expect(recipe).toMatch(/decode entities/);
    expect(recipe).toMatch(/whitespace/);
    expect(recipe).toMatch(/start phrase and an end phrase/);
    expect(recipe).toMatch(/never by retyping/);
    expect(recipe).toMatch(/substring/);
    expect(recipe).toMatch(/page a person would open/);
  });

  // The old example prompt asked for "the paragraph that states...". The capped tool refused it
  // every time; asking for one sentence by a landmark worked (Bayes, 24 fetches).
  it('asks a capped tool for one sentence by a landmark, never for a paragraph', () => {
    const capped = routes().two;
    const prompts = [...capped.matchAll(/"(Quote[^"]+)"/g)].map((m) => m[1]!);
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      expect(prompt).toMatch(/\bone sentence\b/);
      expect(prompt).not.toMatch(/paragraph/);
      // The landmark it names is in the excerpt the same page goes on to show.
      const landmark = /'([^']+)'/.exec(prompt)?.[1];
      expect(landmark).toBeDefined();
      expect(markedExamples(SOURCING).find((ex) => ex.kind === 'evidence')!.json).toContain(landmark!);
    }
    expect(capped).toMatch(/landmark/);
    expect(capped).toMatch(/Several short excerpts from one page are fine/);
    // Its quotations are a model's, so each needs a second retrieval that was not handed the text.
    expect(capped).toMatch(/second retrieval/);
  });

  // "One search digest contained sentences that read like a quotation from a CDC document I never
  // opened; a less careful run would save that as a snippet" (Bayes).
  holds(SOURCING, heading, [
    ['says a search tool that writes an answer gives no snippet', /written answer is never a snippet/],
    ['says nothing from a digest may be stored', /Nothing in a digest may be stored/],
  ]);

  it('no longer offers a search snippet as the fallback for text that cannot be read', () => {
    expect(section(SOURCING, heading)).not.toMatch(/save the search engine's own snippet/);
  });
});

describe('sourcing.md, choosing sources', () => {
  const heading = 'Choosing sources';

  // Three hosts restricted quotation; the agents narrowed to open pages on their own judgement and
  // one skipped "the two best-known sources" without knowing whether that was expected.
  it('says what to do when the host limits quotation', () => {
    const rule = passage(SOURCING, heading, /limits quotation/);
    expect(rule).toMatch(/public-domain and openly licensed/);
    expect(rule).toMatch(/sentence or two/);
    expect(rule).toMatch(/tell the learner/);
  });

  holds(SOURCING, heading, [
    // "Wikipedia says the dent springs back, Wikibooks says it stays" (Sourdough).
    ['has a rule for sources that disagree', /sources disagree.{0,200}cites both/i],
    ['says to hedge only as far as the sources do', /hedge only as far as the sources do/],
    // "No word on tertiary sources such as Wikipedia, or on a page that declares itself unmaintained" (Berlin).
    ['has a rule for encyclopedias', /encyclopedia/i],
    ['has a rule for retired pages', /archived, retired or no longer maintained/],
    // "I wrote 'Gorbachev, the Soviet leader' although the cited excerpts do not state those roles" (Berlin).
    ['has a rule for glossing a term the source does not define', /without explaining.{0,260}(defines or identifies)/],
    ['says an unsourced gloss is left out', /gloss you cannot source is left out/],
  ]);
});

describe('sourcing.md, the limits that shape research', () => {
  const heading = 'The limits that shape research';

  // "Limits that drive research sit in the last file you are told to open" (TCP).
  it('comes before the agent cuts its first excerpt', () => {
    const text = read(SOURCING);
    const at = (h: string): number => text.indexOf(`\n## ${h}\n`);
    expect(at(heading)).toBeGreaterThan(0);
    expect(at(heading)).toBeLessThan(at('Cutting an excerpt'));
    expect(at(heading)).toBeLessThan(at('Saving evidence'));
  });

  // "save_evidence never reports how much of a URL's allowance is used or left, so I wrote a script"
  // and "no result tells you how many times each excerpt has been used ... I kept a hand tally" (TCP).
  holds(SOURCING, heading, [
    ['names the field that reports characters used per URL', /`urlChars`/],
    ['names the field that reports uses per excerpt', /`(totals\.)?evidenceUses`/],
    ['says what one URL means', /fragment/],
    ['says what counts as a use', /claim, quote, stage, checkpoint explanation, reflect model answer (or|and) recap takeaway/],
    ['says an example pointing at an excerpt is not a use', /`basedOn` does not count/],
    ['says a discarded excerpt still counts, because evidence is never deleted', /never deleted/],
  ]);

  it('the field names are the ones the tools use', () => {
    // EvidenceCheck.urlChars is the contract the server passes through.
    expect(read(path.join(ROOT, 'src/core/types.ts'))).toMatch(/urlChars\?: \{ used: number; max: number \}/);
  });
});

describe('what sourcing.md says about the allowance of one URL', async () => {
  const validate = await load('src/core/validate');
  const checkEvidence = typeof validate?.checkEvidence === 'function' ? (validate.checkEvidence as (input: unknown, draft: Draft) => EvidenceCheck) : null;
  const sentence = 'Each comparison halves the remaining search interval, so few comparisons are ever needed.';
  const item = (url: string, excerpt = sentence): Record<string, string> => ({ url, title: 'Synthetic test source', excerpt, via: 'page' });
  const store = (draft: Draft, url: string, excerpt: string): void => {
    const result = checkEvidence!(item(url, excerpt), draft);
    expect(result.errors).toEqual([]);
    draft.evidence.push({ ...result.evidence!, id: `e${draft.evidence.length + 1}`, savedOn: '2026-10-10' });
  };

  it.skipIf(!checkEvidence)('one URL is one address whatever its fragment, and another page has its own allowance', () => {
    const draft = exampleDraft();
    const page = 'https://example.org/handbook/searching';
    // Two long passages from the page leave room for less than a third.
    const filler = (seed: string): string => `${seed} ${'word '.repeat(190)}`.trim().slice(0, L.excerptChars.max);
    store(draft, page, filler('First passage.'));
    store(draft, `${page}#history`, filler('Second passage.'));
    const third = filler('Third passage.');
    expect(checkEvidence!(item(`${page}#cost`, third), draft).errors.map((e) => e.code)).toEqual(['EVIDENCE_URL_QUOTA']);
    expect(checkEvidence!(item('https://example.org/handbook/sorting', third), draft).errors).toEqual([]);
  });

  // The validator fills this in during the same round as this guidance; until it does there is nothing to compare.
  const reports = checkEvidence ? checkEvidence(item('https://example.org/handbook/probe'), exampleDraft()).urlChars !== undefined : false;
  it.skipIf(!reports)('urlChars counts what is stored from that URL, this item included, against the limit', () => {
    const draft = exampleDraft();
    const page = 'https://example.org/handbook/searching';
    store(draft, page, sentence);
    const second = `${sentence} A sorted list of a million items takes about twenty.`;
    expect(checkEvidence!(item(page, second), draft).urlChars).toEqual({ used: sentence.length + second.length, max: L.excerptCharsPerUrl });
    expect(checkEvidence!(item('https://example.org/handbook/sorting', second), draft).urlChars).toEqual({ used: second.length, max: L.excerptCharsPerUrl });
  });
});

describe('sourcing.md, cutting an excerpt', () => {
  const heading = 'Cutting an excerpt';

  // "I did join in six cases ... but I was guessing at the rule" (Bayes); "may consecutive segments
  // that the tool says omit nothing be rejoined into one excerpt?" (TCP).
  it('states the joining rule', () => {
    const rule = passage(SOURCING, heading, /One run of text/);
    expect(rule).toMatch(/as the page shows it/);
    expect(rule).toMatch(/joined only when a second retrieval/);
    expect(rule).toMatch(/store them separately/);
  });

  // "'Copy the characters; change nothing else' does not say what to do with line breaks" (TCP, Berlin).
  it('states the whitespace rule, and the one about a word hyphenated across a line break', () => {
    const rule = passage(SOURCING, heading, /Whitespace/);
    expect(rule).toMatch(/line break/);
    expect(rule).toMatch(/one space/);
    expect(rule).toMatch(/rejoined only if/);
  });

  // "The formula itself cannot be captured as a verbatim excerpt: every source page typesets it" (Bayes).
  holds(SOURCING, heading, [['says not to store a transcribed formula', /formula.{0,160}(do not|never) store a transcription/i]]);
});

describe('sourcing.md, which URL, title and via', () => {
  const heading = 'Saving evidence';

  // "I read the TextExtracts API but stored the human article URL ... I had to invent that check"
  // (Berlin); "the live page carries an inline editor's flag ... the API text had silently dropped
  // it" (Sourdough); "the publisher pages could not be read without a browser" (Sourdough).
  holds(SOURCING, heading, [
    ['says to cite the page a person would open', /page a person would open/],
    ['covers an API or raw rendition', /API, raw or plain-text rendition/],
    ['says a rendition drops inline editorial tags', /\[citation needed\]/],
    ['says a tagged sentence is not used', /tagged sentence.{0,80}do not use it/i],
    ['accepts a repository copy of an open-access article', /repository copy of an open-access article/],
    // "HTML title ('Sourdough - Wikipedia') or the heading?" (Sourdough, TCP).
    ['says which title is meant', /site or build suffix/],
  ]);

  it('never lets a digest be labelled search_snippet', () => {
    const row = passage(SOURCING, heading, /^\| `search_snippet`/);
    expect(row).toMatch(/digest/);
  });

  it('says page is honest for a rendition confirmed on the page', () => {
    const row = passage(SOURCING, heading, /^\| `page`/);
    expect(row).toMatch(/rendition/);
    expect(row).toMatch(/confirmed/);
  });
});

describe('sourcing.md, the grounding checks', () => {
  const heading = 'The grounding checks';

  holds(SOURCING, heading, [
    // "Two table numbers had no openable source in the published page, with no warning" (Bayes).
    ['says the numbers on a sourced stage must be in the passages the stage cites', /stage marked `sourced`.{0,200}one of the excerpts that item cites/],
    // "Unsure, I wrote the alt text of the illustrative chart with no multi-digit numbers" (TCP).
    ['says the description of a worked or illustrative stage is not checked', /`worked` or `illustrative` \(the clip's description included\)/],
    // "The validator accepted ... a claim that named a place the cited excerpt never mentions" (Berlin).
    ['tells the agent to read each claim beside its excerpt for names', /every name, place, role and date/],
    // "With one-sentence excerpts, any faithful claim sits close to a near-copy" (Bayes).
    ['says what to do when the excerpt is one sentence', /one-sentence excerpt.{0,200}`quote` block/],
  ]);
});

// ---------------------------------------------------------------------------------------------
// calibration.md
// ---------------------------------------------------------------------------------------------

describe('calibration.md', () => {
  // "The learner's answer used correct terms but a wrong mechanism ... I guessed some" (TCP).
  it('breaks the tie between right vocabulary and a wrong mechanism', () => {
    const text = section(CALIBRATION, 'What each answer changes');
    expect(text).toMatch(/[Rr]ight (terms|vocabulary) with a wrong mechanism/);
    const rule = passage(CALIBRATION, 'What each answer changes', /with a wrong mechanism/);
    expect(rule).toMatch(/`some`/);
  });

  // "What the learner has on hand ... changes the lesson more than the time question does"
  // (Sourdough); "by hand with a formula, or by counting and a picture?" (Bayes).
  holds(CALIBRATION, 'What to ask', [
    ['folds what the learner has to work with into the goal question', /what (do )?(you|they) have to work with/i],
    ['folds formula or counting into the goal question', /formula.{0,40}counting/],
    ['keeps it one clause, not a fourth question', /not a fourth question/],
  ]);

  // "The learner said 'just start' and 'five minutes' ... I had to reconcile the two passages" (Berlin).
  it('says a stated time wins, where the defaults are listed', () => {
    const defaults = passage(CALIBRATION, '"Just start"', /`depth: "standard"`/);
    expect(defaults).toMatch(/time/);
    expect(section(CALIBRATION, 'What to ask')).toMatch(/stated time/);
  });

  // "Calibration says ... a predict in scene 2 or 3 ... the design reference says to put the predict
  // on the step where the outcome is the crux" (Berlin). In clips the prediction is a gate on a beat.
  holds(CALIBRATION, '"Just start"', [['says which rule wins when the crux comes late', /crux/]]);

  // "A guaranteed first-call rejection for anyone who asks a concrete probe" (Bayes, start_lesson TOO_LONG).
  it('gives the character limits beside the example, where start_lesson is filled in', () => {
    const rule = passage(CALIBRATION, 'Filling in `learner`', /^- `calibration` holds/);
    expect(rule).toContain(`a question of at most ${L.calibration.questionChars} characters`);
    expect(rule).toContain(`an answer of at most ${L.calibration.answerChars}`);
    expect(rule).toMatch(/shorten/);
  });

  // "A number in a framing block must appear in some stored excerpt, and the learner's answer is
  // not evidence, so I wrote around it" (Bayes).
  it('says where the learner\'s own numbers may be echoed', () => {
    const rule = passage(CALIBRATION, 'What each answer changes', /Their words set the opening/);
    expect(rule).toMatch(/`example` block or a (question|checkpoint)/);
    expect(rule).toMatch(/never in framing/);
  });
});

// ---------------------------------------------------------------------------------------------
// SKILL.md
// ---------------------------------------------------------------------------------------------

describe('SKILL.md after the trials', () => {
  const text = squash(read(SKILL_MD));

  it('names no tool, command or program that only some hosts have', () => {
    expect(read(SKILL_MD)).not.toMatch(/\b(WebFetch|WebSearch|curl|wget|Bash|python3?|TextExtracts)\b/i);
  });

  it('no longer sends the agent to ask a summarising tool for the passage', () => {
    expect(text).not.toMatch(/Ask (it )?for the exact passage/);
  });

  it('tells the agent what to do with a fetch tool that will not quote, and with a search digest', () => {
    const research = section(SKILL_MD, '3. Research, and save evidence as you go');
    expect(research).toMatch(/one sentence at a time/);
    expect(research).toMatch(/never store anything from a digest/);
    expect(research).toMatch(/tell the learner and stop/);
  });

  it('points at the limits that shape research before the research starts', () => {
    const research = section(SKILL_MD, '3. Research, and save evidence as you go');
    expect(research).toMatch(/characters from one URL/);
    expect(research).toMatch(/running counts?/);
  });

  // All four agents departed from the suggested reply because it called passages "sources", and
  // two were handed a 127.0.0.1 link that was already dead.
  it('keeps passages, pages and sites apart in the reply, and leads with the file', () => {
    const reply = section(SKILL_MD, '7. Publish, and reply with the link');
    expect(reply).toMatch(/passages.{0,60}pages.{0,60}sites/);
    expect(reply).toMatch(/never.{0,40}"sources"/);
    expect(reply).toMatch(/[Ll]ead with the file/);
    expect(reply).toMatch(/only while/);
  });

  // "I could not tell whether 6 minutes for a learner who asked for ten is a shortfall I should fix" (three agents).
  it('says a lesson under its nominal time is not to be padded', () => {
    expect(text).toMatch(/never pad/i);
  });
});

// ---------------------------------------------------------------------------------------------
// Statements the code decides
// ---------------------------------------------------------------------------------------------

describe('what sourcing.md says the server does with whitespace', async () => {
  const validate = await load('src/core/validate');
  const checkEvidence = typeof validate?.checkEvidence === 'function' ? (validate.checkEvidence as (input: unknown, draft: Draft) => EvidenceCheck) : null;
  const item = (excerpt: string): Record<string, string> => ({ url: 'https://example.org/standards/segments', title: 'Segments (synthetic test source)', excerpt, via: 'page' });
  const wrapped = 'The initial window is used by the\n   sender  after the three-way handshake is completed, so that a full-\n   sized segment can be sent\tat once.';

  it('every line break and run of spaces becomes one space', () => {
    expect(sanitizeInput(item(wrapped))).toMatchObject({
      excerpt: 'The initial window is used by the sender after the three-way handshake is completed, so that a full- sized segment can be sent at once.',
    });
  });

  it.skipIf(!checkEvidence)('the stored excerpt is the collapsed text, and a hyphen at a line break is not rejoined for you', () => {
    const result = checkEvidence!(item(wrapped), exampleDraft());
    expect(result.errors).toEqual([]);
    expect(result.evidence?.excerpt).not.toMatch(/\s{2,}|\n|\t/);
    expect(result.evidence?.excerpt).toContain('full- sized');
  });

  it.skipIf(!checkEvidence)('length is counted after collapsing', () => {
    const words = 'word '.repeat(L.excerptChars.max / 5).trim();
    expect(words.length).toBeLessThanOrEqual(L.excerptChars.max);
    const padded = words.replace(/ /g, ' \n   ');
    expect(padded.length).toBeGreaterThan(L.excerptChars.max);
    expect(checkEvidence!(item(padded), exampleDraft()).errors).toEqual([]);
    const short = `${'a'.repeat(L.excerptChars.min - 1)}${' '.repeat(20)}`;
    expect(checkEvidence!(item(short), exampleDraft()).errors.map((e) => e.code)).toEqual(['TOO_SHORT']);
  });
});

describe('what sourcing.md says counts as a use of an excerpt', async () => {
  const validate = await load('src/core/validate');
  const checkLesson = typeof validate?.checkLesson === 'function' ? (validate.checkLesson as (draft: Draft) => LessonReport) : null;
  const evidenceUses = typeof validate?.evidenceUses === 'function' ? (validate.evidenceUses as (draft: Draft) => Record<string, number>) : null;

  type Loose = Record<string, any>;
  const scene = (draft: Draft, id: string): Loose => (draft.scenes as unknown as Loose[]).find((s) => s.id === id)!;
  const overuse = (draft: Draft): string | undefined => checkLesson!(draft).errors.find((e) => e.code === 'EVIDENCE_OVERUSED' && e.message.startsWith('e1 '))?.message;

  // In the example lesson e1 is cited by two claims, a figure, two checkpoint explanations and a
  // takeaway, which is the limit, and one worked example points at it with `basedOn`.
  const mutations: Array<[kind: string, mutate: (draft: Draft) => void]> = [
    ['claim', (d) => scene(d, 's5').blocks[0].cites.push('e1')],
    ['quote', (d) => (scene(d, 's7').blocks[1].cite = 'e1')],
    ['figure', (d) => scene(d, 's5').figure.cites.push('e1')],
    ['checkpoint explanation', (d) => scene(d, 's6').question.explanation.cites.push('e1')],
    ['recap takeaway', (d) => scene(d, 's9').takeaways[1].cites.push('e1')],
  ];

  it.skipIf(!checkLesson)('the example lesson has e1 at the limit, with a basedOn that is not counted', () => {
    const draft = exampleDraft();
    expect(JSON.stringify(draft.scenes)).toContain('"basedOn":["e1"]');
    expect(overuse(draft)).toBeUndefined();
    scene(draft, 's3').steps[1].blocks[0].basedOn = ['e1'];
    scene(draft, 's3').steps[3].blocks[0].basedOn = ['e1'];
    expect(overuse(draft)).toBeUndefined();
  });

  it.skipIf(!checkLesson).each(mutations)('one more %s citing it is one use too many', (_kind, mutate) => {
    const draft = exampleDraft();
    mutate(draft);
    expect(overuse(draft)).toContain(`cited by ${L.usesPerEvidence + 1} items`);
  });

  it.skipIf(!checkLesson)('a reflect model answer counts as well', () => {
    const draft = exampleDraft();
    // s8 is an ordering question whose explanation cites e1. As a reflect question its model answer
    // carries the citation instead: still the limit, and one more claim is one too many.
    const reflect = structuredClone(EXAMPLE_QUESTIONS.reflect) as Loose;
    reflect.modelAnswer.cites = ['e1'];
    scene(draft, 's8').question = reflect;
    (draft.outline as unknown as Loose[]).find((o) => o.id === 's8')!.question = 'reflect';
    expect(overuse(draft)).toBeUndefined();
    scene(draft, 's5').blocks[0].cites.push('e1');
    expect(overuse(draft)).toContain(`cited by ${L.usesPerEvidence + 1} items`);
  });

  // In a lesson of clips the same holds with a stage where a figure was: the passages a stage
  // cites are one use each, a caption that is a claim or a quote is one, and `basedOn` is none.
  it.skipIf(!evidenceUses)('in a clip, the stage and each cited caption are a use, and basedOn is not', () => {
    const clip = (draft: Draft, id: string): Loose => (draft.scenes as unknown as Loose[]).find((s) => s.id === id)!;
    const uses = (mutate: (draft: Draft) => void): number => {
      const draft = exampleClipDraft();
      mutate(draft);
      return evidenceUses!(draft).e4!;
    };
    const before = uses(() => undefined);
    // c2 is the flow clip: its stage is sourced, and its first two captions are claims.
    expect(clip(exampleClipDraft(), 'c2').stage.kind).toBe('flow');
    expect(uses((d) => clip(d, 'c2').stage.cites.push('e4'))).toBe(before + 1);
    expect(uses((d) => clip(d, 'c2').beats[0].caption.cites.push('e4'))).toBe(before + 1);
    expect(uses((d) => (clip(d, 'c3').beats[0].caption.basedOn = ['e4']))).toBe(before);
  });

  // The server shows the agent this count. It is exported by the validator once that lands.
  it.skipIf(!evidenceUses)('evidenceUses counts the same items', () => {
    const draft = exampleDraft();
    expect(evidenceUses!(draft).e1).toBe(L.usesPerEvidence);
    for (const [, mutate] of mutations) {
      const changed = exampleDraft();
      mutate(changed);
      expect(evidenceUses!(changed).e1).toBe(L.usesPerEvidence + 1);
    }
  });
});

describe('what sourcing.md says about the link to the passage', async () => {
  const escape = await load('src/render/escape');
  const textDirective = typeof escape?.textDirective === 'function' ? (escape.textDirective as (passage: string) => string) : null;

  it('says the link is built from the first and last five words', () => {
    expect(passage(SOURCING, 'Cutting an excerpt', /One run of text/)).toMatch(/first and last five words/);
  });

  it.skipIf(!textDirective)('which is how the page builds it', () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i + 1}`);
    expect(textDirective!(words.join(' '))).toBe(`text=${encodeURIComponent(words.slice(0, 5).join(' '))},${encodeURIComponent(words.slice(-5).join(' '))}`);
  });
});
