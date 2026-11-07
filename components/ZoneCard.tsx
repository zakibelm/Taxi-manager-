import React, { useMemo } from 'react';
import { MapPin, Navigation } from 'lucide-react';
import { Service } from '../types';
import { basisLabel, recommendZones } from '../utils/zones.mjs';

const money = (n: number) => n.toFixed(2).replace('.', ',') + ' $';
const pct = (n: number) => Math.round(n * 100) + ' %';

/** « Où se placer maintenant » : zones d'appel les plus fréquentes dans l'historique localisé,
 *  pour le même jour de la semaine et la même tranche horaire (sinon la tranche seule, sinon tout l'historique). */
const ZoneCard: React.FC<{ services: Service[] }> = ({ services }) => {
  const rec = useMemo(() => recommendZones(services), [services]);

  return (
    <section aria-labelledby="zones-title" className="bg-white rounded-[28px] p-6 shadow-sm border border-slate-100 space-y-4">
      <div>
        <h3 id="zones-title" className="font-bold text-slate-900 flex items-center gap-2"><MapPin size={18} className="text-red-600" aria-hidden="true" /> Zone d’appel probable</h3>
        <p className="text-xs text-slate-500 mt-1">Maintenant : {rec.day}, {rec.slot.toLowerCase()}</p>
      </div>

      {rec.status !== 'ok' ? (
        <p className="text-sm text-slate-500">
          {rec.located === 0
            ? 'Cochez « Localiser l’origine de l’appel » en saisissant vos courses : après quelques courses, l’application vous recommandera où vous placer selon l’heure et la période.'
            : `${rec.located} course${rec.located > 1 ? 's' : ''} localisée${rec.located > 1 ? 's' : ''} sur ${rec.needed} nécessaires pour une première recommandation.`}
        </p>
      ) : (
        <>
          <ol className="space-y-3">
            {rec.zones.map((z, i) => (
              <li key={z.zone} className="flex items-start justify-between gap-3 rounded-2xl bg-slate-50 p-4">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{i + 1}. Zone de {z.lat.toFixed(3)}, {z.lng.toFixed(3)}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {z.count} appel{z.count > 1 ? 's' : ''} ({pct(z.share)}) · {money(z.averageAmount)} en moyenne · surtout « {z.topType} » ({pct(z.topTypeShare)})
                  </p>
                </div>
                <a className="shrink-0 inline-flex items-center gap-1 text-xs font-bold text-red-600 hover:text-red-500"
                   href={`https://www.google.com/maps/search/?api=1&query=${z.lat},${z.lng}`} target="_blank" rel="noopener noreferrer">
                  <Navigation size={14} aria-hidden="true" /> Voir
                </a>
              </li>
            ))}
          </ol>
          <p className="text-xs text-slate-400">
            Calculé sur {rec.sample} course{rec.sample > 1 ? 's' : ''} : {basisLabel(rec)}. Plus vous localisez de courses, plus la recommandation est fiable.
          </p>
        </>
      )}
    </section>
  );
};

export default ZoneCard;
