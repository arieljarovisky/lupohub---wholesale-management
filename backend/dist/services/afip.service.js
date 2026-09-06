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
exports.TIPO_CBTE_E = void 0;
exports.formatAfipObservaciones = formatAfipObservaciones;
exports.formatAfipError = formatAfipError;
exports.afipEmitHttpStatusFromMessage = afipEmitHttpStatusFromMessage;
exports.isAfipConfigured = isAfipConfigured;
exports.isAfipProduction = isAfipProduction;
exports.getAfipIssuerData = getAfipIssuerData;
exports.emitirFactura = emitirFactura;
exports.emitirNotaCredito = emitirNotaCredito;
exports.emitirNotaDebito = emitirNotaDebito;
exports.getCondicionIvaByCuit = getCondicionIvaByCuit;
exports.getAfipPuntoVenta = getAfipPuntoVenta;
exports.getLastAfipVoucherNumber = getLastAfipVoucherNumber;
exports.consultarComprobanteAfip = consultarComprobanteAfip;
exports.getAfipExportPuntoVenta = getAfipExportPuntoVenta;
exports.getWsfexParametros = getWsfexParametros;
exports.getLastExportVoucherNumber = getLastExportVoucherNumber;
exports.getWsfexExportDiagnostico = getWsfexExportDiagnostico;
exports.emitirFacturaExportacion = emitirFacturaExportacion;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const argentinaDate_1 = require("../utils/argentinaDate");
const PTO_VTA_DEFAULT = 1;
/** Punto de venta WSFEX (Factura E). Override con AFIP_PTO_VTA_EXPORT. */
const PTO_VTA_EXPORT_DEFAULT = 10;
/** Moneda por defecto Factura E en LupoHub. */
const MONEDA_EXPORT_DEFAULT = 'PES';
/** Factura A (CUIT) = 1, Factura B (consumidor final) = 6 */
const TIPO_CBTE_A = 1;
const TIPO_CBTE_B = 6;
/** Nota de Crédito A = 3, Nota de Crédito B = 8 */
const TIPO_NC_A = 3;
const TIPO_NC_B = 8;
/** Nota de Débito A = 2, Nota de Débito B = 7 */
const TIPO_ND_A = 2;
const TIPO_ND_B = 7;
/** Factura E (exportación) = 19 — web service WSFEX, no WSFE */
exports.TIPO_CBTE_E = 19;
/** Exportación definitiva de bienes (prendas) */
const TIPO_EXPO_BIENES = 1;
/** Unidad de medida AFIP: unidades */
const PRO_UMED_UNIDADES = 7;
/** Idioma comprobante: español */
const IDIOMA_CBTE_ES = 1;
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
function pickAfipText(value) {
    var _a, _b, _c, _d, _e, _f;
    if (typeof value === 'string' && value.trim())
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    if (Array.isArray(value)) {
        const parts = value.map(pickAfipText).filter((x) => !!x);
        return parts.length ? parts.join(' | ') : null;
    }
    if (value && typeof value === 'object') {
        const o = value;
        const code = (_c = (_b = (_a = o.Code) !== null && _a !== void 0 ? _a : o.code) !== null && _b !== void 0 ? _b : o.Codigo) !== null && _c !== void 0 ? _c : o.codigo;
        const msg = (_f = (_e = (_d = o.Msg) !== null && _d !== void 0 ? _d : o.msg) !== null && _e !== void 0 ? _e : o.Message) !== null && _f !== void 0 ? _f : o.message;
        if (msg != null || code != null) {
            const msgText = pickAfipText(msg);
            const codeText = pickAfipText(code);
            if (msgText && codeText)
                return `[${codeText}] ${msgText}`;
            if (msgText)
                return msgText;
            if (codeText)
                return `código ${codeText}`;
        }
        for (const key of ['message', 'msg', 'Msg', 'error', 'Error', 'description', 'Description']) {
            const t = pickAfipText(o[key]);
            if (t)
                return t;
        }
    }
    return null;
}
/** Extrae Observaciones / Errors de una respuesta FECAE completa. */
function formatAfipObservaciones(res) {
    var _a, _b, _c, _d, _e, _f;
    if (!res || typeof res !== 'object')
        return null;
    const r = res;
    const det = (_c = (_b = (_a = r.FeDetResp) === null || _a === void 0 ? void 0 : _a.FECAEDetResponse) !== null && _b !== void 0 ? _b : r.FECAEDetResponse) !== null && _c !== void 0 ? _c : r;
    const detObj = Array.isArray(det) ? det[0] : det;
    const obsRoot = detObj && typeof detObj === 'object'
        ? detObj.Observaciones
        : undefined;
    const obsList = obsRoot && typeof obsRoot === 'object'
        ? (_d = obsRoot.Obs) !== null && _d !== void 0 ? _d : obsRoot
        : undefined;
    const obsText = pickAfipText(obsList);
    if (obsText)
        return obsText;
    const errRoot = (_e = r.Errors) !== null && _e !== void 0 ? _e : r.errors;
    const errList = errRoot && typeof errRoot === 'object'
        ? (_f = errRoot.Err) !== null && _f !== void 0 ? _f : errRoot
        : undefined;
    return pickAfipText(errList);
}
function extractCaeFromAfipResponse(res, afip) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const simplifiedCae = (_a = res === null || res === void 0 ? void 0 : res.CAE) !== null && _a !== void 0 ? _a : res === null || res === void 0 ? void 0 : res.cae;
    if (simplifiedCae) {
        return {
            cae: String(simplifiedCae),
            caeFchVto: String((_c = (_b = res === null || res === void 0 ? void 0 : res.CAEFchVto) !== null && _b !== void 0 ? _b : res === null || res === void 0 ? void 0 : res.CAE_FchVto) !== null && _c !== void 0 ? _c : '')
        };
    }
    const detRaw = (_d = res === null || res === void 0 ? void 0 : res.FeDetResp) === null || _d === void 0 ? void 0 : _d.FECAEDetResponse;
    const det = (Array.isArray(detRaw) ? detRaw[0] : detRaw);
    const cae = (_e = det === null || det === void 0 ? void 0 : det.CAE) !== null && _e !== void 0 ? _e : det === null || det === void 0 ? void 0 : det.cae;
    const rawVto = (_g = (_f = det === null || det === void 0 ? void 0 : det.CAEFchVto) !== null && _f !== void 0 ? _f : det === null || det === void 0 ? void 0 : det.CAE_FchVto) !== null && _g !== void 0 ? _g : '';
    let caeFchVto = String(rawVto || '');
    if (caeFchVto && /^\d{8}$/.test(caeFchVto) && typeof ((_h = afip === null || afip === void 0 ? void 0 : afip.ElectronicBilling) === null || _h === void 0 ? void 0 : _h.formatDate) === 'function') {
        try {
            caeFchVto = afip.ElectronicBilling.formatDate(caeFchVto);
        }
        catch (_j) {
            /* keep raw */
        }
    }
    return { cae: cae ? String(cae) : '', caeFchVto };
}
/** Mensaje legible para el usuario (ARCA congestionado, etc.). */
function formatAfipError(err) {
    var _a, _b, _c, _d, _e, _f;
    const e = err;
    const data = (_a = e === null || e === void 0 ? void 0 : e.data) !== null && _a !== void 0 ? _a : (_b = e === null || e === void 0 ? void 0 : e.response) === null || _b === void 0 ? void 0 : _b.data;
    const fromData = pickAfipText(data);
    if (fromData) {
        if (fromData.includes('503') ||
            fromData.toLowerCase().includes('congestion') ||
            fromData.toLowerCase().includes('arca')) {
            return 'Los servidores de ARCA están congestionados. Espere unos minutos e intente nuevamente.';
        }
        return fromData;
    }
    const msg = pickAfipText(e === null || e === void 0 ? void 0 : e.message) || '';
    if (msg && msg !== 'undefined' && msg !== '[object Object]') {
        if (msg.includes('503') || msg.toLowerCase().includes('congestion') || msg.toLowerCase().includes('arca')) {
            return 'Los servidores de ARCA están congestionados. Espere unos minutos e intente nuevamente.';
        }
        return msg;
    }
    const status = (_c = e === null || e === void 0 ? void 0 : e.status) !== null && _c !== void 0 ? _c : (_d = e === null || e === void 0 ? void 0 : e.response) === null || _d === void 0 ? void 0 : _d.status;
    const statusText = (_e = e === null || e === void 0 ? void 0 : e.statusText) !== null && _e !== void 0 ? _e : (_f = e === null || e === void 0 ? void 0 : e.response) === null || _f === void 0 ? void 0 : _f.statusText;
    if (status) {
        return `Error comunicándose con AFIP (HTTP ${status}${statusText ? ` ${statusText}` : ''}). Reintentá en unos minutos; si persiste, revisá token/certificado AFIP en Railway.`;
    }
    try {
        const raw = JSON.stringify(err);
        if (raw && raw !== '{}' && raw !== 'null') {
            return `Error comunicándose con AFIP: ${raw.slice(0, 280)}`;
        }
    }
    catch (_g) {
        /* ignore */
    }
    return 'Error comunicándose con AFIP';
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
        var _a;
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
        const { orderGrossToAfipNeto } = yield Promise.resolve().then(() => __importStar(require('../config/orderPricing')));
        const impNeto = orderGrossToAfipNeto(Number(order.total));
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
        // Fecha del comprobante = fecha de emisión (hoy en Argentina), no la fecha del pedido
        const dateStr = (0, argentinaDate_1.todayYmdArgentina)();
        const fecha = dateStr.replace(/-/g, '');
        const cbteFch = parseInt(fecha, 10);
        if (isNaN(cbteFch) || fecha.length !== 8) {
            throw new Error('Fecha inválida para AFIP.');
        }
        let Afip;
        try {
            Afip = (yield Promise.resolve().then(() => __importStar(require('@afipsdk/afip.js')))).default;
        }
        catch (_b) {
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
        const res = (yield withAfipRetry('createVoucher factura', () => afip.ElectronicBilling.createVoucher(data, true)));
        const { cae, caeFchVto } = extractCaeFromAfipResponse(res, afip);
        if (!cae) {
            const obs = formatAfipObservaciones(res);
            throw new Error(obs
                ? `AFIP rechazó el comprobante: ${obs}`
                : 'AFIP no devolvió CAE. Revisá los datos del comprobante y el estado del servicio.');
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
        var _a;
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
        const dateStr = (0, argentinaDate_1.todayYmdArgentina)();
        const fecha = dateStr.replace(/-/g, '');
        const cbteFch = parseInt(fecha, 10);
        let Afip;
        try {
            Afip = (yield Promise.resolve().then(() => __importStar(require('@afipsdk/afip.js')))).default;
        }
        catch (_b) {
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
        const res = (yield withAfipRetry('createVoucher NC', () => afip.ElectronicBilling.createVoucher(data, true)));
        const { cae, caeFchVto } = extractCaeFromAfipResponse(res, afip);
        if (!cae) {
            const obs = formatAfipObservaciones(res);
            throw new Error(obs
                ? `AFIP rechazó la Nota de Crédito: ${obs}`
                : 'AFIP no devolvió CAE para la Nota de Crédito.');
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
function resolveCondicionIvaForNotaAsociada(tipoCbte, tieneCuit, condicionIvaDesc) {
    const isClaseA = tipoCbte === TIPO_NC_A || tipoCbte === TIPO_ND_A;
    if (isClaseA) {
        if (!tieneCuit) {
            throw new Error('Para comprobante clase A el cliente debe tener CUIT cargado.');
        }
        return IVA_RESPONSABLE_INSCRIPTO;
    }
    if (!tieneCuit)
        return CONSUMIDOR_FINAL;
    if (condicionIvaDesc.includes('exento'))
        return 4;
    if (condicionIvaDesc.includes('no categorizado'))
        return 7;
    if (condicionIvaDesc.includes('consumidor final'))
        return CONSUMIDOR_FINAL;
    if (condicionIvaDesc.includes('no alcanzado'))
        return 15;
    return CONSUMIDOR_FINAL;
}
/**
 * Emite una Nota de Débito en AFIP asociada a una factura existente.
 * @param facturaOriginal - Factura a la que se asocia la ND
 * @param customer - Cliente (mismo que la factura)
 * @param amountToDebit - Monto neto a debitar (sin IVA). Puede ser 0 si solo se informa percepción IIBB.
 * @param iibbPercepcion - Percepción IIBB a informar en AFIP (ImpTrib + Tributos Id 99).
 */
function emitirNotaDebito(facturaOriginal, customer, amountToDebit, iibbPercepcion) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const config = getConfig();
        const { cuit, puntoVta } = config;
        const cuitCliente = customer.cuit ? String(customer.cuit).replace(/\D/g, '') : '';
        const tieneCuit = cuitCliente.length >= 10;
        const tipoFacturaOriginal = facturaOriginal.cbteTipo;
        let tipoCbte;
        if (tipoFacturaOriginal === TIPO_CBTE_A) {
            tipoCbte = TIPO_ND_A;
        }
        else if (tipoFacturaOriginal === TIPO_CBTE_B) {
            tipoCbte = TIPO_ND_B;
        }
        else {
            tipoCbte = TIPO_ND_B;
        }
        const docTipo = tieneCuit ? DOC_TIPO_CUIT : DOC_TIPO_CF;
        const docNro = tieneCuit ? parseInt(cuitCliente, 10) : 0;
        const condicionIvaDesc = ((_a = customer.condicionIva) !== null && _a !== void 0 ? _a : '').toLowerCase();
        const condicionIva = resolveCondicionIvaForNotaAsociada(tipoCbte, tieneCuit, condicionIvaDesc);
        const impNetoRaw = Number(amountToDebit);
        const impNeto = Math.round((Number.isFinite(impNetoRaw) ? impNetoRaw : 0) * 100) / 100;
        if (impNeto < 0)
            throw new Error('El monto neto a debitar no puede ser negativo.');
        if (impNeto > AFIP_MAX_IMP_NETO) {
            throw new Error(`El monto neto de la nota de débito (${impNeto.toFixed(2)}) supera el máximo permitido por AFIP (${AFIP_MAX_IMP_NETO.toFixed(2)}).`);
        }
        const impIva = impNeto > 0 ? Math.round(impNeto * 0.21 * 100) / 100 : 0;
        const perc = iibbPercepcion;
        const rawTrib = perc != null && perc !== undefined ? Number(perc.importe) : 0;
        const impTributo = Number.isFinite(rawTrib) && rawTrib > 0.005 ? Math.round(rawTrib * 100) / 100 : 0;
        const rawBase = perc != null ? Number(perc.baseImp) : 0;
        const baseIibb = Number.isFinite(rawBase) && rawBase > 0
            ? Math.round(rawBase * 100) / 100
            : impNeto > 0
                ? impNeto
                : 0;
        const rawAlic = perc != null ? Number(perc.alicuota) : 0;
        const alicuotaIibb = impTributo > 0 && Number.isFinite(rawAlic) ? Math.round(rawAlic * 100) / 100 : 0;
        const total = Math.round((impNeto + impIva + impTributo) * 100) / 100;
        if (!(total > 0.005)) {
            throw new Error('El monto total de la nota de débito debe ser mayor a 0 (neto + IVA y/o percepción IIBB).');
        }
        const dateStr = (0, argentinaDate_1.todayYmdArgentina)();
        const fecha = dateStr.replace(/-/g, '');
        const cbteFch = parseInt(fecha, 10);
        let Afip;
        try {
            Afip = (yield Promise.resolve().then(() => __importStar(require('@afipsdk/afip.js')))).default;
        }
        catch (_b) {
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
        console.log(`[AFIP] Emitiendo nota de débito en ambiente: ${ambiente}. Pto.Vta ${puntoVta}, Tipo ${tipoCbte}`);
        const lastVoucher = Number(yield withAfipRetry('getLastVoucher ND', () => afip.ElectronicBilling.getLastVoucher(puntoVta, tipoCbte)));
        const numeroND = lastVoucher + 1;
        const data = {
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
            console.log(`[AFIP] Nota de débito con percepción IIBB: ImpNeto=${impNeto} ImpIVA=${impIva} ImpTrib=${impTributo} ImpTotal=${total} BaseIIBB=${baseIibb} Alic=${alicuotaIibb}%`);
        }
        const res = (yield withAfipRetry('createVoucher ND', () => afip.ElectronicBilling.createVoucher(data, true)));
        const { cae, caeFchVto } = extractCaeFromAfipResponse(res, afip);
        if (!cae) {
            const obs = formatAfipObservaciones(res);
            throw new Error(obs
                ? `AFIP rechazó la Nota de Débito: ${obs}`
                : 'AFIP no devolvió CAE para la Nota de Débito.');
        }
        return {
            cae: String(cae),
            caeFchVto: String(caeFchVto),
            puntoVta,
            cbteTipo: tipoCbte,
            cbteDesde: numeroND,
            cbteHasta: numeroND
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
function getAfipPuntoVenta() {
    return getConfig().puntoVta;
}
/** Último comprobante autorizado en AFIP para punto de venta y tipo. */
function getLastAfipVoucherNumber(puntoVta, cbteTipo) {
    return __awaiter(this, void 0, void 0, function* () {
        let Afip;
        try {
            Afip = (yield Promise.resolve().then(() => __importStar(require('@afipsdk/afip.js')))).default;
        }
        catch (_a) {
            throw new Error('Paquete AFIP no instalado. Ejecutá: npm install @afipsdk/afip.js');
        }
        const config = getConfig();
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
        return withAfipRetry(`getLastVoucher ${puntoVta}/${cbteTipo}`, () => afip.ElectronicBilling.getLastVoucher(puntoVta, cbteTipo));
    });
}
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
function resolveExportTaxId(customer) {
    const foreign = (customer.foreignTaxId || '').trim();
    if (foreign)
        return foreign;
    const cuit = String(customer.cuit || '').replace(/\D/g, '');
    return cuit.length >= 10 ? cuit : '';
}
/** Destinos AFIP en Argentina (zona franca / AAE): Cuit_pais_cliente = CUIT del cliente. */
const AFIP_DST_ARGENTINA_SPECIAL = new Set([250, 256, 257, 259]);
function parseCuitDigits(value) {
    const n = Number(String(value !== null && value !== void 0 ? value : '').replace(/\D/g, ''));
    return Number.isFinite(n) && n > 0 ? n : 0;
}
/** Cuit_pais_cliente WSFEX: para TDF/ZF argentinas es el CUIT del cliente; exterior = tabla AFIP. */
function resolveExportCuitPaisCliente(customer, dstCmp) {
    const fromField = parseCuitDigits(customer.exportCuitPaisCliente);
    if (fromField > 0)
        return fromField;
    if (AFIP_DST_ARGENTINA_SPECIAL.has(dstCmp)) {
        return parseCuitDigits(resolveExportTaxId(customer));
    }
    return 0;
}
function createAfipClient() {
    return __awaiter(this, void 0, void 0, function* () {
        const config = getConfig();
        let Afip;
        try {
            Afip = (yield Promise.resolve().then(() => __importStar(require('@afipsdk/afip.js')))).default;
        }
        catch (_a) {
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
        return new Afip(afipOptions);
    });
}
/** Punto de venta para exportación (WSFEX). Default 10; override con AFIP_PTO_VTA_EXPORT. */
function getAfipExportPuntoVenta() {
    const pv = parseInt(process.env.AFIP_PTO_VTA_EXPORT || String(PTO_VTA_EXPORT_DEFAULT), 10);
    return Number.isFinite(pv) && pv > 0 ? pv : PTO_VTA_EXPORT_DEFAULT;
}
function wsfexAuthBlock(afip, ws) {
    return __awaiter(this, void 0, void 0, function* () {
        const config = getConfig();
        const ta = yield ws.getTokenAuthorization();
        return {
            Token: ta.token,
            Sign: ta.sign,
            Cuit: Number(config.cuit)
        };
    });
}
function getWsfexServiceId() {
    return (process.env.AFIP_WSFEX_SERVICE || 'wsfex').trim() || 'wsfex';
}
function unwrapWsfexPayload(res) {
    var _a;
    if (res == null || typeof res !== 'object')
        return res;
    const r = res;
    const candidates = [
        r.FEXAuthorizeResult,
        r.FEXAuthorizeResponse,
        r.data,
        r.result,
        r.response,
        (_a = r.FEXAuthorizeResponse) === null || _a === void 0 ? void 0 : _a.FEXAuthorizeResult
    ];
    for (const c of candidates) {
        if (c && typeof c === 'object')
            return c;
    }
    return res;
}
function walkWsfexNodes(node, visit, depth = 0) {
    if (node == null || depth > 14)
        return;
    if (Array.isArray(node)) {
        node.forEach((x) => walkWsfexNodes(x, visit, depth + 1));
        return;
    }
    if (typeof node !== 'object')
        return;
    const o = node;
    for (const [k, v] of Object.entries(o)) {
        visit(k, v, o);
        walkWsfexNodes(v, visit, depth + 1);
    }
}
function summarizeWsfexResponse(res) {
    try {
        const s = JSON.stringify(res);
        if (!s || s === '{}' || s === 'null')
            return 'respuesta vacía de AFIP/WSFEX';
        return s.length > 600 ? `${s.slice(0, 600)}…` : s;
    }
    catch (_a) {
        return String(res);
    }
}
function formatWsfexObservaciones(res) {
    var _a;
    const parts = [];
    const seen = new Set();
    const push = (text) => {
        const t = (text || '').trim();
        if (!t || seen.has(t))
            return;
        seen.add(t);
        parts.push(t);
    };
    const root = unwrapWsfexPayload(res);
    walkWsfexNodes(root, (key, value, parent) => {
        var _a, _b, _c, _d;
        const kl = key.toLowerCase();
        if (kl === 'errmsg' || kl === 'eventmsg') {
            const msg = pickAfipText(value);
            if (!msg)
                return;
            const code = pickAfipText((_d = (_c = (_b = (_a = parent.ErrCode) !== null && _a !== void 0 ? _a : parent.errCode) !== null && _b !== void 0 ? _b : parent.errcode) !== null && _c !== void 0 ? _c : parent.EventCode) !== null && _d !== void 0 ? _d : parent.eventCode);
            push(code ? `[${code}] ${msg}` : msg);
            return;
        }
        if (kl === 'motivos_obs' || kl === 'obs') {
            const msg = pickAfipText(value);
            if (msg)
                push(msg);
        }
        if (kl === 'resultado' && value && String(value).trim() && String(value).trim() !== 'A') {
            push(`Resultado AFIP: ${String(value).trim()}`);
        }
    });
    if (parts.length)
        return parts.join('; ');
    return (_a = pickAfipText(root)) !== null && _a !== void 0 ? _a : pickAfipText(res);
}
function extractCaeFromWsfexResponse(res) {
    let cae = '';
    let caeFchVto = '';
    let resultado = '';
    const root = unwrapWsfexPayload(res);
    walkWsfexNodes(root, (key, value) => {
        const kl = key.toLowerCase();
        if (kl === 'cae' && value != null && String(value).trim())
            cae = String(value).trim();
        if ((kl === 'fch_venc_cae' || kl === 'caefchvto') && value != null && String(value).trim()) {
            caeFchVto = String(value).trim();
        }
        if (kl === 'resultado' && value != null && String(value).trim())
            resultado = String(value).trim();
    });
    return { cae, caeFchVto, resultado };
}
function arsToMonedaExport(arsAmount, monedaId, monedaCtz) {
    const ars = Math.round((Number(arsAmount) || 0) * 100) / 100;
    if (monedaId === 'PES')
        return ars;
    const ctz = Number(monedaCtz);
    if (!Number.isFinite(ctz) || ctz <= 0) {
        throw new Error('Para factura en moneda extranjera informá la cotización (monedaCtz > 0).');
    }
    return Math.round((ars / ctz) * 100) / 100;
}
/** Catálogos WSFEX: paises | monedas | incoterms | umed | tipo_expo */
function getWsfexParametros(tipo) {
    return __awaiter(this, void 0, void 0, function* () {
        const methodMap = {
            paises: 'FEXGetPARAM_DST_pais',
            monedas: 'FEXGetPARAM_MON',
            incoterms: 'FEXGetPARAM_Incoterms',
            umed: 'FEXGetPARAM_UMed',
            tipo_expo: 'FEXGetPARAM_Tipo_Expo'
        };
        const method = methodMap[tipo];
        if (!method)
            throw new Error(`Parámetro WSFEX desconocido: ${tipo}`);
        const afip = yield createAfipClient();
        const ws = afip.WebService(getWsfexServiceId());
        const Auth = yield wsfexAuthBlock(afip, ws);
        return withAfipRetry(`wsfex ${method}`, () => ws.executeRequest(method, { Auth }));
    });
}
/** Último comprobante de exportación autorizado (WSFEX). */
function getLastExportVoucherNumber(puntoVta_1) {
    return __awaiter(this, arguments, void 0, function* (puntoVta, cbteTipo = exports.TIPO_CBTE_E) {
        var _a, _b, _c, _d;
        const afip = yield createAfipClient();
        const ws = afip.WebService(getWsfexServiceId());
        const Auth = yield wsfexAuthBlock(afip, ws);
        const res = (yield withAfipRetry('FEXGetLast_CMP', () => ws.executeRequest('FEXGetLast_CMP', { Auth, Pto_venta: puntoVta, Cbte_Tipo: cbteTipo })));
        const root = ((_a = res === null || res === void 0 ? void 0 : res.FEXGetLast_CMPResult) !== null && _a !== void 0 ? _a : res);
        const last = ((_b = root === null || root === void 0 ? void 0 : root.FEXResult_LastCMP) !== null && _b !== void 0 ? _b : root);
        const nro = Number((_d = (_c = last === null || last === void 0 ? void 0 : last.Cbte_nro) !== null && _c !== void 0 ? _c : last === null || last === void 0 ? void 0 : last.cbte_nro) !== null && _d !== void 0 ? _d : 0);
        return Number.isFinite(nro) ? nro : 0;
    });
}
/** Diagnóstico WSFEX: último comprobante tipo 19 en PV exportación. */
function getWsfexExportDiagnostico() {
    return __awaiter(this, void 0, void 0, function* () {
        const puntoVentaExport = getAfipExportPuntoVenta();
        const ultimoCbteTipo19 = yield getLastExportVoucherNumber(puntoVentaExport, exports.TIPO_CBTE_E);
        return {
            wsfexService: getWsfexServiceId(),
            puntoVentaExport,
            ultimoCbteTipo19,
            proximoCbteTipo19: ultimoCbteTipo19 + 1
        };
    });
}
/**
 * Emite Factura E (exportación) vía WSFEX / FEXAuthorize.
 * Requiere autorizar el web service `wsfex` en ARCA (además de wsfe).
 */
function emitirFacturaExportacion(order, customer, items, params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const config = getConfig();
        const puntoVta = getAfipExportPuntoVenta();
        const dstCmp = Number(params.dstCmp);
        if (!Number.isFinite(dstCmp) || dstCmp <= 0) {
            throw new Error('País destino (dstCmp) inválido. Consultá /api/afip/exportacion/paises.');
        }
        if (!((_a = customer.businessName) === null || _a === void 0 ? void 0 : _a.trim())) {
            throw new Error('El cliente debe tener razón social / nombre para Factura E.');
        }
        const domicilio = [customer.address, customer.city].filter(Boolean).join(', ').trim();
        if (!domicilio) {
            throw new Error('El cliente de exportación debe tener domicilio y ciudad cargados.');
        }
        const monedaId = (params.monedaId || process.env.AFIP_EXPORT_MONEDA_ID || MONEDA_EXPORT_DEFAULT)
            .trim()
            .toUpperCase();
        const monedaCtz = monedaId === 'PES'
            ? 1
            : Number((_c = (_b = params.monedaCtz) !== null && _b !== void 0 ? _b : process.env.AFIP_EXPORT_MONEDA_CTZ) !== null && _c !== void 0 ? _c : 0);
        if (monedaId !== 'PES' && !(monedaCtz > 0)) {
            throw new Error('Informá la cotización de la moneda (monedaCtz) para Factura E en moneda extranjera.');
        }
        const tipoExpo = params.tipoExpo === 2 || params.tipoExpo === 4 ? params.tipoExpo : TIPO_EXPO_BIENES;
        const incoterms = (params.incoterms || process.env.AFIP_EXPORT_INCOTERMS || 'FOB').trim().toUpperCase();
        const incotermsDs = (params.incotermsDs || incoterms).trim();
        const formaPago = (params.formaPago || 'Contado').trim();
        const lineItems = (items || []).filter((it) => (Number(it.quantity) || 0) > 0);
        if (lineItems.length === 0) {
            throw new Error('El pedido no tiene ítems con cantidad para facturar.');
        }
        let impTotal = 0;
        const afipItems = [];
        for (const it of lineItems) {
            const qty = Math.round((Number(it.quantity) || 0) * 10000) / 10000;
            const unitArs = Math.round((Number(it.unitPriceArs) || 0) * 100) / 100;
            const unit = arsToMonedaExport(unitArs, monedaId, monedaCtz);
            const totalItem = Math.round(qty * unit * 100) / 100;
            impTotal += totalItem;
            afipItems.push({
                Pro_ds: (it.description || 'Mercadería').slice(0, 250),
                Pro_qty: qty,
                Pro_umed: PRO_UMED_UNIDADES,
                Pro_precio_uni: unit,
                Pro_bonificacion: 0,
                Pro_total_item: totalItem
            });
        }
        impTotal = Math.round(impTotal * 100) / 100;
        if (impTotal <= 0)
            throw new Error('El importe total de exportación debe ser mayor a 0.');
        // AFIP exige que Imp_total = suma de ítems (evitar rechazo silencioso).
        const itemsSum = Math.round(afipItems.reduce((s, it) => s + (Number(it.Pro_total_item) || 0), 0) * 100) / 100;
        impTotal = itemsSum;
        const foreignTaxId = resolveExportTaxId(customer);
        const cuitPaisCliente = resolveExportCuitPaisCliente(customer, dstCmp);
        if (!foreignTaxId && !(cuitPaisCliente > 0)) {
            throw new Error(AFIP_DST_ARGENTINA_SPECIAL.has(dstCmp)
                ? 'Para Tierra del Fuego / zona franca argentina el cliente debe tener CUIT cargado (o ID tributaria / CUIT país cliente).'
                : 'El cliente de exportación debe tener identificación tributaria (ID extranjera, CUIT del cliente o CUIT país cliente).');
        }
        const dateStr = (0, argentinaDate_1.todayYmdArgentina)();
        const fechaCbte = dateStr.replace(/-/g, '');
        if (fechaCbte.length !== 8)
            throw new Error('Fecha inválida para AFIP exportación.');
        const afip = yield createAfipClient();
        const ws = afip.WebService(getWsfexServiceId());
        const Auth = yield wsfexAuthBlock(afip, ws);
        const ambiente = config.production ? 'producción' : 'homologación';
        console.log(`[AFIP WSFEX] Emitiendo Factura E en ${ambiente}. ws=${getWsfexServiceId()} Pto.Vta ${puntoVta}, Dst ${dstCmp}, ${monedaId}, total ${impTotal}`);
        const lastNro = yield getLastExportVoucherNumber(puntoVta, exports.TIPO_CBTE_E);
        const cbteNro = lastNro + 1;
        const requestId = Date.now() % 999999999;
        const itemPayload = afipItems.length === 1 ? afipItems[0] : afipItems;
        const Cmp = {
            Id: requestId,
            Fecha_cbte: fechaCbte,
            Tipo_cbte: exports.TIPO_CBTE_E,
            Cbte_Tipo: exports.TIPO_CBTE_E,
            Punto_vta: puntoVta,
            Cbte_nro: cbteNro,
            Tipo_expo: tipoExpo,
            Permiso_existente: tipoExpo === TIPO_EXPO_BIENES ? 'N' : '',
            Dst_cmp: dstCmp,
            Cliente: customer.businessName.trim().slice(0, 200),
            Domicilio_cliente: domicilio.slice(0, 200),
            Moneda_Id: monedaId,
            Moneda_ctz: monedaCtz,
            CanMisMonExt: monedaId === 'PES' ? 'N' : 'S',
            Imp_total: impTotal,
            Forma_pago: formaPago.slice(0, 50),
            Incoterms: incoterms.slice(0, 3),
            Incoterms_Ds: incotermsDs.slice(0, 20),
            Idioma_cbte: IDIOMA_CBTE_ES,
            Items: { Item: itemPayload }
        };
        if (foreignTaxId)
            Cmp.Id_impositivo = foreignTaxId.slice(0, 50);
        if (cuitPaisCliente > 0)
            Cmp.Cuit_pais_cliente = cuitPaisCliente;
        if ((_d = params.obs) === null || _d === void 0 ? void 0 : _d.trim())
            Cmp.Obs = params.obs.trim().slice(0, 1000);
        const res = (yield withAfipRetry('FEXAuthorize Factura E', () => ws.executeRequest('FEXAuthorize', { Auth, Cmp })));
        const { cae, caeFchVto, resultado } = extractCaeFromWsfexResponse(res);
        if (!cae || (resultado && resultado !== 'A')) {
            const obs = formatWsfexObservaciones(res);
            const detail = summarizeWsfexResponse(res);
            console.error('[AFIP WSFEX] FEXAuthorize sin CAE:', detail);
            throw new Error(obs
                ? `AFIP rechazó la Factura E: ${obs}`
                : `AFIP no devolvió CAE (PV export ${puntoVta}, ws ${getWsfexServiceId()}). Verificá wsfex autorizado y PV de exportación en ARCA. Detalle: ${detail}`);
        }
        return {
            cae: String(cae),
            caeFchVto: String(caeFchVto),
            puntoVta,
            cbteTipo: exports.TIPO_CBTE_E,
            cbteDesde: cbteNro,
            cbteHasta: cbteNro,
            monedaId,
            monedaCtz,
            exportDstCmp: dstCmp,
            exportIncoterms: incoterms,
            exportTipoExpo: tipoExpo,
            impTotal
        };
    });
}
