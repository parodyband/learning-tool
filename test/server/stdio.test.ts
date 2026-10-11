// The built server, started as a host starts it: `node plugin/server/learning-tool.mjs`, speaking
// MCP over stdin and stdout.
//
// What is proved here and nowhere else:
//   - stdout carries JSON-RPC frames and nothing else, through a whole lesson including a publish
//     (which logs, opens a port and writes files);
//   - starting the process has no side effects, so a host that starts it twice does no harm;
//   - the process ends when the host goes away, even with the local listener open;
//   - the bundle is self-contained, and the commands for people (verify, voice-check, lt.mjs) work.
//
// Which lesson goes through the bundle. A new lesson is made of clips, and the clip example is
// driven through the spawned server from start to verify below. The older tests in this file are
// about the wire and the process, not the lesson, and keep the example in the scene kinds of
// lessons made before clips: plan_lesson refuses that plan, so `oldPlan` writes it into the draft
// file, as an older server stored it, and the spawned server reads it from there.
import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLE_EVIDENCE, EXAMPLE_PLAN, EXAMPLE_SCENES, EXAMPLE_START } from '../../src/core/examples';
import { PLAN_STAGE_KINDS } from '../../src/core/schema';
import { GUIDE } from '../../src/generated/guide';
import { TOOL_NAMES } from '../../src/server/next';
import { INSTRUCTIONS, toolDescriptions } from '../../src/server/texts';
import { guideSections } from '../../src/server/tools/guide';
import { FAKE_KEY, FAKE_KEY_MARKER } from '../tts/helpers/kit';
import { interactive, interactiveLesson } from '../validate/clip-kit';
import { CLIP_PARTS, filesUnder, plantPlan, startWorld, written } from './helpers/kit';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const BUNDLE = path.join(ROOT, 'plugin', 'server', 'learning-tool.mjs');
const LT = path.join(ROOT, 'scripts', 'lt.mjs');
const run = promisify(execFile);

/** The newest modification time under a folder of sources. */
function newest(dir: string): number {
  let latest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    latest = Math.max(latest, entry.isDirectory() ? newest(full) : statSync(full).mtimeMs);
  }
  return latest;
}

beforeAll(() => {
  // These tests are about the file that ships. If it is missing or older than the sources it is
  // built from, build it, so that a pass here always means the current code.
  const sources = ['src/server', 'src/core', 'src/render', 'src/tts', 'src/generated'].map((d) => newest(path.join(ROOT, d)));
  if (!existsSync(BUNDLE) || statSync(BUNDLE).mtimeMs < Math.max(...sources)) {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs'), '--only=server'], { cwd: ROOT, stdio: 'pipe' });
  }
}, 60_000);

let home: string;
beforeEach(async () => {
  home = path.join(await mkdtemp(path.join(os.tmpdir(), 'lt-stdio-')), 'home');
});
afterEach(async () => {
  await rm(path.dirname(home), { recursive: true, force: true });
});

/** The example's plan in the older kinds, put into the draft file of a lesson the spawned server holds. */
const oldPlan = (lessonId: string): Promise<void> => plantPlan(home, lessonId, EXAMPLE_PLAN);

const childEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...getDefaultEnvironment(),
  LEARNING_TOOL_HOME: home,
  LEARNING_TOOL_PORT: '0',
  LEARNING_TOOL_NO_OPEN: '1',
  ...extra,
});

/** A server process with a line-by-line JSON-RPC conversation, keeping every byte it writes. */
interface Wire {
  child: ChildProcessWithoutNullStreams;
  stdout: () => string;
  stderr: () => string;
  request(method: string, params?: unknown): Promise<any>;
  notify(method: string, params?: unknown): void;
  call(tool: string, args?: unknown): Promise<any>;
  /** Close stdin, as a host does when it goes away, and wait for the process to end. */
  end(): Promise<{ code: number | null; signal: NodeJS.Signals | null; ms: number }>;
}

function startWire(extraEnv: Record<string, string> = {}, cwd = ROOT, bundle = BUNDLE): Wire {
  const child = spawn(process.execPath, [bundle], { env: childEnv(extraEnv), cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  let seen = 0;
  const waiting = new Map<number, (message: any) => void>();
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    out += chunk;
    for (;;) {
      const end = out.indexOf('\n', seen);
      if (end === -1) break;
      const line = out.slice(seen, end);
      seen = end + 1;
      try {
        const message = JSON.parse(line);
        if (message.id !== undefined && waiting.has(message.id)) {
          waiting.get(message.id)!(message);
          waiting.delete(message.id);
        }
      } catch {
        // judged by the test that reads `stdout()`
      }
    }
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (err += chunk));
  let nextId = 1;
  const wire: Wire = {
    child,
    stdout: () => out,
    stderr: () => err,
    request: (method, params) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => reject(new Error(`no answer to ${method} (stderr: ${err})`)), 15_000);
        waiting.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
      }),
    notify: (method, params) => void child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })}\n`),
    call: async (tool, args = {}) => {
      const message = await wire.request('tools/call', { name: tool, arguments: args });
      expect(message.error).toBeUndefined();
      // get_guide sends the guide as its text and the envelope beside it; every other result is the same JSON in both.
      if (tool === 'get_guide' && message.result.isError !== true) return { ...message.result.structuredContent, text: message.result.content[0].text };
      return JSON.parse(message.result.content[0].text);
    },
    end: () =>
      new Promise((resolve) => {
        const started = Date.now();
        const killer = setTimeout(() => child.kill('SIGKILL'), 8000);
        child.once('exit', (code, signal) => {
          clearTimeout(killer);
          resolve({ code, signal, ms: Date.now() - started });
        });
        child.stdin.end();
      }),
  };
  return wire;
}

async function handshake(wire: Wire): Promise<any> {
  const init = await wire.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'stdio-test', version: '0' } });
  wire.notify('notifications/initialized');
  return init.result;
}

/** Every line the server wrote to stdout must be one JSON-RPC 2.0 message. */
function expectOnlyFrames(stdout: string): number {
  expect(stdout.endsWith('\n')).toBe(true);
  const lines = stdout.split('\n').slice(0, -1);
  for (const line of lines) {
    let message: any;
    expect(() => (message = JSON.parse(line)), `not JSON on stdout: ${line.slice(0, 120)}`).not.toThrow();
    expect(message.jsonrpc).toBe('2.0');
    expect('result' in message || 'error' in message || 'method' in message).toBe(true);
  }
  return lines.length;
}

describe('the spawned bundle, on the wire', () => {
  it('writes only JSON-RPC frames to stdout through a whole lesson, logs to stderr, and exits when stdin closes', async () => {
    const wire = startWire();
    const init = await handshake(wire);
    expect(init.serverInfo).toMatchObject({ name: 'learning-tool', title: 'Learning Tool' });
    expect(init.instructions).toMatch(/^Learning Tool builds a short visual lesson: one offline page of motion-graphics clips/);
    expect(init.instructions).not.toMatch(/narration|step_through/);
    expect(init.capabilities.tools).toBeDefined();
    expect(init.capabilities.prompts).toBeDefined();

    const listed = await wire.request('tools/list');
    expect(listed.result.tools.map((t: { name: string }) => t.name)).toEqual([...TOOL_NAMES]);

    const started = await wire.call('start_lesson', EXAMPLE_START);
    const lessonId = started.lessonId;
    await wire.call('save_evidence', { lessonId, items: EXAMPLE_EVIDENCE });
    // A plan with a narration scene is refused by the bundled server, with the code for it, as a frame like any other.
    const refused = await wire.call('plan_lesson', { lessonId, ...EXAMPLE_PLAN });
    expect(refused).toMatchObject({ ok: false, stage: 'researching', next: { tool: 'plan_lesson' } });
    expect(refused.errors[0]).toMatchObject({ code: 'PLAN_LEGACY_KIND', path: 'outline[0].kind', got: 'narration', expected: 'clip' });
    await oldPlan(lessonId);
    const scenes = await Promise.all(EXAMPLE_SCENES.map((scene) => wire.call('submit_scene', { lessonId, scene })));
    expect(scenes.every((s) => s.accepted)).toBe(true);
    // Errors of every kind also travel as frames: a rejected scene, a bad id, an unknown tool, a broken request.
    expect((await wire.call('submit_scene', { lessonId, scene: { id: 's1', kind: 'narration' } })).ok).toBe(false);
    expect((await wire.call('get_lesson', { lessonId: '../../etc/passwd' })).errors[0].code).toBe('BAD_ID');
    expect((await wire.request('tools/call', { name: 'no_such_tool', arguments: {} })).error.code).toBe(-32602);
    expect((await wire.request('no/such/method')).error).toBeDefined();
    const guide = await wire.call('get_guide', { section: 'format' });
    expect(guide.text).toMatch(/^# /);
    expect(guide.text).toContain('[get_guide: section "format", part 1 of 1.');
    await wire.request('prompts/get', { name: 'teach', arguments: { topic: 'recursion' } });

    const published = await wire.call('publish_lesson', { lessonId });
    expect(published).toMatchObject({ ok: true, stage: 'published' });
    expect(existsSync(published.file.path)).toBe(true);
    // The listener is up, in the same process, on a port that is not the default.
    const page = await fetch(published.local.url);
    expect(page.status).toBe(200);
    expect(new URL(published.local.url).port).not.toBe('47821');

    const exit = await wire.end();
    // With the listener open the process still ends on its own, promptly, without a signal.
    expect(exit).toMatchObject({ code: 0, signal: null });
    expect(exit.ms).toBeLessThan(3000);
    await expect(fetch(published.local.url)).rejects.toThrow();

    const frames = expectOnlyFrames(wire.stdout());
    expect(frames).toBeGreaterThanOrEqual(20);
    // What the server had to say went to stderr.
    expect(wire.stderr()).toMatch(/learning-tool: serving published lessons on http:\/\/127\.0\.0\.1:\d+\//);
    expect(wire.stderr()).not.toMatch(/\n\s+at .+:\d+:\d+/);
  }, 30_000);

  it('survives input that is not JSON-RPC without writing anything else to stdout', async () => {
    const wire = startWire();
    wire.child.stdin.write('this is not json\n');
    wire.child.stdin.write('{"jsonrpc":"2.0","method":"tools/call"}\n');
    wire.child.stdin.write('[]\n\n{"id":1}\n');
    await handshake(wire);
    expect((await wire.call('get_lesson')).ok).toBe(true);
    await wire.end();
    expectOnlyFrames(wire.stdout());
  }, 20_000);

  it('ends with a failure status, and says why, when a message too large for the protocol arrives', async () => {
    // The SDK's reader holds 10 MB. A longer line cannot be answered: the reader drops it and closes the
    // connection. That used to end the process with status 0, as if nothing had gone wrong.
    const wire = startWire();
    await handshake(wire);
    expect((await wire.call('get_lesson')).ok).toBe(true);
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => wire.child.once('exit', (code, signal) => resolve({ code, signal })));
    wire.child.stdin.on('error', () => undefined);
    wire.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'get_lesson', arguments: { include: ['x'.repeat(11 * 1024 * 1024)] } } })}\n`);
    expect(await exited).toEqual({ code: 1, signal: null });
    expect(wire.stderr()).toContain('learning-tool: Error: ReadBuffer exceeded maximum size of 10485760 bytes');
    expect(wire.stderr()).toMatch(/learning-tool: a message larger than 10 MB arrived on stdin.*stopping with status 1/);
    expect(wire.stderr()).not.toMatch(/\n\s+at .+:\d+:\d+/);
    expectOnlyFrames(wire.stdout());
  }, 30_000);

  it('a large message that fits is answered like any other, and the server goes on', async () => {
    const wire = startWire();
    await handshake(wire);
    const r = await wire.call('get_lesson', { lessonId: 'abc123def456', include: ['x'.repeat(9 * 1024 * 1024)] });
    expect(r.ok).toBe(false);
    expect((await wire.call('get_lesson')).ok).toBe(true);
    expect((await wire.end()).code).toBe(0);
  }, 30_000);

  it('does nothing at boot: no folder, no port, no output, however many times it is started', async () => {
    const wires = [startWire(), startWire(), startWire()];
    for (const wire of wires) {
      await handshake(wire);
      await wire.request('tools/list');
      await wire.request('prompts/list');
      // Reading does not create anything either.
      expect((await wire.call('get_lesson')).lessons).toEqual([]);
      await wire.call('get_guide');
    }
    expect(existsSync(home)).toBe(false);
    for (const wire of wires) {
      const exit = await wire.end();
      expect(exit.code).toBe(0);
      // The server itself says nothing. (A line here that is not ours would be a warning from the runtime.)
      expect(wire.stderr()).not.toContain('learning-tool');
      expect(wire.stderr()).not.toMatch(/Error|\n\s+at /);
      expectOnlyFrames(wire.stdout());
    }
    expect(existsSync(home)).toBe(false);
  }, 30_000);

  it('exits by itself when the host disappears before saying anything', async () => {
    const wire = startWire();
    const exit = await wire.end();
    expect(exit).toMatchObject({ code: 0, signal: null });
    expect(wire.stdout()).toBe('');
    expect(existsSync(home)).toBe(false);
  }, 15_000);

  it('stops on SIGTERM with the listener open', async () => {
    const wire = startWire();
    await handshake(wire);
    const lessonId = (await wire.call('start_lesson', EXAMPLE_START)).lessonId;
    await wire.call('save_evidence', { lessonId, items: EXAMPLE_EVIDENCE });
    await oldPlan(lessonId);
    for (const scene of EXAMPLE_SCENES) await wire.call('submit_scene', { lessonId, scene });
    const published = await wire.call('publish_lesson', { lessonId });
    expect((await fetch(published.local.url)).status).toBe(200);
    const exited = new Promise<number | null>((resolve) => wire.child.once('exit', (code) => resolve(code)));
    wire.child.kill('SIGTERM');
    expect(await exited).toBe(0);
    expectOnlyFrames(wire.stdout());
  }, 30_000);

  it('never prints the voice key, and never reads the generic ElevenLabs variable', async () => {
    // No publish here, so nothing is sent anywhere: this is about what the process says of its own configuration.
    const withKey = startWire({ LEARNING_TOOL_ELEVENLABS_API_KEY: FAKE_KEY });
    await handshake(withKey);
    const started = await withKey.call('start_lesson', EXAMPLE_START);
    expect(started.voice.enabled).toBe(true);
    const tools = await withKey.request('tools/list');
    const publish = tools.result.tools.find((t: { name: string }) => t.name === 'publish_lesson');
    // With voice on, publishing can reach ElevenLabs, and the tool says so.
    expect(publish.annotations.openWorldHint).toBe(true);
    await withKey.call('get_lesson', { lessonId: started.lessonId });
    await withKey.end();

    const generic = startWire({ ELEVENLABS_API_KEY: FAKE_KEY });
    await handshake(generic);
    expect((await generic.call('start_lesson', { ...EXAMPLE_START, topic: 'Another topic' })).voice.enabled).toBe(false);
    await generic.end();

    const placeholder = startWire({ LEARNING_TOOL_ELEVENLABS_API_KEY: '${user_config.elevenlabs_api_key}' });
    await handshake(placeholder);
    expect((await placeholder.call('start_lesson', { ...EXAMPLE_START, topic: 'A third topic' })).voice.enabled).toBe(false);
    await placeholder.end();

    const everything = [withKey, generic, placeholder].map((w) => w.stdout() + w.stderr()).join('\n') + (await filesUnder(home)).map((f) => f.bytes.toString('latin1')).join('\n');
    expect(everything.toLowerCase()).not.toContain(FAKE_KEY_MARKER);
    expect(everything).not.toContain(FAKE_KEY.slice(-16));
  }, 30_000);

  it('is self-contained: it runs from a folder with no node_modules', async () => {
    const lonely = path.join(path.dirname(home), 'lonely');
    const copy = path.join(lonely, 'learning-tool.mjs');
    await cp(BUNDLE, copy);
    const wire = startWire({}, lonely, copy);
    await handshake(wire);
    expect((await wire.call('start_lesson', EXAMPLE_START)).ok).toBe(true);
    expect((await wire.end()).code).toBe(0);
    // Nothing but node's own modules is imported.
    const source = await readFile(BUNDLE, 'utf8');
    const imports = [...source.matchAll(/^import .* from ["']([^"']+)["'];?$/gm)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(3);
    expect(imports.filter((name) => !name.startsWith('node:'))).toEqual([]);
  }, 20_000);
});

describe('the spawned bundle, through the SDK client', () => {
  const clients: Client[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
  });

  async function connect(mode: 'legacy' | 'auto'): Promise<Client> {
    const transport = new StdioClientTransport({ command: process.execPath, args: [BUNDLE], env: childEnv(), stderr: 'pipe' });
    const client = new Client({ name: 'stdio-test', version: '0' }, mode === 'auto' ? { versionNegotiation: { mode: 'auto' } } : undefined);
    clients.push(client);
    await client.connect(transport);
    return client;
  }

  it.each(['legacy', 'auto'] as const)('serves a lesson to a client in %s mode', async (mode) => {
    const client = await connect(mode);
    // `auto` starts the server twice (a probe, then the real one). Neither may have left anything behind.
    expect(existsSync(home)).toBe(false);
    expect(client.getInstructions()).toMatch(/^Learning Tool builds a short visual lesson/);
    expect(client.getNegotiatedProtocolVersion()).toBe(mode === 'auto' ? '2026-07-28' : '2025-11-25');
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(8);

    const call = async (name: string, args: unknown): Promise<any> => {
      const result = await client.callTool({ name, arguments: args as Record<string, unknown> });
      expect(result.structuredContent).toEqual(JSON.parse((result.content as { text: string }[])[0]!.text));
      return result.structuredContent;
    };
    const lessonId = (await call('start_lesson', EXAMPLE_START)).lessonId;
    await call('save_evidence', { lessonId, items: EXAMPLE_EVIDENCE });
    await oldPlan(lessonId);
    await Promise.all(EXAMPLE_SCENES.map((scene) => call('submit_scene', { lessonId, scene })));
    const published = await call('publish_lesson', { lessonId });
    expect(published).toMatchObject({ ok: true, stage: 'published' });
    expect((await fetch(published.local.url)).status).toBe(200);
    // One draft, one lesson: the probe process wrote nothing of its own.
    expect((await readdir(path.join(home, '.state', 'drafts'))).length).toBe(1);
    expect((await readdir(path.join(home, 'lessons'))).length).toBe(1);

    const rejected = await client.callTool({ name: 'submit_scene', arguments: { lessonId, scene: 'not a scene' } });
    expect(rejected.isError).toBe(true);
    expect((rejected.structuredContent as { errors: unknown[] }).errors.length).toBeGreaterThan(0);

    const prompt = await client.getPrompt({ name: 'teach', arguments: { topic: 'recursion' } });
    expect((prompt.messages[0]!.content as { text: string }).text).toContain('Teach me about "recursion" with Learning Tool.');
  }, 30_000);
});

describe('the commands for people', () => {
  // The developer's own shell may hold a real ElevenLabs key. It must never reach a server started by a test.
  const env = (): NodeJS.ProcessEnv => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/ELEVENLABS|LEARNING_TOOL_/i.test(name)));
    return { ...clean, ...childEnv() };
  };

  async function lt(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await run(process.execPath, [LT, ...args], { env: env(), cwd: ROOT });
      return { code: 0, stdout, stderr };
    } catch (e) {
      const failed = e as { code?: number; stdout?: string; stderr?: string };
      return { code: failed.code ?? -1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
    }
  }

  async function bundle(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await run(process.execPath, [BUNDLE, ...args], { env: env(), cwd: ROOT });
      return { code: 0, stdout, stderr };
    } catch (e) {
      const failed = e as { code?: number; stdout?: string; stderr?: string };
      return { code: failed.code ?? -1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
    }
  }

  it('lt.mjs drives a lesson to a published file, and the bundle verifies it', async () => {
    const started = await lt('start_lesson', JSON.stringify(EXAMPLE_START));
    expect(started.code).toBe(0);
    const lessonId = JSON.parse(started.stdout).lessonId as string;
    expect(lessonId).toMatch(/^[a-z0-9]{12}$/);

    // Arguments from a file, for anything too long for a command line.
    const argsFile = path.join(path.dirname(home), 'evidence.json');
    await writeFile(argsFile, JSON.stringify({ lessonId, items: EXAMPLE_EVIDENCE }));
    const saved = await lt('save_evidence', '--args-file', argsFile, '--compact');
    expect(saved.code).toBe(0);
    expect(saved.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(saved.stdout).saved).toBe(5);

    // A plan in the older kinds is a rejection like any other: the envelope on stdout, exit 1.
    const oldKinds = await lt('plan_lesson', JSON.stringify({ lessonId, ...EXAMPLE_PLAN }), '--compact');
    expect(oldKinds.code).toBe(1);
    expect(JSON.parse(oldKinds.stdout)).toMatchObject({ ok: false, next: { tool: 'plan_lesson' }, errors: expect.arrayContaining([expect.objectContaining({ code: 'PLAN_LEGACY_KIND' })]) });
    await oldPlan(lessonId);
    for (const scene of EXAMPLE_SCENES) expect((await lt('submit_scene', JSON.stringify({ lessonId, scene }), '--compact')).code).toBe(0);

    // A rejection prints the envelope and exits 1.
    const rejected = await lt('submit_scene', JSON.stringify({ lessonId, scene: { id: 's1', kind: 'recap' } }));
    expect(rejected.code).toBe(1);
    expect(JSON.parse(rejected.stdout)).toMatchObject({ ok: false, next: { tool: 'submit_scene' } });

    const published = await lt('publish_lesson', JSON.stringify({ lessonId }));
    expect(published.code).toBe(0);
    const file = JSON.parse(published.stdout).file.path as string;
    expect(existsSync(file)).toBe(true);
    // Publishing makes the server log a line ("serving published lessons on ..."). An agent's command tool
    // shows stdout and stderr as one stream, and that line in front of the JSON broke whatever read it.
    // So on a call that works, the result is all there is, on either stream.
    expect(published.stderr).toBe('');
    expect(JSON.parse(`${published.stderr}${published.stdout}`)).toMatchObject({ ok: true, published: true });
    // The log is there for whoever asks for it, on stderr.
    const logged = await lt('publish_lesson', JSON.stringify({ lessonId }), '--log', '--compact');
    expect(logged.stderr).toMatch(/^learning-tool: serving published lessons on http:\/\/127\.0\.0\.1:\d+\//);
    expect(JSON.parse(logged.stdout)).toMatchObject({ ok: true, republished: true });
    // The reply leads with the file, and gives the counts as passages, pages and sites.
    expect(JSON.parse(published.stdout).reply).toContain(`give them the file first: ${file}`);
    expect(JSON.parse(published.stdout).reply).toContain('5 passages from 5 pages on 3 sites');

    const verified = await bundle('verify', file);
    expect(verified.stdout).toMatch(/^OK {2}"Binary search/);
    expect(verified.stdout).toContain('matches the receipt');
    expect(verified.stdout).toContain('page     identical to what this build renders from the data');
    expect(verified.code).toBe(0);
    expect((await bundle('verify', file, '--strict')).code).toBe(0);
    const json = await bundle('verify', file, '--json');
    expect(JSON.parse(json.stdout)).toMatchObject({ ok: true, dataOk: true, lesson: { id: lessonId, scenes: 9, sources: 5 }, hash: { matches: true }, receiptMatches: true, page: { result: 'identical' } });
    // The receipt names the build that wrote the page, which is the one answering here.
    expect(await readFile(file, 'utf8')).toContain(`"version":"${(await bundle('--version')).stdout.trim()}"`);

    // Change a sentence the learner reads and leave the data alone: the data holds, the page does not, exit 1.
    const html = await readFile(file, 'utf8');
    const at = html.indexOf('id="lt-data"');
    const visible = html.slice(0, at).replace('throws away the half where the value cannot be', 'keeps only the half where the value cannot be') + html.slice(at);
    expect(visible).not.toBe(html);
    await writeFile(file, visible);
    const differs = await bundle('verify', file);
    expect(differs.code).toBe(1);
    expect(differs.stdout).toMatch(/^DATA OK, PAGE DIFFERS {2}"Binary search/);
    expect(differs.stdout).not.toContain('This shows the lesson is the one that was validated');
    expect((await bundle('verify', file, '--data-only')).code).toBe(0);
    expect((await bundle('verify', file, '--data-only')).stdout).toMatch(/^DATA OK, PAGE NOT COMPARED/);

    // Corrupt the embedded lesson: verify fails with exit 1.
    await writeFile(file, html.replace('"answer":20', '"answer":2'));
    const failed = await bundle('verify', file);
    expect(failed.code).toBe(1);
    expect(failed.stdout).toMatch(/^FAILED/);
    expect(failed.stdout).toContain('does not match the receipt');
    expect((await bundle('verify', file, '--data-only')).code).toBe(1);
  }, 60_000);

  it('a lesson the learner can poke goes through the spawned server, and the bundle verifies it with --strict', async () => {
    // An explore on bars, one on a curve chart, one on dots with a goal, and a gate answered by a tap.
    const lesson = interactiveLesson();
    const wire = startWire();
    await handshake(wire);
    const started = await wire.call('start_lesson', lesson.start);
    expect(started).toMatchObject({ ok: true, stage: 'started', limits: { clip: { chartMarks: ['bars', 'line', 'curve'] } } });
    expect(started.limits.actFirst).toMatch(/^The learner acts before being told/);
    const lessonId = started.lessonId as string;
    expect(await wire.call('save_evidence', { lessonId, items: lesson.evidence })).toMatchObject({ ok: true, saved: 5 });

    const plan = await wire.call('plan_lesson', { lessonId, ...lesson.plan });
    expect(plan.errors).toEqual([]);
    // The plan named the mark of its curve chart, and got that chart's template, explore and all.
    const curveTemplate = (plan.templates as { id: string; stage?: { mark?: string }; explore?: unknown }[]).find((t) => t.id === 'x-curve')!;
    expect(curveTemplate.stage).toMatchObject({ kind: 'chart', mark: 'curve' });
    expect(curveTemplate.explore).toBeDefined();

    // What an agent gets wrong first: `**` for a power. The bundle refuses it as the tools in memory do.
    const wrong = interactive('bars');
    wrong.explore.bind[0].expr = '2**doublings';
    const refused = await wire.call('submit_scene', { lessonId, scene: wrong });
    expect(refused).toMatchObject({ ok: false, accepted: false, sceneId: 'x-bars', next: { tool: 'submit_scene' } });
    expect(refused.errors.map((e: { code: string; path: string }) => `${e.code} ${e.path}`)).toEqual(['FORMULA_SYNTAX explore.bind[0].expr']);
    expect(refused.errors[0].fix).toMatch(/^Write a power with "\^": x\^2, not x \*\* 2\. A formula uses numbers, your control ids/);
    expect(refused.template.explore.bind).toEqual([{ target: 'b', expr: 'amount * 10' }]);

    const first = await wire.call('submit_scene', { lessonId, scene: lesson.scenes[0] });
    expect(first.errors).toEqual([]);
    const rest = await Promise.all(lesson.scenes.slice(1).map((scene) => wire.call('submit_scene', { lessonId, scene })));
    expect(rest.flatMap((r) => r.errors)).toEqual([]);
    expect(rest.flatMap((r) => r.warnings)).toEqual([]);
    expect(rest.find((r) => r.pending.length === 0)).toMatchObject({ stage: 'ready', next: { tool: 'publish_lesson' }, lessonReport: { ok: true, errors: [], warnings: [] } });

    const published = await wire.call('publish_lesson', { lessonId });
    expect(published).toMatchObject({ ok: true, stage: 'published', published: true, next: { tool: 'reply' } });
    expect((await wire.end()).code).toBe(0);
    expectOnlyFrames(wire.stdout());

    const file = published.file.path as string;
    const verified = await bundle('verify', file, '--strict');
    expect(verified.stdout).toMatch(/^OK {2}"Binary search, with your hands on it"/);
    expect(verified.stdout).toContain('page     identical to what this build renders from the data');
    expect(verified.code).toBe(0);
    expect(JSON.parse((await bundle('verify', file, '--json')).stdout)).toMatchObject({ ok: true, dataOk: true, lesson: { id: lessonId, scenes: lesson.scenes.length }, hash: { matches: true }, receiptMatches: true, page: { result: 'identical' } });

    // The sliders, the formulas and the goal are in the page's data, and a formula changed there is another lesson.
    const html = await readFile(file, 'utf8');
    expect(html).toContain('"expr":"2^doublings"');
    expect(html).toContain('"when":"64 / 2^looks == 4"');
    expect(html).toContain('"pick":["c2"]');
    await writeFile(file, html.replace('"expr":"2^doublings"', '"expr":"3^doublings"'));
    const failed = await bundle('verify', file);
    expect(failed.code).toBe(1);
    expect(failed.stdout).toMatch(/^FAILED/);
  }, 60_000);

  it('the clip example goes through the spawned server from start to a published file, and the bundle verifies it', async () => {
    const wire = startWire();
    await handshake(wire);
    const outline = CLIP_PARTS.plan.outline as { id: string; kind: string; stage?: string }[];
    const scenes = CLIP_PARTS.scenes as { id: string; kind: string }[];

    const started = await wire.call('start_lesson', CLIP_PARTS.start);
    expect(started).toMatchObject({ ok: true, stage: 'started', next: { tool: 'save_evidence' } });
    expect(started.contract).toMatch(/VISUAL FIRST\. The picture carries the idea/);
    const lessonId = started.lessonId as string;
    expect(await wire.call('save_evidence', { lessonId, items: CLIP_PARTS.evidence })).toMatchObject({ ok: true, stage: 'researching', saved: 5, next: { tool: 'plan_lesson' } });

    const plan = await wire.call('plan_lesson', { lessonId, ...CLIP_PARTS.plan });
    expect(plan.errors).toEqual([]);
    expect(plan).toMatchObject({ ok: true, stage: 'planned', next: { tool: 'submit_scene' } });
    expect(plan.templates.map((t: { id: string; kind: string; stage?: { kind: string } }) => [t.id, t.kind, t.stage?.kind])).toEqual(outline.map((e) => [e.id, e.kind, e.stage]));

    const first = await wire.call('submit_scene', { lessonId, scene: scenes[0] });
    expect(first.errors).toEqual([]);
    expect(first).toMatchObject({ ok: true, accepted: true, stage: 'writing', next: { tool: 'submit_scene' } });
    // The words of each caption, one number per beat.
    expect(first.metrics.beats).toHaveLength((scenes[0] as unknown as { beats: unknown[] }).beats.length);
    const rest = await Promise.all(scenes.slice(1).map((scene) => wire.call('submit_scene', { lessonId, scene })));
    expect(rest.flatMap((r) => r.errors)).toEqual([]);
    expect(rest.find((r) => r.pending.length === 0)).toMatchObject({ stage: 'ready', next: { tool: 'publish_lesson' }, lessonReport: { ok: true, errors: [] } });

    const published = await wire.call('publish_lesson', { lessonId });
    expect(published).toMatchObject({ ok: true, stage: 'published', published: true, next: { tool: 'reply' } });
    expect(published.reply).toContain(`${scenes.length} scenes`);
    expect((await wire.end()).code).toBe(0);
    expectOnlyFrames(wire.stdout());

    const file = published.file.path as string;
    const verified = await bundle('verify', file, '--strict');
    expect(verified.stdout).toMatch(/^OK {2}"Binary search/);
    expect(verified.stdout).toContain('page     identical to what this build renders from the data');
    expect(verified.code).toBe(0);
    expect(JSON.parse((await bundle('verify', file, '--json')).stdout)).toMatchObject({ ok: true, dataOk: true, lesson: { id: lessonId, scenes: scenes.length, sources: 5 }, hash: { matches: true }, receiptMatches: true, page: { result: 'identical' } });

    // A caption changed in the page a learner reads, with the data left alone: the data holds, the page does not.
    const html = await readFile(file, 'utf8');
    const at = html.indexOf('id="lt-data"');
    const caption = 'You want exactly one of them.';
    expect(html.slice(0, at)).toContain(caption);
    await writeFile(file, html.slice(0, at).replace(caption, 'You want all of them.') + html.slice(at));
    const differs = await bundle('verify', file);
    expect(differs.code).toBe(1);
    expect(differs.stdout).toMatch(/^DATA OK, PAGE DIFFERS {2}"Binary search/);
    expect(differs.stdout).not.toContain('This shows the lesson is the one that was validated');
    expect((await bundle('verify', file, '--data-only')).code).toBe(0);

    // An action changed in the embedded data, with the page left alone: the lesson is no longer the one that was validated.
    const edited = html.slice(0, at) + html.slice(at).replace('"tone":"warn"', '"tone":"good"');
    expect(edited).not.toBe(html);
    await writeFile(file, edited);
    const failed = await bundle('verify', file);
    expect(failed.code).toBe(1);
    expect(failed.stdout).toMatch(/^FAILED/);
    expect(failed.stdout).toContain('does not match the receipt');
    expect((await bundle('verify', file, '--data-only')).code).toBe(1);
  }, 60_000);

  it('lt.mjs prints the guide with its text, and shows what the server said when a call cannot be made', async () => {
    const guide = await lt('get_guide', JSON.stringify({ section: 'voice' }), '--compact');
    expect(guide.code).toBe(0);
    const body = JSON.parse(guide.stdout);
    expect(body).toMatchObject({ ok: true, section: 'voice', part: 1 });
    expect(body.text).toMatch(/^# Voice/);
    expect(body.text.length).toBeGreaterThan(body.chars);
    // A server that dies at once: its own words are the best clue, and they are passed on.
    const broken = path.join(path.dirname(home), 'broken.mjs');
    await writeFile(broken, 'process.stderr.write("the server said why\\n"); process.exit(3);\n');
    const failed = await lt('get_guide', '{}', '--server', broken);
    expect(failed.code).toBe(1);
    expect(failed.stdout).toBe('');
    expect(failed.stderr).toContain('the server said why');
  }, 30_000);

  it('lt.mjs --keep holds the server, and so the local link, open until it is interrupted', async () => {
    // Build the lesson in process over the same home; publish it through lt.mjs.
    const world = await startWorld({ home });
    const lessonId = await written(world);
    await world.close();

    const child = spawn(process.execPath, [LT, 'publish_lesson', JSON.stringify({ lessonId }), '--keep', '--compact'], { env: env(), cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => (out += c));
    child.stderr.setEncoding('utf8').on('data', (c: string) => (err += c));
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    try {
      const until = Date.now() + 15_000;
      while (!err.includes('Press Ctrl-C') && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
      const published = JSON.parse(out);
      expect(published).toMatchObject({ ok: true, stage: 'published' });
      expect((await fetch(published.local.url)).status).toBe(200);
      child.kill('SIGINT');
      expect(await exited).toBe(0);
      await expect(fetch(published.local.url)).rejects.toThrow();
    } finally {
      child.kill('SIGKILL');
    }
  }, 30_000);

  it('lt.mjs lists the tools and prints the instructions', async () => {
    const listed = await lt('--list');
    expect(JSON.parse(listed.stdout).map((t: { name: string }) => t.name)).toEqual([...TOOL_NAMES]);
    const instructions = await lt('--instructions');
    expect(instructions.stdout).toMatch(/^Learning Tool builds a short visual lesson/);
    expect(instructions.stdout).toContain('start_lesson');
    // What a person sees here is what an agent is told now: clips, and none of the older scene kinds.
    expect(instructions.stdout.trim()).toBe(INSTRUCTIONS);
    expect(instructions.stdout).toMatch(/SHOW, DO NOT TELL\. Teaching scenes are clips: the picture carries the idea\./);
    const tools = JSON.parse(listed.stdout) as { name: string; description: string; inputSchema: any }[];
    const described = toolDescriptions(guideSections(GUIDE));
    for (const tool of tools) {
      expect(tool.description, tool.name).toBe(described[tool.name as keyof typeof described]);
      expect(tool.description, tool.name).not.toMatch(/narration|step_through|step-through/i);
    }
    const outline = tools.find((t) => t.name === 'plan_lesson')!.inputSchema.properties.outline.items.properties;
    expect(outline.kind.enum).toEqual(['clip', 'checkpoint', 'recap']);
    expect(outline.stage.enum).toEqual([...PLAN_STAGE_KINDS]);
    expect(outline.figure).toBeUndefined();
  }, 20_000);

  it('lt.mjs explains its own misuse and exits 2', async () => {
    expect((await lt()).code).toBe(2);
    const badJson = await lt('start_lesson', '{not json');
    expect(badJson.code).toBe(2);
    expect(badJson.stderr).toContain('not valid JSON');
    expect((await lt('start_lesson', '{}', '--frobnicate')).code).toBe(2);
    const missingServer = await lt('get_guide', '--server', path.join(home, 'nope.mjs'));
    expect(missingServer.code).toBe(2);
    expect(missingServer.stderr).toContain('node scripts/build.mjs');
    expect(existsSync(home)).toBe(false);
  }, 20_000);

  it('verify refuses a missing file, a non-lesson and bad usage with exit 1', async () => {
    expect((await bundle('verify', path.join(home, 'missing.html'))).code).toBe(1);
    const notLesson = path.join(path.dirname(home), 'page.html');
    await writeFile(notLesson, '<!doctype html><p>hello</p>');
    const result = await bundle('verify', notLesson);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('No Learning Tool lesson data');
    expect((await bundle('verify')).code).toBe(1);
    expect((await bundle('verify', notLesson, '--frobnicate')).code).toBe(1);
    const both = await bundle('verify', notLesson, '--strict', '--data-only');
    expect(both.code).toBe(1);
    expect(both.stderr).toContain('[--data-only | --strict]');
  }, 20_000);

  it('voice-check reports voice off without contacting anything, and exits 0', async () => {
    const result = await bundle('voice-check');
    expect(result.stdout).toMatch(/^VOICE_OFF: Voice is off/);
    expect(result.code).toBe(0);
    const json = await bundle('voice-check', '--json');
    expect(JSON.parse(json.stdout)).toMatchObject({ code: 'VOICE_OFF', configured: false, reachable: false });
    expect((await bundle('voice-check', '--frobnicate')).code).toBe(1);
  }, 20_000);

  it('prints its version and usage, and rejects an unknown command', async () => {
    const version = await bundle('--version');
    // The version and the build: the same string a receipt records.
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{8}$/);
    expect((await bundle('--help')).stdout).toContain('verify <file.html>');
    const unknown = await bundle('frobnicate');
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('Unknown command');
    expect(unknown.stdout).toBe('');
  }, 20_000);
});
