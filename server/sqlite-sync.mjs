// Entretien de la copie SQLite : « node server/sqlite-sync.mjs » (cron/systemd, une fois par jour).
//   1. rattrapage : copie dans SQLite toute course de n8n absente ou modifiée (couvre aussi la première copie de l'historique) ;
//   2. sauvegarde : fichier daté (VACUUM INTO) dans SQLITE_BACKUP_DIR, les SQLITE_BACKUP_KEEP derniers sont conservés.
// Les sessions expirées sont déjà purgées chaque heure par les workflows n8n. Aucune course n'est jamais retirée de SQLite
// parce qu'elle a disparu de n8n : la copie sert justement à garder l'historique.
import { readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openRideStore } from './sqlite.mjs';
import { createN8nClient, createServicesProvider } from './providers/n8n.mjs';

const BACKUP_NAME = /^rides-\d{8}\.db$/;

export async function syncRides({ source, store, batch = 500 }) {
 const rides = await source.list({ role: 'admin', email: 'sync' });
 const known = new Map(store.listAll().map(r => [r.service_id, r]));
 const changed = rides.filter(r => {
  const id = r.service_id ?? r.id;
  const have = known.get(id);
  return !have || have.updated_at !== String(r.updated_at ?? '') || have.amount !== Number(r.amount) || have.date !== r.date
   || have.origin_lat !== (Number.isFinite(Number(r.origin_lat)) && r.origin_lat !== '' && r.origin_lat != null ? Number(r.origin_lat) : null);
 });
 for(let i = 0; i < changed.length; i += batch) store.upsertMany(changed.slice(i, i + batch));
 store.setMeta('last_sync', new Date().toISOString());
 return { seen: rides.length, copied: changed.length, total: store.count() };
}

export function backupRides({ store, dir, keep = 14, now = new Date() }) {
 const stamp = now.toISOString().slice(0, 10).replaceAll('-', '');
 const file = path.join(dir, `rides-${stamp}.db`);
 try { unlinkSync(file); } catch { /* absent */ }   // une relance le même jour remplace la sauvegarde
 store.backupTo(file);
 const old = readdirSync(dir).filter(f => BACKUP_NAME.test(f)).sort().slice(0, -Math.max(1, keep));
 for(const f of old) unlinkSync(path.join(dir, f));
 store.setMeta('last_backup', now.toISOString());
 return { file, removed: old.length };
}

export async function run(env = process.env, fetcher = fetch) {
 if(!env.SQLITE_PATH) throw new Error('SQLITE_PATH non défini.');
 const store = openRideStore(env.SQLITE_PATH);
 try {
  const sync = await syncRides({ source: createServicesProvider(createN8nClient(env, fetcher)), store });
  console.log(`[sqlite] rattrapage : ${sync.seen} courses lues dans n8n, ${sync.copied} copiées, ${sync.total} au total.`);
  if(env.SQLITE_BACKUP_DIR) {
   const b = backupRides({ store, dir: env.SQLITE_BACKUP_DIR, keep: Number(env.SQLITE_BACKUP_KEEP) || 14 });
   console.log(`[sqlite] sauvegarde : ${b.file} (${b.removed} ancienne(s) supprimée(s)).`);
  } else console.warn('[sqlite] SQLITE_BACKUP_DIR non défini : aucune sauvegarde faite.');
 } finally { store.close(); }
}

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 run().catch(error => { console.error(`[sqlite] échec : ${error.message}`); process.exit(1); });
}
