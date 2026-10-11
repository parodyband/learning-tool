// The MP3 check that stands between an HTTP response and the lesson file.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { looksLikeMp3 } from '../../src/tts/mp3';
import { BARE_SILENT_MP3, SILENT_MP3 } from './helpers/silence';

const bytes = (...b: number[]): Uint8Array => new Uint8Array(b);
const ascii = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'latin1'));
const concat = (...parts: Uint8Array[]): Uint8Array => new Uint8Array(Buffer.concat(parts));

// MPEG-1 Layer III, 128 kbit/s, 44.1 kHz, no padding: a 417-byte frame.
const FRAME_128 = (() => {
  const f = new Uint8Array(417);
  f.set([0xff, 0xfb, 0x90, 0x00]);
  return f;
})();

describe('the committed silent clips', () => {
  it('are the bytes ffmpeg produced', () => {
    expect(SILENT_MP3.byteLength).toBe(1271);
    expect(createHash('sha256').update(SILENT_MP3).digest('hex')).toBe('f2682dd6c2fa0587e1df8cfba9b0af89233175a6ffa797385e7269287050ad87');
    expect(BARE_SILENT_MP3.byteLength).toBe(1045);
    expect(createHash('sha256').update(BARE_SILENT_MP3).digest('hex')).toBe('6d4923bf907c8c3f0c16457ac18191efea35e2ad85ed6da05eceb1acf4eb0daf');
  });
});

describe('looksLikeMp3 accepts', () => {
  it.each([
    ['a clip that starts with an ID3v2 tag', SILENT_MP3],
    ['a clip that starts on a frame', BARE_SILENT_MP3],
    ['two MPEG-1 frames', concat(FRAME_128, FRAME_128)],
    ['one frame and nothing after it', FRAME_128],
    ['a bare frame header', bytes(0xff, 0xfb, 0x90, 0x00)],
    ['a free-format frame', bytes(0xff, 0xfb, 0x00, 0x00, 0, 0, 0, 0)],
    ['a clip cut off in the middle of a frame', SILENT_MP3.subarray(0, 200)],
    ['two ID3v2 tags, then frames', concat(ascii('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0004abcd'), SILENT_MP3)],
  ])('%s', (_name, data) => {
    expect(looksLikeMp3(data)).toBe(true);
  });
});

describe('looksLikeMp3 rejects', () => {
  it.each([
    ['nothing', bytes()],
    ['three bytes', bytes(0xff, 0xfb, 0x90)],
    ['an HTML page', ascii('<!doctype html><html><body>Sign in to the network</body></html>')],
    ['a JSON error', ascii('{"detail":{"status":"invalid_api_key","message":"Invalid API key"}}')],
    ['a WAV file', ascii('RIFF$\u0000\u0000\u0000WAVEfmt ')],
    ['an Ogg file', ascii('OggS\u0000\u0002\u0000\u0000\u0000\u0000\u0000\u0000')],
    ['an MP4 file', ascii('\u0000\u0000\u0000 ftypM4A \u0000\u0000\u0000\u0000')],
    ['an ID3 tag with no audio after it', ascii('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0004abcd')],
    ['an ID3 tag that claims more than is there', ascii('ID3\u0004\u0000\u0000\u0000\u0000\u007f\u007fabcd')],
    ['an ID3 tag with a malformed size', concat(ascii('ID3\u0004\u0000\u0000'), bytes(0x80, 0, 0, 4), SILENT_MP3)],
    ['an ID3 tag followed by text', concat(ascii('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0004abcd'), ascii('not audio at all'))],
    ['a sync word with the reserved version', bytes(0xff, 0xeb, 0x90, 0x00)],
    ['a sync word with the reserved layer', bytes(0xff, 0xf9, 0x90, 0x00)],
    ['a Layer II frame', bytes(0xff, 0xfd, 0x90, 0x00)],
    ['an invalid bitrate', bytes(0xff, 0xfb, 0xf0, 0x00)],
    ['a reserved sample rate', bytes(0xff, 0xfb, 0x9c, 0x00)],
    ['all ones', new Uint8Array(64).fill(0xff)],
    ['all zeros', new Uint8Array(64)],
    ['a frame followed by something that is not a frame', concat(FRAME_128, ascii('<html>not audio</html>'))],
    ['text that happens to start with 0xFF', concat(bytes(0xff), ascii('hello world, this is not audio'))],
  ])('%s', (_name, data) => {
    expect(looksLikeMp3(data)).toBe(false);
  });
});
