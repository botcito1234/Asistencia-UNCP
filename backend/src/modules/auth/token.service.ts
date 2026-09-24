/**
 * Emision y verificacion de tokens.
 *
 * Modelo adoptado:
 *  - Access token JWT firmado con HS256, vida corta (15 min por defecto). No se
 *    consulta la base en cada peticion, salvo para operaciones sensibles.
 *  - Refresh token opaco de 48 bytes, almacenado SOLO como hash SHA-256. Rota
 *    en cada uso (rotacion con deteccion de reutilizacion).
 *  - Cada sesion queda ligada al dispositivo. Un practicante no puede tener dos
 *    sesiones activas: al abrir una nueva se revocan las anteriores y se
 *    levanta un evento de seguridad.
 */
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { UserRole } from '@prisma/client';
import { config } from '../../config/env.js';
import { prisma } from '../../infra/db/prisma.js';
import { generateOpaqueToken, hashToken } from '../../core/crypto.js';
import { errors } from '../../core/errors.js';

const secretKey = new TextEncoder().encode(config.JWT_SECRET);

/** Reclamos propios del sistema que viajan dentro del access token. */
export interface AccessTokenInput {
  sub: string;
  role: UserRole;
  /** Identificador de la sesion; permite invalidar el access token al cerrar sesion. */
  sid: string;
  /** Huella del dispositivo vinculado, cuando aplica. */
  dfp?: string | undefined;
  /** DNI, util para trazas sin consultar la base. */
  dni: string;
}

/** Reclamos ya verificados, con los campos estandar de JWT anadidos. */
export type AccessTokenClaims = AccessTokenInput & JWTPayload;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
}

export async function signAccessToken(claims: AccessTokenInput): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const expiresAt = new Date(Date.now() + config.ACCESS_TOKEN_TTL_MINUTES * 60_000);
  const token = await new SignJWT({
    role: claims.role,
    sid: claims.sid,
    dfp: claims.dfp,
    dni: claims.dni,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey);
  return { token, expiresAt };
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw errors.unauthorized('TOKEN_INVALIDO', 'Token malformado.');
    }
    return payload as unknown as AccessTokenClaims;
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    if (message.includes('exp') || message.includes('expired')) {
      throw errors.unauthorized('TOKEN_EXPIRADO', 'La sesión expiro. Vuelva a iniciar sesión.');
    }
    throw errors.unauthorized('TOKEN_INVALIDO', 'Token inválido.');
  }
}

export interface CreateSessionInput {
  userId: string;
  role: UserRole;
  dni: string;
  deviceFingerprint?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  /** Revoca cualquier otra sesion activa del usuario (sesion unica). */
  enforceSingleSession: boolean;
}

export interface CreateSessionResult extends TokenPair {
  revokedSessions: number;
}

export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
  let revokedSessions = 0;

  if (input.enforceSingleSession) {
    const result = await prisma.session.updateMany({
      where: { userId: input.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date(), revokedReason: 'SESION_UNICA' },
    });
    revokedSessions = result.count;
  }

  const refreshToken = generateOpaqueToken();
  const refreshExpiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

  const session = await prisma.session.create({
    data: {
      userId: input.userId,
      refreshTokenHash: hashToken(refreshToken),
      deviceFingerprint: input.deviceFingerprint ?? null,
      userAgent: input.userAgent ? input.userAgent.slice(0, 255) : null,
      ipAddress: input.ipAddress ?? null,
      expiresAt: refreshExpiresAt,
    },
  });

  const access = await signAccessToken({
    sub: input.userId,
    role: input.role,
    sid: session.id,
    dfp: input.deviceFingerprint ?? undefined,
    dni: input.dni,
  });

  return {
    accessToken: access.token,
    refreshToken,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
    sessionId: session.id,
    revokedSessions,
  };
}

export interface RotateResult extends TokenPair {
  userId: string;
  role: UserRole;
}

/**
 * Rota el refresh token.
 * Si llega un token ya usado o revocado se asume compromiso: se revocan todas
 * las sesiones del usuario. Es la contramedida estandar frente al robo de
 * refresh tokens.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  context: { userAgent?: string | null; ipAddress?: string | null; deviceFingerprint?: string | null },
): Promise<RotateResult> {
  const tokenHash = hashToken(refreshToken);

  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: tokenHash },
    include: { user: { select: { id: true, role: true, dni: true, status: true } } },
  });

  if (!session) throw errors.unauthorized('TOKEN_INVALIDO', 'Sesión no reconocida.');

  if (session.revokedAt) {
    await prisma.session.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'REUTILIZACION_DETECTADA' },
    });
    throw errors.unauthorized('SESION_REVOCADA', 'La sesión fue cerrada. Vuelva a iniciar sesión.');
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    throw errors.unauthorized('TOKEN_EXPIRADO', 'La sesión expiro. Vuelva a iniciar sesión.');
  }

  if (session.user.status !== 'ACTIVO') {
    throw errors.unauthorized('CUENTA_INACTIVA', 'La cuenta no está activa.');
  }

  // El dispositivo que renueva debe ser el mismo que abrio la sesion.
  if (session.deviceFingerprint && context.deviceFingerprint && session.deviceFingerprint !== context.deviceFingerprint) {
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedReason: 'DISPOSITIVO_DISTINTO' },
    });
    throw errors.unauthorized('DISPOSITIVO_NO_AUTORIZADO', 'Dispositivo no autorizado. Solicite autorización al administrador.');
  }

  const newRefresh = generateOpaqueToken();
  const newExpiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

  const newSession = await prisma.$transaction(async (tx) => {
    const created = await tx.session.create({
      data: {
        userId: session.userId,
        refreshTokenHash: hashToken(newRefresh),
        deviceFingerprint: session.deviceFingerprint,
        userAgent: context.userAgent ? context.userAgent.slice(0, 255) : session.userAgent,
        ipAddress: context.ipAddress ?? session.ipAddress,
        expiresAt: newExpiresAt,
      },
    });
    await tx.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedReason: 'ROTACION', replacedById: created.id, lastSeenAt: new Date() },
    });
    return created;
  });

  const access = await signAccessToken({
    sub: session.userId,
    role: session.user.role,
    sid: newSession.id,
    dfp: session.deviceFingerprint ?? undefined,
    dni: session.user.dni,
  });

  return {
    accessToken: access.token,
    refreshToken: newRefresh,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshTokenExpiresAt: newExpiresAt.toISOString(),
    sessionId: newSession.id,
    userId: session.userId,
    role: session.user.role,
  };
}

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason.slice(0, 120) },
  });
}

export async function revokeAllSessionsForUser(userId: string, reason: string): Promise<number> {
  const r = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason.slice(0, 120) },
  });
  return r.count;
}

/** Comprueba que la sesion del access token siga viva. */
export async function assertSessionActive(sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { revokedAt: true, expiresAt: true },
  });
  if (!session) throw errors.unauthorized('SESION_REVOCADA', 'La sesión ya no existe.');
  if (session.revokedAt) throw errors.unauthorized('SESION_REVOCADA', 'La sesión fue cerrada.');
  if (session.expiresAt.getTime() <= Date.now()) {
    throw errors.unauthorized('TOKEN_EXPIRADO', 'La sesión expiro.');
  }
}

export async function touchSession(sessionId: string): Promise<void> {
  await prisma.session
    .updateMany({ where: { id: sessionId, revokedAt: null }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);
}
