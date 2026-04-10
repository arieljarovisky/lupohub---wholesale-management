/**
 * Importa movimientos de "Composición de saldos" (PDF Multimedias / Tango) a customer_multimedia_entries.
 *
 * Ejecutar siempre desde la carpeta backend (no desde la raíz del repo):
 *   cd backend && npm run import-multimedia-saldos -- "MULTIMEDIAS (1).pdf" --client=693 [--apply]
 *   cd backend && npx ts-node scripts/import-multimedia-composicion-saldos.ts <archivo.pdf> --client=693 [--apply]
 *
 * Por defecto es dry-run (no escribe). Con --apply borra movimientos previos del cliente e inserta los parseados.
 *
 * Resolución del cliente (en este orden):
 *   1) --customer-id=uuid si lo pasás
 *   2) Nombre del PDF vs razón social / nombre en LupoHub (coincidencia normalizada) — es el criterio principal
 *   3) legacy_code = código Tango (--client=693)
 * Con --apply, si matcheó por nombre, guarda legacy_code = código Tango del PDF para próximas veces.
 */

import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { execute, get, query } from '../src/database/db';
import { v4 as uuidv4 } from 'uuid';
import { padLegacyCode, parseArgentineDateDisplay } from '../src/utils/multimediaHistorialExcel';

function normalizeNameForMatch(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function parseAmount(s: string): number | null {
  const clean = String(s || '').trim().replace(/,/g, '');
  if (!clean) return null;
  const n = parseFloat(clean);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Líneas de movimiento del PDF composición de saldos */
function parseMovementLine(line: string): {
  fecha: string;
  tipo: string;
  numero: string;
  vto: string;
  importe: number | null;
  saldo: number | null;
  detalle: string;
} | null {
  const t = line.trim();
  if (!t || /^-+$/.test(t)) return null;

  const cuenta = /^COMPROBANTES A CUENTA.*?\s+(\d{2}\/\d{2}\/\d{4})\s+(FAC|REC|CDE|N\/D)\s+(\S+)\s+([\d.,-]+)\s*$/i.exec(
    t.replace(/\s+/g, ' ')
  );
  if (cuenta) {
    return {
      fecha: cuenta[1],
      tipo: cuenta[2].toUpperCase(),
      numero: cuenta[3],
      vto: '',
      importe: parseAmount(cuenta[4]),
      saldo: null,
      detalle: 'Comprobantes a cuenta',
    };
  }

  const withVto =
    /^(\d{2}\/\d{2}\/\d{4})\s+(FAC|REC|CDE|N\/D)\s+(\S+)\s+(\d{2}\/\d{2}\/\d{4})\s+([\d.,-]+)\s+([\d.,-]+)\s*$/i.exec(t);
  if (withVto) {
    return {
      fecha: withVto[1],
      tipo: withVto[2].toUpperCase(),
      numero: withVto[3],
      vto: withVto[4],
      importe: parseAmount(withVto[5]),
      saldo: parseAmount(withVto[6]),
      detalle: '',
    };
  }

  const noVto =
    /^(\d{2}\/\d{2}\/\d{4})\s+(FAC|REC|CDE|N\/D)\s+(\S+)\s+([\d.,-]+)\s+([\d.,-]+)\s*$/i.exec(t);
  if (noVto) {
    return {
      fecha: noVto[1],
      tipo: noVto[2].toUpperCase(),
      numero: noVto[3],
      vto: '',
      importe: parseAmount(noVto[4]),
      saldo: parseAmount(noVto[5]),
      detalle: '',
    };
  }

  return null;
}

/** Extrae texto entre "CLIENTE : <code>" y el próximo "CLIENTE :" distinto o fin útil */
function extractClientBlock(fullText: string, clientCode: string): { name: string; lines: string[]; saldoFinal: number | null } {
  const lines = fullText.split(/\r?\n/);
  const codeNorm = clientCode.replace(/^0+/, '') || clientCode;
  const headerRe = new RegExp(`^CLIENTE\\s*:\\s*(\\d+)\\s+(.+?)\\s*$`, 'i');

  const collected: string[] = [];
  let inBlock = false;
  let clientName = '';
  let saldoFinal: number | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    const hm = line.match(headerRe);
    if (hm) {
      const lineCode = hm[1].replace(/^0+/, '') || hm[1];
      if (lineCode === codeNorm) {
        inBlock = true;
        clientName = (hm[2] || '').trim();
        continue;
      }
      if (inBlock && lineCode !== codeNorm) {
        break;
      }
    }
    if (!inBlock) continue;

    if (/^SALDO DEL CLIENTE\s*:/i.test(line)) {
      const sm = line.match(/([\d.,]+)\s*$/);
      if (sm) saldoFinal = parseAmount(sm[1]);
      continue;
    }
    if (/^MULTIMEDIAS/i.test(line) || /^FECHA DE EMISION/i.test(line) || /^COMPOSICION DE SALDOS/i.test(line)) {
      continue;
    }
    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line)) continue;

    collected.push(line);
  }

  return { name: clientName, lines: collected, saldoFinal };
}

type CustomerRow = { id: string; business_name: string | null; name: string | null; legacy_code: string | null };

async function resolveCustomer(
  clientArg: string,
  legacyPadded: string,
  codeSinCeros: string,
  pdfName: string,
  customerIdArg: string | undefined
): Promise<{ row: CustomerRow; matchedBy: 'id' | 'legacy' | 'name' } | null> {
  if (customerIdArg) {
    const row = (await get(
      `SELECT id, business_name, name, legacy_code FROM customers WHERE id = ? LIMIT 1`,
      [customerIdArg]
    )) as CustomerRow | undefined;
    if (row) return { row, matchedBy: 'id' };
    return null;
  }

  const target = normalizeNameForMatch(pdfName);
  const all = (await query(`SELECT id, business_name, name, legacy_code FROM customers`)) as CustomerRow[];

  /** Criterio principal: Tango identifica por código en el PDF, pero en LupoHub el vínculo es por razón social / nombre. */
  if (target.length >= 4) {
    const exact = all.filter((c) => {
      const b = normalizeNameForMatch(c.business_name);
      const n = normalizeNameForMatch(c.name);
      return b === target || n === target;
    });
    if (exact.length === 1) return { row: exact[0], matchedBy: 'name' };
    if (exact.length > 1) {
      console.error(
        `Hay ${exact.length} clientes con el mismo nombre normalizado que el PDF («${pdfName}»). Usá --customer-id=<uuid>.`
      );
      return null;
    }

    const fuzzy = all.filter((c) => {
      const b = normalizeNameForMatch(c.business_name);
      const n = normalizeNameForMatch(c.name);
      for (const x of [b, n]) {
        if (!x || x.length < 8 || target.length < 8) continue;
        if (x.includes(target) || target.includes(x)) return true;
      }
      return false;
    });
    if (fuzzy.length === 1) return { row: fuzzy[0], matchedBy: 'name' };
    if (fuzzy.length > 1) {
      console.error(
        `Hay ${fuzzy.length} coincidencias aproximadas por nombre para «${pdfName}». Usá --customer-id=<uuid>.`
      );
      return null;
    }
  }

  const byLegacy = (await get(
    `SELECT id, business_name, name, legacy_code FROM customers WHERE legacy_code IN (?, ?, ?) LIMIT 1`,
    [clientArg, legacyPadded, codeSinCeros]
  )) as CustomerRow | undefined;
  if (byLegacy) return { row: byLegacy, matchedBy: 'legacy' };

  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const clientArg = args.find((a) => a.startsWith('--client='))?.split('=')[1]?.trim();
  const customerIdArg = args.find((a) => a.startsWith('--customer-id='))?.split('=')[1]?.trim();
  const files = args.filter((a) => !a.startsWith('--'));

  if (!clientArg || files.length === 0) {
    throw new Error(
      'Uso: npx ts-node scripts/import-multimedia-composicion-saldos.ts <reporte.pdf> --client=693 [--apply] [--customer-id=uuid]'
    );
  }

  const abs = path.resolve(files[0]);
  if (!fs.existsSync(abs)) throw new Error(`No existe el archivo: ${abs}`);

  const buf = fs.readFileSync(abs);
  const parser = new PDFParse({ data: buf });
  const parsed = await parser.getText();
  await parser.destroy();

  const text = parsed.text || '';
  const { name, lines, saldoFinal } = extractClientBlock(text, clientArg);

  type MovRow = NonNullable<ReturnType<typeof parseMovementLine>>;
  const movements: MovRow[] = [];
  for (const ln of lines) {
    if (/^COMPROBANTE ORIGEN/i.test(ln) || /^FECHA TIPO/i.test(ln) || /^CLIENTE\s*:/i.test(ln)) continue;
    const m = parseMovementLine(ln);
    if (m) movements.push(m);
  }

  const legacyPadded = padLegacyCode(clientArg);
  const codeSinCeros = clientArg.replace(/^0+/, '') || clientArg;

  const resolved = await resolveCustomer(clientArg, legacyPadded, codeSinCeros, name, customerIdArg);
  const cust = resolved?.row;

  console.log('---------------------------------------');
  console.log(`Archivo: ${path.basename(abs)}`);
  console.log(`Cliente código (Tango): ${clientArg} → legacy buscado: ${legacyPadded}`);
  console.log(`Nombre en PDF: ${name || '(no detectado)'}`);
  if (customerIdArg) console.log(`Filtro: --customer-id=${customerIdArg}`);
  console.log(`Movimientos parseados: ${movements.length}`);
  console.log(`Saldo final (línea PDF): ${saldoFinal != null ? saldoFinal : '(no leído)'}`);
  if (movements.length > 0) {
    const last = movements[movements.length - 1];
    console.log(`Último saldo en movimientos: ${last.saldo != null ? last.saldo : '(varios sin saldo en línea)'}`);
  }

  if (!cust || !resolved) {
    console.error(
      `No se encontró cliente por nombre «${name || '(sin nombre en PDF)'}» ni por legacy ${clientArg} / ${legacyPadded}. ` +
        `Revisá la razón social en LupoHub o usá --customer-id=<uuid>.`
    );
    process.exit(1);
  }
  console.log(
    `Cliente DB (${resolved.matchedBy}): ${cust.id} — ${cust.business_name || cust.name || ''} (legacy_code=${cust.legacy_code ?? 'null'})`
  );

  if (dryRun) {
    console.log('Modo DRY RUN (sin grabar). Pasá --apply para escribir en customer_multimedia_entries.');
    movements.slice(0, 15).forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.fecha} ${m.tipo} ${m.numero} vto=${m.vto || '-'} imp=${m.importe} saldo=${m.saldo} ${m.detalle || ''}`);
    });
    if (movements.length > 15) console.log(`  ... y ${movements.length - 15} más`);
    process.exit(0);
  }

  await execute(`DELETE FROM customer_multimedia_entries WHERE customer_id = ?`, [cust.id]);

  if (resolved.matchedBy === 'name') {
    const cur = String(cust.legacy_code ?? '').trim();
    if (cur !== legacyPadded) {
      await execute(`UPDATE customers SET legacy_code = ? WHERE id = ?`, [legacyPadded, cust.id]);
      console.log(`legacy_code actualizado a ${legacyPadded} (sincronizado con el PDF).`);
    }
  }

  let order = 0;
  for (const m of movements) {
    const lineDate = parseArgentineDateDisplay(m.fecha);
    if (!lineDate) continue;
    const vtoSql = m.vto ? parseArgentineDateDisplay(m.vto) : null;

    await execute(
      `INSERT INTO customer_multimedia_entries
       (id, customer_id, line_order, line_date, tipo, numero, edc, vto, importe, saldo, detalle, pagina_pdf)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        cust.id,
        order++,
        lineDate,
        m.tipo,
        m.numero,
        null,
        vtoSql,
        m.importe,
        m.saldo,
        m.detalle || null,
        null,
      ]
    );
  }

  if (saldoFinal != null && order > 0) {
    await execute(
      `UPDATE customer_multimedia_entries SET saldo = ? WHERE customer_id = ? ORDER BY line_order DESC LIMIT 1`,
      [saldoFinal, cust.id]
    );
    console.log(`Última fila: saldo actualizado con SALDO DEL CLIENTE del PDF (${saldoFinal}).`);
  }

  console.log(`OK: ${order} filas insertadas para customer_id=${cust.id}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[import-multimedia-composicion-saldos]', e?.message || e);
  process.exit(1);
});
