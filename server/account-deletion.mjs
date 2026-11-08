import { sessionCookie } from './security.mjs';
import { HttpError, jsonBody, reply, sameOrigin, validate } from './http.mjs';
import { object, text } from './validation.mjs';
import { createLoginLimiter, clientIP } from './limiter.mjs';
import { adminEmails, normalizeEmail } from './store.mjs';
import { checkPassword, COOKIE } from './auth.mjs';

/**
 * Suppression de compte (exigence Google Play) : POST /api/account/delete { identifier, password, confirm: true }.
 * Le mot de passe prouve que la demande vient du titulaire, même sans session (page web publique de suppression).
 * Efface le compte, les courses, les assignations, l'adhésion à une compagnie, les jetons et les sessions,
 * dans SQLite et dans n8n. Le compte part d'abord (n8n puis SQLite), les courses locales ensuite : si n8n échoue, rien n'est
 * supprimé et la demande peut être répétée. Les comptes administrateurs ne peuvent pas être supprimés par ce chemin.
 */
export function createAccountDeletionMiddleware({ store, auth, services, env = process.env, now = Date.now }) {
 const limiter = createLoginLimiter(now);
 const admins = adminEmails(env);
 let active = 0;
 return async (req, res, next) => {
  const url = new URL(req.url, 'http://local');
  if(url.pathname !== '/api/account/delete') return next();
  try {
   if(url.search) throw new HttpError(400, 'Paramètres non autorisés.');
   if(req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
   sameOrigin(req);
   const body = await jsonBody(req, 4096);
   const { identifier, password } = validate(() => {
    object(body, ['identifier', 'password', 'confirm']);
    if(body.confirm !== true) throw new Error('confirm');
    if(typeof body.password !== 'string' || !body.password.length || body.password.length > 256) throw new Error('password');
    return { identifier: normalizeEmail(text(body.identifier, 254)), password: body.password };
   });
   const ip = clientIP(req, env);
   const key = 'delete|' + ip + '|' + identifier;
   let wait = limiter.retryAfter(key);
   if(!wait) wait = await store.attempts.retryAfter(ip, identifier);
   if(wait) { res.setHeader('Retry-After', String(wait)); throw new HttpError(429, 'Trop de tentatives. Réessayez après le délai indiqué.'); }
   if(active >= 4) throw new HttpError(503, 'Serveur occupé. Réessayez.');
   active++;
   try {
    const acc = await store.accounts.get(identifier);
    const ok = await checkPassword(password, acc);
    await store.attempts.record(ip, identifier, ok).catch(() => {});
    if(!ok) { limiter.failure(key); throw new HttpError(401, 'Identifiant ou mot de passe incorrect.'); }
    limiter.success(key);
    if(acc.role === 'admin' || admins.has(acc.email)) throw new HttpError(403, 'Un compte administrateur ne peut pas être supprimé ici.');
    // Ordre choisi pour qu'un échec ne perde rien : le compte (et n8n) d'abord. Si n8n est en panne, erase() échoue avant
    // toute suppression locale : compte et courses restent intacts et la demande peut être répétée.
    await store.accounts.erase(acc);
    auth.forget(acc.id);
    // Puis les courses locales, deux fois : la seconde passe, après un tour de boucle, retire une course dont la création
    // était en cours pendant la suppression. Sans copie locale (n8n seul), `removeDriver` n'existe pas : l'effacement des
    // courses se fait alors dans n8n par account/erase, qui vide aussi la table des courses.
    services.removeDriver?.(acc.email);
    await new Promise(resolve => setImmediate(resolve));
    services.removeDriver?.(acc.email);
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0, env));
    return reply(res, 200, { success: true });
   } finally { active--; }
  } catch(error) { reply(res, error.status || 500, { error: error.status ? error.message : 'Erreur interne.' }); }
 };
}
