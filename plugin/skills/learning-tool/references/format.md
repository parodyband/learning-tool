# Format reference

The lesson format, with an example of every part. Use it while writing scenes. `plan_lesson` returns
a fill-in template for each scene you planned; this page says what the fields mean and shows real
content in them. How to choose among them is in [clip-design.md](clip-design.md); the twelve verbs,
with what each takes and which stage accepts which, are in [motion.md](motion.md#the-verbs).

The examples come from one lesson, "How binary search works", whose evidence (`e1` to `e5`) is
invented for the example. Your lessons cite real pages.

**Objects are strict.** An unknown key is an error, never ignored. Leave optional fields out; do
not send `null` or `""`. Send `scene`, `items`, `objectives` and `outline` as JSON values, not as
strings containing JSON. No field takes HTML, a duration, a position or a colour.

## The tool flow

| Tool | You get back |
|---|---|
| `start_lesson` | The `lessonId`, the limits for that depth, and `voice` (whether captions will be read aloud). What to send as `learner` is in [calibration.md](calibration.md#filling-in-learner) |
| `save_evidence` | For each of the 1 to 10 `items` ([sourcing.md](sourcing.md#saving-evidence)), its `id` and `urlChars`, or its errors. A duplicate returns the id it already has |
| `plan_lesson` | The caption budget, a template for each scene, and the accepted scenes it dropped |
| `submit_scene` | The scene's metrics, lesson totals with `evidenceUses`, and the scenes still `pending`. When none are, the whole-lesson report too |
| `validate_lesson` | The whole-lesson report, without publishing: `complete`, `pending`, `errors`, `warnings`, `stats`, `weakClaims` |
| `publish_lesson` | `file`, `local` (a link served while the host app is open), `receipt`, `voice`, and `reply`: what to tell the learner. Send `voice: false` to skip audio, `open: true` only if the learner asked for the page to be opened |
| `get_lesson` | Without a `lessonId`, recent lessons. With one: stage, limits, the plan with each scene's status, the evidence, outstanding errors. `include: ["scene:c3"]` adds that scene in full |
| `get_guide` | This guide, by `section`: `overview`, `calibration`, `sourcing`, `clip-design`, `motion`, `format`, `frame-api`, `errors`, `voice` |

Every result has the same envelope, as JSON:

```text
{ ok, lessonId, stage, next: { tool, why }, errors: [...], warnings: [...], ...the fields above }
```

A rejected call (`ok` false) changes nothing. `next.tool` is `"reply"` when it is time to answer
the learner. Each entry in `errors` and `warnings` has a `code`, a `path` into what you sent (such
as `beats[2].do[0].target`), a `message`, a `fix`, and sometimes `got`, `expected` or `source` (for
a quote that was not found, the nearest span of the excerpt). At most 20 are listed per call. Every
code is explained in [errors.md](errors.md).

## Plan

What `plan_lesson` takes, apart from the `lessonId`.

<!-- example: plan -->
```json
{
  "title": "Binary search: find anything in a sorted list, fast",
  "objectives": [
    { "id": "o1", "text": "Trace binary search on a sorted list, one comparison at a time" },
    { "id": "o2", "text": "Explain why it needs so few comparisons and when it cannot be used" }
  ],
  "outline": [
    { "id": "c1", "kind": "clip", "purpose": "Cold open: how few looks are enough?", "stage": "words" },
    { "id": "c2", "kind": "clip", "purpose": "The loop as a picture", "stage": "flow" },
    { "id": "c3", "kind": "clip", "purpose": "Trace one search, with a prediction and a tap", "stage": "cells" },
    { "id": "q1", "kind": "checkpoint", "purpose": "Apply the halving rule to a new case", "question": "single", "objective": "o1" },
    { "id": "c4", "kind": "clip", "purpose": "Why it is fast: cost against list size", "stage": "chart", "mark": "line" },
    { "id": "c5", "kind": "clip", "purpose": "The same idea as a crowd", "stage": "dots" },
    { "id": "q2", "kind": "checkpoint", "purpose": "Retrieve the cost for a large list", "question": "numeric", "objective": "o2" },
    { "id": "c6", "kind": "clip", "purpose": "Two ways it goes wrong", "stage": "cells" },
    { "id": "q3", "kind": "checkpoint", "purpose": "Rebuild one pass of the loop", "question": "order", "objective": "o1" },
    { "id": "end", "kind": "recap", "purpose": "Takeaways, practice, what next" }
  ]
}
```

- Objective ids are `o1`, `o2`, ... in order. Each `text` completes "After this lesson you can ...".
- Every outline entry has an `id` (yours to choose, used again when you submit the scene), a `kind`
  and a `purpose`. The kinds are `clip`, `checkpoint` and `recap`.
- A `clip` names its `stage` kind: `sequence`, `cells`, `dots`, `chart`, `flow`, `words`, `lines`,
  `timeline` or `frame`. A `chart` clip may add `"mark"` (`"bars"`, `"line"` or `"curve"`) to get
  that chart's template. A lesson may hold at most 2 `frame` clips.
- A `checkpoint` names its `question` type and the `objective` it assesses.
- The first scene is a clip. The last, and only the last, is the `recap`. Every objective has a
  checkpoint, and at least half the checkpoints are graded types.

## Clip

A clip is what `submit_scene` takes as `scene` for a planned clip: one stage, and the beats that
play on it.

| Field | Meaning |
|---|---|
| `id`, `kind`, `title` | The planned id, `"clip"`, and a title that states the clip's one idea |
| `description` | The text alternative for the whole clip: what is on stage, what happens, the point it makes |
| `stage` | One of the nine [stages](#stages) |
| `beats` | 2 to 8 [beats](#beats) |
| `pace` | Optional, the only timing choice: `"brisk"`, `"normal"` (the default) or `"calm"` |
| `explore` | Optional: after the last beat, [sliders the learner drags](#explore) |

A complete clip: bars that grow, a prediction before its outcome, and an explore with a goal:

<!-- example: scene -->
```json
{
  "id": "grow",
  "kind": "clip",
  "title": "What a longer list costs",
  "description": "Two bars: the most comparisons linear and binary search need for a sorted list of 8 items, growing to 8 and 4. A slider changes the length of the list: the linear bar grows with every item, the binary bar only when the list doubles.",
  "stage": {
    "kind": "chart",
    "mark": "bars",
    "yLabel": "Worst-case comparisons",
    "bars": [{ "id": "lin", "label": "Linear search", "value": 0 }, { "id": "bin", "label": "Binary search", "value": 0, "tone": "accent" }],
    "cites": ["e2", "e5"],
    "provenance": "worked"
  },
  "beats": [
    {
      "caption": { "type": "example", "text": "A sorted list of 8 items. Linear search may have to look at all 8.", "basedOn": ["e5"] },
      "do": [{ "verb": "set", "target": "lin", "value": 8 }]
    },
    {
      "gate": {
        "prompt": "This list has 8 items. How many comparisons does binary search need at most?",
        "options": [
          { "text": "4", "correct": true, "feedback": "Yes: three halvings leave one item, and one more comparison checks it." },
          { "text": "8", "correct": false, "feedback": "That is checking every item in turn. Each comparison here discards half." },
          { "text": "1", "correct": false, "feedback": "One comparison only halves the list: 8, then 4, then 2." }
        ]
      },
      "caption": { "type": "claim", "text": "Binary search needs at most about log2(n) + 1.", "cites": ["e2"] },
      "do": [{ "verb": "set", "target": "bin", "value": 4 }]
    }
  ],
  "explore": {
    "prompt": "Drag to make the list longer or shorter. Watch which bar keeps up.",
    "controls": [{ "id": "items", "label": "Items in the list", "min": 2, "max": 64, "step": 1, "value": 8 }],
    "bind": [{ "target": "lin", "expr": "items" }, { "target": "bin", "expr": "floor(log2(items)) + 1" }],
    "goal": {
      "text": "Make binary search need exactly one more comparison.",
      "when": "floor(log2(items)) + 1 == 5",
      "done": "You had to double the list to cost binary search one more comparison. Linear search paid for every item you added."
    }
  }
}
```

## Beats

| Field | Meaning |
|---|---|
| `caption` | Exactly one [caption block](#captions). One short line |
| `do` | 0 to 4 [actions](motion.md#the-verbs), in the order they play: each a verb on part ids. At least two thirds of a clip's beats must have one |
| `gate` | Optional [prediction](#gates), by options or by a tap. The clip stops before this beat until the learner answers or skips. Not allowed on the first beat |
| `at` | Frame clips only: seconds into the animation at which this caption appears. See [Frame](#frame) |

## Captions

A caption is one block. There are five types: the first two carry citations, the other three are
yours and are labelled as yours on the page.

A `claim` is one fact in your words, with the evidence that supports it in `cites` (an array of 1 to
3 ids):

<!-- example: block claim -->
```json
{ "type": "claim", "text": "Checking every element in turn can take as many looks as there are names.", "cites": ["e5"] }
```

A `quote` is the source's own words, with a single id in `cite`. The text must occur in that
excerpt:

<!-- example: block quote -->
```json
{ "type": "quote", "text": "the half that is discarded may contain the target", "cite": "e3" }
```

An `example` is a worked case of yours, as in the first beat of the clip above. `basedOn` is
optional and names the evidence whose rule it applies.

`framing` is a question, a hand-over or an instruction, never a fact:

<!-- example: block framing -->
```json
{ "type": "framing", "text": "A million names, in order. You want exactly one of them." }
```

An `analogy` is a comparison of yours, with the required `limits` saying where it stops being true.
Its limits are read with it and count towards the caption's words, so both must be brief:

<!-- example: block -->
```json
{ "type": "analogy", "text": "It is how you find a word in a paper dictionary.", "limits": "A reader guesses where to open; binary search does not." }
```

Note the two spellings: `cites` (an array) on claims, stages, explanations, model answers and
takeaways; `cite` (one id) on quotes.

## Stages

Every stage has a `kind`, a `provenance` (`"sourced"`, `"worked"` or `"illustrative"`) and `cites`:
up to 6 evidence ids, at least one unless the stage is `illustrative`. Every part has an `id` that
actions name. All stages but `words` and `frame` may carry `stats`: up to 3 read-outs, each
`{ id, label, value, unit? }`. Everything declared is on stage when the clip opens, except a part
named by any `show` in the clip and the parts noted below.

### sequence

Who sends what to whom. `actors` are columns. `messages` are rows, top to bottom in the order
given, each `from` one actor `to` another. A message is not on stage until a `send` names it as
`target`, and each is sent once; `outcome: "lost"` makes it drop on the way. A read-out with `at`
sits beside that actor.

<!-- example: stage k-sequence -->
```json
{
  "kind": "sequence",
  "actors": [{ "id": "caller", "label": "Your code" }, { "id": "search", "label": "binary_search" }],
  "messages": [
    { "id": "call", "from": "caller", "to": "search", "label": "find 42" },
    { "id": "lost", "from": "caller", "to": "search", "label": "find 42 again" },
    { "id": "result", "from": "search", "to": "caller", "label": "position 4" }
  ],
  "stats": [{ "id": "calls", "label": "Calls", "value": 0, "at": "caller" }],
  "provenance": "illustrative"
}
```

### cells

A row of cells with pointers that walk it and brackets that span a range. `indices: true` prints
each cell's position under it. `pointers` are each `{ id, label, side?, tone? }`, where `side` is
`"above"` or `"below"` (the default); `brackets` are each `{ id, label? }`. Both are off stage until
their first `move`.

<!-- example: stage k-cells -->
```json
{
  "kind": "cells",
  "cells": [
    { "id": "a", "label": "5" },
    { "id": "b", "label": "2" },
    { "id": "c", "label": "9" },
    { "id": "d", "label": "1" },
    { "id": "e", "label": "7" }
  ],
  "pointers": [{ "id": "i", "label": "i" }],
  "provenance": "illustrative"
}
```

### dots

A population, one dot each. `total` is how many, `legend` says what one dot is, and `group` is the
one group every dot starts in. `split` and `merge` create the later groups, each with an id of its
own; a group that has been split or merged away can no longer be named.

<!-- example: stage c5 -->
```json
{
  "kind": "dots",
  "total": 1000,
  "legend": "1 dot = 1 item",
  "group": { "id": "all", "label": "Sorted items" },
  "stats": [{ "id": "looks", "label": "Comparisons", "value": 0 }],
  "cites": ["e1", "e2"],
  "provenance": "worked"
}
```

### chart

`mark` is `"bars"`, `"line"` or `"curve"`. All take an optional `unit` (printed after every value),
`yLabel` and `max` (the top of the value axis; left out, it fits what the clip reaches).

Bars grow from a zero baseline and stand from the opening. Values are zero or more. The clip
[above](#clip) is a bars chart.

A line chart has `xs`, the labels of its positions, and `series`, each with one value per position.
A line is not on stage until a `draw` names it; `upto` (an x label) stops it early.

<!-- example: stage c4 -->
```json
{
  "kind": "chart",
  "mark": "line",
  "yLabel": "Worst-case comparisons",
  "xs": ["8", "64", "512", "4,096"],
  "series": [
    { "id": "linear", "label": "Linear search", "values": [8, 64, 512, 4096], "tone": "neutral" },
    { "id": "binary", "label": "Binary search", "values": [4, 7, 10, 13], "tone": "accent" }
  ],
  "stats": [{ "id": "lin", "label": "Linear, 4,096 items", "value": 0 }, { "id": "bin", "label": "Binary, 4,096 items", "value": 0 }],
  "cites": ["e2", "e5"],
  "provenance": "worked"
}
```

A curve chart plots formulas over a numeric x axis: `x` is `{ label, min, max, unit? }`, and each
of the 1 to 3 `curves` is `{ id, label, expr, tone? }`, where `expr` is a [formula](#formulas) in
`x` and, in a clip with an `explore`, its control ids. `points` (up to 3) mark a place on a curve:
`{ id, label, x, on?, tone? }`, where `x` is a formula without `x` and `on` names the curve it rides
(the first, if left out). `min` sets the bottom of the value axis; a curve is clipped to the plot.
A curve that a `draw` names is drawn then, left to right; any other stands from the opening. A
curve chart is never `sourced`.

<!-- example: stage -->
```json
{
  "kind": "chart",
  "mark": "curve",
  "yLabel": "Worst-case comparisons",
  "x": { "label": "Items in the list", "min": 1, "max": 64 },
  "curves": [
    { "id": "linear", "label": "Linear search", "expr": "x" },
    { "id": "binary", "label": "Binary search", "expr": "log2(x) + 1", "tone": "accent" }
  ],
  "points": [{ "id": "here", "label": "32 items", "x": "32", "on": "binary" }],
  "cites": ["e2", "e5"],
  "provenance": "worked"
}
```

### flow

Boxes and arrows in one row (a column on a narrow screen). `nodes` are in reading order; each edge
goes `from` one node `to` another, with an optional `label`. A connector is not drawn until a
`draw` names it or a `send` travels along it.

<!-- example: stage c2 -->
```json
{
  "kind": "flow",
  "nodes": [
    { "id": "list", "label": "Sorted list" },
    { "id": "middle", "label": "Look at the middle" },
    { "id": "ask", "label": "Is it the target?" },
    { "id": "discard", "label": "Discard a half" },
    { "id": "found", "label": "Found" }
  ],
  "edges": [
    { "id": "begin", "from": "list", "to": "middle" },
    { "id": "check", "from": "middle", "to": "ask" },
    { "id": "no", "from": "ask", "to": "discard", "label": "no" },
    { "id": "again", "from": "discard", "to": "middle", "label": "repeat" },
    { "id": "yes", "from": "ask", "to": "found", "label": "yes" }
  ],
  "cites": ["e1"],
  "provenance": "sourced"
}
```

### words

A few lines of large type that arrive word by word. `size` is `"xl"` for the line that matters,
`"l"` (the default) or `"m"`. It takes no read-outs.

<!-- example: stage c1 -->
```json
{
  "kind": "words",
  "lines": [
    { "id": "many", "text": "1,000,000 names", "size": "xl" },
    { "id": "slow", "text": "One look at a time?", "size": "l" },
    { "id": "ask", "text": "How few looks are enough?", "size": "xl" }
  ],
  "cites": ["e5"],
  "provenance": "illustrative"
}
```

### lines

Code, a derivation or text as numbered lines. `format` is `"code"`, `"math"` or `"text"`; `language`
names the programming language, for code only. The lines are parts `l1` to `l12`, by position. In
`math` each line is one expression in the [math](#math) subset, written without `$`. Leading spaces
in code are kept.

Optional: `pointers`, each `{ id, label? }` (an arrow in the gutter, off stage until its first
`move`); `brackets`, each `{ id, label? }` (an outline round a range, likewise); `annotations`, each
`{ id, at, text }` (a callout at a line, off stage until a `show` names it); `values`, each
`{ id, at, label?, value?, unit? }` (a small read-out beside a line; without a starting `value` it
appears on its first `set`). A stage holds 14 rows: a line is one, an annotation two.

<!-- example: stage halvings -->
```json
{
  "kind": "lines",
  "format": "math",
  "lines": ["\\frac{n}{2^k} = 1", "n = 2^k", "k = \\log_2 n", "\\log_2 10^6 \\approx 19.9"],
  "values": [{ "id": "enough", "at": "l4", "label": "comparisons" }],
  "stats": [{ "id": "items", "label": "Items", "value": "1,000,000" }],
  "cites": ["e2"],
  "provenance": "worked"
}
```

### timeline

Events along a track, in the order given. `when` is free text ("1914", "+4 h", "step 2") and the
events are evenly spaced, not to scale. An event may have a `detail`, shown while it alone is in
focus. Optional: `lanes`, each `{ id, label }` (2 or 3 parallel tracks; an event names its `lane`,
and one that names none spans them all); `spans`, each `{ id, from, to, label? }` (a bracket from
one event to a later one, off stage until a `show` names it); `markers`, each `{ id, label? }` (a
"now" marker, off stage until its first `move`).

A `draw` on `"track"`, or on a lane id, draws the line, and the events it passes arrive as the tip
reaches them; `upto` (an event id) stops it. A track that no `draw` names draws itself at the
opening.

<!-- example: stage k-timeline -->
```json
{
  "kind": "timeline",
  "events": [
    { "id": "t1", "when": "1st comparison", "label": "Half is left" },
    { "id": "t2", "when": "2nd comparison", "label": "A quarter is left" },
    { "id": "t3", "when": "3rd comparison", "label": "An eighth is left" }
  ],
  "cites": ["e2"],
  "provenance": "sourced"
}
```

## Gates

A `gate` on a beat is a prediction. The clip rests before that beat; when the learner has answered
or skipped, the beat plays as the outcome.

**By options**: a `prompt` and 2 to 4 `options`, exactly one `correct`, each with `feedback`. The
clip [above](#clip) carries one.

**By a tap**: a `prompt`, `pick` (1 to 3 ids of the parts that count as right), `right` and
`wrong`. The learner taps a part of the stage: a wrong tap shows `wrong` and they may try again, a
right one shows `right`. Every id in `pick` must be a part that can be tapped on that stage (the
table under [Explore](#explore)) and is on stage when the gate opens, which is before its own beat
plays. At least one other such part must be there, or no tap could be wrong.

<!-- example: gate -->
```json
{
  "prompt": "Three cells are still possible. Tap the one the search checks next.",
  "pick": ["c5"],
  "right": "Yes: the middle of what is left, so half can be ruled out again.",
  "wrong": "The search cannot see where the target is. Which look rules out the most?"
}
```

## Explore

`explore` on a clip hands the stage to the learner after the last beat, as in the clip
[above](#clip).

| Field | Meaning |
|---|---|
| `prompt` | One line: what to drag and what to watch |
| `controls` | 1 or 2 sliders, each `{ id, label, min, max, step, value, unit? }`. `id` is its name in formulas. `value` is where it starts, and what the beats play with. The range from `min` to `max` is a whole number of steps, and `value` is on a step |
| `bind` | Up to 8 bindings, each `{ target, expr }`: the part `target` shows the number the [formula](#formulas) `expr` gives. A part is bound once |
| `goal` | Optional `{ text, when, done }`. `text` says what to bring about. `when` is a formula that is a condition: when it first holds, the player marks the goal reached and shows `done` |

The tools try every formula over the whole range of the sliders, and require that:

- every control is used by a formula, and something on the stage answers: a binding, or a curve
  or a point that names a control;
- every value is finite; a bound bar or group is never negative, a bound bar never passes the
  stage's `max`, the bound groups of one split never hold more dots than the group they were
  split from, and a point stays on the x axis;
- `when` is false at the starting values and true at some setting;
- the stage is `worked` or `illustrative`: a stage the learner can drag is never `sourced`;
- a number of two or more digits in the text of an explore or of a tap gate is one the picture
  holds (on the stage, a control's `min`, `max` or `value`, a number in a formula) or is in a
  stored passage.

What a tap gate may name and what a binding may drive, by stage. A bound group of `dots` is one
that a `split` made and no `merge` has taken. The groups of that split with no binding share what
the bound ones leave; a bound group that was split again is what its own parts share. Curves need
no binding.

<!-- interactive:start (generated; see test/skill/helpers.ts) -->
| Stage | A tap gate may name | A binding may drive |
|---|---|---|
| `sequence` | actor, message | read-out |
| `cells` | cell | read-out |
| `dots` | group of dots | group of dots, read-out |
| `chart`, bars | bar | bar, read-out |
| `chart`, line | series | read-out |
| `chart`, curve | point on a curve, curve | read-out |
| `flow` | node, edge | read-out |
| `words` | line | nothing |
| `lines` | line | value beside a line, read-out |
| `timeline` | event | read-out |
| `frame` | nothing | nothing |
<!-- interactive:end -->

## Formulas

A formula is a string: a binding's `expr`, a curve's `expr`, a point's `x`, a goal's `when`. It may
name the clip's control ids, and `x` in a curve's `expr` only; never a part of the stage.

<!-- formulas:start (generated from src/core/expr.ts; see test/skill/helpers.ts) -->
- Numbers, the control ids, `+` `-` `*` `/` `^`, brackets, `<` `<=` `>` `>=` `==` `!=`, and the words `and` `or` `not`
- One value: `abs` `sqrt` `exp` `ln` `log2` `log10` `sin` `cos` `tan` `floor` `ceil` `round`
- 2 to 4 values: `min` `max`
- 3 values: `clamp(value, low, high)` `if(condition, then, otherwise)`
- Constants: `pi` `e`
- Length: at most 120 characters
<!-- formulas:end -->

`^` binds tighter than a minus sign in front, so `-x^2` is `-(x^2)`; then `*` and `/`, then `+`
and `-`, then comparisons, then `not`, `and`, `or`. A comparison is worth 1 or 0, and `if` works
out only the branch it takes. Write every multiplication (`2 * x`) and join two comparisons with
`and`. Expressions that parse, for the pattern:

<!-- formula-examples -->
- `round(0.8 * 10 * rate)`
- `log2(x) + 1`
- `if(rate > 0, hits / rate, 0)`
- `clamp(10 * buyers / (buyers + sellers), 0, 10)`
- `abs(supply - demand) < 2 and price >= 3`

## Frame

A stage of kind `frame` runs drawing code you wrote, as a pure function of time. The page marks it
"Custom animation" and tells the learner it is not checked. Everything the code may use is in
[frame-api.md](frame-api.md); read it before writing one.

The stage is `{ kind, code, duration, poster, aspect?, params?, cites, provenance }`. Each beat of
a frame clip has a `caption` and `at` (seconds: the first at 0, then rising, all less than
`duration`) and no `do`. Like every clip it needs a caption that is a `claim` or a `quote`. A small
one:

<!-- example: scene -->
```json
{
  "id": "halve",
  "kind": "clip",
  "title": "Three comparisons, an eighth left",
  "description": "A bar that stands for a sorted list is cut in half three times, until an eighth of it is left.",
  "stage": {
    "kind": "frame",
    "code": "function render(ctx, t) {\n  const halvings = S.map(t, [0.6, 1.2, 2, 2.6, 3.4, 4], [0, 1, 1, 2, 2, 3], S.ease.inOut);\n  S.clear();\n  S.rect(S.W * 0.1, S.H * 0.44, S.W * 0.8 * Math.pow(0.5, halvings), S.H * 0.12, { fill: S.theme.accentSoft, stroke: S.theme.accent, r: 6 });\n}\n",
    "duration": 5,
    "poster": 2.3,
    "cites": ["e2"],
    "provenance": "worked"
  },
  "beats": [
    { "caption": { "type": "claim", "text": "Each comparison halves the interval that is left to search.", "cites": ["e2"] }, "at": 0 },
    { "caption": { "type": "example", "text": "Three comparisons in, an eighth of the list is left." }, "at": 3.4 }
  ]
}
```

## Checkpoint

One question that assesses one `objective`. `level` is `recall` (retrieve something taught) or
`apply` (use it on a case the lesson did not show). How to write a good one is in
[clip-design.md](clip-design.md#checkpoints).

<!-- example: scene q1 -->
```json
{
  "id": "q1",
  "kind": "checkpoint",
  "title": "Check: which half?",
  "objective": "o1",
  "level": "apply",
  "question": {
    "type": "single",
    "prompt": "You search a sorted list for 70. The middle element is 50. What does binary search do next?",
    "options": [
      {
        "text": "Search only the half after the middle element",
        "correct": true,
        "feedback": "Right: 70 is greater than 50, so in a sorted list it can only be in the later half."
      },
      {
        "text": "Search only the half before the middle element",
        "correct": false,
        "feedback": "That half holds values smaller than 50, so 70 cannot be there.",
        "misconception": "Mixes up which side of a sorted list holds the larger values"
      },
      {
        "text": "Move to the next element and continue one at a time",
        "correct": false,
        "feedback": "That is linear search. Binary search discards half of the interval instead.",
        "misconception": "Treats binary search as a faster-starting linear scan"
      }
    ],
    "explanation": { "text": "The target is compared with the middle element, and the half that cannot contain it is discarded.", "cites": ["e1"] },
    "hint": "The list is sorted. Where do values larger than 50 live?"
  }
}
```

`single`, `order` and `numeric` are graded by the player; `reflect` is checked by the learner
against your model answer. All but `reflect` take an `explanation` (why the right answer is right,
with `cites`) and an optional `hint`.

**single**: three or four `options`, exactly one with `correct: true`. Every option has `feedback`,
and every wrong option a `misconception`: the mistaken belief that leads to it, not shown to the
learner. Options are shuffled unless you set `fixedOrder: true`.

**order**: `items` are given in the correct order. The player shuffles them.

<!-- example: question order -->
```json
{
  "type": "order",
  "prompt": "Put one pass of binary search in order.",
  "items": [
    "Find the middle element of the current interval",
    "Compare it with the target",
    "Discard the half that cannot contain the target",
    "Repeat on the half that remains"
  ],
  "explanation": {
    "text": "Binary search repeatedly compares the target with the middle element and discards the half that cannot contain it.",
    "cites": ["e1"]
  }
}
```

**numeric**: `answer` is a number, `tolerance` the absolute error allowed (default 0), and `unit` is
optional.

<!-- example: question numeric -->
```json
{
  "type": "numeric",
  "prompt": "A sorted list has 1,000,000 items. At most how many comparisons does binary search need?",
  "answer": 20,
  "unit": "comparisons",
  "explanation": {
    "text": "Each comparison halves the interval, so a sorted list of 1,000,000 items is searched in at most 20 steps.",
    "cites": ["e2"]
  },
  "hint": "How many times can you halve a million before one item is left?"
}
```

**reflect**: the learner writes an answer, reveals your `modelAnswer`, and checks their own against
the `lookFor` points.

<!-- example: question reflect -->
```json
{
  "type": "reflect",
  "prompt": "In your own words, why can binary search not be trusted on a list that is not sorted?",
  "modelAnswer": {
    "text": "Each step discards a half on the assumption that sorted order puts the target on the other side. Without that order, the discarded half may contain the target.",
    "cites": ["e3"]
  },
  "lookFor": ["You mention that a half is discarded at every step", "You say that sorted order is what makes discarding safe"]
}
```

## Recap

The last scene, and only the last: exactly one cited takeaway per objective, written as the answer
to "Can you ...?" (hidden until the learner asks, so that they try to recall it first); an
optional `practice` task to do away from the screen, with signs of success; and 1 to 3 `next`
topics, each shown as a ready-made request, "Teach me *topic* with Learning Tool".

<!-- example: scene end -->
```json
{
  "id": "end",
  "kind": "recap",
  "title": "What you can do now",
  "takeaways": [
    {
      "objective": "o1",
      "text": "Compare the target with the middle element, discard the half that cannot contain it, and repeat on what is left.",
      "cites": ["e1"]
    },
    {
      "objective": "o2",
      "text": "Each comparison halves the interval, so the cost grows with log2(n), and it only works on sorted data.",
      "cites": ["e2", "e3"]
    }
  ],
  "practice": {
    "task": "Write binary search from memory in a language you use. Test it on an empty list, a one-item list, and a target that is not present.",
    "lookFor": ["It returns a not-found result instead of looping forever", "It never reads a position outside the list"]
  },
  "next": [
    { "topic": "Big-O notation", "why": "To say precisely how the cost of binary search and linear search grows." },
    { "topic": "How sorting algorithms work", "why": "Binary search needs sorted data, so the cost of sorting matters." }
  ]
}
```

## Inline markup

Captions, prompts, options, feedback, explanations and takeaways accept four kinds of inline markup
and nothing else.

| You write | The learner sees |
|---|---|
| `**strong**` | **strong** |
| `*emphasis*` | *emphasis* |
| `` `code` `` | `code` |
| `$n^2$` | the expression typeset as math |

- There are no links, images, headings, lists or HTML. Angle brackets are shown as typed.
- `*` and `**` only mark emphasis where they hug a word and have a partner, so `2*3*4` and `*.txt`
  stay literal. Nothing inside a code span is markup.
- A `$` opens math only when a closing `$` follows, the content does not begin or end with a space,
  and the closing `$` is not followed by a digit, so "$5 and $10" stays literal.
- A backslash before `*`, `` ` `` or `$` makes it literal. A delimiter with no partner is shown as
  typed. A math span that does not parse is an error (`MARKUP_MATH`).
- Titles and what stands on a stage (labels, read-outs, the lines of a `words` stage) are plain
  text, shown as typed.
- Numbers inside a code or math span are not checked against sources, since they are notation, not
  claims. Do not use a span to hide a factual number from that check.

## Math

Math is a small subset of LaTeX, used inside `$...$` and in the lines of a `lines` stage with
`format: "math"`. Anything outside the subset is an error that names the unsupported command or
character. Everything supported:

<!-- math:start (generated from src/core/math.ts; see test/skill/helpers.ts) -->
- Operators and punctuation: `+` `-` `=` `<` `>` `/` `*` `(` `)` `[` `]` `,` `.` `!` `|` `:` `%` `'`
- Fractions, roots, text and scripts: `\frac{a}{b}` `\sqrt{x}` `\sqrt[n]{x}` `\text{words}` `x^2` `x^{n+1}` `x_i` `x_{i,j}`
- Greek letters: `\alpha` `\beta` `\gamma` `\delta` `\epsilon` `\varepsilon` `\zeta` `\eta` `\theta` `\vartheta` `\iota` `\kappa` `\lambda` `\mu` `\nu` `\xi` `\pi` `\rho` `\sigma` `\tau` `\upsilon` `\phi` `\varphi` `\chi` `\psi` `\omega` `\Gamma` `\Delta` `\Theta` `\Lambda` `\Xi` `\Pi` `\Sigma` `\Upsilon` `\Phi` `\Psi` `\Omega`
- Symbols: `\times` `\cdot` `\div` `\pm` `\le` `\leq` `\ge` `\geq` `\ne` `\neq` `\approx` `\to` `\rightarrow` `\infty`
- Large operators: `\sum` `\prod` `\int`
- Named functions: `\log` `\ln` `\sin` `\cos` `\tan` `\lim` `\min` `\max`
- Sized delimiters: `\left( ... \right)` `\left[ ... \right]` `\left| ... \right|`
- Spacing: `\,` `\:` `\;` `\quad`
- Literal characters: `\$` `\%`
<!-- math:end -->

- Numbers and single letters are typed as they are: `3.14`, `x`, `n`. A run of letters is read as
  separate variables multiplied together, so put a word inside `\text{...}`.
- `^` and `_` take one token, or a group in braces for more.
- There are no matrices, alignment environments, macros or colours: write such an expression as
  steps on a `lines` stage, or say it in words.

Expressions that parse, for the pattern:

<!-- math-examples -->
- `n^2`
- `\log_2 n + 1`
- `2^{k} \ge n`
- `\frac{n}{2^k} = 1`
- `\text{mid} = \text{low} + \frac{\text{high} - \text{low}}{2}`
- `\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`
- `\text{comparisons} \le \log_2 n + 1`
- `\Delta t \approx 3.2 \times 10^{-5}`

## Ids

| Id | Form | Who chooses it |
|---|---|---|
| Lesson | 12 characters | The server. Use the `lessonId` from `start_lesson` exactly |
| Evidence | `e1`, `e2`, ... | The server, in the order saved |
| Objective | `o1` to `o9`, in order | You, in `plan_lesson` |
| Scene and part | A lowercase letter, then up to 31 more of `a-z`, `0-9`, `-`, `_` | You. Scene ids are unique in the lesson; on a stage, parts, read-outs and groups made by `split` or `merge` share one set of ids |
| Control | A lowercase letter, then up to 15 letters, digits or `_`; not `x`, `e`, `pi` or a function's name | You. It is the slider's name in formulas |

## Limits

These are enforced. A length is counted in characters after stray whitespace and invisible
characters are removed; word limits count words in any language.

<!-- limits:start (generated; see test/skill/helpers.ts) -->
| Depth | Target time | Scenes | Objectives | Excerpts cited | Caption and takeaway words | An `apply` checkpoint |
|---|---|---|---|---|---|---|
| `quick` | about 5 min | 4 to 6 | 1 to 2 | at least 3 | warning above 700 words, error above 900 | optional |
| `standard` | about 10 min | 6 to 10 | 2 to 4 | at least 4 | warning above 1,500 words, error above 1,900 | required |
| `deep` | about 20 min | 10 to 16 | 3 to 5 | at least 6 | warning above 2,850 words, error above 3,500 | required |

| Area | What | Limit |
|---|---|---|
| **Header** | Topic / lesson title / scene title | at most 120 / 80 / 60 characters |
|  | Objective text / outline `purpose` | 10 to 160 / at most 160 characters |
|  | `learner.knows` / `learner.goal` | at most 400 / at most 300 characters |
|  | `learner.calibration` | at most 4 entries; question at most 400, answer at most 400 characters |
| **Evidence** | Items stored per lesson / items one excerpt may support | at most 40 / at most 6 |
|  | Excerpt / all excerpts from one URL | 40 to 800 / at most 2,000 characters |
|  | URL / its query string | at most 1,000 / at most 200 characters |
|  | Source title / publisher | at most 200 / at most 80 characters |
|  | Evidence ids in one `cites` | 1 to 3; on a stage, up to 6 |
| **Captions** | Words in one caption | warning above 16 words, error above 22 |
|  | `claim` / `example` / `framing` | at most 360 / 480 / 160 characters |
|  | `quote` | at most 320 characters, at least 4 words |
|  | `analogy` text / `limits` | at most 320 / 10 to 200 characters |
| **Clip** | Beats / actions in one beat | 2 to 8 / at most 4 |
|  | Beats with at least one action | at least two thirds of the clip's beats |
|  | `description` | 30 to 400 characters |
|  | Read-outs (`stats`) | at most 3; label at most 24, value at most 32, unit at most 12 characters |
|  | `set`: `value` text / `label`; ids in one `targets` | at most 32 / at most 40 characters; at most 12 |
|  | Clips with a `frame` stage, in one lesson | at most 2 |
| **Explore** | Sliders (`controls`) / bindings | 1 to 2 / at most 8 |
|  | One slider | at most 1,000 steps from `min` to `max`; `label` at most 24, `unit` at most 12 characters |
|  | `prompt` / goal `text` / goal `done` | at most 160 / at most 240 / 15 to 200 characters |
|  | A formula | at most 120 characters |
| **Stages** | `sequence` | 2 to 4 actors, 1 to 8 messages; actor label at most 24, message label at most 32 characters |
|  | `cells` | 2 to 12 cells of at most 8 characters; at most 4 pointers (label at most 10 characters), at most 2 brackets (label at most 24) |
|  | `dots` | 2 to 1,000 dots; legend at most 40, group label at most 24 characters; a `split` makes 2 to 4 groups, a `merge` joins 2 to 4 |
|  | `chart`, bars | 2 to 8 bars; label at most 16 characters |
|  | `chart`, line | 2 to 16 x positions, 1 to 3 series; x label at most 10, series label at most 24 characters |
|  | `chart`, curve | 1 to 3 curves, at most 3 points; curve and point label at most 24 characters |
|  | `chart`, all | `yLabel` and an axis label at most 40, `unit` at most 12 characters |
|  | `flow` | 2 to 6 nodes, 1 to 8 edges; node label at most 24, edge label at most 16, token label at most 16 characters |
|  | `words` | 1 to 5 lines of at most 80 characters |
|  | `lines` | 1 to 12 lines of at most 72 characters; at most 2 pointers, at most 2 brackets, at most 3 annotations of at most 80 characters, at most 8 values; 14 rows in all, an annotation taking two |
|  | `timeline` | 2 to 10 events; `when` at most 24, label at most 60, detail at most 120 characters; 2 to 3 lanes, at most 3 spans, at most 2 markers |
|  | `frame` | code at most 24,576 bytes, no line over 400 characters; `duration` 2 to 120 seconds; at most 3 sliders |
| **Questions** | Prompt, of a checkpoint or a gate | at most 240 characters |
|  | Options in a `single` / in a gate | 3 to 4 / 2 to 4 |
|  | Tap gate: ids in `pick` / `right` and `wrong` | 1 to 3 / 15 to 200 characters |
|  | Option text / `feedback` / `misconception` | at most 120 / 15 to 200 / 8 to 120 characters |
|  | `explanation` / `hint` | at most 400 / at most 160 characters |
|  | `order` items | 3 to 6 items of at most 100 characters |
|  | `numeric` unit / `reflect` model answer | at most 16 / at most 500 characters |
|  | `reflect` `lookFor` | 2 to 4 points of at most 120 characters |
|  | Correct option longer than every distractor | warning at 1.25 times the longest; error at 1.6 times when also 20 characters longer |
| **Recap** | Takeaway | at most 240 characters |
|  | `next` topics | 1 to 3; topic at most 80, why at most 160 characters |
|  | `practice` | task at most 300 characters; 1 to 4 `lookFor` points of at most 120 characters |
| **Structure** | Scenes in a row with no checkpoint and no gate | at most 3 |
|  | Clips with a gate or an explore | at least two thirds of the lesson's clips |
|  | Framing plus analogy, as a share of the lesson's words | at most 30%, or 80 words if that is more |
|  | Worked examples, as a share of the lesson's words | at most 35%, or 120 words if that is more |
|  | Claims with a weak match to their excerpts | error above 25% of claims, once there are 3 |
|  | Claim that must become a quote | shares 85% of its words with the excerpt, in both directions |
|  | Illustrative stages among the clips that show data | warning above half |
| **Whole lesson** | Size of the lesson data | at most 300,000 bytes |
<!-- limits:end -->

Also enforced: every clip has at least one caption that is a `claim` or a `quote`, and every
checkpoint's explanation or model answer cites evidence that some clip also cites.
