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
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadVariantMlLinkContext = loadVariantMlLinkContext;
exports.isPrimaryMlPublication = isPrimaryMlPublication;
exports.shouldSyncMlPublication = shouldSyncMlPublication;
exports.filterMlPublicationsForSync = filterMlPublicationsForSync;
exports.filterTnPublicationsForSync = filterTnPublicationsForSync;
const db_1 = require("../database/db");
function trimOrNull(v) {
    if (v == null)
        return null;
    const s = String(v).trim();
    return s || null;
}
/** Contexto de vínculos ML/TN de una variante y de sus hermanas (mismo producto). */
function loadVariantMlLinkContext(variantId) {
    return __awaiter(this, void 0, void 0, function* () {
        const variant = yield (0, db_1.get)(`SELECT pv.id, pv.mercado_libre_item_id, pv.mercado_libre_variant_id, pv.tienda_nube_variant_id,
            p.mercado_libre_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN products p ON p.id = pc.product_id
     WHERE pv.id = ?`, [variantId]);
        if (!variant)
            return null;
        const siblings = yield (0, db_1.query)(`SELECT pv2.mercado_libre_item_id, pv2.tienda_nube_variant_id
     FROM product_variants pv
     JOIN product_colors pc ON pc.id = pv.product_color_id
     JOIN product_colors pc2 ON pc2.product_id = pc.product_id
     JOIN product_variants pv2 ON pv2.product_color_id = pc2.id
     WHERE pv.id = ? AND pv2.id <> pv.id`, [variantId]);
        const siblingOwnItemIds = new Set();
        const siblingTnVariantIds = new Set();
        for (const row of siblings) {
            const mlItem = trimOrNull(row.mercado_libre_item_id);
            if (mlItem)
                siblingOwnItemIds.add(mlItem);
            const tnVar = trimOrNull(row.tienda_nube_variant_id);
            if (tnVar)
                siblingTnVariantIds.add(tnVar);
        }
        return {
            variantId,
            ownItemId: trimOrNull(variant.mercado_libre_item_id),
            ownVarId: trimOrNull(variant.mercado_libre_variant_id),
            parentItemId: trimOrNull(variant.mercado_libre_id),
            ownTnVariantId: trimOrNull(variant.tienda_nube_variant_id),
            siblingOwnItemIds,
            siblingTnVariantIds
        };
    });
}
function isPrimaryMlPublication(pub, ctx) {
    const itemId = trimOrNull(pub.external_product_id);
    const varId = trimOrNull(pub.external_variant_id);
    if (!itemId)
        return false;
    if (ctx.ownItemId && itemId === ctx.ownItemId) {
        return !ctx.ownVarId || !varId || varId === ctx.ownVarId;
    }
    if (!ctx.ownItemId && ctx.parentItemId && itemId === ctx.parentItemId && ctx.ownVarId && varId === ctx.ownVarId) {
        return true;
    }
    return false;
}
/** Evita enviar stock de una variante a publicaciones ML que pertenecen a otra variante del mismo artículo. */
function shouldSyncMlPublication(pub, ctx) {
    const itemId = trimOrNull(pub.external_product_id);
    if (!itemId)
        return false;
    if (isPrimaryMlPublication(pub, ctx))
        return true;
    if (ctx.siblingOwnItemIds.has(itemId))
        return false;
    return true;
}
function filterMlPublicationsForSync(publications, ctx) {
    const mlPubs = publications.filter((p) => p.platform === 'mercadolibre');
    if (mlPubs.length === 0)
        return [];
    const filtered = mlPubs.filter((p) => shouldSyncMlPublication(p, ctx));
    if (filtered.length > 0)
        return filtered;
    if (ctx.ownItemId) {
        const own = mlPubs.find((p) => trimOrNull(p.external_product_id) === ctx.ownItemId);
        if (own)
            return [own];
    }
    return mlPubs.slice(0, 1);
}
function filterTnPublicationsForSync(publications, ctx) {
    const tnPubs = publications.filter((p) => p.platform === 'tiendanube');
    if (tnPubs.length === 0)
        return [];
    if (!ctx.ownTnVariantId)
        return tnPubs;
    const own = tnPubs.filter((p) => trimOrNull(p.external_variant_id) === ctx.ownTnVariantId);
    if (own.length > 0)
        return own;
    const withoutSiblings = tnPubs.filter((p) => {
        const vid = trimOrNull(p.external_variant_id);
        return !vid || !ctx.siblingTnVariantIds.has(vid);
    });
    return withoutSiblings.length > 0 ? withoutSiblings : tnPubs.slice(0, 1);
}
