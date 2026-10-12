// Every string of a scene that a learner will read, with what each check needs to know about it:
// whether inline markup is interpreted there, whether it is code, and what its numbers must rest
// on. One enumeration, so a new field cannot be covered by one check and missed by another.
import type { AnyScene, ClipScene, Explore, PickGate, Stage, StageStat } from '../clip';
import { parseExpr, type Expr } from '../expr';
import type { Block, Figure, Predict, Question, Step } from '../schema';
import { numberTokens } from '../text';

/** What the numbers in a field must be grounded in. */
export type NumberRule =
  /**
   * A statement with citations: its numbers must be in one of those excerpts. `of` marks a part
   * of a figure (or of a sourced chart), whose citations are the figure's, set once for all its
   * parts; "stage" marks the same for a clip's stage marked `provenance: "sourced"`.
   */
  | { kind: 'cited'; cites: readonly string[]; of?: 'figure' | 'chart' | 'stage' }
  /**
   * Text with no citation of its own: its numbers must be in some excerpt the lesson holds.
   * `allow`: numbers that need no source there all the same, because they belong to the picture
   * the text is about (see `pictureNumbers`): what an explore or a tap gate may say.
   */
  | { kind: 'uncited'; allow?: readonly number[] }
  /** The agent's own working, or an interaction: not checked. */
  | { kind: 'exempt' };

const UNCITED: NumberRule = { kind: 'uncited' };
const EXEMPT: NumberRule = { kind: 'exempt' };

export interface TextField {
  /** Path inside the scene: "blocks[1].text". */
  path: string;
  text: string;
  /**
   * Inline markup (`**`, `*`, code and math spans) is interpreted in this field. This follows what
   * the renderer does: prose, questions and the labels of a figure are read as markup; titles, a
   * timeline's `when`, a chart's labels, state values and quoted words are shown as typed.
   */
  markup: boolean;
  /** The field is code or a worked example: addresses in it are judged by host. */
  code: boolean;
  numbers: NumberRule;
  /** What to call it in a message: "claim", "scene title", "node label". */
  what: string;
}

/** Where a scene points at evidence. */
export interface CiteRef {
  /** Path of the id list or the single id: "blocks[1].cites", "blocks[2].cite". */
  path: string;
  /** Path of the thing that cites: "blocks[1]", "figure", "question.explanation". */
  owner: string;
  ids: readonly string[];
  /** `basedOn` of an example: a pointer, not a citation. It must exist but supports nothing. */
  basedOn: boolean;
  what: string;
}

/**
 * Numbers a sourced stage shows that are not text: the value of a bar, a series, a read-out, a
 * count of dots, the value a `set` gives. Each must be worth what a cited passage states.
 */
export interface NumberField {
  /** Path inside the scene: "stage.bars[1].value", "beats[2].do[0].value". */
  path: string;
  values: readonly number[];
  cites: readonly string[];
  what: string;
}

interface Collector {
  fields: TextField[];
  cites: CiteRef[];
  values: NumberField[];
}

function add(c: Collector, path: string, text: string | undefined, what: string, numbers: NumberRule, markup = false, code = false): void {
  if (text === undefined) return;
  c.fields.push({ path, text, markup, code, numbers, what });
}

function blockFields(c: Collector, blocks: readonly Block[], prefix: string): void {
  blocks.forEach((block, i) => blockField(c, block, `${prefix}blocks[${i}]`));
}

/** One block at `p`: a block of a narration scene or a step ("blocks[1]"), or the caption of a beat ("beats[2].caption"). */
function blockField(c: Collector, block: Block, p: string): void {
  switch (block.type) {
    case 'claim':
      add(c, `${p}.text`, block.text, 'claim', { kind: 'cited', cites: block.cites }, true);
      c.cites.push({ path: `${p}.cites`, owner: p, ids: block.cites, basedOn: false, what: 'claim' });
      break;
    case 'quote':
      // The words are the source's own, checked by matching them against the excerpt, and are
      // shown as written: no markup, and no number check of their own.
      add(c, `${p}.text`, block.text, 'quote', EXEMPT);
      c.cites.push({ path: `${p}.cite`, owner: p, ids: [block.cite], basedOn: false, what: 'quote' });
      break;
    case 'analogy':
      add(c, `${p}.text`, block.text, 'analogy', UNCITED, true);
      add(c, `${p}.limits`, block.limits, 'analogy limits', UNCITED, true);
      break;
    case 'example':
      add(c, `${p}.text`, block.text, 'example', EXEMPT, true, true);
      if (block.basedOn && block.basedOn.length > 0) c.cites.push({ path: `${p}.basedOn`, owner: p, ids: block.basedOn, basedOn: true, what: 'example' });
      break;
    case 'framing':
      add(c, `${p}.text`, block.text, 'framing block', UNCITED, true);
      break;
  }
}

function figureFields(c: Collector, figure: Figure): void {
  const p = 'figure';
  // A lines figure and an illustrative chart are the agent's own material, labelled as such: none
  // of their text is checked for numbers, the description and caption included, so the text
  // alternative of an illustrative chart can say "doubles to 16, then is cut to 8".
  // Every other figure is read as fact. A number anywhere in it (a label, a cell, a date, the
  // caption, the description) must be in a passage the figure itself cites, so that the learner
  // can open the source of what the figure shows.
  const rule: NumberRule = figure.type === 'lines' || (figure.type === 'chart' && figure.data === 'illustrative') ? EXEMPT : { kind: 'cited', cites: figure.cites, of: figure.type === 'chart' ? 'chart' : 'figure' };
  if (figure.cites && figure.cites.length > 0) c.cites.push({ path: `${p}.cites`, owner: p, ids: figure.cites, basedOn: false, what: `${figure.type} figure` });
  add(c, `${p}.description`, figure.description, 'figure description', rule, true);
  add(c, `${p}.caption`, figure.caption, 'figure caption', rule, true);
  switch (figure.type) {
    case 'flow':
      figure.nodes.forEach((node, i) => {
        add(c, `${p}.nodes[${i}].label`, node.label, 'node label', rule, true);
        add(c, `${p}.nodes[${i}].detail`, node.detail, 'node detail', rule, true);
      });
      figure.edges.forEach((edge, i) => add(c, `${p}.edges[${i}].label`, edge.label, 'edge label', rule, true));
      break;
    case 'sequence':
      figure.actors.forEach((actor, i) => add(c, `${p}.actors[${i}].label`, actor.label, 'actor label', rule, true));
      figure.messages.forEach((message, i) => add(c, `${p}.messages[${i}].label`, message.label, 'message label', rule, true));
      break;
    case 'layers':
      figure.layers.forEach((layer, i) => {
        add(c, `${p}.layers[${i}].label`, layer.label, 'layer label', rule, true);
        add(c, `${p}.layers[${i}].detail`, layer.detail, 'layer detail', rule, true);
      });
      break;
    case 'timeline':
      figure.events.forEach((event, i) => {
        add(c, `${p}.events[${i}].when`, event.when, 'event time', rule);
        add(c, `${p}.events[${i}].label`, event.label, 'event label', rule, true);
        add(c, `${p}.events[${i}].detail`, event.detail, 'event detail', rule, true);
      });
      break;
    case 'compare':
      add(c, `${p}.rowHeading`, figure.rowHeading, 'row heading', rule);
      figure.columns.forEach((column, i) => add(c, `${p}.columns[${i}].label`, column.label, 'column label', rule, true));
      figure.rows.forEach((row, i) => {
        add(c, `${p}.rows[${i}].label`, row.label, 'row label', rule, true);
        row.cells.forEach((cell, j) => add(c, `${p}.rows[${i}].cells[${j}]`, cell, 'table cell', rule, true));
      });
      break;
    case 'chart':
      add(c, `${p}.xLabel`, figure.xLabel, 'axis label', rule);
      add(c, `${p}.yLabel`, figure.yLabel, 'axis label', rule);
      add(c, `${p}.unit`, figure.unit, 'unit', rule);
      figure.xs.forEach((x, i) => add(c, `${p}.xs[${i}].label`, x.label, 'x label', rule));
      figure.series.forEach((series, i) => add(c, `${p}.series[${i}].label`, series.label, 'series label', rule));
      break;
    case 'lines':
      add(c, `${p}.language`, figure.language, 'language name', EXEMPT);
      figure.lines.forEach((line, i) => add(c, `${p}.lines[${i}]`, line, 'line', EXEMPT, false, true));
      break;
  }
}

function predictFields(c: Collector, predict: Predict, p: string): void {
  add(c, `${p}.prompt`, predict.prompt, 'predict prompt', EXEMPT, true);
  predict.options.forEach((option, i) => {
    add(c, `${p}.options[${i}].text`, option.text, 'option', EXEMPT, true);
    add(c, `${p}.options[${i}].feedback`, option.feedback, 'feedback', EXEMPT, true);
  });
}

/**
 * The numbers that belong to a clip's own picture, which the text of its explore and of its tap
 * gates may therefore name without a source:
 *
 *   - the ends and the starting value of every slider;
 *   - every number the stage shows: in a label, a value, a count, an axis, and in what an action
 *     puts on stage (a `set`, the groups of a `split`). On a "sourced" stage these are in the
 *     passages the stage cites; on a "worked" or "illustrative" one they are the agent's own,
 *     and the page says so on the stage;
 *   - the constants of the clip's own formulas: the 5 of a goal `price > 5`.
 *
 * Any other number in that text is a fact from outside the picture, and needs a stored passage
 * like any number in uncited prose.
 */
function pictureNumbers(scene: ClipScene): number[] {
  const out = new Set<number>();
  const text = (value: string): void => {
    for (const token of numberTokens(value)) if (Number.isFinite(Number(token))) out.add(Number(token));
  };
  const constants = (source: string): void => {
    const parsed = parseExpr(source);
    if (!parsed.ok) return text(source);
    const walk = (e: Expr): void => {
      if (e.t === 'num') out.add(e.v);
      else if (e.t === 'un') walk(e.a);
      else if (e.t === 'bin') {
        walk(e.a);
        walk(e.b);
      } else if (e.t === 'call') e.args.forEach(walk);
    };
    walk(parsed.expr);
  };
  /** Everything a stage or an action holds, apart from ids, citations, code and formulas. */
  const SKIP = new Set(['id', 'kind', 'mark', 'cites', 'provenance', 'code', 'verb', 'target', 'targets', 'on', 'from', 'to', 'along', 'a', 'b', 'order', 'between', 'tone', 'at', 'lane', 'with']);
  const shown = (value: unknown, key = ''): void => {
    if (typeof value === 'number') out.add(Math.abs(value));
    else if (typeof value === 'string') text(value);
    else if (Array.isArray(value)) for (const item of value) shown(item, key);
    else if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (SKIP.has(k)) continue;
        // A curve's `expr` and a point's `x` are formulas: their constants count, their names do not.
        if (typeof v === 'string' && (k === 'expr' || (k === 'x' && key === 'points'))) constants(v);
        else shown(v, k);
      }
    }
  };
  shown(scene.stage);
  for (const beat of scene.beats) shown(beat.do);
  for (const control of scene.explore?.controls ?? []) for (const n of [control.min, control.max, control.value]) out.add(n);
  for (const binding of scene.explore?.bind ?? []) constants(binding.expr);
  if (scene.explore?.goal) constants(scene.explore.goal.when);
  return [...out];
}

/**
 * A gate answered on the picture. Its prompt and its two replies are the agent's own words about
 * the stage, with no citation: held to the rule for uncited text.
 */
function pickFields(c: Collector, gate: PickGate, p: string, rule: NumberRule): void {
  add(c, `${p}.prompt`, gate.prompt, 'tap-gate prompt', rule, true);
  add(c, `${p}.right`, gate.right, 'tap-gate reply ("right")', rule, true);
  add(c, `${p}.wrong`, gate.wrong, 'tap-gate reply ("wrong")', rule, true);
}

/**
 * The text of an explore: what the learner is told to try, the names on the sliders, the goal and
 * what is said when it is reached. All of it is the agent's own, uncited; a number in it must be
 * in a stored passage, unless it belongs to the picture (`pictureNumbers`).
 */
function exploreFields(c: Collector, explore: Explore, rule: NumberRule): void {
  const p = 'explore';
  add(c, `${p}.prompt`, explore.prompt, 'explore prompt', rule, true);
  explore.controls.forEach((control, i) => {
    add(c, `${p}.controls[${i}].label`, control.label, 'control label', rule);
    add(c, `${p}.controls[${i}].unit`, control.unit, 'unit', rule);
  });
  if (explore.goal) {
    add(c, `${p}.goal.text`, explore.goal.text, 'goal', rule, true);
    add(c, `${p}.goal.done`, explore.goal.done, 'goal reply ("done")', rule, true);
  }
}

function stepFields(c: Collector, step: Step, i: number): void {
  const p = `steps[${i}]`;
  add(c, `${p}.title`, step.title, 'step title', UNCITED);
  blockFields(c, step.blocks, `${p}.`);
  step.state?.forEach((row, k) => {
    add(c, `${p}.state[${k}].label`, row.label, 'state label', EXEMPT);
    add(c, `${p}.state[${k}].value`, row.value, 'state value', EXEMPT);
  });
  if (step.predict) predictFields(c, step.predict, `${p}.predict`);
}

function questionFields(c: Collector, question: Question): void {
  const p = 'question';
  add(c, `${p}.prompt`, question.prompt, 'prompt', EXEMPT, true);
  switch (question.type) {
    case 'single':
      question.options.forEach((option, i) => {
        add(c, `${p}.options[${i}].text`, option.text, 'option', EXEMPT, true);
        add(c, `${p}.options[${i}].feedback`, option.feedback, 'feedback', EXEMPT, true);
        add(c, `${p}.options[${i}].misconception`, option.misconception, 'misconception', EXEMPT);
      });
      break;
    case 'order':
      question.items.forEach((item, i) => add(c, `${p}.items[${i}]`, item, 'order item', EXEMPT, true));
      break;
    case 'numeric':
      add(c, `${p}.unit`, question.unit, 'unit', EXEMPT);
      break;
    case 'reflect':
      add(c, `${p}.modelAnswer.text`, question.modelAnswer.text, 'model answer', EXEMPT, true);
      c.cites.push({ path: `${p}.modelAnswer.cites`, owner: `${p}.modelAnswer`, ids: question.modelAnswer.cites, basedOn: false, what: 'model answer' });
      question.lookFor.forEach((item, i) => add(c, `${p}.lookFor[${i}]`, item, 'look-for point', EXEMPT, true));
      break;
  }
  if (question.type !== 'reflect') {
    add(c, `${p}.explanation.text`, question.explanation.text, 'explanation', EXEMPT, true);
    c.cites.push({ path: `${p}.explanation.cites`, owner: `${p}.explanation`, ids: question.explanation.cites, basedOn: false, what: 'explanation' });
    add(c, `${p}.hint`, question.hint, 'hint', EXEMPT, true);
  }
}

/** A number of a sourced stage. Nothing is recorded for a stage whose numbers are the agent's own. */
function num(c: Collector, path: string, values: number | readonly number[] | undefined, what: string, rule: NumberRule): void {
  if (values === undefined || rule.kind !== 'cited') return;
  c.values.push({ path, values: typeof values === 'number' ? [values] : values, cites: rule.cites, what });
}

/** A value that is a number (it counts) or a string (it morphs). */
function numOrText(c: Collector, path: string, value: number | string | undefined, what: string, rule: NumberRule): void {
  if (typeof value === 'number') num(c, path, value, what, rule);
  else add(c, path, value, what, rule);
}

function statFields(c: Collector, stats: readonly StageStat[] | undefined, rule: NumberRule): void {
  stats?.forEach((stat, i) => {
    const p = `stage.stats[${i}]`;
    add(c, `${p}.label`, stat.label, 'read-out label', rule);
    numOrText(c, `${p}.value`, stat.value, 'read-out value', rule);
    add(c, `${p}.unit`, stat.unit, 'unit', rule);
  });
}

/**
 * The stage of a clip. What is on a stage is shown as typed (no inline markup), and is read
 * according to the stage's own `provenance`: on a "sourced" stage every number is a fact and must
 * be in a passage the stage cites; a "worked" or "illustrative" stage is the agent's own material,
 * badged so on the page, and its numbers are not checked. The clip's `description` is the text
 * alternative of that stage and follows the same rule, so the alternative of a worked example can
 * say the numbers the example shows.
 */
function stageFields(c: Collector, stage: Stage, rule: NumberRule): void {
  const p = 'stage';
  if (stage.cites.length > 0) c.cites.push({ path: `${p}.cites`, owner: p, ids: stage.cites, basedOn: false, what: `${stage.kind} stage` });
  switch (stage.kind) {
    case 'sequence':
      stage.actors.forEach((actor, i) => add(c, `${p}.actors[${i}].label`, actor.label, 'actor label', rule));
      stage.messages.forEach((message, i) => add(c, `${p}.messages[${i}].label`, message.label, 'message label', rule));
      break;
    case 'cells':
      stage.cells.forEach((cell, i) => add(c, `${p}.cells[${i}].label`, cell.label, 'cell label', rule));
      stage.pointers?.forEach((pointer, i) => add(c, `${p}.pointers[${i}].label`, pointer.label, 'pointer label', rule));
      stage.brackets?.forEach((bracket, i) => add(c, `${p}.brackets[${i}].label`, bracket.label, 'bracket label', rule));
      break;
    case 'dots':
      num(c, `${p}.total`, stage.total, 'number of dots', rule);
      add(c, `${p}.legend`, stage.legend, 'legend', rule);
      add(c, `${p}.group.label`, stage.group.label, 'group label', rule);
      break;
    case 'chart':
      add(c, `${p}.unit`, stage.unit, 'unit', rule);
      add(c, `${p}.yLabel`, stage.yLabel, 'axis label', rule);
      if (stage.mark === 'bars') {
        stage.bars.forEach((bar, i) => {
          add(c, `${p}.bars[${i}].label`, bar.label, 'bar label', rule);
          num(c, `${p}.bars[${i}].value`, bar.value, `bar "${bar.id}"`, rule);
        });
      } else if (stage.mark === 'line') {
        stage.xs.forEach((x, i) => add(c, `${p}.xs[${i}]`, x, 'x label', rule));
        stage.series.forEach((series, i) => {
          add(c, `${p}.series[${i}].label`, series.label, 'series label', rule);
          num(c, `${p}.series[${i}].values`, series.values, `series "${series.id}"`, rule);
        });
      } else {
        // A curve chart is never "sourced" (./explore), so `rule` is exempt here: the labels are
        // listed for the safety checks, and the formulas are not text a learner reads.
        add(c, `${p}.x.label`, stage.x.label, 'axis label', rule);
        add(c, `${p}.x.unit`, stage.x.unit, 'unit', rule);
        stage.curves.forEach((curve, i) => add(c, `${p}.curves[${i}].label`, curve.label, 'curve label', rule));
        stage.points?.forEach((point, i) => add(c, `${p}.points[${i}].label`, point.label, 'point label', rule));
      }
      break;
    case 'flow':
      stage.nodes.forEach((node, i) => add(c, `${p}.nodes[${i}].label`, node.label, 'node label', rule));
      stage.edges.forEach((edge, i) => add(c, `${p}.edges[${i}].label`, edge.label, 'edge label', rule));
      break;
    case 'words':
      stage.lines.forEach((line, i) => add(c, `${p}.lines[${i}].text`, line.text, 'line of the words stage', rule));
      break;
    case 'lines':
      add(c, `${p}.language`, stage.language, 'language name', EXEMPT);
      // As in a lines figure, a line is code: an address in it is judged by its host.
      stage.lines.forEach((line, i) => add(c, `${p}.lines[${i}]`, line, 'line', rule, false, true));
      stage.pointers?.forEach((pointer, i) => add(c, `${p}.pointers[${i}].label`, pointer.label, 'pointer label', rule));
      stage.brackets?.forEach((bracket, i) => add(c, `${p}.brackets[${i}].label`, bracket.label, 'bracket label', rule));
      stage.annotations?.forEach((note, i) => add(c, `${p}.annotations[${i}].text`, note.text, 'annotation', rule));
      stage.values?.forEach((value, i) => {
        add(c, `${p}.values[${i}].label`, value.label, 'value label', rule);
        numOrText(c, `${p}.values[${i}].value`, value.value, 'value beside a line', rule);
        add(c, `${p}.values[${i}].unit`, value.unit, 'unit', rule);
      });
      break;
    case 'timeline':
      stage.lanes?.forEach((lane, i) => add(c, `${p}.lanes[${i}].label`, lane.label, 'lane label', rule));
      stage.events.forEach((event, i) => {
        add(c, `${p}.events[${i}].when`, event.when, 'event time', rule);
        add(c, `${p}.events[${i}].label`, event.label, 'event label', rule);
        add(c, `${p}.events[${i}].detail`, event.detail, 'event detail', rule);
      });
      stage.spans?.forEach((span, i) => add(c, `${p}.spans[${i}].label`, span.label, 'span label', rule));
      stage.markers?.forEach((marker, i) => add(c, `${p}.markers[${i}].label`, marker.label, 'marker label', rule));
      break;
    case 'frame':
      // What the code draws cannot be read; the sliders under the stage can. The code itself is
      // checked as a program (see ./stage), never as prose.
      stage.params.forEach((param, i) => {
        add(c, `${p}.params[${i}].label`, param.label, 'slider label', rule);
        add(c, `${p}.params[${i}].unit`, param.unit, 'unit', rule);
      });
      break;
  }
  if (stage.kind !== 'words' && stage.kind !== 'frame') statFields(c, stage.stats, rule);
}

/**
 * A clip: its description, its stage, and for each beat the caption (one block, read exactly as a
 * block of a narration scene is), the prediction, and what the actions put on stage. Text and
 * numbers that an action introduces (a new label, the value a `set` counts to, the groups of a
 * `split`) follow the stage's provenance, like the stage itself.
 */
function clipFields(c: Collector, scene: ClipScene): void {
  const stage = scene.stage;
  // A curve chart is drawn from formulas and is never "sourced": that is reported once (CURVE_SOURCED), not number by number.
  const curve = stage.kind === 'chart' && stage.mark === 'curve';
  const rule: NumberRule = stage.provenance === 'sourced' && stage.cites.length > 0 && !curve ? { kind: 'cited', cites: stage.cites, of: 'stage' } : EXEMPT;
  // What the picture itself holds needs no source in the text that asks about it. Worked out only when some text needs it.
  const interactive = scene.explore !== undefined || scene.beats.some((beat) => beat.gate !== undefined && 'pick' in beat.gate);
  const own: NumberRule = { kind: 'uncited', allow: interactive ? pictureNumbers(scene) : [] };
  add(c, 'description', scene.description, 'clip description', rule);
  stageFields(c, stage, rule);
  scene.beats.forEach((beat, i) => {
    const p = `beats[${i}]`;
    if (beat.gate) {
      if ('pick' in beat.gate) pickFields(c, beat.gate, `${p}.gate`, own);
      else predictFields(c, beat.gate, `${p}.gate`);
    }
    blockField(c, beat.caption, `${p}.caption`);
    add(c, `${p}.say`, beat.say, 'spoken script', EXEMPT);
    beat.do.forEach((action, k) => {
      const a = `${p}.do[${k}]`;
      switch (action.verb) {
        case 'send':
          add(c, `${a}.label`, action.label, 'token label', rule);
          break;
        case 'set':
          numOrText(c, `${a}.value`, action.value, 'value given by this action', rule);
          add(c, `${a}.label`, action.label, 'label given by this action', rule);
          break;
        case 'split':
          action.into.forEach((group, j) => {
            add(c, `${a}.into[${j}].label`, group.label, 'group label', rule);
            num(c, `${a}.into[${j}].count`, group.count, `group "${group.id}"`, rule);
          });
          break;
        case 'merge':
          add(c, `${a}.into.label`, action.into.label, 'group label', rule);
          break;
        default:
          break;
      }
    });
  });
  if (scene.explore) exploreFields(c, scene.explore, own);
}

/** All text fields and evidence references of a scene, in document order, and the numbers of a sourced stage. */
export function sceneFields(scene: AnyScene): { fields: TextField[]; cites: CiteRef[]; values: NumberField[] } {
  const c: Collector = { fields: [], cites: [], values: [] };
  // A checkpoint is an interaction from its title down; everywhere else a title is uncited prose.
  add(c, 'title', scene.title, 'scene title', scene.kind === 'checkpoint' ? EXEMPT : UNCITED);
  switch (scene.kind) {
    case 'narration':
      blockFields(c, scene.blocks, '');
      if (scene.figure) figureFields(c, scene.figure);
      break;
    case 'step_through':
      add(c, 'intro', scene.intro, 'intro', UNCITED, true);
      figureFields(c, scene.figure);
      scene.steps.forEach((step, i) => stepFields(c, step, i));
      break;
    case 'checkpoint':
      questionFields(c, scene.question);
      break;
    case 'recap':
      scene.takeaways.forEach((takeaway, i) => {
        add(c, `takeaways[${i}].text`, takeaway.text, 'takeaway', { kind: 'cited', cites: takeaway.cites }, true);
        c.cites.push({ path: `takeaways[${i}].cites`, owner: `takeaways[${i}]`, ids: takeaway.cites, basedOn: false, what: 'takeaway' });
      });
      if (scene.practice) {
        add(c, 'practice.task', scene.practice.task, 'practice task', EXEMPT, true);
        scene.practice.lookFor.forEach((item, i) => add(c, `practice.lookFor[${i}]`, item, 'practice look-for point', EXEMPT, true));
      }
      scene.next.forEach((next, i) => {
        add(c, `next[${i}].topic`, next.topic, 'next topic', EXEMPT);
        add(c, `next[${i}].why`, next.why, 'next-topic reason', EXEMPT, true);
      });
      break;
    case 'clip':
      clipFields(c, scene);
      break;
  }
  return c;
}
