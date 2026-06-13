import { Role } from '../types';

export const MARKETING_HUB_VIEW = 'marketing';
export const MARKETING_TOP_PRODUCTS_VIEW = 'marketing_top_products';
export const META_ADS_VIEW = 'meta_ads';
export const GOOGLE_ADS_VIEW = 'google_ads';

/** Vistas de publicidad y análisis de ventas accesibles para marketing. */
export const MARKETING_VIEWS = [
  MARKETING_HUB_VIEW,
  MARKETING_TOP_PRODUCTS_VIEW,
  'mercadolibre_canal_difusion',
  'mercadolibre_product_ads',
  'mercadolibre_brand_ads',
  'mercadolibre_display_ads',
  META_ADS_VIEW,
  GOOGLE_ADS_VIEW,
] as const;

export type MarketingView = (typeof MARKETING_VIEWS)[number];

export function isMarketingView(view: string): boolean {
  const base = String(view || '').split('?')[0];
  return (MARKETING_VIEWS as readonly string[]).includes(base);
}

export function canAccessMarketingView(view: string, role: Role): boolean {
  if (!isMarketingView(view)) return false;
  return role === Role.MARKETING || role === Role.ADMIN;
}
