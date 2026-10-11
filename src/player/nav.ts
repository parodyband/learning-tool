// Moving between scenes, and the page chrome that goes with it: Back and Continue, the progress
// rail, the contents list, the page title, history, where focus goes, the theme switch and
// "clear my progress".
//
// History uses the fragment, written as "#/<sceneId>". Three measured facts decide that (see the
// research brief). On file:// only the query and fragment may change. A query would also be sent to
// the local server on reload. And when a fragment names an element, the browser itself scrolls to
// it and moves focus after our handler has run (in Chrome, Back then drops focus to <body> if that
// element is not focusable). A fragment with a "/" can never be an element id, so scroll and focus
// are entirely ours. With scripting off the same links are ordinary anchors to each scene's
// heading, and an address in that form ("#scene-<id>") is accepted here too.
import { type SceneChangeDetail, type SceneInfo, byId } from './main';
import { closePopover } from './popovers';
import type { Store } from './storage';

export interface NavOptions {
  scenes: readonly SceneInfo[];
  sceneById: ReadonlyMap<string, SceneInfo>;
  lessonTitle: string;
  store: Store;
  announce(text: string): void;
  onChange(detail: SceneChangeDetail): void;
}

export interface Nav {
  current(): SceneInfo;
  go(sceneId: string, focus?: HTMLElement): void;
  /** Show the first scene (or the one the address names) and start listening. Call once, after every module has subscribed. */
  start(): void;
}

type Theme = 'light' | 'dark';
const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark';
const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 64 && v.every((x) => typeof x === 'string');
const isString = (v: unknown): v is string => typeof v === 'string';

function setDisabled(button: HTMLElement | null, disabled: boolean): void {
  // aria-disabled, not `disabled`: the control keeps its place in the tab order and can still be found and read.
  if (button) button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

function initTheme(store: Store, announce: (text: string) => void): void {
  const button = byId('lt-theme');
  if (!button) return;
  const root = document.documentElement;
  const label = button.querySelector<HTMLElement>('[data-theme-label]');
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let choice: Theme | null = store.get('theme', isTheme) ?? null;

  const effective = (): Theme => choice ?? (system.matches ? 'dark' : 'light');
  const apply = (): void => {
    if (choice) root.dataset.theme = choice;
    else delete root.dataset.theme;
    const text = effective() === 'dark' ? 'Use the light theme' : 'Use the dark theme';
    if (label) label.textContent = text;
    button.title = text;
  };

  button.addEventListener('click', () => {
    choice = effective() === 'dark' ? 'light' : 'dark';
    store.set('theme', choice);
    apply();
    announce(choice === 'dark' ? 'Dark theme on.' : 'Light theme on.');
  });
  system.addEventListener('change', apply);
  apply();
  button.hidden = false;
}

function initClear(store: Store): void {
  const wrap = byId('lt-progress');
  const clear = byId('lt-clear');
  const confirm = byId('lt-clearconfirm');
  const yes = byId('lt-clearyes');
  const no = byId('lt-clearno');
  if (!wrap || !clear || !confirm || !yes || !no) return;
  if (!store.persistent) {
    const note = byId('lt-storenote');
    if (note) note.textContent = 'This browser is not saving anything for this page, so your place and your results last only until you close it.';
  }
  const ask = (asking: boolean): void => {
    confirm.hidden = !asking;
    clear.hidden = asking;
    (asking ? no : clear).focus();
  };
  clear.addEventListener('click', () => ask(true));
  no.addEventListener('click', () => ask(false));
  yes.addEventListener('click', () => {
    store.clear();
    // Reloading without the fragment is the simplest way to put every module back to its first state.
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      // Some embedders refuse history changes. The reload below still clears the page state.
    }
    location.reload();
  });
  wrap.hidden = false;
}

export function createNav(o: NavOptions): Nav {
  const root = document.documentElement;
  const first = o.scenes[0] as SceneInfo;
  const total = o.scenes.length;
  const byHeading = new Map(o.scenes.map((s) => [s.heading.id, s]));
  const railItems = new Map<string, HTMLElement>();
  document.querySelectorAll<HTMLElement>('[data-rail]').forEach((el) => railItems.set(el.dataset.rail ?? '', el));
  const contentsItems = new Map<string, HTMLElement>();
  document.querySelectorAll<HTMLElement>('[data-contents]').forEach((el) => contentsItems.set(el.dataset.contents ?? '', el));

  const main = byId('lt-main');
  const back = byId('lt-back');
  const next = byId('lt-next');
  const upNext = byId('lt-upnext');
  const pager = byId('lt-pager');
  const contents = byId('lt-contents');
  const resume = byId('lt-resume');

  const seen = new Set<string>();
  for (const id of o.store.get('seen', isIdList) ?? []) if (o.sceneById.has(id)) seen.add(id);

  let current: SceneInfo = first;
  let started = false;

  const fromAddress = (): SceneInfo | undefined => {
    let id = location.hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // A malformed escape cannot be one of our ids.
    }
    return id.startsWith('/') ? o.sceneById.get(id.slice(1)) : byHeading.get(id);
  };
  const address = (scene: SceneInfo): string => `#/${encodeURIComponent(scene.id)}`;

  const paint = (): void => {
    for (const s of o.scenes) s.section.hidden = s !== current;
    root.classList.toggle('lt-compact', current.index > 0);
    root.classList.toggle('lt-wide', current.section.classList.contains('lt-scene-wide'));
    document.title = `Scene ${current.index + 1} of ${total}: ${current.title} – ${o.lessonTitle}`;

    setDisabled(back, current.index === 0);
    const following = o.scenes[current.index + 1];
    setDisabled(next, !following);
    if (upNext) upNext.textContent = following ? `Next: ${following.title}` : 'This is the last scene.';

    for (const s of o.scenes) {
      const railItem = railItems.get(s.id);
      railItem?.classList.toggle('lt-rail-seen', seen.has(s.id));
      railItem?.classList.toggle('lt-rail-current', s === current);
      const item = contentsItems.get(s.id);
      item?.classList.toggle('lt-seen', seen.has(s.id));
      const link = item?.querySelector('a');
      if (s === current) link?.setAttribute('aria-current', 'step');
      else link?.removeAttribute('aria-current');
    }
  };

  const show = (scene: SceneInfo, how: { history: 'push' | 'none'; focus: HTMLElement | null; remember: boolean }): void => {
    const previous = started ? current : null;
    current = scene;
    seen.add(scene.id);
    if (how.remember) {
      o.store.set('pos', scene.id);
      o.store.set('seen', [...seen]);
      if (resume) resume.hidden = true;
    }
    if (how.history === 'push' && fromAddress() !== scene) {
      try {
        history.pushState(null, '', address(scene));
      } catch {
        // A sandboxed embedder may refuse. The scene still changes; only Back is lost.
      }
    }
    paint();
    if (how.focus) {
      window.scrollTo(0, 0);
      how.focus.focus({ preventScroll: true });
      if (how.focus !== scene.heading) how.focus.scrollIntoView({ block: 'center' });
    }
    started = true;
    o.onChange({ scene, previous });
  };

  const go = (sceneId: string, focus?: HTMLElement): void => {
    const scene = o.sceneById.get(sceneId);
    if (!scene) return;
    const target = focus && scene.section.contains(focus) ? focus : scene.heading;
    show(scene, { history: 'push', focus: target, remember: true });
  };

  const offerResume = (): void => {
    const id = o.store.get('pos', isString);
    const scene = id === undefined ? undefined : o.sceneById.get(id);
    if (!resume || !scene || scene.index === 0) return;
    const link = document.createElement('a');
    link.href = `#${scene.heading.id}`;
    link.dataset.goto = scene.id;
    link.textContent = 'Pick up where you left off';
    resume.replaceChildren(`Last time you reached scene ${scene.index + 1}, “${scene.title}”. `, link);
    resume.hidden = false;
  };

  return {
    current: () => current,
    go,
    start() {
      document.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const link = target?.closest<HTMLElement>('a[data-goto]');
        if (link) {
          // Let the browser handle a modified click (new tab, new window) itself.
          if (event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
          event.preventDefault();
          if (contents) closePopover(contents);
          go(link.dataset.goto ?? '');
          return;
        }
        if (target?.closest('a.lt-skip') && main) {
          // Handled here so that the fragment keeps naming the scene. <main> is focusable only for
          // this moment: left focusable, every click on the lesson's text would move focus to it.
          event.preventDefault();
          main.setAttribute('tabindex', '-1');
          main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
          main.focus({ preventScroll: true });
          main.scrollIntoView();
        }
      });

      back?.addEventListener('click', () => {
        const scene = o.scenes[current.index - 1];
        if (scene) go(scene.id);
      });
      next?.addEventListener('click', () => {
        const scene = o.scenes[current.index + 1];
        if (scene) go(scene.id);
      });

      // A scene always opens at its top with focus on its heading, whichever way it was reached, so
      // the browser must not put back the scroll position of an earlier visit.
      try {
        history.scrollRestoration = 'manual';
      } catch {
        // Older engines: the scroll position may jump after Back. Focus is still right.
      }

      // Back, Forward and a hand-edited address all arrive here.
      window.addEventListener('popstate', () => {
        const scene = fromAddress() ?? (location.hash === '' ? first : undefined);
        if (scene && scene !== current) show(scene, { history: 'none', focus: scene.heading, remember: true });
      });

      initTheme(o.store, o.announce);
      initClear(o.store);

      const addressed = fromAddress();
      if (!addressed) offerResume();
      else if (location.hash !== address(addressed)) {
        // Arrived by the anchor form. Rewriting it now, before the page has finished loading, also
        // stops the browser from scrolling to that anchor by itself.
        try {
          history.replaceState(null, '', address(addressed));
        } catch {
          // Nothing depends on it.
        }
      }
      if (pager) pager.hidden = false;
      // Focus is left alone on arrival so the skip link stays the first stop. Opening the lesson is
      // not yet progress, so the stored position is only replaced when the address names a scene.
      show(addressed ?? first, { history: 'none', focus: null, remember: addressed !== undefined });
    },
  };
}
