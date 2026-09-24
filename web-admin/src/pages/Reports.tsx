/**
 * Generacion de reportes en Excel y PDF, con vista previa en pantalla.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, apiDownload } from '../lib/api';
import { hoyISO, sumarDias, inicioDeMes, finDeMes, numero, porcentaje, fechaHora } from '../lib/format';
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
  Select,
  Field,
  Button,
  useToast,
} from '../components/ui';
import type { Sede, Practicante, Pagina, VistaPreviaReporte } from '../lib/types';

interface TipoReporte {
  id: string;
  nombre: string;
  descripcion: string;
}

export function Reports() {
  const toast = useToast();
  const [criterios, setCriterios] = useState({
    tipo: 'consolidado',
    from: inicioDeMes(hoyISO()),
    to: hoyISO(),
    siteId: '',
    internId: '',
  });
  const [descargando, setDescargando] = useState<'excel' | 'pdf' | null>(null);

  const tipos = useQuery({
    queryKey: ['reportes', 'tipos'],
    queryFn: () => api.get<{ tipos: TipoReporte[]; formatos: string[] }>('/reportes/tipos'),
  });

  const sedes = useQuery({ queryKey: ['sedes'], queryFn: () => api.get<Sede[]>('/sedes') });

  const practicantes = useQuery({
    queryKey: ['practicantes', 'reportes', criterios.siteId],
    queryFn: () => api.get<Pagina<Practicante>>('/practicantes', { siteId: criterios.siteId || undefined, pageSize: 200 }),
  });

  const vista = useQuery({
    queryKey: ['reportes', 'vista', criterios],
    queryFn: () =>
      api.get<VistaPreviaReporte>('/reportes/vista-previa', {
        tipo: criterios.tipo,
        formato: 'excel',
        from: criterios.from,
        to: criterios.to,
        siteId: criterios.siteId || undefined,
        internId: criterios.internId || undefined,
      }),
  });

  const descargar = async (formato: 'excel' | 'pdf') => {
    setDescargando(formato);
    try {
      await apiDownload('/reportes/generar', {
        tipo: criterios.tipo,
        formato,
        from: criterios.from,
        to: criterios.to,
        siteId: criterios.siteId || undefined,
        internId: criterios.internId || undefined,
      });
      toast.exito('Reporte ' + formato.toUpperCase() + ' generado.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo generar el reporte.');
    } finally {
      setDescargando(null);
    }
  };

  /** Atajos de periodo, que es lo que mas se usa en el dia a dia. */
  const atajos: { etiqueta: string; aplicar: () => void }[] = [
    { etiqueta: 'Hoy', aplicar: () => setCriterios((c) => ({ ...c, from: hoyISO(), to: hoyISO(), tipo: 'diario' })) },
    { etiqueta: 'Ayer', aplicar: () => setCriterios((c) => ({ ...c, from: sumarDias(hoyISO(), -1), to: sumarDias(hoyISO(), -1), tipo: 'diario' })) },
    { etiqueta: 'Últimos 7 días', aplicar: () => setCriterios((c) => ({ ...c, from: sumarDias(hoyISO(), -6), to: hoyISO(), tipo: 'semanal' })) },
    { etiqueta: 'Este mes', aplicar: () => setCriterios((c) => ({ ...c, from: inicioDeMes(hoyISO()), to: hoyISO(), tipo: 'mensual' })) },
    {
      etiqueta: 'Mes anterior',
      aplicar: () => {
        const anterior = sumarDias(inicioDeMes(hoyISO()), -1);
        setCriterios((c) => ({ ...c, from: inicioDeMes(anterior), to: finDeMes(anterior), tipo: 'mensual' }));
      },
    },
  ];

  return (
    <>
      {toast.Toast}

      <PageHeader title="Reportes" description="Excel y PDF por periodo, sede, practicante o tipo de incidencia" />

      <Card className="mb-5">
        <div className="mb-4 flex flex-wrap gap-2">
          {atajos.map((a) => (
            <button
              key={a.etiqueta}
              type="button"
              onClick={a.aplicar}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-marca-400 hover:text-marca-700"
            >
              {a.etiqueta}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Tipo de reporte" htmlFor="r-tipo">
            <Select id="r-tipo" value={criterios.tipo} onChange={(e) => setCriterios({ ...criterios, tipo: e.target.value })}>
              {(tipos.data?.tipos ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Desde" htmlFor="r-desde">
            <Input id="r-desde" type="date" value={criterios.from} max={criterios.to} onChange={(e) => setCriterios({ ...criterios, from: e.target.value })} />
          </Field>
          <Field label="Hasta" htmlFor="r-hasta">
            <Input id="r-hasta" type="date" value={criterios.to} min={criterios.from} max={hoyISO()} onChange={(e) => setCriterios({ ...criterios, to: e.target.value })} />
          </Field>
          <Field label="Sede" htmlFor="r-sede">
            <Select
              id="r-sede"
              value={criterios.siteId}
              onChange={(e) => setCriterios({ ...criterios, siteId: e.target.value, internId: '' })}
            >
              <option value="">Todas</option>
              {(sedes.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Practicante" htmlFor="r-practicante">
            <Select id="r-practicante" value={criterios.internId} onChange={(e) => setCriterios({ ...criterios, internId: e.target.value })}>
              <option value="">Todos</option>
              {(practicantes.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          {tipos.data?.tipos.find((t) => t.id === criterios.tipo)?.descripcion}
        </p>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <Button onClick={() => void descargar('excel')} cargando={descargando === 'excel'}>
            Descargar Excel
          </Button>
          <Button variante="secundario" onClick={() => void descargar('pdf')} cargando={descargando === 'pdf'}>
            Descargar PDF
          </Button>
        </div>
      </Card>

      {vista.isLoading && <Loading texto="Preparando vista previa..." />}
      {vista.isError && <ErrorMessage error={vista.error} onRetry={() => void vista.refetch()} />}

      {vista.data && (
        <>
          {vista.data.totals && (
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <Metric label="Jornadas" value={numero(vista.data.totals.jornadas)} />
              <Metric label="Presentes" value={numero(vista.data.totals.presentes)} tono="exito" />
              <Metric label="Puntuales" value={numero(vista.data.totals.puntuales)} tono="exito" />
              <Metric label="Tardanzas" value={numero(vista.data.totals.tardanzas)} tono="aviso" />
              <Metric label="Faltas" value={numero(vista.data.totals.ausentes)} tono="peligro" />
              <Metric label="Salidas" value={numero(vista.data.totals.salidasRegistradas)} />
              <Metric label="Pendientes" value={numero(vista.data.totals.salidasPendientes)} tono="aviso" />
              <Metric label="Puntualidad" value={porcentaje(vista.data.totals.porcentajePuntualidad)} tono="info" />
            </div>
          )}

          <Card
            title={vista.data.title}
            subtitle={vista.data.subtitle + ' · generado ' + fechaHora(vista.data.generatedAt)}
          >
            {vista.data.rows.length === 0 ? (
              <EmptyState titulo="Sin datos" descripcion="No hay registros para los criterios seleccionados." />
            ) : (
              <>
                {vista.data.truncado && (
                  <p className="mb-3 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                    Vista previa limitada a 500 filas de {numero(vista.data.filas)}. La descarga incluye todo.
                  </p>
                )}
                <Table>
                  <thead>
                    <tr>
                      {vista.data.columns.map((c) => (
                        <Th key={c.key} align={c.align}>
                          {c.header}
                        </Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {vista.data.rows.map((fila, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {vista.data!.columns.map((c) => (
                          <Td key={c.key} align={c.align}>
                            {fila[c.key] === null || fila[c.key] === undefined || fila[c.key] === ''
                              ? '—'
                              : String(fila[c.key])}
                          </Td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </>
            )}
          </Card>

          {vista.data.bySite.length > 1 && (
            <Card title="Resumen por sede" className="mt-5">
              <Table>
                <thead>
                  <tr>
                    <Th>Sede</Th>
                    <Th align="right">Jornadas</Th>
                    <Th align="right">Puntuales</Th>
                    <Th align="right">Tardanzas</Th>
                    <Th align="right">Faltas</Th>
                    <Th align="right">Pendientes</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {vista.data.bySite.map((s) => (
                    <tr key={s.sede}>
                      <Td>{s.sede}</Td>
                      <Td align="right">{numero(s.jornadas)}</Td>
                      <Td align="right">{numero(s.puntuales)}</Td>
                      <Td align="right">{numero(s.tardanzas)}</Td>
                      <Td align="right">{numero(s.ausentes)}</Td>
                      <Td align="right">{numero(s.pendientes)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}
    </>
  );
}
