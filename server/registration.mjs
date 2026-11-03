import { randomUUID, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError, jsonBody, reply, sameOrigin, validate } from './http.mjs';
import { object, text, email as emailValue } from './validation.mjs';
import { clientIP } from './limiter.mjs';
import { adminEmails, newToken, normalizeEmail, randomHex, sha256 } from './store.mjs';

const derive = promisify(scrypt);
const HOUR = 60 * 60 * 1000;
export const PASSWORD_MIN = 12;
const GENERIC = 'Si l’adresse est valide, un courriel vient d’être envoyé. Vérifiez aussi vos indésirables.';
const INVALID_LINK = 'Lien invalide, expiré ou déjà utilisé. Refaites une demande pour en recevoir un nouveau.';

/** Quota en mémoire sur fenêtre glissante : protège la boîte de réception et n8n contre les rafales. */
export function createQuota(now = Date.now, windowMs = 15 * 60 * 1000, maxKeys = 20000) {
 const hits = new Map();
 return (key, limit) => {
  const t = now(), list = (hits.get(key) || []).filter(x => x > t - windowMs);
  if(list.length >= limit) return Math.ceil((list[0] + windowMs - t) / 1000);
  if(!hits.has(key) && hits.size >= maxKeys) { for(const [k, v] of hits) if(!v.some(x => x > t - windowMs)) hits.delete(k); if(hits.size >= maxKeys) return 60; }
  list.push(t); hits.set(key, list); return 0;
 };
}
const LIMITS = { register: [10, 3], forgot: [10, 3], verify: [20], reset: [20] }; // [par IP, par courriel]

/** Sel de 24 octets (48 hex) et empreinte scrypt de 64 octets, formats attendus par taximanager_accounts_tm. */
export async function hashPassword(password) {
 const salt = randomHex(24);
 return { salt, passwordHash: (await derive(password, salt, 64)).toString('hex') };
}
function password(value) {
 if(typeof value !== 'string' || value.length < PASSWORD_MIN || value.length > 256) throw new Error('password');
 return value;
}
const token = value => { if(typeof value !== 'string' || !/^[A-Za-z0-9_-]{30,100}$/.test(value)) throw new Error('token'); return value; };

export const mails = {
 verify: (name, link) => ({ subject: 'Taxi Manager : confirmez votre adresse courriel',
  text: `Bonjour ${name},\n\nConfirmez votre adresse et choisissez votre mot de passe Taxi Manager :\n${link}\n\nCe lien expire dans 24 heures. Si vous n'êtes pas à l'origine de cette demande, ignorez ce courriel.` }),
 reset: (name, link) => ({ subject: 'Taxi Manager : réinitialisation du mot de passe',
  text: `Bonjour ${name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien :\n${link}\n\nCe lien expire dans 1 heure et ne fonctionne qu'une fois. Si vous n'avez rien demandé, ignorez ce courriel : votre mot de passe actuel reste valide.` }),
 exists: (name, link) => ({ subject: 'Taxi Manager : vous avez déjà un compte',
  text: `Bonjour ${name},\n\nUne inscription a été tentée avec votre adresse, mais un compte existe déjà. Si vous avez oublié votre mot de passe, utilisez « Mot de passe oublié » :\n${link}` })
};

/**
 * Inscription en deux temps : le compte est créé avec un mot de passe aléatoire inutilisable, puis le titulaire de
 * la boîte choisit le sien en ouvrant le lien (personne ne peut fixer le mot de passe d'une adresse qu'il ne possède pas).
 * Les réponses publiques sont identiques que le compte existe ou non. Un courriel de ADMIN_EMAILS devient admin.
 */
export function createRegistrationMiddleware({ store, auth, env = process.env, now = Date.now, logger = console }) {
 const quota = createQuota(now);
 const admins = adminEmails(env);
 const publicUrl = req => {
  if(env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/$/, '');
  if(env.NODE_ENV === 'production') throw new HttpError(503, 'PUBLIC_URL non configurée.');
  return `http://${req.headers.host}`;
 };
 const throttle = (req, action, id = '') => {
  const [perIp, perId] = LIMITS[action];
  const wait = quota(`${action}|ip|${clientIP(req, env)}`, perIp) || (id && perId ? quota(`${action}|id|${id}`, perId) : 0);
  if(wait) throw Object.assign(new HttpError(429, 'Trop de demandes. Réessayez plus tard.'), { retryAfter: wait });
 };
 // MAIL_PROVIDER=log : le lien est écrit dans le journal du serveur (amorçage avant la configuration SMTP).
 const send = async (acc, mail) => {
  if(env.MAIL_PROVIDER === 'log') { logger.warn(`[Taxi Manager courriel → ${acc.email}] ${mail.subject}\n${mail.text}`); return; }
  await store.accounts.mail(acc.id, mail.subject, mail.text);
 };
 const issue = async (acc, purpose, ttl) => {
  const value = newToken();
  await store.tokens.create({ hash: sha256(value), accountId: acc.id, email: acc.email, purpose, expires: now() + ttl, authVersion: acc.authVersion });
  return value;
 };
 /** Consomme un jeton et vérifie qu'il correspond toujours au compte (même version d'authentification). */
 const redeem = async (value, purpose) => {
  const found = await store.tokens.consume(sha256(value), purpose);
  if(!found) return null;
  const acc = await store.accounts.get(found.email);
  return acc && acc.id === found.accountId && acc.authVersion === found.authVersion ? acc : null;
 };
 const setPassword = async (acc, value) => {
  const secret = await hashPassword(value);
  await store.accounts.setPassword(acc.id, { ...secret, authVersion: randomHex(32) }); // nouvelle version : anciennes sessions et liens invalides
  if(!acc.verified) await store.accounts.verify(acc.id);
  auth.forget?.(acc.id);
 };

 const routes = {
  async register(req, body) {
   const input = validate(() => { object(body, ['email', 'name']); return { email: emailValue(body.email), name: text(body.name, 60) }; });
   throttle(req, 'register', input.email);
   const base = publicUrl(req);
   let acc = await store.accounts.get(input.email);
   if(acc && acc.verified) { await send(acc, mails.exists(acc.name, `${base}/?mode=forgot`)); return [202, { message: GENERIC }]; }
   if(!acc) {
    const unusable = await hashPassword(randomHex(32));
    acc = { id: randomUUID(), email: input.email, name: input.name, role: admins.has(input.email) ? 'admin' : 'chauffeur', authVersion: randomHex(32), ...unusable };
    await store.accounts.create(acc);
   }
   await send(acc, mails.verify(acc.name, `${base}/?verify=${await issue(acc, 'verify', 24 * HOUR)}`));
   return [202, { message: GENERIC }];
  },
  async verify(req, body) {
   const input = validate(() => { object(body, ['token', 'password']); return { token: token(body.token), password: password(body.password) }; });
   throttle(req, 'verify');
   const acc = await redeem(input.token, 'verify');
   if(!acc) throw new HttpError(400, INVALID_LINK);
   await setPassword(acc, input.password);
   return [200, { status: 'active', message: 'Compte activé. Vous pouvez vous connecter.' }];
  },
  async forgot(req, body) {
   const address = validate(() => { object(body, ['email']); return emailValue(body.email); });
   throttle(req, 'forgot', address);
   const base = publicUrl(req);
   const acc = await store.accounts.get(address);
   if(acc && !acc.verified) await send(acc, mails.verify(acc.name, `${base}/?verify=${await issue(acc, 'verify', 24 * HOUR)}`));
   else if(acc) await send(acc, mails.reset(acc.name, `${base}/?reset=${await issue(acc, 'reset', HOUR)}`));
   return [202, { message: GENERIC }];
  },
  async reset(req, body) {
   const input = validate(() => { object(body, ['token', 'password']); return { token: token(body.token), password: password(body.password) }; });
   throttle(req, 'reset');
   const acc = await redeem(input.token, 'reset');
   if(!acc) throw new HttpError(400, INVALID_LINK);
   await setPassword(acc, input.password);
   return [200, { message: 'Mot de passe modifié. Vous pouvez vous connecter.' }];
  }
 };

 return async (req, res, next) => {
  const url = new URL(req.url, 'http://local');
  const action = url.pathname.match(/^\/api\/auth\/(register|verify|forgot|reset)$/)?.[1];
  if(!action) return next();
  try {
   if(url.search) throw new HttpError(400, 'Paramètres non autorisés.');
   if(req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
   sameOrigin(req);
   const [status, data] = await routes[action](req, await jsonBody(req, 4096));
   return reply(res, status, data);
  } catch(error) {
   if(error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
   reply(res, error.status || 500, { error: error.status ? error.message : 'Erreur interne.' });
  }
 };
}

export { normalizeEmail };
