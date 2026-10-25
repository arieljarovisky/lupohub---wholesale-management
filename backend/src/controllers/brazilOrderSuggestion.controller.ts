import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import {
  buildBrazilOrderSuggestion,
  compareSizes,
  parseBrazilSuggestionParams,
  BrazilSuggestionArticle
} from '../services/brazilOrderSuggestion.service';

function paramsFromReq(req: Request) {
  return parseBrazilSuggestionParams(req.query as Record<string, unknown>);
}

export const getBrazilOrderSuggestion = async (req: Request, res: Response) => {
  try {
    const data = await buildBrazilOrderSuggestion(paramsFromReq(req));
    res.json(data);
  } catch (error: any) {
    console.error('getBrazilOrderSuggestion:', error);
    res.status(500).json({
      message: 'Error calculando el pedido a Brasil',
      error: error?.message || String(error)
    });
  }
};

function collectSizeLabels(articles: BrazilSuggestionArticle[]): string[] {
  const set = new Set<string>();
  for (const a of articles) {
    for (const v of a.variants) {
      if (v.suggestedQty > 0 || v.sold > 0) set.add(v.sizeLabel);
    }
  }
  return Array.from(set).sort(compareSizes);
}

export const exportBrazilOrderSuggestion = async (req: Request, res: Response) => {
  try {
    const data = await buildBrazilOrderSuggestion(paramsFromReq(req));
    const toOrder = data.articles.filter((a) => a.suggestedQty > 0);
    const sizes = collectSizeLabels(toOrder.length ? toOrder : data.articles);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'LupoHub';
    wb.created = new Date();

    const wsResumen = wb.addWorksheet('Resumen');
    wsResumen.columns = [
      { header: 'Dato', key: 'k', width: 36 },
      { header: 'Valor', key: 'v', width: 28 }
    ];
    wsResumen.addRows([
      ['Período de ventas', `${data.from} a ${data.to} (${data.periodDays} días)`],
      ['Días de importación', data.leadTimeDays],
      ['Cobertura deseada al llegar', `${data.coverageDays} días`],
      ['Artículos en catálogo', data.summary.articles],
      ['Artículos a pedir', data.summary.articlesToOrder],
      ['Unidades sugeridas', data.summary.unitsToOrder],
      ['Críticos / agotados', data.summary.urgent],
      ['Unidades vendidas en el período', data.summary.soldInPeriod],
      ['Stock actual', data.summary.stockUnits],
      ['En camino (despachos)', data.summary.incomingUnits],
      [
        'Criterio',
        'Sugerido = ventas/día × (importación + cobertura) − stock actual − mercadería en camino'
      ]
    ]);
    wsResumen.getRow(1).font = { bold: true };
    wsResumen.getCell('A1').font = { bold: true };

    const wsArt = wb.addWorksheet('Artículos a pedir');
    wsArt.views = [{ state: 'frozen', ySplit: 1 }];
    wsArt.columns = [
      { header: 'Prioridad', key: 'priority', width: 12 },
      { header: 'Código', key: 'sku', width: 14 },
      { header: 'Artículo', key: 'name', width: 42 },
      { header: 'Categoría', key: 'category', width: 16 },
      { header: 'Stock', key: 'stock', width: 10 },
      { header: 'En camino', key: 'incoming', width: 12 },
      { header: 'Disponible', key: 'available', width: 12 },
      { header: 'Vendidas TN', key: 'soldTn', width: 12 },
      { header: 'Vendidas ML', key: 'soldMl', width: 12 },
      { header: 'Vendidas May.', key: 'soldMay', width: 14 },
      { header: 'Vendidas total', key: 'sold', width: 14 },
      { header: 'u/día', key: 'dailyRate', width: 10 },
      { header: 'Días de cobertura', key: 'daysOfCover', width: 16 },
      { header: 'Pedir', key: 'suggestedQty', width: 10 }
    ];
    wsArt.getRow(1).font = { bold: true };
    for (const a of toOrder) {
      wsArt.addRow({
        priority: a.priority,
        sku: a.sku,
        name: a.name,
        category: a.category,
        stock: a.stock,
        incoming: a.incoming,
        available: a.available,
        soldTn: a.soldTn,
        soldMl: a.soldMl,
        soldMay: a.soldMay,
        sold: a.sold,
        dailyRate: a.dailyRate,
        daysOfCover: a.daysOfCover,
        suggestedQty: a.suggestedQty
      });
    }

    const wsGrid = wb.addWorksheet('Planilla Brasil');
    wsGrid.views = [{ state: 'frozen', ySplit: 1 }];
    const gridHeaders = ['Código', 'Artículo', 'Color', 'Código color', ...sizes, 'Total pedir'];
    wsGrid.addRow(gridHeaders);
    wsGrid.getRow(1).font = { bold: true };
    wsGrid.getColumn(1).width = 14;
    wsGrid.getColumn(2).width = 40;
    wsGrid.getColumn(3).width = 22;
    wsGrid.getColumn(4).width = 14;
    sizes.forEach((_, i) => {
      wsGrid.getColumn(5 + i).width = 10;
    });
    wsGrid.getColumn(5 + sizes.length).width = 12;

    const byColor = new Map<string, { sku: string; name: string; colorName: string; colorCode: string; qty: Record<string, number> }>();
    for (const a of toOrder) {
      for (const v of a.variants) {
        if (v.suggestedQty <= 0) continue;
        const key = `${a.productId}|${v.colorName}|${v.colorCode}`;
        const row = byColor.get(key) || {
          sku: a.sku,
          name: a.name,
          colorName: v.colorName,
          colorCode: v.colorCode,
          qty: {}
        };
        row.qty[v.sizeLabel] = (row.qty[v.sizeLabel] || 0) + v.suggestedQty;
        byColor.set(key, row);
      }
    }

    const gridRows = Array.from(byColor.values()).sort((a, b) => {
      const skuCmp = a.sku.localeCompare(b.sku, 'es', { numeric: true });
      if (skuCmp !== 0) return skuCmp;
      return a.colorName.localeCompare(b.colorName, 'es');
    });

    for (const row of gridRows) {
      const sizeQtys = sizes.map((s) => row.qty[s] || 0);
      const total = sizeQtys.reduce((sum, n) => sum + n, 0);
      wsGrid.addRow([row.sku, row.name, row.colorName, row.colorCode, ...sizeQtys, total]);
    }

    const wsDet = wb.addWorksheet('Detalle color talle');
    wsDet.views = [{ state: 'frozen', ySplit: 1 }];
    wsDet.columns = [
      { header: 'Código', key: 'sku', width: 14 },
      { header: 'Artículo', key: 'name', width: 40 },
      { header: 'Color', key: 'colorName', width: 20 },
      { header: 'Talle', key: 'sizeLabel', width: 10 },
      { header: 'Prioridad', key: 'priority', width: 12 },
      { header: 'Stock', key: 'stock', width: 10 },
      { header: 'En camino', key: 'incoming', width: 12 },
      { header: 'Vendidas', key: 'sold', width: 12 },
      { header: 'u/día', key: 'dailyRate', width: 10 },
      { header: 'Días cobertura', key: 'daysOfCover', width: 14 },
      { header: 'Pedir', key: 'suggestedQty', width: 10 }
    ];
    wsDet.getRow(1).font = { bold: true };
    for (const a of toOrder) {
      for (const v of a.variants.filter((x) => x.suggestedQty > 0)) {
        wsDet.addRow({
          sku: a.sku,
          name: a.name,
          colorName: v.colorName,
          sizeLabel: v.sizeLabel,
          priority: v.priority,
          stock: v.stock,
          incoming: v.incoming,
          sold: v.sold,
          dailyRate: v.dailyRate,
          daysOfCover: v.daysOfCover,
          suggestedQty: v.suggestedQty
        });
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    const filename = `pedido_brasil_${data.from}_a_${data.to}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (error: any) {
    console.error('exportBrazilOrderSuggestion:', error);
    res.status(500).json({
      message: 'Error exportando el pedido a Brasil',
      error: error?.message || String(error)
    });
  }
};
