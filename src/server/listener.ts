// The local link: http://127.0.0.1:<port>/l/<token>/ for lessons this process published.
//
// It exists so a lesson can be opened from a chat that will not link to file://. It is deliberately
// as small as a server can be:
//   - It starts on the first publish, never at boot, and closes when the MCP connection closes.
//   - It binds 127.0.0.1 only. The preferred port is tried first, then any free port.
//   - GET and HEAD only. A request whose Host is not exactly 127.0.0.1:<port> is refused (421), which
//     defeats DNS rebinding; one that carries an Origin header is refused (403), because nothing on
//     another page has any business here.
//   - The only path is /l/<token>/, where the token is 128 random bits held in memory and mapped to
//     a file this process wrote. There is no listing and nothing else to find.
//   - The MCP transport is never mounted on it, and no response carries a CORS header.
//   - A connection that sends nothing, or never finishes its headers, is dropped after a few seconds,
//     so idle sockets cannot use up the connections a learner's browser needs.
import { randomBytes } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readPlainFile } from './store';

const TOKEN_PATH = /^\/l\/([0-9a-f]{32})\/$/;
/** A lesson with narration audio is a few megabytes. */
const MAX_LESSON_BYTES = 96 * 1024 * 1024;

/** Sent with every response, the refusals included. */
const BASE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};
const REFUSAL_CSP = "default-src 'none'; frame-ancestors 'none'";

/**
 * How long a slow connection is kept. Node applies `headers` and `request` only when it sweeps its
 * connections, and by default it sweeps every 30 seconds: without `sweep` a silent socket lived for
 * half a minute, and 64 of them (the most this listener holds) shut the lesson out for as long.
 */
export const LISTENER_TIMEOUTS = { headersMs: 5_000, requestMs: 10_000, keepAliveMs: 1_000, sweepMs: 1_000 } as const;
export type ListenerTimeouts = { [K in keyof typeof LISTENER_TIMEOUTS]: number };

interface Entry {
  file: string;
  /** The policy in the file's own meta element. The header repeats it and adds frame-ancestors, which a meta element cannot set. */
  csp: string;
}

export interface ListenerOptions {
  /** The port to try first. 0 asks for any free port straight away. */
  port: number;
  log?: (line: string) => void;
  /** Tests only: shorter limits, so a test of a stalled connection does not take seconds. */
  timeouts?: Partial<ListenerTimeouts>;
}

export class LessonListener {
  private readonly preferred: number;
  private readonly log: (line: string) => void;
  private readonly timeouts: ListenerTimeouts;
  private readonly entries = new Map<string, Entry>();
  private readonly tokenOf = new Map<string, string>();
  private server: http.Server | null = null;
  private starting: Promise<number | null> | null = null;
  private boundPort: number | null = null;
  /** The port last listened on. Tried first when the listener opens again, so links already given keep their address. */
  private lastPort: number | null = null;

  constructor(options: ListenerOptions) {
    this.preferred = options.port;
    this.log = options.log ?? (() => undefined);
    this.timeouts = { ...LISTENER_TIMEOUTS, ...options.timeouts };
  }

  /** The port being listened on, or null while closed. */
  get port(): number | null {
    return this.boundPort;
  }

  /**
   * Serve `file` for the lesson `key` and return its URL, starting the listener if it is not
   * running. A lesson keeps its token for the life of the process, and the listener comes back on
   * the port it had, so publishing a lesson again returns the link the learner already has.
   * Returns null when no port could be opened; the file link still works.
   */
  async serve(key: string, file: string, csp: string): Promise<string | null> {
    const port = await this.start();
    if (port === null) return null;
    let token = this.tokenOf.get(key);
    if (token === undefined) {
      token = randomBytes(16).toString('hex');
      this.tokenOf.set(key, token);
    }
    this.entries.set(token, { file, csp });
    return `http://127.0.0.1:${port}/l/${token}/`;
  }

  /** The URL of a lesson this process is serving right now, or null. Never starts the listener. */
  urlFor(key: string): string | null {
    const token = this.tokenOf.get(key);
    return token !== undefined && this.boundPort !== null ? `http://127.0.0.1:${this.boundPort}/l/${token}/` : null;
  }

  /** Stop listening and drop open connections. Safe to call when it never started. */
  async close(): Promise<void> {
    const pending = this.starting;
    if (pending) await pending.catch(() => null);
    const server = this.server;
    this.server = null;
    this.boundPort = null;
    this.starting = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  private start(): Promise<number | null> {
    if (this.boundPort !== null) return Promise.resolve(this.boundPort);
    if (!this.starting) {
      this.starting = this.open().then((port) => {
        this.starting = null;
        return port;
      });
    }
    return this.starting;
  }

  private async open(): Promise<number | null> {
    const candidates = [...new Set([...(this.lastPort === null ? [] : [this.lastPort]), this.preferred, 0])];
    const { headersMs, requestMs, keepAliveMs, sweepMs } = this.timeouts;
    for (const candidate of candidates) {
      const options = { maxHeaderSize: 8192, requestTimeout: requestMs, headersTimeout: headersMs, keepAliveTimeout: keepAliveMs, connectionsCheckingInterval: sweepMs };
      const server = http.createServer(options, (req, res) => {
        void this.answer(req, res).catch(() => res.destroy());
      });
      server.maxConnections = 64;
      server.on('clientError', (_error, socket) => socket.destroy());
      const port = await new Promise<number | null>((resolve) => {
        server.once('error', () => resolve(null));
        // `exclusive` keeps a second copy of this server from sharing the port.
        server.listen({ host: '127.0.0.1', port: candidate, exclusive: true }, () => resolve((server.address() as AddressInfo).port));
      });
      if (port !== null) {
        // The MCP connection keeps the process alive, not this. A host that ends without closing the connection must not leave a process behind.
        server.unref();
        this.server = server;
        this.boundPort = port;
        this.lastPort = port;
        this.log(`learning-tool: serving published lessons on http://127.0.0.1:${port}/ (this machine only)`);
        return port;
      }
      server.close();
    }
    this.log('learning-tool: no local port could be opened; lessons are available as files only');
    return null;
  }

  private refuse(res: ServerResponse, status: number, text: string, extra: Record<string, string> = {}): void {
    const body = Buffer.from(`${text}\n`, 'utf8');
    res.writeHead(status, { ...BASE_HEADERS, 'Content-Security-Policy': REFUSAL_CSP, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': String(body.byteLength), ...extra });
    res.end(res.req.method === 'HEAD' ? undefined : body);
  }

  private async answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // No request here has a body worth reading.
    req.resume();
    const port = this.boundPort;
    if (req.method !== 'GET' && req.method !== 'HEAD') return this.refuse(res, 405, 'Only GET and HEAD are served here.', { Allow: 'GET, HEAD' });
    if (port === null || req.headers.host !== `127.0.0.1:${port}`) return this.refuse(res, 421, 'This address serves 127.0.0.1 only.');
    if (req.headers.origin !== undefined) return this.refuse(res, 403, 'Requests made by other pages are not served.');

    // The player keeps its place in the query string, so one is allowed and ignored.
    const raw = req.url ?? '';
    const cut = raw.indexOf('?');
    const token = TOKEN_PATH.exec(cut === -1 ? raw : raw.slice(0, cut))?.[1];
    const entry = token === undefined ? undefined : this.entries.get(token);
    if (!entry) return this.refuse(res, 404, 'There is no lesson at this address.');

    const body = await readPlainFile(entry.file, MAX_LESSON_BYTES);
    if (!body) return this.refuse(res, 404, 'This lesson file is no longer there. Publish the lesson again.');
    res.writeHead(200, {
      ...BASE_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': String(body.byteLength),
      'Content-Security-Policy': `${entry.csp}; frame-ancestors 'none'`,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }
}
