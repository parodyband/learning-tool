// The local link. It serves published lessons to this machine and nothing else to anyone, so most of
// this file is about what it refuses.
import { readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LessonListener, LISTENER_TIMEOUTS, type ListenerTimeouts } from '../../src/server/listener';
import { plantPlan, startWorld, written, type World } from './helpers/kit';

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** One request with full control of the method, the path as sent, and the headers (Host included). */
function request(port: number, options: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path, headers: options.headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

/** Bytes straight onto the socket, for requests an HTTP client would not send. Returns the status line. */
function raw(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(text));
    let data = '';
    socket.on('data', (c) => (data += c.toString('latin1')));
    socket.on('close', () => resolve(data.split('\r\n')[0] ?? ''));
    socket.on('error', reject);
    setTimeout(() => socket.destroy(), 1500);
  });
}

const refused = (port: number, host: string): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host, timeout: 500 });
    socket.on('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(true));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(true);
    });
  });

const HARDENING = {
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

describe('the listener behind publish_lesson', () => {
  let w: World;
  let url: URL;
  let port: number;
  let file: string;
  let lessonId: string;

  beforeEach(async () => {
    w = await startWorld();
    lessonId = await written(w);
    // Writing a whole lesson opened no port: the listener starts with the first publish.
    expect(w.deps.listener.port).toBeNull();
    const published = await w.call('publish_lesson', { lessonId });
    url = new URL(published.local.url);
    port = Number(url.port);
    file = published.file.path;
  });
  afterEach(async () => {
    await w.close();
  });

  it('gives a link on 127.0.0.1 with a 128-bit token, on a port that is not the default in tests', () => {
    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.pathname).toMatch(/^\/l\/[0-9a-f]{32}\/$/);
    expect(port).toBe(w.deps.listener.port);
    expect(port).not.toBe(47821);
  });

  it('serves the published file, byte for byte, with exactly the headers the contract lists', async () => {
    const res = await request(port, { path: url.pathname });
    expect(res.status).toBe(200);
    const onDisk = await readFile(file);
    expect(Buffer.from(res.body, 'utf8').equals(onDisk)).toBe(true);
    expect(res.headers).toMatchObject({ ...HARDENING, 'content-type': 'text/html; charset=utf-8', 'content-length': String(onDisk.byteLength) });
    // The same policy as the file's own meta element, plus the one directive a meta element cannot carry.
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(res.body)![1]!;
    expect(res.headers['content-security-policy']).toBe(`${meta}; frame-ancestors 'none'`);
    expect(meta).toMatch(/^default-src 'none'; script-src 'sha256-/);
    expect(Object.keys(res.headers).sort()).toEqual(
      ['cache-control', 'connection', 'content-length', 'content-security-policy', 'content-type', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'date', 'referrer-policy', 'x-content-type-options'].sort(),
    );
  });

  it('answers HEAD with the headers and no body', async () => {
    const res = await request(port, { method: 'HEAD', path: url.pathname });
    expect(res.status).toBe(200);
    expect(res.body).toBe('');
    expect(res.headers['content-length']).toBe(String((await readFile(file)).byteLength));
  });

  it('ignores a query string, which the player uses to keep its place', async () => {
    expect((await request(port, { path: `${url.pathname}?scene=s3` })).status).toBe(200);
  });

  it('works with fetch, as a browser would ask', async () => {
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Binary search');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('refuses %s with 405', async (method) => {
    const res = await request(port, { method, path: url.pathname, body: method === 'OPTIONS' ? undefined : '{}' });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, HEAD');
    expect(res.headers).toMatchObject(HARDENING);
    expect(res.body).not.toContain('<html');
  });

  it.each([
    ['localhost', (p: number) => `localhost:${p}`],
    ['another name pointed at this machine (DNS rebinding)', (p: number) => `attacker.example:${p}`],
    ['the address without the port', () => '127.0.0.1'],
    ['the address with another port', (p: number) => `127.0.0.1:${p + 1}`],
    ['the IPv6 loopback', (p: number) => `[::1]:${p}`],
    ['0.0.0.0', (p: number) => `0.0.0.0:${p}`],
    ['the right host with a trailing dot', (p: number) => `127.0.0.1:${p}.`],
    ['the right host twice', (p: number) => `127.0.0.1:${p}, 127.0.0.1:${p}`],
  ])('refuses a request whose Host is %s with 421', async (_name, host) => {
    const res = await request(port, { path: url.pathname, headers: { Host: host(port) } });
    expect(res.status).toBe(421);
    expect(res.headers).toMatchObject(HARDENING);
    expect(res.body).not.toContain('<html');
  });

  it('refuses a request with no Host at all', async () => {
    expect(await raw(port, `GET ${url.pathname} HTTP/1.0\r\n\r\n`)).toMatch(/^HTTP\/1\.1 421 /);
  });

  it.each(['https://evil.example', 'null', 'http://localhost:3000', 'file://'])('refuses a request that carries Origin: %s with 403', async (origin) => {
    const res = await request(port, { path: url.pathname, headers: { Origin: origin } });
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('<html');
  });

  it('refuses even its own origin in an Origin header: no page has a reason to fetch a lesson', async () => {
    expect((await request(port, { path: url.pathname, headers: { Origin: url.origin } })).status).toBe(403);
  });

  it.each([
    ['the root', () => '/'],
    ['the folder of lessons', () => '/l/'],
    ['the token without the closing slash', (t: string) => `/l/${t}`],
    ['something below a token', (t: string) => `/l/${t}/index.html`],
    ['the token in upper case', (t: string) => `/l/${t.toUpperCase()}/`],
    ['a token that is one character off', (t: string) => `/l/${t.slice(0, 31)}${t.endsWith('0') ? '1' : '0'}/`],
    ['a token of the wrong length', (t: string) => `/l/${t.slice(0, 30)}/`],
    ['a doubled slash', (t: string) => `//l/${t}/`],
    ['an encoded slash', (t: string) => `/l%2F${t}/`],
    ['the lesson file by name', () => '/lessons/'],
    ['the draft folder', () => '/.state/drafts/'],
    ['an MCP endpoint', () => '/mcp'],
    ['a favicon', () => '/favicon.ico'],
  ])('answers 404 for %s', async (_name, make) => {
    const token = url.pathname.split('/')[2]!;
    const res = await request(port, { path: make(token) });
    expect(res.status).toBe(404);
    expect(res.headers).toMatchObject(HARDENING);
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(res.body).not.toContain('<html');
    // Nothing that looks like a listing or names a file.
    expect(res.body).not.toMatch(/\.html|\.json|lessons|drafts/);
  });

  it('answers 404 for traversal below a token and for an absolute-form request, sent raw', async () => {
    const token = url.pathname.split('/')[2]!;
    const host = `Host: 127.0.0.1:${port}\r\n`;
    expect(await raw(port, `GET /l/${token}/../../.state/drafts/ HTTP/1.1\r\n${host}Connection: close\r\n\r\n`)).toMatch(/ 404 /);
    expect(await raw(port, `GET /l/${token}/..%2f..%2f HTTP/1.1\r\n${host}Connection: close\r\n\r\n`)).toMatch(/ 404 /);
    expect(await raw(port, `GET http://127.0.0.1:${port}${url.pathname} HTTP/1.1\r\n${host}Connection: close\r\n\r\n`)).toMatch(/ 404 /);
  });

  it('never sends a CORS header, whatever is asked', async () => {
    const answers = await Promise.all([
      request(port, { path: url.pathname }),
      request(port, { path: url.pathname, headers: { Origin: 'https://evil.example' } }),
      request(port, { method: 'OPTIONS', path: url.pathname, headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } }),
      request(port, { path: '/' }),
    ]);
    for (const res of answers) expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });

  it('does not mount the MCP transport: a JSON-RPC request gets nothing', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    for (const p of ['/', '/mcp', url.pathname]) {
      const res = await request(port, { method: 'POST', path: p, headers: { 'Content-Type': 'application/json' }, body });
      expect(res.status).toBe(405);
      expect(res.body).not.toContain('jsonrpc');
    }
  });

  it('listens on 127.0.0.1 only: other addresses of this machine refuse the connection', async () => {
    expect(await refused(port, '::1')).toBe(true);
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
    if (lan) expect(await refused(port, lan)).toBe(true);
    expect(await refused(port, '127.0.0.1')).toBe(false);
  });

  it('serves the republished page at the same address', async () => {
    const before = await request(port, { path: url.pathname });
    // The title of a lesson in the older kinds is changed in its draft: plan_lesson no longer takes such a plan.
    await plantPlan(w.home, lessonId, { ...(await import('../../src/core/examples')).EXAMPLE_PLAN, title: 'Binary search, second edition' });
    const again = await w.call('publish_lesson', { lessonId });
    expect(again.local.url).toBe(url.href);
    const after = await request(port, { path: url.pathname });
    expect(after.body).toContain('Binary search, second edition');
    expect(after.body).not.toBe(before.body);
  });

  it('gives each lesson its own token', async () => {
    const other = await written(w, { ...(await import('./helpers/kit')).EXAMPLE_PARTS, start: { ...(await import('../../src/core/examples')).EXAMPLE_START, topic: 'Binary search, again' } });
    const second = await w.call('publish_lesson', { lessonId: other });
    expect(second.local.url).not.toBe(url.href);
    expect(new URL(second.local.url).port).toBe(url.port);
    expect((await fetch(second.local.url)).status).toBe(200);
    expect((await fetch(url)).status).toBe(200);
  });

  it('answers 404 once the file is gone, and does not follow a link put in its place', async () => {
    const moved = path.join(w.home, 'moved.html');
    await rename(file, moved);
    expect((await request(port, { path: url.pathname })).status).toBe(404);
    if (process.platform !== 'win32') {
      const secret = path.join(w.home, 'secret.txt');
      await writeFile(secret, 'not a lesson');
      await symlink(secret, file);
      const res = await request(port, { path: url.pathname });
      expect(res.status).toBe(404);
      expect(res.body).not.toContain('not a lesson');
      await unlink(file);
    }
    await rename(moved, file);
    expect((await request(port, { path: url.pathname })).status).toBe(200);
  });

  it('closes when the MCP connection closes', async () => {
    expect((await fetch(url)).status).toBe(200);
    await w.client.close();
    // onclose runs on the server side of the pair; give it a turn of the event loop.
    await new Promise((r) => setTimeout(r, 50));
    expect(w.deps.listener.port).toBeNull();
    expect(await refused(port, '127.0.0.1')).toBe(true);
  });
});

describe('LessonListener on its own', () => {
  const made: LessonListener[] = [];
  const blockers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(made.splice(0).map((l) => l.close()));
    await Promise.all(blockers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });
  const listener = (port: number, log: string[] = [], timeouts?: Partial<ListenerTimeouts>): LessonListener => {
    const l = new LessonListener({ port, log: (line) => log.push(line), timeouts });
    made.push(l);
    return l;
  };
  const tempFile = async (content: string): Promise<string> => {
    const file = path.join(os.tmpdir(), `lt-listener-${process.pid}-${Math.random().toString(36).slice(2)}.html`);
    await writeFile(file, content);
    return file;
  };

  it('does not listen until something is served, and can be closed without ever starting', async () => {
    const l = listener(0);
    expect(l.port).toBeNull();
    expect(l.urlFor('abc123def456')).toBeNull();
    await l.close();
    expect(l.port).toBeNull();
  });

  it('uses the preferred port when it is free', async () => {
    // Find a free port, release it, and ask for it.
    const probe = http.createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const free = (probe.address() as net.AddressInfo).port;
    await new Promise((r) => probe.close(r));
    const l = listener(free);
    const file = await tempFile('<p>one</p>');
    const url = await l.serve('abc123def456', file, "default-src 'none'");
    expect(new URL(url!).port).toBe(String(free));
    await unlink(file);
  });

  it('falls back to another port when the preferred one is taken', async () => {
    const blocker = http.createServer((_req, res) => res.end('someone else'));
    blockers.push(blocker);
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const taken = (blocker.address() as net.AddressInfo).port;
    const log: string[] = [];
    const l = listener(taken, log);
    const file = await tempFile('<p>two</p>');
    const url = await l.serve('abc123def456', file, "default-src 'none'");
    expect(url).not.toBeNull();
    expect(l.port).not.toBe(taken);
    expect((await fetch(url!)).status).toBe(200);
    // The other server on the taken port is undisturbed.
    expect(await (await fetch(`http://127.0.0.1:${taken}/`)).text()).toBe('someone else');
    expect(log.join('\n')).toMatch(/serving published lessons on http:\/\/127\.0\.0\.1:\d+\//);
    await unlink(file);
  });

  it('several publishes at once start one listener', async () => {
    const l = listener(0);
    const file = await tempFile('<p>three</p>');
    const urls = await Promise.all(['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc'].map((key) => l.serve(key, file, "default-src 'none'")));
    expect(new Set(urls.map((u) => new URL(u!).port)).size).toBe(1);
    expect(new Set(urls).size).toBe(3);
    await unlink(file);
  });

  it('keeps a lesson\'s token and its port across a close and a reopen, so the link a learner has survives a reconnect', async () => {
    // Asked for "any free port", it used to come back on a different one, and the link already given was dead.
    const l = listener(0);
    const file = await tempFile('<p>four</p>');
    const first = new URL((await l.serve('abc123def456', file, "default-src 'none'"))!);
    await l.close();
    expect(l.urlFor('abc123def456')).toBeNull();
    const second = new URL((await l.serve('abc123def456', file, "default-src 'none'"))!);
    expect(second.href).toBe(first.href);
    expect((await fetch(second)).status).toBe(200);
    await unlink(file);
  });

  it('serving a lesson again, any number of times, returns the one link', async () => {
    const l = listener(0);
    const file = await tempFile('<p>again</p>');
    const urls = new Set<string | null>();
    for (let i = 0; i < 5; i++) urls.add(await l.serve('abc123def456', file, "default-src 'none'"));
    expect(urls.size).toBe(1);
    expect(l.urlFor('abc123def456')).toBe([...urls][0]);
    await unlink(file);
  });

  it('comes back on another port when the one it had has been taken meanwhile', async () => {
    const l = listener(0);
    const file = await tempFile('<p>moved</p>');
    const first = new URL((await l.serve('abc123def456', file, "default-src 'none'"))!);
    await l.close();
    const blocker = http.createServer((_req, res) => res.end('someone else'));
    blockers.push(blocker);
    await new Promise<void>((r) => blocker.listen(Number(first.port), '127.0.0.1', r));
    const second = new URL((await l.serve('abc123def456', file, "default-src 'none'"))!);
    expect(second.port).not.toBe(first.port);
    expect(second.pathname).toBe(first.pathname);
    expect((await fetch(second)).status).toBe(200);
    await unlink(file);
  });

  describe('a connection that stalls', () => {
    // Node applies its header and request timeouts only when it sweeps its connections, every 30
    // seconds unless told otherwise. The listener asked for 5 seconds and got 30: a socket that sent
    // nothing was held for half a minute, and 64 of them shut the lesson out for as long.
    const FAST = { headersMs: 250, requestMs: 500, sweepMs: 50 };

    /** Open a connection, write `send` if given, and resolve with how long the server kept it and what it said. */
    const held = (port: number, send: string | null): Promise<{ ms: number; said: string }> =>
      new Promise((resolve) => {
        const from = performance.now();
        let said = '';
        const socket = net.connect(port, '127.0.0.1', () => {
          if (send !== null) socket.write(send);
        });
        socket.on('data', (c) => (said += c.toString('latin1')));
        socket.on('error', () => undefined);
        socket.on('close', () => resolve({ ms: performance.now() - from, said: said.split('\r\n')[0] ?? '' }));
      });

    it('the limits are seconds, and the sweep that applies them runs every second', () => {
      expect(LISTENER_TIMEOUTS).toEqual({ headersMs: 5_000, requestMs: 10_000, keepAliveMs: 1_000, sweepMs: 1_000 });
    });

    it('is dropped once its limit has passed, whether it sent nothing or never finished its headers', async () => {
      const l = listener(0, [], FAST);
      const file = await tempFile('<p>slow</p>');
      const url = new URL((await l.serve('abc123def456', file, "default-src 'none'"))!);
      const port = Number(url.port);
      const [silent, unfinished] = await Promise.all([held(port, null), held(port, `GET ${url.pathname} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nX-Slow: `)]);
      for (const connection of [silent, unfinished]) {
        expect(connection.ms).toBeGreaterThanOrEqual(FAST.headersMs - 20);
        // The limit plus a sweep or two, nowhere near the 30 seconds it used to be.
        expect(connection.ms).toBeLessThan(2000);
        // Dropped, not answered: a stalled connection is owed nothing.
        expect(connection.said).toBe('');
      }
      // An ordinary request is not affected.
      expect((await fetch(url)).status).toBe(200);
      await unlink(file);
    }, 10_000);

    it('64 silent connections hold the lesson back for the limit, not for half a minute', async () => {
      const l = listener(0, [], FAST);
      const file = await tempFile('<p>crowded</p>');
      const url = new URL((await l.serve('abc123def456', file, "default-src 'none'"))!);
      const idle = Array.from({ length: 64 }, () => held(Number(url.port), null));
      const from = performance.now();
      let status = 0;
      while (status !== 200 && performance.now() - from < 5000) {
        status = await fetch(url).then(
          (r) => r.status,
          () => 0,
        );
        if (status !== 200) await new Promise((r) => setTimeout(r, 25));
      }
      expect(status).toBe(200);
      expect(performance.now() - from).toBeLessThan(2500);
      await Promise.all(idle);
      await unlink(file);
    }, 15_000);
  });

  it('tokens are unpredictable: a thousand of them do not repeat', async () => {
    const l = listener(0);
    const file = await tempFile('<p>five</p>');
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) tokens.add(new URL((await l.serve(`key${i}`, file, "default-src 'none'"))!).pathname);
    expect(tokens.size).toBe(1000);
    await unlink(file);
  });
});
