import { Request, Response } from 'express';
import { query } from '../database/db';

// Patrones que son talles, NO colores
const SIZE_PATTERNS = /^(U|P|M|G|GG|XG|XXG|XXXG|S|L|XL|XXL|XXXL|XS|ÚNICO|\d+)$/i;

const isValidColor = (name: string): boolean => {
  if (!name) return false;
  const trimmed = name.trim();
  // Si parece un talle, NO es un color válido
  if (SIZE_PATTERNS.test(trimmed)) return false;
  return true;
};

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
          ORDER BY name ASC
        `);
      } else {
        rows = await query(`
          SELECT id, code, name, NULL AS hex
          FROM colors
          ORDER BY name ASC
        `);
      }
      
      // Filtrar solo colores válidos (excluir talles)
      const validRows = (rows || []).filter((r: any) => isValidColor(r.name));
      return res.json(validRows);
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
    })).filter((a: any) => isValidColor(a.name));
    return res.json(mapped);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching colors' });
  }
};
