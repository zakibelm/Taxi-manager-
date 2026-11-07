// Écriture double : n8n reste la source d'écriture principale (réponse au client), puis la course est copiée dans SQLite.
// Un échec SQLite n'empêche jamais d'enregistrer une course : il est journalisé et rattrapé par la réconciliation quotidienne.
export function createMirroredServices({ primary, store, log = console.error }) {
 const safe = (what, fn) => { try { return fn(); } catch(error) { log(`[sqlite] ${what} a échoué : ${error.message}`); return null; } };
 return {
  list: user => primary.list(user),
  async create(data, id) {
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
