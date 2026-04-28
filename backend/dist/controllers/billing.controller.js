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
exports.exportBilling = exports.listBilling = void 0;
const db_1 = require("../database/db");
function parseMoney(value) {
    if (value == null)
        return 0;
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : 0;
    const s = String(value).trim().replace(/\s/g, '').replace(/\$/g, '');
    if (!s)
        return 0;
    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    if (hasComma && hasDot) {
        const n = Number(s.replace(/\./g, '').replace(',', '.'));
        return Number.isFinite(n) ? n : 0;
    }
    if (hasComma) {
        const n = Number(s.replace(',', '.'));
        return Number.isFinite(n) ? n : 0;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}
function normalizeDate(value) {
    if (typeof value === 'string') {
        const raw = value.trim();
        const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) {
            const dd = m[1].padStart(2, '0');
            const mm = m[2].padStart(2, '0');
            const yyyy = m[3];
            return `${yyyy}-${mm}-${dd}`;
        }
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime()))
        return String(value || '').slice(0, 10);
    return d.toISOString().slice(0, 10);
}
/** Lista unificada de facturas y notas de crédito, con filtros opcionales. */
const listBilling = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { desde, hasta, customerId, tipo } = req.query;
        const whereParts = [];
        const params = [];
        if (desde) {
            whereParts.push('b.fecha >= ?');
            params.push(desde);
        }
        if (hasta) {
            whereParts.push('b.fecha <= ?');
            params.push(hasta);
        }
        if (customerId) {
            whereParts.push('b.customer_id = ?');
            params.push(customerId);
        }
        if (tipo === 'FACTURA' || tipo === 'NC') {
            whereParts.push('b.tipo = ?');
            params.push(tipo);
        }
        const authUser = req.user;
        if ((authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER') {
            whereParts.push('b.customer_id IN (SELECT id FROM customers WHERE seller_id = ?)');
            params.push(authUser.id);
        }
        const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
        const sql = `
      SELECT *
      FROM (
        SELECT 
          i.id,
          'FACTURA' AS tipo,
          i.cbte_tipo,
          i.punto_venta,
          i.cbte_desde AS numero_desde,
          i.cbte_hasta AS numero_hasta,
          o.id AS order_id,
          o.date AS fecha,
          o.total AS importe,
          c.id AS customer_id,
          c.business_name AS customer_business_name,
          c.name AS customer_name,
          i.cae,
          i.cae_fch_vto AS cae_fch_vto,
          i.created_at
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id

        UNION ALL

        SELECT
          cn.id,
          'NC' AS tipo,
          cn.cbte_tipo,
          cn.punto_venta,
          cn.cbte_desde AS numero_desde,
          cn.cbte_hasta AS numero_hasta,
          cn.order_id AS order_id,
          o.date AS fecha,
          cn.amount_credited AS importe,
          c.id AS customer_id,
          c.business_name AS customer_business_name,
          c.name AS customer_name,
          cn.cae,
          cn.cae_fch_vto AS cae_fch_vto,
          cn.created_at
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        JOIN customers c ON c.id = o.customer_id
      ) AS b
      ${whereSql}
      ORDER BY b.fecha DESC, b.created_at DESC
    `;
        const rows = yield (0, db_1.query)(sql, params);
        const result = (rows || []).map((r) => {
            var _a, _b, _c;
            return ({
                id: r.id,
                tipo: r.tipo,
                cbteTipo: r.cbte_tipo,
                puntoVta: r.punto_venta,
                numeroDesde: r.numero_desde,
                numeroHasta: r.numero_hasta,
                orderId: r.order_id,
                fecha: r.fecha,
                importe: Number(r.importe) || 0,
                customerId: r.customer_id,
                customerBusinessName: (_b = (_a = r.customer_business_name) !== null && _a !== void 0 ? _a : r.customer_name) !== null && _b !== void 0 ? _b : '',
                cae: r.cae,
                caeFchVto: (_c = r.cae_fch_vto) !== null && _c !== void 0 ? _c : null,
                createdAt: r.created_at
            });
        });
        // Integrar facturas importadas desde Tango/Multimedias en la misma vista de facturación.
        // Solo aplica cuando el filtro de tipo incluye facturas.
        if (tipo !== 'NC') {
            const importedWhere = [`UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'FAC%'`];
            const importedParams = [];
            if (customerId) {
                importedWhere.push('e.customer_id = ?');
                importedParams.push(customerId);
            }
            if ((authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER') {
                importedWhere.push('c.seller_id = ?');
                importedParams.push(authUser.id);
            }
            const importedRows = yield (0, db_1.query)(`
        SELECT
          e.customer_id,
          e.line_order,
          e.line_date,
          e.numero,
          e.importe,
          e.detalle,
          c.business_name AS customer_business_name,
          c.name AS customer_name
        FROM customer_multimedia_entries e
        JOIN customers c ON c.id = e.customer_id
        WHERE ${importedWhere.join(' AND ')}
        ORDER BY e.line_date DESC, e.line_order DESC
        `, importedParams);
            const existingKeys = new Set(result
                .filter((r) => r.tipo === 'FACTURA')
                .map((r) => {
                var _a;
                return [
                    normalizeDate(r.fecha),
                    String((_a = r.numeroDesde) !== null && _a !== void 0 ? _a : '').trim().toUpperCase(),
                    Number(r.importe || 0).toFixed(2),
                    r.customerId
                ].join('|');
            }));
            const importedMapped = importedRows
                .map((r) => {
                var _a, _b, _c;
                const fecha = normalizeDate(r.line_date);
                const numero = String(r.numero || '').trim();
                const importe = parseMoney(r.importe);
                const dedupeKey = [
                    fecha,
                    numero.toUpperCase(),
                    importe.toFixed(2),
                    r.customer_id
                ].join('|');
                return {
                    dedupeKey,
                    row: {
                        id: `mm-fac-${r.customer_id}-${String((_a = r.line_order) !== null && _a !== void 0 ? _a : 'x')}-${fecha}-${numero.replace(/[^A-Za-z0-9]/g, '')}`,
                        tipo: 'FACTURA',
                        cbteTipo: null,
                        puntoVta: null,
                        numeroDesde: numero,
                        numeroHasta: numero,
                        orderId: null,
                        fecha,
                        importe,
                        customerId: r.customer_id,
                        customerBusinessName: (_c = (_b = r.customer_business_name) !== null && _b !== void 0 ? _b : r.customer_name) !== null && _c !== void 0 ? _c : '',
                        cae: null,
                        caeFchVto: null,
                        createdAt: null
                    }
                };
            })
                .filter(({ row, dedupeKey }) => {
                if (desde && row.fecha < String(desde))
                    return false;
                if (hasta && row.fecha > String(hasta))
                    return false;
                if (existingKeys.has(dedupeKey))
                    return false;
                existingKeys.add(dedupeKey);
                return true;
            })
                .map(({ row }) => row);
            result.push(...importedMapped);
            result.sort((a, b) => {
                const da = new Date(a.fecha).getTime() || 0;
                const db = new Date(b.fecha).getTime() || 0;
                if (db !== da)
                    return db - da;
                const ca = new Date(a.createdAt || 0).getTime() || 0;
                const cb = new Date(b.createdAt || 0).getTime() || 0;
                return cb - ca;
            });
        }
        res.json(result);
    }
    catch (error) {
        console.error('listBilling:', error);
        res.status(500).json({ message: 'Error listando facturación' });
    }
});
exports.listBilling = listBilling;
/** Exporta la lista de facturas y NC en CSV simple. */
const exportBilling = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Reutilizar listBilling internamente sería ideal, pero aquí rearmamos consulta para evitar doble serialización
        const { desde, hasta, customerId, tipo } = req.query;
        const whereParts = [];
        const params = [];
        if (desde) {
            whereParts.push('b.fecha >= ?');
            params.push(desde);
        }
        if (hasta) {
            whereParts.push('b.fecha <= ?');
            params.push(hasta);
        }
        if (customerId) {
            whereParts.push('b.customer_id = ?');
            params.push(customerId);
        }
        if (tipo === 'FACTURA' || tipo === 'NC') {
            whereParts.push('b.tipo = ?');
            params.push(tipo);
        }
        const authUser = req.user;
        if ((authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER') {
            whereParts.push('b.customer_id IN (SELECT id FROM customers WHERE seller_id = ?)');
            params.push(authUser.id);
        }
        const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
        const sql = `
      SELECT *
      FROM (
        SELECT 
          i.id,
          'FACTURA' AS tipo,
          i.cbte_tipo,
          i.punto_venta,
          i.cbte_desde AS numero_desde,
          i.cbte_hasta AS numero_hasta,
          o.id AS order_id,
          o.date AS fecha,
          o.total AS importe,
          c.id AS customer_id,
          c.business_name AS customer_business_name,
          i.cae,
          i.cae_fch_vto AS cae_fch_vto,
          i.created_at
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id

        UNION ALL

        SELECT
          cn.id,
          'NC' AS tipo,
          cn.cbte_tipo,
          cn.punto_venta,
          cn.cbte_desde AS numero_desde,
          cn.cbte_hasta AS numero_hasta,
          cn.order_id AS order_id,
          o.date AS fecha,
          cn.amount_credited AS importe,
          c.id AS customer_id,
          c.business_name AS customer_business_name,
          cn.cae,
          cn.cae_fch_vto AS cae_fch_vto,
          cn.created_at
        FROM credit_notes cn
        JOIN orders o ON o.id = cn.order_id
        JOIN customers c ON c.id = o.customer_id
      ) AS b
      ${whereSql}
      ORDER BY b.fecha DESC, b.created_at DESC
    `;
        const rows = yield (0, db_1.query)(sql, params);
        const header = [
            'fecha',
            'tipo',
            'cbte_tipo',
            'punto_vta',
            'numero_desde',
            'numero_hasta',
            'pedido_id',
            'cliente',
            'importe',
            'cae',
            'cae_fch_vto'
        ];
        const lines = [header.join(',')];
        for (const r of rows) {
            const line = [
                r.fecha,
                r.tipo,
                r.cbte_tipo,
                r.punto_venta,
                r.numero_desde,
                r.numero_hasta,
                r.order_id,
                `"${(r.customer_business_name || '').replace(/"/g, '""')}"`,
                Number(r.importe) || 0,
                r.cae,
                r.cae_fch_vto || ''
            ].join(',');
            lines.push(line);
        }
        // Exportar también facturas importadas cuando el filtro de tipo no sea NC.
        if (tipo !== 'NC') {
            const authUser = req.user;
            const importedWhere = [`UPPER(TRIM(COALESCE(e.tipo, ''))) LIKE 'FAC%'`];
            const importedParams = [];
            if (customerId) {
                importedWhere.push('e.customer_id = ?');
                importedParams.push(customerId);
            }
            if ((authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER') {
                importedWhere.push('c.seller_id = ?');
                importedParams.push(authUser.id);
            }
            const importedRows = yield (0, db_1.query)(`
        SELECT
          e.customer_id,
          e.line_date,
          e.numero,
          e.importe,
          c.business_name AS customer_business_name
        FROM customer_multimedia_entries e
        JOIN customers c ON c.id = e.customer_id
        WHERE ${importedWhere.join(' AND ')}
        ORDER BY e.line_date DESC, e.line_order DESC
        `, importedParams);
            const existingKeys = new Set(rows
                .filter((r) => r.tipo === 'FACTURA')
                .map((r) => {
                var _a;
                return [
                    normalizeDate(r.fecha),
                    String((_a = r.numero_desde) !== null && _a !== void 0 ? _a : '').trim().toUpperCase(),
                    Number(r.importe || 0).toFixed(2),
                    r.customer_id
                ].join('|');
            }));
            for (const r of importedRows) {
                const fecha = normalizeDate(r.line_date);
                if (desde && fecha < String(desde))
                    continue;
                if (hasta && fecha > String(hasta))
                    continue;
                const numero = String(r.numero || '').trim();
                const importe = parseMoney(r.importe);
                const key = [fecha, numero.toUpperCase(), importe.toFixed(2), r.customer_id].join('|');
                if (existingKeys.has(key))
                    continue;
                existingKeys.add(key);
                const line = [
                    fecha,
                    'FACTURA',
                    '',
                    '',
                    `"${numero.replace(/"/g, '""')}"`,
                    `"${numero.replace(/"/g, '""')}"`,
                    '',
                    `"${(r.customer_business_name || '').replace(/"/g, '""')}"`,
                    importe,
                    '',
                    ''
                ].join(',');
                lines.push(line);
            }
        }
        const csv = lines.join('\n');
        const filename = `facturacion_${new Date().toISOString().slice(0, 10)}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    }
    catch (error) {
        console.error('exportBilling:', error);
        res.status(500).json({ message: 'Error exportando facturación' });
    }
});
exports.exportBilling = exportBilling;
