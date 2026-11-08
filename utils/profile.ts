/** Profil du chauffeur : prénom, nom, type de véhicule et téléphone (facultatifs), conservés sur cet appareil et liés au compte connecté (aucun envoi au serveur).
 *  Le courriel est celui du compte ; la compagnie d'appartenance est gérée à part, sur le serveur. */
export interface DriverProfile { first_name: string; last_name: string; phone: string; vehicle: string; independent: boolean; }

export const EMPTY_PROFILE: DriverProfile = { first_name: '', last_name: '', phone: '', vehicle: '', independent: false };
const key = (email: string) => 'taximanager_profile:' + email.trim().toLowerCase();

export function loadProfile(email: string): DriverProfile {
  try {
    const raw = JSON.parse(localStorage.getItem(key(email)) || '{}');
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    return { first_name: text(raw.first_name, 100), last_name: text(raw.last_name, 100), phone: text(raw.phone, 30), vehicle: text(raw.vehicle, 60), independent: raw.independent === true };
  } catch { return { ...EMPTY_PROFILE }; }
}

export function saveProfile(email: string, profile: DriverProfile): void {
  // Remplace l'ancien profil : le numéro de permis n'est plus conservé.
  try { localStorage.setItem(key(email), JSON.stringify({ first_name: profile.first_name, last_name: profile.last_name, phone: profile.phone, vehicle: profile.vehicle, independent: profile.independent === true })); }
  catch { throw new Error('Enregistrement impossible sur cet appareil.'); }
}

export function isProfileComplete(p: DriverProfile): boolean {
  return Boolean(p.first_name.trim() && p.last_name.trim());
}

/** Message d'erreur du formulaire, ou chaîne vide si tout est valide. */
export function validateProfile(p: DriverProfile, company: { listed: boolean; chosen: boolean } = { listed: false, chosen: true }): string {
  if (!p.first_name.trim()) return 'Le prénom est obligatoire.';
  if (!p.last_name.trim()) return 'Le nom est obligatoire.';
  if (p.phone.trim() && !/^[0-9+().\-\s]{7,30}$/.test(p.phone.trim())) return 'Numéro de téléphone invalide.';
  if (company.listed && !company.chosen) return 'La compagnie est obligatoire : choisissez la vôtre, ou « Indépendant » si vous n’en avez pas.';
  return '';
}
