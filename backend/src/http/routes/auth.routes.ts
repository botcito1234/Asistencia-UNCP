import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { authenticate } from '../middleware/auth.js';
import { loginRateLimit } from '../middleware/rate-limit.js';
import { auditContextOf, deviceInfoOf } from '../middleware/context.js';
import {
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  consentSchema,
  pushTokenSchema,
} from '../validation.js';
import * as authService from '../../modules/auth/auth.service.js';
import { getSettings } from '../../modules/settings/settings.service.js';
import { prisma } from '../../infra/db/prisma.js';
import { errors } from '../../core/errors.js';
import { pendingAuthorization, getActiveBinding } from '../../modules/devices/device.service.js';

export const authRouter: Router = Router();

/**
 * POST /auth/login
 * El practicante debe enviar la identificacion del dispositivo en las
 * cabeceras x-device-*. El administrador no la necesita.
 */
authRouter.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const device = deviceInfoOf(req);

    const result = await authService.login({
      dni: body.dni,
      password: body.password,
      device,
      context: auditContextOf(req),
    });

    res.json(result);
  }),
);

/** POST /auth/refresh - rota el refresh token. */
authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body);
    const device = deviceInfoOf(req);

    const result = await authService.refresh(body.refreshToken, {
      ...auditContextOf(req),
      deviceFingerprint: device?.fingerprint ?? null,
    });

    res.json(result);
  }),
);

/** POST /auth/logout */
authRouter.post(
  '/logout',
  authenticate({ permitirCambioPendiente: true }),
  asyncHandler(async (req, res) => {
    await authService.logout(req.auth!.sessionId, auditContextOf(req));
    res.json({ ok: true });
  }),
);

/** GET /auth/me */
authRouter.get(
  '/me',
  authenticate({ permitirCambioPendiente: true }),
  asyncHandler(async (req, res) => {
    const user = await authService.me(req.auth!.userId);
    const settings = await getSettings();
    res.json({ user, privacyPolicyVersion: settings.privacyPolicyVersion, serverTime: new Date().toISOString() });
  }),
);

/**
 * POST /auth/cambiar-password
 * Accesible aunque el usuario tenga el cambio pendiente: es justamente la
 * operacion que debe poder ejecutar en ese estado.
 */
authRouter.post(
  '/cambiar-password',
  authenticate({ permitirCambioPendiente: true }),
  asyncHandler(async (req, res) => {
    const body = changePasswordSchema.parse(req.body);
    await authService.changePassword(
      req.auth!.userId,
      body.currentPassword,
      body.newPassword,
      auditContextOf(req),
    );
    res.json({
      ok: true,
      message: 'Contraseña actualizada. Todas las sesiones fueron cerradas; vuelva a iniciar sesión.',
    });
  }),
);

/** POST /auth/consentimiento - registra la aceptacion de la politica de privacidad. */
authRouter.post(
  '/consentimiento',
  authenticate(),
  asyncHandler(async (req, res) => {
    const body = consentSchema.parse(req.body);
    await authService.acceptConsent(req.auth!.userId, body.policyVersion, auditContextOf(req));
    res.json({ ok: true });
  }),
);

/** GET /auth/dispositivo - estado del telefono vinculado a la cuenta. */
authRouter.get(
  '/dispositivo',
  authenticate(),
  asyncHandler(async (req, res) => {
    const binding = await getActiveBinding(req.auth!.userId);
    const authorization = await pendingAuthorization(req.auth!.userId);

    res.json({
      vinculado: Boolean(binding),
      dispositivo: binding
        ? {
            platform: binding.platform,
            model: binding.model,
            osVersion: binding.osVersion,
            appVersion: binding.appVersion,
            boundAt: binding.boundAt.toISOString(),
            lastSeenAt: binding.lastSeenAt.toISOString(),
            esEste: binding.deviceFingerprint === req.auth!.deviceFingerprint,
          }
        : null,
      cambioAutorizado: authorization
        ? { expiresAt: authorization.expiresAt.toISOString(), reason: authorization.reason }
        : null,
    });
  }),
);

/** POST /auth/push-token - registra el token de notificaciones del telefono. */
authRouter.post(
  '/push-token',
  authenticate(),
  asyncHandler(async (req, res) => {
    const body = pushTokenSchema.parse(req.body);

    await prisma.pushToken.upsert({
      where: { token: body.token },
      create: { userId: req.auth!.userId, token: body.token, platform: body.platform },
      update: { userId: req.auth!.userId, lastSeenAt: new Date(), revokedAt: null },
    });

    res.json({ ok: true });
  }),
);

/** DELETE /auth/push-token - revoca el token al cerrar sesion. */
authRouter.delete(
  '/push-token',
  authenticate(),
  asyncHandler(async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : null;
    if (!token) throw errors.validation('Falta el token a revocar.');
    await prisma.pushToken.updateMany({
      where: { token, userId: req.auth!.userId },
      data: { revokedAt: new Date() },
    });
    res.json({ ok: true });
  }),
);
