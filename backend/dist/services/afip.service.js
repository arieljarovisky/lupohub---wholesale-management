"use strict";
/**
 * Servicio de facturación electrónica AFIP usando Afip SDK (app.afipsdk.com).
 * Configuración por variables de entorno:
 * - AFIP_CUIT (obligatorio): TU CUIT 11 dígitos.
 * - AFIP_ACCESS_TOKEN (token de app.afipsdk.com).
 * - Certificado y clave: AFIP_CERT_PATH y AFIP_KEY_PATH (rutas) o AFIP_CERT y AFIP_KEY (PEM en env).
 * - AFIP_PTO_VTA (opcional, default 1).
 * - AFIP_PRODUCTION (opcional): "true" para producción, si no es homologación.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatAfipError = formatAfipError;
exports.afipEmitHttpStatusFromMessage = afipEmitHttpStatusFromMessage;
exports.isAfipConfigured = isAfipConfigured;
exports.isAfipProduction = isAfipProduction;
exports.getAfipIssuerData = getAfipIssuerData;
exports.emitirFactura = emitirFactura;
exports.emitirNotaCredito = emitirNotaCredito;
exports.getCondicionIvaByCuit = getCondicionIvaByCuit;
exports.consultarComprobanteAfip = consultarComprobanteAfip;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
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
/** Tipo de tributo WSFE: otros / percepción IIBB (ejemplo oficial AfipSDK). */
const TRIBUTO_OTROS_IIBB = 99;
const AFIP_MAX_IMP_NETO = 9999999999999.99; // 13 enteros + 2 decimales
/**
 * Reintentos ante congestión ARCA/AFIP (503).
 * Tope de espera total: Railway/Vercel cortan ~60s; si superamos eso el proxy devuelve 502
 * sin headers CORS y el navegador muestra "CORS blocked" aunque el origen esté bien configurado.
 */
const AFIP_RETRY_MAX = Math.min(5, Math.max(1, parseInt(process.env.AFIP_RETRY_MAX || '4', 10) || 4));
const AFIP_RETRY_DELAYS_MS = [2000, 4000, 6000, 8000];
/** Debe ser menor que AFIP_ROUTE_TIMEOUT_MS; ARCA en hora pico puede tardar >50s solo en getLastVoucher. */
const AFIP_MAX_WAIT_MS = Math.min(110000, Math.max(40000, parseInt(process.env.AFIP_MAX_WAIT_MS || '95000', 10) || 95000));
function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function isAfipTransientError(err) {
    var _a, _b, _c, _d, _e, _f, _g;
    const e = err;
    const status = (_c = (_a = e === null || e === void 0 ? void 0 : e.status) !== null && _a !== void 0 ? _a : (_b = e === null || e === void 0 ? void 0 : e.response) === null || _b === void 0 ? void 0 : _b.status) !== null && _c !== void 0 ? _c : (_d = e === null || e === void 0 ? void 0 : e.data) === null || _d === void 0 ? void 0 : _d.statusCode;
    if (status === 503 || status === 502 || status === 429)
        return true;
    const msg = String((_g = (_f = (_e = e === null || e === void 0 ? void 0 : e.data) === null || _e === void 0 ? void 0 : _e.message) !== null && _f !== void 0 ? _f : e === null || e === void 0 ? void 0 : e.message) !== null && _g !== void 0 ? _g : '').toLowerCase();
    return (msg.includes('congestion') ||
        msg.includes('congestionados') ||
        msg.includes('unavailable') ||
        msg.includes('timeout') ||
        msg.includes('econnreset') ||
        msg.includes('etimedout'));
}
/** Mensaje legible para el usuario (ARCA congestionado, etc.). */
function formatAfipError(err) {
    var _a, _b;
    const e = err;
    const arcMsg = (_a = e === null || e === void 0 ? void 0 : e.data) === null || _a === void 0 ? void 0 : _a.message;
    if (typeof arcMsg === 'string' && arcMsg.trim())
        return arcMsg.trim();
    const msg = String((_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : '').trim();
    if (!msg)
        return 'Error comunicándose con AFIP';
    if (msg.includes('503') || msg.toLowerCase().includes('congestion') || msg.toLowerCase().includes('arca')) {
        return 'Los servidores de ARCA están congestionados. Espere unos minutos e intente nuevamente.';
    }
    return msg;
}
function afipEmitHttpStatusFromMessage(msg) {
    const m = (msg || '').toLowerCase();
    if (m.includes('no configurado'))
        return 503;
    if (m.includes('ya tiene'))
        return 409;
    if (m.includes('superó el tiempo') || m.includes('tiempo máximo del servidor') || m.includes('tardó demasiado')) {
        return 504;
    }
    if (m.includes('congestion') ||
        m.includes('congestionados') ||
        m.includes('arca') ||
        m.includes('espere unos minutos')) {
        return 503;
    }
    return 500;
}
function withAfipRetry(label, fn) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const deadline = Date.now() + AFIP_MAX_WAIT_MS;
        let lastErr;
        for (let attempt = 0; attempt < AFIP_RETRY_MAX; attempt++) {
            if (Date.now() >= deadline)
                break;
            try {
                return yield fn();
            }
            catch (err) {
                lastErr = err;
                if (!isAfipTransientError(err) || attempt >= AFIP_RETRY_MAX - 1)
                    break;
                const delay = Math.min((_a = AFIP_RETRY_DELAYS_MS[attempt]) !== null && _a !== void 0 ? _a : 8000, deadline - Date.now());
                if (delay <= 0)
                    break;
                console.warn(`[AFIP] ${label}: intento ${attempt + 1}/${AFIP_RETRY_MAX} falló (${formatAfipError(err)}). Reintento en ${delay}ms…`);
                yield sleepMs(delay);
            }
        }
        const base = formatAfipError(lastErr);
        if (Date.now() >= deadline && isAfipTransientError(lastErr)) {
            throw new Error(`${base} La emisión tardó demasiado (límite ${Math.round(AFIP_MAX_WAIT_MS / 1000)}s). Reintentá en unos minutos; si el pedido no tiene factura en LupoHub, AFIP pudo no haberla registrado.`);
        }
        throw new Error(base);
    });
}
function readCertOrKey(envVar, value, description) {
    let p = value.trim();
    if (!p)
        throw new Error(`${envVar} está vacío.`);
    // Para plataformas como Railway: PEM en una sola línea con \n literal
    if (p.includes('\\n'))
        p = p.replace(/\\n/g, '\n');
    // Si el valor es el PEM directo (contiene -----BEGIN)
    if (p.includes('-----BEGIN'))
        return p;
    // Si no, es ruta a archivo
    const resolved = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    if (!fs.existsSync(resolved)) {
        throw new Error(`${description}: archivo no encontrado (${resolved}). Revisá ${envVar}.`);
    }
    return fs.readFileSync(resolved, 'utf8').trim();
}
function normalizePem(value) {
    let p = value.trim();
    if (p.includes('\\n'))
        p = p.replace(/\\n/g, '\n');
    return p;
}
function getConfig() {
    var _a, _b, _c, _d, _e;
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
    const accessToken = (_a = process.env.AFIP_ACCESS_TOKEN) === null || _a === void 0 ? void 0 : _a.trim();
    const certPath = (_b = process.env.AFIP_CERT_PATH) === null || _b === void 0 ? void 0 : _b.trim();
    const keyPath = (_c = process.env.AFIP_KEY_PATH) === null || _c === void 0 ? void 0 : _c.trim();
    const certEnv = (_d = process.env.AFIP_CERT) === null || _d === void 0 ? void 0 : _d.trim();
    const keyEnv = (_e = process.env.AFIP_KEY) === null || _e === void 0 ? void 0 : _e.trim();
    let cert;
    let key;
    if (certEnv && keyEnv) {
        cert = normalizePem(certEnv);
        key = normalizePem(keyEnv);
    }
    else if (certPath && keyPath) {
        cert = readCertOrKey('AFIP_CERT_PATH', certPath, 'Certificado');
        key = readCertOrKey('AFIP_KEY_PATH', keyPath, 'Clave privada');
    }
    if (accessToken && cert && key) {
        return { cuit: cuitNum, puntoVta, accessToken, cert, key, production };
    }
    if (accessToken) {
        throw new Error('AFIP: para emitir facturas el SDK requiere certificado y clave. Definí AFIP_CERT_PATH y AFIP_KEY_PATH (rutas a .crt y .key) o AFIP_CERT y AFIP_KEY con el PEM en las variables de entorno (ej. en Railway).');
    }
    if (cert && key) {
        return { cuit: cuitNum, puntoVta, cert, key, production };
    }
    throw new Error('AFIP: definí AFIP_ACCESS_TOKEN (app.afipsdk.com) y además AFIP_CERT_PATH+AFIP_KEY_PATH o AFIP_CERT+AFIP_KEY. Ver docs/FACTURACION.md.');
}
/** Verifica si AFIP está configurado (para mostrar u ocultar botón en el front). */
function isAfipConfigured() {
    var _a, _b, _c, _d, _e;
    if (!process.env.AFIP_CUIT)
        return false;
    const hasToken = !!((_a = process.env.AFIP_ACCESS_TOKEN) === null || _a === void 0 ? void 0 : _a.trim());
    const hasCertPaths = !!((_b = process.env.AFIP_CERT_PATH) === null || _b === void 0 ? void 0 : _b.trim()) && !!((_c = process.env.AFIP_KEY_PATH) === null || _c === void 0 ? void 0 : _c.trim());
    const hasCertEnv = !!((_d = process.env.AFIP_CERT) === null || _d === void 0 ? void 0 : _d.trim()) && !!((_e = process.env.AFIP_KEY) === null || _e === void 0 ? void 0 : _e.trim());
    return hasToken && (hasCertPaths || hasCertEnv);
}
/** Indica si la app está configurada para facturar en producción AFIP (si no, es homologación). */
function isAfipProduction() {
    return process.env.AFIP_PRODUCTION === 'true' || process.env.AFIP_PRODUCTION === '1';
}
/** Datos del emisor para mostrar en la factura (desde env). El front puede usarlos si no tiene remitente en localStorage. */
function getAfipIssuerData() {
    var _a, _b, _c, _d;
    const cuit = (_a = process.env.AFIP_CUIT) === null || _a === void 0 ? void 0 : _a.trim();
    if (!cuit)
        return null;
    const cuitSolo = cuit.replace(/\D/g, '');
    if (cuitSolo.length !== 11)
        return null;
    return {
        cuit: cuitSolo,
        businessName: ((_b = process.env.AFIP_RAZON_SOCIAL) === null || _b === void 0 ? void 0 : _b.trim()) || undefined,
        address: ((_c = process.env.AFIP_ADDRESS) === null || _c === void 0 ? void 0 : _c.trim()) || undefined,
        city: ((_d = process.env.AFIP_CITY) === null || _d === void 0 ? void 0 : _d.trim()) || undefined
    };
}
/**
 * Emite una factura electrónica en AFIP por el pedido dado.
 * Regla (si no se fuerza tipo):
 * - Responsable Inscripto => Factura A
 * - Otros (Monotributo, Exento, CF, etc.) => Factura B
 * @param forceCbteTipo - Si es 1 o 6, se usa ese tipo (A o B) en lugar de calcular por cliente.
 */
function emitirFactura(order, customer, forceCbteTipo) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const config = getConfig();
        const { cuit, puntoVta } = config;
        const cuitCliente = customer.cuit ? String(customer.cuit).replace(/\D/g, '') : '';
        const tieneCuit = cuitCliente.length >= 10; // CUIT 11 dígitos, CUIL 10–11
        const condicionIvaDesc = ((_a = customer.condicionIva) !== null && _a !== void 0 ? _a : '').toLowerCase();
        const esResponsableInscripto = condicionIvaDesc.includes('responsable inscripto') && !condicionIvaDesc.includes('no inscripto');
        let tipoCbte;
        if (forceCbteTipo === TIPO_CBTE_A || forceCbteTipo === TIPO_CBTE_B) {
            tipoCbte = forceCbteTipo;
        }
        else {
            tipoCbte = tieneCuit && esResponsableInscripto ? TIPO_CBTE_A : TIPO_CBTE_B;
        }
        let docTipo;
        let docNro;
        let condicionIva;
        if (tipoCbte === TIPO_CBTE_A) {
            if (!tieneCuit)
                throw new Error('Para Factura A el cliente debe tener CUIT cargado.');
            docTipo = DOC_TIPO_CUIT;
            docNro = parseInt(cuitCliente, 10);
            condicionIva = IVA_RESPONSABLE_INSCRIPTO;
        }
        else {
            // Factura B: AFIP 10243 solo acepta condiciones válidas para clase B (4, 5, 7, 8, 9, 10, 15). No 1 ni 6.
            docTipo = tieneCuit ? DOC_TIPO_CUIT : DOC_TIPO_CF;
            docNro = tieneCuit ? parseInt(cuitCliente, 10) : 0;
            if (!tieneCuit) {
                condicionIva = CONSUMIDOR_FINAL;
            }
            else if (condicionIvaDesc.includes('exento')) {
                condicionIva = 4; // IVA Sujeto Exento
            }
            else if (condicionIvaDesc.includes('no categorizado')) {
                condicionIva = 7; // Sujeto No Categorizado
            }
            else if (condicionIvaDesc.includes('consumidor final')) {
                condicionIva = CONSUMIDOR_FINAL;
            }
            else if (condicionIvaDesc.includes('no alcanzado')) {
                condicionIva = 15; // IVA No Alcanzado
            }
            else {
                // Monotributo, RI y resto: para Factura B usar 5 (CF) por restricción AFIP
                condicionIva = CONSUMIDOR_FINAL;
            }
        }
        // En la app el total del pedido se maneja en neto; para AFIP emitimos total con IVA 21%.
        const impNetoRaw = Number(order.total);
        const impNeto = Math.round((Number.isFinite(impNetoRaw) ? impNetoRaw : 0) * 100) / 100;
        if (impNeto <= 0)
            throw new Error('El total neto del pedido debe ser mayor a 0.');
        if (impNeto > AFIP_MAX_IMP_NETO) {
            throw new Error(`El total neto (${impNeto.toFixed(2)}) supera el máximo permitido por AFIP para un comprobante (${AFIP_MAX_IMP_NETO.toFixed(2)}).`);
        }
        const impIva = Math.round(impNeto * 0.21 * 100) / 100;
        const perc = order.iibbPercepcion;
        const rawTrib = perc != null && perc !== undefined ? Number(perc.importe) : 0;
        const impTributo = Number.isFinite(rawTrib) && rawTrib > 0.005 ? Math.round(rawTrib * 100) / 100 : 0;
        const rawBase = perc != null ? Number(perc.baseImp) : 0;
        const baseIibb = Number.isFinite(rawBase) && rawBase > 0 ? Math.round(rawBase * 100) / 100 : impNeto;
        const rawAlic = perc != null ? Number(perc.alicuota) : 0;
        const alicuotaIibb = impTributo > 0 && Number.isFinite(rawAlic) ? Math.round(rawAlic * 100) / 100 : 0;
        const total = Math.round((impNeto + impIva + impTributo) * 100) / 100;
        // Fecha del comprobante = fecha de emisión (hoy), no la fecha del pedido
        const dateStr = new Date().toISOString().split('T')[0];
        const fecha = dateStr.replace(/-/g, '');
        const cbteFch = parseInt(fecha, 10);
        if (isNaN(cbteFch) || fecha.length !== 8) {
            throw new Error('Fecha inválida para AFIP.');
        }
        let Afip;
        try {
            Afip = (yield Promise.resolve().then(() => __importStar(require('@afipsdk/afip.js')))).default;
        }
        catch (_e) {
            throw new Error('Paquete AFIP no instalado. Ejecutá: npm install @afipsdk/afip.js');
        }
        const afipOptions = {
            CUIT: cuit,
            production: config.production
        };
        if (config.accessToken)
            afipOptions.access_token = config.accessToken;
        if (config.cert && config.key) {
            afipOptions.cert = config.cert;
            afipOptions.key = config.key;
        }
        const afip = new Afip(afipOptions);
        const ambiente = config.production ? 'producción' : 'homologación';
        console.log(`[AFIP] Emitiendo factura en ambiente: ${ambiente}. Pto.Vta ${puntoVta}, Tipo ${tipoCbte}`);
        const lastVoucher = Number(yield withAfipRetry('getLastVoucher factura', () => afip.ElectronicBilling.getLastVoucher(puntoVta, tipoCbte)));
        const numeroFactura = lastVoucher + 1;
        const data = {
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
            console.log(`[AFIP] Factura con percepción IIBB: ImpNeto=${impNeto} ImpIVA=${impIva} ImpTrib=${impTributo} ImpTotal=${total} BaseIIBB=${baseIibb} Alic=${alicuotaIibb}%`);
        }
        const res = (yield withAfipRetry('createVoucher factura', () => afip.ElectronicBilling.createVoucher(data)));
        const cae = (_b = res === null || res === void 0 ? void 0 : res.CAE) !== null && _b !== void 0 ? _b : res === null || res === void 0 ? void 0 : res.cae;
        const caeFchVto = (_d = (_c = res === null || res === void 0 ? void 0 : res.CAEFchVto) !== null && _c !== void 0 ? _c : res === null || res === void 0 ? void 0 : res.CAE_FchVto) !== null && _d !== void 0 ? _d : '';
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
    });
}
/**
 * Emite una Nota de Crédito en AFIP asociada a una factura existente.
 * @param facturaOriginal - Factura que se está creditando (Pto.Vta, Tipo, Nro)
 * @param customer - Cliente (mismo que la factura)
 * @param amountToCredit - Monto neto a creditar (sin IVA). Se calcula IVA 21% internamente.
 * @param iibbPercepcion - Si la factura original tenía percepción IIBB en AFIP (`invoices.agip_*`), debe informarse igual en la NC (ImpTrib + Tributos Id 99).
 */
function emitirNotaCredito(facturaOriginal, customer, amountToCredit, iibbPercepcion) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const config = getConfig();
        const { cuit, puntoVta } = config;
        const cuitCliente = customer.cuit ? String(customer.cuit).replace(/\D/g, '') : '';
        const tieneCuit = cuitCliente.length >= 10;
        // Tipo de nota de crédito según tipo de FACTURA original:
        // - Factura A (1)  -> NC A (3)
        // - Factura B (6)  -> NC B (8)
        const tipoFacturaOriginal = facturaOriginal.cbteTipo;
        let tipoCbte;
        if (tipoFacturaOriginal === TIPO_CBTE_A) {
            tipoCbte = TIPO_NC_A;
        }
        else if (tipoFacturaOriginal === TIPO_CBTE_B) {
            tipoCbte = TIPO_NC_B;
        }
        else {
            // Fallback: si por algún motivo viene otro tipo, usamos NC B (más permisiva) para evitar error 10040,
            // siempre asociada al tipo real de la factura en CbtesAsoc.
            tipoCbte = TIPO_NC_B;
        }
        // DocTipo / DocNro iguales que en factura
        const docTipo = tieneCuit ? DOC_TIPO_CUIT : DOC_TIPO_CF;
        const docNro = tieneCuit ? parseInt(cuitCliente, 10) : 0;
        // Condición IVA según tipo de comprobante (AFIP 10243: debe ser válida para la clase de comprobante)
        const condicionIvaDesc = ((_a = customer.condicionIva) !== null && _a !== void 0 ? _a : '').toLowerCase();
        let condicionIva;
        if (tipoCbte === TIPO_NC_A) {
            // NC A: receptor Responsable Inscripto, exige CUIT
            if (!tieneCuit) {
                throw new Error('Para Nota de Crédito A el cliente debe tener CUIT cargado.');
            }
            condicionIva = IVA_RESPONSABLE_INSCRIPTO;
        }
        else {
            // NC B: solo 4, 5, 7, 8, 9, 10, 15. 1 y 6 no son válidos.
            if (!tieneCuit) {
                condicionIva = CONSUMIDOR_FINAL;
            }
            else if (condicionIvaDesc.includes('exento')) {
                condicionIva = 4; // IVA Sujeto Exento
            }
            else if (condicionIvaDesc.includes('no categorizado')) {
                condicionIva = 7; // Sujeto No Categorizado
            }
            else if (condicionIvaDesc.includes('consumidor final')) {
                condicionIva = CONSUMIDOR_FINAL;
            }
            else if (condicionIvaDesc.includes('no alcanzado')) {
                condicionIva = 15; // IVA No Alcanzado
            }
            else {
                // Monotributo, RI u otros: usar 5 (CF) para cumplir validación AFIP en NC B
                condicionIva = CONSUMIDOR_FINAL;
            }
        }
        const impNetoRaw = Number(amountToCredit);
        const impNeto = Math.round((Number.isFinite(impNetoRaw) ? impNetoRaw : 0) * 100) / 100;
        if (impNeto <= 0)
            throw new Error('El monto neto a creditar debe ser mayor a 0.');
        if (impNeto > AFIP_MAX_IMP_NETO) {
            throw new Error(`El monto neto de la nota de crédito (${impNeto.toFixed(2)}) supera el máximo permitido por AFIP (${AFIP_MAX_IMP_NETO.toFixed(2)}).`);
        }
        const impIva = Math.round(impNeto * 0.21 * 100) / 100;
        const perc = iibbPercepcion;
        const rawTrib = perc != null && perc !== undefined ? Number(perc.importe) : 0;
        const impTributo = Number.isFinite(rawTrib) && rawTrib > 0.005 ? Math.round(rawTrib * 100) / 100 : 0;
        const rawBase = perc != null ? Number(perc.baseImp) : 0;
        const baseIibb = Number.isFinite(rawBase) && rawBase > 0 ? Math.round(rawBase * 100) / 100 : impNeto;
        const rawAlic = perc != null ? Number(perc.alicuota) : 0;
        const alicuotaIibb = impTributo > 0 && Number.isFinite(rawAlic) ? Math.round(rawAlic * 100) / 100 : 0;
        const total = Math.round((impNeto + impIva + impTributo) * 100) / 100;
        const dateStr = new Date().toISOString().split('T')[0];
        const fecha = dateStr.replace(/-/g, '');
        const cbteFch = parseInt(fecha, 10);
        let Afip;
        try {
            Afip = (yield Promise.resolve().then(() => __importStar(require('@afipsdk/afip.js')))).default;
        }
        catch (_e) {
            throw new Error('Paquete AFIP no instalado. Ejecutá: npm install @afipsdk/afip.js');
        }
        const afipOptions = {
            CUIT: cuit,
            production: config.production
        };
        if (config.accessToken)
            afipOptions.access_token = config.accessToken;
        if (config.cert && config.key) {
            afipOptions.cert = config.cert;
            afipOptions.key = config.key;
        }
        const afip = new Afip(afipOptions);
        const ambiente = config.production ? 'producción' : 'homologación';
        console.log(`[AFIP] Emitiendo nota de crédito en ambiente: ${ambiente}. Pto.Vta ${puntoVta}, Tipo ${tipoCbte}`);
        const lastVoucher = Number(yield withAfipRetry('getLastVoucher NC', () => afip.ElectronicBilling.getLastVoucher(puntoVta, tipoCbte)));
        const numeroNC = lastVoucher + 1;
        const data = {
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
            console.log(`[AFIP] Nota de crédito con percepción IIBB: ImpNeto=${impNeto} ImpIVA=${impIva} ImpTrib=${impTributo} ImpTotal=${total} BaseIIBB=${baseIibb} Alic=${alicuotaIibb}%`);
        }
        const res = (yield withAfipRetry('createVoucher NC', () => afip.ElectronicBilling.createVoucher(data)));
        const cae = (_b = res === null || res === void 0 ? void 0 : res.CAE) !== null && _b !== void 0 ? _b : res === null || res === void 0 ? void 0 : res.cae;
        const caeFchVto = (_d = (_c = res === null || res === void 0 ? void 0 : res.CAEFchVto) !== null && _c !== void 0 ? _c : res === null || res === void 0 ? void 0 : res.CAE_FchVto) !== null && _d !== void 0 ? _d : '';
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
    });
}
/** Mapeo idImpuesto (Padrón) → descripción condición IVA para el cliente */
const ID_IMPUESTO_A_CONDICION_IVA = {
    30: 'IVA Responsable Inscripto',
    20: 'Responsable Monotributo',
    32: 'IVA Sujeto Exento',
    34: 'IVA No Alcanzado'
};
/**
 * Obtiene la condición frente al IVA (y opcionalmente razón social y domicilio) de un CUIT
 * consultando el Padrón Constancia de Inscripción (getPersona_v2).
 * Requiere tener autorizado el web service "ws_sr_constancia_inscripcion" en producción
 * (además de wsfe); en homologación suele funcionar con el mismo token/cert.
 */
function getCondicionIvaByCuit(cuit) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        const config = getConfig();
        const cuitClean = String(cuit).replace(/\D/g, '');
        if (cuitClean.length !== 11) {
            throw new Error('El CUIT debe tener 11 dígitos.');
        }
        const idPersona = parseInt(cuitClean, 10);
        if (isNaN(idPersona))
            throw new Error('CUIT inválido.');
        let Afip;
        try {
            Afip = (yield Promise.resolve().then(() => __importStar(require('@afipsdk/afip.js')))).default;
        }
        catch (_o) {
            throw new Error('Paquete AFIP no instalado. Ejecutá: npm install @afipsdk/afip.js');
        }
        const afipOptions = {
            CUIT: config.cuit,
            production: config.production
        };
        if (config.accessToken)
            afipOptions.access_token = config.accessToken;
        if (config.cert && config.key) {
            afipOptions.cert = config.cert;
            afipOptions.key = config.key;
        }
        const afip = new Afip(afipOptions);
        const ws = afip.WebService('ws_sr_constancia_inscripcion');
        const raw = yield ws.executeRequest('getPersona_v2', {
            cuitRepresentada: config.cuit,
            idPersona
        });
        const pr = (_a = raw === null || raw === void 0 ? void 0 : raw.personaReturn) !== null && _a !== void 0 ? _a : raw;
        const errorConstancia = pr === null || pr === void 0 ? void 0 : pr.errorConstancia;
        const errorRegimen = pr === null || pr === void 0 ? void 0 : pr.errorRegimenGeneral;
        const errorMono = pr === null || pr === void 0 ? void 0 : pr.errorMonotributo;
        if ((errorConstancia === null || errorConstancia === void 0 ? void 0 : errorConstancia.mensaje) || (Array.isArray(errorConstancia === null || errorConstancia === void 0 ? void 0 : errorConstancia.error) && errorConstancia.error.length > 0)) {
            const msg = errorConstancia.mensaje || (errorConstancia.error && errorConstancia.error[0]) || 'CUIT no encontrado en AFIP.';
            throw new Error(msg);
        }
        if ((errorRegimen === null || errorRegimen === void 0 ? void 0 : errorRegimen.mensaje) || (Array.isArray(errorRegimen === null || errorRegimen === void 0 ? void 0 : errorRegimen.error) && errorRegimen.error.length > 0)) {
            const msg = errorRegimen.mensaje || (errorRegimen.error && errorRegimen.error[0]) || 'Error régimen general.';
            throw new Error(msg);
        }
        if ((errorMono === null || errorMono === void 0 ? void 0 : errorMono.mensaje) || (Array.isArray(errorMono === null || errorMono === void 0 ? void 0 : errorMono.error) && errorMono.error.length > 0)) {
            const msg = errorMono.mensaje || (errorMono.error && errorMono.error[0]) || 'Error monotributo.';
            throw new Error(msg);
        }
        const datosGenerales = (_b = pr === null || pr === void 0 ? void 0 : pr.datosGenerales) !== null && _b !== void 0 ? _b : {};
        const businessName = (_d = (_c = datosGenerales.razonSocial) !== null && _c !== void 0 ? _c : datosGenerales.apellido) !== null && _d !== void 0 ? _d : undefined;
        const domicilio = (_e = datosGenerales.domicilioFiscal) !== null && _e !== void 0 ? _e : datosGenerales.dependencia;
        const address = (_f = domicilio === null || domicilio === void 0 ? void 0 : domicilio.direccion) !== null && _f !== void 0 ? _f : undefined;
        const city = (_h = (_g = domicilio === null || domicilio === void 0 ? void 0 : domicilio.localidad) !== null && _g !== void 0 ? _g : domicilio === null || domicilio === void 0 ? void 0 : domicilio.descripcionProvincia) !== null && _h !== void 0 ? _h : undefined;
        let condicionIva = 'Consumidor Final';
        const impuestosRg = (_k = (_j = pr === null || pr === void 0 ? void 0 : pr.datosRegimenGeneral) === null || _j === void 0 ? void 0 : _j.impuesto) !== null && _k !== void 0 ? _k : [];
        const impuestosMono = (_m = (_l = pr === null || pr === void 0 ? void 0 : pr.datosMonotributo) === null || _l === void 0 ? void 0 : _l.impuesto) !== null && _m !== void 0 ? _m : [];
        const todosImpuestos = [...impuestosRg, ...impuestosMono];
        for (const imp of todosImpuestos) {
            const id = imp === null || imp === void 0 ? void 0 : imp.idImpuesto;
            if (id != null && ID_IMPUESTO_A_CONDICION_IVA[id]) {
                condicionIva = ID_IMPUESTO_A_CONDICION_IVA[id];
                break;
            }
        }
        return { condicionIva, businessName, address, city };
    });
}
/**
 * Consulta en AFIP si un comprobante existe (FECompConsultar).
 * Si AFIP responde con datos del comprobante → la factura está registrada.
 * @returns Objeto con existe, datos del comprobante (si existe) y posible error de AFIP.
 */
function consultarComprobanteAfip(puntoVta, cbteTipo, cbteNro) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const config = getConfig();
        let Afip;
        try {
            Afip = (yield Promise.resolve().then(() => __importStar(require('@afipsdk/afip.js')))).default;
        }
        catch (_c) {
            throw new Error('Paquete AFIP no instalado. Ejecutá: npm install @afipsdk/afip.js');
        }
        const afipOptions = {
            CUIT: config.cuit,
            production: config.production
        };
        if (config.accessToken)
            afipOptions.access_token = config.accessToken;
        if (config.cert && config.key) {
            afipOptions.cert = config.cert;
            afipOptions.key = config.key;
        }
        const afip = new Afip(afipOptions);
        // ElectronicBilling inyecta Auth (Token, Sign, Cuit); el WebService genérico no.
        try {
            const resultGet = yield afip.ElectronicBilling.getVoucherInfo(cbteNro, puntoVta, cbteTipo);
            if (resultGet && ((_a = resultGet.CodAutorizacion) !== null && _a !== void 0 ? _a : resultGet.codAutorizacion)) {
                return { existe: true, resultado: resultGet };
            }
            return { existe: false, error: 'AFIP no devolvió el comprobante (no existe o no autorizado).' };
        }
        catch (err) {
            const msg = (_b = err === null || err === void 0 ? void 0 : err.message) !== null && _b !== void 0 ? _b : String(err);
            if (msg.includes('Auth') || msg.includes('mal formado')) {
                throw new Error('AFIP: credenciales inválidas o token vencido. Reautorizá el servicio wsfe (auth-web-service-prod) en app.afipsdk.com.');
            }
            throw err;
        }
    });
}
