import { isIP } from 'node:net';
export function clientIP(req, env = process.env) {
 if(env.TRUST_PROXY==='1') {
  // Only enable behind a reverse proxy which OVERWRITES X-Forwarded-For.
  const value=req.headers['x-forwarded-for']?.split(',')[0].trim();
  if(value && isIP(value)) return value;
 }
 return req.socket.remoteAddress || 'local';
}
const WINDOW = 15 * 60 * 1000;
const MAX_ENTRIES = 10000;
const IP_FREE_FAILURES = 20;      // failures tolerated per IP (any identifier) before backoff
const ACCOUNT_FREE_FAILURES = 30; // failures tolerated per identifier (any IP) before backoff
const delay = (count, free) => count <= free ? 0 : Math.min(60000, 1000 * 2 ** Math.min(count - free - 1, 6));
/**
 * Three independent counters share one 15-minute window:
 *  - ip|identifier : fine-grained backoff (starts at 1 s),
 *  - ip            : stops one address rotating identifiers to dodge the backoff,
 *  - identifier    : stops a spread-out attack on one account (capped at 60 s so it cannot lock the owner out).
 * When a table is full, untracked keys fail closed instead of evicting the oldest entry,
 * so flooding the table can never erase the backoff of a targeted account.
 */
export function createLoginLimiter(now = Date.now) {
 const entries = new Map(), byIp = new Map(), byAccount = new Map();
 const split = key => { const i = key.indexOf('|'); return i < 0 ? ['', key] : [key.slice(0, i), key.slice(i + 1)]; };
 const purge = map => { for(const [k, v] of map) if(v.expires <= now()) map.delete(k); };
 const cleanup = () => { purge(entries); purge(byIp); purge(byAccount); };
 const bump = (map, key, free) => {
  const count = (map.get(key)?.count || 0) + 1;
  map.set(key, { count, next: now() + delay(count, free), expires: now() + WINDOW });
 };
 return {
  retryAfter(key) {
   cleanup();
   const [ip, account] = split(key);
   const next = Math.max(entries.get(key)?.next || 0, byIp.get(ip)?.next || 0, byAccount.get(account)?.next || 0);
   const wait = Math.max(0, Math.ceil((next - now()) / 1000));
   if(wait) return wait;
   const full = (map, k) => map.size >= MAX_ENTRIES && !map.has(k);
   return full(entries, key) || full(byIp, ip) || full(byAccount, account) ? 60 : 0;
  },
  failure(key) {
   cleanup();
   const [ip, account] = split(key);
   const full = (map, k) => map.size >= MAX_ENTRIES && !map.has(k);
   if(full(entries, key) || full(byIp, ip) || full(byAccount, account)) return;
   bump(entries, key, 0); bump(byIp, ip, IP_FREE_FAILURES); bump(byAccount, account, ACCOUNT_FREE_FAILURES);
  },
  success(key) {
   // Only the exact pair and the account counter reset; the IP counter is kept so that one valid
   // login cannot be used to erase the failures of a guessing run from the same address.
   const [, account] = split(key);
   entries.delete(key); byAccount.delete(account);
  }
 };
}
