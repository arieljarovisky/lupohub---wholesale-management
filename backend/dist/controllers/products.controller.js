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
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteVariantPublication = exports.addVariantPublication = exports.getVariantPublications = exports.exportInventory = exports.importTangoArticles = exports.deleteProduct = exports.updateVariant = exports.getProductOrderHistory = exports.getVariantById = exports.deleteVariant = exports.deleteAllProducts = exports.bulkLinkVariants = exports.unlinkProductPlatforms = exports.updateVariantExternalIds = exports.updateProductExternalIds = exports.updateProduct = exports.patchStock = exports.getProductBySku = exports.getProductById = exports.getProductStockTotalBySku = exports.getVariantIdBySkuColorSize = exports.createProduct = exports.getProducts = void 0;
exports.deleteProductById = deleteProductById;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const talles_tango_1 = require("../talles-tango");
const stock_controller_1 = require("./stock.controller");
const getProducts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = '1', per_page = '20', q = '', sort = 'sku', dir = 'asc', sync_ml, sync_tn, sync_none, skip_total, price_list_id } = req.query;
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
        const priceListId = (price_list_id && String(price_list_id).trim()) || null;
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
        const priceJoin = priceListId
            ? `LEFT JOIN price_list_items pli ON pli.price_list_id = ? AND pli.product_id = p.id`
            : '';
        const priceSelect = priceListId
            ? `COALESCE(pli.price, p.base_price) AS base_price`
            : `p.base_price`;
        const priceParams = priceListId ? [priceListId] : [];
        let total = 0;
        if (!skipTotal) {
            const totalRow = yield (0, db_1.get)(`
      SELECT COUNT(*) AS total
      FROM products p
      JOIN product_colors pc ON pc.product_id = p.id
      JOIN product_variants pv ON pv.product_color_id = pc.id
      ${priceJoin}
      ${whereClause}
      `, [...priceParams, ...params]);
            total = Number((totalRow === null || totalRow === void 0 ? void 0 : totalRow.total) || 0);
        }
        const rows = yield (0, db_1.query)(`
      SELECT pv.id, pv.sku, p.name, p.category, ${priceSelect},
             p.id AS product_id, p.sku AS base_sku,
             p.tienda_nube_id, p.mercado_libre_id,
             COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size,
             pv.tienda_nube_variant_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id,
             COALESCE(st.stock, 0) AS stock_total,
             c.name AS color_name, s.size_code AS size_code, s.name AS size_name
      FROM products p
      JOIN product_colors pc ON pc.product_id = p.id
      JOIN product_variants pv ON pv.product_color_id = pc.id
      LEFT JOIN colors c ON c.id = pc.color_id
      LEFT JOIN sizes s ON s.id = pv.size_id
      LEFT JOIN stocks st ON st.variant_id = pv.id
      ${priceJoin}
      ${whereClause}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ? OFFSET ?
      `, [...priceParams, ...params, perPageNum, offset]);
        const mapped = (rows || []).map((r) => {
            var _a, _b, _c, _d, _e;
            return ({
                id: r.id,
                sku: r.sku,
                base_sku: r.base_sku,
                product_id: r.product_id,
                name: r.name,
                category: r.category,
                base_price: Number((_a = r.base_price) !== null && _a !== void 0 ? _a : 0),
                stock_total: Number((_b = r.stock_total) !== null && _b !== void 0 ? _b : 0),
                mayorista_pack_size: Math.max(1, Number(r.mayorista_pack_size) || 1),
                color_name: (_c = r.color_name) !== null && _c !== void 0 ? _c : null,
                size_code: (_d = r.size_code) !== null && _d !== void 0 ? _d : null,
                size_name: (_e = r.size_name) !== null && _e !== void 0 ? _e : null,
                externalIds: {
                    tiendaNube: r.tienda_nube_id,
                    mercadoLibre: r.mercado_libre_id,
                    tiendaNubeVariant: r.tienda_nube_variant_id,
                    mercadoLibreVariant: r.mercado_libre_variant_id,
                    mercadoLibreItemId: r.mercado_libre_item_id
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
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
                try {
                    yield (0, db_1.execute)(`INSERT INTO products (id, sku, name, category, base_price, description) VALUES (?, ?, ?, ?, ?, ?)`, [productId, baseSku, name, category !== null && category !== void 0 ? category : 'General', basePrice, description]);
                }
                catch (insertErr) {
                    // Varias requests en paralelo pueden intentar crear el mismo producto; si ya existe, usar ese id
                    if (insertErr.code === 'ER_DUP_ENTRY' && insertErr.sqlMessage && String(insertErr.sqlMessage).includes("'products.sku'")) {
                        const existing = yield (0, db_1.get)(`SELECT id FROM products WHERE sku = ?`, [baseSku]);
                        if (existing === null || existing === void 0 ? void 0 : existing.id) {
                            productId = existing.id;
                        }
                        else {
                            throw insertErr;
                        }
                    }
                    else {
                        throw insertErr;
                    }
                }
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
            const existingVariant = yield (0, db_1.get)(`SELECT id, sku FROM product_variants WHERE product_color_id = ? AND size_id = ?`, [productColorId, sizeId]);
            if (existingVariant) {
                const productRow = yield (0, db_1.get)(`SELECT name, category, base_price, tienda_nube_id, mercado_libre_id FROM products WHERE id = ?`, [productId]);
                const stockRow = yield (0, db_1.get)(`SELECT stock FROM stocks WHERE variant_id = ?`, [existingVariant.id]);
                return res.status(200).json({
                    id: existingVariant.id,
                    sku: (_h = existingVariant.sku) !== null && _h !== void 0 ? _h : sku,
                    name: (_j = productRow === null || productRow === void 0 ? void 0 : productRow.name) !== null && _j !== void 0 ? _j : name,
                    category: (_l = (_k = productRow === null || productRow === void 0 ? void 0 : productRow.category) !== null && _k !== void 0 ? _k : category) !== null && _l !== void 0 ? _l : 'General',
                    base_price: Number((_m = productRow === null || productRow === void 0 ? void 0 : productRow.base_price) !== null && _m !== void 0 ? _m : basePrice),
                    description: (_p = (_o = productRow === null || productRow === void 0 ? void 0 : productRow.description) !== null && _o !== void 0 ? _o : description) !== null && _p !== void 0 ? _p : undefined,
                    stock_total: Number((_q = stockRow === null || stockRow === void 0 ? void 0 : stockRow.stock) !== null && _q !== void 0 ? _q : 0),
                    externalIds: {
                        tiendaNube: (_r = productRow === null || productRow === void 0 ? void 0 : productRow.tienda_nube_id) !== null && _r !== void 0 ? _r : undefined,
                        mercadoLibre: (_s = productRow === null || productRow === void 0 ? void 0 : productRow.mercado_libre_id) !== null && _s !== void 0 ? _s : undefined,
                    },
                    existing: true,
                });
            }
            const variantId = (0, uuid_1.v4)();
            yield (0, db_1.execute)(`INSERT INTO product_variants (id, product_color_id, size_id, sku) VALUES (?, ?, ?, ?)`, [variantId, productColorId, sizeId, sku]);
            yield (0, db_1.execute)(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?) ON DUPLICATE KEY UPDATE stock = VALUES(stock)`, [variantId, initialStock]);
            const productRow = yield (0, db_1.get)(`SELECT name, category, base_price, tienda_nube_id, mercado_libre_id FROM products WHERE id = ?`, [productId]);
            console.log('[createProduct] Variante creada:', sku, 'variantId=', variantId);
            return res.status(201).json({
                id: variantId,
                sku,
                name: (_t = productRow === null || productRow === void 0 ? void 0 : productRow.name) !== null && _t !== void 0 ? _t : name,
                category: (_v = (_u = productRow === null || productRow === void 0 ? void 0 : productRow.category) !== null && _u !== void 0 ? _u : category) !== null && _v !== void 0 ? _v : 'General',
                base_price: Number((_w = productRow === null || productRow === void 0 ? void 0 : productRow.base_price) !== null && _w !== void 0 ? _w : basePrice),
                description: (_y = (_x = productRow === null || productRow === void 0 ? void 0 : productRow.description) !== null && _x !== void 0 ? _x : description) !== null && _y !== void 0 ? _y : undefined,
                externalIds: {
                    tiendaNube: (_z = productRow === null || productRow === void 0 ? void 0 : productRow.tienda_nube_id) !== null && _z !== void 0 ? _z : undefined,
                    mercadoLibre: (_0 = productRow === null || productRow === void 0 ? void 0 : productRow.mercado_libre_id) !== null && _0 !== void 0 ? _0 : undefined,
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
/** Obtener un producto por ID (para formulario de edición) */
const getProductById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    if (!id)
        return res.status(400).json({ message: 'ID requerido' });
    try {
        const product = yield (0, db_1.get)(`SELECT id, sku, name, category, base_price, description,
              COALESCE(mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
              COALESCE(tienda_nube_pack_size, 1) AS tienda_nube_pack_size,
              COALESCE(NULLIF(mayorista_pack_size, 0), 1) AS mayorista_pack_size
       FROM products WHERE id = ?`, [id]);
        if (!product)
            return res.status(404).json({ message: 'Producto no encontrado' });
        res.json(product);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error obteniendo producto' });
    }
});
exports.getProductById = getProductById;
const getProductBySku = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { sku } = req.params;
    try {
        // Buscar por SKU exacto o por SKU base (para agrupar variantes)
        let product = yield (0, db_1.get)(`SELECT p.id, p.sku, p.name, p.category, p.base_price, p.tienda_nube_id, p.mercado_libre_id,
              COALESCE(p.mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
              COALESCE(p.tienda_nube_pack_size, 1) AS tienda_nube_pack_size,
              COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size
       FROM products p WHERE p.sku = ?`, [sku]);
        // Si no se encuentra exacto, buscar por SKU base
        if (!product) {
            product = yield (0, db_1.get)(`SELECT p.id, p.sku, p.name, p.category, p.base_price, p.tienda_nube_id, p.mercado_libre_id,
                COALESCE(p.mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
                COALESCE(p.tienda_nube_pack_size, 1) AS tienda_nube_pack_size,
                COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size
         FROM products p WHERE p.sku LIKE ? ORDER BY p.sku LIMIT 1`, [`${sku}-%`]);
        }
        // Código de variante completo (ej. QE5546-158-614): primer segmento = SKU del modelo
        if (!product && String(sku).includes('-')) {
            const base = String(sku).split('-')[0];
            product = yield (0, db_1.get)(`SELECT p.id, p.sku, p.name, p.category, p.base_price, p.tienda_nube_id, p.mercado_libre_id,
                COALESCE(p.mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
                COALESCE(p.tienda_nube_pack_size, 1) AS tienda_nube_pack_size,
                COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size
         FROM products p WHERE p.sku = ?`, [base]);
        }
        if (!product) {
            product = yield (0, db_1.get)(`SELECT p.id, p.sku, p.name, p.category, p.base_price, p.tienda_nube_id, p.mercado_libre_id,
                COALESCE(p.mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
                COALESCE(p.tienda_nube_pack_size, 1) AS tienda_nube_pack_size,
                COALESCE(NULLIF(p.mayorista_pack_size, 0), 1) AS mayorista_pack_size
         FROM products p WHERE ? LIKE CONCAT(p.sku, '-%') ORDER BY CHAR_LENGTH(p.sku) DESC LIMIT 1`, [sku]);
        }
        if (!product)
            return res.status(404).json({ message: 'Producto no encontrado' });
        // Obtener todas las variantes del producto encontrado
        const variantsRows = yield (0, db_1.query)(`SELECT p.sku, pv.sku AS variant_sku, pv.external_sku,
              c.code AS color_code, c.name AS color_name,
              s.size_code, COALESCE(st.stock,0) AS stock, pv.id AS variant_id,
              pv.tienda_nube_variant_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id
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
                mercadoLibreVariant: v.mercado_libre_variant_id,
                mercadoLibreItemId: v.mercado_libre_item_id
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
    const { name, category, base_price, description, mercadoLibrePackSize, tiendaNubePackSize, mayoristaPackSize } = req.body;
    if (!id)
        return res.status(400).json({ message: 'ID inv?lido' });
    try {
        const mlPack = mercadoLibrePackSize != null ? Math.max(1, Math.floor(Number(mercadoLibrePackSize))) : null;
        const tnPack = tiendaNubePackSize != null ? Math.max(1, Math.floor(Number(tiendaNubePackSize))) : null;
        const mayPack = mayoristaPackSize != null ? Math.max(1, Math.floor(Number(mayoristaPackSize))) : null;
        yield (0, db_1.execute)(`UPDATE products SET 
         name = COALESCE(?, name),
         category = COALESCE(?, category),
         base_price = COALESCE(?, base_price),
         description = COALESCE(?, description),
         mercado_libre_pack_size = COALESCE(?, mercado_libre_pack_size),
         tienda_nube_pack_size = COALESCE(?, tienda_nube_pack_size),
         mayorista_pack_size = COALESCE(?, mayorista_pack_size)
       WHERE id = ?`, [name !== null && name !== void 0 ? name : null, category !== null && category !== void 0 ? category : null, base_price !== null && base_price !== void 0 ? base_price : null, description !== null && description !== void 0 ? description : null, mlPack, tnPack, mayPack, id]);
        const updated = yield (0, db_1.get)(`SELECT id, sku, name, category, base_price, description,
      COALESCE(mercado_libre_pack_size, 1) AS mercado_libre_pack_size,
      COALESCE(tienda_nube_pack_size, 1) AS tienda_nube_pack_size,
      COALESCE(NULLIF(mayorista_pack_size, 0), 1) AS mayorista_pack_size FROM products WHERE id = ?`, [id]);
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
    const body = req.body || {};
    const hasTn = Object.prototype.hasOwnProperty.call(body, 'tiendaNubeId');
    const hasMl = Object.prototype.hasOwnProperty.call(body, 'mercadoLibreId');
    const tiendaNubeId = hasTn ? body.tiendaNubeId : undefined;
    const mercadoLibreId = hasMl ? body.mercadoLibreId : undefined;
    if (!id)
        return res.status(400).json({ message: 'ID inv?lido' });
    try {
        if (!hasTn && !hasMl)
            return res.status(400).json({ message: 'Debe enviar tiendaNubeId y/o mercadoLibreId (pueden ser null para desvincular).' });
        const sets = [];
        const params = [];
        if (hasTn) {
            sets.push('tienda_nube_id = ?');
            params.push(tiendaNubeId != null && String(tiendaNubeId).trim() !== '' ? String(tiendaNubeId).trim() : null);
        }
        if (hasMl) {
            sets.push('mercado_libre_id = ?');
            params.push(mercadoLibreId != null && String(mercadoLibreId).trim() !== '' ? String(mercadoLibreId).trim() : null);
        }
        params.push(id);
        yield (0, db_1.execute)(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, params);
        res.json({ id, tiendaNubeId: hasTn ? (tiendaNubeId !== null && tiendaNubeId !== void 0 ? tiendaNubeId : null) : undefined, mercadoLibreId: hasMl ? (mercadoLibreId !== null && mercadoLibreId !== void 0 ? mercadoLibreId : null) : undefined });
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
    const body = req.body || {};
    const hasTnVar = Object.prototype.hasOwnProperty.call(body, 'tiendaNubeVariantId');
    const hasTnProd = Object.prototype.hasOwnProperty.call(body, 'tiendaNubeProductId');
    const hasMlVar = Object.prototype.hasOwnProperty.call(body, 'mercadoLibreVariantId');
    const hasMlItem = Object.prototype.hasOwnProperty.call(body, 'mercadoLibreItemId');
    const hasExternalSku = Object.prototype.hasOwnProperty.call(body, 'externalSku');
    const tiendaNubeVariantId = hasTnVar ? body.tiendaNubeVariantId : undefined;
    const tiendaNubeProductId = hasTnProd ? body.tiendaNubeProductId : undefined;
    const mercadoLibreVariantId = hasMlVar ? body.mercadoLibreVariantId : undefined;
    const mercadoLibreItemId = hasMlItem ? body.mercadoLibreItemId : undefined;
    const externalSku = hasExternalSku ? body.externalSku : undefined;
    if (!variantId)
        return res.status(400).json({ message: 'ID de variante inválido' });
    try {
        const sets = [];
        const params = [];
        if (hasTnVar) {
            sets.push('tienda_nube_variant_id = ?');
            params.push(tiendaNubeVariantId != null && String(tiendaNubeVariantId).trim() !== '' ? String(tiendaNubeVariantId).trim() : null);
        }
        if (hasMlVar) {
            sets.push('mercado_libre_variant_id = ?');
            params.push(mercadoLibreVariantId != null && String(mercadoLibreVariantId).trim() !== '' ? String(mercadoLibreVariantId).trim() : null);
        }
        if (hasMlItem) {
            sets.push('mercado_libre_item_id = ?');
            params.push(mercadoLibreItemId != null && String(mercadoLibreItemId).trim() !== '' ? String(mercadoLibreItemId).trim() : null);
        }
        if (hasExternalSku) {
            sets.push('external_sku = ?');
            params.push(externalSku != null && String(externalSku).trim() !== '' ? String(externalSku).trim() : null);
        }
        if (sets.length > 0) {
            params.push(variantId);
            yield (0, db_1.execute)(`UPDATE product_variants SET ${sets.join(', ')} WHERE id = ?`, params);
        }
        let productRow = yield (0, db_1.get)(`SELECT p.id AS product_id, p.tienda_nube_id, p.mercado_libre_id,
              COALESCE(NULLIF(p.tienda_nube_pack_size, 0), 1) AS tn_pack,
              COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
       FROM products p
       JOIN product_colors pc ON pc.product_id = p.id
       JOIN product_variants pv ON pv.product_color_id = pc.id
       WHERE pv.id = ? LIMIT 1`, [variantId]);
        // Actualizar IDs del producto padre solo si el request lo incluye explícitamente.
        if (productRow === null || productRow === void 0 ? void 0 : productRow.product_id) {
            if (hasMlItem) {
                const mlItemToSet = (mercadoLibreItemId != null && String(mercadoLibreItemId).trim() !== '') ? String(mercadoLibreItemId).trim() : null;
                yield (0, db_1.execute)(`UPDATE products SET mercado_libre_id = ? WHERE id = ?`, [mlItemToSet, productRow.product_id]);
                productRow = Object.assign(Object.assign({}, productRow), { mercado_libre_id: mlItemToSet });
            }
            if (hasTnProd) {
                const tnProdToSet = (tiendaNubeProductId != null && String(tiendaNubeProductId).trim() !== '') ? String(tiendaNubeProductId).trim() : null;
                yield (0, db_1.execute)(`UPDATE products SET tienda_nube_id = ? WHERE id = ?`, [tnProdToSet, productRow.product_id]);
                productRow = Object.assign(Object.assign({}, productRow), { tienda_nube_id: tnProdToSet });
            }
        }
        // Registrar en variant_publications para que la sincronización de stock use esta publicación
        const tnVariantId = (tiendaNubeVariantId != null && String(tiendaNubeVariantId).trim() !== '') ? String(tiendaNubeVariantId).trim() : null;
        const mlVariantId = (mercadoLibreVariantId != null && String(mercadoLibreVariantId).trim() !== '') ? String(mercadoLibreVariantId).trim() : '';
        const tnProductId = ((productRow === null || productRow === void 0 ? void 0 : productRow.tienda_nube_id) && String(productRow.tienda_nube_id).trim() !== '') ? String(productRow.tienda_nube_id).trim() : null;
        const tnPack = (_a = productRow === null || productRow === void 0 ? void 0 : productRow.tn_pack) !== null && _a !== void 0 ? _a : 1;
        const mlPack = (_b = productRow === null || productRow === void 0 ? void 0 : productRow.ml_pack) !== null && _b !== void 0 ? _b : 1;
        // Si se borró la publicación, también la borramos de variant_publications.
        if (hasTnVar && (!tnProductId || !tnVariantId)) {
            yield (0, db_1.execute)(`DELETE FROM variant_publications WHERE variant_id = ? AND platform = 'tiendanube'`, [variantId]);
        }
        if (hasMlVar || hasMlItem) {
            const hasAnyMl = (mercadoLibreItemId != null && String(mercadoLibreItemId).trim() !== '') || (mercadoLibreVariantId != null && String(mercadoLibreVariantId).trim() !== '');
            if (!hasAnyMl) {
                yield (0, db_1.execute)(`DELETE FROM variant_publications WHERE variant_id = ? AND platform = 'mercadolibre'`, [variantId]);
            }
        }
        if (tnProductId && tnVariantId) {
            yield (0, db_1.execute)(`INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
         VALUES (?, ?, 'tiendanube', ?, ?, ?)
         ON DUPLICATE KEY UPDATE pack_size = VALUES(pack_size)`, [(0, uuid_1.v4)(), variantId, tnProductId, tnVariantId, tnPack]);
        }
        const mlItemId = ((productRow === null || productRow === void 0 ? void 0 : productRow.mercado_libre_id) && String(productRow.mercado_libre_id).trim() !== '') ? String(productRow.mercado_libre_id).trim() : null;
        if (mlItemId) {
            yield (0, db_1.execute)(`INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size)
         VALUES (?, ?, 'mercadolibre', ?, ?, ?)
         ON DUPLICATE KEY UPDATE pack_size = VALUES(pack_size)`, [(0, uuid_1.v4)(), variantId, mlItemId, mlVariantId, mlPack]);
        }
        // Después de vincular, usar el stock local como fuente de verdad y enviarlo a ML/TN
        try {
            const stockRow = yield (0, db_1.get)(`SELECT stock FROM stocks WHERE variant_id = ?`, [variantId]);
            const currentStock = Number((_c = stockRow === null || stockRow === void 0 ? void 0 : stockRow.stock) !== null && _c !== void 0 ? _c : 0);
            yield (0, stock_controller_1.syncStockToExternalPlatforms)(variantId, currentStock);
        }
        catch (syncErr) {
            console.error('[updateVariantExternalIds] Error enviando stock local a plataformas externas:', (syncErr === null || syncErr === void 0 ? void 0 : syncErr.message) || syncErr);
        }
        res.json({
            variantId,
            tiendaNubeVariantId,
            mercadoLibreVariantId,
            mercadoLibreItemId: mercadoLibreItemId !== null && mercadoLibreItemId !== void 0 ? mercadoLibreItemId : undefined,
            externalSku: externalSku !== null && externalSku !== void 0 ? externalSku : undefined,
            // Ya no se trae stock desde ML al vincular; el stock local es la fuente de verdad
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error actualizando IDs externos de variante' });
    }
});
exports.updateVariantExternalIds = updateVariantExternalIds;
/** Desvincular un artículo de Tienda Nube y/o Mercado Libre (producto padre + variantes). */
const unlinkProductPlatforms = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const body = req.body || {};
    const tiendaNube = body.tiendaNube !== false; // default true
    const mercadoLibre = body.mercadoLibre !== false; // default true
    const unlinkVariants = body.variants !== false; // default true
    if (!id)
        return res.status(400).json({ message: 'ID inválido' });
    try {
        if (!tiendaNube && !mercadoLibre) {
            return res.status(400).json({ message: 'Debe indicar tiendaNube y/o mercadoLibre.' });
        }
        const result = { productId: id, tiendaNube: false, mercadoLibre: false, variants: unlinkVariants };
        if (tiendaNube) {
            yield (0, db_1.execute)(`UPDATE products SET tienda_nube_id = NULL WHERE id = ?`, [id]);
            result.tiendaNube = true;
            if (unlinkVariants) {
                const rows = yield (0, db_1.query)(`SELECT pv.id AS variant_id
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           WHERE pc.product_id = ?`, [id]);
                const variantIds = (rows || []).map((r) => r.variant_id).filter(Boolean);
                yield (0, db_1.execute)(`UPDATE product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           SET pv.tienda_nube_variant_id = NULL
           WHERE pc.product_id = ?`, [id]);
                if (variantIds.length > 0) {
                    yield (0, db_1.execute)(`DELETE FROM variant_publications WHERE platform = 'tiendanube' AND variant_id IN (${variantIds.map(() => '?').join(',')})`, variantIds);
                }
            }
        }
        if (mercadoLibre) {
            yield (0, db_1.execute)(`UPDATE products SET mercado_libre_id = NULL WHERE id = ?`, [id]);
            result.mercadoLibre = true;
            if (unlinkVariants) {
                const rows = yield (0, db_1.query)(`SELECT pv.id AS variant_id
           FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           WHERE pc.product_id = ?`, [id]);
                const variantIds = (rows || []).map((r) => r.variant_id).filter(Boolean);
                yield (0, db_1.execute)(`UPDATE product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           SET pv.mercado_libre_variant_id = NULL,
               pv.mercado_libre_item_id = NULL
           WHERE pc.product_id = ?`, [id]);
                if (variantIds.length > 0) {
                    yield (0, db_1.execute)(`DELETE FROM variant_publications WHERE platform = 'mercadolibre' AND variant_id IN (${variantIds.map(() => '?').join(',')})`, variantIds);
                }
            }
        }
        res.json(Object.assign({ ok: true }, result));
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error desvinculando artículo' });
    }
});
exports.unlinkProductPlatforms = unlinkProductPlatforms;
/** Vinculación en lote: actualiza IDs externos de varias variantes y opcionalmente el producto padre.
 *  Usa el stock local como fuente de verdad y lo envía a ML/TN (no importa stock desde ML).
 */
const bulkLinkVariants = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const body = req.body || {};
    const { productId, mercadoLibreItemId, tiendaNubeProductId, links } = body;
    if (!links || !Array.isArray(links) || links.length === 0) {
        console.warn('[bulkLinkVariants] Body recibido sin links v?lidos:', { hasBody: !!req.body, keys: body ? Object.keys(body) : [], linksLength: links === null || links === void 0 ? void 0 : links.length });
        return res.status(400).json({ message: 'Se requiere un array "links" con al menos un elemento' });
    }
    try {
        const withMlItem = links.filter((l) => l.mercadoLibreItemId != null && String(l.mercadoLibreItemId).trim() !== '').length;
        const withTn = links.filter((l) => l.tiendaNubeVariantId != null && String(l.tiendaNubeVariantId) !== '').length;
        console.log('[bulkLinkVariants] Actualizando', links.length, 'variantes, productId:', productId, 'ML padre:', mercadoLibreItemId, 'TN producto:', tiendaNubeProductId, '| links con ML publicación propia:', withMlItem, 'con TN:', withTn);
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
            const { variantId, mercadoLibreVariantId, mercadoLibreItemId: linkMlItemId, tiendaNubeVariantId, externalSku } = link;
            if (!variantId)
                continue;
            const mlVarId = (mercadoLibreVariantId != null && String(mercadoLibreVariantId).trim() !== '') ? String(mercadoLibreVariantId) : null;
            const mlItemId = (linkMlItemId != null && String(linkMlItemId).trim() !== '') ? String(linkMlItemId).trim() : null;
            yield (0, db_1.execute)(`UPDATE product_variants SET
           tienda_nube_variant_id = COALESCE(?, tienda_nube_variant_id),
           mercado_libre_variant_id = COALESCE(?, mercado_libre_variant_id),
           mercado_libre_item_id = COALESCE(?, mercado_libre_item_id),
           external_sku = COALESCE(?, external_sku)
         WHERE id = ?`, [
                tiendaNubeVariantId != null && tiendaNubeVariantId !== '' ? String(tiendaNubeVariantId) : null,
                mlVarId,
                mlItemId,
                externalSku !== undefined && externalSku !== null ? String(externalSku) : null,
                variantId
            ]);
        }
        // Enviar stock local a plataformas externas (ML/TN). Por lotes para no disparar el timeout del cliente.
        const SYNC_BATCH = 4;
        let synced = 0;
        const toSync = links.filter((l) => l.variantId);
        for (let i = 0; i < toSync.length; i += SYNC_BATCH) {
            const batch = toSync.slice(i, i + SYNC_BATCH);
            const batchCounts = yield Promise.all(batch.map((link) => __awaiter(void 0, void 0, void 0, function* () {
                var _a;
                try {
                    const stockRow = yield (0, db_1.get)(`SELECT stock FROM stocks WHERE variant_id = ?`, [link.variantId]);
                    const currentStock = Number((_a = stockRow === null || stockRow === void 0 ? void 0 : stockRow.stock) !== null && _a !== void 0 ? _a : 0);
                    yield (0, stock_controller_1.syncStockToExternalPlatforms)(link.variantId, currentStock);
                    return 1;
                }
                catch (err) {
                    console.warn('[bulkLinkVariants] Error enviando stock local a plataformas externas para variante', link.variantId, ':', (err === null || err === void 0 ? void 0 : err.message) || err);
                    return 0;
                }
            })));
            synced += batchCounts.reduce((a, b) => a + b, 0);
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
/** Obtener una variante por ID (para formulario de edición) */
const getVariantById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { variantId } = req.params;
    if (!variantId)
        return res.status(400).json({ message: 'ID de variante requerido' });
    try {
        const row = yield (0, db_1.get)(`SELECT pv.id, pv.sku, pv.external_sku, pv.tienda_nube_variant_id, pv.mercado_libre_variant_id, pv.mercado_libre_item_id,
              p.name AS product_name, p.sku AS base_sku, p.tienda_nube_id,
              s.size_code, c.code AS color_code, c.name AS color_name,
              COALESCE(st.stock, 0) AS stock
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       JOIN colors c ON c.id = pc.color_id
       JOIN sizes s ON s.id = pv.size_id
       LEFT JOIN stocks st ON st.variant_id = pv.id
       WHERE pv.id = ?`, [variantId]);
        if (!row)
            return res.status(404).json({ message: 'Variante no encontrada' });
        res.json(row);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error obteniendo variante' });
    }
});
exports.getVariantById = getVariantById;
/** Historial de pedidos donde aparece un artículo (producto padre) y quién lo pidió. */
const getProductOrderHistory = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const { id } = req.params;
    const limitRaw = Number((_b = (_a = req.query) === null || _a === void 0 ? void 0 : _a.limit) !== null && _b !== void 0 ? _b : 200);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 200;
    if (!id)
        return res.status(400).json({ message: 'ID de producto requerido' });
    try {
        const product = yield (0, db_1.get)(`SELECT id, sku, name FROM products WHERE id = ?`, [id]);
        if (!product)
            return res.status(404).json({ message: 'Producto no encontrado' });
        const rows = yield (0, db_1.query)(`SELECT
         o.id AS order_id,
         o.date,
         o.status,
         o.reference,
         c.business_name AS customer_business_name,
         c.name AS customer_name,
         u.name AS seller_name,
         oi.quantity,
         oi.price_at_moment,
         pv.id AS variant_id,
         COALESCE(pv.sku, p.sku) AS variant_sku,
         s.size_code,
         col.name AS color_name
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN product_variants pv ON pv.id = oi.variant_id
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN sizes s ON s.id = pv.size_id
       LEFT JOIN colors col ON col.id = pc.color_id
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u ON u.id = o.seller_id
       WHERE p.id = ?
       ORDER BY o.date DESC, o.id DESC, oi.id DESC
       LIMIT ?`, [id, limit]);
        const entries = rows.map((r) => {
            var _a, _b, _c, _d;
            const quantity = Number(r.quantity) || 0;
            const price = Number(r.price_at_moment) || 0;
            return {
                orderId: r.order_id,
                date: r.date,
                status: r.status,
                reference: (_a = r.reference) !== null && _a !== void 0 ? _a : undefined,
                customerName: r.customer_business_name || r.customer_name || 'Cliente',
                sellerName: (_b = r.seller_name) !== null && _b !== void 0 ? _b : undefined,
                quantity,
                priceAtMoment: price,
                lineTotal: Math.round(quantity * price * 100) / 100,
                variantId: r.variant_id,
                variantSku: r.variant_sku,
                sizeCode: (_c = r.size_code) !== null && _c !== void 0 ? _c : undefined,
                colorName: (_d = r.color_name) !== null && _d !== void 0 ? _d : undefined,
            };
        });
        const uniqueOrders = new Set(entries.map((e) => e.orderId));
        const totalUnits = entries.reduce((acc, e) => acc + (Number(e.quantity) || 0), 0);
        res.json({
            productId: product.id,
            productSku: product.sku,
            productName: product.name,
            summary: {
                ordersCount: uniqueOrders.size,
                rowsCount: entries.length,
                totalUnits,
            },
            entries,
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error obteniendo historial de pedidos del artículo' });
    }
});
exports.getProductOrderHistory = getProductOrderHistory;
/** Actualizar variante (SKU y/o external_sku). Si la variante está vinculada a ML/TN, envía el SKU a esas plataformas. */
const updateVariant = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { variantId } = req.params;
    const { sku, externalSku } = req.body;
    if (!variantId)
        return res.status(400).json({ message: 'ID de variante requerido' });
    try {
        const updates = [];
        const values = [];
        if (sku !== undefined) {
            updates.push('sku = ?');
            values.push(sku === '' ? null : String(sku).trim());
        }
        if (externalSku !== undefined) {
            updates.push('external_sku = ?');
            values.push(externalSku === '' ? null : String(externalSku).trim());
        }
        if (updates.length === 0) {
            return res.status(400).json({ message: 'Indicá al menos un campo a actualizar (sku o externalSku)' });
        }
        values.push(variantId);
        yield (0, db_1.execute)(`UPDATE product_variants SET ${updates.join(', ')} WHERE id = ?`, values);
        const updated = yield (0, db_1.get)(`SELECT pv.id, pv.sku, pv.external_sku, pv.mercado_libre_item_id, pv.mercado_libre_variant_id, pv.tienda_nube_variant_id, p.tienda_nube_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       JOIN products p ON p.id = pc.product_id
       WHERE pv.id = ?`, [variantId]);
        if (!updated)
            return res.status(404).json({ message: 'Variante no encontrada' });
        const skuToSend = (updated.external_sku || updated.sku || '').toString().trim();
        if (skuToSend) {
            if (updated.mercado_libre_item_id && updated.mercado_libre_variant_id) {
                (0, stock_controller_1.updateMercadoLibreSku)(updated.mercado_libre_item_id, updated.mercado_libre_variant_id, skuToSend).catch(err => console.error('[updateVariant] Error enviando SKU a ML:', err));
            }
            if (updated.tienda_nube_id && updated.tienda_nube_variant_id) {
                (0, stock_controller_1.updateTiendaNubeSku)(updated.tienda_nube_id, updated.tienda_nube_variant_id, skuToSend).catch(err => console.error('[updateVariant] Error enviando SKU a TN:', err));
            }
        }
        res.json({ id: updated.id, sku: updated.sku, external_sku: updated.external_sku });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error actualizando variante' });
    }
});
exports.updateVariant = updateVariant;
/** Elimina un producto por ID (variantes, colores, stock en cascada). No elimina si alguna variante está en pedidos. */
function deleteProductById(productId) {
    return __awaiter(this, void 0, void 0, function* () {
        const inOrder = yield (0, db_1.get)(`SELECT 1 FROM order_items oi
     JOIN product_variants pv ON pv.id = oi.variant_id
     JOIN product_colors pc ON pc.id = pv.product_color_id
     WHERE pc.product_id = ? LIMIT 1`, [productId]);
        if (inOrder)
            return { deleted: false, error: 'in_orders' };
        const result = yield (0, db_1.execute)('DELETE FROM products WHERE id = ?', [productId]);
        const affected = result && result.affectedRows;
        if (affected === 0)
            return { deleted: false, error: 'not_found' };
        return { deleted: true };
    });
}
/** Eliminar un producto (artículo) y todas sus variantes, colores y stock. No se puede si alguna variante está en pedidos. */
const deleteProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const productId = req.params.id;
    if (!productId)
        return res.status(400).json({ message: 'Falta productId' });
    try {
        const r = yield deleteProductById(productId);
        if (!r.deleted) {
            if (r.error === 'in_orders') {
                return res.status(400).json({
                    message: 'No se puede eliminar el artículo porque alguna variante está en pedidos.',
                });
            }
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
/** Listar publicaciones vinculadas a una variante (variant_publications) */
const getVariantPublications = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { variantId } = req.params;
    if (!variantId)
        return res.status(400).json({ message: 'variantId requerido' });
    try {
        const exists = yield (0, db_1.get)('SELECT id FROM product_variants WHERE id = ?', [variantId]);
        if (!exists)
            return res.status(404).json({ message: 'Variante no encontrada' });
        const rows = yield (0, db_1.query)(`SELECT id, platform, external_product_id, external_variant_id, pack_size, created_at FROM variant_publications WHERE variant_id = ? ORDER BY platform, external_product_id`, [variantId]);
        res.json(rows || []);
    }
    catch (error) {
        console.error('getVariantPublications:', error);
        res.status(500).json({ message: 'Error listando publicaciones' });
    }
});
exports.getVariantPublications = getVariantPublications;
/** Agregar una publicación a una variante */
const addVariantPublication = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { variantId } = req.params;
    const { platform, externalProductId, externalVariantId, packSize } = req.body;
    if (!variantId || !platform || !externalProductId) {
        return res.status(400).json({ message: 'variantId, platform y externalProductId son requeridos' });
    }
    if (platform !== 'mercadolibre' && platform !== 'tiendanube') {
        return res.status(400).json({ message: 'platform debe ser mercadolibre o tiendanube' });
    }
    const extVariantId = (externalVariantId != null && String(externalVariantId).trim() !== '') ? String(externalVariantId).trim() : '';
    const pack = Math.max(1, Math.floor(Number(packSize) || 1));
    try {
        const exists = yield (0, db_1.get)('SELECT id FROM product_variants WHERE id = ?', [variantId]);
        if (!exists)
            return res.status(404).json({ message: 'Variante no encontrada' });
        const id = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size) VALUES (?, ?, ?, ?, ?, ?)`, [id, variantId, platform, String(externalProductId).trim(), extVariantId, pack]);
        const row = yield (0, db_1.get)('SELECT id, variant_id, platform, external_product_id, external_variant_id, pack_size, created_at FROM variant_publications WHERE id = ?', [id]);
        res.status(201).json(row);
    }
    catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Esa publicación ya está vinculada a esta variante' });
        }
        console.error('addVariantPublication:', error);
        res.status(500).json({ message: 'Error agregando publicación' });
    }
});
exports.addVariantPublication = addVariantPublication;
/** Eliminar una publicación de una variante */
const deleteVariantPublication = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { variantId, publicationId } = req.params;
    if (!variantId || !publicationId)
        return res.status(400).json({ message: 'variantId y publicationId requeridos' });
    try {
        const result = yield (0, db_1.execute)('DELETE FROM variant_publications WHERE id = ? AND variant_id = ?', [publicationId, variantId]);
        const deleted = (result === null || result === void 0 ? void 0 : result.affectedRows) || 0;
        if (deleted === 0) {
            return res.status(404).json({ message: 'Publicación no encontrada o no pertenece a esta variante' });
        }
        res.json({ deleted: true });
    }
    catch (error) {
        console.error('deleteVariantPublication:', error);
        res.status(500).json({ message: 'Error eliminando publicación' });
    }
});
exports.deleteVariantPublication = deleteVariantPublication;
