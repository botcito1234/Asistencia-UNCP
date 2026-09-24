/**
 * Alertas e incidentes de seguridad.
 *
 * Esta pantalla es deliberadamente independiente de la asistencia: aqui vive
 * todo lo que se RECHAZO. Ninguno de estos registros cuenta como asistencia.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fechaHora, hoyISO, sumarDias, numero, metros, ETIQUETA_EVENTO } from '../lib/format';
import {
  Card,
  PageHeader,
  Metric,
  Loading,
  ErrorMessage,
  EmptyState,
  Input,
  Select,
  Field,
  Button,
  Badge,
  SeveridadBadge,
  Modal,
  Textarea,
  useToast,
} from '../components/ui';
import type { EventoSeguridad, Pagina, Sede } from '../lib/types';

const TIPOS = Object.keys(ETIQUETA_EVENTO);

export function Security() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [filtros, setFiltros] = useState({
    from: sumarDias(hoyISO(), -7),
    to: hoyISO(),
    siteId: '',
    type: '',
    severity: '',
    onlyPending: true,
  });
  const [atendiendo, setAtendiendo] = useState<EventoSeguridad | null>(null);

  const sedes = useQuery({ queryKey: ['sedes'], queryFn: () => api.get<Sede[]>('/sedes') });

  const eventos = useQuery({
    queryKey: ['seguridad', filtros],
    queryFn: () =>
      api.get<Pagina<EventoSeguridad> & { pending: number }>('/seguridad/eventos', {
        from: filtros.from,
        to: filtros.to,
        siteId: filtros.siteId || undefined,
        type: filtros.type || undefined,
        severity: filtros.severity || undefined,
        onlyPending: filtros.onlyPending ? 'true' : undefined,
        pageSize: 100,
      }),
    refetchInterval: 60_000,
  });

  const resumen = useQuery({
    queryKey: ['seguridad', 'resumen', filtros.from, filtros.to, filtros.siteId],
    queryFn: () =>
      api.get<{ pending: number; total: number; byType: { type: string; severity: string; count: number }[] }>(
        '/seguridad/resumen',
        { from: filtros.from, to: filtros.to, siteId: filtros.siteId || undefined },
      ),
  });

  const criticos = resumen.data?.byType.filter((t) => t.severity === 'CRITICO').reduce((a, t) => a + t.count, 0) ?? 0;

  return (
    <>
      {toast.Toast}

      <PageHeader title="Alertas de seguridad" description="Intentos rechazados e incidentes. Nunca cuentan como asistencia." />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Eventos del periodo" value={numero(resumen.data?.total ?? 0)} />
        <Metric label="Sin atender" value={numero(resumen.data?.pending ?? 0)} tono={(resumen.data?.pending ?? 0) > 0 ? 'aviso' : 'neutro'} />
        <Metric label="Criticos" value={numero(criticos)} tono={criticos > 0 ? 'peligro' : 'neutro'} />
        <Metric label="Mostrados" value={numero(eventos.data?.total ?? 0)} />
      </div>

      <Card className="mb-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Desde" htmlFor="f-desde">
            <Input id="f-desde" type="date" value={filtros.from} max={filtros.to} onChange={(e) => setFiltros({ ...filtros, from: e.target.value })} />
          </Field>
          <Field label="Hasta" htmlFor="f-hasta">
            <Input id="f-hasta" type="date" value={filtros.to} min={filtros.from} max={hoyISO()} onChange={(e) => setFiltros({ ...filtros, to: e.target.value })} />
          </Field>
          <Field label="Sede" htmlFor="f-sede">
            <Select id="f-sede" value={filtros.siteId} onChange={(e) => setFiltros({ ...filtros, siteId: e.target.value })}>
              <option value="">Todas</option>
              {(sedes.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tipo" htmlFor="f-tipo">
            <Select id="f-tipo" value={filtros.type} onChange={(e) => setFiltros({ ...filtros, type: e.target.value })}>
              <option value="">Todos</option>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {ETIQUETA_EVENTO[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Severidad" htmlFor="f-sev">
            <Select id="f-sev" value={filtros.severity} onChange={(e) => setFiltros({ ...filtros, severity: e.target.value })}>
              <option value="">Todas</option>
              <option value="CRITICO">Crítico</option>
              <option value="ADVERTENCIA">Advertencia</option>
              <option value="INFO">Informativo</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-marca-700 focus:ring-marca-500"
                checked={filtros.onlyPending}
                onChange={(e) => setFiltros({ ...filtros, onlyPending: e.target.checked })}
              />
              Solo sin atender
            </label>
          </div>
        </div>
      </Card>

      <Card title="Eventos">
        {eventos.isLoading && <Loading />}
        {eventos.isError && <ErrorMessage error={eventos.error} onRetry={() => void eventos.refetch()} />}

        {eventos.data && eventos.data.items.length === 0 && (
          <EmptyState titulo="Sin eventos" descripcion="No se registraron incidentes con los filtros seleccionados." />
        )}

        {eventos.data && eventos.data.items.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {eventos.data.items.map((e) => (
              <li key={e.id} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeveridadBadge valor={e.severity} />
                      <span className="text-sm font-semibold text-slate-800">{ETIQUETA_EVENTO[e.type] ?? e.type}</span>
                      {e.acknowledgedAt && <Badge tono="neutro">Atendido</Badge>}
                    </div>

                    <p className="mt-1.5 text-sm text-slate-700">{e.message}</p>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>{fechaHora(e.createdAt)}</span>
                      {e.intern && (
                        <Link to={'/practicantes/' + e.intern.id} className="font-medium text-marca-700 hover:underline">
                          {e.intern.lastNames}, {e.intern.firstNames} ({e.intern.dni})
                        </Link>
                      )}
                      {e.site && <span>{e.site.name}</span>}
                      {e.distanceMeters !== null && <span>Distancia: {metros(e.distanceMeters)}</span>}
                      {e.accuracyMeters !== null && <span>Precision: {metros(e.accuracyMeters)}</span>}
                      {e.latitude !== null && e.longitude !== null && (
                        <span className="font-mono">
                          {e.latitude.toFixed(5)}, {e.longitude.toFixed(5)}
                        </span>
                      )}
                    </div>

                    {e.acknowledgedAt && (
                      <p className="mt-2 rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        Atendido por {e.acknowledger?.displayName ?? 'un administrador'} el {fechaHora(e.acknowledgedAt)}
                        {e.acknowledgeNote ? ': ' + e.acknowledgeNote : '.'}
                      </p>
                    )}
                  </div>

                  {!e.acknowledgedAt && (
                    <Button variante="secundario" onClick={() => setAtendiendo(e)}>
                      Marcar como atendido
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ModalAtender
        evento={atendiendo}
        onCerrar={() => setAtendiendo(null)}
        onExito={() => {
          toast.exito('Evento marcado como atendido.');
          setAtendiendo(null);
          void queryClient.invalidateQueries({ queryKey: ['seguridad'] });
        }}
      />
    </>
  );
}

function ModalAtender({
  evento,
  onCerrar,
  onExito,
}: {
  evento: EventoSeguridad | null;
  onCerrar: () => void;
  onExito: () => void;
}) {
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);

  const atender = useMutation({
    mutationFn: () => api.post('/seguridad/eventos/' + evento!.id + '/atender', { note: nota || undefined }),
    onSuccess: () => {
      setNota('');
      onExito();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo registrar.'),
  });

  return (
    <Modal abierto={evento !== null} onCerrar={onCerrar} titulo="Atender evento">
      {evento && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-800">{ETIQUETA_EVENTO[evento.type] ?? evento.type}</p>
            <p className="mt-1 text-sm text-slate-600">{evento.message}</p>
          </div>

          <Field label="Nota de atención (opcional)" htmlFor="nota" hint="Explique qué se verificó o qué medida se tomó.">
            <Textarea id="nota" rows={3} value={nota} onChange={(e) => setNota(e.target.value)} />
          </Field>

          {error && <ErrorMessage error={error} />}

          <div className="flex justify-end gap-2">
            <Button variante="secundario" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button onClick={() => atender.mutate()} cargando={atender.isPending}>
              Marcar como atendido
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
