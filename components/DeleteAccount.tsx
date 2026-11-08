import React, { useState } from 'react';
import { backend } from '../services/storage';

/** Suppression définitive du compte (exigence Google Play) : mot de passe + case de confirmation. */
const DeleteAccount: React.FC<{ onDeleted: () => void }> = ({ onDeleted }) => {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sure || !password || busy) return;
    setBusy(true); setError('');
    try { await backend.deleteAccount(password); onDeleted(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Suppression impossible. Réessayez.'); setBusy(false); }
  };

  return (
    <section aria-labelledby="delete-account-title" className="bg-white rounded-[28px] p-6 shadow-sm border border-red-100 space-y-3">
      <h3 id="delete-account-title" className="font-bold text-slate-900">Supprimer mon compte</h3>
      <p className="text-sm text-slate-500">Efface définitivement votre compte, toutes vos courses, vos assignations et votre appartenance à une compagnie. Cette action est irréversible : exportez d’abord vos courses (Mes Services → Exporter) si vous en avez besoin.</p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-red-700 font-medium border border-red-200 px-4 py-2.5 rounded-2xl hover:bg-red-50">Supprimer mon compte…</button>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {error && <p role="alert" className="text-red-700 bg-red-50 rounded-xl p-3 text-sm">{error}</p>}
          <label className="text-xs text-slate-500 block">Mot de passe pour confirmer
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" maxLength={256} required
              className="block w-full mt-1 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800" />
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={sure} onChange={e => setSure(e.target.checked)} className="mt-1" />
            Je comprends que mon compte et mes données seront supprimés définitivement.
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={!sure || !password || busy} className="bg-red-600 text-white font-medium px-5 py-3 rounded-2xl hover:bg-red-700 disabled:opacity-50">{busy ? 'Suppression…' : 'Supprimer définitivement'}</button>
            <button type="button" onClick={() => { setOpen(false); setPassword(''); setSure(false); setError(''); }} className="text-slate-500 font-medium px-4 py-3 hover:text-slate-800">Annuler</button>
          </div>
        </form>
      )}
    </section>
  );
};

export default DeleteAccount;
