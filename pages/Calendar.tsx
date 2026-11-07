import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Check, Trash2, X } from 'lucide-react';
import { Assignment, ServiceTypeEntry } from '../types';
import { backend, resolveNewType } from '../services/storage';
import { dayKey, monthGrid } from '../utils/stats';

const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const OTHER = '__autre__';

interface CalendarProps {
  /** Assignations planifiées (rappels) : pas encore faites, donc sans montant. */
  assignments: Assignment[];
  serviceTypes: ServiceTypeEntry[];
  onServiceAdded: () => void;
  onAssignmentsChanged: () => void;
  onTypeCreated: (name: string) => void;
}

/** Calendrier : uniquement les assignations planifiées (pas l'historique des courses faites, qui est dans Mes Services).
 *  On planifie aujourd'hui ou plus tard ; « Terminer » transforme l'assignation en course avec le montant. */
const Calendar: React.FC<CalendarProps> = ({ assignments, serviceTypes, onServiceAdded, onAssignmentsChanged, onTypeCreated }) => {
  const now = new Date();
  const todayKey = dayKey(now);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState(todayKey);
  const activeTypes = serviceTypes.filter(t => t.active).map(t => t.name);
  const [type, setType] = useState('');
  const [time, setTime] = useState(() => hhmm(new Date()));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherName, setOtherName] = useState('');
  // « Terminer » : assignation en cours de clôture et montant saisi
  const [closing, setClosing] = useState<string | null>(null);
  const [closeAmount, setCloseAmount] = useState('');

  const planned = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of assignments) { const k = dayKey(a.date); map.set(k, [...(map.get(k) ?? []), a]); }
    for (const rows of map.values()) rows.sort((x, y) => x.date.localeCompare(y.date));
    return map;
  }, [assignments]);

  const weeks = monthGrid(year, month);
  const title = new Date(year, month, 1).toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });
  const shift = (delta: number) => { const d = new Date(year, month + delta, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); };
  const selectDay = (k: string) => { setSelected(k); const [y, m] = k.split('-').map(Number); setYear(y); setMonth(m - 1); };
  const goToday = () => selectDay(todayKey);
  const dayPlanned = planned.get(selected) ?? [];
  const isPast = selected < todayKey;
  const chosenType = activeTypes.includes(type) ? type : activeTypes[0] ?? '';

  const confirmOther = (): string | null => {
    try {
      const name = resolveNewType(otherName, serviceTypes.map(t => t.name));
      onTypeCreated(name); setType(name); setOtherOpen(false); setOtherName(''); setError('');
      return name;
    } catch (err) { setError(err instanceof Error ? err.message : 'Nom invalide.'); return null; }
  };

  const plan = async (e: React.FormEvent) => {
    e.preventDefault();
    let chosen = chosenType;
    if (otherOpen) {
      if (!otherName.trim()) { setError('Entrez le nom du nouveau service ou choisissez un type dans la liste.'); return; }
      const added = confirmOther(); if (!added) return; chosen = added;
    }
    if (!chosen) { setError('Choisissez un type de service.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selected)) { setError('Choisissez une date.'); return; }
    if (new Date(`${selected}T${time}:00`).getTime() < Date.now() - 60000) { setError('Choisissez une date et une heure à venir.'); return; }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { setError('Entrez une heure valide (ex. 14:30).'); return; }
    setSaving(true); setError('');
    try {
      await backend.addAssignment({ type: chosen, date: new Date(`${selected}T${time}:00`).toISOString(), description: note.trim() });
      setNote(''); onAssignmentsChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'Planification impossible.'); }
    finally { setSaving(false); }
  };

  const finish = async (a: Assignment) => {
    const value = parseFloat(closeAmount.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0 || value > 10000) { setError('Entrez le montant de la course (entre 0,01 $ et 10 000 $).'); return; }
    setSaving(true); setError('');
    try {
      // La course faite reprend la date, l'heure, le type et la note de l'assignation.
      await backend.addService({ type: a.type, amount: value, date: a.date, description: a.description ?? '' });
      await backend.deleteAssignment(a.id);
      setClosing(null); setCloseAmount(''); onServiceAdded(); onAssignmentsChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'Enregistrement impossible.'); }
    finally { setSaving(false); }
  };

  const remove = async (a: Assignment) => {
    if (!window.confirm(`Supprimer l’assignation de ${hhmm(new Date(a.date))} (${a.type}) ?`)) return;
    try { await backend.deleteAssignment(a.id); onAssignmentsChanged(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Suppression impossible.'); }
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
                const p = planned.get(k)?.length ?? 0;
                const isSel = selected === k;
                const past = k < todayKey;
                return (
                  <button key={k} type="button" onClick={() => setSelected(k)} aria-pressed={isSel}
                    aria-label={`${k}${p ? `, ${p} assignation(s) prévue(s)` : ''}`}
                    className={`min-h-[3.5rem] rounded-xl p-1 text-xs flex flex-col items-center justify-start gap-0.5 border transition-colors ${
                      isSel ? 'bg-red-600 text-white border-red-600' : k === todayKey ? 'border-red-300 bg-red-50 text-slate-900' : past ? 'border-transparent bg-transparent text-slate-300' : 'border-transparent bg-slate-50 hover:bg-slate-100 text-slate-700'}`}>
                    <span className="font-bold">{Number(k.slice(8))}</span>
                    {p > 0 && <span className={`text-[10px] leading-none px-1.5 py-0.5 rounded-full font-bold ${isSel ? 'bg-white text-red-600' : 'bg-blue-600 text-white'}`}>{p} prévue{p > 1 ? 's' : ''}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <section aria-labelledby="day-title" className="bg-white rounded-[28px] p-6 shadow-sm border border-slate-100 space-y-4">
        <h3 id="day-title" className="font-bold text-slate-900">{selected}</h3>
        {error && <p role="alert" className="text-red-700 bg-red-50 rounded-xl p-3 text-sm">{error}</p>}

        <div>
          <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Assignations prévues</h4>
          {dayPlanned.length ? (
            <ul className="space-y-2">
              {dayPlanned.map(a => (
                <li key={a.id} className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-700 min-w-0">
                      <span className="font-bold text-slate-900 tabular-nums mr-2">{hhmm(new Date(a.date))}</span>
                      {a.type}{a.description ? <span className="text-slate-500"> · {a.description}</span> : null}
                    </span>
                    {closing !== a.id && (
                      <span className="flex gap-1 shrink-0 items-center">
                        {/* « Terminer » seulement à partir du jour prévu : avant, la course ne peut pas être faite. */}
                        {dayKey(a.date) <= todayKey ? (
                          <button type="button" onClick={() => { setClosing(a.id); setCloseAmount(''); setError(''); }}
                            className="flex items-center gap-1 bg-slate-900 text-white text-xs font-bold px-3 py-1.5 rounded-lg"><Check size={14} aria-hidden="true" /> Terminer</button>
                        ) : (
                          <span className="text-[11px] font-bold text-blue-700 bg-blue-100 px-2 py-1 rounded-lg">À venir</span>
                        )}
                        <button type="button" onClick={() => remove(a)} aria-label={`Supprimer l’assignation de ${hhmm(new Date(a.date))}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={16} /></button>
                      </span>
                    )}
                  </div>
                  {closing === a.id && (
                    <div className="mt-2 flex gap-2 items-end">
                      <label className="flex-1 text-xs text-slate-500">Montant de la course ($ CA)
                        <input autoFocus value={closeAmount} onChange={e => setCloseAmount(e.target.value)} inputMode="decimal" placeholder="0,00"
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); finish(a); } }}
                          className="block w-full mt-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 bg-white" />
                      </label>
                      <button type="button" disabled={saving} onClick={() => finish(a)}
                        className="bg-red-600 text-white font-medium px-4 py-2.5 rounded-xl disabled:opacity-50">Enregistrer</button>
                      <button type="button" onClick={() => setClosing(null)} aria-label="Annuler"
                        className="bg-slate-100 text-slate-700 p-2.5 rounded-xl"><X size={18} /></button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">Aucune assignation prévue ce jour-là.</p>}
        </div>

        {isPast ? <p className="pt-4 border-t border-slate-100 text-sm text-slate-500">Jour passé : on ne peut planifier qu’aujourd’hui ou plus tard.</p> : (
        <form onSubmit={plan} className="pt-4 border-t border-slate-100 space-y-3">
          <h4 className="text-sm font-bold text-slate-900">Planifier une assignation</h4>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <label className="col-span-2 md:col-span-1 text-xs text-slate-500">Type
              <select value={otherOpen ? OTHER : chosenType}
                onChange={e => { if (e.target.value === OTHER) { setOtherOpen(true); return; } setOtherOpen(false); setOtherName(''); setType(e.target.value); }}
                className="block w-full mt-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800">
                {activeTypes.map(t => <option key={t} value={t}>{t}</option>)}
                <option value={OTHER}>Autre…</option>
              </select>
            </label>
            {otherOpen && (
              <div className="col-span-2 md:col-span-5 md:order-last flex gap-2 items-end">
                <label className="flex-1 text-xs text-slate-500">Nouveau service
                  <input autoFocus value={otherName} onChange={e => setOtherName(e.target.value)} maxLength={40} placeholder="Ex. Hôpital Pierre-Le Gardeur"
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmOther(); } }}
                    className="block w-full mt-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800" />
                </label>
                <button type="button" onClick={() => confirmOther()} disabled={!otherName.trim()}
                  className="bg-red-600 text-white font-medium px-4 py-2.5 rounded-xl disabled:opacity-40">Ajouter</button>
                <button type="button" onClick={() => { setOtherOpen(false); setOtherName(''); }}
                  className="bg-slate-100 text-slate-700 font-medium px-3 py-2.5 rounded-xl">Annuler</button>
              </div>
            )}
            <label className="text-xs text-slate-500">Date
              <input type="date" value={selected} min={todayKey} required onChange={e => { if (e.target.value) selectDay(e.target.value); }}
                className="block w-full mt-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800" />
            </label>
            <label className="text-xs text-slate-500">Heure
              <input type="time" value={time} onChange={e => setTime(e.target.value)} required
                className="block w-full mt-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800" />
            </label>
            <label className="col-span-2 md:col-span-1 text-xs text-slate-500">Note (facultatif)
              <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="Adresse, client…"
                className="block w-full mt-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800" />
            </label>
            <button type="submit" disabled={saving}
              className="col-span-2 md:col-span-1 self-end flex items-center justify-center gap-2 bg-slate-900 text-white font-medium px-4 py-2.5 rounded-xl hover:bg-slate-800 disabled:opacity-50">
              <Plus size={18} aria-hidden="true" /> Planifier
            </button>
          </div>
        </form>
        )}
      </section>
    </div>
  );
};

export default Calendar;
