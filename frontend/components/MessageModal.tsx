import React from 'react';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import type { ToastType } from '../context/NotificationContext';

interface MessageModalProps {
  open: boolean;
  type: ToastType;
  title: string;
  message: string;
  onClose: () => void;
}

const iconMap: Record<ToastType, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const styleMap: Record<ToastType, { iconBg: string; iconColor: string; border: string }> = {
  success: {
    iconBg: 'bg-emerald-500/15',
    iconColor: 'text-emerald-400',
    border: 'border-emerald-500/30',
  },
  error: {
    iconBg: 'bg-red-500/15',
    iconColor: 'text-red-400',
    border: 'border-red-500/30',
  },
  info: {
    iconBg: 'bg-blue-500/15',
    iconColor: 'text-blue-400',
    border: 'border-blue-500/30',
  },
  warning: {
    iconBg: 'bg-amber-500/15',
    iconColor: 'text-amber-400',
    border: 'border-amber-500/30',
  },
};

export function MessageModal({ open, type, title, message, onClose }: MessageModalProps) {
  if (!open) return null;

  const Icon = iconMap[type];
  const style = styleMap[type];
  if (!style) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-modal-title"
        className={`relative w-full max-w-md rounded-2xl border bg-slate-900 shadow-xl ${style.border}`}
      >
        <div className="flex items-start gap-4 p-6">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${style.iconBg} ${style.iconColor}`}>
            <Icon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="message-modal-title" className="text-lg font-semibold text-white">
              {title}
            </h2>
            <p className="mt-1 text-sm text-slate-400 whitespace-pre-wrap">{message}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex justify-end border-t border-slate-800 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-600 transition-colors"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
