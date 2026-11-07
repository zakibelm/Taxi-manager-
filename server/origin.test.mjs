import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceInput, origin } from './validation.mjs';
import { chatMessages } from './providers/openrouter.mjs';

const base = { type: 'Régulier', amount: 25, date: '2026-11-07T15:00:00.000Z', description: '' };

test('origine facultative : une course sans position reste valide et sans champ d’origine', () => {
  const v = serviceInput(base);
  assert.equal('origin_lat' in v, false);
  assert.equal('origin_lng' in v, false);
  assert.deepEqual(origin({ origin_lat: null, origin_lng: null }), {});
});

test('origine : arrondie à 3 décimales côté serveur, quoi qu’envoie le client', () => {
  const v = serviceInput({ ...base, origin_lat: 45.5521849, origin_lng: -73.5911234 });
  assert.equal(v.origin_lat, 45.552);
  assert.equal(v.origin_lng, -73.591);
});

test('origine invalide refusée : une seule coordonnée, hors plage, texte, NaN', () => {
  for (const bad of [{ origin_lat: 45.5 }, { origin_lng: -73.5 }, { origin_lat: 95, origin_lng: 0 }, { origin_lat: 0, origin_lng: 181 },
    { origin_lat: '45.5', origin_lng: '-73.5' }, { origin_lat: NaN, origin_lng: 1 }, { origin_lat: Infinity, origin_lng: 1 }])
    assert.throws(() => serviceInput({ ...base, ...bad }), /Origine invalide/);
  assert.throws(() => serviceInput({ ...base, origin_x: 1 }), /Champs invalides/);
});

test('assistant IA : reçoit les zones agrégées, jamais la position exacte ni la note', () => {
  const rows = [7, 14, 21, 28, 27].map(d => ({ type: 'Olymel', amount: 30, description: 'note privée', driver_email: 'a@example.test',
    date: `2026-10-${String(d).padStart(2, '0')}T13:15:00Z`, origin_lat: 45.552, origin_lng: -73.591 }));
  const messages = chatMessages('Où me placer ?', rows, new Date('2026-11-11T13:30:00Z'));
  const text = JSON.stringify(messages);
  assert.match(messages[1].content, /zonesAppel/);
  assert.match(messages[1].content, /45\.555/); // centre de zone
  for (const secret of ['45.552', '-73.591', 'note privée', 'a@example.test']) assert.equal(text.includes(secret), false, secret);
  assert.match(messages[0].content, /zonesAppel/);
});
