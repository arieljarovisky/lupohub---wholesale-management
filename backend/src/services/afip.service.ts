/**
 * Servicio de facturación electrónica AFIP usando Afip SDK (app.afipsdk.com).
 * Configuración por variables de entorno:
 * - AFIP_CUIT (obligatorio): TU CUIT 11 dígitos.
 * - AFIP_ACCESS_TOKEN (token de app.afipsdk.com).
 * - Certificado y clave: AFIP_CERT_PATH y AFIP_KEY_PATH (rutas) o AFIP_CERT y AFIP_KEY (PEM en env).
 * - AFIP_PTO_VTA (opcional, default 1).
 * - AFIP_PRODUCTION (opcional): "true" para producción, si no es homologación.
 */

import * as fs from 'fs';
import * as path from 'path';
import { todayYmdArgentina } from '../utils/argentinaDate';

const PTO_VTA_DEFAULT = 1;
/** Factura A (CUIT) = 1, Factura B (consumidor final) = 6 */
const TIPO_CBTE_A = 1;
const TIPO_CBTE_B = 6;
/** Nota de Crédito A = 3, Nota de Crédito B = 8 */
const TIPO_NC_A = 3;
const TIPO_NC_B = 8;
/** Nota de Débito A = 2, Nota de Débito B = 7 */
const TIPO_ND_A = 2;
const TIPO_ND_B = 7;
/** DocTipo: 80 = CUIT, 99 = Consumidor final */
const DOC_TIPO_CUIT = 80;
const DOC_TIPO_CF = 99;
/** Concepto: 1 = Productos */
const CONCEPTO_PRODUCTOS = 1;
/** Condición IVA: 1 = IVA Responsable Inscripto, 5 = Consumidor Final */
const IVA_RESPONSABLE_INSCRIPTO = 1;
const CONSUMIDOR_FINAL = 5;
/** Alícuota IVA 21% = Id 5 */
const ID_IVA_21 = 5;
/** Tipo de tributo WSFE: otros / percepción IIBB (ejemplo oficial AfipSDK). */
const TRIBUTO_OTROS_IIBB = 99;
const AFIP_MAX_IMP_NETO = 9_999_999_999_999.99; // 13 enteros + 2 decimales

/**
 * Reintentos ante congestión ARCA/AFIP (503).
 * Tope de espera total: Railway/Vercel cortan ~60s; si superamos eso el proxy devuelve 502
 * sin headers CORS y el navegador muestra "CORS blocked" aunque el origen esté bien configurado.
 */
const AFIP_RETRY_MAX = Math.min(5, Math.max(1, parseInt(process.env.AFIP_RETRY_MAX || '4', 10) || 4));
const AFIP_RETRY_DELAYS_MS = [2000, 4000, 6000, 8000];
/** Debe ser menor que AFIP_ROUTE_TIMEOUT_MS; ARCA en hora pico puede tardar >50s solo en getLastVoucher. */
const AFIP_MAX_WAIT_MS = Math.min(
  110_000,
  Math.max(40_000, parseInt(process.env.AFIP_MAX_WAIT_MS || '95000', 10) || 95_000)
);

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAfipTransientError(err: unknown): boolean {
  const e = err as {
    status?: number;
    response?: { status?: number };
    data?: { statusCode?: number; message?: string };
    message?: string;
  };
  const status = e?.status ?? e?.response?.status ?? e?.data?.statusCode;
  if (status === 503 || status === 502 || status === 429) return true;
  const msg = String(e?.data?.message ?? e?.message ?? '').toLowerCase();
  return (
    msg.includes('congestion') ||
    msg.includes('congestionados') ||
    msg.includes('unavailable') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout')
  );
}

function pickAfipText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(pickAfipText).filter((x): x is string => !!x);
    return parts.length ? parts.join(' | ') : null;
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const code = o.Code ?? o.code ?? o.Codigo ?? o.codigo;
    const msg = o.Msg ?? o.msg ?? o.Message ?? o.message;
    if (msg != null || code != null) {
      const msgText = pickAfipText(msg);
      const codeText = pickAfipText(code);
      if (msgText && codeText) return `[${codeText}] ${msgText}`;
      if (msgText) return msgText;
      if (codeText) return `código ${codeText}`;
    }
    for (const key of ['message', 'msg', 'Msg', 'error', 'Error', 'description', 'Description']) {
      const t = pickAfipText(o[key]);
      if (t) return t;
    }
  }
  return null;
}

/** Extrae Observaciones / Errors de una respuesta FECAE completa. */
export function formatAfipObservaciones(res: unknown): string | null {
  if (!res || typeof res !== 'object') return null;
  const r = res as Record<string, unknown>;
  const det =
    (r.FeDetResp as Record<string, unknown> | undefined)?.FECAEDetResponse ??
    r.FECAEDetResponse ??
    r;
  const detObj = Array.isArray(det) ? det[0] : det;
  const obsRoot =
    detObj && typeof detObj === 'object'
      ? (detObj as Record<string, unknown>).Observaciones
      : undefined;
  const obsList =
    obsRoot && typeof obsRoot === 'object'
      ? (obsRoot as Record<string, unknown>).Obs ?? obsRoot
      : undefined;
  const obsText = pickAfipText(obsList);
  if (obsText) return obsText;

  const errRoot = r.Errors ?? r.errors;
  const errList =
    errRoot && typeof errRoot === 'object'
      ? (errRoot as Record<string, unknown>).Err ?? errRoot
      : undefined;
  return pickAfipText(errList);
}

function extractCaeFromAfipResponse(
  res: Record<string, unknown>,
  afip: { ElectronicBilling?: { formatDate?: (d: unknown) => string } }
): { cae: string; caeFchVto: string } {
  const simplifiedCae = res?.CAE ?? res?.cae;
  if (simplifiedCae) {
    return {
      cae: String(simplifiedCae),
      caeFchVto: String(res?.CAEFchVto ?? res?.CAE_FchVto ?? '')
    };
  }
  const detRaw = (res?.FeDetResp as Record<string, unknown> | undefined)?.FECAEDetResponse;
  const det = (Array.isArray(detRaw) ? detRaw[0] : detRaw) as Record<string, unknown> | undefined;
  const cae = det?.CAE ?? det?.cae;
  const rawVto = det?.CAEFchVto ?? det?.CAE_FchVto ?? '';
  let caeFchVto = String(rawVto || '');
  if (caeFchVto && /^\d{8}$/.test(caeFchVto) && typeof afip?.ElectronicBilling?.formatDate === 'function') {
    try {
      caeFchVto = afip.ElectronicBilling.formatDate(caeFchVto);
    } catch {
      /* keep raw */
    }
  }
  return { cae: cae ? String(cae) : '', caeFchVto };
}

/** Mensaje legible para el usuario (ARCA congestionado, etc.). */
export function formatAfipError(err: unknown): string {
  const e = err as {
    data?: unknown;
    message?: unknown;
    status?: number;
    statusText?: string;
    response?: { data?: unknown; status?: number; statusText?: string };
  };

  const data = e?.data ?? e?.response?.data;
  const fromData = pickAfipText(data);
  if (fromData) {
    if (
      fromData.includes('503') ||
      fromData.toLowerCase().includes('congestion') ||
      fromData.toLowerCase().includes('arca')
    ) {
      return 'Los servidores de ARCA están congestionados. Espere unos minutos e intente nuevamente.';
    }
    return fromData;
  }

  const msg = pickAfipText(e?.message) || '';
  if (msg && msg !== 'undefined' && msg !== '[object Object]') {
    if (msg.includes('503') || msg.toLowerCase().includes('congestion') || msg.toLowerCase().includes('arca')) {
      return 'Los servidores de ARCA están congestionados. Espere unos minutos e intente nuevamente.';
    }
    return msg;
  }

  const status = e?.status ?? e?.response?.status;
  const statusText = e?.statusText ?? e?.response?.statusText;
  if (status) {
    return `Error comunicándose con AFIP (HTTP ${status}${statusText ? ` ${statusText}` : ''}). Reintentá en unos minutos; si persiste, revisá token/certificado AFIP en Railway.`;
  }

  try {
    const raw = JSON.stringify(err);
    if (raw && raw !== '{}' && raw !== 'null') {
      return `Error comunicándose con AFIP: ${raw.slice(0, 280)}`;
    }
  } catch {
    /* ignore */
  }
  return 'Error comunicándose con AFIP';
}

export function afipEmitHttpStatusFromMessage(msg: string): number {
  const m = (msg || '').toLowerCase();
  if (m.includes('no configurado')) return 503;
  if (m.includes('ya tiene')) return 409;
  if (m.includes('superó el tiempo') || m.includes('tiempo máximo del servidor') || m.includes('tardó demasiado')) {
    return 504;
  }
  if (
    m.includes('congestion') ||
    m.includes('congestionados') ||
    m.includes('arca') ||
    m.includes('espere unos minutos')
  ) {
    return 503;
  }
  return 500;
}

async function withAfipRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + AFIP_MAX_WAIT_MS;
  let lastErr: unknown;
  for (let attempt = 0; attempt < AFIP_RETRY_MAX; attempt++) {
    if (Date.now() >= deadline) break;
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isAfipTransientError(err) || attempt >= AFIP_RETRY_MAX - 1) break;
      const delay = Math.min(AFIP_RETRY_DELAYS_MS[attempt] ?? 8000, deadline - Date.now());
      if (delay <= 0) break;
      console.warn(
        `[AFIP] ${label}: intento ${attempt + 1}/${AFIP_RETRY_MAX} falló (${formatAfipError(err)}). Reintento en ${delay}ms…`
      );
      await sleepMs(delay);
    }
  }
  const base = formatAfipError(lastErr);
  if (Date.now() >= deadline && isAfipTransientError(lastErr)) {
    throw new Error(
      `${base} La emisión tardó demasiado (límite ${Math.round(AFIP_MAX_WAIT_MS / 1000)}s). Reintentá en unos minutos; si el pedido no tiene factura en LupoHub, AFIP pudo no haberla registrado.`
    );
  }
  throw new Error(base);
}

export interface OrderForAfip {
  id: string;
  date: string | Date;
  total: number;
  customerId: string;
  /**
   * Percepción IIBB (padrón AGIP): si viene con importe > 0 se informa en AFIP (ImpTrib + Tributos Id 99)
   * y debe coincidir con lo guardado en `invoices.agip_*`.
   */
  iibbPercepcion?: {
    baseImp: number;
    alicuota: number;
    importe: number;
  } | null;
}

export interface CustomerForAfip {
  id: string;
  businessName: string;
  cuit?: string | null;
  /** Descripción de la condición frente al IVA del cliente (ej. Responsable Inscripto, Monotributo, Exento, Consumidor Final). */
  condicionIva?: string | null;
}

export interface InvoiceResult {
  cae: string;
  caeFchVto: string;
  puntoVta: number;
  cbteTipo: number;
  cbteDesde: number;
  cbteHasta: number;
}

export type AfipConfig = {
  cuit: number;
  puntoVta: number;
  accessToken?: string;
  cert?: string;
  key?: string;
  production: boolean;
};

function readCertOrKey(envVar: string, value: string, description: string): string {
  let p = value.trim();
  if (!p) throw new Error(`${envVar} está vacío.`);
  // Para plataformas como Railway: PEM en una sola línea con \n literal
  if (p.includes('\\n')) p = p.replace(/\\n/g, '\n');
  // Si el valor es el PEM directo (contiene -----BEGIN)
  if (p.includes('-----BEGIN')) return p;
  // Si no, es ruta a archivo
  const resolved = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${description}: archivo no encontrado (${resolved}). Revisá ${envVar}.`);
  }
  return fs.readFileSync(resolved, 'utf8').trim();
}

function normalizePem(value: string): string {
  let p = value.trim();
  if (p.includes('\\n')) p = p.replace(/\\n/g, '\n');
  return p;
}

function getConfig(): AfipConfig {
  const cuit = process.env.AFIP_CUIT;
  if (!cuit) {
    throw new Error('AFIP no configurado. Definí AFIP_CUIT en el servidor (Configuración → Facturación).');
  }
  const cuitNum = parseInt(String(cuit).replace(/\D/g, ''), 10);
  if (isNaN(cuitNum) || String(cuitNum).length !== 11) {
    throw new Error('AFIP_CUIT debe ser un CUIT de 11 dígitos.');
  }
  const puntoVta = parseInt(process.env.AFIP_PTO_VTA || String(PTO_VTA_DEFAULT), 10) || PTO_VTA_DEFAULT;
  const production = process.env.AFIP_PRODUCTION === 'true' || process.env.AFIP_PRODUCTION === '1';

  const accessToken = process.env.AFIP_ACCESS_TOKEN?.trim();
  const certPath = process.env.AFIP_CERT_PATH?.trim();
  const keyPath = process.env.AFIP_KEY_PATH?.trim();
  const certEnv = process.env.AFIP_CERT?.trim();
  const keyEnv = process.env.AFIP_KEY?.trim();

  let cert: string | undefined;
  let key: string | undefined;
  if (certEnv && keyEnv) {
    cert = normalizePem(certEnv);
    key = normalizePem(keyEnv);
  } else if (certPath && keyPath) {
    cert = readCertOrKey('AFIP_CERT_PATH', certPath, 'Certificado');
    key = readCertOrKey('AFIP_KEY_PATH', keyPath, 'Clave privada');
  }

  if (accessToken && cert && key) {
    return { cuit: cuitNum, puntoVta, accessToken, cert, key, production };
  }
  if (accessToken) {
    throw new Error(
      'AFIP: para emitir facturas el SDK requiere certificado y clave. Definí AFIP_CERT_PATH y AFIP_KEY_PATH (rutas a .crt y .key) o AFIP_CERT y AFIP_KEY con el PEM en las variables de entorno (ej. en Railway).'
    );
  }
  if (cert && key) {
    return { cuit: cuitNum, puntoVta, cert, key, production };
  }
  throw new Error(
    'AFIP: definí AFIP_ACCESS_TOKEN (app.afipsdk.com) y además AFIP_CERT_PATH+AFIP_KEY_PATH o AFIP_CERT+AFIP_KEY. Ver docs/FACTURACION.md.'
  );
}

/** Verifica si AFIP está configurado (para mostrar u ocultar botón en el front). */
export function isAfipConfigured(): boolean {
  if (!process.env.AFIP_CUIT) return false;
  const hasToken = !!process.env.AFIP_ACCESS_TOKEN?.trim();
  const hasCertPaths = !!process.env.AFIP_CERT_PATH?.trim() && !!process.env.AFIP_KEY_PATH?.trim();
  const hasCertEnv = !!process.env.AFIP_CERT?.trim() && !!process.env.AFIP_KEY?.trim();
  return hasToken && (hasCertPaths || hasCertEnv);
}

/** Indica si la app está configurada para facturar en producción AFIP (si no, es homologación). */
export function isAfipProduction(): boolean {
  return process.env.AFIP_PRODUCTION === 'true' || process.env.AFIP_PRODUCTION === '1';
}

/** Datos del emisor para mostrar en la factura (desde env). El front puede usarlos si no tiene remitente en localStorage. */
export function getAfipIssuerData(): { cuit: string; businessName?: string; address?: string; city?: string } | null {
  const cuit = process.env.AFIP_CUIT?.trim();
  if (!cuit) return null;
  const cuitSolo = cuit.replace(/\D/g, '');
  if (cuitSolo.length !== 11) return null;
  return {
    cuit: cuitSolo,
    businessName: process.env.AFIP_RAZON_SOCIAL?.trim() || undefined,
    address: process.env.AFIP_ADDRESS?.trim() || undefined,
    city: process.env.AFIP_CITY?.trim() || undefined
  };
}

/**
 * Emite una factura electrónica en AFIP por el pedido dado.
 * Regla (si no se fuerza tipo):
 * - Responsable Inscripto => Factura A
 * - Otros (Monotributo, Exento, CF, etc.) => Factura B
 * @param forceCbteTipo - Si es 1 o 6, se usa ese tipo (A o B) en lugar de calcular por cliente.
 */
export async function emitirFactura(order: OrderForAfip, customer: CustomerForAfip, forceCbteTipo?: 1 | 6): Promise<InvoiceResult> {
  const config = getConfig();
  const { cuit, puntoVta } = config;

  const cuitCliente = customer.cuit ? String(customer.cuit).replace(/\D/g, '') : '';
  const tieneCuit = cuitCliente.length >= 10; // CUIT 11 dígitos, CUIL 10–11

  const condicionIvaDesc = (customer.condicionIva ?? '').toLowerCase();
  const esResponsableInscripto =
    condicionIvaDesc.includes('responsable inscripto') && !condicionIvaDesc.includes('no inscripto');

  let tipoCbte: number;
  if (forceCbteTipo === TIPO_CBTE_A || forceCbteTipo === TIPO_CBTE_B) {
    tipoCbte = forceCbteTipo;
  } else {
    tipoCbte = tieneCuit && esResponsableInscripto ? TIPO_CBTE_A : TIPO_CBTE_B;
  }

  let docTipo: number;
  let docNro: number;
  let condicionIva: number;
  if (tipoCbte === TIPO_CBTE_A) {
    if (!tieneCuit) throw new Error('Para Factura A el cliente debe tener CUIT cargado.');
    docTipo = DOC_TIPO_CUIT;
    docNro = parseInt(cuitCliente, 10);
    condicionIva = IVA_RESPONSABLE_INSCRIPTO;
  } else {
    // Factura B: AFIP 10243 solo acepta condiciones válidas para clase B (4, 5, 7, 8, 9, 10, 15). No 1 ni 6.
    docTipo = tieneCuit ? DOC_TIPO_CUIT : DOC_TIPO_CF;
    docNro = tieneCuit ? parseInt(cuitCliente, 10) : 0;
    if (!tieneCuit) {
      condicionIva = CONSUMIDOR_FINAL;
    } else if (condicionIvaDesc.includes('exento')) {
      condicionIva = 4; // IVA Sujeto Exento
    } else if (condicionIvaDesc.includes('no categorizado')) {
      condicionIva = 7; // Sujeto No Categorizado
    } else if (condicionIvaDesc.includes('consumidor final')) {
      condicionIva = CONSUMIDOR_FINAL;
    } else if (condicionIvaDesc.includes('no alcanzado')) {
      condicionIva = 15; // IVA No Alcanzado
    } else {
      // Monotributo, RI y resto: para Factura B usar 5 (CF) por restricción AFIP
      condicionIva = CONSUMIDOR_FINAL;
    }
  }

  const { orderGrossToAfipNeto } = await import('../config/orderPricing');
  const impNeto = orderGrossToAfipNeto(Number(order.total));
  if (impNeto <= 0) throw new Error('El total neto del pedido debe ser mayor a 0.');
  if (impNeto > AFIP_MAX_IMP_NETO) {
    throw new Error(
      `El total neto (${impNeto.toFixed(2)}) supera el máximo permitido por AFIP para un comprobante (${AFIP_MAX_IMP_NETO.toFixed(2)}).`
    );
  }
  const impIva = Math.round(impNeto * 0.21 * 100) / 100;

  const perc = order.iibbPercepcion;
  const rawTrib =
    perc != null && perc !== undefined ? Number((perc as { importe?: unknown }).importe) : 0;
  const impTributo =
    Number.isFinite(rawTrib) && rawTrib > 0.005 ? Math.round(rawTrib * 100) / 100 : 0;
  const rawBase = perc != null ? Number((perc as { baseImp?: unknown }).baseImp) : 0;
  const baseIibb =
    Number.isFinite(rawBase) && rawBase > 0 ? Math.round(rawBase * 100) / 100 : impNeto;
  const rawAlic = perc != null ? Number((perc as { alicuota?: unknown }).alicuota) : 0;
  const alicuotaIibb =
    impTributo > 0 && Number.isFinite(rawAlic) ? Math.round(rawAlic * 100) / 100 : 0;
  const total = Math.round((impNeto + impIva + impTributo) * 100) / 100;

  // Fecha del comprobante = fecha de emisión (hoy en Argentina), no la fecha del pedido
  const dateStr = todayYmdArgentina();
  const fecha = dateStr.replace(/-/g, '');
  const cbteFch = parseInt(fecha, 10);
  if (isNaN(cbteFch) || fecha.length !== 8) {
    throw new Error('Fecha inválida para AFIP.');
  }

  let Afip: any;
  try {
    Afip = (await import('@afipsdk/afip.js')).default;
  } catch {
    throw new Error('Paquete AFIP no instalado. Ejecutá: npm install @afipsdk/afip.js');
  }

  const afipOptions: Record<string, unknown> = {
    CUIT: cuit,
    production: config.production
  };
  if (config.accessToken) afipOptions.access_token = config.accessToken;
  if (config.cert && config.key) {
    afipOptions.cert = config.cert;
    afipOptions.key = config.key;
  }
  const afip = new Afip(afipOptions);
  const ambiente = config.production ? 'producción' : 'homologación';
  console.log(`[AFIP] Emitiendo factura en ambiente: ${ambiente}. Pto.Vta ${puntoVta}, Tipo ${tipoCbte}`);

  const lastVoucher = Number(
    await withAfipRetry('getLastVoucher factura', () =>
      afip.ElectronicBilling.getLastVoucher(puntoVta, tipoCbte) as Promise<number>
    )
  );
  const numeroFactura = lastVoucher + 1;

  const data: Record<string, unknown> = {
    CantReg: 1,
    PtoVta: puntoVta,
    CbteTipo: tipoCbte,
    Concepto: CONCEPTO_PRODUCTOS,
    DocTipo: docTipo,
    DocNro: docNro,
    CbteDesde: numeroFactura,
    CbteHasta: numeroFactura,
    CbteFch: cbteFch,
    FchServDesde: null,
    FchServHasta: null,
    FchVtoPago: null,
    ImpTotal: total,
    ImpTotConc: 0,
    ImpNeto: impNeto,
    ImpOpEx: 0,
    ImpIVA: impIva,
    ImpTrib: impTributo,
    MonId: 'PES',
    MonCotiz: 1,
    CondicionIVAReceptorId: condicionIva,
    Iva: [
      { Id: ID_IVA_21, BaseImp: impNeto, Importe: impIva }
    ]
  };

  if (impTributo > 0) {
    // Id 99 = otros / percepción IIBB (ejemplo oficial AfipSDK). Descripción en castellano sin caracteres raros.
    data.Tributos = [
      {
        Id: TRIBUTO_OTROS_IIBB,
        Desc: 'Ingresos Brutos',
        BaseImp: baseIibb,
        Alic: alicuotaIibb,
        Importe: impTributo
      }
    ];
    console.log(
      `[AFIP] Factura con percepción IIBB: ImpNeto=${impNeto} ImpIVA=${impIva} ImpTrib=${impTributo} ImpTotal=${total} BaseIIBB=${baseIibb} Alic=${alicuotaIibb}%`
    );
  }

  const res = (await withAfipRetry('createVoucher factura', () =>
    afip.ElectronicBilling.createVoucher(data, true)
  )) as Record<string, unknown>;
  const { cae, caeFchVto } = extractCaeFromAfipResponse(res, afip);

  if (!cae) {
    const obs = formatAfipObservaciones(res);
    throw new Error(
      obs
        ? `AFIP rechazó el comprobante: ${obs}`
        : 'AFIP no devolvió CAE. Revisá los datos del comprobante y el estado del servicio.'
    );
  }

  return {
    cae: String(cae),
    caeFchVto: String(caeFchVto),
    puntoVta,
    cbteTipo: tipoCbte,
    cbteDesde: numeroFactura,
    cbteHasta: numeroFactura
  };
}

/** Datos de la factura original a la que se asocia la nota de crédito */
export interface FacturaOriginalForNC {
  puntoVta: number;
  cbteTipo: number;
  cbteDesde: number;
}

/**
 * Emite una Nota de Crédito en AFIP asociada a una factura existente.
 * @param facturaOriginal - Factura que se está creditando (Pto.Vta, Tipo, Nro)
 * @param customer - Cliente (mismo que la factura)
 * @param amountToCredit - Monto neto a creditar (sin IVA). Se calcula IVA 21% internamente.
 * @param iibbPercepcion - Si la factura original tenía percepción IIBB en AFIP (`invoices.agip_*`), debe informarse igual en la NC (ImpTrib + Tributos Id 99).
 */
export async function emitirNotaCredito(
  facturaOriginal: FacturaOriginalForNC,
  customer: CustomerForAfip,
  amountToCredit: number,
  iibbPercepcion?: { baseImp: number; alicuota: number; importe: number } | null
): Promise<InvoiceResult> {
  const config = getConfig();
  const { cuit, puntoVta } = config;

  const cuitCliente = customer.cuit ? String(customer.cuit).replace(/\D/g, '') : '';
  const tieneCuit = cuitCliente.length >= 10;

  // Tipo de nota de crédito según tipo de FACTURA original:
  // - Factura A (1)  -> NC A (3)
  // - Factura B (6)  -> NC B (8)
  const tipoFacturaOriginal = facturaOriginal.cbteTipo;
  let tipoCbte: number;
  if (tipoFacturaOriginal === TIPO_CBTE_A) {
    tipoCbte = TIPO_NC_A;
  } else if (tipoFacturaOriginal === TIPO_CBTE_B) {
    tipoCbte = TIPO_NC_B;
  } else {
    // Fallback: si por algún motivo viene otro tipo, usamos NC B (más permisiva) para evitar error 10040,
    // siempre asociada al tipo real de la factura en CbtesAsoc.
    tipoCbte = TIPO_NC_B;
  }

  // DocTipo / DocNro iguales que en factura
  const docTipo = tieneCuit ? DOC_TIPO_CUIT : DOC_TIPO_CF;
  const docNro = tieneCuit ? parseInt(cuitCliente, 10) : 0;

  // Condición IVA según tipo de comprobante (AFIP 10243: debe ser válida para la clase de comprobante)
  const condicionIvaDesc = (customer.condicionIva ?? '').toLowerCase();
  let condicionIva: number;
  if (tipoCbte === TIPO_NC_A) {
    // NC A: receptor Responsable Inscripto, exige CUIT
    if (!tieneCuit) {
      throw new Error('Para Nota de Crédito A el cliente debe tener CUIT cargado.');
    }
    condicionIva = IVA_RESPONSABLE_INSCRIPTO;
  } else {
    // NC B: solo 4, 5, 7, 8, 9, 10, 15. 1 y 6 no son válidos.
    if (!tieneCuit) {
      condicionIva = CONSUMIDOR_FINAL;
    } else if (condicionIvaDesc.includes('exento')) {
      condicionIva = 4; // IVA Sujeto Exento
    } else if (condicionIvaDesc.includes('no categorizado')) {
      condicionIva = 7; // Sujeto No Categorizado
    } else if (condicionIvaDesc.includes('consumidor final')) {
      condicionIva = CONSUMIDOR_FINAL;
    } else if (condicionIvaDesc.includes('no alcanzado')) {
      condicionIva = 15; // IVA No Alcanzado
    } else {
      // Monotributo, RI u otros: usar 5 (CF) para cumplir validación AFIP en NC B
      condicionIva = CONSUMIDOR_FINAL;
    }
  }

  const impNetoRaw = Number(amountToCredit);
  const impNeto = Math.round((Number.isFinite(impNetoRaw) ? impNetoRaw : 0) * 100) / 100;
  if (impNeto <= 0) throw new Error('El monto neto a creditar debe ser mayor a 0.');
  if (impNeto > AFIP_MAX_IMP_NETO) {
    throw new Error(
      `El monto neto de la nota de crédito (${impNeto.toFixed(2)}) supera el máximo permitido por AFIP (${AFIP_MAX_IMP_NETO.toFixed(2)}).`
    );
  }
  const impIva = Math.round(impNeto * 0.21 * 100) / 100;

  const perc = iibbPercepcion;
  const rawTrib =
    perc != null && perc !== undefined ? Number((perc as { importe?: unknown }).importe) : 0;
  const impTributo =
    Number.isFinite(rawTrib) && rawTrib > 0.005 ? Math.round(rawTrib * 100) / 100 : 0;
  const rawBase = perc != null ? Number((perc as { baseImp?: unknown }).baseImp) : 0;
  const baseIibb =
    Number.isFinite(rawBase) && rawBase > 0 ? Math.round(rawBase * 100) / 100 : impNeto;
  const rawAlic = perc != null ? Number((perc as { alicuota?: unknown }).alicuota) : 0;
  const alicuotaIibb =
    impTributo > 0 && Number.isFinite(rawAlic) ? Math.round(rawAlic * 100) / 100 : 0;
  const total = Math.round((impNeto + impIva + impTributo) * 100) / 100;

  const dateStr = todayYmdArgentina();
  const fecha = dateStr.replace(/-/g, '');
  const cbteFch = parseInt(fecha, 10);

  let Afip: any;
  try {
    Afip = (await import('@afipsdk/afip.js')).default;
  } catch {
    throw new Error('Paquete AFIP no instalado. Ejecutá: npm install @afipsdk/afip.js');
  }

  const afipOptions: Record<string, unknown> = {
    CUIT: cuit,
    production: config.production
  };
  if (config.accessToken) afipOptions.access_token = config.accessToken;
  if (config.cert && config.key) {
    afipOptions.cert = config.cert;
    afipOptions.key = config.key;
  }
  const afip = new Afip(afipOptions);
  const ambiente = config.production ? 'producción' : 'homologación';
  console.log(`[AFIP] Emitiendo nota de crédito en ambiente: ${ambiente}. Pto.Vta ${puntoVta}, Tipo ${tipoCbte}`);

  const lastVoucher = Number(
    await withAfipRetry('getLastVoucher NC', () =>
      afip.ElectronicBilling.getLastVoucher(puntoVta, tipoCbte) as Promise<number>
    )
  );
  const numeroNC = lastVoucher + 1;

  const data: Record<string, unknown> = {
    CantReg: 1,
    PtoVta: puntoVta,
    CbteTipo: tipoCbte,
    Concepto: CONCEPTO_PRODUCTOS,
    DocTipo: docTipo,
    DocNro: docNro,
    CbteDesde: numeroNC,
    CbteHasta: numeroNC,
    CbteFch: cbteFch,
    FchServDesde: null,
    FchServHasta: null,
    FchVtoPago: null,
    ImpTotal: total,
    ImpTotConc: 0,
    ImpNeto: impNeto,
    ImpOpEx: 0,
    ImpIVA: impIva,
    ImpTrib: impTributo,
    MonId: 'PES',
    MonCotiz: 1,
    CondicionIVAReceptorId: condicionIva,
    // AFIP exige tipo de comprobante asociado en formato válido (ej. "01", "06"). Código 10040 si el tipo es inválido.
    CbtesAsoc: [
      {
        Tipo: String(facturaOriginal.cbteTipo).padStart(2, '0'),
        PtoVta: facturaOriginal.puntoVta,
        Nro: facturaOriginal.cbteDesde
      }
    ],
    Iva: [
      { Id: ID_IVA_21, BaseImp: impNeto, Importe: impIva }
    ]
  };

  if (impTributo > 0) {
    data.Tributos = [
      {
        Id: TRIBUTO_OTROS_IIBB,
        Desc: 'Ingresos Brutos',
        BaseImp: baseIibb,
        Alic: alicuotaIibb,
        Importe: impTributo
      }
    ];
    console.log(
      `[AFIP] Nota de crédito con percepción IIBB: ImpNeto=${impNeto} ImpIVA=${impIva} ImpTrib=${impTributo} ImpTotal=${total} BaseIIBB=${baseIibb} Alic=${alicuotaIibb}%`
    );
  }

  const res = (await withAfipRetry('createVoucher NC', () =>
    afip.ElectronicBilling.createVoucher(data, true)
  )) as Record<string, unknown>;
  const { cae, caeFchVto } = extractCaeFromAfipResponse(res, afip);

  if (!cae) {
    const obs = formatAfipObservaciones(res);
    throw new Error(
      obs
        ? `AFIP rechazó la Nota de Crédito: ${obs}`
        : 'AFIP no devolvió CAE para la Nota de Crédito.'
    );
  }

  return {
    cae: String(cae),
    caeFchVto: String(caeFchVto),
    puntoVta,
    cbteTipo: tipoCbte,
    cbteDesde: numeroNC,
    cbteHasta: numeroNC
  };
}

function resolveCondicionIvaForNotaAsociada(
  tipoCbte: number,
  tieneCuit: boolean,
  condicionIvaDesc: string
): number {
  const isClaseA = tipoCbte === TIPO_NC_A || tipoCbte === TIPO_ND_A;
  if (isClaseA) {
    if (!tieneCuit) {
      throw new Error('Para comprobante clase A el cliente debe tener CUIT cargado.');
    }
    return IVA_RESPONSABLE_INSCRIPTO;
  }
  if (!tieneCuit) return CONSUMIDOR_FINAL;
  if (condicionIvaDesc.includes('exento')) return 4;
  if (condicionIvaDesc.includes('no categorizado')) return 7;
  if (condicionIvaDesc.includes('consumidor final')) return CONSUMIDOR_FINAL;
  if (condicionIvaDesc.includes('no alcanzado')) return 15;
  return CONSUMIDOR_FINAL;
}

/**
 * Emite una Nota de Débito en AFIP asociada a una factura existente.
 * @param facturaOriginal - Factura a la que se asocia la ND
 * @param customer - Cliente (mismo que la factura)
 * @param amountToDebit - Monto neto a debitar (sin IVA). Puede ser 0 si solo se informa percepción IIBB.
 * @param iibbPercepcion - Percepción IIBB a informar en AFIP (ImpTrib + Tributos Id 99).
 */
export async function emitirNotaDebito(
  facturaOriginal: FacturaOriginalForNC,
  customer: CustomerForAfip,
  amountToDebit: number,
  iibbPercepcion?: { baseImp: number; alicuota: number; importe: number } | null
): Promise<InvoiceResult> {
  const config = getConfig();
  const { cuit, puntoVta } = config;

  const cuitCliente = customer.cuit ? String(customer.cuit).replace(/\D/g, '') : '';
  const tieneCuit = cuitCliente.length >= 10;

  const tipoFacturaOriginal = facturaOriginal.cbteTipo;
  let tipoCbte: number;
  if (tipoFacturaOriginal === TIPO_CBTE_A) {
    tipoCbte = TIPO_ND_A;
  } else if (tipoFacturaOriginal === TIPO_CBTE_B) {
    tipoCbte = TIPO_ND_B;
  } else {
    tipoCbte = TIPO_ND_B;
  }

  const docTipo = tieneCuit ? DOC_TIPO_CUIT : DOC_TIPO_CF;
  const docNro = tieneCuit ? parseInt(cuitCliente, 10) : 0;

  const condicionIvaDesc = (customer.condicionIva ?? '').toLowerCase();
  const condicionIva = resolveCondicionIvaForNotaAsociada(tipoCbte, tieneCuit, condicionIvaDesc);

  const impNetoRaw = Number(amountToDebit);
  const impNeto = Math.round((Number.isFinite(impNetoRaw) ? impNetoRaw : 0) * 100) / 100;
  if (impNeto < 0) throw new Error('El monto neto a debitar no puede ser negativo.');
  if (impNeto > AFIP_MAX_IMP_NETO) {
    throw new Error(
      `El monto neto de la nota de débito (${impNeto.toFixed(2)}) supera el máximo permitido por AFIP (${AFIP_MAX_IMP_NETO.toFixed(2)}).`
    );
  }
  const impIva = impNeto > 0 ? Math.round(impNeto * 0.21 * 100) / 100 : 0;

  const perc = iibbPercepcion;
  const rawTrib =
    perc != null && perc !== undefined ? Number((perc as { importe?: unknown }).importe) : 0;
  const impTributo =
    Number.isFinite(rawTrib) && rawTrib > 0.005 ? Math.round(rawTrib * 100) / 100 : 0;
  const rawBase = perc != null ? Number((perc as { baseImp?: unknown }).baseImp) : 0;
  const baseIibb =
    Number.isFinite(rawBase) && rawBase > 0
      ? Math.round(rawBase * 100) / 100
      : impNeto > 0
        ? impNeto
        : 0;
  const rawAlic = perc != null ? Number((perc as { alicuota?: unknown }).alicuota) : 0;
  const alicuotaIibb =
    impTributo > 0 && Number.isFinite(rawAlic) ? Math.round(rawAlic * 100) / 100 : 0;
  const total = Math.round((impNeto + impIva + impTributo) * 100) / 100;

  if (!(total > 0.005)) {
    throw new Error('El monto total de la nota de débito debe ser mayor a 0 (neto + IVA y/o percepción IIBB).');
  }

  const dateStr = todayYmdArgentina();
  const fecha = dateStr.replace(/-/g, '');
  const cbteFch = parseInt(fecha, 10);

  let Afip: any;
  try {
    Afip = (await import('@afipsdk/afip.js')).default;
  } catch {
    throw new Error('Paquete AFIP no instalado. Ejecutá: npm install @afipsdk/afip.js');
  }

  const afipOptions: Record<string, unknown> = {
    CUIT: cuit,
    production: config.production
  };
  if (config.accessToken) afipOptions.access_token = config.accessToken;
  if (config.cert && config.key) {
    afipOptions.cert = config.cert;
    afipOptions.key = config.key;
  }
  const afip = new Afip(afipOptions);
  const ambiente = config.production ? 'producción' : 'homologación';
  console.log(`[AFIP] Emitiendo nota de débito en ambiente: ${ambiente}. Pto.Vta ${puntoVta}, Tipo ${tipoCbte}`);

  const lastVoucher = Number(
    await withAfipRetry('getLastVoucher ND', () =>
      afip.ElectronicBilling.getLastVoucher(puntoVta, tipoCbte) as Promise<number>
    )
  );
  const numeroND = lastVoucher + 1;

  const data: Record<string, unknown> = {
    CantReg: 1,
    PtoVta: puntoVta,
    CbteTipo: tipoCbte,
    Concepto: CONCEPTO_PRODUCTOS,
    DocTipo: docTipo,
    DocNro: docNro,
    CbteDesde: numeroND,
    CbteHasta: numeroND,
    CbteFch: cbteFch,
    FchServDesde: null,
    FchServHasta: null,
    FchVtoPago: null,
    ImpTotal: total,
    ImpTotConc: 0,
    ImpNeto: impNeto,
    ImpOpEx: 0,
    ImpIVA: impIva,
    ImpTrib: impTributo,
    MonId: 'PES',
    MonCotiz: 1,
    CondicionIVAReceptorId: condicionIva,
    CbtesAsoc: [
      {
        Tipo: String(facturaOriginal.cbteTipo).padStart(2, '0'),
        PtoVta: facturaOriginal.puntoVta,
        Nro: facturaOriginal.cbteDesde
      }
    ]
  };

  if (impNeto > 0) {
    data.Iva = [{ Id: ID_IVA_21, BaseImp: impNeto, Importe: impIva }];
  }

  if (impTributo > 0) {
    data.Tributos = [
      {
        Id: TRIBUTO_OTROS_IIBB,
        Desc: 'Ingresos Brutos',
        BaseImp: baseIibb > 0 ? baseIibb : impNeto,
        Alic: alicuotaIibb,
        Importe: impTributo
      }
    ];
    console.log(
      `[AFIP] Nota de débito con percepción IIBB: ImpNeto=${impNeto} ImpIVA=${impIva} ImpTrib=${impTributo} ImpTotal=${total} BaseIIBB=${baseIibb} Alic=${alicuotaIibb}%`
    );
  }

  const res = (await withAfipRetry('createVoucher ND', () =>
    afip.ElectronicBilling.createVoucher(data, true)
  )) as Record<string, unknown>;
  const { cae, caeFchVto } = extractCaeFromAfipResponse(res, afip);

  if (!cae) {
    const obs = formatAfipObservaciones(res);
    throw new Error(
      obs
        ? `AFIP rechazó la Nota de Débito: ${obs}`
        : 'AFIP no devolvió CAE para la Nota de Débito.'
    );
  }

  return {
    cae: String(cae),
    caeFchVto: String(caeFchVto),
    puntoVta,
    cbteTipo: tipoCbte,
    cbteDesde: numeroND,
    cbteHasta: numeroND
  };
}

/** Mapeo idImpuesto (Padrón) → descripción condición IVA para el cliente */
const ID_IMPUESTO_A_CONDICION_IVA: Record<number, string> = {
  30: 'IVA Responsable Inscripto',
  20: 'Responsable Monotributo',
  32: 'IVA Sujeto Exento',
  34: 'IVA No Alcanzado'
};

export interface CondicionIvaResult {
  condicionIva: string;
  businessName?: string;
  address?: string;
  city?: string;
}

/**
 * Obtiene la condición frente al IVA (y opcionalmente razón social y domicilio) de un CUIT
 * consultando el Padrón Constancia de Inscripción (getPersona_v2).
 * Requiere tener autorizado el web service "ws_sr_constancia_inscripcion" en producción
 * (además de wsfe); en homologación suele funcionar con el mismo token/cert.
 */
export async function getCondicionIvaByCuit(cuit: string): Promise<CondicionIvaResult> {
  const config = getConfig();
  const cuitClean = String(cuit).replace(/\D/g, '');
  if (cuitClean.length !== 11) {
    throw new Error('El CUIT debe tener 11 dígitos.');
  }
  const idPersona = parseInt(cuitClean, 10);
  if (isNaN(idPersona)) throw new Error('CUIT inválido.');

  let Afip: any;
  try {
    Afip = (await import('@afipsdk/afip.js')).default;
  } catch {
    throw new Error('Paquete AFIP no instalado. Ejecutá: npm install @afipsdk/afip.js');
  }

  const afipOptions: Record<string, unknown> = {
    CUIT: config.cuit,
    production: config.production
  };
  if (config.accessToken) afipOptions.access_token = config.accessToken;
  if (config.cert && config.key) {
    afipOptions.cert = config.cert;
    afipOptions.key = config.key;
  }
  const afip = new Afip(afipOptions);
  const ws = afip.WebService('ws_sr_constancia_inscripcion');
  const raw = await ws.executeRequest('getPersona_v2', {
    cuitRepresentada: config.cuit,
    idPersona
  });

  const pr = raw?.personaReturn ?? raw;
  const errorConstancia = pr?.errorConstancia;
  const errorRegimen = pr?.errorRegimenGeneral;
  const errorMono = pr?.errorMonotributo;
  if (errorConstancia?.mensaje || (Array.isArray(errorConstancia?.error) && errorConstancia.error.length > 0)) {
    const msg = errorConstancia.mensaje || (errorConstancia.error && errorConstancia.error[0]) || 'CUIT no encontrado en AFIP.';
    throw new Error(msg);
  }
  if (errorRegimen?.mensaje || (Array.isArray(errorRegimen?.error) && errorRegimen.error.length > 0)) {
    const msg = errorRegimen.mensaje || (errorRegimen.error && errorRegimen.error[0]) || 'Error régimen general.';
    throw new Error(msg);
  }
  if (errorMono?.mensaje || (Array.isArray(errorMono?.error) && errorMono.error.length > 0)) {
    const msg = errorMono.mensaje || (errorMono.error && errorMono.error[0]) || 'Error monotributo.';
    throw new Error(msg);
  }

  const datosGenerales = pr?.datosGenerales ?? {};
  const businessName = datosGenerales.razonSocial ?? datosGenerales.apellido ?? undefined;
  const domicilio = datosGenerales.domicilioFiscal ?? datosGenerales.dependencia;
  const address = domicilio?.direccion ?? undefined;
  const city = domicilio?.localidad ?? domicilio?.descripcionProvincia ?? undefined;

  let condicionIva = 'Consumidor Final';
  const impuestosRg = pr?.datosRegimenGeneral?.impuesto ?? [];
  const impuestosMono = pr?.datosMonotributo?.impuesto ?? [];
  const todosImpuestos = [...impuestosRg, ...impuestosMono];
  for (const imp of todosImpuestos) {
    const id = imp?.idImpuesto;
    if (id != null && ID_IMPUESTO_A_CONDICION_IVA[id]) {
      condicionIva = ID_IMPUESTO_A_CONDICION_IVA[id];
      break;
    }
  }

  return { condicionIva, businessName, address, city };
}

/**
 * Consulta en AFIP si un comprobante existe (FECompConsultar).
 * Si AFIP responde con datos del comprobante → la factura está registrada.
 * @returns Objeto con existe, datos del comprobante (si existe) y posible error de AFIP.
 */
export function getAfipPuntoVenta(): number {
  return getConfig().puntoVta;
}

/** Último comprobante autorizado en AFIP para punto de venta y tipo. */
export async function getLastAfipVoucherNumber(puntoVta: number, cbteTipo: number): Promise<number> {
  let Afip: any;
  try {
    Afip = (await import('@afipsdk/afip.js')).default;
  } catch {
    throw new Error('Paquete AFIP no instalado. Ejecutá: npm install @afipsdk/afip.js');
  }
  const config = getConfig();
  const afipOptions: Record<string, unknown> = {
    CUIT: config.cuit,
    production: config.production
  };
  if (config.accessToken) afipOptions.access_token = config.accessToken;
  if (config.cert && config.key) {
    afipOptions.cert = config.cert;
    afipOptions.key = config.key;
  }
  const afip = new Afip(afipOptions);
  return withAfipRetry(`getLastVoucher ${puntoVta}/${cbteTipo}`, () =>
    afip.ElectronicBilling.getLastVoucher(puntoVta, cbteTipo) as Promise<number>
  );
}

export async function consultarComprobanteAfip(
  puntoVta: number,
  cbteTipo: number,
  cbteNro: number
): Promise<{ existe: boolean; resultado?: any; error?: string }> {
  const config = getConfig();

  let Afip: any;
  try {
    Afip = (await import('@afipsdk/afip.js')).default;
  } catch {
    throw new Error('Paquete AFIP no instalado. Ejecutá: npm install @afipsdk/afip.js');
  }

  const afipOptions: Record<string, unknown> = {
    CUIT: config.cuit,
    production: config.production
  };
  if (config.accessToken) afipOptions.access_token = config.accessToken;
  if (config.cert && config.key) {
    afipOptions.cert = config.cert;
    afipOptions.key = config.key;
  }
  const afip = new Afip(afipOptions);
  // ElectronicBilling inyecta Auth (Token, Sign, Cuit); el WebService genérico no.
  try {
    const resultGet = await afip.ElectronicBilling.getVoucherInfo(cbteNro, puntoVta, cbteTipo);

    if (resultGet && (resultGet.CodAutorizacion ?? resultGet.codAutorizacion)) {
      return { existe: true, resultado: resultGet };
    }

    return { existe: false, error: 'AFIP no devolvió el comprobante (no existe o no autorizado).' };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg.includes('Auth') || msg.includes('mal formado')) {
      throw new Error('AFIP: credenciales inválidas o token vencido. Reautorizá el servicio wsfe (auth-web-service-prod) en app.afipsdk.com.');
    }
    throw err;
  }
}
