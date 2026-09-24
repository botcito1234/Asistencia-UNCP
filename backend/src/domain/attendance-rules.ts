/**
 * Reglas de negocio de la marcacion. Funciones puras.
 *
 * Contrato de negocio implementado aqui:
 *  - Se puede marcar entrada como maximo N minutos antes de la hora programada
 *    (N configurable, valor de negocio: 15).
 *  - Desde (hora - N) hasta la hora programada inclusive -> PUNTUAL.
 *  - Despues de la hora programada -> TARDANZA. No hay tolerancia adicional.
 *  - Una llegada tardia sigue siendo valida durante todo el dia: no se bloquea
 *    el ingreso por haber pasado la hora.
 *  - Si la jornada termina sin entrada -> AUSENTE.
 *  - Si hubo entrada y no hubo salida al cerrar el dia -> SALIDA PENDIENTE.
 */

export type Punctuality = 'PUNTUAL' | 'TARDANZA';

export interface CheckInWindowInput {
  /** Minutos desde medianoche local en que ocurre el intento. */
  nowMinutes: number;
  /** Hora de entrada programada, en minutos desde medianoche local. */
  scheduledStartMinute: number;
  /** Ventana anticipada permitida, en minutos. */
  earlyWindowMinutes: number;
}

export type CheckInWindowDecision =
  | { allowed: false; reason: 'DEMASIADO_TEMPRANO'; opensAtMinute: number; minutesUntilOpen: number }
  | { allowed: true; punctuality: Punctuality; lateMinutes: number; opensAtMinute: number };

export function evaluateCheckInWindow(input: CheckInWindowInput): CheckInWindowDecision {
  const { nowMinutes, scheduledStartMinute, earlyWindowMinutes } = input;
  const opensAtMinute = scheduledStartMinute - earlyWindowMinutes;

  if (nowMinutes < opensAtMinute) {
    return {
      allowed: false,
      reason: 'DEMASIADO_TEMPRANO',
      opensAtMinute,
      minutesUntilOpen: opensAtMinute - nowMinutes,
    };
  }

  if (nowMinutes <= scheduledStartMinute) {
    return { allowed: true, punctuality: 'PUNTUAL', lateMinutes: 0, opensAtMinute };
  }

  return {
    allowed: true,
    punctuality: 'TARDANZA',
    lateMinutes: nowMinutes - scheduledStartMinute,
    opensAtMinute,
  };
}

// ---------------------------------------------------------------------------
// Validacion de la lectura GPS
// ---------------------------------------------------------------------------

export interface LocationQualityInput {
  accuracyMeters: number;
  /** Antiguedad de la lectura en milisegundos. */
  locationAgeMs?: number | null;
  mockLocationReported: boolean;
  maxAccuracyMeters: number;
  maxAgeSeconds: number;
}

export type LocationQualityDecision =
  | { ok: true }
  | { ok: false; reason: 'UBICACION_SIMULADA' }
  | { ok: false; reason: 'GPS_IMPRECISO'; accuracyMeters: number; maxAccuracyMeters: number }
  | { ok: false; reason: 'GPS_OBSOLETO'; ageSeconds: number; maxAgeSeconds: number };

/**
 * El orden importa: la ubicacion simulada se evalua primero porque es un
 * incidente de seguridad, no un problema de calidad de senal.
 */
export function evaluateLocationQuality(input: LocationQualityInput): LocationQualityDecision {
  if (input.mockLocationReported) {
    return { ok: false, reason: 'UBICACION_SIMULADA' };
  }

  if (!Number.isFinite(input.accuracyMeters) || input.accuracyMeters < 0) {
    return { ok: false, reason: 'GPS_IMPRECISO', accuracyMeters: -1, maxAccuracyMeters: input.maxAccuracyMeters };
  }

  if (input.accuracyMeters > input.maxAccuracyMeters) {
    return {
      ok: false,
      reason: 'GPS_IMPRECISO',
      accuracyMeters: input.accuracyMeters,
      maxAccuracyMeters: input.maxAccuracyMeters,
    };
  }

  if (input.locationAgeMs !== null && input.locationAgeMs !== undefined) {
    const ageSeconds = Math.round(input.locationAgeMs / 1000);
    if (ageSeconds > input.maxAgeSeconds) {
      return { ok: false, reason: 'GPS_OBSOLETO', ageSeconds, maxAgeSeconds: input.maxAgeSeconds };
    }
  }

  return { ok: true };
}

/**
 * Precision efectiva maxima tolerable para que una geocerca de R metros siga
 * teniendo sentido. Si la incertidumbre del GPS es comparable al radio, estar
 * "dentro" deja de ser verificable.
 *
 * Criterio adoptado: la precision no debe superar el 70% del radio, con un
 * techo absoluto configurable. Para R = 50 m esto da 35 m.
 */
export function maxUsableAccuracyForRadius(radiusMeters: number, absoluteCapMeters: number): number {
  return Math.min(absoluteCapMeters, Math.max(10, Math.round(radiusMeters * 0.7)));
}

// ---------------------------------------------------------------------------
// Cierre de jornada
// ---------------------------------------------------------------------------

export interface DayClosureInput {
  hasCheckIn: boolean;
  hasCheckOut: boolean;
  hasSchedule: boolean;
}

export type DayClosure =
  | { status: 'NO_LABORABLE'; pendingExit: false }
  | { status: 'AUSENTE'; pendingExit: false }
  | { status: 'PRESENTE'; pendingExit: boolean };

export function resolveDayClosure(input: DayClosureInput): DayClosure {
  if (!input.hasSchedule) return { status: 'NO_LABORABLE', pendingExit: false };
  if (!input.hasCheckIn) return { status: 'AUSENTE', pendingExit: false };
  return { status: 'PRESENTE', pendingExit: !input.hasCheckOut };
}

// ---------------------------------------------------------------------------
// Fortaleza de contrasena
// ---------------------------------------------------------------------------

export interface PasswordPolicyResult {
  ok: boolean;
  problems: string[];
}

export function validatePasswordStrength(password: string, minLength: number, dni?: string): PasswordPolicyResult {
  const problems: string[] = [];
  if (password.length < minLength) problems.push('Debe tener al menos ' + minLength + ' caracteres.');
  if (!/[a-z]/.test(password)) problems.push('Debe incluir al menos una letra minuscula.');
  if (!/[A-Z]/.test(password)) problems.push('Debe incluir al menos una letra mayuscula.');
  if (!/[0-9]/.test(password)) problems.push('Debe incluir al menos un número.');
  if (dni && dni.length >= 6 && password.includes(dni)) problems.push('No puede contener el DNI.');
  if (/^(.)\1+$/.test(password)) problems.push('No puede ser un único caracter repetido.');
  return { ok: problems.length === 0, problems };
}
