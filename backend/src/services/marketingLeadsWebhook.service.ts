import crypto from 'crypto';
import axios from 'axios';
import { execute, get } from '../database/db';
import { getMetaAdsConfig } from './adsIntegrations.service';
import {
  createMarketingLeadFromWebhook,
  type MarketingLeadRow
} from './marketingLeads.service';
import { isLeadSource, type LeadSource } from '../types/marketingLeads';

export type MarketingLeadsWebhookConfigUi = {
  enabled: boolean;
  webhookSecret?: string;
  hasWebhookSecret: boolean;
  webhookSecretMasked: string;
  metaVerifyToken: string;
  metaAppSecret?: string;
  hasMetaAppSecret: boolean;
  metaAppSecretMasked: string;
  metaLeadsEnabled: boolean;
  whatsappEnabled: boolean;
  inboundUrl: string;
  metaWebhookUrl: string;
  whatsappWebhookUrl: string;
};

type WebhookConfigRow = {
  enabled: number;
  webhook_secret: string;
  meta_verify_token: string;
  meta_app_secret: string | null;
  meta_leads_enabled: number;
  whatsapp_enabled: number;
};

function maskSecret(value: string): string {
  if (!value || value.length < 8) return '••••••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function backendBaseUrl(): string {
  return (process.env.BACKEND_URL || process.env.API_URL || 'http://localhost:3010').replace(/\/$/, '');
}

async function readConfigRow(): Promise<WebhookConfigRow | null> {
  return get('SELECT * FROM marketing_leads_webhook_config WHERE id = 1');
}

export async function getMarketingLeadsWebhookConfigForUi(
  includeSecrets = false
): Promise<MarketingLeadsWebhookConfigUi> {
  const row = await readConfigRow();
  const base = backendBaseUrl();
  const inboundUrl = `${base}/api/marketing/leads/webhook/inbound`;
  const metaWebhookUrl = `${base}/api/marketing/leads/webhook/meta`;
  if (!row) {
    return {
      enabled: false,
      hasWebhookSecret: false,
      webhookSecretMasked: '',
      metaVerifyToken: '',
      hasMetaAppSecret: false,
      metaAppSecretMasked: '',
      metaLeadsEnabled: true,
      whatsappEnabled: true,
      inboundUrl,
      metaWebhookUrl,
      whatsappWebhookUrl: metaWebhookUrl
    };
  }
  return {
    enabled: !!row.enabled,
    webhookSecret: includeSecrets ? row.webhook_secret : undefined,
    hasWebhookSecret: !!row.webhook_secret,
    webhookSecretMasked: maskSecret(row.webhook_secret),
    metaVerifyToken: row.meta_verify_token,
    metaAppSecret: includeSecrets && row.meta_app_secret ? row.meta_app_secret : undefined,
    hasMetaAppSecret: !!row.meta_app_secret,
    metaAppSecretMasked: row.meta_app_secret ? maskSecret(row.meta_app_secret) : '',
    metaLeadsEnabled: !!row.meta_leads_enabled,
    whatsappEnabled: !!row.whatsapp_enabled,
    inboundUrl,
    metaWebhookUrl,
    whatsappWebhookUrl: metaWebhookUrl
  };
}

export async function saveMarketingLeadsWebhookConfig(input: {
  enabled?: boolean;
  webhookSecret?: string;
  regenerateWebhookSecret?: boolean;
  metaVerifyToken?: string;
  metaAppSecret?: string;
  keepExistingMetaAppSecret?: boolean;
  metaLeadsEnabled?: boolean;
  whatsappEnabled?: boolean;
}): Promise<MarketingLeadsWebhookConfigUi> {
  const row = await readConfigRow();
  if (!row) throw new Error('Configuración de webhook no inicializada');

  let webhookSecret = row.webhook_secret;
  if (input.regenerateWebhookSecret) {
    webhookSecret = crypto.randomBytes(24).toString('hex');
  } else if (input.webhookSecret?.trim()) {
    webhookSecret = input.webhookSecret.trim();
  }

  let metaVerifyToken = row.meta_verify_token;
  if (input.metaVerifyToken?.trim()) metaVerifyToken = input.metaVerifyToken.trim();

  let metaAppSecret = row.meta_app_secret;
  if (input.metaAppSecret?.trim()) metaAppSecret = input.metaAppSecret.trim();
  else if (input.keepExistingMetaAppSecret) metaAppSecret = row.meta_app_secret;

  await execute(
    `UPDATE marketing_leads_webhook_config SET
      enabled = ?,
      webhook_secret = ?,
      meta_verify_token = ?,
      meta_app_secret = ?,
      meta_leads_enabled = ?,
      whatsapp_enabled = ?
     WHERE id = 1`,
    [
      input.enabled != null ? (input.enabled ? 1 : 0) : row.enabled,
      webhookSecret,
      metaVerifyToken,
      metaAppSecret || null,
      input.metaLeadsEnabled != null ? (input.metaLeadsEnabled ? 1 : 0) : row.meta_leads_enabled,
      input.whatsappEnabled != null ? (input.whatsappEnabled ? 1 : 0) : row.whatsapp_enabled
    ]
  );
  return getMarketingLeadsWebhookConfigForUi(true);
}

export async function assertWebhookEnabled(): Promise<WebhookConfigRow> {
  const row = await readConfigRow();
  if (!row || !row.enabled) throw new Error('Webhooks de leads deshabilitados');
  return row;
}

export function verifyInboundSecret(row: WebhookConfigRow, reqSecret: string | undefined): boolean {
  if (!reqSecret?.trim()) return false;
  const a = Buffer.from(reqSecret.trim());
  const b = Buffer.from(row.webhook_secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function extractInboundSecret(headers: Record<string, unknown>, query: Record<string, unknown>): string {
  const auth = String(headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(headers['x-lupohub-webhook-secret'] || headers['x-webhook-secret'] || query.secret || '');
}

function normalizePhone(v: string): string {
  return v.replace(/[^\d+]/g, '').trim();
}

function pickFieldData(fields: Array<{ name?: string; values?: string[] }>, names: string[]): string {
  for (const n of names) {
    const hit = fields.find((f) => String(f.name || '').toLowerCase() === n.toLowerCase());
    const val = hit?.values?.[0]?.trim();
    if (val) return val;
  }
  return '';
}

export async function ingestGenericLeadWebhook(
  body: any,
  headers: Record<string, unknown>,
  query: Record<string, unknown>
): Promise<{ lead: MarketingLeadRow; created: boolean; duplicate?: boolean }> {
  const row = await assertWebhookEnabled();
  const secret = extractInboundSecret(headers, query);
  if (!verifyInboundSecret(row, secret)) throw Object.assign(new Error('Secreto de webhook inválido'), { status: 401 });

  const name =
    String(body?.name || body?.full_name || body?.fullName || body?.nombre || '').trim() ||
    pickFieldData(body?.field_data || body?.fieldData || [], ['full_name', 'nombre', 'name', 'first_name']);
  if (!name) throw Object.assign(new Error('Nombre requerido'), { status: 400 });

  const rawSource = String(body?.source || body?.origen || 'WHATSAPP').toUpperCase();
  const source: LeadSource = isLeadSource(rawSource) ? rawSource : 'WHATSAPP';

  const phone = normalizePhone(
    String(body?.phone || body?.telefono || body?.phone_number || body?.whatsapp || '')
  ) || undefined;
  const email = String(body?.email || body?.correo || '').trim() || undefined;

  const externalId = String(body?.externalId || body?.external_id || body?.id || '').trim() || undefined;
  const externalProvider = String(body?.externalProvider || body?.external_provider || 'generic').trim();

  return createMarketingLeadFromWebhook({
    name,
    phone,
    email,
    source,
    campaignId: body?.campaignId || body?.campaign_id,
    campaignName: body?.campaignName || body?.campaign_name,
    notes: body?.notes || body?.message || body?.mensaje,
    externalId,
    externalProvider
  });
}

function verifyMetaSignature(appSecret: string | null, rawBody: Buffer | string, signatureHeader: string): boolean {
  if (!appSecret?.trim() || !signatureHeader?.startsWith('sha256=')) return true;
  const expected = crypto.createHmac('sha256', appSecret.trim()).update(rawBody).digest('hex');
  const received = signatureHeader.slice(7);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  } catch {
    return false;
  }
}

async function fetchMetaLeadgen(leadgenId: string): Promise<{
  name: string;
  phone?: string;
  email?: string;
  source: LeadSource;
  campaignId?: string;
  campaignName?: string;
  notes?: string;
}> {
  const cfg = await getMetaAdsConfig();
  if (!cfg?.accessToken) throw new Error('Meta Ads no configurado (token requerido para leads)');

  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(leadgenId)}`;
  const res = await axios.get(url, {
    params: { fields: 'created_time,id,field_data,campaign_id,campaign_name,form_id,platform,ad_id,adset_id' },
    headers: { Authorization: `Bearer ${cfg.accessToken}` },
    validateStatus: () => true
  });
  if (res.status >= 400) {
    throw new Error(res.data?.error?.message || `Meta API error ${res.status}`);
  }

  const data = res.data || {};
  type MetaFieldRow = { name?: string; values?: string[] };
  const fields: MetaFieldRow[] = Array.isArray(data.field_data) ? data.field_data : [];
  const name =
    pickFieldData(fields, ['full_name', 'nombre_completo', 'nombre', 'name', 'first_name', 'nombres']) ||
    'Lead Meta';
  const phone = pickFieldData(fields, ['phone_number', 'telefono', 'phone', 'celular', 'whatsapp']) || undefined;
  const email = pickFieldData(fields, ['email', 'correo', 'mail']) || undefined;

  const platform = String(data.platform || 'fb').toLowerCase();
  const source: LeadSource = platform === 'ig' || platform === 'instagram' ? 'INSTAGRAM' : 'FACEBOOK_ADS';

  const extraFields = fields
    .filter((f) => f?.name && f?.values?.[0])
    .map((f) => `${f.name}: ${f.values![0]}`)
    .join('\n');

  return {
    name,
    phone: phone ? normalizePhone(phone) : undefined,
    email,
    source,
    campaignId: data.campaign_id ? String(data.campaign_id) : undefined,
    campaignName: data.campaign_name ? String(data.campaign_name) : undefined,
    notes: [
      extraFields,
      data.form_id ? `Form ID: ${data.form_id}` : '',
      data.ad_id ? `Ad ID: ${data.ad_id}` : '',
      data.adset_id ? `Ad set ID: ${data.adset_id}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  };
}

export async function handleMetaLeadWebhook(
  body: any,
  query: Record<string, unknown>,
  rawBody: Buffer | string,
  signatureHeader: string
): Promise<{ challenge?: string; processed: number; results: Array<{ ok: boolean; message: string }> }> {
  const row = await readConfigRow();
  if (!row) throw new Error('Webhook no configurado');

  const mode = String(query['hub.mode'] || '');
  const token = String(query['hub.verify_token'] || '');
  const challenge = String(query['hub.challenge'] || '');

  if (mode === 'subscribe') {
    if (token !== row.meta_verify_token) {
      throw Object.assign(new Error('Verify token inválido'), { status: 403 });
    }
    return { challenge, processed: 0, results: [] };
  }

  if (!row.enabled) return { processed: 0, results: [{ ok: false, message: 'Webhooks deshabilitados' }] };
  if (!verifyMetaSignature(row.meta_app_secret, rawBody, signatureHeader)) {
    throw Object.assign(new Error('Firma Meta inválida'), { status: 401 });
  }

  const results: Array<{ ok: boolean; message: string }> = [];
  let processed = 0;
  const entries = Array.isArray(body?.entry) ? body.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const field = String(change?.field || '');
      const value = change?.value || {};

      if (field === 'leadgen' && row.meta_leads_enabled) {
        const leadgenId = String(value.leadgen_id || '');
        if (!leadgenId) continue;
        try {
          const parsed = await fetchMetaLeadgen(leadgenId);
          const { created } = await createMarketingLeadFromWebhook({
            ...parsed,
            externalId: leadgenId,
            externalProvider: 'meta_leadgen'
          });
          processed += 1;
          results.push({ ok: true, message: created ? `Lead Meta creado (${leadgenId})` : `Lead Meta duplicado (${leadgenId})` });
        } catch (e: any) {
          results.push({ ok: false, message: e?.message || 'Error procesando leadgen' });
        }
        continue;
      }

      if (field === 'messages' && row.whatsapp_enabled) {
        const messages = Array.isArray(value.messages) ? value.messages : [];
        const contacts = Array.isArray(value.contacts) ? value.contacts : [];
        for (const msg of messages) {
          if (String(msg.type) !== 'text' && String(msg.type) !== 'button') continue;
          const from = String(msg.from || '');
          if (!from) continue;
          const contact = contacts.find((c: any) => String(c.wa_id) === from);
          const name = contact?.profile?.name || `WhatsApp ${from}`;
          const text =
            msg.text?.body || msg.button?.text || msg.button?.payload || '(mensaje sin texto)';
          try {
            const { created } = await createMarketingLeadFromWebhook({
              name,
              phone: normalizePhone(from),
              source: 'WHATSAPP',
              notes: text,
              externalId: from,
              externalProvider: 'whatsapp'
            });
            processed += 1;
            results.push({
              ok: true,
              message: created ? `Lead WhatsApp creado (${from})` : `WhatsApp actualizado (${from})`
            });
          } catch (e: any) {
            results.push({ ok: false, message: e?.message || 'Error WhatsApp' });
          }
        }
      }
    }
  }

  return { processed, results };
}
