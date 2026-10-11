// Clips for the server tests, made the way an agent makes them: by filling in the templates that
// plan_lesson returns.
//
// `fillTemplate` takes a template exactly as the tool returned it and replaces every piece of
// placeholder text, by the name of the field it is in, with text that rests on a stored passage.
// It changes no id, no verb and no structure, so a scene it returns is "the template, filled in":
// if submit_scene accepts it, the template for that stage kind is one an agent can complete.
//
// `largeClipLesson` is the largest lesson of clips the rules allow, for the tests of result sizes:
// deep, sixteen scenes, twelve clips of eight beats each over every stage kind (two of them custom
// frames, the most a lesson may have), and forty stored passages.
//
// The passages are the generated ones of the validator's own tests (ten invented words and a
// number each), so a caption can be grounded in exactly one passage by reusing its words.
import { PLAN_STAGE_KINDS } from '../../../src/core/schema';
import { buildEvidence, evidenceWords } from '../../validate/build';
import type { LessonParts } from './kit';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;
export type StageKind = (typeof PLAN_STAGE_KINDS)[number];

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A stored passage as a caption can use it: its id, and the words it is made of. */
export interface Passage {
  id: string;
  words: string[];
}

/** Passage `index` (0-based) of the generated evidence: stored as e<index + 1>. */
export const passage = (index: number): Passage => ({ id: `e${index + 1}`, words: evidenceWords(index) });

/** A fact stated in the words of a passage: three of its words among others, so it is grounded and is not a copy. */
export function claimText(p: Passage, n: number): string {
  const w = (i: number): string => p.words[(n + i) % p.words.length] as string;
  return `${cap(w(0))} ${w(1)} ${w(2)} is what this part of the clip shows.`;
}

/** Four words in a row, exactly as the passage has them (its first word is capitalised there, so it is not used). */
export const quoteText = (p: Passage): string => p.words.slice(3, 7).join(' ');

const DESCRIPTION = 'The parts of the stage arrive one after another, one of them is marked, and a short caption says what each change means.';
const FRAMING = 'Watch what changes on the stage next.';
const EXAMPLE = 'Take one worked case: the part in the middle is looked at before any other.';
/** A gate answered on the picture: the words of the cells template's tap gate, written; `pick` is the template's own. */
const TAP_GATE = {
  prompt: 'Which part is looked at first?',
  right: 'The part in the middle is the one this move acts on.',
  wrong: 'Look for the part every clip marks before any other.',
};
/** The words of an explore, written. Kept short: they are the writer's own, and count as uncited prose. */
const EXPLORE = { prompt: 'Drag the slider and watch.', goal: 'Make the marked part the larger one.', done: 'The slider took it past the other part.' };
const GATE = {
  prompt: 'What will the picture show next?',
  options: [
    { text: 'The middle part changes', correct: true, feedback: 'Yes: the part in the middle is the one this move acts on.' },
    { text: 'The first part goes away', correct: false, feedback: 'No: the first part stays where it is while the middle one changes.' },
  ],
};

/**
 * Code for a frame, written as a careful agent writes it: laid out from S.W and S.H, colours from
 * the theme, every move a function of t. It reads the slider the frame template declares.
 */
export const FRAME_CODE = [
  '// Five bars that grow to a height the learner sets.',
  'const BARS = 5;',
  '',
  'function render(ctx, t) {',
  '  const { W, H, theme: c } = S;',
  '  S.clear();',
  '  const grow = S.prog(t, 0, 2, S.ease.out);',
  '  for (let i = 0; i < BARS; i++) {',
  '    const h = H * 0.12 * (i + 1) * grow * (S.params.amount / 10);',
  '    S.rect(W * (0.18 + i * 0.13), H * 0.85 - h, W * 0.09, h, { fill: c.accentSoft, stroke: c.accent, lw: 2, r: 6 });',
  '  }',
  '}',
  '',
].join('\n');

/**
 * Code that passes every frame check and that any tidying would change: a carriage return and line
 * feed, a tab, runs of spaces, spaces at the ends of lines, blank lines at both ends, a letter and
 * its accent as two code points (not the single composed one), a no-break space, an emoji, and the
 * text of a closing script tag and of an HTML comment. It reads the same slider.
 */
export const AWKWARD_CODE = [
  '\n',
  '  // A frame whose text must arrive exactly as it was written.\r\n',
  '\tconst label = "cafe\u0301  au  lait";   \n',
  "  const tag = '</script><!-- & < > \u00a0 -->';\n",
  '  const mark = "\u{1F9EA}";\n',
  '\n\n',
  'function render(ctx, t) {\n',
  '\tS.clear();\n',
  '\tconst size = 12 + S.params.amount;\n',
  '\tS.text(label + mark + tag.length, S.W / 2, S.H / 2, { size: size, align: "center", alpha: S.prog(t, 0, 1) });\n',
  '}\n',
  '   \n\n',
].join('');

export interface FillOptions {
  /** The scene's title. Letters only: a number in a title has to be in a passage. */
  title: string;
  /** The passage the stage and the first captions rest on. */
  a: Passage;
  /** A second passage, for the captions added when `beats` asks for more than the template has. */
  b?: Passage;
  /** How many beats the scene should have. Default: as many as the template. */
  beats?: number;
  /** The code of a frame stage. Default: FRAME_CODE. */
  code?: string;
}

/** A part of each typed stage that `focus` can name at any point after the template's own beats. */
const FOCUS: Record<Exclude<StageKind, 'frame'>, string> = { sequence: 'left', cells: 'c1', dots: 'few', chart: 'a', flow: 'a', words: 'hook', lines: 'l1', timeline: 't1' };

/** The template for a clip, as plan_lesson returned it, with every placeholder replaced. */
export function fillTemplate(template: Json, o: FillOptions): Json {
  const scene: Json = structuredClone(template);
  const kind = scene.stage.kind as StageKind;
  let next = 0;
  const word = (): string => o.a.words[next++ % o.a.words.length] as string;

  // Text by the name of the field it is in. Ids, verbs, tones and other choices are left alone.
  const fill = (value: unknown, key: string): unknown => {
    if (Array.isArray(value)) {
      // The lines of a `lines` stage are plain strings; every other list holds parts or actions.
      if (key === 'lines' && value.every((item) => typeof item === 'string')) return value.map((_, i) => `${word()} = ${word()}${i === 0 ? '' : ` + ${word()}`}`);
      return value.map((item) => fill(item, key));
    }
    if (typeof value === 'object' && value !== null) {
      const out: Json = {};
      for (const [k, v] of Object.entries(value)) out[k] = k === 'caption' || k === 'gate' ? v : fill(v, k);
      return out;
    }
    if (typeof value !== 'string') return value;
    switch (key) {
      case 'label':
      case 'when':
      case 'yLabel':
        return word();
      case 'unit':
        return 'x';
      case 'legend':
        return `1 dot = 1 ${word()}`;
      case 'text':
        return `${word()} ${word()} ${word()}`;
      case 'detail':
        return `${cap(word())} ${word()} ${word()}.`;
      case 'code':
        return o.code ?? FRAME_CODE;
      default:
        return value;
    }
  };

  scene.title = o.title;
  scene.description = DESCRIPTION;
  scene.stage = fill(scene.stage, 'stage');
  // Both passages stand behind the stage, so each is one a teaching scene cites.
  scene.stage.cites = [o.a.id, ...(o.b ? [o.b.id] : [])];
  // A template that ends in an explore (dots, a chart): its formulas, its control and its goal's condition are kept as they came; only the words are written.
  if (scene.explore) {
    scene.explore.prompt = EXPLORE.prompt;
    for (const control of scene.explore.controls as Json[]) control.label = word();
    if (scene.explore.goal) Object.assign(scene.explore.goal, { text: EXPLORE.goal, done: EXPLORE.done });
  }

  let claims = 0;
  const caption = (type: string, from: Passage): Json => {
    if (type === 'claim') return { type: 'claim', text: claimText(from, claims++), cites: [from.id] };
    if (type === 'quote') return { type: 'quote', text: quoteText(from), cite: from.id };
    if (type === 'example') return { type: 'example', text: EXAMPLE, basedOn: [from.id] };
    // An analogy is counted with its limits, so both are kept short.
    if (type === 'analogy') return { type: 'analogy', text: 'It is like finding a word in a dictionary.', limits: 'A dictionary never moves its words.' };
    return { type: 'framing', text: FRAMING };
  };
  scene.beats = (scene.beats as Json[]).map((beat) => {
    const out = fill(beat, 'beat') as Json;
    out.caption = caption(beat.caption.type as string, o.a);
    // A gate answered by a tap keeps the part the template names; a prediction by options is written whole.
    if (beat.gate) out.gate = beat.gate.pick ? { ...structuredClone(TAP_GATE), pick: beat.gate.pick } : structuredClone(GATE);
    return out;
  });

  // More beats, up to the number asked for: each a fact from a passage and one change on the stage.
  const wanted = Math.max(scene.beats.length, o.beats ?? scene.beats.length);
  const last = scene.beats.at(-1) as Json;
  for (let i = scene.beats.length, added = 0; i < wanted; i++, added++) {
    const from = added < 2 || !o.b ? o.a : o.b;
    if (kind === 'frame') {
      // Captions of a frame are timed: each a second after the one before, inside the animation.
      const at = (last.at as number) + added + 1;
      scene.beats.push({ caption: caption('claim', from), at });
      scene.stage.duration = Math.max(scene.stage.duration as number, at + 2);
    } else {
      scene.beats.push({ caption: caption('claim', from), do: [added % 2 === 0 ? { verb: 'focus', targets: [FOCUS[kind]] } : { verb: 'focus' }] });
    }
  }
  return scene;
}

// ---------------------------------------------------------------------------------------------
// A plan with one clip of every stage kind
// ---------------------------------------------------------------------------------------------

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const START = { topic: 'How the generated machine sorts its parts', language: 'en', depth: 'deep', learner: { level: 'new', knows: 'Nothing about the topic yet.', goal: 'Explain how it works.' } };
const OBJECTIVES = [
  { id: 'o1', text: 'Say which part the machine looks at first' },
  { id: 'o2', text: 'Trace one pass of the machine over its parts' },
  { id: 'o3', text: 'Explain why the machine needs its parts in order' },
];

function checkpoint(id: string, objective: string, p: Passage): Json {
  return {
    id,
    kind: 'checkpoint',
    title: `Check: objective ${objective.slice(1) === '1' ? 'one' : objective.slice(1) === '2' ? 'two' : 'three'}`,
    objective,
    level: 'apply',
    question: {
      type: 'single',
      prompt: 'Which part does the move in the last clip act on?',
      options: [
        { text: 'The part in the middle', correct: true, feedback: 'Yes: every clip so far marks the middle part before any other.' },
        { text: 'The part at the far end', correct: false, feedback: 'No: the far end is only reached after the middle has been marked.', misconception: 'That the move starts from an end' },
        { text: 'All the parts at once', correct: false, feedback: 'No: one part is marked at a time, which is the point of the move.', misconception: 'That every part is handled together' },
      ],
      explanation: { text: claimText(p, 5), cites: [p.id] },
    },
  };
}

function recap(passages: readonly Passage[]): Json {
  return {
    id: 'end',
    kind: 'recap',
    title: 'What you can do now',
    takeaways: OBJECTIVES.map((objective, i) => ({ objective: objective.id, text: claimText(passages[i] as Passage, 6), cites: [(passages[i] as Passage).id] })),
    next: [{ topic: 'How the machine is built', why: 'It shows where the parts come from before they are sorted.' }],
  };
}

export interface ClipLesson extends LessonParts {
  /** The stage kind of each clip, by scene id. */
  stages: Record<string, StageKind>;
  /** Turn the templates plan_lesson returned into the scenes of the lesson, in outline order. */
  scenesFrom(templates: readonly Json[]): Json[];
}

/**
 * A deep lesson: `clips` are the stage kinds of its clips, in order, with a checkpoint after every
 * `every` clips (three in all) and the recap at the end. Clip i rests on passages 2i and 2i + 1.
 */
function clipLesson(title: string, clips: readonly StageKind[], beats: number | undefined, evidence: number, code: (i: number) => string | undefined = () => undefined): ClipLesson {
  const outline: Json[] = [];
  const stages: Record<string, StageKind> = {};
  const cuts = [Math.ceil(clips.length / 3), Math.ceil((2 * clips.length) / 3), clips.length];
  clips.forEach((stage, i) => {
    const id = `k${LETTERS[i]}`;
    stages[id] = stage;
    outline.push({ id, kind: 'clip', purpose: `Show one move of the machine on a ${stage} stage`, stage });
    const cut = cuts.indexOf(i + 1);
    if (cut !== -1) outline.push({ id: `q${cut + 1}`, kind: 'checkpoint', purpose: 'Check the move just shown', question: 'single', objective: `o${cut + 1}` });
  });
  outline.push({ id: 'end', kind: 'recap', purpose: 'What the learner can now do' });
  const clipIndex = (id: string): number => LETTERS.indexOf(id[1] as string);
  return {
    start: START,
    evidence: Array.from({ length: evidence }, (_, i) => buildEvidence(i)),
    plan: { title, objectives: OBJECTIVES, outline },
    scenes: [],
    stages,
    scenesFrom(templates) {
      return templates.map((template) => {
        if (template.kind === 'clip') {
          const i = clipIndex(template.id as string);
          return fillTemplate(template, { title: `Move ${LETTERS[i]} on a ${template.stage.kind} stage`, a: passage(2 * i), b: passage(2 * i + 1), beats, code: code(i) });
        }
        // A checkpoint rests on the second passage of the clip before it, and the recap on those of the first three clips.
        if (template.kind === 'checkpoint') return checkpoint(template.id as string, template.objective as string, passage(2 * (cuts[Number((template.id as string).slice(1)) - 1] as number) - 1));
        return recap([passage(1), passage(3), passage(5)]);
      });
    },
  };
}

/** One clip of every stage kind, each as its template has it (two or three beats), in a deep lesson of thirteen scenes. */
export function everyStageLesson(): ClipLesson {
  return clipLesson('One clip of every kind', PLAN_STAGE_KINDS, undefined, 18);
}

/**
 * The largest lesson of clips the rules allow: deep, sixteen scenes (twelve clips, three
 * checkpoints, the recap), every clip at eight beats, every stage kind, two custom frames, and
 * forty stored passages.
 */
export function largeClipLesson(): ClipLesson {
  const kinds: StageKind[] = ['words', 'flow', 'cells', 'sequence', 'chart', 'dots', 'lines', 'timeline', 'frame', 'cells', 'frame', 'dots'];
  return clipLesson('The largest lesson of clips', kinds, 8, 40);
}
