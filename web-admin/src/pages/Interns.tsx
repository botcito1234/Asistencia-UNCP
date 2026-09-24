/**
 * Listado y alta de practicantes.
 *
 * El alta es individual por decision de alcance: no hay importacion masiva.
 * Al crear se devuelve una contrasena temporal que se muestra UNA vez.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { desdeAhora, numero, DIAS_SEMANA } from '../lib/format';
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
import type { Practicante, Pagina, Sede } from '../lib/types';

export function Interns() {
  const [busqueda, setBusqueda] = useState('');
  const [siteId, setSiteId] = useState('');
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [modalAbierto, setModalAbierto] = useState(false);
  const toast = useToast();

  const sedes = useQuery({ queryKey: ['sedes'], queryFn: () => api.get<Sede[]>('/sedes') });

  const practicantes = useQuery({
    queryKey: ['practicantes', busqueda, siteId, incluirInactivos],
    queryFn: () =>
      api.get<Pagina<Practicante>>('/practicantes', {
        search: busqueda || undefined,
        siteId: siteId || undefined,
        includeInactive: incluirInactivos ? 'true' : undefined,
        pageSize: 200,
      }),
  });

  return (
    <>
      {toast.Toast}

      <PageHeader
        title="Practicantes"
        description="Alta individual, horarios, dispositivo vinculado y credenciales"
        actions={<Button onClick={() => setModalAbierto(true)}>Registrar practicante</Button>}
      />

      <Card className="mb-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Buscar" htmlFor="buscar">
            <Input
              id="buscar"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="DNI, nombres, apellidos o área"
            />
          </Field>
          <Field label="Sede" htmlFor="sede">
            <Select id="sede" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="">Todas</option>
              {(sedes.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-marca-700 focus:ring-marca-500"
                checked={incluirInactivos}
                onChange={(e) => setIncluirInactivos(e.target.checked)}
              />
              Incluir inactivos
            </label>
          </div>
        </div>
      </Card>

      <Card title={practicantes.data ? numero(practicantes.data.total) + ' practicante(s)' : 'Listado'}>
        {practicantes.isLoading && <Loading />}
        {practicantes.isError && <ErrorMessage error={practicantes.error} onRetry={() => void practicantes.refetch()} />}

        {practicantes.data && practicantes.data.items.length === 0 && (
          <EmptyState
            titulo="Sin practicantes"
            descripcion="Registre el primer practicante para empezar a controlar su asistencia."
            accion={<Button onClick={() => setModalAbierto(true)}>Registrar practicante</Button>}
          />
        )}

        {practicantes.data && practicantes.data.items.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>DNI</Th>
                <Th>Nombre</Th>
                <Th>Sede</Th>
                <Th>Área / Grupo</Th>
                <Th align="center">Dispositivo</Th>
                <Th>Último acceso</Th>
                <Th align="center">Estado</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {practicantes.data.items.map((p) => (
                <tr key={p.id} className={'hover:bg-slate-50 ' + (p.active ? '' : 'opacity-60')}>
                  <Td className="tabular-nums">{p.dni}</Td>
                  <Td>
                    <Link to={'/practicantes/' + p.id} className="font-medium text-marca-700 hover:underline">
                      {p.fullName}
                    </Link>
                  </Td>
                  <Td>{p.site.name}</Td>
                  <Td>{p.areaGroup ?? '—'}</Td>
                  <Td align="center">
                    {p.hasDevice ? (
                      <Badge tono="exito">{p.deviceModel ?? 'Vinculado'}</Badge>
                    ) : (
                      <Badge tono="neutro">Sin vincular</Badge>
                    )}
                  </Td>
                  <Td>{p.lastLoginAt ? desdeAhora(p.lastLoginAt) : 'Nunca'}</Td>
                  <Td align="center">
                    {p.active ? <Badge tono="exito">Activo</Badge> : <Badge tono="neutro">Inactivo</Badge>}
                  </Td>
                  <Td align="right">
                    <Link to={'/practicantes/' + p.id} className="text-sm font-medium text-marca-700 hover:underline">
                      Ver ficha
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ModalNuevoPracticante
        abierto={modalAbierto}
        onCerrar={() => setModalAbierto(false)}
        sedes={sedes.data ?? []}
        onExito={(mensaje) => toast.exito(mensaje)}
      />
    </>
  );
}

interface FranjaFormulario {
  activo: boolean;
  startTime: string;
  endTime: string;
}

function ModalNuevoPracticante({
  abierto,
  onCerrar,
  sedes,
  onExito,
}: {
  abierto: boolean;
  onCerrar: () => void;
  sedes: Sede[];
  onExito: (mensaje: string) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    dni: '',
    firstNames: '',
    lastNames: '',
    siteId: '',
    areaGroup: '',
    phone: '',
    email: '',
  });
  const [horario, setHorario] = useState<FranjaFormulario[]>(
    DIAS_SEMANA.map((_, i) => ({ activo: i < 5, startTime: '08:00', endTime: '17:00' })),
  );
  const [error, setError] = useState<string | null>(null);
  const [credencial, setCredencial] = useState<{ dni: string; password: string } | null>(null);

  const crear = useMutation({
    mutationFn: () =>
      api.post<{ intern: { dni: string }; temporaryPassword: string }>('/practicantes', {
        ...form,
        email: form.email || null,
        phone: form.phone || null,
        areaGroup: form.areaGroup || null,
        schedule: horario
          .map((h, i) => ({ ...h, weekday: i + 1 }))
          .filter((h) => h.activo)
          .map((h) => ({ weekday: h.weekday, startTime: h.startTime, endTime: h.endTime || null })),
      }),
    onSuccess: (data) => {
      setCredencial({ dni: data.intern.dni, password: data.temporaryPassword });
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['practicantes'] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo registrar el practicante.'),
  });

  const cerrarTodo = () => {
    setCredencial(null);
    setForm({ dni: '', firstNames: '', lastNames: '', siteId: '', areaGroup: '', phone: '', email: '' });
    setError(null);
    onCerrar();
  };

  if (credencial) {
    return (
      <Modal abierto={abierto} onCerrar={cerrarTodo} titulo="Practicante registrado">
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            El practicante fue registrado correctamente.
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-700">Credenciales de acceso</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">DNI (usuario)</dt>
                <dd className="font-mono font-semibold text-slate-900">{credencial.dni}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Contraseña temporal</dt>
                <dd className="font-mono font-semibold text-slate-900">{credencial.password}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Esta contraseña <strong>no se vuelve a mostrar</strong>. Entréguesela al practicante por un canal seguro.
            Deberá cambiarla en su primer inicio de sesión.
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => {
                onExito('Practicante registrado.');
                cerrarTodo();
              }}
            >
              Entendido
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal abierto={abierto} onCerrar={cerrarTodo} titulo="Registrar practicante" ancho="max-w-2xl">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="DNI" htmlFor="n-dni">
            <Input
              id="n-dni"
              inputMode="numeric"
              maxLength={12}
              value={form.dni}
              onChange={(e) => setForm({ ...form, dni: e.target.value.replace(/\D/g, '') })}
              placeholder="12345678"
            />
          </Field>
          <Field label="Sede" htmlFor="n-sede">
            <Select id="n-sede" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              <option value="">Seleccione una sede</option>
              {sedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nombres" htmlFor="n-nombres">
            <Input id="n-nombres" value={form.firstNames} onChange={(e) => setForm({ ...form, firstNames: e.target.value })} />
          </Field>
          <Field label="Apellidos" htmlFor="n-apellidos">
            <Input id="n-apellidos" value={form.lastNames} onChange={(e) => setForm({ ...form, lastNames: e.target.value })} />
          </Field>
          <Field label="Aula / grupo / área" htmlFor="n-area">
            <Input id="n-area" value={form.areaGroup} onChange={(e) => setForm({ ...form, areaGroup: e.target.value })} />
          </Field>
          <Field label="Teléfono" htmlFor="n-telefono">
            <Input id="n-telefono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Correo (opcional)" htmlFor="n-correo">
            <Input id="n-correo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Horario semanal</p>
          <p className="mb-3 text-xs text-slate-500">
            Cada día puede tener una hora de entrada distinta. Se podra marcar desde 15 minutos antes.
          </p>
          <div className="space-y-2">
            {DIAS_SEMANA.map((dia, i) => (
              <div key={dia} className="flex items-center gap-3">
                <label className="flex w-32 items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-marca-700 focus:ring-marca-500"
                    checked={horario[i]!.activo}
                    onChange={(e) => {
                      const copia = [...horario];
                      copia[i] = { ...copia[i]!, activo: e.target.checked };
                      setHorario(copia);
                    }}
                  />
                  {dia}
                </label>
                <Input
                  type="time"
                  disabled={!horario[i]!.activo}
                  value={horario[i]!.startTime}
                  onChange={(e) => {
                    const copia = [...horario];
                    copia[i] = { ...copia[i]!, startTime: e.target.value };
                    setHorario(copia);
                  }}
                  className="w-32"
                  aria-label={'Hora de entrada ' + dia}
                />
                <span className="text-sm text-slate-400">a</span>
                <Input
                  type="time"
                  disabled={!horario[i]!.activo}
                  value={horario[i]!.endTime}
                  onChange={(e) => {
                    const copia = [...horario];
                    copia[i] = { ...copia[i]!, endTime: e.target.value };
                    setHorario(copia);
                  }}
                  className="w-32"
                  aria-label={'Hora de salida referencial ' + dia}
                />
              </div>
            ))}
          </div>
        </div>

        {error && <ErrorMessage error={error} />}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variante="secundario" onClick={cerrarTodo}>
            Cancelar
          </Button>
          <Button
            onClick={() => crear.mutate()}
            cargando={crear.isPending}
            disabled={!form.dni || !form.firstNames || !form.lastNames || !form.siteId}
          >
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
