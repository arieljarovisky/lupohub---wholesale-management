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
exports.fetchAllTiendaNubeProductVariants = fetchAllTiendaNubeProductVariants;
exports.mergeTiendaNubeDuplicateVariants = mergeTiendaNubeDuplicateVariants;
const axios_1 = __importDefault(require("axios"));
const tiendanubeClient_1 = require("../utils/tiendanubeClient");
function variantValueText(val) {
    var _a, _b, _c, _d;
    return ((_d = ((_c = (_b = (_a = val === null || val === void 0 ? void 0 : val.es) !== null && _a !== void 0 ? _a : val === null || val === void 0 ? void 0 : val.pt) !== null && _b !== void 0 ? _b : val === null || val === void 0 ? void 0 : val.en) !== null && _c !== void 0 ? _c : val)) === null || _d === void 0 ? void 0 : _d.toString().trim()) || '';
}
function variantStockQty(v) {
    if (v.stock_management === false)
        return 0;
    if (v.stock === '' || v.stock == null)
        return 0;
    const n = Number(v.stock);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
function fetchVariantStockFromApi(storeId, productId, variantId, headers) {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield (0, tiendanubeClient_1.tnGetWithRetry)(axios_1.default, `https://api.tiendanube.com/v1/${storeId}/products/${productId}/variants/${variantId}`, { headers });
        const row = res.data;
        return variantStockQty(row);
    });
}
function pickKeeperPlan(group) {
    const exactLabel = group.filter((p) => p.current === p.normalized);
    if (exactLabel.length)
        return exactLabel[0];
    const alreadyTarget = group.filter((p) => !p.willUpdate);
    if (alreadyTarget.length) {
        const withAccent = alreadyTarget.find((p) => /[áéíóúñ]/i.test(p.current));
        return withAccent !== null && withAccent !== void 0 ? withAccent : alreadyTarget[0];
    }
    const sorted = group.slice().sort((a, b) => String(a.variant.id).localeCompare(String(b.variant.id)));
    return sorted[0];
}
/** Todas las variantes de un producto (el listado paginado de productos suele traer solo un subconjunto). */
function fetchAllTiendaNubeProductVariants(storeId, productId, headers) {
    return __awaiter(this, void 0, void 0, function* () {
        const out = [];
        const perPage = 200;
        for (let vPage = 1; vPage <= 50; vPage++) {
            const res = yield (0, tiendanubeClient_1.tnGetWithRetry)(axios_1.default, `https://api.tiendanube.com/v1/${storeId}/products/${productId}/variants`, { headers, params: { page: vPage, per_page: perPage }, validateStatus: () => true });
            const chunk = res.status === 200 && Array.isArray(res.data) ? res.data : [];
            out.push(...chunk);
            if (chunk.length < perPage)
                break;
        }
        return out;
    });
}
function buildValuesWithAttr(values, attrIndex, normalized) {
    return values.map((obj, i) => {
        if (i !== attrIndex)
            return obj;
        const langKeys = obj && typeof obj === 'object' ? Object.keys(obj) : ['es'];
        const next = {};
        for (const lang of langKeys)
            next[lang] = normalized;
        return next;
    });
}
/**
 * Fusiona variantes que colisionan tras normalizar (ej. G + G/44-46 → G):
 * suma stock en la variante que se queda y elimina las demás en Tienda Nube.
 */
function mergeTiendaNubeDuplicateVariants(options) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const { storeId, productId, attrIndex, group, headers, log } = options;
        if (group.length < 2)
            return { mergedCount: 0, stockAdded: 0 };
        const keeperPlan = pickKeeperPlan(group);
        const absorbs = group.filter((p) => String(p.variant.id) !== String(keeperPlan.variant.id));
        if (!absorbs.length)
            return { mergedCount: 0, stockAdded: 0 };
        const baseUrl = `https://api.tiendanube.com/v1/${storeId}/products/${productId}`;
        let keeperStock = variantStockQty(keeperPlan.variant);
        if (keeperStock === 0) {
            keeperStock = yield fetchVariantStockFromApi(storeId, productId, keeperPlan.variant.id, headers);
        }
        let totalStock = keeperStock;
        const absorbLabels = [];
        for (const a of absorbs) {
            let add = variantStockQty(a.variant);
            if (add === 0) {
                add = yield fetchVariantStockFromApi(storeId, productId, a.variant.id, headers);
            }
            totalStock += add;
            absorbLabels.push(`${a.variant.id}("${a.current}"→${a.normalized}, +${add})`);
        }
        for (const a of absorbs) {
            try {
                yield (0, tiendanubeClient_1.tnDeleteWithRetry)(axios_1.default, `${baseUrl}/variants/${a.variant.id}`, { headers });
            }
            catch (err) {
                const ax = err;
                throw new Error(`No se pudo eliminar variante ${a.variant.id}: ${((_b = (_a = ax.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.description) || ax.message}`);
            }
        }
        const keeperValues = keeperPlan.variant.values || [];
        const targetName = keeperPlan.normalized;
        const keeperCurrent = variantValueText(keeperValues[attrIndex]);
        if (keeperPlan.willUpdate || keeperCurrent !== targetName) {
            yield (0, tiendanubeClient_1.tnPutWithRetry)(axios_1.default, `${baseUrl}/variants/${keeperPlan.variant.id}`, { values: buildValuesWithAttr(keeperValues, attrIndex, targetName) }, { headers });
        }
        const stockAdded = Math.max(0, totalStock - keeperStock);
        if (totalStock > 0 || stockAdded > 0) {
            try {
                yield (0, tiendanubeClient_1.tnPostWithRetry)(axios_1.default, `${baseUrl}/variants/stock`, { action: 'replace', value: totalStock, id: keeperPlan.variant.id }, { headers });
            }
            catch (err) {
                const ax = err;
                log(`  [WARN] Producto ${productId} variante ${keeperPlan.variant.id}: stock no actualizado (${((_d = (_c = ax.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.description) || ax.message})`);
            }
        }
        log(`  [MERGE] Producto ${productId}: variante ${keeperPlan.variant.id} queda "${targetName}" stock=${totalStock}; eliminadas ${absorbs.length} (${absorbLabels.join(', ')})`);
        return { mergedCount: absorbs.length, stockAdded: Math.max(0, stockAdded) };
    });
}
