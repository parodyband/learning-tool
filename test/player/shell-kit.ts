// Shared fixtures for player specs. Other player specs (figures, questions, steps) may import this.
//
// Every page opened through `openLesson` is watched from before its first byte: all requests are
// recorded and anything but the lesson document itself is aborted, console errors and uncaught
// exceptions are collected, Content-Security-Policy violations are collected inside the page, and
// every media element is forced silent before it can play.
import { test as base, expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import type { AudioBundle, Published } from '../../src/core/types';
import { renderLesson } from '../../src/render/index';
import { examplePublished } from '../helpers/example';
import { SILENT_MP3_BASE64 } from './shell-silence';

export { expect };

export interface Violation {
  directive: string;
  blocked: string;
  sample: string;
  source: string;
  line: number;
}

export interface Watch {
  /** The address the lesson was opened at, without a fragment. */
  url: string;
  /** Every request the page made, the document included. */
  requests: string[];
  /** Requests that were refused because they were not the lesson document. */
  blocked: string[];
  consoleErrors: string[];
  pageErrors: string[];
  /** Policy violations seen so far in the current document. */
  violations(): Promise<Violation[]>;
  /** Hits the local server received, for the http case. */
  serverHits: string[];
}

export type Via = 'file' | 'http';

export interface OpenOptions {
  published?: Published;
  /** Fragment to open at, such as "#/s4". */
  hash?: string;
  via?: Via;
  /** Change the rendered document before it is opened, to stage a damaged file. */
  mutate?: (html: string) => string;
}

declare global {
  interface Window {
    __ltViolations?: Violation[];
    /** Everything the page tried to copy. The real clipboard is never touched. */
    __ltCopied?: { how: 'api' | 'command'; text: string }[];
    /** Set to true to make the async clipboard API refuse, as it does without permission. */
    __ltClipboardRefuses?: boolean;
  }
}

/** Runs in the page before any of its own script. */
function instrument(): void {
  window.__ltViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__ltViolations?.push({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: e.sample, source: e.sourceFile, line: e.lineNumber });
  });
  // The developer's own clipboard must survive a test run, so both ways of copying are replaced
  // with recorders. The command form records what is selected, which is what it would have copied.
  window.__ltCopied = [];
  const fakeClipboard = {
    writeText: (text: string): Promise<void> => {
      if (window.__ltClipboardRefuses) return Promise.reject(new DOMException('refused', 'NotAllowedError'));
      window.__ltCopied?.push({ how: 'api', text });
      return Promise.resolve();
    },
  };
  Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => fakeClipboard });
  const command = Document.prototype.execCommand;
  Document.prototype.execCommand = function (this: Document, name: string, ...rest: unknown[]): boolean {
    if (name !== 'copy') return (command as (...a: unknown[]) => boolean).call(this, name, ...rest);
    const active = document.activeElement;
    const text = active instanceof HTMLTextAreaElement ? active.value.slice(active.selectionStart, active.selectionEnd) : String(window.getSelection() ?? '');
    window.__ltCopied?.push({ how: 'command', text });
    return true;
  };
  // WebKit has no mute flag, so silence is enforced on the element itself.
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    this.muted = true;
    this.volume = 0;
    return play.call(this);
  };
}

interface Server {
  url: string;
  hits: string[];
  close(): Promise<void>;
}

/** A stand-in for the server's local listener: one document at /l/<token>/, the headers the contract lists, nothing else. */
async function serve(html: string, csp: string): Promise<Server> {
  const hits: string[] = [];
  const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.url !== `/l/${token}/`) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `${csp}; frame-ancestors 'none'`,
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/l/${token}/`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const servers = new WeakMap<BrowserContext, Server[]>();

/** Render a lesson, write or serve it, and open it with everything watched and the network cut off. */
export async function openLesson(page: Page, testInfo: TestInfo, opts: OpenOptions = {}): Promise<Watch> {
  const rendered = renderLesson(opts.published ?? examplePublished());
  if (opts.mutate) rendered.html = opts.mutate(rendered.html);
  const context = page.context();
  let url: string;
  let serverHits: string[] = [];
  if (opts.via === 'http') {
    const server = await serve(rendered.html, rendered.csp);
    servers.set(context, [...(servers.get(context) ?? []), server]);
    url = server.url;
    serverHits = server.hits;
  } else {
    const file = testInfo.outputPath(`lesson-${Math.random().toString(36).slice(2, 8)}.html`);
    writeFileSync(file, rendered.html);
    url = pathToFileURL(file).href;
  }

  const watch: Watch = {
    url,
    requests: [],
    blocked: [],
    consoleErrors: [],
    pageErrors: [],
    serverHits,
    violations: () => page.evaluate(() => window.__ltViolations ?? []),
  };
  // blob: addresses are memory the page made itself (a narration clip), not the network.
  page.on('request', (r) => {
    if (!r.url().startsWith('blob:')) watch.requests.push(r.url());
  });
  page.on('console', (m) => {
    if (m.type() === 'error') watch.consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => watch.pageErrors.push(e.message));
  // Nothing but the document may be fetched. Anything else is refused and remembered.
  await context.route('**/*', (route) => {
    const requested = route.request().url().split('#')[0] as string;
    if (requested === url || requested.startsWith('blob:')) return route.continue();
    watch.blocked.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(instrument);
  await page.goto(url + (opts.hash ?? ''));
  return watch;
}

export interface CleanOptions {
  /**
   * WebKit reports one `style-src-attr` violation, and logs one console error, for the internals of
   * its own native `<select>` (measured: no other control does it, and the control still renders).
   * A spec whose page contains a select may allow exactly that. It is off by default because a real
   * `style=""` attribute looks the same in WebKit; Chromium still catches that case.
   */
  webkitSelectNoise?: boolean;
}

const SELECT_NOISE_LOG = /Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline'/;

/** Assert the page stayed clean: no request but the document, no console error, no exception, no policy violation. */
export async function expectClean(watch: Watch, browserName: string, opts: CleanOptions = {}): Promise<void> {
  const tolerate = opts.webkitSelectNoise === true && browserName === 'webkit';
  const violations = (await watch.violations()).filter((v) => !(tolerate && v.directive === 'style-src-attr' && v.blocked === 'inline' && v.sample === '' && v.source === ''));
  const consoleErrors = watch.consoleErrors.filter((text) => !(tolerate && SELECT_NOISE_LOG.test(text)));
  expect(watch.blocked, 'requests other than the document').toEqual([]);
  expect(
    watch.requests.filter((r) => r.split('#')[0] !== watch.url),
    'requests other than the document',
  ).toEqual([]);
  expect(watch.pageErrors, 'uncaught exceptions').toEqual([]);
  expect(consoleErrors, 'console errors').toEqual([]);
  expect(violations, 'policy violations').toEqual([]);
}

/** Move keyboard focus forward. Safari, and Playwright's WebKit with it, only tabs to every control with Option held. */
export async function tab(page: Page, browserName: string, shift = false): Promise<void> {
  const key = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.keyboard.press(shift ? `Shift+${key}` : key);
}

/** A lesson with a silent clip for each segment id given. */
export function withSilentAudio(segmentIds: readonly string[], published: Published = examplePublished()): Published {
  const audio: AudioBundle = { provider: 'elevenlabs', voice: 'Test Voice', clips: segmentIds.map((segmentId) => ({ segmentId, mime: 'audio/mpeg', base64: SILENT_MP3_BASE64 })) };
  return { ...published, audio };
}

/** Two words that cannot be broken at a space, as the topics of the recap's follow-up requests. */
export const LONG_TOPICS = ['das Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz', 'Donaudampfschifffahrtsgesellschaftskapitän'];

/** The example lesson whose recap asks for those two topics next. */
export function withLongTopics(): Published {
  const p = examplePublished();
  const recap = p.lesson.scenes.at(-1);
  if (recap?.kind !== 'recap') throw new Error('the example ends with a recap');
  recap.next = LONG_TOPICS.map((topic) => ({ topic, why: 'Because a long word must wrap like any other.' }));
  return p;
}

/** The id of a scene's `<section>`, as render/escape builds it for the ids the example uses. */
export function sectionId(sceneId: string): string {
  return `lt-${sceneId.replaceAll('-', '--')}-_scene`;
}

/** The example lesson's scenes, read from the data so specs do not hard-code its ids. */
export function exampleScenes(published: Published = examplePublished()): { ids: string[]; first: string; last: string; total: number; byKind(kind: string): string[] } {
  const scenes = published.lesson.scenes;
  const ids = scenes.map((s) => s.id);
  return { ids, first: ids[0] as string, last: ids.at(-1) as string, total: ids.length, byKind: (kind) => scenes.filter((s) => s.kind === kind).map((s) => s.id) };
}

/**
 * Put checkpoint results into storage the way the player keeps them: each with the digest of its
 * scene as the open page has it, so they are results for these questions. Reload to see them.
 */
export async function seedResults(page: Page, lessonId: string, results: readonly (readonly [string, string])[]): Promise<void> {
  await page.evaluate(
    ({ key, list }) => {
      const rev = (sceneId: string): string => Array.from(document.querySelectorAll<HTMLElement>('section[data-scene]')).find((s) => s.dataset.scene === sceneId)?.dataset.rev ?? 'none';
      localStorage.setItem(key, JSON.stringify(list.map(([sceneId, result]) => [sceneId, result, rev(sceneId)])));
    },
    { key: `lt:${lessonId}:results`, list: results },
  );
}

/** What the page says about the element that has focus. */
export function focused(page: Page): Promise<{ tag: string; id: string; cls: string; text: string }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { tag: el?.tagName ?? '', id: el?.id ?? '', cls: el?.className ?? '', text: (el?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80) };
  });
}

/**
 * Wait until focus is where it should be. After an overlay closes the browser hands focus back a
 * moment later (WebKit especially), so a single immediate read can see the old element.
 */
export async function expectFocus(page: Page, check: (f: { tag: string; id: string; cls: string; text: string }) => boolean, what = 'focus'): Promise<void> {
  await expect.poll(async () => check(await focused(page)), { message: what, timeout: 2000 }).toBe(true);
}

/** Press Tab until `done` says the focused element is the one wanted. Fails after `limit` presses. */
export async function tabTo(page: Page, browserName: string, done: (f: { tag: string; id: string; cls: string; text: string }) => boolean, limit = 40): Promise<void> {
  for (let i = 0; i < limit; i++) {
    await tab(page, browserName);
    if (done(await focused(page))) return;
  }
  throw new Error(`focus did not reach the wanted element in ${limit} presses; it is on ${JSON.stringify(await focused(page))}`);
}

export const test = base.extend<{ lessonServers: void }>({
  lessonServers: [
    async ({ context }, use) => {
      await use();
      await Promise.all((servers.get(context) ?? []).map((s) => s.close()));
    },
    { auto: true },
  ],
});
