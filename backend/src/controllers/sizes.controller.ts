import { Request, Response } from 'express';
import { query } from '../database/db';

export const getSizes = async (req: Request, res: Response) => {
  try {
    const tblCheck = await query(`
      SELECT COUNT(*) AS cnt 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() AND table_name = 'sizes'
    `);
    const hasSizesTable = Number(tblCheck?.[0]?.cnt || 0) > 0;

    if (hasSizesTable) {
      // Detectar columnas disponibles
      const cols = await query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'sizes'
      `);
      const names = (cols || []).map((c: any) => String(c.column_name).toLowerCase());
      const hasSizeCode = names.includes('size_code');
      const hasCode = names.includes('code');
      const hasName = names.includes('name');

      const codeExpr = hasSizeCode ? 'size_code' : hasCode ? 'code' : hasName ? 'name' : 'NULL';
      const nameExpr = hasName ? 'name' : hasSizeCode ? 'size_code' : hasCode ? 'code' : 'NULL';
      const orderExpr = hasName ? 'name' : hasSizeCode ? 'size_code' : hasCode ? 'code' : 'id';

      const rows = await query(`
        SELECT id, ${codeExpr} AS code, ${nameExpr} AS name
        FROM sizes
        ORDER BY ${orderExpr} ASC
      `);
      return res.json(rows);
    }

    // Fallback: atributos legacy (type='size')
    const attrs = await query(`
      SELECT id, name 
      FROM attributes 
      WHERE type = 'size'
      ORDER BY name ASC
    `);
    const mapped = attrs.map((a: any) => ({
      id: a.id,
      code: a.name,
      name: a.name
    }));
    return res.json(mapped);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error fetching sizes' });
  }
};
