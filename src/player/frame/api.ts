// What code in a custom frame can use, as data: every member of the helper library `S`, with its
// signature, one line on what it does, and a small example. The author's reference
// (plugin/skills/learning-tool/references/frame-api.md) is written from this table, and
// test/frame/api.test.ts holds the table equal to what the runtime really puts on `S`: a member
// added to runtime.ts without a line here fails the test, and so does a line here for a member
// that no longer exists. Plain data: no DOM, no Node.

export interface ApiMember {
  /** As written in code: "S.rect". */
  name: string;
  /** How it is called, or its type for a value. */
  signature: string;
  /** One line. */
  does: string;
  example: string;
}

export interface ApiGroup {
  title: string;
  /** A sentence or two above the table. */
  intro: string;
  members: ApiMember[];
}

export const FRAME_API: readonly ApiGroup[] = [
  {
    title: 'The stage and the instant',
    intro:
      'Set by the player before every call to `render`. Stage units are not pixels: the player scales the stage to the screen, so 960 units is the full width of a wide stage on a phone and on a desk monitor alike.',
    members: [
      { name: 'S.W', signature: 'number', does: 'Width of the stage in stage units: 960, 720 or 540 by aspect; 540 on the tall stage.', example: 'const pad = S.W * 0.08;' },
      { name: 'S.H', signature: 'number', does: 'Height of the stage in stage units: 540, or 675 on the tall stage.', example: 'const ground = S.H * 0.8;' },
      { name: 'S.tall', signature: 'boolean', does: 'True on the tall stage (4:5), which every frame gets in a narrow column. Use it to choose sizes and to restack.', example: 'const size = S.tall ? 26 : 22;' },
      { name: 'S.t', signature: 'number', does: 'The instant being drawn, in seconds: the same number `render` receives as `t`.', example: 'const p = S.t / S.dur;' },
      { name: 'S.dur', signature: 'number', does: "The animation's `duration` in seconds.", example: 'const left = S.dur - t;' },
      { name: 'S.params', signature: 'object', does: 'The current value of each slider, by its id. Read it inside `render`, never once at the top.', example: 'const a = S.params.angle * Math.PI / 180;' },
      { name: 'S.theme', signature: 'object', does: "The lesson's colours as '#rrggbb' strings, already right for light or dark (the roles are listed below).", example: 'S.clear(S.theme.bg);' },
      { name: 'S.ctx', signature: 'OffscreenCanvasRenderingContext2D', does: 'The same 2D context `render` receives, already scaled to stage units. For anything the helpers do not draw.', example: 'S.ctx.bezierCurveTo(x1, y1, x2, y2, x, y);' },
    ],
  },
  {
    title: 'Time',
    intro:
      'Every move is a function of `t`. These turn a time into a progress, and a progress into a value. They clamp, so a move holds its end state for the rest of the animation.',
    members: [
      { name: 'S.prog', signature: 'S.prog(t, start, dur, ease?)', does: 'Progress 0 to 1 of a move that starts at `start` and lasts `dur` seconds; 0 before, 1 after.', example: 'const d = S.prog(t, 2.5, 0.6, S.ease.out);' },
      { name: 'S.map', signature: 'S.map(x, [ins], [outs], ease?)', does: "Keyframes: `x` mapped through rising `ins` to `outs`, clamped at both ends. `outs` are numbers or '#rrggbb' colours.", example: 'const x = S.map(t, [0, 1, 3], [40, 400, 220], S.ease.inOut);' },
      { name: 'S.spring', signature: 'S.spring(seconds, preset?)', does: "A spring from 0 to 1, by the seconds since it was released (0 before). Presets: 'gentle', 'snappy', 'bouncy', 'stiff'; or `{ stiffness, damping, mass }`.", example: "const grow = S.spring(t - 0.2 - i * 0.08, 'bouncy');" },
      { name: 'S.ease', signature: 'object of functions', does: 'Easing curves, each from progress 0..1 to eased progress: `linear`, `out`, `in`, `inOut`, `outQuart`, `outExpo`, `inExpo`, `inOutQuart`, `outBack`, `inBack`.', example: 'const q = S.ease.inOut(S.prog(t, 6, 1.4));' },
      { name: 'S.bezier', signature: 'S.bezier(x1, y1, x2, y2)', does: 'An easing function from a CSS cubic-bezier, when none of the named ones fits.', example: 'const soft = S.bezier(0.45, 0, 0.55, 1);' },
      { name: 'S.clamp', signature: 'S.clamp(x, lo, hi)', does: '`x` held between `lo` and `hi`.', example: 'const k = S.clamp(Math.floor(t / 0.5), 0, steps.length - 1);' },
      { name: 'S.lerp', signature: 'S.lerp(a, b, k)', does: 'The value `k` of the way from `a` to `b`.', example: 'const x = S.lerp(x0, x1, S.ease.out(p));' },
      { name: 'S.rand', signature: 'S.rand(seed)', does: 'A stable pseudo-random number in [0, 1) for a seed: the same in every frame, so nothing flickers.', example: 'const jitter = S.rand(i) * 12;' },
    ],
  },
  {
    title: 'Colour',
    intro: "Take every colour from `S.theme`, so the frame follows the lesson in light and dark. These two derive a colour from theme colours.",
    members: [
      { name: 'S.mix', signature: 'S.mix(a, b, k)', does: "The colour `k` of the way from `a` to `b`, as '#rrggbb'.", example: 'const fill = S.mix(S.theme.accentSoft, S.theme.goodSoft, done);' },
      { name: 'S.alpha', signature: 'S.alpha(colour, a)', does: 'A colour with opacity `a` (0 to 1), as an rgba() string.', example: 'ctx.fillStyle = S.alpha(S.theme.accent, 0.25);' },
    ],
  },
  {
    title: 'Drawing',
    intro:
      'Each helper saves and restores the context, so nothing it sets leaks into the next call. The last argument is an options object. Shapes take `{ fill, stroke, lw, alpha, dash, cap }` (`lw` is the line width, default 2; `dash` is a pattern such as `[4, 8]`); a shape with neither `fill` nor `stroke` draws nothing, except lines, which default to `S.theme.fg`.',
    members: [
      { name: 'S.clear', signature: 'S.clear(colour?)', does: 'Fill the whole stage: with `S.theme.bg`, or the colour given. Call it first in `render`.', example: 'S.clear();' },
      { name: 'S.rect', signature: 'S.rect(x, y, w, h, { r, ...shape })', does: 'A rectangle from its top-left corner; `r` rounds the corners.', example: 'S.rect(x, base - h, 48, h, { fill: c.accentSoft, stroke: c.accent, r: 6 });' },
      { name: 'S.circle', signature: 'S.circle(x, y, radius, { ...shape })', does: 'A circle from its centre.', example: 'S.circle(x, y, 12, { fill: c.accent, stroke: c.surface, lw: 3 });' },
      { name: 'S.line', signature: 'S.line(x1, y1, x2, y2, { draw, ...shape })', does: 'A straight line. `draw` (0 to 1) draws only that share of its length.', example: 'S.line(pad, base, S.W - pad, base, { stroke: c.lineStrong });' },
      { name: 'S.poly', signature: 'S.poly([[x, y], ...], { draw, close, ...shape })', does: 'A line through points. `draw` (0 to 1) draws it on from its start; `close` joins the end to the start; with `fill` it is a filled shape.', example: 'S.poly(path, { stroke: c.accent, lw: 4, draw: S.prog(t, 1, 2) });' },
      { name: 'S.arrow', signature: 'S.arrow(x1, y1, x2, y2, { head, draw, ...shape })', does: 'A line with an arrowhead at its end; `head` is the head length (default 12). `draw` grows it from its tail.', example: 'S.arrow(x, y, x + vx * 3, y, { stroke: c.good, lw: 3 });' },
      { name: 'S.text', signature: 'S.text(string, x, y, { size, weight, font, fill, align, baseline, alpha, maxWidth, lineHeight, italic })', does: "Text at a baseline point, wrapped at `maxWidth`. `size` is in stage units (default 24), `weight` 100 to 900 (default 500), `font` 'sans', 'serif' or 'mono', `align` 'left', 'center' or 'right'. Returns `{ width, height, lines, lineHeight }`.", example: "S.text('Bubble sort', pad, S.H * 0.12, { size: 33, weight: 700 });" },
      { name: 'S.measure', signature: 'S.measure(string, { ...text options })', does: 'What `S.text` would return, without drawing: use it to lay text out before placing it.', example: "const w = S.measure('The dog', { size: 76, weight: 800, font: 'serif' }).width;" },
      { name: 'S.group', signature: 'S.group({ x, y, scale, rotate, alpha }, () => { ... })', does: 'Draw everything inside the function moved to (x, y), scaled, turned (radians) and faded as one unit.', example: "S.group({ x: cx, y: cy, scale: 0.6 + 0.4 * s, alpha: s }, () => S.text('bit', 0, 0, { align: 'center' }));" },
    ],
  },
];

/** The colour roles of `S.theme`, in the order they are documented, with what each is for. */
export const THEME_ROLES: readonly (readonly [string, string])[] = [
  ['bg', 'The page behind the stage. What `S.clear()` fills with.'],
  ['surface', 'A raised panel or card on the stage.'],
  ['sunken', 'A recessed area, a track, an empty slot.'],
  ['fg', 'Primary text and the main strokes.'],
  ['fg2', 'Secondary text: a subtitle, an axis label.'],
  ['muted', 'Tertiary text, and whatever is set aside.'],
  ['line', 'A hairline that only decorates: a guide, a dashed ghost path.'],
  ['lineStrong', 'A line that carries meaning: an axis, a baseline, a connector.'],
  ['accent', 'The thing being talked about: one accent per frame.'],
  ['accentInk', 'Text on top of an accent fill.'],
  ['accentSoft', 'A pale accent fill, behind accent strokes or text.'],
  ['good', 'A good outcome, done, sorted. Pair with `goodSoft` as the fill.'],
  ['goodSoft', 'The pale fill for `good`.'],
  ['bad', 'A bad outcome, an error, a loss.'],
  ['badSoft', 'The pale fill for `bad`.'],
  ['warn', 'Attention: the pair being compared, a value about to change.'],
  ['warnSoft', 'The pale fill for `warn`.'],
  ['mark', 'A highlighter behind what is being pointed at.'],
  ['scheme', "Not a colour: 'light' or 'dark'."],
];

/** The easing curves on `S.ease`, in the order they are documented. */
export const EASE_NAMES = ['linear', 'out', 'in', 'inOut', 'outQuart', 'outExpo', 'inExpo', 'inOutQuart', 'outBack', 'inBack'] as const;
/** The presets `S.spring` knows. */
export const SPRING_PRESETS = ['gentle', 'snappy', 'bouncy', 'stiff'] as const;

/** JavaScript's own globals that are left in a frame. Everything else a worker has is removed before the code runs. */
export const KEPT_GLOBALS =
  'Object, Function, Array, Number, Boolean, String, Symbol, BigInt, Math, JSON, Date, RegExp, Map, Set, WeakMap, WeakSet, Promise, Proxy, Reflect, Intl, the Error types, ArrayBuffer, DataView and the typed arrays, parseInt, parseFloat, isFinite, isNaN, and of the canvas: OffscreenCanvas (2D only), Path2D, ImageData, DOMMatrix, DOMPoint';
