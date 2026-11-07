import type { Service } from '../types';

/** Clé de jour locale AAAA-MM-JJ (même convention que formatDate). */
export const dayKey = (value: string | Date): string => new Date(value).toLocaleDateString('fr-CA');

const addDays = (key: string, n: number): string => {
  const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() + n); return dayKey(d);
};

/** Semaine courante, du lundi au dimanche. */
export function weekRange(today: Date = new Date()): { start: string; end: string } {
  const d = new Date(today); d.setHours(12, 0, 0, 0);
  const sinceMonday = (d.getDay() + 6) % 7;
  const start = dayKey(new Date(d.getTime() - sinceMonday * 86400000));
  return { start, end: addDays(start, 6) };
}

/** Mois courant, du 1er au dernier jour. */
export function monthRange(today: Date = new Date()): { start: string; end: string } {
  const y = today.getFullYear(), m = today.getMonth();
  return { start: dayKey(new Date(y, m, 1, 12)), end: dayKey(new Date(y, m + 1, 0, 12)) };
}

export const inRange = (rows: Service[], start: string, end: string): Service[] =>
  rows.filter(s => { const k = dayKey(s.date); return k >= start && k <= end; });

/** Taux du Québec et frais SEV par course (Revenu Québec). Un seul endroit à modifier si les taux changent. */
export const TAX_RATES = { tps: 0.05, tvq: 0.09975, sevPerRide: 0.99 };

export interface TaxSummary { tps: number; tvq: number; sev: number; totalDue: number; net: number }

const cents = (n: number) => Math.round(n * 100) / 100;

/** Cumul TPS, TVQ et SEV : les montants saisis sont taxes incluses (ce que paie le client),
 *  la TPS et la TVQ en sont donc extraites ; le SEV vaut 0,99 $ par course. */
export function taxSummary(totalTaxesIncluded: number, rides: number, rates = TAX_RATES): TaxSummary {
  const base = totalTaxesIncluded / (1 + rates.tps + rates.tvq);
  const tps = cents(base * rates.tps), tvq = cents(base * rates.tvq), sev = cents(rides * rates.sevPerRide);
  const totalDue = cents(tps + tvq + sev);
  return { tps, tvq, sev, totalDue, net: cents(totalTaxesIncluded - totalDue) };
}

export interface Summary {
  total: number; count: number; average: number;
  best: { day: string; amount: number } | null;
  byType: { type: string; count: number; amount: number }[];
  series: { label: string; amount: number; count: number }[];
  taxes: TaxSummary;
}

const daysBetween = (start: string, end: string): number =>
  Math.round((new Date(end + 'T12:00:00').getTime() - new Date(start + 'T12:00:00').getTime()) / 86400000) + 1;

/** Analyse d'une période : totaux, meilleur jour, répartition par type, série par jour (ou par mois au-delà de 92 jours). */
export function summarize(rows: Service[], start: string, end: string): Summary {
  const inside = inRange(rows, start, end);
  const total = Math.round(inside.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const perDay = new Map<string, { amount: number; count: number }>();
  for (const r of inside) { const k = dayKey(r.date); const v = perDay.get(k) ?? { amount: 0, count: 0 }; v.amount += r.amount; v.count++; perDay.set(k, v); }
  let best: Summary['best'] = null;
  for (const [day, v] of perDay) if (!best || v.amount > best.amount) best = { day, amount: Math.round(v.amount * 100) / 100 };
  const types = new Map<string, { count: number; amount: number }>();
  for (const r of inside) { const v = types.get(r.type) ?? { count: 0, amount: 0 }; v.count++; v.amount += r.amount; types.set(r.type, v); }
  const byType = [...types].map(([type, v]) => ({ type, count: v.count, amount: Math.round(v.amount * 100) / 100 })).sort((a, b) => b.amount - a.amount);
  const series: Summary['series'] = [];
  const span = daysBetween(start, end);
  if (span <= 92) {
    for (let i = 0; i < span; i++) { const k = addDays(start, i); const v = perDay.get(k); series.push({ label: k.slice(5), amount: Math.round((v?.amount ?? 0) * 100) / 100, count: v?.count ?? 0 }); }
  } else {
    const perMonth = new Map<string, { amount: number; count: number }>();
    for (const [k, v] of perDay) { const m = k.slice(0, 7); const x = perMonth.get(m) ?? { amount: 0, count: 0 }; x.amount += v.amount; x.count += v.count; perMonth.set(m, x); }
    for (const m of [...perMonth.keys()].sort()) { const x = perMonth.get(m)!; series.push({ label: m, amount: Math.round(x.amount * 100) / 100, count: x.count }); }
  }
  return { taxes: taxSummary(total, inside.length), total, count: inside.length, average: inside.length ? Math.round((total / inside.length) * 100) / 100 : 0, best, byType, series };
}

/** Période précédente de même durée, immédiatement avant `start`. */
export function previousRange(start: string, end: string): { start: string; end: string } {
  const span = daysBetween(start, end);
  return { start: addDays(start, -span), end: addDays(start, -1) };
}

/** Variation en % par rapport à la période précédente ; null si rien à comparer. */
export function variation(current: number, previous: number): number | null {
  return previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
}

/** Grille d'un mois, semaines du lundi au dimanche ; null pour les cases hors mois. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1, 12), last = new Date(year, month + 1, 0, 12);
  const cells: (string | null)[] = Array((first.getDay() + 6) % 7).fill(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(dayKey(new Date(year, month, d, 12)));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
