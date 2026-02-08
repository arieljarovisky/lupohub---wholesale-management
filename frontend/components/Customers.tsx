import React, { useState } from 'react';
import { Users, Search, Plus, MapPin, Mail, Building2, Save, X, ShoppingBag, Calendar, DollarSign, TrendingUp, Clock, ArrowRight, ArrowLeft, Package, Star, ChevronRight } from 'lucide-react';
import { Customer, Role, Order, OrderStatus, Product } from '../types';

interface CustomersProps {
  customers: Customer[];
  role: Role;
  sellerId: string;
  onCreateCustomer: (customer: Customer) => void;
  orders: Order[];
  products: Product[];
}

const Customers: React.FC<CustomersProps> = ({ customers, role, sellerId, onCreateCustomer, orders, products }) => {
  const [isCreating, setIsCreating] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Form State
  const [newBusinessName, setNewBusinessName] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newCity, setNewCity] = useState('');

  const filteredCustomers = customers.filter(c => 
    c.businessName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusColor = (status: OrderStatus) => {
    switch(status) {
      case OrderStatus.DRAFT: return 'bg-slate-700 text-slate-300';
      case OrderStatus.CONFIRMED: return 'bg-blue-900/40 text-blue-300 border border-blue-800';
      case OrderStatus.PREPARATION: return 'bg-yellow-900/40 text-yellow-300 border border-yellow-800';
      case OrderStatus.DISPATCHED: return 'bg-green-900/40 text-green-300 border border-green-800';
    }
  };

  const handleSave = () => {
    if (!newBusinessName || !newEmail) return;

    const newCustomer: Customer = {
      id: `c${Date.now()}`,
      sellerId: sellerId,
      businessName: newBusinessName,
      name: newContactName,
      email: newEmail,
      address: newAddress,
      city: newCity
    };

    onCreateCustomer(newCustomer);
    setIsCreating(false);
    // Reset form
    setNewBusinessName('');
    setNewContactName('');
    setNewEmail('');
    setNewAddress('');
    setNewCity('');
  };

  // --- LOGIC FOR STATISTICS ---
  const getCustomerStats = (customerId: string) => {
    const customerOrders = orders.filter(o => o.customerId === customerId).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const totalSpent = customerOrders.reduce((sum, o) => sum + o.total, 0);
    const completedOrders = customerOrders.filter(o => o.status === OrderStatus.DISPATCHED).length;
    
    // Calculate Top Product
    const productCounts: Record<string, number> = {};
    customerOrders.forEach(order => {
      order.items.forEach(item => {
        productCounts[item.productId] = (productCounts[item.productId] || 0) + item.quantity;
      });
    });
    
    let topProductId = '';
    let topProductCount = 0;
    
    Object.entries(productCounts).forEach(([id, count]) => {
      if (count > topProductCount) {
        topProductCount = count;
        topProductId = id;
      }
    });

    const topProduct = products.find(p => p.id === topProductId);
    const averageTicket = customerOrders.length > 0 ? totalSpent / customerOrders.length : 0;

    return {
      orders: customerOrders,
      totalSpent,
      completedOrders,
      topProduct,
      topProductCount,
      averageTicket,
      lastOrderDate: customerOrders.length > 0 ? customerOrders[0].date : 'N/A'
    };
  };

  // --- VIEWS ---

  // 1. Order Detail View (Drill down Level 2)
  if (selectedOrder && selectedCustomer) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="flex items-center gap-3 mb-6">
          <button 
            onClick={() => setSelectedOrder(null)} 
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl transition text-slate-300"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
             <h2 className="text-2xl font-bold text-white">Pedido #{selectedOrder.id}</h2>
             <p className="text-sm text-slate-400">Detalles de la compra</p>
          </div>
        </div>

        <div className="bg-slate-800 rounded-3xl border border-slate-700 overflow-hidden shadow-xl">
           <div className="p-6 border-b border-slate-700 bg-slate-900/50 flex justify-between items-center">
              <div className="flex items-center gap-3">
                 <div className="w-12 h-12 bg-blue-600/20 rounded-xl flex items-center justify-center text-blue-400">
                    <ShoppingBag size={24} />
                 </div>
                 <div>
                    <div className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded w-fit mb-1 ${getStatusColor(selectedOrder.status)}`}>
                       {selectedOrder.status}
                    </div>
                    <div className="text-sm text-slate-400 flex items-center gap-2">
                       <Calendar size={14} /> {selectedOrder.date}
                    </div>
                 </div>
              </div>
              <div className="text-right">
                 <p className="text-sm text-slate-500 uppercase font-bold">Total</p>
                 <p className="text-3xl font-black text-white">${selectedOrder.total.toLocaleString()}</p>
              </div>
           </div>
           
           <div className="p-6">
              <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest mb-4">Items del Pedido</h3>
              <div className="space-y-3">
                 {selectedOrder.items.map(item => {
                    const product = products.find(p => p.id === item.productId);
                    return (
                       <div key={item.productId} className="flex items-center justify-between p-4 bg-slate-900 rounded-2xl border border-slate-800">
                          <div className="flex items-center gap-4">
                             <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center text-slate-500 font-bold">
                                {item.quantity}x
                             </div>
                             <div>
                                <p className="font-bold text-white">{product?.name || 'Producto Desconocido'}</p>
                                <p className="text-xs text-slate-500">{product?.sku} • {product?.size} • {product?.color}</p>
                             </div>
                          </div>
                          <div className="text-right">
                             <p className="font-bold text-white">${(item.priceAtMoment * item.quantity).toLocaleString()}</p>
                             <p className="text-xs text-slate-500">${item.priceAtMoment.toLocaleString()} c/u</p>
                          </div>
                       </div>
                    );
                 })}
              </div>
           </div>
        </div>
      </div>
    );
  }

  // 2. Customer Detail View (Drill down Level 1)
  if (selectedCustomer) {
    const stats = getCustomerStats(selectedCustomer.id);
    
    return (
      <div className="animate-fade-in space-y-6 pb-12">
        {/* Navigation Header */}
        <div className="flex items-center justify-between">
           <div className="flex items-center gap-3">
             <button 
               onClick={() => setSelectedCustomer(null)} 
               className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl transition text-slate-300"
             >
               <ArrowLeft size={20} />
             </button>
             <div>
                <h2 className="text-2xl font-bold text-white">{selectedCustomer.businessName}</h2>
                <div className="flex items-center gap-3 text-sm text-slate-400">
                  <span className="flex items-center gap-1"><Users size={14}/> {selectedCustomer.name}</span>
                  <span className="w-1 h-1 bg-slate-600 rounded-full"></span>
                  <span className="flex items-center gap-1"><MapPin size={14}/> {selectedCustomer.city}</span>
                </div>
             </div>
           </div>
           <button className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition">
              Editar Datos
           </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
           {/* Total Spent */}
           <div className="bg-slate-800 p-5 rounded-3xl border border-slate-700 shadow-lg">
              <div className="flex items-center gap-3 mb-2">
                 <div className="p-2 bg-green-900/20 rounded-lg text-green-500"><DollarSign size={20}/></div>
                 <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Inversión Total</span>
              </div>
              <p className="text-2xl font-black text-white">${stats.totalSpent.toLocaleString()}</p>
              <p className="text-[10px] text-slate-500 mt-1">Histórico acumulado</p>
           </div>

           {/* Orders Count */}
           <div className="bg-slate-800 p-5 rounded-3xl border border-slate-700 shadow-lg">
              <div className="flex items-center gap-3 mb-2">
                 <div className="p-2 bg-blue-900/20 rounded-lg text-blue-500"><ShoppingBag size={20}/></div>
                 <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Pedidos</span>
              </div>
              <p className="text-2xl font-black text-white">{stats.orders.length}</p>
              <p className="text-[10px] text-slate-500 mt-1">{stats.completedOrders} completados</p>
           </div>

           {/* Average Ticket */}
           <div className="bg-slate-800 p-5 rounded-3xl border border-slate-700 shadow-lg">
              <div className="flex items-center gap-3 mb-2">
                 <div className="p-2 bg-purple-900/20 rounded-lg text-purple-500"><TrendingUp size={20}/></div>
                 <span className="text-xs font-black text-slate-500 uppercase tracking-wider">Ticket Promedio</span>
              </div>
              <p className="text-2xl font-black text-white">${Math.round(stats.averageTicket).toLocaleString()}</p>
              <p className="text-[10px] text-slate-500 mt-1">Por pedido realizado</p>
           </div>

           {/* Top Product */}
           <div className="bg-gradient-to-br from-indigo-900 to-slate-900 p-5 rounded-3xl border border-indigo-800 shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-500 blur-3xl opacity-20 rounded-full"></div>
              <div className="flex items-center gap-3 mb-2 relative z-10">
                 <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-300"><Star size={20}/></div>
                 <span className="text-xs font-black text-indigo-300 uppercase tracking-wider">Más Comprado</span>
              </div>
              {stats.topProduct ? (
                 <div className="relative z-10">
                    <p className="text-lg font-bold text-white truncate" title={stats.topProduct.name}>{stats.topProduct.name}</p>
                    <p className="text-xs text-indigo-300 mt-0.5">{stats.topProductCount} unidades adquiridas</p>
                 </div>
              ) : (
                 <p className="text-sm text-slate-500 relative z-10">Sin datos suficientes</p>
              )}
           </div>
        </div>

        {/* Orders List Section */}
        <div className="bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden">
           <div className="p-6 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-white flex items-center gap-2">
                 <ShoppingBag size={20} className="text-blue-500"/> Historial de Pedidos
              </h3>
              <span className="text-xs font-bold text-slate-500 bg-slate-800 px-3 py-1 rounded-full">{stats.orders.length} pedidos</span>
           </div>
           
           {stats.orders.length > 0 ? (
             <div className="divide-y divide-slate-800">
               {stats.orders.map(order => (
                 <div 
                   key={order.id} 
                   onClick={() => setSelectedOrder(order)}
                   className="p-4 hover:bg-slate-800 transition-colors cursor-pointer flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 group"
                 >
                    <div className="flex items-center gap-4">
                       <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 group-hover:bg-blue-900/20 group-hover:text-blue-400 transition-colors">
                          <Package size={24} />
                       </div>
                       <div>
                          <div className="flex items-center gap-2">
                             <span className="font-bold text-white">Pedido #{order.id}</span>
                             <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${getStatusColor(order.status)}`}>
                                {order.status}
                             </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                             <span className="flex items-center gap-1"><Calendar size={12}/> {order.date}</span>
                             <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
                             <span>{order.items.reduce((a,b) => a + b.quantity, 0)} items</span>
                          </div>
                       </div>
                    </div>
                    
                    <div className="flex items-center gap-6 w-full sm:w-auto justify-between sm:justify-end">
                       <div className="text-right">
                          <p className="font-black text-white text-lg">${order.total.toLocaleString()}</p>
                       </div>
                       <ChevronRight size={20} className="text-slate-600 group-hover:text-blue-400 transition-transform group-hover:translate-x-1" />
                    </div>
                 </div>
               ))}
             </div>
           ) : (
              <div className="p-12 text-center text-slate-500">
                 <ShoppingBag size={48} className="mx-auto text-slate-800 mb-4"/>
                 <p className="font-medium">No hay historial de pedidos para este cliente.</p>
              </div>
           )}
        </div>
      </div>
    );
  }

  // 3. List View (Default)
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">Cartera de Clientes</h2>
        <button 
          onClick={() => setIsCreating(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition flex items-center gap-2 shadow-lg shadow-blue-900/50 font-medium"
        >
          <Plus size={18} />
          <span>Nuevo Cliente</span>
        </button>
      </div>

      <div className="bg-slate-800 rounded-xl shadow-lg border border-slate-700 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-700 bg-slate-900/50">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="Buscar por nombre o empresa..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-white placeholder-slate-500 text-sm"
            />
          </div>
        </div>

        {/* List Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
          {filteredCustomers.map(customer => (
            <div 
              key={customer.id} 
              onClick={() => setSelectedCustomer(customer)}
              className="bg-slate-900 p-5 rounded-2xl border border-slate-800 hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-900/10 transition-all group cursor-pointer active:scale-[0.98] relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-blue-600/10 to-transparent rounded-bl-full -mr-4 -mt-4 transition-opacity group-hover:opacity-100 opacity-0"></div>

              <div className="flex items-start justify-between mb-4 relative z-10">
                <div className="bg-slate-800 p-3 rounded-xl text-slate-400 group-hover:text-white group-hover:bg-blue-600 transition-colors shadow-sm">
                   <Building2 size={24} />
                </div>
                {role === Role.ADMIN && (
                   <span className="text-[10px] bg-slate-800 border border-slate-700 text-slate-400 px-2 py-1 rounded font-mono">ID: {customer.sellerId}</span>
                )}
              </div>
              
              <div className="relative z-10">
                <h3 className="text-lg font-bold text-white mb-0.5 truncate">{customer.businessName}</h3>
                <p className="text-sm text-slate-400 mb-4 truncate">{customer.name}</p>
                
                <div className="space-y-2 text-xs border-t border-slate-800 pt-3">
                  <div className="flex items-center text-slate-500 truncate">
                    <Mail size={12} className="mr-2 text-slate-600 shrink-0" />
                    {customer.email}
                  </div>
                  <div className="flex items-center text-slate-500 truncate">
                    <MapPin size={12} className="mr-2 text-slate-600 shrink-0" />
                    {customer.address}, {customer.city}
                  </div>
                </div>
              </div>
              
              <div className="mt-4 flex items-center justify-end text-blue-500 text-xs font-bold opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
                 Ver Perfil Completo <ArrowRight size={12} className="ml-1"/>
              </div>
            </div>
          ))}
          {filteredCustomers.length === 0 && (
            <div className="col-span-full py-16 text-center text-slate-500">
               <Users size={48} className="mx-auto text-slate-800 mb-4"/>
               <p>No se encontraron clientes con ese criterio.</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal Crear Cliente */}
      {isCreating && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 rounded-3xl w-full max-w-lg border border-slate-700 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900 rounded-t-3xl">
              <h3 className="text-xl font-bold text-white">Alta de Cliente</h3>
              <button onClick={() => setIsCreating(false)} className="text-slate-400 hover:text-white bg-slate-800 p-2 rounded-full hover:bg-slate-700 transition">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Razón Social</label>
                <input 
                  type="text" 
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  value={newBusinessName}
                  onChange={(e) => setNewBusinessName(e.target.value)}
                  placeholder="Ej: Lenceria Perez SRL"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Nombre Contacto</label>
                <input 
                  type="text" 
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  placeholder="Ej: Juan Perez"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Email</label>
                <input 
                  type="email" 
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="contacto@empresa.com"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Dirección</label>
                    <input 
                      type="text" 
                      className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                      value={newAddress}
                      onChange={(e) => setNewAddress(e.target.value)}
                      placeholder="Calle 123"
                    />
                </div>
                <div>
                    <label className="block text-xs font-black text-slate-500 uppercase mb-1 ml-1">Ciudad</label>
                    <input 
                      type="text" 
                      className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                      value={newCity}
                      onChange={(e) => setNewCity(e.target.value)}
                      placeholder="CABA"
                    />
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-800 bg-slate-900 rounded-b-3xl flex justify-end gap-3">
              <button 
                onClick={() => setIsCreating(false)}
                className="px-5 py-2.5 text-slate-400 hover:bg-slate-800 rounded-xl transition font-medium"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSave}
                disabled={!newBusinessName || !newEmail}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-blue-900/40 active:scale-95 transition-all"
              >
                <Save size={18} />
                Guardar Cliente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customers;