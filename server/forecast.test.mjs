import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { buildForecast, createForecastMiddleware, localDate, MIN_DAYS } from './forecast.mjs';
import { openDispatchStore, dispatchRow } from './dispatch.mjs';

let seq = 0;
const row = (date, time, zone = '1') => ({ trip_id: (seq++).toString(16).padStart(12, '0'), trip_date: date, trip_time: time, observed_at: `${date}T${time}`,
 departure_zone: zone, departure_address: '', destination_zone: '', destination_address: '', service_type: '', vehicle_id: '203', current_status: 'recu', confidence_score: 1, raw_text: '' });
// n appels le même jour, répartis à 14 h (zone 1) puis 7 h (zone 6) pour avoir un pic net.
const day = (date, n) => Array.from({ length: n }, (_, i) => i % 3 === 0 ? row(date, '07:10:00', '6') : row(date, '14:10:00', '1'));
// 2026-10-19 = lundi ; samedi 24, dimanche 25.
const DATES = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'];
const N = { '2026-10-19': 300, '2026-10-20': 280, '2026-10-21': 320, '2026-10-22': 290, '2026-10-23': 310, '2026-10-24': 190, '2026-10-25': 150, '2026-10-26': 270, '2026-10-27': 300 };
const rows = DATES.flatMap(d => day(d, N[d]));

test('trop peu de journées : pas de prévision, besoin annoncé', () => {
 const f = buildForecast(DATES.slice(0, 3).flatMap(d => day(d, 10)), '2026-10-30');
 assert.equal(f.ready, false);
 assert.equal(f.needed, MIN_DAYS);
});

test('manque de fins de semaine : pas de prévision', () => {
 const f = buildForecast(DATES.slice(0, 5).concat('2026-10-26', '2026-10-27').flatMap(d => day(d, 20)), '2026-10-30');
 assert.equal(f.ready, false);
});

test('prévision : médiane par type de jour, 7 jours à partir de demain, journée en cours exclue', () => {
 const withToday = rows.concat(day('2026-10-28', 5)); // aujourd'hui : incomplet, ne doit pas peser
 const f = buildForecast(withToday, '2026-10-28');
 assert.equal(f.ready, true);
 assert.equal(f.days, 9);
 assert.equal(f.asOf, '2026-10-27');
 assert.equal(f.daily.length, 7);
 assert.equal(f.daily[0].date, '2026-10-29'); // jeudi
 assert.equal(f.daily[0].type, 'weekday');
 assert.equal(f.daily[2].date, '2026-10-31'); // samedi
 assert.equal(f.daily[2].type, 'weekend');
 // semaine : 300 280 320 290 310 270 300 -> médiane 300 ; fin de semaine : 190 150 -> 170
 assert.equal(f.stats.weekday.expected, 300);
 assert.equal(f.stats.weekend.expected, 170);
 assert.equal(f.daily[2].expected, 170);
 assert.ok(f.daily.every(d => d.low <= d.expected && d.expected <= d.high));
});

test('profil horaire, heures de pointe et zones par plage', () => {
 const f = buildForecast(rows, '2026-10-28');
 assert.equal(f.hourly.weekday.length, 24);
 assert.deepEqual(f.peaks.weekday.slice().sort((a, b) => a - b).filter(h => h === 7 || h === 14), [7, 14]);
 assert.ok(f.hourly.weekday[14] > f.hourly.weekday[7] && f.hourly.weekday[7] > f.hourly.weekday[3]);
 assert.equal(f.zones.weekday['14-18'][0].zone, '1');
 assert.equal(f.zones.weekday['6-10'][0].zone, '6');
 assert.equal(f.zones.weekday['6-10'][0].share, 100);
});

test('fiabilité calculée sur les données (erreur relative, niveau) ; peu de jours = « faible »', () => {
 const f = buildForecast(rows, '2026-10-28');
 assert.equal(typeof f.reliability.errorPct, 'number');
 assert.equal(f.reliability.level, 'faible'); // 9 jours < 14
 const long = [];
 for(let i = 0; i < 21; i++) { const d = new Date(Date.parse('2026-09-01T12:00:00Z') + i * 86400000).toISOString().slice(0, 10); long.push(...day(d, 100)); }
 const g = buildForecast(long, '2026-09-30');
 assert.equal(g.reliability.errorPct, 0);
 assert.equal(g.reliability.level, 'bonne');
});

test('sortie : agrégats seulement (aucun véhicule, texte brut ni adresse)', () => {
 const out = JSON.stringify(buildForecast(rows, '2026-10-28'));
 assert.ok(!/vehicle|raw_text|address|trip_id/.test(out));
});

test('date locale : fuseau de Toronto (23 h locale = encore le même jour)', () => {
 assert.equal(localDate(new Date('2026-11-08T04:30:00Z')), '2026-11-07');
 assert.equal(localDate(new Date('2026-11-08T05:30:00Z')), '2026-11-08');
});

async function serve(user) {
 const store = openDispatchStore();
 store.upsertMany(rows.map(dispatchRow));
 const mw = createForecastMiddleware({ getUser: async () => user, store, now: () => new Date('2026-10-28T15:00:00Z') });
 const server = createServer((req, res) => mw(req, res, () => { res.statusCode = 404; res.end(); }));
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const call = async (path = '/api/forecast', init = {}) => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, init);
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
 };
 return { call, close: () => server.close() };
}

test('route : connexion requise, GET seulement, sans paramètres, origine contrôlée', async () => {
 const anon = await serve(null);
 try { assert.equal((await anon.call()).status, 401); } finally { anon.close(); }
 const s = await serve({ id: 'u', email: 'a@b.c', role: 'driver' });
 try {
  const ok = await s.call();
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ready, true);
  assert.equal(ok.body.daily.length, 7);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal((await s.call('/api/forecast', { method: 'POST' })).status, 405);
  assert.equal((await s.call('/api/forecast?x=1')).status, 400);
  assert.equal((await s.call('/api/forecast', { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await s.call('/autre')).status, 404);
 } finally { s.close(); }
});

test('zones : perHour par plage horaire et jusqu’à 8 zones', () => {
 const f = buildForecast(rows, '2026-10-28');
 const z = f.zones.weekday['14-18'][0];
 assert.equal(z.zone, '1');
 assert.ok(z.perHour > 0);
 assert.deepEqual(f.positions, {});
});

test('positions de zones : l’administrateur place et retire, les autres lisent seulement', async () => {
 const json = (body, method = 'PUT') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
 const driver = await serve({ id: 'd', email: 'd@b.c', role: 'chauffeur' });
 try {
  assert.equal((await driver.call('/api/forecast/zones/12', json({ lat: 45.7, lng: -73.6 }))).status, 403);
  assert.equal((await driver.call('/api/forecast/zones/12', { method: 'DELETE' })).status, 403);
 } finally { driver.close(); }
 const admin = await serve({ id: 'a', email: 'a@b.c', role: 'admin' });
 try {
  assert.equal((await admin.call('/api/forecast/zones/12', json({ lat: 45.7, lng: -73.6 }))).status, 200);
  assert.equal((await admin.call('/api/forecast/zones/1', json({ lat: 45.71234567, lng: -73.64 }))).body.lat, 45.71235);
  assert.deepEqual((await admin.call()).body.positions['12'], { lat: 45.7, lng: -73.6 });
  // refus : zone invalide, hors région, valeurs inversées / non numériques, méthode
  assert.equal((await admin.call('/api/forecast/zones/abc', json({ lat: 45.7, lng: -73.6 }))).status, 400);
  assert.equal((await admin.call('/api/forecast/zones/5', json({ lat: -73.6, lng: 45.7 }))).status, 400);
  assert.equal((await admin.call('/api/forecast/zones/5', json({ lat: '45.7', lng: -73.6 }))).status, 400);
  assert.equal((await admin.call('/api/forecast/zones/5', json({ lat: 10, lng: -73.6 }))).status, 400);
  assert.equal((await admin.call('/api/forecast/zones/5', { method: 'POST' })).status, 405);
  assert.equal((await admin.call('/api/forecast/zones/12', { method: 'DELETE' })).status, 200);
  assert.equal((await admin.call()).body.positions['12'], undefined);
  assert.ok((await admin.call()).body.positions['1']);
 } finally { admin.close(); }
});
