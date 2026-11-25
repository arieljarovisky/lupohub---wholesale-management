/**
 * Cuándo una cancelación de Mercado Libre devuelve stock.
 *
 * Si la mercadería nunca salió del depósito, la cancelación la repone al toque.
 * Si ya salió (devolución), el stock vuelve recién cuando Mercado Libre la entrega
 * en el domicilio del vendedor. Llegar al depósito de Mercado Libre no alcanza:
 * puede haber un segundo tramo (return_from_triage) hasta el depósito propio.
 */

const low = (v: unknown) => (v == null ? '' : String(v).trim().toLowerCase());

export type ReturnShipmentView = {
  status: string;
  destination: string;
  type: string;
};

export type ReturnView = {
  status: string;
  subtype: string;
  shipments: ReturnShipmentView[];
};

export type MlCancelBecause = 'never_left' | 'back_to_sender' | 'return_arrived' | 'return_in_transit' | 'unknown';

export type MlCancelStockDecision = {
  action: 'revert_now' | 'await_return';
  because: MlCancelBecause;
};

export function orderLooksFulfilled(order: any): boolean {
  const tags = Array.isArray(order?.tags) ? order.tags.map((t: unknown) => low(t)) : [];
  return tags.includes('delivered') || tags.includes('not_delivered');
}

export function outboundLeftWarehouse(shipment: any): boolean {
  if (!shipment) return false;
  const status = low(shipment.status);
  const sub = low(shipment.substatus);
  const hist = shipment.status_history || {};
  if (hist.date_shipped || hist.date_delivered || hist.date_not_delivered || hist.date_returned) return true;
  if (status === 'shipped' || status === 'delivered' || status === 'not_delivered') return true;
  if (status === 'cancelled' && /return|devuel/.test(sub)) return true;
  return false;
}

/** El envío original volvió al vendedor (no entregado y ya devuelto). */
export function outboundBackAtSeller(shipment: any): boolean {
  if (!shipment) return false;
  const sub = low(shipment.substatus);
  const hist = shipment.status_history || {};
  if (hist.date_returned) return true;
  return sub === 'returned' || sub === 'returned_to_sender';
}

export function mapReturnPayload(data: any): ReturnView {
  const rawShips = Array.isArray(data?.shipments) ? data.shipments : data?.shipping ? [data.shipping] : [];
  const shipments: ReturnShipmentView[] = rawShips.map((sh: any) => ({
    status: low(sh?.status),
    destination: low(sh?.destination?.name),
    type: low(sh?.type),
  }));
  return {
    status: low(data?.status),
    subtype: low(data?.subtype),
    shipments,
  };
}

/** La devolución está en el depósito del vendedor, no en un depósito de Mercado Libre. */
export function returnArrivedAtSellerDepot(ret: ReturnView): boolean {
  if (ret.subtype === 'low_cost') return false;
  const sellerLegs = ret.shipments.filter((sh) => sh.destination === 'seller_address' || sh.type === 'return_from_triage');
  if (sellerLegs.length) return sellerLegs.some((sh) => sh.status === 'delivered');
  const onlyMlWarehouse = ret.shipments.length > 0 && ret.shipments.every((sh) => sh.destination === 'warehouse');
  if (onlyMlWarehouse) return false;
  return ret.status === 'delivered';
}

/**
 * `returns === null` significa que no se pudo consultar la devolución.
 * En ese caso, si la mercadería ya salió, no se repone el stock (se reintenta después).
 */
export function decideMlCancelStock(input: {
  outbound: any | null;
  returns: ReturnView[] | null;
}): MlCancelStockDecision {
  if (!outboundLeftWarehouse(input.outbound)) return { action: 'revert_now', because: 'never_left' };
  if (outboundBackAtSeller(input.outbound)) return { action: 'revert_now', because: 'back_to_sender' };
  if (input.returns == null) return { action: 'await_return', because: 'unknown' };
  if (input.returns.some(returnArrivedAtSellerDepot)) return { action: 'revert_now', because: 'return_arrived' };
  return { action: 'await_return', because: 'return_in_transit' };
}
