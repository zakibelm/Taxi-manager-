import React, { useEffect, useState } from 'react';
import { fetchForecast, Forecast as ForecastData, ForecastSlot } from '../services/forecast';

const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const SLOTS: [ForecastSlot, string][] = [['0-6', '0 h – 6 h'], ['6-10', '6 h – 10 h'], ['10-14', '10 h – 14 h'], ['14-18', '14 h – 18 h'], ['18-24', '18 h – 24 h']];
const LEVEL = {
  bonne: { label: 'Fiabilité bonne', cls: 'bg-emerald-100 text-emerald-800' },
  moyenne: { label: 'Fiabilité moyenne', cls: 'bg-amber-100 text-amber-900' },
  faible: { label: 'Fiabilité faible', cls: 'bg-red-100 text-red-800' },
};
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Page « Prévisions » : volume d'appels attendu pour les 7 prochains jours, heures de pointe et zones à viser (journal DataTaxi). */
const Forecast: React.FC = () => {
  const [data, setData] = useState<ForecastData | null>(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<'weekday' | 'weekend'>('weekday');

  useEffect(() => { fetchForecast().then(setData).catch(e => setError(e.message)); }, []);

  const header = (
    <div className="px-2">
      <h2 className="text-2xl font-bold text-slate-900">Prévisions</h2>
      <p className="text-sm text-slate-500">Appels de répartition attendus, heures de pointe et zones à viser, d’après le journal DataTaxi.</p>
    </div>
  );
  if (error) return <div className="space-y-6">{header}<p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p></div>;
  if (!data) return <div className="space-y-6">{header}<p className="px-2 text-slate-500">Chargement…</p></div>;
  if (!data.ready) {
    return (
      <div className="space-y-6">{header}
        <p role="status" className="rounded-xl bg-slate-100 p-4 text-slate-700">
          Pas encore assez de données : {data.days} journée{data.days > 1 ? 's' : ''} complète{data.days > 1 ? 's' : ''} sur {data.needed} nécessaires (avec au moins une fin de semaine).
          Les prévisions apparaîtront dès que DataTaxi aura envoyé l’historique.
        </p>
      </div>
    );
  }

  const level = LEVEL[data.reliability.level];
  const hours = data.hourly[kind];
  const max = Math.max(...hours, 1);
  const peaks = data.peaks[kind];
  const zones = data.zones[kind];
  const biggest = Math.max(...data.daily.map(d => d.high), 1);

  return (
    <div className="space-y-6">
      {header}
      <section aria-label="Fiabilité" className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${level.cls}`}>{level.label}</span>
          <span className="text-sm text-slate-600">
            {data.days} journées analysées ({data.events.toLocaleString('fr-CA')} appels), jusqu’au {shortDate(data.asOf)}
            {data.reliability.errorPct !== null && <> · écart moyen sur l’historique : environ {data.reliability.errorPct} %.</>}
          </span>
        </div>
        {data.reliability.level !== 'bonne' && (
          <p className="mt-2 text-sm text-slate-500">Les totaux journaliers sont des ordres de grandeur ; la précision augmente à chaque semaine de données ajoutée.</p>
        )}
      </section>

      <section aria-label="7 prochains jours" className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
        <h3 className="mb-3 font-semibold text-slate-900">7 prochains jours</h3>
        <ul className="space-y-2">
          {data.daily.map(d => (
            <li key={d.date} className="grid grid-cols-[6.5rem_1fr_7.5rem] items-center gap-3 text-sm">
              <span className="text-slate-700">{DAYS[d.dow]} <span className="text-slate-400">{shortDate(d.date)}</span></span>
              <span className="relative h-3 rounded-full bg-slate-100" aria-hidden="true">
                <span className="absolute inset-y-0 rounded-full bg-sky-200" style={{ left: `${100 * d.low / biggest}%`, width: `${Math.max(2, 100 * (d.high - d.low) / biggest)}%` }} />
                <span className="absolute inset-y-0 w-1 rounded-full bg-sky-600" style={{ left: `calc(${100 * d.expected / biggest}% - 2px)` }} />
              </span>
              <span className="text-right text-slate-900"><strong>{d.expected}</strong> <span className="text-slate-400">({d.low}–{d.high})</span></span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">Nombre d’appels attendu par jour (plage habituelle entre parenthèses).</p>
      </section>

      <section aria-label="Heures de pointe" className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-900">Heures de pointe</h3>
          <div role="group" aria-label="Type de jour" className="flex rounded-full bg-slate-100 p-1 text-sm">
            {(['weekday', 'weekend'] as const).map(k => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
                className={`rounded-full px-3 py-1 ${kind === k ? 'bg-white font-semibold shadow-sm' : 'text-slate-500'}`}>
                {k === 'weekday' ? 'Semaine' : 'Fin de semaine'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex h-32 items-end gap-0.5" role="img" aria-label={`Appels par heure. Pointes à ${peaks.map(h => h + ' h').join(', ')}.`}>
          {hours.map((v, h) => (
            <div key={h} className="flex flex-1 flex-col items-center justify-end" title={`${h} h : ${v} appels en moyenne`}>
              <div className={`w-full rounded-t ${peaks.includes(h) ? 'bg-sky-600' : 'bg-sky-200'}`} style={{ height: `${Math.max(2, 100 * v / max)}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>23 h</span></div>
        <p className="mt-3 text-sm text-slate-600">Pointes : {peaks.map(h => `${h} h`).join(', ')}.</p>
      </section>

      <section aria-label="Zones à viser" className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100">
        <h3 className="mb-3 font-semibold text-slate-900">Zones à viser ({kind === 'weekday' ? 'semaine' : 'fin de semaine'})</h3>
        <ul className="divide-y divide-slate-100">
          {SLOTS.map(([slot, label]) => (
            <li key={slot} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
              <span className="w-24 text-slate-500">{label}</span>
              {zones[slot].length === 0 ? <span className="text-slate-400">Pas assez d’appels</span> : zones[slot].map(z => (
                <span key={z.zone} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-800">Zone <strong>{z.zone}</strong> · {z.share} %</span>
              ))}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default Forecast;
