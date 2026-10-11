// Review finding V4 and the validator half of R6: the language tag on an evidence item.
//
// A tag that names another language than the lesson's switches the word-overlap checks off, as the
// contract says it must (a French passage shares no word with an English claim). What was wrong is
// that tags naming the SAME language ("eng" for English), or no language at all ("und"), counted as
// foreign and switched the checks off too. And when a tag is missing in a lesson that is not in
// English, the rejection now says so.
import { describe, expect, it } from 'vitest';
import type { Draft } from '../../src/core/types';
import { checkLesson, checkScene } from '../../src/core/validate';
import { primaryLanguage } from '../../src/core/validate/context';
import { applyPlan, codes, errorCodes, exampleDraft, exampleScene, newDraft, saveEvidence, submit, warningCodes } from './helpers';

const HONEY = 'Honey never spoils, and archaeologists have eaten jars found in Egyptian tombs.';

/** The example draft with e3 stored under `lang`, and the scene s7 whose first claim is `text` citing e3. */
function tagged(lang: string | undefined, text: string): { draft: Draft; scene: any } {
  const draft = exampleDraft();
  const e3 = { ...draft.evidence[2]! };
  if (lang === undefined) delete e3.lang;
  else e3.lang = lang;
  draft.evidence[2] = e3;
  const scene = exampleScene('s7');
  scene.blocks[0] = { type: 'claim', text, cites: ['e3'] };
  return { draft, scene };
}

describe('V4: which tags make an excerpt foreign', () => {
  it.each([undefined, 'en', 'en-US', 'EN', 'en-Latn', 'eng', 'ENG', 'eng-US', 'und', 'zxx', 'mul', 'mis'])('lang %s on an English excerpt in an English lesson: the claim is still compared', (lang) => {
    const { draft, scene } = tagged(lang, HONEY);
    const check = checkScene(scene, draft);
    expect(errorCodes(check)).toEqual(['CLAIM_UNRELATED']);
    expect(check.errors[0]!.path).toBe('blocks[0]');
  });

  it('an excerpt tagged "eng" gets every claim check, the copy rule and the weak match included', () => {
    const copy = tagged('eng', 'Binary search only works when the data is sorted, and on unsorted data the half that is discarded may contain the target, so the result is unreliable.');
    expect(errorCodes(checkScene(copy.scene, copy.draft))).toEqual(['CLAIM_COPIES_SOURCE']);
    const weak = tagged('eng', 'Sorted playlists help listeners locate favourite recordings without scrolling endlessly.');
    expect(warningCodes(checkScene(weak.scene, weak.draft))).toEqual(['CLAIM_WEAK_MATCH']);
    // And an honest claim on it passes exactly as it does without the tag.
    const honest = tagged('eng', 'Binary search is only reliable when the data is sorted.');
    expect(codes(checkScene(honest.scene, honest.draft))).toEqual([]);
  });

  it.each(['la', 'de', 'deu', 'fra', 'ja'])('lang %s names another language: word overlap is not judged, as the contract says', (lang) => {
    const { draft, scene } = tagged(lang, HONEY);
    expect(checkScene(scene, draft).errors).toEqual([]);
  });

  it('three-letter and two-letter codes for the lesson\'s own language agree in any lesson language', () => {
    const start = { topic: 'Die binäre Suche', language: 'de', depth: 'quick' as const, learner: { level: 'new' as const, knows: 'Kennt einfache Schleifen.', goal: 'Die binäre Suche erklären.' } };
    for (const lang of ['de', 'deu', 'ger', 'de-AT', undefined]) {
      const draft = newDraft(start);
      saveEvidence(draft, { url: 'https://informatik.example.org/suche', title: 'Binäre Suche (synthetisch)', via: 'page', excerpt: 'Die binäre Suche vergleicht das gesuchte Element mit dem mittleren Element und verwirft die Hälfte, die es nicht enthalten kann.', ...(lang ? { lang } : {}) });
      applyPlan(draft, { title: 'Die binäre Suche', objectives: [{ id: 'o1', text: 'Einen Durchlauf der binären Suche beschreiben' }], outline: [{ id: 's1', kind: 'narration', purpose: 'Idee' }, { id: 's2', kind: 'narration', purpose: 'Beispiel' }, { id: 's3', kind: 'checkpoint', purpose: 'Frage', question: 'single', objective: 'o1' }, { id: 's4', kind: 'recap', purpose: 'Rückblick' }] });
      const scene = (text: string) => ({ id: 's1', kind: 'narration', title: 'Die Idee', blocks: [{ type: 'claim', text, cites: ['e1'] }] });
      expect(errorCodes(checkScene(scene('Honig verdirbt nie, und Archäologen haben Gläser aus ägyptischen Gräbern gegessen.'), draft)), String(lang)).toEqual(['CLAIM_UNRELATED']);
      expect(checkScene(scene('Die binäre Suche verwirft bei jedem Vergleich die Hälfte, die das Element nicht enthalten kann.'), draft).errors, String(lang)).toEqual([]);
    }
  });

  it('an ordinary lesson built on sources in another language is not warned about or refused', () => {
    // German lesson, every excerpt English and tagged so: the overlap checks are skipped for all of
    // it, and that must not count against the lesson (eight claims would otherwise all be "weak").
    const start = { topic: 'Die binäre Suche', language: 'de', depth: 'quick' as const, learner: { level: 'new' as const, knows: 'Kennt einfache Schleifen.', goal: 'Die binäre Suche erklären.' } };
    const draft = newDraft(start);
    const excerpts = [
      'Binary search finds a target value in a sorted array by repeatedly comparing the target with the middle element and discarding the half that cannot contain it.',
      'Each comparison halves the remaining search interval, so an array of n elements needs at most about log2(n) + 1 comparisons.',
      'Binary search only works when the data is sorted. On unsorted data the half that is discarded may contain the target.',
    ];
    excerpts.forEach((excerpt, i) => saveEvidence(draft, { url: `https://algorithms.example.${['org', 'com', 'net'][i]}/page-${i + 1}`, title: `Binary search, part ${i + 1} (synthetic)`, via: 'page', lang: 'en', excerpt }));
    applyPlan(draft, { title: 'Die binäre Suche in fünf Minuten', objectives: [{ id: 'o1', text: 'Einen Durchlauf der binären Suche beschreiben' }], outline: [{ id: 's1', kind: 'narration', purpose: 'Idee' }, { id: 's2', kind: 'narration', purpose: 'Kosten' }, { id: 's3', kind: 'checkpoint', purpose: 'Frage', question: 'single', objective: 'o1' }, { id: 's4', kind: 'recap', purpose: 'Rückblick' }] });
    const scenes = [
      { id: 's1', kind: 'narration', title: 'Die Idee', blocks: [{ type: 'claim', text: 'Die binäre Suche vergleicht den gesuchten Wert mit dem mittleren Element eines sortierten Feldes.', cites: ['e1'] }, { type: 'claim', text: 'Die Hälfte, die den Wert nicht enthalten kann, wird verworfen.', cites: ['e1'] }] },
      { id: 's2', kind: 'narration', title: 'Die Kosten', blocks: [{ type: 'claim', text: 'Jeder Vergleich halbiert den Bereich, der noch durchsucht werden muss.', cites: ['e2'] }, { type: 'claim', text: 'Das Verfahren setzt voraus, dass die Daten sortiert sind.', cites: ['e3'] }] },
      { id: 's3', kind: 'checkpoint', title: 'Frage: was passiert in einem Durchlauf?', objective: 'o1', level: 'recall', question: { type: 'single', prompt: 'Was geschieht mit der Hälfte, die den Wert nicht enthalten kann?', options: [
        { text: 'Sie wird verworfen', correct: true, feedback: 'Genau: diese Hälfte kann den Wert nicht enthalten und fällt weg.' },
        { text: 'Sie wird zuerst durchsucht', correct: false, feedback: 'Dort kann der Wert nicht liegen, also bringt die Suche darin nichts.', misconception: 'Glaubt, beide Hälften würden durchsucht' },
        { text: 'Sie wird neu sortiert', correct: false, feedback: 'Das Feld ist schon sortiert; beim Suchen wird nichts sortiert.', misconception: 'Verwechselt Suchen mit Sortieren' } ],
        explanation: { text: 'Der Wert wird mit dem mittleren Element verglichen, und die Hälfte ohne den Wert wird verworfen.', cites: ['e1'] } } },
      { id: 's4', kind: 'recap', title: 'Was du jetzt kannst', takeaways: [{ objective: 'o1', text: 'Mit dem mittleren Element vergleichen und die Hälfte verwerfen, die den Wert nicht enthalten kann.', cites: ['e1'] }], next: [{ topic: 'Die O-Notation', why: 'Um zu sagen, wie die Kosten wachsen.' }] },
    ];
    for (const scene of scenes) expect(codes(submit(draft, scene)), scene.id).toEqual([]);
    const report = checkLesson(draft);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.weakClaims).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('primaryLanguage gives the canonical primary subtag, or null for a tag that names no language', () => {
    expect(['en', 'EN', 'en-GB', 'en-Latn-US', 'eng', 'ENG'].map(primaryLanguage)).toEqual(['en', 'en', 'en', 'en', 'en', 'en']);
    expect(['fr', 'fra', 'fre', 'de', 'deu', 'ger', 'zh-Hans', 'pt-BR', 'ja'].map(primaryLanguage)).toEqual(['fr', 'fr', 'fr', 'de', 'de', 'de', 'zh', 'pt', 'ja']);
    expect(['und', 'zxx', 'mul', 'mis', 'UND', 'und-Latn'].map(primaryLanguage)).toEqual([null, null, null, null, null, null]);
    // Whatever the tag is, the function answers.
    expect(() => primaryLanguage('not a tag at all')).not.toThrow();
    expect(() => primaryLanguage('')).not.toThrow();
  });
});

describe('R6: a rejection in a lesson that is not in English says when a missing lang may be the cause', () => {
  const start = { topic: '日本の人口', language: 'ja', depth: 'quick' as const, learner: { level: 'some' as const, knows: '基本は知っている。', goal: '人口の推移を説明する。' } };
  const item = { url: 'https://stats.example.org/population', title: 'Population estimates (synthetic)', via: 'page', excerpt: 'The total population of Japan was 124.35 million as of October 1, 2023, a decrease of 595 thousand from the previous year.' };
  const plan = { title: '日本の人口の推移', objectives: [{ id: 'o1', text: '日本の人口の推移を説明する' }], outline: [{ id: 's1', kind: 'narration', purpose: '導入' }, { id: 's2', kind: 'narration', purpose: '詳細' }, { id: 's3', kind: 'checkpoint', purpose: '確認', question: 'single', objective: 'o1' }, { id: 's4', kind: 'recap', purpose: 'まとめ' }] };
  const claim = { id: 's1', kind: 'narration', title: '人口', blocks: [{ type: 'claim', text: '日本の総人口は前年より減少した。', cites: ['e1'] }] };
  const japanese = (lang?: string): Draft => {
    const draft = newDraft(start);
    saveEvidence(draft, lang ? { ...item, lang } : item);
    applyPlan(draft, plan);
    return draft;
  };

  it('an English excerpt saved without lang: the claim is refused, and the fix names lang as something to check', () => {
    const check = checkScene(claim, japanese());
    expect(errorCodes(check)).toEqual(['CLAIM_UNRELATED']);
    const fix = check.errors[0]!.fix;
    expect(fix).toContain('If e1 is in another language than this lesson (ja), and only then, the evidence item needs "lang"');
    expect(fix).toContain('save the passage again with "lang" set to the language it is in');
    // The honest way out still comes first, and the warning against bending the claim stays.
    expect(fix.indexOf('Save the passage that supports the claim')).toBe(0);
    expect(fix).toContain('Do not reword the claim to borrow words');
  });

  it('the same excerpt saved with lang is accepted', () => {
    expect(checkScene(claim, japanese('en')).errors).toEqual([]);
  });

  it('the hint is not printed in an English lesson, nor when the cited excerpt already names a language', () => {
    const { draft, scene } = tagged(undefined, HONEY);
    expect(checkScene(scene, draft).errors[0]!.fix).not.toContain('"lang"');

    const sameLanguage = japanese('ja');
    const check = checkScene(claim, sameLanguage);
    // Tagged as Japanese, the English text is compared and shares nothing: refused, with no talk of lang.
    expect(errorCodes(check)).toEqual(['CLAIM_UNRELATED']);
    expect(check.errors[0]!.fix).not.toContain('"lang"');
  });

  it('a weak match on an untagged excerpt in such a lesson carries the same hint', () => {
    const draft = japanese();
    const weak = checkScene({ ...claim, blocks: [{ type: 'claim', text: 'Japan の総人口は前年より減少し、多くの地域で高齢化が進んでいる。', cites: ['e1'] }] }, draft);
    expect(weak.errors).toEqual([]);
    expect(warningCodes(weak)).toContain('CLAIM_WEAK_MATCH');
    expect(weak.warnings.find((w) => w.code === 'CLAIM_WEAK_MATCH')!.fix).toContain('the evidence item needs "lang"');
  });
});
