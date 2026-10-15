"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTnVariantStock = readTnVariantStock;
exports.buildTnStockUpdateBody = buildTnStockUpdateBody;

function levelStock(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function readTnVariantStock(variant) {
    const levels = Array.isArray(variant === null || variant === void 0 ? void 0 : variant.inventory_levels)
        ? variant.inventory_levels
        : [];
    if (levels.length > 0) {
        let sum = 0;
        let any = false;
        for (const lv of levels) {
            if ((lv === null || lv === void 0 ? void 0 : lv.stock) === '' || (lv === null || lv === void 0 ? void 0 : lv.stock) == null)
                continue;
            const n = Number(lv.stock);
            if (!Number.isFinite(n))
                continue;
            sum += n;
            any = true;
        }
        if (any)
            return sum;
    }
    if ((variant === null || variant === void 0 ? void 0 : variant.stock) === '' || (variant === null || variant === void 0 ? void 0 : variant.stock) == null)
        return null;
    const n = Number(variant.stock);
    return Number.isFinite(n) ? n : null;
}

function buildTnStockUpdateBody(desired, variant) {
    const qty = Math.max(0, Math.floor(Number(desired) || 0));
    const levels = Array.isArray(variant === null || variant === void 0 ? void 0 : variant.inventory_levels)
        ? variant.inventory_levels
        : [];
    if (levels.length === 0)
        return { stock: qty };
    const parsed = levels.map((lv) => ({
        location_id: (lv === null || lv === void 0 ? void 0 : lv.location_id) != null && String(lv.location_id).trim()
            ? String(lv.location_id).trim()
            : undefined,
        stock: levelStock(lv === null || lv === void 0 ? void 0 : lv.stock),
    }));
    const others = parsed.slice(1).reduce((sum, lv) => sum + lv.stock, 0);
    const wipeOthers = qty - others < 0;
    return {
        inventory_levels: parsed.map((lv, i) => {
            const stock = wipeOthers ? (i === 0 ? qty : 0) : i === 0 ? qty - others : lv.stock;
            return lv.location_id ? { location_id: lv.location_id, stock } : { stock };
        }),
    };
}
