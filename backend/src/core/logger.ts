import pino from 'pino';
import { config } from '../config/env.js';

/**
 * Logger estructurado. Redacta credenciales y datos sensibles de forma
 * preventiva: los logs salen del proceso y nunca deben contener contrasenas,
 * tokens ni claves privadas.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  base: { app: 'asistencia-api', env: config.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'currentPassword',
      'newPassword',
      'passwordHash',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
      'refreshToken',
      'accessToken',
      'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
      'FCM_PRIVATE_KEY',
      'SMTP_PASSWORD',
    ],
    censor: '[REDACTADO]',
  },
});

export type Logger = typeof logger;
