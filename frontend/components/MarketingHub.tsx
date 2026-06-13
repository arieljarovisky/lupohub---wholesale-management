import React from 'react';
import {
  Award,
  Megaphone,
  Sparkles,
  LayoutGrid,
  Facebook,
  Chrome,
  TrendingUp,
  ChevronRight,
  Radio
} from 'lucide-react';
import {
  MARKETING_TOP_PRODUCTS_VIEW,
  META_ADS_VIEW,
  GOOGLE_ADS_VIEW
} from '../utils/marketingAccess';

interface MarketingHubProps {
  onNavigate?: (view: string) => void;
}

const MarketingHub: React.FC<MarketingHubProps> = ({ onNavigate }) => {
  const go = (view: string) => onNavigate?.(view);

  const sections = [
    {
      title: 'Ventas y rendimiento',
      items: [
        {
          view: MARKETING_TOP_PRODUCTS_VIEW,
          icon: Award,
          title: 'Artículos más vendidos',
          desc: 'Ranking por unidades vendidas en Tienda Nube y Mercado Libre.',
          color: 'from-emerald-500/20 to-green-600/10 border-emerald-500/30'
        }
      ]
    },
    {
      title: 'Mercado Libre — Mercado Ads',
      items: [
        {
          view: 'mercadolibre_canal_difusion',
          icon: Radio,
          title: 'Canal de difusión',
          desc: 'Guía, recomendaciones y accesos a todas las herramientas de ML.',
          color: 'from-amber-500/20 to-yellow-600/10 border-amber-500/30'
        },
        {
          view: 'mercadolibre_product_ads',
          icon: Megaphone,
          title: 'Product Ads',
          desc: 'Campañas y métricas por publicación (ROAS, ACOS, inversión).',
          color: 'from-yellow-500/15 to-amber-600/10 border-yellow-500/25'
        },
        {
          view: 'mercadolibre_brand_ads',
          icon: Sparkles,
          title: 'Brand Ads',
          desc: 'Campañas de visibilidad de marca en Mercado Libre.',
          color: 'from-violet-500/15 to-purple-600/10 border-violet-500/25'
        },
        {
          view: 'mercadolibre_display_ads',
          icon: LayoutGrid,
          title: 'Display Ads',
          desc: 'Banners y campañas de display en el ecosistema ML.',
          color: 'from-cyan-500/15 to-teal-600/10 border-cyan-500/25'
        }
      ]
    },
    {
      title: 'Otras plataformas',
      items: [
        {
          view: META_ADS_VIEW,
          icon: Facebook,
          title: 'Meta Ads',
          desc: 'Campañas de Facebook e Instagram.',
          color: 'from-blue-500/15 to-indigo-600/10 border-blue-500/25'
        },
        {
          view: GOOGLE_ADS_VIEW,
          icon: Chrome,
          title: 'Google Ads',
          desc: 'Campañas de búsqueda, display y shopping.',
          color: 'from-red-500/15 to-orange-600/10 border-red-500/25'
        }
      ]
    }
  ];

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="rounded-2xl border border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-500/10 via-slate-900/80 to-slate-900 p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="shrink-0 w-12 h-12 rounded-xl bg-fuchsia-500/20 flex items-center justify-center">
            <TrendingUp className="text-fuchsia-400" size={24} />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-white">Centro de Marketing</h2>
            <p className="text-slate-400 text-sm mt-2 leading-relaxed max-w-2xl">
              Consultá los artículos con mayor rotación y el rendimiento de tus campañas publicitarias en Mercado Libre,
              Meta y Google Ads. Sin acceso a inventario, pedidos ni facturación.
            </p>
          </div>
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.title}>
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 px-1">{section.title}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {section.items.map((item) => (
              <button
                key={item.view}
                type="button"
                onClick={() => go(item.view)}
                className={`text-left rounded-2xl border bg-gradient-to-br p-5 transition-all hover:scale-[1.01] hover:shadow-lg group ${item.color}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="shrink-0 w-10 h-10 rounded-xl bg-slate-900/50 flex items-center justify-center">
                      <item.icon size={20} className="text-white/90" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-white text-sm sm:text-base">{item.title}</h4>
                      <p className="text-slate-400 text-xs sm:text-sm mt-1 leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                  <ChevronRight
                    size={18}
                    className="shrink-0 text-slate-500 group-hover:text-white transition-colors mt-1"
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default MarketingHub;
