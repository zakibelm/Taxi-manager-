// Compagnie d'appartenance : appels au serveur (la liste, les adhésions et les prévisions de compagnie vivent côté serveur).
export interface Company { id: string; name: string; active: boolean; }
export interface MyMembership { companyId: string; companyName: string; status: 'pending' | 'approved' | 'rejected'; share: boolean; }
export interface MembershipRow { email: string; companyId: string; companyName: string; status: 'pending' | 'approved' | 'rejected'; share: boolean; requestedAt: string | null; decidedAt: string | null; }
export interface CompanySpot { lat: number; lng: number; radiusKm: number; count: number; share: number; averageAmount: number; topType: string; ratio: number; level: 'forte' | 'moyenne' | 'faible'; }
export interface CompanyRecommendZone { zone: string; lat: number; lng: number; count: number; share: number; averageAmount: number; topType: string; topTypeShare: number; }
export interface CompanyZones {
  company: { name: string }; minDrivers: number; sharing: number; contributors: number;
  status: 'ok' | 'insufficient';
  recommend?: { day: string; slot: string; status: 'ok' | 'insufficient'; basis: 'day-slot' | 'slot' | 'all' | null; sample: number; located: number; needed?: number; zones: CompanyRecommendZone[] };
  spots?: { status: 'ok' | 'insufficient'; located: number; spots: CompanySpot[] };
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new Error('Pas de connexion.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Service indisponible.');
  return data as T;
}

export const companyApi = {
  companies: () => call<{ companies: Company[] }>('/api/companies').then(r => r.companies),
  createCompany: (name: string) => call<{ company: Company }>('/api/companies', 'POST', { name }).then(r => r.company),
  setCompanyActive: (id: string, active: boolean) => call<{ company: Company }>('/api/companies/' + id, 'PUT', { active }).then(r => r.company),
  membership: () => call<{ membership: MyMembership | null }>('/api/membership').then(r => r.membership),
  chooseCompany: (companyId: string | null) => call<{ membership: MyMembership | null }>('/api/membership', 'PUT', { companyId }).then(r => r.membership),
  setShare: (share: boolean) => call<{ membership: MyMembership | null }>('/api/membership', 'PUT', { share }).then(r => r.membership),
  memberships: () => call<{ memberships: MembershipRow[] }>('/api/memberships').then(r => r.memberships),
  decide: (email: string, approve: boolean) => call<{ email: string; status: string }>('/api/memberships/decision', 'POST', { email, approve }),
  zones: (slot: string | null, day: number | null) => {
    const q = new URLSearchParams();
    if (slot) q.set('slot', slot);
    if (day !== null) q.set('day', String(day));
    return call<CompanyZones>('/api/company/zones' + (q.size ? '?' + q : ''));
  },
};
