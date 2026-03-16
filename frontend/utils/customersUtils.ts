import * as XLSX from 'xlsx';

export type CustomerImportRow = {
  name?: string;
  businessName?: string;
  email: string;
  address?: string;
  city?: string;
  cuit?: string;
  phone?: string;
  condicionIva?: string;
};

/**
 * Parsea un Excel de clientes. Detecta columnas por cabecera.
 * Usa "E-mail" o "E-mail contacto" (el que tenga valor por fila).
 * Si solo tiene email sin razón social/nombre, usa el email como razón social para no perder la fila.
 */
export async function parseCustomersExcel(file: File): Promise<CustomerImportRow[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' }) as (string | number)[][];
  if (rows.length === 0) return [];

  const first = rows[0].map(c => String(c ?? '').trim());
  const firstLower = first.map(h => h.toLowerCase());

  const findCol = (keywords: string[]): number =>
    firstLower.findIndex(h => keywords.some(k => (h || '').includes(k)));
  const findColAfter = (keywords: string[], afterIndex: number): number => {
    const idx = firstLower.findIndex((h, i) => i > afterIndex && keywords.some(k => (h || '').includes(k)));
    return idx >= 0 ? idx : -1;
  };

  const businessNameKw = ['razón social', 'razon social', 'empresa', 'cliente', 'businessname', 'business name', 'denominación', 'denominacion', 'fantasía', 'fantasia'];
  const nameKw = ['contacto habitual', 'nombre', 'name', 'contacto', 'contact', 'persona', 'titular'];
  const emailKw = ['e-mail', 'email', 'mail', 'correo', 'e mail', 'correo electrónico'];
  const emailContactoKw = ['e-mail contacto', 'email contacto', 'mail contacto', 'correo contacto', 'e-mail del contacto'];
  const addressKw = ['domicilio', 'dirección', 'direccion', 'address', 'calle', 'domicilio fiscal'];
  const cityKw = ['localidad', 'ciudad', 'city', 'provincia', 'cp', 'código postal', 'codigo postal'];
  const cuitKw = ['número', 'numero', 'cuit', 'cuil', 'cif', 'número de documento', 'numero de documento', 'documento', 'tax id', 'identificación fiscal'];
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

  if (emailCol < 0) emailCol = emailContactoCol >= 0 ? emailContactoCol : 1;
  if (businessNameCol < 0 && nameCol < 0) businessNameCol = 0;
  if (businessNameCol < 0) businessNameCol = nameCol;
  if (nameCol < 0) nameCol = businessNameCol;

  const trim = (v: string | number | undefined): string =>
    (v == null ? '' : typeof v === 'number' ? String(v) : String(v)).trim();

  const items: CustomerImportRow[] = [];
  const start = 1;

  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const emailMain = trim(row[emailCol]);
    const emailContacto = emailContactoCol >= 0 ? trim(row[emailContactoCol]) : '';
    const email = emailMain || emailContacto;
    if (!email) continue;

    const businessName = trim(row[businessNameCol]);
    const name = trim(row[nameCol]);
    const hasName = !!(businessName || name);
    const businessNameVal = businessName || (hasName ? undefined : email);
    const nameVal = name || (hasName ? undefined : '');

    items.push({
      businessName: businessNameVal || undefined,
      name: nameVal || undefined,
      email,
      address: addressCol >= 0 ? trim(row[addressCol]) || undefined : undefined,
      city: cityCol >= 0 ? trim(row[cityCol]) || undefined : undefined,
      cuit: cuitCol >= 0 ? trim(row[cuitCol]).replace(/\D/g, '').slice(0, 11) || undefined : undefined,
      phone: phoneCol >= 0 ? trim(row[phoneCol]) || undefined : undefined,
      condicionIva: ivaCol >= 0 ? trim(row[ivaCol]) || undefined : undefined
    });
  }

  return items;
}
