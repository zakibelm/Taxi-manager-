import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApiMiddlewares } from './plugin.mjs';
import { createFakeN8n } from './testing/fake-n8n.mjs';
import { clientIP } from './limiter.mjs';

const PASSWORD = 'motdepasse-solide-2026';

async function start() {
 const n8n = createFakeN8n();
 let down = false;
 // Panne simulée de la lecture des comptes : le reste de n8n répond.
 const fetcher = (href, options) => down && href.includes('/accounts/get') ? Promise.reject(new Error('réseau')) : n8n.fetcher(href, options);
 const middlewares = createApiMiddlewares({ ...n8n.env, MAIL_PROVIDER: 'n8n' }, { fetcher });
 const server = createServer((req, res) => { let i = 0; const next = () => { const m = middlewares[i++]; if(!m) { res.statusCode = 404; return res.end(); } m(req, res, next); }; next(); });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const base = `http://127.0.0.1:${server.address().port}`;
 const call = async (path, { method = 'GET', body, cookie } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const set = res.headers.get('set-cookie');
  return { status: res.status, data: await res.json().catch(() => null), cookie: set ? set.split(';')[0] : null };
 };
 const signUp = async email => {
  await call('/api/auth/register', { method: 'POST', body: { email, name: 'Test' } });
  const token = n8n.db.outbox.at(-1).message.match(/\?verify=([A-Za-z0-9_-]+)/)[1];
  await call('/api/auth/verify', { method: 'POST', body: { token, password: PASSWORD } });
  return (await call('/api/auth/login', { method: 'POST', body: { identifier: email, password: PASSWORD } })).cookie;
 };
 return { n8n, call, signUp, setDown: v => { down = v; }, close: () => new Promise(r => server.close(r)) };
}

test('une panne n8n pendant la vérification du compte ne ferme pas la session', async () => {
 const app = await start();
 try {
  const cookie = await app.signUp('panne@example.test');
  assert.equal(app.n8n.db.sessions.length, 1);
  // Premier appel de session : rien en cache local, la lecture du compte part vers n8n, qui est en panne.
  app.setDown(true);
  assert.equal((await app.call('/api/auth/session', { cookie })).data.user, null);
  assert.equal(app.n8n.db.sessions.length, 1, 'session conservée pendant la panne');
  app.setDown(false);
  assert.equal((await app.call('/api/auth/session', { cookie })).data.user.email, 'panne@example.test', 'session de nouveau valide');
 } finally { await app.close(); }
});

test('course avec identifiant client : renvoi sans doublon, identifiant invalide refusé', async () => {
 const app = await start();
 try {
  const cookie = await app.signUp('file@example.test');
  const id = '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f';
  const course = { id, type: 'Régulier', amount: 18, date: '2026-11-04T12:00:00.000Z', description: '' };
  const first = await app.call('/api/services', { method: 'POST', cookie, body: course });
  assert.equal(first.status, 201);
  assert.equal(first.data.service.id, id);
  const again = await app.call('/api/services', { method: 'POST', cookie, body: course });
  assert.equal(again.status, 200);
  assert.equal(app.n8n.db.services.length, 1, 'pas de doublon');
  assert.equal((await app.call('/api/services', { method: 'POST', cookie, body: { ...course, id: 'pas-un-uuid' } })).status, 400);
 } finally { await app.close(); }
});

test('TRUST_PROXY : la dernière adresse de X-Forwarded-For fait foi', () => {
 const req = ip => ({ headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: '172.17.0.2' } });
 assert.equal(clientIP(req('1.2.3.4, 203.0.113.9'), { TRUST_PROXY: '1' }), '203.0.113.9', 'entrée ajoutée par le proxy');
 assert.equal(clientIP(req('203.0.113.9'), { TRUST_PROXY: '1' }), '203.0.113.9');
 assert.equal(clientIP(req('1.2.3.4'), { TRUST_PROXY: '0' }), '172.17.0.2');
});
