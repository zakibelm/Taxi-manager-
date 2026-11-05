// Tests de la logique de l'application (file hors ligne, cache, comptes) avec un faux navigateur et un faux serveur.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const server = { online: true, user: null, posted: [], services: [] };
const json = (status, data) => ({ ok: status < 300, status, json: async () => data });
globalThis.fetch = async (path, options = {}) => {
 if(!server.online) throw new TypeError('Failed to fetch');
 const body = options.body ? JSON.parse(options.body) : null;
 const me = server.user && { id: server.user, email: server.user, name: 'X', role: 'chauffeur' };
 if(path === '/api/auth/session') return json(200, { user: me });
 if(path === '/api/auth/login') { server.user = body.identifier; return json(200, { user: { id: body.identifier, email: body.identifier, name: 'X', role: 'chauffeur' } }); }
 if(path === '/api/auth/logout') { server.user = null; return json(200, { success: true }); }
 if(!me) return json(401, { error: 'Connexion requise.' });
 if(path === '/api/services' && options.method === 'POST') {
  const service = { ...body, driver_email: me.email, created_at: '', updated_at: '' };
  server.posted.push(service); server.services.push(service); return json(201, { service });
 }
 if(path === '/api/services') return json(200, { services: server.services.filter(s => s.driver_email === me.email) });
 return json(404, {});
};

const { backend, ApiError } = await import('./storage.ts');
const course = { type: 'TCT', amount: 12.5, date: '2026-11-05T17:00:00.000Z', description: '' };

test('hors ligne : la course est mise en file puis envoyée une seule fois au retour du réseau', async () => {
 server.user = 'ali@example.test';
 await backend.getSession();
 await backend.getServices();
 server.online = false;
 const pending = await backend.addService(course);
 assert.equal(pending.pending, true);
 assert.equal(backend.pendingCount(), 1);
 assert.equal((await backend.getServices()).length, 1, 'visible hors ligne');
 server.online = true;
 const rows = await backend.getServices();
 assert.equal(backend.pendingCount(), 0);
 assert.equal(server.posted.length, 1);
 assert.equal(server.posted[0].id, pending.id, 'même identifiant : pas de doublon possible');
 assert.equal(rows.length, 1);
 assert.ok(!rows[0].pending);
});

test('la file d’un chauffeur n’est jamais envoyée sous le compte d’un autre', async () => {
 server.online = false;
 await backend.addService(course);                    // file d'Ali
 server.online = true; server.user = null;
 assert.equal(await backend.getSession(), null);      // session d'Ali expirée
 await backend.login('bob@example.test', 'x');        // Bob sur le même téléphone
 const before = server.posted.length;
 assert.deepEqual(await backend.getServices(), [], 'Bob ne voit pas la course d’Ali');
 assert.equal(server.posted.length, before, 'rien envoyé sous Bob');
 server.online = false;
 assert.deepEqual(await backend.getServices(), [], 'ni dans le cache hors ligne');
 server.online = true; server.user = 'ali@example.test';
 await backend.getSession();
 await backend.getServices();
 assert.equal(server.posted.at(-1).driver_email, 'ali@example.test', 'envoyée sous Ali à son retour');
});

test('session expirée : erreur 401 typée, la file est conservée', async () => {
 server.online = false;
 await backend.addService(course);
 server.online = true; server.user = null;            // le serveur a oublié la session, l'application pas encore
 await assert.rejects(backend.getServices(), e => e instanceof ApiError && e.status === 401);
 assert.equal(backend.pendingCount(), 1);
});

test('déconnexion : file, cache et identité effacés du téléphone', async () => {
 server.user = 'ali@example.test';
 await backend.getSession();
 await backend.logout();
 for(const key of ['taximanager_pending_services', 'taximanager_services_cache', 'taximanager_last_user', 'taximanager_types_cache'])
  assert.equal(localStorage.getItem(key), null, key);
});
