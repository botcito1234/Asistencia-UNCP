/**
 * Panel de una sede concreta: indicadores del dia, mapa de la geocerca y
 * detalle de sus practicantes.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fechaLarga, hoyISO, numero, metros } from '../lib/format';
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
  EstadoBadge,
  PuntualidadBadge,
} from '../components/ui';
import { MapView } from '../components/MapView';
import type { Jornada, Pagina, Sede, TableroSede } from '../lib/types';

export function SiteBoard() {
  const { siteId = '' } = useParams();
  const [fecha, setFecha] = useState(hoyISO());

  const tablero = useQuery({
    queryKey: ['tablero', 'sede', siteId, fecha],
    queryFn: () =>
      api.get<{ site: Sede; date: string; board: TableroSede | null }>('/sedes/' + siteId + '/tablero', { date: fecha }),
    enabled: Boolean(siteId),
    refetchInterval: 60_000,
  });

  const jornadas = useQuery({
    queryKey: ['asistencia', 'sede', siteId, fecha],
    queryFn: () => api.get<Pagina<Jornada>>('/asistencia', { from: fecha, to: fecha, siteId, pageSize: 200 }),
    enabled: Boolean(siteId),
  });

  const sede = tablero.data?.site;
  const board = tablero.data?.board;

  const puntos = (jornadas.data?.items ?? [])
    .flatMap((j) => [
      j.checkIn ? { m: j.checkIn, etiqueta: 'Entrada · ' + j.intern.fullName } : null,
      j.checkOut ? { m: j.checkOut, etiqueta: 'Salida · ' + j.intern.fullName } : null,
    ])
    .filter((x): x is { m: NonNullable<Jornada['checkIn']>; etiqueta: string } => x !== null)
    .map((x) => ({
      latitude: x.m.latitude,
      longitude: x.m.longitude,
      accuracyMeters: x.m.accuracyMeters,
      distanceMeters: x.m.distanceMeters,
      etiqueta: x.etiqueta,
      hora: x.m.localTime,
    }));

  return (
    <>
      <PageHeader
        title={sede?.name ?? 'Panel de sede'}
        description={sede ? sede.address + ' · ' + fechaLarga(fecha) : undefined}
        actions={
          <div className="flex items-center gap-3">
            <Link to="/sedes" className="text-sm font-medium text-marca-700 hover:underline">
              Volver
            </Link>
            <Input type="date" value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value)} className="w-auto" />
          </div>
        }
      />

      {tablero.isLoading && <Loading />}
      {tablero.isError && <ErrorMessage error={tablero.error} onRetry={() => void tablero.refetch()} />}

      {board && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Metric label="Total" value={numero(board.total)} hint="practicantes activos" />
          <Metric label="Presentes" value={numero(board.presentes)} tono="exito" />
          <Metric label="Puntuales" value={numero(board.puntuales)} tono="exito" />
          <Metric label="Tardanzas" value={numero(board.tardanzas)} tono="aviso" />
          <Metric label="Faltas" value={numero(board.ausentes)} tono="peligro" />
          <Metric label="Salidas" value={numero(board.salidas)} />
          <Metric label="Todavía dentro" value={numero(board.todaviaDentro)} tono="info" />
          <Metric
            label="Salidas pendientes"
            value={numero(board.salidasPendientes)}
            tono={board.salidasPendientes > 0 ? 'aviso' : 'neutro'}
          />
          <Metric label="Sin jornada" value={numero(board.sinJornada)} />
          <Metric label="Alertas" value={numero(board.alertas)} tono={board.alertas > 0 ? 'peligro' : 'neutro'} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {sede && (
          <Card title="Geocerca y marcaciones del día" subtitle={'Radio permitido: ' + sede.radiusMeters + ' m'}>
            <MapView
              sede={{
                latitude: sede.latitude,
                longitude: sede.longitude,
                radiusMeters: sede.radiusMeters,
                nombre: sede.name,
              }}
              puntos={puntos}
              alto={420}
            />
          </Card>
        )}

        <Card title="Practicantes" subtitle={numero(jornadas.data?.total ?? 0) + ' jornada(s) registrada(s)'}>
          {jornadas.isLoading && <Loading />}
          {jornadas.data && jornadas.data.items.length === 0 && (
            <EmptyState titulo="Sin jornadas" descripcion="No hay registros para la fecha seleccionada." />
          )}
          {jornadas.data && jornadas.data.items.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>Practicante</Th>
                  <Th align="center">Prog.</Th>
                  <Th align="center">Entrada</Th>
                  <Th align="center">Salida</Th>
                  <Th align="center">Estado</Th>
                  <Th align="center">Punt.</Th>
                  <Th align="right">Dist.</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jornadas.data.items.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50">
                    <Td>
                      <Link to={'/asistencia/' + j.id} className="font-medium text-marca-700 hover:underline">
                        {j.intern.fullName}
                      </Link>
                      {j.intern.areaGroup && <span className="ml-2 text-xs text-slate-400">{j.intern.areaGroup}</span>}
                    </Td>
                    <Td align="center" className="tabular-nums">{j.scheduledStartTime ?? '—'}</Td>
                    <Td align="center" className="tabular-nums font-medium">{j.checkIn?.localTime ?? '—'}</Td>
                    <Td align="center" className="tabular-nums">
                      {j.checkOut?.localTime ?? (j.pendingExit ? <Badge tono="aviso">Pend.</Badge> : '—')}
                    </Td>
                    <Td align="center"><EstadoBadge estado={j.status} /></Td>
                    <Td align="center"><PuntualidadBadge valor={j.punctuality} /></Td>
                    <Td align="right" className="tabular-nums">{j.checkIn ? metros(j.checkIn.distanceMeters) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
