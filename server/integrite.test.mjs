import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApiMiddlewares } from './plugin.mjs';
import { createFakeN8n } from './testing/fake-n8n.mjs';
import { createN8nClient, createCompaniesProvider, createServicesProvider } from './providers/n8n.mjs';
import { createCompanyService } from './companies.mjs';
import { openRideStore } from './sqlite.mjs';

// Rejeu des scénarios de l'audit (e0a8201) sur le vrai serveur : propriétaire immuable, compagnies, suppression de compte.
const PASSWORD = 'motdepasse-solide-2026';
const course = { type: 'Régulier', amount: 42.5, date: '2026-11-03T12:00:00.000Z', description: 'Aéroport' };
const assignment = { type: 'olymel', date: '2026-11-10T13:30:00.000Z', description: 'Usine' };

/** mode : 'local' (STORAGE=local), 'miroir' (n8n + copie SQLite) ou 'n8n' (n8n seul, sans SQLite). */
async function start(mode) {
 const n8n = createFakeN8n();
 const file = path.join(mkdtempSync(path.join(tmpdir(), 'tm-int-')), 'tm.db');
 const env = { ...n8n.env, MAIL_PROVIDER: 'n8n', ADMIN_EMAILS: 'patron@example.test',
  ...(mode === 'local' ? { STORAGE: 'local', SQLITE_PATH: file } : mode === 'miroir' ? { SQLITE_PATH: file } : {}) };
 const flags = { failErase: false, hold: null };
 // `hold` suspend l'appel d'effacement chez n8n : le test peut alors créer une course « pendant » la suppression.
 const fetcher = async (href, options) => {
  if(href.includes('account/erase')) {
   if(flags.failErase) throw new Error('panne');
   if(flags.hold) { flags.hold.reached(); await flags.hold.released; }
  }
  return n8n.fetcher(href, options);
 };
 const middlewares = createApiMiddlewares(env, { fetcher });
 const server = createServer((req, res) => {
  let i = 0; const next = () => { const m = middlewares[i++]; if(!m) { res.statusCode = 404; return res.end(); } m(req, res, next); }; next();
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const base = `http://127.0.0.1:${server.address().port}`;
 const call = async (p, { method = 'GET', body, cookie } = {}) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] || null };
 };
 const signUp = async (email, name) => {
  assert.equal((await call('/api/auth/register', { method: 'POST', body: { email, name } })).status, 202);
  const token = n8n.db.outbox.at(-1).message.match(/\?verify=([A-Za-z0-9_-]+)/)[1];
  assert.equal((await call('/api/auth/verify', { method: 'POST', body: { token, password: PASSWORD } })).status, 200);
  const login = await call('/api/auth/login', { method: 'POST', body: { identifier: email, password: PASSWORD } });
  assert.equal(login.status, 200);
  return login;
 };
 const sql = query => { const db = new DatabaseSync(file); try { return db.prepare(query).all().map(r => ({ ...r })); } finally { db.close(); } };
 const del = (identifier, password = PASSWORD) => call('/api/account/delete', { method: 'POST', body: { identifier, password, confirm: true } });
 return { n8n, flags, call, signUp, sql, del, close: () => new Promise(r => server.close(r)) };
}

// ───────── 1. Propriétaire immuable ─────────

for(const mode of ['local', 'miroir', 'n8n']) {
 test(`propriétaire immuable (${mode}) : B ne peut pas écraser la course ni l’assignation de A`, async () => {
  const app = await start(mode);
  try {
   const a = await app.signUp('a@example.test', 'A');
   const b = await app.signUp('b@example.test', 'B');
   const ride = await app.call('/api/services', { method: 'POST', cookie: a.cookie, body: course });
   assert.equal(ride.status, 201);
   const rideId = ride.data.service.id;
   const plan = await app.call('/api/assignments', { method: 'POST', cookie: a.cookie, body: assignment });
   assert.equal(plan.status, 201);
   const planId = plan.data.assignment.id;

   // B rejoue les identifiants de A avec ses propres valeurs.
   const stolenRide = await app.call('/api/services', { method: 'POST', cookie: b.cookie, body: { ...course, id: rideId, amount: 1, description: 'pris' } });
   assert.equal(stolenRide.status, 409);
   assert.match(stolenRide.data.error, /déjà utilisé/);
   const stolenPlan = await app.call('/api/assignments', { method: 'POST', cookie: b.cookie, body: { ...assignment, id: planId, description: 'pris' } });
   assert.equal(stolenPlan.status, 409);

   // Rien n'a changé : A voit toujours les siennes, B ne voit rien.
   const aRides = (await app.call('/api/services', { cookie: a.cookie })).data.services;
   assert.equal(aRides.length, 1); assert.equal(aRides[0].amount, 42.5); assert.equal(aRides[0].driver_email, 'a@example.test');
   assert.equal((await app.call('/api/services', { cookie: b.cookie })).data.services.length, 0);
   const aPlans = (await app.call('/api/assignments', { cookie: a.cookie })).data.assignments;
   assert.equal(aPlans.length, 1); assert.equal(aPlans[0].description, 'Usine'); assert.equal(aPlans[0].driver_email, 'a@example.test');
   assert.equal((await app.call('/api/assignments', { cookie: b.cookie })).data.assignments.length, 0);
   if(mode !== 'n8n') assert.deepEqual(app.sql(`SELECT driver_email, amount FROM rides WHERE service_id = '${rideId}'`), [{ driver_email: 'a@example.test', amount: 42.5 }]);
   if(mode !== 'local') {
    assert.equal(app.n8n.db.services.filter(x => (x.service_id ?? x.id) === rideId).length, 1);
    assert.equal(app.n8n.db.services.find(x => (x.service_id ?? x.id) === rideId).driver_email, 'a@example.test');
    assert.equal(app.n8n.db.assignments.find(x => (x.assignment_id ?? x.id) === planId).driver_email, 'a@example.test');
   }

   // A renvoie les siennes (file hors ligne) : 200, sans doublon.
   const again = await app.call('/api/services', { method: 'POST', cookie: a.cookie, body: { ...course, id: rideId } });
   assert.equal(again.status, 200); assert.equal(again.data.service.id, rideId);
   const againPlan = await app.call('/api/assignments', { method: 'POST', cookie: a.cookie, body: { ...assignment, id: planId } });
   assert.equal(againPlan.status, 200); assert.equal(againPlan.data.assignment.id, planId);
   assert.equal((await app.call('/api/services', { cookie: a.cookie })).data.services.length, 1);
   assert.equal((await app.call('/api/assignments', { cookie: a.cookie })).data.assignments.length, 1);
  } finally { await app.close(); }
 });
}

test('SQLite : un UPSERT ne change jamais le propriétaire d’une course', () => {
 const store = openRideStore(':memory:');
 const ride = { service_id: 's1', driver_email: 'a@x.test', type: 'T', amount: 10, date: '2026-11-03T12:00:00.000Z' };
 assert.equal(store.upsert(ride), true);
 assert.equal(store.upsert({ ...ride, amount: 11 }), true);                       // même propriétaire : mise à jour
 assert.equal(store.upsert({ ...ride, driver_email: 'b@x.test', amount: 99 }), false); // autre propriétaire : refusé
 assert.deepEqual([store.get('s1').driver_email, store.get('s1').amount], ['a@x.test', 11]);
 assert.equal(store.count(), 1);
 store.close();
});

// ───────── 2. Compagnies ─────────

test('compagnies (local) : une seule création par saisie libre, rattachement libre, doublons impossibles', async () => {
 const app = await start('local');
 try {
  const a = await app.signUp('a@example.test', 'A');
  const b = await app.signUp('b@example.test', 'B');
  const boss = await app.signUp('patron@example.test', 'Patron');
  const put = (who, companyName) => app.call('/api/membership', { method: 'PUT', cookie: who.cookie, body: { companyName } });

  // 12 noms successifs depuis un compte : un seul passe, les autres reçoivent 409 avec un message clair.
  const results = [];
  for(let i = 1; i <= 12; i++) results.push(await put(a, `Compagnie ${i}`));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 11);
  assert.match(results[1].data.error, /déjà ajouté une compagnie/);
  assert.equal((await app.call('/api/companies', { cookie: boss.cookie })).data.companies.length, 1);

  // Rattacher à une compagnie existante reste libre (casse, accents et espaces ignorés), même pour qui a déjà créé la sienne.
  assert.equal((await put(b, '  compagnie   1 ')).status, 200);
  assert.equal((await put(a, 'COMPAGNIE 1')).status, 200);
  assert.equal((await app.call('/api/companies', { cookie: boss.cookie })).data.companies.length, 1);
  // L'administrateur n'est pas limité par le quota de saisie libre.
  assert.equal((await put(boss, 'Autre 1')).status, 200);
  assert.equal((await put(boss, 'Autre 2')).status, 200);
  assert.equal((await app.call('/api/companies', { cookie: boss.cookie })).data.companies.length, 3);
 } finally { await app.close(); }
});

test('compagnies : la base refuse un doublon de nom normalisé même hors du verrou', async () => {
 const { openLocalDb, createLocalCompaniesProvider } = await import('./local.mjs');
 const provider = createLocalCompaniesProvider(openLocalDb(':memory:'));
 await provider.saveCompany({ company_id: 'c1', name: 'Taxi Été', active: true });
 await assert.rejects(provider.saveCompany({ company_id: 'c2', name: ' taxi  ete ', active: true }), /UNIQUE/);
 assert.equal((await provider.companies()).length, 1);
});

test('compagnies (local) : deux demandes simultanées du même nom donnent une seule compagnie', async () => {
 const app = await start('local');
 try {
  const users = [];
  for(const n of [1, 2, 3, 4]) users.push(await app.signUp(`d${n}@example.test`, `D${n}`));
  const boss = await app.signUp('patron@example.test', 'Patron');
  const rs = await Promise.all(users.map((u, i) => app.call('/api/membership', { method: 'PUT', cookie: u.cookie, body: { companyName: i % 2 ? 'Taxi ÉTÉ' : 'taxi ete' } })));
  assert.deepEqual(rs.map(r => r.status), [200, 200, 200, 200]);
  assert.equal(new Set(rs.map(r => r.data.membership.companyId)).size, 1);
  assert.equal((await app.call('/api/companies', { cookie: boss.cookie })).data.companies.length, 1);
  assert.equal(app.sql('SELECT * FROM companies').length, 1);
 } finally { await app.close(); }
});

test('compagnies (n8n) : deux demandes simultanées du même nom, une seule compagnie (verrou en mémoire)', async () => {
 const n8n = createFakeN8n();
 const client = createN8nClient(n8n.env, n8n.fetcher);
 const service = createCompanyService({ provider: createCompaniesProvider(client), services: createServicesProvider(client) });
 const users = [1, 2, 3].map(n => ({ role: 'chauffeur', email: `d${n}@example.test` }));
 const ms = await Promise.all(users.map(u => service.updateMembership(u, { companyName: 'Co-op Terrebonne' })));
 assert.equal(new Set(ms.map(m => m.companyId)).size, 1);
 assert.equal((await service.listCompanies({ role: 'admin', email: 'a@x.test' })).length, 1);
 // Quota aussi sans colonne « créateur » côté n8n.
 await assert.rejects(service.updateMembership(users[0], { companyName: 'Une autre' }), { status: 409 });
});

test('compagnies : désactivée, l’accès aux prévisions, à la carte et à l’assistant est refusé même aux membres approuvés', async () => {
 const n8n = createFakeN8n({ now: () => Date.parse('2026-11-04T15:00:00Z') });
 const client = createN8nClient(n8n.env, n8n.fetcher);
 const service = createCompanyService({ provider: createCompaniesProvider(client), services: createServicesProvider(client), now: () => Date.parse('2026-11-04T15:00:00Z') });
 const c = await service.createCompany('Co-op');
 const me = { role: 'chauffeur', email: 'd1@example.test' };
 await service.updateMembership(me, { companyId: c.id, share: true });
 await service.decide(me.email, true);
 assert.equal((await service.zones(me)).status, 'insufficient');   // actif : accès accordé (pas assez de chauffeurs, mais accès)
 await service.setCompanyActive(c.id, false);
 await assert.rejects(service.zones(me), { status: 403 });          // prévisions et carte (spots)
 await assert.rejects(service.pool(me), { status: 403 });
 assert.equal(await service.digest(me), null);                      // résumé de l'assistant
 await service.setCompanyActive(c.id, true);
 assert.equal((await service.zones(me)).status, 'insufficient');
});

// ───────── 3. Suppression de compte ─────────

test('suppression (n8n seul, sans copie SQLite) : 200 au lieu de 500, tout est effacé dans n8n', async () => {
 const app = await start('n8n');
 try {
  const a = await app.signUp('a@example.test', 'A');
  const b = await app.signUp('b@example.test', 'B');
  for(const who of [a, b]) assert.equal((await app.call('/api/services', { method: 'POST', cookie: who.cookie, body: course })).status, 201);
  assert.equal((await app.del('a@example.test')).status, 200);
  assert.equal(app.n8n.db.services.some(x => x.driver_email === 'a@example.test'), false);
  assert.equal(app.n8n.db.services.some(x => x.driver_email === 'b@example.test'), true);
  assert.equal((await app.call('/api/auth/login', { method: 'POST', body: { identifier: 'a@example.test', password: PASSWORD } })).status, 401);
 } finally { await app.close(); }
});

for(const mode of ['local', 'miroir']) {
 test(`suppression (${mode}) : panne n8n → 502, compte et courses intacts, puis la reprise réussit`, async () => {
  const app = await start(mode);
  try {
   const a = await app.signUp('a@example.test', 'A');
   assert.equal((await app.call('/api/services', { method: 'POST', cookie: a.cookie, body: course })).status, 201);
   assert.equal((await app.call('/api/assignments', { method: 'POST', cookie: a.cookie, body: assignment })).status, 201);
   // Un courriel part par n8n : le compte y existe, donc son effacement chez n8n est tenté (et échoue).
   if(mode === 'local') assert.equal((await app.call('/api/auth/login', { method: 'POST', body: { identifier: 'a@example.test', password: 'faux-mot-de-passe-1' } })).status, 401);
   app.flags.failErase = true;
   const failed = await app.del('a@example.test');
   if(mode === 'miroir') {
    assert.equal(failed.status, 502);
    assert.equal(app.sql(`SELECT * FROM rides WHERE driver_email = 'a@example.test'`).length, 1);
    assert.equal((await app.call('/api/auth/login', { method: 'POST', body: { identifier: 'a@example.test', password: PASSWORD } })).status, 200);
   } else {
    // Mode local : n8n ne connaît le compte que s'il a envoyé un courriel ; sinon rien à effacer là-bas et la suppression aboutit.
    assert.ok([200, 502].includes(failed.status));
    if(failed.status === 502) {
     assert.equal(app.sql(`SELECT * FROM rides WHERE driver_email = 'a@example.test'`).length, 1);
     assert.equal(app.sql(`SELECT * FROM accounts WHERE email = 'a@example.test'`).length, 1);
    }
   }
   app.flags.failErase = false;
   if(failed.status !== 200) assert.equal((await app.del('a@example.test')).status, 200);
   assert.equal(app.sql(`SELECT * FROM rides WHERE driver_email = 'a@example.test'`).length, 0);
   if(mode === 'local') assert.equal(app.sql(`SELECT * FROM assignments WHERE driver_email = 'a@example.test'`).length, 0);
  } finally { await app.close(); }
 });
}

for(const mode of ['local', 'miroir']) {
 test(`suppression (${mode}) : une course créée pendant la suppression ne laisse aucune course orpheline`, async () => {
  const app = await start(mode);
  try {
   const a = await app.signUp('a@example.test', 'A');
   assert.equal((await app.call('/api/services', { method: 'POST', cookie: a.cookie, body: course })).status, 201);
   // La suppression attend la réponse de n8n ; pendant ce temps, le chauffeur (encore connecté) enregistre une course.
   let reached; const seen = new Promise(r => { reached = r; });
   let release; const released = new Promise(r => { release = r; });
   app.flags.hold = { reached, released };
   const deletion = app.del('a@example.test');
   await seen;
   assert.equal((await app.call('/api/services', { method: 'POST', cookie: a.cookie, body: course })).status, 201);
   release();
   assert.equal((await deletion).status, 200);
   assert.equal(app.sql(`SELECT * FROM rides WHERE driver_email = 'a@example.test'`).length, 0, 'course orpheline');
   if(mode === 'local') assert.equal(app.sql(`SELECT * FROM accounts WHERE email = 'a@example.test'`).length, 0);
  } finally { await app.close(); }
 });
}
