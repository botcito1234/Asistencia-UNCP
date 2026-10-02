import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  useToast,
} from "../components/ui";
import { hoyISO } from "../lib/format";

type Suspension = {
  id: string;
  businessDate: string;
  scope: string;
  reason: string;
  observation: string | null;
  site: { name: string } | null;
  intern: { firstNames: string; lastNames: string } | null;
};

type Intern = { id: string; firstNames: string; lastNames: string };
type Site = { id: string; name: string };

export function Suspensions() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState(hoyISO());
  const [scope, setScope] = useState("SITE");
  const [siteId, setSiteId] = useState("");
  const [internId, setInternId] = useState("");
  const [internIds, setInternIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [observation, setObservation] = useState("");

  const items = useQuery({
    queryKey: ["suspensiones"],
    queryFn: () => api.get<{ items: Suspension[] }>("/suspensiones"),
  });
  const sites = useQuery({
    queryKey: ["sedes"],
    queryFn: () => api.get<Site[]>("/sedes"),
  });
  const interns = useQuery({
    queryKey: ["practicantes", "suspensiones"],
    queryFn: () =>
      api.get<{ items: Intern[] }>("/practicantes", { pageSize: 500 }),
  });
  const createSuspension = useMutation({
    mutationFn: () =>
      api.post("/suspensiones", {
        businessDate: date,
        scope,
        siteId: scope === "SITE" ? siteId : undefined,
        internId: scope === "INTERN" ? internId : undefined,
        internIds: scope === "SELECTED_INTERNS" ? internIds : undefined,
        reason,
        observation: observation || undefined,
      }),
    onSuccess: () => {
      setReason("");
      setObservation("");
      setInternId("");
      setInternIds([]);
      void queryClient.invalidateQueries({ queryKey: ["suspensiones"] });
      toast.exito("Suspensión programada correctamente.");
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo programar la suspensión.",
      ),
  });

  const submitDisabled =
    !reason ||
    (scope === "SITE" && !siteId) ||
    (scope === "INTERN" && !internId) ||
    (scope === "SELECTED_INTERNS" && internIds.length === 0) ||
    createSuspension.isPending;

  return (
    <div className="space-y-6">
      {toast.Toast}
      <PageHeader
        title="Suspensiones"
        description="Programa jornadas suspendidas y evita faltas o salidas pendientes."
      />

      <Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Fecha" htmlFor="susp-fecha">
            <Input
              id="susp-fecha"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field label="Alcance" htmlFor="susp-alcance">
            <Select
              id="susp-alcance"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value="SITE">Sede</option>
              <option value="INTERN">Practicante</option>
              <option value="SELECTED_INTERNS">Seleccionados</option>
            </Select>
          </Field>

          {scope === "SITE" && (
            <Field label="Sede" htmlFor="susp-sede">
              <Select
                id="susp-sede"
                value={siteId}
                onChange={(event) => setSiteId(event.target.value)}
              >
                <option value="">Seleccione</option>
                {(sites.data ?? []).map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </Select>
              {sites.isError && (
                <ErrorMessage
                  error={sites.error}
                  onRetry={() => void sites.refetch()}
                />
              )}
            </Field>
          )}

          {scope === "INTERN" && (
            <Field label="Practicante" htmlFor="susp-practicante">
              <Select
                id="susp-practicante"
                value={internId}
                onChange={(event) => setInternId(event.target.value)}
              >
                <option value="">Seleccione</option>
                {(interns.data?.items ?? []).map((intern) => (
                  <option key={intern.id} value={intern.id}>
                    {intern.lastNames}, {intern.firstNames}
                  </option>
                ))}
              </Select>
              {interns.isError && (
                <ErrorMessage
                  error={interns.error}
                  onRetry={() => void interns.refetch()}
                />
              )}
            </Field>
          )}

          {scope === "SELECTED_INTERNS" && (
            <fieldset>
              <legend className="mb-1 block text-sm font-medium text-slate-700">
                Practicantes seleccionados
              </legend>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {(interns.data?.items ?? []).map((intern) => {
                  const checked = internIds.includes(intern.id);
                  return (
                    <label
                      key={intern.id}
                      className="nexora-interactive flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-marca-700 focus:ring-marca-500"
                        checked={checked}
                        onChange={() =>
                          setInternIds((actuales) =>
                            checked
                              ? actuales.filter((id) => id !== intern.id)
                              : [...actuales, intern.id],
                          )
                        }
                      />
                      <span className="text-sm text-slate-700">
                        {intern.lastNames}, {intern.firstNames}
                      </span>
                    </label>
                  );
                })}
                {(interns.data?.items.length ?? 0) === 0 && (
                  <p className="p-2 text-sm text-slate-500">
                    No hay practicantes disponibles.
                  </p>
                )}
              </div>
              {interns.isError && (
                <ErrorMessage
                  error={interns.error}
                  onRetry={() => void interns.refetch()}
                />
              )}
            </fieldset>
          )}

          <Field label="Motivo" htmlFor="susp-motivo">
            <Input
              id="susp-motivo"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Motivo de la suspensión"
            />
          </Field>
          <Field label="Observación" htmlFor="susp-observacion">
            <Input
              id="susp-observacion"
              value={observation}
              onChange={(event) => setObservation(event.target.value)}
            />
          </Field>
        </div>
        <div className="mt-4">
          <Button
            disabled={submitDisabled}
            onClick={() => createSuspension.mutate()}
          >
            {createSuspension.isPending
              ? "Guardando..."
              : "Programar suspensión"}
          </Button>
        </div>
        {createSuspension.isError && (
          <div className="mt-3">
            <ErrorMessage
              error={createSuspension.error}
              onRetry={() => createSuspension.reset()}
            />
          </div>
        )}
      </Card>

      {items.isLoading && <Loading />}
      {items.isError ? (
        <ErrorMessage
          error={items.error}
          onRetry={() => void items.refetch()}
        />
      ) : items.data ? (
        <Card>
          {(items.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              titulo="No hay suspensiones programadas"
              descripcion="Las suspensiones que registres aparecerán aquí para su seguimiento."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Alcance</th>
                    <th className="px-3 py-2">Ámbito</th>
                    <th className="px-3 py-2">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {(items.data?.items ?? []).map((suspension) => (
                    <tr key={suspension.id} className="border-b">
                      <td className="px-3 py-2">{suspension.businessDate}</td>
                      <td className="px-3 py-2">{suspension.scope}</td>
                      <td className="px-3 py-2">
                        {suspension.site?.name ??
                          (suspension.intern
                            ? `${suspension.intern.lastNames}, ${suspension.intern.firstNames}`
                            : "Seleccionados")}
                      </td>
                      <td className="px-3 py-2">{suspension.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
