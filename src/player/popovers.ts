// Source popovers and the sources dialog.
//
// Opening and closing are the browser's own: a chip is a `<button popovertarget>`, so Enter and
// Space open the card, focus stays on the chip, Tab goes into the card next, Escape closes it and
// puts focus back, and a click outside dismisses it. None of that is reimplemented here. This file
// only places an open card next to its chip (a top-layer element is centred by default), opens the
// sources dialog as a modal, and gives a small fallback to browsers that lack either element.

const GAP = 8;
const EDGE = 12;

export function popoverOpen(el: Element): boolean {
  try {
    return el.matches(':popover-open');
  } catch {
    return false;
  }
}

export function closePopover(el: HTMLElement): void {
  if (!popoverOpen(el)) return;
  try {
    el.hidePopover();
  } catch {
    // Already closing.
  }
}

/**
 * Put an open card under its chip, or above it when it only fits there. A card that fits on
 * neither side still goes underneath, never over the chip, and the page scrolls to show it: the
 * card is in the top layer but absolutely positioned, so it is placed in page coordinates, scrolls
 * with the text, and can run past the bottom of the window.
 */
function place(card: HTMLElement, chip: HTMLElement): void {
  const view = document.documentElement;
  const vw = view.clientWidth;
  const vh = view.clientHeight;
  const at = chip.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const left = Math.max(EDGE, Math.min(at.left, vw - width - EDGE));
  const fitsBelow = vh - at.bottom >= height + GAP + EDGE;
  const fitsAbove = at.top >= height + GAP + EDGE;
  const top = !fitsBelow && fitsAbove ? at.top - GAP - height : at.bottom + GAP;
  card.style.setProperty('left', `${Math.round(left + window.scrollX)}px`);
  card.style.setProperty('top', `${Math.round(top + window.scrollY)}px`);
  // Measured again and corrected, so a margin some other rule gave the card cannot shift it.
  const now = card.getBoundingClientRect();
  if (Math.abs(now.left - left) > 0.5) card.style.setProperty('left', `${Math.round(left + window.scrollX - (now.left - left))}px`);
  if (Math.abs(now.top - top) > 0.5) card.style.setProperty('top', `${Math.round(top + window.scrollY - (now.top - top))}px`);
  card.classList.add('lt-placed');
  card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function initCards(): void {
  const invoker = new Map<string, HTMLElement>();
  let open: HTMLElement | null = null;

  // The invoking chip is noted on the way down, before the browser acts on the click.
  document.addEventListener(
    'click',
    (event) => {
      const chip = event.target instanceof Element ? event.target.closest<HTMLElement>('button.lt-chip[popovertarget]') : null;
      const id = chip?.getAttribute('popovertarget');
      if (chip && id) invoker.set(id, chip);
    },
    true,
  );

  // `toggle` does not bubble, so it is caught on the way down too.
  document.addEventListener(
    'toggle',
    (event) => {
      const card = event.target;
      if (!(card instanceof HTMLElement) || !card.classList.contains('lt-source')) return;
      const chip = invoker.get(card.id);
      const isOpen = popoverOpen(card);
      chip?.classList.toggle('lt-chip-open', isOpen);
      if (isOpen) {
        if (chip) place(card, chip);
        else card.classList.add('lt-placed');
        open = card;
      } else {
        card.classList.remove('lt-placed');
        if (open === card) open = null;
      }
    },
    true,
  );

  window.addEventListener('resize', () => {
    const chip = open ? invoker.get(open.id) : undefined;
    if (open && chip) place(open, chip);
  });
}

/** For a browser without the Popover API: cards and the contents list become plain show-and-hide regions in the page flow. */
function initWithoutPopover(): void {
  document.documentElement.classList.add('lt-no-popover');
  const all = Array.from(document.querySelectorAll<HTMLElement>('[popover]'));
  for (const el of all) el.hidden = true;
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('button[popovertarget]') : null;
    const id = button?.getAttribute('popovertarget');
    const target = id ? document.getElementById(id) : null;
    if (!button || !target) return;
    const hide = button.getAttribute('popovertargetaction') === 'hide' || !target.hidden;
    for (const el of all) if (el !== target) el.hidden = true;
    target.hidden = hide;
  });
}

function initDialog(): void {
  const dialog = document.getElementById('lt-sources') as HTMLDialogElement | null;
  const opener = document.getElementById('lt-opensources');
  if (!dialog || !opener) return;
  if (typeof dialog.showModal !== 'function') {
    // Without <dialog> the list stays where the stylesheet puts it for a page with no script: at the end, in the flow.
    document.documentElement.classList.add('lt-no-dialog');
    return;
  }
  opener.hidden = false;
  opener.addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
  });
  // A click on the backdrop lands on the dialog element itself; anything inside it has a different target.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

export function initPopovers(): void {
  if (typeof HTMLElement.prototype.showPopover === 'function') initCards();
  else initWithoutPopover();
  initDialog();
}
