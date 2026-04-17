import { execute, get } from '../database/db';
import {
  buildLupoStockWebhookConfig,
  getLupoStockWebhookConfigFromEnv,
  LupoStockWebhookClient,
  LupoStockWebhookConfig,
  LupoStockWebhookPayload,
  LupoStockWebhookResult,
  LupoStockWebhookUpdate
} from './lupoStockWebhook.client';

interface DbWebhookConfigRow {
  enabled: number;
  webhook_url: string | null;
  api_key: string | null;
  webhook_secret: string | null;
  timeout_ms: number | null;
  max_retries: number | null;
  backoff_base_ms: number | null;
}

export interface LupoWebhookConfigForUi {
  enabled: boolean;
  webhookUrl: string;
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  apiKeyMasked: string;
  webhookSecretMasked: string;
  timeoutMs: number;
  maxRetries: number;
  backoffBaseMs: number;
  source: 'db' | 'env';
}

let cachedClient: LupoStockWebhookClient | null = null;
let cachedClientConfigKey = '';

function normalizeStockQuantity(stock: number): number {
  const n = Number(stock);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

async function getDbWebhookConfig(): Promise<DbWebhookConfigRow | null> {
  try {
    const row = await get(
      `SELECT enabled, webhook_url, api_key, webhook_secret, timeout_ms, max_retries, backoff_base_ms
       FROM lupo_stock_webhook_config
       WHERE id = 1
       LIMIT 1`
    );
    if (!row) return null;
    return row as DbWebhookConfigRow;
  } catch {
    return null;
  }
}

async function resolveRuntimeWebhookConfig(): Promise<LupoStockWebhookConfig> {
  const envCfg = getLupoStockWebhookConfigFromEnv();
  const dbCfg = await getDbWebhookConfig();
  if (!dbCfg) return envCfg;

  const merged = buildLupoStockWebhookConfig({
    enabled: !!dbCfg.enabled,
    endpointUrl: (dbCfg.webhook_url || '').trim() || envCfg.endpointUrl,
    apiKey: (dbCfg.api_key || '').trim() || envCfg.apiKey,
    secret: (dbCfg.webhook_secret || '').trim() || envCfg.secret,
    timeoutMs: Number(dbCfg.timeout_ms ?? envCfg.timeoutMs),
    maxRetries5xx: Number(dbCfg.max_retries ?? envCfg.maxRetries5xx),
    backoffBaseMs: Number(dbCfg.backoff_base_ms ?? envCfg.backoffBaseMs)
  });
  return merged;
}

function getClientForConfig(config: LupoStockWebhookConfig): LupoStockWebhookClient {
  const key = JSON.stringify(config);
  if (!cachedClient || cachedClientConfigKey !== key) {
    cachedClient = new LupoStockWebhookClient(config);
    cachedClientConfigKey = key;
  }
  return cachedClient;
}

export async function sendStockWebhookPayload(
  payload: LupoStockWebhookPayload,
  webhookId?: string
): Promise<LupoStockWebhookResult> {
  const config = await resolveRuntimeWebhookConfig();
  const client = getClientForConfig(config);
  return client.enqueue(payload, webhookId);
}

export async function getLupoWebhookConfigForUi(): Promise<LupoWebhookConfigForUi> {
  const envCfg = getLupoStockWebhookConfigFromEnv();
  const dbCfg = await getDbWebhookConfig();
  if (!dbCfg) {
    return {
      enabled: envCfg.enabled,
      webhookUrl: envCfg.endpointUrl,
      hasApiKey: !!envCfg.apiKey,
      hasWebhookSecret: !!envCfg.secret,
      apiKeyMasked: maskSecret(envCfg.apiKey),
      webhookSecretMasked: maskSecret(envCfg.secret),
      timeoutMs: envCfg.timeoutMs,
      maxRetries: envCfg.maxRetries5xx,
      backoffBaseMs: envCfg.backoffBaseMs,
      source: 'env'
    };
  }

  const resolved = buildLupoStockWebhookConfig({
    enabled: !!dbCfg.enabled,
    endpointUrl: (dbCfg.webhook_url || '').trim() || envCfg.endpointUrl,
    apiKey: (dbCfg.api_key || '').trim() || envCfg.apiKey,
    secret: (dbCfg.webhook_secret || '').trim() || envCfg.secret,
    timeoutMs: Number(dbCfg.timeout_ms ?? envCfg.timeoutMs),
    maxRetries5xx: Number(dbCfg.max_retries ?? envCfg.maxRetries5xx),
    backoffBaseMs: Number(dbCfg.backoff_base_ms ?? envCfg.backoffBaseMs)
  });
  return {
    enabled: !!dbCfg.enabled,
    webhookUrl: (dbCfg.webhook_url || '').trim() || envCfg.endpointUrl,
    hasApiKey: !!((dbCfg.api_key || '').trim() || envCfg.apiKey),
    hasWebhookSecret: !!((dbCfg.webhook_secret || '').trim() || envCfg.secret),
    apiKeyMasked: maskSecret((dbCfg.api_key || '').trim() || envCfg.apiKey),
    webhookSecretMasked: maskSecret((dbCfg.webhook_secret || '').trim() || envCfg.secret),
    timeoutMs: resolved.timeoutMs,
    maxRetries: resolved.maxRetries5xx,
    backoffBaseMs: resolved.backoffBaseMs,
    source: 'db'
  };
}

export async function saveLupoWebhookConfig(input: {
  enabled: boolean;
  webhookUrl: string;
  apiKey: string;
  webhookSecret?: string;
  keepExistingApiKey: boolean;
  timeoutMs: number;
  maxRetries: number;
  backoffBaseMs: number;
  keepExistingSecret: boolean;
}): Promise<LupoWebhookConfigForUi> {
  const current = await getDbWebhookConfig();
  const existingApiKey = (current?.api_key || '').trim();
  const existingSecret = (current?.webhook_secret || '').trim();
  const apiKeyToSave = input.keepExistingApiKey ? existingApiKey : input.apiKey.trim();
  const secretToSave = input.keepExistingSecret ? existingSecret : (input.webhookSecret || '').trim();
  await execute(
    `INSERT INTO lupo_stock_webhook_config
       (id, enabled, webhook_url, api_key, webhook_secret, timeout_ms, max_retries, backoff_base_ms)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       enabled = VALUES(enabled),
       webhook_url = VALUES(webhook_url),
       api_key = VALUES(api_key),
       webhook_secret = VALUES(webhook_secret),
       timeout_ms = VALUES(timeout_ms),
       max_retries = VALUES(max_retries),
       backoff_base_ms = VALUES(backoff_base_ms),
       updated_at = CURRENT_TIMESTAMP`,
    [
      input.enabled ? 1 : 0,
      input.webhookUrl.trim(),
      apiKeyToSave,
      secretToSave,
      Math.max(1000, Math.floor(Number(input.timeoutMs) || 10000)),
      Math.max(0, Math.floor(Number(input.maxRetries) || 4)),
      Math.max(200, Math.floor(Number(input.backoffBaseMs) || 1000))
    ]
  );
  return getLupoWebhookConfigForUi();
}

export async function buildStockWebhookUpdateByVariantId(
  variantId: string,
  newStock: number
): Promise<LupoStockWebhookUpdate | null> {
  const row = await get(
    `SELECT pv.id AS variant_id,
            pv.sku AS variant_sku,
            p.id AS product_id,
            p.sku AS product_sku,
            p.tienda_nube_id AS external_tn_id,
            p.mercado_libre_id AS external_ml_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     WHERE pv.id = ?
     LIMIT 1`,
    [variantId]
  );
  if (!row) return null;
  return {
    sku: row.product_sku || row.variant_sku || undefined,
    id: row.product_id || undefined,
    external_tn_id: row.external_tn_id || undefined,
    external_ml_id: row.external_ml_id || undefined,
    variant_id: row.variant_id || undefined,
    variant_sku: row.variant_sku || undefined,
    stock_quantity: normalizeStockQuantity(newStock)
  };
}

export async function enqueueStockWebhookForVariant(variantId: string, newStock: number): Promise<void> {
  try {
    const update = await buildStockWebhookUpdateByVariantId(variantId, newStock);
    if (!update) {
      console.warn(`[LupoWebhook] variante no encontrada: variantId=${variantId}`);
      return;
    }
    const result = await sendStockWebhookPayload({ updates: [update] });
    if (!result.ok) {
      console.warn(
        `[LupoWebhook] envio fallido webhookId=${result.webhookId} status=${result.status ?? 'n/a'} error=${result.error ?? 'n/a'}`
      );
    }
  } catch (error: any) {
    console.error(`[LupoWebhook] error encolando variantId=${variantId}:`, error?.message || error);
  }
}
