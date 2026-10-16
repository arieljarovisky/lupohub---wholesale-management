import { request } from './httpClient';

export type SyncVariant = {
  variantId: string;
  productName: string;
  sku: string;
  color: string;
  size: string;
  stock: number;
};

export type StockSyncOverview = {
  connections: { mercadolibre: boolean; tiendanube: boolean };
  worker: { alive: boolean };
  queue: { pending: number; failing: number; bulk: number; oldestSeconds: number };
  fullResync: { enabled: boolean; lastAt: string | null };
  ordersCheck: { lastAt: string | null; errors: string[] };
  failing: Array<{
    variant: SyncVariant;
    attempts: number;
    nextTryAt: string;
    targets: Array<{ label: string; error: string }>;
    error: string;
  }>;
  unmatched: Array<{
    lineId: number;
    platform: 'tiendanube' | 'mercadolibre';
    platformName: string;
    orderId: string;
    orderNumber: string | null;
    buyer: string | null;
    title: string;
    reason: string;
    sku: string;
    quantity: number;
    date: string;
  }>;
  alerts: Array<{
    id: string;
    kind: string;
    message: string;
    reference: string | null;
    date: string;
    variant: SyncVariant | null;
  }>;
  recent: Array<{
    id: string;
    what: string;
    type: string;
    change: number;
    stockAfter: number;
    reference: string;
    date: string;
    variant: SyncVariant | null;
  }>;
};

type Msg = { message: string };

export const stockSyncApi = {
  overview: () => request<StockSyncOverview>('/stock-sync/overview'),
  searchVariants: (q: string) =>
    request<{ items: SyncVariant[] }>(`/stock-sync/variants?q=${encodeURIComponent(q)}`).then((r) => r.items),
  resyncAll: () => request<Msg & { queued: number }>('/stock-sync/resync-all', 'POST', {}),
  retryAll: () => request<Msg>('/stock-sync/retry-all', 'POST', {}),
  retryOne: (variantId: string) => request<Msg>(`/stock-sync/retry/${encodeURIComponent(variantId)}`, 'POST', {}),
  resolveLine: (lineId: number, variantId: string, pack: number, remember: boolean) =>
    request<Msg & { ok: boolean }>(`/stock-sync/unmatched/${lineId}/resolve`, 'POST', { variantId, pack, remember }),
  dismissLine: (lineId: number) => request<Msg>(`/stock-sync/unmatched/${lineId}/dismiss`, 'POST', {}),
  dismissAlert: (id: string) => request<{ ok: boolean }>(`/stock-sync/alerts/${encodeURIComponent(id)}/dismiss`, 'POST', {}),
  dismissAllAlerts: () => request<{ ok: boolean }>('/stock-sync/alerts/dismiss-all', 'POST', {}),
  checkOrders: () => request<Msg>('/stock-sync/check-orders', 'POST', {}, undefined, 120000),
  reprocessOrder: (platform: 'tiendanube' | 'mercadolibre', orderId: string) =>
    request<Msg & { state: string }>('/stock-sync/reprocess-order', 'POST', { platform, orderId }, undefined, 60000),
};
