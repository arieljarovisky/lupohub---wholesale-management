import * as XLSX from 'xlsx';

export type CustomerImportRow = {
  name?: string;
  businessName?: string;
  email?: string;
  address?: string;
  city?: string;
  cuit?: string;
  phone?: string;
  condicionIva?: string;
};

/**
 * Parsea un Excel de clientes. Detecta columnas por cabecera.
 * Se exige razón social y CUIT por fila; el resto de campos pueden ir vacíos.
 * Email es opcional (si falta, el backend genera uno a partir del CUIT).
 */
export async function parseCustomersExcel(file: File): Promise<CustomerImportRow[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' }) as (string | number)[][];
  if (rows.length === 0) return [];

  const businessNameKw = ['razón social', 'razon social', 'empresa', 'cliente', 'businessname', 'business name', 'denominación', 'denominacion', 'fantasía', 'fantasia'];
  const cuitKw = ['número', 'numero', 'cuit', 'cuil', 'cif', 'número de documento', 'numero de documento', 'documento', 'tax id', 'identificación fiscal'];

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const rowCells = rows[r].map(c => String(c ?? '').trim().toLowerCase());
    const hasRazonSocial = rowCells.some(c => businessNameKw.some(k => c.includes(k)));
    const hasCuit = rowCells.some(c => cuitKw.some(k => c.includes(k)));
    if (hasRazonSocial && hasCuit) {
      headerRowIndex = r;
      break;
    }
  }

  const first = rows[headerRowIndex].map(c => String(c ?? '').trim());
  const firstLower = first.map(h => h.toLowerCase());

  const findCol = (keywords: string[]): number =>
    firstLower.findIndex(h => keywords.some(k => (h || '').includes(k)));
  const findColAfter = (keywords: string[], afterIndex: number): number => {
    const idx = firstLower.findIndex((h, i) => i > afterIndex && keywords.some(k => (h || '').includes(k)));
    return idx >= 0 ? idx : -1;
  };

  const nameKw = ['contacto habitual', 'nombre', 'name', 'contacto', 'contact', 'persona', 'titular'];
  const emailKw = ['e-mail', 'email', 'mail', 'correo', 'e mail', 'correo electrónico'];
  const emailContactoKw = ['e-mail contacto', 'email contacto', 'mail contacto', 'correo contacto', 'e-mail del contacto'];
  const addressKw = ['domicilio', 'dirección', 'direccion', 'address', 'calle', 'domicilio fiscal'];
  const cityKw = ['localidad', 'ciudad', 'city', 'provincia', 'cp', 'código postal', 'codigo postal'];
  const phoneKw = ['teléfono', 'telefono', 'phone', 'tel', 'celular', 'móvil', 'movil', 'whatsapp'];
  const ivaKw = ['condición de iva', 'condicion de iva', 'condición iva', 'condicion iva', 'iva', 'cond. iva', 'condicion de iv a', 'responsable inscripto', 'monotributo', 'consumidor final'];

  let businessNameCol = findCol(businessNameKw);
  let nameCol = findCol(nameKw);
  let emailCol = findCol(emailKw);
  const emailContactoCol = emailCol >= 0 ? findColAfter(emailContactoKw, emailCol) : findCol(emailContactoKw);
  const addressCol = findCol(addressKw);
  const cityCol = findCol(cityKw);
  const cuitCol = findCol(cuitKw);
  const phoneCol = findCol(phoneKw);
  const ivaCol = findCol(ivaKw);

  if (cuitCol < 0 || businessNameCol < 0) return [];

  if (emailCol < 0) emailCol = emailContactoCol >= 0 ? emailContactoCol : 1;
  if (businessNameCol < 0 && nameCol < 0) businessNameCol = 0;
  if (businessNameCol < 0) businessNameCol = nameCol;
  if (nameCol < 0) nameCol = businessNameCol;

  const trim = (v: string | number | undefined): string =>
    (v == null ? '' : typeof v === 'number' ? String(v) : String(v)).trim();

  const items: CustomerImportRow[] = [];
  const start = headerRowIndex + 1;

  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const businessName = trim(row[businessNameCol]);
    const name = trim(row[nameCol]);
    const cuitRaw = cuitCol >= 0 ? trim(row[cuitCol]) : '';
    const cuit = cuitRaw.replace(/\D/g, '').slice(0, 11) || undefined;
    if (!businessName && !name) continue;
    if (!cuit) continue;

    const emailMain = trim(row[emailCol]);
    const emailContacto = emailContactoCol >= 0 ? trim(row[emailContactoCol]) : '';
    const email = emailMain || emailContacto || undefined;

    items.push({
      businessName: businessName || undefined,
      name: name || undefined,
      email,
      address: addressCol >= 0 ? trim(row[addressCol]) || undefined : undefined,
      city: cityCol >= 0 ? trim(row[cityCol]) || undefined : undefined,
      cuit,
      phone: phoneCol >= 0 ? trim(row[phoneCol]) || undefined : undefined,
      condicionIva: ivaCol >= 0 ? trim(row[ivaCol]) || undefined : undefined
    });
  }

  return items;
}
