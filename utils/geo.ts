import { Capacitor } from '@capacitor/core';

export interface Origin { origin_lat: number; origin_lng: number }

/** Arrondi à 3 décimales (≈ 100 m) : on ne garde jamais plus de précision que nécessaire pour définir une zone. */
export const roundCoord = (n: number): number => Math.round(n * 1000) / 1000;

/** Position actuelle du téléphone, arrondie. Dans l'APK : plugin natif (permission Android demandée à ce moment-là) ;
 *  sur le web : navigator.geolocation. Lève une erreur au texte clair si la position est refusée ou introuvable. */
export async function currentOrigin(): Promise<Origin> {
  let lat: number, lng: number;
  try {
    if (Capacitor.isNativePlatform()) {
      const { Geolocation } = await import('@capacitor/geolocation');
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
        const asked = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
        if (asked.location !== 'granted' && asked.coarseLocation !== 'granted') throw new Error('denied');
      }
      const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
      lat = p.coords.latitude; lng = p.coords.longitude;
    } else {
      if (!('geolocation' in navigator)) throw new Error('unsupported');
      const p = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }));
      lat = p.coords.latitude; lng = p.coords.longitude;
    }
  } catch (e) {
    const code = (e as { code?: number }).code, msg = String((e as Error)?.message ?? e).toLowerCase();
    if (msg.includes('denied') || code === 1) throw new Error('Localisation refusée : autorisez-la dans les réglages de l’application, ou décochez la case.');
    if (msg.includes('unsupported')) throw new Error('La localisation n’est pas disponible sur cet appareil.');
    throw new Error('Position introuvable. Activez la localisation du téléphone (GPS) et réessayez.');
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Position introuvable. Réessayez.');
  return { origin_lat: roundCoord(lat), origin_lng: roundCoord(lng) };
}
