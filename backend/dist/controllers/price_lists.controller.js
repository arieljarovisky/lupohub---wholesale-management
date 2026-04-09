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
exports.setPriceListItemsBySku = exports.fillPriceListFromBase = exports.duplicatePriceList = exports.createPriceListsBulk = exports.setPriceListItems = exports.getPriceListItems = exports.deletePriceList = exports.updatePriceList = exports.createPriceList = exports.getPriceList = exports.listPriceLists = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
/** Listar listas de precios. Solo ADMIN. */
const listPriceLists = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden listar listas de precios' });
        }
        const rows = yield (0, db_1.query)(`SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM price_lists ORDER BY name`);
        res.json(rows || []);
    }
    catch (error) {
        console.error('listPriceLists:', error);
        res.status(500).json({ message: 'Error listando listas de precios' });
    }
});
exports.listPriceLists = listPriceLists;
/** Obtener una lista con sus ítems (product_id y price). Solo ADMIN. */
const getPriceList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden ver listas de precios' });
        }
        const { id } = req.params;
        const list = yield (0, db_1.get)(`SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM price_lists WHERE id = ?`, [id]);
        if (!list)
            return res.status(404).json({ message: 'Lista de precios no encontrada' });
        const items = yield (0, db_1.query)(`SELECT id, product_id AS productId, price FROM price_list_items WHERE price_list_id = ? ORDER BY product_id`, [id]);
        res.json(Object.assign(Object.assign({}, list), { items: items || [] }));
    }
    catch (error) {
        console.error('getPriceList:', error);
        res.status(500).json({ message: 'Error obteniendo lista de precios' });
    }
});
exports.getPriceList = getPriceList;
/** Crear lista de precios. Solo ADMIN. */
const createPriceList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden crear listas de precios' });
        }
        const { name, description } = req.body;
        if (!(name === null || name === void 0 ? void 0 : name.trim())) {
            return res.status(400).json({ message: 'El nombre es requerido' });
        }
        const id = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`INSERT INTO price_lists (id, name, description) VALUES (?, ?, ?)`, [id, name.trim(), (description !== null && description !== void 0 ? description : '').toString().trim() || null]);
        const created = yield (0, db_1.get)(`SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM price_lists WHERE id = ?`, [id]);
        res.status(201).json(created);
    }
    catch (error) {
        console.error('createPriceList:', error);
        res.status(500).json({ message: 'Error creando lista de precios' });
    }
});
exports.createPriceList = createPriceList;
/** Actualizar lista de precios (nombre/descripción). Solo ADMIN. */
const updatePriceList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden editar listas de precios' });
        }
        const { id } = req.params;
        const { name, description } = req.body;
        const existing = yield (0, db_1.get)('SELECT id FROM price_lists WHERE id = ?', [id]);
        if (!existing)
            return res.status(404).json({ message: 'Lista de precios no encontrada' });
        if (name !== undefined) {
            yield (0, db_1.execute)(`UPDATE price_lists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [name.trim(), id]);
        }
        if (description !== undefined) {
            yield (0, db_1.execute)(`UPDATE price_lists SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [description.trim() || null, id]);
        }
        const updated = yield (0, db_1.get)(`SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM price_lists WHERE id = ?`, [id]);
        res.json(updated);
    }
    catch (error) {
        console.error('updatePriceList:', error);
        res.status(500).json({ message: 'Error actualizando lista de precios' });
    }
});
exports.updatePriceList = updatePriceList;
/** Eliminar lista de precios. Solo ADMIN. */
const deletePriceList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden eliminar listas de precios' });
        }
        const { id } = req.params;
        const existing = yield (0, db_1.get)('SELECT id FROM price_lists WHERE id = ?', [id]);
        if (!existing)
            return res.status(404).json({ message: 'Lista de precios no encontrada' });
        yield (0, db_1.execute)('DELETE FROM price_lists WHERE id = ?', [id]);
        res.json({ message: 'Lista de precios eliminada', id });
    }
    catch (error) {
        console.error('deletePriceList:', error);
        res.status(500).json({ message: 'Error eliminando lista de precios' });
    }
});
exports.deletePriceList = deletePriceList;
/** Obtener ítems de una lista (product_id, price y opcionalmente nombre/sku del producto). Solo ADMIN. */
const getPriceListItems = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden ver ítems de listas de precios' });
        }
        const { id } = req.params;
        const exists = yield (0, db_1.get)('SELECT id FROM price_lists WHERE id = ?', [id]);
        if (!exists)
            return res.status(404).json({ message: 'Lista de precios no encontrada' });
        const items = yield (0, db_1.query)(`SELECT pli.id, pli.product_id AS productId, pli.price, p.sku, p.name
       FROM price_list_items pli
       JOIN products p ON p.id = pli.product_id
       WHERE pli.price_list_id = ?
       ORDER BY p.sku`, [id]);
        res.json(items || []);
    }
    catch (error) {
        console.error('getPriceListItems:', error);
        res.status(500).json({ message: 'Error obteniendo ítems de la lista' });
    }
});
exports.getPriceListItems = getPriceListItems;
/** Reemplazar ítems de una lista (array de { productId, price }). Solo ADMIN. */
const setPriceListItems = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden editar ítems de listas de precios' });
        }
        const { id } = req.params;
        const items = req.body;
        const exists = yield (0, db_1.get)('SELECT id FROM price_lists WHERE id = ?', [id]);
        if (!exists)
            return res.status(404).json({ message: 'Lista de precios no encontrada' });
        if (!Array.isArray(items)) {
            return res.status(400).json({ message: 'Se espera un array de { productId, price }' });
        }
        yield (0, db_1.execute)('DELETE FROM price_list_items WHERE price_list_id = ?', [id]);
        for (const it of items) {
            const productId = it === null || it === void 0 ? void 0 : it.productId;
            const price = Number(it === null || it === void 0 ? void 0 : it.price);
            if (!productId || isNaN(price) || price < 0)
                continue;
            const itemId = (0, uuid_1.v4)();
            yield (0, db_1.execute)(`INSERT INTO price_list_items (id, price_list_id, product_id, price) VALUES (?, ?, ?, ?)`, [itemId, id, productId, price]);
        }
        const updated = yield (0, db_1.query)(`SELECT product_id AS productId, price FROM price_list_items WHERE price_list_id = ? ORDER BY product_id`, [id]);
        res.json({ items: updated || [] });
    }
    catch (error) {
        console.error('setPriceListItems:', error);
        res.status(500).json({ message: 'Error guardando ítems de la lista' });
    }
});
exports.setPriceListItems = setPriceListItems;
/** Crear varias listas de precios de una vez. Body: { names: string[] } o { names: string, description?: string }[]. Solo ADMIN. */
const createPriceListsBulk = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden crear listas de precios' });
        }
        const body = req.body;
        const lists = ((_b = body.lists) === null || _b === void 0 ? void 0 : _b.length)
            ? body.lists
            : Array.isArray(body.names)
                ? body.names.map((n) => ({ name: String(n).trim(), description: undefined }))
                : [];
        const toCreate = lists.filter(l => l.name.length > 0);
        if (toCreate.length === 0) {
            return res.status(400).json({ message: 'Enviá al menos un nombre de lista (names o lists)' });
        }
        const created = [];
        for (const { name, description } of toCreate) {
            const id = (0, uuid_1.v4)();
            yield (0, db_1.execute)(`INSERT INTO price_lists (id, name, description) VALUES (?, ?, ?)`, [id, name, (description !== null && description !== void 0 ? description : '').toString().trim() || null]);
            const row = yield (0, db_1.get)(`SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM price_lists WHERE id = ?`, [id]);
            created.push(row);
        }
        res.status(201).json({ created, count: created.length });
    }
    catch (error) {
        console.error('createPriceListsBulk:', error);
        res.status(500).json({ message: 'Error creando listas de precios' });
    }
});
exports.createPriceListsBulk = createPriceListsBulk;
/** Duplicar una lista (nueva lista con el mismo nombre + sufijo y los mismos ítems). Body: { name: string }. Solo ADMIN. */
const duplicatePriceList = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden duplicar listas de precios' });
        }
        const { id } = req.params;
        const { name } = req.body;
        if (!(name === null || name === void 0 ? void 0 : name.trim()))
            return res.status(400).json({ message: 'El nombre de la nueva lista es requerido' });
        const source = yield (0, db_1.get)('SELECT id, name FROM price_lists WHERE id = ?', [id]);
        if (!source)
            return res.status(404).json({ message: 'Lista de precios no encontrada' });
        const items = yield (0, db_1.query)(`SELECT product_id AS productId, price FROM price_list_items WHERE price_list_id = ?`, [id]);
        const newId = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`INSERT INTO price_lists (id, name, description) VALUES (?, ?, NULL)`, [newId, name.trim()]);
        for (const it of items || []) {
            const productId = it === null || it === void 0 ? void 0 : it.productId;
            const price = Number(it === null || it === void 0 ? void 0 : it.price);
            if (!productId || isNaN(price) || price < 0)
                continue;
            yield (0, db_1.execute)(`INSERT INTO price_list_items (id, price_list_id, product_id, price) VALUES (?, ?, ?, ?)`, [(0, uuid_1.v4)(), newId, productId, price]);
        }
        const created = yield (0, db_1.get)(`SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM price_lists WHERE id = ?`, [newId]);
        res.status(201).json(created);
    }
    catch (error) {
        console.error('duplicatePriceList:', error);
        res.status(500).json({ message: 'Error duplicando la lista' });
    }
});
exports.duplicatePriceList = duplicatePriceList;
/** Rellenar lista con todos los productos del catálogo (precio base * multiplier). Body: { multiplier?: number }. Solo ADMIN. */
const fillPriceListFromBase = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden rellenar listas' });
        }
        const { id } = req.params;
        const multiplier = Number(req.body.multiplier);
        const factor = isNaN(multiplier) || multiplier <= 0 ? 1 : multiplier;
        const exists = yield (0, db_1.get)('SELECT id FROM price_lists WHERE id = ?', [id]);
        if (!exists)
            return res.status(404).json({ message: 'Lista de precios no encontrada' });
        const products = yield (0, db_1.query)(`SELECT
         p.id,
         COALESCE(
           NULLIF(p.base_price, 0),
           (
             SELECT MAX(pli.price)
             FROM price_list_items pli
             WHERE pli.product_id = p.id AND pli.price > 0
           ),
           0
         ) AS source_price
       FROM products p`);
        yield (0, db_1.execute)('DELETE FROM price_list_items WHERE price_list_id = ?', [id]);
        let count = 0;
        let skippedWithoutBase = 0;
        for (const p of products || []) {
            const source = Number((_b = p.source_price) !== null && _b !== void 0 ? _b : 0);
            if (!Number.isFinite(source) || source <= 0) {
                skippedWithoutBase++;
                continue;
            }
            const price = Math.round(source * factor * 100) / 100;
            if (!Number.isFinite(price) || price <= 0) {
                skippedWithoutBase++;
                continue;
            }
            yield (0, db_1.execute)(`INSERT INTO price_list_items (id, price_list_id, product_id, price) VALUES (?, ?, ?, ?)`, [(0, uuid_1.v4)(), id, p.id, price]);
            count++;
        }
        const items = yield (0, db_1.query)(`SELECT product_id AS productId, price FROM price_list_items WHERE price_list_id = ? ORDER BY product_id`, [id]);
        res.json({ items: items || [], count, skippedWithoutBase });
    }
    catch (error) {
        console.error('fillPriceListFromBase:', error);
        res.status(500).json({ message: 'Error rellenando la lista' });
    }
});
exports.fillPriceListFromBase = fillPriceListFromBase;
/** Reemplazar ítems por SKU. Body: { items: { sku: string; price: number }[] }. Solo ADMIN. */
const setPriceListItemsBySku = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) !== 'ADMIN') {
            return res.status(403).json({ message: 'Solo administradores pueden editar ítems de listas de precios' });
        }
        const { id } = req.params;
        const body = req.body;
        const input = Array.isArray(body === null || body === void 0 ? void 0 : body.items) ? body.items : [];
        const exists = yield (0, db_1.get)('SELECT id FROM price_lists WHERE id = ?', [id]);
        if (!exists)
            return res.status(404).json({ message: 'Lista de precios no encontrada' });
        const resolved = [];
        const notFound = [];
        const normalizeSku = (s) => String(s).replace(/[-/\s]/g, '').trim();
        const escapeLike = (s) => String(s).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        const padArticleCodeTo7 = (s) => { const d = String(s).replace(/\D/g, ''); return d ? (d.length <= 7 ? d.padStart(7, '0') : d) : ''; };
        for (const it of input) {
            const sku = String((_b = it === null || it === void 0 ? void 0 : it.sku) !== null && _b !== void 0 ? _b : '').trim();
            const price = Number(it === null || it === void 0 ? void 0 : it.price);
            if (!sku || isNaN(price) || price < 0)
                continue;
            let productId;
            const byBase = yield (0, db_1.get)(`SELECT id FROM products WHERE sku = ?`, [sku]);
            if (byBase === null || byBase === void 0 ? void 0 : byBase.id)
                productId = byBase.id;
            if (!productId) {
                const byVariant = yield (0, db_1.get)(`SELECT pc.product_id AS id FROM product_variants pv
           JOIN product_colors pc ON pc.id = pv.product_color_id
           WHERE pv.sku = ?
           LIMIT 1`, [sku]);
                if (byVariant === null || byVariant === void 0 ? void 0 : byVariant.id)
                    productId = byVariant.id;
            }
            if (!productId) {
                const padded = padArticleCodeTo7(sku);
                if (padded && padded !== sku) {
                    const byBasePadded = yield (0, db_1.get)(`SELECT id FROM products WHERE sku = ?`, [padded]);
                    if (byBasePadded === null || byBasePadded === void 0 ? void 0 : byBasePadded.id)
                        productId = byBasePadded.id;
                }
            }
            if (!productId) {
                const padded = padArticleCodeTo7(sku);
                if (padded && padded !== sku) {
                    const byVarPadded = yield (0, db_1.get)(`SELECT pc.product_id AS id FROM product_variants pv
             JOIN product_colors pc ON pc.id = pv.product_color_id
             WHERE pv.sku = ?
             LIMIT 1`, [padded]);
                    if (byVarPadded === null || byVarPadded === void 0 ? void 0 : byVarPadded.id)
                        productId = byVarPadded.id;
                }
            }
            if (!productId) {
                const normalized = normalizeSku(sku);
                if (normalized) {
                    const byBaseNorm = yield (0, db_1.get)(`SELECT id FROM products WHERE REPLACE(REPLACE(REPLACE(sku, '-', ''), '/', ''), CHAR(32), '') = ?`, [normalized]);
                    if (byBaseNorm === null || byBaseNorm === void 0 ? void 0 : byBaseNorm.id)
                        productId = byBaseNorm.id;
                }
            }
            if (!productId) {
                const normalized = normalizeSku(sku);
                if (normalized) {
                    const byVarNorm = yield (0, db_1.get)(`SELECT pc.product_id AS id FROM product_variants pv
             JOIN product_colors pc ON pc.id = pv.product_color_id
             WHERE REPLACE(REPLACE(REPLACE(pv.sku, '-', ''), '/', ''), CHAR(32), '') = ?
             LIMIT 1`, [normalized]);
                    if (byVarNorm === null || byVarNorm === void 0 ? void 0 : byVarNorm.id)
                        productId = byVarNorm.id;
                }
            }
            if (!productId) {
                const normalized = normalizeSku(sku);
                if (normalized) {
                    const pattern = escapeLike(normalized) + '%';
                    const byBaseStarts = yield (0, db_1.get)(`SELECT id FROM products WHERE REPLACE(REPLACE(REPLACE(sku, '-', ''), '/', ''), CHAR(32), '') LIKE ? LIMIT 1`, [pattern]);
                    if (byBaseStarts === null || byBaseStarts === void 0 ? void 0 : byBaseStarts.id)
                        productId = byBaseStarts.id;
                }
            }
            if (!productId) {
                const normalized = normalizeSku(sku);
                if (normalized) {
                    const pattern = escapeLike(normalized) + '%';
                    const byVarStarts = yield (0, db_1.get)(`SELECT pc.product_id AS id FROM product_variants pv
             JOIN product_colors pc ON pc.id = pv.product_color_id
             WHERE REPLACE(REPLACE(REPLACE(pv.sku, '-', ''), '/', ''), CHAR(32), '') LIKE ?
             LIMIT 1`, [pattern]);
                    if (byVarStarts === null || byVarStarts === void 0 ? void 0 : byVarStarts.id)
                        productId = byVarStarts.id;
                }
            }
            if (productId)
                resolved.push({ productId, price });
            else
                notFound.push(sku);
        }
        yield (0, db_1.execute)('DELETE FROM price_list_items WHERE price_list_id = ?', [id]);
        const byProduct = new Map();
        for (const it of resolved)
            byProduct.set(it.productId, it.price);
        for (const [productId, price] of byProduct) {
            yield (0, db_1.execute)(`INSERT INTO price_list_items (id, price_list_id, product_id, price) VALUES (?, ?, ?, ?)`, [(0, uuid_1.v4)(), id, productId, price]);
        }
        const items = yield (0, db_1.query)(`SELECT product_id AS productId, price FROM price_list_items WHERE price_list_id = ? ORDER BY product_id`, [id]);
        res.json({ items: items || [], imported: byProduct.size, notFound: notFound.length ? notFound : undefined });
    }
    catch (error) {
        console.error('setPriceListItemsBySku:', error);
        res.status(500).json({ message: 'Error importando por SKU' });
    }
});
exports.setPriceListItemsBySku = setPriceListItemsBySku;
