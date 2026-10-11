// Writes plugin/skills/learning-tool/references/frame-api.md: what an author needs to write a
// custom frame. The whole file is derived, so it cannot drift from the code:
//   - the members of S, the colour roles, the easings and the presets from src/player/frame/api.ts
//     (which test/frame/api.test.ts holds equal to the runtime),
//   - the limits from src/core/frame.ts and the watchdog's numbers from src/player/frame/shared.ts,
//   - the worked example from src/core/frame-examples.ts (which test/frame/examples.test.ts runs).
//
// After changing any of those, rewrite the file with
//   UPDATE_FRAME_API=1 npx vitest run test/frame/api.test.ts
import { FRAME_ASPECTS, FRAME_LIMITS, FRAME_NARROW_BELOW, FRAME_STAGE_UNITS } from '../../src/core/frame';
import { FRAME_EXAMPLE_PROJECTILE, frameExampleClip } from '../../src/core/frame-examples';
import { EASE_NAMES, FRAME_API, KEPT_GLOBALS, SPRING_PRESETS, THEME_ROLES } from '../../src/player/frame/api';
import { FRAME_TEXT, MAX_SIDE, WATCHDOG } from '../../src/player/frame/shared';

const L = FRAME_LIMITS;
const kb = (bytes: number): string => `${Math.round(bytes / 1024)} KB`;
const seconds = (ms: number): string => `${ms / 1000} s`;
const cell = (s: string): string => s.replace(/\|/g, '\\|');

function apiTables(): string {
  return FRAME_API.map((group) => {
    // A function is shown by how it is called; a value by its name and what kind of thing it is.
    const rows = group.members.map((m) => `| ${m.signature.startsWith('S.') ? `\`${cell(m.signature)}\`` : `\`${m.name}\` (${cell(m.signature)})`} | ${cell(m.does)} | \`${cell(m.example)}\` |`);
    return [`### ${group.title}`, '', group.intro, '', '| Member | What it does | Example |', '|---|---|---|', ...rows].join('\n');
  }).join('\n\n');
}

function unitsTable(): string {
  const rows = FRAME_ASPECTS.map((a) => `| \`"${a}"\`${a === '16:9' ? ' (default)' : ''} | ${FRAME_STAGE_UNITS[a].w} x ${FRAME_STAGE_UNITS[a].h} | false |`);
  rows.push(`| any, in a column under ${FRAME_NARROW_BELOW} px | ${FRAME_STAGE_UNITS.tall.w} x ${FRAME_STAGE_UNITS.tall.h} | true |`);
  return ['| `aspect` | `S.W` x `S.H` | `S.tall` |', '|---|---|---|', ...rows].join('\n');
}

export function frameApiMarkdown(): string {
  const example = FRAME_EXAMPLE_PROJECTILE;
  const clip = frameExampleClip(example);
  const firstLine = example.stage.code.split('\n')[0] ?? '';
  const shown = { ...clip, stage: { ...clip.stage, code: `${firstLine}\\n… the code above, as one string …` } };
  const json = JSON.stringify(shown, null, 2).replace('\\\\n…', '\\n…');

  return `# Custom frame: what the code can use

A clip's stage is normally one of the typed kinds (sequence, cells, dots, chart, flow, words, lines,
timeline): you say what is on stage and what happens, and the engine draws it. A stage of kind
\`frame\` is the escape hatch for a picture none of them can draw: you write the drawing code yourself.
Use it rarely. The learner is told, on the stage, that the animation was written by you and is not
checked: "${FRAME_TEXT.label}"

This page is everything the code can use. Nothing else exists inside a frame.

## The contract

\`code\` is the **body of a function**. Put set-up at the top, then declare the entry point exactly
like this, at the top level:

\`\`\`js
// set-up: runs once. Compute tables, steps and constants here.
const values = [5, 2, 8, 3];

function render(ctx, t) {
  // draws ONE picture: the animation at t seconds. Called for any t from 0 to duration, in any order.
  S.clear();
  S.text('t = ' + t.toFixed(1), S.W / 2, S.H / 2, { align: 'center', size: 48 });
}
\`\`\`

- \`ctx\` is a 2D canvas context, already scaled so that you draw in stage units.
- \`t\` is the time in seconds. The player owns the clock: play, pause, scrub, speed and replay all
  just ask for a \`t\`.
- \`S\` is the helper library below. It is the only name the code is given.
- **A frame is a pure function of \`t\`.** The same \`t\` must give the same picture whatever was drawn
  before. Do not count frames, accumulate positions or keep a "current state" between calls: work
  everything out from \`t\`. The learner scrubs backwards, a still is taken at any instant, and the
  worker may be replaced by a fresh one in the middle of playback; a pure frame survives all three
  unseen.
- \`render\` must return quickly and synchronously. Nothing is drawn after it returns.

## The stage data

\`\`\`
stage: { kind: "frame", code, duration, poster, aspect?, params?, cites?, provenance }
\`\`\`

| Field | What it is |
|---|---|
| \`code\` | The function body, as one JSON string. At most ${kb(L.codeBytes)} (the examples are 2 to 4 KB) and no line over ${L.lineChars} characters: write it to be read, never minified. |
| \`duration\` | Length in seconds, ${L.duration.min} to ${L.duration.max}. |
| \`poster\` | A time between 0 and \`duration\`: the still that stands for the animation before Play is pressed, under reduced motion and on paper. Choose the instant that shows the idea. It is rarely 0, where nothing has arrived yet. |
| \`aspect\` | ${FRAME_ASPECTS.map((a) => `\`"${a}"\``).join(', ')}. The shape of the stage where there is room. |
| \`params\` | 0 to ${L.params} sliders (below). |
| \`cites\` | The evidence ids the content comes from. Required when \`provenance\` is \`"sourced"\` or \`"worked"\`: a worked example cites the passage whose rule it applies. |
| \`provenance\` | \`"sourced"\`, \`"worked"\` (your worked example) or \`"illustrative"\` (the shape is the point, not the numbers). |

The clip around the stage carries the \`description\`: say in words everything the animation shows. It
is what a screen reader gets, what shows with scripting off, and what prints beside the still. A beat
of a frame clip is a caption and \`at\` (seconds into the animation, the first at 0, rising, all less
than \`duration\`) and has no actions. Captions are ordinary cited lesson text. Text you draw on the
canvas is a picture of text: it cannot be selected, translated or read aloud, and nothing checks it.
Keep drawn text to labels and numbers, and say the sentences in captions.

## Layout: stage units, and two shapes

You never see pixels. The stage is a fixed number of units and the player scales it to the screen,
sharp at any size.

${unitsTable()}

**Every frame is shown in both shapes**: wide on a desk, tall on a phone. So never write a fixed
coordinate. Lay everything out from \`S.W\` and \`S.H\` (\`const pad = S.W * 0.08\`), branch on \`S.tall\`
for sizes and for stacking, and keep text at 18 units or more. You cannot see what you drew, so be
conservative: generous margins, few elements, nothing near an edge.

## The helper library S

${apiTables()}

Anything the helpers do not cover is plain Canvas 2D on \`ctx\`: paths, gradients, \`clip\`,
\`drawImage\` from an \`OffscreenCanvas\` you made, \`getImageData\`. Wrap raw drawing in
\`ctx.save()\` and \`ctx.restore()\`. The context is reset before every frame, so nothing you set
carries over. Do not change the size of \`ctx.canvas\`: the player sizes it.

### Colour roles

Every colour comes from \`S.theme\`, so the frame matches the lesson in light and in dark. Never write
a hex colour of your own. State is never colour alone: pair it with a label, a mark or a thicker line.

| \`S.theme.\` | Use it for |
|---|---|
${THEME_ROLES.map(([name, use]) => `| \`${name}\` | ${cell(use)} |`).join('\n')}

Easings on \`S.ease\`: ${EASE_NAMES.map((n) => `\`${n}\``).join(', ')}. Arrive with \`out\` or
\`outExpo\`, leave with \`in\`, reposition with \`inOut\`. Spring presets: ${SPRING_PRESETS.map((n) => `\`'${n}'\``).join(', ')}.

## Sliders

\`\`\`
${JSON.stringify(example.stage.params[0]).replace(/([{,])"/g, '$1 "').replace(/":/g, '": ').replace(/}$/, ' }')}
\`\`\`

The player draws each slider under the stage; the code reads its value as \`S.params.angle\`, inside
\`render\`. Moving a slider redraws the instant on show; it does not restart the clock. \`id\` is a
plain identifier (a lowercase letter, then letters and digits). \`min\` is less than \`max\`, \`value\`
lies between them, and \`step\` divides the range into at most ${L.paramSteps} steps. \`label\` is at most
${L.paramLabelChars} characters and \`unit\` at most ${L.paramUnitChars}. The code may read only sliders that exist, and a
slider the code never reads is reported. The poster still is drawn with each slider at its \`value\`.

## What is not there

The code runs sealed off from the lesson page, the learner's files and the network, in a worker that
has nothing but the language and a canvas. These are refused when you publish, with a message naming
the line, because they cannot work:

- **No network and no imports**: no \`fetch\`, \`XMLHttpRequest\`, \`WebSocket\`, \`import\`, \`importScripts\`.
  Put data in the code as literals.
- **No page**: no \`window\`, \`document\`, \`navigator\`, \`self\`, \`globalThis\`, \`console\`, storage, images or
  audio. There is nothing to click: sliders are the only input.
- **No clocks and no timers**: no \`setTimeout\`, \`setInterval\`, \`requestAnimationFrame\`,
  \`Date.now()\`, \`new Date()\`, \`performance.now()\`. Time is \`t\`.
- **No promises**: no \`async\`, \`await\`, \`.then\`. \`render\` is synchronous.
- **No code from strings**: no \`eval\`, \`new Function\`, \`.constructor\`.
- **No loop without an end**: no \`while (true)\`, no \`for (;;)\`.
- **Only the 2D context**: no WebGL, no WebGPU.
- No control or text-direction characters in the source, and no \`debugger\`.

\`Math.random()\` exists but is reseeded before every frame, so it gives the same sequence each time;
use \`S.rand(i)\` for a stable value per item. What is left of the language: ${KEPT_GLOBALS}.

## What happens when it runs

- The code does not run until the stage is on screen. Then the poster still is drawn. Nothing plays
  until the learner presses Play.
- The player gives the code ${seconds(WATCHDOG.bootMs)} for its set-up and ${seconds(WATCHDOG.frameMs)} for each frame. Code that misses
  either, throws, or allocates without limit is stopped, and the learner sees the description, a
  plain message and "${FRAME_TEXT.retry}". Aim for a few milliseconds a frame: precompute in the
  set-up, and keep per-pixel loops small.
- Buffers, typed arrays, image data and extra canvases are budgeted: 256 MB in the life of one
  worker, and a canvas is at most ${MAX_SIDE} pixels a side. Make big buffers once, in the set-up, not
  in \`render\`.
- Frames that keep taking more than ${WATCHDOG.slowMs} ms are drawn with fewer pixels rather than stuttering.
- With reduced motion the clip is a set of stills: the poster, then the end of each beat. On paper
  the picture as it stood is printed with the description. Because a frame is a pure function of \`t\`,
  you write nothing for either.

## A complete example

A ball thrown at an angle the learner sets with a slider. One clock runs every angle; the velocity is
drawn as two arrows; when the ball lands the range is labelled. The code:

\`\`\`js
${example.stage.code.trimEnd()}
\`\`\`

And the clip that carries it. Like every clip, it has a caption that is a \`claim\` or a \`quote\` citing
stored evidence (here \`e1\`, a passage on projectile motion the lesson stored), and its stage, a
worked example, cites the passage whose rule it applies:

\`\`\`
${json}
\`\`\`

## Before you publish

1. Is \`render\` declared at the top level as \`function render(ctx, t)\`, and is everything it draws
   worked out from \`t\`?
2. Does every position come from \`S.W\` and \`S.H\`, with a branch on \`S.tall\` where the tall stage
   needs it? Would it be legible 320 px wide?
3. Does every colour come from \`S.theme\`?
4. Does every move end? When the idea has landed the picture should be still: nothing loops or
   drifts while the learner reads.
5. Does the poster time show the idea, and does the clip's \`description\` say in words everything
   the animation shows?
6. Is every sentence the learner needs in a caption, with drawn text kept to labels and numbers?
`;
}
