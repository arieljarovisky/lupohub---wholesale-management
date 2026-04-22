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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportFacturasIibbCapital = exports.exportBilling = exports.listBilling = void 0;
const db_1 = require("../database/db");
const exceljs_1 = __importDefault(require("exceljs"));
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
/** Exporta solo facturas con cálculo de percepción IIBB CABA por cliente. */
const exportFacturasIibbCapital = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const { desde, hasta, customerId } = req.query;
        const whereParts = [];
        const params = [];
        if (desde) {
            whereParts.push('o.date >= ?');
            params.push(desde);
        }
        if (hasta) {
            whereParts.push('o.date <= ?');
            params.push(hasta);
        }
        if (customerId) {
            whereParts.push('c.id = ?');
            params.push(customerId);
        }
        const authUser = req.user;
        if ((authUser === null || authUser === void 0 ? void 0 : authUser.role) === 'SELLER') {
            whereParts.push('c.seller_id = ?');
            params.push(authUser.id);
        }
        const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
        const sql = `
      SELECT
        i.id,
        i.cbte_tipo,
        i.punto_venta,
        i.cbte_desde AS numero_desde,
        i.cbte_hasta AS numero_hasta,
        i.cae,
        i.cae_fch_vto,
        i.created_at AS invoice_created_at,
        o.id AS order_id,
        o.reference AS order_reference,
        o.date AS fecha,
        o.total AS neto_gravado,
        c.id AS customer_id,
        c.legacy_code AS customer_legacy_code,
        c.business_name AS customer_business_name,
        c.name AS customer_name,
        c.cuit AS customer_cuit,
        c.city AS customer_city,
        c.iibb_perception_rate AS iibb_perception_rate
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      JOIN customers c ON c.id = o.customer_id
      ${whereSql}
      ORDER BY o.date DESC, i.created_at DESC
    `;
        const rows = yield (0, db_1.query)(sql, params);
        const wb = new exceljs_1.default.Workbook();
        const ws = wb.addWorksheet('Hoja1');
        ws.addRow([
            'Fila',
            'Origen',
            'Tipo',
            'Nro. de comprobante',
            'Nro. interno',
            'Cliente/proveedor',
            'Razon social',
            'Tipo de documento',
            'Nro. documento',
            'Situación IB',
            'Fecha de emisión',
            'Fecha ret/per',
            'Monto del comprobante',
            'Importe otros conceptos',
            'Importe IVA',
            'Monto sujeto retención',
            'Alicuota IB',
            'Monto ret/per',
            'Tipo de aceptación',
            'Fecha de aceptación / rechazo'
        ]);
        const formatDocNumber = (raw) => {
            const digits = String(raw !== null && raw !== void 0 ? raw : '').replace(/\D/g, '');
            if (digits.length === 11)
                return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
            return String(raw !== null && raw !== void 0 ? raw : '');
        };
        const tipoDocFrom = (raw) => {
            const digits = String(raw !== null && raw !== void 0 ? raw : '').replace(/\D/g, '');
            if (digits.length === 11)
                return 'CUIT';
            if (digits.length >= 7 && digits.length <= 8)
                return 'DNI';
            return '';
        };
        const letraFromCbte = (cbteTipo) => {
            if (cbteTipo === 1)
                return 'A';
            if (cbteTipo === 6)
                return 'B';
            if (cbteTipo === 11)
                return 'C';
            return '';
        };
        const toDate = (raw) => {
            if (!raw)
                return null;
            const d = new Date(raw);
            return isNaN(d.getTime()) ? null : d;
        };
        let rowNumber = 1;
        for (const r of rows) {
            const neto = Math.round((Number(r.neto_gravado) || 0) * 100) / 100;
            const iva21 = Math.round(neto * 0.21 * 100) / 100;
            const iibbRate = Math.max(0, Number(r.iibb_perception_rate) || 0);
            const iibbAmount = Math.round(neto * (iibbRate / 100) * 100) / 100;
            const totalConIibb = Math.round((neto + iva21 + iibbAmount) * 100) / 100;
            const cbte = `${letraFromCbte(Number(r.cbte_tipo) || 0)}${String((_a = r.punto_venta) !== null && _a !== void 0 ? _a : '').padStart(4, '0')}${String((_b = r.numero_desde) !== null && _b !== void 0 ? _b : '').padStart(8, '0')}`;
            const clienteCodigo = (r.customer_legacy_code || r.customer_id || '').toString();
            const razon = (r.customer_business_name || r.customer_name || '').toString();
            const tipoDoc = tipoDocFrom(r.customer_cuit);
            const nroDoc = formatDocNumber(r.customer_cuit);
            const situacionIb = iibbRate > 0 ? 'No inscripto' : 'Inscripto';
            const fechaEmision = toDate(r.invoice_created_at) || toDate(r.fecha);
            const nroInterno = (r.order_reference || r.order_id || r.id || '').toString();
            ws.addRow([
                rowNumber,
                'Ventas',
                'FAC',
                cbte,
                nroInterno,
                clienteCodigo,
                razon,
                tipoDoc,
                nroDoc,
                situacionIb,
                fechaEmision,
                fechaEmision,
                totalConIibb,
                iibbAmount,
                iva21,
                neto,
                iibbRate,
                iibbAmount,
                ' ',
                '          '
            ]);
            rowNumber++;
        }
        ws.getRow(1).font = { bold: true };
        ws.columns = [
            { width: 8 }, { width: 12 }, { width: 8 }, { width: 22 }, { width: 18 },
            { width: 16 }, { width: 38 }, { width: 18 }, { width: 18 }, { width: 16 },
            { width: 20 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 16 },
            { width: 22 }, { width: 12 }, { width: 16 }, { width: 18 }, { width: 28 }
        ];
        for (let r = 2; r <= ws.rowCount; r++) {
            ws.getCell(r, 11).numFmt = 'dd/mm/yyyy hh:mm';
            ws.getCell(r, 12).numFmt = 'dd/mm/yyyy hh:mm';
            ws.getCell(r, 13).numFmt = '#,##0.00';
            ws.getCell(r, 14).numFmt = '#,##0.00';
            ws.getCell(r, 15).numFmt = '#,##0.00';
            ws.getCell(r, 16).numFmt = '#,##0.00';
            ws.getCell(r, 17).numFmt = '0.00';
            ws.getCell(r, 18).numFmt = '#,##0.00';
        }
        const filename = `facturas_iibb_capital_${new Date().toISOString().slice(0, 10)}.xlsx`;
        const buffer = yield wb.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.from(buffer));
    }
    catch (error) {
        console.error('exportFacturasIibbCapital:', error);
        res.status(500).json({ message: 'Error exportando facturas con IIBB CABA' });
    }
});
exports.exportFacturasIibbCapital = exportFacturasIibbCapital;
