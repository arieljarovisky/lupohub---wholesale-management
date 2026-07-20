import { Request, Response } from 'express';

/**
 * Stubs de LupoShop webhook: la integración se removió del backend pero el frontend
 * aún consulta estos endpoints. Devolvemos config deshabilitada para evitar 404
 * y el falso "offline/demo mode" en consola.
 */
export const getLupoWebhookConfigEndpoint = async (_req: Request, res: Response) => {
  res.json({
    enabled: false,
    webhookUrl: '',
    hasApiKey: false,
    hasWebhookSecret: false,
    apiKeyMasked: '',
    webhookSecretMasked: '',
    timeoutMs: 10000,
    maxRetries: 4,
    backoffBaseMs: 1000,
    source: 'env',
    removed: true,
    message: 'La integración LupoShop webhook fue deshabilitada en el servidor.',
  });
};

export const saveLupoWebhookConfigEndpoint = async (_req: Request, res: Response) => {
  res.status(410).json({
    ok: false,
    message: 'La integración LupoShop webhook ya no está disponible en este servidor.',
    config: null,
  });
};

export const testLupoWebhookEndpoint = async (_req: Request, res: Response) => {
  res.status(410).json({
    ok: false,
    message: 'La integración LupoShop webhook ya no está disponible en este servidor.',
  });
};

export const syncLupoShopMlStockToShopEndpoint = async (_req: Request, res: Response) => {
  res.status(410).json({
    ok: false,
    variantCount: 0,
    batchesTotal: 0,
    batchesOk: 0,
    batchesFailed: 0,
    errors: ['La integración LupoShop webhook ya no está disponible en este servidor.'],
    message: 'Integración LupoShop removida',
  });
};
