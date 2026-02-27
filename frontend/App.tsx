import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Inventory from './components/Inventory';
import Orders from './components/Orders';
import Visits from './components/Visits';
import Settings from './components/Settings';
import CreateOrder from './components/CreateOrder';
import Customers from './components/Customers';
import OrderPicking from './components/OrderPicking';
import TiendaNubeOrders from './components/TiendaNubeOrders';
import MercadoLibreOrders from './components/MercadoLibreOrders';
import MercadoLibreStock from './components/MercadoLibreStock';
import { LayoutDashboard, Package, ShoppingCart, Users, Settings as SettingsIcon, MapPin, LogIn, Lock, AlertCircle, Loader2 } from 'lucide-react';
import { MOCK_VISITS, MOCK_USERS, MOCK_CUSTOMERS, MOCK_ATTRIBUTES } from './constants';
import { Role, OrderStatus, User, Order, Product, Attribute, Customer, OrderItem } from './types';
import { api } from './services/api';
import { setAuthToken } from './services/httpClient';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [currentView, setCurrentView] = useState(() => {
    const hv = window.location.hash ? window.location.hash.slice(1) : '';
    const lv = localStorage.getItem('lupo_current_view');
    return hv || lv || 'dashboard';
  });

  const baseView = currentView.split('?')[0];

  useEffect(() => {
    const onHashChange = () => {
      const v = window.location.hash ? window.location.hash.slice(1) : '';
      if (v) setCurrentView(v);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  
  // Data State - Initialized empty for Products/Orders to fetch from DB
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  
  // Mocks for data not yet in backend
  const [users, setUsers] = useState<User[]>(MOCK_USERS);
  const [attributes, setAttributes] = useState<Attribute[]>(MOCK_ATTRIBUTES);
  const [customers, setCustomers] = useState<Customer[]>(MOCK_CUSTOMERS);
  
  const [activePickingOrder, setActivePickingOrder] = useState<Order | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  // Fetch Data on Login
  useEffect(() => {
    const savedUser = localStorage.getItem('lupo_current_user');
    if (savedUser && !currentUser) {
      try {
        const parsed = JSON.parse(savedUser) as User;
        setCurrentUser(parsed);
      } catch {}
    }
    const savedToken = localStorage.getItem('lupo_api_token');
    if (savedToken) {
      setAuthToken(savedToken);
    }
    // Restore last view if available and allowed
    const savedView = localStorage.getItem('lupo_current_view');
    if (savedView && currentUser) {
      const role = currentUser.role;
      const allowedByRole: Record<string, Role[]> = {
        dashboard: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE],
        inventory: [Role.ADMIN, Role.WAREHOUSE, Role.SELLER],
        orders: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE],
        customers: [Role.ADMIN, Role.SELLER],
        visits: [Role.ADMIN, Role.SELLER],
        settings: [Role.ADMIN]
      };
      const isSpecial = savedView === 'create_order' || savedView === 'order_picking';
      if (!isSpecial && allowedByRole[savedView]?.includes(role)) {
        setCurrentView(savedView);
      }
    }
    if (currentUser) {
      loadData();
    }
  }, [currentUser]);

  // Persist current view on changes
  useEffect(() => {
    try {
      localStorage.setItem('lupo_current_view', currentView);
      if (window.location.hash.slice(1) !== currentView) {
        window.location.hash = currentView;
      }
    } catch {}
  }, [currentView]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [fetchedProducts, fetchedOrders, fetchedColors, fetchedSizes] = await Promise.all([
        api.getProducts(),
        api.getOrders(),
        api.getColors(),
        api.getSizes()
      ]);
      setProducts(fetchedProducts);
      setOrders(fetchedOrders);
      const colorAttrs = fetchedColors.map((c, idx) => ({ 
        id: c.code ? `color-${c.code}` : `color-idx-${idx}-${Date.now()}`, 
        type: 'color', 
        name: c.name, 
        value: c.hex, 
        code: c.code 
      })) as any;
       const sizeAttrs = fetchedSizes.map((s, idx) => ({ 
        id: s.code ? `size-${s.code}` : `size-idx-${idx}-${Date.now()}`, 
        type: 'size', 
         name: s.name || s.code || 'Sin nombre',
         code: s.code 
      })) as any;
      setAttributes([...sizeAttrs, ...colorAttrs]);
    } catch (error) {
      console.error("Error loading data form API", error);
      alert("Error conectando con el servidor. Verifica que el backend esté corriendo.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await api.login(loginEmail, loginPassword);
      setCurrentUser(res.user);
      localStorage.setItem('lupo_current_user', JSON.stringify(res.user));
      if (res.token) {
        localStorage.setItem('lupo_api_token', res.token);
        setAuthToken(res.token);
      }
      setCurrentView('dashboard');
      setLoginEmail('');
      setLoginPassword('');
    } catch (err: any) {
      setLoginError(err?.message || 'Error de autenticación');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setLoginError('');
    setProducts([]);
    setOrders([]);
    localStorage.removeItem('lupo_current_user');
    localStorage.removeItem('lupo_api_token');
    setAuthToken(null);
  };

  const handleUpdateStock = async (productId: string, newStock: number) => {
    // Optimistic Update
    const previousProducts = [...products];
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, stock: newStock } : p));

    try {
      // NOTE: Backend does not expose an updateProduct endpoint yet.
      // For now we rely on the optimistic local update only.
      // TODO: Add updateProduct endpoint to backend and call it here.
    } catch (error) {
      console.error(error);
      setProducts(previousProducts); // Rollback
      alert("Error al actualizar stock en servidor");
    }
  };

  const getVisibleCustomers = () => {
    if (!currentUser) return [];
    if (currentUser.role === Role.ADMIN || currentUser.role === Role.WAREHOUSE) return customers;
    return customers.filter(c => c.sellerId === currentUser.id);
  };

  const handleUpdateOrderStatus = async (orderId: string, status: OrderStatus) => {
     // Optimistic
     const previousOrders = [...orders];
     setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o));

     try {
       await api.updateOrderStatus(orderId, status);
     } catch (error) {
       setOrders(previousOrders);
       alert("Error actualizando estado del pedido");
     }
  };

  const handleCreateOrder = async (newOrder: Order) => {
    try {
      const isEditing = !!editingOrder;
      const savedOrder = isEditing ? await api.updateOrder(newOrder) : await api.createOrder(newOrder);
      setOrders(prev => {
        if (isEditing) {
          return prev.map(o => o.id === savedOrder.id ? savedOrder : o);
        }
        return [savedOrder, ...prev];
      });
      setEditingOrder(null);
      setCurrentView('orders');
    } catch (error) {
      console.error(error);
      alert(editingOrder ? "Error actualizando el pedido" : "Error creando el pedido");
    }
  };

  const handleEditOrder = (order: Order) => {
    setEditingOrder(order);
    setCurrentView('create_order');
  };
  
  const handleDeleteOrder = async (orderId: string) => {
    const previous = [...orders];
    setOrders(prev => prev.filter(o => o.id !== orderId));
    try {
      await api.deleteOrder(orderId);
    } catch (error) {
      setOrders(previous);
      alert("Error eliminando pedido");
    }
  };

  // --- USER MANAGEMENT (Local State for now) ---
  const handleCreateUser = (newUser: User) => {
    setUsers(prev => [...prev, newUser]);
  };

  const handleDeleteUser = (userId: string) => {
    if (userId === currentUser?.id) return; 
    setUsers(prev => prev.filter(u => u.id !== userId));
  };

  const handleUpdateUser = (updatedUser: User) => {
    setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
  };

  const handleCreateProducts = async (newProducts: Product[]) => {
    // This receives an array (batch), but our simple API does one by one or needs a batch endpoint.
    // We will loop for now.
    try {
      setIsLoading(true);
      const createdPromises = newProducts.map(p => api.createProduct(p));
      const results = await Promise.all(createdPromises);
      setProducts(prev => [...prev, ...results]);
      alert(`${results.length} productos creados exitosamente.`);
    } catch (error) {
      console.error(error);
      alert("Error guardando productos en base de datos");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateAttribute = (newAttr: Attribute) => {
    setAttributes(prev => [...prev, newAttr]);
  };

  const handleDeleteAttribute = (id: string) => {
    setAttributes(prev => prev.filter(a => a.id !== id));
  };

  const handleCreateCustomer = (newCustomer: Customer) => {
    setCustomers(prev => [...prev, newCustomer]);
  };

  const handleStartPicking = (order: Order) => {
    setActivePickingOrder(order);
    setCurrentView('order_picking');
  };

  const handleFinishPicking = async (orderId: string, updatedItems: OrderItem[]) => {
    const allPicked = updatedItems.every(i => i.picked === i.quantity);
    const newStatus = allPicked ? OrderStatus.DISPATCHED : OrderStatus.PREPARATION;
    
    // In a real full implementation, we should update items individually in DB.
    // Since our backend endpoint only updates status for now, we will just update status.
    // To properly support saving picked items, backend needs an endpoint for updating order items.
    
    // For now, we update local state + status in DB
    setOrders(prev => prev.map(o => o.id === orderId ? { 
      ...o, 
      items: updatedItems,
      status: newStatus,
      pickedBy: currentUser?.id 
    } : o));

    await handleUpdateOrderStatus(orderId, newStatus);

    setActivePickingOrder(null);
    setCurrentView('orders');
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-slate-900 rounded-3xl shadow-2xl p-8 max-w-md w-full border border-slate-800 animate-fade-in-up">
          <div className="mb-8 flex flex-col items-center">
             <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center shadow-lg transform rotate-3 mb-4">
                <span className="text-white font-black text-3xl">LH</span>
             </div>
             <h1 className="text-2xl font-bold text-white tracking-tight">LUPO Hub Argentina</h1>
             <p className="text-slate-400 text-sm mt-1">Acceso seguro al sistema</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
             <div className="space-y-1">
               <label className="text-xs font-bold text-slate-500 uppercase ml-1">Email Corporativo</label>
               <div className="relative">
                 <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                 <input 
                  type="email" 
                  autoFocus
                  required
                  placeholder="usuario@lupo.ar"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl py-4 pl-12 pr-4 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder-slate-600"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                 />
               </div>
             </div>
             
             <div className="space-y-1">
               <label className="text-xs font-bold text-slate-500 uppercase ml-1">Contraseña</label>
               <div className="relative">
                 <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                 <input 
                  type="password" 
                  required
                  placeholder="••••••••"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl py-4 pl-12 pr-4 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder-slate-600"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                 />
               </div>
             </div>

             {loginError && (
               <div className="bg-red-900/20 border border-red-900/50 p-3 rounded-xl flex items-center gap-2 text-red-400 text-sm font-medium">
                 <AlertCircle size={16} />
                 {loginError}
               </div>
             )}

             <button 
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-900/40 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
             >
               <LogIn size={20} />
               Iniciar Sesión
             </button>

             <div className="text-center pt-4 border-t border-slate-800">
                <p className="text-xs text-slate-500">
                  ¿Olvidaste tu contraseña? <span className="text-blue-400 cursor-pointer hover:underline">Contactar Admin</span>
                </p>
                <div className="mt-4 text-[10px] text-slate-600 bg-slate-800/50 p-2 rounded border border-slate-800 inline-block">
                   Demo: admin@lupo.ar / 123
                </div>
             </div>
          </form>
        </div>
      </div>
    );
  }

  const mobileNavItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Inicio', roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE] },
    { id: 'inventory', icon: Package, label: 'Stock', roles: [Role.ADMIN, Role.WAREHOUSE, Role.SELLER] },
    { id: 'orders', icon: ShoppingCart, label: 'Pedidos', roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE] },
    { id: 'customers', icon: Users, label: 'Clientes', roles: [Role.ADMIN, Role.SELLER] },
  ];

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-200 flex-col md:flex-row overflow-hidden">
      <div className="hidden md:block shrink-0">
        <Sidebar 
          currentView={baseView} 
          onChangeView={setCurrentView} 
          userRole={currentUser.role}
          onLogout={handleLogout}
        />
      </div>
      
      <main className={`flex-1 h-full overflow-y-auto p-4 md:p-8 md:ml-64 relative`}>
        {isLoading && (
          <div className="absolute inset-0 bg-slate-950/80 z-50 flex flex-col items-center justify-center backdrop-blur-sm">
             <Loader2 size={48} className="text-blue-500 animate-spin mb-4" />
             <p className="text-white font-bold">Sincronizando datos...</p>
          </div>
        )}

        <div className="max-w-6xl mx-auto pb-24 md:pb-8">
          <header className="mb-6 flex justify-between items-start">
             <div>
               <h1 className="text-2xl md:text-3xl font-bold text-white">
                 {baseView === 'dashboard' && 'Hola, ' + currentUser.name.split(' ')[0]}
                 {baseView === 'inventory' && 'Inventario'}
                 {baseView === 'orders' && 'Pedidos Mayoristas'}
                 {baseView === 'tiendanube_orders' && 'Ventas Tienda Nube'}
                 {baseView === 'mercadolibre_orders' && 'Ventas Mercado Libre'}
                 {baseView === 'customers' && 'Clientes'}
                 {baseView === 'visits' && 'Visitas'}
                 {baseView === 'settings' && 'Configuración'}
                 {baseView === 'create_order' && (editingOrder ? 'Editar Pedido' : 'Nuevo Pedido')}
                 {baseView === 'order_picking' && 'Preparando Pedido'}
               </h1>
               <p className="text-xs md:text-sm text-slate-400 mt-0.5">
                 {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
               </p>
             </div>
             {currentUser.role === Role.ADMIN && baseView !== 'settings' && (
               <button onClick={() => setCurrentView('settings')} className="md:hidden p-2 text-slate-400">
                  <SettingsIcon size={20} />
               </button>
             )}
          </header>

          {baseView === 'dashboard' && <Dashboard products={products} orders={orders} role={currentUser.role} />}
          {baseView === 'inventory' && (
            <Inventory 
              products={products} 
              attributes={attributes} 
              role={currentUser.role} 
              onCreateProducts={handleCreateProducts}
              onUpdateStock={handleUpdateStock}
            />
          )}
          {baseView === 'orders' && (
            <Orders 
              orders={orders} products={products} customers={getVisibleCustomers()} 
              users={users} role={currentUser.role} currentUserId={currentUser.id} 
              onUpdateStatus={handleUpdateOrderStatus} onCreateOrder={handleCreateOrder}
              onNavigate={setCurrentView} onStartPicking={handleStartPicking}
              onEditOrder={handleEditOrder}
              onDeleteOrder={handleDeleteOrder}
            />
          )}
          
          {baseView === 'customers' && (
            <Customers 
              customers={getVisibleCustomers()} 
              role={currentUser.role} 
              sellerId={currentUser.id} 
              onCreateCustomer={handleCreateCustomer}
              orders={orders}
              products={products}
            />
          )}
          {baseView === 'visits' && <Visits visits={MOCK_VISITS} role={currentUser.role} />}
          {baseView === 'settings' && (
            <Settings 
              attributes={attributes} 
              onCreateAttribute={handleCreateAttribute} 
              onDeleteAttribute={handleDeleteAttribute} 
              role={currentUser.role} 
              users={users}
              onUpdateUser={handleUpdateUser}
              onCreateUser={handleCreateUser}
              onDeleteUser={handleDeleteUser}
              orders={orders}
              currentUser={currentUser}
            />
          )}
          {baseView === 'create_order' && (
            <CreateOrder 
              products={products} 
              customers={getVisibleCustomers()} 
              onSave={handleCreateOrder} 
              onCancel={() => { setEditingOrder(null); setCurrentView('orders'); }} 
              sellerId={currentUser.id}
              initialOrder={editingOrder}
            />
          )}
          {baseView === 'order_picking' && activePickingOrder && (
            <OrderPicking order={activePickingOrder} products={products} currentUserId={currentUser.id} users={users} onFinishPicking={handleFinishPicking} onCancel={() => setCurrentView('orders')} />
          )}
          {baseView === 'tiendanube_orders' && <TiendaNubeOrders />}
          {baseView === 'mercadolibre_orders' && <MercadoLibreOrders />}
          {baseView === 'mercadolibre_stock' && <MercadoLibreStock />}
        </div>
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 px-2 py-3 z-50 flex justify-around items-center backdrop-blur-md bg-opacity-90">
        {mobileNavItems.map(item => {
          if (!item.roles.includes(currentUser.role)) return null;
          const isActive = baseView === item.id;
          return (
            <button 
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className={`flex flex-col items-center gap-1 transition-colors ${isActive ? 'text-blue-500' : 'text-slate-500'}`}
            >
              <item.icon size={20} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default App;
