import { Request, Response } from 'express';
import {
  disconnectGoogleAds,
  disconnectMetaAds,
  getGoogleAdsConfigForUi,
  getMetaAdsConfigForUi,
  saveGoogleAdsConfig,
  saveMetaAdsConfig
} from '../services/adsIntegrations.service';
import { fetchMetaAdSets, fetchMetaAdsCampaigns, fetchMetaAdsForAdSet } from '../services/metaAds.service';
import { fetchGoogleAdsCampaigns } from '../services/googleAds.service';

function isAdmin(req: Request): boolean {
  return (req as any).user?.role === 'ADMIN';
}

function canReadAds(req: Request): boolean {
  const role = (req as any).user?.role;
  return role === 'ADMIN' || role === 'MARKETING';
}

function ymdValid(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export const getAdsIntegrationsStatus = async (_req: Request, res: Response) => {
  try {
    const [meta, google] = await Promise.all([getMetaAdsConfigForUi(), getGoogleAdsConfigForUi()]);
    res.json({ meta, google });
  } catch (error: any) {
    console.error('getAdsIntegrationsStatus:', error);
    res.status(500).json({ message: 'Error obteniendo estado de integraciones de ads' });
  }
};

export const getMetaAdsConfigEndpoint = async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores' });
  try {
    const config = await getMetaAdsConfigForUi();
    res.json(config);
  } catch (error: any) {
    console.error('getMetaAdsConfigEndpoint:', error);
    res.status(500).json({ message: 'Error obteniendo configuración Meta Ads' });
  }
};

export const saveMetaAdsConfigEndpoint = async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores' });
  try {
    const body = req.body || {};
    await saveMetaAdsConfig({
      accountId: String(body.accountId || ''),
      accessToken: body.accessToken != null ? String(body.accessToken) : undefined,
      keepExistingToken: !!body.keepExistingToken
    });
    const config = await getMetaAdsConfigForUi();
    res.json({ ok: true, config });
  } catch (error: any) {
    console.error('saveMetaAdsConfigEndpoint:', error);
    res.status(400).json({ message: error?.message || 'Error guardando Meta Ads' });
  }
};

export const disconnectMetaAdsEndpoint = async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores' });
  try {
    await disconnectMetaAds();
    res.json({ ok: true });
  } catch (error: any) {
    console.error('disconnectMetaAdsEndpoint:', error);
    res.status(500).json({ message: 'Error desconectando Meta Ads' });
  }
};

export const getGoogleAdsConfigEndpoint = async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores' });
  try {
    const config = await getGoogleAdsConfigForUi();
    res.json(config);
  } catch (error: any) {
    console.error('getGoogleAdsConfigEndpoint:', error);
    res.status(500).json({ message: 'Error obteniendo configuración Google Ads' });
  }
};

export const saveGoogleAdsConfigEndpoint = async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores' });
  try {
    const body = req.body || {};
    await saveGoogleAdsConfig({
      customerId: String(body.customerId || ''),
      loginCustomerId: body.loginCustomerId != null ? String(body.loginCustomerId) : undefined,
      developerToken: body.developerToken != null ? String(body.developerToken) : undefined,
      refreshToken: body.refreshToken != null ? String(body.refreshToken) : undefined,
      keepExistingDeveloperToken: !!body.keepExistingDeveloperToken,
      keepExistingRefreshToken: !!body.keepExistingRefreshToken
    });
    const config = await getGoogleAdsConfigForUi();
    res.json({ ok: true, config });
  } catch (error: any) {
    console.error('saveGoogleAdsConfigEndpoint:', error);
    res.status(400).json({ message: error?.message || 'Error guardando Google Ads' });
  }
};

export const disconnectGoogleAdsEndpoint = async (req: Request, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ message: 'Solo administradores' });
  try {
    await disconnectGoogleAds();
    res.json({ ok: true });
  } catch (error: any) {
    console.error('disconnectGoogleAdsEndpoint:', error);
    res.status(500).json({ message: 'Error desconectando Google Ads' });
  }
};

export const getMetaAdsCampaignsEndpoint = async (req: Request, res: Response) => {
  if (!canReadAds(req)) return res.status(403).json({ message: 'Sin permiso para ver campañas Meta' });
  try {
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    if (!ymdValid(dateFrom) || !ymdValid(dateTo)) {
      return res.status(400).json({ message: 'Parámetros requeridos: date_from y date_to (YYYY-MM-DD)' });
    }
    const data = await fetchMetaAdsCampaigns(dateFrom, dateTo);
    res.json(data);
  } catch (error: any) {
    if (error?.code === 'NOT_CONFIGURED') {
      return res.status(400).json({ message: 'Meta Ads no configurado', configured: false });
    }
    console.error('getMetaAdsCampaignsEndpoint:', error);
    res.status(502).json({ message: error?.message || 'Error obteniendo campañas Meta' });
  }
};

export const getMetaAdSetsEndpoint = async (req: Request, res: Response) => {
  if (!canReadAds(req)) return res.status(403).json({ message: 'Sin permiso para ver conjuntos Meta' });
  try {
    const campaignId = String(req.params.campaignId || '').trim();
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    if (!campaignId || !ymdValid(dateFrom) || !ymdValid(dateTo)) {
      return res.status(400).json({ message: 'Parámetros requeridos: campaignId, date_from, date_to' });
    }
    const data = await fetchMetaAdSets(campaignId, dateFrom, dateTo);
    res.json(data);
  } catch (error: any) {
    if (error?.code === 'NOT_CONFIGURED') {
      return res.status(400).json({ message: 'Meta Ads no configurado', configured: false });
    }
    console.error('getMetaAdSetsEndpoint:', error);
    res.status(502).json({ message: error?.message || 'Error obteniendo conjuntos Meta' });
  }
};

export const getMetaAdsForAdSetEndpoint = async (req: Request, res: Response) => {
  if (!canReadAds(req)) return res.status(403).json({ message: 'Sin permiso para ver anuncios Meta' });
  try {
    const adsetId = String(req.params.adsetId || '').trim();
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    if (!adsetId || !ymdValid(dateFrom) || !ymdValid(dateTo)) {
      return res.status(400).json({ message: 'Parámetros requeridos: adsetId, date_from, date_to' });
    }
    const data = await fetchMetaAdsForAdSet(adsetId, dateFrom, dateTo);
    res.json(data);
  } catch (error: any) {
    if (error?.code === 'NOT_CONFIGURED') {
      return res.status(400).json({ message: 'Meta Ads no configurado', configured: false });
    }
    console.error('getMetaAdsForAdSetEndpoint:', error);
    res.status(502).json({ message: error?.message || 'Error obteniendo anuncios Meta' });
  }
};

export const getGoogleAdsCampaignsEndpoint = async (req: Request, res: Response) => {
  if (!canReadAds(req)) return res.status(403).json({ message: 'Sin permiso para ver campañas Google' });
  try {
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    if (!ymdValid(dateFrom) || !ymdValid(dateTo)) {
      return res.status(400).json({ message: 'Parámetros requeridos: date_from y date_to (YYYY-MM-DD)' });
    }
    const data = await fetchGoogleAdsCampaigns(dateFrom, dateTo);
    res.json(data);
  } catch (error: any) {
    if (error?.code === 'NOT_CONFIGURED') {
      return res.status(400).json({ message: 'Google Ads no configurado', configured: false });
    }
    console.error('getGoogleAdsCampaignsEndpoint:', error);
    res.status(502).json({ message: error?.message || 'Error obteniendo campañas Google' });
  }
};
