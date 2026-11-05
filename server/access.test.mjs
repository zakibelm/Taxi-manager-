import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApiMiddlewares } from './plugin.mjs';
import { createFakeN8n } from './testing/fake-n8n.mjs';
import { createAccessPolicy } from './access.mjs';
import { configWarnings } from './main.mjs';

const PASSWORD = 'motdepasse-solide-2026';

async function start(extraEnv = {}) {
 const n8n = createFakeN8n();
 const env = { ...n8n.env, MAIL_PROVIDER: 'n8n', ADMIN_EMAILS: 'patron@example.test', ...extraEnv };
 const middlewares = createApiMiddlewares(env, { fetcher: n8n.fetcher });
 const server = createServer((req, res) => {
  let i = 0; const next = () => { const m = middlewares[i++]; if(!m) { res.statusCode = 404; return res.end(); } m(req, res, next); }; next();
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const base = `http://127.0.0.1:${server.address().port}`;
 const call = async (path, { method = 'GET', body, cookie } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const set = res.headers.get('set-cookie');
  return { status: res.status, data: await res.json().catch(() => null), cookie: set ? set.split(';')[0] : null };
 };
 const lastLink = kind => n8n.db.outbox.at(-1)?.message.match(new RegExp(`\\?${kind}=([A-Za-z0-9_-]+)`))?.[1];
 return { n8n, call, lastLink, close: () => new Promise(r => server.close(r)) };
}

test('politique d’accès : courriels, domaines, admins, liste vide = ouvert', () => {
 const open = createAccessPolicy({});
 assert.equal(open.restricted, false);
 assert.equal(open.allowed('qui@importe.test'), true);
 const policy = createAccessPolicy({ ALLOWED_EMAILS: 'Ali@Example.test, @flotte.ca', ADMIN_EMAILS: 'patron@example.test' });
 assert.equal(policy.restricted, true);
 assert.equal(policy.allowed('ali@example.test'), true);
 assert.equal(policy.allowed(' ALI@example.test '), true);
 assert.equal(policy.allowed('bob@flotte.ca'), true);
 assert.equal(policy.allowed('patron@example.test'), true, 'un admin est toujours autorisé');
 assert.equal(policy.allowed('eve@example.test'), false);
 assert.equal(policy.allowed('eve@sousdomaine.flotte.ca'), false, 'domaine exact seulement');
 assert.equal(policy.allowed('eve@flotte.ca.pirate.test'), false);
});

test('ALLOWED_EMAILS : une adresse non autorisée reçoit la même réponse, sans compte ni courriel', async () => {
 const app = await start({ ALLOWED_EMAILS: 'ali@example.test' });
 try {
  const refused = await app.call('/api/auth/register', { method: 'POST', body: { email: 'eve@example.test', name: 'Eve' } });
  const accepted = await app.call('/api/auth/register', { method: 'POST', body: { email: 'ali@example.test', name: 'Ali' } });
  assert.equal(refused.status, 202);
  assert.deepEqual(refused.data, accepted.data, 'réponse publique identique');
  assert.deepEqual(app.n8n.db.accounts.map(a => a.email), ['ali@example.test']);
  assert.equal(app.n8n.db.outbox.length, 1);
 } finally { await app.close(); }
});

test('ALLOWED_EMAILS : retirer une adresse refuse la connexion et ferme les sessions ouvertes', async () => {
 const allowed = await start({ ALLOWED_EMAILS: 'ali@example.test' });
 try {
  await allowed.call('/api/auth/register', { method: 'POST', body: { email: 'ali@example.test', name: 'Ali' } });
  assert.equal((await allowed.call('/api/auth/verify', { method: 'POST', body: { token: allowed.lastLink('verify'), password: PASSWORD } })).status, 200);
  const login = await allowed.call('/api/auth/login', { method: 'POST', body: { identifier: 'ali@example.test', password: PASSWORD } });
  assert.equal(login.status, 200);
  assert.equal((await allowed.call('/api/services', { cookie: login.cookie })).status, 200);

  // Redémarrage du serveur avec une liste qui ne contient plus Ali, mêmes tables n8n.
  const db = allowed.n8n.db;
  await allowed.close();
  const revoked = await start({ ALLOWED_EMAILS: 'quelquun@example.test' });
  for(const key of Object.keys(db)) revoked.n8n.db[key] = db[key];
  try {
   assert.equal((await revoked.call('/api/services', { cookie: login.cookie })).status, 401, 'session existante refusée');
   assert.equal(revoked.n8n.db.sessions.length, 0, 'session supprimée dans n8n');
   const again = await revoked.call('/api/auth/login', { method: 'POST', body: { identifier: 'ali@example.test', password: PASSWORD } });
   assert.equal(again.status, 403);
   assert.equal(again.cookie, null);
  } finally { await revoked.close(); }
 } catch(e) { await allowed.close().catch(() => {}); throw e; }
});

test('/api/health : 200 si n8n est configuré, 503 sinon, sans session ni appel à n8n', async () => {
 const app = await start();
 try {
  const ok = await app.call('/api/health');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data, { status: 'ok' });
  assert.equal(app.n8n.db.calls.length, 0);
  assert.equal((await app.call('/api/health', { method: 'POST', body: {} })).status, 405);
 } finally { await app.close(); }
 const bare = await start({ N8N_URL: '' });
 try { assert.equal((await bare.call('/api/health')).status, 503); } finally { await bare.close(); }
});

test('avertissements de configuration en production', () => {
 const n8n = createFakeN8n();
 const complete = { ...n8n.env, NODE_ENV: 'production', PUBLIC_URL: 'https://taxi.example.test', HMAC_SECRET: 'x', ADMIN_EMAILS: 'a@b.test',
  OPENROUTER_API_KEY: 'k', MAIL_PROVIDER: 'n8n', ALLOWED_EMAILS: '@flotte.ca' };
 assert.deepEqual(configWarnings(complete), []);
 const warnings = configWarnings({ NODE_ENV: 'production', PUBLIC_URL: 'http://taxi.example.test', MAIL_PROVIDER: 'log' }).join('\n');
 for(const word of ['N8N_URL', 'https://', 'HMAC_SECRET', 'ADMIN_EMAILS', 'OPENROUTER_API_KEY', 'MAIL_PROVIDER=log', 'ALLOWED_EMAILS'])
  assert.ok(warnings.includes(word), word);
});
