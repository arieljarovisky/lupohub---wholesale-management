import React from 'react';
import { LayoutDashboard, Package, ShoppingCart, Users, MapPin, LogOut, Shirt, Settings } from 'lucide-react';
import { Role } from '../types';

interface SidebarProps {
  currentView: string;
  onChangeView: (view: string) => void;
  userRole: Role;
  onLogout: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView, userRole, onLogout }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE] },
    { id: 'inventory', label: 'Inventario', icon: Package, roles: [Role.ADMIN, Role.WAREHOUSE, Role.SELLER] },
    { id: 'orders', label: 'Pedidos', icon: ShoppingCart, roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE] },
    { id: 'customers', label: 'Clientes', icon: Users, roles: [Role.ADMIN, Role.SELLER] }, // Updated Role
    { id: 'visits', label: 'Visitas', icon: MapPin, roles: [Role.ADMIN, Role.SELLER] }, // Updated Role
    { id: 'settings', label: 'Configuración', icon: Settings, roles: [Role.ADMIN] },
  ];

  return (
    <div className="w-64 bg-slate-950 text-white flex flex-col h-screen fixed left-0 top-0 shadow-2xl z-20 border-r border-slate-800">
      <div className="p-6 flex items-center space-x-3 border-b border-slate-800">
        <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
          <Shirt className="text-white" size={24} />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">LUPO Hub</h1>
          <p className="text-xs text-slate-400">Argentina</p>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {menuItems.map((item) => {
          if (!item.roles.includes(userRole)) return null;
          
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChangeView(item.id)}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                isActive 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50 font-medium' 
                  : 'text-slate-400 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <div className="bg-slate-900 rounded-xl p-4 mb-4 border border-slate-800">
          <p className="text-xs text-slate-400 mb-1">Conectado como</p>
          <p className="text-sm font-semibold text-white capitalize">{userRole.toLowerCase()}</p>
        </div>
        <button 
          onClick={onLogout}
          className="w-full flex items-center justify-center space-x-2 text-slate-400 hover:text-red-400 transition-colors p-2"
        >
          <LogOut size={18} />
          <span className="text-sm">Cerrar Sesión</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;