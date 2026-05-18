import { OrderStatus } from '../types';

export const ORDERS_LIST_FILTERS_KEY = 'lupo_orders_list_filters';

export type OrdersInvoiceListFilter =
  | 'all'
  | 'uninvoiced'
  | 'invoiced'
  | 'invoiced_with_iibb'
  | 'invoiced_no_iibb';

export type OrdersListFiltersState = {
  filterStatus: OrderStatus | 'ALL';
  invoiceFilter: OrdersInvoiceListFilter;
  customerSearchQuery: string;
  orderArchivedFilter: 'no' | 'yes' | 'only';
};

const INVOICE_FILTERS: OrdersInvoiceListFilter[] = [
  'all',
  'uninvoiced',
  'invoiced',
  'invoiced_with_iibb',
  'invoiced_no_iibb',
];

const DEFAULT: OrdersListFiltersState = {
  filterStatus: 'ALL',
  invoiceFilter: 'all',
  customerSearchQuery: '',
  orderArchivedFilter: 'no',
};

export function getStoredOrdersListFilters(): OrdersListFiltersState {
  try {
    const raw = sessionStorage.getItem(ORDERS_LIST_FILTERS_KEY);
    if (!raw) return { ...DEFAULT };
    const p = JSON.parse(raw) as Partial<OrdersListFiltersState>;
    const filterStatus =
      p.filterStatus === 'ALL' || (p.filterStatus && Object.values(OrderStatus).includes(p.filterStatus))
        ? p.filterStatus
        : DEFAULT.filterStatus;
    const invoiceFilter =
      p.invoiceFilter && INVOICE_FILTERS.includes(p.invoiceFilter) ? p.invoiceFilter : DEFAULT.invoiceFilter;
    const customerSearchQuery =
      typeof p.customerSearchQuery === 'string' ? p.customerSearchQuery : DEFAULT.customerSearchQuery;
    const orderArchivedFilter =
      p.orderArchivedFilter === 'yes' || p.orderArchivedFilter === 'only' || p.orderArchivedFilter === 'no'
        ? p.orderArchivedFilter
        : DEFAULT.orderArchivedFilter;
    return { filterStatus, invoiceFilter, customerSearchQuery, orderArchivedFilter };
  } catch {
    return { ...DEFAULT };
  }
}

export function setStoredOrdersListFilters(state: OrdersListFiltersState): void {
  try {
    sessionStorage.setItem(ORDERS_LIST_FILTERS_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}
