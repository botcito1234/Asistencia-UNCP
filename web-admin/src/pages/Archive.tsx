/**
 * Archivado historico y retencion.
 *
 * El proceso nunca libera almacenamiento sin haber verificado antes que la
 * copia remota existe y coincide. La pantalla refleja esa secuencia para que el
 * administrador sepa en que paso esta cada periodo.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fechaHora, bytes, numero, hoyISO, inicioDeMes } from '../lib/format';
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
  useToast,
} from '../components/ui';
import type { LoteArchivado, Sede } from '../lib/types';

const ESTADO_TONO: Record<string, 'neutro' | 'exito' | 'aviso' | 'peligro' | 'info'> = {
  PENDIENTE: 'aviso',
  GENERANDO: 'info',
  SUBIENDO: 'info',
  VERIFICANDO: 'info',
  COMPLETADO: 'exito',
  LIBERADO: 'exito',
  FALLIDO: 'peligro',
};

const ESTADO_TEXTO: Record<string, string> = {
  PENDIENTE: 'Pendiente de subida',
  GENERANDO: 'Generando',
  SUBIENDO: 'Subiendo',
  VERIFICANDO: 'Verificando',
  COMPLETADO: 'Subido y verificado',
  LIBERADO: 'Archivado y liberado',
  FALLIDO: 'Fallido',
};

export function Archive() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modalAbierto, setModalAbierto] = useState(false);

  const archivado = useQuery({
    queryKey: ['archivado'],
    queryFn: () =>
      api.get<{ retencionMeses: number; driveHabilitado: boolean; lotes: LoteArchivado[] }>('/archivado'),
  });

  const drive = useQuery({
    queryKey: ['archivado', 'drive'],
    queryFn: () => api.get<{ ok: boolean; message: string; rootFolderName?: string }>('/archivado/drive/estado'),
  });

  const retencion = useMutation({
    mutationFn: () => api.post<{ lotes: unknown[] }>('/archivado/retencion'),
    onSuccess: (data) => {
      toast.exito('Barrido de retención ejecutado: ' + data.lotes.length + ' periodo(s) procesado(s).');
      void queryClient.invalidateQueries({ queryKey: ['archivado'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'No se pudo ejecutar el barrido.'),
  });

  return (
    <>
      {toast.Toast}

      <PageHeader
        title="Archivado histórico"
        description={
          archivado.data
            ? 'La información permanece operativa ' + archivado.data.retencionMeses + ' meses y después se archiva.'
            : undefined
        }
        actions={
          <>
            <Button variante="secundario" onClick={() => retencion.mutate()} cargando={retencion.isPending}>
              Ejecutar retención ahora
            </Button>
            <Button onClick={() => setModalAbierto(true)}>Archivar periodo</Button>
          </>
        }
      />

      <Card title="Google Drive" className="mb-5">
        {drive.isLoading && <Loading texto="Comprobando conexión..." />}
        {drive.data && (
          <div
            className={
              'rounded-lg border px-4 py-3 text-sm ' +
              (drive.data.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-amber-200 bg-amber-50 text-amber-800')
            }
          >
            <p className="font-medium">
              {drive.data.ok ? 'Conectado' : 'Pendiente de configuración'}
              {drive.data.rootFolderName ? ' · carpeta: ' + drive.data.rootFolderName : ''}
            </p>
            <p className="mt-1">{drive.data.message}</p>
            {!drive.data.ok && (
              <p className="mt-2 text-xs">
                Mientras tanto el sistema sigue archivando: genera el paquete, verifica la integridad de cada fotografía
                y lo deja en el disco del servidor marcado como pendiente de subida. <strong>No se borra nada.</strong>
              </p>
            )}
          </div>
        )}
      </Card>

      <Card title="Secuencia de archivado">
        <ol className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['1', 'Generar', 'Excel, PDF, metadata.json y fotografías'],
            ['2', 'Verificar', 'Hash SHA-256 de cada fotografía'],
            ['3', 'Empaquetar', 'Comprimir en un único ZIP'],
            ['4', 'Subir', 'A Asistencias/Sede/Año/Mes en Drive'],
            ['5', 'Comprobar', 'Releer tamaño y checksum remotos'],
            ['6', 'Liberar', 'Solo si la comprobación fue correcta'],
          ].map(([n, titulo, detalle]) => (
            <li key={n} className="rounded-lg border border-slate-200 p-3">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-marca-700 text-xs font-bold text-white">
                {n}
              </span>
              <p className="mt-2 font-medium text-slate-800">{titulo}</p>
              <p className="mt-0.5 text-xs text-slate-500">{detalle}</p>
            </li>
          ))}
        </ol>
      </Card>

      <VerificacionIntegridad />

      <Card title="Lotes de archivado" className="mt-5">
        {archivado.isLoading && <Loading />}
        {archivado.isError && <ErrorMessage error={archivado.error} onRetry={() => void archivado.refetch()} />}

        {archivado.data && archivado.data.lotes.length === 0 && (
          <EmptyState
            titulo="Sin archivados"
            descripcion="Todavía no se ha archivado ningún periodo. El proceso automático se ejecuta cada mes."
          />
        )}

        {archivado.data && archivado.data.lotes.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Sede</Th>
                <Th>Periodo</Th>
                <Th align="center">Estado</Th>
                <Th align="right">Jornadas</Th>
                <Th align="right">Fotos</Th>
                <Th align="right">Tamano</Th>
                <Th>Verificado</Th>
                <Th>Liberado</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {archivado.data.lotes.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <Td>{l.site.name}</Td>
                  <Td className="tabular-nums">{l.period}</Td>
                  <Td align="center">
                    <Badge tono={ESTADO_TONO[l.status] ?? 'neutro'}>{ESTADO_TEXTO[l.status] ?? l.status}</Badge>
                  </Td>
                  <Td align="right" className="tabular-nums">{numero(l.attendanceDays)}</Td>
                  <Td align="right" className="tabular-nums">{numero(l.photosCount)}</Td>
                  <Td align="right" className="tabular-nums">{bytes(l.packageBytes)}</Td>
                  <Td>{l.verifiedAt ? fechaHora(l.verifiedAt) : '—'}</Td>
                  <Td>{l.releasedAt ? fechaHora(l.releasedAt) : '—'}</Td>
                  <Td align="right">
                    {l.driveWebLink ? (
                      <a
                        href={l.driveWebLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-marca-700 hover:underline"
                      >
                        Abrir en Drive
                      </a>
                    ) : l.lastError ? (
                      <span className="text-xs text-rose-600" title={l.lastError}>
                        Ver error
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">En disco</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ModalArchivar
        abierto={modalAbierto}
        onCerrar={() => setModalAbierto(false)}
        onExito={(mensaje) => {
          toast.exito(mensaje);
          setModalAbierto(false);
          void queryClient.invalidateQueries({ queryKey: ['archivado'] });
        }}
      />
    </>
  );
}

function ModalArchivar({
  abierto,
  onCerrar,
  onExito,
}: {
  abierto: boolean;
  onCerrar: () => void;
  onExito: (mensaje: string) => void;
}) {
  const hoy = hoyISO();
  const [form, setForm] = useState({
    siteId: '',
    year: Number(hoy.slice(0, 4)),
    month: Number(hoy.slice(5, 7)),
    release: false,
  });
  const [error, setError] = useState<string | null>(null);

  const sedes = useQuery({ queryKey: ['sedes'], queryFn: () => api.get<Sede[]>('/sedes', { includeInactive: 'true' }) });

  const ejecutar = useMutation({
    mutationFn: () =>
      api.post<{ lotes: { status: string; warnings?: string[] }[] }>('/archivado/ejecutar', {
        siteId: form.siteId || undefined,
        year: form.year,
        month: form.month,
        release: form.release,
      }),
    onSuccess: (data) => {
      const avisos = data.lotes.flatMap((l) => l.warnings ?? []);
      onExito(
        'Archivado ejecutado en ' + data.lotes.length + ' sede(s).' + (avisos.length > 0 ? ' Con avisos: ' + avisos[0] : ''),
      );
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo archivar el periodo.'),
  });

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Archivar periodo">
      <div className="space-y-4">
        <Field label="Sede" htmlFor="a-sede" hint="Si no elige ninguna, se archiva el periodo en todas las sedes.">
          <Select id="a-sede" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
            <option value="">Todas las sedes</option>
            {(sedes.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ano" htmlFor="a-ano">
            <Input
              id="a-ano"
              type="number"
              min={2020}
              max={2100}
              value={form.year}
              onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
            />
          </Field>
          <Field label="Mes" htmlFor="a-mes">
            <Select id="a-mes" value={form.month} onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}>
              {['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map(
                (m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ),
              )}
            </Select>
          </Field>
        </div>

        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-700 focus:ring-amber-500"
            checked={form.release}
            onChange={(e) => setForm({ ...form, release: e.target.checked })}
          />
          <span>
            <strong>Liberar el almacenamiento local</strong> tras archivar.
            <br />
            Las fotografías solo se borran del servidor si la subida a Drive se verifico correctamente. Si Drive no está
            configurado o la verificación falla, no se borra nada.
          </span>
        </label>

        {error && <ErrorMessage error={error} />}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variante="secundario" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button onClick={() => ejecutar.mutate()} cargando={ejecutar.isPending}>
            Archivar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Comprueba que cada fotografia del periodo siga correspondiendo al hash
 * SHA-256 registrado cuando se recibio. Cualquier alteracion posterior del
 * archivo en disco aparece aqui.
 */
function VerificacionIntegridad() {
  const [rango, setRango] = useState({ from: inicioDeMes(hoyISO()), to: hoyISO() });
  const [resultado, setResultado] = useState<{
    revisadas: number;
    integras: number;
    alteradas: string[];
    faltantes: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verificar = useMutation({
    mutationFn: () =>
      api.get<{ revisadas: number; integras: number; alteradas: string[]; faltantes: string[] }>(
        '/archivado/integridad',
        rango,
      ),
    onSuccess: (datos) => {
      setResultado(datos);
      setError(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo verificar la integridad.'),
  });

  const problemas = resultado ? resultado.alteradas.length + resultado.faltantes.length : 0;

  return (
    <Card
      title="Integridad de evidencias"
      subtitle="Compara cada fotografía en disco con el hash registrado al recibirla"
      className="mt-5"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Desde" htmlFor="i-desde">
          <Input
            id="i-desde"
            type="date"
            value={rango.from}
            max={rango.to}
            onChange={(e) => setRango({ ...rango, from: e.target.value })}
          />
        </Field>
        <Field label="Hasta" htmlFor="i-hasta">
          <Input
            id="i-hasta"
            type="date"
            value={rango.to}
            min={rango.from}
            max={hoyISO()}
            onChange={(e) => setRango({ ...rango, to: e.target.value })}
          />
        </Field>
        <Button variante="secundario" onClick={() => verificar.mutate()} cargando={verificar.isPending}>
          Verificar
        </Button>
      </div>

      {error && (
        <div className="mt-4">
          <ErrorMessage error={error} />
        </div>
      )}

      {resultado && (
        <div
          className={
            'mt-4 rounded-lg border px-4 py-3 text-sm ' +
            (problemas === 0
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800')
          }
        >
          <p className="font-medium">
            {problemas === 0
              ? 'Todas las fotografías del periodo están integras.'
              : problemas + ' fotografía(s) con problemas.'}
          </p>
          <p className="mt-1">
            Revisadas: {numero(resultado.revisadas)} · Integras: {numero(resultado.integras)} · Alteradas:{' '}
            {numero(resultado.alteradas.length)} · No encontradas: {numero(resultado.faltantes.length)}
          </p>
          {resultado.alteradas.length > 0 && (
            <p className="mt-2 break-all font-mono text-xs">Alteradas: {resultado.alteradas.join(', ')}</p>
          )}
          {resultado.faltantes.length > 0 && (
            <p className="mt-1 break-all font-mono text-xs">No encontradas: {resultado.faltantes.join(', ')}</p>
          )}
        </div>
      )}
    </Card>
  );
}
