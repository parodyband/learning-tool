// What lesson text may not carry: web addresses outside the evidence, and commands that would harm
// a learner who copied them. A lesson is read by someone who trusts it, and its text may have been
// shaped by a web page the agent read, so these are refused wherever they appear.
//
// The command checks never depend on where in a line a command stands. A terminal session is
// written with a prompt in front (`$ `, `user@host:~$ `, `(venv) $ `, `PS C:\> `), a Dockerfile
// with `RUN`, a script with `then` or `timeout 60`: whatever precedes the command, the command is
// the same. So a download is recognised by the downloader and its argument, and the shell that
// runs a substitution by standing before it, at any position.
//
// Everything here is a single pass over short strings (a line, a block, a label).
import { issue } from '../issues';
import { codeSpans, mathSpans, plainText, proseText } from '../markup';
import { findUrls } from '../text';
import type { Issue } from '../types';
import { comparableHost } from './context';
import { show } from './shape';

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

export interface UnsafeHit {
  /** What the command does, completing "This text contains a command that ...". */
  what: string;
  fix: string;
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const INTERPRETERS = new Set(['python', 'python2', 'python3', 'node', 'nodejs', 'perl', 'ruby', 'php']);
const DOWNLOADERS = new Set(['curl', 'wget']);
/** Commands that only read their input and print: safe to show after a download. */
const READ_ONLY_FILTERS = new Set(['jq', 'yq', 'grep', 'egrep', 'fgrep', 'rg', 'head', 'tail', 'less', 'more', 'wc', 'sort', 'uniq', 'cut', 'tr', 'column', 'fold', 'nl', 'cat', 'hexdump', 'xxd', 'file', 'sha256sum', 'sha1sum', 'md5sum', 'shasum', 'md5', 'gunzip', 'zcat', 'xmllint']);
/** Words that come before the real command and do not change what it is. */
const PREFIXES = new Set(['sudo', 'doas', 'env', 'exec', 'command', 'nohup', 'time', 'builtin', 'timeout', 'nice', 'ionice', 'stdbuf', 'setsid', 'unbuffer', 'busybox']);
/** sudo options that take a value, which is therefore not the command. */
const SUDO_VALUE_FLAGS = new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U']);
/** The same for the other prefixes, where a letter means something else than it does to sudo. */
const PREFIX_VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
  nice: new Set(['-n', '--adjustment']),
  ionice: new Set(['-c', '-n', '-t']),
};
// `/`, `~` or the home variable, followed by nothing but slashes, dots and wildcards: "/" "*" "/", "~/.", "$HOME/" "*".
const ROOT_TARGET = /^(\/|~|\$HOME|\$\{HOME\})[/*.]*$/;

const FIX_DOWNLOAD = 'Remove it, or show the download and the next command as two separate steps (save to a file with -o, then run a command on that file), so nothing downloaded is consumed unseen. Piping into a read-only filter such as jq, grep, head or python3 -m json.tool is allowed.';
const FIX_STDIN = 'Remove it, or pass a script file as an argument so the learner can read it before running it. A lesson never pipes text into a shell or interpreter.';
const FIX_REMOVE = 'Remove the command. Never copy such a command from a source into a lesson, even as a warning example: describe what it does in words.';

function isWordBreak(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0xa0;
}

function isWordChar(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c >= 0x80;
}

/**
 * The name a command word runs: without its directory and without ".exe". Letter case is kept:
 * `node` is a program, `Node` in program code is a type.
 */
function program(word: string): string {
  const slash = Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\'));
  const name = slash === -1 ? word : word.slice(slash + 1);
  return name.toLowerCase().endsWith('.exe') ? name.slice(0, -4) : name;
}

/**
 * `program`, with a name written wholly in capitals read in lower case: `CURL` and `SH` start the
 * same programs on a file system that ignores case. Mixed case is left alone (`Node`, `Python` are
 * type and language names), so this is only used where something else already says "command":
 * a downloader with its argument, a shell before a substitution, `rm` with its flags.
 */
function looseProgram(word: string): string {
  const name = program(word);
  return /^[A-Z][A-Z0-9]*$/.test(name) ? name.toLowerCase() : name;
}

function isShell(name: string): boolean {
  return SHELLS.has(name);
}
function isInterpreter(name: string): boolean {
  if (INTERPRETERS.has(name)) return true;
  // python3.12, python3.13, ...
  return name.startsWith('python') && /^python[0-9.]*$/.test(name);
}

/** Index of the real command word in `words`: past sudo, timeout and the like with their options, `env` and VAR=value assignments. */
function commandIndex(words: readonly string[]): number {
  let i = 0;
  while (i < words.length) {
    const w = words[i] as string;
    const name = program(w);
    if (PREFIXES.has(name)) {
      i++;
      const own = PREFIX_VALUE_FLAGS[name];
      while (i < words.length && (words[i] as string).startsWith('-')) {
        const flag = words[i] as string;
        i++;
        if ((SUDO_VALUE_FLAGS.has(flag) || own?.has(flag)) && i < words.length) i++;
      }
      // `timeout 60 sh`: the duration is not the command.
      if (name === 'timeout' && i < words.length && /^[0-9.]+[smhd]?$/.test(words[i] as string)) i++;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      i++;
      continue;
    }
    return i;
  }
  return -1;
}

/**
 * True when a shell or interpreter started with these arguments takes its program from standard
 * input: no script file, and no option that supplies the program (`-c`, `-m`, `-e`). In
 * `data | python script.py` standard input is data; in `data | python` it is the program.
 */
function readsProgramFromStdin(name: string, args: readonly string[], prose: boolean): boolean {
  const shell = isShell(name);
  for (const arg of args) {
    if (arg === '-' || arg === '/dev/stdin') return true;
    // The full stop of a sentence, left on its own by a closing quotation mark: `... | "bash".`
    if (prose && /^[.,:;!?]+$/.test(arg)) continue;
    // In a sentence the next word may just be the sentence going on ("... | bash and wait").
    if (!arg.startsWith('-')) return prose && !looksLikeArgument(arg);
    if (arg.startsWith('--')) {
      if (arg === '--eval' || arg === '--print' || arg === '--command') return false;
      continue;
    }
    const cluster = arg.slice(1);
    if (shell) {
      if (cluster.includes('s')) return true;
      if (cluster.includes('c')) return false;
    } else if (name.startsWith('python')) {
      if (cluster.includes('c') || cluster.includes('m')) return false;
    } else if (cluster.includes('e') || cluster.includes('p') || cluster.includes('r')) {
      // node -e / -p, perl and ruby -e (also inside -ne, -pe), php -r
      return false;
    }
  }
  return true;
}

/** An option, an address or a file name: what follows a command, as opposed to the next word of a sentence. */
function looksLikeArgument(word: string): boolean {
  return word.startsWith('-') || word.includes('/') || word.includes('.');
}

/** What is left of `$(`, `<(` or `<<<` once the bracket is taken as an edge: not a word of the command. */
function isRedirectWord(word: string): boolean {
  return /^[<$]+$/.test(word);
}

interface Segment {
  words: string[];
  /** How many quotations, brackets and substitutions are open around these words. */
  depth: number;
  /**
   * The shell, `eval`, `source` or interpreter that runs the output of the command substitution
   * these words are in: `sh` for everything inside `sh -c "$( ... )"`, at any depth and on both
   * sides of a pipe inside it. Null outside a substitution, and in one whose output is only data.
   */
  runner: string | null;
  /** A quotation or substitution opens right after the last word, so that word has an argument. */
  opensNext: boolean;
}

/** One command of a pipeline: what stands between two pipes. */
interface Stage {
  /** Every word of the stage, in order. */
  words: string[];
  /** The words split at edges. The inside of a quotation or bracket may be a command of its own. */
  segments: Segment[];
  /** Nesting depth where the stage begins and ends. Words at `baseDepth` are the stage's own command. */
  baseDepth: number;
  endDepth: number;
  /** The stage begins with a quotation or bracket, as a string literal in program code does. */
  startsWithEdge: boolean;
  /** The stage ends just after a quotation or bracket closed, so the pipe that follows is outside it. */
  endsWithEdge: boolean;
}

interface Command {
  name: string;
  args: string[];
}

/** What could run a substitution opened later in the same stage, kept per level of substitution. */
interface Runners {
  /** A shell, `eval` or `source` anywhere before the substitution. */
  shell: string | null;
  /** The same, followed so far by nothing but options: `sh -c`, not `sh install.sh`. See `open` for why backticks ask for this. */
  shellDirect: string | null;
  /** An interpreter followed so far by nothing but options: `python3 -u <(...)`, not `python3 report.py "$(...)"`. */
  interpreter: string | null;
  /** `.` is the stage's command. */
  dotCommand: boolean;
  /** A `.` that the substitution directly follows: `. <(...)`, `$ . "$(...)"`. */
  dotPending: boolean;
  /** Nothing but prefixes, options and assignments so far, so the next word is the command. */
  leading: boolean;
}

const freshRunners = (): Runners => ({ shell: null, shellDirect: null, interpreter: null, dotCommand: false, dotPending: false, leading: true });

interface Frame {
  /** The character that opened it. */
  ch: string;
  sub: boolean;
  runner: string | null;
}

/**
 * Split text into pipelines of stages. A stage's words are grouped into segments at every edge: a
 * quotation mark, a bracket, a backtick. Edges are paired, so each segment knows how deeply it is
 * nested, and a command substitution (`$(`, `<(`, a backtick) knows what will run its output.
 */
function parse(text: string, prose: boolean): Stage[][] {
  const pipelines: Stage[][] = [];
  let pipeline: Stage[] = [];
  const frames: Frame[] = [];
  // One per level of substitution: runners[0] is outside any, runners[k] inside k of them.
  const runners: Runners[] = [freshRunners()];
  const top = (): Frame | undefined => frames[frames.length - 1];
  // How many open frames each character has, so that a long run of brackets is never searched for a quotation mark.
  const opened = new Map<string, number>();
  const has = (ch: string): boolean => (opened.get(ch) ?? 0) > 0;
  const segment = (): Segment => ({ words: [], depth: frames.length, runner: top()?.runner ?? null, opensNext: false });
  const fresh = (): Stage => ({ words: [], segments: [segment()], baseDepth: frames.length, endDepth: frames.length, startsWithEdge: false, endsWithEdge: false });
  let stage = fresh();
  let seen = 0;
  let word = '';

  const flush = (): void => {
    if (word === '') return;
    let v = word;
    word = '';
    if (prose) {
      // Sentence punctuation is not part of a command word: "... | sh." still ends in sh.
      let end = v.length;
      while (end > 1 && '.,:!?'.includes(v[end - 1] as string)) end--;
      v = v.slice(0, end);
    }
    stage.words.push(v);
    (stage.segments[stage.segments.length - 1] as Segment).words.push(v);
    stage.endsWithEdge = false;
    seen++;

    const r = runners[runners.length - 1] as Runners;
    const name = program(v);
    const loose = looseProgram(v);
    const option = v.startsWith('-') || isRedirectWord(v);
    if (isShell(loose) || name === 'eval' || name === 'source') {
      r.shell ??= loose;
      r.shellDirect = loose;
    } else if (!option) r.shellDirect = null;
    if (isInterpreter(loose)) r.interpreter = loose;
    else if (!option) r.interpreter = null;
    if (v === '.') {
      r.dotPending = true;
      if (r.leading) r.dotCommand = true;
    } else if (!isRedirectWord(v)) r.dotPending = false;
    if (!PREFIXES.has(name) && !v.startsWith('-') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(v)) r.leading = false;
  };
  const edge = (): void => {
    if (seen === 0) stage.startsWithEdge = true;
    stage.segments.push(segment());
    stage.endsWithEdge = true;
    seen++;
  };
  const open = (ch: string, sub: boolean): void => {
    flush();
    (stage.segments[stage.segments.length - 1] as Segment).opensNext = true;
    const outer = top();
    let runner = outer?.runner ?? null;
    if (sub) {
      const r = runners[runners.length - 1] as Runners;
      // `$(` and `<(` are shell syntax wherever they stand, so any shell before them runs them.
      // A backtick is also how prose and Markdown mark code ("open bash and type `curl -s ...`"),
      // so there the shell has to stand directly before it, with nothing but options between:
      // sh -c "`curl ...`", eval `curl ...`. As everywhere, what precedes the shell does not matter.
      runner ??= (ch === '`' ? r.shellDirect : r.shell) ?? r.interpreter ?? (r.dotCommand || r.dotPending ? '.' : null);
      runners.push(freshRunners());
    }
    frames.push({ ch, sub, runner });
    opened.set(ch, (opened.get(ch) ?? 0) + 1);
    edge();
  };
  /** Close the innermost frame opened by `ch`, with anything left open inside it. Without one, the character is a bare edge. */
  const close = (ch: string): void => {
    flush();
    let at = has(ch) ? frames.length - 1 : -1;
    while (at >= 0 && (frames[at] as Frame).ch !== ch) at--;
    if (at !== -1) {
      while (frames.length > at) {
        const frame = frames.pop() as Frame;
        opened.set(frame.ch, (opened.get(frame.ch) as number) - 1);
        if (frame.sub) runners.pop();
      }
    }
    edge();
  };
  const endStage = (): void => {
    flush();
    stage.endDepth = frames.length;
    stage.segments = stage.segments.filter((s) => s.words.length > 0);
    pipeline.push(stage);
    stage = fresh();
    seen = 0;
    // What runs a substitution stands in the same command as the substitution.
    runners[runners.length - 1] = freshRunners();
  };
  const endPipeline = (): void => {
    endStage();
    if (pipeline.some((s) => s.words.length > 0)) pipelines.push(pipeline);
    pipeline = [];
  };

  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (isWordBreak(c)) {
      flush();
      continue;
    }
    const ch = text[i] as string;
    switch (ch) {
      case '|':
        if (text[i + 1] === '|') {
          endPipeline();
          i++;
        } else {
          endStage();
          if (text[i + 1] === '&') i++;
        }
        continue;
      case ';':
        endPipeline();
        continue;
      case '&':
        // `2>&1` and `&>` are redirections, not the end of a command.
        if (text[i - 1] === '>' || text[i - 1] === '<' || text[i + 1] === '>') break;
        endPipeline();
        if (text[i + 1] === '&') i++;
        continue;
      case "'":
      case '’':
        // An apostrophe inside a word ("don't", "it’s") is not a quotation mark.
        if (i > 0 && i + 1 < n && isWordChar(text.charCodeAt(i - 1)) && isWordChar(text.charCodeAt(i + 1))) break;
        if (ch === '’') close('‘');
        else if (has(ch)) close(ch);
        else open(ch, false);
        continue;
      case '"':
        if (has(ch)) close(ch);
        else open(ch, false);
        continue;
      case '`':
        if (has(ch)) close(ch);
        else open(ch, true);
        continue;
      case '“':
      case '‘':
        open(ch, false);
        continue;
      case '”':
        close('“');
        continue;
      case '(':
        open(ch, text[i - 1] === '$' || text[i - 1] === '<');
        continue;
      case ')':
        // A bracket closes the bracket it belongs to, never a quotation it merely stands inside.
        if (top()?.ch === '(') close('(');
        else {
          flush();
          edge();
        }
        continue;
      default:
        break;
    }
    word += ch;
  }
  endPipeline();
  return pipelines;
}

function commandOf(segment: Segment | undefined): Command | null {
  if (!segment) return null;
  const at = commandIndex(segment.words);
  if (at === -1) return null;
  return { name: program(segment.words[at] as string), args: segment.words.slice(at + 1) };
}

/**
 * True when the segment runs curl or wget: the downloader stands at any position and is followed
 * by something that looks like its argument (an option, an address, a quotation). Whatever comes
 * before it (a prompt, `RUN`, `then`, `timeout 60`, the start of a sentence) does not matter.
 * With `bare`, a downloader that is the segment's command counts without an argument as well.
 */
function runsDownloader(segment: Segment | undefined, bare: boolean): boolean {
  if (!segment) return false;
  const words = segment.words;
  const at = bare ? commandIndex(words) : -1;
  for (let i = 0; i < words.length; i++) {
    const name = program(words[i] as string);
    if (i === at && DOWNLOADERS.has(name)) return true;
    if (!DOWNLOADERS.has(name) && !DOWNLOADERS.has(looseProgram(words[i] as string))) continue;
    const next = words[i + 1];
    if (next === undefined ? segment.opensNext : looksLikeArgument(next)) return true;
  }
  return false;
}

/**
 * True when the stage runs a download whose output goes down the pipe: as its own command, or as
 * the command of a quotation or substitution that is still open at the pipe (`"curl x | sh"`
 * inside a string, `v=$(curl x | jq .)`). A downloader merely named in a quotation that has
 * closed (`grep "curl" log | head`, `echo "use curl -s" | tee notes`) is not a download.
 */
function stageDownloads(stage: Stage): boolean {
  const segments = stage.segments;
  if (runsDownloader(segments[0], true)) return true;
  for (const seg of segments) if (seg.depth === stage.baseDepth && runsDownloader(seg, false)) return true;
  const last = segments[segments.length - 1];
  return last !== undefined && last.depth > stage.baseDepth && stage.endDepth >= last.depth && runsDownloader(last, true);
}

function findWord(words: readonly string[], test: (name: string) => boolean): number {
  for (let i = 0; i < words.length; i++) if (test(looseProgram(words[i] as string))) return i;
  return -1;
}

function isDecodeFlag(arg: string): boolean {
  if (arg === '--decode') return true;
  return arg.startsWith('-') && !arg.startsWith('--') && /[dD]/.test(arg);
}

/** True when the words decode base64: `base64 -d`, `base64 --decode`, `openssl base64 -d`, `openssl enc -base64 -d`. */
function decodesBase64(words: readonly string[]): boolean {
  const at = findWord(words, (n) => n === 'base64' || n === 'openssl');
  if (at === -1) return false;
  const rest = words.slice(at + 1);
  const base64 = looseProgram(words[at] as string) === 'base64' || rest.some((w) => /^-?base64$/.test(w));
  return base64 && rest.some(isDecodeFlag);
}

/** PowerShell takes `-` or `/` before a parameter name, and any unambiguous prefix of the name. */
function isEncodedCommandFlag(arg: string): boolean {
  if (!arg.startsWith('-') && !arg.startsWith('/')) return false;
  const a = `-${arg.slice(1).toLowerCase()}`;
  if (a === '-ec') return true;
  return a.length >= 2 && a.startsWith('-e') && '-encodedcommand'.startsWith(a);
}

/** A mode that gives everyone every permission. The sticky bit alone (1777, as on /tmp) is the standard way to share a directory and is left alone. */
function isOpenMode(word: string): boolean {
  if (/^0*[02-7]?777$/.test(word)) return true;
  const symbolic = /^(a|[ugo]{3})[+=]([rwxX]{3})$/.exec(word);
  if (!symbolic) return false;
  const who = symbolic[1] as string;
  const perms = (symbolic[2] as string).toLowerCase();
  return (who === 'a' || new Set(who).size === 3) && new Set(perms).size === 3;
}

/**
 * `python3 -m json.tool` (also `python`, `python3.12`): the standard library's JSON formatter. It
 * prints what it reads and runs nothing, so it may follow a download as `jq .` may. Any other use
 * of an interpreter on piped input is a program fed through a pipe.
 */
function isJsonFormatter(command: Command): boolean {
  return command.name.startsWith('python') && isInterpreter(command.name) && command.args[0] === '-m' && command.args[1] === 'json.tool';
}

/**
 * PowerShell's Invoke-Expression, or its alias `iex`, used on something: after a pipe, or with an
 * argument. The bare name is left alone, so a lesson can say what the cmdlet is; and `iex` is also
 * the name of Elixir's shell (`iex -S mix`, the prompt `iex(1)>`), which is not this.
 */
function invokesExpression(text: string): boolean {
  const lower = text.toLowerCase();
  const isLetter = (c: number): boolean => (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a) || c === 0x5f;
  const isNamePart = (c: number): boolean => isLetter(c) || c === 0x2d || c === 0x2e;
  for (const name of ['invoke-expression', 'iex']) {
    for (let at = lower.indexOf(name); at !== -1; at = lower.indexOf(name, at + name.length)) {
      if (at > 0 && isNamePart(lower.charCodeAt(at - 1))) continue;
      let after = at + name.length;
      // "iex.exs" and "iex-helper" are names; "iex." at the end of a sentence is the command.
      if (after < lower.length && (isLetter(lower.charCodeAt(after)) || (isNamePart(lower.charCodeAt(after)) && after + 1 < lower.length && isLetter(lower.charCodeAt(after + 1))))) continue;
      let before = at - 1;
      while (before >= 0 && lower.charCodeAt(before) === 0x20) before--;
      if (before >= 0 && lower[before] === '|') return true;
      while (after < lower.length && lower.charCodeAt(after) === 0x20) after++;
      const next = lower[after];
      if (next === '$' || next === '"' || next === "'" || next === '&' || next === '[') return true;
      // -Command, the parameter that takes the text to run. Elixir's flags (-S, --sname) are not it.
      if (next === '-' && lower[after + 1] === 'c') return true;
      if (next === '(') {
        // "iex(1)>" is the Elixir prompt.
        let k = after + 1;
        while (k < lower.length && lower.charCodeAt(k) >= 0x30 && lower.charCodeAt(k) <= 0x39) k++;
        if (name === 'iex' && k > after + 1 && lower[k] === ')') continue;
        return true;
      }
    }
  }
  return false;
}

const BLOB_MAX = 120;

function isBlobChar(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x2b || c === 0x2f || c === 0x3d || c === 0x2d || c === 0x5f;
}

/** Length of the longest unbroken run of base64 or hex characters. */
export function longestBlobRun(text: string): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    if (isBlobChar(text.charCodeAt(i))) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

export const BLOB_HIT: UnsafeHit = {
  what: `carries an encoded blob of more than ${BLOB_MAX} base64 or hex characters, which nobody can read before running or pasting it`,
  fix: `Shorten it to a recognisable start followed by "..." (at most ${BLOB_MAX} characters in one run), or leave it out.`,
};

/** A name of two or more capital letters and digits: a constant in program code, not a file a pipe reads from. */
const CAPITALS_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * The shell or interpreter that the text piped into this stage would run as a program, or null.
 *
 * Program code is full of `|` that is not a pipe: a union of string literals (`"deno" | "node"`),
 * a union of types (`Element | Node`), flags or-ed together (`DOT | DASH`), a table row. So a name
 * in quotation marks or in capitals only counts where the stage before it reads like a command:
 * it ends in a plain word (not a quotation, not another constant) and assigns nothing.
 */
function programRunFromStdin(pipeline: readonly Stage[], s: number, prose: boolean): string | null {
  const stage = pipeline[s] as Stage;
  const first = commandOf(stage.segments[0]);
  if (s === 0 || !first) return null;
  const before = pipeline[s - 1] as Stage;
  const lastBefore = before.words[before.words.length - 1];
  const afterCommand = lastBefore !== undefined && !before.endsWithEdge && !CAPITALS_NAME.test(lastBefore);

  let name = first.name;
  if (!isShell(name) && !isInterpreter(name)) {
    // `cat setup.sh | SH`: the last stage of a pipeline, written in capitals.
    name = looseProgram(name);
    if (name === first.name || !(isShell(name) || isInterpreter(name))) return null;
    if (s < pipeline.length - 1 || !afterCommand) return null;
  }
  if (stage.startsWithEdge) {
    // `cat setup.sh | "bash"`, `| 'sh' -s`, `| (sh)`: a shell's name alone in quotation marks or
    // brackets still starts the shell. In code nothing but options may follow it; in a sentence
    // the sentence goes on.
    const quoted = stage.segments[0] as Segment;
    const alone = quoted.words.length === 1 && quoted.depth > stage.baseDepth && (prose || stage.words.slice(1).every((w) => w.startsWith('-')));
    if (!alone || !isShell(name) || !afterCommand || /^[A-Z]/.test(lastBefore as string)) return null;
    for (let k = 0; k < s; k++) if ((pipeline[k] as Stage).words.includes('=')) return null;
    return readsProgramFromStdin(name, stage.words.slice(1), prose) ? name : null;
  }
  return readsProgramFromStdin(name, first.args, prose) ? name : null;
}

/**
 * The first dangerous thing in `text`, or null.
 *
 * `code`: the text is code (a code span, a line of a lines figure). `prose`: the text is a
 * sentence that may contain a command, so sentence punctuation is not part of a command word and
 * the word after a shell's name may just be the sentence going on.
 */
export function findUnsafeCommand(text: string, mode: 'code' | 'prose'): UnsafeHit | null {
  if (longestBlobRun(text) > BLOB_MAX) return BLOB_HIT;
  if (invokesExpression(text)) return { what: 'evaluates text as PowerShell code (Invoke-Expression)', fix: FIX_REMOVE };

  const prose = mode === 'prose';
  for (const pipeline of parse(text, prose)) {
    for (let s = 0; s < pipeline.length; s++) {
      const stage = pipeline[s] as Stage;

      if (s < pipeline.length - 1) {
        // Reading a response through a filter (`curl ... | jq .`) is how API lessons are written and
        // runs nothing. Anything else that consumes a download unseen is refused; a shell or
        // interpreter further down the pipe is caught below whatever sits in between.
        const into = commandOf((pipeline[s + 1] as Stage).segments[0]);
        if (stageDownloads(stage) && !(into && (READ_ONLY_FILTERS.has(into.name) || isJsonFormatter(into)))) return { what: 'pipes a download straight into another command', fix: FIX_DOWNLOAD };
        if (decodesBase64(stage.words)) return { what: 'decodes base64 and pipes the result into another command', fix: FIX_REMOVE };
      }

      const fed = programRunFromStdin(pipeline, s, prose);
      if (fed) return { what: `pipes text into ${fed}, which runs it as a program`, fix: FIX_STDIN };

      // sh -c "$(curl ...)", bash <(curl ...), eval "$(wget ...)", python3 <(curl ...): the same
      // thing without a pipe. So is a payload decoded inside the substitution: eval "$(... | base64 -d)".
      for (const seg of stage.segments) {
        if (seg.runner === null) continue;
        const through = seg.runner === '.' ? 'the shell' : seg.runner;
        if (runsDownloader(seg, true)) return { what: `runs a download through ${through}`, fix: FIX_DOWNLOAD };
        if (decodesBase64(seg.words)) return { what: `decodes base64 and runs the result through ${through}`, fix: FIX_REMOVE };
      }

      const ps = findWord(stage.words, (n) => /^(powershell|pwsh)$/i.test(n));
      if (ps !== -1 && stage.words.slice(ps + 1).some(isEncodedCommandFlag)) return { what: 'runs an encoded PowerShell command', fix: FIX_REMOVE };

      const rm = findWord(stage.words, (n) => n === 'rm');
      if (rm !== -1) {
        let recursive = false;
        let target = false;
        for (const w of stage.words.slice(rm + 1)) {
          if (w === '--no-preserve-root') {
            recursive = true;
            target = true;
          } else if (w === '--recursive') recursive = true;
          else if (w.startsWith('-') && !w.startsWith('--')) recursive ||= /[rR]/.test(w);
          else if (ROOT_TARGET.test(w)) target = true;
        }
        if (recursive && target) return { what: 'deletes the root or home directory recursively', fix: FIX_REMOVE };
      }

      const chmod = findWord(stage.words, (n) => n === 'chmod');
      if (chmod !== -1 && stage.words.slice(chmod + 1).some(isOpenMode)) {
        return { what: 'gives everyone full permissions (chmod 777)', fix: 'Remove it, or use the narrowest permission that works, such as chmod 755 or chmod u+x.' };
      }
    }
  }
  return null;
}

/** A line that is nothing but encoded data. */
function isBlobLine(line: string): boolean {
  const t = line.trim();
  return t.length >= 40 && longestBlobRun(t) === t.length;
}

/** Index of the first line of a blob that was split across lines to stay under the per-line limit, or -1. */
export function findSplitBlob(lines: readonly string[]): number {
  let start = -1;
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    if (isBlobLine(lines[i] as string)) {
      if (start === -1) start = i;
      total += (lines[i] as string).trim().length;
      if (total > BLOB_MAX) return start;
    } else {
      start = -1;
      total = 0;
    }
  }
  return -1;
}

export function unsafeIssue(path: string, what: string, hit: UnsafeHit): Issue {
  return issue('UNSAFE_COMMAND', path, `This ${what} contains a command that ${hit.what}.`, { fix: hit.fix });
}

/** True when the command on this line goes on in the next one: it ends in a backslash, a pipe or a logical operator. */
function continuation(line: string): 'backslash' | 'operator' | null {
  const t = line.trimEnd();
  let slashes = 0;
  while (slashes < t.length && t.charCodeAt(t.length - 1 - slashes) === 0x5c) slashes++;
  // Two backslashes are one escaped backslash, not a continuation.
  if (slashes % 2 === 1) return 'backslash';
  return t.endsWith('|') || t.endsWith('&&') ? 'operator' : null;
}

/**
 * What only shows when the lines of a figure are read together.
 *
 * A long command is written over several lines, each ending in a backslash, and each line alone
 * says nothing: `rm -rf \` and then `~`. So lines that continue into the next are also read as the
 * one command they are, the way a shell joins them. The same goes for a blob split over lines.
 * A line that is refused on its own is reported for that line by the field check and not again here.
 */
export function linesSafetyIssues(lines: readonly string[], path = 'figure.lines', what = 'figure'): Issue[] {
  const out: Issue[] = [];
  const alone = lines.map((line) => findUnsafeCommand(line, 'code') !== null);

  const blob = findSplitBlob(lines);
  if (blob !== -1 && !alone.includes(true)) out.push(unsafeIssue(`${path}[${blob}]`, what, BLOB_HIT));

  for (let i = 0; i < lines.length; i++) {
    const start = i;
    let joined = '';
    for (;;) {
      const line = lines[i] as string;
      const kind = i + 1 < lines.length ? continuation(line) : null;
      // A shell removes the backslash and the line break and nothing else; after an operator the break is only white space.
      joined += kind === 'backslash' ? line.trimEnd().slice(0, -1) : kind === 'operator' ? `${line} ` : line;
      if (kind === null) break;
      i++;
    }
    if (i === start || alone.slice(start, i + 1).includes(true)) continue;
    const hit = findUnsafeCommand(joined, 'code');
    if (hit) {
      out.push(
        issue('UNSAFE_COMMAND', `${path}[${start}]`, `Lines ${start + 1} to ${i + 1} of this ${what} continue into one another. Read as the one command they are, they contain a command that ${hit.what}.`, { fix: hit.fix }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------

/** Hosts reserved for documentation and for the learner's own machine: safe to show in code. */
function isReservedHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1') return true;
  for (const base of ['example.com', 'example.org', 'example.net']) if (host === base || host.endsWith(`.${base}`)) return true;
  return false;
}

/** Hosts found in `text`, ignoring things such as "file:///tmp/x" or a bare "://" that name no host. */
function hostsIn(text: string): string[] {
  const out: string[] = [];
  for (const u of findUrls(text)) {
    const host = comparableHost(u.host);
    if (host !== '' && !out.includes(host)) out.push(host);
  }
  return out;
}

export interface SafetyField {
  path: string;
  text: string;
  /** Inline markup is interpreted in this field. */
  markup: boolean;
  /** The field is code or a worked example: an address is judged by its host instead of being refused. */
  code: boolean;
  /** What to call the field in a message. */
  what: string;
}

function urlInText(path: string, what: string, hosts: readonly string[], named: boolean): Issue {
  const fix = 'Remove the address. A learner reaches a source through the citation on a claim or quote, which links to the stored excerpt.';
  // The words of a quote are a source page's own: its address is not repeated, only reported.
  if (!named) return issue('URL_IN_TEXT', path, `This ${what} contains a web address.`, { fix: `${fix} Quote a passage that has no address in it.` });
  const shown = hosts.map(show);
  return issue('URL_IN_TEXT', path, `This ${what} contains a web address (${shown.join(', ')}).`, { fix, got: shown[0] as string });
}

function unknownHost(path: string, what: string, hosts: readonly string[], allowed: ReadonlySet<string>): Issue {
  const shown = hosts.map(show);
  const evidenceHosts = [...allowed].filter((h) => !isReservedHost(h)).sort().map(show);
  const yours = evidenceHosts.length ? `, or a host you have evidence from (${evidenceHosts.slice(0, 12).join(', ')}${evidenceHosts.length > 12 ? ', ...' : ''})` : '';
  return issue('UNKNOWN_HOST', path, `This ${what} names the host ${shown.join(', ')}, which is not a host of the lesson's evidence.`, {
    fix: `Use example.com, example.org, example.net, localhost or 127.0.0.1${yours}.`,
    got: shown[0] as string,
  });
}

/**
 * Address and command checks for one text field.
 * `allowedHosts` are the evidence hosts that code may name (compared with `comparableHost`).
 */
export function fieldSafetyIssues(field: SafetyField, allowedHosts: ReadonlySet<string>): Issue[] {
  const out: Issue[] = [];
  const { path, text, what } = field;
  // Nothing below can match without one of these characters or words; most fields are plain sentences.
  const mayHaveUrl = text.includes('://') || /www\./i.test(text);
  const prose = field.markup ? proseText(text) : text;
  const spans = field.markup ? codeSpans(text) : [];

  if (mayHaveUrl) {
    const unknown = (hosts: string[]): string[] => hosts.filter((h) => !isReservedHost(h) && !allowedHosts.has(h));
    if (field.code) {
      const bad = unknown(hostsIn(field.markup ? plainText(text) : text));
      if (bad.length > 0) out.push(unknownHost(path, what, bad, allowedHosts));
    } else {
      // A math span can hold words through \text{}, so it is searched like prose.
      const inProse = hostsIn(field.markup ? [prose, ...mathSpans(text)].join(' ') : prose);
      if (inProse.length > 0) out.push(urlInText(path, what, inProse, field.what !== 'quote'));
      const bad = unknown(hostsIn(spans.join(' ')));
      if (bad.length > 0) out.push(unknownHost(path, what, bad, allowedHosts));
    }
  }

  let hit: UnsafeHit | null = null;
  if (field.code && !field.markup) {
    hit = findUnsafeCommand(text, 'code');
  } else {
    for (const span of spans) {
      hit = findUnsafeCommand(span, 'code');
      if (hit) break;
    }
    hit ??= findUnsafeCommand(prose, 'prose');
  }
  // Math is not read as a command, but the words of \text{...} are shown as ordinary text: in a
  // math span of prose, and in a line of a math figure.
  if (!hit && text.includes('\\text{')) {
    const math = field.markup ? mathSpans(text).join(' ') : field.code ? text : '';
    for (const match of math.matchAll(/\\text\{([^{}]*)\}/g)) {
      hit = findUnsafeCommand(match[1] as string, 'prose');
      if (hit) break;
    }
  }
  if (hit) out.push(unsafeIssue(path, what, hit));
  return out;
}

/** The same checks for a plain string outside a scene: a lesson title, an objective. */
export function textSafetyIssues(text: string, path: string, what: string): Issue[] {
  return fieldSafetyIssues({ path, text, markup: false, code: false, what }, new Set());
}
