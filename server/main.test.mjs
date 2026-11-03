import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHandler } from './main.mjs';
test('production server: static files, SPA fallback, API wiring, headers and path safety', async () => {
 const root = mkdtempSync(join(tmpdir(), 'taximanager-dist-'));
 const dist = join(root, 'dist');
 mkdirSync(join(dist, 'assets'), { recursive: true });
 writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
 writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');
 writeFileSync(join(root, 'secret.txt'), 'TOP-SECRET');
 let linked = true;
 try { symlinkSync(join(root, 'secret.txt'), join(dist, 'assets', 'link.txt')); } catch { linked = false; }
 const server = createServer(createHandler({ NODE_ENV: 'production' }, { distDir: dist, accountFile: undefined }));
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const base = `http://127.0.0.1:${server.address().port}`;
 try {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /id="root"/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.doesNotMatch(home.headers.get('content-security-policy'), /unsafe-inline.*script|script-src[^;]*unsafe-inline/);
  assert.ok(home.headers.get('strict-transport-security'));
  assert.equal(home.headers.get('cache-control'), 'no-cache');
  const asset = await fetch(base + '/assets/app.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  const spa = await fetch(base + '/dashboard/anything');
  assert.equal(spa.status, 200); assert.match(await spa.text(), /id="root"/);
  assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
  assert.equal((await fetch(base + '/api/unknown')).status, 404);
  { const r = await fetch(base + '/api/auth/session'); assert.equal(r.status, 200); assert.equal((await r.json()).user, null); }
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/', { method: 'HEAD' })).status, 200);
  for (const hostile of ['/%2e%2e/secret.txt', '/..%2fsecret.txt', '/%2e%2e%2f%2e%2e%2fsecret.txt', '/assets/..%5c..%5csecret.txt', '/%00', '/admin-auth.local', '/.env', '/.git/config', '/server/auth.mjs']) {
   const response = await fetch(base + hostile);
   const body = await response.text();
   assert.ok(response.status >= 400, hostile + ' -> ' + response.status);
   assert.equal(body.includes('TOP-SECRET'), false, hostile);
  }
  if (linked) { const response = await fetch(base + '/assets/link.txt'); assert.ok(response.status >= 400); assert.equal((await response.text()).includes('TOP-SECRET'), false); }
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'x', password: 'y' }) });
  assert.equal(login.status, 503); // no account file configured: fails closed, never a default account
 } finally { await new Promise(r => server.close(r)); rmSync(root, { recursive: true, force: true }); }
});
