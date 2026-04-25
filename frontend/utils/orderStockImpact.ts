import { Order, OrderStatus } from '../types';

/**
 * Cómo se refleja el pedido mayorista en el inventario.
 * Alineado con el backend: descuento al confirmar (Borrador → Confirmado o create confirmado);
 * `noStockImpact` = facturación sin movimiento de stock.
 */
export type WholesaleStockImpactVariant = 'no_impact' | 'pending' | 'deducted' | 'not_applied' | 'hidden';

const TITLE_NO_IMPACT =
  'Facturación sin movimiento de inventario: no desconta ni devuelve stock (incluye factura emitida con “sin impacto de stock”).';

const TITLE_PENDING =
  'Mientras el pedido esté en Borrador, el stock no se altera. Al confirmar, se descontarán del inventario las unidades (y packs) del pedido.';

const TITLE_DEDUCTED =
  'El inventario ya se actualizó: al confirmar este pedido, las unidades se descontaron. Si se cancela antes de despachar, el stock se restaura.';

const TITLE_NOT_APPLIED =
  'El pedido está confirmado (o en curso) pero no hay registro de descuento de stock. Usá “Descontar stock” para aplicarlo ahora.';

export function getWholesaleStockImpactMeta(
  order: Pick<Order, 'status' | 'noStockImpact'> & { mayoristaStockApplied?: boolean }
): {
  variant: WholesaleStockImpactVariant;
  label: string | null;
  title: string;
  /** Clases sugeridas para badge pequeño en lista de pedidos */
  badgeClassName: string;
  /** Borde izquierdo de la tarjeta de pedido (saber de un vistazo si el stock ya se descontó) */
  cardAccentClass: string;
} {
  if (order.noStockImpact) {
    return {
      variant: 'no_impact',
      label: 'SIN IMPACTO STOCK',
      title: TITLE_NO_IMPACT,
      badgeClassName:
        'bg-amber-900/30 text-amber-200 border-amber-800/50',
      cardAccentClass: 'border-l-4 border-amber-500/80',
    };
  }
  if (order.status === OrderStatus.CANCELLED) {
    return {
      variant: 'hidden',
      label: null,
      title: '',
      badgeClassName: '',
      cardAccentClass: 'border-l-4 border-slate-600/50',
    };
  }
  if (order.status === OrderStatus.DRAFT) {
    if (order.mayoristaStockApplied === true) {
      return {
        variant: 'deducted',
        label: 'STOCK: YA DESCONTADO',
        title: TITLE_DEDUCTED,
        badgeClassName: 'bg-emerald-950/50 text-emerald-300 border-emerald-800/50',
        cardAccentClass: 'border-l-4 border-emerald-500/80',
      };
    }
    return {
      variant: 'pending',
      label: 'STOCK: PENDIENTE DE DESCONTAR',
      title: TITLE_PENDING,
      badgeClassName:
        'bg-slate-800 text-amber-200 border-amber-700/50 border-dashed',
      cardAccentClass: 'border-l-4 border-amber-400/90',
    };
  }
  if (order.mayoristaStockApplied === false) {
    return {
      variant: 'not_applied',
      label: 'STOCK: SIN APLICAR',
      title: TITLE_NOT_APPLIED,
      badgeClassName:
        'bg-orange-950/50 text-orange-200 border-orange-600/50',
      cardAccentClass: 'border-l-4 border-orange-500/85',
    };
  }
  return {
    variant: 'deducted',
    label: 'STOCK: YA DESCONTADO',
    title: TITLE_DEDUCTED,
    badgeClassName: 'bg-emerald-950/50 text-emerald-300 border-emerald-800/50',
    cardAccentClass: 'border-l-4 border-emerald-500/80',
  };
}
