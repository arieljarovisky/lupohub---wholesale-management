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

/**
 * Une colores duplicados: `code` solo con dígitos y longitud ≥ 4 se trata como variante ERP del color de 3 dígitos
 * dado por los primeros 3 caracteres (ej. 2021 → 202). Mueve `product_colors` / variantes hacia el color canónico.
 */
export const mergeFourDigitColorCodes = async (req: Request, res: Response) => {
  try {
    const tblCheck = await query(`
      SELECT COUNT(*) AS cnt FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'colors'
    `);
    if (Number(tblCheck?.[0]?.cnt || 0) === 0) {
      return res.status(400).json({ message: 'La tabla colors no existe.' });
    }

    const badRows = (await query(
      `SELECT id, TRIM(CAST(code AS CHAR)) AS c FROM colors WHERE TRIM(CAST(code AS CHAR)) REGEXP '^[0-9]{4,}$' ORDER BY LENGTH(TRIM(CAST(code AS CHAR))) DESC, id ASC`
    )) as { id: string; c: string }[];

    let merged = 0;
    let renamedInPlace = 0;
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const row of badRows) {
      const badId = row.id;
      const badCode = String(row.c || '').trim();
      if (!/^\d{4,}$/.test(badCode)) continue;
      const prefix = badCode.slice(0, 3);

      const good = (await get(
        `SELECT id FROM colors WHERE TRIM(CAST(code AS CHAR)) = ? AND TRIM(CAST(code AS CHAR)) REGEXP '^[0-9]{1,3}$' AND id <> ? ORDER BY id ASC LIMIT 1`,
        [prefix, badId]
      )) as { id: string } | null;

      if (!good) {
        try {
          await execute(`UPDATE colors SET code = ? WHERE id = ?`, [prefix, badId]);
          renamedInPlace++;
        } catch (e: any) {
          errors.push(`${badCode} → ${prefix}: ${e?.message || e}`);
        }
        continue;
      }

      const goodId = good.id;
      if (goodId === badId) continue;

      try {
        const pcsBad = (await query(`SELECT id, product_id FROM product_colors WHERE color_id = ?`, [
          badId,
        ])) as { id: string; product_id: string }[];

        for (const pcb of pcsBad) {
          const pcGood = (await get(`SELECT id FROM product_colors WHERE product_id = ? AND color_id = ? LIMIT 1`, [
            pcb.product_id,
            goodId,
          ])) as { id: string } | null;

          if (!pcGood) {
            await execute(`UPDATE product_colors SET color_id = ? WHERE id = ?`, [goodId, pcb.id]);
            continue;
          }

          const vBadList = (await query(`SELECT id, size_id FROM product_variants WHERE product_color_id = ?`, [
            pcb.id,
          ])) as { id: string; size_id: string }[];

          for (const vb of vBadList) {
            const vGood = (await get(
              `SELECT id FROM product_variants WHERE product_color_id = ? AND size_id = ? LIMIT 1`,
              [pcGood.id, vb.size_id]
            )) as { id: string } | null;

            const ordBad = await get(`SELECT COUNT(*) AS n FROM order_items WHERE variant_id = ?`, [vb.id]);
            const nBad = Number((ordBad as any)?.n || 0);

            if (!vGood) {
              if (nBad > 0) {
                skipped.push(`Variante ${vb.id} (${badCode}) tiene pedidos; no se movió de product_color.`);
                continue;
              }
              await execute(`UPDATE product_variants SET product_color_id = ? WHERE id = ?`, [pcGood.id, vb.id]);
              continue;
            }

            const ordGood = await get(`SELECT COUNT(*) AS n FROM order_items WHERE variant_id = ?`, [vGood.id]);
            const nGood = Number((ordGood as any)?.n || 0);
            if (nBad > 0 || nGood > 0) {
              skipped.push(
                `Variante duplicada talle ${vb.size_id}: ambas tienen historial de pedidos; no se fusionó ${vb.id} con ${vGood.id}.`
              );
              continue;
            }

            const sb = await get(`SELECT stock FROM stocks WHERE variant_id = ?`, [vb.id]);
            const sg = await get(`SELECT stock FROM stocks WHERE variant_id = ?`, [vGood.id]);
            const sum = (Number((sb as any)?.stock) || 0) + (Number((sg as any)?.stock) || 0);
            await execute(`UPDATE stocks SET stock = ? WHERE variant_id = ?`, [sum, vGood.id]);
            await execute(`DELETE FROM stocks WHERE variant_id = ?`, [vb.id]);
            await execute(`DELETE FROM product_variants WHERE id = ?`, [vb.id]);
          }

          const left = await get(`SELECT COUNT(*) AS n FROM product_variants WHERE product_color_id = ?`, [pcb.id]);
          if (Number((left as any)?.n || 0) === 0) {
            await execute(`DELETE FROM product_colors WHERE id = ?`, [pcb.id]);
          }
        }

        const restPc = await get(`SELECT COUNT(*) AS n FROM product_colors WHERE color_id = ?`, [badId]);
        if (Number((restPc as any)?.n || 0) === 0) {
          await execute(`DELETE FROM colors WHERE id = ?`, [badId]);
          merged++;
        } else {
          errors.push(`Color ${badCode} (${badId}): quedan filas en product_colors; no se eliminó el duplicado.`);
        }
      } catch (e: any) {
        errors.push(`Color ${badCode} (${badId}): ${e?.message || e}`);
      }
    }

    res.json({
      message:
        'Fusión aplicada: colores con code de 4+ dígitos se unieron al color de 3 dígitos (primeros 3) cuando existía, o se renombró el code a 3 dígitos si no había duplicado.',
      examined: badRows.length,
      mergedIntoExisting: merged,
      renamedCodeOnly: renamedInPlace,
      skipped: skipped.slice(0, 80),
      errors: errors.slice(0, 40),
    });
  } catch (error: any) {
    console.error('mergeFourDigitColorCodes:', error);
    res.status(500).json({ message: 'Error fusionando colores', detail: error?.message });
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
