// Standalone production server: API middlewares + static dist/ (no Vite). Run: npm run build && npm start
import { llmBase, llmConfigured, llmModel } from './providers/openrouter.mjs';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApiMiddlewares } from './plugin.mjs';
import { n8nBase } from './providers/n8n.mjs';
import { createAccessPolicy } from './access.mjs';

const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml',
 '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff', '.txt':'text/plain; charset=utf-8', '.map':'application/json' };

function compose(middlewares) {
 return (req, res, done) => {
  let index = 0;
  const next = error => {
   if(error) { res.statusCode = 500; return res.end('Erreur interne.'); }
   const middleware = middlewares[index++];
   if(!middleware) return done();
   try { Promise.resolve(middleware(req, res, next)).catch(next); } catch(e) { next(e); }
  };
  next();
 };
}

async function serveStatic(req, res, distRoot) {
 if(req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); return res.end('Méthode non autorisée.'); }
 const url = new URL(req.url, 'http://local');
 if(url.pathname === '/api' || url.pathname.startsWith('/api/')) {
  res.statusCode = 404; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify({ error: 'Introuvable.' }));
 }
 let pathname;
 try { pathname = decodeURIComponent(url.pathname); } catch { res.statusCode = 400; return res.end(); }
 if(pathname.includes('\0') || pathname.includes('\\')) { res.statusCode = 400; return res.end(); }
 const hasExtension = path.extname(pathname) !== '';
 let target = path.join(distRoot, path.normalize(pathname));
 const inside = file => { const rel = path.relative(distRoot, file); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
 if(!inside(target)) { res.statusCode = 403; return res.end('Forbidden'); }
 let info = await stat(target).catch(() => null);
 if(info?.isDirectory()) { target = path.join(target, 'index.html'); info = await stat(target).catch(() => null); }
 if(!info?.isFile()) {
  if(hasExtension) { res.statusCode = 404; return res.end('Introuvable.'); }
  target = path.join(distRoot, 'index.html'); info = await stat(target).catch(() => null);   // SPA fallback
  if(!info?.isFile()) { res.statusCode = 404; return res.end('Introuvable.'); }
 }
 // Resolve symlinks so a link inside dist/ cannot reach files elsewhere.
 const real = await realpath(target).catch(() => null);
 if(!real || !inside(real)) { res.statusCode = 403; return res.end('Forbidden'); }
 const ext = path.extname(real).toLowerCase();
 res.statusCode = 200;
 res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
 res.setHeader('Content-Length', String(info.size));
 res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
 if(req.method === 'HEAD') return res.end();
 createReadStream(real).on('error', () => res.destroy()).pipe(res);
}

export function createHandler(env, { distDir, fetcher }) {
 const distRoot = path.resolve(distDir);
 const run = compose(createApiMiddlewares(env, fetcher ? { fetcher } : {}));
 return (req, res) => run(req, res, () => serveStatic(req, res, distRoot).catch(() => { if(!res.headersSent) res.statusCode = 500; res.end(); }));
}

/** Réglages manquants ou risqués, signalés au démarrage (journal systemd). */
export function configWarnings(env) {
 const list = [];
 const production = env.NODE_ENV === 'production';
 if(!n8nBase(env)) list.push('N8N_URL (HTTPS) et N8N_TOKEN manquants : connexion et courses renverront 503 (la démo reste disponible).');
 if(production && !env.PUBLIC_URL) list.push('PUBLIC_URL manquante : inscription et mot de passe oublié renverront 503.');
 if(production && env.PUBLIC_URL && !/^https:\/\//.test(env.PUBLIC_URL)) list.push('PUBLIC_URL doit commencer par https:// en production.');
 if(!env.HMAC_SECRET) list.push('HMAC_SECRET absent : le jeton n8n sert de clé HMAC. Générez un secret dédié.');
 if(!String(env.ADMIN_EMAILS || '').trim()) list.push('ADMIN_EMAILS vide : aucun administrateur.');
 if(!llmConfigured(env)) list.push('LLM_BASE_URL (OmniRoute) ou OPENROUTER_API_KEY absent : l’assistant renverra 503.');
 else if(!llmBase(env)) list.push('LLM_BASE_URL invalide : HTTPS requis (HTTP accepté seulement en réseau privé / Tailscale).');
 else if(!llmModel(env)) list.push('Modèle payant refusé : sur OpenRouter, seuls openrouter/free et les modèles :free sont acceptés.');
 if(env.MAIL_PROVIDER === 'log' && production) list.push('MAIL_PROVIDER=log : les liens de connexion sont écrits dans le journal. À réserver à l’amorçage.');
 if(production && !createAccessPolicy(env).restricted) list.push('ALLOWED_EMAILS vide : toute adresse confirmée peut s’inscrire et utiliser l’assistant.');
 return list;
}

export function startServer(env = process.env) {
 const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
 const settings = { ...env, NODE_ENV: env.NODE_ENV || 'production' };
 for(const warning of configWarnings(settings)) console.warn('[configuration] ' + warning);
 const server = createServer(createHandler(settings, { distDir: path.join(root, 'dist') }));
 server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000; server.maxRequestsPerSocket = 1000;
 const port = Number(settings.PORT || 3012), host = settings.HOST || '127.0.0.1';
 server.listen(port, host, () => console.log(`Taxi Manager (${settings.NODE_ENV}) : http://${host}:${port} — HTTPS requis devant ce serveur en production.`));
 // Arrêt propre (systemctl restart, mise à jour) : les requêtes en cours se terminent, 10 s au plus.
 const stop = signal => {
  console.log(`${signal} reçu : arrêt du serveur.`);
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  setTimeout(() => process.exit(0), 10000).unref();
 };
 process.once('SIGTERM', stop); process.once('SIGINT', stop);
 return server;
}

// Lancement direct (node server/main.mjs) ou via pm2, qui charge le script depuis son propre conteneur.
const launchedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const launchedByPm2 = process.env.pm_exec_path && import.meta.url === pathToFileURL(process.env.pm_exec_path).href;
if(launchedDirectly || launchedByPm2) startServer();
