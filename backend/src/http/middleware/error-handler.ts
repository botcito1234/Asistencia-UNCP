/**
 * Manejo uniforme de errores.
 *
 * Contrato de respuesta de error (estable para el cliente movil y el panel):
 *   { "error": { "code": "...", "message": "...", "details": ..., "meta": ..., "requestId": "..." } }
 *
 * El `code` es lo que el cliente interpreta; el `message` es lo que muestra al
 * usuario. Los errores internos nunca filtran trazas ni detalles de base de
 * datos al exterior: se registran completos en el log del servidor.
 */
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, isAppError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { config } from '../../config/env.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NO_ENCONTRADO',
      message: 'Ruta no encontrada: ' + req.method + ' ' + req.path,
      requestId: req.requestId,
    },
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId;

  // --- Errores de validacion de esquema ------------------------------------
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ campo: i.path.join('.') || '(raiz)', problema: i.message }));
    logger.debug({ requestId, details }, 'Petición inválida.');
    res.status(422).json({
      error: {
        code: 'VALIDACION',
        message: 'La solicitud contiene datos inválidos.',
        details,
        requestId,
      },
    });
    return;
  }

  // --- Errores de dominio / aplicacion -------------------------------------
  if (isAppError(err)) {
    const level = err.httpStatus >= 500 ? 'error' : 'warn';
    logger[level](
      { requestId, code: err.code, status: err.httpStatus, userId: req.auth?.userId, err: err.expose ? undefined : err },
      err.message,
    );
    res.status(err.httpStatus).json({
      error: {
        code: err.code,
        message: err.expose ? err.message : 'Ocurrio un error al procesar la solicitud.',
        details: err.expose ? err.details : undefined,
        meta: err.meta,
        requestId,
      },
    });
    return;
  }

  // --- Errores conocidos de Prisma -----------------------------------------
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = mapPrismaError(err);
    logger.warn({ requestId, prismaCode: err.code, meta: err.meta }, mapped.message);
    res.status(mapped.status).json({
      error: { code: mapped.code, message: mapped.message, requestId },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    logger.fatal({ requestId, err }, 'No hay conexión con la base de datos.');
    res.status(503).json({
      error: {
        code: 'DEPENDENCIA_EXTERNA',
        message: 'El servicio no está disponible en este momento. Intente nuevamente en unos minutos.',
        requestId,
      },
    });
    return;
  }

  // --- Cuerpo JSON malformado ----------------------------------------------
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: { code: 'VALIDACION', message: 'El cuerpo de la solicitud no es JSON valido.', requestId },
    });
    return;
  }

  // --- Limite de tamano de subida (multer) ---------------------------------
  const maybeMulter = err as { code?: string; message?: string };
  if (maybeMulter?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      error: {
        code: 'EVIDENCIA_INVALIDA',
        message: 'La fotografía supera el tamaño máximo permitido.',
        requestId,
      },
    });
    return;
  }

  // --- Cualquier otra cosa: se registra completo, se expone generico -------
  logger.error({ requestId, err, path: req.path, method: req.method }, 'Error no controlado.');
  res.status(500).json({
    error: {
      code: 'ERROR_INTERNO',
      message: 'Ocurrio un error inesperado. Si persiste, informe el identificador de la solicitud.',
      details: config.isProduction ? undefined : String(err),
      requestId,
    },
  });
}

function mapPrismaError(err: Prisma.PrismaClientKnownRequestError): {
  status: number;
  code: AppError['code'];
  message: string;
} {
  switch (err.code) {
    case 'P2002':
      return { status: 409, code: 'CONFLICTO', message: 'El registro ya existe (restricción de unicidad).' };
    case 'P2003':
      return { status: 409, code: 'CONFLICTO', message: 'La operación viola una relacion existente.' };
    case 'P2025':
      return { status: 404, code: 'NO_ENCONTRADO', message: 'El registro solicitado no existe.' };
    case 'P2034':
      return {
        status: 409,
        code: 'CONFLICTO',
        message: 'Conflicto de concurrencia. Vuelva a intentarlo.',
      };
    default:
      return { status: 500, code: 'ERROR_INTERNO', message: 'Error de base de datos.' };
  }
}

/** Envuelve un handler asincrono para que sus rechazos lleguen al errorHandler. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  fn: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}
