// Rules of the renderer and the player that are properties of the source code, not of one output:
// no way of turning a string into markup or script other than the escaping module, no way of
// styling that the page's policy forbids, and no lookup built from lesson text.
//
// These read every file under src/render and src/player, including the ones other areas own, because
// one exception anywhere would undo the guarantee for the whole page.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

function files(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) out.push(...files(rel, ext));
    else if (name.endsWith(ext)) out.push(rel);
  }
  return out.sort();
}

/** Source text with comments removed, so a rule can be described in a comment without breaking it. */
function code(rel: string): string {
  return readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:'"`\\])\/\/ .*$/gm, '$1');
}

interface Literal {
  kind: 'template' | 'string';
  /** The identifier a template is tagged with, or null. */
  tag: string | null;
  /** The fixed text of the literal, with each interpolation replaced by a space. */
  text: string;
}

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'new', 'else', 'do', 'yield', 'await']);

/**
 * Every string and template literal in a TypeScript source, found by a small lexer that knows about
 * comments, regular expressions and nested templates. Enough to ask what kind of literal a piece of
 * markup sits in; not a parser.
 */
function literals(src: string): Literal[] {
  const out: Literal[] = [];
  const n = src.length;
  let i = 0;

  const template = (tag: string | null): void => {
    const lit: Literal = { kind: 'template', tag, text: '' };
    out.push(lit);
    while (i < n) {
      const c = src[i] as string;
      if (c === '\\') {
        lit.text += src[i + 1] ?? '';
        i += 2;
      } else if (c === '`') {
        i++;
        return;
      } else if (c === '$' && src[i + 1] === '{') {
        i += 2;
        lit.text += ' ';
        codeUntilBrace();
      } else {
        lit.text += c;
        i++;
      }
    }
  };

  const codeUntilBrace = (): void => {
    let depth = 0;
    let last = '';
    let word = '';
    while (i < n) {
      const c = src[i] as string;
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        i = src.indexOf('*/', i + 2);
        i = i === -1 ? n : i + 2;
        continue;
      }
      if (c === "'" || c === '"') {
        const lit: Literal = { kind: 'string', tag: null, text: '' };
        out.push(lit);
        i++;
        while (i < n && src[i] !== c) {
          if (src[i] === '\\') lit.text += src[++i] ?? '';
          else lit.text += src[i];
          i++;
        }
        i++;
        last = 'x';
        word = '';
        continue;
      }
      if (c === '`') {
        const tag = /[A-Za-z0-9_$]/.test(last) && src[i - 1] !== undefined && /[A-Za-z0-9_$]/.test(src[i - 1] as string) ? word : null;
        i++;
        template(tag);
        last = 'x';
        word = '';
        continue;
      }
      if (c === '/' && (last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last) || REGEX_AFTER_WORD.has(word))) {
        i++;
        let inClass = false;
        while (i < n && (inClass || src[i] !== '/') && src[i] !== '\n') {
          if (src[i] === '\\') i++;
          else if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          i++;
        }
        i++;
        last = 'x';
        word = '';
        continue;
      }
      if (c === '{') depth++;
      if (c === '}') {
        if (depth === 0) {
          i++;
          return;
        }
        depth--;
      }
      word = /[A-Za-z0-9_$]/.test(c) ? (/[A-Za-z0-9_$]/.test(src[i - 1] ?? '') ? word + c : c) : '';
      last = c;
      i++;
    }
  };

  codeUntilBrace();
  return out;
}

const MARKUP = /<\/?[a-zA-Z][a-zA-Z0-9-]*(\s|>|\/>|$)/;

const render = files('src/render', '.ts');
const player = files('src/player', '.ts');
const styles = files('src/player', '.css');

const FORBIDDEN_EVERYWHERE: [string, RegExp][] = [
  ['innerHTML', /\binnerHTML\b/],
  ['outerHTML', /\bouterHTML\b/],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\b/],
  ['document.write', /\bdocument\.write(ln)?\b/],
  ['eval', /\beval\s*\(/],
  ['new Function', /\bnew\s+Function\b/],
  ['dynamic import', /\bimport\s*\(/],
  ['a string passed to setTimeout or setInterval', /\bset(Timeout|Interval)\s*\(\s*['"`]/],
  ['DOMParser or a fragment parsed from text', /\bDOMParser\b|\bcreateContextualFragment\b|\bsetHTML(Unsafe)?\b/],
  ['srcdoc', /\bsrcdoc\b/],
];

const FORBIDDEN_IN_PLAYER: [string, RegExp][] = [
  ['setAttribute("style")', /setAttribute\(\s*['"`]style['"`]/],
  ['cssText', /\bcssText\b/],
  ['a created <style> or <script> element', /createElement(NS)?\(\s*(['"`][^'"`]*['"`]\s*,\s*)?['"`](style|script|iframe|object|embed|link|base)['"`]/],
  ['fetch, XHR, a socket, a beacon or a worker', /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b|\bnew\s+(Shared)?Worker\b|\bimportScripts\b/],
  ['a selector built from data', /querySelector(All)?\(\s*`[^`]*\$\{/],
  ['a selector built by concatenation', /querySelector(All)?\(\s*['"][^'"]*['"]\s*\+/],
  ['localStorage outside the store', /\b(local|session)Storage\b/],
  ['speech synthesis', /\bspeechSynthesis\b|\bSpeechSynthesisUtterance\b/],
  ['an audio context', /\bAudioContext\b/],
  ['cookies', /\bdocument\.cookie\b/],
  ['window.open or a location assignment', /\bwindow\.open\s*\(|\blocation\.(href|assign|replace)\b/],
];

/**
 * The custom frame's host (src/player/frame/host.ts) is the one file that may start a worker: the
 * page's policy allows `worker-src data:` for it and nothing else (see render/page.ts). Every other
 * rule applies to it as to any player file.
 */
const FRAME_HOST = 'src/player/frame/host.ts';
const NETWORK_OR_WORKER = 'fetch, XHR, a socket, a beacon or a worker';

describe('the literal finder', () => {
  it('tells tagged templates, plain templates and strings apart, through nesting, comments and regular expressions', () => {
    const src = [
      'const a = html`<p class="x">${cond ? html`<b>${"<i>"}</b>` : `<u>`}</p>`;',
      "const b = '<em>' + x; // '<s>' in a comment",
      'const c = /[`\'"]<q>/.test(d) ? raw(`plain ${e} text`) : f / 2 / g;',
      '/* `<del>` */ const h = `a${`<ins>`}b`;',
    ].join('\n');
    const found = literals(src).map((l) => `${l.kind}:${l.tag ?? '-'}:${l.text}`);
    expect(found).toEqual([
      'template:html:<p class="x"> </p>',
      'template:html:<b> </b>',
      'string:-:<i>',
      'template:-:<u>',
      'string:-:<em>',
      'template:-:plain   text',
      'template:-:a b',
      'template:-:<ins>',
    ]);
  });
});

describe('source rules', () => {
  it('finds the files it is meant to read', () => {
    expect(render).toEqual(expect.arrayContaining(['src/render/escape.ts', 'src/render/figures.ts', 'src/render/questions.ts', 'src/render/steps.ts', 'src/render/page.ts']));
    expect(player).toEqual(expect.arrayContaining(['src/player/main.ts', 'src/player/figures.ts', 'src/player/questions.ts', 'src/player/steps.ts']));
    expect(styles.length).toBeGreaterThanOrEqual(9);
  });

  describe.each([...render, ...player])('%s', (rel) => {
    const text = code(rel);
    it.each(FORBIDDEN_EVERYWHERE)('does not use %s', (_name, pattern) => expect(text).not.toMatch(pattern));
    if (rel.startsWith('src/player') && rel !== 'src/player/storage.ts' && rel !== FRAME_HOST) {
      it.each(FORBIDDEN_IN_PLAYER)('does not use %s', (_name, pattern) => expect(text).not.toMatch(pattern));
    }
    if (rel === FRAME_HOST) {
      it.each(FORBIDDEN_IN_PLAYER.filter(([name]) => name !== NETWORK_OR_WORKER))('does not use %s', (_name, pattern) => expect(text).not.toMatch(pattern));
      it('uses no fetch, XHR, socket or beacon, and starts one kind of worker only: the frame\'s own, from the data: URL it builds', () => {
        expect(text).not.toMatch(/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b|\bSharedWorker\b|\bimportScripts\b/);
        expect(text.match(/\bnew\s+Worker\b[^;]*/g)).toEqual(['new Worker(workerUrl(this.spec.code, this.opts.worker))']);
        // And nothing in the player hands it a blob: or an http(s) address: the URL comes from workerUrl alone.
        expect(code('src/player/frame/runtime.ts')).toMatch(/return `data:text\/javascript;charset=utf-8,\$\{encodeURIComponent\(workerSource\(code, opts\)\)\}`/);
      });
    }
    if (rel === 'src/player/storage.ts') {
      it.each(FORBIDDEN_IN_PLAYER.filter(([name]) => name !== 'localStorage outside the store'))('does not use %s', (_name, pattern) => expect(text).not.toMatch(pattern));
    }
  });

  describe.each(render.filter((rel) => rel !== 'src/render/escape.ts'))('%s', (rel) => {
    const text = code(rel);
    it('builds markup only through the escaping module', () => {
      // Any literal that holds a tag must be an html`` template, where interpolations are escaped
      // and their positions are checked. page.ts also writes the document shell (doctype, head,
      // script and style elements) from fixed strings, and the page tests cover that.
      if (rel === 'src/render/page.ts') return;
      const loose = literals(readFileSync(path.join(root, rel), 'utf8'))
        .filter((lit) => MARKUP.test(lit.text) && !(lit.kind === 'template' && lit.tag === 'html'))
        .map((lit) => lit.text.slice(0, 80));
      expect(loose).toEqual([]);
    });
    it('never writes a style attribute or an event handler', () => {
      expect(text).not.toMatch(/\sstyle\s*=\s*["'$]/);
      expect(text).not.toMatch(/\son[a-z]+\s*=\s*["'$]/);
    });
    it('uses raw() only on markup from a trusted builder', () => {
      const calls = [...text.matchAll(/\braw\(([^)]*)/g)].map((m) => (m[1] as string).trim());
      for (const arg of calls) expect(arg, `raw(${arg})`).toMatch(/^(mathToMathML\(|renderFigure\(|renderQuestion\(|renderSteps\(|$)/);
    });
  });

  describe.each(styles)('%s', (rel) => {
    const text = code(rel);
    it('loads nothing', () => {
      expect(text).not.toMatch(/url\(\s*['"]?(?!data:)/i);
      expect(text).not.toMatch(/@import\s+(url\()?['"]?(https?:)?\/\//i);
      expect(text).not.toMatch(/@font-face/i);
    });
    if (!rel.endsWith('tokens.css') && !rel.endsWith('print.css')) {
      it('takes its colours from the tokens', () => {
        const literal = text.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? [];
        expect(literal).toEqual([]);
      });
    }
  });
});
