// Review findings V1, R1, R2 and R3, through the scene check: a number hidden by invisible
// characters is refused like the plain number, and a number, date, century or decade written the
// way the lesson's language writes it rests on the passage that states it.
//
// The statement side (`numberTokens`) is in use everywhere and its tests always run. The passage
// side (`sourceNumberTokens`) and the reading of continued lines (`linesSafetyIssues`) are called
// from context.ts and scene.ts. The suites that need those calls switch themselves on when the
// calls are there, and are reported as skipped until then. test/text/tokens.test.ts and
// test/validate/safety.test.ts prove the two functions themselves either way.
import { describe, expect, it } from 'vitest';
import type { Draft } from '../../src/core/types';
import { checkScene } from '../../src/core/validate';
import { buildContext } from '../../src/core/validate/context';
import { applyPlan, errorCodes, exampleDraft, exampleScene, newDraft, saveEvidence } from './helpers';

const LEARNER = { level: 'some' as const, knows: 'The basics.', goal: 'To understand it.', calibration: [] };

/** A four-scene draft in `language` holding `excerpts` (each stored with `lang`), ready for scenes s1 (narration), s2 (timeline) and s4 (recap). */
function draftWith(language: string, lang: string | undefined, excerpts: string[]): Draft {
  const draft = newDraft({ topic: 'A probe lesson', language, depth: 'quick', learner: LEARNER });
  excerpts.forEach((excerpt, i) => saveEvidence(draft, { url: `https://stats.example.org/page-${i + 1}`, title: `Page ${i + 1} (synthetic)`, via: 'page', excerpt, ...(lang ? { lang } : {}) }));
  applyPlan(draft, {
    title: 'A probe lesson',
    objectives: [{ id: 'o1', text: 'Say what the passages state' }],
    outline: [
      { id: 's1', kind: 'narration', purpose: 'probe' },
      { id: 's2', kind: 'narration', purpose: 'probe', figure: 'timeline' },
      { id: 's3', kind: 'checkpoint', purpose: 'probe', question: 'single', objective: 'o1' },
      { id: 's4', kind: 'recap', purpose: 'probe' },
    ],
  });
  return draft;
}
const narration = (...blocks: unknown[]) => ({ id: 's1', kind: 'narration', title: 'Probe', blocks });
const claim = (text: string, cites = ['e1']) => ({ type: 'claim', text, cites });
const framing = (text: string) => ({ type: 'framing', text });
const numberIssues = (draft: Draft, scene: unknown) => checkScene(scene, draft).errors.filter((e) => e.code.startsWith('NUMBER_')).map((e) => [e.code, e.path, e.got]);

const FIRE = 'The Great Fire of London started on Sunday 2 September 1666 in a bakery on Pudding Lane and burned for four days.';
const WAR = 'The Second World War lasted from 1939 to 1945 and involved most of the nations of the world.';
const POPULATION = 'The total population of Japan was 124.35 million as of October 1, 2023, a decrease of 595 thousand from the previous year.';
const BIRTHS = 'The number of births in 2023 was 727,277, while deaths numbered 1,575,936, so the natural decrease exceeded 848,000.';
const LAW = 'Die Novelle des Gebäudeenergiegesetzes wurde am 16.10.2023 im Bundesgesetzblatt verkündet und trat am 1.1.2024 in Kraft.';

describe('V1: a number written with characters that cannot be seen', () => {
  const J = '‍';
  const hidden = (digits: string, between = J) => [...digits].join(between);

  it('is refused in a claim exactly as the plain number is', () => {
    const draft = draftWith('en', undefined, [FIRE]);
    const text = (year: string) => `The fire that started in a bakery on Pudding Lane was first described in ${year}.`;
    expect(numberIssues(draft, narration(claim(text('1946'))))).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '1946']]);
    expect(numberIssues(draft, narration(claim(text(hidden('1946')))))).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '1946']]);
    for (const between of ['‌', '‎', '⁢', '͏', '︎', '᠎', 'ㅤ']) {
      expect(numberIssues(draft, narration(claim(text(hidden('1946', between))))), `U+${between.codePointAt(0)!.toString(16)}`).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '1946']]);
    }
  });

  it('is refused in framing, in a title, in a takeaway and in a timeline', () => {
    const draft = draftWith('en', undefined, [FIRE]);
    const fire = claim('The fire started in a bakery on Pudding Lane and burned for four days.');
    expect(numberIssues(draft, narration(fire, framing(`Why would ${hidden('350', '‌')} million people care?`)))).toEqual([['NUMBER_UNGROUNDED', 'blocks[1].text', '350']]);
    expect(numberIssues(draft, { ...narration(fire), title: `London in ${hidden('1700')}` })).toEqual([['NUMBER_UNGROUNDED', 'title', '1700']]);
    const recap = { id: 's4', kind: 'recap', title: 'Recap', takeaways: [{ objective: 'o1', text: `The fire in the bakery on Pudding Lane destroyed ${hidden('99.9', '⁢')}% of the lane.`, cites: ['e1'] }], next: [{ topic: 'The rebuilding of London', why: 'It follows directly from the fire.' }] };
    expect(numberIssues(draft, recap)).toEqual([['NUMBER_NOT_IN_SOURCE', 'takeaways[0].text', '99.9']]);
    const timeline = { id: 's2', kind: 'narration', title: 'Probe', blocks: [fire], figure: { type: 'timeline', events: [{ id: 't1', when: hidden('1946'), label: 'The fire starts' }, { id: 't2', when: 'Four days later', label: 'The fire ends' }], cites: ['e1'], description: 'Two events in order: the fire starts, and four days later it ends.' } };
    // A figure's numbers are held to the passages the figure cites, like a claim's.
    expect(numberIssues(draft, timeline)).toEqual([['NUMBER_NOT_IN_SOURCE', 'figure.events[0].when', '1946']]);
  });

  it('and a sourced number written that way still rests on its source', () => {
    const draft = draftWith('en', undefined, [FIRE]);
    expect(checkScene(narration(claim(`The fire started in a bakery on Pudding Lane in ${hidden('1666')}.`)), draft).errors).toEqual([]);
  });
});

describe('R3: a century, and the second year of a range, written as prose writes them', () => {
  it('a century named by an ordinal needs no source, in framing, in a claim and in a timeline', () => {
    const draft = draftWith('en', undefined, [FIRE]);
    const fire = claim('The fire started in a bakery on Pudding Lane and burned for four days.');
    expect(checkScene(narration(fire, framing('How does a fire in one bakery end up consuming most of a 17th-century city?')), draft).errors).toEqual([]);
    expect(checkScene(narration(claim('In 17th-century London a fire started in a bakery on Pudding Lane and burned for four days.')), draft).errors).toEqual([]);
    const timeline = { id: 's2', kind: 'narration', title: 'Probe', blocks: [fire], figure: { type: 'timeline', events: [{ id: 't1', when: '17th century', label: 'The fire starts' }, { id: 't2', when: 'Four days later', label: 'The fire ends' }], cites: ['e1'], description: 'Two events in order: the fire starts, and four days later it ends.' } };
    expect(checkScene(timeline, draft).errors).toEqual([]);
  });

  it('the same in German', () => {
    const draft = draftWith('de', undefined, ['Der Große Brand von London begann am Sonntag, dem 2. September 1666, in einer Bäckerei in der Pudding Lane.']);
    expect(checkScene(narration(claim('Im 17. Jahrhundert begann der Brand von London in einer Bäckerei in der Pudding Lane.')), draft).errors).toEqual([]);
  });

  it('a short range of years rests on the two years the passage gives', () => {
    const draft = draftWith('en', undefined, [WAR]);
    expect(checkScene(narration(claim('The Second World War (1939–45) involved most of the nations of the world.')), draft).errors).toEqual([]);
    expect(numberIssues(draft, narration(claim('The Second World War (1939–46) involved most of the nations of the world.')))).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '1946']]);
  });

  it('a count of centuries, another ordinal and a plain two-digit number are still numbers', () => {
    const draft = draftWith('en', undefined, [FIRE]);
    const text = (what: string) => `The fire that started in a bakery on Pudding Lane ${what}.`;
    expect(numberIssues(draft, narration(claim(text('was remembered for 20 centuries'))))).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '20']]);
    expect(numberIssues(draft, narration(claim(text('was the 17th of its kind'))))).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '17']]);
    expect(numberIssues(draft, narration(claim(text('destroyed 17 streets'))))).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '17']]);
  });
});

describe('R1: Japanese numbers against digits an English passage prints', () => {
  it('万 with a remainder is the number the passage prints with commas; a month numeral is a month', () => {
    const draft = draftWith('ja', 'en', [BIRTHS, POPULATION]);
    expect(checkScene(narration(claim('2023年の出生数は72万7277人、死亡数は157万5936人で、自然減は84万8000人を超えた。')), draft).errors).toEqual([]);
    expect(numberIssues(draft, narration(claim('2023年10月1日時点の統計である。', ['e2'])))).toEqual([]);
  });

  it('a different number, or one of its digits changed, is refused, and named as the value it states', () => {
    const draft = draftWith('ja', 'en', [BIRTHS]);
    expect(numberIssues(draft, narration(claim('2023年の出生数は72万8277人だった。')))).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '728277']]);
    expect(numberIssues(draft, narration(claim('2023年の出生数は727万7277人だった。')))).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '7277277']]);
  });
});

// ---------------------------------------------------------------------------------------------
// The passage side, once context.ts builds an excerpt's numbers with sourceNumberTokens
// ---------------------------------------------------------------------------------------------

const passageReading = buildContext(draftWith('ja', 'en', [POPULATION])).evidence.get('e1')!.numbers().has('124350000');

describe.skipIf(!passageReading)('with the passage reading in context.ts: R1, R2 and the decade of R3', () => {
  it('R1: 億 and 万 rest on "million" and "thousand"', () => {
    const draft = draftWith('ja', 'en', [POPULATION, 'According to the medium-variant projection, the population will fall below 100 million in 2056 and reach about 87 million in 2070.']);
    expect(checkScene(narration(claim('2023年10月1日時点の日本の総人口は1億2435万人で、前年より59万5千人減った。')), draft).errors).toEqual([]);
    expect(checkScene(narration(claim('中位推計では、日本の人口は2056年に1億人を下回り、2070年には約8700万人になる。', ['e2'])), draft).errors).toEqual([]);
    // The forms that were the only way through before still pass.
    expect(checkScene(narration(claim('2023年の日本の総人口は124.35百万人で、前年より595千人減った。')), draft).errors).toEqual([]);
  });

  it('R1: ten times the number, and the agent\'s own rounding, are refused', () => {
    const draft = draftWith('ja', 'en', [POPULATION]);
    expect(numberIssues(draft, narration(claim('日本の総人口は12億4350万人である。')))).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '1243500000']]);
    expect(numberIssues(draft, narration(claim('日本の総人口は約1億2000万人である。')))).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '120000000']]);
  });

  it('R2: a date written out rests on the dotted date, and a day the date does not have is refused', () => {
    const draft = draftWith('de', undefined, [LAW]);
    const text = (day: string) => `Die Novelle des Gebäudeenergiegesetzes wurde am ${day} Oktober 2023 verkündet und gilt seit dem 1. Januar 2024.`;
    expect(checkScene(narration(claim(text('16.'))), draft).errors).toEqual([]);
    expect(numberIssues(draft, narration(claim(text('17.'))))).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '17']]);
  });

  it('R2: a time with a colon rests on the time with a dot', () => {
    const draft = draftWith('en', undefined, ['The bakery on Pudding Lane closed at 10.30pm on 31 October, after the last loaves were sold.']);
    expect(checkScene(narration(claim('The bakery on Pudding Lane closed at 10:30 pm on 31 October.')), draft).errors).toEqual([]);
  });

  it('R2: a decimal still keeps its digits to itself', () => {
    const draft = draftWith('en', undefined, ['The population aged 65 and over was 36.23 million, accounting for a record 29.1 percent of the total.']);
    expect(numberIssues(draft, narration(claim('The population aged 65 and over accounts for a record 29 percent of the total.')))).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '29']]);
  });

  it('R3: a decade rests on a year of that decade, and on no other', () => {
    const draft = draftWith('en', undefined, [FIRE]);
    const text = (when: string) => `In the ${when} a fire started in a bakery on Pudding Lane and burned for four days.`;
    expect(checkScene(narration(claim(text('1660s'))), draft).errors).toEqual([]);
    expect(checkScene(narration(claim(text('1600s'))), draft).errors).toEqual([]);
    expect(numberIssues(draft, narration(claim(text('1670s'))))).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '1670s']]);
    expect(numberIssues(draft, narration(claim('In 1660 a fire started in a bakery on Pudding Lane and burned for four days.')))).toEqual([['NUMBER_NOT_IN_SOURCE', 'blocks[0].text', '1660']]);
  });

  it('a topic that names a decade lets the lesson say the decade and its first year', () => {
    const draft = draftWith('en', undefined, [FIRE]);
    draft.topic = 'London in the 1660s';
    const fire = claim('The fire started in a bakery on Pudding Lane and burned for four days.');
    expect(checkScene(narration(fire, framing('What was London like in the 1660s, and in 1660 itself?')), draft).errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Continued lines, once scene.ts reads a lines figure with linesSafetyIssues
// ---------------------------------------------------------------------------------------------

function session(lines: string[]): ReturnType<typeof checkScene> {
  const s = exampleScene('s3');
  s.figure.lines = lines;
  s.figure.language = 'Shell';
  for (const step of s.steps) step.highlight = ['l1'];
  return checkScene(s, exampleDraft());
}
const linesRead = errorCodes(session(['rm -rf \\', '  ~'])).includes('UNSAFE_COMMAND');

describe.skipIf(!linesRead)('with continued lines read in scene.ts: M1', () => {
  it.each([
    ['rm -rf and, on the next line, the home directory', ['# tidy up, then install', 'rm -rf \\', '  ~'], 'figure.lines[1]', 'deletes the root or home directory'],
    ['rm, its flags and its target on three lines', ['rm \\', '-rf \\', '~'], 'figure.lines[0]', 'deletes the root or home directory'],
    ['chmod and its mode', ['chmod \\', '  777 x'], 'figure.lines[0]', 'gives everyone full permissions'],
    ['powershell and its flag', ['powershell \\', '-enc AAAA'], 'figure.lines[0]', 'runs an encoded PowerShell command'],
    ['a pipe at the end of a line', ['cat setup.sh |', '  bash'], 'figure.lines[0]', 'pipes text into bash'],
  ])('refused: %s', (_what, lines, path, why) => {
    const check = session(lines);
    expect(check.errors.map((e) => [e.code, e.path])).toEqual([['UNSAFE_COMMAND', path]]);
    expect(check.errors[0]!.message).toContain(why);
  });

  it('accepted: ordinary commands written over several lines', () => {
    expect(session(['rm -rf \\', '  build/ \\', '  dist/']).errors).toEqual([]);
    expect(session(['curl -fsSL https://example.org/a.json \\', '  -H "Accept: application/json" \\', '  -o a.json']).errors).toEqual([]);
    expect(session(['docker run --rm \\', '  -v "$PWD":/work \\', '  alpine sh -c "ls /work"']).errors).toEqual([]);
  });

  it('a blob split over the lines of a figure is still reported once', () => {
    const blob = 'QmluYXJ5IHNlYXJjaCBmaW5kcyBhIHRhcmdldCB2YWx1ZSBpbiBhIHNvcnRlZCBhcnJheSBieSByZXBlYXRlZGx5IGNvbXBhcmluZyB0aGUgdGFyZ2V0IHdpdGggdGhlIG1pZGRsZSBlbGVtZW50Lg==';
    const check = session(['payload = (', blob.slice(0, 50), blob.slice(50, 100), blob.slice(100), ')']);
    expect(check.errors.map((e) => [e.code, e.path])).toEqual([['UNSAFE_COMMAND', 'figure.lines[1]']]);
  });
});
