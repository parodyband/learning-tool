// The plugin manifest, its MCP configuration and the marketplace entry must parse, agree with each
// other and with the build, and point at things that exist. `claude plugin validate plugin --strict`
// is the authoritative check of the manifest's shape; this guards what that command does not know:
// the server name and path the build writes, the environment variable the voice module reads.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { links, OTHER_PRODUCTS, PLUGIN_DIR, read, REF_DIR, ROOT } from './helpers';

const json = (file: string): any => JSON.parse(read(file));
const isDir = (p: string): boolean => existsSync(p) && statSync(p).isDirectory();
const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();

const PLUGIN_JSON = path.join(PLUGIN_DIR, '.claude-plugin/plugin.json');
const MCP_JSON = path.join(PLUGIN_DIR, '.mcp.json');
const MARKETPLACE_JSON = path.join(ROOT, '.claude-plugin/marketplace.json');

const KEY_OPTION = 'elevenlabs_api_key';
const KEY_VARIABLE = 'LEARNING_TOOL_ELEVENLABS_API_KEY';
const BUNDLE = 'plugin/server/learning-tool.mjs';

describe('plugin.json', () => {
  const manifest = json(PLUGIN_JSON);

  it('names the plugin and carries the metadata a strict validation asks for', () => {
    expect(manifest.name).toBe('learning-tool');
    expect(manifest.description.length).toBeGreaterThan(40);
    expect(manifest.author.name.length).toBeGreaterThan(0);
  });

  it('has the same version as package.json', () => {
    expect(manifest.version).toBe(json(path.join(ROOT, 'package.json')).version);
  });

  it('declares the ElevenLabs key as one optional, sensitive option', () => {
    expect(Object.keys(manifest.userConfig)).toEqual([KEY_OPTION]);
    const option = manifest.userConfig[KEY_OPTION];
    expect(option.type).toBe('string');
    expect(option.sensitive).toBe(true);
    expect(option.required ?? false).toBe(false);
    expect(option.title).toMatch(/optional/i);
    // The description is what the learner reads before pasting a key: it has to say where text goes.
    expect(option.description).toMatch(/ElevenLabs/);
    expect(option.description).toMatch(/sent/);
  });

  it('uses only the option fields Claude Code accepts, since an unknown one stops the plugin loading', () => {
    const allowed = new Set(['type', 'title', 'description', 'required', 'default', 'options', 'multiple', 'sensitive', 'min', 'max']);
    for (const option of Object.values<Record<string, unknown>>(manifest.userConfig)) {
      expect(Object.keys(option).filter((k) => !allowed.has(k))).toEqual([]);
      for (const required of ['type', 'title', 'description']) expect(option).toHaveProperty(required);
    }
  });

  it('declares no component path that is missing or leaves the plugin', () => {
    for (const key of ['skills', 'commands', 'agents', 'hooks', 'mcpServers', 'outputStyles']) {
      const value = manifest[key];
      for (const p of (Array.isArray(value) ? value : [value]).filter((v: unknown): v is string => typeof v === 'string')) {
        expect(p.startsWith('./') && !p.includes('..'), `${key}: ${p}`).toBe(true);
        expect(existsSync(path.join(PLUGIN_DIR, p)), `${key}: ${p}`).toBe(true);
      }
    }
  });

  it('ships the skill where Claude Code looks for it', () => {
    expect(isFile(path.join(PLUGIN_DIR, 'skills/learning-tool/SKILL.md'))).toBe(true);
  });
});

describe('.mcp.json', () => {
  const config = json(MCP_JSON);
  const manifest = json(PLUGIN_JSON);
  const lt = config.mcpServers.lt;

  it('declares exactly one server, named lt', () => {
    expect(Object.keys(config)).toEqual(['mcpServers']);
    expect(Object.keys(config.mcpServers)).toEqual(['lt']);
  });

  it('runs the bundled server with node from the plugin root', () => {
    expect(lt.command).toBe('node');
    expect(lt.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/server/learning-tool.mjs']);
  });

  it('points at the file the build writes', () => {
    const inPlugin = (lt.args[0] as string).replace('${CLAUDE_PLUGIN_ROOT}/', '');
    expect(path.posix.join('plugin', inPlugin)).toBe(BUNDLE);
    expect(read(path.join(ROOT, 'scripts/build.mjs'))).toContain(`'${BUNDLE}'`);
  });

  // The bundle is generated. Once the server source exists it must have been built, or the plugin
  // installs a server that cannot start. Before that there is nothing to build.
  it.skipIf(!existsSync(path.join(ROOT, 'src/server/main.ts')))('the bundled server exists (run `node scripts/build.mjs` if not)', () => {
    expect(isFile(path.join(ROOT, BUNDLE))).toBe(true);
  });

  it('passes the key as the one variable the voice module reads, from the declared option', () => {
    expect(lt.env).toEqual({ [KEY_VARIABLE]: `\${user_config.${KEY_OPTION}}` });
  });

  it('references only declared options', () => {
    const referenced = [...JSON.stringify(config).matchAll(/\$\{user_config\.([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const key of referenced) expect(Object.keys(manifest.userConfig)).toContain(key);
  });

  it('never forwards the generic ElevenLabs variable', () => {
    expect(Object.keys(lt.env)).not.toContain('ELEVENLABS_API_KEY');
    expect(JSON.stringify(config)).not.toMatch(/\$\{ELEVENLABS_API_KEY/);
  });

  it.skipIf(!existsSync(path.join(ROOT, 'src/tts/config.ts')))('uses the variable name src/tts/config.ts reads', () => {
    expect(read(path.join(ROOT, 'src/tts/config.ts'))).toContain(`'${KEY_VARIABLE}'`);
  });
});

describe('marketplace.json', () => {
  const marketplace = json(MARKETPLACE_JSON);
  const manifest = json(PLUGIN_JSON);

  it('has the required fields', () => {
    expect(marketplace.name).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    expect(marketplace.owner.name.length).toBeGreaterThan(0);
    expect(marketplace.description.length).toBeGreaterThan(0);
    expect(marketplace.plugins).toHaveLength(1);
  });

  it('lists the plugin under the name its own manifest uses', () => {
    expect(marketplace.plugins[0].name).toBe(manifest.name);
  });

  it('points at ./plugin, which holds a plugin manifest', () => {
    const source = marketplace.plugins[0].source;
    expect(source).toBe('./plugin');
    expect(isDir(path.join(ROOT, source))).toBe(true);
    expect(isFile(path.join(ROOT, source, '.claude-plugin/plugin.json'))).toBe(true);
  });

  it('does not restate the version, which plugin.json owns', () => {
    expect(marketplace.plugins[0].version).toBeUndefined();
  });
});

describe('GUIDE.md', () => {
  const text = read(path.join(ROOT, 'GUIDE.md'));
  const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]!);

  it('has host configuration snippets that are valid JSON and run the bundled server', () => {
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const server = JSON.parse(block).mcpServers['learning-tool'];
      expect(server.command).toBe('node');
      expect(server.args[0]).toMatch(/plugin\/server\/learning-tool\.mjs$/);
      for (const name of Object.keys(server.env ?? {})) expect(name).toBe(KEY_VARIABLE);
    }
  });

  it('installs the plugin by the id the marketplace gives it', () => {
    const marketplace = json(MARKETPLACE_JSON);
    expect(text).toContain(`claude plugin install ${marketplace.plugins[0].name}@${marketplace.name}`);
  });

  it('states the known limit and never promises verification', () => {
    expect(text).toMatch(/cannot prove that the excerpt is genuine/);
    expect(text.replace(/calls a lesson "verified"/g, '')).not.toMatch(/\bverified\b/i);
  });

  it('documents every npm script it tells people to run', () => {
    const scripts = Object.keys(json(path.join(ROOT, 'package.json')).scripts);
    const used = [...text.matchAll(/npm run ([a-z:]+)/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(scripts).toContain(name);
  });
});

describe('GUIDE.md describes the product that is built', () => {
  const text = read(path.join(ROOT, 'GUIDE.md'));
  const flat = text.replace(/\s+/g, ' ');

  it('says what a lesson is: clips, with the picture as the lesson', () => {
    expect(flat).toMatch(/the lesson is a sequence of \*\*clips\*\*, and in a clip the picture is the lesson/);
    expect(flat).toMatch(/play, pause, scrub back and replay/);
    expect(flat).toMatch(/\*\*prediction\*\*/);
  });

  // Version 3: a lesson is worked through. The paragraph says so in the learner's terms, and the
  // rest of the page agrees with it.
  it('says what a lesson now is: clips you can touch and, where it fits, a system you can poke', () => {
    expect(flat).toMatch(/\*\*Clips you can touch\.\*\* A lesson asks before it tells\./);
    expect(flat).toMatch(/a tap on the part of the picture you think is right/);
    expect(flat).toMatch(/a wrong tap gets a hint and another go/);
    expect(flat).toMatch(/handing you the system to poke: drag a slider/);
    expect(flat).toMatch(/a goal that takes understanding to reach/);
    expect(flat).toMatch(/A picture you can drag is never marked "Sourced"/);
    expect(flat).toMatch(/curves plotted from a formula/);
    // One short paragraph, not a section.
    const paragraph = text.split('\n\n').find((p) => p.startsWith('**Clips you can touch.**'))!;
    expect(paragraph.split(/\s+/).length).toBeLessThan(110);
  });

  it('names no other learning product or company', () => {
    expect(text).not.toMatch(OTHER_PRODUCTS);
  });

  it('lists every kind of stage', () => {
    for (const kind of ['sequence', 'cells', 'dots', 'chart', 'flow', 'words', 'lines', 'timeline', 'frame']) expect(text, kind).toContain(`| \`${kind}\` |`);
  });

  it('says what a custom frame is and that it is not checked', () => {
    expect(flat).toMatch(/\*\*The custom frame\.\*\*/);
    expect(flat).toMatch(/sandboxed worker/);
    expect(flat).toMatch(/not checked by Learning Tool/);
  });

  it('keeps install, the tools, voice and the development commands', () => {
    for (const heading of ['## Install', '## The tools', '## Voice (optional)', '## Development', '## License', '## Third-party notices']) expect(text).toContain(`\n${heading}\n`);
    expect(text).toContain('UPDATE_SKILL_DOCS=1 npx vitest run test/skill/format.test.ts');
    expect(text).toContain('claude plugin validate plugin --strict');
  });

  it('does not describe the version 1 scenes', () => {
    expect(text).not.toMatch(/step-through|step_through|narration scene|diagrams to step/i);
  });
});

// ---------------------------------------------------------------------------------------------
// The motion pack: MIT-licensed reference text by iart.ai, shipped inside the skill unmodified.
// ---------------------------------------------------------------------------------------------

describe('the vendored motion pack', () => {
  const VENDORED = path.join(REF_DIR, 'third-party/motion-design-skills');
  const UPSTREAM = path.join(ROOT, 'third_party/motion-design-skills');
  const SKILLS = ['animation-principles', 'color-motion', 'motion-art-direction', 'shot-composition'];

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))
      .sort();
  const files = walk(VENDORED).map((file) => path.relative(VENDORED, file));

  it('is the four skills the motion reference draws on, each with its references, and the licence', () => {
    expect(readdirSync(VENDORED).sort()).toEqual(['LICENSE', ...SKILLS].sort());
    for (const skill of SKILLS) {
      expect(files).toContain(`${skill}/SKILL.md`);
      expect(files.filter((f) => f.startsWith(`${skill}/references/`)).length, skill).toBeGreaterThan(0);
    }
    expect(files.every((f) => f === 'LICENSE' || f.endsWith('.md'))).toBe(true);
  });

  it('carries the MIT licence with its copyright line', () => {
    const licence = read(path.join(VENDORED, 'LICENSE'));
    expect(licence).toMatch(/^MIT License/);
    expect(licence).toMatch(/Copyright \(c\) \d{4} iart\.ai/);
    expect(licence).toMatch(/The above copyright notice and this permission notice shall be included/);
  });

  it.skipIf(!existsSync(UPSTREAM))('is byte for byte what third_party holds', () => {
    for (const file of files) {
      const upstream = file === 'LICENSE' ? path.join(UPSTREAM, 'LICENSE') : path.join(UPSTREAM, 'skills', file);
      expect(existsSync(upstream), file).toBe(true);
      expect(readFileSync(path.join(VENDORED, file)).equals(readFileSync(upstream)), file).toBe(true);
    }
    // Nothing of those four skills was left behind.
    for (const skill of SKILLS) expect(walk(path.join(UPSTREAM, 'skills', skill)).map((f) => path.relative(path.join(UPSTREAM, 'skills'), f))).toEqual(files.filter((f) => f.startsWith(`${skill}/`)));
  });

  it('is credited in motion.md, which links each skill and the licence and says when to open them', () => {
    const motion = path.join(REF_DIR, 'motion.md');
    const text = read(motion).replace(/\s+/g, ' ');
    expect(text).toMatch(/adapted from \*\*Motion Design Skills\*\* by iart\.ai, used under the MIT licence/);
    expect(text).toMatch(/included unmodified, with its licence/);
    const targets = links(motion).map((l) => l.target);
    expect(targets).toContain('third-party/motion-design-skills/LICENSE');
    for (const skill of SKILLS) expect(targets, skill).toContain(`third-party/motion-design-skills/${skill}/SKILL.md`);
    expect(text).toMatch(/Open it when you write a \*\*custom frame\*\*/);
    // Where the pack and the product differ, the product's rule is stated.
    expect(text).toMatch(/No ambient or looping motion/);
    expect(text).toMatch(/No overshoot or bounce on content/);
    expect(text).toMatch(/reference text only/);
  });

  it('is credited in the guide', () => {
    const text = read(path.join(ROOT, 'GUIDE.md')).replace(/\s+/g, ' ');
    expect(text).toMatch(/\*\*Motion Design Skills\*\* by iart\.ai/);
    expect(text).toMatch(/copyright \(c\) 2026 iart\.ai, used under the MIT licence/);
    expect(text).toContain('plugin/skills/learning-tool/references/third-party/motion-design-skills/');
    expect(read(path.join(VENDORED, 'LICENSE'))).toContain('Copyright (c) 2026 iart.ai');
  });

  it('adds no skill to the plugin: a loader finds skills one level down, and these lie deeper', () => {
    const skillsDir = path.join(PLUGIN_DIR, 'skills');
    const found = readdirSync(skillsDir).filter((name) => existsSync(path.join(skillsDir, name, 'SKILL.md')));
    expect(found).toEqual(['learning-tool']);
  });

  it('stays out of the guide the server serves, which reads only the top level of references', () => {
    const top = readdirSync(REF_DIR).filter((name) => name.endsWith('.md'));
    expect(top.some((name) => name.toLowerCase().includes('skill'))).toBe(false);
    expect(read(path.join(ROOT, 'scripts/build.mjs'))).toContain("(await readdir(refDir)).filter((n) => n.endsWith('.md'))");
  });
});
