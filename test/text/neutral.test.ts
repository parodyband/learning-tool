// The text foundation is imported by the server and may be imported by the browser bundle, so it
// must not depend on Node. This test may use Node; the three source files may not.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import * as markup from '../../src/core/markup';
import * as math from '../../src/core/math';
import * as text from '../../src/core/text';

const core = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/core');
const FILES = ['text.ts', 'markup.ts', 'math.ts'];

describe('environment-neutral', () => {
  it.each(FILES.map((f) => [f]))('%s imports only its siblings', async (file) => {
    // Comments may mention Node; code may not.
    const src = (await readFile(path.join(core, file), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const imports = [...src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    const allowed: Record<string, string[]> = { 'text.ts': ['./markup'], 'markup.ts': ['./math'], 'math.ts': [] };
    expect(imports).toEqual(allowed[file]);
    expect(src).not.toMatch(/\brequire\s*\(|\bimport\s*\(|\bprocess\.|\bBuffer\b|\bglobalThis\b|\bdocument\.|\bwindow\.|['"`]node:/);
  });

  it('bundles for the browser with nothing external', async () => {
    const result = await build({
      stdin: {
        contents: `export * from './text'; export * from './markup'; export * from './math';`,
        resolveDir: core,
        loader: 'ts',
      },
      bundle: true,
      // The same targets as the player build in scripts/build.mjs.
      format: 'iife',
      platform: 'browser',
      target: ['es2020', 'safari15'],
      write: false,
      logLevel: 'silent',
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    const out = result.outputFiles[0]?.text ?? '';
    expect(out.length).toBeGreaterThan(5000);
    // A Node built-in would have failed the build above; this guards against one being shimmed in.
    expect(out).not.toMatch(/\brequire\(|['"`]node:/);
  });
});

describe('the public surface', () => {
  // Other areas call exactly these names. A rename here is a breaking change for them.
  const surface: Array<[string, Record<string, unknown>, string[]]> = [
    ['text', text, ['sanitizeText', 'sanitizeInput', 'SanitizeError', 'countWords', 'canonical', 'findQuote', 'contentTokens', 'numberTokens', 'sourceNumberTokens', 'findUrls', 'MAX_INPUT_DEPTH', 'MAX_INPUT_NODES', 'MAX_MARK_RUN', 'CLOSEST_MAX_CHARS']],
    ['markup', markup, ['parseInline', 'plainText', 'proseText', 'codeSpans', 'mathSpans', 'MARKUP_MAX_NESTING']],
    ['math', math, ['parseMath', 'mathToMathML', 'mathToText', 'MATH_COMMANDS', 'MATH_COMMAND_GROUPS', 'MATH_OPERATORS', 'MATH_HELP', 'MATH_MAX_DEPTH']],
  ];
  it.each(surface)('%s exports exactly what is documented', (_name, mod, names) => {
    expect(Object.keys(mod).sort()).toEqual([...names].sort());
  });

  it('the functions have the shapes the contract names', () => {
    expect(text.sanitizeText(' a ', 'prose')).toBe('a');
    expect(text.sanitizeInput({ a: null })).toEqual({});
    expect(text.countWords('one two', 'en')).toBe(2);
    expect(text.canonical('A—B')).toBe('a-b');
    expect(text.findQuote('one two three', 'TWO')).toEqual({ found: true, start: 4, end: 7, text: 'two' });
    expect(text.findQuote('one two three', 'tw')).toEqual({ found: false, closest: { start: 4, end: 7, text: 'two' } });
    expect(text.contentTokens('binary search', 'en')).toEqual(['binar', 'searc']);
    expect(text.numberTokens('1,000 and 3.13')).toEqual(['1000', '3.13']);
    expect(text.sourceNumberTokens('5 million on 16.10.2023')).toEqual(['5', '16.10', '2023', '5000000', '2020s', '2000s', '16', '10']);
    expect(text.findUrls('https://example.org/x')).toEqual([{ raw: 'https://example.org/x', host: 'example.org' }]);
    expect(markup.parseInline('**a**')).toEqual({ nodes: [{ t: 'strong', c: [{ t: 'text', v: 'a' }] }], errors: [] });
    expect(markup.parseInline('$\\nope$').errors[0]).toEqual({ code: 'MARKUP_MATH', message: 'Unsupported command \\nope.', at: 1, start: 0, end: 7 });
    expect(markup.plainText('**a** `b` $c^2$')).toBe('a b c^2');
    expect(markup.codeSpans('`a` and `b`')).toEqual(['a', 'b']);
    expect(math.parseMath('x')).toEqual({ ok: true, nodes: [{ t: 'id', v: 'x' }] });
    expect(math.parseMath('\\nope')).toEqual({ ok: false, message: 'Unsupported command \\nope.', at: 0 });
    expect(math.mathToMathML([{ t: 'id', v: 'x' }], false)).toBe('<math display="inline"><mrow><mi>x</mi></mrow></math>');
  });

  it('works on the example lesson without a single markup error', async () => {
    const { EXAMPLE_EVIDENCE, EXAMPLE_SCENES } = await import('../../src/core/examples');
    const strings: string[] = [];
    const walk = (v: unknown, key: string): void => {
      if (typeof v === 'string') {
        if (key !== 'lines') strings.push(v);
      } else if (Array.isArray(v)) {
        for (const x of v) walk(x, key);
      } else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) walk(x, k);
      }
    };
    walk(EXAMPLE_SCENES, '');
    expect(strings.length).toBeGreaterThan(50);
    for (const s of strings) {
      expect(markup.parseInline(s).errors, s).toEqual([]);
      // The example is already clean: sanitising changes nothing.
      expect(text.sanitizeText(s, 'prose'), s).toBe(s);
    }
    // Every quote block is found in the excerpt it cites, as the excerpt's own characters.
    const quotes: Array<{ text: string; cite: string }> = [];
    const collect = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (o.type === 'quote' && typeof o.text === 'string' && typeof o.cite === 'string') quotes.push({ text: o.text, cite: o.cite });
        Object.values(o).forEach(collect);
      }
    };
    collect(EXAMPLE_SCENES);
    expect(quotes.length).toBeGreaterThan(0);
    for (const q of quotes) {
      const excerpt = EXAMPLE_EVIDENCE[Number(q.cite.slice(1)) - 1]?.excerpt ?? '';
      const r = text.findQuote(excerpt, q.text);
      expect(r, q.text).toMatchObject({ found: true });
      if (r.found) expect(excerpt.slice(r.start, r.end)).toBe(r.text);
    }
    // Sanitising the whole example changes nothing either, including the indented code lines.
    expect(text.sanitizeInput(EXAMPLE_SCENES)).toEqual(EXAMPLE_SCENES);
  });
});
