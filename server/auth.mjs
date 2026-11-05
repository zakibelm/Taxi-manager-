import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { sessionCookie } from './security.mjs';
import { HttpError, jsonBody, reply, sameOrigin, validate } from './http.mjs';
import { object, text } from './validation.mjs';
import { createLoginLimiter, clientIP } from './limiter.mjs';
import { adminEmails, normalizeEmail, sha256 } from './store.mjs';
import { createAccessPolicy } from './access.mjs';

const derive = promisify(scrypt);
export const SESSION_LIFETIME = 8 * 60 * 60 * 1000;
export const COOKIE = 'taxi_session';
const CACHE_MS = 30 * 1000;
const CACHE_MAX = 5000;
const DUMMY_SALT = 'taximanager-dummy-salt-000000000000000000000000';

/** Vérifie un mot de passe contre {salt, passwordHash} ; temps constant, même pour un compte absent. */
export async function checkPassword(password, account) {
 const valid = account && typeof account.salt === 'string' && /^[a-f0-9]{128}$/i.test(account.passwordHash || '');
 const expected = valid ? Buffer.from(account.passwordHash, 'hex') : Buffer.alloc(64);
 const actual = await derive(password, valid ? account.salt : DUMMY_SALT, 64);
 return valid && timingSafeEqual(expected, actual);
}

/**
 * Connexion, session et déconnexion. Les sessions vivent dans taximanager_sessions_tm (empreinte SHA-256 de l'identifiant
 * de cookie, jamais l'identifiant lui-même). Une session n'est valide que si le compte est confirmé et que sa
 * version d'authentification n'a pas changé (un changement de mot de passe ferme toutes les sessions).
 */
export function createAuthMiddleware({ store, env = process.env, now = Date.now }) {
 const limiter = createLoginLimiter(now);
 const admins = adminEmails(env);
 const access = createAccessPolicy(env);
 const cache = new Map(); // empreinte -> { user, expires, checked }
 let active = 0;
 const cookieId = req => (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
 const roleOf = acc => admins.has(acc.email) ? 'admin' : acc.role;

 async function getUser(req) {
  const id = cookieId(req);
  if(!id || !/^[a-f0-9]{64}$/.test(id)) return null;
  const hash = sha256(id);
  const hit = cache.get(hash);
  if(hit && hit.expires > now() && hit.checked > now() - CACHE_MS) return hit.user;
  cache.delete(hash);
  let session;
  try { session = await store.sessions.get(hash); } catch { return null; } // n8n indisponible : non connecté, jamais un repli
  if(!session || !(session.expires > now())) return null;
  // n8n indisponible pendant la lecture du compte : « non connecté » pour cette requête, mais la session est conservée
  // (une coupure réseau ne doit pas déconnecter les chauffeurs). Seul un compte réellement absent ou modifié la supprime.
  let acc;
  try { acc = await store.accounts.get(session.user.email); } catch { return null; }
  if(!acc || !acc.verified || !access.allowed(acc.email) || acc.id !== String(session.user.id) || (session.authVersion && session.authVersion !== acc.authVersion)) {
   store.sessions.delete(hash).catch(() => {});
   return null;
  }
  const user = { id: acc.id, email: acc.email, name: acc.name, role: roleOf(acc) };
  if(cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(hash, { user, expires: session.expires, checked: now() });
  return user;
 }

 const middleware = async (req, res, next) => {
  const url = new URL(req.url, 'http://local');
  if(!['/api/auth/session', '/api/auth/login', '/api/auth/logout'].includes(url.pathname)) return next();
  try {
   if(url.search) throw new HttpError(400, 'Paramètres non autorisés.');
   if(req.method === 'GET' && url.pathname === '/api/auth/session') return reply(res, 200, { user: await getUser(req) });
   if(req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
   sameOrigin(req);
   if(url.pathname === '/api/auth/logout') {
    const id = cookieId(req);
    if(id && /^[a-f0-9]{64}$/.test(id)) { const hash = sha256(id); cache.delete(hash); await store.sessions.delete(hash).catch(() => {}); }
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0, env));
    return reply(res, 200, { success: true });
   }
   const body = await jsonBody(req, 4096);
   const { identifier, password } = validate(() => {
    object(body, ['identifier', 'password']);
    const identifier = normalizeEmail(text(body.identifier, 254));
    if(typeof body.password !== 'string' || !body.password.length || body.password.length > 256) throw new Error('password');
    return { identifier, password: body.password };
   });
   const ip = clientIP(req, env);
   const key = ip + '|' + identifier;
   // Deux barrières : compteur local (coupe les rafales sans appeler n8n) puis compteur partagé dans n8n.
   let wait = limiter.retryAfter(key);
   if(!wait) wait = await store.attempts.retryAfter(ip, identifier);
   if(wait) { res.setHeader('Retry-After', String(wait)); throw new HttpError(429, 'Trop de tentatives. Réessayez après le délai indiqué.'); }
   if(active >= 8) throw new HttpError(503, 'Serveur occupé. Réessayez.');
   active++;
   try {
    const acc = await store.accounts.get(identifier);
    const ok = await checkPassword(password, acc);
    await store.attempts.record(ip, identifier, ok).catch(() => {});
    if(!ok) { limiter.failure(key); throw new HttpError(401, 'Identifiant ou mot de passe incorrect.'); }
    // Mot de passe correct : l'état du compte n'est révélé qu'à son titulaire.
    if(!acc.verified) throw new HttpError(403, 'Confirmez d’abord votre adresse courriel (lien reçu à l’inscription).');
    if(!access.allowed(acc.email)) throw new HttpError(403, 'Ce compte n’est pas autorisé. Contactez l’administrateur.');
    limiter.success(key);
    const old = cookieId(req);
    if(old && /^[a-f0-9]{64}$/.test(old)) { const h = sha256(old); cache.delete(h); store.sessions.delete(h).catch(() => {}); }
    const id = randomBytes(32).toString('hex');
    const user = { id: acc.id, email: acc.email, name: acc.name, role: roleOf(acc) };
    const expires = now() + SESSION_LIFETIME;
    await store.sessions.create(sha256(id), user, expires, acc.authVersion);
    res.setHeader('Set-Cookie', sessionCookie(req, id, SESSION_LIFETIME / 1000, env));
    return reply(res, 200, { user });
   } finally { active--; }
  } catch(error) { reply(res, error.status || 500, { error: error.status ? error.message : 'Erreur interne.' }); }
 };
 middleware.getUser = getUser;
 /** Vide le cache local d'un compte (les sessions n8n sont invalidées par le changement de version). */
 middleware.forget = accountId => { for(const [hash, entry] of cache) if(entry.user.id === accountId) cache.delete(hash); };
 return middleware;
}
