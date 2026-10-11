// One clip in the page: the stage, the caption strip, the prediction, the controls, and what a
// screen reader hears. Everything is a native control, and there are no single-key shortcuts
// (WCAG 2.1.4): the keys are the controls' own.
//
// The static clip (render/clip.ts) is already a complete account of the scene. This file builds
// the moving part above it and MOVES the static pieces into it, so each caption, chip and source
// card exists once:
//
//   div.lt-clip.lt-clip-live[data-clip][data-stage][data-state=poster|playing|paused|ended][data-arriving][data-asking][data-text]
//     div.st-band                              full-bleed (its margins are measured, not guessed)
//       div.st-stage                           click: play or pause
//         div.st-grain[aria-hidden]            the back plane: a still dot grid
//         div.st-view[aria-hidden]             the kit draws here; nothing in it is interactive
//         div.st-curtain[aria-hidden]          the wipe a clip arrives behind
//         p.lt-prov                            (moved) the provenance badge and the stage's chips
//         p.st-live[aria-hidden]               "Yours to change", while the learner explores
//         div.st-taps[role=group]              while a tap gate is open: one button over every part
//                                              of the stage that could be the answer, in reading order
//         button.st-bigplay                    "Play", until the clip has been started
//       div.lt-frame                           (moved; frame stages only) sliders, status, label
//       div.st-strip                           the caption strip
//         p.st-slate                           before the first caption: what is coming
//         ol.lt-beats                          (moved) one li per beat, stacked; one is on show
//         div.lt-explore.st-explore            (moved) "Your turn": the prompt, the sliders, the goal,
//                                              "Replay the clip". On show once the last beat has played.
//       p.lt-vh[role=status]                   beat changes, for someone who cannot see them
//
// [data-exploring] on the root while the stage is the learner's; [data-won] once the goal is reached.
//       div.st-controls[role=group]            previous, play, next, replay, scrubber, speed, step, voice
//     div.st-under                             on the page again, under the band
//       label.st-text                          "Show every caption as a list": the strip becomes the list it was
//       details.lt-reveal.st-about             the description and the parts, as text
import type { Predict } from '../../core/schema';
import type { PlayerApi } from '../main';
import { type Choice, SAID, copyOf, pickedChoice, readChoices, readFeedback, settleChoices, shelve, verdict, wakeChoices, words } from '../questions';
import { STEP_SAID } from '../steps';
import { Clip, type TimelineMaker } from './clip';
import { E, clamp, f2, h, s, setData, setO, setT } from './core';
import { type ExploreView, mountExplore } from './explore-panel';
import { frameBeatTimes } from '../frame/shared';
import { type TapTarget, makeStage } from './kit';
import { type Narration, attachNarration } from './narration';
import { type BeatData, type ClipData, captionText, compile } from './timeline';

export const CLIP_SAID = {
  controls: 'Clip controls',
  play: 'Play',
  pause: 'Pause',
  replay: 'Replay',
  again: 'Replay from the start',
  previous: 'Previous beat',
  next: 'Next beat',
  position: 'Position in clip',
  speed: 'Speed',
  step: 'Pause each beat',
  voice: 'Voice',
  text: 'Show every caption as a list',
  about: 'What this clip shows, in words',
  waiting: 'The clip is waiting for your prediction.',
  watch: 'Watch what happens',
  end: 'End of clip.',
  failed: 'This clip could not be drawn. Everything it shows is written out below.',
  /** A prediction answered on the picture. */
  tapGroup: 'Answer on the picture',
  tapWaiting: 'The clip is waiting for you to tap your answer on the picture.',
  tapWrong: 'not this one',
  tapRight: 'the answer',
  tapSkipped: 'Question skipped. The answer is marked on the picture.',
  /** Explore: the stage is the learner's. */
  live: 'Yours to change',
  yourTurn: 'Your turn.',
} as const;

export const SPEEDS = ['0.5', '1', '1.5', '2'] as const;
/** The stage width a still for paper is built at: the narrowest that still gets the wide layout. */
const STILL_WIDTH = 600;

const ICONS: Record<string, string> = {
  check: 'M4.5 10.5l3.6 3.6 7.4-8',
  play: 'M6.5 4.2v11.6L16 10z',
  pause: 'M5.5 4.5h3v11h-3zM11.5 4.5h3v11h-3z',
  replay: 'M10 4.2a5.8 5.8 0 1 0 5.6 4.3l-1.7.5A4.1 4.1 0 1 1 10 5.9v2.3l3.7-3.1L10 2z',
  prev: 'M5 4.5h2v11H5zM16 4.5v11L8 10z',
  next: 'M13 4.5h2v11h-2zM4 4.5v11l8-5.5z',
};
function icon(name: string, cls = ''): SVGElement {
  const svg = s('svg', { class: `lt-icon ${cls}`.trim(), viewBox: '0 0 20 20', width: 20, height: 20, 'aria-hidden': 'true', focusable: 'false' });
  svg.appendChild(s('path', { d: ICONS[name] as string, fill: 'currentColor' }));
  return svg;
}
function button(cls: string, iconName: string, label: string): HTMLButtonElement {
  const b = h('button', `st-btn ${cls}`);
  b.type = 'button';
  b.appendChild(icon(iconName));
  b.appendChild(words('span', label, 'lt-vh'));
  return b;
}
const clock = (ms: number): string => {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};
/** A caption as it is announced: its words, without the marks of inline markup. */
function spoken(beat: BeatData): string {
  return captionText(beat.caption)
    .replace(/\*\*|__|[*_`$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Settings every clip in the lesson shares: change one, and all follow. */
export interface ClipSettings {
  rate: string;
  step: boolean;
  voice: boolean;
  /** Whether the learner has asked for less motion (the system setting). */
  reduced: boolean;
  set(name: 'rate' | 'step' | 'voice', value: string | boolean): void;
  listen(fn: () => void): void;
}

export interface MountedClip {
  readonly id: string;
  readonly root: HTMLElement;
  readonly clip: Clip;
  /** The scene has come into view. `handover`: it follows another clip, so it arrives behind the wipe. */
  enter(handover: boolean): void;
  /** The scene has been left. */
  leave(): void;
  /** Start playing, as the Play button on the stage does, and put focus on the play control. */
  play(): void;
  /** One still per beat, for paper. Returns the element that holds them. */
  stills(): HTMLElement | null;
}

interface GateView {
  i: number;
  li: HTMLElement;
  data: Predict;
  choices: Choice[];
  feedback: Map<number, HTMLElement>;
  actions: HTMLElement;
  check: HTMLButtonElement;
  skip: HTMLButtonElement;
  result: HTMLElement;
  answered: boolean;
}

/** A prediction answered by tapping a part of the stage. */
interface PickView {
  i: number;
  li: HTMLElement;
  data: { prompt: string; pick: string[]; right: string; wrong: string };
  how: HTMLElement;
  actions: HTMLElement;
  check: HTMLButtonElement;
  skip: HTMLButtonElement;
  result: HTMLElement;
  rightText: HTMLElement | undefined;
  wrongText: HTMLElement | undefined;
  answered: boolean;
  /** Parts the learner tapped that were not the answer. */
  tried: Set<string>;
  /** Nothing that could be the answer was on the stage when the gate opened: it was passed over. */
  dead: boolean;
}

/** Reading order: top to bottom in rows, left to right within a row. */
function inReadingOrder(targets: readonly TapTarget[]): TapTarget[] {
  const sorted = [...targets].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: TapTarget[][] = [];
  for (const target of sorted) {
    const row = rows[rows.length - 1];
    const first = row?.[0];
    if (row && first && target.y + target.h / 2 - (first.y + first.h / 2) < Math.max(18, Math.min(first.h, target.h) * 0.6)) row.push(target);
    else rows.push([target]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

interface FrameLike {
  apply(t: number): void;
  destroy?(): void;
  still?(which: 'poster' | 'end'): void;
}

/** The timeline of a clip: compiled from its beats, or, for a custom frame, read from the beats' times. */
function makerFor(data: ClipData): TimelineMaker {
  if (data.stage.kind !== 'frame') return (env) => compile(data, env);
  return (env) => {
    const kit = makeStage(data.stage, { ...env, values: [], texts: new Map() }) as FrameLike;
    // A frame's beats are not compiled: each caption is up from its `at` to the next one's (frame/shared.ts).
    const { beats, duration } = frameBeatTimes(Number((data.stage as { duration?: number }).duration ?? 1), data.beats);
    return { beats, duration, apply: (t) => kit.apply(t), destroy: () => kit.destroy?.(), still: kit.still ? (which) => kit.still?.(which) : undefined };
  };
}

/** Bring one static clip to life. Throws when the clip cannot be built; the caller leaves the text version in place. */
export function mountClip(root: HTMLElement, data: ClipData, api: PlayerApi, settings: ClipSettings): MountedClip {
  const list = root.querySelector<HTMLElement>(':scope > ol.lt-beats');
  const items = list ? Array.from(list.querySelectorAll<HTMLElement>(':scope > li.lt-beat')) : [];
  if (!list || items.length !== data.beats.length) throw new Error('The clip and its page do not match.');
  const caps = items.map((li) => li.querySelector<HTMLElement>(':scope > .lt-cap'));
  const isFrame = data.stage.kind === 'frame';

  // ---------------------------------------------------------------------------------------- build
  const band = h('div', 'st-band');
  const stageBox = band.appendChild(h('div', 'st-stage'));
  stageBox.appendChild(h('div', 'st-grain')).setAttribute('aria-hidden', 'true');
  const view = stageBox.appendChild(h('div', 'st-view'));
  view.setAttribute('aria-hidden', 'true');
  const curtain = stageBox.appendChild(h('div', 'st-curtain'));
  curtain.setAttribute('aria-hidden', 'true');
  curtain.append(h('span'), h('span'));
  const prov = root.querySelector<HTMLElement>(':scope > .lt-prov');
  const bigPlay = h('button', 'st-bigplay');
  bigPlay.type = 'button';
  bigPlay.appendChild(icon('play'));
  bigPlay.appendChild(words('span', CLIP_SAID.play));

  const strip = band.appendChild(h('div', 'st-strip'));
  const slate = strip.appendChild(words('p', '', 'st-slate'));
  const live = band.appendChild(h('p', 'lt-vh'));
  live.setAttribute('role', 'status');

  const bar = band.appendChild(h('div', 'st-controls'));
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', CLIP_SAID.controls);
  if (!/^en(-|$)/i.test(document.documentElement.lang || 'en')) bar.lang = 'en';
  const transport = bar.appendChild(h('div', 'st-transport'));
  const bPrev = transport.appendChild(button('st-prev', 'prev', CLIP_SAID.previous));
  const bPlay = transport.appendChild(h('button', 'st-btn st-play'));
  bPlay.type = 'button';
  bPlay.appendChild(icon('play', 'st-i-play'));
  bPlay.appendChild(icon('pause', 'st-i-pause'));
  bPlay.appendChild(icon('replay', 'st-i-replay'));
  const playLabel = bPlay.appendChild(h('span', 'lt-vh', CLIP_SAID.play));
  const bNext = transport.appendChild(button('st-next', 'next', CLIP_SAID.next));
  const bAgain = transport.appendChild(button('st-again', 'replay', CLIP_SAID.again));

  const scrub = bar.appendChild(h('div', 'st-scrub'));
  const marks = scrub.appendChild(h('div', 'st-marks'));
  marks.setAttribute('aria-hidden', 'true');
  const fill = marks.appendChild(h('span', 'st-fill'));
  const range = scrub.appendChild(h('input', 'st-range'));
  range.type = 'range';
  range.setAttribute('aria-label', CLIP_SAID.position);
  range.min = '0';
  range.step = 'any';
  const where = bar.appendChild(h('p', 'st-where'));

  const opts = bar.appendChild(h('div', 'st-opts'));
  const speed = opts.appendChild(h('fieldset', 'st-speed'));
  speed.appendChild(h('legend', 'lt-vh', CLIP_SAID.speed));
  const speedName = `st-speed-${api.scene(data.id)?.index ?? 0}`;
  const speedInputs = SPEEDS.map((r) => {
    const lab = speed.appendChild(h('label', 'st-speed-option'));
    const inp = lab.appendChild(h('input'));
    inp.type = 'radio';
    inp.name = speedName;
    inp.value = r;
    lab.appendChild(h('span', '', `${r}×`));
    return inp;
  });
  const toggle = (cls: string, text: string): HTMLInputElement => {
    const lab = opts.appendChild(h('label', `st-toggle ${cls}`));
    const inp = lab.appendChild(h('input'));
    inp.type = 'checkbox';
    lab.appendChild(h('span', '', text));
    return inp;
  };
  const step = toggle('st-step', CLIP_SAID.step);
  const segments = caps.map((cap) => (cap?.dataset.voice === 'true' ? (cap.dataset.narration ?? null) : null));
  const hasVoice = segments.some((seg) => seg !== null);
  const voice = hasVoice ? toggle('st-voice', CLIP_SAID.voice) : null;

  // ---------------------------------------------------------------------------------------- clip
  /** Captions as a function of the instant drawn: one on show, the one before it fading for a moment. */
  const drawCaptions = (t: number, k: number, clip: Clip): void => {
    const cur = clip.beats[k];
    for (let i = 0; i < items.length; i++) {
      const li = items[i] as HTMLElement;
      const cap = caps[i];
      let o = 0;
      if (cur && i === k) o = clip.reduced ? 1 : E.out(clamp((t - cur.t0 - (k > 0 ? 90 : 0)) / 280, 0, 1));
      else if (cur && i === k - 1 && !clip.reduced) o = 1 - clamp((t - cur.t0) / 130, 0, 1);
      setData(li, 'on', o > 0.004 ? '1' : '0');
      if (!cap) continue;
      setO(cap, o);
      setT(cap, 0, i === k ? f2((1 - o) * 8) : 0);
    }
    setData(root, 'slate', k < 0 ? '1' : '0');
  };
  // What the window has left for the picture once the running head, the scene's heading, the badge
  // strip, the caption strip and the controls have their room: the whole clip fits one screen.
  const room = (): number => window.innerHeight - 396;
  // The stage is built before anything of the static clip is moved: a clip that cannot be built
  // throws here, and its text version is still whole and in place.
  root.insertBefore(band, root.firstChild);
  let clip: Clip;
  try {
    clip = new Clip(makerFor(data), view, { reduced: settings.reduced, maxHeight: room, draw: drawCaptions });
  } catch (error) {
    band.remove();
    throw error;
  }

  // The static pieces move into the band; what is left is folded away as the text version.
  if (prov) stageBox.appendChild(prov);
  // The stage's own word for "this is yours now", opposite the provenance badge (a narrow stage has no room for both: there the rim says it alone).
  const liveChip = stageBox.appendChild(words('p', CLIP_SAID.live, 'st-live'));
  liveChip.setAttribute('aria-hidden', 'true');
  // Over the picture, and not part of it: the buttons a tap gate lays on the parts of the stage.
  const taps = stageBox.appendChild(h('div', 'st-taps'));
  taps.setAttribute('role', 'group');
  taps.hidden = true;
  stageBox.appendChild(bigPlay);
  const frame = isFrame ? root.querySelector<HTMLElement>('.lt-frame') : null;
  if (frame) band.insertBefore(frame, strip);
  strip.appendChild(list);
  root.querySelector(':scope > .lt-beats-h')?.remove();
  const xpBox = isFrame ? null : root.querySelector<HTMLElement>(':scope > [data-explore]');
  if (xpBox) {
    xpBox.classList.add('st-explore');
    strip.appendChild(xpBox);
  }
  // Under the band, on the page again: the two ways to have the clip as text.
  const under = h('div', 'st-under');
  const textLabel = under.appendChild(h('label', 'st-toggle st-text'));
  const text = textLabel.appendChild(h('input'));
  text.type = 'checkbox';
  textLabel.appendChild(words('span', CLIP_SAID.text));
  const about = h('details', 'lt-reveal st-about');
  about.appendChild(words('summary', CLIP_SAID.about));
  const aboutBody = about.appendChild(h('div', 'lt-reveal-body'));
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(':scope > .lt-clip-desc, :scope > .lt-onstage'))) aboutBody.appendChild(el);
  under.appendChild(about);
  root.appendChild(under);
  root.classList.add('lt-clip-live');

  const narration: Narration | null = attachNarration(clip, document.getElementById('lt-audio') as HTMLAudioElement | null, segments);

  // ---------------------------------------------------------------------------------------- gates
  const gates = new Map<number, GateView>();
  data.beats.forEach((b, i) => {
    const li = items[i] as HTMLElement;
    const box = li.querySelector<HTMLElement>(':scope > [data-predict]');
    const gate = b.gate as Predict | undefined;
    if (!box || !gate || !Array.isArray(gate.options)) return;
    const choices = readChoices(box, gate.options.length);
    const actions = box.querySelector<HTMLElement>(':scope > [data-actions]');
    const check = actions?.querySelector<HTMLButtonElement>('button[data-act="check"]');
    const skip = actions?.querySelector<HTMLButtonElement>('button[data-act="skip"]');
    const result = box.querySelector<HTMLElement>(':scope > [data-outcome]');
    const answer = box.querySelector<HTMLElement>(':scope > details[data-answer]');
    if (!choices || !actions || !check || !skip || !result || !answer) return;
    const feedback = readFeedback(answer);
    wakeChoices(choices);
    shelve(answer);
    actions.hidden = false;
    result.setAttribute('role', 'status');
    box.classList.add('lt-steps-ready');
    gates.set(i, { i, li, data: gate, choices, feedback, actions, check, skip, result, answered: false });
  });
  // A prediction answered on the picture: the same panel, and a button over every part that could be meant.
  const picks = new Map<number, PickView>();
  data.beats.forEach((b, i) => {
    const li = items[i] as HTMLElement;
    const box = li.querySelector<HTMLElement>(':scope > [data-predict][data-pick]');
    const gate = b.gate as PickView['data'] | undefined;
    if (!box || !gate || !Array.isArray(gate.pick)) return;
    const how = box.querySelector<HTMLElement>(':scope > [data-how]');
    const actions = box.querySelector<HTMLElement>(':scope > [data-actions]');
    const check = actions?.querySelector<HTMLButtonElement>('button[data-act="check"]');
    const skip = actions?.querySelector<HTMLButtonElement>('button[data-act="skip"]');
    const result = box.querySelector<HTMLElement>(':scope > [data-outcome]');
    const answer = box.querySelector<HTMLElement>(':scope > details[data-answer]');
    if (!how || !actions || !check || !skip || !result || !answer) return;
    how.hidden = false;
    actions.hidden = false;
    // The answer stays in the page, hidden, as the key a printout shows; its two reasons are copied from it when they are earned.
    answer.hidden = true;
    result.setAttribute('role', 'status');
    box.classList.add('lt-steps-ready');
    picks.set(i, {
      i,
      li,
      data: gate,
      how,
      actions,
      check,
      skip,
      result,
      rightText: answer.querySelector<HTMLElement>('[data-right]') ?? undefined,
      wrongText: answer.querySelector<HTMLElement>('[data-wrong]') ?? undefined,
      answered: false,
      tried: new Set(),
      dead: false,
    });
  });
  const panelOf = (i: number): { li: HTMLElement } | undefined => {
    const pick = picks.get(i);
    return gates.get(i) ?? (pick && !pick.dead ? pick : undefined);
  };
  /** The gate whose feedback is on show after an answer, until the clip moves on. */
  let review = -1;
  let asking = -1;
  /** "Your turn": the panel that takes over when the clip has played, when the clip has one. */
  let xp: ExploreView | null = null;

  // ---------------------------------------------------------------------------------------- taps
  /** The pick gate whose buttons are on the stage, or null. */
  let tapping: PickView | null = null;
  const tapButtons = new Map<string, HTMLButtonElement>();
  const markTap = (b: HTMLButtonElement, state: 'right' | 'wrong'): void => {
    b.dataset.state = state;
    const said = b.querySelector('.st-tap-said');
    if (said) said.textContent = `, ${state === 'right' ? CLIP_SAID.tapRight : CLIP_SAID.tapWrong}`;
  };
  /** After an answer the buttons stay as marks: none of them does anything any more. */
  const settleTaps = (pick: PickView): void => {
    for (const [id, b] of tapButtons) {
      b.setAttribute('aria-disabled', 'true');
      if (pick.data.pick.includes(id)) markTap(b, 'right');
      else if (pick.tried.has(id)) markTap(b, 'wrong');
    }
  };
  const closeTaps = (): void => {
    tapping = null;
    tapButtons.clear();
    taps.replaceChildren();
    taps.hidden = true;
  };
  /** Lay a button over every part of the stage that could be the answer. False when none of the right parts is there to be tapped. */
  const openTaps = (pick: PickView): boolean => {
    closeTaps();
    const targets = inReadingOrder(clip.taps());
    if (!pick.data.pick.some((id) => targets.some((target) => target.id === id))) return false;
    tapping = pick;
    taps.setAttribute('aria-label', `${CLIP_SAID.tapGroup}: ${pick.data.prompt}`);
    // The layer covers the picture exactly, wherever the picture sits in the band.
    taps.style.setProperty('left', `${view.offsetLeft}px`);
    taps.style.setProperty('top', `${view.offsetTop}px`);
    taps.style.setProperty('width', `${view.clientWidth}px`);
    taps.style.setProperty('height', `${view.clientHeight}px`);
    for (const target of targets) {
      const b = taps.appendChild(h('button', 'st-tap'));
      b.type = 'button';
      b.dataset.part = target.id;
      b.style.setProperty('left', `${target.x}px`);
      b.style.setProperty('top', `${target.y}px`);
      b.style.setProperty('width', `${target.w}px`);
      b.style.setProperty('height', `${target.h}px`);
      b.appendChild(h('span', 'st-tap-mark')).setAttribute('aria-hidden', 'true');
      const name = b.appendChild(h('span', 'lt-vh', target.label));
      name.appendChild(words('span', '', 'st-tap-said'));
      tapButtons.set(target.id, b);
      b.addEventListener('click', () => tapped(pick, target.id, b));
    }
    taps.hidden = false;
    if (pick.answered) settleTaps(pick);
    else for (const id of pick.tried) {
      const b = tapButtons.get(id);
      if (!b) continue;
      markTap(b, 'wrong');
      b.setAttribute('aria-disabled', 'true');
    }
    return true;
  };
  const finishPick = (pick: PickView): void => {
    const hadFocus = taps.contains(document.activeElement) || pick.li.contains(document.activeElement);
    pick.answered = true;
    pick.skip.hidden = true;
    pick.how.hidden = true;
    pick.check.hidden = false;
    settleTaps(pick);
    clip.pass(pick.i);
    review = pick.i;
    drawMarks();
    sync();
    reveal();
    if (hadFocus) pick.check.focus({ preventScroll: true });
  };
  const tapped = (pick: PickView, id: string, b: HTMLButtonElement): void => {
    if (pick.answered || b.getAttribute('aria-disabled') === 'true') return;
    if (!pick.data.pick.includes(id)) {
      // A wrong tap is marked, told why, and left: every other part can still be tried.
      pick.tried.add(id);
      markTap(b, 'wrong');
      b.setAttribute('aria-disabled', 'true');
      pick.result.dataset.tone = 'bad';
      pick.result.replaceChildren(verdict(false), copyOf(pick.wrongText, 'lt-feedback-text'));
      reveal();
      return;
    }
    pick.result.dataset.tone = 'good';
    pick.result.replaceChildren(verdict(true, pick.tried.size ? SAID.correct : STEP_SAID.predicted), copyOf(pick.rightText, 'lt-feedback-text'));
    finishPick(pick);
  };

  // ---------------------------------------------------------------------------------------- sync
  const drawMarks = (): void => {
    range.max = String(Math.round(clip.end));
    marks.querySelectorAll('.st-mark').forEach((m) => m.remove());
    for (const b of clip.beats) {
      const m = marks.appendChild(h('span', b.gate ? 'st-mark st-mark-gate' : 'st-mark'));
      if (b.gate && clip.passed.has(b.i)) m.setAttribute('data-passed', 'true');
      m.style.setProperty('left', `${f2((100 * (b.gate ? clip.gateHold(b.i) : b.t0)) / clip.duration)}%`);
    }
    const n = clip.beats.length;
    const g = clip.beats.filter((b) => b.gate).length;
    slate.textContent = `${n} beats · ${clock(clip.duration - clip.poster)}${g ? ` · ${g === 1 ? 'one prediction' : `${g} predictions`}` : ''}`;
  };

  let liveTimer = 0;
  const say = (message: string): void => {
    window.clearTimeout(liveTimer);
    liveTimer = window.setTimeout(() => {
      live.textContent = message;
    }, 300);
  };

  let started = false;
  const sync = (): void => {
    const n = clip.beats.length;
    const k = clip.k;
    const end = clip.atEnd();
    range.value = String(Math.round(clip.t));
    range.setAttribute('aria-valuetext', k < 0 ? `Before beat 1 of ${n}` : `Beat ${k + 1} of ${n}, ${clock(clip.t)} of ${clock(clip.duration)}`);
    fill.style.setProperty('transform', `scaleX(${Math.round((1000 * clip.t) / clip.duration) / 1000})`);
    const busy = clip.playing && !clip.opening;
    const label = busy ? CLIP_SAID.pause : end ? CLIP_SAID.replay : CLIP_SAID.play;
    if (playLabel.textContent !== label) playLabel.textContent = label;
    const state = busy ? 'playing' : end ? 'ended' : started ? 'paused' : 'poster';
    if (root.dataset.state !== state) root.dataset.state = state;
    // While the establishing move is still to come or under way, Play is not shown over it.
    const arriving = !started && (clip.opening || clip.t < clip.poster - 1);
    if (arriving !== (root.dataset.arriving === 'true')) {
      if (arriving) root.dataset.arriving = 'true';
      else delete root.dataset.arriving;
    }
    bPrev.setAttribute('aria-disabled', String(clip.t <= clip.poster + 2));
    bNext.setAttribute('aria-disabled', String(clip.t >= clip.limit() - 2));
    const at = k < 0 ? `${n} beats` : `Beat ${k + 1} of ${n}`;
    if (where.textContent !== at) where.textContent = at;
    bigPlay.hidden = started;

    // The prediction panel: open while the clip stands at an unanswered prediction, and kept for
    // the feedback until the clip moves on.
    const g = clip.openGate();
    let want = g >= 0 && panelOf(g) && !clip.playing && clip.t >= clip.limit() - 1 ? g : -1;
    if (want < 0 && review >= 0 && !clip.playing && Math.abs(clip.t - clip.gateHold(review)) <= 1) want = review;
    if (want < 0) review = -1;
    if (want !== asking) {
      // A tap gate puts its buttons on the stage as it opens. With nothing there to tap, it is not asked at all.
      const pick = want >= 0 ? picks.get(want) : undefined;
      if (pick && !openTaps(pick)) {
        pick.dead = true;
        want = -1;
      } else if (!pick) closeTaps();
    }
    if (want !== asking) {
      if (asking >= 0) delete panelOf(asking)?.li.dataset.asking;
      asking = want;
      if (want >= 0) {
        (panelOf(want) as { li: HTMLElement }).li.dataset.asking = 'true';
        root.dataset.asking = 'true';
      } else delete root.dataset.asking;
    }

    // Explore: once the last beat has played and the clip rests there, the stage is the learner's.
    const exploring = xp !== null && end && !clip.playing && started;
    if (exploring !== (root.dataset.exploring === 'true')) {
      if (exploring) root.dataset.exploring = 'true';
      else delete root.dataset.exploring;
      xp?.turn(exploring);
      if (exploring && xp) {
        // However the end was reached (played to, or scrubbed to), the hand-over is said once and brought into view.
        say(`${CLIP_SAID.end} ${spoken(data.beats[data.beats.length - 1] as BeatData)} ${CLIP_SAID.yourTurn} ${xp.prompt}`);
        reveal('stage');
      }
    }
  };

  clip.on('time', sync);
  clip.on('state', () => {
    if (clip.playing && !clip.opening) started = true;
    sync();
  });
  clip.on('build', () => {
    drawMarks();
    // The parts have moved with the stage: a tap gate's buttons are laid again, and the learner's numbers drawn again.
    if (tapping) openTaps(tapping);
    xp?.nudge();
  });
  let lastSaid = -1;
  clip.on('beat', (k) => {
    if (k === lastSaid || k < 0 || !started) return;
    lastSaid = k;
    if (narration?.active()) return;
    say(`Beat ${k + 1} of ${clip.beats.length}. ${spoken(data.beats[k] as BeatData)}`);
  });
  clip.on('hold', () => {
    if (!clip.atEnd()) return;
    if (!xp) {
      say(`${CLIP_SAID.end} ${spoken(data.beats[data.beats.length - 1] as BeatData)}`);
      return;
    }
    // The hand-over has been said (see `sync`). As with a question, someone who played the clip to its
    // end from inside the band is taken to the first slider; a scrub to the end leaves focus on the scrubber.
    if (band.contains(document.activeElement) && document.activeElement !== document.body) xp.focus();
  });
  clip.on('gate', (i) => {
    started = true;
    sync();
    const gate = gates.get(i);
    const pick = picks.get(i);
    const byKeyboard = band.contains(document.activeElement) && document.activeElement !== document.body;
    if (!gate && pick && !pick.dead) {
      say(`${CLIP_SAID.tapWaiting} ${pick.data.prompt}`);
      reveal();
      if (byKeyboard) taps.querySelector<HTMLButtonElement>('button:not([aria-disabled="true"])')?.focus({ preventScroll: true });
      return;
    }
    if (!gate) {
      // The page has no question for this beat (or nothing on the stage to tap): do not leave the clip stuck behind it.
      clip.pass(i);
      drawMarks();
      clip.play();
      return;
    }
    say(`${CLIP_SAID.waiting} ${gate.data.prompt}`);
    reveal();
    // Someone operating the clip from the keyboard is taken to the question; a pointer user is left alone.
    if (byKeyboard) gate.choices[0]?.input.focus({ preventScroll: true });
  });

  /**
   * A question that has opened under the stage must not be below the fold: bring the end of the
   * band into view. `keep: "stage"`: when the band is taller than the window, keep its top instead,
   * so the picture and the first slider under it are on screen together.
   */
  const reveal = (keep: 'end' | 'stage' = 'end'): void => {
    window.requestAnimationFrame(() => {
      const box = band.getBoundingClientRect();
      if (box.bottom <= window.innerHeight && box.top >= 0) return;
      const tall = box.height > window.innerHeight;
      band.scrollIntoView({ block: tall ? (keep === 'stage' ? 'start' : 'end') : 'nearest', behavior: settings.reduced ? 'auto' : 'smooth' });
    });
  };
  for (const gate of gates.values()) {
    const isCorrect = (index: number): boolean => gate.data.options[index]?.correct === true;
    const resume = (): void => {
      const hadFocus = gate.li.contains(document.activeElement);
      review = -1;
      clip.play();
      if (hadFocus) bPlay.focus({ preventScroll: true });
    };
    gate.check.addEventListener('click', () => {
      if (gate.answered) {
        resume();
        return;
      }
      const picked = pickedChoice(gate.choices);
      if (!picked) {
        gate.result.dataset.tone = 'warn';
        gate.result.replaceChildren(words('p', STEP_SAID.chooseOrSkip));
        return;
      }
      const right = isCorrect(picked.index);
      settleChoices(gate.choices, isCorrect, new Set([picked.index]));
      gate.result.dataset.tone = right ? 'good' : 'bad';
      gate.result.replaceChildren(verdict(right, right ? STEP_SAID.predicted : SAID.notQuite), copyOf(gate.feedback.get(picked.index), 'lt-feedback-text'));
      gate.answered = true;
      gate.skip.hidden = true;
      gate.check.textContent = CLIP_SAID.watch;
      clip.pass(gate.i);
      review = gate.i;
      drawMarks();
      sync();
      reveal();
    });
    gate.skip.addEventListener('click', () => {
      if (gate.answered) return;
      settleChoices(gate.choices, isCorrect, new Set());
      gate.result.replaceChildren(words('p', STEP_SAID.skipped));
      gate.answered = true;
      gate.skip.hidden = true;
      gate.check.textContent = CLIP_SAID.watch;
      clip.pass(gate.i);
      drawMarks();
      resume();
    });
  }

  for (const pick of picks.values()) {
    pick.check.addEventListener('click', () => {
      if (!pick.answered) return;
      const hadFocus = pick.li.contains(document.activeElement);
      review = -1;
      clip.play();
      if (hadFocus) bPlay.focus({ preventScroll: true });
    });
    pick.skip.addEventListener('click', () => {
      if (pick.answered) return;
      pick.result.removeAttribute('data-tone');
      pick.result.replaceChildren(words('p', CLIP_SAID.tapSkipped), copyOf(pick.rightText, 'lt-feedback-text'));
      finishPick(pick);
    });
  }

  // ---------------------------------------------------------------------------------------- explore
  if (xpBox) {
    xp = mountExplore(xpBox, data, clip, settings, say, () => {
      root.dataset.won = 'true';
    });
    xp?.replay.addEventListener('click', () => {
      started = true;
      xp?.reset();
      clip.replay();
      bPlay.focus({ preventScroll: true });
    });
    // A panel that could not be woken stays as the text it was, under the stage with the rest of the text version.
    if (!xp) {
      xpBox.classList.remove('st-explore');
      root.insertBefore(xpBox, under);
    }
  }

  // ---------------------------------------------------------------------------------------- controls
  const startPlay = (): void => {
    started = true;
    if (clip.atEnd() && !clip.playing) {
      // Playing the clip again starts it as it was written: the sliders go back to where they began.
      xp?.reset();
      clip.replay();
    } else clip.toggle();
  };
  bPlay.addEventListener('click', startPlay);
  bigPlay.addEventListener('click', () => {
    started = true;
    clip.opening = false;
    if (clip.atEnd()) {
      xp?.reset();
      clip.replay();
    } else clip.play();
    bPlay.focus({ preventScroll: true });
  });
  stageBox.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button, a, .lt-prov, [popover]')) return;
    // While the stage is the learner's, or is asking to be tapped, a stray click on it is not "play again".
    if (root.dataset.exploring === 'true' || tapping) return;
    startPlay();
  });
  // Opening a source from the stage or from a caption stops the clip: the card is read with the picture held.
  band.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button.lt-chip') && clip.playing && !clip.opening) clip.pause();
  });
  bPrev.addEventListener('click', () => {
    if (bPrev.getAttribute('aria-disabled') !== 'true') clip.prev();
  });
  bNext.addEventListener('click', () => {
    if (bNext.getAttribute('aria-disabled') === 'true') return;
    started = true;
    clip.next();
  });
  bAgain.addEventListener('click', () => {
    started = true;
    xp?.reset();
    clip.replay();
  });

  let wasPlaying = false;
  range.addEventListener('pointerdown', () => {
    wasPlaying = clip.playing && !clip.opening;
    clip.pause();
  });
  range.addEventListener('input', () => {
    started = true;
    clip.seek(Number(range.value));
  });
  range.addEventListener('change', () => {
    if (!wasPlaying) return;
    wasPlaying = false;
    clip.play();
  });
  range.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // The same in every browser: arrows move a quarter of a second, Page Up and Page Down a beat, Home and End go to the ends.
    const stops = clip.stops();
    let to: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') to = clip.t + 250;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') to = clip.t - 250;
    else if (event.key === 'PageUp') to = stops.find((x) => x > clip.t + 2) ?? clip.t;
    else if (event.key === 'PageDown') {
      let p = 0;
      for (const x of stops) if (x < clip.t - 2) p = x;
      to = p;
    } else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = clip.duration;
    if (to === null) return;
    event.preventDefault();
    started = true;
    clip.pause();
    clip.seek(clamp(to, 0, clip.limit()));
  });

  for (const inp of speedInputs) {
    inp.addEventListener('change', () => {
      if (inp.checked) settings.set('rate', inp.value);
    });
  }
  step.addEventListener('change', () => settings.set('step', step.checked));
  voice?.addEventListener('change', () => settings.set('voice', voice.checked));
  text.addEventListener('change', () => {
    if (text.checked) root.dataset.text = 'true';
    else delete root.dataset.text;
  });

  const applySettings = (): void => {
    for (const inp of speedInputs) inp.checked = inp.value === settings.rate;
    clip.setRate(Number(settings.rate) || 1);
    step.checked = settings.step;
    clip.stepMode = settings.step;
    if (clip.reduced !== settings.reduced) {
      clip.reduced = settings.reduced;
      clip.render(clip.t);
    }
    if (voice) voice.checked = settings.voice;
    if (narration && narration.on !== settings.voice) void narration.setOn(settings.voice);
  };
  settings.listen(applySettings);
  applySettings();

  // ---------------------------------------------------------------------------------------- size
  /** The band runs the full width of the window: its margins are the distance from the clip to each edge. */
  const bleed = (): void => {
    const box = root.getBoundingClientRect();
    if (box.width === 0) return;
    const full = document.documentElement.clientWidth;
    band.style.setProperty('margin-left', `${f2(-box.left)}px`);
    band.style.setProperty('margin-right', `${f2(box.right - full)}px`);
  };
  let width = 0;
  let height = 0;
  const fit = (): void => {
    bleed();
    const w = view.clientWidth;
    if (w === 0) return;
    const hh = window.innerHeight;
    if (Math.abs(w - width) < 2 && Math.abs(hh - height) < 40) return;
    width = w;
    height = hh;
    clip.build();
    sync();
  };
  bleed();
  width = view.clientWidth;
  height = window.innerHeight;
  if (width > 0 && Math.abs(width - clip.W) >= 2) clip.build();
  drawMarks();
  sync();
  new ResizeObserver(fit).observe(root);
  window.addEventListener('resize', fit);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => clip.build());
  new MutationObserver(() => clip.build()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // For tests and measurements: the clip behind this element. Nothing in the page reads it.
  (root as HTMLElement & { ltClip?: Clip }).ltClip = clip;

  let wipe = 0;
  return {
    id: data.id,
    root,
    clip,
    enter(handover) {
      fit();
      window.clearTimeout(wipe);
      if (clip.t > 0 || clip.playing) return;
      if (settings.reduced || !handover) {
        clip.open();
        return;
      }
      // The designed hand-over: the stage arrives behind a wipe, and its parts arrive as the wipe clears.
      stageBox.classList.remove('st-enter');
      void stageBox.offsetWidth;
      stageBox.classList.add('st-enter');
      wipe = window.setTimeout(() => clip.open(), 240);
    },
    leave() {
      window.clearTimeout(wipe);
      stageBox.classList.remove('st-enter');
      if (clip.playing && clip.opening) {
        clip.pause();
        clip.render(clip.poster);
      } else clip.pause();
      narration?.stop();
    },
    play() {
      bigPlay.click();
    },
    stills() {
      if (isFrame) return null;
      const box = h('div', 'st-stills');
      data.beats.forEach((_, i) => {
        const fig = box.appendChild(h('div', 'st-still'));
        const stillView = fig.appendChild(h('div', 'st-view st-paper'));
        // Built for one fixed width, in the wide layout, and scaled to the paper by the stylesheet.
        stillView.style.setProperty('width', `${STILL_WIDTH}px`);
        fig.appendChild(h('p', 'st-still-n', String(i + 1)));
        band.appendChild(box);
        const still = new Clip((env) => compile(data, env), stillView, { reduced: true, width: STILL_WIDTH });
        still.render((still.beats[i]?.t1 ?? 1) - 1);
      });
      band.appendChild(box);
      return box;
    },
  };
}
