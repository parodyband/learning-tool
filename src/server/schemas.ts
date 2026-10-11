// What each tool advertises in tools/list: a small, shallow JSON Schema with a one-line description
// of every property. No oneOf, no $ref, and nothing deeper than the fields of an object that sits
// directly in the arguments or in a list there: a model reads these, and hosts flatten or drop
// anything cleverer.
//
// These schemas document; they do not validate. `advertised()` hands every call to the handler
// untouched, so that a malformed argument comes back as our own envelope with a code, a path and a
// fix, instead of the SDK's one-line refusal. The format itself is far richer than this (a clip is
// one of nine stage kinds and a list of beats, each with typed actions) and is checked by the
// validator; the detailed shape reaches the agent as the templates that plan_lesson returns.
//
// What is advertised is what a new lesson may contain. The scene kinds of lessons made before
// clips are still read from stored drafts, but plan_lesson does not accept them, so they are not
// offered here.
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { DEPTHS, LIMITS as L } from '../core/limits';
import { PLAN_CHART_MARKS, PLAN_STAGE_KINDS, QUESTION_TYPES } from '../core/schema';
import type { ToolName } from './next';
import { PLAN_KINDS } from './texts';

export type JsonSchema = Record<string, unknown>;

/** A schema that shows `json` to the host and accepts every value, leaving validation to the handler. */
export function advertised(json: JsonSchema): StandardSchemaWithJSON<unknown, unknown> {
  return {
    '~standard': {
      version: 1,
      vendor: 'learning-tool',
      validate: (value) => ({ value }),
      jsonSchema: { input: () => json, output: () => json },
    },
  };
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

const object = (properties: Record<string, JsonSchema>, required: readonly string[], extra: JsonSchema = {}): JsonSchema => ({
  type: 'object',
  properties,
  required: [...required],
  ...extra,
});
const root = (properties: Record<string, JsonSchema>, required: readonly string[]): JsonSchema => ({ $schema: DRAFT, ...object(properties, required, { additionalProperties: false }) });
const string = (description: string, extra: JsonSchema = {}): JsonSchema => ({ type: 'string', description, ...extra });

const LESSON_ID = string('The lessonId returned by start_lesson: 12 lowercase letters and digits.');
const depths = Object.keys(DEPTHS);

export const TOOL_SCHEMAS: Record<ToolName, JsonSchema> = {
  start_lesson: root(
    {
      topic: string("What the learner wants to learn, in their words, for example \"How binary search works\".", { minLength: 2, maxLength: L.topicChars }),
      learner: object(
        {
          level: string('How much the learner already knows about this topic.', { enum: ['new', 'some', 'solid'] }),
          knows: string('What the learner already knows about the topic, including anything they have wrong, in your words.', { maxLength: L.learnerKnowsChars }),
          goal: string('What the learner wants to be able to do after the lesson.', { maxLength: L.learnerGoalChars }),
          calibration: {
            type: 'array',
            description: `The calibration questions you asked and the answers you got, as [{question, answer}], at most ${L.calibration.max}. Leave out if the learner said to just start.`,
            maxItems: L.calibration.max,
            items: {
              type: 'object',
              description: `{question, answer}: the question as asked, shortened if long (at most ${L.calibration.questionChars} characters), and the answer in the learner's words (at most ${L.calibration.answerChars} characters).`,
            },
          },
        },
        ['level', 'knows', 'goal'],
        { description: 'What calibration found out about the learner.' },
      ),
      language: string('BCP 47 tag of the language the lesson is written in, such as "en" or "pt-BR". Default "en".'),
      depth: string(`How long the lesson is: ${depths.map((d) => `${d} is about ${DEPTHS[d as keyof typeof DEPTHS].minutes} minutes`).join(', ')}. Default "standard".`, { enum: depths }),
    },
    ['topic', 'learner'],
  ),

  save_evidence: root(
    {
      lessonId: LESSON_ID,
      items: {
        type: 'array',
        description: 'The excerpts to store, 1 to 10 per call. Each is judged on its own.',
        minItems: 1,
        maxItems: 10,
        items: object(
          {
            url: string("The page's public http or https address. The server never fetches it.", { maxLength: L.urlChars }),
            title: string('The title of the page or document.', { maxLength: L.evidenceTitleChars }),
            excerpt: string(`One continuous passage copied exactly from the page, ${L.excerptChars.min} to ${L.excerptChars.max} characters, containing the fact you will state.`, {
              minLength: L.excerptChars.min,
              maxLength: L.excerptChars.max,
            }),
            via: string('How you got the text: "page" (you read the page), "search_snippet" (only a search result snippet) or "learner" (the learner supplied the source).', {
              enum: ['page', 'search_snippet', 'learner'],
            }),
            publisher: string('Who published it, such as the site or organisation name. Optional.', { maxLength: L.publisherChars }),
            lang: string("BCP 47 tag of the excerpt's language, only when it differs from the lesson's language."),
          },
          ['url', 'title', 'excerpt', 'via'],
        ),
      },
    },
    ['lessonId', 'items'],
  ),

  plan_lesson: root(
    {
      lessonId: LESSON_ID,
      title: string("The lesson's title, as the learner will see it.", { minLength: 3, maxLength: L.titleChars }),
      objectives: {
        type: 'array',
        description: 'What the learner will be able to do, with ids o1, o2, ... in order. Each needs at least one checkpoint in the outline.',
        minItems: 1,
        items: object(
          {
            id: string('"o1", "o2", ... in order.'),
            text: string('Completes "After this lesson you can ..." with something observable, such as "Trace binary search on a sorted list".', { maxLength: L.objectiveChars.max }),
          },
          ['id', 'text'],
        ),
      },
      outline: {
        type: 'array',
        description: 'One entry per scene, in lesson order. The first is a clip; the last is the only recap. Plan what the learner will see and do, not what they will read.',
        minItems: 1,
        items: object(
          {
            id: string('A short lowercase id you choose for the scene, such as "s1". Scenes are submitted under this id.'),
            kind: string('The kind of scene. A teaching scene is a "clip": a picture that moves, with one short caption per beat.', { enum: [...PLAN_KINDS] }),
            purpose: string('What this scene is for, in a phrase: for a clip, what the learner will see happen.', { maxLength: L.purposeChars }),
            stage: string('What a clip shows: required for clip, not allowed otherwise. "frame" is your own drawing code, the rare escape hatch when no typed stage fits.', { enum: [...PLAN_STAGE_KINDS] }),
            mark: string('For a clip with stage "chart" only: which chart its template shows. "bars" (the default), "line", or "curve" (a function plot, y = a formula in x).', { enum: [...PLAN_CHART_MARKS] }),
            question: string('The question type: required for checkpoint, not allowed otherwise.', { enum: [...QUESTION_TYPES] }),
            objective: string('The objective id a checkpoint assesses, such as "o1": required for checkpoint, not allowed otherwise.'),
          },
          ['id', 'kind', 'purpose'],
        ),
      },
    },
    ['lessonId', 'title', 'objectives', 'outline'],
  ),

  submit_scene: root(
    {
      lessonId: LESSON_ID,
      scene: {
        type: 'object',
        description:
          'One scene as a JSON object: the template plan_lesson returned for this id, with every placeholder replaced. A clip has "stage", "beats" and, where the learner takes over, "explore": the picture carries the idea, a caption is one short line.',
      },
    },
    ['lessonId', 'scene'],
  ),

  validate_lesson: root({ lessonId: LESSON_ID }, ['lessonId']),

  publish_lesson: root(
    {
      lessonId: LESSON_ID,
      voice: { type: 'boolean', description: 'false leaves out the audio (captions read aloud) for this publish. Audio is only ever added when the learner has configured voice.' },
      open: { type: 'boolean', description: "true also opens the page in the learner's browser. Only when the learner asked for that." },
    },
    ['lessonId'],
  ),

  get_lesson: root(
    {
      lessonId: string('The lesson to show. Leave out to list the most recent lessons on this machine.'),
      include: {
        type: 'array',
        description: 'Extra detail to add: "evidence" for every stored excerpt in full, "scene:<id>" (such as "scene:c3") for an accepted scene as stored.',
        items: { type: 'string', description: '"evidence", or "scene:" followed by a scene id.' },
      },
    },
    [],
  ),

  get_guide: root(
    {
      section: string('The section to return, such as "clip-design" or "format". Leave out for the overview and the list of sections.'),
      part: { type: 'integer', description: 'Which part of a long section to return, starting at 1. Only needed when a result had "nextPart".', minimum: 1 },
    },
    [],
  ),
};
