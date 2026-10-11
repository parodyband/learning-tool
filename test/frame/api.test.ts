// The author's reference for the custom frame cannot drift from the code: the table of members is
// held equal to what the runtime puts on S, and the reference file is held equal to what is
// generated from that table, the limits and the worked example.
//
//   UPDATE_FRAME_API=1 npx vitest run test/frame/api.test.ts     rewrites the reference
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ClipScene } from '../../src/core/clip';
import { FrameParam } from '../../src/core/frame';
import { FRAME_EXAMPLE_PROJECTILE } from '../../src/core/frame-examples';
import { checkFrameCode } from '../../src/frame/check';
import { EASE_NAMES, FRAME_API, KEPT_GLOBALS, SPRING_PRESETS, THEME_ROLES } from '../../src/player/frame/api';
import { frameHelpers, frameWorker } from '../../src/player/frame/runtime';
import { THEME_TOKENS } from '../../src/player/frame/shared';
import { frameApiMarkdown } from './api-doc';

const DOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../plugin/skills/learning-tool/references/frame-api.md');
const members = FRAME_API.flatMap((g) => g.members);

describe('the table of members', () => {
  const { S } = frameHelpers();

  it('lists exactly what the runtime puts on S', () => {
    expect(members.map((m) => m.name).sort()).toEqual(Object.keys(S).map((k) => `S.${k}`).sort());
    expect(new Set(members.map((m) => m.name)).size).toBe(members.length);
  });

  it('says of each member whether it is a function, and shows how it is called', () => {
    for (const m of members) {
      const value = S[m.name.slice(2)];
      const callable = m.signature.startsWith(`${m.name}(`);
      expect(typeof value === 'function', m.name).toBe(callable);
      expect(m.does.length, m.name).toBeGreaterThan(15);
      expect(m.does, m.name).not.toContain('\n');
      expect(m.example, m.name).toContain(m.name);
    }
  });

  it('gives examples that are valid code a frame may contain', () => {
    for (const m of members) {
      // Each example is a statement or two inside render. The check wants a render around it.
      const issues = checkFrameCode(`function render(ctx, t) {\n${m.example}\n}`);
      expect(issues.filter((i) => i.severity === 'error'), `${m.name}: ${m.example}`).toEqual([]);
    }
  });

  it('names every easing curve and every spring preset the runtime has', () => {
    expect(Object.keys(S.ease)).toEqual([...EASE_NAMES]);
    // A preset has its own shape: the four differ from each other and from the default.
    const at = (preset?: string): number => S.spring(0.08, preset);
    const values = [...SPRING_PRESETS.map((p) => at(p)), at()];
    expect(new Set(values.map((v) => v.toFixed(6))).size).toBe(values.length);
    // Every preset the runtime knows is documented (the table lives inside the function, so it is read from its text).
    const inText = /SPRINGS\s*=\s*\{([^}]*)\}/.exec(frameHelpers.toString())?.[1] ?? '';
    expect([...inText.matchAll(/([a-z]+)\s*:/g)].map((m) => m[1])).toEqual([...SPRING_PRESETS]);
  });

  it('names every colour role the page gives a frame', () => {
    expect(THEME_ROLES.map(([name]) => name)).toEqual([...Object.keys(THEME_TOKENS), 'scheme']);
  });

  it('lists as kept only globals the lockdown keeps', () => {
    const keep = /KEEP\s*=\s*\(?([\s\S]*?)\)?\.split\(/.exec(frameWorker.toString())?.[1] ?? '';
    const kept = new Set([...keep.matchAll(/[A-Za-z0-9]+/g)].map((m) => m[0]));
    expect(kept.has('Object') && kept.has('OffscreenCanvas')).toBe(true);
    const named = [...KEPT_GLOBALS.matchAll(/\b([A-Z][A-Za-z0-9]+|parseInt|parseFloat|isFinite|isNaN)\b/g)].map((m) => m[1] as string).filter((n) => !['Error', 'JavaScript'].includes(n));
    expect(named.length).toBeGreaterThan(20);
    for (const name of named) expect(kept.has(name), name).toBe(true);
    for (const gone of ['fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'importScripts', 'setTimeout', 'navigator', 'self', 'console', 'caches', 'indexedDB', 'postMessage', 'crypto', 'performance']) expect(kept.has(gone), gone).toBe(false);
    // The budget the reference states.
    expect(frameWorker.toString()).toMatch(/256 \* 1048576/);
  });
});

describe('frame-api.md', () => {
  const generated = frameApiMarkdown();

  it('is what the generator writes', () => {
    if (process.env.UPDATE_FRAME_API === '1') writeFileSync(DOC, generated);
    expect(existsSync(DOC), 'run UPDATE_FRAME_API=1 npx vitest run test/frame/api.test.ts').toBe(true);
    expect(readFileSync(DOC, 'utf8'), 'out of date: run UPDATE_FRAME_API=1 npx vitest run test/frame/api.test.ts').toBe(generated);
  });

  it('documents every member of S, every colour role, every easing and every preset', () => {
    for (const m of members) expect(generated, m.name).toContain(`\`${m.signature.startsWith('S.') ? m.signature.replace(/\|/g, '\\|') : m.name}\``);
    for (const [role] of THEME_ROLES) expect(generated).toContain(`| \`${role}\` |`);
    for (const name of EASE_NAMES) expect(generated).toContain(`\`${name}\``);
    for (const name of SPRING_PRESETS) expect(generated).toContain(`'${name}'`);
  });

  it('carries the worked example whole, and it is the example the tests run', () => {
    expect(generated).toContain(FRAME_EXAMPLE_PROJECTILE.stage.code.trimEnd());
    expect(generated).toContain('"kind": "frame"');
    expect(generated).toContain('"at": 2');
    for (const b of FRAME_EXAMPLE_PROJECTILE.beats) expect(generated).toContain(b.caption);
  });

  it('shows a slider and a clip that are what the schemas accept', () => {
    // The skill's own tests check every ```json block against the lesson schemas they know. These
    // two are a slider and a clip scene, which those do not cover, so they are checked here.
    const plain = [...generated.matchAll(/```\n([{][\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1] as string) as Record<string, unknown>);
    expect(plain).toHaveLength(2);
    const [slider, clip] = plain as [Record<string, unknown>, { stage: { code: string } }];
    expect(FrameParam.parse(slider)).toEqual(FRAME_EXAMPLE_PROJECTILE.stage.params[0]);
    expect(clip.stage.code.split('\n')[0]).toBe(FRAME_EXAMPLE_PROJECTILE.stage.code.split('\n')[0]);
    clip.stage.code = FRAME_EXAMPLE_PROJECTILE.stage.code;
    const parsed = ClipScene.safeParse(clip);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(parsed.data?.stage).toEqual(FRAME_EXAMPLE_PROJECTILE.stage);
  });

  it('keeps to the rules every skill file keeps to', () => {
    // No placeholder a loader would substitute, small enough to be returned whole, no code a catalog does not have.
    expect(generated).not.toContain('${');
    expect(generated.length).toBeLessThan(40_000);
    expect([...generated.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)].map((m) => m[1])).toEqual([]);
    expect(generated).not.toMatch(/\]\((?!#)[^)]*\)/);
  });

  it('has fenced code that parses: the contract example passes the static checks', () => {
    const blocks = [...generated.matchAll(/```js\n([\s\S]*?)\n```/g)].map((m) => m[1] as string);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) expect(checkFrameCode(block).filter((i) => i.severity === 'error')).toEqual([]);
    expect(generated, 'a json fence in a skill file must carry a marker the skill tests know; these two are held by this file instead').not.toContain('```json');
    // And nothing in the page is only almost JavaScript.
    expect(() => new vm.Script(`(function(S){${blocks[0]}})`)).not.toThrow();
  });
});
