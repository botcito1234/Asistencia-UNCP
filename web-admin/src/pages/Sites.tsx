/**
 * Sedes y sus geocercas.
 * Una sede nunca se elimina: se desactiva, porque su historial de asistencia
 * debe seguir siendo consultable.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { numero } from '../lib/format';
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
  Field,
  Button,
  Badge,
  Modal,
  useToast,
} from '../components/ui';
import { SitePickerMap } from '../components/MapView';
import type { Sede } from '../lib/types';

const CENTRO_POR_DEFECTO = { lat: -12.046374, lng: -77.042793 };

export function Sites() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<Sede | null>(null);
  const [creando, setCreando] = useState(false);

  const sedes = useQuery({
    queryKey: ['sedes', 'todas'],
    queryFn: () => api.get<Sede[]>('/sedes', { includeInactive: 'true', withCounts: 'true' }),
  });

  const desactivar = useMutation({
    mutationFn: (id: string) => api.delete('/sedes/' + id),
    onSuccess: () => {
      toast.exito('Sede desactivada. Su historial sigue disponible.');
      void queryClient.invalidateQueries({ queryKey: ['sedes'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'No se pudo desactivar la sede.'),
  });

  return (
    <>
      {toast.Toast}

      <PageHeader
        title="Sedes"
        description="Ubicación, radio de geocerca y estado"
        actions={<Button onClick={() => setCreando(true)}>Registrar sede</Button>}
      />

      <Card>
        {sedes.isLoading && <Loading />}
        {sedes.isError && <ErrorMessage error={sedes.error} onRetry={() => void sedes.refetch()} />}

        {sedes.data && sedes.data.length === 0 && (
          <EmptyState
            titulo="Sin sedes registradas"
            descripcion="Registre la primera sede indicando su ubicación y el radio permitido."
            accion={<Button onClick={() => setCreando(true)}>Registrar sede</Button>}
          />
        )}

        {sedes.data && sedes.data.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Codigo</Th>
                <Th>Nombre</Th>
                <Th>Direccion</Th>
                <Th align="right">Radio</Th>
                <Th align="right">Practicantes</Th>
                <Th>Coordenadas</Th>
                <Th align="center">Estado</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sedes.data.map((s) => (
                <tr key={s.id} className={'hover:bg-slate-50 ' + (s.active ? '' : 'opacity-60')}>
                  <Td className="font-mono text-xs">{s.code}</Td>
                  <Td>
                    <Link to={'/sedes/' + s.id} className="font-medium text-marca-700 hover:underline">
                      {s.name}
                    </Link>
                  </Td>
                  <Td className="max-w-xs truncate">{s.address}</Td>
                  <Td align="right" className="tabular-nums">{s.radiusMeters} m</Td>
                  <Td align="right" className="tabular-nums">{numero(s.internCount ?? 0)}</Td>
                  <Td className="font-mono text-xs text-slate-500">
                    {s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}
                  </Td>
                  <Td align="center">
                    {s.active ? <Badge tono="exito">Activa</Badge> : <Badge tono="neutro">Inactiva</Badge>}
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setEditando(s)}
                        className="text-sm font-medium text-marca-700 hover:underline"
                      >
                        Editar
                      </button>
                      {s.active && (
                        <button
                          type="button"
                          onClick={() => desactivar.mutate(s.id)}
                          className="text-sm font-medium text-rose-600 hover:underline"
                        >
                          Desactivar
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ModalSede
        abierto={creando || editando !== null}
        sede={editando}
        onCerrar={() => {
          setCreando(false);
          setEditando(null);
        }}
        onExito={(m) => {
          toast.exito(m);
          setCreando(false);
          setEditando(null);
          void queryClient.invalidateQueries({ queryKey: ['sedes'] });
        }}
      />
    </>
  );
}

function ModalSede({
  abierto,
  sede,
  onCerrar,
  onExito,
}: {
  abierto: boolean;
  sede: Sede | null;
  onCerrar: () => void;
  onExito: (mensaje: string) => void;
}) {
  const esEdicion = sede !== null;
  const [form, setForm] = useState({
    code: sede?.code ?? '',
    name: sede?.name ?? '',
    address: sede?.address ?? '',
    latitude: sede?.latitude ?? CENTRO_POR_DEFECTO.lat,
    longitude: sede?.longitude ?? CENTRO_POR_DEFECTO.lng,
    radiusMeters: sede?.radiusMeters ?? 50,
    timezone: sede?.timezone ?? 'America/Lima',
    active: sede?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);

  // Al abrir con otra sede hay que refrescar el formulario.
  const [ultimaSede, setUltimaSede] = useState<string | null>(sede?.id ?? null);
  if ((sede?.id ?? null) !== ultimaSede) {
    setUltimaSede(sede?.id ?? null);
    setForm({
      code: sede?.code ?? '',
      name: sede?.name ?? '',
      address: sede?.address ?? '',
      latitude: sede?.latitude ?? CENTRO_POR_DEFECTO.lat,
      longitude: sede?.longitude ?? CENTRO_POR_DEFECTO.lng,
      radiusMeters: sede?.radiusMeters ?? 50,
      timezone: sede?.timezone ?? 'America/Lima',
      active: sede?.active ?? true,
    });
    setError(null);
  }

  const guardar = useMutation({
    mutationFn: () => (esEdicion ? api.patch('/sedes/' + sede.id, form) : api.post('/sedes', form)),
    onSuccess: () => onExito(esEdicion ? 'Sede actualizada.' : 'Sede registrada.'),
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo guardar la sede.'),
  });

  const usarUbicacionActual = () => {
    if (!navigator.geolocation) {
      setError('Este navegador no permite obtener la ubicación.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setForm((f) => ({
          ...f,
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
        })),
      () => setError('No se pudo obtener la ubicación del navegador.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo={esEdicion ? 'Editar sede' : 'Registrar sede'} ancho="max-w-2xl">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Código" htmlFor="s-codigo" hint="Letras mayúsculas, números, guion.">
            <Input
              id="s-codigo"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="SEDE-01"
              maxLength={30}
            />
          </Field>
          <Field label="Nombre" htmlFor="s-nombre">
            <Input id="s-nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
        </div>

        <Field label="Direccion" htmlFor="s-direccion">
          <Input id="s-direccion" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Latitud" htmlFor="s-lat">
            <Input
              id="s-lat"
              type="number"
              step="0.000001"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: Number(e.target.value) })}
            />
          </Field>
          <Field label="Longitud" htmlFor="s-lng">
            <Input
              id="s-lng"
              type="number"
              step="0.000001"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: Number(e.target.value) })}
            />
          </Field>
          <Field label="Radio (metros)" htmlFor="s-radio" hint="Entre 10 y 2000. Valor de negocio: 50.">
            <Input
              id="s-radio"
              type="number"
              min={10}
              max={2000}
              value={form.radiusMeters}
              onChange={(e) => setForm({ ...form, radiusMeters: Number(e.target.value) })}
            />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Ubicación en el mapa</p>
            <button type="button" onClick={usarUbicacionActual} className="text-sm font-medium text-marca-700 hover:underline">
              Usar mi ubicación actual
            </button>
          </div>
          <SitePickerMap
            latitude={form.latitude}
            longitude={form.longitude}
            radiusMeters={form.radiusMeters}
            onChange={(lat, lng) => setForm({ ...form, latitude: lat, longitude: lng })}
          />
          <p className="mt-2 text-xs text-slate-500">
            Arrastre el marcador hasta la entrada de la sede. El circulo muestra el área donde se podra marcar.
          </p>
        </div>

        {esEdicion && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-marca-700 focus:ring-marca-500"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Sede activa
          </label>
        )}

        {error && <ErrorMessage error={error} />}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variante="secundario" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button
            onClick={() => guardar.mutate()}
            cargando={guardar.isPending}
            disabled={!form.code || !form.name || !form.address}
          >
            {esEdicion ? 'Guardar cambios' : 'Registrar sede'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
