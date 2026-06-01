"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchListingSaleFeeAmount = exports.parseListingPricesSaleFee = exports.calcMarginPercent = exports.calcMargin = exports.calcMlPaymentCpt = exports.getMlPaymentCptPercent = exports.calcTnSaleFee = exports.calcTnSaleFeeFromPreset = exports.resolveTnFeePreset = exports.getTnFeeConfig = exports.listTnFeePresets = exports.TN_FEE_PRESETS = exports.getIvaMultiplier = exports.resolveFobPriceList = void 0;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../database/db");
/** Lista FOB: env LUPOHUB_FOB_PRICE_LIST_ID o nombre que contenga "fob". */
function resolveFobPriceList() {
    return __awaiter(this, void 0, void 0, function* () {
        const byProductId = new Map();
        let id = null;
        let name = '';
        const fobListIdEnv = (process.env.LUPOHUB_FOB_PRICE_LIST_ID || '').trim();
        if (fobListIdEnv) {
            const exists = yield (0, db_1.get)('SELECT id, name FROM price_lists WHERE id = ?', [fobListIdEnv]);
            if (exists === null || exists === void 0 ? void 0 : exists.id) {
                id = String(exists.id);
                name = String(exists.name || '');
            }
        }
        if (!id) {
            const pl = yield (0, db_1.get)(`SELECT id, name FROM price_lists WHERE LOWER(TRIM(name)) LIKE '%fob%'
       ORDER BY CASE WHEN LOWER(TRIM(name)) = 'precios fob' THEN 0 ELSE 1 END, name LIMIT 1`);
            if (pl === null || pl === void 0 ? void 0 : pl.id) {
                id = String(pl.id);
                name = String(pl.name || '');
            }
        }
        if (id) {
            const rows = (yield (0, db_1.query)(`SELECT product_id, price FROM price_list_items WHERE price_list_id = ?`, [
                id,
            ]));
            for (const r of rows) {
                byProductId.set(String(r.product_id), Number(r.price) || 0);
            }
        }
        return { id, name, byProductId };
    });
}
exports.resolveFobPriceList = resolveFobPriceList;
/** IVA sobre tasas (ej. 21% → multiplicador 1.21). Las tasas TN suelen mostrarse como «X% + IVA». */
function getIvaMultiplier() {
    var _a;
    const pct = Number((_a = process.env.LUPOHUB_FEE_IVA_PERCENT) !== null && _a !== void 0 ? _a : '21');
    const n = Number.isFinite(pct) && pct >= 0 ? pct : 21;
    return 1 + n / 100;
}
exports.getIvaMultiplier = getIvaMultiplier;
/** Tasas según panel de pagos Tienda Nube (Pago Nube / Mercado Pago en TN). */
exports.TN_FEE_PRESETS = {
    pago_nube_14d: {
        label: 'Pago Nube · tarjeta/billetera · 14 días',
        ratePercent: 3.29,
        cptPercent: 0,
        appliesIva: true,
    },
    pago_nube_7d: {
        label: 'Pago Nube · tarjeta/billetera · 7 días',
        ratePercent: 4.19,
        cptPercent: 0,
        appliesIva: true,
    },
    pago_nube_1d: {
        label: 'Pago Nube · tarjeta/billetera · 1 día',
        ratePercent: 5.89,
        cptPercent: 0,
        appliesIva: true,
    },
    pago_nube_transfer_1d: {
        label: 'Pago Nube · transferencia bancaria · 1 día',
        ratePercent: 0.99,
        cptPercent: 0,
        appliesIva: true,
    },
    tn_mp_18d: {
        label: 'Mercado Pago en TN · 18 días',
        ratePercent: 3.39,
        cptPercent: 1,
        appliesIva: true,
    },
    tn_mp_10d: {
        label: 'Mercado Pago en TN · 10 días',
        ratePercent: 4.39,
        cptPercent: 1,
        appliesIva: true,
    },
    tn_mp_instant: {
        label: 'Mercado Pago en TN · al momento',
        ratePercent: 6.29,
        cptPercent: 1,
        appliesIva: true,
    },
};
function listTnFeePresets() {
    return Object.entries(exports.TN_FEE_PRESETS).map(([id, def]) => (Object.assign({ id }, def)));
}
exports.listTnFeePresets = listTnFeePresets;
/** @deprecated Usar preset; se mantiene por compatibilidad con LUPOHUB_TN_SALE_FEE_PERCENT. */
function getTnFeeConfig() {
    var _a, _b;
    const percent = Number((_a = process.env.LUPOHUB_TN_SALE_FEE_PERCENT) !== null && _a !== void 0 ? _a : '6.5');
    const fixed = Number((_b = process.env.LUPOHUB_TN_SALE_FEE_FIXED) !== null && _b !== void 0 ? _b : '0');
    return {
        percent: Number.isFinite(percent) && percent >= 0 ? percent : 0,
        fixed: Number.isFinite(fixed) && fixed >= 0 ? fixed : 0,
    };
}
exports.getTnFeeConfig = getTnFeeConfig;
function resolveTnFeePreset(presetId) {
    const envDefault = (process.env.LUPOHUB_TN_FEE_PRESET || 'tn_mp_instant').trim();
    const id = (presetId || envDefault).trim();
    if (id === 'custom') {
        const legacy = getTnFeeConfig();
        return {
            id: 'custom',
            label: `Personalizado (.env ${legacy.percent}%${legacy.fixed ? ` + $${legacy.fixed}` : ''})`,
            ratePercent: legacy.percent,
            cptPercent: 0,
            appliesIva: true,
        };
    }
    const def = exports.TN_FEE_PRESETS[id];
    if (def)
        return Object.assign({ id }, def);
    return Object.assign({ id: 'tn_mp_instant' }, exports.TN_FEE_PRESETS.tn_mp_instant);
}
exports.resolveTnFeePreset = resolveTnFeePreset;
function calcTnSaleFeeFromPreset(price, preset, fixed = 0) {
    const p = Math.max(0, Number(price) || 0);
    const iva = preset.appliesIva ? getIvaMultiplier() : 1;
    const ratePart = p * (preset.ratePercent / 100) * iva;
    const cptPart = p * (preset.cptPercent / 100);
    const total = Math.round((ratePart + cptPart + fixed) * 100) / 100;
    return {
        total,
        ratePart: Math.round(ratePart * 100) / 100,
        cptPart: Math.round(cptPart * 100) / 100,
    };
}
exports.calcTnSaleFeeFromPreset = calcTnSaleFeeFromPreset;
function calcTnSaleFee(price, config = getTnFeeConfig()) {
    return calcTnSaleFeeFromPreset(price, { ratePercent: config.percent, cptPercent: 0, appliesIva: true }, config.fixed).total;
}
exports.calcTnSaleFee = calcTnSaleFee;
/** CPT cobro personalizado / transferencia en ML (panel «Personalizado», típ. 1%). */
function getMlPaymentCptPercent() {
    var _a;
    const n = Number((_a = process.env.LUPOHUB_ML_PAYMENT_CPT_PERCENT) !== null && _a !== void 0 ? _a : '1');
    return Number.isFinite(n) && n >= 0 ? n : 0;
}
exports.getMlPaymentCptPercent = getMlPaymentCptPercent;
function calcMlPaymentCpt(price, percent = getMlPaymentCptPercent()) {
    const p = Math.max(0, Number(price) || 0);
    return Math.round(p * (percent / 100) * 100) / 100;
}
exports.calcMlPaymentCpt = calcMlPaymentCpt;
function calcMargin(price, fee, fob) {
    if (fob == null || !Number.isFinite(fob))
        return null;
    const m = Number(price) - Number(fee) - Number(fob);
    return Number.isFinite(m) ? Math.round(m * 100) / 100 : null;
}
exports.calcMargin = calcMargin;
function calcMarginPercent(margin, price) {
    if (margin == null || !Number.isFinite(price) || price <= 0)
        return null;
    return Math.round((margin / price) * 10000) / 100;
}
exports.calcMarginPercent = calcMarginPercent;
/** Comisión ML (`sale_fee_amount`) desde GET /sites/{SITE}/listing_prices. */
function parseListingPricesSaleFee(data, listingTypeId) {
    const lt = (listingTypeId || '').trim();
    const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
    const match = rows.find((r) => String((r === null || r === void 0 ? void 0 : r.listing_type_id) || '') === lt);
    const row = match !== null && match !== void 0 ? match : rows[0];
    const n = Number(row === null || row === void 0 ? void 0 : row.sale_fee_amount);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}
exports.parseListingPricesSaleFee = parseListingPricesSaleFee;
function fetchListingSaleFeeAmount(accessToken, item, price, cache) {
    return __awaiter(this, void 0, void 0, function* () {
        const siteId = String((item === null || item === void 0 ? void 0 : item.site_id) || '').trim();
        const categoryId = String((item === null || item === void 0 ? void 0 : item.category_id) || '').trim();
        const listingTypeId = String((item === null || item === void 0 ? void 0 : item.listing_type_id) || '').trim();
        const currencyId = String((item === null || item === void 0 ? void 0 : item.currency_id) || '').trim() || 'ARS';
        const shipping = item === null || item === void 0 ? void 0 : item.shipping;
        const logisticType = (shipping === null || shipping === void 0 ? void 0 : shipping.logistic_type) != null ? String(shipping.logistic_type).trim() : '';
        if (!siteId || !listingTypeId || !Number.isFinite(price) || price <= 0)
            return 0;
        const priceRounded = Math.round(price * 100) / 100;
        const cacheKey = `${siteId}|${categoryId}|${listingTypeId}|${priceRounded}|${currencyId}|${logisticType}`;
        if (cache.has(cacheKey))
            return cache.get(cacheKey);
        const params = {
            price: priceRounded,
            listing_type_id: listingTypeId,
            currency_id: currencyId,
        };
        if (categoryId)
            params.category_id = categoryId;
        if (logisticType)
            params.logistic_type = logisticType;
        try {
            const res = yield axios_1.default.get(`https://api.mercadolibre.com/sites/${encodeURIComponent(siteId)}/listing_prices`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                params,
                validateStatus: () => true,
            });
            if (res.status !== 200) {
                cache.set(cacheKey, 0);
                return 0;
            }
            const fee = parseListingPricesSaleFee(res.data, listingTypeId);
            cache.set(cacheKey, fee);
            return fee;
        }
        catch (_a) {
            cache.set(cacheKey, 0);
            return 0;
        }
    });
}
exports.fetchListingSaleFeeAmount = fetchListingSaleFeeAmount;
