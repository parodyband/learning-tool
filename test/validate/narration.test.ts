// narrationSegments: what is spoken, and what never is.
import { describe, expect, it } from 'vitest';
import { ANALOGY_LIMITS_LEAD, narrationSegments } from '../../src/core/narration';
import { checkLesson } from '../../src/core/validate';
import { exampleLesson } from '../helpers/example';
import { buildLesson } from './build';
import { assemble, exampleDraft } from './helpers';

describe('narrationSegments on the example lesson', () => {
  const lesson = checkLesson(exampleDraft()).lesson!;
  const segments = narrationSegments(lesson);
  const byId = new Map(segments.map((s) => [s.id, s]));

  it('gives one segment per narration scene, intro, step, checkpoint and recap, in lesson order', () => {
    expect(segments.map((s) => s.id)).toEqual(['s1', 's2', 's3.intro', 's3.step1', 's3.step2', 's3.step3', 's3.step4', 's3.step5', 's4', 's5', 's6', 's7', 's8', 's9']);
    expect(segments.map((s) => s.sceneId)).toEqual(['s1', 's2', 's3', 's3', 's3', 's3', 's3', 's3', 's4', 's5', 's6', 's7', 's8', 's9']);
    expect(new Set(segments.map((s) => s.id)).size).toBe(segments.length);
  });

  it('reads every block of a narration scene in order, and says where an analogy breaks down', () => {
    expect(byId.get('s1')!.text).toBe(
      'How do you find one name among a million without reading them all? ' +
        'Binary search looks at the middle of a sorted array and throws away the half where the value cannot be. ' +
        'Looking up a word in a paper dictionary works the same way: open near the middle, see whether your word comes before or after, and ignore the other half. ' +
        `${ANALOGY_LIMITS_LEAD} A reader guesses roughly where to open. Binary search always picks the exact middle.`,
    );
  });

  it('reads the blocks of each step, and the intro on its own', () => {
    expect(byId.get('s3.intro')!.text).toBe('Watch low, high and mid change as the interval shrinks.');
    expect(byId.get('s3.step3')!.text).toBe('Because the list is sorted, the half that is discarded cannot contain the target. low becomes mid + 1, which is 4.');
    expect(byId.get('s3.step5')!.text).toBe('mid is 4 and items[4] is 42: found on the third comparison. Each comparison halved the interval that was left to search.');
  });

  it('reads a quote as part of the scene, closed with a full stop', () => {
    expect(byId.get('s7')!.text).toBe(
      'Binary search is only reliable when the data is sorted. the half that is discarded may contain the target. ' +
        'Adding low and high before dividing can overflow a fixed-width integer when the array is very large. ' +
        'The code you traced already uses the safe form of the midpoint.',
    );
  });

  it('reads only the prompt of a checkpoint', () => {
    expect(byId.get('s4')!.text).toBe('You search a sorted list for 70. The middle element is 50. What does binary search do next?');
    expect(byId.get('s6')!.text).toBe('A sorted list has 1,000,000 items. At most how many comparisons does binary search need?');
    expect(byId.get('s8')!.text).toBe('Put one pass of binary search in order.');
  });

  it('reads the takeaways of the recap and nothing else of it', () => {
    expect(byId.get('s9')!.text).toBe(
      'Compare the target with the middle element, discard the half that cannot contain it, and repeat on what is left. ' +
        'Each comparison halves the interval, so the cost grows with log2(n), and it only works on sorted data.',
    );
  });

  it('never speaks answers, feedback, hints, excerpts, figure text or the learner profile', () => {
    const spoken = segments.map((s) => s.text).join('\n');
    const never = [
      'Search only the half after the middle element', // an option
      'Right: 70 is greater than 50', // feedback
      'Where do values larger than 50 live', // a hint
      'The target is compared with the middle element, and the half', // an explanation
      'Mixes up which side', // a misconception
      'Everything up to and including position 3', // a predict option
      '23 is less than 42', // a predict prompt
      'Find the middle element of the current interval', // an order item
      'def binary_search', // code of a figure
      'Sorted list and a target', // a figure label
      'A loop. Start with a sorted list', // a figure description
      'Start with the whole list', // a step title
      'One name in a million', // a scene title
      'Write binary search from memory in a language you use', // practice
      'Big-O notation', // a next topic
      'Writes simple loops', // the learner profile
    ];
    for (const text of never) expect(spoken, text).not.toContain(text);
    for (const evidence of lesson.evidence) {
      // An excerpt is heard only where the lesson quotes it, never whole.
      expect(spoken).not.toContain(evidence.excerpt);
      expect(spoken).not.toContain(evidence.url);
      expect(spoken).not.toContain(evidence.title);
    }
  });

  it('agrees with the lesson assembled by the shared test helper', () => {
    expect(narrationSegments(exampleLesson()).map((s) => s.id)).toEqual(segments.map((s) => s.id));
  });
});

describe('narrationSegments in general', () => {
  it('speaks plain text: no markup, math in readable form', () => {
    const lesson = exampleLesson();
    const scene = lesson.scenes[0] as any;
    scene.blocks = [
      { type: 'framing', text: 'Why is **halving** so *fast*, when `mid` is just $\\frac{low + high}{2}$?' },
      { type: 'claim', text: 'It needs about $\\log_2 n$ comparisons', cites: ['e2'] },
    ];
    const text = narrationSegments(lesson)[0]!.text;
    expect(text).toBe('Why is halving so fast, when mid is just (low + high)/2? It needs about log_2 n comparisons.');
    expect(text).not.toMatch(/[*`$\\]/);
  });

  it('leaves a sentence that already ends as it is, and closes one that does not', () => {
    const lesson = exampleLesson();
    const scene = lesson.scenes[0] as any;
    scene.blocks = [
      { type: 'framing', text: 'Ready?' },
      { type: 'framing', text: 'Look at this:' },
      { type: 'framing', text: 'He said "stop."' },
      { type: 'framing', text: 'No end here' },
      { type: 'framing', text: 'これで終わり。' },
    ];
    expect(narrationSegments(lesson)[0]!.text).toBe('Ready? Look at this: He said "stop." No end here. これで終わり。');
  });

  it('gives a step-through without an intro no intro segment', () => {
    const lesson = exampleLesson();
    delete (lesson.scenes[2] as any).intro;
    expect(narrationSegments(lesson).map((s) => s.id)).not.toContain('s3.intro');
    expect(narrationSegments(lesson).filter((s) => s.sceneId === 's3')).toHaveLength(5);
  });

  it('does not change the lesson, and gives the same segments every time', () => {
    const lesson = exampleLesson();
    const before = JSON.stringify(lesson);
    const a = narrationSegments(lesson);
    const b = narrationSegments(lesson);
    expect(JSON.stringify(lesson)).toBe(before);
    expect(b).toEqual(a);
  });

  it('covers every scene of a large generated lesson with non-empty text', () => {
    const report = checkLesson(assemble(buildLesson({ depth: 'deep', size: 'max' })));
    const lesson = report.lesson!;
    const segments = narrationSegments(lesson);
    expect(new Set(segments.map((s) => s.sceneId))).toEqual(new Set(lesson.scenes.map((s) => s.id)));
    expect(new Set(segments.map((s) => s.id)).size).toBe(segments.length);
    const steps = lesson.scenes.reduce((n, s) => n + (s.kind === 'step_through' ? s.steps.length + (s.intro ? 1 : 0) : 1), 0);
    expect(segments).toHaveLength(steps);
    for (const segment of segments) {
      expect(segment.text.trim()).toBe(segment.text);
      expect(segment.text.length).toBeGreaterThan(0);
      expect(segment.id === segment.sceneId || segment.id.startsWith(`${segment.sceneId}.`)).toBe(true);
    }
    // The amount to synthesise is bounded by the lesson's prose, which the validator has bounded.
    const characters = segments.reduce((n, s) => n + s.text.length, 0);
    expect(characters).toBeLessThan(40_000);
  });
});
