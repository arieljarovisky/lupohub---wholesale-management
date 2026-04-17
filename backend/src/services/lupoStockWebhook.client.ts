import axios from 'axios';
import { randomUUID } from 'crypto';
import { buildSignedWebhookPayload } from '../utils/webhookHmac';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface LupoStockWebhookUpdate {
  /** SKU de la variante (recomendado para stock por talle/color); si no hay, SKU del artículo. */
  sku?: string;
  /** SKU del producto / artículo (`products.sku`). */
  codigo_articulo?: string;
  /**
   * ID de producto en Tienda Nube (mismo string que en TN), solo si hay vínculo TN.
   * No se envía el UUID interno de producto de LupoHub; usar `variant_id` para correlación interna.
   */
  id?: string;
  /** ID producto Tienda Nube (recomendado; mismo string que `id` cuando ambos vienen de TN). */
  external_tn_id?: string;
  /** ID producto en Tienda Nube. */
  tienda_nube_product_id?: string;
  /** ID variante en Tienda Nube. */
  tienda_nube_variant_id?: string;
  external_ml_id?: string;
  variant_id?: string;
  variant_sku?: string;
  stock_quantity: number;
}

export interface LupoStockWebhookPayload {
  updates: LupoStockWebhookUpdate[];
}

export interface LupoStockWebhookConfig {
  enabled: boolean;
  endpointUrl: string;
  apiKey: string;
  secret: string;
  timeoutMs: number;
  maxRetries5xx: number;
  backoffBaseMs: number;
}

export interface LupoStockWebhookConfigInput {
  enabled?: boolean;
  endpointUrl?: string;
  apiKey?: string;
  secret?: string;
  timeoutMs?: number;
  maxRetries5xx?: number;
  backoffBaseMs?: number;
}

export interface LupoStockWebhookResult {
  ok: boolean;
  duplicate?: boolean;
  status?: number;
  webhookId: string;
  attempt: number;
  responseBody?: unknown;
  error?: string;
}

export interface LupoStockWebhookEvent {
  payload: LupoStockWebhookPayload;
  webhookId: string;
}

export type WebhookTransport = (args: {
  url: string;
  body: LupoStockWebhookPayload;
  headers: Record<string, string>;
  timeoutMs: number;
}) => Promise<{ status: number; data: any }>;

interface LupoStockWebhookClientDeps {
  sleepFn?: (ms: number) => Promise<void>;
  nowSecFn?: () => number;
  webhookIdFn?: () => string;
  transport?: WebhookTransport;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.floor(raw);
}

export function buildLupoStockWebhookConfig(input: LupoStockWebhookConfigInput): LupoStockWebhookConfig {
  const endpointUrl = (input.endpointUrl || '').trim();
  const apiKey = (input.apiKey || '').trim();
  const secret = (input.secret || '').trim();
  const enabled = !!input.enabled && !!endpointUrl && !!apiKey && !!secret;
  return {
    enabled,
    endpointUrl,
    apiKey,
    secret,
    timeoutMs: Math.max(1000, Math.floor(Number(input.timeoutMs ?? 10000) || 10000)),
    maxRetries5xx: Math.max(0, Math.floor(Number(input.maxRetries5xx ?? 4) || 4)),
    backoffBaseMs: Math.max(200, Math.floor(Number(input.backoffBaseMs ?? 1000) || 1000))
  };
}

export function getLupoStockWebhookConfigFromEnv(): LupoStockWebhookConfig {
  const enabledByFlag = !['0', 'false', 'off'].includes(
    (process.env.HUB_STOCK_WEBHOOK_ENABLED || '1').toLowerCase()
  );
  return buildLupoStockWebhookConfig({
    enabled: enabledByFlag,
    endpointUrl: process.env.HUB_STOCK_WEBHOOK_URL || '',
    apiKey: process.env.HUB_API_KEY || '',
    secret: process.env.HUB_WEBHOOK_SECRET || '',
    timeoutMs: Math.max(1000, envInt('HUB_STOCK_WEBHOOK_TIMEOUT_MS', 10000)),
    maxRetries5xx: Math.max(0, envInt('HUB_STOCK_WEBHOOK_MAX_RETRIES', 4)),
    backoffBaseMs: Math.max(200, envInt('HUB_STOCK_WEBHOOK_BACKOFF_BASE_MS', 1000))
  });
}

const defaultTransport: WebhookTransport = async ({ url, body, headers, timeoutMs }) => {
  const res = await axios.post(url, body, {
    headers,
    timeout: timeoutMs,
    validateStatus: () => true
  });
  return { status: res.status, data: res.data };
};

function sanitizeUpdate(update: LupoStockWebhookUpdate): Record<string, unknown> {
  return {
    sku: update.sku ?? null,
    codigo_articulo: update.codigo_articulo ?? null,
    id: update.id ?? null,
    external_tn_id: update.external_tn_id ?? null,
    tienda_nube_product_id: update.tienda_nube_product_id ?? null,
    tienda_nube_variant_id: update.tienda_nube_variant_id ?? null,
    external_ml_id: update.external_ml_id ?? null,
    variant_id: update.variant_id ?? null,
    variant_sku: update.variant_sku ?? null,
    stock_quantity: update.stock_quantity
  };
}

function validatePayload(payload: LupoStockWebhookPayload): string[] {
  const errors: string[] = [];
  if (!payload || !Array.isArray(payload.updates) || payload.updates.length === 0) {
    errors.push('payload.updates debe tener al menos un elemento');
    return errors;
  }
  payload.updates.forEach((u, index) => {
    const hasIdentity = !!(
      u.sku ||
      u.id ||
      u.external_tn_id ||
      u.external_ml_id ||
      u.tienda_nube_product_id ||
      u.tienda_nube_variant_id ||
      u.codigo_articulo ||
      u.variant_id
    );
    if (!hasIdentity) {
      errors.push(
        `updates[${index}] debe incluir al menos: sku, codigo_articulo, id, variant_id, external_tn_id, external_ml_id o ids de Tienda Nube`
      );
    }
    if (typeof u.stock_quantity !== 'number' || !Number.isFinite(u.stock_quantity) || u.stock_quantity < 0) {
      errors.push(`updates[${index}].stock_quantity debe ser número >= 0`);
    }
  });
  return errors;
}

export class LupoStockWebhookClient {
  private readonly config: LupoStockWebhookConfig;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly nowSecFn: () => number;
  private readonly webhookIdFn: () => string;
  private readonly transport: WebhookTransport;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(config: LupoStockWebhookConfig, deps?: LupoStockWebhookClientDeps) {
    this.config = config;
    this.sleepFn = deps?.sleepFn ?? sleep;
    this.nowSecFn = deps?.nowSecFn ?? (() => Math.floor(Date.now() / 1000));
    this.webhookIdFn = deps?.webhookIdFn ?? (() => randomUUID());
    this.transport = deps?.transport ?? defaultTransport;
    this.logger = deps?.logger ?? console;
  }

  newWebhookId(): string {
    return this.webhookIdFn();
  }

  enqueue(payload: LupoStockWebhookPayload, providedWebhookId?: string): Promise<LupoStockWebhookResult> {
    const webhookId = providedWebhookId || this.newWebhookId();
    const event: LupoStockWebhookEvent = { payload, webhookId };
    const task = this.queue.then(() => this.sendWithRetry(event));
    this.queue = task.catch(() => undefined);
    return task;
  }

  async sendWithRetry(event: LupoStockWebhookEvent): Promise<LupoStockWebhookResult> {
    if (!this.config.enabled) {
      this.logger.log(`[LupoWebhook] disabled: webhookId=${event.webhookId}`);
      return { ok: false, webhookId: event.webhookId, attempt: 0, error: 'disabled' };
    }

    const payloadErrors = validatePayload(event.payload);
    if (payloadErrors.length > 0) {
      const msg = payloadErrors.join('; ');
      this.logger.warn(`[LupoWebhook] invalid payload: webhookId=${event.webhookId} error="${msg}"`);
      return { ok: false, webhookId: event.webhookId, attempt: 0, error: msg };
    }

    const maxAttempts = this.config.maxRetries5xx + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const timestampSec = String(this.nowSecFn());
      const signed = buildSignedWebhookPayload(this.config.secret, timestampSec, event.payload);
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-hub-api-key': this.config.apiKey,
        'x-hub-timestamp': timestampSec,
        'x-webhook-id': event.webhookId,
        'x-hub-signature': signed.signatureHeaderValue
      };

      try {
        const response = await this.transport({
          url: this.config.endpointUrl,
          body: event.payload,
          headers,
          timeoutMs: this.config.timeoutMs
        });
        const status = Number(response.status || 0);
        const data = response.data;
        this.logger.log(
          `[LupoWebhook] response webhookId=${event.webhookId} attempt=${attempt} status=${status} updates=${event.payload.updates.length}`
        );

        if (status === 200) {
          return {
            ok: true,
            duplicate: !!data?.duplicate,
            status,
            webhookId: event.webhookId,
            attempt,
            responseBody: data
          };
        }
        if ([400, 401, 409].includes(status)) {
          this.logger.warn(
            `[LupoWebhook] non-retriable webhookId=${event.webhookId} status=${status} sample=${JSON.stringify(sanitizeUpdate(event.payload.updates[0]))}`
          );
          return {
            ok: false,
            status,
            webhookId: event.webhookId,
            attempt,
            responseBody: data,
            error: `status_${status}`
          };
        }
        if (status >= 500 && attempt < maxAttempts) {
          const delay = this.config.backoffBaseMs * Math.pow(2, attempt - 1);
          this.logger.warn(
            `[LupoWebhook] retrying webhookId=${event.webhookId} attempt=${attempt} nextDelayMs=${delay}`
          );
          await this.sleepFn(delay);
          continue;
        }
        return {
          ok: false,
          status,
          webhookId: event.webhookId,
          attempt,
          responseBody: data,
          error: status >= 500 ? 'exhausted_retries' : `status_${status}`
        };
      } catch (error: any) {
        const code = error?.code || 'network_error';
        const message = error?.message || String(error);
        this.logger.error(`[LupoWebhook] network error webhookId=${event.webhookId} attempt=${attempt} code=${code} message=${message}`);
        if (attempt < maxAttempts) {
          const delay = this.config.backoffBaseMs * Math.pow(2, attempt - 1);
          await this.sleepFn(delay);
          continue;
        }
        return {
          ok: false,
          webhookId: event.webhookId,
          attempt,
          error: `${code}:${message}`
        };
      }
    }

    return { ok: false, webhookId: event.webhookId, attempt: this.config.maxRetries5xx + 1, error: 'unknown' };
  }
}

export const lupoStockWebhookClient = new LupoStockWebhookClient(getLupoStockWebhookConfigFromEnv());
