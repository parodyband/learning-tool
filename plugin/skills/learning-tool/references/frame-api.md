# Custom frame: what the code can use

A clip's stage is normally one of the typed kinds (sequence, cells, dots, chart, flow, words, lines,
timeline): you say what is on stage and what happens, and the engine draws it. A stage of kind
`frame` is the escape hatch for a picture none of them can draw: you write the drawing code yourself.
Use it rarely. The learner is told, on the stage, that the animation was written by you and is not
checked: "This animation was written by your agent and is not checked by Learning Tool."

This page is everything the code can use. Nothing else exists inside a frame.

## The contract

`code` is the **body of a function**. Put set-up at the top, then declare the entry point exactly
like this, at the top level:

```js
// set-up: runs once. Compute tables, steps and constants here.
const values = [5, 2, 8, 3];

function render(ctx, t) {
  // draws ONE picture: the animation at t seconds. Called for any t from 0 to duration, in any order.
  S.clear();
  S.text('t = ' + t.toFixed(1), S.W / 2, S.H / 2, { align: 'center', size: 48 });
}
```

- `ctx` is a 2D canvas context, already scaled so that you draw in stage units.
- `t` is the time in seconds. The player owns the clock: play, pause, scrub, speed and replay all
  just ask for a `t`.
- `S` is the helper library below. It is the only name the code is given.
- **A frame is a pure function of `t`.** The same `t` must give the same picture whatever was drawn
  before. Do not count frames, accumulate positions or keep a "current state" between calls: work
  everything out from `t`. The learner scrubs backwards, a still is taken at any instant, and the
  worker may be replaced by a fresh one in the middle of playback; a pure frame survives all three
  unseen.
- `render` must return quickly and synchronously. Nothing is drawn after it returns.

## The stage data

```
stage: { kind: "frame", code, duration, poster, aspect?, params?, cites?, provenance }
```

| Field | What it is |
|---|---|
| `code` | The function body, as one JSON string. At most 24 KB (the examples are 2 to 4 KB) and no line over 400 characters: write it to be read, never minified. |
| `duration` | Length in seconds, 2 to 120. |
| `poster` | A time between 0 and `duration`: the still that stands for the animation before Play is pressed, under reduced motion and on paper. Choose the instant that shows the idea. It is rarely 0, where nothing has arrived yet. |
| `aspect` | `"16:9"`, `"4:3"`, `"1:1"`. The shape of the stage where there is room. |
| `params` | 0 to 3 sliders (below). |
| `cites` | The evidence ids the content comes from. Required when `provenance` is `"sourced"` or `"worked"`: a worked example cites the passage whose rule it applies. |
| `provenance` | `"sourced"`, `"worked"` (your worked example) or `"illustrative"` (the shape is the point, not the numbers). |

The clip around the stage carries the `description`: say in words everything the animation shows. It
is what a screen reader gets, what shows with scripting off, and what prints beside the still. A beat
of a frame clip is a caption and `at` (seconds into the animation, the first at 0, rising, all less
than `duration`) and has no actions. Captions are ordinary cited lesson text. Text you draw on the
canvas is a picture of text: it cannot be selected, translated or read aloud, and nothing checks it.
Keep drawn text to labels and numbers, and say the sentences in captions.

## Layout: stage units, and two shapes

You never see pixels. The stage is a fixed number of units and the player scales it to the screen,
sharp at any size.

| `aspect` | `S.W` x `S.H` | `S.tall` |
|---|---|---|
| `"16:9"` (default) | 960 x 540 | false |
| `"4:3"` | 720 x 540 | false |
| `"1:1"` | 540 x 540 | false |
| any, in a column under 640 px | 540 x 675 | true |

**Every frame is shown in both shapes**: wide on a desk, tall on a phone. So never write a fixed
coordinate. Lay everything out from `S.W` and `S.H` (`const pad = S.W * 0.08`), branch on `S.tall`
for sizes and for stacking, and keep text at 18 units or more. You cannot see what you drew, so be
conservative: generous margins, few elements, nothing near an edge.

## The helper library S

### The stage and the instant

Set by the player before every call to `render`. Stage units are not pixels: the player scales the stage to the screen, so 960 units is the full width of a wide stage on a phone and on a desk monitor alike.

| Member | What it does | Example |
|---|---|---|
| `S.W` (number) | Width of the stage in stage units: 960, 720 or 540 by aspect; 540 on the tall stage. | `const pad = S.W * 0.08;` |
| `S.H` (number) | Height of the stage in stage units: 540, or 675 on the tall stage. | `const ground = S.H * 0.8;` |
| `S.tall` (boolean) | True on the tall stage (4:5), which every frame gets in a narrow column. Use it to choose sizes and to restack. | `const size = S.tall ? 26 : 22;` |
| `S.t` (number) | The instant being drawn, in seconds: the same number `render` receives as `t`. | `const p = S.t / S.dur;` |
| `S.dur` (number) | The animation's `duration` in seconds. | `const left = S.dur - t;` |
| `S.params` (object) | The current value of each slider, by its id. Read it inside `render`, never once at the top. | `const a = S.params.angle * Math.PI / 180;` |
| `S.theme` (object) | The lesson's colours as '#rrggbb' strings, already right for light or dark (the roles are listed below). | `S.clear(S.theme.bg);` |
| `S.ctx` (OffscreenCanvasRenderingContext2D) | The same 2D context `render` receives, already scaled to stage units. For anything the helpers do not draw. | `S.ctx.bezierCurveTo(x1, y1, x2, y2, x, y);` |

### Time

Every move is a function of `t`. These turn a time into a progress, and a progress into a value. They clamp, so a move holds its end state for the rest of the animation.

| Member | What it does | Example |
|---|---|---|
| `S.prog(t, start, dur, ease?)` | Progress 0 to 1 of a move that starts at `start` and lasts `dur` seconds; 0 before, 1 after. | `const d = S.prog(t, 2.5, 0.6, S.ease.out);` |
| `S.map(x, [ins], [outs], ease?)` | Keyframes: `x` mapped through rising `ins` to `outs`, clamped at both ends. `outs` are numbers or '#rrggbb' colours. | `const x = S.map(t, [0, 1, 3], [40, 400, 220], S.ease.inOut);` |
| `S.spring(seconds, preset?)` | A spring from 0 to 1, by the seconds since it was released (0 before). Presets: 'gentle', 'snappy', 'bouncy', 'stiff'; or `{ stiffness, damping, mass }`. | `const grow = S.spring(t - 0.2 - i * 0.08, 'bouncy');` |
| `S.ease` (object of functions) | Easing curves, each from progress 0..1 to eased progress: `linear`, `out`, `in`, `inOut`, `outQuart`, `outExpo`, `inExpo`, `inOutQuart`, `outBack`, `inBack`. | `const q = S.ease.inOut(S.prog(t, 6, 1.4));` |
| `S.bezier(x1, y1, x2, y2)` | An easing function from a CSS cubic-bezier, when none of the named ones fits. | `const soft = S.bezier(0.45, 0, 0.55, 1);` |
| `S.clamp(x, lo, hi)` | `x` held between `lo` and `hi`. | `const k = S.clamp(Math.floor(t / 0.5), 0, steps.length - 1);` |
| `S.lerp(a, b, k)` | The value `k` of the way from `a` to `b`. | `const x = S.lerp(x0, x1, S.ease.out(p));` |
| `S.rand(seed)` | A stable pseudo-random number in [0, 1) for a seed: the same in every frame, so nothing flickers. | `const jitter = S.rand(i) * 12;` |

### Colour

Take every colour from `S.theme`, so the frame follows the lesson in light and dark. These two derive a colour from theme colours.

| Member | What it does | Example |
|---|---|---|
| `S.mix(a, b, k)` | The colour `k` of the way from `a` to `b`, as '#rrggbb'. | `const fill = S.mix(S.theme.accentSoft, S.theme.goodSoft, done);` |
| `S.alpha(colour, a)` | A colour with opacity `a` (0 to 1), as an rgba() string. | `ctx.fillStyle = S.alpha(S.theme.accent, 0.25);` |

### Drawing

Each helper saves and restores the context, so nothing it sets leaks into the next call. The last argument is an options object. Shapes take `{ fill, stroke, lw, alpha, dash, cap }` (`lw` is the line width, default 2; `dash` is a pattern such as `[4, 8]`); a shape with neither `fill` nor `stroke` draws nothing, except lines, which default to `S.theme.fg`.

| Member | What it does | Example |
|---|---|---|
| `S.clear(colour?)` | Fill the whole stage: with `S.theme.bg`, or the colour given. Call it first in `render`. | `S.clear();` |
| `S.rect(x, y, w, h, { r, ...shape })` | A rectangle from its top-left corner; `r` rounds the corners. | `S.rect(x, base - h, 48, h, { fill: c.accentSoft, stroke: c.accent, r: 6 });` |
| `S.circle(x, y, radius, { ...shape })` | A circle from its centre. | `S.circle(x, y, 12, { fill: c.accent, stroke: c.surface, lw: 3 });` |
| `S.line(x1, y1, x2, y2, { draw, ...shape })` | A straight line. `draw` (0 to 1) draws only that share of its length. | `S.line(pad, base, S.W - pad, base, { stroke: c.lineStrong });` |
| `S.poly([[x, y], ...], { draw, close, ...shape })` | A line through points. `draw` (0 to 1) draws it on from its start; `close` joins the end to the start; with `fill` it is a filled shape. | `S.poly(path, { stroke: c.accent, lw: 4, draw: S.prog(t, 1, 2) });` |
| `S.arrow(x1, y1, x2, y2, { head, draw, ...shape })` | A line with an arrowhead at its end; `head` is the head length (default 12). `draw` grows it from its tail. | `S.arrow(x, y, x + vx * 3, y, { stroke: c.good, lw: 3 });` |
| `S.text(string, x, y, { size, weight, font, fill, align, baseline, alpha, maxWidth, lineHeight, italic })` | Text at a baseline point, wrapped at `maxWidth`. `size` is in stage units (default 24), `weight` 100 to 900 (default 500), `font` 'sans', 'serif' or 'mono', `align` 'left', 'center' or 'right'. Returns `{ width, height, lines, lineHeight }`. | `S.text('Bubble sort', pad, S.H * 0.12, { size: 33, weight: 700 });` |
| `S.measure(string, { ...text options })` | What `S.text` would return, without drawing: use it to lay text out before placing it. | `const w = S.measure('The dog', { size: 76, weight: 800, font: 'serif' }).width;` |
| `S.group({ x, y, scale, rotate, alpha }, () => { ... })` | Draw everything inside the function moved to (x, y), scaled, turned (radians) and faded as one unit. | `S.group({ x: cx, y: cy, scale: 0.6 + 0.4 * s, alpha: s }, () => S.text('bit', 0, 0, { align: 'center' }));` |

Anything the helpers do not cover is plain Canvas 2D on `ctx`: paths, gradients, `clip`,
`drawImage` from an `OffscreenCanvas` you made, `getImageData`. Wrap raw drawing in
`ctx.save()` and `ctx.restore()`. The context is reset before every frame, so nothing you set
carries over. Do not change the size of `ctx.canvas`: the player sizes it.

### Colour roles

Every colour comes from `S.theme`, so the frame matches the lesson in light and in dark. Never write
a hex colour of your own. State is never colour alone: pair it with a label, a mark or a thicker line.

| `S.theme.` | Use it for |
|---|---|
| `bg` | The page behind the stage. What `S.clear()` fills with. |
| `surface` | A raised panel or card on the stage. |
| `sunken` | A recessed area, a track, an empty slot. |
| `fg` | Primary text and the main strokes. |
| `fg2` | Secondary text: a subtitle, an axis label. |
| `muted` | Tertiary text, and whatever is set aside. |
| `line` | A hairline that only decorates: a guide, a dashed ghost path. |
| `lineStrong` | A line that carries meaning: an axis, a baseline, a connector. |
| `accent` | The thing being talked about: one accent per frame. |
| `accentInk` | Text on top of an accent fill. |
| `accentSoft` | A pale accent fill, behind accent strokes or text. |
| `good` | A good outcome, done, sorted. Pair with `goodSoft` as the fill. |
| `goodSoft` | The pale fill for `good`. |
| `bad` | A bad outcome, an error, a loss. |
| `badSoft` | The pale fill for `bad`. |
| `warn` | Attention: the pair being compared, a value about to change. |
| `warnSoft` | The pale fill for `warn`. |
| `mark` | A highlighter behind what is being pointed at. |
| `scheme` | Not a colour: 'light' or 'dark'. |

Easings on `S.ease`: `linear`, `out`, `in`, `inOut`, `outQuart`, `outExpo`, `inExpo`, `inOutQuart`, `outBack`, `inBack`. Arrive with `out` or
`outExpo`, leave with `in`, reposition with `inOut`. Spring presets: `'gentle'`, `'snappy'`, `'bouncy'`, `'stiff'`.

## Sliders

```
{ "id": "angle", "label": "Launch angle", "min": 15, "max": 75, "step": 1, "value": 45, "unit": "°" }
```

The player draws each slider under the stage; the code reads its value as `S.params.angle`, inside
`render`. Moving a slider redraws the instant on show; it does not restart the clock. `id` is a
plain identifier (a lowercase letter, then letters and digits). `min` is less than `max`, `value`
lies between them, and `step` divides the range into at most 1000 steps. `label` is at most
40 characters and `unit` at most 8. The code may read only sliders that exist, and a
slider the code never reads is reported. The poster still is drawn with each slider at its `value`.

## What is not there

The code runs sealed off from the lesson page, the learner's files and the network, in a worker that
has nothing but the language and a canvas. These are refused when you publish, with a message naming
the line, because they cannot work:

- **No network and no imports**: no `fetch`, `XMLHttpRequest`, `WebSocket`, `import`, `importScripts`.
  Put data in the code as literals.
- **No page**: no `window`, `document`, `navigator`, `self`, `globalThis`, `console`, storage, images or
  audio. There is nothing to click: sliders are the only input.
- **No clocks and no timers**: no `setTimeout`, `setInterval`, `requestAnimationFrame`,
  `Date.now()`, `new Date()`, `performance.now()`. Time is `t`.
- **No promises**: no `async`, `await`, `.then`. `render` is synchronous.
- **No code from strings**: no `eval`, `new Function`, `.constructor`.
- **No loop without an end**: no `while (true)`, no `for (;;)`.
- **Only the 2D context**: no WebGL, no WebGPU.
- No control or text-direction characters in the source, and no `debugger`.

`Math.random()` exists but is reseeded before every frame, so it gives the same sequence each time;
use `S.rand(i)` for a stable value per item. What is left of the language: Object, Function, Array, Number, Boolean, String, Symbol, BigInt, Math, JSON, Date, RegExp, Map, Set, WeakMap, WeakSet, Promise, Proxy, Reflect, Intl, the Error types, ArrayBuffer, DataView and the typed arrays, parseInt, parseFloat, isFinite, isNaN, and of the canvas: OffscreenCanvas (2D only), Path2D, ImageData, DOMMatrix, DOMPoint.

## What happens when it runs

- The code does not run until the stage is on screen. Then the poster still is drawn. Nothing plays
  until the learner presses Play.
- The player gives the code 3 s for its set-up and 1.5 s for each frame. Code that misses
  either, throws, or allocates without limit is stopped, and the learner sees the description, a
  plain message and "Try again". Aim for a few milliseconds a frame: precompute in the
  set-up, and keep per-pixel loops small.
- Buffers, typed arrays, image data and extra canvases are budgeted: 256 MB in the life of one
  worker, and a canvas is at most 4096 pixels a side. Make big buffers once, in the set-up, not
  in `render`.
- Frames that keep taking more than 80 ms are drawn with fewer pixels rather than stuttering.
- With reduced motion the clip is a set of stills: the poster, then the end of each beat. On paper
  the picture as it stood is printed with the description. Because a frame is a pure function of `t`,
  you write nothing for either.

## A complete example

A ball thrown at an angle the learner sets with a slider. One clock runs every angle; the velocity is
drawn as two arrows; when the ball lands the range is labelled. The code:

```js
// A ball thrown at an angle the learner sets with a slider (S.params.angle, in degrees). Time runs the flight.
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
```

And the clip that carries it. Like every clip, it has a caption that is a `claim` or a `quote` citing
stored evidence (here `e1`, a passage on projectile motion the lesson stored), and its stage, a
worked example, cites the passage whose rule it applies:

```
{
  "id": "launch-angle",
  "title": "Launch angle and range",
  "kind": "clip",
  "description": "A ball is thrown at 22 metres per second along an arc. A green arrow shows its sideways speed, which stays the same; a red arrow shows its upward speed, which shrinks to zero at the top and then points down. A slider sets the launch angle: at 45 degrees the ball lands farthest, about 49 metres away, and steeper or flatter throws land closer.",
  "stage": {
    "kind": "frame",
    "code": "// A ball thrown at an angle the learner sets with a slider (S.params.angle, in degrees). Time runs the flight.\n… the code above, as one string …",
    "duration": 5,
    "aspect": "16:9",
    "params": [
      {
        "id": "angle",
        "label": "Launch angle",
        "min": 15,
        "max": 75,
        "step": 1,
        "value": 45,
        "unit": "°"
      }
    ],
    "poster": 2.2,
    "cites": [
      "e1"
    ],
    "provenance": "worked"
  },
  "beats": [
    {
      "caption": {
        "type": "claim",
        "text": "The throw splits into a sideways part and an upward part.",
        "cites": [
          "e1"
        ]
      },
      "do": [],
      "at": 0
    },
    {
      "caption": {
        "type": "claim",
        "text": "Gravity only changes the upward part.",
        "cites": [
          "e1"
        ]
      },
      "do": [],
      "at": 2
    }
  ]
}
```

## Before you publish

1. Is `render` declared at the top level as `function render(ctx, t)`, and is everything it draws
   worked out from `t`?
2. Does every position come from `S.W` and `S.H`, with a branch on `S.tall` where the tall stage
   needs it? Would it be legible 320 px wide?
3. Does every colour come from `S.theme`?
4. Does every move end? When the idea has landed the picture should be still: nothing loops or
   drifts while the learner reads.
5. Does the poster time show the idea, and does the clip's `description` say in words everything
   the animation shows?
6. Is every sentence the learner needs in a caption, with drawn text kept to labels and numbers?
