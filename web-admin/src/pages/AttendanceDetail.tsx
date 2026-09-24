/**
 * Detalle de una jornada: evidencia fotográfica, mapa de la marcacion,
 * historial de regularizaciones y el formulario para corregir con motivo.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiDownload, resourceUrl } from '../lib/api';
import { fechaLarga, fechaHora, metros, duracionMinutos, ETIQUETA_CAMPO_REGULARIZACION } from '../lib/format';
import {
  Card,
  PageHeader,
  Loading,
  ErrorMessage,
  Button,
  Modal,
  Field,
  Select,
  Input,
  Textarea,
  EstadoBadge,
  PuntualidadBadge,
  Badge,
  Metric,
  useToast,
} from '../components/ui';
import { MapView, type PuntoMarcacion } from '../components/MapView';
import type { Jornada } from '../lib/types';

export function AttendanceDetail() {
  const { attendanceDayId = '' } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [modalAbierto, setModalAbierto] = useState(false);

  const jornada = useQuery({
    queryKey: ['asistencia', 'detalle', attendanceDayId],
    queryFn: () => api.get<Jornada>('/asistencia/' + attendanceDayId),
    enabled: Boolean(attendanceDayId),
  });

  const j = jornada.data;

  const puntos: PuntoMarcacion[] = [];
  if (j?.checkIn) {
    puntos.push({
      latitude: j.checkIn.latitude,
      longitude: j.checkIn.longitude,
      accuracyMeters: j.checkIn.accuracyMeters,
      distanceMeters: j.checkIn.distanceMeters,
      etiqueta: 'Entrada',
      hora: j.checkIn.localTime,
    });
  }
  if (j?.checkOut) {
    puntos.push({
      latitude: j.checkOut.latitude,
      longitude: j.checkOut.longitude,
      accuracyMeters: j.checkOut.accuracyMeters,
      distanceMeters: j.checkOut.distanceMeters,
      etiqueta: 'Salida',
      hora: j.checkOut.localTime,
    });
  }

  return (
    <>
      {toast.Toast}

      <PageHeader
        title="Detalle de jornada"
        description={j ? j.intern.fullName + ' · ' + fechaLarga(j.businessDate) : undefined}
        actions={
          <>
            <Link to="/asistencia" className="text-sm font-medium text-marca-700 hover:underline">
              Volver
            </Link>
            {j && !j.archived && (
              <Button onClick={() => setModalAbierto(true)}>Regularizar</Button>
            )}
          </>
        }
      />

      {jornada.isLoading && <Loading />}
      {jornada.isError && <ErrorMessage error={jornada.error} onRetry={() => void jornada.refetch()} />}

      {j && (
        <div className="space-y-5">
          {j.archived && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              Esta jornada fue archivada. Su información es de solo lectura; consulte el archivo histórico para las
              fotografías.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Metric label="Estado" value={<EstadoBadge estado={j.status} />} />
            <Metric label="Puntualidad" value={<PuntualidadBadge valor={j.punctuality} />} />
            <Metric
              label="Tardanza"
              value={j.lateMinutes > 0 ? j.lateMinutes + ' min' : '—'}
              tono={j.lateMinutes > 0 ? 'aviso' : 'neutro'}
            />
            <Metric label="Permanencia" value={duracionMinutos(j.workedMinutes)} />
            <Metric
              label="Salida"
              value={j.pendingExit ? 'Pendiente' : j.checkOut ? 'Registrada' : '—'}
              tono={j.pendingExit ? 'aviso' : 'neutro'}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Ubicación de las marcaciones" subtitle={j.site.name}>
              {j.siteGeo ? (
                <>
                  <MapView
                    sede={{
                      latitude: j.siteGeo.latitude,
                      longitude: j.siteGeo.longitude,
                      radiusMeters: j.siteGeo.radiusMeters,
                      nombre: j.site.name,
                    }}
                    puntos={puntos}
                  />
                  <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <dt className="text-slate-500">Radio permitido</dt>
                    <dd className="text-right font-medium text-slate-800">{j.siteGeo.radiusMeters} m</dd>
                    {j.checkIn && (
                      <>
                        <dt className="text-slate-500">Distancia entrada</dt>
                        <dd className="text-right font-medium text-slate-800">{metros(j.checkIn.distanceMeters)}</dd>
                        <dt className="text-slate-500">Precisión entrada</dt>
                        <dd className="text-right text-slate-700">{metros(j.checkIn.accuracyMeters)}</dd>
                        <dt className="text-slate-500">Coordenadas entrada</dt>
                        <dd className="text-right font-mono text-xs text-slate-600">
                          {j.checkIn.latitude.toFixed(6)}, {j.checkIn.longitude.toFixed(6)}
                        </dd>
                      </>
                    )}
                    {j.checkOut && (
                      <>
                        <dt className="text-slate-500">Distancia salida</dt>
                        <dd className="text-right font-medium text-slate-800">{metros(j.checkOut.distanceMeters)}</dd>
                        <dt className="text-slate-500">Precisión salida</dt>
                        <dd className="text-right text-slate-700">{metros(j.checkOut.accuracyMeters)}</dd>
                      </>
                    )}
                  </dl>
                </>
              ) : (
                <p className="text-sm text-slate-500">No hay datos de ubicación para esta jornada.</p>
              )}
            </Card>

            <Card title="Evidencia fotográfica" subtitle="Capturada con la cámara en el momento de marcar">
              <div className="grid gap-4 sm:grid-cols-2">
                <FotoEvidencia titulo="Entrada" marcacion={j.checkIn} />
                <FotoEvidencia titulo="Salida" marcacion={j.checkOut} />
              </div>
            </Card>
          </div>

          <Card
            title="Regularizaciones"
            subtitle={
              j.regularizations.length === 0
                ? 'Esta jornada no ha sido modificada.'
                : j.regularizations.length + ' cambio(s) registrado(s)'
            }
          >
            {j.regularizations.length === 0 ? (
              <p className="text-sm text-slate-500">
                Los datos originales se conservan intactos. Toda correccion queda registrada aquí con su motivo.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {j.regularizations.map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tono="info">{ETIQUETA_CAMPO_REGULARIZACION[r.field] ?? r.field}</Badge>
                      <span className="text-sm text-slate-700">
                        <span className="text-rose-600 line-through">{r.oldValue ?? 'sin valor'}</span>
                        {' → '}
                        <span className="font-medium text-emerald-700">{r.newValue}</span>
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{r.reason}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {r.admin} · {fechaHora(r.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {j && (
        <ModalRegularizar
          abierto={modalAbierto}
          onCerrar={() => setModalAbierto(false)}
          jornada={j}
          onExito={(mensaje) => {
            toast.exito(mensaje);
            setModalAbierto(false);
            void queryClient.invalidateQueries({ queryKey: ['asistencia'] });
          }}
        />
      )}
    </>
  );
}

function FotoEvidencia({ titulo, marcacion }: { titulo: string; marcacion: Jornada['checkIn'] }) {
  const [ampliada, setAmpliada] = useState(false);

  if (!marcacion) {
    return (
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">{titulo}</p>
        <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-400">
          Sin registro
        </div>
      </div>
    );
  }

  const url = marcacion.photoUrl ? resourceUrl(marcacion.photoUrl) : null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">{titulo}</p>
        <span className="text-xs tabular-nums text-slate-500">{marcacion.localTime}</span>
      </div>
      {url ? (
        <>
          <button
            type="button"
            onClick={() => setAmpliada(true)}
            className="block w-full overflow-hidden rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-marca-500"
          >
            <img src={url} alt={'Evidencia de ' + titulo.toLowerCase()} className="h-44 w-full object-cover" loading="lazy" />
          </button>
          <Modal abierto={ampliada} onCerrar={() => setAmpliada(false)} titulo={'Evidencia de ' + titulo.toLowerCase()} ancho="max-w-3xl">
            <img src={url} alt={'Evidencia de ' + titulo.toLowerCase()} className="w-full rounded-lg" />
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="text-slate-500">Hora</dt>
              <dd className="text-right">{fechaHora(marcacion.time)}</dd>
              <dt className="text-slate-500">Distancia a la sede</dt>
              <dd className="text-right">{metros(marcacion.distanceMeters)}</dd>
              <dt className="text-slate-500">Precisión GPS</dt>
              <dd className="text-right">{metros(marcacion.accuracyMeters)}</dd>
            </dl>
            <button
              type="button"
              onClick={() => void apiDownload('/evidencias/' + marcacion.evidenceId + '/descargar')}
              className="mt-4 inline-block text-sm font-medium text-marca-700 hover:underline"
            >
              Descargar original
            </button>
          </Modal>
        </>
      ) : (
        <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-400">
          Evidencia archivada
        </div>
      )}
    </div>
  );
}

function ModalRegularizar({
  abierto,
  onCerrar,
  jornada,
  onExito,
}: {
  abierto: boolean;
  onCerrar: () => void;
  jornada: Jornada;
  onExito: (mensaje: string) => void;
}) {
  const [field, setField] = useState('PUNTUALIDAD');
  const [newValue, setNewValue] = useState('PUNTUAL');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutacion = useMutation({
    mutationFn: () =>
      api.post('/asistencia/' + jornada.id + '/regularizar', { field, newValue, reason }),
    onSuccess: () => {
      setReason('');
      setError(null);
      onExito('Regularización registrada. El dato original quedó conservado.');
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo regularizar.'),
  });

  const cambiarCampo = (valor: string) => {
    setField(valor);
    // Valor por defecto coherente con el campo elegido.
    if (valor === 'PUNTUALIDAD') setNewValue('PUNTUAL');
    else if (valor === 'ESTADO_DIA') setNewValue('PRESENTE');
    else if (valor === 'ENTRADA_HORA') setNewValue(jornada.checkIn?.localTime ?? '08:00');
    else if (valor === 'SALIDA_HORA') setNewValue(jornada.checkOut?.localTime ?? '17:00');
    else setNewValue('');
  };

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Regularizar jornada">
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          El valor original nunca se pierde: queda registrado junto con su nombre, la fecha y el motivo.
        </div>

        <Field label="Campo a corregir" htmlFor="campo">
          <Select id="campo" value={field} onChange={(e) => cambiarCampo(e.target.value)}>
            <option value="PUNTUALIDAD">Puntualidad</option>
            <option value="ESTADO_DIA">Estado del día</option>
            <option value="ENTRADA_HORA" disabled={!jornada.checkIn}>
              Hora de entrada {!jornada.checkIn && '(no hay entrada registrada)'}
            </option>
            <option value="SALIDA_HORA" disabled={!jornada.checkOut}>
              Hora de salida {!jornada.checkOut && '(no hay salida registrada)'}
            </option>
            <option value="JUSTIFICACION">Justificación documental</option>
          </Select>
        </Field>

        <Field label="Nuevo valor" htmlFor="valor">
          {field === 'PUNTUALIDAD' ? (
            <Select id="valor" value={newValue} onChange={(e) => setNewValue(e.target.value)}>
              <option value="PUNTUAL">Puntual</option>
              <option value="TARDANZA">Tardanza</option>
            </Select>
          ) : field === 'ESTADO_Día' ? (
            <Select id="valor" value={newValue} onChange={(e) => setNewValue(e.target.value)}>
              <option value="PRESENTE">Presente</option>
              <option value="AUSENTE">Falta</option>
              <option value="NO_LABORABLE">Sin jornada</option>
            </Select>
          ) : field === 'ENTRADA_HORA' || field === 'SALIDA_HORA' ? (
            <Input id="valor" type="time" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          ) : (
            <Input
              id="valor"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Referencia del documento que justifica"
            />
          )}
        </Field>

        <Field
          label="Motivo (obligatorio)"
          htmlFor="motivo"
          hint="Mínimo 10 caracteres. Quedará asociado al cambio de forma permanente."
        >
          <Textarea
            id="motivo"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej.: El practicante presento constancia medica de atención de emergencia."
          />
        </Field>

        {error && <ErrorMessage error={error} />}

        <div className="flex justify-end gap-2">
          <Button variante="secundario" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button
            onClick={() => mutacion.mutate()}
            cargando={mutacion.isPending}
            disabled={reason.trim().length < 10 || !newValue}
          >
            Aplicar regularización
          </Button>
        </div>
      </div>
    </Modal>
  );
}
