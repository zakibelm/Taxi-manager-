import React from 'react';
import { Building2 } from 'lucide-react';
import { MyMembership } from '../services/company';

const STATUS: Record<MyMembership['status'], { label: string; cls: string }> = {
  pending: { label: 'En attente d’approbation', cls: 'bg-amber-50 text-amber-800' },
  approved: { label: 'Approuvée', cls: 'bg-green-50 text-green-800' },
  rejected: { label: 'Refusée', cls: 'bg-red-50 text-red-800' },
};

/** Statut de la demande d'adhésion et partage facultatif des zones d'appel. Le choix de la compagnie (obligatoire) se fait dans le formulaire du profil. */
interface CompanySectionProps { membership: MyMembership | null; busy: boolean; onShare: (share: boolean) => void; }

const CompanySection: React.FC<CompanySectionProps> = ({ membership, busy, onShare }) => {
  if (!membership) return null;
  return (
    <section aria-labelledby="company-title" className="bg-white rounded-[28px] p-6 shadow-sm border border-slate-100 space-y-4">
      <div>
        <h3 id="company-title" className="font-bold text-slate-900 flex items-center gap-2"><Building2 size={18} className="text-red-600" aria-hidden="true" /> Ma compagnie</h3>
        <p className="text-xs text-slate-500 mt-1">
          Après approbation de l’administrateur, vous pourrez voir les prévisions de zones calculées sur les courses de tous les membres qui les partagent.
        </p>
      </div>
      <p className="text-sm">Demande pour « {membership.companyName} » : <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-bold ${STATUS[membership.status].cls}`}>{STATUS[membership.status].label}</span></p>
      <label className="flex items-start gap-3 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-red-600" checked={membership.share} disabled={busy}
          onChange={e => onShare(e.target.checked)} />
        <span>
          Partager mes zones d’appel avec ma compagnie
          <span className="block text-xs text-slate-500">
            Seules les zones d’appel de mes courses localisées comptent dans les prévisions de la compagnie, regroupées avec celles des autres membres. Personne ne voit mes courses, mes montants ni mon nom, et une zone n’est affichée que si au moins 3 chauffeurs y contribuent. Décochez à tout moment.
          </span>
        </span>
      </label>
    </section>
  );
};

export default CompanySection;
