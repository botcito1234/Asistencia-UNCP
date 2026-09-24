/**
 * Autenticacion y autorizacion HTTP.
 *
 * Principio: denegar por defecto. Ninguna ruta de negocio es publica; las
 * excepciones (login, salud, politica de privacidad) se declaran explicitamente
 * en el enrutador.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { UserRole } from '@prisma/client';
import { verifyAccessToken, assertSessionActive } from '../../modules/auth/token.service.js';
import { prisma } from '../../infra/db/prisma.js';
import { AppError, errors } from '../../core/errors.js';
import { deviceFingerprintOf, auditContextOf } from './context.js';
import { recordSecurityEvent } from '../../modules/security/security-event.service.js';

function extractBearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? (match[1] as string) : null;
}

/**
 * Exige un access token valido y una sesion viva.
 * La comprobacion de sesion en base de datos es lo que permite que cerrar
 * sesion, revocar un dispositivo o desactivar a alguien surta efecto de
 * inmediato, sin esperar a que caduque el JWT.
 *
 * Mientras el usuario tenga pendiente cambiar su contrasena inicial, TODAS las
 * rutas le responden 403 CAMBIO_PASSWORD_REQUERIDO, salvo las pocas marcadas
 * con `permitirCambioPendiente` (ver su perfil, cambiarla y cerrar sesion). La
 * contrasena temporal la conoce quien la entrego: debe dejar de servir cuanto
 * antes, tambien para los administradores.
 *
 * Es 403 y no 401 a proposito: la sesion es valida, lo que falta es un paso.
 * Un 401 haria que los clientes intentaran renovar el token o cerraran la
 * sesion, cuando lo que tienen que hacer es llevar al usuario a cambiarla.
 */
export function authenticate(opciones: { permitirCambioPendiente?: boolean } = {}): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = extractBearer(req);
      if (!token) throw errors.unauthorized('NO_AUTORIZADO', 'Falta el token de acceso.');

      const claims = await verifyAccessToken(token);
      await assertSessionActive(claims.sid);

      const user = await prisma.userAccount.findUnique({
        where: { id: claims.sub },
        select: {
          id: true,
          dni: true,
          role: true,
          status: true,
          mustChangePassword: true,
          intern: { select: { id: true, active: true } },
        },
      });

      if (!user) throw errors.unauthorized('TOKEN_INVALIDO', 'Usuario no encontrado.');
      if (user.status !== 'ACTIVO') throw errors.unauthorized('CUENTA_INACTIVA', 'La cuenta no está activa.');
      if (user.role === 'PRACTICANTE' && (!user.intern || !user.intern.active)) {
        throw errors.unauthorized('CUENTA_INACTIVA', 'El practicante no está activo.');
      }
      if (user.mustChangePassword && !opciones.permitirCambioPendiente) {
        throw new AppError('CAMBIO_PASSWORD_REQUERIDO', 'Debe cambiar su contraseña antes de continuar.', 403);
      }

      req.auth = {
        userId: user.id,
        role: user.role,
        sessionId: claims.sid,
        dni: user.dni,
        deviceFingerprint: claims.dfp,
        internId: user.intern?.id ?? null,
      };

      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Restringe la ruta a los roles indicados. */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(errors.unauthorized());
    if (!roles.includes(req.auth.role)) {
      return next(errors.forbidden('Esta operación requiere el rol: ' + roles.join(' o ') + '.'));
    }
    next();
  };
}

export const requireAdmin = (): RequestHandler => requireRole('ADMINISTRADOR');
export const requireIntern = (): RequestHandler => requireRole('PRACTICANTE');

/**
 * Exige que la peticion llegue desde el dispositivo vinculado a la sesion.
 * Se aplica a las rutas de marcacion.
 *
 * El rechazo NO se limita a devolver 401: queda como evento critico, con aviso
 * inmediato al administrador. Llegar aqui significa que alguien tiene un token
 * valido y lo esta usando desde otro telefono, que es exactamente la senal de
 * una credencial robada. Un 401 silencioso dejaria eso invisible.
 *
 * El limitador de tasa va ANTES en la cadena de la ruta, asi que un cliente
 * insistente no puede inundar la bitacora ni las notificaciones.
 */
export function requireBoundDevice(): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(errors.unauthorized());

    const presented = deviceFingerprintOf(req);
    const coincide = Boolean(presented) && (!req.auth.deviceFingerprint || req.auth.deviceFingerprint === presented);
    if (coincide) return next();

    const contexto = auditContextOf(req);
    await recordSecurityEvent({
      type: 'DISPOSITIVO_NO_AUTORIZADO',
      message: presented
        ? 'Intento de marcación con una sesión válida desde un teléfono distinto al vinculado.'
        : 'Intento de marcación sin identificar el teléfono.',
      userId: req.auth.userId,
      internId: req.auth.internId,
      deviceFingerprint: presented ?? null,
      ipAddress: contexto.ipAddress,
      userAgent: contexto.userAgent,
      details: {
        ruta: req.originalUrl.split('?')[0],
        huellaEsperada: req.auth.deviceFingerprint ?? null,
        huellaPresentada: presented ?? null,
      },
    });

    next(
      errors.unauthorized('DISPOSITIVO_NO_AUTORIZADO', 'Dispositivo no autorizado. Solicite autorización al administrador.'),
    );
  };
}

/** Asegura que el practicante solo acceda a su propia informacion. */
export function requireOwnIntern(paramName = 'internId'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(errors.unauthorized());
    if (req.auth.role === 'ADMINISTRADOR') return next();
    const requested = req.params[paramName];
    if (requested && requested !== req.auth.internId) {
      return next(errors.forbidden('Solo puede consultar su propia información.'));
    }
    next();
  };
}
