// "Your turn": the panel under the stage once a clip has played, and the loop that keeps the
// picture following the sliders.
//
// The static clip (render/clip.ts) already carries the whole panel as text: the prompt, each
// slider's label, start and range, the goal, and what reaching it shows. This file wakes it:
//
//   div.lt-explore.st-explore[data-explore]
//     p.lt-explore-head                          "Your turn" and the prompt
//     div.lt-xp-controls
//       div.lt-xp-control[data-control][data-active]
//         label.lt-xp-label[for]                 the slider's name
//         span.st-xp-out[aria-hidden]            (added) its value and unit, large; the input says the same in aria-valuetext
//         div.st-xp-slide                        (added) the track, its filled part, and the native range input over them
//           input.lt-xp-range[type=range]        unhidden; `--xp-at` on the slide is how far along it stands (0..1)
//         span.lt-xp-bounds                      the two ends of its range
//     div.lt-xp-goal[data-goal][data-reached]
//       svg.st-xp-mark                           (added) a ring that a tick is drawn into when the goal is reached
//       p.lt-xp-goal-text                        "Goal" (then "Goal reached") and the goal
//       div.st-xp-done                           (added, hidden until reached) why it worked
//     p.lt-actions                               "Replay the clip"
//
// EASING. A slider's value is where the learner put it; the value that is DRAWN closes most of the
// distance to it with every frame. The stage is asked for the picture of the drawn values, so the
// picture is always "what the stage looks like with these control values" and nothing on it
// remembers the last frame. With reduced motion the drawn values are the slider's at once.
import { tappableParts } from './tappable';
import { copyOf } from '../questions';
import type { Clip } from './clip';
import { clamp, h, s } from './core';
import { type ControlData, Explorer, decimalsOf, format, snap } from './explore';
import type { ClipData } from './timeline';

export interface ExploreView {
  readonly prompt: string;
  readonly replay: HTMLButtonElement;
  /** The stage has been handed to the learner (true) or taken back by the clip (false). */
  turn(on: boolean): void;
  /** Every slider back to where it starts, and the clip's own picture back on the stage. */
  reset(): void;
  /** Draw again: the stage was rebuilt under the panel. */
  nudge(): void;
  focus(): void;
}

interface ControlView {
  data: ControlData;
  row: HTMLElement;
  input: HTMLInputElement;
  out: HTMLElement;
  slide: HTMLElement;
  dp: number;
}

/** What the panel says. Interface words. */
export const EXPLORE_SAID = { reached: 'Goal reached', now: 'Now:' } as const;

/** What each bound part is called, and its unit: for telling someone who cannot see the stage what their slider did. */
function namesOf(data: ClipData): Map<string, { label: string; unit: string }> {
  const out = new Map<string, { label: string; unit: string }>();
  const stage = data.stage as unknown as Record<string, unknown>;
  const each = (v: unknown, unit: string): void => {
    for (const p of Array.isArray(v) ? (v as { id?: unknown; label?: unknown; unit?: unknown }[]) : []) {
      if (typeof p.id === 'string') out.set(p.id, { label: typeof p.label === 'string' ? p.label : p.id, unit: typeof p.unit === 'string' ? p.unit : unit });
    }
  };
  each(stage.stats, '');
  each(stage.values, '');
  each(stage.bars, typeof stage.unit === 'string' ? stage.unit : '');
  for (const part of tappableParts(data as never)) if (part.kind === 'group') out.set(part.id, { label: part.label, unit: '' });
  return out;
}

/**
 * Wake the panel. Returns null when the page's panel does not match the clip (the static text
 * stays where it is, readable).
 */
export function mountExplore(box: HTMLElement, data: ClipData, clip: Clip, settings: { reduced: boolean }, say: (message: string) => void, won: () => void): ExploreView | null {
  if (!data.explore) return null;
  let explorer: Explorer;
  try {
    explorer = new Explorer(data.explore);
  } catch {
    return null;
  }
  const rows = Array.from(box.querySelectorAll<HTMLElement>('[data-control]'));
  const actions = box.querySelector<HTMLElement>(':scope > [data-actions]');
  const replay = actions?.querySelector<HTMLButtonElement>('button[data-act="replay"]');
  if (!actions || !replay) return null;
  const found = explorer.controls.map((c) => {
    const row = rows.find((el) => el.dataset.control === c.id);
    return { c, row, input: row?.querySelector<HTMLInputElement>('input[type="range"]'), label: row?.querySelector<HTMLElement>('label') };
  });
  if (found.some((f) => !f.row || !f.input || !f.label)) return null;

  const target: Record<string, number> = { ...explorer.start };
  const shown: Record<string, number> = { ...explorer.start };
  const views: ControlView[] = found.map(({ c, row, input, label }) => {
    const r = row as HTMLElement;
    const inp = input as HTMLInputElement;
    const out = h('span', 'st-xp-out');
    out.setAttribute('aria-hidden', 'true');
    (label as HTMLElement).after(out);
    const slide = h('div', 'st-xp-slide');
    inp.replaceWith(slide);
    slide.appendChild(h('span', 'st-xp-track')).appendChild(h('span', 'st-xp-fill'));
    slide.appendChild(h('span', 'st-xp-halo'));
    slide.appendChild(inp);
    inp.hidden = false;
    return { data: c, row: r, input: inp, out, slide, dp: Math.max(decimalsOf(c.step), decimalsOf(c.min)) };
  });
  const show = (v: ControlView): void => {
    const value = target[v.data.id] as number;
    const text = `${format(value, v.dp)}${v.data.unit ?? ''}`;
    v.out.textContent = text;
    v.input.setAttribute('aria-valuetext', text);
    v.slide.style.setProperty('--xp-at', String(Math.round((1000 * (value - v.data.min)) / (v.data.max - v.data.min)) / 1000));
  };

  // ---- the goal
  const goalBox = box.querySelector<HTMLElement>(':scope > [data-goal]');
  const answer = goalBox?.querySelector<HTMLElement>('details[data-answer]');
  const kicker = goalBox?.querySelector<HTMLElement>('.lt-xp-goal-kicker');
  let done: HTMLElement | null = null;
  if (goalBox && answer) {
    const mark = s('svg', { class: 'st-xp-mark', viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': 'true', focusable: 'false' });
    mark.appendChild(s('circle', { class: 'st-xp-ring', cx: 12, cy: 12, r: 9.5 }));
    mark.appendChild(s('path', { class: 'st-xp-tick', d: 'M7.2 12.4l3.2 3.2 6.4-7', pathLength: 1 }));
    goalBox.insertBefore(mark, goalBox.firstChild);
    done = h('div', 'st-xp-done');
    done.appendChild(copyOf(answer.querySelector('[data-done]') ?? undefined, 'st-xp-done-text'));
    done.hidden = true;
    goalBox.appendChild(done);
    // The disclosure stays in the page, hidden, as the key a printout shows.
    answer.hidden = true;
  }
  if (!goalBox) box.dataset.solo = 'true';
  let reached = false;
  /** Mark the goal reached if its condition holds for the first time. True when it has just happened. */
  const check = (): boolean => {
    if (reached || !goalBox || !explorer.reached(target)) return false;
    reached = true;
    goalBox.dataset.reached = 'true';
    if (kicker) kicker.textContent = EXPLORE_SAID.reached;
    if (done) done.hidden = false;
    won();
    say(`${EXPLORE_SAID.reached}. ${done?.textContent ?? ''}`);
    return true;
  };

  // ---- what the sliders did, in words, for someone who cannot see the stage
  const names = namesOf(data);
  let telling = 0;
  const tell = (): void => {
    window.clearTimeout(telling);
    if (!explorer.binds.length) return;
    telling = window.setTimeout(() => {
      const values = explorer.values(target);
      const parts = explorer.binds.map((b) => `${names.get(b.target)?.label ?? b.target} ${values.get(b.target)?.s ?? ''}${names.get(b.target)?.unit ?? ''}`);
      say(`${EXPLORE_SAID.now} ${parts.join(', ')}.`);
    }, 900);
  };

  // ---- the loop: the drawn values follow the sliders, and the stage draws the drawn values
  let on = false;
  let raf = 0;
  let last = -1;
  const tick = (now: number): void => {
    raf = 0;
    if (!on) return;
    const dt = last < 0 ? 16 : clamp(now - last, 0, 64);
    last = now;
    const k = settings.reduced ? 1 : 1 - Math.exp(-dt / 55);
    let settled = true;
    for (const v of views) {
      const id = v.data.id;
      const d = (target[id] as number) - (shown[id] as number);
      if (k >= 1 || Math.abs(d) <= (v.data.max - v.data.min) * 4e-4) shown[id] = target[id] as number;
      else {
        shown[id] = (shown[id] as number) + d * k;
        settled = false;
      }
    }
    clip.live = explorer.state({ ...shown }, now, settings.reduced);
    clip.render(clip.t);
    if (!settled || clip.busy()) raf = window.requestAnimationFrame(tick);
    else last = -1;
  };
  const kick = (): void => {
    if (on && !raf) raf = window.requestAnimationFrame(tick);
  };

  for (const v of views) {
    show(v);
    v.input.addEventListener('input', () => {
      target[v.data.id] = snap(v.data, Number(v.input.value));
      show(v);
      // The move that reaches the goal is answered by the goal alone: it is heard before any numbers are.
      if (check()) window.clearTimeout(telling);
      else tell();
      kick();
    });
    // While a slider is held, the panel and the stage both show it: the two are one instrument.
    const hold = (held: boolean): void => {
      if (held) {
        v.row.dataset.active = 'true';
        box.dataset.active = 'true';
      } else {
        delete v.row.dataset.active;
        delete box.dataset.active;
      }
    };
    v.input.addEventListener('pointerdown', () => hold(true));
    for (const name of ['pointerup', 'pointercancel', 'blur'] as const) v.input.addEventListener(name, () => hold(false));
  }
  actions.hidden = false;

  return {
    prompt: data.explore.prompt,
    replay,
    turn(now) {
      on = now;
      if (!on) {
        // The clip has the stage again: nothing more is said about the sliders.
        window.clearTimeout(telling);
        window.cancelAnimationFrame(raf);
        raf = 0;
        last = -1;
        return;
      }
      clip.live = explorer.state({ ...shown }, performance.now(), settings.reduced);
      kick();
    },
    reset() {
      window.clearTimeout(telling);
      for (const v of views) {
        target[v.data.id] = v.data.value;
        shown[v.data.id] = v.data.value;
        v.input.value = String(v.data.value);
        show(v);
      }
      clip.live = null;
      last = -1;
    },
    nudge: kick,
    focus() {
      views[0]?.input.focus({ preventScroll: true });
    },
  };
}
