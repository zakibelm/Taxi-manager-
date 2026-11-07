import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendZones, zoneDigest, zoneOf, localParts, slotOf, hasOrigin } from './zones.mjs';

// Mercredi 2026-11-11 à 8 h 30, heure du Québec (UTC-5 en novembre) = 13:30Z.
const NOW = new Date('2026-11-11T13:30:00Z');
const ride = (iso, lat, lng, amount = 20, type = 'Régulier') => ({ type, amount, date: iso, origin_lat: lat, origin_lng: lng });
// Mercredis du matin (8 h 15 locale = 13:15Z) à la zone A (45.55, -73.59) ; samedis soir à la zone B.
const A = [7, 14, 21, 28].map(d => ride(`2026-10-${String(d).padStart(2, '0')}T13:15:00Z`, 45.552, -73.591, 30, 'Olymel'));
const B = ride('2026-10-24T01:15:00Z', 45.61, -73.70, 15);

test('heure du Québec : un mercredi matin à 13:30 UTC, quel que soit le fuseau du serveur', () => {
  assert.deepEqual(localParts(NOW), { day: 3, hour: 8 });
  assert.equal(slotOf(8).id, 'matin');
  assert.equal(slotOf(0).id, 'nuit');
  assert.equal(slotOf(23).id, 'soir');
});

test('zone : case de 0,01°, centre arrondi, deux points proches = même zone', () => {
  assert.equal(zoneOf(45.552, -73.591).id, zoneOf(45.557, -73.595).id);
  assert.notEqual(zoneOf(45.552, -73.591).id, zoneOf(45.562, -73.591).id);
  assert.deepEqual([zoneOf(45.552, -73.591).lat, zoneOf(45.552, -73.591).lng], [45.555, -73.595]);
});

test('origine : seulement deux nombres valides', () => {
  assert.equal(hasOrigin({ origin_lat: 45.5, origin_lng: -73.5 }), true);
  for (const s of [{}, { origin_lat: null, origin_lng: null }, { origin_lat: 45.5 }, { origin_lat: 'a', origin_lng: 1 }, { origin_lat: 91, origin_lng: 0 }]) assert.equal(hasOrigin(s), false);
});

test('pas assez de courses localisées : aucune recommandation, aucune invention', () => {
  const r = recommendZones([...A.slice(0, 2), ride('2026-10-05T13:00:00Z', null, null)], NOW);
  assert.equal(r.status, 'insufficient');
  assert.equal(r.located, 2);
  assert.deepEqual(r.zones, []);
  assert.equal(recommendZones([], NOW).status, 'insufficient');
});

test('base la plus précise : même jour de la semaine et même tranche horaire', () => {
  const r = recommendZones([...A, B], NOW);
  assert.equal(r.status, 'ok');
  assert.equal(r.basis, 'day-slot');
  assert.equal(r.sample, 4);
  assert.equal(r.zones.length, 1);
  assert.deepEqual([r.zones[0].lat, r.zones[0].lng, r.zones[0].count], [45.555, -73.595, 4]);
  assert.equal(r.zones[0].averageAmount, 30);
  assert.equal(r.zones[0].topType, 'Olymel');
  assert.equal(r.zones[0].share, 1);
});

test('repli : tranche seule, puis tout l’historique', () => {
  // Le jeudi (autre jour), même tranche : pas assez de jeudis → tranche seule.
  const thursday = new Date('2026-11-12T13:30:00Z');
  assert.equal(recommendZones([...A, B], thursday).basis, 'slot');
  // Nuit de mercredi : aucune course dans la tranche → tout l'historique localisé.
  const night = new Date('2026-11-11T07:00:00Z'); // 2 h locale
  const r = recommendZones([...A, B], night);
  assert.equal(r.basis, 'all');
  assert.equal(r.sample, 5);
  assert.equal(r.zones[0].count, 4);
});

test('résumé pour l’IA : zones agrégées seulement, jamais la position exacte d’une course', () => {
  const d = zoneDigest([...A, B], NOW);
  const json = JSON.stringify(d);
  assert.equal(d.localisees, 5);
  assert.equal(d.maintenant.zones[0].courses, 4);
  assert.ok(Object.keys(d.parTranche).length >= 1);
  for (const exact of ['45.552', '-73.591', '45.61', '-73.7']) assert.equal(json.includes(exact), false, exact);
  assert.equal(zoneDigest([], NOW).statut, 'pas assez de courses localisées');
});
