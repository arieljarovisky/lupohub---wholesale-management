import React, { useState, useEffect } from 'react';
import { ArrowLeft, CheckCircle, Package, AlertTriangle, Save, Lock, User, Check } from 'lucide-react';
import { Order, OrderItem, Product, OrderStatus, User as UserType } from '../types';

interface OrderPickingProps {
  order: Order;
  products: Product[];
  currentUserId: string;
  users: UserType[];
  onFinishPicking: (orderId: string, updatedItems: OrderItem[]) => void;
  onCancel: () => void;
}

const OrderPicking: React.FC<OrderPickingProps> = ({ order, products, currentUserId, users, onFinishPicking, onCancel }) => {
  const [items, setItems] = useState<OrderItem[]>(order.items);
  
  // Logic to determine if this view is read-only
  // It is read-only if pickedBy exists AND it's not the current user
  const pickedByOther = order.pickedBy && order.pickedBy !== currentUserId;
  const isReadOnly = pickedByOther;
  
  const pickedByUser = users.find(u => u.id === order.pickedBy);

  // Initialize picked count if undefined
  useEffect(() => {
    setItems(order.items.map(i => ({ ...i, picked: i.picked || 0 })));
  }, [order]);

  const toggleItemComplete = (productId: string) => {
    if (isReadOnly) return;
    setItems(prev => prev.map(item => {
      if (item.productId === productId) {
        // Toggle between 0 and full quantity
        const newPicked = item.picked === item.quantity ? 0 : item.quantity;
        return { ...item, picked: newPicked };
      }
      return item;
    }));
  };

  const updatePickedQuantity = (productId: string, qty: number) => {
    if (isReadOnly) return;
    setItems(prev => prev.map(item => {
      if (item.productId === productId) {
        return { ...item, picked: Math.min(Math.max(0, qty), item.quantity) }; // Clamp between 0 and max
      }
      return item;
    }));
  };

  const progress = Math.round((items.reduce((acc, i) => acc + (i.picked || 0), 0) / items.reduce((acc, i) => acc + i.quantity, 0)) * 100) || 0;
  const isComplete = progress === 100;

  return (
    <div className="bg-slate-950 md:bg-slate-900 min-h-[calc(100vh-100px)] rounded-3xl md:border md:border-slate-700 flex flex-col shadow-2xl animate-fade-in relative">
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-700 p-4 rounded-t-3xl shadow-lg">
        <div className="flex flex-col gap-4">
          
          {/* Top Row: Back + Title + Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button 
                onClick={onCancel} 
                className="p-2 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-300 transition shrink-0 active:scale-95"
              >
                <ArrowLeft size={20} />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-white leading-none">Pedido #{order.id}</h2>
                  {isReadOnly && <Lock size={14} className="text-red-400" />}
                </div>
                {order.pickedBy && (
                   <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                     <User size={10} /> {pickedByUser?.name || order.pickedBy}
                   </div>
                )}
              </div>
            </div>
            
            {/* Progress Badge */}
            <div className="text-right">
               <span className={`text-2xl font-black ${isComplete ? 'text-green-400' : 'text-blue-400'}`}>
                 {progress}%
               </span>
               <div className="text-[9px] uppercase font-bold text-slate-500 -mt-1">Completado</div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ease-out ${isComplete ? 'bg-green-500' : 'bg-blue-500'}`} 
              style={{ width: `${progress}%` }}
            ></div>
          </div>

          {/* Action Button (Mobile Full Width) */}
          {!isReadOnly && (
            <button 
              onClick={() => onFinishPicking(order.id, items)}
              className={`w-full py-3.5 rounded-xl font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98] ${
                 isComplete 
                 ? 'bg-green-600 hover:bg-green-500 text-white shadow-green-900/30' 
                 : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/30'
              }`}
            >
              <Save size={18} />
              <span>{isComplete ? 'Finalizar y Despachar' : 'Guardar Progreso'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Picking List */}
      <div className="p-3 md:p-6 space-y-3 pb-24 md:pb-6 overflow-y-auto">
        {items.map((item) => {
          const product = products.find(p => p.id === item.productId);
          const isFullyPicked = item.picked === item.quantity;
          const isPartial = item.picked > 0 && item.picked < item.quantity;
          
          return (
            <div 
              key={item.productId} 
              className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                isFullyPicked 
                ? 'bg-slate-900/50 border-green-900/30 opacity-60' 
                : 'bg-slate-800 border-slate-700 shadow-lg'
              }`}
            >
              <div className="flex flex-col md:flex-row">
                
                {/* Product Info Section */}
                <div className="p-4 flex gap-4 items-start flex-1 cursor-pointer" onClick={() => !isReadOnly && toggleItemComplete(item.productId)}>
                   {/* Big Checkbox */}
                   <div className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center border-2 transition-all ${
                      isFullyPicked 
                      ? 'bg-green-500 border-green-500 text-white' 
                      : isPartial
                      ? 'bg-blue-900/20 border-blue-500 text-blue-500'
                      : 'bg-slate-900 border-slate-600 text-slate-600'
                   }`}>
                      {isFullyPicked && <Check size={28} strokeWidth={3} />}
                      {isPartial && <span className="font-black text-sm">{item.picked}</span>}
                   </div>

                   <div className="min-w-0">
                      <div className="flex flex-wrap gap-2 mb-1">
                        <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                           {product?.sku}
                        </span>
                      </div>
                      <h3 className={`font-bold text-white text-base leading-snug ${isFullyPicked ? 'line-through text-slate-500' : ''}`}>
                         {product?.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1 text-xs font-medium text-slate-400 uppercase">
                         <span className="bg-slate-700/50 px-2 py-0.5 rounded text-slate-300">{product?.size}</span>
                         <span className="bg-slate-700/50 px-2 py-0.5 rounded text-slate-300">{product?.color}</span>
                      </div>
                   </div>
                </div>

                {/* Controls Section */}
                <div className="bg-slate-950/30 p-3 md:p-0 md:bg-transparent md:w-64 border-t md:border-t-0 md:border-l border-slate-700/50 flex items-center justify-between md:justify-end gap-4 md:pr-6">
                   
                   {/* Solicited */}
                   <div className="flex flex-col items-center md:items-end px-2">
                      <span className="text-[9px] uppercase font-black text-slate-500 tracking-wider">Total</span>
                      <span className="text-xl font-black text-white">{item.quantity}</span>
                   </div>

                   {/* Input Control */}
                   <div className="flex items-center gap-3 bg-slate-900 rounded-xl p-1 border border-slate-700">
                      <button 
                        disabled={isReadOnly}
                        onClick={() => updatePickedQuantity(item.productId, (item.picked || 0) - 1)}
                        className="w-10 h-10 flex items-center justify-center bg-slate-800 rounded-lg text-slate-400 active:bg-slate-700 active:text-white disabled:opacity-30"
                      >
                        -
                      </button>
                      <input 
                        type="number"
                        disabled={isReadOnly}
                        value={item.picked}
                        onChange={(e) => updatePickedQuantity(item.productId, parseInt(e.target.value) || 0)}
                        className={`w-12 bg-transparent text-center font-black text-lg outline-none ${
                          isFullyPicked ? 'text-green-500' : isPartial ? 'text-blue-400' : 'text-slate-500'
                        }`}
                      />
                      <button 
                        disabled={isReadOnly}
                        onClick={() => updatePickedQuantity(item.productId, (item.picked || 0) + 1)}
                        className="w-10 h-10 flex items-center justify-center bg-blue-600 rounded-lg text-white shadow-lg shadow-blue-900/20 active:bg-blue-500 active:scale-95 disabled:opacity-30 disabled:bg-slate-800"
                      >
                        +
                      </button>
                   </div>

                </div>
              </div>
            </div>
          );
        })}
        {items.length === 0 && (
           <div className="text-center py-12">
             <Package size={48} className="mx-auto text-slate-800 mb-2"/>
             <p className="text-slate-500 font-bold">No hay ítems en este pedido.</p>
           </div>
        )}
      </div>
    </div>
  );
};

export default OrderPicking;