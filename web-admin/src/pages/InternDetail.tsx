/**
 * Ficha del practicante: datos, horario vigente, dispositivo vinculado,
 * indicadores del periodo, historial de asistencia y alertas.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  fechaCorta,
  fechaHora,
  desdeAhora,
  hoyISO,
  sumarDias,
  numero,
  porcentaje,
  duracionMinutos,
  DIAS_SEMANA,
  ETIQUETA_EVENTO,
} from '../lib/format';
import {
  Card,
  PageHeader,
  Metric,
  Table,
  Th,
  Td,
  Loading,
  ErrorMessage,
  Button,
  Badge,
  Modal,
  Field,
  Input,
  Textarea,
  Select,
  EstadoBadge,
  PuntualidadBadge,
  SeveridadBadge,
  EmptyState,
  useToast,
} from '../components/ui';
import type { Jornada, PracticanteDetalle, ResumenPracticante, Sede } from '../lib/types';

interface FichaRespuesta {
  intern: PracticanteDetalle;
  summary: ResumenPracticante;
  attendance: Jornada[];
  securityEvents: {
    id: string;
    type: string;
    severity: 'INFO' | 'ADVERTENCIA' | 'CRITICO';
    message: string;
    createdAt: string;
    acknowledged: boolean;
  }[];
}

export function InternDetail() {
  const { internId = '' } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [rango, setRango] = useState({ from: sumarDias(hoyISO(), -30), to: hoyISO() });
  const [modal, setModal] = useState<'horario' | 'editar' | 'dispositivo' | 'password' | null>(null);

  const ficha = useQuery({
    queryKey: ['practicante', internId, rango],
    queryFn: () => api.get<FichaRespuesta>('/practicantes/' + internId + '/ficha', rango),
    enabled: Boolean(internId),
  });

  const sedes = useQuery({ queryKey: ['sedes'], queryFn: () => api.get<Sede[]>('/sedes') });

  const datos = ficha.data;
  const p = datos?.intern;
  const resumen = datos?.summary;

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: ['practicante', internId] });
    void queryClient.invalidateQueries({ queryKey: ['practicantes'] });
  };

  return (
    <>
      {toast.Toast}

      <PageHeader
        title={p?.fullName ?? 'Ficha del practicante'}
        description={p ? 'DNI ' + p.dni + ' · ' + p.site.name + (p.areaGroup ? ' · ' + p.areaGroup : '') : undefined}
        actions={
          <>
            <Link to="/practicantes" className="text-sm font-medium text-marca-700 hover:underline">
              Volver
            </Link>
            {p && (
              <>
                <Button variante="secundario" onClick={() => setModal('editar')}>
                  Editar
                </Button>
                <Button variante="secundario" onClick={() => setModal('horario')}>
                  Horario
                </Button>
                <Button variante="secundario" onClick={() => setModal('password')}>
                  Restablecer contraseña
                </Button>
              </>
            )}
          </>
        }
      />

      {ficha.isLoading && <Loading />}
      {ficha.isError && <ErrorMessage error={ficha.error} onRetry={() => void ficha.refetch()} />}

      {p && resumen && datos && (
        <div className="space-y-5">
          {!p.active && (
            <div className="rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-700">
              Este practicante esta inactivo. No puede iniciar sesión ni registrar asistencia.
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Periodo desde" htmlFor="desde">
              <Input id="desde" type="date" value={rango.from} max={rango.to} onChange={(e) => setRango({ ...rango, from: e.target.value })} />
            </Field>
            <Field label="Hasta" htmlFor="hasta">
              <Input id="hasta" type="date" value={rango.to} min={rango.from} max={hoyISO()} onChange={(e) => setRango({ ...rango, to: e.target.value })} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <Metric label="Jornadas" value={numero(resumen.jornadasProgramadas)} />
            <Metric label="Presentes" value={numero(resumen.presentes)} tono="exito" />
            <Metric label="Puntuales" value={numero(resumen.puntuales)} tono="exito" />
            <Metric label="Tardanzas" value={numero(resumen.tardanzas)} tono="aviso" hint={duracionMinutos(resumen.minutosTardanzaTotal)} />
            <Metric label="Faltas" value={numero(resumen.ausentes)} tono="peligro" />
            <Metric label="Sal. pendientes" value={numero(resumen.salidasPendientes)} tono={resumen.salidasPendientes > 0 ? 'aviso' : 'neutro'} />
            <Metric label="Puntualidad" value={porcentaje(resumen.porcentajePuntualidad)} tono="info" />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Datos" className="lg:col-span-1">
              <dl className="space-y-2 text-sm">
                <Dato label="DNI" valor={p.dni} />
                <Dato label="Nombres" valor={p.firstNames} />
                <Dato label="Apellidos" valor={p.lastNames} />
                <Dato label="Sede" valor={p.site.name} />
                <Dato label="Área / grupo" valor={p.areaGroup ?? '—'} />
                <Dato label="Teléfono" valor={p.phone ?? '—'} />
                <Dato label="Correo" valor={p.email ?? '—'} />
                <Dato label="Estado" valor={p.active ? 'Activo' : 'Inactivo'} />
                <Dato label="Último acceso" valor={p.lastLoginAt ? desdeAhora(p.lastLoginAt) : 'Nunca'} />
                <Dato
                  label="Consentimiento"
                  valor={
                    p.consent.accepted
                      ? 'Aceptado ' + fechaCorta(p.consent.acceptedAt) + ' (v' + p.consent.policyVersion + ')'
                      : 'Pendiente'
                  }
                />
                {p.lockedUntil && <Dato label="Bloqueada hasta" valor={fechaHora(p.lockedUntil)} />}
              </dl>
            </Card>

            <Card title="Horario vigente" className="lg:col-span-1">
              <ul className="space-y-1.5 text-sm">
                {p.schedule.map((f) => (
                  <li key={f.weekday} className="flex items-center justify-between">
                    <span className="text-slate-600">{DIAS_SEMANA[f.weekday - 1]}</span>
                    {f.startTime ? (
                      <span className="tabular-nums font-medium text-slate-800">
                        {f.startTime}
                        {f.endTime ? ' – ' + f.endTime : ''}
                      </span>
                    ) : (
                      <span className="text-slate-400">Sin jornada</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                Puede marcar desde 15 minutos antes de la hora de entrada. Después de la hora se registra tardanza.
              </p>
            </Card>

            <Card
              title="Dispositivo vinculado"
              className="lg:col-span-1"
              actions={
                <Button variante="secundario" onClick={() => setModal('dispositivo')}>
                  Gestionar
                </Button>
              }
            >
              {p.device ? (
                <dl className="space-y-2 text-sm">
                  <Dato label="Modelo" valor={p.device.model ?? 'No informado'} />
                  <Dato label="Plataforma" valor={p.device.platform} />
                  <Dato label="Sistema" valor={p.device.osVersion ?? '—'} />
                  <Dato label="Versión de la app" valor={p.device.appVersion ?? '—'} />
                  <Dato label="Vinculado" valor={fechaHora(p.device.boundAt)} />
                  <Dato label="Último uso" valor={desdeAhora(p.device.lastSeenAt)} />
                </dl>
              ) : (
                <div className="py-4 text-center">
                  <Badge tono="neutro">Sin dispositivo vinculado</Badge>
                  <p className="mt-2 text-sm text-slate-500">
                    Se vinculara automáticamente en el primer inicio de sesión desde la aplicación.
                  </p>
                </div>
              )}
            </Card>
          </div>

          <Card title="Historial de asistencia" subtitle={fechaCorta(rango.from) + ' al ' + fechaCorta(rango.to)}>
            {datos.attendance.length === 0 ? (
              <EmptyState titulo="Sin jornadas en el periodo" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Fecha</Th>
                    <Th align="center">Programada</Th>
                    <Th align="center">Entrada</Th>
                    <Th align="center">Salida</Th>
                    <Th align="center">Estado</Th>
                    <Th align="center">Puntualidad</Th>
                    <Th align="right">Tardanza</Th>
                    <Th align="right">Permanencia</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {datos.attendance.map((j) => (
                    <tr key={j.id} className="hover:bg-slate-50">
                      <Td>{fechaCorta(j.businessDate)}</Td>
                      <Td align="center" className="tabular-nums">{j.scheduledStartTime ?? '—'}</Td>
                      <Td align="center" className="tabular-nums font-medium">{j.checkIn?.localTime ?? '—'}</Td>
                      <Td align="center" className="tabular-nums">
                        {j.checkOut?.localTime ?? (j.pendingExit ? <Badge tono="aviso">Pendiente</Badge> : '—')}
                      </Td>
                      <Td align="center"><EstadoBadge estado={j.status} /></Td>
                      <Td align="center"><PuntualidadBadge valor={j.punctuality} /></Td>
                      <Td align="right" className="tabular-nums">{j.lateMinutes > 0 ? j.lateMinutes + ' min' : '—'}</Td>
                      <Td align="right" className="tabular-nums">{duracionMinutos(j.workedMinutes)}</Td>
                      <Td align="right">
                        <Link to={'/asistencia/' + j.id} className="text-sm font-medium text-marca-700 hover:underline">
                          Ver
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title="Alertas e incidencias" subtitle={datos.securityEvents.length + ' evento(s) en el periodo'}>
            {datos.securityEvents.length === 0 ? (
              <EmptyState titulo="Sin incidencias" descripcion="No se registraron eventos de seguridad para este practicante." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {datos.securityEvents.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-4 py-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <SeveridadBadge valor={e.severity} />
                        <span className="text-sm font-medium text-slate-800">{ETIQUETA_EVENTO[e.type] ?? e.type}</span>
                        {e.acknowledged && <Badge tono="neutro">Atendido</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{e.message}</p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{fechaHora(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {p && (
        <>
          <ModalHorario
            abierto={modal === 'horario'}
            onCerrar={() => setModal(null)}
            internId={p.id}
            actual={p.schedule}
            onExito={(m) => {
              toast.exito(m);
              setModal(null);
              invalidar();
            }}
          />
          <ModalEditar
            abierto={modal === 'editar'}
            onCerrar={() => setModal(null)}
            practicante={p}
            sedes={sedes.data ?? []}
            onExito={(m) => {
              toast.exito(m);
              setModal(null);
              invalidar();
            }}
          />
          <ModalDispositivo
            abierto={modal === 'dispositivo'}
            onCerrar={() => setModal(null)}
            internId={p.id}
            tieneDispositivo={Boolean(p.device)}
            onExito={(m) => {
              toast.exito(m);
              setModal(null);
              invalidar();
            }}
          />
          <ModalPassword
            abierto={modal === 'password'}
            onCerrar={() => setModal(null)}
            internId={p.id}
          />
        </>
      )}
    </>
  );
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800">{valor}</dd>
    </div>
  );
}

function ModalHorario({
  abierto,
  onCerrar,
  internId,
  actual,
  onExito,
}: {
  abierto: boolean;
  onCerrar: () => void;
  internId: string;
  actual: PracticanteDetalle['schedule'];
  onExito: (mensaje: string) => void;
}) {
  const [efectivoDesde, setEfectivoDesde] = useState(hoyISO());
  const [franjas, setFranjas] = useState(
    actual.map((f) => ({
      activo: Boolean(f.startTime),
      startTime: f.startTime ?? '08:00',
      endTime: f.endTime ?? '17:00',
    })),
  );
  const [error, setError] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: () =>
      api.put('/practicantes/' + internId + '/horario', {
        effectiveFrom: efectivoDesde,
        slots: franjas
          .map((f, i) => ({ ...f, weekday: i + 1 }))
          .filter((f) => f.activo)
          .map((f) => ({ weekday: f.weekday, startTime: f.startTime, endTime: f.endTime || null })),
      }),
    onSuccess: () => onExito('Horario actualizado. El anterior quedó registrado en el historial.'),
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo guardar el horario.'),
  });

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Horario semanal">
      <div className="space-y-4">
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          El horario anterior no se borra: se cierra su vigencia y queda disponible para consultar la asistencia
          historica con las reglas que realmente regian entonces.
        </div>

        <Field label="Vigente desde" htmlFor="desde" hint="Las jornadas anteriores conservan el horario previo.">
          <Input id="desde" type="date" value={efectivoDesde} onChange={(e) => setEfectivoDesde(e.target.value)} />
        </Field>

        <div className="space-y-2">
          {DIAS_SEMANA.map((dia, i) => (
            <div key={dia} className="flex items-center gap-3">
              <label className="flex w-32 items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-marca-700 focus:ring-marca-500"
                  checked={franjas[i]!.activo}
                  onChange={(e) => {
                    const copia = [...franjas];
                    copia[i] = { ...copia[i]!, activo: e.target.checked };
                    setFranjas(copia);
                  }}
                />
                {dia}
              </label>
              <Input
                type="time"
                disabled={!franjas[i]!.activo}
                value={franjas[i]!.startTime}
                onChange={(e) => {
                  const copia = [...franjas];
                  copia[i] = { ...copia[i]!, startTime: e.target.value };
                  setFranjas(copia);
                }}
                className="w-32"
                aria-label={'Entrada ' + dia}
              />
              <span className="text-sm text-slate-400">a</span>
              <Input
                type="time"
                disabled={!franjas[i]!.activo}
                value={franjas[i]!.endTime}
                onChange={(e) => {
                  const copia = [...franjas];
                  copia[i] = { ...copia[i]!, endTime: e.target.value };
                  setFranjas(copia);
                }}
                className="w-32"
                aria-label={'Salida referencial ' + dia}
              />
            </div>
          ))}
        </div>

        {error && <ErrorMessage error={error} />}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variante="secundario" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button onClick={() => guardar.mutate()} cargando={guardar.isPending}>
            Guardar horario
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ModalEditar({
  abierto,
  onCerrar,
  practicante,
  sedes,
  onExito,
}: {
  abierto: boolean;
  onCerrar: () => void;
  practicante: PracticanteDetalle;
  sedes: Sede[];
  onExito: (mensaje: string) => void;
}) {
  const [form, setForm] = useState({
    firstNames: practicante.firstNames,
    lastNames: practicante.lastNames,
    siteId: practicante.site.id,
    areaGroup: practicante.areaGroup ?? '',
    phone: practicante.phone ?? '',
    email: practicante.email ?? '',
    active: practicante.active,
  });
  const [error, setError] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: () =>
      api.patch('/practicantes/' + practicante.id, {
        ...form,
        areaGroup: form.areaGroup || null,
        phone: form.phone || null,
        email: form.email || null,
      }),
    onSuccess: () => onExito('Datos actualizados.'),
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo actualizar.'),
  });

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Editar practicante">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombres" htmlFor="e-nombres">
            <Input id="e-nombres" value={form.firstNames} onChange={(e) => setForm({ ...form, firstNames: e.target.value })} />
          </Field>
          <Field label="Apellidos" htmlFor="e-apellidos">
            <Input id="e-apellidos" value={form.lastNames} onChange={(e) => setForm({ ...form, lastNames: e.target.value })} />
          </Field>
          <Field label="Sede" htmlFor="e-sede">
            <Select id="e-sede" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              {sedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Área / grupo" htmlFor="e-area">
            <Input id="e-area" value={form.areaGroup} onChange={(e) => setForm({ ...form, areaGroup: e.target.value })} />
          </Field>
          <Field label="Teléfono" htmlFor="e-telefono">
            <Input id="e-telefono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Correo" htmlFor="e-correo">
            <Input id="e-correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-marca-700 focus:ring-marca-500"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />
          Practicante activo
        </label>
        {!form.active && practicante.active && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Al desactivarlo se cerraran sus sesiones y no podra registrar asistencia. Su historial se conserva.
          </div>
        )}

        {error && <ErrorMessage error={error} />}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variante="secundario" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button onClick={() => guardar.mutate()} cargando={guardar.isPending}>
            Guardar cambios
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ModalDispositivo({
  abierto,
  onCerrar,
  internId,
  tieneDispositivo,
  onExito,
}: {
  abierto: boolean;
  onCerrar: () => void;
  internId: string;
  tieneDispositivo: boolean;
  onExito: (mensaje: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const dispositivos = useQuery({
    queryKey: ['dispositivos', internId],
    queryFn: () =>
      api.get<{
        dispositivos: {
          id: string;
          platform: string;
          model: string | null;
          status: string;
          boundAt: string;
          lastSeenAt: string;
          revokedAt: string | null;
          revokedBy: string | null;
          revokeReason: string | null;
        }[];
        cambioAutorizado: { expiresAt: string; reason: string } | null;
      }>('/practicantes/' + internId + '/dispositivos'),
    enabled: abierto,
  });

  const autorizar = useMutation({
    mutationFn: () => api.post('/practicantes/' + internId + '/dispositivos/autorizar-cambio', { reason: motivo }),
    onSuccess: () => onExito('Cambio autorizado. El practicante podrá vincular otro teléfono en su próximo inicio de sesión.'),
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo autorizar el cambio.'),
  });

  const revocar = useMutation({
    mutationFn: (bindingId: string) =>
      api.delete('/practicantes/' + internId + '/dispositivos/' + bindingId, { reason: motivo }),
    onSuccess: () => onExito('Dispositivo desvinculado. Sus sesiones fueron cerradas.'),
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo desvincular.'),
  });

  const activo = dispositivos.data?.dispositivos.find((d) => d.status === 'ACTIVO');

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Gestión del dispositivo" ancho="max-w-2xl">
      <div className="space-y-4">
        {dispositivos.isLoading && <Loading />}

        {dispositivos.data?.cambioAutorizado && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Hay una autorizacion de cambio vigente hasta {fechaHora(dispositivos.data.cambioAutorizado.expiresAt)}.
          </div>
        )}

        {dispositivos.data && (
          <Table>
            <thead>
              <tr>
                <Th>Dispositivo</Th>
                <Th>Vinculado</Th>
                <Th>Último uso</Th>
                <Th align="center">Estado</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dispositivos.data.dispositivos.map((d) => (
                <tr key={d.id}>
                  <Td>
                    {d.model ?? 'Sin modelo'}
                    <span className="ml-2 text-xs text-slate-400">{d.platform}</span>
                  </Td>
                  <Td>{fechaCorta(d.boundAt)}</Td>
                  <Td>{desdeAhora(d.lastSeenAt)}</Td>
                  <Td align="center">
                    {d.status === 'ACTIVO' ? (
                      <Badge tono="exito">Activo</Badge>
                    ) : (
                      <span title={d.revokeReason ?? undefined}>
                        <Badge tono="neutro">Revocado</Badge>
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
              {dispositivos.data.dispositivos.length === 0 && (
                <tr>
                  <Td>
                    <span className="text-slate-500">Sin dispositivos registrados.</span>
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
        )}

        <Field
          label="Motivo (obligatorio)"
          htmlFor="motivo-disp"
          hint="Se guarda en la auditoria junto con la acción."
        >
          <Textarea
            id="motivo-disp"
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej.: El practicante cambió de teléfono por avería del anterior."
          />
        </Field>

        {error && <ErrorMessage error={error} />}

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variante="secundario" onClick={onCerrar}>
            Cerrar
          </Button>
          <Button
            variante="secundario"
            onClick={() => autorizar.mutate()}
            cargando={autorizar.isPending}
            disabled={motivo.trim().length < 5}
          >
            Autorizar cambio de teléfono
          </Button>
          {activo && (
            <Button
              variante="peligro"
              onClick={() => revocar.mutate(activo.id)}
              cargando={revocar.isPending}
              disabled={motivo.trim().length < 5 || !tieneDispositivo}
            >
              Desvincular ahora
            </Button>
          )}
        </div>

        <p className="text-xs text-slate-500">
          <strong>Autorizar cambio</strong> deja el teléfono actual operativo hasta que el practicante entre con el
          nuevo. <strong>Desvincular</strong> corta el acceso de inmediato.
        </p>
      </div>
    </Modal>
  );
}

function ModalPassword({ abierto, onCerrar, internId }: { abierto: boolean; onCerrar: () => void; internId: string }) {
  const [resultado, setResultado] = useState<{ dni: string; temporaryPassword: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restablecer = useMutation({
    mutationFn: () =>
      api.post<{ dni: string; temporaryPassword: string }>('/practicantes/' + internId + '/restablecer-password'),
    onSuccess: (data) => setResultado(data),
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo restablecer la contraseña.'),
  });

  const cerrar = () => {
    setResultado(null);
    setError(null);
    onCerrar();
  };

  return (
    <Modal abierto={abierto} onCerrar={cerrar} titulo="Restablecer contraseña">
      {resultado ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">DNI</dt>
                <dd className="font-mono font-semibold">{resultado.dni}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Contraseña temporal</dt>
                <dd className="font-mono font-semibold">{resultado.temporaryPassword}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No se vuelve a mostrar. Entréguesela por un canal seguro. Todas las sesiones del practicante fueron cerradas
            y debera cambiarla al entrar.
          </div>
          <div className="flex justify-end">
            <Button onClick={cerrar}>Entendido</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Se generará una contraseña temporal y se cerraran todas las sesiones activas del practicante.
          </p>
          {error && <ErrorMessage error={error} />}
          <div className="flex justify-end gap-2">
            <Button variante="secundario" onClick={cerrar}>
              Cancelar
            </Button>
            <Button onClick={() => restablecer.mutate()} cargando={restablecer.isPending}>
              Restablecer
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
