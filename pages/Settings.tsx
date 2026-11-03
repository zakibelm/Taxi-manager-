import React, { useState } from 'react';
import { Archive, RotateCcw, Plus } from 'lucide-react';
import { backend } from '../services/storage';
import { ServiceTypeEntry } from '../types';

interface SettingsProps {
  serviceTypes: ServiceTypeEntry[];
  onServiceTypesChange: (types: ServiceTypeEntry[]) => void;
  /** Mode démo seulement : les changements restent dans ce navigateur (en réel, la liste est fixée sur le serveur). */
  canManageTypes: boolean;
  isDemo: boolean;
  currentUser?: { email: string; role: 'admin' | 'chauffeur' };
}

function ServiceTypesManager({ serviceTypes, onServiceTypesChange, isDemo }: Omit<SettingsProps, 'canManageTypes'>) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const active = serviceTypes.filter(t => t.active);
  const archived = serviceTypes.filter(t => !t.active);

  const run = async (action: () => Promise<ServiceTypeEntry[]>, done: string) => {
    setBusy(true); setError(''); setStatus('');
    try { onServiceTypesChange(await action()); setStatus(done); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Action impossible.'); return false; }
    finally { setBusy(false); }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = name;
    if (await run(() => backend.addServiceType(value), `« ${value.trim()} » est disponible dans le formulaire.`)) setName('');
  };

  return (
    <section aria-labelledby="types-title" className="bg-white rounded-3xl p-6 space-y-5">
      <div>
        <h3 id="types-title" className="text-lg font-bold text-slate-900">Types de service</h3>
        <p className="text-slate-600 text-sm">
          Les types actifs sont proposés aux chauffeurs dans « Nouvelle course ». Un type archivé n’est plus proposé,
          mais les courses déjà enregistrées le gardent et restent filtrables dans l’historique.
          {isDemo && ' Mode démo : les changements restent dans ce navigateur.'}
        </p>
      </div>

      <form onSubmit={add} className="flex flex-col sm:flex-row gap-3">
        <label htmlFor="new-type" className="sr-only">Nom du nouveau type</label>
        <input id="new-type" value={name} onChange={e => { setName(e.target.value); setError(''); }}
          maxLength={40} required placeholder="Ex. Navette aéroport"
          className="flex-1 bg-slate-50 rounded-2xl px-4 py-3 text-slate-900 placeholder-slate-400 outline-none focus:ring-2 focus:ring-red-500" />
        <button type="submit" disabled={busy || !name.trim()}
          className="inline-flex items-center justify-center gap-2 bg-slate-900 text-white rounded-2xl px-5 py-3 font-medium disabled:opacity-50">
          <Plus size={18} aria-hidden="true" /> Ajouter
        </button>
      </form>
      {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
      {status && <p role="status" className="text-green-700 text-sm">{status}</p>}

      <div>
        <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Actifs ({active.length})</h4>
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-2xl">
          {active.map(t => (
            <li key={t.name} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="font-medium text-slate-900">{t.name}</span>
              <button type="button" disabled={busy || active.length <= 1}
                onClick={() => run(() => backend.setServiceTypeActive(t.name, false), `« ${t.name} » est archivé.`)}
                aria-label={`Archiver le type ${t.name}`}
                title={active.length <= 1 ? 'Au moins un type doit rester actif' : undefined}
                className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-red-700 px-3 py-1.5 rounded-xl hover:bg-red-50 disabled:opacity-40">
                <Archive size={16} aria-hidden="true" /> Archiver
              </button>
            </li>
          ))}
        </ul>
      </div>

      {archived.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Archivés ({archived.length})</h4>
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-2xl">
            {archived.map(t => (
              <li key={t.name} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-slate-500 line-through decoration-slate-300">{t.name}</span>
                <button type="button" disabled={busy}
                  onClick={() => run(() => backend.setServiceTypeActive(t.name, true), `« ${t.name} » est de nouveau actif.`)}
                  aria-label={`Réactiver le type ${t.name}`}
                  className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-xl hover:bg-slate-100 disabled:opacity-40">
                  <RotateCcw size={16} aria-hidden="true" /> Réactiver
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function Settings({ serviceTypes, onServiceTypesChange, canManageTypes, isDemo, currentUser }: SettingsProps) {
  const [settings, setSettings] = useState(backend.getSettings());
  const [saved, setSaved] = useState(false);
  return <div className="space-y-6">
    <h2 className="text-2xl font-bold text-slate-900">Paramètres</h2>
    {canManageTypes && <ServiceTypesManager serviceTypes={serviceTypes} onServiceTypesChange={onServiceTypesChange} isDemo={isDemo} />}
    <form className="bg-white rounded-3xl p-6 space-y-5" onSubmit={async e => { e.preventDefault(); await backend.saveSettings(settings); setSaved(true); }}>
      <p className="text-slate-600">Les connexions aux services sont configurées par l’administrateur sur le serveur.</p>
      <label className="flex items-center gap-3"><input type="checkbox" checked={settings.enableRAG} onChange={e => { setSaved(false); setSettings({ enableRAG: e.target.checked }); }} />Inclure les statistiques de mes courses dans mes demandes à l’assistant</label>
      <button className="bg-red-600 text-white rounded-xl px-5 py-3" type="submit">Enregistrer</button>
      {saved && <p role="status">Préférence enregistrée.</p>}
    </form>
  </div>;
}
