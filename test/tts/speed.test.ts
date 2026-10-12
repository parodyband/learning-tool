// The two things that make a lesson's audio quick: the fast model by default (with the older one
// taking over when the fast one is refused), and clips requested in parallel.
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, FALLBACK_MODEL } from '../../src/tts/config';
import { GEORGE } from './helpers/stub';
import { configure, MODEL_VAR, segs, useWorld, VOICE_VAR } from './helpers/kit';

const modelOf = (req: { json: unknown }): string => (req.json as { model_id: string }).model_id;
/** The product's own defaults: no model named, no test limit on how many requests run at once. */
const defaults = () => configure({ [VOICE_VAR]: GEORGE, [MODEL_VAR]: '' });
const OPEN = { backoffMs: [2, 4], requestTimeoutMs: 2000 } as const;

describe('the default model', () => {
  const w = useWorld();

  it('is the fast one', async () => {
    expect(DEFAULT_MODEL).toBe('eleven_v4_turbo');
    const { report } = await w.synth(segs('One.', 'Two.'), defaults(), { tuning: OPEN });
    expect(report.code).toBe('VOICE_OK');
    expect(w.stub.requests.filter((r) => r.path.startsWith('/v1/text-to-speech')).map(modelOf)).toEqual([DEFAULT_MODEL, DEFAULT_MODEL]);
  });

  it.each(['model_access_denied', 'validation'] as const)('refused with %s: one request finds out, and the whole run goes on with the older model', async (error) => {
    w.stub.tts = (req) => (modelOf(req) === DEFAULT_MODEL ? { kind: 'error', error } : { kind: 'audio' });
    const lesson = segs('One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.');
    const { report, clips } = await w.synth(lesson, defaults(), { tuning: OPEN });
    expect(report.code).toBe('VOICE_OK');
    expect(clips).toHaveLength(6);
    const models = w.stub.requests.filter((r) => r.path.startsWith('/v1/text-to-speech')).map(modelOf);
    expect(models.filter((m) => m === FALLBACK_MODEL)).toHaveLength(6);
    // Only the requests already under way when the refusal came used the fast model: never one per segment.
    expect(models.filter((m) => m === DEFAULT_MODEL).length).toBeLessThanOrEqual(4);
  });

  it('a refusal that the older model gives too is reported as it is, and is not tried twice per segment', async () => {
    w.stub.tts = () => ({ kind: 'error', error: 'validation' });
    const { report } = await w.synth(segs('One.', 'Two.', 'Three.'), defaults(), { tuning: OPEN });
    expect(report.code).not.toBe('VOICE_OK');
    expect(w.stub.requests.filter((r) => r.path.startsWith('/v1/text-to-speech') && modelOf(r) === FALLBACK_MODEL)).toHaveLength(1);
  });

  it('a model the learner chose is never swapped', async () => {
    w.stub.tts = () => ({ kind: 'error', error: 'model_access_denied' });
    const { report } = await w.synth(segs('One.', 'Two.'), configure({ [VOICE_VAR]: GEORGE, [MODEL_VAR]: 'eleven_flash_v2_5' }), { tuning: OPEN });
    expect(report.code).toBe('VOICE_AUTH');
    expect(new Set(w.stub.requests.filter((r) => r.path.startsWith('/v1/text-to-speech')).map(modelOf))).toEqual(new Set(['eleven_flash_v2_5']));
  });
});

describe('clips are requested in parallel', () => {
  const w = useWorld();

  /** The most requests the stub held open at once. */
  const peak = async (count: number, headers: Record<string, string> = {}): Promise<number> => {
    let open = 0;
    let most = 0;
    w.stub.tts = () => {
      open += 1;
      most = Math.max(most, open);
      setTimeout(() => (open -= 1), 40);
      return { kind: 'audio', delayMs: 40, headers };
    };
    const texts = Array.from({ length: count }, (_, i) => `Segment number ${i + 1}.`);
    const { report, clips } = await w.synth(segs(...texts), defaults(), { tuning: OPEN });
    expect(report.code).toBe('VOICE_OK');
    expect(clips.map((c) => c.segmentId)).toEqual(texts.map((_, i) => `s${i + 1}`));
    return most;
  };

  it('starts with four at once when the account says nothing', async () => {
    expect(await peak(12)).toBe(4);
  });
  it('grows to what the account allows as soon as a response says so', async () => {
    expect(await peak(24, { 'maximum-concurrent-requests': '10' })).toBe(10);
  });
  it('shrinks to what the account allows when that is less', async () => {
    const most = await peak(12, { 'maximum-concurrent-requests': '2' });
    expect(most).toBeLessThanOrEqual(4);
  });
  it('never runs more than twenty at once, whatever the account says', async () => {
    expect(await peak(40, { 'maximum-concurrent-requests': '500' })).toBeLessThanOrEqual(20);
  });
});
