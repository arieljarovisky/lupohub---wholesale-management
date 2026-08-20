import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Crop,
  FolderOpen,
  ImagePlus,
  Images,
  Loader2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../services/api';
import ImageCropModal from './ImageCropModal';

const MAX_IMAGES = 15;

type ExistingImage = { key: string; kind: 'existing'; id: number; src: string };
type NewImage = { key: string; kind: 'new'; file: File; src: string };
type DraftImage = ExistingImage | NewImage;

function filePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp)$/i.test(file.name);
}

async function blobToFile(blob: Blob, name: string): Promise<File> {
  return new File([blob], name, { type: blob.type || 'image/jpeg' });
}

type ToastFn = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;

interface IndividualProps {
  productId: string;
  productTitle: string;
  onClose: () => void;
  onSaved?: (thumbnail?: string) => void;
  showToast?: ToastFn;
}

export const TiendaNubeProductImagesModal: React.FC<IndividualProps> = ({
  productId,
  productTitle,
  onClose,
  onSaved,
  showToast,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [images, setImages] = useState<DraftImage[]>([]);
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const objectUrls = useRef<string[]>([]);

  const rememberUrl = (url: string) => {
    objectUrls.current.push(url);
    return url;
  };

  useEffect(() => {
    return () => {
      objectUrls.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getTiendaNubeProductImages(productId);
      setImages(
        (res.images || []).map((im) => ({
          key: `tn-${im.id}`,
          kind: 'existing' as const,
          id: im.id,
          src: im.src,
        }))
      );
    } catch (e: unknown) {
      showToast?.('error', e instanceof Error ? e.message : 'No se pudieron cargar las fotos');
    } finally {
      setLoading(false);
    }
  }, [productId, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const addFiles = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter(isImageFile);
    if (!incoming.length) return;
    setImages((prev) => {
      const room = Math.max(0, MAX_IMAGES - prev.length);
      const take = incoming.slice(0, room);
      if (incoming.length > room) {
        showToast?.('warning', `Tienda Nube permite hasta ${MAX_IMAGES} fotos. Se agregaron ${take.length}.`);
      }
      return [
        ...prev,
        ...take.map((file) => ({
          key: `new-${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
          kind: 'new' as const,
          file,
          src: rememberUrl(URL.createObjectURL(file)),
        })),
      ];
    });
  };

  const move = (idx: number, dir: -1 | 1) => {
    setImages((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const removeAt = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const applyCrop = async (blob: Blob) => {
    if (cropIndex == null) return;
    const file = await blobToFile(blob, `crop-${Date.now()}.jpg`);
    const src = rememberUrl(URL.createObjectURL(file));
    setImages((prev) =>
      prev.map((im, i) =>
        i === cropIndex
          ? { key: `new-crop-${Date.now()}`, kind: 'new', file, src }
          : im
      )
    );
    setCropIndex(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const files: File[] = [];
      const items = images.map((im) => {
        if (im.kind === 'existing') return { id: im.id };
        const fileIndex = files.length;
        files.push(im.file);
        return { fileIndex };
      });
      const res = await api.saveTiendaNubeProductImages(productId, { items, files, keepExisting: false });
      showToast?.('success', `Fotos actualizadas (${res.images.length})`);
      onSaved?.(res.images[0]?.src);
      onClose();
    } catch (e: unknown) {
      showToast?.('error', e instanceof Error ? e.message : 'No se pudieron guardar las fotos');
    } finally {
      setSaving(false);
    }
  };

  const cropSrc = cropIndex != null ? images[cropIndex]?.src : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="bg-slate-800 border border-cyan-800/40 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-700/60">
          <div className="min-w-0">
            <h3 className="text-lg font-black text-white flex items-center gap-2">
              <Images size={20} className="text-cyan-400 shrink-0" />
              Fotos de la publicación
            </h3>
            <p className="text-slate-400 text-sm mt-1 line-clamp-2" title={productTitle}>
              {productTitle}
            </p>
            <p className="text-slate-500 text-xs mt-1">
              Subí, reordená o borrá fotos y guardá para publicarlas en Tienda Nube (máx. {MAX_IMAGES}).
            </p>
          </div>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            className="text-slate-400 hover:text-white p-1"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex flex-col items-center py-12 text-slate-400">
              <Loader2 className="animate-spin mb-3" size={36} />
              Cargando fotos…
            </div>
          ) : (
            <>
              <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm cursor-pointer mb-4">
                <ImagePlus size={16} />
                Agregar fotos
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  multiple
                  className="hidden"
                  disabled={saving}
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              {images.length === 0 ? (
                <p className="text-slate-500 text-sm">Esta publicación no tiene fotos. Agregá al menos una.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {images.map((im, i) => (
                    <div key={im.key} className="bg-slate-900/70 rounded-xl border border-slate-700 overflow-hidden">
                      <div className="relative aspect-square bg-slate-800">
                        <img src={im.src} alt="" className="w-full h-full object-cover" />
                        <span className="absolute top-1.5 left-1.5 text-[10px] font-black bg-black/60 text-white px-1.5 py-0.5 rounded">
                          {i + 1}
                        </span>
                        {im.kind === 'new' && (
                          <span className="absolute top-1.5 right-1.5 text-[10px] font-bold bg-cyan-600 text-white px-1.5 py-0.5 rounded">
                            Nueva
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between p-1.5">
                        <div className="flex gap-0.5">
                          <button
                            type="button"
                            disabled={saving || i === 0}
                            onClick={() => move(i, -1)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30"
                            title="Subir"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={saving || i === images.length - 1}
                            onClick={() => move(i, 1)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30"
                            title="Bajar"
                          >
                            <ChevronDown size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => setCropIndex(i)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-300 hover:bg-slate-700"
                            title="Recortar"
                          >
                            <Crop size={14} />
                          </button>
                        </div>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => removeAt(i)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700"
                          title="Quitar"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2 justify-end p-5 border-t border-slate-700/60">
          <button
            type="button"
            disabled={saving}
            onClick={() => !saving && onClose()}
            className="px-4 py-2.5 rounded-xl text-slate-300 hover:bg-slate-700 font-bold text-sm"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={loading || saving}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {saving ? 'Publicando…' : 'Guardar en Tienda Nube'}
          </button>
        </div>
      </div>

      {cropSrc && (
        <ImageCropModal
          src={cropSrc}
          title="Recortar foto"
          onApply={applyCrop}
          onClose={() => setCropIndex(null)}
        />
      )}
    </div>
  );
};

interface BulkTarget {
  id: string;
  title: string;
}

interface BulkProps {
  selected: BulkTarget[];
  onClose: () => void;
  onSaved?: (thumbnails: Record<string, string>) => void;
  showToast?: ToastFn;
}

export const TiendaNubeBulkImagesModal: React.FC<BulkProps> = ({
  selected,
  onClose,
  onSaved,
  showToast,
}) => {
  const [mode, setMode] = useState<'selected' | 'filename'>(selected.length > 0 ? 'selected' : 'filename');
  const [replace, setReplace] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState('');
  const [preview, setPreview] = useState<{
    matches: Array<{
      productId: string;
      title: string;
      imageCount: number;
      files: Array<{ path: string; seq: number }>;
    }>;
    unmatched: Array<{ path: string; reason: string }>;
    ambiguous: Array<{ path: string; productIds: string[]; titles: string[] }>;
  } | null>(null);

  const fileByPath = useMemo(() => {
    const map = new Map<string, File>();
    for (const f of files) map.set(filePath(f), f);
    return map;
  }, [files]);

  const addIncoming = (list: FileList | File[]) => {
    const incoming = Array.from(list).filter(isImageFile);
    setFiles((prev) => {
      const seen = new Set(prev.map(filePath));
      const extra = incoming.filter((f) => !seen.has(filePath(f)));
      return [...prev, ...extra];
    });
    setPreview(null);
  };

  const runPreview = async () => {
    if (files.length === 0) {
      showToast?.('warning', 'Elegí al menos una imagen');
      return;
    }
    setPreviewing(true);
    try {
      const res = await api.previewTiendaNubeImageMatches({
        paths: files.map(filePath),
        productIds: mode === 'selected' ? selected.map((s) => s.id) : undefined,
      });
      setPreview(res);
      if (res.matches.length === 0) {
        showToast?.('warning', 'Ningún archivo coincidió con una publicación');
      }
    } catch (e: unknown) {
      showToast?.('error', e instanceof Error ? e.message : 'No se pudo emparejar');
    } finally {
      setPreviewing(false);
    }
  };

  const applySelected = async () => {
    if (selected.length === 0) {
      showToast?.('warning', 'Seleccioná publicaciones en la lista');
      return;
    }
    if (files.length === 0) {
      showToast?.('warning', 'Elegí las fotos a aplicar');
      return;
    }
    if (files.length > MAX_IMAGES) {
      showToast?.('warning', `Máximo ${MAX_IMAGES} fotos por publicación`);
      return;
    }
    setApplying(true);
    const thumbs: Record<string, string> = {};
    let ok = 0;
    const errors: string[] = [];
    try {
      for (let i = 0; i < selected.length; i++) {
        const item = selected[i];
        setProgress(`${i + 1}/${selected.length} · ${item.title}`);
        try {
          const items = files.map((_, fileIndex) => ({ fileIndex }));
          const res = await api.saveTiendaNubeProductImages(item.id, {
            items,
            files,
            keepExisting: !replace,
          });
          if (res.images[0]?.src) thumbs[item.id] = res.images[0].src;
          ok += 1;
        } catch (e: unknown) {
          errors.push(`${item.title}: ${e instanceof Error ? e.message : 'error'}`);
        }
      }
      if (ok > 0) onSaved?.(thumbs);
      if (errors.length === 0) {
        showToast?.('success', `Fotos actualizadas en ${ok} publicación(es)`);
        onClose();
      } else {
        showToast?.(
          ok > 0 ? 'warning' : 'error',
          `Listo en ${ok}. Fallaron ${errors.length}. ${errors.slice(0, 3).join(' · ')}`
        );
      }
    } finally {
      setApplying(false);
      setProgress('');
    }
  };

  const applyFilename = async () => {
    if (!preview?.matches.length) {
      showToast?.('warning', 'Primero previsualizá el emparejado');
      return;
    }
    setApplying(true);
    const thumbs: Record<string, string> = {};
    let ok = 0;
    const errors: string[] = [];
    try {
      for (let i = 0; i < preview.matches.length; i++) {
        const match = preview.matches[i];
        setProgress(`${i + 1}/${preview.matches.length} · ${match.title}`);
        const groupFiles = match.files
          .map((f) => fileByPath.get(f.path))
          .filter((f): f is File => !!f);
        if (groupFiles.length === 0) {
          errors.push(`${match.title}: no se encontraron los archivos`);
          continue;
        }
        try {
          const items = groupFiles.slice(0, MAX_IMAGES).map((_, fileIndex) => ({ fileIndex }));
          const res = await api.saveTiendaNubeProductImages(match.productId, {
            items,
            files: groupFiles.slice(0, MAX_IMAGES),
            keepExisting: !replace,
          });
          if (res.images[0]?.src) thumbs[match.productId] = res.images[0].src;
          ok += 1;
        } catch (e: unknown) {
          errors.push(`${match.title}: ${e instanceof Error ? e.message : 'error'}`);
        }
      }
      if (ok > 0) onSaved?.(thumbs);
      if (errors.length === 0) {
        showToast?.('success', `Fotos actualizadas en ${ok} publicación(es)`);
        onClose();
      } else {
        showToast?.(
          ok > 0 ? 'warning' : 'error',
          `Listo en ${ok}. Fallaron ${errors.length}. ${errors.slice(0, 3).join(' · ')}`
        );
      }
    } finally {
      setApplying(false);
      setProgress('');
    }
  };

  const busy = previewing || applying;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="bg-slate-800 border border-cyan-800/40 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-700/60">
          <div>
            <h3 className="text-lg font-black text-white flex items-center gap-2">
              <Images size={20} className="text-cyan-400" />
              Actualizar fotos en masa
            </h3>
            <p className="text-slate-500 text-xs mt-1">
              Aplicá las mismas fotos a las publicaciones marcadas, o emparejá archivos por SKU / ID de Tienda Nube.
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMode('selected');
                setPreview(null);
              }}
              className={`px-3 py-2.5 rounded-xl text-sm font-bold border ${
                mode === 'selected'
                  ? 'bg-cyan-600/20 border-cyan-500 text-white'
                  : 'bg-slate-900 border-slate-600 text-slate-400'
              }`}
            >
              Seleccionadas ({selected.length})
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMode('filename');
                setPreview(null);
              }}
              className={`px-3 py-2.5 rounded-xl text-sm font-bold border ${
                mode === 'filename'
                  ? 'bg-cyan-600/20 border-cyan-500 text-white'
                  : 'bg-slate-900 border-slate-600 text-slate-400'
              }`}
            >
              Por nombre de archivo
            </button>
          </div>

          {mode === 'selected' && (
            <p className="text-slate-400 text-xs">
              {selected.length === 0
                ? 'Marcá publicaciones en la lista (checkbox) y volvé a abrir este panel.'
                : `Se actualizarán ${selected.length} publicación(es) con las mismas fotos.`}
            </p>
          )}
          {mode === 'filename' && (
            <p className="text-slate-400 text-xs">
              Nombrá los archivos con el SKU o el ID de TN (<code className="text-cyan-400/90">24650.jpg</code>,{' '}
              <code className="text-cyan-400/90">24650_2.jpg</code>). Si descargaste el ZIP por categoría, podés
              subir la carpeta: se usa el ID del nombre <code className="text-cyan-400/90">…__123456</code>.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm cursor-pointer">
              <ImagePlus size={16} />
              Elegir fotos
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  if (e.target.files) addIncoming(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm cursor-pointer">
              <FolderOpen size={16} />
              Carpeta
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={busy}
                {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
                onChange={(e) => {
                  if (e.target.files) addIncoming(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            {files.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setFiles([]);
                  setPreview(null);
                }}
                className="px-3 py-2.5 rounded-xl text-slate-400 hover:text-white text-sm font-bold"
              >
                Limpiar ({files.length})
              </button>
            )}
          </div>

          {files.length > 0 && (
            <div className="text-xs text-slate-500 max-h-24 overflow-y-auto rounded-xl bg-slate-900/60 border border-slate-700 p-2 space-y-0.5">
              {files.slice(0, 40).map((f) => (
                <div key={filePath(f)} className="truncate">
                  {filePath(f)}
                </div>
              ))}
              {files.length > 40 && <div>… y {files.length - 40} más</div>}
            </div>
          )}

          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input type="radio" checked={replace} disabled={busy} onChange={() => setReplace(true)} />
              Reemplazar fotos actuales
            </label>
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input type="radio" checked={!replace} disabled={busy} onChange={() => setReplace(false)} />
              Agregar al final
            </label>
          </div>

          {mode === 'filename' && preview && (
            <div className="space-y-2 text-xs">
              <p className="font-bold text-cyan-400">
                {preview.matches.length} publicación(es) coinciden · {preview.unmatched.length} sin match ·{' '}
                {preview.ambiguous.length} ambiguas
              </p>
              <ul className="max-h-40 overflow-y-auto rounded-xl bg-slate-900/60 border border-slate-700 p-2 space-y-1">
                {preview.matches.map((m) => (
                  <li key={m.productId} className="text-slate-300">
                    <span className="text-white font-bold">{m.title}</span>
                    <span className="text-slate-500"> · {m.files.length} foto(s) · hoy {m.imageCount}</span>
                  </li>
                ))}
              </ul>
              {preview.unmatched.length > 0 && (
                <p className="text-orange-300">
                  Sin match: {preview.unmatched.slice(0, 4).map((u) => u.path).join(', ')}
                  {preview.unmatched.length > 4 ? '…' : ''}
                </p>
              )}
              {preview.ambiguous.length > 0 && (
                <p className="text-orange-300">
                  Ambiguas (varias publicaciones): {preview.ambiguous.slice(0, 3).map((a) => a.path).join(', ')}
                </p>
              )}
            </div>
          )}

          {progress && <p className="text-cyan-300 text-sm font-medium">{progress}</p>}
        </div>

        <div className="flex flex-wrap gap-2 justify-end p-5 border-t border-slate-700/60">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-slate-300 hover:bg-slate-700 font-bold text-sm"
          >
            Cancelar
          </button>
          {mode === 'filename' && (
            <button
              type="button"
              disabled={busy || files.length === 0}
              onClick={() => void runPreview()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm disabled:opacity-50"
            >
              {previewing ? <Loader2 size={16} className="animate-spin" /> : null}
              Previsualizar
            </button>
          )}
          <button
            type="button"
            disabled={
              busy ||
              files.length === 0 ||
              (mode === 'selected' && selected.length === 0) ||
              (mode === 'filename' && !preview?.matches.length)
            }
            onClick={() => void (mode === 'selected' ? applySelected() : applyFilename())}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm disabled:opacity-50"
          >
            {applying ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {applying ? 'Actualizando…' : 'Aplicar en Tienda Nube'}
          </button>
        </div>
      </div>
    </div>
  );
};
