// Narration for clips: one audio clip per beat, segment id "<sceneId>.beat<N>" (N from 1).
//
// The clips are the ones the shell embeds (base64 in inert script elements, turned into Blob URLs
// on first use: the only media address the page's policy allows), and they are played through the
// shell's one media element. The shell's own Listen button never competes for it: a clip scene has
// no "<sceneId>" segment, so the shell hides its bar there.
//
// While a beat's clip is speaking the beat lasts as long as the clip (plus 300 ms), and the
// animation clock is steered gently towards the audio clock: eased when the two are close, snapped
// when they are far apart.
//
// Nothing here ever starts by itself. Sound begins only from the learner's Play, with voice on.
import type { Clip } from './clip';

function decode(base64: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (typeof native === 'function') return native.call(Uint8Array, base64);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const urls = new Map<string, string | null>();
/** The Blob URL of a narration segment, or null when the page carries no clip for it. */
export function segmentUrl(segment: string): string | null {
  const known = urls.get(segment);
  if (known !== undefined) return known;
  let text: string | null = null;
  document.querySelectorAll<HTMLScriptElement>('script[type="application/octet-stream"]').forEach((el) => {
    if (el.dataset.seg === segment) text = el.textContent;
  });
  let url: string | null = null;
  if (text) {
    try {
      url = URL.createObjectURL(new Blob([decode(text) as BlobPart], { type: 'audio/mpeg' }));
    } catch {
      url = null;
    }
  }
  urls.set(segment, url);
  return url;
}

/** How long a clip lasts, in ms, read from its metadata by an element that never plays. */
function measure(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const probe = document.createElement('audio');
    probe.muted = true;
    probe.preload = 'metadata';
    const done = (ms: number | undefined): void => {
      probe.removeAttribute('src');
      resolve(ms);
    };
    const timer = window.setTimeout(() => done(undefined), 4000);
    probe.addEventListener('loadedmetadata', () => {
      window.clearTimeout(timer);
      done(Number.isFinite(probe.duration) && probe.duration > 0 ? Math.round(probe.duration * 1000) : undefined);
    });
    probe.addEventListener('error', () => {
      window.clearTimeout(timer);
      done(undefined);
    });
    probe.src = url;
  });
}

export interface Narration {
  /** Whether a clip is speaking right now. */
  active(): boolean;
  /** Voice on or off. Turning it on measures the clips (once) and retimes the beats to them. */
  setOn(on: boolean): Promise<void>;
  readonly on: boolean;
  stop(): void;
}

/**
 * Tie a clip to the narration of its beats. `segments[i]` is the segment id of beat i, or null
 * when that beat has no audio. Returns null when no beat has any.
 */
export function attachNarration(clip: Clip, audio: HTMLAudioElement | null, segments: readonly (string | null)[]): Narration | null {
  if (!audio || !segments.some((s) => s !== null)) return null;
  let on = false;
  let lengths: (number | undefined)[] | null = null;
  let current = -1;
  // Each attempt to play is numbered: changing the source rejects the promise of the attempt before it.
  let attempt = 0;

  const speaking = (): boolean => on && current >= 0 && !audio.paused && !audio.ended;

  const start = (): void => {
    if (!on || !lengths || clip.opening) return;
    const k = clip.beatAt(clip.t);
    const beat = clip.beats[k];
    const segment = k >= 0 ? segments[k] : null;
    const length = lengths[k];
    const url = segment ? segmentUrl(segment) : null;
    if (!beat || !url || length === undefined) {
      audio.pause();
      current = -1;
      return;
    }
    const offset = (clip.t - beat.t0) / 1000;
    if (offset * 1000 >= length - 30) {
      audio.pause();
      return;
    }
    if (current !== k || audio.getAttribute('src') !== url) {
      audio.src = url;
      current = k;
    }
    audio.defaultPlaybackRate = clip.rate;
    audio.playbackRate = clip.rate;
    try {
      audio.currentTime = offset;
    } catch {
      // Not seekable yet: it starts from the beginning and the clock is steered to it.
    }
    const mine = ++attempt;
    audio.play().catch(() => {
      if (mine === attempt) current = -1;
    });
  };
  const stop = (): void => {
    attempt++;
    if (current >= 0) audio.pause();
    current = -1;
  };

  clip.on('state', () => (clip.playing ? start() : stop()));
  clip.on('beat', () => {
    if (clip.playing) start();
  });
  clip.on('seek', () => {
    if (clip.playing) start();
    else stop();
  });
  clip.sync = (t) => {
    if (!speaking() || audio.readyState < 3 || audio.seeking) return t;
    if (audio.playbackRate !== clip.rate) audio.playbackRate = clip.rate;
    const beat = clip.beats[current];
    if (!beat) return t;
    const err = beat.t0 + audio.currentTime * 1000 - t;
    return Math.abs(err) > 150 ? t + err : t + err * 0.1;
  };

  return {
    active: speaking,
    get on() {
      return on;
    },
    stop,
    async setOn(next) {
      if (next === on) return;
      on = next;
      if (!on) {
        stop();
        clip.audioMs = undefined;
        clip.build();
        return;
      }
      if (!lengths) {
        lengths = await Promise.all(
          segments.map((segment) => {
            const url = segment ? segmentUrl(segment) : null;
            return url ? measure(url) : Promise.resolve(undefined);
          }),
        );
      }
      if (!on) return;
      clip.audioMs = lengths;
      clip.build();
      if (clip.playing) start();
    },
  };
}
