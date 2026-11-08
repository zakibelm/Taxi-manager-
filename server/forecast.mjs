import { HttpError, reply, sameOrigin } from './http.mjs';

// Prévisions de demande tirées du journal de répartition (table dispatch_events, alimentée par DataTaxi).
//   GET /api/forecast -> volume d'appels attendu pour les 7 prochains jours, profil horaire, heures de pointe, zones par plage.
// Méthode : médiane des journées complètes du même type (semaine / fin de semaine). Sur l'historique réel (18 jours),
// elle se trompe moins (25 % en validation « un jour laissé de côté ») que la moyenne par jour de la semaine (38 %), trop rare
// pour être fiable. L'erreur est recalculée à chaque requête et renvoyée : la fiabilité affichée est celle des données du moment.
// Seuls des agrégats sortent (aucun véhicule, aucun texte brut, aucune adresse) ; la journée en cours est exclue (incomplète).
export const SLOTS = [['0-6', 0, 6], ['6-10', 6, 10], ['10-14', 10, 14], ['14-18', 14, 18], ['18-24', 18, 24]];
export const MIN_DAYS = 7;
const HORIZON = 7;

const isWeekend = dow => dow === 0 || dow === 6;
const dowOf = date => new Date(`${date}T12:00:00Z`).getUTCDay();
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
function quantile(a, q) {
 const s = [...a].sort((x, y) => x - y), p = (s.length - 1) * q, i = Math.floor(p);
 return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (p - i);
}
/** Date locale (AAAA-MM-JJ) de `now` dans le fuseau de l'application. */
export function localDate(now, timeZone = 'America/Toronto') {
 return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Fonction pure : lignes de dispatch -> prévision. `today` = date locale du jour (AAAA-MM-JJ). */
export function buildForecast(rows, today) {
 const perDay = new Map();
 for(const r of rows) {
  if(r.trip_date >= today) continue; // journée en cours ou future : incomplète
  const d = perDay.get(r.trip_date) ?? { n: 0, hours: new Array(24).fill(0), zones: [new Map(), new Map(), new Map(), new Map(), new Map()] };
  const h = Number(r.trip_time.slice(0, 2));
  d.n++; d.hours[h]++;
  const z = r.departure_zone;
  if(z) { const si = SLOTS.findIndex(([, lo, hi]) => h >= lo && h < hi); d.zones[si].set(z, (d.zones[si].get(z) ?? 0) + 1); }
  perDay.set(r.trip_date, d);
 }
 const dates = [...perDay.keys()].sort();
 const group = we => dates.filter(d => isWeekend(dowOf(d)) === we);
 const weekdays = group(false), weekends = group(true);
 if(dates.length < MIN_DAYS || !weekdays.length || !weekends.length) {
  return { ready: false, days: dates.length, needed: MIN_DAYS, asOf: dates.at(-1) ?? null };
 }
 const counts = d => perDay.get(d).n;
 // Fiabilité : on prédit chaque journée par la médiane des autres journées du même type, puis on mesure l'écart relatif moyen.
 const errors = [];
 for(const d of dates) {
  const peers = group(isWeekend(dowOf(d))).filter(x => x !== d);
  if(peers.length && counts(d) > 0) errors.push(Math.abs(median(peers.map(counts)) - counts(d)) / counts(d));
 }
 const errorPct = errors.length ? Math.round(100 * mean(errors)) : null;
 const level = dates.length < 14 || errorPct === null ? 'faible' : errorPct <= 15 ? 'bonne' : errorPct <= 30 ? 'moyenne' : 'faible';
 const typeStats = we => {
  const v = (we ? weekends : weekdays).map(counts);
  const few = v.length < 4; // quartiles trop instables : plage observée
  return { expected: Math.round(median(v)), low: Math.round(few ? Math.min(...v) : quantile(v, 0.25)), high: Math.round(few ? Math.max(...v) : quantile(v, 0.75)), days: v.length };
 };
 const stats = { weekday: typeStats(false), weekend: typeStats(true) };
 const profile = we => {
  const ds = we ? weekends : weekdays;
  return Array.from({ length: 24 }, (_, h) => Math.round(10 * mean(ds.map(d => perDay.get(d).hours[h]))) / 10);
 };
 const hourly = { weekday: profile(false), weekend: profile(true) };
 const peaks = k => hourly[k].map((v, h) => [h, v]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3).map(([h]) => h).sort((a, b) => a - b);
 const zonesFor = we => {
  const ds = we ? weekends : weekdays, out = {};
  SLOTS.forEach(([key], si) => {
   const tot = new Map();
   for(const d of ds) for(const [z, n] of perDay.get(d).zones[si]) tot.set(z, (tot.get(z) ?? 0) + n);
   const sum = [...tot.values()].reduce((a, b) => a + b, 0);
   out[key] = [...tot].sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0])).slice(0, 4).map(([zone, n]) => ({ zone, share: Math.round(100 * n / sum) }));
  });
  return out;
 };
 const daily = Array.from({ length: HORIZON }, (_, i) => {
  const date = addDays(today, i + 1), dow = dowOf(date), t = stats[isWeekend(dow) ? 'weekend' : 'weekday'];
  return { date, dow, type: isWeekend(dow) ? 'weekend' : 'weekday', expected: t.expected, low: t.low, high: t.high };
 });
 return {
  ready: true, asOf: dates.at(-1), days: dates.length, events: dates.reduce((a, d) => a + counts(d), 0),
  method: 'median-by-day-type', reliability: { errorPct, level }, stats, daily, hourly,
  peaks: { weekday: peaks('weekday'), weekend: peaks('weekend') },
  zones: { weekday: zonesFor(false), weekend: zonesFor(true) }
 };
}

export function createForecastMiddleware({ getUser, store, env = process.env, now = () => new Date() }) {
 let cache = { key: '', value: null };
 return async (req, res, next) => {
  const url = new URL(req.url, 'http://local');
  if(url.pathname !== '/api/forecast') return next();
  try {
   const user = await getUser(req);
   if(!user) throw new HttpError(401, 'Connexion requise.');
   if(url.search) throw new HttpError(400, 'Paramètres non autorisés.');
   sameOrigin(req);
   if(req.method !== 'GET') throw new HttpError(405, 'Méthode non autorisée.');
   const today = localDate(now(), env.APP_TIMEZONE || 'America/Toronto');
   const key = `${today}:${store.version}:${store.count()}`; // recalcul seulement si le jour ou les données ont changé
   if(cache.key !== key) cache = { key, value: buildForecast(store.listSince('0000-00-00'), today) };
   return reply(res, 200, cache.value);
  } catch(error) { reply(res, error.status || 500, error.status ? { error: error.message } : { error: 'Erreur interne.' }); }
 };
}
