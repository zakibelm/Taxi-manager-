import { createChatMiddleware } from './chat.mjs';
import { createLlmProvider } from './providers/openrouter.mjs';
import { privateFiles } from './files.mjs';
import { securityHeaders } from './security.mjs';
import { createAuthMiddleware } from './auth.mjs';
import { createN8nClient, createServicesProvider } from './providers/n8n.mjs';
import { createN8nStore } from './store.mjs';
import { createServicesMiddleware } from './services.mjs';
import { createServiceTypesMiddleware } from './service-types.mjs';
import { createRegistrationMiddleware } from './registration.mjs';
import { reply } from './http.mjs';
// Une seule liste ordonnée, partagée par le plugin Vite (dev/preview) et le serveur de production.
// Toutes les données (comptes, jetons, sessions, tentatives, courses) passent par les workflows n8n « … TM ».
export function createApiMiddlewares(env, { fetcher = fetch } = {}) {
 const client = createN8nClient(env, fetcher);
 const store = createN8nStore(client, env);
 const auth = createAuthMiddleware({ store, env });
 const registration = createRegistrationMiddleware({ store, auth, env });
 const services = createServicesProvider(client);
 // Sonde de supervision (systemd, Uptime Kuma…) : aucune donnée, aucun appel à n8n.
 const health = (req, res, next) => {
  if(req.url !== '/api/health') return next();
  if(req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { error: 'Méthode non autorisée.' });
  return reply(res, client.configured() ? 200 : 503, { status: client.configured() ? 'ok' : 'n8n non configuré' });
 };
 return [
  securityHeaders(env), privateFiles, health, registration, auth,
  createServicesMiddleware({ getUser: auth.getUser, provider: services, env }),
  createServiceTypesMiddleware({ getUser: auth.getUser, provider: services, env }),
  createChatMiddleware({ getUser: auth.getUser, provider: createLlmProvider(env), services })
 ];
}
export function apiPlugin(env) {
 const install = server => { for(const middleware of createApiMiddlewares(env)) server.middlewares.use(middleware); };
 return { name: 'taximanager-api', configureServer: install, configurePreviewServer: install };
}
