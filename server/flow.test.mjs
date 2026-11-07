import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApiMiddlewares } from './plugin.mjs';
import { createFakeN8n } from './testing/fake-n8n.mjs';

const PASSWORD = 'motdepasse-solide-2026';
const backoff = () => new Promise(r => setTimeout(r, 1100)); // délai imposé après un échec (1 s)

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
 const lastLink = kind => { const mail = n8n.db.outbox.at(-1); return mail?.message.match(new RegExp(`\\?${kind}=([A-Za-z0-9_-]+)`))?.[1]; };
 return { n8n, call, lastLink, close: () => new Promise(r => server.close(r)) };
}

/** Inscription complète : courriel, lien, choix du mot de passe, connexion. */
async function signUp(app, email, name) {
 assert.equal((await app.call('/api/auth/register', { method: 'POST', body: { email, name } })).status, 202);
 const token = app.lastLink('verify');
 assert.ok(token, 'lien de confirmation envoyé');
 assert.equal((await app.call('/api/auth/verify', { method: 'POST', body: { token, password: PASSWORD } })).status, 200);
 const login = await app.call('/api/auth/login', { method: 'POST', body: { identifier: email, password: PASSWORD } });
 assert.equal(login.status, 200);
 return login;
}

test('inscription, confirmation, connexion : tout est écrit dans les tables n8n TM', async () => {
 const app = await start();
 try {
  assert.equal((await app.call('/api/auth/register', { method: 'POST', body: { email: 'Ali@Example.test', name: 'Ali' } })).status, 202);
  const row = app.n8n.db.accounts[0];
  assert.equal(row.email, 'ali@example.test');
  assert.equal(row.verified, false);
  assert.equal(row.role, 'chauffeur');
  // Avant confirmation : impossible de se connecter, même avec un mot de passe deviné.
  assert.equal((await app.call('/api/auth/login', { method: 'POST', body: { identifier: 'ali@example.test', password: PASSWORD } })).status, 401);
  await backoff();
  const token = app.lastLink('verify');
  assert.equal(app.n8n.db.tokens[0].token_hash.length, 64);
  assert.notEqual(app.n8n.db.tokens[0].token_hash, token, 'le jeton est stocké haché');
  assert.equal((await app.call('/api/auth/verify', { method: 'POST', body: { token, password: 'court' } })).status, 400);
  assert.equal((await app.call('/api/auth/verify', { method: 'POST', body: { token, password: PASSWORD } })).status, 200);
  assert.equal(app.n8n.db.accounts[0].verified, true);
  assert.equal((await app.call('/api/auth/verify', { method: 'POST', body: { token, password: PASSWORD } })).status, 400, 'lien à usage unique');
  const login = await app.call('/api/auth/login', { method: 'POST', body: { identifier: 'ali@example.test', password: PASSWORD } });
  assert.equal(login.status, 200);
  assert.deepEqual(Object.keys(login.data.user).sort(), ['email', 'id', 'name', 'role']);
  assert.equal(app.n8n.db.sessions.length, 1);
  const [, sessionId] = login.cookie.split('=');
  assert.notEqual(app.n8n.db.sessions[0].session_hash, sessionId, 'la session est stockée hachée');
  assert.equal((await app.call('/api/auth/session', { cookie: login.cookie })).data.user.email, 'ali@example.test');
  // Chaque appel vers n8n porte l'en-tête secret et le préfixe TM.
  assert.ok(app.n8n.db.calls.every(c => c.url.includes('/webhook/taximanager-tm/api/') && c.headers['X-DrivePilot-Token'] === 'test-n8n-token'));
  assert.ok(app.n8n.db.attempts.every(a => /^[a-f0-9]{64}$/.test(a.ip_hash) && /^[a-f0-9]{64}$/.test(a.account_hash)), 'IP et identifiants jamais en clair');
  // Déconnexion : la session disparaît de n8n.
  assert.equal((await app.call('/api/auth/logout', { method: 'POST', cookie: login.cookie })).status, 200);
  assert.equal(app.n8n.db.sessions.length, 0);
  assert.equal((await app.call('/api/auth/session', { cookie: login.cookie })).data.user, null);
 } finally { await app.close(); }
});

test('réponses identiques, compte existant prévenu, admin par ADMIN_EMAILS', async () => {
 const app = await start();
 try {
  const first = await app.call('/api/auth/register', { method: 'POST', body: { email: 'patron@example.test', name: 'Patron' } });
  assert.equal(app.n8n.db.accounts[0].role, 'admin');
  const token = app.lastLink('verify');
  await app.call('/api/auth/verify', { method: 'POST', body: { token, password: PASSWORD } });
  app.n8n.db.accounts[0].last_mail_at = 0; // lève la limite n8n d'un courriel / 5 min
  const again = await app.call('/api/auth/register', { method: 'POST', body: { email: 'patron@example.test', name: 'Intrus' } });
  assert.deepEqual(again.data, first.data);
  assert.equal(app.n8n.db.accounts.length, 1);
  assert.match(app.n8n.db.outbox.at(-1).subject, /déjà un compte/);
  const unknown = await app.call('/api/auth/forgot', { method: 'POST', body: { email: 'personne@example.test' } });
  assert.deepEqual(unknown.data, first.data);
  const login = await app.call('/api/auth/login', { method: 'POST', body: { identifier: 'patron@example.test', password: PASSWORD } });
  assert.equal(login.data.user.role, 'admin');
 } finally { await app.close(); }
});

test('mot de passe oublié : nouveau mot de passe, anciennes sessions et anciens liens invalidés', async () => {
 const app = await start();
 try {
  const login = await signUp(app, 'sam@example.test', 'Sam');
  app.n8n.db.accounts[0].last_mail_at = 0;
  await app.call('/api/auth/forgot', { method: 'POST', body: { email: 'sam@example.test' } });
  const reset = app.lastLink('reset');
  assert.ok(reset);
  assert.equal((await app.call('/api/auth/reset', { method: 'POST', body: { token: reset, password: 'nouveau-mot-de-passe-2026' } })).status, 200);
  assert.equal((await app.call('/api/auth/session', { cookie: login.cookie })).data.user, null, 'session fermée après changement');
  assert.equal((await app.call('/api/auth/login', { method: 'POST', body: { identifier: 'sam@example.test', password: PASSWORD } })).status, 401);
  await backoff();
  assert.equal((await app.call('/api/auth/login', { method: 'POST', body: { identifier: 'sam@example.test', password: 'nouveau-mot-de-passe-2026' } })).status, 200);
  assert.equal((await app.call('/api/auth/reset', { method: 'POST', body: { token: reset, password: 'encore-un-autre-2026' } })).status, 400);
 } finally { await app.close(); }
});

test('courses : propriétaire imposé par le serveur, isolation entre chauffeurs, admin voit tout', async () => {
 const app = await start();
 try {
  const a = await signUp(app, 'a@example.test', 'A');
  const b = await signUp(app, 'b@example.test', 'B');
  const boss = await signUp(app, 'patron@example.test', 'Patron');
  const course = { type: 'Régulier', amount: 42.5, date: '2026-11-03T12:00:00.000Z', description: 'Aéroport' };
  assert.equal((await app.call('/api/services', { method: 'POST', body: course })).status, 401);
  assert.equal((await app.call('/api/services', { method: 'POST', cookie: a.cookie, body: { ...course, driver_email: 'b@example.test' } })).status, 400);
  assert.equal((await app.call('/api/services', { method: 'POST', cookie: a.cookie, body: { ...course, type: 'Autre' } })).status, 400, '« Autre » n’est pas un type');
  assert.equal((await app.call('/api/services', { method: 'POST', cookie: a.cookie, body: { ...course, type: '<script>' } })).status, 400);
  const created = await app.call('/api/services', { method: 'POST', cookie: a.cookie, body: course });
  assert.equal(created.status, 201);
  assert.equal(app.n8n.db.services[0].driver_email, 'a@example.test');
  assert.match(app.n8n.db.services[0].service_id, /^[a-f0-9-]{36}$/);
  assert.equal((await app.call('/api/services', { cookie: a.cookie })).data.services.length, 1);
  assert.equal((await app.call('/api/services', { cookie: b.cookie })).data.services.length, 0);
  assert.equal((await app.call('/api/services', { cookie: boss.cookie })).data.services.length, 1);
  const id = created.data.service.id;
  assert.equal((await app.call('/api/services/' + id, { method: 'DELETE', cookie: b.cookie })).status, 404);
  assert.equal((await app.call('/api/services/' + id, { method: 'DELETE', cookie: a.cookie })).status, 200);
  assert.equal(app.n8n.db.services.length, 0);
  const types = await app.call('/api/service-types', { cookie: a.cookie });
  assert.ok(types.data.types.some(t => t.name === 'Régulier'));
  assert.equal((await app.call('/api/service-types', { method: 'POST', cookie: boss.cookie, body: { name: 'X' } })).status, 405);
  // Nouveau type via « Autre » : enregistré avec la course, puis proposé au chauffeur (et à l'admin), pas aux autres.
  const custom = await app.call('/api/services', { method: 'POST', cookie: a.cookie, body: { ...course, type: 'Hôpital Pierre-Le Gardeur' } });
  assert.equal(custom.status, 201);
  const has = async (who, name) => (await app.call('/api/service-types', { cookie: who.cookie })).data.types.some(t => t.name === name);
  assert.ok(await has(a, 'Hôpital Pierre-Le Gardeur'));
  assert.ok(await has(boss, 'Hôpital Pierre-Le Gardeur'));
  assert.ok(!(await has(b, 'Hôpital Pierre-Le Gardeur')));
  // Casse différente d'un type existant : ramené à la forme connue, pas de doublon.
  const olymel = await app.call('/api/services', { method: 'POST', cookie: a.cookie, body: { ...course, type: 'olymel' } });
  assert.equal(olymel.data.service.type, 'Olymel');
 } finally { await app.close(); }
});

test('assignations planifiées : sans montant, isolées par chauffeur, admin voit tout', async () => {
 const app = await start();
 try {
  const a = await signUp(app, 'a@example.test', 'A');
  const b = await signUp(app, 'b@example.test', 'B');
  const boss = await signUp(app, 'patron@example.test', 'Patron');
  const plan = { type: 'olymel', date: '2026-11-10T13:30:00.000Z', description: 'Usine, quai 3' };
  assert.equal((await app.call('/api/assignments', { method: 'POST', body: plan })).status, 401);
  assert.equal((await app.call('/api/assignments', { method: 'POST', cookie: a.cookie, body: { ...plan, amount: 20 } })).status, 400, 'pas de montant');
  assert.equal((await app.call('/api/assignments', { method: 'POST', cookie: a.cookie, body: { ...plan, type: 'Autre' } })).status, 400);
  const created = await app.call('/api/assignments', { method: 'POST', cookie: a.cookie, body: plan });
  assert.equal(created.status, 201);
  assert.equal(created.data.assignment.type, 'Olymel');
  assert.equal(app.n8n.db.assignments[0].driver_email, 'a@example.test');
  assert.equal((await app.call('/api/assignments', { cookie: a.cookie })).data.assignments.length, 1);
  assert.equal((await app.call('/api/assignments', { cookie: b.cookie })).data.assignments.length, 0);
  assert.equal((await app.call('/api/assignments', { cookie: boss.cookie })).data.assignments.length, 1);
  const id = created.data.assignment.id;
  assert.equal((await app.call('/api/assignments/' + id, { method: 'DELETE', cookie: b.cookie })).status, 404);
  assert.equal((await app.call('/api/assignments/' + id, { method: 'DELETE', cookie: a.cookie })).status, 200);
  assert.equal(app.n8n.db.assignments.length, 0);
 } finally { await app.close(); }
});

test('tentatives limitées par n8n, et n8n absent = 503 sans repli local', async () => {
 const app = await start();
 try {
  await signUp(app, 'c@example.test', 'C');
  let last;
  for(let i = 0; i < 7; i++) last = await app.call('/api/auth/login', { method: 'POST', body: { identifier: 'c@example.test', password: 'mauvais-mot-de-passe' } });
  assert.equal(last.status, 429);
 } finally { await app.close(); }
 const bare = createApiMiddlewares({});
 const server = createServer((req, res) => { let i = 0; const next = () => bare[i++](req, res, next); next(); });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'x@example.test', password: 'y' }) });
  assert.equal(res.status, 503);
  assert.equal((await (await fetch(base + '/api/auth/session')).json()).user, null);
 } finally { await new Promise(r => server.close(r)); }
});
