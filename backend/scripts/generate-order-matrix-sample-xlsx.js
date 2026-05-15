/**
 * Genera examples/ejemplo-importar-pedidos-matriz.xlsx (formato matriz para import en CreateOrderTemplate).
 * Ejecutar: node scripts/generate-order-matrix-sample-xlsx.js
 */
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const outDir = path.join(__dirname, '..', '..', 'examples');
fs.mkdirSync(outDir, { recursive: true });

const headers = ['Cliente', 'Codigo', 'Color', 'P', 'M', 'G', 'GG', 'XG', 'Precio'];
const rows1 = [
  headers,
  ['REEMPLAZAR: razon social exacta en LupoHub', '0010001', '614', 2, 6, 4, 0, 0, 4500],
  ['', '', '999', 0, 3, 0, 2, 0, ''],
  ['Otro cliente (mismo formato)', '0010001', '614', 1, 0, 0, 0, 0, ''],
];

const ws1 = XLSX.utils.aoa_to_sheet(rows1);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws1, 'Varios clientes');

const headersNoCliente = ['Codigo', 'Color', 'P', 'M', 'G', 'GG', 'U', 'Precio'];
const rows2 = [
  headersNoCliente,
  ['0010002', '202', 0, 12, 8, 0, 5, 3200.5],
  ['', '614', 1, 1, 1, 1, 0, ''],
];
const ws2 = XLSX.utils.aoa_to_sheet(rows2);
/** Sin columna Cliente: el nombre de esta hoja debe ser la razón social (o nombre) del cliente en LupoHub. */
XLSX.utils.book_append_sheet(wb, ws2, 'REEMPLAZAR cliente por hoja');

const instr = [
  ['Plantilla importacion pedidos (matriz) - LupoHub'],
  [''],
  [
    '1) Primera fila = cabeceras. Columnas obligatorias: Codigo (o CODIGO, SKU, ARTICULO, MODELO) y Color (o CODIGO COLOR, etc.).',
  ],
  [
    '2) Cliente: columna Cliente / REF / RAZON SOCIAL, etc. Debe coincidir con razon social o nombre del cliente en LupoHub.',
  ],
  [
    '3) Si NO hay columna de cliente, se usa el NOMBRE DE LA HOJA como referencia de cliente (renombrá la hoja a la razón social exacta).',
  ],
  [
    '4) Talles: una columna por talle (P, M, G, GG, XG, XXG, XXXG, U, o numeros como 38, 40). Cantidad entera por celda; vacio o 0 = sin pedido.',
  ],
  ['5) Codigo en celda vacia = repite el codigo de la fila anterior (como Excel con celdas combinadas).'],
  ['6) Precio: columna Precio opcional por fila; si esta vacio, LupoHub usa el precio base del articulo.'],
  ['7) La fecha del pedido se toma de la pantalla al importar (no del Excel).'],
  ['8) Se procesan TODAS las hojas que tengan cabecera valida; hojas de solo texto se ignoran.'],
];
const ws3 = XLSX.utils.aoa_to_sheet(instr);
XLSX.utils.book_append_sheet(wb, ws3, 'Leeme');

const fp = path.join(outDir, 'ejemplo-importar-pedidos-matriz.xlsx');
XLSX.writeFile(wb, fp);
console.log('Written:', fp);
