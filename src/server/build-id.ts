// Which build made a page.
//
// `verify` can only say "this page is exactly what its data renders to" by rendering the data again
// and comparing, and that is exact only when the renderer and the player are the very ones that
// made the page. The package version does not say that: it stays the same across builds, so a page
// from last week's build of 0.1.0 would differ from this week's rendering of the same data without
// anyone having touched it. The receipt therefore records the version with the build appended
// ("0.1.0+3f9a1c2b"), and verify compares pages only when that matches.
//
// The build is the first eight hex characters of a SHA-256 over two things. One is the file this
// code runs from: the bundled server, which holds the renderer, the player and the rules. The other
// is the language data of the runtime (ICU, CLDR, Unicode): the renderer breaks long words and
// writes numbers with `Intl`, so the same bundle on a Node with other language data can draw a page
// differently. Nothing is read until a publish or a verify asks, so starting the server still
// touches nothing.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let cached: string | null | undefined;

/** The build, or null when this file cannot be read (then versions are compared without it). */
export function buildId(): string | null {
  if (cached === undefined) {
    try {
      const { icu = '', cldr = '', unicode = '' } = process.versions;
      cached = createHash('sha256')
        .update(readFileSync(fileURLToPath(import.meta.url)))
        .update(`\nicu ${icu} cldr ${cldr} unicode ${unicode}`)
        .digest('hex')
        .slice(0, 8);
    } catch {
      cached = null;
    }
  }
  return cached;
}

/** `version` as a receipt records it: with the build, in the form semantic versioning gives build metadata. */
export function stampedVersion(version: string): string {
  const build = buildId();
  return build === null ? version : `${version}+${build}`;
}
