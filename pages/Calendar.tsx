import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Service, ServiceTypeEntry } from '../types';
import { backend } from '../services/storage';
import { dayKey, monthGrid } from '../utils/stats';

const money = (n: number) => n.toFixed(2).replace('.', ',') + ' $';
const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

interface CalendarProps { services: Service[]; serviceTypes: ServiceTypeEntry[]; onServiceAdded: () => void; }

/** Calendrier mensuel : total par jour, et saisie d'une course pour le jour choisi. */
const Calendar: React.FC<CalendarProps> = ({ services, serviceTypes, onServiceAdded }) => {
  const now = new Date();
  const todayKey = dayKey(now);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState(todayKey);
  const activeTypes = serviceTypes.filter(t => t.active).map(t => t.name);
  const [type, setType] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const perDay = useMemo(() => {
    const map = new Map<string, { amount: number; count: number; rows: Service[] }>();
    for (const s of services) {
      const k = dayKey(s.date); const v = map.get(k) ?? { amount: 0, count: 0, rows: [] };
      v.amount += s.amount; v.count++; v.rows.push(s); map.set(k, v);
    }
    return map;
  }, [services]);

  const weeks = monthGrid(year, month);
  const title = new Date(year, month, 1).toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });
  const shift = (delta: number) => { const d = new Date(year, month + delta, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); };
  const goToday = () => { setYear(now.getFullYear()); setMonth(now.getMonth()); setSelected(todayKey); };
  const day = perDay.get(selected);
  const chosenType = activeTypes.includes(type) ? type : activeTypes[0] ?? '';

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = parseFloat(amount.replace(',', '.'));
    if (!chosenType) { setError('Aucun type de service actif. Demandez à l’administrateur d’en ajouter.'); return; }
    if (!Number.isFinite(value) || value <= 0 || value > 10000) { setError('Entrez un montant entre 0,01 $ et 10 000 $.'); return; }
    setSaving(true); setError('');
    try {
      await backend.addService({ type: chosenType, amount: value, date: new Date(selected + 'T12:00:00').toISOString(), description: note.trim() });
      setAmount(''); setNote(''); onServiceAdded();
    } catch (err) { setError(err instanceof Error ? err.message : 'Ajout impossible.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-24 md:pb-0">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-2xl font-bold text-slate-900">Calendrier</h2>
        <button type="button" onClick={goToday} className="text-xs font-bold text-red-600 hover:text-red-700">Aujourd’hui</button>
      </div>

      <div className="bg-white rounded-[28px] p-4 md:p-6 shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <button type="button" aria-label="Mois précédent" onClick={() => shift(-1)} className="p-2 rounded-xl hover:bg-slate-100"><ChevronLeft size={20} /></button>
          <h3 className="font-bold text-slate-900 capitalize" aria-live="polite">{title}</h3>
          <button type="button" aria-label="Mois suivant" onClick={() => shift(1)} className="p-2 rounded-xl hover:bg-slate-100"><ChevronRight size={20} /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-slate-400 mb-1" aria-hidden="true">{DAYS.map((d, i) => <span key={i}>{d}</span>)}</div>
        <div className="space-y-1">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1">
              {week.map((k, di) => {
                if (!k) return <div key={di} />;
                const v = perDay.get(k);
                return (
                  <button key={k} type="button" onClick={() => setSelected(k)} aria-pressed={selected === k}
                    aria-label={`${k}${v ? `, ${v.count} course(s), ${money(v.amount)}` : ', aucune course'}`}
                    className={`min-h-[3.5rem] rounded-xl p-1 text-xs flex flex-col items-center justify-start border transition-colors ${
                      selected === k ? 'bg-red-600 text-white border-red-600' : k === todayKey ? 'border-red-300 bg-red-50 text-slate-900' : 'border-transparent bg-slate-50 hover:bg-slate-100 text-slate-700'}`}>
                    <span className="font-bold">{Number(k.slice(8))}</span>
                    {v && <span className={`text-[10px] leading-tight ${selected === k ? 'text-white' : 'text-red-600 font-bold'}`}>{Math.round(v.amount)} $</span>}
                    {v && <span className={`text-[9px] ${selected === k ? 'text-white/80' : 'text-slate-400'}`}>{v.count}×</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <section aria-labelledby="day-title" className="bg-white rounded-[28px] p-6 shadow-sm border border-slate-100 space-y-4">
        <h3 id="day-title" className="font-bold text-slate-900">{selected}{day ? ` — ${day.count} course(s), ${money(day.amount)}` : ''}</h3>
        {day ? (
          <ul className="space-y-2">
            {day.rows.map(r => (
              <li key={r.id} className="flex justify-between text-sm bg-slate-50 rounded-xl px-3 py-2">
                <span className="text-slate-700">{r.type}{r.description ? ` · ${r.description}` : ''}{r.pending ? ' (en attente)' : ''}</span>
                <span className="font-bold text-slate-900">{money(r.amount)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">Aucune course ce jour-là.</p>}

        <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          {error && <p role="alert" className="md:col-span-4 text-red-700 bg-red-50 rounded-xl p-3 text-sm">{error}</p>}
          <label className="text-xs text-slate-500">Type
            <select value={chosenType} onChange={e => setType(e.target.value)} className="block w-full mt-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800">
              {activeTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Montant ($ CA)
            <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" required
              className="block w-full mt-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800" />
          </label>
          <label className="text-xs text-slate-500">Note (facultatif)
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={200}
              className="block w-full mt-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800" />
          </label>
          <button type="submit" disabled={saving}
            className="self-end flex items-center justify-center gap-2 bg-slate-900 text-white font-medium px-4 py-2.5 rounded-xl hover:bg-slate-800 disabled:opacity-50">
            <Plus size={18} aria-hidden="true" /> Ajouter
          </button>
        </form>
      </section>
    </div>
  );
};

export default Calendar;
