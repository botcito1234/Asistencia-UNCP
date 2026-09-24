/**
 * Punto de entrada del servicio.
 *
 * Arranque: valida configuracion -> conecta a la base -> levanta HTTP ->
 * inicia el planificador. Apagado ordenado ante SIGTERM/SIGINT para no cortar
 * peticiones en curso durante un despliegue.
 */
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './core/logger.js';
import { connectDatabase, disconnectDatabase } from './infra/db/prisma.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { closeAll as closeRealtime } from './modules/notifications/realtime.js';
import { isDriveEnabled } from './infra/drive/drive.client.js';
import { isPushEnabled } from './infra/push/fcm.js';
import { isMailEnabled } from './infra/mail/mailer.js';

async function main(): Promise<void> {
  await mkdir(config.STORAGE_ROOT, { recursive: true });
  await connectDatabase();

  const app = createApp();
  const server = createServer(app);

  // Las conexiones SSE son de larga duracion: sin esto, un despliegue las
  // cortaria de golpe.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 120_000;

  await new Promise<void>((resolve) => server.listen(config.PORT, config.HOST, resolve));

  startScheduler();

  logger.info(
    {
      puerto: config.PORT,
      host: config.HOST,
      entorno: config.NODE_ENV,
      zonaHoraria: config.APP_TIMEZONE,
      integraciones: {
        googleDrive: isDriveEnabled() ? 'habilitado' : 'pendiente de credenciales',
        push: isPushEnabled() ? 'habilitado' : 'pendiente de credenciales',
        correo: isMailEnabled() ? 'habilitado' : 'pendiente de credenciales',
      },
    },
    'Servicio de control de asistencia iniciado.',
  );

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Apagado solicitado; cerrando de forma ordenada.');
    stopScheduler();
    closeRealtime();

    server.close(() => {
      void disconnectDatabase().finally(() => {
        logger.info('Servicio detenido.');
        process.exit(0);
      });
    });

    // Red de seguridad: si alguna conexion no cierra, no se queda colgado.
    setTimeout(() => {
      logger.warn('Apagado forzado tras agotar el tiempo de espera.');
      process.exit(1);
    }, 15_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Promesa rechazada sin manejar.');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Excepción no capturada; el proceso se detendra.');
    process.exit(1);
  });
}

main().catch((e) => {
  logger.fatal({ err: e }, 'No se pudo iniciar el servicio.');
  process.exit(1);
});
