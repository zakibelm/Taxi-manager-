import { randomUUID } from 'node:crypto';
import { HttpError, jsonBody, reply, sameOrigin, validate } from './http.mjs';
import { object, text } from './validation.mjs';
import { SLOTS, driverCount, hotspots, locatedRides, recommendZones, zoneDigest } from '../utils/zones.mjs';

// Compagnie d'appartenance : un chauffeur demande à rejoindre une compagnie (liste tenue par l'administrateur),
// l'administrateur approuve, et chaque chauffeur choisit s'il partage ses zones d'appel avec elle (opt-in).
// Les prévisions « compagnie » sont calculées par le serveur sur les courses des membres approuvés qui partagent,
// et ne sont publiées que sous forme de zones agrégées, jamais sans au moins MIN_DRIVERS chauffeurs distincts.
export const MIN_DRIVERS = 3;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const id = value => { if(typeof value !== 'string' || !UUID.test(value)) throw new Error('id'); return value; };
const name = value => { const v = text(value, 60); if(/[\u0000-\u001f\u007f<>]/.test(v)) throw new Error('nom'); return v; };
const iso = now => new Date(now()).toISOString();

export function createCompanyService({ provider, services, now = Date.now }) {
 const cache = new Map();
 const CACHE_MS = 5 * 60 * 1000;
 const publicCompany = c => ({ id: c.company_id, name: c.name, active: c.active === true });
 const find = (list, companyId) => list.find(c => c.company_id === companyId);
 const view = (m, companies) => {
  if(!m || m.status === 'none' || !m.company_id) return null;
  const company = find(companies, m.company_id);
  return { companyId: m.company_id, companyName: company?.name ?? 'Compagnie retirée', status: m.status, share: m.share === true };
 };
 async function mine(user) {
  const [companies, memberships] = await Promise.all([provider.companies(), provider.memberships()]);
  return { companies, membership: memberships.find(m => m.driver_email === user.email) ?? null };
 }
 return {
  async listCompanies(user) {
   const all = await provider.companies();
   return all.filter(c => user.role === 'admin' || c.active === true).map(publicCompany).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  },
  async createCompany(name_) {
   const all = await provider.companies();
   if(all.some(c => c.name.toLowerCase() === name_.toLowerCase())) throw new HttpError(409, 'Cette compagnie existe déjà.');
   return publicCompany(await provider.saveCompany({ company_id: randomUUID(), name: name_, active: true, created_at: iso(now) }));
  },
  async setCompanyActive(companyId, active) {
   const company = find(await provider.companies(), companyId);
   if(!company) throw new HttpError(404, 'Compagnie introuvable.');
   return publicCompany(await provider.saveCompany({ company_id: company.company_id, name: company.name, active, created_at: company.created_at }));
  },
  async myMembership(user) {
   const { companies, membership } = await mine(user);
   return view(membership, companies);
  },
  /** Choisit une compagnie (statut « en attente » tant que l'administrateur n'a pas approuvé), change le partage, ou quitte (companyId = null). */
  async updateMembership(user, { companyId, share }) {
   const { companies, membership } = await mine(user);
   const current = membership && membership.status !== 'none' ? membership : null;
   const base = { driver_email: user.email, company_id: '', status: 'none', share: false, requested_at: '', decided_at: '' };
   if(companyId === null) return view(await provider.saveMembership({ ...base, requested_at: current?.requested_at ?? '' }), companies);
   if(companyId !== undefined) {
    const company = find(companies, companyId);
    if(!company || company.active !== true) throw new HttpError(404, 'Compagnie introuvable.');
    if(!current || current.company_id !== companyId) {
     return view(await provider.saveMembership({ ...base, company_id: companyId, status: 'pending', share: share === true, requested_at: iso(now) }), companies);
    }
   }
   if(!current) throw new HttpError(400, 'Choisissez d’abord une compagnie.');
   if(typeof share !== 'boolean') return view(current, companies);
   return view(await provider.saveMembership({ driver_email: current.driver_email, company_id: current.company_id, status: current.status, share, requested_at: current.requested_at ?? '', decided_at: current.decided_at ?? '' }), companies);
  },
  async pending(adminView = true) {
   const [companies, memberships] = await Promise.all([provider.companies(), provider.memberships()]);
   return memberships.filter(m => m.status !== 'none' && m.company_id).map(m => ({
    email: m.driver_email, companyId: m.company_id, companyName: find(companies, m.company_id)?.name ?? 'Compagnie retirée',
    status: m.status, share: m.share === true, requestedAt: m.requested_at || null, decidedAt: m.decided_at || null
   })).sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || String(b.requestedAt).localeCompare(String(a.requestedAt)));
  },
  async decide(email, approve) {
   const m = (await provider.memberships()).find(x => x.driver_email === email && x.status !== 'none' && x.company_id);
   if(!m) throw new HttpError(404, 'Demande introuvable.');
   await provider.saveMembership({ driver_email: m.driver_email, company_id: m.company_id, status: approve ? 'approved' : 'rejected', share: m.share === true, requested_at: m.requested_at ?? '', decided_at: iso(now) });
   return { email, status: approve ? 'approved' : 'rejected' };
  },
  /** Courses des membres approuvés qui partagent leurs zones. Pour usage interne : contient driver_email, ne sort jamais telle quelle. */
  async pool(user) {
   const { companies, membership } = await mine(user);
   if(!membership || membership.status !== 'approved') throw new HttpError(403, 'Votre appartenance à une compagnie doit d’abord être approuvée.');
   const memberships = await provider.memberships();
   const sharing = new Set(memberships.filter(m => m.company_id === membership.company_id && m.status === 'approved' && m.share === true).map(m => m.driver_email));
   // Avec la copie SQLite : lecture locale, limitée aux chauffeurs qui partagent, avec un cache court invalidé à chaque écriture.
   if(typeof services.ridesFor === 'function') {
    const key = `${membership.company_id}|${services.version}|${[...sharing].sort().join(',')}`;
    const hit = cache.get(membership.company_id);
    if(hit && hit.key === key && now() - hit.at < CACHE_MS) return { company: find(companies, membership.company_id), rides: hit.rides, sharing: sharing.size };
    const rides = services.ridesFor(sharing);
    cache.set(membership.company_id, { key, at: now(), rides });
    return { company: find(companies, membership.company_id), rides, sharing: sharing.size };
   }
   const rides = await services.list({ role: 'admin', email: 'server' });
   return { company: find(companies, membership.company_id), rides: rides.filter(s => sharing.has(s.driver_email)), sharing: sharing.size };
  },
  /** Prévisions de la compagnie : zones agrégées seulement, supprimées sous MIN_DRIVERS chauffeurs distincts. */
  async zones(user, { slotId = null, day = null } = {}) {
   const { company, rides, sharing } = await this.pool(user);
   const contributors = driverCount(locatedRides(rides));
   const head = { company: { name: company?.name ?? 'Compagnie' }, minDrivers: MIN_DRIVERS, sharing, contributors };
   if(contributors < MIN_DRIVERS) return { ...head, status: 'insufficient' };
   const opts = { minDrivers: MIN_DRIVERS };
   return { ...head, status: 'ok', recommend: recommendZones(rides, new Date(now()), 3, opts), spots: hotspots(locatedRides(rides, { slotId, day }), opts) };
  },
  /** Résumé pour l'assistant IA (même règles), ou null si la compagnie ne peut pas être utilisée. */
  async digest(user) {
   try {
    const { rides } = await this.pool(user);
    if(driverCount(locatedRides(rides)) < MIN_DRIVERS) return null;
    return zoneDigest(rides, new Date(now()), { minDrivers: MIN_DRIVERS });
   } catch(error) { if(error.status === 403 || error.status === 404) return null; throw error; }
  }
 };
}

export function createCompaniesMiddleware({ getUser, service }) {
 return async (req, res, next) => {
  const url = new URL(req.url, 'http://local');
  const path = url.pathname;
  const known = ['/api/companies', '/api/membership', '/api/memberships', '/api/memberships/decision', '/api/company/zones'];
  if(!known.includes(path) && !/^\/api\/companies\/[^/]+$/.test(path)) return next();
  try {
   const user = await getUser(req);
   if(!user || !['admin', 'chauffeur'].includes(user.role)) throw new HttpError(401, 'Connexion requise.');
   const admin = () => { if(user.role !== 'admin') throw new HttpError(403, 'Réservé à l’administrateur.'); };
   const driver = () => { if(user.role !== 'chauffeur') throw new HttpError(403, 'Réservé aux chauffeurs.'); };
   if(req.method !== 'GET') sameOrigin(req);
   const method = req.method;
   if(path === '/api/company/zones') {
    if(method !== 'GET') throw new HttpError(405, 'Méthode non autorisée.');
    driver();
    const params = Object.fromEntries(url.searchParams);
    const { slotId, day } = validate(() => {
     object(params, ['slot', 'day']);
     const slotId = params.slot === undefined || params.slot === 'all' ? null : params.slot;
     if(slotId !== null && !SLOTS.some(s => s.id === slotId)) throw new Error('slot');
     const day = params.day === undefined ? null : Number(params.day);
     if(day !== null && !(Number.isInteger(day) && day >= 0 && day <= 6)) throw new Error('day');
     return { slotId, day };
    });
    return reply(res, 200, await service.zones(user, { slotId, day }));
   }
   if(url.search) throw new HttpError(400, 'Paramètres non autorisés.');
   if(path === '/api/companies') {
    if(method === 'GET') return reply(res, 200, { companies: await service.listCompanies(user) });
    if(method === 'POST') {
     admin();
     const body = await jsonBody(req);
     const companyName = validate(() => { object(body, ['name']); return name(body.name); });
     return reply(res, 201, { company: await service.createCompany(companyName) });
    }
    throw new HttpError(405, 'Méthode non autorisée.');
   }
   if(path.startsWith('/api/companies/')) {
    if(method !== 'PUT') throw new HttpError(405, 'Méthode non autorisée.');
    admin();
    const body = await jsonBody(req);
    const { companyId, active } = validate(() => {
     object(body, ['active']);
     if(typeof body.active !== 'boolean') throw new Error('active');
     return { companyId: id(path.slice('/api/companies/'.length)), active: body.active };
    });
    return reply(res, 200, { company: await service.setCompanyActive(companyId, active) });
   }
   if(path === '/api/membership') {
    driver();
    if(method === 'GET') return reply(res, 200, { membership: await service.myMembership(user) });
    if(method === 'PUT') {
     const body = await jsonBody(req);
     const input = validate(() => {
      object(body, ['companyId', 'share']);
      if(body.companyId === undefined && body.share === undefined) throw new Error('vide');
      if(body.share !== undefined && typeof body.share !== 'boolean') throw new Error('share');
      return { companyId: body.companyId === undefined || body.companyId === null ? body.companyId : id(body.companyId), share: body.share };
     });
     return reply(res, 200, { membership: await service.updateMembership(user, input) });
    }
    throw new HttpError(405, 'Méthode non autorisée.');
   }
   if(path === '/api/memberships') {
    if(method !== 'GET') throw new HttpError(405, 'Méthode non autorisée.');
    admin();
    return reply(res, 200, { memberships: await service.pending() });
   }
   if(path === '/api/memberships/decision') {
    if(method !== 'POST') throw new HttpError(405, 'Méthode non autorisée.');
    admin();
    const body = await jsonBody(req);
    const { email, approve } = validate(() => {
     object(body, ['email', 'approve']);
     if(typeof body.approve !== 'boolean') throw new Error('approve');
     return { email: text(body.email, 254).toLowerCase(), approve: body.approve };
    });
    return reply(res, 200, await service.decide(email, approve));
   }
   throw new HttpError(405, 'Méthode non autorisée.');
  } catch(error) { reply(res, error.status || 500, error.status ? { error: error.message } : { error: 'Erreur interne.' }); }
 };
}
