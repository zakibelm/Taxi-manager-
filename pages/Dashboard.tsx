import React, { useMemo } from 'react';
import { Service } from '../types';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Car, Clock, Plus, List } from 'lucide-react';
import { formatDate } from '../utils/date';

interface DashboardProps {
  services: Service[];
  navigateToChat: () => void;
  // Note: These props are passed via App.tsx but we'll use local navigation for simplicity in this demo structure
  onNavigate?: (page: string, options?: { openForm?: boolean }) => void;
  user: { name: string };
}

const Dashboard: React.FC<DashboardProps> = ({ services, navigateToChat, onNavigate, user }) => {
  
  const stats = useMemo(() => {
    const totalRevenue = services.reduce((sum, s) => sum + s.amount, 0);
    
    const today = new Date().toLocaleDateString('fr-CA');
    const todaysServices = services.filter(s => new Date(s.date).toLocaleDateString('fr-CA') === today);
    const todaysRevenue = todaysServices.reduce((sum, s) => sum + s.amount, 0);
    const todaysRides = todaysServices.length;
    const todaysHours = '—'; // Hours are not collected by this application.
    const sortedServices = [...services].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const timelineData = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(); date.setDate(date.getDate() - (6 - index));
      const key = date.toLocaleDateString('fr-CA');
      return { day: date.toLocaleDateString('fr-CA', { weekday: 'short' }),
        amount: services.filter(s => new Date(s.date).toLocaleDateString('fr-CA') === key).reduce((sum, s) => sum + s.amount, 0) };
    });

    const recentActivity = sortedServices.reverse().slice(0, 3);

    return { totalRevenue, todaysRevenue, todaysRides, todaysHours, timelineData, recentActivity };
  }, [services]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-24 md:pb-0">
      
      {/* Header */}
      <div className="flex justify-between items-center px-2">
        <div>
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Bonjour,</p>
            <h2 className="text-2xl font-bold text-slate-900">{user.name.split(' ')[0]}</h2>
        </div>
      </div>

      {/* Hero Red Card */}
      <div className="bg-red-600 rounded-[32px] p-6 text-white shadow-xl shadow-red-200 relative overflow-hidden">
        {/* Decorative Circles */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white opacity-10 rounded-full blur-2xl"></div>
        <div className="absolute bottom-0 left-10 w-20 h-20 bg-white opacity-5 rounded-full blur-xl"></div>

        <div className="relative z-10">
            <div className="flex justify-between items-start mb-8">
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">Aujourd'hui</span>
                        
                    </div>
                    <h3 className="text-5xl font-bold tracking-tighter">{stats.todaysRevenue.toFixed(2)}<span className="text-2xl align-top opacity-60 ml-1">$</span></h3>
                </div>
            </div>

            <div className="flex gap-4">
                <div className="flex-1 bg-black/10 rounded-2xl p-3 flex items-center gap-3 backdrop-blur-sm">
                    <div className="w-8 h-8 bg-white text-red-600 rounded-full flex items-center justify-center font-bold">
                        <Car size={16} />
                    </div>
                    <div>
                        <p className="text-lg font-bold leading-none">{stats.todaysRides}</p>
                        <p className="text-[10px] opacity-70 uppercase tracking-wide">Courses</p>
                    </div>
                </div>
                <div className="flex-1 bg-black/10 rounded-2xl p-3 flex items-center gap-3 backdrop-blur-sm">
                    <div className="w-8 h-8 bg-white text-red-600 rounded-full flex items-center justify-center font-bold">
                        <Clock size={16} />
                    </div>
                    <div>
                        <p className="text-lg font-bold leading-none">{stats.todaysHours}</p>
                        <p className="text-[10px] opacity-70 uppercase tracking-wide">Heures non suivies</p>
                    </div>
                </div>
            </div>
        </div>
      </div>

      {/* Quick Actions Grid */}
      <div className="grid grid-cols-2 gap-4">
        <button 
            onClick={() => onNavigate && onNavigate('services', { openForm: true })}
            className="group bg-slate-900 hover:bg-slate-800 text-white p-5 rounded-[28px] flex flex-col justify-between h-44 transition-all shadow-lg active:scale-95"
        >
            <div className="bg-red-600 w-12 h-12 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg shadow-red-900/50">
                <Plus size={24} />
            </div>
            <div className="text-left">
                <p className="font-bold text-lg mb-0.5">Ajouter</p>
                <p className="text-slate-400 text-sm">Une course</p>
            </div>
        </button>

        <button 
            onClick={() => onNavigate && onNavigate('services')}
            className="group bg-white hover:bg-slate-50 text-slate-900 border border-slate-100 p-5 rounded-[28px] flex flex-col justify-between h-44 transition-all shadow-sm active:scale-95"
        >
            <div className="bg-slate-100 w-12 h-12 rounded-full flex items-center justify-center group-hover:bg-slate-200 transition-colors text-slate-900">
                <List size={24} />
            </div>
            <div className="text-left">
                <p className="font-bold text-lg mb-0.5">Voir</p>
                <p className="text-slate-400 text-sm">Historique</p>
            </div>
        </button>
      </div>

      {/* Mini Chart Section */}
      <div className="bg-white rounded-[28px] p-6 shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-900">Tendance Semaine</h3>
              
          </div>
          <div className="h-24 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.timelineData}>
                    <defs>
                        <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#dc2626" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#dc2626" stopOpacity={0}/>
                        </linearGradient>
                    </defs>
                    <Tooltip contentStyle={{ display: 'none' }} />
                    <Area type="monotone" dataKey="amount" stroke="#dc2626" strokeWidth={3} fillOpacity={1} fill="url(#colorAmount)" />
                </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-between px-2 mt-2">
            {stats.timelineData.map((d, i) => (
                <span key={i} className="text-[10px] font-medium text-slate-400 uppercase">{d.day.charAt(0)}</span>
            ))}
          </div>
      </div>

      {/* Recent Activity List */}
      <div>
        <div className="flex justify-between items-end mb-4 px-2">
            <h3 className="font-bold text-lg text-slate-900">Activité Récente</h3>
            <button onClick={() => onNavigate && onNavigate('services')} className="text-xs font-bold text-red-600 hover:text-red-700">Tout voir</button>
        </div>
        
        <div className="space-y-3">
            {stats.recentActivity.map((service) => (
                <div key={service.id} className="bg-white p-4 rounded-2xl flex items-center justify-between shadow-sm border border-slate-50">
                    <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                            service.type === 'Olymel' ? 'bg-red-50 text-red-600' :
                            service.type === 'TCT' ? 'bg-blue-50 text-blue-600' :
                            'bg-slate-50 text-slate-600'
                        }`}>
                            <Car size={20} />
                        </div>
                        <div>
                            <p className="font-bold text-slate-900 truncate max-w-[10rem] sm:max-w-xs">{service.description || service.type}</p>
                            <div className="flex items-center gap-1 text-slate-400 text-xs mt-0.5">
                                <Clock size={10} />
                                <span>{formatDate(service.date)} • {service.type}</span>
                            </div>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="font-bold text-slate-900">{service.amount.toFixed(2)} $</p>
                        <div className="flex items-center justify-end gap-1 text-[10px] text-green-500 font-bold bg-green-50 px-1.5 py-0.5 rounded mt-1">
                            <span>PAYÉ</span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;