// A generator of whole lessons that an honest agent could have written, in made-up words, for the
// tests that need lessons of every size and shape: the satisfiability property, the performance
// bound, determinism, and the whole-lesson fixtures.
//
// Excerpts are ten invented words and a number. A claim reuses three of its excerpt's words among
// words of its own, so it is grounded without being a copy. Everything is derived from a seed.
import { DEPTHS, LIMITS as L, type Depth } from '../../src/core/limits';
import { FIGURE_TYPES, QUESTION_TYPES, type EvidenceInput, type FigureType, type OutlineEntry, type PlanInput, type QuestionType, type SceneKind } from '../../src/core/schema';
import { contentTokens } from '../../src/core/text';
import type { FigureInput, QuestionInput, SceneInput, StartInputRaw } from '../../src/core/types';
import type { LessonParts } from './helpers';

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

const CONSONANTS = 'bdfgklmnprstvz';
const VOWELS = 'aeiou';

/** Invented five-letter words, each its own content token. */
const VOCABULARY: string[] = (() => {
  const all: string[] = [];
  for (const a of CONSONANTS) for (const b of VOWELS) for (const c of CONSONANTS) for (const d of VOWELS) for (const e of CONSONANTS) all.push(a + b + c + d + e);
  const out: string[] = [];
  // A stride through the space, so neighbouring picks do not look alike.
  for (let i = 0, at = 17; out.length < 4000 && i < all.length; i++, at = (at + 7919) % all.length) {
    const word = all[at] as string;
    const tokens = contentTokens(word, 'en');
    if (tokens.length === 1 && tokens[0] === word) out.push(word);
  }
  return out;
})();

export const EVIDENCE_WORDS = 10;
export const MAX_EVIDENCE = L.evidencePerLesson;
/** Words that appear in no excerpt. */
const NEUTRAL = VOCABULARY.slice(MAX_EVIDENCE * EVIDENCE_WORDS);

function rng(seed: number): () => number {
  let a = (seed >>> 0) + 0x9e3779b9;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
export const sentence = (words: readonly string[]): string => `${cap(words.join(' '))}.`;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
/** a, b, ..., z, ba, bb: a label without digits. */
export const letters = (n: number): string => (n < 26 ? (LETTERS[n] as string) : letters(Math.floor(n / 26)) + (LETTERS[n % 26] as string));

export function evidenceWords(index: number): string[] {
  return VOCABULARY.slice(index * EVIDENCE_WORDS, (index + 1) * EVIDENCE_WORDS);
}
/** The number that only excerpt `index` states. */
export function evidenceNumber(index: number): number {
  return 1000 + 37 * (index + 1);
}

export const HOSTS = ['library.example.org', 'notes.example.com', 'handbook.example.net'];

export function buildEvidence(index: number, host = HOSTS[index % HOSTS.length] as string): EvidenceInput {
  return {
    url: `https://${host}/entries/${letters(index)}`,
    title: `Entry ${letters(index)} (generated test source)`,
    publisher: 'Generated Test Library',
    excerpt: `${sentence(evidenceWords(index))} It counts ${evidenceNumber(index)} items.`,
    via: 'page',
  };
}

// ---------------------------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------------------------

export type Fill = 'min' | 'warn' | 'max';

export interface BuildOptions {
  depth: Depth;
  /** `min`: the fewest scenes, objectives and words. `max`: the most. A number: a random shape from that seed. */
  size: 'min' | 'max' | number;
  topic?: string;
  title?: string;
  /** Text of an extra framing block in the first scene. */
  framing?: string;
  /** Fix the scene kinds instead of deriving them (the recap must be last). */
  kinds?: SceneKind[];
  /** How full each scene is: at its minimum, at its warning threshold, or at its limit. */
  fill?: Fill;
  /** Steps in each step_through. */
  steps?: number;
  /** Give every step_through a predict step. Default true. */
  predict?: boolean;
  /** Figures on narration scenes. Default: alternate. */
  narrationFigures?: boolean;
  objectives?: number;
  evidence?: number;
  /** Put every source on one host. */
  singleHost?: boolean;
}

export class Builder {
  private readonly random: () => number;
  private neutralAt = 0;
  private readonly uses: number[];
  private readonly taught: number[] = [];
  private cursor = 0;
  private figureAt = 0;
  private questionAt = 0;
  readonly evidenceCount: number;

  constructor(seed: number, evidenceCount: number) {
    this.random = rng(seed);
    this.evidenceCount = evidenceCount;
    this.uses = new Array<number>(evidenceCount).fill(0);
    this.neutralAt = Math.floor(this.random() * 500);
    this.figureAt = Math.floor(this.random() * FIGURE_TYPES.length);
    this.questionAt = Math.floor(this.random() * QUESTION_TYPES.length);
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.random() * (max - min + 1));
  }

  words(n: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(NEUTRAL[this.neutralAt++ % NEUTRAL.length] as string);
    return out;
  }
  text(n: number): string {
    return sentence(this.words(Math.max(1, n)));
  }
  label(n = 2): string {
    return cap(this.words(n).join(' '));
  }

  /** The next excerpt to teach from: round robin, so every stored excerpt gets cited. */
  teach(): number {
    for (let tries = 0; tries < this.evidenceCount; tries++) {
      const index = this.cursor++ % this.evidenceCount;
      if ((this.uses[index] as number) >= L.usesPerEvidence) continue;
      this.uses[index] = (this.uses[index] as number) + 1;
      if (!this.taught.includes(index)) this.taught.push(index);
      return index;
    }
    throw new Error('every excerpt is used up');
  }
  /** An excerpt a scene has already taught, with room for one more citation. */
  recall(): number {
    let best = -1;
    for (const index of this.taught) if ((this.uses[index] as number) < L.usesPerEvidence && (best === -1 || (this.uses[index] as number) < (this.uses[best] as number))) best = index;
    if (best === -1) throw new Error('nothing taught has room for another citation');
    this.uses[best] = (this.uses[best] as number) + 1;
    return best;
  }

  /** A claim of `n` words grounded in excerpt `index`: three of its words, the rest the agent's own. */
  claim(n: number, index = this.teach()): { type: 'claim'; text: string; cites: string[] } {
    const source = evidenceWords(index);
    const own = this.words(Math.max(1, n - 3));
    const pick = this.int(0, EVIDENCE_WORDS - 3);
    const words = [own[0] as string, source[pick] as string, ...own.slice(1, 2), source[pick + 1] as string, ...own.slice(2), source[pick + 2] as string];
    return { type: 'claim', text: sentence(words.slice(0, Math.max(4, n))), cites: [`e${index + 1}`] };
  }
  quote(index = this.teach()): { type: 'quote'; text: string; cite: string } {
    return { type: 'quote', text: evidenceWords(index).slice(2, 7).join(' '), cite: `e${index + 1}` };
  }

  nextFigureType(): FigureType {
    return FIGURE_TYPES[this.figureAt++ % FIGURE_TYPES.length] as FigureType;
  }
  nextQuestionType(): QuestionType {
    return QUESTION_TYPES[this.questionAt++ % QUESTION_TYPES.length] as QuestionType;
  }

  figure(type: FigureType, big: boolean): { figure: FigureInput; parts: string[] } {
    const index = type === 'lines' ? -1 : this.teach();
    const cites = index === -1 ? [] : [`e${index + 1}`];
    const description = this.text(8);
    const n = (min: number, max: number): number => (big ? max : min);
    switch (type) {
      case 'flow': {
        const count = n(L.flow.nodes.min, L.flow.nodes.max);
        const nodes = Array.from({ length: count }, (_, i) => ({ id: `n-${letters(i)}`, label: this.label(), ...(big ? { detail: this.label(3) } : {}) }));
        const edges = Array.from({ length: count - 1 }, (_, i) => ({ id: `x-${letters(i)}`, from: `n-${letters(i)}`, to: `n-${letters(i + 1)}`, ...(big ? { label: this.label(1) } : {}) }));
        if (big) for (let i = 0; edges.length < L.flow.edges.max; i++) edges.push({ id: `y-${letters(i)}`, from: `n-${letters(i + 2)}`, to: `n-${letters(i)}`, label: this.label(1) });
        return { figure: { type, layout: big ? 'ring' : 'right', nodes, edges, cites, description, ...(big ? { caption: this.label(4) } : {}) }, parts: [...nodes.map((x) => x.id), ...edges.map((x) => x.id)] };
      }
      case 'sequence': {
        const actors = Array.from({ length: n(L.sequence.actors.min, L.sequence.actors.max) }, (_, i) => ({ id: `a-${letters(i)}`, label: this.label(1) }));
        const messages = Array.from({ length: n(L.sequence.messages.min, L.sequence.messages.max) }, (_, i) => ({
          id: `m-${letters(i)}`,
          from: (actors[i % actors.length] as { id: string }).id,
          to: (actors[(i + 1) % actors.length] as { id: string }).id,
          label: this.label(),
          ...(big && i === 1 ? { status: 'lost' as const } : {}),
        }));
        return { figure: { type, actors, messages, cites, description }, parts: [...actors.map((x) => x.id), ...messages.map((x) => x.id)] };
      }
      case 'layers': {
        const layers = Array.from({ length: n(L.layers.min, L.layers.max) }, (_, i) => ({ id: `l-${letters(i)}`, label: this.label(), ...(big ? { detail: this.label(3) } : {}) }));
        return { figure: { type, layers, cites, description }, parts: layers.map((x) => x.id) };
      }
      case 'timeline': {
        const events = Array.from({ length: n(L.timeline.events.min, L.timeline.events.max) }, (_, i) => ({ id: `t-${letters(i)}`, when: `Stage ${letters(i)}`, label: this.label(), ...(big ? { detail: this.label(3) } : {}) }));
        return { figure: { type, events, cites, description }, parts: events.map((x) => x.id) };
      }
      case 'compare': {
        const columns = Array.from({ length: n(L.compare.columns.min, L.compare.columns.max) }, (_, i) => ({ id: `c-${letters(i)}`, label: this.label(1) }));
        const rows = Array.from({ length: n(L.compare.rows.min, L.compare.rows.max) }, (_, i) => ({ id: `r-${letters(i)}`, label: this.label(), cells: columns.map(() => this.label()) }));
        return { figure: { type, ...(big ? { rowHeading: this.label(1) } : {}), columns, rows, cites, description }, parts: [...columns.map((x) => x.id), ...rows.map((x) => x.id)] };
      }
      case 'chart': {
        const xs = Array.from({ length: n(L.chart.xs.min, L.chart.xs.max) }, (_, i) => ({ id: `p-${letters(i)}`, label: this.label(1) }));
        const sourced = this.random() < 0.5;
        // A sourced chart draws only what its excerpt states: single digits and the excerpt's own number.
        const value = (i: number): number => (sourced ? (i === 0 ? evidenceNumber(index) : i % 10) : Math.round(this.random() * 1000) / 4);
        const series = Array.from({ length: n(L.chart.series.min, L.chart.series.max) }, (_, k) => ({ id: `v-${letters(k)}`, label: this.label(1), values: xs.map((_, i) => value(i + k)) }));
        return { figure: { type, mark: (['bar', 'line', 'step'] as const)[this.int(0, 2)] as 'bar', data: sourced ? 'sourced' : 'illustrative', xLabel: this.label(), yLabel: this.label(), ...(big ? { unit: 'units' } : {}), xs, series, cites, description }, parts: [...xs.map((x) => x.id), ...series.map((x) => x.id)] };
      }
      case 'lines': {
        const count = n(L.lines.min + 1, L.lines.max);
        const math = this.random() < 0.3;
        const lines = Array.from({ length: count }, (_, i) => (math ? `x_{${i + 1}} = \\frac{${i + 2}}{n} + ${i}` : `${'    '.repeat(i % 3)}${this.words(1)[0]}_${letters(i)} = ${this.words(1)[0]}(${i * 12})`));
        return { figure: { type, format: math ? 'math' : 'code', ...(math ? {} : { language: 'Python' }), lines, description }, parts: lines.map((_, i) => `l${i + 1}`) };
      }
    }
  }

  /**
   * Why an answer is right, in `n` words: the agent's own, with three words of the taught excerpt
   * it rests on, as an honest explanation has. Draws as many words as plain text would.
   */
  explain(n: number, index: number): { text: string; cites: string[] } {
    const words = this.words(n);
    const source = evidenceWords(index);
    for (let k = 0; k < 3; k++) words[1 + 2 * k] = source[(index + k) % EVIDENCE_WORDS] as string;
    return { text: sentence(words), cites: [`e${index + 1}`] };
  }

  question(type: QuestionType, big: boolean): QuestionInput {
    const explanation = this.explain(big ? 30 : 8, this.recall());
    const prompt = `${cap(this.words(big ? 20 : 6).join(' '))}?`;
    switch (type) {
      case 'single': {
        const count = big ? L.options.max : L.options.min;
        const options = Array.from({ length: count }, (_, i) => ({
          text: this.label(4),
          correct: i === 0,
          feedback: this.text(big ? 20 : 4),
          ...(i === 0 ? {} : { misconception: this.label(3) }),
        }));
        return { type, prompt, options, explanation, ...(big ? { hint: this.text(10), fixedOrder: false } : {}) };
      }
      case 'order':
        return { type, prompt, items: Array.from({ length: big ? L.orderItems.max : L.orderItems.min }, () => this.label(3)), explanation, ...(big ? { hint: this.text(10) } : {}) };
      case 'numeric':
        return { type, prompt, answer: this.int(2, 400), tolerance: big ? 0.5 : 0, ...(big ? { unit: 'items', hint: this.text(10) } : {}), explanation };
      case 'reflect':
        return { type, prompt, modelAnswer: explanation, lookFor: Array.from({ length: big ? L.lookFor.max : L.lookFor.min }, () => this.label(4)) };
    }
  }
}

/** Scene kinds for `n` scenes that satisfy the plan rules, with at least `checkpoints` checkpoints. */
function deriveKinds(b: Builder, n: number, checkpoints: number, random: boolean): SceneKind[] {
  const kinds: SceneKind[] = ['narration'];
  let narrations = 1;
  let passive = 1;
  for (let i = 1; i < n - 1; i++) {
    let kind: SceneKind;
    if (random) {
      const allowed: SceneKind[] = ['step_through', 'checkpoint'];
      // The recap that ends the lesson is passive too, so leave room for it.
      if (narrations < L.narrationRun && passive < L.passiveRun - 1) allowed.push('narration', 'narration');
      kind = allowed[b.int(0, allowed.length - 1)] as SceneKind;
    } else {
      kind = (['narration', 'step_through', 'checkpoint'] as const)[i % 3] as SceneKind;
    }
    kinds.push(kind);
    narrations = kind === 'narration' ? narrations + 1 : 0;
    passive = kind === 'narration' ? passive + 1 : 0;
  }
  kinds.push('recap');
  // Enough checkpoints for the objectives: turn later teaching scenes into questions, never the opening.
  for (let i = n - 2; i >= 1 && kinds.filter((k) => k === 'checkpoint').length < checkpoints; i--) if (kinds[i] !== 'checkpoint') kinds[i] = 'checkpoint';
  return kinds;
}

/** A complete lesson: start input, evidence, plan and scenes. The same options always give the same lesson. */
export function buildLesson(options: BuildOptions): LessonParts {
  const profile = DEPTHS[options.depth];
  const seed = typeof options.size === 'number' ? options.size : options.size === 'min' ? 1 : 2;
  const random = typeof options.size === 'number';
  const big = options.size === 'max';
  const fill: Fill = options.fill ?? (big ? 'max' : options.size === 'min' ? 'min' : 'warn');
  const b = new Builder(seed * 7 + ['quick', 'standard', 'deep'].indexOf(options.depth), 1);

  const sceneCount = options.kinds?.length ?? (random ? b.int(profile.scenes.min, profile.scenes.max) : big ? profile.scenes.max : profile.scenes.min);
  const maxCheckpoints = Math.max(1, sceneCount - 3);
  const objectiveCount = Math.min(options.objectives ?? (random ? b.int(profile.objectives.min, profile.objectives.max) : big ? profile.objectives.max : profile.objectives.min), maxCheckpoints);
  // A lesson with hand-picked kinds may be of any size, so it gets every excerpt there is.
  const evidenceCount = options.evidence ?? (big || options.kinds ? MAX_EVIDENCE : random ? b.int(Math.max(profile.evidenceMin, Math.ceil(sceneCount * 1.5)), MAX_EVIDENCE) : Math.max(profile.evidenceMin, 4));
  const builder = new Builder(seed * 31 + ['quick', 'standard', 'deep'].indexOf(options.depth), evidenceCount);
  const kinds = options.kinds ?? deriveKinds(builder, sceneCount, objectiveCount, random);

  // ----- the plan
  const objectives = Array.from({ length: objectiveCount }, (_, i) => ({ id: `o${i + 1}`, text: `${cap(builder.words(6).join(' '))}` }));
  const outline: OutlineEntry[] = [];
  let checkpointAt = 0;
  let narrationAt = 0;
  let reflects = 0;
  const totalCheckpoints = kinds.filter((k) => k === 'checkpoint').length;
  kinds.forEach((kind, i) => {
    const entry: OutlineEntry = { id: `s${i + 1}`, kind, purpose: builder.label(4) };
    if (kind === 'narration') {
      const wants = options.narrationFigures ?? narrationAt % 2 === 1;
      if (wants) entry.figure = builder.nextFigureType();
      narrationAt++;
    } else if (kind === 'step_through') {
      entry.figure = builder.nextFigureType();
    } else if (kind === 'checkpoint') {
      let type = builder.nextQuestionType();
      // At least half the checkpoints must be graded.
      if (type === 'reflect' && (reflects + 1) * 2 > totalCheckpoints) type = 'single';
      if (type === 'reflect') reflects++;
      entry.question = type;
      entry.objective = `o${(checkpointAt % objectiveCount) + 1}`;
      checkpointAt++;
    }
    outline.push(entry);
  });
  if (!options.kinds && profile.requireFigure && !outline.some((e) => e.figure)) (outline[0] as OutlineEntry).figure = 'flow';
  const plan: PlanInput = { title: options.title ?? `${cap(builder.words(4).join(' '))}`, objectives, outline };

  // ----- how many words each scene may carry
  const stepCount = options.steps ?? (fill === 'min' ? L.steps.min : random ? builder.int(L.steps.min, L.steps.max) : L.steps.max);
  const narrationWords = (withFigure: boolean): number => {
    const budget = withFigure ? L.narrationWithFigureWords : L.narrationWords;
    return fill === 'max' ? budget.max : fill === 'warn' ? budget.warn : 24;
  };
  const takeawayWords = fill === 'min' ? 6 : 20;
  const fixed = outline.reduce((sum, e) => sum + (e.kind === 'narration' ? narrationWords(Boolean(e.figure)) : e.kind === 'recap' ? takeawayWords * objectiveCount : e.kind === 'step_through' ? 8 : 0), 0);
  const stepScenes = outline.filter((e) => e.kind === 'step_through').length;
  const nominalStep = fill === 'max' ? L.stepWords.max : fill === 'warn' ? L.stepWords.warn : 10;
  // The scene budgets add up to more than the lesson may hold, so steps share what the lesson has left.
  const room = stepScenes ? Math.floor((profile.words.max - fixed) / (stepScenes * stepCount)) : nominalStep;
  const stepWords = options.kinds ? nominalStep : Math.max(10, Math.min(nominalStep, room));

  // ----- the scenes
  const scenes: SceneInput[] = [];
  let checkpointIndex = 0;
  outline.forEach((entry, i) => {
    const title = builder.label(3);
    if (entry.kind === 'narration') {
      const total = narrationWords(Boolean(entry.figure));
      const blocks: unknown[] = [];
      if (i === 0 && options.framing !== undefined) blocks.push({ type: 'framing', text: options.framing });
      if (fill === 'min') {
        blocks.push(builder.claim(12), builder.claim(12));
      } else {
        const quote = builder.quote();
        const framing = Math.min(24, Math.round(total * 0.1));
        const example = Math.round(total * 0.15);
        const analogy = i % 4 === 0 && blocks.length === 0;
        const claims = total - 5 - framing - example;
        const each = Math.floor(claims / 3);
        const first = builder.claim(each);
        blocks.push(first, builder.claim(each), builder.claim(claims - 2 * each), quote);
        // An analogy carries its limits, so the two together take the framing's share.
        blocks.push(analogy ? { type: 'analogy', text: builder.text(Math.max(1, framing - 3)), limits: builder.text(3) } : { type: 'framing', text: builder.text(framing) });
        if (blocks.length < L.blocksPerNarration) blocks.push({ type: 'example', text: builder.text(example), basedOn: first.cites });
      }
      const figure = entry.figure ? builder.figure(entry.figure, big).figure : undefined;
      scenes.push({ id: entry.id, kind: 'narration', title, blocks, ...(figure ? { figure } : {}) } as SceneInput);
    } else if (entry.kind === 'step_through') {
      const { figure, parts } = builder.figure(entry.figure as FigureType, big);
      const steps = Array.from({ length: stepCount }, (_, k) => {
        const blocks: unknown[] = [];
        if (fill === 'min') {
          blocks.push(builder.claim(stepWords));
        } else {
          const framing = Math.round(stepWords * 0.1);
          const claim = Math.min(L.claimWords, stepWords - framing - Math.round(stepWords * 0.2));
          blocks.push(builder.claim(claim), { type: 'framing', text: builder.text(framing) }, { type: 'example', text: builder.text(stepWords - framing - claim) });
        }
        const highlight = Array.from({ length: big ? Math.min(L.highlightsPerStep, parts.length) : 1 }, (_, h) => parts[(k + h) % parts.length] as string);
        const predict =
          (options.predict ?? true) && k === 1
            ? {
                prompt: `${cap(builder.words(6).join(' '))}?`,
                options: Array.from({ length: big ? L.predictOptions.max : L.predictOptions.min }, (_, o) => ({ text: builder.label(4), correct: o === 0, feedback: builder.text(5) })),
              }
            : undefined;
        return {
          title: builder.label(2),
          highlight: [...new Set(highlight)],
          blocks,
          ...(fill === 'min' ? {} : { state: Array.from({ length: big ? L.stateRows : 2 }, (_, s) => ({ label: `v${letters(s)}`, value: String(k * 3 + s) })) }),
          ...(predict ? { predict } : {}),
        };
      });
      scenes.push({ id: entry.id, kind: 'step_through', title, ...(fill === 'min' ? {} : { intro: builder.text(8) }), figure, steps } as SceneInput);
    } else if (entry.kind === 'checkpoint') {
      scenes.push({ id: entry.id, kind: 'checkpoint', title, objective: entry.objective as string, level: checkpointIndex === 0 ? 'apply' : 'recall', question: builder.question(entry.question as QuestionType, big) } as SceneInput);
      checkpointIndex++;
    } else {
      scenes.push({
        id: entry.id,
        kind: 'recap',
        title,
        takeaways: objectives.map((o) => {
          const index = builder.recall();
          const claim = builder.claim(takeawayWords, index);
          return { objective: o.id, text: claim.text, cites: claim.cites };
        }),
        ...(fill === 'min' ? {} : { practice: { task: builder.text(20), lookFor: [builder.label(4)] } }),
        next: Array.from({ length: big ? L.nextTopics.max : L.nextTopics.min }, () => ({ topic: builder.label(3), why: builder.text(8) })),
      } as SceneInput);
    }
  });

  const start: StartInputRaw = {
    topic: options.topic ?? 'How the generated machine sorts its parts',
    language: 'en',
    depth: options.depth,
    learner: { level: 'new', knows: 'Nothing about the topic yet.', goal: 'Explain how it works.', calibration: [] },
  };
  const evidence = Array.from({ length: evidenceCount }, (_, i) => buildEvidence(i, options.singleHost ? (HOSTS[0] as string) : undefined));
  return { start, evidence, plan, scenes };
}
