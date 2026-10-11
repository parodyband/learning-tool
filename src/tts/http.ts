// The one place that touches the ElevenLabs key, and the request loop built on top of it.
//
// `sealKey` closes over the key and gives back two functions. Neither returns the key, neither
// throws, and the sending one decides the destination itself from `resolveOrigin`. Everything else
// in this module works with a `Secret` and never sees the string.
//
// Errors from `fetch` are classified and discarded here, never rethrown or attached as a cause: an
// undici error can quote the request it failed on.
import { classifyStatus, fail, type Failure } from './codes';
import { resolveOrigin, type TestBaseUrl } from './origin';

export type FetchLike = typeof fetch;

export interface WireRequest {
  baseUrl: TestBaseUrl | undefined;
  method: 'GET' | 'POST';
  /** Absolute path on the ElevenLabs API, built only from constants and ids we validated. */
  path: string;
  query?: Readonly<Record<string, string>>;
  json?: unknown;
  accept: string;
  signal: AbortSignal;
  fetch: FetchLike;
}

export interface Secret {
  /** Sends one request with the key attached. Resolves to the response, or to how the exchange broke. */
  send(req: WireRequest): Promise<Response | 'network' | 'redirect'>;
  /** True when `text` contains the key or a recognisable piece of it. Used to drop anything a response echoes. */
  mentions(text: string): boolean;
}

const alnum = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** True when `a` and `b` share a run of at least `min` consecutive characters. */
function sharesRun(a: string, b: string, min: number): boolean {
  if (a.length < min || b.length < min) return false;
  let prev = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j += 1) {
      if (a.charCodeAt(i - 1) !== b.charCodeAt(j - 1)) continue;
      const run = (prev[j - 1] ?? 0) + 1;
      if (run >= min) return true;
      row[j] = run;
    }
    prev = row;
  }
  return false;
}

// undici reports a refused redirect as TypeError('fetch failed') with cause Error('unexpected redirect').
function isRedirectError(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur instanceof Error; depth += 1) {
    if (/redirect/i.test(cur.message)) return true;
    cur = cur.cause;
  }
  return false;
}

/** Wraps the key. Call once, at configuration time, and let the argument go out of scope. */
export function sealKey(key: string): Secret {
  const folded = alnum(key);
  return Object.freeze({
    async send(req: WireRequest): Promise<Response | 'network' | 'redirect'> {
      const origin = resolveOrigin(req.baseUrl);
      const url = new URL(req.path, origin);
      for (const [name, value] of Object.entries(req.query ?? {})) url.searchParams.set(name, value);
      // A path can only be built from constants and validated ids, so this cannot differ. Checked anyway.
      if (url.origin !== origin) return 'network';
      const headers: Record<string, string> = { 'xi-api-key': key, accept: req.accept };
      let body: string | undefined;
      if (req.json !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(req.json);
      }
      try {
        // `redirect: 'error'`: a redirect is never followed, so the key cannot travel to another host.
        const res = await req.fetch(url.href, { method: req.method, headers, body, redirect: 'error', signal: req.signal });
        return res instanceof Response || typeof (res as { status?: unknown } | null)?.status === 'number' ? res : 'network';
      } catch (err) {
        return isRedirectError(err) ? 'redirect' : 'network';
      }
    },
    mentions(text: string): boolean {
      if (text.includes(key)) return true;
      return sharesRun(alnum(text.slice(0, 256)), folded, 12);
    },
  });
}

// ---------------------------------------------------------------------------------------------
// One call: attempts, timeouts, retries
// ---------------------------------------------------------------------------------------------

export const MAX_ATTEMPTS = 3;
export const DEFAULT_BACKOFF_MS: readonly number[] = [1000, 3000];
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface CallContext {
  secret: Secret;
  baseUrl: TestBaseUrl | undefined;
  fetch: FetchLike;
  /** Aborted when the whole run is out of time or the caller gave up. */
  run: AbortSignal;
  /** `Date.now()` value after which no request may start. */
  deadlineAt: number;
  requestTimeoutMs: number;
  backoffMs: readonly number[];
  /** True once the run has decided to send nothing more; pending retries stop. */
  halted(): boolean;
  counters: { requests: number };
}

export type CallResult<T> = { ok: true; value: T } | Failure;

export interface CallSpec<T> {
  method: 'GET' | 'POST';
  path: string;
  query?: Readonly<Record<string, string>>;
  json?: unknown;
  accept: string;
  /** Turns a 200 response into a value, or says why it is unusable. */
  read(res: Response): Promise<CallResult<T>>;
  /** Called once per request actually sent. */
  onAttempt?(): void;
  /** Called with the headers of a 200 response. */
  onHeaders?(headers: Headers): void;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads a body up to `cap` bytes. Returns null, and stops reading, when it is larger. */
export async function readCapped(res: Response, cap: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length') ?? 'NaN');
  if (Number.isFinite(declared) && declared > cap) return null;
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Parses a JSON body of at most `cap` bytes into an object, or returns null. */
export async function readJsonObject(res: Response, cap: number): Promise<Record<string, unknown> | null> {
  const bytes = await readCapped(res, cap);
  if (!bytes) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// The error body is read for three known fields and then dropped. Its message is never kept.
async function errorTokens(res: Response): Promise<string[]> {
  try {
    const detail = (await readJsonObject(res, 16_384))?.detail;
    if (!isRecord(detail)) return [];
    return [detail.code, detail.status, detail.type].filter((v): v is string => typeof v === 'string' && v.length <= 64).map((v) => v.toLowerCase());
  } catch {
    return [];
  }
}

function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after')?.trim();
  if (!raw || !/^\d{1,3}$/.test(raw)) return undefined;
  return Math.min(Number(raw), 30) * 1000;
}

async function exchange<T>(ctx: CallContext, spec: CallSpec<T>, signal: AbortSignal): Promise<CallResult<T>> {
  try {
    const res = await ctx.secret.send({
      baseUrl: ctx.baseUrl,
      method: spec.method,
      path: spec.path,
      query: spec.query,
      json: spec.json,
      accept: spec.accept,
      signal,
      fetch: ctx.fetch,
    });
    if (res === 'redirect') return fail('VOICE_NETWORK', { stop: true });
    if (res === 'network') return fail('VOICE_NETWORK', { retry: true });
    try {
      // A fetch that ignored `redirect: 'error'` (an injected one might) is still refused here.
      if (res.redirected || (res.status >= 300 && res.status <= 399)) return fail('VOICE_NETWORK', { stop: true, status: res.status });
      if (res.status !== 200) {
        const failure = classifyStatus(res.status, await errorTokens(res));
        const wait = failure.retry ? retryAfterMs(res.headers) : undefined;
        return wait === undefined ? failure : { ...failure, retryAfterMs: wait };
      }
      spec.onHeaders?.(res.headers);
      return await spec.read(res);
    } finally {
      // Free the socket whether or not the body was read to the end.
      try {
        void res.body?.cancel().catch(() => undefined);
      } catch {
        // already locked or closed
      }
    }
  } catch {
    return fail('VOICE_NETWORK', { retry: true });
  }
}

const OUT_OF_TIME = fail('VOICE_TIMEOUT', { stop: true });

async function once<T>(ctx: CallContext, spec: CallSpec<T>): Promise<CallResult<T>> {
  const remaining = ctx.deadlineAt - Date.now();
  if (ctx.run.aborted || remaining <= 0) return OUT_OF_TIME;
  const attempt = new AbortController();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      attempt.abort();
    },
    Math.min(ctx.requestTimeoutMs, remaining),
  );
  const onRunAbort = (): void => attempt.abort();
  ctx.run.addEventListener('abort', onRunAbort, { once: true });
  // Raced against the exchange so that a fetch which ignores its signal cannot hold the run past its deadline.
  const gaveUp = new Promise<null>((resolve) => attempt.signal.addEventListener('abort', () => resolve(null), { once: true }));
  ctx.counters.requests += 1;
  spec.onAttempt?.();
  try {
    const out = await Promise.race([exchange(ctx, spec, attempt.signal), gaveUp]);
    if (out !== null && (out.ok || !attempt.signal.aborted)) return out;
    return timedOut && !ctx.run.aborted ? fail('VOICE_TIMEOUT', { retry: true }) : OUT_OF_TIME;
  } finally {
    clearTimeout(timer);
    ctx.run.removeEventListener('abort', onRunAbort);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Sends one request, with up to three attempts. Network errors, per-request timeouts, 408, 429 and
 * 5xx are retried after a backoff (1 s, then 3 s, with jitter; longer when Retry-After asks).
 * Never rejects.
 */
export async function call<T>(ctx: CallContext, spec: CallSpec<T>): Promise<CallResult<T>> {
  for (let attempt = 1; ; attempt += 1) {
    const out = await once(ctx, spec);
    if (out.ok || !out.retry || attempt >= MAX_ATTEMPTS || ctx.halted()) return out;
    const base = ctx.backoffMs[Math.min(attempt, ctx.backoffMs.length) - 1] ?? 0;
    const wait = Math.max(base * (0.8 + Math.random() * 0.4), out.retryAfterMs ?? 0);
    // Not enough time left to wait and try again: report what ElevenLabs actually said.
    if (Date.now() + wait >= ctx.deadlineAt) return out;
    await sleep(wait, ctx.run);
  }
}
