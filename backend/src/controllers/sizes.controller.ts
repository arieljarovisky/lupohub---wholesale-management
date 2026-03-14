import { Request, Response } from 'express';
import { query, execute, get } from '../database/db';
import { nombreTalleDesdeCodigo, TALLE_CODIGO_A_NOMBRE } from '../talles-tango';
import { v4 as uuidv4 } from 'uuid';

// Mapeo letra → código canónico (numérico) para unificar talles duplicados
const LETTER_TO_CANONICAL_CODE: Record<string, string> = {};
for (const [code, letter] of Object.entries(TALLE_CODIGO_A_NOMBRE)) {
  const key = String(letter).toUpperCase();
  if (!LETTER_TO_CANONICAL_CODE[key] || code === '200') LETTER_TO_CANONICAL_CODE[key] = code;
}
// Preferir 200 sobre 240 para XXG
LETTER_TO_CANONICAL_CODE['XXG'] = '200';

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

/** Eliminar un talle por id. No permite eliminar si hay variantes que lo usan. */
export const deleteSize = async (req: Request, res: Response) => {
  try {
    const sizeId = (req.params as any).id;
    if (!sizeId) return res.status(400).json({ message: 'Falta el id del talle' });

    const tblCheck = await query(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'sizes'
    `);
    const hasSizesTable = Number(tblCheck?.[0]?.cnt || 0) > 0;

    if (hasSizesTable) {
      const existing = await get(`SELECT id FROM sizes WHERE id = ?`, [sizeId]);
      if (!existing) return res.status(404).json({ message: 'Talle no encontrado' });
      const inUse = await get(
        `SELECT 1 FROM product_variants WHERE size_id = ? LIMIT 1`,
        [sizeId]
      );
      if (inUse) {
        return res.status(409).json({
          message: 'No se puede eliminar el talle porque hay variantes de productos que lo usan.',
        });
      }
      await execute(`DELETE FROM sizes WHERE id = ?`, [sizeId]);
      return res.status(204).send();
    }

    const existingAttr = await get(`SELECT id FROM attributes WHERE id = ? AND type = 'size'`, [sizeId]);
    if (!existingAttr) return res.status(404).json({ message: 'Talle no encontrado' });
    await execute(`DELETE FROM attributes WHERE id = ? AND type = 'size'`, [sizeId]);
    return res.status(204).send();
  } catch (error: any) {
    console.error('Error eliminando talle:', error);
    res.status(500).json({ message: 'Error eliminando talle', detail: error?.message });
  }
};

/** Unifica talles por letra (G, GG, M, P, etc.) al talle canónico con código numérico (150, 160, 140, 130...). Reasigna variantes y elimina los talles duplicados. */
export const unifySizes = async (req: Request, res: Response) => {
  try {
    const tblCheck = await query(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'sizes'
    `);
    const hasSizesTable = Number(tblCheck?.[0]?.cnt || 0) > 0;
    if (!hasSizesTable) {
      return res.status(400).json({ message: 'La unificación de talles solo está disponible con la tabla sizes.' });
    }

    const allSizes = (await query(`SELECT id, size_code AS code FROM sizes`)) as { id: string; code: string }[];
    const byCode = new Map<string, string>();
    for (const s of allSizes || []) {
      const c = String(s.code || '').trim();
      if (c) byCode.set(c, s.id);
    }

    let totalUpdated = 0;
    let totalDeleted = 0;
    const mappings: { from: string; to: string; variantsUpdated: number }[] = [];
    const skipped: { code: string; reason: string }[] = [];

    for (const size of allSizes || []) {
      const code = String(size.code || '').trim();
      const canonicalCode = LETTER_TO_CANONICAL_CODE[code] || LETTER_TO_CANONICAL_CODE[code.toUpperCase()];
      if (!canonicalCode) continue;
      if (canonicalCode === code) continue;
      const canonicalId = byCode.get(canonicalCode);
      if (!canonicalId) {
        skipped.push({ code, reason: `No existe el talle canónico ${canonicalCode} en la base de datos` });
        continue;
      }
      if (canonicalId === size.id) continue;

      const countResult = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM product_variants WHERE size_id = ?`, [size.id]);
      const variantCount = Number(countResult?.[0]?.n ?? 0);
      if (variantCount > 0) {
        await execute(`UPDATE product_variants SET size_id = ? WHERE size_id = ?`, [canonicalId, size.id]);
        totalUpdated += variantCount;
        mappings.push({ from: code, to: canonicalCode, variantsUpdated: variantCount });
      }
      await execute(`DELETE FROM sizes WHERE id = ?`, [size.id]);
      totalDeleted += 1;
      byCode.delete(code);
    }

    return res.json({
      message: totalDeleted > 0 || totalUpdated > 0
        ? `Unificación completada: ${totalUpdated} variantes actualizadas, ${totalDeleted} talles duplicados eliminados.`
        : skipped.length > 0
          ? 'No se unificó ningún talle. Revisá que existan talles con código numérico (130, 140, 150, etc.).'
          : 'No había talles duplicados para unificar.',
      variantsUpdated: totalUpdated,
      sizesDeleted: totalDeleted,
      mappings,
      skipped,
    });
  } catch (error: any) {
    console.error('Error unificando talles:', error);
    res.status(500).json({ message: 'Error unificando talles', detail: error?.message });
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
