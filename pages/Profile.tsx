import React, { useState } from 'react';
import { UserSession } from '../types';
import CompanySection from '../components/CompanySection';
import { DriverProfile, loadProfile, saveProfile, validateProfile } from '../utils/profile';

interface ProfileProps { user: UserSession['user']; welcome?: boolean; onSaved: () => void; onSkip?: () => void; }

/** Formulaire du profil chauffeur (affiché après la connexion tant qu'il est incomplet). */
const Profile: React.FC<ProfileProps> = ({ user, welcome, onSaved, onSkip }) => {
  const [form, setForm] = useState<DriverProfile>(() => {
    const p = loadProfile(user.email);
    if (!p.first_name && !p.last_name) { const [first, ...rest] = user.name.trim().split(/\s+/); return { ...p, first_name: first ?? '', last_name: rest.join(' ') }; }
    return p;
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const set = (k: keyof DriverProfile) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm({ ...form, [k]: e.target.value }); setSaved(false); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateProfile(form);
    if (problem) { setError(problem); return; }
    try { saveProfile(user.email, { ...form, first_name: form.first_name.trim(), last_name: form.last_name.trim(), phone: form.phone.trim(), license_number: form.license_number.trim(), vehicle: form.vehicle.trim() }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Enregistrement impossible.'); return; }
    setError(''); setSaved(true); onSaved();
  };

  const field = 'block w-full mt-1 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800';
  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-24 md:pb-0 max-w-xl">
      <div className="px-2">
        <h2 className="text-2xl font-bold text-slate-900">{welcome ? 'Bienvenue, complétez votre profil' : 'Mon profil'}</h2>
        <p className="text-slate-500 text-sm">Ces informations restent sur cet appareil, liées à {user.email}. Seule la compagnie d’appartenance, ci-dessous, est enregistrée sur le serveur.</p>
      </div>
      <form onSubmit={submit} className="bg-white rounded-[28px] p-6 shadow-sm border border-slate-100 space-y-4">
        {error && <p role="alert" className="text-red-700 bg-red-50 rounded-xl p-3 text-sm">{error}</p>}
        {saved && <p role="status" className="text-green-800 bg-green-50 rounded-xl p-3 text-sm">Profil enregistré.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-xs text-slate-500">Prénom *<input value={form.first_name} onChange={set('first_name')} maxLength={100} required autoComplete="given-name" className={field} /></label>
          <label className="text-xs text-slate-500">Nom *<input value={form.last_name} onChange={set('last_name')} maxLength={100} required autoComplete="family-name" className={field} /></label>
        </div>
        <label className="text-xs text-slate-500 block">Numéro de permis *<input value={form.license_number} onChange={set('license_number')} maxLength={100} required className={field} /></label>
        <label className="text-xs text-slate-500 block">Téléphone<input value={form.phone} onChange={set('phone')} maxLength={30} inputMode="tel" autoComplete="tel" className={field} /></label>
        <label className="text-xs text-slate-500 block">Numéro du véhicule<input value={form.vehicle} onChange={set('vehicle')} maxLength={60} className={field} /></label>
        <div className="flex flex-wrap gap-3 pt-2">
          <button type="submit" className="bg-red-600 text-white font-medium px-5 py-3 rounded-2xl hover:bg-red-700">Enregistrer</button>
          {welcome && onSkip && <button type="button" onClick={onSkip} className="text-slate-500 font-medium px-4 py-3 hover:text-slate-800">Plus tard</button>}
        </div>
      </form>
      {!welcome && <CompanySection />}
    </div>
  );
};

export default Profile;
