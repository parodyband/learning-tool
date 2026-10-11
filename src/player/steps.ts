// Step-through scenes: one step at a time, with the figure's highlight and the state panel
// following along.
//
// The markup is already complete (src/render/steps.ts): every step is in the page in order. This
// file hides all but one, and wires the controls the renderer left hidden.
//
//   - Previous and Next sit before the steps in the document, so the step that a press brings up
//     is the next thing read after the button. Focus stays on the button; the Left and Right arrow
//     keys do the same while focus is on either one.
//   - The scene has one role="status" element, beside those buttons. Its visible text is the
//     counter ("Step 3 of 5"). What else there is to say (the step's title, the values that
//     changed, how a prediction went) is added to the same element, visually hidden when the same
//     words are already on screen somewhere else.
//   - A step with a predict question keeps its text, its highlight and its values back until the
//     learner answers or chooses to skip. Until then the figure and the panel stay as the step
//     before left them, which is the state the learner is predicting from, and Next waits.
//   - The panel under the buttons shows the values as they are now. A value the step on show
//     changed carries the words the renderer wrote for it ("was 0"), so the change never depends
//     on colour.
//   - The place reached is kept under `step.<sceneId>` (two numbers and the scene's digest, checked
//     when read back: a place kept for an earlier version of the scene is not this scene's).
import type { Predict, Scene } from '../core/schema';
import { setHighlight } from './figures';
import { EVENTS, type PlayerApi, type SceneChangeDetail } from './main';
import { type Choice, SAID, type Status, copyOf, createStatus, pickedChoice, readChoices, readFeedback, settleChoices, shelve, verdict, wakeChoices, words } from './questions';

export const STEP_SAID = {
  questionFirst: 'A question comes first. Answer it, or skip it, to see this step.',
  answerToGoOn: 'Answer the question, or skip it, to go on.',
  first: 'This is the first step.',
  last: 'This is the last step. Continue is further down.',
  chooseOrSkip: 'Choose an answer first, or skip the question.',
  predicted: 'Your prediction was right.',
  skipped: 'Question skipped. The answer is marked.',
  earlier: 'You answered or skipped this question earlier. The answer is marked.',
  shown: 'The step is shown below.',
} as const;

interface PredictView {
  data: Predict;
  choices: Choice[];
  feedback: Map<number, HTMLElement>;
  actions: HTMLElement;
  check: HTMLButtonElement;
  skip: HTMLButtonElement;
  result: HTMLElement;
  /** The no-script answer the feedback is read from. */
  answer: HTMLElement;
}

interface StepView {
  /** 1-based. */
  n: number;
  li: HTMLElement;
  body: HTMLElement;
  title: string;
  highlight: string[];
  /** The step's own list of values, when it has one. */
  state: HTMLElement | null;
  predict: PredictView | null;
}

function readPredict(li: HTMLElement, data: Predict | undefined): PredictView | null | undefined {
  const el = li.querySelector<HTMLElement>(':scope > [data-predict]');
  if (!el && !data) return null;
  // One without the other means the page and its data disagree.
  if (!el || !data || !Array.isArray(data.options)) return undefined;
  const choices = readChoices(el, data.options.length);
  const actions = el.querySelector<HTMLElement>(':scope > [data-actions]');
  const check = actions?.querySelector<HTMLButtonElement>('button[data-act="check"]');
  const skip = actions?.querySelector<HTMLButtonElement>('button[data-act="skip"]');
  const result = el.querySelector<HTMLElement>(':scope > [data-outcome]');
  const answer = el.querySelector<HTMLElement>(':scope > details[data-answer]');
  if (!choices || !actions || !check || !skip || !result || !answer) return undefined;
  return { data, choices, feedback: readFeedback(answer), actions, check, skip, result, answer };
}

const isPlace = (v: unknown): v is [number, number, string] => Array.isArray(v) && v.length === 3 && Number.isInteger(v[0]) && Number.isInteger(v[1]) && typeof v[2] === 'string';

function setupSteps(box: HTMLElement, scene: Scene | undefined, api: PlayerApi): void {
  const sceneId = box.dataset.steps ?? '';
  const info = api.scene(sceneId);
  const nav = box.querySelector<HTMLElement>(':scope > [data-step-nav]');
  const prev = nav?.querySelector<HTMLButtonElement>('button[data-step-go="prev"]');
  const next = nav?.querySelector<HTMLButtonElement>('button[data-step-go="next"]');
  const region = nav?.querySelector<HTMLElement>('[role="status"]');
  const panel = box.querySelector<HTMLElement>(':scope > [data-state-panel]');
  const panelList = panel?.querySelector<HTMLElement>('dl');
  if (!info || scene?.kind !== 'step_through' || !Array.isArray(scene.steps) || !nav || !prev || !next || !region || !panel || !panelList) return;

  const rows = Array.from(box.querySelectorAll<HTMLElement>(':scope > ol.lt-step-list > li.lt-step[data-step]'));
  const total = scene.steps.length;
  if (rows.length !== total || total === 0) return;
  const views: StepView[] = [];
  for (const [i, li] of rows.entries()) {
    const body = li.querySelector<HTMLElement>(':scope > [data-step-body]');
    const predict = readPredict(li, scene.steps[i]?.predict);
    if (Number(li.dataset.step) !== i + 1 || !body || predict === undefined) return;
    views.push({
      n: i + 1,
      li,
      body,
      title: (li.querySelector('.lt-step-name')?.textContent ?? '').trim(),
      highlight: (li.dataset.highlight ?? '').split(' ').filter(Boolean),
      state: body.querySelector<HTMLElement>(':scope > [data-state] > dl'),
      predict,
    });
  }

  const figure = info.section.querySelector('.lt-figure');
  const status: Status = createStatus(region);
  const storeName = /^[a-z][a-z0-9_-]{0,31}$/.test(sceneId) ? `step.${sceneId}` : null;

  /** The step on show, and the last step whose text has been shown. A predict is still open while its step is past `seen`. */
  let at = 1;
  let seen = 0;
  const view = (n: number): StepView => views[n - 1] as StepView;
  const waiting = (n: number): boolean => view(n).predict !== null && n > seen;

  const stored = storeName ? api.store.get(storeName, isPlace) : undefined;
  // A place is about these steps as they are now. After the scene has been rewritten and published
  // again, "seen up to step 3" would mark a prediction the learner never met as answered.
  if (stored && stored[2] === info.rev && stored[0] >= 1 && stored[0] <= total && stored[1] >= stored[0] - 1 && stored[1] <= total) [at, seen] = stored;

  const counter = (): HTMLElement => words('span', `Step ${at} of ${total}`, 'lt-step-at');

  const paint = (): void => {
    const held = waiting(at);
    if (!held) seen = Math.max(seen, at);
    for (const v of views) v.li.hidden = v.n !== at;
    view(at).body.hidden = held;
    prev.setAttribute('aria-disabled', at === 1 ? 'true' : 'false');
    next.setAttribute('aria-disabled', at === total || held ? 'true' : 'false');

    // While a prediction is open, the figure and the values are those of the step before.
    const upTo = held ? at - 1 : at;
    if (figure) setHighlight(figure, upTo >= 1 ? view(upTo).highlight : []);
    let source: StepView | undefined;
    for (let k = upTo; k >= 1 && !source; k--) if (view(k).state) source = view(k);
    panel.hidden = !source;
    if (source?.state) {
      // "was 0" belongs to the step that made the change. Carried into a later step the values are simply the values.
      const fresh = source.n === at;
      panelList.replaceChildren(
        ...Array.from(source.state.children).map((row) => {
          const copy = row.cloneNode(true) as HTMLElement;
          if (!fresh) {
            copy.removeAttribute('data-changed');
            copy.querySelector('.lt-state-flag')?.remove();
          }
          return copy;
        }),
      );
    }
  };

  /** Keep the place. Only ever after the learner has done something here: opening a lesson stores nothing. */
  const keep = (): void => {
    if (storeName) api.store.set(storeName, [at, seen, info.rev]);
  };

  /** Tell the narration which step can be read: none while a prediction is open, because its step's text must not be read out before the answer. */
  const narrate = (): void => api.stepChanged(sceneId, waiting(at) ? null : at);

  const changedValues = (v: StepView): string =>
    Array.from(v.state?.querySelectorAll('.lt-state-row[data-changed]') ?? [])
      .map((row) => `${row.querySelector('dt')?.textContent ?? ''} ${row.querySelector('.lt-state-value')?.textContent ?? ''}`.trim())
      .join(', ');

  /** Say where the learner is. `note` is shown; the rest is for someone who cannot see the step change. */
  const announce = (note?: string): void => {
    const v = view(at);
    const quiet = document.createElement('span');
    quiet.className = 'lt-vh';
    if (v.title) quiet.append(`: ${v.title}${/[.!?:;…]$/.test(v.title) ? '' : '.'} `);
    else quiet.append('. ');
    if (!note) {
      const changed = waiting(at) ? '' : changedValues(v);
      if (waiting(at)) quiet.append(words('span', STEP_SAID.questionFirst));
      else if (changed) quiet.append(words('span', 'Changed: '), `${changed}.`);
    }
    status.say(note ? [counter(), quiet, words('span', note, 'lt-step-note')] : [counter(), quiet]);
  };

  const go = (to: number): void => {
    if (to < 1) {
      announce(STEP_SAID.first);
    } else if (to > at && waiting(at)) {
      announce(STEP_SAID.answerToGoOn);
    } else if (to > total) {
      announce(STEP_SAID.last);
    } else {
      at = to;
      paint();
      keep();
      // A finished prediction keeps the button that was pressed only while focus is on it.
      for (const v of views) if (v.predict && !waiting(v.n) && !v.predict.actions.contains(document.activeElement)) v.predict.actions.hidden = true;
      announce();
      narrate();
    }
  };

  prev.addEventListener('click', () => go(at - 1));
  next.addEventListener('click', () => go(at + 1));
  nav.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target !== prev && event.target !== next) return;
    if (event.key === 'ArrowLeft') go(at - 1);
    else if (event.key === 'ArrowRight') go(at + 1);
    else return;
    event.preventDefault();
  });

  for (const v of views) {
    const p = v.predict;
    if (!p) continue;
    const isCorrect = (index: number): boolean => p.data.options[index]?.correct === true;
    wakeChoices(p.choices);
    shelve(p.answer);
    if (v.n <= seen) {
      // Reached on an earlier visit. Which option was chosen then is not kept, so only the answer is marked.
      settleChoices(p.choices, isCorrect, new Set());
      p.result.replaceChildren(words('p', STEP_SAID.earlier));
      continue;
    }
    p.actions.hidden = false;

    const settle = (picked: Choice | null, pressed: HTMLButtonElement, other: HTMLButtonElement): void => {
      if (!waiting(v.n)) return;
      const right = picked !== null && isCorrect(picked.index);
      const outcome = picked ? (right ? STEP_SAID.predicted : SAID.notQuite) : STEP_SAID.skipped;
      const why = picked ? p.feedback.get(picked.index) : undefined;
      settleChoices(p.choices, isCorrect, new Set(picked ? [picked.index] : []));
      if (picked) p.result.dataset.tone = right ? 'good' : 'bad';
      else delete p.result.dataset.tone;
      p.result.replaceChildren(...(picked ? [verdict(right, outcome), copyOf(why, 'lt-feedback-text')] : [words('p', outcome)]));
      pressed.setAttribute('aria-disabled', 'true');
      other.hidden = true;
      seen = Math.max(seen, v.n);
      paint();
      keep();
      narrate();
      // The same words, through the scene's one status region, for someone who cannot see them appear.
      const quiet = document.createElement('span');
      quiet.className = 'lt-vh';
      quiet.append('. ', words('span', outcome), ' ');
      if (why) quiet.append(copyOf(why, 'lt-feedback-text', 'span'), ' ');
      quiet.append(words('span', STEP_SAID.shown));
      status.say([counter(), quiet]);
    };

    p.check.addEventListener('click', () => {
      if (!waiting(v.n)) return;
      const picked = pickedChoice(p.choices);
      if (picked) {
        settle(picked, p.check, p.skip);
        return;
      }
      p.result.dataset.tone = 'warn';
      p.result.replaceChildren(words('p', STEP_SAID.chooseOrSkip));
      const quiet = words('span', `. ${STEP_SAID.chooseOrSkip}`, 'lt-vh');
      status.say([counter(), quiet]);
    });
    p.skip.addEventListener('click', () => settle(null, p.skip, p.check));
  }

  // Entering the scene, the narration assumes the first step. Tell it otherwise when that is not so.
  document.addEventListener(EVENTS.scene, (event) => {
    if ((event as CustomEvent<SceneChangeDetail>).detail.scene.id !== sceneId) return;
    if (at !== 1 || waiting(at)) narrate();
  });

  nav.hidden = false;
  box.classList.add('lt-steps-ready');
  paint();
  // Filled in while the scene is still off screen, so it is there to read but is not announced.
  region.replaceChildren(counter());
}

/** Turn every step-through under `root` into one step at a time. Called once at start-up. */
export function initSteps(root: ParentNode, api: PlayerApi): void {
  const scenes = new Map<string, Scene>();
  for (const scene of api.lesson.scenes) if (!scenes.has(scene.id)) scenes.set(scene.id, scene);
  root.querySelectorAll<HTMLElement>('div.lt-steps[data-steps]').forEach((box) => setupSteps(box, scenes.get(box.dataset.steps ?? ''), api));
}
