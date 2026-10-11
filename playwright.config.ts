import { defineConfig, devices } from '@playwright/test';

// The player is a single file that must work with no network at all, so there is no web server here:
// specs render a lesson to a temp file and open it from file:// (and from the server's localhost listener).
export default defineConfig({
  testDir: 'test/player',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    // Never make sound on the developer's machine: Chromium is muted by flag here, and because WebKit
    // has no such flag, any spec that plays audio must also set the element's `muted` property.
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--mute-audio'] } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
