// The skill's examples and numbers must be the format's examples and numbers. Every JSON block the
// skill marks as an example is parsed with the zod schema, and so is every action written inline.
// An example that names its source (`<!-- example: scene c3 -->`) must equal that object in the
// example files; the limits table must be what the limits files render to; the table of which
// stage takes which verb, the table of what can be tapped and bound, and the list of what a
// formula may use must be what the code's own tables render to.
//
// After a change to an example file, a limits file, a verb table or the formula language,
// regenerate the derived parts of the references with
//   UPDATE_SKILL_DOCS=1 npx vitest run test/skill/format.test.ts
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Action, BINDABLE, Beat, CLIP_LIMITS as C, ClipScene, Explore, Gate, PROVENANCES, STAGE_KINDS, Stage, TONES, VERBS, VERBS_BY_STAGE, VarId } from '../../src/core/clip';
import * as clipExamples from '../../src/core/clip-examples';
import { EXAMPLE_CLIPS, EXAMPLE_V2_SCENES } from '../../src/core/clip-examples';
import { EXPR_CONSTANTS, EXPR_FUNCTIONS, EXPR_HELP, EXPR_LIMITS, EXPR_RESERVED, evalExpr, parseExpr } from '../../src/core/expr';
import { KITS_EXTRA_LIMITS as K } from '../../src/core/clip-kits-extra';
import { EXTRA_EXAMPLE_CLIPS } from '../../src/core/clip-kits-extra-examples';
import { EXAMPLE_EVIDENCE, EXAMPLE_PLAN, EXAMPLE_QUESTIONS, EXAMPLE_SCENES, EXAMPLE_START } from '../../src/core/examples';
import { FRAME_LIMITS as F } from '../../src/core/frame';
import { DEPTHS, LIMITS as L } from '../../src/core/limits';
import { Block, BLOCK_TYPES, CheckpointScene, EvidenceInput, PLAN_CHART_MARKS, PlanInput, Question, QUESTION_TYPES, RecapScene, StartInput } from '../../src/core/schema';
import { TAPPABLE } from '../../src/core/validate/stage';
import {
  CLIP_DESIGN_MD,
  FORMAT_MD,
  FORMULA_HELP_END,
  FORMULA_HELP_START,
  FORMULAS_END,
  FORMULAS_START,
  formatJson,
  inlineActions,
  INTERACTIVE_END,
  INTERACTIVE_START,
  interactiveLimits,
  limitsRegion,
  markedExamples,
  MATH_END,
  MATH_START,
  MOTION_MD,
  read,
  readoutVerbs,
  REF_DIR,
  region,
  rel,
  renderFormulaHelp,
  renderFormulas,
  renderInteractive,
  renderLimits,
  renderMath,
  renderVerbs,
  ROOT,
  SKILL_MD,
  skillFiles,
  STAGE_LABELS,
  VERBS_END,
  VERBS_START,
  type MarkedExample,
} from './helpers';

/** A host's MCP configuration entry for the server, as voice.md shows it. Not part of the lesson format. */
const McpConfig = z.strictObject({
  mcpServers: z.record(z.string(), z.strictObject({ command: z.string(), args: z.array(z.string()), env: z.record(z.string(), z.string()).optional() })),
});

/** The scenes an agent writes: a clip, a checkpoint, the recap. A `narration` or `step_through` shown as an example fails here. */
const WrittenScene = z.discriminatedUnion('kind', [ClipScene, CheckpointScene, RecapScene]);

/** What each marker kind is parsed with. */
const SCHEMAS: Record<string, z.ZodType> = {
  mcp: McpConfig,
  scene: WrittenScene,
  stage: Stage,
  beat: Beat,
  action: Action,
  // A prediction by options, or a tap on the picture.
  gate: Gate,
  explore: Explore,
  block: Block,
  question: Question,
  evidence: EvidenceInput,
  plan: PlanInput,
  start: StartInput,
};

type Loose = Record<string, unknown>;

/** The demonstration clips of the interactive shapes, once the example files carry them (as a list or by name). */
const EXPLORE_EXAMPLES = ((): Loose[] => {
  const found = (clipExamples as Loose).EXPLORE_EXAMPLE_CLIPS;
  return (Array.isArray(found) ? found : found && typeof found === 'object' ? Object.values(found) : []) as Loose[];
})();

/** Every example scene of the clip format, by id: the example lesson, one clip per stage kind, the extra `lines` and `timeline` clips, and the explore clips. */
const EXAMPLE_SCENES_BY_ID = new Map<string, Loose>();
for (const scene of [...EXAMPLE_V2_SCENES, ...Object.values(EXAMPLE_CLIPS), ...EXTRA_EXAMPLE_CLIPS, ...EXPLORE_EXAMPLES] as Loose[]) {
  if (!EXAMPLE_SCENES_BY_ID.has(scene.id as string)) EXAMPLE_SCENES_BY_ID.set(scene.id as string, scene);
}
const exampleClips = (): Loose[] => [...EXAMPLE_SCENES_BY_ID.values()].filter((s) => s.kind === 'clip');

/** The first caption of a type in the example clips; a type they never use (an analogy) comes from the v1 example's blocks. */
function exampleBlock(type: string): Loose | undefined {
  for (const clip of exampleClips()) for (const beat of clip.beats as Loose[]) if ((beat.caption as Loose).type === type) return beat.caption as Loose;
  for (const scene of EXAMPLE_SCENES as Loose[]) {
    const blocks = [...((scene.blocks as Loose[] | undefined) ?? []), ...((scene.steps as Loose[] | undefined) ?? []).flatMap((step) => step.blocks as Loose[])];
    const found = blocks.find((b) => b.type === type);
    if (found) return found;
  }
  return undefined;
}

/**
 * The object in the example files that an example stands for. With a reference it is looked up by
 * that reference; a start call and an evidence item are also recognised by their content, so the
 * copies in calibration.md and sourcing.md are held to the same source without being edited.
 */
function sourceOf(ex: Pick<MarkedExample, 'kind' | 'ref'>, value: Loose): unknown {
  const { kind, ref } = ex;
  if (kind === 'start') return EXAMPLE_START;
  if (kind === 'evidence') return ref ? EXAMPLE_EVIDENCE[Number(ref.slice(1)) - 1] : EXAMPLE_EVIDENCE.find((e) => e.url === value.url);
  if (ref === undefined) return undefined;
  switch (kind) {
    case 'scene':
      return EXAMPLE_SCENES_BY_ID.get(ref);
    case 'stage':
      return EXAMPLE_SCENES_BY_ID.get(ref)?.stage;
    case 'gate':
      return ((EXAMPLE_SCENES_BY_ID.get(ref)?.beats as Loose[] | undefined) ?? []).find((b) => b.gate)?.gate;
    case 'explore':
      return EXAMPLE_SCENES_BY_ID.get(ref)?.explore;
    case 'block':
      return exampleBlock(ref);
    case 'question':
      return (EXAMPLE_QUESTIONS as Loose)[ref];
    default:
      return undefined;
  }
}

// src/core/math.ts belongs to another area. It is loaded by path so that this file still runs, with
// the math checks skipped, if that module is absent or stops exporting its command lists.
interface MathModule {
  MATH_COMMAND_GROUPS: Record<string, readonly string[]>;
  MATH_OPERATORS: readonly string[];
  parseMath: (src: string) => { ok: boolean; message?: string };
}
const mathModule = (await import(/* @vite-ignore */ path.join(ROOT, 'src/core/math')).catch(() => null)) as Partial<MathModule> | null;
const math: MathModule | null =
  mathModule && mathModule.MATH_COMMAND_GROUPS && Array.isArray(mathModule.MATH_OPERATORS) && typeof mathModule.parseMath === 'function' ? (mathModule as MathModule) : null;

/** Rewrite what is derived: every example that names its source, the limits table, the verb table, what can be tapped and bound, the formula language, the math list. */
function updateFormatReference(): void {
  for (const file of skillFiles()) {
    let text = read(file);
    const before = text;
    for (const ex of markedExamples(file, text).reverse()) {
      if (ex.ref === undefined) continue;
      const source = sourceOf(ex, {});
      if (source === undefined) throw new Error(`${rel(file)}:${ex.line}: no example in src/core matches "${ex.kind} ${ex.ref}"`);
      text = text.slice(0, ex.start) + formatJson(source) + text.slice(ex.end);
    }
    if (file === FORMAT_MD) {
      const limits = limitsRegion(text);
      text = `${text.slice(0, limits.start)}\n${renderLimits()}\n${text.slice(limits.end)}`;
      const interactive = region(text, INTERACTIVE_START, INTERACTIVE_END);
      text = `${text.slice(0, interactive.start)}\n${renderInteractive()}\n${text.slice(interactive.end)}`;
      const formulas = region(text, FORMULAS_START, FORMULAS_END);
      text = `${text.slice(0, formulas.start)}\n${renderFormulas()}\n${text.slice(formulas.end)}`;
      if (math) {
        const supported = region(text, MATH_START, MATH_END);
        text = `${text.slice(0, supported.start)}\n${renderMath(math.MATH_COMMAND_GROUPS, math.MATH_OPERATORS)}\n${text.slice(supported.end)}`;
      }
    }
    if (file === MOTION_MD) {
      const verbs = region(text, VERBS_START, VERBS_END);
      text = `${text.slice(0, verbs.start)}\n${renderVerbs()}\n${text.slice(verbs.end)}`;
    }
    if (file === CLIP_DESIGN_MD) {
      const help = region(text, FORMULA_HELP_START, FORMULA_HELP_END);
      text = `${text.slice(0, help.start)}\n${renderFormulaHelp()}\n${text.slice(help.end)}`;
    }
    if (text !== before) writeFileSync(file, text);
  }
}

if (process.env.UPDATE_SKILL_DOCS) updateFormatReference();

const where = (ex: { file: string; line: number }): string => `${rel(ex.file)}:${ex.line}`;
const ALL = skillFiles().flatMap((file) => markedExamples(file));
const IN_FORMAT = ALL.filter((ex) => ex.file === FORMAT_MD);
const INLINE = skillFiles().flatMap((file) => inlineActions(file));
const squash = (s: string): string => s.replace(/\s+/g, ' ');

describe('marked examples in the skill', () => {
  it('uses only known marker kinds', () => {
    expect(ALL.filter((ex) => !(ex.kind in SCHEMAS)).map((ex) => `${where(ex)} ${ex.kind}`)).toEqual([]);
  });

  it.each(ALL.map((ex) => [where(ex), ex.ref ? `${ex.kind} ${ex.ref}` : ex.kind, ex] as const))('%s (%s) parses under the schema', (_where, _kind, ex) => {
    const result = SCHEMAS[ex.kind]!.safeParse(JSON.parse(ex.json));
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it('every fenced json block in the skill is marked, so none escapes the schema', () => {
    const unmarked: string[] = [];
    for (const file of skillFiles()) {
      const text = read(file);
      const marked = new Set(markedExamples(file, text).map((ex) => ex.start));
      for (const m of text.matchAll(/```json\n/g)) if (!marked.has(m.index + m[0].length)) unmarked.push(`${rel(file)}:${text.slice(0, m.index).split('\n').length}`);
    }
    expect(unmarked).toEqual([]);
  });

  it('has actions written inline, so the check below is not vacuous', () => {
    expect(INLINE.length).toBeGreaterThanOrEqual(VERBS.length);
  });

  it.each(INLINE.map((a) => [where(a), a.json] as const))('%s: the inline action %s parses', (_where, json) => {
    const result = Action.safeParse(JSON.parse(json));
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });
});

describe('examples that name their source equal it', () => {
  const sourced = ALL.filter((ex) => ex.ref !== undefined || ex.kind === 'start' || ex.kind === 'evidence');

  it.each(sourced.map((ex) => [where(ex), ex.ref ? `${ex.kind} ${ex.ref}` : ex.kind, ex] as const))('%s (%s)', (_where, _kind, ex) => {
    const value = JSON.parse(ex.json) as Loose;
    const source = sourceOf(ex, value);
    expect(source, 'no matching example in src/core').toBeDefined();
    expect(value).toEqual(source);
  });

  it('format.md writes by hand only its plan, its frame clip, one analogy and the interactive shapes', () => {
    const name = (ex: MarkedExample): string => {
      const value = JSON.parse(ex.json) as Loose;
      const which = ex.kind === 'scene' ? value.id : ex.kind === 'block' ? value.type : ex.kind === 'stage' ? `${value.kind as string} ${(value.mark as string | undefined) ?? ''}`.trim() : ex.kind === 'gate' ? ('pick' in value ? 'tap' : 'options') : '';
      return `${ex.kind} ${which as string}`.trim();
    };
    // An analogy is written by hand because no example clip uses one, and the example lesson's
    // analogy block (a version 1 block) is too long to be a caption. The clip with an explore, the
    // curve chart and the tap gate are written by hand too; test/skill/clips.test.ts and
    // test/skill/interactive.test.ts hold them to the validator and to the formula language.
    expect(IN_FORMAT.filter((ex) => ex.ref === undefined).map(name).sort()).toEqual(['block analogy', 'gate tap', 'plan', 'scene grow', 'scene halve', 'stage chart curve']);
  });
});

describe('format.md documents the clip format, and only that', () => {
  const text = read(FORMAT_MD);
  const parsed = IN_FORMAT.map((ex) => ({ kind: ex.kind, value: JSON.parse(ex.json) as Loose }));
  const scenes = parsed.filter((p) => p.kind === 'scene').map((p) => p.value);
  const stages = [...parsed.filter((p) => p.kind === 'stage').map((p) => p.value), ...scenes.filter((s) => s.kind === 'clip').map((s) => s.stage as Loose)];

  it('shows the three scene kinds an agent writes', () => expect(new Set(scenes.map((s) => s.kind))).toEqual(new Set(['clip', 'checkpoint', 'recap'])));
  it('shows every stage kind with a valid example', () => expect(new Set(stages.map((s) => s.kind))).toEqual(new Set(STAGE_KINDS)));
  it('shows every mark of a chart', () => {
    const marks = new Set(stages.filter((s) => s.kind === 'chart').map((s) => s.mark));
    expect(marks).toEqual(new Set(['bars', 'line', 'curve']));
    // The same marks a plan may name, which the reference lists where it describes the plan.
    expect([...marks].sort()).toEqual([...PLAN_CHART_MARKS].sort());
    for (const mark of PLAN_CHART_MARKS) expect(text).toContain(`\`"${mark}"\``);
  });
  it('gives every stage kind a heading of its own', () => {
    for (const kind of STAGE_KINDS) expect(text, kind).toMatch(new RegExp(`^##+ ${kind === 'frame' ? 'Frame' : kind}$`, 'm'));
  });
  it('shows every question type, on its own or inside a scene', () => {
    const types = new Set([...parsed.filter((p) => p.kind === 'question').map((p) => p.value.type), ...scenes.map((s) => (s.question as Loose | undefined)?.type).filter(Boolean)]);
    expect(types).toEqual(new Set(QUESTION_TYPES));
  });
  it('shows every caption block type, on its own or as a caption of a clip', () => {
    const inClips = scenes.filter((s) => s.kind === 'clip').flatMap((s) => (s.beats as Loose[]).map((b) => (b.caption as Loose).type));
    expect(new Set([...parsed.filter((p) => p.kind === 'block').map((p) => p.value.type), ...inClips])).toEqual(new Set(BLOCK_TYPES));
  });
  it('shows a plan', () => expect(parsed.map((p) => p.kind)).toContain('plan'));
  it('shows no caption that the word limit would refuse', () => {
    const count = (text: string): number => text.trim().split(/\s+/).length;
    const captions = [...parsed.filter((p) => p.kind === 'block').map((p) => p.value), ...scenes.filter((s) => s.kind === 'clip').flatMap((s) => (s.beats as Loose[]).map((b) => b.caption as Loose))];
    expect(captions.length).toBeGreaterThan(BLOCK_TYPES.length);
    for (const caption of captions) {
      const text = `${caption.text as string}${typeof caption.limits === 'string' ? ` ${caption.limits}` : ''}`;
      expect(count(text), text).toBeLessThanOrEqual(L.captionWords.max);
    }
  });
  it('shows a gate inside a clip, on a beat that is not the first', () => {
    const gated = scenes.filter((s) => s.kind === 'clip').flatMap((s) => (s.beats as Loose[]).map((b, i) => ({ gate: b.gate, i })));
    expect(gated.some((b) => b.gate !== undefined && b.i > 0)).toBe(true);
    expect(gated.some((b) => b.gate !== undefined && b.i === 0)).toBe(false);
  });
  it('shows both kinds of gate: by options and by a tap', () => {
    const gates = [...parsed.filter((p) => p.kind === 'gate').map((p) => p.value), ...scenes.filter((s) => s.kind === 'clip').flatMap((s) => (s.beats as Loose[]).map((b) => b.gate as Loose | undefined).filter((g): g is Loose => g !== undefined))];
    expect(gates.some((g) => Array.isArray(g.options))).toBe(true);
    expect(gates.some((g) => Array.isArray(g.pick))).toBe(true);
  });
  it('shows an explore with controls, bindings and a goal, inside a complete clip', () => {
    const explored = scenes.filter((s) => s.kind === 'clip' && s.explore !== undefined).map((s) => ClipScene.parse(s));
    expect(explored.length).toBeGreaterThan(0);
    expect(explored.some((clip) => clip.explore!.bind.length > 0 && clip.explore!.goal !== undefined)).toBe(true);
    // Every field of an explore, a control and a goal has its name in the reference.
    const section = text.slice(text.indexOf('\n## Explore\n'), text.indexOf('\n## Formulas\n'));
    for (const field of [...Object.keys(Explore.shape), 'id', 'label', 'min', 'max', 'step', 'value', 'unit', 'target', 'expr', 'text', 'when', 'done']) expect(section, field).toMatch(new RegExp(`\\b${field}\\b`));
  });

  // The verbs are documented where beats are written, in motion.md, and format.md says so.
  const motion = read(MOTION_MD);
  it('points at the verb reference in motion.md', () => {
    expect(text).toContain('(motion.md#the-verbs)');
    expect(motion).toMatch(/^## The verbs$/m);
  });

  // Each verb has a row in the table of what it takes, and the row's example is that verb, parsed above.
  it.each(VERBS)('motion.md gives the verb %s a row with a valid example', (verb) => {
    const row = motion.split('\n').find((line) => line.startsWith(`| \`${verb}\` |`) && line.includes('{ "verb"'));
    expect(row, `no row for ${verb}`).toBeDefined();
    const example = /`(\{ "verb": [^`]*\})`/.exec(row!);
    expect(example, `the row for ${verb} has no example`).not.toBeNull();
    const action = Action.parse(JSON.parse(example![1]!));
    expect(action.verb).toBe(verb);
  });

  it('names every tone and every provenance', () => {
    for (const tone of TONES) expect(motion).toContain(`\`${tone}\``);
    for (const p of PROVENANCES) expect(text).toContain(`\`"${p}"\``);
  });

  it('motion.md lists which stage takes which verb, and on which parts, exactly as the validator checks it', () => {
    expect(region(motion, VERBS_START, VERBS_END).body).toBe(renderVerbs());
    // Every stage kind has a row, and a typed stage's row names only verbs that stage accepts.
    const body = region(motion, VERBS_START, VERBS_END).body;
    for (const [kind, verbs] of Object.entries(VERBS_BY_STAGE)) {
      const label = STAGE_LABELS[kind] ?? `\`${kind}\``;
      const row = body.split('\n').find((line) => line.startsWith(`| ${label} |`));
      expect(row, kind).toBeDefined();
      const named = [...row!.matchAll(/`([a-z]+)`(?=[^|]*:)/g)].map((m) => m[1]!).filter((v) => (VERBS as readonly string[]).includes(v));
      for (const verb of named) expect(verbs, `${verb} on ${kind}`).toContain(verb);
    }
  });

  it('motion.md says once which verbs a read-out takes, as the validator has it', () => {
    const verbs = readoutVerbs();
    expect(verbs.length).toBeGreaterThan(0);
    const sentence = /A read-out takes ([^.]+) on every stage that has read-outs\./.exec(motion.replace(/\s+/g, ' '));
    expect(sentence).not.toBeNull();
    expect([...sentence![1]!.matchAll(/`([a-z]+)`/g)].map((m) => m[1]!).sort()).toEqual(verbs);
  });

  // The frame clip is the one clip the reference writes by hand: it has to pass the frame's own checks too.
  it('its frame clip passes the static checks of a custom frame', async () => {
    const check = (await import(/* @vite-ignore */ path.join(ROOT, 'src/frame/check')).catch(() => null)) as {
      checkFrame?: (stage: unknown) => { ok: boolean; issues: { code: string; message?: string }[] };
      checkFrameBeats?: (duration: number, ats: readonly (number | undefined)[]) => { code: string }[];
    } | null;
    const clip = ClipScene.parse(scenes.find((s) => s.id === 'halve'));
    expect(clip.stage.kind).toBe('frame');
    if (clip.stage.kind !== 'frame') return;
    for (const beat of clip.beats) expect(beat.do).toEqual([]);
    if (!check?.checkFrame || !check.checkFrameBeats) return;
    expect(check.checkFrame(clip.stage).issues.map((i) => `${i.code} ${i.message ?? ''}`)).toEqual([]);
    expect(check.checkFrameBeats(clip.stage.duration, clip.beats.map((b) => b.at)).map((i) => i.code)).toEqual([]);
  });
});

describe('the plan in format.md is the plan of the example lesson', () => {
  const plan = PlanInput.parse(JSON.parse(IN_FORMAT.find((ex) => ex.kind === 'plan')!.json));

  it('has the example lesson\'s title and objectives', () => {
    expect(plan.title).toBe(EXAMPLE_PLAN.title);
    expect(plan.objectives).toEqual(EXAMPLE_PLAN.objectives);
  });

  it('has one entry per scene, in order, with the kind, stage, question and objective each scene has', () => {
    const fromScenes = (EXAMPLE_V2_SCENES as Loose[]).map((scene) => ({
      id: scene.id,
      kind: scene.kind,
      ...(scene.kind === 'clip' ? { stage: (scene.stage as Loose).kind } : {}),
      ...(scene.kind === 'checkpoint' ? { question: (scene.question as Loose).type, objective: scene.objective } : {}),
    }));
    expect(plan.outline.map(({ purpose: _purpose, mark: _mark, ...entry }) => entry)).toEqual(fromScenes);
    // A chart clip may plan its mark, to get that chart's template; where the plan names one it is the mark the scene has.
    expect(plan.outline.some((entry) => entry.mark !== undefined)).toBe(true);
    for (const entry of plan.outline) {
      if (entry.mark === undefined) continue;
      const scene = (EXAMPLE_V2_SCENES as Loose[]).find((s) => s.id === entry.id)!;
      expect(entry.stage).toBe('chart');
      expect(entry.mark).toBe((scene.stage as Loose).mark);
    }
  });

  it('plans only the kinds an agent writes', () => {
    expect(new Set(plan.outline.map((e) => e.kind))).toEqual(new Set(['clip', 'checkpoint', 'recap']));
    expect(plan.outline[0]?.kind).toBe('clip');
    expect(plan.outline.at(-1)?.kind).toBe('recap');
  });
});

describe('the version 1 teaching scenes are not taught', () => {
  // `narration` and `step_through` remain in the code as legacy. An agent must not learn them from
  // the skill: no example, no field name, no mention. errors.md is generated from the catalog,
  // which still lists their codes, so it is not read here.
  const LEGACY = /step_through|step-through|narration scene|[`"]narration[`"]|`figure`|`highlight`|`steps`|`predict`|`state`|`layers`|`compare`|scene-design/i;
  const files = skillFiles().filter((f) => path.basename(f) !== 'errors.md');

  it.each(files.map((f) => [rel(f), f] as const))('%s', (_name, file) => {
    const lines = read(file)
      .split('\n')
      .map((line, i) => `${i + 1}: ${line}`)
      .filter((line) => LEGACY.test(line));
    expect(lines).toEqual([]);
  });

  it('no marked example is a version 1 scene', () => {
    const kinds = ALL.filter((ex) => ex.kind === 'scene').map((ex) => (JSON.parse(ex.json) as Loose).kind);
    expect(kinds.filter((k) => k === 'narration' || k === 'step_through')).toEqual([]);
  });
});

describe('the limits table in format.md', () => {
  it('is exactly what the limits files render to', () => {
    expect(limitsRegion(read(FORMAT_MD)).body).toBe(renderLimits());
  });
});

describe('limits quoted in prose match the code', () => {
  const ref = (name: string): string => path.join(REF_DIR, name);
  const q = DEPTHS.quick;
  const s = DEPTHS.standard;
  const d = DEPTHS.deep;
  const n = (x: number): string => x.toLocaleString('en-US');
  const word = (x: number): string => ['zero', 'one', 'two', 'three', 'four', 'five'][x]!;
  const shareOf = (x: number): string => (Math.abs(x - 2 / 3) < 1e-9 ? 'two thirds' : `${Math.round(x * 100)}%`);
  const thirds = shareOf(L.beatsThatMove);
  const I = interactiveLimits();
  const quoted: Array<[string, string]> = [
    [SKILL_MD, `${L.excerptChars.min} to ${L.excerptChars.max} characters`],
    // The three limits that decide which sentences get saved are stated where research starts.
    [SKILL_MD, `at most ${n(L.excerptCharsPerUrl)} excerpt characters from one URL, ${L.usesPerEvidence} uses of one excerpt, and ${L.citesPerBlock} cites on a block (${C.citesPerStage} on a stage)`],
    [SKILL_MD, `\`quick\` is about ${q.minutes} minutes, \`standard\` about ${s.minutes} and the default, \`deep\` about ${d.minutes}`],
    [SKILL_MD, `never more than ${word(L.passiveRun)} scenes in a row without`],
    [SKILL_MD, `${C.beats.min} to ${C.beats.max} \`beats\``],
    [SKILL_MD, `about ${L.captionWords.warn} words at most`],

    [ref('calibration.md'), `At most ${L.calibration.max} entries`],
    [ref('calibration.md'), `a question of at most ${L.calibration.questionChars} characters and an answer of at most ${L.calibration.answerChars}`],
    [ref('calibration.md'), `\`knows\` (at most ${L.learnerKnowsChars} characters) and \`goal\` (at most ${L.learnerGoalChars})`],
    [ref('calibration.md'), `\`quick\` (about ${q.minutes} minutes)`],
    [ref('calibration.md'), `\`standard\` (about ${s.minutes} minutes)`],
    [ref('calibration.md'), `\`deep\` (about ${d.minutes} minutes)`],

    [ref('sourcing.md'), `Between ${L.excerptChars.min} and ${L.excerptChars.max} characters`],
    [ref('sourcing.md'), `At most ${n(L.excerptCharsPerUrl)} characters in total from any one URL`],
    [ref('sourcing.md'), `a query string of at most ${L.urlQueryChars} characters`],
    [ref('sourcing.md'), `at least ${q.evidenceMin} excerpts at \`quick\` depth, ${s.evidenceMin} at \`standard\` and ${d.evidenceMin} at \`deep\``],
    [ref('sourcing.md'), `One excerpt supports at most ${L.usesPerEvidence} items`],
    [ref('sourcing.md'), `\`cites\` takes 1 to ${L.citesPerBlock} ids, or up to ${C.citesPerStage} on a stage`],
    [ref('sourcing.md'), `up to ${L.evidencePerLesson} items`],
    [ref('sourcing.md'), `at least ${L.quoteMinWords} words of it`],

    [ref('clip-design.md'), `${q.objectives.min} to ${q.objectives.max} for a quick lesson, ${s.objectives.min} to ${s.objectives.max} for a standard one, ${d.objectives.min} to ${d.objectives.max} for a deep one`],
    [ref('clip-design.md'), `the ${C.beats.min} to ${C.beats.max} changes`],
    [ref('clip-design.md'), `A clip has ${C.beats.min} to ${C.beats.max} beats, and a beat at most ${C.actionsPerBeat} actions`],
    [ref('clip-design.md'), `about ${L.captionWords.warn} words at most`],
    [ref('clip-design.md'), `warn above ${L.captionWords.warn} words and refuse a caption above ${L.captionWords.max}`],
    [ref('clip-design.md'), `At least ${thirds} of a clip's beats must have an action`],
    [ref('clip-design.md'), `never more than ${L.passiveRun} scenes in a row`],
    [ref('clip-design.md'), `\`framing\` and \`analogy\` captions may be at most ${Math.round(L.uncitedShare.share * 100)}% of the words and \`example\` captions at most ${Math.round(L.exampleShare.share * 100)}% (or ${L.uncitedShare.floorWords} and ${L.exampleShare.floorWords} words, if that is more)`],
    [ref('clip-design.md'), `more than ${L.illustrativeShare === 0.5 ? 'half' : `${Math.round(L.illustrativeShare * 100)}% of`} the clips that show data`],
    [ref('clip-design.md'), `\`stats\` holds up to ${C.stats}`],
    [ref('clip-design.md'), `a question with ${L.predictOptions.min} to ${L.predictOptions.max} options`],
    [ref('clip-design.md'), `the stage \`cites\` (up to ${C.citesPerStage})`],
    [ref('clip-design.md'), `in ${L.figureDescriptionChars.min} to ${L.figureDescriptionChars.max} characters`],
    [ref('clip-design.md'), `at most ${L.framesPerLesson} in a lesson`],
    // The stage table: what each kind cannot hold.
    [ref('clip-design.md'), `${C.words.lines.min} to ${C.words.lines.max} lines`],
    [ref('clip-design.md'), `More than ${C.flow.nodes.max} boxes`],
    [ref('clip-design.md'), `${C.sequence.actors.min} to ${C.sequence.actors.max} actors, up to ${C.sequence.messages.max} messages`],
    [ref('clip-design.md'), `${C.cells.cells.min} to ${C.cells.cells.max} cells, labels of at most ${C.cells.cellChars} characters`],
    [ref('clip-design.md'), `At most ${n(C.dots.total.max)} dots`],
    [ref('clip-design.md'), `${C.chart.bars.min} to ${C.chart.bars.max} bars`],
    [ref('clip-design.md'), `More than ${C.chart.series.max} series or ${C.chart.xs.max} points`],
    [ref('clip-design.md'), `Up to ${K.lines.lines.max} lines`],
    [ref('clip-design.md'), `${K.timeline.events.min} to ${K.timeline.events.max} events`],
    [ref('clip-design.md'), `${L.options.min} or ${L.options.max} options, exactly one correct`],
    [ref('clip-design.md'), `${L.orderItems.min} to ${L.orderItems.max} items, given in the correct order`],
    [ref('clip-design.md'), `${L.lookFor.min} to ${L.lookFor.max} \`lookFor\` points`],
    // The interactive shapes.
    [ref('clip-design.md'), `fewer than ${shareOf(L.interactiveShare)} of the clips do`],
    [ref('clip-design.md'), `${I.curves.min} to ${I.curves.max} curves`],
    [ref('clip-design.md'), `\`points\` holds up to ${I.points.max}`],
    [ref('clip-design.md'), `${word(I.controls.min)[0]!.toUpperCase()}${word(I.controls.min).slice(1)} or ${word(I.controls.max)} sliders (\`controls\`)`],
    [SKILL_MD, `${word(I.controls.min)} or ${word(I.controls.max)} sliders`],
    [SKILL_MD, `at least ${shareOf(L.interactiveShare)} of a lesson's clips`],

    [ref('motion.md'), `${word(C.actionsPerBeat)[0]!.toUpperCase()}${word(C.actionsPerBeat).slice(1)} actions is the ceiling for a beat`],
    [ref('motion.md'), `A ${L.captionWords.warn}-word caption`],

    [ref('format.md'), `${C.beats.min} to ${C.beats.max} [beats]`],
    [ref('format.md'), `0 to ${C.actionsPerBeat} [actions]`],
    [ref('format.md'), `At least ${thirds} of a clip's beats must have one`],
    [ref('format.md'), `at most ${L.framesPerLesson} \`frame\` clips`],
    [ref('format.md'), `an array of 1 to ${L.citesPerBlock} ids`],
    [ref('format.md'), `up to ${C.citesPerStage} evidence ids`],
    [ref('format.md'), `up to ${C.stats} read-outs`],
    [ref('format.md'), `A stage holds ${K.lines.rowBudget} rows`],
    [ref('format.md'), `${K.timeline.lanes.min} or ${K.timeline.lanes.max} parallel tracks`],
    [ref('format.md'), `a \`prompt\` and ${L.predictOptions.min} to ${L.predictOptions.max} \`options\``],
    [ref('format.md'), `\`pick\` (${I.pick.min} to ${I.pick.max} ids`],
    [ref('format.md'), `${I.controls.min} or ${I.controls.max} sliders`],
    [ref('format.md'), `Up to ${I.bindings.max} bindings`],
    [ref('format.md'), `each of the ${I.curves.min} to ${I.curves.max} \`curves\``],
    [ref('format.md'), `\`points\` (up to ${I.points.max})`],
    [ref('format.md'), `${L.nextTopics.min} to ${L.nextTopics.max} \`next\` topics, each shown as a ready-made request`],
    [ref('motion.md'), `\`into\`: ${C.dots.into.min} to ${C.dots.into.max} of`],
    [ref('motion.md'), `\`targets\`: the ${C.dots.merge.min} to ${C.dots.merge.max} groups to join`],
    [ref('format.md'), `${L.nextTopics.min} to ${L.nextTopics.max} \`next\` topics`],
    [ref('format.md'), `\`l1\` to \`l${K.lines.lines.max}\``],
  ];

  it.each(quoted.map(([file, text]) => [rel(file), text, file] as const))('%s says "%s"', (_name, text, file) => {
    expect(squash(read(file))).toContain(squash(text));
  });

  it('the frame limits the reference states are the frame\'s', () => {
    // frame-api.md is written by the frame's own area; format.md only points at it. The limits
    // table carries the numbers, and it is rendered from FRAME_LIMITS.
    expect(renderLimits()).toContain(`\`duration\` ${F.duration.min} to ${F.duration.max} seconds`);
  });
});

describe('what motion.md says about how long a caption holds its beat', async () => {
  const timeline = (await import(/* @vite-ignore */ path.join(ROOT, 'src/player/stage/timeline')).catch(() => null)) as { readingMs?: (text: string) => number } | null;
  const readingMs = timeline?.readingMs;
  const words = (count: number): string => Array.from({ length: count }, () => 'word').join(' ');
  const text = squash(read(path.join(REF_DIR, 'motion.md')));

  it('states the rule', () => {
    expect(text).toContain('half a second, plus 0.3 seconds a word, and never under 1.8 seconds');
    expect(text).toContain('about five seconds');
  });

  it.skipIf(!readingMs)('which is how the engine times a caption', () => {
    expect(readingMs!(words(10))).toBe(500 + 10 * 300);
    expect(readingMs!(words(2))).toBe(1800);
    expect(readingMs!(words(L.captionWords.warn)) / 1000).toBeGreaterThan(4.5);
    expect(readingMs!(words(L.captionWords.warn)) / 1000).toBeLessThan(5.5);
  });
});

describe('the math subset in format.md', () => {
  const text = read(FORMAT_MD);

  it.skipIf(!math)('lists exactly what src/core/math.ts supports', () => {
    expect(region(text, MATH_START, MATH_END).body).toBe(renderMath(math!.MATH_COMMAND_GROUPS, math!.MATH_OPERATORS));
  });

  const marker = '<!-- math-examples -->';
  const list = text.slice(text.indexOf(marker) + marker.length).split('\n\n')[0]!;
  const expressions = [...list.matchAll(/^- `(.+)`$/gm)].map((m) => m[1]!);

  it('gives example expressions', () => {
    expect(text).toContain(marker);
    expect(expressions.length).toBeGreaterThanOrEqual(8);
  });

  it.skipIf(!math).each(expressions)('the example %s parses', (expression) => {
    const result = math!.parseMath(expression);
    expect(result.ok ? '' : result.message).toBe('');
  });

  it.skipIf(!math)('the inline example in the markup table parses', () => {
    const inline = /\| `\$(.+?)\$` \|/.exec(text);
    expect(inline).not.toBeNull();
    expect(math!.parseMath(inline![1]!).ok).toBe(true);
  });
});

describe('the inline markup rules stated in format.md', async () => {
  type Node = { t: string; v?: string; c?: Node[] };
  const markup = (await import(/* @vite-ignore */ path.join(ROOT, 'src/core/markup')).catch(() => null)) as { parseInline?: (src: string) => { nodes: Node[]; errors: unknown[] } } | null;
  const parse = markup?.parseInline;
  const kinds = (src: string): string[] => parse!(src).nodes.map((n) => n.t);
  const literal = (src: string): boolean => parse!(src).errors.length === 0 && kinds(src).every((k) => k === 'text');

  it.skipIf(!parse)('the four kinds of markup are recognised', () => {
    expect(kinds('**strong**')).toEqual(['strong']);
    expect(kinds('*emphasis*')).toEqual(['em']);
    expect(kinds('`code`')).toEqual(['code']);
    expect(kinds('$n^2$')).toEqual(['math']);
  });

  it.skipIf(!parse)('the cases it says stay literal do', () => {
    for (const src of ['2*3*4', '*.txt', '$5 and $10', 'a lone * star', 'an open ` tick', '<b>not html</b>', '[text](https://example.com)']) expect(literal(src), src).toBe(true);
  });

  it.skipIf(!parse)('a backslash makes a delimiter literal', () => {
    for (const src of ['\\*not emphasis\\*', '\\`not code\\`', '\\$x\\$']) expect(literal(src), src).toBe(true);
  });

  it.skipIf(!parse)('math that does not parse is the one markup error', () => {
    expect(parse!('$\\begin{matrix}$').errors.length).toBe(1);
    expect(parse!('an unclosed **strong').errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The interactive shapes: what can be tapped and bound, and the formula language
// ---------------------------------------------------------------------------------------------

describe('what format.md says can be tapped and bound', () => {
  const text = read(FORMAT_MD);
  const body = region(text, INTERACTIVE_START, INTERACTIVE_END).body;

  it('is exactly what the validator\'s table of tappable parts and the format\'s table of bindable parts render to', () => {
    expect(body).toBe(renderInteractive());
  });

  it('has a row for every stage kind, and names every kind of part the two tables hold', () => {
    const rows = body.split('\n').slice(2);
    expect(rows).toHaveLength(Object.keys(VERBS_BY_STAGE).length);
    expect(Object.keys(TAPPABLE).sort()).toEqual(Object.keys(VERBS_BY_STAGE).sort());
    expect(Object.keys(BINDABLE).sort()).toEqual(Object.keys(VERBS_BY_STAGE).sort());
    // A read-out can be bound wherever a stage has read-outs, which is what the prose says once.
    for (const [kind, kinds] of Object.entries(BINDABLE)) if (kind !== 'words' && kind !== 'frame') expect(kinds, kind).toContain('stat');
    expect(BINDABLE['chart.bars']).toContain('bar');
    expect(BINDABLE.dots).toContain('group');
    expect(BINDABLE.lines).toContain('value');
  });
});

describe('the formula language in the references', () => {
  const format = read(FORMAT_MD);
  const design = read(CLIP_DESIGN_MD);

  it('format.md lists exactly the functions, constants and length limit of src/core/expr.ts', () => {
    const body = region(format, FORMULAS_START, FORMULAS_END).body;
    expect(body).toBe(renderFormulas());
    for (const name of Object.keys(EXPR_FUNCTIONS)) expect(body, name).toMatch(new RegExp(`\`${name}[\`(]`));
    for (const name of Object.keys(EXPR_CONSTANTS)) expect(body).toContain(`\`${name}\``);
    expect(body).toContain(`at most ${EXPR_LIMITS.chars} characters`);
  });

  it('clip-design.md quotes the module\'s own paragraph, not a retyped one', () => {
    expect(region(design, FORMULA_HELP_START, FORMULA_HELP_END).body).toBe(renderFormulaHelp());
    expect(design).toContain(EXPR_HELP);
  });

  const marker = '<!-- formula-examples -->';
  const list = format.slice(format.indexOf(marker) + marker.length).split('\n\n')[0]!;
  const expressions = [...list.matchAll(/^- `(.+)`$/gm)].map((m) => m[1]!);

  it('gives example formulas', () => {
    expect(format).toContain(marker);
    expect(expressions.length).toBeGreaterThanOrEqual(5);
  });

  it.each(expressions)('the example %s parses', (expression) => {
    const result = parseExpr(expression);
    expect(result.ok ? '' : result.message).toBe('');
  });

  // Every formula written in a code span of the two references that teach them, outside the
  // marked examples: what an agent copies from a sentence must parse too.
  const inProse = (text: string): string[] =>
    [...text.matchAll(/`([^`\n]+)`/g)]
      .map((m) => m[1]!)
      .filter((span) => /^(?:if|round|abs|max|min|clamp|floor|ln|log2|sqrt)\(.*\)[^`]*$/.test(span) || /^[a-z_]+ [<>*/+-]=? [a-z0-9_.]+$/.test(span))
      .filter((span) => !span.includes('...') && !/\b(condition|value, low)\b/.test(span));
  const prose = [...new Set([...inProse(format), ...inProse(design)])];

  it('has formulas in its prose, so the check below is not vacuous', () => {
    expect(prose.length).toBeGreaterThanOrEqual(4);
  });

  it.each(prose)('the formula %s in a sentence parses', (expression) => {
    const result = parseExpr(expression);
    expect(result.ok ? '' : `${expression}: ${result.message}`).toBe('');
  });

  it('what the references call the usual mistakes are refused by the parser, and their fixes accepted', () => {
    for (const wrong of ['x ** 2', '2x', '2 x', 'rate %', '5%', 'a < b < c', 'Math.sqrt(x)', 'pow(x, 2)', 'log(x)']) expect(parseExpr(wrong).ok, wrong).toBe(false);
    for (const right of ['x^2', '2 * x', 'rate / 100', 'a < b and b < c', 'sqrt(x)', 'ln(x)']) expect(parseExpr(right).ok, right).toBe(true);
    // "`^` binds tighter than a minus sign in front, so `-x^2` is `-(x^2)`".
    const value = (src: string, env: Record<string, number> = {}): number => {
      const parsed = parseExpr(src);
      return parsed.ok ? evalExpr(parsed.expr, env) : Number.NaN;
    };
    expect(value('-x^2', { x: 3 })).toBe(-9);
    // "A comparison is worth 1 or 0, and `if` works out only the branch it takes."
    expect(value('2 > 1')).toBe(1);
    expect(value('2 < 1')).toBe(0);
    expect(value('if(rate > 0, hits / rate, 0)', { rate: 0, hits: 4 })).toBe(0);
    expect(Number.isFinite(value('hits / rate', { rate: 0, hits: 4 }))).toBe(false);
    expect(format.replace(/\s+/g, ' ')).toContain('`-x^2` is `-(x^2)`');
    expect(format.replace(/\s+/g, ' ')).toContain('`if` works out only the branch it takes');
    expect(design.replace(/\s+/g, ' ')).toContain('`if(rate > 0, hits / rate, 0)`');
  });

  it('a control id is what the references say: a word, and not one the language uses', () => {
    const flat = format.replace(/\s+/g, ' ');
    expect(flat).toContain('A lowercase letter, then up to 15 letters, digits or `_`; not `x`, `e`, `pi` or a function\'s name');
    for (const ok of ['rate', 'buyers', 'a', 'list_size', 'k2', `a${'b'.repeat(15)}`]) expect(VarId.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['x', 'e', 'pi', 'min', 'if', 'and', 'Rate', '2k', 'my-rate', `a${'b'.repeat(16)}`]) expect(VarId.safeParse(bad).success, bad).toBe(false);
    for (const name of [...Object.keys(EXPR_FUNCTIONS), ...Object.keys(EXPR_CONSTANTS)]) expect(EXPR_RESERVED.has(name)).toBe(true);
  });
});
