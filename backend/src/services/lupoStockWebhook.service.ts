import { v4 as uuidv4 } from 'uuid';
import { execute, get, query } from '../database/db';
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

const ML_TO_SHOP_BATCH_SIZE = 80;
const ML_TO_SHOP_BATCH_DELAY_MS = 250;

export interface SyncMlLinkedStockToLupoShopResult {
  ok: boolean;
  message?: string;
  variantCount: number;
  batchesTotal: number;
  batchesOk: number;
  batchesFailed: number;
  errors: { batchIndex: number; status?: number; error?: string }[];
}

/**
 * Envía a la tienda online (webhook Lupo) el stock actual de LupoHub para todas las variantes
 * vinculadas a Mercado Libre (mismo criterio que en inventario: producto ML, ítems/variación o publicación ML).
 * La cantidad enviada es el stock del depósito en LupoHub, no la lectura en vivo desde la API de ML.
 */
export async function syncAllMercadoLibreLinkedStockToLupoShop(): Promise<SyncMlLinkedStockToLupoShopResult> {
  const cfg = await resolveRuntimeWebhookConfig();
  if (!cfg.enabled) {
    return {
      ok: false,
      message:
        'Webhook de tienda Lupo deshabilitado o faltan URL, API key o secret. Activá y guardá la configuración en Integraciones.',
      variantCount: 0,
      batchesTotal: 0,
      batchesOk: 0,
      batchesFailed: 0,
      errors: []
    };
  }

  const rows = await query(
    `SELECT pv.id AS variant_id,
            pv.sku AS variant_sku,
            pv.tienda_nube_variant_id AS tienda_nube_variant_id,
            p.id AS product_id,
            p.sku AS product_sku,
            p.tienda_nube_id AS external_tn_id,
            p.mercado_libre_id AS external_ml_id,
            COALESCE(s.stock, 0) AS stock
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     LEFT JOIN stocks s ON s.variant_id = pv.id
     WHERE
       (p.mercado_libre_id IS NOT NULL AND TRIM(p.mercado_libre_id) != '')
       OR (pv.mercado_libre_item_id IS NOT NULL AND TRIM(pv.mercado_libre_item_id) != '')
       OR (pv.mercado_libre_variant_id IS NOT NULL AND TRIM(pv.mercado_libre_variant_id) != '')
       OR EXISTS (
         SELECT 1 FROM variant_publications vp
         WHERE vp.variant_id = pv.id AND vp.platform = 'mercadolibre'
       )`,
    []
  );

  const updates: LupoStockWebhookUpdate[] = (rows as any[]).map((row) => {
    const variantSku = row.variant_sku != null && String(row.variant_sku).trim() !== '' ? String(row.variant_sku).trim() : '';
    const productSku = row.product_sku != null && String(row.product_sku).trim() !== '' ? String(row.product_sku).trim() : '';
    const tnProd = row.external_tn_id != null && String(row.external_tn_id).trim() !== '' ? String(row.external_tn_id).trim() : '';
    const tnVar =
      row.tienda_nube_variant_id != null && String(row.tienda_nube_variant_id).trim() !== ''
        ? String(row.tienda_nube_variant_id).trim()
        : '';
    return {
      sku: variantSku || productSku || undefined,
      codigo_articulo: productSku || undefined,
      id: tnProd || undefined,
      external_tn_id: tnProd || undefined,
      tienda_nube_product_id: tnProd || undefined,
      tienda_nube_variant_id: tnVar || undefined,
      external_ml_id: row.external_ml_id || undefined,
      variant_id: row.variant_id || undefined,
      variant_sku: row.variant_sku || undefined,
      stock_quantity: normalizeStockQuantity(row.stock)
    };
  });

  if (updates.length === 0) {
    return {
      ok: true,
      message: 'No hay variantes vinculadas a Mercado Libre.',
      variantCount: 0,
      batchesTotal: 0,
      batchesOk: 0,
      batchesFailed: 0,
      errors: []
    };
  }

  const errors: { batchIndex: number; status?: number; error?: string }[] = [];
  let batchesOk = 0;
  let batchesFailed = 0;
  const batchesTotal = Math.ceil(updates.length / ML_TO_SHOP_BATCH_SIZE);

  console.log(
    `[LupoWebhook] sincronización masiva ML→tienda: ${updates.length} variantes, ${batchesTotal} lote(s)`
  );

  for (let i = 0; i < updates.length; i += ML_TO_SHOP_BATCH_SIZE) {
    const batch = updates.slice(i, i + ML_TO_SHOP_BATCH_SIZE);
    const batchIndex = Math.floor(i / ML_TO_SHOP_BATCH_SIZE);
    const result = await sendStockWebhookPayload({ updates: batch }, uuidv4());
    if (result.ok) {
      batchesOk++;
      for (const u of batch) {
        const vid = u.variant_id as string | undefined;
        if (!vid) continue;
        try {
          await execute(
            `INSERT INTO variant_luposhop_stock (variant_id, stock) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE stock = VALUES(stock), updated_at = CURRENT_TIMESTAMP`,
            [vid, u.stock_quantity]
          );
        } catch (e: any) {
          console.warn(`[LupoWebhook bulk] snapshot tienda variantId=${vid}:`, e?.message || e);
        }
      }
    } else {
      batchesFailed++;
      errors.push({
        batchIndex,
        status: result.status,
        error: result.error ?? (result.status != null ? String(result.status) : 'unknown')
      });
    }
    if (i + ML_TO_SHOP_BATCH_SIZE < updates.length && ML_TO_SHOP_BATCH_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, ML_TO_SHOP_BATCH_DELAY_MS));
    }
  }

  const ok = batchesFailed === 0;
  return {
    ok,
    message: ok ? undefined : 'Al menos un lote falló al enviar a la tienda. Revisá logs y la respuesta del servidor de la tienda.',
    variantCount: updates.length,
    batchesTotal,
    batchesOk,
    batchesFailed,
    errors
  };
}

export async function sendStockWebhookPayload(
  payload: LupoStockWebhookPayload,
  webhookId?: string,
  options?: { timeoutMs?: number; maxRetries5xx?: number; backoffBaseMs?: number }
): Promise<LupoStockWebhookResult> {
  const baseConfig = await resolveRuntimeWebhookConfig();
  const config = options
    ? {
        ...baseConfig,
        timeoutMs: options.timeoutMs != null ? Math.max(1000, Math.floor(options.timeoutMs)) : baseConfig.timeoutMs,
        maxRetries5xx: options.maxRetries5xx != null ? Math.max(0, Math.floor(options.maxRetries5xx)) : baseConfig.maxRetries5xx,
        backoffBaseMs: options.backoffBaseMs != null ? Math.max(200, Math.floor(options.backoffBaseMs)) : baseConfig.backoffBaseMs
      }
    : baseConfig;
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
            pv.tienda_nube_variant_id AS tienda_nube_variant_id,
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
  const variantSku =
    row.variant_sku != null && String(row.variant_sku).trim() !== '' ? String(row.variant_sku).trim() : '';
  const productSku =
    row.product_sku != null && String(row.product_sku).trim() !== '' ? String(row.product_sku).trim() : '';
  const tnProd =
    row.external_tn_id != null && String(row.external_tn_id).trim() !== '' ? String(row.external_tn_id).trim() : '';
  const tnVar =
    row.tienda_nube_variant_id != null && String(row.tienda_nube_variant_id).trim() !== ''
      ? String(row.tienda_nube_variant_id).trim()
      : '';
  return {
    sku: variantSku || productSku || undefined,
    codigo_articulo: productSku || undefined,
    id: tnProd || undefined,
    external_tn_id: tnProd || undefined,
    tienda_nube_product_id: tnProd || undefined,
    tienda_nube_variant_id: tnVar || undefined,
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
    if (result.ok) {
      try {
        await execute(
          `INSERT INTO variant_luposhop_stock (variant_id, stock) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE stock = VALUES(stock), updated_at = CURRENT_TIMESTAMP`,
          [variantId, update.stock_quantity]
        );
      } catch (e: any) {
        console.warn(`[LupoWebhook] no se pudo guardar snapshot tienda online variantId=${variantId}:`, e?.message || e);
      }
    } else {
      console.warn(
        `[LupoWebhook] envio fallido webhookId=${result.webhookId} status=${result.status ?? 'n/a'} error=${result.error ?? 'n/a'}`
      );
    }
  } catch (error: any) {
    console.error(`[LupoWebhook] error encolando variantId=${variantId}:`, error?.message || error);
  }
}
