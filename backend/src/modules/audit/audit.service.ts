/**
 * Bitacora de auditoria.
 *
 * Cubre escrituras y tambien lecturas sensibles (descarga de evidencia
 * fotografica, exportacion de reportes con datos personales). Nunca lanza:
 * un fallo al auditar no debe tumbar la operacion de negocio, pero si debe
 * quedar en el log de errores para ser investigado.
 */
import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { logger } from '../../core/logger.js';

export type AuditAction =
  | 'LOGIN_EXITOSO'
  | 'LOGIN_FALLIDO'
  | 'LOGOUT'
  | 'TOKEN_RENOVADO'
  | 'PASSWORD_CAMBIADA'
  | 'PASSWORD_RESTABLECIDA'
  | 'DISPOSITIVO_VINCULADO'
  | 'DISPOSITIVO_REVOCADO'
  | 'DISPOSITIVO_CAMBIO_AUTORIZADO'
  | 'SEDE_CREADA'
  | 'SEDE_ACTUALIZADA'
  | 'SEDE_DESACTIVADA'
  | 'PRACTICANTE_CREADO'
  | 'PRACTICANTE_ACTUALIZADO'
  | 'PRACTICANTE_DESACTIVADO'
  | 'HORARIO_ACTUALIZADO'
  | 'ENTRADA_REGISTRADA'
  | 'SALIDA_REGISTRADA'
  | 'MARCACION_RECHAZADA'
  | 'REGULARIZACION_APLICADA'
  | 'EVIDENCIA_CONSULTADA'
  | 'EVIDENCIA_DESCARGADA'
  | 'REPORTE_GENERADO'
  | 'ARCHIVADO_EJECUTADO'
  | 'ARCHIVADO_LIBERADO'
  | 'PARAMETROS_ACTUALIZADOS'
  | 'EVENTO_SEGURIDAD_ATENDIDO'
  | 'CONSENTIMIENTO_ACEPTADO'
  | 'JORNADA_CERRADA';

export interface AuditContext {
  actorUserId?: string | null;
  actorRole?: UserRole | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditInput extends AuditContext {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Campos que jamas deben quedar guardados en la bitacora. */
const FORBIDDEN_KEYS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'temporaryPassword',
  'refreshToken',
  'refreshTokenHash',
  'accessToken',
  'token',
  'privateKey',
]);

function redact(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (depth > 6) return '[PROFUNDIDAD_MAXIMA]';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.slice(0, 200).map((v) => redact(v, depth + 1) ?? null) as Prisma.InputJsonValue;
    }
    // Decimal de Prisma y similares exponen toString/toNumber.
    const maybeDecimal = value as { toFixed?: unknown; toNumber?: () => number };
    if (typeof maybeDecimal.toNumber === 'function' && typeof maybeDecimal.toFixed === 'function') {
      return maybeDecimal.toNumber();
    }
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) {
        out[k] = '[REDACTADO]';
        continue;
      }
      const r = redact(v, depth + 1);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  if (typeof value === 'string') return value.length > 4000 ? value.slice(0, 4000) + '...' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

/**
 * Registra una entrada de auditoria.
 * Acepta un cliente transaccional para que la auditoria de una operacion
 * critica se confirme o se revierta junto con ella.
 */
export async function recordAudit(
  input: AuditInput,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  try {
    await client.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        before: redact(input.before) ?? undefined,
        after: redact(input.after) ?? undefined,
        reason: input.reason ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ? input.userAgent.slice(0, 255) : null,
        requestId: input.requestId ?? null,
      },
    });
  } catch (e) {
    logger.error({ err: e, action: input.action, entityType: input.entityType }, 'Fallo al registrar auditoria.');
  }
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function queryAudit(q: AuditQuery) {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));

  const where: Prisma.AuditLogWhereInput = {};
  if (q.entityType) where.entityType = q.entityType;
  if (q.entityId) where.entityId = q.entityId;
  if (q.actorUserId) where.actorUserId = q.actorUserId;
  if (q.action) where.action = q.action;
  if (q.from || q.to) {
    where.createdAt = {};
    if (q.from) where.createdAt.gte = q.from;
    if (q.to) where.createdAt.lte = q.to;
  }

  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { id: true, dni: true, displayName: true, role: true } } },
    }),
  ]);

  return { total, page, pageSize, items };
}
