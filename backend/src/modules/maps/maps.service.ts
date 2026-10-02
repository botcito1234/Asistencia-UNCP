/**
 * Integracion opcional con Google Maps Routes API.
 *
 * La clave nunca sale del backend. El panel recibe solo los datos necesarios
 * para pintar la ruta: distancia, duracion y polyline codificada.
 */
import { config } from '../../config/env.js';
import { errors, AppError } from '../../core/errors.js';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

export type Coordinate = { latitude: number; longitude: number };
export type TravelMode = 'driving' | 'walking' | 'bicycling' | 'two_wheeler';

export interface RouteRequest {
  origin: Coordinate;
  destination: Coordinate;
  mode: TravelMode;
}

export interface RouteResult extends RouteRequest {
  provider: 'google-routes';
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string | null;
}

type GoogleResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    polyline?: { encodedPolyline?: string };
  }>;
};

const googleMode: Record<TravelMode, string> = {
  driving: 'DRIVE',
  walking: 'WALK',
  bicycling: 'BICYCLE',
  two_wheeler: 'TWO_WHEELER',
};

export function isMapsEnabled(): boolean {
  return config.GOOGLE_MAPS_ENABLED && Boolean(config.GOOGLE_MAPS_API_KEY);
}

function durationToSeconds(duration: string | undefined): number {
  if (!duration) return 0;
  const seconds = Number(duration.replace(/s$/, ''));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
}

export async function computeRoute(input: RouteRequest): Promise<RouteResult> {
  if (!isMapsEnabled()) {
    throw new AppError(
      'DEPENDENCIA_EXTERNA',
      'Google Maps no está configurado. La ruta vial queda deshabilitada.',
      503,
    );
  }

  const response = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': config.GOOGLE_MAPS_API_KEY,
      'x-goog-fieldmask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: input.origin } },
      destination: { location: { latLng: input.destination } },
      travelMode: googleMode[input.mode],
      polylineQuality: 'OVERVIEW',
      polylineEncoding: 'ENCODED_POLYLINE',
      languageCode: 'es',
      units: 'METRIC',
    }),
    signal: AbortSignal.timeout(config.GOOGLE_MAPS_TIMEOUT_MS),
  }).catch((cause: unknown) => {
    throw errors.dependency('Google Maps no respondió a tiempo.', cause);
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw errors.dependency(
      'Google Maps no pudo calcular la ruta. Revise la API habilitada, la facturación y las restricciones de la clave.',
      new Error('Google Routes API ' + response.status + (detail ? ': ' + detail.slice(0, 300) : '')),
    );
  }

  const payload = (await response.json()) as GoogleResponse;
  const route = payload.routes?.[0];
  if (!route) throw errors.dependency('Google Maps no encontró una ruta entre los puntos indicados.');

  return {
    ...input,
    provider: 'google-routes',
    distanceMeters: route.distanceMeters ?? 0,
    durationSeconds: durationToSeconds(route.duration),
    encodedPolyline: route.polyline?.encodedPolyline ?? null,
  };
}
