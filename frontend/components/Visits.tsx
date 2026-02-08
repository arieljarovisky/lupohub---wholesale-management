import React from 'react';
import { MapPin, Calendar, CheckCircle, XCircle, MoreHorizontal } from 'lucide-react';
import { Visit, Role } from '../types';

interface VisitsProps {
  visits: Visit[];
  role: Role;
}

const Visits: React.FC<VisitsProps> = ({ visits, role }) => {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Registro de Visitas</h2>

      <div className="relative border-l-2 border-slate-700 ml-3 space-y-8 pb-8">
        {visits.map((visit) => (
          <div key={visit.id} className="relative pl-8">
             {/* Timeline Dot */}
             <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-slate-800 shadow-sm ${
               visit.outcome === 'Sale' ? 'bg-green-500' : 'bg-slate-500'
             }`}></div>
             
             <div className="bg-slate-800 p-5 rounded-xl shadow-lg border border-slate-700 flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                   <div className="flex items-center gap-2 mb-1">
                     <Calendar size={14} className="text-slate-400" />
                     <span className="text-sm font-medium text-slate-400">{visit.date}</span>
                   </div>
                   <h3 className="text-lg font-bold text-white mb-1">Cliente #{visit.customerId}</h3>
                   <div className="flex items-center text-sm text-slate-400 mb-3">
                     <MapPin size={14} className="mr-1" />
                     <span>Visita Presencial</span>
                   </div>
                   <p className="text-sm text-slate-300 bg-slate-900 p-3 rounded-lg border border-slate-700">
                     "{visit.notes}"
                   </p>
                </div>
                
                <div className="flex flex-row md:flex-col justify-between items-center md:items-end border-t md:border-t-0 md:border-l border-slate-700 pt-3 md:pt-0 md:pl-6 min-w-[120px]">
                   <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${
                     visit.outcome === 'Sale' 
                       ? 'bg-green-900/30 text-green-400 border border-green-800' 
                       : visit.outcome === 'No Sale'
                       ? 'bg-red-900/30 text-red-400 border border-red-800'
                       : 'bg-yellow-900/30 text-yellow-400 border border-yellow-800'
                   }`}>
                      {visit.outcome === 'Sale' ? <CheckCircle size={14} className="mr-1"/> : <XCircle size={14} className="mr-1"/>}
                      {visit.outcome}
                   </span>
                   
                   <button className="text-slate-500 hover:text-blue-400 p-2 transition">
                     <MoreHorizontal size={20} />
                   </button>
                </div>
             </div>
          </div>
        ))}
      </div>
      
      <div className="flex justify-center">
        <button className="text-sm text-slate-500 hover:text-blue-400 font-medium transition-colors">
          Ver historial completo
        </button>
      </div>
    </div>
  );
};

export default Visits;