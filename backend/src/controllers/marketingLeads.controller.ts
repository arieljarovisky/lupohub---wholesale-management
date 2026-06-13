import { Request, Response } from 'express';
import {
  createMarketingLead,
  deleteMarketingLead,
  getMarketingLeadMetrics,
  listMarketingLeads,
  updateMarketingLead
} from '../services/marketingLeads.service';

function ymdValid(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export const listLeads = async (req: Request, res: Response) => {
  try {
    const leads = await listMarketingLeads({
      dateFrom: typeof req.query.date_from === 'string' ? req.query.date_from : undefined,
      dateTo: typeof req.query.date_to === 'string' ? req.query.date_to : undefined,
      source: typeof req.query.source === 'string' ? req.query.source : undefined,
      stage: typeof req.query.stage === 'string' ? req.query.stage : undefined,
      campaignId: typeof req.query.campaign_id === 'string' ? req.query.campaign_id : undefined
    });
    res.json({ leads });
  } catch (error: any) {
    console.error('listLeads:', error);
    res.status(500).json({ message: error?.message || 'Error listando leads' });
  }
};

export const createLead = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const lead = await createMarketingLead({
      name: req.body?.name,
      phone: req.body?.phone,
      email: req.body?.email,
      source: req.body?.source,
      campaignId: req.body?.campaignId ?? req.body?.campaign_id,
      campaignName: req.body?.campaignName ?? req.body?.campaign_name,
      notes: req.body?.notes,
      createdBy: userId
    });
    res.status(201).json({ lead });
  } catch (error: any) {
    console.error('createLead:', error);
    const msg = error?.message || 'Error creando lead';
    res.status(msg.includes('inválid') || msg.includes('requerido') ? 400 : 500).json({ message: msg });
  }
};

export const updateLead = async (req: Request, res: Response) => {
  try {
    const lead = await updateMarketingLead(req.params.id, {
      name: req.body?.name,
      phone: req.body?.phone,
      email: req.body?.email,
      source: req.body?.source,
      stage: req.body?.stage,
      campaignId: req.body?.campaignId ?? req.body?.campaign_id,
      campaignName: req.body?.campaignName ?? req.body?.campaign_name,
      revenue: req.body?.revenue,
      notes: req.body?.notes
    });
    res.json({ lead });
  } catch (error: any) {
    console.error('updateLead:', error);
    const msg = error?.message || 'Error actualizando lead';
    const code = msg.includes('no encontrado') ? 404 : msg.includes('inválid') ? 400 : 500;
    res.status(code).json({ message: msg });
  }
};

export const removeLead = async (req: Request, res: Response) => {
  try {
    await deleteMarketingLead(req.params.id);
    res.json({ ok: true });
  } catch (error: any) {
    console.error('removeLead:', error);
    const msg = error?.message || 'Error eliminando lead';
    res.status(msg.includes('no encontrado') ? 404 : 500).json({ message: msg });
  }
};

export const getLeadMetrics = async (req: Request, res: Response) => {
  const dateFrom = typeof req.query.date_from === 'string' ? req.query.date_from : '';
  const dateTo = typeof req.query.date_to === 'string' ? req.query.date_to : '';
  if (!ymdValid(dateFrom) || !ymdValid(dateTo)) {
    return res.status(400).json({ message: 'date_from y date_to requeridos (YYYY-MM-DD)' });
  }
  try {
    const metrics = await getMarketingLeadMetrics({ dateFrom, dateTo });
    res.json(metrics);
  } catch (error: any) {
    console.error('getLeadMetrics:', error);
    res.status(500).json({ message: error?.message || 'Error calculando métricas' });
  }
};
