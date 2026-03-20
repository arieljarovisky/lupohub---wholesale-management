import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { getRemitente } from '../services/apiIntegration';
import { Customer, Role } from '../types';
import { FileSpreadsheet, Filter, RefreshCw, Search, Eye, Loader2 } from 'lucide-react';
import { useNotification } from '../context/NotificationContext';

interface BillingProps {
  role: Role;
  customers: Customer[];
}

const Billing: React.FC<BillingProps> = ({ role, customers }) => {
  const { showToast } = useNotification();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [desde, setDesde] = useState<string>('');
  const [hasta, setHasta] = useState<string>('');
  const [customerId, setCustomerId] = useState<string>('ALL');
  const [tipo, setTipo] = useState<'ALL' | 'FACTURA' | 'NC'>('ALL');

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getBilling({
        desde: desde || undefined,
        hasta: hasta || undefined,
        customerId: customerId !== 'ALL' ? customerId : undefined,
        tipo: tipo === 'ALL' ? undefined : tipo
      });
      setItems(data);
    } catch (err: any) {
      showToast('error', err?.message || 'Error cargando facturación');
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExport = async () => {
    try {
      await api.exportBilling({
        desde: desde || undefined,
        hasta: hasta || undefined,
        customerId: customerId !== 'ALL' ? customerId : undefined,
        tipo: tipo === 'ALL' ? undefined : tipo
      });
      showToast('success', 'Descarga iniciada');
    } catch (err: any) {
      showToast('error', err?.message || 'Error exportando facturación');
    }
  };

  const formatDate = (d: any) => {
    if (!d) return '';
    const x = new Date(d);
    return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('es-AR');
  };

  const formatTipo = (item: any) => {
    if (item.tipo === 'NC') {
      return item.cbteTipo === 3 ? 'NC A' : item.cbteTipo === 8 ? 'NC B' : 'NC';
    }
    return item.cbteTipo === 1 ? 'Factura A' : item.cbteTipo === 6 ? 'Factura B' : 'Factura';
  };

  const buildFacturaHtml = (order: any) => {
    if (!order?.invoice) return '';

    const customer = customers.find(c => c.id === order.customerId);
    const remitente = {
      businessName: 'Mi Empresa',
      address: '',
      city: '',
      email: '',
      phone: ''
    };
    const inv = order.invoice;

    const formatDateShort = (d: any) => {
      if (!d) return '';
      const x = new Date(d);
      if (Number.isNaN(x.getTime())) return String(d);
      const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      return `${String(x.getDate()).padStart(2, '0')} ${meses[x.getMonth()]} ${x.getFullYear()}`;
    };

    const formatoNumero = (n: any) => (n != null ? String(n) : '');
    const nroComprobante = inv.puntoVta != null ? `${String(inv.puntoVta).padStart(5,'0')}-${String(inv.cbteDesde).padStart(8,'0')}` : String(inv.cbteDesde);
    const fechaComprobante = inv.createdAt ? formatDateShort(inv.createdAt.split('T')[0]) : formatDateShort(order.date);
    const clienteNombre = order.customerBusinessName || customer?.businessName || customer?.name || 'Cliente';
    const baseImponible = order.total != null && order.total > 0 ? order.total : order.items.reduce((s: number, i: any) => s + i.quantity * (i.priceAtMoment ?? 0), 0);

    const despachoUnicos = Array.from(new Set(order.items.map((i: any) => (i.numeroDespacho || i.numero_despacho || '').trim()).filter(Boolean)));
    const despachoLabel = despachoUnicos.length ? despachoUnicos.join(', ') : '—';

    const rows = order.items.map((i: any) => {
      const base = i.quantity * (i.priceAtMoment ?? 0);
      const despacho = (i as any).numeroDespacho ?? (i as any).numero_despacho ?? null;
      const despachoCell = despacho != null && String(despacho).trim() ? String(despacho).trim() : '—';
      const desc = [(i.sku ?? ''), (i.productName ?? '').toString().trim(), i.sizeCode ?? '', i.colorName ?? ''].filter(Boolean).join(' — ') || '—';
      return `<tr><td>${desc}</td><td style="text-align:center">${despachoCell}</td><td style="text-align:center">${i.quantity}</td><td style="text-align:right">$${base.toLocaleString('es-AR')}</td><td style="text-align:right">—</td><td style="text-align:right">$${base.toLocaleString('es-AR')}</td></tr>`;
    }).join('');

    const vtoCae = inv.caeFchVto ? formatDateShort(inv.caeFchVto) : '—';
    const empresaDir = [remitente.address, remitente.city].filter(Boolean).join(', ') || '';
    const clienteDir = [customer?.address, customer?.city].filter(Boolean).join(', ') || '';

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Factura ${nroComprobante}</title><style>
      @page { size: A4; margin: 14mm 14mm 18mm 14mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', system-ui, sans-serif; margin: 0; padding: 24px 16px 40px; color: #000000; background: #ffffff; font-size: 13px; line-height: 1.4; }
      .inv-doc { width: 100%; max-width: 190mm; margin: 0 auto; background: #ffffff; border: 1px solid #6b99de; border-radius: 12px; padding: 28px 32px 32px; }
      .inv-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 2px solid #6b99de; }
      .inv-logo-wrap { min-height: 56px; display: flex; align-items: center; }
      .inv-logo-placeholder { font-size: 1.3rem; font-weight: 700; color: #000000; }
      .inv-meta { text-align: right; }
      .inv-meta .inv-num { font-size: 1.05rem; font-weight: 800; color: #6b99de; }
      .inv-meta .inv-fecha { font-size: 0.85rem; color: #000000; margin-top: 4px; font-weight: 700; }
      .inv-datos { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 24px; margin-bottom: 22px; padding: 14px; background: #f5f8ff; border: 1px solid #dbe7ff; border-radius: 8px; }
      .inv-datos strong { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: #000000; margin-bottom: 6px; font-weight: 700; }
      .inv-table-wrap { margin-bottom: 22px; border: 1px solid #dbe7ff; border-radius: 8px; overflow: hidden; }
      .inv-table { width: 100%; border-collapse: collapse; font-size: 0.79rem; }
      .inv-table thead { background: linear-gradient(180deg, #dbe7ff 0%, #f5f8ff 100%); }
      .inv-table th { text-align: left; padding: 11px 12px; font-weight: 700; color: #000000; border-bottom: 2px solid #6b99de; }
      .inv-table th:nth-child(2), .inv-table th:nth-child(3) { text-align: center; }
      .inv-table th:nth-child(n+4) { text-align: right; }
      .inv-table td { padding: 10px 12px; border-bottom: 1px solid #e6edff; vertical-align: middle; }
      .inv-table tbody tr:nth-child(even) td { background: #f8fbff; }
      .inv-table tbody tr:last-child td { border-bottom: none; }
      .col-c { text-align: center; color: #000000; }
      .col-r { text-align: right; }
      .inv-summary { display: flex; justify-content: flex-end; margin-bottom: 24px; }
      .inv-summary-inner { min-width: 260px; font-size: 0.88rem; border: 1px solid #dbe7ff; border-radius: 8px; overflow: hidden; }
      .inv-summary-inner .row { display: flex; justify-content: space-between; gap: 20px; padding: 10px 14px; border-bottom: 1px solid #e6edff; }
      .inv-summary-inner .row.total { font-weight: 800; font-size: 1rem; background: #eaf2ff; color: #000000; }
      .inv-footer { padding: 14px 18px; background: #f5f8ff; border: 1px solid #dbe7ff; border-radius: 8px; font-size: 0.78rem; color: #000000; }
      .inv-cae { margin-bottom: 6px; font-weight: 600; }
      .no-print { margin-top: 24px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
      .no-print button { padding: 10px 22px; font-size: 0.95rem; cursor: pointer; border: none; border-radius: 8px; font-weight: 600; }
      .no-print button:first-child { background: #6b99de; color: #ffffff; }
      .no-print button:last-child { background: #000000; color: #ffffff; }
      @media print { .no-print { display: none !important; } .inv-doc { border: none; box-shadow: none; } }
    </style></head><body>
      <div class="inv-top">
        <div class="inv-logo-wrap"><span class="inv-logo-placeholder">${(remitente.businessName||'Empresa').replace(/</g,'&lt;')}</span></div>
        <div class="inv-meta">
          <div class="inv-num">FACTURA Nº: ${nroComprobante}</div>
          <div class="inv-fecha">Fecha: ${fechaComprobante}</div>
        </div>
      </div>
      <div class="inv-datos">
        <div><strong>Datos empresa</strong>${remitente.businessName || '—'}<br>${empresaDir ? empresaDir + '<br>' : ''}${(remitente as any).cuit ? 'CUIT ' + (remitente as any).cuit + '<br>' : ''}${(remitente as any).email ? (remitente as any).email + '<br>' : ''}${(remitente as any).phone ? (remitente as any).phone : ''}</div>
        <div><strong>Datos cliente</strong>${clienteNombre}<br>${clienteDir ? clienteDir + '<br>' : ''}${customer?.cuit ? 'CUIT ' + customer.cuit + '<br>' : ''}${customer?.email ? customer.email + '<br>' : ''}${customer?.phone ? customer.phone : ''}</div>
      </div>
      <div class="inv-table-wrap">
        <table class="inv-table">
          <thead><tr><th>Producto / Descripción</th><th>Nº Despacho</th><th>Cantidad</th><th>Base</th><th>IVA</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="inv-summary"><div class="inv-summary-inner"><div class="row"><span>Base imponible</span><span>$${baseImponible.toLocaleString('es-AR')}</span></div><div class="row"><span>IVA 21%</span><span>—</span></div><div class="row"><span>Retención</span><span>—</span></div><div class="row total"><span>Total</span><span>$${baseImponible.toLocaleString('es-AR')}</span></div></div></div>
      <div class="inv-footer"><div class="inv-cae"><strong>CAE:</strong> ${inv.cae} &nbsp;&nbsp; <strong>Vto. CAE:</strong> ${vtoCae}</div><p style="font-size: 0.72rem; margin: 4px 0 0;">Consulta en afip.gob.ar con tu CUIT, fecha ${fechaComprobante} y Pto.Vta ${inv.puntoVta != null ? inv.puntoVta : ''}.</p></div>
      <div class="no-print"><button onclick="window.print()" style="padding: 10px 22px; font-size: 0.95rem; cursor: pointer; background: #1f2937; color: white; border: none; border-radius: 8px; font-weight: 600;">Descargar PDF / Imprimir</button><button onclick="window.close()" style="padding: 10px 22px; font-size: 0.95rem; cursor: pointer; background: #9ca3af; color: white; border: none; border-radius: 8px;">Cerrar</button></div>
    </body></html>`;
  };

  const buildCreditNoteHtml = (order: any, nc: any) => {
    const customer = customers.find((c) => c.id === order.customerId);
    const remitente = getRemitente();
    const items = order.items.map((i) => ({ ...i }));
    const formatDateShort = (d: any) => {
      if (!d) return '';
      const x = new Date(d);
      if (Number.isNaN(x.getTime())) return String(d);
      const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      return `${String(x.getDate()).padStart(2,'0')} ${meses[x.getMonth()]} ${x.getFullYear()}`;
    };
    const nroComprobante = nc.puntoVta != null ? `${String(nc.puntoVta).padStart(5,'0')}-${String(nc.cbteDesde).padStart(8,'0')}` : String(nc.cbteDesde);
    const fecha = nc.createdAt ? formatDateShort(nc.createdAt.split('T')[0]) : formatDateShort(order.date);
    const baseImponible = Number(nc.amountCredited || 0);
    const rows = items.map((i: any) => {
      const base = (i.quantity || 0) * (i.priceAtMoment || 0);
      const despacho = i.numeroDespacho || i.numero_despacho || null;
      const despachoCell = despacho ? String(despacho).trim() : '—';
      const desc = [(i.sku || ''), (i.productName || '').toString().trim(), i.sizeCode || '', i.colorName || ''].filter(Boolean).join(' — ') || '—';
      return `<tr><td>${desc}</td><td style="text-align:center">${despachoCell}</td><td style="text-align:center">${i.quantity}</td><td style="text-align:right">$${base.toLocaleString('es-AR')}</td><td style="text-align:right">—</td><td style="text-align:right">$${base.toLocaleString('es-AR')}</td></tr>`;
    }).join('');
    const vtoCae = nc.caeFchVto ? formatDateShort(nc.caeFchVto) : '—';
    const companyDir = [remitente.address, remitente.city].filter(Boolean).join(', ');
    const customerDir = [customer?.address, customer?.city].filter(Boolean).join(', ');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Nota de Crédito ${nroComprobante}</title><style>/* ... same CSS as factura ... */</style></head><body><div><h2>NOTA DE CRÉDITO Nº ${nroComprobante}</h2><p>Fecha: ${fecha}</p></div><div><strong>Datos cliente:</strong> ${customer?.businessName || customer?.name || ''}</div><div>...</div><table><thead><tr><th>Producto</th><th>Nº Despacho</th><th>Cantidad</th><th>Base</th><th>IVA</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><div>Total: $${baseImponible.toLocaleString('es-AR')}</div><div>CAE: ${nc.cae || '—'} Vto CAE: ${vtoCae}</div><div><button onclick="window.print()">Imprimir / Guardar PDF</button><button onclick="window.close()">Cerrar</button></div></body></html>`;
  };

  const handleVer = async (item: any) => {
    if (!item?.orderId) {
      showToast('error', 'No se encontró el pedido para este comprobante');
      return;
    }

    try {
      const orders = await api.getOrders({ includeArchived: true, orderId: item.orderId });
      const order = orders.find(o => o.id === item.orderId);
      if (!order) {
        showToast('error', 'Pedido no encontrado');
        return;
      }

      if (item.tipo === 'NC' || item.cbteTipo === 3 || item.cbteTipo === 8) {
        const notes = await api.getOrderCreditNotes(order.id);
        const nc = notes.find((n: any) => String(n.cbteDesde) === String(item.cbteDesde) && String(n.puntoVta) === String(item.puntoVta)) || notes[0];
        if (!nc) {
          showToast('error', 'No se encontró la nota de crédito correspondiente');
          return;
        }

        const html = buildCreditNoteHtml(order, nc);
        if (!html) {
          showToast('error', 'No se pudo generar la vista previa de la nota de crédito');
          return;
        }

        const w = window.open('', '_blank');
        if (w) {
          w.document.write(html);
          w.document.close();
        } else {
          showToast('error', 'No se pudo abrir la ventana de vista previa (bloqueador de popups?)');
        }

        return;
      }

      if (!order.invoice) {
        showToast('error', 'Este pedido no tiene factura AFIP');
        return;
      }

      const html = buildFacturaHtml(order);
      if (!html) {
        showToast('error', 'No se pudo generar la vista previa de factura');
        return;
      }

      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
      } else {
        showToast('error', 'No se pudo abrir la ventana de vista previa (bloqueador de popups?)');
      }
    } catch (err: any) {
      console.error('Error cargando orden para vista previa', err);
      showToast('error', err?.message || 'Error cargando vista previa de comprobante');
    }
  };

  const filteredCount = items.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Filter size={20} className="text-emerald-400" /> Facturación (AFIP)
          </h2>
          <p className="text-slate-400 text-sm">Listá todas las facturas y notas de crédito emitidas desde la app. Podés filtrar por fecha, cliente y tipo de comprobante.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 text-slate-100 text-sm font-medium border border-slate-700 hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Actualizar
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold shadow-lg shadow-emerald-900/40 hover:bg-emerald-500"
          >
            <FileSpreadsheet size={16} /> Descargar todo (CSV)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
        <div className="space-y-1">
          <label className="text-[11px] font-black text-slate-500 uppercase">Desde</label>
          <input
            type="date"
            value={desde}
            onChange={e => setDesde(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-slate-100"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-black text-slate-500 uppercase">Hasta</label>
          <input
            type="date"
            value={hasta}
            onChange={e => setHasta(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-slate-100"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-black text-slate-500 uppercase">Cliente</label>
          <select
            value={customerId}
            onChange={e => setCustomerId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-slate-100"
          >
            <option value="ALL">Todos</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.businessName || c.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-black text-slate-500 uppercase">Tipo</label>
          <select
            value={tipo}
            onChange={e => setTipo(e.target.value as any)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-sm text-slate-100"
          >
            <option value="ALL">Todos</option>
            <option value="FACTURA">Facturas</option>
            <option value="NC">Notas de crédito</option>
          </select>
        </div>
      </div>

      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Search size={14} />
            <span>{filteredCount} comprobante(s)</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-slate-100">
            <thead className="bg-slate-800/80 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Pto.Vta</th>
                <th className="px-3 py-2 text-left">Número</th>
                <th className="px-3 py-2 text-left">Pedido</th>
                <th className="px-3 py-2 text-left">Cliente</th>
                <th className="px-3 py-2 text-right">Importe</th>
                <th className="px-3 py-2 text-left">CAE</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    No hay comprobantes para los filtros seleccionados.
                  </td>
                </tr>
              )}
              {items.map((item: any) => {
                const numero = item.numeroDesde === item.numeroHasta ? item.numeroDesde : `${item.numeroDesde}-${item.numeroHasta}`;
                return (
                  <tr key={`${item.tipo}-${item.id}`} className="border-t border-slate-800/70 hover:bg-slate-800/60">
                    <td className="px-3 py-2">{formatDate(item.fecha)}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${item.tipo === 'NC' ? 'bg-amber-900/40 text-amber-300 border border-amber-700/60' : 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/60'}`}>
                        {formatTipo(item)}
                      </span>
                    </td>
                    <td className="px-3 py-2">{item.puntoVta}</td>
                    <td className="px-3 py-2">{numero}</td>
                    <td className="px-3 py-2">{item.orderId}</td>
                    <td className="px-3 py-2">{item.customerBusinessName}</td>
                    <td className="px-3 py-2 text-right">${(item.importe ?? 0).toLocaleString('es-AR')}</td>
                    <td className="px-3 py-2 text-xs">{item.cae}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleVer(item)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 text-slate-200 text-xs hover:bg-slate-700"
                        title="Ver detalle del comprobante"
                      >
                        <Eye size={14} /> Ver
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Billing;

