/**
 * Limitacion de tasa.
 *
 * Tres niveles, porque el riesgo es distinto:
 *  - general: protege el servicio completo de un cliente descontrolado.
 *  - login: frena la fuerza bruta de credenciales (por IP y por DNI).
 *  - marcacion: evita el martilleo del boton y el abuso de subida de fotos.
 */
import rateLimit, { type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { config } from '../../config/env.js';
import { clientIp } from './context.js';

function handler(req: Request, res: Response): void {
  res.status(429).json({
    error: {
      code: 'DEMASIADAS_SOLICITUDES',
      message: 'Demasiadas solicitudes. Espere unos momentos antes de reintentar.',
      requestId: req.requestId,
    },
  });
}

const base: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  keyGenerator: (req: Request) => clientIp(req) ?? 'desconocida',
};

export const generalRateLimit = rateLimit({
  ...base,
  windowMs: config.RATE_LIMIT_WINDOW_MINUTES * 60_000,
  limit: config.RATE_LIMIT_MAX_REQUESTS,
});

/** Se identifica por IP + DNI para no castigar a toda una oficina por un solo atacante. */
export const loginRateLimit = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: config.LOGIN_RATE_LIMIT_MAX,
  keyGenerator: (req: Request) => {
    const dni = typeof req.body?.dni === 'string' ? req.body.dni.slice(0, 15) : 'sin-dni';
    return (clientIp(req) ?? 'desconocida') + '|' + dni;
  },
});

export const markRateLimit = rateLimit({
  ...base,
  windowMs: 5 * 60_000,
  limit: config.MARK_RATE_LIMIT_MAX,
  keyGenerator: (req: Request) => req.auth?.userId ?? clientIp(req) ?? 'desconocida',
});

/**
 * Los avisos de intentos rechazados NO comparten cupo con la marcacion.
 *
 * Quien pelea con un GPS malo o esta fuera del radio genera un aviso por cada
 * intento, y seria absurdo que por avisar se quedara sin cupo para marcar
 * cuando por fin consigue una lectura buena dentro de la sede. Aun asi se
 * limita, para que un cliente roto no inunde la bitacora de seguridad.
 */
export const incidentRateLimit = rateLimit({
  ...base,
  windowMs: 5 * 60_000,
  limit: 40,
  keyGenerator: (req: Request) => req.auth?.userId ?? clientIp(req) ?? 'desconocida',
});

/** Los reportes son costosos: se limitan aparte. */
export const reportRateLimit = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: 20,
  keyGenerator: (req: Request) => req.auth?.userId ?? clientIp(req) ?? 'desconocida',
});
