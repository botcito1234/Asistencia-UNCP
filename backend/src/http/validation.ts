/**
 * Esquemas de validacion de entrada.
 *
 * Toda entrada externa se valida antes de llegar al dominio. Zod produce el
 * error, el manejador central lo traduce a la respuesta 422 estandar.
 */
import { z } from 'zod';

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use el formato AAAA-MM-DD.')
  .refine((v) => !Number.isNaN(Date.parse(v + 'T00:00:00Z')), 'Fecha inexistente.');

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use el formato HH:mm (24 horas).');

export const uuid = z.string().uuid('Identificador inválido.');

export const dni = z.string().regex(/^[0-9]{8,12}$/, 'El DNI debe tener entre 8 y 12 digitos.');

export const pagination = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

// --- Autenticacion -----------------------------------------------------------

export const loginSchema = z.object({
  dni: dni,
  password: z.string().min(1, 'La contraseña es obligatoria.').max(200),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20, 'Token de renovación inválido.'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export const consentSchema = z.object({
  policyVersion: z.string().min(1).max(20),
  accepted: z.literal(true, { errorMap: () => ({ message: 'Debe aceptar la política para continuar.' }) }),
});

export const pushTokenSchema = z.object({
  token: z.string().min(10).max(255),
  platform: z.enum(['android', 'ios', 'web']).default('android'),
});

// --- Marcacion ---------------------------------------------------------------

/**
 * Los campos llegan en multipart junto con la fotografia, por eso todos son
 * texto y se convierten aqui.
 */
export const markSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracyMeters: z.coerce.number().min(0).max(100000),
  altitude: z.coerce.number().optional().nullable(),
  speed: z.coerce.number().optional().nullable(),
  locationAgeMs: z.coerce.number().int().min(0).max(86_400_000).optional().nullable(),
  mockLocationReported: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : ['true', '1', 'yes'].includes(v.toLowerCase()))),
  developerModeReported: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => (v === undefined ? false : typeof v === 'boolean' ? v : ['true', '1', 'yes'].includes(v.toLowerCase()))),
  deviceTime: z.string().datetime({ offset: true }).optional().nullable(),
  idempotencyKey: z.string().min(8).max(80).optional().nullable(),
});

/**
 * Incidente detectado EN EL TELEFONO que impidio llegar a enviar la marcacion
 * (ubicacion simulada, GPS sin la precision exigida). El servidor no puede
 * verificarlo, pero es una senal que debe quedar registrada y, si es critica,
 * notificarse al administrador.
 */
export const incidentReportSchema = z.object({
  tipo: z.enum(['UBICACION_SIMULADA', 'GPS_IMPRECISO', 'FUERA_DE_GEOCERCA']),
  tipoMarcacion: z.enum(['ENTRADA', 'SALIDA']),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  accuracyMeters: z.coerce.number().min(0).max(100000).optional().nullable(),
  distanceMeters: z.coerce.number().min(0).max(40000000).optional().nullable(),
  intentos: z.coerce.number().int().min(0).max(20).optional(),
  detalle: z.string().max(300).optional(),
});

// --- Sedes -------------------------------------------------------------------

export const createSiteSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_-]{2,30}$/, 'Código inválido: use A-Z, 0-9, guion o guion bajo.'),
  name: z.string().min(2).max(160),
  address: z.string().min(3).max(255),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().int().min(10).max(2000).optional(),
  timezone: z.string().min(3).max(60).optional(),
  active: z.boolean().optional(),
});

export const updateSiteSchema = createSiteSchema.partial();

// --- Practicantes ------------------------------------------------------------

export const scheduleSlotSchema = z.object({
  weekday: z.coerce.number().int().min(1).max(7),
  startTime: hhmm,
  endTime: hhmm.optional().nullable(),
});

export const createInternSchema = z.object({
  dni: dni,
  firstNames: z.string().min(2).max(120),
  lastNames: z.string().min(2).max(120),
  siteId: uuid,
  areaGroup: z.string().max(120).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email('Correo inválido.').max(160).optional().nullable().or(z.literal('')),
  password: z.string().min(8).max(200).optional().nullable(),
  schedule: z.array(scheduleSlotSchema).max(7).optional(),
});

export const updateInternSchema = z.object({
  firstNames: z.string().min(2).max(120).optional(),
  lastNames: z.string().min(2).max(120).optional(),
  siteId: uuid.optional(),
  areaGroup: z.string().max(120).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email().max(160).optional().nullable().or(z.literal('')),
  active: z.boolean().optional(),
});

export const replaceScheduleSchema = z.object({
  effectiveFrom: isoDate,
  slots: z.array(scheduleSlotSchema).max(7),
});

// --- Dispositivos ------------------------------------------------------------

export const revokeDeviceSchema = z.object({
  reason: z.string().min(5, 'Indique el motivo de la desvinculación.').max(255),
});

export const authorizeDeviceChangeSchema = z.object({
  reason: z.string().min(5, 'Indique el motivo de la autorización.').max(255),
});

// --- Regularizacion ----------------------------------------------------------

export const regularizeSchema = z.object({
  field: z.enum(['ENTRADA_HORA', 'SALIDA_HORA', 'PUNTUALIDAD', 'ESTADO_DIA', 'JUSTIFICACION']),
  newValue: z.string().min(1).max(255),
  reason: z.string().min(10, 'El motivo debe explicar el cambio (mínimo 10 caracteres).').max(500),
});

// --- Consultas ---------------------------------------------------------------

export const attendanceQuerySchema = pagination.extend({
  from: isoDate,
  to: isoDate,
  internId: uuid.optional(),
  siteId: uuid.optional(),
  status: z.enum(['PROGRAMADO', 'PRESENTE', 'AUSENTE', 'NO_LABORABLE']).optional(),
  punctuality: z.enum(['PUNTUAL', 'TARDANZA']).optional(),
  pendingExitOnly: z.coerce.boolean().optional(),
});

export const dashboardQuerySchema = z.object({
  date: isoDate,
  siteId: uuid.optional(),
});

export const securityQuerySchema = pagination.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  siteId: uuid.optional(),
  internId: uuid.optional(),
  type: z.string().max(60).optional(),
  severity: z.enum(['INFO', 'ADVERTENCIA', 'CRITICO']).optional(),
  onlyPending: z.coerce.boolean().optional(),
});

export const acknowledgeSchema = z.object({
  note: z.string().max(400).optional(),
});

// --- Reportes ----------------------------------------------------------------

export const reportQuerySchema = z.object({
  tipo: z.enum([
    'diario',
    'semanal',
    'mensual',
    'rango',
    'practicante',
    'sede',
    'consolidado',
    'puntualidad',
    'tardanzas',
    'faltas',
    'entradas',
    'salidas',
    'pendientes',
    'incidencias',
  ]),
  formato: z.enum(['excel', 'pdf']),
  from: isoDate,
  to: isoDate,
  siteId: uuid.optional(),
  internId: uuid.optional(),
});

// --- Parametros --------------------------------------------------------------

export const settingsSchema = z.object({
  checkinEarlyWindowMinutes: z.coerce.number().int().min(0).max(180).optional(),
  gpsMaxAccuracyMeters: z.coerce.number().min(5).max(200).optional(),
  gpsMaxAgeSeconds: z.coerce.number().int().min(5).max(600).optional(),
  defaultSiteRadiusMeters: z.coerce.number().int().min(10).max(2000).optional(),
  maxDeviceClockSkewSeconds: z.coerce.number().int().min(30).max(3600).optional(),
  retentionMonths: z.coerce.number().int().min(1).max(120).optional(),
  dayCloseLocalTime: hhmm.optional(),
  privacyPolicyVersion: z.string().max(20).optional(),
});

// --- Archivado ---------------------------------------------------------------

export const archiveRunSchema = z.object({
  siteId: uuid.optional(),
  year: z.coerce.number().int().min(2000).max(2200),
  month: z.coerce.number().int().min(1).max(12),
  /** Si es true, libera el almacenamiento local tras verificar la subida. */
  release: z.boolean().optional(),
});
