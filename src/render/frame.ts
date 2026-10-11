// Static markup for a frame stage: what a clip whose stage has kind "frame" is at publish time,
// before any script runs, and all it ever is with scripting off.
//
//   div.lt-frame[data-frame][data-state=static][data-aspect][data-duration][data-poster][data-label]
//     div.lt-frame-stage                 the box the picture will stand in, already the right shape
//       p.lt-frame-alt#<own id>          the clip's description: the text alternative, and the
//                                        placeholder until there is a picture
//     p.lt-frame-status[role=status]     empty; the player writes here why an animation was turned off
//     p.lt-frame-label                   "This animation was written by your agent and is not checked by Learning Tool."
//
// There are no controls here and no canvas: the player adds those (src/player/frame/), so a page
// without scripting shows no dead buttons. The agent's code is NOT in this markup and is never a
// script element. It travels in the page's one inert data element (script#lt-data, JSON) as the
// stage's `code` string, and the player hands it to a worker. The data attributes above are only
// what the stylesheet and a reader of the page need before the script has read that JSON.
import type { FrameStage } from '../core/frame';
import { FRAME_TEXT } from '../player/frame/shared';
import { type Attrs, type Html, html } from './escape';

export const FRAME_LABEL = FRAME_TEXT.label;

export interface FrameRenderContext {
  /** The DOM id of something the renderer adds to this scene: RenderContext.own. */
  own(name: string): string;
  /** RenderContext.ui: ` lang="en"` for interface words in a lesson written in another language. */
  readonly ui: Attrs;
}

export interface FrameRenderOptions {
  /** The clip's description: what the animation shows and the point it makes. */
  description: string;
  /** What the picture is called: the clip's title. Becomes the canvas's accessible name. */
  label: string;
}

/** The static frame, as Html for the clip's renderer to place where the stage goes. */
export function frameStageHtml(stage: FrameStage, ctx: FrameRenderContext, opts: FrameRenderOptions): Html {
  return html`<div class="lt-frame" data-frame data-state="static" data-aspect="${stage.aspect}" data-duration="${stage.duration}" data-poster="${stage.poster}" data-label="${opts.label}"><div class="lt-frame-stage"><p class="lt-frame-alt" id="${ctx.own(
    'frame-alt',
  )}">${opts.description}</p></div><p class="lt-frame-status" role="status"${ctx.ui}></p><p class="lt-frame-label"${ctx.ui}>${FRAME_LABEL}</p></div>`;
}

/** The static frame as a string that is safe to insert as it is, like the other scene renderers return. */
export function renderFrameStage(stage: FrameStage, ctx: FrameRenderContext, opts: FrameRenderOptions): string {
  return frameStageHtml(stage, ctx, opts).toString();
}
