// The title card: a lesson made of clips opens on it. It is the page's own header (the title, the
// line about the lesson, the objectives), set as a full-bleed card on the stage's field and brought
// on once, word by word; nothing is duplicated and nothing is invented. The stylesheet does the
// motion (css/stage.css, "title card"), only for a learner who has not asked for less of it.
//
// This file adds two things the header does not have: the title split into words, so they can
// arrive one after another, and a Start button that takes the learner to the first scene and, when
// that scene is a clip, starts it.
import { EVENTS, type PlayerApi, type SceneChangeDetail, byId } from '../main';
import { words } from '../questions';
import { h, s } from './core';
import type { MountedClip } from './mount';

export const CARD_SAID = { start: 'Start the lesson' } as const;

export function initTitleCard(api: PlayerApi, find: (sceneId: string) => MountedClip | undefined): void {
  const root = document.documentElement;
  const top = document.querySelector<HTMLElement>('header.lt-top');
  const title = byId('lt-title');
  const first = api.scenes[0];
  if (!top || !title || !first) return;

  // Whole words, each in its own box, in the order they are read. The heading's text is unchanged.
  const text = title.textContent ?? '';
  const pieces = text.split(/(\s+)/);
  if (pieces.filter((p) => p.trim() !== '').length <= 24) {
    title.replaceChildren();
    let i = 0;
    for (const piece of pieces) {
      if (piece === '') continue;
      if (piece.trim() === '') {
        title.append(' ');
        continue;
      }
      const word = h('span', 'st-tw', piece);
      word.style.setProperty('--st-i', String(i++));
      title.append(word);
    }
  }
  top.querySelectorAll<HTMLElement>('.lt-objectives li').forEach((li, i) => li.style.setProperty('--st-i', String(i)));

  const start = words('button', '', 'lt-btn lt-btn-primary st-start');
  start.type = 'button';
  const arrow = s('svg', { class: 'lt-icon', viewBox: '0 0 20 20', width: 18, height: 18, 'aria-hidden': 'true', focusable: 'false' });
  arrow.appendChild(s('path', { d: 'M6.5 4.2v11.6L16 10z', fill: 'currentColor' }));
  start.append(arrow, CARD_SAID.start);
  const objectives = top.querySelector('.lt-objectives');
  if (objectives) objectives.after(start);
  else top.appendChild(start);

  start.addEventListener('click', () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (api.current().id !== first.id) api.go(first.id);
    const clip = find(first.id);
    first.section.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    if (clip) clip.play();
    else first.heading.focus({ preventScroll: true });
  });

  // The card plays once. Coming back to the first scene shows it as it ended.
  window.setTimeout(() => root.classList.add('lt-card-done'), 2600);
  document.addEventListener(EVENTS.scene, (event) => {
    if ((event as CustomEvent<SceneChangeDetail>).detail.scene.index > 0) root.classList.add('lt-card-done');
  });
}
