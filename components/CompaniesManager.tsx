import React, { useCallback, useEffect, useState } from 'react';
import { Archive, Check, Plus, RotateCcw, X } from 'lucide-react';
import { Company, MembershipRow, companyApi } from '../services/company';

/** Administrateur : liste des compagnies et approbation des demandes d'appartenance des chauffeurs. */
const CompaniesManager: React.FC = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [rows, setRows] = useState<MembershipRow[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    const [c, m] = await Promise.all([companyApi.companies(), companyApi.memberships()]);
    setCompanies(c); setRows(m);
  }, []);
  useEffect(() => { load().catch(e => setError(e instanceof Error ? e.message : 'Chargement impossible.')); }, [load]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(''); setStatus('');
    try { await action(); await load(); setStatus(done); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Action impossible.'); return false; }
    finally { setBusy(false); }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (await run(() => companyApi.createCompany(value), `« ${value} » est disponible pour les chauffeurs.`)) setName('');
  };
  const pending = rows.filter(r => r.status === 'pending');
  const decided = rows.filter(r => r.status !== 'pending');
  const label = { approved: 'Approuvé', rejected: 'Refusé', pending: 'En attente' } as const;

  return (
    <section aria-labelledby="companies-title" className="bg-white rounded-3xl p-6 space-y-5">
      <div>
        <h3 id="companies-title" className="text-lg font-bold text-slate-900">Compagnies</h3>
        <p className="text-slate-600 text-sm">
          Les chauffeurs choisissent leur compagnie dans cette liste ; vous approuvez chaque demande. Les prévisions de compagnie utilisent seulement les membres approuvés qui ont accepté de partager leurs zones, et ne s’affichent qu’à partir de 3 chauffeurs.
        </p>
      </div>
      <form onSubmit={add} className="flex flex-col sm:flex-row gap-3">
        <label htmlFor="new-company" className="sr-only">Nom de la compagnie</label>
        <input id="new-company" value={name} onChange={e => { setName(e.target.value); setError(''); }} maxLength={60} required placeholder="Ex. Co-op Taxi Terrebonne"
          className="flex-1 bg-slate-50 rounded-2xl px-4 py-3 text-slate-900 placeholder-slate-400 outline-none focus:ring-2 focus:ring-red-500" />
        <button type="submit" disabled={busy || !name.trim()} className="inline-flex items-center justify-center gap-2 bg-slate-900 text-white rounded-2xl px-5 py-3 font-medium disabled:opacity-50">
          <Plus size={18} aria-hidden="true" /> Ajouter
        </button>
      </form>
      {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
      {status && <p role="status" className="text-green-700 text-sm">{status}</p>}

      <ul className="divide-y divide-slate-100 border border-slate-100 rounded-2xl">
        {companies.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">Aucune compagnie.</li>}
        {companies.map(c => (
          <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className={c.active ? 'font-medium text-slate-900' : 'text-slate-500 line-through decoration-slate-300'}>{c.name}</span>
            <button type="button" disabled={busy} onClick={() => run(() => companyApi.setCompanyActive(c.id, !c.active), c.active ? `« ${c.name} » est archivée.` : `« ${c.name} » est de nouveau active.`)}
              aria-label={`${c.active ? 'Archiver' : 'Réactiver'} la compagnie ${c.name}`}
              className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-xl hover:bg-slate-100 disabled:opacity-40">
              {c.active ? <Archive size={16} aria-hidden="true" /> : <RotateCcw size={16} aria-hidden="true" />} {c.active ? 'Archiver' : 'Réactiver'}
            </button>
          </li>
        ))}
      </ul>

      <div>
        <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Demandes en attente ({pending.length})</h4>
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-2xl">
          {pending.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">Aucune demande.</li>}
          {pending.map(r => (
            <li key={r.email} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="text-sm text-slate-800 min-w-0 break-all"><strong>{r.email}</strong><br /><span className="text-slate-500">souhaite rejoindre « {r.companyName} »</span></span>
              <span className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => run(() => companyApi.decide(r.email, true), `${r.email} est approuvé.`)} aria-label={`Approuver ${r.email}`}
                  className="inline-flex items-center gap-1.5 text-sm bg-green-50 text-green-800 px-3 py-1.5 rounded-xl hover:bg-green-100 disabled:opacity-40"><Check size={16} aria-hidden="true" /> Approuver</button>
                <button type="button" disabled={busy} onClick={() => run(() => companyApi.decide(r.email, false), `${r.email} est refusé.`)} aria-label={`Refuser ${r.email}`}
                  className="inline-flex items-center gap-1.5 text-sm bg-red-50 text-red-800 px-3 py-1.5 rounded-xl hover:bg-red-100 disabled:opacity-40"><X size={16} aria-hidden="true" /> Refuser</button>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {decided.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Membres et décisions ({decided.length})</h4>
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-2xl">
            {decided.map(r => (
              <li key={r.email} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="break-all text-slate-800">{r.email} · {r.companyName}</span>
                <span className="flex items-center gap-2">
                  <span className="text-slate-500">{label[r.status]}{r.status === 'approved' ? (r.share ? ' · partage ses zones' : ' · ne partage pas') : ''}</span>
                  {r.status === 'approved'
                    ? <button type="button" disabled={busy} onClick={() => run(() => companyApi.decide(r.email, false), `${r.email} est retiré.`)} className="text-red-700 hover:underline disabled:opacity-40">Retirer</button>
                    : <button type="button" disabled={busy} onClick={() => run(() => companyApi.decide(r.email, true), `${r.email} est approuvé.`)} className="text-green-800 hover:underline disabled:opacity-40">Approuver</button>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default CompaniesManager;
