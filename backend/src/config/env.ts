/**
 * Carga y validacion de configuracion.
 *
 * Regla: ningun secreto vive en el codigo ni en el APK. Todo entra por variables
 * de entorno. El arranque falla ruidosamente si falta algo critico en
 * produccion, en lugar de degradarse en silencio.
 */
import "dotenv/config";
import { z } from "zod";
import path from "node:path";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v === ""
        ? def
        : ["1", "true", "yes", "on"].includes(v.toLowerCase()),
    );

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().int());

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number());

const webAdminOrigins = z
  .string()
  .transform((value) => value.split(",").map((origin) => origin.trim()))
  .pipe(
    z.array(
      z.string().refine((value) => {
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            ["", "/"].includes(url.pathname) &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      }, "Debe ser un origen HTTP(S) sin ruta.")
    ).min(1)
  )
  .transform((origins) => origins.map((origin) => new URL(origin).origin).join(","));

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: int(4000).pipe(z.number().min(1).max(65535)),
  HOST: z.string().default("0.0.0.0"),
  APP_NAME: z.string().default("NEXORA · Control de Asistencia"),
  APP_TIMEZONE: z.string().default("America/Lima"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:4000"),
  // Dominios exactos, separados por comas, para producción y previews de Vercel.
  WEB_ADMIN_ORIGIN: webAdminOrigins.default("https://localhost:5173"),
  TRUST_PROXY: bool(false),

  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatorio"),

  // --- Autenticacion -------------------------------------------------------
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET debe tener al menos 32 caracteres"),
  JWT_ISSUER: z.string().default("asistencia-api"),
  JWT_AUDIENCE: z.string().default("asistencia-clients"),
  ACCESS_TOKEN_TTL_MINUTES: int(15).pipe(z.number().min(1).max(60)),
  REFRESH_TOKEN_TTL_DAYS: int(30).pipe(z.number().min(1).max(365)),
  PASSWORD_MIN_LENGTH: int(8).pipe(z.number().min(8).max(128)),
  LOGIN_MAX_ATTEMPTS: int(5).pipe(z.number().min(1).max(20)),
  LOGIN_LOCK_MINUTES: int(15).pipe(z.number().min(1).max(1440)),

  // --- Reglas de marcacion -------------------------------------------------
  /** Minutos que se permite marcar antes de la hora programada. */
  CHECKIN_EARLY_WINDOW_MINUTES: int(15).pipe(z.number().min(0).max(720)),
  /** Precision GPS maxima aceptable, en metros. */
  GPS_MAX_ACCURACY_METERS: num(35).pipe(z.number().positive().max(1000)),
  /** Antiguedad maxima de la lectura GPS, en segundos. */
  GPS_MAX_AGE_SECONDS: int(60).pipe(z.number().min(1).max(3600)),
  /** Radio por defecto de una sede nueva, en metros. */
  DEFAULT_SITE_RADIUS_METERS: int(50).pipe(z.number().min(10).max(2000)),
  /** Desfase de reloj del dispositivo tolerado antes de levantar un evento. */
  MAX_DEVICE_CLOCK_SKEW_SECONDS: int(300).pipe(z.number().min(0).max(86400)),
  /** Hora local a la que se cierra la jornada y se calculan faltas (HH:mm). */
  DAY_CLOSE_LOCAL_TIME: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .refine((v) => {
      const [hours = -1, minutes = -1] = v.split(":").map(Number);
      return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
    }, "DAY_CLOSE_LOCAL_TIME debe ser una hora valida.")
    .default("23:30"),

  // --- Evidencias ----------------------------------------------------------
  STORAGE_ROOT: z.string().default(path.resolve(process.cwd(), "storage")),
  EVIDENCE_MAX_BYTES: int(5 * 1024 * 1024).pipe(
    z
      .number()
      .min(1024)
      .max(50 * 1024 * 1024),
  ),
  EVIDENCE_ALLOWED_MIME: z.string().default("image/jpeg,image/png,image/webp"),
  EVIDENCE_URL_TTL_MINUTES: int(10),
  RETENTION_MONTHS: int(6).pipe(z.number().min(1).max(120)),
  /** Limite de filas por carga masiva de practicantes. */
  BULK_IMPORT_MAX_ROWS: int(500).pipe(z.number().min(1).max(5000)),

  // --- Consulta de identidad peruana -------------------------------------
  // El token se mantiene solo en el backend y nunca se entrega al panel.
  DNI_LOOKUP_ENABLED: bool(false),
  DNI_LOOKUP_API_URL: z.string().url().default("https://dniruc.apisperu.com/api/v1/dni"),
  DNI_LOOKUP_API_TOKEN: z.string().optional().default(""),
  DNI_LOOKUP_TIMEOUT_MS: int(8000).pipe(z.number().min(1000).max(30000)),

  // --- Google Drive (opcional; sin credenciales el archivado queda en local) -
  GOOGLE_DRIVE_ENABLED: bool(false),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional().default(""),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional().default(""),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().optional().default(""),
  GOOGLE_DRIVE_SHARED_DRIVE_ID: z.string().optional().default(""),
  // Alternativa a la cuenta de servicio: autorizacion de un usuario real.
  // Hace falta cuando la organizacion no puede crear unidades compartidas,
  // porque una cuenta de servicio no tiene espacio propio en Drive.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().optional().default(""),

  // --- Google Maps Routes API (opcional) -------------------------------
  // La clave vive solo en el backend; nunca se envia al navegador ni al APK.
  GOOGLE_MAPS_ENABLED: bool(false),
  GOOGLE_MAPS_API_KEY: z.string().optional().default(""),
  GOOGLE_MAPS_TIMEOUT_MS: int(8000).pipe(z.number().min(1000).max(30000)),
  /**
   * Con true, cada fotografia se sube a Drive en segundo plano y la copia local
   * se borra en cuanto Drive confirma el mismo MD5. Permite hospedar la API sin
   * volumen persistente. Marcar asistencia NO depende de Drive: la fotografia
   * se guarda primero en disco y la subida ocurre despues.
   */
  EVIDENCE_REMOTE_STORAGE: bool(false),
  /** Minutos que se conserva la copia local despues de verificarla en Drive. */
  EVIDENCE_LOCAL_RETENTION_MINUTES: int(10),

  // --- Notificaciones ------------------------------------------------------
  PUSH_ENABLED: bool(false),
  FCM_PROJECT_ID: z.string().optional().default(""),
  FCM_CLIENT_EMAIL: z.string().optional().default(""),
  FCM_PRIVATE_KEY: z.string().optional().default(""),

  SMTP_ENABLED: bool(false),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: int(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  SMTP_FROM: z.string().optional().default("no-reply@localhost"),
  ALERT_EMAIL_RECIPIENTS: z.string().optional().default(""),

  // --- Operacion -----------------------------------------------------------
  ENABLE_CRON: bool(true),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  RATE_LIMIT_WINDOW_MINUTES: int(1),
  RATE_LIMIT_MAX_REQUESTS: int(300),
  LOGIN_RATE_LIMIT_MAX: int(10),
  MARK_RATE_LIMIT_MAX: int(20),
  PRIVACY_POLICY_VERSION: z.string().default("1.0"),
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
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Configuración inválida:\n${issues}\n\nRevise el archivo .env (use .env.example como base).`,
    );
  }
  const raw = parsed.data;

  const cfg: AppConfig = {
    ...raw,
    evidenceAllowedMime: raw.EVIDENCE_ALLOWED_MIME.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    alertEmailRecipients: raw.ALERT_EMAIL_RECIPIENTS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    isProduction: raw.NODE_ENV === "production",
    isTest: raw.NODE_ENV === "test",
  };

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: cfg.APP_TIMEZONE }).format();
  } catch {
    throw new Error("APP_TIMEZONE no es una zona horaria IANA valida.");
  }

  if (cfg.isProduction) {
    const problems: string[] = [];
    if (
      cfg.JWT_SECRET.includes("cambiar") ||
      cfg.JWT_SECRET.includes("changeme")
    ) {
      problems.push("JWT_SECRET conserva el valor de ejemplo.");
    }
    if (!cfg.PUBLIC_BASE_URL.startsWith("https://")) {
      problems.push("PUBLIC_BASE_URL debe usar https en producción.");
    }
    if (
      cfg.WEB_ADMIN_ORIGIN.split(",").some(
        (origin) =>
          !origin.startsWith("https://") &&
          !origin.startsWith("http://localhost")
      )
    ) {
      problems.push("WEB_ADMIN_ORIGIN debe usar https en produccion.");
    }
    // Drive admite dos formas de acceso y basta con una. La cuenta de servicio
    // solo sirve contra unidades compartidas; la autorizacion de un usuario
    // funciona con una carpeta normal. Exigir la primera dejaba fuera a quien
    // usa la segunda, que es la unica viable sin Workspace con unidades
    // compartidas.
    const conCuentaDeServicio = Boolean(
      cfg.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      cfg.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    );
    const conUsuario = Boolean(
      cfg.GOOGLE_OAUTH_CLIENT_ID &&
      cfg.GOOGLE_OAUTH_CLIENT_SECRET &&
      cfg.GOOGLE_OAUTH_REFRESH_TOKEN,
    );

    if (cfg.GOOGLE_DRIVE_ENABLED && !conCuentaDeServicio && !conUsuario) {
      problems.push(
        "GOOGLE_DRIVE_ENABLED=true pero no hay credenciales: complete " +
          "GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, " +
          "o GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET y GOOGLE_OAUTH_REFRESH_TOKEN.",
      );
    }
    if (cfg.GOOGLE_DRIVE_ENABLED && !cfg.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
      problems.push(
        "GOOGLE_DRIVE_ENABLED=true pero falta GOOGLE_DRIVE_ROOT_FOLDER_ID.",
      );
    }
    // Sin Drive, el almacenamiento remoto de evidencias no tiene donde subir:
    // la fotografia se quedaria en disco creyendo que va a viajar.
    if (cfg.EVIDENCE_REMOTE_STORAGE && !cfg.GOOGLE_DRIVE_ENABLED) {
      problems.push(
        "EVIDENCE_REMOTE_STORAGE=true exige GOOGLE_DRIVE_ENABLED=true.",
      );
    }
    if (cfg.GOOGLE_MAPS_ENABLED && !cfg.GOOGLE_MAPS_API_KEY) {
      problems.push("GOOGLE_MAPS_ENABLED=true exige GOOGLE_MAPS_API_KEY.");
    }
    if (cfg.DNI_LOOKUP_ENABLED && !cfg.DNI_LOOKUP_API_TOKEN) {
      problems.push("DNI_LOOKUP_ENABLED=true exige DNI_LOOKUP_API_TOKEN.");
    }
    if (problems.length) {
      throw new Error(
        `Configuración no apta para producción:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
      );
    }
  }

  return cfg;
}

export const config = load();

/** Normaliza la clave privada PEM que llega en una sola linea con \n escapados. */
export function normalizePrivateKey(key: string): string {
  return key.replace(/\n/g, "\n").trim();
}
