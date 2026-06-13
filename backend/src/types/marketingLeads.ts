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

export function isLeadSource(v: string): v is LeadSource {
  return (LEAD_SOURCES as readonly string[]).includes(v);
}

export function isLeadStage(v: string): v is LeadStage {
  return (LEAD_STAGES as readonly string[]).includes(v);
}
