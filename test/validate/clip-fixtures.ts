// One fixture for each code the clip rules add, and for each code of the frame checks: a mutation
// of an honest clip (./clip-kit.ts), of the example plan or of a generated clip lesson that
// triggers that code and nothing else. codes.test.ts runs them with the fixtures of the older
// codes, so a clip code without proof that it can fire alone fails there.
import type { IssueCode } from '../../src/core/issues';
import { checkLesson } from '../../src/core/validate';
import { buildClipLesson } from './build-clips';
import { HONEST_FRAME_CODE, changedHonest, changedInteractive, changedPlan, type Loose, type Outcome } from './clip-kit';
import { assemble } from './helpers';

/** The honest frame clip with its code changed. */
const frame = (change: (code: string) => string, more?: (s: Loose) => void): Outcome =>
  changedHonest('frame', (s) => {
    s.stage.code = change(HONEST_FRAME_CODE);
    more?.(s);
  });

const SLIDER = { id: 'rate', label: 'How fast it shrinks', min: 0, max: 10, step: 1, value: 5 };
/** The honest frame reading a slider, so that a slider can be declared without being unused. */
const readsRate = (code: string): string => code.replace('  S.clear();', '  S.clear();\n  const rate = S.params.rate;');

export const CLIP_FIXTURES = {
  // ----- plan
  PLAN_CLIP_STAGE: () => changedPlan((p) => delete p.outline[1].stage),
  PLAN_TOO_MANY_FRAMES: () =>
    changedPlan((p) => {
      for (const id of ['c2', 'c4', 'c5']) p.outline.find((e: Loose) => e.id === id).stage = 'frame';
    }),

  // ----- the stage on its own
  STAGE_DUPLICATE_ID: () => changedHonest('cells', (s) => s.stage.brackets.push({ id: 'mid', label: 'again' })),
  STAGE_UNKNOWN_REF: () => changedHonest('sequence', (s) => (s.stage.stats[0].at = 'list')),
  STAGE_INCONSISTENT: () => changedHonest('line', (s) => s.stage.series[1].values.push(11)),
  STAGE_NO_CITES: () => changedHonest('dots', (s) => (s.stage.cites = [])),

  // ----- actions
  ACTION_UNKNOWN_PART: () => changedHonest('cells', (s) => (s.beats[1].do[0].target = 'middle')),
  ACTION_VERB_NOT_ALLOWED: () => changedHonest('flow', (s) => (s.beats[0].do[1] = { verb: 'pulse', target: 'in' })),
  ACTION_TARGET: () => changedHonest('words', (s) => delete s.beats[1].do[0].target),
  ACTION_PARAMETER: () => changedHonest('words', (s) => (s.beats[1].do[2].label = 'Another question')),
  ACTION_CUE_NOT_IN_CAPTION: () => changedHonest('sequence', (s) => (s.beats[2].do[2].on = 'throws away')),
  SPLIT_COUNT_MISMATCH: () => changedHonest('dots', (s) => (s.beats[1].do[0].into[0].count = 5)),
  REORDER_INCOMPLETE: () => changedHonest('chart', (s) => (s.beats[1].do[2].order = ['steps', 'steps'])),
  GROUP_NOT_ON_STAGE: () => changedHonest('dots', (s) => (s.beats[1].do[2] = { verb: 'focus', targets: ['keep'] })),
  MESSAGE_SENT_TWICE: () => changedHonest('sequence', (s) => (s.beats[1].do[0].target = 'ask')),

  // ----- beats
  CLIP_TOO_STATIC: () =>
    changedHonest('cells', (s) => {
      s.beats[0].do = [];
      s.beats[3].do = [];
    }),
  GATE_ON_FIRST_BEAT: () =>
    changedHonest('cells', (s) => {
      s.beats[0].gate = s.beats[2].gate;
      delete s.beats[2].gate;
    }),
  BEAT_FIELD_NOT_ALLOWED: () => changedHonest('words', (s) => (s.beats[0].at = 0)),

  // ----- the custom frame (the checks of src/frame/check.ts)
  FRAME_EMPTY: () => frame(() => '  \n  '),
  // Under the character limit of the schema and over the byte limit of the check: 12,600 two-byte letters, in comments.
  FRAME_TOO_LARGE: () => frame((code) => `${code}${Array.from({ length: 42 }, () => `// ${'é'.repeat(300)}`).join('\n')}\n`),
  FRAME_LONG_LINE: () => frame((code) => `// ${'a long remark '.repeat(30)}\n${code}`),
  FRAME_HIDDEN_CHARACTERS: () => frame((code) => code.replace('// A bar', '// A \u202Ebar')),
  FRAME_SYNTAX: () => frame((code) => code.replace('S.clear();', 'S.clear(;')),
  FRAME_NO_RENDER: () => frame((code) => code.replace('function render(ctx, t)', 'function draw(ctx, t)')),
  FRAME_BANNED: () => frame((code) => code.replace('  S.clear();', '  S.clear();\n  setTimeout(function () {}, 10);')),
  FRAME_RANDOM: () => frame((code) => code.replace('  S.clear();', '  S.clear();\n  const jitter = Math.random();')),
  FRAME_POSTER_RANGE: () => changedHonest('frame', (s) => (s.stage.poster = 9)),
  FRAME_PARAM_DUPLICATE: () => frame(readsRate, (s) => (s.stage.params = [SLIDER, { ...SLIDER, label: 'The same slider again' }])),
  FRAME_PARAM_RANGE: () => frame(readsRate, (s) => (s.stage.params = [{ ...SLIDER, value: 11 }])),
  FRAME_PARAM_UNDECLARED: () => frame(readsRate),
  FRAME_PARAM_UNUSED: () => changedHonest('frame', (s) => (s.stage.params = [SLIDER])),
  FRAME_SOURCED_NO_CITES: () => changedHonest('frame', (s) => Object.assign(s.stage, { provenance: 'sourced', cites: [] })),
  FRAME_BEAT_TIME: () => changedHonest('frame', (s) => (s.beats[2].at = 8)),

  // ----- interactive: formulas (the bars clip binds "linear" to 2^doublings and "binary" to doublings + 1)
  FORMULA_SYNTAX: () => changedInteractive('bars', (s) => (s.explore.bind[0].expr = '2 ** doublings')),
  FORMULA_UNKNOWN_NAME: () => changedInteractive('bars', (s) => (s.explore.bind[1].expr = 'steps + 1')),
  FORMULA_NOT_FINITE: () => changedInteractive('bars', (s) => (s.explore.bind[1].expr = '12 / (doublings - 3)')),

  // ----- interactive: controls
  CONTROL_RANGE: () => changedInteractive('bars', (s) => (s.explore.controls[0].value = 2)),
  CONTROL_DUPLICATE_ID: () => changedInteractive('bars', (s) => s.explore.controls.push({ ...s.explore.controls[0], label: 'Doublings again' })),
  CONTROL_UNUSED: () => changedInteractive('bars', (s) => s.explore.controls.push({ id: 'speed', label: 'Speed of each look', min: 0, max: 5, step: 1, value: 1 })),

  // ----- interactive: what an explore drives, and on what kind of stage
  EXPLORE_NOTHING_RESPONDS: () =>
    changedHonest('cells', (s) => {
      s.explore = {
        prompt: 'Drag and see what the row does.',
        controls: [{ id: 'looks', label: 'Comparisons', min: 0, max: 3, step: 1, value: 0 }],
        goal: { text: 'Make just enough comparisons to settle it.', when: 'looks == 2', done: 'Two comparisons were enough for five cells.' },
      };
    }),
  EXPLORE_ON_SOURCED_STAGE: () => changedInteractive('bars', (s) => (s.stage.provenance = 'sourced')),
  CURVE_SOURCED: () => changedInteractive('curve', (s) => (s.stage.provenance = 'sourced')),
  BINDING_UNKNOWN_TARGET: () => changedInteractive('bars', (s) => (s.explore.bind[1].target = 'ternary')),
  BINDING_NOT_BINDABLE: () => changedInteractive('dots', (s) => (s.explore.bind[0].target = 'all')),
  BINDING_DUPLICATE: () => changedInteractive('bars', (s) => s.explore.bind.push({ target: 'linear', expr: 'doublings * 2' })),
  BINDING_OUT_OF_RANGE: () => changedInteractive('dots', (s) => (s.explore.bind[0].expr = '200 / 2^looks')),
  POINT_OFF_AXIS: () => changedInteractive('curve', (s) => (s.stage.points[0].x = '2^(spend + 1)')),

  // ----- interactive: the goal (the dots clip asks for 64 / 2^looks == 4, with looks from 1 to 6)
  GOAL_NOT_CONDITION: () => changedInteractive('dots', (s) => (s.explore.goal.when = '64 / 2^looks')),
  GOAL_ALREADY_MET: () => changedInteractive('dots', (s) => (s.explore.goal.when = '64 / 2^looks <= 32')),
  GOAL_UNREACHABLE: () => changedInteractive('dots', (s) => (s.explore.goal.when = '64 / 2^looks < 1')),
  // Reached by dragging the slider to its largest: a sweep, not a thought.
  GOAL_AT_END: () => changedInteractive('dots', (s) => (s.explore.goal.when = '64 / 2^looks <= 1')),

  // ----- interactive: a gate answered by a tap
  PICK_UNKNOWN_PART: () => changedInteractive('tap', (s) => (s.beats[1].gate.pick = ['c9'])),
  PICK_NOT_TAPPABLE: () => changedInteractive('tap', (s) => (s.beats[1].gate.pick = ['mid'])),
  // The cell is brought on by the very beat the gate stands on, which plays after the answer.
  PICK_NOT_ON_STAGE: () => changedInteractive('tap', (s) => s.beats[1].do.unshift({ verb: 'show', target: 'c2' })),
  PICK_NO_WRONG_PART: () =>
    changedInteractive('tap', (s) => {
      s.stage.cells = s.stage.cells.slice(0, 3);
      s.beats[0].do[0].to = ['c0', 'c2'];
      s.beats[1].gate.pick = ['c0', 'c1', 'c2'];
    }),

  // ----- the lesson as a whole
  INTERACTIVE_SHARE: () => {
    const draft = assemble(buildClipLesson({ depth: 'quick', size: 'min', gates: false }));
    return { ...checkLesson(draft), draft };
  },
  NO_EXPLORE: () => {
    const draft = assemble(buildClipLesson({ depth: 'standard', size: 'min', explore: false }));
    return { ...checkLesson(draft), draft };
  },
  MOSTLY_ILLUSTRATIVE: () => {
    const draft = assemble(buildClipLesson({ depth: 'quick', size: 'min', provenance: 'illustrative' }));
    return { ...checkLesson(draft), draft };
  },
} satisfies Partial<Record<IssueCode, () => Outcome>>;
