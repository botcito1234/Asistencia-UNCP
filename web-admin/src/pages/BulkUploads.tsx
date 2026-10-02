import { useRef, useState } from "react";
import { api } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  ErrorMessage,
  PageHeader,
  Table,
  Td,
  Th,
} from "../components/ui";
import type {
  CargaMasivaError,
  CargaMasivaPreview,
  CargaMasivaResultado,
} from "../lib/types";

function csvCell(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

function descargarCredenciales(resultado: CargaMasivaResultado): void {
  const rows = [
    ["DNI", "Practicante", "Sede", "Contraseña temporal"],
    ...resultado.credentials.map((credential) => [
      credential.dni,
      credential.fullName,
      credential.siteCode,
      credential.temporaryPassword,
    ]),
  ];
  const csv =
    "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `credenciales-carga-${resultado.batchId.slice(0, 8)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function BulkUploads() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<CargaMasivaPreview | null>(null);
  const [resultado, setResultado] = useState<CargaMasivaResultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const seleccionarArchivo = (file: File | null) => {
    setArchivo(file);
    setPreview(null);
    setResultado(null);
    setError(null);
  };

  const enviar = async (modo: "preview" | "commit") => {
    if (!archivo) {
      setError("Selecciona un archivo Excel .xlsx para continuar.");
      return;
    }
    setCargando(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("archivo", archivo);
      if (modo === "preview") {
        setPreview(
          await api.upload<CargaMasivaPreview>(
            "/cargas-masivas/practicantes/preview",
            form,
          ),
        );
        setResultado(null);
      } else {
        setResultado(
          await api.upload<CargaMasivaResultado>(
            "/cargas-masivas/practicantes/commit",
            form,
          ),
        );
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setCargando(false);
    }
  };

  const erroresVisibles: CargaMasivaError[] =
    preview?.errors.slice(0, 80) ?? [];
  const puedeConfirmar = Boolean(
    preview && preview.errors.length === 0 && preview.rows.length > 0,
  );

  return (
    <div className="nexora-page-enter">
      <PageHeader
        title="Cargas masivas"
        description="Incorpora practicantes desde Excel con validación previa y trazabilidad."
        actions={
          <a
            href="/plantillas/plantilla-carga-masiva-practicantes.xlsx"
            download
            className="nexora-interactive inline-flex items-center justify-center rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-marca-700 ring-1 ring-inset ring-marca-200 hover:bg-marca-50"
          >
            Descargar plantilla Excel
          </a>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="space-y-5">
          <Card
            title="1. Prepara tu archivo"
            subtitle="La plantilla ya contiene los encabezados y ejemplos admitidos."
          >
            <ol className="space-y-3 text-sm text-slate-600">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marca-50 font-semibold text-marca-700">
                  1
                </span>
                <span>
                  Completa la hoja <strong>Practicantes</strong>, una fila por
                  persona.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marca-50 font-semibold text-marca-700">
                  2
                </span>
                <span>
                  Usa el código exacto de una sede activa y horarios en formato{" "}
                  <strong>HH:mm</strong>.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marca-50 font-semibold text-marca-700">
                  3
                </span>
                <span>
                  Elimina las filas de ejemplo antes de subir el archivo.
                </span>
              </li>
            </ol>
            <div className="mt-5 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-800">
              La importación no acepta contraseñas en Excel: NEXORA genera una
              temporal por practicante y la muestra una sola vez después de
              confirmar.
            </div>
          </Card>

          <Card
            title="2. Valida el archivo"
            subtitle="La validación consulta sedes y DNIs existentes sin crear registros."
          >
            <label
              className="block text-sm font-medium text-slate-700"
              htmlFor="archivo-carga-masiva"
            >
              Archivo Excel (.xlsx)
            </label>
            <input
              ref={inputRef}
              id="archivo-carga-masiva"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="mt-2 block w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-marca-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:border-marca-400"
              onChange={(event) =>
                seleccionarArchivo(event.target.files?.[0] ?? null)
              }
            />
            {archivo && (
              <p className="mt-2 text-xs text-slate-500">
                Seleccionado: {archivo.name}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void enviar("preview")}
                cargando={cargando}
                disabled={!archivo}
              >
                Validar archivo
              </Button>
              <Button
                type="button"
                variante="secundario"
                onClick={() => {
                  seleccionarArchivo(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
                disabled={!archivo && !preview}
              >
                Limpiar
              </Button>
            </div>
          </Card>

          {error !== null && <ErrorMessage error={error} />}
        </div>

        <div className="space-y-5">
          {preview && (
            <Card
              title="Resultado de validación"
              subtitle="Revisa el detalle antes de confirmar la creación de cuentas."
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Filas leídas
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">
                    {preview.summary.totalRows}
                  </p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-emerald-700">
                    Listas
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-emerald-700">
                    {preview.summary.validRows}
                  </p>
                </div>
                <div className="rounded-lg bg-rose-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-rose-700">
                    Con errores
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-rose-700">
                    {preview.summary.errorRows}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                {puedeConfirmar ? (
                  <Badge tono="exito">Archivo listo para importar</Badge>
                ) : (
                  <Badge tono="peligro">
                    Corrige los errores antes de continuar
                  </Badge>
                )}
                <Button
                  type="button"
                  onClick={() => void enviar("commit")}
                  cargando={cargando}
                  disabled={!puedeConfirmar}
                >
                  Confirmar importación
                </Button>
              </div>
              {erroresVisibles.length > 0 && (
                <div className="mt-5 overflow-hidden rounded-lg border border-rose-200">
                  <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
                    Detalle de errores
                  </div>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Fila</Th>
                        <Th>Campo</Th>
                        <Th>Problema</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {erroresVisibles.map((item, index) => (
                        <tr key={`${item.rowNumber}-${item.field}-${index}`}>
                          <Td>{item.rowNumber}</Td>
                          <Td>{item.field}</Td>
                          <Td className="whitespace-normal text-rose-700">
                            {item.message}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {preview.errors.length > erroresVisibles.length && (
                    <p className="px-4 py-2 text-xs text-slate-500">
                      Se muestran los primeros {erroresVisibles.length} errores.
                    </p>
                  )}
                </div>
              )}
              {preview.errors.length === 0 && preview.rows.length > 0 && (
                <p className="mt-4 text-sm text-slate-600">
                  Se crearán {preview.rows.length} practicantes y sus horarios
                  iniciales en una sola operación.
                </p>
              )}
            </Card>
          )}

          {resultado && (
            <Card
              title="Importación completada"
              subtitle={`Lote ${resultado.batchId}`}
            >
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Guarda o descarga estas credenciales ahora. Las contraseñas
                temporales no volverán a mostrarse y cada practicante deberá
                cambiarlas al iniciar sesión.
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <Badge tono="exito">
                  {resultado.importedCount} practicantes importados
                </Badge>
                <Button
                  type="button"
                  variante="secundario"
                  onClick={() => descargarCredenciales(resultado)}
                >
                  Descargar credenciales CSV
                </Button>
              </div>
              <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
                <Table>
                  <thead>
                    <tr>
                      <Th>DNI</Th>
                      <Th>Practicante</Th>
                      <Th>Sede</Th>
                      <Th>Temporal</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {resultado.credentials.map((credential) => (
                      <tr key={credential.dni}>
                        <Td>{credential.dni}</Td>
                        <Td>{credential.fullName}</Td>
                        <Td>{credential.siteCode}</Td>
                        <Td className="font-mono text-xs">
                          {credential.temporaryPassword}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Card>
          )}

          {!preview && !resultado && (
            <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              Selecciona una plantilla completada y pulsa{" "}
              <strong className="mx-1 text-slate-700">Validar archivo</strong>{" "}
              para comenzar.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
