import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.mjs';

// Toutes les données de Taxi Manager vivent dans des Data Tables n8n, derrière les workflows « … TM ».
// Ce client est le seul point de passage : URL de base, préfixe des chemins, en-tête secret, délai, aucune redirection.
export const DEFAULT_PREFIX = 'taximanager-tm';
export const DEFAULT_TOKEN_HEADER = 'X-DrivePilot-Token'; // en-tête de l'identifiant Header Auth branché sur les workflows TM

export function n8nBase(env) {
 if(!env.N8N_URL || !env.N8N_TOKEN) return null;
 let base;
 try { base = new URL(env.N8N_URL); } catch { return null; }
 const local = base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
 if(base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !local)) return null;
 return base.href.replace(/\/$/, '');
}

export function createN8nClient(env = process.env, fetcher = fetch) {
 const prefix = (env.N8N_PREFIX || DEFAULT_PREFIX).replace(/^\/+|\/+$/g, '');
 const header = env.N8N_TOKEN_HEADER || DEFAULT_TOKEN_HEADER;
 /** Appelle `${N8N_URL}/${prefix}/api/${path}` et renvoie le JSON (success:true obligatoire). */
 async function call(path, { method = 'GET', query, body, unavailable = 'Service de données indisponible. Réessayez.' } = {}) {
  const base = n8nBase(env);
  if(!base) throw new HttpError(503, 'Le stockage n8n n’est pas configuré sur ce serveur (N8N_URL HTTPS et N8N_TOKEN requis).');
  const url = new URL(`${base}/${prefix}/api/${path}`);
  for(const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
  let response;
  try {
   response = await fetcher(url.href, {
    method, redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', [header]: env.N8N_TOKEN },
    ...(body ? { body: JSON.stringify(body) } : {})
   });
  } catch { throw new HttpError(502, unavailable); }
  let data;
  try { data = await response.json(); } catch { throw new HttpError(502, unavailable); }
  if(!response.ok || !data || data.success !== true) throw new HttpError(502, unavailable);
  return data;
 }
 return { call, configured: () => !!n8nBase(env) };
}

/** Assignations planifiées : workflow « Taxi Manager - Assignations TM », table taximanager_assignments_tm. */
export function createAssignmentsProvider(client) {
 const unavailable = 'Le service des assignations est indisponible.';
 const rows = data => { if(!Array.isArray(data.assignments)) throw new HttpError(502, 'Réponse du service invalide.'); return data.assignments; };
 return {
  async list(user) {
   const data = user.role === 'admin'
    ? await client.call('assignments/all', { unavailable })
    : await client.call('assignments/list', { query: { email: user.email }, unavailable });
   return rows(data).filter(a => user.role === 'admin' || a.driver_email === user.email);
  },
  async create(data, id) {
   return (await client.call('assignments/create', { method: 'POST', body: { ...data, assignment_id: id || randomUUID() }, unavailable })).assignment;
  },
  async delete(id, owner) { await client.call('assignments/delete', { method: 'DELETE', body: { id, driver_email: owner }, unavailable }); }
 };
}

/** Courses : workflow « Taxi Manager - Courses TM », table taximanager_services_tm. */
export function createServicesProvider(client) {
 const unavailable = 'Le service de courses est indisponible. Aucune donnée locale de remplacement.';
 const rows = data => {
  if(!Array.isArray(data.services)) throw new HttpError(502, 'Réponse du service invalide.');
  return data.services;
 };
 return {
  async list(user) {
   // Le courriel passe en paramètre de requête, comme le workflow l'attend ; l'admin lit tout.
   const data = user.role === 'admin'
    ? await client.call('services/all', { unavailable })
    : await client.call('services/list', { query: { email: user.email }, unavailable });
   return rows(data).filter(s => user.role === 'admin' || s.driver_email === user.email);
  },
  async create(data, id) {
   return (await client.call('services/create', { method: 'POST', body: { ...data, service_id: id || randomUUID() }, unavailable })).service;
  },
  async delete(id, owner) { await client.call('services/delete', { method: 'DELETE', body: { id, driver_email: owner }, unavailable }); }
 };
}
