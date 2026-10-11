// A local stand-in for the three ElevenLabs endpoints the voice module uses. No API key exists on
// the development machine, so this is the only thing the module has ever talked to. It can be told
// to succeed, to fail in each documented shape, to be slow, to hang, to redirect and to answer
// garbage, and it records every request it receives so tests can assert on what was sent.
//
// Usable from any test that needs voice without a network (the server's canary test, for one):
//
//   const stub = await startStub({ key: FAKE_KEY });
//   const config = voiceConfigFromEnv({ LEARNING_TOOL_ELEVENLABS_API_KEY: FAKE_KEY });
//   await synthesizeLesson(segments, config, { cacheDir, baseUrl: stub.baseUrl });
//   await stub.close();
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loopbackBaseUrl, type TestBaseUrl } from '../../../src/tts/testing';
import { SILENT_MP3 } from './silence';

export interface StubRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  body: string;
  /** The parsed JSON body, or undefined. */
  json: unknown;
}

const detail = (status: number, type: string, code: string, legacy: string, message: string) => ({
  status,
  body: { detail: { type, code, message, status: legacy, request_id: 'req_stub_0001' } },
});

/**
 * Error responses in the shapes ElevenLabs documents, plus the two seen live without a key.
 * `detail.status` is the legacy field: it does not always equal `detail.code`.
 */
export const ERRORS = {
  /** Live, 2026-10-10: request without a key. */
  no_key: detail(401, 'authentication_error', 'unauthorized', 'needs_authorization', 'Missing API key.'),
  /** Live, 2026-10-10: request with an invalid key. */
  bad_key: detail(401, 'authentication_error', 'unauthorized', 'invalid_api_key', 'Invalid API key.'),
  /** As the errors page lists it. */
  bad_key_documented: detail(401, 'authentication_error', 'invalid_api_key', 'invalid_api_key', 'Invalid API key.'),
  quota: detail(402, 'payment_required', 'insufficient_credits', 'insufficient_credits', 'You have insufficient credits.'),
  /** The older quota response: HTTP 401 with only the legacy field. */
  quota_legacy: { status: 401, body: { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota.' } } },
  rate_limit: detail(429, 'rate_limit_error', 'rate_limit_exceeded', 'rate_limit_exceeded', 'Too many requests.'),
  concurrency: detail(429, 'rate_limit_error', 'concurrent_limit_exceeded', 'concurrent_limit_exceeded', 'Too many concurrent requests.'),
  busy: detail(429, 'rate_limit_error', 'system_busy', 'system_busy', 'The system is busy.'),
  voice_not_found: detail(404, 'not_found', 'voice_not_found', 'voice_not_found', 'A voice with that id was not found.'),
  invalid_voice_id: detail(400, 'validation_error', 'invalid_voice_id', 'invalid_voice_id', 'That voice id is not valid.'),
  voice_access_denied: detail(403, 'authorization_error', 'voice_access_denied', 'voice_access_denied', 'You may not use this voice.'),
  model_access_denied: detail(403, 'authorization_error', 'model_access_denied', 'model_access_denied', 'You may not use this model.'),
  subscription_required: detail(403, 'authorization_error', 'subscription_required', 'subscription_required', 'This needs a paid plan.'),
  internal_error: detail(500, 'internal_error', 'internal_error', 'internal_error', 'Something went wrong.'),
  service_unavailable: detail(503, 'internal_error', 'service_unavailable', 'service_unavailable', 'Try again later.'),
  request_timeout: detail(408, 'timeout_error', 'request_timeout', 'request_timeout', 'The request timed out.'),
  /** Request validation: `detail` is a list, not an object. */
  validation: { status: 422, body: { detail: [{ loc: ['body', 'text'], msg: 'field required', type: 'value_error.missing' }] } },
} as const;

export type ErrorName = keyof typeof ERRORS;

export type Reply =
  /** 200 with MP3 bytes (the silent clip unless `bytes` is given). */
  | { kind: 'audio'; bytes?: Uint8Array; contentType?: string; headers?: Record<string, string>; delayMs?: number }
  /** One of the documented error shapes. `message` replaces the message text; `headers` are added. */
  | { kind: 'error'; error: ErrorName; message?: string; headers?: Record<string, string>; delayMs?: number }
  /** Any status with a JSON body. */
  | { kind: 'json'; status?: number; body: unknown; headers?: Record<string, string>; delayMs?: number }
  /** Any status, content type and bytes: for garbage. */
  | { kind: 'raw'; status: number; contentType?: string; body: Uint8Array | string; headers?: Record<string, string>; delayMs?: number }
  | { kind: 'redirect'; status?: 301 | 302 | 303 | 307 | 308; location: string }
  /** Accept the request and never answer. */
  | { kind: 'hang' }
  /** Drop the connection without answering. */
  | { kind: 'reset' }
  /** Send headers and the first bytes of a clip, then never finish. */
  | { kind: 'stall' }
  /** Promise more bytes than are sent, then close. */
  | { kind: 'truncate' };

export type Handler = (req: StubRequest, nth: number) => Reply;

export const STUB_VOICES = [
  { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', category: 'premade' },
  { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', category: 'premade' },
  { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', category: 'premade' },
];
export const GEORGE = 'JBFqnCBsd6RMkjVDRZzb';

export const STUB_SUBSCRIPTION = {
  tier: 'free',
  character_count: 2300,
  character_limit: 10000,
  can_extend_character_limit: false,
  status: 'free',
  next_character_count_reset_unix: 1793491200,
};

export interface Stub {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  /** Pass as `opts.baseUrl`. */
  baseUrl: TestBaseUrl;
  /** Every request received, in arrival order, including ones answered 401 for a wrong key. */
  requests: StubRequest[];
  /** Replace how an endpoint answers. `nth` counts requests to that endpoint from 1. */
  tts: Handler;
  voices: Handler;
  subscription: Handler;
  /** Requests to an endpoint so far. */
  count(endpoint: 'tts' | 'voices' | 'subscription' | 'other'): number;
  ttsRequests(): StubRequest[];
  /** The most text-to-speech requests that were in flight at the same moment. */
  maxConcurrentTts: number;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function endpointOf(method: string, path: string): 'tts' | 'voices' | 'subscription' | 'other' {
  if (method === 'POST' && /^\/v1\/text-to-speech\/[^/]+$/.test(path)) return 'tts';
  if (method === 'GET' && path === '/v2/voices') return 'voices';
  if (method === 'GET' && path === '/v1/user/subscription') return 'subscription';
  return 'other';
}

/**
 * Starts the stub on an ephemeral loopback port. A request whose `xi-api-key` is not `key` gets the
 * invalid-key response, as the real service would give.
 */
export async function startStub(options: { key: string }): Promise<Stub> {
  const counts = { tts: 0, voices: 0, subscription: 0, other: 0 };
  let inFlightTts = 0;
  const open = new Set<ServerResponse>();

  const stub: Stub = {
    origin: '',
    baseUrl: undefined as unknown as TestBaseUrl,
    requests: [],
    tts: () => ({ kind: 'audio' }),
    voices: () => ({ kind: 'json', body: { voices: STUB_VOICES, has_more: false, total_count: STUB_VOICES.length, next_page_token: null } }),
    subscription: () => ({ kind: 'json', body: STUB_SUBSCRIPTION }),
    count: (endpoint) => counts[endpoint],
    ttsRequests: () => stub.requests.filter((r) => endpointOf(r.method, r.path) === 'tts'),
    maxConcurrentTts: 0,
    close: async () => {
      for (const res of open) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };

  async function answer(res: ServerResponse, reply: Reply): Promise<void> {
    if ('delayMs' in reply && reply.delayMs) await sleep(reply.delayMs);
    if (res.destroyed) return;
    switch (reply.kind) {
      case 'audio': {
        const bytes = reply.bytes ?? SILENT_MP3;
        res.writeHead(200, {
          'content-type': reply.contentType ?? 'audio/mpeg',
          'content-length': String(bytes.byteLength),
          'request-id': 'req_stub_0001',
          'character-cost': '42',
          ...reply.headers,
        });
        res.end(bytes);
        return;
      }
      case 'error': {
        const shape = ERRORS[reply.error];
        const body: unknown = JSON.parse(JSON.stringify(shape.body));
        const d = (body as { detail?: unknown }).detail;
        if (reply.message !== undefined && typeof d === 'object' && d !== null && !Array.isArray(d)) (d as { message: string }).message = reply.message;
        res.writeHead(shape.status, { 'content-type': 'application/json', ...reply.headers });
        res.end(JSON.stringify(body));
        return;
      }
      case 'json':
        res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers });
        res.end(JSON.stringify(reply.body));
        return;
      case 'raw':
        res.writeHead(reply.status, { ...(reply.contentType ? { 'content-type': reply.contentType } : {}), ...reply.headers });
        res.end(reply.body);
        return;
      case 'redirect':
        res.writeHead(reply.status ?? 302, { location: reply.location });
        res.end();
        return;
      case 'hang':
        return;
      case 'reset':
        res.destroy();
        return;
      case 'stall':
        res.writeHead(200, { 'content-type': 'audio/mpeg' });
        res.write(SILENT_MP3.subarray(0, 64));
        return;
      case 'truncate':
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': String(SILENT_MP3.byteLength) });
        res.write(SILENT_MP3.subarray(0, 100));
        // Let the bytes reach the client before the connection drops.
        await sleep(20);
        res.destroy();
        return;
    }
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://stub.invalid');
      const body = Buffer.concat(chunks).toString('utf8');
      let json: unknown;
      try {
        json = body === '' ? undefined : JSON.parse(body);
      } catch {
        json = undefined;
      }
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) headers[name] = Array.isArray(value) ? value.join(', ') : (value ?? '');
      const seen: StubRequest = { method: req.method ?? '', path: url.pathname, query: Object.fromEntries(url.searchParams), headers, body, json };
      stub.requests.push(seen);

      const endpoint = endpointOf(seen.method, seen.path);
      counts[endpoint] += 1;
      const nth = counts[endpoint];
      open.add(res);
      if (endpoint === 'tts') {
        inFlightTts += 1;
        stub.maxConcurrentTts = Math.max(stub.maxConcurrentTts, inFlightTts);
      }
      res.on('close', () => {
        open.delete(res);
        if (endpoint === 'tts') inFlightTts -= 1;
      });

      let reply: Reply;
      if (headers['xi-api-key'] !== options.key) reply = { kind: 'error', error: headers['xi-api-key'] === undefined ? 'no_key' : 'bad_key' };
      else if (endpoint === 'tts') reply = stub.tts(seen, nth);
      else if (endpoint === 'voices') reply = stub.voices(seen, nth);
      else if (endpoint === 'subscription') reply = stub.subscription(seen, nth);
      else reply = { kind: 'json', status: 404, body: { detail: { type: 'not_found', code: 'not_found', message: 'No such route.', status: 'not_found' } } };
      void answer(res, reply).catch(() => res.destroy());
    });
    req.on('error', () => res.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  stub.origin = `http://127.0.0.1:${port}`;
  stub.baseUrl = loopbackBaseUrl(stub.origin);
  return stub;
}

/**
 * A second server that should never hear from us: the target of redirects. It records anything it
 * receives, so a test can assert that the key did not follow a redirect.
 */
export async function startTrap(): Promise<{ origin: string; requests: StubRequest[]; close(): Promise<void> }> {
  const requests: StubRequest[] = [];
  const server = createServer((req, res) => {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) headers[name] = Array.isArray(value) ? value.join(', ') : (value ?? '');
    const url = new URL(req.url ?? '/', 'http://trap.invalid');
    requests.push({ method: req.method ?? '', path: url.pathname, query: Object.fromEntries(url.searchParams), headers, body: '', json: undefined });
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    res.end(SILENT_MP3);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
