import React, { useState, useEffect, useRef, lazy, Suspense, useCallback, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import { LayoutDashboard, Package, ShoppingCart, Users, Settings as SettingsIcon, MapPin, LogIn, Lock, AlertCircle, Loader2, Menu, History, Ship, ShoppingBag, Zap, LogOut, BookOpen, FileText, DollarSign, Percent } from 'lucide-react';
import { MOCK_VISITS, MOCK_CUSTOMERS, MOCK_ATTRIBUTES, DAMIAN_TASKS_BANNER_EMAIL, DAMIAN_TASKS_BANNER_UNTIL_MS, ARIEL_TASKS_OWNER_EMAIL } from './constants';
import { Role, OrderStatus, User, Order, Product, Attribute, Customer, OrderItem, PriceList, Transporte, UserTask } from './types';
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
const Billing = lazyWithReload(() => import('./components/Billing'));
const CreateOrderTemplate = lazyWithReload(() => import('./components/CreateOrderTemplate'));
const Customers = lazyWithReload(() => import('./components/Customers'));
const OrderPicking = lazyWithReload(() => import('./components/OrderPicking'));
const TiendaNubeOrders = lazyWithReload(() => import('./components/TiendaNubeOrders'));
const MercadoLibreOrders = lazyWithReload(() => import('./components/MercadoLibreOrders'));
const MercadoLibreCanalDifusion = lazyWithReload(() => import('./components/MercadoLibreCanalDifusion'));
const MercadoLibreProductAds = lazyWithReload(() => import('./components/MercadoLibreProductAds'));
const MercadoLibreBrandAds = lazyWithReload(() =>
  import('./components/MercadoLibreBrandDisplayAds').then((m) => ({ default: m.MercadoLibreBrandAds }))
);
const MercadoLibreDisplayAds = lazyWithReload(() =>
  import('./components/MercadoLibreBrandDisplayAds').then((m) => ({ default: m.MercadoLibreDisplayAds }))
);
const BulkInvoicing = lazyWithReload(() => import('./components/BulkInvoicing'));
const StockHistory = lazyWithReload(() => import('./components/StockHistory'));
const Despachos = lazyWithReload(() => import('./components/Despachos'));
const SellersCommissions = lazyWithReload(() => import('./components/SellersCommissions'));
const UserTaskManager = lazyWithReload(() => import('./components/UserTaskManager'));

const ViewFallback = () => (
  <div className="flex items-center justify-center py-24">
    <Loader2 size={32} className="text-blue-500 animate-spin" />
  </div>
);

const App: React.FC = () => {
  const { showToast } = useNotification();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
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
  const [transportes, setTransportes] = useState<Transporte[]>([]);
  const [activePickingOrder, setActivePickingOrder] = useState<Order | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  /** Modal de aviso post-guardado: artículos cuyas unidades quedaron sin número de despacho. */
  const [despachoWarningsToShow, setDespachoWarningsToShow] = useState<string[] | null>(null);
  /** Filtro de archivados en pedidos: 'no' = ocultar archivados, 'yes' = ver todos, 'only' = solo archivados */
  const [orderArchivedFilter, setOrderArchivedFilter] = useState<'no' | 'yes' | 'only'>('no');
  /** Lista de precios elegida al crear/editar pedido (null = precio base). Solo aplica para ADMIN/WAREHOUSE. */
  const [createOrderPriceListId, setCreateOrderPriceListId] = useState<string | null>(null);
  const [myUserTasks, setMyUserTasks] = useState<UserTask[]>([]);
  const prevCreateOrderViewRef = useRef(false);
  const savingOrderRef = useRef(false);
  const editingOrderIdRef = useRef<string | null>(null);
  const DRAFT_KEY = 'lupo_order_template_draft';
  const allowedByRole: Record<string, Role[]> = {
    dashboard: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER],
    inventory: [Role.ADMIN, Role.WAREHOUSE, Role.DEPOSITO],
    orders: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER, Role.DEPOSITO],
    create_order: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER],
    bulk_invoicing: [Role.ADMIN, Role.WAREHOUSE],
    tiendanube_orders: [Role.ADMIN, Role.WAREHOUSE],
    mercadolibre_orders: [Role.ADMIN, Role.WAREHOUSE],
    stock_history: [Role.ADMIN, Role.WAREHOUSE],
    despachos: [Role.ADMIN],
    customers: [Role.ADMIN, Role.SELLER],
    sellers: [Role.ADMIN, Role.SELLER],
    visits: [Role.ADMIN, Role.SELLER],
    catalogs: [Role.ADMIN, Role.SELLER, Role.CUSTOMER],
    settings: [Role.ADMIN],
    facturacion: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE],
    order_picking: [Role.ADMIN, Role.WAREHOUSE],
  };
  const defaultViewForRole = useCallback((role: Role): string => {
    if (role === Role.DEPOSITO) return 'inventory';
    if (role === Role.CUSTOMER) return 'orders';
    return 'dashboard';
  }, []);
  const isViewAllowedForRole = useCallback((view: string, role: Role): boolean => {
    return !!allowedByRole[view]?.includes(role);
  }, []);

  const handleChangeView = useCallback((nextView: string) => {
    const nextBase = String(nextView || '').split('?')[0];
    if (currentUser && !isViewAllowedForRole(nextBase, currentUser.role)) {
      const fallback = defaultViewForRole(currentUser.role);
      setCurrentView(fallback);
      return;
    }
    if (nextBase === 'create_order' || nextBase === 'create_order_template') {
      // "Nuevo pedido" siempre inicia limpio; editar usa handleEditOrder.
      setEditingOrder(null);
      editingOrderIdRef.current = null;
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
    }
    setCurrentView(nextView);
  }, [currentUser, defaultViewForRole, isViewAllowedForRole]);

  // Comprobar sesión al cargar (evita flash de login al actualizar)
  useEffect(() => {
    const savedUser = localStorage.getItem('lupo_current_user');
    const savedToken = localStorage.getItem('lupo_api_token');
    if (savedToken) setAuthToken(savedToken);

    if (!savedToken) {
      setAuthChecked(true);
      return;
    }

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
        setAuthChecked(true);
      })
      .catch(() => {
        try {
          if (savedUser) setCurrentUser(JSON.parse(savedUser) as User);
        } catch {}
        setAuthChecked(true);
      });
  }, []);

  // Restore view and load data when currentUser is set
  useEffect(() => {
    if (!currentUser) return;
    const savedView = localStorage.getItem('lupo_current_view');
    if (savedView && currentUser) {
      const role = currentUser.role;
      const isSpecial = savedView === 'create_order' || savedView === 'order_picking';
      if (!isSpecial && isViewAllowedForRole(savedView, role)) {
        setCurrentView(savedView);
      }
    }
    loadData();
  }, [currentUser, isViewAllowedForRole]);

  useEffect(() => {
    if (!currentUser) return;
    if (!isViewAllowedForRole(baseView, currentUser.role)) {
      setCurrentView(defaultViewForRole(currentUser.role));
    }
  }, [baseView, currentUser, defaultViewForRole, isViewAllowedForRole]);

  useEffect(() => {
    if (!currentUser) {
      setMyUserTasks([]);
      return;
    }
    const loadTasks = () => {
      api.getMyUserTasks().then((rows) => setMyUserTasks(Array.isArray(rows) ? rows : [])).catch(() => setMyUserTasks([]));
    };
    loadTasks();
    const timer = setInterval(loadTasks, 60000);
    return () => clearInterval(timer);
  }, [currentUser?.id]);

  // Persist current view on changes
  useEffect(() => {
    try {
      localStorage.setItem('lupo_current_view', currentView);
      if (window.location.hash.slice(1) !== currentView) {
        window.location.hash = currentView;
      }
    } catch {}
  }, [currentView]);

  useEffect(() => {
    if (baseView === 'mercadolibre_marketing') setCurrentView('mercadolibre_orders');
  }, [baseView]);

  useEffect(() => {
    if (baseView === 'create_order_template') setCurrentView('create_order');
  }, [baseView]);

  const loadData = async () => {
    setIsLoading(true);
    const orderParams = { includeArchived: orderArchivedFilter === 'yes', archivedOnly: orderArchivedFilter === 'only' };
    let customerPriceListId: string | null | undefined;

    const loadHeavyCatalog = () => {
      void (async () => {
        try {
          if (currentUser?.role === Role.CUSTOMER) {
            const [fetchedOrders, fetchedProducts] = await Promise.all([
              api.getOrders(orderParams),
              api.getProductsAll({ priceListId: customerPriceListId ?? undefined }),
            ]);
            setOrders(fetchedOrders);
            setProducts(fetchedProducts);
          } else if (currentUser) {
            const [fetchedProducts, fetchedOrders] = await Promise.all([
              api.getProductsAll({}),
              api.getOrders(orderParams),
            ]);
            setProducts(fetchedProducts);
            setOrders(fetchedOrders);
          }
        } catch (e) {
          console.error('Error cargando catálogo o pedidos', e);
          showToast('error', 'No se pudieron cargar todos los productos o pedidos. Probá recargar la página.');
        }
      })();
    };

    try {
      if (currentUser?.role === Role.CUSTOMER) {
        const myC = await api.getMyCustomer();
        customerPriceListId = myC?.priceListId;
        setMyCustomer(myC || null);
        setCustomers(myC ? [myC] : []);
        setAttributes([]);
        setTransportes([]);
      } else {
        const [fetchedColors, fetchedSizes, fetchedCustomers, fetchedTransportes] = await Promise.all([
          api.getColors(),
          api.getSizes(),
          api.getCustomers(),
          api.getTransportes(),
        ]);
        setCustomers(Array.isArray(fetchedCustomers) ? fetchedCustomers : []);
        setTransportes(Array.isArray(fetchedTransportes) ? fetchedTransportes : []);
        const colorAttrs = fetchedColors.map((c: { id: string; code?: string; name?: string; hex?: string | null }) => ({
          id: c.id,
          type: 'color',
          name: c.name ?? c.code ?? '',
          value: c.hex ?? undefined,
          code: c.code ?? '',
        })) as any;
        const sizeAttrs = fetchedSizes.map((s: { id: string; code: string; name: string }) => ({
          id: s.id,
          type: 'size',
          name: s.name || s.code || 'Sin nombre',
          code: s.code,
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
        } else if (currentUser?.role === Role.WAREHOUSE) {
          try {
            const fetchedPriceLists = await api.getPriceLists();
            setPriceLists(fetchedPriceLists);
          } catch {
            setPriceLists([]);
          }
          setUsers([]);
        } else {
          setUsers([]);
        }
      }
    } catch (error) {
      console.error('Error loading data form API', error);
      showToast('error', 'Error conectando con el servidor. Verifica que el backend esté corriendo.');
    } finally {
      setIsLoading(false);
    }

    if (currentUser) {
      const runHeavy = () => loadHeavyCatalog();
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout?: number }) => number }).requestIdleCallback(
          runHeavy,
          { timeout: 3000 }
        );
      } else {
        setTimeout(runHeavy, 200);
      }
    }
  };

  /** Al entrar a crear/editar pedido, cargar productos con la lista de precios elegida; al salir, restaurar productos del contexto normal. */
  const inCreateOrderView = baseView === 'create_order' || !!editingOrder;
  useEffect(() => {
    if (!currentUser) return;
    if (inCreateOrderView) {
      const priceListId = (currentUser.role === Role.ADMIN || currentUser.role === Role.WAREHOUSE) ? createOrderPriceListId : undefined;
      if (currentUser.role === Role.CUSTOMER) {
        api.getProductsAll({ priceListId: myCustomer?.priceListId ?? undefined }).then(setProducts);
      } else if (currentUser.role === Role.SELLER) {
        api.getProductsAll({}).then(setProducts);
      } else {
        api.getProductsAll({ priceListId: priceListId ?? undefined }).then(setProducts);
      }
    } else if (prevCreateOrderViewRef.current) {
      if (currentUser.role === Role.CUSTOMER) {
        api.getProductsAll({ priceListId: myCustomer?.priceListId ?? undefined }).then(setProducts);
      } else if (currentUser.role === Role.SELLER) {
        api.getProductsAll({}).then(setProducts);
      } else {
        api.getProductsAll({}).then(setProducts);
      }
    }
    prevCreateOrderViewRef.current = inCreateOrderView;
  }, [inCreateOrderView, createOrderPriceListId, currentUser?.role, myCustomer?.priceListId]);

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
      setCurrentView(defaultViewForRole(res.user.role));
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
      throw error;
    }
  };

  // Refrescar pedidos cuando cambia el filtro de archivados (evitar doble fetch inicial con ref)
  const orderArchivedFilterRef = useRef(orderArchivedFilter);
  useEffect(() => {
    if (!currentUser) return;
    if (orderArchivedFilterRef.current === orderArchivedFilter) return;
    orderArchivedFilterRef.current = orderArchivedFilter;
    const p = { includeArchived: orderArchivedFilter === 'yes', archivedOnly: orderArchivedFilter === 'only' };
    api.getOrders(p).then(setOrders).catch(() => {});
  }, [orderArchivedFilter, currentUser]);

  const getVisibleCustomers = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === Role.CUSTOMER) return myCustomer ? [myCustomer] : [];
    if (currentUser.role === Role.ADMIN || currentUser.role === Role.WAREHOUSE || currentUser.role === Role.DEPOSITO) return customers;
    // Vendedores solo ven los clientes asignados a ellos
    if (currentUser.role === Role.SELLER) return customers.filter(c => c.sellerId === currentUser.id);
    return customers;
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
    if (savingOrderRef.current) return;
    savingOrderRef.current = true;
    try {
      const effectiveEditId = editingOrder?.id || editingOrderIdRef.current;
      const isEditing = !!effectiveEditId && orders.some((o) => o.id === effectiveEditId);
      const orderToSave = { ...newOrder };
      if (isEditing && effectiveEditId) orderToSave.id = effectiveEditId;
      if (currentUser?.role === Role.CUSTOMER) orderToSave.sellerId = null;
      const savedOrder = isEditing ? await api.updateOrder(orderToSave) : await api.createOrder(orderToSave);
      setOrders(prev => {
        if (isEditing) {
          return prev.map(o => o.id === savedOrder.id ? savedOrder : o);
        }
        return [savedOrder, ...prev];
      });
      setEditingOrder(null);
      editingOrderIdRef.current = null;
      setCurrentView('orders');
      if (Array.isArray((savedOrder as any)?.despachoWarnings) && (savedOrder as any).despachoWarnings.length > 0) {
        const warnings = (savedOrder as any).despachoWarnings as string[];
        setDespachoWarningsToShow(warnings);
      }
      try {
        localStorage.removeItem('lupo_order_template_draft');
      } catch {
        /* ignore */
      }
    } catch (error) {
      console.error(error);
      showToast('error', editingOrder ? 'Error actualizando el pedido' : 'Error creando el pedido');
    } finally {
      savingOrderRef.current = false;
    }
  };

  const handleMatrixImportDone = useCallback(async () => {
    try {
      const list = await api.getOrders();
      setOrders(list);
    } catch {
      showToast('error', 'No se pudo actualizar la lista de pedidos');
    }
    setEditingOrder(null);
    editingOrderIdRef.current = null;
    setCurrentView('orders');
  }, [showToast]);

  const handleEditOrder = (order: Order) => {
    editingOrderIdRef.current = order.id;
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
      const roleLabel =
        newUser.role === Role.SELLER
          ? 'Vendedor'
          : newUser.role === Role.WAREHOUSE
            ? 'Depósito'
            : newUser.role === Role.CUSTOMER
              ? 'Cliente'
              : 'Administrador';
      showToast(
        'success',
        `${roleLabel} creado: puede ingresar con el email y la contraseña que definiste.`
      );
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Error al crear usuario';
      showToast('error', msg);
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

  const handleUpdateUser = async (updatedUser: User) => {
    const previous = [...users];
    setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
    try {
      const saved = await api.updateUser(updatedUser.id, {
        priceListId: updatedUser.priceListId ?? null,
        commissionPercentage: updatedUser.commissionPercentage ?? 0,
        email: updatedUser.email,
        password: updatedUser.password
      });
      setUsers(prev => prev.map(u => u.id === saved.id ? saved : u));
    } catch (err: any) {
      setUsers(previous);
      showToast('error', err?.message || 'No se pudo guardar la comisión del vendedor');
    }
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
              stock: Number((raw as any).stock_total ?? (raw as any).stock ?? 0),
              stock_total: Number((raw as any).stock_total ?? (raw as any).stock ?? 0),
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

  const handleDeleteAttribute = async (id: string) => {
    const attr = attributes.find(a => a.id === id);
    if (!attr) return;
    if (attr.type === 'size') {
      try {
        await api.deleteSize(id);
        setAttributes(prev => prev.filter(a => a.id !== id));
        showToast('success', 'Talle eliminado');
      } catch (e: any) {
        const msg = e?.response?.data?.message ?? e?.message ?? 'No se pudo eliminar el talle';
        showToast('error', msg);
      }
      return;
    }
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
    if (currentUser?.role === Role.WAREHOUSE || currentUser?.role === Role.DEPOSITO) {
      try {
        await api.updateOrderStatus(order.id, OrderStatus.PREPARING, currentUser.id);
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: OrderStatus.PREPARING, pickedBy: currentUser.id } : o));
        setActivePickingOrder({ ...order, status: OrderStatus.PREPARING, pickedBy: currentUser.id });
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
    const newStatus = OrderStatus.PENDING_CONTROL;
    const base =
      orders.find((o) => o.id === orderId) ??
      (activePickingOrder?.id === orderId ? activePickingOrder : null);
    if (!base) {
      showToast('error', 'No se encontró el pedido.');
      return;
    }
    const safeItems = updatedItems.map((i) => {
      const maxQ = Math.max(0, Math.floor(Number(i.quantity) || 0));
      const p = Math.min(maxQ, Math.max(0, Math.floor(Number(i.picked) || 0)));
      return { ...i, picked: p };
    });
    const pickingTotal =
      Math.round(
        safeItems.reduce((s, i) => s + (Number(i.picked) || 0) * (Number(i.priceAtMoment) || 0), 0) * 100
      ) / 100;

    const orderToSave: Order = {
      ...base,
      items: safeItems,
      status: base.status,
      total: pickingTotal,
    };

    try {
      const saved = await api.updateOrder(orderToSave);
      await api.updateOrderStatus(orderId, newStatus, currentUser?.id);
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...saved, status: newStatus, pickedBy: currentUser?.id } : o
        )
      );
      showToast('success', 'Picking guardado. El pedido pasó a control; la factura AFIP usará solo lo pickeado.');
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Error al guardar picking';
      showToast('error', msg);
      return;
    }

    setActivePickingOrder(null);
    setCurrentView('orders');
  };

  if (!authChecked) {
    return (
      <div className="min-h-[100dvh] min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={40} className="text-blue-500 animate-spin" />
          <p className="text-slate-400 text-sm">Cargando sesión...</p>
        </div>
      </div>
    );
  }

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
    { id: 'inventory', icon: Package, label: 'Stock', roles: [Role.ADMIN, Role.WAREHOUSE, Role.DEPOSITO] },
    { id: 'orders', icon: ShoppingCart, label: 'Pedidos', roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER, Role.DEPOSITO] },
    { id: 'customers', icon: Users, label: 'Clientes', roles: [Role.ADMIN, Role.SELLER] },
    { id: 'sellers', icon: Percent, label: 'Vendedores', roles: [Role.ADMIN, Role.SELLER] },
    { id: 'catalogs', icon: BookOpen, label: 'Catálogos', roles: [Role.ADMIN, Role.SELLER, Role.CUSTOMER] },
  ];

  const allMobileNavSections = [
    { title: 'Principal', items: [
      { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard, roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER] },
      { id: 'inventory', label: 'Inventario', icon: Package, roles: [Role.ADMIN, Role.WAREHOUSE, Role.DEPOSITO] },
      { id: 'stock_history', label: 'Historial Stock', icon: History, roles: [Role.ADMIN, Role.WAREHOUSE] },
      { id: 'despachos', label: 'Despachos', icon: Ship, roles: [Role.ADMIN] },
    ]},
    { title: 'Pedidos y canales', items: [
      { id: 'orders', label: 'Mayoristas', icon: ShoppingCart, roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER, Role.DEPOSITO] },
      { id: 'create_order', label: 'Nuevo pedido', icon: ShoppingCart, roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE, Role.CUSTOMER] },
      { id: 'bulk_invoicing', label: 'Facturación masiva', icon: FileText, roles: [Role.ADMIN, Role.WAREHOUSE] },
      { id: 'tiendanube_orders', label: 'Tienda Nube', icon: ShoppingBag, roles: [Role.ADMIN, Role.WAREHOUSE] },
      { id: 'mercadolibre_orders', label: 'Mercado Libre', icon: Zap, roles: [Role.ADMIN, Role.WAREHOUSE] },
    ]},
    { title: 'CRM y sistema', items: [
      { id: 'customers', label: 'Clientes', icon: Users, roles: [Role.ADMIN, Role.SELLER] },
      { id: 'sellers', label: 'Vendedores', icon: Percent, roles: [Role.ADMIN, Role.SELLER] },
      { id: 'visits', label: 'Visitas', icon: MapPin, roles: [Role.ADMIN, Role.SELLER] },
      { id: 'catalogs', label: 'Catálogos', icon: BookOpen, roles: [Role.ADMIN, Role.SELLER, Role.CUSTOMER] },
      { id: 'facturacion', label: 'Facturación', icon: DollarSign, roles: [Role.ADMIN, Role.SELLER, Role.WAREHOUSE] },
      { id: 'settings', label: 'Configuración', icon: SettingsIcon, roles: [Role.ADMIN, Role.WAREHOUSE] },
    ]},
  ];

  const showDamianTasksBanner =
    !!currentUser.email &&
    currentUser.email.trim().toLowerCase() === DAMIAN_TASKS_BANNER_EMAIL &&
    Date.now() < DAMIAN_TASKS_BANNER_UNTIL_MS;
  const canManageAssignedTasks =
    !!currentUser.email && currentUser.email.trim().toLowerCase() === ARIEL_TASKS_OWNER_EMAIL;

  return (
    <div className="flex w-full bg-slate-950 text-slate-200 flex-col md:flex-row min-h-[100dvh] h-[100dvh] md:h-screen overflow-hidden">
      <div className="hidden md:block shrink-0">
        <Sidebar 
          currentView={baseView} 
          onChangeView={handleChangeView} 
          userRole={currentUser.role}
          onLogout={handleLogout}
        />
      </div>
      
      <main className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto pl-4 pr-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] md:p-8 md:ml-64 relative scroll-area-ios">
        {isLoading && (
          <div className="fixed inset-0 bg-slate-950/80 z-[200] flex flex-col items-center justify-center backdrop-blur-sm pt-[env(safe-area-inset-top)] pointer-events-auto">
             <Loader2 size={48} className="text-blue-500 animate-spin mb-4" />
             <p className="text-white font-bold">Sincronizando datos...</p>
          </div>
        )}

        <div className="max-w-6xl mx-auto pb-24 md:pb-8 w-full overflow-x-hidden px-1 sm:px-0">
          {showDamianTasksBanner && (
            <div
              role="status"
              aria-live="polite"
              className="mb-6 rounded-2xl border-2 border-amber-400/90 bg-gradient-to-br from-amber-950 via-amber-900/95 to-orange-950 p-5 sm:p-8 shadow-xl shadow-amber-900/40 ring-1 ring-amber-500/30"
            >
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                <div className="flex shrink-0 justify-center sm:justify-start">
                  <div className="rounded-2xl bg-amber-500/20 p-4 border border-amber-400/40">
                    <Megaphone className="text-amber-300 w-12 h-12 sm:w-16 sm:h-16" strokeWidth={2} aria-hidden />
                  </div>
                </div>
                <div className="min-w-0 flex-1 text-center sm:text-left">
                  <p className="text-amber-200/90 text-xs sm:text-sm font-bold uppercase tracking-widest mb-2">
                    Tareas prioritarias — próximas 24 horas
                  </p>
                  <h2 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-black text-white leading-tight mb-4">
                    Medias: stock, sincronización y publicaciones
                  </h2>
                  <ol className="list-decimal list-inside space-y-3 text-base sm:text-lg md:text-xl text-amber-50 font-semibold leading-relaxed max-w-4xl mx-auto sm:mx-0">
                    <li>Controlar el stock de medias en Mercado Libre y Tienda Nube.</li>
                    <li>Sincronizarlos.</li>
                    <li>Una vez que termine eso, fijarse las que no están publicadas y publicarlas.</li>
                  </ol>
                </div>
              </div>
            </div>
          )}
          {myUserTasks.length > 0 && (
            <div className="mb-5 space-y-2">
              {myUserTasks.map((t) => (
                <div
                  key={t.id}
                  className="rounded-xl border border-amber-600/60 bg-amber-900/25 px-4 py-3 text-amber-100"
                >
                  <p className="font-semibold">{t.message}</p>
                  <p className="text-xs text-amber-200/80 mt-1">
                    Vigente hasta {new Date(t.expiresAt).toLocaleString('es-AR')}
                  </p>
                </div>
              ))}
            </div>
          )}
          <header className="mb-4 md:mb-6 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
             <div className="min-w-0">
               <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white truncate">
                 {baseView === 'dashboard' && 'Hola, ' + currentUser.name.split(' ')[0]}
                 {baseView === 'inventory' && 'Inventario'}
                 {baseView === 'orders' && (currentUser.role === Role.CUSTOMER ? 'Mis pedidos' : 'Pedidos Mayoristas')}
                {baseView === 'bulk_invoicing' && 'Facturación masiva'}
                 {baseView === 'tiendanube_orders' && 'Tienda Nube'}
                 {baseView === 'mercadolibre_orders' && 'Mercado Libre'}
                 {baseView === 'mercadolibre_canal_difusion' && 'Canal de difusión — Mercado Libre'}
                 {baseView === 'mercadolibre_product_ads' && 'Product Ads — campañas y publicaciones'}
                 {baseView === 'mercadolibre_brand_ads' && 'Brand Ads — campañas'}
                 {baseView === 'mercadolibre_display_ads' && 'Display Ads — campañas'}
                 {baseView === 'mercadolibre_stock' && 'Stock Mercado Libre'}
                 {baseView === 'stock_history' && 'Historial de Stock'}
                 {baseView === 'despachos' && 'Despachos'}
                 {baseView === 'customers' && 'Clientes'}
                 {baseView === 'sellers' && (currentUser.role === Role.SELLER ? 'Mis comisiones' : 'Vendedores y comisiones')}
                 {baseView === 'catalogs' && 'Catálogos'}
                 {baseView === 'visits' && 'Visitas'}
                 {baseView === 'settings' && 'Configuración'}
                 {baseView === 'facturacion' && 'Facturación'}
                 {baseView === 'create_order' && (editingOrder ? 'Editar Pedido (Plantilla)' : 'Nuevo Pedido (Plantilla)')}
                 {baseView === 'create_order_template' && 'Nuevo Pedido (Plantilla)'}
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
              <Dashboard
                products={products}
                orders={orders}
                role={currentUser.role}
                onNavigate={handleChangeView}
                currentUserId={currentUser.id}
                customers={getVisibleCustomers}
              />
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
                transportes={transportes}
                users={users} role={currentUser.role} currentUserId={currentUser.id}
                orderArchivedFilter={orderArchivedFilter}
                setOrderArchivedFilter={setOrderArchivedFilter}
                refreshOrders={() => api.getOrders({ includeArchived: orderArchivedFilter === 'yes', archivedOnly: orderArchivedFilter === 'only' }).then(setOrders)}
                onUpdateStatus={handleUpdateOrderStatus} onCreateOrder={handleCreateOrder}
                onNavigate={handleChangeView} onStartPicking={handleStartPicking}
                onEditOrder={handleEditOrder}
                onDeleteOrder={handleDeleteOrder}
                onFacturaEmitida={(orderId, invoice) => setOrders(prev => prev.map(o => o.id === orderId ? { ...o, invoice } : o))}
                onCreditNoteEmitida={(orderId) => setOrders(prev => prev.map(o => o.id === orderId ? { ...o, creditNotesCount: (o.creditNotesCount ?? 0) + 1 } : o))}
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
                onRefreshData={loadData}
                priceLists={priceLists}
                transportes={transportes}
                orders={orders}
                products={products}
                users={users}
              />
            </Suspense>
          )}
          {baseView === 'sellers' && (
            <Suspense fallback={<ViewFallback />}>
              <SellersCommissions
                orders={orders}
                users={users}
                customers={getVisibleCustomers}
                role={currentUser.role}
                currentUser={currentUser}
                onUpdateUser={currentUser.role === Role.ADMIN ? handleUpdateUser : undefined}
              />
            </Suspense>
          )}
          {baseView === 'visits' && (
            <Suspense fallback={<ViewFallback />}>
              <Visits visits={MOCK_VISITS} role={currentUser.role} />
            </Suspense>
          )}
          {baseView === 'facturacion' && (
            <Suspense fallback={<ViewFallback />}>
              <Billing role={currentUser.role} customers={customers} users={users} products={products} />
            </Suspense>
          )}
          {baseView === 'settings' && (
            <Suspense fallback={<ViewFallback />}>
              <>
                {canManageAssignedTasks && (
                  <UserTaskManager users={users} />
                )}
                <Settings 
                  attributes={attributes} 
                  onCreateAttribute={handleCreateAttribute} 
                  onDeleteAttribute={handleDeleteAttribute} 
                  onRefreshData={loadData}
                  role={currentUser.role} 
                  users={users}
                  onUpdateUser={handleUpdateUser}
                  onCreateUser={handleCreateUser}
                  onDeleteUser={handleDeleteUser}
                  currentUser={currentUser}
                  transportes={transportes}
                  onCreateTransporte={async (name, address) => {
                    const t = await api.createTransporte(name, address);
                    setTransportes(prev => [...prev, t]);
                  }}
                  onUpdateTransporte={async (id, name, address) => {
                    const t = await api.updateTransporte(id, name, address);
                    setTransportes(prev => prev.map(x => x.id === id ? t : x));
                  }}
                  onDeleteTransporte={async (id) => {
                    await api.deleteTransporte(id);
                    setTransportes(prev => prev.filter(x => x.id !== id));
                  }}
                />
              </>
            </Suspense>
          )}
          {baseView === 'create_order' || baseView === 'create_order_template' ? (
            <Suspense fallback={<ViewFallback />}>
              <CreateOrderTemplate
                products={products}
                customers={getVisibleCustomers}
                onSave={handleCreateOrder}
                onCancel={() => { setEditingOrder(null); editingOrderIdRef.current = null; setCurrentView('orders'); }}
                sellerId={currentUser.role === Role.CUSTOMER ? undefined : currentUser.id}
                initialOrder={editingOrder}
                role={currentUser.role}
                priceLists={priceLists}
                selectedPriceListId={createOrderPriceListId}
                onPriceListChange={setCreateOrderPriceListId}
                readOnly={!!editingOrder?.invoice}
                onMatrixImportDone={handleMatrixImportDone}
              />
            </Suspense>
          ) : null}
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
          {baseView === 'bulk_invoicing' && (
            <Suspense fallback={<ViewFallback />}>
              <BulkInvoicing />
            </Suspense>
          )}
          {baseView === 'mercadolibre_orders' && (
            <Suspense fallback={<ViewFallback />}>
              <MercadoLibreOrders />
            </Suspense>
          )}
          {baseView === 'mercadolibre_canal_difusion' && (
            <Suspense fallback={<ViewFallback />}>
              <MercadoLibreCanalDifusion onNavigate={handleChangeView} />
            </Suspense>
          )}
          {baseView === 'mercadolibre_product_ads' && (
            <Suspense fallback={<ViewFallback />}>
              <MercadoLibreProductAds />
            </Suspense>
          )}
          {baseView === 'mercadolibre_brand_ads' && (
            <Suspense fallback={<ViewFallback />}>
              <MercadoLibreBrandAds />
            </Suspense>
          )}
          {baseView === 'mercadolibre_display_ads' && (
            <Suspense fallback={<ViewFallback />}>
              <MercadoLibreDisplayAds />
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
              onClick={() => handleChangeView(item.id)}
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

      {/* Modal: avisos de artículos sin despacho al guardar un pedido */}
      {despachoWarningsToShow && despachoWarningsToShow.length > 0 && (() => {
        const canGoToDespachos = currentUser?.role === Role.ADMIN;
        const closeModal = () => setDespachoWarningsToShow(null);
        return (
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[80] flex items-center justify-center p-4"
            onClick={closeModal}
          >
            <div
              className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-6 pb-4 border-b border-slate-800">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-10 h-10 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center">
                    <AlertCircle size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-bold text-lg leading-tight">Artículos sin número de despacho</h3>
                    <p className="text-slate-400 text-sm mt-1">
                      El pedido se guardó correctamente, pero algunas unidades quedaron sin despacho asignado.
                      Asignales un número en la sección Despachos para que aparezcan completas en remito y factura.
                    </p>
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 max-h-[50vh] overflow-y-auto">
                <ul className="space-y-2">
                  {despachoWarningsToShow.map((w, idx) => (
                    <li
                      key={idx}
                      className="text-sm text-slate-200 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 leading-relaxed"
                    >
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="px-6 pb-6 pt-2 flex flex-wrap gap-3 justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2.5 rounded-xl font-semibold text-slate-300 hover:bg-slate-800 transition"
                >
                  Cerrar
                </button>
                {canGoToDespachos && (
                  <button
                    type="button"
                    onClick={() => {
                      closeModal();
                      handleChangeView('despachos');
                    }}
                    className="px-5 py-2.5 rounded-xl font-bold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-2 transition"
                  >
                    <Ship size={18} /> Ir a Despachos
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
                            onClick={() => { handleChangeView(item.id); setMobileMenuOpen(false); }}
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
