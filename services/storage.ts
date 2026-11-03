import { Service, ServiceTypeEntry, AIConversation, UserSession, UserSettings } from '../types';



const DEMO_SERVICES = 'taximanager_demo_services';

const DEMO_CHAT = 'taximanager_demo_chat';
const DEMO_TYPES = 'taximanager_demo_types';
export const DEFAULT_SERVICE_TYPES = ['Régulier', 'TCT', 'Olymel', 'Bombardier', 'Handami', 'James Miron'];
const TYPE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} '&.\/-]*$/u;
/** Même règle que le serveur : 1 à 40 caractères, lettres, chiffres, espaces et ' & . / - */
export function normalizeTypeName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 40 || !TYPE_NAME.test(name)) throw new Error('Nom invalide : 1 à 40 caractères, lettres, chiffres, espaces et \' & . / - seulement.');
  return name;
}

const DEFAULT_SETTINGS: UserSettings = { enableRAG: true };

class BackendService {
  constructor() { localStorage.removeItem('user_settings'); }

  private demo = false;

  private conversations: AIConversation[] = [];

  private async api(path: string, method = 'GET', body?: unknown) {

    const response = await fetch(path, { method, credentials: 'same-origin',

      headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'Service indisponible.');

    return data;

  }

  async login(identifier: string, password: string): Promise<UserSession> {

    const session = await this.api('/api/auth/login', 'POST', { identifier, password });

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

    const response = await fetch('/api/auth/session', { credentials: 'same-origin' });

    if (!response.ok) throw new Error('Session indisponible.');
    const data = await response.json();
    return data && data.user ? data : null;

  }

  async logout(): Promise<void> {

    if (!this.demo) await this.api('/api/auth/logout', 'POST');

    this.demo = false;

    this.conversations = [];

    sessionStorage.removeItem('taximanager_demo');

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

  async getServices(): Promise<Service[]> {

    if (this.demo) return this.demoRows();

    return (await this.api('/api/services')).services;

  }

  async addService(data: Pick<Service, 'type' | 'amount' | 'date' | 'description'>): Promise<Service> {

    if (!this.demo) return (await this.api('/api/services', 'POST', data)).service;

    const value = { ...data, id: crypto.randomUUID(), driver_email: 'demo@example.test', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };

    localStorage.setItem(DEMO_SERVICES, JSON.stringify([value, ...this.demoRows()]));

    return value;

  }

  async deleteService(id: string): Promise<void> {

    if (!this.demo) { await this.api('/api/services/' + encodeURIComponent(id), 'DELETE'); return; }

    localStorage.setItem(DEMO_SERVICES, JSON.stringify(this.demoRows().filter(s => s.id !== id)));

  }

  // --- Types de service (liste fixée sur le serveur ; en démo, modifiable localement) ---
  private demoTypes(): ServiceTypeEntry[] {
    try { const rows = JSON.parse(localStorage.getItem(DEMO_TYPES) || 'null'); if (Array.isArray(rows)) return rows; } catch {}
    return DEFAULT_SERVICE_TYPES.map(name => ({ name, active: true }));
  }
  async getServiceTypes(): Promise<ServiceTypeEntry[]> {
    if (this.demo) return this.demoTypes();
    return (await this.api('/api/service-types')).types;
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

  async sendChatMessage(message: string, context?: unknown): Promise<AIConversation> {

    const response = this.demo ? '(Démo) Réponse simulée : aucune requête envoyée à un fournisseur externe.' : (await this.api('/api/chat', 'POST', { message, includeServices: this.getSettings().enableRAG })).response;

    const conversation: AIConversation = { id: crypto.randomUUID(), driver_email: 'demo@example.test', user_message: message,

      ai_response: response, context_data: null, created_at: new Date().toISOString() };

    if (this.demo) localStorage.setItem(DEMO_CHAT, JSON.stringify([...this.getConversations(), conversation]));

    else this.conversations.push(conversation);

    return conversation;

  }

}

export const backend = new BackendService();

