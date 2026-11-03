import { createChatMiddleware } from './chat.mjs';
import { createOpenRouterProvider } from './providers/openrouter.mjs';
import { privateFiles } from './files.mjs';
import { securityHeaders } from './security.mjs';
import { createAuthMiddleware } from './auth.mjs';
import { createN8nClient, createServicesProvider } from './providers/n8n.mjs';
import { createN8nStore } from './store.mjs';
import { createServicesMiddleware } from './services.mjs';
import { createServiceTypesMiddleware } from './service-types.mjs';
import { createRegistrationMiddleware } from './registration.mjs';
// Une seule liste ordonnée, partagée par le plugin Vite (dev/preview) et le serveur de production.
// Toutes les données (comptes, jetons, sessions, tentatives, courses) passent par les workflows n8n « … TM ».
export function createApiMiddlewares(env, { fetcher = fetch } = {}) {
 const client = createN8nClient(env, fetcher);
 const store = createN8nStore(client, env);
 const auth = createAuthMiddleware({ store, env });
 const registration = createRegistrationMiddleware({ store, auth, env });
 const services = createServicesProvider(client);
 return [
  securityHeaders(env), privateFiles, registration, auth,
  createServicesMiddleware({ getUser: auth.getUser, provider: services, env }),
  createServiceTypesMiddleware({ getUser: auth.getUser, env }),
  createChatMiddleware({ getUser: auth.getUser, provider: createOpenRouterProvider(env), services })
 ];
}
export function apiPlugin(env) {
 const install = server => { for(const middleware of createApiMiddlewares(env)) server.middlewares.use(middleware); };
 return { name: 'taximanager-api', configureServer: install, configurePreviewServer: install };
}
