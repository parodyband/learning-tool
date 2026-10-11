// The stage's own colours (css/stage-tokens.css) are a promise like the shell's (test/render/
// tokens.test.ts): text on the stage is readable on every part of the field and on every fill, and
// lines that carry meaning are visible. axe cannot measure text over a gradient, so the promise is
// held here, on the numbers, for both page themes and for paper.
//
// Inside the stage the shell's tokens resolve to their DARK values in both themes (the band sets
// color-scheme: dark), so those are the values read from tokens.css here; paper uses the light ones.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(import.meta.dirname, '../../src/player/css');
const shell = readFileSync(path.join(dir, 'tokens.css'), 'utf8');
const stage = readFileSync(path.join(dir, 'stage-tokens.css'), 'utf8');

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as RGB;
function luminance([r, g, b]: RGB): number {
  const c = (v: number): number => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** `top` at `alpha` over `under`. */
const over = (top: RGB, alpha: number, under: RGB): RGB => top.map((v, i) => Math.round(v * alpha + (under[i] as number) * (1 - alpha))) as RGB;

/** A shell token's light or dark value. */
function shellToken(name: string, scheme: 'light' | 'dark'): RGB {
  const m = new RegExp(`${name}:\\s*light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`).exec(shell);
  if (!m) throw new Error(`no shell token ${name}`);
  return hex((scheme === 'light' ? m[1] : m[2]) as string);
}
/** The declarations of one rule block of the stage tokens. */
function block(start: string): Map<string, string> {
  const at = stage.indexOf(start);
  if (at < 0) throw new Error(`no block ${start}`);
  const body = stage.slice(stage.indexOf('{', at + start.length - 1) + 1, stage.indexOf('}', at));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out.set(m[1] as string, (m[2] as string).trim());
  return out;
}
const base = block(':root {');
const dark = new Map([...base, ...block(':root[data-theme="dark"] {')]);
const paper = new Map([...base, ...block('.st-paper {')]);

function solid(set: Map<string, string>, name: string): RGB {
  const v = set.get(name);
  if (!v || !/^#[0-9a-f]{6}$/.test(v)) throw new Error(`${name} is not a solid colour: ${v}`);
  return hex(v);
}
/** A token that is white or the shade at some alpha, laid over a background. */
function laid(set: Map<string, string>, name: string, under: RGB): RGB {
  const v = set.get(name) ?? '';
  if (/^#[0-9a-f]{6}$/.test(v)) return hex(v);
  if (v === 'transparent') return under;
  const m = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(v);
  if (!m) throw new Error(`cannot read ${name}: ${v}`);
  return over([Number(m[1]), Number(m[2]), Number(m[3])], Number(m[4]), under);
}

describe('stage tokens', () => {
  it('declares every colour as a value this test can read', () => {
    for (const [name, value] of base) {
      if (name === '--st-shadow') continue;
      expect(value, name).toMatch(/^(#[0-9a-f]{6}|rgb\(\d+ \d+ \d+ \/ [\d.]+\)|transparent)$/);
    }
    // The dark theme and paper redefine tokens that exist; neither invents one.
    for (const set of [block(':root[data-theme="dark"] {'), block('.st-paper {')]) for (const name of set.keys()) if (name.startsWith('--st-')) expect(base.has(name), name).toBe(true);
    // The system-dark block and the chosen-dark block say the same thing.
    const system = stage.slice(stage.indexOf('@media (prefers-color-scheme: dark)'), stage.indexOf(':root[data-theme="dark"]'));
    for (const [name, value] of block(':root[data-theme="dark"] {')) expect(system, name).toContain(`${name}: ${value};`);
  });

  for (const [theme, set] of [['beside paper', base], ['beside the dark page', dark]] as const) {
    describe(`on the field, ${theme}`, () => {
      const fields = ['--st-field', '--st-field-lit', '--st-field-deep', '--st-surface'].map((n) => [n, solid(set, n)] as const);
      const ink = (name: string): RGB => (name.startsWith('--st-') ? solid(set, name) : shellToken(name, 'dark'));

      it('text reaches 4.5:1 on every part of the field, and on a pane and a well laid over it', () => {
        for (const text of ['--lt-ink', '--lt-ink-2', '--st-ink-quiet', '--lt-accent', '--lt-good', '--lt-bad', '--lt-warn']) {
          for (const [fname, field] of fields) {
            expect(contrast(ink(text), field), `${text} on ${fname}`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(ink(text), laid(set, '--st-well', field)), `${text} on a well over ${fname}`).toBeGreaterThanOrEqual(4.5);
          }
        }
        // On a pane (a part's own surface) text is always the primary ink.
        for (const [fname, field] of fields) {
          for (const pane of ['--st-pane', '--st-pane-strong', '--st-wash']) expect(contrast(ink('--lt-ink'), laid(set, pane, field)), `ink on ${pane} over ${fname}`).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('text on a solid tone reaches 4.5:1', () => {
        for (const fill of ['--lt-accent', '--lt-good', '--lt-bad', '--lt-warn', '--lt-ink']) expect(contrast(solid(set, '--st-on-solid'), shellToken(fill, 'dark')), `on ${fill}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(shellToken('--lt-accent-ink', 'dark'), shellToken('--lt-accent', 'dark'))).toBeGreaterThanOrEqual(4.5);
      });

      it('lines and fills that carry meaning reach 3:1 against the field', () => {
        for (const [fname, field] of fields) {
          for (const line of ['--lt-ink-2', '--lt-accent', '--lt-good', '--lt-bad', '--lt-warn', '--st-plain']) expect(contrast(ink(line), field), `${line} on ${fname}`).toBeGreaterThanOrEqual(3);
          expect(contrast(laid(set, '--st-axis', field), field), `axis on ${fname}`).toBeGreaterThanOrEqual(3);
        }
        // An ordinary dot must stand out from the field; a muted one is "set aside" and only has to be there.
        expect(contrast(solid(set, '--st-dot'), solid(set, '--st-field-lit'))).toBeGreaterThanOrEqual(3);
        expect(contrast(solid(set, '--st-dot-muted'), solid(set, '--st-field'))).toBeGreaterThanOrEqual(1.5);
        expect(contrast(solid(set, '--st-dot'), solid(set, '--st-dot-muted'))).toBeGreaterThanOrEqual(1.8);
      });

      it('keeps the field itself dark enough to be a field: the page beside it is clearly another surface', () => {
        expect(luminance(solid(set, '--st-field-lit'))).toBeLessThan(0.06);
        expect(luminance(solid(set, '--st-field'))).toBeLessThanOrEqual(luminance(solid(set, '--st-field-lit')));
        expect(luminance(solid(set, '--st-field-deep'))).toBeLessThanOrEqual(luminance(solid(set, '--st-field')));
      });
    });
  }

  describe('on paper', () => {
    const white = solid(paper, '--st-field');
    it('is ink on white', () => {
      expect(white).toEqual([255, 255, 255]);
      for (const text of ['--lt-ink', '--lt-ink-2', '--lt-ink-3', '--lt-accent', '--lt-good', '--lt-bad', '--lt-warn']) expect(contrast(shellToken(text, 'light'), white), text).toBeGreaterThanOrEqual(4.5);
      expect(contrast(solid(paper, '--st-ink-quiet'), white)).toBeGreaterThanOrEqual(4.5);
      for (const fill of ['--lt-accent', '--lt-good', '--lt-bad', '--lt-warn']) expect(contrast(solid(paper, '--st-on-solid'), shellToken(fill, 'light')), `on ${fill}`).toBeGreaterThanOrEqual(4.5);
      for (const line of ['--st-pane-line', '--st-axis', '--st-hair', '--st-plain', '--st-dot']) expect(contrast(solid(paper, line), white), line).toBeGreaterThanOrEqual(3);
    });
  });
});
