// Écriture double : n8n reste la source d'écriture principale (réponse au client), puis la course est copiée dans SQLite.
// Un échec SQLite n'empêche jamais d'enregistrer une course : il est journalisé et rattrapé par la réconciliation quotidienne.
export function createMirroredServices({ primary, store, log = console.error }) {
 const safe = (what, fn) => { try { return fn(); } catch(error) { log(`[sqlite] ${what} a échoué : ${error.message}`); return null; } };
 return {
  /** n8n (période récente) + SQLite (historique) : n8n l'emporte en cas de doublon. Rien à changer côté application. */
  async list(user) {
   const recent = await primary.list(user);
   const seen = new Set(recent.map(r => r.id ?? r.service_id));
   const older = safe('lecture de l’historique', () => user.role === 'admin' ? store.listAll() : store.listByDriver(user.email)) ?? [];
   return [...recent, ...older.filter(r => !seen.has(r.id))];
  },
  async create(data, id) {
   // Contrôle sur la base elle-même (pas sur la liste du chauffeur) : un identifiant d'un autre chauffeur est refusé avant tout envoi à n8n.
   if(id) { const owner = store.get(id); if(owner && owner.driver_email !== data.driver_email) throw Object.assign(new Error('Identifiant déjà utilisé.'), { status: 409 }); }
   const created = await primary.create(data, id);
   safe('copie de la course', () => store.upsert({ ...data, ...created, service_id: created?.service_id ?? created?.id ?? id }));
   return created;
  },
  async delete(id, owner) {
   await primary.delete(id, owner);
   safe('suppression de la course', () => store.remove(id, owner));
  },
  /** Courses (avec courriel du chauffeur) d'un ensemble de chauffeurs : lues dans SQLite, jamais dans n8n. */
  ridesFor: emails => store.listByDrivers(emails),
  /** Effacement des courses d'un chauffeur dans la copie (suppression de compte). */
  removeDriver: email => store.removeDriver(email),
  get version() { return store.version; }
 };
}
