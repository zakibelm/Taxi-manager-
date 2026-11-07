import React, { useEffect, useRef, useState } from 'react';
import { Service, ServiceType, ServiceTypeEntry } from '../types';
import { backend, servicesToCsv, resolveNewType } from '../services/storage';
import { Plus, Trash2, Search, Filter, X, Calendar, DollarSign, Type, Download, FileText, CloudOff, Clock, MapPin } from 'lucide-react';
import { formatDate } from '../utils/date';
import { buildReportPdf } from '../utils/reportPdf';
import { dayKey } from '../utils/stats';
import { currentOrigin, Origin } from '../utils/geo';

interface ServicesProps {
  services: Service[];
  onServiceAdded: () => void;
  onServiceDeleted: () => void;
  /** Ouvre directement le formulaire (bouton « Ajouter » du tableau de bord). */
  autoOpenForm?: boolean;
  onFormOpened?: () => void;
  /** Liste gérée par l'admin ; seuls les types actifs sont proposés à la saisie. */
  serviceTypes: ServiceTypeEntry[];
  /** Nouveau type saisi via « Autre » : ajouté à la liste. */
  onTypeCreated: (name: string) => void;
}

const OTHER = '__autre__';
/** Heure locale actuelle au format HH:MM (valeur par défaut du champ Heure). */
const nowTime = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });


const Services: React.FC<ServicesProps> = ({ services, onServiceAdded, onServiceDeleted, autoOpenForm, onFormOpened, serviceTypes, onTypeCreated }) => {
  const activeTypes = serviceTypes.filter(t => t.active).map(t => t.name);
  const archived = new Set(serviceTypes.filter(t => !t.active).map(t => t.name));
  // Filtre : tous les types connus + ceux présents dans l'historique (même archivés).
  const filterTypes = [...new Set([...serviceTypes.map(t => t.name), ...services.map(s => s.type)])];
  const defaultType = activeTypes[0] ?? '';
  const [isModalOpen, setIsModalOpen] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const openModal = () => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    setFormData(f => ({ ...(activeTypes.includes(f.type) ? f : { ...f, type: defaultType }), date: new Date().toLocaleDateString('en-CA'), time: nowTime() }));
    setLocate({ on: false, state: 'idle' });
    setIsModalOpen(true);
  };
  const closeModal = () => {
    setIsModalOpen(false);
    setError('');
    setOtherOpen(false); setOtherName('');
    triggerRef.current?.focus?.();
  };

  // Ouverture directe depuis le tableau de bord
  useEffect(() => {
    if (autoOpenForm) { openModal(); onFormOpened?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenForm]);

  // Focus sur le montant à l'ouverture et fermeture par Échap
  useEffect(() => {
    if (!isModalOpen) return;
    amountRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // « Localiser l'appel » : case à cocher (consentement par course). La position est prise au moment où l'on coche
  // (cochez à la prise en charge du client), arrondie à ≈ 100 m, et n'est enregistrée qu'avec cette course.
  const [locate, setLocate] = useState<{ on: boolean; state: 'idle' | 'loading' | 'ok' | 'error'; origin?: Origin; message?: string }>({ on: false, state: 'idle' });
  const toggleLocate = async (on: boolean) => {
    if (!on) { setLocate({ on: false, state: 'idle' }); return; }
    setLocate({ on: true, state: 'loading' });
    try { const origin = await currentOrigin(); setLocate({ on: true, state: 'ok', origin }); }
    catch (err) { setLocate({ on: true, state: 'error', message: err instanceof Error ? err.message : 'Position introuvable.' }); }
  };
  // « Autre » : champ pour saisir un nouveau type de service
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherName, setOtherName] = useState('');
  const otherRef = useRef<HTMLInputElement>(null);
  const openOther = () => { setOtherOpen(true); setError(''); setTimeout(() => otherRef.current?.focus(), 0); };
  const cancelOther = () => { setOtherOpen(false); setOtherName(''); };
  /** Valide le nom saisi, l'ajoute à la liste et le sélectionne ; renvoie le type ou null si invalide. */
  const confirmOther = (): string | null => {
    try {
      const name = resolveNewType(otherName, serviceTypes.map(t => t.name));
      onTypeCreated(name);
      setFormData(f => ({ ...f, type: name }));
      setOtherOpen(false); setOtherName(''); setError('');
      return name;
    } catch (err) { setError(err instanceof Error ? err.message : 'Nom invalide.'); otherRef.current?.focus(); return null; }
  };
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('All');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const periodInvalid = Boolean(periodStart && periodEnd && periodStart > periodEnd);

  // Form State
  const [formData, setFormData] = useState({
    type: defaultType as ServiceType,
    amount: '',
    date: new Date().toLocaleDateString('en-CA'),
    time: nowTime(),
    description: ''
  });

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    // Nom saisi dans « Autre » sans cliquer sur Ajouter : on l'applique avant d'enregistrer.
    let type = formData.type;
    if (otherOpen) {
      if (!otherName.trim()) { setError('Entrez le nom du nouveau service ou cliquez sur Annuler.'); otherRef.current?.focus(); return; }
      const added = confirmOther();
      if (!added) return;
      type = added;
    }
    if (locate.on && locate.state === 'loading') { setError('Localisation en cours : patientez un instant.'); return; }
    if (locate.on && locate.state !== 'ok') { setError('Position non obtenue : réessayez en recochant la case, ou décochez-la.'); return; }
    setLoading(true);
    try {
      await backend.addService({
        type,
        amount: parseFloat(formData.amount),
        date: new Date(`${formData.date}T${formData.time || '12:00'}:00`).toISOString(),
        description: formData.description,
        ...(locate.on && locate.origin ? locate.origin : {})
      });
      onServiceAdded();
      closeModal();
      setFormData({ type: defaultType, amount: '', date: new Date().toLocaleDateString('en-CA'), time: nowTime(), description: '' });
      setLocate({ on: false, state: 'idle' });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Ajout impossible.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Voulez-vous vraiment supprimer cette course ?')) {
      try { await backend.deleteService(id); onServiceDeleted(); }
      catch (error) { setError(error instanceof Error ? error.message : 'Suppression impossible.'); }
    }
  };

  const filteredServices = services.filter(s => {
    const matchesSearch = s.description?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          s.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          s.amount.toString().includes(searchTerm);
    const matchesFilter = filterType === 'All' || s.type === filterType;
    const day = dayKey(s.date);
    const matchesPeriod = periodInvalid || ((!periodStart || day >= periodStart) && (!periodEnd || day <= periodEnd));
    return matchesSearch && matchesFilter && matchesPeriod;
  });

  const pendingCount = services.filter(s => s.pending).length;
  /** Télécharge les courses affichées (filtres appliqués) en CSV, pour la comptabilité. */
  const exportCsv = () => {
    const blob = new Blob([servicesToCsv(filteredServices)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `courses-taximanager-${new Date().toLocaleDateString('en-CA')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** Rapport PDF des courses affichées (filtres appliqués). */
  const exportPdf = async () => {
    const blob = await buildReportPdf(filteredServices, services[0]?.driver_email ?? '', periodInvalid ? undefined : { start: periodStart, end: periodEnd });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `rapport-taximanager-${new Date().toLocaleDateString('en-CA')}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-24 md:pb-0">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 px-2">
        <div>
            <h2 className="text-2xl font-bold text-slate-900">Mes Services</h2>
            <p className="text-slate-500 text-sm">Gérez l'historique de vos courses</p>
        </div>
        <div className="flex gap-2">
        <button
            onClick={exportCsv}
            disabled={filteredServices.length === 0}
            className="flex items-center gap-2 bg-white text-slate-900 font-medium px-4 py-3 rounded-2xl border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
            <Download size={20} aria-hidden="true" />
            <span>Exporter (CSV)</span>
        </button>
        <button
            onClick={exportPdf}
            disabled={filteredServices.length === 0}
            className="flex items-center gap-2 bg-white text-slate-900 font-medium px-4 py-3 rounded-2xl border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
            <FileText size={20} aria-hidden="true" />
            <span>Rapport (PDF)</span>
        </button>
        <button 
            onClick={openModal}
            className="flex items-center gap-2 bg-slate-900 text-white font-medium px-5 py-3 rounded-2xl hover:bg-slate-800 transition-colors shadow-lg shadow-slate-200"
        >
            <Plus size={20} />
            <span>Ajouter une course</span>
        </button>
        </div>
      </div>

      {pendingCount > 0 && (
        <p role="status" className="flex items-center gap-2 mx-2 px-4 py-3 rounded-2xl bg-amber-50 text-amber-800 text-sm">
          <CloudOff size={18} aria-hidden="true" />
          {pendingCount === 1 ? '1 course saisie hors ligne sera envoyée' : `${pendingCount} courses saisies hors ligne seront envoyées`} au retour de la connexion.
        </p>
      )}

      {error && !isModalOpen && <p role="alert" className="text-red-700">{error}</p>}
      {/* Période : filtre la liste et alimente les exports CSV et PDF */}
      <div className="flex flex-wrap items-end gap-3 bg-white p-4 rounded-3xl shadow-sm border border-slate-100">
        <label className="text-xs text-slate-500">Début de la période
          <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="block mt-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800" />
        </label>
        <label className="text-xs text-slate-500">Fin de la période
          <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="block mt-1 border border-slate-200 rounded-xl px-3 py-2 text-slate-800" />
        </label>
        {(periodStart || periodEnd) && <button type="button" onClick={() => { setPeriodStart(''); setPeriodEnd(''); }} className="text-xs font-bold text-red-600 hover:text-red-700 px-3 py-2">Toute la période</button>}
        <p className="text-xs text-slate-500 basis-full">Les exports CSV et PDF reprennent la période, le type et la recherche affichés.</p>
        {periodInvalid && <p role="alert" className="text-red-700 text-sm basis-full">La date de début doit précéder la date de fin (période ignorée).</p>}
      </div>
      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 bg-white p-4 rounded-3xl shadow-sm border border-slate-100">
        <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" size={20} />
            <input 
                type="text" 
                placeholder="Rechercher..." 
                className="w-full pl-12 pr-4 py-3 bg-slate-50 border-none rounded-2xl text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-red-500 outline-none"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
        </div>
        <div className="relative w-full md:w-auto">
            <Filter className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" size={20} />
            <select 
                className="w-full md:w-48 pl-12 pr-10 py-3 bg-slate-50 border-none rounded-2xl text-slate-900 focus:ring-2 focus:ring-red-500 outline-none appearance-none"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
            >
                <option value="All">Tous les types</option>
                {filterTypes.map(t => <option key={t} value={t}>{archived.has(t) ? `${t} (archivé)` : t}</option>)}
            </select>
        </div>
      </div>

      {/* Mobile: cartes (pas de défilement horizontal) */}
      <ul className="md:hidden space-y-3" aria-label="Historique des courses">
        {filteredServices.length > 0 ? filteredServices.map(service => (
          <li key={service.id} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900">{service.amount.toFixed(2)} $</span>
                <span className="text-slate-500 text-sm">{formatDate(service.date)}</span>
                {service.pending && <span className="text-xs font-bold text-amber-700">En attente</span>}
              </div>
              <div className="mt-1 flex items-center gap-2 min-w-0">
                <span className="shrink-0 inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600">{service.type}</span>
                {service.description && <span className="text-slate-500 text-sm truncate">{service.description}</span>}
              </div>
            </div>
            <button
              onClick={() => handleDelete(service.id)}
              aria-label={`Supprimer la course du ${formatDate(service.date)} (${service.amount.toFixed(2)} $)`}
              className="text-slate-500 hover:text-red-600 transition-colors p-2 -m-1 shrink-0"
            >
              <Trash2 size={18} aria-hidden="true" />
            </button>
          </li>
        )) : (
          <li className="bg-white rounded-2xl p-8 text-center text-slate-500">Aucune course trouvée.</li>
        )}
      </ul>

      {/* Tableau (tablette et bureau) */}
      <div className="hidden md:block bg-white rounded-[32px] shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
            <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-400 text-xs uppercase tracking-wider">
                    <tr>
                        <th className="px-6 py-5 font-semibold">Date</th>
                        <th className="px-6 py-5 font-semibold">Type</th>
                        <th className="px-6 py-5 font-semibold">Montant</th>
                        <th className="px-6 py-5 font-semibold hidden md:table-cell">Note</th>
                        <th className="px-6 py-5 font-semibold text-right"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {filteredServices.length > 0 ? (
                        filteredServices.map(service => (
                            <tr key={service.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-5 text-slate-600 font-medium text-sm">
                                    {formatDate(service.date)}
                                </td>
                                <td className="px-6 py-5">
                                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold 
                                        ${(service.type === 'Régulier' || service.type === 'Regular') ? 'bg-slate-100 text-slate-600' : 
                                          service.type === 'Olymel' ? 'bg-red-50 text-red-600' :
                                          service.type === 'TCT' ? 'bg-blue-50 text-blue-600' :
                                          'bg-yellow-50 text-yellow-700'}`}>
                                        {service.type}
                                    </span>
                                </td>
                                <td className="px-6 py-5 font-bold text-slate-900">
                                    {service.amount.toFixed(2)} $
                                    {service.pending && <span className="ml-2 text-xs font-bold text-amber-700">En attente</span>}
                                </td>
                                <td className="px-6 py-5 text-slate-400 text-sm hidden md:table-cell max-w-xs truncate">
                                    {service.description || '-'}
                                </td>
                                <td className="px-6 py-5 text-right">
                                    <button 
                                        onClick={() => handleDelete(service.id)}
                                        aria-label={`Supprimer la course du ${formatDate(service.date)} (${service.amount.toFixed(2)} $)`}
                                        className="text-slate-500 hover:text-red-600 transition-colors p-2"
                                    >
                                        <Trash2 size={18} aria-hidden="true" />
                                    </button>
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                                Aucune course trouvée.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
      </div>

      {/* Dark Mode Add Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
            <div role="dialog" aria-modal="true" aria-labelledby="new-service-title" className="bg-[#121212] max-h-[90dvh] overflow-y-auto w-full max-w-md rounded-t-[32px] md:rounded-[32px] overflow-hidden animate-in slide-in-from-bottom-20 duration-300 shadow-2xl border border-white/10">
                <div className="px-6 py-6 flex justify-between items-center border-b border-white/5">
                    <h3 id="new-service-title" className="text-white font-bold text-xl">Nouvelle Course</h3>
                    <button type="button" aria-label="Fermer le formulaire" onClick={closeModal} className="text-slate-400 hover:text-white bg-white/5 p-2 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>
                
                <form onSubmit={handleAddService} className="p-6 space-y-5">
                    {error && <p role="alert" className="text-red-300">{error}</p>}
                    {/* Quick Select Chips - Now showing ALL service types */}
                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                        {activeTypes.map(type => (
                            <button
                                type="button"
                                key={type}
                                onClick={() => { cancelOther(); setFormData({...formData, type: type as ServiceType}); }}
                                className={`px-4 py-2 rounded-full text-xs font-bold border transition-all whitespace-nowrap ${
                                    !otherOpen && formData.type === type 
                                    ? 'bg-red-600 border-red-600 text-white' 
                                    : 'bg-transparent border-white/20 text-slate-400 hover:border-white/40'
                                }`}
                            >
                                {type}
                            </button>
                        ))}
                        <button type="button" onClick={openOther}
                            className={`px-4 py-2 rounded-full text-xs font-bold border transition-all whitespace-nowrap ${otherOpen ? 'bg-red-600 border-red-600 text-white' : 'bg-transparent border-dashed border-white/30 text-slate-400 hover:border-white/50'}`}>
                            + Autre
                        </button>
                    </div>

                    <div className="space-y-4">
                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5 focus-within:border-red-500/50 transition-colors">
                            <label htmlFor="service-type" className="block text-xs font-bold text-slate-400 uppercase mb-1">Type de Service</label>
                            <div className="flex items-center gap-3 text-white">
                                <Type size={18} className="text-slate-500" />
                                <select id="service-type"
                                    className="w-full bg-transparent border-none focus:ring-0 p-0 text-white font-medium outline-none"
                                    value={otherOpen ? OTHER : formData.type}
                                    onChange={(e) => {
                                        if (e.target.value === OTHER) { openOther(); return; }
                                        cancelOther();
                                        setFormData({...formData, type: e.target.value as ServiceType});
                                    }}
                                >
                                    {activeTypes.map(t => <option key={t} value={t} className="bg-slate-900">{t}</option>)}
                                    <option value={OTHER} className="bg-slate-900">Autre…</option>
                                </select>
                            </div>
                            {otherOpen && (
                                <div className="mt-3 space-y-2">
                                    <label htmlFor="service-type-other" className="block text-xs font-bold text-slate-400 uppercase">Nouveau service</label>
                                    <div className="flex gap-2">
                                        <input ref={otherRef} id="service-type-other" type="text" maxLength={40}
                                            placeholder="Ex. Hôpital Pierre-Le Gardeur"
                                            className="flex-1 min-w-0 bg-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-red-500/50"
                                            value={otherName}
                                            onChange={(e) => setOtherName(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmOther(); } }}
                                        />
                                        <button type="button" onClick={() => confirmOther()} disabled={!otherName.trim()}
                                            className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold disabled:opacity-40">Ajouter</button>
                                        <button type="button" onClick={cancelOther} aria-label="Annuler le nouveau service"
                                            className="px-3 py-2 rounded-xl bg-white/5 text-slate-300 text-sm">Annuler</button>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5 focus-within:border-red-500/50 transition-colors">
                            <label htmlFor="service-amount" className="block text-xs font-bold text-slate-400 uppercase mb-1">Montant Total</label>
                            <div className="flex items-center gap-3 text-white">
                                <DollarSign size={18} className="text-slate-500" />
                                <input 
                                    ref={amountRef}
                                    id="service-amount" type="number" inputMode="decimal"
                                    aria-describedby="service-amount-hint" 
                                    step="0.01" min="0.01" max="10000"
                                    required
                                    placeholder="0.00"
                                    className="w-full bg-transparent border-none focus:ring-0 p-0 text-white font-medium placeholder-slate-600 outline-none"
                                    value={formData.amount}
                                    onInvalid={(e) => {
                                        const el = e.currentTarget;
                                        el.setCustomValidity(el.validity.valueMissing ? 'Entrez le montant de la course.'
                                          : el.validity.rangeUnderflow ? 'Le montant doit être supérieur à 0 $.'
                                          : el.validity.rangeOverflow ? 'Le montant ne peut pas dépasser 10 000 $.'
                                          : 'Entrez un montant valide (ex. 27.50).');
                                    }}
                                    onChange={(e) => { e.currentTarget.setCustomValidity(''); setFormData({...formData, amount: e.target.value}); }}
                                />
                            </div>
                            <p id="service-amount-hint" className="mt-1 text-xs text-slate-400">En dollars canadiens, entre 0,01 $ et 10 000 $.</p>
                        </div>

                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5 focus-within:border-red-500/50 transition-colors">
                            <label htmlFor="service-date" className="block text-xs font-bold text-slate-400 uppercase mb-1">Date</label>
                            <div className="flex items-center gap-3 text-white">
                                <Calendar size={18} className="text-slate-500" />
                                <input 
                                    id="service-date" type="date" 
                                    required
                                    className="w-full bg-transparent border-none focus:ring-0 p-0 text-white font-medium outline-none invert-calendar-icon"
                                    value={formData.date}
                                    onInvalid={(e) => e.currentTarget.setCustomValidity('Choisissez la date de la course.')}
                                    onChange={(e) => { e.currentTarget.setCustomValidity(''); setFormData({...formData, date: e.target.value}); }}
                                    style={{ colorScheme: 'dark' }}
                                />
                            </div>
                        </div>

                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5 focus-within:border-red-500/50 transition-colors">
                            <label htmlFor="service-time" className="block text-xs font-bold text-slate-400 uppercase mb-1">Heure</label>
                            <div className="flex items-center gap-3 text-white">
                                <Clock size={18} className="text-slate-500" />
                                <input
                                    id="service-time" type="time" required
                                    className="w-full bg-transparent border-none focus:ring-0 p-0 text-white font-medium outline-none"
                                    value={formData.time}
                                    onInvalid={(e) => e.currentTarget.setCustomValidity('Indiquez l’heure de la course.')}
                                    onChange={(e) => { e.currentTarget.setCustomValidity(''); setFormData({...formData, time: e.target.value}); }}
                                    style={{ colorScheme: 'dark' }}
                                />
                            </div>
                        </div>

                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                            <label htmlFor="service-locate" className="flex items-start gap-3 text-white cursor-pointer">
                                <input id="service-locate" type="checkbox" className="mt-1 h-5 w-5 accent-red-600"
                                    checked={locate.on} aria-describedby="service-locate-hint"
                                    onChange={(e) => toggleLocate(e.target.checked)} />
                                <span className="flex-1">
                                    <span className="flex items-center gap-2 font-medium"><MapPin size={18} className="text-slate-500" aria-hidden="true" /> Localiser l’origine de l’appel</span>
                                    <span id="service-locate-hint" className="block mt-1 text-xs text-slate-400">
                                        Cochez à la prise en charge : la position du téléphone est arrondie à environ 100 m et sert à recommander la zone d’appel probable selon l’heure et la période. Elle n’est enregistrée qu’avec cette course.
                                    </span>
                                </span>
                            </label>
                            {locate.on && (
                                <p role="status" aria-live="polite" className={`mt-3 text-xs ${locate.state === 'error' ? 'text-red-300' : locate.state === 'ok' ? 'text-emerald-300' : 'text-slate-300'}`}>
                                    {locate.state === 'loading' && 'Localisation en cours…'}
                                    {locate.state === 'ok' && 'Position enregistrée pour cette course.'}
                                    {locate.state === 'error' && locate.message}
                                </p>
                            )}
                        </div>

                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5 focus-within:border-red-500/50 transition-colors">
                            <label htmlFor="service-notes" className="block text-xs font-bold text-slate-400 uppercase mb-1">Notes (Optionnel)</label>
                            <textarea id="service-notes"
                                className="w-full bg-transparent border-none focus:ring-0 p-0 text-white font-medium placeholder-slate-600 outline-none resize-none"
                                rows={2} maxLength={500}
                                placeholder="Détails supplémentaires..."
                                value={formData.description}
                                onChange={(e) => setFormData({...formData, description: e.target.value})}
                            />
                        </div>
                    </div>

                    <button 
                        type="submit"
                        disabled={loading}
                        className="w-full py-4 bg-red-600 text-white hover:bg-red-500 rounded-2xl font-bold shadow-lg shadow-red-900/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-4"
                    >
                        <Plus size={20} />
                        {loading ? 'Ajout...' : 'Ajouter le service'}
                    </button>
                </form>
            </div>
        </div>
      )}
    </div>
  );
};

export default Services;
