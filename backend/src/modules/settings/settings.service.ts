/**
 * Parametros operativos configurables en caliente.
 *
 * Los criterios de negocio que el administrador puede ajustar (ventana de
 * entrada, precision GPS exigida, meses de retencion) viven aqui y no dispersos
 * por el codigo: hay una sola fuente de verdad y queda auditado quien los
 * cambio. El archivo .env aporta unicamente el valor inicial.
 */
import { prisma } from '../../infra/db/prisma.js';
import { config } from '../../config/env.js';
import { logger } from '../../core/logger.js';
import { errors } from '../../core/errors.js';

export interface OperationalSettings {
  /** Minutos que se permite marcar antes de la hora programada. */
  checkinEarlyWindowMinutes: number;
  /** Techo absoluto de imprecision GPS aceptada, en metros. */
  gpsMaxAccuracyMeters: number;
  /** Antiguedad maxima de la lectura GPS, en segundos. */
  gpsMaxAgeSeconds: number;
  /** Radio asignado por defecto a una sede nueva. */
  defaultSiteRadiusMeters: number;
  /** Desfase de reloj del telefono tolerado antes de levantar un evento. */
  maxDeviceClockSkewSeconds: number;
  /** Meses que la informacion permanece operativa antes de archivarse. */
  retentionMonths: number;
  /** Hora local de cierre de jornada, formato HH:mm. */
  dayCloseLocalTime: string;
  /** Version vigente de la politica de privacidad que se debe aceptar. */
  privacyPolicyVersion: string;
}

const SETTINGS_KEY = 'operacion';
const CACHE_TTL_MS = 30_000;

let cache: { value: OperationalSettings; expiresAt: number } | null = null;

function defaults(): OperationalSettings {
  return {
    checkinEarlyWindowMinutes: config.CHECKIN_EARLY_WINDOW_MINUTES,
    gpsMaxAccuracyMeters: config.GPS_MAX_ACCURACY_METERS,
    gpsMaxAgeSeconds: config.GPS_MAX_AGE_SECONDS,
    defaultSiteRadiusMeters: config.DEFAULT_SITE_RADIUS_METERS,
    maxDeviceClockSkewSeconds: config.MAX_DEVICE_CLOCK_SKEW_SECONDS,
    retentionMonths: config.RETENTION_MONTHS,
    dayCloseLocalTime: config.DAY_CLOSE_LOCAL_TIME,
    privacyPolicyVersion: config.PRIVACY_POLICY_VERSION,
  };
}

/** Rangos admisibles. Un valor fuera de rango vuelve inoperable la marcacion. */
const LIMITS = {
  checkinEarlyWindowMinutes: [0, 180],
  gpsMaxAccuracyMeters: [5, 200],
  gpsMaxAgeSeconds: [5, 600],
  defaultSiteRadiusMeters: [10, 2000],
  maxDeviceClockSkewSeconds: [30, 3600],
  retentionMonths: [1, 120],
} as const;

function sanitize(raw: Partial<OperationalSettings>): OperationalSettings {
  const base = defaults();
  const merged: OperationalSettings = { ...base, ...raw };

  for (const [key, [min, max]] of Object.entries(LIMITS) as [keyof typeof LIMITS, readonly [number, number]][]) {
    const v = merged[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      merged[key] = base[key];
    }
  }
  if (!/^\d{2}:\d{2}$/.test(merged.dayCloseLocalTime)) merged.dayCloseLocalTime = base.dayCloseLocalTime;
  return merged;
}

export async function getSettings(): Promise<OperationalSettings> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  try {
    const row = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
    const value = sanitize((row?.value as Partial<OperationalSettings>) ?? {});
    cache = { value, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch (e) {
    // Si la base no responde no se puede degradar a valores arbitrarios en una
    // ruta critica; se usan los del entorno y se deja constancia.
    logger.error({ err: e }, 'No se pudieron leer los parámetros operativos; se usan los del entorno.');
    return defaults();
  }
}

export async function updateSettings(
  patch: Partial<OperationalSettings>,
  actorUserId: string,
): Promise<OperationalSettings> {
  const current = await getSettings();
  const next = sanitize({ ...current, ...patch });

  const patchRecord = patch as unknown as Record<string, unknown>;
  const nextRecord = next as unknown as Record<string, unknown>;
  const rejected = Object.keys(patch).filter(
    (k) => patchRecord[k] !== undefined && nextRecord[k] !== patchRecord[k],
  );
  if (rejected.length > 0) {
    throw errors.validation('Valores fuera de rango permitido: ' + rejected.join(', '), { rejected, limits: LIMITS });
  }

  await prisma.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: next as unknown as object, updatedBy: actorUserId },
    update: { value: next as unknown as object, updatedBy: actorUserId },
  });

  cache = { value: next, expiresAt: Date.now() + CACHE_TTL_MS };
  logger.info({ actorUserId, next }, 'Parámetros operativos actualizados.');
  return next;
}

export function invalidateSettingsCache(): void {
  cache = null;
}

export { defaults as defaultSettings, LIMITS as settingsLimits };
