// start_lesson: mint the id, store the draft, and hand the agent what it needs to begin: the limits
// for the depth, the contract, where the guide is, and whether voice is on.
import { canonicalJson } from '../../core/hash';
import type { StartInput } from '../../core/schema';
import type { Draft } from '../../core/types';
import { checkStart } from '../../core/validate';
import type { ServerDeps } from '../deps';
import { envelope } from '../envelope';
import { progress } from '../next';
import { CONTRACT, GUIDE_WHEN } from '../texts';
import { limitsFor, record, refuse, type Handler } from './common';
import { guideSections } from './guide';

/** A repeated start_lesson with the same arguments, this soon after the first, is the same request arriving twice. */
const RETRY_WINDOW_MS = 10 * 60 * 1000;
const START_QUEUE = '*start';

export function voiceStatus(deps: ServerDeps): { enabled: boolean; note: string } {
  if (deps.voice.config) {
    return {
      enabled: true,
      note: 'Voice is on. publish_lesson will send what the lesson says aloud (the caption of every beat, question prompts and takeaways) to ElevenLabs and embed the audio, one clip per caption, so each is heard as its picture moves. Pass "voice": false to publish_lesson to leave it out. A voice failure never blocks publishing.',
    };
  }
  const never = 'Never ask for or accept an API key in chat.';
  const problem = deps.voice.problems[0];
  if (problem) {
    return {
      enabled: false,
      note: `Voice is off because a setting is unusable: ${problem.variable} ${problem.problem} The learner corrects that in their own settings; lessons play silently meanwhile, with their captions on screen. ${never}`,
    };
  }
  return {
    enabled: false,
    note: `Voice is off: the clips play silently, with their captions on screen. Mention voice only if the learner asks about audio; they turn it on themselves in their own settings (get_guide, section "voice"). ${never}`,
  };
}

const sameStart = (draft: Draft, start: StartInput): boolean => {
  try {
    return canonicalJson({ topic: draft.topic, language: draft.language, depth: draft.depth, learner: draft.learner }) === canonicalJson(start);
  } catch {
    return false;
  }
};

export const startLesson: Handler = async (deps, raw) => {
  // The shape, and the text safety of the topic: it is published under the title, and a lesson's
  // topic cannot be changed later, so it is refused here and not at the end.
  const check = checkStart(raw ?? {});
  if (!check.ok || !check.start) return refuse('start_lesson', check.errors);
  const start = check.start;

  // One at a time, so that the same request sent twice at once finds its twin instead of racing it.
  const { draft, resumed } = await deps.store.serial(START_QUEUE, async () => {
    const now = deps.now().getTime();
    for (const candidate of await deps.store.recent(10)) {
      const age = now - Date.parse(candidate.createdAt);
      if (progress(candidate).stage === 'started' && age >= 0 && age <= RETRY_WINDOW_MS && sameStart(candidate, start)) {
        record(candidate, 'start_lesson');
        await deps.store.save(candidate, { touch: false });
        return { draft: candidate, resumed: true };
      }
    }
    return { draft: await deps.store.create(start, { start_lesson: 1 }), resumed: false };
  });

  return envelope({
    draft,
    outcome: { tool: 'start_lesson' },
    payload: {
      topic: draft.topic,
      language: draft.language,
      ...(resumed ? { resumed: true } : {}),
      limits: limitsFor(draft.depth),
      contract: CONTRACT,
      guide: {
        tool: 'get_guide',
        sections: guideSections(deps.guide).map((name) => ({ name, when: GUIDE_WHEN[name] ?? '' })),
      },
      voice: voiceStatus(deps),
    },
  });
};
