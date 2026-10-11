// sourcing.md works five blocks through the grounding checks against one excerpt and says what
// happens to each. The table and the excerpt are read out of the document and put through the real
// text functions, and through the validator once it exists, so the worked example cannot teach a
// result the tools do not produce.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS as L } from '../../src/core/limits';
import { EvidenceInput } from '../../src/core/schema';
import type { Draft, SceneCheck } from '../../src/core/types';
import { exampleDraft } from '../helpers/example';
import { markedExamples, read, REF_DIR, ROOT } from './helpers';

const SOURCING = path.join(REF_DIR, 'sourcing.md');
const text = read(SOURCING);

/** The excerpt the table is about: the evidence example in sourcing.md. */
const evidence = EvidenceInput.parse(JSON.parse(markedExamples(SOURCING, text).find((ex) => ex.kind === 'evidence')!.json));

interface Row {
  type: 'claim' | 'quote';
  text: string;
  /** "Accepted", or the code the row names. */
  outcome: string;
}

const rows: Row[] = [...text.matchAll(/^\| (claim|quote): "(.+?)" \| (Accepted|`([A-Z_]+)`[^|]*) \|/gm)].map((m) => ({
  type: m[1] as Row['type'],
  text: m[2]!,
  outcome: m[4] ?? 'Accepted',
}));

const load = async (module: string): Promise<Record<string, unknown> | null> =>
  (await import(/* @vite-ignore */ path.join(ROOT, module)).catch(() => null)) as Record<string, unknown> | null;

describe('the worked grounding table in sourcing.md', async () => {
  it('has the five rows and covers each outcome it teaches', () => {
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.outcome).sort()).toEqual(['Accepted', 'Accepted', 'CLAIM_COPIES_SOURCE', 'CLAIM_WEAK_MATCH', 'NUMBER_NOT_IN_SOURCE']);
  });

  const textModule = (await load('src/core/text')) as {
    contentTokens?: (s: string, lang?: string) => string[];
    numberTokens?: (s: string) => string[];
    findQuote?: (excerpt: string, quote: string) => { found: boolean; text?: string };
  } | null;
  const haveText = Boolean(textModule?.contentTokens && textModule.numberTokens && textModule.findQuote);

  it.skipIf(!haveText).each(rows.map((r) => [r.outcome, r.text.slice(0, 48), r] as const))('%s: "%s..." agrees with src/core/text', (_outcome, _short, row) => {
    const { contentTokens, numberTokens, findQuote } = textModule as Required<NonNullable<typeof textModule>>;
    const excerptTokens = new Set(contentTokens(evidence.excerpt, 'en'));
    const excerptNumbers = new Set(numberTokens(evidence.excerpt));
    if (row.type === 'quote') {
      const match = findQuote(evidence.excerpt, row.text);
      expect(match.found).toBe(true);
      // The stored quote is the excerpt's own characters, which is what the document promises.
      expect(evidence.excerpt).toContain(match.text!);
      return;
    }
    const tokens = [...new Set(contentTokens(row.text, 'en'))];
    const shared = tokens.filter((t) => excerptTokens.has(t));
    const ungrounded = numberTokens(row.text).filter((n) => n.length > 1 && !excerptNumbers.has(n));
    const covered = [...excerptTokens].filter((t) => tokens.includes(t)).length / excerptTokens.size;
    const copies = shared.length / tokens.length >= L.copyContainment && covered >= L.copyContainment;
    const weak = shared.length < 2 && shared.length / tokens.length < 0.2;
    expect({ ungrounded: ungrounded.length > 0, copies, weak }).toEqual({
      ungrounded: row.outcome === 'NUMBER_NOT_IN_SOURCE',
      copies: row.outcome === 'CLAIM_COPIES_SOURCE',
      weak: row.outcome === 'CLAIM_WEAK_MATCH',
    });
  });

  const validate = await load('src/core/validate');
  const checkScene = typeof validate?.checkScene === 'function' ? (validate.checkScene as (input: unknown, draft: Draft) => SceneCheck) : null;

  it.skipIf(!checkScene).each(rows.map((r) => [r.outcome, r.text.slice(0, 48), r] as const))('%s: "%s..." is what the validator reports', (_outcome, _short, row) => {
    // The example draft with its second source replaced by the excerpt the document shows, and its
    // first planned scene (a narration without a figure) written as the one block under test.
    const draft = exampleDraft();
    draft.scenes = [];
    draft.evidence = draft.evidence.map((e) => (e.id === 'e2' ? { ...e, ...evidence, host: new URL(evidence.url).hostname } : e));
    const first = draft.outline[0]!;
    const block = row.type === 'quote' ? { type: 'quote', text: row.text, cite: 'e2' } : { type: 'claim', text: row.text, cites: ['e2'] };
    const result = checkScene!({ id: first.id, kind: first.kind, title: 'One block', blocks: [block] }, draft);
    const errors = result.errors.map((e) => e.code);
    const warnings = result.warnings.map((w) => w.code);
    if (row.outcome === 'Accepted') expect(errors).toEqual([]);
    else if (row.outcome === 'CLAIM_WEAK_MATCH') expect([...errors, ...warnings].some((c) => c === 'CLAIM_WEAK_MATCH' || c === 'CLAIM_UNRELATED')).toBe(true);
    else expect(errors).toContain(row.outcome);
  });
});
