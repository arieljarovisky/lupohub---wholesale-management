import { Request, Response } from 'express';
import axios from 'axios';
import { getValidMLToken } from './integrations.controller';

const ML_API = 'https://api.mercadolibre.com';

function authHeaders(token: string, formatNew = false): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (formatNew) headers['x-format-new'] = 'true';
  return headers;
}

/** Saca del texto escaneado los códigos que pueden ser envío, venta o tracking. */
export function extractMlScanCandidates(raw: string): string[] {
  const text = String(raw || '').trim();
  if (!text) return [];
  const out: string[] = [];
  const push = (value: string) => {
    const s = String(value || '').trim();
    if (s.length < 6 || s.length > 40) return;
    if (!out.includes(s)) out.push(s);
  };

  const compact = text.replace(/\s+/g, '');
  push(compact);

  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      url.searchParams.forEach((value) => push(value));
      url.pathname.split('/').forEach((part) => push(part));
    } catch {
      /* no es una URL usable */
    }
  }

  const digitRuns = text.match(/\d{8,20}/g) || [];
  digitRuns.forEach(push);

  const digits = text.replace(/\D/g, '');
  if (digits !== compact) push(digits);

  text.split(/[^A-Za-z0-9]+/).forEach(push);

  return out.slice(0, 8);
}

async function mlGet(token: string, path: string, formatNew = false): Promise<any | null> {
  try {
    const res = await axios.get(`${ML_API}${path}`, {
      headers: authHeaders(token, formatNew),
      validateStatus: () => true,
      timeout: 15000,
    });
    if (res.status === 200 && res.data) return res.data;
    return null;
  } catch {
    return null;
  }
}

async function getShipment(token: string, id: string): Promise<any | null> {
  if (!/^\d{6,20}$/.test(id)) return null;
  const direct = await mlGet(token, `/shipments/${id}`, true);
  if (direct?.id) return direct;
  const marketplace = await mlGet(token, `/marketplace/shipments/${id}`, true);
  if (marketplace?.id) return marketplace;
  return null;
}

async function getOrder(token: string, id: string): Promise<any | null> {
  if (!/^\d{6,20}$/.test(id)) return null;
  const order = await mlGet(token, `/orders/${id}`);
  if (order?.id) return order;
  return null;
}

async function searchOrders(token: string, sellerId: string, q: string): Promise<any[]> {
  const query = q.trim();
  if (query.length < 6) return [];
  try {
    const res = await axios.get(`${ML_API}/orders/search`, {
      headers: authHeaders(token),
      params: { seller: sellerId, q: query, limit: 10 },
      validateStatus: () => true,
      timeout: 20000,
    });
    if (res.status !== 200) return [];
    return Array.isArray(res.data?.results) ? res.data.results : [];
  } catch {
    return [];
  }
}

function readReceiver(shipment: any) {
  const dest = shipment?.destination?.shipping_address || shipment?.receiver_address || {};
  const name =
    shipment?.destination?.receiver_name ||
    dest.receiver_name ||
    shipment?.receiver_address?.receiver_name ||
    '';
  const street =
    [dest.street_name, dest.street_number].filter(Boolean).join(' ').trim() ||
    dest.address_line ||
    '';
  const cityName = dest.city?.name || (typeof dest.city === 'string' ? dest.city : '');
  const stateName = dest.state?.name || (typeof dest.state === 'string' ? dest.state : '');
  return {
    name: String(name || '').trim(),
    street: String(street || '').trim(),
    city: String(cityName || '').trim(),
    state: String(stateName || '').trim(),
    zip: String(dest.zip_code || '').trim(),
    comment: String(dest.comment || '').trim(),
  };
}

function logisticLabel(type: string): string {
  const labels: Record<string, string> = {
    self_service: 'Flex',
    drop_off: 'Mercado Envíos',
    cross_docking: 'Colecta',
    xd_drop_off: 'Mercado Envíos Places',
    fulfillment: 'Full',
  };
  return labels[type] || (type ? type : 'Envío');
}

function mapOrderItems(order: any) {
  return (order?.order_items || []).map((item: any) => {
    const attrs = Array.isArray(item?.item?.variation_attributes) ? item.item.variation_attributes : [];
    const variation = attrs
      .map((attr: any) => String(attr?.value_name || '').trim())
      .filter(Boolean)
      .join(' · ');
    return {
      id: item?.item?.id || '',
      title: item?.item?.title || 'Producto',
      sku: item?.item?.seller_sku || item?.item?.seller_custom_field || '',
      quantity: Number(item?.quantity) || 0,
      unitPrice: Number(item?.unit_price) || 0,
      variation,
    };
  });
}

function mapOrder(order: any) {
  return {
    id: Number(order.id),
    status: String(order.status || ''),
    total: Number(order.total_amount) || 0,
    currency: String(order.currency_id || 'ARS'),
    dateCreated: order.date_created || null,
    packId: order.pack_id ? Number(order.pack_id) : null,
    items: mapOrderItems(order),
  };
}

function mapBuyer(order: any) {
  if (!order?.buyer) return null;
  return {
    id: order.buyer.id ?? null,
    nickname: order.buyer.nickname || '',
    firstName: order.buyer.first_name || '',
    lastName: order.buyer.last_name || '',
  };
}

async function orderIdsForShipment(token: string, shipment: any): Promise<string[]> {
  const ids = new Set<string>();
  if (shipment?.order_id) ids.add(String(shipment.order_id));
  const shipmentId = shipment?.id;
  if (shipmentId) {
    const items = await mlGet(token, `/shipments/${shipmentId}/items`, true);
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item?.order_id) ids.add(String(item.order_id));
      }
    }
  }
  return Array.from(ids);
}

async function expandPackOrders(token: string, orders: any[]): Promise<any[]> {
  const packId = orders.map((order) => order?.pack_id).find(Boolean);
  if (!packId) return orders;
  const pack = await mlGet(token, `/packs/${packId}`);
  const packOrderIds: string[] = Array.isArray(pack?.orders)
    ? pack.orders.map((order: any) => String(order?.id || '')).filter(Boolean)
    : [];
  if (packOrderIds.length <= 1) return orders;
  const loaded = await Promise.all(packOrderIds.map((id) => getOrder(token, id)));
  const merged = loaded.filter(Boolean);
  return merged.length ? merged : orders;
}

function pickSearchHit(results: any[], code: string): any | null {
  if (!results.length) return null;
  const exact = results.find((order) => {
    const shippingId = order?.shipping?.id != null ? String(order.shipping.id) : '';
    return String(order?.id) === code || shippingId === code || String(order?.pack_id || '') === code;
  });
  if (exact) return exact;
  if (results.length === 1) return results[0];
  return null;
}

export const scanMercadoLibreLabel = async (req: Request, res: Response) => {
  try {
    const scannedCode = String(req.query.code || '').trim();
    if (scannedCode.length < 6) {
      return res.status(400).json({ message: 'Escaneá o pegá el código de la etiqueta (mínimo 6 caracteres).' });
    }

    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o el token no es válido.' });
    }

    const candidates = extractMlScanCandidates(scannedCode);
    let shipment: any = null;
    let seedOrder: any = null;

    for (const candidate of candidates) {
      shipment = await getShipment(mlToken.access_token, candidate);
      if (shipment) break;
    }

    if (!shipment) {
      for (const candidate of candidates) {
        seedOrder = await getOrder(mlToken.access_token, candidate);
        if (seedOrder) break;
      }
    }

    if (!shipment && !seedOrder) {
      const queries = Array.from(new Set([scannedCode, ...candidates])).slice(0, 4);
      for (const query of queries) {
        const results = await searchOrders(mlToken.access_token, mlToken.user_id, query);
        const hit = pickSearchHit(results, query.replace(/\s+/g, ''));
        if (hit) {
          seedOrder = hit;
          break;
        }
      }
    }

    if (seedOrder && !shipment) {
      const shippingId = seedOrder?.shipping?.id;
      if (shippingId) shipment = await getShipment(mlToken.access_token, String(shippingId));
      if (!shipment && seedOrder?.id) {
        shipment = await mlGet(mlToken.access_token, `/orders/${seedOrder.id}/shipments`, true);
      }
    }

    if (!shipment && !seedOrder) {
      return res.status(404).json({
        message:
          'No encontré una venta con ese código. Escaneá de nuevo el código de la etiqueta, o ingresá el número de envío o de venta.',
      });
    }

    if (shipment && !seedOrder) {
      const orderIds = await orderIdsForShipment(mlToken.access_token, shipment);
      if (orderIds[0]) seedOrder = await getOrder(mlToken.access_token, orderIds[0]);
    }

    if (seedOrder?.id && !Array.isArray(seedOrder.order_items)) {
      const fullOrder = await getOrder(mlToken.access_token, String(seedOrder.id));
      if (fullOrder) seedOrder = fullOrder;
    }

    let orders = seedOrder ? [seedOrder] : [];
    if (shipment) {
      const extraIds = await orderIdsForShipment(mlToken.access_token, shipment);
      for (const id of extraIds) {
        if (orders.some((order) => String(order.id) === id)) continue;
        const loaded = await getOrder(mlToken.access_token, id);
        if (loaded) orders.push(loaded);
      }
    }
    orders = await expandPackOrders(mlToken.access_token, orders);

    const mappedOrders = orders.filter((order) => order?.id).map(mapOrder);
    const currency = mappedOrders[0]?.currency || 'ARS';
    const total = mappedOrders.reduce((sum, order) => sum + order.total, 0);
    const logisticType = String(shipment?.logistic?.type || shipment?.logistic_type || '').trim();

    res.json({
      scannedCode,
      shipment: shipment?.id
        ? {
            id: Number(shipment.id),
            status: String(shipment.status || ''),
            substatus: shipment.substatus ? String(shipment.substatus) : null,
            trackingNumber: shipment.tracking_number ? String(shipment.tracking_number) : null,
            logisticType: logisticType || null,
            logisticLabel: logisticLabel(logisticType),
            receiver: readReceiver(shipment),
          }
        : null,
      buyer: mapBuyer(orders[0]),
      orders: mappedOrders,
      total,
      currency,
    });
  } catch (error: any) {
    console.error('scanMercadoLibreLabel:', error.response?.data || error.message);
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      return res.status(401).json({ message: 'Mercado Libre rechazó el acceso. Reconectá la cuenta en Configuración.' });
    }
    res.status(500).json({ message: 'No se pudo leer la etiqueta de Mercado Libre.' });
  }
};

function mlErrorMessage(data: Buffer): string {
  try {
    const parsed = JSON.parse(data.toString('utf8'));
    const raw = String(parsed?.message || parsed?.error || '').trim();
    if (!raw) return '';
    if (/ready_to_ship|status is not valid|shipment status/i.test(raw)) {
      return 'Mercado Libre no entrega el PDF: el envío no está listo para imprimir la etiqueta. El detalle de la venta sí está disponible.';
    }
    if (/not found|404/i.test(raw)) return 'Mercado Libre no tiene esa etiqueta.';
    return raw;
  } catch {
    return '';
  }
}

export const getMercadoLibreShipmentLabelPdf = async (req: Request, res: Response) => {
  try {
    const shipmentId = String(req.params.shipmentId || '').replace(/\D/g, '');
    if (!shipmentId) return res.status(400).json({ message: 'Falta el número de envío.' });

    const mlToken = await getValidMLToken();
    if (!mlToken) {
      return res.status(400).json({ message: 'No hay integración con Mercado Libre o el token no es válido.' });
    }

    const pdfRes = await axios.get(`${ML_API}/shipment_labels`, {
      headers: authHeaders(mlToken.access_token),
      params: { shipment_ids: shipmentId, response_type: 'pdf' },
      responseType: 'arraybuffer',
      validateStatus: () => true,
      timeout: 30000,
    });

    const buf = Buffer.from(pdfRes.data || []);
    const isPdf = buf.slice(0, 4).toString() === '%PDF';
    if (pdfRes.status !== 200 || !isPdf) {
      const message = mlErrorMessage(buf) || 'Mercado Libre no entregó la etiqueta de este envío.';
      const status = pdfRes.status >= 400 && pdfRes.status < 500 ? pdfRes.status : 502;
      return res.status(status).json({ message });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="etiqueta-ml-${shipmentId}.pdf"`);
    res.send(buf);
  } catch (error: any) {
    console.error('getMercadoLibreShipmentLabelPdf:', error.response?.data || error.message);
    res.status(500).json({ message: 'No se pudo descargar la etiqueta de Mercado Libre.' });
  }
};
