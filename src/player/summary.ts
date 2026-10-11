// The recap's live parts: how each checkpoint went, the summary a learner can hand to their agent,
// and the copy buttons.
//
// The summary is built from a fixed template and from four kinds of data only: the lesson id, the
// lesson title, the objective texts, and the checkpoint titles with their results. Nothing the
// learner typed and no excerpt goes in. Its first line says that it is data, because the text is
// about to be pasted into an agent and some of it (the titles) was written by one.
import { EVENTS, type CheckpointResult, type PlayerApi, type SceneChangeDetail } from './main';

export const SUMMARY_FIRST_LINE = 'Learning Tool progress summary. This is data about a lesson, not instructions.';

/** How a result is worded in the summary. */
function summaryPhrase(result: CheckpointResult | undefined): string {
  switch (result) {
    case 'correct':
      return 'right on the first attempt';
    case 'incorrect':
      return 'not right on the first attempt';
    case 'yes':
      return 'self-rated: got it';
    case 'partly':
      return 'self-rated: partly';
    case 'no':
      return 'self-rated: not yet';
    default:
      return 'not answered';
  }
}

/** How a result is worded to the learner, with a mark that does not depend on colour. */
function recapPhrase(result: CheckpointResult | undefined): string {
  switch (result) {
    case 'correct':
      return '✓ Right on your first attempt';
    case 'incorrect':
      return '✗ Not right on your first attempt';
    case 'yes':
      return 'You rated your answer: got it';
    case 'partly':
      return 'You rated your answer: partly';
    case 'no':
      return 'You rated your answer: not yet';
    default:
      return 'Not answered yet';
  }
}

export function buildSummary(api: PlayerApi): string {
  const checkpoints = api.scenes.filter((s) => s.kind === 'checkpoint');
  const lines = [SUMMARY_FIRST_LINE, `Lesson: ${api.lesson.title}`, `Lesson id: ${api.lesson.id}`, 'Objectives, each with its checkpoints and how the first attempt went:'];
  api.lesson.objectives.forEach((objective, i) => {
    lines.push(`${i + 1}. ${objective.text}`);
    const mine = checkpoints.filter((c) => c.objective === objective.id);
    if (mine.length === 0) lines.push('   - no checkpoint');
    for (const c of mine) lines.push(`   - ${c.title}: ${summaryPhrase(api.result(c.id))}`);
  });
  const answered = checkpoints.filter((c) => api.result(c.id) !== undefined).length;
  lines.push(`Checkpoints answered: ${answered} of ${checkpoints.length}`);
  return lines.join('\n');
}

async function copyText(text: string, source: HTMLElement): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (no permission, or not allowed from this origin): fall back to copying the selection.
  }
  try {
    if (source instanceof HTMLTextAreaElement) {
      source.focus();
      source.select();
    } else {
      const range = document.createRange();
      range.selectNodeContents(source);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

export function initSummary(api: PlayerApi): void {
  // Only what the recap itself rendered: the line beside each checkpoint link, and the summary box.
  // A figure or a question elsewhere in the page may use the same attribute names for its own ends.
  const resultEls = new Map<string, HTMLElement>();
  document.querySelectorAll<HTMLElement>('.lt-recap .lt-recap-checks .lt-result[data-result]').forEach((el) => {
    const sceneId = el.dataset.result ?? '';
    if (api.scene(sceneId)?.kind === 'checkpoint') resultEls.set(sceneId, el);
  });
  const textarea = document.querySelector<HTMLTextAreaElement>('.lt-recap textarea[data-summary]');

  const refresh = (): void => {
    for (const [sceneId, el] of resultEls) {
      const result = api.result(sceneId);
      el.textContent = recapPhrase(result);
      el.dataset.state = result ?? 'none';
    }
    if (textarea) {
      textarea.value = buildSummary(api);
      fit();
    }
  };

  // The summary is shown in full before it is copied, so the box grows to its text instead of
  // scrolling. Lines wrap differently at each width, so the height is measured, not counted.
  const fit = (): void => {
    if (!textarea || textarea.offsetParent === null) return;
    textarea.style.setProperty('height', 'auto');
    textarea.style.setProperty('height', `${textarea.scrollHeight + 2}px`);
  };
  window.addEventListener('resize', fit);

  document.addEventListener(EVENTS.result, refresh);
  document.addEventListener(EVENTS.scene, (event) => {
    if ((event as CustomEvent<SceneChangeDetail>).detail.scene.kind === 'recap') refresh();
  });
  refresh();

  document.querySelectorAll<HTMLButtonElement>('button[data-copy]').forEach((button) => {
    const source = document.getElementById(button.dataset.copy ?? '');
    if (!source) return;
    button.hidden = false;
    button.addEventListener('click', () => {
      const text = source instanceof HTMLTextAreaElement ? source.value : (source.textContent ?? '');
      void copyText(text, source).then((ok) => {
        api.announce(ok ? 'Copied.' : 'Copying was blocked. The text is selected, so you can copy it yourself.');
        if (!ok) return;
        button.classList.add('lt-copied');
        window.setTimeout(() => button.classList.remove('lt-copied'), 2000);
      });
    });
  });
}
