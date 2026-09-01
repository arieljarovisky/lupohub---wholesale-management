import { Router, Request, Response } from 'express';
import { isAfipConfigured, getAfipIssuerData, isAfipProduction, getCondicionIvaByCuit, consultarComprobanteAfip, getWsfexParametros, getAfipExportPuntoVenta, getWsfexExportDiagnostico } from '../services/afip.service';
import { getRemitente, saveRemitente } from '../controllers/remitente.controller';
import { optionalAuthMiddleware, authMiddleware } from '../middleware/auth';

const router = Router();
router.use(optionalAuthMiddleware);

/** Indica si AFIP está configurado y si es ambiente producción (para que las facturas lleguen a AFIP real). */
router.get('/status', (_req, res) => {
  res.json({
    configured: isAfipConfigured(),
    production: isAfipProduction()
  });
});

/** Datos del emisor para la factura (CUIT, razón social, domicilio desde env). Usar en la vista de factura si no hay remitente en localStorage. */
router.get('/issuer', (_req, res) => {
  const data = getAfipIssuerData();
  if (!data) return res.json({ cuit: '', businessName: '', address: '', city: '' });
  res.json({
    cuit: data.cuit,
    businessName: data.businessName ?? '',
    address: data.address ?? '',
    city: data.city ?? ''
  });
});

router.get('/remitente', authMiddleware, getRemitente);
router.put('/remitente', authMiddleware, saveRemitente);

/** Condición IVA (y opcional razón social, domicilio) de un CUIT vía Padrón AFIP. Requiere login. */
router.get('/condicion-iva', authMiddleware, async (req: Request, res: Response) => {
  const cuit = (req.query.cuit as string)?.trim();
  if (!cuit) {
    return res.status(400).json({ error: 'Falta el parámetro cuit.' });
  }
  if (!isAfipConfigured()) {
    return res.status(400).json({ error: 'AFIP no está configurado. La condición IVA se puede cargar manualmente en el campo correspondiente.' });
  }
  try {
    const result = await getCondicionIvaByCuit(cuit);
    return res.json(result);
  } catch (err: any) {
    const message = err?.message || String(err) || 'Error al consultar AFIP.';
    if (!res.headersSent) return res.status(400).json({ error: message });
  }
});

/** Consulta en AFIP si un comprobante existe (FECompConsultar). Confirmación 100% de que AFIP lo tiene. */
router.get('/consultar-comprobante', authMiddleware, (req: Request, res: Response) => {
  const ptoVta = parseInt(req.query.puntoVta as string, 10);
  const cbteTipo = parseInt(req.query.cbteTipo as string, 10);
  const cbteNro = parseInt(req.query.cbteNro as string, 10);
  if (isNaN(ptoVta) || isNaN(cbteTipo) || isNaN(cbteNro)) {
    return res.status(400).json({
      error: 'Faltan o son inválidos: puntoVta, cbteTipo, cbteNro (números). Ej: ?puntoVta=20&cbteTipo=6&cbteNro=1'
    });
  }
  consultarComprobanteAfip(ptoVta, cbteTipo, cbteNro)
    .then((r) => res.json(r))
    .catch((err: any) => {
      const message = err?.message || String(err) || 'Error al consultar comprobante.';
      if (!res.headersSent) res.status(400).json({ error: message });
    });
});

/** Diagnóstico WSFEX: PV exportación, listado FEEWS y último comprobante E. */
router.get('/exportacion/diagnostico', authMiddleware, async (_req: Request, res: Response) => {
  if (!isAfipConfigured()) {
    return res.status(400).json({ error: 'AFIP no está configurado.' });
  }
  try {
    const data = await getWsfexExportDiagnostico();
    return res.json(data);
  } catch (err: any) {
    const message = err?.message || String(err) || 'Error en diagnóstico WSFEX.';
    if (!res.headersSent) return res.status(400).json({ error: message });
  }
});

/** Catálogos WSFEX para Factura E: paises | monedas | incoterms | puntos_venta | … */
router.get('/exportacion/:tipo', authMiddleware, async (req: Request, res: Response) => {
  const tipo = (req.params.tipo || '').toLowerCase() as
    | 'paises'
    | 'monedas'
    | 'incoterms'
    | 'umed'
    | 'tipo_expo'
    | 'puntos_venta';
  if (!['paises', 'monedas', 'incoterms', 'umed', 'tipo_expo', 'puntos_venta'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo debe ser paises, monedas, incoterms, umed, tipo_expo o puntos_venta' });
  }
  if (!isAfipConfigured()) {
    return res.status(400).json({ error: 'AFIP no está configurado.' });
  }
  try {
    const data = await getWsfexParametros(tipo);
    return res.json({ tipo, data, puntoVentaExport: getAfipExportPuntoVenta() });
  } catch (err: any) {
    const message = err?.message || String(err) || 'Error consultando parámetros WSFEX.';
    if (!res.headersSent) return res.status(400).json({ error: message });
  }
});

export default router;
