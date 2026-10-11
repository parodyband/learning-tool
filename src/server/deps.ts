// Everything the server reaches outside itself goes through this object: the disk (store), the
// local listener, the clock, voice, the renderer, the browser opener and the log. The entry point
// builds one from the environment; tests build one over a temporary folder, with a port of 0, a
// stub in place of ElevenLabs and an opener that only records.
//
// Building it has no side effects. Nothing is created, opened or contacted until a tool needs it,
// because a host may start this process twice and discard one.
import { spawn } from 'node:child_process';
import type { Published } from '../core/types';
import { GUIDE } from '../generated/guide';
import { VERSION } from '../generated/version';
import { renderLesson, type RenderedLesson } from '../render';
import { DEFAULT_DEADLINE_MS, synthesizeLesson, voiceConfigFromEnv, voiceEnvProblems, type SynthesizeOptions, type VoiceConfig, type VoiceEnvProblem } from '../tts';
import { LessonListener } from './listener';
import { homeFromEnv, portFromEnv, type Env } from './paths';
import { Store } from './store';

export interface VoiceDeps {
  /** The object voiceConfigFromEnv returned, or null when voice is off. The key is not readable from it. */
  config: VoiceConfig | null;
  /** Voice settings that are present but unusable, as fixed sentences that never quote a value. */
  problems: readonly VoiceEnvProblem[];
  synthesize: typeof synthesizeLesson;
  deadlineMs: number;
  /** Tests only: a loopback stand-in for ElevenLabs and faster retries. Never set from a tool argument or the environment. */
  options?: Pick<SynthesizeOptions, 'baseUrl' | 'fetch' | 'tuning'>;
}

export interface ServerDeps {
  version: string;
  store: Store;
  listener: LessonListener;
  now: () => Date;
  /** The skill's text by section, from the build. May be empty when the skill has not been built. */
  guide: Readonly<Record<string, string>>;
  voice: VoiceDeps;
  render: (published: Published) => RenderedLesson;
  /** Open a published file in the learner's browser. Tests replace this; nothing in a test may launch a browser. */
  open: (file: string) => Promise<void>;
  /** One line to stderr. stdout belongs to the protocol. */
  log: (line: string) => void;
}

export const NO_OPEN_VAR = 'LEARNING_TOOL_NO_OPEN';

/** Open a file with the operating system's own opener. No shell is involved, and the only argument is a path this server made. */
export function systemOpen(env: Env): (file: string) => Promise<void> {
  return (file) =>
    new Promise<void>((resolve, reject) => {
      if (env[NO_OPEN_VAR]) {
        reject(new Error('opening is disabled'));
        return;
      }
      const [command, args] =
        process.platform === 'darwin'
          ? ['open', [file]]
          : process.platform === 'win32'
            ? ['rundll32.exe', ['url.dll,FileProtocolHandler', file]]
            : ['xdg-open', [file]];
      try {
        const child = spawn(command as string, args as string[], { stdio: 'ignore', detached: true, shell: false });
        child.once('error', reject);
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error('could not start the opener'));
      }
    });
}

/** The dependencies for a real run, read from the environment. `overrides` replaces any of them. */
export function createDeps(env: Env, overrides: Partial<ServerDeps> = {}): ServerDeps {
  const now = overrides.now ?? (() => new Date());
  const log = overrides.log ?? ((line: string) => console.error(line));
  return {
    version: VERSION,
    store: new Store(homeFromEnv(env), now),
    listener: new LessonListener({ port: portFromEnv(env), log }),
    guide: GUIDE,
    voice: { config: voiceConfigFromEnv(env), problems: voiceEnvProblems(env), synthesize: synthesizeLesson, deadlineMs: DEFAULT_DEADLINE_MS },
    render: renderLesson,
    open: systemOpen(env),
    ...overrides,
    now,
    log,
  };
}
