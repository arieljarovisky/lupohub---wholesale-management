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

const STATUS_RANK: Record<ExpressTrackingStatus, number> = {
  pending: 0,
  preparing: 1,
  shipped: 2,
  delivered: 3,
  cancelled: -1,
};

export type TrackingEvent = { key: string; label: string; at: string | null; done: boolean };

export function isExpressTrackingStatus(value: unknown): value is ExpressTrackingStatus {
  return typeof value === 'string' && (EXPRESS_TRACKING_STATUSES as readonly string[]).includes(value);
}

export function expressTrackingStatusLabel(status: ExpressTrackingStatus): string {
  return EXPRESS_TRACKING_STATUS_LABELS[status] || status;
}

export function publicStatusFromManualStatus(status: ExpressTrackingStatus): {
  status: ExpressTrackingStatus;
  statusLabel: string;
} {
  return { status, statusLabel: expressTrackingStatusLabel(status) };
}

export function buildManualTrackingEvents(
  manualStatus: ExpressTrackingStatus,
  opts: {
    trackingAssignedAt: string | null;
    manualStatusUpdatedAt?: string | null;
    orderCreatedAt?: string | null;
    orderPaidAt?: string | null;
  }
): TrackingEvent[] {
  const rank = STATUS_RANK[manualStatus];
  const isCancelled = manualStatus === 'cancelled';
  const updatedAt = opts.manualStatusUpdatedAt || null;

  const push = (events: TrackingEvent[], key: string, label: string, at: string | null, done: boolean) => {
    events.push({ key, label, at, done });
  };

  const events: TrackingEvent[] = [];
  push(events, 'created', 'Pedido registrado', opts.orderCreatedAt || null, true);
  push(events, 'tracking', 'Código de seguimiento generado', opts.trackingAssignedAt, !!opts.trackingAssignedAt);
  push(
    events,
    'paid',
    'Pago confirmado',
    opts.orderPaidAt || opts.trackingAssignedAt || null,
    !isCancelled && rank >= STATUS_RANK.preparing
  );
  push(
    events,
    'preparing',
    'En preparación',
    rank >= STATUS_RANK.preparing ? updatedAt || opts.trackingAssignedAt : null,
    !isCancelled && rank >= STATUS_RANK.preparing
  );
  push(
    events,
    'shipped',
    'Despachado',
    rank >= STATUS_RANK.shipped ? updatedAt : null,
    !isCancelled && rank >= STATUS_RANK.shipped
  );
  push(
    events,
    'delivered',
    'Entregado',
    rank >= STATUS_RANK.delivered ? updatedAt : null,
    !isCancelled && rank >= STATUS_RANK.delivered
  );
  if (isCancelled) {
    push(events, 'cancelled', 'Pedido cancelado', updatedAt, true);
  }
  return events;
}
