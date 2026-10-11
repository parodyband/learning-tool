// The static checks the server runs before publishing a frame. Every code is triggered by code
// that deserves it, and good code passes clean. Ported from the sandbox research
// (.scratch/v2-sandbox/tests/40-validate.mjs), with the two documented gaps kept as tests.
import { describe, expect, it } from 'vitest';
import { FRAME_LIMITS, FrameStage } from '../../src/core/frame';
import { sanitizeText } from '../../src/core/text';
import { FRAME_ISSUES, FRAME_ISSUE_CODES, type FrameIssue, checkFrame, checkFrameBeats, checkFrameCode, drawnText, frameIssuesMarkdown, paramsRead } from '../../src/frame/check';
import { FRAME_BODY_PREFIX, FRAME_BODY_SUFFIX } from '../../src/player/frame/shared';
import { workerSource } from '../../src/player/frame/runtime';
import { startWorker } from './realm';

const GOOD = 'function render(ctx, t) { S.clear(); }';
const codes = (issues: FrameIssue[]): string[] => issues.map((i) => i.code);
const rules = (issues: FrameIssue[]): (string | undefined)[] => issues.filter((i) => i.code === 'FRAME_BANNED').map((i) => i.rule);
const stage = (over: Record<string, unknown> = {}): FrameStage => FrameStage.parse({ kind: 'frame', code: GOOD, duration: 10, poster: 2, provenance: 'worked', ...over });

describe('good code', () => {
  it.each([
    ['the smallest frame', GOOD],
    ['set-up above render', 'const xs = [1, 2, 3];\nlet total = 0;\nfor (const x of xs) total += x;\nfunction render(ctx, t) { S.clear(); S.text(String(total), 10, 40); }'],
    ['render declared before the set-up it uses', 'function render(ctx, t) { S.clear(); S.rect(0, 0, w, 10); }\nconst w = 40;'],
    ['helper functions and arrows', 'const at = (s) => [s * 2, s * 3];\nfunction bar(x) { S.rect(x, 0, 10, 10); }\nfunction render(ctx, t) { S.clear(); bar(at(t)[0]); }'],
    ['classes, generators, destructuring, optional chaining', 'class P { constructor(x) { this.x = x; } }\nfunction* seq() { yield 1; }\nconst { W, H } = S;\nfunction render(ctx, t) { S.clear(); const p = new P(t); S.circle(p?.x ?? 0, H / 2, 4); for (const n of seq()) S.circle(n, n, n); }'],
    ['a word in a drawn sentence that is also an API name', 'function render(ctx, t) { S.text("Dogs fetch (and love) the ball; a Worker bee; the top window of the document", 10, 10); }'],
    ['ordinary names that are also browser names', 'function render(ctx, t) { const top = 10, parent = { x: 1 }, location = { x: 2 }, self = { r: 3 }; S.circle(location.x, top + parent.x, self.r); }'],
    ['comments that mention what is banned', '// no fetch( here, no setTimeout( either, and no eval(\n/* while (true) {} */\nfunction render(ctx, t) { S.clear(); }'],
    ['the 2D context of an extra canvas', 'const off = new OffscreenCanvas(64, 64);\nconst g = off.getContext("2d");\nfunction render(ctx, t) { S.clear(); ctx.drawImage(off, 0, 0); }'],
    ['a bounded while loop', 'function render(ctx, t) { let i = 0; while (i < 10) { i++; } S.clear(); }'],
    ['text in another script', 'function render(ctx, t) { S.text("سلام دنیا ‌ 世界", 10, 40); }'],
  ])('%s passes with no issue', (_name, code) => {
    expect(checkFrameCode(code)).toEqual([]);
  });
});

describe('FRAME_EMPTY, FRAME_TOO_LARGE, FRAME_LONG_LINE, FRAME_HIDDEN_CHARACTERS', () => {
  it.each([[''], ['   \n\t '], [undefined], [null], [42], [['function render(ctx, t) {}']]])('no code: %j', (code) => {
    expect(codes(checkFrameCode(code))).toEqual(['FRAME_EMPTY']);
  });

  it('measures the size in bytes, and stops there', () => {
    const big = `${GOOD}\n${'// pad pad pad\n'.repeat(2000)}`;
    expect(Buffer.byteLength(big)).toBeGreaterThan(FRAME_LIMITS.codeBytes);
    const issues = checkFrameCode(big);
    expect(codes(issues)).toEqual(['FRAME_TOO_LARGE']);
    expect(issues[0]?.message).toContain(String(FRAME_LIMITS.codeBytes));
    // 12,000 two-byte characters are within the character cap and over the byte cap.
    const wide = `${GOOD}\n// ${'é'.repeat(12_200)}`;
    expect(wide.length).toBeLessThan(FRAME_LIMITS.codeBytes);
    expect(codes(checkFrameCode(wide.replace(/(.{300})/g, '$1\n// ')))).toEqual(['FRAME_TOO_LARGE']);
    // Exactly at the limit is allowed.
    const exact = `${GOOD}\n${'//'.padEnd(99, 'x')}\n`.repeat(1);
    expect(codes(checkFrameCode(exact))).toEqual([]);
  });

  it('refuses a minified line and names it', () => {
    const issues = checkFrameCode(`${GOOD}\n${'a=1;'.repeat(120)}`);
    expect(codes(issues)).toContain('FRAME_LONG_LINE');
    expect(issues.find((i) => i.code === 'FRAME_LONG_LINE')).toMatchObject({ line: 2, path: 'code' });
    expect(codes(checkFrameCode(`${GOOD}\n// ${'x'.repeat(FRAME_LIMITS.lineChars - 3)}`))).toEqual([]);
  });

  it.each([
    ['a right-to-left override (Trojan Source)', 0x202e],
    ['a left-to-right isolate', 0x2066],
    ['a NUL', 0x0000],
    ['a backspace', 0x0008],
    ['an escape', 0x001b],
    ['a line separator', 0x2028],
    ['a paragraph separator', 0x2029],
    ['a byte-order mark', 0xfeff],
    ['a C1 control', 0x0085],
    ['half of a surrogate pair', 0xd83d],
    // What the lesson's text sanitiser removes from every other string. A frame's code is stored
    // exactly as sent, so here they are refused instead.
    ['a zero-width space', 0x200b],
    ['a word joiner', 0x2060],
    ['a soft hyphen', 0x00ad],
    ['the first tag character', 0xe0000],
    ['a tag letter (text no reader sees)', 0xe0041],
    ['the last tag character', 0xe007f],
    ['a private-use character of the basic plane', 0xe000],
    ['the last private-use character of the basic plane', 0xf8ff],
    ['a private-use character of plane 15', 0xf0000],
    ['a private-use character of plane 16', 0x100000],
    ['a noncharacter (U+FDD0)', 0xfdd0],
    ['a noncharacter (U+FFFE)', 0xfffe],
    ['the last code point of a plane', 0x1ffff],
    ['the last code point of all', 0x10ffff],
  ])('refuses %s', (_name, cp) => {
    const issues = checkFrameCode(`${GOOD} // ${String.fromCodePoint(cp)} hidden`);
    expect(codes(issues)).toContain('FRAME_HIDDEN_CHARACTERS');
    expect(issues.find((i) => i.code === 'FRAME_HIDDEN_CHARACTERS')?.got).toBe(`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
  });

  it('names the code point and the line, wherever in the code the character is', () => {
    const tagged = `${GOOD}\n// a note${String.fromCodePoint(0xe0049, 0xe0067, 0xe006e)}\nconst after = 1;`;
    const found = checkFrameCode(tagged).find((i) => i.code === 'FRAME_HIDDEN_CHARACTERS');
    expect(found).toMatchObject({ path: 'code', severity: 'error', got: 'U+E0049', line: GOOD.split('\n').length + 1 });
    expect(found?.message).toBe(`Line ${GOOD.split('\n').length + 1} contains the character U+E0049, which a reader cannot see.`);
    // Inside a string the code draws, too: what is drawn is what the learner reads.
    const drawn = `function render(ctx, t) { S.clear(); S.text('left${String.fromCodePoint(0x200b)}over', 10, 40); }`;
    expect(codes(checkFrameCode(drawn))).toEqual(['FRAME_HIDDEN_CHARACTERS']);
  });

  it('is the same set the lesson\'s sanitiser removes from other text, apart from white space', () => {
    // Every code point the sanitiser deletes outright is refused here; nothing it keeps is.
    const refused = (cp: number): boolean => checkFrameCode(`${GOOD} // ${String.fromCodePoint(cp)}`).some((i) => i.code === 'FRAME_HIDDEN_CHARACTERS');
    const probes = [0x00ad, 0x200b, 0x2060, 0xfeff, 0x202a, 0x202e, 0x2066, 0x2069, 0xe000, 0xf8ff, 0xfdd0, 0xfdef, 0xfffe, 0xffff, 0x1fffe, 0xe0000, 0xe007f, 0xefffe, 0xf0000, 0xffffd, 0x100000, 0x10fffd, 0x10ffff];
    for (const cp of probes) {
      expect(sanitizeText(`a${String.fromCodePoint(cp)}b`, 'code'), cp.toString(16)).toBe('ab');
      expect(refused(cp), cp.toString(16)).toBe(true);
    }
    // Kept by both: joiners and directional marks some scripts need, ordinary and astral text.
    for (const cp of [0x200c, 0x200d, 0x200e, 0x200f, 0x00e9, 0x4e2d, 0x1f600, 0x1d11e, 0xe0100]) {
      expect(sanitizeText(`a${String.fromCodePoint(cp)}b`, 'code'), cp.toString(16)).toBe(`a${String.fromCodePoint(cp)}b`);
      expect(refused(cp), cp.toString(16)).toBe(false);
    }
  });

  it('allows tabs, carriage returns and line feeds, and characters outside the basic plane', () => {
    expect(checkFrameCode('function render(ctx, t) {\r\n\tS.clear();\r\n}\n')).toEqual([]);
    expect(checkFrameCode('function render(ctx, t) { S.clear(); S.text("\u{1F600} \u{1D11E}", 10, 40); }')).toEqual([]);
  });

  it('accepts only code that can be carried in the worker\'s URL', () => {
    const lone = `${GOOD} // ${String.fromCharCode(0xdc00)}`;
    expect(() => encodeURIComponent(lone)).toThrow(URIError);
    expect(codes(checkFrameCode(lone))).toContain('FRAME_HIDDEN_CHARACTERS');
  });
});

describe('FRAME_SYNTAX', () => {
  it.each([
    ['a syntax error', 'function render(ctx, t) { S.clear( }'],
    ['a syntax error inside a nested function', 'function render(ctx, t) { function a() { let x = ; } }'],
    ['an unclosed comment', 'function render(ctx,t){} /*'],
    ['an unclosed string', 'function render(ctx, t) { S.text("abc, 1, 2); }'],
    ['an unclosed template', 'function render(ctx, t) { S.text(`abc, 1, 2); }'],
    ['a wrapper break-out', '}); postMessage(1); (function(S){ function render(ctx, t) {}'],
    ['a wrapper break-out that returns first', 'function render(ctx, t) {}\n;return render;});\nfetch("http://x");\n(function(S){'],
    ['a module', 'import x from "y";\nfunction render(ctx, t) {}'],
    ['an export', 'export function render(ctx, t) {}'],
    ['sloppy-mode code (the body is strict)', 'function render(ctx, t) { with (S) { clear(); } }'],
    ['an octal literal (the body is strict)', 'const n = 010;\nfunction render(ctx, t) {}'],
    ['top-level await', 'await 1;\nfunction render(ctx, t) {}'],
    ['HTML', '<script>function render(ctx, t) {}</script>'],
  ])('%s', (_name, code) => {
    const issues = checkFrameCode(code);
    expect(codes(issues)).toContain('FRAME_SYNTAX');
    expect(codes(issues)).not.toContain('FRAME_NO_RENDER');
    expect(issues.find((i) => i.code === 'FRAME_SYNTAX')?.message).toMatch(/^Syntax error: /);
  });

  it('compiles exactly the text the worker wraps', () => {
    // The worker's text ends with the same prefix, code and suffix this check compiles.
    expect(workerSource(GOOD)).toContain(`function(S){${FRAME_BODY_PREFIX}${GOOD}${FRAME_BODY_SUFFIX}}`);
    // A last line that is a comment cannot swallow the suffix: it starts on a new line.
    expect(checkFrameCode(`${GOOD} // done`)).toEqual([]);
    const w = startWorker(`${GOOD} // done`);
    expect(w.sent[0]).toMatchObject({ type: 'ready' });
  });

  it('never runs the code', () => {
    const marker = '__lt_frame_check_ran__';
    const g = globalThis as Record<string, unknown>;
    delete g[marker];
    checkFrameCode(`globalThis.${marker} = 1;\nthrow new Error("ran");\nfunction render(ctx, t) { globalThis.${marker} = 2; }`);
    checkFrame(stage({ code: `(function () { globalThis.${marker} = 3; })();\nfunction render(ctx, t) {}` }));
    expect(marker in g).toBe(false);
  });
});

describe('FRAME_NO_RENDER', () => {
  it.each([
    ['no render at all', 'const a = 1;'],
    ['render is a const arrow', 'const render = (ctx, t) => {};'],
    ['render is a let', 'let render = function (ctx, t) {};'],
    ['render is a class', 'class render {}'],
    ['render only nested', 'function setup() { function render(ctx, t) {} }'],
    ['render only in a block', '{ function render(ctx, t) {} }'],
    ['render only in a string', 'const s = "function render(ctx, t) {}";'],
    ['render as a var with the words in a comment', 'var render = 1; /* function render(ctx, t) */'],
    ['render with one parameter', 'function render(ctx) { S.clear(); }'],
    ['render with three parameters', 'function render(ctx, t, extra) { S.clear(); }'],
    ['render misspelled', 'function Render(ctx, t) { S.clear(); }'],
  ])('%s', (_name, code) => {
    expect(codes(checkFrameCode(code))).toContain('FRAME_NO_RENDER');
  });

  it('the words in a quoted string do not count', () => {
    expect(codes(checkFrameCode('var render = 1; const s = " function render(ctx, t)";'))).toEqual(['FRAME_NO_RENDER']);
    expect(codes(checkFrameCode("var render = 1; const s = '\\n function render(ctx, t) {}';"))).toEqual(['FRAME_NO_RENDER']);
  });

  it('documented gap: a var named render plus the words in a template literal passes here, and the worker reports it at load', () => {
    const code = 'var render = 1; const s = ` function render(ctx, t)`;';
    expect(checkFrameCode(code)).toEqual([]);
    expect(startWorker(code).sent).toEqual([{ type: 'error', phase: 'load', message: 'no-render-function' }]);
  });
});

describe('FRAME_BANNED', () => {
  it.each([
    ['fetch', 'network', `${GOOD} fetch("http://x");`],
    ['XMLHttpRequest', 'network', 'function render(ctx, t) { const x = new XMLHttpRequest(); }'],
    ['WebSocket', 'network', 'function render(ctx, t) { new WebSocket("ws://x"); }'],
    ['importScripts', 'network', 'importScripts("x.js");\nfunction render(ctx, t) {}'],
    ['dynamic import', 'import', `${GOOD} import("data:text/javascript,1");`],
    ['import.meta', 'import', 'function render(ctx, t) { S.text(String(import.meta), 0, 0); }'],
    ['eval', 'eval', 'function render(ctx, t) { eval("1"); }'],
    ['new Function', 'eval', 'function render(ctx, t) { new Function("return 1")(); }'],
    ['the constructor trick', 'eval', `${GOOD} const F = (() => {}).constructor;`],
    ['a computed constructor', 'eval', `${GOOD} const F = S["constructor"];`],
    ['a browser global', 'global', 'function render(ctx, t) { S.text(navigator.userAgent, 10, 10); }'],
    ['document', 'global', 'function render(ctx, t) { document.title = "x"; }'],
    ['console', 'global', 'function render(ctx, t) { console.log(t); S.clear(); }'],
    ['globalThis', 'global', 'function render(ctx, t) { globalThis.x = 1; }'],
    ['postMessage', 'global', 'function render(ctx, t) { postMessage(1); }'],
    ['a nested worker', 'global', 'function render(ctx, t) { new Worker("data:,"); }'],
    ['an image element', 'global', 'const img = new Image();\nfunction render(ctx, t) {}'],
    ['storage', 'global', 'function render(ctx, t) { localStorage.setItem("a", "b"); }'],
    ['__proto__', 'global', 'function render(ctx, t) { ({}).__proto__.x = 1; }'],
    ['setTimeout', 'clock', `${GOOD} setTimeout(() => {}, 1);`],
    ['requestAnimationFrame', 'clock', 'function render(ctx, t) { requestAnimationFrame(render); }'],
    ['Date.now', 'clock', 'function render(ctx, t) { const n = Date.now(); }'],
    ['new Date', 'clock', 'function render(ctx, t) { const n = new Date(); }'],
    ['performance.now', 'clock', 'function render(ctx, t) { const n = performance.now(); }'],
    ['an async render', 'async', 'async function render(ctx, t) {}'],
    ['await', 'async', 'function render(ctx, t) { (async () => { await 1; })(); }'],
    ['a promise chain', 'async', 'function render(ctx, t) { Promise.resolve().then(() => S.clear()); }'],
    ['while (true)', 'loop', 'function render(ctx, t) { while (true) {} }'],
    ['for (;;)', 'loop', 'function render(ctx, t) { for (;;) {} }'],
    ['webgl', 'context', 'function render(ctx, t) { new OffscreenCanvas(1, 1).getContext("webgl"); }'],
    ['webgpu', 'context', "function render(ctx, t) { new OffscreenCanvas(1, 1).getContext('webgpu'); }"],
    ['debugger', 'statement', 'function render(ctx, t) { debugger; S.clear(); }'],
  ])('%s is reported under the rule "%s"', (_name, rule, code) => {
    const issues = checkFrameCode(code);
    expect(rules(issues)).toContain(rule);
    const issue = issues.find((i) => i.code === 'FRAME_BANNED' && i.rule === rule) as FrameIssue;
    expect(issue.severity).toBe('error');
    expect(issue.path).toBe('code');
    expect(issue.line).toBeGreaterThanOrEqual(1);
    expect(issue.got).toBeTruthy();
    expect(issue.message).toContain(issue.got);
    expect(issue.fix.length).toBeGreaterThan(20);
  });

  it('reports each rule once, with the line of its first use', () => {
    const issues = checkFrameCode('function render(ctx, t) {\n  S.clear();\n  fetch("a");\n  fetch("b");\n  setTimeout(render, 1);\n}');
    expect(rules(issues).sort()).toEqual(['clock', 'network']);
    expect(issues.find((i) => i.rule === 'network')?.line).toBe(3);
    expect(issues.find((i) => i.rule === 'clock')?.line).toBe(5);
  });

  it('finds a real use after a declared name of the same rule', () => {
    const issues = checkFrameCode('function render(ctx, t) { const location = { x: 1 }; S.circle(location.x, 0, 1); S.text(navigator.language, 0, 0); }');
    expect(rules(issues)).toEqual(['global']);
    expect(issues[0]?.got).toContain('navigator');
  });

  it('documented: an obfuscated escape passes the lint, because the lint is not the boundary', () => {
    const code = 'function render(ctx, t) { const k = "con" + "structor"; try { S[k][k]("return 1")(); } catch (e) {} S.clear(); }';
    expect(checkFrameCode(code)).toEqual([]);
    // What stops it is the realm it runs in. (In a browser the policy refuses to build the function; that is measured by the escape spec.)
    expect(startWorker(code).sent[0]).toMatchObject({ type: 'ready' });
  });
});

describe('FRAME_RANDOM', () => {
  it('warns, and does not block', () => {
    const result = checkFrame(stage({ code: 'function render(ctx, t) { S.clear(); S.circle(Math.random() * S.W, 10, 4); }' }));
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ code: 'FRAME_RANDOM', severity: 'warning', path: 'code' });
    expect(checkFrameCode('function render(ctx, t) { S.clear(); S.circle(S.rand(3) * S.W, 10, 4); }')).toEqual([]);
  });
});

describe('rules across fields', () => {
  const slider = { id: 'angle', label: 'Launch angle', min: 15, max: 75, step: 1, value: 45 };
  const reads = 'function render(ctx, t) { S.clear(); S.text(String(S.params.angle), 10, 40); }';

  it('a complete frame passes', () => {
    expect(checkFrame(stage({ code: reads, params: [slider], cites: ['e1'], provenance: 'sourced' }))).toEqual({ ok: true, issues: [] });
  });

  it('FRAME_POSTER_RANGE: the poster lies inside the animation', () => {
    const result = checkFrame(stage({ duration: 5, poster: 9 }));
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ code: 'FRAME_POSTER_RANGE', path: 'poster', got: '9' })]);
    expect(checkFrame(stage({ duration: 5, poster: 5 })).ok).toBe(true);
    expect(checkFrame(stage({ duration: 5, poster: 0 })).ok).toBe(true);
  });

  it.each([
    ['min above max', { ...slider, min: 80 }, 'params[0].min'],
    ['min equal to max', { ...slider, min: 75 }, 'params[0].min'],
    ['value below min', { ...slider, value: 5 }, 'params[0].value'],
    ['value above max', { ...slider, value: 76 }, 'params[0].value'],
    ['step larger than the range', { ...slider, step: 100 }, 'params[0].step'],
    ['more than a thousand steps', { ...slider, step: 0.01 }, 'params[0].step'],
  ])('FRAME_PARAM_RANGE: %s', (_name, param, path) => {
    const result = checkFrame(stage({ code: reads, params: [param] }));
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ code: 'FRAME_PARAM_RANGE', path })]);
  });

  it('FRAME_PARAM_RANGE: fractional steps that divide the range are fine', () => {
    expect(checkFrame(stage({ code: reads, params: [{ ...slider, min: 0, max: 1, step: 0.1, value: 0.3 }] })).issues).toEqual([]);
    expect(checkFrame(stage({ code: reads, params: [{ ...slider, min: 0, max: 1, step: 0.001, value: 0.5 }] })).issues).toEqual([]);
    expect(checkFrame(stage({ code: reads, params: [{ ...slider, min: 0, max: 1, step: 1, value: 0 }] })).issues).toEqual([]);
  });

  it('FRAME_PARAM_DUPLICATE: two sliders with one id', () => {
    const result = checkFrame(stage({ code: reads, params: [slider, { ...slider, label: 'Again' }] }));
    expect(result.ok).toBe(false);
    expect(codes(result.issues)).toEqual(['FRAME_PARAM_DUPLICATE']);
    expect(result.issues[0]?.path).toBe('params[1].id');
  });

  it('FRAME_PARAM_UNDECLARED: the code reads a slider that does not exist', () => {
    const result = checkFrame(stage({ code: 'function render(ctx, t) { S.clear(); S.circle(S.params.speed, S . params . angle, 4); }', params: [slider] }));
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ code: 'FRAME_PARAM_UNDECLARED', path: 'code', got: 'speed' })]);
  });

  it('FRAME_PARAM_UNUSED: a slider nothing reads is a warning', () => {
    const result = checkFrame(stage({ params: [slider] }));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([expect.objectContaining({ code: 'FRAME_PARAM_UNUSED', severity: 'warning', path: 'params[0].id', got: 'angle' })]);
    // A read in a comment does not count.
    expect(codes(checkFrame(stage({ code: `// S.params.angle\n${GOOD}`, params: [slider] })).issues)).toEqual(['FRAME_PARAM_UNUSED']);
  });

  it('FRAME_SOURCED_NO_CITES: "sourced" needs a passage', () => {
    const result = checkFrame(stage({ provenance: 'sourced' }));
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ code: 'FRAME_SOURCED_NO_CITES', path: 'cites' })]);
    expect(checkFrame(stage({ provenance: 'illustrative' })).ok).toBe(true);
  });

  it('reports code problems and field problems together', () => {
    const result = checkFrame(stage({ code: 'function render(ctx, t) { fetch("x"); }', duration: 3, poster: 4, provenance: 'sourced' }));
    expect(codes(result.issues).sort()).toEqual(['FRAME_BANNED', 'FRAME_POSTER_RANGE', 'FRAME_SOURCED_NO_CITES']);
  });
});

describe('FRAME_BEAT_TIME', () => {
  it('accepts times that start at 0, rise and stay inside the animation', () => {
    expect(checkFrameBeats(17, [0, 1.6, 5.1, 15.6])).toEqual([]);
    expect(checkFrameBeats(2, [0, 1.999])).toEqual([]);
  });

  it.each([
    ['a first beat that is not at 0', 10, [0.5, 2], 'beats[0].at'],
    ['a beat with no time', 10, [0, undefined], 'beats[1].at'],
    ['times that do not rise', 10, [0, 3, 3], 'beats[2].at'],
    ['times that go back', 10, [0, 5, 2], 'beats[2].at'],
    ['a time at the very end', 10, [0, 10], 'beats[1].at'],
    ['a time after the end', 10, [0, 12], 'beats[1].at'],
    ['a time that is not finite', 10, [0, Number.NaN], 'beats[1].at'],
  ])('%s', (_name, duration, ats, path) => {
    const issues = checkFrameBeats(duration, ats);
    expect(issues).toEqual([expect.objectContaining({ code: 'FRAME_BEAT_TIME', severity: 'error', path })]);
  });
});

describe('the catalog', () => {
  it('has stable UPPER_SNAKE codes that all start with FRAME_, each with a meaning and a fix', () => {
    expect(FRAME_ISSUE_CODES).toEqual([
      'FRAME_EMPTY',
      'FRAME_TOO_LARGE',
      'FRAME_LONG_LINE',
      'FRAME_HIDDEN_CHARACTERS',
      'FRAME_SYNTAX',
      'FRAME_NO_RENDER',
      'FRAME_BANNED',
      'FRAME_RANDOM',
      'FRAME_POSTER_RANGE',
      'FRAME_PARAM_DUPLICATE',
      'FRAME_PARAM_RANGE',
      'FRAME_PARAM_UNDECLARED',
      'FRAME_PARAM_UNUSED',
      'FRAME_SOURCED_NO_CITES',
      'FRAME_BEAT_TIME',
    ]);
    for (const code of FRAME_ISSUE_CODES) {
      expect(code).toMatch(/^FRAME_[A-Z_]+$/);
      expect(FRAME_ISSUES[code].title.length).toBeGreaterThan(10);
      expect(FRAME_ISSUES[code].fix.length).toBeGreaterThan(10);
    }
  });

  it('every issue carries code, severity, path, message and fix, as the lesson validator\'s issues do', () => {
    const all = [
      ...checkFrameCode(''),
      ...checkFrameCode('function render(ctx, t) { fetch("x"); Math.random(); }'),
      ...checkFrame(stage({ duration: 3, poster: 4, provenance: 'sourced' })).issues,
      ...checkFrameBeats(5, [1]),
    ];
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (const issue of all) {
      expect(FRAME_ISSUE_CODES).toContain(issue.code);
      expect(issue.severity).toBe(FRAME_ISSUES[issue.code].severity);
      expect(typeof issue.path).toBe('string');
      expect(issue.message.length).toBeGreaterThan(10);
      expect(issue.fix.length).toBeGreaterThan(10);
    }
  });

  it('renders as a table for the error reference', () => {
    const md = frameIssuesMarkdown();
    for (const code of FRAME_ISSUE_CODES) expect(md).toContain(`| \`${code}\` |`);
  });
});

describe('helpers for the validator', () => {
  it('drawnText lists the sentences a frame draws', () => {
    expect(drawnText('function render(ctx, t) { S.text("Left is larger: swap them.", 0, 0); S.text("ok", 0, 0); S.text(`Total ${n} of the items`, 0, 0); /* "not this one at all" */ }')).toEqual(['Left is larger: swap them.', 'Total … of the items']);
  });

  it('paramsRead lists the sliders the code reads', () => {
    expect(paramsRead('function render(ctx, t) { const a = S.params.angle + S.params.speed; /* S.params.ghost */ return S.params.angle; }')).toEqual(['angle', 'speed']);
  });
});
