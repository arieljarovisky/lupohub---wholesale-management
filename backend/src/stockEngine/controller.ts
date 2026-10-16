/** Endpoints de la pantalla "Stock y ventas". Todo en lenguaje simple: la pantalla muestra estos textos tal cual. */
import { Request, Response } from 'express';
import { execute, get, query } from '../database/db';
import { getEngineState, setEngineState } from './schema';
import { enqueueAllLinked, retryAllNow, retryVariantNow, workerHeartbeat } from './syncQueue';
import {
  dismissUnmatchedLine,
  ingestMercadoLibreOrderById,
  ingestTiendaNubeOrderById,
  resolveUnmatchedLine,
} from './channelOrders';
import { checkRecentOrders } from './index';

const VARIANT_LABEL_SQL = `
  SELECT pv.id, p.name AS product_name, p.sku AS product_sku, COALESCE(pv.external_sku, pv.sku) AS sku,
         c.name AS color_name, COALESCE(sz.size_code, sz.name) AS size_code, COALESCE(s.stock, 0) AS stock
  FROM product_variants pv
  JOIN product_colors pc ON pc.id = pv.product_color_id
  JOIN products p ON p.id = pc.product_id
  LEFT JOIN colors c ON c.id = pc.color_id
  LEFT JOIN sizes sz ON sz.id = pv.size_id
  LEFT JOIN stocks s ON s.variant_id = pv.id`;

function variantDto(r: any) {
  return {
    variantId: String(r.id),
    productName: r.product_name ?? '',
    sku: r.sku ?? '',
    color: r.color_name ?? '',
    size: r.size_code ?? '',
    stock: Number(r.stock) || 0,
  };
}

async function variantsById(ids: string[]): Promise<Map<string, ReturnType<typeof variantDto>>> {
  const out = new Map<string, ReturnType<typeof variantDto>>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return out;
  const rows = await query(`${VARIANT_LABEL_SQL} WHERE pv.id IN (?)`, [unique]);
  for (const r of rows as any[]) out.set(String(r.id), variantDto(r));
  return out;
}

const PLATFORM_NAME: Record<string, string> = { tiendanube: 'Tienda Nube', mercadolibre: 'Mercado Libre' };

function movementText(type: string): string {
  switch (type) {
    case 'VENTA_TIENDA_NUBE':
      return 'Venta en Tienda Nube';
    case 'VENTA_MERCADO_LIBRE':
      return 'Venta en Mercado Libre';
    case 'CANCEL_VENTA_TIENDA_NUBE':
      return 'Venta cancelada en Tienda Nube';
    case 'CANCEL_VENTA_MERCADO_LIBRE':
      return 'Venta cancelada en Mercado Libre';
    case 'PEDIDO_MAYORISTA':
      return 'Pedido mayorista';
    case 'DEVOLUCION':
      return 'Devolución al stock';
    case 'AJUSTE_MANUAL':
      return 'Cambio a mano';
    default:
      return 'Carga de stock';
  }
}

export const getOverview = async (_req: Request, res: Response) => {
  try {
    const [integrations, queueRow, failingRows, unmatchedRows, alertRows, recentRows] = await Promise.all([
      query(`SELECT platform, access_token FROM integrations WHERE platform IN ('tiendanube', 'mercadolibre')`),
      get(
        `SELECT COUNT(*) AS pending,
                SUM(CASE WHEN attempts > 0 THEN 1 ELSE 0 END) AS failing,
                SUM(CASE WHEN priority = 1 THEN 1 ELSE 0 END) AS bulk,
                TIMESTAMPDIFF(SECOND, MIN(created_at), NOW()) AS oldest_seconds
         FROM stock_sync_queue`
      ),
      query(
        `SELECT q.variant_id, q.attempts, q.last_error, q.due_at, q.updated_at
         FROM stock_sync_queue q WHERE q.attempts > 0
         ORDER BY q.updated_at DESC LIMIT 50`
      ),
      query(
        `SELECT l.id, l.platform, l.external_order_id, l.sku, l.title, l.quantity, l.external_item_id, l.external_variant_id,
                o.order_number, o.buyer, o.order_created_at, l.created_at
         FROM channel_order_lines l
         JOIN channel_orders o ON o.platform = l.platform AND o.external_order_id = l.external_order_id
         WHERE l.state = 'unmatched'
         ORDER BY l.created_at DESC LIMIT 100`
      ),
      query(
        `SELECT id, kind, variant_id, message, reference, created_at FROM stock_alerts
         WHERE dismissed_at IS NULL ORDER BY created_at DESC LIMIT 100`
      ),
      query(
        `SELECT m.id, m.variant_id, m.quantity_change, m.new_stock, m.movement_type, m.reference, m.created_at
         FROM stock_movements m
         WHERE m.movement_type IN ('VENTA_TIENDA_NUBE','VENTA_MERCADO_LIBRE','CANCEL_VENTA_TIENDA_NUBE','CANCEL_VENTA_MERCADO_LIBRE','PEDIDO_MAYORISTA','DEVOLUCION','AJUSTE_MANUAL')
         ORDER BY m.created_at DESC LIMIT 40`
      ),
    ]);

    const connected = new Set((integrations as any[]).filter((r) => r.access_token).map((r) => String(r.platform)));
    const ids = [
      ...(failingRows as any[]).map((r) => String(r.variant_id)),
      ...(alertRows as any[]).map((r) => String(r.variant_id || '')),
      ...(recentRows as any[]).map((r) => String(r.variant_id)),
    ];
    const variants = await variantsById(ids);

    const failingTargets = (failingRows as any[]).length
      ? await query(
          `SELECT variant_id, label, last_error FROM stock_sync_targets WHERE ok = 0 AND variant_id IN (?)`,
          [(failingRows as any[]).map((r) => String(r.variant_id))]
        )
      : [];
    const targetsByVariant = new Map<string, Array<{ label: string; error: string }>>();
    for (const t of failingTargets as any[]) {
      const list = targetsByVariant.get(String(t.variant_id)) ?? [];
      list.push({ label: String(t.label || ''), error: String(t.last_error || '') });
      targetsByVariant.set(String(t.variant_id), list);
    }

    const heartbeat = workerHeartbeat();
    res.json({
      connections: {
        mercadolibre: connected.has('mercadolibre'),
        tiendanube: connected.has('tiendanube'),
      },
      worker: { alive: heartbeat != null && Date.now() - heartbeat < 60_000 },
      queue: {
        pending: Number(queueRow?.pending) || 0,
        failing: Number(queueRow?.failing) || 0,
        bulk: Number(queueRow?.bulk) || 0,
        oldestSeconds: Number(queueRow?.oldest_seconds) || 0,
      },
      fullResync: {
        enabled: (await getEngineState('full_resync_enabled')) === '1',
        lastAt: await getEngineState('last_full_resync_at'),
      },
      ordersCheck: {
        lastAt: await getEngineState('last_order_poll_at'),
        errors: ((await getEngineState('last_order_poll_errors')) || '').split('\n').filter(Boolean),
      },
      failing: (failingRows as any[]).map((r) => ({
        variant: variants.get(String(r.variant_id)) ?? { variantId: String(r.variant_id), productName: '(producto borrado)', sku: '', color: '', size: '', stock: 0 },
        attempts: Number(r.attempts) || 0,
        nextTryAt: r.due_at,
        targets: targetsByVariant.get(String(r.variant_id)) ?? [],
        error: String(r.last_error || ''),
      })),
      unmatched: (unmatchedRows as any[]).map((r) => {
        const title = String(r.title || '');
        const [name, reason] = title.split(' ⚠ ');
        return {
          lineId: Number(r.id),
          platform: String(r.platform),
          platformName: PLATFORM_NAME[String(r.platform)] || String(r.platform),
          orderId: String(r.external_order_id),
          orderNumber: r.order_number ? String(r.order_number) : null,
          buyer: r.buyer ? String(r.buyer) : null,
          title: name || '',
          reason: reason || '',
          sku: r.sku ? String(r.sku) : '',
          quantity: Number(r.quantity) || 0,
          date: r.order_created_at || r.created_at,
        };
      }),
      alerts: (alertRows as any[]).map((r) => ({
        id: String(r.id),
        kind: String(r.kind),
        message: String(r.message),
        reference: r.reference ? String(r.reference) : null,
        date: r.created_at,
        variant: r.variant_id ? variants.get(String(r.variant_id)) ?? null : null,
      })),
      recent: (recentRows as any[]).map((r) => ({
        id: String(r.id),
        what: movementText(String(r.movement_type)),
        type: String(r.movement_type),
        change: Number(r.quantity_change) || 0,
        stockAfter: Number(r.new_stock) || 0,
        reference: r.reference ? String(r.reference) : '',
        date: r.created_at,
        variant: variants.get(String(r.variant_id)) ?? null,
      })),
    });
  } catch (e: any) {
    console.error('[StockSync overview]', e);
    res.status(500).json({ message: 'No pude cargar el estado. Probá de nuevo en un momento.' });
  }
};

export const searchVariants = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ items: [] });
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const rows = await query(
      `${VARIANT_LABEL_SQL}
       WHERE p.name LIKE ? OR p.sku LIKE ? OR pv.sku LIKE ? OR pv.external_sku LIKE ? OR c.name LIKE ?
       ORDER BY p.name, c.name, sz.size_code
       LIMIT 40`,
      [like, like, like, like, like]
    );
    res.json({ items: (rows as any[]).map(variantDto) });
  } catch (e: any) {
    res.status(500).json({ message: 'No pude buscar productos' });
  }
};

export const resyncAll = async (_req: Request, res: Response) => {
  try {
    const n = await enqueueAllLinked();
    await setEngineState('full_resync_enabled', '1');
    await setEngineState('last_full_resync_at', new Date().toISOString());
    res.json({ queued: n, message: `Listo. Se van a enviar ${n} productos a Mercado Libre y Tienda Nube. Esto sigue solo, podés cerrar esta pantalla.` });
  } catch (e: any) {
    res.status(500).json({ message: 'No pude empezar el envío. Probá de nuevo.' });
  }
};

export const retryAll = async (_req: Request, res: Response) => {
  try {
    const n = await retryAllNow();
    res.json({ retried: n, message: n ? `Reintentando ${n} producto(s) ahora.` : 'No había nada pendiente.' });
  } catch {
    res.status(500).json({ message: 'No pude reintentar. Probá de nuevo.' });
  }
};

export const retryOne = async (req: Request, res: Response) => {
  try {
    await retryVariantNow(String(req.params.variantId));
    res.json({ message: 'Reintentando ahora.' });
  } catch {
    res.status(500).json({ message: 'No pude reintentar. Probá de nuevo.' });
  }
};

export const resolveLine = async (req: Request, res: Response) => {
  try {
    const lineId = Number(req.params.lineId);
    const variantId = String(req.body?.variantId || '').trim();
    const pack = Math.max(1, Math.floor(Number(req.body?.pack) || 1));
    const remember = req.body?.remember !== false;
    if (!lineId || !variantId) return res.status(400).json({ message: 'Elegí un producto.' });
    const r = await resolveUnmatchedLine(lineId, variantId, pack, remember);
    res.status(r.ok ? 200 : 409).json(r);
  } catch (e: any) {
    console.error('[StockSync resolve]', e);
    res.status(500).json({ message: 'No pude guardar. Probá de nuevo.' });
  }
};

export const dismissLine = async (req: Request, res: Response) => {
  try {
    const ok = await dismissUnmatchedLine(Number(req.params.lineId));
    res.json({ ok, message: ok ? 'Listo, no se descuenta nada por esta venta.' : 'Ya estaba resuelta.' });
  } catch {
    res.status(500).json({ message: 'No pude guardar. Probá de nuevo.' });
  }
};

export const dismissAlert = async (req: Request, res: Response) => {
  try {
    await execute(`UPDATE stock_alerts SET dismissed_at = NOW() WHERE id = ? AND dismissed_at IS NULL`, [String(req.params.id)]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ message: 'No pude guardar. Probá de nuevo.' });
  }
};

export const dismissAllAlerts = async (_req: Request, res: Response) => {
  try {
    await execute(`UPDATE stock_alerts SET dismissed_at = NOW() WHERE dismissed_at IS NULL`);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ message: 'No pude guardar. Probá de nuevo.' });
  }
};

export const checkOrdersNow = async (_req: Request, res: Response) => {
  try {
    const r = await checkRecentOrders(48 * 60 * 60 * 1000);
    res.json({
      ...r,
      message: r.errors.length
        ? `Revisé ${r.tn + r.ml} ventas, pero hubo problemas: ${r.errors[0]}`
        : `Listo. Revisé ${r.tn} ventas de Tienda Nube y ${r.ml} de Mercado Libre de las últimas 48 horas.`,
    });
  } catch (e: any) {
    res.status(500).json({ message: 'No pude revisar las ventas. Probá de nuevo.' });
  }
};

export const reprocessOrder = async (req: Request, res: Response) => {
  try {
    const platform = String(req.body?.platform || '');
    const orderId = String(req.body?.orderId || '').replace(/[^0-9A-Za-z-]/g, '');
    if (!orderId) return res.status(400).json({ message: 'Escribí el número de venta.' });
    if (platform === 'tiendanube') {
      const r = await ingestTiendaNubeOrderById(orderId);
      return res.json(r);
    }
    if (platform === 'mercadolibre') {
      const { result } = await ingestMercadoLibreOrderById(orderId);
      return res.json(result);
    }
    res.status(400).json({ message: 'Elegí Tienda Nube o Mercado Libre.' });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'No pude procesar esa venta.' });
  }
};
