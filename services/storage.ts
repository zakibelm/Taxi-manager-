import type { Assignment, Service, ServiceTypeEntry, AIConversation, UserSession, UserSettings } from '../types.ts';



const DEMO_SERVICES = 'taximanager_demo_services';

const DEMO_CHAT = 'taximanager_demo_chat';
const DEMO_TYPES = 'taximanager_demo_types';
const DEMO_ASSIGNMENTS = 'taximanager_demo_assignments';
export const DEFAULT_SERVICE_TYPES = ['Régulier', 'TCT', 'Olymel', 'Bombardier', 'Handami', 'James Miron'];
const TYPE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} '&.\/-]*$/u;
/** Même règle que le serveur : 1 à 40 caractères, lettres, chiffres, espaces et ' & . / - */
export function normalizeTypeName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 40 || !TYPE_NAME.test(name)) throw new Error('Nom invalide : 1 à 40 caractères, lettres, chiffres, espaces et \' & . / - seulement.');
  return name;
}

/** Type saisi via « Autre » : validé, refuse « Autre » lui-même, et reprend la forme existante si le nom est déjà connu (casse ignorée). */
export function resolveNewType(value: string, known: string[]): string {
  const name = normalizeTypeName(value);
  if (/^autres?$/i.test(name)) throw new Error('Donnez un nom précis au service (pas « Autre »).');
  return known.find(k => k.toLowerCase() === name.toLowerCase()) ?? name;
}

const DEFAULT_SETTINGS: UserSettings = { enableRAG: true };

// --- Hors ligne : file d'envoi et dernière liste connue (téléphone du chauffeur uniquement, vidées à la déconnexion) ---
const PENDING = 'taximanager_pending_services';
const CACHE = 'taximanager_services_cache';
type NewService = Pick<Service, 'type' | 'amount' | 'date' | 'description' | 'origin_lat' | 'origin_lng'>;
type PendingService = NewService & { id: string; driver_email: string; created_at: string };
/** Erreur réseau (pas de connexion, serveur injoignable) : distincte d'un refus du serveur. */
class OfflineError extends Error {}
/** Refus du serveur, avec son code HTTP (401 = session expirée). */
export class ApiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }
const readJson = <T,>(key: string, fallback: T): T => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; } };

/** Export CSV (séparateur « ; », lisible par Excel en français ; montants en $ CA). */
export function servicesToCsv(rows: Service[]): string {
  const cell = (v: unknown) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [['Date', 'Type', 'Montant ($ CA)', 'Note', 'Chauffeur', 'Statut'].join(';')];
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date)))
    lines.push([r.date.slice(0, 10), r.type, r.amount.toFixed(2).replace('.', ','), r.description ?? '', r.driver_email, r.pending ? 'En attente d’envoi' : 'Enregistrée'].map(cell).join(';'));
  return '\uFEFF' + lines.join('\r\n');
}

class BackendService {
  constructor() { localStorage.removeItem('user_settings'); }

  private demo = false;
  /** Courriel du compte connecté : la file hors ligne et le cache ne servent qu'à ce compte. */
  private email = '';

  private conversations: AIConversation[] = [];

  private async api(path: string, method = 'GET', body?: unknown) {

    let response: Response;
    try {
      response = await fetch(path, { method, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new OfflineError('Pas de connexion.'); }
    const data = await response.json().catch(() => ({}));

    if (!response.ok) throw new ApiError(data.error || 'Service indisponible.', response.status);

    return data;

  }

  async login(identifier: string, password: string): Promise<UserSession> {

    const session = await this.api('/api/auth/login', 'POST', { identifier, password });
    this.email = session.user.email;
    localStorage.setItem('taximanager_last_user', JSON.stringify({ email: session.user.email, user: session.user }));

    this.demo = false;

    sessionStorage.removeItem('taximanager_demo');

    this.conversations = [];

    return session;

  }

  // --- Inscription, confirmation, mot de passe oublié ---
  async register(email: string, name: string): Promise<string> { return (await this.api('/api/auth/register', 'POST', { email, name })).message; }
  async verifyEmail(token: string, password: string): Promise<{ status: string; message: string }> { return this.api('/api/auth/verify', 'POST', { token, password }); }
  async forgotPassword(email: string): Promise<string> { return (await this.api('/api/auth/forgot', 'POST', { email })).message; }
  async resetPassword(token: string, password: string): Promise<string> { return (await this.api('/api/auth/reset', 'POST', { token, password })).message; }
  async getSession(): Promise<UserSession | null> {

    if (sessionStorage.getItem('taximanager_demo') === '1') return this.loginDemo();

    let response: Response;
    try { response = await fetch('/api/auth/session', { credentials: 'same-origin' }); }
    catch {
      // Hors ligne : on garde la dernière identité connue pour permettre la saisie ; le serveur revérifie à l'envoi.
      const last = readJson<{ email?: string; user?: UserSession['user'] }>('taximanager_last_user', {});
      if (last.user) { this.email = last.user.email; return { user: last.user }; }
      throw new Error('Session indisponible.');
    }
    if (!response.ok) throw new Error('Session indisponible.');
    const data = await response.json();
    this.email = data?.user?.email || '';
    if (data && data.user) localStorage.setItem('taximanager_last_user', JSON.stringify({ email: data.user.email, user: data.user }));
    else localStorage.removeItem('taximanager_last_user');
    return data && data.user ? data : null;

  }

  async logout(): Promise<void> {

    if (!this.demo) await this.api('/api/auth/logout', 'POST').catch(() => {});

    this.demo = false; this.email = '';
    // Courses en attente et cache : liés à ce téléphone et à ce compte, jamais laissés à l'utilisateur suivant.
    localStorage.removeItem(PENDING); localStorage.removeItem(CACHE); localStorage.removeItem('taximanager_last_user'); localStorage.removeItem('taximanager_types_cache');

    this.conversations = [];

    sessionStorage.removeItem('taximanager_demo');

  }

  /** Suppression définitive du compte et de toutes ses données (serveur), puis nettoyage de cet appareil. Exige le mot de passe. */
  async deleteAccount(password: string): Promise<void> {

    if (this.demo || !this.email) throw new ApiError('Aucun compte à supprimer en mode démo.', 400);

    await this.api('/api/account/delete', 'POST', { identifier: this.email, password, confirm: true });

    localStorage.removeItem('taximanager_profile:' + this.email.trim().toLowerCase());
    localStorage.removeItem(PENDING); localStorage.removeItem(CACHE); localStorage.removeItem('taximanager_last_user'); localStorage.removeItem('taximanager_types_cache');

    this.email = ''; this.conversations = [];

  }

  async loginDemo(): Promise<UserSession> {

    this.demo = true;

    sessionStorage.setItem('taximanager_demo', '1');

    return { mode: 'demo', user: { id: 'demo', email: 'demo@example.test', name: 'Chauffeur démo', role: 'chauffeur' } };

  }

  private demoRows(): Service[] {

    const saved = localStorage.getItem(DEMO_SERVICES);

    if (saved) { try { const rows = JSON.parse(saved); if (Array.isArray(rows)) return rows; } catch {} }

    const rows: Service[] = [45.5, 32, 120].map((amount, i) => ({ id: crypto.randomUUID(), driver_email: 'demo@example.test', type: 'Régulier', amount,

      date: new Date(Date.now() - i * 86400000).toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));

    localStorage.setItem(DEMO_SERVICES, JSON.stringify(rows));

    return rows;

  }

  private allPending(): PendingService[] { const rows = readJson<PendingService[]>(PENDING, []); return Array.isArray(rows) ? rows : []; }
  /** File du compte connecté seulement : une course saisie par un autre chauffeur n'est jamais envoyée sous ce compte. */
  private pending(): PendingService[] { return this.email ? this.allPending().filter(p => p.driver_email === this.email) : []; }
  /** Remplace la file du compte connecté, sans toucher à celle des autres comptes de ce téléphone. */
  private savePending(rows: PendingService[]) {
    const all = [...this.allPending().filter(p => p.driver_email !== this.email), ...rows];
    if (all.length) localStorage.setItem(PENDING, JSON.stringify(all)); else localStorage.removeItem(PENDING);
  }
  private asService(p: PendingService): Service { return { ...p, updated_at: p.created_at, pending: true }; }
  /** Nombre de courses saisies hors ligne pas encore envoyées. */
  pendingCount(): number { return this.demo ? 0 : this.pending().length; }

  /** Envoie la file d'attente ; chaque course porte son identifiant, un renvoi ne crée donc pas de doublon. */
  async flushPending(): Promise<number> {
    if (this.demo) return 0;
    let sent = 0;
    for (const p of this.pending()) {
      try {
        await this.api('/api/services', 'POST', { id: p.id, type: p.type, amount: p.amount, date: p.date, description: p.description ?? '', ...(p.origin_lat !== undefined && p.origin_lng !== undefined ? { origin_lat: p.origin_lat, origin_lng: p.origin_lng } : {}) });
        this.savePending(this.pending().filter(x => x.id !== p.id)); sent++;
      } catch (error) {
        if (error instanceof OfflineError) break;            // toujours hors ligne : on réessaiera
        if (error instanceof ApiError && error.status === 401) break; // session expirée : garder pour après reconnexion
        // Refus définitif (type archivé, montant invalide…) : la course reste en file, visible, à supprimer par le chauffeur.
      }
    }
    return sent;
  }

  async getServices(): Promise<Service[]> {

    if (this.demo) return this.demoRows();

    await this.flushPending().catch(() => 0);
    let rows: Service[];
    try {
      rows = (await this.api('/api/services')).services;
      localStorage.setItem(CACHE, JSON.stringify({ email: this.email, rows }));
    } catch (error) {
      if (!(error instanceof OfflineError)) throw error;
      // Hors ligne : dernière liste connue, seulement si elle appartient à ce compte.
      const cached = readJson<{ email?: string; rows?: Service[] }>(CACHE, {});
      rows = cached.email === this.email && Array.isArray(cached.rows) ? cached.rows : [];
    }
    const known = new Set(rows.map(r => r.id));
    return [...this.pending().filter(p => !known.has(p.id)).map(p => this.asService(p)), ...rows];

  }

  async addService(data: NewService): Promise<Service> {

    if (!this.demo) {
      const id = crypto.randomUUID();
      try { return (await this.api('/api/services', 'POST', { ...data, id })).service; }
      catch (error) {
        if (!(error instanceof OfflineError)) throw error;
        // Pas de réseau : la course est gardée sur le téléphone et envoyée au retour de la connexion.
        if (!this.email) throw new Error('Pas de connexion et aucun compte connu : reconnectez-vous pour enregistrer la course.');
        const p: PendingService = { ...data, description: data.description ?? '', id, driver_email: this.email, created_at: new Date().toISOString() };
        this.savePending([...this.pending(), p]);
        return this.asService(p);
      }
    }

    const value = { ...data, id: crypto.randomUUID(), driver_email: 'demo@example.test', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };

    localStorage.setItem(DEMO_SERVICES, JSON.stringify([value, ...this.demoRows()]));

    return value;

  }

  async deleteService(id: string): Promise<void> {

    if (!this.demo) {
      if (this.pending().some(p => p.id === id)) { this.savePending(this.pending().filter(p => p.id !== id)); return; }
      await this.api('/api/services/' + encodeURIComponent(id), 'DELETE'); return;
    }

    localStorage.setItem(DEMO_SERVICES, JSON.stringify(this.demoRows().filter(s => s.id !== id)));

  }

  // --- Assignations planifiées (Calendrier) : en ligne uniquement ; en démo, gardées sur l'appareil ---
  private demoAssignments(): Assignment[] {
    try { const rows = JSON.parse(localStorage.getItem(DEMO_ASSIGNMENTS) || '[]'); return Array.isArray(rows) ? rows : []; } catch { return []; }
  }
  async getAssignments(): Promise<Assignment[]> {
    if (this.demo) return this.demoAssignments();
    return (await this.api('/api/assignments')).assignments;
  }
  async addAssignment(data: Pick<Assignment, 'type' | 'date' | 'description'>): Promise<Assignment> {
    const id = crypto.randomUUID();
    if (!this.demo) {
      try { return (await this.api('/api/assignments', 'POST', { ...data, id })).assignment; }
      catch (error) { if (error instanceof OfflineError) throw new Error('Pas de connexion : l’assignation n’a pas été enregistrée. Réessayez avec du réseau.'); throw error; }
    }
    const row: Assignment = { ...data, id, driver_email: 'demo@example.test', created_at: new Date().toISOString() };
    localStorage.setItem(DEMO_ASSIGNMENTS, JSON.stringify([...this.demoAssignments(), row]));
    return row;
  }
  async deleteAssignment(id: string): Promise<void> {
    if (!this.demo) { await this.api('/api/assignments/' + encodeURIComponent(id), 'DELETE'); return; }
    localStorage.setItem(DEMO_ASSIGNMENTS, JSON.stringify(this.demoAssignments().filter(a => a.id !== id)));
  }

  // --- Types de service (liste fixée sur le serveur ; en démo, modifiable localement) ---
  private demoTypes(): ServiceTypeEntry[] {
    try { const rows = JSON.parse(localStorage.getItem(DEMO_TYPES) || 'null'); if (Array.isArray(rows)) return rows; } catch {}
    return DEFAULT_SERVICE_TYPES.map(name => ({ name, active: true }));
  }
  async getServiceTypes(): Promise<ServiceTypeEntry[]> {
    if (this.demo) return this.demoTypes();
    try {
      const types = (await this.api('/api/service-types')).types;
      localStorage.setItem('taximanager_types_cache', JSON.stringify(types));
      return types;
    } catch (error) {
      if (!(error instanceof OfflineError)) throw error;
      const cached = readJson<ServiceTypeEntry[] | null>('taximanager_types_cache', null);
      if (Array.isArray(cached) && cached.length) return cached;
      throw error;
    }
  }
  async addServiceType(value: string): Promise<ServiceTypeEntry[]> {
    const name = normalizeTypeName(value);
    if (!this.demo) return (await this.api('/api/service-types', 'POST', { name })).types;
    const types = this.demoTypes();
    const existing = types.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (existing?.active) throw new Error('Ce type existe déjà.');
    const next = existing ? types.map(t => t === existing ? { ...t, active: true } : t) : [...types, { name, active: true }];
    localStorage.setItem(DEMO_TYPES, JSON.stringify(next));
    return next;
  }
  async setServiceTypeActive(name: string, active: boolean): Promise<ServiceTypeEntry[]> {
    if (!this.demo) return (await this.api('/api/service-types', 'PUT', { name, active })).types;
    const types = this.demoTypes();
    if (!active && types.filter(t => t.active).length <= 1) throw new Error('Au moins un type doit rester actif.');
    const next = types.map(t => t.name === name ? { ...t, active } : t);
    localStorage.setItem(DEMO_TYPES, JSON.stringify(next));
    return next;
  }
  getSettings(): UserSettings {

    // Discard legacy provider credentials and URLs; only a non-secret preference remains.

    localStorage.removeItem('user_settings');

    try { return { enableRAG: JSON.parse(localStorage.getItem('taximanager_preferences') || '{}').enableRAG !== false }; }

    catch { return DEFAULT_SETTINGS; }

  }

  async saveSettings(settings: UserSettings) {

    localStorage.setItem('taximanager_preferences', JSON.stringify({ enableRAG: settings.enableRAG }));

  }

  getConversations(): AIConversation[] {

    if (!this.demo) return this.conversations;

    try { return JSON.parse(localStorage.getItem(DEMO_CHAT) || '[]'); } catch { return []; }

  }

  /** Modèles gratuits proposés par le serveur (liste vide en démo ou hors ligne). */
  async getChatModels(): Promise<{ models: string[]; default: string | null }> {
    if (this.demo) return { models: [], default: null };
    try { return await this.api('/api/chat/models'); } catch { return { models: [], default: null }; }
  }

  async sendChatMessage(message: string, context?: unknown, model?: string): Promise<AIConversation> {

    const response = this.demo ? '(Démo) Réponse simulée : aucune requête envoyée à un fournisseur externe.' : (await this.api('/api/chat', 'POST', { message, includeServices: this.getSettings().enableRAG, ...(model ? { model } : {}) })).response;

    const conversation: AIConversation = { id: crypto.randomUUID(), driver_email: 'demo@example.test', user_message: message,

      ai_response: response, context_data: null, created_at: new Date().toISOString() };

    if (this.demo) localStorage.setItem(DEMO_CHAT, JSON.stringify([...this.getConversations(), conversation]));

    else this.conversations.push(conversation);

    return conversation;

  }

}

export const backend = new BackendService();

