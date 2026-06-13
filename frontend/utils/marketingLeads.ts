export const LEAD_SOURCES = [
  'FACEBOOK_ADS',
  'GOOGLE_ADS',
  'INSTAGRAM',
  'WHATSAPP',
  'REFERRAL'
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_STAGES = ['LEAD_ENTERED', 'CONTACTED', 'QUOTED', 'SALE_CLOSED'] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  FACEBOOK_ADS: 'Facebook Ads',
  GOOGLE_ADS: 'Google Ads',
  INSTAGRAM: 'Instagram',
  WHATSAPP: 'WhatsApp',
  REFERRAL: 'Referido'
};

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  LEAD_ENTERED: 'Lead ingresado',
  CONTACTED: 'Contactado',
  QUOTED: 'Cotizado',
  SALE_CLOSED: 'Venta cerrada'
};

export const LEAD_STAGE_ORDER: LeadStage[] = [
  'LEAD_ENTERED',
  'CONTACTED',
  'QUOTED',
  'SALE_CLOSED'
];

export const SOURCE_COLORS: Record<LeadSource, string> = {
  FACEBOOK_ADS: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  GOOGLE_ADS: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  INSTAGRAM: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  WHATSAPP: 'bg-green-500/20 text-green-300 border-green-500/30',
  REFERRAL: 'bg-violet-500/20 text-violet-300 border-violet-500/30'
};
