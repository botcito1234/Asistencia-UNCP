/**
 * Vinculacion de cuenta a un unico telefono.
 *
 * Regla de negocio: la primera vez que un practicante inicia sesion, su cuenta
 * queda ligada al telefono usado. A partir de ahi ningun otro telefono puede
 * marcar asistencia. Cambiar de telefono exige autorizacion administrativa
 * explicita, de un solo uso y con vencimiento.
 *
 * Sobre la huella de dispositivo (Android):
 *  - NO se usa IMEI ni el numero de serie: Android 10+ los bloquea para apps
 *    que no son del fabricante, y ademas son identificadores de hardware cuyo
 *    tratamiento es desproporcionado.
 *  - NO se usa solo ANDROID_ID: se reinicia al restaurar de fabrica y puede
 *    repetirse entre perfiles.
 *  - Se usa una huella compuesta generada en el cliente a partir de ANDROID_ID
 *    mas un secreto aleatorio creado en la primera ejecucion y guardado en el
 *    almacen cifrado del sistema (Android Keystore via flutter_secure_storage).
 *    Es estable frente a reinstalaciones normales, cambia si el usuario borra
 *    los datos de la app (caso en que el administrador debe reautorizar) y no
 *    expone identificadores de hardware.
 *  - El servidor trata la huella como un dato opaco y la valida como texto.
 *
 * Ninguna huella de cliente es infalible. Por eso la defensa es por capas:
 * huella + sesion unica + geocerca + evidencia fotográfica + auditoria.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { errors } from '../../core/errors.js';
import { recordAudit, type AuditContext } from '../audit/audit.service.js';
import { recordSecurityEvent } from '../security/security-event.service.js';

/** Vencimiento de una autorizacion de cambio de dispositivo. */
const AUTHORIZATION_TTL_HOURS = 48;

export interface DeviceInfo {
  fingerprint: string;
  platform: string;
  model?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
}

export type DeviceCheck =
  | { outcome: 'VINCULADO_OK'; bindingId: string }
  | { outcome: 'PRIMER_VINCULO'; bindingId: string }
  | { outcome: 'REVINCULADO'; bindingId: string; previousFingerprint: string }
  | { outcome: 'RECHAZADO'; reason: 'DISPOSITIVO_DISTINTO'; boundAt: Date };

export function isValidFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{16,128}$/.test(value);
}

/**
 * Resuelve el estado del dispositivo durante el login.
 * Es idempotente: reingresar desde el mismo telefono solo actualiza lastSeenAt.
 */
export async function resolveDeviceBinding(
  userId: string,
  device: DeviceInfo,
  context: AuditContext,
): Promise<DeviceCheck> {
  if (!isValidFingerprint(device.fingerprint)) {
    throw errors.validation('Identificador de dispositivo inválido.');
  }

  const active = await prisma.deviceBinding.findFirst({
    where: { userId, status: 'ACTIVO' },
    orderBy: { boundAt: 'desc' },
  });

  // Caso 1: mismo telefono de siempre.
  if (active && active.deviceFingerprint === device.fingerprint) {
    await prisma.deviceBinding.update({
      where: { id: active.id },
      data: {
        lastSeenAt: new Date(),
        model: device.model ?? active.model,
        osVersion: device.osVersion ?? active.osVersion,
        appVersion: device.appVersion ?? active.appVersion,
      },
    });
    return { outcome: 'VINCULADO_OK', bindingId: active.id };
  }

  // Caso 2: telefono distinto. Solo pasa con autorizacion administrativa vigente.
  if (active && active.deviceFingerprint !== device.fingerprint) {
    const authorization = await prisma.deviceChangeAuthorization.findFirst({
      where: {
        userId,
        consumedAt: null,
        cancelledAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { grantedAt: 'desc' },
    });

    if (!authorization) {
      return { outcome: 'RECHAZADO', reason: 'DISPOSITIVO_DISTINTO', boundAt: active.boundAt };
    }

    const bindingId = await prisma.$transaction(async (tx) => {
      await tx.deviceBinding.update({
        where: { id: active.id },
        data: {
          status: 'REVOCADO',
          revokedAt: new Date(),
          revokedBy: authorization.grantedBy,
          revokeReason: 'Reemplazado por autorización de cambio de dispositivo.',
        },
      });
      const created = await tx.deviceBinding.create({
        data: {
          userId,
          deviceFingerprint: device.fingerprint,
          platform: device.platform,
          model: device.model ?? null,
          osVersion: device.osVersion ?? null,
          appVersion: device.appVersion ?? null,
        },
      });
      await tx.deviceChangeAuthorization.update({
        where: { id: authorization.id },
        data: { consumedAt: new Date() },
      });
      return created.id;
    });

    await recordAudit({
      ...context,
      action: 'DISPOSITIVO_VINCULADO',
      entityType: 'DeviceBinding',
      entityId: bindingId,
      before: { fingerprint: mask(active.deviceFingerprint), boundAt: active.boundAt },
      after: { fingerprint: mask(device.fingerprint), model: device.model, platform: device.platform },
      reason: 'Cambio autorizado por administrador.',
    });

    return { outcome: 'REVINCULADO', bindingId, previousFingerprint: active.deviceFingerprint };
  }

  // Caso 3: primer telefono. Se vincula automaticamente.
  const created = await prisma.deviceBinding.create({
    data: {
      userId,
      deviceFingerprint: device.fingerprint,
      platform: device.platform,
      model: device.model ?? null,
      osVersion: device.osVersion ?? null,
      appVersion: device.appVersion ?? null,
    },
  });

  await recordAudit({
    ...context,
    action: 'DISPOSITIVO_VINCULADO',
    entityType: 'DeviceBinding',
    entityId: created.id,
    after: { fingerprint: mask(device.fingerprint), model: device.model, platform: device.platform },
    reason: 'Primera vinculación.',
  });

  return { outcome: 'PRIMER_VINCULO', bindingId: created.id };
}

/** Verifica que la huella presentada corresponda a la vinculacion activa. */
export async function assertBoundDevice(
  userId: string,
  fingerprint: string | undefined,
): Promise<{ bindingId: string }> {
  if (!isValidFingerprint(fingerprint)) {
    throw errors.unauthorized('DISPOSITIVO_NO_AUTORIZADO', 'Dispositivo no autorizado. Solicite autorización al administrador.');
  }

  const binding = await prisma.deviceBinding.findFirst({
    where: { userId, status: 'ACTIVO', deviceFingerprint: fingerprint },
    select: { id: true },
  });

  if (!binding) {
    throw errors.unauthorized('DISPOSITIVO_NO_AUTORIZADO', 'Dispositivo no autorizado. Solicite autorización al administrador.');
  }

  return { bindingId: binding.id };
}

export async function getActiveBinding(userId: string) {
  return prisma.deviceBinding.findFirst({
    where: { userId, status: 'ACTIVO' },
    orderBy: { boundAt: 'desc' },
  });
}

export async function listBindings(userId: string) {
  return prisma.deviceBinding.findMany({
    where: { userId },
    orderBy: { boundAt: 'desc' },
    include: { revoker: { select: { id: true, displayName: true } } },
  });
}

/** Desvincula el telefono actual. El practicante debera volver a vincular. */
export async function revokeBinding(
  bindingId: string,
  adminUserId: string,
  reason: string,
  context: AuditContext,
): Promise<void> {
  const binding = await prisma.deviceBinding.findUnique({ where: { id: bindingId } });
  if (!binding) throw errors.notFound('Dispositivo');
  if (binding.status === 'REVOCADO') throw errors.conflict('CONFLICTO', 'El dispositivo ya estába desvinculado.');

  await prisma.$transaction(async (tx) => {
    await tx.deviceBinding.update({
      where: { id: bindingId },
      data: {
        status: 'REVOCADO',
        revokedAt: new Date(),
        revokedBy: adminUserId,
        revokeReason: reason.slice(0, 255),
      },
    });
    // Cerrar sesiones abiertas en ese telefono.
    await tx.session.updateMany({
      where: { userId: binding.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'DISPOSITIVO_DESVINCULADO' },
    });
  });

  await recordAudit({
    ...context,
    action: 'DISPOSITIVO_REVOCADO',
    entityType: 'DeviceBinding',
    entityId: bindingId,
    before: { fingerprint: mask(binding.deviceFingerprint), status: 'ACTIVO' },
    after: { status: 'REVOCADO' },
    reason,
  });
}

/**
 * Autoriza el cambio de telefono. La autorizacion es de un solo uso y caduca.
 * Se prefiere sobre "desvincular" cuando el practicante todavia no tiene el
 * telefono nuevo a mano.
 */
export async function authorizeDeviceChange(
  userId: string,
  adminUserId: string,
  reason: string,
  context: AuditContext,
): Promise<{ id: string; expiresAt: Date }> {
  const user = await prisma.userAccount.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw errors.notFound('Usuario');

  // Anular autorizaciones previas sin consumir: solo una vigente a la vez.
  await prisma.deviceChangeAuthorization.updateMany({
    where: { userId, consumedAt: null, cancelledAt: null },
    data: { cancelledAt: new Date() },
  });

  const expiresAt = new Date(Date.now() + AUTHORIZATION_TTL_HOURS * 3_600_000);
  const created = await prisma.deviceChangeAuthorization.create({
    data: { userId, grantedBy: adminUserId, reason: reason.slice(0, 255), expiresAt },
  });

  await recordAudit({
    ...context,
    action: 'DISPOSITIVO_CAMBIO_AUTORIZADO',
    entityType: 'DeviceChangeAuthorization',
    entityId: created.id,
    after: { userId, expiresAt: expiresAt.toISOString() },
    reason,
  });

  return { id: created.id, expiresAt };
}

export async function pendingAuthorization(userId: string) {
  return prisma.deviceChangeAuthorization.findFirst({
    where: { userId, consumedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } },
    orderBy: { grantedAt: 'desc' },
  });
}

/** Deja constancia de un intento desde un telefono no autorizado. */
export async function reportUnauthorizedDevice(params: {
  userId: string;
  internId?: string | null;
  siteId?: string | null;
  fingerprint: string;
  boundAt?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  action: string;
}): Promise<void> {
  await recordSecurityEvent({
    type: 'DISPOSITIVO_NO_AUTORIZADO',
    severity: 'CRITICO',
    message: 'Intento de ' + params.action + ' desde un dispositivo que no es el vinculado a la cuenta.',
    userId: params.userId,
    internId: params.internId ?? null,
    siteId: params.siteId ?? null,
    deviceFingerprint: params.fingerprint,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    details: {
      intento: params.action,
      huellaPresentada: mask(params.fingerprint),
      vinculadoDesde: params.boundAt?.toISOString() ?? null,
    },
  });
}

/** Nunca se guarda la huella completa en auditoria ni en eventos. */
function mask(fingerprint: string): string {
  if (fingerprint.length <= 10) return '***';
  return fingerprint.slice(0, 6) + '...' + fingerprint.slice(-4);
}

export { mask as maskFingerprint };

export type DeviceBindingWithRevoker = Prisma.DeviceBindingGetPayload<{
  include: { revoker: { select: { id: true; displayName: true } } };
}>;
