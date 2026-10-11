// The on-disk clip cache. ElevenLabs bills every synthesis, including a repeat of the same text, and
// its output is not reproducible, so a clip is kept under a hash of everything that determines it.
// Republishing an unchanged lesson then makes no request at all, and a publish that ran out of time
// is finished by the next one.
//
// Nothing here involves the key: not the file names, not the contents. Only files this module
// named are ever read, replaced or deleted.
import { createHash, randomBytes } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { looksLikeMp3 } from './mp3';
import { PREPROCESSOR_VERSION } from './text';

/** Largest clip accepted from ElevenLabs or from the cache: about 16 minutes at 64 kbit/s. */
export const MAX_CLIP_BYTES = 8 * 1024 * 1024;
export const DEFAULT_CACHE_MAX_BYTES = 256 * 1024 * 1024;

const CLIP_FILE = /^[0-9a-f]{64}\.mp3$/;
const TEMP_FILE = /^(?:[0-9a-f]{64}|voice)\.[0-9a-f]{16}\.tmp$/;
const VOICE_FILE = 'voice.json';
const STALE_TEMP_MS = 10 * 60 * 1000;
// Absent on Windows, where the flag has no meaning.
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/** SHA-256 over everything that determines a clip. Changing any part is a different clip. */
export function clipKey(parts: { model: string; voiceId: string; format: string; seed: number; text: string }): string {
  const material = JSON.stringify(['learning-tool/voice', PREPROCESSOR_VERSION, parts.model, parts.voiceId, parts.format, parts.seed, parts.text]);
  return createHash('sha256').update(material).digest('hex');
}

/** The voice picked from the account last time, so the choice (and with it every cache key) stays stable. */
export interface RememberedVoice {
  id: string;
  name: string;
  /** `Date.now()` when the choice was last confirmed against the account. */
  at: number;
}

export class ClipCache {
  private constructor(
    private readonly dir: string,
    /** False when the directory cannot be used. Synthesis still works; every clip is then paid for again. */
    readonly usable: boolean,
  ) {}

  static async open(dir: string): Promise<ClipCache> {
    try {
      // 0700 applies to what is created here. A directory that already exists keeps the mode its
      // owner gave it: changing permissions on a path we were merely handed is not ours to do.
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      // lstat, so a symlink planted at the cache path is refused rather than followed.
      const stat = await fs.lstat(dir);
      return new ClipCache(dir, stat.isDirectory());
    } catch {
      return new ClipCache(dir, false);
    }
  }

  private async readFile(name: string, maxBytes: number, accept: (bytes: Buffer) => boolean): Promise<Buffer | null> {
    if (!this.usable) return null;
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(path.join(this.dir, name), constants.O_RDONLY | NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) return null;
      const bytes = await handle.readFile();
      if (!accept(bytes)) return null;
      // Mark it as used, through the handle that was just read, so pruning removes what nobody
      // republishes first.
      const now = new Date();
      await handle.utimes(now, now).catch(() => undefined);
      return bytes;
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  // Write to a fresh temp file, then rename: a reader sees the old file or the new one, never half.
  private async replaceFile(name: string, stem: string, bytes: Uint8Array): Promise<boolean> {
    if (!this.usable) return false;
    const temp = path.join(this.dir, `${stem}.${randomBytes(8).toString('hex')}.tmp`);
    try {
      const handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      await fs.rename(temp, path.join(this.dir, name));
      return true;
    } catch {
      await fs.unlink(temp).catch(() => undefined);
      return false;
    }
  }

  /** A cached clip, or null. A file that is not an MP3 any more is treated as missing. */
  read(key: string): Promise<Uint8Array | null> {
    return this.readFile(`${key}.mp3`, MAX_CLIP_BYTES, looksLikeMp3);
  }

  write(key: string, bytes: Uint8Array): Promise<boolean> {
    return this.replaceFile(`${key}.mp3`, key, bytes);
  }

  async readVoice(): Promise<RememberedVoice | null> {
    const bytes = await this.readFile(VOICE_FILE, 1024, () => true);
    if (!bytes) return null;
    try {
      const v: unknown = JSON.parse(bytes.toString('utf8'));
      if (typeof v !== 'object' || v === null) return null;
      const { id, name, at } = v as Record<string, unknown>;
      if (typeof id !== 'string' || typeof name !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) return null;
      return { id, name, at };
    } catch {
      return null;
    }
  }

  writeVoice(voice: RememberedVoice): Promise<boolean> {
    return this.replaceFile(VOICE_FILE, 'voice', Buffer.from(JSON.stringify({ id: voice.id, name: voice.name, at: voice.at })));
  }

  async forgetVoice(): Promise<void> {
    if (this.usable) await fs.unlink(path.join(this.dir, VOICE_FILE)).catch(() => undefined);
  }

  /**
   * Keeps the cache under `maxBytes` by deleting the least recently used clips, never one in `keep`,
   * and clears temp files a crashed run left behind.
   */
  async prune(keep: ReadonlySet<string>, maxBytes: number): Promise<void> {
    if (!this.usable) return;
    try {
      const now = Date.now();
      const clips: { name: string; size: number; mtime: number }[] = [];
      let total = 0;
      for (const name of await fs.readdir(this.dir)) {
        const clip = CLIP_FILE.test(name);
        if (!clip && !TEMP_FILE.test(name)) continue;
        const stat = await fs.lstat(path.join(this.dir, name)).catch(() => null);
        if (!stat?.isFile()) continue;
        if (!clip) {
          if (now - stat.mtimeMs > STALE_TEMP_MS) await fs.unlink(path.join(this.dir, name)).catch(() => undefined);
          continue;
        }
        total += stat.size;
        clips.push({ name, size: stat.size, mtime: stat.mtimeMs });
      }
      clips.sort((a, b) => a.mtime - b.mtime || (a.name < b.name ? -1 : 1));
      for (const clip of clips) {
        if (total <= maxBytes) break;
        if (keep.has(clip.name.slice(0, 64))) continue;
        await fs.unlink(path.join(this.dir, clip.name)).catch(() => undefined);
        total -= clip.size;
      }
    } catch {
      // Pruning is housekeeping; a failure here must not cost the learner their audio.
    }
  }
}
