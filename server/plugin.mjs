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
import { openLocalDb, createLocalStore, createLocalAssignmentsProvider, createLocalCompaniesProvider, createLocalServicesProvider } from './local.mjs';
// Une seule liste ordonnée, partagée par le plugin Vite (dev/preview) et le serveur de production.
// Toutes les données (comptes, jetons, sessions, tentatives, courses) passent par les workflows n8n « … TM ».
export function createApiMiddlewares(env, { fetcher = fetch } = {}) {
 const client = createN8nClient(env, fetcher);
 // STORAGE=local : tout vit dans SQLite sur le VPS (n8n ne sert plus qu'à envoyer les courriels). Défaut : n8n.
 const local = env.STORAGE === 'local';
 if(local && !env.SQLITE_PATH) throw new Error('STORAGE=local exige SQLITE_PATH.');
 // Copie SQLite des courses (SQLITE_PATH) : en mode n8n, écriture double et lecture locale des prévisions de compagnie.
 const rideStore = env.SQLITE_PATH ? openRideStore(env.SQLITE_PATH) : null;
 const db = local ? openLocalDb(env.SQLITE_PATH) : null;
 const store = local ? createLocalStore(db, { client, env }) : createN8nStore(client, env);
 const auth = createAuthMiddleware({ store, env });
 const registration = createRegistrationMiddleware({ store, auth, env });
 const services = local ? createLocalServicesProvider(rideStore)
  : rideStore ? createMirroredServices({ primary: createServicesProvider(client), store: rideStore }) : createServicesProvider(client);
 const assignments = local ? createLocalAssignmentsProvider(db) : createAssignmentsProvider(client);
 const companies = createCompanyService({ provider: local ? createLocalCompaniesProvider(db) : createCompaniesProvider(client), services });
 // Sonde de supervision (systemd, Uptime Kuma…) : aucune donnée, aucun appel à n8n.
 const health = (req, res, next) => {
  if(req.url !== '/api/health') return next();
  if(req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { error: 'Méthode non autorisée.' });
  const ready = local || client.configured();
  return reply(res, ready ? 200 : 503, { status: ready ? 'ok' : 'n8n non configuré' });
 };
 return [
  securityHeaders(env), privateFiles, health, registration, auth,
  createServicesMiddleware({ getUser: auth.getUser, provider: services, env }),
  createAssignmentsMiddleware({ getUser: auth.getUser, provider: assignments, env }),
  createCompaniesMiddleware({ getUser: auth.getUser, service: companies }),
  createServiceTypesMiddleware({ getUser: auth.getUser, provider: services, env }),
  createChatMiddleware({ getUser: auth.getUser, provider: createLlmProvider(env), services, companies })
 ];
}
export function apiPlugin(env) {
 const install = server => { for(const middleware of createApiMiddlewares(env)) server.middlewares.use(middleware); };
 return { name: 'taximanager-api', configureServer: install, configurePreviewServer: install };
}
