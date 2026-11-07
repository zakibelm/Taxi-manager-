import React, { useEffect, useRef, useState } from 'react';
import { backend } from '../services/storage';
import { UserSession } from '../types';
import { Sparkles, ArrowRight, ArrowLeft, Eye, EyeOff } from 'lucide-react';

interface LoginProps {
  onLogin: (session: UserSession) => void;
}

type Mode = 'login' | 'register' | 'forgot' | 'verify' | 'reset';
const PASSWORD_MIN = 12;

const TITLES: Record<Mode, [string, string]> = {
  login: ['Bon retour !', 'Entrez vos identifiants pour commencer votre quart.'],
  register: ['Créer un compte', 'Recevez un lien par courriel pour confirmer votre adresse et choisir votre mot de passe.'],
  forgot: ['Mot de passe oublié', 'Recevez un lien par courriel pour choisir un nouveau mot de passe.'],
  verify: ['Choisissez votre mot de passe', 'Dernière étape pour activer votre compte.'],
  reset: ['Nouveau mot de passe', 'Choisissez un nouveau mot de passe pour votre compte.'],
};

const inputClass = 'w-full px-5 py-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-red-500 text-slate-900 font-medium placeholder-slate-400 outline-none transition-all';
const labelClass = 'block text-xs font-semibold text-slate-500 uppercase mb-1.5 ml-1';

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [mode, setMode] = useState<Mode>('login');
  const [token, setToken] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Liens reçus par courriel : ?verify=… (inscription), ?reset=… (mot de passe oublié), ?mode=forgot.
  // Le jeton est retiré de l'adresse aussitôt lu (historique, captures d'écran, partage de lien).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verify = params.get('verify'), reset = params.get('reset');
    if (verify) { setToken(verify); setMode('verify'); }
    else if (reset) { setToken(reset); setMode('reset'); }
    else if (params.get('mode') === 'forgot') setMode('forgot');
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const go = (next: Mode, message = '') => {
    setMode(next); setError(''); setNotice(message); setPassword(''); setConfirm('');
    setTimeout(() => headingRef.current?.focus(), 0);
  };

  const run = async (action: () => Promise<void>) => {
    setError(''); setNotice(''); setLoading(true);
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action impossible. Réessayez.'); }
    finally { setLoading(false); }
  };

  const checkNewPassword = () => {
    if (password.length < PASSWORD_MIN) throw new Error(`Le mot de passe doit contenir au moins ${PASSWORD_MIN} caractères.`);
    if (password !== confirm) throw new Error('Les deux mots de passe ne correspondent pas.');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (mode === 'login') onLogin(await backend.login(identifier, password));
      else if (mode === 'register') { const message = await backend.register(identifier, name); go('login', message); }
      else if (mode === 'forgot') { const message = await backend.forgotPassword(identifier); go('login', message); }
      else if (mode === 'verify') { checkNewPassword(); const result = await backend.verifyEmail(token, password); go('login', result.message); }
      else if (mode === 'reset') { checkNewPassword(); const message = await backend.resetPassword(token, password); go('login', message); }
    });
  };

  const handleDemoLogin = () => run(async () => {
    try { onLogin(await backend.loginDemo()); } catch { throw new Error('Connexion démo indisponible. Réessayez.'); }
  });

  const newPassword = mode === 'verify' || mode === 'reset';
  const [title, subtitle] = TITLES[mode];
  const submitLabel = { login: 'Se connecter', register: 'Recevoir le lien', forgot: 'Recevoir le lien', verify: 'Activer mon compte', reset: 'Enregistrer' }[mode];

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="h-64 bg-white w-full flex items-center justify-center px-6 pb-10">
        <img src="/taximanager-logo.svg" alt="Taxi Manager" className="w-full max-w-sm h-44 object-contain" />
      </div>

      <div className="flex-1 -mt-10 z-20 px-6 pb-6">
        <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-xl mx-auto animate-in slide-in-from-bottom-10 duration-500">
          <div className="mb-8">
            {mode !== 'login' && !newPassword && (
              <button type="button" onClick={() => go('login')} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
                <ArrowLeft size={16} aria-hidden="true" /> Retour à la connexion
              </button>
            )}
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-slate-900 outline-none">{title}</h1>
            <p className="text-slate-500 text-sm mt-1">{subtitle}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate={newPassword}>
            {error && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-xl p-3">{error}</p>}
            {notice && <p role="status" className="text-sm text-green-800 bg-green-50 rounded-xl p-3">{notice}</p>}

            {mode === 'register' && (
              <div>
                <label htmlFor="auth-name" className={labelClass}>Nom</label>
                <input id="auth-name" type="text" autoComplete="name" required maxLength={60} value={name}
                  onChange={e => setName(e.target.value)} className={inputClass} placeholder="Votre nom" />
              </div>
            )}

            {!newPassword && (
              <div>
                <label htmlFor="auth-identifier" className={labelClass}>{mode === 'login' ? 'Courriel ou nom d’utilisateur' : 'Courriel'}</label>
                <input id="auth-identifier" type={mode === 'login' ? 'text' : 'email'} autoComplete={mode === 'login' ? 'username' : 'email'}
                  autoCapitalize="none" spellCheck={false} required maxLength={254} value={identifier}
                  onChange={e => setIdentifier(e.target.value)} className={inputClass}
                  placeholder={mode === 'login' ? 'Courriel ou nom d’utilisateur' : 'vous@exemple.com'} />
              </div>
            )}

            {(mode === 'login' || newPassword) && (
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="auth-password" className={labelClass}>{newPassword ? 'Nouveau mot de passe' : 'Mot de passe'}</label>
                  {mode === 'login' && (
                    <button type="button" onClick={() => go('forgot')} className="text-xs font-semibold text-red-700 hover:text-red-800 mb-1.5">Mot de passe oublié ?</button>
                  )}
                </div>
                <div className="relative">
                  <input id="auth-password" type={showPassword ? 'text' : 'password'} required maxLength={256}
                    autoComplete={newPassword ? 'new-password' : 'current-password'} value={password}
                    aria-describedby={newPassword ? 'password-rule' : undefined}
                    onChange={e => setPassword(e.target.value)} className={inputClass + ' pr-14'} placeholder="••••••••" />
                  <button type="button" onClick={() => setShowPassword(v => !v)} aria-pressed={showPassword}
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-slate-800">
                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </div>
                {newPassword && <p id="password-rule" className="mt-1.5 ml-1 text-xs text-slate-500">Au moins {PASSWORD_MIN} caractères.</p>}
              </div>
            )}

            {newPassword && (
              <div>
                <label htmlFor="auth-confirm" className={labelClass}>Confirmez le mot de passe</label>
                <input id="auth-confirm" type={showPassword ? 'text' : 'password'} required maxLength={256} autoComplete="new-password"
                  value={confirm} onChange={e => setConfirm(e.target.value)} className={inputClass} placeholder="••••••••" />
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-red-600 text-white font-bold py-4 rounded-2xl hover:bg-red-700 active:scale-[0.98] transition-all shadow-lg shadow-red-200 flex items-center justify-center gap-2 disabled:opacity-60">
              {loading ? 'Un instant…' : submitLabel}
              <ArrowRight size={20} aria-hidden="true" />
            </button>

            {mode === 'login' && (
              <>
                <p className="text-center text-sm text-slate-600">
                  Pas encore de compte ?{' '}
                  <button type="button" onClick={() => go('register')} className="font-semibold text-red-700 hover:text-red-800">Créer un compte</button>
                </p>
                <div className="relative flex py-2 items-center">
                  <div className="flex-grow border-t border-slate-100"></div>
                  <span className="flex-shrink-0 mx-4 text-slate-400 text-xs font-medium">OU</span>
                  <div className="flex-grow border-t border-slate-100"></div>
                </div>
                <button type="button" onClick={handleDemoLogin} disabled={loading}
                  className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 active:scale-[0.98] transition-all shadow-lg flex items-center justify-center gap-2">
                  <Sparkles size={18} className="text-yellow-400" aria-hidden="true" />
                  <span>Mode Démo</span>
                </button>
              </>
            )}
          </form>
          <p className="text-center text-xs text-slate-400 mt-6">
            <a href="/confidentialite/" className="hover:text-slate-600 underline">Politique de confidentialité</a>
            <span className="block mt-1">© Créé par zakibelm 2026</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
