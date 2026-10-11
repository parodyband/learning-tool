// Blocks: the units of prose. What a block may claim decides how it looks.
//
//   claim    a paragraph that ends with numbered source chips
//   quote    a blockquote attributed from the evidence record, never from the agent's words
//   analogy  labelled "Analogy", with the place where it breaks down always shown
//   example  labelled "Worked example, written by your agent"
//   framing  plain text
//
// The labels on analogy and example are part of the format's honesty: they are text the learner
// reads, not styling, so they survive print, forced colours and a screen reader.
import type { Block } from '../core/schema';
import { EMPTY, type Html, attrs, html } from './escape';
import type { RenderContext } from './scenes';
import { sourceHost } from './sources';

export const ANALOGY_LABEL = 'Analogy';
export const ANALOGY_LIMITS_LABEL = 'Where this comparison breaks down:';
export const EXAMPLE_LABEL = 'Worked example, written by your agent';

/**
 * One block. `path` is where it sits in its scene, in the validator's notation ("blocks[1]",
 * "steps[2].blocks[0]"); it is written by the calling renderer and is how a weak-match claim is found.
 */
export function renderBlock(block: Block, ctx: RenderContext, path: string): Html {
  switch (block.type) {
    case 'claim': {
      const cited = ctx.cites(block.cites, { path });
      return html`<div class="lt-block lt-claim"><p>${ctx.inline(block.text)}${cited.chips === EMPTY ? null : html`&nbsp;${cited.chips}`}</p>${cited.popovers}</div>`;
    }
    case 'quote': {
      const evidence = ctx.source(block.cite);
      const cited = ctx.cites([block.cite], { path });
      // The words are the source's own characters, so nothing in them is read as markup.
      return html`<div class="lt-block lt-quote"><blockquote${attrs({ lang: evidence?.lang })}><p>${block.text}</p></blockquote><p class="lt-quote-from">${
        evidence ? html`<cite>${evidence.title}</cite><span class="lt-quote-host">${sourceHost(evidence)}</span>` : null
      }${cited.chips === EMPTY ? null : html`&nbsp;${cited.chips}`}</p>${cited.popovers}</div>`;
    }
    case 'analogy':
      return html`<div class="lt-block lt-note lt-analogy"><p class="lt-label"${ctx.ui}>${ANALOGY_LABEL}</p><p>${ctx.inline(block.text)}</p><p class="lt-limits"><span class="lt-limits-label"${ctx.ui}>${ANALOGY_LIMITS_LABEL}</span> ${ctx.inline(block.limits)}</p></div>`;
    case 'example': {
      const cited = block.basedOn && block.basedOn.length > 0 ? ctx.cites(block.basedOn) : null;
      return html`<div class="lt-block lt-note lt-example"><p class="lt-label"${ctx.ui}>${EXAMPLE_LABEL}</p><p>${ctx.inline(block.text)}</p>${
        cited && cited.chips !== EMPTY ? html`<p class="lt-based"><span${ctx.ui}>Based on</span>&nbsp;${cited.chips}</p>${cited.popovers}` : null
      }</div>`;
    }
    case 'framing':
      return html`<div class="lt-block lt-framing"><p>${ctx.inline(block.text)}</p></div>`;
    default:
      return EMPTY;
  }
}

/** A run of blocks. `basePath` is the path of the array: "blocks", or "steps[2].blocks". */
export function renderBlocks(blocks: readonly Block[], ctx: RenderContext, basePath: string): Html {
  return html`${blocks.map((block, i) => renderBlock(block, ctx, `${basePath}[${i}]`))}`;
}
