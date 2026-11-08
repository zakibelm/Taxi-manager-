import { timingSafeEqual } from 'node:crypto';
import { HttpError, jsonBody, reply } from './http.mjs';
import { dispatchRow } from './dispatch.mjs';

// Réception directe de l'application DataTaxi (remplace le webhook n8n → Google Sheet) :
//   POST /api/datataxi/ingest   { "token": "...", "rows": [ {trip_id, trip_date, …}, … ] }   (même corps que l'application envoie déjà)
// Le jeton (DATATAXI_TOKEN) est propre à cette route : il ne donne accès à aucune autre donnée.
// Toute ligne invalide fait refuser le lot entier (400) : l'application ne marque alors rien comme envoyé et réessaie.
export const MAX_ROWS = 1000;
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function createDatataxiMiddleware({ store, env = process.env, log = console.error }) {
 const token = String(env.DATATAXI_TOKEN || '');
 return async (req, res, next) => {
  const url = new URL(req.url, 'http://local');
  if(url.pathname !== '/api/datataxi/ingest') return next();
  try {
   if(req.method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
   if(token.length < 24) throw new HttpError(503, 'Réception DataTaxi non configurée.');
   const body = await jsonBody(req, 1024 * 1024);
   if(typeof body?.token !== 'string' || !same(body.token, token)) throw new HttpError(401, 'Jeton refusé.');
   if(!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > MAX_ROWS) throw new HttpError(400, 'Lot invalide.');
   let rows;
   try { rows = body.rows.map(dispatchRow); } catch { throw new HttpError(400, 'Ligne invalide : lot refusé.'); }
   try { store.upsertMany(rows); } catch(error) { log(`[datataxi] écriture impossible : ${error.message}`); throw new HttpError(503, 'Stockage indisponible.'); }
   return reply(res, 200, { ok: true, received: rows.length });
  } catch(error) { reply(res, error.status || 500, error.status ? { error: error.message } : { error: 'Erreur interne.' }); }
 };
}
