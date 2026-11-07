import React, { useState, useEffect } from 'react';

import { ApiError, backend, DEFAULT_SERVICE_TYPES } from './services/storage';

import { Service, ServiceTypeEntry, UserSession } from './types';

import { Sidebar, BottomNav } from './components/Sidebar';

import Login from './pages/Login';

import Dashboard from './pages/Dashboard';

import Services from './pages/Services';

import Chat from './pages/Chat';

import Settings from './pages/Settings';
import Calendar from './pages/Calendar';
import Profile from './pages/Profile';
import { isProfileComplete, loadProfile } from './utils/profile';

import { Menu } from 'lucide-react';



const App: React.FC = () => {

  const [session, setSession] = useState<UserSession | null>(null);

  const [currentPage, setCurrentPage] = useState('dashboard');

  const [services, setServices] = useState<Service[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeEntry[]>(DEFAULT_SERVICE_TYPES.map(name => ({ name, active: true })));

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [dataError, setDataError] = useState('');

  const [checkingSession, setCheckingSession] = useState(true);
  const [openAddForm, setOpenAddForm] = useState(false);
  const [welcomeProfile, setWelcomeProfile] = useState(false);

  /** Ouvre le formulaire de profil une fois par session de navigation tant qu'il est incomplet. */
  const promptProfile = (email: string) => {
    let done = false;
    try { done = sessionStorage.getItem('taximanager_profile_prompted') === email; } catch { /* stockage indisponible */ }
    if (done || isProfileComplete(loadProfile(email))) return;
    try { sessionStorage.setItem('taximanager_profile_prompted', email); } catch { /* stockage indisponible */ }
    setWelcomeProfile(true); setCurrentPage('profile');
  };

  const navigate = (page: string, options?: { openForm?: boolean }) => {
    setCurrentPage(page);
    setOpenAddForm(Boolean(options?.openForm));
  };



  useEffect(() => {

    let active = true;

    backend.getSession().then(value => { if (active) { setSession(value); if (value) promptProfile(value.user.email); } })

      .catch(() => { if (active) setSession(null); })

      .finally(() => { if (active) setCheckingSession(false); });

    return () => { active = false; };

  }, []);



  // Load initial data on mount/login

  useEffect(() => {

    if (session) {

        refreshServices();
        refreshServiceTypes();
    }

  }, [session]);

  // Retour du réseau : envoi des courses saisies hors ligne, puis rechargement.
  useEffect(() => {
    if (!session) return;
    const onOnline = () => { refreshServices(); refreshServiceTypes(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);



  // Type ajouté via « Autre » : proposé tout de suite ; le serveur le garde dès qu'une course l'utilise.
  const addLocalType = (name: string) => setServiceTypes(prev =>
    prev.some(t => t.name.toLowerCase() === name.toLowerCase()) ? prev : [...prev, { name, active: true }]);
  const refreshServiceTypes = async () => {
    // En cas d'échec, on garde la dernière liste connue : la saisie reste possible.
    try { setServiceTypes(await backend.getServiceTypes()); } catch { /* liste précédente conservée */ }
  };

  const refreshServices = async () => {

    try { const data = await backend.getServices(); setServices(data); setDataError(''); }

    catch (error) {
      // Session expirée (souvent une session reprise hors ligne) : retour à l'écran de connexion.
      if (error instanceof ApiError && error.status === 401) { setSession(null); setServices([]); setDataError(''); return; }
      setServices([]); setDataError(error instanceof Error ? error.message : 'Chargement impossible.');
    }

  };



  const handleLogin = (newSession: UserSession) => {
    // Profil incomplet : le formulaire s'ouvre juste après la connexion.
    promptProfile(newSession.user.email);

    setServices([]);

    setDataError('');

    setSession(newSession);

  };



  const handleLogout = async () => {

    try { await backend.logout(); }

    catch { window.alert('Déconnexion impossible. Réessayez.'); return; }

    setSession(null);

    setCurrentPage('dashboard');

    setIsSidebarOpen(false);

  };



  if (checkingSession) return <div role="status" className="p-8 text-slate-600">Chargement de votre session…</div>;



  if (!session) {

    return <Login onLogin={handleLogin} />;

  }



  return (

    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">

        {/* Sidebar (Desktop + Mobile Drawer) */}

        <Sidebar 

            currentPage={currentPage} 

            onNavigate={navigate} 

            onLogout={handleLogout} 

            user={session.user}

            isOpen={isSidebarOpen}

            toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}

        />



        {/* Main Content Area */}

        <div className="flex-1 flex flex-col h-screen overflow-hidden relative">

            

            {/* Mobile Header with Hamburger */}

            <div className="md:hidden flex items-center justify-between px-6 py-4 bg-white border-b border-slate-50 shadow-sm z-30">

                <button 

                    aria-label="Ouvrir le menu"

                    onClick={() => setIsSidebarOpen(true)}

                    className="p-2 -ml-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"

                >

                    <Menu size={24} />

                </button>

                <img src="/taximanager-logo.svg" alt="Taxi Manager" className="w-32 h-16 object-contain" />

                <div className="w-10"></div> {/* Spacer for balance */}

            </div>



            <main className="flex-1 overflow-y-auto p-4 md:p-8 pt-4 md:pt-8 scrollbar-hide">

                <div className="max-w-5xl mx-auto pb-24 md:pb-0">

                    {session.mode === 'demo' && <p role="status" className="mb-4 rounded-xl bg-amber-100 p-3 text-amber-900">Mode démo — données fictives, conservées uniquement dans ce navigateur.</p>}

                    {dataError && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-red-700">{dataError}</p>}

                    {currentPage === 'dashboard' && (

                        <Dashboard 

                            services={services} 

                            navigateToChat={() => navigate('chat')}
                            onNavigate={navigate}

                            user={session.user}

                        />

                    )}

                    {currentPage === 'services' && (

                        <Services 

                            services={services} 

                            onServiceAdded={refreshServices}

                            onServiceDeleted={refreshServices}
                            autoOpenForm={openAddForm}
                            onFormOpened={() => setOpenAddForm(false)}
                            serviceTypes={serviceTypes}
                            onTypeCreated={addLocalType}
                        />

                    )}

                    {currentPage === 'calendar' && (
                        <Calendar services={services} serviceTypes={serviceTypes} onServiceAdded={refreshServices} onTypeCreated={addLocalType} />
                    )}

                    {currentPage === 'profile' && (
                        <Profile user={session.user} welcome={welcomeProfile}
                          onSaved={() => { if (welcomeProfile) { setWelcomeProfile(false); setCurrentPage('dashboard'); } }}
                          onSkip={() => { setWelcomeProfile(false); setCurrentPage('dashboard'); }} />
                    )}

                    {currentPage === 'chat' && (

                        <Chat services={services} />

                    )}

                    {currentPage === 'settings' && (

                        <Settings
                            serviceTypes={serviceTypes}
                            onServiceTypesChange={setServiceTypes}
                            canManageTypes={session.mode === 'demo'}
                            isDemo={session.mode === 'demo'}
                            currentUser={session.user}
                        />

                    )}

                </div>

            </main>



            {/* Mobile Bottom Navigation */}

            <BottomNav 

                currentPage={currentPage}

                onNavigate={navigate}

                onLogout={handleLogout}

                user={session.user}

                toggleSidebar={() => setIsSidebarOpen(true)}

            />

        </div>

    </div>

  );

};



export default App;

