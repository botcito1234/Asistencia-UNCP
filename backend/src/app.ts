/**
 * Composicion de la aplicacion HTTP.
 *
 * El orden de los middlewares importa:
 *   contexto -> seguridad de cabeceras -> CORS -> parseo -> limitacion ->
 *   rutas -> 404 -> manejador de errores.
 */
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { pinoHttp } from 'pino-http';
import { config } from './config/env.js';
import { logger } from './core/logger.js';
import { requestContext } from './http/middleware/context.js';
import { errorHandler, notFoundHandler } from './http/middleware/error-handler.js';
import { generalRateLimit } from './http/middleware/rate-limit.js';
import { authRouter } from './http/routes/auth.routes.js';
import { attendanceRouter } from './http/routes/attendance.routes.js';
import { sitesRouter } from './http/routes/sites.routes.js';
import { internsRouter } from './http/routes/interns.routes.js';
import { securityRouter } from './http/routes/security.routes.js';
import { notificationsRouter, settingsRouter } from './http/routes/notifications.routes.js';
import { evidenceRouter } from './http/routes/evidence.routes.js';
import { reportsRouter } from './http/routes/reports.routes.js';
import { archiveRouter } from './http/routes/archive.routes.js';
import { prisma } from './infra/db/prisma.js';
import { PRIVACY_POLICY } from './modules/privacy/policy.js';

export function createApp(): Express {
  const app = express();

  if (config.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext);

  // --- Cabeceras de seguridad ---------------------------------------------
  app.use(
    helmet({
      // La API no sirve HTML propio; el panel se despliega aparte.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          imgSrc: ["'self'", 'data:'],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  // --- CORS ----------------------------------------------------------------
  const allowedOrigins = config.WEB_ADMIN_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  app.use(
    cors({
      origin(origin, callback) {
        // Sin Origin: cliente movil o herramienta local, se permite.
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Origen no permitido por CORS: ' + origin));
      },
      credentials: false,
      exposedHeaders: ['x-request-id', 'content-disposition', 'x-evidence-sha256', 'x-evidence-integrity'],
      maxAge: 600,
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).requestId,
      autoLogging: {
        ignore: (req) => req.url === '/api/v1/salud' || req.url?.startsWith('/api/v1/notificaciones/stream') === true,
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // --- Rutas publicas ------------------------------------------------------
  app.get('/api/v1/salud', async (_req: Request, res: Response) => {
    let database = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'sin-conexion';
    }
    res.status(database === 'ok' ? 200 : 503).json({
      estado: database === 'ok' ? 'operativo' : 'degradado',
      servicio: config.APP_NAME,
      version: '1.0.0',
      baseDatos: database,
      horaServidor: new Date().toISOString(),
      zonaHoraria: config.APP_TIMEZONE,
    });
  });

  /** La politica de privacidad debe poder leerse ANTES de aceptarla. */
  app.get('/api/v1/privacidad', (_req: Request, res: Response) => {
    res.json(PRIVACY_POLICY);
  });

  app.use('/api/v1', generalRateLimit);

  // --- Rutas de negocio ----------------------------------------------------
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/asistencia', attendanceRouter);
  app.use('/api/v1/sedes', sitesRouter);
  app.use('/api/v1/practicantes', internsRouter);
  app.use('/api/v1/seguridad', securityRouter);
  app.use('/api/v1/notificaciones', notificationsRouter);
  app.use('/api/v1/parametros', settingsRouter);
  app.use('/api/v1/evidencias', evidenceRouter);
  app.use('/api/v1/reportes', reportsRouter);
  app.use('/api/v1/archivado', archiveRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
