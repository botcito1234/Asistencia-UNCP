/**
 * Acceso a evidencias fotograficas.
 *
 * Dos caminos, ambos auditados:
 *  - Con token Bearer (aplicacion movil, descargas del panel).
 *  - Con enlace firmado de vida corta (etiquetas <img> del panel, que no pueden
 *    enviar cabeceras).
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticate } from '../middleware/auth.js';
import { auditContextOf } from '../middleware/context.js';
import { uuid } from '../validation.js';
import {
  getEvidenceMetadata,
  readEvidence,
  signEvidenceUrl,
  verifyEvidenceSignature,
} from '../../modules/evidence/evidence.service.js';
import { prisma } from '../../infra/db/prisma.js';
import { errors } from '../../core/errors.js';

export const evidenceRouter: Router = Router();

/** GET /evidencias/:evidenceId - metadatos (hash, tamano, origen). */
evidenceRouter.get(
  '/:evidenceId',
  authenticate(),
  asyncHandler(async (req, res) => {
    const id = uuid.parse(req.params.evidenceId);
    res.json(
      await getEvidenceMetadata(id, {
        userId: req.auth!.userId,
        role: req.auth!.role,
        internId: req.auth!.internId,
      }),
    );
  }),
);

/** GET /evidencias/:evidenceId/url-firmada - enlace temporal para mostrar la imagen. */
evidenceRouter.get(
  '/:evidenceId/url-firmada',
  authenticate(),
  asyncHandler(async (req, res) => {
    const id = uuid.parse(req.params.evidenceId);
    // Valida permiso antes de firmar.
    await getEvidenceMetadata(id, {
      userId: req.auth!.userId,
      role: req.auth!.role,
      internId: req.auth!.internId,
    });
    res.json(signEvidenceUrl(id, req.auth!.userId));
  }),
);

/**
 * GET /evidencias/:evidenceId/imagen
 * Acepta Bearer o firma (?uid=&exp=&sig=).
 */
evidenceRouter.get(
  '/:evidenceId/imagen',
  asyncHandler(async (req, res, next) => {
    const id = uuid.parse(req.params.evidenceId);
    const sig = typeof req.query.sig === 'string' ? req.query.sig : null;
    const uid = typeof req.query.uid === 'string' ? req.query.uid : null;
    const exp = typeof req.query.exp === 'string' ? Number(req.query.exp) : NaN;

    if (sig && uid) {
      if (!verifyEvidenceSignature(id, uid, exp, sig)) {
        throw errors.unauthorized('TOKEN_INVALIDO', 'El enlace de la imagen expiró o es inválido.');
      }
      const user = await prisma.userAccount.findUnique({
        where: { id: uid },
        select: { id: true, role: true, status: true, intern: { select: { id: true } } },
      });
      if (!user || user.status !== 'ACTIVO') {
        throw errors.unauthorized('CUENTA_INACTIVA', 'El usuario del enlace ya no está activo.');
      }

      const content = await readEvidence(
        id,
        { userId: user.id, role: user.role, internId: user.intern?.id ?? null },
        { ...auditContextOf(req), actorUserId: user.id, actorRole: user.role },
      );
      sendImage(res, content);
      return;
    }

    // Sin firma: exige autenticacion normal.
    authenticate()(req, res, (err?: unknown) => {
      if (err) return next(err);
      void (async () => {
        try {
          const content = await readEvidence(
            id,
            { userId: req.auth!.userId, role: req.auth!.role, internId: req.auth!.internId },
            auditContextOf(req),
          );
          sendImage(res, content);
        } catch (e) {
          next(e);
        }
      })();
    });
  }),
);

/** GET /evidencias/:evidenceId/descargar - descarga con nombre de archivo. */
evidenceRouter.get(
  '/:evidenceId/descargar',
  authenticate(),
  asyncHandler(async (req, res) => {
    const id = uuid.parse(req.params.evidenceId);
    const content = await readEvidence(
      id,
      { userId: req.auth!.userId, role: req.auth!.role, internId: req.auth!.internId },
      auditContextOf(req),
      { download: true },
    );

    res.setHeader('content-type', content.mimeType);
    res.setHeader('content-disposition', 'attachment; filename="' + content.filename + '"');
    res.setHeader('x-evidence-sha256', content.sha256);
    res.setHeader('x-evidence-integrity', content.integrityOk ? 'ok' : 'alterada');
    res.send(content.buffer);
  }),
);

function sendImage(
  res: Parameters<typeof asyncHandler>[0] extends never ? never : import('express').Response,
  content: { buffer: Buffer; mimeType: string; sha256: string; integrityOk: boolean },
): void {
  res.setHeader('content-type', content.mimeType);
  // Cache privada y corta: la imagen es un dato personal, no debe quedar en
  // caches compartidas ni en proxies.
  res.setHeader('cache-control', 'private, max-age=300, no-transform');
  res.setHeader('x-evidence-sha256', content.sha256);
  res.setHeader('x-evidence-integrity', content.integrityOk ? 'ok' : 'alterada');
  res.send(content.buffer);
}
