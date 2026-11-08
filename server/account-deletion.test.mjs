import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApiMiddlewares } from './plugin.mjs';
import { createFakeN8n } from './testing/fake-n8n.mjs';

const PASSWORD = 'motdepasse-solide-2026';

async function start(mode) {
 const n8n = createFakeN8n();
 const file = path.join(mkdtempSync(path.join(tmpdir(), 'tm-del-')), 'tm.db');
 const env = { ...n8n.env, SQLITE_PATH: file, MAIL_PROVIDER: 'n8n', ADMIN_EMAILS: 'patron@example.test', ...(mode === 'local' ? { STORAGE: 'local' } : {}) };
 const flags = { failErase: false };
 const fetcher = (href, options) => flags.failErase && href.includes('account/erase') ? Promise.reject(new Error('panne')) : n8n.fetcher(href, options);
 const middlewares = createApiMiddlewares(env, { fetcher });
 const server = createServer((req, res) => {
  let i = 0; const next = () => { const m = middlewares[i++]; if(!m) { res.statusCode = 404; return res.end(); } m(req, res, next); }; next();
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const base = `http://127.0.0.1:${server.address().port}`;
 const call = async (p, { method = 'GET', body, cookie } = {}) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const set = res.headers.get('set-cookie');
  return { status: res.status, data: await res.json().catch(() => null), cookie: set ? set.split(';')[0] : null };
 };
 const signUp = async (email, name) => {
  assert.equal((await call('/api/auth/register', { method: 'POST', body: { email, name } })).status, 202);
  const token = n8n.db.outbox.at(-1).message.match(/\?verify=([A-Za-z0-9_-]+)/)[1];
  assert.equal((await call('/api/auth/verify', { method: 'POST', body: { token, password: PASSWORD } })).status, 200);
  const login = await call('/api/auth/login', { method: 'POST', body: { identifier: email, password: PASSWORD } });
  assert.equal(login.status, 200);
  return login;
 };
 const sql = query => { const db = new DatabaseSync(file); try { return db.prepare(query).all(); } finally { db.close(); } };
 return { n8n, flags, call, signUp, sql, close: () => new Promise(r => server.close(r)) };
}

const course = { type: 'Régulier', amount: 42.5, date: '2026-11-03T12:00:00.000Z', description: 'Aéroport' };
const del = (app, identifier, password = PASSWORD, extra = {}) => app.call('/api/account/delete', { method: 'POST', body: { identifier, password, confirm: true, ...extra } });

for(const mode of ['local', 'n8n']) {
 test(`suppression de compte (${mode}) : efface compte, courses, assignations, adhésion et sessions, sans toucher aux autres`, async () => {
  const app = await start(mode);
  try {
   const a = await app.signUp('a@example.test', 'A');
   const b = await app.signUp('b@example.test', 'B');
   for(const who of [a, b]) {
    assert.equal((await app.call('/api/services', { method: 'POST', cookie: who.cookie, body: course })).status, 201);
   }
   const me = (await app.call('/api/auth/session', { cookie: a.cookie })).data.user;
   assert.equal((await app.call('/api/assignments', { method: 'POST', cookie: a.cookie, body: { type: 'olymel', date: '2026-11-10T13:30:00.000Z', description: 'Usine' } })).status, 201);

   // Mauvais mot de passe et confirmation absente : rien n'est effacé.
   assert.equal((await del(app, 'b@example.test', 'mauvais-mot-de-passe')).status, 401);
   assert.equal((await del(app, 'a@example.test', PASSWORD, { confirm: false })).status, 400);
   assert.equal((await app.call('/api/services', { cookie: a.cookie })).data.services.length, 1);

   const res = await del(app, ' A@Example.test ');
   assert.equal(res.status, 200);
   assert.match(res.cookie || '', /^taxi_session=;?$/);

   // Plus de session, plus de connexion possible.
   assert.equal((await app.call('/api/auth/session', { cookie: a.cookie })).data.user, null);
   assert.equal((await app.call('/api/auth/login', { method: 'POST', body: { identifier: 'a@example.test', password: PASSWORD } })).status, 401);
   assert.equal((await del(app, 'a@example.test')).status, 401);

   // Aucune trace côté n8n pour ce compte.
   assert.equal(app.n8n.db.accounts.some(x => x.account_id === me.id), false);
   assert.equal(app.n8n.db.services.some(x => x.driver_email === 'a@example.test'), false);
   assert.equal(app.n8n.db.assignments.some(x => x.driver_email === 'a@example.test'), false);
   assert.equal(app.n8n.db.tokens.some(x => x.account_id === me.id), false);
   // Ni dans SQLite.
   assert.equal(app.sql(`SELECT * FROM rides WHERE driver_email = 'a@example.test'`).length, 0);
   if(mode === 'local') {
    assert.equal(app.sql(`SELECT * FROM accounts WHERE email = 'a@example.test'`).length, 0);
    assert.equal(app.sql(`SELECT * FROM tokens WHERE account_id = '${me.id}'`).length, 0);
    assert.equal(app.sql(`SELECT * FROM assignments WHERE driver_email = 'a@example.test'`).length, 0);
   }

   // L'autre chauffeur est intact.
   assert.equal((await app.call('/api/services', { cookie: b.cookie })).data.services.length, 1);
   assert.equal((await app.call('/api/auth/session', { cookie: b.cookie })).data.user.email, 'b@example.test');
  } finally { await app.close(); }
 });
}

test('suppression de compte : les administrateurs sont refusés, GET refusé, corps invalide refusé', async () => {
 const app = await start('local');
 try {
  const boss = await app.signUp('patron@example.test', 'Patron');
  assert.equal(boss.data.user.role, 'admin');
  assert.equal((await del(app, 'patron@example.test')).status, 403);
  assert.equal((await app.call('/api/auth/session', { cookie: boss.cookie })).data.user.email, 'patron@example.test');
  assert.equal((await app.call('/api/account/delete')).status, 405);
  assert.equal((await app.call('/api/account/delete', { method: 'POST', body: { identifier: 'a@example.test', password: PASSWORD, confirm: true, extra: 1 } })).status, 400);
 } finally { await app.close(); }
});

test('suppression de compte (local) : si n8n échoue, le compte reste et la demande peut être répétée', async () => {
 const app = await start('local');
 try {
  const a = await app.signUp('a@example.test', 'A');
  assert.equal(app.sql(`SELECT n8n_synced FROM accounts WHERE email = 'a@example.test'`)[0].n8n_synced, 1);
  app.flags.failErase = true;
  assert.equal((await del(app, 'a@example.test')).status, 502);
  assert.equal(app.sql(`SELECT * FROM accounts WHERE email = 'a@example.test'`).length, 1);
  assert.equal((await app.call('/api/auth/session', { cookie: a.cookie })).data.user.email, 'a@example.test');
  app.flags.failErase = false;
  assert.equal((await del(app, 'a@example.test')).status, 200);
  assert.equal(app.sql(`SELECT * FROM accounts WHERE email = 'a@example.test'`).length, 0);
 } finally { await app.close(); }
});
