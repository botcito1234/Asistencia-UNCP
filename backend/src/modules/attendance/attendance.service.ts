/**
 * Registro de marcaciones de entrada y de salida.
 *
 * Esta es la ruta critica del sistema. Orden de validacion (todo en servidor):
 *   1. Cuenta activa y practicante activo.
 *   2. Sede activa.
 *   3. Dispositivo vinculado.
 *   4. Horario vigente para la fecha de negocio.
 *   5. Ventana de marcacion.
 *   6. Calidad de la lectura GPS: ubicacion simulada, precision, antiguedad.
 *   7. Geocerca, con la distancia RECALCULADA en el servidor.
 *   8. Evidencia fotográfica efectivamente almacenada e integra.
 *   9. Persistencia transaccional con restricciones unicas de base de datos.
 *
 * Todo rechazo produce un evento de seguridad y jamas una fila de asistencia.
 * La hora oficial es siempre `new Date()` del servidor.
 */
import type { MarkType, Prisma } from '@prisma/client';
import { prisma, isUniqueViolation } from '../../infra/db/prisma.js';
import { errors, AppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import {
  businessDateString,
  localMinutesOfDay,
  instantAtLocalMinutes,
  dateOnlyValue,
  minutesToHHmm,
} from '../../core/time.js';
import { evaluateGeofence, isValidCoordinate, round2 } from '../../domain/geo.js';
import {
  evaluateCheckInWindow,
  evaluateLocationQuality,
  maxUsableAccuracyForRadius,
} from '../../domain/attendance-rules.js';
import { getSettings } from '../settings/settings.service.js';
import { getEffectiveSchedule } from '../schedules/schedule.service.js';
import { assertBoundDevice, reportUnauthorizedDevice } from '../devices/device.service.js';
import { recordSecurityEvent } from '../security/security-event.service.js';
import { notify } from '../notifications/notification.service.js';
import { broadcast } from '../notifications/realtime.js';
import { recordAudit, type AuditContext } from '../audit/audit.service.js';
import { evidenceStorage } from '../../infra/storage/evidence-storage.js';

export interface MarkLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  altitude?: number | null;
  speed?: number | null;
  /** Antiguedad de la lectura en milisegundos. */
  locationAgeMs?: number | null;
  /** Lo reporta el sistema operativo del telefono (Android: Location.isMock). */
  mockLocationReported: boolean;
  /** Opciones de desarrollador activas; por si solo no rechaza, pero se audita. */
  developerModeReported?: boolean;
}

export interface MarkRequest {
  userId: string;
  internId: string;
  type: MarkType;
  location: MarkLocation;
  /** Reloj del telefono, solo para auditoria y deteccion de desfase. */
  deviceTime?: Date | null;
  deviceFingerprint: string;
  photo: Buffer;
  idempotencyKey?: string | null;
  context: AuditContext;
}

export interface MarkResult {
  markId: string;
  attendanceDayId: string;
  type: MarkType;
  businessDate: string;
  serverTime: string;
  localTime: string;
  punctuality: 'PUNTUAL' | 'TARDANZA' | null;
  lateMinutes: number;
  distanceMeters: number;
  accuracyMeters: number;
  scheduledStartTime: string | null;
  evidenceId: string;
  /** true si la peticion se resolvio devolviendo una marcacion ya existente. */
  deduplicated: boolean;
}

export async function registerMark(request: MarkRequest): Promise<MarkResult> {
  const settings = await getSettings();
  const serverTime = new Date();

  // --- 0. Idempotencia: una doble pulsacion no crea dos registros -----------
  if (request.idempotencyKey) {
    const existing = await findByIdempotencyKey(request.idempotencyKey, request.internId);
    if (existing) return existing;
  }

  // --- 1 y 2. Practicante y sede -------------------------------------------
  const intern = await prisma.intern.findUnique({
    where: { id: request.internId },
    include: { site: true, user: { select: { id: true, status: true, dni: true, displayName: true } } },
  });

  if (!intern) throw errors.notFound('Practicante');
  if (!intern.active || intern.user.status !== 'ACTIVO') {
    throw errors.unauthorized('CUENTA_INACTIVA', 'El practicante no está activo.');
  }
  if (!intern.site.active) {
    await securityEvent(request, intern, 'INTENTO_SOSPECHOSO', 'Intento de marcación en una sede inactiva.');
    throw new AppError('SEDE_INACTIVA', 'Su sede está inactiva. Comuníquese con el administrador.', 409);
  }

  const timezone = intern.site.timezone;
  const businessDate = businessDateString(serverTime, timezone);
  const nowMinutes = localMinutesOfDay(serverTime, timezone);

  // --- 3. Dispositivo vinculado --------------------------------------------
  let deviceBindingId: string;
  try {
    const bound = await assertBoundDevice(request.userId, request.deviceFingerprint);
    deviceBindingId = bound.bindingId;
  } catch (e) {
    await reportUnauthorizedDevice({
      userId: request.userId,
      internId: intern.id,
      siteId: intern.siteId,
      fingerprint: request.deviceFingerprint ?? 'DESCONOCIDA',
      ipAddress: request.context.ipAddress ?? null,
      userAgent: request.context.userAgent ?? null,
      action: request.type === 'ENTRADA' ? 'marcación de entrada' : 'marcación de salida',
    });
    throw e;
  }

  // --- 4. Horario vigente ---------------------------------------------------
  const schedule = await getEffectiveSchedule(intern.id, businessDate);

  if (request.type === 'ENTRADA' && !schedule) {
    await securityEvent(request, intern, 'MARCACION_FUERA_DE_VENTANA', 'Intento de entrada en un día sin jornada programada.');
    throw new AppError('SIN_HORARIO_HOY', 'Hoy no tiene una jornada programada.', 409, {
      meta: { businessDate },
    });
  }

  // --- 5. Ventana de marcacion ---------------------------------------------
  let punctuality: 'PUNTUAL' | 'TARDANZA' | null = null;
  let lateMinutes = 0;

  if (request.type === 'ENTRADA' && schedule) {
    const decision = evaluateCheckInWindow({
      nowMinutes,
      scheduledStartMinute: schedule.startMinute,
      earlyWindowMinutes: settings.checkinEarlyWindowMinutes,
    });

    if (!decision.allowed) {
      const opensAt = minutesToHHmm(decision.opensAtMinute) as string;
      await securityEvent(
        request,
        intern,
        'MARCACION_FUERA_DE_VENTANA',
        'Intento de entrada ' + decision.minutesUntilOpen + ' minuto(s) antes de la apertura de la ventana.',
        { opensAt, scheduledStart: minutesToHHmm(schedule.startMinute) },
      );
      throw new AppError(
        'FUERA_DE_VENTANA',
        'Aún no puede marcar entrada. Podra hacerlo a partir de las ' + opensAt + '.',
        409,
        { meta: { opensAt, scheduledStart: minutesToHHmm(schedule.startMinute), minutesUntilOpen: decision.minutesUntilOpen } },
      );
    }

    punctuality = decision.punctuality;
    lateMinutes = decision.lateMinutes;
  }

  // --- 6. Calidad de la lectura GPS ----------------------------------------
  if (!isValidCoordinate(request.location)) {
    await securityEvent(request, intern, 'GPS_IMPRECISO', 'Coordenadas inválidas o sin fijación de posición.');
    throw new AppError('GPS_IMPRECISO', 'No se pudo obtener una ubicación válida. Intente nuevamente al aire libre.', 422);
  }

  const maxAccuracy = maxUsableAccuracyForRadius(intern.site.radiusMeters, settings.gpsMaxAccuracyMeters);
  const quality = evaluateLocationQuality({
    accuracyMeters: request.location.accuracyMeters,
    locationAgeMs: request.location.locationAgeMs ?? null,
    mockLocationReported: request.location.mockLocationReported,
    maxAccuracyMeters: maxAccuracy,
    maxAgeSeconds: settings.gpsMaxAgeSeconds,
  });

  if (!quality.ok) {
    if (quality.reason === 'UBICACION_SIMULADA') {
      await securityEvent(request, intern, 'UBICACION_SIMULADA', 'El sistema operativo reportó la ubicación como simulada.', {
        modoDesarrollador: request.location.developerModeReported ?? false,
      });
      throw new AppError(
        'UBICACION_SIMULADA',
        'Se detectó una ubicación simulada. Desactive las aplicaciones de ubicación falsa e intente nuevamente.',
        409,
      );
    }
    if (quality.reason === 'GPS_IMPRECISO') {
      await securityEvent(
        request,
        intern,
        'GPS_IMPRECISO',
        'Precisión de ' + quality.accuracyMeters + ' m; el máximo admitido para esta sede es ' + quality.maxAccuracyMeters + ' m.',
      );
      throw new AppError(
        'GPS_IMPRECISO',
        'Tu ubicación no tiene suficiente precisión (' +
          Math.round(quality.accuracyMeters) +
          ' m). Sal al exterior y vuelve a intentarlo.',
        422,
        { meta: { accuracyMeters: quality.accuracyMeters, maxAccuracyMeters: quality.maxAccuracyMeters } },
      );
    }
    await securityEvent(request, intern, 'GPS_IMPRECISO', 'Lectura GPS obsoleta (' + quality.ageSeconds + ' s).');
    throw new AppError('GPS_OBSOLETO', 'La ubicación obtenida está desactualizada. Vuelva a intentarlo.', 422);
  }

  // --- 7. Geocerca (distancia recalculada en servidor) ---------------------
  const geofence = evaluateGeofence(
    { latitude: Number(intern.site.latitude), longitude: Number(intern.site.longitude) },
    { latitude: request.location.latitude, longitude: request.location.longitude },
    intern.site.radiusMeters,
  );

  if (!geofence.inside) {
    await securityEvent(
      request,
      intern,
      'FUERA_DE_GEOCERCA',
      'Marcación a ' + geofence.distanceMeters + ' m de la sede; el radio permitido es ' + geofence.radiusMeters + ' m.',
      { distanceMeters: geofence.distanceMeters, radiusMeters: geofence.radiusMeters },
      geofence.distanceMeters,
    );
    throw new AppError(
      'FUERA_DE_GEOCERCA',
      'Debes estar dentro de tu sede para registrar asistencia. Estás a ' +
        Math.round(geofence.distanceMeters) +
        ' m (máximo ' +
        geofence.radiusMeters +
        ' m).',
      409,
      { meta: { distanceMeters: geofence.distanceMeters, radiusMeters: geofence.radiusMeters } },
    );
  }

  // --- Desfase de reloj: no bloquea, pero se audita ------------------------
  let clockSkewSeconds: number | null = null;
  if (request.deviceTime) {
    clockSkewSeconds = Math.round((request.deviceTime.getTime() - serverTime.getTime()) / 1000);
    if (Math.abs(clockSkewSeconds) > settings.maxDeviceClockSkewSeconds) {
      await securityEvent(
        request,
        intern,
        'INTENTO_SOSPECHOSO',
        'El reloj del dispositivo difiere del servidor en ' + clockSkewSeconds + ' segundos.',
        { clockSkewSeconds },
      );
    }
  }

  // --- Comprobacion previa de duplicados -----------------------------------
  // La barrera real es la restriccion unica; esto solo evita almacenar una foto
  // que ya sabemos que se va a rechazar.
  const existingDay = await prisma.attendanceDay.findUnique({
    where: { uq_attendance_day_intern_date: { internId: intern.id, businessDate: dateOnlyValue(businessDate) } },
    include: { marks: { select: { id: true, type: true, serverTime: true } } },
  });

  if (existingDay) {
    const hasEntry = existingDay.marks.some((m) => m.type === 'ENTRADA');
    const hasExit = existingDay.marks.some((m) => m.type === 'SALIDA');

    if (request.type === 'ENTRADA' && hasEntry) {
      await securityEvent(request, intern, 'ENTRADA_DUPLICADA', 'Intento de registrar una segunda entrada en el mismo día.');
      throw new AppError('ENTRADA_DUPLICADA', 'Ya registraste tu entrada de hoy.', 409);
    }
    if (request.type === 'SALIDA' && !hasEntry) {
      await securityEvent(request, intern, 'SALIDA_SIN_ENTRADA', 'Intento de registrar salida sin una entrada previa.');
      throw new AppError('SALIDA_SIN_ENTRADA', 'No puedes registrar salida porque no registraste tu entrada de hoy.', 409);
    }
    if (request.type === 'SALIDA' && hasExit) {
      await securityEvent(request, intern, 'SALIDA_DUPLICADA', 'Intento de registrar una segunda salida en el mismo día.');
      throw new AppError('SALIDA_DUPLICADA', 'Ya registraste tu salida de hoy.', 409);
    }
  } else if (request.type === 'SALIDA') {
    await securityEvent(request, intern, 'SALIDA_SIN_ENTRADA', 'Intento de registrar salida sin jornada abierta.');
    throw new AppError('SALIDA_SIN_ENTRADA', 'No puedes registrar salida porque no registraste tu entrada de hoy.', 409);
  }

  // --- 8. Evidencia fotográfica --------------------------------------------
  if (!request.photo || request.photo.length === 0) {
    throw new AppError('EVIDENCIA_REQUERIDA', 'La fotografía es obligatoria para registrar la asistencia.', 422);
  }

  const storageKey = evidenceStorage.buildKey({
    siteCode: intern.site.code,
    isoDate: businessDate,
    internDni: intern.dni,
    kind: request.type === 'ENTRADA' ? 'entrada' : 'salida',
    mime: 'image/jpeg',
  });

  let stored;
  try {
    stored = await evidenceStorage.save({ buffer: request.photo, storageKey });
  } catch (e) {
    await securityEvent(
      request,
      intern,
      'EVIDENCIA_INVALIDA',
      e instanceof AppError ? e.message : 'No se pudo almacenar la evidencia fotográfica.',
    );
    if (e instanceof AppError && e.code === 'VALIDACION') {
      throw new AppError('EVIDENCIA_INVALIDA', e.message, 422);
    }
    throw new AppError('EVIDENCIA_NO_ALMACENADA', 'No se pudo almacenar la fotografía. Intente nuevamente.', 500);
  }

  // --- 9. Persistencia transaccional ---------------------------------------
  try {
    const result = await prisma.$transaction(async (tx) => {
      const evidence = await tx.evidencePhoto.create({
        data: {
          internId: intern.id,
          kind: request.type === 'ENTRADA' ? 'MARCACION_ENTRADA' : 'MARCACION_SALIDA',
          storageKey: stored.storageKey,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          width: stored.width,
          height: stored.height,
          sha256: stored.sha256,
          capturedAt: request.deviceTime ?? serverTime,
          captureSource: 'CAMARA',
        },
      });

      const dayData = {
        internId: intern.id,
        siteId: intern.siteId,
        businessDate: dateOnlyValue(businessDate),
        scheduledStartMinute: schedule?.startMinute ?? null,
        scheduledEndMinute: schedule?.endMinute ?? null,
        scheduleEntryId: schedule?.scheduleEntryId ?? null,
      };

      const day = await tx.attendanceDay.upsert({
        where: { uq_attendance_day_intern_date: { internId: intern.id, businessDate: dateOnlyValue(businessDate) } },
        create: {
          ...dayData,
          status: request.type === 'ENTRADA' ? 'PRESENTE' : 'PRESENTE',
          punctuality,
          lateMinutes,
          pendingExit: request.type === 'ENTRADA',
        },
        update:
          request.type === 'ENTRADA'
            ? { status: 'PRESENTE', punctuality, lateMinutes, pendingExit: true }
            : { pendingExit: false },
      });

      const mark = await tx.attendanceMark.create({
        data: {
          attendanceDayId: day.id,
          type: request.type,
          serverTime,
          deviceTime: request.deviceTime ?? null,
          deviceClockSkewSeconds: clockSkewSeconds,
          latitude: request.location.latitude,
          longitude: request.location.longitude,
          accuracyMeters: round2(request.location.accuracyMeters),
          distanceMeters: geofence.distanceMeters,
          altitude: request.location.altitude ?? null,
          speed: request.location.speed ?? null,
          locationAgeMs: request.location.locationAgeMs ?? null,
          mockLocationReported: request.location.mockLocationReported,
          developerModeReported: request.location.developerModeReported ?? false,
          evidenceId: evidence.id,
          deviceBindingId,
          ipAddress: request.context.ipAddress ?? null,
          idempotencyKey: request.idempotencyKey ?? null,
        },
      });

      await recordAudit(
        {
          ...request.context,
          actorUserId: request.userId,
          actorRole: 'PRACTICANTE',
          action: request.type === 'ENTRADA' ? 'ENTRADA_REGISTRADA' : 'SALIDA_REGISTRADA',
          entityType: 'AttendanceMark',
          entityId: mark.id,
          after: {
            attendanceDayId: day.id,
            businessDate,
            serverTime: serverTime.toISOString(),
            punctuality,
            lateMinutes,
            distanceMeters: geofence.distanceMeters,
            accuracyMeters: request.location.accuracyMeters,
            evidenceSha256: stored.sha256,
          },
        },
        tx,
      );

      return { mark, day, evidence };
    });

    const outcome: MarkResult = {
      markId: result.mark.id,
      attendanceDayId: result.day.id,
      type: request.type,
      businessDate,
      serverTime: serverTime.toISOString(),
      localTime: minutesToHHmm(nowMinutes) as string,
      punctuality: request.type === 'ENTRADA' ? punctuality : null,
      lateMinutes,
      distanceMeters: geofence.distanceMeters,
      accuracyMeters: round2(request.location.accuracyMeters),
      scheduledStartTime: schedule ? minutesToHHmm(schedule.startMinute) : null,
      evidenceId: result.evidence.id,
      deduplicated: false,
    };

    await announce(intern, outcome);
    return outcome;
  } catch (e) {
    // Si la persistencia fallo, la foto no debe quedar huerfana en disco.
    await evidenceStorage.release(stored.storageKey);

    // Carrera perdida contra otra peticion simultanea: la restriccion unica de
    // base de datos hizo su trabajo. Se traduce al codigo de negocio.
    if (isUniqueViolation(e)) {
      if (request.idempotencyKey) {
        const existing = await findByIdempotencyKey(request.idempotencyKey, request.internId);
        if (existing) return existing;
      }
      const code = request.type === 'ENTRADA' ? 'ENTRADA_DUPLICADA' : 'SALIDA_DUPLICADA';
      const message = request.type === 'ENTRADA' ? 'Ya registraste tu entrada de hoy.' : 'Ya registraste tu salida de hoy.';
      await securityEvent(request, intern, code, 'Intento simultaneo detenido por la restricción de base de datos.');
      throw new AppError(code, message, 409);
    }

    logger.error({ err: e, internId: intern.id, type: request.type }, 'Fallo la persistencia de la marcación.');
    throw errors.internal('No se pudo registrar la asistencia. Intente nuevamente.', e);
  }
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

async function findByIdempotencyKey(key: string, internId: string): Promise<MarkResult | null> {
  const mark = await prisma.attendanceMark.findUnique({
    where: { idempotencyKey: key },
    include: { attendanceDay: { include: { site: { select: { timezone: true } } } } },
  });
  if (!mark || mark.attendanceDay.internId !== internId) return null;

  return {
    markId: mark.id,
    attendanceDayId: mark.attendanceDayId,
    type: mark.type,
    businessDate: mark.attendanceDay.businessDate.toISOString().slice(0, 10),
    serverTime: mark.serverTime.toISOString(),
    // Hora real de la marcacion en la zona de la sede, igual que en la
    // respuesta original: el reintento debe devolver exactamente lo mismo.
    localTime: minutesToHHmm(localMinutesOfDay(mark.serverTime, mark.attendanceDay.site.timezone)) as string,
    punctuality: mark.type === 'ENTRADA' ? mark.attendanceDay.punctuality : null,
    lateMinutes: mark.attendanceDay.lateMinutes,
    distanceMeters: Number(mark.distanceMeters),
    accuracyMeters: Number(mark.accuracyMeters),
    scheduledStartTime: minutesToHHmm(mark.attendanceDay.scheduledStartMinute),
    evidenceId: mark.evidenceId,
    deduplicated: true,
  };
}

type InternWithSite = Prisma.InternGetPayload<{ include: { site: true } }>;

async function securityEvent(
  request: MarkRequest,
  intern: InternWithSite,
  type: Parameters<typeof recordSecurityEvent>[0]['type'],
  message: string,
  details?: Record<string, unknown>,
  distanceMeters?: number,
): Promise<void> {
  await recordSecurityEvent({
    type,
    message,
    internId: intern.id,
    userId: request.userId,
    siteId: intern.siteId,
    latitude: request.location.latitude,
    longitude: request.location.longitude,
    accuracyMeters: request.location.accuracyMeters,
    distanceMeters: distanceMeters ?? null,
    deviceFingerprint: request.deviceFingerprint,
    ipAddress: request.context.ipAddress ?? null,
    userAgent: request.context.userAgent ?? null,
    details: {
      tipoMarcacion: request.type,
      ubicacionSimulada: request.location.mockLocationReported,
      modoDesarrollador: request.location.developerModeReported ?? false,
      ...details,
    },
  });

  await recordAudit({
    ...request.context,
    actorUserId: request.userId,
    actorRole: 'PRACTICANTE',
    action: 'MARCACION_RECHAZADA',
    entityType: 'Intern',
    entityId: intern.id,
    reason: message,
    after: { tipo: request.type, motivo: type },
  });
}

/** Notifica al administrador y refresca los tableros abiertos. */
async function announce(intern: InternWithSite, outcome: MarkResult): Promise<void> {
  const nombre = intern.firstNames + ' ' + intern.lastNames;
  const hora = outcome.serverTime;

  broadcast('asistencia', {
    internId: intern.id,
    internName: nombre,
    siteId: intern.siteId,
    siteName: intern.site.name,
    type: outcome.type,
    punctuality: outcome.punctuality,
    businessDate: outcome.businessDate,
    serverTime: hora,
    distanceMeters: outcome.distanceMeters,
  });

  if (outcome.type === 'ENTRADA') {
    const tarde = outcome.punctuality === 'TARDANZA';
    await notify({
      type: tarde ? 'TARDANZA_REGISTRADA' : 'ENTRADA_REGISTRADA',
      severity: tarde ? 'ADVERTENCIA' : 'INFO',
      title: tarde ? 'Tardanza registrada' : 'Entrada registrada',
      body:
        nombre +
        ' (' +
        intern.site.name +
        ') registró entrada' +
        (tarde ? ' con ' + outcome.lateMinutes + ' minuto(s) de tardanza.' : ' puntualmente.'),
      data: {
        internId: intern.id,
        siteId: intern.siteId,
        attendanceDayId: outcome.attendanceDayId,
        businessDate: outcome.businessDate,
        punctuality: outcome.punctuality,
      },
    });
  } else {
    await notify({
      type: 'SALIDA_REGISTRADA',
      title: 'Salida registrada',
      body: nombre + ' (' + intern.site.name + ') registró su salida.',
      data: {
        internId: intern.id,
        siteId: intern.siteId,
        attendanceDayId: outcome.attendanceDayId,
        businessDate: outcome.businessDate,
      },
    });
  }
}

/** Instante UTC de la hora programada; lo usan los reportes y el cierre. */
export function scheduledInstant(businessDate: string, minutes: number, timezone: string): Date {
  return instantAtLocalMinutes(businessDate, minutes, timezone);
}
