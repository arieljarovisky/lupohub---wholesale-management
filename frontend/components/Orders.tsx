import React, { useState, useEffect } from 'react';
import { Search, ChevronRight, CheckCircle, Clock, Truck, FileText, Bot, Plus, X, Trash2, Save, PackageCheck, Lock, Filter, Package, Edit, AlertCircle, XCircle, FileSpreadsheet, Receipt, FileMinus } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Order, OrderStatus, Role, Product, Customer, OrderItem, User, OrderInvoice, Transporte } from '../types';
import { useNotification } from '../context/NotificationContext';
import { getRemitente } from '../services/apiIntegration';
import { api } from '../services/api';

interface OrdersProps {
  orders: Order[];
  products: Product[];
  customers: Customer[];
  transportes?: Transporte[];
  users: User[];
  role: Role;
  currentUserId?: string;
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  onCreateOrder: (order: Order) => void;
  onNavigate: (view: string) => void;
  onStartPicking?: (order: Order) => void;
  onEditOrder?: (order: Order) => void;
  onDeleteOrder?: (orderId: string) => void;
  onFacturaEmitida?: (orderId: string, invoice: OrderInvoice) => void;
  onCreditNoteEmitida?: (orderId: string) => void;
}

const Orders: React.FC<OrdersProps> = React.memo(({ 
  orders, products, customers, transportes = [], users, role, 
  currentUserId, onUpdateStatus, onCreateOrder, 
  onNavigate, onStartPicking, onEditOrder, onDeleteOrder, onFacturaEmitida, onCreditNoteEmitida 
}) => {
  const { showConfirm, showToast } = useNotification();
  const [filterStatus, setFilterStatus] = useState<OrderStatus | 'ALL'>('ALL');
  const [filterCustomer, setFilterCustomer] = useState<string>('ALL');
  const [remitoOrder, setRemitoOrder] = useState<Order | null>(null);
  const [remitoTransporteName, setRemitoTransporteName] = useState<string>('');
  const [afipConfigured, setAfipConfigured] = useState(false);
  const [emitiendoFacturaId, setEmitiendoFacturaId] = useState<string | null>(null);
  const [ncOrder, setNcOrder] = useState<Order | null>(null);
  const [ncTipo, setNcTipo] = useState<'total' | 'item'>('total');
  const [ncItemIndex, setNcItemIndex] = useState(0);
  const [ncQuantity, setNcQuantity] = useState<number>(1);
  const [emitiendoNC, setEmitiendoNC] = useState(false);

  const canEmitirFactura = role === Role.ADMIN || role === Role.WAREHOUSE || role === Role.DEPOSITO;
  useEffect(() => {
    if (!canEmitirFactura) return;
    api.getAfipStatus().then(r => setAfipConfigured(r?.configured ?? false)).catch(() => setAfipConfigured(false));
  }, [canEmitirFactura]);

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

  const getCustomerName = (orderOrCustomerId: Order | string) => {
    if (typeof orderOrCustomerId === 'object' && orderOrCustomerId?.customerBusinessName) return orderOrCustomerId.customerBusinessName;
    const id = typeof orderOrCustomerId === 'string' ? orderOrCustomerId : (orderOrCustomerId as Order).customerId;
    return customers.find(c => c.id === id)?.businessName || customers.find(c => c.id === id)?.name || id;
  };

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
    const name = getCustomerName(order).replace(/[\\/*?:\[\]]/g, '').slice(0, 12);
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

  /** Abre el modal para elegir transporte y luego genera el remito. */
  const openRemitoModal = (order: Order, e: React.MouseEvent) => {
    e.stopPropagation();
    const customer = customers.find(c => c.id === order.customerId);
    const firstTransport = customer?.transportes?.[0]?.name ?? '';
    setRemitoOrder(order);
    setRemitoTransporteName(firstTransport);
  };

  /** Genera el HTML del remito y abre la ventana para imprimir. transporteName = el elegido para este envío. */
  const buildRemitoHtml = (order: Order, transporteName: string) => {
    const customer = customers.find(c => c.id === order.customerId);
    const remitente = getRemitente();
    const items = order.items.map(enrichItem);
    const formatDate = (d: string) => {
      const x = new Date(d);
      return isNaN(x.getTime()) ? d : x.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };
    const selectedTransport = customer?.transportes?.find(t => t.name === transporteName) ?? transportes.find(t => t.name === transporteName);
    const transportesStr = transporteName.trim()
      ? (selectedTransport?.address ? `${transporteName} — ${selectedTransport.address}` : transporteName)
      : '—';
    const remitenteBlock = remitente.businessName
      ? `<strong>Remitente:</strong> ${remitente.businessName}${remitente.address ? ` — ${remitente.address}` : ''}${remitente.city ? ` — ${remitente.city}` : ''}${remitente.cuit ? ` — CUIT ${remitente.cuit}` : ''}`
      : '<strong>Remitente:</strong> —';
    const destBlock = `<strong>Destinatario:</strong> ${order.customerBusinessName || customer?.businessName || customer?.name || 'Cliente'} — ${customer?.address || ''} ${customer?.city || ''} ${customer?.cuit ? ` — CUIT ${customer.cuit}` : ''}`;
    const rows = items.map(i => {
      const sub = i.quantity * (i.priceAtMoment ?? 0);
      return `<tr><td>${(i.sku ?? '')} ${(i.productName ?? '')}</td><td>${i.sizeCode ?? ''}</td><td>${i.colorName ?? ''}</td><td>${i.quantity}</td><td>${(i.priceAtMoment ?? 0).toLocaleString('es-AR')}</td><td>${sub.toLocaleString('es-AR')}</td></tr>`;
    }).join('');
    const totalUnits = order.items.reduce((s, i) => s + i.quantity, 0);
    const totalAmount = order.total != null && order.total > 0 ? order.total : items.reduce((s, i) => s + i.quantity * (i.priceAtMoment ?? 0), 0);
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Remito ${order.id}</title><style>
      body { font-family: system-ui, sans-serif; max-width: 800px; margin: 24px auto; padding: 16px; color: #111; }
      h1 { font-size: 1.5rem; margin-bottom: 8px; }
      .meta { font-size: 0.9rem; color: #444; margin-bottom: 16px; }
      .block { margin-bottom: 12px; font-size: 0.85rem; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 0.8rem; }
      th, td { border: 1px solid #333; padding: 6px 8px; text-align: left; }
      th { background: #eee; font-weight: bold; }
      .firmas { display: flex; justify-content: space-between; margin-top: 32px; font-size: 0.8rem; }
      .firma { width: 28%; text-align: center; border-top: 1px solid #333; padding-top: 4px; }
      .no-print { margin-top: 16px; }
      @media print { .no-print { display: none !important; } }
    </style></head><body>
      <h1>REMITO</h1>
      <div class="meta">Nº <strong>${order.id}</strong> — Fecha: ${formatDate(order.date)}</div>
      <div class="block">${remitenteBlock}</div>
      <div class="block">${destBlock}</div>
      <div class="block"><strong>Transporte:</strong> ${transportesStr}</div>
      <table>
        <thead><tr><th>Producto / SKU</th><th>Talle</th><th>Color</th><th>Cant.</th><th>P. unit.</th><th>Subtotal</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3"><strong>Total (${totalUnits} unidades)</strong></td><td></td><td></td><td><strong>$${totalAmount.toLocaleString('es-AR')}</strong></td></tr></tfoot>
      </table>
      <div class="firmas">
        <div class="firma">Firma remitente</div>
        <div class="firma">Firma transportista</div>
        <div class="firma">Firma receptor</div>
      </div>
      <div class="no-print"><button onclick="window.print()" style="padding: 10px 20px; font-size: 1rem; cursor: pointer; background: #2563eb; color: white; border: none; border-radius: 8px;">Imprimir / Guardar PDF</button> <button onclick="window.close()" style="padding: 10px 20px; font-size: 1rem; cursor: pointer; background: #64748b; color: white; border: none; border-radius: 8px;">Cerrar</button></div>
    </body></html>`;
  };

  const confirmRemito = () => {
    if (!remitoOrder) return;
    const html = buildRemitoHtml(remitoOrder, remitoTransporteName);
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    }
    setRemitoOrder(null);
    setRemitoTransporteName('');
  };

  /** Genera el HTML de la factura AFIP para ver e imprimir/guardar como PDF. */
  const buildFacturaHtml = (order: Order) => {
    if (!order.invoice) return '';
    const inv = order.invoice;
    const customer = customers.find(c => c.id === order.customerId);
    const remitente = getRemitente();
    const items = order.items.map(enrichItem);
    const formatDate = (d: string) => {
      const x = new Date(d);
      return isNaN(x.getTime()) ? d : x.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };
    const tipoLabel = inv.cbteTipo === 6 ? 'Factura B' : 'Factura A';
    const nroComprobante = inv.puntoVta != null ? `${inv.puntoVta}-${String(inv.cbteDesde).padStart(8, '0')}` : String(inv.cbteDesde);
    const clienteNombre = order.customerBusinessName || customer?.businessName || customer?.name || 'Cliente';
    const rows = items.map(i => {
      const sub = i.quantity * (i.priceAtMoment ?? 0);
      return `<tr><td>${(i.sku ?? '')} ${(i.productName ?? '')}</td><td>${i.sizeCode ?? ''}</td><td>${i.colorName ?? ''}</td><td style="text-align:right">${i.quantity}</td><td style="text-align:right">${(i.priceAtMoment ?? 0).toLocaleString('es-AR')}</td><td style="text-align:right">${sub.toLocaleString('es-AR')}</td></tr>`;
    }).join('');
    const total = order.total != null && order.total > 0 ? order.total : items.reduce((s, i) => s + i.quantity * (i.priceAtMoment ?? 0), 0);
    const vtoCae = inv.caeFchVto ? formatDate(inv.caeFchVto) : '—';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${tipoLabel} ${nroComprobante}</title><style>
      body { font-family: system-ui, sans-serif; max-width: 700px; margin: 24px auto; padding: 20px; color: #111; }
      h1 { font-size: 1.4rem; margin-bottom: 4px; }
      .sub { font-size: 0.85rem; color: #444; margin-bottom: 16px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; font-size: 0.85rem; }
      .block { margin-bottom: 8px; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 0.8rem; }
      th, td { border: 1px solid #333; padding: 6px 8px; text-align: left; }
      th { background: #eee; font-weight: bold; }
      .cae-block { margin-top: 20px; padding: 12px; background: #f5f5f5; font-size: 0.8rem; }
      .no-print { margin-top: 20px; }
      @media print { .no-print { display: none !important; } }
    </style></head><body>
      <h1>${tipoLabel}</h1>
      <div class="sub">Nº <strong>${nroComprobante}</strong> — Fecha: ${formatDate(order.date)} — Pedido ${order.id}</div>
      <div class="grid">
        <div><strong>Emisor</strong><br>${remitente.businessName || '—'}${remitente.cuit ? `<br>CUIT ${remitente.cuit}` : ''}${remitente.address ? `<br>${remitente.address}` : ''}${remitente.city ? `, ${remitente.city}` : ''}</div>
        <div><strong>Cliente</strong><br>${clienteNombre}${customer?.cuit ? `<br>CUIT ${customer.cuit}` : ''}${customer?.address ? `<br>${customer.address}` : ''}${customer?.city ? `, ${customer.city}` : ''}</div>
      </div>
      <table>
        <thead><tr><th>Producto / SKU</th><th>Talle</th><th>Color</th><th style="text-align:right">Cant.</th><th style="text-align:right">P. unit.</th><th style="text-align:right">Subtotal</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="4"><strong>Total</strong></td><td></td><td style="text-align:right"><strong>$${total.toLocaleString('es-AR')}</strong></td></tr></tfoot>
      </table>
      <div class="cae-block"><strong>CAE:</strong> ${inv.cae} &nbsp;|&nbsp; <strong>Vto. CAE:</strong> ${vtoCae}</div>
      <p class="no-print" style="font-size: 0.75rem; color: #666; margin-top: 12px;">Para ver este comprobante en afip.gob.ar: Consulta por CUIT con <strong>fecha ${formatDate(order.date)}</strong>, tu CUIT y Pto.Vta ${inv.puntoVta != null ? inv.puntoVta : ''}. Si en la app facturás en homologación, entrá al <strong>ambiente de homologación</strong> de AFIP para consultar.</p>
      <div class="no-print"><button onclick="window.print()" style="padding: 10px 20px; font-size: 1rem; cursor: pointer; background: #059669; color: white; border: none; border-radius: 8px;">Descargar PDF / Imprimir</button> &nbsp; <button onclick="window.close()" style="padding: 10px 20px; font-size: 1rem; cursor: pointer; background: #64748b; color: white; border: none; border-radius: 8px;">Cerrar</button></div>
    </body></html>`;
  };

  const openFactura = (order: Order, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!order.invoice) return;
    const html = buildFacturaHtml(order);
    if (!html) return;
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  };

  /** Genera una hoja en formato planilla para un pedido: encabezado (Pedido, Fecha, Cliente, Estado, Total) + tabla de ítems, igual que la plantilla en la web. */
  const buildOrderSheet = (order: Order) => {
    const customerName = getCustomerName(order);
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
    const clientNameForFile = getCustomerName(order).replace(/[\\/*?:\[\]"]/g, '').replace(/\s+/g, '_').slice(0, 40) || 'cliente';
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
            <button
              onClick={() => onNavigate('create_order')}
              className="w-full sm:w-auto bg-blue-600 text-white px-6 py-3 rounded-2xl hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-lg shadow-blue-900/50 font-bold active:scale-95"
            >
              <Plus size={20} />
              <span>Nuevo Pedido</span>
            </button>
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
              <option key={c.id} value={c.id}>{c.businessName || c.name || 'Cliente'}</option>
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
                  <h3 className="text-xl font-black text-white truncate">{order.customerBusinessName || customer?.businessName || customer?.name || 'Cliente desconocido'}</h3>
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
                    {order.invoice && (
                      <span
                        className="bg-emerald-900/30 text-emerald-300 border border-emerald-800/50 px-2 py-0.5 rounded-lg text-[10px] font-black flex items-center gap-1 cursor-help"
                        title={
                          [
                            'Factura real AFIP.',
                            `CAE: ${order.invoice.cae}`,
                            order.invoice.puntoVta != null ? `Nº: ${order.invoice.puntoVta}-${order.invoice.cbteDesde}` : `Nº: ${order.invoice.cbteDesde}`,
                            order.invoice.caeFchVto ? `Vto. CAE: ${new Date(order.invoice.caeFchVto).toLocaleDateString('es-AR')}` : '',
                            'Verificá en afip.gob.ar (Consulta de CUIT / comprobantes) con tu CUIT y este CAE.'
                          ].filter(Boolean).join('\n')
                        }
                      >
                        <Receipt size={10} /> FACTURADO
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
                  {afipConfigured && canEmitirFactura && !order.invoice && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEmitiendoFacturaId(order.id);
                        api.emitirFactura(order.id)
                          .then((res) => {
                            onFacturaEmitida?.(order.id, { cae: res.cae, caeFchVto: res.caeFchVto, cbteDesde: res.cbteDesde, cbteHasta: res.cbteHasta, cbteTipo: res.cbteTipo });
                            showToast('success', `Factura emitida. CAE ${res.cae}`);
                          })
                          .catch((err: any) => showToast('error', err?.message || err?.response?.data?.message || 'Error emitiendo factura'))
                          .finally(() => setEmitiendoFacturaId(null));
                      }}
                      disabled={!!emitiendoFacturaId}
                      className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-700/50 transition disabled:opacity-50"
                      title="Emitir factura AFIP"
                    >
                      {emitiendoFacturaId === order.id ? <Clock size={16} className="animate-pulse" /> : <Receipt size={16} />}
                    </button>
                  )}
                  <button
                    onClick={(e) => openRemitoModal(order, e)}
                    className="p-2 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-700/50 transition"
                    title="Generar remito"
                  >
                    <FileText size={16} />
                  </button>
                  {order.invoice && (
                    <button
                      onClick={(e) => openFactura(order, e)}
                      className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-700/50 transition"
                      title="Ver factura / Descargar PDF"
                    >
                      <Receipt size={16} />
                    </button>
                  )}
                  {order.invoice && afipConfigured && canEmitirFactura && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setNcOrder(order);
                        setNcTipo('total');
                        setNcItemIndex(0);
                        setNcQuantity(order.items[0]?.quantity ?? 1);
                      }}
                      className="p-2 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-700/50 transition"
                      title="Emitir nota de crédito"
                    >
                      <FileMinus size={16} />
                    </button>
                  )}
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
                   {(role === Role.WAREHOUSE || role === Role.DEPOSITO) && order.status !== OrderStatus.DISPATCHED && order.status !== OrderStatus.CANCELLED && (
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

      {/* Modal: elegir transporte para el remito */}
      {remitoOrder && (() => {
        const customer = customers.find(c => c.id === remitoOrder.customerId);
        const transportesDelCliente = customer?.transportes ?? [];
        const transportesOpciones = transportesDelCliente.length > 0 ? transportesDelCliente : transportes;
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setRemitoOrder(null); setRemitoTransporteName(''); }}>
            <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white mb-1">Generar remito</h3>
              <p className="text-sm text-slate-400 mb-4">Pedido #{remitoOrder.id} — {remitoOrder.customerBusinessName || customer?.businessName || customer?.name || 'Cliente'}</p>
              <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">Transporte para este envío</label>
              <select
                value={remitoTransporteName}
                onChange={(e) => setRemitoTransporteName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-amber-500 outline-none mb-6"
              >
                <option value="">— No especificado</option>
                {transportesOpciones.map(t => (
                  <option key={t.id} value={t.name}>{t.name}{t.address ? ` — ${t.address}` : ''}</option>
                ))}
              </select>
              {transportesOpciones.length === 0 && (
                <p className="text-amber-500/90 text-xs mb-2">No hay transportes cargados. Agregá al menos uno en Configuración → Transportes y opcionalmente asignálos al cliente en Clientes.</p>
              )}
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => { setRemitoOrder(null); setRemitoTransporteName(''); }} className="px-4 py-2.5 rounded-xl font-semibold text-slate-400 hover:bg-slate-700 transition">Cancelar</button>
                <button type="button" onClick={confirmRemito} className="px-5 py-2.5 rounded-xl font-bold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-2 transition">
                  <FileText size={18} /> Generar remito
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal: emitir nota de crédito (todo el pedido o un artículo) */}
      {ncOrder && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !emitiendoNC && setNcOrder(null)}>
          <div className="bg-slate-800 rounded-2xl border border-slate-700 shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">Emitir nota de crédito</h3>
            <p className="text-sm text-slate-400 mb-4">
              Pedido #{ncOrder.id} — {ncOrder.customerBusinessName || getCustomerName(ncOrder)}
            </p>
            <div className="space-y-4 mb-6">
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="ncTipo" checked={ncTipo === 'total'} onChange={() => setNcTipo('total')} className="rounded border-slate-500 text-amber-500" />
                  <span className="text-white">Todo el pedido</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="ncTipo" checked={ncTipo === 'item'} onChange={() => setNcTipo('item')} className="rounded border-slate-500 text-amber-500" />
                  <span className="text-white">Un artículo</span>
                </label>
              </div>
              {ncTipo === 'item' && ncOrder.items.length > 0 && (
                <div className="space-y-3 pl-1">
                  <label className="block text-xs font-semibold text-slate-400 uppercase">Artículo</label>
                  <select
                    value={ncItemIndex}
                    onChange={(e) => {
                      const i = parseInt(e.target.value, 10);
                      setNcItemIndex(i);
                      setNcQuantity(ncOrder.items[i]?.quantity ?? 1);
                    }}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-amber-500 outline-none"
                  >
                    {ncOrder.items.map((item, i) => {
                      const en = enrichItem(item);
                      const label = [en.productName ?? en.sku ?? 'Ítem', en.sizeCode, en.colorName].filter(Boolean).join(' · ') || `Ítem ${i + 1}`;
                      return <option key={i} value={i}>{label} — {item.quantity} u × ${Number(item.priceAtMoment).toLocaleString()}</option>;
                    })}
                  </select>
                  <label className="block text-xs font-semibold text-slate-400 uppercase">Cantidad a creditar</label>
                  <input
                    type="number"
                    min={1}
                    max={ncOrder.items[ncItemIndex]?.quantity ?? 1}
                    value={ncQuantity}
                    onChange={(e) => setNcQuantity(Math.max(1, Math.min(ncOrder.items[ncItemIndex]?.quantity ?? 1, parseInt(e.target.value, 10) || 1)))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl p-3 text-white focus:ring-2 focus:ring-amber-500 outline-none"
                  />
                  <p className="text-xs text-slate-500">
                    Monto a creditar: ${((ncQuantity * Number(ncOrder.items[ncItemIndex]?.priceAtMoment ?? 0))).toLocaleString()}
                  </p>
                </div>
              )}
              {ncTipo === 'total' && (
                <p className="text-sm text-slate-500">Se emitirá una NC por el total del pedido: <strong className="text-white">${ncOrder.total.toLocaleString()}</strong></p>
              )}
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setNcOrder(null)} disabled={emitiendoNC} className="px-4 py-2.5 rounded-xl font-semibold text-slate-400 hover:bg-slate-700 transition disabled:opacity-50">Cancelar</button>
              <button
                type="button"
                disabled={emitiendoNC}
                onClick={async () => {
                  if (!ncOrder) return;
                  setEmitiendoNC(true);
                  try {
                    const payload: { tipo: 'total' | 'item'; itemIndex?: number; quantity?: number } = { tipo: ncTipo };
                    if (ncTipo === 'item') {
                      payload.itemIndex = ncItemIndex;
                      payload.quantity = ncQuantity;
                    }
                    const res = await api.emitirNotaCredito(ncOrder.id, payload);
                    showToast('success', `Nota de crédito emitida. CAE ${res.cae}`);
                    onCreditNoteEmitida?.(ncOrder.id);
                    setNcOrder(null);
                  } catch (err: any) {
                    showToast('error', err?.message || err?.response?.data?.message || 'Error emitiendo nota de crédito');
                  } finally {
                    setEmitiendoNC(false);
                  }
                }}
                className="px-5 py-2.5 rounded-xl font-bold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-2 transition disabled:opacity-50"
              >
                {emitiendoNC ? <Clock size={18} className="animate-pulse" /> : <FileMinus size={18} />}
                {emitiendoNC ? 'Emitiendo…' : 'Emitir nota de crédito'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default Orders;
