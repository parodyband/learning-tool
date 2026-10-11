// Progress storage. Everything a lesson keeps goes through here, under keys that begin
// `lt:<lessonId>:`, so "clear my progress" can remove exactly this lesson's keys and nothing else.
//
// Three facts shape it (all measured; see the research brief):
//   - localStorage can throw on any call (blocked storage, private mode, quota), so every call is
//     guarded and the store falls back to memory without telling its callers.
//   - On file:// every local HTML file shares one localStorage. What is read back may have been
//     written by anything, so a value is only returned after the caller's own check accepts it.
//   - For the same reason nothing a learner types is ever stored here.

export interface Store {
  /** Read a value written with `set`. Returns undefined unless `check` accepts what was found. */
  get<T>(name: string, check: (value: unknown) => value is T): T | undefined;
  /** Store a JSON-serialisable value. Never throws. */
  set(name: string, value: unknown): void;
  remove(name: string): void;
  /** Remove every key this lesson has written. */
  clear(): void;
  /** False when the browser refused storage and values last only until the page is closed. */
  readonly persistent: boolean;
}

const NAME = /^[a-z][a-z0-9._-]{0,63}$/;
/** A stored value larger than this was not written by us. */
const MAX_CHARS = 20_000;

/** localStorage, if it can really be written to. The test key is this lesson's own, like every other key. */
function localStore(prefix: string): Storage | null {
  try {
    const s = window.localStorage;
    const probe = `${prefix}probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function createStore(lessonId: string): Store {
  // The id comes from the page's own data, but it becomes part of a storage key, so it is held to the format the server mints.
  const prefix = `lt:${/^[a-z0-9]{1,32}$/.test(lessonId) ? lessonId : 'lesson'}:`;
  const memory = new Map<string, string>();
  const disk = localStore(prefix);

  const key = (name: string): string => {
    if (!NAME.test(name)) throw new Error('store: bad key name');
    return prefix + name;
  };

  const readRaw = (k: string): string | null => {
    if (memory.has(k)) return memory.get(k) as string;
    if (!disk) return null;
    try {
      return disk.getItem(k);
    } catch {
      return null;
    }
  };

  return {
    persistent: disk !== null,
    get(name, check) {
      const text = readRaw(key(name));
      if (text === null || text.length > MAX_CHARS) return undefined;
      try {
        const value: unknown = JSON.parse(text);
        return check(value) ? value : undefined;
      } catch {
        return undefined;
      }
    },
    set(name, value) {
      const k = key(name);
      let text: string;
      try {
        text = JSON.stringify(value);
      } catch {
        return;
      }
      if (typeof text !== 'string' || text.length > MAX_CHARS) return;
      if (disk) {
        try {
          disk.setItem(k, text);
          memory.delete(k);
          return;
        } catch {
          // Fall through: keep it for this visit at least.
        }
      }
      memory.set(k, text);
    },
    remove(name) {
      const k = key(name);
      memory.delete(k);
      try {
        disk?.removeItem(k);
      } catch {
        // Nothing to do: the key is gone from memory, which is what this visit reads first.
      }
    },
    clear() {
      memory.clear();
      if (!disk) return;
      try {
        const mine: string[] = [];
        for (let i = 0; i < disk.length; i++) {
          const k = disk.key(i);
          if (k !== null && k.startsWith(prefix)) mine.push(k);
        }
        for (const k of mine) disk.removeItem(k);
      } catch {
        // Storage went away between calls. Memory is already empty.
      }
    },
  };
}

/**
 * What happened on a checkpoint. A graded question records `correct` or `incorrect` for the FIRST
 * attempt only. A reflect question records the learner's own rating, which they may change.
 */
export type CheckpointResult = 'correct' | 'incorrect' | 'yes' | 'partly' | 'no';

export const GRADED_RESULTS: readonly CheckpointResult[] = ['correct', 'incorrect'];
export const SELF_RATINGS: readonly CheckpointResult[] = ['yes', 'partly', 'no'];
export const ALL_RESULTS: readonly CheckpointResult[] = [...GRADED_RESULTS, ...SELF_RATINGS];

export function isResult(value: unknown): value is CheckpointResult {
  return typeof value === 'string' && (ALL_RESULTS as readonly string[]).includes(value);
}

export interface ResultLog {
  /**
   * Record a result and return what is now stored for that scene. Returns undefined, and stores
   * nothing, when the scene is not a checkpoint or the value is not a result.
   */
  record(sceneId: string, result: CheckpointResult): { stored: CheckpointResult; changed: boolean } | undefined;
  get(sceneId: string): CheckpointResult | undefined;
}

/** [sceneId, result, rev]. A list of anything else (the pairs an earlier version stored, for one) is not read at all. */
const isEntries = (v: unknown): v is [string, string, string][] =>
  Array.isArray(v) && v.length <= 64 && v.every((p) => Array.isArray(p) && p.length === 3 && p.every((x) => typeof x === 'string' && x.length <= 64));

/**
 * Checkpoint results, kept in a Map and stored as a list, never as an object keyed by scene id.
 *
 * A result is about one question. `revOf` gives the digest of a checkpoint scene as it is in this
 * page (undefined for anything that is not a checkpoint), and each result is stored with the
 * digest of the scene it was given for. A lesson can be published again under the same id with a
 * question rewritten; a result read back whose digest is not the scene's is dropped, so the new
 * question starts unanswered and the summary never reports an attempt that was not made. Results
 * for scenes that did not change are kept.
 */
export function createResultLog(store: Store, revOf: (sceneId: string) => string | undefined): ResultLog {
  const results = new Map<string, CheckpointResult>();
  for (const [sceneId, result, rev] of store.get('results', isEntries) ?? []) {
    if (revOf(sceneId) === rev && isResult(result) && !results.has(sceneId)) results.set(sceneId, result);
  }
  return {
    get: (sceneId) => results.get(sceneId),
    record(sceneId, result) {
      if (revOf(sceneId) === undefined || !isResult(result)) return undefined;
      const before = results.get(sceneId);
      // First attempt only: once a graded result is in, nothing replaces it. A graded result does
      // replace an earlier self-rating, and a self-rating replaces a self-rating.
      if (before !== undefined && GRADED_RESULTS.includes(before)) return { stored: before, changed: false };
      if (before === result) return { stored: before, changed: false };
      results.set(sceneId, result);
      store.set(
        'results',
        Array.from(results, ([id, kept]) => [id, kept, revOf(id) ?? '']),
      );
      return { stored: result, changed: true };
    },
  };
}
