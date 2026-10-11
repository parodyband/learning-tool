// The eight tools, by name.
import type { ToolName } from '../next';
import { guarded, type Handler } from './common';
import { saveEvidence } from './evidence';
import { getGuide } from './guide';
import { getLesson } from './lesson';
import { planLesson } from './plan';
import { publishLesson } from './publish';
import { submitScene, validateLesson } from './scene';
import { startLesson } from './start';

const RAW: Record<ToolName, Handler> = {
  start_lesson: startLesson,
  save_evidence: saveEvidence,
  plan_lesson: planLesson,
  submit_scene: submitScene,
  validate_lesson: validateLesson,
  publish_lesson: publishLesson,
  get_lesson: getLesson,
  get_guide: getGuide,
};

/** Every handler, wrapped so that whatever happens the answer is an envelope. */
export const HANDLERS = Object.fromEntries(Object.entries(RAW).map(([name, handler]) => [name, guarded(name as ToolName, handler)])) as Record<ToolName, Handler>;

export type { CallContext, Handler } from './common';
