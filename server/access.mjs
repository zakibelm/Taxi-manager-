import { adminEmails, normalizeEmail } from './store.mjs';

/**
 * Liste des chauffeurs autorisés (ALLOWED_EMAILS) : courriels complets ou domaines « @entreprise.ca », séparés par
 * des virgules. Vide : inscription ouverte à toute adresse confirmée. Non vide : seuls ces courriels (et ceux de
 * ADMIN_EMAILS) peuvent s'inscrire et se connecter ; retirer une adresse ferme ses sessions à la requête suivante.
 */
export function createAccessPolicy(env = process.env) {
 const admins = adminEmails(env);
 const entries = String(env.ALLOWED_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean);
 const emails = new Set(entries.filter(e => !e.startsWith('@')));
 const domains = new Set(entries.filter(e => e.startsWith('@')).map(e => e.slice(1)));
 const restricted = entries.length > 0;
 return {
  restricted,
  allowed(value) {
   const email = normalizeEmail(value || '');
   if(!restricted || admins.has(email)) return true;
   return emails.has(email) || domains.has(email.slice(email.lastIndexOf('@') + 1));
  }
 };
}
