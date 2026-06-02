/**
 * Imputa automáticamente todos los recibos sin payment_invoices / payment_orders.
 * Orden: facturas más antiguas con saldo, luego pedidos sin factura.
 *
 * Uso:
 *   npx ts-node scripts/auto-allocate-unallocated-payments.ts          # ejecuta
 *   npx ts-node scripts/auto-allocate-unallocated-payments.ts --dry-run
 */
import { autoAllocateAllUnallocatedPayments } from '../src/services/orderPaymentBalance.service';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? '[dry-run] Vista previa de imputación...' : 'Imputando recibos sin asignar...');

  const summary = await autoAllocateAllUnallocatedPayments(dryRun);

  console.log('\n--- Resumen ---');
  console.log(`Recibos sin imputar encontrados: ${summary.total}`);
  console.log(`Imputados completos: ${summary.allocated}`);
  console.log(`Imputados parciales (sobra importe): ${summary.partial}`);
  console.log(`Omitidos: ${summary.skipped}`);
  console.log(`Importe total sin poder imputar: $${summary.remainingTotal.toLocaleString('es-AR')}`);

  const withIssue = summary.details.filter(
    (d) => d.skipped || d.remainingUnallocated > 0.01
  );
  if (withIssue.length > 0) {
    console.log('\n--- Detalle (omitidos o parciales) ---');
    for (const d of withIssue.slice(0, 50)) {
      console.log(
        `${d.receiptNumber || d.paymentId} | cliente ${d.customerId} | $${d.amount.toLocaleString('es-AR')} | aplicado $${d.appliedTotal.toLocaleString('es-AR')} | resto $${d.remainingUnallocated.toLocaleString('es-AR')}${d.skipped ? ` | ${d.skipped}` : ''}`
      );
    }
    if (withIssue.length > 50) {
      console.log(`... y ${withIssue.length - 50} más`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
