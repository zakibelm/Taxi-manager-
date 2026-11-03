import React, { useEffect, useRef, useState } from 'react';
import { Service, ServiceType, ServiceTypeEntry } from '../types';
import { backend } from '../services/storage';
import { Plus, Trash2, Search, Filter, X, Calendar, DollarSign, Type } from 'lucide-react';
import { formatDate } from '../utils/date';

interface ServicesProps {
  services: Service[];
  onServiceAdded: () => void;
  onServiceDeleted: () => void;
  /** Ouvre directement le formulaire (bouton « Ajouter » du tableau de bord). */
  autoOpenForm?: boolean;
  onFormOpened?: () => void;
  /** Liste gérée par l'admin ; seuls les types actifs sont proposés à la saisie. */
  serviceTypes: ServiceTypeEntry[];
}


const Services: React.FC<ServicesProps> = ({ services, onServiceAdded, onServiceDeleted, autoOpenForm, onFormOpened, serviceTypes }) => {
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
    setFormData(f => activeTypes.includes(f.type) ? f : { ...f, type: defaultType });
    setIsModalOpen(true);
  };
  const closeModal = () => {
    setIsModalOpen(false);
    setError('');
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
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('All');

  // Form State
  const [formData, setFormData] = useState({
    type: defaultType as ServiceType,
    amount: '',
    date: new Date().toLocaleDateString('en-CA'),
    description: ''
  });

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await backend.addService({
        type: formData.type,
        amount: parseFloat(formData.amount),
        date: new Date(formData.date + 'T12:00:00').toISOString(),
        description: formData.description
      });
      onServiceAdded();
      closeModal();
      setFormData({ type: defaultType, amount: '', date: new Date().toLocaleDateString('en-CA'), description: '' });
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
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-24 md:pb-0">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 px-2">
        <div>
            <h2 className="text-2xl font-bold text-slate-900">Mes Services</h2>
            <p className="text-slate-500 text-sm">Gérez l'historique de vos courses</p>
        </div>
        <button 
            onClick={openModal}
            className="flex items-center gap-2 bg-slate-900 text-white font-medium px-5 py-3 rounded-2xl hover:bg-slate-800 transition-colors shadow-lg shadow-slate-200"
        >
            <Plus size={20} />
            <span>Ajouter une course</span>
        </button>
      </div>

      {error && !isModalOpen && <p role="alert" className="text-red-700">{error}</p>}
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
                                onClick={() => setFormData({...formData, type: type as ServiceType})}
                                className={`px-4 py-2 rounded-full text-xs font-bold border transition-all whitespace-nowrap ${
                                    formData.type === type 
                                    ? 'bg-red-600 border-red-600 text-white' 
                                    : 'bg-transparent border-white/20 text-slate-400 hover:border-white/40'
                                }`}
                            >
                                {type}
                            </button>
                        ))}
                    </div>

                    <div className="space-y-4">
                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5 focus-within:border-red-500/50 transition-colors">
                            <label htmlFor="service-type" className="block text-xs font-bold text-slate-400 uppercase mb-1">Type de Service</label>
                            <div className="flex items-center gap-3 text-white">
                                <Type size={18} className="text-slate-500" />
                                <select id="service-type"
                                    className="w-full bg-transparent border-none focus:ring-0 p-0 text-white font-medium outline-none"
                                    value={formData.type}
                                    onChange={(e) => setFormData({...formData, type: e.target.value as ServiceType})}
                                >
                                    {activeTypes.map(t => <option key={t} value={t} className="bg-slate-900">{t}</option>)}
                                </select>
                            </div>
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