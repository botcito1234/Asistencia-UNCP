/**
 * Consulta de asistencia con filtros por fecha, sede y estado.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { hoyISO, sumarDias, fechaCorta, numero, duracionMinutos, metros } from '../lib/format';
import {
  Card,
  PageHeader,
  Table,
  Th,
  Td,
  Loading,
  ErrorMessage,
  EmptyState,
  Input,
  Select,
  Field,
  Button,
  EstadoBadge,
  PuntualidadBadge,
  Badge,
} from '../components/ui';
import type { Jornada, Pagina, Sede } from '../lib/types';

export function Attendance() {
  const [filtros, setFiltros] = useState({
    from: sumarDias(hoyISO(), -7),
    to: hoyISO(),
    siteId: '',
    status: '',
    punctuality: '',
    pendingExitOnly: false,
  });
  const [pagina, setPagina] = useState(1);

  const sedes = useQuery({ queryKey: ['sedes'], queryFn: () => api.get<Sede[]>('/sedes') });

  const jornadas = useQuery({
    queryKey: ['asistencia', filtros, pagina],
    queryFn: () =>
      api.get<Pagina<Jornada>>('/asistencia', {
        from: filtros.from,
        to: filtros.to,
        siteId: filtros.siteId || undefined,
        status: filtros.status || undefined,
        punctuality: filtros.punctuality || undefined,
        pendingExitOnly: filtros.pendingExitOnly ? 'true' : undefined,
        page: pagina,
        pageSize: 50,
      }),
  });

  const actualizar = (cambios: Partial<typeof filtros>) => {
    setFiltros((f) => ({ ...f, ...cambios }));
    setPagina(1);
  };

  const totalPaginas = jornadas.data ? Math.max(1, Math.ceil(jornadas.data.total / jornadas.data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Asistencia" description="Historial de jornadas registradas" />

      <Card className="mb-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Desde" htmlFor="desde">
            <Input id="desde" type="date" value={filtros.from} max={filtros.to} onChange={(e) => actualizar({ from: e.target.value })} />
          </Field>
          <Field label="Hasta" htmlFor="hasta">
            <Input id="hasta" type="date" value={filtros.to} min={filtros.from} max={hoyISO()} onChange={(e) => actualizar({ to: e.target.value })} />
          </Field>
          <Field label="Sede" htmlFor="sede">
            <Select id="sede" value={filtros.siteId} onChange={(e) => actualizar({ siteId: e.target.value })}>
              <option value="">Todas</option>
              {(sedes.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estado" htmlFor="estado">
            <Select id="estado" value={filtros.status} onChange={(e) => actualizar({ status: e.target.value })}>
              <option value="">Todos</option>
              <option value="PRESENTE">Presente</option>
              <option value="AUSENTE">Falta</option>
              <option value="NO_LABORABLE">Sin jornada</option>
            </Select>
          </Field>
          <Field label="Puntualidad" htmlFor="puntualidad">
            <Select id="puntualidad" value={filtros.punctuality} onChange={(e) => actualizar({ punctuality: e.target.value })}>
              <option value="">Todas</option>
              <option value="PUNTUAL">Puntual</option>
              <option value="TARDANZA">Tardanza</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-marca-700 focus:ring-marca-500"
                checked={filtros.pendingExitOnly}
                onChange={(e) => actualizar({ pendingExitOnly: e.target.checked })}
              />
              Solo salidas pendientes
            </label>
          </div>
        </div>
      </Card>

      <Card
        title={jornadas.data ? numero(jornadas.data.total) + ' jornada(s)' : 'Resultados'}
        subtitle={fechaCorta(filtros.from) + ' al ' + fechaCorta(filtros.to)}
      >
        {jornadas.isLoading && <Loading />}
        {jornadas.isError && <ErrorMessage error={jornadas.error} onRetry={() => void jornadas.refetch()} />}

        {jornadas.data && jornadas.data.items.length === 0 && (
          <EmptyState titulo="Sin registros" descripcion="Ajuste los filtros o amplie el rango de fechas." />
        )}

        {jornadas.data && jornadas.data.items.length > 0 && (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Practicante</Th>
                  <Th>Sede</Th>
                  <Th align="center">Programada</Th>
                  <Th align="center">Entrada</Th>
                  <Th align="center">Salida</Th>
                  <Th align="center">Estado</Th>
                  <Th align="center">Puntualidad</Th>
                  <Th align="right">Tardanza</Th>
                  <Th align="right">Permanencia</Th>
                  <Th align="right">Dist.</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jornadas.data.items.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50">
                    <Td>{fechaCorta(j.businessDate)}</Td>
                    <Td>
                      <Link to={'/practicantes/' + j.intern.id} className="font-medium text-marca-700 hover:underline">
                        {j.intern.fullName}
                      </Link>
                      <span className="ml-2 text-xs text-slate-400">{j.intern.dni}</span>
                    </Td>
                    <Td>{j.site.name}</Td>
                    <Td align="center" className="tabular-nums">{j.scheduledStartTime ?? '—'}</Td>
                    <Td align="center" className="tabular-nums font-medium">{j.checkIn?.localTime ?? '—'}</Td>
                    <Td align="center" className="tabular-nums">
                      {j.checkOut?.localTime ?? (j.pendingExit ? <Badge tono="aviso">Pendiente</Badge> : '—')}
                    </Td>
                    <Td align="center">
                      <EstadoBadge estado={j.status} />
                    </Td>
                    <Td align="center">
                      <PuntualidadBadge valor={j.punctuality} />
                    </Td>
                    <Td align="right" className="tabular-nums">{j.lateMinutes > 0 ? j.lateMinutes + ' min' : '—'}</Td>
                    <Td align="right" className="tabular-nums">{duracionMinutos(j.workedMinutes)}</Td>
                    <Td align="right" className="tabular-nums">{j.checkIn ? metros(j.checkIn.distanceMeters) : '—'}</Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-2">
                        {j.regularized && <Badge tono="info">Regularizada</Badge>}
                        <Link to={'/asistencia/' + j.id} className="text-sm font-medium text-marca-700 hover:underline">
                          Ver
                        </Link>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {totalPaginas > 1 && (
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                <p className="text-sm text-slate-500">
                  Pagina {jornadas.data.page} de {totalPaginas}
                </p>
                <div className="flex gap-2">
                  <Button variante="secundario" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                    Anterior
                  </Button>
                  <Button variante="secundario" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
                    Siguiente
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
