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
exports.getDespachoStats = exports.getProductosSinDespacho = exports.asignarDespachoATodos = exports.asignarDespachoAProducto = exports.removeDespachoItem = exports.addDespachoItem = exports.deleteDespacho = exports.updateDespacho = exports.createDespacho = exports.getDespachoById = exports.getDespachos = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
const despachoFob_1 = require("../utils/despachoFob");
const getStockTotalByProductId = (productId) => __awaiter(void 0, void 0, void 0, function* () {
    const stockRow = yield (0, db_1.get)(`SELECT COALESCE(SUM(s.stock), 0) AS stock_total
     FROM product_colors pc
     JOIN product_variants pv ON pv.product_color_id = pc.id
     LEFT JOIN stocks s ON s.variant_id = pv.id
     WHERE pc.product_id = ?`, [productId]);
    return Number(stockRow === null || stockRow === void 0 ? void 0 : stockRow.stock_total) || 0;
});
const getAssignedTotalByProductId = (productId) => __awaiter(void 0, void 0, void 0, function* () {
    const assignedRow = yield (0, db_1.get)(`SELECT COALESCE(SUM(cantidad), 0) AS total_asignado
     FROM despacho_items
     WHERE product_id = ?`, [productId]);
    return Number(assignedRow === null || assignedRow === void 0 ? void 0 : assignedRow.total_asignado) || 0;
});
/** Suma cantidad al stock de depósito de una variante (ingreso por despacho). */
function incrementVariantDepotStock(variantId, cantidadNum) {
    return __awaiter(this, void 0, void 0, function* () {
        const stockRow = yield (0, db_1.get)(`SELECT stock FROM stocks WHERE variant_id = ?`, [variantId]);
        const currentStock = Number((stockRow === null || stockRow === void 0 ? void 0 : stockRow.stock) || 0);
        yield (0, db_1.execute)(`INSERT INTO stocks (variant_id, stock) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE stock = ?`, [variantId, currentStock + cantidadNum, currentStock + cantidadNum]);
    });
}
// Obtener todos los despachos
const getDespachos = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const fobInfo = yield (0, despachoFob_1.persistDespachoFobFromList)();
        const { estado, desde, hasta, limit = '50', offset = '0' } = req.query;
        let whereClause = '1=1';
        const params = [];
        if (estado) {
            whereClause += ' AND d.estado = ?';
            params.push(estado);
        }
        if (desde) {
            whereClause += ' AND d.fecha_despacho >= ?';
            params.push(desde);
        }
        if (hasta) {
            whereClause += ' AND d.fecha_despacho <= ?';
            params.push(hasta);
        }
        const despachos = yield (0, db_1.query)(`
      SELECT 
        d.*,
        COUNT(DISTINCT di.id) as total_items,
        SUM(di.cantidad) as total_unidades
      FROM despachos d
      LEFT JOIN despacho_items di ON di.despacho_id = d.id
      WHERE ${whereClause}
      GROUP BY d.id
      ORDER BY d.fecha_despacho DESC
      LIMIT ? OFFSET ?
    `, [...params, parseInt(limit), parseInt(offset)]);
        const countResult = yield (0, db_1.get)(`SELECT COUNT(*) as total FROM despachos d WHERE ${whereClause}`, params);
        res.json({
            despachos,
            total: (countResult === null || countResult === void 0 ? void 0 : countResult.total) || 0,
            fob_list_id: fobInfo.id,
            fob_list_name: fobInfo.name || null
        });
    }
    catch (error) {
        console.error('Error fetching despachos:', error);
        res.status(500).json({ message: 'Error obteniendo despachos', error: error.message });
    }
});
exports.getDespachos = getDespachos;
// Obtener un despacho por ID con sus items
const getDespachoById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const fobInfo = yield (0, despachoFob_1.persistDespachoFobFromList)(id);
        const despacho = yield (0, db_1.get)(`SELECT * FROM despachos WHERE id = ?`, [id]);
        if (!despacho) {
            return res.status(404).json({ message: 'Despacho no encontrado' });
        }
        // Obtener items del despacho (color name viene de colors, no de product_colors)
        const itemsRaw = yield (0, db_1.query)(`
      SELECT 
        di.*,
        p.name as product_name,
        p.sku as product_sku,
        pv.sku as variant_sku,
        c.name as color_name
      FROM despacho_items di
      LEFT JOIN products p ON p.id = di.product_id
      LEFT JOIN product_variants pv ON pv.id = di.variant_id
      LEFT JOIN product_colors pc ON pc.id = pv.product_color_id
      LEFT JOIN colors c ON c.id = pc.color_id
      WHERE di.despacho_id = ?
      ORDER BY di.created_at
    `, [id]);
        const items = (0, despachoFob_1.applyFobToDespachoItems)(itemsRaw, fobInfo);
        const valorFob = (0, despachoFob_1.sumItemsFob)(items);
        res.json(Object.assign(Object.assign({}, despacho), { valor_fob: valorFob, fob_list_id: fobInfo.id, fob_list_name: fobInfo.name || null, items }));
    }
    catch (error) {
        console.error('Error fetching despacho:', error);
        res.status(500).json({ message: 'Error obteniendo despacho', error: error.message });
    }
});
exports.getDespachoById = getDespachoById;
// Crear nuevo despacho
const createDespacho = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { numero_despacho, fecha_despacho, pais_origen = 'Brasil', proveedor, descripcion, valor_fob, valor_cif, moneda = 'USD', estado = 'despachado', notas, items = [], 
        /** Si es true, al crear ítems con variant_id suma esa cantidad al stock (por defecto no, para no cambiar integraciones existentes). */
        incrementStockForItems = false } = req.body;
        if (!numero_despacho || !fecha_despacho) {
            return res.status(400).json({ message: 'Número de despacho y fecha son requeridos' });
        }
        // Verificar que no exista el número de despacho
        const existing = yield (0, db_1.get)(`SELECT id FROM despachos WHERE numero_despacho = ?`, [numero_despacho]);
        if (existing) {
            return res.status(400).json({ message: 'Ya existe un despacho con ese número' });
        }
        const despachoId = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`
      INSERT INTO despachos (id, numero_despacho, fecha_despacho, pais_origen, proveedor, descripcion, valor_fob, valor_cif, moneda, estado, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [despachoId, numero_despacho, fecha_despacho, pais_origen, proveedor, descripcion, valor_fob, valor_cif, moneda, estado, notas]);
        const doStock = incrementStockForItems === true;
        // Agregar items si se proporcionaron
        for (const item of items) {
            const itemId = (0, uuid_1.v4)();
            const qty = Math.floor(Number(item.cantidad) || 0);
            yield (0, db_1.execute)(`
        INSERT INTO despacho_items (id, despacho_id, product_id, variant_id, cantidad, costo_unitario, descripcion_item)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [itemId, despachoId, item.product_id || null, item.variant_id || null, qty, item.costo_unitario || null, item.descripcion_item || null]);
            if (doStock && item.variant_id && qty > 0) {
                yield incrementVariantDepotStock(String(item.variant_id), qty);
            }
            // Actualizar el último despacho del producto
            if (item.product_id) {
                yield (0, db_1.execute)(`UPDATE products SET ultimo_despacho_id = ?, pais_origen = ? WHERE id = ?`, [despachoId, pais_origen, item.product_id]);
            }
        }
        yield (0, despachoFob_1.persistDespachoFobFromList)(despachoId);
        res.status(201).json({
            message: 'Despacho creado exitosamente',
            id: despachoId,
            incrementStockForItems: doStock
        });
    }
    catch (error) {
        console.error('Error creating despacho:', error);
        res.status(500).json({ message: 'Error creando despacho', error: error.message });
    }
});
exports.createDespacho = createDespacho;
// Actualizar despacho
const updateDespacho = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { numero_despacho, fecha_despacho, pais_origen, proveedor, descripcion, valor_fob, valor_cif, moneda, estado, notas } = req.body;
        const existing = yield (0, db_1.get)(`SELECT id FROM despachos WHERE id = ?`, [id]);
        if (!existing) {
            return res.status(404).json({ message: 'Despacho no encontrado' });
        }
        // Verificar número único si se está cambiando
        if (numero_despacho) {
            const duplicate = yield (0, db_1.get)(`SELECT id FROM despachos WHERE numero_despacho = ? AND id != ?`, [numero_despacho, id]);
            if (duplicate) {
                return res.status(400).json({ message: 'Ya existe otro despacho con ese número' });
            }
        }
        yield (0, db_1.execute)(`
      UPDATE despachos SET
        numero_despacho = COALESCE(?, numero_despacho),
        fecha_despacho = COALESCE(?, fecha_despacho),
        pais_origen = COALESCE(?, pais_origen),
        proveedor = COALESCE(?, proveedor),
        descripcion = COALESCE(?, descripcion),
        valor_fob = COALESCE(?, valor_fob),
        valor_cif = COALESCE(?, valor_cif),
        moneda = COALESCE(?, moneda),
        estado = COALESCE(?, estado),
        notas = COALESCE(?, notas)
      WHERE id = ?
    `, [numero_despacho, fecha_despacho, pais_origen, proveedor, descripcion, valor_fob, valor_cif, moneda, estado, notas, id]);
        res.json({ message: 'Despacho actualizado' });
    }
    catch (error) {
        console.error('Error updating despacho:', error);
        res.status(500).json({ message: 'Error actualizando despacho', error: error.message });
    }
});
exports.updateDespacho = updateDespacho;
// Eliminar despacho
const deleteDespacho = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const existing = yield (0, db_1.get)(`SELECT id FROM despachos WHERE id = ?`, [id]);
        if (!existing) {
            return res.status(404).json({ message: 'Despacho no encontrado' });
        }
        // Los items se eliminan automáticamente por CASCADE
        yield (0, db_1.execute)(`DELETE FROM despachos WHERE id = ?`, [id]);
        res.json({ message: 'Despacho eliminado' });
    }
    catch (error) {
        console.error('Error deleting despacho:', error);
        res.status(500).json({ message: 'Error eliminando despacho', error: error.message });
    }
});
exports.deleteDespacho = deleteDespacho;
// Agregar item a un despacho
const addDespachoItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { product_id, variant_id, cantidad, costo_unitario, descripcion_item, incrementStock } = req.body;
        /** Por defecto true: agregar al depósito al cargar mercadería al despacho. Pasar false si el stock ya se cargó (ej. Tango) y solo querés trazabilidad. */
        const shouldIncrementStock = incrementStock !== false;
        const despacho = yield (0, db_1.get)(`SELECT id, pais_origen FROM despachos WHERE id = ?`, [id]);
        if (!despacho) {
            return res.status(404).json({ message: 'Despacho no encontrado' });
        }
        const cantidadNum = Math.floor(Number(cantidad) || 0);
        if (cantidadNum <= 0) {
            return res.status(400).json({ message: 'La cantidad debe ser mayor a 0' });
        }
        if (!variant_id) {
            return res.status(400).json({ message: 'variant_id es requerido' });
        }
        const variantRow = yield (0, db_1.get)(`SELECT pv.id AS variant_id, pc.product_id AS product_id
       FROM product_variants pv
       JOIN product_colors pc ON pc.id = pv.product_color_id
       WHERE pv.id = ?
       LIMIT 1`, [variant_id]);
        if (!(variantRow === null || variantRow === void 0 ? void 0 : variantRow.variant_id) || !(variantRow === null || variantRow === void 0 ? void 0 : variantRow.product_id)) {
            return res.status(404).json({ message: 'Variante no encontrada' });
        }
        const resolvedProductId = product_id || variantRow.product_id;
        const itemId = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`
      INSERT INTO despacho_items (id, despacho_id, product_id, variant_id, cantidad, costo_unitario, descripcion_item)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [itemId, id, resolvedProductId || null, variant_id || null, cantidadNum, costo_unitario || null, descripcion_item || null]);
        if (shouldIncrementStock) {
            yield incrementVariantDepotStock(variant_id, cantidadNum);
        }
        // Actualizar el último despacho del producto
        if (resolvedProductId) {
            yield (0, db_1.execute)(`UPDATE products SET ultimo_despacho_id = ?, pais_origen = ? WHERE id = ?`, [id, despacho.pais_origen, resolvedProductId]);
        }
        yield (0, despachoFob_1.persistDespachoFobFromList)(id);
        res.status(201).json({
            message: 'Item agregado al despacho',
            id: itemId,
            stockIncremented: shouldIncrementStock
        });
    }
    catch (error) {
        console.error('Error adding despacho item:', error);
        res.status(500).json({ message: 'Error agregando item', error: error.message });
    }
});
exports.addDespachoItem = addDespachoItem;
// Eliminar item de un despacho
const removeDespachoItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id, itemId } = req.params;
        yield (0, db_1.execute)(`DELETE FROM despacho_items WHERE id = ? AND despacho_id = ?`, [itemId, id]);
        yield (0, despachoFob_1.persistDespachoFobFromList)(id);
        res.json({ message: 'Item eliminado del despacho' });
    }
    catch (error) {
        console.error('Error removing despacho item:', error);
        res.status(500).json({ message: 'Error eliminando item', error: error.message });
    }
});
exports.removeDespachoItem = removeDespachoItem;
/** Busca producto por SKU base o código de variante (ej. QE5546 o QE5546-158-614). */
function findProductBySkuInput(skuRaw) {
    return __awaiter(this, void 0, void 0, function* () {
        const skuTrim = String(skuRaw || '').trim();
        if (!skuTrim)
            return null;
        let row = yield (0, db_1.get)(`SELECT id, sku, name FROM products WHERE sku = ?`, [skuTrim]);
        if (row)
            return row;
        const base = skuTrim.split('-')[0];
        if (base && base !== skuTrim) {
            row = yield (0, db_1.get)(`SELECT id, sku, name FROM products WHERE sku = ?`, [base]);
            if (row)
                return row;
        }
        row = yield (0, db_1.get)(`SELECT id, sku, name FROM products WHERE ? LIKE CONCAT(sku, '-%') ORDER BY CHAR_LENGTH(sku) DESC LIMIT 1`, [skuTrim]);
        return row || null;
    });
}
/** Asigna un despacho ya existente (por número) a un solo producto por código de modelo / variante. */
const asignarDespachoAProducto = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { numero_despacho, sku } = req.body || {};
        if (!numero_despacho || !String(numero_despacho).trim()) {
            return res.status(400).json({ message: 'numero_despacho es requerido' });
        }
        if (!sku || !String(sku).trim()) {
            return res.status(400).json({ message: 'sku es requerido (código de modelo o variante, ej. QE5546 o QE5546-158-614)' });
        }
        const despacho = yield (0, db_1.get)(`SELECT id, pais_origen, numero_despacho FROM despachos WHERE numero_despacho = ?`, [
            String(numero_despacho).trim()
        ]);
        if (!(despacho === null || despacho === void 0 ? void 0 : despacho.id)) {
            return res.status(404).json({
                message: `No existe un despacho con el número "${String(numero_despacho).trim()}". Crealo primero o verificá el número.`
            });
        }
        const product = yield findProductBySkuInput(String(sku));
        if (!product) {
            return res.status(404).json({
                message: `No se encontró un producto con código "${String(sku).trim()}". Probá con el SKU del modelo (ej. QE5546).`
            });
        }
        const stockTotal = yield getStockTotalByProductId(product.id);
        const assignedTotal = yield getAssignedTotalByProductId(product.id);
        const cantidadDisponible = Math.max(0, stockTotal - assignedTotal);
        if (cantidadDisponible <= 0) {
            return res.status(400).json({
                message: `El producto "${product.name}" (${product.sku}) ya no tiene unidades disponibles para asignar a otro despacho.`
            });
        }
        const yaEnDespacho = yield (0, db_1.get)(`SELECT id FROM despacho_items WHERE despacho_id = ? AND product_id = ? LIMIT 1`, [despacho.id, product.id]);
        if (!yaEnDespacho) {
            const itemId = (0, uuid_1.v4)();
            yield (0, db_1.execute)(`INSERT INTO despacho_items (id, despacho_id, product_id, variant_id, cantidad, costo_unitario, descripcion_item)
         VALUES (?, ?, ?, NULL, ?, NULL, ?)`, [itemId, despacho.id, product.id, cantidadDisponible, `${product.name} - ${product.sku || ''}`.trim()]);
        }
        else {
            yield (0, db_1.execute)(`UPDATE despacho_items SET cantidad = cantidad + ? WHERE id = ?`, [cantidadDisponible, yaEnDespacho.id]);
        }
        const pais = despacho.pais_origen && String(despacho.pais_origen).trim()
            ? despacho.pais_origen
            : 'Brasil';
        yield (0, db_1.execute)(`UPDATE products SET ultimo_despacho_id = ?, pais_origen = ? WHERE id = ?`, [
            despacho.id,
            pais,
            product.id
        ]);
        yield (0, despachoFob_1.persistDespachoFobFromList)(despacho.id);
        res.status(201).json({
            message: `Se asignó el despacho ${despacho.numero_despacho} al producto "${product.name}" (${product.sku}).`,
            despachoId: despacho.id,
            numero_despacho: despacho.numero_despacho,
            productId: product.id,
            sku: product.sku
        });
    }
    catch (error) {
        console.error('asignarDespachoAProducto:', error);
        res.status(500).json({ message: 'Error al asignar despacho al producto', error: error.message });
    }
});
exports.asignarDespachoAProducto = asignarDespachoAProducto;
// Asignar un número de despacho a todos los productos que aún no tienen despacho
const asignarDespachoATodos = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { numero_despacho, fecha_despacho, pais_origen = 'Brasil', proveedor, descripcion, notas } = req.body;
        if (!numero_despacho) {
            return res.status(400).json({ message: 'Número de despacho es requerido' });
        }
        const fecha = fecha_despacho || new Date().toISOString().split('T')[0];
        const productos = yield (0, db_1.query)(`
      SELECT 
        p.id, 
        p.name, 
        p.sku,
        COALESCE(SUM(s.stock), 0) as stock_total,
        COALESCE(di_total.total_asignado, 0) as total_asignado,
        GREATEST(COALESCE(SUM(s.stock), 0) - COALESCE(di_total.total_asignado, 0), 0) as cantidad_disponible
      FROM products p
      LEFT JOIN product_colors pc ON pc.product_id = p.id
      LEFT JOIN product_variants pv ON pv.product_color_id = pc.id
      LEFT JOIN stocks s ON s.variant_id = pv.id
      LEFT JOIN (
        SELECT product_id, SUM(cantidad) as total_asignado
        FROM despacho_items
        WHERE product_id IS NOT NULL
        GROUP BY product_id
      ) di_total ON di_total.product_id = p.id
      GROUP BY p.id, p.name, p.sku, di_total.total_asignado
      HAVING cantidad_disponible > 0
      ORDER BY p.name
    `);
        if (productos.length === 0) {
            return res.status(400).json({
                message: 'No hay productos sin despacho asignado. Todos los artículos ya tienen un número de despacho.',
                total_asignados: 0
            });
        }
        const despachoExistente = yield (0, db_1.get)(`SELECT id, pais_origen FROM despachos WHERE numero_despacho = ?`, [numero_despacho]);
        let despachoId;
        let creadoNuevo = false;
        if (despachoExistente === null || despachoExistente === void 0 ? void 0 : despachoExistente.id) {
            despachoId = despachoExistente.id;
        }
        else {
            despachoId = (0, uuid_1.v4)();
            creadoNuevo = true;
            yield (0, db_1.execute)(`
        INSERT INTO despachos (id, numero_despacho, fecha_despacho, pais_origen, proveedor, descripcion, valor_fob, valor_cif, moneda, estado, notas)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'USD', 'despachado', ?)
      `, [despachoId, numero_despacho, fecha, pais_origen, proveedor || null, descripcion || null, notas || null]);
        }
        const paisParaProductos = ((despachoExistente === null || despachoExistente === void 0 ? void 0 : despachoExistente.pais_origen) && String(despachoExistente.pais_origen).trim()) || pais_origen;
        for (const p of productos) {
            const yaEnDespacho = yield (0, db_1.get)(`SELECT id FROM despacho_items WHERE despacho_id = ? AND product_id = ? LIMIT 1`, [despachoId, p.id]);
            const cantidad = Number(p.cantidad_disponible) || 0;
            if (cantidad <= 0)
                continue;
            if (!yaEnDespacho) {
                const itemId = (0, uuid_1.v4)();
                yield (0, db_1.execute)(`
          INSERT INTO despacho_items (id, despacho_id, product_id, variant_id, cantidad, costo_unitario, descripcion_item)
          VALUES (?, ?, ?, NULL, ?, NULL, ?)
        `, [itemId, despachoId, p.id, cantidad, `${p.name} - ${p.sku || ''}`.trim()]);
            }
            else {
                yield (0, db_1.execute)(`UPDATE despacho_items SET cantidad = cantidad + ? WHERE id = ?`, [cantidad, yaEnDespacho.id]);
            }
            yield (0, db_1.execute)(`UPDATE products SET ultimo_despacho_id = ?, pais_origen = ? WHERE id = ?`, [
                despachoId,
                paisParaProductos,
                p.id
            ]);
        }
        yield (0, despachoFob_1.persistDespachoFobFromList)(despachoId);
        res.status(201).json({
            message: creadoNuevo
                ? `Se creó el despacho "${numero_despacho}" y se asignó a ${productos.length} producto(s).`
                : `Se usó el despacho existente "${numero_despacho}" y se asignó a ${productos.length} producto(s) sin despacho.`,
            id: despachoId,
            numero_despacho,
            total_asignados: productos.length
        });
    }
    catch (error) {
        console.error('Error asignando despacho a todos:', error);
        res.status(500).json({ message: 'Error al asignar despacho', error: error.message });
    }
});
exports.asignarDespachoATodos = asignarDespachoATodos;
// Obtener productos sin despacho asignado
const getProductosSinDespacho = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const searchRaw = String(((_a = req.query) === null || _a === void 0 ? void 0 : _a.search) || '').trim();
        const search = `%${searchRaw}%`;
        const whereSearch = searchRaw
            ? `WHERE (
          p.name LIKE ? OR
          p.sku LIKE ? OR
          pv.sku LIKE ? OR
          c.name LIKE ? OR
          s2.size_code LIKE ?
        )`
            : '';
        const params = searchRaw ? [search, search, search, search, search] : [];
        const productos = yield (0, db_1.query)(`
      SELECT 
        p.id AS product_id,
        p.name, 
        p.sku,
        pv.id AS variant_id,
        pv.sku AS variant_sku,
        c.code AS color_code,
        s2.size_code,
        c.name AS color_name,
        p.pais_origen,
        COALESCE(s.stock, 0) as stock_total
      FROM products p
      JOIN product_colors pc ON pc.product_id = p.id
      JOIN product_variants pv ON pv.product_color_id = pc.id
      LEFT JOIN colors c ON c.id = pc.color_id
      LEFT JOIN sizes s2 ON s2.id = pv.size_id
      LEFT JOIN stocks s ON s.variant_id = pv.id
      ${whereSearch}
      ORDER BY p.name, c.name, s2.size_code
    `, params);
        res.json(productos);
    }
    catch (error) {
        console.error('Error fetching productos sin despacho:', error);
        res.status(500).json({ message: 'Error obteniendo productos', error: error.message });
    }
});
exports.getProductosSinDespacho = getProductosSinDespacho;
// Estadísticas de despachos
const getDespachoStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const fobInfo = yield (0, despachoFob_1.persistDespachoFobFromList)();
        const stats = yield (0, db_1.get)(`
      SELECT 
        COUNT(*) as total_despachos,
        SUM(CASE WHEN estado = 'en_transito' THEN 1 ELSE 0 END) as en_transito,
        SUM(CASE WHEN estado = 'en_aduana' THEN 1 ELSE 0 END) as en_aduana,
        SUM(CASE WHEN estado = 'despachado' THEN 1 ELSE 0 END) as despachados,
        SUM(CASE WHEN estado = 'entregado' THEN 1 ELSE 0 END) as entregados,
        SUM(valor_fob) as total_fob,
        SUM(valor_cif) as total_cif
      FROM despachos
    `);
        const itemsStats = yield (0, db_1.get)(`
      SELECT 
        COUNT(DISTINCT product_id) as productos_importados,
        SUM(cantidad) as total_unidades
      FROM despacho_items
    `);
        const porPais = yield (0, db_1.query)(`
      SELECT pais_origen, COUNT(*) as cantidad
      FROM despachos
      GROUP BY pais_origen
      ORDER BY cantidad DESC
    `);
        res.json(Object.assign(Object.assign(Object.assign({}, stats), itemsStats), { por_pais: porPais, fob_list_id: fobInfo.id, fob_list_name: fobInfo.name || null }));
    }
    catch (error) {
        console.error('Error fetching despacho stats:', error);
        res.status(500).json({ message: 'Error obteniendo estadísticas', error: error.message });
    }
});
exports.getDespachoStats = getDespachoStats;
