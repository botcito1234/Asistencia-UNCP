/**
 * Errores de dominio y de aplicacion con codigo estable.
 *
 * El codigo (`code`) es contrato publico: el cliente movil decide que mensaje
 * mostrar y que accion ofrecer a partir de el, no del texto libre.
 */

export type ErrorCode =
  // Autenticacion / autorizacion
  | 'CREDENCIALES_INVALIDAS'
  | 'CUENTA_INACTIVA'
  | 'CUENTA_BLOQUEADA'
  | 'TOKEN_INVALIDO'
  | 'TOKEN_EXPIRADO'
  | 'SESION_REVOCADA'
  | 'NO_AUTORIZADO'
  | 'PROHIBIDO'
  | 'PASSWORD_DEBIL'
  | 'CAMBIO_PASSWORD_REQUERIDO'
  // Dispositivo
  | 'DISPOSITIVO_NO_AUTORIZADO'
  | 'DISPOSITIVO_YA_VINCULADO'
  | 'SESION_SIMULTANEA'
  // Marcacion
  | 'SIN_HORARIO_HOY'
  | 'FUERA_DE_VENTANA'
  | 'ENTRADA_DUPLICADA'
  | 'SALIDA_DUPLICADA'
  | 'SALIDA_SIN_ENTRADA'
  | 'FUERA_DE_GEOCERCA'
  | 'GPS_IMPRECISO'
  | 'GPS_OBSOLETO'
  | 'UBICACION_SIMULADA'
  | 'SEDE_INACTIVA'
  | 'EVIDENCIA_REQUERIDA'
  | 'EVIDENCIA_INVALIDA'
  | 'EVIDENCIA_NO_ALMACENADA'
  // Generales
  | 'VALIDACION'
  | 'NO_ENCONTRADO'
  | 'CONFLICTO'
  | 'DEMASIADAS_SOLICITUDES'
  | 'DEPENDENCIA_EXTERNA'
  | 'ERROR_INTERNO';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;
  /** Informacion adicional que el cliente puede usar para guiar al usuario. */
  readonly meta?: Record<string, unknown>;
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    httpStatus = 400,
    options: { details?: unknown; meta?: Record<string, unknown>; expose?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = options.details;
    this.meta = options.meta;
    this.expose = options.expose ?? true;
  }
}

export const errors = {
  validation: (message: string, details?: unknown) => new AppError('VALIDACION', message, 422, { details }),
  notFound: (what: string) => new AppError('NO_ENCONTRADO', what + ' no encontrado.', 404),
  conflict: (code: ErrorCode, message: string, meta?: Record<string, unknown>) =>
    new AppError(code, message, 409, { meta }),
  unauthorized: (code: ErrorCode = 'NO_AUTORIZADO', message = 'Credenciales requeridas.') =>
    new AppError(code, message, 401),
  forbidden: (message = 'No tiene permisos para realizar esta acción.') => new AppError('PROHIBIDO', message, 403),
  internal: (message = 'Error interno del servidor.', cause?: unknown) =>
    new AppError('ERROR_INTERNO', message, 500, { expose: false, cause }),
  dependency: (message: string, cause?: unknown) =>
    new AppError('DEPENDENCIA_EXTERNA', message, 502, { expose: true, cause }),
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
