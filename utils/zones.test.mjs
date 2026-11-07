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

import { hotspots, locatedRides, distanceKm, SPOT_RADIUS_KM } from './zones.mjs';

test('distance : ~1,1 km par 0,01° de latitude ; Montréal–Laval ≈ 15 km', () => {
  assert.ok(Math.abs(distanceKm(45.5, -73.6, 45.51, -73.6) - 1.11) < 0.02);
  const d = distanceKm(45.5017, -73.5673, 45.6066, -73.7124);
  assert.ok(d > 14 && d < 18, String(d));
});

const at = (lat, lng, n, amount = 20, type = 'Régulier') => Array.from({ length: n }, (_, i) => ride(`2026-10-${String(7 + 7 * (i % 4)).padStart(2, '0')}T13:15:00Z`, lat, lng, amount, type));

test('secteurs : un grand, un moyen, un petit, avec niveau et couleur relatifs au plus actif', () => {
  // Trois secteurs séparés de plus de 5 km : Centre-ville (10), Laval (6), Longueuil (2) ; le petit reste visible (14 courses < 10 ? non : 18 ≥ 10 → filtré à ≥ 2).
  const rides = [...at(45.502, -73.567, 10), ...at(45.606, -73.712, 6, 40, 'Olymel'), ...at(45.531, -73.518, 2)];
  const r = hotspots(rides);
  assert.equal(r.status, 'ok');
  assert.equal(r.spots.length, 3);
  assert.deepEqual(r.spots.map(s => s.level), ['forte', 'moyenne', 'faible']);
  assert.deepEqual(r.spots.map(s => s.count), [10, 6, 2]);
  assert.equal(r.spots[0].radiusKm, SPOT_RADIUS_KM);
  assert.equal(r.spots[1].topType, 'Olymel');
  assert.equal(r.spots[1].averageAmount, 40);
  assert.equal(r.spots.reduce((n, s) => n + s.share, 0) <= 1.01, true);
});

test('secteurs : chaque course dans un seul secteur ; des zones voisines (< 5 km) fusionnent', () => {
  const rides = [...at(45.502, -73.567, 4), ...at(45.522, -73.567, 3), ...at(45.54, -73.55, 3)]; // tout à moins de 5 km
  const r = hotspots(rides);
  assert.equal(r.spots.length, 1);
  assert.equal(r.spots[0].count, 10);
  assert.equal(r.spots[0].level, 'forte');
});

test('secteurs : trop peu de courses → rien ; bruit d’une seule course écarté quand l’historique est étoffé', () => {
  assert.equal(hotspots(at(45.5, -73.5, 2)).status, 'insufficient');
  assert.equal(hotspots([]).spots.length, 0);
  const noisy = hotspots([...at(45.502, -73.567, 9), ...at(45.65, -73.8, 1)]);
  assert.equal(noisy.spots.length, 1);
});

test('filtre carte : tranche horaire et jour de la semaine', () => {
  const rides = [...at(45.5, -73.5, 4), ride('2026-10-24T01:15:00Z', 45.6, -73.7)]; // 4 mercredis matin + 1 vendredi soir (heure locale)
  assert.equal(locatedRides(rides).length, 5);
  assert.equal(locatedRides(rides, { slotId: 'matin' }).length, 4);
  assert.equal(locatedRides(rides, { slotId: 'matin', day: 3 }).length, 4);
  assert.equal(locatedRides(rides, { slotId: 'matin', day: 1 }).length, 0);
  assert.equal(locatedRides(rides, { slotId: 'soir' }).length, 1);
});
