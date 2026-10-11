// Pictures to look at, not assertions: the three sample animations at their key instants, at
// 1280 and 320 px, light and dark, in both engines. Skipped unless FRAME_SHOTS names a directory:
//
//   FRAME_SHOTS=.scratch/v2-frame/shots npx playwright test test/player/frame-shots --output=.scratch/v2-frame/pw
import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { KINETIC, PROJECTILE, SORT, buildPage, expect, info, open, seek } from './frame-kit';

const dir = process.env.FRAME_SHOTS ? path.resolve(process.env.FRAME_SHOTS) : null;
const TIMES: Record<string, number[]> = { [SORT.id]: [0.6, 3.35, 6.3, 16.8], [PROJECTILE.id]: [0.8, 2.2, 4.9], [KINETIC.id]: [1.2, 4.6, 6.7, 10.2] };

for (const cfg of [
  { w: 1280, h: 900, dpr: 2, scheme: 'light' },
  { w: 1280, h: 900, dpr: 1, scheme: 'dark' },
  { w: 320, h: 720, dpr: 2, scheme: 'light' },
  { w: 320, h: 720, dpr: 3, scheme: 'dark' },
] as const) {
  test(`shots ${cfg.w} ${cfg.scheme}`, async ({ browser, browserName }, testInfo) => {
    test.skip(dir === null, 'set FRAME_SHOTS to a directory to take the pictures');
    test.setTimeout(120_000);
    mkdirSync(dir as string, { recursive: true });
    const context = await browser.newContext({ viewport: { width: cfg.w, height: cfg.h }, deviceScaleFactor: cfg.dpr, colorScheme: cfg.scheme });
    const page = await context.newPage();
    const o = await open(page, testInfo, await buildPage([SORT, PROJECTILE, KINETIC]), 'file');
    for (const example of [SORT, PROJECTILE, KINETIC]) {
      for (const t of TIMES[example.id] ?? []) {
        await seek(page, example.id, t);
        expect((await info(page, example.id)).state).toBe('live');
        await page.locator(`section[data-scene="${example.id}"] .lt-frame`).screenshot({ path: path.join(dir as string, `${browserName}-${cfg.w}-${cfg.scheme}-${example.id}-${String(t).replace('.', '_')}.png`) });
      }
    }
    await o.close();
    await context.close();
  });
}
