import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { DocenteConductor, Pagina, Practicante } from "../lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  useToast,
} from "../components/ui";

type AltaRespuesta = {
  conductorId: string;
  dni: string;
  temporaryPassword: string;
};

export function Conductors() {
  const qc = useQueryClient();
  const toast = useToast();
  const [modalAlta, setModalAlta] = useState(false);
  const [credencial, setCredencial] = useState<AltaRespuesta | null>(null);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [practicantesSeleccionados, setPracticantesSeleccionados] = useState<
    string[]
  >([]);
  const [dni, setDni] = useState("");
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [telefono, setTelefono] = useState("");
  const [password, setPassword] = useState("");

  const docentes = useQuery({
    queryKey: ["docentes"],
    queryFn: () => api.get<DocenteConductor[]>("/operacion/docentes"),
  });
  const practicantes = useQuery({
    queryKey: ["practicantes", "asignacion-docente"],
    queryFn: () =>
      api.get<Pagina<Practicante>>("/practicantes", { pageSize: 500 }),
  });

  const alta = useMutation({
    mutationFn: () =>
      api.post<AltaRespuesta>("/operacion/docentes", {
        dni: dni.trim(),
        displayName: nombre.trim(),
        email: correo.trim() || undefined,
        phone: telefono.trim() || undefined,
        password: password.trim() || undefined,
      }),
    onSuccess: (data) => {
      setModalAlta(false);
      setCredencial(data);
      setDni("");
      setNombre("");
      setCorreo("");
      setTelefono("");
      setPassword("");
      void qc.invalidateQueries({ queryKey: ["docentes"] });
      toast.exito("Docente creado correctamente.");
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "No se pudo crear el docente.",
      ),
  });

  const asignar = useMutation({
    mutationFn: () =>
      api.post(`/operacion/docentes/${seleccionado}/asignaciones`, {
        internIds: practicantesSeleccionados,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["docentes"] });
      setPracticantesSeleccionados([]);
      toast.exito("Asignaciones actualizadas.");
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudieron guardar las asignaciones.",
      ),
  });

  const docenteActivo = docentes.data?.find((item) => item.id === seleccionado);
  const idsAsignados = new Set(
    docenteActivo?.assignments
      .filter((a) => !a.revokedAt)
      .map((a) => a.intern.id) ?? [],
  );

  return (
    <>
      {toast.Toast}
      <PageHeader
        title="Docentes conductores"
        description="Crea docentes y define los practicantes que pueden acompañar y reportar."
        actions={
          <Button onClick={() => setModalAlta(true)}>Registrar docente</Button>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <Card
          title="Docentes registrados"
          subtitle="Las asignaciones se conservan para trazabilidad."
        >
          {docentes.isLoading ? (
            <Loading />
          ) : docentes.isError ? (
            <ErrorMessage
              error={docentes.error}
              onRetry={() => void docentes.refetch()}
            />
          ) : docentes.data?.length ? (
            <div className="space-y-3">
              {docentes.data.map((docente) => (
                <button
                  type="button"
                  key={docente.id}
                  onClick={() => {
                    setSeleccionado(docente.id);
                    setPracticantesSeleccionados(
                      docente.assignments
                        .filter((a) => !a.revokedAt)
                        .map((a) => a.intern.id),
                    );
                  }}
                  className={
                    "w-full rounded-lg border p-4 text-left transition " +
                    (seleccionado === docente.id
                      ? "border-marca-500 bg-marca-50/50 ring-1 ring-marca-300"
                      : "border-slate-200 hover:border-slate-300")
                  }
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {docente.user.displayName}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        DNI {docente.user.dni}
                        {docente.user.email ? " · " + docente.user.email : ""}
                      </p>
                    </div>
                    <Badge
                      tono={
                        docente.active && docente.user.status === "ACTIVO"
                          ? "exito"
                          : "neutro"
                      }
                    >
                      {docente.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {docente.assignments.filter((a) => !a.revokedAt).length}{" "}
                    practicante(s) asignado(s)
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              titulo="Aún no hay docentes"
              descripcion="Registra el primer docente conductor para comenzar."
            />
          )}
        </Card>

        <Card
          title="Asignar practicantes"
          subtitle={
            docenteActivo
              ? "Docente: " + docenteActivo.user.displayName
              : "Selecciona un docente de la lista."
          }
        >
          {!docenteActivo ? (
            <EmptyState
              titulo="Sin docente seleccionado"
              descripcion="Elige un docente para administrar su cartera."
            />
          ) : practicantes.isLoading ? (
            <Loading />
          ) : practicantes.isError ? (
            <ErrorMessage
              error={practicantes.error}
              onRetry={() => void practicantes.refetch()}
            />
          ) : (
            <>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-slate-700">
                  Practicantes asignables
                </legend>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {(practicantes.data?.items ?? []).map((intern) => {
                    const checked = practicantesSeleccionados.includes(
                      intern.id,
                    );
                    return (
                      <label
                        key={intern.id}
                        className="nexora-interactive flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-marca-700 focus:ring-marca-500"
                          checked={checked}
                          onChange={() =>
                            setPracticantesSeleccionados((actuales) =>
                              checked
                                ? actuales.filter((id) => id !== intern.id)
                                : [...actuales, intern.id],
                            )
                          }
                        />
                        <span className="min-w-0 text-sm text-slate-700">
                          <span className="block font-medium">
                            {intern.lastNames}, {intern.firstNames}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {intern.site.name}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  {(practicantes.data?.items.length ?? 0) === 0 && (
                    <p className="p-2 text-sm text-slate-500">
                      No hay practicantes disponibles.
                    </p>
                  )}
                </div>
              </fieldset>
              <p className="mt-2 text-xs text-slate-500">
                Selecciona los practicantes con casillas. Guardar reemplaza la
                cartera actual y conserva la historia de revocaciones.
              </p>
              {idsAsignados.size > 0 && (
                <p className="mt-2 text-xs text-slate-600">
                  Asignados actualmente: {idsAsignados.size}
                </p>
              )}
              <Button
                className="mt-4 w-full"
                disabled={asignar.isPending}
                cargando={asignar.isPending}
                onClick={() => asignar.mutate()}
              >
                Guardar asignaciones
              </Button>
            </>
          )}
        </Card>
      </div>

      <Modal
        abierto={modalAlta}
        onCerrar={() => setModalAlta(false)}
        titulo="Registrar docente conductor"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="DNI" htmlFor="doc-dni">
            <Input
              id="doc-dni"
              value={dni}
              onChange={(e) => setDni(e.target.value)}
              inputMode="numeric"
            />
          </Field>
          <Field label="Nombre completo" htmlFor="doc-nombre">
            <Input
              id="doc-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </Field>
          <Field label="Correo" htmlFor="doc-correo">
            <Input
              id="doc-correo"
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
            />
          </Field>
          <Field label="Teléfono" htmlFor="doc-telefono">
            <Input
              id="doc-telefono"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
            />
          </Field>
          <Field
            label="Contraseña inicial"
            htmlFor="doc-password"
            hint="Opcional; si se omite se genera una temporal."
          >
            <Input
              id="doc-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variante="secundario" onClick={() => setModalAlta(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!dni.trim() || !nombre.trim() || alta.isPending}
            cargando={alta.isPending}
            onClick={() => alta.mutate()}
          >
            Crear docente
          </Button>
        </div>
      </Modal>

      <Modal
        abierto={Boolean(credencial)}
        onCerrar={() => setCredencial(null)}
        titulo="Credencial temporal"
        ancho="max-w-md"
      >
        {credencial && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Entrega esta contraseña por un canal seguro. El docente deberá
              cambiarla en su primer ingreso.
            </p>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                DNI
              </p>
              <p className="font-mono text-lg font-semibold text-slate-900">
                {credencial.dni}
              </p>
              <p className="mt-3 text-xs uppercase tracking-wide text-slate-500">
                Contraseña temporal
              </p>
              <p className="font-mono text-lg font-semibold text-slate-900">
                {credencial.temporaryPassword}
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setCredencial(null)}>Listo</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
