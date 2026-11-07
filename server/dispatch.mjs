import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Journal de répartition Fraxion lu par l'application DataTaxi (une ligne = un événement « véhicule X a reçu / pris »).
// Même fichier SQLite que les courses (SQLITE_PATH), mêmes conventions : clé primaire stable, upsert idempotent,
// colonnes created_at / updated_at. Les colonnes reprennent celles de l'export DataTaxi (Google Sheet) pour que l'import
// et l'envoi direct de l'application donnent exactement la même ligne. Aucune valeur inventée : champ inconnu = ''.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS dispatch_events (
 trip_id             TEXT PRIMARY KEY,
 trip_date           TEXT NOT NULL,
 trip_time           TEXT NOT NULL,
 observed_at         TEXT NOT NULL,
 departure_zone      TEXT NOT NULL DEFAULT '',
 departure_address   TEXT NOT NULL DEFAULT '',
 destination_zone    TEXT NOT NULL DEFAULT '',
 destination_address TEXT NOT NULL DEFAULT '',
 service_type        TEXT NOT NULL DEFAULT '',
 vehicle_id          TEXT NOT NULL DEFAULT '',
 current_status      TEXT NOT NULL DEFAULT '',
 confidence_score    REAL,
 raw_text            TEXT NOT NULL DEFAULT '',
 created_at          TEXT NOT NULL DEFAULT '',
 updated_at          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS dispatch_date ON dispatch_events (trip_date, trip_time);
CREATE INDEX IF NOT EXISTS dispatch_zone ON dispatch_events (departure_zone, trip_date);
`;

const FIELDS = ['trip_id', 'trip_date', 'trip_time', 'observed_at', 'departure_zone', 'departure_address', 'destination_zone',
 'destination_address', 'service_type', 'vehicle_id', 'current_status', 'confidence_score', 'raw_text'];
const ID = /^[a-f0-9]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}:\d{2}$/;
const ZONE = /^\d{1,3}$/;
const str = (v, max) => { const s = v == null ? '' : String(v).trim(); if(s.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) throw new Error('champ'); return s; };

/** Valide une ligne DataTaxi et la met en forme ; lève une erreur si elle est invalide (jamais de correction silencieuse). */
export function dispatchRow(input) {
 if(!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('ligne');
 const r = {};
 for(const f of FIELDS) r[f] = f === 'raw_text' ? str(input[f], 500) : str(input[f], 100);
 if(!ID.test(r.trip_id) || !DATE.test(r.trip_date) || !TIME.test(r.trip_time)) throw new Error('identité');
 // L'application écrit « 2026-10-17T16:40:57 », le Google Sheet « 2026-10-17 16:40:57 » : même instant, une seule forme stockée.
 if(![`${r.trip_date}T${r.trip_time}`, `${r.trip_date} ${r.trip_time}`].includes(r.observed_at)) throw new Error('observed_at');
 r.observed_at = `${r.trip_date}T${r.trip_time}`;
 if(Number.isNaN(Date.parse(`${r.trip_date}T${r.trip_time}Z`))) throw new Error('date');
 for(const z of ['departure_zone', 'destination_zone']) if(r[z] && !ZONE.test(r[z])) throw new Error('zone');
 if(r.vehicle_id && !/^\d{1,6}$/.test(r.vehicle_id)) throw new Error('véhicule');
 const c = r.confidence_score === '' ? null : Number(r.confidence_score);
 if(c !== null && !(Number.isFinite(c) && c >= 0 && c <= 1)) throw new Error('confiance');
 return { ...r, confidence_score: c };
}

export function openDispatchStore(file = ':memory:') {
 if(file !== ':memory:') {
  const dir = path.dirname(file);
  if(!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
 }
 const db = new DatabaseSync(file);
 db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
 db.exec(SCHEMA);
 if(file !== ':memory:') { try { chmodSync(file, 0o600); } catch { /* best effort */ } }
 let version = 0;
 const upsert = db.prepare(`INSERT INTO dispatch_events (${FIELDS.join(', ')}, created_at, updated_at)
  VALUES (${FIELDS.map(f => ':' + f).join(', ')}, :now, :now)
  ON CONFLICT(trip_id) DO UPDATE SET ${FIELDS.filter(f => f !== 'trip_id').map(f => `${f}=excluded.${f}`).join(', ')}, updated_at=excluded.updated_at`);
 const one = db.prepare('SELECT * FROM dispatch_events WHERE trip_id = ?');
 const count = db.prepare('SELECT COUNT(*) AS n FROM dispatch_events');
 const since = db.prepare('SELECT * FROM dispatch_events WHERE trip_date >= ? ORDER BY trip_date, trip_time');
 return {
  get version() { return version; },
  /** Copie en bloc dans une transaction ; rejoue sans doublon (clé = trip_id). Renvoie le nombre de lignes écrites. */
  upsertMany(rows, now = new Date().toISOString()) {
   db.exec('BEGIN');
   try { for(const r of rows) upsert.run({ ...r, now }); db.exec('COMMIT'); } catch(e) { db.exec('ROLLBACK'); throw e; }
   version++;
   return rows.length;
  },
  get: id => one.get(id) ?? null,
  count: () => count.get().n,
  listSince: date => since.all(date),
  close() { db.close(); }
 };
}
