import { Request, Response } from 'express';
import axios from 'axios';
import { get, execute } from '../database/db';
import {
  buildManualTrackingEvents,
  confirmExpressDeliveryByTrackingCode,
  expressTrackingStatusLabel,
  isExpressTrackingStatus,
  publicStatusFromManualStatus,
  startExpressTripByTrackingCode,
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

async function loadTrackingRowByCode(trackingCode: string) {
  return get(
    `SELECT external_order_id, order_number, tracking_code, manual_status, manual_status_updated_at, created_at
     FROM tiendanube_express_tracking
     WHERE UPPER(tracking_code) = ?`,
    [trackingCode]
  );
}

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDeliveryPageHtml(opts: {
  trackingCode: string;
  orderNumber: string;
  destinationCity: string | null;
  customerName: string | null;
  phase: 'ready_to_start' | 'in_transit' | 'delivered' | 'cancelled' | 'invalid' | 'not_found';
  statusLabel?: string | null;
  postUrl: string;
}): string {
  const { trackingCode, orderNumber, destinationCity, customerName, phase, statusLabel, postUrl } = opts;
  const title =
    phase === 'delivered'
      ? 'Entrega confirmada'
      : phase === 'in_transit'
        ? 'Confirmar entrega'
        : phase === 'ready_to_start'
          ? 'Iniciar viaje'
          : phase === 'cancelled'
            ? 'Pedido cancelado'
            : 'Código no válido';

  const bodyContent =
    phase === 'delivered'
      ? `<div class="icon ok">✓</div>
         <p class="lead">El envío <strong>${escHtml(trackingCode)}</strong> ya está marcado como entregado.</p>`
      : phase === 'cancelled'
        ? `<div class="icon warn">!</div>
           <p class="lead">Este pedido fue cancelado y no puede gestionarse desde el QR.</p>`
        : phase === 'not_found' || phase === 'invalid'
          ? `<div class="icon warn">?</div>
             <p class="lead">No encontramos un envío con ese código. Verificá que el QR sea de una etiqueta express válida.</p>`
          : `<p class="lead">Pedido <strong>#${escHtml(orderNumber)}</strong></p>
             ${customerName ? `<p class="meta">${escHtml(customerName)}</p>` : ''}
             ${destinationCity ? `<p class="meta">${escHtml(destinationCity)}</p>` : ''}
             <p class="code">${escHtml(trackingCode)}</p>
             ${statusLabel ? `<p class="status-pill">${escHtml(statusLabel)}</p>` : ''}
             ${
               phase === 'ready_to_start'
                 ? `<button type="button" class="btn btn-start" id="actionBtn" data-action="start">Iniciar viaje</button>
                    <p class="hint" id="hint">Al salir del depósito, iniciá el viaje para avisar al cliente que el pedido está en camino.</p>`
                 : `<button type="button" class="btn btn-deliver" id="actionBtn" data-action="deliver">Confirmar entrega</button>
                    <p class="hint" id="hint">Al entregar el paquete al cliente, confirmá para cerrar el envío.</p>`
             }
             <div class="result" id="result" hidden></div>`;

  const script =
    phase === 'ready_to_start' || phase === 'in_transit'
      ? `<script>
(function () {
  var btn = document.getElementById('actionBtn');
  var hint = document.getElementById('hint');
  var result = document.getElementById('result');
  if (!btn) return;
  var defaultLabel = btn.textContent;
  btn.addEventListener('click', function () {
    var action = btn.getAttribute('data-action') || 'deliver';
    btn.disabled = true;
    btn.textContent = action === 'start' ? 'Iniciando…' : 'Confirmando…';
    hint.textContent = '';
    fetch(${JSON.stringify(postUrl)}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.data && res.data.message ? res.data.message : 'No se pudo completar la acción');
        result.hidden = false;
        result.className = 'result ok';
        if (action === 'start') {
          result.innerHTML = '<strong>✓ Viaje iniciado</strong><br/>El pedido figura en camino. Volvé a escanear al entregar.';
          btn.setAttribute('data-action', 'deliver');
          btn.textContent = 'Confirmar entrega';
          btn.className = 'btn btn-deliver';
          btn.disabled = false;
          document.querySelector('.status-pill').textContent = 'En camino';
          document.title = 'En camino';
          hint.textContent = 'Cuando entregues el paquete, tocá confirmar entrega.';
          hint.style.color = '#64748b';
        } else {
          result.innerHTML = '<strong>✓ Entrega confirmada</strong><br/>El envío quedó cerrado correctamente.';
          btn.style.display = 'none';
          document.title = 'Entrega confirmada';
        }
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = defaultLabel;
        hint.textContent = err.message || 'Error. Intentá de nuevo.';
        hint.style.color = '#fca5a5';
      });
  });
})();
</script>`
      : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${escHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      background: linear-gradient(160deg, #0f172a 0%, #1e293b 100%);
      color: #f8fafc; display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    .card {
      width: 100%; max-width: 400px; background: rgba(15,23,42,0.92); border: 1px solid rgba(148,163,184,0.25);
      border-radius: 20px; padding: 24px 20px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.35);
    }
    .brand { font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: #94a3b8; margin-bottom: 8px; }
    h1 { margin: 0 0 16px; font-size: 22px; font-weight: 800; }
    .lead { margin: 0 0 8px; font-size: 16px; line-height: 1.45; color: #e2e8f0; }
    .meta { margin: 4px 0; font-size: 14px; color: #94a3b8; }
    .code { margin: 14px 0 10px; font-family: ui-monospace, monospace; font-size: 18px; font-weight: 800; letter-spacing: 0.08em; color: #67e8f9; }
    .status-pill {
      display: inline-block; margin: 0 0 16px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700;
      background: rgba(56,189,248,0.15); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.35);
    }
    .btn {
      width: 100%; border: none; border-radius: 14px; padding: 16px 20px; font-size: 17px; font-weight: 800;
      color: #fff; cursor: pointer;
    }
    .btn-start {
      background: linear-gradient(135deg, #0284c7, #0ea5e9);
      box-shadow: 0 8px 24px rgba(14,165,233,0.35);
    }
    .btn-deliver {
      background: linear-gradient(135deg, #059669, #10b981);
      box-shadow: 0 8px 24px rgba(16,185,129,0.35);
    }
    .btn:disabled { opacity: 0.65; cursor: wait; }
    .hint { margin: 12px 0 0; font-size: 12px; color: #64748b; line-height: 1.4; }
    .icon { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 900; }
    .icon.ok { background: rgba(16,185,129,0.2); color: #34d399; }
    .icon.warn { background: rgba(245,158,11,0.2); color: #fbbf24; }
    .result { margin-top: 16px; padding: 12px; border-radius: 12px; font-size: 14px; line-height: 1.45; }
    .result.ok { background: rgba(16,185,129,0.15); border: 1px solid rgba(52,211,153,0.35); color: #a7f3d0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">Envío express</div>
    <h1>${escHtml(title)}</h1>
    ${bodyContent}
  </div>
  ${script}
</body>
</html>`;
}

/**
 * Página móvil para repartidor: escanea QR para iniciar viaje o confirmar entrega.
 * GET /api/public/entrega/:trackingCode
 */
export const getPublicDeliveryPage = async (req: Request, res: Response) => {
  const trackingCode = normalizeTrackingCodeInput(req.params.trackingCode);
  const postUrl = `/api/public/entrega/${encodeURIComponent(trackingCode)}`;

  if (!trackingCode) {
    return res.status(400).send(buildDeliveryPageHtml({
      trackingCode: '',
      orderNumber: '',
      destinationCity: null,
      customerName: null,
      phase: 'invalid',
      postUrl,
    }));
  }
  if (!isValidTrackingCode(trackingCode)) {
    return res.status(400).send(buildDeliveryPageHtml({
      trackingCode,
      orderNumber: '',
      destinationCity: null,
      customerName: null,
      phase: 'invalid',
      postUrl,
    }));
  }

  try {
    const row = await loadTrackingRowByCode(trackingCode);
    if (!row?.tracking_code) {
      return res.status(404).send(buildDeliveryPageHtml({
        trackingCode,
        orderNumber: '',
        destinationCity: null,
        customerName: null,
        phase: 'not_found',
        postUrl,
      }));
    }

    const manualStatus = isExpressTrackingStatus(row.manual_status) ? row.manual_status : 'preparing';
    if (manualStatus === 'cancelled') {
      return res.status(400).send(buildDeliveryPageHtml({
        trackingCode: String(row.tracking_code).toUpperCase(),
        orderNumber: String(row.order_number || ''),
        destinationCity: null,
        customerName: null,
        phase: 'cancelled',
        postUrl,
      }));
    }
    if (manualStatus === 'delivered') {
      return res.send(buildDeliveryPageHtml({
        trackingCode: String(row.tracking_code).toUpperCase(),
        orderNumber: String(row.order_number || ''),
        destinationCity: null,
        customerName: null,
        phase: 'delivered',
        postUrl,
      }));
    }

    let destinationCity: string | null = null;
    let customerName: string | null = null;
    try {
      const order = await fetchTiendaNubeOrder(String(row.external_order_id));
      destinationCity = publicCityFromOrder(order);
      customerName = String(order.shipping_address?.name || order.contact_name || '').trim() || null;
    } catch {
      /* datos TN opcionales para la pantalla */
    }

    const phase = manualStatus === 'shipped' ? 'in_transit' : 'ready_to_start';
    const statusLabel = expressTrackingStatusLabel(manualStatus);

    return res.send(buildDeliveryPageHtml({
      trackingCode: String(row.tracking_code).toUpperCase(),
      orderNumber: String(row.order_number || ''),
      destinationCity,
      customerName,
      phase,
      statusLabel,
      postUrl,
    }));
  } catch (error: any) {
    console.error('getPublicDeliveryPage:', error?.message || error);
    return res.status(500).send(buildDeliveryPageHtml({
      trackingCode,
      orderNumber: '',
      destinationCity: null,
      customerName: null,
      phase: 'not_found',
      postUrl,
    }));
  }
};

/**
 * Acción del repartidor vía QR: iniciar viaje o confirmar entrega.
 * POST /api/public/entrega/:trackingCode  body: { action: "start" | "deliver" }
 */
export const confirmPublicDelivery = async (req: Request, res: Response) => {
  const trackingCode = normalizeTrackingCodeInput(req.params.trackingCode);
  const action = String((req.body as any)?.action || 'deliver').toLowerCase();
  if (!trackingCode) {
    return res.status(400).json({ message: 'Código de seguimiento requerido' });
  }
  if (action !== 'start' && action !== 'deliver') {
    return res.status(400).json({ message: 'Acción inválida. Usá "start" o "deliver".' });
  }

  try {
    if (action === 'start') {
      const result = await startExpressTripByTrackingCode(trackingCode, {
        getRow: async (code) => loadTrackingRowByCode(code),
        updateShipped: async (code) => {
          await execute(
            `UPDATE tiendanube_express_tracking
             SET manual_status = 'shipped', manual_status_updated_at = NOW()
             WHERE UPPER(tracking_code) = ?`,
            [code]
          );
        },
      });

      if (!result.ok) {
        const messages: Record<string, string> = {
          invalid_code: 'Código de seguimiento inválido',
          not_found: 'No encontramos ese código de seguimiento',
          cancelled: 'Este pedido está cancelado',
          already_delivered: 'Este envío ya fue entregado',
        };
        const status = result.reason === 'not_found' ? 404 : 400;
        return res.status(status).json({ message: messages[result.reason] || 'No se pudo iniciar el viaje' });
      }

      return res.json({
        ok: true,
        action: 'start',
        alreadyStarted: result.alreadyStarted,
        trackingCode: result.trackingCode,
        orderNumber: result.orderNumber,
        startedAt: result.alreadyStarted ? null : result.startedAt,
        status: 'shipped',
        statusLabel: expressTrackingStatusLabel('shipped'),
      });
    }

    const result = await confirmExpressDeliveryByTrackingCode(trackingCode, {
      getRow: async (code) => loadTrackingRowByCode(code),
      updateDelivered: async (code) => {
        await execute(
          `UPDATE tiendanube_express_tracking
           SET manual_status = 'delivered', manual_status_updated_at = NOW()
           WHERE UPPER(tracking_code) = ?`,
          [code]
        );
      },
    });

    if (!result.ok) {
      const messages: Record<string, string> = {
        invalid_code: 'Código de seguimiento inválido',
        not_found: 'No encontramos ese código de seguimiento',
        cancelled: 'Este pedido está cancelado',
        not_ready: 'Primero iniciá el viaje escaneando el QR al salir del depósito',
      };
      const status = result.reason === 'not_found' ? 404 : 400;
      return res.status(status).json({ message: messages[result.reason] || 'No se pudo confirmar la entrega' });
    }

    return res.json({
      ok: true,
      action: 'deliver',
      alreadyDelivered: result.alreadyDelivered,
      trackingCode: result.trackingCode,
      orderNumber: result.orderNumber,
      deliveredAt: result.alreadyDelivered ? null : result.deliveredAt,
      status: 'delivered',
      statusLabel: expressTrackingStatusLabel('delivered'),
    });
  } catch (error: any) {
    console.error('confirmPublicDelivery:', error?.message || error);
    return res.status(500).json({ message: 'Error al procesar la acción del repartidor' });
  }
};
