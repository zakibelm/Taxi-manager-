import { createHmac, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normalizeEmail } from './store.mjs';

// Stockage 100 % local (STORAGE=local) : comptes, jetons, sessions, tentatives de connexion, assignations, compagnies et
// adhésions vivent dans le même fichier SQLite que les courses (SQLITE_PATH). Mêmes interfaces que createN8nStore et que
// les fournisseurs n8n : le reste du serveur ne voit aucune différence. n8n ne sert plus qu'à envoyer les courriels.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
 account_id    TEXT PRIMARY KEY,
 username      TEXT NOT NULL,
 email         TEXT NOT NULL,
 display_name  TEXT NOT NULL DEFAULT '',
 salt          TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 role          TEXT NOT NULL DEFAULT 'chauffeur',
 verified      INTEGER NOT NULL DEFAULT 0,
 auth_version  TEXT NOT NULL,
 n8n_synced    INTEGER NOT NULL DEFAULT 0,
 created_at    TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email ON accounts (email);
CREATE INDEX IF NOT EXISTS accounts_username ON accounts (username);
CREATE TABLE IF NOT EXISTS tokens (
 token_hash   TEXT PRIMARY KEY,
 account_id   TEXT NOT NULL,
 email        TEXT NOT NULL,
 purpose      TEXT NOT NULL,
 expires_at   INTEGER NOT NULL,
 auth_version TEXT NOT NULL DEFAULT '',
 used         INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
 session_hash TEXT PRIMARY KEY,
 user_json    TEXT NOT NULL,
 auth_version TEXT NOT NULL DEFAULT '',
 expires_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
 ip_hash      TEXT NOT NULL,
 account_hash TEXT NOT NULL,
 successful   INTEGER NOT NULL,
 created_ms   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_key ON attempts (account_hash, ip_hash, created_ms);
CREATE TABLE IF NOT EXISTS assignments (
 assignment_id TEXT PRIMARY KEY,
 driver_email  TEXT NOT NULL,
 type          TEXT NOT NULL DEFAULT '',
 date          TEXT NOT NULL,
 description   TEXT NOT NULL DEFAULT '',
 created_at    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS assignments_driver ON assignments (driver_email, date);
CREATE TABLE IF NOT EXISTS companies (
 company_id TEXT PRIMARY KEY,
 name       TEXT NOT NULL,
 active     INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS memberships (
 driver_email TEXT PRIMARY KEY,
 company_id   TEXT NOT NULL DEFAULT '',
 status       TEXT NOT NULL DEFAULT 'none',
 share        INTEGER NOT NULL DEFAULT 0,
 requested_at TEXT NOT NULL DEFAULT '',
 decided_at   TEXT NOT NULL DEFAULT ''
);
`;

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_LIMIT = 5;
const PLACEHOLDER = { salt: '0'.repeat(48), passwordHash: '0'.repeat(128), authVersion: '0'.repeat(64) };

/** Ouvre (et crée au besoin) la base locale. Même fichier que les courses ; ':memory:' pour les tests. */
export function openLocalDb(file) {
 if(file !== ':memory:') {
  const dir = path.dirname(file);
  if(!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
 }
 const db = new DatabaseSync(file);
 db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
 db.exec(SCHEMA);
 if(file !== ':memory:') { try { chmodSync(file, 0o600); } catch { /* best effort */ } }
 return db;
}

const toAccount = r => r && ({
 id: r.account_id, username: r.username, email: normalizeEmail(r.email), name: r.display_name || r.username,
 salt: r.salt, passwordHash: r.password_hash, role: r.role === 'admin' ? 'admin' : 'chauffeur',
 verified: r.verified === 1, authVersion: r.auth_version
});

/**
 * Comptes, jetons, sessions, tentatives : mêmes méthodes que createN8nStore.
 * `client` (n8n) sert uniquement à l'envoi des courriels ; le compte y est créé une fois, sans mot de passe, pour que le
 * workflow d'envoi retrouve l'adresse par identifiant.
 */
export function createLocalStore(db, { client, env = process.env, now = Date.now } = {}) {
 const pepper = env.HMAC_SECRET || env.N8N_TOKEN || '';
 const fingerprint = (kind, value) => createHmac('sha256', pepper).update(`${kind}:${value}`).digest('hex');
 const q = {
  byIdentifier: db.prepare('SELECT * FROM accounts WHERE email = ? OR username = ?'),
  byId: db.prepare('SELECT * FROM accounts WHERE account_id = ?'),
  insert: db.prepare(`INSERT OR IGNORE INTO accounts (account_id, username, email, display_name, salt, password_hash, role, verified, auth_version, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`),
  verify: db.prepare('UPDATE accounts SET verified = 1 WHERE account_id = ?'),
  password: db.prepare('UPDATE accounts SET salt = ?, password_hash = ?, auth_version = ? WHERE account_id = ?'),
  synced: db.prepare('UPDATE accounts SET n8n_synced = 1 WHERE account_id = ?'),
  tokenInsert: db.prepare('INSERT OR REPLACE INTO tokens (token_hash, account_id, email, purpose, expires_at, auth_version, used) VALUES (?, ?, ?, ?, ?, ?, 0)'),
  tokenUse: db.prepare('UPDATE tokens SET used = 1 WHERE token_hash = ? AND purpose = ? AND used = 0 AND expires_at > ?'),
  tokenGet: db.prepare('SELECT * FROM tokens WHERE token_hash = ?'),
  tokenPurge: db.prepare('DELETE FROM tokens WHERE expires_at < ? OR used = 1 AND expires_at < ?'),
  sessionInsert: db.prepare('INSERT OR REPLACE INTO sessions (session_hash, user_json, auth_version, expires_at) VALUES (?, ?, ?, ?)'),
  sessionGet: db.prepare('SELECT * FROM sessions WHERE session_hash = ? AND expires_at > ?'),
  sessionDelete: db.prepare('DELETE FROM sessions WHERE session_hash = ?'),
  sessionPurge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  attemptCount: db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE ip_hash = ? AND account_hash = ? AND successful = 0 AND created_ms > ?'),
  attemptInsert: db.prepare('INSERT INTO attempts (ip_hash, account_hash, successful, created_ms) VALUES (?, ?, ?, ?)'),
  attemptPurge: db.prepare('DELETE FROM attempts WHERE created_ms < ?')
 };
 return {
  accounts: {
   /** Recherche par courriel ou nom d'utilisateur ; null si absent ou ambigu (même règle que n8n : confirmés d'abord). */
   async get(identifier) {
    const id = normalizeEmail(identifier);
    const rows = q.byIdentifier.all(id, id);
    const verified = rows.filter(r => r.verified === 1);
    const candidates = verified.length ? verified : rows;
    return candidates.length === 1 ? toAccount(candidates[0]) : null;
   },
   async create(input) {
    const email = normalizeEmail(input.email);
    q.insert.run(input.id, email, email, input.name, input.salt, input.passwordHash, input.role === 'admin' ? 'admin' : 'chauffeur', input.authVersion, new Date(now()).toISOString());
   },
   async verify(id) { q.verify.run(id); },
   async setPassword(id, { salt, passwordHash, authVersion }) { q.password.run(salt, passwordHash, authVersion, id); },
   /**
    * Suppression de compte. Si n8n connaît le compte (courriels envoyés), il est effacé là-bas d'abord : en cas d'échec,
    * rien n'est supprimé localement et la demande peut être répétée. Puis une seule transaction SQLite.
    */
   async erase(acc) {
    const row = q.byId.get(acc.id);
    if(row?.n8n_synced) await client.call('account/erase', { method: 'POST', body: { id: acc.id, email: acc.email } });
    db.exec('BEGIN');
    try {
     db.prepare('DELETE FROM sessions WHERE json_extract(user_json, \'$.id\') = ?').run(acc.id);
     db.prepare('DELETE FROM tokens WHERE account_id = ?').run(acc.id);
     db.prepare('DELETE FROM assignments WHERE driver_email = ?').run(acc.email);
     db.prepare('DELETE FROM memberships WHERE driver_email = ?').run(acc.email);
     db.prepare('DELETE FROM accounts WHERE account_id = ?').run(acc.id);
     db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK'); throw error; }
   },
   /** Envoi par n8n (SMTP) ; n8n limite à un courriel toutes les 5 minutes par compte. */
   async mail(id, subject, message) {
    const row = q.byId.get(id);
    if(!row) return;
    if(!row.n8n_synced) {
     await client.call('accounts/create', { method: 'POST', body: {
      id: row.account_id, username: row.username, email: row.email, name: row.display_name, ...PLACEHOLDER, role: row.role, verified: false } });
     q.synced.run(id);
    }
    await client.call('accounts/email', { method: 'POST', body: { id, subject, message } });
   }
  },
  tokens: {
   async create({ hash, accountId, email, purpose, expires, authVersion }) {
    q.tokenPurge.run(now(), now() - 86400000);
    q.tokenInsert.run(hash, accountId, normalizeEmail(email), purpose, expires, authVersion ?? '');
   },
   /** Marque le jeton comme utilisé (une seule fois, non expiré) ; renvoie {accountId,email,purpose,authVersion} ou null. */
   async consume(hash, purpose) {
    if(!q.tokenUse.run(hash, purpose, now()).changes) return null;
    const r = q.tokenGet.get(hash);
    return { accountId: r.account_id, email: r.email, purpose: r.purpose, authVersion: r.auth_version };
   }
  },
  sessions: {
   async create(hash, user, expires, authVersion) {
    q.sessionPurge.run(now());
    q.sessionInsert.run(hash, JSON.stringify(user), authVersion ?? '', expires);
   },
   async get(hash) {
    const r = q.sessionGet.get(hash, now());
    return r ? { user: JSON.parse(r.user_json), expires: r.expires_at, ...(r.auth_version ? { authVersion: r.auth_version } : {}) } : null;
   },
   async delete(hash) { q.sessionDelete.run(hash); }
  },
  attempts: {
   async retryAfter(ip, identifier) {
    const since = now() - ATTEMPT_WINDOW_MS;
    return q.attemptCount.get(fingerprint('ip', ip), fingerprint('account', identifier), since).n >= ATTEMPT_LIMIT ? 30 : 0;
   },
   async record(ip, identifier, successful) {
    q.attemptPurge.run(now() - 86400000);
    q.attemptInsert.run(fingerprint('ip', ip), fingerprint('account', identifier), successful ? 1 : 0, now());
   }
  }
 };
}

/** Assignations planifiées : même interface que createAssignmentsProvider. */
export function createLocalAssignmentsProvider(db, { now = Date.now } = {}) {
 const out = r => ({ ...r, id: r.assignment_id });
 const mine = db.prepare('SELECT * FROM assignments WHERE driver_email = ? ORDER BY date');
 const all = db.prepare('SELECT * FROM assignments ORDER BY date');
 const insert = db.prepare('INSERT OR REPLACE INTO assignments (assignment_id, driver_email, type, date, description, created_at) VALUES (?, ?, ?, ?, ?, ?)');
 const remove = db.prepare('DELETE FROM assignments WHERE assignment_id = ? AND driver_email = ?');
 return {
  async list(user) { return (user.role === 'admin' ? all.all() : mine.all(user.email)).map(out); },
  async create(data, id) {
   const row = { assignment_id: id || randomUUID(), driver_email: data.driver_email, type: String(data.type ?? ''), date: String(data.date), description: String(data.description ?? ''), created_at: new Date(now()).toISOString() };
   insert.run(row.assignment_id, row.driver_email, row.type, row.date, row.description, row.created_at);
   return out(row);
  },
  async delete(id, owner) { remove.run(id, owner); },
  /** Suppression de compte : retire toutes les assignations du chauffeur. */
  removeDriver(email) { return db.prepare('DELETE FROM assignments WHERE driver_email = ?').run(email).changes; }
 };
}

/** Compagnies et adhésions : même interface que createCompaniesProvider. */
export function createLocalCompaniesProvider(db) {
 const company = r => ({ company_id: r.company_id, name: r.name, active: r.active === 1, created_at: r.created_at });
 const membership = r => ({ driver_email: r.driver_email, company_id: r.company_id, status: r.status, share: r.share === 1, requested_at: r.requested_at, decided_at: r.decided_at });
 const allCompanies = db.prepare('SELECT * FROM companies');
 const allMemberships = db.prepare('SELECT * FROM memberships');
 const saveCompany = db.prepare(`INSERT INTO companies (company_id, name, active, created_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(company_id) DO UPDATE SET name=excluded.name, active=excluded.active`);
 const saveMembership = db.prepare(`INSERT INTO memberships (driver_email, company_id, status, share, requested_at, decided_at) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(driver_email) DO UPDATE SET company_id=excluded.company_id, status=excluded.status, share=excluded.share, requested_at=excluded.requested_at, decided_at=excluded.decided_at`);
 return {
  async companies() { return allCompanies.all().map(company); },
  async saveCompany(c) { saveCompany.run(c.company_id, c.name, c.active === true ? 1 : 0, String(c.created_at ?? '')); return c; },
  async memberships() { return allMemberships.all().map(membership); },
  async saveMembership(m) {
   saveMembership.run(m.driver_email, String(m.company_id ?? ''), String(m.status ?? 'none'), m.share === true ? 1 : 0, String(m.requested_at ?? ''), String(m.decided_at ?? ''));
   return m;
  }
 };
}

/** Courses : la base locale est la source de vérité (aucune écriture dans n8n). Même interface que createMirroredServices. */
export function createLocalServicesProvider(rideStore, { now = Date.now } = {}) {
 return {
  async list(user) { return user.role === 'admin' ? rideStore.listAll() : rideStore.listByDriver(user.email); },
  async create(data, id) {
   const stamp = new Date(now()).toISOString();
   const row = { ...data, service_id: id || randomUUID(), created_at: stamp, updated_at: stamp };
   rideStore.upsert(row);
   return rideStore.get(row.service_id);
  },
  async delete(id, owner) { rideStore.remove(id, owner); },
  ridesFor: emails => rideStore.listByDrivers(emails),
  removeDriver: email => rideStore.removeDriver(email),
  get version() { return rideStore.version; }
 };
}
