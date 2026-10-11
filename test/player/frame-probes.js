// Hostile "agent code" for the custom frame's worker. Every probe tries one escape and returns a
// short verdict string. Ported from the sandbox research (.scratch/v2-sandbox/tests/probes-worker.js).
// Verdict words: ABSENT (the API does not exist here), BLOCKED (exists, refused), and anything in
// capitals starting with ESCAPED means the attempt worked. The canary listener is the final judge
// for network probes. CANARY_PORT is replaced by the spec. S.__report is the test hook the spec
// adds to the worker (frame-escape.spec.ts); a real frame has no way to send anything but a bitmap.
const C = 'http://127.0.0.1:CANARY_PORT';
const g = (name) => { try { return (0, eval)('typeof ' + name) !== 'undefined'; } catch (e) { try { return typeof globalThis[name] !== 'undefined'; } catch (e2) { return false; } } };
const has = (name) => typeof globalThis[name] !== 'undefined';
const settle = (p, ms) => Promise.race([p, new Promise((r) => { let n = 0; const spin = () => (++n > ms / 4 ? r('timeout') : Promise.resolve().then(() => Promise.resolve()).then(() => (typeof setTimeout === 'function' ? setTimeout(() => r('timeout'), ms) : spin()))); spin(); })]);
const probes = {
  fetch: async () => has('fetch') ? fetch(C + '/w-fetch').then(() => 'ESCAPED', (e) => 'BLOCKED ' + e.name) : 'ABSENT',
  fetch_nocors: async () => has('fetch') ? fetch(C + '/w-fetch-nocors', { mode: 'no-cors', keepalive: true }).then(() => 'ESCAPED', (e) => 'BLOCKED ' + e.name) : 'ABSENT',
  xhr: async () => { if (!has('XMLHttpRequest')) return 'ABSENT'; return new Promise((res) => { const x = new XMLHttpRequest(); x.onload = () => res('ESCAPED'); x.onerror = () => res('BLOCKED error'); try { x.open('GET', C + '/w-xhr'); x.send(); } catch (e) { res('BLOCKED ' + e.name); } }); },
  websocket: async () => { if (!has('WebSocket')) return 'ABSENT'; return new Promise((res) => { try { const w = new WebSocket('ws://127.0.0.1:CANARY_PORT/w-ws'); w.onopen = () => res('ESCAPED'); w.onerror = () => res('BLOCKED error'); } catch (e) { res('BLOCKED ' + e.name); } }); },
  eventsource: async () => { if (!has('EventSource')) return 'ABSENT'; return new Promise((res) => { try { const s = new EventSource(C + '/w-es'); s.onopen = () => res('ESCAPED'); s.onerror = () => res('BLOCKED error'); } catch (e) { res('BLOCKED ' + e.name); } }); },
  sendBeacon: async () => { if (!has('navigator') || !navigator.sendBeacon) return 'ABSENT'; return navigator.sendBeacon(C + '/w-beacon', 'x') ? 'queued (see canary)' : 'BLOCKED false'; },
  importScripts: async () => { if (!has('importScripts')) return 'ABSENT'; try { importScripts(C + '/w-import.js'); return 'ESCAPED'; } catch (e) { return 'BLOCKED ' + e.name; } },
  importScripts_data: async () => { if (!has('importScripts')) return 'ABSENT'; try { importScripts('data:text/javascript,self.__x=1'); return 'RAN'; } catch (e) { return 'BLOCKED ' + e.name; } },
  dynamic_import_http: async () => import(C + '/w-dynimport.js').then(() => 'ESCAPED', (e) => 'BLOCKED ' + e.name),
  dynamic_import_data: async () => import('data:text/javascript,export default 1').then(() => 'RAN', (e) => 'BLOCKED ' + e.name),
  eval: async () => { try { return (0, eval)('1+1') === 2 ? 'ESCAPED ran' : '?'; } catch (e) { return 'BLOCKED ' + e.name; } },
  Function: async () => { try { return new Function('return 3')() === 3 ? 'ESCAPED ran' : '?'; } catch (e) { return 'BLOCKED ' + e.name; } },
  Function_via_constructor: async () => { try { return (() => {}).constructor.constructor('return this')() ? 'ESCAPED ran' : '?'; } catch (e) { return 'BLOCKED ' + e.name; } },
  AsyncFunction: async () => { try { const AF = (async () => {}).constructor; await new AF('return 1')(); return 'ESCAPED ran'; } catch (e) { return 'BLOCKED ' + e.name; } },
  setTimeout_string: async () => { if (!has('setTimeout')) return 'ABSENT'; globalThis.__st = 0; try { setTimeout('globalThis.__st=1', 0); } catch (e) { return 'BLOCKED ' + e.name; } await new Promise((r) => setTimeout(r, 60)); return globalThis.__st ? 'ESCAPED ran' : 'BLOCKED silently'; },
  worker_http: async () => { if (!has('Worker')) return 'ABSENT'; return new Promise((res) => { try { const w = new Worker(C + '/w-worker.js'); w.onerror = () => res('BLOCKED error'); w.onmessage = () => res('ESCAPED'); } catch (e) { res('BLOCKED ' + e.name); } }); },
  worker_data_nested: async () => { if (!has('Worker')) return 'ABSENT'; return settle(new Promise((res) => { try { const w = new Worker('data:text/javascript,postMessage(1)'); w.onerror = () => res('BLOCKED error'); w.onmessage = () => res('RAN (nested worker allowed)'); } catch (e) { res('BLOCKED ' + e.name); } }), 800); },
  sharedworker: async () => { if (!has('SharedWorker')) return 'ABSENT'; try { new SharedWorker('data:text/javascript,1'); return 'created'; } catch (e) { return 'BLOCKED ' + e.name; } },
  serviceworker: async () => { if (!has('navigator') || !navigator.serviceWorker) return 'ABSENT'; return navigator.serviceWorker.register ? navigator.serviceWorker.register(C + '/sw.js').then(() => 'ESCAPED', (e) => 'BLOCKED ' + e.name) : 'ABSENT register'; },
  webrtc: async () => has('RTCPeerConnection') || has('webkitRTCPeerConnection') ? 'PRESENT' : 'ABSENT',
  rtc_datachannel: async () => has('RTCDataChannel') ? 'interface only' : 'ABSENT',
  webtransport: async () => { if (!has('WebTransport')) return 'ABSENT'; try { const w = new WebTransport('https://127.0.0.1:CANARY_PORT/wt'); return await settle(w.ready.then(() => 'ESCAPED', (e) => 'BLOCKED ' + e.name), 1200); } catch (e) { return 'BLOCKED ' + e.name; } },
  websocketstream: async () => { if (!has('WebSocketStream')) return 'ABSENT'; try { const w = new WebSocketStream('ws://127.0.0.1:CANARY_PORT/wss'); return await settle(w.opened.then(() => 'ESCAPED', (e) => 'BLOCKED ' + e.name), 1200); } catch (e) { return 'BLOCKED ' + e.name; } },
  fontface_url: async () => { if (!has('FontFace')) return 'ABSENT'; try { const f = new FontFace('ltx', 'url(' + C + '/w-font.woff2)'); return await settle(f.load().then(() => 'ESCAPED', (e) => 'BLOCKED ' + e.name), 1200); } catch (e) { return 'BLOCKED ' + e.name; } },
  canvas_filter_url: async () => { try { const c = new OffscreenCanvas(8, 8), x = c.getContext('2d'); x.filter = 'url(' + C + '/w-filter.svg#f)'; x.fillRect(0, 0, 8, 8); return 'drawn (see canary)'; } catch (e) { return 'BLOCKED ' + e.name; } },
  canvas_font_url: async () => { try { const c = new OffscreenCanvas(8, 8), x = c.getContext('2d'); x.font = '12px "ltx-remote"'; x.fillText('a', 0, 8); return 'drawn (see canary)'; } catch (e) { return 'BLOCKED ' + e.name; } },
  webgl: async () => { try { const c = new OffscreenCanvas(8, 8); return c.getContext('webgl') ? 'AVAILABLE' : 'BLOCKED null'; } catch (e) { return 'BLOCKED ' + e.name; } },
  webgpu: async () => (has('navigator') && navigator.gpu ? 'AVAILABLE' : 'ABSENT'),
  localStorage: async () => { try { return has('localStorage') ? 'PRESENT' : 'ABSENT'; } catch (e) { return 'BLOCKED ' + e.name; } },
  sessionStorage: async () => { try { return has('sessionStorage') ? 'PRESENT' : 'ABSENT'; } catch (e) { return 'BLOCKED ' + e.name; } },
  indexedDB: async () => { try { if (!has('indexedDB')) return 'ABSENT'; return await new Promise((res) => { const q = indexedDB.open('lt-probe'); q.onsuccess = () => res('ESCAPED opened'); q.onerror = () => res('BLOCKED ' + (q.error && q.error.name)); }); } catch (e) { return 'BLOCKED ' + e.name; } },
  caches: async () => { try { if (!has('caches')) return 'ABSENT'; const c = await caches.open('lt-probe'); const key = 'https://lt-cache.invalid/marker'; const before = await c.match(key).then((r) => (r ? r.text() : null)); await c.put(key, new Response('written-by-frame')); return 'OPENED previous=' + before; } catch (e) { return 'BLOCKED ' + e.name; } },
  opfs: async () => { try { if (!has('navigator') || !navigator.storage || !navigator.storage.getDirectory) return 'ABSENT'; const d = await navigator.storage.getDirectory(); return 'ESCAPED opened ' + d.kind; } catch (e) { return 'BLOCKED ' + e.name; } },
  cookieStore: async () => (has('cookieStore') ? 'PRESENT' : 'ABSENT'),
  document: async () => (has('document') ? 'PRESENT' : 'ABSENT'),
  window_parent_top: async () => ['window', 'parent', 'top', 'opener', 'frames'].filter(has).join(',') || 'ABSENT',
  broadcastchannel: async () => { if (!has('BroadcastChannel')) return 'ABSENT'; try { new BroadcastChannel('lt-probe').postMessage('from-frame'); return 'posted (host listens)'; } catch (e) { return 'BLOCKED ' + e.name; } },
  locks: async () => (has('navigator') && navigator.locks ? 'PRESENT' : 'ABSENT'),
  clipboard: async () => (has('navigator') && navigator.clipboard ? 'PRESENT' : 'ABSENT'),
  location_assign: async () => { if (!has('location')) return 'ABSENT'; const before = String(location.href).slice(0, 20); try { location.href = C + '/w-nav'; } catch (e) {} try { self.location = C + '/w-nav2'; } catch (e) {} return String(location.href).slice(0, 20) === before ? 'BLOCKED unchanged' : 'CHANGED'; },
  open_alert_focus: async () => ['open', 'alert', 'confirm', 'prompt', 'focus', 'print'].filter(has).join(',') || 'ABSENT',
  fullscreen_pointerlock: async () => (has('Element') || has('document') ? 'PRESENT' : 'ABSENT'),
  audio: async () => ['AudioContext', 'webkitAudioContext', 'Audio', 'speechSynthesis', 'OfflineAudioContext', 'AudioWorklet'].filter(has).join(',') || 'ABSENT',
  notification: async () => { if (!has('Notification')) return 'ABSENT'; try { new Notification('lt'); return 'constructed permission=' + Notification.permission; } catch (e) { return 'BLOCKED ' + e.name; } },
  devices: async () => (has('navigator') ? ['usb', 'hid', 'serial', 'bluetooth', 'mediaDevices', 'geolocation'].filter((k) => k in navigator).join(',') || 'none' : 'ABSENT'),
  this_global: async () => { const t = (function () { return this; })(); return t === undefined ? 'undefined (strict)' : 'GLOBAL'; },
  timers: async () => ['setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask', 'performance', 'Atomics', 'SharedArrayBuffer', 'postMessage', 'close', 'addEventListener', 'onmessage', 'MessageChannel', 'console', 'crypto', 'navigator', 'self', 'URL', 'Blob'].filter(has).join(',') || 'none',
  globals_left: async () => { const names = []; for (let o = globalThis; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const n of Object.getOwnPropertyNames(o)) { try { if (o[n] !== undefined || n === 'undefined') names.push(n); } catch (e) { names.push(n); } } return names.sort().join(' '); },
};
const results = {};
(async () => {
  for (const name of Object.keys(probes)) {
    try {
      const p = probes[name](); const v = await settle(p, 2500);
      if (v === 'timeout') p.then((late) => S.__report({ late: { [name]: String(late) } }), (e) => S.__report({ late: { [name]: 'THREW ' + (e && e.name) } }));
      results[name] = String(v).slice(0, name === 'globals_left' ? 4000 : 160);
    } catch (e) { results[name] = (e && e.name === 'ReferenceError' ? 'ABSENT ' : 'THREW ') + (e && e.name); }
  }
  S.__report({ done: true, results });
})();
function render(ctx, t) { S.clear('#000000'); }
