import React, { useEffect, useState } from 'react';
import { UserSession } from '../types';
import CompanySection from '../components/CompanySection';
import DeleteAccount from '../components/DeleteAccount';
import { MyMembership, companyApi } from '../services/company';
import { DriverProfile, loadProfile, saveProfile, validateProfile } from '../utils/profile';

interface ProfileProps { user: UserSession['user']; welcome?: boolean; onSaved: () => void; onSkip?: () => void; onDeleted?: () => void; }

/** Formulaire du profil chauffeur (affiché après la connexion tant qu'il est incomplet). */
const Profile: React.FC<ProfileProps> = ({ user, welcome, onSaved, onSkip, onDeleted }) => {
  const [form, setForm] = useState<DriverProfile>(() => {
    const p = loadProfile(user.email);
    if (!p.first_name && !p.last_name) { const [first, ...rest] = user.name.trim().split(/\s+/); return { ...p, first_name: first ?? '', last_name: rest.join(' ') }; }
    return p;
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    companyApi.membership()
      .then(m => { if (active) { setMembership(m); setCompany(c => c || m?.companyName || ''); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Compagnie indisponible.'); });
    return () => { active = false; };
  }, []);

  const setShare = async (share: boolean) => {
    setBusy(true); setError('');
    try { setMembership(await companyApi.setShare(share)); } catch (e) { setError(e instanceof Error ? e.message : 'Action impossible.'); } finally { setBusy(false); }
  };
  const set = (k: keyof DriverProfile) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm({ ...form, [k]: e.target.value }); setSaved(false); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateProfile(form, company);
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      saveProfile(user.email, { ...form, first_name: form.first_name.trim(), last_name: form.last_name.trim(), phone: form.phone.trim(), vehicle: form.vehicle.trim() });
      const wanted = company.replace(/\s+/g, ' ').trim();
      if (wanted !== membership?.companyName) setMembership(await companyApi.chooseCompanyByName(wanted));
    } catch (err) { setError(err instanceof Error ? err.message : 'Enregistrement impossible.'); setBusy(false); return; }
    setBusy(false); setError(''); setSaved(true); onSaved();
  };

  const field = 'block w-full mt-1 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800';
  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-24 md:pb-0 max-w-xl">
      <div className="px-2">
        <h2 className="text-2xl font-bold text-slate-900">{welcome ? 'Bienvenue, complétez votre profil' : 'Mon profil'}</h2>
        <p className="text-slate-500 text-sm">Courriel du compte : {user.email}. Ces informations restent sur cet appareil ; seule la compagnie d’appartenance est enregistrée sur le serveur. Aucun numéro de permis n’est demandé.</p>
      </div>
      <form onSubmit={submit} className="bg-white rounded-[28px] p-6 shadow-sm border border-slate-100 space-y-4">
        {error && <p role="alert" className="text-red-700 bg-red-50 rounded-xl p-3 text-sm">{error}</p>}
        {saved && <p role="status" className="text-green-800 bg-green-50 rounded-xl p-3 text-sm">Profil enregistré.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-xs text-slate-500">Prénom *<input value={form.first_name} onChange={set('first_name')} maxLength={100} required autoComplete="given-name" className={field} /></label>
          <label className="text-xs text-slate-500">Nom *<input value={form.last_name} onChange={set('last_name')} maxLength={100} required autoComplete="family-name" className={field} /></label>
        </div>
        <label className="text-xs text-slate-500 block">Compagnie *
          <input value={company} onChange={e => { setCompany(e.target.value); setSaved(false); }} maxLength={60} required autoComplete="organization" placeholder="Nom de votre compagnie" className={field} />
          <span className="block mt-1">Obligatoire. Écrivez le nom de votre compagnie ; l’administrateur approuvera votre demande.</span>
        </label>
        <label className="text-xs text-slate-500 block">Type de véhicule (facultatif)<input value={form.vehicle} onChange={set('vehicle')} maxLength={60} placeholder="Ex. Berline, minivan, adapté" className={field} /></label>
        <label className="text-xs text-slate-500 block">Téléphone (facultatif)<input value={form.phone} onChange={set('phone')} maxLength={30} inputMode="tel" autoComplete="tel" className={field} /></label>
        <div className="flex flex-wrap gap-3 pt-2">
          <button type="submit" disabled={busy} className="bg-red-600 text-white font-medium px-5 py-3 rounded-2xl hover:bg-red-700">Enregistrer</button>
          {welcome && onSkip && <button type="button" onClick={onSkip} className="text-slate-500 font-medium px-4 py-3 hover:text-slate-800">Plus tard</button>}
        </div>
      </form>
      <CompanySection membership={membership} busy={busy} onShare={setShare} />
      {onDeleted && user.role !== 'admin' && <DeleteAccount onDeleted={onDeleted} />}
    </div>
  );
};

export default Profile;
