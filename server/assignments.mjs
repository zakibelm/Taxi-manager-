import { HttpError, jsonBody, reply, sameOrigin, validate } from './http.mjs';
import { assignmentInput, serviceId, serviceTypes, canonicalType } from './validation.mjs';
// /api/assignments : assignations planifiées du Calendrier (rappel), sans montant.
// GET liste (le chauffeur : les siennes ; l'admin : toutes), POST création, DELETE /api/assignments/:id.
export function createAssignmentsMiddleware({ getUser, provider, env = process.env }) {
 return async (req, res, next) => {
  const url = new URL(req.url, 'http://local');
  if(url.pathname !== '/api/assignments' && !url.pathname.startsWith('/api/assignments/')) return next();
  try {
   const user = await getUser(req);
   if(!user || !['admin','chauffeur'].includes(user.role)) throw new HttpError(401, 'Connexion requise.');
   if(url.search) throw new HttpError(400, 'Paramètres non autorisés.');
   sameOrigin(req);
   if(req.method === 'GET' && url.pathname === '/api/assignments') {
    return reply(res, 200, { assignments: await provider.list(user) });
   }
   if(req.method === 'POST' && url.pathname === '/api/assignments') {
    const body = await jsonBody(req);
    const { id, ...input } = validate(() => { const v = assignmentInput(body); return { ...v, type: canonicalType(v.type, serviceTypes(env)) }; });
    const assignment = await provider.create({ ...input, driver_email: user.email }, id);
    return reply(res, 201, { assignment });
   }
   if(req.method === 'DELETE' && url.pathname.startsWith('/api/assignments/')) {
    const id = validate(() => serviceId(url.pathname.slice('/api/assignments/'.length)));
    const found = (await provider.list(user)).find(a => a.id === id && (user.role === 'admin' || a.driver_email === user.email));
    if(!found) throw new HttpError(404, 'Assignation introuvable.');
    await provider.delete(id, found.driver_email);
    return reply(res, 200, { success: true });
   }
   throw new HttpError(405, 'Méthode non autorisée.');
  } catch(error) { reply(res, error.status || 500, error.status ? { error: error.message } : { error: 'Erreur interne.' }); }
 };
}
