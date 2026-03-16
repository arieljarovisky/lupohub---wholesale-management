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
exports.isAfipConfigured = isAfipConfigured;
exports.emitirFactura = emitirFactura;
exports.emitirNotaCredito = emitirNotaCredito;
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
/**
 * Emite una factura electrónica en AFIP por el pedido dado.
 * Regla:
 * - Responsable Inscripto => Factura A
 * - Otros (Monotributo, Exento, CF, etc.) => Factura B
 */
function emitirFactura(order, customer) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const config = getConfig();
        const { cuit, puntoVta } = config;
        const cuitCliente = customer.cuit ? String(customer.cuit).replace(/\D/g, '') : '';
        const tieneCuit = cuitCliente.length >= 10; // CUIT 11 dígitos, CUIL 10–11
        const condicionIvaDesc = ((_a = customer.condicionIva) !== null && _a !== void 0 ? _a : '').toLowerCase();
        const esResponsableInscripto = condicionIvaDesc.includes('responsable inscripto') && !condicionIvaDesc.includes('no inscripto');
        const tipoCbte = tieneCuit && esResponsableInscripto ? TIPO_CBTE_A : TIPO_CBTE_B;
        const docTipo = tieneCuit ? DOC_TIPO_CUIT : DOC_TIPO_CF;
        const docNro = tieneCuit ? parseInt(cuitCliente, 10) : 0;
        let condicionIva;
        if (!tieneCuit) {
            condicionIva = CONSUMIDOR_FINAL;
        }
        else if (esResponsableInscripto) {
            condicionIva = IVA_RESPONSABLE_INSCRIPTO;
        }
        else if (condicionIvaDesc.includes('monotrib')) {
            condicionIva = 6; // Responsable Monotributo
        }
        else if (condicionIvaDesc.includes('exento')) {
            condicionIva = 4; // IVA Sujeto Exento
        }
        else if (condicionIvaDesc.includes('consumidor final')) {
            condicionIva = CONSUMIDOR_FINAL;
        }
        else {
            // Fallback genérico si no se reconoce la descripción
            condicionIva = CONSUMIDOR_FINAL;
        }
        const total = Number(order.total) || 0;
        if (total <= 0)
            throw new Error('El total del pedido debe ser mayor a 0.');
        // IVA 21%: neto = total / 1.21, iva = total - neto
        const impNeto = Math.round((total / 1.21) * 100) / 100;
        const impIva = Math.round((total - impNeto) * 100) / 100;
        const dateVal = order.date;
        const dateStr = dateVal instanceof Date
            ? dateVal.toISOString().split('T')[0]
            : typeof dateVal === 'string'
                ? dateVal
                : new Date().toISOString().split('T')[0];
        const fecha = dateStr.replace(/-/g, '');
        const cbteFch = parseInt(fecha, 10);
        if (isNaN(cbteFch) || fecha.length !== 8) {
            throw new Error('Fecha del pedido inválida para AFIP.');
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
        const lastVoucher = yield afip.ElectronicBilling.getLastVoucher(puntoVta, tipoCbte);
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
            ImpTrib: 0,
            MonId: 'PES',
            MonCotiz: 1,
            CondicionIVAReceptorId: condicionIva,
            Iva: [
                { Id: ID_IVA_21, BaseImp: impNeto, Importe: impIva }
            ]
        };
        const res = yield afip.ElectronicBilling.createVoucher(data);
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
 * @param amountToCredit - Monto total a creditar (incluye IVA)
 */
function emitirNotaCredito(facturaOriginal, customer, amountToCredit) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const config = getConfig();
        const { cuit, puntoVta } = config;
        const cuitCliente = customer.cuit ? String(customer.cuit).replace(/\D/g, '') : '';
        const tieneCuit = cuitCliente.length >= 10;
        const tipoCbte = tieneCuit ? TIPO_NC_A : TIPO_NC_B;
        const docTipo = tieneCuit ? DOC_TIPO_CUIT : DOC_TIPO_CF;
        const docNro = tieneCuit ? parseInt(cuitCliente, 10) : 0;
        const condicionIva = tieneCuit ? IVA_RESPONSABLE_INSCRIPTO : CONSUMIDOR_FINAL;
        const total = Number(amountToCredit) || 0;
        if (total <= 0)
            throw new Error('El monto a creditar debe ser mayor a 0.');
        const impNeto = Math.round((total / 1.21) * 100) / 100;
        const impIva = Math.round((total - impNeto) * 100) / 100;
        const dateStr = new Date().toISOString().split('T')[0];
        const fecha = dateStr.replace(/-/g, '');
        const cbteFch = parseInt(fecha, 10);
        let Afip;
        try {
            Afip = (yield Promise.resolve().then(() => __importStar(require('@afipsdk/afip.js')))).default;
        }
        catch (_d) {
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
        const lastVoucher = yield afip.ElectronicBilling.getLastVoucher(puntoVta, tipoCbte);
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
            ImpTrib: 0,
            MonId: 'PES',
            MonCotiz: 1,
            CondicionIVAReceptorId: condicionIva,
            CbtesAsoc: [
                {
                    Tipo: facturaOriginal.cbteTipo,
                    PtoVta: facturaOriginal.puntoVta,
                    Nro: facturaOriginal.cbteDesde
                }
            ],
            Iva: [
                { Id: ID_IVA_21, BaseImp: impNeto, Importe: impIva }
            ]
        };
        const res = yield afip.ElectronicBilling.createVoucher(data);
        const cae = (_a = res === null || res === void 0 ? void 0 : res.CAE) !== null && _a !== void 0 ? _a : res === null || res === void 0 ? void 0 : res.cae;
        const caeFchVto = (_c = (_b = res === null || res === void 0 ? void 0 : res.CAEFchVto) !== null && _b !== void 0 ? _b : res === null || res === void 0 ? void 0 : res.CAE_FchVto) !== null && _c !== void 0 ? _c : '';
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
