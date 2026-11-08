// Migration n8n → SQLite local : « node server/migrate-local.mjs [--dry-run] [--emails a@x.com,b@y.com] ».
// Copie courses, assignations, compagnies, adhésions et comptes. Idempotente (relançable sans doublon) et sans aucune
// écriture ni suppression dans n8n. Les sessions et jetons en cours ne sont pas migrés : chacun se reconnecte une fois.
// n8n n'offre pas de liste des comptes : on retrouve les adresses via les courses, assignations, adhésions, ADMIN_EMAILS
// et --emails (comptes sans aucune activité).
import { pathToFileURL } from 'node:url';
import { openRideStore } from './sqlite.mjs';
import { openLocalDb } from './local.mjs';
import { createN8nClient, createServicesProvider, createAssignmentsProvider, createCompaniesProvider } from './providers/n8n.mjs';
import { createN8nStore, normalizeEmail } from './store.mjs';

export async function migrate({ client, env = process.env, db, rideStore, extraEmails = [], dryRun = false }) {
 const rides = await createServicesProvider(client).list({ role: 'admin', email: 'migration' });
 const assignments = await createAssignmentsProvider(client).list({ role: 'admin', email: 'migration' });
 const companyApi = createCompaniesProvider(client);
 const companies = await companyApi.companies();
 const memberships = await companyApi.memberships();

 const emails = new Set([...rides, ...assignments, ...memberships].map(r => normalizeEmail(r.driver_email || '')).filter(Boolean));
 for(const e of String(env.ADMIN_EMAILS || '').split(',').concat(extraEmails)) if(normalizeEmail(e)) emails.add(normalizeEmail(e));
 const n8nStore = createN8nStore(client, env);
 const accounts = new Map();
 const missing = [];
 for(const email of emails) {
  const acc = await n8nStore.accounts.get(email);
  if(acc) accounts.set(acc.id, acc); else missing.push(email);
 }

 const result = { rides: rides.length, assignments: assignments.length, companies: companies.length, memberships: memberships.length,
  accounts: accounts.size, emailsWithoutAccount: missing, dryRun };
 if(dryRun) return result;

 rideStore.upsertMany(rides);
 db.exec('BEGIN');
 try {
  const a = db.prepare('INSERT OR REPLACE INTO assignments (assignment_id, driver_email, type, date, description, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for(const r of assignments) a.run(String(r.assignment_id ?? r.id), r.driver_email, String(r.type ?? ''), String(r.date), String(r.description ?? ''), String(r.created_at ?? ''));
  const c = db.prepare('INSERT OR REPLACE INTO companies (company_id, name, active, created_at) VALUES (?, ?, ?, ?)');
  for(const r of companies) c.run(r.company_id, r.name, r.active === true || r.active === 'true' ? 1 : 0, String(r.created_at ?? ''));
  const m = db.prepare('INSERT OR REPLACE INTO memberships (driver_email, company_id, status, share, requested_at, decided_at) VALUES (?, ?, ?, ?, ?, ?)');
  for(const r of memberships) m.run(normalizeEmail(r.driver_email), String(r.company_id ?? ''), String(r.status ?? 'none'), r.share === true || r.share === 'true' ? 1 : 0, String(r.requested_at ?? ''), String(r.decided_at ?? ''));
  // Comptes déjà connus de n8n : n8n_synced = 1 (le workflow d'envoi les retrouve par identifiant).
  const u = db.prepare(`INSERT OR REPLACE INTO accounts (account_id, username, email, display_name, salt, password_hash, role, verified, auth_version, n8n_synced, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`);
  for(const x of accounts.values()) u.run(x.id, x.username || x.email, x.email, x.name, x.salt, x.passwordHash, x.role, x.verified ? 1 : 0, x.authVersion, new Date().toISOString());
  db.exec('COMMIT');
 } catch(error) { db.exec('ROLLBACK'); throw error; }
 return result;
}

export async function run(env = process.env, argv = process.argv.slice(2), fetcher = fetch) {
 if(!env.SQLITE_PATH) throw new Error('SQLITE_PATH non défini.');
 const dryRun = argv.includes('--dry-run');
 const at = argv.indexOf('--emails');
 const extraEmails = at >= 0 ? String(argv[at + 1] || '').split(',') : [];
 const db = openLocalDb(env.SQLITE_PATH), rideStore = openRideStore(env.SQLITE_PATH);
 try {
  const r = await migrate({ client: createN8nClient(env, fetcher), env, db, rideStore, extraEmails, dryRun });
  console.log(`[local] ${dryRun ? 'SIMULATION' : 'migration'} : ${r.rides} courses, ${r.assignments} assignations, ${r.companies} compagnies, ${r.memberships} adhésions, ${r.accounts} comptes.`);
  if(r.emailsWithoutAccount.length) console.log(`[local] ${r.emailsWithoutAccount.length} adresse(s) vue(s) sans compte dans n8n (ignorées).`);
 } finally { db.close(); rideStore.close(); }
}

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 run().catch(error => { console.error(`[local] échec : ${error.message}`); process.exit(1); });
}
