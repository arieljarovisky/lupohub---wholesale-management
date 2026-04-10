import * as XLSX from 'xlsx';

export type SellerImportRow = {
  name: string;
  email: string;
  password?: string;
  commissionPercentage?: number;
};

function slugEmailPart(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '')
    .slice(0, 40)
    .toLowerCase() || 'vendedor';
}

function normHeaderCell(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Hoja "Resumen" de historial_clientes_multimedias.xlsx: una fila por cliente,
 * columna "Vendedor habitual" tipo "9 - CHARLY". Devuelve un vendedor por código único.
 */
function parseFromMultimediasResumen(rows: (string | number | null | undefined)[][]): SellerImportRow[] | null {
  let headerRow = -1;
  let vendedorCol = -1;
  for (let r = 0; r < Math.min(12, rows.length); r++) {
    const h = rows[r].map((c) => normHeaderCell(String(c ?? '')));
    const codigoIdx = h.findIndex((x) => x === 'codigo');
    const vendIdx = h.findIndex((x) => x.includes('vendedor') && x.includes('habitual'));
    if (codigoIdx >= 0 && vendIdx >= 0) {
      headerRow = r;
      vendedorCol = vendIdx;
      break;
    }
  }
  if (headerRow < 0 || vendedorCol < 0) return null;

  /** código legacy numérico → nombre para mostrar */
  const byCode = new Map<string, string>();
  for (let i = headerRow + 1; i < rows.length; i++) {
    const raw = String(rows[i]?.[vendedorCol] ?? '').trim();
    if (!raw) continue;
    const m = raw.match(/^(\d+)\s*[-–—]\s*(.+)$/u);
    if (m) {
      const code = m[1].trim().replace(/^0+/, '') || m[1].trim() || '0';
      const nm = m[2].trim();
      if (!byCode.has(code)) byCode.set(code, nm);
    } else {
      const key = slugEmailPart(raw).replace(/\./g, '_') || `f${i}`;
      if (!byCode.has(key)) byCode.set(key, raw);
    }
  }
  if (byCode.size === 0) return null;

  const items: SellerImportRow[] = [];
  const usedEmails = new Set<string>();
  for (const [code, displayName] of byCode) {
    const local = /^\d+$/.test(code) ? code : slugEmailPart(code).replace(/\./g, '');
    let email = `vendedor.${local}@importado.lupohub.local`;
    let n = 0;
    while (usedEmails.has(email)) {
      n += 1;
      email = `vendedor.${local}.${n}@importado.lupohub.local`;
    }
    usedEmails.add(email);
    items.push({
      name: displayName || `Vendedor ${code}`,
      email
    });
  }
  return items;
}

/**
 * Excel de vendedores: detecta columnas por cabecera (primera hoja).
 * Si es el Resumen de Multimedias/Tango (Código, Cliente, Vendedor habitual, …), extrae vendedores únicos.
 * Si no, requiere nombre y email, o nombre + código (genera email sintético).
 */
export async function parseSellersExcel(file: File): Promise<SellerImportRow[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' }) as (string | number)[][];
  if (rows.length === 0) return [];

  const fromResumen = parseFromMultimediasResumen(rows);
  if (fromResumen && fromResumen.length > 0) return fromResumen;

  const nameKw = ['nombre', 'vendedor', 'name', 'apellido', 'usuario', 'empleado', 'representante'];
  const emailKw = ['e-mail', 'email', 'mail', 'correo', 'e mail', 'correo electrónico'];
  const pwdKw = ['contraseña', 'password', 'clave', 'pass', 'contraseña inicial'];
  const commissionKw = ['comisión', 'comision', 'commission', '% comisión', 'porcentaje', 'comision %'];
  const codeKw = ['código', 'codigo', 'legajo', 'id vendedor', 'n° vendedor', 'nro vendedor', 'cod. vendedor', 'cód'];

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(15, rows.length); r++) {
    const cells = rows[r].map((c) => String(c ?? '').trim().toLowerCase());
    const hasName = cells.some((h) => nameKw.some((k) => h.includes(k)));
    const hasEmail = cells.some((h) => emailKw.some((k) => h.includes(k)));
    const hasCode = cells.some((h) => codeKw.some((k) => h.includes(k)));
    if (hasName && (hasEmail || hasCode)) {
      headerRowIndex = r;
      break;
    }
  }

  const first = rows[headerRowIndex].map((c) => String(c ?? '').trim());
  const firstLower = first.map((h) => h.toLowerCase());

  const findCol = (keywords: string[]): number =>
    firstLower.findIndex((h) => keywords.some((k) => (h || '').includes(k)));

  const nameCol = findCol(nameKw);
  const emailCol = findCol(emailKw);
  const pwdCol = findCol(pwdKw);
  const commissionCol = findCol(commissionKw);
  const codeCol = findCol(codeKw);

  if (nameCol < 0) return [];

  const trim = (v: string | number | undefined): string =>
    v == null ? '' : typeof v === 'number' ? String(v) : String(v).trim();

  const items: SellerImportRow[] = [];
  const usedEmails = new Set<string>();
  let syntheticSeq = 0;

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const name = trim(row[nameCol]);
    if (!name) continue;

    let email = emailCol >= 0 ? trim(row[emailCol]).toLowerCase() : '';
    const codeRaw = codeCol >= 0 ? trim(row[codeCol]) : '';
    const codeDigits = codeRaw.replace(/\D/g, '');

    if (!email) {
      if (codeDigits) {
        email = `vendedor.${codeDigits}@importado.lupohub.local`;
      } else {
        syntheticSeq += 1;
        const base = slugEmailPart(name);
        let candidate = `${base}.${syntheticSeq}@importado.lupohub.local`;
        while (usedEmails.has(candidate)) {
          syntheticSeq += 1;
          candidate = `${base}.${syntheticSeq}@importado.lupohub.local`;
        }
        email = candidate;
      }
    }

    if (!email.includes('@')) continue;

    let finalEmail = email;
    let safety = 0;
    while (usedEmails.has(finalEmail) && safety < 500) {
      safety += 1;
      syntheticSeq += 1;
      finalEmail = `${slugEmailPart(name)}.${syntheticSeq}@importado.lupohub.local`;
    }
    if (usedEmails.has(finalEmail)) continue;
    email = finalEmail;

    const pwd = pwdCol >= 0 ? trim(row[pwdCol]) : '';
    let commission: number | undefined;
    if (commissionCol >= 0) {
      const c = trim(row[commissionCol]).replace(',', '.');
      const n = parseFloat(c);
      if (Number.isFinite(n) && n >= 0 && n <= 100) commission = n;
    }

    usedEmails.add(email);
    items.push({
      name,
      email: email.toLowerCase(),
      ...(pwd ? { password: pwd } : {}),
      ...(commission != null ? { commissionPercentage: commission } : {})
    });
  }

  return items;
}
