import { Request, Response } from 'express';
import axios from 'axios';
import ExcelJS from 'exceljs';
import { get } from '../database/db';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';

function asYmd(raw: unknown): string {
  const s = String(raw || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function asIsoBounds(fromYmd: string, toYmd: string): { minIso: string; maxIso: string } {
  // Mantener franja local Argentina para evitar recortes por timezone.
  return {
    minIso: `${fromYmd}T00:00:00-03:00`,
    maxIso: `${toYmd}T23:59:59-03:00`
  };
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseProductsFilter(raw: unknown): string[] {
  const base = String(raw || '').trim();
  if (!base) return [];
  return base
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.toLowerCase());
}

export const exportTiendaNubeSalesReportXlsx = async (req: Request, res: Response) => {
  try {
    const integration = await get(
      `SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`
    );
    if (!integration?.access_token) {
      return res.status(400).json({ message: 'No hay integración con Tienda Nube' });
    }
    const storeId = integration.store_id || integration.user_id;
    if (!storeId) {
      return res.status(400).json({ message: 'No se encontró store_id de Tienda Nube' });
    }

    const from = asYmd(req.query.from || req.query.desde);
    const to = asYmd(req.query.to || req.query.hasta);
    if (!from || !to) {
      return res.status(400).json({ message: 'Parámetros requeridos: from y to en formato YYYY-MM-DD' });
    }
    if (from > to) {
      return res.status(400).json({ message: 'Rango inválido: from no puede ser mayor que to' });
    }
    const { minIso, maxIso } = asIsoBounds(from, to);

    const perPage = 200;
    let page = 1;
    const rawOrders: any[] = [];
    while (true) {
      const response = await axios.get(`https://api.tiendanube.com/v1/${storeId}/orders`, {
        headers: {
          Authentication: `bearer ${integration.access_token}`,
          'User-Agent': TN_USER_AGENT
        },
        params: {
          page,
          per_page: perPage,
          created_at_min: minIso,
          created_at_max: maxIso
        },
        validateStatus: () => true
      });
      if (response.status !== 200) {
        const detail =
          response.data?.description ||
          response.data?.message ||
          response.data?.error ||
          response.statusText;
        return res.status(response.status >= 400 ? 502 : 500).json({
          message: 'Error consultando órdenes de Tienda Nube',
          detail
        });
      }
      const batch = Array.isArray(response.data) ? response.data : [];
      if (batch.length === 0) break;
      rawOrders.push(...batch);
      if (batch.length < perPage) break;
      page += 1;
      if (page > 400) break;
    }

    const selectedProducts = parseProductsFilter(req.query.products);

    type ProductAgg = {
      codigo: string;
      producto: string;
      cantidad: number;
      total: number;
    };
    const aggMap = new Map<string, ProductAgg>();
    let matchedLines = 0;

    for (const order of rawOrders) {
      const lines = Array.isArray(order?.products) ? order.products : [];
      for (const p of lines) {
        const productId = String(p?.product_id ?? p?.id ?? '').trim();
        const sku = String(p?.sku ?? p?.variant_sku ?? '').trim();
        const name = String(p?.name ?? p?.product_name ?? p?.title ?? '').trim() || 'Producto';
        const quantity = Math.max(0, toNum(p?.quantity ?? p?.qty ?? 0));
        const unitPrice = toNum(p?.price ?? p?.price_per_unit ?? p?.promotional_price ?? 0);
        if (quantity <= 0) continue;

        const idLower = productId.toLowerCase();
        const skuLower = sku.toLowerCase();
        const nameLower = name.toLowerCase();
        if (
          selectedProducts.length > 0 &&
          !selectedProducts.some((term) =>
            term === idLower || term === skuLower || nameLower.includes(term)
          )
        ) {
          continue;
        }

        matchedLines += 1;
        const code = sku || productId || name;
        const key = `${productId}||${sku}||${name}`.toLowerCase();
        const prev = aggMap.get(key) || {
          codigo: code,
          producto: name,
          cantidad: 0,
          total: 0
        };
        prev.cantidad += quantity;
        prev.total += unitPrice * quantity;
        aggMap.set(key, prev);
      }
    }

    const productRows = Array.from(aggMap.values()).map((r) => ({
      codigo: r.codigo,
      producto: r.producto,
      cantidad: r.cantidad,
      precio: r.cantidad > 0 ? r.total / r.cantidad : 0
    }));
    productRows.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));

    const totalUnits = productRows.reduce((acc, r) => acc + r.cantidad, 0);
    const totalAmount = productRows.reduce((acc, r) => acc + r.precio * r.cantidad, 0);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'LupoHub';
    wb.created = new Date();

    const wsResumen = wb.addWorksheet('Resumen');
    wsResumen.columns = [{ width: 36 }, { width: 24 }];
    wsResumen.addRow(['Reporte ventas Tienda Nube', '']);
    wsResumen.mergeCells(1, 1, 1, 2);
    wsResumen.addRow(['Período desde', from]);
    wsResumen.addRow(['Período hasta', to]);
    wsResumen.addRow(['Órdenes analizadas', rawOrders.length]);
    wsResumen.addRow(['Filtro productos', selectedProducts.length > 0 ? selectedProducts.join(', ') : 'Todos']);
    wsResumen.addRow(['Líneas que matchearon filtro', matchedLines]);
    wsResumen.addRow(['Productos en reporte', productRows.length]);
    wsResumen.addRow(['Unidades vendidas', totalUnits]);
    wsResumen.addRow(['Total vendido (aprox)', totalAmount]);
    wsResumen.getCell('A1').font = { bold: true, size: 13 };
    for (let r = 2; r <= 8; r++) {
      wsResumen.getCell(`A${r}`).font = { bold: true };
    }
    wsResumen.getCell('B7').numFmt = '#,##0';
    wsResumen.getCell('B8').numFmt = '#,##0.00';

    const ws = wb.addWorksheet('Productos');
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.columns = [
      { header: 'Código', key: 'codigo', width: 22 },
      { header: 'Producto', key: 'producto', width: 42 },
      { header: 'Cantidad vendida', key: 'cantidad', width: 18 },
      { header: 'Precio unitario promedio', key: 'precio', width: 24 }
    ];
    ws.getRow(1).font = { bold: true };
    productRows.forEach((row) => ws.addRow(row));

    for (let i = 2; i <= ws.rowCount; i++) {
      ws.getCell(`C${i}`).numFmt = '#,##0';
      ws.getCell(`D${i}`).numFmt = '#,##0.00';
    }

    const buf = await wb.xlsx.writeBuffer();
    const filename = `reporte_ventas_tiendanube_${from}_a_${to}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (error: any) {
    console.error('exportTiendaNubeSalesReportXlsx:', error);
    res.status(500).json({ message: 'Error generando reporte de ventas Tienda Nube', error: error.message });
  }
};
