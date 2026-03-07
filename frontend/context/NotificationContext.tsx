import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { MessageModal } from '../components/MessageModal';
import { ConfirmModal } from '../components/ConfirmModal';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastState {
  open: boolean;
  type: ToastType;
  title: string;
  message: string;
}

export interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

interface NotificationContextValue {
  showToast: (type: ToastType, message: string, title?: string) => void;
  showConfirm: (options: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel?: () => void;
  }) => void;
}

const defaultToast: ToastState = { open: false, type: 'info', title: '', message: '' };
const defaultConfirm: ConfirmState = {
  open: false,
  title: '',
  message: '',
  onConfirm: () => {},
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(defaultToast);
  const [confirm, setConfirm] = useState<ConfirmState>(defaultConfirm);

  const showToast = useCallback((type: ToastType, message: string, title?: string) => {
    const t = type === 'error' ? 'Error' : type === 'success' ? 'Éxito' : type === 'warning' ? 'Aviso' : 'Información';
    setToast({ open: true, type, title: title ?? t, message });
  }, []);

  const closeToast = useCallback(() => setToast(defaultToast), []);

  const showConfirm = useCallback(
    (options: {
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      onConfirm: () => void;
      onCancel?: () => void;
    }) => {
      setConfirm({
        open: true,
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? 'Confirmar',
        cancelLabel: options.cancelLabel ?? 'Cancelar',
        onConfirm: () => {
          options.onConfirm();
          setConfirm(defaultConfirm);
        },
        onCancel: () => {
          options.onCancel?.();
          setConfirm(defaultConfirm);
        },
      });
    },
    []
  );

  const closeConfirm = useCallback(() => {
    setConfirm((prev) => {
      if (prev.open && prev.onCancel) prev.onCancel();
      return defaultConfirm;
    });
  }, []);

  return (
    <NotificationContext.Provider value={{ showToast, showConfirm }}>
      {children}
      <MessageModal
        open={toast.open}
        type={toast.type}
        title={toast.title}
        message={toast.message}
        onClose={closeToast}
      />
      <ConfirmModal
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.confirmLabel}
        cancelLabel={confirm.cancelLabel}
        onConfirm={confirm.onConfirm}
        onCancel={() => { confirm.onCancel?.(); setConfirm(defaultConfirm); }}
      />
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification must be used within NotificationProvider');
  return ctx;
}
