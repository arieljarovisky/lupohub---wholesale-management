import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';

export const getColors = async (req: Request, res: Response) => {
  try {
    // 1) Detectar si existe la tabla "colors"
    const tblCheck = await query(`
      SELECT COUNT(*) AS cnt 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() AND table_name = 'colors'
    `);
    const hasColorsTable = Number(tblCheck?.[0]?.cnt || 0) > 0;

    if (hasColorsTable) {
    
      const hexColCheck = await query(`
        SELECT COUNT(*) AS cnt 
        FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'colors' AND column_name = 'hex'
      `);
      const hasHex = Number(hexColCheck?.[0]?.cnt || 0) > 0;
      
      let rows;
      if (hasHex) {
        rows = await query(`
          SELECT id, code, name, hex
          FROM colors
          ORDER BY COALESCE(NULLIF(TRIM(name), ''), code) ASC
        `);
      } else {
        rows = await query(`
          SELECT id, code, name, NULL AS hex
          FROM colors
          ORDER BY COALESCE(NULLIF(TRIM(name), ''), code) ASC
        `);
      }
      // Devolver todos los colores (incl. códigos numéricos de Tango). No filtrar por isValidColor.
      return res.json(rows || []);
    }

    // 3) Fallback: atributos legacy (type='color')
    const attrs = await query(`
      SELECT id, name, value 
      FROM attributes 
      WHERE type = 'color'
      ORDER BY name ASC
    `);
    const mapped = attrs.map((a: any) => ({
      id: a.id,
      code: a.name,
      name: a.name,
      hex: a.value || null
    }));
    return res.json(mapped);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching colors' });
  }
};

export const createColor = async (req: Request, res: Response) => {
  try {
    const { code, name, hex } = req.body as { code?: string; name?: string; hex?: string };
    const colorCode = (code || name || '').toString().trim();
    const colorName = (name || code || '').toString().trim();
    const hexValue = (hex || '').toString().trim() || null;

    if (!colorCode) {
      return res.status(400).json({ message: 'Debe indicar al menos el código o nombre del color' });
    }

    const id = uuidv4();
    await execute(
      `INSERT INTO colors (id, code, name, hex) VALUES (?, ?, ?, ?)`,
      [id, colorCode, colorName || colorCode, hexValue]
    );
    res.status(201).json({ id, code: colorCode, name: colorName || colorCode, hex: hexValue });
  } catch (error: any) {
    console.error('Error creando color:', error);
    res.status(500).json({ message: 'Error creando color', detail: error?.message });
  }
};

export const updateColor = async (req: Request, res: Response) => {
  try {
    const colorId = (req.params as any).id;
    if (!colorId) return res.status(400).json({ message: 'Falta el id del color' });

    const { code, name, hex } = req.body as { code?: string; name?: string; hex?: string };
    const updates: string[] = [];
    const params: any[] = [];

    if (code !== undefined) {
      updates.push('code = ?');
      params.push(String(code).trim() || null);
    }
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(String(name).trim() || null);
    }
    if (hex !== undefined) {
      updates.push('hex = ?');
      params.push((hex && String(hex).trim()) || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'Indicá al menos un campo a actualizar (code, name, hex)' });
    }

    const tblCheck = await query(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'colors'
    `);
    const hasColorsTable = Number(tblCheck?.[0]?.cnt || 0) > 0;

    if (hasColorsTable) {
      const existing = await get(`SELECT id FROM colors WHERE id = ?`, [colorId]);
      if (!existing) return res.status(404).json({ message: 'Color no encontrado' });
      params.push(colorId);
      await execute(`UPDATE colors SET ${updates.join(', ')} WHERE id = ?`, params);
      const updated = await get(`SELECT id, code, name, hex FROM colors WHERE id = ?`, [colorId]) as any;
      return res.json(updated);
    }

    const existingAttr = await get(`SELECT id FROM attributes WHERE id = ? AND type = 'color'`, [colorId]);
    if (!existingAttr) return res.status(404).json({ message: 'Color no encontrado' });
    const attrUpdates: string[] = [];
    const attrParams: any[] = [];
    if (code !== undefined || name !== undefined) {
      attrUpdates.push('name = ?');
      attrParams.push(String(name ?? code ?? '').trim() || String(code ?? '').trim());
    }
    if (hex !== undefined) {
      attrUpdates.push('value = ?');
      attrParams.push((hex && String(hex).trim()) || null);
    }
    if (attrUpdates.length > 0) {
      attrParams.push(colorId);
      await execute(`UPDATE attributes SET ${attrUpdates.join(', ')} WHERE id = ? AND type = 'color'`, attrParams);
    }
    const updated = await get(`SELECT id, name, value FROM attributes WHERE id = ? AND type = 'color'`, [colorId]) as any;
    return res.json({ id: updated.id, code: updated.name, name: updated.name, hex: updated.value ?? null });
  } catch (error: any) {
    console.error('Error actualizando color:', error);
    res.status(500).json({ message: 'Error actualizando color', detail: error?.message });
  }
};
