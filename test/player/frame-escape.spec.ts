// Escape attempts from inside the frame's worker, under the product's real policy. Ported from the
// sandbox research (.scratch/v2-sandbox/tests/10-escape-worker.mjs); the probes are frame-probes.js.
//
// Each run is done twice: "hardened" is the worker exactly as the player ships it, and "raw" has
// the runtime's lockdown left out, to show that the boundary is the platform and the policy and not
// our own JavaScript. In every run a listener on 127.0.0.1 answers anything that reaches it, and
// must receive nothing: no TCP connection, no UDP datagram.
import { test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Canary, VIAS, buildPage, expect, frameOf, info, lag, open, settled, startCanary } from './frame-kit';

const PROBES = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'frame-probes.js'), 'utf8');

const RESULTS = path.resolve('.scratch/v2-frame/results');

interface ProbeRun {
  results: Record<string, string>;
  late: Record<string, string>;
  workerError: string | null;
  heardByHost: number;
  violations: string[];
}

let canary: Canary;
test.beforeEach(async () => {
  canary = await startCanary();
});
test.afterEach(async () => {
  await canary.close();
});

for (const via of VIAS) {
  for (const variant of ['hardened', 'raw'] as const) {
    test(`every probe fails and nothing reaches the listener: ${variant}, from ${via}`, async ({ page, browserName }, testInfo) => {
      test.setTimeout(120_000);
      const code = PROBES.replaceAll('CANARY_PORT', String(canary.port));
      const o = await open(page, testInfo, await buildPage([], { probe: { code, hardened: variant === 'hardened' } }), via);
      await page.waitForFunction(() => window.__r && (window.__r.probe !== null || window.__r.workerError !== null), null, { timeout: 90_000 });
      // Let anything queued (a beacon, a prefetch) reach the listener if it is going to.
      await page.waitForTimeout(1500);
      const run = await page.evaluate((): ProbeRun => {
        const r = window.__r!;
        const probe = r.probe as { results?: Record<string, string> } | null;
        return { results: probe?.results ?? {}, late: { ...r.late }, workerError: r.workerError, heardByHost: r.bc.length, violations: [...r.violations] };
      });
      const all = { ...run.results, ...Object.fromEntries(Object.entries(run.late).map(([k, v]) => [k, `late: ${v}`])) };
      await testInfo.attach(`probes-${browserName}-${via}-${variant}.json`, { body: JSON.stringify(all, null, 1), contentType: 'application/json' });
      // Kept after a passing run too: what every probe said, per engine, load mode and variant.
      mkdirSync(RESULTS, { recursive: true });
      writeFileSync(path.join(RESULTS, `probes-${browserName}-${via}-${variant}.json`), JSON.stringify({ canaryHits: canary.hits, refused: o.failed, verdicts: all }, null, 1));

      expect(run.workerError, 'the probe worker ran').toBeNull();
      expect(Object.keys(run.results).length, 'every probe reported').toBeGreaterThan(45);
      // The judge: nothing left the browser, by any route.
      expect(canary.hits, 'connections and datagrams the listener received').toEqual([]);
      expect(Object.entries(all).filter(([, v]) => /ESCAPED/.test(v)), 'probes that say they got out').toEqual([]);
      // The browser lists a request the policy refused; none may be listed that was not refused.
      expect(o.sent(), 'requests that were not refused').toEqual([]);
      for (const f of o.failed) expect(f.error, `why ${f.url} was refused`).toMatch(/csp|blocked/i);
      if (via === 'http') expect(o.serverHits, "requests to the page's own server").toHaveLength(1);
      expect(o.popups()).toBe(0);
      expect(page.url()).toBe(o.url);
      expect(run.heardByHost, 'BroadcastChannel messages the page heard from the worker').toBe(0);
      expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement === null), 'focus stayed with the page').toBe(true);

      // A probe that had not answered when the others finished reports late; its late answer is its verdict.
      const r: Record<string, string> = { ...run.results };
      for (const [name, verdict] of Object.entries(run.late)) if (r[name] === 'timeout') r[name] = verdict;
      // What a worker never has, with or without us.
      for (const name of ['document', 'window_parent_top', 'localStorage', 'sessionStorage', 'open_alert_focus', 'clipboard', 'audio']) expect(r[name], name).toMatch(/^ABSENT/);
      expect(r.webrtc).toBe('ABSENT');
      expect(r.this_global).toBe('undefined (strict)');
      // Code from strings is refused by the policy the worker inherits, whichever way it is asked for.
      for (const name of ['eval', 'Function', 'Function_via_constructor', 'AsyncFunction']) expect(r[name], name).toMatch(/^BLOCKED/);
      for (const name of ['dynamic_import_http', 'dynamic_import_data']) expect(r[name], name).toMatch(/^BLOCKED/);
      // An opaque origin: no database.
      expect(r.indexedDB).toMatch(/^(ABSENT|BLOCKED)/);
      expect(r.opfs).toMatch(/^(ABSENT|BLOCKED)/);

      if (variant === 'hardened') {
        // With the lockdown the means are simply gone.
        for (const name of ['fetch', 'fetch_nocors', 'xhr', 'websocket', 'eventsource', 'sendBeacon', 'importScripts', 'importScripts_data', 'worker_http', 'worker_data_nested', 'sharedworker', 'serviceworker', 'webtransport', 'websocketstream', 'fontface_url', 'caches', 'cookieStore', 'broadcastchannel', 'location_assign', 'notification', 'devices', 'webgpu']) {
          expect(r[name], name).toMatch(/^ABSENT/);
        }
        expect(r.webgl).toBe('BLOCKED null');
        expect(r.timers).toBe('none');
        // What is left of the global scope: the language, and the 2D canvas classes.
        const leftover = (r.globals_left ?? '').split(' ').filter(Boolean);
        for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'importScripts', 'postMessage', 'setTimeout', 'navigator', 'self', 'caches', 'indexedDB', 'location', 'close', 'console', 'crypto', 'performance']) {
          expect(leftover, `still a global: ${name}`).not.toContain(name);
        }
        for (const name of ['Object', 'Math', 'OffscreenCanvas']) expect(leftover).toContain(name);
      } else {
        // Without it the means exist, and the policy refuses each of them.
        for (const name of ['fetch', 'fetch_nocors', 'xhr', 'websocket', 'eventsource', 'importScripts', 'importScripts_data', 'worker_http']) expect(r[name], name).toMatch(/^BLOCKED/);
        expect(r.location_assign).toMatch(/BLOCKED|ABSENT/);
      }
      await o.close();
    });
  }

  // Code that closes its wrapper early is refused before publishing (test/frame/check.test.ts). If
  // a file were edited by hand to carry it, this is what it would get: nothing.
  for (const variant of ['hardened', 'raw'] as const) {
    test(`code that breaks out of its wrapper reaches nothing: ${variant}, from ${via}`, async ({ page }, testInfo) => {
      const C = `http://127.0.0.1:${canary.port}`;
      const tries = [
        `try { fetch("${C}/b-fetch").catch(function () {}); } catch (e) {}`,
        `try { fetch("${C}/b-nocors", { mode: "no-cors", keepalive: true }).catch(function () {}); } catch (e) {}`,
        `try { var x = new XMLHttpRequest(); x.open("GET", "${C}/b-xhr"); x.send(); } catch (e) {}`,
        `try { new WebSocket("ws://127.0.0.1:${canary.port}/b-ws"); } catch (e) {}`,
        `try { new EventSource("${C}/b-es"); } catch (e) {}`,
        `try { importScripts("${C}/b-import.js"); } catch (e) {}`,
        `try { navigator.sendBeacon("${C}/b-beacon", "x"); } catch (e) {}`,
        `try { new Worker("${C}/b-worker.js"); } catch (e) {}`,
        `try { new Worker("data:text/javascript," + encodeURIComponent('try{fetch("${C}/b-nested")}catch(e){}')); } catch (e) {}`,
        `try { import("${C}/b-dynamic.js").catch(function () {}); } catch (e) {}`,
        `try { self.location = "${C}/b-nav"; } catch (e) {}`,
      ];
      // Hoisted above the runtime: functions named after things the runtime might have called.
      const hoisted = ['Object', 'Proxy', 'Reflect', 'String', 'OffscreenCanvas'].map((n) => `function ${n}() { ${tries.join(' ')} return {}; }`);
      const code = `function render(ctx, t) { S.clear(); }\n;return render;});\n${hoisted.join('\n')}\n${tries.join('\n')}\n(function(S){`;
      const o = await open(page, testInfo, await buildPage([frameOf('breakout', code, { raw: variant === 'raw' }), frameOf('good', 'function render(ctx, t) { S.clear(S.theme.accent); }')]), via);
      await page.evaluate(() => window.__ltf!.get('breakout').kit.root.scrollIntoView());
      // Whatever becomes of it: it draws, or it is turned off. Either way the page carries on.
      await page.waitForFunction(() => window.__ltf!.get('breakout').kit.state !== 'idle', null, { timeout: 10_000 });
      await page.waitForTimeout(1500);
      expect(canary.hits, 'connections and datagrams the listener received').toEqual([]);
      expect(o.sent(), 'requests that were not refused').toEqual([]);
      expect(o.popups()).toBe(0);
      expect(page.url()).toBe(o.url);
      await settled(page, 'good');
      expect((await info(page, 'good')).state).toBe('live');
      expect((await lag(page)).timer).toBeLessThan(500);
      expect(o.pageErrors).toEqual([]);
      await o.close();
    });
  }
}
