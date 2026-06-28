export const EXPRESS_TRACKING_STATUSES = [
  'pending',
  'preparing',
  'shipped',
  'delivered',
  'cancelled',
] as const;

export type ExpressTrackingStatus = (typeof EXPRESS_TRACKING_STATUSES)[number];

export const EXPRESS_TRACKING_STATUS_LABELS: Record<ExpressTrackingStatus, string> = {
  pending: 'Pendiente',
  preparing: 'En preparación',
  shipped: 'En camino',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

export function isExpressTrackingStatus(value: unknown): value is ExpressTrackingStatus {
  return typeof value === 'string' && (EXPRESS_TRACKING_STATUSES as readonly string[]).includes(value);
}

export function expressTrackingStatusLabel(status: ExpressTrackingStatus): string {
  return EXPRESS_TRACKING_STATUS_LABELS[status] || status;
}

export type ConfirmExpressDeliveryResult =
  | { ok: true; alreadyDelivered: true; trackingCode: string; orderNumber: string | null }
  | { ok: true; alreadyDelivered: false; trackingCode: string; orderNumber: string | null; deliveredAt: string }
  | { ok: false; reason: 'not_found' | 'invalid_code' | 'cancelled' | 'not_ready' };

export type StartExpressTripResult =
  | { ok: true; alreadyStarted: true; trackingCode: string; orderNumber: string | null }
  | { ok: true; alreadyStarted: false; trackingCode: string; orderNumber: string | null; startedAt: string }
  | { ok: false; reason: 'not_found' | 'invalid_code' | 'cancelled' | 'already_delivered' };

const TRACKING_CODE_RE = /^LHE\d{8}$/i;

function normalizeTrackingCode(trackingCodeRaw: string): string {
  return String(trackingCodeRaw ?? '').trim().toUpperCase();
}

function parseManualStatus(raw: string | null | undefined): ExpressTrackingStatus | null {
  const key = String(raw || '').toLowerCase();
  return isExpressTrackingStatus(key) ? key : null;
}

/** Marca un envío express como en camino (repartidor escanea QR al salir). */
export async function startExpressTripByTrackingCode(
  trackingCodeRaw: string,
  deps: {
    getRow: (code: string) => Promise<{
      external_order_id: string;
      order_number: string | null;
      tracking_code: string;
      manual_status: string | null;
    } | null | undefined>;
    updateShipped: (code: string) => Promise<void>;
  }
): Promise<StartExpressTripResult> {
  const trackingCode = normalizeTrackingCode(trackingCodeRaw);
  if (!TRACKING_CODE_RE.test(trackingCode)) {
    return { ok: false, reason: 'invalid_code' };
  }

  const row = await deps.getRow(trackingCode);
  if (!row?.tracking_code) {
    return { ok: false, reason: 'not_found' };
  }

  const currentStatus = parseManualStatus(row.manual_status);
  if (currentStatus === 'cancelled') {
    return { ok: false, reason: 'cancelled' };
  }
  if (currentStatus === 'delivered') {
    return { ok: false, reason: 'already_delivered' };
  }
  if (currentStatus === 'shipped') {
    return {
      ok: true,
      alreadyStarted: true,
      trackingCode: String(row.tracking_code).toUpperCase(),
      orderNumber: row.order_number || null,
    };
  }

  await deps.updateShipped(trackingCode);
  return {
    ok: true,
    alreadyStarted: false,
    trackingCode: String(row.tracking_code).toUpperCase(),
    orderNumber: row.order_number || null,
    startedAt: new Date().toISOString(),
  };
}

/** Marca un envío express como entregado por código LHE (repartidor escanea QR al entregar). */
export async function confirmExpressDeliveryByTrackingCode(
  trackingCodeRaw: string,
  deps: {
    getRow: (code: string) => Promise<{
      external_order_id: string;
      order_number: string | null;
      tracking_code: string;
      manual_status: string | null;
    } | null | undefined>;
    updateDelivered: (code: string) => Promise<void>;
  }
): Promise<ConfirmExpressDeliveryResult> {
  const trackingCode = normalizeTrackingCode(trackingCodeRaw);
  if (!TRACKING_CODE_RE.test(trackingCode)) {
    return { ok: false, reason: 'invalid_code' };
  }

  const row = await deps.getRow(trackingCode);
  if (!row?.tracking_code) {
    return { ok: false, reason: 'not_found' };
  }

  const currentStatus = parseManualStatus(row.manual_status);
  if (currentStatus === 'cancelled') {
    return { ok: false, reason: 'cancelled' };
  }
  if (currentStatus === 'delivered') {
    return {
      ok: true,
      alreadyDelivered: true,
      trackingCode: String(row.tracking_code).toUpperCase(),
      orderNumber: row.order_number || null,
    };
  }
  if (currentStatus !== 'shipped') {
    return { ok: false, reason: 'not_ready' };
  }

  await deps.updateDelivered(trackingCode);
  return {
    ok: true,
    alreadyDelivered: false,
    trackingCode: String(row.tracking_code).toUpperCase(),
    orderNumber: row.order_number || null,
    deliveredAt: new Date().toISOString(),
  };
}
