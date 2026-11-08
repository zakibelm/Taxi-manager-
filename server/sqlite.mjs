import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Copie des courses sur le VPS (SQLite) : sert aux prévisions de compagnie, à la carte et à l'historique long.
// n8n reste le chemin d'écriture principal ; ici, chaque écriture est idempotente (clé = service_id).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS rides (
 service_id   TEXT PRIMARY KEY,
 driver_email TEXT NOT NULL,
 type         TEXT NOT NULL DEFAULT '',
 amount       REAL NOT NULL DEFAULT 0,
 date         TEXT NOT NULL,
 description  TEXT NOT NULL DEFAULT '',
 origin_lat   REAL,
 origin_lng   REAL,
 created_at   TEXT NOT NULL DEFAULT '',
 updated_at   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS rides_driver_date ON rides (driver_email, date);
CREATE INDEX IF NOT EXISTS rides_date ON rides (date);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const num = v => (Number.isFinite(Number(v)) && v !== null && v !== '' && v !== undefined ? Number(v) : null);
const toRow = s => ({
 service_id: String(s.service_id ?? s.id),
 driver_email: String(s.driver_email),
 type: String(s.type ?? ''),
 amount: Number(s.amount) || 0,
 date: String(s.date),
 description: String(s.description ?? ''),
 origin_lat: num(s.origin_lat),
 origin_lng: num(s.origin_lng),
 created_at: String(s.created_at ?? ''),
 updated_at: String(s.updated_at ?? '')
});
const fromRow = r => ({ ...r, id: r.service_id });

/** @param {string} file chemin du fichier, ou ':memory:' */
export function openRideStore(file = ':memory:') {
 if(file !== ':memory:') {
  const dir = path.dirname(file);
  if(!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
 }
 const db = new DatabaseSync(file);
 db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
 db.exec(SCHEMA);
 if(file !== ':memory:') { try { chmodSync(file, 0o600); } catch { /* best effort */ } }
 let version = 0;   // incrémenté à chaque écriture : invalide les caches de calcul
 const upsert = db.prepare(`INSERT INTO rides (service_id, driver_email, type, amount, date, description, origin_lat, origin_lng, created_at, updated_at)
  VALUES (:service_id, :driver_email, :type, :amount, :date, :description, :origin_lat, :origin_lng, :created_at, :updated_at)
  ON CONFLICT(service_id) DO UPDATE SET type=excluded.type, amount=excluded.amount, date=excluded.date,
   description=excluded.description, origin_lat=excluded.origin_lat, origin_lng=excluded.origin_lng, updated_at=excluded.updated_at
   WHERE rides.driver_email = excluded.driver_email`);   // le propriétaire d'une course ne change jamais
 const removeOne = db.prepare('DELETE FROM rides WHERE service_id = ? AND driver_email = ?');
 const removeDriver = db.prepare('DELETE FROM rides WHERE driver_email = ?');
 const byDriver = db.prepare('SELECT * FROM rides WHERE driver_email = ? ORDER BY date DESC');
 const one = db.prepare('SELECT * FROM rides WHERE service_id = ?');
 const all = db.prepare('SELECT * FROM rides ORDER BY date DESC');
 const since = db.prepare('SELECT * FROM rides WHERE date >= ? ORDER BY date DESC');
 const count = db.prepare('SELECT COUNT(*) AS n FROM rides');
 const ids = db.prepare('SELECT service_id FROM rides');
 const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
 const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
 return {
  get version() { return version; },
  /** Insère ou met à jour. Retourne false (rien modifié) si l'identifiant appartient déjà à un autre chauffeur. */
  upsert(ride) { const r = upsert.run(toRow(ride)); version++; return r.changes > 0; },
  /** Copie en bloc dans une transaction (rattrapage, copie de l'historique). */
  upsertMany(rides) {
   db.exec('BEGIN');
   try { for(const r of rides) upsert.run(toRow(r)); db.exec('COMMIT'); } catch(e) { db.exec('ROLLBACK'); throw e; }
   version++;
   return rides.length;
  },
  remove(serviceId, driverEmail) { const r = removeOne.run(serviceId, driverEmail); version++; return r.changes; },
  /** Effacement de toutes les courses d'un chauffeur (suppression de compte). */
  removeDriver(driverEmail) { const r = removeDriver.run(driverEmail); version++; return r.changes; },
  get: id => { const r = one.get(id); return r ? fromRow(r) : null; },
  listByDriver: email => byDriver.all(email).map(fromRow),
  listAll: () => all.all().map(fromRow),
  listSince: iso => since.all(iso).map(fromRow),
  /** Courses d'un ensemble de chauffeurs (pool d'une compagnie). */
  listByDrivers(emails) {
   const list = [...emails];
   if(!list.length) return [];
   const out = [];
   for(let i = 0; i < list.length; i += 500) {   // limite de paramètres SQLite
    const chunk = list.slice(i, i + 500);
    out.push(...db.prepare(`SELECT * FROM rides WHERE driver_email IN (${chunk.map(() => '?').join(',')})`).all(...chunk).map(fromRow));
   }
   return out;
  },
  count: () => count.get().n,
  serviceIds: () => new Set(ids.all().map(r => r.service_id)),
  setMeta(key, value) { setMeta.run(key, String(value)); },
  getMeta(key) { return getMeta.get(key)?.value ?? null; },
  /** Sauvegarde cohérente à chaud (VACUUM INTO). Le fichier cible ne doit pas exister. */
  backupTo(target) {
   const dir = path.dirname(target);
   if(!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
   db.prepare('VACUUM INTO ?').run(target);
   try { chmodSync(target, 0o600); } catch { /* best effort */ }
  },
  close() { db.close(); }
 };
}
