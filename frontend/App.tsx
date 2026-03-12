import React, { useState, useEffect, useRef, lazy, Suspense, useCallback, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import { LayoutDashboard, Package, ShoppingCart, Users, Settings as SettingsIcon, MapPin, LogIn, Lock, AlertCircle, Loader2, Menu, History, Ship, ShoppingBag, Zap, LogOut, BookOpen } from 'lucide-react';
import { MOCK_VISITS, MOCK_CUSTOMERS, MOCK_ATTRIBUTES } from './constants';
import { Role, OrderStatus, User, Order, Product, Attribute, Customer, OrderItem, PriceList } from './types';
import { api } from './services/api';
import { setAuthToken } from './services/httpClient';
import { useNotification } from './context/NotificationContext';

/** Si falla la carga del chunk (ej. 404 tras un nuevo deploy), recarga la página para cargar la versión nueva. */
function lazyWithReload<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((err: Error & { name?: string }) => {
      const isChunkError =
        err?.message?.includes('Failed to fetch dynamically imported module') ||
        err?.message?.includes('Importing a module script failed') ||
        err?.name === 'ChunkLoadError';
      if (isChunkError) {
        window.location.reload();
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    })
  );
}

const Dashboard = lazyWithReload(() => import('./components/Dashboard'));
const Inventory = lazyWithReload(() => import('./components/Inventory'));
const Catalogs = lazyWithReload(() => import('./components/Catalogs'));
const Orders = lazyWithReload(() => import('./components/Orders'));
const Visits = lazyWithReload(() => import('./components/Visits'));
const Settings = lazyWithReload(() => import('./components/Settings'));
const CreateOrder = lazyWithReload(() => import('./components/CreateOrder'));
const Customers = lazyWithReload(() => import('./components/Customers'));
const OrderPicking = lazyWithReload(() => import('./components/OrderPicking'));
const TiendaNubeOrders = lazyWithReload(() => import('./components/TiendaNubeOrders'));
const MercadoLibreOrders = lazyWithReload(() => import('./components/MercadoLibreOrders'));
const StockHistory = lazyWithReload(() => import('./components/StockHistory'));
const Despachos = lazyWithReload(() => import('./components/Despachos'));

const ViewFallback = () => (
  <div className="flex items-center justify-center py-24">
    <Loader2 size={32} className="text-blue-500 animate-spin" />
  </div>
);

const App: React.FC = () => {
  const { showToast } = useNotification();
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
  
  // Users from API when admin is logged in; empty otherwise
  const [users, setUsers] = useState<User[]>([]);
  const [attributes, setAttributes] = useState<Attribute[]>(MOCK_ATTRIBUTES);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [myCustomer, setMyCustomer] = useState<Customer | null>(null);
  
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [activePickingOrder, setActivePickingOrder] = useState<Order | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Fetch Data on Login
  useEffect(() => {
    const savedUser = localStorage.getItem('lupo_current_user');
    const savedToken = localStorage.getItem('lupo_api_token');
    if (savedToken) setAuthToken(savedToken);

    if (!currentUser && savedToken) {
      // Refrescar usuario desde el backend para tener priceListId (y datos) actualizados
      api.refreshUser()
        .then((res) => {
          if (res.user) {
            setCurrentUser(res.user);
            try {
              localStorage.setItem('lupo_current_user', JSON.stringify(res.user));
              if (res.token) localStorage.setItem('lupo_api_token', res.token);
              if (res.token) setAuthToken(res.token);
            } catch {}
          } else if (savedUser) {
            try {
              setCurrentUser(JSON.parse(savedUser) as User);
            } catch {}
          }
        })
        .catch(() => {
          if (savedUser) {
            try {
              setCurrentUser(JSON.parse(savedUser) as User);
            } catch {}
          }
        });
      return;
    }
    if (savedUser && !currentUser) {
      try {
        setCurrentUser(JSON.parse(savedUser) as User);
      } catch {}
    }
    // Restore last view if available and allowed
    const savedView = localStorage.getItem('lupo_current_view');
    if (savedView && currentUser) {
      const role = currentUser.role;
      const allowedByRole: Record<string, Role[]> = {
        dashboard: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER],
        inventory: [Role.ADMIN, Role.WAREHOUSE],
        orders: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER],
        create_order: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER],
        tiendanube_orders: [Role.ADMIN, Role.WAREHOUSE],
        mercadolibre_orders: [Role.ADMIN, Role.WAREHOUSE],
        stock_history: [Role.ADMIN, Role.WAREHOUSE],
        despachos: [Role.ADMIN],
        customers: [Role.ADMIN, Role.SELLER],
        visits: [Role.ADMIN, Role.SELLER],
        catalogs: [Role.ADMIN, Role.SELLER, Role.CUSTOMER],
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
      if (currentUser?.role === Role.CUSTOMER) {
        const [myC, fetchedOrders] = await Promise.all([api.getMyCustomer(), api.getOrders()]);
        setMyCustomer(myC || null);
        const fetchedProducts = await api.getProducts({ priceListId: myC?.priceListId ?? undefined, perPage: 400 });
        setProducts(fetchedProducts);
        setOrders(fetchedOrders);
        setCustomers(myC ? [myC] : []);
        setAttributes([]);
      } else {
      const effectivePriceListId = currentUser?.role === Role.SELLER ? currentUser.priceListId : undefined;
      const [fetchedProducts, fetchedOrders, fetchedColors, fetchedSizes, fetchedCustomers] = await Promise.all([
        api.getProducts(effectivePriceListId ? { priceListId: effectivePriceListId, perPage: 400 } : { perPage: 400 }),
        api.getOrders(),
        api.getColors(),
        api.getSizes(),
        api.getCustomers()
      ]);
      setProducts(fetchedProducts);
      setOrders(fetchedOrders);
      setCustomers(Array.isArray(fetchedCustomers) ? fetchedCustomers : []);
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
      if (currentUser?.role === Role.ADMIN) {
        try {
          const [fetchedUsers, fetchedPriceLists] = await Promise.all([api.getUsers(), api.getPriceLists()]);
          setUsers(fetchedUsers);
          setPriceLists(fetchedPriceLists);
        } catch {
          setUsers([]);
          setPriceLists([]);
        }
      } else {
        setUsers([]);
      }
      }
    } catch (error) {
      console.error("Error loading data form API", error);
      showToast('error', 'Error conectando con el servidor. Verifica que el backend esté corriendo.');
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

  const handleLogout = useCallback(() => {
    setCurrentUser(null);
    setLoginError('');
    setProducts([]);
    setOrders([]);
    localStorage.removeItem('lupo_current_user');
    localStorage.removeItem('lupo_api_token');
    setAuthToken(null);
  }, []);

  const handleUpdateStock = async (productId: string, newStock: number) => {
    const previousProducts = [...products];
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, stock: newStock } : p));
    try {
      await api.updateVariantStock(productId, newStock);
    } catch (error) {
      setProducts(previousProducts);
      showToast('error', 'Error al actualizar stock. Revisá que tengas permiso (Admin o Depósito).');
    }
  };

  const getVisibleCustomers = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === Role.CUSTOMER) return myCustomer ? [myCustomer] : [];
    if (currentUser.role === Role.ADMIN || currentUser.role === Role.WAREHOUSE) return customers;
    return customers.filter(c => c.sellerId === currentUser.id);
  }, [currentUser, myCustomer, customers]);

  const handleUpdateOrderStatus = async (orderId: string, status: OrderStatus, pickedBy?: string) => {
     const previousOrders = [...orders];
     setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status, ...(pickedBy ? { pickedBy } : {}), ...(status === OrderStatus.DISPATCHED ? { dispatchedAt: new Date().toISOString() } : {}) } : o));
     try {
       await api.updateOrderStatus(orderId, status, pickedBy);
     } catch (error) {
       setOrders(previousOrders);
       showToast('error', 'Error actualizando estado del pedido');
     }
  };

  const handleCreateOrder = async (newOrder: Order) => {
    try {
      const isEditing = !!editingOrder;
      const orderToSave = { ...newOrder };
      if (currentUser?.role === Role.CUSTOMER) orderToSave.sellerId = null;
      const savedOrder = isEditing ? await api.updateOrder(orderToSave) : await api.createOrder(orderToSave);
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
      showToast('error', editingOrder ? 'Error actualizando el pedido' : 'Error creando el pedido');
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
    } catch (error: any) {
      setOrders(previous);
      const msg = error?.response?.data?.message || error?.message || 'Error eliminando pedido';
      showToast('error', msg);
    }
  };

  // --- USER MANAGEMENT (Local State for now) ---
  const handleCreateUser = async (newUser: User) => {
    try {
      await api.createUser({
        name: newUser.name,
        email: newUser.email,
        password: newUser.password || '',
        role: newUser.role,
        commissionPercentage: newUser.commissionPercentage
      });
      const fetchedUsers = await api.getUsers();
      setUsers(fetchedUsers);
    } catch (err: any) {
      showToast('error', err?.message || 'Error al crear usuario');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (userId === currentUser?.id) return;
    try {
      await api.deleteUser(userId);
      setUsers(prev => prev.filter(u => u.id !== userId));
    } catch (err: any) {
      showToast('error', err?.message || 'Error al eliminar usuario');
    }
  };

  const handleUpdateUser = (updatedUser: User) => {
    setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
  };

  /** SKU base para agrupar variantes (ej. "4050001-130-111" -> "4050001"). */
  const getBaseSku = (p: Product): string => {
    const s = (p.base_sku || p.sku || '').trim();
    const parts = s.split('-');
    return parts.length >= 3 ? parts.slice(0, -2).join('-') : s;
  };

  const handleCreateProducts = async (newProducts: Product[]) => {
    if (!newProducts.length) return;
    try {
      setIsLoading(true);
      // Agrupar por SKU base y crear variantes en secuencia dentro de cada grupo para evitar duplicate entry del producto padre
      const byBase = new Map<string, Product[]>();
      for (const p of newProducts) {
        const base = getBaseSku(p);
        if (!byBase.has(base)) byBase.set(base, []);
        byBase.get(base)!.push(p);
      }
      const created: Product[] = [];
      let duplicates = 0;
      const runGroup = async (group: Product[]) => {
        const groupCreated: Product[] = [];
        let groupDupes = 0;
        for (const p of group) {
          try {
            const raw = await api.createProductStrict(p);
            const parts = (raw?.sku || '').toString().split('-');
            const sizeCode = parts.length >= 2 ? parts[parts.length - 2] : '';
            const colorCode = parts.length >= 1 ? parts[parts.length - 1] : '';
            groupCreated.push({
              id: raw.id,
              sku: raw.sku,
              name: raw.name,
              category: raw.category ?? 'General',
              price: Number(raw.base_price ?? raw.price ?? 0),
              description: raw.description ?? '',
              size: sizeCode,
              color: colorCode,
              stock: 0,
              stock_total: 0,
              integrations: { local: true, mercadoLibre: false, tiendaNube: false },
              externalIds: raw.externalIds,
            } as Product);
          } catch (err: any) {
            const msg = (err?.message || '').toLowerCase();
            if (msg.includes('duplicate') || msg.includes('sku ya existe') || msg.includes('409')) {
              groupDupes++;
            } else {
              console.error('Error creando producto:', p?.sku, err);
            }
          }
        }
        return { groupCreated, groupDupes };
      };
      const results = await Promise.all([...byBase.values()].map(runGroup));
      for (const { groupCreated, groupDupes } of results) {
        created.push(...groupCreated);
        duplicates += groupDupes;
      }
      if (created.length > 0) {
        setProducts(prev => [...prev, ...created]);
      }
      if (duplicates > 0 && created.length === 0) {
        showToast('info', `${duplicates} variante(s) ya existían con ese SKU. No se creó ninguna nueva.\n\nRefrescando la lista para que veas las variantes que ya están en tu inventario.`);
      } else if (duplicates > 0) {
        showToast('success', `${created.length} variante(s) creadas. ${duplicates} ya existían y se omitieron.`);
      } else if (created.length > 0) {
        showToast('success', `${created.length} variante(s) creadas exitosamente.`);
      } else {
        showToast('error', 'No se pudo crear ninguna variante. Revisá la consola o la conexión.');
      }
      // Refrescar desde el servidor para que se vean variantes nuevas (sin usar fallback para no pisar con mock)
      try {
        const refreshed = await api.getProductsStrict();
        setProducts(refreshed);
      } catch (_) {
        // Si falla el refresh, mantener lista actual (incl. las que acabamos de agregar)
      }
    } catch (error) {
      console.error(error);
      showToast('error', 'Error guardando productos en base de datos');
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

  const handleCreateCustomer = async (newCustomer: Customer) => {
    try {
      const created = await api.createCustomer(newCustomer);
      setCustomers(prev => [...prev, created]);
    } catch (error) {
      console.error(error);
      showToast('error', 'Error al crear el cliente. Revisá que el email esté completo y que la conexión con el servidor esté activa.');
    }
  };

  const handleUpdateCustomer = async (customerId: string, data: Partial<Customer>) => {
    try {
      const updated = await api.updateCustomer(customerId, data);
      setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, ...updated } : c));
      if (myCustomer?.id === customerId) setMyCustomer(prev => prev ? { ...prev, ...updated } : null);
    } catch (error) {
      console.error(error);
      showToast('error', 'Error al actualizar el cliente.');
    }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    try {
      await api.deleteCustomer(customerId);
      setCustomers(prev => prev.filter(c => c.id !== customerId));
      if (myCustomer?.id === customerId) setMyCustomer(null);
      showToast('success', 'Cliente eliminado.');
    } catch (error: any) {
      console.error(error);
      const msg = error?.message || (typeof error === 'string' ? error : '');
      showToast('error', msg.includes('pedidos') ? 'No se puede eliminar: el cliente tiene pedidos asociados.' : 'Error al eliminar el cliente.');
    }
  };

  const handleStartPicking = async (order: Order) => {
    if (currentUser?.role === Role.WAREHOUSE) {
      try {
        await api.updateOrderStatus(order.id, OrderStatus.PREPARATION, currentUser.id);
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, pickedBy: currentUser.id } : o));
        setActivePickingOrder({ ...order, pickedBy: currentUser.id });
      } catch {
        showToast('error', 'Error al registrar preparación del pedido');
        return;
      }
    } else {
      setActivePickingOrder(order);
    }
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
      pickedBy: currentUser?.id,
      dispatchedAt: newStatus === OrderStatus.DISPATCHED ? new Date().toISOString() : o.dispatchedAt
    } : o));

    await handleUpdateOrderStatus(orderId, newStatus, currentUser?.id);

    setActivePickingOrder(null);
    setCurrentView('orders');
  };

  if (!currentUser) {
    return (
      <div className="min-h-[100dvh] min-h-screen bg-slate-950 flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]">
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
                  autoComplete="email"
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
                  autoComplete="current-password"
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
    { id: 'dashboard', icon: LayoutDashboard, label: 'Inicio', roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER] },
    { id: 'inventory', icon: Package, label: 'Stock', roles: [Role.ADMIN, Role.WAREHOUSE] },
    { id: 'orders', icon: ShoppingCart, label: 'Pedidos', roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER] },
    { id: 'customers', icon: Users, label: 'Clientes', roles: [Role.ADMIN, Role.SELLER] },
    { id: 'catalogs', icon: BookOpen, label: 'Catálogos', roles: [Role.ADMIN, Role.SELLER, Role.CUSTOMER] },
  ];

  const allMobileNavSections = [
    { title: 'Principal', items: [
      { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard, roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER] },
      { id: 'inventory', label: 'Inventario', icon: Package, roles: [Role.ADMIN, Role.WAREHOUSE] },
      { id: 'stock_history', label: 'Historial Stock', icon: History, roles: [Role.ADMIN, Role.WAREHOUSE] },
      { id: 'despachos', label: 'Despachos', icon: Ship, roles: [Role.ADMIN] },
    ]},
    { title: 'Pedidos y canales', items: [
      { id: 'orders', label: 'Mayoristas', icon: ShoppingCart, roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER] },
      { id: 'create_order', label: 'Nuevo pedido', icon: ShoppingCart, roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER] },
      { id: 'tiendanube_orders', label: 'Tienda Nube', icon: ShoppingBag, roles: [Role.ADMIN, Role.WAREHOUSE] },
      { id: 'mercadolibre_orders', label: 'Mercado Libre', icon: Zap, roles: [Role.ADMIN, Role.WAREHOUSE] },
    ]},
    { title: 'CRM y sistema', items: [
      { id: 'customers', label: 'Clientes', icon: Users, roles: [Role.ADMIN, Role.SELLER] },
      { id: 'visits', label: 'Visitas', icon: MapPin, roles: [Role.ADMIN, Role.SELLER] },
      { id: 'catalogs', label: 'Catálogos', icon: BookOpen, roles: [Role.ADMIN, Role.SELLER, Role.CUSTOMER] },
      { id: 'settings', label: 'Configuración', icon: SettingsIcon, roles: [Role.ADMIN, Role.WAREHOUSE] },
    ]},
  ];

  return (
    <div className="flex w-full bg-slate-950 text-slate-200 flex-col md:flex-row min-h-[100dvh] h-[100dvh] md:h-screen overflow-hidden">
      <div className="hidden md:block shrink-0">
        <Sidebar 
          currentView={baseView} 
          onChangeView={setCurrentView} 
          userRole={currentUser.role}
          onLogout={handleLogout}
        />
      </div>
      
      <main className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto pl-4 pr-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] md:p-8 md:ml-64 relative scroll-area-ios">
        {isLoading && (
          <div className="absolute inset-0 bg-slate-950/80 z-50 flex flex-col items-center justify-center backdrop-blur-sm pt-[env(safe-area-inset-top)]">
             <Loader2 size={48} className="text-blue-500 animate-spin mb-4" />
             <p className="text-white font-bold">Sincronizando datos...</p>
          </div>
        )}

        <div className="max-w-6xl mx-auto pb-24 md:pb-8 w-full overflow-x-hidden px-1 sm:px-0">
          <header className="mb-4 md:mb-6 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
             <div className="min-w-0">
               <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white truncate">
                 {baseView === 'dashboard' && 'Hola, ' + currentUser.name.split(' ')[0]}
                 {baseView === 'inventory' && 'Inventario'}
                 {baseView === 'orders' && (currentUser.role === Role.CUSTOMER ? 'Mis pedidos' : 'Pedidos Mayoristas')}
                 {baseView === 'tiendanube_orders' && 'Tienda Nube'}
                 {baseView === 'mercadolibre_orders' && 'Mercado Libre'}
                 {baseView === 'mercadolibre_stock' && 'Stock Mercado Libre'}
                 {baseView === 'stock_history' && 'Historial de Stock'}
                 {baseView === 'despachos' && 'Despachos'}
                 {baseView === 'customers' && 'Clientes'}
                 {baseView === 'catalogs' && 'Catálogos'}
                 {baseView === 'visits' && 'Visitas'}
                 {baseView === 'settings' && 'Configuración'}
                 {baseView === 'create_order' && (editingOrder ? 'Editar Pedido' : 'Nuevo Pedido')}
                 {baseView === 'order_picking' && 'Preparando Pedido'}
               </h1>
               <p className="text-xs md:text-sm text-slate-400 mt-0.5">
                 {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
               </p>
             </div>
            {(currentUser.role === Role.ADMIN || currentUser.role === Role.WAREHOUSE) && baseView !== 'settings' && (
               <button onClick={() => setCurrentView('settings')} className="md:hidden p-2 text-slate-400">
                  <SettingsIcon size={20} />
               </button>
             )}
          </header>

          {baseView === 'dashboard' && (
            <Suspense fallback={<ViewFallback />}>
              <Dashboard products={products} orders={orders} role={currentUser.role} onNavigate={setCurrentView} />
            </Suspense>
          )}
          {baseView === 'inventory' && (
            <Suspense fallback={<ViewFallback />}>
              <Inventory 
                products={products} 
                attributes={attributes} 
                role={currentUser.role} 
                onCreateProducts={handleCreateProducts}
                onUpdateStock={handleUpdateStock}
                onImportComplete={loadData}
              />
            </Suspense>
          )}
          {baseView === 'orders' && (
            <Suspense fallback={<ViewFallback />}>
              <Orders 
                orders={orders} products={products} customers={getVisibleCustomers} 
                users={users} role={currentUser.role} currentUserId={currentUser.id} 
                onUpdateStatus={handleUpdateOrderStatus} onCreateOrder={handleCreateOrder}
                onNavigate={setCurrentView} onStartPicking={handleStartPicking}
                onEditOrder={handleEditOrder}
                onDeleteOrder={handleDeleteOrder}
              />
            </Suspense>
          )}
          
          {baseView === 'customers' && (
            <Suspense fallback={<ViewFallback />}>
              <Customers 
                customers={getVisibleCustomers} 
                role={currentUser.role} 
                sellerId={currentUser.id} 
                onCreateCustomer={handleCreateCustomer}
                onUpdateCustomer={handleUpdateCustomer}
                onDeleteCustomer={handleDeleteCustomer}
                priceLists={priceLists}
                orders={orders}
                products={products}
              />
            </Suspense>
          )}
          {baseView === 'visits' && (
            <Suspense fallback={<ViewFallback />}>
              <Visits visits={MOCK_VISITS} role={currentUser.role} />
            </Suspense>
          )}
          {baseView === 'settings' && (
            <Suspense fallback={<ViewFallback />}>
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
            </Suspense>
          )}
          {baseView === 'create_order' && (
            <Suspense fallback={<ViewFallback />}>
              <CreateOrder
                products={products}
                customers={getVisibleCustomers}
                onSave={handleCreateOrder}
                onCancel={() => { setEditingOrder(null); setCurrentView('orders'); }}
                sellerId={currentUser.role === Role.CUSTOMER ? undefined : currentUser.id}
                initialOrder={editingOrder}
                role={currentUser.role}
              />
            </Suspense>
          )}
          {baseView === 'order_picking' && activePickingOrder && (
            <Suspense fallback={<ViewFallback />}>
              <OrderPicking order={activePickingOrder} products={products} currentUserId={currentUser.id} users={users} onFinishPicking={handleFinishPicking} onCancel={() => setCurrentView('orders')} />
            </Suspense>
          )}
          {baseView === 'tiendanube_orders' && (
            <Suspense fallback={<ViewFallback />}>
              <TiendaNubeOrders />
            </Suspense>
          )}
          {baseView === 'mercadolibre_orders' && (
            <Suspense fallback={<ViewFallback />}>
              <MercadoLibreOrders />
            </Suspense>
          )}
          {baseView === 'catalogs' && (
            <Suspense fallback={<ViewFallback />}>
              <Catalogs role={currentUser.role} />
            </Suspense>
          )}
          {baseView === 'stock_history' && (
            <Suspense fallback={<ViewFallback />}>
              <StockHistory />
            </Suspense>
          )}
          {baseView === 'despachos' && (
            <Suspense fallback={<ViewFallback />}>
              <Despachos />
            </Suspense>
          )}
        </div>
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-800 px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex justify-around items-stretch backdrop-blur-md">
        {mobileNavItems.map(item => {
          if (!item.roles.includes(currentUser.role)) return null;
          const isActive = baseView === item.id;
          return (
            <button 
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              className={`flex flex-col items-center justify-center gap-1 min-h-[56px] flex-1 py-2 transition-colors touch-manipulation ${isActive ? 'text-blue-500' : 'text-slate-500 active:bg-slate-800/50 rounded-xl'}`}
            >
              <item.icon size={22} aria-hidden />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => setMobileMenuOpen(true)}
          className={`flex flex-col items-center justify-center gap-1 min-h-[56px] flex-1 py-2 transition-colors touch-manipulation text-slate-500 active:bg-slate-800/50 rounded-xl ${baseView !== 'dashboard' && !mobileNavItems.some(i => i.id === baseView) ? 'text-blue-500' : ''}`}
          aria-label="Más opciones"
        >
          <Menu size={22} aria-hidden />
          <span className="text-[10px] font-medium">Más</span>
        </button>
      </nav>

      {/* Mobile full menu drawer */}
      {mobileMenuOpen && (
        <>
          <div className="md:hidden fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} aria-hidden />
          <div className="md:hidden fixed inset-0 z-[70] flex flex-col bg-slate-900 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
              <h2 className="text-lg font-bold text-white">Menú</h2>
              <button onClick={() => setMobileMenuOpen(false)} className="p-3 -mr-2 text-slate-400 hover:text-white rounded-xl touch-manipulation" aria-label="Cerrar">
                <span className="text-2xl leading-none">×</span>
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 space-y-6 touch-scroll scroll-area-ios">
              {allMobileNavSections.map(section => {
                const items = section.items.filter(i => i.roles.includes(currentUser.role));
                if (items.length === 0) return null;
                return (
                  <div key={section.title}>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">{section.title}</p>
                    <div className="space-y-1">
                      {items.map(item => {
                        const isActive = baseView === item.id;
                        return (
                          <button
                            key={item.id}
                            onClick={() => { setCurrentView(item.id); setMobileMenuOpen(false); }}
                            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-left touch-manipulation min-h-[48px] ${isActive ? 'bg-blue-600 text-white' : 'bg-slate-800/50 text-slate-200 hover:bg-slate-700/50'}`}
                          >
                            <item.icon size={20} />
                            <span className="font-medium">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="shrink-0 p-4 pt-0 border-t border-slate-800">
              <button
                onClick={() => { handleLogout(); setMobileMenuOpen(false); }}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors touch-manipulation min-h-[48px] font-medium"
              >
                <LogOut size={20} />
                Cerrar sesión
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default App;
