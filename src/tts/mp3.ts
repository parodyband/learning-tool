// Is this byte string an MP3? A 200 with an audio content type is not proof: a proxy or a captive
// portal can answer anything. What passes here is embedded in the lesson and handed to an <audio>
// element, so the check reads the first MPEG frame header instead of trusting two magic bytes.

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, readonly number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

/** Length in bytes of the Layer III frame whose header starts at `at`, 0 when free-format, -1 when not a frame header. */
function frameLength(b: Uint8Array, at: number): number {
  const b0 = b[at];
  const b1 = b[at + 1];
  const b2 = b[at + 2];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b[at + 3] === undefined) return -1;
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return -1;
  const version = (b1 >> 3) & 3;
  const layer = (b1 >> 1) & 3;
  const bitrateIndex = b2 >> 4;
  const rate = SAMPLE_RATES[version]?.[(b2 >> 2) & 3];
  // Version 1 is reserved, layer 1 is Layer III, bitrate index 15 is invalid.
  if (version === 1 || layer !== 1 || bitrateIndex === 15 || rate === undefined) return -1;
  if (bitrateIndex === 0) return 0;
  const kbps = (version === 3 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex] ?? 0;
  const padding = (b2 >> 1) & 1;
  return Math.floor(((version === 3 ? 144000 : 72000) * kbps) / rate) + padding;
}

/** Offset of the first byte after any leading ID3v2 tags, or -1 when a tag is malformed or runs past the end. */
function skipId3(b: Uint8Array): number {
  let at = 0;
  for (let tags = 0; tags < 4; tags += 1) {
    if (b[at] !== 0x49 || b[at + 1] !== 0x44 || b[at + 2] !== 0x33) return at;
    const flags = b[at + 5];
    const s = [b[at + 6], b[at + 7], b[at + 8], b[at + 9]];
    if (flags === undefined || s.some((x) => x === undefined || x > 0x7f)) return -1;
    const size = ((s[0] ?? 0) << 21) | ((s[1] ?? 0) << 14) | ((s[2] ?? 0) << 7) | (s[3] ?? 0);
    at += 10 + size + (flags & 0x10 ? 10 : 0);
    if (at >= b.length) return -1;
  }
  return -1;
}

/**
 * True when the bytes start (after optional ID3v2 tags) with a valid MPEG Layer III frame header
 * and, when the data is long enough to tell, a second frame begins exactly where the first ends.
 */
export function looksLikeMp3(bytes: Uint8Array): boolean {
  const start = skipId3(bytes);
  if (start < 0) return false;
  const length = frameLength(bytes, start);
  if (length < 0) return false;
  if (length === 0 || start + length + 4 > bytes.length) return true;
  return frameLength(bytes, start + length) >= 0;
}
