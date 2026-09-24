/**
 * Carga y validacion de configuracion.
 *
 * Regla: ningun secreto vive en el codigo ni en el APK. Todo entra por variables
 * de entorno. El arranque falla ruidosamente si falta algo critico en
 * produccion, en lugar de degradarse en silencio.
 */
import 'dotenv/config';
import { z } from 'zod';
import path from 'node:path';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int());

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(4000),
  HOST: z.string().default('0.0.0.0'),
  APP_NAME: z.string().default('Control de Asistencia'),
  APP_TIMEZONE: z.string().default('America/Lima'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:4000'),
  WEB_ADMIN_ORIGIN: z.string().default('http://localhost:5173'),
  TRUST_PROXY: bool(false),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatorio'),

  // --- Autenticacion -------------------------------------------------------
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_ISSUER: z.string().default('asistencia-api'),
  JWT_AUDIENCE: z.string().default('asistencia-clients'),
  ACCESS_TOKEN_TTL_MINUTES: int(15),
  REFRESH_TOKEN_TTL_DAYS: int(30),
  PASSWORD_MIN_LENGTH: int(8),
  LOGIN_MAX_ATTEMPTS: int(5),
  LOGIN_LOCK_MINUTES: int(15),

  // --- Reglas de marcacion -------------------------------------------------
  /** Minutos que se permite marcar antes de la hora programada. */
  CHECKIN_EARLY_WINDOW_MINUTES: int(15),
  /** Precision GPS maxima aceptable, en metros. */
  GPS_MAX_ACCURACY_METERS: num(35),
  /** Antiguedad maxima de la lectura GPS, en segundos. */
  GPS_MAX_AGE_SECONDS: int(60),
  /** Radio por defecto de una sede nueva, en metros. */
  DEFAULT_SITE_RADIUS_METERS: int(50),
  /** Desfase de reloj del dispositivo tolerado antes de levantar un evento. */
  MAX_DEVICE_CLOCK_SKEW_SECONDS: int(300),
  /** Hora local a la que se cierra la jornada y se calculan faltas (HH:mm). */
  DAY_CLOSE_LOCAL_TIME: z.string().regex(/^\d{2}:\d{2}$/).default('23:30'),

  // --- Evidencias ----------------------------------------------------------
  STORAGE_ROOT: z.string().default(path.resolve(process.cwd(), 'storage')),
  EVIDENCE_MAX_BYTES: int(5 * 1024 * 1024),
  EVIDENCE_ALLOWED_MIME: z.string().default('image/jpeg,image/png,image/webp'),
  EVIDENCE_URL_TTL_MINUTES: int(10),
  RETENTION_MONTHS: int(6),

  // --- Google Drive (opcional; sin credenciales el archivado queda en local) -
  GOOGLE_DRIVE_ENABLED: bool(false),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional().default(''),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional().default(''),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().optional().default(''),
  GOOGLE_DRIVE_SHARED_DRIVE_ID: z.string().optional().default(''),
  // Alternativa a la cuenta de servicio: autorizacion de un usuario real.
  // Hace falta cuando la organizacion no puede crear unidades compartidas,
  // porque una cuenta de servicio no tiene espacio propio en Drive.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().optional().default(''),

  // --- Notificaciones ------------------------------------------------------
  PUSH_ENABLED: bool(false),
  FCM_PROJECT_ID: z.string().optional().default(''),
  FCM_CLIENT_EMAIL: z.string().optional().default(''),
  FCM_PRIVATE_KEY: z.string().optional().default(''),

  SMTP_ENABLED: bool(false),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: int(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default('no-reply@localhost'),
  ALERT_EMAIL_RECIPIENTS: z.string().optional().default(''),

  // --- Operacion -----------------------------------------------------------
  ENABLE_CRON: bool(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  RATE_LIMIT_WINDOW_MINUTES: int(1),
  RATE_LIMIT_MAX_REQUESTS: int(300),
  LOGIN_RATE_LIMIT_MAX: int(10),
  MARK_RATE_LIMIT_MAX: int(20),
  PRIVACY_POLICY_VERSION: z.string().default('1.0'),
});

export type AppConfig = z.infer<typeof schema> & {
  evidenceAllowedMime: string[];
  alertEmailRecipients: string[];
  isProduction: boolean;
  isTest: boolean;
};

function load(): AppConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${issues}\n\nRevise el archivo .env (use .env.example como base).`);
  }
  const raw = parsed.data;

  const cfg: AppConfig = {
    ...raw,
    evidenceAllowedMime: raw.EVIDENCE_ALLOWED_MIME.split(',').map((s) => s.trim()).filter(Boolean),
    alertEmailRecipients: raw.ALERT_EMAIL_RECIPIENTS.split(',').map((s) => s.trim()).filter(Boolean),
    isProduction: raw.NODE_ENV === 'production',
    isTest: raw.NODE_ENV === 'test',
  };

  if (cfg.isProduction) {
    const problems: string[] = [];
    if (cfg.JWT_SECRET.includes('cambiar') || cfg.JWT_SECRET.includes('changeme')) {
      problems.push('JWT_SECRET conserva el valor de ejemplo.');
    }
    if (!cfg.PUBLIC_BASE_URL.startsWith('https://')) {
      problems.push('PUBLIC_BASE_URL debe usar https en producción.');
    }
    if (cfg.GOOGLE_DRIVE_ENABLED && !cfg.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
      problems.push('GOOGLE_DRIVE_ENABLED=true pero falta GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.');
    }
    if (problems.length) {
      throw new Error(`Configuración no apta para producción:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    }
  }

  return cfg;
}

export const config = load();

/** Normaliza la clave privada PEM que llega en una sola linea con \n escapados. */
export function normalizePrivateKey(key: string): string {
  return key.replace(/\n/g, '\n').trim();
}
