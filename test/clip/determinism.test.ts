// The engine's one rule, held by a test: the picture after render(t) depends on t alone.
//
// Every example clip (the lesson's six and one per stage kind) is compiled at a wide and a narrow
// stage and drawn at instants reached three ways: on a stage that has drawn nothing else, after a
// walk to the end and to somewhere else and back, and after playing frame by frame from the start.
// The three pictures must be the same, down to every attribute, inline style, text and canvas
// drawing call (test/clip/fake-dom.ts records them; it is the page).
//
// A kit that keeps something from one frame to the next fails here. This test caught exactly that
// in the prototype (a caption that kept its last word state); the rule does not hold by itself.
import { beforeAll, describe, expect, it } from 'vitest';
import { ClipScene, STAGE_KINDS } from '../../src/core/clip';
import { EXAMPLE_CLIPS, EXPLORE_EXAMPLE_CLIPS } from '../../src/core/clip-examples';
import { exampleLessonV2 } from '../helpers/clip-example';
import { type FakeElement, installFakeDom, snapshot, stageElement } from './fake-dom';

// The engine is typed against the DOM and belongs to the player's own TypeScript project
// (src/player/tsconfig.json), so it is loaded here by path, at run time, and described by the few
// shapes this test uses. Nothing in it needs a real DOM: test/clip/fake-dom.ts stands in.
interface BeatTime {
  i: number;
  t0: number;
  t1: number;
  motionEnd: number;
  gate: boolean;
}
interface Compiled {
  beats: BeatTime[];
  duration: number;
  apply(t: number): void;
}
interface Env {
  el: FakeElement;
  W: number;
  H: number;
  dpr: number;
  colors: unknown;
  audio?: (number | undefined)[];
}
interface ClipLike {
  t: number;
  k: number;
  W: number;
  beats: BeatTime[];
  duration: number;
  poster: number;
  render(t: number): void;
  seek(t: number): void;
  build(): void;
  open(): void;
  next(): void;
  prev(): void;
  pass(i: number): void;
  stops(): number[];
  limit(): number;
  openGate(): number;
  atGate(): boolean;
  atEnd(): boolean;
}
type ClipData = unknown;
let compile: (data: ClipData, env: Env) => Compiled;
let readingMs: (text: string) => number;
let stageHeight: (W: number, room?: number) => number;
let hasKit: (kind: string) => boolean;
let Clip: new (make: (env: Env) => Compiled, view: FakeElement, opts?: { reduced?: boolean; width?: number }) => ClipLike;

const ENGINE = '../../src/player/stage';
const KITS = ['kit-sequence', 'kit-cells', 'kit-dots', 'kit-chart', 'kit-flow', 'kit-words', 'kit-lines', 'kit-timeline'];

beforeAll(async () => {
  installFakeDom();
  const load = (name: string): Promise<unknown> => import(/* @vite-ignore */ `${ENGINE}/${name}`);
  ({ compile, readingMs, stageHeight } = (await load('timeline')) as { compile: typeof compile; readingMs: typeof readingMs; stageHeight: typeof stageHeight });
  ({ hasKit } = (await load('kit')) as { hasKit: typeof hasKit });
  ({ Clip } = (await load('clip')) as { Clip: typeof Clip });
  // Importing a kit registers it.
  for (const kit of KITS) await load(kit);
});

const COLORS = { neutral: [127, 134, 189], accent: [170, 181, 255], good: [134, 214, 163], bad: [255, 161, 152], warn: [242, 197, 107], muted: [77, 83, 145] } as const;
const WIDTHS = [960, 320];

const lessonClips = exampleLessonV2().scenes.filter((s): s is ClipScene => s.kind === 'clip');
// A custom frame is drawn by a worker from code, not by a kit from channels: src/player/frame has its own tests.
const kitClips = STAGE_KINDS.filter((k) => k !== 'frame').map((k) => ClipScene.parse(EXAMPLE_CLIPS[k]));
// The three clips that end in an explore play like any other until they end: a curve chart, a
// crowd whose groups a formula will drive (laid out as one cut sheet from its first beat), bars.
const exploreClips = Object.values(EXPLORE_EXAMPLE_CLIPS).map((c) => ClipScene.parse(c));
const CLIPS: ClipScene[] = [...lessonClips, ...kitClips, ...exploreClips];

function build(clip: ClipScene, W: number): { el: FakeElement; c: Compiled } {
  const H = stageHeight(W);
  const el = stageElement(W, H);
  const c = compile(clip, { el: el, W, H, dpr: 1, colors: COLORS });
  return { el, c };
}

/** A small seeded generator: the walk is random, and the same every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Instants worth checking: spread through the clip, and either side of every beat boundary. */
function instants(c: Compiled): number[] {
  const out = new Set<number>();
  for (let i = 0; i <= 16; i++) out.add(Math.round(((c.duration - 1) * i) / 16));
  for (const b of c.beats) for (const t of [b.t0 - 1, b.t0, b.t0 + 37, Math.round((b.t0 + b.motionEnd) / 2), b.motionEnd, b.t1 - 1]) out.add(Math.max(0, Math.min(c.duration - 1, t)));
  return [...out].sort((x, y) => x - y);
}

describe('every stage kind has a kit and an example', () => {
  it('registers a kit for each kind the engine draws', () => {
    for (const kind of STAGE_KINDS) if (kind !== 'frame') expect(hasKit(kind), kind).toBe(true);
  });
});

for (const W of WIDTHS) {
  describe(`same t, same frame, at ${W} px`, () => {
    for (const clip of CLIPS) {
      it(`${clip.id} (${clip.stage.kind}): a fresh render equals a render after a random walk`, () => {
        const walker = build(clip, W);
        const rnd = seeded(clip.id.length * 7919 + W);
        const end = walker.c.duration - 1;
        for (const t of instants(walker.c)) {
          const fresh = build(clip, W);
          fresh.c.apply(t);
          walker.c.apply(end);
          walker.c.apply(Math.round(rnd() * end));
          walker.c.apply(Math.round(rnd() * end));
          walker.c.apply(t);
          expect(snapshot(walker.el), `${clip.id} at ${t} ms`).toBe(snapshot(fresh.el));
        }
      });

      it(`${clip.id} (${clip.stage.kind}): playing frame by frame arrives at the same frames`, () => {
        const player = build(clip, W);
        const stops = [...player.c.beats.map((b) => b.t1 - 1)];
        let t = 0;
        for (const stop of stops) {
          for (; t < stop; t += 1000 / 60) player.c.apply(t);
          player.c.apply(stop);
          const fresh = build(clip, W);
          fresh.c.apply(stop);
          expect(snapshot(player.el), `${clip.id} at ${stop} ms`).toBe(snapshot(fresh.el));
        }
        // and backwards: a scrub from the end to the start
        for (; t > 0; t -= 97) player.c.apply(Math.max(0, t));
        player.c.apply(0);
        const fresh = build(clip, W);
        fresh.c.apply(0);
        expect(snapshot(player.el), `${clip.id} back at 0`).toBe(snapshot(fresh.el));
      });

      it(`${clip.id} (${clip.stage.kind}): compiling twice gives the same timeline`, () => {
        const a = build(clip, W).c;
        const b = build(clip, W).c;
        expect(a.beats).toEqual(b.beats);
        expect(a.duration).toBe(b.duration);
      });
    }
  });
}

describe('the timeline', () => {
  it('puts beats end to end, after an establishing move, each long enough to read and to settle', () => {
    for (const clip of CLIPS) {
      const c = build(clip, 960).c;
      expect(c.beats).toHaveLength(clip.beats.length);
      expect(c.beats[0]?.t0, clip.id).toBeGreaterThanOrEqual(260);
      c.beats.forEach((b, i) => {
        const next = c.beats[i + 1];
        if (next) expect(next.t0).toBe(b.t1);
        expect(b.t1).toBeGreaterThanOrEqual(b.motionEnd + 499);
        expect(b.t1 - b.t0).toBeGreaterThanOrEqual(readingMs(clip.beats[i]?.caption.text ?? '') - 1);
        expect(b.gate).toBe(clip.beats[i]?.gate !== undefined);
      });
      expect(c.duration).toBe(c.beats.at(-1)?.t1);
    }
  });

  it('does not depend on the screen: a clip is about as long at 320 px as at 960', () => {
    for (const clip of CLIPS) {
      const wide = build(clip, 960).c.duration;
      const narrow = build(clip, 320).c.duration;
      expect(Math.abs(wide - narrow), `${clip.id}: ${wide} vs ${narrow}`).toBeLessThan(1500);
    }
  });

  it('follows narration when a beat has audio, and reading time when it has not', () => {
    const clip = lessonClips[1] as ClipScene;
    const silent = build(clip, 960).c;
    const H = stageHeight(960);
    const audio = clip.beats.map(() => 9000);
    const voiced = compile(clip, { el: stageElement(960, H), W: 960, H, dpr: 1, colors: COLORS, audio });
    voiced.beats.forEach((b, i) => {
      expect(b.t1 - b.t0).toBeGreaterThanOrEqual(9300);
      expect(b.t1 - b.t0).toBeGreaterThan((silent.beats[i]?.t1 ?? 0) - (silent.beats[i]?.t0 ?? 0));
    });
    const mixed = compile(clip, { el: stageElement(960, H), W: 960, H, dpr: 1, colors: COLORS, audio: [9000] });
    expect((mixed.beats[1]?.t1 ?? 0) - (mixed.beats[1]?.t0 ?? 0)).toBe((silent.beats[1]?.t1 ?? 0) - (silent.beats[1]?.t0 ?? 0));
  });

  it('names what is wrong when a clip asks for something its stage cannot do', () => {
    const base = lessonClips[2] as ClipScene;
    const withAction = (action: Record<string, unknown>): ClipData => ({ ...(base as unknown as Record<string, unknown>), beats: [{ caption: { type: 'framing', text: 'Look at the middle cell.' }, do: [action] }, { caption: { type: 'framing', text: 'Then stop.' } }] });
    const run = (action: Record<string, unknown>): void => {
      const H = stageHeight(960);
      compile(withAction(action), { el: stageElement(960, H), W: 960, H, dpr: 1, colors: COLORS });
    };
    expect(() => run({ verb: 'move', target: 'low', to: 'c99' })).toThrow('"c99" is not a cell');
    expect(() => run({ verb: 'move', target: 'c0', to: 'c1' })).toThrow('move works on a pointer or a bracket');
    expect(() => run({ verb: 'pulse', target: 'nobody' })).toThrow('No part with the id "nobody" on this cells stage');
    expect(() => run({ verb: 'fade', target: 'c0' })).toThrow('Unknown verb "fade"');
    expect(() => run({ verb: 'send', target: 'c0' })).toThrow('A cells stage has no "send"');
    expect(() => run({ verb: 'pulse', target: 'c0', on: 'a phrase that is not there' })).toThrow('does not occur in the caption');
    expect(() => run({ verb: 'reorder', order: ['c0', 'c1'] })).toThrow('must name every cell');
  });
});

describe('a clip that plays', () => {
  const make = (clip: ClipScene, reduced: boolean): { view: FakeElement; clip: ClipLike } => {
    const view = stageElement(960, 0);
    return { view, clip: new Clip((env) => compile(clip, env), view, { reduced, width: 960 }) };
  };

  it('with reduced motion shows one still for every instant of a beat: no travel', () => {
    for (const data of lessonClips) {
      const { view, clip } = make(data, true);
      for (const b of clip.beats) {
        const frames = new Set<string>();
        for (let i = 0; i <= 40; i++) {
          clip.render(b.t0 + ((b.t1 - 1 - b.t0) * i) / 40);
          frames.add(snapshot(view));
        }
        expect(frames.size, `${data.id} beat ${b.i + 1}`).toBe(1);
      }
    }
  });

  it('with reduced motion a still is the end state the moving clip reaches', () => {
    const data = lessonClips[2] as ClipScene;
    const still = make(data, true);
    const moving = make(data, false);
    for (const b of still.clip.beats) {
      still.clip.render(b.t0 + 5);
      moving.clip.render(b.t1 - 1);
      expect(snapshot(still.view), `beat ${b.i + 1}`).toBe(snapshot(moving.view));
    }
  });

  it('holds before a beat that carries a prediction until it is passed', () => {
    const data = lessonClips[2] as ClipScene;
    const gate = data.beats.findIndex((b) => b.gate);
    const { clip } = make(data, false);
    expect(clip.openGate()).toBe(gate);
    const hold = (clip.beats[gate]?.t0 ?? 0) - 1;
    expect(clip.limit()).toBe(hold);
    clip.seek(clip.duration);
    expect(clip.t).toBe(hold);
    expect(clip.atGate()).toBe(true);
    expect(clip.k).toBe(gate - 1);
    clip.pass(gate);
    // The trace asks twice: the second prediction (tapped on the row) holds the clip in its turn.
    const second = data.beats.findIndex((b, i) => i > gate && b.gate);
    expect(clip.openGate()).toBe(second);
    clip.seek(clip.duration);
    expect(clip.t).toBe((clip.beats[second]?.t0 ?? 0) - 1);
    clip.pass(second);
    expect(clip.openGate()).toBe(-1);
    clip.seek(clip.duration);
    expect(clip.atEnd()).toBe(true);
  });

  it('rests on a poster before the first caption, and steps between the ends of beats', () => {
    const { clip } = make(lessonClips[1] as ClipScene, true);
    expect(clip.poster).toBe((clip.beats[0]?.t0 ?? 0) - 1);
    expect(clip.stops()).toEqual([clip.poster, ...clip.beats.map((b: BeatTime) => b.t1 - 1)]);
    clip.open();
    expect(clip.t).toBe(clip.poster);
    expect(clip.k).toBe(-1);
    clip.next();
    expect(clip.t).toBe((clip.beats[0]?.t1 ?? 0) - 1);
    clip.next();
    expect(clip.k).toBe(1);
    clip.prev();
    expect(clip.t).toBe((clip.beats[0]?.t1 ?? 0) - 1);
    clip.prev();
    expect(clip.t).toBe(clip.poster);
  });

  it('keeps its place within a beat when it is built again for another size', () => {
    const view = stageElement(960, 0);
    let width = 960;
    const data = lessonClips[2] as ClipScene;
    const clip = new Clip((env) => compile(data, env), view, { get width() { return width; } });
    const b = clip.beats[3];
    if (!b) throw new Error('the trace has six beats');
    clip.render(b.t0 + (b.t1 - b.t0) / 2);
    width = 320;
    clip.build();
    expect(clip.W).toBe(320);
    expect(clip.k).toBe(3);
  });
});
