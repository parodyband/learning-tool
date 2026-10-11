// Drafts for the skill tests that put the skill's own examples through the real validator: the
// example lesson as clips, and a one-clip lesson around a clip the skill wrote by hand.
//
// Every excerpt here is SYNTHETIC: written for these tests, on hosts reserved for documentation.
// Nothing in this file is a real citation, and the titles say so.
import { AnyScene, type ClipScene } from '../../src/core/clip';
import { EXAMPLE_V2_SCENES } from '../../src/core/clip-examples';
import type { Evidence } from '../../src/core/schema';
import type { Draft } from '../../src/core/types';
import { exampleDraft } from '../helpers/example';

type Loose = Record<string, unknown>;

/** The outline entry a scene would have been planned with. */
function outlineEntry(scene: Loose): Loose {
  return {
    id: scene.id,
    kind: scene.kind,
    purpose: `What "${String(scene.title)}" is for`,
    ...(scene.kind === 'clip' ? { stage: (scene.stage as Loose).kind } : {}),
    ...(scene.kind === 'checkpoint' ? { question: (scene.question as Loose).type, objective: scene.objective } : {}),
  };
}

/** The example lesson as clips, at the point where every scene has been accepted. Its header and evidence are the example's. */
export function exampleClipDraft(): Draft {
  const draft = exampleDraft() as unknown as Loose;
  draft.outline = (EXAMPLE_V2_SCENES as Loose[]).map(outlineEntry);
  draft.scenes = EXAMPLE_V2_SCENES.map((scene) => AnyScene.parse(scene));
  return draft as unknown as Draft;
}

const filler = (n: number): string => `Synthetic filler passage number ${n}, stored so that the evidence ids of this test run on without a gap.`;

/** Evidence e1..eN where the given ids carry the given excerpts and every other id is filler. */
export function syntheticEvidence(excerpts: Readonly<Record<string, string>>): Evidence[] {
  const last = Math.max(...Object.keys(excerpts).map((id) => Number(id.slice(1))));
  return Array.from({ length: last }, (_, i) => {
    const id = `e${i + 1}`;
    return {
      id,
      url: `https://example.org/skill-tests/passage-${i + 1}`,
      title: `Passage ${i + 1} (synthetic test source)`,
      excerpt: excerpts[id] ?? filler(i + 1),
      via: 'page' as const,
      host: 'example.org',
      savedOn: '2026-10-11',
    };
  });
}

/**
 * A planned lesson with room for one clip: the clip, a checkpoint and the recap, none of them
 * written yet. `title` and `topic` matter to the number checks (a number in either is exempt), so
 * they are plain words.
 */
export function draftAround(clip: Pick<ClipScene, 'id' | 'stage'>, evidence: Evidence[]): Draft {
  const draft = exampleDraft() as unknown as Loose;
  draft.topic = 'A topic for the skill tests';
  draft.title = 'A lesson for the skill tests';
  draft.outline = [
    { id: clip.id, kind: 'clip', purpose: 'The clip under test', stage: clip.stage.kind },
    { id: 'check', kind: 'checkpoint', purpose: 'A question that is not written here', question: 'single', objective: 'o1' },
    { id: 'recap', kind: 'recap', purpose: 'A recap that is not written here' },
  ];
  draft.objectives = [{ id: 'o1', text: 'Explain what the clip under test shows' }];
  draft.scenes = [];
  draft.evidence = evidence;
  return draft as unknown as Draft;
}
