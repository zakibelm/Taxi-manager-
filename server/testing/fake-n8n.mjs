// Faux n8n pour les tests : reproduit le contrat des workflows « … TM » (chemins, validations utiles, réponses).
// Aucune donnée réelle, aucun réseau.
export function createFakeN8n({ token = 'test-n8n-token', header = 'x-drivepilot-token', prefix = 'taximanager-tm', now = Date.now } = {}) {
 const db = { accounts: [], tokens: [], sessions: [], attempts: [], services: [], outbox: [], calls: [] };
 const ok = (data, status = 200) => ({ ok: true, status, json: async () => ({ success: true, ...data }) });
 const fail = status => ({ ok: false, status, json: async () => ({ error: 'refusé' }) });
 const routes = {
  'GET accounts/get': ({ query }) => {
   const id = String(query.identifier || '').toLowerCase();
   const rows = db.accounts.filter(a => a.email === id || a.username === id);
   const verified = rows.filter(a => a.verified), candidates = verified.length ? verified : rows;
   return ok({ account: candidates.length === 1 ? { ...candidates[0] } : null, conflict: candidates.length > 1 });
  },
  'POST accounts/create': ({ body: b }) => {
   if(!/^[a-f0-9]{48}$/.test(b.salt) || !/^[a-f0-9]{128}$/.test(b.passwordHash) || !/^[a-f0-9]{64}$/.test(b.authVersion) || typeof b.verified !== 'boolean') return fail(400);
   db.accounts.push({ account_id: b.id, username: b.username.toLowerCase(), email: b.email.toLowerCase(), display_name: b.name, salt: b.salt,
    password_hash: b.passwordHash, role: b.role, verified: b.verified, auth_version: b.authVersion, last_mail_at: 0 });
   return ok({});
  },
  'POST accounts/verify': ({ body }) => { for(const a of db.accounts) if(a.account_id === body.id) a.verified = true; return ok({}); },
  'POST accounts/password': ({ body: b }) => {
   if(!/^[a-f0-9]{48}$/.test(b.salt) || !/^[a-f0-9]{128}$/.test(b.passwordHash) || !/^[a-f0-9]{64}$/.test(b.authVersion)) return fail(400);
   for(const a of db.accounts) if(a.account_id === b.id) Object.assign(a, { salt: b.salt, password_hash: b.passwordHash, auth_version: b.authVersion });
   return ok({});
  },
  'POST accounts/token/create': ({ body: b }) => {
   if(!['verify', 'reset'].includes(b.purpose) || !(b.expires > now()) || b.expires > now() + 86500000) return fail(400);
   db.tokens.push({ token_hash: b.hash, account_id: b.id, email: b.email, purpose: b.purpose, expires_at: b.expires, used: false, auth_version: b.authVersion });
   return ok({});
  },
  'POST accounts/token/consume': ({ body }) => {
   const row = db.tokens.find(t => t.token_hash === body.hash && t.purpose === body.purpose && !t.used && t.expires_at > now());
   if(row) row.used = true;
   return ok({ token: row ? { accountId: row.account_id, email: row.email, purpose: row.purpose, authVersion: row.auth_version } : null });
  },
  'POST accounts/email': ({ body }) => {
   const a = db.accounts.find(x => x.account_id === body.id && x.last_mail_at < now() - 300000);
   if(a) { a.last_mail_at = now(); db.outbox.push({ to: a.email, subject: body.subject, message: body.message }); }
   return ok({});
  },
  'POST auth/session/create': ({ body: b }) => {
   if(!/^[a-f0-9]{64}$/.test(b.hash) || !(b.expires > now()) || b.expires > now() + 28900000) return fail(400);
   db.sessions.push({ session_hash: b.hash, user_json: JSON.stringify(b.authVersion ? { user: b.user, authVersion: b.authVersion } : b.user), expires_at: b.expires });
   return ok({});
  },
  'GET auth/session/get': ({ query }) => {
   const row = db.sessions.find(s => s.session_hash === query.hash && s.expires_at > now());
   const value = row ? JSON.parse(row.user_json) : null;
   return ok({ session: row ? { user: value.user || value, expires: row.expires_at, ...(value.authVersion ? { authVersion: value.authVersion } : {}) } : null });
  },
  'DELETE auth/session/delete': ({ body }) => { db.sessions = db.sessions.filter(s => s.session_hash !== body.hash); return ok({}); },
  'GET auth/rate/check': ({ query }) => {
   const t = now(), rows = db.attempts.filter(x => x.created_ms > t - 900000 && !x.successful && x.ip_hash === query.ip && x.account_hash === query.account);
   return ok({ retryAfter: rows.length >= 5 ? 30 : 0 });
  },
  'POST auth/rate/record': ({ body }) => { db.attempts.push({ ip_hash: body.ip, account_hash: body.account, successful: body.successful, created_ms: now() }); return ok({}); },
  'POST services/create': ({ body }) => { const row = { ...body, created_at: new Date(now()).toISOString(), updated_at: new Date(now()).toISOString() }; db.services.push(row); return ok({ service: { ...row, id: row.service_id } }, 201); },
  'GET services/list': ({ query }) => ok({ services: db.services.filter(s => s.driver_email === query.email).map(s => ({ ...s, id: s.service_id })) }),
  'GET services/all': () => ok({ services: db.services.map(s => ({ ...s, id: s.service_id })) }),
  'DELETE services/delete': ({ body }) => { db.services = db.services.filter(s => !(s.service_id === body.id && s.driver_email === body.driver_email)); return ok({}); }
 };
 async function fetcher(href, options = {}) {
  const url = new URL(href);
  const marker = `/webhook/${prefix}/api/`;
  db.calls.push({ method: options.method || 'GET', url: href, headers: options.headers });
  if(!url.pathname.startsWith(marker)) return fail(404);
  if(options.headers?.[Object.keys(options.headers).find(k => k.toLowerCase() === header)] !== token) return fail(403);
  const route = routes[`${options.method || 'GET'} ${url.pathname.slice(marker.length)}`];
  if(!route) return fail(404);
  return route({ query: Object.fromEntries(url.searchParams), body: options.body ? JSON.parse(options.body) : {} });
 }
 return { db, fetcher, env: { N8N_URL: 'https://n8n.example.test/webhook', N8N_TOKEN: token } };
}
