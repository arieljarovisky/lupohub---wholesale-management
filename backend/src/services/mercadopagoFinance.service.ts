import axios from 'axios';
import { get } from '../database/db';

const MP_API = 'https://api.mercadopago.com';
const MAX_PAGES = 80;
const PAGE_SIZE = 100;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dateInRange(iso: string, from: string, to: string): boolean {
  const ymd = iso.slice(0, 10);
  return ymd >= from && ymd <= to;
}

export type MercadoPagoMovement = {
  id: string;
  date: string;
  dateTime: string;
  movementType: 'cobro' | 'reembolso' | 'pendiente' | 'otro';
  direction: 'in' | 'out';
  description: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  status: string;
  paymentMethod: string;
  externalReference: string;
};

export type MercadoPagoMovementsResult = {
  connected: boolean;
  note?: string;
  summary: {
    count: number;
    grossIn: number;
    fees: number;
    refunds: number;
    netIn: number;
  };
  movements: MercadoPagoMovement[];
};

export async function getMercadoPagoAccessToken(): Promise<string | null> {
  const env = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (env) return env;
  try {
    const row = (await get(
      `SELECT access_token FROM integrations WHERE platform = 'mercadopago' LIMIT 1`
    )) as { access_token?: string } | undefined;
    const token = row?.access_token?.trim();
    return token || null;
  } catch {
    return null;
  }
}

function sumPaymentFees(payment: Record<string, unknown>): number {
  const fees = Array.isArray(payment.fee_details) ? payment.fee_details : [];
  return fees.reduce((sum: number, f: Record<string, unknown>) => {
    return sum + Math.abs(Number(f.amount) || 0);
  }, 0);
}

function mapPaymentToMovement(payment: Record<string, unknown>): MercadoPagoMovement | null {
  const status = String(payment.status || '').toLowerCase();
  const dateTime = String(payment.date_approved || payment.date_created || '').trim();
  if (!dateTime) return null;

  if (status === 'cancelled' || status === 'rejected') return null;

  const gross = round2(Math.abs(Number(payment.transaction_amount) || 0));
  if (gross <= 0) return null;

  const feeAmount = round2(sumPaymentFees(payment));
  const netFromApi = Number(
    (payment.transaction_details as Record<string, unknown> | undefined)?.net_received_amount
  );
  const netReceived = Number.isFinite(netFromApi) ? round2(Math.abs(netFromApi)) : round2(Math.max(0, gross - feeAmount));

  const isRefund = status === 'refunded' || status === 'charged_back';
  const isApproved = status === 'approved' || status === 'accredited';

  let movementType: MercadoPagoMovement['movementType'] = 'otro';
  let direction: MercadoPagoMovement['direction'] = 'in';
  let netAmount = netReceived;

  if (isRefund) {
    movementType = 'reembolso';
    direction = 'out';
    netAmount = -gross;
  } else if (isApproved) {
    movementType = 'cobro';
    direction = 'in';
    netAmount = netReceived;
  } else if (status === 'pending' || status === 'in_process' || status === 'in_mediation') {
    movementType = 'pendiente';
    direction = 'in';
    netAmount = gross;
  } else {
    movementType = 'otro';
    direction = 'in';
    netAmount = netReceived;
  }

  const payer = payment.payer as Record<string, unknown> | undefined;
  const descParts = [
    payment.description,
    payer?.email,
    payment.external_reference,
  ]
    .map((x) => (x != null ? String(x).trim() : ''))
    .filter(Boolean);

  return {
    id: String(payment.id ?? ''),
    date: dateTime.slice(0, 10),
    dateTime,
    movementType,
    direction,
    description: descParts.join(' · ') || `Pago MP #${payment.id}`,
    grossAmount: gross,
    feeAmount,
    netAmount,
    status,
    paymentMethod: String(payment.payment_method_id || payment.payment_type_id || ''),
    externalReference: String(payment.external_reference || ''),
  };
}

export async function fetchMercadoPagoMovements(
  from: string,
  to: string
): Promise<MercadoPagoMovementsResult> {
  const token = await getMercadoPagoAccessToken();
  if (!token) {
    return {
      connected: false,
      note: 'Configurá MERCADOPAGO_ACCESS_TOKEN en el backend (token de producción desde developers.mercadopago.com).',
      summary: { count: 0, grossIn: 0, fees: 0, refunds: 0, netIn: 0 },
      movements: [],
    };
  }

  const beginDate = `${from}T00:00:00.000-03:00`;
  const endDate = `${to}T23:59:59.999-03:00`;
  const rawPayments: Record<string, unknown>[] = [];
  let offset = 0;
  let truncated = false;

  while (offset / PAGE_SIZE < MAX_PAGES) {
    const res = await axios.get(`${MP_API}/v1/payments/search`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        sort: 'date_created',
        criteria: 'desc',
        range: 'date_created',
        begin_date: beginDate,
        end_date: endDate,
        offset,
        limit: PAGE_SIZE,
      },
      validateStatus: () => true,
      timeout: 45000,
    });

    if (res.status === 401 || res.status === 403) {
      return {
        connected: false,
        note: 'Token de Mercado Pago inválido o sin permisos. Revisá MERCADOPAGO_ACCESS_TOKEN.',
        summary: { count: 0, grossIn: 0, fees: 0, refunds: 0, netIn: 0 },
        movements: [],
      };
    }

    if (res.status !== 200) {
      const msg =
        (res.data as { message?: string })?.message ||
        (res.data as { error?: string })?.error ||
        `Error ${res.status} consultando Mercado Pago`;
      return {
        connected: true,
        note: msg,
        summary: { count: 0, grossIn: 0, fees: 0, refunds: 0, netIn: 0 },
        movements: [],
      };
    }

    const batch = Array.isArray(res.data?.results) ? res.data.results : [];
    if (batch.length === 0) break;
    rawPayments.push(...batch);

    const total = Number(res.data?.paging?.total ?? 0);
    offset += batch.length;
    if (batch.length < PAGE_SIZE || (total > 0 && offset >= total)) break;
    if (offset >= MAX_PAGES * PAGE_SIZE) {
      truncated = true;
      break;
    }
  }

  const movements: MercadoPagoMovement[] = [];
  for (const payment of rawPayments) {
    const row = mapPaymentToMovement(payment);
    if (!row) continue;
    if (!dateInRange(row.dateTime, from, to)) continue;
    movements.push(row);
  }

  movements.sort((a, b) => b.dateTime.localeCompare(a.dateTime));

  let grossIn = 0;
  let fees = 0;
  let refunds = 0;
  let netIn = 0;

  for (const m of movements) {
    netIn += m.netAmount;
    if (m.direction === 'out') {
      refunds += Math.abs(m.netAmount);
    } else if (m.movementType === 'cobro') {
      grossIn += m.grossAmount;
      fees += m.feeAmount;
    }
  }

  return {
    connected: true,
    note: truncated
      ? `Se listaron los primeros ${MAX_PAGES * PAGE_SIZE} pagos del período. Acotá el rango de fechas si falta información.`
      : 'Cobros y reembolsos desde la API de Mercado Pago (pagos del período).',
    summary: {
      count: movements.length,
      grossIn: round2(grossIn),
      fees: round2(fees),
      refunds: round2(refunds),
      netIn: round2(netIn),
    },
    movements,
  };
}
