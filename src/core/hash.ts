// Canonical JSON and the lesson hash. The hash in a receipt is the SHA-256 of the canonical JSON of
// the lesson, so anyone holding the published file can recompute it.
//
// Environment-neutral, like the rest of core: the player's own typecheck covers this directory, so
// there is no node: import here. SHA-256 is written out below (FIPS 180-4) and is tested against
// node:crypto on fixed vectors and on every block-boundary length.
import type { LessonV2 } from './clip';

/** Deeper than any lesson (eight levels); a guard against a value that contains itself. */
const MAX_DEPTH = 64;

function write(value: unknown, depth: number): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: a number must be finite.');
      // JSON.stringify gives the shortest form that round-trips, and writes -0 as 0.
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new TypeError(`canonicalJson: a ${typeof value} cannot be written as JSON.`);
  }
  if (depth >= MAX_DEPTH) throw new TypeError('canonicalJson: the value is nested too deeply, or contains itself.');
  if (Array.isArray(value)) {
    let out = '[';
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out += ',';
      // A hole or `undefined` in an array is written as null, as JSON.stringify does, so positions never shift.
      out += value[i] === undefined ? 'null' : write(value[i], depth + 1);
    }
    return `${out}]`;
  }
  const record = value as Record<string, unknown>;
  // Sorted by UTF-16 code unit, which does not depend on the machine's locale.
  const keys = Object.keys(record).sort();
  let out = '{';
  let first = true;
  for (const key of keys) {
    const child = record[key];
    // An absent optional field and one set to `undefined` are the same lesson.
    if (child === undefined) continue;
    if (!first) out += ',';
    first = false;
    out += `${JSON.stringify(key)}:${write(child, depth + 1)}`;
  }
  return `${out}}`;
}

/**
 * One fixed text for a JSON value: object keys sorted, no white space, arrays in order, properties
 * whose value is `undefined` left out. Two values that are equal as JSON give the same string.
 * Throws a TypeError for anything JSON cannot hold (a non-finite number, a function, a cycle).
 */
export function canonicalJson(value: unknown): string {
  return write(value, 0);
}

/** The UTF-8 bytes of a string. A lone surrogate becomes U+FFFD, as every encoder writes it. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// The first 32 bits of the fractional parts of the cube roots of the first 64 primes.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of `bytes`, in lowercase hex. */
export function sha256Hex(bytes: Uint8Array): string {
  const length = bytes.length;
  // The message, a 1 bit, zeros, and the bit length in 64 bits, to a whole number of 64-byte blocks.
  const total = (((length + 8) >> 6) + 1) << 6;
  const data = new Uint8Array(total);
  data.set(bytes);
  data[length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(total - 8, Math.floor(length / 0x20000000));
  view.setUint32(total - 4, (length << 3) >>> 0);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < total; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15] as number;
      const y = w[t - 2] as number;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = ((w[t - 16] as number) + s0 + (w[t - 7] as number) + s1) >>> 0;
    }
    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    let f = h[5] as number;
    let g = h[6] as number;
    let hh = h[7] as number;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[t] as number) + (w[t] as number)) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + b) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
    h[5] = ((h[5] as number) + f) >>> 0;
    h[6] = ((h[6] as number) + g) >>> 0;
    h[7] = ((h[7] as number) + hh) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) out += (h[i] as number).toString(16).padStart(8, '0');
  return out;
}

/** SHA-256, in lowercase hex, of the UTF-8 bytes of the lesson's canonical JSON. */
export function hashLesson(lesson: LessonV2): string {
  return sha256Hex(utf8(canonicalJson(lesson)));
}
