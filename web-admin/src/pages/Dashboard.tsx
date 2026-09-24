/**
 * Tablero global.
 *
 * Muestra la foto del dia en todas las sedes. Las cifras provienen solo de
 * marcaciones validas; los intentos rechazados se cuentan aparte, en "Alertas",
 * para que nunca inflen los indicadores de asistencia.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fechaLarga, hoyISO, desdeAhora, numero } from '../lib/format';
import {
  Card,
  PageHeader,
  Metric,
  Table,
  Th,
  Td,
  Loading,
  ErrorMessage,
  EmptyState,
  Input,
  Badge,
  SeveridadBadge,
} from '../components/ui';
import type { Tablero, EventoSeguridad, Pagina } from '../lib/types';
import { ETIQUETA_EVENTO } from '../lib/format';

export function Dashboard() {
  const [fecha, setFecha] = useState(hoyISO());

  const tablero = useQuery({
    queryKey: ['tablero', fecha],
    queryFn: () => api.get<Tablero>('/asistencia/tablero', { date: fecha }),
    refetchInterval: 60_000,
  });

  const alertas = useQuery({
    queryKey: ['seguridad', 'pendientes', fecha],
    queryFn: () =>
      api.get<Pagina<EventoSeguridad> & { pending: number }>('/seguridad/eventos', {
        from: fecha,
        to: fecha,
        onlyPending: true,
        pageSize: 8,
      }),
    refetchInterval: 60_000,
  });

  return (
    <>
      <PageHeader
        title="Tablero general"
        description={fechaLarga(fecha)}
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="fecha" className="text-sm text-slate-600">
              Fecha
            </label>
            <Input
              id="fecha"
              type="date"
              value={fecha}
              max={hoyISO()}
              onChange={(e) => setFecha(e.target.value)}
              className="w-auto"
            />
          </div>
        }
      />

      {tablero.isLoading && <Loading />}
      {tablero.isError && <ErrorMessage error={tablero.error} onRetry={() => void tablero.refetch()} />}

      {tablero.data && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Practicantes" value={numero(tablero.data.totals.total)} hint="activos" />
            <Metric label="Presentes" value={numero(tablero.data.totals.presentes)} tono="exito" />
            <Metric label="Puntuales" value={numero(tablero.data.totals.puntuales)} tono="exito" />
            <Metric label="Tardanzas" value={numero(tablero.data.totals.tardanzas)} tono="aviso" />
            <Metric label="Faltas" value={numero(tablero.data.totals.ausentes)} tono="peligro" />
            <Metric label="Alertas" value={numero(tablero.data.totals.alertas)} tono="peligro" hint="sin atender" />
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Salidas registradas" value={numero(tablero.data.totals.salidas)} />
            <Metric label="Todavía dentro" value={numero(tablero.data.totals.todaviaDentro)} tono="info" />
            <Metric
              label="Salidas pendientes"
              value={numero(tablero.data.totals.salidasPendientes)}
              tono={tablero.data.totals.salidasPendientes > 0 ? 'aviso' : 'neutro'}
            />
            <Metric label="Sin jornada hoy" value={numero(tablero.data.totals.sinJornada)} />
          </div>

          <Card
            title="Detalle por sede"
            subtitle={tablero.data.sites.length + ' sede(s) activa(s)'}
            className="mb-6"
          >
            {tablero.data.sites.length === 0 ? (
              <EmptyState
                titulo="No hay sedes activas"
                descripcion="Registre al menos una sede para empezar a controlar la asistencia."
                accion={
                  <Link to="/sedes" className="text-sm font-medium text-marca-700 underline">
                    Ir a sedes
                  </Link>
                }
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Sede</Th>
                    <Th align="right">Total</Th>
                    <Th align="right">Presentes</Th>
                    <Th align="right">Puntuales</Th>
                    <Th align="right">Tardanzas</Th>
                    <Th align="right">Faltas</Th>
                    <Th align="right">Salidas</Th>
                    <Th align="right">Dentro</Th>
                    <Th align="right">Pendientes</Th>
                    <Th align="right">Alertas</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tablero.data.sites.map((s) => (
                    <tr key={s.siteId} className="hover:bg-slate-50">
                      <Td>
                        <Link to={'/sedes/' + s.siteId} className="font-medium text-marca-700 hover:underline">
                          {s.siteName}
                        </Link>
                        <span className="ml-2 text-xs text-slate-400">{s.siteCode}</span>
                      </Td>
                      <Td align="right">{numero(s.total)}</Td>
                      <Td align="right" className="font-medium text-emerald-700">
                        {numero(s.presentes)}
                      </Td>
                      <Td align="right">{numero(s.puntuales)}</Td>
                      <Td align="right" className={s.tardanzas > 0 ? 'font-medium text-amber-700' : ''}>
                        {numero(s.tardanzas)}
                      </Td>
                      <Td align="right" className={s.ausentes > 0 ? 'font-medium text-rose-700' : ''}>
                        {numero(s.ausentes)}
                      </Td>
                      <Td align="right">{numero(s.salidas)}</Td>
                      <Td align="right">{numero(s.todaviaDentro)}</Td>
                      <Td align="right" className={s.salidasPendientes > 0 ? 'font-medium text-amber-700' : ''}>
                        {numero(s.salidasPendientes)}
                      </Td>
                      <Td align="right">
                        {s.alertas > 0 ? <Badge tono="peligro">{s.alertas}</Badge> : <span className="text-slate-400">0</span>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}

      <Card
        title="Alertas sin atender"
        subtitle="Intentos rechazados e incidentes del día"
        actions={
          <Link to="/seguridad" className="text-sm font-medium text-marca-700 hover:underline">
            Ver todas
          </Link>
        }
      >
        {alertas.isLoading && <Loading />}
        {alertas.data && alertas.data.items.length === 0 && (
          <EmptyState titulo="Sin alertas pendientes" descripcion="No se registraron incidentes en la fecha seleccionada." />
        )}
        {alertas.data && alertas.data.items.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {alertas.data.items.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeveridadBadge valor={e.severity} />
                    <span className="text-sm font-medium text-slate-800">
                      {ETIQUETA_EVENTO[e.type] ?? e.type}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{e.message}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {e.intern ? e.intern.lastNames + ', ' + e.intern.firstNames : 'Usuario no identificado'}
                    {e.site ? ' · ' + e.site.name : ''} · {desdeAhora(e.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
