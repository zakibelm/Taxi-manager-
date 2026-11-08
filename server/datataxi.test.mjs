import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDispatchStore, dispatchRow } from './dispatch.mjs';
import { createDatataxiMiddleware } from './datataxi.mjs';
import { importCsv, parseCsv } from './import-datataxi.mjs';

const TOKEN = 'dt-' + 'a'.repeat(30);
const line = (id, extra = {}) => ({ trip_id: id, trip_date: '2026-10-17', trip_time: '16:41:30', observed_at: '2026-10-17T16:41:30', departure_zone: '12', departure_address: '',
 destination_zone: '1', destination_address: '', service_type: '', vehicle_id: '409', current_status: 'pris_appel_en_attente', confidence_score: '1.0',
 raw_text: '16:41:30 Véhicule 409 a pris sur Zone 12 un Appel en attente vers le 1', ...extra });

async function serve(store, env = { DATATAXI_TOKEN: TOKEN }) {
 const mw = createDatataxiMiddleware({ store, env, log: () => {} });
 const server = createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end(); }));
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const post = async (body, path = '/api/datataxi/ingest') => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
 };
 return { post, close: () => server.close() };
}

test('ligne valide : forme normalisée, valeurs inconnues vides, confiance numérique', () => {
 const r = dispatchRow(line('ae3d6456b29b', { observed_at: '2026-10-17 16:41:30', departure_zone: '', confidence_score: '' }));
 assert.equal(r.observed_at, '2026-10-17T16:41:30');
 assert.equal(r.departure_zone, '');
 assert.equal(r.confidence_score, null);
});

test('ligne invalide refusée (identité, zone, véhicule, confiance, date)', () => {
 for(const bad of [{ trip_id: 'xyz' }, { departure_zone: 'A1' }, { vehicle_id: '12; DROP' }, { confidence_score: '2' }, { trip_date: '2026-13-45' }, { observed_at: '2026-10-17T00:00:00' }])
  assert.throws(() => dispatchRow(line('ae3d6456b29b', bad)), undefined, JSON.stringify(bad));
});

test('envoi de l’application : accepté, rejoué sans doublon, lot invalide refusé en entier', async () => {
 const store = openDispatchStore();
 const { post, close } = await serve(store);
 try {
  const rows = [line('ae3d6456b29b'), line('261d1e9c3b95', { vehicle_id: '203' })];
  assert.deepEqual(await post({ token: TOKEN, rows }), { status: 200, body: { ok: true, received: 2 } });
  await post({ token: TOKEN, rows });
  assert.equal(store.count(), 2);
  const bad = await post({ token: TOKEN, rows: [line('bbbbbbbbbbbb'), line('cccccccccccc', { departure_zone: 'zz' })] });
  assert.equal(bad.status, 400);
  assert.equal(store.count(), 2);   // rien de partiel
 } finally { close(); }
});

test('jeton absent ou faux : 401 ; route non configurée : 503 ; mauvaise méthode ignorée ailleurs', async () => {
 const store = openDispatchStore();
 let s = await serve(store);
 try {
  assert.equal((await s.post({ token: 'dt-faux', rows: [line('ae3d6456b29b')] })).status, 401);
  assert.equal((await s.post({ rows: [line('ae3d6456b29b')] })).status, 401);
  assert.equal((await s.post({ token: TOKEN, rows: [] })).status, 400);
  assert.equal((await s.post({}, '/api/autre')).status, 404);
 } finally { s.close(); }
 s = await serve(store, {});
 try { assert.equal((await s.post({ token: '', rows: [line('ae3d6456b29b')] })).status, 503); } finally { s.close(); }
 assert.equal(store.count(), 0);
});

test('import CSV du Google Sheet : colonnes source_* ignorées, doublons et lignes invalides comptés', () => {
 const store = openDispatchStore();
 const csv = '﻿trip_id,trip_date,trip_time,observed_at,departure_zone,departure_address,destination_zone,destination_address,service_type,vehicle_id,current_status,confidence_score,raw_text,source_file\n'
  + 'ae3d6456b29b,2026-10-17,16:40:57,2026-10-17 16:40:57,,,6,,,203,recu_manuel,1.0,"16:40:57 Véhicule 203 a reçu Manuel vers le 6",x.csv\n'
  + '261d1e9c3b95,2026-10-17,16:41:30,2026-10-17 16:41:30,12,,1,,"[Adapté, A]",409,pris_appel_en_attente,1.0,"16:41:30 ""test"" ligne",\n'
  + 'mauvais,2026-10-17,16:41:30,2026-10-17 16:41:30,12,,1,,,409,x,1.0,t,\n';
 const r = importCsv(csv, store);
 assert.equal(r.read, 3); assert.equal(r.valid, 2); assert.equal(r.rejected, 1); assert.equal(r.added, 2);
 assert.equal(store.get('261d1e9c3b95').service_type, '[Adapté, A]');
 assert.equal(importCsv(csv, store).added, 0);   // idempotent
 assert.equal(importCsv(csv, openDispatchStore(), { dryRun: true }).added, null);
 assert.throws(() => importCsv('a,b\n1,2\n', store), /trip_id/);
 assert.deepEqual(parseCsv('a,"b\nc"\n1,2'), [['a', 'b\nc'], ['1', '2']]);
});
