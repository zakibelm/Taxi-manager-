import React, { useEffect, useState } from 'react';
import { Service } from '../types';
import ZoneCard from './ZoneCard';
import ZoneMap from './ZoneMap';
import { CompanyZones, MyMembership, companyApi } from '../services/company';

/** Zones d'appel du tableau de bord : « Mes courses », et « Ma compagnie » quand l'appartenance est approuvée. */
const ZoneSection: React.FC<{ services: Service[] }> = ({ services }) => {
  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [scope, setScope] = useState<'mine' | 'company'>('mine');
  const [zones, setZones] = useState<CompanyZones | null>(null);
  const approved = membership?.status === 'approved';

  // Hors ligne, en mode démo ou administrateur : la requête échoue, seul « Mes courses » reste (aucune erreur affichée).
  useEffect(() => { let a = true; companyApi.membership().then(m => { if (a) setMembership(m); }).catch(() => {}); return () => { a = false; }; }, []);
  useEffect(() => {
    if (!approved || scope !== 'company') { setZones(null); return; }
    let a = true;
    companyApi.zones(null, null).then(z => { if (a) setZones(z); }).catch(() => { if (a) setScope('mine'); });
    return () => { a = false; };
  }, [approved, scope]);

  const company = scope === 'company' && approved;
  return (
    <>
      {approved && (
        <div className="flex gap-2" role="group" aria-label="Source des prévisions">
          {([['mine', 'Mes courses'], ['company', `Ma compagnie · ${membership.companyName}`]] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setScope(id)} aria-pressed={scope === id}
              className={`px-4 py-2 rounded-full text-xs font-bold border transition-colors ${scope === id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {company && !zones
        ? <p className="text-sm text-slate-500 bg-white rounded-[28px] p-6 border border-slate-100">Chargement des prévisions de la compagnie…</p>
        : <ZoneCard services={services}
            companyView={company && zones ? { name: membership.companyName, status: zones.status, minDrivers: zones.minDrivers, contributors: zones.contributors, recommend: zones.recommend as never } : null} />}
      <ZoneMap services={services} company={!!company} />
    </>
  );
};

export default ZoneSection;
