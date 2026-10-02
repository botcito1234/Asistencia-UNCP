import { config } from "../../config/env.js";
import { errors } from "../../core/errors.js";

const DNI_PATTERN = /^\d{8}$/;

export interface DniLookupResult {
  dni: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombreCompleto: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function firstText(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return "";
}

function normalizePayload(payload: unknown, dni: string): DniLookupResult | null {
  const root = record(payload);
  const source = record(root.data);
  const data = Object.keys(source).length > 0 ? source : root;
  const nombres = firstText(data, ["nombres", "firstNames"]);
  const apellidoPaterno = firstText(data, ["apellidoPaterno", "apellido_paterno", "ap_paterno"]);
  const apellidoMaterno = firstText(data, ["apellidoMaterno", "apellido_materno", "ap_materno"]);
  const nombreCompleto = firstText(data, ["nombreCompleto", "nombre_completo", "fullName"]);

  if (!nombres && !apellidoPaterno && !apellidoMaterno && !nombreCompleto) return null;

  return {
    dni: firstText(data, ["dni", "numero", "documento"]) || dni,
    nombres,
    apellidoPaterno,
    apellidoMaterno,
    nombreCompleto:
      nombreCompleto || [nombres, apellidoPaterno, apellidoMaterno].filter(Boolean).join(" "),
  };
}

/** Consulta el padrón externo exclusivamente desde el backend. */
export async function lookupDni(dni: string): Promise<DniLookupResult> {
  const normalizedDni = dni.trim();
  if (!DNI_PATTERN.test(normalizedDni)) {
    throw errors.validation("El DNI debe contener exactamente 8 digitos numericos.");
  }
  if (!config.DNI_LOOKUP_ENABLED || !config.DNI_LOOKUP_API_TOKEN) {
    throw errors.dependency("La consulta automatica de DNI no esta configurada.");
  }

  const endpoint = `${config.DNI_LOOKUP_API_URL.replace(/\/$/, "")}/${encodeURIComponent(normalizedDni)}?token=${encodeURIComponent(config.DNI_LOOKUP_API_TOKEN)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.DNI_LOOKUP_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (cause) {
    throw errors.dependency("No se pudo consultar el servicio de DNI.", cause);
  } finally {
    clearTimeout(timeout);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // El proveedor puede devolver una respuesta vacia en un error transitorio.
  }

  if (response.status === 404) throw errors.notFound("El DNI consultado");
  if (!response.ok) {
    throw errors.dependency("El servicio de DNI rechazo la consulta.");
  }

  const result = normalizePayload(payload, normalizedDni);
  if (!result) throw errors.notFound("El DNI consultado");
  return result;
}
