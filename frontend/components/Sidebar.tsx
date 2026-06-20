import React from 'react';
import { LayoutDashboard, Package, ShoppingCart, Users, MapPin, LogOut, Shirt, Settings, ShoppingBag, Zap, ChevronRight, ChevronLeft, History, Ship, BookOpen, DollarSign, FileText, Percent, Wallet, Megaphone, Award, Facebook, Chrome, UserPlus, MessageCircle } from 'lucide-react';
import { Role } from '../types';
import { isCompanyFinanceUser, COMPANY_FINANCE_VIEW } from '../utils/companyFinanceAccess';
import {
  MARKETING_HUB_VIEW,
  MARKETING_TOP_PRODUCTS_VIEW,
  MARKETING_LEADS_VIEW,
  META_ADS_VIEW,
  GOOGLE_ADS_VIEW,
} from '../utils/marketingAccess';

interface SidebarProps {
  currentView: string;
  onChangeView: (view: string) => void;
  userRole: Role;
  userEmail?: string;
  onLogout: () => void;
  onToggleCollapse?: () => void;
}

const Sidebar: React.FC<SidebarProps> = React.memo(({ currentView, onChangeView, userRole, userEmail, onLogout, onToggleCollapse }) => {
  const menuSections = [
    {
      title: 'Principal',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER] },
        { id: 'inventory', label: 'Inventario', icon: Package, roles: [Role.ADMIN, Role.WAREHOUSE, Role.DEPOSITO] },
        { id: 'catalogs', label: 'Catálogos', icon: BookOpen, roles: [Role.ADMIN, Role.SELLER, Role.CUSTOMER], color: 'emerald' },
        { id: 'stock_history', label: 'Historial Stock', icon: History, roles: [Role.ADMIN, Role.WAREHOUSE], color: 'purple' },
        { id: 'despachos', label: 'Despachos', icon: Ship, roles: [Role.ADMIN], color: 'indigo' },
      ]
    },
    {
      title: 'Pedidos',
      items: [
        { id: 'orders', label: 'Mayoristas', icon: ShoppingCart, roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER, Role.DEPOSITO] },
      ]
    },
    {
      title: 'Canales de Venta',
      items: [
        { id: 'bulk_invoicing', label: 'Facturación masiva', icon: FileText, roles: [Role.ADMIN, Role.WAREHOUSE], color: 'emerald' },
        { id: 'channel_margins', label: 'Márgenes y precios', icon: DollarSign, roles: [Role.ADMIN, Role.WAREHOUSE], color: 'emerald' },
        { id: 'tiendanube_orders', label: 'Tienda Nube', icon: ShoppingBag, roles: [Role.ADMIN, Role.WAREHOUSE], color: 'cyan' },
        { id: 'mercadolibre_orders', label: 'Mercado Libre', icon: Zap, roles: [Role.ADMIN, Role.WAREHOUSE], color: 'yellow' },
        { id: 'mercadolibre_questions', label: 'ML — Preguntas', icon: MessageCircle, roles: [Role.ADMIN, Role.WAREHOUSE], color: 'cyan' },
      ]
    },
    {
      title: 'Marketing',
      items: [
        { id: MARKETING_HUB_VIEW, label: 'Centro de Marketing', icon: Megaphone, roles: [Role.ADMIN, Role.MARKETING], color: 'purple' },
        { id: MARKETING_TOP_PRODUCTS_VIEW, label: 'Más vendidos', icon: Award, roles: [Role.ADMIN, Role.MARKETING], color: 'emerald' },
        { id: MARKETING_LEADS_VIEW, label: 'Leads y embudo', icon: UserPlus, roles: [Role.ADMIN, Role.MARKETING], color: 'teal' },
        { id: 'mercadolibre_product_ads', label: 'ML — Product Ads', icon: Megaphone, roles: [Role.ADMIN, Role.MARKETING], color: 'yellow' },
        { id: META_ADS_VIEW, label: 'Meta Ads', icon: Facebook, roles: [Role.ADMIN, Role.MARKETING], color: 'indigo' },
        { id: GOOGLE_ADS_VIEW, label: 'Google Ads', icon: Chrome, roles: [Role.ADMIN, Role.MARKETING], color: 'indigo' },
      ]
    },
    {
      title: 'CRM',
      items: [
        { id: 'customers', label: 'Clientes', icon: Users, roles: [Role.ADMIN, Role.SELLER] },
        { id: 'sellers', label: 'Vendedores', icon: Percent, roles: [Role.ADMIN, Role.SELLER], color: 'indigo' },
        { id: 'visits', label: 'Visitas', icon: MapPin, roles: [Role.ADMIN, Role.SELLER] },
      ]
    },
    {
      title: 'Sistema',
      items: [
        { id: 'facturacion', label: 'Facturación', icon: DollarSign, roles: [Role.ADMIN, Role.WAREHOUSE], color: 'emerald' },
        { id: 'settings', label: 'Configuración', icon: Settings, roles: [Role.ADMIN, Role.WAREHOUSE] },
      ]
    },
    ...(isCompanyFinanceUser(userEmail)
      ? [
          {
            title: 'Finanzas',
            items: [
              {
                id: COMPANY_FINANCE_VIEW,
                label: 'Resultados empresa',
                icon: Wallet,
                roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER, Role.DEPOSITO],
                color: 'purple',
              },
            ],
          },
        ]
      : []),
  ];

  const getItemStyles = (item: any, isActive: boolean) => {
    if (isActive) {
      if (item.color === 'cyan') return 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/50';
      if (item.color === 'yellow') return 'bg-yellow-600 text-white shadow-lg shadow-yellow-900/50';
      if (item.color === 'purple') return 'bg-purple-600 text-white shadow-lg shadow-purple-900/50';
      if (item.color === 'indigo') return 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50';
      if (item.color === 'emerald') return 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/50';
      return 'bg-blue-600 text-white shadow-lg shadow-blue-900/50';
    }
    return 'text-slate-400 hover:bg-slate-800/50 hover:text-white';
  };

  const getIconColor = (item: any, isActive: boolean) => {
    if (isActive) return 'text-white';
    if (item.color === 'cyan') return 'text-cyan-400';
    if (item.color === 'yellow') return 'text-yellow-400';
    if (item.color === 'purple') return 'text-purple-400';
    if (item.color === 'indigo') return 'text-indigo-400';
    if (item.color === 'emerald') return 'text-emerald-400';
    return '';
  };

  return (
    <div className="hidden md:flex w-64 bg-gradient-to-b from-slate-950 to-slate-900 text-white flex-col h-screen fixed left-0 top-0 shadow-2xl z-20 border-r border-slate-800/50">
      {/* Logo */}
      <div className="p-5 flex items-center gap-2 border-b border-slate-800/50">
        <div className="w-11 h-11 shrink-0 bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/30">
          <Shirt className="text-white" size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">LUPO Hub</h1>
          <p className="text-[10px] text-slate-500 font-medium tracking-wider uppercase">Gestión Mayorista</p>
        </div>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition"
            title="Ocultar menú"
            aria-label="Ocultar menú lateral"
          >
            <ChevronLeft size={18} />
          </button>
        )}
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
});

export default Sidebar;
