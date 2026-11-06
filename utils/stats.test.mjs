import test from 'node:test';
import assert from 'node:assert/strict';
import { monthRange, weekRange, summarize, previousRange, variation, monthGrid, inRange } from './stats.ts';

const svc = (date, amount, type = 'A') => ({ id: date + amount, driver_email: 'a@b.c', type, amount, date: date + 'T12:00:00', created_at: '', updated_at: '' });

test('semaine courante : du lundi au dimanche', () => {
  assert.deepEqual(weekRange(new Date('2026-11-06T12:00:00')), { start: '2026-11-02', end: '2026-11-08' }); // vendredi
  assert.deepEqual(weekRange(new Date('2026-11-08T12:00:00')), { start: '2026-11-02', end: '2026-11-08' }); // dimanche
  assert.deepEqual(weekRange(new Date('2026-11-02T12:00:00')), { start: '2026-11-02', end: '2026-11-08' }); // lundi
});

test('analyse d\'une période : bornes incluses, totaux, meilleur jour, types', () => {
  const rows = [svc('2026-11-01', 100), svc('2026-11-02', 20, 'B'), svc('2026-11-04', 60), svc('2026-11-04', 30, 'B'), svc('2026-11-08', 10), svc('2026-11-09', 500)];
  const s = summarize(rows, '2026-11-02', '2026-11-08');
  assert.equal(s.count, 4); assert.equal(s.total, 120); assert.equal(s.average, 30);
  assert.deepEqual(s.best, { day: '2026-11-04', amount: 90 });
  assert.deepEqual(s.byType.map(t => t.type), ['A', 'B']);
  assert.equal(s.series.length, 7); assert.equal(s.series[2].amount, 90); assert.equal(s.series[1].amount, 0);
});

test('période vide, période longue par mois, période précédente et variation', () => {
  assert.equal(summarize([], '2026-11-02', '2026-11-08').best, null);
  const long = summarize([svc('2026-01-15', 10), svc('2026-03-02', 20)], '2026-01-01', '2026-12-31');
  assert.deepEqual(long.series.map(x => x.label), ['2026-01', '2026-03']);
  assert.deepEqual(previousRange('2026-11-02', '2026-11-08'), { start: '2026-10-26', end: '2026-11-01' });
  assert.equal(variation(150, 100), 50); assert.equal(variation(50, 0), null);
  assert.equal(inRange([svc('2026-11-02', 1)], '2026-11-03', '2026-11-04').length, 0);
});

test('grille du mois : lundi en premier, cases vides hors mois', () => {
  const g = monthGrid(2026, 10); // novembre 2026 : le 1er est un dimanche
  assert.equal(g[0][6], '2026-11-01'); assert.equal(g[0][0], null);
  assert.ok(g.every(w => w.length === 7)); assert.equal(g.flat().filter(Boolean).length, 30);
});

test('monthRange : du 1er au dernier jour du mois (février bissextile inclus)', () => {
  assert.deepEqual(monthRange(new Date(2026, 10, 6)), { start: '2026-11-01', end: '2026-11-30' });
  assert.deepEqual(monthRange(new Date(2028, 1, 15)), { start: '2028-02-01', end: '2028-02-29' });
});
