import { Request, Response } from 'express';
import {
  getMarketingLeadsWebhookConfigForUi,
  handleMetaLeadWebhook,
  ingestGenericLeadWebhook,
  saveMarketingLeadsWebhookConfig
} from '../services/marketingLeadsWebhook.service';

function isAdmin(req: Request): boolean {
  return (req as any).user?.role === 'ADMIN';
}

export const getLeadsWebhookConfig = async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores' });
  try {
    const config = await getMarketingLeadsWebhookConfigForUi(true);
    res.json(config);
  } catch (error: any) {
    console.error('getLeadsWebhookConfig:', error);
    res.status(500).json({ message: error?.message || 'Error obteniendo configuración' });
  }
};

export const saveLeadsWebhookConfig = async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores' });
  try {
    const body = req.body || {};
    const config = await saveMarketingLeadsWebhookConfig({
      enabled: body.enabled,
      webhookSecret: body.webhookSecret,
      regenerateWebhookSecret: !!body.regenerateWebhookSecret,
      metaVerifyToken: body.metaVerifyToken,
      metaAppSecret: body.metaAppSecret,
      keepExistingMetaAppSecret: !!body.keepExistingMetaAppSecret,
      clearMetaAppSecret: !!body.clearMetaAppSecret,
      metaLeadsEnabled: body.metaLeadsEnabled,
      whatsappEnabled: body.whatsappEnabled
    });
    res.json({ ok: true, config });
  } catch (error: any) {
    console.error('saveLeadsWebhookConfig:', error);
    res.status(500).json({ message: error?.message || 'Error guardando configuración' });
  }
};

export const inboundLeadWebhook = async (req: Request, res: Response) => {
  try {
    const result = await ingestGenericLeadWebhook(req.body, req.headers as any, req.query as any);
    res.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      lead: result.lead
    });
  } catch (error: any) {
    const status = error?.status || 500;
    console.error('inboundLeadWebhook:', error?.message || error);
    res.status(status).json({ message: error?.message || 'Error procesando webhook' });
  }
};

export const metaLeadWebhook = async (req: Request, res: Response) => {
  try {
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (req.method === 'POST' && !rawBody?.length) {
      console.warn('metaLeadWebhook: POST sin rawBody — la firma de Meta puede fallar');
    }
    const result = await handleMetaLeadWebhook(
      req.body,
      req.query as any,
      rawBody || Buffer.from(JSON.stringify(req.body || {}), 'utf8'),
      String(req.headers['x-hub-signature-256'] || '')
    );

    if (result.challenge != null) {
      return res.status(200).send(result.challenge);
    }

    res.status(200).json({ received: true, processed: result.processed, results: result.results });
  } catch (error: any) {
    const status = error?.status || 500;
    console.error('metaLeadWebhook:', error?.message || error);
    res.status(status).json({ message: error?.message || 'Error webhook Meta' });
  }
};
