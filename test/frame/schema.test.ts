// The frame stage's shape: what the schema accepts, what it refuses, and the constants the page
// and the server must agree on.
import { describe, expect, it } from 'vitest';
import { ClipScene, Stage } from '../../src/core/clip';
import { FRAME_ASPECTS, FRAME_LIMITS, FRAME_NARROW_BELOW, FRAME_STAGE_UNITS, FrameParam, FrameStage, frameStageUnits } from '../../src/core/frame';
import { FRAME_EXAMPLES, frameExampleClip } from '../../src/core/frame-examples';
import { NARROW_BELOW, STAGE_UNITS, frameBeatTimes, frameStageHeight, stageUnits } from '../../src/player/frame/shared';

const CODE = 'function render(ctx, t) { S.clear(); }';
const base = { kind: 'frame', code: CODE, duration: 10, poster: 4, provenance: 'worked' } as const;
const slider = { id: 'angle', label: 'Launch angle', min: 15, max: 75, step: 1, value: 45 };

describe('FrameStage', () => {
  it('accepts the smallest frame and fills in the defaults', () => {
    const stage = FrameStage.parse(base);
    expect(stage).toEqual({ kind: 'frame', code: CODE, duration: 10, aspect: '16:9', params: [], poster: 4, cites: [], provenance: 'worked' });
  });

  it('accepts every aspect, sliders with a unit, and cites', () => {
    for (const aspect of FRAME_ASPECTS) expect(FrameStage.parse({ ...base, aspect }).aspect).toBe(aspect);
    const stage = FrameStage.parse({ ...base, params: [{ ...slider, unit: '°' }], cites: ['e1', 'e12'], provenance: 'sourced' });
    expect(stage.params[0]).toEqual({ ...slider, unit: '°' });
    expect(stage.cites).toEqual(['e1', 'e12']);
  });

  it('is strict: an unknown key is an error', () => {
    expect(FrameStage.safeParse({ ...base, description: 'x'.repeat(40) }).success).toBe(false);
    expect(FrameStage.safeParse({ ...base, html: '<b>' }).success).toBe(false);
    expect(FrameStage.safeParse({ ...base, params: [{ ...slider, default: 3 }] }).success).toBe(false);
  });

  it.each([
    ['no code', { ...base, code: '' }],
    ['code over the cap', { ...base, code: `${CODE}\n${'// pad\n'.repeat(4000)}` }],
    ['code that is not a string', { ...base, code: ['function render(ctx, t) {}'] }],
    ['a duration under the minimum', { ...base, duration: 1 }],
    ['a duration over the maximum', { ...base, duration: 121 }],
    ['a duration that is not finite', { ...base, duration: Infinity }],
    ['no poster', { kind: 'frame', code: CODE, duration: 10, provenance: 'worked' }],
    ['a negative poster', { ...base, poster: -1 }],
    ['an unknown aspect', { ...base, aspect: '21:9' }],
    ['no provenance', { kind: 'frame', code: CODE, duration: 10, poster: 4 }],
    ['an unknown provenance', { ...base, provenance: 'verified' }],
    ['four sliders', { ...base, params: ['a', 'b', 'c', 'd'].map((id) => ({ ...slider, id })) }],
    ['seven cites', { ...base, cites: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'] }],
    ['a cite that is not an evidence id', { ...base, cites: ['source-1'] }],
  ])('refuses %s', (_name, value) => {
    expect(FrameStage.safeParse(value).success).toBe(false);
  });

  it('measures the code cap in the same number the byte check uses', () => {
    expect(FrameStage.safeParse({ ...base, code: 'x'.repeat(FRAME_LIMITS.codeBytes) }).success).toBe(true);
    expect(FrameStage.safeParse({ ...base, code: 'x'.repeat(FRAME_LIMITS.codeBytes + 1) }).success).toBe(false);
  });
});

describe('FrameParam', () => {
  it.each(['angle', 'rate2', 'launchAngle', 'x'])('accepts the id %s', (id) => {
    expect(FrameParam.safeParse({ ...slider, id }).success).toBe(true);
  });

  it.each(['Angle', '2x', 'launch-angle', 'launch_angle', 'a b', '', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'a'.repeat(25)])('refuses the id %j', (id) => {
    expect(FrameParam.safeParse({ ...slider, id }).success).toBe(false);
  });

  it.each([
    ['an empty label', { ...slider, label: '' }],
    ['a zero step', { ...slider, step: 0 }],
    ['a negative step', { ...slider, step: -1 }],
    ['a value that is not a number', { ...slider, value: '45' }],
    ['a bound that is not finite', { ...slider, max: Infinity }],
    ['a unit that is too long', { ...slider, unit: ' metres per second' }],
  ])('refuses %s', (_name, value) => {
    expect(FrameParam.safeParse(value).success).toBe(false);
  });
});

describe('inside a clip', () => {
  it('is one of the stage kinds a clip accepts', () => {
    expect(Stage.safeParse(base).success).toBe(true);
    expect(Stage.safeParse({ ...base, unknown: true }).success).toBe(false);
  });

  it('the three examples are valid clip scenes with timed beats and no actions', () => {
    for (const example of FRAME_EXAMPLES) {
      const result = ClipScene.safeParse(frameExampleClip(example));
      expect(result.success ? [] : result.error.issues, example.id).toEqual([]);
      if (result.success) {
        expect(result.data.stage).toEqual(example.stage);
        for (const beat of result.data.beats) expect(beat.do).toEqual([]);
      }
    }
  });
});

describe('stage units', () => {
  it('are the same table in the schema and in the player', () => {
    expect(STAGE_UNITS).toEqual(FRAME_STAGE_UNITS);
    expect(NARROW_BELOW).toBe(FRAME_NARROW_BELOW);
    for (const aspect of FRAME_ASPECTS) {
      expect(stageUnits(aspect, false)).toEqual(frameStageUnits(aspect, false));
      expect(stageUnits(aspect, true)).toEqual(frameStageUnits(aspect, true));
      const [a, b] = aspect.split(':').map(Number) as [number, number];
      const u = FRAME_STAGE_UNITS[aspect];
      expect(u.w / u.h).toBeCloseTo(a / b, 6);
    }
    expect(FRAME_STAGE_UNITS.tall.w / FRAME_STAGE_UNITS.tall.h).toBe(4 / 5);
  });

  it('give a frame the height its shape wants', () => {
    expect(frameStageHeight('16:9', 960)).toBe(540);
    expect(frameStageHeight('4:3', 800)).toBe(600);
    expect(frameStageHeight('1:1', 700)).toBe(700);
    expect(frameStageHeight('16:9', 320)).toBe(400);
    expect(frameStageHeight(undefined, 1280)).toBe(720);
    expect(frameStageHeight('nonsense', 1280)).toBe(720);
  });
});

describe('frameBeatTimes', () => {
  it('turns `at` into the clip engine\'s beat times, in milliseconds', () => {
    const { beats, duration } = frameBeatTimes(17, [{ at: 0 }, { at: 1.6 }, { at: 5.1, gate: { prompt: 'p' } }, { at: 15.6 }]);
    expect(duration).toBe(17000);
    expect(beats).toEqual([
      { i: 0, t0: 0, t1: 1600, motionEnd: 1600, gate: false },
      { i: 1, t0: 1600, t1: 5100, motionEnd: 5100, gate: false },
      { i: 2, t0: 5100, t1: 15600, motionEnd: 15600, gate: true },
      { i: 3, t0: 15600, t1: 17000, motionEnd: 17000, gate: false },
    ]);
  });

  it('never produces a beat that starts before the one before it or after the end', () => {
    const { beats, duration } = frameBeatTimes(4, [{ at: 2 }, { at: 1 }, {}, { at: 99 }]);
    expect(duration).toBe(4000);
    expect(beats.map((b) => [b.t0, b.t1])).toEqual([
      [0, 1000],
      [1000, 1000],
      [1000, 4000],
      [4000, 4000],
    ]);
  });
});
