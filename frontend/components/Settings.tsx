import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Tag, Palette, Cloud, Zap, RefreshCw, Link, ExternalLink, Check, AlertCircle, Loader2, Power, Save, Key, User as UserIcon, DollarSign, Shield, Mail, Lock, AlertTriangle, X, Package, Smartphone, Copy, FileUp, FileSpreadsheet, Pencil, Ship, FileText, Receipt, Download, Bot, Upload } from 'lucide-react';
import { Attribute, Role, ApiConfig, User, PriceList } from '../types';
import { api } from '../services/api';
import { getApiConfig, saveApiConfig, getRemitente, saveRemitente } from '../services/apiIntegration';
import { setBaseUrl, setAuthToken, request } from '../services/httpClient';
import { useNotification } from '../context/NotificationContext';
import * as XLSX from 'xlsx';
import { parseSellersExcel } from '../utils/sellersImportUtils';
import {
  exportPriceListExcelStyled,
  downloadPriceListTemplateStyled,
} from '../utils/priceListExcel';

/** Descarga plantilla Excel con todos los artículos (Código + Precio vacío) para completar y importar. */
function downloadSellersImportTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Nombre', 'Email', 'Contraseña (opcional)', 'Comisión % (opcional)'],
    ['María García', 'maria@vendedora.com', '', '5'],
    ['Juan Pérez', 'juan@vendedora.com', 'MiClave123', '']
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Vendedores');
  XLSX.writeFile(wb, 'plantilla-importar-vendedores.xlsx');
}

function ymdToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parsea Excel para lista de precios. Detecta columnas por cabecera (Artículo, Código, Precio, etc.). Si todas las variantes tienen el mismo precio, una fila por artículo basta. */
async function parsePriceListExcel(file: File): Promise<{ sku: string; price: number }[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' }) as (string | number)[][];
  if (rows.length === 0) return [];
  const first = rows[0].map(c => String(c ?? '').trim());
  const firstLower = first.map(h => h.toLowerCase());
  // Nombres típicos en listas de precios (es-AR): artículo/código y precio
  const skuKw = ['sku', 'código', 'codigo', 'articulo', 'artículo', 'art', 'cod', 'article', 'descripción', 'producto', 'item'];
  const priceKw = ['precio', 'price', 'importe', 'precio unitario', 'p. unit', 'p.unit', 'unitario', 'lista', 'precio lista', 'valor', 'pvp'];
  let skuCol = firstLower.findIndex(h => skuKw.some(k => (h || '').includes(k)));
  let priceCol = firstLower.findIndex(h => priceKw.some(k => (h || '').includes(k)));
  if (skuCol < 0) skuCol = 0;
  if (priceCol < 0) priceCol = 1;
  if (priceCol === skuCol) priceCol = skuCol + 1;
  const looksLikeHeader = (val: string) => !/^\d+$/.test(String(val).trim()) && (firstLower[skuCol] && skuKw.some(k => firstLower[skuCol].includes(k)) || firstLower[priceCol] && priceKw.some(k => firstLower[priceCol].includes(k)));
  const start = looksLikeHeader(firstLower[skuCol] + firstLower[priceCol]) ? 1 : 0;
  const items: { sku: string; price: number }[] = [];
  for (let i = start; i < rows.length; i++) {
    const rawSku = rows[i][skuCol];
    const p = rows[i][priceCol];
    let sku = rawSku == null ? '' : typeof rawSku === 'number' ? String(rawSku) : String(rawSku).trim();
    if (sku && typeof rawSku === 'number' && sku.length <= 8) sku = sku.padStart(Math.max(sku.length, 7), '0');
    const price = typeof p === 'number' ? p : parseFloat(String(p ?? '0').replace(/[^\d.,-]/g, '').replace(',', '.'));
    if (sku && !isNaN(price) && price >= 0) items.push({ sku, price });
  }
  return items;
}

const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) => {
  if (!isOpen) return null;
  const maxW =
    size === 'xl'
      ? 'sm:max-w-5xl'
      : size === 'lg'
        ? 'sm:max-w-3xl'
        : 'sm:max-w-md';
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-0 sm:p-4 animate-fade-in overflow-y-auto pt-[env(safe-area-inset-top)] sm:pt-0">
      <div className={`bg-slate-900 border-0 sm:border border-slate-700 rounded-none sm:rounded-3xl w-full ${maxW} min-h-[100dvh] sm:min-h-0 max-h-[100dvh] sm:max-h-[90vh] shadow-2xl overflow-hidden animate-slide-up flex flex-col my-0 sm:my-4`}>
        <div className="p-4 sm:p-6 border-b border-slate-800 flex justify-between items-center shrink-0">
          <h3 className="font-bold text-white text-lg truncate pr-2">{title}</h3>
          <button onClick={onClose} className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white transition-colors touch-manipulation rounded-xl -mr-2" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0 touch-scroll">
          {children}
        </div>
        {footer && (
          <div className="p-4 sm:p-6 pt-0 flex justify-end gap-3 shrink-0 border-t border-slate-800/50">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

interface SettingsProps {
  attributes: Attribute[];
  onCreateAttribute: (attr: Attribute) => void;
  onDeleteAttribute: (id: string) => void;
  onRefreshData?: () => void;
  role: Role;
  users?: User[];
  onUpdateUser?: (user: User) => void | Promise<void>;
  onCreateUser?: (user: User) => void | Promise<void>;
  onDeleteUser?: (id: string) => void | Promise<void>;
  currentUser?: User;
  transportes?: import('../types').Transporte[];
  onCreateTransporte?: (name: string, address?: string) => void | Promise<void>;
  onUpdateTransporte?: (id: string, name: string, address?: string) => void | Promise<void>;
  onDeleteTransporte?: (id: string) => void | Promise<void>;
  /** Si se pasa, al montar se selecciona esta pestaña (ej. desde el menú "Facturación"). */
  initialTab?: 'facturacion';
}

const Settings: React.FC<SettingsProps> = ({
  attributes, onCreateAttribute, onDeleteAttribute, onRefreshData, role,
  users = [], onUpdateUser, onCreateUser, onDeleteUser, currentUser,
  transportes = [], onCreateTransporte, onUpdateTransporte, onDeleteTransporte,
  initialTab
}) => {
  const { showToast, showConfirm } = useNotification();
  const [activeTab, setActiveTab] = useState<'sizes' | 'colors' | 'integrations' | 'users' | 'pricelists' | 'transportes' | 'facturacion'>(initialTab ?? (role === Role.WAREHOUSE ? 'sizes' : 'users'));
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);
  const [newName, setNewName] = useState('');
  const [newColorCode, setNewColorCode] = useState('');
  const [newColorValue, setNewColorValue] = useState('#000000');
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const [editingColorCode, setEditingColorCode] = useState('');
  const [editingColorName, setEditingColorName] = useState('');
  const [editingColorHex, setEditingColorHex] = useState('#000000');
  const [savingColor, setSavingColor] = useState(false);
  const [importingStandardColors, setImportingStandardColors] = useState(false);
  const [mergingFourDigitColors, setMergingFourDigitColors] = useState(false);

  // Integration State
  const [apiConfig, setApiConfig] = useState<ApiConfig>({
    tiendaNube: { accessToken: '', storeId: '', userAgent: '' },
    mercadoLibre: { accessToken: '', userId: '' }
  });
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(localStorage.getItem('lupo_api_base') || (import.meta.env?.VITE_API_URL as string) || 'http://localhost:3001/api');
  const [apiToken, setApiTokenState] = useState<string>(localStorage.getItem('lupo_api_token') || '');
  const [saved, setSaved] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthResult, setHealthResult] = useState<'' | 'ok' | 'error'>('');
  const [healthMessage, setHealthMessage] = useState<string>('');

  // Integration Logic
  const [integrations, setIntegrations] = useState<{ mercadolibre: boolean; tiendanube: boolean; tiendanubeStoreId?: string | null }>({ mercadolibre: false, tiendanube: false });
  const [loadingIntegrations, setLoadingIntegrations] = useState(false);
  const [lupoWebhookConfig, setLupoWebhookConfig] = useState({
    enabled: false,
    webhookUrl: '',
    apiKey: '',
    webhookSecret: '',
    keepExistingApiKey: true,
    keepExistingSecret: true,
    hasApiKey: false,
    hasWebhookSecret: false,
    apiKeyMasked: '',
    webhookSecretMasked: '',
    timeoutMs: 10000,
    maxRetries: 4,
    backoffBaseMs: 1000,
    source: 'env' as 'db' | 'env'
  });
  const [savingLupoWebhook, setSavingLupoWebhook] = useState(false);
  const [testingLupoWebhook, setTestingLupoWebhook] = useState(false);
  const [lupoWebhookLastResult, setLupoWebhookLastResult] = useState<any | null>(null);
  const [syncingLupoShopMlStock, setSyncingLupoShopMlStock] = useState(false);
  const [lupoShopMlSyncResult, setLupoShopMlSyncResult] = useState<{
    ok: boolean;
    message?: string;
    variantCount: number;
    batchesTotal: number;
    batchesOk: number;
    batchesFailed: number;
    errors: { batchIndex: number; status?: number; error?: string }[];
  } | null>(null);

  // Mercado Libre Test Connection
  const [mlTestLoading, setMlTestLoading] = useState(false);
  const [mlTestResult, setMlTestResult] = useState<{ success: boolean; message: string; details: any } | null>(null);
  const [showMlTestModal, setShowMlTestModal] = useState(false);

  // Mercado Libre Sync
  const [mlSyncLoading, setMlSyncLoading] = useState(false);
  const [mlSyncResult, setMlSyncResult] = useState<{ message: string; linkedVariants: number; linkedProducts?: number; notFound?: number; totalItems?: number; logs: string[] } | null>(null);
  const [showMlSyncModal, setShowMlSyncModal] = useState(false);

  const [loadingSync, setLoadingSync] = useState(false);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);
  const [syncCompleted, setSyncCompleted] = useState(false);
  const [syncStats, setSyncStats] = useState({ imported: 0, updated: 0, productCount: 0, variantCount: 0 });
  const [loadingNormalizeSizes, setLoadingNormalizeSizes] = useState(false);
  const [showNormalizeSizesModal, setShowNormalizeSizesModal] = useState(false);
  const [loadingNormalizeColors, setLoadingNormalizeColors] = useState(false);
  const [loadingSyncTnSkus, setLoadingSyncTnSkus] = useState(false);
  const [showNormalizeColorsModal, setShowNormalizeColorsModal] = useState(false);
  const [normalizeColorsResult, setNormalizeColorsResult] = useState<{
    updatedVariants: number;
    skippedProducts: number;
    skippedDuplicates?: number;
    mergedVariants?: number;
    logs: string[];
  } | null>(null);
  const [loadingUnifySizes, setLoadingUnifySizes] = useState(false);
  const [normalizeSizesResult, setNormalizeSizesResult] = useState<{
    updatedVariants: number;
    skippedProducts: number;
    skippedDuplicates?: number;
    mergedVariants?: number;
    logs: string[];
  } | null>(null);
  const groupedLogs = React.useMemo(() => {
    const groups: { product: string; variants: string[]; errors: string[] }[] = [];
    let current: { product: string; variants: string[]; errors: string[] } | null = null;
    for (const line of syncLogs) {
      const trimmed = line.trim();
      if (line.startsWith('[Sync] Processing Product:')) {
        const namePart = line.split('[Sync] Processing Product:')[1] || '';
        const productName = namePart.split('(ID:')[0].trim();
        if (current) groups.push(current);
        current = { product: productName || line, variants: [], errors: [] };
      } else if (trimmed.startsWith('[Variant]')) {
        if (!current) current = { product: 'Producto', variants: [], errors: [] };
        current.variants.push(trimmed);
      } else if (line.includes('[ERROR]')) {
        if (!current) current = { product: 'Producto', variants: [], errors: [] };
        current.errors.push(line);
      } else {
        if (!current) current = { product: 'Producto', variants: [], errors: [] };
        current.variants.push(line);
      }
    }
    if (current) groups.push(current);
    return groups;
  }, [syncLogs]);

  // Modals State
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteStep, setDeleteStep] = useState(1); // 1: Warning, 2: Confirmation

  // Stock Sync State
  const [tnStockSyncLoading, setTnStockSyncLoading] = useState(false);
  const [mlStockSyncLoading, setMlStockSyncLoading] = useState(false);
  const [mlStockSyncIsImport, setMlStockSyncIsImport] = useState(false);
  const [stockSyncResult, setStockSyncResult] = useState<{ platform: string; updated: number; errors: number; logs: string[] } | null>(null);
  const [showStockSyncModal, setShowStockSyncModal] = useState(false);
  const [mlPublicationsExportLoading, setMlPublicationsExportLoading] = useState(false);
  const [mlReportFrom, setMlReportFrom] = useState(() => ymdDaysAgo(30));
  const [mlReportTo, setMlReportTo] = useState(() => ymdToday());
  const [tnSalesReportLoading, setTnSalesReportLoading] = useState(false);
  const [tnSalesFrom, setTnSalesFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
  const [tnSalesTo, setTnSalesTo] = useState(() => ymdToday());
  const [tnSalesProducts, setTnSalesProducts] = useState('');

  // ML Auto Message Config
  const [mlAutoMessageEnabled, setMlAutoMessageEnabled] = useState(true);
  const [mlAutoMessageTemplate, setMlAutoMessageTemplate] = useState('');
  const [mlAutoMessageLoading, setMlAutoMessageLoading] = useState(false);
  const [mlAutoMessageSaved, setMlAutoMessageSaved] = useState(false);

  const [mlQuestionsAiEnabled, setMlQuestionsAiEnabled] = useState(false);
  const [mlQuestionsAiExtraPrompt, setMlQuestionsAiExtraPrompt] = useState('');
  const [mlQuestionsAiOpenAiOk, setMlQuestionsAiOpenAiOk] = useState(false);
  const [mlQuestionsAiLlmLabel, setMlQuestionsAiLlmLabel] = useState('');
  const [mlQuestionsAiLoading, setMlQuestionsAiLoading] = useState(false);
  const [mlQuestionsAiProcessLoading, setMlQuestionsAiProcessLoading] = useState(false);
  const [mlQuestionsAiSaved, setMlQuestionsAiSaved] = useState(false);

  useEffect(() => {
    // Al volver de OAuth: solo marcar "guardado" y actualizar estado. NO ejecutar importación/sync de productos.
    const hash = window.location.hash;
    if (hash.includes('status=success')) {
       setSaved(true);
       setTimeout(() => setSaved(false), 4000);
       // Limpiar la URL para no dejar status=success en el hash (evita confusión y que se repita el mensaje)
       const cleanHash = hash.replace(/\?status=success(&platform=[^&]*)?/i, '').replace(/\?$/, '') || 'settings';
       setTimeout(() => { window.location.replace('#' + cleanHash); }, 100);
    }

    // Fetch integration status (solo ver si está conectado; no dispara carga de productos)
    const fetchStatus = async () => {
      setLoadingIntegrations(true);
      try {
        const status = await api.getIntegrationStatus();
        setIntegrations(status);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingIntegrations(false);
      }
    };
    fetchStatus();

    const fetchLupoWebhookConfig = async () => {
      try {
        const cfg = await api.getLupoWebhookConfig();
        setLupoWebhookConfig(prev => ({
          ...prev,
          enabled: !!cfg.enabled,
          webhookUrl: cfg.webhookUrl || '',
          hasApiKey: !!cfg.hasApiKey,
          hasWebhookSecret: !!cfg.hasWebhookSecret,
          apiKeyMasked: cfg.apiKeyMasked || '',
          webhookSecretMasked: cfg.webhookSecretMasked || '',
          timeoutMs: Number(cfg.timeoutMs) || 10000,
          maxRetries: Number(cfg.maxRetries) || 4,
          backoffBaseMs: Number(cfg.backoffBaseMs) || 1000,
          source: cfg.source || 'env',
          webhookSecret: '',
          keepExistingApiKey: true,
          keepExistingSecret: true
        }));
      } catch (e) {
        console.error(e);
      }
    };
    fetchLupoWebhookConfig();

    // Fetch ML auto message config
    const fetchMLAutoMessage = async () => {
      try {
        const config = await api.getMLAutoMessageConfig();
        setMlAutoMessageEnabled(config.enabled);
        setMlAutoMessageTemplate(config.messageTemplate);
      } catch (e) {
        console.error(e);
      }
    };
    fetchMLAutoMessage();

    const fetchMlQuestionsAi = async () => {
      try {
        const cfg = await api.getMLQuestionsAiConfig();
        setMlQuestionsAiEnabled(cfg.enabled);
        setMlQuestionsAiExtraPrompt(cfg.extraSystemPrompt || '');
        setMlQuestionsAiOpenAiOk(!!cfg.openAiConfigured);
        setMlQuestionsAiLlmLabel(cfg.llmLabel || '');
      } catch (e) {
        console.error(e);
      }
    };
    fetchMlQuestionsAi();
  }, []);

  const handleConnect = async (platform: 'mercadolibre' | 'tiendanube') => {
    try {
      const { url } = await api.getAuthUrl(platform);
      if (url) {
        window.location.href = url;
      } else {
        showToast('error', 'No se pudo obtener la URL de autenticación');
      }
    } catch (e) {
      showToast('error', 'Error iniciando conexión');
    }
  };
  
  const handleSyncMercadoLibre = async () => {
    setShowMlSyncModal(true);
    setMlSyncLoading(true);
    setMlSyncResult(null);
    try {
      const res = await api.syncProductsFromMercadoLibre();
      setMlSyncResult(res);
    } catch (e: any) {
      setMlSyncResult({ message: 'Error sincronizando', linkedVariants: 0, logs: [e.message || 'Error desconocido'] });
    } finally {
      setMlSyncLoading(false);
    }
  };

  const handleDisconnect = async (platform: 'mercadolibre' | 'tiendanube') => {
    try {
      await api.disconnectIntegration(platform);
      setIntegrations(prev => ({ ...prev, [platform]: false }));
    } catch {
      showToast('error', 'Error desconectando');
    }
  };

  const handleTestMercadoLibre = async () => {
    setShowMlTestModal(true);
    setMlTestLoading(true);
    setMlTestResult(null);
    try {
      const res = await api.testMercadoLibreConnection();
      setMlTestResult(res);
    } catch (e: any) {
      setMlTestResult({ success: false, message: 'Error de conexión', details: e.message });
    } finally {
      setMlTestLoading(false);
    }
  };

  const handleSaveLupoWebhookConfig = async () => {
    setSavingLupoWebhook(true);
    try {
      const res = await api.saveLupoWebhookConfig({
        enabled: lupoWebhookConfig.enabled,
        webhookUrl: lupoWebhookConfig.webhookUrl,
        apiKey: lupoWebhookConfig.apiKey,
        webhookSecret: lupoWebhookConfig.webhookSecret,
        keepExistingApiKey: lupoWebhookConfig.keepExistingApiKey,
        keepExistingSecret: lupoWebhookConfig.keepExistingSecret,
        timeoutMs: lupoWebhookConfig.timeoutMs,
        maxRetries: lupoWebhookConfig.maxRetries,
        backoffBaseMs: lupoWebhookConfig.backoffBaseMs
      });
      const cfg = res?.config;
      if (cfg) {
        setLupoWebhookConfig(prev => ({
          ...prev,
          enabled: !!cfg.enabled,
          webhookUrl: cfg.webhookUrl || '',
          hasApiKey: !!cfg.hasApiKey,
          hasWebhookSecret: !!cfg.hasWebhookSecret,
          apiKeyMasked: cfg.apiKeyMasked || '',
          webhookSecretMasked: cfg.webhookSecretMasked || '',
          timeoutMs: Number(cfg.timeoutMs) || 10000,
          maxRetries: Number(cfg.maxRetries) || 4,
          backoffBaseMs: Number(cfg.backoffBaseMs) || 1000,
          source: cfg.source || 'db',
          webhookSecret: '',
          keepExistingApiKey: true,
          keepExistingSecret: true
        }));
      }
      showToast('success', 'Configuración de webhook guardada.');
    } catch (e: any) {
      showToast('error', e?.message || 'No se pudo guardar la configuración del webhook.');
    } finally {
      setSavingLupoWebhook(false);
    }
  };

  const handleTestLupoWebhook = async () => {
    setTestingLupoWebhook(true);
    setLupoWebhookLastResult(null);
    try {
      const result = await api.testLupoWebhook();
      setLupoWebhookLastResult(result);
      if (result?.ok) showToast('success', result?.duplicate ? 'Prueba OK (idempotente/duplicado).' : 'Prueba de webhook enviada OK.');
      else showToast('error', `Prueba fallida (${result?.status || 'sin status'}).`);
    } catch (e: any) {
      setLupoWebhookLastResult({ ok: false, error: e?.message || 'Error' });
      showToast('error', e?.message || 'Error enviando prueba de webhook.');
    } finally {
      setTestingLupoWebhook(false);
    }
  };

  /** Stock LupoHub de variantes con vínculo ML → webhook tienda (masivo). */
  const handleSyncLupoShopMlStock = async () => {
    setSyncingLupoShopMlStock(true);
    setLupoShopMlSyncResult(null);
    try {
      const result = await api.syncLupoShopMlStockBulk();
      setLupoShopMlSyncResult(result);
      if (result.ok) {
        showToast(
          'success',
          result.variantCount === 0
            ? result.message || 'No hay variantes con Mercado Libre vinculado.'
            : `Enviado a la tienda: ${result.variantCount} variantes (${result.batchesOk} lote(s)).`
        );
      } else {
        showToast('error', result.message || `Fallaron ${result.batchesFailed} lote(s) de ${result.batchesTotal}.`);
      }
    } catch (e: any) {
      setLupoShopMlSyncResult({
        ok: false,
        variantCount: 0,
        batchesTotal: 0,
        batchesOk: 0,
        batchesFailed: 0,
        errors: [],
        message: e?.message
      });
      showToast('error', e?.message || 'Error enviando stock a la tienda.');
    } finally {
      setSyncingLupoShopMlStock(false);
    }
  };

  // Sincronizar stock a Tienda Nube
  const handleSyncStockToTiendaNube = async () => {
    setShowStockSyncModal(true);
    setTnStockSyncLoading(true);
    setStockSyncResult(null);
    try {
      const res = await api.syncStockToTiendaNube();
      setStockSyncResult({ platform: 'Tienda Nube', updated: res.updated, errors: res.errors, logs: res.logs });
      if (res.errors > 0) {
        showToast('error', `Tienda Nube: ${res.updated} actualizadas, ${res.errors} errores.`);
      } else if (res.updated > 0) {
        showToast('success', `Tienda Nube: ${res.updated} variantes sincronizadas.`);
      } else {
        showToast('info', 'Tienda Nube: no hubo variantes para sincronizar (revisá vínculos TN).');
      }
    } catch (e: any) {
      setStockSyncResult({ platform: 'Tienda Nube', updated: 0, errors: 1, logs: [e.message || 'Error desconocido'] });
      showToast('error', e?.message || 'Error al sincronizar stock a Tienda Nube');
    } finally {
      setTnStockSyncLoading(false);
    }
  };

  // Sincronizar stock de la app hacia Mercado Libre (app = fuente de verdad)
  const handleSyncStockToMercadoLibre = async () => {
    setShowStockSyncModal(true);
    setMlStockSyncLoading(true);
    setMlStockSyncIsImport(false);
    setStockSyncResult(null);
    try {
      const res = await api.syncStockToMercadoLibre();
      setStockSyncResult({ platform: 'Mercado Libre', updated: res.updated, errors: res.errors, logs: res.logs });
      if (res.errors > 0) {
        showToast('error', `Mercado Libre: ${res.updated} actualizadas, ${res.errors} errores.`);
      } else if (res.updated > 0) {
        showToast('success', `Mercado Libre: ${res.updated} variantes sincronizadas.`);
      } else {
        showToast('info', 'Mercado Libre: no hubo variantes para sincronizar (revisá vínculos ML).');
      }
    } catch (e: any) {
      setStockSyncResult({ platform: 'Mercado Libre', updated: 0, errors: 1, logs: [e.message || 'Error desconocido'] });
      showToast('error', e?.message || 'Error al sincronizar stock a Mercado Libre');
    } finally {
      setMlStockSyncLoading(false);
    }
  };

  // Sincronizar los 3: ML (fuente de verdad) → LupoHub → Tienda Nube
  const handleSyncAllFromMercadoLibre = async () => {
    setShowStockSyncModal(true);
    setMlStockSyncLoading(true);
    setMlStockSyncIsImport(true);
    setStockSyncResult(null);
    try {
      const res = await api.syncAllStockFromMercadoLibre();
      setStockSyncResult({
        platform: 'ML → LupoHub → TN',
        updated: res.importedFromML + res.sentToTN,
        errors: res.errorsFromML + res.errorsToTN,
        logs: res.logs || []
      });
      if (res.logs?.length) {
        console.group('[LupoHub] Sincronizar los 3 (ML = real) - Logs');
        res.logs.forEach((line: string) => console.log(line));
        console.groupEnd();
      }
    } catch (e: any) {
      setStockSyncResult({ platform: 'ML → LupoHub → TN', updated: 0, errors: 1, logs: [e.message || 'Error desconocido'] });
    } finally {
      setMlStockSyncLoading(false);
    }
  };

  // Sincronizar solo ML → TN (sin tocar inventario local)
  const handleSyncMLtoTN = async () => {
    setShowStockSyncModal(true);
    setMlStockSyncLoading(true);
    setMlStockSyncIsImport(true);
    setStockSyncResult(null);
    try {
      const res = await api.syncMLtoTN();
      setStockSyncResult({
        platform: 'ML → Tienda Nube',
        updated: res.updated,
        errors: res.errors,
        logs: res.updated > 0 || res.errors > 0 ? [`Actualizados: ${res.updated}, errores: ${res.errors}`] : ['Listo.']
      });
    } catch (e: any) {
      setStockSyncResult({ platform: 'ML → Tienda Nube', updated: 0, errors: 1, logs: [e.message || 'Error desconocido'] });
    } finally {
      setMlStockSyncLoading(false);
    }
  };

  // Opcional: importar stock desde ML a la app (alinear una vez con lo publicado en ML)
  const handleImportStockFromMercadoLibre = async () => {
    setShowStockSyncModal(true);
    setMlStockSyncLoading(true);
    setMlStockSyncIsImport(true);
    setStockSyncResult(null);
    try {
      const res = await api.importStockFromMercadoLibre();
      const hasTN = typeof res.sentToTN === 'number' || typeof res.errorsToTN === 'number';
      setStockSyncResult({
        platform: hasTN ? 'ML → LupoHub → TN' : 'Mercado Libre',
        updated: res.updated + (res.sentToTN ?? 0),
        errors: res.errors + (res.errorsToTN ?? 0),
        logs: res.logs,
        ...(hasTN && { fromML: { imported: res.updated, errorsFromML: res.errors, sentToTN: res.sentToTN ?? 0, errorsToTN: res.errorsToTN ?? 0 } })
      });
      if (res.logs?.length) {
        console.group('[LupoHub] Importar desde ML - Logs');
        res.logs.forEach((line: string) => console.log(line));
        console.groupEnd();
      }
    } catch (e: any) {
      setStockSyncResult({ platform: 'Mercado Libre', updated: 0, errors: 1, logs: [e.message || 'Error desconocido'] });
    } finally {
      setMlStockSyncLoading(false);
    }
  };

  const handleExportMlPublications = async () => {
    if (!mlReportFrom || !mlReportTo) {
      showToast('error', 'Completá desde y hasta para el reporte de Mercado Libre.');
      return;
    }
    if (mlReportFrom > mlReportTo) {
      showToast('error', 'El rango es inválido: "desde" no puede ser mayor que "hasta".');
      return;
    }
    setMlPublicationsExportLoading(true);
    try {
      await api.exportMercadolibrePublications({ from: mlReportFrom, to: mlReportTo });
      showToast('success', 'Se descargó el Excel con tus publicaciones de Mercado Libre.');
    } catch (e: any) {
      showToast('error', e?.message || 'Error al generar el Excel de publicaciones');
    } finally {
      setMlPublicationsExportLoading(false);
    }
  };

  const handleExportTnSalesReport = async () => {
    if (!tnSalesFrom || !tnSalesTo) {
      showToast('error', 'Completá desde y hasta.');
      return;
    }
    if (tnSalesFrom > tnSalesTo) {
      showToast('error', 'El rango es inválido: "desde" no puede ser mayor que "hasta".');
      return;
    }
    setTnSalesReportLoading(true);
    try {
      const products = tnSalesProducts
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      await api.exportTiendaNubeSalesReport({ from: tnSalesFrom, to: tnSalesTo, products });
      showToast('success', 'Reporte de ventas de Tienda Nube descargado.');
    } catch (e: any) {
      showToast('error', e?.message || 'Error al generar el reporte de ventas de Tienda Nube');
    } finally {
      setTnSalesReportLoading(false);
    }
  };

  const handleNormalizeSizesTiendaNube = async () => {
    setShowNormalizeSizesModal(true);
    setLoadingNormalizeSizes(true);
    setNormalizeSizesResult({ updatedVariants: 0, skippedProducts: 0, logs: ['Iniciando normalización por lotes…'] });
    try {
      const res = await api.normalizeSizesInTiendaNube((p) => {
        setNormalizeSizesResult({
          updatedVariants: p.updatedVariants,
          skippedProducts: 0,
          logs: [`Lote ${p.batch}…`, ...p.logs.slice(-48)],
        });
      });
      setNormalizeSizesResult({
        updatedVariants: res.updatedVariants,
        skippedProducts: res.skippedProducts,
        skippedDuplicates: res.skippedDuplicates,
        mergedVariants: res.mergedVariants,
        logs: res.logs || [],
      });
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : 'Error al conectar con el servidor.';
      setNormalizeSizesResult((prev) => ({
        updatedVariants: prev?.updatedVariants ?? 0,
        skippedProducts: prev?.skippedProducts ?? 0,
        skippedDuplicates: prev?.skippedDuplicates,
        mergedVariants: prev?.mergedVariants,
        logs: [...(prev?.logs ?? []), `[ERROR] ${msg}`],
      }));
    } finally {
      setLoadingNormalizeSizes(false);
    }
  };

  const handleSyncSkusTiendaNube = () => {
    showConfirm({
      title: 'Sincronizar SKU a Tienda Nube',
      message:
        'Se enviará el SKU de cada variante de LupoHub (formato artículo-talle-color) a Tienda Nube, reemplazando valores corruptos como 4,16E+12. ¿Continuar?',
      confirmLabel: 'Sincronizar',
      onConfirm: async () => {
        setLoadingSyncTnSkus(true);
        try {
          const res = await api.syncSkusToTiendaNube();
          if (res.errors > 0) {
            showToast('error', `SKU TN: ${res.updated} ok, ${res.errors} errores (de ${res.total}).`);
          } else {
            showToast('success', `SKU TN: ${res.updated} variantes actualizadas.`);
          }
        } catch (e: unknown) {
          showToast('error', e instanceof Error ? e.message : 'Error sincronizando SKU');
        } finally {
          setLoadingSyncTnSkus(false);
        }
      },
    });
  };

  const handleNormalizeColorsTiendaNube = async () => {
    setShowNormalizeColorsModal(true);
    setLoadingNormalizeColors(true);
    setNormalizeColorsResult({ updatedVariants: 0, skippedProducts: 0, logs: ['Iniciando normalización por lotes…'] });
    try {
      const res = await api.normalizeColorsInTiendaNube((p) => {
        setNormalizeColorsResult({
          updatedVariants: p.updatedVariants,
          skippedProducts: 0,
          logs: [`Lote ${p.batch}…`, ...p.logs.slice(-48)],
        });
      });
      setNormalizeColorsResult({
        updatedVariants: res.updatedVariants,
        skippedProducts: res.skippedProducts,
        skippedDuplicates: res.skippedDuplicates,
        mergedVariants: res.mergedVariants,
        logs: res.logs || [],
      });
    } catch (e: unknown) {
      console.error(e);
      const msg = e instanceof Error ? e.message : 'Error al conectar con el servidor.';
      setNormalizeColorsResult((prev) => ({
        updatedVariants: prev?.updatedVariants ?? 0,
        skippedProducts: prev?.skippedProducts ?? 0,
        skippedDuplicates: prev?.skippedDuplicates,
        mergedVariants: prev?.mergedVariants,
        logs: [...(prev?.logs ?? []), `[ERROR] ${msg}`],
      }));
    } finally {
      setLoadingNormalizeColors(false);
    }
  };

  const handleSyncTiendaNube = async () => {
    // This is now triggered from the modal
    setLoadingSync(true);
    setSyncLogs([]);
    setSyncCompleted(false);
    try {
      const res = await api.syncProductsFromTiendaNube();
      if (res.logs) {
        setSyncLogs(res.logs);
      }
      setSyncStats({
        imported: res.imported ?? 0,
        updated: res.updated ?? 0,
        productCount: (res as any).productCount ?? 0,
        variantCount: (res as any).variantCount ?? 0
      });
      setSyncCompleted(true);
    } catch (e: any) {
      setSyncLogs(prev => [...prev, `ERROR: ${e.message || 'Error desconocido'}`]);
    } finally {
      setLoadingSync(false);
    }
  };

  const handleDeleteAllProducts = async () => {
    setLoadingSync(true);
    try {
      await api.deleteAllProducts();
      setShowDeleteModal(false);
      window.location.reload(); // Reload to refresh state
    } catch (e: any) {
      showToast('error', 'Error eliminando productos: ' + (e.message || 'Error desconocido'));
    } finally {
      setLoadingSync(false);
    }
  };

  // User Creation State
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPass, setNewUserPass] = useState('');
  const [newUserRole, setNewUserRole] = useState<Role>(Role.SELLER);
  const [creatingUser, setCreatingUser] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [editingSellerAccessId, setEditingSellerAccessId] = useState<string | null>(null);
  const [defaultSellerImportPassword, setDefaultSellerImportPassword] = useState('');
  const [sellerExcelImporting, setSellerExcelImporting] = useState(false);
  const sellersImportInputRef = useRef<HTMLInputElement>(null);

  // Price lists (solo ADMIN)
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [priceListsLoading, setPriceListsLoading] = useState(false);
  const [editingPriceList, setEditingPriceList] = useState<PriceList | null>(null);
  const [priceListItems, setPriceListItems] = useState<{ productId: string; price: number; sku?: string; name?: string }[]>([]);
  const [productsForPriceList, setProductsForPriceList] = useState<{ id: string; sku: string; name: string; base_price?: number }[]>([]);
  const [priceListFilter, setPriceListFilter] = useState<'ALL' | 'WITH_PRICE' | 'WITHOUT_PRICE'>('ALL');
  const [priceListSearch, setPriceListSearch] = useState('');
  const [newListName, setNewListName] = useState('');
  const [newListSourceId, setNewListSourceId] = useState('');
  const [newListPercent, setNewListPercent] = useState('0');
  const [newListPercentMode, setNewListPercentMode] = useState<'increase' | 'decrease'>('increase');
  const [creatingPriceList, setCreatingPriceList] = useState(false);
  const [duplicateModalSource, setDuplicateModalSource] = useState<{ id: string; name: string } | null>(null);
  const [duplicateListName, setDuplicateListName] = useState('');
  const [duplicatePercent, setDuplicatePercent] = useState('0');
  const [duplicatePercentMode, setDuplicatePercentMode] = useState<'increase' | 'decrease'>('increase');
  const [duplicatingPriceList, setDuplicatingPriceList] = useState(false);

  const openDuplicatePriceListModal = (pl: { id: string; name: string }) => {
    setDuplicateModalSource({ id: pl.id, name: pl.name });
    setDuplicateListName(`${pl.name} (copia)`);
    setDuplicatePercent('0');
    setDuplicatePercentMode('increase');
  };

  const closeDuplicatePriceListModal = () => {
    if (duplicatingPriceList) return;
    setDuplicateModalSource(null);
    setDuplicateListName('');
  };

  const upsertPriceListItem = (productId: string, price: number | null, meta?: { sku?: string; name?: string }) => {
    setPriceListItems(prev => {
      const idx = prev.findIndex(x => x.productId === productId);
      if (price == null || Number.isNaN(price)) {
        if (idx === -1) return prev;
        return prev.filter((_, i) => i !== idx);
      }
      const nextVal = price >= 0 ? price : 0;
      if (idx === -1) return [...prev, { productId, price: nextVal, sku: meta?.sku, name: meta?.name }];
      return prev.map((x, i) => i === idx ? { ...x, price: nextVal, sku: x.sku ?? meta?.sku, name: x.name ?? meta?.name } : x);
    });
  };

  // Transportes (express) - solo ADMIN
  const [newTransporteName, setNewTransporteName] = useState('');
  const [newTransporteAddress, setNewTransporteAddress] = useState('');
  const [editingTransporteId, setEditingTransporteId] = useState<string | null>(null);
  const [editingTransporteName, setEditingTransporteName] = useState('');
  const [editingTransporteAddress, setEditingTransporteAddress] = useState('');
  // Remitente para remitos
  const [remitenteBusinessName, setRemitenteBusinessName] = useState('');
  const [remitenteAddress, setRemitenteAddress] = useState('');
  const [remitenteCity, setRemitenteCity] = useState('');
  const [remitenteCuit, setRemitenteCuit] = useState('');
  const [remitenteIngresosBrutos, setRemitenteIngresosBrutos] = useState('');
  const [remitenteInicioActividad, setRemitenteInicioActividad] = useState('13/06/2005');
  const [remitenteLogoUrl, setRemitenteLogoUrl] = useState('');
  const [remitenteCaiRemito, setRemitenteCaiRemito] = useState('');
  const [remitenteCaiVencimiento, setRemitenteCaiVencimiento] = useState('');
  const [remitenteEmail, setRemitenteEmail] = useState('');
  const [remitentePhone, setRemitentePhone] = useState('');

  useEffect(() => {
    const config = getApiConfig();
    setApiConfig(config);
  }, []);

  useEffect(() => {
    if (activeTab === 'pricelists' || activeTab === 'users') {
      setPriceListsLoading(true);
      api.getPriceLists().then(list => { setPriceLists(list); setPriceListsLoading(false); }).catch(() => setPriceListsLoading(false));
    }
    if (activeTab === 'transportes' || activeTab === 'facturacion') {
      const r = getRemitente();
      setRemitenteBusinessName(r.businessName ?? '');
      setRemitenteAddress(r.address ?? '');
      setRemitenteCity(r.city ?? '');
      setRemitenteCuit(r.cuit ?? '');
      setRemitenteIngresosBrutos(r.ingresosBrutos ?? '');
      setRemitenteInicioActividad(r.inicioActividad ?? '13/06/2005');
      setRemitenteLogoUrl(r.logoUrl ?? '');
      setRemitenteCaiRemito(r.caiRemito ?? '');
      setRemitenteCaiVencimiento(r.caiRemitoVencimiento ?? '');
      setRemitenteEmail(r.email ?? '');
      setRemitentePhone(r.phone ?? '');
    }
  }, [activeTab]);

  if (role !== Role.ADMIN && role !== Role.WAREHOUSE) {
    return (
      <div className="p-12 text-center text-slate-400">
        No tenés permisos para acceder a esta sección.
      </div>
    );
  }

  const sizes = attributes.filter(a => a.type === 'size');
  const colors = attributes.filter(a => a.type === 'color');
  const handleCreateAttribute = async () => {
    if (activeTab === 'sizes') {
      if (!newName.trim()) return;
    } else if (!newColorCode.trim()) {
      showToast('error', 'Indicá el código del color (ej. 111, 614, 0006).');
      return;
    }
    const nameTrim = newName.trim();
    const codeTrim = newColorCode.trim();
    try {
      if (activeTab === 'sizes') {
        const created = await api.createSize({ code: nameTrim, name: nameTrim });
        onCreateAttribute({ id: created.id, type: 'size', name: created.name ?? nameTrim, code: created.code });
      } else {
        const created = await api.createColor({
          code: codeTrim,
          name: nameTrim || codeTrim,
          hex: newColorValue || null,
        });
        onCreateAttribute({
          id: created.id,
          type: 'color',
          name: created.name ?? (nameTrim || codeTrim),
          value: created.hex ?? undefined,
          code: created.code,
        });
      }
      setNewName('');
      setNewColorCode('');
      setNewColorValue('#000000');
      onRefreshData?.();
    } catch (e: any) {
      showToast('error', e?.message || 'Error al crear. ¿El código ya existe?');
    }
  };

  const handleUnifySizes = async () => {
    setLoadingUnifySizes(true);
    try {
      const res = await api.unifySizes();
      onRefreshData?.();
      if (res.variantsUpdated > 0 || res.sizesDeleted > 0) {
        showToast('success', res.message);
      } else if (res.skipped?.length > 0) {
        showToast('info', res.message || 'No se unificó ningún talle.');
      } else {
        showToast('success', res.message || 'No había talles duplicados para unificar.');
      }
    } catch (e: any) {
      showToast('error', e?.response?.data?.message || e?.message || 'Error al unificar talles.');
    } finally {
      setLoadingUnifySizes(false);
    }
  };

  const handleStartEditColor = (attr: Attribute) => {
    setEditingColorId(attr.id);
    setEditingColorCode((attr as any).code != null ? String((attr as any).code).trim() : '');
    setEditingColorName(attr.name || '');
    setEditingColorHex((attr.value as string) || '#000000');
  };

  const handleCancelEditColor = () => {
    setEditingColorId(null);
    setEditingColorCode('');
    setEditingColorName('');
    setEditingColorHex('#000000');
  };

  const handleSaveEditColor = async () => {
    if (!editingColorId || !editingColorCode.trim()) {
      showToast('error', 'El código del color es obligatorio.');
      return;
    }
    setSavingColor(true);
    try {
      await api.updateColor(editingColorId, {
        code: editingColorCode.trim(),
        name: editingColorName.trim() || editingColorCode.trim(),
        hex: editingColorHex || null
      });
      showToast('success', 'Color actualizado.');
      handleCancelEditColor();
      onRefreshData?.();
    } catch (e: any) {
      showToast('error', e?.message || 'Error al actualizar el color.');
    } finally {
      setSavingColor(false);
    }
  };

  const handleImportStandardColorCatalog = async () => {
    if (importingStandardColors) return;
    setImportingStandardColors(true);
    try {
      const r = await api.importStandardColorCatalog();
      if (r.inserted > 0) {
        showToast(
          'success',
          `Se agregaron ${r.inserted} color(es) del catálogo estándar.${r.skipped > 0 ? ` Ya existían ${r.skipped}.` : ''}`
        );
      } else if (r.skipped > 0) {
        showToast('info', `Los ${r.skipped} códigos del catálogo ya estaban cargados. No se duplicó nada.`);
      } else {
        showToast('info', r.message || 'Listo.');
      }
      onRefreshData?.();
    } catch (e: any) {
      showToast('error', e?.response?.data?.message || e?.message || 'No se pudo importar el catálogo.');
    } finally {
      setImportingStandardColors(false);
    }
  };

  const handleMergeFourDigitColors = () => {
    showConfirm({
      title: 'Fusionar colores 4 dígitos',
      message:
        'Se unirán colores cuyo código es solo números y tiene 4 o más cifras al color de 3 dígitos formado por los primeros 3 (ej. 2021 → 202), moviendo variantes. Si no existe el de 3 dígitos, se renombra el code. ¿Continuar?',
      confirmLabel: 'Fusionar',
      onConfirm: async () => {
        setMergingFourDigitColors(true);
        try {
          const r = await api.mergeFourDigitColorCodes();
          const parts = [
            `Revisados: ${r.examined}.`,
            `Fusionados a color existente: ${r.mergedIntoExisting}.`,
            `Renombrados a 3 dígitos: ${r.renamedCodeOnly}.`,
          ];
          if (r.skipped?.length) parts.push(`Omitidos: ${r.skipped.length}.`);
          if (r.errors?.length) parts.push(`Errores: ${r.errors.length}.`);
          showToast(r.errors?.length ? 'warning' : 'success', parts.join(' '));
          if (r.skipped?.length) {
            showToast('info', r.skipped.slice(0, 5).join(' · ') + (r.skipped.length > 5 ? '…' : ''));
          }
          onRefreshData?.();
        } catch (e: any) {
          showToast('error', e?.response?.data?.message || e?.message || 'No se pudo fusionar.');
        } finally {
          setMergingFourDigitColors(false);
        }
      },
    });
  };

  const handleSaveConfig = () => {
    saveApiConfig(apiConfig);
    // Apply internal API settings (base URL + token) to http client
    try {
      setBaseUrl(apiBaseUrl);
      setAuthToken(apiToken || null);
    } catch (err) {
      console.error('Error applying HTTP client settings', err);
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleSellersExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!defaultSellerImportPassword || defaultSellerImportPassword.length < 4) {
      showToast(
        'error',
        'Completá la contraseña por defecto (mín. 4 caracteres) para las filas sin columna Contraseña en el Excel.'
      );
      return;
    }
    setSellerExcelImporting(true);
    try {
      const rows = await parseSellersExcel(file);
      if (rows.length === 0) {
        showToast(
          'warning',
          'No se encontraron filas válidas. Necesitás columnas de nombre y email, o nombre y código de vendedor (cabecera en la primera fila).'
        );
        return;
      }
      const res = await api.importSellers({ sellers: rows, defaultPassword: defaultSellerImportPassword });
      showToast(
        'success',
        `Importación lista: ${res.created} vendedor(es) creado(s). Omitidos (email ya existía): ${res.skipped}.`
      );
      if (res.errorCount > 0) {
        const first = res.errors?.[0];
        showToast(
          'warning',
          `${res.errorCount} fila(s) con error${first ? ` (ej. fila ${first.row}: ${first.message})` : ''}.`
        );
      }
      onRefreshData?.();
    } catch (err: any) {
      showToast('error', err?.response?.data?.message || err?.message || 'Error importando vendedores');
    } finally {
      setSellerExcelImporting(false);
    }
  };

  const handleCreateUser = async () => {
    if (!newUserName || !newUserEmail || !newUserPass || !onCreateUser) return;
    
    const newUser: User = {
      id: `u-${Date.now()}`,
      name: newUserName,
      email: newUserEmail,
      role: newUserRole,
      password: newUserPass,
      commissionPercentage: 0
    };

    setCreatingUser(true);
    try {
      await Promise.resolve(onCreateUser(newUser));
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPass('');
      setNewUserRole(Role.SELLER);
    } finally {
      setCreatingUser(false);
    }
  };

  const handleEditSellerAccess = async (u: User) => {
    if (!onUpdateUser) return;
    const currentEmail = (u.email || '').trim();
    const nextEmailRaw = window.prompt('Nuevo email del vendedor:', currentEmail);
    if (nextEmailRaw == null) return;
    const nextEmail = nextEmailRaw.trim().toLowerCase();
    if (!nextEmail || !nextEmail.includes('@')) {
      showToast('error', 'Email inválido');
      return;
    }

    const nextPassRaw = window.prompt('Nueva contraseña (dejar vacío para no cambiar):', '');
    if (nextPassRaw == null) return;
    const nextPassword = nextPassRaw.trim();
    if (nextPassword && nextPassword.length < 4) {
      showToast('error', 'La contraseña debe tener al menos 4 caracteres');
      return;
    }

    setEditingSellerAccessId(u.id);
    try {
      await Promise.resolve(
        onUpdateUser({
          ...u,
          email: nextEmail,
          password: nextPassword || undefined
        })
      );
      showToast('success', 'Acceso del vendedor actualizado');
    } catch (err: any) {
      showToast('error', err?.message || 'No se pudo actualizar el acceso del vendedor');
    } finally {
      setEditingSellerAccessId(null);
    }
  };

  const handleCheckHealth = async () => {
    setHealthLoading(true);
    setHealthResult('');
    setHealthMessage('');
    try {
      const base = apiBaseUrl.replace(/\/api\/?$/, '');
      const res = await request(`${base}/health`, 'GET');
      setHealthResult('ok');
      setHealthMessage(typeof res === 'string' ? res : JSON.stringify(res));
    } catch (err: any) {
      setHealthResult('error');
      setHealthMessage(err?.message || 'Error de conexión');
    } finally {
      setHealthLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="flex space-x-2 border-b border-slate-700 overflow-x-auto touch-scroll scrollbar-hide pb-px -mx-1 px-1 sm:mx-0 sm:px-0">
        {role === Role.ADMIN && (
          <>
            <button
              onClick={() => setActiveTab('users')}
              className={`pb-3 pt-2 px-3 sm:px-4 text-xs font-bold transition-all border-b-2 whitespace-nowrap min-h-[44px] touch-manipulation ${
                activeTab === 'users' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500'
              }`}
            >
              USUARIOS DEL SISTEMA
            </button>
            <button
              onClick={() => setActiveTab('pricelists')}
              className={`pb-3 pt-2 px-3 sm:px-4 text-xs font-bold transition-all border-b-2 whitespace-nowrap min-h-[44px] touch-manipulation ${
                activeTab === 'pricelists' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500'
              }`}
            >
              LISTAS DE PRECIOS
            </button>
            <button
              onClick={() => setActiveTab('integrations')}
              className={`pb-3 pt-2 px-3 sm:px-4 text-xs font-bold transition-all border-b-2 whitespace-nowrap min-h-[44px] touch-manipulation ${
                activeTab === 'integrations' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500'
              }`}
            >
              CONECTIVIDAD APIs
            </button>
            <button
              onClick={() => setActiveTab('transportes')}
              className={`pb-3 pt-2 px-3 sm:px-4 text-xs font-bold transition-all border-b-2 whitespace-nowrap min-h-[44px] touch-manipulation ${
                activeTab === 'transportes' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500'
              }`}
            >
              REMITOS
            </button>
            <button
              onClick={() => setActiveTab('facturacion')}
              className={`pb-3 pt-2 px-3 sm:px-4 text-xs font-bold transition-all border-b-2 whitespace-nowrap min-h-[44px] touch-manipulation ${
                activeTab === 'facturacion' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500'
              }`}
            >
              FACTURACIÓN
            </button>
          </>
        )}
        <button
          onClick={() => setActiveTab('sizes')}
          className={`pb-3 pt-2 px-3 sm:px-4 text-xs font-bold transition-all border-b-2 whitespace-nowrap min-h-[44px] touch-manipulation ${
            activeTab === 'sizes' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500'
          }`}
        >
          TALLES
        </button>
        <button
          onClick={() => setActiveTab('colors')}
          className={`pb-3 pt-2 px-3 sm:px-4 text-xs font-bold transition-all border-b-2 whitespace-nowrap min-h-[44px] touch-manipulation ${
            activeTab === 'colors' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500'
          }`}
        >
          COLORES
        </button>
      </div>

      {/* USER MANAGEMENT TAB */}
      {role === Role.ADMIN && activeTab === 'users' && (
        <div className="space-y-8">
           {/* CREATE USER FORM */}
           <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl">
              <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                <Plus className="bg-blue-600 rounded p-0.5 text-white" size={20} />
                Alta de Nuevo Usuario
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                Para <strong className="text-slate-300">vendedores</strong>, dejá el rol en{' '}
                <strong className="text-slate-300">Vendedor</strong> (valor por defecto). Luego podés asignarlos a clientes
                en la cartera y definir comisiones en el menú <strong className="text-slate-300">Vendedores</strong>.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Nombre Completo</label>
                    <div className="relative">
                      <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                      <input 
                        type="text" 
                        value={newUserName}
                        onChange={(e) => setNewUserName(e.target.value)}
                        placeholder="Ej: Juan Perez"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-9 pr-4 text-white text-sm outline-none focus:border-blue-500"
                        autoComplete="name"
                      />
                    </div>
                 </div>
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Email (Usuario)</label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                      <input 
                        type="email" 
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        placeholder="usuario@lupo.ar"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-9 pr-4 text-white text-sm outline-none focus:border-blue-500"
                        autoComplete="email"
                      />
                    </div>
                 </div>
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Rol</label>
                    <div className="relative">
                      <Shield size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                      <select
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value as Role)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-9 pr-4 text-white text-sm outline-none focus:border-blue-500 appearance-none cursor-pointer"
                      >
                         <option value={Role.SELLER}>Vendedor</option>
                         <option value={Role.WAREHOUSE}>Depósito</option>
                         <option value={Role.CUSTOMER}>Cliente directo</option>
                         <option value={Role.ADMIN}>Administrador</option>
                      </select>
                    </div>
                 </div>
                 <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Contraseña</label>
                    <div className="relative flex items-center gap-2">
                      <div className="relative flex-1">
                         <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
                         <input 
                           type="password" 
                           value={newUserPass}
                           onChange={(e) => setNewUserPass(e.target.value)}
                           placeholder="••••••"
                           className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 pl-9 pr-4 text-white text-sm outline-none focus:border-blue-500"
                           autoComplete="new-password"
                         />
                      </div>
                      <button 
                        onClick={handleCreateUser}
                        disabled={!newUserName || !newUserEmail || !newUserPass || creatingUser}
                        className="bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed shadow-lg flex items-center justify-center"
                      >
                         {creatingUser ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                      </button>
                    </div>
                 </div>
              </div>
           </div>

           <div className="bg-slate-800/90 rounded-3xl border border-slate-700 border-dashed p-6 shadow-xl">
              <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <FileSpreadsheet className="text-emerald-400" size={20} />
                Importar vendedores desde Excel
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                Podés subir el Excel <strong className="text-slate-300">historial_clientes_multimedias.xlsx</strong>: en la primera hoja
                (<strong className="text-slate-300">Resumen</strong>) se leen los <strong className="text-slate-300">Vendedor habitual</strong>{' '}
                únicos (ej. <code className="text-xs text-slate-500">9 - CHARLY</code>) y se crea un usuario por código, con email{' '}
                <code className="text-xs text-slate-500">vendedor.9@importado.lupohub.local</code>. También acepta una hoja propia con{' '}
                <strong className="text-slate-300">Nombre</strong>, <strong className="text-slate-300">Email</strong>, opcional contraseña y
                comisión %.
              </p>
              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 items-stretch sm:items-end">
                <div className="space-y-1 flex-1 min-w-[200px]">
                  <label className="text-[10px] font-black text-slate-500 uppercase ml-1">
                    Contraseña por defecto (filas sin columna contraseña)
                  </label>
                  <input
                    type="password"
                    value={defaultSellerImportPassword}
                    onChange={(e) => setDefaultSellerImportPassword(e.target.value)}
                    placeholder="Ej: CambiarAlIngresar1"
                    autoComplete="new-password"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl py-3 px-4 text-white text-sm outline-none focus:border-emerald-500"
                  />
                </div>
                <input
                  ref={sellersImportInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleSellersExcelImport}
                />
                <button
                  type="button"
                  onClick={() => downloadSellersImportTemplate()}
                  className="px-4 py-3 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm font-semibold whitespace-nowrap"
                >
                  <Download className="inline mr-2" size={16} />
                  Descargar plantilla
                </button>
                <button
                  type="button"
                  disabled={sellerExcelImporting}
                  onClick={() => sellersImportInputRef.current?.click()}
                  className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {sellerExcelImporting ? <Loader2 size={18} className="animate-spin" /> : <FileUp size={18} />}
                  {sellerExcelImporting ? 'Importando…' : 'Elegir Excel e importar'}
                </button>
              </div>
           </div>

           {/* USER LIST */}
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {users.map(u => (
                 <div key={u.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between group hover:border-slate-600 transition-colors">
                    <div className="flex items-center gap-4">
                       <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-xl ${
                          u.role === Role.ADMIN ? 'bg-purple-600' : u.role === Role.WAREHOUSE ? 'bg-orange-600' : 'bg-blue-600'
                       }`}>
                          {u.name.charAt(0)}
                       </div>
                       <div>
                          <h4 className="font-bold text-white">{u.name} {currentUser?.id === u.id && <span className="text-slate-500 text-xs">(Tú)</span>}</h4>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                             <span>{u.email}</span>
                             <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                             <span className="uppercase font-bold tracking-wider">{u.role}</span>
                          </div>
                          {u.commissionPercentage != null && u.commissionPercentage > 0 && (
                             <div className="mt-1 text-[10px] text-slate-500">
                                Comisión: {u.commissionPercentage}%
                             </div>
                          )}
                          {u.role === Role.CUSTOMER && (
                             <div className="mt-2">
                                <label className="text-[10px] font-black text-slate-500 uppercase">Lista de precios</label>
                                <select
                                  value={u.priceListId ?? ''}
                                  onChange={async (e) => {
                                    const value = e.target.value || null;
                                    try {
                                      const updated = await api.updateUser(u.id, { priceListId: value });
                                      onUpdateUser?.(updated);
                                    } catch (err: any) {
                                      showToast('error', err?.message || 'Error actualizando lista de precios');
                                    }
                                  }}
                                  className="mt-0.5 w-full max-w-[200px] bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                >
                                  <option value="">Precio base</option>
                                  {priceLists.map(pl => (
                                    <option key={pl.id} value={pl.id}>{pl.name}</option>
                                  ))}
                                </select>
                             </div>
                          )}
                       </div>
                    </div>
                    {currentUser?.id !== u.id && (
                       <div className="flex items-center gap-2">
                         {u.role === Role.SELLER && (
                           <button
                             onClick={() => handleEditSellerAccess(u)}
                             disabled={editingSellerAccessId === u.id}
                             className="p-2 text-slate-600 hover:text-cyan-400 hover:bg-cyan-900/10 rounded-lg transition-all disabled:opacity-50"
                             title="Editar email y contraseña"
                           >
                             {editingSellerAccessId === u.id ? <Loader2 size={18} className="animate-spin" /> : <Key size={18} />}
                           </button>
                         )}
                         <button 
                           onClick={async () => {
                             if (!onDeleteUser) return;
                             setDeletingUserId(u.id);
                             try {
                               await Promise.resolve(onDeleteUser(u.id));
                             } finally {
                               setDeletingUserId(null);
                             }
                           }}
                           disabled={deletingUserId === u.id}
                           className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-900/10 rounded-lg transition-all disabled:opacity-50"
                           title="Eliminar usuario"
                         >
                           {deletingUserId === u.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                         </button>
                       </div>
                    )}
                 </div>
              ))}
           </div>
        </div>
      )}

      {/* PRICE LISTS TAB */}
      {role === Role.ADMIN && activeTab === 'pricelists' && (
        <div className="space-y-6">
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <DollarSign size={20} className="text-green-400" />
              Listas de precios
            </h3>
            <p className="text-slate-400 text-sm mb-4">
              Creá listas y asigná precios por producto. Luego asigná cada lista a vendedores (en Usuarios) o a clientes con acceso a la app (en Clientes).
            </p>
            {priceListsLoading ? (
              <div className="flex items-center gap-2 text-slate-500 py-4"><Loader2 size={20} className="animate-spin" /> Cargando listas...</div>
            ) : (
              <div className="space-y-3">
                {priceLists.map(pl => (
                  <div key={pl.id} className="bg-slate-900 border border-slate-700 rounded-2xl p-4 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-white">{pl.name}</h4>
                      {pl.description && <p className="text-xs text-slate-500 mt-0.5">{pl.description}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          try {
                            const items = await api.getPriceListItems(pl.id);
                            if (!items?.length) {
                              showToast('error', 'La lista no tiene precios cargados todavía');
                              return;
                            }
                            await exportPriceListExcelStyled(items, pl.name);
                            showToast('success', `Lista "${pl.name}" descargada`);
                          } catch (err: any) {
                            showToast('error', err?.message || 'Error descargando la lista');
                          }
                        }}
                        className="px-3 py-1.5 bg-emerald-700/30 hover:bg-emerald-700/50 border border-emerald-700/60 rounded-lg text-emerald-300 hover:text-white text-xs font-bold flex items-center gap-1"
                        title="Descargar Excel con Código + Descripción + Precio"
                      >
                        <Download size={14} /> Descargar
                      </button>
                      <button
                        onClick={async () => {
                          setEditingPriceList(pl);
                          setPriceListFilter('ALL');
                          setPriceListSearch('');
                          try {
                            const [items, res] = await Promise.all([
                              api.getPriceListItems(pl.id),
                              api.getProductsPaged(1, 5000, undefined, 'sku', 'asc')
                            ]);
                            setPriceListItems(items.map(i => ({ productId: i.productId, price: i.price, sku: i.sku, name: i.name })));
                            const byProduct = new Map<string, { id: string; sku: string; name: string; base_price?: number }>();
                            for (const p of res.items) {
                              const pid = (p as any).product_id || (p as any).id;
                              if (!byProduct.has(pid)) byProduct.set(pid, {
                                id: pid,
                                sku: (p as any).base_sku || (p as any).sku,
                                name: (p as any).name,
                                base_price: (p as any).price
                              });
                            }
                            setProductsForPriceList(Array.from(byProduct.values()));
                          } catch (e) {
                            showToast('error', 'Error cargando ítems');
                          }
                        }}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-xs font-bold"
                      >
                        Editar precios
                      </button>
                      <button
                        type="button"
                        onClick={() => openDuplicatePriceListModal(pl)}
                        className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 text-xs font-bold flex items-center gap-1"
                        title="Duplicar lista"
                      >
                        <Copy size={14} /> Duplicar
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`¿Eliminar la lista "${pl.name}"?`)) return;
                          try {
                            await api.deletePriceList(pl.id);
                            setPriceLists(prev => prev.filter(x => x.id !== pl.id));
                            showToast('success', 'Lista eliminada');
                          } catch (err: any) {
                            showToast('error', err?.message || 'Error eliminando');
                          }
                        }}
                        className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-900/10 rounded-lg"
                        title="Eliminar"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="border-2 border-dashed border-slate-700 rounded-2xl p-6 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nueva lista</label>
                    <p className="text-slate-400 text-xs mb-3">
                      Podés crearla vacía o copiar precios de otra lista y aplicar un aumento o descuento porcentual.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                      <input
                        type="text"
                        placeholder="Nombre (ej: Mayorista +10%)"
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        className="md:col-span-2 bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                      />
                      <select
                        value={newListSourceId}
                        onChange={(e) => setNewListSourceId(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-xl p-3 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        <option value="">Sin copiar (lista vacía)</option>
                        {priceLists.map((pl) => (
                          <option key={pl.id} value={pl.id}>
                            Copiar desde: {pl.name}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2 items-center">
                        <select
                          value={newListPercentMode}
                          onChange={(e) => setNewListPercentMode(e.target.value as 'increase' | 'decrease')}
                          disabled={!newListSourceId}
                          className="flex-1 bg-slate-900 border border-slate-700 rounded-xl p-3 text-white text-sm disabled:opacity-40"
                        >
                          <option value="increase">Aumentar</option>
                          <option value="decrease">Descontar</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          placeholder="%"
                          value={newListPercent}
                          onChange={(e) => setNewListPercent(e.target.value)}
                          disabled={!newListSourceId}
                          className="w-24 bg-slate-900 border border-slate-700 rounded-xl p-3 text-white text-sm disabled:opacity-40"
                        />
                        <span className="text-slate-400 text-sm shrink-0">%</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={creatingPriceList || !newListName.trim()}
                      onClick={async () => {
                        const name = newListName.trim();
                        if (!name) return;
                        const pctNum = parseFloat(String(newListPercent).replace(',', '.'));
                        const pctVal = Number.isFinite(pctNum) ? Math.abs(pctNum) : 0;
                        const percentAdjust =
                          newListSourceId && pctVal > 0
                            ? newListPercentMode === 'decrease'
                              ? -pctVal
                              : pctVal
                            : undefined;
                        setCreatingPriceList(true);
                        try {
                          const created = await api.createPriceList({
                            name,
                            ...(newListSourceId ? { sourceListId: newListSourceId, percentAdjust: percentAdjust ?? 0 } : {}),
                          });
                          setPriceLists((prev) => [...prev, created]);
                          setNewListName('');
                          setNewListSourceId('');
                          setNewListPercent('0');
                          const extra =
                            created.itemsCopied != null && created.itemsCopied > 0
                              ? ` (${created.itemsCopied} precios${percentAdjust ? `, ${percentAdjust > 0 ? '+' : ''}${percentAdjust}%` : ''})`
                              : '';
                          showToast('success', `Lista creada${extra}`);
                        } catch (err: any) {
                          showToast('error', err?.message || 'Error creando');
                        } finally {
                          setCreatingPriceList(false);
                        }
                      }}
                      className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2"
                    >
                      {creatingPriceList ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                      Crear lista
                    </button>
                  </div>
                  <div className="border-t border-slate-700 pt-4">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Creación masiva (varias listas)</label>
                    <p className="text-slate-400 text-xs mb-2">Un nombre por línea. Se crean todas de una vez.</p>
                    <textarea
                      id="bulk-price-list-names"
                      placeholder="Mayorista 10%&#10;Mayorista 20%&#10;Retail&#10;Promo Verano"
                      rows={4}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-y"
                    />
                    <button
                      onClick={async () => {
                        const ta = document.getElementById('bulk-price-list-names') as HTMLTextAreaElement;
                        const text = ta?.value?.trim() || '';
                        const names = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                        if (names.length === 0) {
                          showToast('error', 'Escribí al menos un nombre (uno por línea)');
                          return;
                        }
                        try {
                          const { created, count } = await api.createPriceListsBulk(names);
                          setPriceLists(prev => [...prev, ...created]);
                          ta.value = '';
                          showToast('success', `Se crearon ${count} listas`);
                        } catch (err: any) {
                          showToast('error', (err as any)?.message || 'Error creando listas');
                        }
                      }}
                      className="mt-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2"
                    >
                      <Plus size={18} /> Crear listas
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Duplicar lista de precios */}
      <Modal
        isOpen={!!duplicateModalSource}
        onClose={closeDuplicatePriceListModal}
        title={duplicateModalSource ? `Duplicar: ${duplicateModalSource.name}` : 'Duplicar lista'}
        footer={
          <>
            <button
              type="button"
              disabled={duplicatingPriceList}
              onClick={closeDuplicatePriceListModal}
              className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-bold text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={duplicatingPriceList || !duplicateListName.trim()}
              onClick={async () => {
                if (!duplicateModalSource) return;
                const name = duplicateListName.trim();
                if (!name) return;
                const pctNum = parseFloat(String(duplicatePercent).replace(',', '.'));
                const pctVal = Number.isFinite(pctNum) ? Math.abs(pctNum) : 0;
                const percentAdjust =
                  pctVal > 0
                    ? duplicatePercentMode === 'decrease'
                      ? -pctVal
                      : pctVal
                    : 0;
                setDuplicatingPriceList(true);
                try {
                  const created = await api.duplicatePriceList(
                    duplicateModalSource.id,
                    name,
                    percentAdjust
                  );
                  setPriceLists((prev) => [...prev, created]);
                  closeDuplicatePriceListModal();
                  const msg =
                    created.itemsCopied != null
                      ? `Lista duplicada (${created.itemsCopied} precios${percentAdjust ? `, ${percentAdjust > 0 ? '+' : ''}${percentAdjust}%` : ''})`
                      : 'Lista duplicada';
                  showToast('success', msg);
                } catch (err: any) {
                  showToast('error', err?.message || 'Error duplicando');
                } finally {
                  setDuplicatingPriceList(false);
                }
              }}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2"
            >
              {duplicatingPriceList ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
              Duplicar lista
            </button>
          </>
        }
      >
        <p className="text-slate-400 text-sm mb-4">
          Se copiarán todos los precios de la lista original. Opcionalmente podés aplicar un aumento o descuento
          porcentual a la copia.
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre de la nueva lista</label>
            <input
              type="text"
              value={duplicateListName}
              onChange={(e) => setDuplicateListName(e.target.value)}
              placeholder="Ej: Mayorista +10% (copia)"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ajuste de precios (opcional)</label>
            <div className="flex gap-2 items-center">
              <select
                value={duplicatePercentMode}
                onChange={(e) => setDuplicatePercentMode(e.target.value as 'increase' | 'decrease')}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl p-3 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="increase">Aumentar</option>
                <option value="decrease">Descontar</option>
              </select>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="0"
                value={duplicatePercent}
                onChange={(e) => setDuplicatePercent(e.target.value)}
                className="w-24 bg-slate-950 border border-slate-700 rounded-xl p-3 text-white text-sm"
              />
              <span className="text-slate-400 text-sm shrink-0">%</span>
            </div>
            <p className="text-slate-500 text-xs mt-2">Dejá 0 para copiar los precios sin cambios.</p>
          </div>
        </div>
      </Modal>

      {/* Modal: Editar ítems de lista de precios */}
      {editingPriceList && (
        <Modal
          isOpen={!!editingPriceList}
          onClose={() => { setEditingPriceList(null); setPriceListItems([]); }}
          title={`Precios: ${editingPriceList.name}`}
          size="xl"
          footer={
            <div className="flex gap-2 w-full">
              <button onClick={() => setEditingPriceList(null)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-bold text-sm">Cerrar</button>
              <button
                onClick={async () => {
                  try {
                    await api.setPriceListItems(editingPriceList!.id, priceListItems.map(i => ({ productId: i.productId, price: i.price })));
                    showToast('success', 'Precios guardados');
                    setEditingPriceList(null);
                    setPriceListItems([]);
                  } catch (err: any) {
                    showToast('error', (err as any)?.message || 'Error guardando');
                  }
                }}
                className="flex-1 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg font-bold text-sm"
              >
                Guardar
              </button>
            </div>
          }
        >
          <div className="space-y-5 max-h-[75vh] overflow-y-auto">
            <p className="text-slate-300 text-sm">Productos con precio en esta lista. Para agregar, elegí un producto y un precio.</p>
            {/* Acciones masivas */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="bg-slate-800/80 rounded-2xl p-4 border border-slate-700">
                <p className="text-sm font-black text-slate-200 mb-2">Rellenar desde catálogo</p>
                <p className="text-slate-400 text-sm mb-3">Todos los productos con precio base. Opcional: multiplicador (ej. 0.9 = 10% descuento).</p>
                <div className="flex gap-3 items-center flex-wrap">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="1"
                    id="fill-multiplier"
                    className="w-28 bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const input = document.getElementById('fill-multiplier') as HTMLInputElement;
                      const mult = input?.value ? parseFloat(input.value) : 1;
                      if (!editingPriceList) return;
                      try {
                        const { items, count, skippedWithoutBase } = await api.fillPriceListFromBase(editingPriceList.id, mult) as any;
                        const fullItems = await api.getPriceListItems(editingPriceList.id);
                        setPriceListItems(fullItems.map(i => ({ productId: i.productId, price: i.price, sku: i.sku, name: i.name })));
                        if (Number(skippedWithoutBase || 0) > 0) {
                          showToast('success', `Se cargaron ${count} productos. Omitidos sin precio base: ${skippedWithoutBase}.`);
                        } else {
                          showToast('success', `Se cargaron ${count} productos`);
                        }
                      } catch (err: any) {
                        showToast('error', (err as any)?.message || 'Error');
                      }
                    }}
                    className="bg-slate-600 hover:bg-slate-500 text-white px-4 py-2 rounded-xl text-sm font-bold"
                  >
                    Rellenar
                  </button>
                </div>
              </div>
              <div className="bg-slate-800/80 rounded-2xl p-4 border border-slate-700">
                <p className="text-sm font-black text-slate-200 mb-2">Importar por CSV</p>
                <p className="text-slate-400 text-sm mb-3">Archivo con líneas: SKU;precio o SKU,precio. Reemplaza los precios de esos SKU.</p>
                <label className="inline-flex items-center gap-2 bg-slate-600 hover:bg-slate-500 text-white px-4 py-2 rounded-xl text-sm font-bold cursor-pointer">
                  <FileUp size={14} /> Elegir archivo
                  <input
                    type="file"
                    accept=".csv,.txt"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !editingPriceList) return;
                      e.target.value = '';
                      try {
                        const text = await file.text();
                        const lines = text.split(/\r?\n/).filter(Boolean);
                        const items: { sku: string; price: number }[] = [];
                        for (const line of lines) {
                          const [sku, priceStr] = line.includes(';') ? line.split(';') : line.split(',');
                          const skuTrim = (sku || '').trim();
                          const price = parseFloat((priceStr || '0').trim().replace(/[^\d.,-]/g, '').replace(',', '.'));
                          if (skuTrim && !isNaN(price)) items.push({ sku: skuTrim, price });
                        }
                        if (items.length === 0) {
                          showToast('error', 'No se encontraron líneas válidas (SKU;precio o SKU,precio)');
                          return;
                        }
                        const res = await api.setPriceListItemsBySku(editingPriceList.id, items);
                        const fullItems = await api.getPriceListItems(editingPriceList.id);
                        setPriceListItems(fullItems.map(i => ({ productId: i.productId, price: i.price, sku: i.sku, name: i.name })));
                        showToast('success', `Importados ${res.imported} precios${res.notFound?.length ? `. No encontrados: ${res.notFound.length}` : ''}`);
                      } catch (err: any) {
                        showToast('error', (err as any)?.message || 'Error importando');
                      }
                    }}
                  />
                </label>
              </div>
              <div className="bg-slate-800/80 rounded-2xl p-4 border border-slate-700">
                <p className="text-sm font-black text-slate-200 mb-2">Exportar / Importar Excel</p>
                <p className="text-slate-400 text-sm mb-3">Mismo formato: columnas Código y Precio. Plantilla con todos los artículos para completar precios e importar.</p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void downloadPriceListTemplateStyled(productsForPriceList)}
                    className="inline-flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-xl text-sm font-bold"
                    title="Descarga un Excel con todos los artículos del catálogo y columna Precio vacía para completar"
                  >
                    <FileUp size={14} /> Descargar plantilla (todos los artículos)
                  </button>
                  <button
                    type="button"
                    onClick={() => void exportPriceListExcelStyled(priceListItems, editingPriceList?.name ?? '')}
                    className="inline-flex items-center gap-2 bg-slate-600 hover:bg-slate-500 text-white px-4 py-2 rounded-xl text-sm font-bold"
                  >
                    <Download size={14} /> Exportar Excel
                  </button>
                  <label className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold cursor-pointer">
                    <FileSpreadsheet size={14} /> Importar Excel
                    <input
                    type="file"
                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !editingPriceList) return;
                      e.target.value = '';
                      try {
                        const items = await parsePriceListExcel(file);
                        if (items.length === 0) {
                          showToast('error', 'No se encontraron filas válidas (SKU + precio). Revisá las columnas.');
                          return;
                        }
                        const res = await api.setPriceListItemsBySku(editingPriceList.id, items);
                        const fullItems = await api.getPriceListItems(editingPriceList.id);
                        setPriceListItems(fullItems.map(i => ({ productId: i.productId, price: i.price, sku: i.sku, name: i.name })));
                        showToast('success', `Importados ${res.imported} precios desde Excel${res.notFound?.length ? `. No encontrados: ${res.notFound.length}` : ''}`);
                      } catch (err: any) {
                        showToast('error', (err as any)?.message || 'Error importando Excel');
                      }
                    }}
                  />
                </label>
                </div>
              </div>
            </div>
            {(() => {
              const byId = new Map(priceListItems.map(i => [i.productId, i]));
              const merged = productsForPriceList.map(p => {
                const item = byId.get(p.id);
                return {
                  productId: p.id,
                  sku: item?.sku ?? p.sku,
                  name: item?.name ?? p.name,
                  price: item?.price,
                  hasPrice: item?.price != null
                };
              });
              const search = priceListSearch.trim().toLowerCase();
              const filtered = merged.filter(r => {
                if (priceListFilter === 'WITH_PRICE' && !r.hasPrice) return false;
                if (priceListFilter === 'WITHOUT_PRICE' && r.hasPrice) return false;
                if (!search) return true;
                return (r.sku || '').toLowerCase().includes(search) || (r.name || '').toLowerCase().includes(search);
              });
              return (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-black text-slate-500 uppercase mb-1">Buscar artículo</label>
                      <input
                        type="text"
                        value={priceListSearch}
                        onChange={(e) => setPriceListSearch(e.target.value)}
                        placeholder="SKU o nombre..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-black text-slate-500 uppercase mb-1">Filtro de precio</label>
                      <select
                        value={priceListFilter}
                        onChange={(e) => setPriceListFilter(e.target.value as any)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm"
                      >
                        <option value="ALL">Todos</option>
                        <option value="WITH_PRICE">Con precio</option>
                        <option value="WITHOUT_PRICE">Sin precio</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-400">
                      Mostrando <strong className="text-slate-200">{filtered.length}</strong> de <strong className="text-slate-200">{merged.length}</strong> artículos.
                    </p>
                  </div>

                  {filtered.map((item) => (
              <div key={item.productId} className="flex flex-col sm:flex-row sm:items-center gap-3 bg-slate-800 rounded-2xl p-4 border border-slate-700">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-mono text-slate-400 truncate">{item.sku || item.productId}</div>
                  <div className="text-base font-bold text-white truncate">{item.name || 'Producto'}</div>
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={item.price ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      upsertPriceListItem(item.productId, null);
                      return;
                    }
                    const v = parseFloat(raw);
                    if (!isNaN(v) && v >= 0) upsertPriceListItem(item.productId, v, { sku: item.sku, name: item.name });
                  }}
                  className="w-full sm:w-44 bg-slate-900 border border-slate-600 rounded-xl px-3 py-2 text-white text-base"
                />
                <button
                  type="button"
                  onClick={() => upsertPriceListItem(item.productId, null)}
                  className="px-4 py-2 rounded-xl bg-red-900/40 hover:bg-red-900/60 text-red-200 text-sm font-bold inline-flex items-center gap-2"
                  aria-label="Quitar"
                >
                  <Trash2 size={16} /> Quitar
                </button>
              </div>
            ))}
                </>
              );
            })()}
            <div className="flex gap-2 flex-wrap items-center border-t border-slate-700 pt-4">
              <select
                id="add-product-select"
                className="bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-base min-w-[220px]"
              >
                <option value="">Agregar producto...</option>
                {productsForPriceList.filter(p => !priceListItems.some(i => i.productId === p.id)).map(p => (
                  <option key={p.id} value={p.id}>{p.sku} – {p.name}</option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                min="0"
                id="add-product-price"
                placeholder="Precio"
                className="w-32 bg-slate-900 border border-slate-600 rounded-xl px-3 py-2.5 text-white text-base"
              />
              <button
                type="button"
                onClick={() => {
                  const sel = document.getElementById('add-product-select') as HTMLSelectElement;
                  const priceInput = document.getElementById('add-product-price') as HTMLInputElement;
                  const productId = sel?.value;
                  const price = parseFloat(priceInput?.value || '0');
                  if (!productId || isNaN(price) || price < 0) return;
                  const prod = productsForPriceList.find(p => p.id === productId);
                  upsertPriceListItem(productId, price, { sku: prod?.sku, name: prod?.name });
                  sel.value = '';
                  priceInput.value = '';
                }}
                className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl text-base font-black"
              >
                <Plus size={16} className="inline mr-1" /> Agregar
              </button>
            </div>
          </div>
        </Modal>
      )}

      {role === Role.ADMIN && activeTab === 'integrations' && (
        <div className="space-y-6">
          {/* Instalar app en tablet / móvil */}
          <div className="bg-indigo-900/20 rounded-2xl border border-indigo-700/50 p-5">
            <p className="text-sm font-bold text-indigo-200 flex items-center gap-2 mb-2">
              <Smartphone size={18} /> Instalar LupoHub en tablet o móvil
            </p>
            <p className="text-xs text-slate-300 mb-2">
              En la compu suele aparecer el botón para instalar. En <strong>tablet Android</strong> Chrome a veces no lo muestra; hay que usar el menú:
            </p>
            <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
              <li>Abrí <strong>Chrome</strong> en la tablet y entrá a la <strong>misma URL</strong> de LupoHub (HTTPS).</li>
              <li>Tocá los <strong>tres puntos ⋮</strong> (arriba a la derecha) para abrir el menú.</li>
              <li>Elegí <strong>“Agregar a la pantalla de inicio”</strong> o <strong>“Instalar aplicación”</strong>.</li>
              <li>Confirmá. El ícono de LupoHub quedará en la pantalla de inicio y se abrirá como app, sin la barra de Chrome.</li>
            </ol>
            <p className="text-[11px] text-slate-500 mt-2">
              Si no ves “Instalar aplicación”, probá menú ⋮ → “Añadir a pantalla de inicio”. En tablets la opción suele estar solo en el menú.
            </p>
          </div>

          {/* Guía: stock depósito → Tienda Nube y Mercado Libre */}
          <div className="bg-slate-800/80 rounded-2xl border border-slate-600 p-5">
            <p className="text-xs font-black text-slate-400 uppercase mb-3 flex items-center gap-2">
              <Package size={14} /> Cómo sincronizar el stock de tu depósito con Tienda Nube y Mercado Libre
            </p>
            <ol className="text-sm text-slate-300 space-y-2 list-decimal list-inside">
              <li><strong className="text-slate-200">Tené tus productos en LupoHub.</strong> Importalos desde Tango (Inventario → Importar Tango) o cargalos a mano. El stock que cargues acá es el de tu depósito (fuente de verdad).</li>
              <li><strong className="text-slate-200">Vinculá cada variante con TN y ML.</strong> En <strong>Inventario → Mi inventario</strong>, en cada fila de producto tocá el ícono de <strong>cadena (Vincular)</strong>. Ahí cargá el <strong>ID de producto e ID de variante de Tienda Nube</strong> y el <strong>ID de publicación/variación de Mercado Libre</strong> que correspondan a esa variante. Sin este vínculo la app no sabe a qué listing enviar el stock.</li>
              <li><strong className="text-slate-200">SKU unificado.</strong> En Vincular producto podés usar el mismo código para inventario, ML y TN (botón &quot;Usar mismo código&quot;). Si en ML/TN usás otro código, ingresalo en ese campo. Packs (x2, x3): configurá en el mismo modal; el stock enviado = stock del depósito ÷ pack.</li>
              <li><strong className="text-slate-200">Enviar stock a las plataformas.</strong> En esta pestaña (Integraciones) usá <strong>Sincronizar stock a Tienda Nube</strong> y <strong>Sincronizar stock a Mercado Libre</strong>. Se envía el stock actual de tu depósito (LupoHub) a cada variante que tengas vinculada.</li>
            </ol>
            <p className="text-xs text-slate-500 mt-3">
              Los productos de TN y ML no se guardan en la base de datos; solo se usa el vínculo que vos cargás para enviar stock desde LupoHub hacia cada plataforma.
            </p>
          </div>

          <div className="bg-slate-800 rounded-3xl border border-slate-700 overflow-hidden shadow-xl">
            <div className="p-6 bg-slate-900/50 border-b border-slate-700 flex flex-wrap justify-between items-center gap-3">
              <div className="flex items-center gap-3">
                <div className="bg-violet-600/20 p-2.5 rounded-2xl text-violet-400"><Link size={24} /></div>
                <div>
                  <h3 className="font-black text-white text-lg">Tienda Lupo (Webhook de stock)</h3>
                  <p className="text-xs text-slate-500">Fuente de verdad: LupoHub envía stock firmado con HMAC.</p>
                </div>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-2 ${lupoWebhookConfig.enabled ? 'bg-green-500/20 text-green-400 border-green-500/50' : 'bg-slate-700/40 text-slate-400 border-slate-600'}`}>
                {lupoWebhookConfig.enabled ? <Check size={12} /> : <Power size={12} />}
                {lupoWebhookConfig.enabled ? 'ACTIVO' : 'INACTIVO'}
              </span>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-xs text-slate-400">
                  Webhook URL
                  <input
                    type="url"
                    value={lupoWebhookConfig.webhookUrl}
                    onChange={(e) => setLupoWebhookConfig(prev => ({ ...prev, webhookUrl: e.target.value }))}
                    placeholder="https://tu-backend.com/api/hub/webhook/stock"
                    className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  API Key
                  <input
                    type="text"
                    value={lupoWebhookConfig.apiKey}
                    onChange={(e) => setLupoWebhookConfig(prev => ({ ...prev, apiKey: e.target.value, keepExistingApiKey: false }))}
                    placeholder={lupoWebhookConfig.hasApiKey ? `Actual: ${lupoWebhookConfig.apiKeyMasked}` : 'Ingresá tu HUB_API_KEY'}
                    className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Webhook Secret (HMAC)
                  <input
                    type="password"
                    value={lupoWebhookConfig.webhookSecret}
                    onChange={(e) => setLupoWebhookConfig(prev => ({ ...prev, webhookSecret: e.target.value, keepExistingSecret: false }))}
                    placeholder={lupoWebhookConfig.hasWebhookSecret ? `Actual: ${lupoWebhookConfig.webhookSecretMasked}` : 'Ingresá tu HUB_WEBHOOK_SECRET'}
                    className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Habilitado
                  <select
                    value={lupoWebhookConfig.enabled ? '1' : '0'}
                    onChange={(e) => setLupoWebhookConfig(prev => ({ ...prev, enabled: e.target.value === '1' }))}
                    className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 text-sm"
                  >
                    <option value="1">Sí</option>
                    <option value="0">No</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="text-xs text-slate-400">
                  Timeout (ms)
                  <input
                    type="number"
                    min={1000}
                    value={lupoWebhookConfig.timeoutMs}
                    onChange={(e) => setLupoWebhookConfig(prev => ({ ...prev, timeoutMs: Math.max(1000, Number(e.target.value) || 10000) }))}
                    className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Retries 5xx
                  <input
                    type="number"
                    min={0}
                    value={lupoWebhookConfig.maxRetries}
                    onChange={(e) => setLupoWebhookConfig(prev => ({ ...prev, maxRetries: Math.max(0, Number(e.target.value) || 0) }))}
                    className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 text-sm"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Backoff base (ms)
                  <input
                    type="number"
                    min={200}
                    value={lupoWebhookConfig.backoffBaseMs}
                    onChange={(e) => setLupoWebhookConfig(prev => ({ ...prev, backoffBaseMs: Math.max(200, Number(e.target.value) || 1000) }))}
                    className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 text-sm"
                  />
                </label>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={lupoWebhookConfig.keepExistingApiKey}
                  onChange={(e) => setLupoWebhookConfig(prev => ({ ...prev, keepExistingApiKey: e.target.checked }))}
                />
                Mantener API key actual si el campo de API key está vacío
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={lupoWebhookConfig.keepExistingSecret}
                  onChange={(e) => setLupoWebhookConfig(prev => ({ ...prev, keepExistingSecret: e.target.checked }))}
                />
                Mantener secreto actual si el campo de secret está vacío
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSaveLupoWebhookConfig}
                  disabled={savingLupoWebhook}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {savingLupoWebhook ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  GUARDAR WEBHOOK
                </button>
                <button
                  onClick={handleTestLupoWebhook}
                  disabled={testingLupoWebhook}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {testingLupoWebhook ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  PROBAR WEBHOOK
                </button>
                <button
                  type="button"
                  onClick={handleSyncLupoShopMlStock}
                  disabled={syncingLupoShopMlStock || !lupoWebhookConfig.enabled}
                  title={!lupoWebhookConfig.enabled ? 'Activá y guardá el webhook primero' : 'Envía el stock del depósito (LupoHub) de todas las variantes vinculadas a Mercado Libre'}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {syncingLupoShopMlStock ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  ENVIAR STOCK ML → TIENDA
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                <strong className="text-slate-400">Envío masivo:</strong> toma el stock actual de tu depósito en LupoHub (no el de la API de ML) para cada variante que tenga vínculo a Mercado Libre y lo envía a la tienda en lotes. La columna &quot;Tienda&quot; en inventario se actualiza cuando la tienda responde OK.
              </p>
              {lupoShopMlSyncResult && (
                <div
                  className={`text-xs rounded-xl border px-3 py-2 ${
                    lupoShopMlSyncResult.ok ? 'border-emerald-600/40 bg-emerald-900/20 text-emerald-200' : 'border-amber-600/40 bg-amber-900/20 text-amber-200'
                  }`}
                >
                  Masivo ML→tienda: {lupoShopMlSyncResult.ok ? 'OK' : 'con errores'} · variantes: {lupoShopMlSyncResult.variantCount} ·
                  lotes OK: {lupoShopMlSyncResult.batchesOk}/{lupoShopMlSyncResult.batchesTotal}
                  {lupoShopMlSyncResult.message ? ` · ${lupoShopMlSyncResult.message}` : ''}
                  {lupoShopMlSyncResult.errors?.length ? ` · detalle: ${JSON.stringify(lupoShopMlSyncResult.errors.slice(0, 3))}` : ''}
                </div>
              )}
              {lupoWebhookLastResult && (
                <div className={`text-xs rounded-xl border px-3 py-2 ${lupoWebhookLastResult.ok ? 'border-emerald-600/40 bg-emerald-900/20 text-emerald-200' : 'border-rose-600/40 bg-rose-900/20 text-rose-200'}`}>
                  Resultado: {lupoWebhookLastResult.ok ? 'OK' : 'ERROR'} · webhookId: {lupoWebhookLastResult.webhookId || 'n/a'} · status: {lupoWebhookLastResult.status || 'n/a'} · intento: {lupoWebhookLastResult.attempt ?? 'n/a'}{lupoWebhookLastResult.duplicate ? ' · duplicate=true' : ''}
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                Config actual tomada de: <strong className="text-slate-300">{lupoWebhookConfig.source === 'db' ? 'base de datos' : 'variables de entorno'}</strong>.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tienda Nube */}
          <div className="bg-slate-800 rounded-3xl border border-slate-700 overflow-hidden shadow-xl">
             <div className="p-6 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center">
                <div className="flex items-center gap-3">
                   <div className="bg-blue-600/20 p-2.5 rounded-2xl text-blue-400"><Cloud size={24} /></div>
                   <h3 className="font-black text-white text-lg">Tienda Nube</h3>
                </div>
                {integrations.tiendanube ? (
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-bold border border-green-500/50 flex items-center gap-2">
                      <Check size={12} /> CONECTADO
                    </span>
                    <button 
                      onClick={() => handleDisconnect('tiendanube')}
                      className="px-3 py-1 bg-red-600/80 hover:bg-red-600 rounded-xl text-white text-xs font-bold"
                    >
                      Desconectar
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => handleConnect('tiendanube')}
                    disabled={loadingIntegrations}
                    className="px-4 py-2 bg-blue-600 rounded-xl text-white text-xs font-bold shadow-lg active:scale-95 transition-all hover:bg-blue-500 uppercase tracking-wide disabled:opacity-50"
                  >
                    {loadingIntegrations ? '...' : 'Conectar'}
                  </button>
                )}
             </div>
             <div className="p-6 space-y-5">
                <p className="text-slate-400 text-sm">
                  Conectar solo guarda la cuenta. Los productos no se cargan solos: para traerlos a LupoHub usá <strong>Importar productos</strong> cuando quieras.
                </p>
                {integrations.tiendanube && (
                  <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/50 flex flex-col gap-4">
                    {integrations.tiendanubeStoreId && (
                      <p className="text-slate-400 text-xs">
                        <span className="text-slate-500">Store ID (para webhooks/pruebas):</span>{' '}
                        <code className="bg-slate-800 px-1.5 py-0.5 rounded text-cyan-400 font-mono">{integrations.tiendanubeStoreId}</code>
                      </p>
                    )}
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <div>
                        <p className="text-xs text-slate-500">Estado de sincronización</p>
                        <p className="text-white font-bold">Activo</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button 
                          onClick={() => setShowSyncModal(true)}
                          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2"
                        >
                          <RefreshCw size={14} />
                          CONSULTAR PRODUCTOS
                        </button>
                        <button 
                          onClick={handleSyncStockToTiendaNube}
                          disabled={tnStockSyncLoading}
                          className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                          title="Sincronizar stock local a Tienda Nube"
                        >
                          {tnStockSyncLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          SINCRONIZAR STOCK
                        </button>
                        <button 
                          onClick={handleNormalizeSizesTiendaNube}
                          disabled={loadingNormalizeSizes}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                          title="Convertir todos los talles en Tienda Nube a P, M, G, GG, XG, XXG, XXXG, U y 4–14"
                        >
                          {loadingNormalizeSizes ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}
                          NORMALIZAR TALLES
                        </button>
                        <button 
                          onClick={handleNormalizeColorsTiendaNube}
                          disabled={loadingNormalizeColors}
                          className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                          title="Unificar nombres de color en Tienda Nube (Negro, Azul, Bordó, etc.)"
                        >
                          {loadingNormalizeColors ? <Loader2 size={14} className="animate-spin" /> : <Palette size={14} />}
                          NORMALIZAR COLORES
                        </button>
                        <button
                          onClick={handleSyncSkusTiendaNube}
                          disabled={loadingSyncTnSkus}
                          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                          title="Copiar SKU de LupoHub a cada variante en Tienda Nube"
                        >
                          {loadingSyncTnSkus ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}
                          SINCRONIZAR SKU
                        </button>
                      </div>
                    </div>
                    <div className="rounded-xl border border-cyan-900/50 bg-cyan-950/10 p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet size={14} className="text-cyan-400" />
                        <p className="text-cyan-200 text-xs font-black uppercase tracking-wide">Reporte de Ventas Tienda Nube</p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-[11px] text-slate-400">
                          Desde
                          <input
                            type="date"
                            value={tnSalesFrom}
                            onChange={(e) => setTnSalesFrom(e.target.value)}
                            className="mt-1 block bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-100 text-xs"
                          />
                        </label>
                        <label className="text-[11px] text-slate-400">
                          Hasta
                          <input
                            type="date"
                            value={tnSalesTo}
                            onChange={(e) => setTnSalesTo(e.target.value)}
                            className="mt-1 block bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-100 text-xs"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={handleExportTnSalesReport}
                          disabled={tnSalesReportLoading}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                          title="Descargar reporte de ventas de Tienda Nube por período"
                        >
                          {tnSalesReportLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                          DESCARGAR REPORTE TN
                        </button>
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-400 block">
                          Productos a incluir (opcional: SKU, ID o parte del nombre; separados por coma)
                        </label>
                        <input
                          type="text"
                          value={tnSalesProducts}
                          onChange={(e) => setTnSalesProducts(e.target.value)}
                          placeholder="Ej: BOXER123, 987654321, media negra"
                          className="mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-xs"
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      Sincronizar stock / SKU / normalizar talles y colores. SKU: usa el código de LupoHub (ej. 0051003-130-280), no notación científica.
                    </p>
                  </div>
                )}
             </div>
          </div>

          {/* Mercado Libre */}
          <div className="bg-slate-800 rounded-3xl border border-slate-700 overflow-hidden shadow-xl">
             <div className="p-6 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center">
                <div className="flex items-center gap-3">
                   <div className="bg-yellow-600/20 p-2.5 rounded-2xl text-yellow-500"><Zap size={24} /></div>
                   <h3 className="font-black text-white text-lg">Mercado Libre</h3>
                </div>
                {integrations.mercadolibre ? (
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-bold border border-green-500/50 flex items-center gap-2">
                      <Check size={12} /> CONECTADO
                    </span>
                    <button 
                      onClick={() => handleDisconnect('mercadolibre')}
                      className="px-3 py-1 bg-red-600/80 hover:bg-red-600 rounded-xl text-white text-xs font-bold"
                    >
                      Desconectar
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => handleConnect('mercadolibre')}
                    disabled={loadingIntegrations}
                    className="px-4 py-2 bg-yellow-600 rounded-xl text-white text-xs font-bold shadow-lg active:scale-95 transition-all hover:bg-yellow-500 uppercase tracking-wide disabled:opacity-50"
                  >
                    {loadingIntegrations ? '...' : 'Conectar'}
                  </button>
                )}
             </div>
             <div className="p-6 space-y-5">
                <p className="text-slate-400 text-sm">
                  Conectar solo guarda la cuenta. Para vincular tus publicaciones de ML con LupoHub usá <strong>Vincular productos</strong> cuando quieras.
                </p>
                 {integrations.mercadolibre && (
                  <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/50 flex flex-col gap-4">
                    <div className="flex flex-wrap justify-between items-start gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-slate-500">Estado de sincronización</p>
                        <p className="text-white font-bold">Activo</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button 
                          onClick={handleSyncStockToMercadoLibre}
                          disabled={mlStockSyncLoading}
                          className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                          title="Tu stock (LupoHub) es la fuente de verdad: envía tu inventario a Mercado Libre"
                        >
                          {mlStockSyncLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          ENVIAR MI STOCK A ML
                        </button>
                        <button 
                          onClick={handleSyncAllFromMercadoLibre}
                          disabled={mlStockSyncLoading}
                          className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                          title="Opcional: trae el stock de ML a LupoHub y envíalo a Tienda Nube"
                        >
                          {mlStockSyncLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          IMPORTAR DESDE ML (OPCIONAL)
                        </button>
                        <button 
                          onClick={handleImportStockFromMercadoLibre}
                          disabled={mlStockSyncLoading}
                          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                          title="Trae el stock de ML a LupoHub (solo por SKU) y envía a TN"
                        >
                          {mlStockSyncLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          IMPORTAR DESDE ML (POR SKU)
                        </button>
                        <button 
                          onClick={handleSyncMLtoTN}
                          disabled={mlStockSyncLoading}
                          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                          title="Copia el stock de Mercado Libre a Tienda Nube (sin tocar tu inventario local)"
                        >
                          {mlStockSyncLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          ML → TIENDA NUBE
                        </button>
                        <button 
                          onClick={handleTestMercadoLibre}
                          disabled={mlTestLoading}
                          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                          {mlTestLoading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                          PROBAR CONEXIÓN
                        </button>
                        <button 
                          onClick={handleSyncMercadoLibre}
                          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2"
                        >
                          <RefreshCw size={14} />
                          VINCULAR PRODUCTOS
                        </button>
                      </div>
                    </div>
                    <div className="rounded-xl border border-yellow-900/50 bg-yellow-950/10 p-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet size={14} className="text-yellow-400" />
                        <p className="text-yellow-200 text-xs font-black uppercase tracking-wide">Reporte Comercial Mercado Libre</p>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-[11px] text-slate-400">
                          Desde
                          <input
                            type="date"
                            value={mlReportFrom}
                            onChange={(e) => setMlReportFrom(e.target.value)}
                            className="mt-1 block bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-100 text-xs"
                          />
                        </label>
                        <label className="text-[11px] text-slate-400">
                          Hasta
                          <input
                            type="date"
                            value={mlReportTo}
                            onChange={(e) => setMlReportTo(e.target.value)}
                            className="mt-1 block bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-100 text-xs"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={handleExportMlPublications}
                          disabled={mlPublicationsExportLoading}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                          title="Descarga Excel con precio ML, mayorista, FOB y margen aproximado"
                        >
                          {mlPublicationsExportLoading ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
                          DESCARGAR REPORTE ML
                        </button>
                      </div>
                    </div>
                    <p className="text-slate-500 text-xs">
                      <strong>Fuente de verdad:</strong> Tu inventario en LupoHub es la fuente de verdad. Usá <strong>Enviar mi stock a ML</strong> para enviar tu stock a Mercado Libre (y en Inventario podés enviar también a Tienda Nube o a ambas). <strong>Importar desde ML</strong> es opcional, solo si en algún momento querés traer el stock desde ML a LupoHub.
                    </p>

                    {/* Mensaje Automático */}
                    <div className="border-t border-slate-700/50 pt-4 mt-2">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Mail size={16} className="text-yellow-400" />
                          <p className="text-white font-bold text-sm">Mensaje Automático de Agradecimiento</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={mlAutoMessageEnabled}
                            onChange={(e) => setMlAutoMessageEnabled(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-yellow-600"></div>
                        </label>
                      </div>
                      <p className="text-slate-500 text-xs mb-3">
                        Envía un mensaje automático al comprador cuando se confirma una venta. Usa {'{nombre}'} para el nombre del cliente y {'{productos}'} para los productos.
                      </p>
                      <textarea
                        value={mlAutoMessageTemplate}
                        onChange={(e) => setMlAutoMessageTemplate(e.target.value)}
                        rows={6}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-yellow-500 outline-none resize-none font-mono text-xs"
                        placeholder="¡Hola {nombre}! Gracias por tu compra..."
                      />
                      <div className="flex justify-end mt-3">
                        <button
                          onClick={async () => {
                            setMlAutoMessageLoading(true);
                            try {
                              await api.saveMLAutoMessageConfig({ enabled: mlAutoMessageEnabled, messageTemplate: mlAutoMessageTemplate });
                              setMlAutoMessageSaved(true);
                              setTimeout(() => setMlAutoMessageSaved(false), 3000);
                            } catch (e) {
                              showToast('error', 'Error guardando configuración');
                            } finally {
                              setMlAutoMessageLoading(false);
                            }
                          }}
                          disabled={mlAutoMessageLoading}
                          className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                          {mlAutoMessageLoading ? <Loader2 size={14} className="animate-spin" /> : mlAutoMessageSaved ? <Check size={14} /> : <Save size={14} />}
                          {mlAutoMessageSaved ? 'GUARDADO' : 'GUARDAR MENSAJE'}
                        </button>
                      </div>
                    </div>

                    {/* Preguntas ML + IA */}
                    <div className="border-t border-slate-700/50 pt-4 mt-2">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Bot size={16} className="text-cyan-400" />
                          <p className="text-white font-bold text-sm">Preguntas de Mercado Libre (IA)</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={mlQuestionsAiEnabled}
                            onChange={(e) => setMlQuestionsAiEnabled(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600" />
                        </label>
                      </div>
                      <p className="text-slate-500 text-xs mb-2">
                        La IA usa la publicación de ML y además un <strong>resumen de todo tu inventario LupoHub</strong> (SKU, talle, color, stock, vínculos ML) para poder sugerir otras tallas u otros productos. En el servidor (.env) podés usar una opción <strong>gratis</strong>: <code className="text-slate-400">GEMINI_API_KEY</code> (Google AI Studio) o <code className="text-slate-400">GROQ_API_KEY</code> (Groq); opcionalmente <code className="text-slate-400">OPENAI_API_KEY</code> (de pago). Opcional: <code className="text-slate-400">ML_QUESTIONS_AI_CATALOG_ENABLED=false</code> para desactivar el catálogo. Para respuesta al instante, registrá el webhook de ML con el tema <strong>questions</strong>.
                      </p>
                      {mlQuestionsAiOpenAiOk && mlQuestionsAiLlmLabel && (
                        <div className="mb-3 p-2 rounded-lg bg-emerald-900/20 border border-emerald-700/40 text-emerald-200 text-xs">
                          IA lista: {mlQuestionsAiLlmLabel}
                        </div>
                      )}
                      {!mlQuestionsAiOpenAiOk && (
                        <div className="mb-3 p-3 rounded-xl bg-amber-900/20 border border-amber-700/40 text-amber-200 text-xs">
                          Falta una clave de IA en el backend (GEMINI_API_KEY, GROQ_API_KEY u OPENAI_API_KEY). Sin eso no se pueden generar respuestas.
                        </div>
                      )}
                      <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Instrucciones extra para la IA (opcional)</label>
                      <textarea
                        value={mlQuestionsAiExtraPrompt}
                        onChange={(e) => setMlQuestionsAiExtraPrompt(e.target.value)}
                        rows={3}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-cyan-500 outline-none resize-none font-mono text-xs mb-3"
                        placeholder="Ej.: Mencioná que los envíos son por Correo Argentino..."
                      />
                      <div className="flex flex-wrap gap-2 justify-end">
                        <button
                          type="button"
                          onClick={async () => {
                            setMlQuestionsAiProcessLoading(true);
                            try {
                              const res = await api.processMLQuestionsAi(10);
                              const ok = res.results?.filter(r => r.status === 'answered').length ?? 0;
                              const err = res.results?.filter(r => r.status === 'error').length ?? 0;
                              showToast('success', `Procesadas: ${res.processed}. Respondidas: ${ok}. Errores: ${err}.`);
                            } catch (e: any) {
                              showToast('error', e?.message || 'No se pudo procesar preguntas');
                            } finally {
                              setMlQuestionsAiProcessLoading(false);
                            }
                          }}
                          disabled={mlQuestionsAiProcessLoading || !mlQuestionsAiOpenAiOk}
                          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                          {mlQuestionsAiProcessLoading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                          PROCESAR AHORA (hasta 10)
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setMlQuestionsAiLoading(true);
                            try {
                              await api.saveMLQuestionsAiConfig({
                                enabled: mlQuestionsAiEnabled,
                                extraSystemPrompt: mlQuestionsAiExtraPrompt
                              });
                              setMlQuestionsAiSaved(true);
                              setTimeout(() => setMlQuestionsAiSaved(false), 3000);
                            } catch (e) {
                              showToast('error', 'Error guardando configuración de preguntas IA');
                            } finally {
                              setMlQuestionsAiLoading(false);
                            }
                          }}
                          disabled={mlQuestionsAiLoading}
                          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                          {mlQuestionsAiLoading ? <Loader2 size={14} className="animate-spin" /> : mlQuestionsAiSaved ? <Check size={14} /> : <Save size={14} />}
                          {mlQuestionsAiSaved ? 'GUARDADO' : 'GUARDAR IA'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
             </div>
          </div>

           {/* API Interna */}
           <div className="bg-slate-800 rounded-3xl border border-slate-700 overflow-hidden shadow-xl lg:col-span-2">
              <div className="p-6 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center">
               <div className="flex items-center gap-3">
                 <div className="bg-indigo-600/20 p-2.5 rounded-2xl text-indigo-400"><Link size={24} /></div>
                 <h3 className="font-black text-white text-lg">API Interna (LupoHub)</h3>
               </div>
               <div className="flex items-center gap-2">
                 <button onClick={handleCheckHealth} className="p-2.5 bg-slate-700 rounded-xl text-white shadow-lg active:scale-95 transition-all hover:bg-slate-600">
                   {healthLoading ? <Loader2 size={20} className="animate-spin" /> : <RefreshCw size={20} />}
                 </button>
                 <button onClick={handleSaveConfig} className="p-2.5 bg-indigo-600 rounded-xl text-white shadow-lg active:scale-95 transition-all hover:bg-indigo-500"><Save size={20}/></button>
               </div>
             </div>
             <div className="p-6 space-y-5">
               <div className="bg-red-900/20 p-4 rounded-xl border border-red-800/50 flex justify-between items-center">
                 <div>
                   <p className="text-xs text-red-400 font-bold uppercase mb-1">Zona de Peligro</p>
                   <p className="text-xs text-slate-400">Eliminar todo el inventario y stock.</p>
                 </div>
                 <button 
                   onClick={() => { setShowDeleteModal(true); setDeleteStep(1); }}
                   className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-white text-xs font-bold transition-all flex items-center gap-2"
                 >
                   <Trash2 size={14} />
                   ELIMINAR TODO
                 </button>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">Base URL</label>
                   <input 
                     type="text" 
                     value={apiBaseUrl}
                     onChange={(e) => setApiBaseUrl(e.target.value)}
                     className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-white font-mono"
                   />
                 </div>
                 <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">API Token (Bearer)</label>
                   <input 
                     type="password" 
                     value={apiToken}
                     onChange={(e) => setApiTokenState(e.target.value)}
                     className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-white font-mono"
                   />
                 </div>
               </div>
               <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-center justify-between">
                 <div className="flex items-center gap-3">
                   <span className="text-[10px] font-black text-slate-500 uppercase">Estado de conexión</span>
                   {healthLoading && <Loader2 size={16} className="text-slate-400 animate-spin" />}
                   {!healthLoading && healthResult === 'ok' && <span className="text-[10px] font-bold text-green-400 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> OK</span>}
                   {!healthLoading && healthResult === 'error' && <span className="text-[10px] font-bold text-red-400 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-red-500"></div> ERROR</span>}
                 </div>
                 <span className="text-[10px] text-slate-400 truncate max-w-[50%]">{healthMessage}</span>
               </div>
             </div>
           </div>
          </div>
        </div>
      )}

      {role === Role.ADMIN && activeTab === 'transportes' && (
        <div className="space-y-6">
          {/* Datos del remitente para remitos */}
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              <FileText size={20} className="text-amber-400" />
              Datos del remitente (para remitos)
            </h3>
            <p className="text-sm text-slate-400 mb-4">Estos datos aparecen en remitos y en la factura AFIP (ver factura desde Pedidos). El logo se muestra en el encabezado de la factura.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="md:col-span-2 space-y-2">
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Logo de la empresa</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                  <div className="md:col-span-2">
                    <input
                      type="text"
                      value={remitenteLogoUrl}
                      onChange={(e) => setRemitenteLogoUrl(e.target.value)}
                      placeholder="https://... (URL de imagen) o subí un archivo"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-xs font-bold cursor-pointer hover:bg-slate-800 transition">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = () => {
                              const dataUrl = String(reader.result || '');
                              if (dataUrl.startsWith('data:image/')) {
                                setRemitenteLogoUrl(dataUrl);
                                showToast('success', 'Logo cargado. Guardá para aplicarlo en facturas/remitos.');
                              } else {
                                showToast('error', 'Archivo inválido. Usá una imagen (PNG/JPG/SVG).');
                              }
                            };
                            reader.onerror = () => showToast('error', 'No se pudo leer el archivo.');
                            reader.readAsDataURL(file);
                          }}
                        />
                        Subir logo
                      </label>
                      {remitenteLogoUrl?.trim() && (
                        <button
                          type="button"
                          onClick={() => setRemitenteLogoUrl('')}
                          className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 text-xs font-bold hover:bg-slate-800 transition"
                        >
                          Quitar
                        </button>
                      )}
                      <span className="text-[11px] text-slate-500">
                        Recomendado: PNG/JPG, ancho ~400px. Si usás URL, que sea pública.
                      </span>
                    </div>
                  </div>
                  <div className="bg-slate-900 border border-slate-700 rounded-2xl p-3 flex items-center justify-center min-h-[92px]">
                    {remitenteLogoUrl?.trim() ? (
                      <img
                        src={remitenteLogoUrl.trim()}
                        alt="Logo"
                        className="max-h-[72px] max-w-full object-contain"
                        onError={(ev) => {
                          (ev.currentTarget as any).style.display = 'none';
                        }}
                      />
                    ) : (
                      <span className="text-xs text-slate-500 text-center">Sin logo</span>
                    )}
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Razón social</label>
                <input type="text" value={remitenteBusinessName} onChange={(e) => setRemitenteBusinessName(e.target.value)} placeholder="Tu empresa o nombre" className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">CUIT</label>
                <input type="text" value={remitenteCuit} onChange={(e) => setRemitenteCuit(e.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="20-12345678-9" className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white font-mono placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Ingresos Brutos</label>
                <input type="text" value={remitenteIngresosBrutos} onChange={(e) => setRemitenteIngresosBrutos(e.target.value)} placeholder="N° de Ingresos Brutos" className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Inicio de Actividad</label>
                <input type="text" value={remitenteInicioActividad} onChange={(e) => setRemitenteInicioActividad(e.target.value)} placeholder="13/06/2005" className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Domicilio</label>
                <input type="text" value={remitenteAddress} onChange={(e) => setRemitenteAddress(e.target.value)} placeholder="Calle y número" className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Localidad</label>
                <input type="text" value={remitenteCity} onChange={(e) => setRemitenteCity(e.target.value)} placeholder="Ciudad / CP" className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Email</label>
                <input type="email" value={remitenteEmail} onChange={(e) => setRemitenteEmail(e.target.value)} placeholder="email@empresa.com" className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Teléfono</label>
                <input type="text" value={remitentePhone} onChange={(e) => setRemitentePhone(e.target.value)} placeholder="11-1234-5678" className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            </div>
            <p className="text-sm text-slate-400 mb-3 mt-6">C.A.I. para remitos (como en Tango: lo cargás vos, se imprime en el pie del remito con vencimiento.)</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">C.A.I. (remitos)</label>
                <input type="text" value={remitenteCaiRemito} onChange={(e) => setRemitenteCaiRemito(e.target.value)} placeholder="Ej: 12345-67890-123456-78901234-1" className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white font-mono placeholder-slate-500 focus:ring-2 focus:ring-amber-500 outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Vencimiento C.A.I.</label>
                <input type="date" value={remitenteCaiVencimiento} onChange={(e) => setRemitenteCaiVencimiento(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-amber-500 outline-none" />
              </div>
            </div>
            <button type="button" onClick={() => { saveRemitente({ businessName: remitenteBusinessName.trim(), address: remitenteAddress.trim() || undefined, city: remitenteCity.trim() || undefined, cuit: remitenteCuit.trim() || undefined, ingresosBrutos: remitenteIngresosBrutos.trim() || undefined, inicioActividad: remitenteInicioActividad.trim() || undefined, email: remitenteEmail.trim() || undefined, phone: remitentePhone.trim() || undefined, logoUrl: remitenteLogoUrl.trim() || undefined, caiRemito: remitenteCaiRemito.trim() || undefined, caiRemitoVencimiento: remitenteCaiVencimiento.trim() || undefined }); showToast('success', 'Datos del remitente guardados.'); }} className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2"><Save size={16} /> Guardar</button>
          </div>
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Ship size={20} className="text-blue-400" />
              Transportes / Express
            </h3>
            <p className="text-sm text-slate-400 mb-4">Agregá los transportes por donde despachás pedidos. Indicá la dirección donde tenés que llevar o enviar el paquete (sucursal, domicilio del transporte). Luego asignálos a cada cliente en la sección Clientes.</p>
            <div className="space-y-3 mb-6">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Nuevo transporte</label>
                  <input
                    type="text"
                    value={newTransporteName}
                    onChange={(e) => setNewTransporteName(e.target.value)}
                    placeholder="Ej: OCA, Andreani, Correo Argentino..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Dirección donde despachar</label>
                  <input
                    type="text"
                    value={newTransporteAddress}
                    onChange={(e) => setNewTransporteAddress(e.target.value)}
                    placeholder="Sucursal o domicilio donde llevar el paquete"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!newTransporteName.trim() || !onCreateTransporte) return;
                    try {
                      await Promise.resolve(onCreateTransporte(newTransporteName.trim(), newTransporteAddress.trim() || undefined));
                      setNewTransporteName('');
                      setNewTransporteAddress('');
                      showToast('success', 'Transporte agregado.');
                    } catch {
                      showToast('error', 'Error al agregar transporte.');
                    }
                  }}
                  disabled={!newTransporteName.trim()}
                  className="bg-blue-600 text-white px-5 py-3 rounded-xl font-bold hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Plus size={18} /> Agregar
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {transportes.length === 0 ? (
                <p className="text-slate-500 text-sm">No hay transportes cargados. Agregá uno arriba.</p>
              ) : (
                transportes.map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-4 py-3 px-4 bg-slate-900 rounded-xl border border-slate-700">
                    {editingTransporteId === t.id ? (
                      <div className="flex-1 flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={editingTransporteName}
                            onChange={(e) => setEditingTransporteName(e.target.value)}
                            placeholder="Nombre"
                            className="bg-slate-800 border border-slate-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            autoFocus
                          />
                          <input
                            type="text"
                            value={editingTransporteAddress}
                            onChange={(e) => setEditingTransporteAddress(e.target.value)}
                            placeholder="Dirección donde despachar el paquete"
                            className="bg-slate-800 border border-slate-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              if (!onUpdateTransporte || !editingTransporteName.trim()) return;
                              try {
                                await Promise.resolve(onUpdateTransporte(t.id, editingTransporteName.trim(), editingTransporteAddress.trim() || undefined));
                                setEditingTransporteId(null);
                                setEditingTransporteName('');
                                setEditingTransporteAddress('');
                                showToast('success', 'Transporte actualizado.');
                              } catch {
                                showToast('error', 'Error al actualizar.');
                              }
                            }}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-bold"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditingTransporteId(null); setEditingTransporteName(''); setEditingTransporteAddress(''); }}
                            className="px-3 py-1.5 bg-slate-600 text-slate-300 rounded-lg text-sm"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-white">{t.name}</span>
                          {t.address && <p className="text-xs text-slate-400 mt-0.5 truncate" title={t.address}>{t.address}</p>}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setEditingTransporteId(t.id); setEditingTransporteName(t.name); setEditingTransporteAddress(t.address ?? ''); }}
                            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition"
                            title="Editar"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!onDeleteTransporte || !window.confirm(`¿Eliminar "${t.name}"? Se quitará de los clientes que lo tengan asignado.`)) return;
                              try {
                                await Promise.resolve(onDeleteTransporte(t.id));
                                showToast('success', 'Transporte eliminado.');
                              } catch {
                                showToast('error', 'Error al eliminar.');
                              }
                            }}
                            className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition"
                            title="Eliminar"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {(role === Role.ADMIN || role === Role.WAREHOUSE) && activeTab === 'facturacion' && (
        <div className="space-y-6">
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              <FileText size={20} className="text-amber-400" />
              Datos fiscales del remitente
            </h3>
            <p className="text-slate-400 text-sm mb-4">Estos datos se usan en factura/remito. También podés editarlos desde Transportes.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Razón social</label>
                <input
                  type="text"
                  value={remitenteBusinessName}
                  onChange={(e) => setRemitenteBusinessName(e.target.value)}
                  placeholder="Tu empresa o nombre"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">CUIT</label>
                <input
                  type="text"
                  value={remitenteCuit}
                  onChange={(e) => setRemitenteCuit(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="20-12345678-9"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white font-mono placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Ingresos Brutos</label>
                <input
                  type="text"
                  value={remitenteIngresosBrutos}
                  onChange={(e) => setRemitenteIngresosBrutos(e.target.value)}
                  placeholder="N° de Ingresos Brutos"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                saveRemitente({
                  businessName: remitenteBusinessName.trim(),
                  address: remitenteAddress.trim() || undefined,
                  city: remitenteCity.trim() || undefined,
                  cuit: remitenteCuit.trim() || undefined,
                  ingresosBrutos: remitenteIngresosBrutos.trim() || undefined,
                  inicioActividad: remitenteInicioActividad.trim() || undefined,
                  email: remitenteEmail.trim() || undefined,
                  phone: remitentePhone.trim() || undefined,
                  logoUrl: remitenteLogoUrl.trim() || undefined,
                  caiRemito: remitenteCaiRemito.trim() || undefined,
                  caiRemitoVencimiento: remitenteCaiVencimiento.trim() || undefined
                });
                showToast('success', 'Datos fiscales guardados.');
              }}
              className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2"
            >
              <Save size={16} /> Guardar datos fiscales
            </button>
          </div>
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              <DollarSign size={20} className="text-emerald-400" />
              Dónde facturar desde LupoHub
            </h3>
            <p className="text-slate-400 text-sm mb-4">LupoHub puede emitir facturas electrónicas con CAE (AFIP) usando Afip SDK. Además tenés remito, Excel y datos para tu contador.</p>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3 text-slate-300">
                <Receipt size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                <span><strong className="text-white">Factura AFIP:</strong> en <strong>Pedidos</strong>, el botón «Emitir factura» (ícono recibo) aparece si en el servidor está configurado AFIP. Podés usar <strong>token</strong> (<code className="bg-slate-700 px-1 rounded text-xs">AFIP_ACCESS_TOKEN</code> de <a href="https://app.afipsdk.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">app.afipsdk.com</a>) o tu <strong>certificado y clave</strong> (<code className="bg-slate-700 px-1 rounded text-xs">AFIP_CERT_PATH</code>, <code className="bg-slate-700 px-1 rounded text-xs">AFIP_KEY_PATH</code> con rutas a tu .crt y .key en PEM). Siempre: <code className="bg-slate-700 px-1 rounded text-xs">AFIP_CUIT</code> y opcional <code className="bg-slate-700 px-1 rounded text-xs">AFIP_PTO_VTA</code>, <code className="bg-slate-700 px-1 rounded text-xs">AFIP_PRODUCTION=true</code> para producción. Ver <code className="bg-slate-700 px-1 rounded text-xs">docs/FACTURACION.md</code>.</span>
              </li>
              <li className="flex items-start gap-3 text-slate-300">
                <FileText size={18} className="text-amber-400 shrink-0 mt-0.5" />
                <span><strong className="text-white">Remito:</strong> en Pedidos, ícono de hoja «Generar remito» para imprimir o guardar PDF (remitente, destinatario, ítems, transporte).</span>
              </li>
              <li className="flex items-start gap-3 text-slate-300">
                <FileSpreadsheet size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                <span><strong className="text-white">Exportar a Excel:</strong> desde Pedidos podés exportar un pedido o todos para tu contador u otro sistema.</span>
              </li>
              <li className="flex items-start gap-3 text-slate-300">
                <Shield size={18} className="text-blue-400 shrink-0 mt-0.5" />
                <span><strong className="text-white">CUIT en clientes:</strong> en <strong>Clientes</strong> cargá el CUIT/CUIL de cada cliente. En Configuración → <strong>Remitos</strong> están los datos del remitente y los transportes.</span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {(activeTab === 'sizes' || activeTab === 'colors') && (
        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
          <div className="flex flex-col md:flex-row gap-4 mb-4 items-end">
            {activeTab === 'colors' ? (
              <>
                <div className="w-full md:w-36 shrink-0">
                  <label className="block text-xs font-black text-slate-500 uppercase mb-2">Código</label>
                  <input
                    type="text"
                    value={newColorCode}
                    onChange={(e) => setNewColorCode(e.target.value)}
                    placeholder="Ej: 111"
                    inputMode="numeric"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-white placeholder-slate-600 focus:ring-2 focus:ring-blue-500 outline-none font-bold font-mono"
                  />
                </div>
                <div className="flex-1 w-full">
                  <label className="block text-xs font-black text-slate-500 uppercase mb-2">Nombre del color</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ej: Natural, Blanco, Arena"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-white placeholder-slate-600 focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="block text-xs font-black text-slate-500 uppercase">Selector</label>
                  <input type="color" value={newColorValue} onChange={(e) => setNewColorValue(e.target.value)} className="h-14 w-20 bg-slate-900 border border-slate-700 rounded-xl p-1 cursor-pointer" />
                </div>
              </>
            ) : (
              <div className="flex-1 w-full">
                <label className="block text-xs font-black text-slate-500 uppercase mb-2">Nombre del Talle</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ej: XXL"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-white placeholder-slate-600 focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                />
              </div>
            )}
            <button
              onClick={handleCreateAttribute}
              disabled={activeTab === 'colors' ? !newColorCode.trim() : !newName.trim()}
              className="bg-blue-600 text-white h-14 px-8 rounded-xl font-black flex items-center gap-2 active:scale-95 transition-all shadow-lg shadow-blue-900/40 uppercase text-xs tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={20}/> Agregar
            </button>
          </div>
          {activeTab === 'sizes' && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
              <button
                type="button"
                onClick={handleUnifySizes}
                disabled={loadingUnifySizes}
                className="self-start px-5 py-3 rounded-xl font-bold text-sm bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 disabled:opacity-50 transition flex items-center gap-2"
              >
                {loadingUnifySizes ? 'Unificando...' : 'Unificar talles'}
              </button>
              <p className="text-xs text-slate-500">
                Reemplaza talles por letra (G, GG, M, P, U, XG…) por el talle canónico con código numérico (150, 160, 140, 130…) y elimina los duplicados.
              </p>
            </div>
          )}
          {activeTab === 'colors' && (
            <div className="flex flex-col gap-3 mb-6">
              <div className="flex flex-col sm:flex-row flex-wrap sm:items-start gap-3">
                <button
                  type="button"
                  onClick={handleImportStandardColorCatalog}
                  disabled={importingStandardColors || mergingFourDigitColors}
                  className="self-start px-5 py-3 rounded-xl font-bold text-sm bg-slate-700 hover:bg-slate-600 text-white border border-slate-600 disabled:opacity-50 transition flex items-center gap-2"
                >
                  {importingStandardColors ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Palette size={18} />
                  )}
                  {importingStandardColors ? 'Importando…' : 'Catálogo estándar (111–999)'}
                </button>
                <button
                  type="button"
                  onClick={handleMergeFourDigitColors}
                  disabled={mergingFourDigitColors || importingStandardColors}
                  className="self-start px-5 py-3 rounded-xl font-bold text-sm bg-amber-900/50 hover:bg-amber-800/60 text-amber-100 border border-amber-700/60 disabled:opacity-50 transition flex items-center gap-2"
                >
                  {mergingFourDigitColors ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Palette size={18} />
                  )}
                  {mergingFourDigitColors ? 'Fusionando…' : 'Fusionar códigos 4 dígitos → 3'}
                </button>
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                <p>
                  Carga en bloque los colores de la tabla maestra (Blanco 111, Arena 614, Negro 999, etc.) con nombre y
                  color en pantalla (RGB → hex). <strong className="text-slate-400">Solo crea</strong> códigos que todavía
                  no existan; no pisa colores que ya cargaste.
                </p>
                <p>
                  Si importaste códigos ERP de <strong className="text-slate-400">4 números</strong> (ej. 2021) y ya tenés
                  el color de <strong className="text-slate-400">3</strong> (202), usá <strong className="text-slate-300">Fusionar códigos 4 dígitos</strong>: mueve variantes al color correcto. Las importaciones nuevas ya toman solo los primeros 3 dígitos.
                </p>
                <p>Si eliminaste un color, volvé a cargar su código y nombre arriba, elegí el color en el selector y tocá Agregar.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
             {(activeTab === 'sizes' ? sizes : colors).map(attr => {
               const code = (attr as any).code != null ? String((attr as any).code).trim() : '';
               const name = attr.name || 'Sin nombre';
               const displayLabel = code ? `${code} - ${name}` : name;
               const isEditingColor = activeTab === 'colors' && editingColorId === attr.id;
               if (isEditingColor) {
                 return (
                   <div key={attr.id} className="bg-slate-900 p-4 rounded-2xl border border-slate-600 flex flex-col gap-3 col-span-full sm:col-span-2">
                     <div className="flex flex-wrap items-center gap-2">
                       <input
                         type="text"
                         value={editingColorCode}
                         onChange={(e) => setEditingColorCode(e.target.value)}
                         placeholder="Código"
                         className="w-24 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono"
                       />
                       <input
                         type="text"
                         value={editingColorName}
                         onChange={(e) => setEditingColorName(e.target.value)}
                         placeholder="Nombre del color"
                         className="flex-1 min-w-[120px] bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
                       />
                       <input
                         type="color"
                         value={editingColorHex}
                         onChange={(e) => setEditingColorHex(e.target.value)}
                         className="h-10 w-14 bg-slate-800 border border-slate-600 rounded-lg p-1 cursor-pointer"
                       />
                     </div>
                     <div className="flex gap-2">
                       <button onClick={handleSaveEditColor} disabled={savingColor || !editingColorCode.trim()} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50">
                         {savingColor ? '...' : 'Guardar'}
                       </button>
                       <button onClick={handleCancelEditColor} disabled={savingColor} className="px-3 py-1.5 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-sm">
                         Cancelar
                       </button>
                     </div>
                   </div>
                 );
               }
               return (
                 <div key={attr.id} className="bg-slate-900 p-4 rounded-2xl border border-slate-800 flex items-center justify-between group hover:border-slate-600 transition-colors">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {attr.type === 'color' && <div className="w-5 h-5 rounded-full border border-white/10 shadow-sm shrink-0" style={{background: attr.value || '#000'}} />}
                      <span className="text-sm font-black text-slate-200 tracking-tight truncate" title={displayLabel}>
                        {displayLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {attr.type === 'color' && (
                        <button onClick={() => handleStartEditColor(attr)} className="text-slate-500 hover:text-blue-400 transition-colors p-1" title="Editar color" aria-label="Editar color">
                          <Pencil size={16}/>
                        </button>
                      )}
                      <button onClick={() => onDeleteAttribute(attr.id)} className="text-slate-600 hover:text-red-400 transition-colors p-1"><Trash2 size={16}/></button>
                    </div>
                 </div>
               );
             })}
          </div>
        </div>
      )}

      {/* Sync Modal */}
      <Modal 
        isOpen={showSyncModal} 
        onClose={() => { if (!loadingSync) setShowSyncModal(false); }} 
        title={syncCompleted ? "Consulta completada" : "Consultar Tienda Nube"}
        footer={
           !loadingSync && !syncCompleted ? (
             <button onClick={handleSyncTiendaNube} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-bold text-sm w-full">
               Consultar productos
             </button>
           ) : syncCompleted ? (
              <button onClick={() => setShowSyncModal(false)} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg font-bold text-sm w-full">
                Finalizar
              </button>
           ) : null
        }
      >
        <div className="space-y-4">
          {!syncCompleted ? (
             <>
                <p className="text-slate-300 text-sm">
                   Consulta los productos y variantes de Tienda Nube. No se guarda nada en la base de datos; usá la vista &quot;Vista Tienda Nube&quot; en Inventario para ver el stock.
                </p>
             </>
          ) : (
             <div className="bg-green-900/20 p-4 rounded-xl border border-green-800/30 flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-white mb-2 shadow-lg shadow-green-900/50">
                   <Check size={24} strokeWidth={3} />
                </div>
                <h4 className="text-white font-bold text-lg">Proceso Completado</h4>
                <div className="flex gap-4 mt-2">
                   <div className="bg-slate-900/50 p-2 rounded-lg border border-slate-700/50 min-w-[80px]">
                      <p className="text-[10px] text-slate-400 uppercase font-black">Productos</p>
                      <p className="text-xl font-black text-white">{syncStats.productCount || syncStats.imported}</p>
                   </div>
                   <div className="bg-slate-900/50 p-2 rounded-lg border border-slate-700/50 min-w-[80px]">
                      <p className="text-[10px] text-slate-400 uppercase font-black">Variantes</p>
                      <p className="text-xl font-black text-white">{syncStats.variantCount || syncStats.updated}</p>
                   </div>
                </div>
             </div>
          )}
          
          {loadingSync && (
             <div className="py-4 flex flex-col items-center justify-center gap-3">
                <Loader2 className="animate-spin text-blue-500" size={32} />
                <p className="text-sm text-blue-400 font-bold animate-pulse">Sincronizando productos...</p>
             </div>
          )}

          {groupedLogs.length > 0 && (
            <div className="mt-2 bg-black/80 p-3 rounded-lg border border-slate-800 h-64 overflow-y-auto font-mono text-[10px] shadow-inner">
              {groupedLogs.map((g, idx) => (
                <div key={idx} className="mb-2">
                  <div className="text-green-400 font-bold">{g.product}</div>
                  <div className="mt-1 pl-2 border-l border-slate-700 space-y-0.5">
                    {g.variants.map((v, i) => (
                      <div key={i} className="text-green-300">{v}</div>
                    ))}
                    {g.errors.map((e, i) => (
                      <div key={`e-${i}`} className="text-red-400">{e}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Normalize colors modal */}
      <Modal
        isOpen={showNormalizeColorsModal}
        onClose={() => setShowNormalizeColorsModal(false)}
        title="Normalizar colores en Tienda Nube"
        footer={
          <button onClick={() => setShowNormalizeColorsModal(false)} className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg font-bold text-sm">
            Cerrar
          </button>
        }
      >
        <div className="space-y-4">
          {normalizeColorsResult && (
            <>
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-wrap gap-4">
                <div className="flex-1 min-w-[120px]">
                  <p className="text-[10px] text-slate-500 uppercase font-black">Variantes actualizadas</p>
                  <p className="text-xl font-black text-green-400">{normalizeColorsResult.updatedVariants}</p>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <p className="text-[10px] text-slate-500 uppercase font-black">Fusionadas</p>
                  <p className="text-xl font-black text-cyan-400">{normalizeColorsResult.mergedVariants ?? 0}</p>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <p className="text-[10px] text-slate-500 uppercase font-black">Errores / omitidas</p>
                  <p className="text-xl font-black text-amber-400">{normalizeColorsResult.skippedDuplicates ?? 0}</p>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <p className="text-[10px] text-slate-500 uppercase font-black">Sin atributo Color</p>
                  <p className="text-xl font-black text-slate-400">{normalizeColorsResult.skippedProducts}</p>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                Los colores se unifican a nombres cortos; duplicados se fusionan con suma de stock ([MERGE] en el log).
              </p>
              {normalizeColorsResult.logs.length > 0 && (
                <div className="bg-black/80 p-3 rounded-lg border border-slate-800 h-48 overflow-y-auto font-mono text-[10px]">
                  {normalizeColorsResult.logs.slice(-50).map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.includes('[ERROR]')
                          ? 'text-red-400'
                          : line.includes('[SKIP]')
                            ? 'text-amber-300'
                            : line.includes('[MERGE]')
                              ? 'text-cyan-300'
                              : 'text-green-300'
                      }
                    >
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {loadingNormalizeColors && (
            <div className="py-6 flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-violet-500" size={32} />
              <p className="text-sm text-violet-400 font-bold">Actualizando colores en Tienda Nube (por lotes, puede tardar varios minutos)...</p>
            </div>
          )}
        </div>
      </Modal>

      {/* Normalize sizes modal */}
      <Modal
        isOpen={showNormalizeSizesModal}
        onClose={() => setShowNormalizeSizesModal(false)}
        title="Normalizar talles en Tienda Nube"
        footer={
          <button onClick={() => setShowNormalizeSizesModal(false)} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg font-bold text-sm">
            Cerrar
          </button>
        }
      >
        <div className="space-y-4">
          {normalizeSizesResult && (
            <>
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-wrap gap-4">
                <div className="flex-1 min-w-[120px]">
                  <p className="text-[10px] text-slate-500 uppercase font-black">Variantes actualizadas</p>
                  <p className="text-xl font-black text-green-400">{normalizeSizesResult.updatedVariants}</p>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <p className="text-[10px] text-slate-500 uppercase font-black">Fusionadas</p>
                  <p className="text-xl font-black text-cyan-400">{normalizeSizesResult.mergedVariants ?? 0}</p>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <p className="text-[10px] text-slate-500 uppercase font-black">Errores / omitidas</p>
                  <p className="text-xl font-black text-amber-400">{normalizeSizesResult.skippedDuplicates ?? 0}</p>
                </div>
                <div className="flex-1 min-w-[120px]">
                  <p className="text-[10px] text-slate-500 uppercase font-black">Sin atributo Talle</p>
                  <p className="text-xl font-black text-slate-400">{normalizeSizesResult.skippedProducts}</p>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                Si hay duplicados (ej. &quot;G&quot; y &quot;G/44-46&quot;), se suma el stock en una variante y se elimina la otra automáticamente. Las líneas [MERGE] en el log muestran cada fusión.
              </p>
              {normalizeSizesResult.logs.length > 0 && (
                <div className="bg-black/80 p-3 rounded-lg border border-slate-800 h-48 overflow-y-auto font-mono text-[10px]">
                  {normalizeSizesResult.logs.slice(-50).map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.includes('[ERROR]')
                          ? 'text-red-400'
                          : line.includes('[SKIP]')
                            ? 'text-amber-300'
                            : line.includes('[MERGE]')
                              ? 'text-cyan-300'
                              : 'text-green-300'
                      }
                    >
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {loadingNormalizeSizes && (
            <div className="py-6 flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-blue-500" size={32} />
              <p className="text-sm text-blue-400 font-bold">Actualizando talles en Tienda Nube (por lotes, puede tardar varios minutos)...</p>
            </div>
          )}
        </div>
      </Modal>

      {/* Mercado Libre Test Modal */}
      <Modal
        isOpen={showMlTestModal}
        onClose={() => setShowMlTestModal(false)}
        title="Prueba de Conexión - Mercado Libre"
        footer={
          <button onClick={() => setShowMlTestModal(false)} className="bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-2 rounded-lg font-bold text-sm w-full">
            Cerrar
          </button>
        }
      >
        <div className="space-y-4">
          {mlTestLoading && (
            <div className="py-6 flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-yellow-500" size={32} />
              <p className="text-sm text-yellow-400 font-bold">Probando conexión con Mercado Libre...</p>
            </div>
          )}
          {mlTestResult && !mlTestLoading && (
            <>
              <div className={`p-4 rounded-xl border flex items-center gap-3 ${mlTestResult.success ? 'bg-green-900/20 border-green-800/50' : 'bg-red-900/20 border-red-800/50'}`}>
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${mlTestResult.success ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                  {mlTestResult.success ? <Check size={24} strokeWidth={3} /> : <AlertCircle size={24} />}
                </div>
                <div>
                  <p className={`font-bold ${mlTestResult.success ? 'text-green-400' : 'text-red-400'}`}>{mlTestResult.message}</p>
                  {!mlTestResult.success && mlTestResult.details && typeof mlTestResult.details === 'string' && (
                    <p className="text-xs text-slate-400 mt-1">{mlTestResult.details}</p>
                  )}
                </div>
              </div>
              {mlTestResult.success && mlTestResult.details && typeof mlTestResult.details === 'object' && (
                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-black">Usuario</p>
                      <p className="text-white font-bold">{mlTestResult.details.nickname || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-black">User ID</p>
                      <p className="text-white font-mono text-sm">{mlTestResult.details.userId || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-black">Email</p>
                      <p className="text-white text-sm truncate">{mlTestResult.details.email || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-black">País</p>
                      <p className="text-white font-bold">{mlTestResult.details.country || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-black">Publicaciones</p>
                      <p className="text-yellow-400 font-black text-xl">{mlTestResult.details.totalItems || 0}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-black">Token Expira</p>
                      <p className="text-white text-xs">{mlTestResult.details.expiresAt || 'N/A'}</p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* Mercado Libre Sync Modal */}
      <Modal
        isOpen={showMlSyncModal}
        onClose={() => { if (!mlSyncLoading) setShowMlSyncModal(false); }}
        title="Sincronización Mercado Libre"
        footer={
          !mlSyncLoading && (
            <button onClick={() => setShowMlSyncModal(false)} className="bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-2 rounded-lg font-bold text-sm w-full">
              Cerrar
            </button>
          )
        }
      >
        <div className="space-y-4">
          {mlSyncLoading && (
            <div className="py-6 flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-yellow-500" size={32} />
              <p className="text-sm text-yellow-400 font-bold">Sincronizando con Mercado Libre...</p>
              <p className="text-xs text-slate-500">Esto puede tomar unos segundos</p>
            </div>
          )}
          {mlSyncResult && !mlSyncLoading && (
            <>
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-black">Publicaciones ML</p>
                  <p className="text-xl font-black text-white">{mlSyncResult.totalItems || 0}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-black">Variantes Vinculadas</p>
                  <p className="text-xl font-black text-green-400">{mlSyncResult.linkedVariants}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-black">Productos Vinculados</p>
                  <p className="text-xl font-black text-blue-400">{mlSyncResult.linkedProducts || 0}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-black">No Encontrados</p>
                  <p className="text-xl font-black text-red-400">{mlSyncResult.notFound || 0}</p>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                La vinculación se hace por SKU. Asegúrate de que los SKUs en Mercado Libre coincidan con los de Tienda Nube.
              </p>
              {mlSyncResult.logs && mlSyncResult.logs.length > 0 && (
                <div className="bg-black/80 p-3 rounded-lg border border-slate-800 h-64 overflow-y-auto font-mono text-[10px]">
                  {mlSyncResult.logs.map((line, i) => (
                    <div key={i} className={
                      line.includes('VINCULADO') ? 'text-green-400' : 
                      line.includes('NO encontrado') || line.includes('Error') ? 'text-red-400' : 
                      line.includes('[ML Item]') ? 'text-yellow-400 font-bold mt-2' :
                      line.includes('=====') ? 'text-blue-400 font-bold mt-2' :
                      'text-slate-400'
                    }>{line}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* Stock Sync Modal */}
      <Modal
        isOpen={showStockSyncModal}
        onClose={() => { if (!tnStockSyncLoading && !mlStockSyncLoading) setShowStockSyncModal(false); }}
        title={mlStockSyncLoading || stockSyncResult?.platform === 'Mercado Libre' ? (mlStockSyncIsImport ? 'Importar stock desde Mercado Libre' : 'Sincronizar stock a Mercado Libre') : (tnStockSyncLoading || stockSyncResult?.platform === 'Tienda Nube') ? 'Sincronizar Stock a Tienda Nube' : 'Sincronizar Stock'}
        footer={
          !tnStockSyncLoading && !mlStockSyncLoading && (
            <button onClick={() => setShowStockSyncModal(false)} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg font-bold text-sm w-full">
              Cerrar
            </button>
          )
        }
      >
        <div className="space-y-4">
          {(tnStockSyncLoading || mlStockSyncLoading) && (
            <div className="py-6 flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-green-500" size={32} />
              <p className="text-sm text-green-400 font-bold">{mlStockSyncLoading ? (mlStockSyncIsImport ? 'Importando stock desde Mercado Libre...' : 'Sincronizando stock a Mercado Libre...') : 'Sincronizando stock...'}</p>
              <p className="text-xs text-slate-500">Esto puede tomar unos minutos</p>
            </div>
          )}
          {stockSyncResult && !tnStockSyncLoading && !mlStockSyncLoading && (
            <>
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-black">Variantes Actualizadas</p>
                  <p className="text-xl font-black text-green-400">{stockSyncResult.updated}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-black">Errores</p>
                  <p className="text-xl font-black text-red-400">{stockSyncResult.errors}</p>
                </div>
              </div>
              {stockSyncResult.logs && stockSyncResult.logs.length > 0 && (
                <div className="bg-black/80 p-3 rounded-lg border border-slate-800 h-64 overflow-y-auto font-mono text-[10px]">
                  {stockSyncResult.logs.map((line, i) => (
                    <div key={i} className={
                      line.includes('[OK]') ? 'text-green-400' : 
                      line.includes('[ERROR]') ? 'text-red-400' : 
                      'text-slate-400'
                    }>{line}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal 
        isOpen={showDeleteModal} 
        onClose={() => setShowDeleteModal(false)} 
        title="Eliminar Todo el Inventario"
        footer={
           <div className="flex gap-2 w-full">
             <button onClick={() => setShowDeleteModal(false)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-bold text-sm">
               Cancelar
             </button>
             {deleteStep === 1 ? (
                <button onClick={() => setDeleteStep(2)} className="flex-1 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-bold text-sm">
                  Continuar
                </button>
             ) : (
                <button onClick={handleDeleteAllProducts} disabled={loadingSync} className="flex-1 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2">
                  {loadingSync ? <Loader2 className="animate-spin" size={16}/> : <Trash2 size={16} />}
                  CONFIRMAR ELIMINACIÓN
                </button>
             )}
           </div>
        }
      >
        <div className="space-y-4 text-center py-4">
           <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center mx-auto text-red-500 mb-2">
             <AlertTriangle size={32} />
           </div>
           {deleteStep === 1 ? (
             <>
               <h4 className="text-white font-bold text-lg">¿Estás absolutamente seguro?</h4>
               <p className="text-slate-400 text-sm">
                 Esta acción eliminará <strong>TODOS</strong> los productos, variantes, stock, colores y talles de la base de datos local.
               </p>
               <p className="text-slate-400 text-sm">
                 Esta acción <strong>NO</strong> se puede deshacer.
               </p>
             </>
           ) : (
             <>
               <h4 className="text-red-500 font-black text-lg uppercase">¡Última Advertencia!</h4>
               <p className="text-slate-300 text-sm">
                 Estás a punto de borrar todo el inventario. ¿Confirmas que quieres proceder?
               </p>
             </>
           )}
        </div>
      </Modal>

    </div>
  );
};

export default Settings;
