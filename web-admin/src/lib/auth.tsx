/**
 * Estado de sesion del panel.
 *
 * El panel es exclusivo de administradores: si entra un practicante, se le
 * informa y se cierra la sesion. Su interfaz es la aplicacion movil.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokens, onSessionExpired, ApiError } from './api';
import { fijarZonaInstitucion } from './format';
import type { Usuario } from './types';

interface AuthState {
  user: Usuario | null;
  cargando: boolean;
  entrar: (dni: string, password: string) => Promise<void>;
  salir: () => Promise<void>;
  recargar: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    // La zona horaria de la institucion se pide ANTES de dar por cargado el
    // panel: las pantallas fijan su rango de fechas en el primer render, y si
    // llegara despues se quedarian con el dia del navegador.
    try {
      const salud = await api.get<{ zonaHoraria?: string }>('/salud');
      fijarZonaInstitucion(salud.zonaHoraria ?? null);
    } catch {
      // Sin servidor no hay nada que mostrar igual; se sigue con la zona local.
    }

    if (!tokens.access) {
      setUser(null);
      setCargando(false);
      return;
    }
    try {
      const res = await api.get<{ user: Usuario }>('/auth/me');
      setUser(res.user);
    } catch {
      setUser(null);
      tokens.clear();
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  useEffect(() => onSessionExpired(() => setUser(null)), []);

  const entrar = useCallback(async (dni: string, password: string) => {
    const res = await api.post<{
      user: Usuario;
      tokens: { accessToken: string; refreshToken: string };
    }>('/auth/login', { dni, password });

    if (res.user.role !== 'ADMINISTRADOR') {
      throw new ApiError(
        'PROHIBIDO',
        'Este panel es solo para administradores. Los practicantes registran su asistencia desde la aplicación móvil.',
        403,
      );
    }

    tokens.set(res.tokens.accessToken, res.tokens.refreshToken);
    setUser(res.user);
  }, []);

  const salir = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // aunque falle, la sesion local se limpia
    }
    tokens.clear();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, cargando, entrar, salir, recargar }),
    [user, cargando, entrar, salir, recargar],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return ctx;
}
