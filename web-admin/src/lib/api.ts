/**
 * Cliente HTTP del panel.
 *
 * Responsabilidades:
 *  - Adjuntar el access token.
 *  - Renovar automaticamente con el refresh token cuando el access caduca, sin
 *    que el usuario note nada y sin duplicar renovaciones concurrentes.
 *  - Traducir el contrato de error del servidor a una excepcion tipada, para que
 *    la interfaz pueda reaccionar al codigo y no al texto.
 *
 * Los tokens viven en localStorage. Es una decision consciente: el panel es una
 * SPA servida aparte de la API, por lo que no se pueden usar cookies de sesion
 * del mismo sitio. El riesgo se acota con access tokens de 15 minutos, rotacion
 * de refresh y revocacion inmediata en servidor.
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const API = BASE_URL + '/api/v1';

const ACCESS_KEY = 'asistencia.accessToken';
const REFRESH_KEY = 'asistencia.refreshToken';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
    readonly meta?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const tokens = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string): void {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** Se notifica cuando la sesion deja de ser valida, para redirigir al login. */
type SessionListener = () => void;
const sessionListeners = new Set<SessionListener>();

export function onSessionExpired(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function notifySessionExpired(): void {
  tokens.clear();
  for (const l of sessionListeners) l();
}

// Una sola renovacion en vuelo, aunque fallen varias peticiones a la vez.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = tokens.refresh;
    if (!refreshToken) return false;

    try {
      const res = await fetch(API + '/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;

      const data = (await res.json()) as { tokens: { accessToken: string; refreshToken: string } };
      tokens.set(data.tokens.accessToken, data.tokens.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      // Se libera en el siguiente tick para que las peticiones en espera vean
      // ya los tokens nuevos.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Uso interno para evitar bucles de renovacion. */
  _retried?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(API + path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.pathname + url.search;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const access = tokens.access;
  if (access) headers.authorization = 'Bearer ' + access;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (res.status === 401 && !options._retried && tokens.refresh) {
    const renewed = await refreshTokens();
    if (renewed) return apiRequest<T>(path, { ...options, _retried: true });
    notifySessionExpired();
  }

  if (!res.ok) {
    let payload: { error?: { code?: string; message?: string; details?: unknown; meta?: Record<string, unknown>; requestId?: string } } = {};
    try {
      payload = await res.json();
    } catch {
      // respuesta sin cuerpo JSON
    }
    const err = payload.error;
    if (res.status === 401) notifySessionExpired();
    throw new ApiError(
      err?.code ?? 'ERROR_INTERNO',
      err?.message ?? 'No se pudo completar la solicitud (' + res.status + ').',
      res.status,
      err?.details,
      err?.meta,
      err?.requestId,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Descarga un archivo binario (reportes) respetando el nombre que envia el servidor. */
export async function apiDownload(path: string, query?: RequestOptions['query']): Promise<void> {
  const access = tokens.access;
  const res = await fetch(buildUrl(path, query), {
    headers: access ? { authorization: 'Bearer ' + access } : {},
  });

  if (res.status === 401 && tokens.refresh) {
    if (await refreshTokens()) return apiDownload(path, query);
    notifySessionExpired();
  }

  if (!res.ok) {
    let message = 'No se pudo generar el archivo.';
    try {
      const payload = await res.json();
      message = payload?.error?.message ?? message;
    } catch {
      // sin cuerpo JSON
    }
    throw new ApiError('ERROR_INTERNO', message, res.status);
  }

  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? 'reporte';

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** URL absoluta de un recurso firmado (imagenes de evidencia). */
export function resourceUrl(signedPath: string): string {
  return BASE_URL + signedPath;
}

export const api = {
  get: <T,>(path: string, query?: RequestOptions['query']) => apiRequest<T>(path, { query }),
  post: <T,>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T,>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T,>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: <T,>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'DELETE', body }),
};

export { API as API_BASE };
