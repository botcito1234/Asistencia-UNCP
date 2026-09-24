import { Router } from 'express';
import type { SecurityEventType, SecuritySeverity } from '@prisma/client';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { auditContextOf } from '../middleware/context.js';
import { securityQuerySchema, acknowledgeSchema, uuid } from '../validation.js';
import {
  querySecurityEvents,
  acknowledgeEvent,
  securityEventSummary,
} from '../../modules/security/security-event.service.js';
import { recordAudit } from '../../modules/audit/audit.service.js';
import { queryAudit } from '../../modules/audit/audit.service.js';
import { errors } from '../../core/errors.js';
import { config } from '../../config/env.js';
import { startOfLocalDay, endOfLocalDay } from '../../core/time.js';

export const securityRouter: Router = Router();

securityRouter.use(authenticate(), requireRole('ADMINISTRADOR'));

/** GET /seguridad/eventos */
securityRouter.get(
  '/eventos',
  asyncHandler(async (req, res) => {
    const q = securityQuerySchema.parse(req.query);
    res.json(
      await querySecurityEvents({
        from: q.from ? startOfLocalDay(q.from, config.APP_TIMEZONE) : undefined,
        to: q.to ? endOfLocalDay(q.to, config.APP_TIMEZONE) : undefined,
        siteId: q.siteId,
        internId: q.internId,
        type: q.type as SecurityEventType | undefined,
        severity: q.severity as SecuritySeverity | undefined,
        onlyPending: q.onlyPending,
        page: q.page,
        pageSize: q.pageSize,
      }),
    );
  }),
);

/** GET /seguridad/resumen?from=&to=[&siteId=] */
securityRouter.get(
  '/resumen',
  asyncHandler(async (req, res) => {
    const q = securityQuerySchema.parse(req.query);
    if (!q.from || !q.to) throw errors.validation('Indique el rango de fechas (from y to).');
    res.json(await securityEventSummary(
        startOfLocalDay(q.from, config.APP_TIMEZONE),
        endOfLocalDay(q.to, config.APP_TIMEZONE),
        q.siteId,
      ));
  }),
);

/** POST /seguridad/eventos/:eventId/atender */
securityRouter.post(
  '/eventos/:eventId/atender',
  asyncHandler(async (req, res) => {
    const eventId = uuid.parse(req.params.eventId);
    const body = acknowledgeSchema.parse(req.body ?? {});

    const ok = await acknowledgeEvent(eventId, req.auth!.userId, body.note);
    if (!ok) throw errors.notFound('Evento de seguridad');

    await recordAudit({
      ...auditContextOf(req),
      action: 'EVENTO_SEGURIDAD_ATENDIDO',
      entityType: 'SecurityEvent',
      entityId: eventId,
      reason: body.note ?? null,
    });

    res.json({ ok: true });
  }),
);

/** GET /seguridad/auditoria - bitacora completa. */
securityRouter.get(
  '/auditoria',
  asyncHandler(async (req, res) => {
    res.json(
      await queryAudit({
        entityType: typeof req.query.entityType === 'string' ? req.query.entityType : undefined,
        entityId: typeof req.query.entityId === 'string' ? req.query.entityId : undefined,
        actorUserId: typeof req.query.actorUserId === 'string' ? req.query.actorUserId : undefined,
        action: typeof req.query.action === 'string' ? req.query.action : undefined,
        from: typeof req.query.from === 'string' ? startOfLocalDay(req.query.from, config.APP_TIMEZONE) : undefined,
        to: typeof req.query.to === 'string' ? endOfLocalDay(req.query.to, config.APP_TIMEZONE) : undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      }),
    );
  }),
);
