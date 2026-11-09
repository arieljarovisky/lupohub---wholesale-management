import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import {
  buenosAiresDate,
  captureStockDailySnapshot,
  compareStockSnapshots,
  isIsoDate,
  listStockSnapshotDays,
} from '../services/stockDailySnapshot.service';

export const listDailySnapshots = async (_req: Request, res: Response) => {
  try {
    const days = await listStockSnapshotDays();
    res.json({ today: buenosAiresDate(), days });
  } catch (error: any) {
    console.error('Error listing stock snapshots:', error);
    res.status(500).json({ message: 'No se pudieron leer las fotos de stock' });
  }
};

export const createDailySnapshot = async (req: Request, res: Response) => {
  try {
    const requested = typeof req.body?.date === 'string' ? req.body.date.trim() : '';
    const date = requested || buenosAiresDate();
    if (!isIsoDate(date)) return res.status(400).json({ message: 'Fecha inválida' });
    const result = await captureStockDailySnapshot(date);
    res.json({
      message: result.replaced
        ? `Foto del ${result.date} actualizada`
        : `Foto del ${result.date} guardada`,
      ...result,
    });
  } catch (error: any) {
    console.error('Error creating stock snapshot:', error);
    res.status(500).json({ message: error?.message || 'No se pudo guardar la foto de stock' });
  }
};

export const compareDailySnapshots = async (req: Request, res: Response) => {
  try {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || 'live').trim() || 'live';
    if (!from) return res.status(400).json({ message: 'Elegí la foto de partida' });
    const result = await compareStockSnapshots({ from, to });
    res.json(result);
  } catch (error: any) {
    const message = error?.message || 'No se pudo comparar el stock';
    const status = /no hay foto|inválid|distintas/i.test(message) ? 400 : 500;
    if (status === 500) console.error('Error comparing stock snapshots:', error);
    res.status(status).json({ message });
  }
};

export const exportDailySnapshotCompare = async (req: Request, res: Response) => {
  try {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || 'live').trim() || 'live';
    if (!from) return res.status(400).json({ message: 'Elegí la foto de partida' });
    const result = await compareStockSnapshots({ from, to, limit: 20000 });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'LupoHub';
    wb.created = new Date();

    const resumen = wb.addWorksheet('Resumen');
    resumen.columns = [{ width: 36 }, { width: 28 }];
    resumen.addRow(['Comparación de stock', '']);
    resumen.addRow(['Foto de partida', result.from]);
    resumen.addRow(['Comparado con', result.toLabel]);
    resumen.addRow(['Variantes que bajaron', result.summary.variantsDown]);
    resumen.addRow(['Unidades descontadas', result.summary.unitsDown]);
    resumen.addRow(['Variantes que subieron', result.summary.variantsUp]);
    resumen.addRow(['Unidades que entraron', result.summary.unitsUp]);
    resumen.getCell('A1').font = { bold: true, size: 14 };
    for (let r = 2; r <= 7; r++) resumen.getCell(`A${r}`).font = { bold: true };

    const ws = wb.addWorksheet('Diferencias');
    ws.columns = [
      { header: 'Código', key: 'productSku', width: 16 },
      { header: 'Artículo', key: 'productName', width: 42 },
      { header: 'Color', key: 'color', width: 22 },
      { header: 'Talle', key: 'size', width: 12 },
      { header: 'SKU', key: 'sku', width: 22 },
      { header: `Stock ${result.from}`, key: 'fromStock', width: 16 },
      { header: result.to === 'live' ? 'Stock ahora' : `Stock ${result.to}`, key: 'toStock', width: 16 },
      { header: 'Diferencia', key: 'delta', width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const row of result.rows) ws.addRow(row);
    ws.getColumn('fromStock').numFmt = '#,##0';
    ws.getColumn('toStock').numFmt = '#,##0';
    ws.getColumn('delta').numFmt = '#,##0';

    const out = await wb.xlsx.writeBuffer();
    const buf = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out as ArrayBufferLike));
    const filename = `stock_${result.from}_vs_${result.to}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buf);
  } catch (error: any) {
    const message = error?.message || 'No se pudo exportar la comparación';
    const status = /no hay foto|inválid|distintas/i.test(message) ? 400 : 500;
    if (status === 500) console.error('Error exporting stock snapshot compare:', error);
    return res.status(status).json({ message });
  }
};
