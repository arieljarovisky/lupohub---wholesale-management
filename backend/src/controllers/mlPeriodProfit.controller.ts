import { Request, Response } from 'express';
import {
  buildMlPeriodProfitWorkbook,
  computeMlPeriodProfit,
  getMlChannelInvoice,
  monthBounds,
  saveMlChannelInvoice,
} from '../services/mlPeriodProfit.service';

function readMonth(raw: unknown): { month: string; from: string; to: string } | null {
  const month = String(raw || '').trim();
  const bounds = monthBounds(month);
  if (!bounds) return null;
  return { month, ...bounds };
}

/** GET /integrations/channel-margins/ml-invoice?month=YYYY-MM */
export const getMlPeriodInvoice = async (req: Request, res: Response) => {
  const parsed = readMonth(req.query.month);
  if (!parsed) {
    res.status(400).json({ message: 'Indicá el mes como YYYY-MM' });
    return;
  }
  try {
    const invoice = await getMlChannelInvoice(parsed.month);
    res.json({ month: parsed.month, invoice });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[getMlPeriodInvoice]', msg);
    res.status(500).json({ message: 'No se pudo leer la factura de Mercado Libre' });
  }
};

/** PUT /integrations/channel-margins/ml-invoice */
export const putMlPeriodInvoice = async (req: Request, res: Response) => {
  const parsed = readMonth(req.body?.month);
  if (!parsed) {
    res.status(400).json({ message: 'Indicá el mes como YYYY-MM' });
    return;
  }
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    res.status(400).json({ message: 'El importe de la factura tiene que ser un número mayor o igual a 0' });
    return;
  }
  try {
    const invoice = await saveMlChannelInvoice({
      month: parsed.month,
      amount,
      invoiceNumber: req.body?.invoiceNumber,
      notes: req.body?.notes,
    });
    res.json({ invoice });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[putMlPeriodInvoice]', msg);
    res.status(500).json({ message: 'No se pudo guardar la factura de Mercado Libre' });
  }
};

/** GET /integrations/channel-margins/ml-period?month=YYYY-MM */
export const getMlPeriodProfit = async (req: Request, res: Response) => {
  const parsed = readMonth(req.query.month);
  if (!parsed) {
    res.status(400).json({ message: 'Indicá el mes como YYYY-MM' });
    return;
  }
  try {
    const result = await computeMlPeriodProfit(parsed.from, parsed.to, String(req.query.priceListId || ''));
    res.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[getMlPeriodProfit]', msg);
    const status = msg.includes('no está conectado') ? 400 : 500;
    res.status(status).json({ message: msg || 'No se pudo calcular el resultado de Mercado Libre' });
  }
};

/** GET /integrations/channel-margins/ml-period/export?month=YYYY-MM */
export const exportMlPeriodProfitXlsx = async (req: Request, res: Response) => {
  const parsed = readMonth(req.query.month);
  if (!parsed) {
    res.status(400).json({ message: 'Indicá el mes como YYYY-MM' });
    return;
  }
  try {
    const result = await computeMlPeriodProfit(parsed.from, parsed.to, String(req.query.priceListId || ''));
    const wb = await buildMlPeriodProfitWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="MercadoLibre-${parsed.month}-ganancia.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[exportMlPeriodProfitXlsx]', msg);
    if (!res.headersSent) {
      res.status(500).json({ message: msg || 'No se pudo exportar el Excel' });
    }
  }
};
