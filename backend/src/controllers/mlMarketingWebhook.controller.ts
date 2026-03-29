import { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { execute, get } from '../database/db';

const N8N_FORWARD_TIMEOUT_MS = Math.min(60000, Math.max(3000, parseInt(process.env.N8N_WEBHOOK_TIMEOUT_MS || '15000', 10)));

type MlMarketingRow = {
  id: number;
  inbound_secret: string;
  n8n_forward_url: string | null;
  forward_ml_notifications: number;
};

export async function ensureMlMarketingConfigRow(): Promise<MlMarketingRow> {
  let row = (await get(`SELECT * FROM ml_marketing_config WHERE id = 1`)) as MlMarketingRow | undefined;
  if (!row) {
    const secret = crypto.randomBytes(32).toString('hex');
    await execute(`INSERT INTO ml_marketing_config (id, inbound_secret) VALUES (1, ?)`, [secret]);
    row = (await get(`SELECT * FROM ml_marketing_config WHERE id = 1`)) as MlMarketingRow;
  }
  if (!row) throw new Error('ml_marketing_config no disponible');
  return row;
}

function publicBackendOrigin(req: Request): string {
  const envBase = (process.env.BACKEND_URL || process.env.API_URL || '').replace(/\/$/, '');
  if (envBase) return envBase;
  const proto = ((req.headers['x-forwarded-proto'] as string) || req.protocol || 'https').split(',')[0].trim();
  const host = ((req.headers['x-forwarded-host'] as string) || req.get('host') || 'localhost:3001').split(',')[0].trim();
  return `${proto}://${host}`.replace(/\/$/, '');
}

function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

async function postToN8n(url: string, payload: unknown): Promise<{ ok: boolean; status?: number }> {
  const res = await axios.post(url, payload, {
    timeout: N8N_FORWARD_TIMEOUT_MS,
    validateStatus: () => true,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'LupoHub-ML-Marketing/1.0' },
  });
  const ok = res.status >= 200 && res.status < 300;
  if (!ok) {
    console.warn('[ML Marketing n8n] respuesta no OK:', res.status, typeof res.data === 'string' ? res.data.slice(0, 200) : res.data);
  }
  return { ok, status: res.status };
}

/** Reenvía el payload del webhook oficial de ML a n8n (si está habilitado en BD). No lanza: para usar en fire-and-forget. */
export async function forwardMercadoLibreNotificationToN8n(req: Request): Promise<void> {
  try {
    const row = await get(
      `SELECT n8n_forward_url, forward_ml_notifications FROM ml_marketing_config WHERE id = 1`
    ) as { n8n_forward_url: string | null; forward_ml_notifications: number } | undefined;
    if (!row?.n8n_forward_url?.trim() || !row.forward_ml_notifications) return;

    const url = row.n8n_forward_url.trim();
    const payload = {
      source: 'lupohub_mercadolibre_webhook',
      receivedAt: new Date().toISOString(),
      topic: (req.body?.topic ?? req.query?.topic ?? '') as string,
      resource: (req.body?.resource ?? req.query?.resource ?? '') as string,
      user_id: (req.body?.user_id ?? req.query?.user_id ?? '') as string,
      query: req.query && typeof req.query === 'object' ? req.query : {},
      body: req.body && typeof req.body === 'object' ? req.body : {},
    };
    await postToN8n(url, payload);
  } catch (e: any) {
    console.error('[ML Marketing n8n] forward ML:', e?.message || e);
  }
}

export const getMLMarketingWebhookConfig = async (req: Request, res: Response) => {
  try {
    const row = await ensureMlMarketingConfigRow();
    const origin = publicBackendOrigin(req);
    const inboundUrl = `${origin}/api/integrations/mercadolibre/marketing/inbound/${row.inbound_secret}`;
    res.json({
      inboundUrl,
      n8nForwardUrl: row.n8n_forward_url || '',
      forwardMlNotifications: !!row.forward_ml_notifications,
      hint: 'Definí BACKEND_URL o API_URL en el servidor con la URL pública (HTTPS) para que el enlace del webhook sea correcto.',
    });
  } catch (error: any) {
    console.error('[ML Marketing config GET]', error);
    res.status(500).json({ message: error?.message || 'Error leyendo configuración' });
  }
};

export const putMLMarketingWebhookConfig = async (req: Request, res: Response) => {
  try {
    await ensureMlMarketingConfigRow();
    const n8nForwardUrl =
      req.body?.n8nForwardUrl !== undefined && req.body?.n8nForwardUrl !== null
        ? String(req.body.n8nForwardUrl).trim()
        : undefined;
    const forwardMlNotifications =
      typeof req.body?.forwardMlNotifications === 'boolean' ? req.body.forwardMlNotifications : undefined;
    const regenerateSecret = req.body?.regenerateSecret === true;

    if (regenerateSecret) {
      const newSecret = crypto.randomBytes(32).toString('hex');
      await execute(
        `UPDATE ml_marketing_config SET inbound_secret = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
        [newSecret]
      );
    }

    if (n8nForwardUrl !== undefined) {
      const v = n8nForwardUrl.length === 0 ? null : n8nForwardUrl;
      if (v && !/^https?:\/\//i.test(v)) {
        return res.status(400).json({ message: 'n8nForwardUrl debe ser una URL http o https' });
      }
      await execute(`UPDATE ml_marketing_config SET n8n_forward_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`, [
        v,
      ]);
    }

    if (forwardMlNotifications !== undefined) {
      await execute(
        `UPDATE ml_marketing_config SET forward_ml_notifications = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
        [forwardMlNotifications ? 1 : 0]
      );
    }

    const row = await ensureMlMarketingConfigRow();
    const origin = publicBackendOrigin(req);
    const inboundUrl = `${origin}/api/integrations/mercadolibre/marketing/inbound/${row.inbound_secret}`;
    res.json({
      success: true,
      inboundUrl,
      n8nForwardUrl: row.n8n_forward_url || '',
      forwardMlNotifications: !!row.forward_ml_notifications,
    });
  } catch (error: any) {
    console.error('[ML Marketing config PUT]', error);
    res.status(500).json({ message: error?.message || 'Error guardando configuración' });
  }
};

/** Webhook público: POST con secreto en la ruta; reenvía el cuerpo a n8n. */
export const handleMarketingInboundWebhook = async (req: Request, res: Response) => {
  try {
    const secretParam = (req.params?.secret ?? '').toString();
    const row = await ensureMlMarketingConfigRow();
    if (!secretParam || !safeEqual(secretParam, row.inbound_secret)) {
      return res.status(401).json({ error: 'secreto inválido' });
    }

    const url = (row.n8n_forward_url || '').trim();
    if (!url) {
      return res.status(200).json({
        received: true,
        forwarded: false,
        message: 'Configurá la URL de n8n en Lupo Hub (Marketing ML) para reenviar payloads.',
      });
    }

    const payload = {
      source: 'lupohub_inbound_webhook',
      receivedAt: new Date().toISOString(),
      method: req.method,
      path: req.path,
      query: req.query && typeof req.query === 'object' ? req.query : {},
      body: req.body,
    };

    try {
      const r = await postToN8n(url, payload);
      return res.status(200).json({ received: true, forwarded: r.ok, n8nStatus: r.status });
    } catch (e: any) {
      console.error('[ML Marketing inbound→n8n]', e?.message || e);
      return res.status(200).json({
        received: true,
        forwarded: false,
        error: 'No se pudo contactar a n8n',
        detail: process.env.NODE_ENV === 'development' ? e?.message : undefined,
      });
    }
  } catch (error: any) {
    console.error('[ML Marketing inbound]', error);
    res.status(500).json({ error: error?.message || 'Error interno' });
  }
};
