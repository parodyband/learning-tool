// The design tokens are a promise to everything drawn with them: text tokens are readable on every
// surface, and tokens that draw meaningful lines are visible. axe cannot see inside an SVG overlay
// or a forced state, so the promise is checked here, on the numbers, for light and dark and for
// the higher-contrast set.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(import.meta.dirname, '../../src/player/css/tokens.css'), 'utf8');

type Scheme = 'light' | 'dark';

/** Tokens declared as light-dark(#aaa, #bbb) in one rule block. */
function tokens(block: string): Map<string, { light: string; dark: string }> {
  const out = new Map<string, { light: string; dark: string }>();
  for (const m of block.matchAll(/(--lt-[a-z0-9-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/g)) out.set(m[1] as string, { light: m[2] as string, dark: m[3] as string });
  return out;
}

const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf(':root[data-theme="light"]'));
const contrastBlock = css.slice(css.indexOf('@media (prefers-contrast: more)'), css.indexOf('@media (forced-colors: active)'));
const base = tokens(rootBlock);
const more = new Map([...base, ...tokens(contrastBlock)]);

function luminance(hex: string): number {
  const channel = (i: number): number => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['--lt-bg', '--lt-surface', '--lt-sunken'];
const TEXT = ['--lt-ink', '--lt-ink-2', '--lt-ink-3', '--lt-accent', '--lt-good', '--lt-bad', '--lt-warn'];
const LINES = ['--lt-line-strong', '--lt-accent', '--lt-ink-3'];
/** Text set on a tint of its own colour, and on the tints used behind highlighted or chosen things. */
const ON_TINT: [string, string][] = [
  ['--lt-ink', '--lt-accent-soft'],
  ['--lt-ink-2', '--lt-accent-soft'],
  ['--lt-accent', '--lt-accent-soft'],
  ['--lt-ink', '--lt-good-soft'],
  ['--lt-good', '--lt-good-soft'],
  ['--lt-ink', '--lt-bad-soft'],
  ['--lt-bad', '--lt-bad-soft'],
  ['--lt-ink', '--lt-warn-soft'],
  ['--lt-warn', '--lt-warn-soft'],
  ['--lt-ink', '--lt-mark'],
  ['--lt-accent-ink', '--lt-accent'],
];

describe.each([
  ['default', base],
  ['prefers-contrast: more', more],
] as const)('tokens (%s)', (_name, set) => {
  const get = (name: string, scheme: Scheme): string => {
    const t = set.get(name);
    expect(t, name).toBeDefined();
    return (t as { light: string; dark: string })[scheme];
  };

  describe.each(['light', 'dark'] as Scheme[])('%s', (scheme) => {
    it.each(TEXT.flatMap((t) => SURFACES.map((s) => [t, s] as const)))('%s is readable on %s (4.5:1)', (text, surface) => {
      expect(contrast(get(text, scheme), get(surface, scheme))).toBeGreaterThanOrEqual(4.5);
    });
    it.each(ON_TINT)('%s is readable on %s (4.5:1)', (text, tint) => {
      expect(contrast(get(text, scheme), get(tint, scheme))).toBeGreaterThanOrEqual(4.5);
    });
    it.each(LINES.flatMap((l) => SURFACES.map((s) => [l, s] as const)))('%s is a visible line on %s (3:1)', (line, surface) => {
      expect(contrast(get(line, scheme), get(surface, scheme))).toBeGreaterThanOrEqual(3);
    });
    it('keeps the hairline quieter than the line that carries meaning', () => {
      expect(contrast(get('--lt-line', scheme), get('--lt-bg', scheme))).toBeLessThan(contrast(get('--lt-line-strong', scheme), get('--lt-bg', scheme)));
    });
  });
});

describe('theme plumbing', () => {
  it('follows the system by default and lets one attribute override it', () => {
    expect(rootBlock).toMatch(/color-scheme:\s*light dark;/);
    expect(css).toMatch(/:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;\s*\}/);
    expect(css).toMatch(/:root\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;\s*\}/);
  });
  it('declares every colour as a light and dark pair', () => {
    const colourLines = rootBlock.split('\n').filter((l) => /#[0-9a-f]{3,8}\b/i.test(l));
    for (const line of colourLines) expect(line, line.trim()).toMatch(/light-dark\(/);
    expect(base.size).toBeGreaterThanOrEqual(18);
  });
  it('maps every colour token to a system colour in forced colours', () => {
    const forced = css.slice(css.indexOf('@media (forced-colors: active)'));
    for (const name of base.keys()) expect(forced, name).toContain(`${name}:`);
  });
});
