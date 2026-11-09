/**
 * Agrupación de la lista de precios del showroom.
 * Ejecutar: npx ts-node --transpile-only src/tests/showroomPriceList.test.ts
 */
import assert from 'assert';
import { articleCodeFromSku, mapShowroomItems } from '../services/showroomPriceList.service';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

function variant(sku: string, price: number, stock = 1, extra: Record<string, unknown> = {}) {
  return { id: sku, sku, price, stock, visible: true, ...extra };
}

console.log('Código de artículo');
test('SKU completo de Lupo', () => {
  assert.strictEqual(articleCodeFromSku('1847102130280'), '1847102');
});
test('pack x3', () => {
  assert.strictEqual(articleCodeFromSku('1847102130280-X3'), '1847102');
});
test('surtido', () => {
  assert.strictEqual(articleCodeFromSku('1847102130-SURT-X3'), '1847102');
});
test('artículo con ceros a la izquierda', () => {
  assert.strictEqual(articleCodeFromSku('0069102130999'), '0069102');
});
test('el código ya es el artículo', () => {
  assert.strictEqual(articleCodeFromSku('1847102'), '1847102');
});

console.log('Agrupación');
test('talles y colores del mismo artículo quedan en una fila', () => {
  const items = mapShowroomItems(
    [
      {
        id: 1,
        published: true,
        name: { es: 'Bóxer Lupo de Bambú' },
        variants: [
          variant('1847102130280', 10000, 29),
          variant('1847102140111', 10000, 42),
          variant('1847102150999', 10000, 41),
        ],
      },
    ],
    'https://lupo.ar',
    { transfer: 0, card: 0 }
  );
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].articleCode, '1847102');
  assert.strictEqual(items[0].name, 'Bóxer Lupo de Bambú');
  assert.strictEqual(items[0].variantCount, 3);
  assert.strictEqual(items[0].stock, 112);
  assert.strictEqual(items[0].priceTransfer, 10000);
  assert.strictEqual(items[0].priceTransferMax, null);
  assert.ok(items[0].searchText.includes('1847102140111'));
});

test('el pack no se mezcla con la unidad', () => {
  const items = mapShowroomItems(
    [
      {
        id: 1,
        published: true,
        name: { es: 'Bóxer Lupo de Bambú' },
        variants: [variant('1847102130280', 10000)],
      },
      {
        id: 2,
        published: true,
        name: { es: 'Pack x3 Bóxer Lupo de Bambú' },
        variants: [variant('1847102130280-X3', 27000), variant('1847102130-SURT-X3', 27000)],
      },
    ],
    'https://lupo.ar',
    { transfer: 0, card: 0 }
  );
  assert.strictEqual(items.length, 2);
  const unit = items.find((item) => item.priceTransfer === 10000);
  const pack = items.find((item) => item.priceTransfer === 27000);
  assert.ok(unit);
  assert.ok(pack);
  assert.strictEqual(unit?.variantCount, 1);
  assert.strictEqual(pack?.variantCount, 2);
  assert.strictEqual(pack?.articleCode, '1847102');
  assert.match(pack?.name || '', /Pack x3/i);
});

test('el mismo artículo en dos fichas se junta', () => {
  const items = mapShowroomItems(
    [
      {
        id: 1,
        published: true,
        name: { es: 'Boxer Negro' },
        variants: [variant('1847102130999', 8000, 4)],
      },
      {
        id: 2,
        published: true,
        name: { es: 'Boxer Blanco' },
        variants: [variant('1847102130111', 8000, 6)],
      },
    ],
    '',
    { transfer: 0, card: 0 }
  );
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].variantCount, 2);
  assert.strictEqual(items[0].stock, 10);
  assert.strictEqual(items[0].articleCode, '1847102');
  assert.strictEqual(items[0].name, 'Boxer');
});

test('si el precio cambia entre variantes, muestra el rango', () => {
  const items = mapShowroomItems(
    [
      {
        id: 1,
        published: true,
        name: { es: 'Medias' },
        variants: [variant('1847102130280', 5000), variant('1847102140280', 7000)],
      },
    ],
    '',
    { transfer: 0, card: 0 }
  );
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].priceTransfer, 5000);
  assert.strictEqual(items[0].priceTransferMax, 7000);
});

console.log(`\n${passed} pruebas ok`);
