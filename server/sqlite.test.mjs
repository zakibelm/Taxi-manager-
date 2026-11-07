import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openRideStore } from './sqlite.mjs';

const ride = (id, email, extra = {}) => ({ service_id: id, driver_email: email, type: 'Taxi', amount: 20, date: '2026-11-01T15:00:00Z', description: '', origin_lat: 45.5, origin_lng: -73.6, ...extra });

test('upsert est idempotent et mis à jour par service_id', () => {
 const s = openRideStore();
 s.upsert(ride('a', 'x@y.z'));
 s.upsert(ride('a', 'x@y.z', { amount: 35 }));
 assert.equal(s.count(), 1);
 assert.equal(s.listByDriver('x@y.z')[0].amount, 35);
 assert.equal(s.listByDriver('x@y.z')[0].id, 'a');
});

test('origine absente → null, et la course reste lisible', () => {
 const s = openRideStore();
 s.upsert(ride('a', 'x@y.z', { origin_lat: undefined, origin_lng: '' }));
 const r = s.listAll()[0];
 assert.equal(r.origin_lat, null);
 assert.equal(r.origin_lng, null);
});

test('suppression : seulement le propriétaire, et effacement complet d’un chauffeur', () => {
 const s = openRideStore();
 s.upsertMany([ride('a', 'x@y.z'), ride('b', 'x@y.z'), ride('c', 'w@y.z')]);
 assert.equal(s.remove('a', 'w@y.z'), 0);
 assert.equal(s.remove('a', 'x@y.z'), 1);
 assert.equal(s.removeDriver('x@y.z'), 1);
 assert.deepEqual(s.listAll().map(r => r.service_id), ['c']);
});

test('listByDrivers filtre sur un ensemble de chauffeurs', () => {
 const s = openRideStore();
 s.upsertMany([ride('a', 'x@y.z'), ride('b', 'w@y.z'), ride('c', 'v@y.z')]);
 assert.deepEqual(s.listByDrivers(new Set(['x@y.z', 'v@y.z'])).map(r => r.service_id).sort(), ['a', 'c']);
 assert.deepEqual(s.listByDrivers([]), []);
});

test('version change à chaque écriture (invalidation de cache)', () => {
 const s = openRideStore();
 const v0 = s.version;
 s.upsert(ride('a', 'x@y.z'));
 assert.ok(s.version > v0);
});

test('sauvegarde VACUUM INTO : fichier privé et relisible', () => {
 const dir = mkdtempSync(path.join(tmpdir(), 'tm-'));
 const s = openRideStore(path.join(dir, 'rides.db'));
 s.upsert(ride('a', 'x@y.z'));
 const target = path.join(dir, 'backup', 'copy.db');
 s.backupTo(target);
 assert.ok(existsSync(target));
 assert.equal(statSync(target).mode & 0o077, 0);
 const copy = openRideStore(target);
 assert.equal(copy.count(), 1);
});
