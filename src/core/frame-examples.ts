// Three custom frames that pass every check, as data. They are the worked examples in the skill's
// frame reference, the fixtures of the frame tests, and what a new stage kit test can borrow.
//
// Each is written the way an agent should write one: everything laid out from S.W and S.H (never
// fixed coordinates), a branch on S.tall where the tall stage needs a different size, colours from
// S.theme only, every move a function of t through S.prog, S.spring or S.map, and nothing that
// keeps going once the idea has landed.
//
// Each also carries the passage its clip cites, so that the clip made from it (frameExampleClip) is
// a complete scene the validator accepts: a clip needs a caption that is a claim or a quote, and a
// stage marked "worked" cites the passage whose rule it applies. The passages are SYNTHETIC, like
// the evidence of the example lesson: written for these examples, not taken from a page.
import type { FrameStage } from './frame';
import type { EvidenceInput } from './schema';

export interface FrameExample {
  /** A scene id for a clip made from this example. */
  id: string;
  title: string;
  /** The clip's description: the text alternative. */
  description: string;
  stage: FrameStage;
  /** The passages the clip cites, as the lesson that holds it would have stored them: e1, e2, ... in this order. SYNTHETIC. */
  evidence: EvidenceInput[];
  /**
   * The clip's beats: when each caption appears (seconds into the animation) and what it says. A
   * caption that states a fact names the evidence it rests on (`cites`) and becomes a claim; the
   * others are the example's own working.
   */
  beats: { at: number; caption: string; cites?: string[] }[];
}

const SORT = `// Bubble sort on eight bars. Everything is worked out once, here; render(ctx, t) only looks things up.
const values = [5, 2, 8, 3, 9, 1, 6, 4], n = values.length;
const steps = [];                       // each step: who is compared, whether they swap, the order before it
{
  const order = values.map((_, i) => i); // order[slot] = bar id
  for (let end = n - 1; end > 0; end--) {
    for (let j = 0; j < end; j++) {
      const swap = values[order[j]] > values[order[j + 1]];
      steps.push({ a: j, b: j + 1, swap, before: order.slice(), sortedFrom: end + 1 });
      if (swap) [order[j], order[j + 1]] = [order[j + 1], order[j]];
    }
  }
  steps.push({ a: -1, b: -1, swap: false, before: order.slice(), sortedFrom: 0 });
}
const INTRO = 1.6, STEP = 0.5;          // seconds

function render(ctx, t) {
  const { W, H, theme: c, ease } = S, pad = W * 0.08, base = H * (S.tall ? 0.74 : 0.8);
  const slotW = (W - 2 * pad) / n, barW = slotW * 0.68, unit = (H * 0.5) / 9, size = S.tall ? 26 : 22;
  S.clear();
  const k = S.clamp(Math.floor((t - INTRO) / STEP), 0, steps.length - 1), st = steps[k];
  const p = t < INTRO ? 0 : S.clamp((t - INTRO - k * STEP) / STEP, 0, 1), done = k === steps.length - 1;
  const comparisons = t < INTRO ? 0 : Math.min(k + (p > 0.3 ? 1 : 0), steps.length - 1);
  const swaps = steps.slice(0, k).filter((s) => s.swap).length + (st.swap && p > 0.5 ? 1 : 0);

  S.text('Bubble sort', pad, H * 0.12, { size: size * 1.5, weight: 700 });
  const line = done ? 'Sorted. The largest values moved to the right, one pass at a time.'
    : t < INTRO ? 'Compare neighbours. Swap them if the left one is larger.'
    : st.swap ? 'Left is larger: swap.' : 'Already in order: move on.';
  S.text(line, pad, H * 0.12 + size * 1.5, { size, fill: c.fg2, maxWidth: W - 2 * pad });

  S.line(pad, base, W - pad, base, { stroke: c.lineStrong, lw: 2 });
  st.before.forEach((id, slot) => {
    let x = pad + slot * slotW + (slotW - barW) / 2, lift = 0, colour = c.accentSoft, edge = c.accent;
    const active = slot === st.a || slot === st.b;
    if (active && !done && t >= INTRO) {
      colour = st.swap ? c.warnSoft : c.mark; edge = st.swap ? c.warn : c.fg;
      if (st.swap) {                     // the two bars trade places on a small arc
        const q = ease.inOut(S.prog(p, 0.3, 0.6)), dir = slot === st.a ? 1 : -1;
        x += dir * slotW * q; lift = Math.sin(q * Math.PI) * unit * (dir > 0 ? 1.2 : 0.4);
      }
    }
    if (slot >= st.sortedFrom || done) { colour = c.goodSoft; edge = c.good; }
    const grow = S.spring(t - 0.15 - id * 0.08, 'bouncy'), h = values[id] * unit * grow;
    S.rect(x, base - h - lift, barW, h, { fill: colour, stroke: edge, lw: active && !done ? 4 : 2, r: 6 });
    S.text(String(values[id]), x + barW / 2, base - h - lift - 10, { size, weight: 700, align: 'center', alpha: grow });
  });
  if (!done && t >= INTRO) {             // a bracket under the pair being compared
    const x1 = pad + st.a * slotW + 6, x2 = pad + (st.b + 1) * slotW - 6, y = base + 16, d = ease.out(S.prog(p, 0, 0.25));
    S.poly([[x1, y], [x1, y + 10], [x2, y + 10], [x2, y]], { stroke: st.swap ? c.warn : c.fg, lw: 3, draw: d });
  }
  S.text('Comparisons ' + comparisons + '   Swaps ' + swaps, pad, H * 0.95, { size, font: 'mono', fill: c.fg2 });
}
`;

const PROJECTILE = `// A ball thrown at an angle the learner sets with a slider (S.params.angle, in degrees). Time runs the flight.
const G = 9.81, V = 22;                                   // m/s^2, m/s
function render(ctx, t) {
  const { W, H, theme: c } = S, a = (S.params.angle * Math.PI) / 180, size = S.tall ? 24 : 20;
  const vx = V * Math.cos(a), vy = V * Math.sin(a), flight = (2 * vy) / G, range = vx * flight, best = (V * V) / G;
  const ground = H * 0.8, left = W * 0.08, m = (W * 0.84) / best;                 // stage units per metre
  const at = (s) => [left + vx * s * m, ground - (vy * s - 0.5 * G * s * s) * m];
  S.clear();
  S.line(left - 20, ground, W - left + 20, ground, { stroke: c.lineStrong, lw: 3 });
  for (let d = 0; d <= best; d += 10) {
    S.line(left + d * m, ground, left + d * m, ground + 8, { stroke: c.lineStrong });
    S.text(d + ' m', left + d * m, ground + 8 + size, { size: size * 0.8, align: 'center', fill: c.fg2 });
  }
  // One clock for every angle: a throw straight up would take the whole clip.
  const s = Math.min(flight, (t / S.dur) * 1.15 * (2 * V / G)), path = [];
  for (let i = 0; i <= 60; i++) path.push(at((flight * i) / 60));
  S.poly(path, { stroke: c.line, lw: 3, dash: [4, 8] });
  S.poly(path, { stroke: c.accent, lw: 4, draw: s / flight });
  const [x, y] = at(s), landed = s >= flight;
  if (!landed) {                                                                  // velocity and its two parts
    const k = 3.2, ux = vx * k, uy = -(vy - G * s) * k;
    S.arrow(x, y, x + ux, y, { stroke: c.good, lw: 3 });
    S.arrow(x, y, x, y + uy, { stroke: c.bad, lw: 3 });
    S.arrow(x, y, x + ux, y + uy, { stroke: c.fg, lw: 3 });
  } else {
    S.line(left, ground + 44, x, ground + 44, { stroke: c.accent, lw: 4 });
    S.text(range.toFixed(1) + ' m', (left + x) / 2, ground + 44 + size * 1.3, { size: size * 1.1, weight: 800, align: 'center', fill: c.accent });
  }
  S.circle(x, y, 12, { fill: c.accent, stroke: c.surface, lw: 3 });
  S.text('Launch angle ' + S.params.angle + '°', left, H * 0.12, { size: size * 1.4, weight: 700 });
  S.text('Sideways speed never changes. Upward speed shrinks, then reverses.', left, H * 0.12 + size * 1.6, { size, fill: c.fg2, maxWidth: W * 0.84 });
}
`;

const KINETIC = `// Kinetic typography: in English, word order says who did what. "The dog bit the man" becomes
// "The man bit the dog" by swapping two phrases while the role labels stay where they are.
const phrases = ['The dog', 'bit', 'the man'], roles = ['SUBJECT', 'VERB', 'OBJECT'], notes = ['does it', 'the action', 'receives it'];
function render(ctx, t) {
  const { W, H, theme: c, ease } = S, big = S.tall ? 46 : 76, small = 20, gap = big * 0.34;
  S.clear();
  // Three slots. Each noun slot is wide enough for either noun phrase with a capital, so the swap fits.
  const widths = phrases.map((p) => S.measure(p[0].toUpperCase() + p.slice(1), { size: big, weight: 800, font: 'serif' }).width);
  const noun = Math.max(widths[0], widths[2]), slotW = [noun, widths[1], noun];
  const total = noun * 2 + widths[1] + gap * 2, x0 = (W - total) / 2, y = H * 0.5;
  const slotL = [x0, x0 + noun + gap, x0 + noun + gap + widths[1] + gap];
  const mid = slotL.map((left, i) => left + slotW[i] / 2);
  // The two noun phrases trade slots. Both travel over the verb, on arcs of different heights,
  // so they never touch.
  const swap = ease.inOut(S.prog(t, 6, 1.4)), arc = Math.sin(swap * Math.PI) * big;
  const xs = [S.lerp(mid[0], mid[2], swap), mid[1], S.lerp(mid[2], mid[0], swap)];
  const ys = [y - arc * 1.9, y, y - arc * 0.95];
  phrases.forEach((p, i) => {
    const s = S.spring(t - 0.3 - i * 0.55, 'bouncy'), fall = (1 - s) * -60;
    const hot = i !== 1 && swap > 0 && swap < 1;
    S.group({ x: xs[i], y: ys[i] + fall, scale: 0.6 + 0.4 * s, alpha: Math.min(1, s * 1.5) }, () => {
      const text = i === 0 && swap > 0.5 ? 'the dog' : i === 2 && swap > 0.5 ? 'The man' : p;   // the capital follows the position
      S.text(text, 0, 0, { size: big, weight: 800, font: 'serif', align: 'center', fill: hot ? c.accent : c.fg });
    });
  });
  // Role labels: a bracket draws on under each slot, then the label and its note fade up.
  roles.forEach((r, i) => {
    const d = S.prog(t, 2.6 + i * 0.5, 0.5, ease.out), by = y + big * 0.42, col = i === 1 ? c.muted : c.accent;
    S.poly([[slotL[i], by], [slotL[i], by + 10], [slotL[i] + slotW[i], by + 10], [slotL[i] + slotW[i], by]], { stroke: col, lw: 3, draw: d });
    S.text(r, mid[i], by + 16 + small * 1.2 + (1 - d) * 10, { size: small, weight: 800, align: 'center', fill: col, alpha: d });
    S.text(notes[i], mid[i], by + 16 + small * 2.5 + (1 - d) * 10, { size: small * 0.9, align: 'center', fill: c.fg2, alpha: d });
  });
  // The pay-off line types on.
  const line = 'Same words. New order. New meaning.', shown = Math.floor(S.prog(t, 8, 1.6) * line.length);
  S.text(line.slice(0, shown), W / 2, H * (S.tall ? 0.84 : 0.86), { size: S.tall ? 26 : 34, weight: 700, align: 'center', fill: c.fg, maxWidth: W * 0.9 });
  const kicker = S.prog(t, 0, 0.5, ease.out) * (1 - Math.sin(swap * Math.PI));
  S.text('WORD ORDER', W / 2, H * 0.14, { size: small, weight: 800, align: 'center', fill: c.muted, alpha: kicker });
  S.line(W / 2 - 40 * kicker, H * 0.14 + 12, W / 2 + 40 * kicker, H * 0.14 + 12, { stroke: c.accent, lw: 3, alpha: kicker });
}
`;

/** A sort that plays through by itself: set-up outside render, steps looked up from t. */
export const FRAME_EXAMPLE_SORT: FrameExample = {
  id: 'bubble-sort',
  title: 'Bubble sort, one comparison at a time',
  description:
    'Eight bars with the values 5, 2, 8, 3, 9, 1, 6 and 4 stand in a row. A bracket moves along the row marking two neighbours at a time; when the left bar is taller the two swap places. After each pass the tallest unsorted bar has reached the right and turns green. After 28 comparisons and 14 swaps the bars stand in order from 1 to 9.',
  stage: { kind: 'frame', code: SORT, duration: 17, aspect: '16:9', params: [], poster: 6.3, cites: ['e1'], provenance: 'worked' },
  evidence: [
    {
      url: 'https://example.org/algorithms/bubble-sort',
      title: 'Bubble sort (synthetic test source)',
      publisher: 'Example Algorithms Handbook',
      excerpt:
        'Bubble sort steps through a list again and again, compares each pair of neighbours and swaps them when the left one is larger. After every pass the largest value that was still out of place has reached its final position at the right end.',
      via: 'page',
    },
  ],
  beats: [
    { at: 0, caption: 'Eight values in no particular order.' },
    { at: 1.6, caption: 'Compare two neighbours; if the left is larger, swap them.', cites: ['e1'] },
    { at: 5.1, caption: 'After one pass the largest value has reached the right end.', cites: ['e1'] },
    { at: 15.6, caption: 'Every value is in place.' },
  ],
};

/** A slider: the learner sets the launch angle and the same clock replays the flight. */
export const FRAME_EXAMPLE_PROJECTILE: FrameExample = {
  id: 'launch-angle',
  title: 'Launch angle and range',
  description:
    'A ball is thrown at 22 metres per second along an arc. A green arrow shows its sideways speed, which stays the same; a red arrow shows its upward speed, which shrinks to zero at the top and then points down. A slider sets the launch angle: at 45 degrees the ball lands farthest, about 49 metres away, and steeper or flatter throws land closer.',
  stage: {
    kind: 'frame',
    code: PROJECTILE,
    duration: 5,
    aspect: '16:9',
    params: [{ id: 'angle', label: 'Launch angle', min: 15, max: 75, step: 1, value: 45, unit: '°' }],
    poster: 2.2,
    cites: ['e1'],
    provenance: 'worked',
  },
  evidence: [
    {
      url: 'https://example.org/physics/projectile-motion',
      title: 'Projectile motion (synthetic test source)',
      publisher: 'Example Physics Notes',
      excerpt:
        'The motion of a thrown ball splits into a sideways part and an upward part that do not affect each other. Gravity changes only the upward part: the sideways speed stays the same for the whole flight.',
      via: 'page',
    },
  ],
  beats: [
    { at: 0, caption: 'The throw splits into a sideways part and an upward part.', cites: ['e1'] },
    { at: 2, caption: 'Gravity only changes the upward part.', cites: ['e1'] },
  ],
};

/** Kinetic typography: measured text, phrases that trade places, labels that stay. */
export const FRAME_EXAMPLE_KINETIC: FrameExample = {
  id: 'word-order',
  title: 'Word order decides who did what',
  description:
    'The sentence “The dog bit the man” appears phrase by phrase. Labels appear underneath: subject (does it), verb (the action), object (receives it). Then “the dog” and “the man” swap places while the labels stay put, giving “The man bit the dog”. A final line reads: Same words. New order. New meaning.',
  stage: { kind: 'frame', code: KINETIC, duration: 10.5, aspect: '16:9', params: [], poster: 5, cites: [], provenance: 'illustrative' },
  evidence: [
    {
      url: 'https://example.org/grammar/word-order',
      title: 'Word order in English (synthetic test source)',
      publisher: 'Example Grammar Notes',
      excerpt:
        'English marks who did what by word order. In a plain sentence the first slot holds the subject, the verb follows it, and the last slot holds the object, so swapping two noun phrases changes the meaning.',
      via: 'page',
    },
  ],
  beats: [
    { at: 0, caption: 'The dog bit the man.' },
    { at: 2.6, caption: 'The first slot is the subject, the last is the object.', cites: ['e1'] },
    { at: 6, caption: 'Swap the two phrases and the roles stay with the slots.' },
    { at: 8, caption: 'Same words. New order. New meaning.' },
  ],
};

export const FRAME_EXAMPLES: readonly FrameExample[] = [FRAME_EXAMPLE_SORT, FRAME_EXAMPLE_PROJECTILE, FRAME_EXAMPLE_KINETIC];

/**
 * An example as a clip scene (src/core/clip.ts): the stage, and one beat per caption with `at` and
 * no actions. A caption that names its evidence is a `claim` with those `cites`; the others are
 * `example` blocks, the agent's own working, which need none. Checked against the example's own
 * `evidence` (stored as e1, e2, ...), the clip passes the validator with no error and no warning.
 */
export function frameExampleClip(example: FrameExample): {
  id: string;
  title: string;
  kind: 'clip';
  description: string;
  stage: FrameStage;
  beats: { caption: { type: 'claim'; text: string; cites: string[] } | { type: 'example'; text: string }; do: never[]; at: number }[];
} {
  return {
    id: example.id,
    title: example.title,
    kind: 'clip',
    description: example.description,
    stage: example.stage,
    beats: example.beats.map((b) => ({
      caption: b.cites ? { type: 'claim' as const, text: b.caption, cites: [...b.cites] } : { type: 'example' as const, text: b.caption },
      do: [],
      at: b.at,
    })),
  };
}
