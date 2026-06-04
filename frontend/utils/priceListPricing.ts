/**
 * Resolución de precios según catálogo cargado con lista (getProductsAll + price_list_id).
 */
import type { Order, OrderItem, Product } from '../types';
import { articleCodesMatch, resolveDisplayArticleCode } from './articleCodeUtils';
import { orderNetoFromItemsByQuantity } from './wholesaleInvoiceHtml';

export function buildCatalogPriceByKey(products: Product[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of products) {
    const price = Number(p.price);
    if (!Number.isFinite(price) || price < 0) continue;
    const pid = String((p as { product_id?: string }).product_id || '').trim();
    if (pid) m.set(`id:${pid}`, price);
    const base = String((p as { base_sku?: string }).base_sku || '').trim();
    if (base) {
      m.set(`sku:${base.toLowerCase()}`, price);
      m.set(`sku:${resolveDisplayArticleCode(base).toLowerCase()}`, price);
    }
  }
  return m;
}

export function getPriceFromList(
  products: Product[],
  catalogPriceByKey: Map<string, number>,
  productId: string | undefined,
  productSku: string,
  fallbackBasePrice?: number
): number {
  const pid = String(productId || '').trim();
  if (pid) {
    const byId = catalogPriceByKey.get(`id:${pid}`);
    if (byId != null) return byId;
  }
  const sku = String(productSku || '').trim();
  if (sku) {
    const bySku =
      catalogPriceByKey.get(`sku:${sku.toLowerCase()}`) ??
      catalogPriceByKey.get(`sku:${resolveDisplayArticleCode(sku).toLowerCase()}`);
    if (bySku != null) return bySku;
  }
  for (const p of products) {
    if (pid && String((p as { product_id?: string }).product_id) === pid) {
      const listPrice = Number(p.price);
      if (Number.isFinite(listPrice) && listPrice >= 0) return listPrice;
    }
    const base = String((p as { base_sku?: string }).base_sku || '').trim();
    if (base && articleCodesMatch(base, sku)) {
      const listPrice = Number(p.price);
      if (Number.isFinite(listPrice) && listPrice >= 0) return listPrice;
    }
  }
  return Math.max(0, Number(fallbackBasePrice) || 0);
}

function resolveItemListPrice(item: OrderItem, products: Product[], catalog: Map<string, number>): number {
  const variantId = String(item.variantId ?? item.productId ?? '').trim();
  if (variantId) {
    const variant = products.find((p) => p.id === variantId);
    if (variant) {
      const lp = Number(variant.price);
      if (Number.isFinite(lp) && lp >= 0) return lp;
    }
  }
  const sku = String(item.sku ?? '').trim();
  const articleFromSku = sku ? resolveDisplayArticleCode(sku.split('-')[0] || sku) : '';
  return getPriceFromList(products, catalog, item.productId, articleFromSku || sku, item.priceAtMoment);
}

/** Aplica precios del catálogo (lista del cliente o base) a las líneas del pedido. */
export function applyPriceListToOrder(order: Order, listProducts: Product[]): Order {
  if (!order.items?.length || !listProducts.length) return order;
  const catalog = buildCatalogPriceByKey(listProducts);
  const items = order.items.map((item) => {
    const priceAtMoment = Math.round(resolveItemListPrice(item, listProducts, catalog) * 100) / 100;
    return priceAtMoment === item.priceAtMoment ? item : { ...item, priceAtMoment };
  });
  const changed = items.some((it, i) => it !== order.items[i]);
  if (!changed) return order;
  const next = { ...order, items };
  return { ...next, total: orderNetoFromItemsByQuantity(next) };
}
