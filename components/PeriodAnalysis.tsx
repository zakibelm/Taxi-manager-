import React, { useMemo, useState } from 'react';
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { TrendingUp, TrendingDown, RotateCcw } from 'lucide-react';
import { Service } from '../types';
import { monthRange, previousRange, summarize, variation, weekRange, TAX_RATES } from '../utils/stats';

const money = (n: number) => n.toFixed(2).replace('.', ',') + ' $';

/** Analyse de l'historique : semaine courante par défaut, début et fin modifiables. */
const PeriodAnalysis: React.FC<{ services: Service[]; initial?: 'week' | 'month' }> = ({ services, initial = 'week' }) => {
  const week = useMemo(() => weekRange(), []);
  const month = useMemo(() => monthRange(), []);
  const first = initial === 'month' ? month : week;
  const [start, setStart] = useState(first.start);
  const [end, setEnd] = useState(first.end);
  const invalid = !start || !end || start > end;
  const isWeek = start === week.start && end === week.end;
  const isMonth = start === month.start && end === month.end;

  const data = useMemo(() => {
    if (invalid) return null;
    const current = summarize(services, start, end);
    const prev = previousRange(start, end);
    const before = summarize(services, prev.start, prev.end);
    return { current, before, change: variation(current.total, before.total) };
  }, [services, start, end, invalid]);

  return (
    <section aria-labelledby="analysis-title" className="bg-white rounded-[28px] p-6 shadow-sm border border-slate-100 space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h3 id="analysis-title" className="font-bold text-slate-900">Analyse de l’historique</h3>
          <p className="text-xs text-slate-500">{isWeek ? 'Semaine courante (lundi au dimanche)' : isMonth ? 'Mois en cours' : 'Période personnalisée'}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500">Début
            <input type="date" value={start} onChange={e => setStart(e.target.value)} className="block mt-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800" />
          </label>
          <label className="text-xs text-slate-500">Fin
            <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="block mt-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800" />
          </label>
          <div className="flex gap-2" role="group" aria-label="Périodes rapides">
            <button type="button" aria-pressed={isWeek} onClick={() => { setStart(week.start); setEnd(week.end); }}
              className={`flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-xl ${isWeek ? 'bg-red-600 text-white' : 'text-red-600 hover:text-red-700'}`}>
              {!isWeek && <RotateCcw size={14} aria-hidden="true" />} Semaine courante
            </button>
            <button type="button" aria-pressed={isMonth} onClick={() => { setStart(month.start); setEnd(month.end); }}
              className={`text-xs font-bold px-3 py-2 rounded-xl ${isMonth ? 'bg-red-600 text-white' : 'text-red-600 hover:text-red-700'}`}>
              Mois en cours
            </button>
          </div>
        </div>
      </div>

      {invalid && <p role="alert" className="text-red-700 bg-red-50 rounded-xl p-3 text-sm">La date de début doit précéder la date de fin.</p>}

      {data && data.current.count === 0 && <p role="status" className="text-slate-500 text-sm">Aucune course sur cette période.</p>}

      {data && data.current.count > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-50 rounded-2xl p-4"><p className="text-xs text-slate-500">Revenu</p><p className="text-xl font-bold text-slate-900">{money(data.current.total)}</p></div>
            <div className="bg-slate-50 rounded-2xl p-4"><p className="text-xs text-slate-500">Courses</p><p className="text-xl font-bold text-slate-900">{data.current.count}</p></div>
            <div className="bg-slate-50 rounded-2xl p-4"><p className="text-xs text-slate-500">Moyenne par course</p><p className="text-xl font-bold text-slate-900">{money(data.current.average)}</p></div>
            <div className="bg-slate-50 rounded-2xl p-4"><p className="text-xs text-slate-500">Meilleur jour</p>
              <p className="text-xl font-bold text-slate-900">{data.current.best ? money(data.current.best.amount) : '—'}</p>
              <p className="text-[11px] text-slate-500">{data.current.best?.day}</p></div>
          </div>

          {/* Cumul des taxes et du SEV sur la période (montants saisis taxes incluses) */}
          <div className="border border-slate-100 rounded-2xl p-4 space-y-3" aria-labelledby="taxes-title">
            <div className="flex items-baseline justify-between gap-2">
              <h4 id="taxes-title" className="text-sm font-bold text-slate-900">Cumul TPS, TVQ et SEV</h4>
              <p className="text-[11px] text-slate-400">Montants taxes incluses</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-amber-50 rounded-xl p-3"><p className="text-xs text-slate-500">TPS (5 %)</p><p className="text-lg font-bold text-slate-900">{money(data.current.taxes.tps)}</p></div>
              <div className="bg-amber-50 rounded-xl p-3"><p className="text-xs text-slate-500">TVQ (9,975 %)</p><p className="text-lg font-bold text-slate-900">{money(data.current.taxes.tvq)}</p></div>
              <div className="bg-amber-50 rounded-xl p-3"><p className="text-xs text-slate-500">SEV ({money(TAX_RATES.sevPerRide)} × {data.current.count})</p><p className="text-lg font-bold text-slate-900">{money(data.current.taxes.sev)}</p></div>
              <div className="bg-amber-100 rounded-xl p-3"><p className="text-xs text-slate-600 font-bold">Total TPS + TVQ + SEV</p><p className="text-lg font-bold text-slate-900">{money(data.current.taxes.totalDue)}</p></div>
              <div className="col-span-2 md:col-span-1 bg-green-50 rounded-xl p-3"><p className="text-xs text-slate-500">Revenu net</p><p className="text-lg font-bold text-green-700">{money(data.current.taxes.net)}</p></div>
            </div>
          </div>

          <p className="text-sm text-slate-600 flex items-center gap-2">
            {data.change === null ? 'Pas de période précédente à comparer.' : (
              <>
                {data.change >= 0 ? <TrendingUp size={16} className="text-green-600" aria-hidden="true" /> : <TrendingDown size={16} className="text-red-600" aria-hidden="true" />}
                <span><strong>{data.change >= 0 ? '+' : ''}{String(data.change).replace('.', ',')} %</strong> par rapport à la période précédente de même durée ({money(data.before.total)}).</span>
              </>
            )}
          </p>

          <div className="h-40 w-full" role="img" aria-label="Revenu par jour sur la période">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.current.series}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <Tooltip formatter={(v: number) => money(v)} labelFormatter={l => String(l)} />
                <Bar dataKey="amount" fill="#dc2626" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <ul className="space-y-2">
            {data.current.byType.map(t => (
              <li key={t.type} className="text-sm">
                <div className="flex justify-between"><span className="text-slate-700">{t.type} ({t.count})</span><span className="font-medium text-slate-900">{money(t.amount)}</span></div>
                <div className="h-1.5 bg-slate-100 rounded-full mt-1"><div className="h-1.5 bg-red-600 rounded-full" style={{ width: `${Math.max(3, (t.amount / data.current.total) * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

export default PeriodAnalysis;
