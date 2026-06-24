import { Request, Response } from 'express';
import axios from 'axios';
import { get } from '../database/db';
import {
  buildManualTrackingEvents,
  expressTrackingStatusLabel,
  isExpressTrackingStatus,
  publicStatusFromManualStatus,
  type ExpressTrackingStatus,
} from '../services/tiendanubeExpressTracking.service';

const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
const TRACKING_CODE_RE = /^LHE\d{8}$/i;

const TN_SHIPPING_STATUS_LABELS: Record<string, string> = {
  unpacked: 'En preparación',
  unfulfilled: 'En preparación',
  unshipped: 'En preparación',
  pending: 'Pendiente de envío',
  shipped: 'Despachado',
  delivered: 'Entregado',
  partial: 'Envío parcial',
};

const TN_ORDER_STATUS_LABELS: Record<string, string> = {
  open: 'En proceso',
  closed: 'Finalizado',
  cancelled: 'Cancelado',
};

type TrackingEvent = { key: string; label: string; at: string | null; done: boolean };

function normalizeTrackingCodeInput(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase();
}

function isValidTrackingCode(code: string): boolean {
  return TRACKING_CODE_RE.test(code);
}

function tnShippingMethodFromOrder(order: any): string {
  const shippingCandidates = [
    order.shipping_option,
    order.shipping_option_name,
    order.shipping_method,
    order.shipping_method_name,
    order.shipping_name,
    order.shipping_type,
    order.shipping_mode,
    order.shipping_service,
  ]
    .map((v: any) => (v == null ? '' : String(v).trim()))
    .filter(Boolean);
  return shippingCandidates[0] || 'Envío Express';
}

function publicStatusFromOrder(order: any): { status: string; statusLabel: string } {
  const orderStatus = String(order.status || '').toLowerCase();
  const shippingStatus = String(order.shipping_status || '').toLowerCase();

  if (orderStatus === 'cancelled') {
    return { status: 'cancelled', statusLabel: 'Cancelado' };
  }
  if (shippingStatus === 'delivered') {
    return { status: 'delivered', statusLabel: 'Entregado' };
  }
  if (shippingStatus === 'shipped') {
    return { status: 'shipped', statusLabel: 'En camino' };
  }
  if (shippingStatus === 'partial') {
    return { status: 'partial', statusLabel: 'Envío parcial' };
  }
  if (order.paid_at || String(order.payment_status || '').toLowerCase() === 'paid') {
    return { status: 'preparing', statusLabel: 'En preparación' };
  }
  return { status: 'pending', statusLabel: 'Pendiente' };
}

function buildTrackingEventsFromTn(order: any, trackingAssignedAt: string | null): TrackingEvent[] {
  const shippingStatus = String(order.shipping_status || '').toLowerCase();
  const orderStatus = String(order.status || '').toLowerCase();
  const isCancelled = orderStatus === 'cancelled';

  const events: TrackingEvent[] = [];
  const push = (key: string, label: string, at: string | null, done: boolean) => {
    events.push({ key, label, at, done });
  };

  push('created', 'Pedido registrado', order.created_at || null, true);
  push('tracking', 'Código de seguimiento generado', trackingAssignedAt, !!trackingAssignedAt);

  const isPaid =
    !!order.paid_at || String(order.payment_status || '').toLowerCase() === 'paid';
  push('paid', 'Pago confirmado', order.paid_at || null, isPaid && !isCancelled);

  const isPreparing =
    !isCancelled &&
    isPaid &&
    (!shippingStatus || ['unpacked', 'unfulfilled', 'unshipped', 'pending'].includes(shippingStatus));
  push(
    'preparing',
    'En preparación',
    isPreparing ? order.updated_at || order.paid_at || null : null,
    isPreparing
  );

  const isShipped = shippingStatus === 'shipped' || shippingStatus === 'delivered' || shippingStatus === 'partial';
  push('shipped', 'Despachado', order.shipped_at || (isShipped ? order.updated_at || null : null), isShipped);

  const isDelivered = shippingStatus === 'delivered';
  push(
    'delivered',
    'Entregado',
    isDelivered ? order.updated_at || order.shipped_at || null : null,
    isDelivered
  );

  if (isCancelled) {
    push('cancelled', 'Pedido cancelado', order.cancelled_at || order.updated_at || null, true);
  }

  return events;
}

function publicCityFromOrder(order: any): string | null {
  const city = String(order.shipping_address?.city || order.shipping_address?.locality || '').trim();
  const province = String(order.shipping_address?.province || '').trim();
  if (city && province) return `${city}, ${province}`;
  return city || province || null;
}

async function fetchTiendaNubeOrder(orderId: string): Promise<any> {
  const integration = await get(
    `SELECT access_token, store_id, user_id FROM integrations WHERE platform = 'tiendanube'`
  );
  if (!integration?.access_token) {
    const err: any = new Error('Seguimiento no disponible temporalmente');
    err.status = 503;
    throw err;
  }
  const storeId = integration.store_id || integration.user_id;
  if (!storeId) {
    const err: any = new Error('Seguimiento no disponible temporalmente');
    err.status = 503;
    throw err;
  }

  const res = await axios.get(`https://api.tiendanube.com/v1/${storeId}/orders/${orderId}`, {
    headers: {
      Authentication: `bearer ${integration.access_token}`,
      'User-Agent': TN_USER_AGENT,
    },
    validateStatus: () => true,
  });

  if (res.status === 404) {
    const err: any = new Error('No encontramos un pedido asociado a este código');
    err.status = 404;
    throw err;
  }
  if (res.status !== 200) {
    const err: any = new Error('No pudimos consultar el estado del envío');
    err.status = 502;
    throw err;
  }
  return res.data;
}

/**
 * Consulta pública del estado de un envío express por código LHE########.
 * GET /api/public/tracking/:trackingCode
 * GET /api/public/tracking?code=LHE100001
 */
export const getPublicTrackingByCode = async (req: Request, res: Response) => {
  const trackingCode = normalizeTrackingCodeInput(req.params.trackingCode ?? req.query.code);
  if (!trackingCode) {
    return res.status(400).json({ message: 'Ingresá un código de seguimiento' });
  }
  if (!isValidTrackingCode(trackingCode)) {
    return res.status(400).json({ message: 'Código de seguimiento inválido' });
  }

  try {
    const row = await get(
      `SELECT external_order_id, order_number, tracking_code, manual_status, manual_status_updated_at, created_at
       FROM tiendanube_express_tracking
       WHERE UPPER(tracking_code) = ?`,
      [trackingCode]
    );
    if (!row?.external_order_id) {
      return res.status(404).json({ message: 'No encontramos ese código de seguimiento' });
    }

    const order = await fetchTiendaNubeOrder(String(row.external_order_id));
    const trackingAssignedAt = row.created_at
      ? new Date(row.created_at).toISOString()
      : null;
    const manualStatusUpdatedAt = row.manual_status_updated_at
      ? new Date(row.manual_status_updated_at).toISOString()
      : null;

    const manualStatus = isExpressTrackingStatus(row.manual_status) ? row.manual_status : null;
    const useManual = manualStatus != null;

    const { status, statusLabel } = useManual
      ? publicStatusFromManualStatus(manualStatus)
      : publicStatusFromOrder(order);

    const shippingStatus = useManual
      ? manualStatus
      : String(order.shipping_status || '').toLowerCase();

    const events = useManual
      ? buildManualTrackingEvents(manualStatus, {
          trackingAssignedAt,
          manualStatusUpdatedAt,
          orderCreatedAt: order.created_at || null,
          orderPaidAt: order.paid_at || null,
        })
      : buildTrackingEventsFromTn(order, trackingAssignedAt);

    return res.json({
      trackingCode: String(row.tracking_code || trackingCode).toUpperCase(),
      orderNumber: String(row.order_number || order.number || ''),
      source: 'TIENDANUBE',
      status,
      statusLabel,
      statusSource: useManual ? 'manual' : 'tiendanube',
      shippingStatus: shippingStatus || null,
      shippingStatusLabel: useManual
        ? expressTrackingStatusLabel(manualStatus)
        : TN_SHIPPING_STATUS_LABELS[String(order.shipping_status || '').toLowerCase()] ||
          (order.shipping_status ? String(order.shipping_status) : null),
      orderStatus: String(order.status || '') || null,
      orderStatusLabel: TN_ORDER_STATUS_LABELS[String(order.status || '').toLowerCase()] || null,
      shippingMethod: tnShippingMethodFromOrder(order),
      destinationCity: publicCityFromOrder(order),
      createdAt: order.created_at || null,
      paidAt: order.paid_at || null,
      shippedAt: order.shipped_at || null,
      updatedAt: useManual ? manualStatusUpdatedAt : order.updated_at || null,
      trackingAssignedAt,
      trackingStatusUpdatedAt: manualStatusUpdatedAt,
      events,
    });
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    if (status >= 500) console.error('getPublicTrackingByCode:', error?.message || error);
    return res.status(status).json({
      message: error?.message || 'Error consultando el seguimiento',
    });
  }
};
