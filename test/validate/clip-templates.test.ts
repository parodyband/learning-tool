// The fill-in skeleton plan_lesson returns for a clip, one for each stage kind: it has the shape
// of the format, says in every string what belongs there, plays as it stands (its actions name its
// own parts), shows what the rules ask of a finished clip, and is refused if it is submitted
// unfilled. The templates of the stages whose numbers can follow a slider (bars, curves, dots) end
// in an explore that passes as it stands, and the cells template asks its question on the picture.
// And the notes that are sent with it say only what is true of clips.
import { describe, expect, it } from 'vitest';
import { ClipScene, VERBS_BY_STAGE, type StageKind } from '../../src/core/clip';
import { EXTRA_KIT_VERB_SUMMARY } from '../../src/core/clip-kits-extra';
import { LIMITS as L } from '../../src/core/limits';
import { PLAN_CHART_MARKS, PLAN_STAGE_KINDS, type PlanChartMark } from '../../src/core/schema';
import { CLIP_TEMPLATE_NOTES, FRAME_TEMPLATE_CODE, LEGACY_TEMPLATE_NOTES, TEMPLATE_NOTES, templateFor, templateNotesFor } from '../../src/core/templates';
import { countWords } from '../../src/core/text';
import { sceneFields } from '../../src/core/validate/fields';
import { LEFT_IN_PLACE, PLACEHOLDERS, placeholderIssues } from '../../src/core/validate/placeholders';
import { STAGE_VERB_NOTES, kitVerbs } from '../../src/core/validate/stage';
import { EXPR_HELP, evalExpr, parseExpr } from '../../src/core/expr';
import { checkFrame, checkFrameBeats } from '../../src/frame/check';
import { checkAlone, type Loose } from './clip-kit';

const template = (stage: StageKind): Loose => templateFor({ id: 't1', kind: 'clip', stage });
const chart = (mark: PlanChartMark): Loose => templateFor({ id: 't1', kind: 'clip', stage: 'chart', mark });
const KINDS = PLAN_STAGE_KINDS.map((kind) => [kind] as const);
/** The stage kinds whose template ends in an explore: what a slider can drive in its own way. */
const EXPLORED: readonly string[] = ['dots', 'chart'];
/** Every template there is: one for each stage kind, and the two other charts. */
const ALL: [string, () => Loose][] = [...PLAN_STAGE_KINDS.map((kind): [string, () => Loose] => [kind, () => template(kind)]), ['chart with a line', () => chart('line')], ['chart with curves', () => chart('curve')]];

describe('the template of a clip', () => {
  it.each(KINDS)('%s: parses under the schema, with the planned id and stage kind', (kind) => {
    const t = template(kind);
    const parsed = ClipScene.safeParse(t);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(t).toMatchObject({ id: 't1', kind: 'clip', title: 'Scene title', stage: { kind } });
    expect(Object.keys(t)).toEqual(['id', 'kind', 'title', 'description', 'stage', 'beats', ...(EXPLORED.includes(kind) ? ['explore'] : [])]);
  });

  it.each(KINDS)('%s: is a fresh object each call', (kind) => {
    const a = template(kind);
    a.beats.length = 0;
    a.stage.cites.push('e9');
    expect(template(kind).beats.length).toBeGreaterThanOrEqual(2);
    expect(template(kind).stage.cites).toEqual(['e1']);
  });

  it.each(KINDS.filter(([kind]) => kind !== 'frame'))('%s: has at least one action of the verbs the stage is best at, and only verbs the stage has', (kind) => {
    const t = ClipScene.parse(template(kind));
    const verbs = t.beats.flatMap((beat) => beat.do.map((action) => action.verb));
    expect(verbs.length).toBeGreaterThanOrEqual(2);
    const allowed = Object.keys(kitVerbs(t.stage));
    for (const verb of verbs) expect(allowed, `${kind}: ${verb}`).toContain(verb);
    // The verb that is the stage's own: what no other picture would show as well.
    const own: Record<string, string[]> = { sequence: ['send'], cells: ['move', 'swap'], dots: ['split', 'merge'], chart: ['set', 'reorder'], flow: ['draw', 'send'], words: ['show'], lines: ['move', 'show'], timeline: ['draw', 'move'] };
    for (const verb of own[kind] as string[]) expect(verbs, `${kind} shows ${verb}`).toContain(verb);
    // Every beat moves, a later beat carries the prediction, and `with` and `on` are shown somewhere.
    expect(t.beats.every((beat) => beat.do.length > 0)).toBe(true);
    expect(t.beats[0]!.gate).toBeUndefined();
  });

  it('between them the templates show `with`, a gate, a range, and every kind of caption', () => {
    const all = PLAN_STAGE_KINDS.map(template);
    const actions = all.flatMap((t) => t.beats.flatMap((beat: Loose) => beat.do ?? []));
    expect(actions.some((a: Loose) => a.with === true)).toBe(true);
    expect(actions.some((a: Loose) => Array.isArray(a.between))).toBe(true);
    expect(actions.some((a: Loose) => Array.isArray(a.targets))).toBe(true);
    expect(all.filter((t) => t.beats.some((beat: Loose) => beat.gate)).length).toBeGreaterThanOrEqual(7);
    // Both kinds of gate: options to choose from, and a part of the picture to tap.
    expect(all.some((t) => t.beats.some((beat: Loose) => beat.gate?.options))).toBe(true);
    expect(all.filter((t) => t.beats.some((beat: Loose) => beat.gate?.pick)).map((t) => t.stage.kind)).toEqual(['cells']);
    expect(new Set(all.flatMap((t) => t.beats.map((beat: Loose) => beat.caption.type)))).toEqual(new Set(['claim', 'quote', 'example', 'analogy', 'framing']));
  });

  it.each(KINDS)('%s: shows what a finished clip must have: a claim or a quote, short captions, cites where the stage needs them', (kind) => {
    const t = template(kind);
    // Every clip needs a caption that is a claim or a quote, the opening words clip included.
    expect(t.beats.some((beat: Loose) => beat.caption.type === 'claim' || beat.caption.type === 'quote'), kind).toBe(true);
    // A caption is one block, within the target length even as a placeholder; an analogy counts with its limits.
    for (const beat of t.beats) {
      expect(Array.isArray(beat.caption)).toBe(false);
      const words = countWords(beat.caption.text, 'en') + (beat.caption.limits ? countWords(beat.caption.limits, 'en') : 0);
      expect(words, `${kind}: ${beat.caption.text}`).toBeLessThanOrEqual(L.captionWords.warn);
    }
    // A sourced or worked stage cites; the template shows the field on every stage.
    expect(['sourced', 'worked', 'illustrative']).toContain(t.stage.provenance);
    expect(t.stage.cites).toEqual(['e1']);
  });

  it('the frame template is a frame that passes the frame checks, with beats that carry `at` and no actions', () => {
    const t = ClipScene.parse(template('frame'));
    if (t.stage.kind !== 'frame') throw new Error('not a frame');
    expect(t.stage.code).toBe(FRAME_TEMPLATE_CODE);
    expect(checkFrame(t.stage)).toEqual({ ok: true, issues: [] });
    expect(checkFrameBeats(t.stage.duration, t.beats.map((beat) => beat.at))).toEqual([]);
    expect(t.beats.every((beat) => beat.do.length === 0)).toBe(true);
    expect((template('frame').beats as Loose[]).every((beat) => !('do' in beat))).toBe(true);
    expect(FRAME_TEMPLATE_CODE).toContain('function render(ctx, t) {');
    expect(FRAME_TEMPLATE_CODE.split('\n').length).toBeGreaterThan(8);
  });

  it('a clip planned without a stage kind still gets a template', () => {
    expect(templateFor({ id: 'c1', kind: 'clip' })).toMatchObject({ kind: 'clip', stage: { kind: 'flow' } });
  });
});

describe('a clip template submitted as it came', () => {
  it.each(KINDS)('%s: is refused for every placeholder it holds, and for nothing about its stage or its actions', (kind) => {
    const check = checkAlone(template(kind));
    expect(check.ok).toBe(false);
    const codes = new Set(check.errors.map((e) => e.code));
    expect(codes.has('PLACEHOLDER_TEXT')).toBe(true);
    // The placeholders are not grounded in anything, and say so (the made-up values of the sourced
    // chart included); nothing else is wrong with the skeleton.
    for (const code of codes) expect(['PLACEHOLDER_TEXT', 'CLAIM_UNRELATED', 'QUOTE_NOT_FOUND', 'MORE_ISSUES'], `${kind}: ${code}`).toContain(code);
    expect(check.warnings.filter((w) => w.code !== 'MORE_ISSUES')).toEqual([]);
    const paths = check.errors.filter((e) => e.code === 'PLACEHOLDER_TEXT').map((e) => e.path);
    for (const path of ['title', 'description', 'beats[0].caption.text', 'beats[1].caption.text']) expect(paths, `${kind}: ${path}`).toContain(path);
  });

  it('every string a learner would read is a known placeholder, apart from the few a real lesson may hold there', () => {
    // What a real clip may say in the very field the template says it in.
    const real = new Set(['a', 'b', 'c', 'here', 'now', 'x', 'Python', 'second line', 'third line', 'Later', 'Later still', 'First', 'Second', 'Third', '%']);
    let short = 0;
    for (const [kind, make] of ALL) {
      const fields = sceneFields(ClipScene.parse(make())).fields;
      const flagged = new Set(placeholderIssues(fields).map((i) => i.path));
      for (const field of fields) {
        expect(flagged.has(field.path), `${kind}: ${field.path} = "${field.text}"`).toBe(!real.has(field.text));
        if (flagged.has(field.path) && !PLACEHOLDERS.has(field.text)) short++;
      }
    }
    expect(short).toBeGreaterThan(25);
    const clipKinds = [...LEFT_IN_PLACE.keys()].filter((kind) => kind.startsWith('stage.') || kind.startsWith('beats['));
    expect(clipKinds.length).toBeGreaterThanOrEqual(12);
  });

  it('the frame template\'s code, unchanged, is a placeholder too', () => {
    const check = checkAlone(template('frame'));
    expect(check.errors.filter((e) => e.code === 'PLACEHOLDER_TEXT').map((e) => e.path)).toContain('stage.code');
  });

  it('a filled-in template is accepted: the skeleton and a few true sentences are a clip', () => {
    const t = template('flow');
    Object.assign(t, { title: 'Why the data must be sorted', description: 'Sorted data goes into binary search and the target is found; with unsorted data the result is unreliable.' });
    t.stage.cites = ['e3'];
    t.stage.nodes = [{ id: 'a', label: 'Sorted data' }, { id: 'b', label: 'Binary search' }, { id: 'c', label: 'Target found' }];
    delete t.stage.edges[0].label;
    t.beats[0].caption = { type: 'claim', text: 'Binary search only works when the data is sorted.', cites: ['e3'] };
    t.beats[1].caption = { type: 'quote', text: 'the half that is discarded may contain the target', cite: 'e3' };
    t.beats[1].gate = { prompt: 'The data is not sorted. What can go wrong?', options: [{ text: 'The half thrown away holds the target', correct: true, feedback: 'Yes: without order nothing says which half to keep.' }, { text: 'The search takes a little longer', correct: false, feedback: 'It is not slower; it can simply miss the target.' }] };
    t.beats[2].caption = { type: 'framing', text: 'So sort first, then search.' };
    t.beats[2].do[0].label = 'the target';
    const check = checkAlone(t);
    expect([...check.errors, ...check.warnings].map((i) => `${i.code} ${i.path}`)).toEqual([]);
  });
});

describe('the two other charts: a plan that names the mark gets that chart\'s template', () => {
  it.each(PLAN_CHART_MARKS.map((mark) => [mark] as const))('mark "%s": parses, has that mark, and is refused only for its placeholders', (mark) => {
    const t = chart(mark);
    const parsed = ClipScene.safeParse(t);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(t.stage).toMatchObject({ kind: 'chart', mark });
    const codes = new Set(checkAlone(t).errors.map((e) => e.code));
    // The line chart is the one "sourced" stage of the three: its made-up values are not in the passage, and say so.
    for (const code of codes) expect(['PLACEHOLDER_TEXT', 'CLAIM_UNRELATED', 'QUOTE_NOT_FOUND', 'MORE_ISSUES', ...(mark === 'line' ? ['NUMBER_NOT_IN_SOURCE'] : [])], `${mark}: ${code}`).toContain(code);
    expect(JSON.stringify(t).length).toBeLessThan(2000);
  });

  it('bars is the chart a plan gets when it names no mark, and a mark on another stage changes nothing', () => {
    expect(template('chart')).toEqual(chart('bars'));
    expect(templateFor({ id: 't1', kind: 'clip', stage: 'flow', mark: 'curve' })).toEqual(template('flow'));
  });

  it('the curve template draws its curves, marks a point on one, and is never "sourced"', () => {
    const t = chart('curve');
    expect(t.stage.provenance).toBe('worked');
    expect(t.stage.curves.map((c: Loose) => c.expr)).toEqual(['slope * x', '20 - x']);
    expect(t.stage.points[0]).toMatchObject({ on: 'f', x: '20 / (slope + 1)' });
    const verbs = t.beats.flatMap((beat: Loose) => beat.do.map((a: Loose) => a.verb));
    expect(verbs).toContain('draw');
    expect(verbs).toContain('show');
  });
});

describe('the templates that hand the picture over', () => {
  const explored: [string, () => Loose][] = [['dots', () => template('dots')], ['chart with bars', () => chart('bars')], ['chart with curves', () => chart('curve')]];

  it.each(explored)('%s: ends in an explore with a control, a binding and a goal', (_name, make) => {
    const t = make();
    expect(Object.keys(t.explore)).toEqual(['prompt', 'controls', 'bind', 'goal']);
    expect(t.explore.controls).toHaveLength(1);
    expect(t.explore.bind.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(t.explore.goal)).toEqual(['text', 'when', 'done']);
    // The stage of a clip the learner can drag is the writer's own.
    expect(t.stage.provenance).toBe('worked');
  });

  it.each(explored)('%s: once its words are written, the explore passes as it stands: nothing about formulas, controls, bindings or the goal', (_name, make) => {
    const codes = checkAlone(make()).errors.map((e) => e.code);
    for (const code of codes) expect(['PLACEHOLDER_TEXT', 'CLAIM_UNRELATED', 'QUOTE_NOT_FOUND', 'MORE_ISSUES'], code).toContain(code);
  });

  it.each(explored)('%s: the picture does not jump when it is handed over: every bound part starts at the number the clip ends on', (_name, make) => {
    const t = ClipScene.parse(make());
    const start = Object.fromEntries(t.explore!.controls.map((c) => [c.id, c.value]));
    // What the clip leaves each bound part showing: the last `set`, the last `split`, or the stage's own value.
    const shown = new Map<string, number>();
    const stage = t.stage as Loose;
    for (const part of [...(stage.bars ?? []), ...(stage.stats ?? [])]) if (typeof part.value === 'number') shown.set(part.id, part.value);
    for (const beat of t.beats) {
      for (const action of beat.do as Loose[]) {
        if (action.verb === 'set' && typeof action.value === 'number') for (const id of action.targets ?? [action.target]) shown.set(id, action.value);
        if (action.verb === 'split') for (const group of action.into) shown.set(group.id, group.count);
      }
    }
    for (const binding of t.explore!.bind) {
      const parsed = parseExpr(binding.expr);
      if (!parsed.ok) throw new Error(parsed.message);
      expect(evalExpr(parsed.expr, start), binding.target).toBe(shown.get(binding.target));
    }
    // And the goal is not met there, nor at either end of the slider: its tipping point is inside the range.
    const goal = parseExpr(t.explore!.goal!.when);
    if (!goal.ok) throw new Error(goal.message);
    expect(evalExpr(goal.expr, start)).toBe(0);
    const control = t.explore!.controls[0]!;
    expect([evalExpr(goal.expr, { [control.id]: control.min }), evalExpr(goal.expr, { [control.id]: control.max })]).toEqual([0, 0]);
    const reached = Array.from({ length: Math.round((control.max - control.min) / control.step) + 1 }, (_, i) => control.min + i * control.step).filter((v) => evalExpr(goal.expr, { [control.id]: v }) !== 0);
    expect(reached.length).toBeGreaterThanOrEqual(1);
  });

  it.each(explored)('%s: as it comes, it draws no warning about its goal', (_name, make) => {
    expect(checkAlone(make()).warnings.filter((w) => w.code === 'GOAL_AT_END')).toEqual([]);
  });

  it('the cells template asks its question on the picture: a tap on a cell that is on stage, with others to choose from', () => {
    const t = template('cells');
    const gate = t.beats[1].gate;
    expect(Object.keys(gate)).toEqual(['prompt', 'right', 'wrong', 'pick']);
    expect(gate.pick).toEqual(['c1']);
    expect(t.stage.cells.map((c: Loose) => c.id)).toContain('c1');
    const codes = checkAlone(t).errors.map((e) => e.code);
    for (const code of codes) expect(code.startsWith('PICK_')).toBe(false);
  });
});

describe('the notes sent with the templates', () => {
  it('TEMPLATE_NOTES is the list for a lesson of clips; the notes of the older kinds are kept apart', () => {
    expect(TEMPLATE_NOTES).toBe(CLIP_TEMPLATE_NOTES);
    expect(CLIP_TEMPLATE_NOTES[0]).toBe(LEGACY_TEMPLATE_NOTES[0]);
    expect(CLIP_TEMPLATE_NOTES.length).toBeGreaterThanOrEqual(11);
    const clips = CLIP_TEMPLATE_NOTES.join('\n');
    // Nothing about the older kinds, and nothing that is false of a clip.
    // ("step" is a field of a slider now; as a chart mark it belongs to the older figures.)
    expect(clips).not.toMatch(/narration|step-through|step_through|\bfigure\b|flow layout|highlight|"bar"|"line" or "step"|chart data/i);
    const legacy = LEGACY_TEMPLATE_NOTES.join('\n');
    expect(legacy).toMatch(/narration scene/);
    expect(legacy).toMatch(/chart mark is "bar", "line" or "step"/);
    expect(legacy).not.toMatch(/\bclip\b|\bbeat\b|\bgate\b/);
  });

  it('say what a caption is, the verbs, `with` and `on`, and that a gate stops the clip before its beat plays', () => {
    const notes = CLIP_TEMPLATE_NOTES.join('\n');
    expect(notes).toMatch(/The caption is ONE block \(claim, quote, example, analogy or framing\), not a list/);
    expect(notes).toMatch(new RegExp(`at most ${L.captionWords.max} words, ${L.captionWords.warn} or fewer is the target \\(an analogy is counted with its \`limits\`\\)`));
    expect(notes).toMatch(/At least one caption of every clip must be a claim or a quote, the opening `words` clip included/);
    expect(notes).toMatch(/The verbs are show, hide, draw, send, focus, set, move, swap, split, merge, reorder, pulse/);
    expect(notes).toMatch(/`with: true` starts an action together with the one before it/);
    expect(notes).toMatch(/`on` is a word or short phrase copied from this beat's caption/);
    expect(notes).toMatch(/`gate` on a beat is a prediction .* The clip stops before that beat plays until the learner answers or skips/);
    expect(notes).toMatch(/never on the first beat/);
    expect(notes).toMatch(new RegExp(`no more than ${L.passiveRun} scenes in a row go without a gate or a checkpoint`));
    expect(notes).toMatch(/At least two thirds of a clip's beats need an action/);
    expect(notes).toMatch(/"worked": your own worked case; its numbers are yours, and `cites` must still name the passage whose rule it applies/);
    expect(notes).toMatch(/chart `mark` is "bars" \(the template\), "line" \(.*\) or "curve" \(a function plot: .*never "sourced"\)\. Plan the clip with "mark": "line" or "curve" to get that template\./);
    expect(notes).toMatch(/a checkpoint `level` is "recall" or "apply"/);
    expect(notes).toMatch(new RegExp(`A lesson may have at most ${L.framesPerLesson} frames`));
    expect(notes).toMatch(/You never write a time, a position, a size or a colour/);
  });

  it('say, in a sentence each, what an explore is, what a formula is, and what a gate answered by a tap is', () => {
    const note = (start: string): string => CLIP_TEMPLATE_NOTES.find((n) => n.startsWith(start)) ?? '';
    const explore = note('`explore` on a clip');
    expect(explore).toMatch(/comes last, after the beats have named the parts, and hands the picture to the learner/);
    expect(explore).toMatch(/1 or 2 `controls` \(sliders \{ "id", "label", "min", "max", "step", "value" \}/);
    expect(explore).toContain(`at most ${L.explore.steps} steps`);
    expect(explore).toMatch(/`bind` \(\[\{ "target", "expr" \}\]: a formula drives a read-out on any stage, a bar, a split-off group of dots, or a value beside a line\)/);
    expect(explore).toMatch(/`goal` \{ "text", "when", "done" \}, where `when` is a condition that is false at the start and true somewhere inside the range \(not at an end: a goal reached by dragging to the end is warned about\), and `text` names an outcome, never the setting/);
    expect(explore).toMatch(/The text of an explore or of a tap gate may name a number the picture holds \(on the stage, an end or the start of a slider, a constant of a formula\) or a stored passage holds, and no other\./);
    expect(explore).toMatch(/A stage with an explore is "worked" or "illustrative", never "sourced"\./);
    expect(explore).toMatch(/Every control must be used\./);
    // Formulas: the language's own help line, word for word, and what a formula may name.
    const formula = note('A formula (`expr`');
    expect(formula).toContain(EXPR_HELP);
    // The three slips an agent makes from habit.
    expect(formula).toMatch(/A power is \^ and not \*\*, every multiplication is written with \*, and there is no %\./);
    expect(formula).toMatch(/It names control ids only \(a curve's `expr` also x\), never a part of the stage/);
    expect(formula).toMatch(/tried over the whole range of the sliders before the clip is accepted/);
    // Tap gates.
    const tap = note('A gate may be answered on the picture');
    expect(tap).toMatch(/\{ "prompt", "pick": \[ids of the parts that are right\], "right", "wrong" \}/);
    expect(tap).toMatch(/use it only when the answer IS a part of the picture, on stage before that beat plays with nothing marking it and at least one other to choose from/);
    expect(tap).toMatch(/`right` says why; `wrong` says what to look at again, without naming the part\./);
    // And the philosophy, in one line, where the gate is explained.
    expect(CLIP_TEMPLATE_NOTES.join('\n')).toMatch(/The learner acts before being told: at least two of every three clips need a gate or an `explore`\./);
  });

  it('list the verbs of every stage kind from the tables the validator checks by', () => {
    expect(CLIP_TEMPLATE_NOTES.some((note) => note.includes(STAGE_VERB_NOTES))).toBe(true);
    for (const kind of ['sequence', 'cells', 'dots', 'chart with bars', 'chart with a line', 'chart with curves', 'flow', 'words']) expect(STAGE_VERB_NOTES).toContain(`${kind}: `);
    expect(STAGE_VERB_NOTES).toContain(EXTRA_KIT_VERB_SUMMARY.lines);
    expect(STAGE_VERB_NOTES).toContain(EXTRA_KIT_VERB_SUMMARY.timeline);
    expect(STAGE_VERB_NOTES).toContain('sequence: show/hide/set/pulse (actor); send (message); focus (actor, message).');
    expect(STAGE_VERB_NOTES).toContain('chart with a line: draw/focus (series).');
    expect(STAGE_VERB_NOTES).toContain('chart with curves: show/hide/focus/set/pulse (curve, point); draw (curve).');
    expect(STAGE_VERB_NOTES).toContain('dots: split/merge/focus/set (group).');
    // Every verb core/clip gives a stage is named for it.
    for (const [key, verbs] of Object.entries(VERBS_BY_STAGE)) {
      if (key === 'frame' || key === 'lines' || key === 'timeline') continue;
      const name = key === 'chart.bars' ? 'chart with bars' : key === 'chart.line' ? 'chart with a line' : key === 'chart.curve' ? 'chart with curves' : key;
      const line = STAGE_VERB_NOTES.slice(STAGE_VERB_NOTES.indexOf(`${name}: `)).split('. ')[0] as string;
      for (const verb of verbs) if (!(key === 'chart.line' && (verb === 'set' || verb === 'pulse'))) expect(line, `${key}: ${verb}`).toMatch(new RegExp(`\\b${verb}\\b`));
    }
  });

  it('templateNotesFor gives a plan the notes of the kinds it holds', () => {
    expect(templateNotesFor(['clip', 'checkpoint', 'recap'])).toEqual(CLIP_TEMPLATE_NOTES);
    const mixed = templateNotesFor(['clip', 'narration', 'checkpoint', 'recap']);
    expect(mixed).toEqual([...CLIP_TEMPLATE_NOTES, ...LEGACY_TEMPLATE_NOTES.slice(1)]);
    expect(templateNotesFor(['clip'])).not.toBe(CLIP_TEMPLATE_NOTES);
  });

  it('are small enough to send with every plan', () => {
    // Three notes longer than it was: an explore, a formula and a gate answered by a tap, a sentence or two each.
    expect(JSON.stringify(CLIP_TEMPLATE_NOTES).length).toBeLessThan(8600);
    // A template that ends in an explore is a few hundred characters longer than one that does not.
    for (const [kind, make] of ALL) expect(JSON.stringify(make()).length, kind).toBeLessThan(EXPLORED.some((k) => kind.startsWith(k)) ? 2000 : 1800);
  });
});
