import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeN8n } from './testing/fake-n8n.mjs';
import { createN8nClient, createCompaniesProvider, createServicesProvider } from './providers/n8n.mjs';
import { createMirroredServices } from './providers/mirror.mjs';
import { createCompanyService } from './companies.mjs';
import { openRideStore } from './sqlite.mjs';

const NOW = Date.parse('2026-11-04T15:00:00Z');
function setup(extra = {}) {
 const n8n = createFakeN8n({ now: () => NOW });
 const client = createN8nClient(n8n.env, n8n.fetcher);
 const store = extra.store ?? openRideStore();
 const logs = [];
 const services = createMirroredServices({ primary: createServicesProvider(client), store, log: m => logs.push(m) });
 const company = createCompanyService({ provider: createCompaniesProvider(client), services, now: () => NOW });
 return { n8n, store, services, company, logs };
}
const user = n => ({ role: 'chauffeur', email: `d${n}@example.test` });
const input = { type: 'Taxi', amount: 22, date: '2026-10-07T14:00:00.000Z', description: '', origin_lat: 45.505, origin_lng: -73.595 };

test('création : n8n d’abord, puis copie SQLite avec le même identifiant', async () => {
 const { n8n, store, services } = setup();
 const created = await services.create({ ...input, driver_email: user(1).email }, '11111111-1111-4111-8111-111111111111');
 assert.equal(n8n.db.services.length, 1);
 assert.equal(store.count(), 1);
 assert.equal(store.listAll()[0].service_id, created.id ?? created.service_id);
});

test('suppression : retirée des deux côtés, seulement pour le propriétaire', async () => {
 const { n8n, store, services } = setup();
 await services.create({ ...input, driver_email: user(1).email }, 'a1111111-1111-4111-8111-111111111111');
 await services.delete('a1111111-1111-4111-8111-111111111111', user(2).email);
 assert.equal(store.count(), 1);
 await services.delete('a1111111-1111-4111-8111-111111111111', user(1).email);
 assert.equal(n8n.db.services.length, 0);
 assert.equal(store.count(), 0);
});

test('une panne SQLite n’empêche pas d’enregistrer la course et est journalisée', async () => {
 const { n8n, store, services, logs } = setup();
 store.upsert = () => { throw new Error('disque plein'); };
 const created = await services.create({ ...input, driver_email: user(1).email });
 assert.ok(created);
 assert.equal(n8n.db.services.length, 1);
 assert.match(logs[0], /disque plein/);
});

test('prévisions de compagnie lues dans SQLite, avec cache invalidé par une écriture', async () => {
 const { n8n, store, services, company } = setup();
 const c = await company.createCompany('Co-op');
 for(const n of [1, 2, 3]) {
  await company.updateMembership(user(n), { companyId: c.id, share: true });
  await company.decide(user(n).email, true);
  for(let i = 0; i < 6; i++) await services.create({ ...input, date: `2026-10-${String(7 + 7 * (i % 3)).padStart(2, '0')}T14:00:00.000Z`, driver_email: user(n).email });
 }
 n8n.db.services.length = 0;   // prouve que n8n n'est plus lu pour les prévisions
 const r = await company.zones(user(1));
 assert.equal(r.status, 'ok'); assert.equal(r.contributors, 3);
 assert.ok(JSON.stringify(r).indexOf('example.test') === -1);   // aucun courriel dans la réponse
 const before = (await company.pool(user(1))).rides.length;
 await services.create({ ...input, driver_email: user(1).email });
 assert.equal((await company.pool(user(1))).rides.length, before + 1);
 // un chauffeur qui ne partage plus sort du pool
 await company.updateMembership(user(3), { share: false });
 assert.equal((await company.pool(user(1))).sharing, 2);
});
