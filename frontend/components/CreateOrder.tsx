import React, { useState, useEffect } from 'react';
import { ArrowLeft, Save, Trash2, Plus, Search, User as UserIcon, Calendar, Package, AlertCircle, Bot, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Order, OrderStatus, Product, Customer, OrderItem, Role } from '../types';
import { api } from '../services/api';
import { labelTalle } from '../utils/tallesTango';

interface CreateOrderProps {
  products: Product[];
  customers: Customer[];
  onSave: (order: Order) => void;
  onCancel: () => void;
  sellerId?: string | null;
  initialOrder?: Order | null;
  role?: Role;
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

const CreateOrder: React.FC<CreateOrderProps> = ({ products, customers, onSave, onCancel, sellerId, initialOrder, role }) => {
  const hideStock = role === Role.SELLER || role === Role.CUSTOMER;
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
        const p = products.find(prod => prod.id === item.productId) || products.find(prod => prod.sku === (item as any).sku);
        return {
          id: `row-${Math.random()}`,
          variantId: (item as any).variantId,
          sku: p?.sku || 'N/A',
          description: p ? `${p.name}` : 'Variante',
          price: item.priceAtMoment,
          quantity: item.quantity,
          isBackorder: !!(item as any).isBackorder
        };
      });
      setRows(mappedRows);
    }
  }, [initialOrder, products]);

  const isCustomerLocked = role === Role.CUSTOMER;
  useEffect(() => {
    if (customers.length === 1 && !selectedCustomerId) setSelectedCustomerId(customers[0].id);
    if (isCustomerLocked && customers.length === 1) setSelectedCustomerId(customers[0].id);
  }, [customers, selectedCustomerId, isCustomerLocked]);

  const searchTrimmed = searchTerm.trim().toLowerCase();
  const searchWords = searchTrimmed ? searchTrimmed.split(/\s+/).filter(Boolean) : [];

  const filteredSearchProducts = React.useMemo(() => {
    if (searchWords.length === 0) {
      return products.slice(0, 30);
    }
    return products.filter(p => {
      const sku = (p.sku || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      const category = (p.category || '').toLowerCase();
      const allText = `${sku} ${name} ${category}`;
      return searchWords.every(word => allText.includes(word));
    }).slice(0, 50);
  }, [products, searchTrimmed]);

  const addItem = async (product: Product) => {
    if (isReadOnly) return;
    const existing = rows.find(r => r.sku === product.sku);
    const isBackorder = product.stock <= 0;

    if (existing) {
      updateQuantity(existing.id, existing.quantity + 1);
    } else {
      const variants = await api.getVariantsBySku(product.sku);
      if (variants.length <= 1) {
        const v = variants[0] || { variantId: '', colorName: '', sizeCode: '', colorCode: '', stock: product.stock };
        const fullCode = [product.sku, v.sizeCode, v.colorCode].filter(Boolean).join('-');
        const desc = [product.name, v.colorName || null, fullCode].filter(Boolean).join(' · ');
        setRows(prev => [...prev, {
          id: Date.now().toString(),
          variantId: v.variantId || undefined,
          sku: product.sku,
          description: desc || `${product.name} (${labelTalle(v.sizeCode || '')}) - ${v.colorName}`,
          price: product.price,
          quantity: 1,
          isBackorder: (v.stock ?? 0) <= 0
        }]);
      } else {
        setVariantSelect({ sku: product.sku, productName: product.name, price: product.price, variants });
      }
    }
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
      sellerId: initialOrder?.sellerId ?? sellerId ?? null,
      items: rows.map(r => ({
        variantId: r.variantId,
        productId: products.find(p => p.sku === r.sku)?.id,
        quantity: r.quantity,
        priceAtMoment: r.price,
        isBackorder: r.isBackorder
      })),
      total,
      status: initialOrder?.status ?? OrderStatus.CONFIRMED,
      date: orderDate
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0 space-y-4 pb-28 md:pb-0 px-2 sm:px-0 max-w-full">
      {/* Header: apilado en móvil, título truncado */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
        <button 
          onClick={onCancel} 
          className="shrink-0 w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center bg-slate-800 rounded-full hover:bg-slate-700 transition touch-manipulation" 
          aria-label="Volver"
        >
          <ArrowLeft size={20}/>
        </button>
        <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
          <h2 className="text-lg sm:text-xl font-bold text-white truncate">
            {initialOrder ? `#${String(initialOrder.id).slice(-6)}` : 'Nuevo Pedido'}
          </h2>
          {initialOrder && (
            <span className="shrink-0 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-yellow-900/40 text-yellow-300 border border-yellow-700">
              Edición
            </span>
          )}
        </div>
      </div>

      {/* Cliente: selector (bloqueado para cliente directo) */}
      <div className="bg-slate-800 p-3 sm:p-4 rounded-2xl border border-slate-700 shrink-0">
        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Cliente</label>
        {isCustomerLocked ? (
          <div className="w-full bg-slate-900/80 border border-slate-700 rounded-xl py-3.5 sm:py-3 px-3 text-sm text-white min-h-[48px] flex items-center">
            {customers.find(c => c.id === selectedCustomerId)?.businessName || customers[0]?.businessName || 'Mi cuenta'}
          </div>
        ) : (
          <select 
            disabled={!!initialOrder || isReadOnly}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3.5 sm:py-3 px-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50 text-white min-h-[48px]"
            value={selectedCustomerId}
            onChange={(e) => setSelectedCustomerId(e.target.value)}
          >
            <option value="">Seleccionar cliente...</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.businessName}</option>)}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0 touch-scroll overscroll-contain">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
           <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Detalle del pedido · {rows.length} {rows.length === 1 ? 'ítem' : 'ítems'}</h3>
           {!isReadOnly && (
             <button 
               onClick={() => setIsSearching(true)} 
               className="min-h-[48px] px-5 py-2.5 flex items-center justify-center gap-2 text-white font-bold text-sm rounded-xl bg-blue-600 hover:bg-blue-500 border border-blue-500/50 active:scale-[0.98] touch-manipulation shadow-lg shadow-blue-900/20"
             >
               <Plus size={20} strokeWidth={2.5}/> Agregar productos
             </button>
           )}
        </div>

        {rows.map(row => (
          <div 
            key={row.id} 
            className={`bg-slate-900 border rounded-2xl transition-all overflow-hidden ${row.isBackorder ? 'border-red-900/40 bg-red-950/5' : 'border-slate-800 shadow-sm'}`}
          >
            <div className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[10px] font-mono text-slate-500 truncate max-w-[180px] sm:max-w-none">{row.sku}</span>
                  {row.isBackorder && <span className="text-[8px] bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded font-black uppercase shrink-0">Faltante</span>}
                </div>
                <div className="text-sm font-bold text-white break-words line-clamp-2 sm:truncate">{row.description}</div>
                <div className="text-xs text-blue-400 mt-1 font-bold">${row.price.toLocaleString()} un.</div>
              </div>
              <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                <div className="flex items-center bg-slate-800 rounded-xl border border-slate-700 min-h-[44px]">
                  <button 
                    disabled={isReadOnly}
                    onClick={() => updateQuantity(row.id, row.quantity - 1)} 
                    className="w-11 h-11 sm:w-9 sm:h-9 flex items-center justify-center text-slate-400 disabled:opacity-20 active:scale-95 touch-manipulation"
                    aria-label="Menos"
                  >
                    -
                  </button>
                  <span className="w-8 sm:w-6 text-center font-black text-white text-sm tabular-nums">{row.quantity}</span>
                  <button 
                    disabled={isReadOnly}
                    onClick={() => updateQuantity(row.id, row.quantity + 1)} 
                    className="w-11 h-11 sm:w-9 sm:h-9 flex items-center justify-center text-slate-400 disabled:opacity-20 active:scale-95 touch-manipulation"
                    aria-label="Más"
                  >
                    +
                  </button>
                </div>
                {!isReadOnly && (
                  <button 
                    onClick={() => removeRow(row.id)} 
                    className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center text-slate-500 hover:text-red-500 active:scale-95 touch-manipulation rounded-lg"
                    aria-label="Quitar"
                  >
                    <Trash2 size={18}/>
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <button
            type="button"
            onClick={() => !isReadOnly && setIsSearching(true)}
            disabled={isReadOnly}
            className="w-full text-center py-12 sm:py-16 bg-slate-800/50 hover:bg-slate-800 rounded-2xl border-2 border-dashed border-slate-600 hover:border-blue-500/50 transition-colors disabled:opacity-50 disabled:pointer-events-none group"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-700 group-hover:bg-blue-600/20 flex items-center justify-center transition-colors">
                <Plus size={28} className="text-slate-400 group-hover:text-blue-400" strokeWidth={2} />
              </div>
              <p className="text-slate-400 group-hover:text-slate-300 font-bold">El pedido está vacío</p>
              <p className="text-slate-500 text-sm">Tocá para agregar productos</p>
            </div>
          </button>
        )}
      </div>

      {!isReadOnly && (
        <div className="fixed bottom-0 left-0 right-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:relative md:p-0 md:pb-0 bg-slate-950/95 backdrop-blur-md border-t md:border-t-0 border-slate-800 z-50">
           <div className="flex items-center justify-between mb-3 md:mb-4 px-1">
              <span className="text-slate-500 text-xs font-black uppercase tracking-widest">Subtotal</span>
              <div className="text-right">
                <span className="text-xl sm:text-2xl font-black text-green-400 tabular-nums">${total.toLocaleString()}</span>
                {rows.some(r => r.isBackorder) && <div className="text-[10px] text-red-400 font-bold uppercase mt-0.5 flex items-center justify-end gap-1"><AlertCircle size={10}/> Con pendientes</div>}
              </div>
           </div>
           <button 
             disabled={!selectedCustomerId || rows.length === 0}
             onClick={handleSave}
             className="w-full bg-blue-600 active:bg-blue-700 text-white min-h-[52px] py-3.5 sm:py-4 rounded-2xl font-black shadow-xl shadow-blue-900/40 flex items-center justify-center gap-2 disabled:opacity-30 transition-all uppercase tracking-widest text-sm sm:text-base touch-manipulation"
           >
             <Save size={20}/> {initialOrder ? 'Guardar' : 'Confirmar'}
           </button>
        </div>
      )}

      {isSearching && (
        <div className="fixed inset-0 bg-slate-950 z-[100] flex flex-col animate-fade-in pt-[env(safe-area-inset-top)] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="shrink-0 mb-3">
            <div className="flex items-center gap-2 mb-3">
              <button 
                onClick={() => setIsSearching(false)} 
                className="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition touch-manipulation" 
                aria-label="Cerrar"
              >
                <ArrowLeft size={22}/>
              </button>
              <h3 className="font-bold text-white text-lg">Agregar productos</h3>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={20}/>
              <input 
                autoFocus
                type="text" 
                placeholder="Buscar por SKU, nombre o categoría..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3.5 pl-11 pr-10 outline-none text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-xl text-base min-h-[48px]"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-slate-500 hover:text-white rounded-lg touch-manipulation"
                  aria-label="Borrar"
                >
                  <XCircle size={18}/>
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-500 mb-2 px-1 shrink-0">
            {searchTrimmed ? `${filteredSearchProducts.length} resultado(s) · Tocá un producto para agregarlo` : 'Mostrando los primeros 30. Escribí para buscar.'}
          </p>
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0 touch-scroll overscroll-contain">
            {filteredSearchProducts.map(p => (
              <button 
                key={p.id} 
                onClick={() => addItem(p)}
                className={`w-full text-left min-h-[80px] py-4 px-4 rounded-xl border transition-all flex justify-between items-center gap-4 active:scale-[0.99] hover:border-blue-500/40 touch-manipulation ${p.stock <= 0 ? 'bg-red-900/10 border-red-900/30' : 'bg-slate-800/80 border-slate-700 hover:bg-slate-800'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-xs font-mono font-bold text-blue-400 truncate max-w-[140px] sm:max-w-none">{p.sku}</span>
                    {p.category && <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded shrink-0">{p.category}</span>}
                    {p.stock <= 0 && <span className="text-[10px] bg-red-900/60 text-red-200 px-1.5 py-0.5 rounded font-semibold shrink-0">Pendiente</span>}
                  </div>
                  <div className="font-bold text-white text-sm leading-tight line-clamp-2 sm:truncate">{p.name}</div>
                  {(p.size || p.color) && <div className="text-xs text-slate-500 mt-0.5">{[p.size, p.color].filter(Boolean).join(' • ')}</div>}
                </div>
                <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                  <span className="text-sm font-black text-green-400 tabular-nums">${p.price.toLocaleString()}</span>
                  <span className={`text-[10px] font-bold ${p.stock <= 0 ? 'text-red-400' : hideStock ? 'text-slate-500' : p.stock < 20 ? 'text-yellow-500' : 'text-slate-500'}`}>
                    {p.stock <= 0 ? 'Sin stock' : hideStock ? 'Disponible' : `${p.stock} un.`}
                  </span>
                  <span className="text-blue-400 text-[10px] font-semibold mt-0.5 flex items-center gap-0.5">
                    <Plus size={12}/> Agregar
                  </span>
                </div>
              </button>
            ))}
            {filteredSearchProducts.length === 0 && (
              <div className="text-center py-12 text-slate-500">
                <Package className="mx-auto mb-2 opacity-50" size={32}/>
                <p className="font-semibold">No hay resultados</p>
                <p className="text-sm mt-1">Probá con otras palabras o otro SKU</p>
              </div>
            )}
          </div>
          <div className="pt-3 border-t border-slate-800 flex gap-2 shrink-0">
            <button
              onClick={() => setIsSearching(false)}
              className="flex-1 min-h-[48px] py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold border border-blue-500/50 active:scale-[0.99] transition touch-manipulation"
            >
              Listo {rows.length > 0 ? `(${rows.length} en el pedido)` : ''}
            </button>
          </div>
        </div>
      )}
      
      {variantSelect && (
        <div className="fixed inset-0 bg-slate-950/95 z-[110] flex flex-col pt-[env(safe-area-inset-top)] px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2 sm:gap-3 mb-4 shrink-0 min-w-0">
            <button 
              onClick={() => setVariantSelect(null)} 
              className="shrink-0 w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition touch-manipulation"
              aria-label="Volver"
            >
              <ArrowLeft size={24}/>
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-xs sm:text-sm text-slate-500">Seleccionar variante</div>
              <div className="font-bold text-white text-sm sm:text-base truncate">{variantSelect.productName}</div>
              <div className="text-[10px] font-mono text-slate-500 truncate">{variantSelect.sku}</div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0 touch-scroll overscroll-contain">
            {variantSelect.variants.map(v => (
              <button
                key={v.variantId}
                onClick={() => {
                  const fullCode = [variantSelect.sku, v.sizeCode, v.colorCode].filter(Boolean).join('-');
                  const desc = [variantSelect.productName, v.colorName, fullCode].filter(Boolean).join(' · ');
                  setRows(prev => [...prev, {
                    id: Date.now().toString(),
                    variantId: v.variantId,
                    sku: variantSelect.sku,
                    description: desc || `${variantSelect.productName} (${labelTalle(v.sizeCode)}) - ${v.colorName}`,
                    price: variantSelect.price,
                    quantity: 1,
                    isBackorder: v.stock <= 0
                  }]);
                  setVariantSelect(null);
                }}
                className={`w-full text-left min-h-[72px] py-3.5 px-3 rounded-2xl border transition-all flex justify-between items-center gap-3 active:scale-[0.98] touch-manipulation ${v.stock <= 0 ? 'bg-red-900/10 border-red-900/30' : 'bg-slate-900 border-slate-800'}`}
              >
                <div className="min-w-0">
                  <div className="text-white font-bold text-sm sm:text-base">{labelTalle(v.sizeCode)} • {v.colorName}</div>
                  <div className="text-xs text-slate-500 truncate">{variantSelect.sku}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-black text-green-500 tabular-nums">${variantSelect.price.toLocaleString()}</div>
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
