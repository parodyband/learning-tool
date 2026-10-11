// Shared fixtures for the custom-frame specs.
//
// These specs do not go through the clip engine: they test the frame itself (the worker runtime,
// the host and its watchdog, the kit, the static markup, the stylesheet) on a page of its own.
// The page is built the way the product builds a lesson: static markup from the real renderer
// (render/frame.ts), one inline style, one inline script, the frames' data as JSON in the inert
// script#lt-data, and the policy from the real `contentSecurityPolicy`, in a meta element and, when
// served, in the response header with frame-ancestors added. The script is frame-harness.ts
// bundled with the player's own build settings, so the worker's text is what a lesson ships.
//
// Nothing here blocks requests through the test runner: the policy has to do that by itself, and
// a listener on 127.0.0.1 (the canary) counts every TCP connection and UDP datagram that gets out.
import { type Page, type TestInfo, expect } from '@playwright/test';
import { build } from 'esbuild';
import dgram from 'node:dgram';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FrameStage } from '../../src/core/frame';
import { FRAME_EXAMPLES, type FrameExample } from '../../src/core/frame-examples';
import { attrs, esc, inlineScriptText, inlineStyleText, internalId, jsonForScript } from '../../src/render/escape';
import { renderFrameStage } from '../../src/render/frame';
import { contentSecurityPolicy } from '../../src/render/page';

export { expect };

const here = path.dirname(fileURLToPath(import.meta.url));

export type Via = 'file' | 'http';
export const VIAS: readonly Via[] = ['file', 'http'];

/** What a spec page shows: an example-shaped frame, optionally run without the lockdown. */
export interface FrameSpecData extends FrameExample {
  raw?: boolean;
  /** Give the section a stage box of its own, as a clip engine does, and put the picture there. */
  away?: boolean;
}

let assets: Promise<{ js: string; css: string }> | null = null;
/** The harness script and style, built once per worker with the settings scripts/build.mjs uses for the player. */
function bundle(): Promise<{ js: string; css: string }> {
  assets ??= (async () => {
    const js = await build({
      entryPoints: [path.join(here, 'frame-harness.ts')],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: ['es2020', 'safari15'],
      minify: true,
      legalComments: 'none',
      write: false,
      logLevel: 'warning',
    });
    const css = await build({ entryPoints: [path.join(here, 'frame-harness.css')], bundle: true, minify: true, legalComments: 'none', write: false, logLevel: 'warning' });
    return { js: js.outputFiles[0]?.text ?? '', css: css.outputFiles[0]?.text ?? '' };
  })();
  return assets;
}

export interface BuiltPage {
  html: string;
  csp: string;
}

/** A page of frames, or (with `probe`) a page that runs one probe worker. */
export async function buildPage(frames: readonly FrameSpecData[], opts: { probe?: { code: string; hardened: boolean }; title?: string } = {}): Promise<BuiltPage> {
  const { js, css } = await bundle();
  const scriptText = inlineScriptText(js);
  const styleText = inlineStyleText(css);
  const csp = contentSecurityPolicy(scriptText, styleText);
  const ui = attrs({});
  const sections = frames
    .map((f) => {
      const stage = FrameStage.parse(f.stage);
      const own = (name: string): string => internalId(f.id, name);
      return `<section class="lt-scene" data-scene="${esc(f.id)}" aria-labelledby="${esc(own('h'))}"><h2 id="${esc(own('h'))}">${esc(f.title)}</h2>${f.away ? '<div class="h-stage" data-stagebox aria-hidden="true"></div>' : ''}${renderFrameStage(stage, { own, ui }, { description: f.description, label: f.title })}<p class="h-caption" data-caption></p></section>`;
    })
    .join('');
  const data = jsonForScript({ frames, probe: opts.probe });
  const title = esc(opts.title ?? 'Custom frames');
  const html =
    `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title}</title><style>${styleText}</style></head>\n` +
    `<body><main id="lt-main"><h1>${title}</h1>${sections}</main><script type="application/json" id="lt-data">${data}</script><script>${scriptText}</script></body>\n</html>\n`;
  return { html, csp };
}

// ----- the canary and the page server -------------------------------------------------------------

export interface Canary {
  port: number;
  hits: { kind: 'tcp' | 'udp'; first: string }[];
  close(): Promise<void>;
}

/** Counts every TCP connection and UDP datagram on one port of 127.0.0.1. Any hit is an escape. */
export async function startCanary(): Promise<Canary> {
  const hits: Canary['hits'] = [];
  const tcp = net.createServer((sock) => {
    const hit = { kind: 'tcp' as const, first: '' };
    hits.push(hit);
    sock.on('data', (d) => {
      if (!hit.first) hit.first = d.toString('latin1').slice(0, 120).replace(/\r?\n/g, ' | ');
      // Answer like a permissive server, so a request that was not blocked would fully succeed.
      sock.write('HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok');
      sock.end();
    });
    sock.on('error', () => {});
  });
  await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve));
  const { port } = tcp.address() as AddressInfo;
  const udp = dgram.createSocket('udp4');
  udp.on('message', (msg) => hits.push({ kind: 'udp', first: `${msg.length} bytes` }));
  await new Promise<void>((resolve) => udp.bind(port, '127.0.0.1', resolve));
  return {
    port,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        udp.close();
        tcp.close(() => resolve());
      }),
  };
}

export interface Opened {
  url: string;
  /** Every request the page or its workers started, the document included. A request the policy refuses is still listed here. */
  requests: string[];
  /** Requests that were refused or failed before anything was sent, with the browser's reason. */
  failed: { url: string; error: string }[];
  /** Requests other than the document that were not refused: there must be none. */
  sent(): string[];
  /** Hits the page's own server received (http only). */
  serverHits: string[];
  pageErrors: string[];
  crashed: () => boolean;
  /** Pages opened by the page: there must be none. */
  popups: () => number;
  close(): Promise<void>;
}

/** Write the page to a file, or serve it from 127.0.0.1 on a free port with the headers the product sends, and open it. */
export async function open(page: Page, testInfo: TestInfo, built: BuiltPage, via: Via, opts: { wait?: boolean } = {}): Promise<Opened> {
  let url: string;
  const serverHits: string[] = [];
  let server: http.Server | null = null;
  if (via === 'http') {
    const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    server = http.createServer((req, res) => {
      serverHits.push(`${req.method} ${req.url}`);
      if (req.method !== 'GET' || req.url !== `/l/${token}/`) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `${built.csp}; frame-ancestors 'none'`,
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
      });
      res.end(built.html);
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/l/${token}/`;
  } else {
    const file = testInfo.outputPath(`frame-${Math.random().toString(36).slice(2, 8)}.html`);
    writeFileSync(file, built.html);
    url = pathToFileURL(file).href;
  }
  const requests: string[] = [];
  const failed: { url: string; error: string }[] = [];
  const pageErrors: string[] = [];
  let crashed = false;
  let popups = 0;
  page.on('request', (r) => requests.push(r.url()));
  page.on('requestfailed', (r) => failed.push({ url: r.url(), error: r.failure()?.errorText ?? '' }));
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('crash', () => {
    crashed = true;
  });
  page.context().on('page', () => popups++);
  await page.goto(url);
  if (opts.wait !== false) await page.waitForFunction(() => window.__ready === true);
  return {
    url,
    requests,
    failed,
    sent: () => requests.filter((r) => r.split('#')[0] !== url && !failed.some((f) => f.url === r)),
    serverHits,
    pageErrors,
    crashed: () => crashed,
    popups: () => popups,
    close: () =>
      new Promise<void>((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
        // A browser keeps its connection open for a while; the spec is done with it now.
        server.closeAllConnections();
      }),
  };
}

// ----- frames used by more than one spec ----------------------------------------------------------

export const [SORT, PROJECTILE, KINETIC] = FRAME_EXAMPLES as [FrameExample, FrameExample, FrameExample];

/**
 * A frame whose picture can be read back: the bottom of the stage is a grey that rises with t
 * (black at 0, white at the end), and the top quarter is a red set by the slider.
 */
export const CLOCK: FrameSpecData = {
  id: 'clock',
  title: 'A picture of the time',
  description: 'The stage goes from black to white over four seconds. A band along the top turns red as the slider is raised.',
  stage: {
    kind: 'frame',
    code: [
      'function render(ctx, t) {',
      "  S.clear(S.mix('#000000', '#ffffff', t / S.dur));",
      "  S.rect(0, 0, S.W, S.H * 0.25, { fill: S.mix('#000000', '#ff0000', S.params.level / 100) });",
      '}',
    ].join('\n'),
    duration: 4,
    aspect: '16:9',
    params: [{ id: 'level', label: 'Red level', min: 0, max: 100, step: 5, value: 0, unit: '%' }],
    poster: 2,
    cites: [],
    provenance: 'illustrative',
  },
  beats: [
    { at: 0, caption: 'Dark at the start.' },
    { at: 2, caption: 'Half way: mid grey.' },
  ],
};

/** A frame around some code, for the abuse and escape specs. */
export function frameOf(id: string, code: string, over: Partial<FrameSpecData['stage']> & { raw?: boolean } = {}): FrameSpecData {
  const { raw, ...stage } = over;
  return {
    id,
    title: `Frame ${id}`,
    description: 'A frame made for a test. It draws nothing a learner needs to see.',
    stage: { kind: 'frame', code, duration: 6, aspect: '16:9', params: [], poster: 0.2, cites: [], provenance: 'illustrative', ...stage },
    beats: [
      { at: 0, caption: 'Start.' },
      { at: 1, caption: 'Later.' },
    ],
    ...(raw ? { raw } : {}),
  };
}

// ----- reading the page ---------------------------------------------------------------------------

export interface FrameInfo {
  state: string;
  failure: string | null;
  t: number;
  frames: number;
  spawns: number;
  recycles: number;
  rejected: number;
  quality: number;
  lastError: string;
  /** `atMs` is measured from the page's time origin; `afterPlayMs` from the last Play. */
  failures: { code: string; atMs: number; afterPlayMs: number }[];
  status: string;
  retryShown: boolean;
  canvasShown: boolean;
  altShown: boolean;
  units: { w: number; h: number } | null;
  css: [number, number];
  px: [number, number];
  left: string[];
}

/**
 * Names Chromium leaves on a worker's global scope that cannot be deleted or redefined: two
 * numeric constants of the long-gone FileSystem API. Their values are 0 and 1.
 */
export const HARMLESS_LEFT = ['TEMPORARY', 'PERSISTENT'];

export function info(page: Page, id: string): Promise<FrameInfo> {
  return page.evaluate((id) => {
    const d = window.__ltf!.get(id);
    const h = d.kit.host;
    const root = d.kit.root;
    const canvas = (root.closest('section') ?? document).querySelector('canvas')!;
    const r = canvas.getBoundingClientRect();
    const shown = (el: Element | null): boolean => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
    return {
      state: d.kit.state,
      failure: d.kit.failure,
      t: d.t,
      frames: h.stats.frames,
      spawns: h.stats.spawns,
      recycles: h.stats.recycles,
      rejected: h.stats.rejected,
      quality: h.quality,
      lastError: h.stats.lastError,
      failures: h.stats.failures.map((f) => ({ code: f.code, atMs: Math.round(f.at), afterPlayMs: Math.round(f.at - d.playAt) })),
      status: root.querySelector('.lt-frame-status')?.textContent ?? '',
      retryShown: shown(root.querySelector('.lt-frame-retry')),
      canvasShown: shown(canvas),
      altShown: shown(root.querySelector('.lt-frame-alt')),
      units: h.units ? { w: h.units.w, h: h.units.h } : null,
      css: [Math.round(r.width), Math.round(r.height)] as [number, number],
      px: [canvas.width, canvas.height] as [number, number],
      left: [...h.stats.left],
    };
  }, id);
}

/** Wait until the frame shows the time last asked for (or has been turned off). */
export async function settled(page: Page, id: string): Promise<void> {
  await page.evaluate(async (id) => {
    const d = window.__ltf!.get(id);
    d.kit.root.scrollIntoView({ block: 'center' });
    // The frame starts when it is seen, and seeing is reported a moment after scrolling.
    for (let i = 0; i < 100 && d.kit.state === 'idle'; i++) await new Promise((r) => setTimeout(r, 30));
    await d.kit.settled();
  }, id);
}

export async function seek(page: Page, id: string, t: number): Promise<void> {
  await page.evaluate(
    async ([id, t]) => {
      const d = window.__ltf!.get(id as string);
      d.kit.root.scrollIntoView({ block: 'center' });
      d.seek(t as number);
    },
    [id, t] as const,
  );
  await settled(page, id);
}

/** The colour of the picture at a point given as shares of its width and height. */
export function pixel(page: Page, id: string, fx = 0.5, fy = 0.8): Promise<[number, number, number]> {
  return page.evaluate(
    ([id, fx, fy]) => {
      const c = (window.__ltf!.get(id as string).kit.root.closest('section') ?? document).querySelector('canvas')!;
      const probe = document.createElement('canvas');
      probe.width = probe.height = 1;
      const x = probe.getContext('2d')!;
      x.drawImage(c, Math.floor(c.width * (fx as number)), Math.floor(c.height * (fy as number)), 1, 1, 0, 0, 1, 1);
      const d = x.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]] as [number, number, number];
    },
    [id, fx, fy] as const,
  );
}

/** The share of the picture that is not its background (the colour of its top-left corner), sampled on a coarse grid. */
export function ink(page: Page, id: string): Promise<number> {
  return page.evaluate((id) => {
    const c = (window.__ltf!.get(id).kit.root.closest('section') ?? document).querySelector('canvas')!;
    const probe = document.createElement('canvas');
    probe.width = 192;
    probe.height = Math.max(1, Math.round((192 * c.height) / c.width));
    const x = probe.getContext('2d')!;
    x.drawImage(c, 0, 0, probe.width, probe.height);
    const d = x.getImageData(0, 0, probe.width, probe.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i]! - d[0]!) + Math.abs(d[i + 1]! - d[1]!) + Math.abs(d[i + 2]! - d[2]!) > 24) n++;
    return n / (d.length / 4);
  }, id);
}

/** The largest gap in the page's own thread since the last call, in ms: between timer ticks, and between frames. */
export function lag(page: Page, reset = false): Promise<{ timer: number; raf: number }> {
  return page.evaluate((reset) => {
    const l = window.__lag!;
    const out = { timer: Math.round(l.timer), raf: Math.round(l.raf) };
    if (reset) l.timer = l.raf = 0;
    return out;
  }, reset);
}

/**
 * Policy violations the page saw. A frame page has none in either engine. (Taking a screenshot in
 * WebKit makes one, because the test runner adds a stylesheet for it: assert before you shoot.)
 */
export function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__viol ?? []);
}
