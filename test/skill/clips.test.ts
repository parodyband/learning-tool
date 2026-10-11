// The clips the skill writes by hand (the three worked clips in clip-design.md, and in format.md
// the clip with an explore and the frame clip) are what an agent will imitate first. So they are
// held to more than the schema: they follow the rules the skill itself gives, the real engine
// compiles and draws them at a desk width and a phone width, and the real validator accepts them,
// with no error and no warning, in a lesson whose stored passages say what their captions claim.
// What they do with sliders, formulas and goals is held in test/skill/interactive.test.ts.
//
// The passages are SYNTHETIC (test/skill/worked.ts and test/helpers/example.ts). What is under test
// is the clip, not a source.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLIP_LIMITS as C, verbsFor, type ClipScene } from '../../src/core/clip';
import { LIMITS as L } from '../../src/core/limits';
import type { Draft, SceneCheck } from '../../src/core/types';
import { exampleEvidence } from '../helpers/example';
import { draftAround, exampleClipDraft } from './drafts';
import { CLIP_DESIGN_MD, FORMAT_MD, markedExamples, read, readoutVerbs, ROOT } from './helpers';
import { evidenceFor, FRAMES, HAND_WRITTEN, PASSAGES, TYPED } from './worked';

type Loose = Record<string, unknown>;

const words = (text: string): number => text.trim().split(/\s+/).length;
const named = HAND_WRITTEN.map((h) => [`${h.clip.id} (${h.at})`, h] as const);
const stageKey = (clip: ClipScene): string => (clip.stage.kind === 'chart' ? `chart.${clip.stage.mark}` : clip.stage.kind);
const gatesOf = (clip: ClipScene) => clip.beats.flatMap((beat) => (beat.gate ? [beat.gate] : []));

describe('the clips the skill writes by hand', () => {
  it('are the three worked clips, the clip with an explore in the format reference, and the frame clip', () => {
    expect(TYPED.map((h) => `${path.basename(h.file)} ${h.clip.id}`).sort()).toEqual(['clip-design.md crowd', 'clip-design.md market', 'clip-design.md next', 'format.md grow']);
    expect(FRAMES.map((h) => path.basename(h.file))).toEqual([path.basename(FORMAT_MD)]);
  });

  it('between them show every interactive shape: an explore on dots, on a curve chart and on bars, a tap on cells, a choice by options', () => {
    const by = new Map(TYPED.map((h) => [h.clip.id, h.clip] as const));
    // The task each one was written for.
    expect(stageKey(by.get('crowd')!)).toBe('dots');
    expect(by.get('crowd')!.explore?.controls).toHaveLength(1);
    expect(by.get('crowd')!.explore?.goal).toBeDefined();
    expect(stageKey(by.get('market')!)).toBe('chart.curve');
    const market = by.get('market')!;
    expect(market.explore?.goal).toBeDefined();
    expect(market.stage.kind === 'chart' && market.stage.mark === 'curve' && (market.stage.points ?? []).length).toBeGreaterThan(0);
    expect(stageKey(by.get('next')!)).toBe('cells');
    expect(gatesOf(by.get('next')!).some((gate) => 'pick' in gate)).toBe(true);
    expect(by.get('next')!.beats.length).toBeLessThanOrEqual(3);
    expect(stageKey(by.get('grow')!)).toBe('chart.bars');
    expect(by.get('grow')!.explore).toBeDefined();
    expect(TYPED.flatMap((h) => gatesOf(h.clip)).some((gate) => 'options' in gate)).toBe(true);
  });

  it.each(named)('%s keeps to the rules the skill gives', (_name, { clip }) => {
    const allowed = verbsFor(clip.stage as { kind: string; mark?: string });
    // A read-out takes the same five verbs on every stage that has read-outs, whatever the stage's own are.
    const readouts = new Set(clip.stage.kind === 'words' || clip.stage.kind === 'frame' ? [] : (clip.stage.stats ?? []).map((stat) => stat.id));
    const onReadout = (action: { target?: string | undefined; targets?: string[] | undefined }): boolean => [...(action.targets ?? []), ...(action.target ? [action.target] : [])].some((id) => readouts.has(id));
    expect(clip.beats.length).toBeGreaterThanOrEqual(C.beats.min);
    expect(clip.beats[0]?.gate, 'no prediction on the first beat').toBeUndefined();
    for (const beat of clip.beats) {
      const caption = beat.caption.type === 'analogy' ? `${beat.caption.text} ${beat.caption.limits}` : beat.caption.text;
      // A worked example models the target, not the limit: no caption long enough to be warned about.
      expect(words(caption), `"${caption}"`).toBeLessThanOrEqual(L.captionWords.warn);
      expect(beat.do.length).toBeLessThanOrEqual(C.actionsPerBeat);
      for (const action of beat.do) {
        expect(onReadout(action as { target?: string; targets?: string[] }) ? readoutVerbs() : allowed, `${action.verb} on a ${clip.stage.kind} stage`).toContain(action.verb);
        if (action.on !== undefined) expect(caption.toLowerCase(), `on: "${action.on}"`).toContain(action.on.toLowerCase());
      }
    }
    // Every claim cites, and the clip rests on at least one cited caption.
    expect(clip.beats.some((b) => b.caption.type === 'claim' || b.caption.type === 'quote')).toBe(true);
    if (clip.stage.provenance !== 'illustrative') expect(clip.stage.cites.length).toBeGreaterThan(0);
  });

  it.each(TYPED.map((h) => [h.clip.id, h] as const))('%s shows what the skill says a clip should', (_name, { clip }) => {
    // Every beat changes the picture.
    for (const beat of clip.beats) expect(beat.do.length, `"${beat.caption.text}"`).toBeGreaterThan(0);
    // The learner acts in it: a prediction that stops the clip before its outcome, or a picture handed over.
    const gates = clip.beats.filter((b) => b.gate !== undefined);
    expect(gates.length + (clip.explore ? 1 : 0), 'a gate or an explore').toBeGreaterThan(0);
    expect(gates.length, 'usually one gate in a clip').toBeLessThanOrEqual(1);
    for (const beat of gates) {
      // The outcome is motion, not a caption over a still.
      expect(beat.do.some((a) => !['focus', 'pulse'].includes(a.verb))).toBe(true);
      const gate = beat.gate!;
      if ('options' in gate) {
        expect(gate.options.filter((o) => o.correct)).toHaveLength(1);
        // Feedback says why: no bare verdict.
        for (const option of gate.options) expect(option.feedback).not.toMatch(/^(Correct|Incorrect|Right|Wrong|Well done)[.!]?$/i);
      } else {
        expect(gate.pick.length).toBeGreaterThan(0);
        for (const reply of [gate.right, gate.wrong]) expect(reply).not.toMatch(/^(Correct|Incorrect|Right|Wrong|Well done)[.!]?$/i);
      }
    }
    // Not a list with entrances: the verbs are the stage's own.
    const verbs = new Set(clip.beats.flatMap((b) => b.do.map((a) => a.verb)));
    expect([...verbs].some((v) => !['show', 'hide', 'focus', 'pulse'].includes(v))).toBe(true);
    // A stage the learner can drag, and a curve drawn from a formula, are never "sourced".
    if (clip.explore || stageKey(clip) === 'chart.curve') expect(clip.stage.provenance).not.toBe('sourced');
  });

  // "A tap must be a real choice. When the gate opens, the right part looks like its neighbours:
  // no accent, no pointer resting on it, no focus." The worked tap gate is held to its own rule.
  it('the worked tap gate gives nothing away: no tone, pointer or focus marks the right cell when it opens', () => {
    const { clip } = TYPED.find((h) => h.clip.id === 'next')!;
    const at = clip.beats.findIndex((b) => b.gate !== undefined && 'pick' in b.gate);
    expect(at).toBeGreaterThan(0);
    const gate = clip.beats[at]!.gate!;
    if (!('pick' in gate)) throw new Error('the gate of "next" is not a tap');
    const pick = new Set(gate.pick);
    let focused: string[] = [];
    const pointers = new Map<string, string>();
    const toned = new Set<string>();
    const cells = clip.stage.kind === 'cells' ? clip.stage.cells.map((c) => c.id) : [];
    const between = ([first, last]: readonly [string, string]): string[] => cells.slice(cells.indexOf(first), cells.indexOf(last) + 1);
    for (const beat of clip.beats.slice(0, at)) {
      for (const action of beat.do) {
        const ids = 'targets' in action && action.targets ? action.targets : 'target' in action && action.target ? [action.target] : [];
        const range = 'between' in action && action.between ? between(action.between) : [];
        if (action.verb === 'focus') focused = [...ids, ...range];
        if (action.verb === 'move' && typeof action.to === 'string') pointers.set(action.target, action.to);
        if (action.verb === 'set' && action.tone !== undefined) for (const id of [...ids, ...range]) (action.tone === 'neutral' ? toned.delete(id) : toned.add(id));
      }
    }
    for (const id of pick) {
      expect(toned.has(id), `"${id}" carries a tone`).toBe(false);
      expect([...pointers.values()], `a pointer rests on "${id}"`).not.toContain(id);
      expect(focused, `"${id}" is in focus`).not.toContain(id);
    }
    // And its reply to a wrong tap names neither the cell nor what it holds.
    const label = clip.stage.kind === 'cells' ? clip.stage.cells.filter((c) => pick.has(c.id)).map((c) => c.label) : [];
    for (const word of [...pick, ...label]) expect(gate.wrong).not.toContain(word);
    // More than one cell can be tapped, so the tap is a choice.
    expect(cells.length - pick.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------------------------
// The engine: a clip that names a part its stage does not have, or asks for something its stage
// cannot do, throws while it is compiled, and the learner would get the text version instead.
// ---------------------------------------------------------------------------------------------

describe('the engine plays the worked clips', () => {
  interface Compiled {
    beats: { t0: number; t1: number; gate: boolean }[];
    duration: number;
    apply(t: number, x?: unknown): void;
  }
  let compile: ((data: unknown, env: Loose) => Compiled) | null = null;
  let stageHeight: (W: number) => number = () => 0;
  let stageElement: (W: number, H: number) => unknown = () => null;

  const engine = path.join(ROOT, 'src/player/stage');
  beforeAll(async () => {
    // The engine belongs to the player's own TypeScript project and the stand-in DOM to the clip
    // tests: both are loaded by path, and the checks are skipped if either is not there.
    const dom = (await import(/* @vite-ignore */ path.join(ROOT, 'test/clip/fake-dom')).catch(() => null)) as { installFakeDom?: () => void; stageElement?: typeof stageElement } | null;
    if (!dom?.installFakeDom || !dom.stageElement) return;
    dom.installFakeDom();
    stageElement = dom.stageElement;
    const timeline = (await import(/* @vite-ignore */ path.join(engine, 'timeline')).catch(() => null)) as { compile?: typeof compile; stageHeight?: typeof stageHeight } | null;
    if (!timeline?.compile || !timeline.stageHeight) return;
    // Every kit there is: a stage kind added later (a curve chart) registers itself the same way.
    for (const file of readdirSync(engine).filter((name) => /^kit-[a-z]+\.ts$/.test(name)).sort()) await import(/* @vite-ignore */ path.join(engine, file.replace(/\.ts$/, '')));
    stageHeight = timeline.stageHeight;
    compile = timeline.compile;
  });

  const COLORS = { neutral: [127, 134, 189], accent: [170, 181, 255], good: [134, 214, 163], bad: [255, 161, 152], warn: [242, 197, 107], muted: [77, 83, 145] };
  const engineExists = existsSync(path.join(engine, 'timeline.ts')) && existsSync(path.join(ROOT, 'test/clip/fake-dom.ts'));

  // Without this, an engine that failed to load would make every check below pass by doing nothing.
  it.skipIf(!engineExists)('the engine and its stand-in DOM load', () => {
    expect(compile, 'src/player/stage/timeline did not load').not.toBeNull();
  });

  it.each(TYPED.flatMap((h) => [960, 320].map((W) => [h.clip.id, W, h.clip] as const)))('%s compiles and draws every beat at %d px', (_id, W, clip) => {
    if (!compile) return;
    const H = stageHeight(W);
    const compiled = compile(clip, { el: stageElement(W, H), W, H, dpr: 1, colors: COLORS });
    expect(compiled.beats).toHaveLength(clip.beats.length);
    // The poster, the middle and the end of every beat, and the last instant.
    compiled.apply(Math.max(0, compiled.beats[0]!.t0 - 1));
    for (const beat of compiled.beats) {
      compiled.apply((beat.t0 + beat.t1) / 2);
      compiled.apply(beat.t1 - 1);
    }
    compiled.apply(compiled.duration - 1);
    // The clip stops for its prediction exactly where the clip says.
    expect(compiled.beats.map((b) => b.gate)).toEqual(clip.beats.map((b) => b.gate !== undefined));
  });
});

// ---------------------------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------------------------

describe('the validator accepts the worked clips', async () => {
  const validate = (await import(/* @vite-ignore */ path.join(ROOT, 'src/core/validate')).catch(() => null)) as { checkScene?: (input: unknown, draft: Draft) => SceneCheck } | null;
  const checkScene = validate?.checkScene ?? null;
  // The validator learns about clips in the same round as this skill; until it does there is nothing to ask it.
  const knowsClips = checkScene ? !checkScene(exampleClipDraft().scenes[0], exampleClipDraft()).errors.some((e) => e.code === 'BAD_VALUE' && e.path === 'kind') : false;
  const said = (check: SceneCheck): string[] => [...check.errors, ...check.warnings].map((i) => `${i.severity} ${i.code} ${i.path}: ${i.message}`);

  it.skipIf(!knowsClips).each(TYPED.map((h) => [h.clip.id, h] as const))('%s: no error and no warning', (_id, { clip }) => {
    const check = checkScene!(clip, draftAround(clip, evidenceFor(clip)));
    expect(said(check)).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it.skipIf(!knowsClips).each(FRAMES.map((h) => [h.clip.id, h] as const))('%s (a custom frame): no error and no warning', (_id, { clip }) => {
    // The frame clip of the format reference belongs to the example lesson and cites its evidence.
    const check = checkScene!(clip, draftAround(clip, exampleEvidence()));
    expect(said(check)).toEqual([]);
    expect(check.ok).toBe(true);
  });

  // The complete clip the format reference shows is what an agent reading only that page will
  // imitate, so it is one of the clips held clean above: no warning about a long caption, nothing
  // the validator would send back.
  it('the format reference shows a complete clip, and it is one of the clips the validator is asked about', () => {
    const shown = markedExamples(FORMAT_MD)
      .filter((ex) => ex.kind === 'scene')
      .map((ex) => JSON.parse(ex.json) as Loose)
      .filter((scene) => scene.kind === 'clip' && (scene.stage as Loose).kind !== 'frame');
    expect(shown.length).toBeGreaterThan(0);
    for (const scene of shown) expect(TYPED.map((h) => h.clip.id)).toContain(scene.id);
  });

  // What the reference says the validator refuses, tried on a clip it accepts.
  const base = (id = 'next'): { clip: Loose; draft: Draft } => {
    const { clip } = TYPED.find((h) => h.clip.id === id)!;
    return { clip: structuredClone(clip) as unknown as Loose, draft: draftAround(clip, evidenceFor(clip)) };
  };
  const codes = (clip: Loose, draft: Draft): string[] => checkScene!(clip, draft).errors.map((e) => e.code);
  const beats = (clip: Loose): Loose[] => clip.beats as Loose[];

  it.skipIf(!knowsClips)('refuses a prediction on the first beat', () => {
    const { clip, draft } = base();
    beats(clip)[0]!.gate = beats(clip)[2]!.gate;
    expect(codes(clip, draft)).toContain('GATE_ON_FIRST_BEAT');
  });

  it.skipIf(!knowsClips)('refuses a cue that is not a phrase of its caption', () => {
    const { clip, draft } = base();
    (beats(clip)[1]!.do as Loose[])[0]!.on = 'words that are not there';
    expect(codes(clip, draft)).toContain('ACTION_CUE_NOT_IN_CAPTION');
  });

  it.skipIf(!knowsClips)('refuses a verb the stage does not have, and a part it does not have', () => {
    const send = base();
    (beats(send.clip)[1]!.do as Loose[]).push({ verb: 'send', target: 'c0' });
    expect(codes(send.clip, send.draft)).toContain('ACTION_VERB_NOT_ALLOWED');
    const ghost = base();
    (beats(ghost.clip)[1]!.do as Loose[]).push({ verb: 'pulse', target: 'c9' });
    expect(codes(ghost.clip, ghost.draft)).toContain('ACTION_UNKNOWN_PART');
  });

  it.skipIf(!knowsClips)('refuses a clip of captions over a still stage', () => {
    const { clip, draft } = base();
    for (const beat of beats(clip).slice(1)) beat.do = [];
    delete beats(clip)[2]!.gate;
    expect(codes(clip, draft)).toContain('CLIP_TOO_STATIC');
  });

  it.skipIf(!knowsClips)('refuses a caption that is a paragraph, and warns about one that is long', () => {
    const long = base();
    (beats(long.clip)[0]!.caption as Loose).text = `Binary search compares the target with the middle element. ${'It discards a half. '.repeat(5)}`.trim();
    expect(words((beats(long.clip)[0]!.caption as Loose).text as string)).toBeGreaterThan(L.captionWords.max);
    expect(codes(long.clip, long.draft)).toContain('WORDS_OVER_BUDGET');
    const longish = base();
    (beats(longish.clip)[0]!.caption as Loose).text = 'Binary search compares the target with the middle element, and discards the half that cannot contain it.';
    const n = words((beats(longish.clip)[0]!.caption as Loose).text as string);
    expect(n).toBeGreaterThan(L.captionWords.warn);
    expect(n).toBeLessThanOrEqual(L.captionWords.max);
    const check = checkScene!(longish.clip, longish.draft);
    expect(check.errors.map((e) => e.code)).not.toContain('WORDS_OVER_BUDGET');
    expect(check.warnings.map((w) => w.code)).toContain('WORDS_NEAR_BUDGET');
  });

  it.skipIf(!knowsClips)('refuses a clip with no cited caption, whatever its stage cites', () => {
    const { clip, draft } = base();
    for (const beat of beats(clip)) beat.caption = { type: 'framing', text: 'The search looks at one cell and rules out the rest.' };
    expect(codes(clip, draft)).toContain('SCENE_NO_CITED_BLOCK');
  });

  it.skipIf(!knowsClips)('refuses a sourced or a worked stage that cites nothing, and lets an illustrative one', () => {
    for (const provenance of ['sourced', 'worked']) {
      const { clip, draft } = base();
      Object.assign(clip.stage as Loose, { provenance, cites: [] });
      expect(codes(clip, draft), provenance).toContain('STAGE_NO_CITES');
    }
    const { clip, draft } = base();
    Object.assign(clip.stage as Loose, { provenance: 'illustrative', cites: [] });
    expect(codes(clip, draft)).not.toContain('STAGE_NO_CITES');
  });

  it.skipIf(!knowsClips)('checks the numbers on a sourced stage against the passages it cites, and not those on a worked one', () => {
    // 897 is a subtraction that no passage states: one reason the clip is marked "worked".
    const { clip, draft } = base('crowd');
    expect(Object.values(PASSAGES.crowd!).join(' ')).not.toContain('897');
    expect(checkScene!(clip, draft).errors.filter((e) => e.code === 'NUMBER_NOT_IN_SOURCE')).toEqual([]);
    (clip.stage as Loose).provenance = 'sourced';
    const found = checkScene!(clip, draft).errors.filter((e) => e.code === 'NUMBER_NOT_IN_SOURCE');
    expect(found.map((e) => e.path).join(' ')).toMatch(/into/);
    expect(JSON.stringify(found)).toContain('897');
  });
});

describe('clip-design.md says why the crowd clip is marked worked', () => {
  it('names the number that no passage states', () => {
    const text = read(CLIP_DESIGN_MD).replace(/\s+/g, ' ');
    expect(text).toMatch(/The stage is `worked`, not `sourced`, because 897 is a subtraction that no passage states and every dragged number is computed/);
  });
});
