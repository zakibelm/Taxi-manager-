import { createHash, createHmac, randomBytes } from 'node:crypto';

// Accès aux Data Tables n8n des comptes, jetons, sessions et tentatives de connexion
// (workflows « Taxi Manager - Authentification production TM » et « Taxi Manager - Comptes et récupération TM »).
// Rien n'est stocké sur le disque du serveur : le seul état local est un cache court de sessions.

export const sha256 = value => createHash('sha256').update(String(value)).digest('hex');
export const randomHex = bytes => randomBytes(bytes).toString('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const normalizeEmail = value => String(value).trim().toLowerCase();
export const adminEmails = env => new Set(String(env.ADMIN_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean));

/** Ligne de taximanager_accounts_tm → objet métier. */
function account(row) {
 if(!row || typeof row !== 'object' || typeof row.account_id !== 'string') return null;
 return {
  id: row.account_id, username: row.username, email: normalizeEmail(row.email || ''), name: row.display_name || row.username,
  salt: row.salt, passwordHash: row.password_hash, role: row.role === 'admin' ? 'admin' : 'chauffeur',
  verified: row.verified === true || row.verified === 'true', authVersion: row.auth_version
 };
}

export function createN8nStore(client, env = process.env) {
 // Les IP et identifiants ne sont jamais écrits en clair dans n8n : empreinte HMAC avec un secret serveur.
 // HMAC_SECRET (dédié) ; repli sur N8N_TOKEN pour les installations existantes.
 const pepper = env.HMAC_SECRET || env.N8N_TOKEN || '';
 const fingerprint = (kind, value) => createHmac('sha256', pepper).update(`${kind}:${value}`).digest('hex');
 return {
  accounts: {
   /** Recherche par courriel ou nom d'utilisateur ; null si absent ou ambigu. */
   async get(identifier) {
    const data = await client.call('accounts/get', { query: { identifier: normalizeEmail(identifier) } });
    return data.conflict ? null : account(data.account);
   },
   async create(input) {
    await client.call('accounts/create', { method: 'POST', body: {
     id: input.id, username: input.email, email: input.email, name: input.name, salt: input.salt,
     passwordHash: input.passwordHash, role: input.role, verified: false, authVersion: input.authVersion } });
   },
   async verify(id) { await client.call('accounts/verify', { method: 'POST', body: { id } }); },
   async setPassword(id, { salt, passwordHash, authVersion }) {
    await client.call('accounts/password', { method: 'POST', body: { id, salt, passwordHash, authVersion } });
   },
   /** Suppression de compte : n8n efface le compte, ses courses, assignations, adhésion, jetons et sessions. */
   async erase(acc) { await client.call('account/erase', { method: 'POST', body: { id: acc.id, email: acc.email } }); },
   /** Envoi par n8n (SMTP) ; n8n limite à un courriel toutes les 5 minutes par compte. */
   async mail(id, subject, message) { await client.call('accounts/email', { method: 'POST', body: { id, subject, message } }); }
  },
  tokens: {
   async create({ hash, accountId, email, purpose, expires, authVersion }) {
    await client.call('accounts/token/create', { method: 'POST', body: { hash, id: accountId, email, purpose, expires, authVersion } });
   },
   /** Marque le jeton comme utilisé (une seule fois, non expiré) ; renvoie {accountId,email,purpose,authVersion} ou null. */
   async consume(hash, purpose) {
    const data = await client.call('accounts/token/consume', { method: 'POST', body: { hash, purpose } });
    return data.token && typeof data.token.accountId === 'string' ? data.token : null;
   }
  },
  sessions: {
   async create(hash, user, expires, authVersion) {
    await client.call('auth/session/create', { method: 'POST', body: { hash, user, expires, authVersion } });
   },
   async get(hash) {
    const data = await client.call('auth/session/get', { query: { hash } });
    return data.session && data.session.user ? data.session : null;
   },
   async delete(hash) { await client.call('auth/session/delete', { method: 'DELETE', body: { hash } }); }
  },
  attempts: {
   async retryAfter(ip, identifier) {
    const data = await client.call('auth/rate/check', { query: { ip: fingerprint('ip', ip), account: fingerprint('account', identifier) } });
    return Number.isFinite(data.retryAfter) ? Math.max(0, Math.min(60, data.retryAfter)) : 60;
   },
   async record(ip, identifier, successful) {
    await client.call('auth/rate/record', { method: 'POST', body: { ip: fingerprint('ip', ip), account: fingerprint('account', identifier), successful } });
   }
  }
 };
}
