/**
 * Bitacora de auditoria.
 *
 * Registra escrituras y tambien lecturas sensibles (consulta y descarga de
 * evidencias, generacion de reportes). La bitacora es inmutable: la base de
 * datos rechaza cualquier intento de modificarla o borrarla.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fechaHora, hoyISO, sumarDias, numero } from '../lib/format';
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
  Badge,
  Modal,
} from '../components/ui';

interface EntradaAuditoria {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ipAddress: string | null;
  requestId: string | null;
  createdAt: string;
  actor: { id: string; dni: string; displayName: string; role: string } | null;
}

const ACCIONES = [
  'LOGIN_EXITOSO', 'LOGIN_FALLIDO', 'LOGOUT', 'PASSWORD_CAMBIADA', 'PASSWORD_RESTABLECIDA',
  'DISPOSITIVO_VINCULADO', 'DISPOSITIVO_REVOCADO', 'DISPOSITIVO_CAMBIO_AUTORIZADO',
  'SEDE_CREADA', 'SEDE_ACTUALIZADA', 'SEDE_DESACTIVADA',
  'PRACTICANTE_CREADO', 'PRACTICANTE_ACTUALIZADO', 'PRACTICANTE_DESACTIVADO',
  'HORARIO_ACTUALIZADO', 'ENTRADA_REGISTRADA', 'SALIDA_REGISTRADA', 'MARCACION_RECHAZADA',
  'REGULARIZACION_APLICADA', 'EVIDENCIA_CONSULTADA', 'EVIDENCIA_DESCARGADA',
  'REPORTE_GENERADO', 'ARCHIVADO_EJECUTADO', 'ARCHIVADO_LIBERADO',
  'PARAMETROS_ACTUALIZADOS', 'EVENTO_SEGURIDAD_ATENDIDO', 'CONSENTIMIENTO_ACEPTADO', 'JORNADA_CERRADA',
];

const ETIQUETA_ACCION: Record<string, string> = {
  LOGIN_EXITOSO: 'Inicio de sesión',
  LOGIN_FALLIDO: 'Intento de acceso fallido',
  LOGOUT: 'Cierre de sesión',
  PASSWORD_CAMBIADA: 'Contraseña cambiada',
  PASSWORD_RESTABLECIDA: 'Contraseña restablecida',
  DISPOSITIVO_VINCULADO: 'Dispositivo vinculado',
  DISPOSITIVO_REVOCADO: 'Dispositivo desvinculado',
  DISPOSITIVO_CAMBIO_AUTORIZADO: 'Cambio de dispositivo autorizado',
  SEDE_CREADA: 'Sede creada',
  SEDE_ACTUALIZADA: 'Sede actualizada',
  SEDE_DESACTIVADA: 'Sede desactivada',
  PRACTICANTE_CREADO: 'Practicante creado',
  PRACTICANTE_ACTUALIZADO: 'Practicante actualizado',
  PRACTICANTE_DESACTIVADO: 'Practicante desactivado',
  HORARIO_ACTUALIZADO: 'Horario actualizado',
  ENTRADA_REGISTRADA: 'Entrada registrada',
  SALIDA_REGISTRADA: 'Salida registrada',
  MARCACION_RECHAZADA: 'Marcación rechazada',
  REGULARIZACION_APLICADA: 'Regularización aplicada',
  EVIDENCIA_CONSULTADA: 'Evidencia consultada',
  EVIDENCIA_DESCARGADA: 'Evidencia descargada',
  REPORTE_GENERADO: 'Reporte generado',
  ARCHIVADO_EJECUTADO: 'Archivado ejecutado',
  ARCHIVADO_LIBERADO: 'Archivado liberado',
  PARAMETROS_ACTUALIZADOS: 'Parámetros actualizados',
  EVENTO_SEGURIDAD_ATENDIDO: 'Evento atendido',
  CONSENTIMIENTO_ACEPTADO: 'Consentimiento aceptado',
  JORNADA_CERRADA: 'Jornada cerrada',
};

/** Acciones que representan lectura de datos personales. */
const LECTURAS = new Set(['EVIDENCIA_CONSULTADA', 'EVIDENCIA_DESCARGADA', 'REPORTE_GENERADO']);

export function Audit() {
  const [filtros, setFiltros] = useState({
    from: sumarDias(hoyISO(), -7),
    to: hoyISO(),
    action: '',
    entityType: '',
  });
  const [pagina, setPagina] = useState(1);
  const [detalle, setDetalle] = useState<EntradaAuditoria | null>(null);

  const auditoria = useQuery({
    queryKey: ['auditoria', filtros, pagina],
    queryFn: () =>
      api.get<{ total: number; page: number; pageSize: number; items: EntradaAuditoria[] }>('/seguridad/auditoria', {
        from: filtros.from,
        to: filtros.to,
        action: filtros.action || undefined,
        entityType: filtros.entityType || undefined,
        page: pagina,
        pageSize: 50,
      }),
  });

  const totalPaginas = auditoria.data ? Math.max(1, Math.ceil(auditoria.data.total / auditoria.data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Auditoría"
        description="Registro inmutable de escrituras y de lecturas de datos personales"
      />

      <Card className="mb-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Desde" htmlFor="a-desde">
            <Input id="a-desde" type="date" value={filtros.from} max={filtros.to} onChange={(e) => { setFiltros({ ...filtros, from: e.target.value }); setPagina(1); }} />
          </Field>
          <Field label="Hasta" htmlFor="a-hasta">
            <Input id="a-hasta" type="date" value={filtros.to} min={filtros.from} max={hoyISO()} onChange={(e) => { setFiltros({ ...filtros, to: e.target.value }); setPagina(1); }} />
          </Field>
          <Field label="Accion" htmlFor="a-accion">
            <Select id="a-accion" value={filtros.action} onChange={(e) => { setFiltros({ ...filtros, action: e.target.value }); setPagina(1); }}>
              <option value="">Todas</option>
              {ACCIONES.map((a) => (
                <option key={a} value={a}>
                  {ETIQUETA_ACCION[a] ?? a}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Entidad" htmlFor="a-entidad">
            <Select id="a-entidad" value={filtros.entityType} onChange={(e) => { setFiltros({ ...filtros, entityType: e.target.value }); setPagina(1); }}>
              <option value="">Todas</option>
              {['UserAccount', 'Intern', 'Site', 'AttendanceMark', 'AttendanceDay', 'EvidencePhoto', 'DeviceBinding', 'ArchiveBatch', 'Reporte', 'AppSetting'].map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card title={auditoria.data ? numero(auditoria.data.total) + ' registro(s)' : 'Bitácora'}>
        {auditoria.isLoading && <Loading />}
        {auditoria.isError && <ErrorMessage error={auditoria.error} onRetry={() => void auditoria.refetch()} />}

        {auditoria.data && auditoria.data.items.length === 0 && (
          <EmptyState titulo="Sin registros" descripcion="No hay actividad auditada con los filtros seleccionados." />
        )}

        {auditoria.data && auditoria.data.items.length > 0 && (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Fecha y hora</Th>
                  <Th>Accion</Th>
                  <Th>Actor</Th>
                  <Th>Entidad</Th>
                  <Th>Motivo</Th>
                  <Th>IP</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditoria.data.items.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <Td className="tabular-nums">{fechaHora(a.createdAt)}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">{ETIQUETA_ACCION[a.action] ?? a.action}</span>
                        {LECTURAS.has(a.action) && <Badge tono="info">Lectura</Badge>}
                      </div>
                    </Td>
                    <Td>{a.actor ? a.actor.displayName : <span className="text-slate-400">Sistema</span>}</Td>
                    <Td className="text-xs text-slate-500">{a.entityType}</Td>
                    <Td className="max-w-xs truncate">{a.reason ?? '—'}</Td>
                    <Td className="font-mono text-xs text-slate-500">{a.ipAddress ?? '—'}</Td>
                    <Td align="right">
                      <button
                        type="button"
                        onClick={() => setDetalle(a)}
                        className="text-sm font-medium text-marca-700 hover:underline"
                      >
                        Detalle
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {totalPaginas > 1 && (
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                <p className="text-sm text-slate-500">
                  Pagina {auditoria.data.page} de {totalPaginas}
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

      <Modal abierto={detalle !== null} onCerrar={() => setDetalle(null)} titulo="Detalle de auditoria" ancho="max-w-2xl">
        {detalle && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
              <dt className="text-slate-500">Accion</dt>
              <dd className="text-right font-medium">{ETIQUETA_ACCION[detalle.action] ?? detalle.action}</dd>
              <dt className="text-slate-500">Fecha</dt>
              <dd className="text-right">{fechaHora(detalle.createdAt)}</dd>
              <dt className="text-slate-500">Actor</dt>
              <dd className="text-right">{detalle.actor ? detalle.actor.displayName + ' (' + detalle.actor.dni + ')' : 'Sistema'}</dd>
              <dt className="text-slate-500">Entidad</dt>
              <dd className="text-right font-mono text-xs">{detalle.entityType}</dd>
              <dt className="text-slate-500">Identificador</dt>
              <dd className="text-right font-mono text-xs">{detalle.entityId ?? '—'}</dd>
              <dt className="text-slate-500">IP</dt>
              <dd className="text-right font-mono text-xs">{detalle.ipAddress ?? '—'}</dd>
              <dt className="text-slate-500">Traza</dt>
              <dd className="text-right font-mono text-xs">{detalle.requestId ?? '—'}</dd>
            </dl>

            {detalle.reason && (
              <div>
                <p className="mb-1 font-medium text-slate-700">Motivo</p>
                <p className="rounded bg-slate-50 p-3 text-slate-600">{detalle.reason}</p>
              </div>
            )}

            {detalle.before !== null && detalle.before !== undefined && (
              <div>
                <p className="mb-1 font-medium text-slate-700">Valor anterior</p>
                <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
                  {JSON.stringify(detalle.before, null, 2)}
                </pre>
              </div>
            )}

            {detalle.after !== null && detalle.after !== undefined && (
              <div>
                <p className="mb-1 font-medium text-slate-700">Valor posterior</p>
                <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
                  {JSON.stringify(detalle.after, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
