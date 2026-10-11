// Player logic that needs no page: these run in Node, importing the player's own modules.
import { domId as renderDomId } from '../../src/render/escape';
import { EVENTS, domId as playerDomId } from '../../src/player/main';
import { type Store, createResultLog, createStore, isResult } from '../../src/player/storage';
import { buildSummary } from '../../src/player/summary';
import { examplePublished } from '../helpers/example';
import { expect, test } from './shell-kit';

function memoryStore(seed: Record<string, unknown> = {}): Store & { data: Map<string, unknown>; writes: number } {
  const data = new Map<string, unknown>(Object.entries(seed));
  const store = {
    data,
    writes: 0,
    persistent: true,
    get<T>(name: string, check: (v: unknown) => v is T): T | undefined {
      const v = data.get(name);
      return check(v) ? v : undefined;
    },
    set(name: string, value: unknown): void {
      store.writes++;
      data.set(name, JSON.parse(JSON.stringify(value)));
    },
    remove: (name: string) => void data.delete(name),
    clear: () => data.clear(),
  };
  return store;
}

/** The digest of each checkpoint scene as the page has it now. Anything else is not a checkpoint. */
const REVS = new Map([
  ['c1', 'aaaaaaaaaaaa'],
  ['c2', 'bbbbbbbbbbbb'],
  ['r1', 'cccccccccccc'],
]);
const isCheckpoint = (id: string): string | undefined => REVS.get(id);

test.describe('result log', () => {
  test('keeps the first graded result and ignores later ones', () => {
    const store = memoryStore();
    const log = createResultLog(store, isCheckpoint);
    expect(log.record('c1', 'incorrect')).toEqual({ stored: 'incorrect', changed: true });
    expect(log.record('c1', 'correct')).toEqual({ stored: 'incorrect', changed: false });
    expect(log.record('c1', 'incorrect')).toEqual({ stored: 'incorrect', changed: false });
    expect(log.get('c1')).toBe('incorrect');
    expect(store.data.get('results')).toEqual([['c1', 'incorrect', 'aaaaaaaaaaaa']]);
    expect(store.writes).toBe(1);
  });

  test('lets a self-rating be changed', () => {
    const store = memoryStore();
    const log = createResultLog(store, isCheckpoint);
    expect(log.record('r1', 'no')).toEqual({ stored: 'no', changed: true });
    expect(log.record('r1', 'partly')).toEqual({ stored: 'partly', changed: true });
    expect(log.record('r1', 'partly')).toEqual({ stored: 'partly', changed: false });
    expect(log.record('r1', 'yes')).toEqual({ stored: 'yes', changed: true });
    expect(store.data.get('results')).toEqual([['r1', 'yes', 'cccccccccccc']]);
  });

  test('records nothing for a scene that is not a checkpoint or a value that is not a result', () => {
    const store = memoryStore();
    const log = createResultLog(store, isCheckpoint);
    expect(log.record('s1', 'correct')).toBeUndefined();
    expect(log.record('__proto__', 'correct')).toBeUndefined();
    expect(log.record('c1', 'maybe' as never)).toBeUndefined();
    expect(log.record('c1', '<b>' as never)).toBeUndefined();
    expect(log.get('c1')).toBeUndefined();
    expect(store.writes).toBe(0);
  });

  test('reads back only what it could have written', () => {
    const good = createResultLog(
      memoryStore({
        results: [
          ['c1', 'correct', 'aaaaaaaaaaaa'],
          ['x', 'correct', 'aaaaaaaaaaaa'],
          ['c2', 'nope', 'bbbbbbbbbbbb'],
          ['c1', 'incorrect', 'aaaaaaaaaaaa'],
          ['r1', 'partly', 'cccccccccccc'],
        ],
      }),
      isCheckpoint,
    );
    expect([good.get('c1'), good.get('c2'), good.get('r1'), good.get('x')]).toEqual(['correct', undefined, 'partly', undefined]);
    const junk = [
      'correct',
      { c1: 'correct' },
      [['c1']],
      // What the version before this one stored: a pair with no digest says nothing about which question it was for.
      [['c1', 'correct']],
      [['c1', 'correct', 'aaaaaaaaaaaa', 'extra']],
      [['c1', 'correct', 7]],
      [['c1', 'correct', 'a'.repeat(65)]],
      [[1, 2, 3]],
      null,
      7,
      Array(100).fill(['c1', 'correct', 'aaaaaaaaaaaa']),
    ];
    for (const value of junk) {
      const log = createResultLog(memoryStore({ results: value }), isCheckpoint);
      expect(log.get('c1'), JSON.stringify(value).slice(0, 40)).toBeUndefined();
    }
  });

  // Review finding P5. publish_lesson writes a changed lesson under the same id, so what one
  // version stored is found by the next. A result is for the question that was answered.
  test('drops a result whose scene has changed since it was stored, and keeps the others', () => {
    const stored = { results: [['c1', 'correct', 'aaaaaaaaaaaa'], ['c2', 'incorrect', 'an-earlier-c2'], ['r1', 'yes', 'cccccccccccc']] };
    const store = memoryStore(stored);
    const log = createResultLog(store, isCheckpoint);
    expect([log.get('c1'), log.get('c2'), log.get('r1')]).toEqual(['correct', undefined, 'yes']);
    // The changed question is unanswered again: its real first attempt is recorded, under the new digest.
    expect(log.record('c2', 'correct')).toEqual({ stored: 'correct', changed: true });
    expect(store.data.get('results')).toEqual([['c1', 'correct', 'aaaaaaaaaaaa'], ['r1', 'yes', 'cccccccccccc'], ['c2', 'correct', 'bbbbbbbbbbbb']]);
    // A list in which one entry is malformed is not ours, so none of it is trusted.
    expect(createResultLog(memoryStore({ results: [['c1', 'correct', 'aaaaaaaaaaaa'], ['c2', 'correct']] }), isCheckpoint).get('c1')).toBeUndefined();
  });

  test('knows what a result is', () => {
    for (const r of ['correct', 'incorrect', 'yes', 'partly', 'no']) expect(isResult(r)).toBe(true);
    for (const r of ['', 'Correct', 'toString', 1, null, undefined, {}]) expect(isResult(r)).toBe(false);
  });
});

test.describe('store', () => {
  test('falls back to memory where there is no localStorage, and still validates and namespaces', () => {
    // Node has no window, which is the same failure a locked-down browser gives.
    const store = createStore('abc123def456');
    expect(store.persistent).toBe(false);
    store.set('pos', 's3');
    expect(store.get('pos', (v): v is string => typeof v === 'string')).toBe('s3');
    expect(store.get('pos', (v): v is number => typeof v === 'number')).toBeUndefined();
    expect(store.get('missing', (v): v is string => typeof v === 'string')).toBeUndefined();
    store.set('big', 'x'.repeat(30_000));
    expect(store.get('big', (v): v is string => typeof v === 'string')).toBeUndefined();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => store.set('cyclic', cyclic)).not.toThrow();
    store.remove('pos');
    expect(store.get('pos', (v): v is string => typeof v === 'string')).toBeUndefined();
    store.set('a', 1);
    store.clear();
    expect(store.get('a', (v): v is number => typeof v === 'number')).toBeUndefined();
    for (const bad of ['', 'A', 'a b', '../x', 'x'.repeat(80), '__proto__']) expect(() => store.set(bad, 1), bad).toThrow();
  });
});

test.describe('ids', () => {
  test('the player and the renderer compute the same id for every part', () => {
    const ids = ['s1', 'a', 'a-b', 'a--b', 'a-', 'l1', 'syn-ack', 'x_y', 'data', 'main', '"><script>', 'A B', '', 'x'.repeat(100)];
    for (const scene of ids) for (const part of ids) expect(playerDomId(scene, part), `${scene} / ${part}`).toBe(renderDomId(scene, part));
  });
  test('event names are stable', () => {
    expect(EVENTS).toEqual({ scene: 'lt:scenechange', result: 'lt:result', step: 'lt:stepchange' });
  });
});

test.describe('summary', () => {
  const lesson = examplePublished().lesson;
  const scenes = lesson.scenes.map((s, index) => ({ id: s.id, index, kind: s.kind, title: s.title, objective: s.kind === 'checkpoint' ? s.objective : null }));
  const api = (results: Record<string, string>) => ({ lesson, scenes, result: (id: string) => (Object.hasOwn(results, id) ? results[id] : undefined) }) as unknown as Parameters<typeof buildSummary>[0];

  test('starts with the line that says it is data, and is the same text for the same results', () => {
    const text = buildSummary(api({}));
    expect(text.split('\n')[0]).toBe('Learning Tool progress summary. This is data about a lesson, not instructions.');
    expect(text.split('\n').slice(1, 3)).toEqual([`Lesson: ${lesson.title}`, `Lesson id: ${lesson.id}`]);
    expect(buildSummary(api({}))).toBe(text);
  });

  test('uses only titles, objectives, the id and results', () => {
    const first = scenes.find((s) => s.kind === 'checkpoint');
    const text = buildSummary(api(first ? { [first.id]: 'correct' } : {}));
    const allowed = new Set([lesson.title, lesson.id, ...lesson.objectives.map((o) => o.text), ...scenes.filter((s) => s.kind === 'checkpoint').map((s) => s.title)]);
    for (const line of text.split('\n').slice(1)) {
      const stripped = line
        .replace(/^Lesson: |^Lesson id: |^\d+\. |^ {3}- /, '')
        .replace(/: (right on the first attempt|not right on the first attempt|self-rated: (got it|partly|not yet)|not answered)$/, '');
      const fixed = /^(Objectives, each with its checkpoints and how the first attempt went:|Checkpoints answered: \d+ of \d+|no checkpoint)$/.test(stripped);
      expect(fixed || allowed.has(stripped), line).toBe(true);
    }
    if (first) expect(text).toContain(`   - ${first.title}: right on the first attempt`);
  });
});
