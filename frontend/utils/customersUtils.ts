import * as XLSX from 'xlsx';
import { canonicalizeCityInput } from './cityNormalize';

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
      city: cityCol >= 0 ? (() => {
        const raw = trim(row[cityCol]);
        return raw ? canonicalizeCityInput(raw) : undefined;
      })() : undefined,
      cuit,
      phone: phoneCol >= 0 ? trim(row[phoneCol]) || undefined : undefined,
      condicionIva: ivaCol >= 0 ? trim(row[ivaCol]) || undefined : undefined
    });
  }

  return items;
}

/** Fila para actualizar solo CUIT de clientes existentes (identificados por razón social o email). */
export type CustomerCuitUpdateRow = {
  businessName?: string;
  email?: string;
  cuit: string;
};

/**
 * Parsea un Excel para actualizar CUIT en lote.
 * Cada fila debe tener: (Razón social O Email) + columna CUIT/Número.
 * Las filas sin CUIT se ignoran. Solo se incluyen filas con CUIT y al menos un identificador.
 */
export async function parseCustomersCuitUpdateExcel(file: File): Promise<CustomerCuitUpdateRow[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' }) as (string | number)[][];
  if (rows.length === 0) return [];

  const businessNameKw = ['razón social', 'razon social', 'empresa', 'cliente', 'businessname', 'business name', 'denominación', 'denominacion', 'fantasía', 'fantasia'];
  const cuitKw = ['número', 'numero', 'cuit', 'cuil', 'cif', 'número de documento', 'numero de documento', 'documento', 'tax id', 'identificación fiscal'];
  const emailKw = ['e-mail', 'email', 'mail', 'correo', 'e mail', 'correo electrónico'];

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const rowCells = rows[r].map(c => String(c ?? '').trim().toLowerCase());
    const hasCuit = rowCells.some(c => cuitKw.some(k => c.includes(k)));
    const hasId = rowCells.some(c => businessNameKw.some(k => c.includes(k))) || rowCells.some(c => emailKw.some(k => c.includes(k)));
    if (hasCuit && hasId) {
      headerRowIndex = r;
      break;
    }
  }

  const first = rows[headerRowIndex].map(c => String(c ?? '').trim());
  const firstLower = first.map(h => h.toLowerCase());
  const findCol = (keywords: string[]): number => firstLower.findIndex(h => keywords.some(k => (h || '').includes(k)));

  const businessNameCol = findCol(businessNameKw);
  const emailCol = findCol(emailKw);
  const cuitCol = findCol(cuitKw);
  if (cuitCol < 0) return [];

  const trim = (v: string | number | undefined): string => (v == null ? '' : typeof v === 'number' ? String(v) : String(v)).trim();
  const items: CustomerCuitUpdateRow[] = [];
  const start = headerRowIndex + 1;

  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const businessName = businessNameCol >= 0 ? trim(row[businessNameCol]) : '';
    const email = emailCol >= 0 ? trim(row[emailCol]) : '';
    const cuitRaw = trim(row[cuitCol]);
    const cuit = cuitRaw.replace(/\D/g, '').slice(0, 11);
    if (!cuit) continue;
    if (!businessName && !email) continue;
    items.push({
      businessName: businessName || undefined,
      email: email || undefined,
      cuit
    });
  }
  return items;
}

/** Fila para actualización masiva: condición IVA, lista de precios y saldo inicial. */
export type CustomerBulkUpdateRow = {
  businessName?: string;
  email?: string;
  cuit?: string;
  legacyCode?: string;
  condicionIva?: string;
  priceList?: string;
  openingBalance?: number | string | null;
  openingBalanceDate?: string | null;
};

function parseExcelNumber(v: string | number | undefined): number | string | null | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return undefined;
  return s;
}

function parseExcelDate(v: string | number | undefined): string | null | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + v * 86400000);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return undefined;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return s;
}

/**
 * Parsea Excel para actualización masiva de clientes existentes.
 * Identificador: CUIT, código legacy, email o razón social (al menos uno por fila).
 * Solo se envían campos con valor en el Excel (celdas vacías = no modificar).
 */
export async function parseCustomersBulkUpdateExcel(file: File): Promise<CustomerBulkUpdateRow[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' }) as (string | number)[][];
  if (rows.length === 0) return [];

  const businessNameKw = ['razón social', 'razon social', 'empresa', 'cliente', 'businessname', 'business name', 'denominación', 'denominacion', 'fantasía', 'fantasia'];
  const cuitKw = ['número', 'numero', 'cuit', 'cuil', 'cif', 'número de documento', 'numero de documento', 'documento', 'tax id', 'identificación fiscal'];
  const emailKw = ['e-mail', 'email', 'mail', 'correo', 'e mail', 'correo electrónico'];
  const legacyKw = ['código legacy', 'codigo legacy', 'código', 'codigo', 'legajo', 'n° cliente', 'nro cliente'];
  const ivaKw = ['condición de iva', 'condicion de iva', 'condición iva', 'condicion iva', 'cond. iva', 'iva'];
  const priceListKw = ['lista de precios', 'lista precios', 'price list', 'listado', 'tarifa'];
  const openingBalanceKw = ['saldo inicio', 'saldo inicial', 'saldo de inicio', 'saldo arranque', 'opening balance'];
  const openingDateKw = ['fecha saldo inicio', 'fecha saldo inicial', 'fecha inicio', 'fecha arranque', 'opening balance date'];

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(12, rows.length); r++) {
    const rowCells = rows[r].map(c => String(c ?? '').trim().toLowerCase());
    const hasId = rowCells.some(c => businessNameKw.some(k => c.includes(k)))
      || rowCells.some(c => cuitKw.some(k => c.includes(k)))
      || rowCells.some(c => emailKw.some(k => c.includes(k)))
      || rowCells.some(c => legacyKw.some(k => c.includes(k)));
    const hasUpdate = rowCells.some(c => ivaKw.some(k => c.includes(k)))
      || rowCells.some(c => priceListKw.some(k => c.includes(k)))
      || rowCells.some(c => openingBalanceKw.some(k => c.includes(k)));
    if (hasId && hasUpdate) {
      headerRowIndex = r;
      break;
    }
  }

  const first = rows[headerRowIndex].map(c => String(c ?? '').trim());
  const firstLower = first.map(h => h.toLowerCase());
  const findCol = (keywords: string[]): number => firstLower.findIndex(h => keywords.some(k => (h || '').includes(k)));

  const businessNameCol = findCol(businessNameKw);
  const emailCol = findCol(emailKw);
  const cuitCol = findCol(cuitKw);
  const legacyCol = findCol(legacyKw);
  const ivaCol = findCol(ivaKw);
  const priceListCol = findCol(priceListKw);
  const openingBalanceCol = findCol(openingBalanceKw);
  const openingDateCol = findCol(openingDateKw);

  const trim = (v: string | number | undefined): string =>
    v == null ? '' : typeof v === 'number' ? String(v) : String(v).trim();

  const items: CustomerBulkUpdateRow[] = [];
  const start = headerRowIndex + 1;

  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const businessName = businessNameCol >= 0 ? trim(row[businessNameCol]) : '';
    const email = emailCol >= 0 ? trim(row[emailCol]) : '';
    const cuitRaw = cuitCol >= 0 ? trim(row[cuitCol]) : '';
    const cuit = cuitRaw.replace(/\D/g, '').slice(0, 11) || undefined;
    const legacyCode = legacyCol >= 0 ? trim(row[legacyCol]) : '';

    if (!businessName && !email && !cuit && !legacyCode) continue;

    const item: CustomerBulkUpdateRow = {
      ...(businessName ? { businessName } : {}),
      ...(email ? { email } : {}),
      ...(cuit ? { cuit } : {}),
      ...(legacyCode ? { legacyCode } : {}),
    };

    if (ivaCol >= 0) {
      const v = trim(row[ivaCol]);
      if (v) item.condicionIva = v;
    }
    if (priceListCol >= 0) {
      const v = trim(row[priceListCol]);
      if (v) item.priceList = v;
    }
    if (openingBalanceCol >= 0) {
      const parsed = parseExcelNumber(row[openingBalanceCol]);
      if (parsed !== undefined) item.openingBalance = parsed;
    }
    if (openingDateCol >= 0) {
      const parsed = parseExcelDate(row[openingDateCol]);
      if (parsed !== undefined) item.openingBalanceDate = parsed;
    }

    const hasUpdateField =
      item.condicionIva !== undefined
      || item.priceList !== undefined
      || item.openingBalance !== undefined
      || item.openingBalanceDate !== undefined;
    if (!hasUpdateField) continue;

    items.push(item);
  }

  return items;
}
