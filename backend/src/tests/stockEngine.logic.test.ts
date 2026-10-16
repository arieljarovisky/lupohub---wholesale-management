/**
 * Pruebas de la lógica pura del motor de stock (no necesitan base de datos ni internet).
 * Ejecutar: npm run test:stock-engine
 */
import assert from 'assert';
import { isBeforeCutover, normalizeMercadoLibreOrder, normalizeTiendaNubeOrder } from '../stockEngine/channelOrders';
import { computeWholesaleDeltas, isPickingDone, itemUnits } from '../stockEngine/wholesale';
import { unitsForListing } from '../stockEngine/targets';
import { backoffSeconds } from '../stockEngine/syncQueue';

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

console.log('Ventas de Tienda Nube');
test('pagada → descontar', () => {
  const o = normalizeTiendaNubeOrder({ id: 1, number: 1909, status: 'open', payment_status: 'paid', products: [] });
  assert.strictEqual(o.intent, 'apply');
  assert.strictEqual(o.orderNumber, '1909');
});
test('pendiente de pago → no hacer nada', () => {
  assert.strictEqual(normalizeTiendaNubeOrder({ id: 1, status: 'open', payment_status: 'pending' }).intent, 'ignore');
});
test('cancelada → devolver (aunque figure pagada)', () => {
  assert.strictEqual(normalizeTiendaNubeOrder({ id: 1, status: 'cancelled', payment_status: 'paid' }).intent, 'revert');
});
test('reembolsada o anulada → devolver', () => {
  assert.strictEqual(normalizeTiendaNubeOrder({ id: 1, status: 'open', payment_status: 'refunded' }).intent, 'revert');
  assert.strictEqual(normalizeTiendaNubeOrder({ id: 1, status: 'open', payment_status: 'voided' }).intent, 'revert');
});
test('líneas: id estable, cantidad entera, sin negativos', () => {
  const o = normalizeTiendaNubeOrder({
    id: 5,
    payment_status: 'paid',
    products: [
      { id: 77, product_id: 10, variant_id: 20, sku: ' ABC ', name: 'Body', variant_values: ['Negro', 'M'], quantity: '2' },
      { product_id: 11, variant_id: 21, quantity: -3 },
    ],
  });
  assert.strictEqual(o.lines[0].lineKey, 'l77');
  assert.strictEqual(o.lines[0].sku, 'ABC');
  assert.strictEqual(o.lines[0].quantity, 2);
  assert.strictEqual(o.lines[0].title, 'Body — Negro / M');
  assert.strictEqual(o.lines[1].lineKey, 'l1');
  assert.strictEqual(o.lines[1].quantity, 0);
});

console.log('Ventas de Mercado Libre');
test('paid → descontar; cancelled/invalid → devolver; otros → nada', () => {
  assert.strictEqual(normalizeMercadoLibreOrder({ id: 1, status: 'paid' }).intent, 'apply');
  assert.strictEqual(normalizeMercadoLibreOrder({ id: 1, status: 'cancelled' }).intent, 'revert');
  assert.strictEqual(normalizeMercadoLibreOrder({ id: 1, status: 'invalid' }).intent, 'revert');
  assert.strictEqual(normalizeMercadoLibreOrder({ id: 1, status: 'payment_required' }).intent, 'ignore');
  assert.strictEqual(normalizeMercadoLibreOrder({ id: 1, status: 'partially_refunded' }).intent, 'ignore');
});
test('líneas: clave por posición + ítem + variación; SKU del vendedor', () => {
  const o = normalizeMercadoLibreOrder({
    id: 9,
    status: 'paid',
    order_items: [
      { item: { id: 'MLA1', variation_id: 55, seller_sku: 'X1', title: 'Body', variation_attributes: [{ value_name: 'Rojo' }] }, quantity: 3 },
      { item: { id: 'MLA2' }, quantity: 1 },
    ],
  });
  assert.strictEqual(o.lines[0].lineKey, '0:MLA1:55');
  assert.strictEqual(o.lines[0].variantExtId, '55');
  assert.strictEqual(o.lines[0].sku, 'X1');
  assert.strictEqual(o.lines[0].title, 'Body — Rojo');
  assert.strictEqual(o.lines[1].lineKey, '1:MLA2:0');
});
test('fecha de pago = el último pago aprobado', () => {
  const o = normalizeMercadoLibreOrder({
    id: 1,
    status: 'paid',
    date_created: '2026-10-01T10:00:00Z',
    payments: [{ date_approved: '2026-10-02T10:00:00Z' }, { date_approved: '2026-10-03T10:00:00Z' }, { date_approved: null }],
  });
  assert.strictEqual(o.paidAt?.toISOString(), '2026-10-03T10:00:00.000Z');
});

console.log('Ventas anteriores al motor nuevo');
const cut = new Date('2026-10-16T12:00:00Z');
test('pagada antes del corte → la manejó el sistema viejo', () => {
  assert.strictEqual(isBeforeCutover({ createdAt: new Date('2026-10-10T00:00:00Z'), paidAt: new Date('2026-10-11T00:00:00Z') }, cut), true);
});
test('creada antes pero pagada después del corte → la maneja el motor nuevo', () => {
  assert.strictEqual(isBeforeCutover({ createdAt: new Date('2026-10-10T00:00:00Z'), paidAt: new Date('2026-10-17T00:00:00Z') }, cut), false);
});
test('sin fecha de pago usa la de creación', () => {
  assert.strictEqual(isBeforeCutover({ createdAt: new Date('2026-10-10T00:00:00Z'), paidAt: null }, cut), true);
  assert.strictEqual(isBeforeCutover({ createdAt: new Date('2026-10-20T00:00:00Z'), paidAt: null }, cut), false);
});
test('sin ninguna fecha → se procesa (no se pierde la venta)', () => {
  assert.strictEqual(isBeforeCutover({ createdAt: null, paidAt: null }, cut), false);
});

console.log('Pedidos mayoristas');
test('estados de armado terminado', () => {
  assert.ok(isPickingDone('Falta controlar'));
  assert.ok(isPickingDone('Controlado'));
  assert.ok(isPickingDone('Despachado'));
  assert.ok(!isPickingDone('Preparación'));
  assert.ok(!isPickingDone('Confirmado'));
  assert.ok(!isPickingDone(null));
});
test('unidades: armado parcial y packs', () => {
  assert.strictEqual(itemUnits(10, 7, false, 1, true), 7);
  assert.strictEqual(itemUnits(10, 12, false, 1, true), 10, 'nunca más que lo pedido');
  assert.strictEqual(itemUnits(10, 7, false, 1, false), 10, 'sin armado: lo pedido');
  assert.strictEqual(itemUnits(3, 3, true, 6, true), 18, 'pack x6');
  assert.strictEqual(itemUnits(-2, 5, false, 1, false), 0);
});
test('diferencias: primer descuento', () => {
  const d = computeWholesaleDeltas(new Map(), new Map([['a', 5], ['b', 2]]));
  assert.deepStrictEqual(d, [
    { variantId: 'a', take: 5, desired: 5 },
    { variantId: 'b', take: 2, desired: 2 },
  ]);
});
test('diferencias: recalcular igual no mueve nada (idempotente)', () => {
  assert.deepStrictEqual(computeWholesaleDeltas(new Map([['a', 5]]), new Map([['a', 5]])), []);
});
test('diferencias: cancelar devuelve exactamente lo tomado', () => {
  assert.deepStrictEqual(computeWholesaleDeltas(new Map([['a', 5], ['b', 2]]), new Map()), [
    { variantId: 'a', take: -5, desired: 0 },
    { variantId: 'b', take: -2, desired: 0 },
  ]);
});
test('diferencias: editar el pedido ajusta solo lo que cambió', () => {
  assert.deepStrictEqual(computeWholesaleDeltas(new Map([['a', 5], ['b', 2]]), new Map([['a', 3], ['c', 1], ['b', 2]])), [
    { variantId: 'a', take: -2, desired: 3 },
    { variantId: 'c', take: 1, desired: 1 },
  ]);
});
test('diferencias: nunca se "desea" stock negativo', () => {
  assert.deepStrictEqual(computeWholesaleDeltas(new Map([['a', 1]]), new Map([['a', -4]])), [{ variantId: 'a', take: -1, desired: 0 }]);
});

console.log('Publicaciones y cola');
test('stock publicado por pack (se redondea para abajo, nunca negativo)', () => {
  assert.strictEqual(unitsForListing(10, 1), 10);
  assert.strictEqual(unitsForListing(10, 3), 3);
  assert.strictEqual(unitsForListing(2, 3), 0);
  assert.strictEqual(unitsForListing(-5, 1), 0, 'stock negativo se publica como 0');
  assert.strictEqual(unitsForListing(7, 0), 7, 'pack inválido = 1');
});
test('reintentos: 30 s, 1 min, 2 min… hasta 1 hora; error permanente cada 6 h', () => {
  assert.strictEqual(backoffSeconds(1, false), 30);
  assert.strictEqual(backoffSeconds(2, false), 60);
  assert.strictEqual(backoffSeconds(3, false), 120);
  assert.strictEqual(backoffSeconds(50, false), 3600);
  assert.strictEqual(backoffSeconds(1, true), 6 * 3600);
});

console.log(`\n${passed} pruebas OK`);
