// Which parts of a stage a learner can answer a tap gate on.
//
// A tap gate (`PickGate` in core/clip.ts) asks the learner to tap the part they think is right.
// While it is open the engine lays a real button over every part of the stage that could be meant,
// so the kinds below are the engine's promise: a part of one of these kinds, on stage when the gate
// opens, becomes a focusable, labelled control. Parts of any other kind (a pointer, a bracket, a
// read-out, an annotation, a token) are never offered: they are furniture, not answers.
//
// This file is data and pure functions over a clip as authored. It imports nothing, so the
// validator can use it as well as the page: `TAPPABLE` for "can the engine make this kind of part
// tappable?", `tappableParts` for "which ids of this clip are such parts, and what are they called?".
// Whether a part is ON STAGE when a gate opens depends on the beats before it (a `show`, a `send`,
// a `split`); the engine decides that at the instant the gate opens (`Stage.taps`, kit.ts), and a
// gate none of whose right parts can be tapped then is passed over instead of trapping the learner.

/** By stage kind (`chart.bars`, `chart.line`, `chart.curve` for the chart marks, as in `VERBS_BY_STAGE`): the kinds of part that can be tapped. */
export const TAPPABLE: Readonly<Record<string, readonly string[]>> = {
  /** An actor's head; a message that has been sent (its arrow and label). */
  sequence: ['actor', 'message'],
  cells: ['cell'],
  /** A group of dots that is on stage: its block and its label. */
  dots: ['group'],
  'chart.bars': ['bar'],
  /** A line that has been drawn, by its name. */
  'chart.line': ['series'],
  /** A marked point; a curve, by its name at its right end. */
  'chart.curve': ['point', 'curve'],
  /** A box; a connector that has been drawn. */
  flow: ['node', 'edge'],
  words: ['line'],
  lines: ['line'],
  timeline: ['event'],
  frame: [],
};

export interface TapPart {
  readonly id: string;
  /** One of the kinds in `TAPPABLE`. */
  readonly kind: string;
  /** What the part is called: its own words, as a screen reader hears them and as the static answer names it. */
  readonly label: string;
}

interface Named {
  readonly id: string;
  readonly label?: string | undefined;
  readonly [field: string]: unknown;
}
interface StageLike {
  readonly kind: string;
  readonly mark?: string | undefined;
  readonly [field: string]: unknown;
}
interface ClipLike {
  readonly stage: StageLike;
  readonly beats?: readonly { readonly do?: readonly { readonly verb: string; readonly [field: string]: unknown }[] | undefined }[] | undefined;
}

/** The row of `TAPPABLE` for a stage. */
export function tappableKinds(stage: { readonly kind: string; readonly mark?: string | undefined }): readonly string[] {
  return TAPPABLE[stage.kind === 'chart' ? `chart.${stage.mark ?? ''}` : stage.kind] ?? [];
}

const list = (v: unknown): Named[] => (Array.isArray(v) ? (v as Named[]).filter((p) => typeof p === 'object' && p !== null && typeof p.id === 'string') : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/**
 * Every part of a clip that a tap gate may name, in the order the stage declares them: its id, its
 * kind and what it is called. On a `dots` stage the groups that the beats make (`split ... into`,
 * `merge ... into`) are included, after the stage's own group.
 */
export function tappableParts(clip: ClipLike): TapPart[] {
  const stage = clip.stage;
  const out: TapPart[] = [];
  const add = (kind: string, id: string, label: string): void => {
    if (!out.some((p) => p.id === id)) out.push({ id, kind, label: label || id });
  };
  switch (stage.kind) {
    case 'sequence': {
      const actors = list(stage.actors);
      const name = new Map(actors.map((a) => [a.id, str(a.label)]));
      for (const a of actors) add('actor', a.id, str(a.label));
      for (const m of list(stage.messages)) add('message', m.id, `${str(m.label)}, from ${name.get(str(m.from)) ?? str(m.from)} to ${name.get(str(m.to)) ?? str(m.to)}`);
      break;
    }
    case 'cells': {
      const cells = list(stage.cells);
      cells.forEach((c, i) => {
        // Two cells with the same words are told apart by where they start.
        const twin = cells.some((o, k) => k !== i && str(o.label) === str(c.label));
        add('cell', c.id, twin ? `${str(c.label)} (cell ${i + 1} at the start)` : str(c.label));
      });
      break;
    }
    case 'dots': {
      const root = stage.group as Named | undefined;
      if (root && typeof root.id === 'string') add('group', root.id, str(root.label));
      for (const beat of clip.beats ?? []) {
        for (const a of beat.do ?? []) {
          if (a.verb === 'split') for (const g of list(a.into)) add('group', g.id, str(g.label));
          else if (a.verb === 'merge' && typeof a.into === 'object' && a.into !== null) {
            const g = a.into as Named;
            if (typeof g.id === 'string') add('group', g.id, str(g.label));
          }
        }
      }
      break;
    }
    case 'chart':
      if (stage.mark === 'bars') for (const b of list(stage.bars)) add('bar', b.id, str(b.label));
      else if (stage.mark === 'line') for (const q of list(stage.series)) add('series', q.id, str(q.label));
      else if (stage.mark === 'curve') {
        for (const p of list(stage.points)) add('point', p.id, str(p.label));
        for (const q of list(stage.curves)) add('curve', q.id, str(q.label));
      }
      break;
    case 'flow': {
      const nodes = list(stage.nodes);
      const name = new Map(nodes.map((n) => [n.id, str(n.label)]));
      for (const n of nodes) add('node', n.id, str(n.label));
      for (const e of list(stage.edges)) {
        const ends = `the arrow from ${name.get(str(e.from)) ?? str(e.from)} to ${name.get(str(e.to)) ?? str(e.to)}`;
        add('edge', e.id, e.label ? `${str(e.label)}: ${ends}` : ends);
      }
      break;
    }
    case 'words':
      for (const l of list(stage.lines)) add('line', l.id, str(l.text));
      break;
    case 'lines':
      (Array.isArray(stage.lines) ? (stage.lines as unknown[]) : []).forEach((text, i) => add('line', `l${i + 1}`, `Line ${i + 1}: ${str(text).trim()}`));
      break;
    case 'timeline':
      for (const e of list(stage.events)) add('event', e.id, `${str(e.when)}: ${str(e.label)}`);
      break;
    default:
      break;
  }
  return out;
}
