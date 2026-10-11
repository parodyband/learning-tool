// The v2 format as a schema: what parses, what does not, and that the strictness rule holds.
import { describe, expect, it } from 'vitest';
import { Action, AnyScene, Beat, CLIP_LIMITS, ClipScene, LessonV2, STAGE_KINDS, Stage, VERBS, VERBS_BY_STAGE, beatSegmentId, verbsFor } from '../../src/core/clip';
import { EXAMPLE_CLIPS, EXAMPLE_V2_SCENES } from '../../src/core/clip-examples';
import { FORMAT } from '../../src/core/schema';
import { exampleEvidence } from '../helpers/example';
import { exampleLessonV2, lessonOf } from '../helpers/clip-example';

const framing = (text: string) => ({ type: 'framing' as const, text });
const words = { kind: 'words' as const, lines: [{ id: 'a', text: 'Hello' }], provenance: 'illustrative' as const };
const clip = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  kind: 'clip',
  title: 'A clip',
  description: 'A description long enough to say what the clip shows.',
  stage: words,
  beats: [{ caption: framing('One.') }, { caption: framing('Two.'), do: [{ verb: 'show', target: 'a' }] }],
  ...over,
});

describe('ClipScene', () => {
  it('parses a minimal clip and applies the defaults', () => {
    const parsed = ClipScene.parse(clip());
    expect(parsed.beats[0]?.do).toEqual([]);
    expect(parsed.stage.cites).toEqual([]);
    expect(parsed.pace).toBeUndefined();
  });

  it('refuses an unknown key at every level', () => {
    expect(ClipScene.safeParse(clip({ duration: 3 })).success).toBe(false);
    expect(ClipScene.safeParse(clip({ stage: { ...words, color: 'red' } })).success).toBe(false);
    expect(ClipScene.safeParse(clip({ stage: { ...words, lines: [{ id: 'a', text: 'Hello', x: 10 }] } })).success).toBe(false);
    expect(ClipScene.safeParse(clip({ beats: [{ caption: framing('One.'), delay: 200 }, { caption: framing('Two.') }] })).success).toBe(false);
    expect(Action.safeParse({ verb: 'show', target: 'a', easing: 'ease-out' }).success).toBe(false);
    expect(Action.safeParse({ verb: 'move', target: 'a', to: 'b', duration: 400 }).success).toBe(false);
  });

  it('holds a clip to two to eight beats and a beat to four actions', () => {
    const beat = { caption: framing('One.') };
    expect(ClipScene.safeParse(clip({ beats: [beat] })).success).toBe(false);
    expect(ClipScene.safeParse(clip({ beats: Array.from({ length: CLIP_LIMITS.beats.max }, () => beat) })).success).toBe(true);
    expect(ClipScene.safeParse(clip({ beats: Array.from({ length: CLIP_LIMITS.beats.max + 1 }, () => beat) })).success).toBe(false);
    const show = { verb: 'show', target: 'a' };
    expect(Beat.safeParse({ caption: framing('x'), do: [show, show, show, show] }).success).toBe(true);
    expect(Beat.safeParse({ caption: framing('x'), do: [show, show, show, show, show] }).success).toBe(false);
  });

  it('takes one block as a caption, with the v1 citation fields', () => {
    expect(Beat.safeParse({ caption: { type: 'claim', text: 'A fact.', cites: ['e1'] } }).success).toBe(true);
    expect(Beat.safeParse({ caption: { type: 'claim', text: 'A fact.' } }).success).toBe(false);
    expect(Beat.safeParse({ caption: { type: 'claim', text: 'A fact.', cite: ['e1'] } }).success).toBe(false);
    expect(Beat.safeParse({ caption: [framing('a'), framing('b')] }).success).toBe(false);
    expect(Beat.safeParse({ caption: 'A string' }).success).toBe(false);
  });

  it('takes a prediction as the v1 Predict', () => {
    const option = (correct: boolean) => ({ text: 'An option', correct, feedback: 'Why this is so, in a sentence.' });
    expect(Beat.safeParse({ caption: framing('x'), gate: { prompt: 'What next?', options: [option(true), option(false)] } }).success).toBe(true);
    expect(Beat.safeParse({ caption: framing('x'), gate: { prompt: 'What next?', options: [option(true)] } }).success).toBe(false);
  });

  it('accepts only the three paces', () => {
    for (const pace of ['brisk', 'normal', 'calm']) expect(ClipScene.safeParse(clip({ pace })).success).toBe(true);
    expect(ClipScene.safeParse(clip({ pace: 'slow' })).success).toBe(false);
    expect(ClipScene.safeParse(clip({ pace: 1.5 })).success).toBe(false);
  });
});

describe('Stage', () => {
  it('knows nine kinds, and names them when the kind is wrong', () => {
    expect(STAGE_KINDS).toEqual(['sequence', 'cells', 'dots', 'chart', 'flow', 'words', 'lines', 'timeline', 'frame']);
    const bad = Stage.safeParse({ kind: 'slideshow' });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain('timeline');
  });

  it('requires provenance on every kind and caps cites at six', () => {
    for (const kind of STAGE_KINDS) {
      const stage = { ...(ClipScene.parse(EXAMPLE_CLIPS[kind]).stage as Record<string, unknown>) };
      expect(Stage.safeParse(stage).success, kind).toBe(true);
      delete stage.provenance;
      expect(Stage.safeParse(stage).success, `${kind} without provenance`).toBe(false);
    }
    expect(Stage.safeParse({ ...words, provenance: 'guessed' }).success).toBe(false);
    expect(Stage.safeParse({ ...words, cites: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'] }).success).toBe(true);
    expect(Stage.safeParse({ ...words, cites: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'] }).success).toBe(false);
    expect(Stage.safeParse({ ...words, cites: ['source-1'] }).success).toBe(false);
  });

  it('splits a chart by its mark', () => {
    const common = { kind: 'chart', provenance: 'worked' };
    const bars = [{ id: 'a', label: 'A', value: 1 }, { id: 'b', label: 'B', value: 2 }];
    const series = [{ id: 's', label: 'S', values: [1, 2] }];
    expect(Stage.safeParse({ ...common, mark: 'bars', bars }).success).toBe(true);
    expect(Stage.safeParse({ ...common, mark: 'line', xs: ['1', '2'], series }).success).toBe(true);
    expect(Stage.safeParse({ ...common, mark: 'bars', xs: ['1', '2'], series }).success).toBe(false);
    expect(Stage.safeParse({ ...common, mark: 'line', bars }).success).toBe(false);
    expect(Stage.safeParse({ ...common, mark: 'pie', bars }).success).toBe(false);
    expect(Stage.safeParse({ ...common, mark: 'bars', bars: [{ id: 'a', label: 'A', value: -1 }, { id: 'b', label: 'B', value: 2 }] }).success).toBe(false);
  });

  it('holds each kind to its limits', () => {
    const cells = (n: number) => ({ kind: 'cells', provenance: 'worked', cells: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, label: String(i) })) });
    expect(Stage.safeParse(cells(CLIP_LIMITS.cells.cells.max)).success).toBe(true);
    expect(Stage.safeParse(cells(CLIP_LIMITS.cells.cells.max + 1)).success).toBe(false);
    const dots = (total: number) => ({ kind: 'dots', provenance: 'worked', total, group: { id: 'all', label: 'All' } });
    expect(Stage.safeParse(dots(1000)).success).toBe(true);
    expect(Stage.safeParse(dots(1001)).success).toBe(false);
    expect(Stage.safeParse(dots(12.5)).success).toBe(false);
    const stat = (i: number) => ({ id: `s${i}`, label: 'Count', value: i });
    expect(Stage.safeParse({ ...dots(10), stats: [stat(1), stat(2), stat(3)] }).success).toBe(true);
    expect(Stage.safeParse({ ...dots(10), stats: [stat(1), stat(2), stat(3), stat(4)] }).success).toBe(false);
    expect(Stage.safeParse({ ...words, stats: [stat(1)] }).success).toBe(false);
  });
});

describe('Action', () => {
  it('knows twelve verbs', () => {
    expect(VERBS).toEqual(['show', 'hide', 'draw', 'send', 'focus', 'set', 'move', 'swap', 'split', 'merge', 'reorder', 'pulse']);
    const bad = Action.safeParse({ verb: 'fade', target: 'a' });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain('reorder');
  });

  it('accepts every verb in the shape the engine reads', () => {
    const ok: unknown[] = [
      { verb: 'show', targets: ['a', 'b'], from: 'left' },
      { verb: 'hide', target: 'a' },
      { verb: 'draw', target: 'a', upto: 'Jun' },
      { verb: 'send', target: 'syn', outcome: 'lost' },
      { verb: 'send', along: 'ab', label: 'q?', tone: 'warn' },
      { verb: 'send', from: 'a', to: 'b' },
      { verb: 'focus' },
      { verb: 'focus', targets: ['a'], zoom: true },
      { verb: 'focus', between: ['a', 'b'] },
      { verb: 'set', target: 'a', value: 3 },
      { verb: 'set', target: 'a', value: 'warm', tone: 'good' },
      { verb: 'set', target: 'a', label: 'New words', size: 'large' },
      { verb: 'set', between: ['a', 'b'], tone: 'muted' },
      { verb: 'move', target: 'p', to: 'a' },
      { verb: 'move', target: 'r', to: ['a', 'b'] },
      { verb: 'swap', a: 'a', b: 'b' },
      { verb: 'split', target: 'all', into: [{ id: 'x', label: 'X', count: 3, tone: 'bad' }, { id: 'y', label: 'Y', count: 7 }], pick: 'first' },
      { verb: 'merge', targets: ['x', 'y'], into: { id: 'z', label: 'Z' } },
      { verb: 'reorder', order: ['b', 'a'] },
      { verb: 'pulse', target: 'a', with: true, on: 'a phrase' },
    ];
    for (const a of ok) expect(Action.safeParse(a).success, JSON.stringify(a)).toBe(true);
  });

  it('refuses the shapes an agent is most likely to get wrong', () => {
    const bad: unknown[] = [
      { verb: 'move', target: 'p' },
      { verb: 'move', target: 'p', to: ['a'] },
      { verb: 'swap', a: 'a' },
      { verb: 'split', target: 'all', into: [{ id: 'x', label: 'X', count: 3 }] },
      { verb: 'split', target: 'all', into: [{ id: 'x', label: 'X', count: 0 }, { id: 'y', label: 'Y', count: 7 }] },
      { verb: 'merge', targets: ['x'], into: { id: 'z', label: 'Z' } },
      { verb: 'set', target: 'a', tone: 'red' },
      { verb: 'set', target: 'a', size: 'huge' },
      { verb: 'send', target: 'syn', outcome: 'dropped' },
      { verb: 'show', target: 'A part' },
      { verb: 'show', targets: [] },
      { verb: 'focus', targets: ['a'], zoom: 2 },
      { verb: 'pulse', target: 'a', with: 'previous' },
    ];
    for (const a of bad) expect(Action.safeParse(a).success, JSON.stringify(a)).toBe(false);
  });

  it('lists, for every stage kind, verbs that exist', () => {
    for (const [stage, verbs] of Object.entries(VERBS_BY_STAGE)) for (const v of verbs) expect(VERBS, `${stage}: ${v}`).toContain(v);
    expect(verbsFor({ kind: 'chart', mark: 'bars' })).toContain('reorder');
    expect(verbsFor({ kind: 'chart', mark: 'line' })).toContain('draw');
    expect(verbsFor({ kind: 'frame' })).toEqual([]);
    expect(verbsFor({ kind: 'cells' })).toContain('swap');
    expect(verbsFor({ kind: 'nothing' })).toEqual([]);
  });
});

describe('LessonV2', () => {
  it('holds clips beside the v1 scene kinds', () => {
    const lesson = exampleLessonV2();
    expect(lesson.scenes.map((s) => s.kind)).toEqual(['clip', 'clip', 'clip', 'checkpoint', 'clip', 'clip', 'checkpoint', 'clip', 'checkpoint', 'recap']);
    expect(lesson.format).toBe(FORMAT);
    expect(AnyScene.safeParse(EXAMPLE_V2_SCENES[0]).success).toBe(true);
  });

  it('is strict about its scenes', () => {
    const base = { format: FORMAT, id: 'abc123def456', title: 'A lesson', topic: 'A topic', language: 'en', depth: 'quick', level: 'new', objectives: [{ id: 'o1', text: 'Do a thing well' }], evidence: exampleEvidence() };
    expect(LessonV2.safeParse({ ...base, scenes: [clip()] }).success).toBe(true);
    expect(LessonV2.safeParse({ ...base, scenes: [] }).success).toBe(false);
    expect(LessonV2.safeParse({ ...base, scenes: [clip({ kind: 'film' })] }).success).toBe(false);
    expect(lessonOf([clip() as never]).scenes).toHaveLength(1);
  });

  it('names beat segments from 1', () => {
    expect(beatSegmentId('c3', 0)).toBe('c3.beat1');
    expect(beatSegmentId('c3', 5)).toBe('c3.beat6');
  });
});
