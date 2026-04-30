import React, { useEffect, useMemo, useState } from 'react';
import { BellRing, Trash2 } from 'lucide-react';
import { api } from '../services/api';
import { User, UserTask } from '../types';
import { useNotification } from '../context/NotificationContext';

interface UserTaskManagerProps {
  users: User[];
}

const UserTaskManager: React.FC<UserTaskManagerProps> = ({ users }) => {
  const { showToast } = useNotification();
  const [items, setItems] = useState<UserTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [assignedToEmail, setAssignedToEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const userOptions = useMemo(
    () =>
      users
        .filter((u) => !!u.email)
        .map((u) => ({ email: u.email.trim().toLowerCase(), label: `${u.name} (${u.email})` })),
    [users]
  );

  const reload = () => {
    setLoading(true);
    api
      .getAssignedUserTasks()
      .then((rows) => setItems(Array.isArray(rows) ? rows : []))
      .catch((err: any) => showToast('error', err?.message || 'No se pudieron cargar las tareas'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, []);

  const handleCreate = async () => {
    const msg = message.trim();
    const email = assignedToEmail.trim().toLowerCase();
    if (!msg) return showToast('error', 'Escribí la tarea');
    if (!email) return showToast('error', 'Elegí a quién asignar');
    if (!expiresAt) return showToast('error', 'Indicá fecha y hora de fin');
    setSaving(true);
    try {
      const created = await api.createAssignedUserTask({ message: msg, assignedToEmail: email, expiresAt });
      setItems((prev) => [created, ...prev]);
      setMessage('');
      showToast('success', 'Tarea asignada');
    } catch (err: any) {
      showToast('error', err?.message || 'No se pudo crear la tarea');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteAssignedUserTask(id);
      setItems((prev) => prev.filter((t) => t.id !== id));
      showToast('success', 'Tarea eliminada');
    } catch (err: any) {
      showToast('error', err?.message || 'No se pudo eliminar la tarea');
    }
  };

  return (
    <section className="mb-6 rounded-2xl border border-blue-800/50 bg-blue-950/20 p-4 md:p-5">
      <h3 className="text-white font-bold flex items-center gap-2 mb-3">
        <BellRing size={18} className="text-blue-300" />
        Asignar tareas temporales
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Texto del cartel/tarea"
          className="md:col-span-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
        />
        <select
          value={assignedToEmail}
          onChange={(e) => setAssignedToEmail(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
        >
          <option value="">Asignar a...</option>
          {userOptions.map((u) => (
            <option key={u.email} value={u.email}>
              {u.label}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white"
        />
      </div>
      <button
        type="button"
        onClick={handleCreate}
        disabled={saving}
        className="mb-4 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50"
      >
        {saving ? 'Guardando...' : 'Asignar tarea'}
      </button>
      <div className="space-y-2">
        {loading && <p className="text-slate-400 text-sm">Cargando tareas...</p>}
        {!loading && items.length === 0 && <p className="text-slate-500 text-sm">No hay tareas asignadas.</p>}
        {items.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/70 p-3">
            <div className="min-w-0">
              <p className="text-slate-100 text-sm">{t.message}</p>
              <p className="text-xs text-slate-400">
                Para: {t.assignedToEmail} · Hasta: {new Date(t.expiresAt).toLocaleString('es-AR')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(t.id)}
              className="w-9 h-9 rounded-lg hover:bg-red-900/30 text-slate-400 hover:text-red-400 flex items-center justify-center"
              title="Eliminar tarea"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};

export default UserTaskManager;
