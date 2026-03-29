import React, { useState, useEffect, useCallback } from 'react';
import {
  Megaphone,
  MessageCircleQuestion,
  Star,
  Tags,
  Zap,
  Workflow,
  ExternalLink,
  Copy,
  Check,
  BookOpen,
  Clock,
  Webhook,
  Loader2,
  Server,
  RefreshCw,
} from 'lucide-react';
import { api } from '../services/api';
import { useNotification } from '../context/NotificationContext';

const STORAGE_NOTAS = 'lupo_ml_marketing_notas';

const automationBlocks = [
  {
    icon: MessageCircleQuestion,
    title: 'Preguntas y mensajes',
    description:
      'Responder preguntas de publicaciones, mensajes de compradores y post-venta con plantillas y reglas de negocio en n8n.',
    apiHint: 'Endpoints de preguntas y mensajes (users/:user_id/questions, messages, etc.).',
  },
  {
    icon: Star,
    title: 'Reputación y experiencia',
    description:
      'Alertas por nuevas opiniones, consolidación de feedback y recordatorios para mejorar la tasa de respuesta.',
    apiHint: 'Reviews y reputación del vendedor según documentación actual de la API.',
  },
  {
    icon: Tags,
    title: 'Publicaciones y precios',
    description:
      'Ajustes masivos de precio, stock sincronizado con tu ERP o Hub, y pausas programadas por campaña.',
    apiHint: 'Items, variaciones, stock y precios vía API de publicaciones.',
  },
  {
    icon: Zap,
    title: 'Full y logística',
    description:
      'Seguimiento de envíos Full, incidencias y coordinación con otros flujos (por ejemplo avisos a depósito).',
    apiHint: 'Shipments y órdenes; combinar con webhooks o polling según tu cuenta.',
  },
] as const;

const n8nSteps = [
  {
    icon: Webhook,
    title: 'Entrada (trigger)',
    text: 'Webhook, Schedule o Manual para pruebas. Los webhooks de n8n reciben payloads desde ML (si configurás notificaciones) o desde este Hub vía HTTP Request saliente.',
  },
  {
    icon: Workflow,
    title: 'Lógica',
    text: 'IF/Switch, Set, Code y nodos de Mercado Libre o HTTP Request con el token OAuth guardado de forma segura en credenciales de n8n.',
  },
  {
    icon: Clock,
    title: 'Salida y alertas',
    text: 'Slack, email, Telegram o de vuelta a la API de ML para actualizar datos. Registrá errores en Execution log de n8n.',
  },
] as const;

function CopyField({ label, value, placeholder }: { label: string; value: string; placeholder: string }) {
  const [copied, setCopied] = useState(false);
  const display = value.trim() || placeholder;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      <div className="flex gap-2">
        <input
          readOnly
          value={display}
          className="flex-1 min-w-0 bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono truncate"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors"
          title="Copiar"
        >
          {copied ? <Check size={18} className="text-emerald-400" /> : <Copy size={18} />}
        </button>
      </div>
    </div>
  );
}

const MercadoLibreMarketing: React.FC = () => {
  const { showToast } = useNotification();
  const [configLoading, setConfigLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inboundUrl, setInboundUrl] = useState('');
  const [n8nForwardUrl, setN8nForwardUrl] = useState('');
  const [forwardMlNotifications, setForwardMlNotifications] = useState(false);
  const [configHint, setConfigHint] = useState<string | undefined>();
  const [notas, setNotas] = useState('');

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const c = await api.getMLMarketingWebhookConfig();
      setInboundUrl(c.inboundUrl || '');
      setN8nForwardUrl(c.n8nForwardUrl || '');
      setForwardMlNotifications(!!c.forwardMlNotifications);
      setConfigHint(c.hint);
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'No se pudo cargar la configuración de webhooks';
      showToast('error', msg);
    } finally {
      setConfigLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    try {
      setNotas(localStorage.getItem(STORAGE_NOTAS) || '');
    } catch {
      /* ignore */
    }
  }, []);

  const persistNotas = (value: string) => {
    try {
      localStorage.setItem(STORAGE_NOTAS, value);
    } catch {
      /* ignore */
    }
  };

  const handleSaveServerConfig = async () => {
    setSaving(true);
    try {
      const res = await api.putMLMarketingWebhookConfig({
        n8nForwardUrl,
        forwardMlNotifications,
      });
      setInboundUrl(res.inboundUrl);
      setN8nForwardUrl(res.n8nForwardUrl || '');
      setForwardMlNotifications(!!res.forwardMlNotifications);
      showToast('success', 'Configuración guardada');
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Error al guardar';
      showToast('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateSecret = async () => {
    if (
      !window.confirm(
        'Se generará un nuevo secreto. La URL anterior dejará de funcionar. ¿Continuar?'
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const res = await api.putMLMarketingWebhookConfig({ regenerateSecret: true });
      setInboundUrl(res.inboundUrl);
      showToast('success', 'Nueva URL de webhook generada');
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Error al regenerar';
      showToast('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const docLinks = [
    { label: 'Documentación API Mercado Libre', href: 'https://developers.mercadolibre.com.ar/' },
    { label: 'n8n — documentación', href: 'https://docs.n8n.io/' },
    { label: 'n8n community nodes (Mercado Libre)', href: 'https://www.npmjs.com/search?q=n8n-nodes-mercadolibre' },
  ];

  return (
    <div className="space-y-8 pb-8">
      <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-950/40 to-slate-900/80 p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-start gap-4">
          <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 w-fit">
            <Megaphone className="text-amber-400" size={32} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg md:text-xl font-bold text-white mb-2">Marketing Mercado Libre + n8n</h2>
            <p className="text-slate-300 text-sm md:text-base leading-relaxed">
              Automatizá respuestas, campañas y comunicaciones con{' '}
              <span className="text-amber-300/90 font-medium">n8n</span>. El Hub expone{' '}
              <span className="text-slate-200 font-medium">webhooks propios</span>: una URL para invocaciones externas
              (POST) y reenvío opcional de las notificaciones que ya recibe tu backend desde Mercado Libre.
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Qué podés automatizar</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          {automationBlocks.map((block) => (
            <div
              key={block.title}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700">
                  <block.icon size={20} className="text-amber-400" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-semibold text-white text-sm mb-1">{block.title}</h4>
                  <p className="text-slate-400 text-xs leading-relaxed mb-2">{block.description}</p>
                  <p className="text-[11px] text-slate-500 font-mono leading-snug">{block.apiHint}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen size={20} className="text-cyan-400" />
          <h3 className="text-base font-bold text-white">Patrón recomendado en n8n</h3>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {n8nSteps.map((step) => (
            <div key={step.title} className="rounded-lg bg-slate-950/60 border border-slate-800 p-4">
              <div className="flex items-center gap-2 mb-2">
                <step.icon size={18} className="text-cyan-400" />
                <span className="font-medium text-white text-sm">{step.title}</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{step.text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="flex items-center gap-2 mb-1">
          <Server size={20} className="text-emerald-400" />
          <h3 className="text-base font-bold text-white">Webhooks del servidor (Lupo Hub → n8n)</h3>
        </div>
        <p className="text-xs text-slate-500 mb-5 max-w-3xl">
          La URL de entrada es única por instalación y va protegida por un secreto en la ruta. Pegá en n8n la URL del{' '}
          <em>webhook</em> de tu flujo en el campo de abajo; opcionalmente reenviá también lo que recibe el Hub desde el
          webhook oficial de Mercado Libre (<code className="text-slate-400">/api/integrations/mercadolibre/webhook</code>
          ).
        </p>

        {configLoading ? (
          <div className="flex items-center gap-2 text-slate-400 py-8">
            <Loader2 className="animate-spin" size={22} />
            <span className="text-sm">Cargando configuración…</span>
          </div>
        ) : (
          <div className="space-y-5 max-w-3xl">
            {configHint && (
              <p className="text-xs text-amber-200/80 bg-amber-950/30 border border-amber-500/20 rounded-lg px-3 py-2">
                {configHint}
              </p>
            )}
            <CopyField
              label="URL del webhook de entrada (POST JSON — copiá y usala en Zapier, formularios o pruebas con curl)"
              value={inboundUrl}
              placeholder="Sin URL — revisá sesión o BACKEND_URL en el servidor"
            />
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                URL del webhook n8n (destino al reenviar)
              </label>
              <input
                type="url"
                value={n8nForwardUrl}
                onChange={(e) => setN8nForwardUrl(e.target.value)}
                placeholder="https://tu-n8n.com/webhook/xxxx"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={forwardMlNotifications}
                onChange={(e) => setForwardMlNotifications(e.target.checked)}
                className="mt-1 rounded border-slate-600 text-amber-600 focus:ring-amber-500/40"
              />
              <span className="text-sm text-slate-300 leading-snug">
                <span className="font-medium text-white">Reenviar notificaciones de Mercado Libre</span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  Cuando el Hub procesa un POST del webhook oficial de ML, duplica el payload hacia la URL de n8n (mismo
                  destino que arriba). Útil para automatizar marketing sin sustituir la lógica de stock del Hub.
                </span>
              </span>
            </label>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveServerConfig}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : null}
                Guardar configuración
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleRegenerateSecret}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 border border-slate-600 hover:bg-slate-700 text-slate-200 text-sm"
              >
                <RefreshCw size={16} />
                Regenerar URL (nuevo secreto)
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={loadConfig}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-slate-400 hover:text-white text-sm"
              >
                Recargar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <h3 className="text-base font-bold text-white mb-1">Notas locales (solo este navegador)</h3>
        <p className="text-xs text-slate-500 mb-4">
          IDs de flujos, horarios o recordatorios del equipo; no se sincronizan con el servidor.
        </p>
        <div className="max-w-3xl">
          <textarea
            value={notas}
            onChange={(e) => {
              setNotas(e.target.value);
              persistNotas(e.target.value);
            }}
            rows={4}
            placeholder="Ej. Workflow ID 123 — preguntas automáticas lun-vie 9-18h..."
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-y min-h-[100px]"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {docLinks.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800/80 border border-slate-700 text-sm text-amber-200/90 hover:bg-slate-800 hover:border-slate-600 transition-colors"
          >
            {link.label}
            <ExternalLink size={14} />
          </a>
        ))}
      </div>
    </div>
  );
};

export default MercadoLibreMarketing;
