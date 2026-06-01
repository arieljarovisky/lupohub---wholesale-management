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
exports.resolveTnStoreId = exports.fetchTnProductsBatched = exports.fetchMlItemsMultiget = exports.pickTnProductPrice = exports.parseTnPrice = exports.runPool = void 0;
const axios_1 = __importDefault(require("axios"));
const TN_USER_AGENT = process.env.TIENDA_NUBE_USER_AGENT || 'LupoHub (support@lupo.ar)';
/** Ejecuta tareas con concurrencia limitada. */
function runPool(items, concurrency, fn) {
    return __awaiter(this, void 0, void 0, function* () {
        if (items.length === 0)
            return;
        let next = 0;
        const workers = Math.min(Math.max(1, concurrency), items.length);
        yield Promise.all(Array.from({ length: workers }, () => __awaiter(this, void 0, void 0, function* () {
            while (next < items.length) {
                const idx = next++;
                yield fn(items[idx]);
            }
        })));
    });
}
exports.runPool = runPool;
function parseTnPrice(variant) {
    var _a;
    if (!variant)
        return 0;
    const raw = (_a = variant.promotional_price) !== null && _a !== void 0 ? _a : variant.price;
    if (raw == null || raw === '')
        return 0;
    const n = Number(String(raw).replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
}
exports.parseTnPrice = parseTnPrice;
/** Precio representativo del producto TN (todas las variantes suelen tener el mismo). */
function pickTnProductPrice(tnVariants) {
    for (const tv of tnVariants) {
        const p = parseTnPrice(tv);
        if (p > 0)
            return p;
    }
    return 0;
}
exports.pickTnProductPrice = pickTnProductPrice;
function fetchMlItemsMultiget(accessToken, mlItemIds, prices, mlItemCache) {
    var _a, _b, _c, _d, _e, _f, _g;
    return __awaiter(this, void 0, void 0, function* () {
        const ids = Array.from(mlItemIds.keys());
        const headers = { Authorization: `Bearer ${accessToken}` };
        const batchSize = 20;
        for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize);
            try {
                const res = yield axios_1.default.get(`https://api.mercadolibre.com/items?ids=${batch.join(',')}&include_attributes=all`, { headers, validateStatus: () => true });
                const wrappers = Array.isArray(res.data) ? res.data : [];
                for (const wrapper of wrappers) {
                    if ((wrapper === null || wrapper === void 0 ? void 0 : wrapper.code) !== 200 || !(wrapper === null || wrapper === void 0 ? void 0 : wrapper.body))
                        continue;
                    const item = wrapper.body;
                    const itemId = String(item.id || wrapper.id || '');
                    if (!itemId)
                        continue;
                    mlItemCache.set(itemId, item);
                    const vars = mlItemIds.get(itemId) || [];
                    const variations = item.variations || [];
                    for (const { variantId, variationId } of vars) {
                        if (!prices[variantId])
                            continue;
                        let priceML = 0;
                        if (variations.length === 0) {
                            priceML = Number((_a = item.price) !== null && _a !== void 0 ? _a : 0);
                        }
                        else if (variationId) {
                            const vr = variations.find((x) => String(x.id) === String(variationId));
                            priceML = Number((_c = (_b = vr === null || vr === void 0 ? void 0 : vr.price) !== null && _b !== void 0 ? _b : item.price) !== null && _c !== void 0 ? _c : 0);
                        }
                        else if (variations.length === 1) {
                            priceML = Number((_f = (_e = (_d = variations[0]) === null || _d === void 0 ? void 0 : _d.price) !== null && _e !== void 0 ? _e : item.price) !== null && _f !== void 0 ? _f : 0);
                        }
                        else {
                            priceML = Number((_g = item.price) !== null && _g !== void 0 ? _g : 0);
                        }
                        prices[variantId].priceML = priceML;
                        prices[variantId].mlItem = item;
                    }
                }
            }
            catch (_h) {
                /* ignore batch */
            }
        }
    });
}
exports.fetchMlItemsMultiget = fetchMlItemsMultiget;
function fetchTnProductsBatched(storeId, accessToken, tnProductIds, prices) {
    return __awaiter(this, void 0, void 0, function* () {
        const ids = Array.from(tnProductIds.keys());
        if (ids.length === 0)
            return;
        const tnHeaders = {
            Authentication: `bearer ${accessToken}`,
            'User-Agent': TN_USER_AGENT,
        };
        const tnProductById = new Map();
        const batchSize = 30;
        for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize);
            try {
                const res = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/products`, {
                    headers: tnHeaders,
                    params: { ids: batch.join(','), per_page: batch.length },
                    validateStatus: () => true,
                });
                if (res.status !== 200)
                    continue;
                const products = Array.isArray(res.data) ? res.data : [];
                for (const product of products) {
                    if ((product === null || product === void 0 ? void 0 : product.id) != null)
                        tnProductById.set(String(product.id), product);
                }
            }
            catch (_a) {
                /* ignore batch */
            }
        }
        // Fallback: productos no devueltos por ?ids= (límite o ID inválido)
        const missing = ids.filter((id) => !tnProductById.has(id));
        yield runPool(missing, 4, (tnProductId) => __awaiter(this, void 0, void 0, function* () {
            var _b;
            try {
                const res = yield axios_1.default.get(`https://api.tiendanube.com/v1/${storeId}/products/${tnProductId}`, {
                    headers: tnHeaders,
                    validateStatus: () => true,
                });
                if (res.status === 200 && ((_b = res.data) === null || _b === void 0 ? void 0 : _b.id) != null) {
                    tnProductById.set(String(res.data.id), res.data);
                }
            }
            catch (_c) {
                /* ignore */
            }
        }));
        for (const [tnProductId, entries] of tnProductIds) {
            const product = tnProductById.get(tnProductId);
            const tnVariants = (product === null || product === void 0 ? void 0 : product.variants) || [];
            const fallbackPrice = pickTnProductPrice(tnVariants);
            for (const { variantId, tnVariantId } of entries) {
                if (!prices[variantId])
                    continue;
                const tv = tnVariants.find((x) => String(x === null || x === void 0 ? void 0 : x.id) === String(tnVariantId));
                let price = parseTnPrice(tv);
                if (price <= 0)
                    price = fallbackPrice;
                if (price > 0)
                    prices[variantId].priceTN = price;
            }
        }
    });
}
exports.fetchTnProductsBatched = fetchTnProductsBatched;
function resolveTnStoreId(integration) {
    return String((integration === null || integration === void 0 ? void 0 : integration.store_id) || (integration === null || integration === void 0 ? void 0 : integration.user_id) || '').trim();
}
exports.resolveTnStoreId = resolveTnStoreId;
