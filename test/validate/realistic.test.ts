// Honest lessons on ordinary topics, written the way an agent writes them, must pass: a technical
// lesson full of status codes, a history lesson full of dates, and lessons in other languages.
// And the habits that would get such a lesson refused must be refused with a fix that says what
// to do, because an agent that cannot tell how to get through gives up.
import { describe, expect, it } from 'vitest';
import type { EvidenceInput, PlanInput } from '../../src/core/schema';
import type { SceneInput } from '../../src/core/types';
import { checkLesson, checkScene, verifyLesson } from '../../src/core/validate';
import { APOLLO_LESSON } from './fixtures/apollo';
import { HTTP_LESSON } from './fixtures/http';
import { assemble, codes, errorCodes, expectNoExcerptText, type LessonParts } from './helpers';

const scene = (parts: LessonParts, id: string): any => structuredClone(parts.scenes.find((s) => s.id === id));

describe.each([
  ['HTTP status codes (standard)', HTTP_LESSON],
  ['Apollo 11 (quick)', APOLLO_LESSON],
])('%s', (_name, parts) => {
  it('is accepted scene by scene and as a whole, with no error and no warning', () => {
    const draft = assemble(structuredClone(parts));
    for (const stored of draft.scenes) expect(codes(checkScene(stored, draft)), stored.id).toEqual([]);
    const report = checkLesson(draft);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.stats.words).toBeGreaterThan(100);
  });

  it('verifies from its published data', () => {
    const report = checkLesson(assemble(structuredClone(parts)));
    const verified = verifyLesson(JSON.parse(JSON.stringify(report.lesson)));
    expect(verified.errors).toEqual([]);
    expect(verified.hash).toBe(report.hash);
  });
});

describe('habits that get a technical lesson refused, and what the agent is told', () => {
  const draft = assemble(structuredClone(HTTP_LESSON));
  const run = (id: string, edit: (s: any) => void) => {
    const s = scene(HTTP_LESSON, id);
    edit(s);
    const check = checkScene(s, draft);
    expectNoExcerptText([...check.errors, ...check.warnings], draft);
    return check;
  };

  it('own arithmetic inside a cited claim', () => {
    const check = run('in-code', (s) => (s.steps[0].blocks[0].text = 'Because the first digit of the status code defines the class, dividing by 100 and rounding down is enough to find it.'));
    expect(errorCodes(check)).toEqual(['NUMBER_NOT_IN_SOURCE']);
    expect(check.errors[0]).toMatchObject({ path: 'steps[0].blocks[0].text', got: '100' });
    expect(check.errors[0]!.fix).toContain('it belongs in an example block');
    expect(check.errors[0]!.fix).toContain('write it in a code span');
    // Either way out is accepted: the notation in a code span, or the working in an example (as the fixture does).
    expect(run('in-code', (s) => (s.steps[0].blocks[0].text = 'Because the first digit of the status code defines the class, `Math.floor(res.status / 100)` is enough to find it.')).errors).toEqual([]);
  });

  it('an illustrative number on the arrow of a diagram', () => {
    const check = run('exchange', (s) => (s.figure.messages[0].label = 'GET /users/4217'));
    expect(errorCodes(check)).toEqual(['NUMBER_NOT_IN_SOURCE']);
    expect(check.errors[0]).toMatchObject({ path: 'figure.messages[0].label', got: '4217' });
    expect(check.errors[0]!.fix).toContain('write a symbol such as n or x, or a single digit');
    expect(run('exchange', (s) => (s.figure.messages[0].label = 'GET /users/7')).errors).toEqual([]);
    expect(run('exchange', (s) => (s.figure.messages[0].label = 'GET /users/{id}')).errors).toEqual([]);
    // A request line is notation, and a figure label takes a code span like any prose.
    expect(run('exchange', (s) => (s.figure.messages[0].label = '`GET /users/4217`')).errors).toEqual([]);
  });

  it('a status code that no stored excerpt mentions', () => {
    const check = run('whose-fault', (s) => (s.blocks[0].text = 'A 4xx code such as 429 is a client error response: something about the request itself has to change.'));
    expect(errorCodes(check)).toEqual(['NUMBER_NOT_IN_SOURCE']);
    expect(check.errors[0]!.fix).toContain('No stored excerpt contains it. Save the passage that states it and cite it, or remove the number.');
  });

  it('a download read through a formatter is how API lessons are written, and is accepted', () => {
    const check = run('in-code', (s) => {
      s.figure.lines[0] = 'curl -s https://api.example.com/users/42 | jq .status';
      s.figure.language = 'Shell';
    });
    expect(check.errors).toEqual([]);
  });

  it('a download piped into something that acts on it', () => {
    const check = run('in-code', (s) => (s.figure.lines[0] = 'curl -sL https://api.example.com/tool.tgz | tar xz'));
    expect(errorCodes(check)).toEqual(['UNSAFE_COMMAND']);
    expect(check.errors[0]!.path).toBe('figure.lines[0]');
    expect(check.errors[0]!.fix).toContain('two separate steps');
    // Written as the fix says, it is accepted.
    const fixed = run('in-code', (s) => {
      s.figure.lines = ['curl -s -o user.json https://api.example.com/users/42', 'jq .status user.json'];
      s.figure.language = 'Shell';
      s.steps[1].highlight = ['l1', 'l2'];
    });
    expect(fixed.errors).toEqual([]);
  });

  it('a real API host in the code that the lesson has no evidence from', () => {
    const check = run('in-code', (s) => (s.figure.lines[0] = 'const res = await fetch("https://api.github.com/users/octocat");'));
    expect(errorCodes(check)).toEqual(['UNKNOWN_HOST']);
    expect(check.errors[0]!.got).toBe('api.github.com');
    expect(check.errors[0]!.fix).toContain('Use example.com, example.org, example.net, localhost or 127.0.0.1');
  });

  it('a "read more" link in the recap', () => {
    const check = run('recap', (s) => (s.next[0].why = 'See https://developer.example.org/docs/http/methods for the full list.'));
    expect(errorCodes(check)).toEqual(['URL_IN_TEXT']);
    expect(check.errors[0]!.path).toBe('next[0].why');
  });

  it('the source sentence reused as a claim', () => {
    const check = run('whose-fault', (s) => (s.blocks[1].text = 'The 500 (Internal Server Error) status code indicates that the server encountered an unexpected condition that prevented it from fulfilling the request.'));
    expect(errorCodes(check)).toEqual(['CLAIM_COPIES_SOURCE']);
    const asQuote = run('whose-fault', (s) => (s.blocks[1] = { type: 'quote', text: 'the server encountered an unexpected condition that prevented it from fulfilling the request', cite: 'e5' }));
    expect(asQuote.errors).toEqual([]);
  });

  it('known limit: a claim cited to a neighbouring page on the same subject is not caught', () => {
    // The claim about three-digit codes is cited to the page about 404, which does not say it. The two
    // share the subject's vocabulary (HTTP, response, status, code), and a textual check cannot tell
    // "about the same thing" from "supports this". The product says so to the learner, shows the
    // excerpt beside the claim, and never calls a lesson verified.
    const check = run('intro', (s) => (s.blocks[1].cites = ['e2']));
    expect(codes(check)).toEqual([]);
    // What the check does catch is a citation to a page on something else.
    const unrelated = run('intro', (s) => (s.blocks[1].text = 'Cookies let a server remember a visitor between separate visits.'));
    expect(errorCodes(unrelated)).toEqual(['CLAIM_UNRELATED']);
  });
});

describe('lessons in other languages', () => {
  const spanish: LessonParts = {
    start: { topic: 'La fotosíntesis', language: 'es', depth: 'quick', learner: { level: 'new', knows: 'Sabe que las plantas necesitan luz.', goal: 'Explicar qué entra y qué sale en la fotosíntesis.' } },
    evidence: [
      { url: 'https://ciencia.example.org/biologia/fotosintesis', title: 'La fotosíntesis', via: 'page', excerpt: 'La fotosíntesis es el proceso por el cual las plantas, las algas y algunas bacterias transforman la energía de la luz en energía química. Utilizan dióxido de carbono y agua para producir glucosa y liberan oxígeno.' },
      { url: 'https://ciencia.example.org/biologia/cloroplastos', title: 'Los cloroplastos', via: 'page', excerpt: 'En las plantas, la fotosíntesis ocurre en los cloroplastos, orgánulos que contienen clorofila, el pigmento verde que absorbe la luz.' },
      { url: 'https://escuela.example.com/apuntes/fotosintesis-etapas', title: 'Etapas de la fotosíntesis', via: 'page', excerpt: 'La fase luminosa necesita luz y produce ATP y NADPH; en el ciclo de Calvin esas moléculas se emplean para fijar el dióxido de carbono en azúcares.' },
    ] as EvidenceInput[],
    plan: {
      title: 'La fotosíntesis: de la luz al azúcar',
      objectives: [{ id: 'o1', text: 'Explicar qué entra y qué sale en la fotosíntesis' }],
      outline: [
        { id: 's1', kind: 'narration', purpose: 'Qué es y dónde ocurre' },
        { id: 's2', kind: 'checkpoint', purpose: 'Qué entra y qué sale', question: 'single', objective: 'o1' },
        { id: 's3', kind: 'narration', purpose: 'Las dos etapas' },
        { id: 's4', kind: 'recap', purpose: 'Resumen' },
      ],
    } as PlanInput,
    scenes: [
      {
        id: 's1', kind: 'narration', title: 'Luz que se convierte en alimento',
        blocks: [
          { type: 'framing', text: '¿De dónde saca una planta su alimento si no come?' },
          { type: 'claim', text: 'En la fotosíntesis las plantas transforman la energía de la luz en energía química.', cites: ['e1'] },
          { type: 'claim', text: 'Para ello usan agua y dióxido de carbono, fabrican glucosa y liberan oxígeno.', cites: ['e1'] },
          { type: 'quote', text: 'el pigmento verde que absorbe la luz', cite: 'e2' },
        ],
      },
      {
        id: 's2', kind: 'checkpoint', title: 'Comprueba: entradas y salidas', objective: 'o1', level: 'recall',
        question: {
          type: 'single', prompt: '¿Qué libera una planta al hacer la fotosíntesis?',
          options: [
            { text: 'Oxígeno', correct: true, feedback: 'Sí: el oxígeno es lo que la planta libera al aire.' },
            { text: 'Dióxido de carbono', correct: false, feedback: 'Ese gas es lo que la planta toma del aire, no lo que suelta.', misconception: 'Confunde lo que entra con lo que sale' },
            { text: 'Clorofila', correct: false, feedback: 'La clorofila se queda en los cloroplastos: es el pigmento que capta la luz.', misconception: 'Cree que el pigmento es un producto' },
          ],
          explanation: { text: 'La planta utiliza dióxido de carbono y agua para producir glucosa y libera oxígeno.', cites: ['e1'] },
        },
      },
      {
        id: 's3', kind: 'narration', title: 'Dos etapas',
        blocks: [
          { type: 'claim', text: 'La fase luminosa produce ATP y NADPH, y el ciclo de Calvin los emplea para fijar el dióxido de carbono en azúcares.', cites: ['e3'] },
          { type: 'analogy', text: 'Es como cargar una batería de día para cocinar con ella después.', limits: 'Una batería guarda electricidad; aquí la energía queda en moléculas.' },
        ],
      },
      {
        id: 's4', kind: 'recap', title: 'Lo que ya sabes explicar',
        takeaways: [{ objective: 'o1', text: 'Entran luz, agua y dióxido de carbono; salen glucosa y oxígeno.', cites: ['e1'] }],
        next: [{ topic: 'La respiración celular', why: 'Es el proceso inverso: cómo se aprovecha la glucosa.' }],
      },
    ] as unknown as SceneInput[],
  };

  const japanese: LessonParts = {
    start: { topic: '光合成のしくみ', language: 'ja', depth: 'quick', learner: { level: 'new', knows: '植物に光が必要だと知っている。', goal: '光合成で何が使われ、何ができるかを説明する。' } },
    evidence: [
      { url: 'https://kagaku.example.org/seibutsu/kougousei', title: '光合成とは', via: 'page', excerpt: '光合成とは、植物や藻類が光のエネルギーを使って、二酸化炭素と水からデンプンなどの養分と酸素をつくるはたらきである。' },
      { url: 'https://kagaku.example.org/seibutsu/youryokutai', title: '葉緑体', via: 'page', excerpt: '光合成は、細胞の中にある葉緑体で行われる。葉緑体には葉緑素という緑色の色素が含まれ、光を吸収する。' },
      { url: 'https://gakushu.example.com/rika/kikou', title: '気孔のはたらき', via: 'page', excerpt: '二酸化炭素は葉の裏側に多い気孔から取り入れられ、光合成でできた酸素も気孔から出ていく。' },
    ] as EvidenceInput[],
    plan: {
      title: '光合成：光から養分へ',
      objectives: [{ id: 'o1', text: '光合成で使われるものと、つくられるものを説明する' }],
      outline: [
        { id: 's1', kind: 'narration', purpose: '光合成とは何か、どこで起こるか' },
        { id: 's2', kind: 'checkpoint', purpose: '材料とできるものを確かめる', question: 'single', objective: 'o1' },
        { id: 's3', kind: 'narration', purpose: '気孔の役割' },
        { id: 's4', kind: 'recap', purpose: 'まとめ' },
      ],
    } as PlanInput,
    scenes: [
      {
        id: 's1', kind: 'narration', title: '光を養分に変える',
        blocks: [
          { type: 'framing', text: '植物は何も食べないのに、どうやって育つのでしょうか。' },
          { type: 'claim', text: '植物は光のエネルギーを使い、二酸化炭素と水から養分と酸素をつくります。', cites: ['e1'] },
          { type: 'claim', text: 'このはたらきは細胞の中の葉緑体で行われ、葉緑素が光を吸収します。', cites: ['e2'] },
          { type: 'quote', text: '葉緑素という緑色の色素', cite: 'e2' },
        ],
      },
      {
        id: 's2', kind: 'checkpoint', title: '確認：材料は何？', objective: 'o1', level: 'recall',
        question: {
          type: 'single', prompt: '光合成の材料になるものはどれですか。',
          options: [
            { text: '二酸化炭素と水', correct: true, feedback: 'そのとおり。この二つから養分がつくられます。' },
            { text: '酸素とデンプン', correct: false, feedback: 'それは光合成でできるものです。材料ではありません。', misconception: '材料と生成物を取り違えている' },
            { text: '葉緑素と気孔', correct: false, feedback: '葉緑素は色素、気孔は出入り口で、材料ではありません。', misconception: '植物の部分を材料だと考えている' },
          ],
          explanation: { text: '植物は二酸化炭素と水から、養分と酸素をつくります。', cites: ['e1'] },
        },
      },
      {
        id: 's3', kind: 'narration', title: '気体の出入り口',
        blocks: [{ type: 'claim', text: '二酸化炭素は気孔から取り入れられ、できた酸素も気孔から出ていきます。', cites: ['e3'] }],
      },
      {
        id: 's4', kind: 'recap', title: '説明できること',
        takeaways: [{ objective: 'o1', text: '光合成では、光を使って二酸化炭素と水から養分と酸素ができます。', cites: ['e1'] }],
        next: [{ topic: '植物の呼吸', why: '光合成と反対に、酸素を使うはたらきです。' }],
      },
    ] as unknown as SceneInput[],
  };

  it.each([
    ['Spanish', spanish],
    ['Japanese', japanese],
  ])('an honest lesson in %s passes', (_name, parts) => {
    const report = checkLesson(assemble(structuredClone(parts)));
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.lesson!.language).toBe(parts.start.language);
  });

  it('accents typed in decomposed form match the same words in the source', () => {
    const parts = structuredClone(spanish);
    (parts.scenes[0] as any).blocks[1].text = (parts.scenes[0] as any).blocks[1].text.normalize('NFD');
    (parts.scenes[0] as any).blocks[3].text = 'el pigmento verde que absorbe la luz'.normalize('NFD');
    expect(checkLesson(assemble(parts)).errors).toEqual([]);
  });

  it('a claim on another subject is still caught in Spanish and in Japanese', () => {
    const es = assemble(structuredClone(spanish));
    const s1 = scene(spanish, 's1');
    s1.blocks[1].text = 'Los volcanes expulsan lava cuando aumenta la presión del magma subterráneo.';
    expect(codes(checkScene(s1, es))).toContain('CLAIM_UNRELATED');

    const ja = assemble(structuredClone(japanese));
    const j1 = scene(japanese, 's1');
    j1.blocks[1].text = '火山は地下のマグマの圧力が高まると噴火します。';
    expect(codes(checkScene(j1, ja)).some((c) => c === 'CLAIM_UNRELATED' || c === 'CLAIM_WEAK_MATCH')).toBe(true);
  });

  it('a copied sentence and a misquote are caught in Japanese, where words are not separated by spaces', () => {
    const ja = assemble(structuredClone(japanese));
    const copy = scene(japanese, 's1');
    copy.blocks[1].text = '光合成とは、植物や藻類が光のエネルギーを使って、二酸化炭素と水からデンプンなどの養分と酸素をつくるはたらきである。';
    expect(errorCodes(checkScene(copy, ja))).toEqual(['CLAIM_COPIES_SOURCE']);
    const misquote = scene(japanese, 's1');
    misquote.blocks[3].text = '葉緑素という青色の色素';
    const check = checkScene(misquote, ja);
    expect(errorCodes(check)).toEqual(['QUOTE_NOT_FOUND']);
    expect(check.errors[0]!.source!.evidenceId).toBe('e2');
  });

  it('numbers written in another script are matched by value', () => {
    const parts = structuredClone(japanese);
    parts.evidence.push({ url: 'https://kagaku.example.org/seibutsu/sanso', title: '酸素の割合', via: 'page', excerpt: '空気中の酸素の割合はおよそ２１パーセントで、その多くは光合成によってつくられたものである。' });
    (parts.scenes[2] as any).blocks.push({ type: 'claim', text: '空気の約21パーセントは酸素で、多くは光合成でつくられました。', cites: ['e4'] });
    expect(checkLesson(assemble(parts)).errors).toEqual([]);
    (parts.scenes[2] as any).blocks[1].text = '空気の約30パーセントは酸素で、多くは光合成でつくられました。';
    const draft = assemble({ ...parts, scenes: parts.scenes.filter((s) => s.id !== 's3') });
    expect(errorCodes(checkScene(parts.scenes[2], draft))).toEqual(['NUMBER_NOT_IN_SOURCE']);
  });
});
