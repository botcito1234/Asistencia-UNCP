/**
 * Autenticacion.
 *
 * Flujo del practicante: DNI + contrasena. En el primer login el telefono queda
 * vinculado. Cualquier telefono posterior es rechazado salvo autorizacion
 * administrativa. Solo puede haber una sesion activa a la vez.
 *
 * El administrador entra con las mismas credenciales pero no queda atado a un
 * dispositivo: usa el panel web desde cualquier equipo y puede tener varias
 * sesiones (por ejemplo, panel y aplicacion movil).
 */
import type { UserRole } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { config } from '../../config/env.js';
import { errors } from '../../core/errors.js';
import { hashPassword, verifyPassword, generateTemporaryPassword } from '../../core/crypto.js';
import { validatePasswordStrength } from '../../domain/attendance-rules.js';
import { recordAudit, type AuditContext } from '../audit/audit.service.js';
import { recordSecurityEvent } from '../security/security-event.service.js';
import { createSession, revokeAllSessionsForUser, revokeSession, rotateRefreshToken } from './token.service.js';
import {
  resolveDeviceBinding,
  reportUnauthorizedDevice,
  type DeviceInfo,
} from '../devices/device.service.js';
import { getSettings } from '../settings/settings.service.js';

export interface LoginInput {
  dni: string;
  password: string;
  device?: DeviceInfo | null;
  context: AuditContext;
}

export interface AuthenticatedUser {
  id: string;
  dni: string;
  role: UserRole;
  displayName: string;
  mustChangePassword: boolean;
  intern: {
    id: string;
    firstNames: string;
    lastNames: string;
    areaGroup: string | null;
    consentAccepted: boolean;
    site: { id: string; code: string; name: string; latitude: number; longitude: number; radiusMeters: number; timezone: string };
  } | null;
}

export interface LoginResult {
  user: AuthenticatedUser;
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: string;
    refreshTokenExpiresAt: string;
  };
  device: { bound: boolean; firstBinding: boolean; rebound: boolean };
  privacyPolicyVersion: string;
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const dni = input.dni.trim();

  const user = await prisma.userAccount.findUnique({
    where: { dni },
    include: {
      intern: { include: { site: true } },
    },
  });

  // Respuesta uniforme para usuario inexistente y contrasena incorrecta: no se
  // filtra que DNI existen en el sistema.
  if (!user) {
    await recordSecurityEvent({
      type: 'CREDENCIALES_INVALIDAS',
      message: 'Intento de acceso con un DNI no registrado.',
      ipAddress: input.context.ipAddress ?? null,
      userAgent: input.context.userAgent ?? null,
      details: { dni },
    });
    throw errors.unauthorized('CREDENCIALES_INVALIDAS', 'DNI o contraseña incorrectos.');
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw errors.unauthorized(
      'CUENTA_BLOQUEADA',
      'Cuenta bloqueada temporalmente por intentos fallidos. Reintente en ' + minutes + ' minuto(s).',
    );
  }

  const passwordOk = await verifyPassword(input.password, user.passwordHash);

  if (!passwordOk) {
    const attempts = user.failedAttempts + 1;
    const shouldLock = attempts >= config.LOGIN_MAX_ATTEMPTS;
    await prisma.userAccount.update({
      where: { id: user.id },
      data: {
        failedAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + config.LOGIN_LOCK_MINUTES * 60_000) : null,
      },
    });

    await recordSecurityEvent({
      type: shouldLock ? 'CUENTA_BLOQUEADA' : 'CREDENCIALES_INVALIDAS',
      severity: shouldLock ? 'ADVERTENCIA' : 'INFO',
      message: shouldLock
        ? 'Cuenta bloqueada tras ' + config.LOGIN_MAX_ATTEMPTS + ' intentos fallidos consecutivos.'
        : 'Contraseña incorrecta (intento ' + attempts + ' de ' + config.LOGIN_MAX_ATTEMPTS + ').',
      userId: user.id,
      internId: user.intern?.id ?? null,
      siteId: user.intern?.siteId ?? null,
      ipAddress: input.context.ipAddress ?? null,
      userAgent: input.context.userAgent ?? null,
      deviceFingerprint: input.device?.fingerprint ?? null,
    });

    await recordAudit({ ...input.context, action: 'LOGIN_FALLIDO', entityType: 'UserAccount', entityId: user.id });

    if (shouldLock) {
      throw errors.unauthorized(
        'CUENTA_BLOQUEADA',
        'Cuenta bloqueada temporalmente por intentos fallidos. Reintente en ' + config.LOGIN_LOCK_MINUTES + ' minutos.',
      );
    }
    throw errors.unauthorized('CREDENCIALES_INVALIDAS', 'DNI o contraseña incorrectos.');
  }

  if (user.status !== 'ACTIVO') {
    throw errors.unauthorized('CUENTA_INACTIVA', 'La cuenta no está activa. Comuníquese con el administrador.');
  }

  const isIntern = user.role === 'PRACTICANTE';
  if (isIntern && (!user.intern || !user.intern.active)) {
    throw errors.unauthorized('CUENTA_INACTIVA', 'El practicante no está activo.');
  }
  if (isIntern && user.intern && !user.intern.site.active) {
    throw errors.unauthorized('CUENTA_INACTIVA', 'La sede asignada está inactiva. Comuníquese con el administrador.');
  }

  // --- Control de dispositivo (solo practicantes) --------------------------
  let deviceBound = false;
  let firstBinding = false;
  let rebound = false;

  if (isIntern) {
    if (!input.device) {
      throw errors.validation('La aplicación debe enviar la identificación del dispositivo.');
    }
    const check = await resolveDeviceBinding(user.id, input.device, {
      ...input.context,
      actorUserId: user.id,
      actorRole: user.role,
    });

    if (check.outcome === 'RECHAZADO') {
      await reportUnauthorizedDevice({
        userId: user.id,
        internId: user.intern?.id ?? null,
        siteId: user.intern?.siteId ?? null,
        fingerprint: input.device.fingerprint,
        boundAt: check.boundAt,
        ipAddress: input.context.ipAddress ?? null,
        userAgent: input.context.userAgent ?? null,
        action: 'inicio de sesión',
      });
      throw errors.unauthorized(
        'DISPOSITIVO_NO_AUTORIZADO',
        'Dispositivo no autorizado. Solicite autorización al administrador.',
      );
    }

    deviceBound = true;
    firstBinding = check.outcome === 'PRIMER_VINCULO';
    rebound = check.outcome === 'REVINCULADO';
  }

  // --- Sesion --------------------------------------------------------------
  const session = await createSession({
    userId: user.id,
    role: user.role,
    dni: user.dni,
    deviceFingerprint: input.device?.fingerprint ?? null,
    userAgent: input.context.userAgent ?? null,
    ipAddress: input.context.ipAddress ?? null,
    // Sesion unica solo para practicantes: el administrador legitimamente usa
    // el panel web y la aplicacion a la vez.
    enforceSingleSession: isIntern,
  });

  if (isIntern && session.revokedSessions > 0) {
    await recordSecurityEvent({
      type: 'SESION_SIMULTANEA',
      message: 'Se cerró una sesión activa previa al abrir una nueva. Solo se permite una sesión por practicante.',
      userId: user.id,
      internId: user.intern?.id ?? null,
      siteId: user.intern?.siteId ?? null,
      deviceFingerprint: input.device?.fingerprint ?? null,
      ipAddress: input.context.ipAddress ?? null,
      details: { sesionesCerradas: session.revokedSessions },
    });
  }

  await prisma.userAccount.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  await recordAudit({
    ...input.context,
    actorUserId: user.id,
    actorRole: user.role,
    action: 'LOGIN_EXITOSO',
    entityType: 'UserAccount',
    entityId: user.id,
    after: { sessionId: session.sessionId, firstBinding, rebound },
  });

  const settings = await getSettings();

  return {
    user: toAuthenticatedUser(user),
    tokens: {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt,
    },
    device: { bound: deviceBound, firstBinding, rebound },
    privacyPolicyVersion: settings.privacyPolicyVersion,
  };
}

type UserWithIntern = Awaited<ReturnType<typeof findUserWithIntern>>;

async function findUserWithIntern(userId: string) {
  return prisma.userAccount.findUnique({
    where: { id: userId },
    include: { intern: { include: { site: true } } },
  });
}

export function toAuthenticatedUser(user: NonNullable<UserWithIntern>): AuthenticatedUser {
  return {
    id: user.id,
    dni: user.dni,
    role: user.role,
    displayName: user.displayName,
    mustChangePassword: user.mustChangePassword,
    intern: user.intern
      ? {
          id: user.intern.id,
          firstNames: user.intern.firstNames,
          lastNames: user.intern.lastNames,
          areaGroup: user.intern.areaGroup,
          consentAccepted: Boolean(user.intern.consentAcceptedAt),
          site: {
            id: user.intern.site.id,
            code: user.intern.site.code,
            name: user.intern.site.name,
            latitude: Number(user.intern.site.latitude),
            longitude: Number(user.intern.site.longitude),
            radiusMeters: user.intern.site.radiusMeters,
            timezone: user.intern.site.timezone,
          },
        }
      : null,
  };
}

export async function refresh(
  refreshToken: string,
  context: AuditContext & { deviceFingerprint?: string | null },
) {
  const rotated = await rotateRefreshToken(refreshToken, {
    userAgent: context.userAgent ?? null,
    ipAddress: context.ipAddress ?? null,
    deviceFingerprint: context.deviceFingerprint ?? null,
  });

  const user = await findUserWithIntern(rotated.userId);
  if (!user) throw errors.unauthorized('TOKEN_INVALIDO', 'Usuario no encontrado.');

  await recordAudit({
    ...context,
    actorUserId: rotated.userId,
    actorRole: rotated.role,
    action: 'TOKEN_RENOVADO',
    entityType: 'Session',
    entityId: rotated.sessionId,
  });

  return {
    user: toAuthenticatedUser(user),
    tokens: {
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      accessTokenExpiresAt: rotated.accessTokenExpiresAt,
      refreshTokenExpiresAt: rotated.refreshTokenExpiresAt,
    },
  };
}

export async function logout(sessionId: string, context: AuditContext): Promise<void> {
  await revokeSession(sessionId, 'LOGOUT');
  await recordAudit({ ...context, action: 'LOGOUT', entityType: 'Session', entityId: sessionId });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  context: AuditContext,
): Promise<void> {
  const user = await prisma.userAccount.findUnique({ where: { id: userId } });
  if (!user) throw errors.notFound('Usuario');

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw errors.unauthorized('CREDENCIALES_INVALIDAS', 'La contraseña actual es incorrecta.');

  const policy = validatePasswordStrength(newPassword, config.PASSWORD_MIN_LENGTH, user.dni);
  if (!policy.ok) {
    throw new (await import('../../core/errors.js')).AppError(
      'PASSWORD_DEBIL',
      'La nueva contraseña no cumple la política: ' + policy.problems.join(' '),
      422,
      { details: policy.problems },
    );
  }

  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw errors.validation('La nueva contraseña debe ser distinta de la actual.');
  }

  await prisma.userAccount.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      passwordSetAt: new Date(),
    },
  });

  // Cambiar la contrasena cierra todas las sesiones: es la contramedida si el
  // motivo del cambio fue una sospecha de robo de credenciales.
  await revokeAllSessionsForUser(userId, 'PASSWORD_CAMBIADA');

  await recordAudit({
    ...context,
    actorUserId: userId,
    action: 'PASSWORD_CAMBIADA',
    entityType: 'UserAccount',
    entityId: userId,
  });
}

/** Restablecimiento por parte de un administrador. Genera contrasena temporal. */
export async function resetPassword(
  targetUserId: string,
  adminUserId: string,
  context: AuditContext,
): Promise<{ temporaryPassword: string; dni: string }> {
  const user = await prisma.userAccount.findUnique({ where: { id: targetUserId }, select: { id: true, dni: true } });
  if (!user) throw errors.notFound('Usuario');

  const temporaryPassword = generateTemporaryPassword(12);
  await prisma.userAccount.update({
    where: { id: targetUserId },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      passwordSetAt: new Date(),
      failedAttempts: 0,
      lockedUntil: null,
    },
  });

  await revokeAllSessionsForUser(targetUserId, 'PASSWORD_RESTABLECIDA');

  await recordAudit({
    ...context,
    actorUserId: adminUserId,
    action: 'PASSWORD_RESTABLECIDA',
    entityType: 'UserAccount',
    entityId: targetUserId,
    reason: 'Restablecimiento administrativo.',
  });

  // La contrasena temporal se devuelve una sola vez, para que el administrador
  // la entregue por un canal fuera de banda. No se guarda en ningun log.
  return { temporaryPassword, dni: user.dni };
}

export async function me(userId: string): Promise<AuthenticatedUser> {
  const user = await findUserWithIntern(userId);
  if (!user) throw errors.notFound('Usuario');
  return toAuthenticatedUser(user);
}

export async function acceptConsent(userId: string, policyVersion: string, context: AuditContext): Promise<void> {
  const intern = await prisma.intern.findUnique({ where: { userId }, select: { id: true } });
  if (!intern) throw errors.notFound('Practicante');

  await prisma.intern.update({
    where: { id: intern.id },
    data: { consentAcceptedAt: new Date(), consentPolicyVersion: policyVersion },
  });

  await recordAudit({
    ...context,
    actorUserId: userId,
    action: 'CONSENTIMIENTO_ACEPTADO',
    entityType: 'Intern',
    entityId: intern.id,
    after: { policyVersion },
  });
}
