import React, { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { Company, MyMembership, companyApi } from '../services/company';

const STATUS: Record<MyMembership['status'], { label: string; cls: string }> = {
  pending: { label: 'En attente d’approbation', cls: 'bg-amber-50 text-amber-800' },
  approved: { label: 'Approuvée', cls: 'bg-green-50 text-green-800' },
  rejected: { label: 'Refusée', cls: 'bg-red-50 text-red-800' },
};

/** Compagnie d'appartenance du chauffeur : choix dans la liste tenue par l'administrateur, puis partage facultatif de ses zones d'appel. */
const CompanySection: React.FC = () => {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([companyApi.companies(), companyApi.membership()])
      .then(([c, m]) => { if (active) { setCompanies(c); setMembership(m); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Compagnies indisponibles.'); });
    return () => { active = false; };
  }, []);

  const run = async (action: () => Promise<MyMembership | null>) => {
    setBusy(true); setError('');
    try { setMembership(await action()); } catch (e) { setError(e instanceof Error ? e.message : 'Action impossible.'); } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="company-title" className="bg-white rounded-[28px] p-6 shadow-sm border border-slate-100 space-y-4">
      <div>
        <h3 id="company-title" className="font-bold text-slate-900 flex items-center gap-2"><Building2 size={18} className="text-red-600" aria-hidden="true" /> Compagnie d’appartenance</h3>
        <p className="text-xs text-slate-500 mt-1">
          Choisissez votre compagnie : après approbation de l’administrateur, vous pourrez voir les prévisions de zones calculées sur les courses de tous les membres qui les partagent.
        </p>
      </div>
      {error && <p role="alert" className="text-red-700 bg-red-50 rounded-xl p-3 text-sm">{error}</p>}
      {!companies ? (
        !error && <p className="text-sm text-slate-500">Chargement…</p>
      ) : companies.length === 0 && !membership ? (
        <p className="text-sm text-slate-500">Aucune compagnie n’est encore enregistrée. L’administrateur doit d’abord en ajouter une.</p>
      ) : (
        <>
          <label className="text-xs text-slate-500 block">Compagnie
            <select value={membership?.companyId ?? ''} disabled={busy}
              onChange={e => run(() => companyApi.chooseCompany(e.target.value || null))}
              className="block w-full mt-1 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 bg-white">
              <option value="">Aucune</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {membership && (
            <>
              <p className="text-sm">Demande pour « {membership.companyName} » : <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-bold ${STATUS[membership.status].cls}`}>{STATUS[membership.status].label}</span></p>
              <label className="flex items-start gap-3 text-sm text-slate-700">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-red-600" checked={membership.share} disabled={busy}
                  onChange={e => run(() => companyApi.setShare(e.target.checked))} />
                <span>
                  Partager mes zones d’appel avec ma compagnie
                  <span className="block text-xs text-slate-500">
                    Seules les zones d’appel de mes courses localisées comptent dans les prévisions de la compagnie, regroupées avec celles des autres membres. Personne ne voit mes courses, mes montants ni mon nom, et une zone n’est affichée que si au moins 3 chauffeurs y contribuent. Décochez à tout moment.
                  </span>
                </span>
              </label>
            </>
          )}
        </>
      )}
    </section>
  );
};

export default CompanySection;
