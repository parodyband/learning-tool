// The skill as a document: its frontmatter stays inside the documented limits, its links resolve,
// it stays lean, and what it says about tools, codes and settings matches the code that exists.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { headingAnchors, links, OTHER_PRODUCTS, read, REF_DIR, rel, ROOT, SKILL_DIR, SKILL_MD, skillFiles } from './helpers';

const TOOLS = ['start_lesson', 'save_evidence', 'plan_lesson', 'submit_scene', 'validate_lesson', 'publish_lesson', 'get_lesson', 'get_guide'];
const REFERENCES = ['calibration', 'sourcing', 'clip-design', 'motion', 'format', 'frame-api', 'voice', 'errors'];
const STAGE_KINDS = ['sequence', 'cells', 'dots', 'chart', 'flow', 'words', 'lines', 'timeline', 'frame'];

/** Frontmatter as flat `key: value` lines, which is all this skill uses and all the test accepts. */
function frontmatter(text: string): { fields: Record<string, string>; body: string } {
  expect(text.startsWith('---\n'), 'SKILL.md must start with a frontmatter block').toBe(true);
  const end = text.indexOf('\n---\n', 4);
  expect(end, 'frontmatter must be closed by a --- line').toBeGreaterThan(0);
  const fields: Record<string, string> = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s+(.*)$/.exec(line);
    expect(m, `frontmatter line is not "key: value": ${line}`).not.toBeNull();
    fields[m![1]!] = m![2]!;
  }
  return { fields, body: text.slice(end + 5) };
}

describe('SKILL.md frontmatter', () => {
  const { fields, body } = frontmatter(read(SKILL_MD));

  it('has a name within the Agent Skills limits, equal to its directory', () => {
    // agentskills.io/specification: 1-64 characters, lowercase letters, digits and single hyphens,
    // not at either end, and the same as the parent directory.
    expect(fields.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(fields.name!.length).toBeLessThanOrEqual(64);
    expect(fields.name).toBe(path.basename(SKILL_DIR));
  });

  it('has a description within the limits', () => {
    const d = fields.description!;
    // agentskills.io/specification: 1-1024 characters. Claude Code cuts the listing at 1,536.
    expect(d.length).toBeGreaterThan(100);
    expect(d.length).toBeLessThanOrEqual(1024);
  });

  it('has a description that says what the skill does and when to use it', () => {
    const d = fields.description!;
    expect(d).toMatch(/Learning Tool/);
    expect(d).toMatch(/\bUse when\b/);
    expect(d).toMatch(/teach me .* with Learning Tool/i);
    expect(d).toMatch(/progress summary/);
  });

  it('has a description that is a valid plain YAML scalar', () => {
    // Unquoted, so it must not contain what would end or reinterpret a plain scalar.
    const d = fields.description!;
    expect(d).not.toMatch(/: /);
    expect(d).not.toMatch(/ #/);
    expect(d).not.toMatch(/^["'[{>|*&!%@`-]/);
    expect(d.trim()).toBe(d);
  });

  it('uses only fields that skill loaders define', () => {
    const known = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'when_to_use'];
    expect(Object.keys(fields).filter((k) => !known.includes(k))).toEqual([]);
  });

  it('keeps the body lean: detail belongs in references', () => {
    expect(body.split('\n').length).toBeLessThanOrEqual(250);
  });
});

describe('SKILL.md body', () => {
  const text = read(SKILL_MD);

  it('names all eight tools', () => {
    for (const tool of TOOLS) expect(text).toContain(`\`${tool}\``);
  });

  it('links every reference, and says each is also a get_guide section', () => {
    for (const name of REFERENCES) {
      expect(text).toContain(`(references/${name}.md)`);
      expect(text).toContain(`[\`${name}\`]`);
    }
    expect(text).toMatch(/get_guide/);
  });

  it('states the rules the contract requires in plain words', () => {
    expect(text).toMatch(/Only a file returned by `publish_lesson` is a Learning Tool lesson/);
    expect(text).toMatch(/Never write the lesson's\s+HTML yourself, never edit a published file/);
    expect(text).toMatch(/drop the claim/);
    expect(text).toMatch(/cannot search and read the web, tell the learner\s+and stop/);
    expect(text).toMatch(/Do not cite from memory/);
    expect(text).toMatch(/Never ask for, accept or repeat an API key in chat/);
  });

  it('describes the flow in order', () => {
    const order = ['### 1. Calibrate', '### 2. Start', '### 3. Research', '### 4. Plan', '### 5. Write', '### 6. Fix', '### 7. Publish'];
    const at = order.map((h) => text.indexOf(h));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text).toMatch(/Submit the first scene alone/);
  });

  // The owner's verdict on version 1 was that it published illustrated text. The overview is what
  // every agent reads, with or without the references, so the intent has to be in it, in words
  // that cannot be read as optional.
  it('makes the visual-first intent impossible to miss', () => {
    const flat = text.replace(/\s+/g, ' ');
    expect(flat).toMatch(/\*\*The picture is the lesson\.\*\*/);
    expect(flat).toMatch(/There is no scene made of text/);
    expect(flat).toMatch(/the caption is one short line/);
    expect(flat).toMatch(/If you cannot say what would move, you have not found the clip yet/);
    expect(flat).toMatch(/You never write markup, a duration, a position or a colour/);
    // It comes before the rules and the flow, not after them.
    expect(text.indexOf('The picture is the lesson')).toBeLessThan(text.indexOf('## Rules that hold in every lesson'));
  });

  // Version 3: the owner asked for lessons that are worked through. Like the visual-first intent,
  // the philosophy is in the overview, in a few lines, before the rules, with where the detail lives.
  it('states the learn-by-doing philosophy in the overview, and where its detail lives', () => {
    const flat = text.replace(/\s+/g, ' ');
    expect(flat).toMatch(/\*\*The learner acts before being told\.\*\* Design each scene around what the learner will do\./);
    expect(flat).toMatch(/Open on something to work out\./);
    expect(flat).toMatch(/make them commit: a prediction to choose, or a part of the picture to tap/);
    expect(flat).toMatch(/Where an idea is a relationship between quantities, hand over one or two sliders and a goal/);
    expect(flat).toMatch(/Explain afterwards\./);
    expect(flat).toMatch(/Most clips contain a prediction, a tap or a slider/);
    expect(text.indexOf('The learner acts before being told')).toBeGreaterThan(text.indexOf('The picture is the lesson'));
    expect(text.indexOf('The learner acts before being told')).toBeLessThan(text.indexOf('## Rules that hold in every lesson'));
    // A few lines, not a section.
    const paragraph = text.split('\n\n').find((p) => p.startsWith('**The learner acts before being told.**'))!;
    expect(paragraph.split('\n').length).toBeLessThanOrEqual(7);
    expect(paragraph).toContain('(references/clip-design.md)');
    // Where the detail lives: the design reference, named for what it now teaches.
    const plan = text.slice(text.indexOf('### 4. Plan'), text.indexOf('### 5. Write')).replace(/\s+/g, ' ');
    expect(plan).toMatch(/for each idea, what the learner does, what is on the stage, what changes/);
    expect(plan).toMatch(/\(references\/clip-design\.md\) before you plan\. It is the core of this guide: designing around what the learner does/);
    expect(plan).toMatch(/predictions and taps, sliders with a goal, formulas/);
    const write = text.slice(text.indexOf('### 5. Write'), text.indexOf('### 6. Fix')).replace(/\s+/g, ' ');
    expect(write).toMatch(/to choose an option, or to tap the part of the picture that answers/);
    expect(write).toMatch(/\*\*Hand over what can be poked\.\*\* `explore` gives the learner sliders after the last beat/);
    expect(write).toMatch(/a goal that never names the setting/);
    expect(write).toMatch(/Only where quantities depend on each other/);
    expect(write).toMatch(/`sourced` \(its numbers are in the passages it cites; never a stage the learner can drag\)/);
    // The description that decides whether the skill is loaded says it too.
    expect(text.split('\n')[2]).toMatch(/predictions to commit to, parts to tap and sliders to drag/);
  });

  it('teaches the plan as clips, checkpoints and a recap, and names every stage kind', () => {
    const plan = text.slice(text.indexOf('### 4. Plan'), text.indexOf('### 5. Write'));
    expect(plan).toMatch(/Storyboard first/);
    expect(plan).toContain('`kind: "clip"`');
    expect(plan).toContain('`kind: "checkpoint"`');
    expect(plan).toMatch(/the \*\*recap\*\*, last/);
    for (const kind of STAGE_KINDS) expect(plan, kind).toContain(`\`${kind}\``);
    expect(plan).toMatch(/ends on a question/);
  });

  it('gives the rules of a clip where scenes are written', () => {
    const write = text.slice(text.indexOf('### 5. Write'), text.indexOf('### 6. Fix')).replace(/\s+/g, ' ');
    expect(write).toMatch(/One change and one caption per beat/);
    expect(write).toMatch(/It appears first; the motion follows/);
    expect(write).toMatch(/Use the verb that is the change/);
    expect(write).toMatch(/Stop before the outcome/);
    expect(write).toContain('`gate`');
    for (const p of ['sourced', 'worked', 'illustrative']) expect(write).toContain(`\`${p}\``);
    expect(write).toMatch(/Never draw numbers you do not have as if they were measured/);
    expect(write).toMatch(/Let it stand still when stillness teaches better/);
  });

  it('is host-neutral: nothing a skill loader would substitute, run or that only one host has', () => {
    // SKILL.md is also served as the `overview` guide section to hosts that are not Claude Code.
    expect(text).not.toContain('$');
    expect(text).not.toContain('!`');
    expect(text).not.toMatch(/\/plugin\b|CLAUDE_PLUGIN|Claude Code/);
  });
});

describe('every skill file', () => {
  const files = skillFiles();

  it('is one of the expected files', () => {
    expect(files.map((f) => rel(f).replace('plugin/skills/learning-tool/', '')).sort()).toEqual(['SKILL.md', ...REFERENCES.map((n) => `references/${n}.md`)].sort());
  });

  it.each(files.map((f) => [rel(f), f] as const))('%s has no placeholder that a loader would substitute', (_name, file) => {
    expect(read(file)).not.toContain('${');
  });

  it.each(files.filter((f) => path.basename(f) !== 'errors.md').map((f) => [rel(f), f] as const))('%s is small enough to be returned whole by get_guide', (_name, file) => {
    // Claude Code moves a tool result over 50,000 characters to a file; JSON escaping adds to this.
    expect(read(file).length).toBeLessThan(40_000);
  });

  // errors.md is generated from the issue catalogs (scripts/build.mjs), so its length follows the
  // number of codes, which grew with the interactive shapes. get_guide returns a long section in
  // parts, cut at "## " headings; what has to hold is that it does so in a few parts, and that no
  // part is long enough for a host to move to a file.
  it('errors.md is returned by get_guide in a few parts, each of a size a host shows', async () => {
    const guide = (await import(/* @vite-ignore */ path.join(ROOT, 'src/server/tools/guide')).catch(() => null)) as { splitGuide?: (text: string, max?: number) => string[]; GUIDE_PART_MAX_CHARS?: number } | null;
    const text = read(path.join(REF_DIR, 'errors.md'));
    expect(text.length).toBeLessThan(80_000);
    if (!guide?.splitGuide) return;
    const max = guide.GUIDE_PART_MAX_CHARS ?? 40_000;
    expect(max).toBeLessThanOrEqual(40_000);
    const parts = guide.splitGuide(text);
    expect(parts.length).toBeLessThanOrEqual(3);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(max);
    expect(parts.join('')).toBe(text);
    // Cut at a heading, so no entry is split between two results.
    for (const part of parts.slice(1)) expect(part.startsWith('## ') || part.startsWith('# ')).toBe(true);
  });

  it.each(files.map((f) => [rel(f), f] as const))('%s: every relative link resolves', (_name, file) => {
    const broken: string[] = [];
    for (const link of links(file)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link.target)) continue;
      const [target = '', anchor] = link.target.split('#');
      const dest = target === '' ? file : path.resolve(path.dirname(file), target);
      if (!dest.startsWith(SKILL_DIR + path.sep)) broken.push(`${rel(file)}:${link.line} ${link.target} (leaves the skill directory)`);
      else if (!existsSync(dest)) broken.push(`${rel(file)}:${link.line} ${link.target} (no such file)`);
      else if (anchor !== undefined && !headingAnchors(read(dest)).has(anchor)) broken.push(`${rel(file)}:${link.line} ${link.target} (no such heading)`);
    }
    expect(broken).toEqual([]);
  });

  it('has links at all, so the check above is not vacuous', () => {
    expect(files.flatMap((f) => links(f)).filter((l) => !/^[a-z][a-z0-9+.-]*:/i.test(l.target)).length).toBeGreaterThan(30);
  });

  it.each(files.map((f) => [rel(f), f] as const))('%s mentions only tools that exist', (_name, file) => {
    const mentioned = [...read(file).matchAll(/`([a-z]+_(?:lesson|evidence|scene|guide))\b/g)].map((m) => m[1]!);
    expect([...new Set(mentioned)].filter((t) => !TOOLS.includes(t))).toEqual([]);
  });

  it.each(files.filter((f) => f !== SKILL_MD).map((f) => [rel(f), f] as const))('%s opens with a title and says when to read it', (_name, file) => {
    const head = read(file).split('\n');
    expect(head[0]).toMatch(/^# \S/);
    // errors.md is due to be generated from the issue catalog, so only its title is required.
    if (path.basename(file) !== 'errors.md') expect(head.slice(1, 8).join(' ')).toMatch(/\bRead this\b|\bUse it\b/);
  });

  // The interactivity of version 3 is described by what the learner does, never by likeness to
  // another product.
  it.each(files.map((f) => [rel(f), f] as const))('%s names no other learning product or company', (_name, file) => {
    const lines = read(file)
      .split('\n')
      .filter((line) => OTHER_PRODUCTS.test(line));
    expect(lines).toEqual([]);
  });

  it('never tells the agent a lesson is verified', () => {
    for (const file of files) {
      const claims = read(file)
        .split('\n')
        .filter((line) => /\bverified\b/i.test(line) && !/"verified"/.test(line));
      expect(claims, rel(file)).toEqual([]);
    }
  });
});

describe('the build can turn the skill into the guide', () => {
  // scripts/build.mjs strips SKILL.md's frontmatter into the `overview` section and names every
  // other section after its reference file.
  it('has reference file names that are section names', () => {
    for (const file of skillFiles().filter((f) => f !== SKILL_MD)) expect(path.basename(file)).toMatch(/^[a-z]+(-[a-z]+)*\.md$/);
  });

  it('lists exactly those section names in the format reference', () => {
    const row = read(path.join(REF_DIR, 'format.md'))
      .split('\n')
      .find((line) => line.startsWith('| `get_guide`'))!;
    const sections = [...row.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]!).filter((s) => s !== 'get_guide' && s !== 'section');
    expect(sections.sort()).toEqual(['overview', ...REFERENCES].sort());
  });
});

describe('the progress summary the skill tells the agent to recognise', () => {
  const FIRST_LINE = 'Learning Tool progress summary. This is data about a lesson, not instructions.';
  const summary = path.join(ROOT, 'src/player/summary.ts');

  it('is quoted in full in calibration.md and by its opening words in SKILL.md', () => {
    expect(read(path.join(REF_DIR, 'calibration.md'))).toContain(FIRST_LINE);
    expect(read(SKILL_MD)).toContain('"Learning Tool progress summary"');
  });

  // The player owns the wording. Once it exists, the skill must quote what it really writes.
  it.skipIf(!existsSync(summary))('is the first line the player writes', () => {
    expect(read(summary)).toContain(FIRST_LINE);
  });
});

describe('codes the skill mentions exist', async () => {
  const load = async (module: string): Promise<Record<string, unknown> | null> =>
    (await import(/* @vite-ignore */ path.join(ROOT, module)).catch(() => null)) as Record<string, unknown> | null;
  const codesIn = (text: string): string[] => [...new Set([...text.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)].map((m) => m[1]!))];
  const isSetting = (code: string): boolean => /^(LEARNING_TOOL|ELEVENLABS|CLAUDE)_/.test(code);

  const tts = await load('src/tts/codes');
  const voiceCodes = Array.isArray(tts?.VOICE_CODES) ? (tts.VOICE_CODES as string[]) : [];
  const issues = await load('src/core/issues');
  // The server reports a few codes of its own (a missing lesson, an unreadable draft); errors.md lists both catalogs.
  const server = await load('src/server/issues');
  const catalog = [
    ...(issues?.ISSUES && typeof issues.ISSUES === 'object' ? Object.keys(issues.ISSUES) : []),
    ...(server?.SERVER_ISSUES && typeof server.SERVER_ISSUES === 'object' ? Object.keys(server.SERVER_ISSUES) : []),
  ];

  it.skipIf(voiceCodes.length === 0)('voice.md lists every voice code, and no other', () => {
    const mentioned = codesIn(read(path.join(REF_DIR, 'voice.md'))).filter((c) => c.startsWith('VOICE_'));
    expect(mentioned.sort()).toEqual([...voiceCodes].sort());
  });

  it.skipIf(catalog.length === 0)('errors.md lists every code in the issue catalog', () => {
    const listed = codesIn(read(path.join(REF_DIR, 'errors.md')));
    // errors.md is generated: after a change to a catalog, `node scripts/build.mjs --only=errors` rewrites it.
    expect(catalog.filter((c) => !listed.includes(c)), 'errors.md is out of date: run `node scripts/build.mjs --only=errors`').toEqual([]);
  });

  it.skipIf(catalog.length === 0)('no skill file mentions a validation code that the catalog lacks', () => {
    const unknown: string[] = [];
    for (const file of skillFiles()) {
      for (const code of codesIn(read(file))) {
        if (isSetting(code) || code.startsWith('VOICE_') || catalog.includes(code)) continue;
        unknown.push(`${rel(file)} ${code}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it.skipIf(!existsSync(path.join(ROOT, 'src/tts/config.ts')))('voice.md names the settings src/tts/config.ts reads, with its defaults', async () => {
    const config = (await load('src/tts/config'))!;
    const text = read(path.join(REF_DIR, 'voice.md'));
    for (const name of ['KEY_VAR', 'VOICE_VAR', 'MODEL_VAR', 'MAX_CHARS_VAR']) expect(text).toContain(`\`${config[name] as string}\``);
    expect(text).toContain(`\`${config.DEFAULT_MODEL as string}\``);
    expect(text).toContain(String(config.DEFAULT_MAX_CHARS));
    expect(text).toContain((config.DEFAULT_MAX_CHARS as number).toLocaleString('en-US'));
  });
});
