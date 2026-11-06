import React from 'react';

import { LayoutDashboard, Car, MessageSquare, LogOut, User, Settings, X, CalendarDays, BarChart3 } from 'lucide-react';

import { UserSession } from '../types';



interface NavigationProps {

  currentPage: string;

  onNavigate: (page: string) => void;

  onLogout: () => void;

  user: UserSession['user'];

  isOpen?: boolean;

  toggleSidebar?: () => void;

}



export const Sidebar: React.FC<NavigationProps> = ({ currentPage, onNavigate, onLogout, user, isOpen, toggleSidebar }) => {

  const navItems = [

    { id: 'dashboard', label: 'Accueil', icon: LayoutDashboard },

    { id: 'services', label: 'Services', icon: Car },
    { id: 'analysis', label: 'Tableau de bord', icon: BarChart3 },
    { id: 'calendar', label: 'Calendrier', icon: CalendarDays },

    { id: 'chat', label: 'Assistant IA', icon: MessageSquare },
    { id: 'profile', label: 'Mon profil', icon: User },

    { id: 'settings', label: 'Paramètres', icon: Settings },

  ];



  return (

    <>

      {/* Mobile Overlay */}

      <div 

        className={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${

          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'

        }`}

        onClick={toggleSidebar}

      />



      {/* Sidebar Container */}

      <div className={`fixed md:static inset-y-0 left-0 z-50 w-72 bg-white border-r border-gray-100 h-full shadow-[4px_0_24px_rgba(0,0,0,0.02)] flex flex-col transition-transform duration-300 ease-in-out ${

          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'

      }`}>

        

        {/* Mobile Close Button */}

        <div className="md:hidden absolute top-4 right-4">

            <button 

                aria-label="Fermer le menu"

                onClick={toggleSidebar}

                className="p-2 text-slate-400 hover:text-red-600 transition-colors"

            >

                <X size={24} />

            </button>

        </div>



        <div className="p-8">

            <div className="flex flex-col items-center gap-3">

              <h1><img src="/taximanager-logo.svg" alt="Taxi Manager" className="w-52 h-28 object-contain" /></h1>

              <div>

                  <p className="text-xs text-slate-400 font-medium">{user.role === 'admin' ? 'PORTAIL ADMINISTRATEUR' : 'PORTAIL CHAUFFEUR'}</p>

              </div>

            </div>

        </div>



        <div className="px-4 py-2 flex-1">

            <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl mb-8 border border-slate-100">

                <div className="w-10 h-10 rounded-full bg-slate-200 overflow-hidden border-2 border-white shadow-sm">

                  <div className="w-full h-full flex items-center justify-center text-slate-500 font-bold bg-white">

                      {user.name.charAt(0)}

                  </div>

                </div>

                <div className="overflow-hidden">

                    <p className="font-bold text-sm text-slate-900 truncate">{user.name}</p>

                    <div className="flex items-center gap-1">

                      <span className="w-2 h-2 rounded-full bg-green-500"></span>

                      <p className="text-xs text-slate-500 truncate">{user.role === 'admin' ? 'Administrateur' : 'En ligne'}</p>

                    </div>

                </div>

            </div>



            <p className="px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Menu</p>

            <nav className="space-y-2">

            {navItems.map((item) => (

                <button

                key={item.id}

                onClick={() => {

                    onNavigate(item.id);

                    if (toggleSidebar) toggleSidebar();

                }}

                className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all duration-200 group ${

                    currentPage === item.id

                    ? 'bg-red-600 text-white shadow-lg shadow-red-200 font-medium'

                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'

                }`}

                >

                <item.icon size={22} className={currentPage === item.id ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'} />

                <span>{item.label}</span>

                </button>

            ))}

            </nav>

        </div>



        <div className="p-6 border-t border-slate-50">

            <button

            onClick={onLogout}

            className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-red-600 transition-colors font-medium"

            >

            <LogOut size={20} />

            <span>Déconnexion</span>

            </button>

        </div>

      </div>

    </>

  );

};



export const BottomNav: React.FC<NavigationProps> = ({ currentPage, onNavigate, toggleSidebar }) => {

    const navItems = [

        { id: 'dashboard', icon: LayoutDashboard },

        { id: 'services', icon: Car },
        { id: 'analysis', icon: BarChart3 },
        { id: 'calendar', icon: CalendarDays },

        { id: 'chat', icon: MessageSquare },
        { id: 'profile', icon: User },

        { id: 'settings', icon: Settings },

    ];



    return (

        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-3 py-2 pb-6 z-50 flex justify-between items-center shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">

            {navItems.map((item) => (

                <button

                    key={item.id}

                    aria-label={({ dashboard: 'Accueil', services: 'Services', analysis: 'Tableau de bord', calendar: 'Calendrier', chat: 'Assistant', profile: 'Mon profil', settings: 'Paramètres' } as Record<string, string>)[item.id]}

                    onClick={() => onNavigate(item.id)}

                    className={`flex flex-col items-center justify-center w-11 h-12 rounded-2xl transition-all duration-300 ${

                        currentPage === item.id 

                        ? 'bg-red-600 text-white shadow-lg shadow-red-200 transform -translate-y-2' 

                        : 'text-slate-400 hover:text-slate-600'

                    }`}

                >

                    <item.icon size={24} strokeWidth={currentPage === item.id ? 2.5 : 2} />

                </button>

            ))}

        </div>

    );

};



export default Sidebar;

