/**
 * Agrupación de la lista de precios del showroom.
 * Ejecutar: npx ts-node --transpile-only src/tests/showroomPriceList.test.ts
 */
import assert from 'assert';
import {
  applyPaymentDiscount,
  articleCodeFromSku,
  extractPaymentDiscountsFromHtml,
  inferDiscountFromPrices,
  mapShowroomItems,
  readPaymentDiscount,
} from '../services/showroomPriceList.service';

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

test('aplica 15% de transferencia como Pago Nube (centavos)', () => {
  assert.strictEqual(applyPaymentDiscount(41399, 15), 35189.15);
  assert.strictEqual(applyPaymentDiscount(17721, 15), 15062.85);
  const items = mapShowroomItems(
    [
      {
        id: 1,
        published: true,
        name: { es: 'Panty' },
        variants: [variant('150001130280', 17721), variant('150001140280', 27389)],
      },
    ],
    '',
    { transfer: 15, card: 0 }
  );
  assert.strictEqual(items[0].priceTransfer, 15062.85);
  assert.strictEqual(items[0].priceTransferMax, 23280.65);
  assert.strictEqual(items[0].priceCard, 17721);
  assert.strictEqual(items[0].priceCardMax, 27389);
});

console.log('Descuento Pago Nube');
test('lee data-payment-discount de wire_transfer', () => {
  const html = `
    <div id="info-payment-method-credit_card"><strong data-payment-discount="0">$100</strong></div>
    <div id="info-payment-method-wire_transfer">
      <strong>15% de descuento</strong> pagando con Transferencia
      <strong data-payment-discount="15">$85</strong>
    </div>`;
  assert.strictEqual(readPaymentDiscount(html, 'wire_transfer'), 15);
  assert.strictEqual(readPaymentDiscount(html, 'credit_card'), 0);
  assert.deepStrictEqual(extractPaymentDiscountsFromHtml(html), { transfer: 15, card: 0 });
});

test('infiere % desde price_number y precio con descuento (&quot;)', () => {
  const html =
    'price_number&quot;:41399,&quot;price_number_raw&quot;:4139900,&quot;price_with_payment_discount_short&quot;:&quot;$35.189,15&quot;';
  assert.deepStrictEqual(extractPaymentDiscountsFromHtml(html), { transfer: 15, card: 0 });
  assert.strictEqual(inferDiscountFromPrices(41399, 35189.15), 15);
});

console.log(`\n${passed} pruebas ok`);
