import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { v4 as uuidv4 } from 'uuid';
import { STANDARD_COLOR_CATALOG, rgbToHex } from '../data/standardColorCatalog';

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

/**
 * Inserta en `colors` los códigos del catálogo estándar que aún no existan (mismo `code`).
 * No modifica filas ya cargadas.
 */
export const importStandardColorCatalog = async (req: Request, res: Response) => {
  try {
    const tblCheck = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'colors'
    `);
    const hasColorsTable = Number(tblCheck?.[0]?.cnt || 0) > 0;
    if (!hasColorsTable) {
      return res.status(400).json({ message: 'La tabla colors no existe en esta base de datos.' });
    }

    const hexColCheck = await query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'colors' AND column_name = 'hex'
    `);
    const hasHex = Number(hexColCheck?.[0]?.cnt || 0) > 0;

    let inserted = 0;
    let skipped = 0;

    for (const row of STANDARD_COLOR_CATALOG) {
      const codeNorm = String(row.code).trim();
      const existing = await get(
        `SELECT id FROM colors WHERE TRIM(CAST(code AS CHAR)) = ? LIMIT 1`,
        [codeNorm]
      );
      if (existing) {
        skipped++;
        continue;
      }
      const id = uuidv4();
      const hex = hasHex ? rgbToHex(row.rgb[0], row.rgb[1], row.rgb[2]) : null;
      if (hasHex) {
        await execute(`INSERT INTO colors (id, name, code, hex) VALUES (?, ?, ?, ?)`, [
          id,
          row.name,
          codeNorm,
          hex
        ]);
      } else {
        await execute(`INSERT INTO colors (id, name, code) VALUES (?, ?, ?)`, [id, row.name, codeNorm]);
      }
      inserted++;
    }

    res.json({
      message: 'Catálogo procesado: se crearon solo los colores cuyo código no existía.',
      inserted,
      skipped,
      total: STANDARD_COLOR_CATALOG.length
    });
  } catch (error: any) {
    console.error('importStandardColorCatalog:', error);
    res.status(500).json({ message: 'Error importando catálogo de colores', detail: error?.message });
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
