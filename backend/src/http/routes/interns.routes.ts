import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { auditContextOf } from '../middleware/context.js';
import {
  createInternSchema,
  updateInternSchema,
  replaceScheduleSchema,
  revokeDeviceSchema,
  authorizeDeviceChangeSchema,
  uuid,
  isoDate,
} from '../validation.js';
import * as internService from '../../modules/interns/intern.service.js';
import {
  replaceWeeklySchedule,
  getScheduleHistory,
  getCurrentWeeklySchedule,
} from '../../modules/schedules/schedule.service.js';
import { listBindings, revokeBinding, authorizeDeviceChange, pendingAuthorization } from '../../modules/devices/device.service.js';
import { resetPassword } from '../../modules/auth/auth.service.js';
import { businessDateString, addMonthsToDateString } from '../../core/time.js';
import { config } from '../../config/env.js';
import { prisma } from '../../infra/db/prisma.js';
import { errors } from '../../core/errors.js';

export const internsRouter: Router = Router();

internsRouter.use(authenticate(), requireRole('ADMINISTRADOR'));

/** GET /practicantes?siteId=&search=&includeInactive= */
internsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(
      await internService.listInterns({
        siteId: typeof req.query.siteId === 'string' ? req.query.siteId : undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        includeInactive: req.query.includeInactive === 'true',
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      }),
    );
  }),
);

internsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createInternSchema.parse(req.body);
    const result = await internService.createIntern(
      {
        ...body,
        email: body.email === '' ? null : body.email,
      },
      req.auth!.userId,
      auditContextOf(req),
    );
    res.status(201).json(result);
  }),
);

internsRouter.get(
  '/:internId',
  asyncHandler(async (req, res) => {
    res.json(await internService.getIntern(uuid.parse(req.params.internId)));
  }),
);

/** GET /practicantes/:internId/ficha?from=&to= - ficha completa. */
internsRouter.get(
  '/:internId/ficha',
  asyncHandler(async (req, res) => {
    const internId = uuid.parse(req.params.internId);
    const today = businessDateString(new Date(), config.APP_TIMEZONE);
    const from = typeof req.query.from === 'string' ? isoDate.parse(req.query.from) : addMonthsToDateString(today, -1);
    const to = typeof req.query.to === 'string' ? isoDate.parse(req.query.to) : today;
    res.json(await internService.getInternProfile(internId, from, to));
  }),
);

internsRouter.patch(
  '/:internId',
  asyncHandler(async (req, res) => {
    const internId = uuid.parse(req.params.internId);
    const body = updateInternSchema.parse(req.body);
    res.json(
      await internService.updateIntern(
        internId,
        { ...body, email: body.email === '' ? null : body.email },
        req.auth!.userId,
        auditContextOf(req),
      ),
    );
  }),
);

/** Desactivacion: nunca se elimina fisicamente. */
internsRouter.delete(
  '/:internId',
  asyncHandler(async (req, res) => {
    const internId = uuid.parse(req.params.internId);
    res.json(await internService.updateIntern(internId, { active: false }, req.auth!.userId, auditContextOf(req)));
  }),
);

// ---------------------------------------------------------------------------
// Horarios
// ---------------------------------------------------------------------------

internsRouter.get(
  '/:internId/horario',
  asyncHandler(async (req, res) => {
    const internId = uuid.parse(req.params.internId);
    const today = businessDateString(new Date(), config.APP_TIMEZONE);
    const [vigente, historial] = await Promise.all([
      getCurrentWeeklySchedule(internId, today),
      getScheduleHistory(internId),
    ]);
    res.json({ vigente, historial });
  }),
);

/**
 * PUT /practicantes/:internId/horario
 * Crea una nueva vigencia. El horario anterior se conserva cerrado.
 */
internsRouter.put(
  '/:internId/horario',
  asyncHandler(async (req, res) => {
    const internId = uuid.parse(req.params.internId);
    const body = replaceScheduleSchema.parse(req.body);

    await replaceWeeklySchedule(
      internId,
      body.slots.map((s) => ({ weekday: s.weekday, startTime: s.startTime, endTime: s.endTime ?? null })),
      body.effectiveFrom,
      req.auth!.userId,
      auditContextOf(req),
    );

    res.json({ vigente: await getCurrentWeeklySchedule(internId, body.effectiveFrom) });
  }),
);

// ---------------------------------------------------------------------------
// Dispositivo
// ---------------------------------------------------------------------------

internsRouter.get(
  '/:internId/dispositivos',
  asyncHandler(async (req, res) => {
    const internId = uuid.parse(req.params.internId);
    const intern = await prisma.intern.findUnique({ where: { id: internId }, select: { userId: true } });
    if (!intern) throw errors.notFound('Practicante');

    const [bindings, authorization] = await Promise.all([
      listBindings(intern.userId),
      pendingAuthorization(intern.userId),
    ]);

    res.json({
      dispositivos: bindings.map((b) => ({
        id: b.id,
        platform: b.platform,
        model: b.model,
        osVersion: b.osVersion,
        appVersion: b.appVersion,
        status: b.status,
        boundAt: b.boundAt.toISOString(),
        lastSeenAt: b.lastSeenAt.toISOString(),
        revokedAt: b.revokedAt?.toISOString() ?? null,
        revokedBy: b.revoker?.displayName ?? null,
        revokeReason: b.revokeReason,
      })),
      cambioAutorizado: authorization
        ? { id: authorization.id, expiresAt: authorization.expiresAt.toISOString(), reason: authorization.reason }
        : null,
    });
  }),
);

/** DELETE /practicantes/:internId/dispositivos/:bindingId - desvincula el telefono. */
internsRouter.delete(
  '/:internId/dispositivos/:bindingId',
  asyncHandler(async (req, res) => {
    const bindingId = uuid.parse(req.params.bindingId);
    const body = revokeDeviceSchema.parse(req.body);
    await revokeBinding(bindingId, req.auth!.userId, body.reason, auditContextOf(req));
    res.json({ ok: true, message: 'Dispositivo desvinculado. El practicante podrá vincular uno nuevo al iniciar sesión.' });
  }),
);

/**
 * POST /practicantes/:internId/dispositivos/autorizar-cambio
 * Emite un permiso de un solo uso, valido 48 horas, para vincular otro telefono.
 */
internsRouter.post(
  '/:internId/dispositivos/autorizar-cambio',
  asyncHandler(async (req, res) => {
    const internId = uuid.parse(req.params.internId);
    const body = authorizeDeviceChangeSchema.parse(req.body);

    const intern = await prisma.intern.findUnique({ where: { id: internId }, select: { userId: true } });
    if (!intern) throw errors.notFound('Practicante');

    const result = await authorizeDeviceChange(intern.userId, req.auth!.userId, body.reason, auditContextOf(req));
    res.status(201).json({
      ok: true,
      expiresAt: result.expiresAt.toISOString(),
      message: 'El practicante podrá vincular un nuevo teléfono en su próximo inicio de sesión.',
    });
  }),
);

// ---------------------------------------------------------------------------
// Credenciales
// ---------------------------------------------------------------------------

/** POST /practicantes/:internId/restablecer-password */
internsRouter.post(
  '/:internId/restablecer-password',
  asyncHandler(async (req, res) => {
    const internId = uuid.parse(req.params.internId);
    const intern = await prisma.intern.findUnique({ where: { id: internId }, select: { userId: true } });
    if (!intern) throw errors.notFound('Practicante');

    const result = await resetPassword(intern.userId, req.auth!.userId, auditContextOf(req));

    res.json({
      ok: true,
      dni: result.dni,
      // Se muestra una unica vez. No queda en logs ni en la auditoria.
      temporaryPassword: result.temporaryPassword,
      message: 'Entregue esta contraseña temporal al practicante. Deberá cambiarla al iniciar sesión.',
    });
  }),
);
