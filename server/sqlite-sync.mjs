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

/**
 * Fenêtre glissante dans n8n : retire de n8n les courses plus vieilles que `days` jours, mais seulement celles dont la copie
 * existe déjà dans SQLite (même identifiant, même date et même montant). Le reste est laissé en place.
 */
export async function purgeOldFromN8n({ source, store, days, now = new Date() }) {
 const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
 const rides = await source.list({ role: 'admin', email: 'purge' });
 let removed = 0, kept = 0;
 for(const r of rides) {
  if(!(r.date < cutoff)) continue;
  const copy = store.get(r.service_id ?? r.id);
  if(!copy || copy.date !== r.date || copy.amount !== Number(r.amount) || copy.driver_email !== r.driver_email) { kept++; continue; }
  await source.delete(r.service_id ?? r.id, r.driver_email);
  removed++;
 }
 return { removed, kept };
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
  // STORAGE=local : SQLite est la source de vérité. Ni rattrapage (il ferait réapparaître les courses supprimées) ni purge de n8n.
  const local = env.STORAGE === 'local';
  const source = local ? null : createServicesProvider(createN8nClient(env, fetcher));
  if(local) console.log('[sqlite] STORAGE=local : pas de rattrapage depuis n8n (SQLite est la source).');
  else {
   const sync = await syncRides({ source, store });
   console.log(`[sqlite] rattrapage : ${sync.seen} courses lues dans n8n, ${sync.copied} copiées, ${sync.total} au total.`);
  }
  let backedUp = false;
  if(env.SQLITE_BACKUP_DIR) {
   const b = backupRides({ store, dir: env.SQLITE_BACKUP_DIR, keep: Number(env.SQLITE_BACKUP_KEEP) || 14 });
   backedUp = true;
   console.log(`[sqlite] sauvegarde : ${b.file} (${b.removed} ancienne(s) supprimée(s)).`);
  } else console.warn('[sqlite] SQLITE_BACKUP_DIR non défini : aucune sauvegarde faite.');
  // Fenêtre glissante dans n8n (désactivée par défaut) : jamais sans sauvegarde du jour, jamais sans copie vérifiée.
  const days = Number(env.N8N_RETENTION_DAYS);
  if(!local && Number.isFinite(days) && days >= 7) {
   if(!backedUp) console.warn('[sqlite] N8N_RETENTION_DAYS ignoré : une sauvegarde (SQLITE_BACKUP_DIR) est requise avant toute purge.');
   else {
    const p = await purgeOldFromN8n({ source, store, days });
    console.log(`[sqlite] fenêtre n8n de ${days} jours : ${p.removed} course(s) retirée(s) de n8n, ${p.kept} conservée(s) faute de copie vérifiée.`);
   }
  }
 } finally { store.close(); }
}

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 run().catch(error => { console.error(`[sqlite] échec : ${error.message}`); process.exit(1); });
}
