/**
 * Servicio de notificaciones multicanal.
 *
 * Arquitectura: la notificacion se persiste SIEMPRE (canal IN_APP). Los canales
 * externos (push, correo) son mejores esfuerzos y su resultado queda registrado
 * en NotificationDelivery. Asi el administrador nunca pierde un aviso porque
 * FCM o el SMTP estuvieran caidos o sin configurar.
 *
 * Los eventos criticos se envian de inmediato y con prioridad alta.
 */
import type { NotificationType, SecuritySeverity, Prisma } from '@prisma/client';
import { prisma } from '../../infra/db/prisma.js';
import { logger } from '../../core/logger.js';
import { sendPush, isPushEnabled } from '../../infra/push/fcm.js';
import { sendMail, isMailEnabled } from '../../infra/mail/mailer.js';
import { config } from '../../config/env.js';
import { broadcast, sendToUser } from './realtime.js';

export interface NotifyInput {
  type: NotificationType;
  severity?: SecuritySeverity;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** null o ausente = todos los administradores. */
  recipientUserId?: string | null;
  /** Fuerza el envio inmediato por canales externos. */
  urgent?: boolean;
}

const CRITICAL_TYPES = new Set<NotificationType>([
  'UBICACION_SIMULADA',
  'DISPOSITIVO_NO_AUTORIZADO',
  'FUERA_DE_GEOCERCA',
  'EVENTO_CRITICO',
]);

/**
 * Crea la notificacion y dispara los canales.
 * No lanza: una falla de notificacion nunca debe revertir una marcacion valida.
 */
export async function notify(input: NotifyInput): Promise<string | null> {
  const severity: SecuritySeverity = input.severity ?? (CRITICAL_TYPES.has(input.type) ? 'CRITICO' : 'INFO');
  const urgent = input.urgent ?? CRITICAL_TYPES.has(input.type);

  try {
    const notification = await prisma.notification.create({
      data: {
        type: input.type,
        severity,
        title: input.title.slice(0, 160),
        body: input.body.slice(0, 600),
        data: (input.data ?? {}) as Prisma.InputJsonValue,
        recipientUserId: input.recipientUserId ?? null,
      },
    });

    const payload = {
      id: notification.id,
      type: notification.type,
      severity: notification.severity,
      title: notification.title,
      body: notification.body,
      data: input.data ?? {},
      createdAt: notification.createdAt.toISOString(),
    };

    if (input.recipientUserId) sendToUser(input.recipientUserId, 'notificacion', payload);
    else broadcast('notificacion', payload);

    // Los canales externos no bloquean al llamador.
    void dispatchExternal(notification.id, input, severity, urgent).catch((e) =>
      logger.warn({ err: e, notificationId: notification.id }, 'Fallo el despacho externo de la notificación.'),
    );

    return notification.id;
  } catch (e) {
    logger.error({ err: e, type: input.type }, 'No se pudo registrar la notificación.');
    return null;
  }
}

async function dispatchExternal(
  notificationId: string,
  input: NotifyInput,
  severity: SecuritySeverity,
  urgent: boolean,
): Promise<void> {
  const recipients = await resolveRecipients(input.recipientUserId ?? null);

  // ---- Push ---------------------------------------------------------------
  if (isPushEnabled() && recipients.userIds.length > 0) {
    const tokens = await prisma.pushToken.findMany({
      where: { userId: { in: recipients.userIds }, revokedAt: null },
      select: { id: true, token: true },
    });

    for (const t of tokens) {
      const delivery = await prisma.notificationDelivery.create({
        data: { notificationId, channel: 'PUSH', target: t.token.slice(0, 40) + '...', attempts: 1 },
      });
      const result = await sendPush({
        token: t.token,
        title: input.title,
        body: input.body,
        data: {
          notificationId,
          type: String(input.type),
          severity: String(severity),
          ...flattenData(input.data),
        },
        highPriority: urgent,
      });
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: result.sent ? 'ENVIADO' : 'FALLIDO',
          sentAt: result.sent ? new Date() : null,
          error: result.error?.slice(0, 400) ?? null,
        },
      });
      if (result.invalidToken) {
        await prisma.pushToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
      }
    }
  } else if (recipients.userIds.length > 0) {
    await prisma.notificationDelivery.create({
      data: { notificationId, channel: 'PUSH', status: 'OMITIDO', error: 'Canal push no configurado.' },
    });
  }

  // ---- Correo: solo para lo critico, para no saturar la bandeja -----------
  if (urgent && isMailEnabled()) {
    const to = recipients.emails.length > 0 ? recipients.emails : config.alertEmailRecipients;
    if (to.length > 0) {
      const delivery = await prisma.notificationDelivery.create({
        data: { notificationId, channel: 'EMAIL', target: to.join(',').slice(0, 255), attempts: 1 },
      });
      const result = await sendMail({
        to,
        subject: '[' + config.APP_NAME + '] ' + input.title,
        text: input.body + '\n\n' + JSON.stringify(input.data ?? {}, null, 2),
      });
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: result.sent ? 'ENVIADO' : 'FALLIDO',
          sentAt: result.sent ? new Date() : null,
          error: result.error?.slice(0, 400) ?? null,
        },
      });
    }
  }
}

async function resolveRecipients(recipientUserId: string | null): Promise<{ userIds: string[]; emails: string[] }> {
  if (recipientUserId) {
    const u = await prisma.userAccount.findUnique({
      where: { id: recipientUserId },
      select: { id: true, email: true, status: true },
    });
    if (!u || u.status !== 'ACTIVO') return { userIds: [], emails: [] };
    return { userIds: [u.id], emails: u.email ? [u.email] : [] };
  }

  const admins = await prisma.userAccount.findMany({
    where: { role: 'ADMINISTRADOR', status: 'ACTIVO' },
    select: { id: true, email: true },
  });
  return {
    userIds: admins.map((a) => a.id),
    emails: admins.map((a) => a.email).filter((e): e is string => Boolean(e)),
  };
}

function flattenData(data?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data) return out;
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) continue;
    // FCM solo admite strings en data.
    out[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export async function listNotifications(params: {
  userId: string;
  isAdmin: boolean;
  onlyUnread?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 30));

  // Un administrador ve las suyas y las dirigidas a "todos los administradores".
  const where: Prisma.NotificationWhereInput = params.isAdmin
    ? { OR: [{ recipientUserId: params.userId }, { recipientUserId: null }] }
    : { recipientUserId: params.userId };

  if (params.onlyUnread) where.readAt = null;

  const [total, unread, items] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return { total, unread, page, pageSize, items };
}

export async function markAsRead(notificationId: string, userId: string, isAdmin: boolean): Promise<boolean> {
  const where: Prisma.NotificationWhereInput = isAdmin
    ? { id: notificationId, OR: [{ recipientUserId: userId }, { recipientUserId: null }] }
    : { id: notificationId, recipientUserId: userId };

  const found = await prisma.notification.findFirst({ where, select: { id: true } });
  if (!found) return false;
  await prisma.notification.update({ where: { id: found.id }, data: { readAt: new Date() } });
  return true;
}

export async function markAllAsRead(userId: string, isAdmin: boolean): Promise<number> {
  const where: Prisma.NotificationWhereInput = isAdmin
    ? { readAt: null, OR: [{ recipientUserId: userId }, { recipientUserId: null }] }
    : { readAt: null, recipientUserId: userId };
  const result = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
  return result.count;
}
