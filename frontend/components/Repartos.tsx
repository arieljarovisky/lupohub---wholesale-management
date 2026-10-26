import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, MapPin, Route, Search, Truck, Warehouse } from 'lucide-react';
import { Customer, Order, OrderStatus, Transporte } from '../types';
import { api } from '../services/api';
import { getRemitente } from '../services/apiIntegration';
import { useNotification } from '../context/NotificationContext';
import { formatOrderDate } from '../utils/formatDate';
import { canonicalizeCityInput, isInteriorDeliveryPlace, stripAccents } from '../utils/cityNormalize';
import { buildDeliveryRouteLinks, MAPS_MAX_WAYPOINTS } from '../utils/googleMapsRoute';

const PREFS_KEY = 'lupo_reparto_prefs';

const STATUS_FILTERS: { status: OrderStatus; label: string }[] = [
  { status: OrderStatus.CONTROLLED, label: 'Controlado' },
  { status: OrderStatus.PENDING_CONTROL, label: 'Falta controlar' },
  { status: OrderStatus.PREPARING, label: 'Preparando' },
  { status: OrderStatus.CONFIRMED, label: 'Confirmado' },
  { status: OrderStatus.DISPATCHED, label: 'Despachado' },
];

type Prefs = {
  depot?: string;
  depotCustom?: boolean;
  returnToDepot?: boolean;
};

type AddressOption = {
  id: string;
  label: string;
  query: string;
  /** Nombre de la parada (transporte o cliente). */
  stopTitle: string;
};

type StopItem = {
  key: string;
  title: string;
  detail: string;
  query: string;
  customers: string[];
};

interface RepartosProps {
  orders: Order[];
  customers: Customer[];
  transportes?: Transporte[];
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    return {};
  }
}

function savePrefs(partial: Prefs) {
  const next = { ...loadPrefs(), ...partial };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
}

function joinAddress(address?: string, city?: string): string {
  const street = String(address || '').replace(/\s+/g, ' ').trim();
  const cityLabel = canonicalizeCityInput(city || '');
  if (!cityLabel) return street;
  const streetKey = stripAccents(street).toLowerCase();
  const cityKey = stripAccents(cityLabel).toLowerCase();
  if (cityKey && streetKey.includes(cityKey)) return street;
  return [street, cityLabel].filter(Boolean).join(', ');
}

function toMapsQuery(raw: string): string {
  const cleaned = raw.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (/argentina/i.test(cleaned)) return cleaned;
  return `${cleaned}, Argentina`;
}

function customerAddresses(customer: Customer, stopTitle: string): AddressOption[] {
  const options: AddressOption[] = [];
  const principal = joinAddress(customer.address, customer.city);
  if (principal) {
    options.push({
      id: 'principal',
      label: 'Domicilio del cliente',
      query: toMapsQuery(principal),
      stopTitle,
    });
  }
  for (const branch of customer.deliveryAddresses || []) {
    const query = joinAddress(branch.address, branch.city);
    if (!query) continue;
    options.push({
      id: branch.id,
      label: branch.label?.trim() || 'Sucursal',
      query: toMapsQuery(query),
      stopTitle,
    });
  }
  return options;
}

function transportesForCustomer(customer: Customer | undefined, catalog: Transporte[]): Transporte[] {
  const assigned = customer?.transportes ?? [];
  return assigned.map((item) => {
    const full = catalog.find((t) => t.id === item.id);
    const name = (full?.name || item.name || '').trim() || 'Transporte';
    const address = (full?.address || item.address || '').trim();
    return { id: item.id, name, address: address || undefined };
  });
}

function addressOptionsFor(
  customer: Customer | undefined,
  catalog: Transporte[]
): { options: AddressOption[]; interior: boolean; transporteHint: string } {
  if (!customer) return { options: [], interior: false, transporteHint: '' };
  const name = customer.businessName || customer.name || 'Cliente';
  const interior = isInteriorDeliveryPlace(customer.city, customer.accountZone);
  const domicilios = customerAddresses(customer, name);
  if (!interior) return { options: domicilios, interior: false, transporteHint: '' };

  const carriers = transportesForCustomer(customer, catalog);
  const withAddress = carriers.filter((t) => t.address);
  const transporteOptions: AddressOption[] = withAddress.map((t) => ({
    id: `transporte:${t.id}`,
    label: `Transporte ${t.name}`,
    query: toMapsQuery(t.address || ''),
    stopTitle: t.name,
  }));
  if (transporteOptions.length > 0) {
    return { options: [...transporteOptions, ...domicilios], interior: true, transporteHint: '' };
  }
  const names = carriers.map((t) => t.name).filter(Boolean);
  const place = customer.city?.trim() || 'el interior';
  const transporteHint = names.length
    ? `Cliente de ${place}. El transporte ${names.join(', ')} no tiene dirección: cargala en Configuración para incluirlo en el recorrido.`
    : `Cliente de ${place} sin transporte asignado. El reparto deja el paquete en el transporte, no en el domicilio.`;
  return { options: [], interior: true, transporteHint };
}

function dedupeStops(stops: StopItem[]): StopItem[] {
  const map = new Map<string, StopItem>();
  for (const stop of stops) {
    const key = stripAccents(stop.query).toLowerCase();
    if (!key) continue;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...stop, key: `place:${key}`, customers: [...stop.customers] });
      continue;
    }
    for (const name of stop.customers) {
      if (name && !prev.customers.includes(name)) prev.customers.push(name);
    }
  }
  return [...map.values()].map((stop) => ({
    ...stop,
    detail: stop.customers.length > 1 ? stop.customers.join(' · ') : stop.detail,
  }));
}

const Repartos: React.FC<RepartosProps> = ({ orders, customers, transportes = [] }) => {
  const { showToast } = useNotification();
  const depotTouched = useRef(false);
  const [depot, setDepot] = useState('');
  const [returnToDepot, setReturnToDepot] = useState(true);
  const [includeShowroom, setIncludeShowroom] = useState(false);
  const [statuses, setStatuses] = useState<OrderStatus[]>([OrderStatus.CONTROLLED]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [addressChoice, setAddressChoice] = useState<Record<string, string>>({});
  const [manualText, setManualText] = useState('');
  const [finalStopKey, setFinalStopKey] = useState('');

  useEffect(() => {
    const prefs = loadPrefs();
    if (prefs.returnToDepot === false) setReturnToDepot(false);
    if (prefs.depotCustom && prefs.depot?.trim()) {
      setDepot(prefs.depot);
      return;
    }
    const local = getRemitente();
    const localAddr = joinAddress(local.address, local.city);
    if (localAddr) setDepot(localAddr);
    let cancelled = false;
    api.getRemitenteServer().then((remote) => {
      if (cancelled || depotTouched.current) return;
      const remoteAddr = joinAddress(remote.address, remote.city);
      if (remoteAddr) setDepot(remoteAddr);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const customersById = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const customer of customers) map.set(customer.id, customer);
    return map;
  }, [customers]);

  const eligible = useMemo(() => {
    return orders
      .filter((order) => !order.archived)
      .filter((order) => statuses.includes(order.status))
      .filter((order) => includeShowroom || !order.showroomSale)
      .map((order) => {
        const customer = customersById.get(order.customerId);
        const name = order.customerBusinessName || customer?.businessName || customer?.name || 'Cliente';
        const resolved = addressOptionsFor(customer, transportes);
        return { order, name, city: customer?.city?.trim() || '', ...resolved };
      })
      .sort((a, b) => String(b.order.date || '').localeCompare(String(a.order.date || '')));
  }, [orders, customersById, statuses, includeShowroom, transportes]);

  const rows = useMemo(() => {
    const q = stripAccents(search).toLowerCase().trim();
    if (!q) return eligible;
    return eligible.filter((row) => {
      const blob = stripAccents(
        [row.name, row.city, row.transporteHint, row.order.notes || '', row.order.remitoNumber ? String(row.order.remitoNumber) : '', ...row.options.map((o) => `${o.label} ${o.query}`)].join(' ')
      ).toLowerCase();
      return blob.includes(q);
    });
  }, [eligible, search]);

  const chosenQuery = (orderId: string, options: AddressOption[]) => {
    const picked = addressChoice[orderId];
    return options.find((o) => o.id === picked)?.query || options[0]?.query || '';
  };

  const stops = useMemo(() => {
    const fromOrders: StopItem[] = [];
    for (const row of eligible) {
      if (!selected[row.order.id]) continue;
      const picked = addressChoice[row.order.id];
      const option = row.options.find((o) => o.id === picked) || row.options[0];
      const query = option?.query || '';
      if (!query) continue;
      fromOrders.push({
        key: `order:${row.order.id}`,
        title: option?.stopTitle || row.name,
        detail: option?.stopTitle && option.stopTitle !== row.name ? row.name : option?.label || query,
        query,
        customers: [row.name],
      });
    }
    const manual = manualText
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => ({
        key: `manual:${index}:${line}`,
        title: line,
        detail: 'Dirección extra',
        query: toMapsQuery(line),
        customers: [],
      }));
    return dedupeStops([...fromOrders, ...manual]);
  }, [eligible, selected, addressChoice, manualText]);

  useEffect(() => {
    if (!stops.some((stop) => stop.key === finalStopKey)) {
      setFinalStopKey(stops[stops.length - 1]?.key || '');
    }
  }, [stops, finalStopKey]);

  const orderedStops = useMemo(() => {
    if (returnToDepot || stops.length < 2) return stops;
    const final = stops.find((stop) => stop.key === finalStopKey) || stops[stops.length - 1];
    return [...stops.filter((stop) => stop.key !== final.key), final];
  }, [stops, returnToDepot, finalStopKey]);

  const originQuery = toMapsQuery(depot);
  const links = useMemo(
    () => buildDeliveryRouteLinks(originQuery, orderedStops.map((stop) => stop.query), returnToDepot),
    [originQuery, orderedStops, returnToDepot]
  );

  const visibleWithAddress = rows.filter((row) => row.options.length > 0);
  const selectedVisible = visibleWithAddress.filter((row) => selected[row.order.id]).length;

  const toggleStatus = (status: OrderStatus) => {
    setStatuses((prev) => (prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]));
  };

  const selectVisible = (on: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const row of visibleWithAddress) next[row.order.id] = on;
      return next;
    });
  };

  const useCompanyAddress = async () => {
    depotTouched.current = true;
    const local = getRemitente();
    let next = joinAddress(local.address, local.city);
    try {
      const remote = await api.getRemitenteServer();
      const remoteAddr = joinAddress(remote.address, remote.city);
      if (remoteAddr) next = remoteAddr;
    } catch {
      /* queda la dirección local */
    }
    if (!next) {
      showToast('error', 'No hay dirección de empresa cargada en Configuración.');
      return;
    }
    setDepot(next);
    savePrefs({ depot: next, depotCustom: false });
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast('success', 'Enlace copiado.');
    } catch {
      showToast('error', 'No se pudo copiar el enlace.');
    }
  };

  const missingDepot = !originQuery;
  const missingStops = orderedStops.length === 0;

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400 max-w-3xl">
        Elegí los pedidos que salen del depósito. En CABA y GBA la parada es el domicilio del cliente. En el interior, el recorrido va a la dirección del transporte. Google Maps ordena las paradas para acortar el viaje.
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Warehouse size={18} className="text-emerald-400" />
            Salida desde el depósito
          </div>
          <label className="block">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Dirección del depósito</span>
            <input
              value={depot}
              onChange={(e) => {
                const value = e.target.value;
                depotTouched.current = true;
                setDepot(value);
                savePrefs({ depot: value, depotCustom: true });
              }}
              placeholder="Calle, número, localidad"
              className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-3 text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </label>
          <div className="flex flex-wrap gap-3 items-center">
            <button
              type="button"
              onClick={useCompanyAddress}
              className="text-sm font-medium text-emerald-300 hover:text-emerald-200"
            >
              Usar dirección de la empresa
            </button>
            <label className="inline-flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={returnToDepot}
                onChange={(e) => {
                  setReturnToDepot(e.target.checked);
                  savePrefs({ returnToDepot: e.target.checked });
                }}
                className="rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
              />
              Volver al depósito al final
            </label>
          </div>
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-white font-semibold">Recorrido</p>
              <p className="text-sm text-slate-400">
                {orderedStops.length === 0
                  ? 'Sin paradas elegidas'
                  : `${orderedStops.length} ${orderedStops.length === 1 ? 'parada' : 'paradas'}`}
              </p>
            </div>
            <Route size={22} className="text-emerald-400" />
          </div>
          {missingDepot && (
            <p className="text-sm text-amber-300">Escribí la dirección del depósito para armar el recorrido.</p>
          )}
          {missingStops && !missingDepot && (
            <p className="text-sm text-slate-400">Elegí pedidos con dirección o agregá una dirección extra.</p>
          )}
          {!returnToDepot && orderedStops.length > 1 && (
            <label className="block">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Última parada</span>
              <select
                value={finalStopKey}
                onChange={(e) => setFinalStopKey(e.target.value)}
                className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {stops.map((stop) => (
                  <option key={stop.key} value={stop.key}>
                    {stop.customers.length > 1 ? `${stop.title} (${stop.customers.length})` : stop.title}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">Google Maps ordena el resto. Esta queda como destino final.</p>
            </label>
          )}
          {links.length > 1 && (
            <p className="text-xs text-amber-200/90">
              Google Maps acepta hasta {MAPS_MAX_WAYPOINTS} paradas intermedias por recorrido. Hay {links.length} tramos y cada uno sale del depósito.
            </p>
          )}
          <div className="mt-auto space-y-2">
            {links.length === 0 ? (
              <span className="flex items-center justify-center gap-2 w-full rounded-xl bg-slate-800 text-slate-500 font-bold px-4 py-3 cursor-not-allowed">
                <MapPin size={18} />
                Abrir en Google Maps
              </span>
            ) : (
              links.map((link, index) => (
                <div key={link.url} className="flex gap-2">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-3 transition"
                  >
                    <MapPin size={18} />
                    {links.length === 1 ? 'Abrir en Google Maps' : `Abrir tramo ${index + 1} (${link.stopCount})`}
                  </a>
                  <button
                    type="button"
                    onClick={() => copyLink(link.url)}
                    className="shrink-0 rounded-xl border border-slate-700 px-3 text-slate-300 hover:text-white hover:bg-slate-800"
                    title="Copiar enlace"
                    aria-label="Copiar enlace"
                  >
                    <Copy size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-white font-semibold">Pedidos para el reparto</h3>
            <p className="text-xs text-slate-500 mt-1">
              {selectedVisible} de {visibleWithAddress.length} visibles con dirección
            </p>
          </div>
          <div className="relative w-full lg:max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cliente, remito o dirección"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((item) => {
            const on = statuses.includes(item.status);
            return (
              <button
                key={item.status}
                type="button"
                onClick={() => toggleStatus(item.status)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                  on
                    ? 'bg-emerald-600/20 text-emerald-200 border-emerald-500/40'
                    : 'bg-slate-950 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
          <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeShowroom}
              onChange={(e) => setIncludeShowroom(e.target.checked)}
              className="rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
            />
            Incluir showroom
          </label>
        </div>

        <div className="flex gap-3 text-sm">
          <button type="button" onClick={() => selectVisible(true)} className="text-emerald-300 hover:text-emerald-200 font-medium">
            Seleccionar visibles
          </button>
          <button type="button" onClick={() => selectVisible(false)} className="text-slate-400 hover:text-white font-medium">
            Quitar visibles
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">No hay pedidos en estos estados.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const hasAddress = row.options.length > 0;
              const checked = !!selected[row.order.id] && hasAddress;
              const query = chosenQuery(row.order.id, row.options);
              const selectedOption = row.options.find((o) => o.id === (addressChoice[row.order.id] || row.options[0]?.id));
              const usingTransporte = !!selectedOption?.id.startsWith('transporte:');
              return (
                <li
                  key={row.order.id}
                  className={`rounded-xl border px-3 py-3 sm:px-4 ${
                    checked ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-slate-800 bg-slate-950/40'
                  }`}
                >
                  <div className="flex gap-3">
                    <label className="pt-0.5">
                      <input
                        type="checkbox"
                        disabled={!hasAddress}
                        checked={checked}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [row.order.id]: e.target.checked }))}
                        className="rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500 disabled:opacity-40"
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-white truncate">{row.name}</p>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 border border-slate-700 rounded-full px-2 py-0.5">
                          {row.order.status}
                        </span>
                        {row.interior && (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-amber-200 border border-amber-500/40 rounded-full px-2 py-0.5 inline-flex items-center gap-1">
                            <Truck size={10} /> Interior
                          </span>
                        )}
                        {row.order.remitoNumber != null && (
                          <span className="text-xs text-slate-400">Remito {row.order.remitoNumber}</span>
                        )}
                        <span className="text-xs text-slate-500">{formatOrderDate(row.order.date)}</span>
                      </div>
                      {row.order.notes?.trim() && (
                        <p className="text-xs text-slate-500 mt-1 truncate">{row.order.notes.trim()}</p>
                      )}
                      {row.interior && row.city && usingTransporte && (
                        <p className="text-xs text-slate-500 mt-1">Cliente en {row.city}. La parada del recorrido es el transporte.</p>
                      )}
                      {hasAddress ? (
                        row.options.length > 1 ? (
                          <select
                            value={addressChoice[row.order.id] || row.options[0].id}
                            onChange={(e) => setAddressChoice((prev) => ({ ...prev, [row.order.id]: e.target.value }))}
                            className="mt-2 w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-200 outline-none"
                          >
                            {row.options.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label} — {option.query.replace(/, Argentina$/i, '')}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <p className="text-sm text-slate-300 mt-1 flex items-start gap-1.5">
                            <MapPin size={14} className="mt-0.5 shrink-0 text-slate-500" />
                            <span>
                              {row.options[0]?.stopTitle && row.options[0].stopTitle !== row.name
                                ? `${row.options[0].label} — `
                                : ''}
                              {query.replace(/, Argentina$/i, '')}
                            </span>
                          </p>
                        )
                      ) : (
                        <p className="text-sm text-amber-300/90 mt-1">
                          {row.transporteHint || 'Este cliente no tiene dirección cargada.'}
                        </p>
                      )}
                    </div>
                    {checked && <Check size={16} className="text-emerald-400 shrink-0 mt-1" />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-2">
        <h3 className="text-white font-semibold">Direcciones extra</h3>
        <p className="text-xs text-slate-500">Una por línea. Entran al mismo recorrido, aunque no haya un pedido.</p>
        <textarea
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          rows={4}
          placeholder={'Av. Rivadavia 4500, CABA\nSan Martín 120, Rosario'}
          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-3 text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
        />
      </section>
    </div>
  );
};

export default Repartos;
