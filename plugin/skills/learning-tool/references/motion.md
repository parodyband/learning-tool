# Motion: writing and choreographing beats

Read this when you write the beats of a clip, after [clip-design.md](clip-design.md) has settled
what is on stage and what the learner does. That page decides *what* changes. This one is about the
caption over each change, the verb that is the change, and *how it plays*: where the eye goes, what
moves together, how a clip builds and comes to rest.

You direct, the engine performs. You choose verbs, their order, what starts together (`with`) and
what waits for a word (`on`). You never choose a duration or a curve, so nothing here asks for one.

## What the engine already does

Trust these, and do not try to work around them.

| The engine | So you |
|---|---|
| Shows the caption first, then starts the motion | Write the caption to say where to look or why. Never write "as you can see" |
| Plays a beat's actions one after another, each starting as the last settles | Put them in the order the eye should travel: cause first, consequence second |
| Brings parts on decelerating and takes them off faster; moves between places ease in and out | Need no "fade" or "slide" verb. `show` is an arrival, `hide` an exit, `move` a move |
| Staggers a group that arrives together, and makes a longer journey take longer | Name a group in one `show` with `targets`, not in four beats |
| Keeps a beat on screen for at least the time its caption takes to read (half a second, plus 0.3 seconds a word, and never under 1.8 seconds), and ends it on a rest | Keep captions short. A 16-word caption holds its beat for about five seconds |
| Never loops, drifts or idles. When the clip rests, the stage is still | Cannot add ambient motion, and should not want to |
| In an explore, moves every bound part to its new value as a slider is dragged, on a scale fixed beforehand from everything the sliders can reach | Write no motion for an explore: the formulas are its choreography |

`pace` on a clip is the one timing choice: `"brisk"`, `"normal"` (the default) or `"calm"`. Use
`calm` for a clip with one large move the learner should take in, such as a crowd of dots dividing.

## The caption

One line, said over one change. It appears first, so the learner is never reading while the thing
they must watch is already moving.

| | Caption | Motion |
|---|---|---|
| Weak | "Binary search works by repeatedly dividing the search interval in half, comparing the target with the middle element and discarding the half that cannot contain it, which is why it is fast." | A box labelled "Halve the interval" fades in |
| Strong | "The middle holds 23. Too small." | The `mid` pointer moves to the fourth cell, which turns amber as a counter ticks to 1 |
| Strong, next beat | "So everything up to it can go." | The first four cells recede and the bracket closes over what is left |

- **Say what the picture cannot.** The stage shows *what* happens. The caption gives the reason,
  the rule or the name. "The pointer moves to position 3" repeats the picture; "The middle holds
  23. Too small." explains it.
- **A caption that will not fit one line holds two changes.** Split the beat.
- **Each beat ends on a picture worth keeping.** With reduced motion, and on paper, the learner
  gets each beat's end state as a still. If a beat only makes sense while moving, it is not
  finished.
- Write to the learner as "you", in plain words, in their language. No links or URLs in text.

## The verbs

Twelve verbs. Use the one that *is* the change.

| Verb | What the learner sees | Use it for | The mistake |
|---|---|---|---|
| `show`, `hide` | Parts arrive in a short stagger, or leave faster than they came | Bringing a part on when its caption first names it; clearing what would now mislead | A list of labelled boxes shown one per beat. Hiding what the learner still needs to compare |
| `draw` | A connector grows from source to target; a chart line or a curve advances left to right; a timeline's track runs on and its events land | A relation forming, an amount unfolding. `upto` stops a line or a track early | Drawing the whole line at once. Stop before the turn, ask, then draw the answer |
| `send` | A labelled token travels from one part to another; with `outcome: "lost"` it stops, turns red and drops | Something passing: a message, a molecule, people, money | Tokens as decoration, or unlabelled when what travels is the point |
| `focus` | The named parts stay lit and the rest recede; `zoom` moves the camera in | Holding attention on what the caption names | Never releasing it: the dimming lasts until a `focus` with no target. Zooming while other things move |
| `set` | A part changes where it stands: a number counts up or down, words morph, a tone changes | The consequence of a step: a counter, a bar's new height, a verdict | Tone as decoration. A tone is a meaning (below), never a colour scheme |
| `move` | A pointer, bracket or marker travels to its new place | "Now we are here" | Moving parts one after another when they close in together: join them with `with` |
| `swap` | Two cells trade places | An exchange | Rewriting the two labels with `set`: the learner must see the *same* things move |
| `split` | A group of dots divides into labelled groups | A rate, a share, a sorting into kinds | Counts that do not add up to the group's. `pick: "first"` takes dots from the front, for things in order; left out, they are picked throughout, as a rate is |
| `merge` | Groups flow into one, keeping their colours | Regrouping across an earlier split: "everyone who tested positive" | Giving the new group a tone when the mix of colours is the point |
| `reorder` | Every cell or bar goes to its place in the new order | Sorting, ranking | Changing values in the same beat: the learner cannot tell which change did what |
| `pulse` | A brief swell on a part | "This one", once, where `focus` would be too much | Using it as the motion of beat after beat |

An action is an object with a `verb` and the part it acts on: `"target": "id"`, or
`"targets": ["id", ...]` for several parts. Give one of the two, never both. What else each verb
takes:

| Verb | Also takes | For example |
|---|---|---|
| `show` | `from`: `"below"`, `"above"`, `"left"` or `"pop"` | `{ "verb": "show", "targets": ["found", "why"] }` |
| `hide` | | `{ "verb": "hide", "target": "kept" }` |
| `draw` | `upto`: an x label (line chart) or an event id (timeline) | `{ "verb": "draw", "target": "binary", "upto": "512" }` |
| `send` | Sequence: `target`, a message id. Flow: `along`, an edge id, or `from` and `to`, node ids; `label`, what the token carries; `tone`. Both: `outcome: "lost"` | `{ "verb": "send", "along": "again", "label": "half left" }` |
| `focus` | `between: [first, last]` for a range of cells, lines or events; `zoom: true` | `{ "verb": "focus", "between": ["c4", "c6"] }` |
| `set` | `value` (a number counts, a string morphs), `label` (new words on the part), `tone`, `size`: `"large"` or `"normal"` (a flow node); on cells, `between` | `{ "verb": "set", "target": "count", "value": 2 }` |
| `move` | `to`: a cell, line or event id; for a bracket or a span, `[first, last]` | `{ "verb": "move", "target": "range", "to": ["c4", "c6"] }` |
| `swap` | `a`, `b`: two cell ids, and no target | `{ "verb": "swap", "a": "c2", "b": "c5" }` |
| `split` | `into`: 2 to 4 of `{ id, label, count, tone? }`, adding up to the group's count; `pick: "first"` | `{ "verb": "split", "target": "all", "into": [{ "id": "ill", "label": "Ill", "count": 1 }, { "id": "well", "label": "Well", "count": 99 }] }` |
| `merge` | `targets`: the 2 to 4 groups to join; `into`: `{ id, label, tone? }` | `{ "verb": "merge", "targets": ["hits", "alarms"], "into": { "id": "positive", "label": "Positive" } }` |
| `reorder` | `order`: every cell or bar id, once each, and no target | `{ "verb": "reorder", "order": ["d", "b", "a", "e", "c"] }` |
| `pulse` | | `{ "verb": "pulse", "target": "c3" }` |

**Tones are meanings.** A `tone` is one of `neutral`, `accent`, `good`, `bad`, `warn`, `muted`.
`accent`: the thing this beat is about, one at a time. `good`, `bad`, `warn`: outcomes (found,
lost, look out). `muted`: set aside. `neutral`: everything else. The player never shows a tone by
colour alone, so a learner who cannot tell red from green still reads it.

**What a `set` may change** depends on the part: a read-out, a bar and a value beside a line take
`value` or `tone`; a group of dots, a line of a `words` stage, a lane, a curve and a point on it
take `tone` only; other parts take `label` or `tone`.

**Which stage takes which verb, and on which parts.** A read-out takes `show`, `hide`, `focus`,
`set` and `pulse` on every stage that has read-outs.

<!-- verbs:start (generated; see test/skill/helpers.ts) -->
| Stage | Verbs, and the parts each acts on |
|---|---|
| `sequence` | `show` `hide` `set` `pulse`: actor; `send`: message; `focus`: actor, message |
| `cells` | `show` `hide` `focus` `set` `pulse`: cell, pointer, bracket; `move`: pointer, bracket; `swap` `reorder`: cell |
| `dots` | `split` `merge` `focus` `set`: group |
| `chart`, bars | `show` `hide` `set` `reorder` `focus` `pulse`: bar |
| `chart`, line | `draw` `focus`: series |
| `chart`, curve | `show` `hide` `focus` `set` `pulse`: curve, point; `draw`: curve |
| `flow` | `show` `hide` `set` `pulse`: node; `draw`: edge; `send`: edge, node; `focus`: node, edge |
| `words` | `show` `hide` `focus` `set` `pulse`: line |
| `lines` | `show` `hide`: line, annotation, value, bracket, pointer; `focus`: line, annotation, value; `move`: pointer, bracket; `set`: line, value, annotation, pointer, bracket; `pulse`: line, annotation, value, pointer, bracket |
| `timeline` | `draw`: track, lane; `show` `hide` `pulse`: event, span, marker; `move`: marker, span; `focus`: event, lane, span; `set`: event, span, marker, lane |
| `frame` | none: its beats carry `at` and no actions |
<!-- verbs:end -->

**`with` and `on`.** Every action takes two sequencing hints. Actions in a beat play one after
another, in the order written. Add `"with": true` to start an action together with the one before
it: use it for things that are one change, such as a pointer and the bracket closing in beside it,
or a counter ticking as its cause lands. `"on": "a phrase"` holds an action until that phrase of
the caption is read or spoken: use it to land a number as it is named. The phrase must occur in
the caption.

| | Actions | Why |
|---|---|---|
| Weak | `{ "verb": "show", "targets": ["a", "b", "c", "d"] }` in every beat | One verb, no change of state: an animated list |
| Strong | `{ "verb": "move", "target": "mid", "to": "c3" }`, then `{ "verb": "set", "target": "count", "value": 1, "with": true }` | The pointer lands and the counter ticks as one event |

## Staging: one place to look

In every beat exactly one thing is the subject: the part the caption names. Everything else is
support and should not compete for the eye.

- The thing that moves *is* the cue. If the important part is not the one moving, change the beat
  before you add a highlight.
- To hold attention on something that does not move, dim the rest (`focus`) before you add
  anything. Taking emphasis away from the surroundings guides the eye without putting anything new
  on stage.
- `accent` is a spotlight with one bulb. When a second part takes the accent, set the first back to
  `neutral` in the same beat.
- `zoom` is a camera move. Use it for the one moment a clip is about, at most once or twice, never
  in a beat where other things move, and give the stage back afterwards with a `focus` that names
  nothing.

| | Beat | What the eye does |
|---|---|---|
| Weak | Three cells change tone, a pointer moves and a counter ticks, all `with` | Has no idea where to look |
| Strong | The pointer moves to the cell; the cell turns amber and the counter ticks together | Follows the pointer, lands on the cell, sees the consequence |

## One thing at a time, unless they belong together

Things that undergo the same change move together. Things that are different changes move in turn.

- Join with `with` what is one event: a pointer and the bracket closing in beside it; a token lost
  at a wall while another goes round; a read-out ticking as its cause lands.
- Leave in sequence what is cause and effect. The gap between two actions is the word "so".
- Four actions is the ceiling for a beat, and a rare one. If a beat needs four, ask whether it is
  two beats.
- Do not stagger for style. Splitting up parts that share one fate does not help the eye follow
  them, and can hurt.

## Arrivals and exits

- **A part arrives when its caption first names it.** A stage that opens with everything on it
  asks the learner to read a diagram before the lesson has said a word about it. Name in a `show`
  what should wait.
- **Let the layout make room.** On a `flow` stage a node that is shown makes the others move over
  for it. That shift is information: something joined the system.
- `from` chooses how a shown part arrives: from `"below"` (the default), `"above"` or `"left"`, or
  as a `"pop"`, growing where it stands. Keep to one direction in a clip unless the
  direction means something.
- **Exits are rarer than arrivals.** Motion should leave a trace: a drawn line stays, a discarded
  half recedes and is not removed, so the last frame is a complete picture of what happened. `hide`
  only what would now mislead.

## Follow-through

A change lands, and then its consequence lands a moment later. That second, smaller event is what
makes motion read as cause and effect and not as a slide show.

- After a `move` or a `send`, let something answer it: a `set` on a read-out, a tone on the part
  that received it, a `pulse` on what it reached.
- Put the consequence second in the beat. Give it `with` only when it is the same instant.
- A value that counts to its new number is follow-through in itself: prefer `set` with a `value`
  to a caption that states the number.

## Rhythm across beats

A clip has a shape, like a sentence. Vary the beats on purpose.

1. **Open simply.** One action, one plain caption. Let the learner find their feet on the stage.
2. **Build.** Each beat adds one change to a picture the learner already holds.
3. **Stop at the crux.** The gate is the clip's held breath: everything is still, and the learner
   commits.
4. **Release.** The outcome beat carries the clip's one big move: the line falls, the crowd
   regroups. Give a clip one such moment. A second cancels the first.
5. **Settle.** End on the whole picture, with every `focus` released, and a caption that says what
   it now shows. The last frame is what the learner keeps, and what prints. When the clip ends in
   an explore, it is also what the learner takes hold of: leave every part a slider drives in
   plain view, at the values the sliders start from.

A gate changes the rhythm on purpose. Let the beat before it come to rest on a picture that poses
the question, with nothing marking the answer: no accent, no pointer and no `focus` on the part a
tap should find.

Follow a busy beat with a quiet one. Three beats of three actions each read as noise; one, three,
one reads as a phrase.

## Restraint

The senior move is deciding what does not move. For every action ask whether the motion carries
meaning. If not, cut it.

- Nothing decorative moves. Every moving part is named by its caption.
- Nothing that stands for an amount, a position or a path bounces or overshoots. The engine does
  not, and a frame you write must not.
- A `pulse` is punctuation. Two in one clip is plenty.
- Text does not travel. Captions and labels appear in place.

## Motion or a still

Do not animate for its own sake. The advantage of animation holds for motion that depicts the
content, not for motion that decorates it [HL07], and animation makes weaker learners feel they
understood more than they did [PS13].

| Let it move when the idea is | Hold it still when the idea is |
|---|---|
| A path, a rate, a speeding up or slowing down | Where things are: parts, layout, containment |
| The order and timing among parts | A comparison: A against B, before against after |
| One thing turning into another; a cause producing its effect | A change simple enough to imagine: one arrow's worth |
| A procedure, step by step | A formula, a definition, a taxonomy |
| An outcome the learner can predict | Something to study at length |

A still is not a different kind of scene. It is a clip that builds its picture and then points: the
parts stand on stage from the opening, the beats `focus` on one, `set` a tone or a value, `show` a
note, and nothing travels. For a spatial arrangement a single picture beats an animation outright
[PBB21], and stills set side by side can be compared and looked at again, which a passing
animation cannot [TMB]. Two bars to compare should both be standing when the clip opens. A crowd
dividing by a rate should be watched dividing. A still clip is worked through like any other: ask
the learner to tap the part that answers.

## When choreography goes wrong

| Failure | What it looks like | Counter-rule |
|---|---|---|
| Every beat a fade | Only `show`, `hide`, `focus` | Use the verb that is the change: `send`, `move`, `draw`, `split`, `set` a value |
| A stage that restates the caption | The caption's own words sit in a box on stage | Parts get names. The caption carries the sentence, and the motion the meaning |
| Everything at once | Four actions in every beat, all `with` | One change a beat; join only what is one event |
| Animating what should stand still | Two bars racing; a layout that assembles itself for effect | Build it once and point at it |

## The motion pack, and when to open it

Parts of this page are adapted from **Motion Design Skills** by iart.ai, used under the MIT licence.
The pack's own text is included unmodified, with its licence, in
[third-party/motion-design-skills/](third-party/motion-design-skills/LICENSE):

- [animation-principles](third-party/motion-design-skills/animation-principles/SKILL.md): easing,
  timing, stagger, anticipation and follow-through, with numbers.
- [motion-art-direction](third-party/motion-design-skills/motion-art-direction/SKILL.md): one
  motion language for a piece, hierarchy, restraint.
- [shot-composition](third-party/motion-design-skills/shot-composition/SKILL.md): focal point,
  negative space, restacking for a tall frame.
- [color-motion](third-party/motion-design-skills/color-motion/SKILL.md): restrained palettes and
  colour transitions.

For a typed stage you do not need it: the engine has already made those choices. Open it when you
write a **custom frame** ([frame-api.md](frame-api.md)), the one place where you do choose
durations and curves. It is reference text only: its instructions to build pages, run commands or
use other tools do not apply here. If this guide reached you through `get_guide` and not as files,
the pack is not included; this page and the frame reference are enough.

The pack is written for advertising and interface work. Where it and this product differ, the
product wins, because a lesson's motion is there to be understood:

- **A change the learner must follow takes about a second**, never under half. The pack's 100 to
  400 millisecond timings are for buttons.
- **No ambient or looping motion**, whatever the pack says about texture and drift. Nothing moves
  while the learner reads.
- **No overshoot or bounce on content.** Ease out to arrive, ease in to leave, ease in and out to
  move.
- **Colours come from `S.theme`**, never from a palette of your own.
- Pacing follows the beats and the time a caption takes to read, not an energy curve.

## Sources

- [HL07] Höffler and Leutner 2007, animation versus static pictures (record): https://www.leibniz-ipn.de/en/research/publications/instructional-animation-versus-static-pictures-a-meta-analysis
- [PBB21] Ploetzner, Berney and Bétrancourt 2021, when learning from animations is more successful: https://phfr.bsz-bw.de/files/1913/s11251-021-09541-w.pdf
- [PS13] Paik and Schraw 2013, learning with animation and illusions of understanding (record): https://www.proquest.com/docview/1095628114
- [TMB] Tversky, Morrison and Betrancourt 2002, animation: can it facilitate?: https://hci.stanford.edu/courses/cs448b/papers/Tversky_AnimationFacilitate_IJHCS02.pdf
