/**
 * Vite plugin that emits `sw.js`: a precaching service worker for offline use.
 *
 * Every emitted file (except source maps) and every file in `public/` is
 * listed in the worker together with a content hash of the whole build, so a
 * new deployment produces a new worker, a new cache and an update prompt.
 * Paths are relative to the worker's scope, so the same build works under any
 * base path (e.g. GitHub Pages' /<repository>/).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

function listFiles(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(listFiles(p));
    else out.push(p);
  }
  return out;
}

const WORKER_SOURCE = String.raw`
const CACHE = 'aql-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('aql-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'skip-waiting') self.skipWaiting();
  if (data.type === 'status' && event.ports[0]) {
    // Reports how many precached files are actually present in the cache.
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        let cached = 0;
        for (const a of ASSETS) if (await cache.match(a)) cached++;
        event.ports[0].postMessage({ version: VERSION, cached, total: ASSETS.length });
      })(),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Navigations inside the app are answered with the cached app shell.
      // Entries are matched by URL only: module scripts are CORS requests with
      // an Origin header, which must not defeat a "Vary: Origin" response.
      const nav = req.mode === 'navigate';
      const hit = await cache.match(nav ? 'index.html' : url.href, { ignoreSearch: nav, ignoreVary: true });
      if (hit) return hit;
      return fetch(req);
    })(),
  );
});
`;

export function serviceWorker(publicDir = 'public'): Plugin {
  return {
    name: 'aql-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      const assets = new Set<string>();
      for (const [fileName, item] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        if (fileName.endsWith('.map')) continue;
        assets.add(fileName);
        hash.update(fileName);
        hash.update(item.type === 'chunk' ? item.code : item.source);
      }
      for (const file of listFiles(publicDir).sort()) {
        const rel = relative(publicDir, file).split(sep).join('/');
        assets.add(rel);
        hash.update(rel);
        hash.update(readFileSync(file));
      }
      assets.add('index.html');
      const version = hash.digest('hex').slice(0, 12);
      const list = [...assets].sort();
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `// Generated at build time. Precaches ${list.length} files for offline use.\nconst VERSION = ${JSON.stringify(version)};\nconst ASSETS = ${JSON.stringify(list, null, 1)};\n${WORKER_SOURCE}`,
      });
    },
  };
}
