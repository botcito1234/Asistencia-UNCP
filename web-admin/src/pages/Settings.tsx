/**
 * Parametros operativos.
 *
 * Estos valores gobiernan reglas de negocio reales (ventana de entrada,
 * precision GPS exigida, retencion). Cambiarlos afecta a todas las sedes desde
 * el momento del guardado y queda auditado.
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  Card,
  PageHeader,
  Loading,
  ErrorMessage,
  Input,
  Field,
  Button,
  Badge,
  useToast,
} from '../components/ui';
import type { Parametros } from '../lib/types';

interface RespuestaParametros {
  parametros: Parametros;
  canales: {
    inApp: boolean;
    tiempoReal: { activo: boolean; suscriptores: number };
    push: boolean;
    correo: boolean;
  };
}

export function Settings() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Parametros | null>(null);

  const datos = useQuery({
    queryKey: ['parametros'],
    queryFn: () => api.get<RespuestaParametros>('/parametros'),
  });

  useEffect(() => {
    if (datos.data) setForm(datos.data.parametros);
  }, [datos.data]);

  const guardar = useMutation({
    mutationFn: (valores: Parametros) => api.patch<Parametros>('/parametros', valores),
    onSuccess: () => {
      toast.exito('Parámetros actualizados. El cambio queda registrado en la auditoría.');
      void queryClient.invalidateQueries({ queryKey: ['parametros'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'No se pudieron guardar los parámetros.'),
  });

  return (
    <>
      {toast.Toast}

      <PageHeader title="Parámetros operativos" description="Reglas configurables sin desplegar código" />

      {datos.isLoading && <Loading />}
      {datos.isError && <ErrorMessage error={datos.error} onRetry={() => void datos.refetch()} />}

      {form && datos.data && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card title="Reglas de marcación">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Ventana anticipada (minutos)"
                  htmlFor="p-ventana"
                  hint="Minutos antes de la hora programada en que ya se puede marcar. Valor de negocio: 15."
                >
                  <Input
                    id="p-ventana"
                    type="number"
                    min={0}
                    max={180}
                    value={form.checkinEarlyWindowMinutes}
                    onChange={(e) => setForm({ ...form, checkinEarlyWindowMinutes: Number(e.target.value) })}
                  />
                </Field>

                <Field
                  label="Precisión GPS máxima (metros)"
                  htmlFor="p-precision"
                  hint="Por encima de este valor la marcación se rechaza. Con geocerca de 50 m, 35 es el techo razonable."
                >
                  <Input
                    id="p-precision"
                    type="number"
                    min={5}
                    max={200}
                    value={form.gpsMaxAccuracyMeters}
                    onChange={(e) => setForm({ ...form, gpsMaxAccuracyMeters: Number(e.target.value) })}
                  />
                </Field>

                <Field
                  label="Antiguedad máxima de la lectura (segundos)"
                  htmlFor="p-edad"
                  hint="Evita que se reutilice una posición obtenida hace rato."
                >
                  <Input
                    id="p-edad"
                    type="number"
                    min={5}
                    max={600}
                    value={form.gpsMaxAgeSeconds}
                    onChange={(e) => setForm({ ...form, gpsMaxAgeSeconds: Number(e.target.value) })}
                  />
                </Field>

                <Field
                  label="Radio por defecto de una sede nueva (metros)"
                  htmlFor="p-radio"
                  hint="No cambia las sedes ya creadas."
                >
                  <Input
                    id="p-radio"
                    type="number"
                    min={10}
                    max={2000}
                    value={form.defaultSiteRadiusMeters}
                    onChange={(e) => setForm({ ...form, defaultSiteRadiusMeters: Number(e.target.value) })}
                  />
                </Field>

                <Field
                  label="Desfase de reloj tolerado (segundos)"
                  htmlFor="p-reloj"
                  hint="La hora oficial siempre es la del servidor; esto solo controla cuando se levanta una alerta."
                >
                  <Input
                    id="p-reloj"
                    type="number"
                    min={30}
                    max={3600}
                    value={form.maxDeviceClockSkewSeconds}
                    onChange={(e) => setForm({ ...form, maxDeviceClockSkewSeconds: Number(e.target.value) })}
                  />
                </Field>

                <Field
                  label="Hora de cierre de jornada"
                  htmlFor="p-cierre"
                  hint="Hora local de cada sede a la que se calculan faltas y salidas pendientes."
                >
                  <Input
                    id="p-cierre"
                    type="time"
                    value={form.dayCloseLocalTime}
                    onChange={(e) => setForm({ ...form, dayCloseLocalTime: e.target.value })}
                  />
                </Field>
              </div>
            </Card>

            <Card title="Retención y privacidad">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Meses de retención operativa"
                  htmlFor="p-retencion"
                  hint="Pasado este plazo, la información se archiva automáticamente."
                >
                  <Input
                    id="p-retencion"
                    type="number"
                    min={1}
                    max={120}
                    value={form.retentionMonths}
                    onChange={(e) => setForm({ ...form, retentionMonths: Number(e.target.value) })}
                  />
                </Field>

                <Field
                  label="Versión de la política de privacidad"
                  htmlFor="p-politica"
                  hint="Al subir la versión, los practicantes deberán aceptarla de nuevo."
                >
                  <Input
                    id="p-politica"
                    value={form.privacyPolicyVersion}
                    onChange={(e) => setForm({ ...form, privacyPolicyVersion: e.target.value })}
                  />
                </Field>
              </div>
            </Card>

            <div className="flex justify-end gap-2">
              <Button variante="secundario" onClick={() => setForm(datos.data.parametros)}>
                Descartar cambios
              </Button>
              <Button onClick={() => guardar.mutate(form)} cargando={guardar.isPending}>
                Guardar parámetros
              </Button>
            </div>
          </div>

          <div className="space-y-5">
            <Card title="Canales de notificación">
              <ul className="space-y-3 text-sm">
                <li className="flex items-center justify-between">
                  <span className="text-slate-600">En la aplicación y el panel</span>
                  <Badge tono="exito">Activo</Badge>
                </li>
                <li className="flex items-center justify-between">
                  <span className="text-slate-600">Tiempo real (SSE)</span>
                  <Badge tono={datos.data.canales.tiempoReal.activo ? 'exito' : 'neutro'}>
                    {datos.data.canales.tiempoReal.suscriptores} conectado(s)
                  </Badge>
                </li>
                <li className="flex items-center justify-between">
                  <span className="text-slate-600">Push (Firebase)</span>
                  <Badge tono={datos.data.canales.push ? 'exito' : 'aviso'}>
                    {datos.data.canales.push ? 'Activo' : 'Sin credenciales'}
                  </Badge>
                </li>
                <li className="flex items-center justify-between">
                  <span className="text-slate-600">Correo (SMTP)</span>
                  <Badge tono={datos.data.canales.correo ? 'exito' : 'aviso'}>
                    {datos.data.canales.correo ? 'Activo' : 'Sin credenciales'}
                  </Badge>
                </li>
              </ul>
              <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                Los canales externos se configuran en el archivo <code className="rounded bg-slate-100 px-1">.env</code> del
                servidor. Sin ellos las alertas siguen llegando aquí y a la aplicación móvil.
              </p>
            </Card>

            <Card title="Como afectan estos valores">
              <ul className="space-y-3 text-sm text-slate-600">
                <li>
                  <strong className="text-slate-800">Ventana anticipada.</strong> Con 15 y entrada a las 08:00, se puede
                  marcar desde las 07:45. Entre 07:45 y 08:00 es puntual; a partir de 08:01, tardanza.
                </li>
                <li>
                  <strong className="text-slate-800">Precisión GPS.</strong> El limite efectivo de cada sede es el menor
                  entre este valor y el 70 % de su radio, para que estar "dentro" siga siendo verificable.
                </li>
                <li>
                  <strong className="text-slate-800">Retencion.</strong> El barrido automático se ejecuta el día 2 de
                  cada mes y solo libera espacio después de verificar la copia historica.
                </li>
              </ul>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
