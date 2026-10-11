// Shared by the text tests only.
import type { Inline } from '../../src/core/markup';

/** A small seeded generator (mulberry32), so "random" inputs are the same on every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

/** Inline nodes as a compact string, so a table row can state the expected structure: `<b>bold</b> and <c>code</c>`. */
export function show(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
          return n.v;
        case 'strong':
          return `<b>${show(n.c)}</b>`;
        case 'em':
          return `<i>${show(n.c)}</i>`;
        case 'code':
          return `<c>${n.v}</c>`;
        case 'math':
          return `<m>${n.v}</m>`;
      }
    })
    .join('');
}

/** The fastest of `runs` timings of `fn`, in milliseconds. The minimum is what the code can do; the rest is the machine being busy. */
export function fastest(fn: () => unknown, runs = 5): number {
  let best = Number.POSITIVE_INFINITY;
  for (let r = 0; r < runs; r++) {
    const t = performance.now();
    fn();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}
