import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFakeN8n } from './testing/fake-n8n.mjs';
import { createN8nClient, createCompaniesProvider, createServicesProvider } from './providers/n8n.mjs';
import { createCompaniesMiddleware, createCompanyService, MIN_DRIVERS } from './companies.mjs';

const NOW = Date.parse('2026-11-04T15:00:00Z'); // mercredi 10 h à Montréal
function setup() {
 const n8n = createFakeN8n({ now: () => NOW });
 const client = createN8nClient(n8n.env, n8n.fetcher);
 const service = createCompanyService({ provider: createCompaniesProvider(client), services: createServicesProvider(client), now: () => NOW });
 return { n8n, service };
}
const driver = n => ({ role: 'chauffeur', email: `d${n}@example.test` });
// 6 courses par chauffeur dans la même zone (mercredi matin), centre ≈ 45.5, -73.6
const rides = (n, lat = 45.505, lng = -73.595) => Array.from({ length: 6 }, (_, i) => ({
 service_id: `s${n}-${i}`, driver_email: `d${n}@example.test`, type: 'Taxi', amount: 20 + i, date: `2026-10-${String(7 + 7 * (i % 3)).padStart(2, '0')}T14:00:00.000Z`, origin_lat: lat, origin_lng: lng }));

async function member(service, n, { share = true, approve = true, company } = {}) {
 await service.updateMembership(driver(n), { companyId: company.id, share });
 if(approve) await service.decide(driver(n).email, true);
}

test('la compagnie est créée par l’administrateur, sans doublon, et archivable', async () => {
 const { service } = setup();
 const c = await service.createCompany('Co-op Taxi Terrebonne');
 assert.equal(c.active, true);
 await assert.rejects(service.createCompany('co-op taxi terrebonne'), { status: 409 });
 await service.setCompanyActive(c.id, false);
 assert.deepEqual(await service.listCompanies(driver(1)), []);
 assert.equal((await service.listCompanies({ role: 'admin', email: 'a@x.test' })).length, 1);
});

test('adhésion : en attente, approbation par l’administrateur, partage en opt-in', async () => {
 const { service } = setup();
 const c = await service.createCompany('Co-op');
 let m = await service.updateMembership(driver(1), { companyId: c.id });
 assert.deepEqual(m, { companyId: c.id, companyName: 'Co-op', status: 'pending', share: false });
 await assert.rejects(service.zones(driver(1)), { status: 403 }); // pas encore approuvé
 await service.decide('d1@example.test', true);
 m = await service.updateMembership(driver(1), { share: true });
 assert.equal(m.status, 'approved'); assert.equal(m.share, true);
 // changer de compagnie repart en attente et coupe le partage
 const c2 = await service.createCompany('Autre');
 m = await service.updateMembership(driver(1), { companyId: c2.id });
 assert.equal(m.status, 'pending'); assert.equal(m.share, false);
 m = await service.updateMembership(driver(1), { companyId: null });
 assert.equal(await service.myMembership(driver(1)), null);
 await assert.rejects(service.updateMembership(driver(1), { share: true }), { status: 400 });
 await assert.rejects(service.updateMembership(driver(1), { companyId: '11111111-1111-4111-8111-111111111111' }), { status: 404 });
});

test('prévisions compagnie : membres approuvés qui partagent seulement, minimum 3 chauffeurs', async () => {
 const { n8n, service } = setup();
 const c = await service.createCompany('Co-op');
 const other = await service.createCompany('Autre compagnie');
 for(const n of [1, 2]) { await member(service, n, { company: c }); n8n.db.services.push(...rides(n)); }
 let r = await service.zones(driver(1));
 assert.equal(r.status, 'insufficient'); assert.equal(r.contributors, 2);
 assert.equal(r.recommend, undefined); assert.equal(r.spots, undefined);
 // 3e chauffeur approuvé mais qui ne partage pas, 4e en attente, 5e dans une autre compagnie : aucun ne compte
 await member(service, 3, { company: c, share: false }); n8n.db.services.push(...rides(3));
 await member(service, 4, { company: c, approve: false }); n8n.db.services.push(...rides(4));
 await member(service, 5, { company: other }); n8n.db.services.push(...rides(5));
 r = await service.zones(driver(1));
 assert.equal(r.status, 'insufficient'); assert.equal(r.contributors, 2); assert.equal(r.sharing, 2);
 // le 3e partage : les zones apparaissent
 await service.updateMembership(driver(3), { share: true });
 r = await service.zones(driver(1));
 assert.equal(r.status, 'ok'); assert.equal(r.contributors, 3); assert.equal(MIN_DRIVERS, 3);
 assert.equal(r.recommend.status, 'ok'); assert.equal(r.recommend.zones[0].count, 18);
 assert.ok(r.spots.spots.length >= 1); assert.equal(r.spots.spots[0].count, 18);
 // aucune donnée personnelle dans la réponse
 const json = JSON.stringify(r);
 assert.ok(!json.includes('example.test') && !json.includes('driver_email') && !json.includes('s1-0'));
});

test('une zone fréquentée par moins de 3 chauffeurs n’est pas publiée', async () => {
 const { n8n, service } = setup();
 const c = await service.createCompany('Co-op');
 for(const n of [1, 2, 3]) { await member(service, n, { company: c }); n8n.db.services.push(...rides(n)); }
 n8n.db.services.push(...rides(1, 45.605, -73.795).map(s => ({ ...s, service_id: 'far' + s.service_id }))); // zone lointaine : un seul chauffeur
 const r = await service.zones(driver(2));
 assert.equal(r.status, 'ok');
 assert.ok(r.recommend.zones.every(z => z.lat < 45.6), 'zone d’un seul chauffeur écartée');
 assert.ok(r.spots.spots.every(s => s.lat < 45.6));
 const digest = await service.digest(driver(2));
 assert.ok(digest && JSON.stringify(digest).includes('45.505'));
 assert.ok(!JSON.stringify(digest).includes('45.605'));
});

test('résumé IA : absent sans appartenance approuvée ni 3 chauffeurs', async () => {
 const { n8n, service } = setup();
 const c = await service.createCompany('Co-op');
 assert.equal(await service.digest(driver(1)), null);
 await member(service, 1, { company: c }); n8n.db.services.push(...rides(1));
 assert.equal(await service.digest(driver(1)), null);
});

async function http(service, user) {
 const server = createServer((req, res) => createCompaniesMiddleware({ getUser: async () => user, service })(req, res, () => { res.statusCode = 404; res.end(); }));
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const base = `http://127.0.0.1:${server.address().port}`;
 const call = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: await res.json() };
 };
 return { call, close: () => new Promise(r => server.close(r)) };
}

test('routes : droits, validation et paramètres', async () => {
 const { service } = setup();
 const admin = await http(service, { role: 'admin', email: 'a@x.test' });
 const chauffeur = await http(service, driver(1));
 const chauffeur2 = await http(service, driver(2));
 const chauffeur3 = await http(service, driver(3));
 try {
  assert.equal((await chauffeur.call('/api/companies', { method: 'POST', body: { name: 'X' } })).status, 403);
  assert.equal((await admin.call('/api/companies', { method: 'POST', body: { name: '' } })).status, 400);
  assert.equal((await admin.call('/api/companies', { method: 'POST', body: { name: '<b>', extra: 1 } })).status, 400);
  const created = await admin.call('/api/companies', { method: 'POST', body: { name: 'Co-op' } });
  assert.equal(created.status, 201);
  const id = created.data.company.id;
  assert.equal((await chauffeur.call('/api/companies')).data.companies.length, 1);
  assert.equal((await admin.call('/api/companies/pas-un-id', { method: 'PUT', body: { active: false } })).status, 400);
  assert.equal((await chauffeur.call('/api/membership', { method: 'PUT', body: { companyId: id, share: true } })).data.membership.status, 'pending');
  assert.equal((await chauffeur.call('/api/memberships')).status, 403);
  assert.equal((await admin.call('/api/membership')).status, 200);
  const free = await chauffeur2.call('/api/membership', { method: 'PUT', body: { companyName: '  Taxi   Été ' } });
  assert.equal(free.data.membership.status, 'pending');
  const again = await chauffeur3.call('/api/membership', { method: 'PUT', body: { companyName: 'taxi ete' } });
  assert.equal(again.data.membership.companyId, free.data.membership.companyId);
  assert.equal((await chauffeur2.call('/api/membership', { method: 'PUT', body: { companyName: '   ' } })).status, 400);
  const list = await admin.call('/api/memberships');
  assert.equal(list.data.memberships[0].email, 'd1@example.test');
  assert.equal((await admin.call('/api/memberships/decision', { method: 'POST', body: { email: 'd1@example.test', approve: true } })).status, 200);
  assert.equal((await admin.call('/api/memberships/decision', { method: 'POST', body: { email: 'nobody@example.test', approve: true } })).status, 404);
  assert.equal((await chauffeur.call('/api/company/zones?slot=soir&day=3')).data.status, 'insufficient');
  assert.equal((await chauffeur.call('/api/company/zones?slot=minuit')).status, 400);
  assert.equal((await chauffeur.call('/api/company/zones?day=9')).status, 400);
  assert.equal((await admin.call('/api/company/zones')).status, 403);
 } finally { await admin.close(); await chauffeur.close(); await chauffeur2.close(); await chauffeur3.close(); }
});
