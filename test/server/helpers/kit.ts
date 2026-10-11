// Shared setup for the server tests: a server over a temporary home, an in-memory client, and the
// example lessons driven through the tools.
//
// Rules these helpers keep, so no test has to remember them:
//   - LEARNING_TOOL_HOME is a fresh temp directory, never the real home.
//   - The local listener is asked for port 0 (any free port), never the default.
//   - `open` only records what it was asked to open. Nothing launches a browser.
//   - Every tool result is checked against the envelope contract as it is received.
//
// Two example lessons.
//
// CLIP_PARTS is what an agent writes now: the binary-search example as clips, planned and submitted
// through the tools. Its scenes are the example's, with the learner actions the interactivity rules
// ask for added wherever the example does not have them yet (LESSON_SCENES in
// test/validate/clip-kit.ts says how, and adds nothing once the example meets the rules itself).
//
// EXAMPLE_PARTS (also LEGACY_PARTS) is the same lesson in the scene kinds of lessons made before
// clips (narration, step-through). plan_lesson no longer accepts a plan of those kinds, so
// `planned()` puts its plan into the draft file directly, as an older version of the server left
// it. Everything after that goes through the tools. These lessons are how the tests show that an
// older draft is still read, checked, published and verified, and they carry the many tests of
// server mechanics (parallel calls, restarts, the listener, voice) that do not care what kind of
// scene a lesson is made of.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { McpServer } from '@modelcontextprotocol/server';
import { expect } from 'vitest';
import type { AnySceneInput } from '../../../src/core/clip-examples';
import { EXAMPLE_EVIDENCE, EXAMPLE_PLAN, EXAMPLE_SCENES, EXAMPLE_START } from '../../../src/core/examples';
import { PlanInput } from '../../../src/core/schema';
import type { Issue, Stage } from '../../../src/core/types';
import { createDeps, type ServerDeps } from '../../../src/server/deps';
import { TOOL_NAMES, type ToolName } from '../../../src/server/next';
import { buildServer } from '../../../src/server/server';
import { LESSON_SCENES } from '../../validate/clip-kit';

export interface Envelope {
  ok: boolean;
  lessonId: string | null;
  stage: Stage | null;
  next: { tool: string; why: string };
  errors: Issue[];
  warnings: Issue[];
  [key: string]: any;
}

export interface LessonParts {
  start: unknown;
  evidence: readonly unknown[];
  plan: { title: string; objectives: unknown; outline: unknown };
  scenes: readonly unknown[];
}

export const EXAMPLE_PARTS: LessonParts = { start: EXAMPLE_START, evidence: EXAMPLE_EVIDENCE, plan: EXAMPLE_PLAN, scenes: EXAMPLE_SCENES };
/** The example in the scene kinds of lessons made before clips. Its plan cannot go through plan_lesson: see `planned`. */
export const LEGACY_PARTS = EXAMPLE_PARTS;

/** The outline entry an agent would plan for a scene: for a clip, its stage kind. */
export function outlineEntryFor(scene: AnySceneInput): Record<string, unknown> {
  const entry: Record<string, unknown> = { id: scene.id, kind: scene.kind, purpose: scene.title };
  if (scene.kind === 'clip') entry.stage = scene.stage.kind;
  if (scene.kind === 'checkpoint') {
    entry.question = scene.question.type;
    entry.objective = scene.objective;
  }
  return entry;
}

/** A plan for these scenes, with the example's title and objectives. */
export function planFor(scenes: readonly AnySceneInput[], title: string = EXAMPLE_PLAN.title): LessonParts['plan'] {
  return { title, objectives: EXAMPLE_PLAN.objectives, outline: scenes.map(outlineEntryFor) };
}

/** The example lesson as clips (six clips, three checkpoints, the recap), as an agent sends it through the tools. */
export const CLIP_PARTS: LessonParts = { start: EXAMPLE_START, evidence: EXAMPLE_EVIDENCE, plan: planFor(LESSON_SCENES), scenes: LESSON_SCENES };

const LEGACY_KINDS = ['narration', 'step_through'];
/** True for a plan in the kinds of lessons made before clips, which plan_lesson refuses. */
export function isLegacyPlan(plan: LessonParts['plan']): boolean {
  return Array.isArray(plan.outline) && plan.outline.some((entry) => LEGACY_KINDS.includes((entry as { kind?: string }).kind ?? ''));
}

/**
 * Put a plan into a stored draft directly, as a server from before clips would have stored it.
 * The plan is parsed by the format's own schema, which still knows the older kinds; no tool is
 * involved. It works on the file, so it serves a server in this process and a spawned one alike:
 * both read the draft from disk on every call.
 */
export async function plantPlan(home: string, lessonId: string, plan: LessonParts['plan']): Promise<void> {
  expect(lessonId).toMatch(/^[a-z0-9]{12}$/);
  const file = path.join(home, '.state', 'drafts', `${lessonId}.json`);
  const draft = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  const parsed = PlanInput.parse(plan);
  await writeFile(file, JSON.stringify({ ...draft, title: parsed.title, objectives: parsed.objectives, outline: parsed.outline }), { mode: 0o600 });
}

export interface World {
  home: string;
  deps: ServerDeps;
  server: McpServer;
  client: Client;
  /** Lines the server logged (it logs to stderr in production). */
  logs: string[];
  /** Paths `open` was asked to open. */
  opened: string[];
  /** Call a tool. The result is checked against the envelope contract before it is returned. */
  call(tool: ToolName, args?: unknown): Promise<Envelope>;
  /** The raw result of the last call, as the client received it. */
  last: { text: string; isError: boolean } | null;
  /** A new server instance and client over the same home, as after the host restarts. */
  restart(overrides?: Partial<ServerDeps>): Promise<void>;
  close(): Promise<void>;
}

export interface WorldOptions {
  env?: Record<string, string>;
  deps?: Partial<ServerDeps>;
  /** Use this home instead of a fresh one. It is not removed by close(). */
  home?: string;
}

const NEXT_TOOLS: readonly string[] = [...TOOL_NAMES, 'reply'];
const STAGES: readonly string[] = ['started', 'researching', 'planned', 'writing', 'ready', 'published'];

/**
 * What every result must satisfy, whatever the tool and whatever happened.
 *
 * `tool` matters for one case: a successful get_guide sends the guide as its text block and the
 * envelope, without the text, as structured content, so that a host counting both does not carry
 * the guide twice. Every other result is the same JSON in both.
 */
export function expectEnvelope(result: { content?: unknown; structuredContent?: unknown; isError?: boolean }, tool?: string): Envelope {
  const content = result.content as { type: string; text: string }[];
  expect(content).toHaveLength(1);
  expect(content[0]!.type).toBe('text');
  let fromText: Envelope;
  if (tool === 'get_guide' && result.isError !== true) {
    fromText = result.structuredContent as Envelope;
    expect(() => JSON.parse(content[0]!.text), 'the text block of get_guide is the guide, not JSON').toThrow();
    expect(fromText.text, 'the envelope of get_guide does not repeat the guide').toBeUndefined();
    expect(JSON.stringify(fromText).length).toBeLessThan(2500);
    expect(fromText.chars).toBeGreaterThan(0);
    expect(content[0]!.text.length).toBeGreaterThan(fromText.chars as number);
  } else {
    fromText = JSON.parse(content[0]!.text) as Envelope;
    // The same JSON twice: hosts differ in which one they show the model.
    expect(result.structuredContent).toEqual(fromText);
  }
  expect(Object.keys(fromText).slice(0, 6)).toEqual(['ok', 'lessonId', 'stage', 'next', 'errors', 'warnings']);
  expect(typeof fromText.ok).toBe('boolean');
  expect(result.isError ?? false).toBe(!fromText.ok);
  expect(fromText.lessonId === null || /^[a-z0-9]{12}$/.test(fromText.lessonId)).toBe(true);
  expect(fromText.stage === null || STAGES.includes(fromText.stage)).toBe(true);
  expect(NEXT_TOOLS).toContain(fromText.next.tool);
  expect(fromText.next.why.length).toBeGreaterThan(20);
  expect(Array.isArray(fromText.errors)).toBe(true);
  expect(Array.isArray(fromText.warnings)).toBe(true);
  if (!fromText.ok) expect(fromText.errors.length).toBeGreaterThan(0);
  for (const found of [...fromText.errors, ...fromText.warnings]) {
    expect(found.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
    expect(typeof found.path).toBe('string');
    expect(found.message.length).toBeGreaterThan(5);
    expect(found.fix.length).toBeGreaterThan(5);
  }
  for (const error of fromText.errors) expect(error.severity).toBe('error');
  for (const warning of fromText.warnings) expect(warning.severity).toBe('warning');
  // No list is longer than one result may list, plus the entry that counts the rest.
  for (const list of [fromText.errors, fromText.warnings]) expect(list.filter((found) => found.code !== 'MORE_ISSUES').length).toBeLessThanOrEqual(20);
  // Nothing a tool returns may look like a stack trace.
  expect(content[0]!.text).not.toMatch(/\n\s+at .+:\d+:\d+/);
  return fromText;
}

export async function startWorld(options: WorldOptions = {}): Promise<World> {
  const home = options.home ?? (await mkdtemp(path.join(os.tmpdir(), 'lt-server-')));
  const logs: string[] = [];
  const opened: string[] = [];
  const env = { LEARNING_TOOL_HOME: home, LEARNING_TOOL_PORT: '0', ...options.env };

  const world = { home, logs, opened, last: null } as unknown as World;

  const connect = async (overrides: Partial<ServerDeps> = {}): Promise<void> => {
    world.deps = createDeps(env, {
      log: (line) => logs.push(line),
      open: async (file) => {
        opened.push(file);
      },
      ...options.deps,
      ...overrides,
    });
    world.server = buildServer(world.deps);
    world.client = new Client({ name: 'server-test', version: '0.0.0' });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await world.server.connect(serverSide);
    await world.client.connect(clientSide);
  };

  world.call = async (tool, args = {}) => {
    const result = await world.client.callTool({ name: tool, arguments: args as Record<string, unknown> });
    const envelope = expectEnvelope(result, tool);
    world.last = { text: (result.content as { text: string }[])[0]!.text, isError: result.isError === true };
    return envelope;
  };
  world.restart = async (overrides) => {
    await world.client.close();
    await world.server.close();
    await world.deps.listener.close();
    await connect(overrides);
  };
  world.close = async () => {
    await world.client.close().catch(() => undefined);
    await world.server.close().catch(() => undefined);
    await world.deps.listener.close();
    if (options.home === undefined) await rm(home, { recursive: true, force: true });
  };

  await connect();
  return world;
}

/**
 * start_lesson, save_evidence and the plan for `parts`. Returns the lessonId.
 *
 * A plan of clips goes through plan_lesson. A plan in the older kinds is put into the draft
 * directly (see `plantPlan`), because plan_lesson refuses it; `world.last` is then the result of
 * the last save_evidence, not of a plan.
 */
export async function planned(world: World, parts: LessonParts = EXAMPLE_PARTS): Promise<string> {
  const started = await world.call('start_lesson', parts.start);
  expect(started.errors).toEqual([]);
  const lessonId = started.lessonId as string;
  for (let i = 0; i < parts.evidence.length; i += 10) {
    const saved = await world.call('save_evidence', { lessonId, items: parts.evidence.slice(i, i + 10) });
    expect(saved.errors).toEqual([]);
  }
  if (isLegacyPlan(parts.plan)) {
    await plantPlan(world.home, lessonId, parts.plan);
    return lessonId;
  }
  const plan = await world.call('plan_lesson', { lessonId, ...parts.plan });
  expect(plan.errors).toEqual([]);
  return lessonId;
}

/** The whole of `parts` accepted: the first scene alone, the rest together, as the skill tells agents to do it. */
export async function written(world: World, parts: LessonParts = EXAMPLE_PARTS): Promise<string> {
  const lessonId = await planned(world, parts);
  const [first, ...rest] = parts.scenes;
  const one = await world.call('submit_scene', { lessonId, scene: first });
  expect(one.errors).toEqual([]);
  const others = await Promise.all(rest.map((scene) => world.call('submit_scene', { lessonId, scene })));
  for (const result of others) expect(result.errors).toEqual([]);
  return lessonId;
}

/** Every file under `dir`, relative path and bytes. */
export async function filesUnder(dir: string): Promise<{ name: string; bytes: Buffer }[]> {
  const out: { name: string; bytes: Buffer }[] = [];
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push({ name: path.relative(dir, full), bytes: entry.isFile() ? await readFile(full) : Buffer.alloc(0) });
    }
  };
  await walk(dir);
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** A fixed moment at midday UTC, so the local date is the same in every time zone a test might run in. */
export const NOON = new Date('2026-10-10T12:00:00.000Z');
