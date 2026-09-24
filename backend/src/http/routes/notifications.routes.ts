import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { auditContextOf } from '../middleware/context.js';
import { uuid, settingsSchema } from '../validation.js';
import {
  listNotifications,
  markAsRead,
  markAllAsRead,
} from '../../modules/notifications/notification.service.js';
import { addSubscriber, removeSubscriber, subscriberCount } from '../../modules/notifications/realtime.js';
import { getSettings, updateSettings } from '../../modules/settings/settings.service.js';
import { recordAudit } from '../../modules/audit/audit.service.js';
import { AppError, errors } from '../../core/errors.js';
import { prisma } from '../../infra/db/prisma.js';
import { verifyAccessToken, assertSessionActive } from '../../modules/auth/token.service.js';
import { isPushEnabled } from '../../infra/push/fcm.js';
import { isMailEnabled } from '../../infra/mail/mailer.js';

export const notificationsRouter: Router = Router();

/** GET /notificaciones */
notificationsRouter.get(
  '/',
  authenticate(),
  asyncHandler(async (req, res) => {
    res.json(
      await listNotifications({
        userId: req.auth!.userId,
        isAdmin: req.auth!.role === 'ADMINISTRADOR',
        onlyUnread: req.query.onlyUnread === 'true',
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      }),
    );
  }),
);

notificationsRouter.post(
  '/:notificationId/leida',
  authenticate(),
  asyncHandler(async (req, res) => {
    const id = uuid.parse(req.params.notificationId);
    const ok = await markAsRead(id, req.auth!.userId, req.auth!.role === 'ADMINISTRADOR');
    if (!ok) throw errors.notFound('Notificación');
    res.json({ ok: true });
  }),
);

notificationsRouter.post(
  '/leer-todas',
  authenticate(),
  asyncHandler(async (req, res) => {
    const count = await markAllAsRead(req.auth!.userId, req.auth!.role === 'ADMINISTRADOR');
    res.json({ ok: true, marcadas: count });
  }),
);

/**
 * GET /notificaciones/stream - canal en tiempo real (SSE) para el panel.
 *
 * EventSource del navegador no permite cabeceras personalizadas, asi que el
 * token viaja por query string. Se acepta unicamente aqui, la conexion no
 * transporta datos de negocio en la URL y el token sigue siendo de vida corta.
 */
notificationsRouter.get(
  '/stream',
  asyncHandler(async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : null;
    if (!token) throw errors.unauthorized('NO_AUTORIZADO', 'Falta el token de acceso.');

    const claims = await verifyAccessToken(token);
    await assertSessionActive(claims.sid);

    // Misma regla que el resto de rutas: sin contrasena definitiva no hay canal.
    const usuario = await prisma.userAccount.findUnique({
      where: { id: claims.sub },
      select: { status: true, mustChangePassword: true },
    });
    if (!usuario || usuario.status !== 'ACTIVO') {
      throw errors.unauthorized('CUENTA_INACTIVA', 'La cuenta no está activa.');
    }
    if (usuario.mustChangePassword) {
      throw new AppError('CAMBIO_PASSWORD_REQUERIDO', 'Debe cambiar su contraseña antes de continuar.', 403);
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    res.write('event: ping\ndata: {"ok":true}\n\n');

    const subscriberId = randomUUID();
    addSubscriber(subscriberId, claims.sub, res);

    req.on('close', () => removeSubscriber(subscriberId));
  }),
);

// ---------------------------------------------------------------------------
// Parametros operativos
// ---------------------------------------------------------------------------

export const settingsRouter: Router = Router();

settingsRouter.use(authenticate(), requireRole('ADMINISTRADOR'));

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      parametros: await getSettings(),
      canales: {
        inApp: true,
        tiempoReal: { activo: true, suscriptores: subscriberCount() },
        push: isPushEnabled(),
        correo: isMailEnabled(),
      },
    });
  }),
);

settingsRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    const body = settingsSchema.parse(req.body);
    const before = await getSettings();
    const after = await updateSettings(body, req.auth!.userId);

    await recordAudit({
      ...auditContextOf(req),
      action: 'PARAMETROS_ACTUALIZADOS',
      entityType: 'AppSetting',
      entityId: 'operacion',
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
    });

    res.json(after);
  }),
);
