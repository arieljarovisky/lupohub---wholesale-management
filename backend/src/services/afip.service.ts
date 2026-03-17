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

const PTO_VTA_DEFAULT = 1;
/** Factura A (CUIT) = 1, Factura B (consumidor final) = 6 */
const TIPO_CBTE_A = 1;
const TIPO_CBTE_B = 6;
/** Nota de Crédito A = 3, Nota de Crédito B = 8 */
const TIPO_NC_A = 3;
const TIPO_NC_B = 8;
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

export interface OrderForAfip {
  id: string;
  date: string;
  total: number;
  customerId: string;
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

  const total = Number(order.total) || 0;
  if (total <= 0) throw new Error('El total del pedido debe ser mayor a 0.');

  // IVA 21%: neto = total / 1.21, iva = total - neto
  const impNeto = Math.round((total / 1.21) * 100) / 100;
  const impIva = Math.round((total - impNeto) * 100) / 100;

  const dateVal = order.date as string | Date;
  const dateStr =
    dateVal instanceof Date
      ? dateVal.toISOString().split('T')[0]
      : typeof dateVal === 'string'
        ? dateVal
        : new Date().toISOString().split('T')[0];
  const fecha = dateStr.replace(/-/g, '');
  const cbteFch = parseInt(fecha, 10);
  if (isNaN(cbteFch) || fecha.length !== 8) {
    throw new Error('Fecha del pedido inválida para AFIP.');
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

  const lastVoucher = await afip.ElectronicBilling.getLastVoucher(puntoVta, tipoCbte);
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
    ImpTrib: 0,
    MonId: 'PES',
    MonCotiz: 1,
    CondicionIVAReceptorId: condicionIva,
    Iva: [
      { Id: ID_IVA_21, BaseImp: impNeto, Importe: impIva }
    ]
  };

  const res = await afip.ElectronicBilling.createVoucher(data);
  const cae = res?.CAE ?? res?.cae;
  const caeFchVto = res?.CAEFchVto ?? res?.CAE_FchVto ?? '';

  if (!cae) {
    throw new Error('AFIP no devolvió CAE. Revisá los datos del comprobante y el estado del servicio.');
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
 * @param amountToCredit - Monto total a creditar (incluye IVA)
 */
export async function emitirNotaCredito(
  facturaOriginal: FacturaOriginalForNC,
  customer: CustomerForAfip,
  amountToCredit: number
): Promise<InvoiceResult> {
  const config = getConfig();
  const { cuit, puntoVta } = config;

  const cuitCliente = customer.cuit ? String(customer.cuit).replace(/\D/g, '') : '';
  const tieneCuit = cuitCliente.length >= 10;
  const tipoCbte = tieneCuit ? TIPO_NC_A : TIPO_NC_B;
  const docTipo = tieneCuit ? DOC_TIPO_CUIT : DOC_TIPO_CF;
  const docNro = tieneCuit ? parseInt(cuitCliente, 10) : 0;
  // Condición IVA según tipo de comprobante (AFIP 10243: debe ser válida para la clase de comprobante; FEParamGetCondicionIvaReceptor)
  // NC A: solo 1 (Responsable Inscripto). NC B: solo 4, 5, 7, 8, 9, 10, 15 (no 1 ni 6).
  const condicionIvaDesc = (customer.condicionIva ?? '').toLowerCase();
  let condicionIva: number;
  if (tipoCbte === TIPO_NC_A) {
    condicionIva = IVA_RESPONSABLE_INSCRIPTO; // NC A siempre receptor RI
  } else {
    // NC B: solo condiciones válidas para comprobante clase B/C (4, 5, 7, 8, 9, 10, 15). 6 (Monotributo) y 1 (RI) no son válidas.
    if (condicionIvaDesc.includes('exento')) condicionIva = 4; // IVA Sujeto Exento
    else if (condicionIvaDesc.includes('no categorizado')) condicionIva = 7; // Sujeto No Categorizado
    else if (condicionIvaDesc.includes('consumidor final')) condicionIva = CONSUMIDOR_FINAL;
    else if (condicionIvaDesc.includes('no alcanzado')) condicionIva = 15; // IVA No Alcanzado
    else condicionIva = CONSUMIDOR_FINAL; // Monotributo, RI y resto -> 5 (CF) para NC B
  }

  const total = Number(amountToCredit) || 0;
  if (total <= 0) throw new Error('El monto a creditar debe ser mayor a 0.');

  const impNeto = Math.round((total / 1.21) * 100) / 100;
  const impIva = Math.round((total - impNeto) * 100) / 100;

  const dateStr = new Date().toISOString().split('T')[0];
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

  const lastVoucher = await afip.ElectronicBilling.getLastVoucher(puntoVta, tipoCbte);
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
    ImpTrib: 0,
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

  const res = await afip.ElectronicBilling.createVoucher(data);
  const cae = res?.CAE ?? res?.cae;
  const caeFchVto = res?.CAEFchVto ?? res?.CAE_FchVto ?? '';

  if (!cae) {
    throw new Error('AFIP no devolvió CAE para la Nota de Crédito.');
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
