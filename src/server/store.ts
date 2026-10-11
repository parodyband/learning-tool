// The store: drafts between tool calls, and the published lesson files.
//
//   <home>/lessons/<slug>-<id6>.html     published lessons
//   <home>/.state/drafts/<id>.json       one draft per lesson
//   <home>/.state/voice-cache/           owned by the voice module
//
// Rules this file keeps:
//   - Nothing is created until the first write. Constructing a Store touches nothing, because a host
//     may start the server process twice and throw one away.
//   - Every write goes to a temporary file in the same folder and is renamed into place, so a
//     reader sees the old file or the new one, never half of either.
//   - `.state` and everything under it is 0700, and every file this server writes is 0600.
//   - Folders under the home must be real folders, and a file is never read or replaced through a
//     symbolic link. The home itself may be a link the learner made (a synced or external drive).
//   - The only names used are a lesson id that matches LESSON_ID_PATTERN and a file name from
//     paths.lessonFileName. No tool argument is ever joined into a path.
import { randomBytes, randomInt } from 'node:crypto';
import { constants as FS, type Dirent } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DEPTHS } from '../core/limits';
import { LESSON_ID_PATTERN, type StartInput } from '../core/schema';
import type { Draft } from '../core/types';
import type { ServerIssueCode } from './issues';
import { isLessonFileName } from './paths';

export const DRAFT_FORMAT = 'learning-tool/draft@1' as const;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** A draft is a few hundred kilobytes at most; anything larger is not one of ours. */
const MAX_DRAFT_BYTES = 8 * 1024 * 1024;
const DRAFT_FILE = /^([a-z0-9]{12})\.json$/;
// Not defined on Windows, where there is nothing to refuse.
const NOFOLLOW = FS.O_NOFOLLOW ?? 0;

/** A failure of the store, already reduced to a code and a sentence that is safe to show an agent. */
export class StoreError extends Error {
  override readonly name = 'StoreError';
  constructor(
    readonly code: ServerIssueCode,
    message: string,
    /** The operating system's error code (EACCES, ENOSPC ...), when there was one. Never a path or file content. */
    readonly errno?: string,
  ) {
    super(message);
  }
}

const errnoOf = (e: unknown): string | undefined => {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,24}$/.test(code) ? code : undefined;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Turn anything a file operation threw into a StoreError. The original message may name paths and is dropped. */
function storeFailure(e: unknown, doing: string): StoreError {
  if (e instanceof StoreError) return e;
  const errno = errnoOf(e);
  if (errno === 'ELOOP' || errno === 'EMLINK') return new StoreError('STORE_UNSAFE', `Could not ${doing}: a symbolic link stands where the Learning Tool folder expects a plain file.`, errno);
  return new StoreError('STORE_FAILED', `Could not ${doing}${errno ? ` (${errno})` : ''}.`, errno);
}

/** The lesson id: 12 characters of a-z and 0-9, from the system's random source. */
export function mintLessonId(): string {
  let id = '';
  for (let i = 0; i < 12; i++) id += ID_ALPHABET.charAt(randomInt(ID_ALPHABET.length));
  return id;
}

export class Store {
  readonly home: string;
  private readonly clock: () => Date;
  /** One queue of work per lesson, so that a read-change-write never interleaves with another. */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(home: string, clock: () => Date = () => new Date()) {
    if (!path.isAbsolute(home)) throw new TypeError('Store: the home must be an absolute path.');
    this.home = home;
    this.clock = clock;
  }

  get lessonsDir(): string {
    return path.join(this.home, 'lessons');
  }
  get stateDir(): string {
    return path.join(this.home, '.state');
  }
  get draftsDir(): string {
    return path.join(this.stateDir, 'drafts');
  }
  /** Handed to the voice module, which creates and owns it. */
  get voiceCacheDir(): string {
    return path.join(this.stateDir, 'voice-cache');
  }

  /** Run `work` when every earlier piece of work on the same lesson has finished. */
  serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const before = this.queues.get(key) ?? Promise.resolve();
    const result = before.then(work);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    });
    return result;
  }

  // -------------------------------------------------------------------------------------------
  // Folders
  // -------------------------------------------------------------------------------------------

  /** Make one folder under the home, private or not, and refuse to go on if what is there is not a plain folder. */
  private async folder(dir: string, mode: number): Promise<void> {
    try {
      await mkdir(dir, { mode });
    } catch (e) {
      if (errnoOf(e) !== 'EEXIST') throw storeFailure(e, 'create the Learning Tool folder');
    }
    let info;
    try {
      info = await lstat(dir);
    } catch (e) {
      throw storeFailure(e, 'read the Learning Tool folder');
    }
    const name = path.relative(this.home, dir) || 'home';
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new StoreError('STORE_UNSAFE', `"${name}" inside the Learning Tool home is a symbolic link or a file, not a folder, so nothing was written.`);
    }
    // A folder that was already there keeps whatever mode it had; private folders are put back to 0700.
    if (mode === 0o700 && (info.mode & 0o777) !== 0o700) {
      try {
        await chmod(dir, 0o700);
      } catch (e) {
        throw storeFailure(e, 'protect the Learning Tool folder');
      }
    }
  }

  /** Create the folders, once per write. Returns the home with links resolved, the base of every containment check. */
  private async prepare(): Promise<string> {
    try {
      await mkdir(this.home, { recursive: true });
    } catch (e) {
      throw storeFailure(e, 'create the Learning Tool folder');
    }
    let real: string;
    try {
      real = await realpath(this.home);
    } catch (e) {
      throw storeFailure(e, 'read the Learning Tool folder');
    }
    await this.folder(this.stateDir, 0o700);
    await this.folder(this.draftsDir, 0o700);
    await this.folder(this.lessonsDir, 0o755);
    return real;
  }

  /** `dir` must be exactly `<real home>/<segments>` once links are resolved: nothing in between points elsewhere. */
  private async contained(realHome: string, dir: string, ...segments: string[]): Promise<void> {
    let real: string;
    try {
      real = await realpath(dir);
    } catch (e) {
      throw storeFailure(e, 'read the Learning Tool folder');
    }
    if (real !== path.join(realHome, ...segments)) {
      throw new StoreError('STORE_UNSAFE', `"${segments.join('/')}" inside the Learning Tool home leads somewhere else, so nothing was written.`);
    }
  }

  /** Write `data` to `<dir>/<name>` by way of a temporary file and a rename. The file is 0600. */
  private async replace(dir: string, name: string, data: string | Uint8Array, doing: string): Promise<string> {
    const target = path.join(dir, name);
    const temp = path.join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
    let handle;
    try {
      // "wx" fails if the name exists, link or not, so the bytes can only land in a file made here.
      handle = await open(temp, 'wx', 0o600);
    } catch (e) {
      throw storeFailure(e, doing);
    }
    try {
      await handle.writeFile(data);
      await handle.sync();
      await handle.close();
      handle = undefined;
      // rename replaces the name itself. If a link stands at the target, the link is replaced, not followed.
      await rename(temp, target);
    } catch (e) {
      await handle?.close().catch(() => undefined);
      await unlink(temp).catch(() => undefined);
      throw storeFailure(e, doing);
    }
    return target;
  }

  // -------------------------------------------------------------------------------------------
  // Drafts
  // -------------------------------------------------------------------------------------------

  private draftPath(id: string): string {
    // The one place an id becomes part of a path. Callers check the id; this checks again.
    if (typeof id !== 'string' || !LESSON_ID_PATTERN.test(id)) throw new TypeError('Store: not a lesson id.');
    return path.join(this.draftsDir, `${id}.json`);
  }

  /** A new draft with a freshly minted id, written to disk. `calls` seeds the activity count with the call that made it. */
  async create(start: StartInput, calls: Record<string, number> = {}): Promise<Draft> {
    const realHome = await this.prepare();
    await this.contained(realHome, this.draftsDir, '.state', 'drafts');
    const now = this.clock().toISOString();
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = mintLessonId();
      const file = this.draftPath(id);
      const draft: Draft = {
        format: DRAFT_FORMAT,
        id,
        createdAt: now,
        updatedAt: now,
        topic: start.topic,
        language: start.language,
        depth: start.depth,
        learner: start.learner,
        objectives: [],
        outline: [],
        evidence: [],
        scenes: [],
        activity: { calls: { ...calls }, rejects: {} },
      };
      try {
        // An id that is somehow taken is never overwritten.
        await lstat(file);
        continue;
      } catch (e) {
        if (errnoOf(e) !== 'ENOENT') throw storeFailure(e, 'store the new lesson');
      }
      await this.replace(this.draftsDir, path.basename(file), JSON.stringify(draft), 'store the new lesson');
      return draft;
    }
    throw new StoreError('STORE_FAILED', 'Could not find a free lesson id.');
  }

  /** The draft for `id`, or null when there is none. Throws DRAFT_UNREADABLE for a file that is not a draft of that lesson. */
  async load(id: string): Promise<Draft | null> {
    const file = this.draftPath(id);
    let text: string;
    let handle;
    try {
      handle = await open(file, FS.O_RDONLY | NOFOLLOW);
    } catch (e) {
      const errno = errnoOf(e);
      if (errno === 'ENOENT' || errno === 'ENOTDIR') return null;
      throw storeFailure(e, 'read the stored lesson');
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_DRAFT_BYTES) throw new StoreError('DRAFT_UNREADABLE', 'The stored draft of this lesson is not a draft file.');
      text = await handle.readFile('utf8');
    } catch (e) {
      throw storeFailure(e, 'read the stored lesson');
    } finally {
      await handle.close().catch(() => undefined);
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      // The parser's message quotes the file; it is not passed on.
      throw new StoreError('DRAFT_UNREADABLE', 'The stored draft of this lesson is not valid JSON.');
    }
    if (!isRecord(value) || value.format !== DRAFT_FORMAT || value.id !== id) {
      throw new StoreError('DRAFT_UNREADABLE', 'The stored draft of this lesson is not a draft of that lesson.');
    }
    // The header is what every tool reads before the validator is involved, so it has to be whole.
    const header = typeof value.topic === 'string' && typeof value.language === 'string' && typeof value.depth === 'string' && Object.hasOwn(DEPTHS, value.depth) && isRecord(value.learner);
    if (!header) throw new StoreError('DRAFT_UNREADABLE', 'The stored draft of this lesson has lost its topic, language, depth or learner.');
    return normalise(value);
  }

  /** Write the draft back. `touch: false` records bookkeeping without counting as a change to the lesson. */
  async save(draft: Draft, options: { touch?: boolean } = {}): Promise<void> {
    const file = this.draftPath(draft.id);
    const realHome = await this.prepare();
    await this.contained(realHome, this.draftsDir, '.state', 'drafts');
    if (options.touch !== false) draft.updatedAt = this.clock().toISOString();
    await this.replace(this.draftsDir, path.basename(file), JSON.stringify(draft), 'store the lesson');
  }

  /** The most recently written drafts, newest first. Reads nothing but the drafts folder, and creates nothing. */
  async recent(limit: number): Promise<Draft[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.draftsDir, { withFileTypes: true });
    } catch (e) {
      const errno = errnoOf(e);
      if (errno === 'ENOENT' || errno === 'ENOTDIR') return [];
      throw storeFailure(e, 'list the stored lessons');
    }
    const found: { id: string; at: number }[] = [];
    for (const entry of entries) {
      const id = DRAFT_FILE.exec(entry.name)?.[1];
      if (!id || !entry.isFile()) continue;
      try {
        found.push({ id, at: (await stat(path.join(this.draftsDir, entry.name))).mtimeMs });
      } catch {
        // gone between the listing and the stat: not a recent draft any more
      }
    }
    found.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
    // File times choose which drafts to read (reading every draft would not scale); a file system may
    // keep them only to the second, so the order among those read is settled by the drafts' own clocks.
    const out: Draft[] = [];
    for (const { id } of found.slice(0, limit + 8)) {
      try {
        const draft = await this.load(id);
        if (draft) out.push(draft);
      } catch {
        // a damaged draft is reported when it is asked for by id; a listing just leaves it out
      }
    }
    const when = (draft: Draft): number => Date.parse(draft.updatedAt) || 0;
    // The sort is stable, so drafts changed at the same instant stay in file-time order.
    return out.sort((a, b) => when(b) - when(a)).slice(0, limit);
  }

  // -------------------------------------------------------------------------------------------
  // Published lessons
  // -------------------------------------------------------------------------------------------

  /** Where a published lesson with this file name lives. The name must be one this server made for this lesson. */
  lessonPath(fileName: string, lessonId: string): string {
    if (!isLessonFileName(fileName, lessonId)) throw new TypeError('Store: not a lesson file name.');
    return path.join(this.lessonsDir, fileName);
  }

  /** Write (or replace) a published lesson. Returns its absolute path. */
  async writeLesson(fileName: string, lessonId: string, html: string): Promise<string> {
    const target = this.lessonPath(fileName, lessonId);
    const realHome = await this.prepare();
    await this.contained(realHome, this.lessonsDir, 'lessons');
    return this.replace(this.lessonsDir, path.basename(target), html, 'write the lesson file');
  }

  /** True when the published file is there as a plain file. */
  async lessonExists(fileName: string, lessonId: string): Promise<boolean> {
    if (!isLessonFileName(fileName, lessonId)) return false;
    try {
      const info = await lstat(path.join(this.lessonsDir, fileName));
      return info.isFile();
    } catch {
      return false;
    }
  }
}

/**
 * A draft as the rest of the server may rely on it: the lists are lists and the counters exist.
 * What is inside the lists is not checked here. The validator reads a draft defensively, and a
 * damaged entry surfaces there as an issue with a fix.
 */
function normalise(value: Record<string, unknown>): Draft {
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const counts = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (isRecord(v)) for (const [key, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[key] = n;
    return out;
  };
  const activity = isRecord(value.activity) ? value.activity : {};
  const draft = {
    ...value,
    objectives: list(value.objectives),
    outline: list(value.outline),
    evidence: list(value.evidence),
    scenes: list(value.scenes),
    activity: { calls: counts(activity.calls), rejects: counts(activity.rejects) },
  };
  return draft as unknown as Draft;
}

/** Read a published lesson file for the local listener: a plain file only, never through a link. */
export async function readPlainFile(file: string, maxBytes: number): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(file, FS.O_RDONLY | NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return null;
    return await handle.readFile();
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
