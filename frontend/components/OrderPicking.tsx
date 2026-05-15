import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  Package,
  AlertTriangle,
  Save,
  Lock,
  User,
  Check,
  PackageCheck,
  Clock,
  ListChecks,
  Undo2,
} from 'lucide-react';
import { Order, OrderItem, Product, User as UserType } from '../types';
import { getWholesaleStockImpactMeta } from '../utils/orderStockImpact';

interface OrderPickingProps {
  order: Order;
  products: Product[];
  currentUserId: string;
  users: UserType[];
  onFinishPicking: (orderId: string, updatedItems: OrderItem[]) => void;
  onCancel: () => void;
}

const OrderPicking: React.FC<OrderPickingProps> = ({
  order,
  products,
  currentUserId,
  users,
  onFinishPicking,
  onCancel,
}) => {
  const [items, setItems] = useState<OrderItem[]>(order.items);

  const pickedByOther = order.pickedBy && order.pickedBy !== currentUserId;
  const isReadOnly = pickedByOther;
  const pickedByUser = users.find((u) => u.id === order.pickedBy);

  useEffect(() => {
    setItems(order.items.map((i) => ({ ...i, picked: i.picked ?? 0 })));
  }, [order]);

  const itemKey = (item: OrderItem) => item.variantId || item.productId || '';

  const toggleItemComplete = (key: string) => {
    if (isReadOnly) return;
    setItems((prev) =>
      prev.map((item) => {
        if (itemKey(item) === key) {
          const newPicked = item.picked === item.quantity ? 0 : item.quantity;
          return { ...item, picked: newPicked };
        }
        return item;
      })
    );
  };

  const updatePickedQuantity = (key: string, qty: number) => {
    if (isReadOnly) return;
    setItems((prev) =>
      prev.map((item) => {
        if (itemKey(item) === key) {
          return { ...item, picked: Math.min(Math.max(0, qty), item.quantity) };
        }
        return item;
      })
    );
  };

  const markAllPicked = useCallback(
    (toFull: boolean) => {
      if (isReadOnly) return;
      setItems((prev) => prev.map((i) => ({ ...i, picked: toFull ? i.quantity : 0 })));
    },
    [isReadOnly]
  );

  const totalOrdered = useMemo(() => items.reduce((acc, i) => acc + i.quantity, 0), [items]);
  const totalPicked = useMemo(() => items.reduce((acc, i) => acc + (i.picked || 0), 0), [items]);
  const netoPicked = useMemo(
    () =>
      Math.round(
        items.reduce((s, i) => s + (i.picked || 0) * (Number(i.priceAtMoment) || 0), 0) * 100
      ) / 100,
    [items]
  );

  const progress =
    totalOrdered > 0 ? Math.round((totalPicked / totalOrdered) * 100) : 0;
  const isComplete = progress === 100;
  const stockImpact = getWholesaleStockImpactMeta(order);

  return (
    <div className="bg-slate-950 md:bg-slate-900 min-h-[calc(100vh-100px)] rounded-3xl md:border md:border-slate-700 flex flex-col shadow-2xl animate-fade-in relative">
      <div className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-700 p-4 rounded-t-3xl shadow-lg">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={onCancel}
                className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-300 transition shrink-0 active:scale-95"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-black text-white leading-tight truncate">Pedido #{order.id}</h2>
                  {isReadOnly && <Lock size={14} className="text-amber-400 shrink-0" />}
                </div>
                {order.pickedBy && (
                  <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                    <User size={10} /> {pickedByUser?.name || order.pickedBy}
                  </div>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className={`text-2xl font-black tabular-nums ${isComplete ? 'text-emerald-400' : 'text-sky-400'}`}>
                {progress}%
              </span>
              <div className="text-[9px] uppercase font-bold text-slate-500 -mt-0.5">del pedido</div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/80 bg-slate-800/50 px-3 py-2.5">
            <p className="text-[11px] text-slate-300 leading-snug">
              <span className="font-bold text-sky-300">Picking:</span> indicá cuánto sale del depósito. Esa cantidad es
              la que se descuenta de stock, la que conviene en remito y la base del neto en la{' '}
              <span className="font-semibold text-white">factura AFIP</span> (no se factura lo no pickeado).
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-[11px]">
            <div className="flex-1 min-w-[140px] rounded-lg bg-slate-800/80 border border-slate-600/60 px-2.5 py-1.5">
              <span className="text-slate-500 font-bold uppercase tracking-wide">Pickeado</span>
              <div className="text-white font-black tabular-nums">
                {totalPicked} <span className="text-slate-500 font-semibold text-xs">/ {totalOrdered} u.</span>
              </div>
            </div>
            <div className="flex-1 min-w-[140px] rounded-lg bg-slate-800/80 border border-slate-600/60 px-2.5 py-1.5">
              <span className="text-slate-500 font-bold uppercase tracking-wide">Neto pickeado</span>
              <div className="text-emerald-300 font-black tabular-nums">${netoPicked.toLocaleString('es-AR')}</div>
            </div>
          </div>

          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ease-out ${isComplete ? 'bg-emerald-500' : 'bg-sky-500'}`}
              style={{ width: `${progress}%` }}
            />
          </div>

          {stockImpact.label && (
            <div
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold ${stockImpact.badgeClassName}`}
              title={stockImpact.title}
            >
              {stockImpact.variant === 'no_impact' && <Package size={14} className="shrink-0" />}
              {stockImpact.variant === 'pending' && <Clock size={14} className="shrink-0" />}
              {stockImpact.variant === 'deducted' && <PackageCheck size={14} className="shrink-0" />}
              {stockImpact.variant === 'not_applied' && <AlertTriangle size={14} className="shrink-0" />}
              <span className="leading-tight">{stockImpact.label}</span>
            </div>
          )}

          {!isReadOnly && (
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex gap-2 flex-1">
                <button
                  type="button"
                  onClick={() => markAllPicked(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-600 bg-slate-800/90 text-slate-200 text-xs font-bold hover:bg-slate-700 transition active:scale-[0.98]"
                >
                  <ListChecks size={16} className="text-sky-400" />
                  Todo el pedido
                </button>
                <button
                  type="button"
                  onClick={() => markAllPicked(false)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-slate-600 bg-slate-800/90 text-slate-200 text-xs font-bold hover:bg-slate-700 transition active:scale-[0.98]"
                >
                  <Undo2 size={16} className="text-slate-400" />
                  Limpiar
                </button>
              </div>
              <button
                type="button"
                onClick={() => onFinishPicking(order.id, items)}
                className={`sm:min-w-[200px] py-3.5 rounded-xl font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98] ${
                  isComplete
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                    : 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-900/30'
                }`}
              >
                <Save size={18} />
                <span className="text-center leading-tight">
                  {isComplete ? 'Guardar y pasar a control' : 'Guardar picking (parcial OK)'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="p-3 md:p-6 space-y-3 pb-28 md:pb-8 overflow-y-auto flex-1">
        {items.map((item, lineIdx) => {
          const product =
            products.find((p) => p.id === item.productId) ??
            products.find((p) => (p as any).product_id === item.productId);
          const displaySku = (item as any).sku ?? product?.sku ?? 'Variante';
          const displayName = (item as any).productName ?? product?.name ?? `Ítem (${item.quantity} un.)`;
          const displaySize = (item as any).sizeCode ?? product?.size ?? '';
          const displayColor = (item as any).colorName ?? product?.color ?? '';
          const key = itemKey(item);
          const isFullyPicked = item.picked === item.quantity;
          const isPartial = (item.picked || 0) > 0 && (item.picked || 0) < item.quantity;

          return (
            <div
              key={`${key}-${lineIdx}`}
              className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                isFullyPicked
                  ? 'bg-slate-900/40 border-emerald-900/35 ring-1 ring-emerald-900/20'
                  : 'bg-slate-800 border-slate-700 shadow-md'
              }`}
            >
              <div className="flex flex-col md:flex-row">
                <div
                  className="p-4 flex gap-4 items-start flex-1 cursor-pointer md:cursor-default"
                  onClick={() => !isReadOnly && window.innerWidth < 768 && toggleItemComplete(key)}
                  role={!isReadOnly ? 'button' : undefined}
                >
                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() => toggleItemComplete(key)}
                    className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center border-2 transition-all ${
                      isFullyPicked
                        ? 'bg-emerald-500 border-emerald-400 text-white'
                        : isPartial
                          ? 'bg-sky-900/30 border-sky-500 text-sky-400'
                          : 'bg-slate-900 border-slate-600 text-slate-600'
                    }`}
                  >
                    {isFullyPicked && <Check size={28} strokeWidth={3} />}
                    {isPartial && <span className="font-black text-sm tabular-nums">{item.picked}</span>}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-2 mb-1">
                      <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                        {displaySku}
                      </span>
                      {isPartial && (
                        <span className="text-[10px] font-bold uppercase text-amber-300 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-900/40">
                          Parcial
                        </span>
                      )}
                    </div>
                    <h3
                      className={`font-bold text-white text-base leading-snug ${
                        isFullyPicked ? 'line-through text-slate-500' : ''
                      }`}
                    >
                      {displayName}
                    </h3>
                    <div className="flex items-center gap-2 mt-1 text-xs font-medium text-slate-400 uppercase flex-wrap">
                      {(displaySize || displayColor) && (
                        <>
                          {displaySize && (
                            <span className="bg-slate-700/50 px-2 py-0.5 rounded text-slate-300">{displaySize}</span>
                          )}
                          {displayColor && (
                            <span className="bg-slate-700/50 px-2 py-0.5 rounded text-slate-300">{displayColor}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-slate-950/40 p-3 md:p-4 md:bg-transparent md:w-72 border-t md:border-t-0 md:border-l border-slate-700/50 flex items-center justify-between md:justify-end gap-4 md:pr-5">
                  <div className="flex flex-col items-center md:items-end px-1 min-w-[72px]">
                    <span className="text-[9px] uppercase font-black text-slate-500 tracking-wider">Pedido</span>
                    <span className="text-lg font-black text-white tabular-nums">{item.quantity}</span>
                    {(item as any).sellAsPack && (item as any).mayoristaPackSize > 1 && (
                      <span className="text-[10px] text-slate-500 text-center leading-tight">
                        pack ×{(item as any).mayoristaPackSize}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase font-black text-slate-500 tracking-wider text-center md:text-right">
                      A preparar
                    </span>
                    <div className="flex items-center gap-2 bg-slate-900 rounded-xl p-1 border border-slate-700">
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => updatePickedQuantity(key, (item.picked || 0) - 1)}
                        className="w-10 h-10 flex items-center justify-center bg-slate-800 rounded-lg text-slate-400 active:bg-slate-700 active:text-white disabled:opacity-30"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        disabled={isReadOnly}
                        min={0}
                        max={item.quantity}
                        value={item.picked ?? 0}
                        onChange={(e) => updatePickedQuantity(key, parseInt(e.target.value, 10) || 0)}
                        className={`w-12 bg-transparent text-center font-black text-lg outline-none tabular-nums ${
                          isFullyPicked ? 'text-emerald-400' : isPartial ? 'text-sky-400' : 'text-slate-500'
                        }`}
                      />
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => updatePickedQuantity(key, (item.picked || 0) + 1)}
                        className="w-10 h-10 flex items-center justify-center bg-sky-600 rounded-lg text-white shadow-md active:bg-sky-500 active:scale-95 disabled:opacity-30 disabled:bg-slate-800"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="text-center py-12">
            <Package size={48} className="mx-auto text-slate-800 mb-2" />
            <p className="text-slate-500 font-bold">No hay ítems en este pedido.</p>
          </div>
        )}
      </div>

      {!isReadOnly && items.length > 0 && (
        <div className="sticky bottom-0 z-20 md:hidden border-t border-slate-700 bg-slate-900/98 backdrop-blur px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>
              <strong className="text-white">{totalPicked}</strong> / {totalOrdered} u. · neto{' '}
              <strong className="text-emerald-300">${netoPicked.toLocaleString('es-AR')}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => onFinishPicking(order.id, items)}
            className={`w-full py-3.5 rounded-xl font-black text-sm uppercase flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition ${
              isComplete ? 'bg-emerald-600 text-white' : 'bg-sky-600 text-white'
            }`}
          >
            <Save size={18} />
            {isComplete ? 'Guardar y pasar a control' : 'Guardar picking'}
          </button>
        </div>
      )}
    </div>
  );
};

export default OrderPicking;
