import { Request, Response } from 'express';
import {
  loadExpressTrackingPageConfig,
  syncExpressTrackingPageToStore,
} from '../services/tiendanubeExpressTrackingPage.service';

export const getTiendaNubeExpressTrackingPageConfig = async (_req: Request, res: Response) => {
  try {
    const config = await loadExpressTrackingPageConfig();
    res.json({ config });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ message: msg });
  }
};

export const saveTiendaNubeExpressTrackingPageConfig = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Solo administradores pueden configurar la página de seguimiento.' });
    }
    const enabled = !!(req.body?.enabled ?? req.body?.config?.enabled);
    const config = await syncExpressTrackingPageToStore({ enabled });
    res.json({ ok: true, config });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[saveTiendaNubeExpressTrackingPageConfig]', msg);
    res.status(500).json({ message: msg });
  }
};
