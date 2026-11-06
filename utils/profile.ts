/** Profil du chauffeur, conservé sur cet appareil et lié au compte connecté (aucun envoi au serveur). */
export interface DriverProfile { first_name: string; last_name: string; phone: string; license_number: string; vehicle: string; }

export const EMPTY_PROFILE: DriverProfile = { first_name: '', last_name: '', phone: '', license_number: '', vehicle: '' };
const key = (email: string) => 'taximanager_profile:' + email.trim().toLowerCase();

export function loadProfile(email: string): DriverProfile {
  try {
    const raw = JSON.parse(localStorage.getItem(key(email)) || '{}');
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    return { first_name: text(raw.first_name, 100), last_name: text(raw.last_name, 100), phone: text(raw.phone, 30),
      license_number: text(raw.license_number, 100), vehicle: text(raw.vehicle, 60) };
  } catch { return { ...EMPTY_PROFILE }; }
}

export function saveProfile(email: string, profile: DriverProfile): void {
  try { localStorage.setItem(key(email), JSON.stringify(profile)); } catch { throw new Error('Enregistrement impossible sur cet appareil.'); }
}

export function isProfileComplete(p: DriverProfile): boolean {
  return Boolean(p.first_name.trim() && p.last_name.trim() && p.license_number.trim());
}

/** Message d'erreur du formulaire, ou chaîne vide si tout est valide. */
export function validateProfile(p: DriverProfile): string {
  if (!p.first_name.trim()) return 'Le prénom est obligatoire.';
  if (!p.last_name.trim()) return 'Le nom est obligatoire.';
  if (!p.license_number.trim()) return 'Le numéro de permis est obligatoire.';
  if (p.phone.trim() && !/^[0-9+().\-\s]{7,30}$/.test(p.phone.trim())) return 'Numéro de téléphone invalide.';
  return '';
}
