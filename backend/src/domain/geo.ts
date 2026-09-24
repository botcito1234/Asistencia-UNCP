/**
 * Geometria de geocerca. Funciones puras: no tocan base de datos ni red.
 *
 * El backend SIEMPRE recalcula la distancia con estas funciones. La distancia
 * que reporte el cliente movil es informativa y nunca se acepta como verdad.
 */

/** Radio medio terrestre en metros (WGS-84). */
export const EARTH_RADIUS_METERS = 6_371_008.8;

export interface LatLng {
  latitude: number;
  longitude: number;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Distancia ortodromica (haversine) en metros.
 * A escalas de decenas de metros el error frente a Vincenty es milimetrico,
 * muy por debajo de la precision de cualquier GPS de telefono.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = toRad(b.longitude - a.longitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function isValidCoordinate(point: LatLng): boolean {
  if (!isValidLatitude(point.latitude) || !isValidLongitude(point.longitude)) return false;
  // Isla Nula: (0,0) es el valor por defecto de un GPS que no fijo posicion.
  if (Math.abs(point.latitude) < 1e-7 && Math.abs(point.longitude) < 1e-7) return false;
  return true;
}

export interface GeofenceResult {
  distanceMeters: number;
  radiusMeters: number;
  inside: boolean;
  /** Metros que excede el radio; 0 si esta dentro. */
  overflowMeters: number;
}

export function evaluateGeofence(center: LatLng, point: LatLng, radiusMeters: number): GeofenceResult {
  const distance = round2(haversineMeters(center, point));
  const inside = distance <= radiusMeters;
  return {
    distanceMeters: distance,
    radiusMeters,
    inside,
    overflowMeters: inside ? 0 : round2(distance - radiusMeters),
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
