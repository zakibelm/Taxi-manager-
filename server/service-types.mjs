import { HttpError, reply, sameOrigin } from './http.mjs';
import { serviceTypes, mergeTypes } from './validation.mjs';
// GET /api/service-types -> types proposés : SERVICE_TYPES du serveur + types déjà utilisés dans les courses
// visibles par l'utilisateur (le chauffeur : les siens, ajoutés via « Autre » ; l'admin : ceux de tous).
// Un nouveau type n'a pas de table propre : il existe dès qu'une course l'utilise.
export function createServiceTypesMiddleware({ getUser, provider, env = process.env }) {
 return async (req, res, next) => {
  const url = new URL(req.url, 'http://local');
  if(url.pathname !== '/api/service-types') return next();
  try {
   const user = await getUser(req);
   if(!user) throw new HttpError(401, 'Connexion requise.');
   if(url.search) throw new HttpError(400, 'Paramètres non autorisés.');
   sameOrigin(req);
   if(req.method !== 'GET') throw new HttpError(405, 'Un nouveau type s’ajoute avec « Autre » dans le formulaire de course.');
   let used = [];
   if(provider) { try { used = (await provider.list(user)).map(s => s.type); } catch { /* n8n indisponible : liste du serveur seule */ } }
   return reply(res, 200, { types: mergeTypes(serviceTypes(env), used).map(name => ({ name, active: true })) });
  } catch(error) { reply(res, error.status || 500, error.status ? { error: error.message } : { error: 'Erreur interne.' }); }
 };
}
