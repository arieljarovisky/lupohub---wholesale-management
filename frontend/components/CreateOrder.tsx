import React, { useState, useEffect } from 'react';
import { ArrowLeft, Save, Trash2, Plus, Search, User as UserIcon, Calendar, Package, AlertCircle, Bot, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Order, OrderStatus, Product, Customer, OrderItem, Role } from '../types';
import { api } from '../services/api';

interface CreateOrderProps {
  products: Product[];
  customers: Customer[];
  onSave: (order: Order) => void;
  onCancel: () => void;
  sellerId: string;
  initialOrder?: Order | null;
}

interface OrderRow {
  id: string;
  variantId?: string;
  productId?: string;
  sku: string;
  description: string;
  price: number;
  quantity: number;
  isBackorder: boolean;
}

const CreateOrder: React.FC<CreateOrderProps> = ({ products, customers, onSave, onCancel, sellerId, initialOrder }) => {
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [variantSelect, setVariantSelect] = useState<{ sku: string; productName: string; price: number; variants: Array<{ variantId: string; colorCode: string; colorName: string; sizeCode: string; stock: number }> } | null>(null);

  const isReadOnly = initialOrder?.status === OrderStatus.DISPATCHED;

  useEffect(() => {
    if (initialOrder) {
      setSelectedCustomerId(initialOrder.customerId);
      setOrderDate(initialOrder.date);
      const mappedRows = initialOrder.items.map(item => {
        const p = products.find(prod => prod.sku === (item as any).sku) || products[0];
        return {
          id: `row-${Math.random()}`,
          variantId: (item as any).variantId,
          sku: p?.sku || 'N/A',
          description: p ? `${p.name}` : 'Variante',
          price: item.priceAtMoment,
          quantity: item.quantity,
          isBackorder: !!item.isBackorder
        };
      });
      setRows(mappedRows);
    }
  }, [initialOrder, products]);

  const filteredSearchProducts = products.filter(p => 
    p.sku.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  ).slice(0, 10);

const addItem = async (product: Product) => {
    if (isReadOnly) return;
    const existing = rows.find(r => r.sku === product.sku);
    const isBackorder = product.stock <= 0;

    if (existing) {
      updateQuantity(existing.id, existing.quantity + 1);
    } else {
      const variants = await api.getVariantsBySku(product.sku);
      if (variants.length <= 1) {
        const v = variants[0] || { variantId: '', colorName: '', sizeCode: '', stock: product.stock };
        setRows([...rows, {
          id: Date.now().toString(),
          variantId: v.variantId || undefined,
          sku: product.sku,
          description: `${product.name}${v.sizeCode ? ' (' + v.sizeCode + ')' : ''}${v.colorName ? ' - ' + v.colorName : ''}`,
          price: product.price,
          quantity: 1,
          isBackorder: (v.stock ?? 0) <= 0
        }]);
      } else {
        setVariantSelect({ sku: product.sku, productName: product.name, price: product.price, variants });
      }
    }
    setIsSearching(false);
    setSearchTerm('');
  };

  const removeRow = (id: string) => {
    if (isReadOnly) return;
    setRows(rows.filter(r => r.id !== id));
  };

  const updateQuantity = (id: string, qty: number) => {
    if (isReadOnly) return;
    setRows(rows.map(r => r.id === id ? { ...r, quantity: Math.max(1, qty) } : r));
  };

  const total = rows.reduce((acc, r) => acc + (r.price * r.quantity), 0);

  const handleSave = () => {
    if (!selectedCustomerId || rows.length === 0 || isReadOnly) return;
    onSave({
      id: initialOrder?.id || `O-${Date.now().toString().slice(-6)}`,
      customerId: selectedCustomerId,
      sellerId: initialOrder?.sellerId || sellerId,
      items: rows.map(r => ({
        variantId: r.variantId as any,
        quantity: r.quantity,
        priceAtMoment: r.price,
        isBackorder: r.isBackorder
      })),
      total,
      status: initialOrder?.status || OrderStatus.CONFIRMED,
      date: orderDate
    });
  };

  return (
    <div className="flex flex-col h-full space-y-4 pb-24 md:pb-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700 transition"><ArrowLeft size={20}/></button>
          <h2 className="text-xl font-bold">{initialOrder ? `Pedido #${initialOrder.id}` : 'Nuevo Pedido'}</h2>
          {initialOrder && (
            <span className="ml-2 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest bg-yellow-900/40 text-yellow-300 border border-yellow-700">
              Modo edición
            </span>
          )}
        </div>
      </div>

      <div className="bg-slate-800 p-4 rounded-2xl border border-slate-700 space-y-4">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Cliente</label>
          <select 
            disabled={!!initialOrder || isReadOnly}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50 text-white"
            value={selectedCustomerId}
            onChange={(e) => setSelectedCustomerId(e.target.value)}
          >
            <option value="">Seleccionar cliente...</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.businessName}</option>)}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        <div className="flex justify-between items-center mb-2 px-1">
           <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Detalle del Pedido ({rows.length})</h3>
           {!isReadOnly && (
             <button onClick={() => setIsSearching(true)} className="flex items-center gap-1 text-blue-400 font-bold text-sm">
               <Plus size={16}/> Agregar Producto
             </button>
           )}
        </div>

        {rows.map(row => (
          <div key={row.id} className={`bg-slate-900 border p-4 rounded-2xl flex items-center justify-between gap-4 transition-all ${row.isBackorder ? 'border-red-900/40 bg-red-950/5' : 'border-slate-800 shadow-sm'}`}>
             <div className="flex-1 min-w-0">
               <div className="flex items-center gap-2 mb-0.5">
                 <div className="text-[10px] font-mono text-slate-500 truncate">{row.sku}</div>
                 {row.isBackorder && <span className="text-[8px] bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded font-black uppercase">Faltante</span>}
               </div>
               <div className="text-sm font-bold text-white truncate">{row.description}</div>
               <div className="text-xs text-blue-400 mt-1 font-bold">${row.price.toLocaleString()} un.</div>
             </div>
             <div className="flex flex-col items-end gap-2 shrink-0">
                <div className="flex items-center gap-3 bg-slate-800 rounded-xl p-1 border border-slate-700">
                  <button 
                    disabled={isReadOnly}
                    onClick={() => updateQuantity(row.id, row.quantity - 1)} 
                    className="w-8 h-8 flex items-center justify-center text-slate-400 disabled:opacity-20 active:scale-90">-</button>
                  <span className="w-6 text-center font-black text-white text-sm">{row.quantity}</span>
                  <button 
                    disabled={isReadOnly}
                    onClick={() => updateQuantity(row.id, row.quantity + 1)} 
                    className="w-8 h-8 flex items-center justify-center text-slate-400 disabled:opacity-20 active:scale-90">+</button>
                </div>
                {!isReadOnly && (
                  <button onClick={() => removeRow(row.id)} className="text-slate-600 hover:text-red-500 p-1 transition-colors">
                    <Trash2 size={16}/>
                  </button>
                )}
             </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="text-center py-20 bg-slate-900/30 rounded-3xl border-2 border-dashed border-slate-800">
            <Package size={48} className="mx-auto text-slate-800 mb-4 opacity-50" />
            <p className="text-slate-500 text-sm font-bold uppercase tracking-widest">El pedido está vacío</p>
          </div>
        )}
      </div>

      {!isReadOnly && (
        <div className="fixed bottom-0 left-0 right-0 p-4 md:relative md:p-0 bg-slate-950/90 backdrop-blur-md border-t md:border-t-0 border-slate-800 z-50">
           <div className="flex items-center justify-between mb-4 px-2">
              <span className="text-slate-500 text-xs font-black uppercase tracking-widest">Subtotal Estimado</span>
              <div className="text-right">
                <span className="text-2xl font-black text-green-400">${total.toLocaleString()}</span>
                {rows.some(r => r.isBackorder) && <div className="text-[10px] text-red-400 font-bold uppercase mt-1 flex items-center justify-end gap-1"><AlertCircle size={10}/> Con Pendientes</div>}
              </div>
           </div>
           <button 
             disabled={!selectedCustomerId || rows.length === 0}
             onClick={handleSave}
             className="w-full bg-blue-600 active:bg-blue-700 text-white py-4 rounded-2xl font-black shadow-xl shadow-blue-900/40 flex items-center justify-center gap-2 disabled:opacity-30 transition-all uppercase tracking-widest"
           >
             <Save size={20}/> {initialOrder ? 'Guardar Cambios' : 'Confirmar Pedido'}
           </button>
        </div>
      )}

      {isSearching && (
        <div className="fixed inset-0 bg-slate-950 z-[100] p-4 flex flex-col animate-fade-in">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => setIsSearching(false)} className="p-2 text-slate-400"><ArrowLeft size={24}/></button>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18}/>
              <input 
                autoFocus
                type="text" 
                placeholder="SKU o nombre de modelo..." 
                className="w-full bg-slate-900 border border-slate-700 rounded-xl py-4 pl-10 pr-4 outline-none text-white focus:ring-2 focus:ring-blue-500 shadow-xl"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 pb-20">
            {filteredSearchProducts.map(p => (
              <button 
                key={p.id} 
                onClick={() => addItem(p)}
                className={`w-full text-left p-4 rounded-2xl border transition-all flex justify-between items-center active:scale-[0.98] ${p.stock <= 0 ? 'bg-red-900/10 border-red-900/30' : 'bg-slate-900 border-slate-800'}`}
              >
                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-[10px] text-blue-500 font-bold font-mono uppercase">{p.sku}</div>
                    {p.stock <= 0 && <span className="text-[8px] bg-red-900 text-red-200 px-1.5 py-0.5 rounded uppercase font-black">Pendiente</span>}
                  </div>
                  <div className="font-bold text-white text-sm truncate">{p.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{p.size} • {p.color}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-black text-green-500 mb-1">${p.price.toLocaleString()}</div>
                  <div className={`flex items-center justify-end gap-1.5 text-[10px] font-black uppercase tracking-tighter ${p.stock <= 0 ? 'text-red-400' : p.stock < 20 ? 'text-yellow-500' : 'text-slate-600'}`}>
                    {p.stock <= 0 ? (
                      <><XCircle size={10} /> Agotado</>
                    ) : (
                      <><CheckCircle2 size={10} /> En Stock</>
                    )}
                  </div>
                </div>
              </button>
            ))}
            {filteredSearchProducts.length === 0 && (
              <div className="text-center py-10 text-slate-700 text-sm font-bold uppercase tracking-widest">No hay resultados</div>
            )}
          </div>
        </div>
      )}
      
      {variantSelect && (
        <div className="fixed inset-0 bg-slate-950/90 z-[110] p-6 flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => setVariantSelect(null)} className="p-2 text-slate-400"><ArrowLeft size={24}/></button>
            <div>
              <div className="text-sm text-slate-500">Seleccionar variante</div>
              <div className="font-bold text-white">{variantSelect.productName} • {variantSelect.sku}</div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2">
            {variantSelect.variants.map(v => (
              <button
                key={v.variantId}
                onClick={() => {
                  setRows(prev => [...prev, {
                    id: Date.now().toString(),
                    variantId: v.variantId,
                    sku: variantSelect.sku,
                    description: `${variantSelect.productName} (${v.sizeCode}) - ${v.colorName}`,
                    price: variantSelect.price,
                    quantity: 1,
                    isBackorder: v.stock <= 0
                  }]);
                  setVariantSelect(null);
                }}
                className={`w-full text-left p-4 rounded-2xl border transition-all flex justify-between items-center active:scale-[0.98] ${v.stock <= 0 ? 'bg-red-900/10 border-red-900/30' : 'bg-slate-900 border-slate-800'}`}
              >
                <div>
                  <div className="text-white font-bold">{v.sizeCode} • {v.colorName}</div>
                  <div className="text-xs text-slate-500">{variantSelect.sku}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-black text-green-500 mb-1">${variantSelect.price.toLocaleString()}</div>
                  <div className={`flex items-center justify-end gap-1.5 text-[10px] font-black uppercase tracking-tighter ${v.stock <= 0 ? 'text-red-400' : v.stock < 20 ? 'text-yellow-500' : 'text-slate-600'}`}>
                    {v.stock <= 0 ? (<><XCircle size={10} /> Agotado</>) : (<><CheckCircle2 size={10} /> En Stock</>)}
                  </div>
                </div>
              </button>
            ))}
            {variantSelect.variants.length === 0 && (
              <div className="text-center py-10 text-slate-700 text-sm font-bold uppercase tracking-widest">Sin variantes</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CreateOrder;
