"use strict";
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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
exports.deletePublicationBundle = exports.updatePublicationBundle = exports.createPublicationBundle = exports.listPublicationBundles = exports.syncBundlesContainingVariant = exports.syncBundleListingStock = exports.deductStockForBundleListing = exports.computeAvailableStockFromItems = exports.loadBundleById = exports.savePublicationBundleGroup = exports.syncAllBundlesForProduct = exports.listPublicationBundleGroups = exports.findBundlesByProduct = exports.findBundleByListing = void 0;
const uuid_1 = require("uuid");
const db_1 = require("../database/db");
function normExtVariantId(v) {
    return v != null && String(v).trim() !== '' ? String(v).trim() : '';
}
function findBundleByListing(platform, externalProductId, externalVariantId) {
    return __awaiter(this, void 0, void 0, function* () {
        const extProd = String(externalProductId || '').trim();
        const extVar = normExtVariantId(externalVariantId);
        let row = yield (0, db_1.get)(`SELECT id FROM publication_stock_bundles
     WHERE platform = ? AND external_product_id = ? AND external_variant_id = ?`, [platform, extProd, extVar]);
        if (!(row === null || row === void 0 ? void 0 : row.id) && extVar) {
            row = yield (0, db_1.get)(`SELECT id FROM publication_stock_bundles
       WHERE platform = ? AND external_variant_id = ?`, [platform, extVar]);
        }
        if (!(row === null || row === void 0 ? void 0 : row.id) && !extVar) {
            const rows = yield (0, db_1.query)(`SELECT id FROM publication_stock_bundles
       WHERE platform = ? AND external_product_id = ?`, [platform, extProd]);
            if (rows.length === 1) {
                row = rows[0];
            }
        }
        if (!(row === null || row === void 0 ? void 0 : row.id))
            return null;
        return loadBundleById(row.id);
    });
}
exports.findBundleByListing = findBundleByListing;
function findBundlesByProduct(platform, externalProductId) {
    return __awaiter(this, void 0, void 0, function* () {
        const extProd = String(externalProductId || '').trim();
        if (!extProd)
            return [];
        const rows = yield (0, db_1.query)(`SELECT id FROM publication_stock_bundles
     WHERE platform = ? AND external_product_id = ?
     ORDER BY label, external_variant_id`, [platform, extProd]);
        const out = [];
        for (const r of rows) {
            const b = yield loadBundleById(r.id);
            if (b)
                out.push(b);
        }
        return out;
    });
}
exports.findBundlesByProduct = findBundlesByProduct;
function listPublicationBundleGroups() {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const rows = yield (0, db_1.query)(`SELECT platform, external_product_id FROM publication_stock_bundles
       GROUP BY platform, external_product_id
       ORDER BY platform, external_product_id`);
            const out = [];
            for (const r of rows) {
                try {
                    const variants = yield findBundlesByProduct(r.platform, r.external_product_id);
                    if (!variants.length)
                        continue;
                    out.push({
                        platform: r.platform,
                        externalProductId: r.external_product_id,
                        listingLabel: (_b = (_a = variants.find((v) => v.label)) === null || _a === void 0 ? void 0 : _a.label) !== null && _b !== void 0 ? _b : null,
                        variants
                    });
                }
                catch (e) {
                    console.warn('[Bundle] omitiendo grupo', r.external_product_id, (e === null || e === void 0 ? void 0 : e.message) || e);
                }
            }
            return out;
        }
        catch (e) {
            const msg = String((e === null || e === void 0 ? void 0 : e.message) || (e === null || e === void 0 ? void 0 : e.code) || '');
            if (msg.includes("doesn't exist") || (e === null || e === void 0 ? void 0 : e.code) === 'ER_NO_SUCH_TABLE') {
                return [];
            }
            throw e;
        }
    });
}
exports.listPublicationBundleGroups = listPublicationBundleGroups;
function syncAllBundlesForProduct(platform, externalProductId) {
    return __awaiter(this, void 0, void 0, function* () {
        const bundles = yield findBundlesByProduct(platform, externalProductId);
        for (const b of bundles) {
            try {
                yield syncBundleListingStock(b.id);
            }
            catch (e) {
                console.warn(`[Bundle sync] ${b.id}:`, (e === null || e === void 0 ? void 0 : e.message) || e);
            }
        }
    });
}
exports.syncAllBundlesForProduct = syncAllBundlesForProduct;
function savePublicationBundleGroup(input) {
    var _a, _b, _c, _d, _e, _f;
    return __awaiter(this, void 0, void 0, function* () {
        const extProd = String(input.externalProductId || '').trim();
        if (!extProd)
            throw new Error('externalProductId es requerido');
        if (!((_a = input.variants) === null || _a === void 0 ? void 0 : _a.length))
            throw new Error('Agregá al menos una variante de pack (combinación de colores)');
        const existing = yield findBundlesByProduct(input.platform, extProd);
        const existingById = new Map(existing.map((b) => [b.id, b]));
        const keptIds = new Set();
        for (const v of input.variants) {
            const items = ((_b = v.items) === null || _b === void 0 ? void 0 : _b.filter((it) => { var _a; return (_a = it.variantId) === null || _a === void 0 ? void 0 : _a.trim(); })) || [];
            if (!items.length)
                continue;
            const label = ((_c = v.label) === null || _c === void 0 ? void 0 : _c.trim()) ||
                ((_d = input.listingLabel) === null || _d === void 0 ? void 0 : _d.trim()) ||
                null;
            const payload = {
                label,
                externalVariantId: v.externalVariantId,
                items
            };
            if (v.id && existingById.has(v.id)) {
                const updated = yield updatePublicationBundle(v.id, payload);
                if (updated)
                    keptIds.add(v.id);
            }
            else {
                const created = yield createPublicationBundle({
                    platform: input.platform,
                    externalProductId: extProd,
                    externalVariantId: v.externalVariantId,
                    label: label !== null && label !== void 0 ? label : undefined,
                    items
                });
                keptIds.add(created.id);
            }
        }
        for (const b of existing) {
            if (!keptIds.has(b.id))
                yield deletePublicationBundle(b.id);
        }
        yield syncAllBundlesForProduct(input.platform, extProd);
        const variants = yield findBundlesByProduct(input.platform, extProd);
        return {
            platform: input.platform,
            externalProductId: extProd,
            listingLabel: ((_e = input.listingLabel) === null || _e === void 0 ? void 0 : _e.trim()) || ((_f = variants[0]) === null || _f === void 0 ? void 0 : _f.label) || null,
            variants
        };
    });
}
exports.savePublicationBundleGroup = savePublicationBundleGroup;
function loadBundleItems(bundleId) {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield (0, db_1.query)(`
    SELECT
      bi.id,
      bi.variant_id,
      bi.units_per_sale,
      bi.sort_order,
      pv.sku,
      p.name AS product_name,
      pc.name AS color_name,
      COALESCE(sz.size_code, sz.name, '') AS size_code,
      COALESCE(s.stock, 0) AS stock
    FROM publication_stock_bundle_items bi
    JOIN product_variants pv ON pv.id = bi.variant_id
    JOIN product_colors pc ON pc.id = pv.product_color_id
    JOIN products p ON p.id = pc.product_id
    LEFT JOIN sizes sz ON sz.id = pv.size_id
    LEFT JOIN stocks s ON s.variant_id = bi.variant_id
    WHERE bi.bundle_id = ?
    ORDER BY bi.sort_order ASC, bi.id ASC
    `, [bundleId]);
        return rows.map((r) => {
            var _a, _b, _c, _d;
            return ({
                id: r.id,
                variantId: r.variant_id,
                unitsPerSale: Math.max(1, Number(r.units_per_sale) || 1),
                sortOrder: Number(r.sort_order) || 0,
                sku: (_a = r.sku) !== null && _a !== void 0 ? _a : '',
                productName: (_b = r.product_name) !== null && _b !== void 0 ? _b : '',
                colorName: (_c = r.color_name) !== null && _c !== void 0 ? _c : '',
                sizeCode: (_d = r.size_code) !== null && _d !== void 0 ? _d : '',
                stock: Number(r.stock) || 0
            });
        });
    });
}
function loadBundleById(bundleId) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const row = yield (0, db_1.get)(`SELECT id, platform, external_product_id, external_variant_id, label FROM publication_stock_bundles WHERE id = ?`, [bundleId]);
        if (!(row === null || row === void 0 ? void 0 : row.id))
            return null;
        const items = yield loadBundleItems(bundleId);
        const availableStock = computeAvailableStockFromItems(items);
        return {
            id: row.id,
            platform: row.platform,
            externalProductId: row.external_product_id,
            externalVariantId: (_a = row.external_variant_id) !== null && _a !== void 0 ? _a : '',
            label: row.label != null ? String(row.label) : null,
            items,
            availableStock
        };
    });
}
exports.loadBundleById = loadBundleById;
function computeAvailableStockFromItems(items) {
    if (!items.length)
        return 0;
    let minPacks = Infinity;
    for (const it of items) {
        const u = Math.max(1, it.unitsPerSale);
        const stock = Math.max(0, Number(it.stock) || 0);
        minPacks = Math.min(minPacks, Math.floor(stock / u));
    }
    return minPacks === Infinity ? 0 : Math.max(0, minPacks);
}
exports.computeAvailableStockFromItems = computeAvailableStockFromItems;
/** Descuenta stock de cada componente al vender `quantitySold` packs de la publicación. */
function deductStockForBundleListing(bundle, quantitySold, movementType, reference) {
    return __awaiter(this, void 0, void 0, function* () {
        const qty = Math.max(0, Math.floor(Number(quantitySold) || 0));
        if (qty <= 0 || !bundle.items.length)
            return { ok: true, lines: [] };
        const { updateVariantStock } = yield Promise.resolve().then(() => __importStar(require('../controllers/stock.controller')));
        const lines = [];
        let allOk = true;
        for (const it of bundle.items) {
            const units = qty * Math.max(1, it.unitsPerSale);
            const row = yield (0, db_1.get)(`SELECT COALESCE(stock, 0) AS stock FROM stocks WHERE variant_id = ?`, [it.variantId]);
            const current = Number(row === null || row === void 0 ? void 0 : row.stock) || 0;
            const newStock = Math.max(0, current - units);
            const ok = yield updateVariantStock(it.variantId, newStock, movementType, reference, true);
            if (!ok)
                allOk = false;
            lines.push(`${it.sku || it.variantId}: -${units} (${qty} pack × ${it.unitsPerSale} ${it.colorName || ''}) ${current}→${newStock}`);
        }
        return { ok: allOk, lines };
    });
}
exports.deductStockForBundleListing = deductStockForBundleListing;
/** Sincroniza stock de la publicación del pack según el mínimo de sus componentes. */
function syncBundleListingStock(bundleId) {
    return __awaiter(this, void 0, void 0, function* () {
        const bundle = yield loadBundleById(bundleId);
        if (!bundle || bundle.items.length === 0)
            return;
        const stockToSend = computeAvailableStockFromItems(bundle.items);
        const { updateMercadoLibreStockByItem, updateMercadoLibreStockByVariant, updateTiendaNubeStock } = yield Promise.resolve().then(() => __importStar(require('../controllers/stock.controller')));
        const itemId = bundle.externalProductId;
        const variationId = normExtVariantId(bundle.externalVariantId);
        if (bundle.platform === 'mercadolibre') {
            if (variationId) {
                yield updateMercadoLibreStockByVariant(itemId, variationId, stockToSend);
            }
            else {
                yield updateMercadoLibreStockByItem(itemId, stockToSend);
            }
        }
        else if (bundle.platform === 'tiendanube' && variationId) {
            yield updateTiendaNubeStock(itemId, variationId, stockToSend);
        }
    });
}
exports.syncBundleListingStock = syncBundleListingStock;
/** Tras cambiar stock de una variante, actualizar publicaciones pack que la incluyen. */
function syncBundlesContainingVariant(variantId) {
    return __awaiter(this, void 0, void 0, function* () {
        const bundles = yield (0, db_1.query)(`SELECT DISTINCT bundle_id AS id FROM publication_stock_bundle_items WHERE variant_id = ?`, [variantId]);
        for (const b of bundles) {
            if (b === null || b === void 0 ? void 0 : b.id) {
                try {
                    yield syncBundleListingStock(b.id);
                }
                catch (e) {
                    console.warn(`[Bundle sync] bundle ${b.id}:`, (e === null || e === void 0 ? void 0 : e.message) || e);
                }
            }
        }
    });
}
exports.syncBundlesContainingVariant = syncBundlesContainingVariant;
function listPublicationBundles() {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield (0, db_1.query)(`SELECT id FROM publication_stock_bundles ORDER BY platform, label, external_product_id`);
        const out = [];
        for (const r of rows) {
            const b = yield loadBundleById(r.id);
            if (b)
                out.push(b);
        }
        return out;
    });
}
exports.listPublicationBundles = listPublicationBundles;
function createPublicationBundle(input) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const id = (0, uuid_1.v4)();
        const extVar = normExtVariantId(input.externalVariantId);
        yield (0, db_1.execute)(`INSERT INTO publication_stock_bundles (id, platform, external_product_id, external_variant_id, label)
     VALUES (?, ?, ?, ?, ?)`, [id, input.platform, String(input.externalProductId).trim(), extVar, ((_a = input.label) === null || _a === void 0 ? void 0 : _a.trim()) || null]);
        let order = 0;
        for (const it of input.items) {
            if (!((_b = it.variantId) === null || _b === void 0 ? void 0 : _b.trim()))
                continue;
            yield (0, db_1.execute)(`INSERT INTO publication_stock_bundle_items (id, bundle_id, variant_id, units_per_sale, sort_order)
       VALUES (?, ?, ?, ?, ?)`, [(0, uuid_1.v4)(), id, it.variantId.trim(), Math.max(1, Math.floor(Number(it.unitsPerSale) || 1)), order++]);
        }
        const bundle = (yield loadBundleById(id));
        yield syncBundleListingStock(id);
        return bundle;
    });
}
exports.createPublicationBundle = createPublicationBundle;
function updatePublicationBundle(bundleId, input) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const existing = yield (0, db_1.get)(`SELECT id FROM publication_stock_bundles WHERE id = ?`, [bundleId]);
        if (!existing)
            return null;
        if (input.label !== undefined) {
            yield (0, db_1.execute)(`UPDATE publication_stock_bundles SET label = ? WHERE id = ?`, [
                ((_a = input.label) === null || _a === void 0 ? void 0 : _a.trim()) || null,
                bundleId
            ]);
        }
        if (input.externalProductId !== undefined) {
            yield (0, db_1.execute)(`UPDATE publication_stock_bundles SET external_product_id = ? WHERE id = ?`, [
                String(input.externalProductId).trim(),
                bundleId
            ]);
        }
        if (input.externalVariantId !== undefined) {
            yield (0, db_1.execute)(`UPDATE publication_stock_bundles SET external_variant_id = ? WHERE id = ?`, [
                normExtVariantId(input.externalVariantId),
                bundleId
            ]);
        }
        if (input.items !== undefined) {
            yield (0, db_1.execute)(`DELETE FROM publication_stock_bundle_items WHERE bundle_id = ?`, [bundleId]);
            let order = 0;
            for (const it of input.items) {
                if (!((_b = it.variantId) === null || _b === void 0 ? void 0 : _b.trim()))
                    continue;
                yield (0, db_1.execute)(`INSERT INTO publication_stock_bundle_items (id, bundle_id, variant_id, units_per_sale, sort_order)
         VALUES (?, ?, ?, ?, ?)`, [(0, uuid_1.v4)(), bundleId, it.variantId.trim(), Math.max(1, Math.floor(Number(it.unitsPerSale) || 1)), order++]);
            }
        }
        const bundle = yield loadBundleById(bundleId);
        if (bundle)
            yield syncBundleListingStock(bundleId);
        return bundle;
    });
}
exports.updatePublicationBundle = updatePublicationBundle;
function deletePublicationBundle(bundleId) {
    return __awaiter(this, void 0, void 0, function* () {
        const r = yield (0, db_1.execute)(`DELETE FROM publication_stock_bundles WHERE id = ?`, [bundleId]);
        return ((r === null || r === void 0 ? void 0 : r.affectedRows) || 0) > 0;
    });
}
exports.deletePublicationBundle = deletePublicationBundle;
