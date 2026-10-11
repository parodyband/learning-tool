// Optional narration. The controls exist only in a lesson that was published with voice clips.
//
// Each clip is one narration segment: a whole scene, the intro of a step-through, or one of its
// steps. The clips sit in the page as base64 inside inert script elements and are turned into Blob
// URLs when first played; that is the only kind of media address the page's policy allows, and it
// keeps megabytes of audio out of attribute values.
//
// Nothing plays until the learner presses Listen. While a segment is being read, the element that
// holds its text carries the class `lt-reading`, and loses it the moment playback pauses or ends.
import { EVENTS, type PlayerApi, type SceneChangeDetail, type SceneInfo, type StepChangeDetail, byId } from './main';

const RATES = ['0.75', '1', '1.25', '1.5'];
const isRate = (v: unknown): v is string => typeof v === 'string' && RATES.includes(v);

function decode(base64: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (typeof native === 'function') return native.call(Uint8Array, base64);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function initAudio(api: PlayerApi): void {
  const bar = byId('lt-audiobar');
  const audio = byId<HTMLAudioElement>('lt-audio');
  const button = byId('lt-play');
  if (!bar || !audio || !button) return;
  const label = button.querySelector<HTMLElement>('[data-audio-label]');
  const available = new Set((bar.dataset.segments ?? '').split(' ').filter(Boolean));
  const urls = new Map<string, string>();

  let scene: SceneInfo = api.current();
  /** The step of a step-through that may be read, or null while that step holds its text back. */
  let step: number | null = 1;
  /** The segments Listen will read, in order, and which of them is up. */
  let queue: string[] = [];
  let at = 0;
  // Kept here rather than read off the element: its events arrive later, after this code has already moved on.
  let state: 'idle' | 'playing' | 'paused' = 'idle';
  let rate = api.store.get('rate', isRate) ?? '1';

  const segmentsFor = (s: SceneInfo, n: number | null): string[] => {
    if (s.kind !== 'step_through') return available.has(s.id) ? [s.id] : [];
    const out: string[] = [];
    if (n === null) return out;
    if (n === 1 && available.has(`${s.id}.intro`)) out.push(`${s.id}.intro`);
    if (available.has(`${s.id}.step${n}`)) out.push(`${s.id}.step${n}`);
    return out;
  };

  const urlFor = (segment: string): string | null => {
    const known = urls.get(segment);
    if (known) return known;
    let text: string | null = null;
    document.querySelectorAll<HTMLScriptElement>('script[type="application/octet-stream"]').forEach((el) => {
      if (el.dataset.seg === segment) text = el.textContent;
    });
    if (!text) return null;
    try {
      const url = URL.createObjectURL(new Blob([decode(text) as BlobPart], { type: 'audio/mpeg' }));
      urls.set(segment, url);
      return url;
    } catch {
      return null;
    }
  };

  const mark = (segment: string | null): void => {
    scene.section.querySelectorAll<HTMLElement>('[data-narration]').forEach((el) => {
      const on = segment !== null && el.dataset.narration === segment;
      el.classList.toggle('lt-reading', on);
      // Text that is being read aloud must be on screen, so a disclosure that folds it away is
      // opened. Only those: the renderer marks them. A hint or an answer in the same scene is not
      // read out and stays the learner's to open.
      if (on) el.querySelectorAll<HTMLDetailsElement>('details[data-narrated]').forEach((d) => (d.open = true));
    });
  };

  const show = (next: 'idle' | 'playing' | 'paused'): void => {
    state = next;
    if (label) label.textContent = next === 'playing' ? 'Pause' : next === 'paused' ? 'Resume' : 'Listen';
    button.classList.toggle('lt-playing', next === 'playing');
    mark(next === 'playing' ? (queue[at] ?? null) : null);
  };

  // Each attempt to play is numbered. Changing the source or pausing rejects the promise of the
  // attempt before it (in WebKit, a moment later), and that late rejection must not stop the new one.
  let attempt = 0;
  const start = (): void => {
    const mine = ++attempt;
    audio.play().catch(() => {
      if (mine !== attempt || state !== 'playing') return;
      stop();
      api.announce('The narration could not be played.');
    });
  };

  const stop = (): void => {
    attempt++;
    show('idle');
    at = 0;
    audio.pause();
  };

  const playCurrent = (): void => {
    const segment = queue[at];
    const url = segment === undefined ? null : urlFor(segment);
    if (url === null) {
      stop();
      return;
    }
    if (audio.getAttribute('src') === url) audio.currentTime = 0;
    else audio.src = url;
    // Loading a new source puts the rate back to the default, so both are set.
    audio.defaultPlaybackRate = Number(rate);
    audio.playbackRate = Number(rate);
    show('playing');
    start();
  };

  const retarget = (carryOn: boolean): void => {
    queue = segmentsFor(scene, step);
    bar.hidden = queue.length === 0;
    if (carryOn && queue.length > 0) playCurrent();
  };

  button.addEventListener('click', () => {
    if (state === 'playing') {
      attempt++;
      show('paused');
      audio.pause();
    } else if (state === 'paused') {
      show('playing');
      start();
    } else {
      at = 0;
      playCurrent();
    }
  });

  audio.addEventListener('ended', () => {
    if (state !== 'playing') return;
    at += 1;
    if (at < queue.length) playCurrent();
    else stop();
  });
  // Paused by something other than our button (a headset key, the system): the page must agree.
  audio.addEventListener('pause', () => {
    if (state === 'playing' && !audio.ended) show('paused');
  });
  audio.addEventListener('error', () => {
    if (state !== 'idle') stop();
  });

  const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="lt-speed"]'));
  for (const radio of radios) {
    radio.checked = radio.value === rate;
    radio.addEventListener('change', () => {
      if (!radio.checked || !isRate(radio.value)) return;
      rate = radio.value;
      audio.defaultPlaybackRate = Number(rate);
      audio.playbackRate = Number(rate);
      api.store.set('rate', rate);
    });
  }

  document.addEventListener(EVENTS.scene, (event) => {
    stop();
    scene = (event as CustomEvent<SceneChangeDetail>).detail.scene;
    step = 1;
    retarget(false);
  });
  document.addEventListener(EVENTS.step, (event) => {
    const detail = (event as CustomEvent<StepChangeDetail>).detail;
    if (detail.sceneId !== scene.id) return;
    // Someone who is listening and presses "Next step" has asked for the next step to be read too.
    const carryOn = state === 'playing';
    stop();
    step = detail.step;
    retarget(carryOn);
  });
}
