# Voice: optional narration

Read this when a learner asks about audio, when `start_lesson` or `publish_lesson` reports something
about voice, or before you say anything to a learner about API keys.

Contents: [What it does](#what-it-does) · [What is sent, and when](#what-is-sent-and-when) ·
[How the learner turns it on](#how-the-learner-turns-it-on) · [What you must never do](#what-you-must-never-do) ·
[Reporting the outcome](#reporting-the-outcome) · [Writing for the ear](#writing-for-the-ear)

## What it does

Lessons are silent by default, and nothing leaves the learner's machine when one is published. If
the learner has given Learning Tool their own ElevenLabs API key, `publish_lesson` also has each
caption read aloud by ElevenLabs and embeds the audio in the lesson file. Each clip then has a Voice
switch: with it on, a beat's caption is spoken as its motion plays, and never before the learner
presses Play. The page carries the line "Machine narration by ElevenLabs (elevenlabs.io). The text
is authoritative."

Three things to be straight about:

- **It is a convenience, not a better lesson.** Narration alongside text is acceptable in a page the
  learner paces themselves, but the research does not show it adding much, and machine voices trailed
  human ones in most comparisons (Mayer 2023, the redundancy and voice principles). The printed text
  is the lesson. Never suggest voice as a way to learn more.
- **It is a third-party service the learner pays for.** ElevenLabs bills by the character. By its
  published figures when this was written, the default model costs about one credit per character, a
  ten-minute lesson is close to ten thousand characters, and that is the whole monthly allowance of
  its free plan. Its free plan also excludes commercial use. Point the learner to ElevenLabs' own
  pricing and terms rather than quoting these as current.
- **The audio is embedded**, so a lesson with voice still works offline, and is several megabytes
  larger.

## What is sent, and when

**When.** Only during `publish_lesson`, only when a key is configured, and not if you pass
`voice: false`. No other tool contacts ElevenLabs, and nothing is sent when the server starts.

**Where.** `https://api.elevenlabs.io`, over HTTPS, and nowhere else. The address is fixed in the
server; no tool argument and nothing in a lesson can change it.

**What.** The lesson's narration text, as plain text with markup and brackets removed, one request
per segment:

| Segment | Text sent |
|---|---|
| A clip | The caption of each beat, one request per beat. An analogy is followed by "Where this comparison breaks down:" and its limits |
| A checkpoint | The question's prompt |
| The recap | The takeaways |

Each request also carries the model name, the voice id, the audio format, a fixed seed number, and the
learner's key in a request header. If no voice is configured, one extra request lists the voices the
account can use, and the choice is remembered.

**What is not sent.** Source excerpts, source titles and URLs. Answer options, feedback, explanations,
hints and model answers. A prediction's prompt and its replies. The words of an explore: its
prompt, its sliders and its goal. What is on a stage, clip descriptions and a custom frame's code. The learner profile: what they said they
know, their goal and their calibration answers. The lesson id, and anything about the conversation or
the machine. The one way source wording reaches ElevenLabs is a `quote` block, because a quote is part
of a caption.

**How much.** A publish sends at most 12,000 characters by default. If the narration is longer than
the budget, nothing is sent and the lesson is published as text. Finished clips are cached on the
learner's machine, so publishing the same text again sends nothing and costs nothing, and a publish
that was cut short is finished by publishing again.

**What ElevenLabs keeps.** By its documentation when this was written, the text and audio stay in the
account's history unless the learner deletes them there. That is the learner's account and their
choice; say so if they ask about privacy.

**If it fails.** The text lesson is written first and stays published whatever happens to voice.
Voice never blocks, delays past its deadline of about 45 seconds, or unpublishes a lesson.

## How the learner turns it on

The learner does this themselves, outside the conversation. You explain where; you never do it for
them and never see the key.

**In Claude Code, with the Learning Tool plugin.** The plugin has one option, "ElevenLabs API key
(optional)". The learner runs `/plugin configure learning-tool@learning-tool` (the part after `@` is
the marketplace the plugin came from; `/plugin` shows it) and enters the key in the masked field. If
the next lesson still has no narration, restarting Claude Code makes the server pick the key up.
Claude Code keeps the value in the system's secure credential store, not in a settings file, and
hands it to the Learning Tool server as an environment variable.

**In any other host.** The learner sets an environment variable for the Learning Tool server in that
host's MCP server configuration, by editing the configuration themselves:

<!-- example: mcp -->
```json
{
  "mcpServers": {
    "learning-tool": {
      "command": "node",
      "args": ["/absolute/path/to/learning-tool.mjs"],
      "env": { "LEARNING_TOOL_ELEVENLABS_API_KEY": "the learner types their key here" }
    }
  }
}
```

The variable is `LEARNING_TOOL_ELEVENLABS_API_KEY`. The generic `ELEVENLABS_API_KEY` is deliberately
not read, so a key the learner set up for some other tool is never used without their choosing to.

Optional settings, as environment variables on the same server:

| Variable | Meaning | Default |
|---|---|---|
| `LEARNING_TOOL_ELEVENLABS_VOICE_ID` | Which ElevenLabs voice to use | One of the account's voices, chosen automatically |
| `LEARNING_TOOL_ELEVENLABS_MODEL` | Which ElevenLabs model to use | `eleven_multilingual_v2` |
| `LEARNING_TOOL_VOICE_MAX_CHARS` | The most characters one publish may send | 12000 |

A setting that is present but malformed turns voice off rather than falling back to a default, so
that a typo cannot spend credits the learner did not intend. The server's `voice-check` command,
described in the project guide, tells the learner whether voice is configured and reachable.

**To turn it off:** clear the plugin option or remove the variable. For one lesson, the learner can
ask you to publish without voice, and you pass `voice: false`.

## What you must never do

- **Never ask the learner for their key.** Not to "set it up for them", not to test it.
- **Never accept one.** If a learner pastes a key into the conversation, do not use it, do not repeat
  it, and do not store it anywhere. Tell them that a key in a chat should be treated as exposed, that
  they should revoke it in their ElevenLabs account and create a new one, and where to enter the new
  one themselves.
- **Never put a key in a tool argument, a file, a command or a lesson.** No Learning Tool tool has a
  parameter for it. That is by design: conversations are stored, synced and shared, and tool
  arguments are part of the conversation.
- **Never edit the host's configuration to add a key**, even if you have the means to write files.
- **Do not promote voice.** Mention it when the learner asks about audio or accessibility, or when a
  tool result tells you something they need to know. It is not a step of making a lesson.

## Reporting the outcome

`start_lesson` returns `voice` with `enabled` and a note. `publish_lesson` returns `voice` with one
of these codes. The lesson is published in every case, so always give the link.

| Code | Meaning | What to tell the learner |
|---|---|---|
| `VOICE_OFF` | No key is configured | Nothing, unless they asked for audio. Then explain how to turn it on |
| `VOICE_OK` | Every segment has audio | The lesson has narration |
| `VOICE_PARTIAL` | Some segments have audio | Publishing again finishes the rest; what is done is cached and costs nothing |
| `VOICE_AUTH` | ElevenLabs refused the key, the voice or the model | They need to check the key and voice in their own settings. You cannot fix this |
| `VOICE_QUOTA` | The account is out of credits, or the plan does not cover it | The lesson is text-only; their ElevenLabs allowance is used up |
| `VOICE_RATE` | ElevenLabs is rate limiting | Publish again in a minute if they want audio |
| `VOICE_TIMEOUT` | ElevenLabs did not answer in time | Publish again to continue; finished segments are cached |
| `VOICE_BUDGET` | The narration is over the character budget, so nothing was sent | Text-only, unless they raise the budget or want a shorter lesson |
| `VOICE_BAD_AUDIO` | The response was not usable audio and was discarded | Text-only; trying again later may work |
| `VOICE_NETWORK` | ElevenLabs could not be reached | Text-only; publishing again later may add audio |

Say it in a clause, not a paragraph: "Narration could not be added because the ElevenLabs allowance
is used up, so this one is text-only."

## Writing for the ear

When voice is on, each caption is spoken as written. A lesson that reads well aloud is also a clearer
lesson, so this costs nothing when voice is off:

- Write sentences that make sense without the page: "the middle element", not "the element shown
  above".
- Keep code and formulas on a `lines` stage and in `code` and math spans, and say the idea in words
  in the caption. Symbols are read out literally or skipped.
- Introduce an abbreviation in full the first time.
