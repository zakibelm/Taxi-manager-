// Prévisions de demande (journal de répartition DataTaxi) : un seul appel au serveur, agrégats seulement.
export interface ForecastDay { date: string; dow: number; type: 'weekday' | 'weekend'; expected: number; low: number; high: number; }
export interface ForecastZone { zone: string; share: number; }
export type ForecastSlot = '0-6' | '6-10' | '10-14' | '14-18' | '18-24';
export type Forecast =
  | { ready: false; days: number; needed: number; asOf: string | null }
  | {
      ready: true; asOf: string; days: number; events: number; method: string;
      reliability: { errorPct: number | null; level: 'bonne' | 'moyenne' | 'faible' };
      stats: Record<'weekday' | 'weekend', { expected: number; low: number; high: number; days: number }>;
      daily: ForecastDay[];
      hourly: Record<'weekday' | 'weekend', number[]>;
      peaks: Record<'weekday' | 'weekend', number[]>;
      zones: Record<'weekday' | 'weekend', Record<ForecastSlot, ForecastZone[]>>;
    };

export async function fetchForecast(): Promise<Forecast> {
  let response: Response;
  try { response = await fetch('/api/forecast', { credentials: 'same-origin' }); } catch { throw new Error('Pas de connexion.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Prévisions indisponibles.');
  return data as Forecast;
}
