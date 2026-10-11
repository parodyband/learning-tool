// The MCP server: eight tools, one prompt, and the instructions a host shows its model.
//
// `buildServer(deps)` is a factory. The stdio entry may call it more than once in one process (a
// host's version probe gets an instance that is thrown away), and every test calls it, so building
// a server has no side effects: no file, no port, no request. Things are created when a tool
// needs them.
import { McpServer, type ToolAnnotations } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ServerDeps } from './deps';
import { toResult } from './envelope';
import { TOOL_NAMES, type ToolName } from './next';
import { advertised, TOOL_SCHEMAS } from './schemas';
import { INSTRUCTIONS, teachPrompt, toolDescriptions } from './texts';
import { HANDLERS } from './tools';
import { guideSections } from './tools/guide';

export const SERVER_NAME = 'learning-tool';

export const TOOL_TITLES: Record<ToolName, string> = {
  start_lesson: 'Start a lesson',
  save_evidence: 'Save source excerpts',
  plan_lesson: 'Plan the lesson',
  submit_scene: 'Submit a scene',
  validate_lesson: 'Check the whole lesson',
  publish_lesson: 'Publish the lesson',
  get_lesson: 'Show a lesson',
  get_guide: 'Read the design guide',
};

/**
 * All four hints, on every tool, because the protocol's defaults assume the worst (destructive and
 * open-world). Nothing here reaches the network except publish_lesson when the learner has turned
 * voice on, and only plan_lesson can discard work: replacing a plan drops the scenes that no longer
 * fit it.
 */
export function toolAnnotations(deps: ServerDeps): Record<ToolName, Required<Pick<ToolAnnotations, 'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint'>>> {
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  return {
    start_lesson: write,
    save_evidence: write,
    plan_lesson: { ...write, destructiveHint: true },
    submit_scene: write,
    validate_lesson: read,
    publish_lesson: { ...write, openWorldHint: deps.voice.config !== null },
    get_lesson: read,
    get_guide: read,
  };
}

export function buildServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, title: 'Learning Tool', version: deps.version }, { instructions: INSTRUCTIONS });
  const descriptions = toolDescriptions(guideSections(deps.guide));
  const annotations = toolAnnotations(deps);
  // One per connection: work in flight for a host that has gone away is stopped.
  const closing = new AbortController();

  for (const name of TOOL_NAMES) {
    server.registerTool(
      name,
      { title: TOOL_TITLES[name], description: descriptions[name], inputSchema: advertised(TOOL_SCHEMAS[name]), annotations: { title: TOOL_TITLES[name], ...annotations[name] } },
      async (raw: unknown) => toResult(await HANDLERS[name](deps, raw, { signal: closing.signal })),
    );
  }

  server.registerPrompt(
    'teach',
    {
      title: 'Teach me with Learning Tool',
      description: 'Start a Learning Tool lesson on a topic. The agent asks two or three questions first, then researches, builds the lesson and replies with a link.',
      // Optional, and one word is enough: hosts split prompt arguments on spaces, and the prompt asks the agent to confirm the topic.
      argsSchema: z.object({ topic: z.string().optional().describe('What you want to learn. Leave empty to be asked.') }),
    },
    ({ topic }) => ({
      description: 'Teach me with Learning Tool',
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: teachPrompt(topic, deps.guide) } }],
    }),
  );

  // The listener must not outlive the connection: a process holding a port would never exit.
  server.server.onclose = () => {
    closing.abort();
    void deps.listener.close();
  };
  return server;
}
