import { createChatMiddleware } from './chat.mjs';
import { createLlmProvider } from './providers/openrouter.mjs';
import { privateFiles } from './files.mjs';
import { securityHeaders } from './security.mjs';
import { createAuthMiddleware } from './auth.mjs';
import { createN8nClient, createServicesProvider, createAssignmentsProvider, createCompaniesProvider } from './providers/n8n.mjs';
import { createAssignmentsMiddleware } from './assignments.mjs';
import { createN8nStore } from './store.mjs';
import { createCompaniesMiddleware, createCompanyService } from './companies.mjs';
import { createServicesMiddleware } from './services.mjs';
import { createServiceTypesMiddleware } from './service-types.mjs';
import { createRegistrationMiddleware } from './registration.mjs';
import { reply } from './http.mjs';
import { openRideStore } from './sqlite.mjs';
import { createMirroredServices } from './providers/mirror.mjs';
import { openDispatchStore } from './dispatch.mjs';
import { createDatataxiMiddleware } from './datataxi.mjs';
// Une seule liste ordonnée, partagée par le plugin Vite (dev/preview) et le serveur de production.
// Toutes les données (comptes, jetons, sessions, tentatives, courses) passent par les workflows n8n « … TM ».
export function createApiMiddlewares(env, { fetcher = fetch } = {}) {
 const client = createN8nClient(env, fetcher);
 const store = createN8nStore(client, env);
 // Réception DataTaxi (DATATAXI_TOKEN + SQLITE_PATH) : journal de répartition Fraxion dans la table dispatch_events.
 const dispatchMiddleware = env.DATATAXI_TOKEN && env.SQLITE_PATH ? [createDatataxiMiddleware({ store: openDispatchStore(env.SQLITE_PATH), env })] : [];
 const auth = createAuthMiddleware({ store, env });
 const registration = createRegistrationMiddleware({ store, auth, env });
 // Copie SQLite des courses (SQLITE_PATH) : active l'écriture double et la lecture locale des prévisions de compagnie.
 const rideStore = env.SQLITE_PATH ? openRideStore(env.SQLITE_PATH) : null;
 const n8nServices = createServicesProvider(client);
 const services = rideStore ? createMirroredServices({ primary: n8nServices, store: rideStore }) : n8nServices;
 const companies = createCompanyService({ provider: createCompaniesProvider(client), services });
 // Sonde de supervision (systemd, Uptime Kuma…) : aucune donnée, aucun appel à n8n.
 const health = (req, res, next) => {
  if(req.url !== '/api/health') return next();
  if(req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { error: 'Méthode non autorisée.' });
  return reply(res, client.configured() ? 200 : 503, { status: client.configured() ? 'ok' : 'n8n non configuré' });
 };
 return [
  securityHeaders(env), privateFiles, health, ...dispatchMiddleware, registration, auth,
  createServicesMiddleware({ getUser: auth.getUser, provider: services, env }),
  createAssignmentsMiddleware({ getUser: auth.getUser, provider: createAssignmentsProvider(client), env }),
  createCompaniesMiddleware({ getUser: auth.getUser, service: companies }),
  createServiceTypesMiddleware({ getUser: auth.getUser, provider: services, env }),
  createChatMiddleware({ getUser: auth.getUser, provider: createLlmProvider(env), services, companies })
 ];
}
export function apiPlugin(env) {
 const install = server => { for(const middleware of createApiMiddlewares(env)) server.middlewares.use(middleware); };
 return { name: 'taximanager-api', configureServer: install, configurePreviewServer: install };
}
