import { Request, Response } from 'express';
import { query, execute } from '../database/db';
import { nombreTalleDesdeCodigo } from '../talles-tango';
import { v4 as uuidv4 } from 'uuid';

// Talles válidos conocidos
const VALID_SIZE_PATTERNS = /^(U|P|M|G|GG|XG|XXG|XXXG|S|L|XL|XXL|XXXL|XS|ÚNICO|\d+)$/i;

const isValidSize = (code: string): boolean => {
  if (!code) return false;
  return VALID_SIZE_PATTERNS.test(code.trim());
};

export const getSizes = async (req: Request, res: Response) => {
  try {
    const tblCheck = await query(`
      SELECT COUNT(*) AS cnt 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() AND table_name = 'sizes'
    `);
    const hasSizesTable = Number(tblCheck?.[0]?.cnt || 0) > 0;

    if (hasSizesTable) {
      // Consulta directa - la tabla sizes tiene size_code y name. Mostrar nombre real (P, M, G...) para códigos Tango.
      const rows = await query(`
        SELECT id, size_code AS code, name
        FROM sizes
        ORDER BY size_code ASC
      `);
      const validRows = (rows || []).filter((r: any) => isValidSize(r.code)).map((r: any) => ({
        id: r.id,
        code: r.code,
        name: nombreTalleDesdeCodigo(r.code) || r.name || r.code,
      }));
      return res.json(validRows);
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
    })).filter((a: any) => isValidSize(a.code));
    return res.json(mapped);
  } catch (error) {
    console.error('Error fetching sizes:', error);
    res.status(500).json({ message: 'Error fetching sizes' });
  }
};

export const createSize = async (req: Request, res: Response) => {
  try {
    const { code, name } = req.body as { code?: string; name?: string };
    const rawCode = (code || '').toString().trim();
    if (!rawCode) {
      return res.status(400).json({ message: 'Debe indicar el código del talle' });
    }
    if (!isValidSize(rawCode)) {
      return res.status(400).json({ message: `Código de talle inválido: "${rawCode}"` });
    }
    const displayName = nombreTalleDesdeCodigo(rawCode) || name || rawCode;
    const id = uuidv4();
    await execute(
      `INSERT INTO sizes (id, size_code, name) VALUES (?, ?, ?)`,
      [id, rawCode, displayName]
    );
    res.status(201).json({ id, code: rawCode, name: displayName });
  } catch (error: any) {
    console.error('Error creando talle:', error);
    res.status(500).json({ message: 'Error creando talle', detail: error?.message });
  }
};

// Limpiar talles inválidos de la base de datos
export const cleanInvalidSizes = async (req: Request, res: Response) => {
  try {
    // Obtener todos los talles
    const allSizes = await query(`SELECT id, size_code FROM sizes`);
    
    const invalidIds: string[] = [];
    const validIds: string[] = [];
    
    for (const size of allSizes || []) {
      if (isValidSize(size.size_code)) {
        validIds.push(size.id);
      } else {
        invalidIds.push(size.id);
      }
    }
    
    // No eliminar si hay variantes usando esos talles
    // Solo marcar cuáles son inválidos
    res.json({
      total: allSizes?.length || 0,
      valid: validIds.length,
      invalid: invalidIds.length,
      invalidCodes: (allSizes || []).filter((s: any) => !isValidSize(s.size_code)).map((s: any) => s.size_code)
    });
  } catch (error) {
    console.error('Error cleaning sizes:', error);
    res.status(500).json({ message: 'Error cleaning sizes' });
  }
};
