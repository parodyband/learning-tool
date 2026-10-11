# Clip design: a lesson the learner works through

Read this before you call `plan_lesson`, and keep it open while you write clips. The tools reject a
malformed clip. They cannot tell a lesson the learner works through from one that is watched and
forgotten. That difference is made here.

A lesson is clips, checkpoints and a recap. A **clip** is one stage and a few beats. The **stage**
is typed parts that the player draws large, as the picture. A **beat** is one short caption and the
motion that goes with it. Where you decide, the learner acts: commits to a prediction, taps the
part of the picture that answers, or takes over a slider when the clip ends. You never write a
duration, a position or a colour: the player owns those.

Bracketed keys such as [CR04] point to [Sources](#sources).

## Learn by doing

Design every scene around what the learner will **do**, then find the picture that lets them do
it. Six moves, in the order a scene uses them:

1. **Open on something to work out.** A case or a question, not a statement to accept: "She tests
   positive. How likely is it that she is ill?" comes before any rate is explained.
2. **Make them commit before the outcome plays.** A prediction or a tap on the picture; then the
   motion answers. Students who only watched a demonstration understood it no better than students
   who never saw it; those who predicted first understood it better [CR04]. A confident wrong
   guess is what makes the answer stick [BR21].
3. **Where the idea is a relationship between quantities, hand over the system.** A slider, a
   picture that responds as it is dragged, and a goal to reach. The goal matters: novices left to
   explore play with whatever catches the eye [LOW04], and unguided discovery teaches less than
   being told, while guided discovery teaches more [ALF11].
4. **Explain after, naming what they just saw.** The outcome's caption, the feedback on an answer
   and the line shown when a goal is reached all say *why*. A wrong tap gets a nudge and another
   try; no answer is a dead end.
5. **Concrete before abstract.** Count the people before writing the formula. Trace one search
   before stating the rule.
6. **Small steps.** One idea per scene, one change per beat, a few seconds of reading at most
   before the next thing to do.

The picture still carries the idea: ask what you would **draw** and what would **change** in the
drawing, and let the caption be the one line said over that change. Animation paired with on-screen
text is its weakest form [BB16], and motion helps only where the thing to learn is itself a change
[PBB21]. But watching feels like understanding when it is not [PS13], so what the learner does is
what makes a clip a lesson:

| The idea is | The learner | You write |
|---|---|---|
| An outcome that can be guessed: what happens next, how much, which way | Chooses before it plays | A `gate` with options |
| A place in the picture: which cell, which step, which group | Taps that part | A `gate` with `pick` |
| A relationship between quantities: change this and that responds | Drags a slider towards a goal | An `explore` |
| The idea used on a case the lesson did not show | Answers a question after the clip | A checkpoint |

Most clips carry one of the first three. The tools refuse a lesson in which fewer than two thirds
of the clips do, and warn about a standard or deep lesson with no `explore` anywhere.

## Objectives

An objective completes "After this lesson you can ..." with something you could watch the learner
do: "Trace binary search on a sorted list", not "Understand binary search". Keep them few: 1 to 2
for a quick lesson, 2 to 4 for a standard one, 3 to 5 for a deep one. The usual failure is
coverage: eight topics touched and none usable. Scope to the depth and put the rest in the recap's
`next` topics. Everything serves an objective, and a checkpoint assesses each.

## Storyboard first

Write the lesson as a storyboard before any JSON: one row per scene, and for each clip five things.

1. **The idea**, in one sentence. If the sentence needs "and", it is two clips.
2. **What the learner does**: predicts, taps, or drags towards a goal. Decide it before the
   picture, because it chooses the picture.
3. **The stage**: which kind, and what stands on it when the clip opens.
4. **What changes**: the 2 to 8 changes, in order, each one a verb on a part.
5. **The line** said over each change.

Beside each clip note the evidence ids it draws on. A clip with none is one you cannot write yet.

| | Idea | Stage, and what changes | The learner |
|---|---|---|---|
| Weak | "Slow start and congestion avoidance" | Three boxes, one per phase, appear in turn with a definition each | Watches |
| Strong | "The window doubles each round trip until a loss halves it" | A line chart: the line is drawn to 16, falls to 8, climbs by ones | Predicts where the window is after the loss, before the line falls |

The weak row is a glossary that fades in. Nothing on that stage behaves like a congestion window,
and there is nothing for the learner to get wrong.

**Open cold, end by answering.** The first clip shows the problem before anything is explained, in
two to four beats with no definitions, and ends on a question in the learner's own terms: "A
million names, in order. How few looks could be enough?" The last clip before the recap returns
to that question and resolves it on stage, ideally with the opening's own numbers.

**Sequence for this learner** (see [calibration.md](calibration.md#what-each-answer-changes)). A
newcomer gets the parts named and one complete worked case before any graded question. Someone
experienced gets asked first: put a prediction early in the second clip. For everyone: never more
than 3 scenes in a row in which the learner only watches.

## Choosing the stage

Choose by what kind of thing changes in the idea, not by what the topic usually looks like on a
slide.

| Stage | Shows best | Cannot show |
|---|---|---|
| `words` | A question, a number or a definition as large type: "Two high tides a day." "One Moon." "Why two?" | A mechanism. 1 to 5 lines, and one or two such clips in a lesson at most |
| `flow` | Parts and what passes between them: a process, a route, a cause, a loop | More than 6 boxes, branching, amounts. Boxes stand in one row |
| `sequence` | Who sends what to whom, strictly in order, and a message that is lost | What happens inside one actor. 2 to 4 actors, up to 8 messages |
| `cells` | A row of slots and what walks along it: pointers, a bracket, swaps, a new order | Grids and trees. 2 to 12 cells, labels of at most 8 characters |
| `dots` | How many out of how many: 1,000 people screened, splitting into groups and merging again | Change over time, overlapping groups. At most 1,000 dots |
| `chart` bars | A few amounts on one baseline; one that grows; a ranking that reorders | Parts of a whole (use `dots`). 2 to 8 bars, never below zero |
| `chart` line | Values along an ordered axis, drawn left to right so the turn is watched: tea cooling fast, then slowly | More than 3 series or 16 points. Positions are evenly spaced whatever their labels say |
| `chart` curve | A dependence drawn from a formula: its shape, where two cross, how a parameter shifts it | Measured data: it is never `sourced`. 1 to 3 curves. See [Curve charts](#curve-charts) |
| `lines` | Symbols read closely: code traced by a pointer, a derivation growing line by line | Anything that is not text. Up to 12 lines. Least moves here, so never the default |
| `timeline` | Order in time: events along a track, lanes, a span, a "now" marker | Branching causes (use `flow`), true distances in time. 2 to 10 events, evenly spaced |
| `frame` | What no typed stage can draw: a physical motion, a spatial mechanism | Being checked. It runs code you wrote and is marked as custom |

- **Try two kinds for the central idea.** The first to come to mind is usually the slide diagram.
  The better one is where the idea's own change is a verb: a rate that *splits* a crowd, a
  request that is *sent* and lost.
- **Quantities that answer to each other belong on `dots`, bars or a curve**, whose parts can
  follow a slider.
- **Parts carry names, not sentences**: two or three words, next to where the action is. Choose
  ids that mean something (`syn-ack`, not `n3`): you type them again in every beat.
- **Read-outs for values that change.** `stats` holds up to 3: a counter, a variable, a verdict.
- **Know what is on stage when the clip opens.** Everything you declare arrives at the start,
  except what waits for its verb: a part named by a `show`, a connector or a chart line (until
  `draw`), a curve that a `draw` names, a message (until `send`), a pointer, bracket or marker
  (until its first `move`). That opening picture is the poster the learner sees before pressing
  play.
- **Some ideas should stand still.** A layout or a comparison is built once and pointed at: see
  [motion.md](motion.md#motion-or-a-still).
- **`frame` is the last resort**, at most 2 in a lesson: nothing can check what your code draws,
  and the learner is told so. [frame-api.md](frame-api.md) is its whole contract.

## Writing beats

A beat is **one change and one caption**. The caption appears first; the motion follows. A clip
has 2 to 8 beats, and a beat at most 4 actions. Which verb is the change, and how a clip is
choreographed, is in [motion.md](motion.md). What has to be right in the design:

- **One line, about 16 words at most, that says what the picture cannot**: the reason, the rule,
  the name. The tools warn above 16 words and refuse a caption above 22. If it will not fit, the
  beat holds two changes: split it.
- **A caption is one block, and its type is a promise.** A statement of fact is a `claim` with
  `cites`, or a `quote` when the source's wording matters. Your own worked case is an `example`. A
  question or a hand-over is `framing`, and never carries a fact. An `analogy` needs `limits`,
  where the comparison stops being true. Moving a fact into `framing` to shed its citation defeats
  the product; see [sourcing.md](sourcing.md#the-grounding-checks).
- **A lesson speaks mostly in sourced facts.** Every clip needs at least one `claim` or `quote`.
  Across the lesson, `framing` and `analogy` captions may be at most 30% of the words and `example`
  captions at most 35% (or 80 and 120 words, if that is more).
- **Most beats change the picture.** At least two thirds of a clip's beats must have an action,
  and that is the floor. A beat whose only action is `focus` or `pulse` changes nothing.

## Predictions: a choice or a tap

A beat may carry a `gate`. The clip stops **before** that beat and waits until the learner commits
or skips. Then the beat plays: its motion is the answer, and its caption says why. Two kinds:

- **Options**: a question with 2 to 4 options, exactly one correct, each with a line of feedback.
  Use it when the answer is not a part of the picture: an amount, a direction, what happens next.
- **A tap**: a `prompt` and `pick`, the ids of the parts that count as right (usually one). A
  wrong tap shows `wrong` and the learner tries again; a right one shows `right` and the beat
  plays. Use it when the answer *is* a part of the picture: which cell is checked next, which
  step fails, which group she is in. The question stays on the picture, and every other part is a
  distractor you did not have to invent. What can be tapped is in [format.md](format.md#gates).

For both:

- **Put the gate at the crux, on the beat that shows the outcome.** Never on the first beat: the
  learner needs something to predict from, such as named parts and a first case that has played.
- **The motion must answer it.** The line falls, the token is lost, the pointer lands. An answer
  that arrives only as text is a quiz interrupting a film.
- **Feedback says why**, with no praise. Each wrong option is a belief someone holds, and its
  feedback says why that is not what happens.
- **A tap must be a real choice.** When the gate opens, the right part looks like its neighbours:
  no accent, no pointer resting on it, no `focus`. `wrong` is one line for every wrong tap, so it
  points at what to notice and never names the part. A number of two or more digits in the words
  of a tap gate must be on the stage or in a stored passage.
- **Usually one gate in a clip.**

| | Prompt | The answer | What plays next |
|---|---|---|---|
| Weak | "Ready to see what happens next?" or "What is this phase called?" | "Yes" / "No", or three terms | Anything: nothing was committed, or it was recall |
| Strong | "The window is at 16 and a loss is detected. Where is it one round trip later?" | "8" / "1" / "16": half, a full reset, no change | The line is drawn on, and falls to 8 |
| Weak tap | "Tap the middle cell." | The cell the `mid` pointer already stands on. `wrong`: "No, the fifth one." | Nothing the learner had not seen |
| Strong tap | "Three cells are still possible. Tap the one the search checks next." | The middle of the three, unmarked. `wrong`: "The search cannot see where the target is. Which look rules out the most?" | The pointer lands and its neighbours are ruled out |

## Explore: hand over the system

With `explore`, the stage is handed to the learner after the last beat. One or two sliders
(`controls`) appear with a one-line `prompt`, every part you `bind` to a formula follows them, and
a `goal` gives the learner something to bring about, which the player detects. While the beats
play, each control rests at its starting `value`.

| | Stage and slider | What responds | Goal |
|---|---|---|---|
| Weak | A timeline of events; "Year", 1950 to 2020 | A read-out that repeats the slider | None |
| Strong | 1,000 dots divided by test result; "Women with cancer", 1 to 30% | The two positive groups, and the share of positives that are right | "Find the crowd in which a positive result is as likely right as wrong." |

**Does this relationship deserve one?** Yes, when quantities depend on each other and watching one
answer to another *is* the understanding: a rate that reshapes a crowd, a parameter that bends a
curve, a cost that grows with size. No, when the content is a list of facts, a chain of events or
a definition. Those have nothing to drag, and a slider invented for its own sake costs the learner
a minute and teaches nothing: ask for a prediction or a tap instead. A history lesson may have no
explore at all.

**Explore last.** The beats before it build the picture one change at a time and name every part,
usually with a prediction on the way. Sliders on a stage nobody has explained are a toy.

**Choose the one or two quantities worth dragging**: what the idea turns on and the learner could
name (how common, how steep, how many). Add a second only when the point is how two trade off.

- Set `min` and `max` so that something happens *inside* the range: two groups swap rank, two
  curves cross, a bar overtakes its neighbour. Where everything only grows there is nothing to
  find.
- Start where the clip ended. At the starting values every formula must give the number already
  on stage, or the picture jumps as the sliders appear.
- Ten to fifty steps is plenty. Give the slider a plain `label` and a `unit`.

**Bind what the eye is on.** A binding ties a part's number to the controls:
`{ "target": "hits", "expr": "round(8 * rate)" }`. It can drive a read-out on any stage that has
them, a bar, a group of dots that a `split` made, or a value beside a line
([format.md](format.md#explore)). Curves need no binding: their own formulas name the controls. Bind
the parts the learner is watching *and* a read-out that puts the consequence in a number. A bound
group takes its dots from the group it was split from, so the bound groups of one split may never
need more than that group holds. A control that nothing uses is refused.

**Write a goal that takes understanding.** `goal.text` says what to bring about, in the learner's
terms, and `goal.when` is the condition that detects it. Name an outcome, never the setting.

| | `goal.text` | Why |
|---|---|---|
| Weak | "Set the rate to 10%." | It restates a number: the learner copies it onto the slider |
| Weak | "Make the positive group bigger." | Any drag does it, and so does the far end |
| Strong | "Make a positive result more likely right than wrong." | They must see which group has to overtake which |
| Strong | "Find the crowd in which a positive result is as likely right as wrong." | A tipping point inside the range: neither end reaches it |

The tools check that `when` is false at the start and true somewhere. Whether it takes thought is
yours to check: if an end of a slider satisfies the goal, the learner reaches it by sweeping the
slider across. Ask for a tipping point, a balance between two controls, or an outcome with a
condition attached ("sell more *without the price moving*").

**`done` says why that worked**, naming what they just saw: "Here about one woman in ten has
cancer, so true positives have caught up with false alarms." Never "Well done!".

**Numbers in the words.** In `prompt`, `goal.text` and `done` a number of two or more digits must
be one the picture already holds (on the stage, an end or the start of a slider, a number in a
formula) or be in a stored passage. Otherwise write it in words.

## Formulas

A formula gives a bound part, a curve, a marked point or a goal its number. The whole language:

<!-- formula-help:start (generated from EXPR_HELP in src/core/expr.ts; see test/skill/helpers.ts) -->
> A formula uses numbers, your control ids (and x on a curve), + - * / ^, parentheses, comparisons (< <= > >= == !=) joined with and / or / not, the constants pi and e, and these functions: abs, sqrt, exp, ln, log2, log10, sin, cos, tan, floor, ceil, round, min, max, clamp, if. At most 120 characters.
<!-- formula-help:end -->

A control's `id` is its name in formulas, so make it a word: `rate`, not `r`. What each function
takes is in [format.md](format.md#formulas). The usual mistakes:

- **`**` for a power, or a missing `*`.** Write `x^2` and `2 * x`. There is no `%` sign: a slider
  that runs from 1 to 30 "%" is divided by 100 in the formula.
- **A name that is not a control.** A formula sees only the clip's control ids, plus `x` in a
  curve's `expr` (a point's `x` formula may use controls but not `x`). It cannot read another
  part: write that quantity out again from the controls.
- **Dividing by a control that can reach zero.** With `rate` at 0, `hits / rate` has no value and
  the clip is refused. Start the range above zero, or step round the bad point:
  `if(rate > 0, hits / rate, 0)`, since `if` works out only the branch it takes. The same goes for
  `ln` and `sqrt` of what may fall to zero or below.
- **A count that is not whole.** The player rounds a group to whole dots. Wrap the formula in
  `round` yourself, there and wherever a read-out counts the same thing, so that they agree.
- **A goal that is a quantity.** `when` is a comparison (`a > b`, `abs(a - b) < 1`), or several
  joined with `and`, `or`, `not`. Two formulas rarely meet exactly: prefer a tolerance to `==`.

**Check both ends before you submit.** Work every formula out at each slider's `min`, `max` and
starting `value` (with two sliders, at the four corners too). The tools try the whole range and
refuse a value that is not finite, a negative bar or group, groups that outgrow the group they
were split from, a marked point that leaves the axis, and a goal that is met at the start or
never. They warn about a goal that an end of the slider satisfies (`GOAL_AT_END`). They do not
catch a starting value that differs from what the last beat left on stage: that is the one you
are looking for.

## Curve charts

A `chart` with `mark: "curve"` plots formulas: each curve is `y = expr` over a numeric x axis. It
is the right picture when the idea is the *shape* of a dependence (it levels off, it peaks, it
crosses another) and how that shape answers to a parameter. Measured values belong on a line
chart. A curve is your working, so the stage is `worked` or `illustrative`.

- **Choose the x axis for the event.** `x.min` and `x.max` frame the place where the interesting
  thing happens (the crossing, the knee, the peak), with room on both sides. `min` and `max` do the
  same for the value axis; left out, the scale fits what the curves reach.
- **Mark the point the idea is about.** `points` holds up to 3, each at an x you give as a
  formula, riding the curve named by `on`: an equilibrium, a peak, a break-even. Compute its x from
  the controls so that it tracks the curves as they move. It must stay on the axis at every
  setting.
- **Let a control shift or bend a curve** by naming it in that curve's `expr`. Leave something
  still to compare against: the other curve, or the axis.
- **Draw the answer last.** `draw` runs a curve left to right. Stop the clip before the curve, or
  the point, that answers the prediction.

## Honesty of the picture

A picture asserts things. Eight tokens with three lost says "three of eight" whether or not a
source does. So every stage declares where its content comes from, and the learner sees it as a
badge on the stage.

| `provenance` | Means | The learner sees |
|---|---|---|
| `sourced` | Every part and every number on the stage is in the passages the stage `cites` (up to 6) | "Sourced", with the stage's source chips |
| `worked` | Your worked example, applying a rule the cited passages state. It cites them too | "Worked example" |
| `illustrative` | The shape is the point, not the particulars. It need cite nothing | "Illustrative" |

- **Numbers on a `sourced` stage must be in the passages it cites**: labels, values, read-outs,
  what the beats `set` or `split`, and the clip's `description`. A count you derived (990 minus 95)
  is in no passage, so a stage that shows it is `worked`. Most stages are: sources give rules and a
  few figures, rarely a dataset.
- **A stage the learner can drag is never `sourced`**, and nor is a curve chart: dragging puts
  numbers on screen that no passage contains. Mark it `worked` and keep its `cites`. The cited
  facts stay where they were, in the captions of the beats before the explore: the rule a formula
  applies is a `claim` with its source.
- **Never draw data you do not have as if it were measured.** If you chose the numbers to show a
  shape, the stage is `illustrative`: leave the unit off and say so in a caption ("Made-up
  numbers, real rule."). A lesson in which more than half the clips that show data are
  `illustrative` is published with a warning.
- **Keep charts fair.** A line chart spaces its positions evenly whatever the labels say: if each
  step multiplies (8, 64, 512), a caption must say so. A timeline is in order, not to scale. Say
  what one dot is (`legend`: "1 dot = 1,000 people"). An arrow is a claim: draw only the relations
  your sources support.
- **`description` is the clip for someone who cannot see it**: what is on stage, what happens and
  the point it makes, in 30 to 400 characters. Never "an animation of binary search".

No tool can check whether an illustrative shape is fair, a formula the right model or a worked
case realistic. Read each stage beside its passages.

## Checkpoints

A checkpoint is a scene of its own: one question that assesses one objective, answered outside any
clip. Using an idea strengthens it more than seeing it again.

**Test use, not memory of your captions.** Give a case the lesson did not show. Set
`level: "apply"` when the idea must be used on a new case, `"recall"` when something taught is
retrieved. A standard or deep lesson needs at least one `apply` checkpoint.

**Every wrong option is one named misconception** [BAR]. `misconception` is required on each wrong
option of a `single` question; it is not shown to the learner. If you cannot say who would choose
an option and what they believe, delete it: three good options measure as well as four. What
the learner said in calibration is your best distractor.

| | Stem | Options | Feedback |
|---|---|---|---|
| Weak | "Which of the following is NOT true about binary search?" | One far longer than the rest, and "All of the above" | "Incorrect." / "Correct!" |
| Strong | "You search a sorted list for 70. The middle element is 50. What happens next?" | "Search only the half after it" / "Search only the half before it" (mixes up the sides) / "Move on one element at a time" (thinks it a faster linear scan) | "That half holds values smaller than 50, so 70 cannot be there." |

**Feedback says why, in a sentence**: one error, one fix, no praise. The `explanation`
appears after the attempt with its source chips; cite evidence that a clip also cites.

Four types: `single` to choose or diagnose (3 or 4 options, exactly one correct, alike in
length); `order` for a process or a ranking (3 to 6 items, given in the correct order); `numeric`
for a value worked out (with a `tolerance` wide enough for sensible rounding); `reflect` to
explain why (a cited `modelAnswer` and 2 to 4 `lookFor` points, not graded). At least half the
checkpoints must be graded types. No tool can check that a stem is unambiguous: read each question
as a learner who knows the material and is looking for a reason to object.

## Worked examples

The evidence ids stand for passages each lesson had stored. "What a positive test really tells
you", a standard lesson for a newcomer who guessed "about 80%":

| Scene | Stage | The learner |
|---|---|---|
| `open` clip | `words` | Is left with a question: "She tests positive. How likely is it that she is ill?" |
| `count` clip | `dots` | Predicts her chances before the two positive groups merge |
| `q-count` checkpoint | | Counts through a different test (`numeric`, apply) |
| `inverse` clip | `chart` bars | Taps the bar that answers "she tested positive" |
| `crowd` clip | `dots`, explored | Drags how common cancer is, to the tipping point |
| `q-alarm` checkpoint | | Judges a smoke alarm that sounds for nearly every fire (`single`, apply) |

### A rate that reshapes a crowd

The clip `crowd`: a proportion on `dots`, one slider, a goal.

<!-- example: scene -->
```json
{
  "id": "crowd",
  "kind": "clip",
  "title": "The same test in a different crowd",
  "description": "One thousand dots, one per woman screened, in three groups: 8 with cancer who test positive, 95 who test positive without it, and 897 who test negative. A slider changes how common cancer is: the two positive groups grow and shrink, and a read-out gives the share of positives that are right.",
  "stage": {
    "kind": "dots",
    "total": 1000,
    "legend": "1 dot = 1 woman screened",
    "group": { "id": "all", "label": "Women screened" },
    "stats": [{ "id": "right", "label": "Positives with cancer", "value": 8, "unit": "%" }],
    "cites": ["e4", "e5", "e6"],
    "provenance": "worked"
  },
  "beats": [
    {
      "caption": { "type": "claim", "text": "Of 1,000 women screened, 103 test positive, and only 8 of them have cancer.", "cites": ["e4", "e9"] },
      "do": [
        {
          "verb": "split",
          "target": "all",
          "into": [
            { "id": "hits", "label": "Cancer, positive", "count": 8, "tone": "accent" },
            { "id": "alarms", "label": "No cancer, positive", "count": 95, "tone": "warn" },
            { "id": "rest", "label": "Negative", "count": 897, "tone": "muted" }
          ]
        }
      ]
    },
    {
      "caption": { "type": "example", "text": "So a positive result is right about 8 times in 100.", "basedOn": ["e9"] },
      "do": [{ "verb": "focus", "targets": ["hits", "alarms"] }, { "verb": "show", "target": "right", "on": "8 times" }]
    },
    {
      "caption": { "type": "framing", "text": "Same test. Now change the crowd it is used on." },
      "do": [{ "verb": "focus" }, { "verb": "pulse", "target": "right" }]
    }
  ],
  "explore": {
    "prompt": "Drag to make cancer more or less common. Watch the two positive groups.",
    "controls": [{ "id": "rate", "label": "Women with cancer", "min": 1, "max": 30, "step": 1, "value": 1, "unit": "%" }],
    "bind": [
      { "target": "hits", "expr": "round(0.8 * 10 * rate)" },
      { "target": "alarms", "expr": "round((1000 - 10 * rate) * 95 / 990)" },
      { "target": "right", "expr": "round(100 * 8 * rate / (8 * rate + (1000 - 10 * rate) * 95 / 990))" }
    ],
    "goal": {
      "text": "Find the crowd in which a positive result is as likely right as wrong.",
      "when": "abs(8 * rate - (1000 - 10 * rate) * 95 / 990) < 8",
      "done": "Here about one woman in ten has cancer, so true positives have caught up with false alarms. The test never changed: the crowd did."
    }
  }
}
```

Why it is built this way. The learner met these groups one division at a time in `count`, so this
clip rebuilds them in one beat and gets to the slider. The formulas are the cited facts:
`10 * rate` women in 1,000 have cancer, the test finds 8 in 10 of them and alarms 95 of every 990
others. At `rate` 1 they give 8, 95 and 8%, exactly what the beats left on stage. `rest` has no
formula: it keeps what the bound groups leave. The goal holds at 10 and 11 only, and at neither
end. The stage is `worked`, not `sourced`, because 897 is a subtraction that no passage states and
every dragged number is computed.

### Two curves and the point where they cross

A curve chart with two sliders, a marked point, a prediction by options, and a goal that neither
slider reaches alone.

<!-- example: scene -->
```json
{
  "id": "market",
  "kind": "clip",
  "title": "Where the price settles",
  "description": "Amount against price. The amount buyers want falls as the price rises; the amount sellers offer climbs. A point marks where the lines cross: the market price. Two sliders add or remove buyers and sellers; each tilts one line, and the crossing moves.",
  "stage": {
    "kind": "chart",
    "mark": "curve",
    "yLabel": "Amount a day",
    "x": { "label": "Price", "min": 0, "max": 10 },
    "min": 0,
    "max": 200,
    "curves": [
      { "id": "demand", "label": "Buyers want", "expr": "buyers / 100 * (120 - 12 * x)", "tone": "accent" },
      { "id": "supply", "label": "Sellers offer", "expr": "sellers / 100 * 12 * x" }
    ],
    "points": [{ "id": "price", "label": "Market price", "x": "10 * buyers / (buyers + sellers)", "on": "demand" }],
    "stats": [{ "id": "sold", "label": "Sold a day", "value": 60 }],
    "cites": ["e2", "e3"],
    "provenance": "illustrative"
  },
  "beats": [
    {
      "caption": { "type": "claim", "text": "When the price rises, buyers want less.", "cites": ["e2"] },
      "do": [{ "verb": "draw", "target": "demand" }]
    },
    { "caption": { "type": "claim", "text": "And sellers offer more.", "cites": ["e2"] }, "do": [{ "verb": "draw", "target": "supply" }] },
    {
      "gate": {
        "prompt": "Sellers start at a high price and much of what they offer goes unsold. Where does the price end up?",
        "options": [
          { "text": "Where the two lines cross", "correct": true, "feedback": "Yes. Only there does the amount offered match the amount wanted." },
          { "text": "It stays high: sellers decide", "correct": false, "feedback": "Unsold goods cost sellers money, so they cut the price." },
          {
            "text": "It falls all the way to zero",
            "correct": false,
            "feedback": "Below the crossing buyers want more than is offered, and bid the price back up."
          }
        ]
      },
      "caption": { "type": "claim", "text": "The price settles where the amount offered equals the amount buyers want.", "cites": ["e3"] },
      "do": [{ "verb": "show", "target": "price" }, { "verb": "pulse", "target": "sold" }]
    },
    {
      "caption": { "type": "framing", "text": "Made-up numbers, real rule. Now move the market yourself." },
      "do": [{ "verb": "pulse", "target": "price" }]
    }
  ],
  "explore": {
    "prompt": "Add or remove buyers and sellers. Watch where the crossing goes.",
    "controls": [
      { "id": "buyers", "label": "Buyers", "min": 50, "max": 150, "step": 10, "value": 100, "unit": "%" },
      { "id": "sellers", "label": "Sellers", "min": 40, "max": 160, "step": 10, "value": 100, "unit": "%" }
    ],
    "bind": [{ "target": "sold", "expr": "round(1.2 * buyers * sellers / (buyers + sellers))" }],
    "goal": {
      "text": "Get more sold than today without the price moving.",
      "when": "abs(10 * buyers / (buyers + sellers) - 5) < 0.1 and 1.2 * buyers * sellers / (buyers + sellers) > 62",
      "done": "More buyers pull the price up and more sellers push it down. Add both in step and the two pulls cancel: only the amount sold grows."
    }
  }
}
```

Why it is built this way. Each slider tilts one curve and leaves the other still to compare
against. The point's `x` is the crossing worked out from the controls, so it rides `demand`
wherever the curves go and stays well inside the axis. More buyers alone raise the price and more
sellers alone lower it; the goal needs both, and the corner with both sliders at their ends misses
it because the two ranges differ. The stage is `illustrative` and the last caption says so; the
rules it draws are cited claims.

### A tap on the picture

A short `cells` clip whose prediction is answered by tapping a cell.

<!-- example: scene -->
```json
{
  "id": "next",
  "kind": "clip",
  "title": "Which cell is checked next?",
  "description": "Seven sorted numbers: 3, 8, 15, 23, 42, 57, 91. The search is for 42. It looks at the middle cell, 23, which is too small, so the first four cells are ruled out. Then it looks at the middle of the last three, 57, which is too big, and one cell is left: 42.",
  "stage": {
    "kind": "cells",
    "cells": [
      { "id": "c0", "label": "3" },
      { "id": "c1", "label": "8" },
      { "id": "c2", "label": "15" },
      { "id": "c3", "label": "23" },
      { "id": "c4", "label": "42" },
      { "id": "c5", "label": "57" },
      { "id": "c6", "label": "91" }
    ],
    "pointers": [{ "id": "mid", "label": "mid", "side": "above" }],
    "brackets": [{ "id": "range", "label": "still possible" }],
    "stats": [{ "id": "want", "label": "Looking for", "value": "42" }],
    "cites": ["e1"],
    "provenance": "worked"
  },
  "beats": [
    {
      "caption": { "type": "claim", "text": "Binary search compares the target with the middle element.", "cites": ["e1"] },
      "do": [{ "verb": "move", "target": "range", "to": ["c0", "c6"] }, { "verb": "move", "target": "mid", "to": "c3" }]
    },
    {
      "caption": { "type": "example", "text": "23 is smaller than 42, so the first four cells cannot hold it." },
      "do": [{ "verb": "set", "between": ["c0", "c3"], "tone": "muted" }, { "verb": "move", "target": "range", "to": ["c4", "c6"], "with": true }]
    },
    {
      "gate": {
        "prompt": "Three cells are still possible. Tap the one the search checks next.",
        "pick": ["c5"],
        "right": "Yes: the middle of what is left. Whatever it holds, the search can rule out half again.",
        "wrong": "The search cannot see where the target is. Which look rules out the most, whatever it finds?"
      },
      "caption": { "type": "example", "text": "The middle of the three is 57. Too big, so only 42 is left." },
      "do": [
        { "verb": "move", "target": "mid", "to": "c5" },
        { "verb": "set", "between": ["c5", "c6"], "tone": "muted" },
        { "verb": "set", "target": "c4", "tone": "good", "with": true }
      ]
    }
  ]
}
```

Why it is built this way. The first check plays in full, so the learner has a rule to apply before
being asked. When the gate opens nothing marks the right cell: the pointer still rests on 23 and
the bracket covers three cells alike. The tempting wrong tap is 42 itself, and `wrong` answers
that belief without naming a cell or a number. The captions with 23, 42 and 57 are `example`:
those numbers are the worked case, not the source's.

## Failure modes

How lessons written by a model go wrong, and the counter-rule for each. Failures of choreography
(every beat a fade, everything at once) are in [motion.md](motion.md).

| Failure | What it looks like | Counter-rule |
|---|---|---|
| Captions that are paragraphs | The stage waits while the learner reads | One line, about 16 words. Too long means two changes: split the beat |
| Pills and cards in place of a picture | Every part is a phrase and every verb is `show` | Find what changes. Blank the labels: does the stage still say something? |
| An illustrative chart passed off as data | Invented values with units, drawn like measurements | `illustrative`, no unit, and a caption that says so |
| A gate with nothing at stake | "Ready?", a name to recall, or an answer given only in words | The gate goes on the outcome beat, and the motion answers it |
| A tap gate with one obviously highlighted part | The right cell is the accented one, or the pointer rests on it | When the gate opens, the right part looks like its neighbours |
| A slider that changes nothing the learner can see | Only a distant read-out moves, or it repeats the slider | Bind the parts the eye is on; in your head, drag it from end to end |
| A goal reachable by dragging to the end | "Make it bigger": sweep the slider across | A tipping point, a balance of two controls, or a condition. Try both ends |
| A goal that restates a number | "Set the rate to 10%" | Name the outcome in the learner's terms, never the setting |
| An explore before the learner knows the parts | Sliders on a stage nobody has explained | Build and name the parts in the beats; explore last |
| Interactivity as decoration | A slider on a list of facts; a tap with one candidate | No relationship, no explore. No real choice, no gate |
| Coverage over understanding | Eight topics, none usable | Few objectives; cut what serves none |
| "Got it?" after a clip | A self-rating in place of a task | An action inside the clip, a checkpoint after it |

## Before you submit

Read each clip once as the learner and check:

1. Can I say this clip's idea in one sentence, and does the title say it?
2. What does the learner do in it, and do they do it before I explain?
3. Does every beat change the picture, under one line that says what the picture cannot?
4. Is every fact a `claim` or `quote` whose excerpt says it, and every number on a `sourced`
   stage in the passages the stage cites?
5. Is the gate at the crux, does the motion answer it, and does anything give a tap away?
6. For an explore: have I worked every formula at both ends and at the start, does the goal fail
   at both ends, and does `done` say why?
7. For a checkpoint: is it a new case, and can I name the belief behind each wrong option?

## Sources

- [ALF11] Alfieri and others 2011, discovery-based instruction: https://www.fisme.science.uu.nl/publicaties/literatuur/2011_alfieri_discovery_learning.pdf
- [BAR] Barton 2018, diagnostic questions: https://www.aft.org/node/12578
- [BB16] Berney and Bétrancourt 2016, does animation enhance learning?: https://archive-ouverte.unige.ch/unige:92234
- [BR21] Brod 2021, predicting as a learning strategy: https://pmc.ncbi.nlm.nih.gov/articles/PMC8642250/
- [CR04] Crouch and others 2004, classroom demonstrations (record): https://www.compadre.org/portal/items/detail.cfm?ID=2329
- [LOW04] Lowe 2004, exploring a dynamic visualization (record): https://espace.curtin.edu.au/handle/20.500.11937/29032
- [PBB21] Ploetzner and others 2021, when animations help: https://phfr.bsz-bw.de/files/1913/s11251-021-09541-w.pdf
- [PS13] Paik and Schraw 2013, animation and illusions of understanding (record): https://www.proquest.com/docview/1095628114
