import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeN8n } from './testing/fake-n8n.mjs';
import { createN8nClient, createServicesProvider } from './providers/n8n.mjs';
import { openRideStore } from './sqlite.mjs';
import { syncRides, backupRides } from './sqlite-sync.mjs';

const row = (id, extra = {}) => ({ service_id: id, driver_email: 'a@x.test', type: 'Taxi', amount: 10, date: '2026-10-01T10:00:00Z', description: '', origin_lat: 45.5, origin_lng: -73.6, updated_at: 'u1', ...extra });

test('rattrapage : copie les courses manquantes puis ne recopie rien (idempotent)', async () => {
 const n8n = createFakeN8n({ now: () => 0 });
 n8n.db.services.push(row('a'), row('b'));
 const source = createServicesProvider(createN8nClient(n8n.env, n8n.fetcher));
 const store = openRideStore();
 assert.deepEqual(await syncRides({ source, store }), { seen: 2, copied: 2, total: 2 });
 assert.deepEqual(await syncRides({ source, store }), { seen: 2, copied: 0, total: 2 });
 n8n.db.services[0] = row('a', { amount: 99, updated_at: 'u2' });
 assert.equal((await syncRides({ source, store })).copied, 1);
 assert.equal(store.listByDriver('a@x.test').find(r => r.service_id === 'a').amount, 99);
});

test('une course disparue de n8n reste dans SQLite (l’historique est conservé)', async () => {
 const n8n = createFakeN8n({ now: () => 0 });
 n8n.db.services.push(row('a'));
 const source = createServicesProvider(createN8nClient(n8n.env, n8n.fetcher));
 const store = openRideStore();
 await syncRides({ source, store });
 n8n.db.services.length = 0;
 await syncRides({ source, store });
 assert.equal(store.count(), 1);
});

test('sauvegarde datée, relance du même jour remplace, anciennes supprimées', () => {
 const dir = mkdtempSync(path.join(tmpdir(), 'tm-bk-'));
 const store = openRideStore();
 store.upsert(row('a'));
 for(const d of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-03']) backupRides({ store, dir, keep: 2, now: new Date(`${d}T05:00:00Z`) });
 assert.deepEqual(readdirSync(dir).sort(), ['rides-20261102.db', 'rides-20261103.db']);
});

import { purgeOldFromN8n } from './sqlite-sync.mjs';
import { createMirroredServices } from './providers/mirror.mjs';

test('purge n8n : seulement les courses anciennes dont la copie SQLite est identique', async () => {
 const n8n = createFakeN8n({ now: () => 0 });
 n8n.db.services.push(row('old-ok', { date: '2026-08-01T10:00:00Z' }), row('old-nocopy', { date: '2026-08-02T10:00:00Z' }), row('recent', { date: '2026-11-01T10:00:00Z' }));
 const source = createServicesProvider(createN8nClient(n8n.env, n8n.fetcher));
 const store = openRideStore();
 store.upsert(row('old-ok', { date: '2026-08-01T10:00:00Z' }));
 store.upsert(row('recent', { date: '2026-11-01T10:00:00Z' }));
 const r = await purgeOldFromN8n({ source, store, days: 35, now: new Date('2026-11-07T12:00:00Z') });
 assert.deepEqual(r, { removed: 1, kept: 1 });
 assert.deepEqual(n8n.db.services.map(s => s.service_id).sort(), ['old-nocopy', 'recent']);
 assert.equal(store.count(), 2);
});

test('liste fusionnée : récent depuis n8n + ancien depuis SQLite, sans doublon, propriétaire respecté', async () => {
 const n8n = createFakeN8n({ now: () => 0 });
 n8n.db.services.push(row('new', { date: '2026-11-01T10:00:00Z' }));
 const store = openRideStore();
 store.upsertMany([row('new', { date: '2026-11-01T10:00:00Z' }), row('old', { date: '2026-08-01T10:00:00Z' }), row('other', { driver_email: 'b@x.test' })]);
 const services = createMirroredServices({ primary: createServicesProvider(createN8nClient(n8n.env, n8n.fetcher)), store });
 const mine = await services.list({ role: 'chauffeur', email: 'a@x.test' });
 assert.deepEqual(mine.map(r => r.id).sort(), ['new', 'old']);
 assert.equal((await services.list({ role: 'admin', email: 'z@x.test' })).length, 3);
 await services.delete('old', 'a@x.test');
 assert.equal(store.count(), 2);
});
