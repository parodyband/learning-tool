// get_guide: the skill's own text, by section, for an agent that has no skill loaded. The text comes
// from the build (src/generated/guide.ts). A build made before the skill exists carries none, and
// then the contract stands in.
//
// This is the one tool whose two halves differ. The guide text is the text block; the structured
// content is the small envelope (which section, how long, what other sections there are). A
// section runs to tens of thousands of characters, and a host that counts both halves of a result
// would otherwise spend its context on the same text twice.
import { issue } from '../../core/issues';
import type { Issue } from '../../core/types';
import { nearest, show } from '../../core/validate/shape';
import { jsonType, readArgs } from '../args';
import { envelope, withTextBlock, type Envelope } from '../envelope';
import { CONTRACT, GUIDE_WHEN } from '../texts';
import { refuse, type Handler } from './common';

/** Above this, a section is returned in parts, so that no result is moved to a file by the host (Claude Code does that near 50,000 characters). */
export const GUIDE_PART_MAX_CHARS = 40_000;

/** The order an agent meets the sections in while making a lesson. Sections the build adds later follow, as written. */
const READING_ORDER = ['overview', 'calibration', 'sourcing', 'clip-design', 'motion', 'format', 'frame-api', 'errors', 'voice'];

/**
 * Sections that have been renamed, old name to new. A host may still hold instructions that name the
 * old one (they are cached from an earlier connection), and an agent that asks for it is asking for
 * this.
 */
const RENAMED: Readonly<Record<string, string>> = { 'scene-design': 'clip-design' };

/** Section names in reading order. Only non-empty text counts. */
export function guideSections(guide: Readonly<Record<string, string>>): string[] {
  const names = Object.keys(guide).filter((name) => typeof guide[name] === 'string' && (guide[name] as string).trim() !== '');
  return [...READING_ORDER.filter((name) => names.includes(name)), ...names.filter((name) => !READING_ORDER.includes(name))];
}

/** Cut `text` into pieces of at most `max` characters, at "## " headings where possible, then at blank lines, then anywhere. */
export function splitGuide(text: string, max = GUIDE_PART_MAX_CHARS): string[] {
  if (text.length <= max) return [text];
  const pieces = (source: string, boundary: RegExp): string[] => {
    const out: string[] = [];
    let from = 0;
    for (const match of source.matchAll(boundary)) {
      const at = match.index + (match[0].startsWith('\n') ? 1 : 0);
      if (at > from) out.push(source.slice(from, at));
      from = at;
    }
    out.push(source.slice(from));
    return out;
  };
  // Smallest units first: headed sections, split further at blank lines only when one is too long on its own.
  const units = pieces(text, /\n(?=## )/g).flatMap((section) => (section.length <= max ? [section] : pieces(section, /\n\n/g)));
  const parts: string[] = [];
  let current = '';
  for (const unit of units) {
    let rest = unit;
    while (rest.length > max) {
      if (current !== '') {
        parts.push(current);
        current = '';
      }
      parts.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
    if (current.length + rest.length > max) {
      parts.push(current);
      current = '';
    }
    current += rest;
  }
  if (current !== '') parts.push(current);
  return parts;
}

const TEXT_NOTE = 'The guide text is the text block of this result, not a field here.';

/**
 * The result for one part of a section: the text as the text block, with one closing line that says
 * what it was and where the rest is, for a host that shows its model nothing but the text.
 */
function guideResult(text: string, payload: { section: string; part: number; parts: number; sections: { name: string }[]; note?: string }): Envelope {
  const { section, part, parts, sections } = payload;
  const more = part < parts ? ` Next: get_guide {"section": "${section}", "part": ${part + 1}}.` : '';
  const others = sections.length > 0 ? ` Sections: ${sections.map((s) => s.name).join(', ')}.` : '';
  const footer = `[get_guide: section "${section}", part ${part} of ${parts}.${more}${others}]`;
  const env = envelope({
    draft: null,
    outcome: { tool: 'get_guide' },
    payload: { ...payload, ...(part < parts ? { nextPart: part + 1 } : {}), chars: text.length, note: payload.note ? `${payload.note} ${TEXT_NOTE}` : TEXT_NOTE },
  });
  // The text is sent as it is, so the parts of a long section still join back to the whole.
  return withTextBlock(env, `${text}\n\n${footer}\n`);
}

export const getGuide: Handler = async (deps, raw) => {
  const read = readArgs('get_guide', raw, { optional: ['section', 'part'] });
  if (read.errors.length > 0) return refuse('get_guide', read.errors);
  const names = guideSections(deps.guide);
  const listing = names.map((name) => ({ name, when: GUIDE_WHEN[name] ?? '', chars: (deps.guide[name] as string).length }));
  const errors: Issue[] = [];

  const asked = read.args.section;
  if (asked !== undefined && typeof asked !== 'string') {
    errors.push(issue('WRONG_TYPE', 'section', '"section" must be a section name.', { fix: `Use one of: ${names.join(', ') || 'none in this build'}. Or leave it out for the overview.`, got: jsonType(asked), expected: 'string' }));
  }
  const rawPart = read.args.part;
  const part = rawPart === undefined ? 1 : typeof rawPart === 'number' && Number.isInteger(rawPart) && rawPart >= 1 ? rawPart : null;
  if (part === null) errors.push(issue('BAD_VALUE', 'part', '"part" must be a whole number from 1.', { fix: 'Leave "part" out for the first part, or pass the "nextPart" a result gave.', got: show(rawPart) }));
  if (errors.length > 0) return refuse('get_guide', errors);

  if (names.length === 0) {
    // No skill was built into this server. The contract is the whole guidance there is.
    return guideResult(CONTRACT, { section: 'contract', part: 1, parts: 1, sections: [], note: 'This build carries no design guide. The contract is the summary of the rules.' });
  }

  const wanted = typeof asked === 'string' && asked.trim() !== '' ? asked.trim() : 'overview';
  // "clip_design" and "Clip-Design" are the section "clip-design": a lookup of documentation gains nothing from being strict about that.
  const fold = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const renamed = Object.keys(RENAMED).find((old) => fold(old) === fold(wanted));
  const moved = renamed !== undefined && !names.some((n) => fold(n) === fold(wanted)) && names.includes(RENAMED[renamed] as string) ? (RENAMED[renamed] as string) : undefined;
  const name = names.find((n) => n === wanted) ?? names.find((n) => fold(n) === fold(wanted)) ?? moved ?? (wanted === 'overview' ? names[0] : undefined);
  if (name === undefined) {
    const guess = nearest(wanted, names);
    const found = issue('BAD_VALUE', 'section', `There is no guide section "${show(wanted)}".`, {
      fix: `${guess ? `Did you mean "${guess}"? ` : ''}Use one of: ${names.join(', ')}.`,
      got: show(wanted),
      expected: `one of ${names.join(', ')}`,
    });
    return envelope({ draft: null, errors: [found], outcome: { tool: 'get_guide', rejected: [found] }, payload: { sections: listing } });
  }

  const parts = splitGuide(deps.guide[name] as string);
  if ((part as number) > parts.length) {
    const found = issue('BAD_VALUE', 'part', `Section "${name}" has ${parts.length} part${parts.length === 1 ? '' : 's'}.`, {
      fix: parts.length === 1 ? 'Leave "part" out.' : `Use a part from 1 to ${parts.length}.`,
      got: String(part),
      expected: `1 to ${parts.length}`,
    });
    return envelope({ draft: null, errors: [found], outcome: { tool: 'get_guide', rejected: [found] }, payload: { sections: listing } });
  }
  const index = (part as number) - 1;
  return guideResult(parts[index] as string, {
    section: name,
    part: index + 1,
    parts: parts.length,
    sections: listing,
    ...(moved !== undefined && name === moved ? { note: `The section "${renamed}" is now "${moved}": this is it.` } : {}),
  });
};
