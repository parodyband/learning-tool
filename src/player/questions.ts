// Checkpoint questions: grading, feedback, and the first-attempt result the recap shows.
//
// The markup is already complete (src/render/questions.ts): this file only un-hides the controls
// that need a script and decides when the feedback and the explanation, which are in the page
// from the start inside a closed <details>, may be shown. The rules it keeps:
//
//   - Nothing is revealed before an attempt. Selecting never grades; the learner presses a button.
//   - A graded question gives two attempts. After the first wrong one the learner is told why and
//     tries once more; then the answer is marked and the explanation appears with its sources.
//   - Only the first attempt is recorded (api.recordResult). Answering again later is practice.
//   - Everything said goes into the question's one role="status" element, in words, with a mark
//     that does not depend on colour. Focus never moves when feedback appears.
//   - What a learner types is read where it is typed and never stored.
//
// A question whose markup or data is not what is expected is left exactly as it was rendered:
// the plain question with its answer behind a disclosure still works.
//
// This file must stay importable outside a page (the number reader is tested on its own), so it
// touches `document` only inside functions and imports nothing but types from ./main.
import type { NumericQuestion, OrderQuestion, ReflectQuestion, Scene, SingleQuestion } from '../core/schema';
import type { CheckpointResult, PlayerApi } from './main';

/** What the player says. Interface words: marked as English in a lesson written in another language. */
export const SAID = {
  correct: 'Correct.',
  notQuite: 'Not quite.',
  oneMore: 'You have one more try.',
  explained: 'The explanation is below.',
  chooseFirst: 'Choose an answer first.',
  markRight: 'Correct answer',
  markWrong: 'Not this one',
  moveFirst: 'Move at least one item first.',
  moveAgain: 'Change the order, then check again.',
  inPlace: 'In place',
  outOfPlace: 'Out of place',
  orderBelow: 'The correct order is below.',
  typeFirst: 'Type your answer first.',
  notANumber: 'That does not read as a number. Use digits, such as 12 or 0.5.',
  twoReadings: 'Type it again the way you mean it, with nothing between the thousands.',
  sameNumber: 'That is the answer you already tried. Change it, then check again.',
  tooHigh: 'Your answer is too high.',
  tooLow: 'Your answer is too low.',
  writeFirst: 'Write your own answer first: a rough sentence is enough. To see the model answer without writing, press the button again.',
  compare: 'The model answer is shown above. Compare it with yours, then rate how close you were.',
} as const;

const TRIES = 2;

// ---------------------------------------------------------------------------------------------
// Small pieces shared with the predict question of a step (./steps)
// ---------------------------------------------------------------------------------------------

/** Words of the lesson (an item's text, a title) quoted inside a sentence of the player's own: only the player's part is marked as English. */
export function sentence(lessonText: string, rest: string): HTMLElement {
  const p = document.createElement('p');
  p.append(`“${lessonText}” `, words('span', rest));
  return p;
}

/** An element holding interface words. In a lesson that is not in English it is marked as English, as the renderer does. */
export function words<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (!/^en(-|$)/i.test(document.documentElement.lang || 'en')) el.lang = 'en';
  el.textContent = text;
  return el;
}

/**
 * "Correct." or "Not quite." as a line of its own. The stylesheet puts a tick or a cross before
 * it (from `data-verdict`), as generated content with empty alternative text: seen, and not read
 * out on top of the words.
 */
export function verdict(right: boolean, text: string = right ? SAID.correct : SAID.notQuite): HTMLElement {
  const p = document.createElement('p');
  p.className = 'lt-verdict';
  p.dataset.verdict = right ? 'right' : 'wrong';
  p.append(words('span', text));
  return p;
}

/** A copy of a piece of lesson text that is already in the page, markup and all. */
export function copyOf(source: Element | undefined, className: string, tag: 'p' | 'span' = 'p'): HTMLElement {
  const p = document.createElement(tag);
  p.className = className;
  if (source) for (const node of Array.from(source.childNodes)) p.append(node.cloneNode(true));
  return p;
}

export type Tone = 'good' | 'bad' | 'warn';

export interface Status {
  /** Replace what the region says. */
  say(nodes: readonly Node[], tone?: Tone): void;
  clear(): void;
}

/**
 * A role="status" element. When the new words are the same as the old ones the region is emptied
 * for a moment first, because a region whose text did not change is not announced again.
 */
export function createStatus(region: HTMLElement): Status {
  let timer = 0;
  const put = (nodes: readonly Node[], tone?: Tone): void => {
    if (tone) region.dataset.tone = tone;
    else delete region.dataset.tone;
    region.replaceChildren(...nodes);
  };
  return {
    clear() {
      window.clearTimeout(timer);
      put([]);
    },
    say(nodes, tone) {
      window.clearTimeout(timer);
      const text = nodes.map((n) => n.textContent ?? '').join('');
      if (region.textContent !== text) {
        put(nodes, tone);
        return;
      }
      put([]);
      timer = window.setTimeout(() => put(nodes, tone), 60);
    },
  };
}

/** Show or remove the words beside an option or an item that say how it was judged. The stylesheet adds the tick or cross from `data-state`. */
export function setMark(host: HTMLElement, state: 'right' | 'wrong' | null, text = ''): void {
  const old = host.querySelector(':scope > .lt-mark');
  if (old?.previousSibling?.nodeType === Node.TEXT_NODE) old.previousSibling.remove();
  old?.remove();
  if (state === null) {
    delete host.dataset.state;
    return;
  }
  host.dataset.state = state;
  // The space keeps the words apart from the text before them when the two are read as one name.
  host.append(' ', words('span', text, 'lt-mark'));
}

export interface Choice {
  /** The option's index in the lesson, whatever order the options are shown in. */
  index: number;
  label: HTMLLabelElement;
  input: HTMLInputElement;
}

/** The radios of a choice question, or null unless there is exactly one for each option of the lesson. */
export function readChoices(root: ParentNode, count: number): Choice[] | null {
  const out: Choice[] = [];
  const seen = new Set<number>();
  for (const label of Array.from(root.querySelectorAll<HTMLLabelElement>('label.lt-option[data-option]'))) {
    const index = Number(label.dataset.option);
    const input = label.querySelector<HTMLInputElement>('input[type="radio"]');
    if (!input || !Number.isInteger(index) || index < 0 || index >= count || seen.has(index)) return null;
    seen.add(index);
    out.push({ index, label, input });
  }
  return out.length === count && count > 0 ? out : null;
}

/** Each option's feedback as it sits in the no-script answer, by option index. */
export function readFeedback(answer: ParentNode): Map<number, HTMLElement> {
  const out = new Map<number, HTMLElement>();
  answer.querySelectorAll<HTMLElement>('[data-feedback]').forEach((el) => out.set(Number(el.dataset.feedback), el));
  return out;
}

/** Make the radios usable and keep `data-picked` on the chosen row, for the stylesheet. */
export function wakeChoices(choices: readonly Choice[]): void {
  const paint = (): void => {
    for (const c of choices) {
      if (c.input.checked) c.label.dataset.picked = 'true';
      else delete c.label.dataset.picked;
    }
  };
  for (const c of choices) {
    c.input.hidden = false;
    // The browser may put back what was chosen before a reload; a question always starts unanswered.
    // (Set here because the attribute is not valid markup on a radio or a checkbox; the property still stops the restore.)
    c.input.autocomplete = 'off';
    c.input.checked = false;
    c.input.addEventListener('change', paint);
  }
}

export function pickedChoice(choices: readonly Choice[]): Choice | undefined {
  return choices.find((c) => c.input.checked && !c.input.disabled);
}

/** Stop a choice question and mark it: the answer, and whichever wrong options were tried. */
export function settleChoices(choices: readonly Choice[], isCorrect: (index: number) => boolean, tried: ReadonlySet<number>): void {
  for (const c of choices) {
    if (isCorrect(c.index)) setMark(c.label, 'right', SAID.markRight);
    else if (tried.has(c.index)) setMark(c.label, 'wrong', SAID.markWrong);
    c.input.disabled = true;
    c.label.dataset.locked = 'true';
  }
}

/**
 * Put away the no-script answer once its parts have been taken out. One that still holds something
 * (each option's feedback) stays in the page, hidden, as the answer key a printout shows.
 */
export function shelve(answer: HTMLElement): void {
  if (answer.querySelector('.lt-reveal-body')?.childElementCount) answer.hidden = true;
  else answer.remove();
}

// ---------------------------------------------------------------------------------------------
// Reading a typed number
// ---------------------------------------------------------------------------------------------

/** The zero of each script's decimal digits that people type with. Full-width and styled digits are folded by NFKC before this is used. */
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x17e0, 0x1810];

function asciiDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    const zero = cp < 0x80 ? undefined : DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
    out += zero === undefined ? ch : String(cp - zero);
  }
  return out;
}

const occurrences = (s: string, ch: string): number => s.split(ch).length - 1;

/** Groups of three after a first group of one to three: "1,000,000". */
function grouped(s: string, separator: string): boolean {
  const parts = s.split(separator);
  return /^\d{1,3}$/.test(parts[0] ?? '') && parts.slice(1).every((p) => /^\d{3}$/.test(p));
}

export type DecimalMark = '.' | ',';

/**
 * The mark a language writes before the fraction: "," in most of Europe and Latin America, "."
 * elsewhere. Asked of the browser, so no table of languages is kept here.
 */
export function decimalMarkOf(lang: string): DecimalMark {
  try {
    const part = new Intl.NumberFormat(lang).formatToParts(1.5).find((p) => p.type === 'decimal');
    return part?.value === ',' ? ',' : '.';
  } catch {
    return '.';
  }
}

/**
 * The digits of a number in the one form `Number` reads, for each way the separators can honestly
 * be read. The first is how the lesson's language reads them.
 */
function readings(digits: string, hasExponent: boolean, decimalMark: DecimalMark): string[] | null {
  const commas = occurrences(digits, ',');
  const dots = occurrences(digits, '.');
  if (commas === 0 && dots === 0) return [digits];
  if (commas > 0 && dots > 0) {
    // Both are there, so the one written last is the decimal mark and the other groups thousands.
    const decimal = digits.lastIndexOf(',') > digits.lastIndexOf('.') ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    if (occurrences(digits, decimal) !== 1) return null;
    const [whole = '', fraction = ''] = digits.split(decimal);
    if (!grouped(whole, grouping)) return null;
    return [`${whole.split(grouping).join('')}.${fraction === '' ? '0' : fraction}`];
  }
  const separator = commas > 0 ? ',' : '.';
  if (commas + dots > 1) return grouped(digits, separator) ? [digits.split(separator).join('')] : null;
  const [whole = '', fraction = ''] = digits.split(separator);
  const decimal = `${whole === '' ? '0' : whole}.${fraction === '' ? '0' : fraction}`;
  if (hasExponent || fraction.length !== 3 || !/^[1-9]\d{0,2}$/.test(whole)) return [decimal];
  // One separator and exactly three digits after it: "1,250" is twelve hundred and fifty to some
  // readers and one and a quarter to others. The lesson's language says which comes first.
  const thousands = whole + fraction;
  if (separator === decimalMark) return [decimal, thousands];
  // Nobody writes "20,000" to mean twenty, so where the mark groups thousands, three zeros leave one reading.
  return fraction === '000' ? [thousands] : [thousands, decimal];
}

/**
 * What a learner typed, as a number. A comma or a dot may be the decimal mark; spaces, apostrophes
 * and the other of the two may group thousands; the unit may be typed along; digits of other
 * scripts, a typographic minus, an exponent and a simple fraction are understood. Returns more
 * than one value when the text has two honest readings, the one the lesson's language gives it
 * first (`decimalMark` is that language's), and null when it is not a number.
 */
export function readNumber(raw: string, unit?: string, decimalMark: DecimalMark = '.'): number[] | null {
  let s = asciiDigits(raw.normalize('NFKC')).trim().toLowerCase();
  const u = unit?.normalize('NFKC').trim().toLowerCase();
  if (u) {
    if (s.endsWith(u)) s = s.slice(0, s.length - u.length);
    else if (s.startsWith(u)) s = s.slice(u.length);
  }
  s = s
    .replace(/[−‒–—﹣]/g, '-')
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .trim()
    .replace(/(\d)[\s'’_]+(?=\d)/g, '$1')
    .replace(/^([+-])\s+/, '$1');

  const fraction = /^([+-]?)(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (fraction) {
    const value = Number(`${fraction[1]}${fraction[2]}`) / Number(fraction[3]);
    return Number.isFinite(value) ? [value] : null;
  }

  const m = /^([+-]?)([\d.,]*\d[\d.,]*)(e[+-]?\d+)?$/.exec(s);
  if (!m) return null;
  const forms = readings(m[2] as string, m[3] !== undefined, decimalMark);
  if (!forms) return null;
  const values: number[] = [];
  for (const form of forms) {
    const value = Number(`${m[1]}${form}${m[3] ?? ''}`);
    if (!Number.isFinite(value)) return null;
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

/**
 * Whether a value is the answer, within the tolerance. The slack is a few units in the last place
 * of the numbers involved: enough to absorb binary rounding (1.3 is within 0.05 of 1.25, though
 * the subtraction says 0.05000000000000004), and far too little to let a different number through.
 */
export function closeEnough(value: number, answer: number, tolerance: number): boolean {
  const allowed = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0;
  const slack = 8 * Number.EPSILON * Math.max(Math.abs(value), Math.abs(answer), allowed);
  return Math.abs(value - answer) <= allowed + slack;
}

export interface NumberGrade {
  right: boolean;
  /** Right, and the same as the answer itself rather than merely inside the tolerance. */
  exact: boolean;
  /** Set when every reading of a wrong answer errs the same way. */
  direction: 'high' | 'low' | null;
}

/**
 * Grade what was typed by its first reading, the one the lesson's language gives it. A second
 * reading never makes an answer right: "20,000" is not twenty in an English lesson.
 */
export function gradeNumber(values: readonly number[], answer: number, tolerance: number): NumberGrade {
  const first = values[0];
  if (first !== undefined && closeEnough(first, answer, tolerance)) return { right: true, exact: closeEnough(first, answer, 0), direction: null };
  const direction = values.length > 0 && values.every((v) => v > answer) ? 'high' : values.length > 0 && values.every((v) => v < answer) ? 'low' : null;
  return { right: false, exact: false, direction };
}

/**
 * Whether what was typed is wrong as the lesson's language reads it and right as it can also be
 * read ("1,250" for 1.25, from someone who writes a decimal comma). Grading it either way would be
 * a guess about the learner, so they are asked to type it unambiguously, and no attempt is used.
 */
export function needsRetyping(values: readonly number[], answer: number, tolerance: number): boolean {
  const first = values[0];
  if (first === undefined || closeEnough(first, answer, tolerance)) return false;
  return values.slice(1).some((v) => closeEnough(v, answer, tolerance));
}

// ---------------------------------------------------------------------------------------------
// Graded questions: single, order, numeric
// ---------------------------------------------------------------------------------------------

interface GradedParts {
  /** The one writer for the question's status region. */
  status: Status;
  earlier: HTMLElement;
  actions: HTMLElement;
  check: HTMLButtonElement;
  again: HTMLButtonElement;
  region: HTMLElement;
  explain: HTMLElement;
  answer: HTMLElement;
  explanation: HTMLElement;
}

function gradedParts(box: HTMLElement): GradedParts | null {
  const earlier = box.querySelector<HTMLElement>(':scope > [data-earlier]');
  const actions = box.querySelector<HTMLElement>(':scope > [data-actions]');
  const check = actions?.querySelector<HTMLButtonElement>('button[data-act="check"]');
  const again = actions?.querySelector<HTMLButtonElement>('button[data-act="again"]');
  const region = box.querySelector<HTMLElement>(':scope > [role="status"]');
  const explain = box.querySelector<HTMLElement>(':scope > [data-explain]');
  const answer = box.querySelector<HTMLElement>(':scope > details[data-answer]');
  const explanation = answer?.querySelector<HTMLElement>('[data-explanation]');
  if (!earlier || !actions || !check || !again || !region || !explain || !answer || !explanation) return null;
  return { status: createStatus(region), earlier, actions, check, again, region, explain, answer, explanation };
}

/** What one type of graded question supplies. */
interface Kind {
  /** Why the answer cannot be checked yet, in words for the learner, or null. Never costs an attempt. */
  blocked(tried: number): string | null;
  /** Grade what is there now. `detail` is said after the verdict. */
  grade(last: boolean): { right: boolean; detail: Node[] };
  /** A wrong first attempt: get ready for the second. */
  retry(): void;
  /** No attempts are left, or the answer was right: stop the controls and show the answer in place. */
  finish(right: boolean): void;
  /** Back to the start, for practice. Returns what should take focus. */
  reset(): HTMLElement;
}

function earlierLine(result: CheckpointResult | undefined): string | null {
  switch (result) {
    case 'correct':
      return 'Earlier result: right on your first attempt. Answering again is practice and does not change it.';
    case 'incorrect':
      return 'Earlier result: not right on your first attempt. Answering again is practice and does not change it.';
    case 'yes':
      return 'Earlier you rated your answer: got it.';
    case 'partly':
      return 'Earlier you rated your answer: partly.';
    case 'no':
      return 'Earlier you rated your answer: not yet.';
    default:
      return null;
  }
}

function showEarlier(el: HTMLElement, result: CheckpointResult | undefined): void {
  const text = earlierLine(result);
  el.replaceChildren(...(text === null ? [] : [words('span', text)]));
  el.hidden = text === null;
}

function graded(box: HTMLElement, parts: GradedParts, sceneId: string, api: PlayerApi, kind: Kind): void {
  const status = parts.status;
  const hint = box.querySelector<HTMLDetailsElement>(':scope > details.lt-hint');
  let tried = 0;
  let done = false;

  // The explanation moves to where it will be revealed: moved, not copied, because its source cards have ids.
  parts.explain.append(parts.explanation);
  shelve(parts.answer);
  parts.actions.hidden = false;
  showEarlier(parts.earlier, api.result(sceneId));
  box.classList.add('lt-ready');

  parts.check.addEventListener('click', () => {
    if (done) return;
    const stop = kind.blocked(tried);
    if (stop !== null) {
      status.say([words('p', stop)], 'warn');
      return;
    }
    const last = tried + 1 >= TRIES;
    const { right, detail } = kind.grade(last);
    tried += 1;
    // First attempt only. The shell keeps a graded result once it has one, so asking again changes nothing.
    if (tried === 1) api.recordResult(sceneId, right ? 'correct' : 'incorrect');
    const nodes: Node[] = [verdict(right), ...detail];
    if (right || last) {
      done = true;
      kind.finish(right);
      // The button keeps its place and its focus; it only stops doing anything.
      parts.check.setAttribute('aria-disabled', 'true');
      parts.again.hidden = false;
      parts.explain.hidden = false;
      parts.earlier.hidden = true;
      // The answer is on the page now, so a hint has nothing left to do.
      if (hint) hint.hidden = true;
      nodes.push(words('p', SAID.explained, 'lt-vh'));
    } else {
      kind.retry();
      nodes.push(words('p', SAID.oneMore));
    }
    status.say(nodes, right ? 'good' : 'bad');
  });

  parts.again.addEventListener('click', () => {
    tried = 0;
    done = false;
    status.clear();
    parts.explain.hidden = true;
    if (hint) {
      hint.open = false;
      hint.hidden = false;
    }
    parts.check.removeAttribute('aria-disabled');
    showEarlier(parts.earlier, api.result(sceneId));
    // Focus goes to where answering starts before the button it was on is taken away.
    kind.reset().focus();
    parts.again.hidden = true;
  });
}

function setupSingle(box: HTMLElement, q: SingleQuestion, sceneId: string, api: PlayerApi): void {
  const parts = gradedParts(box);
  const choices = Array.isArray(q.options) ? readChoices(box, q.options.length) : null;
  if (!parts || !choices) return;
  const feedback = readFeedback(parts.answer);
  const isCorrect = (index: number): boolean => q.options[index]?.correct === true;
  const tried = new Set<number>();
  let last: Choice | undefined;

  wakeChoices(choices);
  graded(box, parts, sceneId, api, {
    blocked: () => (pickedChoice(choices) ? null : SAID.chooseFirst),
    grade() {
      last = pickedChoice(choices);
      const index = last?.index ?? -1;
      tried.add(index);
      return { right: isCorrect(index), detail: [copyOf(feedback.get(index), 'lt-feedback-text')] };
    },
    retry() {
      if (!last) return;
      // The option that was wrong cannot be chosen a second time.
      setMark(last.label, 'wrong', SAID.markWrong);
      last.input.checked = false;
      last.input.disabled = true;
      delete last.label.dataset.picked;
    },
    finish: () => settleChoices(choices, isCorrect, tried),
    reset() {
      tried.clear();
      last = undefined;
      for (const c of choices) {
        setMark(c.label, null);
        c.input.disabled = false;
        c.input.checked = false;
        delete c.label.dataset.picked;
        delete c.label.dataset.locked;
      }
      return (choices[0] as Choice).input;
    },
  });
}

interface OrderItem {
  index: number;
  li: HTMLElement;
  name: string;
  moves: HTMLElement;
  up: HTMLButtonElement;
  down: HTMLButtonElement;
}

function setupOrder(box: HTMLElement, q: OrderQuestion, sceneId: string, api: PlayerApi): void {
  const parts = gradedParts(box);
  const list = box.querySelector<HTMLElement>(':scope > ol.lt-order');
  const solution = parts?.answer.querySelector<HTMLElement>('[data-solution]');
  if (!parts || !list || !solution || !Array.isArray(q.items)) return;
  const total = q.items.length;

  const start: OrderItem[] = [];
  const byRow = new Map<Element, OrderItem>();
  for (const li of Array.from(list.querySelectorAll<HTMLElement>(':scope > li[data-item]'))) {
    const index = Number(li.dataset.item);
    const moves = li.querySelector<HTMLElement>('[data-moves]');
    const up = li.querySelector<HTMLButtonElement>('button[data-move="up"]');
    const down = li.querySelector<HTMLButtonElement>('button[data-move="down"]');
    if (!moves || !up || !down || !Number.isInteger(index) || index < 0 || index >= total || start.some((item) => item.index === index)) return;
    const item: OrderItem = { index, li, name: (li.querySelector('.lt-order-text')?.textContent ?? '').trim(), moves, up, down };
    start.push(item);
    byRow.set(li, item);
  }
  if (start.length !== total || total < 2) return;

  const status = parts.status;
  const now = (): OrderItem[] => Array.from(list.children).flatMap((li) => byRow.get(li) ?? []);
  const key = (): string => now().map((item) => item.index).join(',');
  // Two items with the same words are interchangeable, so places are compared by text.
  const inPlace = (item: OrderItem, at: number): boolean => q.items[item.index] === q.items[at];
  let checked = key();
  let locked = false;

  const paint = (): void => {
    now().forEach((item, at) => {
      item.up.setAttribute('aria-disabled', at === 0 ? 'true' : 'false');
      item.down.setAttribute('aria-disabled', at === total - 1 ? 'true' : 'false');
    });
  };

  list.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-move]') : null;
    const item = button ? byRow.get(button.closest('li') as Element) : undefined;
    if (!button || !item || locked) return;
    const up = button.dataset.move === 'up';
    const other = up ? item.li.previousElementSibling : item.li.nextElementSibling;
    if (!other) {
      status.say([sentence(item.name, `is already ${up ? 'first' : 'last'}.`)]);
      return;
    }
    // The neighbour is the one lifted out and put back, so the row the learner is on never leaves
    // the page and its button keeps focus.
    if (up) item.li.after(other);
    else item.li.before(other);
    paint();
    status.say([sentence(item.name, `moved ${up ? 'up' : 'down'} to position ${now().indexOf(item) + 1} of ${total}.`)]);
  });

  box.querySelector<HTMLElement>(':scope > [data-how]')?.removeAttribute('hidden');
  for (const item of start) item.moves.hidden = false;
  paint();
  parts.explain.append(solution);

  graded(box, parts, sceneId, api, {
    blocked: (tried) => (key() !== checked ? null : tried === 0 ? SAID.moveFirst : SAID.moveAgain),
    grade(last) {
      checked = key();
      const placed = now().filter(inPlace).length;
      if (placed === total) return { right: true, detail: [] };
      const count = placed === 0 ? 'No item is in the right place yet.' : `${placed} of ${total} items ${placed === 1 ? 'is' : 'are'} in the right place.`;
      return { right: false, detail: last ? [words('p', count), words('p', SAID.orderBelow)] : [words('p', count)] };
    },
    retry() {},
    finish(right) {
      locked = true;
      for (const item of start) item.moves.hidden = true;
      solution.hidden = right;
      if (!right) now().forEach((item, at) => (inPlace(item, at) ? setMark(item.li, 'right', SAID.inPlace) : setMark(item.li, 'wrong', SAID.outOfPlace)));
    },
    reset() {
      locked = false;
      list.append(...start.map((item) => item.li));
      for (const item of start) {
        setMark(item.li, null);
        item.moves.hidden = false;
      }
      paint();
      checked = key();
      return (start[0] as OrderItem).down;
    },
  });
}

function setupNumeric(box: HTMLElement, q: NumericQuestion, sceneId: string, api: PlayerApi): void {
  const parts = gradedParts(box);
  const row = box.querySelector<HTMLElement>(':scope > .lt-numeric');
  const input = row?.querySelector<HTMLInputElement>('input.lt-number');
  const solution = parts?.answer.querySelector<HTMLElement>('[data-solution]');
  const tolerance = typeof q.tolerance === 'number' && q.tolerance > 0 ? q.tolerance : 0;
  if (!parts || !row || !input || !solution || typeof q.answer !== 'number' || !Number.isFinite(q.answer)) return;
  const unit = typeof q.unit === 'string' ? q.unit : undefined;
  const decimalMark = decimalMarkOf(document.documentElement.lang || 'en');
  let before: string | null = null;

  const read = (): number[] | null => readNumber(input.value, unit, decimalMark);
  const same = (values: readonly number[]): string => values.join('|');

  row.hidden = false;
  input.hidden = false;
  input.value = '';
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  input.addEventListener('keydown', (event) => {
    // There is no form around the field (the page's policy allows none to be submitted), so Enter is wired by hand.
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    parts.check.click();
  });
  parts.explain.append(solution);

  graded(box, parts, sceneId, api, {
    blocked() {
      if (input.value.trim() === '') return SAID.typeFirst;
      const values = read();
      if (!values) {
        input.setAttribute('aria-invalid', 'true');
        return SAID.notANumber;
      }
      if (before !== null && same(values) === before) return SAID.sameNumber;
      // Two readings, and only the less likely one is the answer: ask, rather than guess which was meant.
      if (needsRetyping(values, q.answer, tolerance)) return `That can be read as ${values.join(' or as ')}. ${SAID.twoReadings}`;
      return null;
    },
    grade() {
      const values = read() ?? [];
      before = same(values);
      const g = gradeNumber(values, q.answer, tolerance);
      if (g.right) {
        const answer = solution.querySelector('.lt-solution-value');
        return { right: true, detail: g.exact ? [] : [words('p', 'Close enough to count. The exact answer:'), copyOf(answer ?? undefined, 'lt-feedback-text')] };
      }
      return { right: false, detail: g.direction ? [words('p', g.direction === 'high' ? SAID.tooHigh : SAID.tooLow)] : [] };
    },
    retry() {},
    finish(right) {
      input.readOnly = true;
      solution.hidden = right;
      setMark(row, right ? 'right' : 'wrong', right ? SAID.markRight : SAID.markWrong);
    },
    reset() {
      before = null;
      input.readOnly = false;
      input.value = '';
      input.removeAttribute('aria-invalid');
      setMark(row, null);
      return input;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Reflect: write, compare with a model answer, rate yourself
// ---------------------------------------------------------------------------------------------

const RATING_WORDS = new Map<string, string>([
  ['yes', 'got it'],
  ['partly', 'partly'],
  ['no', 'not yet'],
]);

function setupReflect(box: HTMLElement, _q: ReflectQuestion, sceneId: string, api: PlayerApi): void {
  const earlier = box.querySelector<HTMLElement>(':scope > [data-earlier]');
  const write = box.querySelector<HTMLElement>(':scope > [data-write]');
  const text = write?.querySelector<HTMLTextAreaElement>('textarea');
  const actions = box.querySelector<HTMLElement>(':scope > [data-actions]');
  const reveal = actions?.querySelector<HTMLButtonElement>('button[data-act="reveal"]');
  const region = box.querySelector<HTMLElement>(':scope > [role="status"]');
  const explain = box.querySelector<HTMLElement>(':scope > [data-explain]');
  const rate = box.querySelector<HTMLElement>(':scope > [data-rate]');
  const answer = box.querySelector<HTMLElement>(':scope > details[data-answer]');
  const model = answer?.querySelector<HTMLElement>('[data-model]');
  const ratings = rate ? Array.from(rate.querySelectorAll<HTMLInputElement>('input[type="radio"]')) : [];
  if (!earlier || !write || !text || !actions || !reveal || !region || !explain || !rate || !answer || !model || ratings.length === 0) return;

  const status = createStatus(region);
  let asked = false;
  let shown = false;

  explain.append(model);
  shelve(answer);
  model.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((tick) => {
    tick.hidden = false;
    tick.autocomplete = 'off';
    tick.checked = false;
  });
  // What is typed here lives in this field and nowhere else: not stored, and not put back by the browser after a reload (the markup turns autocomplete off).
  text.value = '';
  write.hidden = false;
  actions.hidden = false;
  box.classList.add('lt-ready');

  const stored = api.result(sceneId);
  showEarlier(earlier, stored);
  for (const radio of ratings) {
    radio.autocomplete = 'off';
    radio.checked = radio.value === stored;
    radio.addEventListener('change', () => {
      if (!radio.checked || !RATING_WORDS.has(radio.value)) return;
      const kept = api.recordResult(sceneId, radio.value as CheckpointResult);
      earlier.hidden = true;
      status.say([words('p', `Rating kept: ${RATING_WORDS.get(kept) ?? kept}.`)]);
    });
  }

  reveal.addEventListener('click', () => {
    if (shown) return;
    // The model answer is feedback, so it waits for an attempt; but nobody is made to type, and a second press is enough.
    if (text.value.trim() === '' && !asked) {
      asked = true;
      status.say([words('p', SAID.writeFirst)], 'warn');
      return;
    }
    shown = true;
    explain.hidden = false;
    rate.hidden = false;
    reveal.setAttribute('aria-disabled', 'true');
    status.say([words('p', SAID.compare)]);
  });
}

// ---------------------------------------------------------------------------------------------

/** Make every question under `root` interactive. Called once at start-up. */
export function initQuestions(root: ParentNode, api: PlayerApi): void {
  const scenes = new Map<string, Scene>();
  for (const scene of api.lesson.scenes) if (!scenes.has(scene.id)) scenes.set(scene.id, scene);

  root.querySelectorAll<HTMLElement>('div.lt-question[data-question]').forEach((box) => {
    const sceneId = box.closest<HTMLElement>('section.lt-scene')?.dataset.scene;
    const scene = sceneId === undefined ? undefined : scenes.get(sceneId);
    if (sceneId === undefined || scene?.kind !== 'checkpoint') return;
    const q = scene.question;
    // The markup and the data must describe the same question, or nothing here can be trusted to match.
    if (typeof q !== 'object' || q === null || q.type !== box.dataset.question) return;
    switch (q.type) {
      case 'single':
        setupSingle(box, q, sceneId, api);
        break;
      case 'order':
        setupOrder(box, q, sceneId, api);
        break;
      case 'numeric':
        setupNumeric(box, q, sceneId, api);
        break;
      case 'reflect':
        setupReflect(box, q, sceneId, api);
        break;
    }
  });
}
