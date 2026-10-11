// A lesson the learner can poke, through the real tools, in memory: an explore on bars, one on a
// curve chart, one on dots with a goal, and a gate answered by a tap, from start_lesson to a
// published file that verifies. Then what an agent gets wrong on the way: each mistake is refused
// with its own code, comes back with the template of that scene, and with a `next` that says to
// send the same scene again.
//
// The lesson is the validator tests' own honest one (test/validate/clip-kit.ts, `interactiveLesson`),
// written against the example's evidence. The same lesson goes through the spawned bundle in
// stdio.test.ts.
import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ISSUES } from '../../src/core/issues';
import { templateFor } from '../../src/core/templates';
import type { Issue } from '../../src/core/types';
import { readEmbeddedData, renderLesson } from '../../src/render';
import { runVerify, verifyFile } from '../../src/server/cli';
import { templateForSent, wantsTemplate } from '../../src/server/tools/scene';
import { interactive, interactiveLesson, type InteractiveKind } from '../validate/clip-kit';
import type { Json } from './helpers/clips';
import { NOON, startWorld, type Envelope, type World } from './helpers/kit';

let w: World;
beforeEach(async () => {
  w = await startWorld({ deps: { now: () => NOON } });
});
afterEach(async () => {
  await w.close();
});

const LESSON = interactiveLesson();
const codes = (list: readonly Issue[]): string[] => list.map((e) => e.code);
const sceneOf = (id: string): Json => structuredClone(LESSON.scenes.find((scene) => scene.id === id)) as Json;

/** start_lesson, save_evidence and plan_lesson for the interactive lesson. */
async function plannedLesson(): Promise<{ lessonId: string; plan: Envelope }> {
  const started = await w.call('start_lesson', LESSON.start);
  const lessonId = started.lessonId as string;
  expect((await w.call('save_evidence', { lessonId, items: LESSON.evidence })).errors).toEqual([]);
  const plan = await w.call('plan_lesson', { lessonId, ...LESSON.plan });
  expect(plan.errors).toEqual([]);
  return { lessonId, plan };
}

describe('a lesson the learner can poke, from start to a published file', () => {
  it('start_lesson says, before anything is written, that the learner acts first and what they can do', async () => {
    const started = await w.call('start_lesson', LESSON.start);
    expect(started.limits.actFirst).toBe('The learner acts before being told: a prediction, a tap on the picture, or a slider to drag, in at least two of every three clips.');
    expect(started.limits.clip.learnerActions.shareOfClips).toBe(0.67);
    expect(started.limits.clip.chartMarks).toEqual(['bars', 'line', 'curve']);
    expect(started.limits.structure.exploreExpected).toBe(true);
    expect(started.contract).toMatch(/The learner acts before being told: a prediction, a tap on the picture or a slider to drag, in at least two of every three clips\./);
    expect(started.contract).toMatch(/"explore" ends a clip with sliders/);
  });

  it('plan_lesson answers each clip with its template: a tap gate for the row of cells, an explore for the dots and the bars, and the curve chart the plan named', async () => {
    const { plan } = await plannedLesson();
    expect(plan).toMatchObject({ ok: true, stage: 'planned', next: { tool: 'submit_scene' } });
    const templates = Object.fromEntries((plan.templates as Json[]).map((t) => [t.id, t]));
    expect(Object.keys(templates)).toEqual(['x-tap', 'h-flow', 'q1', 'x-bars', 'x-curve', 'q2', 'x-dots', 'end']);
    // The plan named the mark of one chart and not of the other.
    expect(templates['x-bars'].stage).toMatchObject({ kind: 'chart', mark: 'bars' });
    expect(templates['x-curve'].stage).toMatchObject({ kind: 'chart', mark: 'curve' });
    expect(templates['x-curve'].stage.curves).toHaveLength(2);
    for (const id of ['x-bars', 'x-curve', 'x-dots']) {
      expect(Object.keys(templates[id].explore), id).toEqual(['prompt', 'controls', 'bind', 'goal']);
      expect(templates[id].stage.provenance, id).toBe('worked');
    }
    expect(templates['h-flow'].explore).toBeUndefined();
    expect(templates['x-tap'].beats[1].gate).toMatchObject({ pick: ['c1'] });
    expect(templates['h-flow'].beats[1].gate.options).toHaveLength(2);
    // And the notes say what each of the three is, once.
    const notes = (plan.templateNotes as string[]).join('\n');
    expect(notes).toMatch(/`explore` on a clip \(the chart and dots templates show one\) comes last/);
    expect(notes).toMatch(/A formula \(`expr`, a point's `x`, `when`\) is a string\./);
    expect(notes).toMatch(/A gate may be answered on the picture instead \(the cells template shows one\)/);
    expect(notes).toMatch(/chart `mark` is "bars" \(the template\), "line" \(.*\) or "curve"/);
    expect(notes).toMatch(/The learner acts before being told: at least two of every three clips need a gate or an `explore`\./);
    // The plan as stored keeps the mark.
    const shown = await w.call('get_lesson', { lessonId: plan.lessonId });
    expect((shown.plan.outline as Json[]).find((entry) => entry.id === 'x-curve')).toMatchObject({ stage: 'chart', mark: 'curve', status: 'pending' });
  });

  it('goes through every stage with next right at each, publishes, and verifies with --strict', async () => {
    const { lessonId } = await plannedLesson();
    const [first, ...rest] = LESSON.scenes;
    const one = await w.call('submit_scene', { lessonId, scene: first });
    expect(one.errors).toEqual([]);
    expect(one).toMatchObject({ ok: true, accepted: true, sceneId: 'x-tap', stage: 'writing', next: { tool: 'submit_scene' }, warnings: [] });
    const results: Envelope[] = [];
    for (const scene of rest) results.push(await w.call('submit_scene', { lessonId, scene }));
    expect(results.flatMap((r) => r.errors)).toEqual([]);
    expect(results.flatMap((r) => r.warnings)).toEqual([]);
    // A clip that ends in an explore reports its captions beat by beat; what the explore says is in the scene's total.
    const dots = results.find((r) => r.sceneId === 'x-dots') as Envelope;
    expect(dots.metrics.beats).toEqual([7, 7]);
    expect(dots.metrics.words).toBe(7 + 7 + 14);
    const last = results.at(-1) as Envelope;
    expect(last).toMatchObject({ stage: 'ready', pending: [], next: { tool: 'publish_lesson' }, lessonReport: { ok: true, errors: [], warnings: [] } });
    // Three explores at three quarters of a minute each are in the estimate.
    expect(last.totals.minutes).toBe(last.lessonReport.stats.minutes);

    const published = await w.call('publish_lesson', { lessonId });
    expect(published.errors).toEqual([]);
    expect(published).toMatchObject({ ok: true, stage: 'published', published: true, next: { tool: 'reply' }, receipt: { warnings: {} } });
    const file = published.file.path as string;

    // The page: identical to what this build renders from its data, which is the lesson that was validated.
    expect(await verifyFile(file, { strict: true })).toMatchObject({ ok: true, dataOk: true, receiptMatches: true, page: { result: 'identical' } });
    const lines: string[] = [];
    expect(await runVerify([file, '--strict'], { out: (l) => lines.push(l), err: (l) => lines.push(l) })).toBe(0);
    expect(lines.join('\n')).toMatch(/^OK {2}"Binary search, with your hands on it"/);

    // What is embedded is what was sent: the sliders, the formulas, the goal, and the parts that count as right.
    const html = await readFile(file, 'utf8');
    const data = readEmbeddedData(html)!;
    const embedded: Record<string, Json> = Object.fromEntries(data.lesson.scenes.map((scene) => [scene.id, scene as unknown as Json]));
    const at = (id: string): Json => embedded[id] as Json;
    expect(at('x-bars').explore.bind).toEqual([{ target: 'linear', expr: '2^doublings' }, { target: 'binary', expr: 'doublings + 1' }]);
    expect(at('x-curve').stage.curves.map((c: Json) => c.expr)).toEqual(['log2(x) + 1', 'spend']);
    expect(at('x-curve').explore.controls[0]).toMatchObject({ id: 'spend', min: 2, max: 11, step: 1, value: 5 });
    expect(at('x-dots').explore.goal).toEqual({ text: 'Compare until four items are still possible.', when: '64 / 2^looks == 4', done: 'Four halvings take 64 items down to four.' });
    expect(at('x-tap').beats[1].gate).toMatchObject({ pick: ['c2'], prompt: 'Tap the cell the search compares first.' });
    // Drawn again from its data, it is the same page.
    expect(renderLesson({ lesson: data.lesson, receipt: data.receipt }).html).toBe(html);

    // A formula changed in the published data: the lesson is no longer the one that was validated.
    await writeFile(file, html.replace('"expr":"2^doublings"', '"expr":"3^doublings"'));
    expect(await runVerify([file], { out: () => undefined, err: () => undefined })).toBe(1);
  });

  it('a new server over the same home finds the lesson with its explores, and publishes the same page', async () => {
    const { lessonId } = await plannedLesson();
    for (const scene of LESSON.scenes) expect((await w.call('submit_scene', { lessonId, scene })).errors).toEqual([]);
    await w.restart();
    const shown = await w.call('get_lesson', { lessonId, include: ['scene:x-curve'] });
    expect(shown).toMatchObject({ stage: 'ready', next: { tool: 'publish_lesson' } });
    expect(shown.scenes[0].scene.explore.bind).toEqual([{ target: 'items', expr: '2^(spend - 1)' }]);
    const published = await w.call('publish_lesson', { lessonId });
    expect(published.ok).toBe(true);
    expect(await verifyFile(published.file.path, { strict: true })).toMatchObject({ ok: true, page: { result: 'identical' } });
  });
});

describe('what an agent gets wrong in an explore, a formula or a tap gate', () => {
  const mistakes: [what: string, kind: InteractiveKind, change: (s: Json) => void, code: string, path: string, why: RegExp][] = [
    ['a formula with ** for a power', 'bars', (s) => (s.explore.bind[0].expr = '2**doublings'), 'FORMULA_SYNTAX', 'explore.bind[0].expr', /Every formula is tried over the whole range of its sliders/],
    ['a control that nothing uses', 'bars', (s) => s.explore.controls.push({ id: 'speed', label: 'Speed', min: 1, max: 3, step: 1, value: 1 }), 'CONTROL_UNUSED', 'explore.controls[1].id', /An explore is tried at every position of its sliders/],
    ['a goal already true at the start', 'dots', (s) => (s.explore.goal.when = '64 / 2^looks <= 32'), 'GOAL_ALREADY_MET', 'explore.goal.when', /An explore is tried at every position of its sliders/],
    ['a goal that cannot be reached', 'dots', (s) => (s.explore.goal.when = '64 / 2^looks < 1'), 'GOAL_UNREACHABLE', 'explore.goal.when', /An explore is tried at every position of its sliders/],
    ['binding a bar on a dots stage', 'dots', (s) => (s.explore.bind[0].target = 'bar'), 'BINDING_UNKNOWN_TARGET', 'explore.bind[0].target', /An explore is tried at every position of its sliders/],
    ['a tap gate naming a part that is not yet shown', 'tap', (s) => s.beats[1].do.unshift({ verb: 'show', target: 'c2' }), 'PICK_NOT_ON_STAGE', 'beats[1].gate.pick[0]', /A gate answered by a tap can only name parts that are on stage before its own beat plays/],
    ['a curve with ln(x) over an axis that includes 0', 'curve', (s) => { s.stage.x.min = 0; s.stage.curves[0].expr = 'ln(x)'; }, 'FORMULA_NOT_FINITE', 'stage.curves[0].expr', /where a value fails, the error names the first setting at which it does/],
    ['an explore on a sourced stage', 'bars', (s) => (s.stage.provenance = 'sourced'), 'EXPLORE_ON_SOURCED_STAGE', 'stage.provenance', /An explore is tried at every position of its sliders/],
  ];

  it.each(mistakes)('%s: refused with its code, the scene\'s template and the same scene to send again', async (_what, kind, change, code, path, why) => {
    const { lessonId } = await plannedLesson();
    const scene = interactive(kind) as Json;
    change(scene);
    const r = await w.call('submit_scene', { lessonId, scene });
    expect(r).toMatchObject({ ok: false, accepted: false, sceneId: scene.id, stage: 'planned' });
    expect(r.errors.map((e) => `${e.code} ${e.path}`)).toEqual([`${code} ${path}`]);
    expect(r.errors[0]).toMatchObject({ sceneId: scene.id, severity: 'error' });
    // The fix is the one written for this submission, not the catalog's general one.
    expect(r.errors[0]!.fix).not.toBe((ISSUES as Record<string, { fix: string }>)[code]!.fix);
    // The template of that scene comes back: the chart that was sent, with an explore or a gate that passes as it stands.
    const entry = LESSON.plan.outline.find((e) => e.id === scene.id)!;
    expect(r.template).toEqual(templateFor({ ...entry, ...(scene.stage.kind === 'chart' ? { mark: scene.stage.mark } : {}) }));
    expect(r.template.stage).toMatchObject({ kind: scene.stage.kind, ...(scene.stage.kind === 'chart' ? { mark: scene.stage.mark } : {}) });
    if (kind === 'tap') expect(r.template.beats[1].gate.pick).toEqual(['c1']);
    else expect(r.template.explore.controls).toHaveLength(1);
    // And next: the same scene, under the same id, with what the check did.
    expect(r.next.tool).toBe('submit_scene');
    expect(r.next.why).toMatch(new RegExp(`^"${scene.id}" was not stored\\. Change only what each error's "fix" says and submit it again under the same id\\.`));
    expect(r.next.why).toMatch(why);
    // Nothing was stored.
    expect((await w.call('get_lesson', { lessonId })).plan.accepted).toEqual([]);
    // Corrected, the same scene is accepted.
    expect((await w.call('submit_scene', { lessonId, scene: interactive(kind) })).errors).toEqual([]);
  });

  it('a misspelt key of a tap gate comes back as a rename, with the template that shows the gate', async () => {
    const { lessonId } = await plannedLesson();
    const scene = interactive('tap') as Json;
    scene.beats[1].gate.picks = scene.beats[1].gate.pick;
    delete scene.beats[1].gate.pick;
    const r = await w.call('submit_scene', { lessonId, scene });
    expect(r.errors.map((e) => `${e.code} ${e.path}`)).toEqual(['UNKNOWN_FIELD beats[1].gate.picks']);
    expect(r.errors[0]!.fix).toBe('Rename "picks" to "pick". Valid fields here: prompt, pick, right, wrong.');
    expect(r.template.beats[1].gate).toMatchObject({ pick: ['c1'] });
    expect(r.next).toEqual({ tool: 'submit_scene', why: '"x-tap" was not stored. Change only what each error\'s "fix" says and submit it again under the same id.' });
  });

  it('a goal that an end of the slider reaches is accepted with a warning, and the published lesson records it', async () => {
    const { lessonId } = await plannedLesson();
    const swept = interactive('dots') as Json;
    swept.explore.goal.when = '64 / 2^looks <= 1';
    for (const scene of LESSON.scenes) {
      const r = await w.call('submit_scene', { lessonId, scene: scene.id === 'x-dots' ? swept : scene });
      expect(r.errors).toEqual([]);
      if (scene.id === 'x-dots') expect(r.warnings.map((x) => `${x.code} ${x.sceneId} ${x.path}`)).toEqual(['GOAL_AT_END x-dots explore.goal.when']);
    }
    const published = await w.call('publish_lesson', { lessonId });
    expect(published).toMatchObject({ ok: true, published: true, receipt: { warnings: { GOAL_AT_END: 1 } } });
    expect(published.reply).toContain('validation recorded 1 warning (GOAL_AT_END)');
  });

  it('the template that answers a rejected chart is the chart that was sent, whatever the plan said', () => {
    const entry = { id: 'k', kind: 'clip' as const, purpose: 'p', stage: 'chart' as const };
    // Sent as an object, as a string of JSON, and with its stage as a string of JSON.
    const curve = { id: 'k', kind: 'clip', stage: { kind: 'chart', mark: 'curve' } };
    for (const sent of [curve, JSON.stringify(curve), { ...curve, stage: JSON.stringify(curve.stage) }]) expect((templateForSent(entry, sent).stage as Json).mark).toBe('curve');
    // No mark that can be read: the plan's, and bars when the plan names none.
    expect((templateForSent({ ...entry, mark: 'line' }, { stage: { kind: 'chart', mark: 'pie' } }).stage as Json).mark).toBe('line');
    expect((templateForSent(entry, 'not json').stage as Json).mark).toBe('bars');
    // Another stage kind is untouched.
    expect(templateForSent({ ...entry, stage: 'dots' }, curve)).toEqual(templateFor({ ...entry, stage: 'dots' }));
  });

  it('every code about an explore, a formula or a tap gate is one the template is sent back for', () => {
    const interactiveCodes = Object.entries(ISSUES as Record<string, { group: string }>).filter(([, entry]) => entry.group === 'interactive').map(([code]) => code);
    expect(interactiveCodes.length).toBeGreaterThanOrEqual(21);
    for (const code of interactiveCodes) expect(wantsTemplate([{ code, severity: 'error', path: '', message: '', fix: '' }]), code).toBe(true);
    // A caption that cites the wrong passage is not: the template says nothing about it.
    expect(wantsTemplate([{ code: 'CLAIM_UNRELATED', severity: 'error', path: '', message: '', fix: '' }])).toBe(false);
  });
});

describe('a lesson in which too few clips ask anything', () => {
  /** The interactive lesson with the explore or the gate taken out of some clips. A curve chart then holds numbers where it named its slider. */
  const idle = (id: string): Json => {
    const scene = sceneOf(id);
    for (const beat of scene.beats) delete beat.gate;
    delete scene.explore;
    if (id === 'x-curve') {
      scene.stage.curves[1].expr = '5';
      scene.stage.points[0].x = '16';
    }
    return scene;
  };

  it('is told so as soon as it is certain, is refused at the end with the clips named, and one resubmission at a time puts it right', async () => {
    const { lessonId } = await plannedLesson();
    const strip = ['x-bars', 'x-curve'];
    const results: Record<string, Envelope> = {};
    for (const scene of LESSON.scenes) results[scene.id] = await w.call('submit_scene', { lessonId, scene: strip.includes(scene.id) ? idle(scene.id) : scene });
    // h-flow asks nothing by design. With x-bars idle too, two of five do nothing: four must act, so it is certain.
    expect(codes(results['h-flow']!.warnings)).toEqual([]);
    expect(results['x-bars']!.warnings.map((x) => `${x.code} ${x.sceneId}`)).toEqual(['ACTION_NEEDED x-bars']);
    expect(results['x-curve']!.warnings.map((x) => `${x.code} ${x.sceneId}`)).toEqual(['ACTION_NEEDED x-curve']);
    const last = results.end as Envelope;
    expect(last).toMatchObject({ ok: true, stage: 'writing' });
    expect(codes(last.lessonReport.errors)).toEqual(['INTERACTIVE_SHARE']);
    expect(last.lessonReport.errors[0].message).toBe("2 of the lesson's 5 clips contain a learner action (a gate or an explore); at least 4 must. Without one: h-flow, x-bars, x-curve.");
    expect(last.next).toEqual({
      tool: 'submit_scene',
      why: 'Every scene is accepted, but 1 error blocks publishing: "lessonReport.errors" has each error with its "fix". INTERACTIVE_SHARE needs a "gate" on a beat that shows an outcome (options, or a part of the picture to tap) or an "explore" after the last beat, in 2 of "h-flow", "x-bars", "x-curve"; the plan can stay as it is.',
    });
    const refused = await w.call('publish_lesson', { lessonId });
    expect(refused).toMatchObject({ ok: false, published: false, next: { tool: 'submit_scene' } });
    expect(codes(refused.errors)).toEqual(['INTERACTIVE_SHARE']);
    // One clip put right: still one short. The second: ready.
    const one = await w.call('submit_scene', { lessonId, scene: sceneOf('x-bars') });
    expect(one.next.why).toContain('in one of "h-flow", "x-curve"');
    const two = await w.call('submit_scene', { lessonId, scene: sceneOf('x-curve') });
    expect(two).toMatchObject({ stage: 'ready', next: { tool: 'publish_lesson' }, lessonReport: { ok: true, errors: [] } });
    expect((await w.call('publish_lesson', { lessonId })).ok).toBe(true);
  });
});
