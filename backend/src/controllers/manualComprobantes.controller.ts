import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import { execute, get, query } from '../database/db';
import { sqlInvoiceAmountFromOrderTotal } from '../config/orderPricing';

const UPLOADS_ROOT = process.env.UPLOADS_ROOT || process.cwd();
const MANUAL_PDF_DIR = path.join(UPLOADS_ROOT, 'uploads', 'manual-comprobantes');

function ensureManualPdfDir() {
  const dir = path.join(UPLOADS_ROOT, 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(MANUAL_PDF_DIR)) fs.mkdirSync(MANUAL_PDF_DIR, { recursive: true });
}

ensureManualPdfDir();

const pdfStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureManualPdfDir();
    cb(null, MANUAL_PDF_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const ALLOWED_PDF_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export const uploadManualComprobantePdfMiddleware = multer({
  storage: pdfStorage,
  limits: { fileSize: 25 * 1024 * 1024 }
}).single('pdf');

export const uploadManualComprobantePdfHandler = (req: any, res: any, next: any) => {
  uploadManualComprobantePdfMiddleware(req, res, (err: any) => {
    if (!err) return next();
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'El PDF supera el tamaño máximo (25 MB).' });
    }
    return res.status(400).json({ message: err?.message || 'Error subiendo PDF.' });
  });
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Columna importe_neto: guarda importe BRUTO del comprobante (IVA incluido). */
export const SQL_MANUAL_FAC_TOTAL = `ROUND(importe_neto + COALESCE(agip_ret_per, 0), 2)`;
export const SQL_MANUAL_NC_TOTAL = `ROUND(importe_neto, 2)`;

function importeTotalBruto(tipo: 'FACTURA' | 'NC', bruto: number, agip: number): number {
  if (tipo === 'NC') return round2(Math.max(0, bruto));
  return round2(Math.max(0, bruto) + Math.max(0, agip));
}

function parseBool(v: unknown): boolean {
  if (v === true || v === 1 || v === '1') return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'si' || s === 'sí';
}

function formatComprobanteLabel(
  cbteTipo: number,
  puntoVta: number,
  cbteDesde: number,
  sinDetalle?: boolean
): string {
  if (sinDetalle || (!puntoVta && !cbteDesde)) return 'Sin nº AFIP';
  const letra = cbteTipo === 1 || cbteTipo === 3 ? 'A' : cbteTipo === 6 || cbteTipo === 8 ? 'B' : '';
  const pv = String(Number(puntoVta) || 0).padStart(5, '0');
  const num = String(Number(cbteDesde) || 0).padStart(8, '0');
  return `${letra} ${pv}-${num}`.trim();
}

const canManage = (role?: string) =>
  role === 'ADMIN' || role === 'SELLER' || role === 'WAREHOUSE' || role === 'DEPOSITO';

function defaultCbteTipo(tipo: 'FACTURA' | 'NC', letra?: string): number {
  const L = String(letra || 'B').toUpperCase();
  if (tipo === 'FACTURA') return L === 'A' ? 1 : 6;
  return L === 'A' ? 3 : 8;
}

type CreateManualInput = {
  customerId: string;
  tipo: 'FACTURA' | 'NC';
  fecha: string;
  puntoVenta: number;
  cbteTipo: number;
  cbteDesde: number;
  cbteHasta: number;
  importeBruto: number;
  agipRetPer: number;
  cae: string | null;
  caeFchVto: string | null;
  notes: string | null;
  refInvoiceId: string | null;
  refManualComprobanteId: string | null;
  sinDetalle: boolean;
  pdfPath: string | null;
  pdfFileName: string | null;
};

async function resolveRefsAndInsert(
  user: { id?: string; role?: string },
  input: CreateManualInput
): Promise<{ id: string; refOrderId: string | null }> {
  const {
    customerId,
    tipo,
    fecha,
    puntoVenta,
    cbteTipo,
    cbteDesde,
    cbteHasta,
    importeBruto,
    agipRetPer,
    cae,
    caeFchVto,
    notes,
    refInvoiceId,
    refManualComprobanteId,
    sinDetalle,
    pdfPath,
    pdfFileName
  } = input;

  const cust = (await get('SELECT id, seller_id, business_name FROM customers WHERE id = ?', [
    customerId
  ])) as { id: string; seller_id?: string; business_name?: string } | undefined;
  if (!cust) throw Object.assign(new Error('Cliente no encontrado'), { status: 404 });
  if (user.role === 'SELLER' && cust.seller_id !== user.id) {
    throw Object.assign(new Error('Solo podés cargar comprobantes de tus clientes'), { status: 403 });
  }

  let refOrderId: string | null = null;
  if (tipo === 'NC') {
    if (refInvoiceId && refManualComprobanteId) {
      throw Object.assign(new Error('Elegí solo una factura de referencia'), { status: 400 });
    }
    if (refInvoiceId) {
      const inv = (await get(
        `SELECT i.id, i.order_id, o.customer_id
         FROM invoices i
         JOIN orders o ON o.id = i.order_id
         WHERE i.id = ?`,
        [refInvoiceId]
      )) as { id: string; order_id: string; customer_id: string } | undefined;
      if (!inv || inv.customer_id !== customerId) {
        throw Object.assign(new Error('Factura de referencia inválida para este cliente'), { status: 400 });
      }
      refOrderId = inv.order_id;
    } else if (refManualComprobanteId) {
      const man = (await get(
        `SELECT id, customer_id, ref_order_id, tipo FROM customer_manual_comprobantes WHERE id = ?`,
        [refManualComprobanteId]
      )) as { id: string; customer_id: string; ref_order_id?: string; tipo: string } | undefined;
      if (!man || man.customer_id !== customerId || man.tipo !== 'FACTURA') {
        throw Object.assign(new Error('Factura manual de referencia inválida'), { status: 400 });
      }
      refOrderId = man.ref_order_id ?? null;
    }
  }

  const id = uuidv4();
  await execute(
    `INSERT INTO customer_manual_comprobantes (
       id, customer_id, tipo, fecha, punto_venta, cbte_tipo, cbte_desde, cbte_hasta,
       cae, cae_fch_vto, importe_neto, agip_ret_per, notes, sin_detalle, pdf_path, pdf_file_name,
       ref_invoice_id, ref_manual_comprobante_id, ref_order_id, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      customerId,
      tipo,
      fecha,
      puntoVenta,
      cbteTipo,
      cbteDesde,
      cbteHasta,
      cae,
      caeFchVto,
      importeBruto,
      agipRetPer,
      notes,
      sinDetalle ? 1 : 0,
      pdfPath,
      pdfFileName,
      refInvoiceId,
      refManualComprobanteId,
      refOrderId,
      user.id ?? null
    ]
  );

  return { id, refOrderId };
}

function parseCreateBody(raw: Record<string, unknown>) {
  const customerId = String(raw.customerId || '').trim();
  const tipo = String(raw.tipo || '').trim().toUpperCase() as 'FACTURA' | 'NC';
  const fecha = String(raw.fecha || '').trim();
  const sinDetalle = parseBool(raw.sinDetalle);
  const letra = String(raw.letra || 'B').trim().toUpperCase();

  let puntoVenta = raw.puntoVenta != null && String(raw.puntoVenta).trim() !== '' ? Number(raw.puntoVenta) : NaN;
  let cbteDesde = raw.cbteDesde != null && String(raw.cbteDesde).trim() !== '' ? Number(raw.cbteDesde) : NaN;
  let cbteTipo = raw.cbteTipo != null && String(raw.cbteTipo).trim() !== '' ? Number(raw.cbteTipo) : NaN;

  if (sinDetalle) {
    if (!Number.isFinite(puntoVenta)) puntoVenta = 0;
    if (!Number.isFinite(cbteDesde)) cbteDesde = 0;
    if (!Number.isFinite(cbteTipo)) cbteTipo = defaultCbteTipo(tipo, letra);
  }

  const cbteHasta =
    raw.cbteHasta != null && String(raw.cbteHasta).trim() !== ''
      ? Number(raw.cbteHasta)
      : cbteDesde;

  const importeBruto = round2(Number(raw.importeBruto ?? raw.importeNeto));
  const agipRetPer = tipo === 'FACTURA' ? round2(Number(raw.agipRetPer || 0)) : 0;
  const cae = raw.cae != null && String(raw.cae).trim() ? String(raw.cae).trim() : null;
  const caeFchVto =
    raw.caeFchVto != null && String(raw.caeFchVto).trim() ? String(raw.caeFchVto).trim() : null;
  const notes = raw.notes != null && String(raw.notes).trim() ? String(raw.notes).trim() : null;
  const refInvoiceId = raw.refInvoiceId ? String(raw.refInvoiceId).trim() : null;
  const refManualComprobanteId = raw.refManualComprobanteId
    ? String(raw.refManualComprobanteId).trim()
    : null;

  return {
    customerId,
    tipo,
    fecha,
    sinDetalle,
    letra,
    puntoVenta,
    cbteTipo,
    cbteDesde,
    cbteHasta,
    importeBruto,
    agipRetPer,
    cae,
    caeFchVto,
    notes,
    refInvoiceId,
    refManualComprobanteId
  };
}

function validateCreateFields(parsed: ReturnType<typeof parseCreateBody>) {
  const {
    customerId,
    tipo,
    fecha,
    sinDetalle,
    puntoVenta,
    cbteTipo,
    cbteDesde,
    importeBruto
  } = parsed;

  if (!customerId) return 'Falta cliente';
  if (tipo !== 'FACTURA' && tipo !== 'NC') return 'Tipo inválido (FACTURA o NC)';
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Fecha inválida (YYYY-MM-DD)';
  if (importeBruto <= 0) return 'Importe bruto debe ser mayor a 0';

  if (!sinDetalle) {
    if (!Number.isFinite(puntoVenta) || puntoVenta < 0) return 'Punto de venta inválido';
    if (!Number.isFinite(cbteTipo) || !Number.isFinite(cbteDesde)) {
      return 'Tipo y número de comprobante inválidos';
    }
    const facTipos = [1, 6];
    const ncTipos = [3, 8];
    if (tipo === 'FACTURA' && !facTipos.includes(cbteTipo)) {
      return 'Factura: use tipo 1 (A) o 6 (B)';
    }
    if (tipo === 'NC' && !ncTipos.includes(cbteTipo)) {
      return 'NC: use tipo 3 (A) o 8 (B)';
    }
  }

  return null;
}

function saveUploadedPdf(file: Express.Multer.File): { pdfPath: string; pdfFileName: string } {
  const mime = (file.mimetype || '').toLowerCase();
  if (!ALLOWED_PDF_MIMES.includes(mime)) {
    try {
      fs.unlinkSync(file.path);
    } catch (_) {}
    throw Object.assign(new Error('Solo se permiten PDF o imágenes (JPEG, PNG, WebP).'), { status: 400 });
  }
  const relativePath = path.relative(UPLOADS_ROOT, file.path).replace(/\\/g, '/');
  return {
    pdfPath: relativePath,
    pdfFileName: file.originalname || file.filename || 'comprobante.pdf'
  };
}

/** Referencias para imputar una NC manual (facturas del sistema + manuales). */
export const listManualComprobanteRefs = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || !canManage(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    const customerId = String(req.params.customerId || '').trim();
    if (!customerId) return res.status(400).json({ message: 'Falta customerId' });

    const cust = (await get('SELECT id, seller_id FROM customers WHERE id = ?', [customerId])) as
      | { id: string; seller_id?: string }
      | undefined;
    if (!cust) return res.status(404).json({ message: 'Cliente no encontrado' });
    if (user.role === 'SELLER' && cust.seller_id !== user.id) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    const systemInvoices = (await query(
      `SELECT
         i.id AS invoiceId,
         NULL AS manualComprobanteId,
         o.id AS orderId,
         i.cbte_tipo AS cbteTipo,
         i.punto_venta AS puntoVenta,
         i.cbte_desde AS cbteDesde,
         COALESCE(DATE(i.created_at), o.date) AS fecha,
         ROUND(o.total, 2) AS importeNeto,
         ${sqlInvoiceAmountFromOrderTotal()} AS importeConIva
       FROM invoices i
       JOIN orders o ON o.id = i.order_id
       WHERE o.customer_id = ?
       ORDER BY COALESCE(i.created_at, o.date) DESC
       LIMIT 200`,
      [customerId]
    )) as any[];

    const manualInvoices = (await query(
      `SELECT
         NULL AS invoiceId,
         m.id AS manualComprobanteId,
         m.ref_order_id AS orderId,
         m.cbte_tipo AS cbteTipo,
         m.punto_venta AS puntoVenta,
         m.cbte_desde AS cbteDesde,
         m.sin_detalle AS sinDetalle,
         m.fecha AS fecha,
         m.importe_neto AS importeBruto,
         ROUND(m.importe_neto + COALESCE(m.agip_ret_per, 0), 2) AS importeTotal
       FROM customer_manual_comprobantes m
       WHERE m.customer_id = ? AND m.tipo = 'FACTURA'
       ORDER BY m.fecha DESC
       LIMIT 100`,
      [customerId]
    )) as any[];

    const refs = [...systemInvoices, ...manualInvoices].map((r) => {
      const labelNum = formatComprobanteLabel(
        r.cbteTipo,
        r.puntoVenta,
        r.cbteDesde,
        !!Number(r.sinDetalle)
      );
      return {
        invoiceId: r.invoiceId ?? undefined,
        manualComprobanteId: r.manualComprobanteId ?? undefined,
        orderId: r.orderId ?? undefined,
        label: `${labelNum} — $${Number(r.importeTotal || 0).toLocaleString('es-AR')}${r.orderId ? ` (pedido ${r.orderId})` : ' (manual)'}`,
        fecha: r.fecha,
        importeBruto: Number(r.importeBruto) || 0,
        importeTotal: Number(r.importeTotal) || 0
      };
    });

    return res.json(refs);
  } catch (e: any) {
    console.error('listManualComprobanteRefs:', e);
    return res.status(500).json({ message: 'Error listando facturas de referencia', detail: e?.message });
  }
};

async function createManualComprobanteCore(
  req: Request,
  res: Response,
  bodySource: Record<string, unknown>
) {
  const user = (req as any).user;
  if (!user || !canManage(user.role)) {
    return res.status(403).json({ message: 'No autorizado' });
  }

  const parsed = parseCreateBody(bodySource);
  const errMsg = validateCreateFields(parsed);
  if (errMsg) return res.status(400).json({ message: errMsg });

  const file = (req as any).file as Express.Multer.File | undefined;
  let pdfPath: string | null = null;
  let pdfFileName: string | null = null;
  if (file?.path) {
    try {
      const saved = saveUploadedPdf(file);
      pdfPath = saved.pdfPath;
      pdfFileName = saved.pdfFileName;
    } catch (e: any) {
      return res.status(e.status || 400).json({ message: e.message });
    }
  }

  const { tipo, importeBruto, agipRetPer, sinDetalle } = parsed;
  const cbteHasta = Number.isFinite(parsed.cbteHasta) ? parsed.cbteHasta : parsed.cbteDesde;

  try {
    const { id, refOrderId } = await resolveRefsAndInsert(user, {
      customerId: parsed.customerId,
      tipo: parsed.tipo as 'FACTURA' | 'NC',
      fecha: parsed.fecha,
      puntoVenta: parsed.puntoVenta,
      cbteTipo: parsed.cbteTipo,
      cbteDesde: parsed.cbteDesde,
      cbteHasta,
      importeBruto,
      agipRetPer,
      cae: parsed.cae,
      caeFchVto: parsed.caeFchVto,
      notes: parsed.notes,
      refInvoiceId: parsed.refInvoiceId,
      refManualComprobanteId: parsed.refManualComprobanteId,
      sinDetalle: parsed.sinDetalle,
      pdfPath,
      pdfFileName
    });

    const total = importeTotalBruto(tipo as 'FACTURA' | 'NC', importeBruto, agipRetPer);
    return res.status(201).json({
      id,
      customerId: parsed.customerId,
      tipo,
      fecha: parsed.fecha,
      puntoVenta: parsed.puntoVenta,
      cbteTipo: parsed.cbteTipo,
      cbteDesde: parsed.cbteDesde,
      cbteHasta,
      cae: parsed.cae ?? undefined,
      importeBruto,
      agipRetPer,
      importeTotal: total,
      importeConIva: total,
      notes: parsed.notes ?? undefined,
      refInvoiceId: parsed.refInvoiceId ?? undefined,
      refManualComprobanteId: parsed.refManualComprobanteId ?? undefined,
      refOrderId: refOrderId ?? undefined,
      sinDetalle: parsed.sinDetalle,
      hasPdf: !!pdfPath,
      pdfFileName: pdfFileName ?? undefined,
      comprobante: formatComprobanteLabel(
        parsed.cbteTipo,
        parsed.puntoVenta,
        parsed.cbteDesde,
        parsed.sinDetalle
      )
    });
  } catch (e: any) {
    if (pdfPath) {
      try {
        fs.unlinkSync(path.join(UPLOADS_ROOT, pdfPath));
      } catch (_) {}
    }
    const status = e.status || 500;
    if (status !== 500) {
      return res.status(status).json({ message: e.message });
    }
    console.error('createManualComprobante:', e);
    return res.status(500).json({ message: 'Error guardando comprobante manual', detail: e?.message });
  }
}

/** Alta manual (JSON). */
export const createManualComprobante = async (req: Request, res: Response) => {
  return createManualComprobanteCore(req, res, (req.body || {}) as Record<string, unknown>);
};

/** Alta manual con PDF opcional (multipart: campos + archivo "pdf"). */
export const createManualComprobanteMultipart = async (req: Request, res: Response) => {
  return createManualComprobanteCore(req, res, (req.body || {}) as Record<string, unknown>);
};

/** Ver/descargar PDF de un comprobante manual. */
export const getManualComprobantePdf = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || !canManage(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Falta id' });

    const row = (await get(
      `SELECT m.id, m.pdf_path, m.pdf_file_name, m.customer_id, c.seller_id
       FROM customer_manual_comprobantes m
       JOIN customers c ON c.id = m.customer_id
       WHERE m.id = ?`,
      [id]
    )) as { id: string; pdf_path?: string; pdf_file_name?: string; customer_id: string; seller_id?: string } | undefined;

    if (!row) return res.status(404).json({ message: 'Comprobante no encontrado' });
    if (user.role === 'SELLER' && row.seller_id !== user.id) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    const filePath = (row.pdf_path || '').trim();
    if (!filePath) return res.status(404).json({ message: 'Este comprobante no tiene PDF adjunto' });

    const fullPath = path.join(UPLOADS_ROOT, filePath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        message: 'El archivo no está disponible en el servidor.',
        code: 'FILE_NOT_FOUND'
      });
    }

    const ext = path.extname(row.pdf_file_name || filePath).toLowerCase();
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : 'application/pdf';

    res.setHeader('Content-Type', mime);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(row.pdf_file_name || 'comprobante.pdf')}"`
    );
    fs.createReadStream(fullPath).pipe(res);
  } catch (e: any) {
    console.error('getManualComprobantePdf:', e);
    return res.status(500).json({ message: 'Error obteniendo PDF', detail: e?.message });
  }
};

/** Subconsultas reutilizables para saldos y listados (importe bruto en importe_neto). */
export const SQL_MANUAL_FAC_IVA_SUM = `(
  SELECT customer_id, SUM(${SQL_MANUAL_FAC_TOTAL}) AS total
  FROM customer_manual_comprobantes
  WHERE tipo = 'FACTURA'
  GROUP BY customer_id
)`;

export const SQL_MANUAL_NC_IVA_SUM = `(
  SELECT customer_id, SUM(${SQL_MANUAL_NC_TOTAL}) AS total
  FROM customer_manual_comprobantes
  WHERE tipo = 'NC'
  GROUP BY customer_id
)`;

function rowToManualResponse(row: any) {
  const tipo = String(row.tipo || '') as 'FACTURA' | 'NC';
  const bruto = Number(row.importe_neto) || 0;
  const agip = Number(row.agip_ret_per) || 0;
  const sinDetalle = !!Number(row.sin_detalle);
  const cbteTipo = Number(row.cbte_tipo) || 0;
  const pv = Number(row.punto_venta) || 0;
  const cbteDesde = Number(row.cbte_desde) || 0;
  const letra =
    tipo === 'FACTURA' ? (cbteTipo === 1 ? 'A' : 'B') : cbteTipo === 3 ? 'A' : 'B';
  return {
    id: row.id,
    customerId: row.customer_id,
    tipo,
    fecha: row.fecha,
    puntoVenta: pv,
    cbteTipo,
    cbteDesde,
    cbteHasta: Number(row.cbte_hasta) || cbteDesde,
    cae: row.cae ?? undefined,
    caeFchVto: row.cae_fch_vto ?? undefined,
    importeBruto: bruto,
    agipRetPer: agip,
    importeTotal: importeTotalBruto(tipo, bruto, agip),
    notes: row.notes ?? undefined,
    refInvoiceId: row.ref_invoice_id ?? undefined,
    refManualComprobanteId: row.ref_manual_comprobante_id ?? undefined,
    refOrderId: row.ref_order_id ?? undefined,
    sinDetalle,
    hasPdf: !!(row.pdf_path && String(row.pdf_path).trim()),
    pdfFileName: row.pdf_file_name ?? undefined,
    letra,
    comprobante: formatComprobanteLabel(cbteTipo, pv, cbteDesde, sinDetalle)
  };
}

async function resolveNcRefs(
  customerId: string,
  tipo: string,
  refInvoiceId: string | null,
  refManualComprobanteId: string | null,
  excludeManualId?: string
): Promise<string | null> {
  if (tipo !== 'NC') return null;
  if (refInvoiceId && refManualComprobanteId) {
    throw Object.assign(new Error('Elegí solo una factura de referencia'), { status: 400 });
  }
  if (refInvoiceId) {
    const inv = (await get(
      `SELECT i.id, i.order_id, o.customer_id
       FROM invoices i
       JOIN orders o ON o.id = i.order_id
       WHERE i.id = ?`,
      [refInvoiceId]
    )) as { id: string; order_id: string; customer_id: string } | undefined;
    if (!inv || inv.customer_id !== customerId) {
      throw Object.assign(new Error('Factura de referencia inválida para este cliente'), { status: 400 });
    }
    return inv.order_id;
  }
  if (refManualComprobanteId) {
    if (excludeManualId && refManualComprobanteId === excludeManualId) {
      throw Object.assign(new Error('La NC no puede referenciar a sí misma'), { status: 400 });
    }
    const man = (await get(
      `SELECT id, customer_id, ref_order_id, tipo FROM customer_manual_comprobantes WHERE id = ?`,
      [refManualComprobanteId]
    )) as { id: string; customer_id: string; ref_order_id?: string; tipo: string } | undefined;
    if (!man || man.customer_id !== customerId || man.tipo !== 'FACTURA') {
      throw Object.assign(new Error('Factura manual de referencia inválida'), { status: 400 });
    }
    return man.ref_order_id ?? null;
  }
  return null;
}

/** GET un comprobante manual (para edición). */
export const getManualComprobante = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || !canManage(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    const id = String(req.params.id || '').trim();
    const row = (await get(
      `SELECT m.*, c.seller_id
       FROM customer_manual_comprobantes m
       JOIN customers c ON c.id = m.customer_id
       WHERE m.id = ?`,
      [id]
    )) as any;
    if (!row) return res.status(404).json({ message: 'Comprobante no encontrado' });
    if (user.role === 'SELLER' && row.seller_id !== user.id) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    return res.json(rowToManualResponse(row));
  } catch (e: any) {
    console.error('getManualComprobante:', e);
    return res.status(500).json({ message: 'Error obteniendo comprobante', detail: e?.message });
  }
};

async function updateManualComprobanteCore(
  req: Request,
  res: Response,
  id: string,
  bodySource: Record<string, unknown>
) {
  const user = (req as any).user;
  if (!user || !canManage(user.role)) {
    return res.status(403).json({ message: 'No autorizado' });
  }

  const existing = (await get(
    `SELECT m.*, c.seller_id
     FROM customer_manual_comprobantes m
     JOIN customers c ON c.id = m.customer_id
     WHERE m.id = ?`,
    [id]
  )) as any;
  if (!existing) return res.status(404).json({ message: 'Comprobante no encontrado' });
  if (user.role === 'SELLER' && existing.seller_id !== user.id) {
    return res.status(403).json({ message: 'No autorizado' });
  }

  const parsed = parseCreateBody(bodySource);
  const errMsg = validateCreateFields(parsed);
  if (errMsg) return res.status(400).json({ message: errMsg });

  const cust = (await get('SELECT id, seller_id FROM customers WHERE id = ?', [parsed.customerId])) as
    | { id: string; seller_id?: string }
    | undefined;
  if (!cust) return res.status(404).json({ message: 'Cliente no encontrado' });
  if (user.role === 'SELLER' && cust.seller_id !== user.id) {
    return res.status(403).json({ message: 'Solo podés editar comprobantes de tus clientes' });
  }

  const file = (req as any).file as Express.Multer.File | undefined;
  let pdfPath: string | null = existing.pdf_path ?? null;
  let pdfFileName: string | null = existing.pdf_file_name ?? null;
  const oldPdfPath = existing.pdf_path ?? null;

  if (file?.path) {
    try {
      const saved = saveUploadedPdf(file);
      pdfPath = saved.pdfPath;
      pdfFileName = saved.pdfFileName;
      if (oldPdfPath && oldPdfPath !== pdfPath) {
        try {
          const full = path.join(UPLOADS_ROOT, oldPdfPath);
          if (fs.existsSync(full)) fs.unlinkSync(full);
        } catch (_) {}
      }
    } catch (e: any) {
      return res.status(e.status || 400).json({ message: e.message });
    }
  }

  const cbteHasta = Number.isFinite(parsed.cbteHasta) ? parsed.cbteHasta : parsed.cbteDesde;
  let refOrderId: string | null = null;
  try {
    refOrderId = await resolveNcRefs(
      parsed.customerId,
      parsed.tipo,
      parsed.refInvoiceId,
      parsed.refManualComprobanteId,
      id
    );
  } catch (e: any) {
    return res.status(e.status || 400).json({ message: e.message });
  }

  await execute(
    `UPDATE customer_manual_comprobantes SET
       customer_id = ?, tipo = ?, fecha = ?, punto_venta = ?, cbte_tipo = ?, cbte_desde = ?, cbte_hasta = ?,
       cae = ?, cae_fch_vto = ?, importe_neto = ?, agip_ret_per = ?, notes = ?, sin_detalle = ?,
       pdf_path = ?, pdf_file_name = ?,
       ref_invoice_id = ?, ref_manual_comprobante_id = ?, ref_order_id = ?
     WHERE id = ?`,
    [
      parsed.customerId,
      parsed.tipo,
      parsed.fecha,
      parsed.puntoVenta,
      parsed.cbteTipo,
      parsed.cbteDesde,
      cbteHasta,
      parsed.cae,
      parsed.caeFchVto,
      parsed.importeBruto,
      parsed.agipRetPer,
      parsed.notes,
      parsed.sinDetalle ? 1 : 0,
      pdfPath,
      pdfFileName,
      parsed.refInvoiceId,
      parsed.refManualComprobanteId,
      refOrderId,
      id
    ]
  );

  const updated = (await get(`SELECT * FROM customer_manual_comprobantes WHERE id = ?`, [id])) as any;
  return res.json(rowToManualResponse(updated));
}

/** PATCH comprobante manual (JSON). */
export const updateManualComprobante = async (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ message: 'Falta id' });
  try {
    return await updateManualComprobanteCore(req, res, id, (req.body || {}) as Record<string, unknown>);
  } catch (e: any) {
    console.error('updateManualComprobante:', e);
    return res.status(500).json({ message: 'Error actualizando comprobante', detail: e?.message });
  }
};

/** PATCH con PDF opcional. */
export const updateManualComprobanteMultipart = async (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ message: 'Falta id' });
  try {
    return await updateManualComprobanteCore(req, res, id, (req.body || {}) as Record<string, unknown>);
  } catch (e: any) {
    console.error('updateManualComprobanteMultipart:', e);
    return res.status(500).json({ message: 'Error actualizando comprobante', detail: e?.message });
  }
};

/** DELETE comprobante manual (p. ej. NC cargada por error). */
export const deleteManualComprobante = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || !canManage(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ message: 'Falta id' });

    const existing = (await get(
      `SELECT m.id, m.tipo, m.pdf_path, c.seller_id
       FROM customer_manual_comprobantes m
       JOIN customers c ON c.id = m.customer_id
       WHERE m.id = ?`,
      [id]
    )) as { id: string; tipo: string; pdf_path?: string | null; seller_id?: string } | undefined;
    if (!existing) return res.status(404).json({ message: 'Comprobante no encontrado' });
    if (user.role === 'SELLER' && existing.seller_id !== user.id) {
      return res.status(403).json({ message: 'No autorizado' });
    }

    const ncRefs = (await get(
      `SELECT id FROM customer_manual_comprobantes WHERE ref_manual_comprobante_id = ? LIMIT 1`,
      [id]
    )) as { id: string } | undefined;
    if (ncRefs) {
      return res.status(400).json({
        message: 'No se puede eliminar: hay una nota de crédito manual que referencia este comprobante.',
      });
    }

    await execute(`DELETE FROM customer_manual_comprobantes WHERE id = ?`, [id]);

    if (existing.pdf_path) {
      try {
        const full = path.join(UPLOADS_ROOT, existing.pdf_path);
        if (fs.existsSync(full)) fs.unlinkSync(full);
      } catch (_) {}
    }

    return res.json({ ok: true, id, tipo: existing.tipo });
  } catch (e: any) {
    console.error('deleteManualComprobante:', e);
    return res.status(500).json({ message: 'Error eliminando comprobante', detail: e?.message });
  }
};
