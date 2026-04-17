import { Request, Response } from 'express';
import {
  getLupoWebhookConfigForUi,
  saveLupoWebhookConfig,
  sendStockWebhookPayload,
  syncAllMercadoLibreLinkedStockToLupoShop
} from '../services/lupoStockWebhook.service';

function isAdmin(req: Request): boolean {
  const role = (req as any).user?.role;
  return role === 'ADMIN';
}

function unauthorized(res: Response): Response {
  return res.status(403).json({ message: 'Solo ADMIN puede configurar esta integración.' });
}

export const getLupoWebhookConfigEndpoint = async (req: Request, res: Response) => {
  if (!isAdmin(req)) return unauthorized(res);
  try {
    const config = await getLupoWebhookConfigForUi();
    res.json(config);
  } catch (error: any) {
    console.error('[LupoWebhook Config] Error consultando configuración:', error?.message || error);
    res.status(500).json({ message: 'Error obteniendo configuración de webhook.' });
  }
};

export const saveLupoWebhookConfigEndpoint = async (req: Request, res: Response) => {
  if (!isAdmin(req)) return unauthorized(res);
  try {
    const body = req.body || {};
    const config = await saveLupoWebhookConfig({
      enabled: !!body.enabled,
      webhookUrl: String(body.webhookUrl || ''),
      apiKey: String(body.apiKey || ''),
      webhookSecret: body.webhookSecret != null ? String(body.webhookSecret) : undefined,
      keepExistingApiKey: !!body.keepExistingApiKey,
      timeoutMs: Number(body.timeoutMs),
      maxRetries: Number(body.maxRetries),
      backoffBaseMs: Number(body.backoffBaseMs),
      keepExistingSecret: !!body.keepExistingSecret
    });
    res.json({ ok: true, config });
  } catch (error: any) {
    console.error('[LupoWebhook Config] Error guardando configuración:', error?.message || error);
    res.status(500).json({ message: 'Error guardando configuración de webhook.' });
  }
};

export const testLupoWebhookEndpoint = async (req: Request, res: Response) => {
  if (!isAdmin(req)) return unauthorized(res);
  try {
    const updates = Array.isArray(req.body?.updates)
      ? req.body.updates
      : [{ sku: 'BOXER-TEST-NEGRO-P', stock_quantity: 10 }];
    const providedWebhookId = req.body?.webhookId ? String(req.body.webhookId) : undefined;
    // En la prueba UI priorizamos respuesta rápida (sin cola de retries largos).
    const result = await sendStockWebhookPayload(
      { updates },
      providedWebhookId,
      { timeoutMs: 8000, maxRetries5xx: 0, backoffBaseMs: 500 }
    );
    const code = result.ok ? 200 : (result.status && [400, 401, 409].includes(result.status) ? result.status : 502);
    res.status(code).json(result);
  } catch (error: any) {
    console.error('[LupoWebhook Test] Error enviando prueba:', error?.message || error);
    res.status(500).json({ message: 'Error enviando webhook de prueba.' });
  }
};

/** Stock LupoHub de todas las variantes vinculadas a ML → webhook tienda online (lotes). */
export const syncLupoShopMlStockBulkEndpoint = async (req: Request, res: Response) => {
  if (!isAdmin(req)) return unauthorized(res);
  try {
    const result = await syncAllMercadoLibreLinkedStockToLupoShop();
    if (!result.ok && result.message?.includes('deshabilitado')) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error: any) {
    console.error('[LupoWebhook] sync masivo ML→tienda:', error?.message || error);
    res.status(500).json({ message: 'Error en sincronización masiva hacia la tienda.' });
  }
};
