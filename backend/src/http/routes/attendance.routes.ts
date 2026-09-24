/**
 * Rutas de marcacion y consulta de asistencia.
 *
 * La marcacion viaja como multipart/form-data: los datos de ubicacion mas el
 * binario de la fotografia en un unico envio. Asi la evidencia y la marcacion
 * llegan juntas y el servidor nunca crea una asistencia sin foto.
 */
import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticate, requireRole, requireBoundDevice } from '../middleware/auth.js';
import { markRateLimit, incidentRateLimit } from '../middleware/rate-limit.js';
import { auditContextOf, deviceFingerprintOf } from '../middleware/context.js';
import {
  markSchema,
  attendanceQuerySchema,
  dashboardQuerySchema,
  regularizeSchema,
  incidentReportSchema,
  uuid,
} from '../validation.js';
import { registerMark } from '../../modules/attendance/attendance.service.js';
import {
  getTodayStatus,
  queryAttendance,
  getAttendanceDay,
  getDashboard,
  getInternSummary,
} from '../../modules/attendance/attendance.query.js';
import { regularize, listRegularizations } from '../../modules/attendance/regularization.service.js';
import { closeSiteDay } from '../../modules/attendance/day-closure.service.js';
import { config } from '../../config/env.js';
import { startOfLocalDay, endOfLocalDay } from '../../core/time.js';
import { haversineMeters, round2 } from '../../domain/geo.js';
import { errors } from '../../core/errors.js';
import { signEvidenceUrl } from '../../modules/evidence/evidence.service.js';
import { recordSecurityEvent } from '../../modules/security/security-event.service.js';
import { recordAudit } from '../../modules/audit/audit.service.js';
import { prisma } from '../../infra/db/prisma.js';

export const attendanceRouter: Router = Router();

/**
 * La foto se recibe en memoria: son archivos pequenos (< 5 MB) y de vida muy
 * corta; escribir a disco temporal antes de validar seria un paso de mas y
 * dejaria residuos si la validacion falla.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.EVIDENCE_MAX_BYTES, files: 1, fields: 20 },
  fileFilter: (_req, file, cb) => {
    if (!config.evidenceAllowedMime.includes(file.mimetype)) {
      cb(new Error('Formato de imagen no permitido: ' + file.mimetype));
      return;
    }
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// Practicante
// ---------------------------------------------------------------------------

/** GET /asistencia/hoy - estado del dia del practicante autenticado. */
attendanceRouter.get(
  '/hoy',
  authenticate(),
  requireRole('PRACTICANTE'),
  asyncHandler(async (req, res) => {
    const internId = req.auth!.internId;
    if (!internId) throw errors.forbidden('Solo los practicantes tienen estado de jornada.');
    res.json(await getTodayStatus(internId));
  }),
);

/** POST /asistencia/entrada */
attendanceRouter.post(
  '/entrada',
  authenticate(),
  requireRole('PRACTICANTE'),
  markRateLimit,
  requireBoundDevice(),
  upload.single('foto'),
  asyncHandler(async (req, res) => {
    res.status(201).json(await handleMark(req, 'ENTRADA'));
  }),
);

/** POST /asistencia/salida */
attendanceRouter.post(
  '/salida',
  authenticate(),
  requireRole('PRACTICANTE'),
  markRateLimit,
  requireBoundDevice(),
  upload.single('foto'),
  asyncHandler(async (req, res) => {
    res.status(201).json(await handleMark(req, 'SALIDA'));
  }),
);

type MarkKind = 'ENTRADA' | 'SALIDA';

async function handleMark(req: Parameters<typeof auditContextOf>[0], type: MarkKind) {
  const internId = req.auth!.internId;
  if (!internId) throw errors.forbidden('Solo los practicantes pueden registrar asistencia.');

  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw errors.validation('La fotografía es obligatoria. Debe capturarse con la cámara.');
  }

  const body = markSchema.parse(req.body);
  const fingerprint = deviceFingerprintOf(req);

  return registerMark({
    userId: req.auth!.userId,
    internId,
    type,
    location: {
      latitude: body.latitude,
      longitude: body.longitude,
      accuracyMeters: body.accuracyMeters,
      altitude: body.altitude ?? null,
      speed: body.speed ?? null,
      locationAgeMs: body.locationAgeMs ?? null,
      mockLocationReported: body.mockLocationReported,
      developerModeReported: body.developerModeReported,
    },
    deviceTime: body.deviceTime ? new Date(body.deviceTime) : null,
    deviceFingerprint: fingerprint as string,
    photo: file.buffer,
    idempotencyKey: body.idempotencyKey ?? req.header('idempotency-key') ?? null,
    context: auditContextOf(req),
  });
}

/**
 * POST /asistencia/incidente
 *
 * La aplicacion informa un intento que ella misma detuvo antes de enviar la
 * marcacion: ubicacion simulada, GPS sin la precision exigida o posicion fuera
 * del radio de la sede. Sin esto, esos intentos no dejarian rastro: el telefono
 * los corta antes de enviar nada, asi que el servidor jamas se entera de que
 * alguien intento marcar desde fuera o con ubicacion falsa. No crea asistencia:
 * solo el evento de seguridad, con aviso inmediato cuando es critico.
 */
attendanceRouter.post(
  '/incidente',
  authenticate(),
  requireRole('PRACTICANTE'),
  incidentRateLimit,
  requireBoundDevice(),
  asyncHandler(async (req, res) => {
    const internId = req.auth!.internId;
    if (!internId) throw errors.forbidden('Solo los practicantes informan incidentes de marcación.');

    const body = incidentReportSchema.parse(req.body);
    const intern = await prisma.intern.findUnique({
      where: { id: internId },
      select: { siteId: true, site: { select: { latitude: true, longitude: true, radiusMeters: true } } },
    });

    // La distancia la recalcula el servidor, igual que en una marcacion real:
    // el telefono informa donde cree estar, no a que distancia esta. Lo que
    // diga el cliente solo se usa si no mando coordenadas.
    const sede = intern?.site;
    const coordenadas =
      body.latitude !== undefined && body.latitude !== null && body.longitude !== undefined && body.longitude !== null
        ? { latitude: body.latitude, longitude: body.longitude }
        : null;
    const distancia =
      sede && coordenadas
        ? round2(
            haversineMeters(
              { latitude: Number(sede.latitude), longitude: Number(sede.longitude) },
              coordenadas,
            ),
          )
        : (body.distanceMeters ?? null);

    const mensaje =
      body.tipo === 'UBICACION_SIMULADA'
        ? 'La aplicación detectó una ubicación simulada y bloqueó la marcación de ' +
          body.tipoMarcacion.toLowerCase() +
          ' antes de enviarla.'
        : body.tipo === 'FUERA_DE_GEOCERCA'
        ? 'Intento de marcar ' +
          body.tipoMarcacion.toLowerCase() +
          ' fuera del radio de la sede' +
          (distancia !== null ? ' (a ' + Math.round(distancia) + ' m)' : '') +
          '; la aplicación no envió la marcación.'
        : 'La aplicación no obtuvo la precisión GPS exigida' +
          (body.accuracyMeters !== undefined && body.accuracyMeters !== null
            ? ' (mejor lectura: ' + Math.round(body.accuracyMeters) + ' m)'
            : '') +
          ' tras ' +
          (body.intentos ?? 0) +
          ' intento(s); no se envió la marcación.';

    await recordSecurityEvent({
      type: body.tipo,
      message: mensaje,
      internId,
      userId: req.auth!.userId,
      siteId: intern?.siteId ?? null,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      accuracyMeters: body.accuracyMeters ?? null,
      distanceMeters: distancia,
      deviceFingerprint: req.auth!.deviceFingerprint ?? null,
      ipAddress: auditContextOf(req).ipAddress,
      userAgent: auditContextOf(req).userAgent,
      details: {
        origen: 'telefono',
        tipoMarcacion: body.tipoMarcacion,
        intentos: body.intentos ?? null,
        detalle: body.detalle ?? null,
        radioSedeMetros: sede?.radiusMeters ?? null,
        distanciaInformadaPorElTelefono: body.distanceMeters ?? null,
      },
    });

    await recordAudit({
      ...auditContextOf(req),
      action: 'MARCACION_RECHAZADA',
      entityType: 'Intern',
      entityId: internId,
      reason: mensaje,
      after: { tipo: body.tipoMarcacion, motivo: body.tipo, origen: 'telefono' },
    });

    res.status(202).json({ registrado: true });
  }),
);

/** GET /asistencia/mi-historial */
attendanceRouter.get(
  '/mi-historial',
  authenticate(),
  requireRole('PRACTICANTE'),
  asyncHandler(async (req, res) => {
    const internId = req.auth!.internId;
    if (!internId) throw errors.forbidden('Solo los practicantes tienen historial propio.');

    const q = attendanceQuerySchema.parse({ ...req.query, internId });
    const [history, summary] = await Promise.all([
      queryAttendance({ ...q, internId }),
      getInternSummary(internId, q.from, q.to),
    ]);
    res.json({ ...history, summary });
  }),
);

// ---------------------------------------------------------------------------
// Administrador
// ---------------------------------------------------------------------------

/** GET /asistencia/tablero?date=YYYY-MM-DD[&siteId=] */
attendanceRouter.get(
  '/tablero',
  authenticate(),
  requireRole('ADMINISTRADOR'),
  asyncHandler(async (req, res) => {
    const q = dashboardQuerySchema.parse(req.query);
    res.json(await getDashboard(q));
  }),
);

/** GET /asistencia?from=&to=[&siteId=&internId=&status=&punctuality=&pendingExitOnly=] */
attendanceRouter.get(
  '/',
  authenticate(),
  requireRole('ADMINISTRADOR'),
  asyncHandler(async (req, res) => {
    const q = attendanceQuerySchema.parse(req.query);
    res.json(await queryAttendance(q));
  }),
);

/** GET /asistencia/:attendanceDayId - detalle con datos para el mapa. */
attendanceRouter.get(
  '/:attendanceDayId',
  authenticate(),
  asyncHandler(async (req, res) => {
    const id = uuid.parse(req.params.attendanceDayId);
    const day = await getAttendanceDay(id);

    // Un practicante solo puede abrir sus propias jornadas.
    if (req.auth!.role === 'PRACTICANTE' && day.intern.id !== req.auth!.internId) {
      throw errors.forbidden('Solo puede consultar sus propias jornadas.');
    }

    // Enlaces firmados de vida corta para mostrar las fotos sin exponer el token.
    const withPhotos = {
      ...day,
      checkIn: day.checkIn
        ? { ...day.checkIn, photoUrl: signEvidenceUrl(day.checkIn.evidenceId, req.auth!.userId).url }
        : null,
      checkOut: day.checkOut
        ? { ...day.checkOut, photoUrl: signEvidenceUrl(day.checkOut.evidenceId, req.auth!.userId).url }
        : null,
    };

    res.json(withPhotos);
  }),
);

/** POST /asistencia/:attendanceDayId/regularizar */
attendanceRouter.post(
  '/:attendanceDayId/regularizar',
  authenticate(),
  requireRole('ADMINISTRADOR'),
  asyncHandler(async (req, res) => {
    const id = uuid.parse(req.params.attendanceDayId);
    const body = regularizeSchema.parse(req.body);

    const result = await regularize({
      attendanceDayId: id,
      field: body.field,
      newValue: body.newValue,
      reason: body.reason,
      adminUserId: req.auth!.userId,
      context: auditContextOf(req),
    });

    res.status(201).json(result);
  }),
);

/** GET /asistencia/regularizaciones/listado */
attendanceRouter.get(
  '/regularizaciones/listado',
  authenticate(),
  requireRole('ADMINISTRADOR'),
  asyncHandler(async (req, res) => {
    const internId = typeof req.query.internId === 'string' ? req.query.internId : undefined;
    const from = typeof req.query.from === 'string' ? startOfLocalDay(req.query.from, config.APP_TIMEZONE) : undefined;
    const to = typeof req.query.to === 'string' ? endOfLocalDay(req.query.to, config.APP_TIMEZONE) : undefined;
    res.json(await listRegularizations({ internId, from, to }));
  }),
);

/**
 * POST /asistencia/cerrar-jornada
 * Ejecucion manual del cierre. La tarea programada hace lo mismo cada dia.
 */
attendanceRouter.post(
  '/cerrar-jornada',
  authenticate(),
  requireRole('ADMINISTRADOR'),
  asyncHandler(async (req, res) => {
    const siteId = uuid.parse(req.body?.siteId);
    const date = String(req.body?.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw errors.validation('Indique la fecha en formato AAAA-MM-DD.');
    const force = req.body?.force === true;

    res.json(await closeSiteDay(siteId, date, force));
  }),
);
