import { readFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Service-worker update across two tabs. The production build in dist/ is served
 * by a small server that can switch to a "new deployment": the same files with a
 * different worker version. Clicking "Reload now" in one tab must move every open
 * tab to the new version, without load errors.
 */
const PORT = 4191;
const BASE = '/ai-quantization-laboratory/';
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

let server: Server;
let version: 'v1' | 'v2' = 'v1';

test.beforeAll(async () => {
  test.skip(!existsSync('dist/sw.js'), 'needs a production build in dist/');
  server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (!p.startsWith(BASE)) return res.writeHead(404).end();
    p = p.slice(BASE.length) || 'index.html';
    const file = join('dist', p);
    if (!existsSync(file)) return res.writeHead(404).end();
    let body: Buffer | string = readFileSync(file);
    if (p === 'sw.js' && version === 'v2') body = body.toString().replace(/const VERSION = "([0-9a-f]+)"/, 'const VERSION = "$1-v2"');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
  });
  await new Promise<void>((r) => server.listen(PORT, r));
});
test.afterAll(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

test('applying an update in one tab reloads every open tab into the new version', async ({ context }) => {
  const url = `http://localhost:${PORT}${BASE}`;
  const errors: string[] = [];
  const open = async () => {
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(url);
    await p.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 30_000 });
    return p;
  };
  const tab1 = await open();
  const tab2 = await open();
  const cacheNames = () => tab1.evaluate(() => caches.keys());
  expect((await cacheNames()).some((k) => k.endsWith('-v2'))).toBe(false);

  version = 'v2';
  await tab1.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
  await expect(tab1.getByTestId('update-ready')).toBeVisible({ timeout: 20_000 });
  await expect(tab2.getByTestId('update-ready')).toBeVisible();

  const reloaded = (p: typeof tab1) => p.waitForEvent('load', { timeout: 20_000 }).then(() => true);
  const both = Promise.all([reloaded(tab1), reloaded(tab2)]);
  await tab1.getByRole('button', { name: 'Reload now' }).click();
  expect(await both).toEqual([true, true]);

  for (const tab of [tab1, tab2]) {
    await expect(tab.getByTestId('update-ready')).toHaveCount(0);
    await tab.getByRole('button', { name: 'About and help' }).click();
    await expect(tab.getByTestId('offline-status')).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    await expect(tab.getByTestId('offline-status')).toContainText('-v2');
    await expect(tab.getByRole('alert')).toHaveCount(0);
  }
  // The new cache plus at most one previous version.
  const names = await cacheNames();
  expect(names.filter((k) => k.endsWith('-v2'))).toHaveLength(1);
  expect(names.length).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});
