/**
 * Eventos de seguridad.
 *
 * Entidad deliberadamente separada de la asistencia: un intento rechazado NO es
 * una asistencia y nunca debe contaminar los conteos de presentes, puntuales o
 * tardanzas. Aqui viven los intentos fallidos, las anomalias y los incidentes.
 *
 * Cada evento critico dispara notificacion inmediata al administrador.
 */
import type { Prisma, SecurityEventType, SecuritySeverity } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { logger } from '../../core/logger.js';
import { notify } from '../notifications/notification.service.js';
import { broadcast } from '../notifications/realtime.js';
import type { NotificationType } from '@prisma/client';

export interface SecurityEventInput {
  type: SecurityEventType;
  severity?: SecuritySeverity;
  message: string;
  internId?: string | null;
  userId?: string | null;
  siteId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  distanceMeters?: number | null;
  deviceFingerprint?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown>;
}

/** Severidad por defecto de cada tipo de evento. */
const DEFAULT_SEVERITY: Record<SecurityEventType, SecuritySeverity> = {
  FUERA_DE_GEOCERCA: 'ADVERTENCIA',
  UBICACION_SIMULADA: 'CRITICO',
  GPS_IMPRECISO: 'INFO',
  DISPOSITIVO_NO_AUTORIZADO: 'CRITICO',
  SESION_SIMULTANEA: 'ADVERTENCIA',
  ENTRADA_DUPLICADA: 'ADVERTENCIA',
  SALIDA_DUPLICADA: 'ADVERTENCIA',
  SALIDA_SIN_ENTRADA: 'ADVERTENCIA',
  MARCACION_FUERA_DE_VENTANA: 'INFO',
  CREDENCIALES_INVALIDAS: 'INFO',
  CUENTA_BLOQUEADA: 'ADVERTENCIA',
  EVIDENCIA_INVALIDA: 'ADVERTENCIA',
  INTENTO_SOSPECHOSO: 'ADVERTENCIA',
  SALIDA_PENDIENTE: 'ADVERTENCIA',
  FALTA_REGISTRADA: 'INFO',
  ARCHIVADO_FALLIDO: 'CRITICO',
};

/** Eventos que se notifican al administrador de inmediato. */
const NOTIFY_MAP: Partial<Record<SecurityEventType, NotificationType>> = {
  FUERA_DE_GEOCERCA: 'FUERA_DE_GEOCERCA',
  UBICACION_SIMULADA: 'UBICACION_SIMULADA',
  DISPOSITIVO_NO_AUTORIZADO: 'DISPOSITIVO_NO_AUTORIZADO',
  SESION_SIMULTANEA: 'EVENTO_CRITICO',
  ARCHIVADO_FALLIDO: 'EVENTO_CRITICO',
  SALIDA_PENDIENTE: 'SALIDA_PENDIENTE',
  FALTA_REGISTRADA: 'FALTA_REGISTRADA',
};

/**
 * Registra el evento y, si corresponde, notifica.
 * No lanza nunca: el registro de un incidente no puede hacer fallar el flujo
 * que lo detecto.
 */
export async function recordSecurityEvent(input: SecurityEventInput): Promise<string | null> {
  const severity = input.severity ?? DEFAULT_SEVERITY[input.type] ?? 'ADVERTENCIA';

  try {
    const event = await prisma.securityEvent.create({
      data: {
        type: input.type,
        severity,
        message: input.message.slice(0, 400),
        internId: input.internId ?? null,
        userId: input.userId ?? null,
        siteId: input.siteId ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        accuracyMeters: input.accuracyMeters ?? null,
        distanceMeters: input.distanceMeters ?? null,
        deviceFingerprint: input.deviceFingerprint ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ? input.userAgent.slice(0, 255) : null,
        details: (input.details ?? {}) as Prisma.InputJsonValue,
      },
      include: {
        intern: { select: { id: true, dni: true, firstNames: true, lastNames: true } },
        site: { select: { id: true, code: true, name: true } },
      },
    });

    broadcast('evento-seguridad', {
      id: event.id,
      type: event.type,
      severity: event.severity,
      message: event.message,
      internName: event.intern ? event.intern.firstNames + ' ' + event.intern.lastNames : null,
      siteName: event.site?.name ?? null,
      createdAt: event.createdAt.toISOString(),
    });

    const notificationType = NOTIFY_MAP[input.type];
    if (notificationType) {
      const who = event.intern ? event.intern.firstNames + ' ' + event.intern.lastNames : 'Usuario desconocido';
      const where = event.site ? ' - ' + event.site.name : '';
      await notify({
        type: notificationType,
        severity,
        title: titleFor(input.type),
        body: who + where + ': ' + event.message,
        urgent: severity === 'CRITICO',
        data: {
          securityEventId: event.id,
          eventType: event.type,
          internId: event.internId,
          siteId: event.siteId,
        },
      });
    }

    logger.warn(
      { securityEventId: event.id, type: input.type, severity, internId: input.internId },
      'Evento de seguridad registrado.',
    );
    return event.id;
  } catch (e) {
    logger.error({ err: e, type: input.type }, 'No se pudo registrar el evento de seguridad.');
    return null;
  }
}

function titleFor(type: SecurityEventType): string {
  const map: Record<SecurityEventType, string> = {
    FUERA_DE_GEOCERCA: 'Marcación fuera del radio de la sede',
    UBICACION_SIMULADA: 'Ubicación simulada detectada',
    GPS_IMPRECISO: 'Lectura GPS imprecisa',
    DISPOSITIVO_NO_AUTORIZADO: 'Intento desde dispositivo no autorizado',
    SESION_SIMULTANEA: 'Sesión simultánea detectada',
    ENTRADA_DUPLICADA: 'Intento de entrada duplicada',
    SALIDA_DUPLICADA: 'Intento de salida duplicada',
    SALIDA_SIN_ENTRADA: 'Intento de salida sin entrada previa',
    MARCACION_FUERA_DE_VENTANA: 'Marcación fuera de la ventana permitida',
    CREDENCIALES_INVALIDAS: 'Credenciales inválidas',
    CUENTA_BLOQUEADA: 'Cuenta bloqueada por intentos fallidos',
    EVIDENCIA_INVALIDA: 'Evidencia fotográfica inválida',
    INTENTO_SOSPECHOSO: 'Intento sospechoso',
    SALIDA_PENDIENTE: 'Salida pendiente',
    FALTA_REGISTRADA: 'Falta registrada',
    ARCHIVADO_FALLIDO: 'Fallo el archivado histórico',
  };
  return map[type] ?? 'Evento de seguridad';
}

// ---------------------------------------------------------------------------
// Consulta y atencion
// ---------------------------------------------------------------------------

export interface SecurityEventQuery {
  from?: Date;
  to?: Date;
  siteId?: string;
  internId?: string;
  type?: SecurityEventType;
  severity?: SecuritySeverity;
  onlyPending?: boolean;
  page?: number;
  pageSize?: number;
}

export async function querySecurityEvents(q: SecurityEventQuery) {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));

  const where: Prisma.SecurityEventWhereInput = {};
  if (q.siteId) where.siteId = q.siteId;
  if (q.internId) where.internId = q.internId;
  if (q.type) where.type = q.type;
  if (q.severity) where.severity = q.severity;
  if (q.onlyPending) where.acknowledgedAt = null;
  if (q.from || q.to) {
    where.createdAt = {};
    if (q.from) where.createdAt.gte = q.from;
    if (q.to) where.createdAt.lte = q.to;
  }

  const [total, pending, items] = await Promise.all([
    prisma.securityEvent.count({ where }),
    prisma.securityEvent.count({ where: { ...where, acknowledgedAt: null } }),
    prisma.securityEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        intern: { select: { id: true, dni: true, firstNames: true, lastNames: true } },
        site: { select: { id: true, code: true, name: true } },
        acknowledger: { select: { id: true, displayName: true } },
      },
    }),
  ]);

  return { total, pending, page, pageSize, items };
}

export async function acknowledgeEvent(
  eventId: string,
  adminUserId: string,
  note?: string,
): Promise<boolean> {
  const existing = await prisma.securityEvent.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!existing) return false;
  await prisma.securityEvent.update({
    where: { id: eventId },
    data: {
      acknowledgedAt: new Date(),
      acknowledgedBy: adminUserId,
      acknowledgeNote: note ? note.slice(0, 400) : null,
    },
  });
  return true;
}

/** Resumen por tipo para el tablero. */
export async function securityEventSummary(from: Date, to: Date, siteId?: string) {
  const where: Prisma.SecurityEventWhereInput = { createdAt: { gte: from, lte: to } };
  if (siteId) where.siteId = siteId;

  const grouped = await prisma.securityEvent.groupBy({
    by: ['type', 'severity'],
    where,
    _count: { _all: true },
  });

  const pending = await prisma.securityEvent.count({ where: { ...where, acknowledgedAt: null } });

  return {
    pending,
    byType: grouped.map((g) => ({ type: g.type, severity: g.severity, count: g._count._all })),
    total: grouped.reduce((acc, g) => acc + g._count._all, 0),
  };
}
