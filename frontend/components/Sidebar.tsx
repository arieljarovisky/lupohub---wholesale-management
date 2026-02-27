import React from 'react';
import { LayoutDashboard, Package, ShoppingCart, Users, MapPin, LogOut, Shirt, Settings, ShoppingBag, Zap, ChevronRight } from 'lucide-react';
import { Role } from '../types';

interface SidebarProps {
  currentView: string;
  onChangeView: (view: string) => void;
  userRole: Role;
  onLogout: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView, userRole, onLogout }) => {
  const menuSections = [
    {
      title: 'Principal',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE] },
        { id: 'inventory', label: 'Inventario', icon: Package, roles: [Role.ADMIN, Role.WAREHOUSE, Role.SELLER] },
      ]
    },
    {
      title: 'Pedidos',
      items: [
        { id: 'orders', label: 'Mayoristas', icon: ShoppingCart, roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE] },
      ]
    },
    {
      title: 'Canales de Venta',
      items: [
        { id: 'tiendanube_orders', label: 'Tienda Nube', icon: ShoppingBag, roles: [Role.ADMIN], color: 'cyan' },
        { id: 'mercadolibre_orders', label: 'Mercado Libre', icon: Zap, roles: [Role.ADMIN], color: 'yellow' },
        { id: 'mercadolibre_stock', label: 'Stock ML', icon: Package, roles: [Role.ADMIN], color: 'yellow' },
      ]
    },
    {
      title: 'CRM',
      items: [
        { id: 'customers', label: 'Clientes', icon: Users, roles: [Role.ADMIN, Role.SELLER] },
        { id: 'visits', label: 'Visitas', icon: MapPin, roles: [Role.ADMIN, Role.SELLER] },
      ]
    },
    {
      title: 'Sistema',
      items: [
        { id: 'settings', label: 'Configuración', icon: Settings, roles: [Role.ADMIN] },
      ]
    }
  ];

  const getItemStyles = (item: any, isActive: boolean) => {
    if (isActive) {
      if (item.color === 'cyan') return 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/50';
      if (item.color === 'yellow') return 'bg-yellow-600 text-white shadow-lg shadow-yellow-900/50';
      return 'bg-blue-600 text-white shadow-lg shadow-blue-900/50';
    }
    return 'text-slate-400 hover:bg-slate-800/50 hover:text-white';
  };

  const getIconColor = (item: any, isActive: boolean) => {
    if (isActive) return 'text-white';
    if (item.color === 'cyan') return 'text-cyan-400';
    if (item.color === 'yellow') return 'text-yellow-400';
    return '';
  };

  return (
    <div className="w-64 bg-gradient-to-b from-slate-950 to-slate-900 text-white flex flex-col h-screen fixed left-0 top-0 shadow-2xl z-20 border-r border-slate-800/50">
      {/* Logo */}
      <div className="p-5 flex items-center space-x-3 border-b border-slate-800/50">
        <div className="w-11 h-11 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/30">
          <Shirt className="text-white" size={24} />
        </div>
        <div>
          <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">LUPO Hub</h1>
          <p className="text-[10px] text-slate-500 font-medium tracking-wider uppercase">Gestión Mayorista</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        {menuSections.map((section, sectionIndex) => {
          const visibleItems = section.items.filter(item => item.roles.includes(userRole));
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.title} className={sectionIndex > 0 ? 'mt-6' : ''}>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-2">
                {section.title}
              </p>
              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const isActive = currentView === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onChangeView(item.id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-200 group ${getItemStyles(item, isActive)}`}
                    >
                      <div className="flex items-center space-x-3">
                        <div className={`p-1.5 rounded-lg ${isActive ? 'bg-white/20' : 'bg-slate-800/50 group-hover:bg-slate-700/50'}`}>
                          <item.icon size={18} className={getIconColor(item, isActive)} />
                        </div>
                        <span className="font-medium text-sm">{item.label}</span>
                      </div>
                      {isActive && <ChevronRight size={16} className="opacity-60" />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User Section */}
      <div className="p-3 border-t border-slate-800/50">
        <div className="bg-slate-800/30 rounded-xl p-3 mb-3 border border-slate-700/30">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 bg-gradient-to-br from-slate-600 to-slate-700 rounded-lg flex items-center justify-center">
              <Users size={18} className="text-slate-300" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Sesión activa</p>
              <p className="text-sm font-bold text-white capitalize">{userRole.toLowerCase()}</p>
            </div>
          </div>
        </div>
        <button 
          onClick={onLogout}
          className="w-full flex items-center justify-center space-x-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all p-2.5 rounded-xl"
        >
          <LogOut size={18} />
          <span className="text-sm font-medium">Cerrar Sesión</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
