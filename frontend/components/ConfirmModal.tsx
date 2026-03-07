import React from 'react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-xl"
      >
        <div className="p-6">
          <h2 id="confirm-modal-title" className="text-lg font-semibold text-white">
            {title}
          </h2>
          <p className="mt-2 text-sm text-slate-400 whitespace-pre-wrap">{message}</p>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-800 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-600 bg-transparent px-5 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
