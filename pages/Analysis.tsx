import React from 'react';
import { Service } from '../types';
import PeriodAnalysis from '../components/PeriodAnalysis';
import ZoneSection from '../components/ZoneSection';

/** Page « Tableau de bord » : zones d'appel (« Mes courses » / « Ma compagnie »), carte, puis analyse des revenus (mois en cours par défaut). */
const Analysis: React.FC<{ services: Service[] }> = ({ services }) => (
  <div className="space-y-6">
    <div className="px-2">
      <h2 className="text-2xl font-bold text-slate-900">Tableau de bord</h2>
      <p className="text-sm text-slate-500">Zone d’appel probable, carte des zones, revenus et tendance sur la période choisie.</p>
    </div>
    <ZoneSection services={services} />
    <PeriodAnalysis services={services} initial="month" />
  </div>
);

export default Analysis;
