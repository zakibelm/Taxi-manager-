// Zones d'appel : analyse des courses dont le chauffeur a enregistré l'origine (case « Localiser l'appel »).
// Même code pour l'application (tableau de bord) et le serveur (contexte de l'assistant IA).
// Aucune donnée n'est inventée : la recommandation est un calcul sur l'historique, l'IA ne fait que l'expliquer.

/** Fuseau d'affichage : l'application vise le Québec ; le serveur (UTC) et le téléphone donnent ainsi les mêmes tranches. */
export const ZONE_TIMEZONE = 'America/Toronto';
/** Taille d'une zone : 0,01° (≈ 1,1 km de haut sur ≈ 0,8 km de large à Montréal). */
export const ZONE_STEP = 0.01;
/** Nombre minimal de courses localisées avant de recommander quoi que ce soit. */
export const MIN_LOCATED = 5;
/** Nombre minimal de courses localisées dans le créneau pour s'appuyer sur lui (sinon on élargit). */
export const MIN_SLOT = 3;

export const SLOTS = [
  { id: 'nuit', label: 'Nuit (0 h – 5 h)', from: 0, to: 5 },
  { id: 'matin', label: 'Matin (5 h – 10 h)', from: 5, to: 10 },
  { id: 'midi', label: 'Midi (10 h – 15 h)', from: 10, to: 15 },
  { id: 'fin-apres-midi', label: 'Fin d’après-midi (15 h – 19 h)', from: 15, to: 19 },
  { id: 'soir', label: 'Soir (19 h – 24 h)', from: 19, to: 24 },
];
export const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE_TIMEZONE, weekday: 'short', hour: '2-digit', hourCycle: 'h23' });

/** Jour de la semaine (0 = dimanche) et heure (0–23) à l'heure du Québec. */
export function localParts(value) {
  const t = value instanceof Date ? value : new Date(value);
  const parts = Object.fromEntries(formatter.formatToParts(t).map(p => [p.type, p.value]));
  return { day: WEEKDAY[parts.weekday], hour: Number(parts.hour) % 24 };
}

export const slotOf = hour => SLOTS.find(s => hour >= s.from && hour < s.to) ?? SLOTS[0];

const round = (n, d) => { const f = 10 ** d; return Math.round(n * f) / f; };

/** Origine valide : deux nombres dans les plages de la Terre. */
export const hasOrigin = s => Number.isFinite(s?.origin_lat) && Number.isFinite(s?.origin_lng) && Math.abs(s.origin_lat) <= 90 && Math.abs(s.origin_lng) <= 180;

/** Zone (case de 0,01°) d'un point : identifiant et centre. */
export function zoneOf(lat, lng) {
  const i = Math.floor(lat / ZONE_STEP + 1e-9), j = Math.floor(lng / ZONE_STEP + 1e-9);
  return { id: `${i}:${j}`, lat: round((i + 0.5) * ZONE_STEP, 3), lng: round((j + 0.5) * ZONE_STEP, 3) };
}

function rank(rows, k) {
  const zones = new Map();
  for (const s of rows) {
    const z = zoneOf(s.origin_lat, s.origin_lng);
    const v = zones.get(z.id) ?? { zone: z, count: 0, amount: 0, types: new Map() };
    v.count++; v.amount += s.amount; v.types.set(s.type, (v.types.get(s.type) ?? 0) + 1);
    zones.set(z.id, v);
  }
  return [...zones.values()]
    .sort((a, b) => b.count - a.count || b.amount - a.amount)
    .slice(0, k)
    .map(v => {
      const [topType, topCount] = [...v.types].sort((a, b) => b[1] - a[1])[0];
      return {
        zone: v.zone.id, lat: v.zone.lat, lng: v.zone.lng,
        count: v.count, share: round(v.count / rows.length, 2),
        averageAmount: round(v.amount / v.count, 2),
        topType, topTypeShare: round(topCount / v.count, 2),
      };
    });
}

/**
 * Zones d'appel les plus probables pour un moment donné.
 * Base la plus précise d'abord (même jour de la semaine ET même tranche horaire), puis la tranche seule,
 * puis tout l'historique localisé. `basis` dit laquelle a servi ; `sample` combien de courses la composent.
 * @param {Array<{type:string, amount:number, date:string, origin_lat?:number, origin_lng?:number}>} services
 * @param {Date} [now]
 * @param {number} [k] nombre de zones renvoyées
 */
export function recommendZones(services, now = new Date(), k = 3) {
  const located = services.filter(s => hasOrigin(s) && Number.isFinite(s.amount) && s.amount > 0 && Number.isFinite(Date.parse(s.date)));
  const here = localParts(now), slot = slotOf(here.hour);
  const base = { day: DAYS[here.day], slot: slot.label, located: located.length };
  if (located.length < MIN_LOCATED) return { ...base, status: 'insufficient', needed: MIN_LOCATED, basis: null, sample: 0, zones: [] };
  const withParts = located.map(s => ({ s, p: localParts(s.date) }));
  const sameSlot = withParts.filter(x => slotOf(x.p.hour).id === slot.id);
  const sameDaySlot = sameSlot.filter(x => x.p.day === here.day);
  let basis = 'all', pool = located;
  if (sameDaySlot.length >= MIN_SLOT) { basis = 'day-slot'; pool = sameDaySlot.map(x => x.s); }
  else if (sameSlot.length >= MIN_SLOT) { basis = 'slot'; pool = sameSlot.map(x => x.s); }
  return { ...base, status: 'ok', basis, sample: pool.length, zones: rank(pool, k) };
}

/** Texte lisible de la base de calcul. */
export const basisLabel = (r) => r.basis === 'day-slot' ? `les ${r.day}s, ${r.slot.toLowerCase()}`
  : r.basis === 'slot' ? `${r.slot.toLowerCase()}, tous les jours`
  : 'tout l’historique localisé';

/** Résumé agrégé pour l'assistant IA : zones probables maintenant + les zones les plus actives par tranche horaire.
 *  Jamais de coordonnée précise de course, de courriel ni de note : seulement des centres de zone de ≈ 1 km. */
export function zoneDigest(services, now = new Date()) {
  const now_ = recommendZones(services, now, 3);
  if (now_.status !== 'ok') return { localisees: now_.located, statut: 'pas assez de courses localisées', minimum: MIN_LOCATED };
  const located = services.filter(s => hasOrigin(s) && Number.isFinite(s.amount) && s.amount > 0 && Number.isFinite(Date.parse(s.date)));
  const parTranche = {};
  for (const slot of SLOTS) {
    const pool = located.filter(s => slotOf(localParts(s.date).hour).id === slot.id);
    if (pool.length >= MIN_SLOT) parTranche[slot.label] = rank(pool, 2).map(z => ({ zone_centre: [z.lat, z.lng], courses: z.count, montant_moyen: z.averageAmount, type_dominant: z.topType }));
  }
  return {
    localisees: now_.located,
    maintenant: { jour: now_.day, tranche: now_.slot, base: basisLabel(now_), echantillon: now_.sample,
      zones: now_.zones.map(z => ({ zone_centre: [z.lat, z.lng], courses: z.count, part: z.share, montant_moyen: z.averageAmount, type_dominant: z.topType })) },
    parTranche,
  };
}
