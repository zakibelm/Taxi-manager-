import { HttpError, reply, sameOrigin } from './http.mjs';
import { serviceTypes } from './validation.mjs';
// GET /api/service-types -> liste des types proposés (configurée par SERVICE_TYPES sur le serveur).
// La liste n'est pas modifiable depuis l'application : aucune table n8n de types n'est utilisée par Taxi Manager.
export function createServiceTypesMiddleware({ getUser, env = process.env }) {
 return async (req, res, next) => {
  const url = new URL(req.url, 'http://local');
  if(url.pathname !== '/api/service-types') return next();
  try {
   const user = await getUser(req);
   if(!user) throw new HttpError(401, 'Connexion requise.');
   if(url.search) throw new HttpError(400, 'Paramètres non autorisés.');
   sameOrigin(req);
   if(req.method !== 'GET') throw new HttpError(405, 'La liste des types se règle sur le serveur (SERVICE_TYPES).');
   return reply(res, 200, { types: serviceTypes(env).map(name => ({ name, active: true })) });
  } catch(error) { reply(res, error.status || 500, error.status ? { error: error.message } : { error: 'Erreur interne.' }); }
 };
}
