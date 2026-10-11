#!/usr/bin/env node
// A tiny MCP client for people and tests without a host. It starts the built server
// (plugin/server/learning-tool.mjs) with the current environment, calls one tool, and prints the
// result as JSON.
//
//   node scripts/lt.mjs <tool> '<json arguments>'
//   node scripts/lt.mjs <tool> --args-file path/to/arguments.json
//   node scripts/lt.mjs --list                    the tools, with their descriptions and schemas
//   node scripts/lt.mjs --instructions            what the server tells a host at connection
//
// Options:
//   --keep       after a call, keep the server running until Ctrl-C, so that the http://127.0.0.1
//                link from publish_lesson stays open (it lives only as long as the server does)
//   --compact    print the JSON on one line
//   --log        pass the server's own log lines through to stderr as they come
//   --server p   use another server file
//
// What is printed: stdout carries the result and nothing else, so it can be piped into a JSON
// parser. The server logs to stderr ("serving published lessons on ..."). Those lines are held
// back unless --log is given or the call fails, because many shells and every agent's command
// tool show stdout and stderr as one stream, and a log line in front of the JSON breaks whatever
// reads it.
//
// Exit status: 0 when the result has "ok": true, 1 when it has "ok": false or the call failed,
// 2 for a mistake in how this script was called.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = `Usage:
  node scripts/lt.mjs <tool> '<json arguments>' [--keep] [--compact] [--log]
  node scripts/lt.mjs <tool> --args-file <path>
  node scripts/lt.mjs --list | --instructions

Example:
  node scripts/lt.mjs start_lesson '{"topic":"How binary search works","learner":{"level":"new","knows":"Not stated.","goal":"Explain it."}}'`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const flags = { keep: false, compact: false, list: false, instructions: false, log: false };
let server = path.join(root, 'plugin', 'server', 'learning-tool.mjs');
let argsFile;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--keep') flags.keep = true;
  else if (arg === '--compact') flags.compact = true;
  else if (arg === '--log') flags.log = true;
  else if (arg === '--list') flags.list = true;
  else if (arg === '--instructions') flags.instructions = true;
  else if (arg === '--args-file') argsFile = argv[++i] ?? fail(`--args-file needs a path.\n${USAGE}`);
  else if (arg === '--server') server = path.resolve(argv[++i] ?? fail(`--server needs a path.\n${USAGE}`));
  else if (arg === '--help' || arg === '-h') {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  } else if (arg.startsWith('--')) fail(`Unknown option ${arg}.\n${USAGE}`);
  else positional.push(arg);
}

const [tool, inline] = positional;
if (!flags.list && !flags.instructions && !tool) fail(USAGE);
if (positional.length > 2) fail(`Too many arguments. Put the JSON in single quotes.\n${USAGE}`);
if (inline !== undefined && argsFile !== undefined) fail('Give the arguments inline or with --args-file, not both.');

let toolArguments = {};
if (tool) {
  let source = inline;
  if (argsFile !== undefined) {
    try {
      source = readFileSync(path.resolve(argsFile), 'utf8');
    } catch {
      fail(`Could not read ${argsFile}.`);
    }
  }
  if (source !== undefined && source.trim() !== '') {
    try {
      toolArguments = JSON.parse(source);
    } catch (e) {
      fail(`The arguments are not valid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
    }
  }
}

if (!existsSync(server)) fail(`The server has not been built: ${server} is missing. Run "node scripts/build.mjs" first.`);

// The whole environment is passed on (LEARNING_TOOL_HOME, the voice key ...). The SDK's default would pass six variables.
const env = Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'));
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env, stderr: 'pipe' });
// The server's log: passed on at once with --log, otherwise kept and shown only if the call fails.
let held = '';
transport.stderr?.on('data', (chunk) => {
  if (flags.log) process.stderr.write(chunk);
  else held += chunk.toString('utf8');
});
const releaseLog = () => {
  if (held !== '') process.stderr.write(held);
  held = '';
};
const client = new Client({ name: 'lt', version: '0.1.0' });
const print = (value) => process.stdout.write(`${JSON.stringify(value, null, flags.compact ? undefined : 2)}\n`);

let status = 0;
try {
  await client.connect(transport);
  if (flags.instructions) {
    process.stdout.write(`${client.getInstructions() ?? ''}\n`);
  } else if (flags.list) {
    const { tools } = await client.listTools();
    print(tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })));
  } else {
    const result = await client.callTool({ name: tool, arguments: toolArguments });
    // The envelope is in structuredContent; the text block holds the same JSON for hosts that only read text.
    const text = Array.isArray(result.content) ? result.content.find((c) => c.type === 'text')?.text : undefined;
    let body = result.structuredContent;
    if (body === undefined) {
      try {
        body = text === undefined ? result : JSON.parse(text);
      } catch {
        body = { ok: false, message: text };
      }
    } else if (tool === 'get_guide' && body.ok === true && typeof text === 'string') {
      // get_guide sends the guide as its text block and leaves it out of the envelope. Here the two are put together.
      body = { ...body, text };
    }
    print(body);
    if (result.isError || body?.ok === false) status = 1;
    if (flags.keep) {
      process.stderr.write('The server is still running, so the 127.0.0.1 link stays open. Press Ctrl-C to stop.\n');
      await new Promise((resolve) => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
    }
  }
} catch (e) {
  // Whatever the server said before it failed is the best clue there is.
  releaseLog();
  process.stderr.write(`${e instanceof Error ? e.message : 'The call failed.'}\n`);
  status = 1;
} finally {
  await client.close().catch(() => undefined);
}
process.exit(status);
