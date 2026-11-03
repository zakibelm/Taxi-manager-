// Types de service proposés au chauffeur. Remplaçables par SERVICE_TYPES (liste séparée par des virgules).
// « Régulier » est la forme enregistrée par le workflow n8n (qui convertit aussi l'ancien « Regular »).
export const DEFAULT_SERVICE_TYPES = ['Régulier', 'TCT', 'Olymel', 'Bombardier', 'Handami', 'James Miron'];
const TYPE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} '&.\/-]*$/u;
/** Nom de type : 1 à 40 caractères, lettres/chiffres/espaces et ' & . / - uniquement. */
export function typeName(value) {
  const result = text(value, 40).replace(/\s+/g, ' ');
  if (!TYPE_NAME.test(result) || /^autres?$/i.test(result)) throw new Error('Nom de type invalide.');
  return result;
}
/** Liste active : SERVICE_TYPES si valide, sinon la liste par défaut. */
export function serviceTypes(env = {}) {
  const custom = String(env.SERVICE_TYPES || '').split(',').map(v => v.trim()).filter(Boolean);
  try { if (custom.length) return [...new Set(custom.map(typeName))]; } catch { /* liste invalide : défaut */ }
  return DEFAULT_SERVICE_TYPES;
}
export function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error('Champs invalides ou inconnus.');
}
export function text(value, max, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('Texte invalide.');
  return value.trim();
}
export function email(value) {
  const result = text(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new Error('Courriel invalide.');
  return result;
}
// allowedTypes : liste des types actifs (serveur, qui fait autorité) ; null = format seulement (workflows n8n générés).
export function serviceInput(value, withOwner = false, allowedTypes = null) {
  object(value, ['type', 'amount', 'date', 'description', ...(withOwner ? ['driver_email'] : [])]);
  if (allowedTypes ? !allowedTypes.includes(value.type) : (typeof value.type !== 'string' || typeName(value.type) !== value.type)) throw new Error('Type invalide ou archivé.');
  if (typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount <= 0 || value.amount > 10000) throw new Error('Montant entre 0 et 10 000 $ requis.');
  if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.date) || !Number.isFinite(Date.parse(value.date)) || new Date(value.date).toISOString().replace('.000Z','Z') !== value.date.replace('.000Z','Z')) throw new Error('Date ISO UTC valide requise.');
  return { type: value.type, amount: value.amount, date: value.date, description: text(value.description ?? '', 500, false), ...(withOwner ? { driver_email: email(value.driver_email) } : {}) };
}
export function serviceId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new Error('Identifiant invalide.');
  return value;
}
export function driverInput(value) {
  object(value, ['email', 'first_name', 'last_name', 'phone', 'license_number']);
  return { email: email(value.email), first_name: text(value.first_name, 100), last_name: text(value.last_name, 100), phone: text(value.phone ?? '', 30, false), license_number: text(value.license_number, 100) };
}
