import React from 'react';
import { Service } from '../types';
import PeriodAnalysis from '../components/PeriodAnalysis';

/** Page « Tableau de bord » : analyse des revenus, mois en cours par défaut (semaine ou dates au choix). */
const Analysis: React.FC<{ services: Service[] }> = ({ services }) => (
  <div className="space-y-6">
    <div className="px-2">
      <h2 className="text-2xl font-bold text-slate-900">Tableau de bord</h2>
      <p className="text-sm text-slate-500">Revenus, courses et tendance sur la période choisie.</p>
    </div>
    <PeriodAnalysis services={services} initial="month" />
  </div>
);

export default Analysis;
