// The validator and the engine must agree. The player compiles a clip before it plays it and
// throws when an action names a part that does not exist or a verb the part does not take; a clip
// the validator accepted must never do that in a learner's browser.
//
// So the real kits (src/player/stage) are loaded here, on the fake DOM the clip tests use, and:
//   - every clip the validator accepts in these tests compiles, at a desk width and a phone width;
//   - the table of which verb acts on which kind of part (CORE_KIT_VERBS, written in the validator
//     and derived from the kit code) is held to the kits: for every part of every core stage and
//     each shared verb, the validator refuses exactly when the kit throws;
//   - the mistakes the validator refuses for the stage's sake are ones the kit throws on too;
//   - a clip that hands the picture over (an explore, a curve chart) compiles, and what the
//     validator refuses about an explore is what the engine would have thrown on;
//   - which parts are on show when a gate opens, as the validator works it out from the actions
//     (runStage), is what the engine offers for a tap at that instant.
import { beforeAll, describe, expect, it } from 'vitest';
import { STAGE_KINDS, VERBS_BY_STAGE, type ClipScene } from '../../src/core/clip';
import { EXAMPLE_V2_SCENES } from '../../src/core/clip-examples';
import { EXTRA_EXAMPLE_CLIPS } from '../../src/core/clip-kits-extra-examples';
import { PLAN_STAGE_KINDS } from '../../src/core/schema';
import { templateFor } from '../../src/core/templates';
import { CORE_KIT_VERBS, kitVerbs, runStage, stageParts, tappableKinds, type PartKind } from '../../src/core/validate/stage';
import { type FakeElement, installFakeDom, stageElement } from '../clip/fake-dom';
import { buildClipLesson } from './build-clips';
import { HONEST_CLIPS, INTERACTIVE_CLIPS, LESSON_SCENES, changedHonest, changedInteractive, checkAlone, honest, interactive, parsed, type Loose } from './clip-kit';

interface Compiled {
  beats: { i: number; t0: number; t1: number }[];
  duration: number;
  apply(t: number): void;
  /** The parts a tap gate may offer at time t. */
  taps?(t: number): { id: string }[];
}
let compile: (data: unknown, env: { el: FakeElement; W: number; H: number; dpr: number; colors: unknown }) => Compiled;
let stageHeight: (W: number, room?: number) => number;

const ENGINE = '../../src/player/stage';
const KITS = ['kit-sequence', 'kit-cells', 'kit-dots', 'kit-chart', 'kit-flow', 'kit-words', 'kit-lines', 'kit-timeline'];
const COLORS = { neutral: [127, 134, 189], accent: [170, 181, 255], good: [134, 214, 163], bad: [255, 161, 152], warn: [242, 197, 107], muted: [77, 83, 145] } as const;

beforeAll(async () => {
  installFakeDom();
  const load = (name: string): Promise<unknown> => import(/* @vite-ignore */ `${ENGINE}/${name}`);
  ({ compile, stageHeight } = (await load('timeline')) as { compile: typeof compile; stageHeight: typeof stageHeight });
  for (const kit of KITS) await load(kit);
});

/** What the engine says about a clip: null when it compiles and draws, or the message it throws. */
function engineError(clip: ClipScene, W = 960): string | null {
  try {
    const H = stageHeight(W);
    const c = compile(clip, { el: stageElement(W, H), W, H, dpr: 1, colors: COLORS });
    c.apply(0);
    c.apply(c.duration / 2);
    c.apply(c.duration);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const stageCodes = (check: { errors: { code: string }[] }): string[] => check.errors.map((e) => e.code).filter((code) => /^(ACTION|STAGE|SPLIT|REORDER|GROUP|MESSAGE)_/.test(code));

describe('what the validator accepts, the engine plays', () => {
  const typed = HONEST_CLIPS.filter((clip) => clip.stage.kind !== 'frame');

  it.each(typed.map((clip) => [clip.id, clip] as const))('%s compiles at 960 px and at 320 px', (_id, clip) => {
    expect(checkAlone(structuredClone(clip)).errors).toEqual([]);
    expect(engineError(parsed(clip), 960)).toBeNull();
    expect(engineError(parsed(clip), 320)).toBeNull();
  });

  it('so do the clips of the example lesson and of the two extra kits', () => {
    const clips = [...EXAMPLE_V2_SCENES.filter((s) => s.kind === 'clip'), ...EXTRA_EXAMPLE_CLIPS];
    expect(clips).toHaveLength(10);
    for (const clip of clips) {
      expect(checkAlone(structuredClone(clip)).errors, clip.id).toEqual([]);
      expect(engineError(parsed(clip)), clip.id).toBeNull();
    }
  });

  it.each(PLAN_STAGE_KINDS.filter((kind) => kind !== 'frame').map((kind) => [kind] as const))('the %s template, as it comes, compiles: its actions name its own parts', (kind) => {
    const clip = templateFor({ id: 't1', kind: 'clip', stage: kind });
    expect(stageCodes(checkAlone(clip))).toEqual([]);
    expect(engineError(parsed(clip), 960)).toBeNull();
    expect(engineError(parsed(clip), 320)).toBeNull();
  });
});

describe('the verb table of the six core stages is the kits\' own', () => {
  const CORE = ['sequence', 'cells', 'dots', 'chart', 'line', 'flow', 'words'] as const;
  const SHARED = ['show', 'hide', 'pulse', 'focus', 'set'] as const;

  /** The honest clip of a kind with one more action in its last beat, and nothing else changed. */
  function withAction(kind: (typeof CORE)[number], action: Loose): Loose {
    const clip = honest(kind);
    const last = clip.beats[clip.beats.length - 1];
    last.do = [...(last.do ?? []).slice(0, 3), action];
    return clip;
  }

  it('lists, for every core stage, exactly the verbs core/clip gives it, and the read-out verbs', () => {
    for (const [key, table] of Object.entries(CORE_KIT_VERBS)) {
      const listed = VERBS_BY_STAGE[key] as readonly string[];
      const mine = Object.keys(table);
      // Every verb of the stage is in the table.
      expect(listed.filter((verb) => !mine.includes(verb)), key).toEqual([]);
      // What the table adds is for read-outs only (show, hide, set, pulse, focus on a stat).
      for (const verb of mine.filter((v) => !listed.includes(v))) expect((table as Record<string, readonly string[]>)[verb], `${key} ${verb}`).toEqual(['stat']);
    }
    expect(new Set(Object.keys(CORE_KIT_VERBS).map((key) => key.split('.')[0]))).toEqual(new Set(STAGE_KINDS.filter((k) => k !== 'lines' && k !== 'timeline' && k !== 'frame')));
  });

  it('for every part and every shared verb, the validator refuses exactly when the kit throws', () => {
    let tried = 0;
    let refused = 0;
    for (const kind of CORE) {
      const base = parsed(honest(kind));
      const table = kitVerbs(base.stage);
      // The parts that are on stage when the last beat plays: on a dots stage, the groups left by the splits.
      const parts: { id: string; kind: PartKind }[] = base.stage.kind === 'dots' ? [{ id: 'four', kind: 'group' }, { id: 'out', kind: 'group' }, { id: 'looks', kind: 'stat' }] : stageParts(base.stage);
      for (const part of parts) {
        for (const verb of SHARED) {
          const action = verb === 'set' ? { verb, target: part.id, tone: 'accent' } : { verb, target: part.id };
          const clip = withAction(kind, action);
          const check = checkAlone(clip);
          const refusal = check.errors.filter((e) => e.code === 'ACTION_VERB_NOT_ALLOWED');
          const allowed = (table[verb] ?? []).includes(part.kind);
          const thrown = engineError(parsed(clip));
          const where = `${kind}: ${verb} on ${part.kind} "${part.id}" (engine: ${thrown ?? 'plays'})`;
          expect(refusal.length === 0, where).toBe(allowed);
          expect(thrown === null, where).toBe(allowed);
          tried++;
          if (!allowed) refused++;
        }
      }
    }
    expect(tried).toBeGreaterThan(120);
    expect(refused).toBeGreaterThan(10);
  });

  it('a `set` may give a part only what the kit can change on it', () => {
    const cases: Array<[kind: (typeof CORE)[number], action: Loose, ok: boolean]> = [
      ['chart', { verb: 'set', target: 'steps', value: 30 }, true],
      ['chart', { verb: 'set', target: 'steps', value: 'thirty' }, false],
      ['chart', { verb: 'set', target: 'steps', label: 'Fewer steps' }, false],
      ['words', { verb: 'set', target: 'ask', tone: 'good' }, true],
      ['words', { verb: 'set', target: 'ask', label: 'Another question' }, false],
      ['words', { verb: 'set', target: 'ask', value: 3 }, false],
      ['cells', { verb: 'set', target: 'c1', label: '5' }, true],
      ['cells', { verb: 'set', target: 'c1', value: 5 }, true],
      ['sequence', { verb: 'set', target: 'array', label: 'Half of the array' }, true],
      ['flow', { verb: 'set', target: 'search', size: 'large' }, true],
      ['flow', { verb: 'set', target: 'search', label: 'Search' }, true],
    ];
    for (const [kind, action, ok] of cases) {
      const clip = withAction(kind, action);
      const where = `${kind} ${JSON.stringify(action)}`;
      expect(checkAlone(clip).errors.filter((e) => e.code === 'ACTION_PARAMETER').length === 0, where).toBe(ok);
      expect(engineError(parsed(clip)) === null, where).toBe(ok);
    }
  });
});

describe('what the validator refuses for the stage\'s sake, the engine would have thrown on', () => {
  const cases: Array<[what: string, kind: Parameters<typeof changedHonest>[0], change: (s: Loose) => void, code: string]> = [
    ['an action on a part that does not exist', 'cells', (s) => (s.beats[1].do[0].target = 'middle'), 'ACTION_UNKNOWN_PART'],
    ['a move to a cell that does not exist', 'cells', (s) => (s.beats[1].do[0].to = 'c9'), 'ACTION_UNKNOWN_PART'],
    ['a verb the stage does not have', 'flow', (s) => s.beats[0].do.push({ verb: 'swap', a: 'sorted', b: 'search' }), 'ACTION_VERB_NOT_ALLOWED'],
    ['a move of something that is not a pointer', 'cells', (s) => (s.beats[1].do[0].target = 'c0'), 'ACTION_VERB_NOT_ALLOWED'],
    ['a draw of a node', 'flow', (s) => (s.beats[0].do[0] = { verb: 'draw', target: 'sorted' }), 'ACTION_VERB_NOT_ALLOWED'],
    ['a cue that is not in the caption', 'sequence', (s) => (s.beats[2].do[2].on = 'throws away'), 'ACTION_CUE_NOT_IN_CAPTION'],
    ['a split whose groups do not add up', 'dots', (s) => (s.beats[0].do[0].into[0].count = 9), 'SPLIT_COUNT_MISMATCH'],
    ['a split of a group that is gone', 'dots', (s) => (s.beats[1].do[0].target = 'all'), 'GROUP_NOT_ON_STAGE'],
    ['a reorder that leaves a cell out', 'cells', (s) => (s.beats[3].do[2] = { verb: 'reorder', order: ['c4', 'c3', 'c1', 'c0'] }), 'REORDER_INCOMPLETE'],
    ['a reorder that names a bar twice', 'chart', (s) => (s.beats[1].do[2].order = ['steps', 'steps']), 'REORDER_INCOMPLETE'],
    ['a message sent twice', 'sequence', (s) => (s.beats[1].do[0].target = 'ask'), 'MESSAGE_SENT_TWICE'],
    ['two parts with one id', 'cells', (s) => (s.stage.pointers[0].id = 'c0'), 'STAGE_DUPLICATE_ID'],
    ['a group created under an id that is taken', 'dots', (s) => (s.beats[1].do[0].into[0].id = 'gone'), 'STAGE_DUPLICATE_ID'],
    ['a message to someone who is not there', 'sequence', (s) => (s.stage.messages[0].to = 'list'), 'STAGE_UNKNOWN_REF'],
    ['an edge to a node that is not there', 'flow', (s) => (s.stage.edges[1].to = 'found'), 'STAGE_UNKNOWN_REF'],
    ['a series with too few values', 'line', (s) => s.stage.series[1].values.pop(), 'STAGE_INCONSISTENT'],
    ['a draw up to an x position the chart does not have', 'line', (s) => (s.beats[0].do[0].upto = '128'), 'ACTION_UNKNOWN_PART'],
    ['a send on a flow with nowhere to go', 'flow', (s) => (s.beats[1].do[1] = { verb: 'send', label: 'unsorted' }), 'ACTION_TARGET'],
    ['a pointer sent to a range of lines', 'lines', (s) => (s.beats[0].do[0].to = ['l1', 'l2']), 'ACTION_PARAMETER'],
    ['a span moved to one event', 'timeline', (s) => (s.beats[1].do[2] = { verb: 'move', target: 'run', to: 'first' }), 'ACTION_PARAMETER'],
    ['an annotation on a line the stage does not have', 'lines', (s) => (s.stage.annotations[0].at = 'l9'), 'STAGE_UNKNOWN_REF'],
  ];

  it.each(cases)('%s', (_what, kind, change, code) => {
    const clip = honest(kind);
    change(clip);
    const check = checkAlone(clip);
    expect(check.errors.map((e) => e.code)).toContain(code);
    expect(check.ok).toBe(false);
    // The schema still takes it: nothing but these rules stands between this clip and the player.
    expect(engineError(parsed(clip))).not.toBeNull();
  });
});

describe('a clip that hands the picture over plays', () => {
  it.each(INTERACTIVE_CLIPS.map((clip) => [clip.id, clip] as const))('%s is accepted and compiles at 960 px and at 320 px', (_id, clip) => {
    expect(checkAlone(structuredClone(clip)).errors).toEqual([]);
    expect(engineError(parsed(clip), 960)).toBeNull();
    expect(engineError(parsed(clip), 320)).toBeNull();
  });

  it.each(['dots', 'chart'] as const)('the %s template, with its explore as it comes, compiles', (kind) => {
    const clip = templateFor({ id: 't1', kind: 'clip', stage: kind });
    expect(clip.explore).toBeDefined();
    expect(engineError(parsed(clip), 960)).toBeNull();
  });

  it.each(['line', 'curve'] as const)('the template of a chart with mark "%s" compiles: its actions name its own parts', (mark) => {
    const clip = templateFor({ id: 't1', kind: 'clip', stage: 'chart', mark });
    expect(stageCodes(checkAlone(clip))).toEqual([]);
    expect(engineError(parsed(clip), 960)).toBeNull();
    expect(engineError(parsed(clip), 320)).toBeNull();
  });

  it('for every part of a curve chart and each shared verb, the validator refuses exactly when the kit throws', () => {
    const base = parsed(interactive('curve'));
    const table = kitVerbs(base.stage);
    let tried = 0;
    for (const part of stageParts(base.stage)) {
      for (const verb of ['show', 'hide', 'pulse', 'focus', 'set', 'draw'] as const) {
        const clip = interactive('curve');
        const action = verb === 'set' ? { verb, target: part.id, tone: 'accent' } : { verb, target: part.id };
        clip.beats[1].do = [...clip.beats[1].do.slice(0, 3), action];
        const refusal = checkAlone(clip).errors.filter((e) => e.code === 'ACTION_VERB_NOT_ALLOWED');
        const allowed = (table[verb] ?? []).includes(part.kind);
        const thrown = engineError(parsed(clip));
        const where = `${verb} on ${part.kind} "${part.id}" (engine: ${thrown ?? 'plays'})`;
        expect(refusal.length === 0, where).toBe(allowed);
        expect(thrown === null, where).toBe(allowed);
        tried++;
      }
    }
    expect(tried).toBe(24);
  });

  const refused: Array<[what: string, kind: Parameters<typeof changedInteractive>[0], change: (s: Loose) => void, code: string]> = [
    ['a formula that cannot be read', 'bars', (s) => (s.explore.bind[0].expr = '2 ** doublings'), 'FORMULA_SYNTAX'],
    ['a formula that names what is not a control', 'bars', (s) => (s.explore.bind[0].expr = '2^steps'), 'FORMULA_UNKNOWN_NAME'],
    ['a goal that is a number', 'dots', (s) => (s.explore.goal.when = '64 / 2^looks'), 'GOAL_NOT_CONDITION'],
    ['two controls with one id', 'dots', (s) => s.explore.controls.push({ ...s.explore.controls[0] }), 'CONTROL_DUPLICATE_ID'],
    ['a part bound twice', 'bars', (s) => s.explore.bind.push({ target: 'linear', expr: 'doublings' }), 'BINDING_DUPLICATE'],
    ['a binding on a part that is not there', 'bars', (s) => (s.explore.bind[1].target = 'ternary'), 'BINDING_UNKNOWN_TARGET'],
    ['a binding on the group every dot starts in', 'dots', (s) => (s.explore.bind[0].target = 'all'), 'BINDING_NOT_BINDABLE'],
    ['a curve that names a control the clip does not declare', 'curve', (s) => delete s.explore, 'FORMULA_UNKNOWN_NAME'],
    ['a point on a curve the chart does not have', 'curve', (s) => (s.stage.points[0].on = 'costs'), 'STAGE_UNKNOWN_REF'],
    ['an x axis that runs backwards', 'curve', (s) => Object.assign(s.stage.x, { min: 1024, max: 1 }), 'STAGE_INCONSISTENT'],
    ['a draw that stops off the x axis', 'curve', (s) => (s.beats[0].do[0].upto = '4096'), 'ACTION_PARAMETER'],
  ];
  it.each(refused)('what the validator refuses, the engine would have thrown on: %s', (_what, kind, change, code) => {
    const clip = interactive(kind);
    change(clip);
    expect(checkAlone(clip).errors.map((e) => e.code)).toContain(code);
    expect(engineError(parsed(clip))).not.toBeNull();
  });
});

describe('what is on show when a gate opens is what the engine offers for a tap', () => {
  /** The ids the engine offers at the instant beat `i` begins, which is when a gate on it opens. */
  function offered(clip: ClipScene, W: number): string[][] | null {
    const H = stageHeight(W);
    const c = compile(clip, { el: stageElement(W, H), W, H, dpr: 1, colors: COLORS });
    if (typeof c.taps !== 'function') return null;
    return c.beats.map((beat) => {
      c.apply(beat.t0);
      return (c.taps as (t: number) => { id: string }[])(beat.t0).map((target) => target.id);
    });
  }

  /** The same, from the clip's actions alone: every part of a tappable kind that runStage has on show before that beat. */
  function expected(clip: ClipScene): string[][] {
    const parts = stageParts(clip.stage);
    const run = runStage(clip, parts);
    const kinds = tappableKinds(clip.stage);
    const kindOf = new Map(parts.map((part) => [part.id, part.kind] as const));
    return run.before.map((shown) => [...shown].filter((id) => kinds.includes(run.groups.has(id) ? 'group' : (kindOf.get(id) as PartKind))));
  }

  // The words stage is laid out by the page itself, which the fake DOM does not do: its taps are measured, not computed.
  const clips = [...HONEST_CLIPS, ...INTERACTIVE_CLIPS, ...(LESSON_SCENES.filter((s) => s.kind === 'clip') as typeof HONEST_CLIPS), ...EXTRA_EXAMPLE_CLIPS].filter((clip) => clip.stage.kind !== 'frame' && clip.stage.kind !== 'words');

  it.each(clips.map((clip) => [clip.id, clip] as const))('%s: beat by beat, at 960 px', (_id, clip) => {
    const scene = parsed(clip);
    const engine = offered(scene, 960);
    if (engine === null) return;
    const mine = expected(scene);
    // The first beat cannot carry a gate; from the second on, the two must agree part for part.
    for (let i = 1; i < scene.beats.length; i++) expect([...(engine[i] as string[])].sort(), `${clip.id}, before beat ${i + 1}`).toEqual([...(mine[i] as string[])].sort());
  });

  it('the same holds on a narrow stage, where a timeline is laid out event by event', () => {
    for (const clip of clips) {
      const scene = parsed(clip);
      const engine = offered(scene, 320);
      if (engine === null) continue;
      const mine = expected(scene);
      for (let i = 1; i < scene.beats.length; i++) expect([...(engine[i] as string[])].sort(), `${clip.id}, before beat ${i + 1}`).toEqual([...(mine[i] as string[])].sort());
    }
  });

  it('and for the clips of generated lessons, of every stage kind and many shapes', () => {
    let compared = 0;
    for (const size of ['min', 'max', 3, 7, 11, 19] as const) {
      for (const scene of buildClipLesson({ depth: 'deep', size }).scenes as Loose[]) {
        if (scene.kind !== 'clip' || scene.stage.kind === 'frame' || scene.stage.kind === 'words') continue;
        const clip = parsed(scene);
        const engine = offered(clip, 960);
        if (engine === null) continue;
        const mine = expected(clip);
        for (let i = 1; i < clip.beats.length; i++) {
          expect([...(engine[i] as string[])].sort(), `${size}/${scene.id} (${scene.stage.kind}), before beat ${i + 1}`).toEqual([...(mine[i] as string[])].sort());
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(100);
  });
});
