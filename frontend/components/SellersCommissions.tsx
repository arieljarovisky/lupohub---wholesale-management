import React from 'react';
import { User as UserIcon, TrendingUp, Percent, DollarSign } from 'lucide-react';
import { Order, Role, User } from '../types';

interface SellersCommissionsProps {
  orders: Order[];
  users: User[];
  role: Role;
  currentUser: User;
  onUpdateUser?: (user: User) => void | Promise<void>;
}

const fmtMoney = (n: number) =>
  `$${Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const salesTotalForSeller = (orders: Order[], sellerId: string) =>
  orders.filter((o) => o.sellerId === sellerId).reduce((sum, o) => sum + (Number(o.total) || 0), 0);

const SellersCommissions: React.FC<SellersCommissionsProps> = ({
  orders,
  users,
  role,
  currentUser,
  onUpdateUser
}) => {
  const updateCommission = async (userId: string, value: string) => {
    const user = users.find((u) => u.id === userId);
    if (user && onUpdateUser) {
      await Promise.resolve(
        onUpdateUser({
          ...user,
          commissionPercentage: parseFloat(value) || 0
        })
      );
    }
  };

  if (role === Role.SELLER) {
    const sellerSales = salesTotalForSeller(orders, currentUser.id);
    const rate = currentUser.commissionPercentage ?? 0;
    const commissionAmount = sellerSales * (rate / 100);

    return (
      <div className="space-y-6 animate-fade-in pb-10">
        <p className="text-sm text-slate-400">
          Resumen de tus pedidos en LupoHub y la comisión configurada por administración.
        </p>
        <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5 md:p-6 shadow-lg flex flex-col gap-6 max-w-2xl">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center text-white shadow-xl rotate-3">
              <UserIcon size={28} />
            </div>
            <div>
              <h4 className="font-black text-white text-xl tracking-tight">{currentUser.name}</h4>
              <p className="text-xs text-slate-500 font-medium">{currentUser.email}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
              <p className="text-[10px] font-black text-slate-500 uppercase mb-1 flex items-center gap-1">
                <DollarSign size={10} /> Total pedidos
              </p>
              <p className="text-lg font-black text-white">{fmtMoney(sellerSales)}</p>
            </div>
            <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
              <p className="text-[10px] font-black text-slate-500 uppercase mb-1 flex items-center gap-1">
                <Percent size={10} /> Tu comisión
              </p>
              <p className="text-lg font-black text-white">{rate}%</p>
            </div>
            <div className="bg-indigo-900/20 p-4 rounded-2xl border border-indigo-800/50">
              <p className="text-[10px] font-black text-indigo-400 uppercase mb-1 flex items-center gap-1">
                <TrendingUp size={10} /> Estimado
              </p>
              <p className="text-lg font-black text-indigo-300">{fmtMoney(commissionAmount)}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sellers = users.filter((u) => u.role === Role.SELLER);

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <p className="text-sm text-slate-400">
        Ventas totales por vendedor según pedidos en LupoHub y comisión configurable. Los vendedores se administran en{' '}
        <strong className="text-slate-300">Configuración → Usuarios</strong> o importación Excel.
      </p>
      {sellers.length === 0 ? (
        <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-8 text-center text-slate-400 text-sm">
          No hay usuarios con rol vendedor. Creá uno en Configuración.
        </div>
      ) : (
        <div className="space-y-4">
          {sellers.map((seller) => {
            const sellerSales = salesTotalForSeller(orders, seller.id);
            const commissionRate = seller.commissionPercentage || 0;
            const commissionAmount = sellerSales * (commissionRate / 100);

            return (
              <div
                key={seller.id}
                className="bg-slate-800 rounded-3xl border border-slate-700 p-5 md:p-6 shadow-lg flex flex-col gap-6"
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center text-white shadow-xl rotate-3 shrink-0">
                      <UserIcon size={28} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-black text-white text-xl tracking-tight truncate">{seller.name}</h4>
                      <p className="text-xs text-slate-500 font-medium truncate">{seller.email}</p>
                    </div>
                  </div>
                  <div className="bg-slate-900/50 px-3 py-1.5 rounded-xl border border-slate-700 flex flex-col items-end">
                    <span className="text-[8px] font-black text-slate-500 uppercase">Estado</span>
                    <span className="text-[10px] font-bold text-green-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      ACTIVO
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                  <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
                    <p className="text-[10px] font-black text-slate-500 uppercase mb-1 flex items-center gap-1">
                      <DollarSign size={10} /> Ventas totales
                    </p>
                    <p className="text-lg font-black text-white">{fmtMoney(sellerSales)}</p>
                  </div>

                  <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50">
                    <p className="text-[10px] font-black text-slate-500 uppercase mb-1 flex items-center gap-1">
                      <Percent size={10} /> Tasa comisión
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.1"
                        min={0}
                        max={100}
                        value={commissionRate}
                        onChange={(e) => updateCommission(seller.id, e.target.value)}
                        className="w-16 bg-slate-800 border border-slate-600 rounded-lg p-1 text-center text-white font-black text-md focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <span className="text-slate-400 font-bold">%</span>
                    </div>
                  </div>

                  <div className="bg-indigo-900/20 p-4 rounded-2xl border border-indigo-800/50">
                    <p className="text-[10px] font-black text-indigo-400 uppercase mb-1 flex items-center gap-1">
                      <TrendingUp size={10} /> Comisión estimada
                    </p>
                    <p className="text-lg font-black text-indigo-300">{fmtMoney(commissionAmount)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SellersCommissions;
