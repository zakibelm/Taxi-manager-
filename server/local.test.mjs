import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApiMiddlewares } from './plugin.mjs';
import { createFakeN8n } from './testing/fake-n8n.mjs';
import { createN8nClient } from './providers/n8n.mjs';
import { openLocalDb, createLocalStore, createLocalCompaniesProvider } from './local.mjs';
import { openRideStore } from './sqlite.mjs';
import { migrate } from './migrate-local.mjs';

const PASSWORD = 'motdepasse-solide-2026';
const hex = n => 'a'.repeat(n);

async function start() {
 const n8n = createFakeN8n();
 const file = path.join(mkdtempSync(path.join(tmpdir(), 'tm-local-')), 'tm.db');
 const env = { ...n8n.env, STORAGE: 'local', SQLITE_PATH: file, MAIL_PROVIDER: 'n8n', ADMIN_EMAILS: 'patron@example.test' };
 const middlewares = createApiMiddlewares(env, { fetcher: n8n.fetcher });
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
  const mail = n8n.db.outbox.at(-1);
  const token = mail.message.match(/\?verify=([A-Za-z0-9_-]+)/)[1];
  assert.equal((await call('/api/auth/verify', { method: 'POST', body: { token, password: PASSWORD } })).status, 200);
  const login = await call('/api/auth/login', { method: 'POST', body: { identifier: email, password: PASSWORD } });
  assert.equal(login.status, 200);
  return login;
 };
 return { n8n, call, signUp, close: () => new Promise(r => server.close(r)) };
}

test('mode local : inscription, connexion, courses, assignations et compagnies sans rien écrire dans n8n', async () => {
 const app = await start();
 try {
  const a = await app.signUp('a@example.test', 'A');
  const b = await app.signUp('b@example.test', 'B');
  const boss = await app.signUp('patron@example.test', 'Patron');
  assert.equal(boss.data.user.role, 'admin');
  assert.equal((await app.call('/api/auth/session', { cookie: a.cookie })).data.user.email, 'a@example.test');

  const course = { type: 'Régulier', amount: 42.5, date: '2026-11-03T12:00:00.000Z', description: 'Aéroport' };
  const created = await app.call('/api/services', { method: 'POST', cookie: a.cookie, body: course });
  assert.equal(created.status, 201);
  assert.equal(created.data.service.driver_email, 'a@example.test');
  assert.equal((await app.call('/api/services', { cookie: a.cookie })).data.services.length, 1);
  assert.equal((await app.call('/api/services', { cookie: b.cookie })).data.services.length, 0);
  assert.equal((await app.call('/api/services', { cookie: boss.cookie })).data.services.length, 1);
  assert.equal((await app.call('/api/services/' + created.data.service.id, { method: 'DELETE', cookie: b.cookie })).status, 404);
  // Renvoi hors ligne avec le même identifiant : pas de doublon.
  const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
  assert.equal((await app.call('/api/services', { method: 'POST', cookie: a.cookie, body: { ...course, id } })).status, 201);
  assert.equal((await app.call('/api/services', { method: 'POST', cookie: a.cookie, body: { ...course, id } })).status, 200);
  assert.equal((await app.call('/api/services', { cookie: a.cookie })).data.services.length, 2);
  assert.equal((await app.call('/api/services/' + id, { method: 'DELETE', cookie: a.cookie })).status, 200);

  const plan = { type: 'olymel', date: '2026-11-10T13:30:00.000Z', description: 'Usine' };
  const planned = await app.call('/api/assignments', { method: 'POST', cookie: a.cookie, body: plan });
  assert.equal(planned.status, 201);
  assert.equal((await app.call('/api/assignments', { cookie: b.cookie })).data.assignments.length, 0);
  assert.equal((await app.call('/api/assignments', { cookie: boss.cookie })).data.assignments.length, 1);
  assert.equal((await app.call('/api/assignments/' + planned.data.assignment.id, { method: 'DELETE', cookie: a.cookie })).status, 200);

  const company = await app.call('/api/companies', { method: 'POST', cookie: boss.cookie, body: { name: 'Co-op' } });
  assert.equal(company.status, 201);
  assert.equal((await app.call('/api/companies', { cookie: a.cookie })).data.companies.length, 1);

  assert.equal((await app.call('/api/auth/logout', { method: 'POST', cookie: a.cookie })).status, 200);
  assert.equal((await app.call('/api/auth/session', { cookie: a.cookie })).data.user, null);

  // n8n n'a reçu que l'envoi de courriels : aucune course, assignation, compagnie, session, jeton ni tentative.
  const { db } = app.n8n;
  assert.deepEqual([db.services, db.assignments, db.companies, db.memberships, db.sessions, db.tokens, db.attempts].map(t => t.length), [0, 0, 0, 0, 0, 0, 0]);
  assert.ok(db.accounts.every(x => x.password_hash === '0'.repeat(128)), 'aucun mot de passe haché copié dans n8n');
  assert.equal(db.accounts.length, 3);
 } finally { await app.close(); }
});

test('STORAGE=local sans SQLITE_PATH est refusé au démarrage', () => {
 assert.throws(() => createApiMiddlewares({ STORAGE: 'local' }), /SQLITE_PATH/);
});

test('jetons à usage unique et expirants, sessions expirantes, tentatives limitées', async () => {
 let t = 1_000_000;
 const store = createLocalStore(openLocalDb(':memory:'), { env: { HMAC_SECRET: 'x' }, now: () => t });
 await store.tokens.create({ hash: 'h1', accountId: 'id1', email: 'A@X.test', purpose: 'reset', expires: t + 1000, authVersion: 'v' });
 assert.equal(await store.tokens.consume('h1', 'verify'), null, 'mauvais usage');
 assert.deepEqual(await store.tokens.consume('h1', 'reset'), { accountId: 'id1', email: 'a@x.test', purpose: 'reset', authVersion: 'v' });
 assert.equal(await store.tokens.consume('h1', 'reset'), null, 'une seule fois');
 await store.tokens.create({ hash: 'h2', accountId: 'id1', email: 'a@x.test', purpose: 'reset', expires: t + 1000, authVersion: 'v' });
 t += 2000;
 assert.equal(await store.tokens.consume('h2', 'reset'), null, 'expiré');

 await store.sessions.create(hex(64), { id: 'id1', email: 'a@x.test' }, t + 500, 'v');
 assert.equal((await store.sessions.get(hex(64))).authVersion, 'v');
 t += 600;
 assert.equal(await store.sessions.get(hex(64)), null);

 for(let i = 0; i < 4; i++) await store.attempts.record('1.1.1.1', 'a@x.test', false);
 assert.equal(await store.attempts.retryAfter('1.1.1.1', 'a@x.test'), 0);
 await store.attempts.record('1.1.1.1', 'a@x.test', false);
 assert.equal(await store.attempts.retryAfter('1.1.1.1', 'a@x.test'), 30);
 assert.equal(await store.attempts.retryAfter('2.2.2.2', 'a@x.test'), 0, 'par couple IP + compte');
 t += 16 * 60 * 1000;
 assert.equal(await store.attempts.retryAfter('1.1.1.1', 'a@x.test'), 0, 'fenêtre de 15 minutes');
});

test('comptes : confirmés d’abord, ambigu = null, changement de mot de passe', async () => {
 const store = createLocalStore(openLocalDb(':memory:'), { env: {} });
 const base = { salt: hex(48), passwordHash: hex(128), role: 'chauffeur', authVersion: hex(64) };
 await store.accounts.create({ ...base, id: 'i1', email: 'Z@X.test', name: 'Z' });
 await store.accounts.create({ ...base, id: 'i2', email: 'z@x.test', name: 'Z2' });   // doublon d'adresse ignoré
 assert.equal((await store.accounts.get('z@x.test')).id, 'i1');
 assert.equal((await store.accounts.get('z@x.test')).verified, false);
 await store.accounts.verify('i1');
 await store.accounts.setPassword('i1', { salt: hex(48), passwordHash: 'b'.repeat(128), authVersion: 'c'.repeat(64) });
 const acc = await store.accounts.get('Z@X.TEST');
 assert.deepEqual([acc.verified, acc.passwordHash[0], acc.authVersion[0]], [true, 'b', 'c']);
 assert.equal(await store.accounts.get('inconnu@x.test'), null);
});

test('compagnies : booléens conservés, adhésion remplacée par chauffeur', async () => {
 const p = createLocalCompaniesProvider(openLocalDb(':memory:'));
 await p.saveCompany({ company_id: 'c1', name: 'Co-op', active: true, created_at: 'd' });
 await p.saveCompany({ company_id: 'c1', name: 'Co-op', active: false, created_at: 'autre' });
 assert.deepEqual(await p.companies(), [{ company_id: 'c1', name: 'Co-op', active: false, created_at: 'd', created_by: '' }]);
 await p.saveMembership({ driver_email: 'a@x.test', company_id: 'c1', status: 'pending', share: true, requested_at: 'r', decided_at: '' });
 await p.saveMembership({ driver_email: 'a@x.test', company_id: 'c1', status: 'approved', share: true, requested_at: 'r', decided_at: 'd' });
 assert.deepEqual(await p.memberships(), [{ driver_email: 'a@x.test', company_id: 'c1', status: 'approved', share: true, requested_at: 'r', decided_at: 'd' }]);
});

test('migration n8n → SQLite : simulation sans écriture, copie complète, relançable sans doublon', async () => {
 const n8n = createFakeN8n();
 const d = n8n.db;
 d.accounts.push({ account_id: 'i1', username: 'a@x.test', email: 'a@x.test', display_name: 'A', salt: hex(48), password_hash: hex(128), role: 'chauffeur', verified: true, auth_version: hex(64), last_mail_at: 0 },
  { account_id: 'i2', username: 'patron@x.test', email: 'patron@x.test', display_name: 'P', salt: hex(48), password_hash: hex(128), role: 'admin', verified: true, auth_version: hex(64), last_mail_at: 0 },
  { account_id: 'i3', username: 'sans@x.test', email: 'sans@x.test', display_name: 'S', salt: hex(48), password_hash: hex(128), role: 'chauffeur', verified: false, auth_version: hex(64), last_mail_at: 0 });
 d.services.push({ service_id: 's1', driver_email: 'a@x.test', type: 'Taxi', amount: 25, date: '2026-11-06T10:00:00Z', description: '', created_at: 'c', updated_at: 'u' });
 d.assignments.push({ assignment_id: 'p1', driver_email: 'a@x.test', type: 'Taxi', date: '2026-11-10T10:00:00Z', description: 'x', created_at: 'c' });
 d.companies.push({ company_id: 'c1', name: 'Co-op', active: true, created_at: 'c' });
 d.memberships.push({ driver_email: 'a@x.test', company_id: 'c1', status: 'approved', share: true, requested_at: 'r', decided_at: 'd' });
 const client = createN8nClient(n8n.env, n8n.fetcher);
 const db = openLocalDb(':memory:'), rideStore = openRideStore(':memory:');
 const env = { ADMIN_EMAILS: 'patron@x.test' };
 const dry = await migrate({ client, env, db, rideStore, dryRun: true });
 assert.deepEqual([dry.rides, dry.assignments, dry.companies, dry.memberships, dry.accounts], [1, 1, 1, 1, 2]);
 assert.equal(rideStore.count(), 0);
 const writes = d.calls.filter(c => c.method !== 'GET' && !c.url.includes('/accounts/get')).length;
 assert.equal(writes, 0, 'aucune écriture dans n8n');
 await migrate({ client, env, db, rideStore, extraEmails: ['sans@x.test', 'inconnu@x.test'] });
 await migrate({ client, env, db, rideStore, extraEmails: ['sans@x.test'] });
 const count = t => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
 assert.deepEqual(['accounts', 'assignments', 'companies', 'memberships'].map(count), [3, 1, 1, 1]);
 assert.equal(rideStore.count(), 1);
 const store = createLocalStore(db, { client, env: n8n.env });
 const acc = await store.accounts.get('a@x.test');
 assert.deepEqual([acc.id, acc.verified, acc.passwordHash], ['i1', true, hex(128)]);
 assert.equal((await store.accounts.get('sans@x.test')).verified, false);
 // Compte migré : le courriel part sans recréer le compte dans n8n.
 await store.accounts.mail('i1', 'Sujet', 'Message');
 assert.equal(d.calls.filter(c => c.url.endsWith('/accounts/create')).length, 0);
 assert.equal(d.outbox.length, 1);
});
