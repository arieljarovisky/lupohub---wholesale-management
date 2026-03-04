/**
 * Parsea el Excel de artículos exportado de Tango.
 * Regla del código: primeros 7 dígitos = artículo, siguientes 3 = talle, siguientes 3 = color.
 *
 * Uso: node scripts/parse-tango-articulos.js [ruta/al/archivo.xlsx]
 * Ejemplo: node scripts/parse-tango-articulos.js "C:\Users\usuario\Downloads\Artículos.xlsx"
 */

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const filePath = process.argv[2] || path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads', 'Artículos.xlsx');

if (!fs.existsSync(filePath)) {
  console.error('No se encontró el archivo:', filePath);
  console.error('Uso: node scripts/parse-tango-articulos.js [ruta/al/archivo.xlsx]');
  process.exit(1);
}

// Buscar columna "codigo" (o "Código") sin importar mayúsculas/acentos
function findCodigoColumn(headers) {
  const normalized = (s) =>
    (s || '')
      .toString()
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  const codigoNorm = 'codigo';
  for (let i = 0; i < headers.length; i++) {
    const h = normalized(headers[i]);
    if (h === codigoNorm || h === 'codigo' || h.startsWith('codigo')) return i;
  }
  // Por nombre común: primera columna que contenga "codigo"
  for (let i = 0; i < headers.length; i++) {
    if (normalized(headers[i]).includes('codigo')) return i;
  }
  return -1;
}

// Parsear código Tango: 7 dígitos = artículo, 3 = talle, 3 = color (solo se usan dígitos, se ignoran espacios)
function parseCodigoTango(codigo) {
  const raw = (codigo != null ? String(codigo).trim() : '');
  const s = raw.replace(/\D/g, ''); // solo dígitos
  return {
    articulo: s.slice(0, 7),
    talle: s.slice(7, 10),
    color: s.slice(10, 13),
    codigoCompleto: raw,
  };
}

const workbook = XLSX.readFile(filePath, { type: 'file', cellDates: true });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

if (data.length < 2) {
  console.log('El archivo tiene pocas filas o está vacío.');
  process.exit(0);
}

const headers = data[0].map((h) => (h != null ? String(h).trim() : ''));
const codigoCol = findCodigoColumn(headers);

if (codigoCol < 0) {
  console.error('No se encontró la columna "codigo" o "Código". Columnas encontradas:', headers);
  process.exit(1);
}

const rows = [];
const onlyComplete = process.argv.includes('--solo-completos'); // filas con 7+3+3 dígitos
for (let i = 1; i < data.length; i++) {
  const row = data[i];
  const codigo = row[codigoCol];
  const parsed = parseCodigoTango(codigo);
  const digitCount = (parsed.articulo + parsed.talle + parsed.color).length;
  if (onlyComplete && digitCount < 13) continue;
  const record = {};
  headers.forEach((h, j) => {
    record[h || `Col${j}`] = row[j] != null ? row[j] : '';
  });
  record._articulo = parsed.articulo;
  record._talle = parsed.talle;
  record._color = parsed.color;
  record._codigoCompleto = parsed.codigoCompleto;
  rows.push(record);
}

console.log('Regla: código = 7 dígitos (artículo) + 3 (talle) + 3 (color)');
if (onlyComplete) console.log('(solo filas con código completo 7+3+3)\n');
else console.log('(usa --solo-completos para omitir filas con código incompleto)\n');
console.log('Total filas:', rows.length);
console.log('\nPrimeras 15 filas parseadas:\n');

const preview = rows.slice(0, 15);
preview.forEach((r, i) => {
  console.log(
    `${i + 1}. Código: "${r._codigoCompleto}" → Artículo: ${r._articulo} | Talle: ${r._talle} | Color: ${r._color}`
  );
});

// Resumen de códigos únicos
const articulos = new Set(rows.map((r) => r._articulo).filter(Boolean));
const talles = new Set(rows.map((r) => r._talle).filter(Boolean));
const colores = new Set(rows.map((r) => r._color).filter(Boolean));
console.log('\n--- Resumen ---');
console.log('Artículos únicos (7 dígitos):', articulos.size);
console.log('Talles únicos (3 dígitos):', talles.size);
console.log('Colores únicos (3 dígitos):', colores.size);

// Guardar JSON completo en la misma carpeta que el script
const outPath = path.join(__dirname, 'tango-articulos-parseados.json');
fs.writeFileSync(outPath, JSON.stringify(rows, null, 2), 'utf8');
console.log('\nArchivo completo guardado en:', outPath);
