// Entry point of the bundled server (plugin/server/learning-tool.mjs).
//
//   no arguments          serve the MCP tools over stdio
//   verify <file.html>    re-validate a published lesson; exit 0 or 1
//   voice-check           report whether voice is configured and reachable
//
// While serving, stdout carries protocol frames and nothing else. Everything this process has to say
// goes to stderr, and console.log is pointed there too, so that a stray log line from any module
// cannot corrupt the stream.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { VERSION } from '../generated/version';
import { stampedVersion } from './build-id';
import { runVerify, runVoiceCheck, USAGE, type Io } from './cli';
import { createDeps } from './deps';
import { buildServer } from './server';

/** The SDK's own words for a line on stdin longer than its read buffer (10 MB). */
const OVERSIZED = /^ReadBuffer exceeded maximum size/;
const OVERSIZED_NOTE =
  'a message larger than 10 MB arrived on stdin, which no tool call needs (one scene, one plan or up to 10 evidence items per call). The connection is closed and the server is stopping with status 1; restart it to go on. Published lesson files are unaffected.';

function serve(): void {
  const toStderr = (...args: unknown[]): void => console.error(...args);
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;

  // Reading the environment is all this does. No folder, port or request exists until a tool needs one:
  // a host may start this process twice and discard one.
  const deps = createDeps(process.env);
  const handle = serveStdio(() => buildServer(deps), {
    onerror: (error) => {
      console.error(`learning-tool: ${error.name}: ${error.message}`);
      // The SDK's transport cannot answer a message it could not hold: it drops what it has read and
      // closes the connection, and this process then ends. That must not look like a clean exit, or
      // the host shows no failure and the agent is left with a tool that silently went away.
      if (OVERSIZED.test(error.message)) {
        console.error(`learning-tool: ${OVERSIZED_NOTE}`);
        process.exitCode = 1;
      }
    },
  });

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void Promise.allSettled([handle.close(), deps.listener.close()]).then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

const io: Io = { out: (line) => process.stdout.write(`${line}\n`), err: (line) => process.stderr.write(`${line}\n`) };
const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case undefined:
    serve();
    break;
  case 'verify':
    process.exitCode = await runVerify(rest, io);
    break;
  case 'voice-check':
    process.exitCode = await runVoiceCheck(rest, io, process.env);
    break;
  case '--version':
  case '-v':
  case 'version':
    // With the build, which is what a receipt records and what `verify` compares.
    io.out(stampedVersion(VERSION));
    break;
  case '--help':
  case '-h':
  case 'help':
    io.out(USAGE);
    break;
  default:
    io.err(`Unknown command. ${USAGE}`);
    process.exitCode = 1;
}
