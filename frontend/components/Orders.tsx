import React, { useState } from 'react';
import { Search, ChevronRight, CheckCircle, Clock, Truck, FileText, Bot, Plus, X, Trash2, Save, PackageCheck, Lock, Filter, Package, Edit, AlertCircle, XCircle, LayoutList, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Order, OrderStatus, Role, Product, Customer, OrderItem, User } from '../types';
import { useNotification } from '../context/NotificationContext';

interface OrdersProps {
  orders: Order[];
  products: Product[];
  customers: Customer[];
  users: User[];
  role: Role;
  currentUserId?: string;
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  onCreateOrder: (order: Order) => void;
  onNavigate: (view: string) => void;
  onStartPicking?: (order: Order) => void;
  onEditOrder?: (order: Order) => void;
  onDeleteOrder?: (orderId: string) => void;
}

const Orders: React.FC<OrdersProps> = React.memo(({ 
  orders, products, customers, users, role, 
  currentUserId, onUpdateStatus, onCreateOrder, 
  onNavigate, onStartPicking, onEditOrder, onDeleteOrder 
}) => {
  const { showConfirm } = useNotification();
  const [filterStatus, setFilterStatus] = useState<OrderStatus | 'ALL'>('ALL');
  const [filterCustomer, setFilterCustomer] = useState<string>('ALL');

  const getStatusColor = (status: OrderStatus) => {
    switch(status) {
      case OrderStatus.DRAFT: return 'bg-slate-700/50 text-slate-300 border border-slate-600';
      case OrderStatus.CONFIRMED: return 'bg-blue-900/30 text-blue-300 border border-blue-800';
      case OrderStatus.PREPARATION: return 'bg-yellow-900/30 text-yellow-300 border border-yellow-800';
      case OrderStatus.DISPATCHED: return 'bg-green-900/30 text-green-300 border border-green-800';
      case OrderStatus.CANCELLED: return 'bg-red-900/30 text-red-300 border border-red-800';
      default: return 'bg-slate-700/50 text-slate-400 border border-slate-600';
    }
  };

  const filteredOrders = orders.filter(o =>
    (filterStatus === 'ALL' || o.status === filterStatus) &&
    (filterCustomer === 'ALL' || o.customerId === filterCustomer)
  );

  const canCancelOrder = (order: Order) =>
    (order.status === OrderStatus.CONFIRMED || order.status === OrderStatus.PREPARATION) &&
    (role === Role.ADMIN || role === Role.SELLER || role === Role.CUSTOMER);

  const canEditOrder = role === Role.ADMIN || role === Role.SELLER || role === Role.CUSTOMER;

  const getCustomerName = (customerId: string) => customers.find(c => c.id === customerId)?.businessName || customers.find(c => c.id === customerId)?.name || customerId;

  /** Fecha legible en la lista de pedidos (DD/MM/YYYY). */
  const formatOrderDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  /** Nombre seguro para hoja Excel (máx 31 caracteres, sin caracteres inválidos). */
  const safeSheetName = (order: Order) => {
    const base = `#${order.id}`.replace(/[\\/*?:\[\]]/g, '');
    const name = getCustomerName(order.customerId).replace(/[\\/*?:\[\]]/g, '').slice(0, 12);
    const sheetName = `${base} ${name}`.trim().slice(0, 31);
    return sheetName || `Pedido_${order.id.slice(-8)}`;
  };

  /** Enriquecer ítem con datos de producto cuando falten (p. ej. pedidos en caché o respuesta antigua). */
  const enrichItem = (item: OrderItem): OrderItem => {
    if (item.sku != null && item.productName != null) return item;
    const variantId = item.variantId ?? item.productId;
    if (!variantId) return item;
    const p = products.find((x: Product) => x.id === variantId);
    if (!p) return item;
    return {
      ...item,
      sku: item.sku ?? p.sku,
      productName: item.productName ?? p.name,
      sizeCode: item.sizeCode ?? p.size,
      colorName: item.colorName ?? p.color,
    };
  };

  /** Genera una hoja en formato planilla para un pedido: encabezado (Pedido, Fecha, Cliente, Estado, Total) + tabla de ítems, igual que la plantilla en la web. */
  const buildOrderSheet = (order: Order) => {
    const customerName = getCustomerName(order.customerId);
    const itemHeaders = ['SKU', 'Producto', 'Talle', 'Color', 'Cantidad', 'Precio unit.', 'Subtotal'];
    const enrichedItems = order.items.map(enrichItem);
    const itemRows = enrichedItems.map(item => {
      const price = item.priceAtMoment ?? 0;
      const subtotal = item.quantity * price;
      return [
        item.sku ?? '',
        item.productName ?? '',
        item.sizeCode ?? '',
        item.colorName ?? '',
        item.quantity,
        price,
        subtotal,
      ];
    });
    const totalUnits = order.items.reduce((s, i) => s + i.quantity, 0);
    const totalFromItems = itemRows.reduce((sum, row) => sum + (Number(row[6]) || 0), 0);
    const displayTotal = order.total != null && order.total > 0 ? order.total : totalFromItems;
    const header = [
      ['Pedido', order.id],
      ['Fecha', formatOrderDate(order.date)],
      ['Cliente', customerName],
      ['Estado', order.status],
      ['Total', displayTotal],
    ];
    const totalRow = ['', '', '', '', totalUnits, '', displayTotal];
    const data = [
      ...header,
      [],
      itemHeaders,
      ...itemRows,
      totalRow,
    ];
    return XLSX.utils.aoa_to_sheet(data);
  };

  /** Exportar todos los pedidos (filtrados o todos): un archivo Excel con una hoja por pedido, cada una como planilla. */
  const exportOrdersToExcel = () => {
    const list = filteredOrders.length > 0 ? filteredOrders : orders;
    if (list.length === 0) return;
    const workbook = XLSX.utils.book_new();
    const usedNames = new Set<string>();
    list.forEach((order, index) => {
      let sheetName = safeSheetName(order);
      if (usedNames.has(sheetName)) sheetName = `${sheetName.slice(0, 28)}_${index}`.slice(0, 31);
      usedNames.add(sheetName);
      const ws = buildOrderSheet(order);
      XLSX.utils.book_append_sheet(workbook, ws, sheetName);
    });
    const filename = `pedidos_mayoristas_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, filename);
  };

  /** Exportar un solo pedido a Excel (una hoja en formato planilla). */
  const exportOneOrderToExcel = (order: Order, e: React.MouseEvent) => {
    e.stopPropagation();
    const workbook = XLSX.utils.book_new();
    const ws = buildOrderSheet(order);
    const sheetName = safeSheetName(order).slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, ws, sheetName);
    const clientNameForFile = getCustomerName(order.customerId).replace(/[\\/*?:\[\]"]/g, '').replace(/\s+/g, '_').slice(0, 40) || 'cliente';
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `pedido_${order.id}_${clientNameForFile}_${dateStr}.xlsx`);
  };

  return (
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-white">Gestión de Pedidos</h2>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={exportOrdersToExcel}
            className="w-full sm:w-auto bg-slate-700 hover:bg-slate-600 text-white px-4 py-3 rounded-2xl transition flex items-center justify-center gap-2 border border-slate-600 font-semibold active:scale-95"
          >
            <FileSpreadsheet size={20} />
            <span>Exportar a Excel</span>
          </button>
          {(role === Role.SELLER || role === Role.ADMIN || role === Role.CUSTOMER) && (
            <>
              <button
                onClick={() => onNavigate('create_order')}
                className="w-full sm:w-auto bg-blue-600 text-white px-6 py-3 rounded-2xl hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-lg shadow-blue-900/50 font-bold active:scale-95"
              >
                <Plus size={20} />
                <span>Nuevo Pedido</span>
              </button>
              <button
                onClick={() => onNavigate('create_order_template')}
                className="w-full sm:w-auto bg-slate-700 text-white px-5 py-3 rounded-2xl hover:bg-slate-600 border border-slate-600 transition flex items-center justify-center gap-2 font-bold active:scale-95"
              >
                <LayoutList size={20} />
                <span>Pedido (plantilla)</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex gap-2 overflow-x-auto touch-scroll pb-2 scrollbar-hide -mx-1 px-1 sm:mx-0 sm:px-0 touch-manipulation">
          {['ALL', ...Object.values(OrderStatus)].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status as OrderStatus | 'ALL')}
              className={`px-4 sm:px-5 py-3 sm:py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all border min-h-[44px] ${
                filterStatus === status 
                ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/30' 
                : 'bg-slate-800 text-slate-400 border-slate-700 active:bg-slate-700'
              }`}
            >
              {status === 'ALL' ? 'Todos' : status}
            </button>
          ))}
        </div>

        <div className="relative">
          <select
            value={filterCustomer}
            onChange={(e) => setFilterCustomer(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-sm rounded-xl p-3 outline-none appearance-none cursor-pointer"
          >
            <option value="ALL">Todos los Clientes</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.businessName}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4">
        {filteredOrders.map((order) => {
          const customer = customers.find(c => c.id === order.customerId);
          const totalItemsCount = order.items.reduce((acc, i) => acc + i.quantity, 0);
          const hasBackorders = order.items.some(i => i.isBackorder);
          
          return (
            <div 
              key={order.id} 
              onClick={() => canEditOrder && onEditOrder?.(order)}
              className={`bg-slate-800 rounded-2xl border border-slate-700 p-4 md:p-5 transition-all group shadow-sm active:bg-slate-750 ${canEditOrder ? 'hover:border-blue-500 cursor-pointer' : 'cursor-default'} touch-manipulation`}
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1 min-w-0 flex-1">
                  <h3 className="text-xl font-black text-white truncate">{customer?.businessName || 'Cliente desconocido'}</h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-400">#{order.id}</span>
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${getStatusColor(order.status)}`}>
                      {order.status}
                    </span>
                    {hasBackorders && (
                       <span className="bg-red-900/30 text-red-400 border border-red-800/50 px-2 py-0.5 rounded-lg text-[10px] font-black flex items-center gap-1">
                         <AlertCircle size={10} /> PENDIENTES
                       </span>
                    )}
                  </div>
                  {order.status === OrderStatus.DISPATCHED && order.pickedBy && (
                    <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <Truck size={12} />
                      Sacado por <span className="text-slate-400 font-medium">{users.find(u => u.id === order.pickedBy)?.name || order.pickedBy}</span>
                      {order.dispatchedAt && (
                        <> el {new Date(order.dispatchedAt).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => exportOneOrderToExcel(order, e)}
                    className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-700/50 transition"
                    title="Exportar este pedido a Excel"
                  >
                    <FileSpreadsheet size={16} />
                  </button>
                  {canCancelOrder(order) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); showConfirm({ title: 'Cancelar pedido', message: '¿Cancelar este pedido? Se restaurará el stock.', confirmLabel: 'Cancelar pedido', onConfirm: () => onUpdateStatus(order.id, OrderStatus.CANCELLED) }); }}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-900/20 transition"
                      title="Cancelar pedido"
                    >
                      <XCircle size={16} />
                    </button>
                  )}
                  {role === Role.ADMIN && (
                    <button
                      onClick={(e) => { e.stopPropagation(); showConfirm({ title: 'Eliminar pedido', message: '¿Eliminar pedido? Esta acción no se puede deshacer.', confirmLabel: 'Eliminar', onConfirm: () => onDeleteOrder?.(order.id) }); }}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-900/20 transition"
                      title="Eliminar pedido"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                  {canEditOrder && <ChevronRight size={20} className="text-slate-600 group-hover:text-blue-400 transition-colors" />}
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-700/50">
                <div className="text-xs text-slate-500">
                  {totalItemsCount} {totalItemsCount === 1 ? 'unidad' : 'unidades'} • {formatOrderDate(order.date)}
                </div>
                <div className="flex items-center gap-4">
                   {role === Role.WAREHOUSE && order.status !== OrderStatus.DISPATCHED && order.status !== OrderStatus.CANCELLED && (
                     <button 
                        onClick={(e) => { e.stopPropagation(); onStartPicking?.(order); }}
                        className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-blue-500 transition"
                     >
                        Picking
                     </button>
                   )}
                   <div className="text-lg font-black text-blue-400">${order.total.toLocaleString()}</div>
                </div>
              </div>
            </div>
          );
        })}

        {filteredOrders.length === 0 && (
          <div className="text-center py-20 bg-slate-900/50 rounded-3xl border-2 border-dashed border-slate-800">
             <Package size={48} className="mx-auto opacity-10 text-slate-500 mb-2" />
             <p className="text-slate-500 font-medium">No se encontraron pedidos.</p>
          </div>
        )}
      </div>
    </div>
  );
});

export default Orders;
