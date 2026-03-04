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
exports.getDespachoStats = exports.getProductosSinDespacho = exports.removeDespachoItem = exports.addDespachoItem = exports.deleteDespacho = exports.updateDespacho = exports.createDespacho = exports.getDespachoById = exports.getDespachos = void 0;
const db_1 = require("../database/db");
const uuid_1 = require("uuid");
// Obtener todos los despachos
const getDespachos = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
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
            total: (countResult === null || countResult === void 0 ? void 0 : countResult.total) || 0
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
        const despacho = yield (0, db_1.get)(`SELECT * FROM despachos WHERE id = ?`, [id]);
        if (!despacho) {
            return res.status(404).json({ message: 'Despacho no encontrado' });
        }
        // Obtener items del despacho
        const items = yield (0, db_1.query)(`
      SELECT 
        di.*,
        p.name as product_name,
        p.sku as product_sku,
        pv.sku as variant_sku,
        pc.color_name
      FROM despacho_items di
      LEFT JOIN products p ON p.id = di.product_id
      LEFT JOIN product_variants pv ON pv.id = di.variant_id
      LEFT JOIN product_colors pc ON pc.id = pv.product_color_id
      WHERE di.despacho_id = ?
      ORDER BY di.created_at
    `, [id]);
        res.json(Object.assign(Object.assign({}, despacho), { items }));
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
        const { numero_despacho, fecha_despacho, pais_origen = 'Brasil', proveedor, descripcion, valor_fob, valor_cif, moneda = 'USD', estado = 'despachado', notas, items = [] } = req.body;
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
        // Agregar items si se proporcionaron
        for (const item of items) {
            const itemId = (0, uuid_1.v4)();
            yield (0, db_1.execute)(`
        INSERT INTO despacho_items (id, despacho_id, product_id, variant_id, cantidad, costo_unitario, descripcion_item)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [itemId, despachoId, item.product_id || null, item.variant_id || null, item.cantidad || 0, item.costo_unitario || null, item.descripcion_item || null]);
            // Actualizar el último despacho del producto
            if (item.product_id) {
                yield (0, db_1.execute)(`UPDATE products SET ultimo_despacho_id = ?, pais_origen = ? WHERE id = ?`, [despachoId, pais_origen, item.product_id]);
            }
        }
        res.status(201).json({
            message: 'Despacho creado exitosamente',
            id: despachoId
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
        const { product_id, variant_id, cantidad, costo_unitario, descripcion_item } = req.body;
        const despacho = yield (0, db_1.get)(`SELECT id, pais_origen FROM despachos WHERE id = ?`, [id]);
        if (!despacho) {
            return res.status(404).json({ message: 'Despacho no encontrado' });
        }
        const itemId = (0, uuid_1.v4)();
        yield (0, db_1.execute)(`
      INSERT INTO despacho_items (id, despacho_id, product_id, variant_id, cantidad, costo_unitario, descripcion_item)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [itemId, id, product_id || null, variant_id || null, cantidad || 0, costo_unitario || null, descripcion_item || null]);
        // Actualizar el último despacho del producto
        if (product_id) {
            yield (0, db_1.execute)(`UPDATE products SET ultimo_despacho_id = ?, pais_origen = ? WHERE id = ?`, [id, despacho.pais_origen, product_id]);
        }
        res.status(201).json({
            message: 'Item agregado al despacho',
            id: itemId
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
        res.json({ message: 'Item eliminado del despacho' });
    }
    catch (error) {
        console.error('Error removing despacho item:', error);
        res.status(500).json({ message: 'Error eliminando item', error: error.message });
    }
});
exports.removeDespachoItem = removeDespachoItem;
// Obtener productos sin despacho asignado
const getProductosSinDespacho = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const productos = yield (0, db_1.query)(`
      SELECT 
        p.id, 
        p.name, 
        p.sku, 
        p.pais_origen,
        COALESCE(SUM(pv.stock), 0) as stock_total
      FROM products p
      LEFT JOIN product_variants pv ON pv.product_id = p.id
      WHERE p.ultimo_despacho_id IS NULL
      GROUP BY p.id, p.name, p.sku, p.pais_origen
      ORDER BY p.name
      LIMIT 200
    `);
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
        res.json(Object.assign(Object.assign(Object.assign({}, stats), itemsStats), { por_pais: porPais }));
    }
    catch (error) {
        console.error('Error fetching despacho stats:', error);
        res.status(500).json({ message: 'Error obteniendo estadísticas', error: error.message });
    }
});
exports.getDespachoStats = getDespachoStats;
