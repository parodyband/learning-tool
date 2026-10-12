// Voice is on only when the learner set a real key for Learning Tool, and the object that says so
// does not contain the key.
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { voiceConfigFromEnv, voiceEnvProblems } from '../../src/tts';
import { FAKE_KEY, FAKE_KEY_MARKER, KEY_VAR, MAX_VAR, MODEL_VAR, VOICE_VAR } from './helpers/kit';

describe('voiceConfigFromEnv: when voice is off', () => {
  it.each([
    ['nothing set', {}],
    ['an empty key', { [KEY_VAR]: '' }],
    ['a key of spaces', { [KEY_VAR]: '   \n' }],
    ['an unfilled plugin placeholder', { [KEY_VAR]: '${user_config.elevenlabs_api_key}' }],
    ['a placeholder inside other text', { [KEY_VAR]: 'sk_${ELEVENLABS_KEY}_0123456789abcdef' }],
    ['a value too short to be a key', { [KEY_VAR]: 'changeme' }],
    ['a key with a space inside', { [KEY_VAR]: 'sk_0123456789 abcdef0123456789' }],
    ['a key with a line break inside', { [KEY_VAR]: 'sk_0123456789\nabcdef0123456789' }],
    ['a key with non-ASCII characters', { [KEY_VAR]: 'sk_0123456789abcdeféééé' }],
    ['only the generic variable', { ELEVENLABS_API_KEY: FAKE_KEY }],
    ['only the generic variable in other spellings', { ELEVEN_API_KEY: FAKE_KEY, XI_API_KEY: FAKE_KEY, ELEVENLABS_KEY: FAKE_KEY }],
  ])('%s', (_name, env) => {
    expect(voiceConfigFromEnv(env)).toBeNull();
  });

  it('never reads the generic ELEVENLABS_API_KEY, even to look', () => {
    const read: string[] = [];
    const env = new Proxy<Record<string, string>>(
      { ELEVENLABS_API_KEY: FAKE_KEY, [KEY_VAR]: FAKE_KEY },
      {
        get(target, name) {
          read.push(String(name));
          return target[String(name)];
        },
        has(target, name) {
          read.push(String(name));
          return String(name) in target;
        },
        ownKeys(target) {
          read.push('<enumerated>');
          return Reflect.ownKeys(target);
        },
      },
    );
    expect(voiceConfigFromEnv(env)).not.toBeNull();
    voiceEnvProblems(env);
    expect([...new Set(read)].sort()).toEqual([KEY_VAR, MODEL_VAR, VOICE_VAR, MAX_VAR].sort());
  });
});

describe('voiceConfigFromEnv: when voice is on', () => {
  it('applies the defaults', () => {
    expect(voiceConfigFromEnv({ [KEY_VAR]: FAKE_KEY })).toEqual({ provider: 'elevenlabs', model: 'eleven_v4_turbo', voiceId: null, maxChars: 12000 });
  });

  it('accepts a key with surrounding whitespace', () => {
    expect(voiceConfigFromEnv({ [KEY_VAR]: `  ${FAKE_KEY}\n` })).not.toBeNull();
  });

  it('accepts an old-style key of 32 hex characters', () => {
    expect(voiceConfigFromEnv({ [KEY_VAR]: '0123456789abcdef0123456789abcdef' })).not.toBeNull();
  });

  it('reads the optional settings', () => {
    const config = voiceConfigFromEnv({ [KEY_VAR]: FAKE_KEY, [VOICE_VAR]: 'Xb7hH8MSUJpSbSDYk0k2', [MODEL_VAR]: 'eleven_flash_v2_5', [MAX_VAR]: '4000' });
    expect(config).toEqual({ provider: 'elevenlabs', model: 'eleven_flash_v2_5', voiceId: 'Xb7hH8MSUJpSbSDYk0k2', maxChars: 4000 });
  });

  it.each([
    ['empty', ''],
    ['spaces', '  '],
    ['an unfilled placeholder', '${user_config.voice_id}'],
  ])('treats an optional setting that is %s as not set', (_name, value) => {
    const config = voiceConfigFromEnv({ [KEY_VAR]: FAKE_KEY, [VOICE_VAR]: value, [MODEL_VAR]: value, [MAX_VAR]: value });
    expect(config).toEqual({ provider: 'elevenlabs', model: 'eleven_v4_turbo', voiceId: null, maxChars: 12000 });
    expect(voiceEnvProblems({ [KEY_VAR]: FAKE_KEY, [VOICE_VAR]: value, [MODEL_VAR]: value, [MAX_VAR]: value })).toEqual([]);
  });

  it('accepts a budget of zero and the largest budget', () => {
    expect(voiceConfigFromEnv({ [KEY_VAR]: FAKE_KEY, [MAX_VAR]: '0' })?.maxChars).toBe(0);
    expect(voiceConfigFromEnv({ [KEY_VAR]: FAKE_KEY, [MAX_VAR]: '1000000' })?.maxChars).toBe(1_000_000);
  });

  it('takes process.env as Node types it', () => {
    // As much a compile-time check as a runtime one: the server passes process.env straight in.
    expect(() => voiceEnvProblems(process.env)).not.toThrow();
    expect(() => voiceConfigFromEnv(process.env)).not.toThrow();
  });

  it('returns a frozen object', () => {
    const config = voiceConfigFromEnv({ [KEY_VAR]: FAKE_KEY });
    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe('voiceConfigFromEnv: a malformed setting turns voice off and says which one', () => {
  it.each([
    [VOICE_VAR, 'abc', 'too short'],
    [VOICE_VAR, 'a'.repeat(65), 'too long'],
    [VOICE_VAR, 'JBFq/../../v1/user', 'path characters'],
    [VOICE_VAR, 'JBFqnCBsd6RM?x=1', 'query characters'],
    [VOICE_VAR, 'JBFqnCBsd6RM kjVD', 'a space'],
    [VOICE_VAR, 'JBFqnCBsd6RM-kjVD', 'a hyphen'],
    [VOICE_VAR, 'voicé_id_here', 'non-ASCII'],
    [MODEL_VAR, 'eleven flash', 'a space'],
    [MODEL_VAR, 'eleven.v3', 'a dot'],
    [MAX_VAR, '12k', 'a suffix'],
    [MAX_VAR, '-5', 'a sign'],
    [MAX_VAR, '1e3', 'an exponent'],
    [MAX_VAR, '12,000', 'a separator'],
    [MAX_VAR, '1000001', 'above the ceiling'],
    [MAX_VAR, '99999999', 'too many digits'],
  ])('%s = %j (%s)', (variable, value) => {
    const env = { [KEY_VAR]: FAKE_KEY, [variable]: value };
    expect(voiceConfigFromEnv(env)).toBeNull();
    const problems = voiceEnvProblems(env);
    expect(problems.map((p) => p.variable)).toEqual([variable]);
    // The sentence is fixed text: it never quotes what was in the variable.
    expect(problems[0]?.problem).not.toContain(value);
  });

  it('reports a malformed key without quoting it', () => {
    const bad = 'not a key at all, but long enough';
    expect(voiceEnvProblems({ [KEY_VAR]: bad })).toEqual([{ variable: KEY_VAR, problem: expect.not.stringContaining('not a key') }]);
    expect(voiceEnvProblems({ [KEY_VAR]: '${user_config.key}' })).toEqual([{ variable: KEY_VAR, problem: expect.stringContaining('placeholder') }]);
  });

  it('reports nothing when voice is simply not configured', () => {
    expect(voiceEnvProblems({})).toEqual([]);
    expect(voiceEnvProblems({ [KEY_VAR]: '' })).toEqual([]);
  });

  it.each([
    ['the same key', FAKE_KEY],
    ['another key-shaped value', 'sk_0123456789abcdef0123456789abcdef0123456789abcdef'],
    ['a piece of the key', FAKE_KEY.slice(10, 40)],
  ])('refuses %s pasted into the voice or model variable', (_name, value) => {
    for (const variable of [VOICE_VAR, MODEL_VAR]) {
      const env = { [KEY_VAR]: FAKE_KEY, [variable]: value };
      expect(voiceConfigFromEnv(env)).toBeNull();
      const problems = voiceEnvProblems(env);
      expect(problems).toHaveLength(1);
      expect(JSON.stringify(problems)).not.toContain(value);
    }
  });
});

describe('the configuration object does not contain the key', () => {
  const config = voiceConfigFromEnv({ [KEY_VAR]: FAKE_KEY, [VOICE_VAR]: 'Xb7hH8MSUJpSbSDYk0k2' });

  it('has exactly four plain properties', () => {
    expect(Reflect.ownKeys(config as object).sort()).toEqual(['maxChars', 'model', 'provider', 'voiceId']);
    expect(Object.getOwnPropertySymbols(config)).toEqual([]);
    expect(Object.getPrototypeOf(config)).toBe(Object.prototype);
  });

  it.each([
    ['JSON.stringify', (c: unknown) => JSON.stringify(c)],
    ['util.inspect with hidden properties', (c: unknown) => inspect(c, { showHidden: true, depth: Infinity, getters: true })],
    ['String()', (c: unknown) => String(c)],
    ['a spread copy', (c: unknown) => JSON.stringify({ ...(c as object) })],
    ['structuredClone', (c: unknown) => inspect(structuredClone(c), { showHidden: true, depth: Infinity })],
    ['property descriptors', (c: unknown) => inspect(Object.getOwnPropertyDescriptors(c), { showHidden: true, depth: Infinity })],
  ])('%s shows no key', (_name, render) => {
    const text = render(config);
    expect(text).not.toContain(FAKE_KEY);
    expect(text.toLowerCase()).not.toContain(FAKE_KEY_MARKER);
  });
});
