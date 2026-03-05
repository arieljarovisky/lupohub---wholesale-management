import { Request, Response } from 'express';
import { query } from '../database/db';

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
      // 2) Detectar si existe la columna 'hex'
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
