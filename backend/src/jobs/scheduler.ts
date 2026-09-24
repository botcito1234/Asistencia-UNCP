/**
 * Tareas programadas.
 *
 * Todas son idempotentes y tolerantes a reejecucion: si el servicio se reinicia
 * o si dos instancias corren a la vez, el resultado es el mismo. La proteccion
 * real la da `JobRun` con su clave unica (jobName, runKey).
 *
 * Con ENABLE_CRON=false el planificador no arranca; util para desplegar varias
 * replicas de la API y dejar las tareas en una sola.
 */
import cron, { type ScheduledTask } from 'node-cron';
import { config } from '../config/env.js';
import { logger } from '../core/logger.js';
import { prisma } from '../infra/db/prisma.js';
import { closeDueSites } from '../modules/attendance/day-closure.service.js';
import { runRetentionSweep } from '../modules/archive/archive.service.js';
import { getSettings } from '../modules/settings/settings.service.js';

const tasks: ScheduledTask[] = [];

export function startScheduler(): void {
  if (!config.ENABLE_CRON) {
    logger.info('Planificador desactivado (ENABLE_CRON=false).');
    return;
  }

  // --- Cierre de jornada ---------------------------------------------------
  // Cada 15 minutos se revisa que sedes ya alcanzaron su hora local de cierre.
  // Con sedes en una sola zona horaria bastaria una ejecucion diaria, pero esto
  // deja el sistema preparado para sedes en zonas distintas sin tocar codigo.
  tasks.push(
    cron.schedule(
      '*/15 * * * *',
      () => {
        void guard('cierre-jornada', async () => {
          const settings = await getSettings();
          const results = await closeDueSites(settings.dayCloseLocalTime);
          if (results.length > 0) {
            logger.info({ sedes: results.length }, 'Cierre de jornada ejecutado.');
          }
        });
      },
      { timezone: config.APP_TIMEZONE },
    ),
  );

  // --- Archivado por retencion ---------------------------------------------
  // El dia 2 de cada mes a las 03:00: el mes anterior ya esta cerrado y la
  // carga del servidor es minima.
  tasks.push(
    cron.schedule(
      '0 3 2 * *',
      () => {
        void guard('retencion', async () => {
          const results = await runRetentionSweep();
          logger.info({ lotes: results.length }, 'Barrido de retención ejecutado.');
        });
      },
      { timezone: config.APP_TIMEZONE },
    ),
  );

  // --- Limpieza de sesiones y autorizaciones caducadas ---------------------
  tasks.push(
    cron.schedule(
      '30 3 * * *',
      () => {
        void guard('limpieza', async () => {
          const cutoff = new Date(Date.now() - 90 * 86_400_000);

          const sessions = await prisma.session.deleteMany({
            where: { expiresAt: { lt: cutoff } },
          });
          const authorizations = await prisma.deviceChangeAuthorization.updateMany({
            where: { consumedAt: null, cancelledAt: null, expiresAt: { lt: new Date() } },
            data: { cancelledAt: new Date() },
          });
          const pushTokens = await prisma.pushToken.deleteMany({
            where: { revokedAt: { lt: cutoff } },
          });

          logger.info(
            { sesiones: sessions.count, autorizaciones: authorizations.count, tokensPush: pushTokens.count },
            'Limpieza periodica ejecutada.',
          );
        });
      },
      { timezone: config.APP_TIMEZONE },
    ),
  );

  logger.info({ tareas: tasks.length, timezone: config.APP_TIMEZONE }, 'Planificador iniciado.');
}

export function stopScheduler(): void {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}

/** Envuelve cada tarea para que un fallo no derribe el planificador. */
async function guard(name: string, fn: () => Promise<void>): Promise<void> {
  const started = Date.now();
  try {
    await fn();
  } catch (e) {
    logger.error({ err: e, job: name }, 'Fallo una tarea programada.');
  } finally {
    const ms = Date.now() - started;
    if (ms > 30_000) logger.warn({ job: name, ms }, 'Tarea programada lenta.');
  }
}
