/**
 * Marco del panel: navegacion lateral, cabecera con campana de notificaciones y
 * estado del canal en tiempo real.
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRealtime } from '../lib/realtime';
import { Badge, Button } from './ui';
import { desdeAhora } from '../lib/format';
import type { Notificacion, Pagina } from '../lib/types';

const NAVEGACION = [
  { to: '/', label: 'Tablero', exact: true },
  { to: '/asistencia', label: 'Asistencia' },
  { to: '/practicantes', label: 'Practicantes' },
  { to: '/sedes', label: 'Sedes' },
  { to: '/seguridad', label: 'Alertas' },
  { to: '/reportes', label: 'Reportes' },
  { to: '/archivado', label: 'Archivado' },
  { to: '/auditoria', label: 'Auditoría' },
  { to: '/parametros', label: 'Parámetros' },
];

export function Layout() {
  const { user, salir } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [menuMovil, setMenuMovil] = useState(false);

  const notificaciones = useQuery({
    queryKey: ['notificaciones'],
    queryFn: () => api.get<Pagina<Notificacion> & { unread: number }>('/notificaciones', { pageSize: 30 }),
    refetchInterval: 120_000,
  });

  const { conectado } = useRealtime((evento) => {
    // Cualquier novedad invalida lo que este en pantalla; TanStack Query se
    // encarga de refrescar solo lo visible.
    if (evento === 'notificacion') void queryClient.invalidateQueries({ queryKey: ['notificaciones'] });
    void queryClient.invalidateQueries({ queryKey: ['tablero'] });
    void queryClient.invalidateQueries({ queryKey: ['asistencia'] });
    if (evento === 'evento-seguridad') void queryClient.invalidateQueries({ queryKey: ['seguridad'] });
  }, true);

  const marcarTodas = useMutation({
    mutationFn: () => api.post('/notificaciones/leer-todas'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notificaciones'] }),
  });

  const sinLeer = notificaciones.data?.unread ?? 0;

  useEffect(() => {
    document.title = sinLeer > 0 ? '(' + sinLeer + ') Control de Asistencia' : 'Control de Asistencia';
  }, [sinLeer]);

  const cerrarSesion = async () => {
    await salir();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Cabecera */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
          <button
            type="button"
            className="rounded p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
            onClick={() => setMenuMovil((v) => !v)}
            aria-label="Abrir menú"
          >
            ☰
          </button>

          <div className="flex min-w-0 items-center gap-2.5">
            <img
              src="/marca/uncp-escudo.png"
              alt="Universidad Nacional del Centro del Perú"
              className="h-8 w-auto shrink-0"
              width={37}
              height={32}
            />
            <span className="hidden min-w-0 flex-col leading-tight sm:flex">
              <span className="truncate text-sm font-semibold text-slate-800">Control de Asistencia</span>
              <span className="truncate text-[11px] text-slate-500">Universidad Nacional del Centro del Perú</span>
            </span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span
              title={conectado ? 'Recibiendo novedades en tiempo real' : 'Sin conexión en tiempo real; se refresca cada 2 minutos'}
              className="hidden items-center gap-1.5 text-xs text-slate-500 sm:flex"
            >
              <span className={'h-2 w-2 rounded-full ' + (conectado ? 'bg-emerald-500' : 'bg-slate-300')} />
              {conectado ? 'En vivo' : 'Sin conexión en vivo'}
            </span>

            <div className="relative">
              <button
                type="button"
                onClick={() => setPanelAbierto((v) => !v)}
                className="relative rounded p-2 text-slate-500 hover:bg-slate-100"
                aria-label={'Notificaciones' + (sinLeer > 0 ? ' (' + sinLeer + ' sin leer)' : '')}
              >
                🔔
                {sinLeer > 0 && (
                  <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                    {sinLeer > 99 ? '99+' : sinLeer}
                  </span>
                )}
              </button>

              {panelAbierto && (
                <div className="absolute right-0 mt-2 w-96 rounded-xl border border-slate-200 bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <h3 className="text-sm font-semibold text-slate-800">Notificaciones</h3>
                    {sinLeer > 0 && (
                      <button
                        type="button"
                        onClick={() => marcarTodas.mutate()}
                        className="text-xs font-medium text-marca-700 hover:underline"
                      >
                        Marcar todas como leídas
                      </button>
                    )}
                  </div>
                  <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                    {(notificaciones.data?.items ?? []).map((n) => (
                      <li key={n.id} className={'px-4 py-3 ' + (n.readAt ? 'opacity-60' : 'bg-marca-50/40')}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-slate-800">{n.title}</p>
                          {n.severity === 'CRITICO' && <Badge tono="peligro">Crítico</Badge>}
                          {n.severity === 'ADVERTENCIA' && <Badge tono="aviso">Aviso</Badge>}
                        </div>
                        <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>
                        <p className="mt-1 text-xs text-slate-400">{desdeAhora(n.createdAt)}</p>
                      </li>
                    ))}
                    {(notificaciones.data?.items.length ?? 0) === 0 && (
                      <li className="px-4 py-8 text-center text-sm text-slate-500">Sin notificaciones.</li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight text-slate-800">{user?.displayName}</p>
              <p className="text-xs leading-tight text-slate-500">DNI {user?.dni}</p>
            </div>

            <Button variante="secundario" onClick={() => void cerrarSesion()}>
              Salir
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px]">
        {/* Navegacion lateral */}
        <nav
          className={
            'w-56 shrink-0 border-r border-slate-200 bg-white p-3 lg:block ' +
            (menuMovil ? 'fixed inset-y-14 left-0 z-20 block overflow-y-auto' : 'hidden')
          }
        >
          <ul className="space-y-1">
            {NAVEGACION.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.exact}
                  onClick={() => setMenuMovil(false)}
                  className={({ isActive }) =>
                    'block rounded-lg px-3 py-2 text-sm font-medium transition ' +
                    (isActive ? 'bg-marca-700 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 p-4 lg:p-6" onClick={() => setPanelAbierto(false)}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
