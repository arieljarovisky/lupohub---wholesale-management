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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportInventory = exports.importTangoArticles = exports.deleteProduct = exports.deleteVariant = exports.deleteAllProducts = exports.bulkLinkVariants = exports.updateVariantExternalIds = exports.updateProductExternalIds = exports.updateProduct = exports.patchStock = exports.getProductBySku = exports.getProductStockTotalBySku = exports.getVariantIdBySkuColorSize = exports.createProduct = exports.getProducts = void 0;
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const talles_tango_1 = require("../talles-tango");
const getProducts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = '1', per_page = '20', q = '', sort = 'sku', dir = 'asc', sync_ml, sync_tn, sync_none, skip_total } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const perPageNum = Math.min(5000, Math.max(1, parseInt(per_page, 10) || 20));
        const offset = (pageNum - 1) * perPageNum;
        const sortCol = (sort === 'stock' ? 'stock_total' : sort === 'name' ? 'p.name' : 'pv.sku');
        const sortDir = (dir === 'desc' ? 'DESC' : 'ASC');
        const search = (q || '').toString().trim();
        const filterSyncMl = sync_ml === '1' || sync_ml === 'true';
        const filterSyncTn = sync_tn === '1' || sync_tn === 'true';
        const filterSyncNone = sync_none === '1' || sync_none === 'true';
        const skipTotal = skip_total === '1' || skip_total === 'true';
        const conditions = ['1=1'];
        const params = [];
        if (search) {
            conditions.push('(pv.sku LIKE ? OR p.sku LIKE ? OR p.name LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (filterSyncNone) {
            conditions.push('(p.mercado_libre_id IS NULL OR p.mercado_libre_id = \'\') AND (p.tienda_nube_id IS NULL OR p.tienda_nube_id = \'\')');
        }
        else {
            if (filterSyncMl) {
                conditions.push('p.mercado_libre_id IS NOT NULL AND p.mercado_libre_id != \'\'');
            }
            if (filterSyncTn) {
                conditions.push('p.tienda_nube_id IS NOT NULL AND p.tienda_nube_id != \'\'');
            }
        }
        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        let total = 0;
        if (!skipTotal) {
            const totalRow = yield (0, db_1.get)(`
      SELECT COUNT(*) AS total
      FROM products p
      JOIN product_colors pc ON pc.product_id = p.id
      JOIN product_variants pv ON pv.product_color_id = pc.id
      ${whereClause}
      `, params);
            total = Number((totalRow === null || totalRow === void 0 ? void 0 : totalRow.total) || 0);
        }
        const rows = yield (0, db_1.query)(`
      SELECT pv.id, pv.sku, p.name, p.category, p.base_price,
             p.id AS product_id, p.sku AS base_sku,
             p.tienda_nube_id, p.mercado_libre_id,
             COALESCE(st.stock, 0) AS stock_total
      FROM products p
      JOIN product_colors pc ON pc.product_id = p.id
      JOIN product_variants pv ON pv.product_color_id = pc.id
      LEFT JOIN stocks st ON st.variant_id = pv.id
      ${whereClause}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ? OFFSET ?
      `, [...params, perPageNum, offset]);
        const mapped = (rows || []).map((r) => {
            var _a, _b;
            return ({
                id: r.id,
                sku: r.sku,
                base_sku: r.base_sku,
                product_id: r.product_id,
                name: r.name,
                category: r.category,
                base_price: Number((_a = r.base_price) !== null && _a !== void 0 ? _a : 0),
                stock_total: Number((_b = r.stock_total) !== null && _b !== void 0 ? _b : 0),
                externalIds: {
                    tiendaNube: r.tienda_nube_id,
                    mercadoLibre: r.mercado_libre_id
                }
            });
        });
        res.json({ items: mapped, page: pageNum, per_page: perPageNum, total });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error fetching products" });
    }
});
exports.getProducts = getProducts;
const createProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
    const body = req.body || {};
    const sku = body.sku != null ? String(body.sku).trim() : '';
    const name = body.name != null ? String(body.name).trim() : '';
    console.log('[createProduct] body.sku=', body.sku, 'body.name=', body.name, '-> parsed sku=', sku, 'name=', name);
    if (!sku || !name) {
        console.log('[createProduct] Rechazado: SKU o nombre vacío');
        return res.status(400).json({ message: "SKU y Nombre son requeridos" });
    }
    const category = body.category != null ? String(body.category) : null;
    const basePrice = body.base_price != null ? Number(body.base_price) : (body.price != null ? Number(body.price) : 0);
    const description = body.description != null ? String(body.description) : null;
    const initialStock = body.stock != null ? Math.max(0, parseInt(String(body.stock), 10) || 0) : (body.stock_total != null ? Math.max(0, parseInt(String(body.stock_total), 10) || 0) : 0);
    const parts = sku.split('-');
    const isVariantSkuWithDashes = parts.length >= 3;
    let baseSku = sku;
    let sizeCode = null;
    let colorCode = null;
    if (body.base_sku != null && String(body.base_sku).trim() !== '') {
        baseSku = String(body.base_sku).trim();
        const sz = (_a = body.sizeCode) !== null && _a !== void 0 ? _a : body.size;
        const cl = (_b = body.colorCode) !== null && _b !== void 0 ? _b : body.color;
        if (sz != null && cl != null) {
            sizeCode = String(sz).trim();
            colorCode = String(cl).trim();
        }
    }
    if (sizeCode == null || colorCode == null) {
        if (isVariantSkuWithDashes) {
            baseSku = parts.slice(0, -2).join('-');
            sizeCode = parts[parts.length - 2];
            colorCode = parts[parts.length - 1];
        }
        else if (sku.length >= 13 && !sku.includes('-')) {
            const parsed = parseCodigoTango(sku);
            if (parsed.codigo13.length >= 13) {
                baseSku = parsed.articulo;
                sizeCode = parsed.talle;
                colorCode = parsed.color;
            }
        }
    }
    const isVariantSku = (sizeCode != null && colorCode != null && (baseSku !== sku || (body.base_sku != null && String(body.base_sku).trim() !== '')));
    if (isVariantSku) {
        // Crear como variante: producto padre + product_colors + product_variants + stocks (igual que import Tango)
        try {
            let productId = ((_c = (yield (0, db_1.get)(`SELECT id FROM products WHERE sku = ?`, [baseSku]))) === null || _c === void 0 ? void 0 : _c.id) || null;
            if (!productId) {
                productId = (0, uuid_1.v4)();
                yield (0, db_1.execute)(`INSERT INTO products (id, sku, name, category, base_price, description) VALUES (?, ?, ?, ?, ?, ?)`, [productId, baseSku, name, category !== null && category !== void 0 ? category : 'General', basePrice, description]);
            }
            let sizeId = (_d = (yield (0, db_1.get)(`SELECT id FROM sizes WHERE size_code = ?`, [sizeCode]))) === null || _d === void 0 ? void 0 : _d.id;
            if (!sizeId) {
                return res.status(400).json({
                    message: `No existe el talle con código "${sizeCode}". Creálo en Configuración > Talles.`,
                });
            }
            let colorId = (_e = (yield (0, db_1.get)(`SELECT id FROM colors WHERE code = ?`, [colorCode]))) === null || _e === void 0 ? void 0 : _e.id;
            if (!colorId) {
                colorId = (_f = (yield (0, db_1.get)(`SELECT id FROM colors WHERE name = ?`, [colorCode]))) === null || _f === void 0 ? void 0 : _f.id;
            }
            if (!colorId) {
                return res.status(400).json({
                    message: `No existe el color con código "${colorCode}". Creálo en Configuración > Colores.`,
                });
            }
            let productColorId = (_g = (yield (0, db_1.get)(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId]))) === null || _g === void 0 ? void 0 : _g.id;
            if (!productColorId) {
                productColorId = (0, uuid_1.v4)();
                yield (0, db_1.execute)(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [productColorId, productId, colorId]);
            }
            const existingVariant = yield (0, db_1.get)(`SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ?`, [productColorId, sizeId]);
            if (existingVariant) {
                return res.status(409).json({ message: "La variante ya existe para este artículo, talle y color." });
            }
            const variantId = (0, uuid_1.v4)();
            yield (0, db_1.execute)(`INSERT INTO product_variants (id, product_color_id, size_id, sku) VALUES (?, ?, ?, ?)`, [variantId, productColorId, sizeId, sku]);
            yield (0, db_1.execute)(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`, [variantId, initialStock]);
            const productRow = yield (0, db_1.get)(`SELECT name, category, base_price, tienda_nube_id, mercado_libre_id FROM products WHERE id = ?`, [productId]);
            console.log('[createProduct] Variante creada:', sku, 'variantId=', variantId);
            return res.status(201).json({
                id: variantId,
                sku,
                name: (_h = productRow === null || productRow === void 0 ? void 0 : productRow.name) !== null && _h !== void 0 ? _h : name,
                category: (_k = (_j = productRow === null || productRow === void 0 ? void 0 : productRow.category) !== null && _j !== void 0 ? _j : category) !== null && _k !== void 0 ? _k : 'General',
                base_price: Number((_l = productRow === null || productRow === void 0 ? void 0 : productRow.base_price) !== null && _l !== void 0 ? _l : basePrice),
                description: (_o = (_m = productRow === null || productRow === void 0 ? void 0 : productRow.description) !== null && _m !== void 0 ? _m : description) !== null && _o !== void 0 ? _o : undefined,
                externalIds: {
                    tiendaNube: (_p = productRow === null || productRow === void 0 ? void 0 : productRow.tienda_nube_id) !== null && _p !== void 0 ? _p : undefined,
                    mercadoLibre: (_q = productRow === null || productRow === void 0 ? void 0 : productRow.mercado_libre_id) !== null && _q !== void 0 ? _q : undefined,
                },
            });
        }
        catch (error) {
            console.error('[createProduct] Error variante:', error === null || error === void 0 ? void 0 : error.code, error === null || error === void 0 ? void 0 : error.message);
            if (error.code === 'ER_DUP_ENTRY' || (error.message && error.message.includes('Duplicate entry'))) {
                return res.status(409).json({ message: "La variante ya existe." });
            }
            return res.status(500).json({ message: "Error creando variante", detail: error === null || error === void 0 ? void 0 : error.message });
        }
    }
    // SKU simple: un solo producto en tabla products (sin variantes)
    const id = (0, uuid_1.v4)();
    try {
        yield (0, db_1.execute)(`INSERT INTO products (id, sku, name, category, base_price, description) 
       VALUES (?, ?, ?, ?, ?, ?)`, [id, sku, name, category, basePrice, description]);
        console.log('[createProduct] INSERT OK:', sku);
        res.status(201).json({ id, sku, name, category: category !== null && category !== void 0 ? category : undefined, base_price: basePrice, description: description !== null && description !== void 0 ? description : undefined });
    }
    catch (error) {
        console.error('[createProduct] Error INSERT:', error === null || error === void 0 ? void 0 : error.code, error === null || error === void 0 ? void 0 : error.message);
        if (error.code === 'ER_DUP_ENTRY' || (error.message && error.message.includes('Duplicate entry'))) {
            return res.status(409).json({ message: "El SKU ya existe" });
        }
        res.status(500).json({ message: "Error creating product", detail: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.createProduct = createProduct;
const getVariantIdBySkuColorSize = (sku, colorCode, sizeCode) => __awaiter(void 0, void 0, void 0, function* () {
    const row = yield (0, db_1.get)(`SELECT pv.id AS variant_id
     FROM products p
     JOIN product_colors pc ON pc.product_id = p.id
     JOIN colors c ON c.id = pc.color_id
     JOIN product_variants pv ON pv.product_color_id = pc.id
     JOIN sizes s ON s.id = pv.size_id
     WHERE p.sku = ? AND c.code = ? AND s.size_code = ?`, [sku, colorCode, sizeCode]);
    return (row === null || row === void 0 ? void 0 : row.variant_id) || null;
});
exports.getVariantIdBySkuColorSize = getVariantIdBySkuColorSize;
const getProductStockTotalBySku = (sku) => __awaiter(void 0, void 0, void 0, function* () {
    const row = yield (0, db_1.get)(`SELECT COALESCE(SUM(st.stock), 0) AS stock_total
     FROM products p
     LEFT JOIN product_colors pc ON pc.product_id = p.id
     LEFT JOIN product_variants pv ON pv.product_color_id = pc.id
     LEFT JOIN stocks st ON st.variant_id = pv.id
     WHERE p.sku = ?`, [sku]);
    return Number((row === null || row === void 0 ? void 0 : row.stock_total) || 0);
});
exports.getProductStockTotalBySku = getProductStockTotalBySku;
const getProductBySku = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { sku } = req.params;
    try {
        // Buscar por SKU exacto o por SKU base (para agrupar variantes)
        let product = yield (0, db_1.get)(`SELECT p.id, p.sku, p.name, p.category, p.base_price, p.tienda_nube_id, p.mercado_libre_id,
              COALESCE(p.mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
              COALESCE(p.tienda_nube_pack_size, 1) AS tienda_nube_pack_size
       FROM products p WHERE p.sku = ?`, [sku]);
        // Si no se encuentra exacto, buscar por SKU base
        if (!product) {
            product = yield (0, db_1.get)(`SELECT p.id, p.sku, p.name, p.category, p.base_price, p.tienda_nube_id, p.mercado_libre_id,
                COALESCE(p.mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
                COALESCE(p.tienda_nube_pack_size, 1) AS tienda_nube_pack_size
         FROM products p WHERE p.sku LIKE ? ORDER BY p.sku LIMIT 1`, [`${sku}-%`]);
        }
        if (!product)
            return res.status(404).json({ message: 'Producto no encontrado' });
        // Obtener todas las variantes del producto encontrado
        const variantsRows = yield (0, db_1.query)(`SELECT p.sku, pv.sku AS variant_sku, pv.external_sku,
              c.code AS color_code, c.name AS color_name,
              s.size_code, COALESCE(st.stock,0) AS stock, pv.id AS variant_id,
              pv.tienda_nube_variant_id, pv.mercado_libre_variant_id
       FROM products p
       JOIN product_colors pc ON pc.product_id=p.id
       JOIN colors c ON c.id=pc.color_id
       JOIN product_variants pv ON pv.product_color_id=pc.id
       JOIN sizes s ON s.id=pv.size_id
       LEFT JOIN stocks st ON st.variant_id=pv.id
       WHERE p.id=?
       ORDER BY c.code, s.size_code`, [product.id]);
        const variants = variantsRows.map((v) => (Object.assign(Object.assign({}, v), { externalIds: {
                tiendaNubeVariant: v.tienda_nube_variant_id,
                mercadoLibreVariant: v.mercado_libre_variant_id
            } })));
        const stock_total = variants.reduce((sum, v) => sum + Number(v.stock || 0), 0);
        res.json(Object.assign(Object.assign({}, product), { externalIds: {
                tiendaNube: product.tienda_nube_id,
                mercadoLibre: product.mercado_libre_id
            }, stock_total,
            variants }));
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error obteniendo producto' });
    }
});
exports.getProductBySku = getProductBySku;
const patchStock = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { variantId, sku, colorCode, sizeCode, stock } = req.body;
    try {
        let vId = variantId || null;
        if (!vId) {
            if (!sku || !colorCode || !sizeCode)
                return res.status(400).json({ message: 'Debe enviar variantId o sku+colorCode+sizeCode' });
            vId = yield (0, exports.getVariantIdBySkuColorSize)(sku, colorCode, sizeCode);
            if (!vId)
                return res.status(404).json({ message: 'Variante no encontrada' });
        }
        // Usar el nuevo sistema de stock con historial y sincronizaci?n
        const { updateVariantStock } = yield Promise.resolve().then(() => __importStar(require('./stock.controller')));
        const success = yield updateVariantStock(vId, Number(stock), 'AJUSTE_MANUAL');
        if (!success) {
            return res.status(500).json({ message: 'Error actualizando stock' });
        }
        res.json({ variantId: vId, stock });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error actualizando stock' });
    }
});
exports.patchStock = patchStock;
const updateProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const { name, category, base_price, description, mercadoLibrePackSize, tiendaNubePackSize } = req.body;
    if (!id)
        return res.status(400).json({ message: 'ID inv?lido' });
    try {
        const mlPack = mercadoLibrePackSize != null ? Math.max(1, Math.floor(Number(mercadoLibrePackSize))) : null;
        const tnPack = tiendaNubePackSize != null ? Math.max(1, Math.floor(Number(tiendaNubePackSize))) : null;
        yield (0, db_1.execute)(`UPDATE products SET 
         name = COALESCE(?, name),
         category = COALESCE(?, category),
         base_price = COALESCE(?, base_price),
         description = COALESCE(?, description),
         mercado_libre_pack_size = COALESCE(?, mercado_libre_pack_size),
         tienda_nube_pack_size = COALESCE(?, tienda_nube_pack_size)
       WHERE id = ?`, [name !== null && name !== void 0 ? name : null, category !== null && category !== void 0 ? category : null, base_price !== null && base_price !== void 0 ? base_price : null, description !== null && description !== void 0 ? description : null, mlPack, tnPack, id]);
        const updated = yield (0, db_1.get)(`SELECT id, sku, name, category, base_price, description,
      COALESCE(mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
      COALESCE(tienda_nube_pack_size, 1) AS tienda_nube_pack_size FROM products WHERE id = ?`, [id]);
        if (!updated)
            return res.status(404).json({ message: 'Producto no encontrado' });
        res.json(updated);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error actualizando producto' });
    }
});
exports.updateProduct = updateProduct;
const updateProductExternalIds = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const { tiendaNubeId, mercadoLibreId } = req.body;
    if (!id)
        return res.status(400).json({ message: 'ID inv?lido' });
    try {
        yield (0, db_1.execute)(`UPDATE products SET 
         tienda_nube_id = COALESCE(?, tienda_nube_id),
         mercado_libre_id = COALESCE(?, mercado_libre_id)
       WHERE id = ?`, [tiendaNubeId !== null && tiendaNubeId !== void 0 ? tiendaNubeId : null, mercadoLibreId !== null && mercadoLibreId !== void 0 ? mercadoLibreId : null, id]);
        res.json({ id, tiendaNubeId, mercadoLibreId });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error actualizando IDs externos del producto' });
    }
});
exports.updateProductExternalIds = updateProductExternalIds;
const updateVariantExternalIds = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const { variantId } = req.params;
    const { tiendaNubeVariantId, mercadoLibreVariantId, mercadoLibreItemId, externalSku } = req.body;
    if (!variantId)
        return res.status(400).json({ message: 'ID de variante inv?lido' });
    try {
        yield (0, db_1.execute)(`UPDATE product_variants SET 
         tienda_nube_variant_id = COALESCE(?, tienda_nube_variant_id),
         mercado_libre_variant_id = COALESCE(?, mercado_libre_variant_id),
         external_sku = COALESCE(?, external_sku)
       WHERE id = ?`, [tiendaNubeVariantId !== null && tiendaNubeVariantId !== void 0 ? tiendaNubeVariantId : null, mercadoLibreVariantId !== null && mercadoLibreVariantId !== void 0 ? mercadoLibreVariantId : null, externalSku !== undefined ? externalSku : null, variantId]);
        let stockFromML = null;
        const mlItemId = mercadoLibreItemId !== null && mercadoLibreItemId !== void 0 ? mercadoLibreItemId : null;
        const mlVariantId = mercadoLibreVariantId !== null && mercadoLibreVariantId !== void 0 ? mercadoLibreVariantId : null;
        if (mlItemId) {
            const productRow = yield (0, db_1.get)(`SELECT p.id AS product_id FROM products p
         JOIN product_colors pc ON pc.product_id = p.id
         JOIN product_variants pv ON pv.product_color_id = pc.id
         WHERE pv.id = ? LIMIT 1`, [variantId]);
            if (productRow === null || productRow === void 0 ? void 0 : productRow.product_id) {
                yield (0, db_1.execute)(`UPDATE products SET mercado_libre_id = COALESCE(?, mercado_libre_id) WHERE id = ?`, [mlItemId, productRow.product_id]);
            }
            const integration = yield (0, db_1.get)(`SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`);
            if (integration === null || integration === void 0 ? void 0 : integration.access_token) {
                try {
                    const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${mlItemId}?include_attributes=all`, { headers: { Authorization: `Bearer ${integration.access_token}` } });
                    const item = itemRes.data;
                    const variations = (item === null || item === void 0 ? void 0 : item.variations) || [];
                    let qty = 0;
                    if (variations.length > 0) {
                        const v = mlVariantId
                            ? variations.find((x) => String(x.id) === String(mlVariantId))
                            : variations[0];
                        qty = v ? ((_a = v.available_quantity) !== null && _a !== void 0 ? _a : 0) : 0;
                    }
                    else {
                        qty = (_b = item.available_quantity) !== null && _b !== void 0 ? _b : 0;
                    }
                    yield (0, db_1.execute)(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`, [variantId, qty]);
                    stockFromML = qty;
                }
                catch (mlErr) {
                    console.error('[updateVariantExternalIds] Error trayendo stock de ML:', ((_c = mlErr === null || mlErr === void 0 ? void 0 : mlErr.response) === null || _c === void 0 ? void 0 : _c.data) || (mlErr === null || mlErr === void 0 ? void 0 : mlErr.message));
                }
            }
        }
        res.json({
            variantId,
            tiendaNubeVariantId,
            mercadoLibreVariantId,
            externalSku: externalSku !== null && externalSku !== void 0 ? externalSku : undefined,
            stockFromML: stockFromML !== null && stockFromML !== void 0 ? stockFromML : undefined
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error actualizando IDs externos de variante' });
    }
});
exports.updateVariantExternalIds = updateVariantExternalIds;
/** Vinculaci?n en lote: actualiza IDs externos de varias variantes y opcionalmente el producto padre. No trae stock de ML. */
const bulkLinkVariants = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    const body = req.body || {};
    const { productId, mercadoLibreItemId, tiendaNubeProductId, links } = body;
    if (!links || !Array.isArray(links) || links.length === 0) {
        console.warn('[bulkLinkVariants] Body recibido sin links v?lidos:', { hasBody: !!req.body, keys: body ? Object.keys(body) : [], linksLength: links === null || links === void 0 ? void 0 : links.length });
        return res.status(400).json({ message: 'Se requiere un array "links" con al menos un elemento' });
    }
    try {
        console.log('[bulkLinkVariants] Actualizando', links.length, 'variantes, productId:', productId, 'ML:', mercadoLibreItemId, 'TN:', tiendaNubeProductId);
        let resolvedProductId = productId;
        if ((mercadoLibreItemId || tiendaNubeProductId) && !resolvedProductId && links.length > 0) {
            const row = yield (0, db_1.get)(`SELECT p.id AS product_id FROM products p
         JOIN product_colors pc ON pc.product_id = p.id
         JOIN product_variants pv ON pv.product_color_id = pc.id
         WHERE pv.id = ? LIMIT 1`, [links[0].variantId]);
            resolvedProductId = (_a = row === null || row === void 0 ? void 0 : row.product_id) !== null && _a !== void 0 ? _a : undefined;
        }
        if (resolvedProductId) {
            if (tiendaNubeProductId != null && tiendaNubeProductId !== '') {
                yield (0, db_1.execute)(`UPDATE products SET tienda_nube_id = ? WHERE id = ?`, [String(tiendaNubeProductId), resolvedProductId]);
            }
            if (mercadoLibreItemId != null && mercadoLibreItemId !== '') {
                yield (0, db_1.execute)(`UPDATE products SET mercado_libre_id = ? WHERE id = ?`, [String(mercadoLibreItemId), resolvedProductId]);
            }
        }
        for (const link of links) {
            const { variantId, mercadoLibreVariantId, tiendaNubeVariantId, externalSku } = link;
            if (!variantId)
                continue;
            yield (0, db_1.execute)(`UPDATE product_variants SET
           tienda_nube_variant_id = COALESCE(?, tienda_nube_variant_id),
           mercado_libre_variant_id = COALESCE(?, mercado_libre_variant_id),
           external_sku = COALESCE(?, external_sku)
         WHERE id = ?`, [
                tiendaNubeVariantId != null && tiendaNubeVariantId !== '' ? String(tiendaNubeVariantId) : null,
                mercadoLibreVariantId != null && mercadoLibreVariantId !== '' ? String(mercadoLibreVariantId) : null,
                externalSku !== undefined && externalSku !== null ? String(externalSku) : null,
                variantId
            ]);
        }
        // Traer stock de Mercado Libre al inventario local (ML = fuente de verdad)
        let synced = 0;
        const mlItemId = (mercadoLibreItemId != null && String(mercadoLibreItemId).trim() !== '') ? String(mercadoLibreItemId).trim() : null;
        if (mlItemId) {
            const integration = yield (0, db_1.get)(`SELECT access_token FROM integrations WHERE platform = 'mercadolibre'`);
            if (integration === null || integration === void 0 ? void 0 : integration.access_token) {
                try {
                    const itemRes = yield axios_1.default.get(`https://api.mercadolibre.com/items/${mlItemId}?include_attributes=all`, { headers: { Authorization: `Bearer ${integration.access_token}` } });
                    const item = itemRes.data;
                    const variations = (item === null || item === void 0 ? void 0 : item.variations) || [];
                    const hasVariations = variations.length > 0;
                    for (const link of links) {
                        const hasMl = link.mercadoLibreVariantId != null && String(link.mercadoLibreVariantId) !== '';
                        if (!link.variantId || !hasMl)
                            continue;
                        try {
                            let qty = 0;
                            if (hasVariations) {
                                const v = variations.find((x) => String(x.id) === String(link.mercadoLibreVariantId));
                                qty = v ? ((_b = v.available_quantity) !== null && _b !== void 0 ? _b : 0) : 0;
                            }
                            else {
                                qty = (_c = item.available_quantity) !== null && _c !== void 0 ? _c : 0;
                            }
                            yield (0, db_1.execute)(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`, [link.variantId, qty]);
                            synced++;
                        }
                        catch (err) {
                            console.warn('[bulkLinkVariants] Error actualizando stock local desde ML para variante', link.variantId, ':', err === null || err === void 0 ? void 0 : err.message);
                        }
                    }
                }
                catch (mlErr) {
                    console.warn('[bulkLinkVariants] Error trayendo ?tem de ML:', ((_d = mlErr === null || mlErr === void 0 ? void 0 : mlErr.response) === null || _d === void 0 ? void 0 : _d.data) || (mlErr === null || mlErr === void 0 ? void 0 : mlErr.message));
                }
            }
        }
        res.json({
            updated: links.length,
            synced,
            productId: resolvedProductId,
            mercadoLibreItemId: mercadoLibreItemId !== null && mercadoLibreItemId !== void 0 ? mercadoLibreItemId : undefined,
            tiendaNubeProductId: tiendaNubeProductId !== null && tiendaNubeProductId !== void 0 ? tiendaNubeProductId : undefined
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en vinculaci?n en lote' });
    }
});
exports.bulkLinkVariants = bulkLinkVariants;
const deleteAllProducts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield (0, db_1.execute)('SET FOREIGN_KEY_CHECKS = 0');
        yield (0, db_1.execute)('TRUNCATE TABLE stocks');
        yield (0, db_1.execute)('TRUNCATE TABLE product_variants');
        yield (0, db_1.execute)('TRUNCATE TABLE product_colors');
        yield (0, db_1.execute)('TRUNCATE TABLE products');
        // Also delete Colors and Sizes to start fresh
        yield (0, db_1.execute)('TRUNCATE TABLE colors');
        yield (0, db_1.execute)('TRUNCATE TABLE sizes');
        yield (0, db_1.execute)('SET FOREIGN_KEY_CHECKS = 1');
        res.json({ message: 'Todos los productos, variantes, colores y talles han sido eliminados correctamente' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error eliminando todos los datos' });
    }
});
exports.deleteAllProducts = deleteAllProducts;
/** Eliminar una variante (y su stock). No se puede si está en pedidos. */
const deleteVariant = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { variantId } = req.params;
    if (!variantId)
        return res.status(400).json({ message: 'Falta variantId' });
    try {
        const inOrder = yield (0, db_1.get)(`SELECT 1 FROM order_items WHERE variant_id = ? LIMIT 1`, [variantId]);
        if (inOrder) {
            return res.status(400).json({
                message: 'No se puede eliminar la variante porque está en uno o más pedidos.',
            });
        }
        yield (0, db_1.execute)('DELETE FROM stocks WHERE variant_id = ?', [variantId]);
        const result = yield (0, db_1.execute)('DELETE FROM product_variants WHERE id = ?', [variantId]);
        const affected = result && result.affectedRows;
        if (affected === 0) {
            return res.status(404).json({ message: 'Variante no encontrada' });
        }
        res.json({ message: 'Variante eliminada' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error eliminando variante' });
    }
});
exports.deleteVariant = deleteVariant;
/** Eliminar un producto (artículo) y todas sus variantes, colores y stock. No se puede si alguna variante está en pedidos. */
const deleteProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const productId = req.params.id;
    if (!productId)
        return res.status(400).json({ message: 'Falta productId' });
    try {
        const inOrder = yield (0, db_1.get)(`SELECT 1 FROM order_items oi
       JOIN product_variants pv ON pv.id = oi.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       WHERE pc.product_id = ? LIMIT 1`, [productId]);
        if (inOrder) {
            return res.status(400).json({
                message: 'No se puede eliminar el artículo porque alguna variante está en pedidos.',
            });
        }
        const result = yield (0, db_1.execute)('DELETE FROM products WHERE id = ?', [productId]);
        const affected = result && result.affectedRows;
        if (affected === 0) {
            return res.status(404).json({ message: 'Producto no encontrado' });
        }
        res.json({ message: 'Producto y variantes eliminados' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error eliminando producto' });
    }
});
exports.deleteProduct = deleteProduct;
// --- Importaci?n desde Tango (Excel): c?digo = 7 art + 3 talle + 3 color ---
function normalizeHeader(h) {
    return (h || '')
        .toString()
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}
function findColumn(headers, name) {
    for (let i = 0; i < headers.length; i++) {
        if (normalizeHeader(headers[i]) === name || normalizeHeader(headers[i]).includes(name))
            return i;
    }
    return -1;
}
function parseCodigoTango(codigo) {
    const raw = (codigo != null ? String(codigo).trim() : '');
    const s = raw.replace(/\D/g, '');
    return {
        articulo: s.slice(0, 7),
        talle: s.slice(7, 10),
        color: s.slice(10, 13),
        codigo13: s.slice(0, 13),
    };
}
const importTangoArticles = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const { rows: rawRows, onlyComplete = true } = req.body;
        if (!Array.isArray(rawRows) || rawRows.length === 0) {
            return res.status(400).json({ message: 'Se requiere un array "rows" con las filas del Excel (con columna C?digo y opcional Descripci?n).' });
        }
        const headers = Object.keys(rawRows[0] || {});
        const codigoCol = findColumn(headers, 'codigo');
        if (codigoCol < 0) {
            return res.status(400).json({ message: 'No se encontr? la columna "C?digo" en las filas enviadas.' });
        }
        const descCol = findColumn(headers, 'descripcion');
        const codigoKey = headers[codigoCol];
        const descKey = descCol >= 0 ? headers[descCol] : null;
        const rows = [];
        for (const row of rawRows) {
            const codigo = row[codigoKey];
            const parsed = parseCodigoTango(codigo);
            if (parsed.codigo13.length < 13 && onlyComplete)
                continue;
            const descripcion = (descKey && row[descKey] != null ? String(row[descKey]).trim() : '') || parsed.articulo;
            rows.push({
                articulo: parsed.articulo,
                talle: parsed.talle,
                color: parsed.color,
                codigo13: parsed.codigo13,
                descripcion,
            });
        }
        let productsCreated = 0;
        let variantsCreated = 0;
        let variantsUpdated = 0;
        const errors = [];
        const productNamesByArticulo = {};
        for (const r of rows) {
            try {
                if (r.codigo13.length < 13)
                    continue;
                if (!r.articulo)
                    continue;
                if (!productNamesByArticulo[r.articulo] && r.descripcion) {
                    productNamesByArticulo[r.articulo] = r.descripcion;
                }
                let productId = ((_a = (yield (0, db_1.get)(`SELECT id FROM products WHERE sku = ?`, [r.articulo]))) === null || _a === void 0 ? void 0 : _a.id) || null;
                if (!productId) {
                    productId = (0, uuid_1.v4)();
                    const name = productNamesByArticulo[r.articulo] || r.articulo;
                    yield (0, db_1.execute)(`INSERT INTO products (id, sku, name, category, base_price, description) VALUES (?, ?, ?, ?, ?, ?)`, [productId, r.articulo, name, 'General', 0, null]);
                    productsCreated++;
                }
                let sizeId = (_b = (yield (0, db_1.get)(`SELECT id FROM sizes WHERE size_code = ?`, [r.talle]))) === null || _b === void 0 ? void 0 : _b.id;
                if (!sizeId) {
                    sizeId = (0, uuid_1.v4)();
                    const talleNombre = (0, talles_tango_1.nombreTalleDesdeCodigo)(r.talle);
                    yield (0, db_1.execute)(`INSERT INTO sizes (id, size_code, name) VALUES (?, ?, ?)`, [sizeId, r.talle, talleNombre]);
                }
                let colorId = (_c = (yield (0, db_1.get)(`SELECT id FROM colors WHERE code = ?`, [r.color]))) === null || _c === void 0 ? void 0 : _c.id;
                if (!colorId) {
                    colorId = (0, uuid_1.v4)();
                    yield (0, db_1.execute)(`INSERT INTO colors (id, name, code, hex) VALUES (?, ?, ?, ?)`, [colorId, r.color, r.color, '#000000']);
                }
                let productColorId = (_d = (yield (0, db_1.get)(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ?`, [productId, colorId]))) === null || _d === void 0 ? void 0 : _d.id;
                if (!productColorId) {
                    productColorId = (0, uuid_1.v4)();
                    yield (0, db_1.execute)(`INSERT INTO product_colors (id, product_id, color_id) VALUES (?, ?, ?)`, [productColorId, productId, colorId]);
                }
                const existingVariant = yield (0, db_1.get)(`SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ?`, [productColorId, sizeId]);
                if (!existingVariant) {
                    const variantId = (0, uuid_1.v4)();
                    yield (0, db_1.execute)(`INSERT INTO product_variants (id, product_color_id, size_id, sku) VALUES (?, ?, ?, ?)`, [variantId, productColorId, sizeId, r.codigo13]);
                    yield (0, db_1.execute)(`INSERT INTO stocks (variant_id, stock) VALUES (?, 0) ON DUPLICATE KEY UPDATE stock = stock`, [variantId]);
                    variantsCreated++;
                }
                else {
                    yield (0, db_1.execute)(`UPDATE product_variants SET sku = ? WHERE id = ?`, [r.codigo13, existingVariant.id]);
                    variantsUpdated++;
                }
            }
            catch (err) {
                errors.push(`Fila ${r.codigo13}: ${(err === null || err === void 0 ? void 0 : err.message) || 'Error'}`);
            }
        }
        res.json({
            message: 'Importaci?n Tango finalizada',
            productsCreated,
            variantsCreated,
            variantsUpdated,
            totalProcessed: rows.filter((r) => r.codigo13.length >= 13).length,
            errors: errors.slice(0, 50),
        });
    }
    catch (error) {
        console.error('Import Tango:', error);
        res.status(500).json({ message: 'Error importando art?culos Tango', error: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.importTangoArticles = importTangoArticles;
/** Exportar inventario completo: productos + variantes + stock (para Excel en frontend). */
const exportInventory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rows = yield (0, db_1.query)(`
      SELECT
        p.sku AS product_sku,
        p.name AS product_name,
        p.category,
        p.base_price,
        pv.sku AS variant_sku,
        s.size_code,
        s.name AS size_name,
        c.code AS color_code,
        c.name AS color_name,
        COALESCE(st.stock, 0) AS stock
      FROM products p
      JOIN product_colors pc ON pc.product_id = p.id
      JOIN colors c ON c.id = pc.color_id
      JOIN product_variants pv ON pv.product_color_id = pc.id
      JOIN sizes s ON s.id = pv.size_id
      LEFT JOIN stocks st ON st.variant_id = pv.id
      ORDER BY p.sku, s.size_code, c.code
    `);
        const withTalleLabel = (rows || []).map((r) => (Object.assign(Object.assign({}, r), { talle_display: (0, talles_tango_1.nombreTalleDesdeCodigo)(r.size_code) || r.size_name || r.size_code })));
        res.json({ rows: withTalleLabel });
    }
    catch (error) {
        console.error('Export inventory:', error);
        res.status(500).json({ message: 'Error exportando inventario', error: error === null || error === void 0 ? void 0 : error.message });
    }
});
exports.exportInventory = exportInventory;
