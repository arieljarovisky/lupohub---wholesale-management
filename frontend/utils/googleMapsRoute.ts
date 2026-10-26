/** Google Maps URLs acepta como máximo 9 paradas intermedias. */
export const MAPS_MAX_WAYPOINTS = 9;

export type MapsRouteLink = {
  url: string;
  stopCount: number;
};

/**
 * Arma el enlace de Google Maps.
 * Con regreso al depósito, todas las paradas son intermedias y Maps las reordena.
 * Sin regreso, la última parada queda fija como destino y Maps reordena el resto.
 */
export function buildGoogleMapsDirectionsUrl(
  origin: string,
  stops: string[],
  returnToOrigin: boolean
): string | null {
  const from = origin.trim();
  const cleanStops = stops.map((s) => s.trim()).filter(Boolean);
  if (!from || cleanStops.length === 0) return null;

  const destination = returnToOrigin ? from : cleanStops[cleanStops.length - 1];
  const waypoints = returnToOrigin ? cleanStops : cleanStops.slice(0, -1);

  const params = [
    'api=1',
    `origin=${encodeURIComponent(from)}`,
    `destination=${encodeURIComponent(destination)}`,
    'travelmode=driving',
    'dir_action=navigate',
  ];
  if (waypoints.length > 0) {
    const encoded = ['optimize:true', ...waypoints].map((part) => encodeURIComponent(part)).join('|');
    params.push(`waypoints=${encoded}`);
  }
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}

/** Cuántas paradas entran en un enlace. Con regreso al depósito, todas son intermedias. */
export function deliveryChunkSize(returnToOrigin: boolean): number {
  return returnToOrigin ? MAPS_MAX_WAYPOINTS : MAPS_MAX_WAYPOINTS + 1;
}

/** Parte las paradas en tramos que entran en un solo enlace de Google Maps. */
export function chunkDeliveryStops(stops: string[], returnToOrigin: boolean): string[][] {
  const size = deliveryChunkSize(returnToOrigin);
  const chunks: string[][] = [];
  for (let i = 0; i < stops.length; i += size) chunks.push(stops.slice(i, i + size));
  return chunks;
}

export function buildDeliveryRouteLinks(
  origin: string,
  stops: string[],
  returnToOrigin: boolean
): MapsRouteLink[] {
  return chunkDeliveryStops(stops, returnToOrigin)
    .map((chunk) => {
      const url = buildGoogleMapsDirectionsUrl(origin, chunk, returnToOrigin);
      return url ? { url, stopCount: chunk.length } : null;
    })
    .filter((link): link is MapsRouteLink => link != null);
}
