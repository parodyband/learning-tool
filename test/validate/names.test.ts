// NAME_NOT_IN_SOURCE, from the trials: an agent's claim named a city that its cited passage never
// mentions, and nothing flagged it. The rule is a warning and only ever a warning. Both directions:
// the name the source lacks is flagged, and the capitals an honest lesson is full of (the start of
// a sentence, the topic, a name the source has in another form, a month) are not.
import { describe, expect, it } from 'vitest';
import { ISSUES } from '../../src/core/issues';
import type { Draft } from '../../src/core/types';
import { checkLesson, checkScene } from '../../src/core/validate';
import { APOLLO_LESSON } from './fixtures/apollo';
import { HTTP_LESSON } from './fixtures/http';
import { applyPlan, assemble, codes, exampleDraft, expectActionable, expectNoExcerptText, newDraft, saveEvidence, submit } from './helpers';

const NICHOLAS = 'On 9 October 1989 the police and army units were given permission to use force against those assembled at the St. Nicholas Church, but the demonstration of 70,000 people went ahead without violence.';
const MARCHES = 'The Monday demonstrations in Leipzig grew from a few hundred people in September to more than 300,000 by late October 1989.';
const GERMAN = 'Honecker was forced to resign, while hundreds of thousands marched in protest throughout major East German cities.';

function history(language = 'en', lang?: string): Draft {
  const draft = newDraft({ topic: 'Why the Berlin Wall fell', language, depth: 'quick', learner: { level: 'new', knows: 'Knows the Wall divided Berlin.', goal: 'Explain why it fell.' } });
  const tag = lang ? { lang } : {};
  saveEvidence(draft, { url: 'https://history.example.org/peaceful-revolution', title: 'Peaceful Revolution (synthetic)', publisher: 'Example Library of Congress', via: 'page', excerpt: NICHOLAS, ...tag });
  saveEvidence(draft, { url: 'https://history.example.org/monday-demonstrations', title: 'Monday demonstrations (synthetic)', via: 'page', excerpt: MARCHES, ...tag });
  saveEvidence(draft, { url: 'https://archive.example.com/1989/collapse', title: 'Fall of Communism in Eastern Europe, 1989 (synthetic)', via: 'page', excerpt: GERMAN, ...tag });
  applyPlan(draft, { title: 'Why the Berlin Wall fell in 1989', objectives: [{ id: 'o1', text: 'Name the pressures that brought the Wall down' }], outline: [{ id: 's1', kind: 'narration', purpose: 'The protests' }, { id: 's2', kind: 'narration', purpose: 'The collapse' }, { id: 's3', kind: 'checkpoint', purpose: 'Check', question: 'single', objective: 'o1' }, { id: 's4', kind: 'recap', purpose: 'Recap' }] });
  return draft;
}
const claim = (text: string, cites = ['e1'], draft = history()) => checkScene({ id: 's1', kind: 'narration', title: 'The protests', blocks: [{ type: 'claim', text, cites }] }, draft);
const names = (check: ReturnType<typeof checkScene>) => check.warnings.filter((w) => w.code === 'NAME_NOT_IN_SOURCE').map((w) => w.got);

describe('a name the cited passage never mentions', () => {
  it('the case from the trials: a city added to a claim whose passage names only a church', () => {
    const draft = history();
    const check = checkScene({ id: 's1', kind: 'narration', title: 'The protests', blocks: [{ type: 'claim', text: 'In Leipzig on 9 October 1989, police and army units had permission to use force against the demonstration.', cites: ['e1'] }] }, draft);
    // Accepted: this is a prompt to look, never a refusal.
    expect(check.ok).toBe(true);
    expect(check.errors).toEqual([]);
    expect(check.warnings.map((w) => [w.code, w.severity, w.path, w.got])).toEqual([['NAME_NOT_IN_SOURCE', 'warning', 'blocks[0].text', 'Leipzig']]);
    expect(check.warnings[0]!.message).toBe('The name "Leipzig" in this claim is not in the excerpt it cites (e1).');
    // The stored passage that does name it is pointed to, as a question.
    expect(check.warnings[0]!.fix).toContain('"Leipzig" is in e2: cite that passage as well if it is what supports this part of the claim.');
    expect(check.warnings[0]!.fix).toContain('if you added it from memory, take it out');
    expectActionable(check.warnings);
    expectNoExcerptText(check.warnings, draft);
  });

  it('citing the passage that names it resolves the warning', () => {
    expect(codes(claim('In Leipzig on 9 October 1989, police and army units had permission to use force against the demonstration.', ['e1', 'e2']))).toEqual([]);
  });

  it('several names are listed once each, in one warning', () => {
    const check = claim('The police in Dresden and in Leipzig, and again in Dresden, had permission to use force against the demonstration.');
    expect(names(check)).toEqual(['Dresden, Leipzig']);
    expect(check.warnings[0]!.message).toBe('The names "Dresden", "Leipzig" in this claim are not in the excerpt it cites (e1).');
  });

  it('an abbreviation the passage never uses is a name too', () => {
    expect(names(claim('The police of the GDR had permission to use force against the demonstration.'))).toEqual(['GDR']);
  });

  it('a name after an opening quotation mark inside a sentence is checked', () => {
    expect(names(claim('The police called it "Operation Sunrise" and had permission to use force.'))).toEqual(['Operation, Sunrise']);
  });

  it('it is recorded as a warning of the lesson, and is not a weak match', () => {
    const draft = history();
    const s1 = { id: 's1', kind: 'narration', title: 'The protests', blocks: [{ type: 'claim', text: 'In Leipzig the police and army units had permission to use force against the demonstration.', cites: ['e1'] }] };
    expect(submit(draft, s1).ok).toBe(true);
    const report = checkLesson(draft);
    expect(report.warnings.map((w) => [w.code, w.sceneId])).toEqual([['NAME_NOT_IN_SOURCE', 's1']]);
    expect(report.weakClaims).toEqual([]);
    expect(ISSUES.NAME_NOT_IN_SOURCE.severity).toBe('warning');
    expect((ISSUES.NAME_NOT_IN_SOURCE as { also?: string }).also).toBeUndefined();
  });

  it('a claim that is refused as unrelated is not also asked about its names', () => {
    const check = claim('Honey never spoils, and archaeologists have eaten jars found in Egyptian tombs.');
    expect(codes(check)).toEqual(['CLAIM_UNRELATED']);
  });
});

describe('capitals that are not a name the source lacks', () => {
  it.each([
    ['the first word of the claim', 'Police and army units had permission to use force against the demonstration.'],
    ['the first word of a second sentence', 'The police had permission to use force. Nobody used it against the demonstration.'],
    ['a word after a colon', 'The police had one permission: Force could be used against the demonstration.'],
    ['a name that is in the cited passage', 'At the St. Nicholas Church the police had permission to use force against the demonstration.'],
    ['its possessive', 'Outside Nicholas\'s church the police had permission to use force against the demonstration.'],
    ['a month the passage names', 'On 9 October the police had permission to use force against the demonstration.'],
    ['a month the passage only gives as a number', 'On a Monday in November the police still had permission to use force against a demonstration.'],
    ['a name from the lesson\'s topic', 'Before the Berlin Wall fell, the police had permission to use force against the demonstration.'],
    ['a name from the lesson\'s title, in the plural', 'Unlike the Walls of other cities, the police here had permission to use force against the demonstration.'],
    ['a name that stands in a code span', 'The police unit `Bereitschaftspolizei` had permission to use force against the demonstration.'],
    ['a short capital', 'The police of St Nicholas had an OK to use force against the demonstration.'],
  ])('%s', (_what, text) => {
    expect(codes(claim(text))).toEqual([]);
  });

  it('a name the passage has in another form: "Germany" where it says "German"', () => {
    expect(codes(claim('Honecker was forced to resign while hundreds of thousands marched across East Germany.', ['e3']))).toEqual([]);
    // A different name that only shares its first letters with nothing in the passage is still flagged.
    expect(names(claim('Honecker was forced to resign while hundreds of thousands marched across East Georgia.', ['e3']))).toEqual(['Georgia']);
  });

  it('the plural of a name the passage has', () => {
    expect(codes(claim('Hundreds of thousands of East Germans marched, and Honecker was forced to resign.', ['e3']))).toEqual([]);
  });

  it('the source\'s own title and publisher, which the learner is shown beside the passage', () => {
    expect(codes(claim('Across Eastern Europe hundreds of thousands marched in protest, and Honecker was forced to resign.', ['e3']))).toEqual([]);
    expect(codes(claim('An account from the Library of Congress says the police had permission to use force against the demonstration.'))).toEqual([]);
  });

  it('a lesson in German, where every noun has a capital, is not checked', () => {
    const draft = history('de');
    expect(codes(claim('Die Polizei und Einheiten der Armee hatten in Leipzig die Erlaubnis, Gewalt gegen die Demonstration einzusetzen.', ['e1'], draft)).filter((c) => c === 'NAME_NOT_IN_SOURCE')).toEqual([]);
  });

  it('a claim on a passage in another language is not checked: the name may be written another way there', () => {
    const draft = history('en', 'de');
    expect(codes(claim('In Leipzig the police and army units had permission to use force against the demonstration.', ['e1'], draft))).toEqual([]);
  });

  it('a script without capitals has no word that qualifies', () => {
    const draft = newDraft({ topic: '日本の人口', language: 'ja', depth: 'quick', learner: { level: 'some', knows: '基本は知っている。', goal: '人口の推移を説明する。' } });
    saveEvidence(draft, { url: 'https://stats.example.org/jinko', title: '人口推計', via: 'page', excerpt: '日本の総人口は2023年10月1日現在で1億2435万2千人となり、前年に比べ59万5千人の減少となった。' });
    applyPlan(draft, { title: '日本の人口の推移', objectives: [{ id: 'o1', text: '日本の人口の推移を説明する' }], outline: [{ id: 's1', kind: 'narration', purpose: '導入' }, { id: 's2', kind: 'narration', purpose: '詳細' }, { id: 's3', kind: 'checkpoint', purpose: '確認', question: 'single', objective: 'o1' }, { id: 's4', kind: 'recap', purpose: 'まとめ' }] });
    expect(codes(claim('日本の総人口は前年に比べて減少した。大阪でも同じ傾向である。', ['e1'], draft))).toEqual([]);
  });
});

describe('a draft read from disk with a damaged entry', () => {
  it('a title or publisher that is not text is treated as absent, and nothing throws', () => {
    const draft = history();
    (draft.evidence[0] as any).title = 42;
    (draft.evidence[0] as any).publisher = { name: 'x' };
    const check = claim('In Leipzig the police and army units had permission to use force against the demonstration.', ['e1'], draft);
    expect(names(check)).toEqual(['Leipzig']);
    // Without its publisher, the name that only the publisher had is asked about too.
    expect(names(claim('An account from the Library of Congress says the police had permission to use force against the demonstration.', ['e1'], draft))).toEqual(['Library, Congress']);
  });

  it('a lesson language the runtime does not know still gets the check', () => {
    const draft = history();
    draft.language = 'zz-ZZ';
    expect(names(claim('In Leipzig the police and army units had permission to use force against the demonstration.', ['e1'], draft))).toEqual(['Leipzig']);
  });
});

describe('how often it fires on honest lessons', () => {
  it('not once on the example lesson or the two fixture lessons (22 claims)', () => {
    let claims = 0;
    let flagged = 0;
    for (const draft of [exampleDraft(), assemble(structuredClone(HTTP_LESSON)), assemble(structuredClone(APOLLO_LESSON))]) {
      const report = checkLesson(draft);
      claims += report.stats.claims;
      flagged += report.warnings.filter((w) => w.code === 'NAME_NOT_IN_SOURCE').length;
    }
    expect(claims).toBe(22);
    // The brief's bound is one claim in ten; the four trial lessons are measured in the fix report (0 of 69).
    expect(flagged).toBe(0);
  });
});
