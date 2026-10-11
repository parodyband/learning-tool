// Inline markup to HTML. The parser in core/markup decides what is markup; this file only maps its
// node types to elements. A lesson can therefore produce exactly four inline elements (strong, em,
// code, math) and nothing else.
import { parseInline, type Inline } from '../core/markup';
import { mathToMathML, parseMath } from '../core/math';
import { Html, html, raw } from './escape';

function nodes(list: Inline[]): Html {
  const parts: Html[] = [];
  for (const node of list) {
    switch (node.t) {
      case 'text':
        parts.push(html`${node.v}`);
        break;
      case 'strong':
        parts.push(html`<strong>${nodes(node.c)}</strong>`);
        break;
      case 'em':
        parts.push(html`<em>${nodes(node.c)}</em>`);
        break;
      case 'code':
        parts.push(html`<code>${node.v}</code>`);
        break;
      case 'math':
        // core/math builds every element itself and escapes every character it places inside one.
        parts.push(raw(mathToMathML(node.nodes, false)));
        break;
    }
  }
  return html`${parts}`;
}

/** A prose string with its inline markup rendered. A math span outside the supported subset stays as the text the author typed. */
export function renderInline(src: string): Html {
  return nodes(parseInline(src).nodes);
}

/** One line of math on its own (a `lines` figure in math format). Falls back to the source as code when it does not parse. */
export function renderMath(src: string, display: boolean): Html {
  const parsed = parseMath(src);
  return parsed.ok ? raw(mathToMathML(parsed.nodes, display)) : html`<code>${src}</code>`;
}
