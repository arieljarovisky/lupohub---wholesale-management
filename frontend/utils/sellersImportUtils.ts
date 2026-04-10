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

/**
 * Excel de vendedores: detecta columnas por cabecera (primera hoja).
 * Requiere al menos nombre y email, o nombre + código (genera email sintético).
 * Contraseña por fila opcional; si falta, el backend usa contraseña por defecto del formulario.
 */
export async function parseSellersExcel(file: File): Promise<SellerImportRow[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' }) as (string | number)[][];
  if (rows.length === 0) return [];

  const nameKw = ['nombre', 'vendedor', 'name', 'apellido', 'usuario', 'empleado', 'representante', 'vendedor habitual'];
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
