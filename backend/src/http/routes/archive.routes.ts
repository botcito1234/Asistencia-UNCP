import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { archiveRunSchema, uuid } from '../validation.js';
import { archivePeriod, listArchives, runRetentionSweep } from '../../modules/archive/archive.service.js';
import { checkDriveAccess, isDriveEnabled } from '../../infra/drive/drive.client.js';
import { verifyPeriodIntegrity } from '../../modules/evidence/evidence.service.js';
import { prisma } from '../../infra/db/prisma.js';
import { errors } from '../../core/errors.js';
import { getSettings } from '../../modules/settings/settings.service.js';
import { config } from '../../config/env.js';
import { startOfLocalDay, endOfLocalDay } from '../../core/time.js';

export const archiveRouter: Router = Router();

archiveRouter.use(authenticate(), requireRole('ADMINISTRADOR'));

/** GET /archivado - listado de lotes de archivado. */
archiveRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : undefined;
    const year = req.query.year ? Number(req.query.year) : undefined;
    const settings = await getSettings();
    res.json({
      retencionMeses: settings.retentionMonths,
      driveHabilitado: isDriveEnabled(),
      lotes: await listArchives({ siteId, year }),
    });
  }),
);

/** GET /archivado/drive/estado - diagnostico de la conexion con Drive. */
archiveRouter.get(
  '/drive/estado',
  asyncHandler(async (_req, res) => {
    res.json(await checkDriveAccess());
  }),
);

/** GET /archivado/integridad?from=&to=[&siteId=] - verifica hashes sin archivar. */
archiveRouter.get(
  '/integridad',
  asyncHandler(async (req, res) => {
    const from = typeof req.query.from === 'string' ? req.query.from : null;
    const to = typeof req.query.to === 'string' ? req.query.to : null;
    if (!from || !to) throw errors.validation('Indique el rango de fechas (from y to).');

    res.json(
      await verifyPeriodIntegrity(
        startOfLocalDay(from, config.APP_TIMEZONE),
        endOfLocalDay(to, config.APP_TIMEZONE),
        typeof req.query.siteId === 'string' ? req.query.siteId : undefined,
      ),
    );
  }),
);

/**
 * POST /archivado/ejecutar
 * Genera, sube y verifica. Libera el almacenamiento local solo si
 * `release: true` Y la verificacion remota fue satisfactoria.
 */
archiveRouter.post(
  '/ejecutar',
  asyncHandler(async (req, res) => {
    const body = archiveRunSchema.parse(req.body);

    if (body.siteId) {
      const result = await archivePeriod({
        siteId: body.siteId,
        year: body.year,
        month: body.month,
        release: body.release ?? false,
        actorUserId: req.auth!.userId,
      });
      res.json({ lotes: [result] });
      return;
    }

    // Sin sede indicada: se archiva el periodo en todas las sedes.
    const sites = await prisma.site.findMany({ select: { id: true } });
    const results = [];
    for (const s of sites) {
      try {
        results.push(
          await archivePeriod({
            siteId: s.id,
            year: body.year,
            month: body.month,
            release: body.release ?? false,
            actorUserId: req.auth!.userId,
          }),
        );
      } catch (e) {
        results.push({ siteId: s.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    res.json({ lotes: results });
  }),
);

/** POST /archivado/retencion - ejecuta manualmente el barrido de retencion. */
archiveRouter.post(
  '/retencion',
  asyncHandler(async (_req, res) => {
    res.json({ lotes: await runRetentionSweep() });
  }),
);

/** GET /archivado/:batchId - detalle de un lote. */
archiveRouter.get(
  '/:batchId',
  asyncHandler(async (req, res) => {
    const id = uuid.parse(req.params.batchId);
    const batch = await prisma.archiveBatch.findUnique({
      where: { id },
      include: { site: { select: { id: true, code: true, name: true } } },
    });
    if (!batch) throw errors.notFound('Lote de archivado');

    res.json({
      id: batch.id,
      site: batch.site,
      period: batch.year + '-' + String(batch.month).padStart(2, '0'),
      status: batch.status,
      attendanceDays: batch.attendanceDays,
      marksCount: batch.marksCount,
      photosCount: batch.photosCount,
      eventsCount: batch.eventsCount,
      packageBytes: batch.packageBytes,
      packageSha256: batch.packageSha256,
      driveFileId: batch.driveFileId,
      driveWebLink: batch.driveWebLink,
      driveFolderId: batch.driveFolderId,
      startedAt: batch.startedAt?.toISOString() ?? null,
      uploadedAt: batch.uploadedAt?.toISOString() ?? null,
      verifiedAt: batch.verifiedAt?.toISOString() ?? null,
      releasedAt: batch.releasedAt?.toISOString() ?? null,
      lastError: batch.lastError,
      attempts: batch.attempts,
    });
  }),
);
