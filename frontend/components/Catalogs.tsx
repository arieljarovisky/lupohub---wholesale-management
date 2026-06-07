import React, { useState, useEffect } from 'react';
import { BookOpen, Upload, Link as LinkIcon, Trash2, ExternalLink, Loader2, FileText, X, AlertCircle } from 'lucide-react';
import { Role, PriceList } from '../types';
import { api } from '../services/api';
import TiendaNubeCatalogView from './TiendaNubeCatalog';

interface CatalogItem {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
  isUrl?: boolean;
  url?: string;
}

interface CatalogsProps {
  role: Role;
  priceLists?: PriceList[];
}

const Catalogs: React.FC<CatalogsProps> = ({ role, priceLists = [] }) => {
  const [list, setList] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<'file' | 'url'>('file');
  const [urlName, setUrlName] = useState('');
  const [urlLink, setUrlLink] = useState('');
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null);
  const [openLoadingId, setOpenLoadingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const isAdmin = role === Role.ADMIN;
  const isSeller = role === Role.SELLER;
  const showTnCatalog = isAdmin || isSeller;

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getCatalogs();
      setList(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setList([]);
      setError(e?.message || 'Error cargando catálogos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleOpen = async (item: CatalogItem) => {
    if (item.isUrl && item.url) {
      window.open(item.url, '_blank', 'noopener');
      return;
    }
    setOpenLoadingId(item.id);
    try {
      const blob = await api.getCatalogFileBlob(item.id);
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (e: any) {
      const msg = e?.message || '';
      const is404 = typeof msg === 'string' && (msg.includes('404') || msg.includes('No encontrado') || msg.includes('not found'));
      const friendly = is404
        ? 'El archivo no está disponible en el servidor. Puede que el catálogo se haya subido en otro entorno o el archivo ya no exista.'
        : (msg || 'No se pudo abrir el archivo.');
      setError(friendly);
      setTimeout(() => setError(''), 8000);
    } finally {
      setOpenLoadingId(null);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      await api.uploadCatalog(file, file.name);
      setShowAdd(false);
      if (fileInput) fileInput.value = '';
      load();
    } catch (e: any) {
      setError(e?.message || 'Error subiendo archivo');
    } finally {
      setUploading(false);
    }
  };

  const handleAddUrl = async () => {
    if (!urlName.trim() || !urlLink.trim()) {
      setError('Completá nombre y URL');
      return;
    }
    setError('');
    setUploading(true);
    try {
      await api.createCatalogUrl(urlName.trim(), urlLink.trim());
      setUrlName('');
      setUrlLink('');
      setShowAdd(false);
      load();
    } catch (e: any) {
      setError(e?.message || 'Error agregando enlace');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este catálogo?')) return;
    try {
      await api.deleteCatalog(id);
      load();
    } catch (e: any) {
      alert(e?.message || 'Error eliminando');
    }
  };

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return d;
    }
  };

  if (showTnCatalog) {
    return (
      <div className="space-y-5 sm:space-y-6 max-w-full px-0 sm:px-0">
        <TiendaNubeCatalogView role={role} priceLists={priceLists} />
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6 max-w-full px-0 sm:px-0">
      <>
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white">Catálogos</h2>
          <p className="text-slate-500 text-sm mt-0.5 max-w-xl">
            {isAdmin ? 'Subí PDFs o enlaces para que vendedores y clientes los vean.' : 'Catálogos disponibles para ver o descargar.'}
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <button
              onClick={() => { setShowAdd(true); setAddMode('file'); setError(''); }}
              className="min-h-[48px] px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 touch-manipulation w-full sm:w-auto"
            >
              <Upload size={18} /> Subir archivo
            </button>
            <button
              onClick={() => { setShowAdd(true); setAddMode('url'); setError(''); }}
              className="min-h-[48px] px-4 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm flex items-center justify-center gap-2 touch-manipulation w-full sm:w-auto"
            >
              <LinkIcon size={18} /> Agregar enlace
            </button>
          </div>
        )}
      </div>

      {isAdmin && showAdd && (
        <div className="bg-slate-800/80 rounded-2xl border border-slate-700 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h3 className="font-bold text-white text-sm sm:text-base min-w-0">{addMode === 'file' ? 'Subir archivo (PDF o imagen)' : 'Agregar enlace'}</h3>
            <button onClick={() => { setShowAdd(false); setError(''); }} className="shrink-0 w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white rounded-lg touch-manipulation">
              <X size={20} />
            </button>
          </div>
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          {addMode === 'file' ? (
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
              <input
                ref={(el) => setFileInput(el)}
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp,application/pdf"
                onChange={handleUpload}
                className="text-sm text-slate-300 file:py-3 file:px-4 file:rounded-xl file:border-0 file:bg-emerald-600 file:text-white file:font-bold min-h-[48px]"
              />
              {uploading && <Loader2 size={20} className="animate-spin text-emerald-400" />}
            </div>
          ) : (
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Nombre del catálogo"
                value={urlName}
                onChange={(e) => setUrlName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 outline-none min-h-[48px]"
              />
              <input
                type="url"
                placeholder="https://..."
                value={urlLink}
                onChange={(e) => setUrlLink(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 outline-none min-h-[48px]"
              />
              <button
                onClick={handleAddUrl}
                disabled={uploading || !urlName.trim() || !urlLink.trim()}
                className="w-full min-h-[48px] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2 touch-manipulation"
              >
                {uploading ? <Loader2 size={18} className="animate-spin" /> : <LinkIcon size={18} />}
                Agregar
              </button>
            </div>
          )}
        </div>
      )}

      {error && list.length > 0 && (
        <div className="bg-amber-900/30 border border-amber-700 rounded-xl px-4 py-3 flex items-start gap-3">
          <AlertCircle className="text-amber-400 shrink-0 mt-0.5" size={20} />
          <div className="flex-1 min-w-0">
            <p className="text-amber-200 text-sm font-medium">{error}</p>
          </div>
          <button type="button" onClick={() => setError('')} className="text-amber-400 hover:text-white shrink-0" aria-label="Cerrar"> <X size={18} /> </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={40} className="animate-spin text-emerald-500" />
        </div>
      ) : error && !list.length ? (
        <div className="bg-red-900/20 border border-red-800 rounded-2xl p-6 text-center">
          <AlertCircle className="mx-auto text-red-400 mb-2" size={32} />
          <p className="text-red-300 font-medium">Error al cargar los catálogos</p>
          <p className="text-slate-400 text-sm mt-1">{error}</p>
          <p className="text-slate-500 text-xs mt-2">Verificá que estés logueado y que la conexión con el servidor sea correcta.</p>
        </div>
      ) : list.length === 0 ? (
        <div className="bg-slate-800/50 rounded-2xl border border-slate-700 border-dashed p-8 sm:p-12 text-center">
          <BookOpen size={48} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-500 font-medium">No hay catálogos todavía</p>
          {isAdmin && <p className="text-slate-600 text-sm mt-1 max-w-md mx-auto">Subí un archivo PDF o agregá un enlace para compartir con vendedores y clientes.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {list.map((item) => (
            <div
              key={item.id}
              className="bg-slate-800/80 rounded-xl border border-slate-700 p-4 flex flex-col min-w-0 w-full"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <FileText size={22} className="text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <p className="font-bold text-white text-sm sm:text-base break-words line-clamp-2">{item.name}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{formatDate(item.createdAt)}</p>
                  {item.isUrl && <span className="inline-block mt-1 text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">Enlace</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                <button
                  onClick={() => handleOpen(item)}
                  disabled={openLoadingId === item.id}
                  className="flex-1 min-w-0 min-h-[48px] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 touch-manipulation"
                >
                  {openLoadingId === item.id ? <Loader2 size={18} className="animate-spin" /> : <ExternalLink size={18} />}
                  Ver
                </button>
                {isAdmin && (
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="shrink-0 w-12 h-12 min-h-[48px] flex items-center justify-center rounded-xl bg-slate-700 hover:bg-red-600/80 text-slate-400 hover:text-white transition-colors touch-manipulation"
                    title="Eliminar"
                  >
                    <Trash2 size={20} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </>
    </div>
  );
};

export default Catalogs;
