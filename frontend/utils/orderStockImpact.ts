import { Order, OrderStatus } from '../types';

/**
 * Cómo se refleja el pedido mayorista en el inventario.
 * Alineado con el backend: descuento al confirmar (Borrador → Confirmado o create confirmado);
 * `noStockImpact` = facturación sin movimiento de stock.
 */
export type WholesaleStockImpactVariant = 'no_impact' | 'pending' | 'deducted' | 'hidden';

const TITLE_NO_IMPACT =
  'Facturación administrativa: este pedido no desconta ni devuelve stock.';

const TITLE_PENDING =
  'Mientras el pedido esté en Borrador, el stock no se altera. Al confirmar, se descontarán del inventario las unidades (y packs) del pedido.';

const TITLE_DEDUCTED =
  'El inventario ya se actualizó: al confirmar este pedido, las unidades se descontaron. Si se cancela antes de despachar, el stock se restaura.';

export function getWholesaleStockImpactMeta(
  order: Pick<Order, 'status' | 'noStockImpact'>
): {
  variant: WholesaleStockImpactVariant;
  label: string | null;
  title: string;
  /** Clases sugeridas para badge pequeño en lista de pedidos */
  badgeClassName: string;
} {
  if (order.noStockImpact) {
    return {
      variant: 'no_impact',
      label: 'SIN IMPACTO EN STOCK',
      title: TITLE_NO_IMPACT,
      badgeClassName:
        'bg-amber-900/30 text-amber-200 border-amber-800/50',
    };
  }
  if (order.status === OrderStatus.CANCELLED) {
    return { variant: 'hidden', label: null, title: '', badgeClassName: '' };
  }
  if (order.status === OrderStatus.DRAFT) {
    return {
      variant: 'pending',
      label: 'STOCK: PENDIENTE DE DESCONTAR',
      title: TITLE_PENDING,
      badgeClassName:
        'bg-slate-800 text-amber-200 border-amber-700/50 border-dashed',
    };
  }
  return {
    variant: 'deducted',
    label: 'STOCK: YA DESCONTADO',
    title: TITLE_DEDUCTED,
    badgeClassName: 'bg-emerald-950/50 text-emerald-300 border-emerald-800/50',
  };
}
