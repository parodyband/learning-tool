// The renderer's public surface. A published lesson goes in; one self-contained HTML document comes
// out. Rendering is a pure function of its argument: no clock, no randomness, no file or network
// access, so the same lesson always produces the same bytes.
import type { Published, RenderLessonHtml } from '../core/types';
import { type RenderedLesson, contentSecurityPolicy, readEmbeddedData, renderDocument } from './page';

export type { RenderedLesson } from './page';
export type { RenderContext } from './scenes';
export { contentSecurityPolicy, readEmbeddedData };

/** The complete document for a published lesson. */
export const renderLessonHtml: RenderLessonHtml = (published) => renderDocument(published).html;

/** The document together with its Content-Security-Policy, for a server that also sends the policy as a header. */
export function renderLesson(published: Published): RenderedLesson {
  return renderDocument(published);
}
