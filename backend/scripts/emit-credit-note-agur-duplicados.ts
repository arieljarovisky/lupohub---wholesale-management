/**
 * Emite NC parcial para corregir líneas duplicadas del pedido AGUR.
 *
 * Uso:
 *   NODE_ENV=production npx ts-node scripts/emit-credit-note-agur-duplicados.ts
 *   NODE_ENV=production npx ts-node scripts/emit-credit-note-agur-duplicados.ts --order-id O-298607
 */
import pool from '../src/database/db';
import { emitirNotaCredito } from '../src/controllers/orders.controller';

type ReqLike = {
  params: { id: string };
  user: { id: string; role: 'ADMIN' | 'WAREHOUSE' | 'DEPOSITO' };
  body: any;
};

type ResLike = {
  statusCode: number;
  payload: any;
  status: (code: number) => ResLike;
  json: (data: any) => ResLike;
};

function parseArgValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function buildRes(): ResLike {
  return {
    statusCode: 200,
    payload: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.payload = data;
      return this;
    },
  };
}

async function main() {
  const orderId = parseArgValue('--order-id') || 'O-298607';

  // itemIndex según SELECT order_items ORDER BY id del pedido ya saneado.
  const items = [
    { itemIndex: 0, quantity: 2 },
    { itemIndex: 1, quantity: 2 },
    { itemIndex: 3, quantity: 12 },
    { itemIndex: 7, quantity: 2 },
    { itemIndex: 8, quantity: 1 },
    { itemIndex: 12, quantity: 1 },
    { itemIndex: 13, quantity: 2 },
    { itemIndex: 15, quantity: 2 },
    { itemIndex: 16, quantity: 2 },
    { itemIndex: 18, quantity: 2 },
    { itemIndex: 20, quantity: 2 },
  ];

  const req: ReqLike = {
    params: { id: orderId },
    user: { id: 'script-admin', role: 'ADMIN' },
    body: {
      tipo: 'item',
      items,
    },
  };
  const res = buildRes();

  await emitirNotaCredito(req as any, res as any);

  console.log('HTTP status:', res.statusCode);
  console.log('Respuesta:', JSON.stringify(res.payload, null, 2));

  if (res.statusCode >= 400) {
    throw new Error(res.payload?.message || 'Falló emisión de NC');
  }
}

main()
  .catch((e) => {
    console.error('[emit-credit-note-agur-duplicados] Error:', e?.message || e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

