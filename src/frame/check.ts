// What the server can decide about a custom frame before publishing, without ever running it.
// Node only: the syntax check uses node:vm, which compiles (parses) and does not execute. The
// function vm.compileFunction returns is thrown away and never called.
//
// WHAT THIS IS NOT. Nothing in this file is the security boundary. The banned-token lint exists so
// that an honest mistake (a timer, a fetch, an async render) gets a clear message at publish time
// instead of a blank stage in the learner's browser. Any token list is defeated by trivial
// obfuscation (`S["con" + "structor"]` passes it) and the design does not rely on it. The boundary
// is the Web Worker the code runs in (no DOM, no window), the page's Content-Security-Policy that
// the worker inherits (no network, no eval, no imports), the data: URL it is started from (an
// opaque origin: no storage) and the host's watchdog (terminate). See src/player/frame/ and
// docs/design/research/v2-sandbox.md. A published file that was edited by hand to carry code
// this file would refuse is still contained by those four.
import vm from 'node:vm';
import { FRAME_LIMITS, type FrameStage } from '../core/frame';
import { FRAME_BODY_PREFIX, FRAME_BODY_SUFFIX } from '../player/frame/shared';

export type FrameSeverity = 'error' | 'warning';

/** Every code this file can report. Stable: renaming one breaks agents that learned it. */
export const FRAME_ISSUES = {
  FRAME_EMPTY: { severity: 'error', title: 'The frame has no code', fix: 'Write the body of the animation: set-up at the top, then `function render(ctx, t) { ... }`.' },
  FRAME_TOO_LARGE: {
    severity: 'error',
    title: 'The code is larger than the limit',
    fix: 'Shorten it. Draw with the helpers in S, compute tables in a loop instead of writing them out, and show one idea per frame.',
  },
  FRAME_LONG_LINE: { severity: 'error', title: 'A line of code is too long to read', fix: 'Break the line. Code is stored as you write it and is never minified.' },
  FRAME_HIDDEN_CHARACTERS: {
    severity: 'error',
    title: 'The code contains characters a reader cannot see: control, text-direction, zero-width, tag or private-use characters',
    fix: 'Remove them. Use only ordinary text, tabs and line feeds; write other characters as escapes inside strings.',
  },
  FRAME_SYNTAX: {
    severity: 'error',
    title: 'The code is not a complete, valid function body',
    fix: 'Fix the syntax error in the message. The code is the inside of a function: statements only, every bracket and comment closed.',
  },
  FRAME_NO_RENDER: {
    severity: 'error',
    title: 'The code does not declare `render` at its top level',
    fix: 'Declare the entry point at the top level exactly as `function render(ctx, t) { ... }`: not an arrow, not inside another function, not async.',
  },
  FRAME_BANNED: {
    severity: 'error',
    title: 'The code uses something that does not exist inside a frame',
    fix: 'Remove it. A frame has ctx, S and plain JavaScript: no network, no imports, no timers or clocks, no promises, no page.',
  },
  FRAME_RANDOM: {
    severity: 'warning',
    title: 'Math.random gives the same sequence in every frame',
    fix: 'Use S.rand(i) for a stable value per item. Math.random is reseeded before each frame so that a frame depends only on t.',
  },
  FRAME_POSTER_RANGE: { severity: 'error', title: 'The poster time is outside the animation', fix: 'Set `poster` to a time between 0 and `duration`.' },
  FRAME_PARAM_DUPLICATE: { severity: 'error', title: 'Two sliders share an id', fix: 'Give each slider its own id.' },
  FRAME_PARAM_RANGE: {
    severity: 'error',
    title: 'A slider whose numbers do not fit together',
    fix: 'Make `min` less than `max`, put `value` between them, and choose a `step` that divides the range into at most a thousand steps.',
  },
  FRAME_PARAM_UNDECLARED: {
    severity: 'error',
    title: 'The code reads a slider that is not declared',
    fix: 'Add the slider to `params` with that id, or remove the read. An undeclared slider reads as undefined.',
  },
  FRAME_PARAM_UNUSED: { severity: 'warning', title: 'A slider the code never reads', fix: 'Read it as `S.params.<id>` inside render, or remove the slider.' },
  FRAME_SOURCED_NO_CITES: {
    severity: 'error',
    title: 'A frame marked "sourced" that cites nothing',
    fix: 'Add the evidence ids its content comes from to `cites`, or set `provenance` to "worked" or "illustrative".',
  },
  FRAME_BEAT_TIME: {
    severity: 'error',
    title: 'Caption times that do not rise or lie outside the animation',
    fix: 'Give every beat an `at` in seconds: the first at 0, each later than the one before, all less than `duration`.',
  },
} as const satisfies Record<string, { severity: FrameSeverity; title: string; fix: string }>;

export type FrameIssueCode = keyof typeof FRAME_ISSUES;
export const FRAME_ISSUE_CODES = Object.keys(FRAME_ISSUES) as FrameIssueCode[];

/** Which lint rule a FRAME_BANNED issue comes from. */
export type FrameBannedRule = 'network' | 'import' | 'eval' | 'global' | 'clock' | 'async' | 'loop' | 'context' | 'statement';

/**
 * One problem. The same fields as an `Issue` in core/types (code, severity, path, message, fix,
 * got), so the lesson validator can pass these through after prefixing `path` with where the
 * stage sits. `path` is relative to the stage: "code", "poster", "params[1].value".
 */
export interface FrameIssue {
  code: FrameIssueCode;
  severity: FrameSeverity;
  path: string;
  /** What is wrong, concretely. */
  message: string;
  /** The specific action that resolves it. */
  fix: string;
  /** The offending text, shortened. It is the agent's own code, never source text. */
  got?: string;
  /** For FRAME_BANNED. */
  rule?: FrameBannedRule;
  /** 1-based line of the code, when one can be named. */
  line?: number;
}

function make(code: FrameIssueCode, path: string, message: string, extra: Partial<FrameIssue> = {}): FrameIssue {
  const entry = FRAME_ISSUES[code];
  return { code, severity: entry.severity, path, message, fix: entry.fix, ...extra };
}

/** Parse `body` as the body of a strict function of S. Returns the error, or null when it parses. Never runs anything. */
function parseError(body: string): Error | null {
  try {
    vm.compileFunction(body, ['S']);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** Comments replaced by spaces, so the lint and the entry-point check do not read prose. Strings are left as they are. */
function withoutComments(code: string): string {
  return code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

const short = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Characters that hide code from a human reader (Trojan Source) or break lines where none is
// seen: the C0 controls other than tab, line feed and carriage return; DEL and the C1 controls;
// the line and paragraph separators; the bidirectional embedding, override and isolate controls;
// the byte-order mark; and half of a surrogate pair on its own, which is not text at all and
// cannot be carried in the worker's URL. Joiners and directional marks that ordinary text in some
// scripts needs (U+200C to U+200F) are allowed.
//
// And the characters every other string of a lesson has removed when it arrives (core/text
// `sanitizeText`), which would otherwise live on in a frame alone, because its code is stored
// exactly as it was sent: the soft hyphen, the zero-width space and the word joiner; the tag
// characters (U+E0000 to U+E007F), which can carry text no reader sees and an agent reading the
// lesson back does; the private-use code points (U+E000 to U+F8FF, planes 15 and 16); and the
// noncharacters (U+FDD0 to U+FDEF and the last two code points of every plane).
const HIDDEN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u200b\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ud800-\udfff\ue000-\uf8ff\ufdd0-\ufdef\ufeff\ufffe\uffff\u{1fffe}\u{1ffff}\u{2fffe}\u{2ffff}\u{3fffe}\u{3ffff}\u{4fffe}\u{4ffff}\u{5fffe}\u{5ffff}\u{6fffe}\u{6ffff}\u{7fffe}\u{7ffff}\u{8fffe}\u{8ffff}\u{9fffe}\u{9ffff}\u{afffe}\u{affff}\u{bfffe}\u{bffff}\u{cfffe}\u{cffff}\u{dfffe}\u{dffff}\u{e0000}-\u{e007f}\u{efffe}\u{effff}\u{f0000}-\u{10ffff}]/u;

/** The contents of '...' and "..." literals replaced by spaces, so a word in a sentence the frame draws is not read as code. Approximate: there is no tokenizer. */
function withoutStrings(bare: string): string {
  return bare.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, (m) => m[0] + ' '.repeat(m.length - 2) + m[0]);
}

// Names that cannot work in the frame (the runtime removes them, the policy blocks them) or that
// break "a frame is a pure function of time". See the note at the top: a lint, not a boundary.
// Rules run on the code with comments and string contents blanked, except those marked `strings`,
// which are about what a string says.
const BANNED: readonly { rule: FrameBannedRule; re: RegExp; strings?: true; why: string; fix: string }[] = [
  {
    rule: 'network',
    re: /\bfetch\s*\(|\b(?:XMLHttpRequest|WebSocket|EventSource|WebTransport|RTCPeerConnection)\b|\b(?:sendBeacon|importScripts)\s*\(/g,
    why: 'A frame has no network.',
    fix: 'Put the data in the code as literals.',
  },
  {
    rule: 'import',
    re: /\bimport\s*\(|\bimport\s*\.\s*meta\b|^\s*(?:import|export)\s/gm,
    why: 'Nothing can be imported or exported.',
    fix: 'The whole animation is this one function body. Use the helpers in S.',
  },
  {
    rule: 'eval',
    re: /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(|\.\s*constructor\b|\[\s*['"`]constructor['"`]\s*\]/g,
    strings: true,
    why: 'Code cannot be built from strings, and `constructor` is not allowed.',
    fix: 'Write the code out. To test what a value is, use typeof or Array.isArray.',
  },
  {
    rule: 'global',
    re: /\b(?:globalThis|__LT_BOOT|__proto__|WebAssembly|SharedArrayBuffer|indexedDB|localStorage|sessionStorage|cookieStore)\b|\b(?:postMessage|addEventListener|queueMicrotask)\s*\(|\bnew\s+(?:Worker|SharedWorker|MessageChannel|BroadcastChannel|Image|Audio|AudioContext)\b|\b(?:self|window|document|navigator|location|caches|Atomics|console)\s*\.\s*[a-zA-Z]/g,
    why: 'This does not exist inside a frame.',
    fix: 'Use ctx and S only. There is no page, no window and no console in there.',
  },
  {
    rule: 'clock',
    re: /\b(?:setTimeout|setInterval|requestAnimationFrame|cancelAnimationFrame)\s*\(|\bperformance\s*\.\s*now\b|\bDate\s*\.\s*now\b|\bnew\s+Date\b/g,
    why: 'There are no timers or clocks.',
    fix: 'The player owns time. Compute everything from the t passed to render.',
  },
  {
    rule: 'async',
    re: /\basync\s+function\b|\basync\s*\(|\basync\s+[A-Za-z_$][\w$]*\s*=>|\bawait\s|\.\s*then\s*\(|\bnew\s+Promise\b/g,
    why: 'render must finish synchronously.',
    fix: 'Remove async, await and promises: a promise never settles before the frame is taken.',
  },
  {
    rule: 'loop',
    re: /\bwhile\s*\(\s*(?:true|1|!0)\s*\)|\bfor\s*\(\s*;\s*;\s*\)/g,
    why: 'A loop with no end condition.',
    fix: 'Give the loop a bound. A frame that does not return within 1.5 seconds is turned off.',
  },
  {
    rule: 'context',
    re: /getContext\s*\(\s*['"`](?:webgl2?|experimental-webgl|webgpu|bitmaprenderer)/g,
    strings: true,
    why: 'Only the 2D canvas context is available.',
    fix: 'Draw with ctx, or with getContext("2d") on an OffscreenCanvas you create.',
  },
  { rule: 'statement', re: /\bdebugger\b/g, why: '`debugger` is not allowed.', fix: 'Remove the statement.' },
];
const SHADOWABLE = /^(self|window|document|navigator|location|caches|Atomics|console)\b/;

/**
 * Text the animation probably draws: string literals of three or more words. Approximate (there is
 * no tokenizer). Offered so the validator can warn when a frame carries prose that appears in
 * neither its captions nor its description: drawn text is a picture, and nothing else checks it.
 */
export function drawnText(code: string): string[] {
  const out: string[] = [];
  for (const m of withoutComments(code).matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, '…').trim();
    if (text.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length >= 3) out.push(text);
  }
  return out;
}

/** The slider ids the code reads as `S.params.<id>`. */
export function paramsRead(code: string): string[] {
  const seen = new Set<string>();
  for (const m of withoutComments(code).matchAll(/\bS\s*\.\s*params\s*\.\s*([A-Za-z_$][\w$]*)/g)) seen.add(m[1] as string);
  return [...seen];
}

/**
 * The checks on the code alone: size, hidden characters, line length, syntax against the exact
 * wrapper the worker uses, a top-level `render`, and the lint. Returns every problem found, errors
 * and warnings; an empty array means the code may be published. The code is never run.
 */
export function checkFrameCode(code: unknown): FrameIssue[] {
  const issues: FrameIssue[] = [];
  if (typeof code !== 'string' || code.trim() === '') return [make('FRAME_EMPTY', 'code', 'A frame needs code: the body of a function that declares `function render(ctx, t)`.')];

  const bytes = Buffer.byteLength(code, 'utf8');
  if (bytes > FRAME_LIMITS.codeBytes) {
    // Nothing below is worth doing on an oversized submission, and the parser is not given unbounded input.
    return [make('FRAME_TOO_LARGE', 'code', `The code is ${bytes} bytes; the limit is ${FRAME_LIMITS.codeBytes}.`, { got: `${bytes} bytes` })];
  }

  const hidden = HIDDEN.exec(code);
  if (hidden) {
    const cp = (hidden[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
    const line = lineOf(code, hidden.index);
    issues.push(make('FRAME_HIDDEN_CHARACTERS', 'code', `Line ${line} contains the character U+${cp}, which a reader cannot see.`, { got: `U+${cp}`, line }));
  }

  const lines = code.split('\n');
  const long = lines.findIndex((l) => l.length > FRAME_LIMITS.lineChars);
  if (long >= 0) {
    issues.push(make('FRAME_LONG_LINE', 'code', `Line ${long + 1} is ${(lines[long] as string).length} characters; the limit is ${FRAME_LIMITS.lineChars}.`, { line: long + 1 }));
  }

  // Syntax. This is the text the worker wraps, character for character, so code that tries to
  // close the wrapper early ("}); ... (function(S){") or leaves a comment open fails here.
  const body = FRAME_BODY_PREFIX + code + FRAME_BODY_SUFFIX;
  const syntax = parseError(body);
  const bare = withoutComments(code);
  const code0 = withoutStrings(bare);
  if (syntax) {
    issues.push(make('FRAME_SYNTAX', 'code', `Syntax error: ${short(String(syntax.message), 160)}`));
  } else {
    // The entry point, decided by the parser and not by reading. If `render` is declared at the
    // top level of the body, then adding `let render` is a redeclaration error; and if adding
    // `var render` is not an error, the declaration is a function or a var (not let, const or
    // class). The text test then asks for the declaration itself, with its two parameters, outside
    // comments and quoted strings. Known gap: `var render = 1` with those words inside a template
    // literal passes here; the worker then reports "no-render-function" and the frame shows its
    // description instead.
    const declared = parseError(`${body};let render;`) !== null;
    const functionLike = parseError(`${body};var render;`) === null;
    const written = /(?:^|[;{}\s])function\s+render\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*[A-Za-z_$][\w$]*\s*\)/.test(code0);
    if (!declared || !functionLike || !written) {
      issues.push(make('FRAME_NO_RENDER', 'code', 'There is no `function render(ctx, t)` at the top level of the code.'));
    }
  }

  for (const { rule, re, strings, why, fix } of BANNED) {
    const text = strings ? bare : code0;
    for (const m of text.matchAll(re)) {
      const found = m[0].trim();
      // A word such as `location` or `console` is an ordinary name when the code declares it itself.
      const name = SHADOWABLE.exec(found);
      if (name && new RegExp(`\\b(?:const|let|var|function)\\s+${name[1]}\\b|[({,]\\s*${name[1]}\\s*[,)=}]`).test(code0)) continue;
      const line = lineOf(text, m.index + (m[0].length - m[0].trimStart().length));
      // One report per rule: the first real use.
      issues.push({ ...make('FRAME_BANNED', 'code', `Line ${line}: “${short(found, 40)}”. ${why}`, { got: short(found, 40), rule, line }), fix });
      break;
    }
  }

  if (/\bMath\s*\.\s*random\b/.test(code0)) {
    issues.push(make('FRAME_RANDOM', 'code', 'Math.random is reseeded before every frame, so it returns the same sequence each time.'));
  }
  return issues;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Every check on a frame stage that has already passed the schema: the code, and the rules that
 * compare two fields. `ok` is true when there is no error (warnings do not block publishing).
 */
export function checkFrame(stage: FrameStage): { ok: boolean; issues: FrameIssue[] } {
  const issues = checkFrameCode(stage.code);

  if (!(stage.poster >= 0 && stage.poster <= stage.duration)) {
    issues.push(make('FRAME_POSTER_RANGE', 'poster', `poster is ${stage.poster} but the animation lasts ${stage.duration} seconds.`, { got: String(stage.poster) }));
  }

  const params = stage.params ?? [];
  const seen = new Set<string>();
  const read = typeof stage.code === 'string' ? paramsRead(stage.code) : [];
  params.forEach((p, i) => {
    const at = `params[${i}]`;
    if (seen.has(p.id)) issues.push(make('FRAME_PARAM_DUPLICATE', `${at}.id`, `Two sliders have the id "${p.id}".`, { got: p.id }));
    seen.add(p.id);
    if (!(p.min < p.max)) {
      issues.push(make('FRAME_PARAM_RANGE', `${at}.min`, `Slider "${p.id}": min (${p.min}) must be less than max (${p.max}).`));
    } else {
      if (!(p.value >= p.min && p.value <= p.max)) {
        issues.push(make('FRAME_PARAM_RANGE', `${at}.value`, `Slider "${p.id}": value (${p.value}) must lie between min (${p.min}) and max (${p.max}).`));
      }
      const steps = (p.max - p.min) / p.step;
      if (steps < 1 && !near(steps, 1)) {
        issues.push(make('FRAME_PARAM_RANGE', `${at}.step`, `Slider "${p.id}": step (${p.step}) is larger than the range from min to max.`));
      } else if (steps > FRAME_LIMITS.paramSteps && !near(steps, FRAME_LIMITS.paramSteps)) {
        issues.push(make('FRAME_PARAM_RANGE', `${at}.step`, `Slider "${p.id}": step (${p.step}) makes ${Math.round(steps)} steps; the most is ${FRAME_LIMITS.paramSteps}.`));
      }
    }
    if (!read.includes(p.id)) issues.push(make('FRAME_PARAM_UNUSED', `${at}.id`, `Slider "${p.id}" is never read as S.params.${p.id}.`, { got: p.id }));
  });
  for (const id of read) {
    if (!seen.has(id)) issues.push(make('FRAME_PARAM_UNDECLARED', 'code', `The code reads S.params.${id}, but no slider has the id "${id}".`, { got: id }));
  }

  if (stage.provenance === 'sourced' && (stage.cites ?? []).length === 0) {
    issues.push(make('FRAME_SOURCED_NO_CITES', 'cites', 'provenance is "sourced" but `cites` is empty.'));
  }
  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}

/**
 * The caption times of a frame clip: `ats[i]` is beat i's `at`. They start at 0, rise, and stay
 * inside the animation. `path` in each issue is relative to the clip: "beats[2].at".
 */
export function checkFrameBeats(duration: number, ats: readonly (number | undefined)[]): FrameIssue[] {
  const issues: FrameIssue[] = [];
  let previous = -Infinity;
  ats.forEach((at, i) => {
    const path = `beats[${i}].at`;
    if (typeof at !== 'number' || !Number.isFinite(at)) {
      issues.push(make('FRAME_BEAT_TIME', path, `Beat ${i + 1} of a frame clip needs \`at\`: the second its caption appears.`));
      return;
    }
    if (i === 0 && at !== 0) issues.push(make('FRAME_BEAT_TIME', path, `The first beat's \`at\` is ${at}; it must be 0 so the animation never plays without a caption.`, { got: String(at) }));
    else if (at <= previous) issues.push(make('FRAME_BEAT_TIME', path, `Beat ${i + 1} is at ${at} s, which is not later than the beat before it (${previous} s).`, { got: String(at) }));
    else if (!(at >= 0 && at < duration)) issues.push(make('FRAME_BEAT_TIME', path, `Beat ${i + 1} is at ${at} s, but the animation lasts ${duration} s.`, { got: String(at) }));
    previous = at;
  });
  return issues;
}

/** The codes as a table for the skill's error reference, in the format of core/issues' catalog. */
export function frameIssuesMarkdown(): string {
  const rows = FRAME_ISSUE_CODES.map((code) => {
    const e = FRAME_ISSUES[code];
    return `| \`${code}\` | ${e.severity} | ${e.title} | ${e.fix} |`;
  });
  return ['## Custom frame', '', '| Code | Severity | Meaning | Fix |', '|---|---|---|---|', ...rows, ''].join('\n');
}
