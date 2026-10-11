// Canonical JSON and the lesson hash: one text, and so one hash, for one lesson.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, hashLesson, sha256Hex, utf8 } from '../../src/core/hash';
import { exampleLesson } from '../helpers/example';

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/core');
const reference = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('canonicalJson', () => {
  it('sorts keys, drops white space and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: [3, 1, 2], c: { z: null, y: 'x' } })).toBe('{"a":[3,1,2],"b":1,"c":{"y":"x","z":null}}');
  });

  it('does not depend on the order in which keys were set', () => {
    const one = { id: 's1', kind: 'narration', title: 'T', blocks: [{ type: 'claim', text: 'A.', cites: ['e1'] }] };
    const two = { blocks: [{ cites: ['e1'], text: 'A.', type: 'claim' }], title: 'T', kind: 'narration', id: 's1' };
    expect(canonicalJson(one)).toBe(canonicalJson(two));
  });

  it('sorts keys by code unit, not by locale', () => {
    expect(canonicalJson({ ä: 1, z: 2, a: 3, Z: 4, _: 5, 10: 6, 9: 7 })).toBe('{"10":6,"9":7,"Z":4,"_":5,"a":3,"z":2,"ä":1}');
  });

  it('treats an absent field and one set to undefined alike, and null as a value', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(canonicalJson([1, undefined, 3])).toBe('[1,null,3]');
  });

  it('writes numbers and strings as JSON does', () => {
    expect(canonicalJson([0, -0, 1.5, 1e21, 0.1 + 0.2, -3])).toBe('[0,0,1.5,1e+21,0.30000000000000004,-3]');
    expect(canonicalJson('a "quoted" \\ line\nbreak \u2028 é 😀 \u0001')).toBe(JSON.stringify('a "quoted" \\ line\nbreak \u2028 é 😀 \u0001'));
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(null)).toBe('null');
  });

  it('round-trips: parsing the text gives back an equal value with the same text', () => {
    const lesson = exampleLesson();
    const text = canonicalJson(lesson);
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(lesson)));
    expect(canonicalJson(JSON.parse(text))).toBe(text);
    expect(text).not.toMatch(/[\n\t]/);
  });

  it('refuses what JSON cannot hold', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalJson([Number.POSITIVE_INFINITY])).toThrow(TypeError);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(TypeError);
    expect(() => canonicalJson(10n)).toThrow(TypeError);
    expect(() => canonicalJson(Symbol('x'))).toThrow(TypeError);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => canonicalJson(loop)).toThrow(TypeError);
  });

  it('handles a key named __proto__ as an ordinary key', () => {
    const value = JSON.parse('{"__proto__": 1, "a": 2}');
    expect(canonicalJson(value)).toBe('{"__proto__":1,"a":2}');
  });
});

describe('hashLesson', () => {
  it('is the SHA-256 of the canonical JSON, in lowercase hex', () => {
    const lesson = exampleLesson();
    const expected = createHash('sha256').update(canonicalJson(lesson), 'utf8').digest('hex');
    expect(hashLesson(lesson)).toBe(expected);
    expect(hashLesson(lesson)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is the same for the same lesson however it was built', () => {
    const a = exampleLesson();
    const b = JSON.parse(JSON.stringify(exampleLesson()));
    const c = Object.fromEntries(Object.entries(exampleLesson()).reverse()) as typeof a;
    expect(hashLesson(b)).toBe(hashLesson(a));
    expect(hashLesson(c)).toBe(hashLesson(a));
  });

  it('changes with any change to the lesson', () => {
    const base = hashLesson(exampleLesson());
    const edits: Array<(l: any) => void> = [
      (l) => (l.title += '.'),
      (l) => (l.scenes[0].blocks[1].text += ' '),
      (l) => (l.evidence[0].excerpt = l.evidence[0].excerpt.replace('target', 'Target')),
      (l) => l.scenes.reverse(),
      (l) => (l.scenes[3].question.options[0].correct = false),
      (l) => (l.scenes[5].question.answer = 21),
      (l) => (l.level = 'solid'),
    ];
    const seen = new Set([base]);
    for (const edit of edits) {
      const lesson = exampleLesson();
      edit(lesson);
      seen.add(hashLesson(lesson));
    }
    expect(seen.size).toBe(edits.length + 1);
  });

  it('counts non-ASCII text by its UTF-8 bytes', () => {
    const lesson = exampleLesson();
    lesson.title = 'Binäre Suche: schnell finden — 二分探索';
    const text = canonicalJson(lesson);
    expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThan(text.length);
    expect(hashLesson(lesson)).toBe(createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'));
  });
});

describe('sha256Hex', () => {
  it('gives the published test vectors', () => {
    expect(sha256Hex(utf8(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(utf8('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(sha256Hex(utf8('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'))).toBe(
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    );
    expect(sha256Hex(utf8('a'.repeat(1_000_000)))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('agrees with node:crypto at every length around the block boundaries', () => {
    for (let length = 0; length <= 260; length++) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 131 + length * 17) & 0xff;
      expect(sha256Hex(bytes), `length ${length}`).toBe(reference(bytes));
    }
  });

  it('agrees with node:crypto on text of every kind, and on a lesson-sized input', () => {
    const texts = [
      'Binäre Suche — “schnell” finden',
      '二分探索は、整列済みの配列の中央の要素と目標の値を比較する。',
      '😀 astral 𝓤𝓷𝓲𝓬𝓸𝓭𝓮 and a lone surrogate \ud800 inside',
      '\u0000\u0001 controls \u2028\u2029 separators',
      JSON.stringify(exampleLesson()),
      canonicalJson(exampleLesson()).repeat(30),
    ];
    for (const text of texts) expect(sha256Hex(utf8(text))).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    expect(utf8(texts[5]!).length).toBeGreaterThan(300_000);
  });

  it('hashes the largest lesson allowed in a few milliseconds', () => {
    const bytes = utf8('x'.repeat(300_000));
    sha256Hex(bytes);
    const start = performance.now();
    sha256Hex(bytes);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('the validator is environment-neutral, like the rest of core', () => {
  // src/player/tsconfig.json typechecks src/core without node types, so nothing here may need them.
  const files = ['hash.ts', 'issues.ts', 'narration.ts', 'validate.ts', ...readdirSync(path.join(CORE, 'validate')).map((name) => `validate/${name}`)];

  it.each(files)('%s has no node: import and uses no node global', (file) => {
    const source = readFileSync(path.join(CORE, file), 'utf8');
    expect(source).not.toMatch(/from 'node:|require\(|\bBuffer\b|\bprocess\.|__dirname/);
  });
});
