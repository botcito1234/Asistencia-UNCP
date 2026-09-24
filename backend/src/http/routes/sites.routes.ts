import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { auditContextOf } from '../middleware/context.js';
import { createSiteSchema, updateSiteSchema, uuid, isoDate } from '../validation.js';
import * as siteService from '../../modules/sites/site.service.js';
import { getDashboard } from '../../modules/attendance/attendance.query.js';
import { businessDateString } from '../../core/time.js';
import { config } from '../../config/env.js';

export const sitesRouter: Router = Router();

sitesRouter.use(authenticate());

/** GET /sedes - todos los administradores ven todas las sedes. */
sitesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const withCounts = req.query.withCounts !== 'false';
    res.json(await siteService.listSites({ includeInactive, withCounts }));
  }),
);

sitesRouter.get(
  '/:siteId',
  asyncHandler(async (req, res) => {
    res.json(await siteService.getSite(uuid.parse(req.params.siteId)));
  }),
);

/** GET /sedes/:siteId/tablero?date= - panel de una sede concreta. */
sitesRouter.get(
  '/:siteId/tablero',
  requireRole('ADMINISTRADOR'),
  asyncHandler(async (req, res) => {
    const siteId = uuid.parse(req.params.siteId);
    const date =
      typeof req.query.date === 'string'
        ? isoDate.parse(req.query.date)
        : businessDateString(new Date(), config.APP_TIMEZONE);

    const board = await getDashboard({ date, siteId });
    const site = await siteService.getSite(siteId);
    res.json({ site, date, board: board.sites[0] ?? null, totals: board.totals });
  }),
);

sitesRouter.post(
  '/',
  requireRole('ADMINISTRADOR'),
  asyncHandler(async (req, res) => {
    const body = createSiteSchema.parse(req.body);
    const site = await siteService.createSite(body, req.auth!.userId, auditContextOf(req));
    res.status(201).json(site);
  }),
);

sitesRouter.patch(
  '/:siteId',
  requireRole('ADMINISTRADOR'),
  asyncHandler(async (req, res) => {
    const siteId = uuid.parse(req.params.siteId);
    const body = updateSiteSchema.parse(req.body);
    res.json(await siteService.updateSite(siteId, body, req.auth!.userId, auditContextOf(req)));
  }),
);

/** Desactivacion: una sede nunca se elimina fisicamente. */
sitesRouter.delete(
  '/:siteId',
  requireRole('ADMINISTRADOR'),
  asyncHandler(async (req, res) => {
    const siteId = uuid.parse(req.params.siteId);
    res.json(await siteService.updateSite(siteId, { active: false }, req.auth!.userId, auditContextOf(req)));
  }),
);
