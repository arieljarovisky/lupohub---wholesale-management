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
exports.updateProduct = exports.patchStock = exports.getProductBySku = exports.getProductStockTotalBySku = exports.getVariantIdBySkuColorSize = exports.createProduct = exports.getProducts = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const getProducts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const rows = yield (0, db_1.query)(`
      SELECT p.id, p.sku, p.name, p.category, p.base_price,
             COALESCE(SUM(st.stock), 0) AS stock_total
      FROM products p
      LEFT JOIN product_colors pc ON pc.product_id = p.id
      LEFT JOIN product_variants pv ON pv.product_color_id = pc.id
      LEFT JOIN stocks st ON st.variant_id = pv.id
      GROUP BY p.id, p.sku, p.name, p.category, p.base_price
    `);
        res.json(rows);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error fetching products" });
    }
});
exports.getProducts = getProducts;
const createProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const newProduct = req.body;
    if (!newProduct.sku || !newProduct.name) {
        return res.status(400).json({ message: "SKU y Nombre son requeridos" });
    }
    const id = (0, uuid_1.v4)();
    try {
        yield (0, db_1.execute)(`INSERT INTO products (id, sku, name, category, base_price, description) 
       VALUES (?, ?, ?, ?, ?, ?)`, [id, newProduct.sku, newProduct.name, newProduct.category, newProduct.base_price, newProduct.description]);
        res.status(201).json({ id, sku: newProduct.sku, name: newProduct.name, category: newProduct.category, base_price: newProduct.base_price, description: newProduct.description });
    }
    catch (error) {
        console.error(error);
        // MySQL error code for Duplicate Entry is 1062 or code 'ER_DUP_ENTRY'
        if (error.code === 'ER_DUP_ENTRY' || error.message.includes('Duplicate entry')) {
            return res.status(409).json({ message: "El SKU ya existe" });
        }
        res.status(500).json({ message: "Error creating product" });
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
        const product = yield (0, db_1.get)(`SELECT p.id, p.sku, p.name, p.category, p.base_price FROM products p WHERE p.sku = ?`, [sku]);
        if (!product)
            return res.status(404).json({ message: 'Producto no encontrado' });
        const variants = yield (0, db_1.query)(`SELECT p.sku, c.code AS color_code, c.name AS color_name,
              s.size_code, COALESCE(st.stock,0) AS stock, pv.id AS variant_id
       FROM products p
       JOIN product_colors pc ON pc.product_id=p.id
       JOIN colors c ON c.id=pc.color_id
       JOIN product_variants pv ON pv.product_color_id=pc.id
       JOIN sizes s ON s.id=pv.size_id
       LEFT JOIN stocks st ON st.variant_id=pv.id
       WHERE p.sku=?
       ORDER BY c.code, s.size_code`, [sku]);
        const stock_total = yield (0, exports.getProductStockTotalBySku)(sku);
        res.json(Object.assign(Object.assign({}, product), { stock_total, variants }));
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
        yield (0, db_1.execute)(`INSERT INTO stocks(variant_id, stock) VALUES (?,?)
       ON DUPLICATE KEY UPDATE stock = VALUES(stock)`, [vId, stock]);
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
    const { name, category, base_price, description } = req.body;
    if (!id)
        return res.status(400).json({ message: 'ID inválido' });
    try {
        yield (0, db_1.execute)(`UPDATE products SET 
         name = COALESCE(?, name),
         category = COALESCE(?, category),
         base_price = COALESCE(?, base_price),
         description = COALESCE(?, description)
       WHERE id = ?`, [name !== null && name !== void 0 ? name : null, category !== null && category !== void 0 ? category : null, base_price !== null && base_price !== void 0 ? base_price : null, description !== null && description !== void 0 ? description : null, id]);
        const updated = yield (0, db_1.get)(`SELECT id, sku, name, category, base_price, description FROM products WHERE id = ?`, [id]);
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
