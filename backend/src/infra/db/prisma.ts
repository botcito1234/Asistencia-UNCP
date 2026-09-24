import { PrismaClient, Prisma } from '@prisma/client';
import { config } from '../../config/env.js';
import { logger } from '../../core/logger.js';

/**
 * Cliente Prisma unico para todo el proceso.
 * En desarrollo se reutiliza entre recargas de tsx para no agotar conexiones.
 */
declare global {
  // eslint-disable-next-line no-var
  var __asistenciaPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__asistenciaPrisma ??
  new PrismaClient({
    log:
      config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace'
        ? [{ emit: 'event', level: 'query' }, { emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
        : [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
  });

// @ts-expect-error los eventos dependen del arreglo de log configurado arriba
prisma.$on('warn', (e: Prisma.LogEvent) => logger.warn({ prisma: e }, 'prisma warn'));
// @ts-expect-error idem
prisma.$on('error', (e: Prisma.LogEvent) => logger.error({ prisma: e }, 'prisma error'));

if (!config.isProduction) globalThis.__asistenciaPrisma = prisma;

/** Nivel de aislamiento usado en las transacciones criticas de marcacion. */
export const SERIALIZABLE = Prisma.TransactionIsolationLevel.Serializable;

/** Codigo de violacion de restriccion unica en PostgreSQL. */
export const PG_UNIQUE_VIOLATION = 'P2002';

export function isUniqueViolation(e: unknown, target?: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code !== PG_UNIQUE_VIOLATION) return false;
  if (!target) return true;
  const meta = e.meta as { target?: string | string[] } | undefined;
  const t = meta?.target;
  if (Array.isArray(t)) return t.join(',').includes(target);
  return typeof t === 'string' ? t.includes(target) : false;
}

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('Conexión a PostgreSQL establecida.');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export { Prisma };
