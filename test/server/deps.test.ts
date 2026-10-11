// The dependency object the entry point builds from the environment: reading it has no side effects,
// and the one thing in it that could launch a program refuses when told to.
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE } from '../../src/generated/guide';
import { VERSION } from '../../src/generated/version';
import { createDeps, NO_OPEN_VAR, systemOpen } from '../../src/server/deps';
import { buildServer } from '../../src/server/server';
import { DEFAULT_DEADLINE_MS } from '../../src/tts';

describe('createDeps', () => {
  it('reads the home, the port and voice from the environment, and touches nothing', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'lt-deps-'));
    const home = path.join(parent, 'home');
    try {
      const deps = createDeps({ LEARNING_TOOL_HOME: home, LEARNING_TOOL_PORT: '0' });
      expect(deps.store.home).toBe(home);
      expect(deps.version).toBe(VERSION);
      expect(deps.guide).toBe(GUIDE);
      expect(deps.voice).toMatchObject({ config: null, problems: [], deadlineMs: DEFAULT_DEADLINE_MS });
      expect(deps.voice.options).toBeUndefined();
      expect(deps.listener.port).toBeNull();
      // Building servers on it, as a host's probe does, creates nothing either.
      const a = buildServer(deps);
      const b = buildServer(deps);
      await a.close();
      await b.close();
      expect(existsSync(home)).toBe(false);
      expect(deps.listener.port).toBeNull();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('defaults to ~/LearningTool and port 47821 without creating or opening either', () => {
    const deps = createDeps({});
    expect(deps.store.home).toBe(path.join(os.homedir(), 'LearningTool'));
    expect(deps.store.lessonsDir).toBe(path.join(os.homedir(), 'LearningTool', 'lessons'));
    expect(deps.listener.port).toBeNull();
  });

  it('lets a test replace any dependency', () => {
    const log: string[] = [];
    const now = new Date('2026-01-02T03:04:05.000Z');
    const deps = createDeps({ LEARNING_TOOL_HOME: '/nonexistent/lt' }, { log: (line) => log.push(line), now: () => now, guide: {} });
    deps.log('one line');
    expect(log).toEqual(['one line']);
    expect(deps.now()).toBe(now);
    expect(deps.guide).toEqual({});
  });
});

describe('the system opener', () => {
  it('refuses to start anything when opening is disabled', async () => {
    // Only the refusal is exercised. Nothing in the suite ever lets the opener run a program.
    await expect(systemOpen({ [NO_OPEN_VAR]: '1' })('/tmp/some-lesson.html')).rejects.toThrow('opening is disabled');
  });
});
