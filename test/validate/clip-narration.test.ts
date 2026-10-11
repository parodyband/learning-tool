// narrationSegments on lessons of clips: one segment for each beat, "<sceneId>.beat<N>", holding
// the caption as plain text, and nothing for a prediction (by options or by a tap) or for an
// explore: what the learner is asked to do is read on the screen, never spoken ahead of them.
import { describe, expect, it } from 'vitest';
import { beatSegmentId } from '../../src/core/clip';
import { ANALOGY_LIMITS_LEAD, beatSegment, narrationSegments } from '../../src/core/narration';
import { checkLesson } from '../../src/core/validate';
import { beatSegment as renderedBeatSegment } from '../../src/render/clip';
import { buildClipLesson } from './build-clips';
import { INTERACTIVE_CLIPS, changedLesson, clipDraft, draftAround, entryFor } from './clip-kit';
import { EXAMPLE_PLAN } from '../../src/core/examples';
import type { LessonV2 } from '../../src/core/clip';
import { assemble, submit } from './helpers';

describe('narrationSegments on clips that hand the picture over', () => {
  // The four honest interactive clips (bars, a curve chart, dots with a goal, a gate by a tap), as accepted scenes.
  const scenes = INTERACTIVE_CLIPS.map((clip) => {
    const draft = draftAround(clip);
    const check = submit(draft, structuredClone(clip));
    if (!check.ok || !check.scene) throw new Error(`${clip.id} refused`);
    return check.scene;
  });
  const lesson = { format: 'learning-tool/lesson@1', id: 'abc123def456', title: EXAMPLE_PLAN.title, topic: 'Binary search', language: 'en', depth: 'quick', level: 'new', objectives: EXAMPLE_PLAN.objectives, evidence: [], scenes } as unknown as LessonV2;
  const segments = narrationSegments(lesson);

  it('gives one segment for each beat and nothing else: 2 beats in each of the four clips', () => {
    expect(INTERACTIVE_CLIPS.map(entryFor).map((e) => e.stage)).toEqual(['chart', 'chart', 'dots', 'cells']);
    expect(segments.map((s) => s.id)).toEqual(scenes.flatMap((s) => (s.kind === 'clip' ? s.beats.map((_, i) => beatSegment(s.id, i)) : [])));
    expect(segments).toHaveLength(8);
  });

  it('says none of the words of an explore or of a tap gate', () => {
    const spoken = segments.map((s) => s.text).join(' | ');
    const unspoken = scenes.flatMap((s) => {
      if (s.kind !== 'clip') return [];
      const gates = s.beats.flatMap((b) => (b.gate && 'pick' in b.gate ? [b.gate.prompt, b.gate.right, b.gate.wrong] : []));
      const explore = s.explore ? [s.explore.prompt, ...s.explore.controls.map((c) => c.label).filter((label) => label.includes(' ')), ...(s.explore.goal ? [s.explore.goal.text, s.explore.goal.done] : [])] : [];
      return [...gates, ...explore];
    });
    expect(unspoken.length).toBeGreaterThanOrEqual(8);
    for (const text of unspoken) expect(spoken, text).not.toContain(text);
  });
});

describe('narrationSegments on the v2 example lesson', () => {
  const lesson = checkLesson(clipDraft()).lesson!;
  const segments = narrationSegments(lesson);
  const byId = new Map(segments.map((s) => [s.id, s]));

  it('gives one segment for each beat of each clip, then each checkpoint and the recap, in lesson order', () => {
    expect(segments.map((s) => s.id)).toEqual([
      'c1.beat1', 'c1.beat2', 'c1.beat3',
      'c2.beat1', 'c2.beat2', 'c2.beat3', 'c2.beat4', 'c2.beat5',
      'c3.beat1', 'c3.beat2', 'c3.beat3', 'c3.beat4', 'c3.beat5', 'c3.beat6',
      'q1',
      'c4.beat1', 'c4.beat2', 'c4.beat3',
      'c5.beat1', 'c5.beat2', 'c5.beat3', 'c5.beat4', 'c5.beat5',
      'q2',
      'c6.beat1', 'c6.beat2', 'c6.beat3', 'c6.beat4', 'c6.beat5',
      'q3',
      'end',
    ]);
    expect(new Set(segments.map((s) => s.id)).size).toBe(segments.length);
    for (const s of segments) expect(s.id === s.sceneId || s.id.startsWith(`${s.sceneId}.beat`)).toBe(true);
  });

  it('the text of a beat is its caption, plain, closed with a full stop', () => {
    expect(byId.get('c1.beat1')!.text).toBe('A million names, in order. You want exactly one of them.');
    expect(byId.get('c2.beat2')!.text).toBe('It compares the target with the middle element.');
    // A quote is read in the source's own words, as it is stored.
    expect(byId.get('c6.beat3')!.text).toBe('the half that is discarded may contain the target.');
    // Notation is read as text, without the marks.
    expect(byId.get('c6.beat5')!.text).toBe('Writing it as low + (high - low) / 2 avoids the overflow.');
  });

  it('a prediction is never narrated: the beat that carries one gives its caption only', () => {
    const gated = lesson.scenes.flatMap((s) => (s.kind === 'clip' ? s.beats.flatMap((b, i) => (b.gate ? [{ id: beatSegment(s.id, i), gate: b.gate, caption: b.caption }] : [])) : []));
    // The trace asks twice (once by options, once by a tap on the row) and the cost chart once.
    for (const id of ['c3.beat3', 'c3.beat4', 'c4.beat2']) expect(gated.map((g) => g.id)).toContain(id);
    expect(gated.some((g) => 'pick' in g.gate)).toBe(true);
    expect(gated.some((g) => 'options' in g.gate)).toBe(true);
    const spoken = segments.map((s) => s.text).join(' | ');
    for (const g of gated) {
      // The beat is still one segment, and it is its caption.
      expect(byId.get(g.id)!.text.replace(/\.$/, '')).toBe(g.caption.text.replace(/\.$/, ''));
      expect(spoken).not.toContain(g.gate.prompt);
      if ('pick' in g.gate) {
        expect(spoken).not.toContain(g.gate.right);
        expect(spoken).not.toContain(g.gate.wrong);
        continue;
      }
      for (const option of g.gate.options) {
        expect(spoken).not.toContain(option.text);
        expect(spoken).not.toContain(option.feedback);
      }
    }
  });

  it('an explore adds no segment and none of its words: the prompt, the labels, the goal and its reply are not narrated', () => {
    const explored = lesson.scenes.flatMap((s) => (s.kind === 'clip' && s.explore ? [s] : []));
    expect(explored.length).toBeGreaterThanOrEqual(1);
    const spoken = segments.map((s) => s.text).join(' | ');
    for (const clip of explored) {
      // One segment for each beat, and nothing after the last.
      expect(segments.filter((s) => s.sceneId === clip.id).map((s) => s.id)).toEqual(clip.beats.map((_, i) => beatSegment(clip.id, i)));
      expect(spoken).not.toContain(clip.explore!.prompt);
      if (clip.explore!.goal) {
        expect(spoken).not.toContain(clip.explore!.goal.text);
        expect(spoken).not.toContain(clip.explore!.goal.done);
      }
    }
  });

  it('never an excerpt, a stage label, a description or an explanation', () => {
    const spoken = segments.map((s) => s.text).join(' | ');
    for (const ev of lesson.evidence) expect(spoken).not.toContain(ev.excerpt);
    expect(spoken).not.toContain('Large words on an empty stage');
    expect(spoken).not.toContain('Look at the middle');
    for (const scene of lesson.scenes) if (scene.kind === 'checkpoint' && scene.question.type !== 'reflect') expect(spoken).not.toContain(scene.question.explanation.text);
  });

  it('uses the ids the format and the page use for a beat', () => {
    for (const [scene, index] of [['c1', 0], ['c3', 5], ['s12', 7]] as const) {
      expect(beatSegment(scene, index)).toBe(beatSegmentId(scene, index));
      expect(beatSegment(scene, index)).toBe(renderedBeatSegment(scene, index));
    }
    expect(beatSegment('c3', 0)).toBe('c3.beat1');
  });
});

describe('narrationSegments on other clips', () => {
  it('an analogy caption is read with where it breaks down, as in a narration scene', () => {
    const out = changedLesson({
      c1: (s) => (s.beats[0].caption = { type: 'analogy', text: 'It is like finding a word in a paper dictionary', limits: 'A reader guesses where to open.' }),
    });
    expect(out.errors).toEqual([]);
    const segments = narrationSegments(out.lesson!);
    expect(segments[0]).toEqual({ id: 'c1.beat1', sceneId: 'c1', text: `It is like finding a word in a paper dictionary. ${ANALOGY_LIMITS_LEAD} A reader guesses where to open.` });
  });

  it('a frame clip gives a segment for each beat too', () => {
    const report = checkLesson(assemble(buildClipLesson({ depth: 'quick', size: 'min', stages: ['frame', 'words'] })));
    expect(report.errors).toEqual([]);
    const segments = narrationSegments(report.lesson!);
    expect(segments.map((s) => s.id)).toEqual(['s1.beat1', 's1.beat2', 's2.beat1', 's2.beat2', 's3', 's4']);
    expect(segments.every((s) => s.text.length > 0)).toBe(true);
  });

  it('is the same on every call, and every maximal lesson is narrated beat for beat', () => {
    const report = checkLesson(assemble(buildClipLesson({ depth: 'deep', size: 'max' })));
    expect(report.errors).toEqual([]);
    const a = narrationSegments(report.lesson!);
    expect(narrationSegments(report.lesson!)).toEqual(a);
    const beats = report.lesson!.scenes.reduce((n, s) => n + (s.kind === 'clip' ? s.beats.length : 0), 0);
    expect(a.filter((s) => /\.beat[1-8]$/.test(s.id))).toHaveLength(beats);
    expect(beats).toBe(80);
  });
});
