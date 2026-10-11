// Where the server keeps things, and the only names it ever gives a file. No tool argument reaches
// this file except a lessonId that has already matched LESSON_ID_PATTERN and a lesson title that is
// reduced to a slug here.
import os from 'node:os';
import path from 'node:path';
import { LESSON_ID_PATTERN } from '../core/schema';

export const HOME_VAR = 'LEARNING_TOOL_HOME';
export const PORT_VAR = 'LEARNING_TOOL_PORT';
export const DEFAULT_HOME_NAME = 'LearningTool';
export const DEFAULT_PORT = 47821;
export const SLUG_MAX = 60;

export type Env = Readonly<Record<string, string | undefined>>;

/** The Learning Tool home: LEARNING_TOOL_HOME when it is set, else ~/LearningTool. Always absolute. */
export function homeFromEnv(env: Env): string {
  const raw = env[HOME_VAR];
  if (typeof raw === 'string' && raw.trim() !== '' && !raw.includes('\0')) return path.resolve(raw.trim());
  return path.join(os.homedir(), DEFAULT_HOME_NAME);
}

/** The port to try first: LEARNING_TOOL_PORT when it is a port number (0 means "any free port"), else 47821. */
export function portFromEnv(env: Env): number {
  const raw = env[PORT_VAR];
  if (typeof raw === 'string' && /^\d{1,5}$/.test(raw.trim())) {
    const port = Number(raw.trim());
    if (port <= 65535) return port;
  }
  return DEFAULT_PORT;
}

/**
 * A title as a file-name stem: lower-case a-z, 0-9 and single hyphens, at most 60 characters.
 * Accents are removed ("Señor" gives "senor"); anything else that is not a letter or digit becomes a
 * hyphen. A title with no such characters at all gives "lesson".
 */
export function slugify(title: string): string {
  const ascii = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  let out = '';
  let gap = false;
  for (const ch of ascii) {
    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) {
      if (gap && out !== '') out += '-';
      gap = false;
      out += ch;
      if (out.length >= SLUG_MAX) break;
    } else {
      gap = true;
    }
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  return out === '' ? 'lesson' : out;
}

/** `slug(title)-<first 6 of id>.html`. The id must already be a minted lesson id. */
export function lessonFileName(title: string, lessonId: string): string {
  if (!LESSON_ID_PATTERN.test(lessonId)) throw new TypeError('lessonFileName: not a lesson id.');
  return `${slugify(title)}-${lessonId.slice(0, 6)}.html`;
}

/** A file name this server could have produced for this lesson. A stored name is reused only when it still matches. */
export function isLessonFileName(name: unknown, lessonId: string): name is string {
  if (typeof name !== 'string' || name.length > SLUG_MAX + 12) return false;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.html$/.test(name)) return false;
  return name.endsWith(`-${lessonId.slice(0, 6)}.html`) && name.length > 12;
}

/** The local calendar date, YYYY-MM-DD: what a learner means by "saved on". */
export function localDate(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
