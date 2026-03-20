import { Request, Response } from 'express';
import { get, execute } from '../database/db';
import { getAfipIssuerData } from '../services/afip.service';

export const getRemitente = async (_req: Request, res: Response) => {
  try {
    const row = await get(`SELECT * FROM remitente_config ORDER BY id DESC LIMIT 1`);
    if (row) {
      return res.json({
        businessName: row.business_name ?? '',
        address: row.address ?? '',
        city: row.city ?? '',
        cuit: row.cuit ?? '',
        email: row.email ?? '',
        phone: row.phone ?? '',
        logoUrl: row.logo_url ?? '',
        caiRemito: row.cai_remito ?? '',
        caiRemitoVencimiento: row.cai_remito_vencimiento ? row.cai_remito_vencimiento.toISOString().slice(0, 10) : ''
      });
    }

    const envData = getAfipIssuerData();
    if (envData) {
      return res.json({
        businessName: envData.businessName || '',
        address: envData.address || '',
        city: envData.city || '',
        cuit: envData.cuit || '',
        email: '',
        phone: '',
        logoUrl: '',
        caiRemito: '',
        caiRemitoVencimiento: ''
      });
    }

    return res.json({
      businessName: '',
      address: '',
      city: '',
      cuit: '',
      email: '',
      phone: '',
      logoUrl: '',
      caiRemito: '',
      caiRemitoVencimiento: ''
    });
  } catch (err: any) {
    console.error('getRemitente error:', err);
    return res.status(500).json({ message: 'Error obteniendo remitente' });
  }
};

export const saveRemitente = async (req: Request, res: Response) => {
  try {
    const {
      businessName,
      address,
      city,
      cuit,
      email,
      phone,
      logoUrl,
      caiRemito,
      caiRemitoVencimiento
    } = req.body;

    const existing = await get(`SELECT id FROM remitente_config ORDER BY id DESC LIMIT 1`);
    if (existing) {
      await execute(
        `UPDATE remitente_config SET business_name=?, address=?, city=?, cuit=?, email=?, phone=?, logo_url=?, cai_remito=?, cai_remito_vencimiento=? WHERE id = ?`,
        [businessName ?? null, address ?? null, city ?? null, cuit ?? null, email ?? null, phone ?? null, logoUrl ?? null, caiRemito ?? null, caiRemitoVencimiento ?? null, existing.id]
      );
    } else {
      await execute(
        `INSERT INTO remitente_config (business_name, address, city, cuit, email, phone, logo_url, cai_remito, cai_remito_vencimiento) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [businessName ?? null, address ?? null, city ?? null, cuit ?? null, email ?? null, phone ?? null, logoUrl ?? null, caiRemito ?? null, caiRemitoVencimiento ?? null]
      );
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error('saveRemitente error:', err);
    return res.status(500).json({ message: 'Error guardando remitente' });
  }
};