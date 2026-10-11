# Learning Tool

Learn anything from the AI agent you already use, as a lesson you can watch. Say "teach me how
vaccines work with Learning Tool" to Claude Code, Claude Desktop or any other MCP host. Your agent
asks two or three questions about what you already know, researches the topic with its own web
tools, builds a short visual lesson, and replies with a link.

The lesson is one self-contained HTML page that works offline. It is made for people who learn by
seeing: the lesson is a sequence of **clips**, and in a clip the picture is the lesson. And for
people who learn by doing: you work through a lesson, you do not sit through it.

Learning Tool runs no AI and no service. It is three things that make your own agent good at this:

1. **A skill** that teaches the agent how to design a lesson: how to find out what you know, how to
   source claims, how to turn an idea into a picture that moves, how to make you act before it
   explains, how to write questions that test understanding.
2. **A local MCP server** with eight fast, deterministic tools that store source excerpts, accept
   typed scenes, validate them and publish.
3. **A lesson player**: the published page itself.

## What a lesson is

**Clips.** A clip fills the stage with one picture and plays it: parts arrive, tokens travel, a line
is drawn, a crowd divides. One short caption at a time says what the picture cannot. You can play,
pause, scrub back and replay, set the speed, or have it pause after every beat. At a **prediction**
the clip stops before the outcome and waits for you to commit to an answer; then the motion is the
answer.

**Clips you can touch.** A lesson asks before it tells. A prediction may be a choice among answers
or a tap on the part of the picture you think is right; either way you are told why, and a wrong
tap gets a hint and another go. Where an idea is a relationship between quantities, the clip ends
by handing you the system to poke: drag a slider and the crowd regroups, the bars grow or the
curve bends as you go, towards a goal that takes understanding to reach. When you get there, the
lesson says why it worked.

**Nine kinds of stage.** The agent chooses the stage for the idea and says what is on it and what
happens; the player draws and animates it. The agent never writes a duration, an easing curve, a
position or a colour.

| Stage | Shows |
|---|---|
| `sequence` | Who sends what to whom, in order, and what gets lost on the way |
| `cells` | A row of values with pointers that walk it, brackets, swaps and reordering |
| `dots` | A crowd of up to a thousand that splits into groups and merges again |
| `chart` | Bars that grow, change and trade places, lines drawn left to right, or curves plotted from a formula |
| `flow` | Parts in a row and what passes between them |
| `words` | A few lines of large type, for an opening question |
| `lines` | Code, a derivation or text, line by line, with pointers and values that tick over |
| `timeline` | Events along a track, in parallel lanes if needed |
| `frame` | A custom animation: drawing code the agent wrote (see below) |

**Checkpoints and a recap.** Between clips come questions with feedback on every answer, each
assessing one stated objective, and the lesson ends by asking you to recall each objective before
it shows the takeaway.

**A source behind every claim.** Every caption that states a fact carries a numbered chip. Every
stage carries a badge saying where its content comes from: "Sourced" (with its own chips), "Worked
example" or "Illustrative". A picture you can drag is never marked "Sourced": the numbers you
produce by dragging are worked out by a formula, not quoted from a page.

**The custom frame.** When no typed stage can show an idea, the agent may write a small animation
as a pure function of time. That code never runs in the lesson page: the player runs it in a
sandboxed worker with no access to the page, the network or your files, behind its own play
button, and the stage says in words that the animation was written by your agent and is not
checked by Learning Tool. A lesson may hold at most two.

**The look.** Every lesson comes from the same studio: a full-width stage, one restrained palette
in light and dark, and motion with weight (parts arrive decelerating, groups arrive in a short
stagger, moves ease in and out). A lesson opens on a title card. Nothing loops or drifts while you
read. With reduced motion switched on each beat is shown as a still; on paper a clip prints as its
stills beside its text; on a narrow screen the stage restacks instead of shrinking.

## What it promises, and what it cannot

- **The agent cannot publish a lesson that fails validation.** Structure, length, pacing, citation and
  question-quality rules are checked by code, not by the agent's own judgement.
- **Lessons are typed data in a fixed format.** The agent never writes HTML or styles, and the page
  is drawn by the player from data, under a content security policy that allows no network requests
  at all. The one piece of agent-written code a lesson can contain is a custom frame, which is
  sandboxed and labelled as described above.
- **Every claim cites a stored source excerpt.** Each factual caption carries a numbered chip. Open
  it to see the excerpt the agent saved and a link that opens the real page at that passage. The
  numbers on a stage marked "Sourced" must appear in the passages that stage cites.

**The known limit.** The validator proves that each claim points at a stored excerpt and passes
textual grounding checks: numbers in a claim must appear in its excerpt, a claim must share terms with
its excerpt, a quotation must be found in it. It cannot prove that the excerpt is genuine or that it
supports the claim, because the server never fetches sources and does not understand them. Nor can
it judge a picture: whether a worked example is realistic, whether an illustrative shape is a fair
one, or what a custom frame draws. That is why the player always shows you the excerpt and a
one-click link to the passage in the real source, why every stage says where its content comes
from, and why nothing in Learning Tool calls a lesson "verified". Check the claims that matter to
you.

## Install

You need [Node.js](https://nodejs.org) 20 or later on your `PATH`, and an agent that can search and
read the web. Without web access the agent is instructed to stop rather than cite from memory.

### Claude Code

Learning Tool is a Claude Code plugin, and this repository is its marketplace:

```bash
claude plugin marketplace add parodyband/learning-tool
claude plugin install learning-tool@learning-tool
```

Inside a session the same thing is `/plugin marketplace add parodyband/learning-tool` followed by
`/plugin install learning-tool@learning-tool`. From a clone, a path such as `./learning-tool` works
in place of `parodyband/learning-tool`.

Then start a session and ask: **teach me binary search with Learning Tool**.

The plugin provides the `learning-tool` skill and an MCP server named `lt`. To try it for one session
without installing, run `claude --plugin-dir ./learning-tool/plugin`.

The plugin runs the bundled server at `plugin/server/learning-tool.mjs`. If that file is missing from
your clone, build it once with `npm install && npm run build`.

### Any other MCP host

Add the server to the host's MCP configuration, using the absolute path of your clone:

```json
{
  "mcpServers": {
    "learning-tool": {
      "command": "node",
      "args": ["/absolute/path/to/learning-tool/plugin/server/learning-tool.mjs"]
    }
  }
}
```

The server is a local stdio process. Hosts without skill support still get the guidance: the server
sends a summary as its MCP instructions, offers a `teach` prompt, and returns the full guide from its
`get_guide` tool. Hosts that load Agent Skills can also be pointed at `plugin/skills/learning-tool`.

### Where things go

| What | Where |
|---|---|
| Published lessons | `~/LearningTool/lessons/` |
| Drafts and the voice cache | `~/LearningTool/.state/` |
| A different home | Set `LEARNING_TOOL_HOME` |
| The local link | `http://127.0.0.1:47821/...` while the host app is open. Set `LEARNING_TOOL_PORT` to change the port |

The file link always works, offline included. The `127.0.0.1` link is served by the same process, to
this machine only, for as long as the host app is running.

## The tools

The agent calls these; you do not need to. They are listed here so you know what your agent can do.

| Tool | What it does |
|---|---|
| `start_lesson` | Begins a lesson: topic, language, depth (about 5, 10 or 20 minutes) and what the learner already knows |
| `save_evidence` | Stores verbatim excerpts from sources, each with its URL. Excerpts are never edited afterwards |
| `plan_lesson` | Checks the objectives and the outline (clips, checkpoints and a recap), and returns a template for each scene |
| `submit_scene` | Checks one clip, checkpoint or recap against the plan, the stored evidence and the rules. Accepts or rejects it with specific fixes |
| `validate_lesson` | Reports on the lesson as a whole without publishing |
| `publish_lesson` | Validates once more, refuses on any error, and writes the lesson page |
| `get_lesson` | Shows where a lesson stands, or lists recent lessons |
| `get_guide` | Returns the lesson-design guide, by section |

Every result has the same shape and names the next step, so an agent that loses the thread can pick it
up again. The server never fetches a URL: validation is deterministic and offline.

The same binary has two commands for people:

```bash
node plugin/server/learning-tool.mjs verify ~/LearningTool/lessons/some-lesson.html
node plugin/server/learning-tool.mjs voice-check
```

`verify` re-validates the lesson embedded in a published file and checks it against the file's
receipt. `voice-check` reports whether voice is configured and reachable.

## Voice (optional)

Lessons are silent. If you want the captions read aloud as the clips play, you can give Learning
Tool your own [ElevenLabs](https://elevenlabs.io) API key. When a key is set, publishing a lesson
sends its caption text to ElevenLabs and embeds the returned audio in the page. Without a key,
nothing is sent anywhere. Sound never starts by itself: it plays only when you press Play with
voice switched on.

- **What is sent:** the caption of each beat, each question's prompt and the recap's takeaways, as
  plain text, to `https://api.elevenlabs.io` and nowhere else.
- **What is not sent:** source excerpts and URLs, predictions, answer options and feedback, what is
  drawn on a stage, anything about you or your conversation.
- **Cost:** ElevenLabs bills your account by the character. A ten-minute lesson is roughly ten
  thousand characters. Clips are cached locally, so republishing unchanged text costs nothing, and one
  publish sends at most 12,000 characters unless you raise the limit.

**Claude Code:** run `/plugin configure learning-tool@learning-tool` in a session and enter the key in
the "ElevenLabs API key (optional)" field. Claude Code stores it in your system's secure credential
store and passes it to the Learning Tool server. From a shell, `claude plugin configure
learning-tool@learning-tool` shows whether it is set.

**Other hosts:** add the variable to the server's entry in the host's MCP configuration:

```json
{
  "mcpServers": {
    "learning-tool": {
      "command": "node",
      "args": ["/absolute/path/to/learning-tool/plugin/server/learning-tool.mjs"],
      "env": { "LEARNING_TOOL_ELEVENLABS_API_KEY": "your ElevenLabs key" }
    }
  }
}
```

| Variable | Meaning | Default |
|---|---|---|
| `LEARNING_TOOL_ELEVENLABS_API_KEY` | Your key. Voice is off without it. The generic `ELEVENLABS_API_KEY` is deliberately not read | unset |
| `LEARNING_TOOL_ELEVENLABS_VOICE_ID` | The voice to use | chosen from your account's voices |
| `LEARNING_TOOL_ELEVENLABS_MODEL` | The model to use | `eleven_multilingual_v2` |
| `LEARNING_TOOL_VOICE_MAX_CHARS` | The most characters one publish may send | `12000` |

Your agent will never ask for the key and is instructed to refuse one pasted into the chat. If voice
fails for any reason, the text lesson is still published. Narration is machine-generated and credited
in the page; the text is authoritative.

## Development

```bash
npm install
npm run build        # player bundle, the guide, and the server bundle at plugin/server/learning-tool.mjs
npm run typecheck    # tsc for the server and core, and for the browser code
npm test             # build, then the vitest suites
npm run test:player  # build, then the Playwright suites (Chromium and WebKit)
npm run check        # all of the above
```

Useful while working:

```bash
node scripts/build.mjs --only=player            # or --only=guide, --only=server
npx vitest run test/validate                    # one area's tests
node scripts/lt.mjs start_lesson '{"topic":"How binary search works","learner":{"level":"new","knows":"Not stated.","goal":"Explain it."}}'
claude plugin validate plugin --strict          # the plugin manifest, MCP config and skill frontmatter
claude plugin validate . --strict               # the marketplace
```

`scripts/lt.mjs` is a tiny MCP client that starts the built server and calls one tool, for trying
things without a host.

| Path | What is there |
|---|---|
| `src/core/` | The lesson format (`clip.ts` for clips, stages, tap gates and explores, `expr.ts` for the formulas behind a slider, `frame.ts` for the custom frame, `schema.ts` for captions, questions and the plan), every limit, the validator and the example lessons |
| `src/server/` | The MCP server, storage, publishing and the local listener |
| `src/render/`, `src/player/` | The HTML renderer and the in-page player: the stage engine is `src/player/stage/`, the frame sandbox `src/player/frame/` |
| `src/frame/` | The static checks of a custom frame |
| `src/tts/` | Optional voice |
| `third_party/` | Reference text from other projects, with their licences. Nothing in it is run |
| `plugin/` | The Claude Code plugin: manifest, MCP configuration, the skill, and the bundled server |
| `plugin/skills/learning-tool/` | The skill: `SKILL.md` and its `references/` |
| `.claude-plugin/marketplace.json` | The marketplace entry that makes this repository installable |
| `test/` | One folder of tests per area |

The skill is checked against the code (`npx vitest run test/skill`). Every JSON example it marks is
parsed with the schema. An example that names its source must equal that object in the example
files (`src/core/clip-examples.ts` and its neighbours); the limits table, the table of which stage
takes which verb, the table of what can be tapped and bound, and the list of what a formula may
use must equal what the code renders them to. The clips the skill writes by hand are compiled by
the real engine and accepted by the real validator, and every formula in them is worked out at
every setting of its sliders. After changing an example, a limit, a verb table or the formula
language, regenerate the derived parts with:

```bash
UPDATE_SKILL_DOCS=1 npx vitest run test/skill/format.test.ts
```

Tests and development never play audio: browsers are launched muted and audio fixtures are silent.

## License

MIT

## Third-party notices

The skill's motion reference (`plugin/skills/learning-tool/references/motion.md`) is adapted in
part from **Motion Design Skills** by iart.ai (https://github.com/iart-ai/motion-design-skills),
copyright (c) 2026 iart.ai, used under the MIT licence. Four of that pack's skills
(`animation-principles`, `motion-art-direction`, `shot-composition` and `color-motion`) are included
unmodified, as reference text only, in
`plugin/skills/learning-tool/references/third-party/motion-design-skills/`, with the pack's
`LICENSE`. The same files, with the rest of the pack, are in `third_party/motion-design-skills/`.
Nothing from the pack is executed.
